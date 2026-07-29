import {getGlobal, GlobalLike} from "./utils/get-global";
import packageJSON from "./package.json" with {type: 'json'};
import {resolveEventType} from './utils/resolve-event-type';
import {NormalizedListenerOptions, normalizeListenerOptions, SUPPORTED_LISTENER_OPTIONS, SupportedListenerOptions, toNativeListenerOptions} from './utils/supported-listener-options';
import {EventPatchLike as EventPatch, isPointerEventType, isTouchEventType, synthesizeTouchEvent} from './utils/touch-synthesis';
import {KEY_CODE_MAP} from './utils/key-code-map';

export {SupportedListenerOptions};

interface EventTargetLike extends EventTarget {
    attachEvent?(type: string, listener: (event: Event) => void): void;

    detachEvent?(type: string, listener: (event: Event) => void): void;
}

interface LegacyEvent extends Event {
    keyCode?: number;
    code?: string;
}

type IEWrapper = (event: Event) => void;

interface IEWrapperRecord {
    target: EventTarget;
    type: string;
    callback: EventListenerOrEventListenerObject;
    wrapper: IEWrapper;
}

interface ListenerRecord extends IEWrapperRecord {
    bucket: ListenerRecord[];
    resolvedType: string;
    capture: boolean;
    once: boolean;
    passive: boolean;
    signal: AbortSignal | undefined;
    onAbort: (() => void) | undefined;
    touch: boolean;
    released: boolean;
}

export declare type ReleaseEventListener = () => void;

/**
 * Auxiliary helpers for {@link EventKitInstance} — environment probes and event factories.
 */
interface EventKitUtils {
    /**
     * Which `AddEventListenerOptions` members the current engine supports natively.
     *
     * @remarks
     * Detected once at load via the getter-probe technique. `once` and `signal`
     * are always emulated by the kit regardless of native support, so callers
     * only need this to reason about `passive` / `capture` forwarding.
     */
    get supportedOptions(): SupportedListenerOptions;

    /**
     * Resolves the event type the current environment actually dispatches.
     *
     * @remarks
     * Cordova `document` events and iOS `<video>` fullscreen events pass through
     * untouched; known alias chains and vendor prefixes are probed; unknown
     * (custom) types are returned unchanged — this never throws.
     */
    resolveType(target: EventTarget, type: string): string;

    /**
     * Creates an `Event`, falling back to `document.createEvent` + `initEvent`
     * on engines without the `Event` constructor (IE9–11).
     */
    createEvent(type: string, init?: EventInit): Event;

    /**
     * Creates a `CustomEvent`, falling back to `document.createEvent('CustomEvent')`
     * + `initCustomEvent` on engines without the `CustomEvent` constructor (IE9–11).
     */
    createCustomEvent<T>(type: string, init?: CustomEventInit<T>): CustomEvent<T>;
}

export interface EventKitInstance {
    /** The installed package version. */
    readonly version: string;

    readonly utils: EventKitUtils;

    /**
     * Attaches `callback` to `target` for `type` and returns a release function.
     *
     * @remarks
     * The same code behaves identically on every engine:
     * - The type is resolved through {@link EventKitUtils.resolveType}, but the
     *   callback always observes `event.type === type` as requested.
     * - `once` and `signal` are emulated in the kit, `passive` is emulated where
     *   unsupported (`preventDefault` becomes a no-op that logs an error),
     *   `capture` degrades to the boolean form on legacy engines.
     * - On engines without `addEventListener`, `attachEvent` is used through a
     *   wrapper that repairs `currentTarget`, `target`, `preventDefault`,
     *   `stopPropagation`, and `KeyboardEvent.code`.
     * - `touch*` listeners on pointer-only engines (IE10/11, old Edge) receive
     *   events decorated with synthesized `touches` / `targetTouches` /
     *   `changedTouches` TouchLists.
     * - Duplicate registrations (same target, type, callback, capture) are
     *   ignored per spec; the existing release function is returned.
     *
     * The returned release function is idempotent and equivalent to calling
     * {@link EventKitInstance.remove} with the same arguments.
     */
    add(target: EventTarget, type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): ReleaseEventListener;

    /**
     * Detaches a listener previously attached with {@link EventKitInstance.add}.
     *
     * @remarks
     * Matching follows the native semantic: `target`, `type`, `callback`, and the
     * `capture` flag. If no kit-managed record matches, the call falls through to
     * the native `removeEventListener` so listeners attached outside the kit are
     * still removed.
     */
    remove(target: EventTarget, type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

const GLOBAL: GlobalLike = getGlobal();
const LISTENER_STORE: ListenerRecord[] = [];
const NOOP: () => void = function (): void {
}

const STORE_KEY: string = '__webEventKitListeners__';

function resolveBucket(target: EventTarget, create: boolean): ListenerRecord[] {
    const holder: Record<string, unknown> = target as unknown as Record<string, unknown>;

    try {
        const existing: unknown = holder[STORE_KEY];

        if (typeof existing !== 'undefined' && existing !== null) return existing as ListenerRecord[];
        if (!create) return LISTENER_STORE;

        const bucket: ListenerRecord[] = [];

        try {
            Object.defineProperty(target, STORE_KEY, {value: bucket, configurable: true, enumerable: false, writable: true});
        } catch (_: unknown) {
            holder[STORE_KEY] = bucket;
        }

        if (holder[STORE_KEY] !== bucket) return LISTENER_STORE;

        return bucket;
    } catch (_: unknown) {
        return LISTENER_STORE;
    }
}

function findListenerRecord(target: EventTarget, type: string, callback: EventListenerOrEventListenerObject, capture: boolean): ListenerRecord | undefined {
    const bucket: ListenerRecord[] = resolveBucket(target, false);

    for (let i: number = 0; i < bucket.length; i++) {
        const record: ListenerRecord = bucket[i];

        if (record.target === target && record.type === type && record.callback === callback && record.capture === capture) return record;
    }

    return undefined;
}

function removeListenerRecord(record: ListenerRecord): void {
    const bucket: ListenerRecord[] = record.bucket;

    for (let i: number = 0; i < bucket.length; i++) {
        if (bucket[i] === record) {
            bucket.splice(i, 1);

            return;
        }
    }
}

function preventDefaultPolyfill(this: LegacyEvent): void {
    this.returnValue = false;
}

function stopPropagationPolyfill(this: LegacyEvent): void {
    this.cancelBubble = true;
}

function passivePreventDefault(this: Event): void {
    // Per spec, preventDefault() inside a passive listener does nothing.
}

function invokeCallback(callback: EventListenerOrEventListenerObject, target: EventTarget, event: Event): void {
    if (typeof callback === 'function') return callback.call(target, event);
    if (typeof callback === 'object' && callback !== null && typeof callback.handleEvent === 'function') return callback.handleEvent(event);
}

function patchEventProperty(event: Event, property: string, value: unknown, patches: EventPatch[]): void {
    const holder: Record<string, unknown> = event as unknown as Record<string, unknown>;
    let had: boolean = false;

    try {
        had = Object.prototype.hasOwnProperty.call(event, property);
    } catch (_: unknown) {
    }

    patches.push({property: property, had: had, previous: had ? holder[property] : undefined});

    defineEventProperty(event, property, value);
}

function restoreEventProperties(event: Event, patches: EventPatch[]): void {
    const holder: Record<string, unknown> = event as unknown as Record<string, unknown>;

    for (let i: number = patches.length - 1; i >= 0; i--) {
        const patch: EventPatch = patches[i];

        try {
            if (patch.had) defineEventProperty(event, patch.property, patch.previous);
            else delete holder[patch.property];
        } catch (_: unknown) {
        }
    }

    patches.length = 0;
}

function defineEventProperty(event: Event, property: string, value: unknown): void {
    try {
        Object.defineProperty(event, property, {value: value, configurable: true});
    } catch (_: unknown) {
        try {
            (event as unknown as Record<string, unknown>)[property] = value;
        } catch (__: unknown) {
        }
    }
}

function fixLegacyEvent(event: LegacyEvent, target: EventTarget): void {
    if (typeof event.currentTarget === 'undefined' || event.currentTarget === null) defineEventProperty(event, 'currentTarget', target);
    if ((typeof event.target === 'undefined' || event.target === null) && typeof event.srcElement !== 'undefined') defineEventProperty(event, 'target', event.srcElement);
    if (typeof event.preventDefault !== 'function') event.preventDefault = preventDefaultPolyfill.bind(event);
    if (typeof event.stopPropagation !== 'function') event.stopPropagation = stopPropagationPolyfill.bind(event);
}

function fixKeyboardEvent(event: LegacyEvent): void {
    if (typeof event.keyCode === 'number' && typeof event.code === 'undefined') {
        const code: string | undefined = KEY_CODE_MAP[event.keyCode];

        if (typeof code === 'string') defineEventProperty(event, 'code', code);
    }
}

function createDispatcher(record: ListenerRecord): IEWrapper {
    return function (event: Event | undefined): void {
        if (typeof event === 'undefined') event = GLOBAL.event; // IE: implicit global event object
        if (typeof event === 'undefined' || event === null) return;
        if (record.released) return;

        fixLegacyEvent(event as LegacyEvent, record.target);

        if (record.once) releaseListenerRecord(record);

        const patches: EventPatch[] = [];

        if (record.passive && !SUPPORTED_LISTENER_OPTIONS.passive) patchEventProperty(event, 'preventDefault', passivePreventDefault.bind(event), patches);
        if (record.resolvedType !== record.type) patchEventProperty(event, 'type', record.type, patches);
        if (record.touch) synthesizeTouchEvent(event, record.resolvedType, patches);

        fixKeyboardEvent(event as LegacyEvent);

        try {
            invokeCallback(record.callback, record.target, event);
        } finally {
            restoreEventProperties(event, patches);
        }
    };
}

function attachNativeListener(record: ListenerRecord): boolean {
    const target: EventTarget = record.target;

    if (typeof target.addEventListener === 'function') {
        target.addEventListener(record.resolvedType, record.wrapper, toNativeListenerOptions(record));

        return true;
    }

    if (typeof (target as EventTargetLike).attachEvent === 'function') {
        (target as EventTargetLike).attachEvent!('on' + record.resolvedType, record.wrapper);

        return true;
    }

    return false;
}

function detachNativeListener(record: ListenerRecord): void {
    const target: EventTarget = record.target;

    if (typeof target.removeEventListener === 'function') return target.removeEventListener(record.resolvedType, record.wrapper, toNativeListenerOptions(record));
    if (typeof (target as EventTargetLike).detachEvent === 'function') return (target as EventTargetLike).detachEvent!('on' + record.resolvedType, record.wrapper);
}

function releaseListenerRecord(record: ListenerRecord): void {
    if (record.released) return;

    record.released = true;

    removeListenerRecord(record);

    try {
        detachNativeListener(record);
    } catch (_: unknown) {
    }

    if (typeof record.signal !== 'undefined' && typeof record.onAbort === 'function' && typeof record.signal.removeEventListener === 'function') {
        try {
            record.signal.removeEventListener('abort', record.onAbort, false);
        } catch (_: unknown) {
        }
    }

    record.onAbort = undefined;
}

function createEventPolyfill(type: string, init?: EventInit): Event {
    try {
        return new Event(type, init);
    } catch (_: unknown) {
    }

    const event: Event = (GLOBAL.document as Document).createEvent('Event');

    event.initEvent(type, typeof init !== 'undefined' && init.bubbles === true, typeof init !== 'undefined' && init.cancelable === true);

    return event;
}

function createCustomEventPolyfill<T>(type: string, init?: CustomEventInit<T>): CustomEvent<T> {
    try {
        return new CustomEvent(type, init);
    } catch (_: unknown) {
    }

    const event: CustomEvent<T> = (GLOBAL.document as Document).createEvent('CustomEvent') as CustomEvent<T>;

    event.initCustomEvent(type, typeof init !== 'undefined' && init.bubbles === true, typeof init !== 'undefined' && init.cancelable === true, typeof init !== 'undefined' && typeof init.detail !== 'undefined' ? init.detail : (null as T));

    return event;
}

const EventKit: EventKitInstance = {
    version: packageJSON.version,

    utils: {
        get supportedOptions(): SupportedListenerOptions {
            return {
                once: SUPPORTED_LISTENER_OPTIONS.once,
                passive: SUPPORTED_LISTENER_OPTIONS.passive,
                capture: SUPPORTED_LISTENER_OPTIONS.capture,
                some: SUPPORTED_LISTENER_OPTIONS.some,
                all: SUPPORTED_LISTENER_OPTIONS.all,
            };
        },

        resolveType: resolveEventType,
        createEvent: createEventPolyfill,
        createCustomEvent: createCustomEventPolyfill,
    },

    add(target: EventTarget, type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): ReleaseEventListener {
        if (typeof target === 'undefined' || target === null) return NOOP;
        if (typeof type !== 'string' || type.length === 0) return NOOP;
        if (typeof callback !== 'function' && (typeof callback !== 'object' || callback === null)) return NOOP;

        const normalized: NormalizedListenerOptions = normalizeListenerOptions(options);
        const existing: ListenerRecord | undefined = findListenerRecord(target, type, callback, normalized.capture);

        if (typeof existing !== 'undefined') return NOOP;
        if (typeof normalized.signal !== 'undefined' && normalized.signal.aborted) return NOOP;

        const resolvedType: string = resolveEventType(target, type);
        const bucket: ListenerRecord[] = resolveBucket(target, true);
        const record: ListenerRecord = {
            bucket: bucket,
            target: target,
            type: type,
            callback: callback,
            wrapper: NOOP as IEWrapper,
            resolvedType: resolvedType,
            capture: normalized.capture,
            once: normalized.once,
            passive: normalized.passive,
            signal: normalized.signal,
            onAbort: undefined,
            touch: isTouchEventType(type) && isPointerEventType(resolvedType),
            released: false,
        };

        record.wrapper = createDispatcher(record);

        if (!attachNativeListener(record)) return NOOP;

        bucket.push(record);

        if (typeof record.signal !== 'undefined' && typeof record.signal.addEventListener === 'function') {
            record.onAbort = function (): void {
                releaseListenerRecord(record);
            };

            record.signal.addEventListener('abort', record.onAbort, false);
        }

        return function (): void {
            releaseListenerRecord(record);
        };
    },

    remove(target: EventTarget, type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
        if (typeof target === 'undefined' || target === null) return;
        if (typeof type !== 'string' || type.length === 0) return;
        if (typeof callback !== 'function' && (typeof callback !== 'object' || callback === null)) return;

        const normalized: NormalizedListenerOptions = normalizeListenerOptions(options);
        const record: ListenerRecord | undefined = findListenerRecord(target, type, callback, normalized.capture);

        if (typeof record !== 'undefined') return releaseListenerRecord(record);

        const resolvedType: string = resolveEventType(target, type);

        if (typeof target.removeEventListener === 'function') return target.removeEventListener(resolvedType, callback, toNativeListenerOptions(normalized));
        if (typeof (target as EventTargetLike).detachEvent === 'function' && typeof callback === 'function') return (target as EventTargetLike).detachEvent!('on' + resolvedType, callback as IEWrapper);
    },
};

export default EventKit;

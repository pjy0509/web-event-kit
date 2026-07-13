import packageJSON from "./package.json" assert {type: 'json'};
import {resolveEventType} from './utils/resolve-event-type';
import {NormalizedListenerOptions, normalizeListenerOptions, SUPPORTED_LISTENER_OPTIONS, SupportedListenerOptions, toNativeListenerOptions} from './utils/supported-listener-options';
import {isPointerEventType, isTouchEventType, synthesizeTouchEvent} from './utils/touch-synthesis';
import {KEY_CODE_MAP} from './utils/key-code-map';

export {SupportedListenerOptions};

declare global {
    interface EventTarget {
        attachEvent?(type: string, listener: (event: Event) => void): void;

        detachEvent?(type: string, listener: (event: Event) => void): void;
    }
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

const LISTENER_STORE: ListenerRecord[] = [];
const NOOP: () => void = function (): void {
}

function findListenerRecord(target: EventTarget, type: string, callback: EventListenerOrEventListenerObject, capture: boolean): ListenerRecord | undefined {
    for (let i: number = 0; i < LISTENER_STORE.length; i++) {
        const record: ListenerRecord = LISTENER_STORE[i];

        if (record.target === target && record.type === type && record.callback === callback && record.capture === capture) return record;
    }

    return undefined;
}

function removeListenerRecord(record: ListenerRecord): void {
    for (let i: number = 0; i < LISTENER_STORE.length; i++) {
        if (LISTENER_STORE[i] === record) {
            LISTENER_STORE.splice(i, 1);

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
        if (typeof event === 'undefined') event = (globalThis as unknown as { event?: Event }).event; // IE: implicit global event object
        if (typeof event === 'undefined' || event === null) return;
        if (record.released) return;

        fixLegacyEvent(event as LegacyEvent, record.target);

        if (record.once) releaseListenerRecord(record);
        if (record.passive && !SUPPORTED_LISTENER_OPTIONS.passive) event.preventDefault = passivePreventDefault.bind(event);
        if (record.resolvedType !== record.type) defineEventProperty(event, 'type', record.type);
        if (record.touch) synthesizeTouchEvent(event, record.resolvedType);

        fixKeyboardEvent(event as LegacyEvent);
        invokeCallback(record.callback, record.target, event);
    };
}

function attachNativeListener(record: ListenerRecord): boolean {
    const target: EventTarget = record.target;

    if (typeof target.addEventListener === 'function') {
        target.addEventListener(record.resolvedType, record.wrapper, toNativeListenerOptions(record));

        return true;
    }

    if (typeof target.attachEvent === 'function') {
        target.attachEvent('on' + record.resolvedType, record.wrapper);

        return true;
    }

    return false;
}

function detachNativeListener(record: ListenerRecord): void {
    const target: EventTarget = record.target;

    if (typeof target.removeEventListener === 'function') return target.removeEventListener(record.resolvedType, record.wrapper, toNativeListenerOptions(record));
    if (typeof target.detachEvent === 'function') return target.detachEvent('on' + record.resolvedType, record.wrapper);
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
            record.signal.removeEventListener('abort', record.onAbort);
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

    const event: Event = globalThis.document.createEvent('Event');

    event.initEvent(type, typeof init !== 'undefined' && init.bubbles === true, typeof init !== 'undefined' && init.cancelable === true);

    return event;
}

function createCustomEventPolyfill<T>(type: string, init?: CustomEventInit<T>): CustomEvent<T> {
    try {
        return new CustomEvent(type, init);
    } catch (_: unknown) {
    }

    const event: CustomEvent<T> = globalThis.document.createEvent('CustomEvent') as CustomEvent<T>;

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

        if (typeof existing !== 'undefined') {
            return function (): void {
                releaseListenerRecord(existing);
            };
        }

        if (typeof normalized.signal !== 'undefined' && normalized.signal.aborted) return NOOP;

        const resolvedType: string = resolveEventType(target, type);
        const record: ListenerRecord = {
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

        LISTENER_STORE.push(record);

        if (typeof record.signal !== 'undefined' && typeof record.signal.addEventListener === 'function') {
            record.onAbort = function (): void {
                releaseListenerRecord(record);
            };

            record.signal.addEventListener('abort', record.onAbort, {once: true});
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
        if (typeof target.detachEvent === 'function' && typeof callback === 'function') return target.detachEvent('on' + resolvedType, callback as IEWrapper);
    },
};

export default EventKit;

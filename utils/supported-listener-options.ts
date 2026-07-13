export interface SupportedListenerOptions {
    once: boolean;
    passive: boolean;
    capture: boolean;
    some: boolean;
    all: boolean;
}

export interface NormalizedListenerOptions {
    capture: boolean;
    once: boolean;
    passive: boolean;
    signal: AbortSignal | undefined;
}

const SUPPORTED: SupportedListenerOptions = {
    once: false,
    passive: false,
    capture: false,
    some: false,
    all: false,
};

const NOOP: () => void = function (): void {
}

function resolveProbeTarget(): EventTarget | undefined {
    if (typeof globalThis.document !== 'undefined' && typeof globalThis.document.createDocumentFragment === 'function') {
        try {
            return globalThis.document.createDocumentFragment();
        } catch (_: unknown) {
        }
    }

    if (typeof globalThis.EventTarget === 'function') {
        try {
            return new globalThis.EventTarget();
        } catch (_: unknown) {
        }
    }

    return undefined;
}

(function detectSupportedListenerOptions(): void {
    const probe: EventTarget | undefined = resolveProbeTarget();

    if (typeof probe === 'undefined' || typeof probe.addEventListener !== 'function') return;

    const options: AddEventListenerOptions = {};

    try {
        Object.defineProperty(options, 'once', {
            get: function (): boolean {
                SUPPORTED.once = true;

                return false;
            },
        });

        Object.defineProperty(options, 'passive', {
            get: function (): boolean {
                SUPPORTED.passive = true;

                return false;
            },
        });

        Object.defineProperty(options, 'capture', {
            get: function (): boolean {
                SUPPORTED.capture = true;

                return false;
            },
        });

        probe.addEventListener('test', NOOP, options);
        probe.removeEventListener('test', NOOP, options);
    } catch (_: unknown) {
    }

    SUPPORTED.some = SUPPORTED.once || SUPPORTED.passive || SUPPORTED.capture;
    SUPPORTED.all = SUPPORTED.once && SUPPORTED.passive && SUPPORTED.capture;
})();

export const SUPPORTED_LISTENER_OPTIONS: SupportedListenerOptions = SUPPORTED;

export function normalizeListenerOptions(options?: boolean | AddEventListenerOptions): NormalizedListenerOptions {
    if (typeof options === 'boolean') return {capture: options, once: false, passive: false, signal: undefined};

    if (typeof options === 'object' && options !== null) {
        return {
            capture: options.capture === true,
            once: options.once === true,
            passive: options.passive === true,
            signal: options.signal,
        };
    }

    return {
        capture: Boolean(options),
        once: false,
        passive: false,
        signal: undefined
    };
}

export function toNativeListenerOptions(normalized: NormalizedListenerOptions): boolean | AddEventListenerOptions {
    if (SUPPORTED.passive) return {
        capture: normalized.capture,
        passive: normalized.passive
    };

    if (SUPPORTED.capture) return {
        capture: normalized.capture
    };

    return normalized.capture;
}

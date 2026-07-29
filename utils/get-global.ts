declare const global: unknown;

export interface GlobalLike {
    document?: Document;
    EventTarget?: { new(): EventTarget };
    event?: Event;
    pageXOffset?: number;
    pageYOffset?: number;
}

export function getGlobal(): GlobalLike {
    if (typeof globalThis !== 'undefined') return globalThis as unknown as GlobalLike;
    if (typeof self !== 'undefined') return self as unknown as GlobalLike;
    if (typeof window !== 'undefined') return window as unknown as GlobalLike;
    if (typeof global !== 'undefined') return global as GlobalLike;

    return {};
}

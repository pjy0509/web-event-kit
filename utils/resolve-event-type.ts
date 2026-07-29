import {getGlobal, GlobalLike} from "./get-global";

const GLOBAL: GlobalLike = getGlobal();

const VENDORS: string[] = ['', 'webkit', 'moz', 'ms', 'MS', 'o', 'O'];
// https://cordova.apache.org/docs/en/latest/cordova/events/events.html
const CORDOVA_DOCUMENT_EVENTS: string[] = ['deviceready', 'pause', 'resume', 'backbutton', 'menubutton', 'searchbutton', 'startcallbutton', 'endcallbutton', 'volumedownbutton', 'volumeupbutton', 'activated', 'cordovacallbackerror'];
// iOS `<video>` fullscreen events have no `on` attribute but are valid on any element exposing `webkitEnterFullscreen` — they must pass through untouched.
const IOS_VIDEO_FULLSCREEN_EVENTS: string[] = ['webkitbeginfullscreen', 'webkitendfullscreen', 'webkitpresentationmodechanged'];
const TYPE_ALIAS_MAP: Record<string, string[]> = {
    'wheel': ['wheel', 'mousewheel', 'DOMMouseScroll'],
    'fullscreenchange': ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange', 'msfullscreenchange'],
    'fullscreenerror': ['fullscreenerror', 'webkitfullscreenerror', 'mozfullscreenerror', 'MSFullscreenError', 'msfullscreenerror'],
    'pointerdown': ['pointerdown', 'MSPointerDown'],
    'pointermove': ['pointermove', 'MSPointerMove'],
    'pointerup': ['pointerup', 'MSPointerUp'],
    'pointercancel': ['pointercancel', 'MSPointerCancel'],
    'pointerover': ['pointerover', 'MSPointerOver'],
    'pointerout': ['pointerout', 'MSPointerOut'],
    'pointerenter': ['pointerenter', 'MSPointerEnter', 'mouseenter'],
    'pointerleave': ['pointerleave', 'MSPointerLeave', 'mouseleave'],
    'gotpointercapture': ['gotpointercapture', 'MSGotPointerCapture'],
    'lostpointercapture': ['lostpointercapture', 'MSLostPointerCapture'],
    'pointerlockchange': ['pointerlockchange', 'webkitpointerlockchange', 'mozpointerlockchange', 'mspointerlockchange'],
    'pointerlockerror': ['pointerlockerror', 'webkitpointerlockerror', 'mozpointerlockerror', 'mspointerlockerror'],
    'touchstart': ['touchstart', 'pointerdown', 'MSPointerDown'],
    'touchmove': ['touchmove', 'pointermove', 'MSPointerMove'],
    'touchend': ['touchend', 'pointerup', 'MSPointerUp'],
    'touchcancel': ['touchcancel', 'pointercancel', 'MSPointerCancel'],
    'transitionrun': ['transitionrun', 'webkitTransitionRun'],
    'transitionstart': ['transitionstart', 'webkitTransitionStart'],
    'transitionend': ['transitionend', 'webkitTransitionEnd', 'oTransitionEnd', 'otransitionend', 'MSTransitionEnd'],
    'animationstart': ['animationstart', 'webkitAnimationStart', 'oanimationstart', 'MSAnimationStart'],
    'animationiteration': ['animationiteration', 'webkitAnimationIteration', 'oanimationiteration', 'MSAnimationIteration'],
    'animationend': ['animationend', 'webkitAnimationEnd', 'oanimationend', 'MSAnimationEnd'],
    'visibilitychange': ['visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange'],
};
const FULLSCREEN_REQUEST_MAP: Record<string, string[]> = {
    '': ['requestFullscreen'],
    'webkit': ['webkitRequestFullscreen', 'webkitRequestFullScreen'],
    'moz': ['mozRequestFullScreen', 'mozRequestFullscreen'],
    'ms': ['msRequestFullscreen'],
    'MS': ['msRequestFullscreen'],
};

function asRecord(value: unknown): Record<string, unknown> {
    return value as Record<string, unknown>;
}

function hasOnProperty(host: unknown, name: string): boolean {
    if (typeof host === 'undefined' || host === null) return false;
    if (typeof asRecord(host)['on' + name] !== 'undefined') return true;

    const lower: string = name.toLowerCase();

    return lower !== name && typeof asRecord(host)['on' + lower] !== 'undefined';
}


function probeHosts(target: EventTarget): unknown[] {
    const hosts: unknown[] = [target];

    if (typeof GLOBAL.document !== 'undefined' && target !== GLOBAL.document) hosts.push(GLOBAL.document);
    if (target !== (GLOBAL as unknown as EventTarget)) hosts.push(GLOBAL);

    return hosts;
}

function extractVendorPrefix(name: string): string {
    for (let i: number = 1; i < VENDORS.length; i++) {
        if (name.indexOf(VENDORS[i]) === 0) return VENDORS[i];
    }

    return '';
}

function testStyleSupport(name: string, styleProperty: string): boolean {
    if (typeof GLOBAL.document === 'undefined' || typeof GLOBAL.document.documentElement === 'undefined') return false;

    const style: unknown = GLOBAL.document.documentElement.style;

    if (typeof style === 'undefined' || style === null) return false;

    const prefix: string = extractVendorPrefix(name);
    let property: string;

    if (prefix === '') property = styleProperty;
    else property = prefix + styleProperty.charAt(0).toUpperCase() + styleProperty.slice(1);

    return typeof asRecord(style)[property] !== 'undefined';
}

function testFullscreenSupport(name: string): boolean {
    if (typeof GLOBAL.document === 'undefined' || typeof GLOBAL.document.documentElement === 'undefined') return false;

    const element: unknown = GLOBAL.document.documentElement;
    const methods: string[] | undefined = FULLSCREEN_REQUEST_MAP[extractVendorPrefix(name)];

    if (typeof methods === 'undefined') return false;

    for (let i: number = 0; i < methods.length; i++) {
        if (typeof asRecord(element)[methods[i]] === 'function') return true;
    }

    return false;
}

function isEventTypeSupported(target: EventTarget, name: string): boolean {
    const hosts: unknown[] = probeHosts(target);

    for (let i: number = 0; i < hosts.length; i++) {
        if (hasOnProperty(hosts[i], name)) return true;
    }

    const lower: string = name.toLowerCase();

    if (lower.indexOf('transition') > -1) return testStyleSupport(name, 'transition');
    if (lower.indexOf('animation') > -1) return testStyleSupport(name, 'animation');
    if (lower.indexOf('fullscreen') > -1) return testFullscreenSupport(name);

    return false;
}

export function resolveEventType(target: EventTarget, type: string): string {
    if (target === (GLOBAL.document as unknown as EventTarget) && CORDOVA_DOCUMENT_EVENTS.indexOf(type) > -1) return type;
    if (typeof asRecord(target)['webkitEnterFullscreen'] === 'function' && IOS_VIDEO_FULLSCREEN_EVENTS.indexOf(type) > -1) return type;

    const candidates: string[] = typeof TYPE_ALIAS_MAP[type] !== 'undefined' ? TYPE_ALIAS_MAP[type] : [type];

    for (let i: number = 0; i < candidates.length; i++) {
        if (isEventTypeSupported(target, candidates[i])) return candidates[i];
    }

    const hosts: unknown[] = probeHosts(target);

    for (let i: number = 1; i < VENDORS.length; i++) {
        for (let j: number = 0; j < candidates.length; j++) {
            const name: string = VENDORS[i] + candidates[j];

            for (let k: number = 0; k < hosts.length; k++) {
                if (hasOnProperty(hosts[k], name)) return name;
            }
        }
    }

    return type;
}

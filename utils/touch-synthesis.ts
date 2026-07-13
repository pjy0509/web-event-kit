export interface SyntheticTouch {
    identifier: number;
    target: EventTarget | null;
    screenX: number;
    screenY: number;
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
    radiusX: number;
    radiusY: number;
    rotationAngle: number;
    force: number;
}

export interface SyntheticTouchList extends Array<SyntheticTouch> {
    item(index: number): SyntheticTouch | null;
}

interface PointerLikeEvent extends Event {
    pointerId?: number;
    screenX?: number;
    screenY?: number;
    clientX?: number;
    clientY?: number;
    pageX?: number;
    pageY?: number;
    width?: number;
    height?: number;
    rotation?: number;
    pressure?: number;
}

type TouchPhase = 'start' | 'move' | 'end' | 'cancel';

const TOUCH_TYPES: string[] = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
const POINTER_PHASE_MAP: Record<string, TouchPhase> = {
    'pointerdown': 'start',
    'MSPointerDown': 'start',
    'pointermove': 'move',
    'MSPointerMove': 'move',
    'pointerup': 'end',
    'MSPointerUp': 'end',
    'pointercancel': 'cancel',
    'MSPointerCancel': 'cancel',
};

const ACTIVE_TOUCHES: SyntheticTouch[] = [];

export function isTouchEventType(type: string): boolean {
    return TOUCH_TYPES.indexOf(type) > -1;
}

export function isPointerEventType(type: string): boolean {
    return typeof POINTER_PHASE_MAP[type] !== 'undefined';
}

function createTouchList(touches: SyntheticTouch[]): SyntheticTouchList {
    const list: SyntheticTouchList = touches.slice() as SyntheticTouchList;

    list.item = function (index: number): SyntheticTouch | null {
        if (index >= 0 && index < list.length) return list[index];

        return null;
    };

    return list;
}

function findTouchIndex(identifier: number): number {
    for (let i: number = 0; i < ACTIVE_TOUCHES.length; i++) {
        if (ACTIVE_TOUCHES[i].identifier === identifier) return i;
    }

    return -1;
}

function scrollOffsetX(): number {
    if (typeof globalThis.pageXOffset === 'number') return globalThis.pageXOffset;
    if (typeof globalThis.document !== 'undefined' && typeof globalThis.document.documentElement !== 'undefined') return globalThis.document.documentElement.scrollLeft;

    return 0;
}

function scrollOffsetY(): number {
    if (typeof globalThis.pageYOffset === 'number') return globalThis.pageYOffset;
    if (typeof globalThis.document !== 'undefined' && typeof globalThis.document.documentElement !== 'undefined') return globalThis.document.documentElement.scrollTop;

    return 0;
}

function createSyntheticTouch(event: PointerLikeEvent, target: EventTarget | null): SyntheticTouch {
    const clientX: number = typeof event.clientX === 'number' ? event.clientX : 0;
    const clientY: number = typeof event.clientY === 'number' ? event.clientY : 0;

    return {
        identifier: typeof event.pointerId === 'number' ? event.pointerId : 0,
        target: target,
        screenX: typeof event.screenX === 'number' ? event.screenX : 0,
        screenY: typeof event.screenY === 'number' ? event.screenY : 0,
        clientX: clientX,
        clientY: clientY,
        pageX: typeof event.pageX === 'number' ? event.pageX : clientX + scrollOffsetX(),
        pageY: typeof event.pageY === 'number' ? event.pageY : clientY + scrollOffsetY(),
        radiusX: typeof event.width === 'number' ? event.width / 2 : 0,
        radiusY: typeof event.height === 'number' ? event.height / 2 : 0,
        rotationAngle: typeof event.rotation === 'number' ? event.rotation : 0,
        force: typeof event.pressure === 'number' ? event.pressure : 0,
    };
}

function defineTouchList(event: Event, property: string, list: SyntheticTouchList): void {
    try {
        Object.defineProperty(event, property, {value: list, configurable: true});
    } catch (_: unknown) {
        (event as unknown as Record<string, unknown>)[property] = list;
    }
}

function filterByTarget(touches: SyntheticTouch[], target: EventTarget | null): SyntheticTouch[] {
    const filtered: SyntheticTouch[] = [];

    for (let i: number = 0; i < touches.length; i++) {
        if (touches[i].target === target) filtered.push(touches[i]);
    }

    return filtered;
}

export function synthesizeTouchEvent(event: Event, resolvedType: string): void {
    const phase: TouchPhase | undefined = POINTER_PHASE_MAP[resolvedType];

    if (typeof phase === 'undefined') return;

    const pointerEvent: PointerLikeEvent = event as PointerLikeEvent;
    const eventTarget: EventTarget | null = event.target;
    const index: number = findTouchIndex(typeof pointerEvent.pointerId === 'number' ? pointerEvent.pointerId : 0);

    const originTarget: EventTarget | null = index > -1 ? ACTIVE_TOUCHES[index].target : eventTarget;
    const touch: SyntheticTouch = createSyntheticTouch(pointerEvent, originTarget);

    if (phase === 'start' || phase === 'move') {
        if (index > -1) ACTIVE_TOUCHES[index] = touch;
        else ACTIVE_TOUCHES.push(touch);
    } else {
        if (index > -1) ACTIVE_TOUCHES.splice(index, 1);
    }

    defineTouchList(event, 'touches', createTouchList(ACTIVE_TOUCHES));
    defineTouchList(event, 'targetTouches', createTouchList(filterByTarget(ACTIVE_TOUCHES, originTarget)));
    defineTouchList(event, 'changedTouches', createTouchList([touch]));
}

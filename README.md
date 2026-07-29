![npm](https://img.shields.io/npm/v/web-event-kit)
![bundle size](https://img.shields.io/bundlephobia/minzip/web-event-kit)
![types](https://img.shields.io/npm/types/web-event-kit)

*English · [한국어](./README.ko.md)*

# web-event-kit

A tiny TypeScript library that unifies event listening behind a single
`add` / `remove` interface — the same code produces the same behavior on
modern browsers, legacy IE (`attachEvent`), Cordova WebViews, and iOS WebKit,
with vendor-prefix resolution, `once` / `passive` / `signal` emulation, and
pointer→touch synthesis for pointer-only engines.

```bash
npm install web-event-kit
```

The bundle is self-contained — no other scripts are required.

## API at a glance

`EventKit` is a singleton.

| Member                                              | Signature | Description |
|-----------------------------------------------------| --- | --- |
| `EventKit.add(target, type, callback, options?)`    | `() => void` | Attaches a listener; returns an idempotent **release function** |
| `EventKit.remove(target, type, callback, options?)` | `void` | Detaches a listener (matches on target, type, callback, and `capture`) |
| `EventKit.version`                                  | `string` | The installed package version |
| `EventKit.utils.resolveType(target, type)`          | `string` | The event type the current engine actually dispatches |
| `EventKit.utils.supportedOptions`                   | `SupportedListenerOptions` (getter) | Native `once` / `passive` / `capture` support flags |
| `EventKit.utils.createEvent(type, init?)`           | `Event` | `Event` factory with a `document.createEvent` fallback (IE9–11) |
| `EventKit.utils.createCustomEvent(type, init?)`     | `CustomEvent<T>` | `CustomEvent` factory with an `initCustomEvent` fallback (IE9–11) |

`options` accepts everything `addEventListener` does: a `boolean` (capture) or an
`AddEventListenerOptions` object with `capture`, `once`, `passive`, and `signal`.

---

## ESM

```js
import EventKit from 'web-event-kit'

// The release function makes cleanup symmetric — no need to keep the callback around
const release = EventKit.add(window, 'resize', onResize, {passive: true})
release()

// `once` and `signal` behave identically on every engine (always emulated by the kit)
const controller = new AbortController()
EventKit.add(document, 'visibilitychange', onVisibility, {signal: controller.signal})
EventKit.add(button, 'click', onFirstClick, {once: true})
controller.abort()

// Symmetric removal also works, exactly like removeEventListener
EventKit.add(element, 'wheel', onWheel, true)
EventKit.remove(element, 'wheel', onWheel, true)
```

## CommonJS

The bundle is built with `exports: "named"`, so the singleton lives under `.default`:

```js
const { default: EventKit } = require('web-event-kit')

const release = EventKit.add(document, 'deviceready', function () {
  // fires in a Cordova WebView — the type is never vendor-rewritten
})
```

## UMD (browser `<script>`)

The global `EventKit` is a namespace object. The singleton is `EventKit.default`.
The bundle is self-contained — no other scripts are required.

```html
<script src="https://unpkg.com/web-event-kit/dist/event-kit.umd.min.js"></script>
<script>
    var kit = window.EventKit.default

    // On IE10/11 this attaches to MSPointerDown/pointerdown, but the callback
    // still receives event.type === 'touchstart' with synthesized TouchLists.
    var release = kit.add(document.body, 'touchstart', function (event) {
        console.log(event.type, event.touches.length, event.changedTouches[0].clientX)
    })
</script>
```

## TypeScript

The instance shape is exported as `EventKitInstance`, the release function type as
`ReleaseEventListener`, and the support-flag shape as `SupportedListenerOptions`.

```ts
import EventKit, { type EventKitInstance, type ReleaseEventListener } from 'web-event-kit'

const release: ReleaseEventListener = EventKit.add(video, 'webkitbeginfullscreen', onEnterFullscreen)
```

## How types are resolved

`EventKit.utils.resolveType` (used internally by `add` / `remove`) walks, in order:

1. **Cordova** lifecycle/hardware events on `document` (`deviceready`, `pause`,
   `resume`, `backbutton`, `menubutton`, `searchbutton`, `startcallbutton`,
   `endcallbutton`, `volumedownbutton`, `volumeupbutton`, `activated`,
   `cordovacallbackerror`) — returned untouched, even though no `ondeviceready`
   attribute exists.
2. **iOS `<video>`** fullscreen events on targets exposing
   `webkitEnterFullscreen` (`webkitbeginfullscreen`, `webkitendfullscreen`,
   `webkitpresentationmodechanged`) — returned untouched; these have no `on`
   attribute either but are valid.
3. **Alias chains** — `wheel` → `mousewheel` → `DOMMouseScroll`,
   `fullscreenchange` → `webkitfullscreenchange` → … → `MSFullscreenChange`,
   `touchstart` → `pointerdown` → `MSPointerDown`,
   `transitionend` → `webkitTransitionEnd` → `oTransitionEnd`,
   `animationend` → `webkitAnimationEnd`, and so on —
   probed via `on*` attributes plus `style.transition` / `style.animation` /
   `requestFullscreen` capability tests.
4. **Generic vendor probing** with `webkit`, `moz`, `ms`, `MS`, `o`, `O` prefixes.
5. **Pass-through** — unknown (custom) event types are returned unchanged.
   Resolution never throws.

Whenever the resolved type differs from the requested one, the callback still
observes `event.type` equal to the type it asked for.

---

## Notes

- **`once` and `signal` are always emulated**, even where natively supported,
  so the kit's internal registry stays consistent and duplicate-detection,
  release functions, and `remove` behave identically on every engine.
- **`passive` is forwarded natively where supported**; where it isn't, the kit swaps
  `preventDefault` for a no-op so the listener behaves as the spec describes.
- **`capture` degrades gracefully**: option-object → `{capture}` → boolean
  third argument, depending on what the engine understands. `attachEvent`
  engines only ever bubble, mirroring native IE behavior.
- **IE (`attachEvent`) listeners are wrapped**, and the wrapper is tracked on the target
  itself, keyed by `(type, callback, capture)`, so `remove` and the release function
  detach the exact wrapper that was attached — and the records are collected with the
  target rather than outliving it. The wrapper
  repairs `event.currentTarget`, derives `event.target` from `srcElement`,
  shims `preventDefault` (`returnValue = false`) and `stopPropagation`
  (`cancelBubble = true`), and fills `KeyboardEvent.code` from `keyCode`.
- **Touch on pointer-only engines**: `touch*` listeners that resolve to `pointer*` /
  `MSPointer*` receive events decorated with W3C-shaped `touches`, `targetTouches`, and
  `changedTouches` TouchLists synthesized from the active pointer set (identifier,
  client/page/screen coordinates, radius, force).
- **Decorations are scoped to the listener that asked for them.** The same `Event` object
  is handed to every listener, so the kit restores `type`, `preventDefault`, and the
  synthesized TouchLists once your callback returns — a `pointerdown` listener never sees
  what a `touchstart` listener asked for.
- **Duplicate registrations** (same target, type, callback, `capture` flag) are ignored
  per the `addEventListener` spec, and `add` hands back a release function that does
  nothing — detaching is the first registrant's to do.
- If no kit-managed record matches, `remove` falls through to the native
  `removeEventListener` (with the same type resolution), so listeners attached
  outside the kit are still detached.

## Browser support

Runs down to **IE 9**.

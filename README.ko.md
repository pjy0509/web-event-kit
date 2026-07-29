![npm](https://img.shields.io/npm/v/web-event-kit)
![bundle size](https://img.shields.io/bundlephobia/minzip/web-event-kit)
![types](https://img.shields.io/npm/types/web-event-kit)

*[English](./README.md) · 한국어*

# web-event-kit

이벤트 리스닝을 `add` / `remove` 하나의 인터페이스로 통일하는 작은 TypeScript
라이브러리. 같은 코드가 최신 브라우저, 레거시 IE(`attachEvent`), Cordova 웹뷰,
iOS WebKit에서 동일하게 동작합니다. 벤더 프리픽스 해석, `once` / `passive` / `signal`
에뮬레이션, 포인터 전용 엔진을 위한 pointer→touch 합성을 포함합니다.

```bash
npm install web-event-kit
```

번들은 자체 완결형이라 다른 스크립트가 필요 없습니다.

## API 한눈에 보기

`EventKit`은 싱글톤입니다.

| 멤버 | 시그니처 | 설명 |
|---| --- | --- |
| `EventKit.add(target, type, callback, options?)` | `() => void` | 리스너를 등록하고, 여러 번 호출해도 안전한 **해제 함수**를 반환 |
| `EventKit.remove(target, type, callback, options?)` | `void` | 리스너를 해제 (target, type, callback, `capture`로 매칭) |
| `EventKit.version` | `string` | 설치된 패키지 버전 |
| `EventKit.utils.resolveType(target, type)` | `string` | 현재 엔진이 실제로 발생시키는 이벤트 타입 |
| `EventKit.utils.supportedOptions` | `SupportedListenerOptions` (getter) | 네이티브 `once` / `passive` / `capture` 지원 플래그 |
| `EventKit.utils.createEvent(type, init?)` | `Event` | `document.createEvent` 폴백을 갖춘 `Event` 팩토리 (IE9–11) |
| `EventKit.utils.createCustomEvent(type, init?)` | `CustomEvent<T>` | `initCustomEvent` 폴백을 갖춘 `CustomEvent` 팩토리 (IE9–11) |

`options`는 `addEventListener`가 받는 것을 그대로 받습니다 — `boolean`(capture) 또는
`capture`, `once`, `passive`, `signal`을 담은 `AddEventListenerOptions` 객체입니다.

---

## ESM

```js
import EventKit from 'web-event-kit'

// 해제 함수 덕분에 정리가 대칭이 됩니다 — 콜백을 따로 들고 있을 필요가 없습니다
const release = EventKit.add(window, 'resize', onResize, {passive: true})
release()

// `once` 와 `signal` 은 어느 엔진에서나 동일하게 동작합니다 (항상 킷이 에뮬레이션)
const controller = new AbortController()
EventKit.add(document, 'visibilitychange', onVisibility, {signal: controller.signal})
EventKit.add(button, 'click', onFirstClick, {once: true})
controller.abort()

// removeEventListener 와 똑같이 대칭 해제도 됩니다
EventKit.add(element, 'wheel', onWheel, true)
EventKit.remove(element, 'wheel', onWheel, true)
```

## CommonJS

번들이 `exports: "named"`로 빌드되어 싱글톤은 `.default` 아래에 있습니다.

```js
const { default: EventKit } = require('web-event-kit')

const release = EventKit.add(document, 'deviceready', function () {
  // Cordova 웹뷰에서 발생합니다 — 이 타입은 벤더 프리픽스로 바뀌지 않습니다
})
```

## UMD (브라우저 `<script>`)

전역 `EventKit`은 네임스페이스 객체이고 싱글톤은 `EventKit.default`입니다.

```html
<script src="https://unpkg.com/web-event-kit/dist/event-kit.umd.min.js"></script>
<script>
    var kit = window.EventKit.default

    // IE10/11 에서는 MSPointerDown/pointerdown 에 붙지만, 콜백은 여전히
    // event.type === 'touchstart' 와 합성된 TouchList 를 받습니다.
    var release = kit.add(document.body, 'touchstart', function (event) {
        console.log(event.type, event.touches.length, event.changedTouches[0].clientX)
    })
</script>
```

## TypeScript

인스턴스의 형태는 `EventKitInstance`, 해제 함수 타입은 `ReleaseEventListener`,
지원 플래그의 형태는 `SupportedListenerOptions`로 export됩니다.

```ts
import EventKit, { type EventKitInstance, type ReleaseEventListener } from 'web-event-kit'

const release: ReleaseEventListener = EventKit.add(video, 'webkitbeginfullscreen', onEnterFullscreen)
```

## 타입이 해석되는 방식

`EventKit.utils.resolveType`(내부적으로 `add` / `remove`가 사용)은 다음 순서로 훑습니다.

1. **Cordova** 라이프사이클·하드웨어 이벤트 (`document` 대상: `deviceready`, `pause`,
   `resume`, `backbutton`, `menubutton`, `searchbutton`, `startcallbutton`,
   `endcallbutton`, `volumedownbutton`, `volumeupbutton`, `activated`,
   `cordovacallbackerror`) — `ondeviceready` 속성이 없어도 그대로 반환합니다.
2. **iOS `<video>`** 전체화면 이벤트 — `webkitEnterFullscreen`을 노출하는 대상에서
   `webkitbeginfullscreen`, `webkitendfullscreen`, `webkitpresentationmodechanged`를
   그대로 반환합니다. 이것들도 `on` 속성이 없지만 유효합니다.
3. **별칭 체인** — `wheel` → `mousewheel` → `DOMMouseScroll`,
   `fullscreenchange` → `webkitfullscreenchange` → … → `MSFullscreenChange`,
   `touchstart` → `pointerdown` → `MSPointerDown`,
   `transitionend` → `webkitTransitionEnd` → `oTransitionEnd`,
   `animationend` → `webkitAnimationEnd` 등 — `on*` 속성과
   `style.transition` / `style.animation` / `requestFullscreen` 기능 검사로 판별합니다.
4. **일반 벤더 프로빙** — `webkit`, `moz`, `ms`, `MS`, `o`, `O` 프리픽스.
5. **통과** — 알 수 없는(커스텀) 이벤트 타입은 그대로 반환합니다. 해석은 절대 예외를
   던지지 않습니다.

해석된 타입이 요청한 타입과 다르더라도, 콜백은 여전히 자기가 요청한 타입과 같은
`event.type`을 봅니다.

---

## 참고

- **`once`와 `signal`은 네이티브로 지원되는 곳에서도 항상 킷이 에뮬레이션합니다.**
  그래야 내부 레지스트리가 일관되게 유지되고, 중복 감지·해제 함수·`remove`가 모든
  엔진에서 동일하게 동작합니다.
- **`passive`는 지원되는 곳에서 네이티브로 전달**하고, 아닌 곳에서는 `preventDefault`를
  아무 일도 하지 않는 함수로 바꿔 사양대로 동작하게 합니다.
- **`capture`는 단계적으로 낮춥니다** — 옵션 객체 → `{capture}` → boolean 세 번째 인자
  순으로, 엔진이 이해하는 형태를 씁니다. `attachEvent` 엔진은 버블링만 하므로 네이티브
  IE 동작을 그대로 따릅니다.
- **IE(`attachEvent`) 리스너는 래핑되고**, 래퍼는 타깃 자신에 `(type, callback, capture)`로
  기록됩니다. 그래서 `remove`와 해제 함수가 실제로 붙인 그 래퍼를 정확히 떼어내고,
  기록은 타깃보다 오래 살아남지 않고 함께 수거됩니다. 래퍼는 `event.currentTarget`을
  복구하고, `srcElement`에서 `event.target`을 유도하며, `preventDefault`
  (`returnValue = false`)와 `stopPropagation`(`cancelBubble = true`)을 채우고,
  `keyCode`로부터 `KeyboardEvent.code`를 채웁니다.
- **포인터 전용 엔진에서의 터치**: `pointer*` / `MSPointer*`로 해석된 `touch*` 리스너는
  활성 포인터 집합으로부터 합성된 W3C 형태의 `touches`, `targetTouches`,
  `changedTouches` TouchList가 붙은 이벤트를 받습니다 (identifier,
  client/page/screen 좌표, 반경, 압력).
- **장식은 그것을 요청한 리스너에만 적용됩니다.** 같은 `Event` 객체가 모든 리스너에
  전달되므로, 킷은 콜백이 끝나면 `type`·`preventDefault`·합성된 TouchList를 원래대로
  되돌립니다. `pointerdown` 리스너가 `touchstart` 리스너의 요청 결과를 보는 일은
  없습니다.
- **중복 등록**(같은 target, type, callback, `capture`)은 `addEventListener` 사양대로
  무시되고, `add`는 아무 일도 하지 않는 해제 함수를 돌려줍니다 — 해제는 처음 등록한
  쪽의 몫입니다.
- 킷이 관리하는 레코드와 일치하는 것이 없으면 `remove`는 네이티브
  `removeEventListener`로 넘어갑니다(타입 해석은 동일하게 적용). 그래서 킷 밖에서
  붙인 리스너도 해제됩니다.

## 브라우저 지원

**IE 9**까지 동작합니다.

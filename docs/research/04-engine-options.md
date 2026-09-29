# 04. 렌더링/엔진 기술 선택 리포트 — Lot & Roll (랏앤롤)

> 작성일: 2026-09-29 (기준 시점: 2026-09). 작성 목적: "성능 최적화가 안 되면 Godot 등으로 재구축을 고려하라"는 제품 오너 요청에 대해 **근거 기반 결정 규칙**을 제공한다.
> 코드는 변경하지 않았다. 이 문서만 추가한다.
>
> **근거 표기**
> - **[V]** 실제로 fetch/소스 열람으로 직접 확인함 (raw.githubusercontent.com 의 소스·XML 문서, developer.android.com, npm registry, 이 저장소의 파일).
> - **[S]** 검색 결과 요약(스니펫)에만 근거. 원문 확인 실패(샌드박스 프록시가 godotengine.org, pixijs.com, docs.cocos.com, unity.com, docs.unity3d.com, defold.com 등을 차단).
> - **[K]** 작성자의 배경 지식/추정. 반드시 스파이크로 검증해야 함.
> - **[M]** 이 저장소에서 측정/계산한 값.

---

## 0. 결론 (TL;DR)

| 항목 | 결론 |
|---|---|
| **기본 권고** | **A 유지 + 온디바이스 계측 게이트를 먼저 통과시킨다.** 지금 시점에서 엔진 교체(Godot/Unity 등)는 정당화되지 않는다. |
| **1순위 대안 (A가 게이트 실패 시)** | **B = TS 엔진/테스트/i18n/저장/Capacitor 파이프라인 유지 + 보드·스테이지·FX만 PixiJS v8(WebGL) 캔버스로 교체, 패널/프롬프트/메뉴는 DOM 유지 ("B-lite")**. 코드의 약 60% 유지 [M], 예상 공수 3–5 person-weeks / 6–10 AI-agent-days [K]. |
| **2순위 (B도 실패, 또는 장기적으로 네이티브 엔진 제품화 결정)** | **C = Godot 4.x** (MIT, Android Gradle/AAB, target SDK 36 기본, NDK 29→16 KB 정렬 [V]). 엔진 TS→GDScript 포팅 필요, 10–14 pw / 14–22 agent-days [K]. |
| **비권장** | Unity 6 (C# 재작성 + 무거운 CI + APK 큼), Flutter+Flame (Dart 재작성, 30fps 캡 내장 없음), Cocos Creator (TS는 유지되지만 에디터 의존 CI/한국어 텍스트/네이티브 JSB 리스크), Phaser 4 (Pixi보다 무거운 프레임워크; 얻는 것 대비 이득 작음). Defold는 APK가 가장 작지만 Lua 재작성. |
| **핵심 논거** | ① 하드 요구 "30fps 캡 + idle 0"의 **구조적 보장**은 DOM(컴포지터가 vsync마다 깨어남)보다 캔버스(우리가 그릴 때만 프레임 생성)가 강하다 → 그 격차는 Pixi로 대부분 메워지고 Godot까지 갈 필요가 없다. ② Godot의 최대 장점(네이티브 2D 배칭, max_fps)은 Pixi+WebView로도 대부분 얻을 수 있고, 잃는 것(엔진 4.4k줄+테스트 1.8k줄 재작성, 결정론 검증 재구축)이 크다. ③ 현재 측정치(§1.1)는 **최적화 이전 기준선**이라 "A가 실패한다"는 증거가 아직 없다. |

---

## 1. 프로젝트 현황과 코드 규모 [M]

`git ls-files` 기준 실측 (png 등 바이너리 제외):

| 디렉터리 | 줄 수 | 비고 |
|---|---:|---|
| `src/engine` | 4,365 | 순수 TS. 비테스트 2,709 + 테스트 1,656 (`__tests__`) |
| `src/content` | 713 | 보드 198, 카드 347, 아이콘 SVG 문자열 ~110, 팔레트 34 |
| `src/i18n` | 744 | ko/en |
| `src/ui` | 7,405 | audio 626, board 757, fx 932, game 755, panels 232, screens 1,457, shell 1,265, stage 1,172, layout/router 209 |
| `src/styles` (CSS) | 3,064 | tokens/base/board/game/panels/screens/stage |
| `e2e` (Playwright) | 1,048 | + 스크린샷 |
| `src` 내 테스트 전체 | 1,843 | 엔진 1,656 + shell 164 등. 오너 기준 vitest 144개 |
| **합계 (TS+CSS)** | **약 17.3k** | 엔진+콘텐츠+i18n = 5.8k (34%) |

- 번들: JS 289 KB + CSS 84 KB (`dist/assets`), 앱 폰트 서브셋 woff2 4개 ≈ 282 KB (`public/fonts/app`, charset 810자) [M]. `dist/fonts/` 전체 5.1 MB는 unicode-range 조각 전체 (APK에서 정리 가능).
- Android: Capacitor 8.5.2, `targetSdk 36`, `minSdk 24`, AGP 8.13.0 [M: `android/variables.gradle`, `android/build.gradle`]. `MainActivity`는 이미 `preferredRefreshRate = 30f` 요청 중 [M].
- 30 Hz 클럭/step 양자화는 `src/ui/fx/time.ts`에 구현 진행 중(커밋 `eabce4e`, WIP).

### 1.1 렌더링 기준선 해석 (`docs/assets/perf-render-baseline.json`) [M]

이 기준선은 **30 Hz 최적화 이전(커밋 155e99a)**, Chromium 141, 4× CPU throttle, DPR 2, 1600×1000 조건이다. 숫자는 "A가 얼마나 나쁜가"가 아니라 **개선 전 출발점**이다.

| 시나리오 | 지표 | 값 | 의미 |
|---|---|---:|---|
| play (45 s, CPU 4인 데모) | presented frames/s (`DrawFrame`) | **58.2** | 60 fps로 상시 프레젠트 → 캡 미적용 상태 |
| | Paint | 61 회/s, 100 ms/s | 매 프레임 페인트 발생 (DOM 애니메이션이 layer를 무효화) |
| | RasterTask | 143 회/s, 127 ms/s | 래스터 비용(4× 스로틀 기준) |
| | Layout / RecalcStyle | Layout 626회·+4.1 s, Style 1,696회·+2.3 s (45 s 동안) | **레이아웃 스래싱 존재**: 9%·5% 시간 |
| | 최대 Layout | 653 ms (t=1.5 s, 게임 화면 마운트) | 마운트 스파이크 |
| | DOM 노드 / SVG 요소 | 1,716~2,194 / 85 (자식 1,365) | 아이콘 중복(같은 SVG 23회 인라인) → `<symbol>` 스프라이트 작업 중 |
| | 컴포지터 layer | 36개, 피크 디바이스 메모리 **138 MB** | WebView에서 GPU 메모리/래스터 비용의 주 원인 |
| title (8 s) | frames/s | 23 | 타이틀 무한 애니메이션(광선/블롭/float) 때문에 idle이 아님 |
| | layer | 28개, 피크 173 MB(title-rays 1500×1500 등) | idle-zero 위반 후보 |

시사점: 문제의 본질은 "DOM/SVG가 느리다"가 아니라 **(a) 60fps 상시 프레젠트, (b) layer 과다(28–36개, 140–170 MB), (c) 레이아웃/스타일 재계산 스래싱**이다. (a)(b)(c)는 각각 캡·`contain`/layer pruning·symbol sprite 작업이 진행 중이며, 아직 재측정되지 않았다.

---

## 2. 옵션별 분석

### 2.A 현 스택 유지 (DOM/SVG + Android WebView + Capacitor)

**WebView가 할 수 있는 것**
- 컴포지터 애니메이션(`transform`/`opacity`)은 메인 스레드와 독립적으로 실행된다 [K, 일반 지식; web.dev "Why are some animations slow?" 검색에서 확인 S]. `steps()`/`linear()` 이징으로 값 변화를 30 Hz 계단으로 양자화하면 **서로 다른 프레임 수**를 줄일 수 있다 (WebKit에서 steps()+메인스레드 바쁨 시 정지하는 버그 사례 있음 [S]; Chromium 동작은 [K], 계측 필요).
- `Window.preferredRefreshRate`(이미 적용) 는 **힌트**다. 패널이 30 Hz 모드를 지원하지 않으면(대부분 60/90/120 이산 모드) 무시되거나 60으로 매핑된다 [K].
- Android 15+ 에서 **`View.setRequestedFrameRate(30f)`** 및 카테고리(`REQUESTED_FRAME_RATE_CATEGORY_*`) 사용 가능 [V: developer.android.com/develop/ui/views/animations/adaptive-refresh-rate]. WebView 도 `View`이므로 Capacitor의 WebView 인스턴스에 적용 가능하다 [K, 적용 효과는 온디바이스 검증 필요]. minSdk 24이므로 `Build.VERSION.SDK_INT >= 35` 가드 필요. **터치 부스트**(ACTION_DOWN 후 일정 시간 High로 상승)가 기본 ON이며 끄는 것은 비권장 [V] → 터치 직후에는 고주사율이 잠깐 나올 수 있음(우리는 idle 후 정착이면 충분).
- **Game Mode FPS throttling**(Android 13+): 최대 GPU 전력 ~50%, 시스템 전력 ~20% 절감을 명시하며 60/90/120 Hz 패널에서 30/45/60 등으로 캡할 수 있다 [V: developer.android.com/games/optimize/adpf/gamemode/fps-throttling]. 단 설정은 `adb device_config` 또는 OEM/Play 게임 모드 경로이고, "Game Mode API를 명시 지원하지 않는 앱"을 대상으로 한다 [V]. 매니페스트에 `android:appCategory="game"` 선언 + game_mode_config 메타데이터가 필요할 가능성 [K, 미확인] → 스파이크 항목.

**WebView가 할 수 없는 것 / 불확실한 것**
1. **컴포지터 프레임 페이싱을 페이지가 직접 제어 불가**: 웹에는 "이 페이지는 30 fps" API가 없다(CSSWG에 저전력 시 프레임레이트 미디어 피처 제안이 논의되는 수준 [S: lists.w3.org public-css-archive 2025Aug #12654]). 캡은 (i) JS 클럭 양자화, (ii) OS 힌트(`preferredRefreshRate`, `setRequestedFrameRate`, Game Mode)의 조합으로만 가능하다.
2. **CSS 애니메이션이 진행 중이면 컴포지터가 vsync마다 BeginFrame을 처리**한다 [K]. 값이 동일한 프레임은 Viz에서 damage 없음으로 스킵될 수 있으나, 무한 애니메이션(타이틀 광선 등)이 걸려 있으면 매 프레임 draw가 발생함이 기준선에서 관측됨(title 23 fps) [M].
3. **layer/래스터 비용**: DOM은 "draw call" 대신 layer(현재 28–36)와 타일 래스터를 낸다. 4× 스로틀에서 Raster 143/s는 SVG 복잡도(같은 아이콘 인라인 반복, box-shadow 131개, opacity 152개 [M])와 직결. `contain`, layer pruning, `<symbol>` 스프라이트로 감소 가능하나 **상한이 엔진마다 다르며 WebView는 GPU 메모리 예산을 통제하지 못한다**.
4. 일부 120 Hz 기기에서 rAF를 호환성 이유로 60 Hz로 돌리는 사례가 있다는 검색 요약이 있으나 [S: 출처 불명확], 우리의 JS 클럭은 이미 자체 30 Hz라 영향이 작다.

**A 점수 근거**: 시간을 들여 최적화하면 idle-zero(애니메이션 완전 정지)는 달성 가능(DOM은 정적일 때 프레임을 만들지 않음 [K])하고, 캡은 "정착 30 fps ± 패널 종속"이 현실적 목표. 배칭 제어는 없음.

### 2.B 하이브리드: TS 엔진 유지 + 렌더링 레이어만 WebGL 2D (WebView 내부)

#### B1. PixiJS v8 (권장 후보)
- 최신: `pixi.js 8.21.0`, MIT [V: registry.npmjs.org]. 
- **프레임 캡**: `Ticker.maxFPS` / `minFPS` 존재 (소스에서 확인: maxFPS 초과 시 `_minElapsedMS` 로 업데이트 스킵) [V: raw.githubusercontent.com/pixijs/pixijs/dev/src/ticker/Ticker.ts]. `ticker.stop()`으로 완전 정지 가능 [V]. 문서화된 "idle 앱 = 첫 렌더 후 autoStart 끄고, 변경 시에만 `app.render()`, 입력 시 ticker 시작" 패턴 [S: pixijs.com/8.x/guides/components/ticker 검색 요약].
- **배칭**: v8 `Batcher`/`DefaultBatcher` 는 같은 배칭 조건의 스프라이트/지오메트리를 하나의 드로우로 묶고 `maxTextures`(GPU가 지원하는 텍스처 유닛 수, 보통 8–16)까지 한 배치에 여러 텍스처 사용 [V: Batcher.ts `maxTextures`]. **스프라이트시트(atlas)로 아이콘 80개+토큰+건물을 텍스처 1–2장에 담으면** 배치가 거의 깨지지 않는다 [K].
- **우리 장면의 예상 draw call** [K, 추정]: 정적 보드(32칸 색띠·프레임·아이콘)는 `cacheAsTexture` 로 1장 텍스처화 시 **1–2 draw**, 토큰 4 + 건물/소유 표시(동일 atlas) **1–2**, 주사위/스테이지 스프라이트 **1–3**, 텍스트(캐시된 Text 텍스처 또는 BitmapText) **2–6**, 컨페티/파티클(동일 atlas, 200–500 스프라이트) **1–2**. **합계 대략 8–20 draw/frame** (현 DOM의 28–36 layer + 수천 개 타일 래스터와 비교). 마스크/필터를 쓰면 배치가 끊기므로 금지.
- **SVG → 텍스처**: v8 은 SVG를 Graphics 로 파싱(`SVGParser`) 하거나 `Assets.load` 로 래스터 텍스처화 가능 [V: SVGParser.ts 존재]. **권장은 빌드 타임 사전 래스터화**(우리 `scripts/build-icons.mjs` 파이프라인에 resvg 단계 추가 → PNG/WebP atlas + JSON) — 런타임 파싱 비용/복잡한 SVG 필터 불일치 회피 [K].
- **한국어 텍스트**: `BitmapText` 는 고정 글리프 아틀라스로 매우 빠르나 CJK 전체 세트는 텍스처 크기/메모리 한계 [S: pixijs.com 텍스트 가이드 검색 요약]. 우리는 이미 charset 810자 서브셋을 관리 중 [M] → 810자 BitmapFont(≈48px, 2048² 텍스처 1장에 수납 가능 [K])로 **정적 라벨·숫자**를, 동적 문장은 `Text`(캔버스 래스터 후 텍스처 캐시)/HTMLText 사용. **가장 현실적인 분할: 패널(현금 카운트업, 소유 칩, 회전 UI), 프롬프트, 설정, 규칙은 DOM 유지** → 한국어·회전(`transform: rotate`)·접근성 이슈 없음, idle 시 0 (DOM은 정적).
- **회전 패널**: DOM 오버레이면 현행 CSS 그대로. 캔버스 안이면 Container.rotation. 
- **WebGL 전력 vs DOM 컴포지팅**: WebGL 캔버스는 "그릴 때만" 프레임을 생성하고 컴포지터에 layer 1개(+DOM 오버레이 몇 개)만 남긴다 → layer/래스터 비용 제거가 핵심 이득. 다만 60 Hz 상시 렌더 시 GPU 전력은 DOM 컴포지팅 대비 더 높을 수 있다. **캡 30 + idle 정지가 전제**여야 이득이 확정된다 [K, 정량 근거 미확보 → 스파이크에서 dumpsys batterystats로 측정].
- **WebGPU**: Android System WebView에서의 WebGPU는 아직 기본 경로로 신뢰하기 어렵다 [K] → `preference: 'webgl'` 고정.
- 위험: WebView GPU 프로세스 컨텍스트 손실(백그라운드 복귀) 처리, 기기별 max texture size(4096 이상 안전), DPR 2–3 기기에서 캔버스 해상도/메모리(1600×1000@2x ≈ 12.8 MB/버퍼) 관리.

#### B2. Phaser 4
- `phaser 4.2.1`, MIT [V: npm]. 2026-04-10 첫 릴리스, 4.1.0 안정판 2026-04-30 [S: phaser.io 뉴스]. WebGL 파이프라인을 RenderNode 아키텍처로 전면 교체, 인덱스 버퍼 드로우 [S].
- 장점: 씬/입력/트윈/파티클 내장. 단점: 우리는 **DOM 패널·자체 애니메이션 시퀀서(`fx/animate.ts`)를 이미 보유** → 프레임워크 기능 대부분이 중복. 패키지가 무겁고(unpacked 112 MB [V], 런타임 번들 수백 KB~1 MB+ [K]) 4.x 생태계 성숙도 낮음. FPS 캡은 게임 설정(`fps.target/limit`)과 루프 sleep 으로 가능 [K].
- 판단: Pixi 대비 **얻는 것 없음**.

#### B3. Cocos Creator 3.8+
- 엔진 MIT, TypeScript, 3.8.8 [V: raw package.json "licensed under MIT", npm `@cocos/creator-types 3.8.8`]. `game.frameRate` 세터가 페이서 `targetFrameRate` 를 갱신 [V: cocos/game/game.ts]. 2D Batcher2D 가 `DrawBatch2D` 로 동일 텍스처 인접 드로우 병합, Dynamic Atlas 제공(네이티브 플랫폼 기본 OFF) [V: batcher-2d.ts, S: docs.cocos.com dynamic-atlas].
- **네이티브 Android 빌드**(WebView 아님, C++ 엔진 + JS 바인딩 V8). CLI 빌드 `--build "platform=android"` 지원 [S: docs.cocos.com]. 그러나 **에디터 프로젝트(.scene/.prefab/메타) 필요**, CI에서 에디터 설치·라이선스/디스플레이 의존이 있어 GitHub Actions 성숙도는 Godot보다 낮다 [K].
- 우리 TS 엔진은 그대로 임포트 가능(vitest 별도 실행). 하지만 UI(7.4k줄 + CSS 3k) 전체를 Cocos 씬으로 재작성해야 하고, 한국어 텍스트(Label + TTF, 동적 아틀라스)와 Capacitor 브리지(햅틱/저장/방향고정)를 네이티브 쪽으로 재연결해야 한다 → **B의 이점(파이프라인 유지)이 사라지고 C의 비용에 근접**.

### 2.C Godot 4.x

**검증된 사실 [V: raw.githubusercontent.com/godotengine/godot/master]**
- `Engine.max_fps`: 0=무제한, "전력 소모·발열 감소·배터리 개선" 목적. vsync Enabled/Adaptive 이면 주사율을 넘지 못함 (`doc/classes/Engine.xml`).
- `OS.low_processor_usage_mode` (기본 false): "필요할 때만 화면을 갱신, 모바일 배터리 개선 가능". `low_processor_usage_mode_sleep_usec` 기본 6900 µs (`OS.xml`, `ProjectSettings.xml`: `application/run/low_processor_mode*`). 메인 루프에서 `RenderingServer.has_changed()` 일 때만 draw (`main/main.cpp` L5118–5120) → **idle 시 그리기 0에 근접**. `OS::add_frame_delay` 는 `max_fps` 로 sleep 을 늘린다 (`core/os/os.cpp`).
- **Android 관련 주의 [S]**: 커뮤니티에서 "Android에서 low processor mode 가 깜빡임(flicker)을 유발해 모바일에서는 끄는 것이 관행"이라는 보고가 반복됨(forum.godotengine.org "Low power processor mode on Android"). 대안: idle 화면에서 `Engine.max_fps` 를 낮추고 `queue_redraw`/파티클·애니 정지. 버전별 재현 여부 미확인 → 채택 시 스파이크 필수.
- Android **Swappy 프레임 페이싱** 기본 ON (`display/window/frame_pacing/android/enable_frame_pacing` default true; `swappy_mode` 는 `max_fps` 를 존중; `max_fps=0` 이면 화면 주사율) [V: ProjectSettings.xml].
- **2D 배칭**: `RendererCanvasRenderRD` 가 canvas item 을 `Batch` 로 기록, `rendering/2d/batching/item_buffer_size`(16384 커맨드/배치), `uniform_set_cache_size`(4096) [V]. 즉 4.3+ 이후 **RD(Vulkan) 렌더러에서도 2D 배칭** (과거 문서의 "Vulkan은 2D 배칭 안 함" 은 4.3 이전 서술 [S]).
- **SVG**: `modules/svg` 가 **ThorVG 1.0.3(MIT)** 로 임포트/래스터화 (`image_loader_svg.cpp`, `thirdparty/README.md`) [V]. Godot 은 임포트 시 지정 스케일로 텍스처화(런타임 벡터 렌더 아님) [K].
- **진동**: `Input.vibrate_handheld(duration_ms, amplitude)` Android/iOS/Web 지원, **export preset 에서 VIBRATE 권한 필요** [V: Input.xml]. Capacitor Haptics 의 impact/notification 스타일에 비하면 단순 → 햅틱 품질 소폭 하락 [K].
- **Android 빌드**: Gradle 빌드 템플릿 `targetSdk 36`, `compileSdk 36`, `minSdk 24`, buildTools 36.1.0, JDK 17, NDK 29.0.14206865, AGP 8.13.2 (master = 4.8 dev) [V: `platform/android/java/app/config.gradle`]. NDK r28+ 는 **16 KB 정렬 기본**이므로 [V: developer.android.com/guide/practices/page-sizes] 4.5.x 이후 안정판(4.6: 2026-01-26 [S], 4.7.x 존재 [S: gdUnit4 호환 목록에 4.7.1])에서 16 KB 요건 충족 가능성이 높다 — 사용할 정확한 버전의 릴리스 노트로 확인 필요 [K].
- **Google Play 요건 [V: developer.android.com]**: 2026-08-31부터 신규 앱/업데이트는 API 36 타깃 (연장 신청 시 2026-11-01), 2027-02-01부터 API 35+ 타깃 업데이트는 64-bit 기기에서 16 KB 페이지 지원 필수. (이는 Capacitor/AGP 8.13 + 네이티브 라이브러리 없는 WebView 앱은 이미 충족, Godot/Unity는 엔진 버전 의존.)
- **CI**: `godot --headless --export-release "Android" out.aab` 형태 CLI 내보내기, `barichello/godot-ci` 도커 이미지/커뮤니티 액션 존재 [S]. Android는 JDK17 + SDK + 키스토어 환경 변수 필요, 템플릿 설치 단계 있음 → **Capacitor보다 CI 단계 많지만 성숙**.
- **테스트**: GUT 9.x (Godot 4) [V: bitwes/Gut README], gdUnit4 (4.3–4.7.1 지원) [V: README 배지]. 결정론 엔진 테스트를 GDScript로 재작성 필요 (vitest 144개 → GUT/gdUnit4).
- **한국어**: TextServerAdvanced(HarfBuzz)는 CJK 셰이핑을 포함하고, 시스템 폰트 폴백을 자동 사용(Android 지원) [S: Godot 문서/블로그 요약]. 그래도 Noto Sans KR 서브셋 번들이 안전 [K]. 회전 UI: `Control.rotation` + `pivot_offset` 로 가능하나 **컨테이너 레이아웃/히트테스트는 회전을 고려하지 않으므로** 좌석별 `SubViewport`/`Node2D` 루트 회전이 안전 [K].
- **2D Android 아픔 [S]**: Android 렌더링 드라이버는 project setting 상 `rendering/rendering_device/driver.android = vulkan`(단일 선택), GL 경로는 `gl_compatibility` 렌더링 메서드 [V]. Mali/일부 Adreno(5xx)에서 Vulkan 크래시/드라이버 이슈 → 4.5.2에서 Adreno 5xx 워크어라운드, "Vulkan Mobile을 게시했다면 4.5.2+ 로 업그레이드 권장" [S: godotengine.org maintenance release 4.5.2 요약]. 태블릿(Samsung Tab: Adreno/Xclipse/Mali 혼재)에서 **기기 매트릭스 테스트 필요**.
- **APK 크기 [K]**: arm64 단일 ABI 릴리스 템플릿 최적화 시 대략 15–25 MB (+폰트/아틀라스). 검색에서 직접 수치는 확보 못함 [S: 문서에 ABI 단일화·커스텀 템플릿으로 축소 가능 언급].
- **포팅 견적**:
  - 엔진 2.7k줄(reducer/rules/economy/ai/save/sim/rng) → GDScript 약 2.5–3k줄; `mulberry32`는 32-bit 마스크 연산(GDScript int 는 64-bit)이므로 **동일 seed 결과가 TS와 비트 동일**한지 골든 테스트 필수.
  - 테스트 1.7k줄 → GUT 재작성(특히 `flow.test.ts` 755줄).
  - UI 7.4k + CSS 3k → 씬 + GDScript 5–7k줄, `.tscn` 다수.
  - 합계: 사람 1인 **10–14 pw**, AI 에이전트 병렬 활용 **14–22 agent-days** [K, 추정].

### 2.D Unity 6
- **라이선스 [S]**: Runtime Fee 취소(2024). 2026년 Unity Personal은 연 매출·펀딩 US$200k 이하 무료(한도 $100k→$200k 상향), Unity 6 부터 스플래시 선택. Pro는 $2,310/seat/yr, Enterprise는 연매출 $25M 초과 [S: unity.com/pricing-updates, enginesdatabase.com 요약]. 개인 제작·소규모 출시에는 문제 없으나 임계 초과 시 Pro 필요.
- **캡/idle**: `Application.targetFrameRate=30`, `QualitySettings.vSyncCount=0`, `OnDemandRendering.renderFrameInterval` 로 렌더 프레임 간격을 늘려 업데이트와 분리 [K; docs.unity3d.com 차단으로 [V] 실패]. Unity 는 Android Frame Pacing(Swappy) 통합 [K].
- 배칭: SpriteAtlas + SRP Batcher/2D Renderer 로 우수 [K]. 애니메이션·파티클 품질 최상급.
- 한국어: TextMeshPro 동적 폰트 아틀라스(SDF)로 Hangul 처리 가능하나 아틀라스 확장/폰트 서브셋 관리 필요 [K].
- **16 KB**: Unity 2021/2022/6 지원 [V: developer.android.com/games/engines/unity/unity-on-android].
- CI: GameCI (`game-ci/unity-builder`) + Personal 라이선스 활성화 필요(시리얼/ulf 파일 시크릿), 이미지 다운로드 수 GB, 빌드 10–20분+ [K]. **가장 무거운 CI**.
- APK: IL2CPP arm64 빈 프로젝트 ~25–35 MB [K]. C# 전면 재작성(엔진 포함), 결정론 검증 재구축. 견적 10–14 pw / 15–24 agent-days [K].

### 2.E Flutter + Flame, Defold, libGDX/KorGE

| 후보 | 핵심 사실 | 판단 |
|---|---|---|
| **Flutter + Flame** | Flutter는 변경 시에만 프레임을 스케줄(정적 UI에서 idle 0에 가까움) [K]. Impeller가 Android 기본, Flutter 3.44에서 Skia 제거 주장 [S: 2차 블로그, 신뢰도 낮음 — 원문 미확인]. Flame 게임 루프는 매 vsync tick → 30 fps 캡·pause 는 직접 구현 필요 [K]. 한국어/회전 UI(RotatedBox)는 최상급, Dart 재작성. | 캡 메커니즘이 약하고 엔진·테스트 전면 재작성. 비권장 |
| **Defold** | Lua, 빈 프로젝트 APK 1.6–3.5 MB(버전에 따라) [S: defold.com 사이즈 매뉴얼 요약, 원문 미열람], 아틀라스/렌더 스크립트로 배칭 제어 우수, `sys.set_update_frequency`/frame cap 지원 [K]. CJK 폰트는 글리프 생성 설정 필요 [K]. TypeScriptToLua(ts-defold) 로 TS 엔진 일부 재사용 가능성 [K]. | APK/전력 최상, 그러나 툴체인 이질적(UI 위젯 시스템 빈약 → 프롬프트/패널 전부 직접 제작). 대안 3위 |
| **libGDX (1.14.3)** | Java/Kotlin, `Gdx.graphics.setForegroundFPS(30)`, `setContinuousRendering(false)` 로 idle 0 [K]; SpriteBatch 직접 배칭 [V: gradle.properties 버전 1.14.3, 기능은 K]. UI(Scene2D) 회전·한글 비트맵 폰트 생성 필요. | 재작성 + UI 툴킷 빈약. 비권장 |
| **KorGE** | Kotlin 멀티플랫폼, 커뮤니티 규모 작음 [K]. | 비권장 |

---

## 3. 비교 스코어카드 (1–5, 5가 유리)

평가 축 (모두 "높을수록 좋음"): ①30fps 캡+idle-zero ②draw call/배칭 제어 ③애니메이션 품질 ④한국어+회전 UI 용이 ⑤Android 릴리스/CI 성숙도 ⑥기존 코드·테스트 재사용 ⑦포팅 공수(5=거의 없음) ⑧APK 크기 ⑨위험(5=낮음).

| 옵션 | ①캡/idle | ②배칭 | ③애니 | ④한글/회전 | ⑤릴리스/CI | ⑥재사용 | ⑦공수 | ⑧APK | ⑨위험 | 합계/45 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **A. 현 스택(DOM/SVG+Capacitor) + 최적화** | 3 | 2 | 4 | 5 | 5 | 5 | 5 | 5 | 4 | **38** |
| **B1. TS 유지 + Pixi v8(WebView), DOM 오버레이 병행** | 4 | 5 | 5 | 4 | 5 | 4 | 3 | 4 | 3 | **37** |
| B2. TS 유지 + Phaser 4 | 4 | 4 | 4 | 3 | 4 | 3 | 3 | 3 | 2 | 30 |
| B3. Cocos Creator 3.8 (네이티브) | 5 | 5 | 4 | 3 | 3 | 3 | 2 | 3 | 3 | 31 |
| **C. Godot 4.x** | 4 | 4 | 5 | 4 | 4 | 1 | 2 | 3 | 3 | 30 |
| D. Unity 6 (URP 2D) | 4 | 5 | 5 | 3 | 3 | 1 | 1 | 2 | 3 | 27 |
| E1. Flutter + Flame | 3 | 3 | 4 | 5 | 4 | 1 | 1 | 3 | 3 | 27 |
| E2. Defold | 4 | 5 | 4 | 3 | 4 | 1 | 2 | 5 | 3 | 31 |
| E3. libGDX / KorGE | 4 | 4 | 3 | 2 | 3 | 1 | 1 | 4 | 2 | 24 |

스코어 근거 요약
- ① A=3: idle-zero는 가능하나 프레임 캡은 힌트/양자화 의존(패널·OS 종속). B1=4: `ticker.maxFPS`·`stop()`·요청 시 렌더가 **우리 코드에서 결정적**[V]. C=4: `max_fps`·`low_processor_usage_mode` [V]이나 Android low-processor 깜빡임 보고 [S]. B3=5: `game.frameRate` [V] + 네이티브 루프.
- ② A=2: layer 수/래스터를 브라우저가 결정(28–36 layer, 138–173 MB [M]).
- ⑤ A=5: 이미 GitHub Actions APK 빌드 동작 [M]. Godot/Unity/Cocos는 엔진 설치·라이선스·템플릿 단계 추가.
- ⑥ B1=4: 엔진·테스트·i18n·저장·Capacitor·오디오·화면 DOM 유지(§5.1). 
- ⑦ 공수: A≈0, B1 3–5 pw, B3/C/E2 8–14 pw, D/E1 10–14 pw [K].
- 점수는 **가중치 없는 단순 합**이며, 하드 요구(①②)와 재사용(⑥)을 중시하면 A→B1→C 순서가 유지된다.

### 공수 비교표 [K: 모든 수치는 추정]

| 옵션 | person-weeks (1인) | AI-agent-days | 유지되는 코드 | 비고 |
|---|---:|---:|---|---|
| A (남은 튜닝+온디바이스 계측) | 1–2 | 2–4 | 100% | 계측 스크립트/Android 힌트 추가 |
| **B1 B-lite (보드/스테이지/FX만 Pixi)** | **3–5** | **6–10** | **약 60–65%** | 패널/프롬프트/화면 DOM 유지 |
| B1 B-full (전 화면 캔버스) | 8–12 | 15–25 | 약 40% | 한국어/접근성/입력 재구현, 비권장 |
| B2 Phaser 4 | 4–6 | 8–12 | 약 60% | Pixi 대비 이점 없음 |
| B3 Cocos | 8–12 | 15–22 | TS 엔진만 | 에디터 프로젝트 전환 |
| **C Godot** | **10–14** | **14–22** | 사양/데이터/i18n 키/SVG 소스/저장 스키마 | 엔진+테스트+UI 재작성 |
| D Unity | 10–14 | 15–24 | 위와 동일 | C# |
| E1 Flutter+Flame | 9–13 | 14–22 | 위와 동일 | Dart |
| E2 Defold (+TSTL 시도) | 8–12 | 12–20 | 엔진 일부(TSTL) | Lua |

---

## 4. 권고와 결정 규칙

### 4.1 권고
1. **지금은 A를 끝까지 밀고**, Android 태블릿 실기기에서 아래 게이트를 측정한다. (엔진 교체 결정을 "지금" 내릴 근거가 없음 — 기준선은 최적화 이전이며 현재 30 Hz 클럭/symbol sprite/layer pruning이 미반영.)
2. A의 게이트가 실패하면 **먼저 B(Pixi B-lite)**, 그 다음에야 C(Godot). 이유: B는 코드의 ~60%를 유지하고, CI(Capacitor→APK/AAB)를 그대로 쓰며, 하드 요구(캡·배칭·idle)를 Godot와 거의 동등한 수준으로 코드에서 결정적으로 통제한다.
3. **추가로 A에 저비용 항목 3개**를 먼저 넣는다 (스파이크 각 0.5일): (a) `Build.VERSION.SDK_INT >= 35` 에서 WebView `setRequestedFrameRate(30f)` [V API, 효과 K]; (b) 타이틀/결과/롤 프롬프트에서 **모든 무한 애니메이션 정지(`animation-play-state: paused` 또는 요소 제거)** — 기준선 title 23 fps는 idle-zero 위반; (c) `android:appCategory="game"` + Game Mode FPS throttling 적용 가능성 확인 [K].

### 4.2 측정 가능한 결정 규칙 (`npm run perf`, `npm run perf:render`, 실기기)

측정 환경: (1) 개발 머신 Chromium, 4× CPU throttle, DPR 2, 1600×1000 (`npm run perf`의 `cap`/`idle`/`play` phase), (2) **실기기 중급 태블릿 1대 이상**(60 Hz 또는 90/120 Hz), 배터리 세이버 30 fps ON.

| # | 지표 (게이트) | 통과 기준 | 측정법 |
|---|---|---|---|
| G1 | 캡: 고유 프레임/s (애니메이션 중, 배터리 세이버 ON) | **26–34 fps** (60 Hz·120 Hz 기기 모두) | `perf` cap phase의 compositor `DrawFrame`/s; 실기기는 `adb shell dumpsys gfxinfo <pkg> framestats` 의 프레임/s |
| G2 | idle: 사람 입력 대기(롤 프롬프트, 타이틀, 결과, 타이머 OFF) 10 s | Layout/Paint/Raster/rAF/타이머 발화 **각 0**, 메인스레드 TaskDuration **< 1%** (4× throttle), 실기기 `gfxinfo` 신규 프레임 **0** | `perf` idle phase |
| G3 | 프레임 비용 p99 | 메인스레드 프레임 작업 **p99 ≤ 20 ms @4× throttle** (33 ms 예산의 60%), 롱태스크(>50 ms) 정상 상태 **0회** | `perf` play phase (rAF 간격·long task) |
| G4 | 마운트 스파이크 | 게임 화면 진입 Layout **≤ 100 ms** (기준선 653 ms) | trace의 최대 Layout |
| G5 | 컴포지터 layer 예산 | 피크 layer 수 **≤ 20**, 디바이스 layer 메모리 **≤ 100 MB** (기준선 36개/138 MB, title 173 MB) | `perf:render` layers |
| G6 | 전력 (실기기) | 30분 CPU 4인 데모 소모 배터리% 를 A와 B 스파이크 간 비교(절대치 임계는 첫 측정 후 오너와 합의). 지표: `dumpsys batterystats`, 표면 온도 상승 | Battery Historian |

**의사결정 규칙**
- **A 유지**: G1–G5 전부 통과 → 재작성 없이 출시. (G6는 참고.)
- **B-lite로 이동**: G2(idle)·G1(캡)은 통과하지만 **G3/G4/G5 중 하나라도 실패** (즉 "DOM/SVG 렌더 비용이 문제"인 경우), 또는 실기기에서 G1이 30 Hz 힌트 무시 때문에 실패(60/120 fps 상시 프레젠트)하여 OS 힌트로 못 고치는 경우. → 캔버스가 그릴 때만 프레임을 만들므로 패널 주사율과 무관하게 캡 가능.
- **C(Godot)로 이동**: B-lite 스파이크(§5.1 Phase 0–2)에서 다음 중 하나가 발생 — (i) WebView WebGL이 대상 태블릿에서 G1/G3 미달 또는 컨텍스트 손실/드라이버 결함으로 재현 불가, (ii) 실기기 G6에서 WebView 기반이 네이티브 대비 유의하게 불리(예: 동일 시나리오 배터리 소모 ≥ 1.3× 로 추정되는 경우 — 임계는 스파이크에서 확정), (iii) 제품 로드맵이 3D 주사위·iOS·온라인 대전 등 **네이티브 엔진 장점이 필요**한 방향으로 확정. 이때만 10–14 pw 재작성을 정당화한다.
- **Unity/Flutter/Cocos/Defold**: 위 규칙에서 채택하지 않음. 예외: Godot Android 스파이크가 driver 이슈로 실패하면 Defold(APK 최소·배칭 제어 우수)를 차선으로 재평가.

---

## 5. 상위 대안 마이그레이션 계획

### 5.1 B-lite (PixiJS v8) — 무엇이 그대로 가고 무엇이 바뀌는가

| 영역 | 처리 | 근거/비고 |
|---|---|---|
| `src/engine` (4.4k, 테스트 포함) | **그대로** | 결정론 reducer, AI, sim, save. vitest 유지 |
| `src/content` 보드·카드·팔레트 | **그대로** | 데이터 |
| `src/content/icons` SVG 소스(80 아이콘) | **빌드 타임 아틀라스화** | `scripts/build-icons.mjs` 뒤에 resvg(PNG/WebP) → atlas + JSON. DOM 화면은 기존 `<symbol>` 스프라이트 유지 |
| `src/i18n` (744) | **그대로** | DOM 텍스트 그대로. 캔버스 라벨은 `t()` 결과를 BitmapText/Text로 |
| 저장 포맷 (`save.ts`, Preferences) | **그대로** | 엔진 상태 JSON은 렌더러와 무관 |
| Capacitor/Gradle/GitHub Actions | **그대로** | APK/AAB 파이프라인, 햅틱, 방향/전체화면 |
| `ui/screens` (Title/Setup/Rules/Settings/Result, 1.5k) + `shell` (1.3k) | **DOM 유지** | 메뉴는 정적 → idle 0. 타이틀 무한 애니는 제거/정지 |
| `ui/panels` (232) + `ui/stage/prompts` (644) | **DOM 유지** (오버레이) | 한국어 텍스트·좌석별 회전이 CSS로 이미 해결. 현금 카운트업 등은 저빈도 DOM 갱신 |
| `ui/board/Board.ts` (612+geometry), `stage/Stage.ts`·`Dice.ts`(1.2k 중 일부), `fx/*` (932) | **재작성 → Pixi 씬** | 보드·토큰·건물·주사위·회전 스테이지·컨페티/코인 파티클·플로트 |
| `ui/fx/animate.ts` 시퀀서 (이벤트→Promise) | **개념 유지**, 트윈 백엔드를 Pixi ticker 기반으로 교체 | `time.ts`의 30 Hz 클럭을 `ticker.maxFPS=30` 로 대체 |
| `ui/audio/synth.ts` (480) | **그대로 유지가 기본**; 필요 시 OfflineAudioContext로 사전 렌더 → AudioBuffer 캐시 | 오디오는 렌더러와 무관. OGG 사전 렌더링은 Godot 이동 시에만 필요(§5.2 G4) |
| e2e (Playwright 1,048) | 캔버스 부분은 스크린샷 기반 비교로 조정 | 게임 화면 스냅샷 재승인 필요 |
| 재사용 비율 | **약 60–65%** [M 근사: 엔진 4.4k + content 0.7k + i18n 0.7k + screens/shell/panels/prompts/audio ≈ 4.2k = 10.0k / 17.3k ≈ 58% + CSS 일부 → 60–65%] | |

**단계 계획**

| Phase | 내용 | 산출물/게이트 | 공수 |
|---|---|---|---|
| **0. 스파이크 (반드시 먼저)** | 빈 Pixi 캔버스를 Capacitor WebView에 올려 (a) `ticker.maxFPS=30`, idle `ticker.stop()`, 요청 시 `app.render()`; (b) 32칸 보드 정적 텍스처 + 토큰 4개 + 파티클 300개 시연; (c) 실기기에서 G1/G2/G5/G6 측정, A 대비 비교 | Go/No-Go 리포트. **No-Go 이면 C 검토로** | 0.5–1 pw / 1–2 ad |
| **1. 자산 파이프라인** | SVG→atlas(빌드 스크립트), 810자 BitmapFont(또는 Text 캐시) 생성, atlas JSON 로더, 텍스처 예산(≤ 2×2048²) | `npm run build:atlas`, CI 통합 | 0.5–1 pw / 1–2 ad |
| **2. 보드 + 토큰 + 건물** | `Board` Pixi 씬, `cacheAsTexture` 정적 보드, 소유 바/건물 스프라이트, 토큰 hop 트윈(squash & stretch) | 정적 상태 스냅샷 == 기존 디자인, draw call ≤ 20 | 1 pw / 2–3 ad |
| **3. 스테이지 + 주사위 + FX** | 회전 스테이지(Container.rotation 400 ms), 주사위 텀블(스프라이트 프레임 or 의사 3D), 컨페티/코인샤워/플로트(스프라이트 풀, 오브젝트 재사용) | 애니메이션 e2e 통과 | 1–1.5 pw / 2–3 ad |
| **4. 통합 + 이벤트 시퀀서** | `GameEvent` → Pixi 애니 큐, DOM 오버레이와 z-순서/입력 라우팅, visibility/컨텍스트 로스트 복구 | 144 vitest + e2e 통과 | 0.5–1 pw / 1–2 ad |
| **5. 성능 게이트 + 출시** | G1–G6 재측정, 회귀 방지용 CI perf 스텝(Chromium trace), AAB 서명 빌드 | 게이트 통과 후 릴리스 | 0.5 pw / 1 ad |

주의: `will-change`/필터/마스크 사용 금지(배치 파괴), 텍스처 해상도는 DPR×보드 크기 기준으로 제한, 앱이 백그라운드로 가면 ticker 정지, WebGL 컨텍스트 로스트 핸들러에서 atlas 재업로드.

### 5.2 (참고) Godot로 이동할 경우의 개요
1. **Phase G0 (1주)**: Godot 4.6/4.7 안정판으로 빈 2D 씬 + Android export(AAB, arm64, target 36) + GitHub Actions headless export + 16 KB 확인 + 실기기 `Engine.max_fps=30`/low-processor 동작·Vulkan vs Compatibility 태블릿 3종 테스트 → No-Go 조건: 드라이버 크래시, 깜빡임.
2. **G1 엔진 포팅 (2–3주)**: TS→GDScript. `mulberry32`와 모든 정수/부동 연산을 골든 벡터(시드별 상태 해시)로 TS와 **비트 단위 동일** 검증. 저장 JSON 스키마 동일 유지(버전 필드 포함) → 기존 세이브 호환.
3. **G2 테스트 (1–2주)**: 144 vitest → GUT 9.x 또는 gdUnit4 [V]. 시뮬레이터 `sim`으로 500 시드 통계 동일 확인.
4. **G3 UI (4–6주)**: 좌석 4방향 `Control`/`SubViewport` 회전 레이아웃, 프롬프트, 한국어 폰트(Noto Sans KR/Jua 서브셋 번들, TextServerAdvanced), 타이틀/설정/규칙.
5. **G4 자산**: SVG 80개 → Godot 임포트(ThorVG [V], 지정 스케일) 또는 사전 래스터 atlas; **오디오 synth → 사전 렌더 OGG**: 기존 `synth.ts` 를 Node/OfflineAudioContext로 실행해 WAV→OGG 변환 스크립트(40–60개 효과음 예상 [K]). 햅틱은 `Input.vibrate_handheld` [V]로 축약(임팩트 스타일 세분화 상실).
6. **G5 i18n**: `ko.ts/en.ts` → JSON/CSV → Godot `TranslationServer`(.po/.csv) 자동 변환 스크립트.
7. **G6 릴리스**: `.github/workflows` 에 Godot 설치(또는 godot-ci 이미지) + Android SDK/JDK17 + 키스토어 시크릿 + `--headless --export-release` [S]; Capacitor 워크플로는 폐기.

---

## 6. 리스크 및 미검증 항목 (스파이크 체크리스트)

| 항목 | 상태 | 검증 방법 |
|---|---|---|
| WebView에서 `setRequestedFrameRate(30f)` / `preferredRefreshRate=30` 이 실제 패널 주사율을 낮추는가 | [K] | 실기기 `dumpsys SurfaceFlinger --latency`, gfxinfo |
| step 양자화된 컴포지터 애니메이션이 값 변화 없는 vsync를 프레젠트하는가 | [K] | `perf` cap phase의 `DrawFrame`/s vs 고유 프레임 |
| Pixi WebGL 캔버스 30 fps 캡의 전력이 DOM 컴포지팅 대비 실제로 낮은가 | [K] | 동일 시나리오 30분, batterystats |
| Godot Android low_processor_mode 깜빡임(현 버전 재현 여부) | [S] | G0 스파이크 |
| Godot 정확한 안정판의 16 KB 정렬 | [K] (NDK 29 사용은 [V] master 기준) | 대상 버전 릴리스 노트/`zipalign -c -P 16` |
| Cocos Creator GitHub Actions 헤드리스 빌드 | [S] | 채택 시 스파이크 |
| Unity Personal 임계/정책 변경 | [S] | 채택 시 unity.com 확인 |
| 각 엔진 APK 크기 수치 | [K]/[S] | 채택 시 실측 |

---

## 7. 참고 자료 (출처)

**[V] 직접 확인**
- PixiJS Ticker 소스(maxFPS/minFPS/stop/autoStart): https://raw.githubusercontent.com/pixijs/pixijs/dev/src/ticker/Ticker.ts
- PixiJS Batcher (maxTextures): https://raw.githubusercontent.com/pixijs/pixijs/dev/src/rendering/batcher/shared/Batcher.ts
- PixiJS SVGParser: https://raw.githubusercontent.com/pixijs/pixijs/dev/src/scene/graphics/shared/svg/SVGParser.ts
- npm 버전/라이선스: https://registry.npmjs.org/pixi.js/latest , https://registry.npmjs.org/phaser/latest , https://registry.npmjs.org/@cocos/creator-types/latest
- Godot `Engine.max_fps`: https://raw.githubusercontent.com/godotengine/godot/master/doc/classes/Engine.xml
- Godot `OS.low_processor_usage_mode*`: https://raw.githubusercontent.com/godotengine/godot/master/doc/classes/OS.xml
- Godot `Input.vibrate_handheld`: https://raw.githubusercontent.com/godotengine/godot/master/doc/classes/Input.xml
- Godot ProjectSettings (배칭, Swappy, Android 드라이버, low_processor_mode): https://raw.githubusercontent.com/godotengine/godot/master/doc/classes/ProjectSettings.xml
- Godot Android 빌드 상수(target 36, NDK 29, JDK 17, AGP 8.13.2): https://raw.githubusercontent.com/godotengine/godot/master/platform/android/java/app/config.gradle
- Godot 메인 루프(has_changed): https://raw.githubusercontent.com/godotengine/godot/master/main/main.cpp ; frame delay: .../core/os/os.cpp
- Godot 2D 배칭 구현: .../servers/rendering/renderer_rd/renderer_canvas_render_rd.cpp
- Godot SVG(ThorVG): .../modules/svg/image_loader_svg.cpp , .../thirdparty/README.md
- Cocos `game.frameRate`, Batcher2D: https://raw.githubusercontent.com/cocos/cocos-engine/v3.8.8/cocos/game/game.ts , .../cocos/2d/renderer/batcher-2d.ts , .../package.json
- GUT: https://raw.githubusercontent.com/bitwes/Gut/main/README.md ; gdUnit4: https://raw.githubusercontent.com/MikeSchulze/gdUnit4/master/README.md
- libGDX 버전: https://raw.githubusercontent.com/libgdx/libgdx/master/gradle.properties
- Android Adaptive refresh rate / `setRequestedFrameRate` / 터치 부스트: https://developer.android.com/develop/ui/views/animations/adaptive-refresh-rate
- Game Mode FPS throttling: https://developer.android.com/games/optimize/adpf/gamemode/fps-throttling
- 16 KB 페이지 크기(마감 2027-02-01, NDK r28+ 기본 정렬, AGP 8.5.1+): https://developer.android.com/guide/practices/page-sizes
- Play target API 요건(2026-08-31 API 36): https://developer.android.com/google/play/requirements/target-sdk
- Unity 16 KB 지원(2021/2022/6): https://developer.android.com/games/engines/unity/unity-on-android
- 이 저장소: `docs/assets/perf-render-baseline.json`, `scripts/perf.mjs`, `scripts/perf-render.mjs`, `android/variables.gradle`, `MainActivity.java`

**[S] 검색 요약 (원문 미열람)**
- PixiJS ticker 가이드(maxFPS, render-on-demand): https://pixijs.com/8.x/guides/components/ticker
- PixiJS BitmapText/Text(CJK 주의): https://pixijs.com/8.x/guides/components/scene-objects/text/bitmap
- Phaser 4 릴리스/렌더러: https://phaser.io/news/2026/04/phaser-4-renderer-faster-cleaner-and-built-for-modern-games , https://phaser.io/news/2026/05/phaser-3-vs-phaser-4
- Cocos Dynamic Atlas/배칭/빌드: https://docs.cocos.com/creator/manual/en/advanced-topics/dynamic-atlas.html , https://docs.cocos.com/creator/3.8/manual/en/editor/publish/google-play/build-example-google-play.html
- Godot Android low-processor 이슈: https://forum.godotengine.org/t/low-power-processor-mode-on-android/77121 ; Godot 4.5.2 유지보수 릴리스: https://godotengine.org/article/maintenance-release-godot-4-5-2/ ; 16 KB: https://forum.godotengine.org/t/godot-and-google-play-policy-warning-about-16-kb-memory-page-size/120934
- Godot TextServer/CJK: https://docs.godotengine.org/ko/4.x/classes/class_textserver.html
- godot-ci: https://hub.docker.com/r/barichello/godot-ci , https://forum.godotengine.org/t/godot-export-to-android-from-command-line-in-ci/20520
- Unity 라이선스: https://unity.com/pricing-updates , https://enginesdatabase.com/blog/state-of-unity-licensing-in-2026/
- Flutter Impeller(2차 자료, 신뢰도 낮음): https://ecorpit.com/impeller-mandatory-flutter-android-ios-2026/
- Defold 크기: https://defold.com/manuals/optimization-size , https://github.com/britzl/dmengine_size
- CSSWG 저프레임레이트 미디어 피처 논의: https://lists.w3.org/Archives/Public/public-css-archive/2025Aug/0746.html

**[K]** 배경 지식으로 기재한 항목: 각 옵션의 APK 크기 범위, 공수 견적, Pixi draw call 예상치, WebGL vs DOM 전력 비교, Unity `OnDemandRendering`/GameCI 특성, Flutter 프레임 스케줄링, Defold `sys.set_update_frequency` 등. 채택 결정 전 스파이크로 반드시 검증할 것.

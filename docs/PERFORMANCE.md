# 성능 (Performance)

랏앤롤(Lot & Roll)의 렌더링·배터리 성능 작업 문서. 목표는 제품 책임자의 수용 기준 A–D:
**(A) 30 fps 상한**, **(B) 유휴 시 부하 0**, **(C) 레이어/페인트 위생과 프레임 예산**, **(D) `npm run perf` 게이트**.

## 1. 결과 요약 (`npm run perf -- --full --unique`, 2026-09-30)

| 결과 | 게이트 | 값 |
|---|---|---|
| PASS | A 절전 모드 ON 표시 fps (스로틀 없음) 26–34 | **32.1 fps** (고유 프레임 30.1/s) |
| PASS | A 절전 모드 OFF 표시 fps (스로틀 없음) ≥ 55 | 58.4 fps |
| PASS | B 유휴 0 — 게임(사람 4명, 굴림 대기, 타이머 끔) 10 s | Layout 0 · Paint 0 · Raster 0 · style 0 · rAF 0 · timer 0 · layerPainted 0 · 태스크 20 ms |
| PASS | B 유휴 0 — Title 10 s | 전부 0 · 태스크 1 ms |
| PASS | B 유휴 0 — Result 10 s | 전부 0 · 태스크 1 ms |
| PASS | B 장식 루프는 합성기 전용(게임/Title/Result 첫 7 s) | Layout/Paint/Raster/layerPainted 0 |
| **FAIL** | C 프레임 p99 ≤ 20 ms (4×, 처음 2 s 제외) | 33.4 ms (60 s 중 20 ms 초과 74프레임 ≈ 2 %) |
| **FAIL** | C 33 ms 초과 프레임 0 (4×) | 31프레임 (최대 167 ms) |
| PASS | C 마운트 레이아웃 ≤ 100 ms (4×) | 69 ms (3회 중앙값) |
| PASS | C 피크 레이어 ≤ 20 | 17 (중앙값 10) |
| PASS | C 중앙값 레이어 ≤ 25 | 10 |
| PASS | C 피크 레이어 메모리 ≤ 100 MB | 89.2 MB |
| PASS | C Paint ≤ 20/s (4× 플레이) | 17.8/s |
| PASS | C 강제 레이아웃 ≤ 50 ms (플레이 중) | 최대 Layout 9.7 ms |
| PASS | C 부팅 → Title 표시 ≤ 1.5 s (4×) | 258 ms |
| PASS | C DOM 상한 (게임 전체, 최대/최소 ≤ 1.3) | 1,422–1,780 노드 / 9라운드 |

**16/18 통과.** 미달 2건(4× 스로틀 프레임 지연)은 7절 참고.

30 fps 상한 ON/OFF 비교 (CPU 데모 게임, 스로틀 없음, 30 s):

| | ON (절전) | OFF |
|---|---|---|
| 표시 프레임/s (DrawFrame) | 32.1 | 58.4 |
| 고유 프레임/s (스크린캐스트 해시) | 30.1 | 55.2 |
| 메인 스레드 태스크 ms/s | 53.9 | 68.2 |
| Paint/s | 18.7 | 22.3 |
| RasterTask/s | 80.4 | 83.4 |
| 스타일 재계산/s | 29.4 | 29.0 |
| rAF 콜백/s | 26.7 | 24.1 |

## 2. 측정 방법론

- **환경**: Playwright + Chromium 141 헤드리스(소프트웨어 합성), 1600×1000 뷰포트, DPR 2, CDP CPU 스로틀 4×
  ("중급 태블릿"), 게이트에 "스로틀 없음"이라 적힌 항목만 1×. CPU 데모 게임은 시드 고정(`20260929`)이라 매 실행 동일한 게임.
- **표시 fps**: 렌더러 합성기 `DrawFrame` 트레이스 이벤트 수 / 초. 보조 지표로 `Page.startScreencast` 프레임을 해시해
  **내용이 바뀐 프레임만** 센 "고유 프레임/s"(`--unique`).
- **유휴 0 (B)**: 사람 4명 게임의 굴림 대기(타이머 끔), Title, Result 각각 — 장식 루프가 도는 첫 7 s("decorative")와,
  루프가 끝난 뒤(마지막 입력 ~10 s 후) 10 s("calm") 두 창. 트레이스의 `Layout`/`Paint`/`RasterTask`/`UpdateLayoutTree`/
  `FireAnimationFrame`/`TimerFire` 수, `LayerTree.layerPainted` 이벤트 수, `Performance.getMetrics`의 `TaskDuration` 증가분.
- **프레임 시간 (C)**: 4× 스로틀 CPU 데모 60 s, 게임 시작 2 s 뒤부터 rAF 간격(p50/p95/p99/최대, 33 ms 초과 수).
- **레이어 (C)**: 4× CPU 데모 40 s 동안 `LayerTree.layerTreeDidChange` — 레이어 수 중앙값/피크, 피크 메모리 =
  그리는(drawsContent) 레이어의 w×h×4×DPR² 합. 같은 창의 트레이스로 Paint/s, RasterTask/s, 최대 `Layout`.
- **마운트 (C)**: Title → 게임 화면 전환 중 가장 긴 단일 `Layout` (3회 중앙값).
- **DOM (C, `--full`)**: 스로틀 없이 4배속으로 게임 한 판 전체, 라운드마다 `document.querySelectorAll('*').length`.
- 세부 레이어 보고서(레이어별 크기·합성 이유·리페인트 횟수, SVG 중복, 효과 목록)는 `scripts/perf-render.mjs`
  (`npm run perf:render`) — 기준선 `docs/assets/perf-render-baseline.json`, 작업 후 `docs/assets/perf-render-after.json`.

## 3. 전/후 비교 (4× 스로틀, DPR 2)

| 항목 | 기준선 (작업 전) | 작업 후 |
|---|---|---|
| 플레이 중 레이어 수 (중앙값 / 피크) | 36 / 58 | **10 / 17** |
| 플레이 중 피크 레이어 메모리 | 138 MB | **89 MB** |
| Title 레이어 / 메모리 | 28 / 173 MB | 19 / 60 MB (첫 ~10 s), 이후 5 / 24 MB |
| Paint / Raster (플레이) | 61/s / 143/s | **17/s / 80/s** |
| 표시 프레임 (플레이, 4×) | 58/s | 32/s (상한 30 + 7절의 잔여 이중 그리기) |
| 롱 태스크 | 44건 (100 ms 초과 29, 최대 630 ms) / 120 s | 3건 (최대 81 ms) / 60 s |
| 100 ms 초과 프레임 | 28 | 50 ms 초과 5, 최대 167 ms |
| 유휴(사람 차례 대기) | 합성기 30 fps 상시 + 장식 애니메이션 | 10 s 뒤 완전 정지 (프레임 0) |
| DOM | 1,360 → 1,872 (16턴) | 1,383 → 1,634 (8턴), 게임 전체 최대 1,780 |
| 부팅 → Title | ≈ 6 s | **0.26 s** |
| 글꼴 전송 | Google 분할 ~100조각 × 4면 | 서브셋 4개 860 KB(KS X 1001 2,350자 포함) + 필요 시 폴백 조각 |

## 4. 변경 사항

### 4.1 30 fps 상한 (A)
- `src/ui/fx/time.ts` — 공용 30 Hz 클럭(`onFrame`: rAF 루프 1개, 등록된 스텝이 없으면 정지), 수면(`sleep`)·`gridTimeout`도 격자 프레임에서 깨어남.
  vsync 사이 중간에 격자선을 두는 위상 고정. 클럭이 슬롯의 첫 vsync를 놓치면 다음 슬롯까지 대기(격자 밖 프레임 방지).
- `src/ui/fx/quantize.ts` — `anim()`(Web Animations)의 키프레임을 30 Hz 계단(`step-end`)으로 샘플링, 시작 시각을 격자에 정렬.
  CSS 애니메이션/전환은 `animationstart`/`transitionstart`에서 `steps(n)` 타이밍으로 양자화.
- 모든 애니메이션 경로가 이 클럭/래퍼를 사용: 토큰 홉·점프(WAAPI), 주사위(캔버스, `onFrame`), 돈 카운트업(`onFrame`, ≈10 Hz 갱신),
  파티클(캔버스, `onFrame`), 떠오르는 금액/토스트/도장/카드 뒤집기/흔들기/메뉴/결과 히어로(`anim`), 스테이지 회전(`anim`, 이제
  `smooth` 없이 30 Hz — 60 Hz 회전 하나로 표시율이 ~36 fps까지 올라갔음), 타이머 링(CSS `lr-timer`, 이벤트 양자화),
  알림·게임 종료 전환(`gridTimeout`).
- 설정 **"절전 모드 (30fps)"** 기본 ON, 즉시 적용(`prefs.onChange` → `setFrameRate` + 네이티브 `FrameRate` 플러그인).
- Android: `MainActivity`가 `preferredRefreshRate = 30f`, API 35+에서 WebView `View.setRequestedFrameRate(30f)`
  (`Build.VERSION_CODES.VANILLA_ICE_CREAM` 가드, compileSdk 36). 절전 모드를 끄면 둘 다 "선호 없음"으로(`FrameRatePlugin`).

### 4.2 유휴 부하 0 (B)
- `src/ui/fx/ambient.ts` — 스타일시트의 `infinite` 장식 애니메이션(Title 떠다니는 아이콘·로고, 턴 링 펄스, 굴림 버튼 펄스, 규칙
  삽화 …)을 시작 시 반복 횟수로 제한해 **마지막 입력 ~10 s 뒤 정지**(타이머 없음). 짧은 루프는 반복 경계(=정지 자세)에서,
  4 s보다 긴 드리프트는 그 자리에서 `fill: forwards`로 멈춤. `pointerdown`/`keydown`이면 다시 10 s.
- 남은 장식 루프는 모두 opacity/transform(합성기 전용, 리페인트 0). 굴림 버튼 펄스는 opacity만(스케일 링은 버튼의 오버플로로
  잡혀 e2e "English text fits" 실패를 만들던 회귀도 수정).
- 제거/정적화: Title 광선 90 s 회전(34 MB 레이어), 보드 "한 칸 남음" 링 펄스, 세트 슬롯 missing 펄스(→ 점선 테두리),
  CPU "생각 중"/CPU 카드 깜빡임·레벨 아이콘 바운스, 턴 링 펄스는 사람 차례에만.

### 4.3 레이어·페인트 위생 (C)
- 주사위: CSS 3D(preserve-3d, 면마다 레이어 → 16개) → 정지 상태는 **정사영 2D 큐브**(면마다 2D `matrix()`), 굴림은
  두 주사위를 **캔버스 1장**(소프트웨어 캔버스, 1×, 미리 그린 면 스프라이트)에.
- 파티클: 파티클마다 DOM+레이어(최대 80) → 효과당 임시 캔버스 1장(경계 상자 크기).
- `html/body/#app/.game/.result/.fx-layer`의 `position: fixed` 제거(전체화면 fixed 상자 겹침이 24 MB 오버랩 레이어를 만듦).
- 진입 애니메이션 `fill: both` → `backwards`(끝난 뒤에도 레이어 유지되던 문제).
- `.stage { contain: layout paint }`, 패널은 `container-type: size`(크기·레이아웃·스타일 격리) — 패널 그림자/글로우는 카드 아래
  (z-index −1)로, 번짐은 패널–보드 간격(14 px) 안으로. 애니메이션 요소(워시, 턴 링, 더블 글로우)는 내용 위에 그려 오버랩 레이어 방지.
- 토큰 위치 `left/top` → `translate`(이동 시 리페인트 0). `.st-dice` 축소 전환·패널 턴 크로스페이드·토큰 `scale` 전환 제거.
- 패널 `update`는 바뀐 슬롯/배지/텍스트만 갱신. 아이콘 SVG는 파싱한 템플릿을 복제.
- `.pp-sets .slot*`의 box-shadow → outline.
- 가장자리 "한 칸 남음" 알림(좌석별 4장): 페이드 없이 표시/제거(4장 동시 레이어가 턴 중 최악의 순간이었음).

### 4.4 부팅·글꼴
- 앱 글꼴 4면(Jua 400, Noto Sans KR 400/700/900)을 **하나의 woff2씩** 서브셋(`scripts/subset-fonts.py`):
  UI 소스의 모든 문자 + Latin/기호 + 한글 호환 자모 + **KS X 1001 완성형 2,350자**(이름 입력의 사실상 전부). `index.html`이 preload,
  `main.ts`가 첫 화면 전에 로드(최대 1.2 s) → 플레이 중 글꼴 교체(전체 재레이아웃) 없음.
- 나머지 음절(11,172 − 2,350)은 **원본 Google Fonts 분할 조각이 폴백 `@font-face`**(`'Jua Fallback'`, `'Noto Sans KR Fallback'`,
  `unicode-range`)로 남아 있어 필요한 조각만 지연 로드 — 사용자가 입력한 어떤 한글 이름도 렌더링됨.
  `src/ui/shell/__tests__/fonts.test.ts`가 (1) 소스의 모든 문자가 서브셋에 있는지, (2) 폴백이 가중치별 11,172자 전부를 덮는지,
  (3) 글꼴 스택 순서를 검사. (작업 중 발견: 절전 모드 문구의 "애/션/껴"가 서브셋에 없었음 → 재생성.)

## 5. 재실행 방법

```sh
npm run perf                       # 빌드 + 게이트(boot, idle, cap, play, layers, mount) ≈ 5분, PASS/FAIL 표 출력
npm run perf -- --full --unique    # + 게임 전체 DOM, 스크린캐스트 고유 프레임
node scripts/perf.mjs --phases idle,cap --json out.json   # 일부만 (먼저 `npx vite build`)
npm run perf:render                # 레이어별 상세 보고서 (docs/assets/perf-render-baseline.json 형식)
```
Playwright 모듈/Chromium 경로는 `PLAYWRIGHT_MODULE`/`CHROMIUM_PATH`로 바꿀 수 있음(기본: `/opt/node22/lib/node_modules/playwright`,
`/opt/pw-browsers/chromium`). 게이트 하나라도 실패하면 종료 코드 1. 글꼴 서브셋 재생성은 `scripts/subset-fonts.py` 머리말 참고.

## 6. Android 주사율 주의사항

- `preferredRefreshRate`와 `setRequestedFrameRate`는 **힌트**다. 30 Hz(또는 60의 약수) 모드가 없는 패널은 무시하고 60/90/120 Hz로
  계속 돈다 — 그래도 웹 레이어가 ~30개의 고유 프레임만 만들기 때문에 GPU/CPU 작업은 줄지만, 디스플레이 자체의 전력 절감은 없다.
- 제조사 "게임 모드"/게임 부스터(삼성 Game Booster 등)나 시스템 절전 정책이 주사율·CPU 클럭을 **더 낮게** 제한할 수 있다
  (예: 게임 앱을 30 fps로 강제). 이 경우 애니메이션은 여전히 30 Hz 격자 기준이라 영향이 적다.
- API 35 미만에서는 창 단위 `preferredRefreshRate`만 적용된다. 로컬에 Android SDK가 없어 이번 작업의 Java 변경은 API 스텁으로
  `javac` 타입 검사만 했다 — 실제 기기에서 `adb shell dumpsys SurfaceFlinger`(현재 모드) 확인 권장.

## 7. 남은 비용과 미달 항목

- **4× 스로틀 프레임 지연 (C: p99 ≤ 20 ms, 33 ms 초과 0) — 미달.** 60 s CPU 데모에서 rAF 간격 20 ms 초과가 ~70프레임(2 %),
  33 ms 초과가 13–31프레임(실행마다 편차 큼). 남은 긴 프레임은 CPU가 행동할 때마다 한 번씩: 새 프롬프트 카드 생성(아이콘 SVG
  포함 50–230개 요소) + 스타일 10–30 ms + 레이아웃 5–10 ms + 페인트/레이어화 5–15 ms(4× 기준). JS 자체는 30 s 중 ~1.3 s로
  작고(CPU 프로파일), 대부분 Blink 렌더링 비용. 시도했으나 효과 없던 것: 아이콘을 SVG `<img>`로(각 이미지가 SVG 문서라 더 느림),
  이동 중 토큰 `will-change`. 다음 후보: CPU 차례 프롬프트 카드를 가볍게(요약 카드), 보드 SVG(951개 요소)를 캔버스/이미지로
  고정 렌더링해 레이어화 비용 감소, 프롬프트 DOM 사전 생성 풀.
- **표시 프레임 32/s (> 30)**: 새 합성 애니메이션이 시작될 때 Chromium이 다음 프레임에 `notifyCompositorAnimationStarted`
  커밋을 한 번 더 하고, 래스터가 늦은 메인 프레임 내용이 합성기 계단 펄스와 다른 vsync에 그려지는 경우가 남아 있다.
  고유 프레임 기준으로는 30.1/s. 30 Hz 모드가 있는 실제 기기에서는 디스플레이가 이를 합친다.
- 플레이 중 레이어 피크 17 중 5개는 Chromium 기본(뷰포트/루트 스크롤러). `.token-layer`/`.st-toasts`는 아래에서 애니메이션이
  돌 때만 오버랩 레이어로 승격된다(상시 승격 아님).
- 주사위 굴림·파티클 캔버스는 소프트웨어 캔버스(1×): GPU 없는 WebView에서 가속 캔버스는 커밋마다 업로드 대기(15–50 ms)를
  만들었다. 대가로 굴리는 동안(≈0.9 s) 해상도가 1×.
- DOM은 소유 부동산(건물 아이콘·핍)에 비례해 증가(게임 전체 1,422 → 최대 1,780)하고 반복 누수는 없다.

## 8. 작업 로그 (단계별)

컨테이너 재시작에 대비해 단계마다 커밋하며 남긴 기록. 이전 에이전트가 이미 커밋한 작업:
`155e99a` 렌더 비용 측정 스크립트(`scripts/perf-render.mjs`)와 기준선, `eabce4e` 30 Hz 클럭·패널/레이어 페인트 수정·글꼴 서브셋·
Android `preferredRefreshRate`·절전 모드 토글, `b29a2d4` 30 Hz 계단식 Web Animations 래퍼(`quantize.ts`) + 테스트.

- **1단계** — 이 로그 파일 생성, `npm run perf` 스크립트 등록. typecheck / test(151) / build 통과 확인.
- **2단계** — 측정 재확인(현 상태): idle B는 메인 스레드 기준 이미 통과(0 Layout/Paint/Raster)지만
  Title/게임/Result 모두 합성기(compositor)가 무한 장식 애니메이션 때문에 ~30 DrawFrame/s를 계속 그림.
  cap: 절전 on 34.5 fps(목표 26–34 초과), off 59.2 fps. play(60 s): p99 16.8 ms, 33 ms 초과 프레임 26개, 최대 133 ms.
  → `src/ui/fx/ambient.ts` 추가: 스타일시트의 `infinite` 장식 애니메이션을 시작 시점에 반복 횟수로 제한해
  마지막 입력 후 ~10 s에 끝나게 함(짧은 루프는 반복 경계=정지 자세, 4 s 초과 느린 드리프트는 `fill: forwards`로 자세 유지).
  타이머 없음. pointerdown/keydown 시 다시 10 s 연장(끝난 것은 멈춘 자리에서 재개). `lr-shake`(주사위 흔들기)는 제외.
- **3단계** — 주사위를 CSS 3D(preserve-3d, 면마다 GPU 레이어 → 주사위 2개에 레이어 16개)에서
  **정사영 2D 큐브**로 교체(`src/ui/stage/Dice.ts` `cubeFaces`): 각 면을 2D `matrix()`로 투영하고 뒷면은 숨김,
  옆면은 법선에 따라 살짝 어둡게. 굴림 중 회전은 공용 30 Hz 클럭(`onFrame`)으로 갱신, 튀어오름은 기존 WAAPI.
  대기 화면 레이어 31 → 12(장식 애니메이션 정지 후 6), 레이어 메모리 103 → 99 MB(정지 후 49 MB).
- **4단계** — 파티클(색종이/동전 비/동전 호)을 DOM 노드 + WAAPI(파티클마다 GPU 레이어, 동전 호 1회에 +8,
  색종이 +76)에서 **효과당 임시 `<canvas>` 1개**로 교체(`src/ui/fx/particles.ts`). 30 Hz 클럭에서 그리며,
  캔버스는 효과의 경계 상자 크기(전체 화면 색종이는 1× 해상도), 마지막 파티클이 끝나면 제거. 캔버스 갱신은 문서 Paint를 만들지 않음.
- **5단계** — 레이어/프레임 정리:
  - `html/body/#app/.game/.result/.fx-layer`의 `position: fixed` 제거(→ 100% 높이 + absolute). 겹친 전체화면 fixed 상자가
    각각 뷰포트 크기 레이어 + 그 위 전체를 담는 "Overlap" 레이어(DPR 2에서 장당 24 MB)를 만들고 있었음. 대기 화면 6 → 5 레이어, 49 → 24 MB.
  - 진입 애니메이션(screen-in, logo-in, words-in, menu-in, seat-in, step-in, dlg-pop, toast-in …)의 `fill: both` → `backwards`
    (끝난 뒤에도 효과가 남아 레이어가 유지되던 문제). Title 레이어 23 → 19, 97 → 60 MB.
  - Title 광선(`.title-rays`, 150vmin 정사각형) 90 s 회전 제거: 34 MB짜리 합성 레이어였음.
  - 스테이지 회전도 30 Hz 격자 위로(`smooth: true` 제거), `fitDice`를 bare rAF → 공용 클럭,
    끝난 애니메이션을 기다리던 코드가 시작한 CSS 전환도 같은 프레임에서 양자화(`requestCssSweep`),
    클럭이 슬롯의 첫 vsync를 놓치면 다음 슬롯까지 대기(격자 밖 프레임 방지).
  - 진단: 격자 밖(off-grid) DrawFrame의 대부분은 DOM 변경이 아니라 **래스터 지연**(메인 프레임 커밋이 다음 vsync에 활성화)임을
    트레이스(`ActivateSyncTree`)로 확인 → Paint/래스터 감소가 곧 fps 상한 준수의 열쇠.
- **6단계** — 플레이 중 Paint/레이어 절감 (4× 스로틀, CPU 데모 30 s: Paint 43.9 → 18.9 /s, 피크 레이어 27 → 20~21, 최대 레이어 메모리 147 → ~91 MB):
  - 주사위 굴림: 두 주사위의 텀블 + 튀어오름 + 접지 그림자를 **캔버스 1장**에 그림(굴리는 동안 레이어 1개, 문서 Paint 0).
  - 토큰 위치를 `left/top` → `translate` 속성으로(이동 = 변환 변경, 리페인트 없음).
  - 돈 카운트업: 30 Hz 중 3틱마다(≈10 Hz) 갱신 + 색상은 트윈 안에서(별도 800 ms 메인스레드 색상 애니메이션 제거).
  - `.st-dice` 축소 전환 제거(프롬프트마다 레이어 승격/강등 + 리페인트), 패널 턴 글로우 크로스페이드 제거(즉시 전환).
  - `.stage`에 `contain: layout paint`(회전 중 모서리가 패널 그림자와 겹쳐 양쪽 패널 전체가 1600 px 오버랩 레이어가 되던 문제).
  - 패널 그림자/글로우(`.pp::before/::after`)를 카드 아래(z-index −1)로, 번짐을 패널–보드 간격(14 px) 안으로.
  - 상시 장식 애니메이션 정리: 보드 "한 칸 남음" 링, 세트 슬롯 missing 펄스(→ 점선 테두리), CPU "생각 중" 깜빡임, CPU 카드의 레벨 아이콘 바운스 → 정적.
    더블 금빛 글로우·패널 턴 링은 내용 위(z-index)로 올려 오버랩 레이어 방지. 가장자리 알림(좌석별 4장) 페이드 제거.
  - `.pp-sets .slot*`의 box-shadow → outline(랜드마크 글로우, 축제 점).
- **7단계** — 프레임 상한 정밀화: 격자 밖 프레임의 원인을 트레이스로 추적. (1) 새 합성 애니메이션의 `notifyCompositorAnimationStarted`
  왕복 커밋, (2) 메인 프레임 내용 활성화 지연과 합성기 계단식 펄스가 서로 다른 vsync에 그려지는 경우. CPU 턴의 패널 턴 링 펄스를
  사람 차례에만 두어(CPU 차례는 정적 글로우) 1× CPU 데모 기준 DrawFrame 34.6 → 31.8 /s, 고유 프레임(스크린캐스트 해시) 29.9 /s.
- **8단계** — `scripts/perf.mjs`를 제품 책임자 게이트 그대로 재작성(PASS/FAIL 표 + 상한 on/off 비교표, `--full`, `--unique`,
  미리보기 서버 프로세스 그룹 정리). 첫 실행: 17개 중 15개 통과(실패: 4× 프레임 p99 33.3 ms, 33 ms 초과 프레임 21개).
  - Android: `FrameRatePlugin`(설정 토글 → 네이티브 즉시 반영), API 35+에서 WebView `setRequestedFrameRate(30f)`
    (`Build.VERSION_CODES.VANILLA_ICE_CREAM` 가드, compileSdk 36). 로컬 SDK가 없어 API 스텁으로 javac 타입 검사만 수행.
  - 글꼴: 서브셋 이후 추가된 UI 문자(절전 모드 문구의 "애/션/껴")가 서브셋에 없던 문제 발견 → 재생성. 서브셋에
    KS X 1001 완성형 2,350자 포함(이름 입력 대부분을 선로딩 글꼴로), 나머지 음절은 기존 Google 분할 폴백(11,172자 전부)으로.
    `src/ui/shell/__tests__/fonts.test.ts`가 둘 다 검사.
- **9단계** — 4× 스로틀 프레임 지연(jank) 절감 (60 s CPU 데모: 20 ms 초과 프레임 79 → 42, 33 ms 초과 22 → 13, 최대 200 → 133 ms):
  - 매 클럭 프레임마다 `document.getAnimations()`로 CSS 애니메이션을 훑던 `postTick` 제거(강제 스타일 플러시로 4×에서 8–16 ms/프레임,
    30프레임에 새 CSS 애니메이션 ~1개꼴). CSS 애니메이션은 animationstart/transitionstart 이벤트에서 양자화.
    토큰의 `scale` 전환(홉마다 새 CSS 전환 시작) → 즉시 변경.
  - 주사위/파티클 캔버스: 소프트웨어 캔버스(`willReadFrequently`) + 1× 해상도 + 미리 그린 면 스프라이트(`drawImage` 아핀 변환)
    + 더티 영역만 지우기. 가속 캔버스는 GPU 없는 환경에서 커밋마다 업로드 대기(15–50 ms)를 만들었음.
  - 패널 `update`: 28개 세트 슬롯·배지·텍스트를 바뀐 것만 갱신(돈 변화마다 패널당 ~250개 요소 재스타일/재배치하던 문제).
- **10단계** — e2e 회귀 수정: 굴림 버튼 펄스(이전 에이전트가 box-shadow → `scale` 변환으로 바꾼 것)가 버튼의 스크롤 오버플로로
  잡혀 "English text fits" 테스트 2건 실패 → 불투명도만 페이드. 알림(`notice`)·게임 종료 전환 타이머를 `gridTimeout`으로(30 Hz 격자).
  시도 후 되돌림: 풀컬러 아이콘을 SVG 데이터 URL `<img>`로(요소 수 229 → 48) — SVG 이미지 문서마다 스타일/레이아웃/페인트가
  돌아 오히려 느려짐.
- **11단계** — 아이콘 SVG 마크업을 매번 파싱하지 않고 파싱된 `<template>`을 복제(`svgNode`). 4× 프레임 지표는 실행 간
  편차(±10프레임) 안이라 효과 불분명하나 프롬프트 생성 JS 비용은 감소.
- **12단계** — 최종 측정(`npm run perf -- --full --unique`: 16/18 통과), `docs/assets/perf-render-after.json`,
  이 문서 정리, 전체 Playwright 스위트 실행.

# 성능 (Performance)

랏앤롤(Lot & Roll)의 렌더링·배터리 성능 작업 문서. 목표는 제품 책임자의 수용 기준 A–D:
**(A) 30 fps 상한**, **(B) 유휴 시 부하 0**, **(C) 레이어/페인트 위생과 프레임 예산**, **(D) `npm run perf` 게이트**.

## 1. 결과 요약 (`npm run perf -- --full --unique`, 2026-09-30, 2라운드 후)

| 결과 | 게이트 | 값 |
|---|---|---|
| PASS | A 절전 모드 ON 표시 fps (스로틀 없음) 26–34 | **30.6 fps** (고유 프레임 28.9/s) |
| PASS | A 절전 모드 OFF 표시 fps (스로틀 없음) ≥ 55 | 58.0 fps |
| PASS | B 유휴 0 — 게임(사람 4명, 굴림 대기, 타이머 끔) 10 s | Layout 0 · Paint 0 · Raster 0 · style 0 · rAF 0 · timer 0 · layerPainted 0 · 태스크 4 ms |
| PASS | B 유휴 0 — Title 10 s | 전부 0 · 태스크 0 ms |
| PASS | B 유휴 0 — Result 10 s | 전부 0 · 태스크 2 ms |
| PASS | B 장식 루프는 합성기 전용(게임/Title/Result 첫 7 s) | Layout/Paint/Raster/layerPainted 0 |
| **PASS** | C 프레임 p99 ≤ 20 ms (4×, 처음 2 s 제외) | **16.8 ms** (1라운드 후 33.4 ms) |
| **FAIL** | C 33 ms 초과(= vsync 2회 초과) 프레임 0 (4×) | 최종 실행 7프레임, 전부 ≤ 50 ms(= vsync 3회). 같은 날 반복 실행 0–7(대개 1–4). 같은 조건 **빈 페이지 0–2**(7절) |
| PASS | C 마운트 레이아웃 ≤ 100 ms (4×) | 58.9 ms (3회 중앙값) |
| PASS | C 피크 레이어 ≤ 20 | 18 (중앙값 12) |
| PASS | C 중앙값 레이어 ≤ 25 | 12 |
| PASS | C 피크 레이어 메모리 ≤ 100 MB | 97 MB |
| PASS | C Paint ≤ 20/s (4× 플레이) | 17.2/s |
| PASS | C 강제 레이아웃 ≤ 50 ms (플레이 중) | 최대 Layout 9.1 ms |
| PASS | C 부팅 → Title 표시 ≤ 1.5 s (4×) | 367 ms |
| PASS | C DOM 상한 (게임 전체, 최대/최소 ≤ 1.3) | 1,683–1,885 노드 / 9라운드 (비율 1.12, 숨긴 아이콘 스프라이트 ~1,400 포함) |

**17/18 통과.** 1라운드 후 미달 2건 중 p99는 통과. "33 ms 초과 0"은 남은 프레임이 모두 vsync 3회(50 ms) 이하이고 이 VM의
빈 페이지 바닥값과 같은 규모라 이 환경에서는 안정적으로 0이 되지 않는다(4.5·7절). 측정 하네스 수정 2건(강제 GC가 기록되던 문제,
0.1 ms 양자화로 한 번 놓친 vsync가 섞여 세이던 문제)은 4.5절.

30 fps 상한 ON/OFF 비교 (CPU 데모 게임, 스로틀 없음, 30 s):

| | ON (절전) | OFF |
|---|---|---|
| 표시 프레임/s (DrawFrame) | 30.6 | 58.0 |
| 고유 프레임/s (스크린캐스트 해시) | 28.9 | 53.9 |
| 메인 스레드 태스크 ms/s | 52.5 | 61.5 |
| Paint/s | 17.9 | 21.6 |
| RasterTask/s | 49.9 | 56.4 |
| 스타일 재계산/s | 28.9 | 28.9 |
| rAF 콜백/s | 26.6 | 24.1 |

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

### 3.1 2라운드 전/후: 4× 프레임 지연 (4.5절)

`node scripts/perf.mjs --phases play`(60 s) 여러 번의 범위. "vsync 2회 초과"는 수정된 기준(`> 34 ms`), 괄호는 기존 `> 33.4` 방식.

| 항목 | 2라운드 시작 | 2라운드 후 |
|---|---|---|
| 프레임 p99 | 33.3–33.4 ms | **16.8 ms** |
| 20 ms 초과 프레임 (= vsync 1회 놓침) / 60 s | 61–74 | 16–35 |
| vsync 2회 초과 프레임 / 60 s | (22–31) | **0–7**, 대개 1–4 (기존 방식 2–15) |
| 최대 프레임 | 150–300 ms(대부분 하네스 강제 GC, 4.5) | 50–83 ms (한 번 117 ms, 메인 스레드 유휴 구간) |
| 빈 페이지 바닥값(같은 조건) | — | vsync 2회 초과 0–2, 최대 33–83 ms |
| 프롬프트 카드 DOM 요소 (구매 / 건설 / 굴림 / 무인도) | 222 / 60 / 12 / 45 | **49 / 30 / 5 / 22** (스프라이트만: 57 / 32 / 6 / 24) |
| 구매 카드가 나타나는 프레임의 스타일 재계산 | 221 + 346 요소 (강제 1회 + 프레임 1회, 대부분 `<use>` 그림자 트리) | 아이콘 = 요소 1개(그림자 트리 없음), 강제 재계산 원인(`measureDice`) 제거 |
| 보드 하위 요소 | 1,174 | **~190** (스프라이트만: 382) |
| 루트 레이어 래스터 (4×, CPU 데모) | 3.2 s / 25 s | 0.6–0.75 s / 25–30 s |
| Paint (4× 플레이) | 17.8/s | 17.3–17.9/s |
| 피크 레이어 / 메모리 | 17 / 89 MB | 18 / 97 MB |
| 게임 전체 DOM (`--full`) | 1,422–1,780 | 1,680–1,872 (숨긴 스프라이트 ~1,400 요소 상수 포함, 비율 1.11) |

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

### 4.5 2라운드: 4× 프레임 지연 (아이콘 스프라이트·아틀라스, 보드 정적 래스터화, 레이어 2개, 프롬프트 지연)

4× 스로틀 트레이스로 긴 프레임을 다시 분해한 결과, 원인은 "프롬프트 카드 JS"가 아니라 **렌더링**이었다:
(1) 새 카드의 스타일·레이아웃·페인트(아이콘마다 `<use>`/SVG 도형 20–40개), (2) **루트 레이어 래스터** — 카드·배너·토큰이
바뀔 때마다 그 타일 전체(보드 SVG 950개 도형 + 텍스트 포함)를 다시 그림(4×, 25 s에 3.2 s), 커밋이 이 래스터를 기다리며 메인
스레드가 15–35 ms 멈춤(`LayerTreeHost::WaitForCommitCompletion`), (3) 한 프레임에 이벤트 DOM 변경과 새 프롬프트가 겹침.

- **아이콘 심볼 스프라이트** (`src/content/icons/index.ts`): 부팅 후 첫 `icon()` 호출 때 숨긴 `<svg id="lr-icon-sprite">` 하나에
  아이콘마다 `<symbol id="i-<id>" viewBox="…">`를 넣고, `icon(id)`는 `<svg viewBox><use href="#i-<id>"/></svg>`만 반환.
  UI 아이콘의 루트 속성(fill/stroke)은 심볼 안 `<g>`로 옮김. `currentColor`는 `<use>` 그림자 트리가 참조 `<svg>`의 `color`를
  상속하므로 그대로 동작(토큰·건물 색 확인). 이미지/캔버스용 원본은 `iconMarkup(id)` / `svgArt(id)`(파티클 동전).
  → 구매 카드 DOM 요소 222 → 57, 보드 하위 1,174 → 382. **단, Blink는 `<use>`마다 심볼을 그림자 트리로 복제하므로 스타일·
  레이아웃 대상 요소 수는 거의 그대로**(구매 카드 프레임 스타일 재계산 346개) — 프레임 시간 효과는 측정 편차 안.
- **아이콘 비트맵 아틀라스** (`src/ui/game/iconAtlas.ts`, 실제 "텍스처 아틀라스"): 게임 시작 시 카드·배지·보드에서 쓰는 아이콘
  (도시/허브/코너/특수 칸 30종, 동전, 주사위 눈, 플레이어 색 토큰, 건물 × {--ink, --ink-3, 플레이어 색})을 **PNG 한 장**에
  셀 단위로 그림(SVG 이미지 → 캔버스 → `toBlob`, 셀 = 가장 큰 카드 아이콘 × DPR, 셀마다 2 px 여백). `iconEl()`/`tokenBadge()`는
  아틀라스에 있으면 `<i class="ic-bm">`(인라인 background-image/size/position) 요소 1개, 보드의 소유 칸은 셀로 잘린 SVG `<image>`
  (`<svg viewBox=셀><image href=아틀라스/></svg>`). 준비 전·없는 아이콘은 스프라이트로 대체. 틴트가 정해지지 않은 `currentColor`
  아이콘(버튼 안 UI 아이콘 등)은 스프라이트 유지. → 구매 카드 DOM 49개, 그림자 트리 0. 픽셀 비교: 구매 카드 914k 픽셀 중
  453개(가장자리 안티앨리어싱)만 차이.
- **보드 정적 래스터화** (`Board.rasterizeBase`, "머티리얼 인스턴스"에 해당): 보드 면·림·32칸을 "아무것도 없는" 상태(배경, 색 띠,
  가격, 아이콘, 이름)로 보드 크기 × DPR(최대 3, 4096 px) 비트맵에 한 번 그림 — 도형은 SVG 이미지(원본 아이콘 아트, CSS는
  `board.css`에서 읽어 인라인), 글자는 페이지 글꼴로 캔버스 `fillText`(SVG 이미지는 웹 글꼴을 못 씀) → PNG blob → `<img class=
  "board-base">`(캔버스를 그대로 두면 캔버스가 GPU 레이어 + 위 요소 overlap 레이어가 됨; `<img>`는 보드 레이어에 그려지는 비트맵).
  SVG에는 32칸의 **투명 히트 영역**(`pointer-events="all"`, 탭·선택·e2e의 `g.sp[data-i]` 유지)과 **상태가 있는 칸**(소유자·건물·
  축제·적립금 — 기존 전체 마크업을 불투명하게 위에)만 남음. 크기·DPR·언어가 바뀌면 다시 만듦(언어 변경 시 새 이미지가 올 때까지
  전체 SVG로 복귀, 크기 변경은 150 ms 모아서). 실패하면 전체 SVG 유지. 게임 시작 후 0.3 s(1×) / 0.95 s(4×)에 준비.
  → 보드 하위 요소 1,174 → ~190, 루트 레이어 래스터가 SVG 대신 이미지 복사. 글자는 캔버스의 회색조 AA(기존 SVG는 LCD 색 번짐)
  외에 위치·굵기 동일(잉크 양 차이 < 1.5 %).
- **스테이지 레이어 상시화** (`.stage-rot { will-change: transform }`): 매 턴 회전 때 이미 레이어였음. 상시 레이어로 두면 카드·배너·
  토스트 변경이 루트 타일(보드)을 다시 래스터하지 않음 → 루트 래스터 3.2 s → 0.6 s / 25 s(4×).
- **프롬프트 슬롯 레이어** (`.st-prompt { will-change: transform }`, 진입 애니메이션을 카드 대신 슬롯에): 카드가 자기 임시 레이어
  (833×669, 8.5 MB)에 한 번, 애니메이션 종료 후 스테이지 레이어에 또 한 번 래스터되던 것을 한 번으로.
- **프롬프트를 다음 30 Hz 프레임에** (`GameController.advance` → `showPromptFor`): 마지막 이벤트의 DOM 변경(토큰 착지, 보드 칸,
  패널)·이전 프롬프트 제거와 새 카드 생성이 한 프레임(4×에서 35–60 ms)에 겹치지 않게. `instant()`(테스트 속도 0)에서는 즉시.
  사람 차례의 `whenIdle`은 카드가 표시된 뒤 해제.
- **주사위 공간 판정을 ResizeObserver로** (`Stage.fitDice`): 프롬프트가 들어간 다음 클럭 프레임에서 `clientHeight`/
  `offsetHeight`를 읽어 강제 스타일·레이아웃을 만들던 것(4× CPU 프로파일에서 자기 시간 1위 JS)을, 레이아웃 뒤에 크기를 알려주는
  ResizeObserver로. `no-dice`는 visibility만 바꾸므로 측정 전에 클래스를 뗄 필요도 없음.
- **CPU 행동을 30 Hz 틱 밖에서** (`GameController`): CPU의 결정(`chooseAction`)·`reduce`·저장은 일반 `setTimeout` 태스크에서,
  이벤트 애니메이션은 다음 30 Hz 프레임부터(`dispatch(a, { deferPlay: true })`). 그 프레임에는 첫 이벤트의 DOM 변경만 남음.
- **보드 아틀라스 아이콘은 패턴 채운 `<rect>`**: 처음엔 셀을 `<svg viewBox>`로 자른 `<image>`였는데, 그림은 맞아도 그룹의
  경계 상자가 아틀라스 전체 크기로 잡혀(e2e가 칸 중심이라 여긴 점이 이웃 칸/패널 위) 칸 탭 테스트 2건이 실패 → 셀을 사각형에
  맞추는 `<pattern>`(보드 `<defs>`에 셀당 1개)으로 경계 상자 = 아이콘.
- 시각 차이(측정): 보드 글자는 캔버스의 회색조 안티앨리어싱(기존 SVG는 LCD 색 번짐), 스테이지·프롬프트가 레이어라 그 안의 글자도
  회색조. 좌석 N(180° 회전)을 향할 때 레이어가 회전 합성되어 DPR 1에서 가장자리 대비가 ~4 % 낮음(선명도 지표 1.38 vs 1.44),
  DPR 2에서는 ~1 %(0.78 vs 0.79). 구도·색·크기 변화 없음(e2e 게임 스크린샷을 라운드 시작 커밋과 비교: 1–3 % 픽셀, 모두 글자/
  아이콘 가장자리). 커밋된 e2e 스크린샷(`c3376bf`)은 이 성능 작업 이전 것이라 전부 달라 보이므로 복원해 둠.
- 시도 후 되돌림: 이벤트 단계별로 "상태 렌더 → 다음 프레임에 토스트/펄스/도장/떠오르는 금액"으로 나누기(4단계 방식). 긴 프레임은
  측정 편차 안에서 차이가 없고 Paint가 17.9 → 21.4/s로 늘어 Paint ≤ 20/s 게이트를 깸. 주사위 결과 표시를 한 프레임 늦추기도 같음.
- **측정 하네스 수정** (`scripts/perf.mjs`) — 둘 다 게임이 아니라 측정 자체의 오류:
  - 프레임 통계를 하네스의 `HeapProfiler.collectGarbage` **이후에** 읽어서, 강제 전체 GC(4×에서 150–250 ms)가 rAF 기록에 "가장 긴
    프레임"으로 들어가 있었다(이전 보고의 최대 150–300 ms 대부분). 이제 GC 전에 읽음.
  - "33 ms 초과" = **vsync 두 번 초과**(한 번 놓친 프레임은 p99 게이트가 1 %까지 허용). rAF 타임스탬프는 0.1 ms 단위로 양자화되고
    vsync는 ~16.67 ms(±0.1)라 한 번 놓친 프레임이 33.3–33.6 ms로 찍혀, 기존 `x > 33.4`가 그중 일부만(부동소수점 33.4000…1 포함)
    세고 있었다. 간격은 vsync 배수(33.3 / 50 / 66.7 ms)이므로 `> 34`로 구분. 기존 방식의 값도 `over33raw`로 함께 출력.
  - **환경 바닥값**(정보, 게이트 아님): 같은 스로틀·DPR·길이로 **빈 페이지**의 rAF 간격을 잼(`floor` 단계, `play`와 함께 실행).
    이 VM에서는 빈 페이지도 60 s에 vsync 두 번 초과 프레임이 1–2개(최대 50–83 ms) — 메인 스레드와 다른 모든 스레드가 놀고 있는
    구간(트레이스 확인)으로, CPU 스로틀러의 시간 분할/VM 스케줄링(`/proc/stat` steal > 0) 때문이다.
- 진단 도구: `scripts/perf-frames.mjs`(`npm run perf:frames`) — 트레이스 없이 Long Animation Frames API + 게임 이벤트 User Timing
  마크(`?dev=1`: `lr:<Event>`, `lr:prompt-build`)로 vsync 두 번 초과 프레임마다 직전 이벤트와 메인 스레드 사용 여부를 출력, 프롬프트
  종류별 DOM 요소 수·생성 JS 시간(`window.__lrPromptStats`).

## 5. 재실행 방법

```sh
npm run perf                       # 빌드 + 게이트(boot, idle, cap, play, layers, mount) ≈ 5분, PASS/FAIL 표 출력
npm run perf -- --full --unique    # + 게임 전체 DOM, 스크린캐스트 고유 프레임
node scripts/perf.mjs --phases idle,cap --json out.json   # 일부만 (먼저 `npx vite build`)
npm run perf:render                # 레이어별 상세 보고서 (docs/assets/perf-render-baseline.json 형식)
node scripts/perf-render.mjs --out docs/assets/perf-render-after.json   # 작업 후 보고서 갱신 (먼저 `npx vite build`)
npm run perf:frames                # 4× 긴 프레임 원인(직전 게임 이벤트, 메인 스레드 사용/유휴) + 프롬프트 DOM 요소 수
node scripts/perf-frames.mjs --runs 3 --seconds 60
node scripts/perf.mjs --phases play          # 프레임 게이트만 (+ 환경 바닥값 floor, 약 2.5분)
```
`play` 단계는 이어서 `floor`(빈 페이지, 같은 조건)를 재서 표 아래에 "environment floor"로 출력한다. play의 "vsync 두 번 초과"
개수가 floor 수준이면 그 프레임은 게임이 아니라 이 기계의 것이다(4.5 참고).
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

- **4× "33 ms 초과 프레임 0" — 이 환경에서는 미달(환경 바닥값 수준).** p99는 16.8 ms로 통과. vsync 2회를 넘는 프레임이
  60 s에 0–7개(대개 1–4, 모두 50 ms 안팎) 남는데, 같은 조건의 **빈 페이지도 0–2개**(최대 33–83 ms)다. `scripts/perf-frames.mjs`로 보면 남은 것의 절반가량은
  메인 스레드가 놀고 있는(LoAF 없음 또는 blocking 0, 모든 스레드 유휴) 구간 = 이 VM의 스케줄링/CPU 스로틀러, 나머지는 게임
  이벤트(구매·턴 시작·카드·첫 프롬프트) 프레임이 4×에서 34–50 ms(이벤트 JS ~15 ms + 30 Hz 틱 콜백 15–20 ms + 스타일/레이아웃/
  페인트). 단계별로 프레임을 나누는 방식(4단계)은 효과가 편차 안이고 Paint를 21/s로 올려 되돌렸다. CPU 결정·`reduce`를 틱 밖으로
  옮긴 것(4.5)도 편차 안. 다음 후보: 턴 시작 배너 재구성 풀링, 이벤트별 DOM 변경 합치기, CPU 차례 프롬프트 카드 경량화(요약 카드,
  시각 변경이라 제품 결정 필요). 편차가 커서 한 번의 실행으로 판단하지 말 것(`node scripts/perf-frames.mjs --runs 3`).
  실제 기기(GPU 합성, 스로틀 아님)에서는 이 바닥값이 없다.
- 숨긴 아이콘 스프라이트(`<symbol>` ~1,400 요소)가 문서에 상주 — 렌더되지 않음(스타일/레이아웃 대상 아님), `querySelectorAll('*')`
  수만 늘림. 아틀라스(PNG 1장, 셀 = 카드 아이콘 크기 × DPR)와 보드 베이스(보드 × DPR, DPR 2에서 1944² ≈ 15 MB 디코드)는
  이미지 디코드 캐시 메모리(레이어 아님).
- 피크 레이어 메모리 97 MB(≤ 100): 루트 24 + 패널 스쿼시 레이어 24(토큰이 이동 애니메이션 중일 때만) + 토큰 레이어 14.5 +
  스테이지 7.5 + 프롬프트/토스트. `.stage-rot` 상시 레이어가 +7.5 MB.
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

### 2라운드 (4× 프레임 지연, 2026-09-30)

측정값은 모두 `node scripts/perf.mjs --phases play`(4×, DPR 2, 60 s) — 실행 간 편차가 커서 여러 번 잰 범위. "vsync 2회 초과"는
하네스 수정 후 기준(`> 34 ms`), 괄호 안은 기존 `> 33.4` 방식.

- **13단계** — 시작점 재측정: 20 ms 초과 61–69, 33 ms 초과 22–29(기존 방식), p99 33.3–33.4. 트레이스로 긴 프레임 분해(위 4.5):
  카드 생성 프레임(스타일 221+346 요소), 루트 레이어 래스터 대기(`WaitForCommitCompletion` 15–35 ms), 이벤트+프롬프트 겹침.
- **14단계** — 아이콘 심볼 스프라이트(`05b6adf`) + 개발용 프롬프트 통계(`window.__lrPromptStats`, `lr:prompt-build` 측정).
  구매 카드 DOM 222 → 57. 프레임: 20 ms 초과 63–64, 33 ms 초과 20–26 — 편차 안(그림자 트리 때문, 4.5).
- **15단계** — `.stage-rot` 상시 레이어 + 이벤트 User Timing 마크(`622e9d3`). 루트 래스터 3.2 → 0.6 s/25 s. 20 ms 초과 41,
  33 ms 초과 12. 피크 레이어 메모리 89 → 97 MB(≤ 100).
- **16단계** — 보드 정적 이미지 + 아이콘 비트맵 아틀라스 + 프롬프트를 다음 프레임에(`6a8a996`). p99 **16.8 ms**(통과),
  20 ms 초과 25–29, 33 ms 초과(기존 방식) 7–8. 구매 카드 DOM 49, 보드 하위 ~190.
- **17단계** — 프롬프트 슬롯 레이어, 하네스 수정 2건(GC 후 읽기, vsync 양자화), `floor` 단계, `scripts/perf-frames.mjs`
  (`4b24d51` 이후). 같은 빌드에서 슬롯 레이어 A/B: 있음 0 / 1 / 2, 없음 6 / 2 / 2(vsync 2회 초과, 3회씩).
  단계별 프레임 나누기는 Paint 21.4/s로 되돌림. 빈 페이지 바닥값: vsync 2회 초과 1–2 / 60 s.
- **18단계** — 주사위 공간 판정 ResizeObserver, 보드 아틀라스 아이콘을 패턴 `<rect>`로(e2e 칸 탭 2건 실패 수정), CPU 결정·`reduce`를
  틱 밖으로. 최종 `npm run perf -- --full --unique`: **17/18**(p99 16.8 ms 통과, vsync 2회 초과 7프레임·최대 50 ms로 미달, 같은 실행의
  빈 페이지 0). CPU 태스크 변경 후 4회: 2 / 4 / 2 / 1. `docs/assets/perf-render-after.json` 갱신. 전체 Playwright 스위트 통과,
  e2e 스크린샷은 커밋본 유지(4.5).

# VFX 설계 명세 — 스프라이트 시트 + 파티클 연출 (Lot & Roll / 랏앤롤)

> 상태: **v1 설계 명세(구현 전)**. 근거·비교·측정은 `docs/research/05-vfx-research.md`(이하 "리서치").
> 이 문서는 구현 에이전트가 그대로 따라 만들 수 있도록 **선택한 기술, 통합 설계, 스프라이트 목록, 에셋 파이프라인,
> 이벤트→이펙트 카탈로그, 성능 예산, 테스트 계획**을 정한다. 충돌 시 `docs/PERFORMANCE.md`(하드 게이트)가 우선이다.
> 이 문서 작성 시점에 `src/`는 변경하지 않았다.

## 0. 한 장 요약

| 항목 | 결정 |
|---|---|
| 기술 | **자체 Canvas2D 스프라이트/파티클 엔진** (`src/ui/fx/vfx/`) — 아틀라스 2장 `drawImage`, SoA 파티클 풀(≤300), 기존 30 Hz 클럭 `onFrame`에 등록. 렌더러는 인터페이스 뒤에 두어 필요 시 Pixi 백엔드로 교체 가능 |
| 오버레이 | **캔버스 1장**, `.fx-layer`(z-index 40, `pointer-events:none`) 안. 이펙트가 살아 있을 때만 표시·프레임 등록, 끝나면 `hidden` + 백킹 스토어 해제 → **유휴 0** |
| 해상도 | 살아 있는 이미터의 합집합 바운딩 박스(리전)만큼만, 백킹 픽셀 **≤0.9 MP**(스케일 0.75–1.5, DPR 상한 2 이하로 캡) |
| 에셋 | SVG 절차 생성 → Playwright 래스터 → 트림 → `maxrects-packer` → Chromium WebP 인코딩. **125프레임 / 182 KB**(프로토타입 실측, 예산 ≤500 KB) |
| 이벤트 | 모든 `GameEvent`에 프리셋 매핑(§7). 등급 I0–I4로 에스컬레이션, 이벤트당 1–2.2 s(피날레 예외 ≤4 s), 탭 스킵 ×5·속도 배율·접근성 폴백 |
| 게이트 | 라이브 파티클 ≤300, 레이어 피크 ≤20(+1), 레이어 메모리 ≤100 MB(+4 MB 이내), 표시 fps 26–34, 유휴 0, 아틀라스 ≤500 KB |

---

## 1. 목표 · 원칙 · 비목표

**목표**: 구매·건설·통행료·인수·명소 완성·독점·축제·출발·무인도·카드·파산·승리 등 "순간"을 **기대 → 임팩트 → 보상 → 안정** 4단계로 연출하되,
테이블에 앉은 4명 누구에게나 읽히고(방향 없는 아이콘/색/숫자), 30 fps·유휴 0·레이어 예산을 깨지 않는다.

**원칙**
1. **캔버스에는 글자를 그리지 않는다.** 금액·문구는 기존 DOM(패널 `float()`, Stage 스탬프/토스트 — 행위자 좌석으로 회전)이 맡는다. FX는 아이콘·파티클·빛·색만.
2. **소유 색과 금색의 의미 분리**: 플레이어 색 = "누구의 것/누가 했나", 금색 = "돈·보상", 회색/어두움 = 손실·파산.
3. **한 번에 하나의 큰 순간**: I3 이상은 동시에 1개(우선순위 큐). 나머지는 I0–I2 악센트로 강등.
4. **모두 건너뛸 수 있다**: 탭 스킵(`skip()`) → 시간 ×5, 속도 배율(`animSpeed`), `instant()` → 캔버스 미생성.
5. **결정적**: 엔진 RNG(`rng`)를 건드리지 않는 별도 시드 PRNG(C6). 같은 시드·이벤트 순서 → 같은 프레임(테스트).
6. **유휴 0**: 이펙트가 없으면 rAF·타이머·캔버스 없음. "무한 반짝임" 같은 상시 루프 금지(랜드마크 반짝임은 3 s 유한 연출 + 정적 CSS 글로우).

**비목표**: 3D, 셰이더, 상시 파티클 루프, 캔버스 텍스트, 새로운 런타임 의존성(빌드 devDependency 1개 `maxrects-packer`만), 서드파티 아트.

---

## 2. 선택한 기술과 근거 (요약)

리서치 §2 결과: Canvas2D 자체 엔진 84점, Pixi 69점, CSS-only 66(게이트 위반), Lottie 50, Phaser 50, Rive 43.

- 번들: Pixi(트리셰이킹) **109 KB gz** vs 현재 앱 JS 95 KB gz, 자체 엔진 추정 6–9 KB gz.
- 실측(SwiftShader, 4× 스로틀): 면적×백킹이 비용 지배, 파티클 100→300은 영향 미미. 800² 1× 백킹에서 Canvas2D 27–28 fps, Pixi 29.5 fps → 둘 다 게이트 근처, **면적 예산이 핵심**.
- WebGL 신규 위험(컨텍스트 로스트, 저사양 GPU, 셰이더 컴파일) 회피, 기존 `particles.ts` 패턴 계승.
- **Pixi 에스컬레이션 조건**(리서치 §2.7): 실기기에서 FX 중 프레임당 JS >6 ms 상시 / 표시 fps <26 반복 / 파티클 상한 600+ 필요.
- 소프트웨어 캔버스(`willReadFrequently:true`)를 기본으로 유지(PERFORMANCE.md 9단계·§7 발견). 런타임 스위치 `fxConfig.softwareCanvas`로 실기기 A/B.

---

## 3. 통합 설계

### 3.1 DOM 위치와 z-순서

현행 구조(`view.ts`, `game.css`, `board.css`) [코드 확인]:

```
.game
 ├─ .table (absolute inset 0)          ← 쉐이크 대상
 │    ├─ board.el  (svg · marks · stage-host{ .stage > .stage-rot(프롬프트·주사위) } · token-layer z3 · board-overlay z4)
 │    └─ 좌석 패널 ×N (.pp z5)
 ├─ .fx-layer  (z-index 40, pointer-events none, overflow hidden)   ← 여기에 FX 캔버스 1장
 ├─ .menu-slot (z30)
 └─ .rotate-overlay (z100)
```

- **프롬프트는 `.table` 안(Stage)에 있어 `.fx-layer`보다 아래**다. 즉 FX는 프롬프트 위에 그려진다. "프롬프트 아래"는 z-순서로 불가능하고(둘째 캔버스 = 레이어 +1) 필요도 낮다: 캔버스는 `pointer-events:none`이라 조작을 막지 않고, 프리셋은 **프롬프트 카드 영역(Stage 사각형) 안에서는 파티클 알파 ×0.6·가산 광선 생략**하는 옵션(`avoidRect`)을 가진다(v2).
- `menu-slot`(z30) 위에 그려지므로 메뉴 버튼 위에 파티클이 지나갈 수 있음 → 허용(pointer-events none).
- 쉐이크: 현행 `shake(view.table)`만으로는 캔버스가 안 흔들려 칸과 파티클이 어긋난다 → **`shake([table, fxLayer])`** 로 확장(같은 키프레임을 두 요소에 동시 적용; 컴포지터 transform이라 리페인트 0, 새 레이어 없음).

### 3.2 캔버스 라이프사이클 (유휴 0 보장)

```
idle ──play()──▶ arm ──(다음 격자 프레임)──▶ running ──(라이브 파티클 0 && 타임라인 0)──▶ teardown ──▶ idle
                  │ canvas.hidden=false, size=region×scale          │ canvas.hidden=true
                  │ onFrame(step) 등록 (rAF 루프 1개 공유)          │ canvas.width=canvas.height=0 (백킹 해제)
                  ▼                                                 │ onFrame 반환 false → 클럭 정지
```

- 등록·해제는 `time.ts`의 `onFrame(fn)`(반환값 `false` = 해제)만 사용. 별도 `setTimeout`/`requestAnimationFrame` 금지. 종료 후 `activeFrameTicks()`가 0이어야 한다(테스트 게이트).
- **`play()`는 DOM 상태 변경 다음 프레임에 시작**(`animate.ts`의 기존 `nextFrame()` 패턴): 상태 렌더 프레임과 FX 시작 프레임을 분리해 4× 스로틀 프레임 지연을 악화시키지 않는다(PERFORMANCE.md §7).
- 화면 이탈(`flushAll`)·`visibilitychange:hidden`·뷰포트 리사이즈(`watchViewport`) 시 `fx.clear()`: 모든 이펙트 즉시 폐기(약 1–2 s짜리라 복원 불필요) + teardown. 리사이즈 후에는 다음 `play()`가 앵커를 다시 해석한다.
- 게임 화면 마운트 시 `fx.init()`: 캔버스 요소 생성(`hidden`), 아틀라스 `fetch → createImageBitmap`, 틴트 사전 데우기(§3.6). **부팅(Title 258 ms 게이트)과 무관하게 게임 마운트 이후 유휴 시간**에 수행. 아틀라스가 아직 없으면 `play()`는 무시(연출 생략, 게임 진행 불변).

### 3.3 리전·해상도 규칙

- **리전** = 살아 있는 이미터들의 예상 경로 바운딩 박스 합집합 + 패딩(max 스프라이트 크기). `play()` 시점에 프리셋이 `bounds()`를 제공(정적 계산; 좌표는 `fx-layer` 로컬 px).
- 리전은 **커지기만** 하고(합집합) 이펙트가 모두 끝나면 비운다. 리전이 커질 때만 캔버스 크기를 다시 잡는다(캔버스 크기 변경은 내용을 지우지만 매 프레임 전체를 다시 그리므로 무해). 커지는 시점은 `play()` 호출 프레임(1회)로 제한.
- **백킹 스케일** `s = clamp( sqrt(0.9e6 / (w·h)), 0.75, min(1.5, devicePixelRatio) )`. 예) 400×400 → 1.5, 800×800 → 1.06, 1600×1000 → 0.75. 리서치 §2.3: 면적×백킹이 fps를 지배.
- CSS 크기는 리전 그대로(`transform: translate(x,y)` 위치, `width/height` 고정) — 업스케일은 컴포지터가 한다. `image-rendering` 기본.
- 컨텍스트 옵션: `getContext('2d', { alpha: true, willReadFrequently: fxConfig.softwareCanvas })`, `imageSmoothingQuality='low'`.
- 더티 영역 클리어: 이전 프레임에 그려진 바운딩 박스만 `clearRect`(전체 클리어 대신). 리전 전체 면적이 클수록 이득.

### 3.4 좌표계·좌석 회전

- 캔버스는 **화면(클라이언트) 좌표**. 앵커 해석 함수 `resolve(anchor)`:
  - `{space: i}` → `board.spaceClientCenter(i)`(기존) + 칸 크기(`board.spaceSize(i)` — 추가 필요, `--u` 기반)
  - `{panel: id}` → `view.panel(id).clientCenter()`(기존) + 좌석 방향 벡터
  - `{stage}` → 보드 중앙(스테이지 사각형), `{table}` → 전체
- 크기 단위 `fx.u = boardPx/32`(레이아웃의 `--u`와 동일). 스프라이트는 기준 `u=30`(보드 ≈960 px)에서 구웠으므로 그릴 때 `scale = fx.u / 30 × presetScale`.
- **좌석 벡터**: `SEAT_DIR = { S:[0,-1], N:[0,1], E:[-1,0], W:[1,0] }`(패널 → 보드 중심 방향), `SEAT_ANGLE = { S:0, E:-90, N:180, W:90 }`(`util.ts`).
- 규칙 R1–R6:
  - **R1** 캔버스에 글자 없음.
  - **R2** 칸 위 이펙트는 방사 대칭(링·반짝·먼지)이라 방향 무관. 방향성 스프라이트(망치·깃발·경광등 빔)는 행위자 좌석 각도로 회전.
  - **R3** 패널 앵커 이펙트는 **패널에서 보드 중심 쪽으로** 방출(수령자·지불자는 자기 앞에서 일어나는 일로 읽음).
  - **R4** 4좌석 공통 순간(축제, 독점 완성, 한 칸 남음, 승리)은 중앙 방사 또는 4변 동시. 한 칸 남음 안내 텍스트는 기존 `edgeToast`(좌석별 4장 DOM).
  - **R5** 승리: 색종이 중력 방향 = 승자 좌석의 "아래"(=패널 쪽), 대포는 승자 패널 양옆 모서리에서 중앙으로.
  - **R6** 돈은 항상 **지불자 패널 → 수령자 패널** 궤적: 당사자 두 명은 자기 쪽으로 오가는 코인을 보고, 나머지는 가로지르는 코인을 본다.

### 3.5 클록·속도·스킵

- 엔진 시간 `fxNow` 은 `onFrame(now)`의 `now` 차이를 누적: `elapsed += (now - last) × animSpeed() × (isSkipping() ? 5 : 1)` (`particles.ts`와 동일 패턴). 파티클은 **고정 스텝 dt=1/30 s** 적분(스킵 시 스텝 크기만 ×5, 서브스텝 없음).
- `instant()`(=`animSpeed==0` 또는 reduced-motion): `play()`는 즉시 반환. reduced-motion이면 **정적 표식**(§8.3).
- 히트스톱: `fx.freeze(ms)` = FX 시간 정지(라이브 파티클 정지) — DOM/WAAPI는 정지하지 않으므로 시퀀서는 같은 시간만큼 `await sleep(ms)`로 후속 이벤트를 지연한다. (v2: `time.ts`의 `running` 애니메이션 `playbackRate=0` 일시 정지로 전 화면 프리즈.)

### 3.6 틴트·블렌드·캐시

- 색 고정 아틀라스(`fx-color`): 그대로 `drawImage`.
- 마스크 아틀라스(`fx-mask`, 흰색): `(frame, colorHex)` **틴트 캐시** — 작은 오프스크린 캔버스에 프레임을 그린 뒤 `globalCompositeOperation='source-in'` + `fillRect(색)`. 키 `frame|hex`, LRU 상한 **8 MB**(≈ 프레임당 12–60 KB × 색 수). 게임 시작 시 플레이어 색 + 금 `#F2B633` + 흰색만 **프레임 단위로 유휴 슬라이스(≤2 ms/조각)** 사전 데움; 나머지는 첫 사용 시 즉시 생성.
- 가산 발광: `globalCompositeOperation='lighter'`(광선·링·반짝·혜성·불꽃·글로우), 일반: `source-over`. 프레임 내 블렌드 전환을 최소화하기 위해 파티클 배열을 **블렌드 → 스프라이트 순**으로 정렬해 그린다(이미터 생성 시 `layer` 인덱스 지정).
- 알파는 `ctx.globalAlpha`.

### 3.7 파티클 풀·예산기

- SoA `Float32Array` 풀 **300개 고정**(할당 0): `x,y,vx,vy,ax,ay,rot,vrot,sx,sy,sx1,sy1,a0,a1,age,life,delay,frame0,frameN,fps,sprite,tint,blend,layer,flags`.
- `Budget.request(n, priority)`: 남은 슬롯 = 300 − 살아 있는 수. 요청이 남은 슬롯을 넘으면 `n' = max(ceil(n×0.25), 남은 슬롯)`로 감량(낮은 우선순위 이펙트가 먼저 깎임); 슬롯 0이고 요청 우선순위가 가장 낮은 라이브 파티클보다 높으면 **가장 오래된 최저 우선순위 파티클을 회수**. 이벤트 단위로도 등급별 상한 적용(§7 표).
- 우선순위(높음→낮음): 승리 > 파산 > 명소 > 인수 > 독점 완성 > 통행료 > 출발 > 축제 > 구매 > 건설 > 카드 > 섬 > 기타.
- **플래시 예산** `flashBudget`: 1000 ms 창 내 "플래시 프레임"(전 화면 밝기 변화가 큰 프레임) ≤3, 단일 플래시 알파 ≤0.25, 큰 면적 적색 플래시 금지.

### 3.8 코드 구조 (제안)

```
src/ui/fx/vfx/
  index.ts        FxHost: init/play/freeze/clear/liveCount/stats, dev 훅 등록
  engine.ts       리전·캔버스 라이프사이클, onFrame 스텝, 파티클 풀, 예산기, 플래시 예산기
  renderer2d.ts   FxRenderer(Canvas2D) — begin/sprite/end, 틴트 캐시  (Pixi 교체 지점)
  atlas.ts        fx-atlas.json 로드, createImageBitmap, 프레임 조회
  presets.ts      프리셋(이미터 타임라인) 정의: toll, buy, build, landmark, takeover, ...
  map.ts          GameEvent → 프리셋 매핑(§7), 등급·금액 티어 함수, 콤보 병합
  rng.ts          mulberry32 시드 PRNG (엔진 rng와 독립)
public/fx/        fx-color.webp  fx-mask.webp  fx-atlas.json   (빌드 산출물, 커밋)
scripts/fx/       sprites.mjs  bake-atlas.mjs  contact-sheet.mjs
```

핵심 타입(스케치):

```ts
export type Blend = 'normal' | 'add';
export interface FxRenderer {              // Canvas2D 구현; Pixi 구현으로 교체 가능
  begin(region: Rect, scale: number): void;
  sprite(id: number, x: number, y: number, rot: number, sx: number, sy: number,
         alpha: number, tint: number /* 0 = 원색, 그 외 팔레트 인덱스 */, blend: Blend): void;
  end(): void;
}
export type Anchor = { space: number } | { panel: PlayerId } | { stage: true } | { table: true } | { x: number; y: number };
export interface PlayCtx { seat?: Seat; color?: string; to?: Anchor; from?: Anchor; amount?: number; tier?: 0|1|2|3|4; seed?: number; }
export interface FxHandle {
  /** 시퀀서가 기다리는 지점(블록 시간). 꼬리는 계속 재생된다. */
  block: Promise<void>;
  /** 마지막 파티클까지 종료. */
  done: Promise<void>;
  cancel(): void;
}
export interface FxHost {
  init(): Promise<void>;
  play(preset: PresetId, at: Anchor, ctx?: PlayCtx): FxHandle;
  freeze(ms: number): void;
  clear(): void;
  liveCount(): number;
}
```

프리셋은 **타임라인** `[{ t: ms, spawn(ctx) | sfx | haptic | shake | freeze }]`로 정의하고 엔진 클록으로 발화한다(`setTimeout` 금지 — 스킵/속도 배율/일시정지가 자동 적용).

### 3.9 `animate.ts` 연동 방식

- `GameView`가 `fx: FxHost`를 갖고(`view.vfx`), 각 `case`에서 `void view.vfx.play(...)`(꼬리는 비블록) 또는 `await handle.block`(블록 구간만 대기).
- 기존 `particles.ts`의 `coinShower/coinArc/confetti`는 프리셋 `coinShower/coinArc/confetti`로 이관(같은 호출 시그니처의 어댑터 유지 → 단계적 교체).
- 파생 이벤트 `GroupCompleted`(엔진 이벤트가 아님): `PropertyBought`/`TakenOver`/`PropertyTransferred` 직후 뷰 상태 `vs`로 `completedGroup(vs, playerId, spaceIndex)`를 계산(엔진 `groupOf` 재사용, 엔진 변경 불필요).
- 프롬프트 순간(확정 탭 등)은 `Stage`/프롬프트 버튼 핸들러가 `vfx.play('tap', {x,y})` 호출(입력→피드백 지연 ≤100 ms 유지; 이벤트 시퀀서를 거치지 않음).

---

## 4. 스프라이트 목록 (프로토타입 실측 기반)

기준: 기준 유닛 `u=30`(보드 ≈960 px)에서의 "공칭 CSS px" 크기, 베이크 1.5×(부드러운 스프라이트는 `k` 배 추가 축소). **모든 스프라이트는 문자·숫자·통화 기호·상표 도안 없음.** 마스크(M) = 흰색+알파, 런타임 틴트·가산.

| # | 이름 | 아틀라스 | 공칭 px | 프레임 | 용도 | 비고 |
|---|---|---|---|---|---|---|
| 1 | `coin_spin` | 색 | 48² | 10 | 코인 회전(호·샤워·지불), 프레임 오프셋으로 개체별 위상 차이 | 앞/뒷면은 도형 무늬(★·동심원), 문자 X |
| 2 | `bill_flutter` | 색 | 56×34 | 6 | 지폐 나풀 — 복권/배당/팟 수령 | 기호 대신 별/동심원 엠블럼 |
| 3 | `moneybag` | 색 | 64² | 1 | 출발 월급 돈주머니 팝(스쿼시는 코드) | 매듭 리본+빛 반사 |
| 4 | `gold_star` | 색 | 48² | 1 | 별 보상·구매 확정·독점 | 5각, 금색 그라디언트 |
| 5 | `heart` | 색 | 48×44 | 1 | 생일/복지/수호 | |
| 6 | `crown` | 색 | 64×52 | 1 | 승자·명소·랜드마크 왕관 낙하 | 보석 3개 |
| 7 | `brick_chip` | 색 | 26×22 | 3 | 벽돌/파편 조각(건설·태풍·파산) | 3가지 실루엣 |
| 8 | `hammer` | 색 | 64² | 1 | 건설 망치 스윙(회전은 코드) | |
| 9 | `sale_tag` | 색 | 48×44 | 1 | 구매 확정 태그 스윙 | 체크 표시 도형(문자 X) |
| 10 | `siren` | 색 | 64² | 4 | 인수/3연속 더블/파산 경광등 빔 스윕 | 4프레임 회전 |
| 11 | `flag_wave` | **M** | 64×52 | 6 | 축제 깃발 펄럭임(소유/금 틴트) | |
| 12 | `sparkle4` | M | 48² | 6 | 4방향 반짝(트윙클) | 코인/왕관 글린트 겸용 |
| 13 | `glint_sweep` | M | 64² | 8 | 사선 빛줄기 스윕(칸·왕관·건물) | |
| 14 | `shine_cross` | M | 96² | 6 | 십자 반짝(고급) | |
| 15 | `star_burst` | M | 128² (k .75) | 8 | 별 폭발(구매/축제/스탬프) | |
| 16 | `ring_shock` | M | 128² (k .75) | 6 | 충격파 링(얇아지며 확대) | |
| 17 | `dust_puff` | M | 96² (k .75) | 8 | 먼지 구름(홉·건설·착지) | |
| 18 | `smoke` | M | 96² (k .75) | 8 | 연기(파산·태풍·부담 큰 통행료) | |
| 19 | `firework` | M | 128² (k .75) | 12 | 불꽃놀이 폭발(스파크+꼬리) | |
| 20 | `ray_burst` | M | 256² (k .5) | 1 | 광선(회전·가산, 명소/승리 배경) | 12갈래 |
| 21 | `glow` | M | 64² | 1 | 부드러운 글로우(트레일·플래시 대용) | 전 화면 사각 플래시 대체 |
| 22 | `speed_lines` | M | 128×64 (k .75) | 4 | 속도선(긴 이동·급행) | |
| 23 | `comet` | M | 96×48 (k .75) | 8 | 혜성/불덩이 꼬리(섬 이동·축제 이동·허브 로켓) | |
| 24 | `stamp_splat` | M | 128² (k .75) | 5 | 도장 임팩트 링+튄 점 | |
| 25 | `hit_lines` | M | 64² | 4 | 타격선(망치·인수·차단) | |
| 26–30 | `confetti_rect/streamer/dot/tri/diamond` | M | 18×22, 18×38, 18², 20², 20×22 | 1×5 | 색종이(뒤집힘=scaleX 코사인, 팔레트 틴트) | |

- 프레임 합계 **125** (색 29 + 마스크 96). 프로토타입 아틀라스: `fx-color` 256×512, `fx-mask` 1024×1024, 사용률 71 %.
- 예산 여유용 v2 후보(합 ~30프레임 추가해도 ≤1024×1024 유지): `crane_hook`(6f, 건설 크레인 도르래), `water_drop`(3f), `bubble`(4f), `ticket`(1f), `shield_spark`(6f), `banner_ribbon`(1f). 문자가 필요한 스탬프 글자는 계속 DOM.
- 예상 크기: **WebP q0.9 182 KB**(색 34 + 마스크 148) + JSON ≈10 KB(gz ≈3 KB). PNG는 434 KB(WebP를 못 읽는 경우의 폴백으로도 ≤500 KB). 디코드 메모리 4.5 MB.
- 텍스처 크기: 최대 1024×1024 ≤ 2048(구형 GPU/WebView 안전 한도).

### 4.1 재사용 규칙 (프레임 수 절약)

| 효과 | 만드는 법 |
|---|---|
| 코인 반짝(글린트) | `sparkle4` 가산 + 금색 틴트, 코인 위 오프셋 |
| 왕관 글린트 | `glint_sweep` 2회 + `shine_cross` 1회 |
| 물방울/거품 | `confetti_dot`(하늘색 틴트, 중력) |
| 경고 파동 | `ring_shock` 붉은 틴트 |
| 소유 깃발 | `flag_wave` 소유자 색 틴트 |
| 지폐 비 | `bill_flutter` 프레임 위상 랜덤 |
| 토큰 후광 | `glow` + `ring_shock` 소유 색 |
| 타이머 경고 | 없음(기존 UI) |

---

## 5. 에셋 파이프라인 (빌드 타임)

```
scripts/fx/sprites.mjs        스프라이트 정의: { name, cls:'color'|'mask', w, h, frames, k?, svg(i, n) → SVG 문자열 }
scripts/fx/bake-atlas.mjs     Playwright(Chromium) → 래스터 → 알파 트림 → MaxRects → WebP/PNG → JSON
npm run fx:atlas              위 스크립트 실행 (node scripts/fx/bake-atlas.mjs), 산출물을 public/fx/ 에 기록
scripts/fx/contact-sheet.mjs  아틀라스 + 프레임 재생 컨택트 시트 PNG (docs/assets/fx-contact-sheet.png) — 시각 검토용
```

- 도구: 전역 Playwright(`/opt/node22/lib/node_modules/playwright`, `PLAYWRIGHT_MODULE`/`CHROMIUM_PATH` 재정의는 `scripts/perf.mjs`와 동일 규칙), Chromium `/opt/pw-browsers/chromium`. 추가 devDependency: **`maxrects-packer`(MIT, 순수 JS)** 1개. `sharp` 등 네이티브 의존성 불필요(WebP 인코딩은 Chromium `OffscreenCanvas.convertToBlob`).
- 알고리즘(프로토타입 검증):
  1. 각 프레임: SVG → `data:` URL → `Image.decode()` → `OffscreenCanvas(ceil(w×1.5×k), ceil(h×1.5×k))`에 그리기 → `getImageData`로 알파>6 바운딩 박스 → 트림.
  2. 클래스(색/마스크)별로 `new MaxRectsPacker(1024, 1024, 2, { smart:true, pot:true, allowRotation:false })` (색은 256×512로 충분; 프레임이 늘면 자동 탐색).
  3. 아틀라스 캔버스에 배치 후 `convertToBlob({type:'image/webp', quality:0.9})` 및 PNG.
  4. `fx-atlas.json`: `{ v:1, scale:1.5, ref:30, color:{w,h,file}, mask:{...}, frames:{ "sparkle4/0":[ax,ay,tw,th,x0,y0,W,H,k], ... }, anims:{ "sparkle4":{n:6,fps:20} } }`. 그릴 때 앵커 복원: `dx = (x0 - W/2)/scale`, `dy = (y0 - H/2)/scale`.
- 검증 스크립트(`bake` 마지막 단계 + vitest): 아틀라스 ≤1024², 프레임 사각형 겹침 없음, 패딩 ≥2 px, 총 바이트(WebP) ≤ 500 KB, 모든 프리셋이 참조하는 스프라이트 이름이 존재.
- 산출물은 **저장소에 커밋**(빌드가 Playwright를 요구하지 않음). 재생성 시 Chromium 버전 차이로 바이트가 달라질 수 있으니 CI는 "크기·무결성·참조 검사"만 강제.
- 아트 규칙: (1) 스프라이트에 문자·숫자·통화 기호 금지(회전/i18n/통화 오해), (2) 상표·고유 도안 금지(DESIGN C1), (3) 마스크는 순백+알파(틴트 품질), (4) 색 스프라이트는 팔레트 토큰(`#F2B633` 금, `#B9781A` 금 그림자 등) 재사용, (5) 외곽선 2–2.5 px 짙은 색으로 보드 SVG 아이콘 스타일과 통일.

---

## 6. 등급(에스컬레이션)·콤보·공통 규칙

### 6.1 등급표

| 등급 | 이름 | 총 길이 | 블록(시퀀서 대기) | 파티클 상한 | 쉐이크 | 히트스톱 | 플래시 | 대표 |
|---|---|---|---|---|---|---|---|---|
| **I0** | 미세 | 0.2–0.5 s | 0 | ≤8 | 0 | 0 | 0 | 홉 먼지, 턴 후광, 탭 반짝 |
| **I1** | 소 | 0.6–0.9 s | 0–350 ms | ≤40 | 0 | 0 | 0 | 소액 구매, 1레벨 건설, 소액 통행료, 카드 뒤집기 |
| **I2** | 중 | 1.0–1.4 s | 350–600 ms | ≤100 | 3–4 px / 240 ms | 33 ms(1f) | 1f, α≤0.15 | 프리미엄 구매, 2–3레벨 건설, 큰 통행료, 출발, 축제, 더블 |
| **I3** | 대 | 1.6–2.2 s | 600–900 ms | ≤200 | 8 px / 360 ms | 66–100 ms | 2f, α≤0.25 | **명소 완성**, 인수, **독점 완성**, 파산 |
| **I4** | 피날레 | 3.0–4.0 s(꼬리 포함, 이후 완전 정지) | 1500 ms | ≤300 | 12 px / 480 ms | 100 ms | 2f, α≤0.25 | 게임 종료(승리 종류별) |

- 등급 결정: 이벤트 종류가 기본 등급을 주고, **금액/레벨 티어가 ±1 보정**(§7 각 행). 예) 구매 가격 <200 → I1(14개), 200–499 → I1(24), 500–799 → I2(34), ≥800(뉴욕·서울) → I2(44).
- 쉐이크는 `.table`+`.fx-layer` 동시(§3.1), 감쇠 지수 e^(−t/τ) 근사 키프레임 7개(현행 `shake.ts`와 같은 형태, 진폭만 위 표).

### 6.2 콤보/병합 규칙

1. **병합 창 400 ms(12f)**: 같은 프리셋 계열이 같은 대상(같은 칸/같은 패널쌍)에 다시 오면 새 이펙트를 만들지 않고 진행 중 이펙트에 **개수 가산**(상한: 코인 14, 반짝 12) + 사운드 `gain +15 %`.
2. **피치 래더**: 연속 `cash-in`(1.5 s 이내)마다 `pitch = 2^(k/12)`, k=0..7(반음 상승, 1.5 s 무입력이면 0으로). `cash-out`은 반음 하강(−k, 최소 −4).
3. **체인 강등**: I3 이벤트 재생 중 발생한 I1–I2 이벤트는 **악센트(파티클 ×0.4, 사운드만 유지)**. 한 순간에 I3 두 개(예: 명소 완성 + 독점 완성)는 **하나의 복합 프리셋 `landmark+monopoly`**로 합성(광선·불꽃 ×1.3, 총 상한 200 유지).
4. **큐**: 프리셋 동시성 상한 — I3/I4는 1개, I2는 2개, I1은 4개. 초과 시 낮은 우선순위는 `block` 없이 즉시 악센트로 강등 또는 폐기(사운드/햅틱은 유지).
5. **연쇄 안무**(Candy Crush "정해진 순서" 차용): 다수 칸이 관여하는 이벤트(독점 완성 칸들, 파산 자산 이전)는 칸마다 60–90 ms 간격으로 순차 발동, 처음 6칸까지만 파티클(나머지는 색만 전환).
6. **스킵**: 탭 = `skip()`. 진행 중 이펙트는 시간 ×5로 마무리, 새 이펙트는 파티클 수 ×0.5·쉐이크 생략, 사운드/햅틱은 유지.

---

## 7. 이벤트 → 이펙트 카탈로그

표기: `t`=이벤트 시작 기준 ms(괄호는 30fps 프레임), **블록**=시퀀서가 기다리는 시간, 색: `owner/actor/payer/gold/white`, 좌석 가독성: **○**=방향 무관, **↻**=행위자 좌석으로 회전(DOM), **P**=패널 앵커.
프리셋 이름은 §7.5 사전 참조. SFX는 `src/ui/audio/sfx.ts`의 `SfxName`, 햅틱은 `HapticKind`.

### 7.1 이동·주사위·턴

| 이벤트/조건 | 등급 | 시퀀스 (t) | 스프라이트·수량 | 색 | 쉐이크·정지 | SFX / 햅틱 | 좌석 가독성 |
|---|---|---|---|---|---|---|---|
| `RoundStarted` (마지막 3라운드 진입) | I0 | 0: 라운드 표시 옆 `ring_shock` 1회 | ring 1 | 호박색 `#F5A25D` | — | `warning`(현행) / — | ○ (문구는 기존 토스트) |
| `TurnStarted` | I0 | 0: 활성 토큰 `glow`+`ring_shock`(6f) | 4 | 행위자 색 | — | `turn`(선택) / — | ○ 누구 차례인지 색 후광 |
| `DiceRolled` 일반 | I0 | 주사위 착지 프레임에 각 주사위 `dust_puff` 소(6f) | 6 | 흰색/회색 | — | `dice-land`(기존) / 기존 | ○ |
| `DiceRolled` 더블 | I2 | 0: 스테이지 중앙 `ring_shock` 금색 + `sparkle4`×10 스태거 25 ms + `star_burst` | 16 | gold | 없음 | `doubles` / `light` | ○ 문구 "더블!"은 Stage 스탬프(↻) |
| `DiceRolled` 3연속 더블 | I2 | 0–500: `siren` 스윕 2회(스테이지 가장자리 4방) → 스탬프 | siren 4, ring 2 | 붉은 | 4 px / 240 ms | `warning` / `warning` | ○ |
| `DiceRolled.express` | I1 | 토큰에 `speed_lines`+`comet` 1개 | 3 | gold | — | 기존 | ○ |
| `TokenMoved` walk (홉마다) | I0 | 착지 프레임: `dust_puff` 0.5× (5f). 6칸 이상이면 `speed_lines`를 이동 방향 뒤로 | 2 (+3) | 회색 | — | `hop`(기존) / `tick`(기존) | ○ |
| `TokenMoved` jump (섬 이동/카드 이동) | I1 | 0–420: 출발지→도착지 `comet` 궤적(포물선, 트레일 glow 6 샘플) → 착지 `ring_shock`+`dust_puff` | 14 | 행위자 색 | — | 기존 / — | ○ |
| `PassedStart` (통과) | I2 | 0: 출발 칸 `star_burst`+`ring_shock` gold(t=0 임팩트) · 66: `moneybag` 팝(스쿼시 1.3/0.75, 5f) · 133–: `coin_spin` 16개 샤워(스태거 25 ms) · 500: 코인들이 행위자 패널로 흡수 곡선 + 도착 시 `sparkle4` · 패널 `float(+급여)` 숫자 롤업(기존) | 코인 16 + 반짝 8 + star/ring 3 = ~28 | gold + 행위자 색 링 | 없음 | `pass-start` → 도착 `cash-in`(피치 래더) / `success` | ○ 칸에서 패널로 |
| `PassedStart.landed` (정확히 착지, 팟 수령) | I3 | 위 + 1.5× 코인(24) + `bill_flutter` 6 + `ray_burst`(600 ms) + `fx.freeze(66)` | ~46 | gold | 4 px / 240 ms | `pass-start` + `cash-in`×2 / `success` | ○ |

### 7.2 돈 · 구매 · 건설

| 이벤트/조건 | 등급 | 시퀀스 (t) | 스프라이트·수량 | 색 | 쉐이크·정지 | SFX / 햅틱 | 좌석 가독성 |
|---|---|---|---|---|---|---|---|
| **탭: 구매/건설/인수 확정 버튼** (프롬프트 순간) | I0 | 0: 버튼 위치 `sparkle4`×4 + `ring_shock` 0.4× (≤100 ms 지연) | 5 | 행위자 색 | — | `tap`(기존) / `tick` | ↻ 버튼은 이미 행위자 쪽 |
| `PropertyBought` 가격<200 | I1 | 0: 지불 코인 5개 패널→칸(스태거 40 ms, 곡선 500 ms) · 300: 소유 색 와이프(기존 stamp) + `ring_shock`+`glint_sweep`(8f) · 333: `sale_tag` 스윙(스쿼시) + `sparkle4`×6 · 800: 정착 | 코인 5 + ~9 = 14 | 행위자 색 + gold | — | `buy` / `success` | ○ 칸 중심, 패널→칸 코인은 지불자 앞에서 출발 |
| `PropertyBought` 200–499 | I1 | 위 + 코인 8, 반짝 10 | 24 | 〃 | — | 〃 | 〃 |
| `PropertyBought` 500–799 | I2 | 위 + 코인 10, `star_burst`, 반짝 14, 칸 `glow` 펄스 | 34 | 〃 | 3 px / 200 ms | 〃 | 〃 |
| `PropertyBought` ≥800 (뉴욕·서울) / 허브 | I2 | 위 + `shine_cross`, 코인 12; 허브는 허브 색 `comet` 1개가 칸 통과 | 44 | 〃 | 4 px / 240 ms | 〃 | 〃 |
| `PropertyBought via:'auction'` | I1 | 위 + 낙찰 `hit_lines`(망치소리 대용) | +6 | 〃 | 2 px | `buy` / `medium` | 〃 |
| `CannotAfford` | I0 | 0: 패널 앞 `dust_puff` 회색 + `smoke` 소(빨강 아님, 회색) | 6 | 회색 | — | `error` / `error` | P |
| `Built` L1 (별장) | I1 | 0: 망치 들어올림 −35°(4f) · 133: 내려침 +20°(2f) + `hit_lines` + 벽돌 조각 4 + `dust_puff` · 133: `fx.freeze(33)` · 200: 건물 팝인(오버슈트 10 %, 기존 `pulseSpace('pop')`) | 망치 1 + 조각 4 + 먼지 3 + hit 6 = 14 | owner 톤 + 갈색 | — | `build` / `light` | ↻ 망치 방향만 행위자 좌석, 나머지는 방사 |
| `Built` L2 (빌딩) | I1 | 타격 2회(간격 233 ms) + 조각 6 + 먼지 2회 | 26 | 〃 | 2 px / 160 ms | 〃 | 〃 |
| `Built` L3 (호텔) | I2 | 타격 3회 + 조각 8 + 먼지 3 + 마지막 타격에 `star_burst` 0.6× + `sparkle4`×8 + 히트스톱 33 | 40 | 〃 + gold | 3 px / 200 ms | `build`(피치 +2) / `medium` | 〃 |
| `Built` L4 (**명소 완성**) | **I3** | 아래 §7.4 "명소 완성" | ≤200 | | | `landmark` / `success`→`heavy` | ○ + Stage 스탬프 ↻ |
| `Built.free` (무료 업그레이드) | +0 | 위에 `heart`/`gold_star` 3개 상승 | +3 | 초록 틴트 추가 | | `build` | ○ |
| `Demolished` typhoon | I2 | 0: 칸 위 `speed_lines` 소용돌이(회전 3 스텝) + `smoke` 3 · 200: 벽돌 조각 8 산개 + `dust_puff` ×2 · 건물 shake(기존) | 30 | 회색·갈색 | 3 px / 200 ms | `warning` / `warning` | ○ |
| `Demolished` sale | I0 | 조각 3 + `dust_puff` | 6 | 갈색 | — | — | ○ |
| `BuildingSold`/`PropertySold` | I1 | 칸→패널로 코인 4(절반 값 느낌: 작은 코인 0.7×) + `dust_puff` | 12 | gold | — | `cash-in` / `light` | ○ |
| `MoneyChanged` reason=`card` (+) | I1 | 패널 앞 `bill_flutter` 낙하 6 + `sparkle4` 4 (+ 액수 티어) | 10 | gold/초록 | — | `cash-in`(피치 래더) / `light` | P |
| `MoneyChanged` reason=`card` (−) | I1 | 패널에서 코인 4가 아래로 흩어짐 + `dust_puff` | 8 | 회색 | — | `cash-out` / `light` | P |
| `MoneyChanged` tax / donation / bail | I1 | 코인 5가 패널→해당 칸(세무서/기부함/섬)으로 곡선 이동, 도착 `dust_puff` | 8 | gold→회색 | — | `cash-out` / `light` | 패널→칸 |
| `MoneyChanged` salary / pot / toll / purchase / build / takeover / bankruptcy | — | **중복 방지**: 전용 이벤트(`PassedStart`/`TollPaid`/…)가 이미 연출 → `MoneyChanged`는 패널 숫자 카운트업(기존)만 | 0 | | | 기존 `cash-in`/`cash-out`(톨 제외) | P |
| `PotChanged` (팟 증가) | I0 | 팟 표시 옆 코인 1–2 팝 | 3 | gold | — | — | ○ |

### 7.3 통행료 · 인수 · 파산 · 부채

| 이벤트/조건 | 등급 | 시퀀스 (t) | 스프라이트·수량 | 색 | 쉐이크·정지 | SFX / 햅틱 | 좌석 가독성 |
|---|---|---|---|---|---|---|---|
| `TollPaid` 금액<300 | I1 | 0: 지불자 패널 `ring_shock`(붉은) + 코인 6 튀어오름 · 150: 코인이 곡선으로 수령자 패널로(스태거 40 ms, 720 ms) · 도착마다 `sparkle4` + 수령 패널 범프(기존) · Stage 톨 카드(기존, ↻) | 코인 6 + 반짝 6 + ring 1 = 13 | gold, ring=지불자 색 | — | `toll` → 첫 도착 `cash-in` / `medium` | P→P (당사자 둘 앞에서 시작/끝) |
| `TollPaid` 300–999 | I2 | 위 + 코인 10, 도착 후 수령자 색 `ring_shock` | 24 | 〃 | 3 px / 200 ms | 〃 (피치 +2) | 〃 |
| `TollPaid` 1000–2499 | I2 | 위 + 코인 14, 지불자 패널에 `smoke` 소, 수령자에 `star_burst` 0.6× | 40 | 〃 | 4 px / 240 ms | 〃 (피치 +4) / `heavy` | 〃 |
| `TollPaid` ≥2500 또는 지불 후 잔액<10 % | I3 | 위 + 코인 14×2 파상(300 ms 간격), 지불자 패널 흔들림 강조 + `smoke`, `fx.freeze(66)`, 수령자 `ray_burst` 400 ms | 70 | 〃 | 8 px / 360 ms | `toll`+`cash-in`(피치 +6) / `heavy` | 〃 |
| `TollPaid.festival` | +1 티어 | 코인 금색 2배 크기 0.3 s 플레어 + `star_burst` gold, 칸 축제 깃발 `flag_wave` 튀어오름 | +10 | gold | +1 px | `toll` + `festival`(gain 0.5) | ○ |
| `TollPaid.multiplier>1` (허브 2배) | +1 티어 | 코인 옆 `comet` 꼬리 | +6 | gold | | 〃 | ○ |
| `TollPaid.waived` (면제권) | I1 | 코인 대신 `sparkle4` 8 + `glow`가 지불자→칸 잠깐, `shield_spark`(v2) | 10 | 하늘 | — | `escape`(대용) / `light` | P |
| `TakenOver` | **I3** | 0: 칸 `siren` 스윕 2회(500 ms, 구매자 좌석으로 회전한 빔) + 판매자 패널 붉은 `ring_shock` (기대) · 500: **임팩트** `fx.freeze(100)` + `stamp_splat`(구매자 색) + `hit_lines` 8 + `ring_shock`×2 스태거 100 ms + 쉐이크 8 px · 600: 소유 색 와이프(기존) · 700: 2× 가격 코인 12(구매자→판매자, 스태거 40 ms) · 1100: 구매자 패널 `sparkle4`×8, 판매자 패널 `dust_puff`(주저앉음) · 1700: 안정 | 코인 12 + siren 4 + 기타 ~40 = ~60 | 구매자 색 vs 판매자 색 | 8 px / 360 ms, 정지 100 | `takeover` / `heavy` | ○ 칸 중심 + P→P 코인 |
| `TakeoverBlocked` (수호 방패) | I2 | 0: 칸에 하늘색 `ring_shock`×2 + `hit_lines`가 **튕겨나감**(반사 각도) + `sparkle4`×8 | 20 | 하늘/흰 | 3 px / 200 ms | `warning` / `warning` | ○ |
| `DebtStarted` | I1 | 지불자 패널 가장자리 `siren`(호박색, 2 사이클) + 코인 진동(위아래 3 px) | siren 4 | 호박 | — | `warning` / `warning` | P |
| `DebtSettled` | I1 | 체크 아이콘 대신 `sparkle4`×6 초록 + 코인 착지 | 8 | 초록 | — | `cash-in` / `light` | P |
| `PropertyTransferred` (파산 자산 이전) | I0–I1 | 칸마다 60–90 ms 순차: `ring_shock` 수령자 색 + `sparkle4`. **처음 6칸만 파티클** | ≤ 6×3 | 수령자 색 | — | `tap`(피치↑) | ○ |
| `Bankrupt` | **I3(부정 톤)** | 0: 패널 탈색·붉은 `siren`(기존 breakApart + FX) · 400: **임팩트** `fx.freeze(100)` + `smoke`×3 + 벽돌 조각 10 + 동전 12가 패널에서 쏟아져 화면 아래로 바운스 + 쉐이크 6 px · 900: 회색 먼지 드리프트 · 폭죽/색종이 없음 · 1600: 안정 | 30 + smoke 3 | 회색·붉은 | 6 px / 320 ms, 정지 100 | `bankrupt` / `heavy` | P (파산자 앞) + ○ 쉐이크 |
| `AuctionStarted` | I1 | 칸에 `sale_tag` 스윙 + `ring_shock` | 8 | gold | — | 기존 | ○ |
| `AuctionBid` | I0 | 입찰자 패널 코인 2 팝 + 피치 래더 상승 | 3 | 입찰자 색 | — | `tap`(피치 +k) / — | P |
| `AuctionEnded` (낙찰) | — | `PropertyBought via:'auction'`로 처리 | | | | | |
| `AuctionDropped` | — | 없음 | | | | | |

### 7.4 명소 · 독점 · 축제 · 섬 · 카드 · 여행 · 승리

**명소 완성** (`Built.level==4`, I3, 총 2.0 s, 블록 900 ms, 파티클 ≤200)

| t (프레임) | 비트 | 내용 |
|---|---|---|
| 0–300 (0–9f) | 기대 | 다른 연출 정지·주목: 해당 칸 `glow` 확대 + 칸 주변 `sparkle4` 6 수렴(빨려 듦), 사운드 `landmark` 상승음 시작 |
| 300 (9f) | 임팩트 | 왕관이 위에서 낙하 착지(스쿼시 1.3×/0.75×, `crown`) · **`fx.freeze(100)`** · `ring_shock`×2(t, t+100 ms) · `star_burst` · 쉐이크 **8 px/360 ms** · 플래시 2f(α 0.25, `glow` 대형) · haptic `heavy` |
| 400–1200 | 보상 | `ray_burst` 회전(가산, 800 ms 페이드) · `firework`×3(칸 좌/우/상 오프셋, 스태거 150 ms, 소유 색+금+흰) · `confetti` 60(소유 색+금, 칸에서 위로 발사→중력) · `coin_spin` 20 샤워 · `glint_sweep`×2 · `shine_cross` · Stage 스탬프 "명소 완성"(기존 ↻) · haptic `success`(t+400) |
| 1200–2000 | 안정 | 잔여 반짝 감소, 칸 정적 글로우(CSS, 상시 정적)로 전환. 파티클 0 → 팝인 정착 |

- `landmark` 사운드 + 피치 +0, `success`/`heavy` 두 번의 햅틱(임팩트 `heavy`, 보상 `success`).
- 독점·랜드마크가 동시에 완성되면 §6.2-3 복합 프리셋.

| 이벤트/조건 | 등급 | 시퀀스 (t) | 스프라이트·수량 | 색 | 쉐이크·정지 | SFX / 햅틱 | 좌석 가독성 |
|---|---|---|---|---|---|---|---|
| **독점 완성** (파생 `GroupCompleted`: 컬러 그룹 전체 소유) | **I3** | 0: 그룹 칸들 순차(60–90 ms 간격) `glint_sweep` + 소유 색 `ring_shock` · 칸 수×90+200: 그룹 색 `ray_burst` 중앙 · `star_burst`×칸 수 · 그룹 색 `confetti` 40 · 통행료 ×2 배지 "×2"(DOM) 팝 · `fx.freeze(66)` | ~90 | 그룹 색 + 소유 색 | 6 px / 300 ms | `landmark`(피치 +3) / `success` | ○ 그룹 전체 칸이 보임(방향 무관) |
| **한 칸 남음** `OneAway` | I1 | 0: 누락 칸에 `ring_shock` 소유 색 ×2(간격 500 ms; 초당 ≤2회) + `sparkle4` 깜빡 3회 · 기존 `edgeToast` 4장(↻) | 12 | 소유 색 | — | `warning` / `warning` | ○ 칸 + 4변 토스트 |
| `FestivalSet` (새 칸) | I2 | 0: 이전 축제 칸→새 칸 `comet` 궤적(있을 때, 400 ms) · 400: 새 칸에 `flag_wave`×3 튀어오름(스쿼시) + `star_burst` gold ×2 + `confetti` 30(금·흰·소유 색) + `glow` | ~50 | gold + 소유 색 | 3 px / 200 ms | `festival` / `success` | ○ |
| `FestivalSet` (없음/null) | I0 | 이전 칸에서 깃발이 사라지는 `dust_puff` | 4 | 회색 | — | — | ○ |
| `SentToIsland` space/card | I2 | (`TokenMoved jump` 혜성 후) 착수 칸: 하늘색 `ring_shock`×3 스태거 120 ms + `confetti_dot` 물방울 12 위로 튀고 낙하 + `dust_puff` 하늘 | ~24 | 하늘/흰 | 3 px / 200 ms | `island` / `warning` | ○ |
| `SentToIsland` doubles (3연속) | I2 | 앞서 `siren` 스윕(§7.1 3연속 더블)와 연계, 착수 동일 | | | | | |
| `IslandStay` | I0 | 섬 칸 잔물결 `ring_shock` 하늘 ×2 | 2 | 하늘 | — | — | ○ |
| `Escaped` doubles | I1 | 토큰 `star_burst` + 물방울 상승 + `speed_lines` 위로 | 14 | 금/하늘 | — | `escape` / `light` | ○ |
| `Escaped` bail | I1 | 코인 5가 패널→섬 곡선 이동 후 위 연출 | 20 | 금 | | `escape` + `cash-out` / `light` | 패널→칸 |
| `Escaped` card / served | I1 | 카드 아이콘 소멸 `dust_puff`+`sparkle4` / 조용히 `ring_shock` | 10 | 흰/금 | | `escape` | ○ |
| `CardDrawn` (카드 톤별) | I1 | 카드 뒤집기 시작(기존 `showCard`) 0: 카드 뒷면 테두리 `glow`(톤 색: 좋음=금, 나쁨=붉은 회색, 이동=하늘, 보관=보라) · 뒤집힘 정점(≈200 ms) `sparkle4`×6 스태거 · 결과 후속 이벤트로 이어짐 | 10 | 톤 색 | — | `card` / — | ↻ 카드는 Stage(행위자 쪽), 반짝은 방향 무관 |
| `CardKept` | I0 | 카드 아이콘이 패널로 날아감(`sparkle4` 트레일 6 샘플) | 8 | 보라/금 | — | `tap` | P |
| `CardUsed` | I0 | 패널 위 아이콘 소멸 `dust_puff`+`sparkle4` | 6 | 흰 | — | 기존 | P |
| `CardNoEffect` | I0 | `dust_puff` 소 | 3 | 회색 | — | — | ○ |
| `ExpressGranted` | I1 | 패널 앞 `speed_lines`+`comet` 1 | 5 | gold | — | `travel` / `light` | P |
| `TravelGranted` | I1 | 여행 칸 위로 `comet`×3 원형 상승 + `ring_shock` + `sparkle4` | 14 | 하늘/금 | — | `travel` / `light` | ○ |
| `TravelDeclined` | — | 없음 | | | | | |
| **`GameOver` 공통** | **I4** | 0: `stage.clearPrompt`(기존) · 승자 패널에 `crown` 낙하(스쿼시) + `ray_burst` 2.4 s(승자 색) + `glint_sweep`×2 · 정지 `fx.freeze(100)` · 대포 2문(승자 패널 양옆 모서리) `confetti` 100(5종 모양·8색) 중력 방향=승자 좌석 아래 | 상한 300 | 승자 색 + 8색 | 12 px / 480 ms | `win` / `success` | ○ 중앙·패널 앵커, 결과 히어로는 기존 |
| `GameOver` triple | I4 | 공통 + 3그룹 칸에서 그룹 색 `firework` 각 2발, 그룹 순 스태거 300 ms | +36 | 그룹 3색 | | 〃 | ○ |
| `GameOver` line | I4 | 공통 + 변의 칸 7개를 80 ms 간격으로 훑는 `glint_sweep`+`comet`, 이어 각 칸 `sparkle4`, 변 중앙 `firework` ×3 | +40 | 소유 색+금 | | 〃 | ○ |
| `GameOver` hubs | I4 | 공통 + 4 허브 칸에서 `comet` 로켓이 중앙으로 수렴(500 ms) → 대형 `firework`×2 + `shine_cross` | +36 | 허브 슬레이트+금 | | 〃 | ○ |
| `GameOver` bankruptcy / lastStanding | I4 | 공통 + 승자 코인 비(`coin_spin` 24, 위에서 낙하) | +24 | 금 | | 〃 | ○ |
| `GameOver` roundLimit | I4 | 공통(대포 색종이 위주, 불꽃 2발) | | | | 〃 | ○ |

**"첫 파산"**: 기본 규칙 `endOnFirstBankruptcy`=on → 첫 파산이 곧 게임 종료. 따라서 `Bankrupt`(I3 부정 톤) 직후 `GameOver`(I4 축하)가 이어진다 — 두 연출 사이에 300–500 ms 무음 여백을 둔다(감정 전환). 규칙이 off(탈락제)면 `Bankrupt`만 재생.

### 7.5 프리셋 사전 (구현 단위)

| 프리셋 | 구성 | 기본 파라미터 |
|---|---|---|
| `tap` | `sparkle4`×4 + `ring_shock` 0.4× | 100 ms |
| `hopDust` | `dust_puff` 0.5× | 5f |
| `coinArc(from,to,n)` | `coin_spin` n개, 2차 베지어, 스태거 40 ms, 720 ms, 스쿼시 0.7–1.2, 트레일 `glow` 6 샘플, 도착 시 `sparkle4` | n ≤14 |
| `coinShower(at,n)` | 위로 발사 후 중력, `coin_spin`, 스태거 25 ms | n ≤24 |
| `billRain(at,n)` | `bill_flutter` 낙하 | n ≤10 |
| `sparkleField(at,r,n)` | `sparkle4` 랜덤 위상·스태거 25 ms | n ≤14 |
| `starBurst(at)` | `star_burst` 8f + `ring_shock` 6f | |
| `ringPulse(at,color)` | `ring_shock` | |
| `dustPuff(at,n)` | `dust_puff` | |
| `hammerHit(at,seat,level)` | `hammer` 회전 스윙(−35°→+20°, 4f+2f) + `hit_lines` + `brick_chip` + `dust_puff`, 레벨=타격 횟수 | |
| `crownDrop(at)` | `crown` 낙하+스쿼시 + `glint_sweep` | |
| `rays(at,color,ms)` | `ray_burst` 회전 가산 | |
| `firework(at,color)` | `firework` 12f + `sparkle4` 낙하 꼬리 | |
| `confetti(from,dir,n)` | 5종 모양 랜덤, `scaleX=cos(flip)`, 중력·공기저항 | n ≤100 |
| `stampImpact(at,color)` | `stamp_splat` + `hit_lines` | |
| `siren(at,seat,cycles)` | `siren` 4f 회전 스윕 | 2 사이클/1 s |
| `flagPop(at,color)` | `flag_wave` 튀어오름 스쿼시 | |
| `comet(from,to)` | `comet` + `glow` 트레일 | |
| `smoke(at,n)` | `smoke` 상승 | |
| `splash(at)` | `ring_shock` ×3 + `confetti_dot` 물방울 | |
| `landmark` / `monopoly` / `victory(kind)` | 위 프리셋 조합 타임라인(§7.4) | |

---

## 8. 접근성·안전·회귀 방지

### 8.1 플래시
- `flashBudget`(§3.7): 1 s 창 내 플래시 프레임 ≤3, 알파 ≤0.25, 붉은 대면적 플래시 금지. 경광등은 **스윕**(빔 회전, 사이클 ≤2/s).

### 8.2 다국어·회전
- 캔버스에 문자 없음 → i18n·폰트 서브셋(`fonts.test.ts`)과 무관. 문구는 기존 스탬프/토스트.

### 8.3 접근성 폴백 (reduced-motion / 절전)
- `prefers-reduced-motion: reduce` 또는 앱 내 "애니메이션 줄이기" 설정: **캔버스 미생성**. 대신 **정적 표식** — 해당 칸/패널에 색 테두리 하이라이트 800 ms(DOM 클래스 토글 1회, 애니메이션 없음) + 사운드 + 햅틱은 유지. 큰 순간(I3+)은 Stage 스탬프(기존, 이미 `instant()` 처리 여부 확인)로 텍스트 전달.
- 테스트용 `setAnimSpeed(0)`도 캔버스 미생성(현행 `instant()`와 동일).
- 절전 모드(30 fps)는 그대로 30 Hz 격자; 60 fps 모드에서도 FX 스텝은 `setFrameRate` 따라감(`onFrame`).

### 8.4 회귀 방지
- 이벤트 매핑은 `satisfies Record<GameEventType, EventFx>`로 **모든 이벤트에 항목을 강제**(새 엔진 이벤트가 생기면 컴파일 에러).
- 프리셋 파티클 요청량 합계가 등급 상한을 넘지 않는지 단위 테스트(§9.1).

---

## 9. 성능 예산

| 항목 | 예산 | 근거/게이트 |
|---|---|---|
| 라이브 파티클 | **≤300** (이벤트 등급별 상한 §6.1) | 요구, 예산기 강제 |
| FX 캔버스 | 동시 1장, 백킹 ≤0.9 MP (≤3.6 MB) | 리서치 §2.3 |
| GPU 레이어 | 피크 **+1**(현재 17 → ≤18, 게이트 ≤20) | PERFORMANCE.md C |
| 레이어 메모리 | +≤4 MB (현재 피크 89.2 MB → ≤100 MB 게이트) | 〃 |
| 이미지 메모리(레이어 외) | 아틀라스 4.5 MB + 틴트 캐시 ≤8 MB | §3.6 |
| 다운로드 | 아틀라스 ≤500 KB(예상 182 KB) + JSON ≤12 KB | 요구 |
| JS 프레임 비용 | update+draw ≤2 ms @1× (300개), ≤8 ms @4× | 벤치: 4× 스로틀 150개에서 메인 118 ms/s ≈ 4 ms/프레임(리서치 §2.3 #4–#7) |
| 표시 fps (FX 중) | 26–34 (30 Hz 격자만) | 게이트 A |
| 유휴 | 이펙트 종료 후 **캔버스 hidden·백킹 0·`onFrame` 0·타이머 0**, 10 s 창 Layout/Paint/Raster/rAF 0 | 게이트 B |
| 할당 | 프레임 루프 내 객체 할당 0(SoA 풀, 틴트 캐시 사전 조회), JS 힙 20회 반복 후 +≤5 MB | 누수 게이트 |
| 부팅 | 아틀라스 로드는 게임 화면 마운트 후; Title 부팅 ≤1.5 s 게이트 불변 | 게이트 C |
| 프레임 지연 | `play()`는 상태 렌더 다음 프레임, 리전 확대는 `play()` 프레임 1회, 캔버스 생성은 마운트 시 1회 | PERFORMANCE §7 |

---

## 10. 테스트 계획

### 10.1 단위 (vitest, DOM/캔버스 불필요한 순수 로직)
1. `rng.ts` 시드 결정성, 파티클 적분(고정 dt) 스냅샷.
2. 예산기: 요청 초과 시 감량 규칙, 300 상한, 우선순위 회수, `flashBudget`.
3. 매핑 완전성: `Object.keys(eventFx)`가 `GameEventType` 전체를 덮음(컴파일 타임 `satisfies` + 런타임 검사).
4. 프리셋 요청량 ≤ 등급 상한; 타임라인 길이 ≤ 등급 총 길이(피날레 ≤4 s).
5. 콤보 병합: 400 ms 창 내 동일 계열 합산·상한, 피치 래더(0..7, 1.5 s 리셋).
6. 아틀라스 무결성(`public/fx/fx-atlas.json`): 크기 ≤1024², 사각형 겹침 없음, 패딩, WebP+JSON 합계 ≤500 KB, 프리셋 참조 스프라이트 존재.
7. 스프라이트 SVG에 `<text>`가 없음(문자 금지 규칙) — `scripts/fx/sprites.mjs` 산출 SVG 정적 검사.

### 10.2 e2e — Playwright 스크린샷·프레임 검증
- dev 훅 확장 제안(`isDevHook()` 한정, `window.__lotAndRoll.fx`): `play(preset, anchor, ctx)`, `step(frames)`(고정 스텝 전진), `pause()/resume()`, `liveCount()`, `canvasState()`(hidden/크기), `activeTicks()`(=`activeFrameTicks()`).
- **프리셋별 키프레임 스냅샷**: `page.clock.install()`으로 시간 고정 → `fx.play('landmark', {space:31}, {seed:1})` → `clock.runFor(ms)`로 프리셋별 [기대 끝, 임팩트, 보상 중간, 안정 직전] 4장을 `toHaveScreenshot`(영역 클립, `maxDiffPixelRatio 0.02`)로 `e2e/__screenshots__/fx/`에 저장. 시드 고정이라 결정적.
- **컨택트 시트**: 프리셋별 프레임 스트립을 만들어 사람이 시각 검토(`docs/assets/fx-contact-*.png`).
- **비디오**: `recordVideo`(800×500, 30 fps) → `/opt/pw-browsers/ffmpeg-1011`로 `-vf fps=30,tile=10x3`. 실시간 의존이라 타이밍 정확도 검증용이 아니라 리듬 확인용.
- 이벤트 통합 시나리오(`loadState`로 만든 상태 + `dispatch`): 구매/건설 L1–L4/통행료(소·중·대)/인수/축제/섬/카드/파산/승리 종류별로 각각 재생 → 콘솔 에러 0, `liveCount() ≤ 300`, 종료 후 `canvasState()==hidden`, `activeTicks()==0`.
- 접근성: `page.emulateMedia({ reducedMotion:'reduce' })` → 어떤 이벤트에서도 FX 캔버스 미생성, 정적 표식 클래스 토글, `sfx.play` 호출 유지.
- 스킵: 피날레 재생 중 탭 → 500 ms 이내 종료.
- 다국어(ko/en)/4해상도(1600×1000, 2560×1600, 1024×768, 800×450) 스냅샷에서 텍스트 겹침 없음(FX에 글자가 없음을 보장).

### 10.3 성능 게이트 — `scripts/perf.mjs`에 `fx` 페이즈 추가
`node scripts/perf.mjs --phases fx` (사전 `npx vite build`). 4× 스로틀, DPR 2, 1600×1000, 손으로 만든 상태를 `loadState`로 로드, 최악 시나리오(연속: 통행료 XL → 인수 → 명소 완성+독점 → 파산 → GameOver hubs)를 훅으로 재생.

| 게이트 | 기준 |
|---|---|
| F1 유휴 복귀 | 마지막 FX 종료 500 ms 후 10 s 창: Layout/Paint/Raster/style ≤1/rAF/timer/layerPainted 모두 0 (기존 B 기준), 캔버스 hidden, `activeFrameTicks()==0` |
| F2 파티클 상한 | 재생 중 `liveCount()` 최대 ≤300 |
| F3 레이어 | FX 재생 창 피크 레이어 ≤20, 피크 레이어 메모리 ≤100 MB (기존 C 기준, LayerTree 방식) |
| F4 프레임 상한 | FX 창 표시 fps(DrawFrame) ≤34, 고유 프레임(`--unique`) ≥24 |
| F5 지연 | FX 창 rAF 간격 p95 ≤33 ms(정보: p99, 33 ms 초과 프레임 수) |
| F6 메인 스레드 | FX 창 `TaskDuration` ≤ 150 ms/s @4× (벤치 118 ms/s 기준 여유) |
| F7 누수 | 20회 반복 후 JS 힙 증가 ≤5 MB, DOM 노드 증가 0, 캔버스 수 ≤1 |
| F8 에셋 | 아틀라스+JSON ≤500 KB (정적 검사) |
| F9 부팅 | Title 부팅 ≤1.5 s 게이트 불변(`boot` 페이즈 재사용) |
| F10 스킵 | 피날레 `skip()` 후 ≤500 ms에 종료 |

### 10.4 실기기 (필수, 에스컬레이션 판단용)
- 저/중/고 사양 Android 태블릿 3종: 스트레스 시나리오 실행 → `adb shell dumpsys gfxinfo <pkg> framestats`(jank %), Perfetto 트레이스(메인 스레드 프레임당 JS, RenderThread/GPU), `dumpsys SurfaceFlinger` 주사율.
- A/B: `fxConfig.softwareCanvas` on/off, 백킹 스케일 0.75/1.0/1.5, Canvas2D vs (필요 시) Pixi 백엔드.
- 에스컬레이션 판정: 리서치 §2.7 조건.

---

## 11. 구현 순서·공수

| 단계 | 내용 | 산출/검증 | 공수 |
|---|---|---|---|
| **S0 스파이크** | `engine.ts`+`renderer2d.ts` 최소판 + 기존 `coinArc`를 새 엔진으로, 임시 아틀라스(프로토타입 그대로) | 실기기 A/B(§10.4), 에스컬레이션 판단 | 1 |
| **S1 파이프라인** | `scripts/fx/*`, `npm run fx:atlas`, 컨택트 시트, 아틀라스 검증 테스트 | `public/fx/*` 커밋, ≤500 KB | 1 |
| **S2 스프라이트 미술** | 목록 30종 다듬기(문자 제거, 스타일 통일) | 컨택트 시트 리뷰 | 1–1.5 |
| **S3 프리셋** | §7.5 프리셋 + 타임라인 + 예산기/콤보 | 단위 테스트, 프리셋 스냅샷 | 2 |
| **S4 시퀀서 연동** | `animate.ts` 매핑(`satisfies`), `GroupCompleted` 파생, 쉐이크 확장, 탭 프롬프트 훅, 접근성 폴백 | 통합 e2e | 1 |
| **S5 게이트/문서** | `perf.mjs fx` 페이즈, PERFORMANCE.md 갱신 | F1–F10 통과 | 1 |
| 합계 | | | **약 7–7.5 에이전트-일** |

**의존/주의**
- `src/ui/fx/animate.ts`·`Stage.ts` 등은 다른 에이전트가 수정 중이므로 S4는 해당 작업 병합 후 진행.
- 추가가 필요한 작은 API: `board.spaceSize(i)`(칸 픽셀 크기), `PlayerPanel.clientRect()`(현재 `clientCenter()`만), `time.ts`에 `reducedMotion()` 노출(현재 `instant()`에 합쳐져 있어 정적 표식 분기 불가), `shake()`의 다중 요소 지원, dev 훅 `fx`.
- 리스크 상위 3: (1) 실기기 Canvas2D 성능 미측정(SwiftShader 벤치만), (2) 4× 프레임 지연 게이트가 이미 미달 → FX가 겹치지 않도록 시작 지연 유지, (3) 스프라이트 미술 품질(프로토타입은 기하 도형 초안).

---

## 12. 스프라이트 아틀라스 빌드 (실제 구현)

§4–§5의 설계가 `scripts/fx/*` + `src/content/fx/*`로 구현되어 있다(스프라이트 30종 / **125프레임**: 색 10종 29프레임 + 마스크 20종 96프레임).

### 실행

```
npm run fx:atlas                      # 베이크 + 매니페스트 + 컨택트 시트 (Chromium 필요, 약 2 s)
node scripts/fx/bake.mjs --no-sheet   # 컨택트 시트 생략
node scripts/fx/contact-sheet.mjs [--parts <dir>]   # 시트만 다시 그림(--parts: 1000 px 단위 검토용 조각 저장)
```

환경 변수: `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`(기본 `/opt/node22/lib/node_modules/playwright/index.mjs`, `/opt/pw-browsers/chromium`), `FX_DPR`(기본 2), `FX_QUALITY`(WebP, 기본 0.9). 산출물은 저장소에 커밋하므로 일반 빌드/CI는 Playwright가 필요 없다.

### 파이프라인

1. `src/content/fx/sprites-color.ts` / `sprites-mask.ts`의 정의(`SpriteDef`: `name, cls, w, h, n, fps, loop, k?, svg(i, n)`)를 esbuild로 번들해 Node에서 실행 → 프레임별 SVG 문자열(순수 함수, 시드 PRNG `mulberry32` → 결정적).
2. 헤드리스 Chromium에서 `ceil(w·DPR·k) × ceil(h·DPR·k)`로 래스터(DPR 2, `k`는 부드러운 스프라이트의 추가 축소) → 알파 ≥ 4 바운딩 박스로 트림. 박스 가장자리에 닿는 프레임은 경고(`edgeOk: true`로 의도된 경우 제외).
3. Node에서 `maxrects-packer`(패딩 2 px, 회전 없음, 비-POT, 최대 2048²)로 클래스별 패킹 → Chromium 캔버스에 합성 → `canvas.toBlob('image/webp', 0.9)`. 네이티브 의존성 없음.
4. 출력: `public/fx/atlas-color.webp`, `public/fx/atlas-mask.webp`, `public/fx/atlas.json`, `src/content/fx/manifest.ts`(생성물, 수정 금지), `docs/assets/fx-contact-sheet.png`.

### `atlas.json`

```
{ v:1, dpr:2, ref:30,
  atlases:{ color:{file,w,h,bytes}, mask:{…} },
  anims:{ "coin_spin":{ atlas, n, frames:["coin_spin/0",…], fps, loop, w, h, k, scale } },
  frames:{ "coin_spin/0":{ a, x,y,w,h, ox,oy, sw,sh } } }
```

- `x,y,w,h` = 아틀라스 안 트림 사각형, `ox,oy` = 원본(`sw×sh` 래스터) 안에서 트림 사각형의 왼쪽 위, `scale = dpr·k`(공칭 px당 래스터 px).
- 그리기: 공칭 박스 왼쪽 위를 `(X, Y)`, 표시 배율 `s`(공칭 1 = 1 CSS px)라 하면 `drawImage(atlas, x,y,w,h, X + ox/scale·s, Y + oy/scale·s, w/scale·s, h/scale·s)`. 앵커(중심) = 공칭 박스 중심.
- `manifest.ts`: `FX_ANIM_NAMES`(문자열 리터럴 유니온 `FxAnimName`), `FX_ANIMS: Record<FxAnimName, FxAnimMeta>`, `FX_FILES`, `FX_BAKE`, `FX_FRAME_TOTAL`, `fxFrameKey(anim, i)`. 타입은 `src/content/fx/types.ts`.

### 스프라이트 추가 방법

1. `sprites-color.ts`(고정색) 또는 `sprites-mask.ts`(흰색+알파)에 `svg(i, n)` 함수를 쓰고 배열 `COLOR_SPRITES`/`MASK_SPRITES`에 `SpriteDef`를 추가(`viewBox="0 0 w h"` 필수, 텍스트·숫자·통화 기호 금지 — 베이커와 vitest가 `<text>`를 거부).
2. `npm run fx:atlas` → 컨택트 시트에서 24/48/96 px 가독성과 어두운/밝은 배경을 확인.
3. `npm test`(`src/content/fx/__tests__/manifest.test.ts`)와 `npm run typecheck` 통과 후 산출물(`public/fx/*`, `manifest.ts`, 시트)을 함께 커밋.

### 틴트·블렌드 규약

- 색 아틀라스: 그대로 `drawImage`(source-over). 팔레트는 기존 아이콘과 동일(금 `#FFC94A/#E9A92A`, 그림자 `#2B3245`), 외곽선 없이 아래로 2 단위 어두운 사본을 깔고 위에 밝은 층을 얹는 2톤.
- 마스크 아틀라스: **순백 + 알파만**(음영은 알파로 표현, 회색 금지). 런타임 틴트는 오프스크린에 그린 뒤 `source-in` 채우기(=곱셈)로 캐시, 빛 효과는 틴트 결과를 `globalCompositeOperation='lighter'`로 가산. 밝은 배경 위의 일반 블렌드도 가능(컨택트 시트의 밝은 열이 그 예).
- 컨페티 5종은 1프레임(뒤집힘은 `scaleX = cos`), `ray_burst`·`glow`는 1프레임(회전/스케일은 코드), `flag_wave`는 소유자 색 틴트.

### 크기 (DPR 2, WebP q0.9)

| 파일 | 크기(px) | 바이트 |
|---|---|---|
| `atlas-color.webp` (29프레임) | 484×484 | 65.7 KB |
| `atlas-mask.webp` (96프레임) | 1156×1156 | 205.5 KB |
| `atlas.json` | — | 16.0 KB |
| **합계** | | **≈287 KB** (목표 ≤300, 예산 ≤500) |

프로토타입(1.5× 베이크, 182 KB) 대비 DPR 2 선명도를 위해 커졌으나 예산 이내. 프레임 추가 시 마스크 아틀라스는 2048² 한도까지 여유가 있다. §5의 파일명(`bake-atlas.mjs`, `fx-color.webp`, `fx-atlas.json`)은 위 실제 이름(`bake.mjs`, `atlas-color.webp`, `atlas.json`)으로 대체됐다.

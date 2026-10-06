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
- WebGL 신규 위험(컨텍스트 로스트, 저사양 GPU, 셰이더 컴파일) 회피, 기존 `particles.ts`(구 `src/ui/fx/particles.ts`, §14.1에서 삭제) 패턴 계승.
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

- 엔진 시간 `fxNow` 은 `onFrame(now)`의 `now` 차이를 누적: `elapsed += (now - last) × animSpeed() × (isSkipping() ? 5 : 1)` (구 `src/ui/fx/particles.ts`와 동일 패턴). 파티클은 **고정 스텝 dt=1/30 s** 적분(스킵 시 스텝 크기만 ×5, 서브스텝 없음).
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
  atlas.ts        atlas.json 로드, createImageBitmap, 프레임 조회
  presets.ts      프리셋(이미터 타임라인) 정의: toll, buy, build, landmark, takeover, ...
  map.ts          GameEvent → 프리셋 매핑(§7), 등급·금액 티어 함수, 콤보 병합
  rng.ts          mulberry32 시드 PRNG (엔진 rng와 독립)
public/fx/        atlas-color.webp  atlas-mask.webp  atlas.json   (빌드 산출물, 커밋)
src/content/fx/   sprites.ts (스프라이트 정의)
scripts/fx/       bake.mjs  contact-sheet.mjs
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
- 구 `src/ui/fx/particles.ts`의 `coinShower/coinArc/confetti`는 프리셋으로 이관했고 그 모듈은 지웠다(§14.1: 통과 샤워 → `passStart`, 통행료 호 → `tollPay`, 승리 색종이 → `victory`, 결과 화면 → `confettiRain`).
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
src/content/fx/sprites.ts     스프라이트 정의: { name, cls:'color'|'mask', w, h, frames, k?, svg(i, n) → SVG 문자열 }
scripts/fx/bake.mjs           Playwright(Chromium) → 래스터 → 알파 트림 → MaxRects → WebP/PNG → JSON
npm run fx:atlas              위 스크립트 실행 (node scripts/fx/bake.mjs), 산출물을 public/fx/ 에 기록
scripts/fx/contact-sheet.mjs  아틀라스 + 프레임 재생 컨택트 시트 PNG (docs/assets/fx-contact-sheet.png) — 시각 검토용
```

- 도구: devDependency `@playwright/test`, Chromium `/opt/pw-browsers/chromium`(`CHROMIUM_PATH`로 재정의, `scripts/fx/common.mjs`). 추가 devDependency: **`maxrects-packer`(MIT, 순수 JS)** 1개. `sharp` 등 네이티브 의존성 불필요(WebP 인코딩은 Chromium `OffscreenCanvas.convertToBlob`).
- 알고리즘(프로토타입 검증):
  1. 각 프레임: SVG → `data:` URL → `Image.decode()` → `OffscreenCanvas(ceil(w×1.5×k), ceil(h×1.5×k))`에 그리기 → `getImageData`로 알파>6 바운딩 박스 → 트림.
  2. 클래스(색/마스크)별로 `new MaxRectsPacker(1024, 1024, 2, { smart:true, pot:true, allowRotation:false })` (색은 256×512로 충분; 프레임이 늘면 자동 탐색).
  3. 아틀라스 캔버스에 배치 후 `convertToBlob({type:'image/webp', quality:0.9})` 및 PNG.
  4. `atlas.json`: `{ v:1, scale:1.5, ref:30, color:{w,h,file}, mask:{...}, frames:{ "sparkle4/0":[ax,ay,tw,th,x0,y0,W,H,k], ... }, anims:{ "sparkle4":{n:6,fps:20} } }`. 그릴 때 앵커 복원: `dx = (x0 - W/2)/scale`, `dy = (y0 - H/2)/scale`.
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

> **2026-10-05: 게임에서는 이 절의 돈 프리셋(plotClaim, buildSeq, landmarkReveal, tollPay, takeoverStamp,
> passStart, billRain, coinIn, bankruptcy)이 재생되지 않는다.** 모든 돈 이벤트는 DOM 머니 컷인이 맡는다
> (`docs/MONEY-EVENTS.md` §11). 프리셋 코드는 FX 데모·성능 재생(`npm run perf` fx 단계)용으로 남아 있다.

| 이벤트/조건 | 등급 | 시퀀스 (t) | 스프라이트·수량 | 색 | 쉐이크·정지 | SFX / 햅틱 | 좌석 가독성 |
|---|---|---|---|---|---|---|---|
| **탭: 구매/건설/인수 확정 버튼** (프롬프트 순간) | I0 | 0: 버튼 위치 `sparkle4`×4 + `ring_shock` 0.4× (≤100 ms 지연) | 5 | 행위자 색 | — | `tap`(기존) / `tick` | ↻ 버튼은 이미 행위자 쪽 |
| `PropertyBought` 가격<200 | I1 | 0: 지불 코인 5개 패널→칸(스태거 40 ms, 곡선 500 ms) · 300: 소유 색 와이프(기존 stamp) + `ring_shock`+`glint_sweep`(8f) · 333: `sale_tag` 스윙(스쿼시) + `sparkle4`×6 · 800: 정착 | 코인 5 + ~9 = 14 | 행위자 색 + gold | — | `buy` / `success` | ○ 칸 중심, 패널→칸 코인은 지불자 앞에서 출발 |
| `PropertyBought` 200–499 | I1 | 위 + 코인 8, 반짝 10 | 24 | 〃 | — | 〃 | 〃 |
| `PropertyBought` 500–799 | I2 | 위 + 코인 10, `star_burst`, 반짝 14, 칸 `glow` 펄스 | 34 | 〃 | 3 px / 200 ms | 〃 | 〃 |
| `PropertyBought` ≥800 (뉴욕·서울) / 허브 | I2 | 위 + `shine_cross`, 코인 12; 허브는 허브 색 `comet` 1개가 칸 통과 | 44 | 〃 | 4 px / 240 ms | 〃 | 〃 |
| `PropertyBought via:'auction'` | I1 | 위 + 낙찰 `hit_lines`(망치소리 대용) | +6 | 〃 | 2 px | `buy` / `medium` | 〃 |
| `CannotAfford` | I0 | 0: 패널 앞 `dust_puff` 회색 + `smoke` 소(빨강 아님, 회색) | 6 | 회색 | — | `error` / `error` | P |
| `Built` L1 (별장) | I1 | **24f · 정본 §7.2b.2**: 납품 코인 3 → 망치 1타(f5 접촉, 정지 1f) → 먼지 속 swap(f6) → 팝 8 %(f6–f14) + 흰 반짝 4 + ★1 + 굴뚝 연기 | 코인 3 + 망치·히트·조각·먼지 6 + 링·반짝·핍·연기 7 = 17 | owner 톤 + 갈색 + 흰 | — / 정지 1f | `build`(k0) / `light` | ↻ 망치만 행위자 좌석, 나머지 방사 |
| `Built` L2 (빌딩) | I1 | **27f · 정본 §7.2b.3**: 타격 2회(f4, f8) → swap(f9) → 팝 10 % + 흰·**금** 반짝 10 + 금 글린트 + ★★ + 연기 2 | 33 | 〃 + 금 | 2 px / 160 ms, 정지 1f | `build`(k+1) / `light` | 〃 |
| `Built` L3 (호텔) | I2 | **36f · 정본 §7.2b.4**: 타격 3회(f4, f8, f12) → 먼지 커튼 → swap(f13) → 팝 12 % + `zoomPunch 1.10` + 링 2겹 + `star_burst` + `shine_cross` + 흰·금·**소유 색** 반짝 16 + ★★★ + 깃발 | 55 | 〃 + gold | 3 px / 200 ms, 정지 1f | `build`(k+4 래더) → `buy` / `medium`→`success` | 〃 |
| `Built` L4 (**명소 완성**) | **I3** | **58f + 정지 3f · 정본 §7.2b.5**(§7.4 요약): 납품·스포트라이트·클로즈업 카드 → 타격 3회 → 크라운 낙하 → 먼지 커튼 swap(f17) → **f19 임팩트** | 171 (상한 200) | | 8 px / 360 ms, 정지 3f | `landmark`+쿵 / `heavy`→`success` | ○ + Stage 스탬프 ↻ + 클로즈업 카드 |
| `Built.free` (무료 업그레이드) | 기존 유지 | **정본 §7.2b.6**: 납품 코인·망치 없음 → 카드에서 `comet`이 칸에 착탄(f7) → 먼지 속 swap(f8) → 티어 레이어 + **초록 반짝 6 + 하트 2** | k=1..3: 19 / 29 / 43 | 초록 틴트 추가 | 정지 1f | `card` → `build`(+3반음) / `light` | ○ 행위자 쪽 카드에서 칸으로 날아옴 |
| `Demolished` typhoon | I2 | 0: 칸 위 `speed_lines` 소용돌이(회전 3 스텝) + `smoke` 3 · 200: 벽돌 조각 8 산개 + `dust_puff` ×2 · 건물 shake(기존) | 30 | 회색·갈색 | 3 px / 200 ms | `warning` / `warning` | ○ |
| `Demolished` sale | I0 | 조각 3 + `dust_puff` | 6 | 갈색 | — | — | ○ |
| `BuildingSold`/`PropertySold` | I1 | 칸→패널로 코인 4(절반 값 느낌: 작은 코인 0.7×) + `dust_puff` | 12 | gold | — | `cash-in` / `light` | ○ |
| `MoneyChanged` reason=`card` (+) | I1 | 패널 앞 `bill_flutter` 낙하 6 + `sparkle4` 4 (+ 액수 티어) | 10 | gold/초록 | — | `cash-in`(피치 래더) / `light` | P |
| `MoneyChanged` reason=`card` (−) | I1 | 패널에서 코인 4가 아래로 흩어짐 + `dust_puff` | 8 | 회색 | — | `cash-out` / `light` | P |
| `MoneyChanged` tax / donation / bail | I1 | 코인 5가 패널→해당 칸(세무서/기부함/섬)으로 곡선 이동, 도착 `dust_puff` | 8 | gold→회색 | — | `cash-out` / `light` | 패널→칸 |
| `MoneyChanged` salary / pot / toll / purchase / build / takeover / bankruptcy | — | **중복 방지**: 전용 이벤트(`PassedStart`/`TollPaid`/…)가 이미 연출 → `MoneyChanged`는 패널 숫자 카운트업(기존)만 | 0 | | | 기존 `cash-in`/`cash-out`(톨 제외) | P |
| `PotChanged` (팟 증가) | I0 | 팟 표시 옆 코인 1–2 팝 | 3 | gold | — | — | ○ |

### 7.2b 건축·업그레이드 연출 (농장 게임 차용)

> 출처·근거: `docs/research/05-vfx-research.md` §8(농장/마을 게임 건축·업그레이드 연출 리서치). **차용한 것은 "연출 패턴(비트 순서·타이밍 범위·레이어링)"뿐이며 아트·이름·에셋은 하나도 쓰지 않는다** — 전부 `public/fx` 자체 스프라이트 30종(§4)으로 만든다.
> 이 절은 §7.2 `PropertyBought`/`Built`/`Built.free`, §7.3 `TakenOver`, §7.4 명소 완성·독점 완성의 **프레임 단위 정본**이다. §7.2·§7.3·§7.4의 해당 행은 요약이며 충돌 시 이 절이 우선한다(예산은 §6.1·§9 그대로).
> 이 문서 작성 시점에 `src/`는 변경하지 않았다. 아래 "구현 연동 요구"(7.2b.12)는 구현 에이전트용 메모다.

#### 7.2b.0 공통 규약

**시간 표기**: `f` = 30 fps 프레임(1f = 33.3 ms), **FX 시간** 기준(히트스톱 `freeze`는 FX 시간을 멈추고 벽시계에 f를 삽입 → "벽시계 = FX 프레임 + 삽입된 정지"). `cue:<name>` = 타임라인이 시퀀서/뷰에 돌려주는 신호(`FxHandle.cue(name): Promise<void>`) — DOM 상태(소유 색, 레벨 아이콘)는 **cue 프레임에 적용**한다(7.2b.12).

**농장 게임에서 수렴한 4막 구조**(리서치 §8.2) → 우리 4비트로 고정: **납품(재료 투입) → 공사(타격 N회) → 먼지 커튼 속 교체(swap) → 팝·반짝·보상(reveal)**. 대기 시간(타이머, 탭-투-스피드업)은 없다 — 건설은 즉시 확정 상태이고 연출은 순수 프레젠테이션이므로 "빨리 감기" = 탭 스킵(×5)이 전부.

**스케일/이징 커브 (전 이벤트 공통, 티어별 오버슈트 단조 증가)**

| 이름 | 정의 | 값 |
|---|---|---|
| `popBack(o)` | `easeOutBack`, `c1`로 오버슈트 결정(최대치 = 4c1³/(27(c1+1)²)) | o=8 % → c1=1.5 · 10 % → 1.70158 · 12 % → 1.9 · 15 % → 2.17 |
| `squash(sx,sy)` | 충격 프레임에 즉시 (sx,sy), 1–2f 유지 후 `popBack(10 %)`으로 (1,1) 복귀 | 착지 (1.25, 0.82)/(1.3, 0.75), 부피 ≈ 1 |
| `zoomPunch(k)` | 칸(tile) DOM `transform: scale` 1 → k(5f `outQuad`) → 1(7f `inOutQuad`), 칸 z-index 임시 상승(레이어 추가 없음) | L2 없음 · L3 1.10 · L4 1.25 · 인수 1.15 |
| `fall` | 크라운/태그 낙하 `inQuad`(가속), 착지 즉시 `squash` | 4–6f |
| `arc(n,f)` | 코인/별 2차 베지어, 스태거 1f, 소요 f, `outQuad`, 코인 스쿼시 0.7–1.2 | 납품 10f, 별 비행 18f |
| `dimIn/out` | 스포트라이트 알파 0→0.25(6f), 복귀 8f | L4만 |

**티어 일관 시각 언어** — 레벨이 오를 때마다 **레이어 1장이 추가**된다(아래 레이어는 누적: L4 = L1+L2+L3+L4 레이어). 색 의미: 소유 색 = 누구의 것, 흰색 = 완공(구조), 금색 = 가치/보상.

| 레벨(아이콘) | 추가 레이어 (스프라이트 · 색 · 반경) | 누적 `sparkle4` | 티어 핍(별) | 오버슈트/팝 | 타격 | 쉐이크 · 정지 | 등급 · 길이 |
|---|---|---|---|---|---|---|---|
| **L0 부지** | ① 소유 색 링+와이프 (`ring_shock`, `glow` owner) · 글린트 1회 | 3–14 (가격 티어) | 없음(태그) | 태그 `popBack(10 %)` | 태그 낙하 | 0 · 0 (≥500: 3–4 px) | I1/I2 · 27f/33f |
| **L1 별장** | ② 먼지 + **흰** 반짝 (`dust_puff`, `sparkle4` white · 0.6u) + 굴뚝 연기 1 | 4 | ★ ×1 | 8 % / 8f | 1 | 0 · 1f | I1 · 24f |
| **L2 빌딩** | ③ **금** 반짝 + 금 `glint_sweep` (`sparkle4` gold · 0.9u) | 10 | ★★ | 10 % / 9f | 2 | 2 px/160 ms · 1f | I1 · 27f |
| **L3 호텔** | ④ **소유 색 외곽 반짝** + `star_burst`(금) + `shine_cross` + 깃발 | 16 | ★★★ | 12 % / 10f | 3 | 3 px/200 ms · 1f | I2 · 36f |
| **L4 명소** | ⑤ **프리즘**(소유+금+흰) 반짝 · `ray_burst` · `firework`×3 · `confetti` · **`crown`** + 클로즈업 카드 | 26 (+불꽃 꼬리 12) | 크라운(★ 핍 대체) | 15 % / 10f | 3 + 크라운 낙하 | 8 px/360 ms · 3f | I3 · 58f(+3f 정지) |

- 반짝 반경은 0.6u → 0.9u → 1.2u → 1.6u로 커지고, 색이 흰 → 금 → 소유 → 프리즘 순으로 "채워진다". 티어 핍은 `gold_star` 0.45× 를 칸 위에 2f 간격으로 `popBack(c1=2.17)` 팝(6f), 핍 하나당 `tap` SFX 피치 래더(0 → +4 → +7 반음, gain 0.5) — Farm Heroes류 별점 공개 패턴.
- 이 표의 **수량은 §6.1 등급 상한 이내**(I1 ≤40, I2 ≤100, I3 ≤200)이며 `Budget.request`가 강제한다. 스폰 총량과 라이브 피크는 각 절에 명시.
- **타 좌석 공통 원칙**: 캔버스 요소는 전부 방사 대칭/아이콘(방향 무관, R2). 방향성은 망치(`hammer`)와 경광등 빔뿐이며 행위자 좌석 각도로 회전. 문구는 기존 Stage 스탬프(↻) 하나만.

**공통 정지·제외 규칙**
1. **스킵(탭)**: 진행 중 타임라인 ×5, 새 타임라인은 파티클 ×0.5·쉐이크·정지 생략, **cue는 즉시 발화**(소유/레벨 상태가 항상 최종값으로 수렴), SFX/햅틱 유지. `instant()`/reduced-motion: 캔버스 미생성 + 칸 색 테두리 800 ms + SFX/햅틱(§8.3).
2. **콤보 병합**: 같은 칸의 400 ms 내 재건설은 새 타임라인을 만들지 않는다(엔진상 불가) — 다른 칸의 `Built`가 이어질 때는 §6.2-4 큐(I1 4개, I2 2개, I3 1개)가 적용되어 낮은 등급이 악센트로 강등.
3. **플래시 예산**: 타격 프레임에는 플래시 없음. 플래시는 L3 1f(α 0.15), L4 2f(α 0.25)뿐 → `flashBudget`(1 s 창 ≤3) 안. 독점 완성과 겹치면 복합 프리셋(7.2b.9)이 플래시를 1f로 합친다.
4. **SFX 이름은 기존 `SfxName`만** 사용(피치 = 2^(반음/12), `gain`). 레이어링용 "쿵/반짝/팡파르"가 없으므로 다음으로 대용하며 신규 이름(`thud`, `sparkle`, `fanfare-big`)이 추가되면 표의 "→"를 교체한다: 쿵 = `build` pitch 0.75, 반짝 = `festival` gain 0.35–0.5 pitch 1.5, 팡파르 = `landmark`+`buy` 동시.

---

#### 7.2b.1 구매: 부지 확보 (`PropertyBought`, L0)

농장 게임의 "배치 고스트 → 안착(plop) → 소유 표식" 패턴. 등급 I1(가격 <500) / I2(≥500), **27f(0.9 s)** / I2 **33f(1.1 s)**, 블록 **f10(333 ms)**. cue `frame`(f10): 소유 색 적용(`vs.properties[i].owner`).

| f (ms) | 비트 | 스프라이트 · 수량 · 커브 | 충격 · SFX · 햅틱 | 타 좌석이 보는 것 |
|---|---|---|---|---|
| 0 (0) | **납품**: 지불자 패널에서 코인 출발 | `coin_spin` ×n, 스태거 1f, `arc` 10f, 스쿼시 0.7–1.2 | `cash-out` gain 0.7 · `tick` | 지불자 앞에서 칸으로 오는 코인(R6) |
| 0–6 | **배치 고스트**: 칸이 소유 색으로 밝아짐 | `glow` owner 1.0→1.15×, α 0→0.55 (6f `outQuad`) | — | 어느 칸이 지목됐는지(색 후광) |
| 6–9 | **태그 낙하**: 칸 위 1.8u에서 | `sale_tag` α 0→1 (3f), `fall` 4f | — | 아이콘이라 방향 무관 |
| **10 (333)** | **안착 ★** + cue `frame` | `sale_tag` `squash(1.25,0.82)` 2f → `popBack(10 %)` 5f, 좌우 스윙 ±12° 6f · `ring_shock` owner 1.0× · `dust_puff` 0.6× ×2 · 소유 색 원형 와이프 시작(DOM, 6f `outCubic`, 태그 위치 중심) | `buy` (I2: pitch +2반음) · `success` · 쉐이크 0 (I2 3–4 px/200–240 ms) | 소유 색 테두리가 칸에 번짐 — 4좌석 모두 |
| 11–13 | **반짝** | `glint_sweep` gold α 0.8 ×1 (I2 ≥500: ×2) · `sparkle4` white ×3 (r 0.6u) | — | — |
| 12–17 | **금 반짝**(가격 티어) | `sparkle4` gold: <200 없음 · 200–499 ×7 · 500–799 ×11 · ≥800 ×17 (r 0.9u, 스태거 1f) | — | — |
| 14 (≥500) | 고급 임팩트 | `star_burst` gold 0.7× (≥500) · `shine_cross` (≥800) · `gold_star` 1 태그 위 팝 (≥800) | — | — |
| 14–22 | 코인 잔여 도착 | 마지막 코인 도착 f(10+n−1) ≤ f21, 도착마다 없음(지불이므로 무음) | — | — |
| 18–24 | **정착**: 태그 소멸, 후광 꺼짐 | `sale_tag` α 1→0 (6f), `glow` α→0 (8f) | — | 소유 색 프레임만 남음(DOM) |
| 27 (33) | 완전 정지 | 파티클 0 | — | — |

**가격 티어별 구성(§7.2 기존 수치와 동일 총량 14/24/34/44)**: <200: 코인 5, 태그 1, 링 1, 먼지 2, 글린트 1, 후광 1, 반짝 3 = **14** · 200–499: 코인 8, 반짝 10 (나머지 동일) = **24** · 500–799(I2): 코인 10, 링 2, 글린트 2, 후광 2, `star_burst` 1, 반짝 14, 먼지 2, 태그 1 = **34** · ≥800/허브(I2): 코인 12, 반짝 20, `shine_cross` 1, `gold_star` 1 (+허브는 `comet` 1 칸 통과) = **44**. 라이브 피크 ≈ 총량의 60 %.

---

#### 7.2b.2 건설 L1 별장 (`Built`, level 1)

I1, **24f(0.8 s)**, 블록 **f10**. cue `swap`(f6): 아이콘 L0→L1(또는 이전 레벨→새 레벨)로 DOM 교체. 스폰 총량 **17**, 피크 ≈ 12.

| f (ms) | 비트 | 스프라이트 · 수량 · 커브 | 충격 · SFX · 햅틱 | 타 좌석이 보는 것 |
|---|---|---|---|---|
| 0 (0) | 납품 + 후광 | `coin_spin` ×3 패널→칸 (`arc` 10f) · `glow` owner α 0→0.4 (4f) | `cash-out` gain 0.6 | 지불자 앞에서 오는 코인 |
| 1–3 | **망치 들어올림**(예비 동작) | `hammer` 0.8×, 행위자 좌석 각도로 회전, 0° → −35° (3f `inQuad`) · 기존 아이콘 opacity 1→0.75 | — | 망치는 행위자 쪽으로 기울어 보임 |
| 4–5 | **내려침** | `hammer` −35° → +20° (2f, 가속) | — | — |
| **5 (167)** | **접촉 ★** | `hit_lines` ×1 · `brick_chip` ×3 (속도 6–9u/s, 수명 12f) · `dust_puff` ×1 (0.9×) | **정지 1f** · `build` (k=0) · `light` | 방사형 먼지·조각 |
| **6 (200)** | **교체(swap)** — 먼지 속 | cue `swap`: 아이콘을 L1로, scale 0.6에서 시작 | — | 먼지 뒤에서 아이콘이 바뀜 |
| 6–14 | **팝** | 아이콘 scale 0.6 → 1.0 `popBack(8 %)` 8f · `ring_shock` owner 0.8× (f6) · `sparkle4` white ×4 (r 0.6u, f7–f10, 스태거 1f) | — | 소유 색 링 |
| 10 (333) | **핍 ★1** + 블록 해제 | `gold_star` 0.45× 팝 (6f, `popBack(c1=2.17)`) · `smoke` ×1 굴뚝 (수명 16f) | `tap` gain 0.5 | ★ 하나 |
| 14–24 | 정착 | 파티클 소멸, 아이콘 opacity 1 | — | — |

합계: 코인 3 + 후광 1 + 망치 1 + 히트 1 + 조각 3 + 먼지 1 + 링 1 + 반짝 4 + 핍 1 + 연기 1 = **17**.

---

#### 7.2b.3 건설 L2 빌딩 (`Built`, level 2)

I1, **27f(0.9 s)**, 블록 **f10**. cue `swap`(f9). 스폰 총량 **33**, 피크 ≈ 22. 타격 2회(간격 4f = 133 ms).

| f (ms) | 비트 | 스프라이트 · 수량 · 커브 | 충격 · SFX · 햅틱 | 타 좌석이 보는 것 |
|---|---|---|---|---|
| 0 (0) | 납품 + 후광 | `coin_spin` ×4 (`arc` 10f) · `glow` owner α→0.45 | `cash-out` gain 0.6 | — |
| 0–2 | 들어올림 | `hammer` 0→−35° (3f) | — | — |
| 3 | 스윙 | +20° (2f) | — | — |
| **4 (133)** | 타격 ① | `hit_lines` ×1 · `brick_chip` ×3 · `dust_puff` 0.9× | 쉐이크 1 px/3f · `build` k0 gain 0.7 · `tick` | — |
| 5–6 | 재들어올림 | −20° (2f) | — | — |
| **8 (267)** | 타격 ② ★ | `hit_lines` ×1 · `brick_chip` ×3 · `dust_puff` 1.1× | **정지 1f** · 쉐이크 **2 px/160 ms** · `build` k+1 gain 1.0 · `light` | — |
| **9 (300)** | 먼지 커튼 + **swap** | `dust_puff` 1.2× ×1 (아이콘 전체를 덮음) → cue `swap` | — | 먼지 속 교체 |
| 9–18 | **팝** | scale 0.55 → 1.0 `popBack(10 %)` 9f · `ring_shock` owner 1.0× (f9) | — | — |
| 10 | **블록 해제** | `sparkle4` white ×4 (f10–f13) | — | — |
| 11–16 | **금 레이어(L2 고유)** | `sparkle4` gold ×6 (r 0.9u, 스태거 1f) · `glint_sweep` gold ×1 (f12, 사선 1회) | — | 금빛 스침 |
| 13, 15 | **핍 ★★** | `gold_star` ×2 (`popBack 2.17`, 2f 간격) | `tap` gain 0.5, pitch +4반음 | ★★ |
| 16, 19 | 굴뚝 | `smoke` ×2 | — | — |
| 18–27 | 정착 | 소멸 | — | — |

합계: 코인 4 + 후광 1 + 망치 1 + 히트 2 + 조각 6 + 먼지 3 + 링 1 + 반짝 10 + 글린트 1 + 핍 2 + 연기 2 = **33**.

---

#### 7.2b.4 건설 L3 호텔 (`Built`, level 3)

I2, **36f(1.2 s)**, 블록 **f16(533 ms)**. cue `swap`(f13). 스폰 총량 **55**, 피크 ≈ 36. `zoomPunch(1.10)`.

| f (ms) | 비트 | 스프라이트 · 수량 · 커브 | 충격 · SFX · 햅틱 | 타 좌석이 보는 것 |
|---|---|---|---|---|
| 0 (0) | 납품 + 후광 | `coin_spin` ×5 (`arc` 10f) · `glow` owner α→0.5 | `cash-out` gain 0.7 | — |
| 0–3 | 들어올림/스윙 | `hammer` −35° → +20° | — | — |
| **4 (133)** | 타격 ① | `hit_lines` · `brick_chip` ×3 · `dust_puff` 0.9× | 쉐이크 1 px · `build` k0 gain 0.7 · `tick` | — |
| **8 (267)** | 타격 ② | 동일, `dust_puff` 1.1× | 쉐이크 1.5 px · `build` k+2 gain 0.85 · `tick` | — |
| **12 (400)** | 타격 ③ ★ | `hit_lines` · `brick_chip` ×3 · `dust_puff` 1.2× | **정지 1f** · 쉐이크 **3 px/200 ms** · `build` k+4 gain 1.0 · `medium` | — |
| 12–14 | **먼지 커튼** | `dust_puff` 1.3× ×3 (반경 0.5u 링, 스태거 1f) | — | — |
| **13 (433)** | **swap** | cue `swap` (호텔 아이콘, scale 0.55) | — | 먼지 속 교체 |
| **14 (467)** | **팝 ★** | scale 0.55 → 1.0 `popBack(12 %)` 10f (+`squash(1.2,0.85)` 첫 2f) · `zoomPunch(1.10)` · `ring_shock` owner 1.2× (f14), 금 1.5× (f17) · `star_burst` gold 0.6× · **플래시 1f α 0.15** (`glow` white) | `buy` pitch +7반음(=1.5) gain 0.7 · `success` | 소유 색 링 + 금 링 2겹 |
| 15, 20 | 글린트 | `glint_sweep` gold ×2 (사선 스침) | — | — |
| 14–20 | 반짝 L1+L2 레이어 | `sparkle4` white ×4 (f14–f17) · gold ×6 (f15–f20) | — | — |
| 16 | **블록 해제** · `shine_cross` (옥상) | `shine_cross` ×1 | — | — |
| 17–22 | **소유 레이어(L3 고유)** | `sparkle4` owner ×6 (r 1.2u, f17–f22) | — | 외곽 소유 색 반짝 |
| 17, 19, 21 | **핍 ★★★** | `gold_star` ×3 (`popBack 2.17`) | `tap` gain 0.5, pitch 0 / +4 / +7반음 | ★★★ |
| 22, 25, 28 | 굴뚝 · 깃발 | `smoke` ×3 · `flag_wave` owner 틴트 ×1 (옥상, f22–f36 1회 통과) | — | 깃발이 소유 색 |
| 36 | 정지 | 파티클 0 | — | — |

합계: 코인 5 + 후광 2 + 망치 1 + 히트 3 + 조각 9 + 먼지 6 + 링 2 + `star_burst` 1 + `shine_cross` 1 + 반짝 16 + 글린트 2 + 핍 3 + 깃발 1 + 연기 3 = **55**(I2 상한 100).

---

#### 7.2b.5 건설 L4 명소 완성 — "큰 것" (`Built`, level 4, I3)

FX **58f + 정지 3f = 61f(2.03 s)**, 블록 **FX f24**(=벽시계 900 ms, 정지 포함), 스폰 총량 **171**, 라이브 피크 ≈ 105(상한 200/300). cue `swap`(f17), cue `stamp`(f22). 클로즈업 카드(DOM `.fx-closeup`, 7.2b.10) 동반. 좌석 가독성: 캔버스 전부 방사 대칭, 스탬프만 ↻.

| f (ms) | 비트 | 스프라이트 · 수량 · 커브 | 충격 · SFX · 햅틱 | 타 좌석이 보는 것 |
|---|---|---|---|---|
| **0 (0)** | **기대① 스포트라이트** | `dimIn`(α→0.25, 6f) · 클로즈업 카드 등장(행위자 쪽, translateY 8 %→0, scale 0.7→1.0 `popBack 10 %`, α 0→1, 4f) · `glow` owner 1.4× α 0→0.7 (8f) · 수렴 `sparkle4` white ×6 (r 1.6u→0.2u, `inQuad` 8f, 스태거 1f) · 납품 `coin_spin` ×8 패널→칸 (`arc` 10f, 스태거 1f, f10–f17 도착) | `landmark` gain 0.35 pitch 0.75(상승 예고) · `cash-out` gain 0.8 · `tick` | 다른 연출이 어두워지고 칸에 빨려드는 빛 — 지목된 칸이 한눈에 |
| 3–4 | **공사 상태("under construction")** | 이전 레벨 아이콘 opacity 1→0.6, scale 1→0.94 (4f `outQuad`) · `hammer` 0→−35° (3f) | — | 아이콘이 어두워짐 |
| **4 (133)** | 타격 ① | `hit_lines` ×1 · `brick_chip` ×3 · `dust_puff` 1.0× | 쉐이크 1 px/3f · `build` k0 gain 0.7 · `tick` | — |
| 6–8 | 스윙 반복 | 망치 −20° → +20° | — | — |
| **9 (300)** | 타격 ② | `hit_lines` ×1 · `brick_chip` ×3 · `dust_puff` 1.1× | 쉐이크 1.5 px · `build` k+2 gain 0.85 · `tick` | — |
| 12–18 | **크라운 낙하** | `crown` α 0→1 (2f), y −1.8u → 0, `fall` 6f(f13–f19) · 꼬리 `sparkle4` ×4 (낙하 중 스폰) | — | 왕관이 위에서 내려옴 |
| **14 (467)** | 타격 ③ (최종) | `hit_lines` ×2 · `brick_chip` ×3 · `dust_puff` 1.2× | 쉐이크 2 px · `build` k+4 gain 1.0 · `light` | — |
| 15–17 | **먼지 커튼** | `dust_puff` 1.3× ×6 (반경 0.5u 링, 스태거 0.5f) — 아이콘 전체를 덮음 | — | 큰 먼지 구름 |
| **17 (567)** | **swap(먼지 속)** | cue `swap`: 랜드마크 아이콘으로 교체(scale 0.5, dim 해제) | — | — |
| **19 (633)** | **임팩트 ★** | 크라운 착지 `squash(1.3,0.75)` 2f → `popBack(15 %)` · 아이콘 scale 0.5 → 1.0 `popBack(15 %)` 10f (f19–f29, 피크 f24) · `zoomPunch(1.25)` · `ring_shock` owner 1.2× (f19), 금 1.6× (f22) · `star_burst` gold 1.2× · **플래시 2f α 0.25** (`glow` white 대형) | **정지 3f (100 ms)** · 쉐이크 **8 px/360 ms** · `landmark` gain 1.0 + `build` pitch 0.75 gain 1.0(쿵) · `heavy` | 링 2겹 + 강한 쉐이크 — 4좌석 모두 |
| 20–30 | **보상 레이어들** | `ray_burst` 금 (α 0→0.7 4f, 회전 +50°/24f, scale 0.8→1.5, 가산, f44에 α 0) · `glint_sweep` gold ×2 (f20, f26) · `shine_cross` ×1 (크라운, f21) · **프리즘 반짝** `sparkle4` ×10 (owner/gold/white 순환, r 1.6u, f20–f30, 스태거 1f) | `festival` gain 0.45 pitch 1.5 (f22, 반짝) | 후광 광선 + 금빛 스침 |
| **22 (733)** | **스탬프** | cue `stamp`: Stage 스탬프 "명소 완성"(DOM ↻ 행위자 좌석) · `firework` #1 (좌: −1.1u, −0.8u, owner) | `success` | 스탬프 문구는 행위자 방향, 나머지는 빛 |
| 22, 25, 28 | **색종이 ×3 버스트** | `confetti_*` 5종 20개씩 = **60** (칸 가장자리, 위 ±50°, 속도 9–14u/s, 중력 22u/s², 항력 0.9, 수명 24–28f, 팔레트 owner 40/gold 40/white 20 %, `scaleX=cos`) | — | — |
| 25, 28 | 불꽃 #2, #3 | `firework` 우(+1.1u, gold) · 상(0, −1.5u, white), 각 꼬리 `sparkle4` ×4 | — | — |
| **24 (800)** | **블록 해제**(벽시계 900 ms) · 보상 흐름 | `coin_spin` ×20 샤워(칸 상단 발사→중력, 수명 20f, f24–f30 스태거) — **장식(획득 아님)** · `gold_star` ×5 소유자 패널로 비행(`arc` 18f, f26–f44, 스태거 2f) → 도착 `sparkle4` ×5 + 패널 범프(기존) | 도착마다 `cash-in` 피치 래더 k=0..4 · `light` | 별이 소유자 패널로 날아감 = "누구의 것인지" |
| 30–36 | 크라운 → 아이콘으로 흡수 | `crown` α 1→0 (6f) — 보드 아이콘(DOM)에 왕관 요소가 있으면 유지 | — | — |
| 34–40 | **생명감 꼬리(유한)** | `smoke` ×3 (f34, 37, 40) · `flag_wave` owner ×1 (옥상, f34–f52) | — | — |
| 36 | 정적 글로우로 전환 | DOM `.landmark`(정적 CSS 글로우) cross-fade 6f — **애니메이션 없음, 상시 비용 0** | — | 영구 표식 |
| 44–52 | 퇴장 | 클로즈업 카드 scale→0.92, α→0 (8f) · `dimOut` 8f | — | — |
| **58** | **정지** | 라이브 파티클 0 → teardown | — | — |

합계: 코인 8 + 수렴 반짝 6 + 후광 3 + 망치 1 + 히트 4 + 조각 9 + 먼지 9 + 크라운 1 + 꼬리 반짝 4 + 링 2 + `star_burst` 1 + 글린트 2 + `shine_cross` 1 + `ray_burst` 1 + 프리즘 반짝 10 + `firework` 3 + 꼬리 12 + 색종이 60 + 코인 샤워 20 + `gold_star` 5 + 도착 반짝 5 + 연기 3 + 깃발 1 = **171**.

---

#### 7.2b.6 무료 업그레이드 카드 (`Built.free`, `FreeUpgrade`)

"선물 상자/무료 스피드업" 패턴(농장 게임의 무료 완공 티켓): **돈이 나가지 않으므로 납품 코인·망치가 없고, 하늘에서 오는 선물(혜성)이 착탄해 먼지를 일으킨다.** 대상 레벨 `k`=1–3의 티어 규칙(7.2b.0 표)을 그대로 쓰되 초록(무료) 레이어가 추가된다. 길이: k=1 **26f** · k=2 **26f** · k=3 **31f**(I1/I1/I2, 각 기존 등급 유지, 블록 f10 / f10 / f14). `k=4` 는 아래 주석.

| f (ms) | 비트 | 스프라이트 · 수량 · 커브 | 충격 · SFX · 햅틱 | 타 좌석이 보는 것 |
|---|---|---|---|---|
| 0 (0) | **선택 탭** → 카드가 날아감 | Stage 카드(DOM) 축소 후 `comet` ×1 (초록빛 흰색 틴트 `#9BE7B4`) Stage 카드 위치 → 칸 (`arc` 7f `outCubic`, 트레일 `glow` 6샘플) · 칸 `glow` 초록 α→0.5 (6f) | `card` gain 0.8 · `tick` | 행위자 쪽 카드에서 칸으로 날아오는 빛 |
| **7 (233)** | **착탄 ★** | `ring_shock` 초록 1.0× · `hit_lines` ×1 · `dust_puff` ×2 (1.1×) | **정지 1f** · `build` pitch +3반음 gain 0.8 (망치음 없음) + `festival` gain 0.35 pitch 1.5 · `light` | 방사형 초록 링 |
| **8 (267)** | **swap** | cue `swap` (레벨 k 아이콘) | — | — |
| 9–19 | **팝** | scale 0.55→1.0 `popBack(k별 오버슈트)` (k=1: 8f, 2: 9f, 3: 10f) | k=3: `zoomPunch(1.10)` | — |
| 9–14 | **초록 무료 레이어** | `sparkle4` 초록 `#7BE0A4` ×6 (r 0.8u) · `heart` ×2 상승 0.9u (f10, f12, α 페이드 14f) | — | 하트/초록 = "공짜" |
| 9+ | **티어 레이어 L1..Lk** | 7.2b.2/3/4의 반짝·글린트·핍·연기(각 표에서 swap 이후 행을 swap=f8 기준으로 평행 이동) | 핍 `tap` 래더 | 티어 별 |
| 블록 | k=1,2: **f10**, k=3: **f14** | — | k=3 `success` | — |

- 합계: k=1 **≈19**(comet 1 + 후광 1 + 링 1 + 히트 1 + 먼지 2 + 초록 반짝 6 + 하트 2 + 티어 반짝 4 + 핍 1) · k=2 **≈29** · k=3 **≈43**.
- **`k=4`(무료로 명소 완성)**: 7.2b.5 타임라인에서 납품 코인(f0–f17)과 망치 타격 ①–③(f4–f14)을 **`comet`(f4–f14, 착탄 f14)** 로 대체하고 f14 이후는 동일(먼지 커튼 f15 → swap f17 → 임팩트 f19). 스폰 총량 171 − 코인 8 − 망치/히트/조각 14 + comet 1 + 하트 2 = **≈152**.

---

#### 7.2b.7 이벤트 이후의 정적 티어 표식

이벤트가 끝난 뒤의 티어(★ 개수/크라운) 표기는 **보드 DOM의 기존 레벨 아이콘**이 맡는다(캔버스는 이벤트 중에만 핍을 그림). 랜드마크는 `.landmark` 정적 글로우(애니메이션 없음)로 "최대 레벨" 구분 — 농장 게임의 "MAX 골드 테두리"에 해당.

---

#### 7.2b.8 인수: 소유 프레임 교체 + 도장 (`TakenOver`, I3)

FX **51f(1.7 s)** + 정지 3f, 블록 **FX f21**(≈ 800 ms, 정지 포함), 스폰 총량 **≈53**, 피크 ≈ 30. cue `frame`(f18): 소유 프레임 색 전환(구매자). 좌석 가독성: 경광등 빔만 구매자 좌석으로 회전, 나머지 방사 + **패널→패널 코인**.

| f (ms) | 비트 | 스프라이트 · 수량 · 커브 | 충격 · SFX · 햅틱 | 타 좌석이 보는 것 |
|---|---|---|---|---|
| 0 (0) | **기대: 표적 표시** | 칸 `glow` 판매자 색 α 0→0.6 (5f) · `siren` ×2 (빔 회전 스윕 2회, 구매자 좌석 각도, f0–f14) · 판매자 패널 `ring_shock` 붉은 0.8× (f2) · 기존 소유 프레임 스케일 펄스 1→1.06→1 (6f ×2, DOM) · 아이콘 ±3° 떨림(`pulseSpace('shake')`) | `warning` · `warning`(햅틱) | 경광등 + 판매자 패널의 붉은 링 |
| **15 (500)** | **임팩트 ★** | `stamp_splat` 구매자 색 1.2× · `hit_lines` ×8 · `ring_shock` ×2 (f15 구매자 색 1.2×, f18 흰 1.6×) · **플래시 2f α 0.25**(`glow` white) · `zoomPunch(1.15)` | **정지 3f** · 쉐이크 **8 px/360 ms** · `takeover` · `heavy` | 도장이 찍히는 순간 — 모든 좌석에 |
| 15–17 | **옛 프레임 파쇄** | 판매자 색 `confetti_rect` ×8 (프레임 조각, 방사 6–10u/s, 수명 14f) · `smoke` ×1 회색 · `dust_puff` ×2 | — | 판매자 색 조각이 흩어짐 |
| 16 | Stage 스탬프 | cue `stamp`: DOM 스탬프 ↻ | — | — |
| **18 (600)** | **프레임 교체** + cue `frame` | 새 프레임(구매자 색) 원형 와이프 8f `outCubic`, 도장 중심에서 바깥으로(DOM) · 아이콘 `popBack(10 %)` 0.9→1.0 8f | — | 소유 색이 판매자 → 구매자로 바뀜(색 프레임 = 정본 신호) |
| **21 (700)** | **블록 해제** · 2× 가격 코인 | `coin_spin` ×12 구매자 패널 → 판매자 패널 (`arc` 20f, 스태거 1f, `outQuad`, 트레일 `glow`) | `cash-out`(구매자) → 도착 `cash-in`(판매자) 피치 래더 | 구매자 앞에서 나가 판매자 앞으로 |
| 33 (1100) | **여파** | 구매자 패널 `sparkle4` ×8 · 판매자 패널 `dust_puff` ×2 회색(주저앉음) | `light` | 구매자는 반짝, 판매자는 먼지 |
| 34–44 | 도장 소멸, 후광 꺼짐 | `stamp_splat` α→0 (6f) | — | — |
| **51 (1700)** | 정지 | 파티클 0 | — | — |

합계: 경광등 4(f0–f14, 빔 프레임) + 링 ≥5 + 후광 2 + 도장 1 + 히트 8 + 조각 8 + 연기 1 + 먼지 4 + 코인 12 + 반짝 8 = **≈53**.

---

#### 7.2b.9 독점 완성 "그룹 완성" (`GroupCompleted`, 파생 이벤트, I3)

컬러 그룹 전체 소유 완성. 칸 수 `n`(2–4) 일반식: `step` = 3f(n≤3) / 2f(n=4), 체인 마지막 f `T = 4 + step·(n−1)`, 임팩트 `Tc = T + 2`. 아래는 **n=3**(step 3f, T=f10, Tc=f12). 길이 **50f(1.67 s)** + 정지 2f, 블록 **FX f24**, 스폰 총량 **≈77**(칸당 ≈ 21 + 중앙), 피크 ≈ 45. cue `badge`(f14): "×2" 배지(DOM). 좌석 가독성: 그룹 칸 전체가 보드에 흩어져 있어도 **그룹 색 + 소유 색**이라 방향 무관.

| f (ms) | 비트 | 스프라이트 · 수량 · 커브 | 충격 · SFX · 햅틱 | 타 좌석이 보는 것 |
|---|---|---|---|---|
| 0–3 | **기대: 그룹 점등** | 그룹 칸 전체 `glow` 그룹 색 α 0→0.5 (4f) ×3 | `warning` gain 0.4 pitch +3반음 | 그룹 칸들이 동시에 켜짐 |
| **4, 7, 10 (133, 233, 333)** | **체인**(칸 i=0,1,2) | 칸마다: `glint_sweep` 그룹 색(사선 스침, 10f) ×1 · `ring_shock` 소유 색 0.9× ×1 · `sparkle4` white ×4 · 프레임 잠금 펄스 1.0→1.12→1.0 (6f `popBack`, DOM) · i≥1이면 이전 칸→현재 칸 `comet` ×1 (6f, 그룹 색) | `tap` 피치 래더 0 / +4 / +7반음 · `tick` ×3 | 칸에서 칸으로 이어지는 빛 = "세트" |
| **12 (400)** | **임팩트 ★** | 각 칸 `star_burst` 금 0.8× ×3 · 중심(그룹 무게중심) `ray_burst` 그룹 색 0.8× (α 0→0.6 4f, 600 ms 페이드) · `ring_shock` 금 1.5× ×1 · **플래시 1f α 0.2** | **정지 2f** · 쉐이크 **6 px/300 ms** · `landmark` pitch +3반음 · `success` | 세트 완성의 큰 폭발 |
| 13–17 | 색종이 | `confetti_*` 40 = 칸당 ≈13 (위 ±50°, 그룹 색 50/소유 색 30/금 20 %, 수명 24f) | — | — |
| 14–22 | **×2 배지**(DOM) + 칸별 반짝 | 칸 위 "×2" 배지 scale 0→1.3→1.0 (8f `popBack 2.17`), 칸당 `sparkle4` ×3 금 (r 1.0u) | `buy` pitch +7반음 gain 0.6 | 통행료 2배 표식 |
| 18 (600) | **스탬프** | cue `stamp`: Stage 스탬프 "독점" ↻ | — | — |
| 24 (800) | **블록 해제** | — | — | — |
| 30–50 | 정착 | 파티클 소멸, 그룹 칸 정적 DOM 강조(색 테두리 두께 +) | — | — |
| **50 (1667)** | 정지 | 파티클 0 | — | — |

합계: 후광 3 + 글린트 3 + 링 3+1 + 반짝 12 + 배지 반짝 9 + `comet` 2 + `star_burst` 3 + `ray_burst` 1 + 색종이 40 = **77**.

**복합 프리셋 `landmark+monopoly`**(§6.2-3): 명소 완성이 독점도 완성할 때 7.2b.5를 기준으로 하고 **f19 임팩트를 공유**한다. 그룹 체인 글린트/링은 f20–f28에 명소 보상 레이어와 겹쳐 재생(각 칸 `glint_sweep`+`ring_shock`, 스태거 2f), `ray_burst` 1개를 그룹 색+금 이중 톤으로 ×1.3, `firework` ×3 → ×4 (그룹 색 1발 추가), 색종이 60 → 48, 코인 샤워 20 → 12로 깎아 **총량 ≤ 200**(예산기가 강제), 플래시 2f 하나로 통합, 배지 cue `badge`는 f30. 벽시계 ≈ 2.1 s.

---

#### 7.2b.10 클로즈업 카드 (카메라 줌 대용)

우리에게는 카메라가 없으므로 Monopoly GO식 "건물 확대 컷"을 **행위자 좌석 쪽 Stage에 뜨는 아이콘 카드**로 대체한다.
- 대상: **L4 명소 완성(필수), L3 호텔(선택 옵션), 인수(선택, 아이콘만)**. 기본값은 L4만.
- 내용: 칸의 레벨 아이콘(확대 2.2×) + 소유 색 프레임, **글자 없음**. swap 프레임에 같은 `popBack`으로 함께 팝 → 칸 위 팝과 카드가 동시에 튀어 "확대 컷" 효과.
- 위치/회전: 행위자 좌석에서 Stage 안쪽으로 붙임(카드 자체는 Stage가 이미 좌석에 맞게 회전 — 글자가 없어 다른 좌석도 문제없이 읽음).
- 비용: DOM 요소 1개(스포트라이트 배경 포함), `transform/opacity`만 사용, 이벤트 동안만 `will-change` 부여 → **GPU 레이어 +1은 이벤트 중에만**(17 + FX 캔버스 1 + 카드 1 = 19 ≤ 20). 종료/스킵 시 즉시 제거.
- FX 캔버스(z 40)가 카드 위에 그려지므로 파티클이 카드를 가리지 않고 덮는다. 카드 영역 `avoidRect`는 v2.

---

#### 7.2b.11 유휴 "생명감" — 이벤트에서만 (유휴 0 유지)

농장 게임은 굴뚝 연기·펄럭이는 깃발·동물 튀기를 **상시 루프**로 돌리지만 우리는 게이트 B(유휴 10 s Layout/Paint/Raster/rAF 0)가 있으므로 **상시 루프 0**. 대체 규칙:
1. **꼬리에 유한 생명감**: L1 `smoke` 1, L2 2, L3 3+`flag_wave` 1, L4 3+`flag_wave` 1(각 표의 꼬리 행). 이벤트 종료와 함께 소멸.
2. **영구 표식은 정적 CSS만**: `.landmark` 글로우(애니메이션·filter 애니메이션 없음), 티어 ★/왕관은 아이콘 자체.
3. **선택 "턴 시작 반짝"(`landmarkLife`, I0)**: `TurnStarted`에 현재 플레이어가 명소를 갖고 있으면 그 칸에 `glint_sweep` 1회 + `sparkle4` ×2 (합 ≤3 파티클, 최대 2개 칸, 300 ms). 기존 이벤트에 얹는 것이라 별도 루프/타이머 없음. 기본 **off**(`fxConfig.landmarkLife`), 성능 게이트 통과 시 on.
4. 탭 반응(칸 탭 시 반짝)은 v2 후보(입력 이벤트이므로 유휴 0은 유지).

---

#### 7.2b.12 구현 연동 요구 · 테스트 (코드는 이번 작업에서 바꾸지 않음)

**연동 요구(구현 에이전트용)**
1. `FxHandle`에 `cue(name): Promise<void>` 추가(§3.8). 타임라인 op에 `{t, cue:'swap'|'frame'|'stamp'|'badge'}` 추가 — 엔진 클록으로 발화(스킵 시 즉시).
2. `animate.ts` `Built`/`PropertyBought`/`TakenOver` 분기: 현재는 `vs...level/owner` 변경 후 `render()`를 **먼저** 호출한다 → 새 흐름에서는 **cue 프레임에서** 변경·`render()`. 그 전까지 뷰는 이전 상태(이전 레벨/이전 소유자)를 유지해야 "먼지 속 교체"가 성립. `fast`/스킵 경로는 즉시 최종 상태.
3. `Built.free` 분기: `ev.free`면 7.2b.6, `ev.level===4`이면 7.2b.5(코인·망치 → comet).
4. `.fx-closeup` DOM(7.2b.10)은 `Stage`가 소유(좌석 회전 상속). 클로즈업/스포트라이트는 스킵 시 즉시 제거.
5. 파생 `GroupCompleted`(§3.9)에 그룹 칸 목록·무게중심을 전달(`completedGroup(vs, playerId, spaceIndex)`가 이미 칸 목록을 알고 있음).

**테스트(§10.1에 추가)**
- 프리셋별 **스폰 총량 ≤ 등급 상한**(L0 14/24/34/44, L1 17, L2 33, L3 55, L4 171, 무료 k=1..3 19/29/43, 인수 53, 그룹 77, 복합 ≤200) — 정적 합산 테스트.
- `swap`/`frame` cue는 **블록 시간 이전 또는 직후**(`cue.f ≤ block.f`, L4는 f17 ≤ f24), cue는 스킵에서도 정확히 1회 발화.
- 결정성: 같은 시드 → 같은 프레임 시퀀스(`hitStops`, `shake`, `sfx`, `haptic` 호출 열이 동일).
- `flashBudget`: L4 플래시 프레임 2, L3 1, 복합 ≤3(1 s 창).
- e2e: 4좌석 각각에서 L4/인수 진행 중 스크린샷 → 캔버스에 글자 없음, 클로즈업 카드 존재, 종료 후 캔버스 `hidden`·`activeFrameTicks()`=0.

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
| `TakenOver` | **I3** | **51f + 정지 3f · 정본 §7.2b.8**: 0: 표적 후광 + 경광등 스윕 ×2(구매자 좌석 각도) + 판매자 패널 붉은 링 · f15(500 ms) **임팩트** 정지 3f + `stamp_splat`(구매자 색) + `hit_lines` 8 + 링 ×2 + 쉐이크 8 px · f15–17 옛 프레임 파쇄(판매자 색 조각 8) · f18(600 ms) **소유 프레임 교체 와이프**(cue `frame`) · f21(700 ms) 2× 가격 코인 12 구매자→판매자 · f33 여파 · f51 정지 | ≈53 (siren 4 · 코인 12 · 히트 8 · 조각 8 · 기타) | 구매자 색 vs 판매자 색 | 8 px / 360 ms, 정지 100 | `takeover` / `heavy` | ○ 칸 중심 + P→P 코인, 프레임 색 교체가 정본 신호 |
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

**명소 완성** (`Built.level==4`, I3, FX 58f + 정지 3f ≈ 2.0 s, 블록 900 ms, 스폰 171 ≤ 200) — **프레임 단위 정본은 §7.2b.5**. 요약:

| t (프레임) | 비트 | 내용 |
|---|---|---|
| 0–14 (0–467 ms) | 기대 + 공사 | 스포트라이트(α 0.25)·클로즈업 카드·칸 `glow`·수렴 반짝 6 · 납품 코인 8 · 아이콘 "공사 중" 딤 · 망치 3타(f4, f9, f14, 쉐이크 1→2 px, `build` 피치 래더 0/+2/+4반음) |
| 12–17 | 크라운 낙하 + 먼지 커튼 | `crown` 낙하 6f · `dust_puff` ×6 커튼 → **f17 swap(먼지 속 교체)** |
| **19 (633 ms)** | **임팩트** | 크라운 착지 `squash(1.3,0.75)` · 아이콘 팝 15 % · `zoomPunch(1.25)` · `ring_shock`×2(f19, f22) · `star_burst` · 플래시 2f α 0.25 · **정지 3f** · 쉐이크 **8 px/360 ms** · `landmark`+쿵 · `heavy` |
| 20–30 | 보상 | `ray_burst` 회전 · `glint_sweep`×2 · `shine_cross` · 프리즘 반짝 10 · `firework`×3(f22, 25, 28) · `confetti` 60(3버스트) · 코인 샤워 20(장식) · `gold_star` 5 소유자 패널 비행(`cash-in` 피치 래더) · Stage 스탬프(f22, ↻) |
| 34–58 | 안정 | 연기 3 + 깃발 1(유한 꼬리) → 정적 CSS 글로우로 전환(f36) → 카드·스포트라이트 퇴장(f44–52) → 파티클 0(f58) |

- `landmark` 사운드는 기대(gain 0.35, 피치 0.75)와 임팩트(gain 1.0) 두 번, 햅틱 임팩트 `heavy` + 보상 `success`(f22).
- 독점·랜드마크가 동시에 완성되면 §6.2-3 복합 프리셋(§7.2b.9 끝).

| 이벤트/조건 | 등급 | 시퀀스 (t) | 스프라이트·수량 | 색 | 쉐이크·정지 | SFX / 햅틱 | 좌석 가독성 |
|---|---|---|---|---|---|---|---|
| **독점 완성** (파생 `GroupCompleted`: 컬러 그룹 전체 소유) | **I3** | **50f + 정지 2f · 정본 §7.2b.9**: f0–3 그룹 칸 동시 점등 → f4/7/10(n=3) 칸 순차 체인(`glint_sweep`+소유 색 `ring_shock`+`sparkle4`+칸 사이 `comet`) → f12 **임팩트**(칸마다 `star_burst`, 중심 `ray_burst`, 정지 2f, 쉐이크 6 px) → f13–17 그룹 색 `confetti` 40 → f14 "×2" 배지(DOM) 팝 → f18 Stage 스탬프 | ≈77 | 그룹 색 + 소유 색 | 6 px / 300 ms | `landmark`(피치 +3) / `success` | ○ 그룹 전체 칸이 보임(방향 무관) |
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
| `coinShower(at,n)` | (계획만 하고 만들지 않음: 출발 통과 연출은 `passStart`) | — |
| `billRain(at,n)` | `bill_flutter` 낙하 | n ≤10 |
| `sparkleField(at,r,n)` | `sparkle4` 랜덤 위상·스태거 25 ms | n ≤14 |
| `starBurst(at)` | `star_burst` 8f + `ring_shock` 6f | |
| `ringPulse(at,color)` | `ring_shock` | |
| `dustPuff(at,n)` | `dust_puff` | |
| `crownDrop(at)` | `crown` 낙하(`fall` 6f, 시작 f13, 착지 f19 = 임팩트) + 착지 `squash(1.3,0.75)` + `glint_sweep`; f30–36에 α→0 (§7.2b.5) | |
| `rays(at,color,ms)` | `ray_burst` 회전 가산 | |
| `firework(at,color)` | `firework` 12f + `sparkle4` 낙하 꼬리 | |
| `confetti(from,dir,n)` | 5종 모양 랜덤, `scaleX=cos(flip)`, 중력·공기저항 | n ≤100 |
| `stampImpact(at,color)` | `stamp_splat` + `hit_lines` | |
| `siren(at,seat,cycles)` | `siren` 4f 회전 스윕 | 2 사이클/1 s |
| `flagPop(at,color)` | `flag_wave` 튀어오름 스쿼시 | |
| `comet(from,to)` | `comet` + `glow` 트레일 | |
| `smoke(at,n)` | `smoke` 상승 | |
| `splash(at)` | `ring_shock` ×3 + `confetti_dot` 물방울 | |
| `landmark` / `monopoly` / `victory(kind)` | 위 프리셋 조합 타임라인(§7.4, `landmark`=§7.2b.5, `monopoly`=§7.2b.9) | |
| **↓ 7.2b 건축·업그레이드 (농장 게임 차용) ↓** | | |
| `plotClaim(at,owner,tierByPrice)` | L0 부지: 코인 납품 + 소유 색 `glow`/와이프 + `sale_tag` 낙하·스쿼시 + `ring_shock` + `glint_sweep` + 가격 티어 반짝 (§7.2b.1) | 27f / I2 33f, 총량 14/24/34/44 |
| `coinIn(from,to,n)` | `coinArc`의 납품 변형: 10f, 스태거 1f, 도착 무음/`cash-out` 1회 | n ≤ 12 |
| `buildSeq(level,at,seat,owner)` | L1–L3 합성: `coinIn` + `hammerHit`×level + `dustCurtain` + `tierPop(level)` + `tierSparkle(level)` + `tierPips(level)` + `chimney` (§7.2b.2–4) | 24f/27f/36f, 총량 17/33/55 |
| `hammerHit(at,seat,level)` | **변경**: 들어올림 3f → 접촉 프레임에서 `hit_lines`+`brick_chip`×3+`dust_puff`, 접촉 간격 4f, 마지막 타격에 정지·쉐이크. (구 4f+2f 스윙 규칙 대체) | 타격 수 = 레벨 (L4는 3 + 크라운) |
| `dustCurtain(at,n,scale)` | `dust_puff` n개를 반경 0.5u 링으로 0.5–1f 스태거 → **swap cue를 덮음** | n=1(L2) / 3(L3) / 6(L4) |
| `tierPop(level)` | 아이콘 scale 0.55→1.0 `popBack`(8/10/12/15 %, c1 1.5/1.70158/1.9/2.17), 팝 8/9/10/10f, `zoomPunch`(L3 1.10, L4 1.25) | |
| `tierSparkle(level,owner)` | 누적 `sparkle4` 레이어: 흰 4(r 0.6u) → 금 +6(0.9u) → 소유 색 +6(1.2u) → 프리즘 +10(1.6u), 각 스태거 1f | 4/10/16/26 |
| `tierPips(level)` | `gold_star` 0.45× ★×level 팝(2f 간격, `popBack 2.17`) + `tap` 피치 래더(0/+4/+7반음) | L1–L3 |
| `chimney(at,n)` | 유한 `smoke` n개(수명 16f) + L3+ `flag_wave` 1(소유 색) — 유휴 루프 아님 | 1/2/3 |
| `landmarkReveal(at,owner)` | 크라운 낙하 + 임팩트 + `ray_burst` + `firework`×3 + `confetti` 60 + 코인 샤워 20(장식) (§7.2b.5 f12–f36) | ≤ 130 |
| `starToPanel(at,panel,n)` | `gold_star` n개 칸→소유자 패널 비행(`arc` 18f, 스태거 2f), 도착 `sparkle4` + 패널 범프 + `cash-in` 피치 래더 | n=5 (명소), 그 외 0 |
| `closeUp(space,seat,level)` | DOM `.fx-closeup` 카드 + 스포트라이트(`dimIn`/`dimOut`), 아이콘 2.2×, 글자 없음, 스킵 시 즉시 제거 (§7.2b.10) | L4(기본), L3/인수(옵션) |
| `giftComet(fromStage,to,tint)` | 무료 업그레이드: Stage 카드→칸 `comet`(초록빛), 착탄 링·히트·먼지 + 초록 반짝 6 + `heart`×2 (§7.2b.6) | ≈14 + 티어 레이어 |
| `freeUpgrade(level)` | `giftComet` + `tierPop`/`tierSparkle`/`tierPips`(swap=f8 기준) ; level 4는 `landmarkReveal`로 연결 | 19/29/43/≈152 |
| `frameSwap(at,from,to)` | 소유 프레임 교체: 옛 프레임 파쇄(`confetti_rect` 판매자 색 ×8) + 새 프레임 원형 와이프 + 아이콘 `popBack` (cue `frame`) | 조각 8 |
| `takeoverStamp(at,buyer,seller)` | `siren`×2 → 임팩트(`stamp_splat`+`hit_lines`×8+`ring_shock`×2, 정지 3f) + `frameSwap` + 코인 12 (§7.2b.8) | ≈53 |
| `groupChain(spaces,color)` | 칸 순차 체인(`glint_sweep`+`ring_shock`+`sparkle4`+`comet` 연결) step 3f(n≤3)/2f(n=4) → `groupFinale` | n×≈13 |
| `groupFinale(spaces,color)` | 칸마다 `star_burst` + 무게중심 `ray_burst` + `confetti` 40 + "×2" 배지 cue (§7.2b.9) | ≈45 |
| `landmarkLife(at,owner)` | (옵션, 기본 off) 턴 시작에 명소 칸 `glint_sweep` 1 + `sparkle4` 2 (§7.2b.11) | ≤ 3 |

---

## 8. 접근성·안전·회귀 방지

### 8.1 플래시
- `flashBudget`(§3.7): 1 s 창 내 플래시 프레임 ≤3, 알파 ≤0.25, 붉은 대면적 플래시 금지. 경광등은 **스윕**(빔 회전, 사이클 ≤2/s).

### 8.2 다국어·회전
- 캔버스에 문자 없음 → i18n·폰트 서브셋(`fonts.test.ts`)과 무관. 문구는 기존 스탬프/토스트.

### 8.3 접근성 폴백 (reduced-motion / 절전)
- 앱 설정 "애니메이션: 줄이기"(기기의 `prefers-reduced-motion`은 읽지 않음: 원격 데스크톱·배터리 절약이 몰래 켜서 게임 전체가 즉시 진행되던 문제, 정책은 `src/ui/fx/time.ts` 머리말): 움직임만 없애고 시간(비트·홀드)은 그대로. **캔버스 미생성**. 대신 **정적 표식** — 해당 칸/패널에 색 테두리 하이라이트 800 ms(DOM 클래스 토글 1회, 애니메이션 없음) + 사운드 + 햅틱은 유지. 큰 순간(I3+)은 Stage 스탬프(기존, 이미 `instant()` 처리 여부 확인)로 텍스트 전달.
- 테스트용 `setAnimSpeed(0)`(`headless()`)도 캔버스 미생성, 시간도 0.
- 절전 모드(30 fps)는 그대로 30 Hz 격자; 60 fps 모드에서도 FX 스텝은 `setFrameRate` 따라감(`onFrame`).

### 8.4 회귀 방지
- 이벤트 매핑은 `satisfies Record<GameEventType, EventFx>`로 **모든 이벤트에 항목을 강제**(새 엔진 이벤트가 생기면 컴파일 에러).
- 프리셋 파티클 요청량 합계가 등급 상한을 넘지 않는지 단위 테스트(§9.1).

---

## 9. 성능 예산

| 항목 | 예산 | 근거/게이트 |
|---|---|---|
| 라이브 파티클 | **≤300** (이벤트 등급별 상한 §6.1) | 요구, 예산기 강제 |
| FX 캔버스 | 게임: 보이는 캔버스 1장(400×400 → 필요 시 960×600, §15.3), 그 밖: ≤3장 · 프레임 예산 0.3–0.5 MP. **워커(OffscreenCanvas)가 그림** — 메인 스레드 비용 0 | §15 |
| GPU 레이어 | 피크 **+1**(현재 17 → ≤18, 게이트 ≤20). 단 §7.2b.10 클로즈업 카드(L4 등 이벤트 중에만)가 켜지면 **+1 더 → 19**, 종료·스킵 시 즉시 해제 | PERFORMANCE.md C |
| 레이어 메모리 | +≤4 MB (현재 피크 89.2 MB → ≤100 MB 게이트) | 〃 |
| 이미지 메모리(레이어 외) | 아틀라스 4.5 MB + 틴트 캐시 ≤8 MB | §3.6 |
| 다운로드 | 아틀라스 ≤500 KB(예상 182 KB) + JSON ≤12 KB | 요구 |
| JS 프레임 비용 | 메인: update + 샘플·클러스터·레코드 ≤2 ms @1×, 평균 ≈1 ms·p95 ≤4 ms @4× (그리기·업로드는 워커) | §15.5 |
| 표시 fps (FX 중) | 26–34 (30 Hz 격자만) | 게이트 A |
| 유휴 | 이펙트 종료 8틱 뒤 **캔버스 주차(레이어 밖으로 transform, Paint 0)·`onFrame` 0·타이머 0**, 10 s 창 Layout/Paint/Raster/rAF 0 | 게이트 B, §15.3 |
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
6. 아틀라스 무결성(`public/fx/atlas.json`): 크기 ≤1024², 사각형 겹침 없음, 패딩, WebP+JSON 합계 ≤500 KB, 프리셋 참조 스프라이트 존재.
7. 스프라이트 SVG에 `<text>`가 없음(문자 금지 규칙) — `src/content/fx/sprites.ts` 산출 SVG 정적 검사.

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
| F4 프레임 상한 | FX 창 표시 fps(max(DrawFrame, viz 스왑) — 워커 프레임 포함) ≤34, 고유 프레임(`--unique`) ≥24 |
| F5 지연 | FX 창 rAF 간격 p95 ≤33 ms(정보: p99, 33 ms 초과 프레임 수) |
| F6 메인 스레드 | 같은 시드 4× CPU 데모 게임에서 효과 켬/끔 `TaskDuration` 비 ≤ 1.35 (§15.5; 처음엔 절대 150 ms/s) |
| F7 누수 | 20회 반복 후 JS 힙 증가 ≤5 MB, DOM 노드 증가 0, 캔버스 수 증가 0 (풀 캔버스는 첫 효과 때 한 번 생성) |
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

환경 변수: `CHROMIUM_PATH`(기본 `/opt/pw-browsers/chromium`), `FX_DPR`(기본 2), `FX_QUALITY`(WebP, 기본 0.9). 산출물은 저장소에 커밋하므로 일반 빌드/CI는 Playwright가 필요 없다.

### 파이프라인

1. `src/content/fx/sprites-color.ts` / `sprites-mask.ts`의 정의(`SpriteDef`: `name, cls, w, h, n, fps, loop, k?, svg(i, n)`)를 esbuild로 번들해 Node에서 실행 → 프레임별 SVG 문자열(순수 함수, 시드 PRNG `mulberry32` → 결정적).
2. 헤드리스 Chromium에서 `ceil(w·DPR·k) × ceil(h·DPR·k)`로 래스터(DPR 2, `k`는 부드러운 스프라이트의 추가 축소) → 알파 ≥ 4 바운딩 박스로 트림. 박스 가장자리에 닿는 프레임은 경고(`edgeOk: true`로 의도된 경우 제외).
3. Node에서 `maxrects-packer`(패딩 2 px, 회전 없음, 최대 1024²)로 클래스별 패킹 → POT 캔버스에 합성 → `canvas.toBlob('image/webp', 0.9)`. 네이티브 의존성 없음.
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

### 크기 (2026-10-01, 컬러 DPR 2 / 마스크 밀도 0.875배, WebP q0.9)

| 파일 | 크기(px) | 바이트 |
|---|---|---|
| `atlas-color.webp` (29프레임) | 512×512 | 67,634 B |
| `atlas-mask.webp` (96프레임) | 1024×1024 | 178,446 B |
| `atlas.json` | — | 16,449 B |
| **합계** | | **262,529 B** (예산 ≤500 KiB) |

보급형 모바일 기준으로 이전 1156² 마스크를 1024²로 축소했다. 표시 크기·앵커·애니메이션 프레임 수는 유지하며 컬러 아트는 투명 테두리만 추가했다. 프레임 추가 시에도 1K/POT 한도를 지켜야 한다.

---

## 13. 엔진 코어 구현 결과

> 범위: `src/ui/fx/vfx/**`(엔진·프리셋·테스트), `src/styles/vfx.css`. 이 단계의 단독 데모(`vfx-demo.html`, `vfx/demo.ts`)와
> 데모용 스크립트(`vfx-strips.mjs`, `vfx-perf.mjs`)는 2026-10-06에 지웠다(아래 13.4–13.5는 그때의 기록). 지금은 실제 게임
> 화면의 필름스트립(`e2e/vfx.spec.ts`)과 `npm run perf`의 fx 단계가 같은 것을 본다. **기존 파일은 수정하지 않았다** — 게임 화면 연동은
> 연동 체크리스트 문서(구 `docs/VFX-WIRING.md`, 적용 후 삭제: 매핑 표는 14.2a)로 진행했다.

### 13.1 구조

| 파일 | 내용 |
|---|---|
| `rng.ts` | mulberry32 시드 PRNG(엔진 `rng`와 독립), `mixSeed` |
| `ease.ts` | `linear/inQuad/outQuad/inOutQuad/inCubic/outCubic/outSine`, `outBack(t, c1)`, `backOvershoot(c1)=4c1³/(27(c1+1)²)`, `c1ForOvershoot`, §7.2b.0 표(`POP_C1` 8/10/12/15 % → 1.5/1.70158/1.9/2.17, `PIP_C1`, `TIER_POP`) |
| `pool.ts` | SoA 타입 배열 풀 **300 슬롯**(할당 0), `request(n, prio)` = 여유 없으면 `max(ceil(n/4), 여유)`로 감량(하위 우선순위 회수 가능분까지), `alloc`은 **가장 오래된 최저 우선순위**(요청보다 낮은 것만) 회수, `PRIORITY` 표(§3.7), 통계(peak/dropped/reclaimed) |
| `particles.ts` | 파티클 종류: 스프라이트 애니(루프/고정 fps/`fit`=수명 동안 1회), 정적 스프라이트(컨페티 `scaleX=cos` 뒤집기), 가산 글로우(`blend:'add'`). 운동: 탄도(속도·중력·프레임당 항력) 또는 2차 베지어 경로(+이징, 진행 방향 정렬). 스케일 곡선 s0→s1→s2(구간 이징, `OutBack` c1), 스쿼시(2f 유지 → popBack 5f), 페이드 인/아웃, 회전·감쇠 스윙, **망치 스윙**(들어올림 3f → 내려침 2f, 접촉 프레임 = +20°), 지연 |
| `atlas.ts` | `import.meta.env.BASE_URL` 기준 `fx/atlas.json` + WebP 2장 → `createImageBitmap`(없으면 `<img>`), 트림 오프셋·앵커·베이크 DPR 복원, `drawFrame()`(범용)·`drawRaw()`(핫패스: 합성된 행렬), **틴트 캐시** `(frame|color)` 오프스크린 캔버스 + `source-in`, LRU 8 MB(64 KB 초과 프레임은 ½ 해상도 캐시 — 13.4), 실패 시 `null`(엔진 비활성, 예외 없음) |
| `coords.ts` | 주입 콜백(`getLayerRect/getBoardRect/getSpaceRect/getPanelRect/getSeat/getStageRect`) → 레이어 px, `u = 보드/32`, 패널 앵커 = 보드 쪽 가장자리(R3), `SEAT_ANGLE`(= `ui/game/util` 값, 테스트로 고정)·`SEAT_DIR`·`seatLocal()` |
| `timeline.ts` | DSL `t(frame, action)` — `spawn/burst/shake/flash/hitStop/sfx/haptic/cue/dom/block`. `Runner`: 30 fps FX 프레임 실행, 히트스톱 = FX 시간 정지(타임라인·파티클 모두), 등급 상한(I0 8 · I1 40 · I2 100 · I3 200 · I4 300) 강제, 플래시 예산(1 s 창 ≤3프레임, α ≤0.25, 큰 소프트 `glow` — 전면 사각형 없음), 스킵(대기 cue 즉시 발화·히트스톱 제거·스킵 중 시작한 효과는 파티클 ×0.5·쉐이크/정지 없음), `runReduced()`(첫 sfx·첫 햅틱 + `rm` 표시 op + 정적 하이라이트 1회) |
| `presets.ts` | §7.5/§7.2b 프리셋 21종 + 범용 4종(`ringPulse/puff/cometJump/billRain`) — 13.2 |
| `clock.ts` | (2026-10-06 삭제) `FxClock` 어댑터 `gameClock`/`ManualClock`이 있었다. 지금 엔진은 `time.ts`(`onFrame/animSpeed/isSkipping/reducedMotion/isManualClock`)를 직접 부르고, 테스트는 `setManualClock`/`stepClock`을 쓴다 |
| `engine.ts` | `createFx()` → `FxHandle.play(name, params)`(thenable: 블록 프레임에 resolve, `.cue(name)`, `.done`, `.cancel()`), `run(timeline)`, `skip()`, `stopAll()`, `setQuality('high'|'low'|'off')`, `preload()`, `stats()`, `resetStats()`, `dispose()`, dev `window.__fx`. 캔버스 수명 §3.2, 리전·백킹 §3.3, 더티 영역 클리어, 레이어(0–3)×블렌드 순 그리기, `visibilitychange:hidden` → `stopAll()` |

**클럭**: 엔진은 `onFrame` 스텝 1개만 등록한다(효과가 있을 때만). 틱마다 `경과 × animSpeed × (스킵 ? 5 : 1)`을 누적해 FX 프레임을
정수로 진행(최대 8/틱, 스킵 20/틱)하고, 그리기는 틱당 1회. 파티클 적분은 고정 1/30 s 스텝(스킵 시 한 틱에 5스텝 — §3.5의 "서브스텝 없음"
대신 5회 반복: 300개×5 = 0.1 ms 수준이라 단순·결정적인 쪽을 택함). 유휴 판정(효과 0 · 파티클 0) 후 8틱 유예 → `onFrame` 해제,
캔버스 `hidden`, 백킹 `width=height=0`(또는 `retainBacking` — 13.4).

**설계 대비 달라진 점**
- 프리셋 타임라인 단위는 ms가 아니라 **30 fps 프레임**(§7.2b 정본과 동일). `FxHandle`은 §3.8 스케치의 `block/done/cancel` + `cue()`.
- 캔버스 좌표는 클라이언트가 아니라 **`.fx-layer` 로컬 px**(콜백 rect에서 레이어 rect를 뺌).
- 방향성 스프라이트(망치·경광등·왕관·태그·깃발·별 핍)는 행위자 좌석 각도로 회전, 왕관·태그 낙하와 색종이·코인 샤워의 중력도
  행위자 좌석 기준 "아래"(R2/R5). 나머지는 방사 대칭.
- 흰색 반짝은 크림색 보드(#EEE3CD) 위에서 안 보여 `SPARK_WHITE #FFF4C8` + 일반 블렌드로, 가산(`lighter`)은 광선·글로우·글린트·
  샤인·혜성에만 사용.

### 13.2 프리셋과 스폰 총량 (단위 테스트로 고정, `__tests__/presets.test.ts`)

| 프리셋 | 등급 | 블록 / cue (FX 프레임) | 스폰 총량 (명세) |
|---|---|---|---|
| `plotClaim` 가격 <200 / 200–499 / 500–799 / ≥800·허브 | I1/I1/I2/I2 | 블록 f10 · `frame` f10 | 14 / 24 / 34 / 44 (14/24/34/44) |
| `buildSeq` L1 / L2 / L3 | I1/I1/I2 | f10·`swap` f6 / f10·f9 / f16·f13 | 17 / 33 / 56 (17/33/55 + 플래시 1) |
| `buildSeq` L4 = `landmarkReveal` | I3 | f24 · `swap` f17 · `stamp` f22 · `settle` f36 · `end` f58, 정지 3f | 172 (171 + 플래시 1) |
| `landmarkReveal {group}` (명소+독점 복합) | I3 | 위 + `badge` f30 | 159 (≤200; 색종이 48·샤워 12·불꽃 4) |
| `freeUpgrade` k=1/2/3/4 | I1/I1/I2/I3 | f10/f10/f14 · `swap` f8 (k=4: comet → f17) | 21 / 30 / 45 / 152 (≈19/29/43/152; k=1은 티어 링·굴뚝 포함) |
| `takeoverStamp` | I3 | f21 · `stamp` f16 · `frame` f18, 정지 3f | 50 (≈53) |
| `groupChain` n=3 / n=4 | I3 | f24 · `badge` f14 · `stamp` f18, 정지 2f | 78 (77 + 플래시 1) / 90 |
| `groupFinale` | I3 | f12 · `badge` f2 | 55 |
| `tollPay` <300 / 300–999 / 1000–2499 / ≥2500·잔액<10 % | I1/I2/I2/I3 | f10/f15/f18/f19 · `arrive` f20 | 13 / 22 / 32 / 54 (13/24/40/70; 축제·허브 2배는 한 티어 위 + 깃발·반짝 / 혜성 6, 면제 10) |
| `passStart` / `landed` | I2/I3 | f12 | 27 / 42 (~28/~46) |
| `cardReveal`, `oneAway`, `doublesFlash`(3연속: 경광등), `islandSiren`(3연속 더블: 경광등 선행), `festivalBurst`, `bankruptcy`, `victory`(6종), `diceLand`, `hopDust`, `tap`, `coinIn`, `frameSwap`, `ringPulse`, `puff`, `cometJump`, `billRain` | 표 참조 | — | 모두 등급 상한 이내 |

테스트는 **49개 프리셋 조합** 전부에 대해 "요청량 ≤ 등급 상한, 모두 스폰, 피크 ≤ 300, 유한 종료"를 확인하고, 추가로 cue 순서
(`swap ≤ block`, L4 swap 17·stamp 22·block 24, 인수 frame 18·stamp 16·block 21, 그룹 badge 14·block 24, 구매 frame=block=10),
플래시 프레임(L4 2, L3 1), 타격 수 = 레벨(L4 = 3 + 임팩트 쿵), 행위자 색 사용, 시드 결정성, 세 개의 큰 효과 동시 재생 시 풀 ≤300을 검사한다.

### 13.3 테스트

`src/ui/fx/vfx/__tests__/` **5파일 88개**(전체 `npm test` 250개 통과): 풀/예산기(300 상한, n/4 감량, 최저·최고령 회수, 동일
우선순위 비회수), 적분(반암시적 오일러 닫힌 해와 일치, 베지어 종점, 지연·`fit` 프레임·페이드), 망치 접촉 프레임, RNG 결정성·분포,
이징(오버슈트 8/10/12/15 %를 수치 최대값으로 검증, `c1ForOvershoot` 역함수), 타임라인 정렬·블록·cue·히트스톱(FX 시간 정지)·스킵
(cue 즉시·정지 제거·신규 ×0.5·쉐이크 없음)·등급 상한·플래시 예산·시드 결정성·`stopAll`, reduced-motion(캔버스·클럭 미사용, 첫 sfx·
햅틱, 하이라이트 800 ms, cue 즉시 resolve), 속도 0(아무것도 안 함), 아틀라스 실패(예외 없이 비활성), 좌표(레이어 오프셋, `u`,
패널 앵커가 보드 쪽, 좌석 회전이 `ui/game/util`의 `SEAT_ANGLE`과 일치), 백킹 스케일(0.75–1.5, DPR 상한, ≤0.9 MP).

### 13.4 필름스트립 (`docs/assets/vfx-strips/*.png`)

(삭제된 `vfx-strips.mjs`) Vite 개발 서버 + 데모 페이지 + 수동 클럭, **2틱(=2 FX 프레임, 67 ms)마다 1장**,
라벨 `t`(틱) `f`(FX 프레임 — 히트스톱 동안 같은 f가 반복) `n`(라이브 파티클). 1600×1000, DPR 2, 캔버스 리전으로 클립.

`build1 · build2 · build3 · build4(명소, 남 좌석) · build4N(명소, 북 좌석 — 회전 확인) · tollM · tollXL · takeover · group(체인+피날레) ·
groupFinale · plot650 · free3 · passStartLanded · victoryHubs`

보고 나서 고친 것:
1. **색종이 리전 과대**: 도달 거리 식이 항력을 무시해 명소 리전이 스테이지 절반을 덮음 → `v·dt/(1−drag)` + 중력 표류로 계산(명소 리전
   416×357, 0.33 MP).
2. **플래시가 흰 원반**: 소프트 글로우 알파 ×4 → 칸 전체가 하얗게 → ×1.6(임팩트는 먼지 커튼 + 약한 번쩍임으로 읽힘).
3. **`ring_shock` 0번 프레임(채운 점)**이 큰 배율·가산에서 흰 공처럼 보임 → 링은 1–5번 프레임만 수명에 맞춰 재생.
4. **명소 보상 구간 과밀**: 코인 샤워·색종이가 칸 위에 뭉쳐 f40까지 아이콘이 안 보임 → 샤워 확산 ±60°·속도↑, 색종이 크기 0.6–0.9·
   속도 10–16u/s.
5. **승리 대포 색종이가 패널 근처에만**: 항력 0.9 → 0.95, 속도 22–34u/s, 수명 54–72f → 보드 안쪽까지 날아갔다가 승자 쪽으로 떨어짐.
   허브 승리 혜성 ×1.4·중앙 불꽃 ×2.2.
6. **통행료 XL 두 파상이 한 줄로 겹침** → 2차 파상은 반대쪽 호, 코인 0.75×. 경광등 0.7→0.85×.
7. **(성능) 틴트 캐시 스래싱**: 큰 프레임(링 192², 불꽃 12프레임)을 색마다 원해상도로 캐시 → 8 MB LRU가 가득 차 효과 중간에 재생성
   (틱 최대 15–20 ms) → 64 KB 초과 프레임은 ½ 해상도로 캐시(표시 밀도 ≈ u/30 × 백킹 ≈ 1.3 px/공칭 px ≥ 캐시 1 px/공칭 px, 부드러운
   도형이라 차이 없음) → 전체 시나리오 후 캐시 6.7 MB, 축출 0.
8. **(성능) 첫 틱 스파이크**: 리사이즈 직후 전체 `clearRect` 제거(폭 설정이 이미 비움). 남은 스파이크는 새 백킹 스토어의 **첫 그리기 시
   할당**(0.9 MP에서 4× 10 ms, 1× 2.5 ms — 빈 페이지에서도 동일하게 재현) → `retainBacking` 옵션(13.5).

### 13.5 성능 측정 (삭제된 `vfx-perf.mjs`, 기록)

조건: 데모 페이지, 실제 30 Hz 클럭(`time.ts`), Chromium 141 헤드리스(소프트웨어 합성), 1600×1000, DPR 2, **CPU 4× 스로틀**,
시나리오당 1× 워밍업 1회 + 4× 3회(중앙값; 최대는 3회 중 최대). "틱" = 엔진 스텝 1회의 JS(업데이트 + 캔버스 그리기, 소프트웨어 캔버스라
래스터 포함). 원자료 `docs/assets/vfx-perf-free.json`, `docs/assets/vfx-perf-retain.json`.

| 시나리오 | 라이브 피크 | 리전 → 백킹 | 틱 평균 / p95 / 최대 (ms, 4×) — 기본(백킹 해제) | 〃 — `retainBacking` |
|---|---|---|---|---|
| 명소 완성 L4 (`build4`) | 121 | 416×357 → 624×536 @1.5 (0.33 MP) | 1.26 / 2.6 / 11.8 | 1.15 / 2.6 / 5.1 |
| 명소+독점 복합 | 103 | 416×498 → 624×747 @1.5 (0.47 MP) | 1.22 / 2.4 / 9.5 | 1.11 / 2.2 / 7.2 |
| 승리(허브) | 117 | 1573×898 → 1256×717 @0.8 (0.90 MP) | 1.38 / 3.3 / 15.3 | 1.24 / 2.8 / 10.1 |
| 인수 | 28 | 332×995 → 498×1493 @1.5 (0.74 MP) | 0.83 / 1.4 / 13.6 | 0.58 / 1.5 / 2.3 |
| 통행료 XL | 45 | 386×1000 → 579×1500 @1.5 (0.87 MP) | 0.89 / 2.0 / 13.4 | 0.58 / 1.3 / 4.5 |
| 독점 체인 | 70 | 561×304 → 842×456 @1.5 (0.38 MP) | 1.11 / 2.0 / 10.8 | 0.89 / 1.8 / 2.4 |
| 스트레스(복합 명소 + 승리 + 통행료 XL 동시) | **251** | 1573×1000 → 1190×756 @0.76 (0.90 MP) | 1.80 / 4.6 / 21.7 | 1.84 / 4.1 / 17.5 |

- **목표(가장 무거운 프리셋 ≤ 4 ms/프레임 @4×)**: 평균 1.1–1.4 ms, p95 2.2–3.3 ms로 **충족**. 기본 모드의 최대값(9–15 ms)은 거의
  전부 **효과 시작 틱의 백킹 할당**(`maxAt f1`로 확인)이며, `retainBacking`에서는 명소 5.1 ms·인수 2.3 ms로 사라진다. 승리의 10 ms는
  f28–34의 대형 불꽃(×2.2)·광선 가산 그리기. 1×에서는 모든 시나리오 평균 0.3–0.9 ms.
- **라이브 파티클**: 단일 프리셋 피크 ≤121(명소), 세 효과 동시 251 — 풀 300·예산기 내(드롭 0).
- **캔버스**: 백킹 ≤0.90 MP(스케일 0.76–1.5), 캔버스 1장, 레이어 +1(효과 중에만; 유휴 시 `hidden` → 레이어 0).
- **유휴 복귀**: 모든 시나리오 후 `ticking=false`, 캔버스 `hidden`, 기본 모드 백킹 0×0(retain 모드는 hidden 유지만), `onFrame` 0.
- 틴트 캐시: 전 시나리오 후 6.7 MB(상한 8 MB, 축출 없음). 아틀라스 디코드 ≈4.5 MB는 별도(§9).
- 권장: 연동 시 **`retainBacking: true`**(게임 화면 동안 숨긴 캔버스가 ≤3.6 MB CPU 메모리를 유지 — GPU 레이어 아님, rAF·타이머 0 유지).
  `stopAll()`(리사이즈·화면 이탈·탭 숨김)과 `dispose()`는 항상 해제한다. 게이트 F1–F10의 최종 판정은 연동 후 `perf.mjs fx` 페이즈에서.

### 13.6 남은 일 (연동 단계) — §14에서 완료

연동 체크리스트(구 `docs/VFX-WIRING.md`): CSS import, `time.ts reducedMotion()` 노출, `Board.spaceRect/popIcon/zoomPunch/dimIcon/highlight`,
`PlayerPanel.clientRect`, `view.ts` 엔진 생성·수명, `shakeAll([table, fxLayer])`, `Stage` `.fx-closeup`·좌표 헬퍼, `animate.ts`의
전 이벤트 매핑과 **`swap`/`frame` cue까지 `render()` 지연**, `Built.free` 분기, 파생 `GroupCompleted`, 스킵 핸들러 `vfx.skip()`,
dev 훅 `fx()`, `perf.mjs` `fx` 페이즈(F1–F10), 구 `particles.ts` 이관·제거, e2e. 실기기 A/B(§10.4)는 그 이후.

---

## 14. 인게임 연결 결과 (연동 단계, 2026-09-30)

연동 체크리스트(구 `docs/VFX-WIRING.md`, 적용 후 삭제)를 모두 적용해 엔진을 실제 게임 화면에 붙였다. 아래는 **연결된 것, 이벤트별 재생 내용,
보고 나서 고친 것, 측정, 남은 한계**다.

### 14.1 연결된 것

| 영역 | 파일 | 내용 |
|---|---|---|
| CSS | `src/styles/index.css` | `@import './vfx.css'` (구 `.pt-canvas` 삭제) |
| 클록 | `src/ui/fx/time.ts` | `reducedMotion()`/`setReducedMotion()` 분리(엔진이 사용), `instant()` = 속도 0 ∨ reduced. **dev 전용 수동 클록** `setManualClock/stepClock`: rAF 없이 `onFrame`·`sleep`·`gridTimeout`·`anim()`(WAAPI를 멈춰 `currentTime`으로 전진)을 한 프레임씩 — 실제 게임의 결정적 필름스트립 |
| 보드 | `src/ui/board/Board.ts` | `spaceRect`, `popIcon`/`zoomPunch`(**SVG `transform` 속성 트윈**, 30 Hz — 14.3-4), `dimIcon`(칸 그룹 클래스), `highlight`(reduced-motion 정적 테두리 마크), 레벨 아이콘을 `g.sp-lvl`로 묶음, `hop(…, onLand)` |
| 패널 | `PlayerPanel.ts` | `clientRect`, `floatText`, `highlight` |
| 스테이지 | `Stage.ts`, `Dice.ts` | `.fx-closeup`(행위자 좌석으로 회전, 스테이지 중심 4.2u 위 — 스탬프와 겹치지 않게), `spotlight` = 스테이지 안 정적 베일(카드 둘레만 투명), `cardClientCenter`, `dropCloseUp`, `Dice.clientCenters` |
| 뷰 | `src/ui/game/view.ts` | `createFx` 생성·`dispose`, 리사이즈 시 `stopFx()`, `retainBacking: true`, **백킹 예산 0.5 MP**(14.3-6), `policy: fxPolicy` + `serializeBig`, 쉐이크 = `.fx-layer`만, 모든 cash-in/out은 `playSfx`(피치 래더), dev A/B 노브 `?dev=1&fxq=low|off&fxmp=0.45&fxsw=0` |
| 시퀀서 | `src/ui/fx/animate.ts` + **`src/ui/fx/fxmap.ts`**(순수 매핑) | 모든 `GameEvent` → 프리셋(14.2). 블록 프레임만 대기, 꼬리는 백그라운드. 구매/건설/인수는 `frame`/`swap` cue에서 상태 적용 + `render()`. 파생 `GroupCompleted` → `groupChain`(+ "OO 독점!" 스탬프, 배지 cue에 패널 범프). 턴이 바뀔 때와 배치 끝에서 **`vfx.settled(3)`** — 큰 순간(명소·인수·독점)의 스탬프/클로즈업이 다음 플레이어 쪽으로 돌아가 버리지 않게 |
| 엔진 추가 | `vfx/engine.ts`, `vfx/director.ts`, `vfx/timeline.ts` | §6.2 규칙(14.4), `settled()`, `running()`, `FxPlay.name/tier`, 스킵 ×10(FX만, DOM은 ×5) + 스킵 후 유예 2틱, 효과가 끝나면 남은 효과 영역으로 **캔버스 축소(refit)**, 보존 백킹 재사용 조건 25 % → 70 %, 액센트는 플래시도 생략 |
| 구 파티클 | `src/ui/fx/particles.ts` 삭제 | 통과 샤워 → `passStart`, 통행료 호 → `tollPay`, 승리 색종이 → `victory`, 결과 화면 색종이 → 새 프리셋 `confettiRain`(결과 화면 전용 엔진 인스턴스) |
| 스킵 | `controller.ts` | 탭 → `skip()` + `vfx.skip()`(대기 cue 즉시) + `stage.hurry()` |
| dev 훅 | `devhook.ts` | `fx()`, `playFx(name, params)`, `activeTicks()`, `manualClock(on)`, `stepFrames(n)` |
| 연출 미리보기 | (2026-10-06 삭제) | 개발 서버 전용 `?fxdemo=1` 패널이 있었다. 지금은 `e2e/vfx.spec.ts`·`e2e/money-events.spec.ts`의 실제 게임 필름스트립이 같은 일을 한다 |

### 14.2 이벤트별 재생 (`fxmap.ts`, 단위 테스트 `src/ui/fx/__tests__/fxmap.test.ts`)

| 이벤트 | 프리셋 (대기) | 상태 적용 | 지운 기존 호출 |
|---|---|---|---|
| RoundStarted (마지막 3라운드) | `ringPulse` 스테이지 호박색 | — | (토스트·warning 유지) |
| TurnStarted | `ringPulse` 토큰 칸 후광 (앞 효과 `settled` 후) | — | — |
| DiceRolled | `diceLand` 두 주사위 · 더블 `doublesFlash` · 3연속 `doublesFlash{triple}`(블록) | — | 3연속 `haptic('warning')` |
| TokenMoved walk / jump | 착지 홉에 `hopDust`(6칸 이상 속도선) / `cometJump` ∥ `board.jump` | — | — |
| PassedStart | `passStart`(landed: I3) | — | `sfx pass-start`, `haptic`, `coinShower` |
| MoneyChanged | card+ `billRain` · card−/tax/donation/bail `coinIn` 패널→칸 · toll 수령자 숫자는 `tollPay`의 `arrive` cue에 | — | 이유별 `cash-in/out`(pot·sale만 유지) |
| PotChanged + | `ringPulse` 출발 칸(팟 표시 위치) | — | — |
| PropertyBought | `plotClaim`(블록 f10) → 그룹 완성 시 `groupChain` | `frame` | `sfx buy`, `haptic`, `pulseSpace(stamp)` |
| CannotAfford | `puff` 패널 | — | — |
| Built L1–L3 / L4 / free | `buildSeq` / `landmarkReveal`(스탬프 = `stamp` cue) / `buildSeq{free, from: 카드}` | `swap` | `sfx build/landmark`, `haptic`, `pulseSpace(pop)` |
| Demolished | 태풍 `puff{smoke 3, bricks 8}`(블록) · 매각 `puff{bricks 3}` | — | — |
| TollPaid | `tollPay`(label null, 블록) ∥ 톨 카드 | — | `sfx toll`, `haptic`, `coinArc`, 수령자 `cash-in`+범프 |
| TakenOver | `takeoverStamp`(스탬프 = `stamp` cue) → 그룹 완성 시 `groupChain` | `frame` | `sfx takeover`, `haptic`, `shake(table)`, `pulseSpace` |
| TakeoverBlocked | `ringPulse` 하늘 2겹 | — | — |
| CardDrawn | `cardReveal`(톤: 좋음/나쁨/이동/보관, 뒤집힘 정점 430 ms) | — | — |
| CardKept / CardUsed / CardNoEffect / ExpressGranted | `ringPulse` 보라 / `puff` 흰 / `puff` / `ringPulse` | — | — |
| SentToIsland | `islandSiren`(블록; 3연속 더블은 경광등이 이미 나왔으므로 물보라만) | — | `sfx island`, `haptic` |
| IslandStay / Escaped | `ringPulse` 섬 | — | — |
| FestivalSet | `festivalBurst`(블록) · 해제 `puff` | — | `sfx festival`, `haptic`, `pulseSpace` |
| TravelGranted / Debt* / AuctionStarted / AuctionBid | `ringPulse` 변형 | — | — |
| BuildingSold / PropertySold | `coinIn` 칸→패널 (+`puff`) | — | — |
| PropertyTransferred | `ringPulse` 수령자 색, 배치당 처음 6칸 | — | — |
| Bankrupt | `bankruptcy` ∥ `breakApart` ∥ 스탬프 | — | `sfx`, `haptic`, `shake(table)` |
| OneAway | `oneAway` + 기존 `edgeToast` | — | `sfx warning`, `haptic` |
| GameOver | (파산 직후면 400 ms 쉼) `victory`(triple: 그룹마다 한 칸+그룹색, line: 변의 도시, hubs: 허브 4) ∥ 스탬프 | — | `sfx win`, `haptic`, `confetti(76)` |
| TurnEnded / TravelDeclined / AuctionDropped / AuctionEnded / PromptOpened | 없음 | | |

`EVENT_FX`는 `{ [K in GameEventType]: … }` 타입이라 새 엔진 이벤트는 컴파일 에러, 테스트는 추가로 `src/engine/types.ts`의
`GameEvent` 유니온을 런타임에 읽어 매핑 키와 비교한다(누락 시 실패). 이벤트마다 샘플 → 기대 프리셋 목록 → 각 호출이 유효한
타임라인을 만드는지, `applyAt` cue가 타임라인에 있는지 확인(45개 테스트).

### 14.2a 연동 당시의 이벤트별 호출 표 (구 `VFX-WIRING.md` §8)

연동 체크리스트 문서(`docs/VFX-WIRING.md`)는 모두 적용된 뒤 지웠다. 그 문서의 매핑 표만 여기 남긴다. 지금의 정본은
`src/ui/fx/fxmap.ts`(14.2)이고, 아래 "기존 코드에서 제거" 열의 `particles.*`는 이미 없어진 구 파티클 모듈이다.

원칙:
1. **상태 변경을 cue 프레임으로 미룬다**(VFX.md §7.2b.12-2): `Built`/`PropertyBought`/`TakenOver`는 현재 `vs` 변경 + `render()`를
   먼저 한다 → 새 흐름에서는 `h.cue('swap' | 'frame')`를 기다린 **다음** 변경·`render()`. `fast`(instant)·reduced-motion에서는 cue가
   즉시 resolve되므로 코드 경로가 하나로 유지된다.
2. `play()`는 **DOM 변경 다음 프레임에** 시작(PERFORMANCE.md §7): 엔진의 첫 틱이 다음 격자 프레임이므로 추가 조치 불필요.
3. 프리셋의 SFX/햅틱과 기존 호출이 겹치지 않게 "제거" 열을 지운다. Stage 스탬프/토스트(문구, ↻)는 유지 — 캔버스엔 글자가 없다.
4. `satisfies Record<GameEventType, …>` 형태의 매핑 표를 두어 새 엔진 이벤트가 생기면 컴파일 에러가 나게 한다(VFX.md §8.4).

| 이벤트 | 조건 | 호출 (블록 = `await h`) | cue/상태 | 기존 코드에서 제거 |
|---|---|---|---|---|
| `RoundStarted` | 마지막 3라운드 진입 | `void fx.play('ringPulse', { at: { stage: true }, color: '#F5A25D', sparkles: 0 })` | — | (토스트·`warning` 유지, 프리셋 sfx 없음) |
| `TurnStarted` | 항상 | `void fx.play('ringPulse', { at: { space: pos }, player: id, sparkles: 3 })` (턴 후광, I0) | — | — |
| `TurnEnded` | — | 없음 | — | — |
| `DiceRolled` | 착지 | `void fx.play('diceLand', { points: stage.dice.clientCenters() })` — `dice.roll()` resolve 직후 | — | — |
| 〃 | 더블 | `void fx.play('doublesFlash', {})` | — | 없음(프리셋은 햅틱만; `doubles` 소리는 `Dice.ts`가 재생), 스탬프 유지 |
| 〃 | 3연속 더블 | `await fx.play('doublesFlash', { triple: true })` | — | `haptic('warning')` |
| `TokenMoved` | walk, 홉마다 | `Board.hop`의 착지 콜백에서 `void fx.play('hopDust', { space: i, long: path.length >= 6, dir })` | — | — |
| 〃 | jump | `await fx.play('cometJump', { from: ev.from, to: ev.to, player })` 후 `board.jump` | — | — |
| `PassedStart` | | `void fx.play('passStart', { player, landed: ev.landed })` | — | `sfx('pass-start')`, `haptic`, `particles.coinShower` |
| `MoneyChanged` | card + | `void fx.play('billRain', { player, n: tier })` | — | `sfx('cash-in')` |
| 〃 | card − / tax / donation / bail | `void fx.play('coinIn', { from: { panel: player }, to: ev.spaceIndex !== undefined ? { space: ev.spaceIndex } : { stage: true }, n: 5 })` | — | `sfx('cash-out')` |
| 〃 | salary/pot/toll/purchase/build/takeover/bankruptcy | 없음(전용 이벤트가 연출) — 숫자 카운트업만 | toll: `tollPay`의 `arrive` cue 이후 float | toll float 캡션은 유지 또는 `label:null` |
| `PotChanged` | 증가 | `void fx.play('ringPulse', { at: { space: FESTIVAL_INDEX }, sparkles: 2, scale: 0.6 })` (팟 표시 위치 칸) | — | — |
| `PropertyBought` | | `const h = fx.play('plotClaim', { space, player, price: ev.price, hub: isHub(space), via: ev.via }); await h.cue('frame');` → `vs.owner = …; render();` → `await h` | `frame` f10 | `sfx('buy')`, `haptic('success')`, `pulseSpace(stamp)`; 토스트 유지. 이후 그룹 완성 시 `groupChain` |
| 〃 → 그룹 완성 | `completedGroup(vs, pid, i)` | `await fx.play('groupChain', { spaces, player, color }).cue('badge')` → 배지 DOM 팝, `await` | `badge`, `stamp` | Stage 스탬프 "독점"은 `stamp` cue에 |
| `CannotAfford` | | `void fx.play('puff', { at: { panel: player }, smoke: 1 })` | — | 토스트 유지 |
| `Built` | level 1–3, !free | `const h = fx.play('buildSeq', { space, player, level }); await h.cue('swap'); vs.level = level; render(); await h;` | `swap` f6/f9/f13 | `sfx('build')`, `haptic`, `pulseSpace(pop)` (팝은 `dom.pop`) |
| 〃 | level 4 | `landmarkReveal` (또는 `buildSeq` level 4 — 같은 타임라인). 그룹도 완성되면 `{ group }` 전달(복합) | `swap` f17, `stamp` f22(Stage 스탬프 "명소 완성"), `settle` f36(정적 `.landmark` 글로우) | `sfx('landmark')`, `stage.stamp` 즉시 호출 → `stamp` cue로 이동 |
| 〃 | `free` | `fx.play('buildSeq', { space, player, level, free: true, from: stage.cardClientCenter() })` (§7.2b.6; L4 → comet 변형) | `swap` f8 (L4 f17) | 동일 |
| `Demolished` | typhoon | `await Promise.all([fx.play('puff', { at: { space }, smoke: 3, bricks: 8, scale: 1.2 }), stage.toast(…)])` | — | `sfx('warning')` 유지(프리셋 sfx 없음), `pulseSpace(shake)` 유지 |
| 〃 | sale | `void fx.play('puff', { at: { space }, bricks: 3 })` | — | — |
| `TollPaid` | !waived | `const h = fx.play('tollPay', { payer, receiver: ownerId, amount, festival, multiplier, space, payerCashAfter, label: null }); await Promise.all([stage.showToll(…), h]);` 수령자 float는 `h.cue('arrive')` 이후 | `arrive` | `sfx('toll')`, `haptic('medium')`, `particles.coinArc` |
| 〃 | waived | `fx.play('tollPay', { …, waived: true })` | — | 동일 |
| `TakenOver` | | `const h = fx.play('takeoverStamp', { space, buyer, seller }); void h.cue('stamp').then(() => stage.stamp(…)); await h.cue('frame'); vs.owner = buyer; render(); await h;` + 그룹 완성 검사 | `stamp` f16, `frame` f18 | `sfx('takeover')`, `haptic('heavy')`, `shake(view.table)`, `pulseSpace(stamp)` |
| `TakeoverBlocked` | | `void fx.play('ringPulse', { at: { space }, color: '#6EC6F0', double: true, sparkles: 8 })` | — | 토스트·sfx 유지 |
| `CardDrawn` | | `void fx.play('cardReveal', { tone: cardTone(ev.cardId), at: stage.cardClientCenter() })` 후 `await stage.showCard` (톤: 좋음 good·나쁨 bad·이동 move·보관 keep) | — | 없음(프리셋은 소리 없음; `card`는 `Stage.showCard`가 재생) |
| `CardKept` | | `void fx.play('ringPulse', { at: { panel: player }, color: '#B08AF5', sparkles: 6 })` | — | — |
| `CardUsed` | | `void fx.play('puff', { at: { panel: player }, color: '#FFFFFF' })` | — | — |
| `CardNoEffect` | | `void fx.play('puff', { at: { stage: true } })` | — | — |
| `ExpressGranted` | | `void fx.play('ringPulse', { at: { panel: player }, sparkles: 4 })` | — | — |
| `SentToIsland` | | `await fx.play('islandSiren', { space: ISLAND_INDEX, player, cause: ev.cause })` | — | `sfx('island')`, `haptic` (토스트 유지) |
| `IslandStay` | | `void fx.play('ringPulse', { at: { space: ISLAND_INDEX }, color: '#6EC6F0', double: true, sparkles: 0 })` | — | — |
| `Escaped` | | `void fx.play('ringPulse', { at: { space: ISLAND_INDEX }, player, sparkles: 8 })` (bail: 먼저 `coinIn` panel→섬) | — | `sfx('escape')` 유지(프리셋 sfx 없음) |
| `FestivalSet` | 칸 | `await fx.play('festivalBurst', { space, player, previous: ev.previous })` | — | `sfx('festival')`, `haptic`, `pulseSpace(pop)` |
| 〃 | null | `void fx.play('puff', { at: { space: ev.previous } })` (previous 있을 때) | — | — |
| `TravelGranted` | | `void fx.play('ringPulse', { at: { space: TRAVEL_INDEX }, color: '#6EC6F0', sparkles: 8 })` | — | — |
| `TravelDeclined` | | 없음 | — | — |
| `DebtStarted` | | `void fx.play('ringPulse', { at: { panel: player }, color: '#F5A25D', double: true, sparkles: 0 })` | — | 토스트·sfx 유지 |
| `DebtSettled` | | `void fx.play('ringPulse', { at: { panel: player }, color: '#3DBB6E', sparkles: 6 })` | — | — |
| `BuildingSold` / `PropertySold` | | `void fx.play('coinIn', { from: { space }, to: { panel: player }, n: 4 })` + `puff` | — | — |
| `PropertyTransferred` | 처음 6칸만 | `void fx.play('ringPulse', { at: { space }, player: to ?? undefined, sparkles: 2 })` (60–90 ms 간격은 기존 `sleep(90)`) | — | — |
| `Bankrupt` | | `await Promise.all([fx.play('bankruptcy', { player }), panel.breakApart(), stage.stamp(…)])` | — | `sfx('bankrupt')`, `haptic('heavy')`, `shake(view.table)` |
| `AuctionStarted` | | `void fx.play('ringPulse', { at: { space }, sparkles: 4 })` | — | — |
| `AuctionBid` | | `void fx.play('tap', { ...panel(pid).clientCenter(), player: pid })` | — | — |
| `AuctionDropped` / `AuctionEnded` | | 없음(낙찰은 `PropertyBought via:'auction'`) | — | — |
| `OneAway` | | `void fx.play('oneAway', { space: ev.missing, player })` + 기존 `edgeToast` | — | `sfx('warning')`, `haptic('warning')` |
| `PromptOpened` | | 없음 | — | — |
| `GameOver` | | `await fx.play('victory', { winner, kind, spaces, colors })` (triple: 그룹마다 한 칸 + `GROUP_COLORS`, line: 변의 7칸, hubs: `HUB_INDICES`) | 블록 f45 | `sfx('win')`, `haptic`, `particles.confetti(76)`; `stage.stamp` 유지, `sleep(1700)` → `h.done` 대기로 대체 가능 |

`Bankrupt` 직후 `GameOver`가 오면(첫 파산 = 종료) 두 연출 사이 300–500 ms 여백: `await sleep(400)`(VFX.md §7.4).

### 14.3 보고 나서 고친 것 (스크린샷·필름스트립 검토)

1. **명소 스탬프·클로즈업이 다음 턴으로 돌아감**: 블록(f24)만 기다리면 곧바로 `TurnStarted`가 스테이지를 다음 좌석으로 돌려
   "명소 완성!" 스탬프와 클로즈업 카드가 옆 사람 쪽을 봤다 → `vfx.settled(3)`을 턴 전환 전과 배치 끝에서 대기.
2. **클로즈업 카드가 스탬프에 가려짐**: 둘 다 스테이지 중앙 → 카드를 좌석 기준 4.2u 위로(스탬프는 아래 중앙).
3. **스포트라이트가 1600×1000 레이어**(페이드 중 25 MB): 스테이지 안 정적 베일(카드 둘레 투명)로 교체 — 레이어 0.
4. **SVG 팝/줌펀치가 보드를 합성시킴**: CSS transform 애니메이션이 보드 SVG를 합성 → 위의 마크 레이어가 오버랩 레이어로 +14 MB
   → `transform` 속성을 30 Hz로 트윈(보드 1회 리페인트/프레임, 400 ms).
5. **쉐이크 레이어**: `.table` 쉐이크는 33 MB, `.board`는 27 MB 레이어 → 쉐이크는 `.fx-layer`(캔버스)만. 승리 12 px 쉐이크와
   승자 패널 범프는 제거(전면 스쿼시 레이어 24 MB) → 히트스톱만.
6. **연쇄 효과가 전체 화면 캔버스를 남김**: 합집합 영역이 마지막 파티클까지 유지 → 효과가 끝날 때 남은 효과 영역으로 축소,
   보존 백킹 재사용은 새 영역이 70 % 이상일 때만, 승리 영역은 보드+승자 패널로 제한.
7. **4× 프레임 예산**: 소프트웨어 캔버스는 매 프레임 백킹 전체를 합성기로 복사(Commit) → 게임 안 백킹 예산 0.9 → 0.5 MP
   (작은 효과는 1.5× 그대로, 테이블 전체 효과만 부드러워짐), 홉 먼지는 착지 홉만(걷는 내내 캔버스가 살아 있었음).
8. **결과 화면 색종이가 장식 구간 게이트를 깸**: 마운트 시점에 결정(속도 0/reduced면 없음 — 구 동작과 동일).
9. 수신자 금액 팝이 코인 도착(`arrive` cue) 전에 뜸 → `MoneyChanged(toll,+)`가 cue를 기다림. E/N/W 좌석: 망치·크라운·태그·
   스탬프·클로즈업이 행위자 좌석으로 회전하는 것, 효과가 올바른 칸에 붙는 것, 캔버스가 보드 가장자리에서 잘리지 않는 것을
   `e2e/__screenshots__/vfx-*-{E,N,W}-*.png`로 확인.

### 14.4 등급·콤보 규칙 (§6.2, `vfx/director.ts`, 테스트 `director.test.ts`)

- 병합: 같은 프리셋·같은 대상이 12 FX 프레임(400 ms) 안에 다시 오면 **액센트**(파티클 ×0.4, 쉐이크·히트스톱·플래시 없음, 소리 유지).
- 체인 강등: I3+ 타임라인이 도는 동안 시작한 I1–I2는 액센트. 동시 상한 I2 2개 · I1 4개(초과분 액센트).
- I3/I4는 한 번에 하나: 엔진이 앞 큰 효과의 타임라인이 끝날 때까지(최대 27 FX 프레임) 시작을 미룬다(`serializeBig`).
- 피치 래더: 1.5 s 안 연속 `cash-in`은 반음씩 상승(최대 +7), `cash-out`은 하강(최대 −4). 모든 게임 사운드 경로(프리셋 포함)에 적용.
- 명소+독점 복합 프리셋은 규칙상 동시에 생기지 않는다(독점은 소유 변경 시점, 명소는 건설) — 엔진에는 남아 있고 연결은 안 함.

### 14.5 스크린샷·필름스트립 (`e2e/vfx.spec.ts`)

수작업 상태(사람 4명, 시드 7) + dev 훅 `dispatch`, **수동 클록으로 2틱마다 1장**. 시퀀스: 구매+파랑 독점(S) → 건설 L1·L2·L3·
명소 L4(E) → 통행료(N이 W의 호텔에) → 인수+빨강 독점(N) → 명소(W) → 허브 승리(W). 1600×1000 전부, 800×450은 명소(W) 제외.

- 필름스트립: `docs/assets/vfx-ingame/<장면>-<W>x<H>.png` (영역 = 그 장면 효과의 캔버스 영역)
- 가장 붐비는 프레임: `e2e/__screenshots__/vfx-<장면>-<W>x<H>.png`
- 각 장면: 콘솔 에러 0, 라이브 파티클 > 0(피크 18–121, ≤ 300), 끝나면 캔버스 hidden · `ticking=false` · `activeTicks()=0`.
- 추가 테스트: reduced motion(캔버스 0개, `.bm-hl` 정적 표식, 상태 적용), 효과(클로즈업+베일) 도중 프롬프트 버튼 클릭 가능,
  피날레 중 탭 → 엔진 유휴까지 404–431 ms(≤ 500).

### 14.6 성능 (`npm run perf -- --full --unique`, 원자료 `docs/assets/perf-fx.json`)

`fx` 페이즈: 사람 4명 게임(굴림 대기)에서 dev 훅으로 최악 연쇄(통행료 XL → 인수 → 명소+독점 → 파산 → 허브 승리)를 워밍업 1회 뒤 재생.

| 결과 | 게이트 | 값 |
|---|---|---|
| PASS | F1 FX 후 유휴 0 (500 ms 뒤 10 s) | Layout/Paint/Raster/style/rAF/timer/layerPainted 0, task 2 ms, 캔버스 hidden, 클록 콜백 0 |
| PASS | F2 라이브 파티클 ≤ 300 | 피크 117, 드롭 0 |
| PASS | F3 레이어 ≤ 20 · 메모리 ≤ 100 MB | 16개, 98.2 MB (루트 24.4 + 메뉴 스쿼시 24.4 + 캔버스 1488×1000 22.7 + 토큰 14.4 + 스테이지 7.5 …) |
| PASS | F4 표시 ≤ 34 fps · 고유 ≥ 24 (스로틀 없음) | 29.2 / 28.3 (4×: 30.5) |
| PASS | F5 rAF p95 ≤ 33 ms (4×) | 16.8 ms (p99 33.3) |
| **FAIL** | F6 메인 스레드 ≤ 150 ms/s (4×) | 380.8 ms/s — **같은 측정의 4× CPU 데모 게임 자체가 332.9 ms/s**. 150은 데모 페이지 벤치 기준이라 실제 게임(레이어 16개의 커밋·스타일)에는 맞지 않는다. 가장 큰 항목은 Commit(소프트웨어 캔버스 복사) |
| PASS | F7 20회 반복 | 힙 2.9 → 3.0 MB, DOM 1617 → 1617, 캔버스 1 |
| PASS | F8 아틀라스 | 287.1 KB |
| PASS | F9 부팅 | 407 ms |
| PASS | F10 피날레 스킵 | 420 ms |

기존 게이트(같은 실행): A 31.5 / 57.7 fps PASS, B 유휴 0(게임·타이틀·결과, 장식 루프) 전부 PASS, 레이어 피크 19 · 메모리
97.9 MB PASS, 마운트 65.6 ms, 부팅 407 ms, DOM 상한 PASS. **회귀**: C p99 16.8 → 33.4 ms, "33 ms 초과" 22프레임, Paint 22/s(> 20).
원인은 FX 자체(4× CPU 데모 60 s × 3회, 20 ms 초과 프레임: FX 끔 48–59 · 0.9 MP 122–145 · **현재 0.5 MP + 착지 먼지 79–100** ·
0.3 MP 74–88). 연동 전 코드도 이 VM에서 20 ms 초과가 31–64/분으로 p99 문턱(≈35/분) 근처였다. Paint는 캔버스가 보이거나
크기가 바뀔 때 문서 레이어 재기록(연동 전 18.3/s, FX 없음 20.2/s, 현재 22–23/s).

### 14.7 남은 것 / 거친 부분

- ~~4× p99·Paint/s·F6 미달(14.6)~~ → **§15에서 해결**: 효과를 여러 작은 풀 캔버스로 나누고(부분 표시), 캔버스 그리기와
  합성기 복사를 **워커(OffscreenCanvas)** 로 옮기고, 게임에서는 캔버스 1장을 표시/숨김 없이 재배치·주차하고, 좌표 사각형을
  캐시(강제 레이아웃 제거)했다. 효과가 켜진 게임의 메인 스레드는 효과를 끈 게임의 ×1.11–1.21, 긴 프레임은 연동 전 코드와 같은
  수준, Paint 18.8–19.6/s, 레이어 19개. 품질 단계(자동/높음/낮음/끄기)와 적응형 품질은 §15.4.
- 쉐이크는 FX 레이어만 흔든다(보드·패널은 고정) — 레이어 예산 때문. 실기기에서 부족하면 보드 쉐이크를 I3에만 되살리는 A/B.
- 스포트라이트는 스테이지 안만 어둡게 한다(칸은 밝은 채) — 전체 화면 베일은 25 MB 레이어.
- ~~reduced motion: 건설은 첫 소리가 납품 `cash-out`이라 `build` 소리가 안 난다~~ → 마지막 망치 소리에 `rm` 표시(§15.4,
  "끄기"가 사용자 설정이 되어서).
- 필름스트립 PNG 17장 8.5 MB. 클로즈업 카드는 스테이지 중앙이라 캔버스 영역으로 자른 스트립에는 안 보이고 전체 화면
  스크린샷(`e2e/__screenshots__/vfx-build4-*`, `vfx-landmark-W-*`)에서 보인다.
- ~~"앱 설정: 애니메이션 줄이기" 토글 UI는 없음~~ → 설정 "연출 품질 / Effects"의 "끄기"(§15.4) = 애니메이션 줄이기 경로.

---

## 15. 성능 2라운드: 부분 표시 · 페인트 워커 · 품질 단계 (2026-09-30)

제품 책임자 요구: **30 fps 상한에서 부하가 사실상 없을 것, 효과는 역동적이되 싸게.** 연동(§14) 뒤 4×/DPR 2 게이트가
p99 16.8 → 33.4 ms, 33 ms 초과 7 → 22, Paint 17 → 22/s, F6 380 ms/s로 회귀했다. 이 절은 원인 측정, 단계별 결과, 최종 게이트,
품질 단계를 적는다. 원자료 `docs/assets/perf-fx.json`(최종 `npm run perf -- --full --unique`).

### 15.1 원인 (측정)

- **소프트웨어 캔버스는 그린 프레임마다 백킹 전체를 합성기로 복사한다**(`CanvasResourceProviderSharedImage::ProduceCanvasResource`,
  메인 스레드 커밋 안). 합성 페이지에서 4×로 캔버스 1장·30 Hz: 128² 41 · 256² 47 · 512² 88 · 1024×512 140 ms/s(빈 페이지 ~35).
  같은 캔버스를 **워커의 OffscreenCanvas**로 그리면 메인 스레드 39 ms/s(= 캔버스 없음, 메인 스레드 비용 0).
- 캔버스를 **보이기/숨기기**(`display`/`visibility`)는 메인 Paint 1회 + 캔버스 아래 영역 재래스터, 워커 쪽 크기 변경도 Paint +
  Layout. **`transform` 이동은 Paint 0**. 한 번이라도 그린 캔버스는 화면 밖으로 옮겨도 GPU 레이어로 남고 `visibility: hidden`이면
  레이어가 없다.
- 게임(4× CPU 데모)에서 효과 캔버스는 프레임의 60 %에 떠 있었다(턴 후광·주사위·홉 먼지·구매 …). 추적: FX 켬/끔 메인
  스레드 차이 ≈ +105 ms/s = 업로드 59 + 커밋 나머지 + 틱 JS 28. 효과가 켜진 프레임이 20 ms 초과 프레임의 대부분.
- 효과와 별개로 **강제 레이아웃**: `play()`가 좌표를 만들 때 `getBoundingClientRect`(레이어·보드·칸·패널·스테이지)를
  시퀀서의 `render()` 직후에 읽어 30 Hz 틱 안에서 스타일+레이아웃 20–33 ms(4×)를 동기로 치렀다(턴 전환, 구매).

### 15.2 단계별 결과

측정 도구: `npm run perf`의 play/layers/fx 페이즈, `scripts/perf-frames.mjs`(긴 프레임 원인), 새 **`scripts/fx/fx-mix.mjs`**
(사람 4명 게임을 멈춰 두고 흔한 효과 17개를 2.4 s마다 재생 — 메인 스레드 ms/s가 ±5로 안정적이라 엔진 A/B용; 효과 없는 같은
장면 ≈ 62–78 ms/s). "데모" = 시드 고정 4× CPU 데모 게임 60 s(편차 큼: 같은 빌드 20 ms 초과 프레임 ±15).

| 단계 (커밋) | fx-mix 메인 ms/s | 데모 메인 ms/s (FX 끔 대비) | 데모 20 ms 초과 / 분 | Paint/s · 피크 레이어 | 표시/숨김 /s |
|---|---|---|---|---|---|
| 시작 (`055686b`, 합집합 캔버스 0.5 MP, 메인 스레드) | 240 | 335–352 (×1.34) | 95–124 | 22.6 · 19 | — |
| 1. 클러스터별 작은 풀 캔버스(고정 크기 등급, transform 배치), 트림 박스, 히트스톱 중 안 그림 (`668035e`) | 208–216 | 344–359 | 83–86 | — | 4 |
| 2. **페인트 워커**(OffscreenCanvas) (`2e0d1de`) | 158 | 329–340 (×1.10) | 61–73 (FX 끔 68–75) | 24.4 · 19 | 4.9 |
| 3. 게임은 캔버스 1장(400×400 → 필요 시 960×600 한 번, 세션 중 축소 없음), SVG 아이콘 팝 15 Hz (`e6afa8b`) | — | 262–294 (×1.0) | 34–40 (FX 끔 60–79) | 19.8–20.1 · 19 | 0.05 |
| 4. 품질 단계 + 적응형(§15.4) (`387ffd5`) | — | 262 (auto = high 유지) | 49 | — | — |
| 5. 유휴 시 캔버스 **주차**(transform, Paint 0), 유예 8틱, 좌표 사각형 캐시(강제 레이아웃 제거), high는 꼬리도 30 Hz (`4b2a8a2`) | — | F6 ×1.11–1.21 | 36–51 (연동 전 빌드 44–47) | 18.4–19.6 · 19 | — |

데모 페이지(당시 `vfx-perf.mjs`, 4×, §13.5와 같은 조건): 틱(이제 메인 스레드의 업데이트 + 샘플·클러스터·레코드만 —
그리기와 백킹 할당·복사는 워커) 통행료 XL 1.02 / 2.6 / **3.2** ms, 명소+독점 1.12 / 2.6 / **3.4**, 승리(허브) 0.85 / 2.0 / **3.8**
(평균 / p95 / 최대; §13.5는 0.89 / 2.0 / 13.4 · 1.22 / 2.4 / 9.5 · 1.38 / 3.3 / 15.3 — 최대값의 백킹 할당 스파이크가 메인에서 사라짐).

단계 3 뒤 첫 전체 실행은 24/28(B 장식 구간 — 3 s 유예의 숨김이 창 안에서 Paint, F4 고유 22 fps — 15 Hz 꼬리, C 두 개). 단계 5가
앞의 둘을 고쳤다. 같은 날 **연동 전 빌드(`635532b`)와 번갈아 3회씩**: 20 ms 초과 36/50/51 vs 47/44/46, 2 vsync 초과 6/16/12 vs
9/4/8(빈 페이지 바닥값 7/0/4 · 1/1/2), p99는 양쪽 모두 33.3 ms — 효과가 긴 프레임을 더하지 않는다.

### 15.3 바뀐 구조

| 무엇 | 파일 | 내용 |
|---|---|---|
| 부분 표시 | `vfx/present.ts` | 매 프레임 살아 있는 파티클의 **트림된 실제 그림 사각형**(아틀라스 프레임 트림 × 변환)으로 격자 union-find 클러스터링 → 겹치거나 싸게 합칠 수 있는 것 병합 → 캔버스 수 한도까지 최소 면적 증가 병합. 클러스터마다 풀 캔버스(크기 등급 40/80/160/320 K px × 1:1·3:2·2:3 + 960×600) 하나를 `translate + scale`로 배치. 캔버스는 **절대 크기가 안 바뀐다**(숨긴 채 해제만), 배치·배율은 양자화(1.5, 1.25, 1, 0.85 …)해 매 프레임 바뀌지 않게. 백킹 배율 = min(1.5, DPR) 단 프레임 예산(게임 0.5 MP = 연동 때 합집합 예산)을 넘으면 낮춤. CSS 상자 = 백킹/2(DPR 2에서 레이어 메모리 = 실제 텍스처) |
| 게임 설정 | `game/view.ts` | 캔버스 **1장**(`maxCanvases: 1`, 풀 [400×400, 960×600]): 보이는 캔버스는 각각 GPU 레이어(게임 피크 18 + 1 = 19 ≤ 20)이고 표시/숨김마다 메인 Paint인 반면 큰 백킹은 워커의 복사만 늘린다. 세션 중에는 더 큰 캔버스로 한 번만 바꾸고 줄이지 않음(sticky) |
| 페인트 워커 | `vfx/fx.worker.ts`, `vfx/paint.ts` | 풀 캔버스를 `transferControlToOffscreen()`, 워커가 아틀라스를 직접 로드(메인은 JSON만 — 프레임 트림 박스). 엔진(메인)이 클러스터·배치·그리기 순서를 정하고 프레임마다 레코드 배열(파티클당 13 float, 백킹 px 변환 포함)을 **전송(transfer)**, 워커는 받자마자 지난 영역만 지우고 다시 그린다(버퍼는 되돌려 받아 재사용 — 프레임당 할당 0). 받자마자 그려야 메인 커밋과 같은 디스플레이 프레임에 들어간다(측정: 30 Hz 메인 애니메이션과 함께 30.3 스왑/s; 워커 rAF에서 그리면 56.9). 수동 클록(필름스트립·테스트), 주입 로더, 워커 미지원이면 **같은 페인터를 메인 스레드에서**(결정적 스크린샷) |
| 유휴 | `vfx/present.ts` `park()` | 마지막 파티클 뒤 8틱 → 캔버스를 **레이어 밖으로 이동**(Paint 0, 합성 대상 아님; 내용은 마지막 빈 프레임에서 이미 지움) + 클록 해제. 다음 효과는 옮겨 오기만 한다. `stopAll`/`dispose`는 숨기고 해제 |
| 그리기 빈도 | `vfx/engine.ts` | FX 시간이 안 흐른 틱(히트스톱)과 빈 프레임은 그리지도 보내지도 않음. high는 30 Hz, low는 꼬리(타임라인 비트 끝 + 8프레임 넘은 파티클만)를 15 Hz |
| 강제 레이아웃 | `game/view.ts` | FX 좌표용 클라이언트 사각형을 `applyLayout`(뷰포트 변경)까지 캐시 |
| 보드 아이콘 팝 | `board/Board.ts` | SVG `transform` 속성 트윈을 15 Hz 단계로(보드 레이어 리페인트 절반) |
| 하네스 | `scripts/perf.mjs` | 표시 fps = max(렌더러 DrawFrame, viz `Display::DrawAndSwap`) — 워커 프레임은 DrawFrame 없이 화면에 간다. F6 상대 게이트, F7 캔버스 증가 0, "33 ms 초과"는 빈 페이지 바닥값 + 3 |

### 15.4 품질 단계 (설정 "연출 품질 / Effects")

| 설정 | 동작 |
|---|---|
| **자동**(기본) | high로 시작해 적응(아래). 게임마다 새로 시작, 저장 안 함 |
| **높음** | 전부: 파티클 전량, 가산 광원, 쉐이크·히트스톱, 백킹 1.5×(DPR 상한), 30 Hz |
| **낮음** | 파티클 ×0.5, `glow` 스프라이트(큰 가산 광원·플래시) 없음, 쉐이크 없음, 백킹 1×, 꼬리 15 Hz |
| **끄기** | 캔버스 없음: 첫 효과음·햅틱(+ `rm` 표시 소리) · 정적 테두리 표시 · 상태 즉시 적용 = 모션 줄이기 경로. OS `prefers-reduced-motion`도 같은 경로 |

- 적응(`director.ts` `AdaptiveQuality`, 단위 테스트 `present.test.ts`): 파티클이 화면에 있는 실시간 FX 틱마다 (엔진 JS ms,
  직전 틱과의 간격). 30틱(≈ 1 s) 창에서 **틱 p95 > 6 ms 또는 늦은 틱(간격 > 40 ms)이 20 % 초과**면 나쁜 창, **2창 연속** 나쁘면
  한 단계 내림(high → low → minimal = 끄기 경로), low에서 건강한 창 10개 연속이면 high로. minimal은 샘플이 없으므로 20 s 뒤
  다음 효과에서 low를 다시 시도. dev(`?dev=1`)는 전환을 콘솔에 남기고 `fx().quality.transitions`로 노출.
  한 창에 늦은 틱 1–2개는 게임 자체의 이벤트 프레임(렌더·프롬프트 — 효과를 꺼도 생김)이라 제외: p95만 보면 4× 데모에서
  high → low → minimal로 곧장 떨어졌다. 현재 기준: 4× 데모 게임 60 s 내내 high, **10×** 스로틀에서는 high → low → minimal → (20 s) low.
- 설정 변경은 즉시 적용(`prefs.onChange` → `setQuality`), 결과 화면 색종이도 설정을 따름. dev A/B: `?dev=1&fxq=auto|high|low|off`
  (`fxk`·`fxpool`·`fxs`·`fxe`·`fxdom`·`fxsw` 노브는 2026-10-06에 지우고 출시 값으로 고정).

### 15.5 최종 게이트 (`npm run perf -- --full --unique`, 4× CPU, DPR 2, 품질 자동 = high 유지)

| 결과 | 게이트 | 연동 직후(§14.6) | 지금 |
|---|---|---|---|
| PASS | A 절전 ON 표시 fps 26–34 / OFF ≥ 55 | 31.5 / 57.7 | 33.5 / 58.3 (렌더러 DrawFrame 31.0, 고유 34.6 — 아래) |
| PASS | B 유휴 0(게임·타이틀·결과) + 장식 루프 합성기 전용 | PASS | 전부 PASS (task 1–2 ms) |
| **FAIL** | C 프레임 p99 ≤ 20 ms | 33.4 | 33.3 (20 ms 초과 58, 빈 페이지 6) — **연동 전 빌드도 같은 날 33.3**(44–47) |
| **FAIL** | C 33 ms 초과 ≤ 빈 페이지 바닥값 + 3 | 22 | 9 (바닥값 1) — 연동 전 빌드 4–9 (바닥값 1–2) |
| PASS | C 마운트 ≤ 100 ms · 부팅 ≤ 1.5 s · DOM 상한 | 65.6 · 407 · 1.10 | 80.3 · 382 · 1.09 |
| PASS | C 피크 레이어 ≤ 20 · 메모리 ≤ 100 MB | 19 · 97.9 | **19 · 93.5** |
| PASS | C Paint ≤ 20/s | **22 (FAIL)** | **18.4** |
| PASS | C 강제 레이아웃 ≤ 50 ms | 13.9 | 12.6 |
| PASS | F1 FX 뒤 유휴 0 | PASS | PASS (task 1 ms, 캔버스 주차, 클록 콜백 0) |
| PASS | F2 파티클 ≤ 300 | 117 | 117 |
| PASS | F3 레이어 ≤ 20 · ≤ 100 MB | 16 · 98.2 | 16 · **80** |
| PASS | F4 표시 ≤ 34 · 고유 ≥ 24 | 29.2 / 28.3 | 29.9 / 29.6 |
| PASS | F5 rAF p95 ≤ 33 ms (4×) | 16.8 | 16.8 |
| PASS | **F6 메인 스레드, 효과 켬 ≤ 1.35 × 끔** (새 기준, 같은 데모) | 380.8 ms/s (FAIL, 절대 150) | 272.9 vs 239.1 = **×1.14** |
| PASS | F7 20회 반복: 힙 · DOM · 캔버스 증가 0 | PASS | 3.2 → 3.2 MB, DOM +0, 캔버스 2 → 2 |
| PASS | F8 아틀라스 · F9 부팅 · F10 스킵 ≤ 500 ms | 287 KB · 407 · 420 | 287 KB · 382 · 430 ms |

**26/28.** F6을 절대값(150 ms/s)에서 상대값으로 바꾼 이유: 150은 데모 페이지(효과만 있는 빈 장면) 벤치에서 나온 값인데,
실제 게임의 메인 스레드(레이어 16개의 커밋·스타일·게임 렌더, 효과를 꺼도 240–300 ms/s @4×)에는 적용할 수 없다. 효과가 지켜야
할 것은 "게임 위에 얹는 비용"이므로 **같은 시드 게임에서 효과 켬/끔 비**로 잰다(효과 끔 = 설정 "끄기" 경로 — 정적 표식과
소리만). 효과만의 비용은 fx-mix(효과만 도는 장면)에서 연동 직후 175 → 84 ms/s(워커) 수준이다.

### 15.6 남은 것

- **C p99 ≤ 20 ms / 33 ms 초과 ≤ 바닥값 + 3**: 이 VM의 이날 환경에서는 **연동 전 빌드도 미달**(p99 33.3, 20 ms 초과 44–47/분
  vs 게이트가 허용하는 ≈ 35/분). 효과 켬은 연동 전과 같은 수준(15.2). 남은 긴 프레임은 `perf-frames.mjs`로 보면 메인 스레드가
  노는 구간(스로틀러 시분할, "rendering from +55 ms") 또는 게임 이벤트 프레임이다. 실기기(GPU 합성, 스로틀 아님)에서 확인 필요.
- 표시 fps 33.5(DrawFrame 31.0): 워커 프레임이 메인 커밋과 다른 vsync에 들어가는 경우가 ~2.5/s 남는다(고유 34.6/s). 게이트
  안이지만 경계. 워커에서 rAF로 그리면 더 나빠진다(56.9). 실기기 30 Hz 패널에서는 디스플레이가 합친다.
- 워커의 복사 비용(큰 효과 동안 960×600 백킹)은 메인 스레드 밖이지만 배터리 비용은 남는다 — 게임에서 400×400으로 시작해
  필요할 때만 커진다.
- 워커 백엔드는 헤드리스 결정적 스크린샷에서 쓰이지 않는다(수동 클록 = 메인 페인터, 같은 코드). 실시간 경로는 perf `fx` 페이즈와
  e2e 스킵 테스트가 지나간다.
- `Dice.clientCenters`/`Stage.cardClientCenter`(주사위·카드 위치)는 움직이는 요소라 캐시하지 않았다(주사위 굴림·카드 뽑기 프레임).

## 16. 이벤트 연출 +1초 (2026-10-06)

제품 책임자 요청("여전히 너무 빠르다"): 모든 이벤트 연출을 합계 1초 더 길게, 0.5초는 동작 자체를 늘리고 0.5초는 마지막
장면을 더 오래 둔다. 상수는 하나: `src/ui/fx/time.ts` `EVENT_EXTEND = { motionMs: 500, holdMs: 500 }`(게임 속도 2 기준;
시간 정책 표 맨 위). 머니 컷인은 `docs/MONEY-EVENTS.md` §12.4.

캔버스 프리셋(이벤트일 때만, `animate.ts` `EXTENDED` → `vfx.play(…, { extend: true })`):

- 효과 하나가 통째로 비례해서 느려진다: 타임라인 프레임과 그 효과 파티클의 나이가 FX 프레임마다 `rate`(< 1)씩 간다
  (`Effect.rate`, 풀 `rate`). 수명·지연·페이드·경로·크기 곡선·회전·스프라이트 프레임·탄도(dt × rate, drag^rate)가 모두
  같은 비율로 길어지고, 파티클 수와 모양은 같다. 흔들림(ms)도 같은 비율. 히트스톱은 그대로.
- `rate`는 효과 길이(마지막 op 또는 마지막 파티클; 스폰을 기록용 컨텍스트로 한 번 미리 돌려 잰다, `timelineFrames`)가
  정확히 `motionMs`(15 f) 늘도록 정한다(`extendRate`). 시퀀서가 기다리는 block은 정확히 15 f 뒤(`extendBlock`), 큐는 비율대로.
- 이벤트 카드 반짝임(`cardReveal`)은 카드 DOM 애니메이션과 같은 배율(`CARD_STRETCH`)로 늘려 뒤집기 꼭짓점에 맞춘다.
- 애니메이션 줄이기·품질 끔: 예전처럼 캔버스 없음(소리 + 정적 강조). 이 경로의 프리셋은 원래 시퀀서를 붙잡지 않는다;
  토스트·카드·정지(`eventHold`)의 늘어난 시간은 그대로 지켜진다.

프리셋 길이(단위 테스트 `src/ui/fx/vfx/__tests__/extend.test.ts`, 30 fps FX 프레임; block = 시퀀서가 기다리는 프레임):

| 프리셋 (이벤트) | 길이 전 → 후 | block 전 → 후 |
|---|---|---|
| `festivalBurst` (축제 지정, 이전 축제 칸에서 혜성) | 45 → 61 | 23 → 38 |
| `islandSiren` (무인도 도착; 사이렌 변형) | 33 → 49 | 24 → 39 |
| `groupChain` (독점, 3칸) | 43 → 59 | 27 → 42 |
| `victory` (게임 끝, 한 줄) | 114 → 130 | 49 → 64 |
| `ringPulse` (여행·무인도·방패·빚·경매 시작) | 16 → 31 | 없음 |

DOM 쪽(`src/ui/stage/Stage.ts`): 이벤트 토스트 `toast(…, event)`는 등장 260 → 543 ms, 퇴장 200 → 417 ms, 읽는 시간
+500 ms(합계 +1 s); 이벤트 도장 `stamp(…, event)` 900 → 1400 ms; 이벤트 카드는 움직임(올라옴·뒤집기·사라짐)
1090 → 1590 ms, 읽는 시간 2800 → 3300 ms(게임 속도 2). 자체 정지가 없는 이벤트(독점, 축제, 탈출, 한 칸 남음, 게임 끝)는
그 뒤에 `eventHold()` 500 ms.

시퀀서가 이벤트마다 기다리는 시간(게임 속도 2, 속도 1, ms):

| 이벤트 | 전 | 후 | 차이 |
|---|---|---|---|
| 이벤트 카드 (읽기 끝까지, 탭하면 더 빨리) | 3890 | 4890 | +1000 |
| 토스트로 보이는 이벤트 (무인도 도착·머묾, 여행, 태풍, 방패, 살 돈 없음, 빚 시작·정리, 경매 시작·낙찰, 카드 효과 없음) | 460 + 2 × 토스트 ms | 960 + 2 × 토스트 ms + 500 | +1000 |
| 독점 완성 (3칸) | 900 | 1900 | +1000 |
| 축제 지정 | 1567 | 2567 | +1000 |
| 게임 끝 (결과 화면까지) | 3833 | 4833 | +1000 |
| 섬 탈출 (토스트는 기다리지 않음) | 800 | 1300 | +500 (토스트 자체는 +1000) |
| 한 칸 남음 (프리셋은 기다리지 않음) | 1000 | 1500 | +500 (프리셋 자체는 +500) |

이벤트가 아닌 것(그대로): 주사위 굴림·더블 도장·세 번째 더블 사이렌, 말 이동(걷기·점프), 차례·라운드 배너, CPU 손,
프롬프트·버튼, 패널 숫자 팝, 경매 입찰·포기·카드 보관·사용 같은 기다리지 않는 강조.

# VFX 연동(와이어링) 체크리스트

> 대상: VFX 엔진 코어(`src/ui/fx/vfx/**`, `src/styles/vfx.css`)를 게임 화면에 붙이는 **연동 단계** 에이전트.
> 엔진 코어 단계에서는 기존 파일을 **하나도 수정하지 않았다**(다른 에이전트가 `src/ui` 성능 작업 중). 아래는 기존 파일에 필요한
> **정확한 변경 목록**이다. 설계 근거는 `docs/VFX.md` §3·§6·§7·§7.2b·§8·§10, 엔진 측정 결과는 §13.
> 각 항목은 체크박스 순서대로 적용하면 된다(앞 항목이 뒤 항목의 전제).

## 0. 엔진 API 요약 (이미 있음)

```ts
import { createFx, type FxHandle } from '@/ui/fx/vfx';

const fx: FxHandle = createFx({
  layer,                         // .fx-layer (캔버스 1장이 여기에 붙음)
  getLayerRect, getBoardRect, getSpaceRect, getPanelRect, getSeat, getStageRect?,   // client rect 콜백 (play() 때 1회 읽음)
  getPlayerColor?,               // 기본: PLAYER_COLORS[id]
  sfx?, haptic?, shake?, dom?, highlight?,   // 부수효과 훅 (아래 §5)
  clock?,                        // 기본 gameClock (time.ts onFrame/animSpeed/isSkipping)
  retainBacking?: boolean,       // §13.3 권장 true
  dev?: boolean,                 // window.__fx
});

const h = fx.play('buildSeq', { space, player, level });   // FxPlay
await h.cue('swap');   // 먼지 속 교체 프레임 — 여기서 vs 변경 + render()
await h;               // 블록 프레임(시퀀서 진행). 꼬리는 계속 재생
await h.done;          // (선택) 마지막 파티클까지
fx.skip(); fx.stopAll(); fx.setQuality('high'|'low'|'off'); fx.preload(); fx.stats(); fx.dispose();
```

프리셋(21종 + 범용 4종): `plotClaim coinIn buildSeq landmarkReveal freeUpgrade frameSwap takeoverStamp groupChain groupFinale
tollPay passStart cardReveal islandSiren festivalBurst bankruptcy victory oneAway doublesFlash diceLand hopDust tap
ringPulse puff cometJump billRain` — 파라미터 타입은 `PresetParams<'name'>`(`src/ui/fx/vfx/presets.ts`).

프리셋은 **자체 SFX/햅틱을 포함**한다(§7 표의 SFX/햅틱 열). 따라서 연동 시 `animate.ts`에서 같은 이벤트의
`sfx.play`/`haptic` 호출은 **제거**한다(중복 재생 방지, §4 표의 "제거" 열). reduced-motion에서도 엔진이 첫 SFX·햅틱을 재생한다.

---

## 1. CSS

- [ ] `src/styles/index.css` 마지막 줄에 추가(캐스케이드상 `game.css` 뒤):

```css
@import './vfx.css';
```

`vfx.css`는 `.fx-canvas`, `.fx-spot`(스포트라이트 베일), `.fx-closeup`(클로즈업 카드), `.fx-hl`(reduced-motion 정적 하이라이트)을 정의한다.
기존 `.pt-canvas`(구 `particles.ts`)는 §9에서 `particles.ts`를 제거할 때 함께 지운다.

## 2. `src/ui/fx/time.ts` — reduced-motion 분리 노출

현재 `instant()`가 `speed===0`과 `prefers-reduced-motion`을 합쳐서 정적 표식 분기가 불가능하다(VFX.md §11 "추가 필요 API").

- [ ] 다음을 추가(기존 동작 불변):

```ts
let reducedSetting = false;
/** 앱 설정 "애니메이션 줄이기" (prefs에서 호출). */
export function setReducedMotion(on: boolean): void {
  reducedSetting = on;
}
/** prefers-reduced-motion 또는 앱 설정: 캔버스 FX 없음 → 정적 표식 + 사운드. */
export function reducedMotion(): boolean {
  return reducedSetting || !!reducedQuery?.matches;
}
```
그리고 `instant()`를 `return speed === 0 || reducedMotion();`으로(동작 동일, 설정 포함).

- [ ] `src/ui/fx/vfx/clock.ts`의 `gameClock.reducedMotion`을 `time.ts`의 `reducedMotion`으로 교체(현재는 media query 직접 조회):

```ts
import { animSpeed, isSkipping, onFrame, reducedMotion } from '../time';
export const gameClock: FxClock = { onFrame, speed: animSpeed, skipping: isSkipping, instant: () => animSpeed() === 0, reducedMotion };
```

## 3. `src/ui/board/Board.ts` — 좌표·DOM 훅 헬퍼

- [ ] **`spaceRect(i)`** (엔진 `getSpaceRect`): 기존 `spaceClientCenter`와 같은 방식(보드 rect 1회 + GEOM, 강제 레이아웃은 보드 1개뿐).

```ts
/** Client rect of space i (for fx). */
spaceRect(i: number): { x: number; y: number; width: number; height: number } {
  const r = this.el.getBoundingClientRect();
  const g = GEOM[i]!;
  const k = r.width / VB;
  return { x: r.left + g.x * k, y: r.top + g.y * k, width: g.w * k, height: g.h * k };
}
```
- [ ] **아이콘 팝/딤/줌펀치**(엔진 `dom.pop/dim/zoomPunch`, VFX.md §7.2b.0) — `pulseSpace`와 같은 `anim()` 경로(30 Hz 양자화)를 쓰고, 대상은
  칸의 레벨 아이콘 요소(상태가 있는 칸 = SVG `g.sp[data-i]` 안의 건물 아이콘 그룹; 보드 베이스 이미지 위 요소):

```ts
popIcon(i: number, o: { from: number; c1: number; frames: number }): void {
  const el = this.levelIconEl(i); if (!el) return;
  // easeOutBack(c1) 곡선을 키프레임으로 샘플 (from → 1)
  const n = o.frames, kf: Keyframe[] = [];
  for (let k = 0; k <= n; k++) { const t = k / n, x = t - 1, e = 1 + (o.c1 + 1) * x ** 3 + o.c1 * x ** 2;
    kf.push({ transform: `scale(${(o.from + (1 - o.from) * e).toFixed(3)})` }); }
  void anim(el, kf, { duration: (n * 1000) / 30, easing: 'linear' });
}
zoomPunch(i: number, k: number): void {   // 1 → k (5f outQuad) → 1 (7f inOutQuad), z-index 임시 상승(레이어 추가 없음)
  const g = this.groups[i]; if (!g) return;
  void anim(g, [{ transform: 'scale(1)' }, { transform: `scale(${k})`, offset: 5 / 12, easing: 'ease-in-out' }, { transform: 'scale(1)' }],
            { duration: 400, easing: 'ease-out' });
}
dimIcon(i: number, on: boolean): void { this.levelIconEl(i)?.classList.toggle('is-building', on); }  // CSS: opacity .6; scale .94
highlight(i: number, color: string, ms = 800): void {   // reduced-motion 정적 표식: 클래스 토글 1회, 애니메이션 없음
  const g = this.groups[i]; if (!g) return; g.style.setProperty('--fx-hl', color); g.classList.add('fx-hl');
  gridTimeout(() => g.classList.remove('fx-hl'), ms);
}
```
  `transform-box: fill-box; transform-origin: center`가 SVG 그룹에 필요(기존 `pulseSpace` 규칙과 동일하게).

## 4. `src/ui/panels/PlayerPanel.ts`

- [ ] **`clientRect()`** (엔진 `getPanelRect`) — `clientCenter()` 옆에:

```ts
clientRect(): DOMRect { return this.el.getBoundingClientRect(); }
```
- [ ] `bump()`/`float(delta, caption)`는 이미 있음 → 엔진 `dom.panelBump`/`dom.floatText`로 연결(§5).

## 5. `src/ui/game/view.ts` — 엔진 생성·수명

- [ ] 필드 `readonly vfx: FxHandle;` 와 스포트라이트 요소. `this.fx` 생성 직후:

```ts
import { createFx, type FxHandle } from '@/ui/fx/vfx';
import { shakeAll } from '@/ui/fx/shake';        // §6
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { playerColor } from '@/content/palette';
import { isDevHook } from './util';

this.spot = h('div', { class: 'fx-spot' }); this.spot.hidden = true;
this.fx.append(this.spot);                      // 캔버스보다 먼저(아래) — 캔버스는 첫 play()에 append됨
this.vfx = createFx({
  layer: this.fx,
  getLayerRect: () => this.fx.getBoundingClientRect(),
  getBoardRect: () => this.board.el.getBoundingClientRect(),
  getSpaceRect: (i) => this.board.spaceRect(i),
  getPanelRect: (id) => this.panels.get(id)?.clientRect() ?? null,
  getSeat: (id) => this.state.players[id]!.seat,
  getStageRect: () => this.stage.el.getBoundingClientRect(),
  getPlayerColor: (id) => playerColor(this.state.players[id]!.colorId).hex,
  sfx: (name, o) => sfx.play(name, o),
  haptic: (k) => haptic(k),
  shake: (px, ms) => void shakeAll([this.table, this.fx], px, ms),
  highlight: (t, ms) => this.staticHighlight(t, ms),
  dom: {
    pop: (i, o) => this.board.popIcon(i, o),
    zoomPunch: (i, k) => this.board.zoomPunch(i, k),
    dim: (i, on) => this.board.dimIcon(i, on),
    closeUp: (i, pid, level, phase) => this.stage.closeUp(i, pid, level, phase),   // §7
    spotlight: (on) => this.spotlight(on),
    floatText: (pid, text) => this.panels.get(pid)?.floatText(text),              // 또는 float(delta) 재사용
    panelBump: (pid) => void this.panels.get(pid)?.bump(),
  },
  retainBacking: true,            // §13.3
  dev: isDevHook(),
});
```
  `getSeat`/`getPlayerColor`는 `this.state`가 아니라 **현재 렌더 상태**를 봐야 하면 `render(state)`에서 갱신되는 필드를 사용.
  `spotlight(on)`: `spot.hidden=false` 후 `anim(spot, [{opacity:0},{opacity:1}], {duration: 200})`(끌 때 267 ms 역방향 후 `hidden=true`).
  `staticHighlight(t, ms)`: `{space}` → `board.highlight(i, 색)`, `{spaces}` → 각각, `{panel}` → 패널에 `.fx-hl` 토글, `{stage}` → 무시(스탬프가 전달).

- [ ] **수명**: `applyLayout()` 시작부(리사이즈/회전)에서 `this.vfx.stopAll()`; `dispose()`에서 `this.vfx.dispose()`.
- [ ] 게임 마운트 후 유휴 시점에 아틀라스 미리 로드(부팅 게이트 무관): `Game.ts`에서 `view.mount(root)` 다음
  `gridTimeout(() => void view.vfx.preload(), 600)`. (미리 로드하지 않아도 첫 `play()`가 로드를 기다린 뒤 시작한다.)
- [ ] `particles` 필드는 §9 이관 완료까지 유지.

## 6. `src/ui/fx/shake.ts` — 다중 요소 쉐이크

캔버스가 `.table` 밖(`.fx-layer`)이라 `.table`만 흔들면 칸과 파티클이 어긋난다(VFX.md §3.1).

- [ ] 추가(기존 `shake(el, strength)`는 유지):

```ts
/** Same decaying shake on several elements (table + fx layer), amplitude px, duration ms (VFX.md §6.1). */
export function shakeAll(els: readonly HTMLElement[], px: number, ms: number): Promise<void> {
  const a = px;
  const kf: Keyframe[] = [
    { transform: 'translate(0,0)' },
    { transform: `translate(${-a}px, ${a * 0.4}px)`, offset: 0.12 },
    { transform: `translate(${a * 0.8}px, ${-a * 0.3}px)`, offset: 0.28 },
    { transform: `translate(${-a * 0.5}px, ${-a * 0.3}px)`, offset: 0.46 },
    { transform: `translate(${a * 0.3}px, ${a * 0.2}px)`, offset: 0.64 },
    { transform: `translate(${-a * 0.12}px, 0)`, offset: 0.82 },
    { transform: 'translate(0,0)' },
  ];
  return Promise.all(els.map((el) => anim(el, kf, { duration: ms, easing: 'ease-out' }))).then(() => {});
}
```
  `.fx-layer`는 이미 `position:absolute; inset:0` — transform 애니메이션은 합성기 전용(리페인트 0). 기존 `shake(view.table, …)` 호출은
  프리셋이 쉐이크를 포함하므로 해당 케이스에서 제거(§8 표).

## 7. `src/ui/stage/Stage.ts` — 클로즈업 카드 `.fx-closeup` (VFX.md §7.2b.10)

- [ ] Stage가 소유(좌석 회전 상속). 요소 1개, 이벤트 중에만 존재, `transform/opacity`만:

```ts
closeUp(space: number, pid: PlayerId, level: number, phase: 'in' | 'pop' | 'out'): void {
  if (phase === 'in') {
    this.cu?.remove();
    const p = /* 현재 상태의 플레이어 */;
    this.cu = h('div', { class: 'fx-closeup' }, iconEl(buildingIcon(level - 1), 'ico'));   // 글자 없음, 이전 레벨 아이콘
    this.cu.style.setProperty('--pc', playerColor(p.colorId).hex);
    this.el.querySelector('.stage-rot')!.append(this.cu);
    void anim(this.cu, [{ opacity: 0, transform: 'translateY(8%) scale(.7)' }, { opacity: 1, transform: 'none' }],
              { duration: 133, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  } else if (phase === 'pop' && this.cu) {
    this.cu.replaceChildren(iconEl(buildingIcon(level), 'ico'));                   // swap 프레임에 같은 popBack으로 팝
    void anim(this.cu.firstElementChild!, [{ transform: 'scale(.5)' }, { transform: 'scale(1)' }],
              { duration: 333, easing: 'cubic-bezier(.3,1.9,.5,1)' });
  } else if (this.cu) {
    const el = this.cu; this.cu = null;
    void anim(el, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.92)' }], { duration: 267 }).then(() => el.remove());
  }
}
```
- [ ] 좌표 헬퍼 2개(§8 표에서 사용): `Stage.cardClientCenter(): {x,y}`(카드/프롬프트 슬롯 중심, 무료 업그레이드 혜성·카드 반짝 시작점),
  `Dice.clientCenters(): {x,y}[]`(착지한 두 주사위 중심 — `diceLand`). 둘 다 `getBoundingClientRect()` 1회, 이벤트 시에만 호출.
- [ ] `clearPrompt()`/`dispose()`/스킵 시 `this.cu?.remove()` (스킵은 엔진이 cue를 즉시 발화 → `out`은 ×5로 빨리 옴; 즉시 제거하려면
  컨트롤러 스킵 핸들러에서 `stage.dropCloseUp()` 호출).

## 8. `src/ui/fx/animate.ts` — 이벤트 → 프리셋 매핑

원칙:
1. **상태 변경을 cue 프레임으로 미룬다**(VFX.md §7.2b.12-2): `Built`/`PropertyBought`/`TakenOver`는 현재 `vs` 변경 + `render()`를
   먼저 한다 → 새 흐름에서는 `h.cue('swap' | 'frame')`를 기다린 **다음** 변경·`render()`. `fast`(instant)·reduced-motion에서는 cue가
   즉시 resolve되므로 코드 경로가 하나로 유지된다.
2. `play()`는 **DOM 변경 다음 프레임에** 시작(PERFORMANCE.md §7): 엔진의 첫 틱이 다음 격자 프레임이므로 추가 조치 불필요.
3. 프리셋의 SFX/햅틱과 기존 호출이 겹치지 않게 "제거" 열을 지운다. Stage 스탬프/토스트(문구, ↻)는 유지 — 캔버스엔 글자가 없다.
4. `satisfies Record<GameEventType, …>` 형태의 매핑 표를 두어 새 엔진 이벤트가 생기면 컴파일 에러가 나게 한다(VFX.md §8.4).

- [ ] 헬퍼:

```ts
const fx = view.vfx;
const priceOf = (i: number) => BOARD[i]!.price ?? 0;
/** 파생 GroupCompleted: 방금 소유가 바뀐 칸으로 그룹이 완성됐는지 (엔진 변경 없음). */
function completedGroup(vs: GameState, pid: PlayerId, i: number): { spaces: number[]; color: string } | null {
  const g = groupOf(i); if (!g || !ownsGroup(vs, pid, g)) return null;
  return { spaces: [...citiesInGroup(g)], color: GROUP_COLORS[g] };
}
```

- [ ] 매핑 표 (모든 `GameEvent`):

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

- [ ] `Built` 분기 예시(정본):

```ts
case 'Built': {
  if (fast) { vs.properties[ev.spaceIndex]!.level = ev.level; render(view, vs); return; }
  const group = ev.level === 4 ? completedGroupAfterBuild(vs, ev) : undefined;
  const h = ev.level === 4 && !ev.free
    ? fx.play('landmarkReveal', { space: ev.spaceIndex, player: ev.playerId, ...(group ? { group } : {}) })
    : fx.play('buildSeq', { space: ev.spaceIndex, player: ev.playerId, level: ev.level as 1 | 2 | 3 | 4, free: ev.free,
                             from: stage.cardClientCenter?.() });
  if (ev.level === 4) void h.cue('stamp').then(() => stage.stamp(t('g.landmark.done'), 'gold'));
  await h.cue('swap');
  vs.properties[ev.spaceIndex]!.level = ev.level;
  render(view, vs);
  await h;
  return;
}
```

## 9. 구 파티클 이관

- [ ] `particles.coinShower/coinArc/confetti` 호출을 위 표대로 프리셋으로 바꾼 뒤 `src/ui/fx/particles.ts`, `view.particles`, `game.css`의
  `.pt-canvas` 제거. (이관 중에는 두 경로가 공존해도 레이어 예산: 구 캔버스 1 + FX 캔버스 1.)

## 10. 스킵·속도

- [ ] `src/ui/game/controller.ts`의 탭 스킵 핸들러:

```ts
if (this.busy) { skip(); this.view.vfx.skip(); this.view.stage.hurry(); }
```
  (엔진은 `isSkipping()`도 매 틱 확인하므로 `skip()`만으로 ×5는 되지만, **cue 즉시 발화**는 `vfx.skip()`이 확실히 한다.)
- [ ] `animSpeed()`는 엔진이 매 틱 반영, `setAnimSpeed(0)`(테스트)은 캔버스를 만들지 않음 — 추가 작업 없음.

## 11. 화면 이탈·가시성

- [ ] `src/ui/screens/Game.ts` 언마운트(`view.dispose(); flushAll();`) — `view.dispose()`가 `vfx.dispose()`를 호출하므로 추가 없음.
- [ ] 엔진이 `visibilitychange: hidden`에서 `stopAll()`을 스스로 한다.

## 12. dev 훅

- [ ] `createFx({ dev: isDevHook() })`가 `window.__fx`(`stats/play/skip/stopAll/resetStats`)를 등록한다.
- [ ] `src/ui/game/devhook.ts`의 `LotAndRollHook`에 `fx(): FxStats | null`(= `current?.view.vfx.stats()`)와 `playFx(name, params)` 추가 —
  e2e/perf가 `window.__lotAndRoll.fx()`로 `live/peak/canvas/ticking`을 읽는다(VFX.md §10.2).

## 13. 성능 게이트 — `scripts/perf.mjs`에 `fx` 페이즈 (VFX.md §10.3 F1–F10)

`node scripts/perf.mjs --phases fx` (사전 `npx vite build`). 4× 스로틀, DPR 2, 1600×1000. 시나리오: `loadState`로 만든 상태에서
통행료 XL → 인수 → 명소+독점 → 파산 → GameOver hubs를 `dispatch`로 재생(또는 dev 훅 `playFx`로 직접 재생).

```js
// 의사 코드 — 기존 perf.mjs 헬퍼(trace/layerTree/rafIntervals) 재사용
async function phaseFx(page) {
  await page.evaluate(() => window.__lotAndRoll.setAnimSpeed(1));
  const peakLive = [];
  const layerWatch = await startLayerTree(page);                 // 기존 C 게이트 방식
  const trace = await startTrace(page, ['devtools.timeline']);
  await runFxScenario(page);                                     // 5개 이벤트 순차 재생
  const poll = setInterval(async () => peakLive.push((await page.evaluate(() => window.__lotAndRoll.fx()))?.live ?? 0), 100);
  await page.waitForFunction(() => !window.__lotAndRoll.fx().ticking, null, { timeout: 20000 });
  clearInterval(poll);
  const fxWindow = await stopTrace(trace);
  await page.waitForTimeout(500);
  const idle = await measureIdle(page, 10_000);                  // 기존 B 게이트
  const st = await page.evaluate(() => window.__lotAndRoll.fx());
  gate('F1 FX 유휴 복귀', idle.layout + idle.paint + idle.raster + idle.raf + idle.timer + idle.layerPainted === 0
       && st.canvas?.hidden !== false && !st.ticking && await page.evaluate(() => window.__lotAndRoll.activeTicks?.() ?? 0) === 0);
  gate('F2 라이브 파티클 ≤ 300', Math.max(...peakLive, st.peak) <= 300);
  gate('F3 레이어 피크 ≤ 20 · 메모리 ≤ 100 MB', layerWatch.peak <= 20 && layerWatch.peakMB <= 100);
  gate('F4 표시 fps ≤ 34 · 고유 ≥ 24', fxWindow.drawFps <= 34 && fxWindow.uniqueFps >= 24);
  gate('F5 rAF 간격 p95 ≤ 33 ms', fxWindow.rafP95 <= 33.4);
  gate('F6 TaskDuration ≤ 150 ms/s', fxWindow.taskMsPerSec <= 150);
  // F7: 시나리오 20회 반복 후 JS 힙 +≤5 MB, DOM 노드 +0, document.querySelectorAll('canvas.fx-canvas').length ≤ 1
  // F8: public/fx 합계 ≤ 500 KB (정적, manifest.test.ts가 이미 검사 — 여기서는 fs.stat 재확인)
  // F9: 기존 boot 페이즈 재사용 (Title ≤ 1.5 s)
  // F10: victory 재생 중 skip → 500 ms 안에 ticking=false
  gate('F10 스킵 ≤ 500 ms', await skipFinaleMs(page) <= 500);
}
```
  - F1은 `retainBacking: true`여도 통과해야 한다: 유휴 시 캔버스는 `hidden`(display:none → 레이어/페인트 0), onFrame·타이머 0.
    (백킹 해제 여부는 `stats().canvas.backingW`로 따로 보고만 한다.)
  - `activeFrameTicks()`는 dev 훅에 `activeTicks: () => activeFrameTicks()`로 노출 필요.

## 14. e2e (제안: `e2e/vfx.spec.ts`)

- 이벤트별(`loadState` + `dispatch`) 재생 → 콘솔 에러 0, `fx().peak ≤ 300`, 종료 후 `fx().canvas.hidden && !fx().ticking`.
- `page.emulateMedia({ reducedMotion: 'reduce' })` → `document.querySelector('canvas.fx-canvas')`가 생기지 않음 + `.fx-hl` 토글 관찰.
- 스킵: GameOver 중 테이블 탭 → 500 ms 안에 `!fx().ticking`.
- 결정적 스크린샷은 데모 페이지(`vfx-demo.html`, 수동 클럭) 기준: `node scripts/fx/vfx-strips.mjs <시나리오>`와 같은 방식
  (`__vfxDemo.manual(true); run(name); step(n)`), `toHaveScreenshot` 영역 클립.

## 15. 연동 후 확인 목록

- [ ] `npm run typecheck && npm test && npm run build`
- [ ] `node scripts/fx/vfx-perf.mjs --retain` (엔진 비용 회귀), `node scripts/perf.mjs --phases fx,idle,layers`
- [ ] 4좌석 각각에서 L4/인수 중 스크린샷: 캔버스에 글자 없음, 망치·경광등·왕관만 행위자 좌석으로 회전
- [ ] 저사양 실기기 A/B: `retainBacking`, `setQuality('low')`(파티클 ×0.5, 백킹 ≤1.0), `softwareCanvas` on/off (VFX.md §10.4)

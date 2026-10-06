/**
 * Prompt cards shown on the Stage for each `state.phase` (and the space info popover).
 * Every card faces the acting player (the Stage is rotated). For CPU players the same card is
 * shown read-only ("thinking…") so the table can follow what the CPU is deciding.
 */
import {
  BUILDING_LEVEL_IDS,
  BUILDING_LEVEL_NAMES,
  GROUP_NAMES,
  type GroupId,
} from '@/content/board';
import {
  citiesInGroup,
  citiesOnSide,
  completedGroups,
  ECONOMY,
  defaultAction,
  getBoardInfo,
  hubCount,
  legalActions,
  propertyValue,
  ruleFlags,
  saleOptions,
  sameAction,
  swapGive,
  tollAtLevel,
  tollOf,
  type Action,
  type GameState,
  type Phase,
  type PlayerId,
} from '@/engine';
import { getCard } from '@/content/cards';
import { playerColor } from '@/content/palette';
import { loc, t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { onFrame } from '@/ui/fx/time';
import type { Board } from '@/ui/board/Board';
import { cardIcon, chip, groupColor, h, iconEl, money, setPlayerVars, spaceIcon, svgNode, TINT, tokenBadge, type ChipTone } from '@/ui/game/util';
import type { Dice } from './Dice';
import type { Stage } from './Stage';
import { releaseVelocity } from './throw';

export interface PromptCtx {
  state: GameState;
  /** CPU is deciding: render read-only. */
  cpu: boolean;
  act: (a: Action) => void;
  board: Board;
  dice: Dice;
  /** The roll pad and the stage frame (pointer → stage px). */
  stage: Stage;
  /** Settings "굴리기 버튼 보이기": the roll button is shown beside the pad. */
  rollButton: boolean;
}

export interface PromptResult {
  el: HTMLElement;
  big?: boolean;
  /** Space the prompt is about (board focus). */
  focus?: number;
}

type BtnOpts = { primary?: boolean; disabled?: boolean; icon?: string; sub?: string; tone?: 'danger' | 'gold' };

function button(label: string, ctx: PromptCtx, action: Action | null, o: BtnOpts = {}): HTMLButtonElement {
  const b = h('button', {
    class: `pbtn${o.primary ? ' is-primary' : ''}${o.tone ? ` tone-${o.tone}` : ''}`,
    type: 'button',
    // Stable hooks for tests / accessibility tooling (labels are localized).
    'data-action': action?.type,
    'data-space': action && 'spaceIndex' in action ? action.spaceIndex : undefined,
    'data-card': action && 'cardId' in action ? action.cardId : undefined,
    'data-guess': action && 'guess' in action ? action.guess : undefined,
  });
  if (o.icon) b.append(iconEl(o.icon, 'ico pbtn-ico'));
  b.append(h('span', { class: 'pbtn-label', text: label }));
  if (o.sub) b.append(h('span', { class: 'pbtn-sub', text: o.sub }));
  const disabled = !!o.disabled || ctx.cpu || !action || !legalActions(ctx.state).some((a) => sameAction(a, action));
  if (disabled) b.disabled = true;
  if (!disabled && action) {
    b.addEventListener('click', () => {
      sfx.play('tap');
      haptic('light');
      ctx.act(action);
    });
  }
  return b;
}

function card(
  cls: string,
  parts: {
    kicker?: string;
    title?: string;
    icon?: string;
    accent?: string | null;
    body?: Array<Node | null | false>;
    buttons?: Array<Node | null | false>;
  },
  ctx: PromptCtx,
): HTMLElement {
  const el = h('div', { class: `pcard ${cls}${ctx.cpu ? ' is-cpu' : ''}` });
  if (parts.accent) el.style.setProperty('--accent', parts.accent);
  const head = h('div', { class: 'pc-head' });
  if (parts.icon) head.append(iconEl(parts.icon, 'ico pc-icon'));
  const titles = h('div', { class: 'pc-titles' });
  if (parts.kicker) titles.append(h('div', { class: 'pc-kicker', text: parts.kicker }));
  if (parts.title) titles.append(h('div', { class: 'pc-title', text: parts.title }));
  head.append(titles);
  el.append(head);
  const body = h('div', { class: 'pc-body' });
  for (const n of parts.body ?? []) if (n) body.append(n);
  if (body.childNodes.length) el.append(body);
  if (parts.buttons?.length) {
    const row = h('div', { class: 'pc-buttons' });
    for (const n of parts.buttons) if (n) row.append(n);
    el.append(row);
  }
  if (ctx.cpu) el.append(h('div', { class: 'pc-cpu', text: t('g.cpu.thinking') }));
  return el;
}

function kv(label: string, value: string, cls = ''): HTMLElement {
  return h('div', { class: `pc-kv ${cls}` }, h('span', { class: 'k', text: label }), h('b', { class: 'v', text: value }));
}

function tag(text: string, tone: ChipTone = 'info', icon?: string): HTMLElement {
  return chip({ text, tone, icon });
}

/** `tint` = the text color the building is shown in (stage.css: ladder --ink, lp-cell --ink-3 / --ink). */
function levelIcon(level: number, color: string | null, tint = TINT.ink): HTMLElement {
  if (level === 0) {
    const sq = h('span', { class: 'lvl-land' });
    if (color) sq.style.background = color;
    return sq;
  }
  return iconEl(BUILDING_LEVEL_IDS[level]!, 'ico lvl-ico', tint);
}

function levelName(level: number): string {
  return loc(BUILDING_LEVEL_NAMES[BUILDING_LEVEL_IDS[level]!]);
}

/** Toll by level for a city, current level highlighted. */
const boardOf = (state: GameState) => getBoardInfo(state.settings.spacesPerSide ?? 7);

function tollLadder(state: GameState, i: number, owner: PlayerId, current: number | null, next: number | null): HTMLElement {
  const sp = boardOf(state).board[i]!;
  const row = h('div', { class: 'ladder', 'aria-label': t('g.ladder') });
  row.append(h('div', { class: 'ladder-h', text: t('g.ladder') }));
  for (let l = 0; l <= 4; l++) {
    const cell = h(
      'div',
      { class: `ld${l === current ? ' is-cur' : ''}${l === next ? ' is-next' : ''}` },
      levelIcon(l, groupColor(sp)),
      h('b', { text: tollAtLevel(state, i, l, owner).toLocaleString() }),
    );
    row.append(cell);
  }
  return row;
}

/** Group members as chips, tinted by owner. */
function groupChips(state: GameState, group: GroupId, focus: number): HTMLElement {
  const row = h('div', { class: 'gtiles' });
  for (const i of citiesInGroup(group, state.settings.spacesPerSide ?? 7)) {
    const owner = state.properties[i]?.owner ?? null;
    const chip = h('span', { class: `gtile${i === focus ? ' is-focus' : ''}${owner !== null ? ' is-owned' : ''}` });
    chip.append(iconEl(spaceIcon(boardOf(state).board[i]!), 'ico gtile-ico'));
    if (owner !== null) setPlayerVars(chip, state.players[owner]!.colorId);
    row.append(chip);
  }
  return row;
}

function spaceTitle(state: GameState, i: number): string {
  return loc(boardOf(state).board[i]!.name);
}

// ---------------------------------------------------------------------------
// Phase prompts
// ---------------------------------------------------------------------------

const GAUGE_PERIOD_MS = 1600;
const GAUGE_MIN_MS = 300;

/**
 * The roll: the stage centre is a pad (Stage.armPad, docs/DESIGN.md "Dice throw"). Press and hold
 * anywhere on it: the dice shake (rattle + haptic, and the B7 gauge swings while held); release
 * with a swipe: the dice are thrown in that direction (the release velocity over the last 80 ms,
 * in the stage's frame); release without one, or the keyboard (Enter / Space on the focused pad):
 * a weak toss forward. Leaving the pad before the release still throws (pointer capture); a
 * cancelled pointer only stops the shake. The throw never changes the result: the same `Roll`
 * (+ gauge) is dispatched and the engine's RNG decides. The roll button (Settings "굴리기 버튼
 * 보이기", off by default) works as before beside it.
 */
function rollPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'preRoll' }>): PromptResult {
  const p = ctx.state.players[ph.playerId]!;
  const pad = ctx.stage.armPad(ctx.cpu);
  let rollBtn: HTMLButtonElement | null = null;
  if (ctx.rollButton) {
    rollBtn = h('button', { class: 'roll-btn', type: 'button', 'data-action': 'Roll' }) as HTMLButtonElement;
    rollBtn.append(iconEl('dice-face-5', 'ico roll-ico'), h('span', { class: 'roll-label', text: t('g.roll') }));
  }
  const roll: Action = { type: 'Roll', playerId: ph.playerId };
  // Dice gauge (rules = advanced): while held, a gauge swings low ↔ high (slow at the ends);
  // releasing after GAUGE_MIN_MS sends where it was. A quick tap or the keyboard rolls neutral.
  const gaugeOn = ruleFlags(ctx.state.settings).diceGauge && !ctx.cpu;
  const fill = h('i', { class: 'rg-fill' });
  const gaugeEl = gaugeOn
    ? h('div', { class: 'roll-gauge', 'aria-hidden': 'true' }, h('span', { class: 'rg-end', text: t('g.gauge.low') }), h('div', { class: 'rg-track' }, fill), h('span', { class: 'rg-end', text: t('g.gauge.high') }))
    : null;
  let gauge: number | undefined;
  let stopGauge: (() => void) | null = null;
  if (ctx.cpu) {
    if (rollBtn) rollBtn.disabled = true;
  } else {
    // One press at a time (pad or button); its control and its pointer samples [x, y, t].
    let active: HTMLElement | null = null;
    let fired = false;
    let heldAt = 0;
    let samples: [number, number, number][] = [];
    const fire = (aim: { x: number; y: number } | null): void => {
      if (fired) return;
      fired = true;
      stopGauge?.();
      ctx.dice.shake(false);
      ctx.dice.aim(aim);
      ctx.act(gauge === undefined ? roll : { ...roll, gauge });
    };
    const bind = (el: HTMLElement, flick: boolean): void => {
      el.addEventListener('pointerdown', (e) => {
        if (fired || active) return;
        active = el;
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('is-held');
        samples = [[e.clientX, e.clientY, e.timeStamp]];
        ctx.dice.stopInvite();
        ctx.dice.shake(true);
        if (gaugeOn) {
          heldAt = performance.now();
          stopGauge = onFrame((now) => {
            const g = 0.5 + 0.5 * Math.sin(((now - heldAt) / GAUGE_PERIOD_MS) * 2 * Math.PI);
            gauge = now - heldAt >= GAUGE_MIN_MS ? g : undefined;
            fill.style.transform = `scaleX(${g.toFixed(3)})`;
            return true;
          });
        }
      });
      if (flick) {
        el.addEventListener('pointermove', (e) => {
          if (active !== el) return;
          samples.push([e.clientX, e.clientY, e.timeStamp]);
          if (samples.length > 48) samples.splice(0, samples.length - 48);
        });
      }
      el.addEventListener('pointerup', (e) => {
        if (active !== el) return;
        active = null;
        el.classList.remove('is-held');
        let aim: { x: number; y: number } | null = null;
        if (flick) {
          samples.push([e.clientX, e.clientY, e.timeStamp]);
          const v = releaseVelocity(samples);
          if (v.x || v.y) aim = ctx.stage.toLocal(v);
        }
        fire(aim);
      });
      el.addEventListener('pointercancel', () => {
        if (active !== el) return;
        active = null;
        el.classList.remove('is-held');
        stopGauge?.();
        stopGauge = null;
        gauge = undefined;
        ctx.dice.shake(false);
      });
      el.addEventListener('click', (e) => {
        if ((e as MouseEvent).detail === 0) fire(null); // keyboard: a weak toss
      });
    };
    bind(pad, true);
    if (rollBtn) bind(rollBtn, false);
  }
  const tags = h('div', { class: 'pc-tags' });
  if (ph.rollAgain) tags.append(tag(t('g.doubles.again'), 'gold', 'dice-face-6'));
  if (p.expressPending) tags.append(tag(t('g.express'), 'gold', 'hub-rail'));
  const build = legalActions(ctx.state).filter((a) => a.type === 'Build');
  if (build.length && !ctx.cpu) {
    tags.append(tag(t('g.buildAnywhere.hint'), 'info', 'villa'));
    ctx.board.setPicking(
      build.map((a) => (a as Extract<Action, { type: 'Build' }>).spaceIndex),
      (i) => ctx.act({ type: 'Build', playerId: ph.playerId, spaceIndex: i }),
    );
  }
  const el = h('div', { class: `pcard pc-roll${ctx.cpu ? ' is-cpu' : ''}${rollBtn ? ' has-button' : ''}` });
  if (tags.childNodes.length) el.append(tags);
  if (rollBtn) el.append(rollBtn);
  if (gaugeEl) el.append(gaugeEl);
  if (!ctx.cpu) {
    // Where the button was: a hint strip (the button, when shown, keeps its own hint).
    const text = rollBtn ? t(gaugeOn ? 'g.gauge.hint' : 'g.roll.hold') : t('g.roll.flick');
    const hint = h('div', { class: `roll-hint is-blink${rollBtn ? '' : ' is-strip'}`, text });
    el.append(hint);
    if (!rollBtn && gaugeOn) el.append(h('div', { class: 'roll-hint', text: t('g.gauge.hint') }));
    // "Throw me": the dice wobble (with a rattle) and the hint blinks when the human's roll comes up.
    ctx.dice.invite(hint);
  }
  return { el };
}

function islandPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'island' }>): PromptResult {
  const pid = ph.playerId;
  const pips = h('div', { class: 'isl-pips' });
  for (let k = 3; k >= 1; k--) pips.append(h('span', { class: `pip${k <= ph.turnsLeft ? ' is-on' : ''}` }));
  return {
    el: card(
      'pc-island',
      {
        icon: 'corner-island',
        kicker: t('g.island.kicker'),
        title: t('g.island.turns', { n: ph.turnsLeft }),
        body: [pips, h('div', { class: 'pc-note', text: t('g.island.help') })],
        buttons: [
          button(t('g.island.roll'), ctx, { type: 'Roll', playerId: pid }, { primary: true, icon: 'dice-face-6' }),
          button(t('g.island.bail'), ctx, { type: 'PayBail', playerId: pid }, { disabled: !ph.canPayBail, sub: money(ph.bail) }),
          ph.hasEscapeCard ? button(t('g.island.card'), ctx, { type: 'UseEscapeCard', playerId: pid }, { icon: 'cards-escape', tone: 'gold' }) : null,
        ],
      },
      ctx,
    ),
  };
}

function victoryHint(state: GameState, pid: PlayerId, i: number): HTMLElement | null {
  const sp = boardOf(state).board[i]!;
  const owns = (j: number): boolean => j === i || state.properties[j]?.owner === pid;
  if (sp.kind === 'hub') {
    if (boardOf(state).hubIndices.every(owns)) return tag(t('g.hint.hubWin'), 'gold', 'trophy');
    return null;
  }
  const size = state.settings.spacesPerSide ?? 7;
  if (sp.side && citiesOnSide(sp.side, size).every(owns)) return tag(t('g.hint.lineWin'), 'gold', 'trophy');
  if (sp.group && citiesInGroup(sp.group, size).every(owns)) {
    if (completedGroups(state, pid).length >= 2) return tag(t('g.hint.tripleWin'), 'gold', 'trophy');
    return tag(t('g.hint.complete'), 'gold', 'check');
  }
  if (sp.group && citiesInGroup(sp.group, size).filter((j) => !owns(j)).length === 1) return tag(t('g.hint.oneAway'), 'info');
  return null;
}

function buyPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'buy' }>): PromptResult {
  const { state } = ctx;
  const i = ph.spaceIndex;
  const sp = boardOf(state).board[i]!;
  const p = state.players[ph.playerId]!;
  const body: Array<Node | null> = [];
  if (sp.kind === 'city' && sp.group) {
    body.push(
      h(
        'div',
        { class: 'pc-row' },
        h('span', { class: 'grp-dot' }),
        h('span', { class: 'pc-sub', text: t('g.group', { name: loc(GROUP_NAMES[sp.group]) }) }),
        groupChips(state, sp.group, i),
      ),
    );
    body.push(tollLadder(state, i, ph.playerId, 0, null));
  } else {
    const n = hubCount(state, ph.playerId) + 1;
    body.push(kv(t('g.hub.toll', { n }), money(100 * n)));
  }
  const hint = victoryHint(state, ph.playerId, i);
  const tags = h('div', { class: 'pc-tags' }, hint);
  if (p.cash < ph.price) tags.append(tag(t('g.buy.cant'), 'bad'));
  body.push(tags);
  const el = card(
    'pc-buy',
    {
      icon: spaceIcon(sp),
      accent: groupColor(sp),
      kicker: t('g.buy.kicker'),
      title: spaceTitle(state, i),
      body,
      buttons: [
        button(t('g.buy'), ctx, { type: 'Buy', playerId: ph.playerId }, { primary: true, sub: money(ph.price), disabled: p.cash < ph.price }),
        button(t('g.pass'), ctx, { type: 'Pass', playerId: ph.playerId }),
      ],
    },
    ctx,
  );
  return { el, focus: i };
}

function buildPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'build' }>): PromptResult {
  const { state } = ctx;
  const i = ph.spaceIndex;
  const sp = boardOf(state).board[i]!;
  const from = state.properties[i]!.level;
  const to = ph.toLevel;
  const fest = state.festival === i ? 2 : 1;
  const now = tollOf(state, i);
  const next = tollAtLevel(state, i, to, ph.playerId) * fest;
  const preview = h(
    'div',
    { class: 'lvl-preview' },
    h('div', { class: 'lp-cell' }, levelIcon(from, groupColor(sp), TINT.ink3), h('span', { text: levelName(from) })),
    h('span', { class: 'lp-arrow' }, svgNode('chevron-right')),
    h('div', { class: 'lp-cell is-next' }, levelIcon(to, groupColor(sp)), h('span', { text: levelName(to) })),
  );
  const el = card(
    'pc-build',
    {
      icon: spaceIcon(sp),
      accent: groupColor(sp),
      kicker: to === 4 ? t('g.build.kickerLandmark') : t('g.build.kicker'),
      title: spaceTitle(state, i),
      body: [
        preview,
        h('div', { class: 'pc-kvs' }, kv(t('g.toll'), `${money(now)} → ${money(next)}`, 'is-strong')),
        state.players[ph.playerId]!.cash < ph.cost ? tag(t('g.buy.cant'), 'bad') : null,
      ],
      buttons: [
        button(to === 4 ? t('g.build.landmark') : t('g.build'), ctx, { type: 'Build', playerId: ph.playerId, spaceIndex: i }, { primary: true, sub: money(ph.cost) }),
        button(t('g.pass'), ctx, { type: 'Pass', playerId: ph.playerId }),
      ],
    },
    ctx,
  );
  return { el, focus: i };
}

function takeoverPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'takeover' }>): PromptResult {
  const { state } = ctx;
  const i = ph.spaceIndex;
  const sp = boardOf(state).board[i]!;
  const owner = state.players[ph.ownerId]!;
  const body: Array<Node | null> = [
    h('div', { class: 'pc-row' }, tokenBadge(owner, 'tok-badge pc-owner-tok'), h('span', { class: 'pc-sub', text: t('g.takeover.owner', { name: owner.name }) })),
    h('div', { class: 'pc-kvs' }, kv(t('g.value'), money(propertyValue(state, i))), kv(t('g.toll'), money(tollOf(state, i)))),
  ];
  if (ph.winBack) body.push(tag(t('g.takeover.winBack'), 'gold', 'restart'));
  if (ph.ownerHasShield) body.push(tag(t('g.takeover.shield'), 'bad', 'cards-shield'));
  const hint = victoryHint(state, ph.playerId, i);
  if (hint) body.push(hint);
  return {
    el: card(
      'pc-takeover',
      {
        icon: spaceIcon(sp),
        accent: playerColor(owner.colorId).hex,
        kicker: ph.winBack ? t('g.takeover.winBackKicker') : t('g.takeover.kicker'),
        title: spaceTitle(state, i),
        body,
        buttons: [
          button(t('g.takeover'), ctx, { type: 'Takeover', playerId: ph.playerId }, { primary: true, sub: money(ph.price), tone: 'danger' }),
          button(t('g.pass'), ctx, { type: 'Pass', playerId: ph.playerId }),
        ],
      },
      ctx,
    ),
    focus: i,
  };
}

/** Double-up (rules = advanced): odd or even for what is on the line, or bank it. */
function doubleUpPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'doubleUp' }>): PromptResult {
  const guess = (g: 'high' | 'low'): Action => ({ type: 'DoubleUpGuess', playerId: ph.playerId, guess: g });
  // Odds shown on the buttons: a judgement call, not a coin flip (a tie loses).
  const odds = (n: number) => `${Math.round((n / 6) * 100)}%`;
  return {
    el: card(
      'pc-doubleup',
      {
        icon: `dice-face-${ph.shown}`,
        kicker: t('g.doubleUp.kicker'),
        title: t('g.doubleUp.title', { n: ph.shown }),
        body: [
          h('div', { class: 'pc-kvs' }, kv(t('g.doubleUp.stake'), money(ph.stake), 'is-strong'), kv(t('g.doubleUp.win'), money(ph.stake * 2))),
          h('div', { class: 'pc-note', text: t('g.doubleUp.round', { n: ph.wins + 1, max: ECONOMY.doubleUpMaxWins }) }),
        ],
        buttons: [
          // A guess that cannot win (6 → higher, 1 → lower) is shown but disabled.
          button(t('g.doubleUp.high'), ctx, guess('high'), { primary: true, tone: 'gold', sub: odds(6 - ph.shown), disabled: ph.shown === 6 }),
          button(t('g.doubleUp.low'), ctx, guess('low'), { primary: true, tone: 'gold', sub: odds(ph.shown - 1), disabled: ph.shown === 1 }),
          button(t('g.doubleUp.stop'), ctx, { type: 'Pass', playerId: ph.playerId }),
        ],
      },
      ctx,
    ),
  };
}

/** Card choice (rules ≥ normal): two event cards side by side; tap one. */
function cardChoicePrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'cardChoice' }>): PromptResult {
  // Rules version 2: a doubles bonus card, and the last player's comeback card (the first one).
  const tags = h('div', { class: 'pc-tags' });
  if (ph.bonus) tags.append(tag(t('g.cardPick.bonus'), 'gold', 'dice-face-6'));
  if (ph.underdog) tags.append(tag(t('g.cardPick.underdog'), 'gold', 'crown'));
  return {
    el: card(
      'pc-cardpick',
      {
        icon: 'space-event',
        kicker: ph.bonus ? t('g.bonusCard') : t('g.cardPick.kicker'),
        title: t('g.cardPick.title'),
        body: [tags.childNodes.length ? tags : null],
        buttons: ph.options.map((id, k) => {
          // Rules ≥ normal: the second card is face down — a known card or a gamble.
          if (k === 1 && ruleFlags(ctx.state.settings).hiddenCard) {
            return button(t('g.cardPick.hidden'), ctx, { type: 'ChooseCard', playerId: ph.playerId, cardId: id }, { icon: 'space-event', sub: t('g.cardPick.hiddenSub') });
          }
          const c = getCard(id);
          return button(loc(c.title), ctx, { type: 'ChooseCard', playerId: ph.playerId, cardId: id }, { icon: cardIcon(id), sub: loc(c.description) });
        }),
      },
      ctx,
    ),
  };
}

/** Manual keep-cards (rules ≥ normal): spend the Toll Pass, or (owner) raise the Guard Shield. */
function useCardPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'useCard' }>): PromptResult {
  const { state } = ctx;
  const use: Action = { type: 'UseCard', playerId: ph.playerId };
  const pass: Action = { type: 'Pass', playerId: ph.playerId };
  if (ph.card === 'toll-pass') {
    const toll = tollOf(state, ph.spaceIndex) * (ph.multiplier ?? 1);
    return {
      el: card(
        'pc-usecard',
        {
          icon: cardIcon('toll-pass'),
          kicker: t('g.usePass.kicker'),
          title: t('g.usePass.title'),
          body: [h('div', { class: 'pc-kvs' }, kv(t('g.toll'), money(toll), 'is-strong'))],
          buttons: [button(t('g.usePass.use'), ctx, use, { primary: true, tone: 'gold' }), button(t('g.usePass.pay'), ctx, pass, { sub: money(toll) })],
        },
        ctx,
      ),
      focus: ph.spaceIndex,
    };
  }
  const buyer = state.players[ph.buyerId!]!;
  return {
    el: card(
      'pc-usecard',
      {
        icon: cardIcon('shield'),
        accent: playerColor(buyer.colorId).hex,
        kicker: t('g.useShield.kicker'),
        title: t('g.useShield.title', { name: buyer.name }),
        body: [h('div', { class: 'pc-kvs' }, kv(t('g.value'), money(propertyValue(state, ph.spaceIndex))))],
        buttons: [button(t('g.useShield.use'), ctx, use, { primary: true, tone: 'gold' }), button(t('g.useShield.allow'), ctx, pass, { sub: money(ph.price ?? 0) })],
      },
      ctx,
    ),
    focus: ph.spaceIndex,
  };
}

/** All or nothing (rules version 2) at the tax office: pay the tax, or a die for it. */
function gamblePrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'gamble' }>): PromptResult {
  const pid = ph.playerId;
  const tax = boardOf(ctx.state).board.find((sp) => sp.kind === 'tax')!;
  return {
    el: card(
      'pc-gamble',
      {
        icon: 'space-tax',
        kicker: t('g.gamble.kicker'),
        title: t('g.gamble.title'),
        body: [
          h('div', { class: 'pc-kvs' }, kv(t('g.gamble.tax'), money(ph.tax), 'is-strong')),
          h('div', { class: 'pc-note', text: t('g.gamble.note', { amount: money(ph.tax * ECONOMY.gambleLoss) }) }),
        ],
        buttons: [
          button(t('g.gamble.roll'), ctx, { type: 'Gamble', playerId: pid }, { primary: true, tone: 'gold', icon: 'dice-face-4', sub: t('g.gamble.rollSub') }),
          button(t('g.gamble.pay'), ctx, { type: 'Pass', playerId: pid }, { sub: money(ph.tax) }),
        ],
      },
      ctx,
    ),
    focus: tax.index,
  };
}

function pickList(
  ctx: PromptCtx,
  options: readonly number[],
  make: (i: number) => Action,
  detail: (i: number) => string,
): HTMLElement {
  const list = h('div', { class: 'pick-list' });
  for (const i of options) {
    const sp = boardOf(ctx.state).board[i]!;
    const act = make(i);
    const row = h('button', { class: 'pick-row', type: 'button', 'data-action': act.type, 'data-space': i });
    row.style.setProperty('--gc', groupColor(sp) ?? '#CBD2DE');
    row.append(iconEl(spaceIcon(sp), 'ico pick-ico'), h('span', { class: 'pick-name', text: loc(sp.short) }), h('span', { class: 'pick-detail', text: detail(i) }));
    if (ctx.cpu) row.disabled = true;
    else
      row.addEventListener('click', () => {
        sfx.play('tap');
        ctx.act(act);
      });
    list.append(row);
  }
  if (!ctx.cpu) ctx.board.setPicking(options, (i) => ctx.act(make(i)));
  return list;
}

function festivalPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'festival' }>): PromptResult {
  const pid = ph.playerId;
  return {
    big: true,
    el: card(
      'pc-festival',
      {
        icon: 'corner-festival',
        kicker: t('g.festival.kicker'),
        title: t('g.festival.title'),
        body: [
          h('div', { class: 'pc-note', text: t('g.pick.hint') }),
          pickList(ctx, ph.options, (i) => ({ type: 'SetFestival', playerId: pid, spaceIndex: i }), (i) => `${money(tollOf(ctx.state, i))} → ×2`),
        ],
        buttons: [button(t('g.pass'), ctx, { type: 'Pass', playerId: pid })],
      },
      ctx,
    ),
  };
}

/** Targeting (rules ≥ normal): aim the typhoon at an opponent's city (list or board tap). */
function targetPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'target' }>): PromptResult {
  const pid = ph.playerId;
  const owner = (i: number) => ctx.state.players[ctx.state.properties[i]!.owner!]!;
  if (ph.card === 'swap') {
    // Land swap (rules version 2): the chosen city for our cheapest one; keeping ours is allowed.
    const give = swapGive(ctx.state, pid);
    return {
      big: true,
      el: card(
        'pc-target pc-swap',
        {
          icon: cardIcon('swap'),
          kicker: t('g.target.swap.kicker'),
          title: t('g.target.swap.title'),
          body: [
            give !== null ? tag(t('g.target.swap.give', { name: loc(boardOf(ctx.state).board[give]!.short) }), 'info', spaceIcon(boardOf(ctx.state).board[give]!)) : null,
            h('div', { class: 'pc-note', text: t('g.pick.hint') }),
            pickList(ctx, ph.options, (i) => ({ type: 'ChooseTarget', playerId: pid, spaceIndex: i }), (i) => `${owner(i).name} · ${money(propertyValue(ctx.state, i))}`),
          ],
          buttons: [button(t('g.pass'), ctx, { type: 'Pass', playerId: pid })],
        },
        ctx,
      ),
    };
  }
  return {
    big: true,
    el: card(
      'pc-target',
      {
        icon: cardIcon('typhoon'),
        kicker: t('g.target.kicker'),
        title: t('g.target.title'),
        body: [
          h('div', { class: 'pc-note', text: t('g.pick.hint') }),
          pickList(ctx, ph.options, (i) => ({ type: 'ChooseTarget', playerId: pid, spaceIndex: i }), (i) => `${owner(i).name} · ${money(tollOf(ctx.state, i))}`),
        ],
      },
      ctx,
    ),
  };
}

function upgradePrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'freeUpgrade' }>): PromptResult {
  const pid = ph.playerId;
  return {
    big: true,
    el: card(
      'pc-upgrade',
      {
        icon: 'building',
        kicker: t('g.upgrade.kicker'),
        title: t('g.upgrade.title'),
        body: [
          h('div', { class: 'pc-note', text: t('g.pick.hint') }),
          pickList(
            ctx,
            ph.options,
            (i) => ({ type: 'FreeUpgrade', playerId: pid, spaceIndex: i }),
            (i) => {
              const l = ctx.state.properties[i]!.level;
              return `${levelName(l)} → ${levelName(Math.min(4, l + 1))}`;
            },
          ),
        ],
        buttons: [button(t('g.pass'), ctx, { type: 'Pass', playerId: pid })],
      },
      ctx,
    ),
  };
}

function travelPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'travel' }>): PromptResult {
  const pid = ph.playerId;
  const grid = h('div', { class: 'travel-grid' });
  const go = (i: number): void => ctx.act({ type: 'ChooseTravel', playerId: pid, spaceIndex: i });
  for (const i of ph.options) {
    const sp = boardOf(ctx.state).board[i]!;
    const owner = ctx.state.properties[i]?.owner ?? null;
    const b = h('button', { class: `tg-cell${owner !== null ? ' is-owned' : ''}`, type: 'button', title: loc(sp.name), 'data-action': 'ChooseTravel', 'data-space': i });
    b.style.setProperty('--gc', groupColor(sp) ?? '#CBD2DE');
    if (owner !== null) setPlayerVars(b, ctx.state.players[owner]!.colorId);
    b.append(iconEl(spaceIcon(sp), 'ico tg-ico'), h('span', { class: 'tg-name', text: loc(sp.short) }));
    if (ctx.cpu) b.disabled = true;
    else
      b.addEventListener('click', () => {
        sfx.play('tap');
        go(i);
      });
    grid.append(b);
  }
  if (!ctx.cpu) ctx.board.setPicking(ph.options, go);
  return {
    big: true,
    el: card(
      'pc-travel',
      {
        icon: 'corner-tour',
        kicker: t('g.travel.kicker'),
        title: t('g.travel.title'),
        body: [h('div', { class: 'pc-note', text: t('g.pick.hintTravel') }), grid],
        buttons: [button(t('g.travel.pass'), ctx, { type: 'Pass', playerId: pid }, { icon: 'dice-face-3' })],
      },
      ctx,
    ),
  };
}

function debtPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'debt' }>): PromptResult {
  const { state } = ctx;
  const pid = ph.playerId;
  const p = state.players[pid]!;
  const best = defaultAction(state);
  const pct = Math.min(100, Math.round((p.cash / ph.amount) * 100));
  const meter = h(
    'div',
    { class: 'debt-meter' },
    h('div', { class: 'dm-bar' }, h('span', { class: 'dm-fill', style: `width:${pct}%` })),
    h('div', { class: 'dm-labels' }, h('span', { text: t('g.debt.have', { amount: money(p.cash) }) }), h('b', { text: t('g.debt.need', { amount: money(ph.amount) }) })),
  );
  const list = h('div', { class: 'pick-list debt-list' });
  const opts = saleOptions(state, pid).sort((a, b) => a.amount - b.amount);
  for (const o of opts) {
    const i = (o.action as Extract<Action, { type: 'SellProperty' }>).spaceIndex;
    const sp = boardOf(state).board[i]!;
    const lvl = state.properties[i]!.level;
    const isBest = !!best && sameAction(best, o.action);
    const what = o.action.type === 'SellBuilding' ? t('g.debt.building', { level: levelName(lvl) }) : t('g.debt.whole');
    const row = h('div', { class: `pick-row debt-row${isBest ? ' is-best' : ''}` });
    row.style.setProperty('--gc', groupColor(sp) ?? '#CBD2DE');
    row.append(
      iconEl(spaceIcon(sp), 'ico pick-ico'),
      h('span', { class: 'pick-name', text: loc(sp.short) }),
      h('span', { class: 'pick-detail', text: what }),
      button(t('g.debt.sell'), ctx, o.action, { sub: `+${o.amount.toLocaleString()}`, primary: isBest }),
    );
    list.append(row);
  }
  return {
    big: true,
    el: card(
      'pc-debt',
      {
        icon: 'pot',
        accent: '#E8564F',
        kicker: t('g.debt.kicker'),
        title: t('g.debt.title'),
        body: [meter, list],
      },
      ctx,
    ),
  };
}

function auctionPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'auction' }>): PromptResult {
  const { state } = ctx;
  const sp = boardOf(state).board[ph.spaceIndex]!;
  const high = ph.highBidderId !== null ? state.players[ph.highBidderId]! : null;
  return {
    el: card(
      'pc-auction',
      {
        icon: spaceIcon(sp),
        accent: groupColor(sp),
        kicker: t('g.auction.kicker'),
        title: loc(sp.name),
        body: [
          h(
            'div',
            { class: 'pc-row' },
            high ? tokenBadge(high, 'tok-badge pc-owner-tok') : null,
            h('span', { class: 'pc-sub', text: high ? t('g.auction.high', { amount: money(ph.highBid ?? 0), name: high.name }) : t('g.auction.none') }),
          ),
        ],
        buttons: [
          button(t('g.auction.bid'), ctx, { type: 'Bid', playerId: ph.playerId }, { primary: true, sub: money(ph.minBid) }),
          button(t('g.auction.pass'), ctx, { type: 'Pass', playerId: ph.playerId }),
        ],
      },
      ctx,
    ),
    focus: ph.spaceIndex,
  };
}

/** Build the prompt for the current phase (null when the game is over). */
export function buildPromptFor(ctx: PromptCtx): PromptResult | null {
  const ph = ctx.state.phase;
  switch (ph.kind) {
    case 'preRoll':
      return rollPrompt(ctx, ph);
    case 'island':
      return islandPrompt(ctx, ph);
    case 'travel':
      return travelPrompt(ctx, ph);
    case 'buy':
      return buyPrompt(ctx, ph);
    case 'build':
      return buildPrompt(ctx, ph);
    case 'takeover':
      return takeoverPrompt(ctx, ph);
    case 'festival':
      return festivalPrompt(ctx, ph);
    case 'freeUpgrade':
      return upgradePrompt(ctx, ph);
    case 'auction':
      return auctionPrompt(ctx, ph);
    case 'debt':
      return debtPrompt(ctx, ph);
    case 'cardChoice':
      return cardChoicePrompt(ctx, ph);
    case 'useCard':
      return useCardPrompt(ctx, ph);
    case 'doubleUp':
      return doubleUpPrompt(ctx, ph);
    case 'target':
      return targetPrompt(ctx, ph);
    case 'gamble':
      return gamblePrompt(ctx, ph);
    case 'gameOver':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Space info popover
// ---------------------------------------------------------------------------

export function spaceInfo(state: GameState, i: number): HTMLElement {
  const sp = boardOf(state).board[i]!;
  const el = h('div', { class: 'info-card', role: 'dialog', 'aria-label': loc(sp.name), tabindex: '-1' });
  const accent = groupColor(sp);
  if (accent) el.style.setProperty('--accent', accent);
  el.append(
    h(
      'div',
      { class: 'pc-head' },
      iconEl(spaceIcon(sp), 'ico pc-icon'),
      h(
        'div',
        { class: 'pc-titles' },
        h('div', { class: 'pc-kicker', text: sp.group ? loc(GROUP_NAMES[sp.group]) : t(`g.kind.${sp.kind}`) }),
        h('div', { class: 'pc-title', text: loc(sp.name) }),
      ),
    ),
  );
  const pr = state.properties[i];
  if (pr) {
    const owner = pr.owner !== null ? state.players[pr.owner]! : null;
    el.append(
      h(
        'div',
        { class: 'pc-row' },
        owner ? tokenBadge(owner, 'tok-badge pc-owner-tok') : null,
        h('span', { class: 'pc-sub', text: owner ? t('g.info.owner', { name: owner.name }) : t('g.info.unowned') }),
        h('b', { class: 'pc-price', text: money(sp.price ?? 0) }),
      ),
    );
    if (sp.kind === 'city') {
      el.append(tollLadder(state, i, pr.owner ?? 0, owner ? pr.level : null, null));
      if (owner) el.append(h('div', { class: 'pc-kvs' }, kv(t('g.toll.now'), money(tollOf(state, i)), 'is-strong'), kv(t('g.value'), money(propertyValue(state, i)))));
    } else {
      const n = owner ? hubCount(state, owner.id) : 1;
      el.append(h('div', { class: 'pc-kvs' }, kv(t('g.toll.now'), money(owner ? tollOf(state, i) : 100 * n), 'is-strong')));
    }
    if (state.festival === i) el.append(tag(t('g.toll.festival'), 'gold', 'festival-marker'));
  } else {
    const key = sp.kind === 'tax' && ruleFlags(state.settings).allOrNothing ? 'g.info.tax.gamble' : `g.info.${sp.kind}`;
    el.append(h('div', { class: 'pc-note', text: t(key, { pot: state.pot.toLocaleString() }) }));
  }
  el.append(h('button', { class: 'info-close', type: 'button', 'data-action': 'close-info', text: t('shell.close') }));
  return el;
}

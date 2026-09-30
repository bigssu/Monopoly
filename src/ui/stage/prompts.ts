/**
 * Prompt cards shown on the Stage for each `state.phase` (and the space info popover).
 * Every card faces the acting player (the Stage is rotated). For CPU players the same card is
 * shown read-only ("thinking…") so the table can follow what the CPU is deciding.
 */
import {
  BOARD,
  BUILDING_LEVEL_IDS,
  BUILDING_LEVEL_NAMES,
  GROUP_NAMES,
  type GroupId,
} from '@/content/board';
import {
  citiesInGroup,
  citiesOnSide,
  completedGroups,
  defaultAction,
  HUB_INDICES,
  hubCount,
  legalActions,
  propertyValue,
  saleOptions,
  sameAction,
  tollAtLevel,
  tollOf,
  type Action,
  type GameState,
  type Phase,
  type PlayerId,
} from '@/engine';
import { playerColor } from '@/content/palette';
import { loc, t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import type { Board } from '@/ui/board/Board';
import { groupColor, h, iconEl, money, setPlayerVars, spaceIcon, svgNode, tokenBadge } from '@/ui/game/util';
import type { Dice } from './Dice';

export interface PromptCtx {
  state: GameState;
  /** CPU is deciding: render read-only. */
  cpu: boolean;
  act: (a: Action) => void;
  board: Board;
  dice: Dice;
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

function tag(text: string, tone: 'gold' | 'good' | 'bad' | 'info' = 'info', icon?: string): HTMLElement {
  const el = h('span', { class: `tag tone-${tone}` });
  if (icon) el.append(iconEl(icon, 'ico tag-ico'));
  el.append(h('span', { text }));
  return el;
}

function levelIcon(level: number, color: string | null): HTMLElement {
  if (level === 0) {
    const sq = h('span', { class: 'lvl-land' });
    if (color) sq.style.background = color;
    return sq;
  }
  return iconEl(BUILDING_LEVEL_IDS[level]!, 'ico lvl-ico');
}

function levelName(level: number): string {
  return loc(BUILDING_LEVEL_NAMES[BUILDING_LEVEL_IDS[level]!]);
}

/** Toll by level for a city, current level highlighted. */
function tollLadder(state: GameState, i: number, owner: PlayerId, current: number | null, next: number | null): HTMLElement {
  const sp = BOARD[i]!;
  const row = h('div', { class: 'ladder' });
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
  const row = h('div', { class: 'gchips' });
  for (const i of citiesInGroup(group)) {
    const owner = state.properties[i]?.owner ?? null;
    const chip = h('span', { class: `gchip${i === focus ? ' is-focus' : ''}${owner !== null ? ' is-owned' : ''}` });
    chip.append(iconEl(spaceIcon(BOARD[i]!), 'ico gchip-ico'));
    if (owner !== null) setPlayerVars(chip, state.players[owner]!.colorId);
    row.append(chip);
  }
  return row;
}

function spaceTitle(i: number): string {
  return loc(BOARD[i]!.name);
}

// ---------------------------------------------------------------------------
// Phase prompts
// ---------------------------------------------------------------------------

function rollPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'preRoll' }>): PromptResult {
  const p = ctx.state.players[ph.playerId]!;
  const rollBtn = h('button', { class: 'roll-btn', type: 'button', 'data-action': 'Roll' });
  rollBtn.append(iconEl('dice-face-5', 'ico roll-ico'), h('span', { class: 'roll-label', text: t('g.roll') }));
  const roll: Action = { type: 'Roll', playerId: ph.playerId };
  if (ctx.cpu) rollBtn.disabled = true;
  else {
    let down = false;
    let fired = false;
    const fire = (): void => {
      if (fired) return;
      fired = true;
      ctx.dice.shake(false);
      ctx.act(roll);
    };
    rollBtn.addEventListener('pointerdown', (e) => {
      down = true;
      rollBtn.setPointerCapture?.(e.pointerId);
      rollBtn.classList.add('is-held');
      ctx.dice.shake(true);
    });
    rollBtn.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      rollBtn.classList.remove('is-held');
      fire();
    });
    rollBtn.addEventListener('pointercancel', () => {
      down = false;
      rollBtn.classList.remove('is-held');
      ctx.dice.shake(false);
    });
    rollBtn.addEventListener('click', (e) => {
      if ((e as MouseEvent).detail === 0) fire(); // keyboard
    });
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
  const el = h('div', { class: `pcard pc-roll${ctx.cpu ? ' is-cpu' : ''}` });
  if (tags.childNodes.length) el.append(tags);
  el.append(rollBtn);
  if (!ctx.cpu) el.append(h('div', { class: 'roll-hint', text: t('g.roll.hold') }));
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
  const sp = BOARD[i]!;
  const owns = (j: number): boolean => j === i || state.properties[j]?.owner === pid;
  if (sp.kind === 'hub') {
    if (HUB_INDICES.every(owns)) return tag(t('g.hint.hubWin'), 'gold', 'trophy');
    return null;
  }
  if (sp.side && citiesOnSide(sp.side).every(owns)) return tag(t('g.hint.lineWin'), 'gold', 'trophy');
  if (sp.group && citiesInGroup(sp.group).every(owns)) {
    if (completedGroups(state, pid).length >= 2) return tag(t('g.hint.tripleWin'), 'gold', 'trophy');
    return tag(t('g.hint.complete'), 'gold', 'check');
  }
  if (sp.group && citiesInGroup(sp.group).filter((j) => !owns(j)).length === 1) return tag(t('g.hint.oneAway'), 'info');
  return null;
}

function buyPrompt(ctx: PromptCtx, ph: Extract<Phase, { kind: 'buy' }>): PromptResult {
  const { state } = ctx;
  const i = ph.spaceIndex;
  const sp = BOARD[i]!;
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
      title: spaceTitle(i),
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
  const sp = BOARD[i]!;
  const from = state.properties[i]!.level;
  const to = ph.toLevel;
  const fest = state.festival === i ? 2 : 1;
  const now = tollOf(state, i);
  const next = tollAtLevel(state, i, to, ph.playerId) * fest;
  const preview = h(
    'div',
    { class: 'lvl-preview' },
    h('div', { class: 'lp-cell' }, levelIcon(from, groupColor(sp)), h('span', { text: levelName(from) })),
    h('span', { class: 'lp-arrow' }, svgNode('chevron-right')),
    h('div', { class: 'lp-cell is-next' }, levelIcon(to, groupColor(sp)), h('span', { text: levelName(to) })),
  );
  const el = card(
    'pc-build',
    {
      icon: spaceIcon(sp),
      accent: groupColor(sp),
      kicker: to === 4 ? t('g.build.kickerLandmark') : t('g.build.kicker'),
      title: spaceTitle(i),
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
  const sp = BOARD[i]!;
  const owner = state.players[ph.ownerId]!;
  const body: Array<Node | null> = [
    h('div', { class: 'pc-row' }, tokenBadge(owner, 'tok-badge pc-owner-tok'), h('span', { class: 'pc-sub', text: t('g.takeover.owner', { name: owner.name }) })),
    h('div', { class: 'pc-kvs' }, kv(t('g.value'), money(propertyValue(state, i))), kv(t('g.toll'), money(tollOf(state, i)))),
  ];
  if (ph.ownerHasShield) body.push(tag(t('g.takeover.shield'), 'bad', 'cards-shield'));
  const hint = victoryHint(state, ph.playerId, i);
  if (hint) body.push(hint);
  return {
    el: card(
      'pc-takeover',
      {
        icon: spaceIcon(sp),
        accent: playerColor(owner.colorId).hex,
        kicker: t('g.takeover.kicker'),
        title: spaceTitle(i),
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

function pickList(
  ctx: PromptCtx,
  options: readonly number[],
  make: (i: number) => Action,
  detail: (i: number) => string,
): HTMLElement {
  const list = h('div', { class: 'pick-list' });
  for (const i of options) {
    const sp = BOARD[i]!;
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
    const sp = BOARD[i]!;
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
    const sp = BOARD[i]!;
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
  const sp = BOARD[ph.spaceIndex]!;
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
    case 'gameOver':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Space info popover
// ---------------------------------------------------------------------------

export function spaceInfo(state: GameState, i: number): HTMLElement {
  const sp = BOARD[i]!;
  const el = h('div', { class: 'info-card' });
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
    el.append(h('div', { class: 'pc-note', text: t(`g.info.${sp.kind}`, { pot: state.pot.toLocaleString() }) }));
  }
  el.append(h('div', { class: 'info-close', text: t('g.tapToClose') }));
  return el;
}

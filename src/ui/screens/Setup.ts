/**
 * Setup screen: a top-down table with four seats (each facing its player, like the game),
 * a per-seat editor that opens rotated toward that seat, and the house-rule options.
 */
import { BOARD, GROUP_COLORS, HUB_COLOR } from '@/content/board';
import { icon, LOGO_SVG } from '@/content/icons';
import { PLAYER_COLORS, TOKEN_IDS } from '@/content/palette';
import { PROMPT_TIMER_OPTIONS, ROUND_LIMIT_OPTIONS, START_CASH_OPTIONS, type Seat } from '@/engine';
import { fmtMoney, onLangChange, t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { registerScreen } from '@/ui/router';
import { h, ico, iconButton, onTap } from '@/ui/shell/dom';
import { openDialog, promptText, toast } from '@/ui/shell/dialog';
import { go, setBackTarget } from '@/ui/shell/nav';
import { prefs } from '@/ui/shell/prefs';
import {
  activeSeats,
  buildSettings,
  cleanName,
  defaultDraft,
  NAME_MAX,
  normalizeDraft,
  pick,
  SEAT_ORDER,
  seatNumber,
  toggleSeat,
  validateDraft,
  type Controller,
  type SetupDraft,
} from '@/ui/shell/setupModel';
import { colorVars, segmented, toggleChip, tokenAvatar } from '@/ui/shell/widgets';

const SEAT_ROT: Record<Seat, number> = { S: 0, E: -90, N: 180, W: 90 };

function seatName(d: SetupDraft, seat: Seat): string {
  return d.seats[seat].name ?? t('setup.defaultName', { n: seatNumber(d, seat) });
}

function controllerLabel(c: Controller): string {
  return c === 'human' ? t('setup.human') : c === 'easy' ? t('setup.cpuEasy') : t('setup.cpuNormal');
}

// ---------------------------------------------------------------------------- mini board

let boardSvgCache: string | null = null;

/** Board content ids that differ from the icon registry. */
const ICON_ALIAS: Record<string, string> = { 'corner-travel': 'corner-tour' };
function safeIcon(id: string): string {
  try {
    return icon(ICON_ALIAS[id] ?? id);
  } catch {
    return '';
  }
}

/** Decorative 32-space ring (same space order as the game board), built once. */
function miniBoardSvg(): string {
  if (boardSvgCache) return boardSvgCache;
  const C = 13;
  const W = (100 - 2 * C) / 8;
  const parts: string[] = [];
  const nest = (svg: string, x: number, y: number, s: number) =>
    svg.replace('<svg ', `<svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" `);
  for (const sp of BOARD) {
    const i = sp.index;
    let x = 0;
    let y = 0;
    let w = W;
    let hgt = C;
    let side: 'b' | 'l' | 't' | 'r' | 'c' = 'c';
    if (i === 0) [x, y, w, hgt] = [100 - C, 100 - C, C, C];
    else if (i < 8) [x, y, side] = [100 - C - i * W, 100 - C, 'b'];
    else if (i === 8) [x, y, w, hgt] = [0, 100 - C, C, C];
    else if (i < 16) [x, y, w, hgt, side] = [0, 100 - C - (i - 8) * W, C, W, 'l'];
    else if (i === 16) [x, y, w, hgt] = [0, 0, C, C];
    else if (i < 24) [x, y, side] = [C + (i - 17) * W, 0, 't'];
    else if (i === 24) [x, y, w, hgt] = [100 - C, 0, C, C];
    else [x, y, w, hgt, side] = [100 - C, C + (i - 25) * W, C, W, 'r'];
    if (side === 'c') [w, hgt] = [C, C];
    const corner = side === 'c';
    const fill = corner ? '#F1E9DA' : '#FBF8F2';
    parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${hgt.toFixed(2)}" fill="${fill}" stroke="#DCCFB9" stroke-width=".35"/>`);
    const color = sp.group ? GROUP_COLORS[sp.group] : sp.kind === 'hub' ? HUB_COLOR : null;
    const B = 2.6;
    // Icon area (the cell minus its color bar on the inner edge).
    let ix = x;
    let iy = y;
    let iw = w;
    let ih = hgt;
    if (color) {
      const bar =
        side === 'b' ? [x, y, w, B] : side === 't' ? [x, y + hgt - B, w, B] : side === 'l' ? [x + w - B, y, B, hgt] : [x, y, B, hgt];
      parts.push(`<rect x="${bar[0]!.toFixed(2)}" y="${bar[1]!.toFixed(2)}" width="${bar[2]!.toFixed(2)}" height="${bar[3]!.toFixed(2)}" fill="${color}"/>`);
      if (side === 'b') iy += B, (ih -= B);
      else if (side === 't') ih -= B;
      else if (side === 'l') iw -= B;
      else ix += B, (iw -= B);
    }
    const s = Math.min(iw, ih) * (corner ? 0.86 : 0.84);
    parts.push(nest(safeIcon(sp.iconId), ix + (iw - s) / 2, iy + (ih - s) / 2, s));
  }
  boardSvgCache = `<svg class="mini-board-svg" viewBox="-1 -1 102 102" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="-1" y="-1" width="102" height="102" rx="3" fill="#E9DFCC"/>${parts.join('')}</svg>`;
  return boardSvgCache;
}

// ---------------------------------------------------------------------------- screen

registerScreen('setup', (root) => {
  setBackTarget('title');
  const stored = prefs.get().lastSetup;
  const draft: SetupDraft = stored ? normalizeDraft(stored) : defaultDraft();
  // The app-wide timer preference prefills the setup value.
  draft.promptTimer = prefs.get().promptTimer;
  let intro = true;
  let closeEditor: (() => void) | null = null;

  const save = () => prefs.set({ lastSetup: structuredClone(draft) });

  const screen = h('div', { class: 'screen setup-screen' });
  root.append(screen);

  function renderAll(): void {
    screen.innerHTML = '';
    screen.append(h('div', { class: 'setup-body safe-pad' }, renderTable(), renderSide()));
    intro = false;
  }

  // ------------------------------------------------------------------ table + seats

  function renderTable(): HTMLElement {
    const table = h('div', { class: `setup-table ${intro ? 'is-intro' : ''}`.trim() });
    const board = h('div', { class: 'mini-board' });
    board.innerHTML = miniBoardSvg();
    board.append(
      h(
        'div',
        { class: 'mini-board-center' },
        h('div', { class: 'mini-board-logo', html: LOGO_SVG }),
        h('div', { class: 'mini-board-count display' }, t('setup.count', { n: activeSeats(draft).length })),
      ),
    );
    const prop = (id: string, cls: string) => h('span', { class: `table-prop ${cls}`, html: safeIcon(id), 'aria-hidden': 'true' });
    table.append(
      h('div', { class: 'setup-table-felt' }),
      prop('dice-face-5', 'p1'),
      prop('dice-face-2', 'p2'),
      prop('coin', 'p3'),
      prop('coin', 'p4'),
      prop('cards-escape', 'p5'),
      board,
    );
    SEAT_ORDER.forEach((seat, i) => table.append(renderSeat(seat, i)));
    return h('section', { class: 'setup-table-wrap', 'aria-label': t('setup.hint') }, table);
  }

  function renderSeat(seat: Seat, order: number): HTMLElement {
    const s = draft.seats[seat];
    const anchor = h('div', {
      class: `seat-anchor seat-${seat} ${s.on ? 'is-on' : 'is-off'}`,
      '--rot': `${SEAT_ROT[seat]}deg`,
      '--order': String(order),
      'data-seat': seat,
    });
    if (!s.on) {
      const join = h(
        'button',
        { type: 'button', class: 'seat-card seat-join', 'aria-label': `${t('setup.join')} · ${t('setup.seatOf', { seat: t(`setup.seat.${seat}`) })}` },
        h('span', { class: 'seat-join-plus' }, ico('plus')),
        h('span', { class: 'seat-join-text' }, h('span', { class: 'seat-join-title display' }, t('setup.join')), h('span', { class: 'seat-join-sub' }, t('setup.seatOf', { seat: t(`setup.seat.${seat}`) }))),
      );
      onTap(join, () => {
        toggleSeat(draft, seat);
        save();
        sfx.play('buy');
        renderAll();
      }, { sound: null, haptic: 'medium' });
      anchor.append(join);
      return anchor;
    }
    const card = h(
      'button',
      {
        type: 'button',
        class: 'seat-card seat-player',
        ...colorVars(s.colorId),
        'aria-label': `${seatName(draft, seat)} · ${t('setup.edit')}`,
      },
      tokenAvatar(s.tokenId, s.colorId, 'seat-avatar'),
      h(
        'span',
        { class: 'seat-text' },
        h('span', { class: 'seat-name display' }, seatName(draft, seat)),
        h(
          'span',
          { class: 'seat-sub' },
          h('span', { class: `seat-ctrl ${s.controller === 'human' ? '' : 'is-cpu'}` }, ico(s.controller === 'human' ? 'human' : 'cpu'), controllerLabel(s.controller)),
        ),
      ),
      h('span', { class: 'seat-edit' }, ico('settings')),
    );
    onTap(card, () => openEditor(seat));
    anchor.append(card);
    if (seat !== 'S' && activeSeats(draft).length > 2) {
      const leave = h('button', { type: 'button', class: 'seat-leave', 'aria-label': t('setup.leave') }, ico('close'));
      onTap(leave, () => {
        toggleSeat(draft, seat);
        save();
        renderAll();
      }, { sound: 'cash-out', haptic: 'light' });
      anchor.append(leave);
    }
    return anchor;
  }

  // ------------------------------------------------------------------ seat editor

  function openEditor(seat: Seat): void {
    closeEditor?.();
    const rot = h('div', { class: `seat-editor-rot seat-${seat}`, '--rot': `${SEAT_ROT[seat]}deg` });
    const panel = h('div', { class: 'dlg seat-editor', 'data-seat': seat });
    rot.append(panel);

    const renderPanel = () => {
      const s = draft.seats[seat];
      panel.innerHTML = '';
      Object.entries(colorVars(s.colorId)).forEach(([k, v]) => panel.style.setProperty(k, v));

      const nameBtn = h(
        'button',
        { type: 'button', class: 'se-name', 'aria-label': t('setup.rename') },
        h('span', { class: 'se-name-text display' }, seatName(draft, seat)),
        h('span', { class: 'se-name-hint' }, t('setup.rename')),
      );
      onTap(nameBtn, async () => {
        const next = await promptText({
          title: t('setup.nameTitle'),
          value: s.name ?? seatName(draft, seat),
          placeholder: t('setup.namePlaceholder'),
          maxLength: NAME_MAX,
        });
        if (next === null) return;
        const clean = cleanName(next);
        s.name = clean && clean !== t('setup.defaultName', { n: seatNumber(draft, seat) }) ? clean : null;
        save();
        renderPanel();
        renderAll();
      });
      const done = h('button', { type: 'button', class: 'btn btn-primary se-done' }, ico('check'), t('shell.done'));
      onTap(done, () => closeEditor?.());

      // tokens
      const tokens = h('div', { class: 'se-tokens', role: 'radiogroup', 'aria-label': t('setup.token') });
      for (const id of TOKEN_IDS) {
        const holder = activeSeats(draft).find((o) => o !== seat && draft.seats[o].tokenId === id);
        const b = h('button', {
          type: 'button',
          class: 'se-token',
          role: 'radio',
          'aria-checked': String(s.tokenId === id),
          'aria-label': id,
          'data-token': id,
        });
        b.innerHTML = icon(id);
        if (holder) b.append(h('span', { class: 'se-taken', ...colorVars(draft.seats[holder].colorId) }));
        onTap(b, () => {
          pick(draft, seat, 'tokenId', id);
          save();
          renderPanel();
          renderAll();
        }, { haptic: 'tick' });
        tokens.append(b);
      }

      // colors
      const colors = h('div', { class: 'se-colors', role: 'radiogroup', 'aria-label': t('setup.color') });
      for (const c of PLAYER_COLORS) {
        const holder = activeSeats(draft).find((o) => o !== seat && draft.seats[o].colorId === c.id);
        const b = h('button', {
          type: 'button',
          class: 'se-color',
          role: 'radio',
          'aria-checked': String(s.colorId === c.id),
          'aria-label': c.id,
          'data-color': c.id,
          ...colorVars(c.id),
        });
        if (s.colorId === c.id) b.append(ico('check', 'se-color-check'));
        else if (holder) {
          const mini = h('span', { class: 'se-color-holder' });
          mini.innerHTML = icon(draft.seats[holder].tokenId);
          b.append(mini);
        }
        onTap(b, () => {
          pick(draft, seat, 'colorId', c.id);
          save();
          renderPanel();
          renderAll();
        }, { haptic: 'tick' });
        colors.append(b);
      }

      const ctrl = segmented<Controller>(
        [
          { value: 'human', label: t('setup.human') },
          { value: 'easy', label: t('setup.cpuEasy') },
          { value: 'normal', label: t('setup.cpuNormal') },
        ],
        s.controller,
        (v) => {
          s.controller = v;
          save();
          renderAll();
        },
        { label: t('setup.controller'), cls: 'se-ctrl' },
      );

      panel.append(
        h('div', { class: 'se-head' }, tokenAvatar(s.tokenId, s.colorId, 'se-avatar'), nameBtn, done),
        h('div', { class: 'se-label' }, t('setup.token')),
        tokens,
        h('div', { class: 'se-label' }, t('setup.color')),
        colors,
        h('div', { class: 'se-label' }, t('setup.controller')),
        ctrl,
      );
    };
    renderPanel();
    closeEditor = openDialog(() => rot, {
      cls: 'seat-editor-backdrop',
      onClose: () => {
        closeEditor = null;
      },
    });
  }

  // ------------------------------------------------------------------ options + start

  function renderSide(): HTMLElement {
    const back = iconButton('chevron-left', t('shell.back'), () => go('title', {}));
    const head = h(
      'header',
      { class: 'setup-head' },
      back,
      h('h1', { class: 'setup-title' }, t('setup.title')),
      h('span', { class: 'setup-count num' }, ico('human'), t('setup.count', { n: activeSeats(draft).length })),
    );

    const row = (label: string, iconId: string, control: HTMLElement) =>
      h('div', { class: 'opt-row' }, h('span', { class: 'opt-label' }, ico(iconId), h('span', null, label)), control);

    const unit = t('shell.moneyUnit');
    const opts = h(
      'div',
      { class: 'opt-card' },
      h('h2', { class: 'opt-card-title' }, t('setup.rules')),
      row(
        t('setup.rounds'),
        'restart',
        segmented(
          ROUND_LIMIT_OPTIONS.map((v) => ({ value: v, label: v === null ? t('setup.unlimited') : String(v) })),
          draft.roundLimit,
          (v) => {
            draft.roundLimit = v;
            save();
          },
          { label: t('setup.rounds'), cls: 'seg-rounds' },
        ),
      ),
      row(
        t('setup.cash'),
        'coin',
        segmented(
          START_CASH_OPTIONS.map((v) => ({ value: v, label: fmtMoney(v), aria: `${fmtMoney(v)}${unit}` })),
          draft.startCash,
          (v) => {
            draft.startCash = v;
            save();
          },
          { label: t('setup.cash') },
        ),
      ),
      row(
        t('setup.timer'),
        'timer',
        segmented(
          PROMPT_TIMER_OPTIONS.map((v) => ({ value: v, label: v === 0 ? t('setup.timerOff') : t('setup.seconds', { n: v }) })),
          draft.promptTimer,
          (v) => {
            draft.promptTimer = v;
            prefs.set({ promptTimer: v });
            save();
          },
          { label: t('setup.timer') },
        ),
      ),
      h(
        'div',
        { class: 'opt-toggles' },
        toggleChip(t('setup.takeover'), draft.takeover, (v) => {
          draft.takeover = v;
          save();
        }),
        toggleChip(t('setup.auction'), draft.auction, (v) => {
          draft.auction = v;
          save();
        }),
        toggleChip(t('setup.firstBankrupt'), draft.endOnFirstBankruptcy, (v) => {
          draft.endOnFirstBankruptcy = v;
          save();
        }),
      ),
    );

    const problem = validateDraft(draft);
    const start = h(
      'button',
      { type: 'button', class: 'btn btn-primary btn-xl setup-start', 'data-action': 'start', 'aria-disabled': String(!!problem) },
      ico('play'),
      h('span', null, t('setup.start')),
    );
    start.addEventListener('click', () => {
      const err = validateDraft(draft);
      if (err) {
        sfx.play('error');
        haptic('error');
        toast(t(err));
        return;
      }
      sfx.play('pass-start');
      haptic('success');
      save();
      const { settings, seed } = buildSettings(draft, (n) => t('setup.defaultName', { n }));
      go('game', { settings, seed });
    });

    const order = h(
      'div',
      { class: 'setup-order' },
      h('div', { class: 'setup-order-title' }, ico('rotate'), t('setup.order')),
      h(
        'div',
        { class: 'setup-order-list' },
        activeSeats(draft).flatMap((seat, i) => [
          i > 0 ? ico('chevron-right', 'order-arrow') : null,
          h('span', { class: 'order-chip', ...colorVars(draft.seats[seat].colorId) }, tokenAvatar(draft.seats[seat].tokenId, draft.seats[seat].colorId), seatName(draft, seat)),
        ]),
      ),
    );

    return h(
      'aside',
      { class: 'setup-side' },
      head,
      opts,
      order,
      h('div', { class: 'setup-foot' }, h('p', { class: 'setup-note' }, ico('rotate'), problem ? t(problem) : t('setup.randomStart')), start),
    );
  }

  renderAll();
  const offLang = onLangChange(() => {
    closeEditor?.();
    renderAll();
  });
  return () => {
    offLang();
    closeEditor?.();
  };
});

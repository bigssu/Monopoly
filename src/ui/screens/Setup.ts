/**
 * Setup screen: a top-down table with four seats (each facing its player, like the game),
 * a per-seat editor that opens rotated toward that seat, and the house-rule options.
 */
import { BOARD_SIDE_OPTIONS, getBoard, GROUP_COLORS, HUB_COLOR, type SpacesPerSide } from '@/content/board';
import { icon, LOGO_SVG } from '@/content/icons';
import { PLAYER_COLORS, TOKEN_IDS } from '@/content/palette';
import { PROMPT_TIMER_OPTIONS, ROUND_LIMIT_OPTIONS, START_CASH_OPTIONS, type Seat } from '@/engine';
import { fmtMoney, onLangChange, t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { registerScreen } from '@/ui/router';
import { getBoardGeometry, VB } from '@/ui/board/geometry';
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

const boardSvgCache = new Map<SpacesPerSide, string>();

/** Board content ids that differ from the icon registry. */
const ICON_ALIAS: Record<string, string> = { 'corner-travel': 'corner-tour' };
function safeIcon(id: string): string {
  try {
    return icon(ICON_ALIAS[id] ?? id);
  } catch {
    return '';
  }
}

/** Preview uses the same geometry as the playable board. */
function miniBoardSvg(size: SpacesPerSide): string {
  const cached = boardSvgCache.get(size);
  if (cached) return cached;
  const geom = getBoardGeometry(size);
  const scale = 100 / VB;
  const parts: string[] = [];
  const nest = (svg: string, x: number, y: number, s: number) =>
    svg.replace('<svg ', `<svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" `);
  for (const sp of getBoard(size)) {
    const g = geom[sp.index]!;
    const x = g.x * scale;
    const y = g.y * scale;
    const w = g.w * scale;
    const hgt = g.h * scale;
    const corner = g.corner;
    const color = sp.group ? GROUP_COLORS[sp.group] : sp.kind === 'hub' ? HUB_COLOR : null;
    if (corner) {
      // Circular waypoints make the four special stops read as map destinations, not board corners.
      const r = Math.min(w, hgt) / 2 - 1.1;
      const cx = x + w / 2;
      const cy = y + hgt / 2;
      const fill = sp.kind === 'start' ? '#EAF8F5' : sp.kind === 'island' ? '#FFF4D7' : '#F4EEFF';
      parts.push(
        `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}" stroke="#8BD0C7" stroke-width=".6"/>`,
        `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${Math.max(r - 2.1, 1).toFixed(2)}" fill="none" stroke="#0A3847" stroke-width=".45" stroke-dasharray="1.3 1.1" opacity=".42"/>`,
      );
      const s = Math.min(w, hgt) * 0.62;
      parts.push(nest(safeIcon(sp.iconId), cx - s / 2, cy - s / 2, s));
      continue;
    }

    // Separate destination cards preserve the route while avoiding a continuous colour strip.
    const inset = 0.7;
    const cw = w - inset * 2;
    const ch = hgt - inset * 2;
    parts.push(`<rect x="${(x + inset).toFixed(2)}" y="${(y + inset).toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" rx="1.7" fill="#F7FCFC" stroke="#8BD0C7" stroke-width=".35"/>`);
    if (color) {
      const badgeW = Math.min(3.6, cw * 0.38);
      const badgeH = Math.min(1.8, ch * 0.18);
      parts.push(`<rect x="${(x + inset + 1).toFixed(2)}" y="${(y + inset + 1).toFixed(2)}" width="${badgeW.toFixed(2)}" height="${badgeH.toFixed(2)}" rx="${(badgeH / 2).toFixed(2)}" fill="${color}"/>`);
    }
    // Small inset seal keeps each stop legible as a destination at thumbnail scale.
    parts.push(`<circle cx="${(x + w - 2.2).toFixed(2)}" cy="${(y + hgt - 2.2).toFixed(2)}" r="1.1" fill="#D4E9E6" stroke="#0E5260" stroke-width=".32"/>`);
    const s = Math.min(cw, ch) * 0.52;
    parts.push(nest(safeIcon(sp.iconId), x + (w - s) / 2, y + (hgt - s) / 2 + 0.6, s));
  }
  const svg = `<svg class="mini-board-svg" viewBox="-1 -1 102 102" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="-1" y="-1" width="102" height="102" rx="8" fill="#0E5260"/><rect x="13.8" y="13.8" width="72.4" height="72.4" rx="5.5" fill="#0A3847"/>${parts.join('')}</svg>`;
  boardSvgCache.set(size, svg);
  return svg;
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
    const active = document.activeElement instanceof HTMLElement && screen.contains(document.activeElement)
      ? document.activeElement.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey
      : undefined;
    screen.innerHTML = '';
    screen.append(h('div', { class: 'setup-body safe-pad' }, renderTable(), renderSide()));
    if (active) {
      const target = screen.querySelector<HTMLElement>(`[data-focus-key="${active}"]`);
      (target?.querySelector<HTMLElement>('[aria-checked="true"]') ?? target)?.focus();
    }
    intro = false;
  }

  // ------------------------------------------------------------------ table + seats

  function renderTable(): HTMLElement {
    const table = h('div', { class: `setup-table ${intro ? 'is-intro' : ''}`.trim() });
    const board = h('div', { class: 'mini-board' });
    board.innerHTML = miniBoardSvg(draft.spacesPerSide);
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
        { type: 'button', class: 'seat-card seat-join', 'aria-label': `${t('setup.join')} · ${t('setup.seatOf', { seat: t(`setup.seat.${seat}`) })}`, 'data-focus-key': `seat-${seat}` },
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
        'data-focus-key': `seat-${seat}`,
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
        { type: 'button', class: 'se-name', 'aria-label': t('setup.rename'), 'data-focus-key': 'name' },
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
        panel.querySelector<HTMLElement>('[data-focus-key="name"]')?.focus();
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
          tabindex: s.tokenId === id ? '0' : '-1',
        });
        b.innerHTML = icon(id);
        if (holder) b.append(h('span', { class: 'se-taken', ...colorVars(draft.seats[holder].colorId) }));
        onTap(b, () => {
          pick(draft, seat, 'tokenId', id);
          save();
          renderPanel();
          renderAll();
          panel.querySelector<HTMLButtonElement>(`[data-token="${id}"]`)?.focus();
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
          tabindex: s.colorId === c.id ? '0' : '-1',
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
          panel.querySelector<HTMLButtonElement>(`[data-color="${c.id}"]`)?.focus();
        }, { haptic: 'tick' });
        colors.append(b);
      }

      const addRadioKeys = (group: HTMLElement) => {
        const buttons = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
        buttons.forEach((button, i) => button.addEventListener('keydown', (event) => {
          const keys: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -Infinity, End: Infinity };
          if (!(event.key in keys)) return;
          event.preventDefault();
          const step = keys[event.key]!;
          const next = step === -Infinity ? 0 : step === Infinity ? buttons.length - 1 : (i + step + buttons.length) % buttons.length;
          buttons[next]!.click();
        }));
      };
      addRadioKeys(tokens);
      addRadioKeys(colors);

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
        { label: t('setup.controller'), cls: 'se-ctrl', focusKey: 'controller' },
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
      label: t('setup.edit'),
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
        t('setup.spacesPerSide'),
        'landmark',
        segmented(
          BOARD_SIDE_OPTIONS.map((value) => ({ value, label: String(value) })),
          draft.spacesPerSide,
          (value) => {
            draft.spacesPerSide = value;
            save();
            renderAll();
          },
          { label: t('setup.spacesPerSide'), focusKey: 'spaces' },
        ),
      ),
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
          { label: t('setup.rounds'), cls: 'seg-rounds', focusKey: 'rounds' },
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
          { label: t('setup.cash'), focusKey: 'cash' },
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
          { label: t('setup.timer'), focusKey: 'timer' },
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
    const freeSeat = SEAT_ORDER.find((seat) => !draft.seats[seat].on);
    const addAi = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-ghost setup-add-ai',
        'data-action': 'add-ai',
        disabled: !freeSeat,
        'aria-disabled': String(!freeSeat),
      },
      ico('cpu'),
      h('span', null, t('setup.addAi')),
    );
    onTap(addAi, () => {
      if (!freeSeat || draft.seats[freeSeat].on) return;
      toggleSeat(draft, freeSeat);
      draft.seats[freeSeat].controller = 'normal';
      save();
      sfx.play('buy');
      renderAll();
    }, { sound: null, haptic: 'medium' });
    const start = h(
      'button',
      { type: 'button', class: 'btn btn-primary btn-xl setup-start', 'data-action': 'start', disabled: !!problem, 'aria-describedby': 'setup-start-note' },
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
      h('div', { class: 'setup-foot' }, h('p', { class: 'setup-note', id: 'setup-start-note', role: 'status' }, ico('rotate'), problem ? t(problem) : t('setup.randomStart')), addAi, start),
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

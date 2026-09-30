/**
 * The board: an SVG ring of 32 spaces (static art, diffed per space), the Stage host in the
 * middle and an HTML token layer on top (tokens hop with the Web Animations API).
 */
import { BOARD, oneAwayWarnings, type GameState, type Player, type PlayerId, type SpaceDef } from '@/engine';
import { playerColor } from '@/content/palette';
import { getLang, loc, fmtMoney, t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { anim, D, gridTimeout, instant, onFrame } from '@/ui/fx/time';
import { groupColor, h, setPlayerVars, spaceIcon, svg } from '@/ui/game/util';
import { DEPTH, GEOM, INNER, VB, tokenSpot, type SpaceGeom } from './geometry';

const NS = 'http://www.w3.org/2000/svg';

const CORNER_BG: Record<string, string> = {
  start: '#DDF3E4',
  island: '#D6EEF8',
  festival: '#FBE1EC',
  travel: '#E2E7FD',
};
const SPECIAL_BAR: Record<string, string> = {
  event: '#F2B633',
  tax: '#8A94A6',
  donation: '#F272A8',
};

/** Nested <svg> icon at a position (board units). */
function iconAt(id: string, x: number, y: number, size: number, cls = ''): string {
  return svg(id).replace(
    '<svg ',
    `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size}" height="${size}" class="${cls}" `,
  );
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function estWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch)) w += 1;
    else if (ch === ' ') w += 0.3;
    else if (ch === '.') w += 0.3;
    else if (/[A-Z]/.test(ch)) w += 0.7;
    else w += 0.56;
  }
  return w;
}

/** Preferred line breaks for long Korean names (syllable index). */
const KO_BREAK: Record<string, number> = { 우주정거장: 2, 고속열차역: 2, 부에노스아이레스: 4, 멕시코시티: 3, 케이프타운: 3 };

/** Fit a label into `maxW` (board units): one line, or two lines when it would get tiny. */
export function fitLabel(text: string, maxW: number, maxFont: number): { lines: string[]; size: number } {
  const one = Math.min(maxFont, maxW / estWidth(text));
  if (one >= maxFont * 0.8) return { lines: [text], size: one };
  let a: string;
  let b: string;
  const sp = text.indexOf(' ');
  if (sp > 0) {
    // Split at the space nearest the middle.
    const spaces = [...text].map((c, i) => (c === ' ' ? i : -1)).filter((i) => i > 0);
    const mid = text.length / 2;
    const at = spaces.reduce((best, i) => (Math.abs(i - mid) < Math.abs(best - mid) ? i : best), spaces[0]!);
    a = text.slice(0, at);
    b = text.slice(at + 1);
  } else if (/[가-힯]/.test(text)) {
    // Korean: up to 4 syllables stay on one line; longer names break at a natural point.
    if (text.length <= 4) return { lines: [text], size: one };
    const cut = KO_BREAK[text] ?? Math.ceil(text.length / 2);
    a = text.slice(0, cut);
    b = text.slice(cut);
  } else {
    return { lines: [text], size: Math.max(one, maxFont * 0.6) };
  }
  const two = Math.min(maxFont * 0.88, maxW / Math.max(estWidth(a), estWidth(b)));
  return one >= two * 0.95 ? { lines: [text], size: one } : { lines: [a, b], size: two };
}

function textLines(
  lines: string[],
  size: number,
  cx: number,
  baseY: number,
  cls: string,
  lineGap = 1.02,
): string {
  if (lines.length === 1) {
    return `<text class="${cls}" x="${cx}" y="${baseY}" font-size="${size.toFixed(1)}" text-anchor="middle">${esc(lines[0]!)}</text>`;
  }
  const y0 = baseY - (size * lineGap) / 2;
  return lines
    .map(
      (l, i) =>
        `<text class="${cls}" x="${cx}" y="${(y0 + i * size * lineGap).toFixed(1)}" font-size="${size.toFixed(1)}" text-anchor="middle">${esc(l)}</text>`,
    )
    .join('');
}

interface SpaceView {
  owner: PlayerId | null;
  level: number;
  festival: boolean;
  pot: number;
  ring: string | null;
  lang: string;
}

function sideSpaceMarkup(sp: SpaceDef, g: SpaceGeom, v: SpaceView, players: readonly Player[]): string {
  const w = g.lw;
  const hgt = g.lh;
  const m = 7;
  const bar = sp.kind === 'city' || sp.kind === 'hub' ? groupColor(sp)! : (SPECIAL_BAR[sp.kind] ?? '#CBD2DE');
  const isProp = sp.kind === 'city' || sp.kind === 'hub';
  const owner = v.owner !== null ? players[v.owner] : undefined;
  const oc = owner ? playerColor(owner.colorId) : null;
  const barH = isProp ? 86 : 40;
  const parts: string[] = [];
  parts.push(
    `<rect class="sp-bg" x="${m}" y="${m}" width="${w - 2 * m}" height="${hgt - 2 * m}" rx="24" fill="${oc ? oc.tint : '#FFFDF8'}"/>`,
  );
  // Owner band behind the name (outer edge) — readable from across the table.
  if (oc) {
    parts.push(
      `<path d="M${m} 258 H${w - m} V${hgt - m - 24} Q${w - m} ${hgt - m} ${w - m - 24} ${hgt - m} H${m + 24} Q${m} ${hgt - m} ${m} ${hgt - m - 24} Z" fill="${oc.hex}"/>`,
    );
  }
  // Group color bar on the inner edge.
  parts.push(
    `<path d="M${m} ${m + barH} V${m + 24} Q${m} ${m} ${m + 24} ${m} H${w - m - 24} Q${w - m} ${m} ${w - m} ${m + 24} V${m + barH} Z" fill="${bar}"/>`,
  );
  if (isProp && v.level === 0) {
    parts.push(
      `<text class="sp-price" x="${w / 2}" y="${m + 62}" font-size="54" text-anchor="middle">${esc(fmtMoney(sp.price ?? 0))}</text>`,
    );
  }
  // Landmark icon.
  const iconSize = isProp ? 152 : 176;
  const iconY = isProp ? 99 : 66;
  parts.push(iconAt(spaceIcon(sp), (w - iconSize) / 2, iconY, iconSize));
  // Name.
  const name = loc(sp.short);
  const fit = fitLabel(name, w - 40, 92);
  parts.push(textLines(fit.lines, fit.size, w / 2, fit.lines.length === 1 ? 388 : 386, oc ? 'sp-name on-owner' : 'sp-name'));
  // Buildings sit on a white pill over the inner bar, roofs tinted in the owner's color.
  if (v.level >= 1 && oc) {
    parts.push(`<rect x="${m + 12}" y="${m + 8}" width="${w - 2 * m - 24}" height="${barH - 14}" rx="${(barH - 14) / 2}" fill="#fff" opacity=".94"/>`);
  }
  if (v.level >= 1 && v.level <= 3) {
    const ids = ['villa', 'building', 'hotel'].slice(0, v.level);
    const sz = 92;
    const step = 84;
    const x0 = w / 2 - ((ids.length - 1) * step) / 2 - sz / 2;
    ids.forEach((id, i) => parts.push(`<g color="${oc?.hex ?? '#E8564F'}">${iconAt(id, x0 + i * step, -4, sz, 'sp-bld')}</g>`));
  } else if (v.level === 4) {
    parts.push(`<circle class="sp-glow" cx="${w / 2}" cy="${46}" r="84" fill="url(#lr-glow)"/>`);
    parts.push(`<g color="${oc?.hex ?? '#F2B633'}">${iconAt('landmark', w / 2 - 60, -16, 120, 'sp-bld sp-landmark')}</g>`);
  }
  if (oc) {
    parts.push(
      `<rect x="${m + 6}" y="${m + 6}" width="${w - 2 * m - 12}" height="${hgt - 2 * m - 12}" rx="20" fill="none" stroke="${oc.hex}" stroke-width="12"/>`,
    );
  }
  if (v.festival) {
    parts.push(iconAt('festival-marker', w - 138, 96, 124, 'sp-fest'));
    parts.push(
      `<g class="sp-x2"><rect x="${14}" y="${104}" width="96" height="58" rx="29" fill="#E8564F"/><text x="62" y="147" font-size="44" text-anchor="middle" fill="#fff">×2</text></g>`,
    );
  }
  return parts.join('');
}

function cornerMarkup(sp: SpaceDef, g: SpaceGeom, v: SpaceView): string {
  const s = g.lw;
  const parts: string[] = [];
  parts.push(
    `<rect class="sp-bg" x="7" y="7" width="${s - 14}" height="${s - 14}" rx="34" fill="${CORNER_BG[sp.kind] ?? '#FFFDF8'}"/>`,
  );
  parts.push(`<g transform="rotate(${g.rot} ${s / 2} ${s / 2})">`);
  parts.push(iconAt(spaceIcon(sp), s / 2 - 118, 64, 236));
  const fit = fitLabel(loc(sp.name), 300, 80);
  parts.push(textLines(fit.lines, fit.size, s / 2, 378, 'sp-name sp-corner-name'));
  if (sp.kind === 'start') {
    parts.push(`<text class="sp-sub" x="${s / 2}" y="440" font-size="44" text-anchor="middle">${esc(t('g.board.salary'))}</text>`);
    if (v.pot > 0) {
      parts.push(
        `<g class="sp-pot"><rect x="${s / 2 - 150}" y="6" width="300" height="74" rx="37" fill="#1B2430" opacity=".86"/>` +
          iconAt('pot', s / 2 - 144, 10, 66) +
          `<text x="${s / 2 + 34}" y="58" font-size="46" text-anchor="middle" fill="#FFD66B">${esc(fmtMoney(v.pot))}</text></g>`,
      );
    }
  }
  parts.push('</g>');
  return parts.join('');
}

interface TokenEl {
  root: HTMLElement;
  body: HTMLElement;
  pos: number;
  moving: boolean;
  hidden: boolean;
  x: number;
  y: number;
  shared: boolean;
}

export class Board {
  readonly el: HTMLElement;
  readonly stageHost: HTMLElement;
  readonly overlay: HTMLElement;
  /**
   * HTML layer between the board SVG and the tokens for per-space highlights (one-away rings,
   * pick / focus outlines, pick dimming). Their pulses animate opacity on small HTML elements
   * (compositor-only); animating inside the SVG would repaint the whole board every frame.
   */
  private marks: HTMLElement;
  private rings = new Map<number, HTMLElement>();
  private pickEls: HTMLElement[] = [];
  private focusEl: HTMLElement | null = null;
  private dimEl: HTMLElement | null = null;
  private svgEl: SVGSVGElement;
  private groups: SVGGElement[] = [];
  private sigs: string[] = [];
  private tokens = new Map<PlayerId, TokenEl>();
  private tokenLayer: HTMLElement;
  private px = 800;
  private players: readonly Player[];
  private pickHandler: ((i: number) => void) | null = null;
  private pickSet = new Set<number>();

  constructor(players: readonly Player[], private onTap: (index: number) => void) {
    this.players = players;
    this.el = h('div', { class: 'board' });
    this.svgEl = document.createElementNS(NS, 'svg');
    this.svgEl.setAttribute('viewBox', `0 0 ${VB} ${VB}`);
    this.svgEl.setAttribute('class', 'board-svg');
    this.svgEl.innerHTML =
      `<defs><radialGradient id="lr-glow"><stop offset="0" stop-color="#FFE27A" stop-opacity=".95"/><stop offset="1" stop-color="#FFE27A" stop-opacity="0"/></radialGradient></defs>` +
      `<rect x="0" y="0" width="${VB}" height="${VB}" rx="70" class="board-face"/>` +
      `<rect x="${INNER.x - 10}" y="${INNER.y - 10}" width="${INNER.size + 20}" height="${INNER.size + 20}" rx="40" class="board-inner-rim"/>`;
    for (let i = 0; i < 32; i++) {
      const g = GEOM[i]!;
      const grp = document.createElementNS(NS, 'g');
      grp.setAttribute('class', `sp sp-${BOARD[i]!.kind}`);
      grp.setAttribute('data-i', String(i));
      const tr = g.corner
        ? `translate(${g.x} ${g.y})`
        : `translate(${g.cx} ${g.cy}) rotate(${g.rot}) translate(${-g.lw / 2} ${-g.lh / 2})`;
      grp.setAttribute('transform', tr);
      this.svgEl.appendChild(grp);
      this.groups.push(grp);
      this.sigs.push('');
    }
    this.svgEl.addEventListener('click', (e) => {
      const g = (e.target as Element).closest?.('g.sp');
      if (!g) return;
      const i = Number(g.getAttribute('data-i'));
      if (this.pickHandler && this.pickSet.has(i)) {
        sfx.play('tap');
        this.pickHandler(i);
        return;
      }
      this.onTap(i);
    });
    this.stageHost = h('div', { class: 'stage-host' });
    this.marks = h('div', { class: 'board-marks' });
    this.tokenLayer = h('div', { class: 'token-layer' });
    this.overlay = h('div', { class: 'board-overlay' });
    this.el.append(this.svgEl, this.marks, this.stageHost, this.tokenLayer, this.overlay);
    for (const p of players) {
      const body = h('div', { class: 'token-body' });
      body.append(h('span', { class: 'tok-badge', html: svg(p.tokenId) }));
      const root = h('div', { class: 'token', 'data-pid': p.id }, h('div', { class: 'token-shadow' }), body);
      setPlayerVars(root, p.colorId);
      this.tokenLayer.append(root);
      this.tokens.set(p.id, { root, body, pos: -1, moving: false, hidden: false, x: 0, y: 0, shared: false });
    }
  }

  setSize(px: number): void {
    if (px === this.px) return;
    this.px = px;
    for (const tk of this.tokens.values()) this.setTokenXY(tk, tk.x, tk.y);
  }

  /** Board-unit → px scale. */
  private get k(): number {
    return this.px / VB;
  }

  // -------------------------------------------------------------------------
  // Spaces
  // -------------------------------------------------------------------------

  render(vs: GameState): void {
    const rings = new Map<number, string>();
    for (const w of oneAwayWarnings(vs)) {
      if (vs.properties[w.missing]?.owner === w.playerId) continue;
      rings.set(w.missing, playerColor(vs.players[w.playerId]!.colorId).hex);
    }
    const lang = getLang();
    for (let i = 0; i < 32; i++) {
      const sp = BOARD[i]!;
      const pr = vs.properties[i];
      const v: SpaceView = {
        owner: pr?.owner ?? null,
        level: pr?.level ?? 0,
        festival: vs.festival === i,
        pot: i === 0 ? vs.pot : 0,
        ring: rings.get(i) ?? null,
        lang,
      };
      const sig = `${v.owner}|${v.level}|${v.festival}|${v.pot}|${v.lang}`;
      const grp = this.groups[i]!;
      if (sig !== this.sigs[i]) {
        this.sigs[i] = sig;
        const g = GEOM[i]!;
        grp.innerHTML = g.corner ? cornerMarkup(sp, g, v) : sideSpaceMarkup(sp, g, v, this.players);
      }
      // One-away pulse ring: a separate HTML mark above the space, recreated only on change.
      const ring = this.rings.get(i);
      if ((ring?.dataset.color ?? null) !== v.ring) {
        ring?.remove();
        this.rings.delete(i);
        if (v.ring) {
          const g = GEOM[i]!;
          const el = this.mark(i, 'bm-ring', `<rect x="10" y="10" width="${g.lw - 20}" height="${g.lh - 20}" rx="22" stroke="${v.ring}"/>`);
          el.dataset.color = v.ring;
          this.rings.set(i, el);
        }
      }
    }
    this.renderTokens(vs);
  }

  /** Brief highlight of a space (bought / built / stamped). */
  async pulseSpace(i: number, kind: 'pop' | 'stamp' | 'shake' = 'pop'): Promise<void> {
    const grp = this.groups[i];
    if (!grp || instant()) return;
    const g = GEOM[i]!;
    const cls = `fx-${kind}`;
    const ring = h('div', { class: `space-flash ${cls}` });
    const k = 100 / VB;
    ring.style.left = `${g.x * k}%`;
    ring.style.top = `${g.y * k}%`;
    ring.style.width = `${g.w * k}%`;
    ring.style.height = `${g.h * k}%`;
    this.overlay.append(ring);
    const frames: Keyframe[] =
      kind === 'shake'
        ? [
            { transform: 'translateX(0)', opacity: 1 },
            { transform: 'translateX(-6%)', offset: 0.2 },
            { transform: 'translateX(6%)', offset: 0.45 },
            { transform: 'translateX(-3%)', offset: 0.7 },
            { transform: 'translateX(0)', opacity: 0 },
          ]
        : [
            { transform: 'scale(.6)', opacity: 0 },
            { transform: 'scale(1.12)', opacity: 1, offset: 0.45 },
            { transform: 'scale(1)', opacity: 0 },
          ];
    await anim(ring, frames, { duration: kind === 'stamp' ? 700 : 520, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    ring.remove();
  }

  /** Landing ripple at a space centre. */
  ripple(i: number, color: string): void {
    if (instant()) return;
    const g = GEOM[i]!;
    const r = h('div', { class: 'land-ripple' });
    r.style.left = `${(g.cx / VB) * 100}%`;
    r.style.top = `${(g.cy / VB) * 100}%`;
    r.style.setProperty('--pc', color);
    this.overlay.append(r);
    void anim(r, [
      { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0.9 },
      { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
    ], { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' }).then(() => r.remove());
  }

  /**
   * An HTML element covering space `i` in its local frame (rotated like the SVG group), holding
   * an SVG snippet in local board units. Appended to the marks layer.
   */
  private mark(i: number, cls: string, inner: string): HTMLElement {
    const g = GEOM[i]!;
    const k = 100 / VB;
    const el = h('div', { class: `bmark ${cls}` });
    el.style.left = `${g.cx * k}%`;
    el.style.top = `${g.cy * k}%`;
    el.style.width = `${g.lw * k}%`;
    el.style.height = `${g.lh * k}%`;
    if (!g.corner && g.rot) el.style.transform = `translate(-50%, -50%) rotate(${g.rot}deg)`;
    el.innerHTML = `<svg viewBox="0 0 ${g.lw} ${g.lh}" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
    this.marks.append(el);
    return el;
  }

  /** Outline hugging the outside of a space's background card (`sp-bg`), `w` board units wide. */
  private outline(i: number, cls: string, w: number): HTMLElement {
    const g = GEOM[i]!;
    const m = 7 - w / 2;
    return this.mark(i, cls, `<rect x="${m}" y="${m}" width="${g.lw - 2 * m}" height="${g.lh - 2 * m}" rx="${(g.corner ? 34 : 24) + w / 2}"/>`);
  }

  /** Highlight a set of spaces as tappable choices; `null` clears. */
  setPicking(options: readonly number[] | null, onPick?: (i: number) => void): void {
    this.pickSet = new Set(options ?? []);
    this.pickHandler = options ? (onPick ?? null) : null;
    this.el.classList.toggle('is-picking', !!options);
    this.groups.forEach((g, i) => g.classList.toggle('is-pick', this.pickSet.has(i)));
    for (const el of this.pickEls) el.remove();
    this.pickEls = [];
    if (options) {
      for (const i of this.pickSet) this.pickEls.push(this.outline(i, 'bm-pick', 8));
      // Dim the other spaces with one board-colored veil (same result as group opacity .32,
      // without promoting 30 SVG groups to layers for the fade).
      if (!this.dimEl) {
        const veil: string[] = [];
        for (let i = 0; i < 32; i++) {
          if (this.pickSet.has(i)) continue;
          const g = GEOM[i]!;
          const tr = g.corner ? `translate(${g.x} ${g.y})` : `translate(${g.cx} ${g.cy}) rotate(${g.rot}) translate(${-g.lw / 2} ${-g.lh / 2})`;
          veil.push(`<rect transform="${tr}" width="${g.lw}" height="${g.lh}"/>`);
        }
        const dim = h('div', { class: 'bm-dim' });
        dim.innerHTML = `<svg viewBox="0 0 ${VB} ${VB}" aria-hidden="true">${veil.join('')}</svg>`;
        this.marks.prepend(dim);
        this.dimEl = dim;
        onFrame(() => {
          dim.classList.add('is-on');
          return false;
        });
      }
    } else if (this.dimEl) {
      const dim = this.dimEl;
      this.dimEl = null;
      dim.classList.remove('is-on');
      if (instant()) dim.remove();
      else dim.addEventListener('transitionend', () => dim.remove(), { once: true });
      // Safety net if no transition runs (hidden tab, reduced motion).
      gridTimeout(() => dim.remove(), 600);
    }
  }

  /** Mark one space as "selected" (e.g. the space a prompt is about). */
  setFocus(i: number | null): void {
    this.groups.forEach((g, j) => g.classList.toggle('is-focus', j === i));
    this.focusEl?.remove();
    this.focusEl = i === null ? null : this.outline(i, 'bm-focus', 9);
  }

  /** Screen centre (client px) of a space — for fx. */
  spaceClientCenter(i: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const g = GEOM[i]!;
    return { x: r.left + (g.cx / VB) * r.width, y: r.top + (g.cy / VB) * r.height };
  }

  // -------------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------------

  private renderTokens(vs: GameState): void {
    for (const p of vs.players) {
      const tk = this.tokens.get(p.id)!;
      if (!tk.moving) tk.pos = p.position;
      const hide = p.bankrupt;
      if (hide !== tk.hidden) {
        tk.hidden = hide;
        tk.root.classList.toggle('is-out', hide);
      }
    }
    this.layoutTokens(true);
  }

  private setTokenXY(tk: TokenEl, x: number, y: number): void {
    tk.x = x;
    tk.y = y;
    // Positioned with the `translate` property, not left/top: moving a token is then a transform
    // change (no repaint of the board's token layer, docs/PERFORMANCE.md).
    tk.root.style.translate = `${Math.round(x * this.k * 100) / 100}px ${Math.round(y * this.k * 100) / 100}px`;
  }

  /** Put every resting token on its slot (FLIP-animated when it shifts). */
  private layoutTokens(animate: boolean): void {
    const bySpace = new Map<number, PlayerId[]>();
    for (const [pid, tk] of this.tokens) {
      if (tk.moving || tk.hidden || tk.pos < 0) continue;
      const list = bySpace.get(tk.pos) ?? [];
      list.push(pid);
      bySpace.set(tk.pos, list);
    }
    for (const [pos, pids] of bySpace) {
      pids.sort((a, b) => a - b);
      pids.forEach((pid, slot) => {
        const tk = this.tokens.get(pid)!;
        const spot = tokenSpot(pos, slot, pids.length);
        const shared = pids.length > 1;
        if (shared !== tk.shared) {
          tk.shared = shared;
          tk.root.classList.toggle('is-shared', shared);
        }
        if (Math.abs(spot.x - tk.x) < 0.5 && Math.abs(spot.y - tk.y) < 0.5) return;
        const dx = (tk.x - spot.x) * this.k;
        const dy = (tk.y - spot.y) * this.k;
        const first = tk.x === 0 && tk.y === 0;
        this.setTokenXY(tk, spot.x, spot.y);
        if (animate && !first) {
          void anim(tk.root, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }], {
            duration: 240,
            easing: 'cubic-bezier(.22,1,.36,1)',
          });
        }
      });
    }
  }

  /** Walk a token space-by-space along `path` (hop + squash & stretch). */
  async hop(pid: PlayerId, path: readonly number[], backward = false): Promise<void> {
    const tk = this.tokens.get(pid);
    if (!tk || path.length === 0) return;
    tk.moving = true;
    tk.root.classList.add('is-moving');
    this.layoutTokens(true); // others on the start space re-centre
    // 180 ms/space for short moves; long moves hop faster (≤150 ms) so they never drag.
    const per = path.length > 6 ? Math.max(85, Math.min(150, 180 * (9 / path.length))) : 180;
    const lift = 0.95 * (this.px / 32);
    for (let n = 0; n < path.length; n++) {
      const idx = path[n]!;
      const spot = tokenSpot(idx, 0, 1);
      const dx = (tk.x - spot.x) * this.k;
      const dy = (tk.y - spot.y) * this.k;
      this.setTokenXY(tk, spot.x, spot.y);
      tk.pos = idx;
      sfx.play('hop', { pitch: backward ? 1 - n * 0.03 : 1 + n * 0.045 });
      haptic('tick');
      if (instant()) continue;
      const d = per;
      await Promise.all([
        anim(tk.root, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }], {
          duration: d,
          easing: 'cubic-bezier(.3,.6,.4,1)',
        }),
        anim(
          tk.body,
          [
            { transform: 'translateY(0) scale(1.12, .84)' },
            { transform: `translateY(${-lift}px) scale(.9, 1.12)`, offset: 0.42 },
            { transform: 'translateY(0) scale(1.14, .82)', offset: 0.84 },
            { transform: 'translateY(0) scale(1, 1)' },
          ],
          { duration: d, easing: 'linear' },
        ),
      ]);
    }
    tk.moving = false;
    tk.root.classList.remove('is-moving');
    this.layoutTokens(true);
    const p = this.players[pid];
    if (p) this.ripple(tk.pos, playerColor(p.colorId).hex);
  }

  /** Arc jump straight to a space (cards / island). */
  async jump(pid: PlayerId, to: number): Promise<void> {
    const tk = this.tokens.get(pid);
    if (!tk) return;
    tk.moving = true;
    tk.root.classList.add('is-moving');
    this.layoutTokens(true);
    const spot = tokenSpot(to, 0, 1);
    const dx = (tk.x - spot.x) * this.k;
    const dy = (tk.y - spot.y) * this.k;
    this.setTokenXY(tk, spot.x, spot.y);
    tk.pos = to;
    const lift = 4 * (this.px / 32);
    if (!instant()) {
      const frames: Keyframe[] = [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }];
      await Promise.all([
        anim(tk.root, frames, { duration: 700, easing: 'cubic-bezier(.45,.05,.55,.95)' }),
        anim(
          tk.body,
          [
            { transform: 'translateY(0) scale(1)' },
            { transform: `translateY(${-lift}px) scale(1.35)`, offset: 0.5 },
            { transform: 'translateY(0) scale(1.15, .85)', offset: 0.9 },
            { transform: 'translateY(0) scale(1)' },
          ],
          { duration: 700, easing: 'ease-in-out' },
        ),
      ]);
    }
    tk.moving = false;
    tk.root.classList.remove('is-moving');
    this.layoutTokens(true);
    const p = this.players[pid];
    if (p) this.ripple(to, playerColor(p.colorId).hex);
  }

  /** Emphasise one player's token (their turn). */
  setActiveToken(pid: PlayerId | null): void {
    for (const [id, tk] of this.tokens) tk.root.classList.toggle('is-active', id === pid);
  }

  /** px duration helper for callers that time things against a hop. */
  static hopMs(steps: number): number {
    return D(Math.max(85, 180 * Math.min(1, 9 / steps)) * steps);
  }
}

export { DEPTH };

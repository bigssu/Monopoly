/**
 * Tiny DOM helpers for the shell screens (no framework).
 *
 *   h('button', { class: 'btn', onclick: go }, ico('play'), t('title.new'))
 */
import { icon } from '@/content/icons';
import { sfx, type SfxName } from '@/ui/audio/sfx';
import { haptic, type HapticKind } from '@/ui/audio/haptics';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k.startsWith('--')) el.style.setProperty(k, String(v));
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}

/** Inline SVG icon wrapped in a `.ico` span (sized by CSS). */
export function ico(id: string, cls = ''): HTMLSpanElement {
  const span = h('span', { class: `ico ${cls}`.trim(), 'aria-hidden': 'true' });
  span.innerHTML = icon(id);
  return span;
}

export interface TapOptions {
  sound?: SfxName | null;
  haptic?: HapticKind | null;
}

/**
 * Wire a press handler with the standard feedback (tap sound + light haptic).
 * Uses `click` so keyboard activation works too.
 */
export function onTap(el: HTMLElement, fn: (ev: MouseEvent) => void, opts: TapOptions = {}): void {
  const sound = opts.sound === undefined ? 'tap' : opts.sound;
  const hk = opts.haptic === undefined ? 'light' : opts.haptic;
  el.addEventListener('click', (ev) => {
    if (el.matches(':disabled,[aria-disabled="true"]')) return;
    if (sound) sfx.play(sound);
    if (hk) haptic(hk);
    fn(ev);
  });
}

/** A `.btn` with optional leading icon. */
export function button(
  label: string,
  fn: (ev: MouseEvent) => void,
  opts: { cls?: string; icon?: string; attrs?: Attrs; sound?: SfxName | null } = {},
): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `btn ${opts.cls ?? ''}`.trim(), ...(opts.attrs ?? {}) });
  if (opts.icon) b.append(ico(opts.icon));
  if (label) b.append(h('span', { class: 'btn-label' }, label));
  onTap(b, fn, { sound: opts.sound });
  return b;
}

export function iconButton(
  iconId: string,
  label: string,
  fn: (ev: MouseEvent) => void,
  cls = 'btn-ghost',
): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `btn btn-icon ${cls}`, 'aria-label': label, title: label });
  b.append(ico(iconId));
  onTap(b, fn);
  return b;
}

/** Escape text for the rare places that build HTML strings. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

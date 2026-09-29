/**
 * Shell form widgets: segmented pills, switches, toggle chips, token avatars.
 */
import { icon } from '@/content/icons';
import { playerColor } from '@/content/palette';
import { h, ico, onTap } from './dom';

export interface SegOption<T> {
  value: T;
  label: string;
  aria?: string;
}

/** Segmented pill control. Returns the element; re-render by replacing it. */
export function segmented<T>(
  options: SegOption<T>[],
  current: T,
  onChange: (v: T) => void,
  opts: { label?: string; cls?: string } = {},
): HTMLElement {
  const root = h('div', { class: `seg ${opts.cls ?? ''}`.trim(), role: 'radiogroup', 'aria-label': opts.label });
  root.style.setProperty('--n', String(options.length));
  const idx = Math.max(0, options.findIndex((o) => o.value === current));
  root.style.setProperty('--i', String(idx));
  root.append(h('span', { class: 'seg-thumb', 'aria-hidden': 'true' }));
  options.forEach((o, i) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'seg-opt',
        role: 'radio',
        'aria-checked': String(i === idx),
        'aria-label': o.aria,
      },
      o.label,
    );
    onTap(b, () => {
      if (root.style.getPropertyValue('--i') === String(i)) return;
      root.style.setProperty('--i', String(i));
      root.querySelectorAll('.seg-opt').forEach((x, j) => x.setAttribute('aria-checked', String(j === i)));
      onChange(o.value);
    }, { haptic: 'tick' });
    root.append(b);
  });
  return root;
}

/** iOS-style switch with a 48px hit area. */
export function switcher(on: boolean, onChange: (v: boolean) => void, label: string): HTMLButtonElement {
  const b = h(
    'button',
    { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': label },
    h('span', { class: 'switch-knob' }),
  );
  onTap(b, () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(next));
    onChange(next);
  }, { haptic: 'tick' });
  return b;
}

/** Pill that toggles on/off with a check mark. */
export function toggleChip(label: string, on: boolean, onChange: (v: boolean) => void, iconId?: string): HTMLButtonElement {
  const b = h(
    'button',
    { type: 'button', class: 'tchip', 'aria-pressed': String(on) },
    h('span', { class: 'tchip-box' }, ico('check')),
    iconId ? ico(iconId, 'tchip-ico') : null,
    h('span', { class: 'tchip-label' }, label),
  );
  onTap(b, () => {
    const next = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(next));
    onChange(next);
  }, { haptic: 'tick' });
  return b;
}

/** Round token avatar tinted with a player color. */
export function tokenAvatar(tokenId: string, colorId: string, cls = ''): HTMLElement {
  const c = playerColor(colorId);
  const el = h('span', {
    class: `avatar ${cls}`.trim(),
    '--pc': c.hex,
    '--pc-dark': c.dark,
    '--pc-tint': c.tint,
    'aria-hidden': 'true',
  });
  el.innerHTML = icon(tokenId);
  return el;
}

export function colorVars(colorId: string): Record<string, string> {
  const c = playerColor(colorId);
  return { '--pc': c.hex, '--pc-dark': c.dark, '--pc-tint': c.tint };
}

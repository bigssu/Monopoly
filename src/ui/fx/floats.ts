/**
 * Orientation-free notices: the "one away" edge toast is drawn once per occupied seat,
 * each copy rotated to face that seat, so the whole table notices it (icon + color, no long text).
 */
import type { Player, Seat } from '@/engine';
import { t } from '@/i18n';
import { headless, sleep } from './time';
import { h, iconEl, SEAT_ANGLE, tokenBadge } from '@/ui/game/util';

export async function edgeToast(
  host: HTMLElement,
  seats: readonly Seat[],
  who: Player,
  iconId: string,
  color: string,
): Promise<void> {
  if (headless()) return;
  const els = seats.map((seat) => {
    const el = h(
      'div',
      { class: 'edge-toast', 'data-seat': seat },
      tokenBadge(who, 'tok-badge et-tok'),
      h('span', { class: 'et-arrow', text: '→' }),
      iconEl(iconId, 'ico et-ico'),
      h('b', { class: 'et-txt', text: t('g.oneAway') }),
    );
    el.style.setProperty('--gc', color);
    el.style.setProperty('--rot', `${SEAT_ANGLE[seat]}deg`);
    host.append(el);
    return el;
  });
  // Shown and removed without a fade: animating the four copies made four GPU layers at once
  // (plus overlap layers), the worst moment of a turn for the layer budget (docs/PERFORMANCE.md).
  await sleep(1630);
  els.forEach((el) => el.remove());
}

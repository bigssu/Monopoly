/**
 * Orientation-free notices: the "one away" edge toast is drawn once per occupied seat,
 * each copy rotated to face that seat, so the whole table notices it (icon + color, no long text).
 */
import type { Player, Seat } from '@/engine';
import { t } from '@/i18n';
import { anim, instant, sleep } from './time';
import { h, iconEl, SEAT_ANGLE, tokenBadge } from '@/ui/game/util';

export async function edgeToast(
  host: HTMLElement,
  seats: readonly Seat[],
  who: Player,
  iconId: string,
  color: string,
): Promise<void> {
  if (instant()) return;
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
  await Promise.all(
    els.map((el) =>
      anim(el, [{ opacity: 0, scale: '0.6' }, { opacity: 1, scale: '1' }], { duration: 280, easing: 'cubic-bezier(.34,1.56,.64,1)' }),
    ),
  );
  await sleep(1100);
  await Promise.all(els.map((el) => anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 250 })));
  els.forEach((el) => el.remove());
}

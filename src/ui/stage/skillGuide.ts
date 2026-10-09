/**
 * The skill throw's three-step guide (strategy mode): 누르기 → 초록에서 끌기 → 길이로 노리기. A
 * small DOM + inline-SVG illustration per step (no canvas, nothing animated): shown on the Stage
 * the first time a human rolls in a strategy game (prompts.ts, `Stage.showInfo`), from Settings
 * ("다시 보기") and as a page of the rules screen.
 */
import { t } from '@/i18n';
import { h } from '@/ui/game/util';
import { SKILL } from './skill';
import { chevron, ZONE_COLOR, zoneText } from './SkillPad';

/** A ring (circle, 0 = bottom, clockwise) with the green band at the top and the needle at `u`. */
function ringArt(u: number | null, finger: boolean): string {
  const r = 30;
  const c = 2 * Math.PI * r;
  const band = SKILL.band * c;
  // Circle path starting at the bottom, clockwise on screen.
  const d = `M 40 ${40 + r} A ${r} ${r} 0 1 1 40 ${40 - r} A ${r} ${r} 0 1 1 40 ${40 + r}`;
  const needle = u === null ? '' : `<path d="${d}" class="sg-needle" pathLength="100" stroke-dasharray="0.01 99.99" stroke-dashoffset="-${u * 100}"/><path d="${d}" class="sg-fill" pathLength="100" stroke-dasharray="${u * 100} 100"/>`;
  const die = `<rect x="27" y="27" width="26" height="26" rx="6" class="sg-die"/><circle cx="34" cy="34" r="2.6" class="sg-pip"/><circle cx="46" cy="46" r="2.6" class="sg-pip"/><circle cx="40" cy="40" r="2.6" class="sg-pip"/>`;
  const tap = finger ? `<circle cx="52" cy="54" r="7" class="sg-finger"/>` : '';
  return `<svg viewBox="0 0 80 80" aria-hidden="true"><path d="${d}" class="sg-track"/><path d="${d}" class="sg-band" pathLength="${c.toFixed(2)}" stroke-dasharray="${(2 * band).toFixed(2)} ${(c - 2 * band).toFixed(2)}" stroke-dashoffset="${(-(c / 2 - band)).toFixed(2)}"/>${needle}${die}${tap}</svg>`;
}

/** Three arrows, short / middle / long, in the zone colours. */
function zonesArt(): HTMLElement {
  const row = (zone: 'low' | 'mid' | 'high', w: number, text: string, dir: 'up' | 'down' | null): HTMLElement => {
    const el = h('div', { class: `sg-zone is-${zone}` });
    el.style.setProperty('--zc', ZONE_COLOR[zone]);
    el.append(h('i', { class: 'sg-arrow', style: `width:${w}%` }), h('span', { class: 'sg-zone-label', html: `${dir ? chevron(dir) : ''}<span></span>` }));
    el.querySelector('.sg-zone-label > span')!.textContent = text;
    return el;
  };
  return h(
    'div',
    { class: 'sg-zones' },
    row('low', 12, zoneText('low', 2), 'down'),
    row('mid', 24, zoneText('mid', 2), null),
    row('high', 36, zoneText('high', 2), 'up'),
  );
}

/** The three steps (art + title + one line), shared by the card and the rules page. */
export function skillGuideSteps(): HTMLElement {
  const step = (n: number, art: HTMLElement | string, title: string, desc: string): HTMLElement => {
    const pic = typeof art === 'string' ? h('div', { class: 'sg-art', html: art }) : h('div', { class: 'sg-art' }, art);
    return h('li', { class: 'sg-step' }, h('span', { class: 'sg-num num', text: String(n) }), pic, h('b', { class: 'sg-title', text: title }), h('p', { class: 'sg-desc', text: desc }));
  };
  return h(
    'ol',
    { class: 'sg-steps' },
    step(1, ringArt(0.2, true), t('g.skill.tut.s1'), t('g.skill.tut.s1d')),
    step(2, ringArt(0.5, false), t('g.skill.tut.s2'), t('g.skill.tut.s2d')),
    step(3, zonesArt(), t('g.skill.tut.s3'), t('g.skill.tut.s3d')),
  );
}

/** The guide as a card with an OK button (`onOk`). */
export function skillGuideCard(onOk: () => void): HTMLElement {
  const ok = h('button', { class: 'pbtn is-primary sg-ok', type: 'button', 'data-action': 'skill-guide-ok', text: t('g.skill.tut.ok') });
  ok.addEventListener('click', (e) => {
    e.stopPropagation();
    onOk();
  });
  const card = h(
    'div',
    { class: 'skill-guide', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('g.skill.tut.title'), tabindex: '-1' },
    h('div', { class: 'sg-kicker', text: t('g.skill.tut.kicker') }),
    h('h2', { class: 'sg-head', text: t('g.skill.tut.title') }),
    skillGuideSteps(),
    h('p', { class: 'sg-note', text: t('g.skill.tut.note') }),
    ok,
  );
  return card;
}

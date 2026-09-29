/** Screen shake (transform only). */
import { anim } from './time';

export function shake(el: HTMLElement, strength = 1): Promise<void> {
  const a = 7 * strength;
  return anim(
    el,
    [
      { transform: 'translate(0,0)' },
      { transform: `translate(${-a}px, ${a * 0.4}px) rotate(-.3deg)`, offset: 0.12 },
      { transform: `translate(${a}px, ${-a * 0.3}px) rotate(.3deg)`, offset: 0.28 },
      { transform: `translate(${-a * 0.6}px, ${-a * 0.4}px)`, offset: 0.46 },
      { transform: `translate(${a * 0.4}px, ${a * 0.3}px)`, offset: 0.64 },
      { transform: `translate(${-a * 0.2}px, 0)`, offset: 0.82 },
      { transform: 'translate(0,0)' },
    ],
    { duration: 480, easing: 'ease-out' },
  );
}

/**
 * Ownership presentation checks (DESIGN.md §3 "Ownership and buildings"), shared by game.spec,
 * human.spec and fixed-view.spec. Reads the live board against the engine state:
 *  - an owned space's card is filled with the owner's color, its name / price ink reads on it
 *    (computed colors, ≥ 4.5:1);
 *  - every built space has ONE pop-out building element, mostly outside its card toward the
 *    board centre, inside the board, clear of the card's name and price and of every other
 *    building, never taking taps;
 *  - unowned spaces have no building and no owner fill;
 *  - every seat panel lists exactly its player's spaces (no legend, nothing of anyone else's),
 *    and its card is only as tall as its content, flush with its box's seat (or top) edge.
 * Returns a list of problems (empty = fine) plus counts for the caller's expectations.
 */
import type { Page } from '@playwright/test';
import { PLAYER_COLORS } from '../src/content/palette';

export interface OwnedReport {
  problems: string[];
  owned: number;
  buildings: number;
}

export async function checkOwnedBoard(page: Page): Promise<OwnedReport> {
  const colors = Object.fromEntries(PLAYER_COLORS.map((c) => [c.id, c.hex]));
  return page.evaluate((colors) => {
    const problems: string[] = [];
    const s = window.__lotAndRoll!.getState()!;
    const board = document.querySelector('.game .board') as HTMLElement;
    const br = board.getBoundingClientRect();
    const inner = (document.querySelector('.board-stage-bg') as HTMLElement).getBoundingClientRect();
    const rgb = (c: string): number[] => {
      if (c.startsWith('#')) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      return c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    };
    const lum = (c: number[]): number =>
      c.map((v) => {
        const n = v / 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const ratio = (a: string, b: string): number => {
      const x = lum(rgb(a));
      const y = lum(rgb(b));
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const same = (a: string, b: string): boolean => rgb(a).every((v, i) => Math.abs(v - rgb(b)[i]!) < 1.5);
    const hit = (a: DOMRect, b: DOMRect, pad = 0): boolean =>
      a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad;
    const area = (a: DOMRect, b: DOMRect): number =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    let owned = 0;
    const blds: Array<[number, DOMRect]> = [];
    s.properties.forEach((pr, i) => {
      if (!pr) return;
      const grp = board.querySelector(`.sp[data-i="${i}"]`)!;
      const bg = grp.querySelector('.sp-bg');
      const bb = board.querySelector(`.bb[data-i="${i}"]`);
      if (pr.owner === null) {
        if (bg?.classList.contains('is-owned')) problems.push(`${i}: unowned but filled`);
        if (bb) problems.push(`${i}: unowned but has a building`);
        return;
      }
      owned++;
      const hex = colors[s.players[pr.owner]!.colorId]!;
      if (!bg || !same(getComputedStyle(bg).fill, hex)) problems.push(`${i}: card fill ${bg ? getComputedStyle(bg).fill : 'none'} ≠ owner ${hex}`);
      for (const t of grp.querySelectorAll('.sp-name, .sp-price')) {
        const fill = getComputedStyle(t).fill;
        if (ratio(fill, hex) < 4.5) problems.push(`${i}: ${t.getAttribute('class')} ${fill} on ${hex} = ${ratio(fill, hex).toFixed(2)}:1`);
      }
      const cards = board.querySelectorAll(`.bb[data-i="${i}"]`).length;
      if (pr.level < 1) {
        if (cards) problems.push(`${i}: level 0 but has a building`);
        return;
      }
      if (cards !== 1 || !bb) return void problems.push(`${i}: level ${pr.level} has ${cards} building elements`);
      const r = bb.getBoundingClientRect();
      blds.push([i, r]);
      const card = bg!.getBoundingClientRect();
      // Mostly outside its card, its centre over the inner area (toward the board centre).
      const out = 1 - area(r, card) / (r.width * r.height);
      if (out < 0.65) problems.push(`${i}: building only ${(out * 100).toFixed(0)} % outside its card`);
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < inner.left || cx > inner.right || cy < inner.top || cy > inner.bottom) problems.push(`${i}: building centre not over the inner area`);
      if (r.left < br.left - 0.5 || r.top < br.top - 0.5 || r.right > br.right + 0.5 || r.bottom > br.bottom + 0.5) problems.push(`${i}: building leaves the board`);
      // Clear of every card's name and price (live cards: owned / festival / pot ones).
      for (const t of board.querySelectorAll('.sp-name, .sp-price')) {
        if (hit(r, t.getBoundingClientRect(), 1)) problems.push(`${i}: building covers ${t.getAttribute('class')} "${t.textContent}"`);
      }
      if (getComputedStyle(bb).pointerEvents !== 'none') problems.push(`${i}: building takes taps`);
      const at = document.elementFromPoint(cx, r.top + r.height * 0.5);
      if (at && at.closest('.bb')) problems.push(`${i}: building is the tap target`);
    });
    for (let a = 0; a < blds.length; a++) {
      for (let b = a + 1; b < blds.length; b++) {
        if (hit(blds[a]![1], blds[b]![1], 0.5)) problems.push(`buildings ${blds[a]![0]} and ${blds[b]![0]} overlap`);
      }
    }
    // Layer order: ring (svg) < buildings < stage < tokens < overlay.
    const order = [...board.children].map((c) => c.classList[0]);
    const ix = (c: string): number => order.indexOf(c);
    if (!(ix('board-svg') < ix('board-bldgs') && ix('board-bldgs') < ix('stage-host') && ix('stage-host') < ix('token-layer') && ix('token-layer') < ix('board-overlay'))) {
      problems.push(`layer order ${order.join(' < ')}`);
    }
    // Seat panels (DESIGN.md §6 "Player panel"): each lists exactly its player's cities and hubs
    // (nothing for anyone else's, no legend), and its card fits its content, flush with one edge.
    for (const p of s.players) {
      const pp = document.querySelector<HTMLElement>(`.pp[data-pid="${p.id}"]`);
      if (!pp) {
        problems.push(`panel ${p.id}: missing`);
        continue;
      }
      const mine = s.properties.flatMap((pr, i) => (pr && pr.owner === p.id ? [i] : []));
      const shown = [...pp.querySelectorAll<HTMLElement>('.own')].map((c) => Number(c.dataset.i)).sort((a, b) => a - b);
      if (shown.join() !== mine.join()) problems.push(`panel ${p.id}: shows [${shown.join()}], owns [${mine.join()}]`);
      const label = pp.querySelector('.pp-owned')?.getAttribute('aria-label') ?? '';
      if (mine.length ? !label.includes(String(mine.length)) : !pp.querySelector('.pp-none')) problems.push(`panel ${p.id}: label "${label}" for ${mine.length} owned`);
      if (pp.querySelector('.pp-sets-h, .pp-sets, .slot')) problems.push(`panel ${p.id}: the old set grid / legend is back`);
      const card = pp.querySelector<HTMLElement>('.pp-card')!;
      const top = card.offsetTop;
      const below = pp.clientHeight - card.offsetTop - card.offsetHeight;
      if (top < -0.5 || below < -0.5) problems.push(`panel ${p.id}: card ${card.offsetHeight}px spills out of its ${pp.clientHeight}px box`);
      if (Math.abs(pp.classList.contains('is-top') ? top : below) > 1) problems.push(`panel ${p.id}: card not flush with its edge (${top} / ${below})`);
      const cr = card.getBoundingClientRect();
      for (const c of pp.querySelectorAll('.own')) {
        const r = c.getBoundingClientRect();
        if (r.left < cr.left - 1 || r.right > cr.right + 1 || r.top < cr.top - 1 || r.bottom > cr.bottom + 1) problems.push(`panel ${p.id}: chip ${(c as HTMLElement).dataset.i} outside the card`);
      }
    }
    return { problems, owned, buildings: blds.length };
  }, colors);
}

/** Give spaces owners and levels in the running game (hand-crafted board for the checks). */
export async function craftOwned(page: Page, own: Record<number, [owner: number, level: number]>): Promise<void> {
  await page.evaluate((own) => {
    const hook = window.__lotAndRoll!;
    const s = structuredClone(hook.getState()!);
    for (const [i, [o, l]] of Object.entries(own)) {
      if (s.properties[Number(i)]) s.properties[Number(i)] = { owner: o, level: l as never };
    }
    hook.loadState(s);
  }, own);
  await page.waitForFunction(() => !!document.querySelector('.game .board .bb'));
  await page.evaluate(() => window.__lotAndRoll!.whenIdle());
}

/**
 * A board with every building kind on every side, both neighbours of three corners built (the
 * slide rule), hubs owned, and all four player colors (the 4-player demo: red, blue, green, yellow).
 */
export const OWNED_SAMPLE: Record<number, [number, number]> = {
  1: [3, 4], 2: [3, 0], 4: [2, 2], 5: [0, 0], 6: [3, 3], 7: [1, 1],
  9: [0, 4], 10: [1, 2], 12: [2, 0], 13: [3, 0], 14: [0, 3], 15: [1, 1],
  17: [2, 2], 19: [3, 1], 20: [0, 3], 22: [1, 4],
  25: [2, 1], 26: [0, 1], 28: [2, 3], 30: [3, 2], 31: [1, 4],
};

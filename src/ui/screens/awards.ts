/**
 * Result screen awards (pure, testable): the top player per statistic, most interesting first,
 * spread so players without an award are served before anyone gets a second.
 */
import type { GameState, PlayerStats } from '@/engine';
import { fmtMoney, t } from '@/i18n';

/** Awards, most interesting first; each goes to the top player when the value is above zero. */
export const AWARDS: readonly { id: string; key: keyof PlayerStats; icon: string; money?: boolean }[] = [
  { id: 'toll', key: 'tollEarned', icon: 'coin', money: true },
  { id: 'big', key: 'biggestToll', icon: 'pot', money: true },
  { id: 'takeover', key: 'takeovers', icon: 'crown' },
  { id: 'builder', key: 'built', icon: 'building' },
  { id: 'island', key: 'islandVisits', icon: 'corner-island' },
  { id: 'doubles', key: 'doubles', icon: 'dice-face-6' },
  { id: 'cards', key: 'cards', icon: 'space-event' },
];
const MAX_AWARDS = 4;

/** Up to MAX_AWARDS awards; players who have none yet are served first so the honours spread. */
export function awardsFor(state: GameState): { id: string; icon: string; pid: number; value: string }[] {
  const st = state.stats;
  if (!st) return [];
  const all = AWARDS.flatMap((a) => {
    let pid = -1;
    let best = 0;
    st.forEach((p, i) => {
      if (p[a.key] > best) {
        best = p[a.key];
        pid = i;
      }
    });
    return pid >= 0 ? [{ id: a.id, icon: a.icon, pid, value: a.money ? fmtMoney(best) : t('r.times', { n: best }) }] : [];
  });
  const picked: typeof all = [];
  const honoured = new Set<number>();
  for (const a of all) {
    if (picked.length < MAX_AWARDS && !honoured.has(a.pid)) {
      picked.push(a);
      honoured.add(a.pid);
    }
  }
  for (const a of all) if (picked.length < MAX_AWARDS && !picked.includes(a)) picked.push(a);
  return AWARDS.map((a) => picked.find((x) => x.id === a.id)).filter((x) => x !== undefined);
}


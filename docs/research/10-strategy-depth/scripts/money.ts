import { chooseAction } from '/home/user/Monopoly/src/engine/ai';
import { createGame, reduce } from '/home/user/Monopoly/src/engine/reducer';
import { defaultPlayers, defaultSettings } from '/home/user/Monopoly/src/engine/settings';
import type { GameEvent, Settings } from '/home/user/Monopoly/src/engine/types';
const n = Number(process.argv[2] ?? 2), seeds = Number(process.argv[3] ?? 1000), rv = Number(process.argv[4] ?? 2);
const byReason: Record<string, number> = {};
let games = 0, rolls = 0, doubles = 0, extraTurnsFromDoubles = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const st: Settings = { ...defaultSettings(), players: defaultPlayers(n, { cpu: true }), roundLimit: 30, rules: 'normal', rulesVersion: rv };
  let s = createGame(st, seed); let k = 0;
  while (s.phase.kind !== 'gameOver' && k++ < 40000) {
    const res = reduce(s, chooseAction(s, s.phase.playerId));
    for (const ev of res.events as GameEvent[]) {
      if (ev.type === 'MoneyChanged' && ev.delta > 0) {
        const key = ev.reason + (typeof ev.counterpart === 'number' ? '(from player)' : '(from ' + ev.counterpart + ')');
        byReason[key] = (byReason[key] ?? 0) + ev.delta;
      }
      if (ev.type === 'DiceRolled' && ev.context === 'normal') { rolls++; if (ev.isDouble) doubles++; }
    }
    s = res.state;
  }
  games++;
}
console.log(`${n}p normal v${rv} 30r ${games} games: money received per game by source (sum over players)`);
for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${(v / games).toFixed(0)}`);
console.log(`  normal rolls/game ${(rolls / games).toFixed(1)} · doubles share ${(100 * doubles / rolls).toFixed(1)}%`);

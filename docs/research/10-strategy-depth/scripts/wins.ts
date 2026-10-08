import { chooseAction } from '/home/user/Monopoly/src/engine/ai';
import { createGame, reduce } from '/home/user/Monopoly/src/engine/reducer';
import { defaultPlayers, defaultSettings } from '/home/user/Monopoly/src/engine/settings';
import type { GameEvent, Settings } from '/home/user/Monopoly/src/engine/types';
const n = Number(process.argv[2] ?? 2), seeds = Number(process.argv[3] ?? 1000);
const tally: Record<string, number> = {};
const inc = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
let oneAway = 0, oneAwayGames = 0, games = 0, toll1000 = 0, tollMax = 0, festivalTolls = 0, bankruptByToll = 0, bankruptFestival = 0;
const tollSizes: number[] = [];
for (let seed = 1; seed <= seeds; seed++) {
  const st: Settings = { ...defaultSettings(), players: defaultPlayers(n, { cpu: true }), roundLimit: 30, rules: 'normal', rulesVersion: 2 };
  let s = createGame(st, seed);
  let lastMove: string = 'none'; let lastAcq: string = 'none'; let k = 0; let oa = 0;
  let lastToll: { amount: number; festival: boolean } | null = null;
  while (s.phase.kind !== 'gameOver' && k++ < 40000) {
    const res = reduce(s, chooseAction(s, s.phase.playerId));
    for (const ev of res.events as GameEvent[]) {
      if (ev.type === 'TokenMoved') lastMove = ev.cause;
      if (ev.type === 'PropertyBought') lastAcq = 'buy:' + lastMove;
      if (ev.type === 'TakenOver') lastAcq = 'takeover:' + lastMove;
      if (ev.type === 'CitySwapped') lastAcq = 'swap';
      if (ev.type === 'OneAway') oa++;
      if (ev.type === 'TollPaid' && !ev.waived) { tollSizes.push(ev.amount); if (ev.amount >= 1000) toll1000++; tollMax = Math.max(tollMax, ev.amount); if (ev.festival) festivalTolls++; lastToll = { amount: ev.amount, festival: ev.festival }; }
      if (ev.type === 'DebtStarted' && ev.reason === 'toll') lastToll = lastToll;
      if (ev.type === 'Bankrupt') { inc('bankruptAfter:' + (lastToll ? 'toll' : 'other')); }
      if (ev.type === 'GameOver') {
        const r = ev.result;
        if (r.victory === 'line') inc('line side ' + r.side + ' via ' + lastAcq);
        if (r.victory === 'hubs') inc('hubs via ' + lastAcq);
        if (r.victory === 'triple') inc('triple via ' + lastAcq);
        inc('victory ' + r.victory);
      }
    }
    s = res.state;
  }
  games++; oneAway += oa; if (oa > 0) oneAwayGames++;
}
tollSizes.sort((a, b) => a - b);
const q = (p: number) => tollSizes[Math.floor(p * (tollSizes.length - 1))];
console.log(`${n}p normal v2 30r, ${games} games. OneAway warnings/game ${(oneAway / games).toFixed(2)}, games with any ${(100 * oneAwayGames / games).toFixed(1)}%`);
console.log(`tolls/game ${(tollSizes.length / games).toFixed(1)} · toll p50/p90/p99/max ${q(0.5)}/${q(0.9)}/${q(0.99)}/${tollMax} · ≥1000 tolls/game ${(toll1000 / games).toFixed(2)} · festival tolls/game ${(festivalTolls / games).toFixed(2)}`);
for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k}: ${v} (${(100 * v / games).toFixed(1)}%)`);

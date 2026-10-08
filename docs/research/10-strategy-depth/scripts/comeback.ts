import { chooseAction } from '/home/user/Monopoly/src/engine/ai';
import { createGame, reduce } from '/home/user/Monopoly/src/engine/reducer';
import { totalAssets } from '/home/user/Monopoly/src/engine/rules';
import { defaultPlayers, defaultSettings } from '/home/user/Monopoly/src/engine/settings';
import type { GameEvent, Settings } from '/home/user/Monopoly/src/engine/types';
const n = Number(process.argv[2] ?? 2), seeds = Number(process.argv[3] ?? 1000);
const c: Record<string, number> = {};
const inc = (k: string, v = 1) => (c[k] = (c[k] ?? 0) + v);
let underdogGames = 0, underdogWins = 0, games = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const st: Settings = { ...defaultSettings(), players: defaultPlayers(n, { cpu: true }), roundLimit: 30, rules: 'normal', rulesVersion: 2 };
  let s = createGame(st, seed); let k = 0; const ud = new Set<number>();
  while (s.phase.kind !== 'gameOver' && k++ < 40000) {
    const before = s;
    const res = reduce(s, chooseAction(s, s.phase.playerId));
    for (const ev of res.events as GameEvent[]) {
      if (ev.type === 'CardsOffered') { inc('cardOffers'); if (ev.underdog) { inc('underdogOffers'); ud.add(ev.playerId); } if (ev.bonus) inc('bonusOffers'); }
      if (ev.type === 'CardDrawn') inc('card:' + ev.cardId);
      if (ev.type === 'NewsFlash') inc('news:' + ev.id);
      if (ev.type === 'Gambled') { inc('gambles'); if (ev.win) inc('gambleWins'); }
      if (ev.type === 'CitySwapped') inc('swaps');
      if (ev.type === 'TakenOver') {
        const a = totalAssets(before, ev.buyerId), b = totalAssets(before, ev.sellerId);
        inc(a < b ? 'takeoverByTrailing' : 'takeoverByLeading');
        if (ev.winBack) inc('winBack');
      }
      if (ev.type === 'MoneyChanged' && ev.reason === 'pot' ) { inc('potWins'); inc('potSum', ev.delta); }
    }
    s = res.state;
  }
  games++;
  if (s.phase.kind === 'gameOver') { for (const p of ud) { underdogGames++; if (s.phase.result.winnerId === p) underdogWins++; } }
}
console.log(`${n}p normal v2 30r ${games} games (per game):`);
for (const [k, v] of Object.entries(c).sort()) console.log(`  ${k}: ${(v / games).toFixed(2)}`);
console.log(`  players who got >=1 underdog offer: ${underdogGames} (per game ${(underdogGames / games).toFixed(2)}), of whom won ${(100 * underdogWins / underdogGames).toFixed(1)}%`);

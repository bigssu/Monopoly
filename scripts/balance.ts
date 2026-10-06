/**
 * Balance report: simulate many seeded 4-CPU games and print statistics.
 *
 *   npm run sim                         # 500 seeds, 4 normal CPUs, default settings
 *   npm run sim -- --seeds 200 --players 3 --rounds 30 --level easy --cash 5000 --auction --rules advanced --rules-version 1
 */
import { defaultPlayers, defaultSettings } from '../src/engine/settings';
import { simulateGame, type SimResult } from '../src/engine/sim';
import type { CpuLevel, Settings, VictoryKind } from '../src/engine/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const seeds = Number(arg('seeds') ?? 500);
const nPlayers = Number(arg('players') ?? 4);
const roundsArg = arg('rounds');
const level = (arg('level') ?? 'normal') as CpuLevel;
const firstSeed = Number(arg('from') ?? 1);

const base = defaultSettings();
const settings: Settings = {
  ...base,
  players: defaultPlayers(nPlayers, { cpu: true, cpuLevel: level }),
  startCash: Number(arg('cash') ?? base.startCash),
  roundLimit: roundsArg === 'inf' ? null : Number(roundsArg ?? base.roundLimit),
  auction: flag('auction'),
  takeover: !flag('no-takeover'),
  endOnFirstBankruptcy: !flag('elimination'),
  buildAnywhere: flag('build-anywhere'),
  rules: (arg('rules') ?? base.rules) as Settings['rules'],
  // --rules-version 1 replays the rules from before the fun rules (docs/research/08-fun-analysis.md).
  rulesVersion: Number(arg('rules-version') ?? base.rulesVersion),
};

const t0 = Date.now();
const results: SimResult[] = [];
for (let s = firstSeed; s < firstSeed + seeds; s++) results.push(simulateGame(settings, s, { checkInvariants: true }));
const ms = Date.now() - t0;

const pct = (n: number) => `${((100 * n) / results.length).toFixed(1)}%`;
const rounds = results.map((r) => r.rounds).sort((a, b) => a - b);
const median = (xs: number[]) => {
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const victories: VictoryKind[] = ['bankruptcy', 'lastStanding', 'triple', 'line', 'hubs', 'roundLimit'];
const byVictory = Object.fromEntries(victories.map((v) => [v, results.filter((r) => r.victory === v).length]));
const timedOut = results.filter((r) => r.timedOut).length;
const beforeCap = results.filter((r) => r.victory !== null && r.victory !== 'roundLimit').length;
const allBk = results.flatMap((r) => r.bankruptcies);
const earlyBk = (maxRoundExclusive: number) =>
  results.filter((r) => r.bankruptcies.some((b) => b.round < maxRoundExclusive)).length;

console.log(`Lot & Roll balance report — ${results.length} games, ${nPlayers} × ${level} CPU, rules ${settings.rules} v${settings.rulesVersion}, ` +
  `cash ${settings.startCash}, round limit ${settings.roundLimit ?? '∞'}, takeover ${settings.takeover ? 'on' : 'off'}, ` +
  `auction ${settings.auction ? 'on' : 'off'}, ${settings.endOnFirstBankruptcy ? 'first bankruptcy ends game' : 'elimination'} (${ms} ms)`);
console.log('');
console.log(`Rounds: median ${median(rounds)}, mean ${mean(rounds).toFixed(2)}, min ${rounds[0]}, max ${rounds[rounds.length - 1]}`);
console.log(`Turns (all players): mean ${mean(results.map((r) => r.turns)).toFixed(1)}`);
console.log(`Ended before the round cap: ${pct(beforeCap)}  (${beforeCap}/${results.length})`);
console.log('Victory types:');
for (const v of victories) console.log(`  ${v.padEnd(15)} ${pct(byVictory[v]!).padStart(6)}  (${byVictory[v]})`);
if (timedOut) console.log(`  TIMED OUT       ${pct(timedOut)}`);
console.log('');
console.log(`Bankruptcies: ${allBk.length} total, ${(allBk.length / results.length).toFixed(2)} per game`);
console.log(`  games with any bankruptcy:        ${pct(results.filter((r) => r.bankruptcies.length > 0).length)}`);
console.log(`  games with bankruptcy < round 5:  ${pct(earlyBk(5))}`);
console.log(`  games with bankruptcy < round 8:  ${pct(earlyBk(8))}`);
console.log('');
console.log('Per seat (turn order):');
for (let i = 0; i < nPlayers; i++) {
  const wins = results.filter((r) => r.winnerId === i).length;
  const assets = mean(results.map((r) => r.finalAssets[i]!));
  const cash = mean(results.map((r) => r.finalCash[i]!));
  const bk = allBk.filter((b) => b.playerId === i).length;
  console.log(
    `  P${i + 1} (${settings.players[i]!.seat}): wins ${pct(wins).padStart(6)}, avg final assets ${assets.toFixed(0).padStart(6)}, ` +
      `avg cash ${cash.toFixed(0).padStart(6)}, bankrupt ${pct(bk)}`,
  );
}

const TARGET_BEFORE_CAP = 0.35;
const TARGET_EARLY_BK = 0.05;
const ok1 = beforeCap / results.length >= TARGET_BEFORE_CAP;
const ok2 = earlyBk(5) / results.length < TARGET_EARLY_BK;
const ok3 = timedOut === 0;
console.log('');
console.log(`Targets: ≥35% end before cap: ${ok1 ? 'OK' : 'MISS'}; <5% bankrupt before round 5: ${ok2 ? 'OK' : 'MISS'}; no timeouts: ${ok3 ? 'OK' : 'MISS'}`);
if (flag('strict') && !(ok1 && ok2 && ok3)) process.exitCode = 1;

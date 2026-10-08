/**
 * Throwaway experiment (scratchpad only): skill expression in Money Poly.
 *   node --import tsx skill.ts <mode> [seeds]
 * mode = matchups | luck | gauge
 */
import { chooseAction } from '/home/user/Monopoly/src/engine/ai';
import { createGame, legalActions, reduce, gaugeRoll } from '/home/user/Monopoly/src/engine/reducer';
import { createRng } from '/home/user/Monopoly/src/engine/rng';
import { ranking, totalAssets, ownedCities } from '/home/user/Monopoly/src/engine/rules';
import { defaultPlayers, defaultSettings } from '/home/user/Monopoly/src/engine/settings';
import type { Action, GameState, PlayerId, Settings, CpuLevel, RuleLevel } from '/home/user/Monopoly/src/engine/types';

type Policy = 'normal' | 'easy' | 'random' | 'yes' | 'pass';

let rngState = 12345;
function rnd(): number {
  // xorshift for policy randomness (separate from engine rng)
  rngState ^= rngState << 13; rngState >>>= 0;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5; rngState >>>= 0;
  return rngState / 4294967296;
}

function act(s: GameState, pid: PlayerId, pol: Policy): Action {
  const legal = legalActions(s);
  if (pol === 'normal' || pol === 'easy') return chooseAction(s, pid);
  if (legal.length <= 1) return legal[0] ?? chooseAction(s, pid);
  if (pol === 'random') return legal[Math.floor(rnd() * legal.length)]!;
  if (pol === 'yes') return legal.find((a) => a.type !== 'Pass') ?? legal[0]!;
  // pass: decline everything optional; in debt/target etc. fall back to AI
  return legal.find((a) => a.type === 'Pass') ?? chooseAction(s, pid);
}

function settingsFor(n: number, levels: CpuLevel[], rules: RuleLevel = 'normal', rulesVersion = 2, rounds: number | null = 30): Settings {
  const players = defaultPlayers(n, { cpu: true });
  players.forEach((p, i) => (p.cpuLevel = levels[i] ?? 'normal'));
  return { ...defaultSettings(), players, roundLimit: rounds, rules, rulesVersion };
}

function playOut(s: GameState, pols: Policy[], limit = 40000): GameState {
  let k = 0;
  while (s.phase.kind !== 'gameOver' && k++ < limit) {
    const pid = s.phase.playerId;
    s = reduce(s, act(s, pid, pols[pid]!)).state;
  }
  return s;
}

function matchups(seeds: number, n: number, rules: RuleLevel, rv: number): void {
  const opps: Policy[] = ['normal', 'easy', 'random', 'yes', 'pass'];
  for (const opp of opps) {
    let wins = 0, games = 0, rounds = 0;
    const vict: Record<string, number> = {};
    const vByHero: Record<string, number> = {};
    for (let seed = 1; seed <= seeds; seed++) {
      const heroSeat = seed % n; // rotate the hero's seat
      const pols: Policy[] = Array.from({ length: n }, (_, i) => (i === heroSeat ? 'normal' : opp));
      const levels: CpuLevel[] = pols.map((p) => (p === 'easy' ? 'easy' : 'normal'));
      rngState = seed * 2654435761 >>> 0 || 1;
      const s = playOut(createGame(settingsFor(n, levels, rules, rv), seed), pols);
      if (s.phase.kind !== 'gameOver') continue;
      games++;
      rounds += s.phase.result.round;
      const v = s.phase.result.victory;
      vict[v] = (vict[v] ?? 0) + 1;
      if (s.phase.result.winnerId === heroSeat) { wins++; vByHero[v] = (vByHero[v] ?? 0) + 1; }
    }
    const fmt = (o: Record<string, number>, d: number) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / d).toFixed(1)}%`).join(', ');
    console.log(`${n}p rules ${rules} v${rv}: normal AI (1 seat, rotating) vs ${n - 1}x ${opp}: hero wins ${(100 * wins / games).toFixed(1)}% of ${games} (fair ${(100 / n).toFixed(1)}%) · mean rounds ${(rounds / games).toFixed(2)} · victories: ${fmt(vict, games)} · hero's wins by type: ${fmt(vByHero, wins)}`);
  }
}

/** Normal vs normal 2p: how well do luck-only features predict the winner? */
function luck(seeds: number, n = 2): void {
  const feats = ['tollPaid', 'tollEarned', 'salaries', 'doubles', 'cards', 'buyOffersR1to6', 'citiesAtR6', 'leaderAtR5', 'leaderAtR10', 'leaderAtR15', 'islandVisits'];
  const agree: Record<string, number> = {};
  const elig: Record<string, number> = {};
  const roundHist: Record<string, number[]> = {};
  let seat0 = 0, games = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    let s = createGame(settingsFor(n, Array(n).fill('normal')), seed);
    const f: Record<string, number[]> = Object.fromEntries(feats.map((k) => [k, Array(n).fill(0)]));
    let citiesSnap: number[] | null = null;
    let k = 0;
    while (s.phase.kind !== 'gameOver' && k++ < 40000) {
      const ph = s.phase;
      if (ph.kind === 'buy' && s.round <= 6) f.buyOffersR1to6![ph.playerId]!++;
      const res = reduce(s, chooseAction(s, ph.playerId));
      for (const ev of res.events) {
        if (ev.type === 'TollPaid' && !ev.waived) { f.tollPaid![ev.payerId]! += ev.amount; f.tollEarned![ev.ownerId]! += ev.amount; }
        if (ev.type === 'PassedStart') f.salaries![ev.playerId]!++;
        if (ev.type === 'DiceRolled' && ev.isDouble) f.doubles![ev.playerId]!++;
        if (ev.type === 'CardDrawn') f.cards![ev.playerId]!++;
        if (ev.type === 'SentToIsland') f.islandVisits![ev.playerId]!++;
        if (ev.type === 'RoundStarted' && ev.round === 7 && !citiesSnap) citiesSnap = res.state.players.map((p) => ownedCities(res.state, p.id).length);
      }
      s = res.state;
    }
    if (s.phase.kind !== 'gameOver') continue;
    games++;
    const r = s.phase.result;
    const w = r.winnerId;
    if (w === 0) seat0++;
    (roundHist[r.victory] ??= []).push(r.round);
    if (citiesSnap) f.citiesAtR6 = citiesSnap;
    const hist = s.history ?? [];
    for (const [key, rr] of [['leaderAtR5', 5], ['leaderAtR10', 10], ['leaderAtR15', 15]] as const) {
      const row = hist[rr - 1];
      if (!row) { f[key] = []; continue; }
      f[key] = row.slice();
    }
    for (const key of feats) {
      const v = f[key]!;
      if (v.length !== n) continue;
      const best = Math.max(...v), worst = Math.min(...v);
      if (best === worst) continue;
      // "lower is better" for tollPaid / islandVisits
      const lowGood = key === 'tollPaid' || key === 'islandVisits';
      const target = lowGood ? worst : best;
      if (v.filter((x) => x === target).length !== 1) continue;
      elig[key] = (elig[key] ?? 0) + 1;
      if (v.indexOf(target) === w) agree[key] = (agree[key] ?? 0) + 1;
    }
  }
  console.log(`${n}p normal-vs-normal, rules normal v2, 30 rounds, ${games} games; seat 1 wins ${(100 * seat0 / games).toFixed(1)}%`);
  for (const key of feats) {
    const lowGood = key === 'tollPaid' || key === 'islandVisits';
    console.log(`  winner is the player with the ${lowGood ? 'LOWEST' : 'HIGHEST'} ${key}: ${(100 * (agree[key] ?? 0) / (elig[key] ?? 1)).toFixed(1)}% (n=${elig[key] ?? 0})`);
  }
  for (const [v, rs] of Object.entries(roundHist)) {
    rs.sort((a, b) => a - b);
    const q = (p: number) => rs[Math.floor(p * (rs.length - 1))];
    const buckets = [0, 0, 0, 0, 0, 0];
    for (const x of rs) buckets[Math.min(5, Math.floor((x - 1) / 5))]!++;
    console.log(`  victory ${v}: ${(100 * rs.length / games).toFixed(1)}% · round p10/median/p90 ${q(0.1)}/${q(0.5)}/${q(0.9)} · by rounds 1-5/6-10/11-15/16-20/21-25/26-30: ${buckets.join('/')}`);
  }
}

function gauge(): void {
  // Exact-ish: Monte Carlo 2,000,000 rolls of gaugeRoll at full pull (high) vs plain.
  const rng = createRng(987654321);
  const N = 2_000_000;
  for (const g of [0.5, 0.75, 1.0, 0.0]) {
    let sum = 0;
    const hist = Array(13).fill(0);
    for (let i = 0; i < N; i++) {
      const first: [number, number] = [rng.int(6) + 1, rng.int(6) + 1];
      const d = gaugeRoll(rng, g, first);
      sum += d[0] + d[1];
      hist[d[0] + d[1]]++;
    }
    console.log(`gauge ${g}: mean sum ${(sum / N).toFixed(3)} · P(sum=7) ${(100 * hist[7] / N).toFixed(1)}% · P(sum>=10) ${(100 * (hist[10] + hist[11] + hist[12]) / N).toFixed(1)}% · P(sum<=4) ${(100 * (hist[2] + hist[3] + hist[4]) / N).toFixed(1)}% · dist ${hist.slice(2).map((h: number) => (100 * h / N).toFixed(1)).join(' ')}`);
  }
}

const mode = process.argv[2];
const seeds = Number(process.argv[3] ?? 1000);
const n = Number(process.argv[4] ?? 2);
const rules = (process.argv[5] ?? 'normal') as RuleLevel;
const rv = Number(process.argv[6] ?? 2);
const t0 = Date.now();
if (mode === 'matchups') matchups(seeds, n, rules, rv);
else if (mode === 'luck') luck(seeds, n);
else if (mode === 'gauge') gauge();
console.log(`(${Date.now() - t0} ms)`);
void totalAssets; void ranking;

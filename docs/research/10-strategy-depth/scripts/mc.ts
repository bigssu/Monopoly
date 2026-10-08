/**
 * Throwaway experiment (scratchpad only). Monte Carlo decision/dice impact and an MC "expert" player.
 *   node --import tsx mc.ts impact <fromSeed> <games> <K>    # normal vs normal 2p; impact of decisions vs dice
 *   node --import tsx mc.ts expert <fromSeed> <games> <K>    # MC expert (seat rotates) vs normal AI, 2p
 * Rules: normal, version 2, 30 rounds, cash 3000 (the owner's default table).
 */
import { chooseAction } from '/home/user/Monopoly/src/engine/ai';
import { createGame, legalActions, reduce, sameAction } from '/home/user/Monopoly/src/engine/reducer';
import { defaultPlayers, defaultSettings } from '/home/user/Monopoly/src/engine/settings';
import type { Action, GameState, PlayerId, Settings } from '/home/user/Monopoly/src/engine/types';

let r = 0x9e3779b9;
function rnd(): number {
  r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0;
  return r / 4294967296;
}
const u32 = () => Math.floor(rnd() * 4294967296) >>> 0;

function settings(): Settings {
  return { ...defaultSettings(), players: defaultPlayers(2, { cpu: true }), roundLimit: 30, rules: 'normal', rulesVersion: 2 };
}

function rollout(s: GameState, pid: PlayerId, rngSeed: number): number {
  s = { ...s, rng: rngSeed };
  let k = 0;
  while (s.phase.kind !== 'gameOver' && k++ < 40000) s = reduce(s, chooseAction(s, s.phase.playerId)).state;
  return s.phase.kind === 'gameOver' && s.phase.result.winnerId === pid ? 1 : 0;
}

/** Win rate for `pid` after taking `a` in `s`, over shared rollout seeds (common random numbers). */
function evalAction(s: GameState, pid: PlayerId, a: Action, seeds: number[]): number {
  const after = reduce(s, a).state;
  let w = 0;
  for (const sd of seeds) w += rollout(after, pid, sd);
  return w / seeds.length;
}

function candidates(s: GameState, pid: PlayerId): Action[] {
  const legal = legalActions(s);
  const ai = chooseAction(s, pid);
  if (legal.length <= 6) return legal;
  const rest = legal.filter((a) => !sameAction(a, ai));
  const out = [ai];
  while (out.length < 6 && rest.length) out.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]!);
  return out;
}

function sample2d6(): [number, number] {
  return [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
}

interface Acc { n: number; impact: number; big: number; aiLoss: number; aiWrong: number; noise: number; vals: number[] }
const acc: Record<string, Acc> = {};
const add = (k: string, impact: number, aiLoss: number, wrong: boolean) => {
  const a = (acc[k] ??= { n: 0, impact: 0, big: 0, aiLoss: 0, aiWrong: 0, noise: 0, vals: [] });
  a.n++; a.vals.push(Math.round(impact * 1000) / 1000); a.impact += impact; a.aiLoss += aiLoss; if (impact >= 0.1) a.big++; if (wrong) a.aiWrong++;
};

function impact(from: number, games: number, K: number): void {
  const diceSpread: number[] = [];
  const diceSd: number[] = [];
  const diceVar: number[] = [];
  const diceP: number[] = [];
  for (let seed = from; seed < from + games; seed++) {
    r = (seed * 2654435761) >>> 0 || 1;
    let s = createGame(settings(), seed);
    let preRolls = 0;
    let k = 0;
    while (s.phase.kind !== 'gameOver' && k++ < 40000) {
      const ph = s.phase;
      const pid = ph.playerId;
      const legal = legalActions(s);
      const ai = chooseAction(s, pid);
      if (legal.length >= 2 && ph.kind !== 'debt') {
        const seeds = Array.from({ length: K }, u32);
        const cands = candidates(s, pid);
        const vals = cands.map((a) => evalAction(s, pid, a, seeds));
        const best = Math.max(...vals), worst = Math.min(...vals);
        const aiVal = vals[cands.findIndex((a) => sameAction(a, ai))] ?? best;
        add(ph.kind, best - worst, best - aiVal, best - aiVal >= 0.1);
        const seeds2 = Array.from({ length: K }, u32);
        acc[ph.kind]!.noise += Math.abs(evalAction(s, pid, ai, seeds2) - aiVal);
      }
      if (ph.kind === 'preRoll' && !ph.rollAgain && (preRolls++ % 4 === 0)) {
        // Dice impact: 8 sampled 2d6 outcomes, K shared rollouts each.
        const seeds = Array.from({ length: K }, u32);
        const vals: number[] = [];
        for (let d = 0; d < 8; d++) {
          const forced: GameState = { ...s, testHooks: { diceQueue: [sample2d6()] } };
          const after = reduce(forced, { type: 'Roll', playerId: pid }).state;
          const clean: GameState = { ...after, testHooks: undefined };
          let w = 0;
          for (const sd of seeds) w += rollout(clean, pid, sd);
          vals.push(w / K);
        }
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        diceVar.push(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
        diceP.push(mean);
        diceSpread.push(Math.max(...vals) - Math.min(...vals));
        diceSd.push(Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length));
      }
      s = reduce(s, ai).state;
    }
  }
  const out = { acc, dice: { n: diceSpread.length, spread: diceSpread.reduce((a, b) => a + b, 0), sd: diceSd.reduce((a, b) => a + b, 0), big: diceSpread.filter((x) => x >= 0.1).length, diceVar, diceP, K } };
  console.log(JSON.stringify(out));
}

function expert(from: number, games: number, K: number): void {
  let wins = 0, done = 0, changed = 0, decisions = 0;
  const vict: Record<string, number> = {};
  for (let seed = from; seed < from + games; seed++) {
    r = (seed * 2654435761) >>> 0 || 1;
    const hero = seed % 2;
    let s = createGame(settings(), seed);
    let k = 0;
    while (s.phase.kind !== 'gameOver' && k++ < 40000) {
      const pid = s.phase.playerId;
      let a = chooseAction(s, pid);
      if (pid === hero && legalActions(s).length >= 2) {
        decisions++;
        const seeds = Array.from({ length: K }, u32);
        const cands = candidates(s, pid);
        let best = a, bestV = evalAction(s, pid, a, seeds);
        for (const c of cands) {
          if (sameAction(c, a)) continue;
          const v = evalAction(s, pid, c, seeds);
          if (v > bestV + 1 / K) { best = c; bestV = v; }
        }
        if (!sameAction(best, a)) changed++;
        a = best;
      }
      s = reduce(s, a).state;
    }
    if (s.phase.kind === 'gameOver') {
      done++;
      if (s.phase.result.winnerId === hero) { wins++; vict[s.phase.result.victory] = (vict[s.phase.result.victory] ?? 0) + 1; }
    }
  }
  console.log(JSON.stringify({ games: done, wins, changed, decisions, vict }));
}

const [mode, fromS, gamesS, KS] = process.argv.slice(2);
const from = Number(fromS ?? 1), games = Number(gamesS ?? 10), K = Number(KS ?? 16);
if (mode === 'impact') impact(from, games, K);
else expert(from, games, K);

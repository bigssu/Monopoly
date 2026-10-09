/**
 * Skill vs luck (docs/research/10-strategy-depth.md, docs/BALANCE.md "Rules version 3"): seeded CPU
 * games that measure how much choices decide a game. Grew out of the research-10 diagnosis scripts
 * (skill.ts, diag/{mc,wins,comeback,money}.ts). Only reads engine output; it never changes a rule
 * (except the explicit `--off` / `--set` knobs below, for ablations and tuning).
 *
 *   npm run skill -- matchups [options]   # normal AI (one seat, rotating) vs other policies
 *   npm run skill -- table [options]      # normal vs normal: length, wins, comebacks, money, takeovers
 *   npm run skill -- expert [options]     # search player (K rollouts per decision) vs the normal AI
 *
 * Options: --seeds N (1000) --from N (1) --players N (2) --rules easy|normal|advanced (advanced)
 *   --rules-version N (current) --rounds N|inf (30) --jobs N (4, parallel processes)
 *   --off flag,flag (rule flags forced off: ablation) --cap X (ECONOMY.skillCap) --set key=value,… (ECONOMY)
 *   --ai key=value,… (AI_TUNING, the version-3 CPU knobs)
 *   --policies a,b (matchups: normal,easy,yes,plain,random,pass,alt) --alt key=value,… (the alt CPU's AI_TUNING) --k N (expert rollouts, 16) --cands N (moves tried, 6) --margin N (wins over the CPU's move needed to switch, 1) --progress --json
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AI_TUNING, chooseAction, cpuAccuracy } from '../src/engine/ai';
import { ECONOMY } from '../src/engine/economy';
import { createGame, legalActions, reduce, sameAction } from '../src/engine/reducer';
import { mulberry32Step } from '../src/engine/rng';
import { totalAssets } from '../src/engine/rules';
import { FLAGS_OFF, defaultPlayers, defaultSettings, type RuleFlags } from '../src/engine/settings';
import type { Action, CpuLevel, GameEvent, GameState, PlayerId, RuleLevel, Settings } from '../src/engine/types';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const { values: args, positionals } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    seeds: { type: 'string', default: '1000' },
    from: { type: 'string', default: '1' },
    players: { type: 'string', default: '2' },
    rules: { type: 'string', default: 'advanced' },
    'rules-version': { type: 'string' },
    rounds: { type: 'string', default: '30' },
    jobs: { type: 'string', default: '4' },
    k: { type: 'string', default: '16' },
    cands: { type: 'string', default: '6' },
    margin: { type: 'string', default: '1' },
    off: { type: 'string', default: '' },
    cap: { type: 'string' },
    set: { type: 'string', default: '' },
    ai: { type: 'string', default: '' },
    policies: { type: 'string', default: 'normal,easy,yes,plain,random,pass' },
    alt: { type: 'string', default: '' },
    progress: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
const mode = positionals[0] ?? 'help';

if (mode === 'help' || args.help) {
  console.log(readHeader());
  process.exit(0);
}

const seeds = Number(args.seeds);
const from = Number(args.from);
const n = Number(args.players);
const rules = args.rules as RuleLevel;
const rv = args['rules-version'] ? Number(args['rules-version']) : undefined;
const rounds = args.rounds === 'inf' ? null : Number(args.rounds);
const jobs = Number(args.jobs);
const K = Number(args.k);
/** expert: moves tried per decision (the CPU's + random others). */
const CANDS = Number(args.cands);
/** expert: switch from the CPU's move only when another wins this many more of the K rollouts. */
const MARGIN = Number(args.margin);
for (const f of args.off.split(',').filter(Boolean)) FLAGS_OFF.add(f as keyof RuleFlags);
if (args.cap) (ECONOMY as Record<string, unknown>).skillCap = Number(args.cap);
for (const kv of args.set.split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k! in ECONOMY)) throw new Error(`unknown ECONOMY key ${k}`);
  (ECONOMY as Record<string, unknown>)[k!] = Number(v);
}

for (const kv of args.ai.split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k! in AI_TUNING)) throw new Error(`unknown AI_TUNING key ${k}`);
  (AI_TUNING as Record<string, number>)[k!] = Number(v);
}

function readHeader(): string {
  return `npm run skill -- <matchups|table|expert> [--seeds N] [--from N] [--players N] [--rules advanced] [--rules-version N]
  [--rounds 30|inf] [--jobs 4] [--off flag,flag] [--cap 0.6] [--set key=value] [--policies normal,easy,yes,plain,random,pass] [--k 16]`;
}

function settingsFor(levels: CpuLevel[]): Settings {
  const players = defaultPlayers(n, { cpu: true });
  players.forEach((p, i) => (p.cpuLevel = levels[i] ?? 'normal'));
  const base = defaultSettings();
  return { ...base, players, roundLimit: rounds, rules, rulesVersion: rv ?? base.rulesVersion };
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

/**
 * normal / easy: the shipped CPU. yes: the first non-pass legal action (buy, build, take over
 * everything; a plain two-dice roll). plain: the normal CPU that ignores the version-3 choices (a
 * plain roll, never invests, never block-buys). random: uniform over legal actions. pass: declines
 * every optional action.
 */
type Policy = 'normal' | 'easy' | 'yes' | 'plain' | 'random' | 'pass' | 'alt';

/** `alt`: the normal CPU with other AI_TUNING values (`--alt key=value,…`), to compare CPU variants. */
const ALT: Record<string, number> = {};
for (const kv of args.alt.split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  ALT[k!] = Number(v);
}

let rs = 1;
const rnd = (): number => {
  const [v, next] = mulberry32Step(rs);
  rs = next;
  return v;
};

function act(s: GameState, pid: PlayerId, pol: Policy): Action {
  if (pol === 'normal' || pol === 'easy') return chooseAction(s, pid);
  if (pol === 'alt') {
    const saved = { ...AI_TUNING };
    Object.assign(AI_TUNING, ALT);
    try {
      return chooseAction(s, pid);
    } finally {
      Object.assign(AI_TUNING, saved);
    }
  }
  if (pol === 'plain') {
    if (s.phase.kind === 'invest') return { type: 'Pass', playerId: pid };
    // Hide the block-buy from the CPU: as if it had already answered every notice.
    const blind: GameState = s.pendingWins ? { ...s, pendingWins: s.pendingWins.map((w) => ({ ...w, blocked: [...w.blocked, pid] })) } : s;
    const a = chooseAction(blind, pid);
    return a.type === 'Roll' ? { type: 'Roll', playerId: pid } : a;
  }
  const legal = legalActions(s);
  if (legal.length <= 1) return legal[0] ?? chooseAction(s, pid);
  if (pol === 'random') return legal[Math.floor(rnd() * legal.length)]!;
  if (pol === 'yes') return legal.find((a) => a.type !== 'Pass') ?? legal[0]!;
  return legal.find((a) => a.type === 'Pass') ?? chooseAction(s, pid);
}

function playOut(s: GameState, pols: Policy[], onEvents?: (ev: GameEvent[], before: GameState, after: GameState) => void): GameState {
  let k = 0;
  while (s.phase.kind !== 'gameOver' && k++ < 40000) {
    const pid = s.phase.playerId;
    const r = reduce(s, act(s, pid, pols[pid]!));
    onEvents?.(r.events, s, r.state);
    s = r.state;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Modes (each returns a JSON-able result for its seed range; `merge` adds ranges up)
// ---------------------------------------------------------------------------

type Counts = Record<string, number>;
const add = (c: Counts, k: string, v = 1) => (c[k] = (c[k] ?? 0) + v);
const mergeCounts = (a: Counts, b: Counts) => {
  for (const [k, v] of Object.entries(b)) add(a, k, v);
  return a;
};

/** matchups: per opponent policy, games / hero wins / rounds. */
function matchups(lo: number, hi: number): Counts {
  const pols = args.policies.split(',') as Policy[];
  const c: Counts = {};
  for (const opp of pols) {
    for (let seed = lo; seed < hi; seed++) {
      const hero = seed % n;
      const ps: Policy[] = Array.from({ length: n }, (_, i) => (i === hero ? 'normal' : opp));
      rs = (seed * 2654435761) >>> 0;
      const s = playOut(createGame(settingsFor(ps.map((p) => (p === 'easy' ? 'easy' : 'normal'))), seed), ps);
      if (s.phase.kind !== 'gameOver') continue;
      add(c, `${opp}:games`);
      add(c, `${opp}:rounds`, s.phase.result.round);
      if (s.phase.result.winnerId === hero) add(c, `${opp}:wins`);
      // The strong player falling behind: hero last at the start of round 10, wins anyway.
      const row = s.history?.[9];
      if (row && row.indexOf(Math.min(...row.filter((v, i) => !s.players[i]!.bankrupt || v > 0))) === hero) {
        add(c, `${opp}:heroLast10`);
        if (s.phase.result.winnerId === hero) add(c, `${opp}:heroLast10Wins`);
      }
    }
  }
  return c;
}

const SETS = new Set(['triple', 'line', 'hubs']);

/** table: normal vs normal — one record per game, summed. */
function table(lo: number, hi: number): Counts {
  const c: Counts = {};
  for (let seed = lo; seed < hi; seed++) {
    const s0 = createGame(settingsFor([]), seed);
    let leader: PlayerId | null = null;
    let lastMove = 'none';
    // How the last property changed hands (a set completed by a bankruptcy transfer is not the swap's).
    let lastAcq = 'none';
    let decisions = 0;
    let turns = 0;
    let dull = 0;
    let interesting = false;
    const tollPaid = new Array(n).fill(0) as number[];
    const t0 = Date.now();
    const s = playOut(s0, new Array(n).fill('normal') as Policy[], (evs, before, after) => {
      if (legalActions(before).length >= 2) {
        decisions++;
        interesting = true;
        add(c, `decide:${before.phase.kind}`);
      }
      for (const e of evs) {
        switch (e.type) {
          case 'TurnStarted':
            if (turns > 0 && !interesting) dull++;
            turns++;
            interesting = false;
            break;
          case 'TurnEnded': {
            const l = leaderOf(after);
            if (leader !== null && l !== leader) add(c, 'leadChanges');
            leader = l;
            break;
          }
          case 'TokenMoved':
            lastMove = e.cause;
            break;
          case 'PropertyBought':
            lastAcq = 'buy';
            break;
          case 'CitySwapped':
            lastAcq = 'swap';
            break;
          case 'PropertyTransferred':
            if (e.to !== null) lastAcq = 'transfer';
            break;
          case 'DiceRolled':
            if (e.context === 'normal') {
              add(c, 'rolls');
              if (e.stride === 1) add(c, 'rolls1');
              if (e.aim) add(c, 'rollsAimed');
              if (e.assisted) add(c, 'rollsAssisted');
              if (e.isDouble) add(c, 'doubles');
            }
            break;
          case 'TakenOver': {
            const a = totalAssets(before, e.buyerId);
            const b = totalAssets(before, e.sellerId);
            add(c, a < b ? 'takeoverTrailer' : 'takeoverLeader');
            lastAcq = e.block ? 'block' : 'takeover';
            if (e.block) add(c, 'blockBuys');
            if (e.winBack) add(c, 'winBacks');
            interesting = true;
            break;
          }
          case 'TakeoverBlocked':
            if (e.block) add(c, 'blockBuysShielded');
            break;
          case 'Built':
            if (e.via === 'invest') add(c, 'invests');
            break;
          case 'MonopolyNotice':
            add(c, 'notices');
            add(c, `noticeMove:${lastMove}`);
            add(c, `noticeBy:${lastAcq}`);
            interesting = true;
            break;
          case 'MonopolyBroken': {
            add(c, 'noticesBroken');
            const t = evs.find((x) => x.type === 'TakenOver');
            add(c, t && t.type === 'TakenOver' ? (t.block ? 'brokenByBlock' : 'brokenByTakeover') : 'brokenOther');
            break;
          }
          case 'MoneyChanged':
            if (e.delta > 0) add(c, `money:${e.reason}`, e.delta);
            if (Math.abs(e.delta) >= 200 && e.reason !== 'salary') interesting = true;
            break;
          case 'TollPaid':
            if (!e.waived) tollPaid[e.payerId]! += e.amount;
            interesting = true;
            break;
          case 'GameOver': {
            const r = e.result;
            add(c, `victory:${r.victory}`);
            if (!SETS.has(r.victory) && after.pendingWins?.length) add(c, 'noticeAtEnd');
            if (SETS.has(r.victory)) {
              add(c, 'instant');
              add(c, `instantRound:${r.round}`);
              add(c, `instantAfter:${lastMove}`);
              add(c, `instantBy:${lastAcq}`);
            }
            break;
          }
          default:
            if (['CardDrawn', 'SentToIsland', 'FestivalSet', 'Demolished', 'Bankrupt', 'OneAway', 'CitySwapped'].includes(e.type)) interesting = true;
        }
      }
    });
    if (s.phase.kind !== 'gameOver') {
      add(c, 'timedOut');
      continue;
    }
    if (!interesting) dull++;
    const r = s.phase.result;
    add(c, 'games');
    add(c, 'ms', Date.now() - t0);
    add(c, 'rounds', r.round);
    add(c, 'turns', turns);
    add(c, 'decisions', decisions);
    add(c, 'dull', dull);
    add(c, `seat${r.winnerId}`);
    // Comebacks and persistence from the asset history (start of each round).
    for (const at of [5, 10, 15]) {
      const row = s.history?.[at - 1];
      if (!row) continue;
      const max = Math.max(...row);
      if (row.filter((v) => v === max).length === 1) {
        add(c, `lead${at}`);
        if (row.indexOf(max) === r.winnerId) add(c, `lead${at}Wins`);
      }
      if (at === 10) {
        const alive = row.filter((v) => v > 0);
        const min = Math.min(...alive);
        if (alive.filter((v) => v === min).length === 1) {
          add(c, 'last10');
          if (row.indexOf(min) === r.winnerId) add(c, 'last10Wins');
        }
      }
    }
    const minToll = Math.min(...tollPaid);
    if (tollPaid.filter((v) => v === minToll).length === 1) {
      add(c, 'lessToll');
      if (tollPaid.indexOf(minToll) === r.winnerId) add(c, 'lessTollWins');
    }
  }
  return c;
}

function leaderOf(s: GameState): PlayerId | null {
  let best = -1;
  let id: PlayerId | null = null;
  for (const p of s.players) {
    if (p.bankrupt) continue;
    const a = totalAssets(s, p.id);
    if (a > best) {
      best = a;
      id = p.id;
    }
  }
  return id;
}

/** expert: at each of its decisions, try the AI's move and the alternatives with K shared rollouts. */
function expert(lo: number, hi: number): Counts {
  const c: Counts = {};
  const u32 = () => Math.floor(rnd() * 4294967296) >>> 0;
  const rollout = (s: GameState, pid: PlayerId): number => {
    let t = s;
    let k = 0;
    while (t.phase.kind !== 'gameOver' && k++ < 40000) t = reduce(t, chooseAction(t, t.phase.playerId)).state;
    return t.phase.kind === 'gameOver' && t.phase.result.winnerId === pid ? 1 : 0;
  };
  for (let seed = lo; seed < hi; seed++) {
    rs = (seed * 2654435761) >>> 0;
    const hero = seed % n;
    let s = createGame(settingsFor([]), seed);
    let k = 0;
    while (s.phase.kind !== 'gameOver' && k++ < 40000) {
      const pid = s.phase.playerId;
      let a = chooseAction(s, pid);
      const legal = legalActions(s);
      if (pid === hero && legal.length >= 2) {
        add(c, 'decisions');
        // The thrower's skill is not a choice: every candidate roll uses the CPU's own accuracy.
        const acc = cpuAccuracy(s, pid);
        let cands = legal.map((l) => (l.type === 'Roll' && (l.stride !== undefined || l.aim !== undefined) ? { ...l, accuracy: acc } : l));
        if (cands.length > CANDS) {
          const rest = cands.filter((x) => !sameAction(x, a));
          cands = [a];
          while (cands.length < CANDS && rest.length) cands.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]!);
        }
        const seedsK = Array.from({ length: K }, u32);
        // Each rollout reseeds the generator BEFORE the move: the move's own dice / draws are not
        // known in advance (reducing with the game's real seed would let the search peek at the
        // roll each stride / aim is about to get).
        const value = (x: Action) => seedsK.reduce((w, sd) => w + rollout(reduce({ ...s, rng: sd }, x).state, pid), 0) / K;
        let best = a;
        let bestV = value(a);
        for (const x of cands) {
          if (sameAction(x, a)) continue;
          const v = value(x);
          if (v > bestV + MARGIN / K) {
            best = x;
            bestV = v;
          }
        }
        if (!sameAction(best, a)) add(c, 'changed');
        a = best;
      }
      s = reduce(s, a).state;
    }
    if (s.phase.kind !== 'gameOver') continue;
    add(c, 'games');
    if (s.phase.result.winnerId === hero) add(c, 'wins');
    // Progress on stderr (the slow mode): seed, running wins / games.
    if (args.progress) process.stderr.write(`expert seed ${seed}: ${c.wins ?? 0}/${c.games}\n`);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');
const ci = (a: number, b: number) => (b ? `±${(196 * Math.sqrt((a / b) * (1 - a / b) / b)).toFixed(1)}` : '');
const per = (a: number, b: number, d = 2) => (b ? (a / b).toFixed(d) : '–');

function report(c: Counts): void {
  const label = `${n}p ${rules} v${rv ?? 'current'} ${rounds ?? '∞'}R, seeds ${from}..${from + seeds - 1}` +
    `${FLAGS_OFF.size ? `, off: ${[...FLAGS_OFF].join(',')}` : ''}${args.cap ? `, cap ${args.cap}` : ''}${args.set ? `, set ${args.set}` : ''}${args.ai ? `, ai ${args.ai}` : ''}`;
  if (mode === 'matchups') {
    console.log(`matchups — ${label} (normal AI in one rotating seat; fair ${(100 / n).toFixed(1)}%)`);
    for (const opp of args.policies.split(',')) {
      const g = c[`${opp}:games`] ?? 0;
      const w = c[`${opp}:wins`] ?? 0;
      console.log(`  vs ${opp.padEnd(6)} hero wins ${pct(w, g)} ${ci(w, g)} of ${g} · rounds ${per(c[`${opp}:rounds`] ?? 0, g)} · hero last at R10 wins ${pct(c[`${opp}:heroLast10Wins`] ?? 0, c[`${opp}:heroLast10`] ?? 0)} (n=${c[`${opp}:heroLast10`] ?? 0})`);
    }
    return;
  }
  if (mode === 'expert') {
    console.log(`expert (K=${K}, ${CANDS} moves, margin ${MARGIN}) vs normal AI — ${label}: wins ${c.wins ?? 0}/${c.games ?? 0} = ${pct(c.wins ?? 0, c.games ?? 0)} ${ci(c.wins ?? 0, c.games ?? 0)} · changed ${pct(c.changed ?? 0, c.decisions ?? 0)} of ${c.decisions ?? 0} decisions`);
    return;
  }
  const g = c.games ?? 0;
  const instRounds = Object.entries(c).filter(([k]) => k.startsWith('instantRound:')).flatMap(([k, v]) => new Array(v).fill(Number(k.split(':')[1])) as number[]).sort((a, b) => a - b);
  const q = (p: number) => (instRounds.length ? instRounds[Math.floor(p * (instRounds.length - 1))] : '–');
  const before10 = instRounds.filter((r) => r < 10).length;
  console.log(`table — ${label}: ${g} games${c.timedOut ? ` (${c.timedOut} timed out)` : ''}, ${per(c.ms ?? 0, g, 1)} ms/game`);
  console.log(`  rounds ${per(c.rounds ?? 0, g)} · turns ${per(c.turns ?? 0, g, 1)} · decisions/turn ${per(c.decisions ?? 0, c.turns ?? 0)} · dull turns ${pct(c.dull ?? 0, c.turns ?? 0)}`);
  console.log(`  victories: ${Object.entries(c).filter(([k]) => k.startsWith('victory:')).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.slice(8)} ${pct(v, g)}`).join(', ')}`);
  console.log(`  instant (set) wins ${pct(c.instant ?? 0, g)} · round min/p10/median ${instRounds[0] ?? '–'}/${q(0.1)}/${q(0.5)} · before R10 ${pct(before10, g)} of games · after a travel move ${pct(c['instantAfter:travel'] ?? 0, c.instant ?? 0)}`);
  console.log(`  notices/game ${per(c.notices ?? 0, g)} · broken ${pct(c.noticesBroken ?? 0, c.notices ?? 0)} (block-buy ${c.brokenByBlock ?? 0}, landing takeover ${c.brokenByTakeover ?? 0}, other ${c.brokenOther ?? 0}; open at game end ${c.noticeAtEnd ?? 0}) · block-buys/game ${per(c.blockBuys ?? 0, g)} (+${per(c.blockBuysShielded ?? 0, g)} shielded) · invests/game ${per(c.invests ?? 0, g)}`);
  const by = (prefix: string) => Object.entries(c).filter(([k]) => k.startsWith(prefix)).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.slice(prefix.length)} ${v}`).join(', ');
  console.log(`  set completed by — instant wins: ${by('instantBy:') || '–'} · notices: ${by('noticeBy:') || '–'} (last move: ${by('noticeMove:') || '–'})`);
  console.log(`  R10 last wins ${pct(c.last10Wins ?? 0, c.last10 ?? 0)} · leader wins R5/R10/R15 ${pct(c.lead5Wins ?? 0, c.lead5 ?? 0)}/${pct(c.lead10Wins ?? 0, c.lead10 ?? 0)}/${pct(c.lead15Wins ?? 0, c.lead15 ?? 0)} · lead changes/game ${per(c.leadChanges ?? 0, g)}`);
  console.log(`  less toll paid wins ${pct(c.lessTollWins ?? 0, c.lessToll ?? 0)} · seat wins ${Array.from({ length: n }, (_, i) => pct(c[`seat${i}`] ?? 0, g)).join(' / ')}`);
  console.log(`  takeovers/game leader ${per(c.takeoverLeader ?? 0, g)} : trailer ${per(c.takeoverTrailer ?? 0, g)} · win-backs ${per(c.winBacks ?? 0, g)}`);
  console.log(`  rolls: one die ${pct(c.rolls1 ?? 0, c.rolls ?? 0)} · aimed ${pct(c.rollsAimed ?? 0, c.rolls ?? 0)} · assisted ${pct(c.rollsAssisted ?? 0, c.rolls ?? 0)} · doubles ${pct(c.doubles ?? 0, c.rolls ?? 0)}`);
  console.log(`  money in/game: ${Object.entries(c).filter(([k]) => k.startsWith('money:')).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.slice(6)} ${per(v, g, 0)}`).join(', ')}`);
  console.log(`  decisions/game by kind: ${Object.entries(c).filter(([k]) => k.startsWith('decide:')).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.slice(7)} ${per(v, g, 1)}`).join(', ')}`);
}

// ---------------------------------------------------------------------------
// Main: split the seed range over `--jobs` processes, merge their counts
// ---------------------------------------------------------------------------

const run = mode === 'matchups' ? matchups : mode === 'table' ? table : mode === 'expert' ? expert : null;
if (!run) {
  console.error(`unknown mode ${mode}\n${readHeader()}`);
  process.exit(1);
}

if (args.json || jobs <= 1) {
  const c = run(from, from + seeds);
  if (args.json) process.stdout.write(JSON.stringify(c));
  else report(c);
} else {
  const self = fileURLToPath(import.meta.url);
  const chunk = Math.ceil(seeds / jobs);
  const parts: Array<Promise<Counts>> = [];
  for (let j = 0; j < jobs; j++) {
    const lo = from + j * chunk;
    const cnt = Math.min(chunk, from + seeds - lo);
    if (cnt <= 0) break;
    // A repeated option's last value wins, so the job's range overrides the parent's.
    const jobArgs = [...argv, '--from', String(lo), '--seeds', String(cnt), '--json'];
    parts.push(new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, self, ...jobArgs], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out) as Counts) : reject(new Error(`job ${j} exited ${code}`))));
    }));
  }
  const all = (await Promise.all(parts)).reduce((a, b) => mergeCounts(a, b), {} as Counts);
  report(all);
}

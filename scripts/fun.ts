/**
 * Fun metrics (docs/research/08-fun-analysis.md): play seeded CPU games and measure what a table
 * would feel — decisions, interaction between players, swings, comebacks, variety, dull turns.
 *
 *   npm run fun                                  # 400 seeds × players 2/3/4 × rules easy/normal/advanced, 30 rounds
 *   npm run fun -- --seeds 1000 --rounds 30 --players 4 --rules normal --detail
 *   npm run fun -- --mixed                       # normal vs easy CPUs at one table (seats alternate)
 *   npm run fun -- --rules-version 1             # the rules from before rules version 2 (the "before" tables)
 *
 * Only reads engine output (events + states); it never changes a rule.
 */
import { chooseAction } from '../src/engine/ai';
import { getBoardInfo, space } from '../src/engine/board';
import { createGame, legalActions, reduce } from '../src/engine/reducer';
import { ranking, totalAssets } from '../src/engine/rules';
import { defaultPlayers, defaultSettings } from '../src/engine/settings';
import type { CpuLevel, GameEvent, GameState, PlayerId, RuleLevel, Settings } from '../src/engine/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

if (flag('help')) {
  console.log(`npm run fun -- [--seeds 400] [--rounds 30|inf] [--players 2|3|4] [--rules easy|normal|advanced] [--detail]
  [--mixed] [--rules-version N] [--from 1]   (no --players / --rules: every combination)`);
  process.exit(0);
}

/** Book-keeping events that every turn has (not "something happened"). */
const ROUTINE = new Set<GameEvent['type']>([
  'RoundStarted', 'TurnStarted', 'TurnEnded', 'DiceRolled', 'TokenMoved', 'MoneyChanged', 'PotChanged', 'PromptOpened', 'PassedStart',
]);

/** One player acting on another (or on another's property / cash). */
export function interactionOf(ev: GameEvent): string | null {
  switch (ev.type) {
    case 'TollPaid':
      return ev.waived ? 'tollWaived' : 'toll';
    case 'TakenOver':
      return 'takeover';
    case 'TakeoverBlocked':
      return 'blocked';
    case 'Demolished':
      return ev.cause === 'typhoon' ? 'attack' : null;
    case 'MoneyChanged':
      return ev.reason === 'card' && typeof ev.counterpart === 'number' && ev.delta < 0 ? 'cardP2P' : null;
    case 'AuctionBid':
      return 'bid';
    case 'Bankrupt':
      return ev.creditorId !== null ? 'bankruptTo' : null;
    default: {
      // New rules register their interaction events here (by type name).
      const t = ev.type as string;
      if (INTERACTION_TYPES.has(t)) return t;
      return null;
    }
  }
}
/** Event types (added by later rules) that are player-vs-player by nature. */
const INTERACTION_TYPES = new Set<string>(['CitySwapped', 'BuildingStolen', 'TollMirrored', 'Bounty', 'RevengeToll', 'Blockade', 'JackpotWon', 'MonopolyBroken']);

interface GameMetrics {
  rounds: number;
  turns: number;
  decisions: number;
  forced: number;
  obvious: number;
  decisionsByKind: Record<string, number>;
  eventKinds: number;
  cardsDrawn: number;
  distinctCards: number;
  interactions: number;
  interactionsByKind: Record<string, number>;
  leadChanges: number;
  /** Leader (total assets) at the start of round 10 / 20, or null if the game ended before. */
  leaderAt: Record<number, PlayerId | null>;
  /** Last place at the start of round 10 (comeback from the bottom). */
  lastAt10: PlayerId | null;
  winner: PlayerId | null;
  firstBankruptcy: number | null;
  dullTurns: number;
  bigSwingTurns: number;
  maxSwing: number;
  swingSum: number;
  landings: Record<string, number>;
  /** Final asset spread (max − min) / mean at the end. */
  spread: number;
  winnerLevel: CpuLevel | null;
  potWins: number;
  potWon: number;
  hugeSwingTurns: number;
  mixed: boolean;
}

function leaderOf(s: GameState): PlayerId | null {
  const r = ranking(s).filter((e) => !e.bankrupt);
  return r[0]?.playerId ?? null;
}

function playMeasured(settings: Settings, seed: number): GameMetrics {
  let s = createGame(settings, seed);
  const m: GameMetrics = {
    rounds: 0, turns: 0, decisions: 0, forced: 0, obvious: 0, decisionsByKind: {}, eventKinds: 0, cardsDrawn: 0, distinctCards: 0,
    interactions: 0, interactionsByKind: {}, leadChanges: 0, leaderAt: {}, lastAt10: null, winner: null, firstBankruptcy: null,
    dullTurns: 0, bigSwingTurns: 0, maxSwing: 0, swingSum: 0, landings: {}, spread: 0, winnerLevel: null, potWins: 0, potWon: 0, hugeSwingTurns: 0,
    mixed: new Set(settings.players.map((p) => p.cpuLevel)).size > 1,
  };
  const kinds = new Set<string>();
  const cards = new Set<string>();
  const size = settings.spacesPerSide ?? 7;
  let leader = leaderOf(s);
  // Per-turn accumulators.
  let interesting = false;
  let swing = 0;
  let turnOpen = false;
  const closeTurn = () => {
    if (!turnOpen) return;
    m.turns++;
    if (!interesting) m.dullTurns++;
    m.swingSum += swing;
    m.maxSwing = Math.max(m.maxSwing, swing);
    if (swing >= 500) m.bigSwingTurns++;
    if (swing >= 1000) m.hugeSwingTurns++;
    interesting = false;
    swing = 0;
  };
  let steps = 0;
  while (s.phase.kind !== 'gameOver' && steps++ < 20000) {
    const ph = s.phase;
    const legal = legalActions(s);
    const action = chooseAction(s, ph.playerId);
    if (legal.length >= 2) {
      m.decisions++;
      m.decisionsByKind[ph.kind] = (m.decisionsByKind[ph.kind] ?? 0) + 1;
      interesting = true;
      const p = s.players[ph.playerId]!;
      const single = (ph.kind === 'festival' || ph.kind === 'freeUpgrade') && ph.options.length === 1;
      const rich = (ph.kind === 'buy' || ph.kind === 'build') && p.cash - (ph.kind === 'buy' ? ph.price : ph.cost) >= 1000;
      if (single || rich) m.obvious++;
    } else m.forced++;
    const res = reduce(s, action);
    for (const ev of res.events) {
      if (ev.type === 'TurnStarted') {
        closeTurn();
        turnOpen = true;
      }
      if (!ROUTINE.has(ev.type)) kinds.add(ev.type);
      if (ev.type === 'CardDrawn') {
        m.cardsDrawn++;
        cards.add(ev.cardId);
        interesting = true;
      }
      if (ev.type === 'TokenMoved') {
        const k = space(ev.to, size).kind;
        m.landings[k] = (m.landings[k] ?? 0) + 1;
      }
      if (ev.type === 'MoneyChanged' && ev.reason === 'pot') {
        m.potWins++;
        m.potWon += ev.delta;
      }
      if (ev.type === 'MoneyChanged' && ev.reason !== 'salary') {
        swing = Math.max(swing, Math.abs(ev.delta));
        if (Math.abs(ev.delta) >= 200) interesting = true;
      }
      const it = interactionOf(ev);
      if (it) {
        m.interactions++;
        m.interactionsByKind[it] = (m.interactionsByKind[it] ?? 0) + 1;
        interesting = true;
      }
      if (['SentToIsland', 'FestivalSet', 'TakenOver', 'Demolished', 'Bankrupt', 'OneAway', 'DoubleUpRolled'].includes(ev.type)) interesting = true;
      if (ev.type === 'Bankrupt' && m.firstBankruptcy === null) m.firstBankruptcy = ev.round;
      if (ev.type === 'TurnEnded') {
        const l = leaderOf(res.state);
        if (l !== leader && l !== null) m.leadChanges++;
        leader = l;
      }
    }
    s = res.state;
  }
  closeTurn();
  m.eventKinds = kinds.size;
  m.distinctCards = cards.size;
  m.rounds = s.round;
  if (s.phase.kind === 'gameOver') m.winner = s.phase.result.winnerId;
  const hist = s.history ?? [];
  for (const r of [10, 15, 20]) {
    const row = hist[r - 1];
    if (!row) {
      m.leaderAt[r] = null;
      continue;
    }
    let best = -1;
    let bi: PlayerId | null = null;
    row.forEach((v, i) => {
      if (v > best) {
        best = v;
        bi = i;
      }
    });
    m.leaderAt[r] = bi;
    if (r === 10) {
      let worst = Infinity;
      let wi: PlayerId | null = null;
      row.forEach((v, i) => {
        if (v > 0 && v < worst) {
          worst = v;
          wi = i;
        }
      });
      m.lastAt10 = wi;
    }
  }
  const assets = s.players.filter((p) => !p.bankrupt).map((p) => totalAssets(s, p.id));
  const mean = assets.reduce((a, b) => a + b, 0) / (assets.length || 1);
  m.spread = assets.length ? (Math.max(...assets) - Math.min(...assets)) / (mean || 1) : 0;
  if (m.winner !== null) m.winnerLevel = s.players[m.winner]!.cpuLevel;
  void getBoardInfo;
  return m;
}

export interface Summary {
  games: number;
  rounds: number;
  turns: number;
  decisionsPerGame: number;
  decisionsPerTurn: number;
  obviousShare: number;
  forcedPerTurn: number;
  eventKinds: number;
  interactionsPerGame: number;
  interactionsPerTurn: number;
  nonTollInteractions: number;
  leadChanges: number;
  comeback10: number;
  comeback20: number;
  lastToWin10: number;
  firstBankruptcy: number;
  dullShare: number;
  bigSwingShare: number;
  meanSwing: number;
  cardsPerGame: number;
  distinctCards: number;
  winRateBySeat: number[];
  byKind: Record<string, number>;
  interactionsByKind: Record<string, number>;
  landingsPerGame: Record<string, number>;
  spread: number;
  normalWinShare: number | null;
  potWinsPerGame: number;
  potMean: number;
  hugeSwingShare: number;
}

export function summarize(ms: GameMetrics[], players: number): Summary {
  const n = ms.length;
  const mean = (f: (m: GameMetrics) => number) => ms.reduce((a, m) => a + f(m), 0) / (n || 1);
  const turns = ms.reduce((a, m) => a + m.turns, 0);
  const comeback = (r: number) => {
    const eligible = ms.filter((m) => m.leaderAt[r] !== null && m.leaderAt[r] !== undefined && m.winner !== null);
    return eligible.length ? eligible.filter((m) => m.winner !== m.leaderAt[r]).length / eligible.length : NaN;
  };
  const elig10 = ms.filter((m) => m.lastAt10 !== null && m.winner !== null);
  const sumKinds = (pick: (m: GameMetrics) => Record<string, number>) => {
    const out: Record<string, number> = {};
    for (const m of ms) for (const [k, v] of Object.entries(pick(m))) out[k] = (out[k] ?? 0) + v / n;
    return out;
  };
  const byInter = sumKinds((m) => m.interactionsByKind);
  const mixed = ms.filter((m) => m.winnerLevel !== null);
  const isMixed = ms.some((m) => m.winnerLevel === 'easy') || ms.some((m) => m.mixed);
  return {
    games: n,
    rounds: mean((m) => m.rounds),
    turns: mean((m) => m.turns),
    decisionsPerGame: mean((m) => m.decisions),
    decisionsPerTurn: ms.reduce((a, m) => a + m.decisions, 0) / turns,
    obviousShare: ms.reduce((a, m) => a + m.obvious, 0) / ms.reduce((a, m) => a + m.decisions, 0),
    forcedPerTurn: ms.reduce((a, m) => a + m.forced, 0) / turns,
    eventKinds: mean((m) => m.eventKinds),
    interactionsPerGame: mean((m) => m.interactions),
    interactionsPerTurn: ms.reduce((a, m) => a + m.interactions, 0) / turns,
    nonTollInteractions: Object.entries(byInter).filter(([k]) => k !== 'toll').reduce((a, [, v]) => a + v, 0),
    leadChanges: mean((m) => m.leadChanges),
    comeback10: comeback(10),
    comeback20: comeback(20),
    lastToWin10: elig10.length ? elig10.filter((m) => m.winner === m.lastAt10).length / elig10.length : NaN,
    firstBankruptcy: (() => {
      const xs = ms.filter((m) => m.firstBankruptcy !== null);
      return xs.reduce((a, m) => a + m.firstBankruptcy!, 0) / (xs.length || 1);
    })(),
    dullShare: ms.reduce((a, m) => a + m.dullTurns, 0) / turns,
    bigSwingShare: ms.reduce((a, m) => a + m.bigSwingTurns, 0) / turns,
    meanSwing: ms.reduce((a, m) => a + m.swingSum, 0) / turns,
    cardsPerGame: mean((m) => m.cardsDrawn),
    distinctCards: mean((m) => m.distinctCards),
    winRateBySeat: Array.from({ length: players }, (_, i) => ms.filter((m) => m.winner === i).length / n),
    byKind: sumKinds((m) => m.decisionsByKind),
    interactionsByKind: byInter,
    landingsPerGame: sumKinds((m) => m.landings),
    spread: mean((m) => m.spread),
    normalWinShare: isMixed && mixed.length ? mixed.filter((m) => m.winnerLevel === 'normal').length / mixed.length : null,
    potWinsPerGame: mean((m) => m.potWins),
    potMean: ms.reduce((a, m) => a + m.potWon, 0) / Math.max(1, ms.reduce((a, m) => a + m.potWins, 0)),
    hugeSwingShare: ms.reduce((a, m) => a + m.hugeSwingTurns, 0) / turns,
  };
}

export function runConfig(opts: { players: number; rules: RuleLevel; rounds: number | null; seeds: number; from?: number; mixed?: boolean; cpuLevel?: CpuLevel; rulesVersion?: number }): Summary {
  const base = defaultSettings();
  const out: GameMetrics[] = [];
  const from = opts.from ?? 1;
  for (let seed = from; seed < from + opts.seeds; seed++) {
    const players = defaultPlayers(opts.players, { cpu: true, cpuLevel: opts.cpuLevel ?? 'normal' });
    if (opts.mixed) players.forEach((p, i) => (p.cpuLevel = (i + seed) % 2 === 0 ? 'normal' : 'easy'));
    const settings: Settings = { ...base, players, roundLimit: opts.rounds, rules: opts.rules, rulesVersion: opts.rulesVersion ?? base.rulesVersion };
    out.push(playMeasured(settings, seed));
  }
  return summarize(out, opts.players);
}

const pct = (x: number) => (Number.isNaN(x) ? '–' : `${(100 * x).toFixed(1)}%`);
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);

function printDetail(label: string, s: Summary): void {
  console.log(`\n### ${label} (${s.games} games)`);
  console.log(`rounds ${f2(s.rounds)} · turns ${f1(s.turns)} · first bankruptcy round ${f1(s.firstBankruptcy)}`);
  console.log(`decisions/game ${f1(s.decisionsPerGame)} · per turn ${f2(s.decisionsPerTurn)} · obvious ${pct(s.obviousShare)} · forced actions/turn ${f2(s.forcedPerTurn)}`);
  console.log(`decisions by kind/game: ${Object.entries(s.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f1(v)}`).join(', ')}`);
  console.log(`distinct event kinds/game ${f1(s.eventKinds)} · cards drawn/game ${f1(s.cardsPerGame)} · distinct cards/game ${f1(s.distinctCards)}`);
  console.log(`interactions/game ${f1(s.interactionsPerGame)} (non-toll ${f1(s.nonTollInteractions)}) · per turn ${f2(s.interactionsPerTurn)}`);
  console.log(`  by kind: ${Object.entries(s.interactionsByKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f2(v)}`).join(', ')}`);
  console.log(`lead changes/game ${f1(s.leadChanges)} · comeback (R10 leader loses) ${pct(s.comeback10)} · (R20) ${pct(s.comeback20)} · last at R10 wins ${pct(s.lastToWin10)}`);
  console.log(`pot wins/game ${f2(s.potWinsPerGame)} · mean pot won ${f1(s.potMean)} · turns with a ≥1000 swing ${pct(s.hugeSwingShare)}`);
  console.log(`dull turns ${pct(s.dullShare)} · turns with a ≥500 swing ${pct(s.bigSwingShare)} · mean biggest money move/turn ${f1(s.meanSwing)} · final spread ${f2(s.spread)}`);
  console.log(`landings/game: ${Object.entries(s.landingsPerGame).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f1(v)}`).join(', ')}`);
  console.log(`seat wins: ${s.winRateBySeat.map(pct).join(' / ')}${s.normalWinShare !== null ? ` · normal CPU wins ${pct(s.normalWinShare)}` : ''}`);
}

function main(): void {
  const seeds = Number(arg('seeds') ?? 400);
  const roundsArg = arg('rounds') ?? '30';
  const rounds = roundsArg === 'inf' ? null : Number(roundsArg);
  const from = Number(arg('from') ?? 1);
  const rulesVersion = arg('rules-version') ? Number(arg('rules-version')) : undefined;
  if (flag('mixed')) {
    for (const rules of ['easy', 'normal', 'advanced'] as RuleLevel[]) {
      const s = runConfig({ players: 4, rules, rounds, seeds, from, mixed: true, rulesVersion });
      console.log(`mixed 2 normal + 2 easy, rules ${rules}: normal CPUs win ${pct(s.normalWinShare ?? NaN)} (fair = 50%)`);
    }
    return;
  }
  const playersList = arg('players') ? [Number(arg('players'))] : [2, 3, 4];
  const rulesList = (arg('rules') ? [arg('rules')] : ['easy', 'normal', 'advanced']) as RuleLevel[];
  const rows: string[] = [];
  rows.push('| players | rules | rounds | decisions/turn | obvious | interactions/game (non-toll) | event kinds | lead changes | comeback R10 | last@R10 wins | dull turns | ≥500 swing turns | seat 1 wins | seat last wins |');
  rows.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  const t0 = Date.now();
  for (const players of playersList) {
    for (const rules of rulesList) {
      const s = runConfig({ players, rules, rounds, seeds, from, rulesVersion });
      if (flag('detail')) printDetail(`${players}p ${rules} ${rounds ?? '∞'} rounds`, s);
      rows.push(
        `| ${players} | ${rules} | ${f2(s.rounds)} | ${f2(s.decisionsPerTurn)} | ${pct(s.obviousShare)} | ${f1(s.interactionsPerGame)} (${f1(s.nonTollInteractions)}) | ${f1(s.eventKinds)} | ${f1(s.leadChanges)} | ${pct(s.comeback10)} | ${pct(s.lastToWin10)} | ${pct(s.dullShare)} | ${pct(s.bigSwingShare)} | ${pct(s.winRateBySeat[0]!)} | ${pct(s.winRateBySeat[players - 1]!)} |`,
      );
    }
  }
  console.log(`\nFun metrics — ${seeds} seeds per row, round limit ${rounds ?? '∞'}, rules version ${rulesVersion ?? 'current'}, all CPUs normal (${Date.now() - t0} ms)\n`);
  console.log(rows.join('\n'));
}

main();

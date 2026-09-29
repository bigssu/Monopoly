/**
 * Placeholder entry point (the UI agent replaces this).
 * Runs one seeded CPU-only game through the engine and logs a summary.
 */
import { defaultPlayers, defaultSettings, simulateGame } from '@/engine';

const settings = { ...defaultSettings(), players: defaultPlayers(4, { cpu: true }) };
const result = simulateGame(settings, 42);
const summary = {
  seed: result.seed,
  rounds: result.rounds,
  victory: result.victory,
  winner: result.winnerId === null ? null : settings.players[result.winnerId]!.name,
  bankruptcies: result.bankruptcies,
  finalAssets: result.finalAssets,
};
console.log('[Lot & Roll] simulated game', summary);

const app = document.getElementById('app');
if (app) {
  const pre = document.createElement('pre');
  pre.textContent = `Lot & Roll engine OK\n${JSON.stringify(summary, null, 2)}`;
  app.appendChild(pre);
}

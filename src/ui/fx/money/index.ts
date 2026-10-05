/**
 * Money stage (docs/MONEY-EVENTS.md §10): full-screen coin cut-ins for every purchase, payment and
 * income. Create one `MoneyStage` per game screen with a host (rect providers + board camera), then
 * call a scene per money event and await it (resolves at the 'settle' cue).
 */
export { MoneyStage, SEATS, SEAT_UP, type MoneyHost, type BoardCamera, type SpaceArt, type Rect, type StageGeom } from './stage';
export {
  transfer, purchase, build, toll, tollWaived, takeover, collectFromAll, payAll, receive, pay, bankruptcy, runScene, SCENES, CUES,
  type MoneyPlay, type MoneyCue, type Party, type Place, type End, type SceneOpts,
} from './scenes';
export { tierFor, maxTier, TIER, type Tier, type Metal } from './denom';
export { loadMoneyAtlas } from './atlas';

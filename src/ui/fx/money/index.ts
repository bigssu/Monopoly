/**
 * Money stage (docs/MONEY-EVENTS.md §10): full-screen coin cut-ins for every purchase, payment and
 * income. Create one `MoneyStage` per game screen with a host (rect providers + board camera), then
 * call a scene per money event and await it (resolves at the 'settle' cue).
 */
export { MoneyStage, type Rect } from './stage';
export {
  transfer, purchase, build, toll, tollWaived, takeover, collectFromAll, payAll, receive, pay, sell, bankruptcy,
  type MoneyPlay, type Party,
} from './scenes';

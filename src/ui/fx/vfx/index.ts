/** VFX engine public API (docs/VFX.md §3, wiring: docs/VFX-WIRING.md). */
export { createFx, backingScale, type FxHandle, type FxOptions, type FxPlay, type FxQuality, type FxStats } from './engine';
export { gameClock, ManualClock, type FxClock } from './clock';
export { createCoords, SEAT_ANGLE, SEAT_DIR, seatLocal, type CoordSource, type Coords, type RectLike } from './coords';
export { PRESETS, buildPreset, type PresetName, type PresetParams, type Anchor } from './presets';
export { TIER_CAP, t, timeline, type FxDom, type HighlightTarget, type Timeline, type Tier } from './timeline';
export { loadAtlas, type FxAtlas } from './atlas';

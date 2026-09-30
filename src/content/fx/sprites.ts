/** Every FX sprite definition (source of truth for scripts/fx/bake.mjs and the generated manifest). */
import { COLOR_SPRITES } from './sprites-color';
import { MASK_SPRITES } from './sprites-mask';
import type { SpriteDef } from './kit';

export { BAKE_DPR } from './kit';
export type { SpriteDef, FxClass } from './kit';

export const SPRITES: readonly SpriteDef[] = [...COLOR_SPRITES, ...MASK_SPRITES];

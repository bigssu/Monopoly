/**
 * Generated sound assets (docs/superpowers/specs/2026-10-04-sound-design.md): every SFX name has
 * shipped takes listed in the manifest, and every music track exists.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THROTTLE } from '../synth';
import type { SfxName } from '../sfx';
import type { TrackId } from '../music';

const PUB = join(__dirname, '..', '..', '..', '..', 'public');
const NAMES: SfxName[] = ['tap', 'dice-shake', 'dice-land', 'doubles', 'hop', 'pass-start', 'cash-in', 'cash-out', 'buy', 'build', 'landmark', 'toll', 'takeover', 'card', 'island', 'escape', 'festival', 'travel', 'warning', 'bankrupt', 'win', 'turn', 'timer-tick', 'error'];

describe('sound assets', () => {
  it('ships every SFX name with its takes', () => {
    const manifest = JSON.parse(readFileSync(join(PUB, 'sfx', 'manifest.json'), 'utf8')) as Record<string, number>;
    for (const n of NAMES) {
      const takes = manifest[n];
      expect(takes, n).toBeGreaterThan(0);
      const files = takes! > 1 ? Array.from({ length: takes! }, (_, k) => `${n}.${k + 1}.ogg`) : [`${n}.ogg`];
      for (const f of files) {
        expect(existsSync(join(PUB, 'sfx', f)), f).toBe(true);
        expect(readFileSync(join(PUB, 'sfx', f)).length, f).toBeGreaterThan(1000);
      }
    }
    expect(Object.keys(THROTTLE).every((k) => NAMES.includes(k as SfxName))).toBe(true);
  });

  it('ships every music track', () => {
    const tracks: TrackId[] = ['title', 'game', 'final', 'win'];
    for (const id of tracks) expect(readFileSync(join(PUB, 'music', `${id}.ogg`)).length, id).toBeGreaterThan(20_000);
  });
});

/**
 * Setup defaults (owner, 2026-10-06): 30 rounds and a 30 s turn timer on the setup screen; the
 * engine's own defaults stay 15 / 15 for seeded tests and the balance simulation. A store saved
 * before the change moves from the old defaults to the new ones once; other choices are kept.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@/engine';
import { defaultPrefs, migrateDefaults } from '../prefs';
import { defaultDraft } from '../setupModel';

describe('setup defaults', () => {
  it('a fresh setup offers 30 rounds and a 30 s timer', () => {
    const d = defaultDraft();
    expect(d.roundLimit).toBe(30);
    expect(d.promptTimer).toBe(30);
    expect(defaultPrefs().promptTimer).toBe(30);
  });
  it('the engine defaults are unchanged (seeded tests, simulation)', () => {
    expect(defaultSettings().roundLimit).toBe(15);
    expect(defaultSettings().promptTimer).toBe(15);
  });
  it('an old store still on 15 / 15 moves to 30 / 30 once', () => {
    const old = { ...defaultPrefs(), promptTimer: 15 as const, lastSetup: { ...defaultDraft(), roundLimit: 15, promptTimer: 15 as const } };
    const m = migrateDefaults(old, undefined);
    expect(m.promptTimer).toBe(30);
    expect(m.lastSetup?.roundLimit).toBe(30);
    expect(m.lastSetup?.promptTimer).toBe(30);
    expect(m.defaultsRev).toBe(2);
  });
  it('choices other than the old defaults are kept, and a migrated store is not touched again', () => {
    const chosen = { ...defaultPrefs(), promptTimer: 0 as const, lastSetup: { ...defaultDraft(), roundLimit: 20, promptTimer: 0 as const } };
    const m = migrateDefaults(chosen, undefined);
    expect(m.promptTimer).toBe(0);
    expect(m.lastSetup?.roundLimit).toBe(20);
    const later = { ...defaultPrefs(), promptTimer: 15 as const, lastSetup: { ...defaultDraft(), roundLimit: 15 } };
    expect(migrateDefaults(later, 2)).toBe(later);
  });
});

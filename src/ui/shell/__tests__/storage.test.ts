import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { nativePreferences } = vi.hoisted(() => ({ nativePreferences: vi.fn() }));

vi.mock('../capacitor', () => ({
  isNative: () => true,
  nativePreferences,
}));

class MemStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((r) => { resolve = r; }), resolve };
}

async function loadStorage() {
  vi.resetModules();
  return import('../storage');
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage();
  nativePreferences.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('kvHydrate', () => {
  it('keeps a deletion made while native bridge acquisition is in flight', async () => {
    const prefs = {
      get: vi.fn().mockResolvedValue({ value: 'old-save' }),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const bridge = deferred<typeof prefs>();
    nativePreferences.mockReturnValue(bridge.promise);
    const { kvGet, kvHydrate, kvRemove } = await loadStorage();

    const hydration = kvHydrate(['save']);
    kvRemove('save');
    bridge.resolve(prefs);
    await hydration;

    expect(kvGet('save')).toBeNull();
    expect(prefs.get).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer write while the native read is in flight', async () => {
    const read = deferred<{ value: string | null }>();
    const prefs = { get: vi.fn(() => read.promise), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) };
    nativePreferences.mockResolvedValue(prefs);
    const { kvGet, kvHydrate, kvSet } = await loadStorage();

    const hydration = kvHydrate(['save']);
    await vi.waitFor(() => expect(prefs.get).toHaveBeenCalledWith({ key: 'save' }));
    kvSet('save', 'newer');
    read.resolve({ value: 'older' });
    await hydration;

    expect(kvGet('save')).toBe('newer');
  });

  it('keeps a deletion made while the native read is in flight', async () => {
    const read = deferred<{ value: string | null }>();
    const prefs = { get: vi.fn(() => read.promise), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) };
    nativePreferences.mockResolvedValue(prefs);
    const { kvGet, kvHydrate, kvRemove } = await loadStorage();

    const hydration = kvHydrate(['save']);
    await vi.waitFor(() => expect(prefs.get).toHaveBeenCalledWith({ key: 'save' }));
    kvRemove('save');
    read.resolve({ value: 'old-save' });
    await hydration;

    expect(kvGet('save')).toBeNull();
  });

  it('restores an untouched missing key', async () => {
    const prefs = { get: vi.fn().mockResolvedValue({ value: 'native' }), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) };
    nativePreferences.mockResolvedValue(prefs);
    const { kvGet, kvHydrate } = await loadStorage();

    await kvHydrate(['prefs']);

    expect(kvGet('prefs')).toBe('native');
  });

  it('does not replace a local value', async () => {
    const prefs = { get: vi.fn().mockResolvedValue({ value: 'native' }), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) };
    nativePreferences.mockResolvedValue(prefs);
    const { kvGet, kvHydrate, kvSet } = await loadStorage();
    kvSet('prefs', 'local');

    await kvHydrate(['prefs']);

    expect(kvGet('prefs')).toBe('local');
    expect(prefs.get).not.toHaveBeenCalled();
  });
});

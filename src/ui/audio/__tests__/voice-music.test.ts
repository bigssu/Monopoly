/**
 * Voice and music playback with stubbed Web Audio / fetch / <audio>: superseded voice loads are
 * dropped (no line without its bubble), the cache is bounded, music never doubles a track and
 * honours the music switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearVoiceCache, installVoiceHost, playVoice, stopVoice } from '../voice';
import { installMusicHost, playMusic, resetMusic, setMusicEnabled } from '../music';

/** A deferred fetch per URL, resolved by the test. */
const fetches = new Map<string, (ok: boolean) => void>();
let started: string[] = [];

function fakeContext() {
  const param = () => ({ value: 0, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  return {
    currentTime: 0,
    decodeAudioData: async (b: ArrayBuffer) => ({ duration: 1.5, tag: new TextDecoder().decode(b) }),
    createBufferSource: () => {
      const node = {
        buffer: null as { tag: string } | null,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: () => started.push(node.buffer!.tag),
        stop: () => node.onended?.(),
      };
      return node;
    },
    createGain: () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }),
    createMediaElementSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
  };
}

beforeEach(() => {
  started = [];
  fetches.clear();
  clearVoiceCache();
  vi.stubGlobal('fetch', (url: string) =>
    new Promise((resolve) => {
      fetches.set(url, (ok) => resolve({ ok, arrayBuffer: async () => new TextEncoder().encode(url).buffer }));
    }),
  );
  const ctx = fakeContext();
  installVoiceHost({ voiceOut: () => ({ ctx: ctx as never, node: {} as never }), duck: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('voice', () => {
  it('drops a line that finishes loading after a newer one started', async () => {
    const a = playVoice('a', () => {});
    stopVoice(); // the dealer interrupts with a higher-priority line…
    const b = playVoice('b', () => {});
    fetches.get('voice/b.ogg')!(true);
    expect(await b).toBe(1500);
    fetches.get('voice/a.ogg')!(true); // …and the old line arrives late
    expect(await a).toBeNull();
    expect(started).toEqual(['voice/b.ogg']);
  });

  it('a stop cancels a line still loading', async () => {
    const a = playVoice('a', () => {});
    stopVoice();
    fetches.get('voice/a.ogg')!(true);
    expect(await a).toBeNull();
    expect(started).toEqual([]);
  });

  it('a missing file plays nothing', async () => {
    const a = playVoice('nope', () => {});
    fetches.get('voice/nope.ogg')!(false);
    expect(await a).toBeNull();
  });
});

describe('music', () => {
  let elements: Array<{ src: string; loop: boolean; paused: boolean }> = [];
  beforeEach(() => {
    elements = [];
    resetMusic();
    vi.stubGlobal(
      'Audio',
      class {
        src: string;
        loop = false;
        paused = true;
        preload = '';
        onended: (() => void) | null = null;
        constructor(src: string) {
          this.src = src;
          elements.push(this);
        }
        play() {
          this.paused = false;
          return Promise.resolve();
        }
        pause() {
          this.paused = true;
        }
        removeAttribute() {}
        load() {}
      },
    );
    vi.stubGlobal('window', { setTimeout: (fn: () => void) => fn() });
    const ctx = fakeContext();
    installMusicHost({ musicOut: () => ({ ctx: ctx as never, node: {} as never }) });
  });

  it('asking twice for the same track starts it once', async () => {
    await Promise.all([playMusic('game'), playMusic('game')]);
    expect(elements.map((e) => e.src)).toEqual(['music/game.ogg']);
    await playMusic('game');
    expect(elements).toHaveLength(1);
  });

  it('switching tracks fades the old one out', async () => {
    await playMusic('title');
    await playMusic('game');
    expect(elements.map((e) => [e.src, e.paused])).toEqual([
      ['music/title.ogg', true],
      ['music/game.ogg', false],
    ]);
  });

  it('the music switch stops it and resumes the wanted track', async () => {
    await playMusic('game');
    setMusicEnabled(false);
    expect(elements[0]!.paused).toBe(true);
    setMusicEnabled(true);
    await flush();
    expect(elements.at(-1)).toMatchObject({ src: 'music/game.ogg', paused: false });
  });
});

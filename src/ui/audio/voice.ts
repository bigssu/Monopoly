/**
 * Dealer voice playback (docs/superpowers/specs/2026-10-04-dealer-voice-design.md): lazily fetches
 * and decodes `voice/<id>.ogg` (Opus), keeps a small cache, plays one line at a time through the
 * shared audio graph (synth.ts `voiceOut`) and ducks the sound effects while it speaks.
 */
export interface VoiceHost {
  /** Shared context + output node, or null when sound is off / not unlocked yet. */
  voiceOut(): { ctx: AudioContext; node: AudioNode } | null;
  duck(on: boolean): void;
}

let host: VoiceHost | null = null;
export function installVoiceHost(h: VoiceHost): void {
  host = h;
}

/** Decoded lines kept (≈ 3 s mono each); small, the next lines load on demand. */
const CACHE_MAX = 12;
const cache = new Map<string, Promise<AudioBuffer | null>>();
let playing: AudioBufferSourceNode | null = null;
/**
 * Request generation: bumped by every play and stop. A line whose file finishes loading after a
 * newer request (or a stop) is dropped instead of cutting in without its bubble.
 */
let generation = 0;

function load(ctx: AudioContext, id: string): Promise<AudioBuffer | null> {
  let p = cache.get(id);
  if (p) {
    // LRU: most recently used last.
    cache.delete(id);
    cache.set(id, p);
    return p;
  }
  p = fetch(`voice/${id}.ogg`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => ctx.decodeAudioData(b))
    .catch(() => null);
  cache.set(id, p);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return p;
}

/** Warm the cache (e.g. advice lines for the prompt that is about to open). */
export function preloadVoice(id: string): void {
  const out = host?.voiceOut();
  if (out) void load(out.ctx, id);
}

/**
 * Play a line; resolves with its duration in ms once it has *started*, or null when it cannot
 * play (sound off, locked context, missing/undecodable file, or superseded while loading).
 * `onEnd` fires when it finishes or is stopped.
 */
export async function playVoice(id: string, onEnd: () => void): Promise<number | null> {
  const out = host?.voiceOut();
  if (!out) return null;
  const mine = ++generation;
  const buf = await load(out.ctx, id);
  if (!buf || mine !== generation) return null;
  stopSource();
  const src = out.ctx.createBufferSource();
  src.buffer = buf;
  src.connect(out.node);
  playing = src;
  host!.duck(true);
  src.onended = () => {
    if (playing === src) {
      playing = null;
      host?.duck(false);
    }
    src.disconnect();
    onEnd();
  };
  src.start();
  return Math.round(buf.duration * 1000);
}

function stopSource(): void {
  const p = playing;
  playing = null;
  if (p) {
    try {
      p.stop();
    } catch {
      /* already stopped */
    }
  }
  host?.duck(false);
}

/** Stop the current line and cancel any line still loading. */
export function stopVoice(): void {
  generation++;
  stopSource();
}

/** Tests: forget decoded buffers. */
export function clearVoiceCache(): void {
  cache.clear();
}

/**
 * Background music (docs/superpowers/specs/2026-10-04-sound-design.md): one looping track at a
 * time on the synth's music bus, crossfaded on change; off with the "배경음악" switch or sound.
 */
export type TrackId = 'title' | 'game' | 'final' | 'win';

export interface MusicHost {
  musicOut(): { ctx: AudioContext; node: AudioNode } | null;
}

const FADE_S = 1.2;
/** Music sits under the SFX and the dealer. */
const LEVEL = 0.55;

let host: MusicHost | null = null;
let enabled = true;
let wanted: TrackId | null = null;
let current: { id: TrackId; src: AudioBufferSourceNode; gain: GainNode } | null = null;
const buffers = new Map<TrackId, Promise<AudioBuffer | null>>();

export function installMusicHost(h: MusicHost): void {
  host = h;
}

function load(ctx: AudioContext, id: TrackId): Promise<AudioBuffer | null> {
  let p = buffers.get(id);
  if (!p) {
    p = fetch(`music/${id}.ogg`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(id))))
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null);
    buffers.set(id, p);
  }
  return p;
}

function fadeOut(c: AudioContext, t: { src: AudioBufferSourceNode; gain: GainNode }): void {
  t.gain.gain.cancelScheduledValues(c.currentTime);
  t.gain.gain.setTargetAtTime(0, c.currentTime, FADE_S / 3);
  t.src.stop(c.currentTime + FADE_S * 1.5);
}

/** Ask for a track (`loop` false = play once, then `after`). Re-asking the playing one is a no-op. */
export async function playMusic(id: TrackId, opts: { loop?: boolean; after?: TrackId } = {}): Promise<void> {
  wanted = id;
  const out = host?.musicOut();
  if (!out || !enabled) return;
  if (current?.id === id) return;
  const buf = await load(out.ctx, id);
  if (!buf || wanted !== id || !enabled) return;
  const c = out.ctx;
  if (current) fadeOut(c, current);
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(out.node);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = opts.loop ?? true;
  src.connect(gain);
  src.start();
  gain.gain.setTargetAtTime(LEVEL, c.currentTime, FADE_S / 3);
  const me = { id, src, gain };
  current = me;
  src.onended = () => {
    gain.disconnect();
    if (current === me) {
      current = null;
      if (opts.after) void playMusic(opts.after);
    }
  };
}

export function stopMusic(): void {
  const out = host?.musicOut();
  if (out && current) fadeOut(out.ctx, current);
  current = null;
}

/** The "배경음악" switch: off stops now; on resumes the track the app last asked for. */
export function setMusicEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopMusic();
  else if (wanted) void playMusic(wanted);
}

/** After the audio context unlocks (first gesture): start what the current screen wants. */
export function resumeMusic(): void {
  if (wanted && enabled && !current) void playMusic(wanted);
}

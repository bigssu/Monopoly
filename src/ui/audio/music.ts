/**
 * Background music (docs/superpowers/specs/2026-10-04-sound-design.md): one looping track at a
 * time, crossfaded on change, ducked with the SFX; off with the "배경음악" switch or sound.
 *
 * Tracks are streamed through an <audio> element into the synth's music bus
 * (MediaElementAudioSourceNode) instead of being decoded: four decoded tracks were ≈ 84 MB of
 * float PCM held for the whole session.
 */
export type TrackId = 'title' | 'game' | 'final' | 'win';

interface MusicHost {
  musicOut(): { ctx: AudioContext; node: AudioNode } | null;
}

const FADE_S = 1.2;
/** Music sits under the SFX and the dealer. */
const LEVEL = 0.55;

interface Playing {
  id: TrackId;
  el: HTMLAudioElement;
  gain: GainNode;
  src: MediaElementAudioSourceNode;
}

let host: MusicHost | null = null;
let enabled = true;
let wanted: { id: TrackId; loop: boolean; after?: TrackId } | null = null;
let current: Playing | null = null;
/** A track is being started (its element is buffering); a second request for it is a no-op. */
let pending: TrackId | null = null;

export function installMusicHost(h: MusicHost): void {
  host = h;
}

function fadeOut(c: AudioContext, t: Playing): void {
  t.gain.gain.cancelScheduledValues(c.currentTime);
  t.gain.gain.setTargetAtTime(0, c.currentTime, FADE_S / 3);
  window.setTimeout(() => {
    t.el.pause();
    t.el.removeAttribute('src');
    t.el.load();
    t.src.disconnect();
    t.gain.disconnect();
  }, FADE_S * 1500);
}

/** Ask for a track (`loop` false = play once, then `after`). Re-asking the playing one is a no-op. */
export async function playMusic(id: TrackId, opts: { loop?: boolean; after?: TrackId } = {}): Promise<void> {
  wanted = { id, loop: opts.loop ?? true, after: opts.after };
  const out = host?.musicOut();
  if (!out || !enabled) return;
  if (current?.id === id || pending === id) return;
  const c = out.ctx;
  const el = new Audio(`music/${id}.ogg`);
  el.loop = wanted.loop;
  el.preload = 'auto';
  const src = c.createMediaElementSource(el);
  const gain = c.createGain();
  gain.gain.value = 0;
  src.connect(gain);
  gain.connect(out.node);
  pending = id;
  const ok = await el.play().then(
    () => true,
    () => false,
  );
  if (pending === id) pending = null;
  const me: Playing = { id, el, gain, src };
  if (!ok || wanted?.id !== id || !enabled) {
    // Superseded (or blocked) while buffering: drop it quietly.
    el.pause();
    src.disconnect();
    gain.disconnect();
    return;
  }
  if (current) fadeOut(c, current);
  current = me;
  gain.gain.setTargetAtTime(LEVEL, c.currentTime, FADE_S / 3);
  const after = opts.after;
  el.onended = () => {
    if (current !== me) return;
    current = null;
    src.disconnect();
    gain.disconnect();
    if (after) void playMusic(after);
  };
}

function stopMusic(): void {
  const out = host?.musicOut();
  if (out && current) fadeOut(out.ctx, current);
  current = null;
}

/** The "배경음악" switch: off stops now; on resumes the track the app last asked for. */
export function setMusicEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopMusic();
  else if (wanted) void playMusic(wanted.id, { loop: wanted.loop, after: wanted.after });
}

/** After the audio context unlocks (first gesture): start what the current screen wants. */
export function resumeMusic(): void {
  if (wanted && enabled && !current && !pending) void playMusic(wanted.id, { loop: wanted.loop, after: wanted.after });
}

/** Tests: forget state. */
export function resetMusic(): void {
  current = null;
  pending = null;
  wanted = null;
  enabled = true;
}

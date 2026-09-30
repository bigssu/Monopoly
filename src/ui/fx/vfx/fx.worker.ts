/**
 * FX paint worker (docs/VFX.md §15): owns the pooled FX canvases (`transferControlToOffscreen`),
 * loads the atlas itself and replays the frames the engine posts (paint.ts). Painting happens as soon
 * as a frame arrives — inside the same display frame as the main thread's commit for that tick, so
 * canvas placement (a main-thread transform) and content stay in step and no extra frames are
 * presented (measured: 30 display swaps/s with a 30 Hz main-thread animation alongside).
 * Idle: no frame message → no work at all (no timers, no rAF).
 */
import { createAtlas, loadImage, type FxAtlas } from './atlas';
import { paintFrame, SlotPainter, type FromWorker, type ToWorker } from './paint';
import type { FxAtlasJson } from '@/content/fx/types';

const scope = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null; postMessage(m: FromWorker, t?: Transferable[]): void };
let atlas: FxAtlas | null = null;
let software = true;
let painters: SlotPainter[] = [];
const tints: string[] = [''];

scope.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') {
    software = m.software;
    void (async () => {
      try {
        const res = await fetch(m.urls.json);
        if (!res.ok) throw new Error(`atlas.json ${res.status}`);
        const json = (await res.json()) as FxAtlasJson;
        const [color, mask] = await Promise.all([loadImage(m.urls.color), loadImage(m.urls.mask)]);
        atlas = createAtlas(json, { color, mask });
        scope.postMessage({ t: 'ready' });
      } catch (err) {
        scope.postMessage({ t: 'failed', error: String(err) });
      }
    })();
    return;
  }
  if (m.t === 'canvases') {
    painters = m.canvases.map((c) => {
      const ctx = c.getContext('2d', { alpha: true, willReadFrequently: software });
      return new SlotPainter({ canvas: c, ctx: ctx! });
    });
    return;
  }
  if (m.t === 'frame') {
    if (m.tints) for (let i = 0; i < m.tints.add.length; i++) tints[m.tints.first + i] = m.tints.add[i]!;
    if (atlas) paintFrame(atlas, painters, m.states, m.list, m.boxes, m.n, tints);
    scope.postMessage({ t: 'buffers', states: m.states, list: m.list, boxes: m.boxes }, [m.states.buffer, m.list.buffer, m.boxes.buffer]);
  }
};

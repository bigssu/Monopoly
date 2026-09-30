/** Test fixtures: a fake 960 px board with four seat panels (no DOM). */
import type { PlayerId, Seat } from '@/engine';
import { GEOM, VB } from '@/ui/board/geometry';
import { createCoords, type CoordSource, type RectLike } from '../coords';
import type { PresetEnv } from '../presets';

export const SEATS: Seat[] = ['S', 'E', 'N', 'W'];
export const COLORS = ['#E8564F', '#4A6CF7', '#3DBB6E', '#F2B633'];

export function fakeSource(board = 960, ox = 320, oy = 40, layer: RectLike = { x: 0, y: 0, width: 1600, height: 1000 }): CoordSource {
  const k = board / VB;
  const panels: Record<Seat, RectLike> = {
    S: { x: ox + board * 0.25, y: oy + board + 10, width: board * 0.5, height: 80 },
    N: { x: ox + board * 0.25, y: oy - 90, width: board * 0.5, height: 80 },
    E: { x: ox + board + 10, y: oy + board * 0.25, width: 80, height: board * 0.5 },
    W: { x: ox - 90, y: oy + board * 0.25, width: 80, height: board * 0.5 },
  };
  return {
    getLayerRect: () => layer,
    getBoardRect: () => ({ x: ox, y: oy, width: board, height: board }),
    getSpaceRect: (i) => {
      const g = GEOM[i]!;
      return { x: ox + g.x * k, y: oy + g.y * k, width: g.w * k, height: g.h * k };
    },
    getPanelRect: (id: PlayerId) => panels[SEATS[id]!],
    getSeat: (id: PlayerId) => SEATS[id]!,
  };
}

export function fakeEnv(): PresetEnv {
  return { c: createCoords(fakeSource()), color: (id) => COLORS[id]! };
}

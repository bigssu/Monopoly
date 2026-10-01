import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const drawImage = vi.fn();
let holdDecodes = false;
let decodeResolvers: Array<() => void> = [];

function installRasterMocks(): void {
  let objectUrl = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (done: BlobCallback) => done(new Blob(['png'], { type: 'image/png' })),
  };
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  vi.stubGlobal('Image', class {
    decoding = '';
    src = '';
    decode(): Promise<void> {
      if (holdDecodes) return new Promise((resolve) => decodeResolvers.push(resolve));
      return Promise.resolve();
    }
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:atlas-${++objectUrl}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
}

describe('icon atlas queue', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    holdDecodes = false;
    decodeResolvers = [];
    installRasterMocks();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('rasterizes concurrent identical requests once', async () => {
    const { atlasSvg, prepareIconAtlas } = await import('../iconAtlas');
    await Promise.all([
      prepareIconAtlas([{ id: 'city-manila' }], 64),
      prepareIconAtlas([{ id: 'city-manila' }], 64),
    ]);

    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(atlasSvg('city-manila', 0, 0, 10, 'icon')!.def).toContain('width="512" height="512"');
  });

  it('keeps concurrent requests together at their largest cell size', async () => {
    const { iconAtlasInfo, prepareIconAtlas } = await import('../iconAtlas');
    await Promise.all([
      prepareIconAtlas([{ id: 'city-manila' }], 48),
      prepareIconAtlas([{ id: 'city-hanoi' }], 96),
    ]);

    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(iconAtlasInfo()).toMatchObject({ cell: 96, icons: 2 });
  });

  it('caps a full atlas at 1024px without rebuilding the same capped request', async () => {
    const [{ ICON_IDS }, { iconAtlasInfo, prepareIconAtlas }] = await Promise.all([
      import('@/content/icons'),
      import('../iconAtlas'),
    ]);
    const entries = ICON_IDS.map((id) => ({ id, tint: '#fff' }));
    await prepareIconAtlas(entries, 256);
    const info = iconAtlasInfo()!;

    expect([512, 1024]).toContain(info.width);
    expect([512, 1024]).toContain(info.height);
    expect(info.width).toBeLessThanOrEqual(1024);
    expect(info.height).toBeLessThanOrEqual(1024);
    await prepareIconAtlas(entries, 256);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('releases a retired game atlas without affecting the next game', async () => {
    const { disposeIconAtlas, iconAtlasInfo, prepareIconAtlas } = await import('../iconAtlas');
    await prepareIconAtlas([{ id: 'city-manila' }], 64);
    disposeIconAtlas();
    await Promise.resolve();
    await prepareIconAtlas([{ id: 'city-hanoi' }], 64);

    expect(iconAtlasInfo()).toMatchObject({ icons: 1 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:atlas-2');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:atlas-4');
  });

  it('cannot publish an atlas after its game is disposed mid-decode', async () => {
    const { disposeIconAtlas, iconAtlasInfo, prepareIconAtlas } = await import('../iconAtlas');
    holdDecodes = true;
    const build = prepareIconAtlas([{ id: 'city-manila' }], 64);
    await vi.waitFor(() => expect(decodeResolvers).toHaveLength(1));
    decodeResolvers.shift()!();
    await vi.waitFor(() => expect(decodeResolvers).toHaveLength(1));
    disposeIconAtlas();
    decodeResolvers.shift()!();
    await build;

    expect(iconAtlasInfo()).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:atlas-2');
  });
});

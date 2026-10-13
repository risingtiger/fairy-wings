import type { TextureBinding } from '../render/sprite-renderer';

/** Shape of the JSON written by tools/sprites/align-sheet.mjs and pack-sheet.mjs. */
interface SheetJson {
  image: string;
  cell: { w: number; h: number };
  pivot: { x: number; y: number };
  frames: Record<string, { x: number; y: number; w: number; h: number; head: [number, number]; sockets?: Record<string, [number, number]>; size?: [number, number] }>;
  animations: Record<string, { frames: string[]; fps?: number; loop?: boolean }>;
}

export interface SheetFrame {
  readonly name: string;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  /** Head centre relative to the pivot, in sheet pixels. */
  readonly head: readonly [number, number];
  /** Named attachment points relative to the pivot, in sheet pixels (e.g. a wand tip). */
  readonly sockets: Readonly<Record<string, readonly [number, number]>>;
  /** Width and height of the drawing itself (not the cell), in sheet pixels, when the sheet records it. */
  readonly size: readonly [number, number];
}

export interface Clip {
  readonly name: string;
  readonly frames: readonly number[];
  readonly fps: number;
  readonly loop: boolean;
}

/** A uniform-cell sprite sheet: every frame shares one cell size and one pivot. */
export class SpriteSheet {
  readonly frames: SheetFrame[] = [];
  readonly clips = new Map<string, Clip>();
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** Pivot as a fraction of the cell (feed straight into Quad.originX/Y). */
  readonly originX: number;
  readonly originY: number;
  private readonly frameIndex = new Map<string, number>();

  constructor(readonly binding: TextureBinding, json: SheetJson) {
    const { width, height } = binding.texture;
    this.cellWidth = json.cell.w;
    this.cellHeight = json.cell.h;
    this.originX = json.pivot.x / json.cell.w;
    this.originY = json.pivot.y / json.cell.h;
    for (const [name, f] of Object.entries(json.frames)) {
      this.frameIndex.set(name, this.frames.length);
      this.frames.push({
        name,
        u0: f.x / width, v0: f.y / height, u1: (f.x + f.w) / width, v1: (f.y + f.h) / height,
        head: f.head,
        sockets: f.sockets ?? {},
        size: f.size ?? [f.w, f.h],
      });
    }
    for (const [name, a] of Object.entries(json.animations)) {
      this.clips.set(name, { name, frames: a.frames.map((n) => this.frame(n)), fps: a.fps ?? 1, loop: a.loop ?? false });
    }
  }

  static async load(url: string, bindImage: (imageUrl: string) => Promise<TextureBinding>): Promise<SpriteSheet> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
    const json = (await response.json()) as SheetJson;
    const binding = await bindImage(new URL(json.image, new URL(url, location.href)).pathname);
    return new SpriteSheet(binding, json);
  }

  frame(name: string): number {
    const i = this.frameIndex.get(name);
    if (i === undefined) throw new Error(`Unknown frame "${name}"`);
    return i;
  }

  clip(name: string): Clip {
    const c = this.clips.get(name);
    if (!c) throw new Error(`Unknown animation "${name}"`);
    return c;
  }
}

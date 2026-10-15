import { besides, fetchJson } from '../core/fetch';
import type { TextureBinding } from '../render/sprite-renderer';

/** Shape of the JSON written by tools/sprites/align-sheet.mjs and pack-sheet.mjs. */
interface SheetJson {
  image: string;
  cell: { w: number; h: number };
  pivot: { x: number; y: number };
  frames: Record<string, { x: number; y: number; w: number; h: number; head: [number, number]; sockets?: Record<string, [number, number]> }>;
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
      });
    }
    for (const [name, a] of Object.entries(json.animations)) {
      this.clips.set(name, { name, frames: a.frames.map((n) => this.frame(n)), fps: a.fps ?? 1, loop: a.loop ?? false });
    }
  }

  static async load(url: string, bindImage: (imageUrl: string) => Promise<TextureBinding>): Promise<SpriteSheet> {
    const json = await fetchJson<SheetJson>(url);
    return new SpriteSheet(await bindImage(besides(url, json.image)), json);
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

  /** A named attachment point on a frame (sheet pixels from the pivot), or `fallback` if it has none. */
  socket(frame: number, name: string, fallback: readonly [number, number] = [0, 0]): readonly [number, number] {
    return this.frames[frame].sockets[name] ?? fallback;
  }
}

/** Plays one clip at a time. `rate` lets movement speed drive playback so feet don't skate. */
export class Animator {
  clip: Clip | null = null;
  time = 0;
  index = 0;
  finished = false;

  play(clip: Clip, restart = false): void {
    if (clip === this.clip && !restart) return;
    this.clip = clip;
    this.time = 0;
    this.index = 0;
    this.finished = false;
  }

  update(dt: number, rate = 1): void {
    const clip = this.clip;
    if (!clip) return;
    this.time += dt * rate;
    const n = clip.frames.length, step = Math.floor(this.time * clip.fps);
    this.index = clip.loop ? step % n : Math.min(step, n - 1);
    this.finished = !clip.loop && step >= n;
  }

  /** Sheet frame index currently showing. */
  get frame(): number {
    return this.clip ? this.clip.frames[this.index] : 0;
  }
}

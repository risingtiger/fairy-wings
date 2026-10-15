import type { SpriteSheet } from '../anim/sprite-sheet';
import type { Gpu } from '../gpu/device';
import { createWhiteTexture, type Texture } from '../gpu/texture';
import { WHITE } from './color';
import { SPRITE_SHADER } from './sprite-shader';

export const Blend = { Alpha: 0, Additive: 1 } as const;
export type Blend = (typeof Blend)[keyof typeof Blend];

/** Procedural shapes drawn by fs_shape (see sprite-shader.ts); each takes one parameter. */
export const Shape = { Glow: 0, Sparkle: 1, Ring: 2, Crescent: 3, Orb: 4, Disc: 5, Beam: 6, Heart: 7, Box: 8, Star: 9 } as const;
export type Shape = (typeof Shape)[keyof typeof Shape];

/** Scratch description of one quad: reset, fill, then draw. Reused to avoid per-sprite allocation. */
export class Quad {
  x = 0; y = 0; w = 0; h = 0;
  u0 = 0; v0 = 0; u1 = 1; v1 = 1;
  originX = 0.5; originY = 0.5;
  rotation = 0; skew = 0; saturation = 1; flash = 0;
  color = WHITE;
  fog = 0;
  /** Soft fade at the top / bottom edge, as a fraction of the quad height. */
  fadeTop = 0; fadeBottom = 0;

  reset(): this {
    this.x = this.y = this.w = this.h = 0;
    this.u0 = this.v0 = 0; this.u1 = this.v1 = 1;
    this.originX = this.originY = 0.5;
    this.rotation = this.skew = this.flash = 0;
    this.saturation = 1;
    this.color = WHITE;
    this.fog = 0;
    this.fadeTop = this.fadeBottom = 0;
    return this;
  }
}

/** A texture ready to draw. It can be swapped in place for another resolution of the same image (see Loader.setTier). */
export interface TextureBinding {
  texture: Texture;
  bindGroup: GPUBindGroup;
}

interface Batch { pipeline: number; bindGroup: GPUBindGroup; view: number; first: number; count: number }

const QUAD_FLOATS = 20; // 80 bytes
const VIEW_STRIDE = 256; // minUniformBufferOffsetAlignment
const MAX_VIEWS = 64;
const PIPE_TEXTURE = 0, PIPE_SHAPE = 2; // + Blend

/**
 * Instanced quad renderer. Every quad of a frame lands in one vertex buffer upload; consecutive quads
 * with the same pipeline, texture and view collapse into a single draw.
 *
 * Draw with shape() and sprite(), or fill `quad` by hand and call drawShape() / drawTexture().
 */
export class SpriteRenderer {
  readonly quad = new Quad();
  readonly stats = { quads: 0, draws: 0 };

  private readonly data: ArrayBuffer;
  private readonly f32: Float32Array;
  private readonly u32: Uint32Array;
  private count = 0;
  private readonly batches: Batch[] = [];
  private batchCount = 0;
  private readonly viewData = new Float32Array((MAX_VIEWS * VIEW_STRIDE) / 4);
  private readonly viewOffsets = Uint32Array.from({ length: MAX_VIEWS }, (_, i) => i * VIEW_STRIDE);
  private viewCount = 0;
  private originX = 0;
  private originY = 0;
  private warnedFull = false;
  private readonly white: GPUBindGroup;

  private constructor(
    private readonly device: GPUDevice,
    private readonly capacity: number,
    private readonly pipelines: GPURenderPipeline[],
    private readonly textureLayout: GPUBindGroupLayout,
    private readonly viewBindGroup: GPUBindGroup,
    private readonly instanceBuffer: GPUBuffer,
    private readonly uniformBuffer: GPUBuffer,
    private readonly samplers: { clamp: GPUSampler; repeat: GPUSampler },
  ) {
    this.data = new ArrayBuffer(capacity * QUAD_FLOATS * 4);
    this.f32 = new Float32Array(this.data);
    this.u32 = new Uint32Array(this.data);
    this.white = this.bind(createWhiteTexture(device)).bindGroup;
  }

  static async create(gpu: Gpu, capacity = 16384): Promise<SpriteRenderer> {
    const { device, format } = gpu;
    const module = device.createShaderModule({ label: 'sprites', code: SPRITE_SHADER });
    const viewLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }],
    });
    const textureLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [viewLayout, textureLayout] });
    const formats: GPUVertexFormat[] = ['float32x2', 'float32x2', 'float32x4', 'float32x2', 'float32x4', 'unorm8x4', 'unorm8x4', 'float32x4'];
    const offsets = [0, 8, 16, 32, 40, 56, 60, 64];
    const vertex: GPUVertexState = {
      module,
      entryPoint: 'vs',
      buffers: [{ arrayStride: QUAD_FLOATS * 4, stepMode: 'instance', attributes: formats.map((format, i) => ({ shaderLocation: i, offset: offsets[i], format })) }],
    };
    const blends: GPUBlendState[] = [
      { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
      { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
    ];
    // order matches PIPE_TEXTURE / PIPE_SHAPE + Blend
    const pipelines = await Promise.all(['fs_texture', 'fs_texture', 'fs_shape', 'fs_shape'].map((entryPoint, i) =>
      device.createRenderPipelineAsync({
        label: `${entryPoint}/${i % 2 ? 'additive' : 'alpha'}`, layout, vertex,
        fragment: { module, entryPoint, targets: [{ format, blend: blends[i % 2] }] },
        primitive: { topology: 'triangle-strip' },
      })));
    const instanceBuffer = device.createBuffer({ label: 'quads', size: capacity * QUAD_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const uniformBuffer = device.createBuffer({ label: 'views', size: MAX_VIEWS * VIEW_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const viewBindGroup = device.createBindGroup({ layout: viewLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer, size: 16 } }] });
    const samplers = {
      clamp: device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' }),
      repeat: device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat' }),
    };
    return new SpriteRenderer(device, capacity, pipelines, textureLayout, viewBindGroup, instanceBuffer, uniformBuffer, samplers);
  }

  /** Creates the bind group for a texture once, at load time. `repeat` wraps horizontally (looping layers). */
  bind(texture: Texture, repeat = false): TextureBinding {
    const bindGroup = this.device.createBindGroup({
      label: texture.url,
      layout: this.textureLayout,
      entries: [
        { binding: 0, resource: repeat ? this.samplers.repeat : this.samplers.clamp },
        { binding: 1, resource: texture.view },
      ],
    });
    return { texture, bindGroup };
  }

  begin(): void {
    this.count = 0;
    this.batchCount = 0;
    this.viewCount = 0;
  }

  /**
   * Camera for the quads that follow: centre and visible size in world units. Positions are made
   * camera-relative here (in doubles) so f32 precision never degrades however far the world scrolls.
   */
  setView(centreX: number, centreY: number, width: number, height: number): void {
    if (this.viewCount >= MAX_VIEWS) throw new Error('SpriteRenderer: too many views in one frame');
    const o = (this.viewCount * VIEW_STRIDE) / 4;
    this.viewData[o] = 2 / width;
    this.viewData[o + 1] = -2 / height; // world y points down, clip y points up
    this.viewCount++;
    this.originX = centreX;
    this.originY = centreY;
  }

  /** A procedural shape centred on (x, y), `w` by `h`; `param` tunes it (see the shader). */
  shape(kind: Shape, x: number, y: number, w: number, h: number, color: number, blend: Blend = Blend.Alpha, param = 0, rotation = 0): void {
    const q = this.quad.reset();
    q.x = x; q.y = y; q.w = w; q.h = h;
    q.u0 = kind; q.v0 = param; // shapes carry their kind and parameter in the uv slots
    q.color = color;
    q.rotation = rotation;
    this.drawShape(blend);
  }

  /**
   * Fills `quad` with a sheet frame at (x, y) (the sheet's pivot), `sx`/`sy` world units per sheet
   * pixel (negative sx mirrors). Adjust anything else on the returned quad, then drawTexture(sheet.binding).
   */
  spriteQuad(sheet: SpriteSheet, frame: number, x: number, y: number, sx: number, sy: number): Quad {
    const f = sheet.frames[frame], q = this.quad.reset();
    q.x = x; q.y = y;
    q.w = sheet.cellWidth * sx; q.h = sheet.cellHeight * sy;
    q.originX = sheet.originX; q.originY = sheet.originY;
    q.u0 = f.u0; q.v0 = f.v0; q.u1 = f.u1; q.v1 = f.v1;
    return q;
  }

  /** Draws a sheet frame in one go (see spriteQuad). */
  sprite(sheet: SpriteSheet, frame: number, x: number, y: number, sx: number, sy: number, color = WHITE, rotation = 0, blend: Blend = Blend.Alpha): void {
    const q = this.spriteQuad(sheet, frame, x, y, sx, sy);
    q.color = color;
    q.rotation = rotation;
    this.drawTexture(sheet.binding, blend);
  }

  drawTexture(binding: TextureBinding, blend: Blend = Blend.Alpha): void {
    this.push(PIPE_TEXTURE + blend, binding.bindGroup);
  }

  /** Draws `quad` as a procedural shape: set u0 to the Shape and v0 to its parameter. */
  drawShape(blend: Blend = Blend.Alpha): void {
    this.push(PIPE_SHAPE + blend, this.white);
  }

  render(pass: GPURenderPassEncoder): void {
    this.stats.quads = this.count;
    this.stats.draws = this.batchCount;
    if (!this.count) return;
    const queue = this.device.queue;
    queue.writeBuffer(this.instanceBuffer, 0, this.data, 0, this.count * QUAD_FLOATS * 4);
    queue.writeBuffer(this.uniformBuffer, 0, this.viewData.buffer, 0, this.viewCount * VIEW_STRIDE);
    pass.setVertexBuffer(0, this.instanceBuffer);
    let pipeline = -1, view = -1;
    let bindGroup: GPUBindGroup | null = null;
    for (let i = 0; i < this.batchCount; i++) {
      const b = this.batches[i];
      if (b.pipeline !== pipeline) pass.setPipeline(this.pipelines[(pipeline = b.pipeline)]);
      if (b.view !== view) pass.setBindGroup(0, this.viewBindGroup, this.viewOffsets, (view = b.view), 1);
      if (b.bindGroup !== bindGroup) pass.setBindGroup(1, (bindGroup = b.bindGroup));
      pass.draw(4, b.count, 0, b.first);
    }
  }

  private push(pipeline: number, bindGroup: GPUBindGroup): void {
    if (this.count >= this.capacity) {
      if (!this.warnedFull) { console.warn('SpriteRenderer: quad capacity reached'); this.warnedFull = true; }
      return;
    }
    const q = this.quad, f = this.f32, o = this.count * QUAD_FLOATS;
    f[o] = q.x - this.originX; f[o + 1] = q.y - this.originY;
    f[o + 2] = q.w; f[o + 3] = q.h;
    f[o + 4] = q.u0; f[o + 5] = q.v0; f[o + 6] = q.u1; f[o + 7] = q.v1;
    f[o + 8] = q.originX; f[o + 9] = q.originY;
    f[o + 10] = q.rotation; f[o + 11] = q.skew; f[o + 12] = q.saturation; f[o + 13] = q.flash;
    this.u32[o + 14] = q.color;
    this.u32[o + 15] = q.fog;
    f[o + 16] = q.fadeTop; f[o + 17] = q.fadeBottom;

    const view = this.viewCount - 1;
    const last = this.batchCount > 0 ? this.batches[this.batchCount - 1] : null;
    if (last && last.pipeline === pipeline && last.bindGroup === bindGroup && last.view === view && last.first + last.count === this.count) {
      last.count++;
    } else {
      let b = this.batches[this.batchCount];
      if (!b) this.batches.push((b = { pipeline, bindGroup, view, first: 0, count: 0 }));
      b.pipeline = pipeline; b.bindGroup = bindGroup; b.view = view; b.first = this.count; b.count = 1;
      this.batchCount++;
    }
    this.count++;
  }
}

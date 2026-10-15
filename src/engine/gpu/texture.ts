import { fetchOk } from '../core/fetch';

export interface Texture {
  readonly gpu: GPUTexture;
  readonly view: GPUTextureView;
  /** Size of the full-resolution image, in its pixels, whatever resolution the GPU copy is (see createTexture). */
  readonly width: number;
  readonly height: number;
  readonly url: string;
}

/** Fetches and decodes an image as stored (straight alpha, no colour conversion). */
export async function loadBitmap(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetchOk(url)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

/**
 * Uploads a decoded image as a premultiplied-alpha rgba8 texture with a GPU-built mip chain. `maxMips`
 * caps the chain (atlases want a few only, so neighbouring cells never blend together when small).
 * `resolution` is the bitmap's size as a fraction of the full-size image it stands in for (0.5 for a
 * half-size copy): the texture reports the full size, so anything measured in the image's pixels fits.
 */
export function createTexture(device: GPUDevice, mips: MipmapGenerator, bitmap: ImageBitmap, label: string, maxMips = Infinity, resolution = 1): Texture {
  const { width, height } = bitmap;
  const gpu = device.createTexture({
    label,
    size: [width, height],
    format: 'rgba8unorm',
    mipLevelCount: Math.min(Math.floor(Math.log2(Math.max(width, height))) + 1, maxMips),
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: gpu, premultipliedAlpha: true }, [width, height]);
  mips.generate(gpu);
  return { gpu, view: gpu.createView(), width: Math.round(width / resolution), height: Math.round(height / resolution), url: label };
}

/** A 1x1 white texture, used where a pipeline needs a texture binding but draws procedurally. */
export function createWhiteTexture(device: GPUDevice): Texture {
  const gpu = device.createTexture({ label: 'white', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: gpu }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);
  return { gpu, view: gpu.createView(), width: 1, height: 1, url: 'white' };
}

const MIP_SHADER = /* wgsl */ `
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0; // fullscreen triangle
  var o: VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return o;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return textureSampleLevel(src, samp, v.uv, 0.0); // bilinear at the 2x2 centre = box filter
}
`;

/** Fills mip levels 1..n of a texture by repeated GPU downsampling. Textures should be premultiplied. */
export class MipmapGenerator {
  private readonly module: GPUShaderModule;
  private readonly sampler: GPUSampler;
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();

  constructor(private readonly device: GPUDevice) {
    this.module = device.createShaderModule({ label: 'mipmaps', code: MIP_SHADER });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  }

  generate(texture: GPUTexture): void {
    if (texture.mipLevelCount < 2) return;
    const pipeline = this.pipelineFor(texture.format);
    const encoder = this.device.createCommandEncoder({ label: 'mipmaps' });
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }

  private pipelineFor(format: GPUTextureFormat): GPURenderPipeline {
    let pipeline = this.pipelines.get(format);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({
        label: `mipmaps ${format}`,
        layout: 'auto',
        vertex: { module: this.module, entryPoint: 'vs' },
        fragment: { module: this.module, entryPoint: 'fs', targets: [{ format }] },
      });
      this.pipelines.set(format, pipeline);
    }
    return pipeline;
  }
}

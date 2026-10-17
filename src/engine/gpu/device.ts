export interface Gpu {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

export class GpuUnsupportedError extends Error {}

export async function initGpu(canvas: HTMLCanvasElement, onLost: (message: string) => void): Promise<Gpu> {
  if (!navigator.gpu) throw new GpuUnsupportedError('This browser does not support WebGPU.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new GpuUnsupportedError('No WebGPU adapter is available on this device.');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new GpuUnsupportedError('Could not create a WebGPU canvas context.');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  device.lost.then((info) => { if (info.reason !== 'destroyed') onLost(info.message); });
  device.addEventListener('uncapturederror', (e) => console.error('WebGPU:', (e as GPUUncapturedErrorEvent).error.message));
  return { device, context, format, canvas };
}

/** Keeps the canvas drawing buffer matched to its on-screen size in device pixels: every pixel sharp. */
export class CanvasSize {
  constructor(private readonly canvas: HTMLCanvasElement, private readonly maxDimension: number) {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const dpcb = entry.devicePixelContentBoxSize?.[0], box = entry.contentBoxSize[0];
        this.apply(dpcb ? dpcb.inlineSize : box.inlineSize * devicePixelRatio, dpcb ? dpcb.blockSize : box.blockSize * devicePixelRatio);
      }
    });
    try {
      observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      observer.observe(canvas); // Safari: no device-pixel-content-box
    }
  }

  private apply(width: number, height: number): void {
    this.canvas.width = Math.max(1, Math.min(this.maxDimension, Math.round(width)));
    this.canvas.height = Math.max(1, Math.min(this.maxDimension, Math.round(height)));
  }
}

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

/** Keeps the canvas drawing buffer matched to its on-screen size in device pixels. */
export function autoResize(canvas: HTMLCanvasElement, maxDimension: number, renderScale = 1): void {
  const apply = (w: number, h: number) => {
    canvas.width = Math.max(1, Math.min(maxDimension, Math.round(w * renderScale)));
    canvas.height = Math.max(1, Math.min(maxDimension, Math.round(h * renderScale)));
  };
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const dpcb = entry.devicePixelContentBoxSize?.[0];
      if (dpcb) apply(dpcb.inlineSize, dpcb.blockSize);
      else apply(entry.contentBoxSize[0].inlineSize * devicePixelRatio, entry.contentBoxSize[0].blockSize * devicePixelRatio);
    }
  });
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas); // Safari: no device-pixel-content-box
  }
}

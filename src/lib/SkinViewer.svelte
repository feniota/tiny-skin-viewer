<!-- @component
A tiny 3D Minecraft skin viewer, rendered with WebGPU.

## Example - Basic usage

```svelte
<script>
  let reset = $state(0);
  let scale = $state(1);
</script>

<button onclick={() => reset++}>Reset rotation angle</button>
<button onclick={() => scale += 0.1}>Zoom in</button>
<button onclick={() => scale -= 0.1}>Zoom out</button>

<SkinViewer skinUrl="https://textures.minecraft.net/texture/a1b2c3" scale={scale} resetId={reset} />
```

## Example - WebGPU fallback handling

If WebGPU is unavailable, this component fails and nothing is drawn on the `<canvas>`.
You can detect this separately and show a fallback, e.g.,

```svelte
<script>
  import { onMount } from "svelte";

  let webgpu = $state(false);

  onMount(async () => {
    // navigator.gpu may be undefined in insecure contexts
    if (navigator.gpu) {
      webgpu = (await navigator.gpu.requestAdapter()) !== null;
    }
    else webgpu = false;
  });
</script>

{#if webgpu}
  <SkinViewer skinUrl="https://textures.minecraft.net/texture/a1b2c3"/>
{:else}
  <span>WebGPU not available.</span>
{/if}
```
-->
<script lang="ts">
  import shaderCode from "./shader";
  import type { SkinViewerProps } from "./types.d.ts";

  let canvas = $state<HTMLCanvasElement | null>(null);
  let raf = $state(0);
  let rotY = $state(0);
  let rotX = $state(0);
  let gpuReady = $state(false);

  // Non-reactive GPU references (mutated by init/cape reload, read by render loop)
  let device: GPUDevice | undefined;
  let ctx: GPUCanvasContext | null | undefined;
  let format: GPUTextureFormat = "rgba8unorm";
  let pipeline: GPURenderPipeline | undefined;
  let uniformBuffer: GPUBuffer | undefined;
  let skinTexture: GPUTexture | undefined;
  let capeTexture: GPUTexture | undefined;
  let sampler: GPUSampler | undefined;
  let depthTexture: GPUTexture | undefined;
  let bindGroup0: GPUBindGroup | undefined;
  let bindGroup1: GPUBindGroup | undefined;

  let {
    isSlim = false,
    capeUrl = undefined as string | undefined | null,
    time = undefined as number | undefined,
    scale = 1,
    skinUrl = "https://assets.ferris.love/phenocryst/steve.png",
    resetId = 0,
    class: className = "",
    width = 800,
    height = 600,
  }: SkinViewerProps = $props();

  $effect(() => {
    void resetId;
    rotY = 0;
    rotX = 0;
  });

  let dragging = false;
  let lastX = 0,
    lastY = 0;
  let gpuInited = false;
  let initId = 0;
  let cachedDevice: GPUDevice | undefined;

  $effect(() => {
    if (!canvas) return;
    let id = ++initId;
    gpuReady = false;
    // Intentionally NOT tracking skinUrl/capeUrl — handled by separate effects below
    init(canvas, id);
    return () => cancelAnimationFrame(raf);
  });

  // Reload textures in-place when skinUrl/capeUrl changes — avoids full GPU reinit
  $effect(() => {
    if (!gpuReady) return;
    reloadSkin();
  });

  $effect(() => {
    if (!gpuReady) return;
    reloadCape();
  });

  async function loadTexture(device: GPUDevice, url: string) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const texture = device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [
      bitmap.width,
      bitmap.height,
    ]);
    return texture;
  }

  function placeholderTexture(device: GPUDevice) {
    return device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  function makeBindGroup1() {
    return device!.createBindGroup({
      layout: pipeline!.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: skinTexture!.createView() },
        { binding: 1, resource: sampler! },
        { binding: 2, resource: capeTexture!.createView() },
      ],
    });
  }

  async function reloadSkin() {
    if (skinTexture) skinTexture.destroy();
    try {
      skinTexture = await loadTexture(device!, skinUrl);
    } catch {
      console.warn("Failed to load skin texture, keeping old one");
      return;
    }
    bindGroup1 = makeBindGroup1();
  }

  async function reloadCape() {
    // Destroy the previous cape texture, but NOT the 1×1 placeholder
    if (capeTexture && capeTexture.width > 1) {
      capeTexture.destroy();
    }
    if (capeUrl) {
      try {
        capeTexture = await loadTexture(device!, capeUrl);
      } catch {
        console.warn("Failed to load cape texture");
        capeTexture = placeholderTexture(device!);
      }
    } else {
      capeTexture = placeholderTexture(device!);
    }
    bindGroup1 = makeBindGroup1();
  }

  async function init(cvs: HTMLCanvasElement, id: number) {
    cvs.width = width;
    cvs.height = height;

    if (id !== initId) return;

    if (!gpuInited) {
      gpuInited = true;
      cvs.addEventListener("pointerdown", e => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
      });
      cvs.addEventListener("pointermove", e => {
        if (!dragging) return;
        const dx = e.clientX - lastX,
          dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        rotY += dx * 0.005;
        const facing = Math.cos(rotY) >= 0 ? 1 : -1;
        rotX = Math.max(-1.5, Math.min(1.5, rotX - dy * 0.005 * facing));
      });
      addEventListener("pointerup", () => {
        dragging = false;
      });
      addEventListener("pointercancel", () => {
        dragging = false;
      });
    }

    try {
      const gpu = navigator.gpu;
      if (id !== initId) return;
      const adapter = await gpu.requestAdapter();
      if (!adapter) return console.error("WebGPU not available");
      if (id !== initId) return;
      device = cachedDevice ?? (await adapter.requestDevice());
      cachedDevice = device;
      device.addEventListener("uncapturederror", (e: GPUUncapturedErrorEvent) =>
        console.error("WebGPU error:", e.error),
      );

      ctx = cvs.getContext("webgpu");
      if (!ctx) return console.error("WebGPU context failed");
      format = gpu.getPreferredCanvasFormat();
      ctx.configure({ device: device, format: format, alphaMode: "premultiplied" });

      const shader = device.createShaderModule({ code: shaderCode });
      if (id !== initId) return;
      skinTexture = await loadTexture(device, skinUrl);
      sampler = device.createSampler({
        magFilter: "nearest",
        minFilter: "nearest",
      });

      if (id !== initId) return;
      // Always start with a placeholder 1×1 — real cape loaded by reloadCape
      capeTexture = placeholderTexture(device);

      uniformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shader },
        fragment: {
          module: shader,
          targets: [
            {
              format: format,
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
                alpha: {
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
              },
            },
          ],
        },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });

      bindGroup0 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      bindGroup1 = makeBindGroup1();

      depthTexture = device.createTexture({
        size: [cvs.width, cvs.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });

      const ubuf = new Float32Array(8);

      function frame(rafTime: number) {
        raf = requestAnimationFrame(frame);

        ubuf[0] = time ?? rafTime * 0.001;
        ubuf[1] = rotY;
        ubuf[2] = rotX;
        ubuf[3] = isSlim ? 1 : 0;
        ubuf[4] = scale;
        ubuf[5] = width / height;
          ubuf[6] = capeUrl ? 1 : 0;
        device!.queue.writeBuffer(uniformBuffer!, 0, ubuf);

        const encoder = device!.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: ctx!.getCurrentTexture().createView(),
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            },
          ],
          depthStencilAttachment: {
            view: depthTexture!.createView(),
            depthLoadOp: "clear",
            depthStoreOp: "store",
            depthClearValue: 1.0,
          },
        });
        pass.setPipeline(pipeline!);
        pass.setBindGroup(0, bindGroup0!);
        pass.setBindGroup(1, bindGroup1!);
        pass.draw(252, 1, 0, 0);
        pass.draw(252, 1, 252, 0);
        pass.end();
        device!.queue.submit([encoder.finish()]);
      }
      requestAnimationFrame(frame);
      gpuReady = true;
    } catch (err) {
      console.error("Init failed:", err);
    }
  }
</script>

<canvas bind:this={canvas} class={className}></canvas>

<style>
  canvas {
    display: block;
    cursor: grab;
    background: transparent;
  }
  canvas:active {
    cursor: grabbing;
  }
</style>

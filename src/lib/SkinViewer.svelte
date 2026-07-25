<script lang="ts">
import type { SkinViewerProps } from "./index";
import shaderCode from "./shader";

let canvas = $state<HTMLCanvasElement | null>(null);
let raf = $state(0);
let rotY = $state(0);
let rotX = $state(0);

let {
	isSlim = false,
	capeUrl = undefined as string | undefined,
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

$effect(() => {
	if (!canvas) return;
	void skinUrl;
	void capeUrl;
	init(canvas);
	return () => cancelAnimationFrame(raf);
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

async function init(cvs: HTMLCanvasElement) {
	cvs.width = width;
	cvs.height = height;

	if (!gpuInited) {
		gpuInited = true;
		cvs.addEventListener("pointerdown", (e) => {
			dragging = true;
			lastX = e.clientX;
			lastY = e.clientY;
		});
		cvs.addEventListener("pointermove", (e) => {
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
		const adapter = await gpu.requestAdapter();
		if (!adapter) return console.error("WebGPU not available");
		const device = await adapter.requestDevice();
		device.addEventListener("uncapturederror", (e: GPUUncapturedErrorEvent) =>
			console.error("WebGPU error:", e.error),
		);

		const ctx = cvs.getContext("webgpu");
		if (!ctx) return console.error("WebGPU context failed");
		const format = gpu.getPreferredCanvasFormat();
		ctx.configure({ device, format, alphaMode: "premultiplied" });

		const shader = device.createShaderModule({ code: shaderCode });
		const skinTexture = await loadTexture(device, skinUrl);
		const sampler = device.createSampler({
			magFilter: "nearest",
			minFilter: "nearest",
		});

		// Cape — uses placeholder 1×1 when disabled (required by pipeline layout)
		let capeTexture = placeholderTexture(device);
		if (capeUrl) {
			try {
				capeTexture = await loadTexture(device, capeUrl);
			} catch {
				console.warn("Failed to load cape texture");
			}
		}

		const uniformBuffer = device.createBuffer({
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const pipeline = device.createRenderPipeline({
			layout: "auto",
			vertex: { module: shader },
			fragment: {
				module: shader,
				targets: [
					{
						format,
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

		const bindGroup0 = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		});
		const bindGroup1 = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(1),
			entries: [
				{ binding: 0, resource: skinTexture.createView() },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: capeTexture.createView() },
			],
		});

		let depthTexture = device.createTexture({
			size: [cvs.width, cvs.height],
			format: "depth24plus",
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});

		const ubuf = new Float32Array(8);

		function frame(time: number) {
			raf = requestAnimationFrame(frame);

			ubuf[0] = time * 0.001;
			ubuf[1] = rotY;
			ubuf[2] = rotX;
			ubuf[3] = isSlim ? 1 : 0;
			        ubuf[4] = scale;
			        ubuf[5] = capeUrl ? 1 : 0;
			device.queue.writeBuffer(uniformBuffer, 0, ubuf);

			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: ctx.getCurrentTexture().createView(),
						loadOp: "clear",
						storeOp: "store",
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
					},
				],
				depthStencilAttachment: {
					view: depthTexture.createView(),
					depthLoadOp: "clear",
					depthStoreOp: "store",
					depthClearValue: 1.0,
				},
			});
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup0);
			pass.setBindGroup(1, bindGroup1);
			pass.draw(252, 1, 0, 0);
			pass.draw(252, 1, 252, 0);
			pass.end();
			device.queue.submit([encoder.finish()]);
		}
		requestAnimationFrame(frame);
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

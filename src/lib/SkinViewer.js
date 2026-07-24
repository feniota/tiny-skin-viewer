// Auto-generated from SkinViewer.svelte — do not edit directly
// Rebuild: deno run -A scripts/compile-component.ts
// @ts-nocheck:

import 'svelte/internal/disclose-version';
import * as $ from 'svelte/internal/client';
import shaderCode from "./shader.ts";

var root = $.from_html(`<canvas class="svelte-133g8k4"></canvas>`);

const $$css = {
	hash: 'svelte-133g8k4',
	code: 'canvas.svelte-133g8k4 {display:block;cursor:grab;background:transparent;}canvas.svelte-133g8k4:active {cursor:grabbing;}'
};

export default function SkinViewer($$anchor, $$props) {
	$.push($$props, true);
	$.append_styles($$anchor, $$css);

	let canvas = $.state(null);
	let raf = $.state(0);
	let rotY = $.state(0);
	let rotX = $.state(0.3);

	let isSlim = $.prop($$props, 'isSlim', 3, false),
		scale = $.prop($$props, 'scale', 3, 1),
		skinUrl = $.prop($$props, 'skinUrl', 3, "/steve.png"),
		resetId = $.prop($$props, 'resetId', 3, 0);

	// reset rotation when resetId changes
	$.user_effect(() => {
		void resetId(); // track
		$.set(rotY, 0);
		$.set(rotX, 0.3);
	});

	let dragging = false;
	let lastX = 0;
	let lastY = 0;

	$.user_effect(() => {
		if (!$.get(canvas)) return;

		const c = $.get(canvas);

		init(c);

		return () => cancelAnimationFrame($.get(raf));
	});

	async function loadTexture(device, url) {
		const img = new Image();

		img.src = url;
		await img.decode();

		const bitmap = await createImageBitmap(img);

		const texture = device.createTexture({
			size: [bitmap.width, bitmap.height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});

		device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);

		return texture;
	}

	async function init(cvs) {
		cvs.width = 800;
		cvs.height = 600;

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
			$.set(rotY, $.get(rotY) + dx * 0.005);

			const facing = Math.cos($.get(rotY)) >= 0 ? 1 : -1;

			$.set(rotX, Math.max(-1.5, Math.min(1.5, $.get(rotX) - dy * 0.005 * facing)), true);
		});

		cvs.addEventListener("pointerup", () => {
			dragging = false;
		});

		try {
			const gpu = navigator.gpu;
			const adapter = await gpu.requestAdapter();

			if (!adapter) {
				console.error("WebGPU not available");

				return;
			}

			const device = await adapter.requestDevice();

			device.addEventListener("uncapturederror", (e) => console.error("WebGPU error:", e.error));

			const ctx = cvs.getContext("webgpu");

			if (!ctx) {
				console.error("WebGPU context failed");

				return;
			}

			const format = gpu.getPreferredCanvasFormat();

			ctx.configure({ device, format, alphaMode: "premultiplied" });

			const shader = device.createShaderModule({ code: shaderCode });
			const skinTexture = await loadTexture(device, skinUrl());
			const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });

			const uniformBuffer = device.createBuffer({
				size: 32,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});

			const pipeline = device.createRenderPipeline({
				layout: "auto",
				vertex: { module: shader },
				fragment: { module: shader, targets: [{ format }] },
				depthStencil: {
					format: "depth24plus",
					depthWriteEnabled: true,
					depthCompare: "less"
				}
			});

			const bindGroup0 = device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
			});

			const bindGroup1 = device.createBindGroup({
				layout: pipeline.getBindGroupLayout(1),
				entries: [
					{ binding: 0, resource: skinTexture.createView() },
					{ binding: 1, resource: sampler }
				]
			});

			let depthTexture;

			function ensureDepth(w, h) {
				if (depthTexture) depthTexture.destroy();

				depthTexture = device.createTexture({
					size: [w, h],
					format: "depth24plus",
					usage: GPUTextureUsage.RENDER_ATTACHMENT
				});
			}

			ensureDepth(cvs.width, cvs.height);

			const ubuf = new Float32Array(8);

			function frame(time) {
				$.set(raf, requestAnimationFrame(frame), true);
				ubuf[0] = time * 0.001;
				ubuf[1] = $.get(rotY);
				ubuf[2] = $.get(rotX);
				ubuf[3] = isSlim() ? 1 : 0;
				ubuf[4] = scale();
				device.queue.writeBuffer(uniformBuffer, 0, ubuf);

				const encoder = device.createCommandEncoder();

				const pass = encoder.beginRenderPass({
					colorAttachments: [
						{
							view: ctx.getCurrentTexture().createView(),
							loadOp: "clear",
							storeOp: "store",
							clearValue: { r: 0, g: 0, b: 0, a: 0 }
						}
					],
					depthStencilAttachment: {
						view: depthTexture.createView(),
						depthLoadOp: "clear",
						depthStoreOp: "store",
						depthClearValue: 1.0
					}
				});

				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup0);
				pass.setBindGroup(1, bindGroup1);
				pass.draw(216);
				pass.end();
				device.queue.submit([encoder.finish()]);
			}

			requestAnimationFrame(frame);
		} catch(err) {
			console.error("Init failed:", err);
		}
	}

	var canvas_1 = root();

	$.bind_this(canvas_1, ($$value) => $.set(canvas, $$value), () => $.get(canvas));
	$.append($$anchor, canvas_1);
	$.pop();
}

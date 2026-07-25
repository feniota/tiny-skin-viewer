import 'svelte/internal/disclose-version';
import * as $ from 'svelte/internal/client';
import shaderCode from "./shader";

var root = $.from_html(`<canvas></canvas>`);

export default function SkinViewer($$anchor, $$props) {
	$.push($$props, true);

	let canvas = $.state(null);
	let raf = $.state(0);
	let rotY = $.state(0);
	let rotX = $.state(0);

	let isSlim = $.prop($$props, 'isSlim', 3, false),
		capeUrl = $.prop($$props, 'capeUrl', 3, undefined),
		time = $.prop($$props, 'time', 3, undefined),
		scale = $.prop($$props, 'scale', 3, 1),
		skinUrl = $.prop($$props, 'skinUrl', 3, "https://assets.ferris.love/phenocryst/steve.png"),
		resetId = $.prop($$props, 'resetId', 3, 0),
		className = $.prop($$props, 'class', 3, ""),
		width = $.prop($$props, 'width', 3, 800),
		height = $.prop($$props, 'height', 3, 600);

	$.user_effect(() => {
		void resetId();
		$.set(rotY, 0);
		$.set(rotX, 0);
	});

	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	let gpuInited = false;

	$.user_effect(() => {
		if (!$.get(canvas)) return;

		void skinUrl();
		void capeUrl();
		init($.get(canvas));

		return () => cancelAnimationFrame($.get(raf));
	});

	async function loadTexture(device, url) {
		const img = new Image();

		img.crossOrigin = "anonymous";
		img.src = url;
		await img.decode();

		const bitmap = await createImageBitmap(img);

		const texture = device.createTexture({
			size: [bitmap.width, bitmap.height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
		});

		device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);

		return texture;
	}

	function placeholderTexture(device) {
		return device.createTexture({
			size: [1, 1],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING
		});
	}

	async function init(cvs) {
		cvs.width = width();
		cvs.height = height();

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
				$.set(rotY, $.get(rotY) + dx * 0.005);

				const facing = Math.cos($.get(rotY)) >= 0 ? 1 : -1;

				$.set(rotX, Math.max(-1.5, Math.min(1.5, $.get(rotX) - dy * 0.005 * facing)), true);
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

			device.addEventListener("uncapturederror", (e) => console.error("WebGPU error:", e.error));

			const ctx = cvs.getContext("webgpu");

			if (!ctx) return console.error("WebGPU context failed");

			const format = gpu.getPreferredCanvasFormat();

			ctx.configure({ device, format, alphaMode: "premultiplied" });

			const shader = device.createShaderModule({ code: shaderCode });
			const skinTexture = await loadTexture(device, skinUrl());
			const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });

			// Cape — uses placeholder 1×1 when disabled (required by pipeline layout)
			let capeTexture = placeholderTexture(device);

			if (capeUrl()) {
				try {
					capeTexture = await loadTexture(device, capeUrl());
				} catch {
					console.warn("Failed to load cape texture");
				}
			}

			const uniformBuffer = device.createBuffer({
				size: 32,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
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
									operation: "add"
								},
								alpha: {
									srcFactor: "one",
									dstFactor: "one-minus-src-alpha",
									operation: "add"
								}
							}
						}
					]
				},
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
					{ binding: 1, resource: sampler },
					{ binding: 2, resource: capeTexture.createView() }
				]
			});

			let depthTexture = device.createTexture({
				size: [cvs.width, cvs.height],
				format: "depth24plus",
				usage: GPUTextureUsage.RENDER_ATTACHMENT
			});

			const ubuf = new Float32Array(8);

			function frame(rafTime) {
				$.set(raf, requestAnimationFrame(frame), true);
				ubuf[0] = time() ?? rafTime * 0.001;
				ubuf[1] = $.get(rotY);
				ubuf[2] = $.get(rotX);
				ubuf[3] = isSlim() ? 1 : 0;
				ubuf[4] = scale();
				ubuf[5] = width() / height();
				ubuf[6] = capeUrl() ? 1 : 0;
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
				pass.draw(252, 1, 0, 0);
				pass.draw(252, 1, 252, 0);
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
	$.template_effect(() => $.set_class(canvas_1, 1, $.clsx(className()), 'svelte-1q7go3z'));
	$.append($$anchor, canvas_1);
	$.pop();
}
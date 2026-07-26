# TinySkinViewer — Copilot Instructions

## Build, Commands

```sh
deno task dev          # Start Vite dev server
deno task build        # Build demo site (vite build)
deno task generate-shader  # Regenerate shader.wgsl + shader.ts from generator
deno task package      # Build npm package via @sveltejs/package
deno task compile-component  # Pre-compile SkinViewer.svelte → dist/ (for JSR)
deno x oxfmt .         # Format all source files (oxfmt, NOT deno fmt)
deno x oxfmt --check . # Check formatting in CI
```

There are no test commands — the project has no test suite.

## High-Level Architecture

### GPU-first design

All 3D rendering runs in a **single WGSL shader**: model transform, limb swing animation, cape pendulum physics, skin/cape texture sampling, and scale. The CPU only writes a 28-byte uniform buffer (7 floats) per frame.

### Shader generation

**The shader is generated, not hand-written.** Edit `scripts/generate-shader.ts` to change the shader, then run `deno task generate-shader`. This writes both `src/lib/shader.wgsl` and `src/lib/shader.ts` — both are marked `linguist-generated` in `.gitattributes` and should never be edited by hand.

The generator defines body parts with pixel dimensions + texture UV offsets (Minecraft `texOffs` format), then emits WGSL `const` arrays for geometry, UV coordinates, part sizes, and animation phases.

### 14-part model structure

| Index | Part      | Animated         | Overlay (index + 7) |
| ----- | --------- | ---------------- | ------------------- |
| 0     | head      | —                | 7                   |
| 1     | body      | —                | 8                   |
| 2     | right_arm | swing (±1 phase) | 9                   |
| 3     | left_arm  | swing (∓1 phase) | 10                  |
| 4     | right_leg | swing (∓1 phase) | 11                  |
| 5     | left_leg  | swing (±1 phase) | 12                  |
| 6     | cape      | pendulum         | 13                  |

Each part = a unit cube (36 vertices, 6 faces) scaled to voxel dimensions. Overlay parts are slightly larger (+0.25px per face outward). Base parts are drawn first (draw call 1), overlay parts second (draw call 2) — two `pass.draw(252, …)` calls × 252 vertices each = 504 total.

### Two package entry points

- **`src/lib/index.ts`** — npm entry, exports raw `.svelte` source (bundlers use the `svelte` export condition)
- **`src/jsr.ts`** — JSR entry, exports pre-compiled JS from `dist/` (JSR cannot run Svelte plugins)

### Dual registry publishing

Tags (`v*`) trigger CI to publish to both JSR (`@feniota/tiny-skin-viewer`) and npm (`tiny-skin-viewer`). The JSR job runs `package` + `compile-component` first, then `deno publish`. The npm job runs `package` then `npm publish --provenance`.

### Render pipeline

- Projection: 60° FOV, 0.1–10 clip, dynamic aspect ratio
- Depth: `depth24plus`, write enabled, less comparison
- Blend: premultiplied alpha (Svelte UI overlays expect transparent canvas)
- Clear: transparent black `{0,0,0,0}`

## Key Conventions

### Slim arm handling

Slim (Alex) arms are 3 px wide vs 4 px for classic (Steve). In the vertex shader, `sz.x` is multiplied by `(1.0 - is_slim * 0.25)` to shrink geometry. UV coordinates also switch to a slim variant (`uv_*_slim`) that samples a 3 px region instead of 4 px — defined in the generator via `boxUV_slim()`.

### Cape texture coordinate system

Cape UVs use a separate hardcoded pixel-to-UV mapping in the generator (64×32 texture format), defined under the `if (i === 6 || i === 13)` branch. Unlike body part UVs which are computed via `boxUV()`, cape UVs are manually listed as `capeFaceUV` pixel rects.

### Uniform buffer layout (28 bytes, 7 × f32)

| Offset | Field      | Description                          |
| ------ | ---------- | ------------------------------------ |
| 0      | `time`     | Elapsed seconds for animation        |
| 4      | `rot_y`    | Horizontal camera rotation (radians) |
| 8      | `rot_x`    | Vertical tilt, clamped ±1.5          |
| 12     | `is_slim`  | 0 = Steve, 1 = Alex                  |
| 16     | `scale`    | Uniform model scale                  |
| 20     | `aspect`   | Canvas aspect ratio                  |
| 24     | `has_cape` | 0 = disabled, 1 = enabled            |

### Animation formulas

- **Limb swing**: `angle = 0.6 × sin(time × 4) × phase` around shoulder/hip pivot Y = 0.375
- **Cape**: `angle_x = 0.60 + sin(time × 8) × 0.07` (6° base tilt + ~16° walking flap)

### Textures and sampling

- `nearest` filtering (pixel art aesthetics)
- Skin: 64×64 `rgba8unorm`
- Cape: 64×32 `rgba8unorm` (placeholder 1×1 when disabled)
- WebGPU `premultiplied` alpha mode on canvas context

### Camera / interaction

- Orbital: pointer-drag rotates Y/X (sensitivity 0.005)
- Reset: changing `resetId` prop zeroes rotation angles
- Texture reloads happen in-place (`reloadSkin()` / `reloadCape()`) without full GPU reinit

### Formatting

`oxfmt` is used for all source files (not `deno fmt`). Configuration in `.oxfmtrc.json`. CI enforces formatting on every push/PR.

# TinySkinViewer

[![JSR](https://jsr.io/badges/@feniota/tiny-skin-viewer)](https://jsr.io/@feniota/tiny-skin-viewer) [![NPM Version](https://img.shields.io/npm/v/tiny-skin-viewer)](https://npmjs.com/package/tiny-skin-viewer)

GPU-driven Minecraft skin viewer. All rendering — model transform, limb animation, skin sampling, cape physics, scale — runs in a single WGSL shader. CPU only feeds 7 floats per frame.

## vs. [bs-community/skinview3d](https://github.com/bs-community/skinview3d)

|                     | skinview3d | TinySkinViewer        |
| ------------------- | ---------- | --------------------- |
| **Runtime payload** | 520 KB     | **~21 KB**¹           |
| **Dependencies**    | three.js   | **none** (raw WebGPU) |
| **GPU API**         | WebGL      | WebGPU                |

¹ 6.2 KB component + 15 KB inline shader (uncompressed, Svelte runtime excluded)

## Usage

Install via your preferred registry:

```bash
# JSR
deno add jsr:@feniota/tiny-skin-viewer

# npm / pnpm / yarn
npm install tiny-skin-viewer
pnpm add tiny-skin-viewer
yarn add tiny-skin-viewer
```

### Svelte component

```svelte
<script>
  import { SkinViewer } from "tiny-skin-viewer";
  // for JSR:  import { SkinViewer } from "@feniota/tiny-skin-viewer";
</script>

<SkinViewer
  skinUrl="/steve.png"
  capeUrl="/pancape.png"
  isSlim
  scale={1.5}
  resetId={resetCount}
  time={animTime} />
```

#### Properties

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `skinUrl` | `string` | Wide arm `steve.png` on a cloud storage | Minecraft skin texture URL (64×64 PNG). |
| `isSlim` | `boolean` | `false` | `true` = Slim (3 px arms), `false` = Classic (4 px). |
| `capeUrl` | `string \| undefined` | `undefined` | Cape texture URL (64×32 PNG). When set, a GPU-animated cape renders behind the body. Pass falsy value to disable. |
| `scale` | `number` | `1` | Uniform model scale factor. |
| `resetId` | `number` | `0` | Rotation reset trigger. One should pass a Svelte 5 `$state`. When it changes, the orbital camera resets to default. |
| `time` | `number \| undefined` | `undefined` | Animation time override in seconds. When set, drives all animations from this value instead of the internal clock, useful for pausing, seeking, or syncing with external timelines. Leave `undefined` for auto. |

## The Shader

The shader is the core of `tiny-skin-viewer` — most of the package's code lives there. (Hence the name.)

The shader file `src/lib/shader.wgsl` **is generated** by `scripts/generate-shader.ts`. You should only edit the shader indirectly through the generator.

After editing the generator, regenerate both the `.wgsl` and `.ts` shader files:

```sh
deno task generate-shader
```

<details>
    <summary>In-depth shader descriptions. You probably don't want to read these.</summary>

### Bind group layout

**@group(0) — uniform buffer** (28 bytes, `UNIFORM | COPY_DST`)

| offset | field           | description                                 |
| ------ | --------------- | ------------------------------------------- |
| 0      | `time: f32`     | elapsed seconds, drives animation           |
| 4      | `rot_y: f32`    | horizontal rotation angle (rad)             |
| 8      | `rot_x: f32`    | vertical tilt angle, clamped ±1.5 rad       |
| 12     | `is_slim: f32`  | 0 = Steve, 1 = Alex (shrinks arm width 25%) |
| 16     | `scale: f32`    | uniform model scale (1 = default)           |
| 20     | `aspect: f32`   | projection aspect ratio                     |
| 24     | `has_cape: f32` | 0 = disabled, 1 = enabled                   |

**@group(1) — textures + sampler**

| binding | resource          | detail                                                            |
| ------- | ----------------- | ----------------------------------------------------------------- |
| 0       | `texture_2d<f32>` | skin texture, `rgba8unorm`, 64×64                                 |
| 1       | `sampler`         | `nearest` filtering (pixel art)                                   |
| 2       | `texture_2d<f32>` | cape texture, `rgba8unorm`, 64×32 (1×1 placeholder when disabled) |

### Model geometry

| Part      | Base idx | Overlay idx | Pivot      | Animated |
| --------- | -------- | ----------- | ---------- | -------- |
| head      | 0        | 7           | —          | —        |
| body      | 1        | 8           | —          | —        |
| right_arm | 2        | 9           | shoulder   | ✓        |
| left_arm  | 3        | 10          | shoulder   | ✓        |
| right_leg | 4        | 11          | hip        | ✓        |
| left_leg  | 5        | 12          | hip        | ✓        |
| cape      | 6        | 13          | top (neck) | ✓        |

- **14 parts** × 36 vertices = **504 vertices** total
- Each part is a unit cube (6 faces, 12 triangles), scaled per body-part dimensions
- Cape animation: walking-driven pendulum (`sin(time × 4)`) with 6° base backward lean
- Limb animation: `sin(time × 4) × 0.6` around shoulder/hip pivot

### Hardcoded in shader

- **Projection**: 60° FOV, 0.1–10 clip range, dynamic aspect
- **View**: camera at (0, 0, 4) looking at origin
- **Cube**: 36 vertices (12 triangles, 6 faces), half-extent 0.5
- **UV layout**: standard 64×64 Minecraft skin mapping, 6 faces per body part
- **Cape UV**: front & back faces share the same UV rect (flat plane)

### Render pipeline

- **Depth**: `depth24plus`, write enabled, compare `less`
- **Blend**: premultiplied alpha (`src-alpha` / `one-minus-src-alpha`)
- **Clear**: `{0, 0, 0, 0}` (transparent background)
- **Draw**: `draw(252, …)` × 2 — 7 base parts + 7 overlay parts × 36 vertices

</details>

## Development

<details>

### Build

This package uses `@sveltejs/package` to build the library for npm:

```sh
deno task package # SvelteKit packaging
deno task compile-component # compile .svelte file to ESM
```

### Formatting before pushing

`oxfmt` is used for code formatting (Deno's built-in formatter doesn't support Svelte). It's listed in `devDependencies`, so it's available once npm dependencies are installed.

```
deno x oxfmt
```

### Publishing workflow

1. Bump version in `deno.jsonc` and `package.json`
2. Tag & push — CI does the rest:

```bash
git tag v0.1.7 && git push --tags
```

The CI workflow will:

- Build the package via `@sveltejs/package` and `svelte/compiler`
- Publish to JSR as `@feniota/tiny-skin-viewer`
- Publish to npm as `tiny-skin-viewer`

For detailed explanations please see [Publishing](./PUBLISHING.md).

</details>

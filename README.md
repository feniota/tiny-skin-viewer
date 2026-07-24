# TinySkinViewer

[![JSR](https://jsr.io/badges/@feniota/tiny-skin-viewer)](https://jsr.io/@feniota/tiny-skin-viewer)

GPU-driven Minecraft skin viewer. All rendering — model transform, limb animation, skin sampling, scale — runs in a single WGSL shader. CPU only feeds 5 floats per frame.

## vs. [bs-community/skinview3d](https://github.com/bs-community/skinview3d)

|                     | skinview3d  | TinySkinViewer        |
| ------------------- | ----------- | --------------------- |
| **Runtime payload** | 520 KB      | **13 KB**             |
| **Dependencies**    | three.js    | **none** (raw WebGPU) |
| **GPU API**         | WebGL 1 / 2 | WebGPU                |

## Usage

Install via your preferred registry:

```bash
# JSR
deno add @feniota/tiny-skin-viewer

# npm / pnpm / yarn
npm install tiny-skin-viewer
pnpm add tiny-skin-viewer
yarn add tiny-skin-viewer
```

### Svelte component

```svelte
<script>
  import { SkinViewer } from "tiny-skin-viewer";
  // JSR 用户:  import { SkinViewer } from "@feniota/tiny-skin-viewer";
</script>

<SkinViewer skinUrl="/steve.png" isSlim scale={1.5} resetId={resetCount} />
```

#### Properties

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `skinUrl` | `string` | `"/steve.png"` | Minecraft skin texture URL. A 64×64 .png image. |
| `isSlim` | `boolean` | `false` | Arm thickness of the targeted texture. `true` = Slim (3 px), `false` = Classic (4 px). |
| `scale` | `number` | `1` | Model scale factor. The larger this, the bigger the 3D model appears. |
| `resetId` | `number` | `0` | Rotation reset trigger. This should be a Svelte 5 `$state`. Once it changes, an internal `$effect` resets the model rotation angle. |

## The Shader

Shader is the core of `tiny-skin-viewer`. Most of its code lies in the shader. (And that's the reason why we dare to claim it "tiny")

The shader file `src/lib/shader.wgsl` **is generated** by `scripts/generate-shader.ts`. You should only edit the shader indirectly through the generator.

After editing the generator, regenerate both the `.wgsl` and `.ts` shader files:

```sh
deno task generate-shader
```

### Build

This package uses `@sveltejs/package` to build the library for npm:

```sh
deno task package
# → outputs to dist/
```

<details>
    <summary>In-depth shader introductions. You probably don't want to care these.</summary>

### Bind group layout

**@group(0) — uniform buffer** (20 bytes, `UNIFORM | COPY_DST`)

| offset | field         | description                                 |
| ------ | ------------- | ------------------------------------------- |
| 0      | `time: f32`   | elapsed seconds, drives limb swing          |
| 4      | `rotY: f32`   | horizontal rotation angle (rad)             |
| 8      | `rotX: f32`   | vertical tilt angle, clamp ±1.5 rad         |
| 12     | `isSlim: f32` | 0 = Steve, 1 = Alex (shrinks arm width 25%) |
| 16     | `scale: f32`  | uniform model scale (1 = default)           |

**@group(1) — texture + sampler**

| binding | resource          | detail                                                    |
| ------- | ----------------- | --------------------------------------------------------- |
| 0       | `texture_2d<f32>` | format `rgba8unorm`, 64×64, `TEXTURE_BINDING \| COPY_DST` |
| 1       | `sampler`         | `nearest` filtering (pixel art)                           |

### Hardcoded in shader

- **Projection**: 60° FOV, 0.1–10 clip range, 800×600 aspect
- **View**: camera at (0, 0, 4) looking at origin
- **Cube**: 36 vertices (12 triangles, 6 faces), half-extent 0.5
- **UV layout**: standard 64×64 Minecraft skin mapping, 6 faces per body part
- **Animation**: arms & legs swing via `sin(time × 4) × 0.6`, pivoted at shoulder/hip joint

### Render pipeline

- **Depth**: `depth24plus`, write enabled, compare `less`
- **Clear**: `{0, 0, 0, 0}` (transparent), `alphaMode: premultiplied`
- **Draw**: single `draw(216)` — 6 parts × 36 vertices

</details>

## Development

### Formatting before pushing

Deno lacks support for Svelte, so we use `oxfmt` to format code. It's in `devDependencies` so it should be available if you have installed npm dependencies.

```
deno x oxfmt
```

### Publishing workflow

1. Change version in `deno.jsonc` and `package.json`
2. Tag & push — CI does the rest:

```bash
git tag v0.1.1 && git push --tags
```

The CI workflow will:

- Build the package via `@sveltejs/package`
- Publish to **JSR** (`@feniota/tiny-skin-viewer`)
- Publish to **npm** (`tiny-skin-viewer`)

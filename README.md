# TinySkinViewer

GPU-driven Minecraft skin viewer. All rendering — model transform, limb animation, skin sampling, scale — runs in a single WGSL shader. CPU only feeds 5 floats per frame.

## vs. [bs-community/skinview3d](https://github.com/bs-community/skinview3d)

| | skinview3d | TinySkinViewer |
|---|---|---|
| **Runtime payload** | 520 KB | **13 KB**  |
| **Dependencies** | three.js | **none** (raw WebGPU) |
| **GPU API** | WebGL 1 / 2 | WebGPU |

---

## Svelte component

```svelte
<script>
    import { SkinViewer } from "tiny-skin-viewer";
</script>

<SkinViewer
    skinUrl="/skin1.png"   <!-- texture URL, default /skin1.png -->
    isSlim                 <!-- Alex arms (3 px) -->
    scale={1.5}            <!-- uniform zoom -->
    resetId={resetCount}   <!-- bump to reset rotation -->
/>
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `skinUrl` | `string` | `"/skin1.png"` | 64×64 skin texture |
| `isSlim` | `boolean` | `false` | Alex (3 px arms) vs Steve (4 px) |
| `scale` | `number` | `1` | uniform model scale |
| `resetId` | `number` | `0` | triggers rotation reset on change |

---

## Shader (generator only)

The shader file `src/lib/shader.wgsl` **is generated** by `scripts/generate-shader.ts`. You should only edit the shader indirectly through the generator — updating body part dimensions, UV rectangles, or animation parameters there.

```sh
deno run --allow-write scripts/generate-shader.ts
```

### Bind group layout

**@group(0) — uniform buffer** (20 bytes, `UNIFORM | COPY_DST`)

| offset | field | description |
|---|---|---|
| 0 | `time: f32` | elapsed seconds, drives limb swing |
| 4 | `rotY: f32` | horizontal rotation angle (rad) |
| 8 | `rotX: f32` | vertical tilt angle, clamp ±1.5 rad |
| 12 | `isSlim: f32` | 0 = Steve, 1 = Alex (shrinks arm width 25%) |
| 16 | `scale: f32` | uniform model scale (1 = default) |

**@group(1) — texture + sampler**

| binding | resource | detail |
|---|---|---|
| 0 | `texture_2d<f32>` | format `rgba8unorm`, 64×64, `TEXTURE_BINDING \| COPY_DST` |
| 1 | `sampler` | `nearest` filtering (pixel art) |

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

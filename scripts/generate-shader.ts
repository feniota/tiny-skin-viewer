/**
 * generate-shader.ts — Minecraft skin shader generator
 *
 * Reads body part definitions (texOffs data from the decompiled
 * PlayerModel.java) and emits a WGSL vertex+ fragment shader.
 *
 * Each part has a BASE layer (indices 0-6) and an OVERLAY layer
 * (indices 7-13) — same position, slightly larger, with transparent
 * alpha using the skin texture's second-layer UV area.
 *
 * Cape (indices 6, 13) is handled specially in the vertex shader
 * with pendulum physics computed entirely on the GPU.
 *
 *   West   (-X) → face 5  [u,      v+d, u+d,    v+d+h]
 *   South  (+Z) → face 0  [u+d,    v+d, u+d+w,  v+d+h]
 *   East   (+X) → face 4  [u+d+w,  v+d, u+d+w+d,v+d+h]
 *   North  (-Z) → face 1  [u+d+w+d,v+d, u+d+w+d+w,v+d+h]
 *   Up     (+Y) → face 2  [u+d,    v,   u+d+w,  v+d]
 *   Down   (-Y) → face 3  [u+d+w,  v,   u+d+w+d,v+d]
 */

// ── constants ────────────────────────────────────────────────────

const PX = 1 / 16; // 1 pixel → block units
const Y0 = 16 * PX; // vertical centering (model is 32 px tall)
const T = 1 / 64; // 1 texture pixel → normalised UV
const PIVOT_Y = 6 * PX; // arm/leg pivot Y
const OVERLAY_EXT = 0.25; // pixels outward per face (extends both sides)

// ── helpers ──────────────────────────────────────────────────────

/** Compute 6 face UV rects from Minecraft texOffs + box dimensions */
function boxUV(u: number, v: number, w: number, h: number, d: number) {
  type Rect = [number, number, number, number];
  return <const>[
    [u + d, v + d, u + d + w, v + d + h] satisfies Rect, // 0 +Z front   = South
    [u + d + w + d, v + d, u + d + w + d + w, v + d + h] satisfies Rect, // 1 -Z back    = North
    [u + d, v, u + d + w, v + d] satisfies Rect, // 2 +Y top     = Up
    [u + d + w, v, u + d + w + d, v + d] satisfies Rect, // 3 -Y bottom  = Down
    [u + d + w, v + d, u + d + w + d, v + d + h] satisfies Rect, // 4 +X right   = East
    [u, v + d, u + d, v + d + h] satisfies Rect, // 5 -X left    = West
  ];
}

/** Like boxUV but with a reduced width (ws) for faces 0/1/2 (the ones
 *  that map `w` along U).  Used for slim arms where the texture artist
 *  only draws 3px of arm in a 4px-wide UV slot. */
function boxUV_slim(u: number, v: number, w: number, h: number, d: number, ws: number) {
  type Rect = [number, number, number, number];
  return <const>[
    [u + d, v + d, u + d + ws, v + d + h] satisfies Rect, // 0 +Z front   = South (narrowed)
    [u + d + w + d, v + d, u + d + w + d + ws, v + d + h] satisfies Rect, // 1 -Z back    = North (narrowed)
    [u + d, v, u + d + ws, v + d] satisfies Rect, // 2 +Y top     = Up (narrowed)
    [u + d + w, v, u + d + w + d, v + d] satisfies Rect, // 3 -Y bottom  = Down (unchanged)
    [u + d + w, v + d, u + d + w + d, v + d + h] satisfies Rect, // 4 +X right   = East (unchanged)
    [u, v + d, u + d, v + d + h] satisfies Rect, // 5 -X left    = West (unchanged)
  ];
}

// ── part definitions ─────────────────────────────────────────────

interface Part {
  name: string;
  px: number;
  py: number;
  pz: number; // centre (Minecraft pixel coords)
  sx: number;
  sy: number;
  sz: number; // model extents (pixels, expanded for overlay)
  uvW: number;
  uvH: number;
  uvD: number; // UV extents (always base dimensions)
  phase: number; // 0 = static, ±1 = ±sin(time)
  u: number;
  v: number; // texOffs origin (64×64 space)
}

type PartDef = Pick<
  Part,
  "name" | "px" | "py" | "pz" | "sx" | "sy" | "sz" | "uvW" | "uvH" | "uvD" | "phase"
> & {
  u: number;
  v: number; // base texOffs
  overlayUv: [number, number]; // overlay texOffs
};

const partDefs: PartDef[] = [
  //  name         centre (px)       size (px)       UV dims        phase  baseU  baseV  ovU  ovV
  {
    name: "head",
    px: 0,
    py: 28,
    pz: 0,
    sx: 8,
    sy: 8,
    sz: 8,
    uvW: 8,
    uvH: 8,
    uvD: 8,
    phase: 0,
    u: 0,
    v: 0,
    overlayUv: [32, 0],
  },
  {
    name: "body",
    px: 0,
    py: 18,
    pz: 0,
    sx: 8,
    sy: 12,
    sz: 4,
    uvW: 8,
    uvH: 12,
    uvD: 4,
    phase: 0,
    u: 16,
    v: 16,
    overlayUv: [16, 32],
  },
  {
    name: "right_arm",
    px: -6,
    py: 18,
    pz: 0,
    sx: 4,
    sy: 12,
    sz: 4,
    uvW: 4,
    uvH: 12,
    uvD: 4,
    phase: 1,
    u: 40,
    v: 16,
    overlayUv: [40, 32],
  },
  {
    name: "left_arm",
    px: 6,
    py: 18,
    pz: 0,
    sx: 4,
    sy: 12,
    sz: 4,
    uvW: 4,
    uvH: 12,
    uvD: 4,
    phase: -1,
    u: 32,
    v: 48,
    overlayUv: [48, 48],
  },
  {
    name: "right_leg",
    px: -2,
    py: 6,
    pz: 0,
    sx: 4,
    sy: 12,
    sz: 4,
    uvW: 4,
    uvH: 12,
    uvD: 4,
    phase: -1,
    u: 0,
    v: 16,
    overlayUv: [0, 32],
  },
  {
    name: "left_leg",
    px: 2,
    py: 6,
    pz: 0,
    sx: 4,
    sy: 12,
    sz: 4,
    uvW: 4,
    uvH: 12,
    uvD: 4,
    phase: 1,
    u: 16,
    v: 48,
    overlayUv: [0, 48],
  },
  {
    name: "cape",
    px: 0,
    py: 16,
    pz: -0.7,
    sx: 10,
    sy: 16,
    sz: 1,
    uvW: 10,
    uvH: 16,
    uvD: 1,
    phase: 0,
    u: 0,
    v: 0,
    overlayUv: [0, 0],
  },
];

// Build combined parts array: indices 0-6 = base, 7-13 = overlay
const baseParts: Part[] = partDefs.map(d => ({
  name: d.name,
  px: d.px,
  py: d.py,
  pz: d.pz,
  sx: d.sx,
  sy: d.sy,
  sz: d.sz,
  uvW: d.uvW,
  uvH: d.uvH,
  uvD: d.uvD,
  phase: d.phase,
  u: d.u,
  v: d.v,
}));
const overlayParts: Part[] = partDefs.map(d => ({
  name: d.name + "_overlay",
  px: d.px,
  py: d.py,
  pz: d.pz,
  sx: d.sx + OVERLAY_EXT * 2, // model expands
  sy: d.sy + OVERLAY_EXT * 2,
  sz: d.sz + OVERLAY_EXT * 2,
  uvW: d.uvW,
  uvH: d.uvH,
  uvD: d.uvD, // UV stays base size
  phase: d.phase,
  u: d.overlayUv[0],
  v: d.overlayUv[1],
}));
// Cape overlay should not expand — no separate overlay texture, so expanding
// it makes the 1-px-thick cape look visibly thicker for no benefit.
const capeIdx = partDefs.findIndex(d => d.name === "cape");
overlayParts[capeIdx].sx = partDefs[capeIdx].sx;
overlayParts[capeIdx].sy = partDefs[capeIdx].sy;
overlayParts[capeIdx].sz = partDefs[capeIdx].sz;

const parts = [...baseParts, ...overlayParts];

// ── unit cube geometry ───────────────────────────────────────────

const CUBE: [number, number, number][] = [
  // +Z front (face 0)
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5],
  // -Z back (face 1)
  [0.5, -0.5, -0.5],
  [-0.5, -0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [0.5, -0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [0.5, 0.5, -0.5],
  // +Y top (face 2)
  [-0.5, 0.5, 0.5],
  [0.5, 0.5, 0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, 0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5],
  // -Y bottom (face 3)
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, -0.5, 0.5],
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, 0.5],
  [-0.5, -0.5, 0.5],
  // +X right (face 4)
  [0.5, -0.5, 0.5],
  [0.5, -0.5, -0.5],
  [0.5, 0.5, -0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, -0.5],
  [0.5, 0.5, 0.5],
  // -X left (face 5)
  [-0.5, -0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [-0.5, 0.5, 0.5],
  [-0.5, -0.5, -0.5],
  [-0.5, 0.5, 0.5],
  [-0.5, 0.5, -0.5],
];

// ── derived values ────────────────────────────────────────────────

const partCount = parts.length;
const totalVertices = partCount * CUBE.length;
const uvf = (n: number) => (n * T).toFixed(5);

// ── compute UVs ──────────────────────────────────────────────────

const partUVs = parts.map(p => boxUV(p.u, p.v, p.uvW, p.uvH, p.uvD));

/** Slim-arm UV variants for parts 2, 3, 9, 10 (right_arm, left_arm,
 *  right_arm_overlay, left_arm_overlay).  The texture only draws 3 px
 *  of arm in the 4‑px‑wide UV slot, so faces that map `w` (0,1,2)
 *  must use ws=3 instead of w=4.  The other faces are unchanged. */
const slimPartIndices = [2, 3, 9, 10];
const partUVsSlim = partUVs.map((uv, i) =>
  slimPartIndices.includes(i)
    ? boxUV_slim(parts[i].u, parts[i].v, parts[i].uvW, parts[i].uvH, parts[i].uvD, 3)
    : uv,
);

// ── generate WGSL fragments ──────────────────────────────────────

console.log(`Generating shader for ${partCount} body parts…`);

// Part names for WGSL constant arrays
const uvName = (i: number) => {
  const names = [
    "head",
    "body",
    "rarm",
    "larm",
    "rleg",
    "lleg",
    "cape",
    "head_ov",
    "body_ov",
    "rarm_ov",
    "larm_ov",
    "rleg_ov",
    "lleg_ov",
    "cape_ov",
  ];
  return names[i];
};

// Parts array
const partLines = parts
  .map((p, i) => {
    const comma = i < parts.length - 1 ? "," : "";
    return `    Part(vec3f(${(p.px * PX).toFixed(4)}, ${(p.py * PX - Y0).toFixed(4)}, ${(p.pz * PX).toFixed(4)}), vec3f(${(p.sx * PX).toFixed(4)}, ${(p.sy * PX).toFixed(4)}, ${(p.sz * PX).toFixed(4)}))${comma} // ${p.name}`;
  })
  .join("\n");

// ── helper: format a single UV array block ─────────────────────────

function formatUVBlock(
  name: string,
  uv: readonly [number, number, number, number][],
  isCape: boolean,
) {
  if (isCape) {
    const capeFaceUV: [number, number, number, number][] = [
      [1, 1, 11, 17], // +Z outward
      [12, 1, 22, 17], // -Z inward
      [1, 0, 11, 1], // +Y top
      [11, 0, 21, 1], // -Y bottom
      [11, 1, 12, 17], // +X right
      [0, 1, 1, 17], // -X left
    ];
    const uvW = 64,
      uvH = 32;
    const faces = capeFaceUV
      .map(
        ([x0, y0, x1, y1]) =>
          `    FaceUV(vec2f(${(x0 / uvW).toFixed(5)}, ${(y0 / uvH).toFixed(5)}), vec2f(${(x1 / uvW).toFixed(5)}, ${(y1 / uvH).toFixed(5)}))`,
      )
      .join(",\n");
    return `const uv_${name} = array<FaceUV, 6>(\n${faces}\n);`;
  }
  const faces = uv
    .map(
      ([x0, y0, x1, y1]) =>
        `    FaceUV(vec2f(${uvf(x0)}, ${uvf(y0)}), vec2f(${uvf(x1)}, ${uvf(y1)}))`,
    )
    .join(",\n");
  return `const uv_${name} = array<FaceUV, 6>(\n${faces}\n);`;
}

// UV arrays
const uvBlocks = parts
  .map((_p, i) => formatUVBlock(uvName(i), partUVs[i], i === 6 || i === 13))
  .join("\n\n");

// Slim UV variants for arm parts
const slimUVBlocks = [2, 3, 9, 10]
  .map(i => formatUVBlock(`${uvName(i)}_slim`, partUVsSlim[i], false))
  .join("\n\n");

// Animation phases
const phases = parts.map(p => p.phase.toFixed(1)).join(", ");

console.log(`  ✓ ${partCount} parts, ${totalVertices} vertices`);

// ── WGSL template ─────────────────────────────────────────────────

const wgsl = `// Auto-generated by scripts/generate-shader.ts
// ${partCount} parts × ${CUBE.length} vertices = ${totalVertices} vertices total

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) is_cape: f32,
}

struct Uniforms {
    time: f32,
    rot_y: f32,
    rot_x: f32,
    is_slim: f32,
    scale: f32,
    aspect: f32,
    has_cape: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var skin: texture_2d<f32>;
@group(1) @binding(1) var skin_sampler: sampler;
@group(1) @binding(2) var cape_tex: texture_2d<f32>;

// ── matrix helpers ────────────────────────────────────────────────

fn mul4(a: mat4x4f, b: mat4x4f) -> mat4x4f {
    return mat4x4f(a * b[0], a * b[1], a * b[2], a * b[3]);
}
fn rotate_x(a: f32) -> mat4x4f {
    let c = cos(a); let s = sin(a);
    return mat4x4f(vec4f(1,0,0,0), vec4f(0,c,s,0), vec4f(0,-s,c,0), vec4f(0,0,0,1));
}
fn rotate_y(a: f32) -> mat4x4f {
    let c = cos(a); let s = sin(a);
    return mat4x4f(vec4f(c,0,-s,0), vec4f(0,1,0,0), vec4f(s,0,c,0), vec4f(0,0,0,1));
}
fn rotate_z(a: f32) -> mat4x4f {
    let c = cos(a); let s = sin(a);
    return mat4x4f(vec4f(c,s,0,0), vec4f(-s,c,0,0), vec4f(0,0,1,0), vec4f(0,0,0,1));
}

// ── cube geometry ─────────────────────────────────────────────────

const cube = array<vec3f, ${CUBE.length}>(
${CUBE.map(([x, y, z]) => `    vec3f(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`).join(",\n")}
);

const cube_uv = array<vec2f, ${CUBE.length}>(
${Array(6).fill("    vec2f(0,0), vec2f(1,0), vec2f(1,1),\n    vec2f(0,0), vec2f(1,1), vec2f(0,1)").join(",\n")}
);

// ── body parts ────────────────────────────────────────────────────

struct Part { pos: vec3f, size: vec3f }

const parts = array<Part, ${partCount}>(
${partLines}
);

const phases = array<f32, ${partCount}>(${phases});
const pivot_y = ${PIVOT_Y.toFixed(4)}f;

// ── UV rectangles per part × face ─────────────────────────────────

struct FaceUV { min: vec2f, max: vec2f }

${uvBlocks}

${slimUVBlocks}

fn uv_for_part(part_id: u32, face: u32, is_slim: f32) -> FaceUV {
    switch part_id {
        case 0u  { return uv_head[face]; }
        case 1u  { return uv_body[face]; }
        case 2u  { return select(uv_rarm[face], uv_rarm_slim[face], is_slim != 0.0); }
        case 3u  { return select(uv_larm[face], uv_larm_slim[face], is_slim != 0.0); }
        case 4u  { return uv_rleg[face]; }
        case 5u  { return uv_lleg[face]; }
        case 6u  { return uv_cape[face]; }
        case 7u  { return uv_head_ov[face]; }
        case 8u  { return uv_body_ov[face]; }
        case 9u  { return select(uv_rarm_ov[face], uv_rarm_ov_slim[face], is_slim != 0.0); }
        case 10u { return select(uv_larm_ov[face], uv_larm_ov_slim[face], is_slim != 0.0); }
        case 11u { return uv_rleg_ov[face]; }
        case 12u { return uv_lleg_ov[face]; }
        default  { return uv_cape_ov[face]; }
    }
}

// ── camera ────────────────────────────────────────────────────────

fn projection() -> mat4x4f {
    let fov = 3.14159265359 / 3.0;
    let near = 0.1; let far = 10.0;
    let f = 1.0 / tan(fov * 0.5);
    let aspect = uniforms.aspect;
    return mat4x4f(
        vec4f(f/aspect,0,0,0), vec4f(0,f,0,0),
        vec4f(0,0,-far/(far-near),-1), vec4f(0,0,-(far*near)/(far-near),0),
    );
}
fn view() -> mat4x4f {
    return mat4x4f(
        vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(0,0,-4,1),
    );
}

// ── vertex shader ─────────────────────────────────────────────────

@vertex
fn vs_main(@builtin(vertex_index) id: u32) -> VertexOutput {
    let part_id   = id / ${CUBE.length}u;
    let vertex_id = id % ${CUBE.length}u;
    let part      = parts[part_id];
    let face      = vertex_id / 6u;

    var sz = part.size;
    // Apply slim arm width for base arms (2,3) and overlay arms (9,10)
    if (part_id == 2u || part_id == 3u || part_id == 9u || part_id == 10u) {
        sz.x *= 1.0 - uniforms.is_slim * 0.25;
    }
    var p = cube[vertex_id] * sz;

    // ── limb swing animation (parts 0-6: base, 7-12: overlay) ──
    if (part_id != 6u && part_id != 13u) {
        let phase = phases[part_id];
        if phase != 0.0 {
            let speed = 4.0;
            let max_angle = 0.6;
            let angle = max_angle * sin(uniforms.time * speed) * phase;
            let pivot = vec3f(0.0, pivot_y, 0.0);
            p = (rotate_x(angle) * vec4f(p - pivot, 1.0)).xyz + pivot;
        }
    }

    // ── cape animation (part_id 6 = base, 13 = overlay) ─────────
    if (part_id == 6u || part_id == 13u) {
        if (uniforms.has_cape == 0.0) {
            p = vec3f(0.0);
        } else {
            // Pivot at the top of the cape (body centre level, attachment point)
            let cape_pivot = vec3f(0.0, part.pos.y + part.size.y * 0.5, part.pos.z);

            // Match Minecraft cape animation:
            //   X rot = (6° baseTilt + capeLean/2 + flap) × PI/180
            //   flap  = sin(walkDist × 6.0) × 32° × pow   (walking-driven)
            //   lean  ≈ 25°                                 (walking at ~0.5 b/s)
            //   pow   ≈ 0.5 for walking → flap amplitude ≈ 16°
            //
            // Our walk cycle (time × 4.0) is slower than the actual game, so the
            // cape flap frequency is reduced accordingly (× 3.0 instead of × 6.0).
            let walk   = uniforms.time * 4.0;
            let flap   = sin(walk * 2.0) * 0.07;   // ~16° amplitude
            let angle_x = 0.60 + flap;

            // First rotate by PI around Y (face backward), then tilt the cape
            // AWAY from the body (negative X rotation in our coordinate system)
            let cape_rot = mul4(rotate_y(3.14159), rotate_x(-angle_x));
            p = (cape_rot * vec4f(p - cape_pivot, 1.0)).xyz + cape_pivot;
        }
    }

    p += part.pos;

    let model = mul4(rotate_y(uniforms.rot_y), rotate_x(-uniforms.rot_x));
    let pv = mul4(mul4(projection(), view()), model);

    let fuv  = cube_uv[vertex_id];
    let rect = uv_for_part(part_id, face, uniforms.is_slim);
    let tex_uv = vec2f(
        rect.min.x + fuv.x * (rect.max.x - rect.min.x),
        rect.max.y - fuv.y * (rect.max.y - rect.min.y),
    );

    var out: VertexOutput;
    out.position = pv * vec4f(p * uniforms.scale, 1.0);
    out.uv       = tex_uv;
    out.is_cape  = f32(part_id == 6u || part_id == 13u);
    return out;
}

// ── fragment shader ───────────────────────────────────────────────

@fragment
fn fs_main(@location(0) uv: vec2f, @location(1) is_cape: f32) -> @location(0) vec4f {
    let base = textureSample(skin, skin_sampler, uv);
    let cape = textureSample(cape_tex, skin_sampler, uv);
    return mix(base, cape, is_cape);
}
`;

// ── write files ───────────────────────────────────────────────────

await Deno.writeTextFile("src/lib/shader.wgsl", wgsl);
await Deno.writeTextFile(
  "src/lib/shader.ts",
  `// Auto-generated by scripts/generate-shader.ts\nconst shaderCode: string = ${JSON.stringify(wgsl)};\nexport default shaderCode;\n`,
);

console.log(`\n✅  src/lib/shader.wgsl  (${(wgsl.length / 1024).toFixed(1)} KB)`);
console.log(`✅  src/lib/shader.ts   (${partCount} parts, ${totalVertices} verts)`);

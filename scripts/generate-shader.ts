/**
 * generate-shader.ts — Minecraft skin shader generator
 *
 * Reads Steve/Alex body part definitions (pixel coords, UV mapping) and
 * emits `src/lib/shader.wgsl`, a complete WGSL vertex + fragment shader
 * that renders an animated, textured player model.
 *
 * Usage:  deno run --allow-write scripts/generate-shader.ts
 *
 * All rendering logic lives in the generated shader:
 *   · Vertex transformation (projection, view, model rotation)
 *   · Limb swing animation (arms & legs via time-driven sine)
 *   · Slim/Alex arm-width adjustment (isSlim uniform)
 *   · Skin texture sampling with per-face UV rectangles
 *   · Uniform scale
 *
 * CPU only feeds 5 f32 values per frame: time, rotY, rotX, isSlim, scale.
 *
 * Conventions:
 *   · Minecraft Java Edition player model: 16 px = 1 block
 *   · Coordinate origin at feet, Y up
 *   · Model centered vertically (shift −1 block) for the viewport
 *   · Skin texture: 64×64 px, UVs as normalised [0, 1]
 *   · Cube faces: 0=+Z(front) 1=−Z(back) 2=+Y(top) 3=−Y(bottom) 4=+X(right) 5=−X(left)
 */

// ── constants ────────────────────────────────────────────────────

const PX = 1 / 16;        // 1 pixel → block units
const Y0 = 16 * PX;       // vertical centering offset (model is 32 px tall)
const T  = 1 / 64;        // 1 texture pixel → normalised UV
const PIVOT_Y = 6 * PX;   // arm/leg pivot: half limb height = 6 px above centre

// ── data types ────────────────────────────────────────────────────

/** One body part (head / body / arm / leg) */
interface Part {
    name: string;
    /** centre position in Minecraft pixel coords */
    px: number; py: number; pz: number;
    /** dimensions in pixels (full extents, not half) */
    sx: number; sy: number; sz: number;
    /** animation phase: 0 = static, ±1 = ±sin(time) */
    phase: number;
    /**
     * Texture UV rectangles for 6 faces.
     * Each entry: [x0, y0, x1, y1] in 64×64 pixel space.
     * Face order: front(+Z) back(−Z) top(+Y) bottom(−Y) right(+X) left(−X)
     */
    uv: [number, number, number, number][];
}

// ── body part definitions (Minecraft Java Edition player model) ──

const parts: Part[] = [
    // name          centre (px)    size (px)  phase  UV rectangles (6 faces)
    //               x   y   z      x  y  z
    { name: "head", px: 0, py:28, pz: 0, sx: 8, sy: 8, sz: 8, phase: 0,
      uv: [[ 8, 8,16,16],[24, 8,32,16],[ 8, 0,16, 8],[16, 0,24, 8],[ 0, 8, 8,16],[16, 8,24,16]] },
    { name: "body", px: 0, py:18, pz: 0, sx: 8, sy:12, sz: 4, phase: 0,
      uv: [[20,20,28,32],[32,20,40,32],[20,16,28,20],[28,16,36,20],[16,20,20,32],[28,20,32,32]] },
    { name: "right_arm", px:-6, py:18, pz: 0, sx: 4, sy:12, sz: 4, phase: 1,
      uv: [[44,20,48,32],[52,20,56,32],[44,16,48,20],[48,16,52,20],[40,20,44,32],[48,20,52,32]] },
    { name: "left_arm", px: 6, py:18, pz: 0, sx: 4, sy:12, sz: 4, phase: -1,
      uv: [[36,52,40,64],[52,52,56,64],[36,48,40,52],[48,48,52,52],[40,52,44,64],[48,52,52,64]] },
    { name: "right_leg", px:-2, py: 6, pz: 0, sx: 4, sy:12, sz: 4, phase: -1,
      uv: [[ 4,20, 8,32],[12,20,16,32],[ 4,16, 8,20],[ 8,16,12,20],[ 0,20, 4,32],[ 8,20,12,32]] },
    { name: "left_leg", px: 2, py: 6, pz: 0, sx: 4, sy:12, sz: 4, phase: 1,
      uv: [[20,52,24,64],[28,52,32,64],[20,48,24,52],[28,48,32,52],[24,52,28,64],[32,52,36,64]] },
];

// ── unit cube geometry ───────────────────────────────────────────

/** 36 vertices (12 triangles, 2 per face), CCW winding, half-extent 0.5 */
const CUBE: [number, number, number][] = [
    // +Z front
    [-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5, 0.5, 0.5],
    [-0.5,-0.5, 0.5],[ 0.5, 0.5, 0.5],[-0.5, 0.5, 0.5],
    // −Z back
    [ 0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],
    [ 0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],
    // +Y top
    [-0.5, 0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5, 0.5,-0.5],
    [-0.5, 0.5, 0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5],
    // −Y bottom
    [-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],
    [-0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],[-0.5,-0.5, 0.5],
    // +X right
    [ 0.5,-0.5, 0.5],[ 0.5,-0.5,-0.5],[ 0.5, 0.5,-0.5],
    [ 0.5,-0.5, 0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.5, 0.5],
    // −X left
    [-0.5,-0.5,-0.5],[-0.5,-0.5, 0.5],[-0.5, 0.5, 0.5],
    [-0.5,-0.5,-0.5],[-0.5, 0.5, 0.5],[-0.5, 0.5,-0.5],
];

// ── derived values ────────────────────────────────────────────────

const partCount = parts.length;
const totalVertices = partCount * CUBE.length;

/** Format a pixel value to a normalised 5-decimal float for WGSL */
const uvf = (n: number) => (n * T).toFixed(5);

// ── generate WGSL fragments ──────────────────────────────────────

console.log(`Generating shader for ${partCount} body parts…`);

// Parts array (positions in block units after centering)
const partLines = parts.map((p, i) => {
    const comma = i < parts.length - 1 ? "," : "";
    return `    Part(vec3f(${(p.px * PX).toFixed(4)}, ${(p.py * PX - Y0).toFixed(4)}, ${(p.pz * PX).toFixed(4)}), vec3f(${(p.sx * PX).toFixed(4)}, ${(p.sy * PX).toFixed(4)}, ${(p.sz * PX).toFixed(4)}))${comma} // ${p.name}`;
}).join("\n");
console.log(`  ✓ positions: ${partCount} parts`);

// UV rectangles per part × face
const uvBlocks = parts.map((p, i) => {
    const names = ["head", "body", "rarm", "larm", "rleg", "lleg"];
    const faces = p.uv.map(([x0, y0, x1, y1]) =>
        `    FaceUV(vec2f(${uvf(x0)}, ${uvf(y0)}), vec2f(${uvf(x1)}, ${uvf(y1)}))`
    ).join(",\n");
    const uvCount = p.uv.length;
    console.log(`    · ${p.name.padEnd(10)} ${uvCount} faces, ${p.uv.reduce((s, r) => s + (r[2]-r[0])*(r[3]-r[1]), 0)} px²`);
    return `const uv_${names[i]} = array<FaceUV, 6>(\n${faces}\n);`;
}).join("\n\n");
console.log(`  ✓ UV rects: ${parts.length} parts × 6 faces`);

// Cube vertex positions
const cubeLines = CUBE.map(([x, y, z]) =>
    `    vec3f(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`
).join(",\n");
console.log(`  ✓ cube: ${CUBE.length} vertices`);

// Animation summary
const animated = parts.filter(p => p.phase !== 0);
console.log(`  ✓ animation: ${animated.length} limbs (${animated.map(p => p.name).join(", ")})`);

// ── WGSL template ─────────────────────────────────────────────────

const wgsl = `// Auto-generated by scripts/generate-shader.ts — Steve player model
// ${partCount} parts × ${CUBE.length} vertices = ${totalVertices} vertices total

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

struct Uniforms {
    time: f32,
    rotY: f32,
    rotX: f32,
    isSlim: f32,
    scale: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var skin: texture_2d<f32>;
@group(1) @binding(1) var skin_sampler: sampler;

fn mul4(a: mat4x4f, b: mat4x4f) -> mat4x4f {
    return mat4x4f(a * b[0], a * b[1], a * b[2], a * b[3]);
}

fn rotate_x(a: f32) -> mat4x4f {
    let c = cos(a);
    let s = sin(a);
    return mat4x4f(
        vec4f(1.0, 0.0,  0.0, 0.0),
        vec4f(0.0, c,    s,   0.0),
        vec4f(0.0, -s,   c,   0.0),
        vec4f(0.0, 0.0,  0.0, 1.0),
    );
}

fn rotate_y(a: f32) -> mat4x4f {
    let c = cos(a);
    let s = sin(a);
    return mat4x4f(
        vec4f(c, 0.0, -s, 0.0),
        vec4f(0.0, 1.0, 0.0, 0.0),
        vec4f(s, 0.0, c, 0.0),
        vec4f(0.0, 0.0, 0.0, 1.0),
    );
}

const cube = array<vec3f, ${CUBE.length}>(
${cubeLines}
);

const cube_uv = array<vec2f, ${CUBE.length}>(
${Array(6).fill("    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),\n    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0)").join(",\n")}
);

struct Part {
    pos: vec3f,
    size: vec3f,
}

const parts = array<Part, ${partCount}>(
${partLines}
);

const phases = array<f32, ${partCount}>(${parts.map(p => p.phase.toFixed(1)).join(", ")});
const pivot_y = ${PIVOT_Y.toFixed(4)}f;

struct FaceUV { min: vec2f, max: vec2f }

${uvBlocks}

fn uv_for_part(part_id: u32, face: u32) -> FaceUV {
    switch part_id {
        case 0u { return uv_head[face]; }
        case 1u { return uv_body[face]; }
        case 2u { return uv_rarm[face]; }
        case 3u { return uv_larm[face]; }
        case 4u { return uv_rleg[face]; }
        default  { return uv_lleg[face]; }
    }
}

fn projection() -> mat4x4f {
    let fov    = 3.14159265359 / 3.0;
    let near   = 0.1;
    let far    = 10.0;
    let f      = 1.0 / tan(fov * 0.5);
    let aspect = 800.0 / 600.0;
    return mat4x4f(
        vec4f(f / aspect, 0.0, 0.0,                    0.0),
        vec4f(0.0,         f,   0.0,                    0.0),
        vec4f(0.0,         0.0, -far / (far - near),   -1.0),
        vec4f(0.0,         0.0, -(far * near) / (far - near), 0.0),
    );
}

fn view() -> mat4x4f {
    return mat4x4f(
        vec4f(1.0, 0.0, 0.0, 0.0),
        vec4f(0.0, 1.0, 0.0, 0.0),
        vec4f(0.0, 0.0, 1.0, 0.0),
        vec4f(0.0, 0.0, -4.0, 1.0),
    );
}

@vertex
fn vs_main(@builtin(vertex_index) id: u32) -> VertexOutput {
    let part_id   = id / ${CUBE.length}u;
    let vertex_id = id % ${CUBE.length}u;
    let part      = parts[part_id];
    let face      = vertex_id / 6u;

    var sz = part.size;
    if (part_id == 2u || part_id == 3u) {
        sz.x *= 1.0 - uniforms.isSlim * 0.25;
    }
    var p = cube[vertex_id] * sz;

    let phase = phases[part_id];
    if phase != 0.0 {
        let speed     = 4.0;
        let max_angle = 0.6;
        let angle     = max_angle * sin(uniforms.time * speed) * phase;
        let pivot     = vec3f(0.0, pivot_y, 0.0);
        p = (rotate_x(angle) * vec4f(p - pivot, 1.0)).xyz + pivot;
    }
    p += part.pos;

    let model = mul4(rotate_y(uniforms.rotY), rotate_x(-uniforms.rotX));
    let pv = mul4(mul4(projection(), view()), model);

    let fuv  = cube_uv[vertex_id];
    let rect = uv_for_part(part_id, face);
    let tex_uv = vec2f(
        rect.min.x + fuv.x * (rect.max.x - rect.min.x),
        rect.max.y - fuv.y * (rect.max.y - rect.min.y),
    );

    var out: VertexOutput;
    out.position = pv * vec4f(p * uniforms.scale, 1.0);
    out.uv       = tex_uv;
    return out;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    return textureSample(skin, skin_sampler, uv);
}
`;

// ── write output ──────────────────────────────────────────────────

const outPath = "src/lib/shader.wgsl";
await Deno.writeTextFile(outPath, wgsl);

const kb = (wgsl.length / 1024).toFixed(1);
console.log(`\n✅  ${outPath}`);
console.log(`    ${totalVertices} vertices, ${kb} KB, ${partCount} parts × ${CUBE.length} verts`);

import { minify as minify_wgsl } from "@feniota/wasm-wgsl-minifier";
/**
 * generate-shader.ts — Minecraft skin shader generator
 *
 * Reads body part definitions (texOffs data from the decompiled
 * PlayerModel.java) and emits a WGSL vertex+ fragment shader.
 * The output goes to `src/lib/shader.wgsl` (raw WGSL) and
 * `src/lib/shader.ts` (ES module string export; minified).
 *
 * ── Architecture overview ──────────────────────────────────────────
 *
 * The model has 14 parts split into two draw calls:
 *   Draw 1: 7 base  parts (indices  0-6)  → 7 × 36 = 252 vertices
 *   Draw 2: 7 overlay parts (indices 7-13) → 7 × 36 = 252 vertices
 *   Total: 504 vertices per frame
 *
 * All parts are unit cubes scaled to voxel dimensions. Overlay parts
 * are 0.25 px larger per face (expanded outward) to create a "second
 * layer" effect common in Minecraft skin rendering.
 *
 * Limb swing and cape pendulum animation run entirely on the GPU via
 * a 28-byte uniform buffer (7 × f32) written once per frame by the
 * CPU.
 *
 * ── Face ordering ──────────────────────────────────────────────────
 *
 *   Index   Direction   Label     UV layout (boxUV)
 *   0       +Z          South     [u+d,      v+d,   u+d+w,  v+d+h]
 *   1       -Z          North     [u+d+w+d, v+d,   u+d+w+d+w,v+d+h]
 *   2       +Y          Up        [u+d,     v,     u+d+w,  v+d]
 *   3       -Y          Down      [u+d+w,   v,     u+d+w+w,v+d]
 *   4       +X          East      [u+d+w,   v+d,   u+d+w+d,v+d+h]
 *   5       -X          West      [u,       v+d,   u+d,    v+d+h]
 *
 * This matches the Minecraft PlayerModel face layout from
 * `boxUV()` which offsets each face rect by the depth `d` inward
 * from the UV origin. (See `boxUV()` below.)
 *
 * ── Model coordinate system ────────────────────────────────────────
 *
 *   +X = right (toward viewer's right)
 *   +Y = up
 *   +Z = toward viewer (south)
 *
 * The model origin is centred so that Y = 0 is the waist line
 * (feet at -0.625, head top at +1.0 in block units).
 */

// ── constants ────────────────────────────────────────────────────
// These convert between Minecraft's pixel-based coordinate system and
// the GPU's normalized floating-point space.

const PX = 1 / 16; // 1 pixel → block units (Minecraft block = 16 px)
const Y0 = 16 * PX; // Vertical centering offset: the model is 32 px tall,
// so we shift Y downward by 16 px (= 1 block unit)
// to centre the waist at origin.
const T = 1 / 64; // 1 texture pixel → normalised UV (skin is 64×64 texels)
const PIVOT_Y = 6 * PX; // Y-coordinate of arm/leg swing pivot (shoulder/hip),
// measured from the bottom of the model in pixels.
const OVERLAY_EXT = 0.25; // Pixels outward per face for overlay parts.
// Each of the 6 faces moves 0.25 px outward,
// so total expansion = 0.5 px per dimension.

// ── helpers ──────────────────────────────────────────────────────

/**
 * Compute 6 face UV rects from Minecraft texOffs + box dimensions.
 *
 * Minecraft skin textures use a "box unwrap" layout: each face is a
 * rectangle on the 2D texture, offset by the box's depth `d` so that
 * adjacent faces don't overlap. This matches the vanilla PlayerModel
 * `texOffs(u, v)` / `addBox(u, v, w, h, d)` convention.
 *
 * Face order (see diagram at top of file):
 *   0 = +Z (south), 1 = -Z (north), 2 = +Y (top),
 *   3 = -Y (bottom), 4 = +X (east), 5 = -X (west)
 *
 * @param u - starting X pixel on the 64×64 skin texture
 * @param v - starting Y pixel on the 64×64 skin texture
 * @param w - width  (X dimension) of the box in pixels
 * @param h - height (Y dimension) of the box in pixels
 * @param d - depth  (Z dimension) of the box in pixels
 * @returns array of 6 face UV rects `[u0, v0, u1, v1]` in pixel coords
 */
function boxUV(u: number, v: number, w: number, h: number, d: number) {
  type Rect = [number, number, number, number];
  return <const>[
    [u + d, v + d, u + d + w, v + d + h] satisfies Rect, // 0 +Z front   = South
    [u + d + w + d, v + d, u + d + w + d + w, v + d + h] satisfies Rect, // 1 -Z back    = North
    [u + d, v, u + d + w, v + d] satisfies Rect, // 2 +Y top     = Up
    [u + d + w, v, u + d + w + w, v + d] satisfies Rect, // 3 -Y bottom  = Down
    [u + d + w, v + d, u + d + w + d, v + d + h] satisfies Rect, // 4 +X right   = East
    [u, v + d, u + d, v + d + h] satisfies Rect, // 5 -X left    = West
  ];
}

// ── part definitions ─────────────────────────────────────────────

/**
 * Runtime model for a single body part after UV expansion and layer setup.
 *
 * Each part is a unit cube (36 vertices, 6 faces × 2 triangles) scaled
 * to pixel dimensions `sx × sy × sz` and positioned at `(px, py, pz)`.
 *
 * Fields:
 *   name      — human-readable identifier (e.g. "right_arm", "cape")
 *   px,py,pz  — centre position in Minecraft pixel coordinates (model space)
 *   sx,sy,sz  — model extents in pixels (expanded by 0.5 px for overlays)
 *   uvW,uvH,uvD  — texture rectangle dimensions in pixels (always base size)
 *   phase     — walk animation coefficient: 0 = static, ±1 = sin(time)×±phase
 *   u, v      — texOffs origin on the 64×64 skin texture (top-left corner)
 */
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

/**
 * Compact source definition for partDefs[].
 *
 * Same as Part, but:
 *   - `sx/sy/sz` are the *base* (non-overlay) dimensions
 *   - `overlayUv` provides the second-layer texOffs (if any)
 */
type PartDef = Pick<
  Part,
  "name" | "px" | "py" | "pz" | "sx" | "sy" | "sz" | "uvW" | "uvH" | "uvD" | "phase"
> & {
  u: number;
  v: number; // base texOffs
  overlayUv: [number, number]; // overlay texOffs (second layer, shifted +32/+16)
};

/**
 * Minecraft skin part definitions, matching the vanilla PlayerModel.
 *
 * Coordinates are in Minecraft pixel space (16 px = 1 game block).
 * The model is 32 px tall (2 blocks), centred at Y = 16 px (waist level).
 *
 * Texture layout (64×64 vanilla skin sheet):
 *   Base layer:  head=0,0   body=16,16  rarm=40,16  larm=32,48
 *                rleg=0,16   lleg=16,48  cape=0,0    (cape uses 64×32 format)
 *   Second layer (overlay):  all shifted +16 Y or +32 X
 *                head=32,0   body=16,32  rarm=40,32  larm=48,48
 *                rleg=0,32   lleg=0,48
 *
 * Walk animation phases:
 *   0  = static (head, body, cape)
 *   1  = swings with sin(time)    (right arm, left leg)
 *   -1 = swings with -sin(time)   (left arm, right leg)
 *
 * ── Body part index scheme (14 parts, 2 draw calls) ──────────────
 *   Index  Call   Part            Phase   Index  Call   Part
 *   0      1      head            0       7      2      head_overlay
 *   1      1      body            0       8      2      body_overlay
 *   2      1      right_arm      +1       9      2      right_arm_overlay
 *   3      1      left_arm       -1      10      2      left_arm_overlay
 *   4      1      right_leg      -1      11      2      right_leg_overlay
 *   5      1      left_leg       +1      12      2      left_leg_overlay
 *   6      1      cape            0      13      2      cape_overlay
 *
 *   Call 1: 7 parts × 36 verts = 252 verts  (base)
 *   Call 2: 7 parts × 36 verts = 252 verts  (overlay)
 *   Total: 504 vertices
 */
const partDefs: PartDef[] = [
  // name: name of this part
  // px, py, pz: center (px) of the 3D block
  // sx, sy, sz: size (px) of the 3D block
  // uvW, uvH, uvD: size (px) of the box on the texture
  // phase: coefficient on the walk animation (typically -1, 0 or 1)
  // u, v: starting (top-left) pixel of the texture
  // overlayUv: starting pixel of its overlay (the second layer) texture
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

/**
 * Slim (Alex) arm variants — same positions, narrower arms.
 *
 * Minecraft's Alex model has 3 px wide arms instead of 4 px (Steve).
 * This affects:
 *   - `sx`: 3 instead of 4 (narrower geometry)
 *   - `px`: shifted ±0.5 px inward (5.5 → 6.0 from centre)
 *   - `uvW`: 3 instead of 4 (narrower texture strip)
 *   - `u/v`: texture coords — slim arms use the same texOffs origin
 *            but sample a narrower 3-px strip
 *
 * These overrides are applied conditionally at runtime via `uniforms.is_slim`.
 */
const slimArmsDefs: PartDef[] = [
  {
    name: "right_arm",
    px: -5.5,
    py: 18,
    pz: 0,
    sx: 3,
    sy: 12,
    sz: 4,
    uvW: 3,
    uvH: 12,
    uvD: 4,
    phase: 1,
    u: 40,
    v: 16,
    overlayUv: [40, 32],
  },
  {
    name: "left_arm",
    px: 5.5,
    py: 18,
    pz: 0,
    sx: 3,
    sy: 12,
    sz: 4,
    uvW: 3,
    uvH: 12,
    uvD: 4,
    phase: -1,
    u: 32,
    v: 48,
    overlayUv: [48, 48],
  },
];

// ── build combined parts arrays (base + overlay) ─────────────────
// We generate two parallel arrays of 14 parts each:
//   [0..6]  = base parts   (draw call 1, 252 verts)
//   [7..13] = overlay parts (draw call 2, 252 verts)
//
// Overlay parts use the same centre position but expanded dimensions
// (sx, sy, sz each +0.5 px) and the overlay texOffs origin.
// This creates the transparent "second layer" rendering effect.

// Base layer: index 0-6 (from partDefs, keeping original dimensions)
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

// Overlay layer: index 7-13 (expanded dimensions, overlay texOffs)
const overlayParts: Part[] = partDefs.map(d => ({
  name: d.name + "_overlay",
  px: d.px,
  py: d.py,
  pz: d.pz,
  sx: d.sx + OVERLAY_EXT * 2, // model expands outward by 0.25 px per face
  sy: d.sy + OVERLAY_EXT * 2,
  sz: d.sz + OVERLAY_EXT * 2,
  uvW: d.uvW,
  uvH: d.uvH,
  uvD: d.uvD, // UV rect stays at base dimensions (texture region doesn't grow)
  phase: d.phase,
  u: d.overlayUv[0],
  v: d.overlayUv[1],
}));

// Same split for slim (Alex) arms — only 4 entries (right_arm, left_arm + overlays)
const basePartsSlim: Part[] = slimArmsDefs.map(d => ({
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
const overlayPartsSlim: Part[] = slimArmsDefs.map(d => ({
  name: d.name + "_overlay",
  px: d.px,
  py: d.py,
  pz: d.pz,
  sx: d.sx + OVERLAY_EXT * 2,
  sy: d.sy + OVERLAY_EXT * 2,
  sz: d.sz + OVERLAY_EXT * 2,
  uvW: d.uvW,
  uvH: d.uvH,
  uvD: d.uvD,
  phase: d.phase,
  u: d.overlayUv[0],
  v: d.overlayUv[1],
}));

// ── special case: cape overlay should NOT expand ─────────────────
// The cape is only 1 px thick (sz = 1). Expanding it by 0.5 px would
// make it visibly thicker with no rendering benefit, since the cape
// has no separate overlay texture (overlayUv = [0, 0], same as base).
// We reset its overlay dimensions back to the base cape size.
const capeIdx = partDefs.findIndex(d => d.name === "cape");
overlayParts[capeIdx].sx = partDefs[capeIdx].sx;
overlayParts[capeIdx].sy = partDefs[capeIdx].sy;
overlayParts[capeIdx].sz = partDefs[capeIdx].sz;

// Combine base + overlay into flat arrays for WGSL constant emission.
// parts[0..6]     = base (Steve),   parts[7..13]    = overlay (Steve)
// partsSlim[0..1] = base (Alex),    partsSlim[2..3] = overlay (Alex)
const parts = [...baseParts, ...overlayParts];
const partsSlim = [...basePartsSlim, ...overlayPartsSlim];

// ── unit cube geometry ───────────────────────────────────────────
// A single unit cube spanning [-0.5, 0.5] on each axis.
// 6 faces × 2 triangles × 3 vertices = 36 vertices.
//
// Each face is a pair of triangles (6 verts), counter-clockwise winding.
// Face order (0-5) matches the boxUV() output and the `face = vertex_id / 6` division.
//
// The cube is scaled to part dimensions by multiplying each vertex by
// the part's size vector in the vertex shader.
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

const partCount = parts.length; // 14 (7 base + 7 overlay)
const partCountSlim = partsSlim.length; // 4 (2 base + 2 overlay, arms only)
const totalVertices = partCount * CUBE.length; // 14 × 36 = 504
const uvf = (n: number) => (n * T).toFixed(5); // pixel → UV (for format helper)

// ── compute UV rectangles ────────────────────────────────────────

// Standard UVs for all 14 Steve parts
const partUVs = parts.map(p => boxUV(p.u, p.v, p.uvW, p.uvH, p.uvD));

// Slim UVs: arms use slim-arm dimensions; non-arm parts fall through
// to the standard boxUV() for their part (same as Steve).
// partsSlim[0..1] = right_arm/left_arm base, partsSlim[2..3] = overlays.
const partUVsSlim = parts.map(p => {
  // Only the 4 arm parts (2 base + 2 overlay) need the slim variant
  if (
    p.name !== "right_arm" &&
    p.name !== "left_arm" &&
    p.name !== "right_arm_overlay" &&
    p.name !== "left_arm_overlay"
  ) {
    return boxUV(p.u, p.v, p.uvW, p.uvH, p.uvD);
  } else {
    // Find the matching slim part by name and use its UV dimensions
    const part: Part = partsSlim.find(ps => ps.name === p.name)!;
    return boxUV(part.u, part.v, part.uvW, part.uvH, part.uvD);
  }
});

// ── generate WGSL fragments ──────────────────────────────────────

console.log(`Generating shader for ${partCount} body parts…`);

/**
 * Map part index (0-13) to a short identifier for WGSL constant naming.
 *
 *   Index  Name       Index  Name
 *   0      head       7      head_ov
 *   1      body       8      body_ov
 *   2      rarm       9      rarm_ov
 *   3      larm      10      larm_ov
 *   4      rleg      11      rleg_ov
 *   5      lleg      12      lleg_ov
 *   6      cape      13      cape_ov
 */
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

// Format WGSL `Part` array: convert pixel coords to block units and
// centre the model vertically (subtract Y0 = 16 px from Y).
const partLines = parts
  .map((p, i) => {
    const comma = i < parts.length - 1 ? "," : "";
    return `    Part(vec3f(${(p.px * PX).toFixed(4)}, ${(p.py * PX - Y0).toFixed(4)}, ${(p.pz * PX).toFixed(4)}), vec3f(${(p.sx * PX).toFixed(4)}, ${(p.sy * PX).toFixed(4)}, ${(p.sz * PX).toFixed(4)}))${comma} // ${p.name}`;
  })
  .join("\n");

// Same for slim arms (only 4 entries; used as override for indices 2,3,9,10)
const partLinesSlim = partsSlim
  .map((p, i) => {
    const comma = i < partsSlim.length - 1 ? "," : "";
    return `    Part(vec3f(${(p.px * PX).toFixed(4)}, ${(p.py * PX - Y0).toFixed(4)}, ${(p.pz * PX).toFixed(4)}), vec3f(${(p.sx * PX).toFixed(4)}, ${(p.sy * PX).toFixed(4)}, ${(p.sz * PX).toFixed(4)}))${comma} // ${p.name}`;
  })
  .join("\n");

/**
 * Generate a WGSL `const` array of 6 FaceUV values for one body part.
 *
 * For the cape (indices 6, 13), we use a hardcoded 64×32 pixel layout
 * (Minecraft cape texture format) instead of computing from texOffs,
 * because capes use a separate texture format with different UV packing.
 *
 * The WGSL output looks like:
 *   const uv_head = array<FaceUV, 6>(
 *       FaceUV(vec2f(0.12500, 0.12500), vec2f(0.25000, 0.25000)),
 *       ...
 *   );
 */
function formatUVBlock(
  name: string,
  uv: readonly [number, number, number, number][],
  isCape: boolean,
) {
  // ── Cape special case: 64×32 cape texture UVs ────────────────
  // Minecraft capes use a 64×32 texture (not 64×64 like skin).
  // The pixel rects below map the standard cape layout:
  //   cape front (outward face)  = pixels 1-11 × 1-17
  //   cape back (inward face)    = pixels 12-22 × 1-17
  //   cape top/bottom/edges      = narrow 1px strips
  if (isCape) {
    const capeFaceUV: [number, number, number, number][] = [
      [1, 1, 11, 17], // 0 +Z outward face (visible from behind)
      [12, 1, 22, 17], // 1 -Z inward face   (visible from front)
      [1, 0, 11, 1], // 2 +Y top edge
      [11, 0, 21, 1], // 3 -Y bottom edge
      [11, 1, 12, 17], // 4 +X right edge
      [0, 1, 1, 17], // 5 -X left edge
    ];
    const uvW = 64,
      uvH = 32; // Cape texture is 64×32
    const faces = capeFaceUV
      .map(
        ([x0, y0, x1, y1]) =>
          `    FaceUV(vec2f(${(x0 / uvW).toFixed(5)}, ${(y0 / uvH).toFixed(5)}), vec2f(${(x1 / uvW).toFixed(5)}, ${(y1 / uvH).toFixed(5)}))`,
      )
      .join(",\n");
    return `const uv_${name} = array<FaceUV, 6>(\n${faces}\n);`;
  }

  // ── Standard skin: 64×64 UV space ────────────────────────────
  const faces = uv
    .map(
      ([x0, y0, x1, y1]) =>
        `    FaceUV(vec2f(${uvf(x0)}, ${uvf(y0)}), vec2f(${uvf(x1)}, ${uvf(y1)}))`,
    )
    .join(",\n");
  return `const uv_${name} = array<FaceUV, 6>(\n${faces}\n);`;
}

// Generate UV const arrays for all 14 standard (Steve) parts.
// Cape uses the special 64×32 format (isCape = true for indices 6 and 13).
const uvBlocks = parts
  .map((_p, i) => formatUVBlock(uvName(i), partUVs[i], i === 6 || i === 13))
  .join("\n\n");

// Generate UV const arrays for Alex slim arms — only the 4 arm parts need
// alternate UVs; all other parts use the same UVs as Steve.
// Indices: 2=rarm, 3=larm, 9=rarm_ov, 10=larm_ov
const slimUVBlocks = [2, 3, 9, 10]
  .map(i => formatUVBlock(`${uvName(i)}_slim`, partUVsSlim[i], false))
  .join("\n\n");

// Animation phase coefficients (0=static, ±1=sin with direction)
const phases = parts.map(p => p.phase.toFixed(1)).join(", ");

console.log(`  ✓ ${partCount} parts, ${totalVertices} vertices`);

// ── WGSL template ─────────────────────────────────────────────────
// The template below is emitted verbatim to src/lib/shader.wgsl.
// All ${} placeholders are TS template substitutions.
// Comments in this section appear in the final .wgsl file.

const wgsl = `// Auto-generated by scripts/generate-shader.ts
// ${partCount} parts × ${CUBE.length} vertices = ${totalVertices} vertices total
//
// ── Architecture ──────────────────────────────────────────────────
// GPU-first Minecraft skin renderer. A single vertex + fragment shader
// handles model transform, limb swing animation, cape pendulum physics,
// skin/cape texture sampling, and uniform scaling.
//
// Two draw calls (base + overlay) x 252 vertices = 504 total.
// CPU writes a 28-byte uniform buffer (7 × f32) each frame.
//
// ── Binding layout ────────────────────────────────────────────────
//   group(0) binding(0) — uniforms (time, camera, flags)
//   group(1) binding(0) — skin texture  (64×64 rgba8unorm)
//   group(1) binding(1) — linear sampler
//   group(1) binding(2) — cape texture (64×32 rgba8unorm, placeholder 1×1)

// ── vertex output ─────────────────────────────────────────────────
// position   — clip-space position (MVP * model vertex)
// uv         — texture coordinate (sampled from skin or cape)
// is_cape    — 1.0 for cape parts, 0.0 otherwise (fragment mix factor)
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) is_cape: f32,
}

// ── uniform buffer (28 bytes = 7 × f32) ───────────────────────────
// Written once per frame by the CPU render loop.
// See SkinViewer.svelte → updateUniforms() for the writer.
struct Uniforms {
    time: f32,       // [0] Elapsed seconds (used for animation phases)
    rot_y: f32,      // [4] Horizontal camera rotation (radians, from pointer drag)
    rot_x: f32,      // [8] Vertical camera tilt (radians, clamped ±1.5)
    is_slim: f32,    // [12] Model variant: 0 = Steve (4px arms), 1 = Alex (3px arms)
    scale: f32,      // [16] Uniform model scale factor
    aspect: f32,     // [20] Canvas aspect ratio (width / height)
    has_cape: f32,   // [24] Cape visibility: 0 = hidden, 1 = visible
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var skin: texture_2d<f32>;     // 64×64 skin atlas
@group(1) @binding(1) var skin_sampler: sampler;     // Nearest filtering (pixel art)
@group(1) @binding(2) var cape_tex: texture_2d<f32>; // 64×32 cape (1×1 placeholder when disabled)

// ── matrix helpers ────────────────────────────────────────────────
// WGSL has no built-in matrix multiplication for mat4x4f × mat4x4f,
// so we provide one. Rotation helpers build standard rotation matrices
// around each axis (right-handed, radians).

/// Column-wise mat4x4f multiply: a × b
fn mul4(a: mat4x4f, b: mat4x4f) -> mat4x4f {
    return mat4x4f(a * b[0], a * b[1], a * b[2], a * b[3]);
}
/// Build rotation matrix around +X axis by angle \`a\` (radians)
fn rotate_x(a: f32) -> mat4x4f {
    let c = cos(a); let s = sin(a);
    return mat4x4f(vec4f(1,0,0,0), vec4f(0,c,s,0), vec4f(0,-s,c,0), vec4f(0,0,0,1));
}
/// Build rotation matrix around +Y axis by angle \`a\` (radians)
fn rotate_y(a: f32) -> mat4x4f {
    let c = cos(a); let s = sin(a);
    return mat4x4f(vec4f(c,0,-s,0), vec4f(0,1,0,0), vec4f(s,0,c,0), vec4f(0,0,0,1));
}
/// Build rotation matrix around +Z axis by angle \`a\` (radians)
fn rotate_z(a: f32) -> mat4x4f {
    let c = cos(a); let s = sin(a);
    return mat4x4f(vec4f(c,s,0,0), vec4f(-s,c,0,0), vec4f(0,0,1,0), vec4f(0,0,0,1));
}

// ── cube geometry ─────────────────────────────────────────────────
// Unit cube vertices (36 = 6 faces × 2 tris × 3 verts).
// Scaled to part dimensions later via \`part.size * cube[vertex_id]\`.
// Face order: 0=+Z, 1=-Z, 2=+Y, 3=-Y, 4=+X, 5=-X

const cube = array<vec3f, ${CUBE.length}>(
${CUBE.map(([x, y, z]) => `    vec3f(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`).join(",\n")}
);

// Per-vertex unit-square UV coordinates (same for every face).
// Each face: [0,0] [1,0] [1,1] / [0,0] [1,1] [0,1]
const cube_uv = array<vec2f, ${CUBE.length}>(
${Array(6).fill("    vec2f(0,0), vec2f(1,0), vec2f(1,1),\n    vec2f(0,0), vec2f(1,1), vec2f(0,1)").join(",\n")}
);

// ── body parts ────────────────────────────────────────────────────
// Each Part stores:
//   pos  — centre position in block units (model space, waist-centred)
//   size — dimensions in block units (sx, sy, sz × PX)

struct Part { pos: vec3f, size: vec3f }

// Standard (Steve) parts array: indices 0-6 = base, 7-13 = overlay
const parts = array<Part, ${partCount}>(
${partLines}
);

// Slim (Alex) arm parts: indices 0-1 = base, 2-3 = overlay
// Applied as a runtime override for part_id 2,3,9,10 when is_slim = 1.
const parts_slim = array<Part, ${partCountSlim}>(
${partLinesSlim}
);

// Animation phase coefficient array (one per part).
// 0.0 = static (head, body, cape); ±1.0 = sin swing direction
const phases = array<f32, ${partCount}>(${phases});
// Y-coordinate of the arm/leg swing pivot (shoulder/hip joint).
// 6 px from model bottom = 0.375 block units (waist level for limbs)
const pivot_y = ${PIVOT_Y.toFixed(4)}f;

// ── UV rectangles per part × face ─────────────────────────────────
// FaceUV stores the min/max texture coordinates for one face.
// Each part has 6 FaceUV values (one per face, same ordering as cube[]).
// The vertex shader uses \`face = vertex_id / 6\` to select the correct rect.

struct FaceUV { min: vec2f, max: vec2f }

// ── 14 standard UV sets (Steve, 64×64 skin texture) ───────────────
// Cape parts (indices 6, 13) use 64×32 cape texture UVs.

${uvBlocks}

// ── 4 slim-arm UV variant sets (Alex, 64×64 skin texture) ─────────
// Only the arm parts (2=rarm, 3=larm, 9=rarm_ov, 10=larm_ov) need
// slim variants. Non-arm parts fall through to the standard UV above.

${slimUVBlocks}

/// Look up the FaceUV for a given part, face, and body type.
/// is_slim selects between Steve (0) and Alex (non-zero) UV rects
/// for the four arm parts.
fn uv_for_part(part_id: u32, face: u32, is_slim: f32) -> FaceUV {
    switch part_id {
        case 0u  { return uv_head[face]; }
        case 1u  { return uv_body[face]; }
        case 2u  { if (is_slim != 0.0) { return uv_rarm_slim[face]; } else { return uv_rarm[face]; } }
        case 3u  { if (is_slim != 0.0) { return uv_larm_slim[face]; } else { return uv_larm[face]; } }
        case 4u  { return uv_rleg[face]; }
        case 5u  { return uv_lleg[face]; }
        case 6u  { return uv_cape[face]; }
        case 7u  { return uv_head_ov[face]; }
        case 8u  { return uv_body_ov[face]; }
        case 9u  { if (is_slim != 0.0) { return uv_rarm_ov_slim[face]; } else { return uv_rarm_ov[face]; } }
        case 10u { if (is_slim != 0.0) { return uv_larm_ov_slim[face]; } else { return uv_larm_ov[face]; } }
        case 11u { return uv_rleg_ov[face]; }
        case 12u { return uv_lleg_ov[face]; }
        default  { return uv_cape_ov[face]; }
    }
}

// ── camera ────────────────────────────────────────────────────────
// Perspective projection: 60° FOV, clip planes 0.1–10.0.
// View matrix: camera at (0, 0, -4) looking toward +Z.

/// Perspective projection matrix (60° FOV, dynamic aspect ratio)
fn projection() -> mat4x4f {
    let fov = 3.14159265359 / 3.0; // 60° in radians
    let near = 0.1; let far = 10.0;
    let f = 1.0 / tan(fov * 0.5);
    let aspect = uniforms.aspect;
    return mat4x4f(
        vec4f(f/aspect,0,0,0), vec4f(0,f,0,0),
        vec4f(0,0,-far/(far-near),-1), vec4f(0,0,-(far*near)/(far-near),0),
    );
}
/// View matrix: camera at (0, 0, -4), looking at origin
fn view() -> mat4x4f {
    return mat4x4f(
        vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(0,0,-4,1),
    );
}

// ── vertex shader ─────────────────────────────────────────────────
// The @builtin(vertex_index) encodes two pieces of information:
//   part_id   = vertex_index / 36   (which of the 14 body parts)
//   vertex_id = vertex_index % 36   (which of the 36 cube vertices)
//   face      = vertex_id / 6       (which of the 6 cube faces)

@vertex
fn vs_main(@builtin(vertex_index) id: u32) -> VertexOutput {
    let part_id   = id / ${CUBE.length}u;
    let vertex_id = id % ${CUBE.length}u;
    var part      = parts[part_id];
    let face      = vertex_id / 6u;

    // ── slim arm override ─────────────────────────────────────────
    // For arm parts (2, 3 = base; 9, 10 = overlay), swap in the slim
    // part definition when uniforms.is_slim = 1 (Alex model).
    // parts_slim[0..1] = base arms, parts_slim[2..3] = overlay arms.
    if (part_id == 2u || part_id == 3u || part_id == 9u || part_id == 10u) {
        var slim_part_id = 0u;
        if (part_id == 2u || part_id == 3u) {
          slim_part_id = part_id - 2u;    // part_id 2→0, 3→1 (base arms)
        }else{
          slim_part_id = part_id - 7u;    // part_id 9→2, 10→3 (overlay arms)
        }
        part=parts_slim[slim_part_id];
    }
    let sz = part.size;

    // Start from the unit cube, scaled to part dimensions
    var p = cube[vertex_id] * sz;

    // ── limb swing animation (all parts except cape: 0-5, 7-12) ──
    // Exclude cape (indices 6, 13) — it has its own animation below.
    if (part_id != 6u && part_id != 13u) {
        let phase = phases[part_id];
        if phase != 0.0 {
            // Classical sine-wave limb swing around pivot_y (shoulder/hip)
            let speed = 4.0;          // Frequency multiplier (walk cycles / sec)
            let max_angle = 0.6;      // ~34° maximum swing amplitude
            let angle = max_angle * sin(uniforms.time * speed) * phase;

            // Arms swing about shoulder (Y = pivot_y = 0.375 block),
            // legs swing about hip (same Y level in our simplified model).
            let pivot = vec3f(0.0, pivot_y, 0.0);
            p = (rotate_x(angle) * vec4f(p - pivot, 1.0)).xyz + pivot;
        }
    }

    // ── cape animation (part_id 6 = base, 13 = overlay) ─────────
    if (part_id == 6u || part_id == 13u) {
        if (uniforms.has_cape == 0.0) {
            // Cape disabled: collapse to origin (invisible)
            p = vec3f(0.0);
        } else {
            // Cape pivot is the top-centre of the cape rectangle
            // (at the same height as body centre = attachment point).
            let cape_pivot = vec3f(0.0, part.pos.y + part.size.y * 0.5, part.pos.z);

            // Minecraft cape animation approximated on GPU:
            //   angle_x = 0.60 rad (~34°) base tilt + sinusoidal flap
            //   flap amplitude ≈ 0.07 rad (~4°), frequency = 2× walk speed
            //
            // The cape +Z face is the outward-facing side ((-Z) in our
            // coordinate since it sits on the back). The animation:
            //   1. Rotate 180° around Y so the +Z face points -Z (backward)
            //   2. Tilt around X (negative = lean backward/away from body)
            let walk   = uniforms.time * 4.0;
            let flap   = sin(walk * 2.0) * 0.07;   // ~4° flap amplitude
            let angle_x = 0.60 + flap;              // base tilt + flap

            let cape_rot = mul4(rotate_y(3.14159), rotate_x(-angle_x));
            p = (cape_rot * vec4f(p - cape_pivot, 1.0)).xyz + cape_pivot;
        }
    }

    // Translate from local part space to model space
    p += part.pos;

    // ── model-view-projection transform ───────────────────────────
    // Model = orbital camera rotation (Y then X), then view, then projection.
    let model = mul4(rotate_y(uniforms.rot_y), rotate_x(-uniforms.rot_x));
    let pv = mul4(mul4(projection(), view()), model);

    // ── texture coordinate lookup ─────────────────────────────────
    // Map from unit-square UV (cube_uv) to the texture rect for this
    // face. Y is flipped (texture origin is top-left, NDC is bottom-up).
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
// Samples the skin texture (base) and cape texture, then blends them
// using the is_cape flag from the vertex shader.
// Cape parts use the cape texture; all other parts use the skin texture.
// The canvas uses premultiplied alpha (transparent background for Svelte UI overlay).

@fragment
fn fs_main(@location(0) uv: vec2f, @location(1) is_cape: f32) -> @location(0) vec4f {
    let base = textureSample(skin, skin_sampler, uv);
    let cape = textureSample(cape_tex, skin_sampler, uv);
    return mix(base, cape, is_cape);
}
`;

// ── write output files ───────────────────────────────────────────
// Emits two files — both are marked as linguist-generated and should
// never be edited by hand. Always edit generate-shader.ts and re-run.

// 1. Raw WGSL file (for direct inspection / WebGPU device creation)
await Deno.writeTextFile("src/lib/shader.wgsl", wgsl);

// 2. Minifier WGSL file
const minified = minify_wgsl(wgsl);

// 3. TypeScript module wrapping the WGSL as a string export
// (used by bundlers / Svelte components that import the shader code)
await Deno.writeTextFile(
  "src/lib/shader.ts",
  `// Auto-generated by scripts/generate-shader.ts\nconst shaderCode: string = ${JSON.stringify(minified)};\nexport default shaderCode;\n`,
);

console.log(`\nsrc/lib/shader.wgsl  (${(wgsl.length / 1024).toFixed(1)} KB)`);
console.log(`src/lib/shader.ts   (${(minified.length / 1024).toFixed(1)} KB)`);

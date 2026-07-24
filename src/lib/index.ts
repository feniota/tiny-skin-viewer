// ── Entry point for JSR & npm ──────────────────────────────────
//
// SkinViewer is a Svelte 5 component.  Svelte-aware bundlers
// (Vite, SvelteKit) should use the `svelte` export condition to
// get the raw `.svelte` source (via `SkinViewer.svelte`).
// This default export uses a pre-compiled wrapper so Deno/JSR
// can validate the module graph without needing a Svelte plugin.

export { default as SkinViewer } from "./SkinViewer.js";

// ── Public prop types ─────────────────────────────────────────

export interface SkinViewerProps {
  /** 64×64 Minecraft skin texture URL (default: "/steve.png"). */
  skinUrl?: string;
  /** true = Alex (3-pixel arms), false = Steve (4-pixel). */
  isSlim?: boolean;
  /** Uniform model scale factor (default: 1). */
  scale?: number;
  /** Bump to trigger rotation reset (default: 0). */
  resetId?: number;
}

// Svelte-aware entry point — re-exports the raw .svelte component so
// bundlers (Vite / SvelteKit) can compile it with the consumer's config.
// Not used by JSR (see index.ts for the JSR entry).

export { default as SkinViewer } from "./SkinViewer.svelte";

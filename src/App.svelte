<script lang="ts">
  // @ts-ignore: idk why ts is mad about this
  import { SkinViewer } from "./lib/index.ts";

  let scale = $state(1);
</script>

<div class="toolbar">
  <button class="btn" onclick={() => (scale = Math.max(0.1, scale - 0.1))}>−</button>
  <span class="val">{scale.toFixed(1)}</span>
  <button class="btn" onclick={() => (scale += 0.1)}>+</button>
</div>

<SkinViewer {scale} />

<style>
  .toolbar {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(6px);
    border-radius: 8px;
    padding: 6px 10px;
    user-select: none;
  }
  .btn {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 6px;
    background: transparent;
    color: #333;
    font: 16px monospace;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn:hover {
    background: rgba(0, 0, 0, 0.1);
    color: #111;
  }
  .val {
    color: #333;
    font: 14px monospace;
    min-width: 32px;
    text-align: center;
  }
</style>

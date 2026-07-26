<script>
  // @ts-nocheck
  import { SkinViewer } from "./lib/index";

  let scale = $state(1);
  let capeUrl = $state(undefined);
  let resetId = $state(0);

  let paused = $state(false);
  let time = $state(0);
  let maxTime = $state(4);

  $effect(() => {
    if (paused) return;
    let prev = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      time = (time + (now - prev) / 1000) % maxTime;
      prev = now;
    }, 16);
    return () => clearInterval(id);
  });

  function togglePause() {
    paused = !paused;
  }

  function reset() {
    scale = 1;
    resetId++;
  }
</script>

<div class="toolbar top">
  <button class="btn" onclick={() => (scale = Math.max(0.1, scale - 0.1))}>−</button>
  <span class="val">{scale.toFixed(1)}</span>
  <button class="btn" onclick={() => (scale += 0.1)}>+</button>
  <button
    class="btn"
    onclick={() => (capeUrl = capeUrl ? undefined : "/pancape.png")}
    title="Toggle cape">🦸</button>
  <button class="btn" onclick={reset} title="Reset view">↺</button>
</div>

<div class="toolbar bottom">
  <button class="btn" onclick={togglePause}>{paused ? "▶" : "⏸"}</button>
  <input
    type="range"
    class="scrub"
    min="0"
    max={maxTime}
    step="0.01"
    value={time}
    oninput={e => {
      time = +e.target.value;
    }} />
  <span class="val">{time.toFixed(1)}s</span>
</div>

<SkinViewer skinUrl="/Template_slim_nooverlay.png" isSlim {scale} {capeUrl} {resetId} {time} />

<SkinViewer skinUrl="/Template_slim.png" isSlim />

<style>
  .toolbar {
    position: fixed;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(6px);
    border-radius: 8px;
    padding: 6px 10px;
  }
  .top {
    top: 12px;
    left: 12px;
  }
  .bottom {
    bottom: 12px;
    left: 12px;
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
    flex-shrink: 0;
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
    white-space: nowrap;
  }
  .scrub {
    width: 120px;
    height: 4px;
    accent-color: #555;
    cursor: pointer;
  }
</style>

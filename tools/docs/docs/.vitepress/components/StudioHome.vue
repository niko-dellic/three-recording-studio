<script setup>
import { ref } from "vue";
import { version } from "../../../../../package.json";
const copied = ref(false);
const copyError = ref("");
async function copy() {
  try {
    await navigator.clipboard.writeText(
      "npm install three-recording-studio three",
    );
    copied.value = true;
  } catch {
    copyError.value = "Select the command to copy it manually.";
  }
}
</script>
<template>
  <section class="studio-home">
    <div class="home-copy">
      <p class="eyebrow">TYPESCRIPT LIBRARY</p>
      <h1>Render Three.js<br />scenes</h1>
      <p class="lead">
        This TypeScript library creates images and videos from Three.js scenes.
        Set the output size and frame rate. Save PNG images or MP4 videos.
      </p>
      <div class="home-links">
        <a href="./demo" target="_self">Open the demo <span>↗</span></a
        ><a href="/guide">Read the guide <span>→</span></a>
      </div>
      <div class="install">
        <h2>Installation command</h2>
        <div class="command">
          <code>npm install three-recording-studio three</code
          ><button
            @click="copy"
            :aria-label="copied ? 'Copied' : 'Copy install command'"
          >
            {{ copied ? "✓" : "⧉" }}
          </button>
        </div>
        <p role="status">{{ copyError }}</p>
        <small
          >Version {{ version }}. Available on
          <a href="https://www.npmjs.com/package/three-recording-studio">npm</a
          >.</small
        >
      </div>
    </div>
    <a
      class="home-preview"
      href="./demo"
      target="_self"
      aria-label="Open the render workspace demo"
      ><div class="preview-title">RENDER WORKSPACE <span>↗</span></div>
      <img
        :src="'/studio.png'"
        alt="Bunny clipping plane in the Three.js render workspace"
      />
      <div class="preview-caption">Scene view and render preview</div></a
    >
    <div class="home-meta">
      <span>WebGL and WebGPU</span><span>UI color settings</span
      ><span>MIT license</span>
    </div>
  </section>
</template>
<style scoped>
.studio-home {
  max-width: 1120px;
  margin: 0 auto;
  padding: 76px 32px 80px;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 48px;
  align-items: center;
}
.eyebrow {
  font:
    10px ui-monospace,
    monospace;
  letter-spacing: 1.5px;
  color: var(--vp-c-text-2);
  margin: 0 0 24px;
}
h1 {
  font-size: clamp(38px, 4.4vw, 60px);
  line-height: 1.05;
  font-weight: 450;
  letter-spacing: -3px;
  margin: 0 0 28px;
}
.lead {
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.9;
  margin: 0 0 28px;
}
.home-links {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.home-links a {
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  padding: 13px 16px;
  font-size: 12px;
  display: flex;
  gap: 40px;
}
.home-links a:hover {
  background: var(--vp-c-bg-soft);
}
.install {
  margin-top: 28px;
}
h2 {
  font-size: 14px;
  font-weight: 550;
  margin-bottom: 14px;
}
.command {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  padding: 12px;
}
.command code {
  font-size: 11px;
  overflow-wrap: anywhere;
  flex: 1;
}
.command button {
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  padding: 2px 7px;
}
.install small,
.install p {
  font-size: 11px;
  color: var(--vp-c-text-2);
}
.home-preview {
  display: block;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  transform: perspective(1000px) rotateY(-8deg) rotateZ(-3deg);
  box-shadow: 14px 18px 0 var(--vp-c-bg-soft);
  overflow: hidden;
}
.preview-title,
.preview-caption {
  padding: 14px;
  font:
    10px ui-monospace,
    monospace;
  color: var(--vp-c-text-2);
}
.preview-title {
  display: flex;
  justify-content: space-between;
}
.home-preview img {
  width: 100%;
  display: block;
  border-block: 1px solid var(--vp-c-divider);
}
.home-meta {
  grid-column: 1/-1;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  color: var(--vp-c-text-2);
  font:
    10px ui-monospace,
    monospace;
}
@media (max-width: 760px) {
  .studio-home {
    grid-template-columns: 1fr;
    padding: 40px 24px;
    gap: 32px;
  }
  .home-preview {
    transform: none;
    box-shadow: none;
  }
  h1 {
    letter-spacing: -2px;
  }
}
</style>

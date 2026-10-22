// Copies the MediaPipe Tasks Vision WASM runtime into public/ so it is served
// from the same origin (no CDN). Only the SIMD variants are copied: every
// supported Chrome/Edge has WASM SIMD, and the nosimd build would add 13 MB.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dst = join(root, 'public/mediapipe/wasm');
const files = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
];

mkdirSync(dst, { recursive: true });
for (const f of files) {
  const from = join(src, f);
  const to = join(dst, f);
  if (!existsSync(from)) throw new Error(`missing ${from} (run npm install)`);
  if (existsSync(to) && statSync(to).size === statSync(from).size && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue;
  copyFileSync(from, to);
  console.log(`copied ${f}`);
}

const models = ['hand_landmarker.task', 'selfie_segmenter.tflite'];
for (const m of models) {
  if (!existsSync(join(root, 'public/mediapipe/models', m))) {
    throw new Error(`missing model public/mediapipe/models/${m} (see CREDITS.md for the source URL)`);
  }
}

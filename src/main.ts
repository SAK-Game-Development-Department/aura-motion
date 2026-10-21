import './ui/style.css';
import { App } from './app';
import { readRuntime } from './config/runtime';

const rt = readRuntime(location.search);
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const app = new App(canvas, rt);
(window as unknown as { __aura: App }).__aura = app;
app.start().catch((e) => {
  console.error('[aura] fatal start error', e);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#ffb43f;font:3vh sans-serif;text-align:center;padding:4vw">
      グラフィックを開始できませんでした（WebGPU / WebGL2 が使えません）。<br>Chrome / Edge の最新版でハードウェアアクセラレーションを有効にしてください。<br><small style="color:#888">${String((e as Error)?.message ?? e)}</small></div>`,
  );
  // Retry once after a while (e.g. GPU process crash at boot).
  setTimeout(() => location.reload(), 30_000);
});

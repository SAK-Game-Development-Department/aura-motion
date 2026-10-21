// TrackerCore: MediaPipe Pose Landmarker + Image Segmenter + field building.
// Context-agnostic: runs inside the tracking Web Worker or on the main thread
// (fallback). Frames are processed locally and discarded immediately — no
// image ever leaves this function (privacy).
import { FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from '../../core/types';
import { FieldBuilder } from './field';
import type { TrackerFrame, TrackerInit, TrackerOut } from './protocol';

type Post = (m: TrackerOut, transfer?: Transferable[]) => void;

const isWorker = typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined' && typeof document === 'undefined';

async function fetchWithProgress(url: string, stage: string, post: Post): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`failed to load ${url}: ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const now = performance.now();
    if (now - lastPost > 80) {
      post({ type: 'progress', stage, loaded, total });
      lastPost = now;
    }
  }
  post({ type: 'progress', stage, loaded, total: total || loaded });
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class TrackerCore {
  private pose: PoseLandmarker | null = null;
  private seg: ImageSegmenter | null = null;
  private field: FieldBuilder | null = null;
  private small: OffscreenCanvas | HTMLCanvasElement | null = null;
  private smallCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private mask: Float32Array | null = null;
  private lastTs = 0;
  private cfg: TrackerInit | null = null;

  constructor(private post: Post) {}

  async init(cfg: TrackerInit): Promise<void> {
    this.cfg = cfg;
    const base = new URL('mediapipe/', cfg.baseUrl).href;
    const useModule = isWorker;
    const variant = useModule ? 'vision_wasm_module_internal' : 'vision_wasm_internal';
    // Warm the cache with progress reporting (the loader then hits the HTTP/SW cache).
    await fetchWithProgress(`${base}wasm/${variant}.wasm`, 'wasm', this.post);
    const poseBuf = await fetchWithProgress(`${base}models/pose_landmarker_${cfg.poseModel}.task`, 'pose', this.post);
    const segBuf = cfg.segmentation ? await fetchWithProgress(`${base}models/selfie_segmenter.tflite`, 'segmenter', this.post) : null;

    const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`, useModule);
    // In a module worker the WASM loader is an ES module: MediaPipe clears
    // self.ModuleFactory after creating a task, and a second import() of the
    // same URL is served from the module cache without re-running, so the
    // second task would fail with "ModuleFactory not set". Keep the factory
    // and restore it before each task (docs/decisions.md D3).
    const g = globalThis as unknown as { ModuleFactory?: unknown };
    let factory: unknown = null;
    if (useModule) {
      const mod = (await import(/* @vite-ignore */ fileset.wasmLoaderPath)) as { default?: unknown };
      factory = mod.default ?? g.ModuleFactory ?? null;
    }
    const restoreFactory = () => {
      if (factory) g.ModuleFactory = factory;
    };
    this.post({ type: 'progress', stage: 'init', loaded: 0, total: 1 });
    restoreFactory();
    this.pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: poseBuf, delegate: cfg.delegate },
      runningMode: 'VIDEO',
      numPoses: cfg.numPoses,
      minPoseDetectionConfidence: cfg.minPoseDetectionConfidence,
      minPosePresenceConfidence: cfg.minPosePresenceConfidence,
      minTrackingConfidence: cfg.minTrackingConfidence,
      outputSegmentationMasks: false,
      ...(cfg.delegate === 'GPU' ? { canvas: makeCanvas(1, 1) } : {}),
    });
    if (segBuf) {
      restoreFactory();
      this.seg = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: segBuf, delegate: cfg.delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
        ...(cfg.delegate === 'GPU' ? { canvas: makeCanvas(1, 1) } : {}),
      });
    }
    this.field = new FieldBuilder(cfg.fieldW, cfg.fieldH);
    this.small = makeCanvas(cfg.fieldW, cfg.fieldH);
    this.smallCtx = this.small.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    this.mask = new Float32Array(cfg.fieldW * cfg.fieldH);
    this.post({ type: 'progress', stage: 'init', loaded: 1, total: 1 });
    this.post({ type: 'ready', delegate: cfg.delegate, segmentation: !!this.seg });
  }

  reset(): void {
    this.field?.reset();
  }

  process(f: TrackerFrame): void {
    const cfg = this.cfg;
    if (!this.pose || !this.field || !this.smallCtx || !this.mask || !cfg) {
      f.bitmap.close();
      return;
    }
    try {
      const ts = Math.max(this.lastTs + 1, Math.round(f.t));
      this.lastTs = ts;
      const t0 = performance.now();
      const res = this.pose.detectForVideo(f.bitmap, ts);
      const t1 = performance.now();
      const poses: Landmark[][] = res.landmarks.map((lms) =>
        lms.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z, v: p.visibility ?? 1 })),
      );

      // Small frame: luma + segmentation input.
      const W = cfg.fieldW;
      const H = cfg.fieldH;
      this.smallCtx.drawImage(f.bitmap, 0, 0, W, H);
      const img = this.smallCtx.getImageData(0, 0, W, H);
      let lsum = 0;
      for (let i = 0; i < img.data.length; i += 16) lsum += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
      const luma = lsum / (img.data.length / 16) / 255;

      let segMs = 0;
      const lockLm = pickNearest(poses, f.lockHint);
      let maskSrc: Float32Array;
      if (this.seg && f.segment) {
        const s0 = performance.now();
        const sr = this.seg.segmentForVideo(img, ts);
        const masks = sr.confidenceMasks;
        const m = masks?.[masks.length - 1];
        if (m) {
          const raw = m.getAsFloat32Array();
          // Mirror horizontally into view orientation.
          const mw = m.width;
          const mh = m.height;
          for (let y = 0; y < H; y++) {
            const sy = Math.min(mh - 1, Math.floor((y * mh) / H));
            for (let x = 0; x < W; x++) {
              const sx = Math.min(mw - 1, Math.floor(((W - 1 - x) * mw) / W));
              this.mask[y * W + x] = raw[sy * mw + sx]!;
            }
          }
        }
        sr.close();
        segMs = performance.now() - s0;
        maskSrc = this.mask;
      } else if (this.seg) {
        maskSrc = this.mask; // reuse last mask on skipped frames
      } else {
        maskSrc = this.field.maskFromLandmarks(lockLm);
      }
      const f0 = performance.now();
      const packed = this.field.build(maskSrc, lockLm, f.t);
      const field = packed.slice();
      const fieldMs = performance.now() - f0;
      this.post(
        { type: 'result', id: f.id, t: f.t, inferMs: t1 - t0, segMs, fieldMs, poses, luma, field, fieldW: W, fieldH: H },
        [field.buffer],
      );
    } catch (e) {
      this.post({ type: 'error', message: String((e as Error)?.message ?? e), fatal: false });
    } finally {
      f.bitmap.close();
    }
  }

  dispose(): void {
    this.pose?.close();
    this.seg?.close();
    this.pose = null;
    this.seg = null;
  }
}

function pickNearest(poses: Landmark[][], hint: { x: number; y: number } | null): Landmark[] | null {
  if (poses.length === 0) return null;
  if (!hint || poses.length === 1) return poses[0]!;
  let best = poses[0]!;
  let bd = Infinity;
  for (const p of poses) {
    const ls = p[11];
    const rs = p[12];
    if (!ls || !rs) continue;
    const d = Math.hypot((ls.x + rs.x) / 2 - hint.x, (ls.y + rs.y) / 2 - hint.y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

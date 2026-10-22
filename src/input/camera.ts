// CameraSource: getUserMedia → requestVideoFrameCallback → TrackerHost.
// The video element is never shown and frames are never stored or sent:
// each frame becomes an ImageBitmap that the tracker closes after inference.
import { TRACKING } from '../config';
import { Emitter } from '../core/emitter';
import type { FieldFrame, PoseFrame } from '../core/types';
import type { InputSource, SourceStatus } from './source';
import { createTrackerHost, type HostAttempt, type TrackerHost } from './tracking/host';

export interface CameraOptions {
  segmentation: boolean;
  preferWorker: boolean;
  onProgress: (stage: string, loaded: number, total: number) => void;
}

export type CameraError = 'denied' | 'notfound' | 'inuse' | 'unsupported' | 'tracking' | 'unknown';

export class CameraSource implements InputSource {
  readonly kind = 'camera' as const;
  readonly frames = new Emitter<PoseFrame>();
  readonly fields = new Emitter<FieldFrame>();
  host: TrackerHost | null = null;
  attempts: HostAttempt[] = [];
  error: CameraError | null = null;
  errorDetail = '';
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private frameId = 0;
  private rvfcHandle = 0;
  private lastResultAt = 0;
  private lastSubmitAt = 0;
  /** Skip segmentation every other frame when true (quality governor). */
  segmentHalfRate = false;
  readonly stats = { inferMs: 0, segMs: 0, fieldMs: 0, pipelineMs: 0, fps: 0, dropped: 0 };
  private fpsCount = 0;
  private fpsT0 = 0;
  private disposers: Array<() => void> = [];

  constructor(private opts: CameraOptions) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error = 'unsupported';
      throw new Error('getUserMedia unsupported');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: TRACKING.camera.width },
          height: { ideal: TRACKING.camera.height },
          frameRate: { ideal: TRACKING.camera.frameRate },
          facingMode: 'user',
        },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      this.error = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'notfound' : name === 'NotReadableError' ? 'inuse' : 'unknown';
      this.errorDetail = String((e as Error)?.message ?? e);
      throw e;
    }
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('aria-hidden', 'true');
    // Must be in the DOM for reliable frame callbacks; invisible by design.
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(v);
    v.srcObject = this.stream;
    await v.play();
    this.video = v;
    for (const track of this.stream.getVideoTracks()) {
      const onEnded = () => {
        this.error = 'notfound';
        this.errorDetail = 'camera track ended';
      };
      track.addEventListener('ended', onEnded);
      this.disposers.push(() => track.removeEventListener('ended', onEnded));
    }

    try {
      const { host, attempts } = await createTrackerHost(
        {
          baseUrl: new URL('./', document.baseURI).href,
          numHands: TRACKING.numHands,
          segmentation: this.opts.segmentation,
          fieldW: TRACKING.fieldW,
          fieldH: TRACKING.fieldH,
          minHandDetectionConfidence: TRACKING.minHandDetectionConfidence,
          minHandPresenceConfidence: TRACKING.minHandPresenceConfidence,
          minTrackingConfidence: TRACKING.minTrackingConfidence,
        },
        { preferWorker: this.opts.preferWorker, timeoutMs: TRACKING.workerInitTimeoutMs, onProgress: this.opts.onProgress },
      );
      this.host = host;
      this.attempts = attempts;
    } catch (e) {
      this.error = 'tracking';
      this.errorDetail = String((e as Error).message);
      this.stopStream();
      throw e;
    }
    this.disposers.push(
      this.host.results.on((r) => {
        const now = performance.now();
        this.lastResultAt = now;
        this.stats.inferMs = r.inferMs;
        this.stats.segMs = r.segMs;
        this.stats.fieldMs = r.fieldMs;
        this.stats.pipelineMs = now - r.t;
        this.fpsCount++;
        if (now - this.fpsT0 > 1000) {
          this.stats.fps = (this.fpsCount * 1000) / (now - this.fpsT0);
          this.fpsCount = 0;
          this.fpsT0 = now;
        }
        const vw = this.video?.videoWidth || 16;
        const vh = this.video?.videoHeight || 9;
        this.frames.emit({ t: r.t, poses: [], hands: r.hands, aspect: vw / vh, luma: r.luma, timing: { inferStart: r.t, inferEnd: now } });
        if (r.field) this.fields.emit({ t: r.t, w: r.fieldW, h: r.fieldH, data: r.field });
      }),
    );
    this.running = true;
    this.schedule();
  }

  private schedule(): void {
    const v = this.video;
    if (!v || !this.running) return;
    this.rvfcHandle = v.requestVideoFrameCallback((now, meta) => void this.onVideoFrame(now, meta));
  }

  private async onVideoFrame(now: number, meta: VideoFrameCallbackMetadata): Promise<void> {
    const v = this.video;
    const host = this.host;
    if (!this.running || !v || !host) return;
    this.schedule();
    if (host.busy) {
      // Keep latency low: drop frames rather than queueing them.
      this.stats.dropped++;
      // Recover from a lost result after 3 s (the worker keeps only the newest
      // frame, so a resubmit can never build a queue).
      if (now - this.lastSubmitAt < 3000) return;
    }
    const t = meta.captureTime ?? now;
    try {
      const bitmap = await createImageBitmap(v, { resizeWidth: 640, resizeHeight: Math.round((640 * (v.videoHeight || 9)) / (v.videoWidth || 16)) });
      this.lastSubmitAt = performance.now();
      this.frameId++;
      host.submit({
        type: 'frame',
        id: this.frameId,
        t,
        bitmap,
        segment: !this.segmentHalfRate || this.frameId % 2 === 0,
      });
    } catch {
      /* video not ready yet */
    }
  }

  tick(): void {
    /* push-based */
  }

  /** ms since the last tracking result (watchdog). */
  get resultAge(): number {
    return this.lastResultAt ? performance.now() - this.lastResultAt : 0;
  }

  get trackEnded(): boolean {
    return this.stream?.getVideoTracks().some((t) => t.readyState === 'ended') ?? false;
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video?.remove();
    this.video = null;
  }

  stop(): void {
    this.running = false;
    if (this.video && this.rvfcHandle) this.video.cancelVideoFrameCallback(this.rvfcHandle);
    for (const d of this.disposers) d();
    this.disposers = [];
    this.host?.dispose();
    this.host = null;
    this.stopStream();
  }

  status(): SourceStatus {
    const s: SourceStatus = {
      ready: this.running,
      detail: this.host ? `${this.host.mode}/${this.host.delegate} ${this.stats.fps.toFixed(0)}fps` : 'starting',
      backend: this.host ? `${this.host.mode}/${this.host.delegate}` : 'none',
    };
    if (this.error) s.error = `${this.error}: ${this.errorDetail}`;
    return s;
  }
}

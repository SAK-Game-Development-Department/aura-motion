// Emergency mode (camera unavailable): the mouse drives the nearest hand of a
// synthetic body; keys trigger jump / crouch / lean / poses. Staff-only.
import type { PoseFrame, Vec2 } from '../core/types';
import { POSES, POSE_IDS } from '../stage/poses';
import { buildLandmarks, defaultBody } from './skeleton';
import { PulledSource } from './source';

export class MouseSource extends PulledSource {
  readonly kind = 'mouse' as const;
  private cursor: Vec2 = { x: 0.7, y: 0.4 };
  private keys = new Set<string>();
  private jumpAt = -1e9;
  private present = true;
  private pose: number | null = null;
  private disposers: Array<() => void> = [];

  /** toView maps client pixel coords → view space (provided by the renderer layout). */
  constructor(private toView: (clientX: number, clientY: number) => Vec2) {
    super(30);
  }

  override async start(): Promise<void> {
    await super.start();
    const mm = (e: MouseEvent) => (this.cursor = this.toView(e.clientX, e.clientY));
    const kd = (e: KeyboardEvent) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key === ' ') this.jumpAt = performance.now();
      if (e.key.toLowerCase() === 'z') this.present = !this.present;
      const n = Number(e.key);
      if (n >= 1 && n <= POSE_IDS.length) this.pose = this.pose === n - 1 ? null : n - 1;
      if (e.key === '0') this.pose = null;
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    window.addEventListener('mousemove', mm);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.disposers.push(
      () => window.removeEventListener('mousemove', mm),
      () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku),
    );
  }

  override stop(): void {
    super.stop();
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  protected produce(t: number): PoseFrame | null {
    if (!this.present) return { t, poses: [], aspect: 16 / 9, luma: 0.4 };
    const b = defaultBody();
    const jt = (performance.now() - this.jumpAt) / 500;
    if (jt >= 0 && jt < 1) b.jump = Math.sin(jt * Math.PI);
    if (this.keys.has('c') || this.keys.has('arrowdown')) b.crouch = 1;
    if (this.keys.has('arrowleft')) b.cx = 0.41;
    if (this.keys.has('arrowright')) b.cx = 0.59;
    if (this.pose !== null) {
      const tpl = POSES[POSE_IDS[this.pose]!];
      b.armL = { ...tpl.armL };
      b.armR = { ...tpl.armR };
      if (tpl.legL && tpl.legR) {
        b.legL = { ...tpl.legL };
        b.legR = { ...tpl.legR };
      }
    } else if (this.cursor.x < b.cx) b.armL.target = this.cursor;
    else b.armR.target = this.cursor;
    return { t, poses: [buildLandmarks(b)], aspect: 16 / 9, luma: 0.4 };
  }

  override status() {
    return { ready: this.running, detail: 'mouse emergency mode (space=jump, C/↓=crouch, ←/→=lean, 1-9=pose, Z=leave)' };
  }
}

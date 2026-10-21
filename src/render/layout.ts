// Coordinate mapping between view space (camera frame, normalized), world
// space (orthographic: height 1, x ∈ [-sa/2, sa/2]) and screen pixels.
// The camera frame is "cover"-fitted to the screen.
import type { Vec2 } from '../core/types';

export class Layout {
  /** Screen aspect (w/h). */
  sa = 16 / 9;
  /** Camera frame aspect. */
  ca = 16 / 9;
  /** Cover scale (world units per view-height unit). */
  k = 1;
  w = 1280;
  h = 720;

  resize(w: number, h: number, cameraAspect = this.ca): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.sa = this.w / this.h;
    this.ca = cameraAspect;
    this.k = this.sa > this.ca ? this.sa / this.ca : 1;
  }

  viewToWorld(p: Vec2): Vec2 {
    return { x: (p.x - 0.5) * this.ca * this.k, y: -(p.y - 0.5) * this.k };
  }

  worldToView(p: Vec2): Vec2 {
    return { x: p.x / (this.ca * this.k) + 0.5, y: 0.5 - p.y / this.k };
  }

  /** View-height length → world length. */
  len(v: number): number {
    return v * this.k;
  }

  worldToScreen(p: Vec2): Vec2 {
    return { x: (p.x / this.sa + 0.5) * this.w, y: (0.5 - p.y) * this.h };
  }

  viewToScreen(p: Vec2): Vec2 {
    return this.worldToScreen(this.viewToWorld(p));
  }

  screenToView(x: number, y: number): Vec2 {
    return this.worldToView({ x: (x / this.w - 0.5) * this.sa, y: 0.5 - y / this.h });
  }
}

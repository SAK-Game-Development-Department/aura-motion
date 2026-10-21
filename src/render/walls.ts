// Pose walls: a translucent grid of light approaching the player with a
// human-shaped hole cut out (drawn on a canvas from the pose template, sized
// to the player's body). The hole's rim lights up cyan as the pose matches.
import * as THREE from 'three/webgpu';
import { abs, float, fract, max, mix, smoothstep, texture, uniform, uv, vec2, vec3, vec4, min } from 'three/tsl';
import { BONES, LM } from '../core/types';
import { PALETTE, hexToLinear } from '../config';
import type { Anchor } from '../input/body';
import { buildLandmarks, defaultBody, PROPORTIONS } from '../input/skeleton';
import type { PoseTemplate } from '../stage/poses';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const CW = 640;
const CH = 360;

export function templateLandmarks(tpl: PoseTemplate, anchor: Anchor, aspect: number, seated: boolean) {
  const P = PROPORTIONS;
  const H = anchor.unit / P.shoulderW;
  const b = defaultBody(aspect);
  b.height = H;
  b.cx = anchor.x;
  b.seated = seated;
  b.floorY = seated ? anchor.y + P.torso * H + 0.32 * H : anchor.y + (P.torso + P.thigh + P.shin) * H;
  b.armL = { ...tpl.armL };
  b.armR = { ...tpl.armR };
  if (tpl.legL && tpl.legR) {
    b.legL = { ...tpl.legL };
    b.legR = { ...tpl.legR };
  }
  return { lm: buildLandmarks(b), H };
}

class WallSlot {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  readonly uProg = uniform(0);
  readonly uMatch = uniform(0);
  readonly uAlpha = uniform(0);
  readonly uResult = uniform(0); // +1 pass flash, -1 fail
  readonly uTime = uniform(0);
  id = -1;

  constructor() {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(CW, CH) : Object.assign(document.createElement('canvas'), { width: CW, height: CH });
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    this.tex = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement);
    this.tex.colorSpace = THREE.NoColorSpace;
    const magenta = vec3(...hexToLinear(PALETTE.magenta));
    const cyan = vec3(...hexToLinear(PALETTE.cyan));
    const white = vec3(...hexToLinear(PALETTE.white));
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    mat.colorNode = (() => {
      const u = uv() as N;
      const t = (o: N) => texture(this.tex, u.add(o)).x;
      const hole = t(vec2(0, 0));
      const s = 0.012;
      // Rim = blurred hole minus hole (8 taps).
      const blur = t(vec2(s, 0)).add(t(vec2(-s, 0))).add(t(vec2(0, s * 1.7))).add(t(vec2(0, -s * 1.7)))
        .add(t(vec2(s, s))).add(t(vec2(-s, s))).add(t(vec2(s, -s))).add(t(vec2(-s, -s))).div(8);
      const rim = max(blur.sub(hole), float(0)).mul(3.0) as N;
      // Grid of light on the wall body.
      const g = vec2(16 * (CW / CH), 16);
      const cell = abs(fract(u.mul(g).add(vec2(0, this.uTime.mul(0.15)))).sub(0.5)) as N;
      const grid = smoothstep(0.47, 0.5, max(cell.x, cell.y));
      const edgeFade = smoothstep(0.0, 0.08, min(min(u.x, float(1).sub(u.x)), min(u.y, float(1).sub(u.y))));
      const wallA = float(1).sub(hole).mul(grid.mul(0.5).add(0.06)).mul(edgeFade);
      const rimCol = mix(magenta, cyan, this.uMatch);
      const pass = max(this.uResult, float(0));
      const fail = max(this.uResult.negate(), float(0));
      const col = magenta.mul(wallA).mul(float(0.55).add(this.uProg.mul(0.6)))
        .add(rimCol.mul(rim).mul(float(0.9).add(this.uMatch.mul(1.2))))
        .add(white.mul(rim).mul(pass).mul(1.5))
        .add(magenta.mul(wallA).mul(fail).mul(1.2));
      return vec4(col.mul(this.uAlpha) as N, 1);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  draw(tpl: PoseTemplate, anchor: Anchor, aspect: number, seated: boolean): void {
    const { lm, H } = templateLandmarks(tpl, anchor, aspect, seated);
    const c = this.ctx;
    c.fillStyle = '#000';
    c.fillRect(0, 0, CW, CH);
    c.strokeStyle = '#fff';
    c.fillStyle = '#fff';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const px = (i: number) => [lm[i]!.x * CW, lm[i]!.y * CH] as const;
    const limbW = 0.085 * H * CH;
    for (const [a, b] of BONES) {
      if (seated && (a >= LM.leftKnee || b >= LM.leftKnee) && a !== LM.leftHip && a !== LM.rightHip) continue;
      const [ax, ay] = px(a);
      const [bx, by] = px(b);
      c.lineWidth = a === LM.leftShoulder && b === LM.leftHip ? limbW * 1.8 : limbW;
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(bx, by);
      c.stroke();
    }
    // Torso block and head.
    c.beginPath();
    for (const i of [LM.leftShoulder, LM.rightShoulder, LM.rightHip, LM.leftHip]) {
      const [x, y] = px(i);
      if (i === LM.leftShoulder) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    c.lineWidth = limbW * 1.4;
    c.stroke();
    const [nx, ny] = px(LM.nose);
    c.beginPath();
    c.arc(nx, ny - 0.01 * H * CH, 0.075 * H * CH, 0, Math.PI * 2);
    c.fill();
    if (seated) {
      // Open the hole downward so the seated body/chair always fits.
      const [hx, hy] = px(LM.leftHip);
      const [rx] = px(LM.rightHip);
      c.fillRect(hx - limbW, hy, rx - hx + limbW * 2, CH - hy);
    }
    this.tex.needsUpdate = true;
  }
}

export class Walls {
  readonly group = new THREE.Group();
  private slots: WallSlot[] = [];

  constructor(n = 3) {
    for (let i = 0; i < n; i++) {
      const s = new WallSlot();
      this.slots.push(s);
      this.group.add(s.mesh);
    }
  }

  /** Get (and draw on first use) the slot for a wall id. */
  slot(id: number, draw: () => [PoseTemplate, Anchor, number, boolean]): WallSlot | null {
    const existing = this.slots.find((x) => x.id === id);
    if (existing) return existing;
    const s = this.slots.find((x) => x.id === -1);
    if (!s) return null;
    s.id = id;
    const [tpl, a, aspect, seated] = draw();
    s.draw(tpl, a, aspect, seated);
    return s;
  }

  release(id: number): void {
    const s = this.slots.find((x) => x.id === id);
    if (s) {
      s.id = -1;
      s.mesh.visible = false;
    }
  }

  get active(): WallSlot[] {
    return this.slots.filter((s) => s.id !== -1);
  }

  hideAll(): void {
    for (const s of this.slots) {
      s.id = -1;
      s.mesh.visible = false;
    }
  }
}

export type { WallSlot };

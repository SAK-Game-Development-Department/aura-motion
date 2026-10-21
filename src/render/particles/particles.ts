// GPU particle silhouette + ambient flow (TSL compute; runs on WebGPU and on
// the WebGL2 backend via transform feedback).
//
// Per particle: pos = (x, y, life, role)  vel = (vx, vy, heat, seed)
//   role < 0.5 → "body" particle: attracted into the silhouette, swirls inside,
//                dragged by the body motion field (→ trails when waving).
//   role ≥ 0.5 → "ambient" particle: curl-noise flow; pushed out of the body
//                and dragged by limb motion (→ "part the river with your arm").
//                In Flow mode a share of them becomes the amber stream.
//
// The silhouette field (signed distance + motion) arrives as a small RGBA8
// texture from the tracker (docs/decisions.md D4).
import * as THREE from 'three/webgpu';
import {
  Fn, If, float, hash, instanceIndex, instancedArray, length, max, min, mix, mx_noise_float, normalize, smoothstep, texture,
  uniform, uniformArray, uv, vec2, vec3, vec4, clamp, select, abs, exp, sin, cos, dot,
} from 'three/tsl';
import { PALETTE, RENDER, hexToLinear } from '../../config';
import { SDF_RANGE, VEL_RANGE } from '../../input/tracking/field';

export const KEYPOINTS = 16;

// @types/three's TSL typings are incomplete for some node combinations; TSL
// helper parameters use this loose alias (render code only).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export class Particles {
  readonly max: number;
  readonly sprite: THREE.Sprite;
  readonly fieldTex: THREE.DataTexture;
  private fieldData: Uint8Array;
  private initNode: THREE.ComputeNode;
  private updateNode: THREE.ComputeNode;
  private initialized = false;
  private frame = 0;

  // Uniforms (public for the world view / debug overlay).
  readonly uDt = uniform(1 / 60);
  readonly uTime = uniform(0);
  readonly uFrame = uniform(0);
  readonly uCount = uniform(0);
  readonly uSa = uniform(16 / 9);
  readonly uCa = uniform(16 / 9);
  readonly uK = uniform(1);
  readonly uPresent = uniform(0);
  /** 0..1 transformation reveal (body particles gather into the silhouette). */
  readonly uReveal = uniform(0);
  readonly uBodyFraction = uniform(RENDER.bodyFraction);
  readonly uCurlScale = uniform(RENDER.curlScale);
  readonly uCurlSpeed = uniform(RENDER.curlSpeed);
  readonly uSize = uniform(RENDER.particleSize);
  readonly uFlowOn = uniform(0);
  readonly uFlowShare = uniform(0.45);
  readonly uEmitter = uniform(new THREE.Vector2(-1, 0));
  readonly uEmitDir = uniform(new THREE.Vector2(1, 0));
  readonly uGoal = uniform(new THREE.Vector2(1, 0.3));
  readonly uFlowSpeed = uniform(0.45);
  readonly uBodyGlow = uniform(1);
  readonly uWarm = uniform(0);
  readonly uKeypoints: ReturnType<typeof uniformArray>;
  private keypointValues: THREE.Vector2[];

  constructor(maxCount: number, fieldW: number, fieldH: number) {
    this.max = maxCount;
    this.fieldData = new Uint8Array(fieldW * fieldH * 4);
    // Neutral field: everything "far outside", zero velocity, empty mask.
    for (let i = 0; i < fieldW * fieldH; i++) {
      this.fieldData[i * 4] = 0;
      this.fieldData[i * 4 + 1] = 128;
      this.fieldData[i * 4 + 2] = 128;
      this.fieldData[i * 4 + 3] = 0;
    }
    this.fieldTex = new THREE.DataTexture(this.fieldData, fieldW, fieldH, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.fieldTex.magFilter = THREE.LinearFilter;
    this.fieldTex.minFilter = THREE.LinearFilter;
    this.fieldTex.generateMipmaps = false;
    this.fieldTex.flipY = false;
    this.fieldTex.needsUpdate = true;

    this.keypointValues = Array.from({ length: KEYPOINTS }, () => new THREE.Vector2(0, 0));
    this.uKeypoints = uniformArray(this.keypointValues, 'vec2');

    const pos = instancedArray(maxCount, 'vec4');
    const vel = instancedArray(maxCount, 'vec4');
    const du = 1 / fieldW;
    const dv = 1 / fieldH;

    // World → field UV (field row 0 = top of the view).
    const fieldUv = (p: N): N => vec2(p.x.div(this.uCa.mul(this.uK)).add(0.5), float(0.5).sub(p.y.div(this.uK)));
    const sampleField = (u: N): N => texture(this.fieldTex, u).level(float(0) as N);

    const rnd = (salt: number) => hash(float(instanceIndex).add(this.uFrame.mul(131.0)).add(float(salt * 7919)));

    this.initNode = Fn(() => {
      const i = instanceIndex;
      const p = pos.element(i);
      const v = vel.element(i);
      const r0 = hash(float(i).add(0.5));
      const r1 = hash(float(i).add(1.5).mul(1.37));
      const r2 = hash(float(i).add(2.5).mul(2.11));
      const role = select(r2.lessThan(this.uBodyFraction), float(0), float(1));
      p.assign(vec4(r0.sub(0.5).mul(this.uSa), r1.sub(0.5), r2, role));
      v.assign(vec4(0, 0, 0, hash(float(i).add(9.5))));
    })().compute(maxCount);

    const cyan = vec3(...hexToLinear(PALETTE.cyan));
    const amber = vec3(...hexToLinear(PALETTE.amber));
    const magenta = vec3(...hexToLinear(PALETTE.magenta));
    const white = vec3(...hexToLinear(PALETTE.white));
    const indigo = vec3(0.05, 0.08, 0.35);

    this.updateNode = Fn(() => {
      const i = instanceIndex;
      If(float(i).lessThan(this.uCount), () => {
      const p = pos.element(i);
      const v = vel.element(i);
      const P = p.xy.toVar();
      const V = v.xy.toVar();
      const life = p.z.toVar();
      const role = p.w;
      const seed = v.w;
      const dt = this.uDt;

      // ── field sample: sdf (inside > 0), inward direction, motion velocity ──
      const fuv = fieldUv(P);
      const f = sampleField(fuv);
      const sdf = f.x.sub(0.5).mul(2 * SDF_RANGE).mul(this.uK); // world units
      const gx = sampleField(fuv.add(vec2(du, 0))).x.sub(sampleField(fuv.sub(vec2(du, 0))).x).div(this.uCa.mul(2 * du));
      const gy = sampleField(fuv.add(vec2(0, dv))).x.sub(sampleField(fuv.sub(vec2(0, dv))).x).div(2 * dv);
      const gvec = vec2(gx, gy.negate());
      const inward = gvec.div(max(length(gvec), 1e-5));
      const fvel = vec2(f.y.sub(0.5), f.z.sub(0.5).negate()).mul(2 * VEL_RANGE).mul(this.uK);
      const motion = length(fvel);
      const insideField = fuv.x.greaterThan(0).and(fuv.x.lessThan(1)).and(fuv.y.greaterThan(0)).and(fuv.y.lessThan(1));

      // ── curl noise (2D curl of a scalar noise) ──
      const q = vec3(P.mul(this.uCurlScale), this.uTime.mul(0.12).add(seed.mul(0.0)));
      const e = 0.01;
      const n0 = mx_noise_float(q);
      const nx = mx_noise_float(q.add(vec3(e, 0, 0)));
      const ny = mx_noise_float(q.add(vec3(0, e, 0)));
      const curl = vec2(ny.sub(n0), n0.sub(nx)).div(e).mul(this.uCurlSpeed).mul(0.05);

      const heat = v.z.toVar(); // brightness boost from motion, decays

      If(role.lessThan(0.5).and(this.uPresent.greaterThan(0.5)), () => {
        // ── body particle ──
        const reveal = this.uReveal;
        If(sdf.greaterThan(0), () => {
          // Inside: gentle swirl, strong damping, follow body motion. A soft
          // inward drift near the rim fills the interior (not just the outline).
          V.addAssign(curl.mul(2.0).mul(dt).mul(8.0));
          V.addAssign(inward.mul(smoothstep(float(0.035).mul(this.uK), float(0), sdf)).mul(0.9).mul(dt).mul(seed.mul(1.5).add(0.25)));
          V.addAssign(fvel.sub(V).mul(min(float(1), dt.mul(14.0))));
          V.mulAssign(float(1).sub(min(float(0.9), dt.mul(5.0))));
        }).Else(() => {
          // Outside: pulled back to the contour (lagging particles = trails).
          const dist = sdf.negate();
          const pull = float(1.4).add(min(dist, float(0.35)).mul(22.0)).mul(reveal.mul(0.85).add(0.15));
          V.addAssign(inward.mul(pull).mul(dt));
          V.addAssign(fvel.sub(V).mul(min(float(1), dt.mul(6.0))));
          V.mulAssign(float(1).sub(min(float(0.9), dt.mul(2.2))));
          // Far away or off-field: respawn near a random body keypoint.
          If(dist.greaterThan(float(0.3).mul(this.uK)).and(rnd(1).lessThan(dt.mul(3.0).mul(reveal.add(0.2)))).or(insideField.not()), () => {
            const k = min(rnd(2).mul(KEYPOINTS).floor(), float(KEYPOINTS - 1));
            const kp = (this.uKeypoints as N).element(k.toInt()) as N;
            const ang = rnd(3).mul(6.2831853);
            const rad = rnd(4).mul(0.04).mul(this.uK);
            P.assign(kp.add(vec2(cos(ang), sin(ang)).mul(rad)));
            V.assign(vec2(0, 0));
          });
        });
        heat.assign(max(heat.mul(float(1).sub(dt.mul(2.5))), min(motion.mul(0.6), float(1.5))));
      }).Else(() => {
        // ── ambient particle (and body particles when nobody is there) ──
        const isStream = this.uFlowOn.greaterThan(0.5).and(seed.lessThan(this.uFlowShare)).and(role.greaterThan(0.5));
        If(isStream, () => {
          // Amber river from the emitter, magnetically pulled into the goal when close.
          V.addAssign(this.uEmitDir.mul(this.uFlowSpeed).sub(V).mul(min(float(1), dt.mul(1.5))));
          V.addAssign(curl.mul(0.6).mul(dt).mul(6.0));
          const toGoal = this.uGoal.sub(P);
          const gd = length(toGoal);
          V.addAssign(toGoal.div(max(gd, 1e-4)).mul(smoothstep(0.35, 0.0, gd)).mul(1.2).mul(dt));
          life.subAssign(dt.mul(0.12));
          If(gd.lessThan(0.06).or(life.lessThan(0)).or(abs(P.x).greaterThan(this.uSa.mul(0.6))).or(abs(P.y).greaterThan(0.62)), () => {
            P.assign(this.uEmitter.add(vec2(rnd(5).sub(0.5).mul(0.02), rnd(6).sub(0.5).mul(0.08))));
            V.assign(this.uEmitDir.mul(this.uFlowSpeed));
            life.assign(rnd(7).mul(0.3).add(0.7));
          });
        }).Else(() => {
          V.addAssign(curl.sub(V.mul(0.6)).mul(min(float(1), dt.mul(1.8))));
        });
        // Body pushes ambient particles out along the normal and drags them.
        const near = smoothstep(float(-0.05).mul(this.uK), float(0.01), sdf).mul(this.uPresent);
        V.addAssign(inward.negate().mul(near).mul(3.5).mul(dt));
        V.addAssign(fvel.sub(V).mul(near).mul(min(float(1), dt.mul(10.0))));
        heat.assign(max(heat.mul(float(1).sub(dt.mul(1.5))), near.mul(min(motion, float(1.2)))));
        // Wrap around the screen.
        If(P.x.greaterThan(this.uSa.mul(0.55)), () => {
          P.x.subAssign(this.uSa.mul(1.1));
        });
        If(P.x.lessThan(this.uSa.mul(-0.55)), () => {
          P.x.addAssign(this.uSa.mul(1.1));
        });
        If(P.y.greaterThan(0.56), () => {
          P.y.subAssign(1.12);
        });
        If(P.y.lessThan(-0.56), () => {
          P.y.addAssign(1.12);
        });
      });

      // Speed cap & integrate.
      const sp = length(V);
      V.mulAssign(min(float(1), float(3.0).div(max(sp, 1e-4))));
      P.addAssign(V.mul(dt));
      p.assign(vec4(P, life, role));
      v.assign(vec4(V, heat, seed));
      });
    })().compute(maxCount);

    // ── rendering: additive soft sprites ──
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    const pAttr = pos.toAttribute();
    const vAttr = vel.toAttribute();
    mat.positionNode = vec3(pAttr.x, pAttr.y, 0);
    const isBody = pAttr.w.lessThan(0.5).and(this.uPresent.greaterThan(0.5));
    const stream = this.uFlowOn.greaterThan(0.5).and(vAttr.w.lessThan(this.uFlowShare)).and(pAttr.w.greaterThan(0.5));
    const heatN = clamp(vAttr.z, 0, 1.5);
    const sizeMul = select(isBody, float(1.0).add(heatN.mul(0.5)), select(stream, float(1.1), float(0.55).add(heatN.mul(0.4))));
    mat.scaleNode = this.uSize.mul(sizeMul).mul(this.uK);
    mat.colorNode = (() => {
      const d = length(uv().sub(0.5)).mul(2);
      const fall = exp(d.mul(d).mul(-4.5)).mul(smoothstep(1.0, 0.7, d));
      const twinkle = sin(this.uTime.mul(3.0).add(vAttr.w.mul(60.0))).mul(0.15).add(0.85);
      const bodyCol = mix(mix(cyan, white, heatN.mul(0.45)), amber, this.uWarm.mul(0.3)).mul(this.uBodyGlow.mul(this.uReveal.mul(0.7).add(0.3))).mul(0.55);
      const ambCol = mix(indigo, cyan, heatN.mul(0.8)).mul(float(0.02).add(heatN.mul(0.45)));
      const streamCol = mix(amber, white, heatN.mul(0.3)).mul(0.5);
      const c = select(isBody, bodyCol, select(stream, streamCol, ambCol)).mul(twinkle);
      // Slight magenta sparkle in the hottest (fastest) body particles.
      const hot = smoothstep(1.0, 1.5, heatN).mul(select(isBody, float(1), float(0)));
      return vec4(mix(c, magenta.mul(0.6), hot.mul(0.25)).mul(fall), 1);
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = 0;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 10;
    void dot; // (kept for future force-field tweaks)
  }

  setCount(n: number): void {
    const c = Math.min(this.max, n);
    this.uCount.value = c;
    this.sprite.count = c;
  }

  get count(): number {
    return this.sprite.count;
  }

  /** Upload a new packed field (same size as constructed). */
  setField(data: Uint8Array): void {
    if (data.length !== this.fieldData.length) return;
    this.fieldData.set(data);
    this.fieldTex.needsUpdate = true;
  }

  setKeypoints(points: ReadonlyArray<{ x: number; y: number }>): void {
    for (let i = 0; i < KEYPOINTS; i++) {
      const p = points[i % Math.max(1, points.length)];
      if (p) this.keypointValues[i]!.set(p.x, p.y);
    }
  }

  update(renderer: THREE.WebGPURenderer, dt: number, time: number): void {
    if (!this.initialized) {
      renderer.compute(this.initNode);
      this.initialized = true;
    }
    this.frame = (this.frame + 1) % 10000;
    this.uFrame.value = this.frame;
    this.uDt.value = Math.min(dt, 1 / 20);
    this.uTime.value = time;
    renderer.compute(this.updateNode);
  }
}

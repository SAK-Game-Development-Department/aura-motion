// Background: deep indigo void with a slow nebula, beat pulse ripples and the
// (safety-limited) flash. Everything is subtle — the body is the star.
import * as THREE from 'three/webgpu';
import { float, length, mix, mx_noise_float, smoothstep, uniform, uv, vec2, vec3, vec4, exp, abs, max } from 'three/tsl';
import { PALETTE, hexToLinear } from '../config';

export class Background {
  readonly mesh: THREE.Mesh;
  readonly uTime = uniform(0);
  /** 0..1 beat phase (0 = on the beat). */
  readonly uBeat = uniform(0);
  readonly uPulseAmp = uniform(1);
  readonly uFlash = uniform(0);
  readonly uRipple = uniform(0); // 0..1 age of the latest hit ripple
  readonly uRippleCenter = uniform(new THREE.Vector2(0, 0));
  readonly uAspect = uniform(16 / 9);
  readonly uIntensity = uniform(1); // section energy (Finale = high)
  readonly uWarm = uniform(0); // amber tint (flow/finale)

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    const indigo = vec3(...hexToLinear(PALETTE.indigo));
    const voidC = vec3(...hexToLinear(PALETTE.void));
    const deep = vec3(...hexToLinear(PALETTE.voidDeep));
    const cyan = vec3(...hexToLinear(PALETTE.cyan));
    const amber = vec3(...hexToLinear(PALETTE.amber));
    mat.colorNode = (() => {
      const p = uv().sub(0.5).mul(vec2(this.uAspect, 1));
      const r = length(p);
      // Radial gradient: indigo glow in the middle → void → deep at the edges.
      const base = mix(mix(indigo, voidC, smoothstep(0.0, 0.55, r)), deep, smoothstep(0.5, 1.1, r));
      // Slow nebula.
      const n = mx_noise_float(vec3(p.mul(2.2), this.uTime.mul(0.04))).mul(0.5).add(0.5);
      const n2 = mx_noise_float(vec3(p.mul(5.0).add(7.1), this.uTime.mul(0.07))).mul(0.5).add(0.5);
      const neb = n.mul(n2).mul(0.11).mul(this.uIntensity.mul(0.5).add(0.6));
      const tint = mix(cyan, amber, this.uWarm);
      // Beat pulse: a soft ring expanding from the centre on each beat.
      const ringR = this.uBeat.mul(0.9);
      const ring = exp(abs(r.sub(ringR)).mul(-28.0)).mul(float(1).sub(this.uBeat)).mul(0.05).mul(this.uPulseAmp).mul(this.uIntensity);
      // Hit ripple.
      const rp = length(uv().sub(0.5).mul(vec2(this.uAspect, 1)).sub(this.uRippleCenter));
      const rip = exp(abs(rp.sub(this.uRipple.mul(0.8))).mul(-35.0)).mul(max(float(0), float(1).sub(this.uRipple))).mul(0.07).mul(this.uPulseAmp);
      const col = base.add(tint.mul(neb.add(ring).add(rip))).add(vec3(this.uFlash));
      return vec4(col, 1);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.position.z = -5;
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }

  fit(sa: number): void {
    this.mesh.scale.set(sa * 1.1, 1.1, 1);
    this.uAspect.value = sa;
  }
}

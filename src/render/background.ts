// Background: deep indigo void with a slow nebula, beat pulse ripples and the
// (safety-limited) flash. Everything is subtle — the body is the star.
import * as THREE from 'three/webgpu';
import { float, length, mix, mx_noise_float, smoothstep, uniform, uv, vec2, vec3, vec4, exp, abs, max, atan, cos, fract } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
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
  /** 0..1 barrier ("天輪結界") pattern for the ultimate. */
  readonly uDomain = uniform(0);
  /** 0..1 darkening for cinematic cut-ins. */
  readonly uDim = uniform(0);

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    const indigo = vec3(...hexToLinear(PALETTE.indigo));
    const voidC = vec3(...hexToLinear(PALETTE.void));
    const deep = vec3(...hexToLinear(PALETTE.voidDeep));
    const cyan = vec3(...hexToLinear(PALETTE.cyan));
    const amber = vec3(...hexToLinear(PALETTE.amber));
    // Nebula is a brighter indigo (not cyan) so the void stays indigo-black.
    const nebulaC = vec3(...hexToLinear('#3a4cc0'));
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
      const nebTint = mix(nebulaC, amber, this.uWarm.mul(0.6));
      // Beat pulse: a soft ring expanding from the centre on each beat.
      const ringR = this.uBeat.mul(0.9);
      const ring = exp(abs(r.sub(ringR)).mul(-28.0)).mul(float(1).sub(this.uBeat)).mul(0.05).mul(this.uPulseAmp).mul(this.uIntensity);
      // Hit ripple.
      const rp = length(uv().sub(0.5).mul(vec2(this.uAspect, 1)).sub(this.uRippleCenter));
      const rip = exp(abs(rp.sub(this.uRipple.mul(0.8))).mul(-35.0)).mul(max(float(0), float(1).sub(this.uRipple))).mul(0.07).mul(this.uPulseAmp);
      // Barrier pattern: concentric rings drifting outward, rotating spokes and
      // a lattice of short rune ticks (original design), amber on darkened void.
      const ang = atan(p.y, p.x) as N;
      const rr = r as N;
      const rings = smoothstep(0.08, 0.0, abs(fract(rr.mul(5.0).sub(this.uTime.mul(0.35))).sub(0.5))).mul(0.6) as N;
      const spokes = smoothstep(0.96, 1.0, cos(ang.mul(12.0).add(this.uTime.mul(0.8)))).mul(smoothstep(0.08, 0.25, rr)) as N;
      const ticks = smoothstep(0.9, 1.0, cos(ang.mul(48.0).sub(this.uTime.mul(1.6)))).mul(smoothstep(0.03, 0.0, abs(rr.sub(0.36)))) as N;
      const halo = exp(abs(rr.sub(0.36)).mul(-30.0)).mul(0.8) as N;
      const domain = rings.add(spokes.mul(0.5)).add(ticks.mul(1.2)).add(halo).mul(smoothstep(1.0, 0.2, rr)).mul(this.uDomain) as N;
      const amberL = vec3(...hexToLinear(PALETTE.amber));
      const darkK = float(1).sub(max(this.uDim, this.uDomain.mul(0.6)).mul(0.85));
      const col = base.add(nebTint.mul(neb)).add(tint.mul(ring.add(rip))).mul(darkK).add(amberL.mul(domain)).add(vec3(this.uFlash));
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

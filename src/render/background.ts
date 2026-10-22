// Background: deep indigo void with a slow nebula, beat pulse ripples and the
// (safety-limited) flash. Everything is subtle — the body is the star.
import * as THREE from 'three/webgpu';
import { float, length, mix, mx_noise_float, smoothstep, uniform, uv, vec2, vec3, vec4, exp, abs, max, min, atan, cos, sin, fract, floor, hash, mod, dot, select } from 'three/tsl';

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
  /** Stage themes (weights 0..1, cross-faded by the world view). */
  readonly uLake = uniform(0);
  readonly uStars = uniform(0);
  readonly uCrystal = uniform(0);
  readonly uEclipse = uniform(0);
  readonly uStorm = uniform(0);
  /** Warp speed for the star corridor (rises with action). */
  readonly uWarp = uniform(1);

  /** Theme layers: separate full-screen meshes so inactive themes cost nothing. */
  private layers: Array<{ mesh: THREE.Mesh; w: { value: number } }> = [];

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    const indigo = vec3(...hexToLinear(PALETTE.indigo));
    const voidC = vec3(...hexToLinear(PALETTE.void));
    const deep = vec3(...hexToLinear(PALETTE.voidDeep));
    const cyan = vec3(...hexToLinear(PALETTE.cyan));
    const amber = vec3(...hexToLinear(PALETTE.amber));
    const amberL = amber;
    const magL = vec3(...hexToLinear(PALETTE.magenta));
    // Nebula is a brighter indigo (not cyan) so the void stays indigo-black.
    const nebulaC = vec3(...hexToLinear('#3a4cc0'));
    // Shared helpers (each material builds its own nodes).
    const P = () => uv().sub(0.5).mul(vec2(this.uAspect, 1)) as N;
    const darkK = () => float(1).sub(max(this.uDim, this.uDomain.mul(0.6)).mul(0.85)) as N;
    const t = this.uTime;
    mat.colorNode = (() => {
      const p = P();
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
      const rp = length(p.sub(this.uRippleCenter));
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
      const col = base
        .add(nebTint.mul(neb).mul(float(1).sub(this.uStars.mul(0.5))))
        .add(tint.mul(ring.add(rip)))
        .mul(darkK())
        .add(amberL.mul(domain))
        .add(vec3(this.uFlash));
      return vec4(col, 1);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.position.z = -5;
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;

    // ── 宵の湖 (Evening Lake): mirror-still water below a misty horizon ──
    this.layer(this.uLake, () => {
      const q = uv() as N;
      const hy = float(0.34); // horizon (uv.y from the bottom)
      const below = smoothstep(hy, hy.sub(0.01), q.y) as N;
      const depth = max(hy.sub(q.y), float(0.001)) as N;
      const waveN = mx_noise_float(vec3(q.x.mul(3.0).div(depth.add(0.05)).mul(0.15), float(1).div(depth.add(0.03)).mul(0.6).sub(t.mul(0.8)), t.mul(0.1)) as N) as N;
      const glints = smoothstep(0.55, 0.9, waveN).mul(below).mul(smoothstep(0.0, 0.25, depth)).mul(0.35) as N;
      const mist = exp(abs(q.y.sub(hy)).mul(-38.0)).mul(0.18) as N;
      const reflect = waveN.mul(0.5).add(0.5).mul(0.04).mul(below) as N;
      return cyan.mul(glints.add(mist)).add(nebulaC.mul(reflect)) as N;
    });

    // ── 星の回廊 (Corridor of Stars): warp streaks rushing past ──
    this.layer(this.uStars, () => {
      const p = P();
      const rr = length(p) as N;
      const ang = atan(p.y, p.x) as N;
      const cells = float(140);
      const cell = floor(ang.mul(cells.div(6.2831853)).add(cells)) as N;
      const rnd = hash(cell) as N;
      const rnd2 = hash(cell.add(77.0)) as N;
      const head = fract(rnd.add(t.mul(this.uWarp).mul(rnd2.mul(0.35).add(0.15)))) as N;
      const headR = head.mul(head).mul(1.3) as N;
      const streakLen = headR.mul(0.25).add(0.01) as N;
      const inStreak = smoothstep(streakLen, float(0), headR.sub(rr)).mul(smoothstep(float(-0.004), float(0.0), headR.sub(rr))) as N;
      const angW = abs(fract(ang.mul(cells.div(6.2831853))).sub(0.5)) as N;
      const thin = smoothstep(0.5, 0.0, angW.mul(min(headR.mul(9.0), float(9.0)))) as N;
      return mix(cyan, vec3(1, 1, 1), rnd2).mul(inStreak.mul(thin).mul(head.mul(1.4))).mul(step01(rnd, 0.35)) as N;
    });

    // ── 結晶の洞 (Crystal Cavern): a breathing hexagonal lattice ──
    this.layer(this.uCrystal, () => {
      const p = P();
      const rr = length(p) as N;
      const hp = p.mul(7.0).add(vec2(0, t.mul(0.08))) as N;
      const r3 = vec2(1.0, 1.7320508);
      const hh = r3.mul(0.5);
      const ga = mod(hp, r3).sub(hh) as N;
      const gb = mod(hp.sub(hh), r3).sub(hh) as N;
      const gv = select(dot(ga, ga).lessThan(dot(gb, gb)), ga, gb) as N;
      const hx = max(abs(gv.x).mul(0.866).add(abs(gv.y).mul(0.5)), abs(gv.y)) as N;
      const edgeH = smoothstep(0.03, 0.0, abs(hx.sub(0.5))) as N;
      const pulse = mx_noise_float(vec3(hp.sub(gv).mul(0.35), t.mul(0.5)) as N).mul(0.5).add(0.5) as N;
      return cyan.mul(edgeH.mul(pulse.mul(0.32).add(0.06))).add(vec3(0.05, 0.08, 0.2).mul(pulse.mul(0.4))).mul(smoothstep(1.2, 0.2, rr)) as N;
    });

    // ── 月蝕の天 (Eclipse Sky): a black moon with a burning corona and a rune ring ──
    // Premultiplied "over": the moon disk occludes what is behind it, the corona adds light.
    this.layer(
      this.uEclipse,
      () => {
        const mc = P().sub(vec2(0, 0.17)) as N;
        const md = length(mc) as N;
        const mAng = atan(mc.y, mc.x) as N;
        const moonR = float(0.19);
        const coronaN = mx_noise_float(vec3((cos(mAng) as N).mul(3.0), (sin(mAng) as N).mul(3.0), t.mul(0.35)) as N).mul(0.5).add(0.5) as N;
        const corona = exp(max(md.sub(moonR), float(0)).mul(float(-14.0).add(coronaN.mul(6.0)))).mul(smoothstep(moonR.sub(0.004), moonR, md)).mul(0.9) as N;
        const runeTicks = smoothstep(0.85, 1.0, cos(mAng.mul(36.0).add(t.mul(0.4)))).mul(smoothstep(0.006, 0.0, abs(md.sub(0.29)))) as N;
        const runeRing = exp(abs(md.sub(0.29)).mul(-120.0)).mul(0.4) as N;
        return amberL.mul(corona.add(runeTicks.mul(0.8)).add(runeRing)).add(magL.mul(corona.mul(0.25))) as N;
      },
      () => {
        const md = length(P().sub(vec2(0, 0.17))) as N;
        return smoothstep(0.19, 0.184, md).mul(0.9) as N;
      },
    );

    // ── 虚空の嵐 (Storm of the Void): a slow vortex of magenta cloud ──
    this.layer(this.uStorm, () => {
      const p = P();
      const rr = length(p) as N;
      const ang = atan(p.y, p.x) as N;
      const sw = ang.add(rr.mul(4.0)).sub(t.mul(0.25)) as N;
      const sn = mx_noise_float(vec3((cos(sw) as N).mul(rr.mul(3.0)), (sin(sw) as N).mul(rr.mul(3.0)), t.mul(0.15)) as N).mul(0.5).add(0.5) as N;
      return magL.mul(sn.mul(sn).mul(0.35).mul(smoothstep(0.05, 0.5, rr))).add(nebulaC.mul(sn.mul(0.12))) as N;
    });
    // Fold the weight and the cinematic darkening into each layer.
    for (const l of this.layers) {
      const m = l.mesh.material as THREE.MeshBasicNodeMaterial;
      m.colorNode = (m.colorNode as N).mul(darkK()).mul(l.w as N) as N;
      if (m.opacityNode) m.opacityNode = (m.opacityNode as N).mul(l.w as N) as N;
    }
  }

  private layer(w: { value: number }, color: () => N, occlusion?: () => N): void {
    const m = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, transparent: true });
    m.colorNode = color();
    if (occlusion) {
      // ONE, ONE_MINUS_SRC_ALPHA: adds the colour and darkens behind by alpha.
      m.blending = THREE.CustomBlending;
      m.blendSrc = THREE.OneFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
      m.opacityNode = occlusion();
    } else {
      m.blending = THREE.AdditiveBlending;
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.position.z = 0.001; // just in front of the base plane (child of it)
    mesh.renderOrder = -99;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.mesh.add(mesh);
    this.layers.push({ mesh, w });
  }

  /** Show only the theme layers with weight (call once per frame after setting weights). */
  syncLayers(): void {
    for (const l of this.layers) l.mesh.visible = l.w.value > 0.003;
  }

  fit(sa: number): void {
    this.mesh.scale.set(sa * 1.1, 1.1, 1);
    this.uAspect.value = sa;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function step01(x: any, p: number): any {
  return smoothstep(p - 0.02, p + 0.02, x);
}

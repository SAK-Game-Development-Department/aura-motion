// Spirits (enemies): dark shapes with a glowing rim, drawn with *normal*
// blending so they read as holes of darkness in the light. Three looks, one
// per stage: writhing shadow blobs, crisp crystals, licking flames and
// drifting jellyfish.
// One instanced mesh; per-instance params drive shape, hurt flash and the
// dissolve when defeated.
import * as THREE from 'three/webgpu';
import { abs, atan, cos, exp, float, fract, instancedDynamicBufferAttribute, length, max, mix, mx_noise_float, sin, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export class EnemyBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly uTime = uniform(0);
  private params: Float32Array; // seed, hurt, dissolve, kind
  private rim: Float32Array; // rgb, alpha
  private pAttr: THREE.InstancedBufferAttribute;
  private rAttr: THREE.InstancedBufferAttribute;
  private n = 0;
  private m = new THREE.Matrix4();

  constructor(readonly capacity = 48) {
    this.params = new Float32Array(capacity * 4);
    this.rim = new Float32Array(capacity * 4);
    this.pAttr = new THREE.InstancedBufferAttribute(this.params, 4).setUsage(THREE.DynamicDrawUsage);
    this.rAttr = new THREE.InstancedBufferAttribute(this.rim, 4).setUsage(THREE.DynamicDrawUsage);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending });
    const prm = instancedDynamicBufferAttribute(this.pAttr as N, 'vec4') as N;
    const rimc = instancedDynamicBufferAttribute(this.rAttr as N, 'vec4') as N;
    const p = uv().sub(0.5).mul(2) as N;
    const t = this.uTime;
    // Style (params.w): 0 shadow blob, 1 crystal, 2 flame. Weights pick the shape.
    const wC = smoothstep(0.5, 0.51, prm.w).mul(float(1).sub(smoothstep(1.5, 1.51, prm.w))) as N;
    const wF = smoothstep(1.5, 1.51, prm.w).mul(float(1).sub(smoothstep(2.5, 2.51, prm.w))) as N;
    const wJ = smoothstep(2.5, 2.51, prm.w) as N;
    const wS = float(1).sub(wC).sub(wF).sub(wJ) as N;
    // Shadow: writhing edge — noise in space and time (each spirit has its own seed).
    const dS = length(p) as N;
    const n1 = mx_noise_float(vec3(p.mul(2.3), t.mul(0.9).add(prm.x)) as N) as N;
    const n2 = mx_noise_float(vec3(p.mul(5.5).add(3.1), t.mul(1.7).add(prm.x)) as N) as N;
    const edgeS = float(0.6).add(n1.mul(0.16)).add(n2.mul(0.05)) as N;
    // Crystal: a tall hexagonal prism (sharp edges) that breathes slightly.
    const pc = p.mul(vec2(1.3, 0.92)) as N;
    const dC = max(abs(pc.x).mul(0.866).add(abs(pc.y).mul(0.5)), abs(pc.y)) as N;
    const edgeC = float(0.56).add(sin(t.mul(2.0).add(prm.x)).mul(0.015)) as N;
    // Flame: a teardrop whose top licks upward.
    const up = max(p.y, float(0)) as N;
    const dF = length(vec2(p.x.mul(float(1).add(up.mul(1.4))), p.y.mul(0.82).add(0.08)) as N) as N;
    const fn = mx_noise_float(vec3(p.x.mul(3.2), p.y.mul(2.2).sub(t.mul(2.6)), prm.x) as N) as N;
    const edgeF = float(0.56).add(fn.mul(0.2).mul(smoothstep(-0.3, 0.9, p.y))).add(n2.mul(0.04)) as N;
    // Jellyfish: a bell with a rippling skirt; tentacles sway below it.
    const skirt = float(-0.16).add(sin(p.x.mul(14.0).add(t.mul(3.0)).add(prm.x)).mul(0.045)) as N;
    const bellK = float(1).add(sin(t.mul(2.2).add(prm.x)).mul(0.04)) as N; // pulsing
    const dJ0 = length(vec2(p.x.div(bellK.mul(0.64)), p.y.sub(0.08).div(0.52)) as N).mul(0.6) as N;
    const belowSkirt = smoothstep(skirt, skirt.sub(0.03), p.y) as N;
    const dJ = dJ0.add(belowSkirt.mul(2.0)) as N;
    const edgeJ = float(0.6).add(n2.mul(0.015)) as N;
    const tx = fract(p.x.mul(4.2).add(sin(p.y.mul(6.0).add(t.mul(2.0)).add(prm.x)).mul(0.22))).sub(0.5) as N;
    const tent = smoothstep(0.09, 0.0, abs(tx)).mul(belowSkirt).mul(smoothstep(-0.95, -0.35, p.y)).mul(smoothstep(0.52, 0.4, abs(p.x))).mul(wJ) as N;
    const d = dS.mul(wS).add(dC.mul(wC)).add(dF.mul(wF)).add(dJ.mul(wJ)) as N;
    const edge = edgeS.mul(wS).add(edgeC.mul(wC)).add(edgeF.mul(wF)).add(edgeJ.mul(wJ)) as N;
    const soft = float(0.07).sub(wC.mul(0.055)) as N; // crystals are crisp
    const body = smoothstep(edge, edge.sub(soft), d) as N;
    // Dissolve: noise threshold eats the body from the inside, with a burning rim.
    const dn = mx_noise_float(vec3(p.mul(4.0), prm.x.mul(7.0)) as N).mul(0.5).add(0.5) as N;
    const alive = smoothstep(prm.z, prm.z.add(0.08), dn) as N;
    const burn = smoothstep(0.12, 0.0, abs(dn.sub(prm.z))).mul(smoothstep(0.0, 0.05, prm.z)) as N;
    const rimGlow = exp(abs(d.sub(edge)).mul(float(-22.0).sub(wC.mul(18.0)))).mul(1.4) as N;
    const inner = mx_noise_float(vec3(p.mul(3.0), t.mul(0.5).sub(prm.x)) as N).mul(0.5).add(0.5) as N;
    const darkS = mix(vec3(0.012, 0.004, 0.03), vec3(0.06, 0.01, 0.1), inner.mul(smoothstep(0.6, 0.0, dS))) as N;
    // Crystal: facets (lines from the centre to the corners) glow faintly.
    const ang = atan(pc.y, pc.x) as N;
    const facet = smoothstep(0.93, 1.0, cos(ang.mul(6.0))).mul(smoothstep(0.05, 0.4, dC)).mul(0.5) as N;
    const darkC = vec3(0.01, 0.02, 0.05).add(rimc.xyz.mul(facet.add(inner.mul(0.06)))) as N;
    // Flame: a hot core low in the body, dark crimson above.
    const core = smoothstep(0.55, 0.0, length(p.sub(vec2(0, -0.2)))).mul(0.35) as N;
    const darkF = mix(vec3(0.03, 0.004, 0.004), vec3(0.12, 0.02, 0.0), inner).add(rimc.xyz.mul(core)) as N;
    // Jellyfish: translucent, a glowing inner band under the bell.
    const band = smoothstep(0.1, 0.0, abs(p.y.add(0.02).sub(dJ0.mul(0.25)))).mul(0.25) as N;
    const darkJ = vec3(0.01, 0.02, 0.05).add(rimc.xyz.mul(band.add(inner.mul(0.1)))) as N;
    const darkBody = darkS.mul(wS).add(darkC.mul(wC)).add(darkF.mul(wF)).add(darkJ.mul(wJ)) as N;
    const hurt = prm.y as N;
    const col = darkBody
      .add(rimc.xyz.mul(rimGlow.add(burn.mul(2.5)).add(tent.mul(0.9))))
      .add(vec3(1.0, 0.9, 1.0).mul(hurt.mul(body).mul(0.6))) as N;
    const a = max(max(body.mul(alive).mul(float(1).sub(wJ.mul(0.25))), rimGlow.mul(0.85).add(burn)).mul(smoothstep(1.0, 0.92, d)), tent.mul(alive).mul(0.8)).mul(rimc.w) as N;
    mat.colorNode = vec4(col, 1);
    mat.opacityNode = a;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.count = 0;
  }

  begin(): void {
    this.n = 0;
  }

  /** Add a spirit at world (x, y), size (world units), rim colour, alpha, seed, hurt 0..1, dissolve 0..1, style (0 shadow, 1 crystal, 2 flame, 3 jellyfish). */
  add(x: number, y: number, size: number, rgb: readonly [number, number, number], alpha: number, seed: number, hurt: number, dissolve: number, style = 0): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.m.makeScale(size, size, 1);
    this.m.setPosition(x, y, 0);
    this.mesh.setMatrixAt(i, this.m);
    const o = i * 4;
    this.params[o] = seed;
    this.params[o + 1] = hurt;
    this.params[o + 2] = dissolve;
    this.params[o + 3] = style;
    this.rim[o] = rgb[0];
    this.rim[o + 1] = rgb[1];
    this.rim[o + 2] = rgb[2];
    this.rim[o + 3] = alpha;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.pAttr.needsUpdate = true;
    this.rAttr.needsUpdate = true;
  }
}

// Shadow spirits (enemies): dark, writhing blobs with a glowing rim, drawn
// with *normal* blending so they read as holes of darkness in the light.
// One instanced mesh; per-instance params drive shape, hurt flash and the
// dissolve when defeated.
import * as THREE from 'three/webgpu';
import { abs, exp, float, instancedDynamicBufferAttribute, length, max, mix, mx_noise_float, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';

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
    const d = length(p) as N;
    const t = this.uTime;
    // Writhing edge: noise in space and time (each spirit has its own seed).
    const n1 = mx_noise_float(vec3(p.mul(2.3), t.mul(0.9).add(prm.x)) as N) as N;
    const n2 = mx_noise_float(vec3(p.mul(5.5).add(3.1), t.mul(1.7).add(prm.x)) as N) as N;
    const edge = float(0.6).add(n1.mul(0.16)).add(n2.mul(0.05)) as N;
    const body = smoothstep(edge, edge.sub(0.07), d) as N;
    // Dissolve: noise threshold eats the body from the inside, with a burning rim.
    const dn = mx_noise_float(vec3(p.mul(4.0), prm.x.mul(7.0)) as N).mul(0.5).add(0.5) as N;
    const alive = smoothstep(prm.z, prm.z.add(0.08), dn) as N;
    const burn = smoothstep(0.12, 0.0, abs(dn.sub(prm.z))).mul(smoothstep(0.0, 0.05, prm.z)) as N;
    const rimGlow = exp(abs(d.sub(edge)).mul(-22.0)).mul(1.4) as N;
    const inner = mx_noise_float(vec3(p.mul(3.0), t.mul(0.5).sub(prm.x)) as N).mul(0.5).add(0.5) as N;
    const darkBody = mix(vec3(0.012, 0.004, 0.03), vec3(0.06, 0.01, 0.1), inner.mul(smoothstep(0.6, 0.0, d))) as N;
    const hurt = prm.y as N;
    const col = darkBody
      .add(rimc.xyz.mul(rimGlow.add(burn.mul(2.5))))
      .add(vec3(1.0, 0.9, 1.0).mul(hurt.mul(body).mul(0.6))) as N;
    const a = max(body.mul(alive), rimGlow.mul(0.85).add(burn)).mul(rimc.w).mul(smoothstep(1.0, 0.92, d)) as N;
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

  /** Add a spirit at world (x, y), size (world units), rim colour, alpha, seed, hurt 0..1, dissolve 0..1. */
  add(x: number, y: number, size: number, rgb: readonly [number, number, number], alpha: number, seed: number, hurt: number, dissolve: number): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.m.makeScale(size, size, 1);
    this.m.setPosition(x, y, 0);
    this.mesh.setMatrixAt(i, this.m);
    const o = i * 4;
    this.params[o] = seed;
    this.params[o + 1] = hurt;
    this.params[o + 2] = dissolve;
    this.params[o + 3] = 0;
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

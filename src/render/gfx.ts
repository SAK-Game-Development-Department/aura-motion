// Renderer bootstrap: WebGPU first, WebGL2 fallback (same TSL code paths).
import * as THREE from 'three/webgpu';
import { pass, texture, uniform, uv, length, float, vec2, vec4, smoothstep } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
import { PALETTE, RENDER } from '../config';
import { Layout } from './layout';

export type Backend = 'webgpu' | 'webgl2';

export class Gfx {
  readonly scene = new THREE.Scene();
  /**
   * The background (soft noise, full of per-pixel work) is drawn into a smaller
   * render target and shown in the main scene as one textured quad — a quarter
   * of the pixels at RENDER.backgroundScale 0.5, and it looks the same.
   */
  readonly bgScene = new THREE.Scene();
  private bgTarget: THREE.RenderTarget;
  private bgQuad: THREE.Mesh;
  /** Device-pixel-ratio cap (staff "画質" setting). */
  pixelCap: number = RENDER.pixelRatioCap;
  readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -10, 10);
  readonly layout = new Layout();
  pipeline: THREE.RenderPipeline;
  private bloomOn: THREE.RenderPipeline;
  private bloomNoLens: THREE.RenderPipeline;
  private bloomOff: THREE.RenderPipeline;
  private bloomNode: ReturnType<typeof bloom>;
  private resScale = 1;
  effects = true;
  lens = true;

  private constructor(
    readonly renderer: THREE.WebGPURenderer,
    readonly backend: Backend,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.scene.background = new THREE.Color(PALETTE.voidDeep);
    this.camera.position.z = 5;
    this.bgScene.background = new THREE.Color(PALETTE.voidDeep);
    this.bgTarget = new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    const bgMat = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    bgMat.colorNode = texture(this.bgTarget.texture) as N;
    this.bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
    this.bgQuad.position.z = -4.99; // inside the camera range (z 5 ± 10)
    this.bgQuad.renderOrder = -200;
    this.bgQuad.frustumCulled = false;
    this.scene.add(this.bgQuad);
    const scenePass = pass(this.scene, this.camera);
    const color = scenePass.getTextureNode('output');
    const b = bloom(color, RENDER.bloom.strength, RENDER.bloom.radius, RENDER.bloom.threshold);
    this.bloomNode = b;
    // Lens: chromatic aberration (punches up on big hits / cinematics) and a soft vignette.
    const lit = color.add(b) as N;
    const ca = (chromaticAberration as N)(lit, this.uAberration, vec2(0.5, 0.5), 1.08) as N;
    const r = length(uv().sub(0.5).mul(1.6)) as N;
    const vig = float(1).sub(smoothstep(0.55, 1.25, r).mul(this.uVignette)) as N;
    // Exposure: the staff brightness setting scales the final picture.
    this.bloomOn = new THREE.RenderPipeline(renderer, vec4(ca.rgb.mul(vig).mul(this.uExposure) as N, float(1) as N) as N);
    // Without the lens pass (one render target less) for slower GPUs.
    this.bloomNoLens = new THREE.RenderPipeline(renderer, vec4(lit.rgb.mul(vig).mul(this.uExposure) as N, float(1) as N) as N);
    this.bloomOff = new THREE.RenderPipeline(renderer, vec4((color as N).rgb.mul(this.uExposure) as N, float(1) as N) as N);
    this.pipeline = this.bloomOn;
  }

  static async create(canvas: HTMLCanvasElement, opts: { forceWebGL: boolean }): Promise<Gfx> {
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL: opts.forceWebGL, powerPreference: 'high-performance', alpha: false });
    await renderer.init();
    const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const g = new Gfx(renderer, backend, canvas);
    g.resize();
    return g;
  }

  setResolutionScale(s: number): void {
    if (s === this.resScale) return;
    this.resScale = s;
    this.resize();
  }

  /** Lens uniforms (driven by the world view). */
  readonly uAberration = uniform(0.15);
  readonly uVignette = uniform(0.45);
  /** Overall exposure (staff brightness setting). */
  readonly uExposure = uniform(1);

  set bloomStrength(v: number) {
    this.bloomNode.strength.value = v;
  }

  setEffects(on: boolean, lens = this.lens): void {
    this.effects = on;
    this.lens = lens;
    this.pipeline = on ? (lens ? this.bloomOn : this.bloomNoLens) : this.bloomOff;
  }

  resize(cameraAspect?: number): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.layout.resize(w, h, cameraAspect ?? this.layout.ca);
    const pr = Math.min(window.devicePixelRatio || 1, this.pixelCap) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.bgTarget.setSize(Math.max(4, Math.round(w * pr * RENDER.backgroundScale)), Math.max(4, Math.round(h * pr * RENDER.backgroundScale)));
    const sa = this.layout.sa;
    this.camera.left = -sa / 2;
    this.camera.right = sa / 2;
    this.camera.top = 0.5;
    this.camera.bottom = -0.5;
    this.camera.updateProjectionMatrix();
    this.bgQuad.scale.set(sa, 1, 1);
  }

  setPixelCap(cap: number): void {
    if (cap === this.pixelCap) return;
    this.pixelCap = cap;
    this.resize();
  }

  render(): void {
    const r = this.renderer;
    r.setRenderTarget(this.bgTarget);
    r.render(this.bgScene, this.camera);
    r.setRenderTarget(null);
    this.pipeline.render();
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

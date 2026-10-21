// Renderer bootstrap: WebGPU first, WebGL2 fallback (same TSL code paths).
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { PALETTE, RENDER } from '../config';
import { Layout } from './layout';

export type Backend = 'webgpu' | 'webgl2';

export class Gfx {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -10, 10);
  readonly layout = new Layout();
  pipeline: THREE.RenderPipeline;
  private bloomOn: THREE.RenderPipeline;
  private bloomOff: THREE.RenderPipeline;
  private bloomNode: ReturnType<typeof bloom>;
  private resScale = 1;
  effects = true;

  private constructor(
    readonly renderer: THREE.WebGPURenderer,
    readonly backend: Backend,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.scene.background = new THREE.Color(PALETTE.voidDeep);
    this.camera.position.z = 5;
    const scenePass = pass(this.scene, this.camera);
    const color = scenePass.getTextureNode('output');
    const b = bloom(color, RENDER.bloom.strength, RENDER.bloom.radius, RENDER.bloom.threshold);
    this.bloomNode = b;
    this.bloomOn = new THREE.RenderPipeline(renderer, color.add(b));
    this.bloomOff = new THREE.RenderPipeline(renderer, color);
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

  set bloomStrength(v: number) {
    this.bloomNode.strength.value = v;
  }

  setEffects(on: boolean): void {
    this.effects = on;
    this.pipeline = on ? this.bloomOn : this.bloomOff;
  }

  resize(cameraAspect?: number): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.layout.resize(w, h, cameraAspect ?? this.layout.ca);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5) * this.resScale);
    this.renderer.setSize(w, h, false);
    const sa = this.layout.sa;
    this.camera.left = -sa / 2;
    this.camera.right = sa / 2;
    this.camera.top = 0.5;
    this.camera.bottom = -0.5;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

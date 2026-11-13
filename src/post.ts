import * as THREE from 'three';

// Spec §8 optional post: low-res render upscaled with nearest filtering, ordered dither and a warm grade.

const FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uRes;
  varying vec2 vUv;
  float bayer(vec2 p) {
    int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
    int i = x + y * 4;
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return float(m[i]) / 16.0 - 0.5;
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  void main() {
    vec3 c = toSRGB(texture2D(tScene, vUv).rgb);
    // Grade: a touch more contrast and saturation, warm highlights.
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 1.12);
    c = (c - 0.5) * 1.08 + 0.5;
    c *= vec3(1.04, 1.0, 0.94);
    // 5-bit-per-channel quantise with a 4×4 ordered dither, in low-res pixel space.
    float levels = 31.0;
    c = floor(c * levels + 0.5 + bayer(floor(vUv * uRes)) ) / levels;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class RetroPass {
  enabled = false;
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadScene = new THREE.Scene();

  constructor(private readonly height = 360) {
    this.rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType });
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { tScene: { value: this.rt.texture }, uRes: { value: new THREE.Vector2() } }, depthTest: false }),
    );
    this.quadScene.add(this.quad);
  }


  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.enabled) return renderer.render(scene, camera);
    const size = renderer.getSize(new THREE.Vector2());
    const h = this.height;
    const w = Math.round((h * size.x) / size.y);
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    this.quad.material.uniforms.uRes.value.set(w, h);
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.cam);
  }
}

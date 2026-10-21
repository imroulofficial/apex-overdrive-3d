import * as THREE from 'three';

// Mobile bloom for the race (blueprint §03): nitro flames, brake lights, the sun on the horizon
// and its glare on the sea. The scene renders once into an HDR (half-float, MSAA) target; a
// soft-threshold bright pass downsamples it, a separable 9-tap Gaussian (5 fetches per pass,
// linear-filtering trick) blurs it, and the composite adds the glow back and applies the
// tone mapping and sRGB output the renderer would otherwise do.
//
//   low     bright pass + blur at quarter resolution          4 extra draws
//   medium  bright pass + blur at half resolution, plus a      6 extra draws
//           quarter-resolution halo for the wide glow
//   off     the scene renders straight to the screen          0
// Full-screen passes draw one oversized triangle (no quad diagonal).

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

function pass(fragmentShader, uniforms, { output = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: output,
  });
}

const BRIGHT = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 texel; // source texel
  uniform float threshold, knee;
  varying vec2 vUv;
  void main() {
    // 4 bilinear taps = a 4x4 box: a clean downsample with no shimmer on thin highlights.
    vec3 c = texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb
      + texture2D(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb
      + texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb
      + texture2D(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb;
    c *= 0.25;
    float b = max(c.r, max(c.g, c.b));
    float soft = clamp(b - threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float w = max(soft, b - threshold) / max(b, 1e-4);
    gl_FragColor = vec4(min(c * w, vec3(16.0)), 1.0);
  }`;

const BLUR = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 dir; // one texel of the target, along the blur axis
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
    c += texture2D(tSrc, vUv + dir * 1.384615).rgb * 0.316216;
    c += texture2D(tSrc, vUv - dir * 1.384615).rgb * 0.316216;
    c += texture2D(tSrc, vUv + dir * 3.230769).rgb * 0.070270;
    c += texture2D(tSrc, vUv - dir * 3.230769).rgb * 0.070270;
    gl_FragColor = vec4(c, 1.0);
  }`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tScene, tBloom, tHalo;
  uniform float strength, halo;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    c += texture2D(tBloom, vUv).rgb * strength;
    #ifdef USE_HALO
      c += texture2D(tHalo, vUv).rgb * strength * halo;
    #endif
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class MobileBloom {
  constructor(renderer) {
    this.renderer = renderer;
    this.level = 'off';
    this.threshold = 1;
    this.strength = 0.5;
    this.flash = 0; // extra strength (lightning)
    const ext = renderer.extensions;
    this.type = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.size = new THREE.Vector2();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.bright = pass(BRIGHT, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 }, knee: { value: 0.5 } });
    this.blur = pass(BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.composite = pass(COMPOSITE, { tScene: { value: null }, tBloom: { value: null }, tHalo: { value: null }, strength: { value: 0.5 }, halo: { value: 0.8 } }, { output: true });
    this.targets = null;
  }

  get enabled() {
    return this.level !== 'off';
  }

  setLevel(level) {
    if (level === this.level) return;
    this.level = level;
    this.composite.defines = level === 'medium' ? { USE_HALO: '' } : {};
    this.composite.needsUpdate = true;
    this.dispose();
    if (this.enabled) this.allocate();
  }

  setParams({ threshold, strength }) {
    this.threshold = threshold;
    this.strength = strength;
  }

  allocate() {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    const rt = (x, y, opts = {}) =>
      new THREE.WebGLRenderTarget(Math.max(1, Math.round(x)), Math.max(1, Math.round(y)), {
        type: this.type,
        depthBuffer: false,
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearFilter,
        ...opts,
      });
    const div = this.level === 'medium' ? 2 : 4;
    this.targets = {
      scene: rt(w, h, { depthBuffer: true, samples: Math.min(4, r.capabilities.maxSamples ?? 4) }),
      a: rt(w / div, h / div),
      b: rt(w / div, h / div),
    };
    if (this.level === 'medium') {
      this.targets.c = rt(w / 4, h / 4);
      this.targets.d = rt(w / 4, h / 4);
    }
  }

  // Call after the canvas size or pixel ratio changes.
  resize() {
    if (!this.enabled) return;
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.targets && s.equals(this.size)) return;
    this.dispose();
    this.allocate();
  }

  draw(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.camera);
  }

  blurInto(src, tmp, dst) {
    const u = this.blur.uniforms;
    u.tSrc.value = src.texture;
    u.dir.value.set(1 / tmp.width, 0);
    this.draw(this.blur, tmp);
    u.tSrc.value = tmp.texture;
    u.dir.value.set(0, 1 / dst.height);
    this.draw(this.blur, dst);
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    if (!this.targets) this.allocate();
    const T = this.targets;
    r.setRenderTarget(T.scene);
    r.render(scene, camera);

    const b = this.bright.uniforms;
    b.tSrc.value = T.scene.texture;
    // Offsets of one source texel times half the downsample factor land each tap between texels.
    const div = T.scene.width / T.a.width;
    b.texel.value.set((0.5 * div) / T.scene.width, (0.5 * div) / T.scene.height);
    b.threshold.value = this.threshold;
    b.knee.value = Math.max(0.05, this.threshold * 0.5);
    this.draw(this.bright, T.a);
    this.blurInto(T.a, T.b, T.a);
    if (T.c) this.blurInto(T.a, T.c, T.d);

    const c = this.composite.uniforms;
    c.tScene.value = T.scene.texture;
    c.tBloom.value = T.a.texture;
    c.tHalo.value = T.d?.texture ?? null;
    c.strength.value = this.strength + this.flash;
    this.draw(this.composite, null);
  }

  dispose() {
    if (!this.targets) return;
    for (const t of Object.values(this.targets)) t.dispose();
    this.targets = null;
  }
}

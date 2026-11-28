import * as THREE from 'three';

// Mobile bloom and FXAA for the race (blueprint §03): nitro flames, brake lights, the sun on
// the horizon and its glare on the sea. The scene renders once into an HDR (half-float)
// target; a soft-threshold bright pass downsamples it, a separable 9-tap Gaussian (5 fetches
// per pass, linear-filtering trick) blurs it, and the composite adds the glow back, smooths
// edges with FXAA and applies the tone mapping and sRGB output the renderer would otherwise do.
//
//   low     bright pass + blur at quarter resolution          4 extra draws
//   medium  bright pass + blur at half resolution, plus a      6 extra draws
//           quarter-resolution halo for the wide glow
//   off     composite only (FXAA)                             1 extra draw
//           (with FXAA off too, the scene renders straight to the screen)
//
// Anti-aliasing: at a pixel ratio of 1.5 and up the scene target has no MSAA. The extra
// density does most of the work and FXAA cleans the remaining edges (road markings, rails,
// specular glints) for 5 fetches a pixel, 9 on an edge. A 4x MSAA half-float target at 2x on
// a 2400x1080 phone would be about 65 MB. Below 1.5 the target keeps 4x MSAA under the FXAA.
// Full-screen passes draw one oversized triangle (no quad diagonal).

// The pixel ratio from which the scene target drops MSAA and relies on FXAA alone.
export const FXAA_ONLY_PIXEL_RATIO = 1.5;

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
  uniform vec2 uScale, uMax; // dynamic resolution: the drawn part of the scene target
  uniform float threshold, knee;
  varying vec2 vUv;
  vec3 tap(vec2 o) { return texture2D(tSrc, min(vUv * uScale + texel * o, uMax)).rgb; }
  void main() {
    // 4 bilinear taps = a 4x4 box: a clean downsample with no shimmer on thin highlights.
    vec3 c = tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
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

// FXAA (after Lottes' FXAA 3.11 console variant): luma from the four diagonal neighbours finds
// the edge direction, two or four taps along it blend the edge. It runs on the linear HDR
// scene, so luma is compressed (x/(1+x), then sqrt) to roughly what the eye sees after tone
// mapping; flat pixels leave after 5 fetches.
const COMPOSITE = /* glsl */ `
  uniform sampler2D tScene, tBloom, tHalo;
  uniform float strength, halo;
  uniform vec2 texel; // one scene texel
  uniform vec2 uScale, uMax; // dynamic resolution (v76): the scene fills uScale of its target
  varying vec2 vUv;
  #ifdef USE_FXAA
    vec3 sceneAt(vec2 uv) { return texture2D(tScene, min(uv, uMax)).rgb; }
    float lumaOf(vec3 c) {
      float l = dot(min(c, vec3(16.0)), vec3(0.299, 0.587, 0.114));
      return sqrt(l / (1.0 + l));
    }
    vec3 fxaa(vec2 uv) {
      vec3 rgbM = sceneAt(uv);
      float lNW = lumaOf(sceneAt(uv + texel * vec2(-1.0, -1.0)));
      float lNE = lumaOf(sceneAt(uv + texel * vec2(1.0, -1.0)));
      float lSW = lumaOf(sceneAt(uv + texel * vec2(-1.0, 1.0)));
      float lSE = lumaOf(sceneAt(uv + texel * vec2(1.0, 1.0)));
      float lM = lumaOf(rgbM);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
      float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      if (lMax - lMin < max(0.0312, lMax * 0.125)) return rgbM;
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
      float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
      dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * texel;
      vec3 a = 0.5 * (sceneAt(uv - dir * (1.0 / 6.0)) + sceneAt(uv + dir * (1.0 / 6.0)));
      vec3 b = a * 0.5 + 0.25 * (sceneAt(uv - dir * 0.5) + sceneAt(uv + dir * 0.5));
      float lB = lumaOf(b);
      return lB < lMin || lB > lMax ? a : b;
    }
  #endif
  void main() {
    vec2 sUv = min(vUv * uScale, uMax);
    #ifdef USE_FXAA
      vec3 c = fxaa(sUv);
    #else
      vec3 c = texture2D(tScene, sUv).rgb;
    #endif
    #ifdef USE_BLOOM
      c += texture2D(tBloom, vUv).rgb * strength;
    #endif
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
    this.fxaa = true;
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
    // Dynamic resolution (v76, render/frameGovernor.js): the scene renders into the lower-left
    // `scale` of its target and the passes read only that part. Uniforms and a viewport only.
    this.scale = 1;
    this.uScale = { value: new THREE.Vector2(1, 1) };
    this.uMax = { value: new THREE.Vector2(1, 1) };
    this.bright = pass(BRIGHT, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, uScale: this.uScale, uMax: this.uMax, threshold: { value: 1 }, knee: { value: 0.5 } });
    this.blur = pass(BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.composite = pass(COMPOSITE, { tScene: { value: null }, tBloom: { value: null }, tHalo: { value: null }, strength: { value: 0.5 }, halo: { value: 0.8 }, texel: { value: new THREE.Vector2() }, uScale: this.uScale, uMax: this.uMax }, { output: true });
    this.targets = null;
    this.rebuild();
  }

  // Bloom is on (the nitro flames go HDR for it).
  get enabled() {
    return this.level !== 'off';
  }

  // Anything renders off screen first.
  get active() {
    return this.enabled || this.fxaa;
  }

  setLevel(level) {
    if (level === this.level) return;
    this.level = level;
    this.rebuild();
  }

  setFxaa(on) {
    if (on === this.fxaa) return;
    this.fxaa = on;
    this.rebuild();
  }

  rebuild() {
    const defines = {};
    if (this.enabled) defines.USE_BLOOM = '';
    if (this.level === 'medium') defines.USE_HALO = '';
    if (this.fxaa) defines.USE_FXAA = '';
    this.composite.defines = defines;
    this.composite.needsUpdate = true;
    this.dispose(); // render() allocates what the new setup needs
  }

  // Render scale 0.5..1 of the scene target (dynamic resolution). Takes effect on the next
  // render; nothing is reallocated.
  setScale(scale) {
    this.scale = Math.max(0.5, Math.min(1, scale));
  }

  setParams({ threshold, strength }) {
    this.threshold = threshold;
    this.strength = strength;
  }

  allocate() {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    this.pixelRatio = r.getPixelRatio();
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
    const msaa = !this.fxaa || r.getPixelRatio() < FXAA_ONLY_PIXEL_RATIO;
    this.targets = { scene: rt(w, h, { depthBuffer: true, samples: msaa ? Math.min(4, r.capabilities.maxSamples ?? 4) : 0 }) };
    if (!this.enabled) return;
    const div = this.level === 'medium' ? 2 : 4;
    this.targets.a = rt(w / div, h / div);
    this.targets.b = rt(w / div, h / div);
    if (this.level === 'medium') {
      this.targets.c = rt(w / 4, h / 4);
      this.targets.d = rt(w / 4, h / 4);
    }
  }

  // Call after the canvas size or pixel ratio changes.
  resize() {
    if (!this.active) return;
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.targets && s.equals(this.size) && this.pixelRatio === this.renderer.getPixelRatio()) return;
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
    if (!this.active) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    if (!this.targets) this.allocate();
    const T = this.targets;
    // The drawn part of the scene target (whole pixels), and the last texel centre inside it.
    const vw = Math.max(1, Math.round(T.scene.width * this.scale));
    const vh = Math.max(1, Math.round(T.scene.height * this.scale));
    T.scene.viewport.set(0, 0, vw, vh);
    this.uScale.value.set(vw / T.scene.width, vh / T.scene.height);
    this.uMax.value.set((vw - 0.5) / T.scene.width, (vh - 0.5) / T.scene.height);
    r.setRenderTarget(T.scene);
    r.render(scene, camera);

    const c = this.composite.uniforms;
    c.tScene.value = T.scene.texture;
    c.texel.value.set(1 / T.scene.width, 1 / T.scene.height);
    if (!this.enabled) {
      this.draw(this.composite, null);
      return;
    }
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

  // Everything, for good (the race that owns it is being thrown away).
  destroy() {
    this.dispose();
    this.quad.geometry.dispose();
    for (const m of [this.bright, this.blur, this.composite]) m.dispose();
  }
}

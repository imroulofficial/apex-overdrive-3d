import * as THREE from 'three';

// Driver view cabin (camera view 'cockpit'): one cockpit shared by every car. Built round the
// driver's eye (x forward, y up, z right, in metres from the eye), so it fits any car the eye
// is placed in (race/chaseCamera.js cockpitEye). The car's centre line is 0.36 m to the
// driver's right.
//
// Since versionCode 73 the cabin is a real model made in Blender (tools/cockpit/
// build_cockpit.py): sculpted dash and instrument hood, binnacle with chrome dial bezels, air
// vents, centre stack and console, door cards with handles, A-pillars, roof lining, mirror
// housings; a stitched leather 3-spoke wheel with a generic hex badge and carbon paddles;
// gloved hands wrapped round the rim and racing-suit sleeves. Its textures (colour, normal,
// roughness and metalness, with ambient occlusion and soft interior light baked in) come in
// three tiers (race/cockpitAsset.js): high, mid and low (low-end GPUs: low-detail mesh, the
// light baked into one unlit colour atlas). This file places the parts and drives them:
//
//   shell     the whole cabin in one mesh (cabin atlas)
//   trim      carbon accents tinted with the car's paint (setPaint): dash and door strips,
//             air-vent bezels, the rim's marker stripe and spoke inserts (two meshes)
//   wheel     the wheel, turning about its column with the steering; the hands on it turn
//             with it up to HAND_TURN, then the rim slides through their grip
//   forearms  two sleeves from the elbows to the gloves, re-aimed every frame
//   display   the instrument cluster in one draw: backlit speedometer and rev counter faces,
//             a digital speed readout, the gear and a row of shift lights (one 512x320 texture,
//             drawn once; the digits and lights change through uniforms only)
//   needles   speedometer and rev counter needles, glowing
//   mirrors   rear-view and both wing mirrors. Mid and high tiers see a live rear view: one
//             256x96 render, every 2nd frame, no post-processing, 120 m draw distance (the
//             only extra pass, and only while the cockpit shows). The low tier gets a sky
//             gradient instead, and no extra pass.
//   glass     a very faint sheen low on the windscreen (not on the low tier)
//
// Drawn on top: every cockpit material squeezes its depth into the front tenth of the depth
// range (DEPTH_FRONT), so a rival car that touches or overlaps the player's car can never
// show inside the cabin, at no cost (no extra pass, no depth clear). Everything stays in the
// lower quarter of the screen (dash ~72% down) or at its edges (pillars, mirrors), so the road
// ahead stays open. 12 draws (11 on the low tier), no shadows, no fog.

export const WHEEL_LOCK = 1.9; // radians the wheel turns at full steering lock
export const WHEEL_RATE = 14; // 1/s: how fast the drawn wheel follows the steering input
export const HAND_TURN = 0.5; // radians the hands turn with the wheel before it slides
export const SPEEDO_MAX = 320; // km/h at the end of the dial
export const RPM_MAX = 8000;
export const RPM_RED = 7600;
// Shift lights: they start to fill at SHIFT_FROM rpm, are all lit at RPM_RED and flash on the
// limiter (SHIFT_FLASH and up).
export const SHIFT_LIGHTS = 10;
export const SHIFT_FROM = 4800;
export const SHIFT_FLASH = 7500;
// Glyphs in the cluster texture's digit strip: 0-9, then N, R and a blank.
export const GLYPH = { N: 10, R: 11, BLANK: 12 };
// The live mirror's render target and how often it renders (every Nth frame).
export const MIRROR = { width: 256, height: 96, every: 2, far: 120, fov: 22 };
const GLYPHS = '0123456789NR ';
const SWEEP = (240 * Math.PI) / 180; // dial sweep, needle from lower-left to lower-right

// Needle angle (radians, clockwise from straight up as the driver sees it) for 0..1 of a dial.
export const needleAngle = (k) => -SWEEP / 2 + SWEEP * Math.min(1.04, Math.max(0, k));

// Shift lights lit (0..SHIFT_LIGHTS, fractional) at an rpm.
export const shiftLit = (rpm) => SHIFT_LIGHTS * Math.min(1, Math.max(0, (rpm - SHIFT_FROM) / (RPM_RED - SHIFT_FROM)));

// Gear glyph for the cluster: N on the grid, R reversing, else 1-6 (the gearbox counts from 0).
export const gearGlyph = (gear, neutral = false, reversing = false) => (neutral ? GLYPH.N : reversing ? GLYPH.R : Math.min(9, gear + 1));

// Vertex shader line that pulls a cockpit vertex into the front tenth of the depth range,
// keeping the cabin's own depth order. It is linear in clip space (every vertex's distance to
// the near plane shrinks by the same factor), so triangles that reach behind the camera (the
// door panels) are still clipped exactly where they were.
export const DEPTH_FRONT = 'gl_Position.z = mix(-gl_Position.w, gl_Position.z, 0.1);';
export function inFront(material) {
  material.onBeforeCompile = drawOnTop;
  material.fog = false;
  return material;
}
export function drawOnTop(shader) {
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${DEPTH_FRONT}`);
}

// Cluster layout in face pixels (the face is 512 x 256 of the texture, 0.34 m x 0.17 m).
const FACE_W = 0.34;
const FACE_H = 0.17;
const DIAL_R = 92;
const DIAL_L = 104;
const DIAL_R_X = 408;
const DIAL_Y = 150;
const GLYPH_W = 39;
const STRIP_Y = 256; // digit strip below the face, 64 px tall
// The digital panel (gear over speed) sits high, above the wheel rim; the dials below show
// through the wheel's opening and over its rim.
const DIGITS = [
  { x: 256, y: 56, w: 36, h: 54 }, // gear
  { x: 234, y: 104, w: 20, h: 30 }, // speed: hundreds, tens, units
  { x: 256, y: 104, w: 20, h: 30 },
  { x: 278, y: 104, w: 20, h: 30 },
];
const LED = { x0: 139, pitch: 26, y: 15, size: 16 };

// Speedometer and rev counter faces (backlit markings), the digital panel between them and the
// digit strip, drawn once.
export function clusterTexture(lowEnd) {
  const s = lowEnd ? 0.5 : 1;
  const W = 512 * s;
  const H = 320 * s;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.scale?.(s, s);
  g.fillStyle = '#050608';
  g.fillRect(0, 0, 512, 320);
  const glow = (color, blur) => {
    g.shadowColor = color;
    g.shadowBlur = blur * s;
  };
  // step: labelled divisions; ticks: minor ticks per division.
  const dial = (cx, max, step, ticks, label, red, unit) => {
    const cy = DIAL_Y;
    const r = DIAL_R;
    const rg = g.createRadialGradient?.(cx, cy, r * 0.2, cx, cy, r);
    if (rg) {
      rg.addColorStop(0, '#11141b');
      rg.addColorStop(1, '#07080b');
      g.fillStyle = rg;
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    glow('rgba(0,0,0,0)', 0);
    g.lineWidth = 4;
    g.strokeStyle = '#8d96a6';
    g.stroke();
    // Canvas angles: 0 = right, clockwise; the needle's 0 is straight up.
    const at = (k) => needleAngle(k) - Math.PI / 2;
    if (red != null) {
      glow('#ff2a2a', 8);
      g.strokeStyle = '#ff3030';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(cx, cy, r - 10, at(red / max), at(1));
      g.stroke();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 800 19px system-ui, sans-serif';
    glow('rgba(140,200,255,0.9)', 6);
    for (let v = 0; v <= max + 1e-6; v += step / ticks) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const a = at(v / max);
      const r0 = r - (major ? 20 : 12);
      g.strokeStyle = major ? '#f2f7ff' : 'rgba(220,235,255,0.6)';
      g.lineWidth = major ? 3.5 : 1.8;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5));
      g.stroke();
      if (major) {
        g.fillStyle = '#e8f1ff';
        const rt = r - 34;
        g.fillText(String(Math.round(label(v))), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt);
      }
    }
    glow('rgba(0,0,0,0)', 0);
    g.font = '700 11px system-ui, sans-serif';
    g.fillStyle = 'rgba(190,210,235,0.75)';
    g.fillText(unit, cx, cy + 46);
    // Hub cap the needle turns on.
    g.fillStyle = '#2a2f38';
    g.beginPath();
    g.arc(cx, cy, 9, 0, Math.PI * 2);
    g.fill();
  };
  dial(DIAL_L, SPEEDO_MAX, 40, 4, (v) => v, null, 'KM/H');
  dial(DIAL_R_X, RPM_MAX, 1000, 4, (v) => v / 1000, RPM_RED, 'x1000 RPM');
  // Digital panel between the dials: gear on top, speed below.
  g.fillStyle = '#000000';
  g.strokeStyle = 'rgba(120,190,255,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect ? g.roundRect(212, 26, 88, 100, 10) : g.rect(212, 26, 88, 100);
  g.fill();
  g.stroke();
  g.font = '700 9px system-ui, sans-serif';
  g.fillStyle = 'rgba(160,200,240,0.7)';
  g.textAlign = 'center';
  g.fillText('KM/H', 256, 122);
  // Shift-light bezel.
  g.fillStyle = '#0b0d11';
  g.fillRect(LED.x0 - 14, 0, LED.pitch * (SHIFT_LIGHTS - 1) + 28, 25);
  // Digit strip: white glyphs on black, one GLYPH_W cell each.
  g.fillStyle = '#000000';
  g.fillRect(0, STRIP_Y, 512, 64);
  g.font = 'italic 900 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  for (let i = 0; i < GLYPHS.length; i++) g.fillText(GLYPHS[i], i * GLYPH_W + GLYPH_W / 2, STRIP_Y + 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  tex.generateMipmaps = !lowEnd;
  if (lowEnd) tex.minFilter = THREE.LinearFilter;
  return tex;
}

// The whole cluster in one mesh: the face quad, four digit quads and the shift lights. `slot`
// picks what each vertex is: -1 face, 0-3 a digit (gear, then speed), 10+ a shift light.
function buildDisplay() {
  const pos = [];
  const uv = [];
  const cell = [];
  const slot = [];
  const k = FACE_W / 512;
  const quad = (cx, cy, w, h, sl, u0, v0, u1, v1) => {
    const z0 = (cx - w / 2 - 256) * k;
    const z1 = (cx + w / 2 - 256) * k;
    const y0 = (128 - (cy + h / 2)) * k;
    const y1 = (128 - (cy - h / 2)) * k;
    const x = sl < 0 ? 0 : -0.0015; // digits and lights just in front of the face
    const corners = [
      [z0, y0, u0, v0, 0, 0],
      [z1, y0, u1, v0, 1, 0],
      [z1, y1, u1, v1, 1, 1],
      [z0, y0, u0, v0, 0, 0],
      [z1, y1, u1, v1, 1, 1],
      [z0, y1, u0, v1, 0, 1],
    ];
    for (const [z, y, u, v, cu, cv] of corners) {
      pos.push(x, y, z);
      uv.push(u, v);
      cell.push(cu, cv);
      slot.push(sl);
    }
  };
  // Face: the top 256 rows of the texture (uv v runs bottom-up: 1 - 256/320 .. 1).
  quad(256, 128, 512, 256, -1, 0, 1 - 256 / 320, 1, 1);
  DIGITS.forEach((d, i) => quad(d.x, d.y, d.w, d.h, i, 0, 0, 0, 0));
  for (let i = 0; i < SHIFT_LIGHTS; i++) quad(LED.x0 + i * LED.pitch, LED.y, LED.size, LED.size, 10 + i, 0, 0, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('cell', new THREE.Float32BufferAttribute(cell, 2));
  g.setAttribute('slot', new THREE.Float32BufferAttribute(slot, 1));
  return g;
}

export function displayMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      digits: { value: [GLYPH.N, GLYPH.BLANK, GLYPH.BLANK, 0] },
      lit: { value: 0 },
      flash: { value: 0 },
      glow: { value: 0 },
    },
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec2 cell;
      attribute float slot;
      uniform float digits[4];
      uniform float lit, flash;
      varying vec2 vUv, vCell;
      varying vec3 vTint;
      varying float vKind;
      void main() {
        vUv = uv;
        vCell = cell;
        vTint = vec3(1.0);
        vKind = 0.0;
        if (slot >= 0.0 && slot < 4.0) {
          // A digit: its glyph's cell in the strip under the face.
          float gl = slot < 0.5 ? digits[0] : slot < 1.5 ? digits[1] : slot < 2.5 ? digits[2] : digits[3];
          vUv = vec2((gl + cell.x) * ${(GLYPH_W / 512).toFixed(6)}, mix(0.0, ${(64 / 320).toFixed(6)}, cell.y));
          vTint = slot < 0.5 ? vec3(1.0, 0.78, 0.42) : vec3(0.72, 0.93, 1.0);
          vKind = 1.0;
        } else if (slot >= 10.0) {
          float i = slot - 10.0;
          vTint = i < 4.0 ? vec3(0.2, 1.0, 0.35) : i < 7.0 ? vec3(1.0, 0.75, 0.1) : vec3(1.0, 0.15, 0.12);
          // On the limiter every light flashes blue.
          if (flash > 0.5) vTint = vec3(0.25, 0.55, 1.0);
          else if (i >= lit) vTint *= 0.1;
          vKind = 2.0;
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${DEPTH_FRONT}
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float glow;
      varying vec2 vUv, vCell;
      varying vec3 vTint;
      varying float vKind;
      void main() {
        vec3 c;
        float back = 0.9 + glow * 0.9; // backlight: brighter at night and in tunnels (blooms)
        if (vKind > 1.5) {
          float d = length(vCell - 0.5) * 2.0;
          c = mix(vec3(0.02), vTint * (1.2 + glow), smoothstep(1.0, 0.6, d));
        } else {
          c = texture2D(map, vUv).rgb * back;
          if (vKind > 0.5) c *= vTint * 1.15;
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Windscreen sheen: transparent, brightest along the bottom of the glass, gone by halfway up.
function buildGlass() {
  const g = new THREE.BufferGeometry();
  const a = [1.135, -0.31];
  const b = [0.54, 0.34];
  const zl = [-0.69, -0.72];
  const zr = [1.35, 1.38];
  const pos = [];
  const col = [];
  const rows = [0, 0.25, 0.55];
  const alpha = [0.11, 0.04, 0];
  for (let r = 0; r < rows.length; r++) {
    const t = rows[r];
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    pos.push(x, y, zl[0] + (zl[1] - zl[0]) * t, x, y, zr[0] + (zr[1] - zr[0]) * t);
    col.push(0.85, 0.9, 1, alpha[r], 0.85, 0.9, 1, alpha[r]);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5]);
  return g;
}
// The baked shading (the ORM texture's red channel: ambient occlusion times the soft light that
// reaches each spot through the glass) also dims the sun and lamps there, not only the ambient
// light as three.js does with an aoMap, so the footwell and the hood's underside stay dark.
const BAKED_SHADE = `#include <aomap_fragment>
#ifdef USE_AOMAP
  reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.8);
  reflectedLight.directSpecular *= ambientOcclusion;
#endif`;
export function drawOnTopShaded(shader) {
  drawOnTop(shader);
  if (shader.fragmentShader) shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', BAKED_SHADE);
}

// Runtime material for an atlas part, from the material the file brought (its textures).
//   high: physically based (normal and ORM maps), the race's environment reflected
//   mid:  Lambert with the same colour, normal and baked-shading maps (no roughness or
//         reflections): about a third cheaper per pixel, and the cabin covers a third of the
//         screen
//   low:  unlit, the colour atlas has the light baked in
// Front faces only: every surface of the model faces the driver or outward.
function atlasMaterial(src, tier) {
  if (tier === 'low' || !src?.isMeshStandardMaterial) {
    return inFront(new THREE.MeshBasicMaterial({ map: src?.map ?? null, color: src?.map ? 0xffffff : 0x26282d }));
  }
  const shared = {
    map: src.map,
    normalMap: src.normalMap,
    normalScale: src.normalScale.clone(),
    aoMap: src.aoMap,
    // A faint self-light keeps the cabin's shapes readable at night and in tunnels.
    emissive: 0x08090b,
  };
  const m =
    tier === 'high'
      ? new THREE.MeshStandardMaterial({ ...shared, roughnessMap: src.roughnessMap, metalnessMap: src.metalnessMap, roughness: 1, metalness: 1, envMapIntensity: 0.6 })
      : new THREE.MeshLambertMaterial(shared);
  m.onBeforeCompile = drawOnTopShaded;
  m.fog = false;
  return m;
}

// Tinted carbon trim: the paint colour times a tiling carbon weave (none on the low tier).
function trimMaterial(src, tier) {
  if (tier === 'low' || !src?.map) return inFront(new THREE.MeshBasicMaterial({ color: 0x888888 }));
  if (tier === 'mid') return inFront(new THREE.MeshLambertMaterial({ color: 0x888888, map: src.map, normalMap: src.normalMap ?? null, normalScale: src.normalScale?.clone() }));
  return inFront(
    new THREE.MeshStandardMaterial({
      color: 0x888888,
      map: src.map,
      normalMap: src.normalMap ?? null,
      normalScale: src.normalScale?.clone(),
      metalness: 0.45,
      roughness: 0.34,
      envMapIntensity: 0.8,
    })
  );
}

// A part of the model as a mesh of our own: its geometry (shared, from the file), our
// material, and the node's transform (meshopt quantisation keeps positions as integers with
// a scale and offset on the node). Parents move it; the mesh itself is never turned.
function partMesh(asset, name, material, parent, label = name) {
  const src = asset?.parts[name];
  if (!src) return null;
  const m = new THREE.Mesh(src.geometry, material);
  m.name = label;
  m.position.copy(src.position);
  m.quaternion.copy(src.quaternion);
  m.scale.copy(src.scale);
  parent.add(m);
  return m;
}

// Low tier mirrors: a sky gradient (light at the top of each glass, road grey at the bottom)
// instead of the live rear view; from each glass's uv.y, which runs bottom to top.
export function skyGradient(geometry) {
  const g = geometry.clone();
  const uv = g.attributes.uv;
  const col = new Float32Array(uv.count * 3);
  const top = new THREE.Color(0xa9bfd3);
  const low = new THREE.Color(0x4b545e);
  for (let i = 0; i < uv.count; i++) {
    _c.copy(low).lerp(top, Math.min(1, Math.max(0, uv.getY(i))));
    col.set([_c.r, _c.g, _c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// A plain needle if the model is missing.
const fallbackNeedle = () => new THREE.BoxGeometry(0.0028, 0.062, 0.004).translate(0, 0.022, 0);

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Where each forearm meets its glove's gauntlet, in the wheel's frame (the model is built
// round the same points: tools/cockpit/build_cockpit.py hand_wrist).
const RIM_R = 0.165;
const GRIP_Y = 0.07; // hands at ten to two
const WRIST = [-1, 1].map((side) => v3(-0.12, GRIP_Y - 0.05, side * (Math.sqrt(RIM_R * RIM_R - GRIP_Y * GRIP_Y) + 0.042)));
// Placement of the moving parts in the cabin (same numbers in build_cockpit.py).
export const RIG = {
  wheelPivot: [0.56, -0.44, 0],
  wheelTilt: -0.35,
  cluster: [0.785, -0.32, 0],
  clusterTilt: -0.42,
  elbows: [
    [0.16, -0.64, -0.44],
    [0.16, -0.64, 0.44],
  ],
};

export class Cockpit {
  //   tier   'high' | 'mid' | 'low' (race/cockpitAsset.js cockpitTier); lowEnd alone means low
  //   asset  the loaded model (loadCockpitAsset); without it only the instruments show
  constructor({ lowEnd = false, tier = lowEnd ? 'low' : 'mid', asset = null } = {}) {
    this.tier = tier;
    this.lowEnd = tier === 'low';
    this.liveMirror = !this.lowEnd;
    this.asset = asset;
    const low = this.lowEnd;
    const group = (this.group = new THREE.Group());
    group.name = 'cockpit';
    group.rotation.order = 'YZX';
    group.visible = false;
    group.userData.noCull = true;

    this.textures = [];
    const parts = asset?.parts ?? {};
    const cabin = atlasMaterial(parts.cockpit_shell?.material, tier);
    const wheelMat = atlasMaterial(parts.cockpit_wheel?.material, tier);
    this.trimMaterial = trimMaterial(parts.cockpit_trim?.material, tier);
    partMesh(asset, 'cockpit_shell', cabin, group, 'cockpit-shell');
    partMesh(asset, 'cockpit_trim', this.trimMaterial, group, 'cockpit-trim');

    // Steering wheel: tilted back like a real column, turning about its own axis.
    this.wheelPivot = new THREE.Group();
    this.wheelPivot.position.fromArray(RIG.wheelPivot);
    this.wheelPivot.rotation.z = RIG.wheelTilt;
    this.wheel = new THREE.Group();
    this.wheel.name = 'cockpit-wheel';
    partMesh(asset, 'cockpit_wheel', wheelMat, this.wheel, 'cockpit-wheel-grip');
    partMesh(asset, 'cockpit_wheel_trim', this.trimMaterial, this.wheel, 'cockpit-wheel-trim');
    this.wheelPivot.add(this.wheel);
    // The hands turn with the rim up to HAND_TURN, then let it slide through their grip (so
    // an arm never swings across the instruments at full lock).
    this.hands = new THREE.Group();
    this.hands.name = 'cockpit-hands';
    partMesh(asset, 'cockpit_hands', wheelMat, this.hands, 'cockpit-hands');
    this.wheelPivot.add(this.hands);
    group.add(this.wheelPivot);
    // Forearms: unit-length sleeves from fixed elbows, stretched to the cuffs on the wheel.
    this.elbows = RIG.elbows.map((e) => v3(...e));
    this.forearms = this.elbows.map((e, i) => {
      const arm = new THREE.Group();
      arm.name = `cockpit-forearm-${i ? 'right' : 'left'}`;
      arm.position.copy(e);
      partMesh(asset, i ? 'cockpit_forearm_r' : 'cockpit_forearm_l', wheelMat, arm, arm.name);
      group.add(arm);
      return arm;
    });

    // Instrument cluster: the face turned toward the eye under the hood, needles in front.
    const cluster = new THREE.Group();
    cluster.position.fromArray(RIG.cluster);
    cluster.rotation.z = RIG.clusterTilt;
    this.display = new THREE.Mesh(buildDisplay(), displayMaterial(this.keep(clusterTexture(low))));
    this.display.name = 'cockpit-display';
    cluster.add(this.display);
    this.displayUniforms = this.display.material.uniforms;
    this.needleMaterial = inFront(new THREE.MeshBasicMaterial({ color: 0xff4a1a, toneMapped: false }));
    const k = FACE_W / 512;
    const needle = (px) => {
      const pivot = new THREE.Group();
      pivot.position.set(-0.004, (128 - DIAL_Y) * k, (px - 256) * k);
      if (!partMesh(asset, 'cockpit_needle', this.needleMaterial, pivot, 'cockpit-needle')) {
        const m = new THREE.Mesh(fallbackNeedle(), this.needleMaterial);
        m.name = 'cockpit-needle';
        pivot.add(m);
      }
      cluster.add(pivot);
      return pivot;
    };
    this.speedNeedle = needle(DIAL_L);
    this.rpmNeedle = needle(DIAL_R_X);
    group.add(cluster);

    // Mirrors.
    if (this.liveMirror) {
      this.mirrorTarget = new THREE.WebGLRenderTarget(MIRROR.width, MIRROR.height, { depthBuffer: true, samples: 0 });
      this.mirrorTarget.texture.name = 'cockpit-mirror';
      this.mirrorCamera = new THREE.PerspectiveCamera(MIRROR.fov, MIRROR.width / MIRROR.height, 0.5, MIRROR.far);
      this.mirrorCamera.layers.set(0); // the world, never the cabin
      this.mirrorFrame = 0;
    }
    const glassMat = inFront(this.liveMirror ? new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture }) : new THREE.MeshBasicMaterial({ vertexColors: true }));
    const mirrors = partMesh(asset, 'cockpit_mirror_glass', glassMat, group, 'cockpit-mirrors');
    if (mirrors && !this.liveMirror) mirrors.geometry = skyGradient(mirrors.geometry);
    if (!low) {
      const sheen = inFront(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      const glass = new THREE.Mesh(buildGlass(), sheen);
      glass.name = 'cockpit-glass';
      glass.renderOrder = 1;
      group.add(glass);
    }

    group.traverse((o) => {
      o.frustumCulled = false; // always in front of the eye; no bounds to test
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.isMesh && o.renderOrder === 0) o.renderOrder = -1; // opaque cabin first (less fill)
      o.layers.set(1); // the race camera sees layer 1 too; mirrors and reflection bakes do not
    });
    this.steer = 0;
    this.wheelAngle = 0;
    this.kmh = 0;
    this.rpm = 0;
    this.gear = GLYPH.N;
    this.lit = 0;
    this.glow = 0;
    this.time = 0;
    this.setPaint(0x8a8f99);
  }

  keep(tex) {
    this.textures.push(tex);
    return tex;
  }

  // Meshes and triangles drawn while the cockpit shows (tests, tools).
  stats() {
    let draws = 0;
    let triangles = 0;
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      draws++;
      const g = o.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return { draws, triangles };
  }

  setVisible(on) {
    this.group.visible = on;
  }

  // Trim accents take the car's paint, a little toned down so dark and loud paints both work.
  setPaint(color) {
    this.trimMaterial.color.set(color).lerp(_c.set(0x8a8f99), 0.4);
    if (this.lowEnd) this.trimMaterial.color.multiplyScalar(0.5); // unlit: keep it from glaring
  }

  // Places the cabin at the driver's eye (from the camera rig, `chase.carPoint` + `eye`), turns
  // the wheel, hands and needles, and sets the digital readout and shift lights.
  //   steer -1..1, kmh road speed, rpm from the gearbox, gear a cluster glyph (gearGlyph),
  //   glow 0..1 backlight boost (night, tunnels)
  update(car, chase, dt, steer, kmh, rpm, gear = GLYPH.N, glow = 0) {
    const g = this.group;
    const e = chase.eye;
    chase.carPoint(car, e.x, e.y, e.z, g.position);
    g.rotation.set(0, car.heading, car.pitch);
    this.time += dt;
    this.wheelAngle += (steer * WHEEL_LOCK - this.wheelAngle) * Math.min(1, dt * WHEEL_RATE);
    this.wheel.rotation.x = this.wheelAngle;
    this.hands.rotation.x = Math.max(-HAND_TURN, Math.min(HAND_TURN, this.wheelAngle));
    this.aimForearms();
    this.kmh = kmh;
    this.rpm = rpm;
    this.speedNeedle.rotation.x = needleAngle(kmh / SPEEDO_MAX);
    this.rpmNeedle.rotation.x = needleAngle(rpm / RPM_MAX);
    // Digital readout: speed without leading zeros, then the gear.
    const u = this.displayUniforms;
    const v = Math.min(999, Math.max(0, Math.round(kmh)));
    const d = u.digits.value;
    d[0] = gear;
    d[1] = v >= 100 ? Math.floor(v / 100) : GLYPH.BLANK;
    d[2] = v >= 10 ? Math.floor(v / 10) % 10 : GLYPH.BLANK;
    d[3] = v % 10;
    this.gear = gear;
    this.lit = shiftLit(rpm);
    u.lit.value = this.lit;
    u.flash.value = rpm >= SHIFT_FLASH && Math.sin(this.time * 50) > 0 ? 1 : 0;
    this.glow += (glow - this.glow) * Math.min(1, dt * 3);
    u.glow.value = this.glow;
    this.needleMaterial.color.setRGB(1, 0.3, 0.1).multiplyScalar(1.2 + this.glow * 1.6);
  }

  // Each forearm from its elbow to its cuff on the turned wheel.
  aimForearms() {
    this.wheelPivot.updateMatrix();
    this.hands.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const wrist = _a.copy(WRIST[i]).applyMatrix4(this.hands.matrix).applyMatrix4(this.wheelPivot.matrix);
      const arm = this.forearms[i];
      const dir = _b.subVectors(wrist, this.elbows[i]);
      const len = dir.length();
      arm.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
      arm.scale.set(1, len, 1);
    }
  }

  // The live rear view (mid and high tiers, cockpit showing): one low-resolution render of the
  // world behind the car every MIRROR.every frames, no post-processing, a short draw
  // distance, reusing the sun's shadow map. `force` renders now (the warm-up).
  renderMirror(renderer, scene, force = false) {
    if (!this.liveMirror || (!force && !this.group.visible)) return false;
    if (!force && this.mirrorFrame++ % MIRROR.every !== 0) return false;
    const cam = this.mirrorCamera;
    const g = this.group;
    g.updateMatrixWorld();
    // From the rear-view mirror, looking back down the car (a little down, to see the road).
    cam.position.set(0.3, 0.12, 0.33).applyMatrix4(g.matrixWorld);
    _p.set(-20, -1.6, 0.33).applyMatrix4(g.matrixWorld);
    cam.lookAt(_p);
    cam.updateMatrixWorld();
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.mirrorTarget);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    renderer.shadowMap.autoUpdate = shadows;
    return true;
  }

  dispose() {
    this.mirrorTarget?.dispose();
  }
}

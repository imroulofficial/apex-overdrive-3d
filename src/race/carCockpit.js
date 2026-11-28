import * as THREE from 'three';
import {
  DEPTH_FRONT,
  GLYPH,
  HAND_TURN,
  MIRROR,
  RPM_RED,
  SHIFT_FLASH,
  SHIFT_LIGHTS,
  WHEEL_LOCK,
  WHEEL_RATE,
  clusterTexture,
  displayMaterial,
  drawOnTop,
  drawOnTopShaded,
  inFront,
  shiftLit,
  skyGradient,
} from './cockpit.js';
import { frontDraw, windowPose } from './raceCars.js';

// The car's own driver-view cabin (versionCode 75): `<car>_cockpit.glb`, built with the car in
// Blender (dash, binnacle, seats, door cards, pillars, its own steering wheel with the gloved
// hands, clear glass and door windows, mirror glass), in the car's own frame. The player's car
// stays visible round it, so the bonnet, wings and mirrors seen through the glass are its own;
// the car hides only its interior, driver, glass, windows and steering wheel
// (extras.apex.hideInCockpit, CarVisual.setCabinShown). The cabin follows the car's physics
// frame (heading and pitch), like the driver's eye.
//
// Same interface and behaviour as the shared cabin (race/cockpit.js), which stays as the
// fallback for a car without a cockpit file:
//   - the steering wheel turns about its column with the steering; the hands turn with it up to
//     HAND_TURN, then the rim slides through their grip
//   - the dials (material Gauges, one atlas cell per dial: extras.apex.gauges) get live needles
//     drawn in their own shader: speed, revs (or kW), and the small dials at rest
//   - a gear and speed readout and a row of shift lights between the two big dials
//   - the gauges glow brighter at night and in tunnels
//   - every MirrorGlass surface shows the live rear view (mid and high tiers, and a low-end GPU
//     on a manually chosen High) or a sky gradient (low tier), as the shared cabin's mirrors
//   - drawn on top (DEPTH_FRONT): a rival that touches the car never shows inside the cabin
//   - door windows (extras.apex.windows) slide down and up (setWindows)

// Share of the cabin's baked night light shown by day (glow 0); all of it at glow 1.
const CABIN_DAY_GLOW = 0.3;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

// Dial kinds from the labels on the faces (extras.apex.gauges[i].label).
export function dialKind(label = '') {
  if (/km\/h|mph/i.test(label)) return 'speed';
  if (/rpm|kw/i.test(label)) return 'rpm';
  return 'aux';
}

// Needle position 0..1 (of the face's sweep) for one dial: speed on its own scale (km/h or
// mph), the rev counter (or an EV's power meter) with the redline near the end of every face,
// the small dials at their rest value.
export function dialValue(g, kmh, rpm) {
  const kind = dialKind(g.label);
  if (kind === 'speed') return Math.min(1.02, (/mph/i.test(g.label) ? kmh / 1.609 : kmh) / g.max);
  if (kind === 'rpm') return Math.min(1.02, (rpm / RPM_RED) * 0.92);
  return g.rest ?? 0.5;
}

// The Gauges material with live needles: per fragment, the dial cell of the atlas it is in
// (2 x 2 cells), and a needle from the cell's centre at that dial's angle. The face's own sweep
// starts at `fromDeg` (image angle, counter-clockwise from +x, y up) and runs clockwise.
function gaugeMaterial(src, tier, uniforms) {
  const params = { map: src.map, emissive: src.emissive?.clone() ?? new THREE.Color(0xffdcaa), emissiveMap: src.emissiveMap ?? src.map };
  // Low tier: unlit (the dials are lit faces anyway), like the rest of the light cabin.
  const m =
    tier === 'high'
      ? new THREE.MeshStandardMaterial({ ...params, roughness: src.roughness ?? 0.35, metalness: 0 })
      : tier === 'low'
        ? new THREE.MeshBasicMaterial({ map: src.map })
        : new THREE.MeshLambertMaterial(params);
  const unlit = tier === 'low';
  m.name = 'Gauges';
  m.fog = false;
  m.onBeforeCompile = (shader) => {
    drawOnTop(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 uNeedle;
uniform vec4 uFrom;
uniform float uRadius;
uniform float uGlow;
float gNeedle = 0.0;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
{
  vec2 cell = floor(clamp(vMapUv, 0.0, 0.999) * 2.0);
  float i = cell.x + cell.y * 2.0;
  float k = i < 0.5 ? uNeedle.x : i < 1.5 ? uNeedle.y : i < 2.5 ? uNeedle.z : uNeedle.w;
  float from = i < 0.5 ? uFrom.x : i < 1.5 ? uFrom.y : i < 2.5 ? uFrom.z : uFrom.w;
  vec2 d = (vMapUv - (cell + 0.5) * 0.5) / uRadius;
  float a = radians(from - 270.0 * k);
  vec2 dir = vec2(cos(a), -sin(a)); // uv v runs down the image
  float along = dot(d, dir);
  float across = abs(d.x * dir.y - d.y * dir.x);
  float w = mix(0.035, 0.012, clamp(along, 0.0, 1.0));
  gNeedle = step(-0.14, along) * step(along, 0.84) * (1.0 - smoothstep(w * 0.6, w, across));
  float cap = 1.0 - smoothstep(0.085, 0.1, length(d));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.32, 0.08), gNeedle);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.1, 0.11), cap);
  gNeedle *= 1.0 - cap;
}
#endif`
      )
      .replace(
        unlit ? '#include <opaque_fragment>' : '#include <emissivemap_fragment>',
        unlit
          ? `outgoingLight *= 0.75 + uGlow * 0.9;
outgoingLight = mix(outgoingLight, vec3(1.0, 0.35, 0.1) * (1.4 + uGlow * 1.6), gNeedle);
#include <opaque_fragment>`
          : 
        `#include <emissivemap_fragment>
totalEmissiveRadiance *= 0.75 + uGlow * 0.9;
totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(1.0, 0.35, 0.1) * (1.4 + uGlow * 1.6), gNeedle);`
      );
  };
  m.customProgramCacheKey = () => `car-gauges-${tier}`;
  return m;
}

// The cabin's own materials for a tier: high keeps the file's physically based materials, mid
// and low turn the opaque ones into Lambert (about a third cheaper per pixel). Glass keeps its
// alpha. All draw on top.
function cabinMaterial(src, tier) {
  if (src.transparent && tier === 'low') {
    // Clear glass over the whole windscreen: unlit on the low tier.
    const m = new THREE.MeshBasicMaterial({ name: src.name, color: src.color.clone(), opacity: src.opacity, transparent: true, depthWrite: false, side: src.side });
    m.onBeforeCompile = drawOnTop;
    m.fog = false;
    return m;
  }
  if (src.transparent) {
    const m = src.clone();
    m.depthWrite = false;
    m.onBeforeCompile = drawOnTop;
    m.fog = false;
    return m;
  }
  let m;
  if (tier === 'low' && src.isMeshStandardMaterial) return unlitCabin(src);
  if (tier === 'high' || !src.isMeshStandardMaterial) {
    m = src.clone();
    // Inside a roofed cabin the sky reflects far less than on the open body (as the shared cabin).
    if (m.isMeshStandardMaterial) m.envMapIntensity = Math.min(m.envMapIntensity ?? 1, 0.6);
    m.onBeforeCompile = drawOnTopShaded;
  } else {
    m = new THREE.MeshLambertMaterial({
      name: src.name,
      color: src.color.clone(),
      map: src.map,
      normalMap: src.normalMap,
      normalScale: src.normalScale?.clone(),
      aoMap: src.aoMap,
      emissive: src.emissive.clone(),
      emissiveMap: src.emissiveMap,
      emissiveIntensity: src.emissiveIntensity,
      side: src.side,
    });
    m.onBeforeCompile = drawOnTopShaded;
  }
  m.fog = false;
  return m;
}

function setGlow(m, v) {
  if (m.userData.glowI) m.userData.glowI.value = v;
  else m.emissiveIntensity = v;
}

// Low tier (the phones that had ANRs): the cabin unlit, as v74's low cabin. Its colour atlas has
// the baked shading in it (tools/cars/lowLods.mjs). It dims at night and in tunnels (uShade) and
// its baked night light (the emissive map) adds on top (uGlowI), like the lit tiers' emissive.
function unlitCabin(src) {
  const m = new THREE.MeshBasicMaterial({ name: src.name, color: src.color.clone(), map: src.map, side: src.side });
  const em = src.emissiveMap && src.map ? src.emissiveMap : null;
  m.userData.shade = { value: 1.4 };
  m.userData.glowI = { value: src.emissiveIntensity ?? 1 };
  m.userData.glows = !!em; // a glow material (CarCockpit.glowMaterials); not `emissive`, which the renderer would read
  m.onBeforeCompile = (shader) => {
    drawOnTop(shader);
    shader.uniforms.uShade = m.userData.shade;
    shader.uniforms.uGlowI = m.userData.glowI;
    shader.uniforms.uGlowMap = { value: em };
    shader.uniforms.uGlowCol = { value: em ? src.emissive.clone() : new THREE.Color(0) };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uShade;\nuniform float uGlowI;\nuniform sampler2D uGlowMap;\nuniform vec3 uGlowCol;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        em ? 'outgoingLight = outgoingLight * uShade + texture2D(uGlowMap, vMapUv).rgb * uGlowCol * uGlowI;\n#include <opaque_fragment>' : 'outgoingLight *= uShade;\n#include <opaque_fragment>',
      );
  };
  m.customProgramCacheKey = () => `car-cabin-unlit-${!!em}`;
  m.fog = false;
  return m;
}

// Gear (big) over the speed (three digits) between the two big dials and a row of shift lights
// above them, in the shared cluster's shader (digits and lights by uniforms only). Built in a
// frame facing the driver: x toward the dash, y up, z right; sizes in metres.
function miniDisplay(gap, radius) {
  const pos = [];
  const uv = [];
  const cell = [];
  const slot = [];
  const quad = (cz, cy, w, h, sl) => {
    const z0 = cz - w / 2;
    const z1 = cz + w / 2;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    for (const [z, y, cu, cv] of [
      [z0, y0, 0, 0],
      [z1, y0, 1, 0],
      [z1, y1, 1, 1],
      [z0, y0, 0, 0],
      [z1, y1, 1, 1],
      [z0, y1, 0, 1],
    ]) {
      pos.push(0, y, z);
      uv.push(0, 0);
      cell.push(cu, cv);
      slot.push(sl);
    }
  };
  const h = Math.min(0.03, gap * 0.28);
  quad(0, h * 0.35, h * 0.66, h, 0);
  const dh = h * 0.52;
  for (let i = 0; i < 3; i++) quad((i - 1) * dh * 0.62, -h * 0.5, dh * 0.58, dh, 1 + i);
  const pitch = Math.min(0.014, (gap + radius) / (SHIFT_LIGHTS + 1));
  for (let i = 0; i < SHIFT_LIGHTS; i++) quad((i - (SHIFT_LIGHTS - 1) / 2) * pitch, radius + pitch * 0.9, pitch * 0.62, pitch * 0.62, 10 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('cell', new THREE.Float32BufferAttribute(cell, 2));
  g.setAttribute('slot', new THREE.Float32BufferAttribute(slot, 1));
  return g;
}

// Where each dial sits in the cabin (cabin frame): the centre, radius and facing of the vertices
// of a Gauges mesh in each atlas cell.
export function measureDials(meshes, root) {
  const acc = [0, 1, 2, 3].map(() => ({ c: new THREE.Vector3(), n: 0, pts: [] }));
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    if (!uv) continue;
    _m.multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue;
      const k = Math.min(1, Math.floor(u * 2)) + 2 * Math.min(1, Math.floor(v * 2));
      const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(_m);
      acc[k].c.add(p);
      acc[k].n++;
      acc[k].pts.push(p);
    }
  }
  return acc.map((a) => {
    if (!a.n) return null;
    const c = a.c.divideScalar(a.n);
    let r = 0;
    for (const p of a.pts) r = Math.max(r, p.distanceTo(c));
    return { centre: c, radius: r };
  });
}

export class CarCockpit {
  //   source   the parsed cockpit file's scene (cloned here; the cache keeps the original)
  //   meta     extras.apex of the car (eye, windows, gauges)
  //   modelMatrix  the car rig's model frame -> rig frame (modelLoader.js)
  //   tier     'high' | 'mid' | 'low' (race/cockpitAsset.js cockpitTier)
  constructor({ source, meta, modelMatrix, tier = 'mid' }) {
    this.tier = tier;
    this.lowEnd = tier === 'low';
    this.liveMirror = tier !== 'low';
    this.meta = meta ?? {};
    this.textures = [];
    // Placed like the shared cabin, at the car's physics frame (the same frame as the driver's
    // eye, so the head never drifts through the cabin with the body's suspension), then the
    // model's own frame.
    const group = (this.group = new THREE.Group());
    group.name = 'car-cockpit';
    group.rotation.order = 'YZX';
    group.visible = false;
    group.userData.noCull = true;
    const inner = new THREE.Group();
    inner.matrixAutoUpdate = false;
    inner.matrix.copy(modelMatrix ?? new THREE.Matrix4());
    group.add(inner);
    const root = source.clone(true);
    inner.add(root);
    group.updateMatrixWorld(true);

    // Materials (one per file material) and the parts that move.
    const mats = new Map();
    const gaugeMeshes = [];
    const mirrorMeshes = [];
    const gauges = this.meta.gauges ?? [];
    this.dials = gauges.map((g) => ({ ...g, kind: dialKind(g.label) }));
    this.gaugeUniforms = {
      uNeedle: { value: new THREE.Vector4(...[0, 1, 2, 3].map((i) => gauges[i]?.rest ?? 0.12)) },
      uFrom: { value: new THREE.Vector4(...[0, 1, 2, 3].map((i) => gauges[i]?.fromDeg ?? 225)) },
      uRadius: { value: gauges[0]?.radius ?? 236 / 512 },
      uGlow: { value: 0 },
    };
    // The live mirror (mid and high): one small render of the world behind the car every
    // MIRROR.every frames, shared by every MirrorGlass surface.
    if (this.liveMirror) {
      this.mirrorTarget = new THREE.WebGLRenderTarget(MIRROR.width, MIRROR.height, { depthBuffer: true, samples: 0 });
      this.mirrorTarget.texture.name = 'car-cockpit-mirror';
      this.mirrorCamera = new THREE.PerspectiveCamera(MIRROR.fov, MIRROR.width / MIRROR.height, 0.5, MIRROR.far);
      this.mirrorCamera.layers.set(0); // the world: never the cabin (layer 1) or the player's car (layer 2)
      this.mirrorFrame = 0;
    }
    const mirrorMat = inFront(this.liveMirror ? new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture }) : new THREE.MeshBasicMaterial({ vertexColors: true }));
    mirrorMat.name = 'MirrorGlass';
    root.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material?.name ?? '';
      if (name === 'MirrorGlass') {
        // Each glass has uv 0..1 (u along the car's z): the rear view flipped like a mirror.
        const g = o.geometry.clone();
        if (this.liveMirror) {
          const uv = g.attributes.uv;
          if (uv) {
            const flipped = new Float32Array(uv.count * 2);
            for (let i = 0; i < uv.count; i++) flipped.set([1 - uv.getX(i), 1 - uv.getY(i)], i * 2);
            g.setAttribute('uv', new THREE.BufferAttribute(flipped, 2));
          }
          o.geometry = g;
        } else {
          o.geometry = g.attributes.uv ? skyGradient(g) : g;
        }
        o.material = mirrorMat;
        mirrorMeshes.push(o);
        return;
      }
      if (!mats.has(o.material)) mats.set(o.material, name === 'Gauges' ? gaugeMaterial(o.material, tier, this.gaugeUniforms) : cabinMaterial(o.material, tier));
      o.material = mats.get(o.material);
      if (name === 'Gauges') gaugeMeshes.push(o);
    });
    // The car body's wing mirrors (MirrorGlass on the player's car) show the same rear view,
    // flipped in the shader (their geometry is shared with the car's other parts).
    this.bodyMirrorMaterial = null;
    if (this.liveMirror) {
      const m = (this.bodyMirrorMaterial = new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture, name: 'MirrorGlass' }));
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vec2(1.0) - vMapUv;\n#endif');
      };
      m.customProgramCacheKey = () => 'body-mirror';
      // On the body, drawn in front like the rest of the player's car (frontDraw).
      frontDraw(m);
    }
    // The cabin's baked night light (emissive map on the Cockpit material) is meant for the
    // dark: by day it only lifts the cabin a little, at night and in tunnels it is all there.
    this.glowMaterials = [...mats.values()].filter((m) => (m.userData.glows || m.emissive?.getHex() > 0) && m.name !== 'Gauges').map((m) => ({ m, full: m.userData.glowI?.value ?? m.emissiveIntensity }));
    for (const g of this.glowMaterials) setGlow(g.m, g.full * CABIN_DAY_GLOW);
    this.unlit = [...mats.values()].filter((m) => m.userData.shade);
    this.materials = [...mats.values(), mirrorMat, ...(this.bodyMirrorMaterial ? [this.bodyMirrorMaterial] : [])];
    this.mirrorMeshes = mirrorMeshes;

    // Steering wheel and hands: the hands get a pivot of their own at the wheel's transform.
    this.wheel = root.getObjectByName('steering_wheel') ?? null;
    this.hands = null;
    if (this.wheel) {
      this.wheelRest = this.wheel.quaternion.clone();
      const hands = this.wheel.getObjectByName('hands');
      if (hands) {
        this.hands = new THREE.Group();
        this.hands.name = 'hands-pivot';
        this.hands.position.copy(this.wheel.position);
        this.hands.quaternion.copy(this.wheel.quaternion);
        this.hands.scale.copy(this.wheel.scale);
        this.wheel.parent.add(this.hands);
        this.hands.updateMatrixWorld(true);
        this.hands.attach(hands);
      }
    }

    // Door windows: poses on top of each node's own transform.
    this.windowNodes = [];
    for (const [name, pose] of Object.entries(this.meta.windows ?? {})) {
      const node = pose?.open && root.getObjectByName(name);
      if (!node) continue;
      node.updateMatrix();
      node.matrixAutoUpdate = false;
      this.windowNodes.push({ node, pose, rest: node.matrix.clone() });
    }
    this.windowLevel = 0;

    // Gear, speed and shift lights between the two big dials, facing the driver.
    const spots = measureDials(gaugeMeshes, root);
    const big = this.dials.map((d, i) => ({ ...d, spot: spots[i] })).filter((d) => d.kind !== 'aux' && d.spot);
    if (big.length === 2) {
      const [l, r] = big.sort((a, b) => a.spot.centre.z - b.spot.centre.z);
      const mid = _a.addVectors(l.spot.centre, r.spot.centre).multiplyScalar(0.5);
      const gap = l.spot.centre.distanceTo(r.spot.centre) - l.spot.radius - r.spot.radius;
      const radius = Math.max(l.spot.radius, r.spot.radius);
      if (gap > 0.02) {
        this.displayMaterial = displayMaterial(this.keep(clusterTexture(this.lowEnd)));
        this.display = new THREE.Mesh(miniDisplay(gap, radius), this.displayMaterial);
        this.display.name = 'car-cockpit-display';
        // Facing the eye: local -x toward the driver.
        const eye = new THREE.Vector3().fromArray(this.meta.eye ?? [mid.x - 0.6, mid.y + 0.2, mid.z]);
        const ex = _b.subVectors(mid, eye).normalize();
        const ey = UP.clone().addScaledVector(ex, -UP.dot(ex)).normalize();
        const ez = new THREE.Vector3().crossVectors(ex, ey);
        this.display.quaternion.setFromRotationMatrix(_m.makeBasis(ex, ey, ez));
        this.display.position.copy(mid).addScaledVector(ex, -0.004);
        root.add(this.display);
      }
    }
    this.displayUniforms = this.displayMaterial?.uniforms ?? null;

    // The rear-view mirror camera sits at the middle mirror (closest to the car's centre line).
    this.mirrorAt = new THREE.Vector3(-0.2, 1.1, 0);
    if (mirrorMeshes.length) {
      let best = Infinity;
      for (const o of mirrorMeshes) {
        o.geometry.computeBoundingBox();
        o.geometry.boundingBox.getCenter(_a).applyMatrix4(_m.multiplyMatrices(new THREE.Matrix4().copy(root.matrixWorld).invert(), o.matrixWorld));
        if (Math.abs(_a.z) < best) {
          best = Math.abs(_a.z);
          this.mirrorAt.copy(_a);
        }
      }
    }

    group.traverse((o) => {
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.isMesh && !o.material.transparent && o.renderOrder === 0) o.renderOrder = -1;
      o.layers.set(1); // the race camera sees layer 1; the mirror and reflection bakes do not
    });
    this.steer = 0;
    this.wheelAngle = 0;
    this.kmh = 0;
    this.rpm = 0;
    this.gear = GLYPH.N;
    this.lit = 0;
    this.glow = 0;
    this.time = 0;
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
      if (!o.isMesh || !o.visible) return;
      draws++;
      const g = o.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return { draws, triangles };
  }

  setVisible(on) {
    this.group.visible = on;
  }

  // The car's own cabin keeps its neutral colours whatever the paint.
  setPaint() {}

  // Door windows 0 (closed) .. 1 (fully down).
  setWindows(k) {
    this.windowLevel = k;
    for (const w of this.windowNodes) w.node.matrix.multiplyMatrices(windowPose(w.pose, k, _m), w.rest);
  }

  // Same arguments as Cockpit.update. The cabin rides on the car body; this turns the wheel,
  // hands and needles and sets the readout, the shift lights and the glow.
  update(car, chase, dt, steer, kmh, rpm, gear = GLYPH.N, glow = 0) {
    chase.carPoint(car, 0, 0, 0, this.group.position);
    this.group.rotation.set(0, car.heading, car.pitch);
    this.time += dt;
    this.wheelAngle += (steer * WHEEL_LOCK - this.wheelAngle) * Math.min(1, dt * WHEEL_RATE);
    if (this.wheel) {
      this.wheel.quaternion.copy(this.wheelRest).multiply(_q.setFromAxisAngle(X, this.wheelAngle));
      if (this.hands) this.hands.quaternion.copy(this.wheelRest).multiply(_q.setFromAxisAngle(X, Math.max(-HAND_TURN, Math.min(HAND_TURN, this.wheelAngle))));
    }
    this.kmh = kmh;
    this.rpm = rpm;
    const n = this.gaugeUniforms.uNeedle.value;
    for (let i = 0; i < 4; i++) {
      const d = this.dials[i];
      if (d) n.setComponent(i, dialValue(d, kmh, rpm));
    }
    this.glow += (glow - this.glow) * Math.min(1, dt * 3);
    this.gaugeUniforms.uGlow.value = this.glow;
    for (const g of this.glowMaterials) setGlow(g.m, g.full * (CABIN_DAY_GLOW + (1 - CABIN_DAY_GLOW) * this.glow));
    // The unlit low-tier cabin has no sun or lamps on it: it dims by itself at night and in tunnels.
    for (const m of this.unlit) m.userData.shade.value = 1.4 - 0.9 * this.glow; // by day a little over the atlas (no sun on it), at night half
    this.gear = gear;
    this.lit = shiftLit(rpm);
    const u = this.displayUniforms;
    if (u) {
      const v = Math.min(999, Math.max(0, Math.round(kmh)));
      const dg = u.digits.value;
      dg[0] = gear;
      dg[1] = v >= 100 ? Math.floor(v / 100) : GLYPH.BLANK;
      dg[2] = v >= 10 ? Math.floor(v / 10) % 10 : GLYPH.BLANK;
      dg[3] = v % 10;
      u.lit.value = this.lit;
      u.flash.value = rpm >= SHIFT_FLASH && Math.sin(this.time * 50) > 0 ? 1 : 0;
      u.glow.value = this.glow;
    }
  }

  // The live rear view, as the shared cabin's (race/cockpit.js renderMirror): from the middle
  // mirror, looking back down the car. `force` renders now (the warm-up).
  renderMirror(renderer, scene, force = false) {
    if (!this.liveMirror || (!force && !this.group.visible)) return false;
    if (!force && this.mirrorFrame++ % MIRROR.every !== 0) return false;
    const cam = this.mirrorCamera;
    const g = this.group;
    g.updateMatrixWorld();
    const root = g.children[0].children[0];
    cam.position.copy(this.mirrorAt).applyMatrix4(root.matrixWorld);
    _b.set(this.mirrorAt.x - 20, this.mirrorAt.y - 1.4, this.mirrorAt.z).applyMatrix4(root.matrixWorld);
    cam.lookAt(_b);
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
    this.group.removeFromParent();
    this.mirrorTarget?.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    if (this.display) this.display.geometry.dispose();
    for (const o of this.mirrorMeshes) o.geometry.dispose();
  }
}

export { DEPTH_FRONT };

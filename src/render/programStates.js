import * as THREE from 'three';

// Keeps every material on one shader program for the whole race. three.js picks a material's
// program from the material and from the object drawing it (instanced or not, with per-instance
// colours or not, ...). When one material is drawn by objects that disagree, or flags itself for
// an update, the renderer rebuilds the program's parameters and cache key on every switch: no
// recompile (the program is cached), but tens of kilobytes of garbage per frame, which the
// collector then clears in a pause that lands mid-race. Run once on the finished race world:
//
//   - an instanced batch without per-instance colours that shares its material with batches
//     that have them (photo fronds on palms and redwoods vs. ferns) gets a white instanceColor;
//   - a transparent double-sided material is drawn in a single pass. three.js otherwise draws
//     it twice a frame, back faces then front, flagging the material for an update before each.
//     The race's are flames, glass, foliage cards and sprites, which do not need the two passes;
//   - instanced shadow casters draw their shadows with depth materials of their own. The shadow
//     pass otherwise draws every caster with one shared depth material, which flips between
//     instanced and not on every switch; each flip rebuilds its parameters from whatever caster
//     is current, so the first time a textured caster (a ramp) follows an instanced one, which
//     only happens once it comes into the sun's view, a new depth shader compiles mid-race.
const INSTANCED_DEPTH = [new THREE.MeshDepthMaterial(), new THREE.MeshDepthMaterial()];

export function unifyProgramStates(root) {
  const coloured = new Set();
  const instanced = [];
  root.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) {
      if (m.transparent && m.side === THREE.DoubleSide) m.forceSinglePass = true;
      if (o.isInstancedMesh && o.instanceColor) coloured.add(m);
    }
    if (o.isInstancedMesh && !o.instanceColor) instanced.push(o);
  });
  let added = 0;
  for (const o of instanced) {
    if (![].concat(o.material).some((m) => coloured.has(m))) continue;
    const n = o.instanceMatrix.count;
    o.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    added++;
  }
  root.traverse((o) => {
    if (o.isInstancedMesh && o.castShadow) o.customDepthMaterial = INSTANCED_DEPTH[o.instanceColor ? 1 : 0];
  });
  return added;
}

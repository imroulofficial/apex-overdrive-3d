// Quadric simplification for tools/cars/remaster/lods.py (meshoptimizer's simplifier, the repo's
// own dependency): node simplify.mjs DIR TARGET_TRIS NORMAL_WEIGHT
// in: DIR/V.f32 (xyz), DIR/N.f32 (vertex normals, an attribute so the smooth shading is kept),
// DIR/F.u32, optional DIR/L.u8 (locked vertices); optional args: update(0/1), max error, flags; out: DIR/Fo.u32, indices into the input vertices
// (every LOD vertex is a source vertex, so the LOD lies on the original surface). 'Regularize'
// keeps the triangles even, which the glossy paint needs (long slivers shade as ripples).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { MeshoptSimplifier as S } from 'meshoptimizer';
const [dir, tgt, nw, upd, errArg, flagArg] = process.argv.slice(2);
await S.ready;
const rd = (f, T) => { const b = readFileSync(`${dir}/${f}`); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
const V = rd('V.f32', Float32Array).slice(), N = rd('N.f32', Float32Array).slice(), F = rd('F.u32', Uint32Array).slice();
const L = existsSync(`${dir}/L.u8`) ? rd('L.u8', Uint8Array).slice() : null;
const w = Number(nw);
const flags = flagArg ? flagArg.split(',') : ['Regularize'];
const maxErr = errArg ? Number(errArg) : 1.0;
const t = Date.now();
if (upd === '1') {
  const [cnt, err] = S.simplifyWithUpdate(F, V, 3, N, 3, [w, w, w], L, Number(tgt) * 3, maxErr, flags);
  writeFileSync(`${dir}/Fo.u32`, Buffer.from(F.buffer, 0, cnt * 4));
  writeFileSync(`${dir}/Vo.f32`, Buffer.from(V.buffer));
  console.log('tris', cnt / 3, 'err', err, Date.now() - t, 'ms');
} else {
  const [out, err] = S.simplifyWithAttributes(F, V, 3, N, 3, [w, w, w], L, Number(tgt) * 3, maxErr, flags);
  writeFileSync(`${dir}/Fo.u32`, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  console.log('tris', out.length / 3, 'err', err, Date.now() - t, 'ms');
}

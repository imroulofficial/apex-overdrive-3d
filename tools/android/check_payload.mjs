// Lists the web payload that ships inside the AAB (android/app/src/main/assets/public, written
// by `npx cap sync android` from dist/) and fails if anything that is not a runtime asset got in:
// docs, store-listing art, preview/QA files, archives or recordings.
//
//   node tools/android/check_payload.mjs [dir]
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'android/app/src/main/assets/public');
const FORBIDDEN = [
  /\.(md|zip|mp3|psd|xcf|blend|fbx)$/i,
  /play-store|feature-graphic|screenshot|store-listing|preview|contact-sheet/i,
  /(^|\/)(phase\d+|final-qa|qa-audit)/i,
];

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push({ rel: path.relative(root, p), size: statSync(p).size });
  }
})(root);

const byDir = new Map();
for (const f of files) {
  const d = path.dirname(f.rel);
  const row = byDir.get(d) ?? { n: 0, size: 0 };
  row.n++;
  row.size += f.size;
  byDir.set(d, row);
}
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
for (const [d, { n, size }] of [...byDir].sort()) console.log(`${d.padEnd(22)} ${String(n).padStart(4)} files  ${mb(size)}`);
console.log(`${'TOTAL'.padEnd(22)} ${String(files.length).padStart(4)} files  ${mb(files.reduce((a, f) => a + f.size, 0))}`);

const bad = files.filter((f) => FORBIDDEN.some((re) => re.test(f.rel)));
for (const f of bad) console.log(`::error::non-runtime file in the AAB payload: ${f.rel}`);
if (bad.length) process.exit(1);

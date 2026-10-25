// QA helper: tiles PNGs into one contact sheet.  node tools/store/sheet.mjs out.png a.png b.png ...
import sharp from 'sharp';
const [out, ...files] = process.argv.slice(2);
const w = 640, h = 360, cols = 2;
const rows = Math.ceil(files.length / cols);
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(w, h, { fit: 'contain' }).toBuffer(), left: (i % cols) * w, top: Math.floor(i / cols) * h })));
await sharp({ create: { width: w * cols, height: h * rows, channels: 3, background: '#000' } }).composite(comps).png().toFile(out);

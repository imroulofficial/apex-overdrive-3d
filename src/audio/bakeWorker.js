// Bakes long loops off the main thread (see longLoop.js): { id, data, rate, seed } in, the
// baked samples back (transferred, not copied).
import { bakeLongLoop } from './longLoop.js';

self.onmessage = (e) => {
  const { id, data, rate, seed } = e.data;
  const out = bakeLongLoop(data, rate, { seed });
  self.postMessage({ id, data: out }, [out.buffer]);
};

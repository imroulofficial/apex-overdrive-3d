// Just enough DOM for building procedural cars in node: canvas textures get a 2D context
// that draws nothing.
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }),
};

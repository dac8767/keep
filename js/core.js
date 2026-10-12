'use strict';
// Core helpers shared by every module. Everything hangs off the global K namespace
// so the game runs straight from index.html without a build step or server.
(function () {
  const K = (window.K = {});
  // Map size is set at runtime: a large survey map while choosing a keep site, then the
  // playable realm cropped around it. Modules register K.onSize to refresh their copies.
  let N = 256;
  const sizeHooks = [];
  K.N = N;
  K.SURVEY_N = 1024;
  K.PLAY_N = 256;
  K.onSize = (f) => { sizeHooks.push(f); f(); };
  K.setSize = (n) => { N = K.N = n; for (const f of sizeHooks) f(); };
  K.TS = 16;
  K.T = { GRASS: 0, FOREST: 1, ROCK: 2, LAKE: 3, RIVER: 4, MOUNTAIN: 5, MINE: 6, SAND: 7, DIRT: 8, TRENCH: 9, MOAT: 10 };
  K.TNAME = ['Grassland', 'Forest', 'Rock patch', 'Lake', 'River', 'Mountain', 'Mine site', 'Sand', 'Dirt', 'Trench', 'Moat'];
  K.isWater = (t) => t === 3 || t === 4 || t === 10;
  K.idx = (x, y) => y * N + x;
  K.inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
  K.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  K.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  K.DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  K.DIRS8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

  K.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  K.hash = function (x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  K.noise = function (x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = K.hash(xi, yi, s), b = K.hash(xi + 1, yi, s), c = K.hash(xi, yi + 1, s), d = K.hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  K.fbm = function (x, y, s, oct) {
    oct = oct || 4;
    let v = 0, amp = 0.5, f = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      v += amp * K.noise(x * f, y * f, s + o * 17);
      tot += amp;
      amp *= 0.5;
      f *= 2;
    }
    return v / tot;
  };

  // Binary min-heap of (priority, value) pairs.
  K.Heap = class {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v;
      let i = k.length;
      k.push(key); v.push(val);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (k[p] <= key) break;
        k[i] = k[p]; v[i] = v[p]; i = p;
      }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v;
      const top = v[0];
      const lk = k.pop(), lv = v.pop();
      const n = k.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lk; v[i] = lv;
      }
      return top;
    }
  };

  K.fmtTime = (s) => {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  K.RES_NAME = { ore: 'iron ore', plank: 'processed lumber' };
  K.costText = (cost) => Object.entries(cost).map(([k, v]) => v + ' ' + (K.RES_NAME[k] || k)).join(', ') || 'free';
})();

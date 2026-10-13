'use strict';
// Procedural 256x256 map: elevation levels, mountains with mine sites, lakes (some with
// tentacle monsters), rivers, forests, rock patches and grasslands.
(function () {
  const T = K.T;
  let N, NM, NS;
  K.onSize(() => { N = K.N; NM = N - 1; NS = Math.log2(N); });

  function percentile(arr, p) {
    const s = Float32Array.from(arr).sort();
    return s[Math.floor(p * (s.length - 1))];
  }

  function blob(terrain, elev, cx, cy, r, seed, fn) {
    for (let y = Math.floor(cy - r - 3); y <= cy + r + 3; y++)
      for (let x = Math.floor(cx - r - 3); x <= cx + r + 3; x++) {
        if (!K.inb(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy) / r;
        const n = K.fbm(x / 5, y / 5, seed, 2) * 0.7;
        if (d < 0.65 + n) fn(K.idx(x, y), x, y);
      }
  }

  // Multi-source BFS distance (4-neighbour) used for start-site scoring.
  function distMap(pred) {
    const d = new Int32Array(N * N).fill(9999);
    const q = new Int32Array(N * N);
    let h = 0, t = 0;
    for (let i = 0; i < N * N; i++) if (pred(i)) { d[i] = 0; q[t++] = i; }
    while (h < t) {
      const i = q[h++], x = i & NM, y = i >> NS;
      for (const [dx, dy] of K.DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!K.inb(nx, ny)) continue;
        const j = K.idx(nx, ny);
        if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q[t++] = j; }
      }
    }
    return d;
  }

  // Custom-map sliders (1 = the standard map; percentages in the UI).
  K.MAP_OPTS = [
    { id: 'water', name: 'Water', min: 0, max: 10, tip: 'Lakes and rivers' },
    { id: 'mountains', name: 'Mountains', min: 0.25, max: 10, tip: 'Mountain ranges (needed for mines)' },
    { id: 'trees', name: 'Trees', min: 0, max: 10, tip: 'Forests to harvest for lumber' },
    { id: 'rock', name: 'Rock patches', min: 0, max: 10, tip: 'Rock patches for quarries' },
    { id: 'mines', name: 'Mine sites', min: 0.25, max: 10, tip: 'Mountain mine sites for iron ore' },
    { id: 'beasts', name: 'Beasts', min: 0, max: 10, tip: 'Spider, troll, dire wolf and wyvern lairs' },
    { id: 'difficulty', name: 'Enemy difficulty', min: 0.5, max: 10, tip: 'Size and toughness of the besieging armies' },
  ];
  K.mapOpts = function (o) {
    const out = {};
    for (const d of K.MAP_OPTS) { const v = o && +o[d.id]; out[d.id] = Number.isFinite(v) ? K.clamp(v, d.min, d.max) : 1; }
    return out;
  };
  K.isCustom = (o) => K.MAP_OPTS.some((d) => o && o[d.id] !== 1);
  // compact URL form: "water150.beasts0" (only non-default values, in percent)
  K.encodeOpts = (o) => K.MAP_OPTS.filter((d) => o && o[d.id] !== 1).map((d) => d.id + Math.round(o[d.id] * 100)).join('.');
  K.decodeOpts = (s) => {
    const o = {};
    for (const part of String(s || '').split('.')) { const m = /^([a-z]+)(\d+)$/.exec(part); if (m) o[m[1]] = +m[2] / 100; }
    return K.mapOpts(o);
  };
  // share of the land that is mountain: linear to 50% at 500%, then slower, always leaving open land for a Keep
  const mtnFrac = (O) => Math.min(O.mountains <= 5 ? 0.1 * O.mountains : 0.5 + 0.04 * (O.mountains - 5), Math.max(0.05, 0.8 - 0.055 * O.water));
  // counts are tuned for a 256x256 map and scale with area
  const scaleN = (n, f) => Math.round(n * f * (N * N) / 65536);

  K.genMap = function (seed, opts) {
    const O = K.mapOpts(opts);
    const R = K.rng(seed);
    const terrain = new Uint8Array(N * N), elev = new Uint8Array(N * N), h = new Float32Array(N * N);

    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let e = K.fbm(x / 72, y / 72, seed, 5) * 0.72 + K.fbm(x / 20, y / 20, seed + 99, 3) * 0.28;
        const m = K.fbm(x / 85, y / 85, seed + 300, 3);
        const ridge = 1 - Math.abs(K.fbm(x / 28, y / 28, seed + 500, 4) * 2 - 1);
        if (m > 0.53) e += (m - 0.53) * 2.6 * (0.4 + ridge);
        // keep the borders walkable so enemies can enter
        const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
        if (edge < 8) e = e * (0.75 + edge * 0.03) + 0.1 * (1 - edge / 8);
        h[y * N + x] = e;
      }
    const lakeLv = O.water > 0 ? percentile(h, 0.055 * O.water) : -Infinity, mtnLv = percentile(h, 1 - mtnFrac(O));
    const lv1 = percentile(h, 0.3), lv2 = percentile(h, 0.55), lv3 = percentile(h, 0.76);
    for (let i = 0; i < N * N; i++) {
      const e = h[i];
      if (e < lakeLv) { terrain[i] = T.LAKE; elev[i] = 0; }
      else if (e > mtnLv) { terrain[i] = T.MOUNTAIN; elev[i] = 4; }
      else { terrain[i] = T.GRASS; elev[i] = e < lv1 ? 0 : e < lv2 ? 1 : e < lv3 ? 2 : 3; }
    }

    // a few extra lakes
    for (let k = 0; k < scaleN(4, O.water); k++) {
      const cx = 30 + R() * (N - 60), cy = 30 + R() * (N - 60), r = 5 + R() * 8;
      blob(terrain, elev, cx, cy, r, seed + k * 7, (i) => { if (terrain[i] !== T.MOUNTAIN) terrain[i] = T.LAKE; });
    }

    const st = { terrain, elev, h, seed, R, O, flow: new Uint8Array(N * N) };
    // every map has rivers, whatever the sliders: if few could form naturally (no lakes, or
    // mountains everywhere) relax where they may rise, then let them cut gorges through the mountains
    let rivers = carveRivers(st);
    const want = Math.max(1, scaleN(1.5, 1));
    for (const [minLen, mtn] of [[40, false], [30, true], [16, true]])
      if (rivers < want) rivers += carveRivers(st, { count: want - rivers, minLen, anySource: true, mtn, avoid: () => false });
    cleanLakes(st);
    smoothElev(st);

    // pick a start location before decorating so we can guarantee nearby resources
    const start = pickStart(st);
    ensureResources(st, start);
    cleanLakes(st);

    placeMines(st);
    placeRocks(st, start);
    placeForests(st, start);
    placeSand(st);
    clearStart(st, start);
    smoothElev(st);

    const lakes = labelLakes(st);
    const world = {
      seed, terrain, elev, h, flow: st.flow,
      tree: new Uint8Array(N * N),
      start,
      lakes: lakes.list,
      lakeId: lakes.id,
      mines: st.mines,
    };
    for (let i = 0; i < N * N; i++) world.tree[i] = Math.floor(K.hash(i & NM, i >> NS, seed + 77) * 255);
    // monsters: some lakes, and always the lake nearest the start
    let nearest = null, nd = 1e9;
    for (const L of lakes.list) {
      const d = K.dist(L.cx, L.cy, start.x, start.y);
      if (d < nd && L.size >= 40) { nd = d; nearest = L; }
    }
    world.opts = O;
    for (const L of lakes.list) L.monster = (L === nearest) || (L.size >= 70 && R() < 0.45);
    world.entries = findEntries(world, R);
    return world;
  };

  // Cut the n x n playable realm with top-left (x0, y0) out of the survey map. Switches the
  // global map size to n. `start` is the keep centre in the new coordinates.
  K.cropMap = function (big, x0, y0, n, start) {
    const BN = K.N;
    const terrain = new Uint8Array(n * n), elev = new Uint8Array(n * n), h = new Float32Array(n * n), tree = new Uint8Array(n * n);
    const monster = new Uint8Array(n * n), flow = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const j = (y0 + y) * BN + x0 + x, i = y * n + x;
        terrain[i] = big.terrain[j]; elev[i] = big.elev[j]; if (big.flow) flow[i] = big.flow[j]; h[i] = big.h[j]; tree[i] = big.tree[j];
        const L = big.lakeId[j] >= 0 && big.lakes[big.lakeId[j]];
        if (L && L.monster) monster[i] = 1;
      }
    K.setSize(n);
    const lakes = labelLakes({ terrain });
    for (const L of lakes.list) L.monster = L.size >= 30 && L.tiles.some((i) => monster[i]);
    const mines = (big.mines || []).filter(([x, y]) => x >= x0 && y >= y0 && x + 1 < x0 + n && y + 1 < y0 + n).map(([x, y]) => [x - x0, y - y0]);
    ensureRiver({ terrain, elev, h, flow, seed: big.seed, R: K.rng(big.seed * 31 + x0 * 3 + y0) }, start);
    const world = { seed: big.seed, terrain, elev, h, flow, tree, start, lakes: lakes.list, lakeId: lakes.id, mines, opts: big.opts };
    world.entries = findEntries(world, K.rng(big.seed * 13 + x0 * 7 + y0));
    return world;
  };

  // Every realm gets a river (a Lumber Mill needs one): if the crop has almost none, carve one
  // that rises inside the realm and drains to a lake or the edge, clear of the Keep site.
  function ensureRiver(st, start) {
    let n = 0;
    for (let i = 0; i < N * N; i++) if (st.terrain[i] === T.RIVER) n++;
    if (n >= 30 * (N * N) / 16384) return;
    const avoid = (i) => K.dist(i & NM, i >> NS, start.x, start.y) < 10;
    for (const [minLen, anySource, mtn] of [[40, false, false], [30, true, false], [30, true, true], [16, true, true], [8, true, true]])
      if (carveRivers(st, { count: 1, minLen, anySource, mtn, avoid })) return;
  }

  // Rivers follow real drainage: a priority-flood from every outlet (lakes and the map edge)
  // gives each tile a downstream neighbour, so water only ever runs downhill (or across the
  // lowest saddle out of a basin) and never climbs over ridges or mountains.
  // `o` (fallback): { count, minLen, anySource, mtn, avoid(i) } relaxes where a river may rise;
  // `mtn` lets it run on through mountains, cutting a gorge.
  function carveRivers(st, o) {
    const flow = st.flow;
    const { terrain, elev, h, R, seed } = st;
    const count = o ? o.count : scaleN(3, st.O.water);
    if (!count) return 0;
    const minLen = o ? o.minLen : 40;
    const NN = N * N, fill = new Float32Array(NN), down = new Int32Array(NN).fill(-1), seen = new Uint8Array(NN);
    // slight noise so channels meander instead of running in straight lines
    const hp = (i) => h[i] + (terrain[i] === T.MOUNTAIN ? 1 : 0) + K.fbm((i & NM) / 9, (i >> NS) / 9, seed + 811, 2) * 0.035;
    const heap = [], push = (i, v) => {
      heap.push([v, i]); let k = heap.length - 1;
      while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    }, pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; let k = 0;
        for (;;) { const l = 2 * k + 1, r = l + 1; let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; }
      }
      return top;
    };
    for (let i = 0; i < NN; i++) {
      const x = i & NM, y = i >> NS;
      if (terrain[i] === T.LAKE || x === 0 || y === 0 || x === N - 1 || y === N - 1) { seen[i] = 1; fill[i] = hp(i); push(i, fill[i]); }
    }
    while (heap.length) {
      const [v, i] = pop(), x = i & NM, y = i >> NS;
      for (const [dx, dy] of K.DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!K.inb(nx, ny)) continue;
        const j = K.idx(nx, ny);
        if (seen[j]) continue;
        seen[j] = 1; down[j] = i;
        fill[j] = Math.max(v + 1e-4, hp(j)); // epsilon: flats drain by the shortest route
        push(j, fill[j]);
      }
    }
    let made = 0, tries = 0;
    while (made < count && tries++ < 300 * Math.max(1, count / 3)) {
      // source: high grassland at the foot of a mountain
      const sx = 20 + Math.floor(R() * (N - 40)), sy = 20 + Math.floor(R() * (N - 40));
      const si = K.idx(sx, sy);
      if (terrain[si] !== T.GRASS || elev[si] < (o && o.mtn ? 0 : o && o.anySource ? 1 : 2)) continue;
      let nearM = false;
      for (const [dx, dy] of K.DIRS8) if (K.inb(sx + dx, sy + dy) && terrain[K.idx(sx + dx, sy + dy)] === T.MOUNTAIN) nearM = true;
      if (!nearM && !(o && o.anySource)) continue;
      const path = [];
      let i = si, ok = false;
      while (i >= 0 && path.length < 4 * N) {
        if ((terrain[i] === T.MOUNTAIN && !(o && o.mtn)) || terrain[i] === T.MINE || (o && o.avoid(i))) break;
        path.push(i);
        if (terrain[i] === T.LAKE || terrain[i] === T.RIVER) { ok = true; break; }
        const x = i & NM, y = i >> NS;
        if (x === 0 || y === 0 || x === N - 1 || y === N - 1) { ok = true; break; }
        i = down[i];
      }
      if (!ok || path.length < minLen) continue;
      made++;
      let dir = 0;
      for (let k = 0; k < path.length; k++) {
        const px = path[k] & NM, py = path[k] >> NS;
        // downstream direction (1 + index into DIRS4); the last tile keeps the previous heading
        if (k + 1 < path.length) {
          const qx = path[k + 1] & NM, qy = path[k + 1] >> NS;
          dir = 1 + K.DIRS4.findIndex(([a, b]) => a === qx - px && b === qy - py);
        }
        // widen downstream, on the side away from the next tile so the bed stays a clean channel
        const wide = k >= 15 ? [[0, 0], [1, 0], [0, 1]] : [[0, 0]];
        for (const [dx, dy] of wide) {
          const nx = px + dx, ny = py + dy;
          if (!K.inb(nx, ny)) continue;
          const j = K.idx(nx, ny);
          if (terrain[j] === T.LAKE || (terrain[j] === T.MOUNTAIN && !(o && o.mtn))) continue;
          if (terrain[j] === T.MOUNTAIN) elev[j] = Math.min(elev[j], 3);
          if (terrain[j] !== T.RIVER || !flow[j]) flow[j] = dir;
          if (o && (terrain[j] === T.MINE || o.avoid(j))) continue;
          terrain[j] = T.RIVER;
        }
      }
    }
    return made;
  }

  function labelLakes(st) {
    const { terrain } = st;
    const id = new Int16Array(N * N).fill(-1);
    const list = [];
    for (let i = 0; i < N * N; i++) {
      if (terrain[i] !== T.LAKE || id[i] >= 0) continue;
      const L = { id: list.length, tiles: [], cx: 0, cy: 0, size: 0 };
      const q = [i];
      id[i] = L.id;
      while (q.length) {
        const j = q.pop(), x = j & NM, y = j >> NS;
        L.tiles.push(j); L.cx += x; L.cy += y;
        for (const [dx, dy] of K.DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (!K.inb(nx, ny)) continue;
          const k = K.idx(nx, ny);
          if (terrain[k] === T.LAKE && id[k] < 0) { id[k] = L.id; q.push(k); }
        }
      }
      L.size = L.tiles.length; L.cx /= L.size; L.cy /= L.size;
      list.push(L);
    }
    return { id, list };
  }

  function cleanLakes(st) {
    const { terrain, elev } = st;
    const L = labelLakes(st);
    for (const lake of L.list) {
      if (lake.size >= 14) continue;
      for (const i of lake.tiles) { terrain[i] = T.GRASS; elev[i] = 0; }
    }
  }

  function smoothElev(st) {
    const { terrain, elev } = st;
    for (let pass = 0; pass < 4; pass++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const i = K.idx(x, y);
          if (terrain[i] === T.MOUNTAIN) continue;
          let mn = 9;
          for (const [dx, dy] of K.DIRS8) {
            const nx = x + dx, ny = y + dy;
            if (!K.inb(nx, ny)) continue;
            const j = K.idx(nx, ny);
            if (terrain[j] === T.MOUNTAIN) continue;
            mn = Math.min(mn, elev[j]);
          }
          if (mn < 9 && elev[i] > mn + 1) elev[i] = mn + 1;
          if (K.isWater(terrain[i]) && terrain[i] === T.LAKE) elev[i] = Math.min(elev[i], mn);
        }
  }

  function pickStart(st) {
    const { terrain, elev } = st;
    const dLake = distMap((i) => terrain[i] === T.LAKE);
    const dMtn = distMap((i) => terrain[i] === T.MOUNTAIN);
    let best = null, bs = -1e9;
    const lo = Math.max(56, K.PLAY_N / 2 + 8), hi = N - lo;
    for (let y = lo; y < hi; y += 4)
      for (let x = lo; x < hi; x += 4) {
        const i = K.idx(x, y);
        if (terrain[i] !== T.GRASS || elev[i] > 2) continue;
        let bad = 0;
        for (let dy = -8; dy <= 8; dy++)
          for (let dx = -8; dx <= 8; dx++) {
            const j = K.idx(x + dx, y + dy);
            if (terrain[j] === T.MOUNTAIN || K.isWater(terrain[j])) bad += 3;
            else if (elev[j] !== elev[i]) bad += 1;
          }
        const s = -bad * 0.6 - Math.abs(dLake[i] - 17) * 2 - Math.max(0, dMtn[i] - 35) * 1.2 - K.dist(x, y, N / 2, N / 2) * 0.15;
        if (s > bs) { bs = s; best = { x, y }; }
      }
    return best || { x: N / 2, y: N / 2 };
  }

  function ensureResources(st, start) {
    const { terrain, elev, R, seed } = st;
    const findLand = (minD, maxD) => {
      for (let t = 0; t < 400; t++) {
        const a = R() * Math.PI * 2, d = minD + R() * (maxD - minD);
        const x = Math.round(start.x + Math.cos(a) * d), y = Math.round(start.y + Math.sin(a) * d);
        if (K.inb(x, y) && x > 12 && y > 12 && x < N - 12 && y < N - 12 && terrain[K.idx(x, y)] === T.GRASS) return { x, y };
      }
      return { x: start.x + minD, y: start.y };
    };
    let nearLake = 1e9, nearMtn = 1e9;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const t = terrain[K.idx(x, y)], d = K.dist(x, y, start.x, start.y);
        if (t === T.LAKE) nearLake = Math.min(nearLake, d);
        if (t === T.MOUNTAIN) nearMtn = Math.min(nearMtn, d);
      }
    if (nearLake > 26 && st.O.water > 0) {
      const p = findLand(16, 22);
      blob(terrain, elev, p.x, p.y, 7, seed + 41, (i) => { terrain[i] = T.LAKE; elev[i] = elev[K.idx(start.x, start.y)]; });
    }
    if (nearMtn > 42) {
      const p = findLand(28, 36);
      blob(terrain, elev, p.x, p.y, 6, seed + 43, (i) => { terrain[i] = T.MOUNTAIN; elev[i] = 4; });
    }
    st.start = start;
  }

  function placeMines(st) {
    const { terrain, elev, R } = st;
    const cands = [];
    for (let y = 2; y < N - 3; y++)
      for (let x = 2; x < N - 3; x++) {
        // 2x2 land block dug into a mountainside (mountain above, left or right of it)
        let ok = true;
        for (let dy = 0; dy < 2 && ok; dy++)
          for (let dx = 0; dx < 2 && ok; dx++) if (terrain[K.idx(x + dx, y + dy)] !== T.GRASS) ok = false;
        if (!ok) continue;
        const M = (dx, dy) => terrain[K.idx(x + dx, y + dy)] === T.MOUNTAIN;
        const face = (M(0, -1) && M(1, -1) && !M(0, 2) && !M(1, 2)) || (M(-1, 0) && M(-1, 1) && !M(2, 0) && !M(2, 1)) || (M(2, 0) && M(2, 1) && !M(-1, 0) && !M(-1, 1));
        if (!face) continue;
        cands.push([x, y]);
      }
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    // always include the candidate closest to the start
    const s = st.start;
    cands.sort((a, b) => (K.dist(a[0], a[1], s.x, s.y) < 45 ? -1 : 0) - (K.dist(b[0], b[1], s.x, s.y) < 45 ? -1 : 0));
    const chosen = [];
    for (const c of cands) {
      if (chosen.length >= scaleN(14, st.O.mines)) break;
      if (chosen.some((o) => K.dist(o[0], o[1], c[0], c[1]) < (st.O.mines > 1 ? 19 / Math.sqrt(st.O.mines) : 19))) continue;
      chosen.push(c);
      const e = Math.max(elev[K.idx(c[0], c[1])], elev[K.idx(c[0] + 1, c[1])]);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = K.idx(c[0] + dx, c[1] + dy); terrain[i] = T.MINE; elev[i] = e; }
    }
    st.mines = chosen;
  }

  function placeRocks(st, start) {
    const { terrain, elev, R, seed } = st;
    const put = (cx, cy, r, k) =>
      blob(terrain, elev, cx, cy, r, seed + 200 + k, (i) => {
        if (terrain[i] === T.GRASS && K.hash(i & NM, i >> NS, seed + 5) > 0.15) terrain[i] = T.ROCK;
      });
    for (let k = 0; k < scaleN(24, st.O.rock); k++) put(10 + R() * (N - 20), 10 + R() * (N - 20), 1.8 + R() * 2.5, k);
    // guaranteed rock patch near the start
    const a = R() * Math.PI * 2;
    put(start.x + Math.cos(a) * 17, start.y + Math.sin(a) * 17, 3, 99);
  }

  function placeForests(st, start) {
    const { terrain, seed } = st, tf = st.O.trees;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = K.idx(x, y);
        if (terrain[i] !== T.GRASS || !tf) continue;
        const m = K.fbm(x / 38, y / 38, seed + 900, 4);
        const r = K.hash(x, y, seed + 901);
        const nearStart = K.dist(x, y, start.x, start.y);
        let thr = m > 0.57 ? 0.2 : m > 0.5 ? 0.82 : 0.985;
        if (tf !== 1) thr = Math.max(0, 1 - (1 - thr) * tf);
        if (nearStart < 22) thr = Math.max(thr, 1 - 0.1 * Math.min(tf, 1));
        if (r > thr) terrain[i] = T.FOREST;
      }
    // a guaranteed grove close to the keep
    const gx = start.x - 14, gy = start.y + 9;
    for (let y = gy - 4; y <= gy + 4; y++)
      for (let x = gx - 5; x <= gx + 5; x++)
        if (K.inb(x, y) && terrain[K.idx(x, y)] === T.GRASS && K.hash(x, y, seed + 3) > 0.35) terrain[K.idx(x, y)] = T.FOREST;
  }

  function placeSand(st) {
    const { terrain, seed } = st;
    const out = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = K.idx(x, y);
        if (terrain[i] !== T.GRASS && terrain[i] !== T.FOREST) continue;
        let near = false;
        for (const [dx, dy] of K.DIRS8) if (K.inb(x + dx, y + dy) && terrain[K.idx(x + dx, y + dy)] === T.LAKE) near = true;
        if (near && K.hash(x, y, seed + 11) > 0.25) out.push(i);
      }
    for (const i of out) terrain[i] = T.SAND;
  }

  function clearStart(st, start) {
    const { terrain, elev } = st;
    const e0 = elev[K.idx(start.x, start.y)];
    for (let y = start.y - 10; y <= start.y + 10; y++)
      for (let x = start.x - 10; x <= start.x + 10; x++) {
        if (!K.inb(x, y)) continue;
        const d = K.dist(x, y, start.x, start.y);
        if (d > 10) continue;
        const i = K.idx(x, y);
        const t = terrain[i];
        if (t === T.MOUNTAIN || K.isWater(t) || t === T.MINE) continue;
        if (d < 8 && (t === T.FOREST || t === T.ROCK || t === T.SAND)) terrain[i] = T.GRASS;
        elev[i] = e0;
      }
  }

  // Edge locations enemies can enter from (must be reachable on foot from the keep).
  function findEntries(world, R) {
    const { terrain, start } = world;
    const seen = new Uint8Array(N * N);
    const q = [K.idx(start.x, start.y)];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop(), x = i & NM, y = i >> NS;
      for (const [dx, dy] of K.DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!K.inb(nx, ny)) continue;
        const j = K.idx(nx, ny);
        if (seen[j] || terrain[j] === T.MOUNTAIN || K.isWater(terrain[j])) continue;
        seen[j] = 1; q.push(j);
      }
    }
    const sides = { N: [], S: [], W: [], E: [] };
    for (let k = 4; k < N - 4; k += 2) {
      if (seen[K.idx(k, 0)]) sides.N.push({ x: k, y: 0, side: 'N' });
      if (seen[K.idx(k, N - 1)]) sides.S.push({ x: k, y: N - 1, side: 'S' });
      if (seen[K.idx(0, k)]) sides.W.push({ x: 0, y: k, side: 'W' });
      if (seen[K.idx(N - 1, k)]) sides.E.push({ x: N - 1, y: k, side: 'E' });
    }
    const out = [];
    for (const s of Object.keys(sides)) {
      const arr = sides[s];
      if (!arr.length) continue;
      // two entries per side when possible, spread apart
      const a = arr[Math.floor(arr.length * (0.2 + R() * 0.25))];
      const b = arr[Math.floor(arr.length * (0.6 + R() * 0.25))];
      out.push(a);
      if (b && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 50) out.push(b);
    }
    if (!out.length) out.push({ x: 0, y: start.y, side: 'W' });
    return out;
  }
})();

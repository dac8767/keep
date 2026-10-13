'use strict';
// Rendering: cached terrain chunks, y-sorted structures/units, effects, overlays, minimap.
(function () {
  const TS = 16, T = K.T, CH = 32, CHUNK_CAP = 260;
  let N, NM, NS, NC;
  K.onSize(() => { N = K.N; NM = N - 1; NS = Math.log2(N); NC = N / CH; });
  const R = (K.Render = {});

  const GRASS = [[84, 138, 56], [96, 150, 62], [110, 160, 70], [126, 168, 80]];
  const COL = {
    sand: [214, 196, 138], dirt: [138, 106, 68], rock: [126, 118, 104], mine: [132, 108, 84], trench: [92, 68, 44],
    deep: [36, 82, 136], mid: [50, 108, 160], shallow: [72, 140, 182], river: [62, 126, 174], moat: [58, 116, 162],
    mtn: [122, 110, 98], snow: [236, 240, 244],
  };

  function px(d, o, c, f) {
    d[o] = K.clamp(c[0] * f, 0, 255); d[o + 1] = K.clamp(c[1] * f, 0, 255); d[o + 2] = K.clamp(c[2] * f, 0, 255); d[o + 3] = 255;
  }

  R.init = function (world, canvas) {
    R.world = world;
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
    R.chunks = new Array(NC * NC).fill(null);
    R.chunkUse = new Map(); // chunk -> last frame drawn, so off-screen chunks can be freed
    R.stale = new Set();
    for (let i = 0; i < NC * NC; i++) R.stale.add(i);
    if (!R.cam) R.cam = { x: 0, y: 0, zoom: 2 };
    R.mini = document.getElementById('minimap');
    R.mini.width = R.mini.height = N;
    R.miniCtx = R.mini.getContext('2d');
    R.miniImg = R.miniCtx.createImageData(N, N);
    R.miniVer = -1;
    R.miniT = 0;
  };

  function waterDepth(w, x, y) {
    for (let r = 1; r <= 3; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (!K.inb(nx, ny)) continue;
          if (!K.isWater(w.terrain[K.idx(nx, ny)])) return r;
        }
    return 4;
  }

  function renderChunk(ci) {
    const w = R.world;
    const cx = (ci % NC) * CH, cy = Math.floor(ci / NC) * CH;
    let P = R.chunks[ci];
    if (!P) P = R.chunks[ci] = K.mkCanvas(CH * TS, CH * TS);
    const img = P.g.createImageData(CH * TS, CH * TS);
    const d = img.data, W = CH * TS;
    const seed = w.seed;
    for (let ty = 0; ty < CH; ty++)
      for (let tx = 0; tx < CH; tx++) {
        const x = cx + tx, y = cy + ty, i = K.idx(x, y);
        const t = w.terrain[i], e = w.elev[i];
        const eN = y > 0 ? w.elev[i - N] : e, eS = y < N - 1 ? w.elev[i + N] : e;
        const tS = y < N - 1 ? w.terrain[i + N] : t, tN = y > 0 ? w.terrain[i - N] : t;
        const water = K.isWater(t);
        // a moat takes on the look of the lake or river that fills it
        const wt = t === T.MOAT && w.moatSrc && w.moatSrc[i] ? w.moatSrc[i] : t;
        const depth = water && wt === T.LAKE ? waterDepth(w, x, y) : 1;
        const patch = K.fbm(x / 9, y / 9, seed + 31, 2);
        for (let py = 0; py < TS; py++)
          for (let pxl = 0; pxl < TS; pxl++) {
            const o = ((ty * TS + py) * W + tx * TS + pxl) * 4;
            const gx = x * TS + pxl, gy = y * TS + py;
            const hsh = K.hash(gx >> 1, gy >> 1, seed);
            const hf = K.hash(gx, gy, seed + 3);
            let c, f = 1;
            if (water) {
              c = wt === T.RIVER ? COL.river : wt === T.MOAT ? COL.moat : depth >= 3 ? COL.deep : depth === 2 ? COL.mid : COL.shallow;
              f = 0.97 + hsh * 0.06;
              // shoreline foam
              const edgeN = py === 0 && y > 0 && !K.isWater(tN), edgeS = py === TS - 1 && y < N - 1 && !K.isWater(tS);
              const edgeW = pxl === 0 && x > 0 && !K.isWater(w.terrain[i - 1]), edgeE = pxl === TS - 1 && x < N - 1 && !K.isWater(w.terrain[i + 1]);
              if (edgeN || edgeS || edgeW || edgeE) { c = [190, 224, 236]; f = 0.9 + hf * 0.1; }
              else if (py < 3 && y > 0 && !K.isWater(tN)) f *= 0.8; // shade under the bank
            } else if (t === T.MOUNTAIN) {
              const hh = w.h[i];
              const nw = x > 0 && y > 0 ? w.h[i - N - 1] : hh;
              const light = (hh - nw) * 40;
              c = hh > 0.9 && hf > 0.25 ? COL.snow : COL.mtn;
              f = 0.82 + K.clamp(light, -0.25, 0.3) + hsh * 0.12 + (hf > 0.92 ? 0.15 : 0);
              if (y < N - 1 && tS !== T.MOUNTAIN && py >= TS - 5) { c = [86, 74, 64]; f = 0.75 + (pxl % 3 === 0 ? -0.1 : 0) + hf * 0.08; }
            } else {
              const ef = 1 + (e - 1.5) * 0.045;
              switch (t) {
                case T.GRASS: case T.FOREST:
                  c = GRASS[K.clamp(e, 0, 3)];
                  f = ef * (0.93 + hsh * 0.1 + (patch - 0.5) * 0.18) * (t === T.FOREST ? 0.86 : 1);
                  if (t === T.GRASS && hf > 0.996) { c = hf > 0.998 ? [240, 220, 90] : [240, 240, 250]; f = 1; }
                  else if (t === T.GRASS && hf > 0.97) f *= 1.12;
                  break;
                case T.SAND: c = COL.sand; f = 0.94 + hsh * 0.1; break;
                case T.DIRT: c = COL.dirt; f = 0.9 + hsh * 0.16; break;
                case T.ROCK: c = COL.rock; f = 0.88 + hsh * 0.18; break;
                case T.MINE: c = COL.mine; f = 0.85 + hsh * 0.2; if (hf > 0.86) { c = hf > 0.95 ? [255, 214, 90] : [222, 120, 50]; f = 1; } break;
                case T.TRENCH: {
                  c = COL.trench; f = 0.85 + hsh * 0.15;
                  const nW = x > 0 && w.terrain[i - 1] !== T.TRENCH, nN = y > 0 && tN !== T.TRENCH;
                  if ((nN && py < 3) || (nW && pxl < 2)) f *= 0.65;
                  break;
                }
                default: c = GRASS[1];
              }
              // cliff faces where the ground steps down to the south
              if (y < N - 1 && eS < e && tS !== T.MOUNTAIN && py >= TS - 4) {
                c = [110, 86, 60]; f = 0.78 + (pxl % 4 === 0 ? -0.15 : 0) + (py === TS - 4 ? 0.3 : 0) + hf * 0.06;
              } else if (y > 0 && eN > e && py < 3) f *= 0.8 + py * 0.05;
              if (x > 0 && w.elev[i - 1] > e && pxl < 2 && !K.isWater(w.terrain[i - 1])) f *= 0.85;
            }
            px(d, o, c, f);
          }
      }
    P.g.putImageData(img, 0, 0);
    // features
    const S = K.SPR;
    for (let ty = 0; ty < CH; ty++)
      for (let tx = 0; tx < CH; tx++) {
        const x = cx + tx, y = cy + ty, i = K.idx(x, y);
        const t = w.terrain[i], v = w.tree[i];
        if (t === T.FOREST) {
          const pineP = w.elev[i] >= 2 ? 0.7 : 0.25;
          const spr = (v / 255) < pineP ? S.pine[v % 4] : S.oak[v % 6];
          P.g.drawImage(spr, tx * TS + ((v >> 3) % 3) - 1, ty * TS + ((v >> 5) % 3) - 1);
        } else if (t === T.ROCK) P.g.drawImage(S.rocks[v % 6], tx * TS, ty * TS);
        else if (w.stump && w.stump[i] && t === T.GRASS) P.g.drawImage(w.stump[i] === 2 ? S.sapling : S.stump, tx * TS, ty * TS);
      }
  }

  R.markDirty = function (set) { for (const c of set) R.stale.add(c); set.clear(); };

  // ---------------- main draw ----------------
  R.draw = function (G, time) {
    if (R.world !== G.world) R.init(G.world, R.canvas); // the survey map was cropped to the realm
    const w = R.world, ctx = R.ctx, cam = R.cam, z = cam.zoom;
    const cw = R.canvas.width, ch = R.canvas.height;
    R.markDirty(w.dirty);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0d0b12';
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.scale(z, z);
    ctx.translate(-Math.round(cam.x * z) / z, -Math.round(cam.y * z) / z);

    const x0 = Math.max(0, Math.floor(cam.x / TS) - 1), y0 = Math.max(0, Math.floor(cam.y / TS) - 1);
    const x1 = Math.min(N - 1, Math.ceil((cam.x + cw / z) / TS) + 1), y1 = Math.min(N - 1, Math.ceil((cam.y + ch / z) / TS) + 2);

    // terrain chunks
    let rendered = 0;
    R.frame = (R.frame || 0) + 1;
    for (let cy = y0 >> 5; cy <= y1 >> 5; cy++)
      for (let cx = x0 >> 5; cx <= x1 >> 5; cx++) {
        const ci = cy * NC + cx;
        if (R.stale.has(ci) && (rendered < 6 || !R.chunks[ci])) { renderChunk(ci); R.stale.delete(ci); rendered++; }
        if (R.chunks[ci]) { ctx.drawImage(R.chunks[ci].c, cx * CH * TS, cy * CH * TS); R.chunkUse.set(ci, R.frame); }
      }
    // each cached chunk is 1 MB: free the least recently drawn ones on big survey maps
    if (R.chunkUse.size > CHUNK_CAP) {
      const old = [...R.chunkUse].sort((a, b) => a[1] - b[1]);
      for (let k = 0; k < old.length - CHUNK_CAP; k++) {
        const ci = old[k][0];
        if (old[k][1] === R.frame) break;
        R.chunks[ci] = null; R.chunkUse.delete(ci); R.stale.add(ci);
      }
    }

    // water shimmer
    if (z >= 1) {
      ctx.fillStyle = 'rgba(220,240,255,0.55)';
      const tq = Math.floor(time * 1.5);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = K.idx(x, y);
          if (!K.isWater(w.terrain[i]) || w.sgrid[i]) continue;
          const hv = K.hash(x, y, tq + ((x * 7 + y * 3) % 5));
          if (hv < 0.18) {
            const ox = Math.floor(hv * 80) % 11, oy = Math.floor(hv * 300) % 13;
            ctx.fillRect(x * TS + ox + 1, y * TS + oy + 1, 3, 1);
            ctx.fillRect(x * TS + ox + 2, y * TS + oy, 1, 1);
          }
        }
      // river current: streaks drift downstream along each tile's flow direction
      ctx.fillStyle = 'rgba(170,215,242,0.4)';
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = K.idx(x, y);
          if (w.terrain[i] !== T.RIVER || w.sgrid[i]) continue;
          const f = w.flow ? w.flow[i] : 0;
          const [fx, fy] = f ? K.DIRS4[f - 1] : [0, 1];
          for (let k = 0; k < 2; k++) {
            const along = (time * 7 + K.hash(x, y, 9 + k) * 16) % 16, cross = 2 + ((K.hash(x, y, 4 + k) * 11) | 0);
            const a = fx + fy > 0 ? along : 16 - along;
            if (fx) ctx.fillRect(x * TS + Math.floor(a) - 1, y * TS + cross, 3, 1);
            else ctx.fillRect(x * TS + cross, y * TS + Math.floor(a) - 1, 1, 3);
          }
        }
    }

    // ladders planted on walls
    const S = K.SPR;
    const ground = [], items = [];
    for (const s of w.structs.values()) {
      if (s.x + s.w < x0 || s.x > x1 || s.y + s.h < y0 || s.y > y1 + 2) continue;
      const ft = s.type === 'site' ? s.final : s.type;
      if (ft === 'farm' || ft === 'bridge' || ft === 'drawbridge' || ft === 'keep' || ft === 'keepdoor') ground.push(s);
      else items.push({ y: s.y + s.h, s });
      if (s.type === 'wall' && s.engine) items.push({ y: s.y + K.SDEF[s.engine.type].h + 0.002, eng: s });
    }
    for (const s of ground) drawStruct(ctx, s, G, time);
    drawLairs(ctx, G, x0, y0, x1, y1);

    for (const u of G.units) {
      if (u.hidden || u.dead) continue;
      if (u.x < x0 - 2 || u.x > x1 + 2 || u.y < y0 - 2 || u.y > y1 + 2) continue;
      items.push({ y: u.y + (u.onWall ? 0.6 : 0.01), u });
    }
    for (const m of G.monsters) if (m.x > x0 - 3 && m.x < x1 + 3 && m.y > y0 - 3 && m.y < y1 + 3) items.push({ y: m.y + 0.5, m });
    for (const b of G.beasts || []) if (!b.dead && b.x > x0 - 3 && b.x < x1 + 3 && b.y > y0 - 3 && b.y < y1 + 3) items.push({ y: b.y + (b.kind === 'wyvern' ? 3 : 0.2), b });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.s) drawStruct(ctx, it.s, G, time);
      else if (it.eng) drawEngine(ctx, it.eng);
      else if (it.u) drawUnit(ctx, it.u, G, time);
      else if (it.b) drawBeast(ctx, it.b, time);
      else drawMonster(ctx, it.m, time);
    }

    // projectiles
    for (const p of G.projectiles) drawProjectile(ctx, p);
    // particles
    for (const p of G.particles) drawParticle(ctx, p);

    drawOverlays(ctx, G, time, x0, y0, x1, y1);
    ctx.restore();

    if (G.phase === 'defense') {
      ctx.fillStyle = 'rgba(60,10,30,0.13)';
      ctx.fillRect(0, 0, cw, ch);
    }
    R.drawMinimap(G, time);
  };

  function wallMask(w, x, y) {
    const c = (dx, dy) => {
      const s = w.structAt(x + dx, y + dy);
      return s && (s.type === 'wall' || K.isGate(s.type));
    };
    return (c(0, -1) ? 1 : 0) | (c(1, 0) ? 2 : 0) | (c(0, 1) ? 4 : 0) | (c(-1, 0) ? 8 : 0);
  }

  // A lumber mill's water wheel sits in the river beside it and turns with the current: the
  // paddles dipping into the water move downstream. A wheel north of the mill is drawn behind it.
  function drawWheel(ctx, w, s, time, before) {
    if (!s.wheel || s.wheelVer !== w.version) { s.wheel = w.millRiver(s.x, s.y, s) || s.wheel; s.wheelVer = w.version; }
    const r = s.wheel;
    if (!r || (r.ny === -1) !== before) return false;
    const edge = r.nx !== 0;
    // face-on wheel: the bottom dips, so flow east turns it anticlockwise; rim view: the river-side paddles follow the flow
    const dir = edge ? r.fy || 1 : -(r.fx || -1);
    const turn = s.type === 'site' ? 0 : time * 1.2 * dir;
    const f = (((Math.floor(turn * 6) % 6) + 6) % 6);
    const img = K.SPR.wheel[edge ? 1 : 0][f];
    const cx = (r.x + 0.5) * TS - r.nx * 5, cy = (r.y + 0.5) * TS - r.ny * 5;
    // axle into the mill
    ctx.fillStyle = '#4a3018';
    if (edge) ctx.fillRect(Math.min(cx, cx - r.nx * 8), cy - 1, 8, 2); else ctx.fillRect(cx - 1, Math.min(cy, cy - r.ny * 8), 2, 8);
    ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy - img.height / 2 - 2));
    // churned water where the paddles dip
    if (s.type !== 'site') {
      ctx.fillStyle = 'rgba(235,248,255,0.7)';
      for (let k = 0; k < 3; k++) {
        const ph = (time * 3 + k / 3) % 1;
        ctx.fillRect(Math.round(cx - 4 + k * 3 + (r.fx || 0) * ph * 4), Math.round(cy + 6 + (r.fy || 0) * ph * 4), 2, 1);
      }
    }
    return false;
  }

  // Walls that touch only at a corner are joined by a diagonal run of masonry (drawn under the tile itself;
  // the lower tile is drawn later and covers its own end).
  function wallDiagonals(ctx, w, s, bx, by) {
    const kind = (x, y) => { const o = w.structAt(x, y); return o && (o.type === 'wall' || K.isGate(o.type)) ? o : null; };
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const o = kind(s.x + sx, s.y + sy);
      if (!o || (sy < 0 && !K.isGate(o.type)) || kind(s.x + sx, s.y) || kind(s.x, s.y + sy)) continue;
      const bat = s.battlement && o.battlement;
      const step = (sz, oy, col) => {
        ctx.fillStyle = col;
        for (let t = 0; t <= TS; t++) ctx.fillRect(Math.round(bx + 8 + sx * t - sz / 2), Math.round(by + 4 + sy * t - sz / 2 + oy), sz, sz);
      };
      step(12, 6, '#5d5850'); step(12, 5, '#868074'); step(12, 0, '#bdb7aa');
      if (bat) { step(6, 0, '#958f82'); }
      else step(2, -3, '#d6d0c3');
    }
  }

  // Construction site: a faint preview of the finished building inside scaffolding.
  function drawSite(ctx, s, G, time) {
    const bx = s.x * TS, by = s.y * TS, bw = s.w * TS, bh = s.h * TS, f = Math.min(1, s.prog / s.time);
    ctx.fillStyle = 'rgba(120,90,55,0.35)'; ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
    ctx.save();
    ctx.globalAlpha = 0.3 + f * 0.45;
    drawStruct(ctx, Object.assign({}, s, { type: s.final, battlement: !!s.battle, hp: s.maxHp, raised: false, vert: s.rot ? false : null }), G, time);
    ctx.restore();
    // scaffold poles and planks
    ctx.fillStyle = '#7a5530';
    for (let x = bx + 1; x < bx + bw; x += 7) ctx.fillRect(x, by - 2, 1, bh + 1);
    ctx.fillStyle = '#a07646';
    ctx.fillRect(bx, by + 2, bw, 1); ctx.fillRect(bx, by + bh - 4, bw, 1);
    if (bh > 20) ctx.fillRect(bx, by + bh / 2, bw, 1);
    bar(ctx, bx + bw / 2 - 6, by - 5, 12, f, '#8ad0ff');
  }

  // a catapult or trebuchet standing on top of the battlements
  function drawEngine(ctx, s) {
    const e = s.engine, d = K.SDEF[e.type], S = K.SPR;
    const img = S[e.type][e.fired > 0 ? 1 : 0];
    const bx = s.x * TS + (d.w * TS - img.width) / 2, by = (s.y + d.h) * TS - img.height - 6;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(s.x * TS + 2, (s.y + d.h) * TS - 9, d.w * TS - 4, 3);
    if (e.type === 'trebuchet' && e.face < 0) {
      ctx.save(); ctx.translate(Math.round(bx) * 2 + img.width, 0); ctx.scale(-1, 1);
      ctx.drawImage(img, Math.round(bx), Math.round(by)); ctx.restore();
    } else ctx.drawImage(img, Math.round(bx), Math.round(by));
  }
  function drawStruct(ctx, s, G, time) {
    const S = K.SPR, w = R.world;
    if (s.type === 'site') return drawSite(ctx, s, G, time);
    const bx = s.x * TS, by = s.y * TS, bw = s.w * TS, bh = s.h * TS;
    let img = null;
    switch (s.type) {
      case 'keep': img = S.keep; break;
      case 'keepdoor': img = S.keepdoor; break;
      case 'house': img = S.house[s.id % 2]; break;
      case 'farm': img = S.farm[Math.min(2, Math.floor(((G.farmGrowth || 0) + s.id * 0.3) % 3))]; break;
      case 'quarry': img = S.quarry; break;
      case 'mine': img = S.mine; break;
      case 'bloomery': img = S.bloomery; break;
      case 'lumbermill': img = S.lumbermill; if (drawWheel(ctx, w, s, time, true)) return; break;
      case 'tent': img = S.tent; break;
      case 'barracks': img = S.barracks; break;
      case 'explosives': img = S.explosives; break;
      case 'granary': img = S.granary; break;
      case 'lumberyard': img = S.lumberyard; break;
      case 'stoneyard': img = S.stoneyard; break;
      case 'metalstore': img = S.metalstore; break;
      case 'stables': img = S.stables; break;
      case 'gate': img = S.gate[s.rot ? 1 : 0][G.phase === 'defense' ? 0 : 1]; break;
      case 'irongate': img = S.irongate[s.rot ? 1 : 0][G.phase === 'defense' ? 0 : 1]; break;
      case 'catapult': img = S.catapult[s.fired > 0 ? 1 : 0]; break;
      case 'trebuchet': img = S.trebuchet[s.fired > 0 ? 1 : 0]; break;
      case 'bridge': case 'drawbridge': {
        const landNS = !K.isWater(w.t(s.x, Math.max(0, s.y - 1))) || !K.isWater(w.t(s.x, Math.min(N - 1, s.y + 1)));
        const v = landNS ? 1 : 0;
        if (s.type === 'drawbridge') {
          // sections of one bridge join seamlessly; a raised bridge shows its deck only along the hinge edge
          const vert = s.vert != null ? s.vert : !!v, db = (x, y) => { const o = w.structAt(x, y); return !!o && o.type === 'drawbridge'; };
          const a = vert ? db(s.x - 1, s.y) : db(s.x, s.y - 1), b = vert ? db(s.x + 1, s.y) : db(s.x, s.y + 1);
          const far = !!s.hingeFar;
          const hinge = vert ? !db(s.x, far ? s.y + 1 : s.y - 1) : !db(far ? s.x + 1 : s.x - 1, s.y);
          img = S.dbTile(!!s.raised, vert, a, b, hinge, far);
          break;
        }
        img = S.bridge[v];
        break;
      }
      case 'wall': {
        img = S.wall[wallMask(w, s.x, s.y)][s.battlement ? 1 : 0];
        wallDiagonals(ctx, w, s, bx, by);
        ctx.drawImage(img, bx, by - 4);
        const i = K.idx(s.x, s.y);
        if (w.ladder[i]) { ctx.fillStyle = '#8a5e30'; ctx.fillRect(bx + 4, by - 2, 1, 18); ctx.fillRect(bx + 10, by - 2, 1, 18); for (let k = 0; k < 18; k += 3) ctx.fillRect(bx + 4, by - 2 + k, 7, 1);
          const lh = w.ladderHp.get(i);
          if (lh != null && lh < K.LADDER_HP) { ctx.fillStyle = '#000'; ctx.fillRect(bx + 2, by - 6, 12, 2); ctx.fillStyle = '#e0a040'; ctx.fillRect(bx + 2, by - 6, Math.ceil((12 * lh) / K.LADDER_HP), 2); }
        }
        drawDamage(ctx, s, bx, by - 4, bw, bh + 4);
        if (s.upg) {
          ctx.fillStyle = '#7a5530'; ctx.fillRect(bx + 2, by - 7, 1, 6); ctx.fillRect(bx + 13, by - 7, 1, 6);
          ctx.fillStyle = '#a07646'; ctx.fillRect(bx + 1, by - 6, 14, 1);
          bar(ctx, bx + 2, by - 9, 12, Math.min(1, s.upg.prog / s.upg.time), '#8ad0ff');
        }
        return;
      }
    }
    if (!img) return;
    const dx = bx + (bw - img.width) / 2, dy = by + bh - img.height;
    if (s.type === 'trebuchet' && s.face < 0) {
      // turned to face whatever it last fired at
      ctx.save(); ctx.translate(Math.round(dx) * 2 + img.width, 0); ctx.scale(-1, 1);
      ctx.drawImage(img, Math.round(dx), Math.round(dy)); ctx.restore();
    } else ctx.drawImage(img, Math.round(dx), Math.round(dy));
    if (s.type === 'keep') {
      // waving banner
      const fx = bx + 42, fy = by + bh - 60 + 1;
      ctx.fillStyle = '#3d63d8';
      for (let k = 0; k < 9; k++) {
        const wv = Math.round(Math.sin(time * 6 - k * 0.7) * 1.2);
        ctx.fillRect(fx + k, fy + wv, 1, 6 - (k > 6 ? k - 6 : 0));
      }
      ctx.fillStyle = '#f4cb4e';
      ctx.fillRect(fx + 3, fy + 2 + Math.round(Math.sin(time * 6 - 2) * 1.2), 2, 2);
    }
    if (s.type === 'lumbermill') drawWheel(ctx, w, s, time, false);
    if (s.type === 'bloomery' && s.workers.size && G.phase === 'build') {
      if (Math.random() < 0.06) G.particles.push({ kind: 'smoke', x: s.x + 1, y: s.y - 0.4, vx: 0.15, vy: -0.5, life: 3, max: 3 });
      ctx.fillStyle = `rgba(255,${150 + Math.sin(time * 9) * 60 | 0},40,0.35)`;
      ctx.fillRect(bx + 10, by + bh - 12, 8, 6);
    }
    if (s.built < 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(bx, by, bw, bh);
    }
    drawDamage(ctx, s, bx, by, bw, bh);
  }

  function drawDamage(ctx, s, x, y, w, h) {
    if (!s.maxHp || s.hp >= s.maxHp) return;
    const f = s.hp / s.maxHp;
    if (f < 0.6) {
      ctx.fillStyle = 'rgba(30,24,30,0.7)';
      const k = s.id * 7;
      ctx.fillRect(x + (k % (w - 4)) + 1, y + 5, 1, 4); ctx.fillRect(x + (k % (w - 4)) + 2, y + 8, 1, 3);
      if (f < 0.3) { ctx.fillRect(x + ((k * 3) % (w - 4)) + 2, y + 10, 3, 1); ctx.fillRect(x + ((k * 3) % (w - 4)) + 4, y + 11, 1, 4); }
    }
    bar(ctx, x + w / 2 - 6, y - 3, 12, f, '#e6c84a');
  }

  function bar(ctx, x, y, w, f, col) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 0.5, y - 0.5, w + 1, 2.5);
    ctx.fillStyle = f > 0.5 ? col : f > 0.25 ? '#e08a2a' : '#d43a2a';
    ctx.fillRect(x, y, Math.max(0.5, w * f), 1.5);
  }

  function drawUnit(ctx, u, G, time) {
    const S = K.SPR;
    let key = u.sprite;
    let frames = S.unit[key] || S.unit.subject;
    let f = 0;
    if (frames.length >= 4) {
      if (u.atkAnim > 0) f = 3;
      else if (u.moving) f = 1 + (Math.floor(time * 8 + u.id) % 2);
    } else if (frames.length === 2) f = u.atkAnim > 0 || (u.moving && Math.floor(time * 4) % 2) ? 1 : 0;
    const img = frames[f];
    const px = u.x * TS, py = u.y * TS + (u.onWall ? -6 : 0);
    const onWater = u.boat && K.isWater(R.world.terrain[K.idx(Math.floor(u.x), Math.floor(u.y))]);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    const sw = img.width * 0.5;
    ctx.fillRect(px - sw / 2, py - 1, sw, 2);
    if (onWater) ctx.drawImage(S.boat, Math.round(px - 9), Math.round(py - 6));
    const ride = u.horse && key !== 'cavalry' && !u.onWall;
    ctx.save();
    ctx.translate(Math.round(px), Math.round(py + (onWater ? -3 : 0) + 2));
    if (u.face < 0) ctx.scale(-1, 1);
    if (u.flash > 0) ctx.filter = 'brightness(2.2)';
    if (ride) {
      // a saddled horse under any mounted subject
      ctx.drawImage(S.horse[u.moving ? 1 + (Math.floor(time * 8 + u.id) % 2) : 0], -12, -21);
      ctx.drawImage(img, -Math.floor(img.width / 2), -img.height - 8);
    } else ctx.drawImage(img, -Math.floor(img.width / 2), -img.height);
    ctx.restore();
    if (u.carry) {
      // bundle of logs on the shoulder
      const lx = Math.round(px) - 5, ly = Math.round(py) - 12;
      if (u.carryRes === 'stone' || u.carryRes === 'ore') {
        // sack of stone or ore on the back
        const ore = u.carryRes === 'ore';
        ctx.fillStyle = '#6a4a2a'; ctx.fillRect(lx + 1, ly, 7, 5);
        ctx.fillStyle = ore ? '#b0603a' : '#9a9a9a'; ctx.fillRect(lx + 2, ly - 1, 2, 2); ctx.fillRect(lx + 5, ly - 1, 2, 2);
        ctx.fillStyle = ore ? '#e09a50' : '#c8c8c8'; ctx.fillRect(lx + 3, ly - 2, 2, 2);
      } else {
        for (const [k, c] of [[0, '#7a4a22'], [2, '#9a6432']]) { ctx.fillStyle = c; ctx.fillRect(lx, ly + k, 9, 2); }
        ctx.fillStyle = '#e0b878'; ctx.fillRect(lx + 8, ly, 1, 4);
      }
    }
    const top = py - img.height - (ride ? 8 : 0);
    if (u.hp < u.maxHp) bar(ctx, px - 5, top + 1, 10, u.hp / u.maxHp, u.team ? '#e05040' : '#5ad05a');
    if (u.kind === 'king') {
      ctx.fillStyle = '#f4cb4e';
      const by = py - img.height - 3 + Math.sin(time * 4) * 1;
      ctx.fillRect(px - 1, by, 3, 2); ctx.fillRect(px, by + 2, 1, 1);
    }
    if (u.selected) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.75;
      ctx.beginPath(); ctx.ellipse(px, py + 1, img.width > 18 ? 9 : 5, 2.5, 0, 0, Math.PI * 2); ctx.stroke();
      if (u.order) { ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo((u.order.x + 0.5) * TS, (u.order.y + 0.5) * TS); ctx.stroke(); ctx.setLineDash([]); }
    }
  }

  function drawBeast(ctx, b, time) {
    const px = Math.round(b.x * TS), py = Math.round(b.y * TS), t = time * (b.moving ? 10 : 2) + b.phase;
    const sc = b.young ? 0.6 : 1, top = py - ({ troll: 25, wolf: 14, wyvern: 30 }[b.kind] || 13) * sc;
    ctx.save();
    if (b.young) { ctx.translate(px, py); ctx.scale(sc, sc); ctx.translate(-px, -py); }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(px, py + 1, b.kind === 'troll' ? 8 : b.kind === 'wolf' ? 7 : 10, b.kind === 'wyvern' ? 2.5 : 3, 0, 0, Math.PI * 2); ctx.fill();
    const f = b.face < 0 ? -1 : 1, P = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(f > 0 ? px + x : px - x - w, py + y, w, h); };
    if (b.kind === 'wolf') {
      // dire wolf, side view: shaggy grey coat, bushy tail, yellow eyes; lunges when biting
      const run = b.moving ? Math.sin(t) : 0, lun = b.atk > 0 ? 2 : 0, bob = Math.round(Math.abs(run));
      P('#2c2c34', -10, -11 - bob, 4, 2); P('#6c6c78', -9, -11 - bob, 3, 1); P('#2c2c34', -8, -10 - bob, 3, 2);
      for (const [lx, ph] of [[-5, 0], [-3, Math.PI], [2, Math.PI], [4, 0]]) {
        const o = Math.round(Math.sin(t + ph) * 1.5 * (b.moving ? 1 : 0));
        P('#3a3a44', lx + o, -5, 2, 5); P('#585864', lx + o, -5, 1, 4); P('#1c1c22', lx + o, -1, 2, 1);
      }
      P('#2c2c34', -7, -11 - bob, 13, 7); P('#6c6c78', -6, -10 - bob, 11, 5); P('#8a8a96', -5, -11 - bob, 8, 2);
      P('#b8b8c0', -4, -6 - bob, 7, 1); P('#4c4c58', -6, -12 - bob, 2, 1); P('#4c4c58', -2, -12 - bob, 2, 1); P('#4c4c58', 2, -12 - bob, 2, 1);
      const hx = 5 + lun;
      P('#2c2c34', hx, -13 - bob, 5, 6); P('#7a7a86', hx + 1, -12 - bob, 3, 4);
      P('#2c2c34', hx + 1, -15 - bob, 1, 2); P('#2c2c34', hx + 3, -15 - bob, 1, 2);
      P('#2c2c34', hx + 4, -10 - bob, 4, 2); P('#9a9aa6', hx + 4, -10 - bob, 3, 1); P('#111', hx + 7, -10 - bob, 1, 1);
      if (lun) { P('#a83838', hx + 4, -8 - bob, 3, 1); P('#f0ead8', hx + 5, -8 - bob, 1, 1); }
      P('#ffd84a', hx + 2, -12 - bob, 1, 1);
    } else if (b.kind === 'wyvern') {
      // wyvern in flight: shadow on the ground, beating wings, swoops low to strike
      const lift = (b.atk > 0 ? 6 : 15) + Math.sin(t * 0.6) * 1.5, cy = Math.round(py - lift), fl = Math.sin(time * (b.moving ? 9 : 6) + b.phase);
      const a = 0.5 + 0.5 * fl, sy = cy - 3;
      const wing = (dir, len, dark) => {
        // membrane fan from the shoulder: leading arm to the tip, scalloped trailing edge back to the hip
        const tipX = -2 - 3 * a, tipY = sy + dir * len * (0.35 + 0.65 * a), X = x => Math.round(f > 0 ? px + x : px - x);
        ctx.fillStyle = dark ? '#4a2018' : '#9a3a2a'; ctx.strokeStyle = '#2a120e'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(2), sy); ctx.lineTo(X(tipX), tipY);
        ctx.lineTo(X(-7), sy + dir * len * 0.45 * (0.5 + a)); ctx.lineTo(X(-9), sy + dir * len * 0.2 * (0.5 + a)); ctx.lineTo(X(-6), sy);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = dark ? '#6a2a20' : '#c25a3a'; ctx.beginPath();
        ctx.moveTo(X(1), sy); ctx.lineTo(X(-7), sy + dir * len * 0.45 * (0.5 + a));
        ctx.moveTo(X(1), sy); ctx.lineTo(X(-9), sy + dir * len * 0.2 * (0.5 + a)); ctx.stroke();
        ctx.fillStyle = '#e8d8b0'; ctx.fillRect(X(tipX) - 1, Math.round(tipY) - 1, 2, 2);
      };
      wing(-1, 15, true);
      P('#3a1a14', -9, cy - py - 1, 6, 2); P('#6a2a20', -12, cy - py, 4, 1); P('#3a1a14', -14, cy - py - 1, 2, 3);
      P('#3a1a14', -4, cy - py - 4, 9, 7); P('#7a3020', -3, cy - py - 3, 7, 5); P('#d8a060', -2, cy - py, 5, 2);
      P('#3a1a14', 4, cy - py - 6, 5, 4); P('#7a3020', 5, cy - py - 5, 3, 2); P('#3a1a14', 8, cy - py - 4, 3, 2);
      P('#e8d8b0', 5, cy - py - 7, 1, 2); P('#ffd84a', 6, cy - py - 5, 1, 1);
      if (b.atk > 0) { P('#3a1a14', -1, cy - py + 3, 1, 3); P('#3a1a14', 2, cy - py + 3, 1, 3); }
      wing(1, 9, false);
    } else if (b.kind === 'troll') {
      const img = K.SPR.troll[b.atk > 0 ? 2 : b.moving && Math.sin(t) > 0 ? 1 : 0];
      ctx.save(); ctx.translate(px, 0); if (b.face < 0) ctx.scale(-1, 1);
      ctx.drawImage(img, -11, py + 2 - img.height);
      ctx.restore();
    } else {
      // giant spider: eight jointed legs around a bristly body
      const lift = b.atk > 0 ? -3 : 0;
      for (let k = 0; k < 8; k++) {
        const side = k < 4 ? -1 : 1, n = k % 4;
        const sw = Math.sin(t + n * 1.6 + (side > 0 ? Math.PI : 0)) * 1.5;
        const kx = px + side * (5 + n * 0.5), ky = py - 6 + (n - 1.5) * 2.6 + sw * 0.5;
        const fx = px + side * (10 + (n === 0 || n === 3 ? 0 : 1)), fy = py - 4 + (n - 1.5) * 4.2 + sw + (n === 0 ? lift : 0);
        ctx.fillStyle = '#1e1a22';
        for (let s = 0; s <= 4; s++) { const a = s / 4; ctx.fillRect(Math.round(px + (kx - px) * a), Math.round(py - 4 + (ky - py + 4) * a - 1), 1, 1); }
        ctx.fillRect(Math.round(kx), Math.round(ky - 2), 1, 2);
        for (let s = 0; s <= 4; s++) { const a = s / 4; ctx.fillRect(Math.round(kx + (fx - kx) * a), Math.round(ky - 2 + (fy - ky + 2) * a), 1, 1); }
      }
      // abdomen
      const ab = b.face < 0 ? 4 : -4;
      ctx.fillStyle = '#100c14'; ctx.fillRect(px + ab - 5, py - 10, 10, 8);
      ctx.fillStyle = '#2c2434'; ctx.fillRect(px + ab - 4, py - 11, 8, 9);
      ctx.fillStyle = '#3e3448'; ctx.fillRect(px + ab - 3, py - 10, 4, 2);
      ctx.fillStyle = '#c0283a'; ctx.fillRect(px + ab - 1, py - 8, 2, 1); ctx.fillRect(px + ab, py - 9, 1, 3);
      // head
      const hx = px - ab * 0.9;
      ctx.fillStyle = '#100c14'; ctx.fillRect(Math.round(hx) - 3, py - 8, 6, 5);
      ctx.fillStyle = '#2c2434'; ctx.fillRect(Math.round(hx) - 2, py - 8, 4, 4);
      ctx.fillStyle = '#ff4a3a';
      const ex = Math.round(hx) + (b.face < 0 ? -2 : 0);
      ctx.fillRect(ex, py - 7, 1, 1); ctx.fillRect(ex + 2, py - 7, 1, 1); ctx.fillRect(ex + 1, py - 6, 1, 1);
      ctx.fillStyle = '#d8d0c0'; ctx.fillRect(Math.round(hx) + (b.face < 0 ? -3 : 2), py - 4 + (b.atk > 0 ? 1 : 0), 1, 2);
    }
    ctx.restore();
    if (b.hp < b.maxHp) bar(ctx, px - 7, top - 2, 14, b.hp / b.maxHp, '#c060e0');
    // sex marker: blue ♂ / pink ♀, with a heart while courting
    if (b.sex) {
      ctx.save(); ctx.font = '5px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const sx = px + (b.kind === 'troll' ? 7 : 6) * sc, sy = top + 3;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = b.sex === 'm' ? '#a9c8e8' : '#e8b4cf'; ctx.fillText(b.sex === 'm' ? '♂' : '♀', sx, sy);
      ctx.globalAlpha = 1;
      if (b.mate && !b.mate.dead) {
        ctx.font = 'bold 8px sans-serif';
        const hy = top - 2 - Math.abs(Math.sin(time * 3 + b.phase)) * 2;
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText('♥', px, hy);
        ctx.fillStyle = '#ff5a7a'; ctx.fillText('♥', px, hy);
      }
      ctx.restore();
    }
  }

  // Crocodile, drawn top-down along its heading: tapering tail, splayed legs, ridged back, long snout.
  function drawCroc(ctx, m, time) {
    const px = m.x * TS, py = m.y * TS, t = time + m.phase, moving = m.path && m.pi < m.path.length && !(m.wait > 0);
    // wake ripples
    ctx.strokeStyle = 'rgba(200,230,255,0.4)'; ctx.lineWidth = 1;
    const rr = 5 + ((t * 4) % 8);
    ctx.globalAlpha = 1 - ((t * 4) % 8) / 8;
    ctx.beginPath(); ctx.ellipse(px, py, rr * 1.4, rr * 0.7, m.ang || 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(Math.round(px), Math.round(py)); ctx.rotate(m.ang || 0);
    const P = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    if (m.submerged > 0 && !(m.attacking > 0)) {
      // only eyes and nostrils break the surface
      P('rgba(30,50,30,0.35)', -10, -3, 20, 6);
      P('#3c5a2c', 4, -3, 3, 2); P('#3c5a2c', 4, 1, 3, 2); P('#ffd84a', 5, -3, 1, 1); P('#ffd84a', 5, 2, 1, 1);
      P('#2c4220', 11, -1, 1, 1); P('#2c4220', 11, 1, 1, 1);
      ctx.restore(); return;
    }
    const sw = moving ? Math.sin(t * 7) : Math.sin(t * 1.2) * 0.3;
    // tail: segments swinging side to side
    for (let k = 0; k < 7; k++) {
      const x = -6 - k * 2, y = Math.round(sw * k * 0.45), h = Math.max(1, 5 - Math.floor(k * 0.7));
      P('#2e4622', x - 1, y - Math.ceil(h / 2) - 0, 3, h + 1);
      P('#4c6c34', x, y - Math.floor(h / 2), 2, h);
      if (k % 2 === 0 && h > 2) P('#22361a', x, y, 1, 1);
    }
    // legs
    const lg = moving ? Math.round(Math.sin(t * 7) * 1.5) : 0;
    for (const [lx, s, o] of [[3, -1, lg], [3, 1, -lg], [-5, -1, -lg], [-5, 1, lg]]) {
      P('#2e4622', lx + o - 1, s < 0 ? -7 : 4, 3, 3); P('#4c6c34', lx + o - 1, s < 0 ? -6 : 4, 2, 2);
      P('#1c2a14', lx + o - 2, s < 0 ? -8 : 6, 1, 1); P('#1c2a14', lx + o + 1, s < 0 ? -8 : 6, 1, 1);
    }
    // body
    P('#2e4622', -7, -4, 15, 8);
    P('#4c6c34', -6, -3, 13, 6);
    P('#5e8040', -5, -2, 11, 4);
    for (let k = -5; k <= 5; k += 2) { P('#2e4622', k, -1, 1, 1); P('#2e4622', k, 0, 1, 1); P('#7a9a52', k + 1, -2, 1, 1); P('#7a9a52', k + 1, 1, 1, 1); }
    // head and snout (jaws gape while biting)
    const gape = m.attacking > 0 ? 2 : 0;
    P('#2e4622', 7, -3, 4, 6); P('#4c6c34', 7, -2, 4, 4);
    P('#2e4622', 11, -2 - gape, 6, 2); P('#4c6c34', 11, -2 - gape, 5, 1);
    P('#2e4622', 11, gape, 6, 2); P('#4c6c34', 11, gape + 1, 5, 1);
    if (gape) { P('#a83838', 11, -1, 5, 2); P('#f0ead8', 12, -1, 1, 1); P('#f0ead8', 14, -1, 1, 1); P('#f0ead8', 13, 0, 1, 1); P('#f0ead8', 15, 0, 1, 1); }
    else P('#f0ead8', 12, 0, 1, 1), P('#f0ead8', 14, -1, 1, 1);
    P('#ffd84a', 8, -3, 2, 1); P('#ffd84a', 8, 2, 2, 1); P('#111', 9, -3, 1, 1); P('#111', 9, 2, 1, 1);
    P('#1c2a14', 16, -1 - gape, 1, 1); P('#1c2a14', 16, gape, 1, 1);
    ctx.restore();
  }

  function drawMonster(ctx, m, time) {
    // passing under a bridge (or a lowered drawbridge): only a dark shape shows between the planks
    const ub = R.world.structAt(Math.floor(m.x), Math.floor(m.y));
    if (ub && (ub.type === 'bridge' || (ub.type === 'drawbridge' && !ub.raised))) {
      ctx.fillStyle = 'rgba(10,25,20,0.28)'; ctx.beginPath(); ctx.ellipse(m.x * TS, m.y * TS, 9, 4, m.ang || 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (m.kind === 'croc') return drawCroc(ctx, m, time);
    const px = m.x * TS, py = m.y * TS;
    const t = time + m.phase;
    // ripples
    ctx.strokeStyle = 'rgba(200,230,255,0.5)';
    ctx.lineWidth = 1;
    const rr = 6 + ((t * 6) % 10);
    ctx.globalAlpha = 1 - ((t * 6) % 10) / 10;
    ctx.beginPath(); ctx.ellipse(px, py, rr, rr * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (m.submerged > 0) {
      ctx.fillStyle = 'rgba(40,20,60,0.45)';
      ctx.beginPath(); ctx.ellipse(px, py, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const n = 5;
    for (let k = 0; k < n; k++) {
      const base = (k / n) * Math.PI * 2 + 0.4;
      let ax = px + Math.cos(base) * 6, ay = py + Math.sin(base) * 3;
      const reach = m.attacking > 0 && k === 0 ? 22 : 12 + Math.sin(t * 2 + k) * 3;
      const ang = m.attacking > 0 && k === 0 ? m.atkAng : base - Math.PI / 2 * 0.6;
      for (let s = 0; s < 8; s++) {
        const fr = s / 8;
        const wob = Math.sin(t * 4 + k * 1.7 + s * 0.8) * (0.5 + fr * 1.4);
        const a = ang + wob * 0.35;
        const nx = ax + Math.cos(a) * (reach / 8) * (k === 0 && m.attacking > 0 ? 1 : 0.6) + Math.cos(base) * 0.8;
        const ny = ay + Math.sin(a) * (reach / 8) * 0.8 - (m.attacking > 0 && k === 0 ? 0 : 1.1);
        const thick = Math.max(1, 4 - s * 0.45);
        ctx.fillStyle = s % 2 ? '#7d47b8' : '#6a3a9e';
        ctx.fillRect(Math.round(nx - thick / 2), Math.round(ny - thick / 2), Math.ceil(thick), Math.ceil(thick));
        if (s % 2 === 0 && thick > 2) { ctx.fillStyle = '#e8b8f0'; ctx.fillRect(Math.round(nx), Math.round(ny), 1, 1); }
        ax = nx; ay = ny;
      }
    }
    // head
    ctx.fillStyle = '#5a2e8c';
    ctx.beginPath(); ctx.ellipse(px, py - 2, 7, 5, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#8a56c8'; ctx.fillRect(px - 4, py - 6, 4, 1);
    ctx.fillStyle = '#ffe14a';
    const blink = Math.sin(t * 1.3) > 0.97 ? 0 : 2;
    ctx.fillRect(px - 4, py - 4, 2, blink); ctx.fillRect(px + 2, py - 4, 2, blink);
    ctx.fillStyle = '#000'; ctx.fillRect(px - 3, py - 4, 1, blink ? 1 : 0); ctx.fillRect(px + 3, py - 4, 1, blink ? 1 : 0);
  }

  function drawProjectile(ctx, p) {
    const f = p.t / p.dur;
    const x = (p.sx + (p.tx - p.sx) * f) * TS, y0 = (p.sy + (p.ty - p.sy) * f) * TS;
    const arc = p.arc * Math.sin(f * Math.PI) * TS;
    if (p.kind === 'stone') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x - 2, y0 - 1, 4, 2);
      ctx.fillStyle = '#6f6c66'; ctx.fillRect(x - 2, y0 - arc - 2, 4, 4);
      ctx.fillStyle = '#b0aca4'; ctx.fillRect(x - 2, y0 - arc - 2, 2, 2);
    } else {
      const ang = Math.atan2((p.ty - p.sy) * TS - Math.cos(f * Math.PI) * p.arc * TS * Math.PI, (p.tx - p.sx) * TS);
      const len = p.kind === 'bolt' ? 7 : 5;
      ctx.strokeStyle = p.kind === 'bolt' ? '#4a3018' : '#e8dcc0';
      ctx.lineWidth = p.kind === 'bolt' ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(x, y0 - arc); ctx.lineTo(x - Math.cos(ang) * len, y0 - arc - Math.sin(ang) * len); ctx.stroke();
    }
  }

  function drawParticle(ctx, p) {
    const a = Math.max(0, p.life / p.max);
    if (p.kind === 'text') {
      ctx.globalAlpha = Math.min(1, a * 2);
      ctx.font = 'bold 6px monospace';
      ctx.fillStyle = '#000'; ctx.fillText(p.text, p.x * TS + 0.5, p.y * TS + 0.5);
      ctx.fillStyle = p.color || '#fff'; ctx.fillText(p.text, p.x * TS, p.y * TS);
      ctx.globalAlpha = 1;
    } else if (p.kind === 'smoke') {
      ctx.fillStyle = `rgba(90,90,100,${a * 0.5})`;
      const s = 3 + (1 - a) * 5;
      ctx.fillRect(p.x * TS - s / 2, p.y * TS - s / 2, s, s);
    } else if (p.kind === 'boom') {
      const r = (1 - a) * p.r * TS + 2;
      ctx.fillStyle = `rgba(255,${Math.floor(120 + a * 120)},40,${a * 0.85})`;
      ctx.beginPath(); ctx.arc(p.x * TS, p.y * TS, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,250,200,${a * a})`;
      ctx.beginPath(); ctx.arc(p.x * TS, p.y * TS, r * 0.5, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'dust') {
      ctx.fillStyle = `rgba(170,150,120,${a * 0.7})`;
      const s = 2 + (1 - a) * 6;
      ctx.fillRect(p.x * TS - s / 2, p.y * TS - s / 2, s, s);
    } else if (p.kind === 'blood') {
      ctx.fillStyle = `rgba(150,20,20,${a})`;
      ctx.fillRect(p.x * TS, p.y * TS, 1.5, 1.5);
    } else if (p.kind === 'splash') {
      ctx.strokeStyle = `rgba(220,240,255,${a})`;
      ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, (1 - a) * 8 + 2, ((1 - a) * 8 + 2) / 2, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (p.kind === 'corpse') {
      ctx.globalAlpha = Math.min(1, a * 2);
      const img = p.img;
      ctx.save(); ctx.translate(p.x * TS, p.y * TS); ctx.rotate(Math.PI / 2 * p.dir);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  // Webs, bones, dens and nests mark beasts' lairs; drawn on the ground, beneath every creature.
  function drawLairs(ctx, G, x0, y0, x1, y1) {
    const done = new Set();
    for (const b of G.beasts || []) {
      if (b.dead || b.hx < x0 - 12 || b.hx > x1 + 12 || b.hy < y0 - 12 || b.hy > y1 + 12) continue;
      const key = b.kind + ':' + Math.round(b.hx * 2) + ',' + Math.round(b.hy * 2);
      if (done.has(key)) continue;
      done.add(key);
      const cx = b.hx * TS, cy = b.hy * TS;
      if (b.kind === 'spider') {
        ctx.strokeStyle = 'rgba(235,235,245,0.32)'; ctx.lineWidth = 0.6;
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + 0.2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 18); ctx.stroke(); }
        for (const r of [8, 15, 22]) { ctx.beginPath(); for (let k = 0; k <= 8; k++) { const a = k * Math.PI / 4 + 0.2; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.7; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
      } else if (b.kind === 'wolf') {
        // a trampled den with paw prints
        ctx.fillStyle = 'rgba(70,52,36,0.35)'; ctx.beginPath(); ctx.ellipse(cx, cy, 14, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(40,30,22,0.55)';
        for (const [dx, dy] of [[-16, 8], [-11, 11], [14, -8], [18, -3], [6, 14]]) { ctx.fillRect(cx + dx, cy + dy, 2, 2); ctx.fillRect(cx + dx - 1, cy + dy - 2, 1, 1); ctx.fillRect(cx + dx + 1, cy + dy - 2, 1, 1); ctx.fillRect(cx + dx + 2, cy + dy - 1, 1, 1); }
      } else if (b.kind === 'wyvern') {
        // a nest of sticks and bones on the peak
        ctx.fillStyle = '#5a4028'; ctx.beginPath(); ctx.ellipse(cx, cy, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3a2818'; ctx.beginPath(); ctx.ellipse(cx, cy, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8e0cc'; ctx.fillRect(cx - 9, cy - 2, 5, 1); ctx.fillRect(cx + 5, cy + 2, 5, 1);
        ctx.fillStyle = '#d8c8a0'; ctx.fillRect(cx - 2, cy - 2, 3, 3); ctx.fillRect(cx + 1, cy, 3, 3);
      } else {
        ctx.fillStyle = '#e8e0cc';
        for (const [dx, dy] of [[-10, 6], [9, -4], [4, 10], [-6, -9]]) { ctx.fillRect(cx + dx, cy + dy, 4, 1); ctx.fillRect(cx + dx - 1, cy + dy - 1, 1, 3); ctx.fillRect(cx + dx + 4, cy + dy - 1, 1, 3); }
        ctx.fillRect(cx + 12, cy + 4, 3, 3); ctx.fillStyle = '#2a2420'; ctx.fillRect(cx + 12, cy + 5, 1, 1); ctx.fillRect(cx + 14, cy + 5, 1, 1);
      }
    }
  }
  function drawOverlays(ctx, G, time, x0, y0, x1, y1) {
    const w = R.world;
    // unclaimed mine sites: glowing outline + bobbing pickaxe so they stand out
    for (const [mx, my] of w.mines || []) {
      if (mx + 2 < x0 || mx > x1 || my + 2 < y0 || my > y1) continue;
      if (w.sgrid[K.idx(mx, my)]) continue;
      const pulse = 0.5 + Math.sin(time * 3 + mx) * 0.5;
      ctx.strokeStyle = `rgba(255,205,70,${0.45 + pulse * 0.45})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(mx * TS + 0.5, my * TS + 0.5, 2 * TS - 1, 2 * TS - 1);
      ctx.setLineDash([]);
      const bx = mx * TS + TS - 5, by = my * TS - 6 + Math.round(Math.sin(time * 2.5 + my) * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 2, by - 2, 14, 14);
      ctx.fillStyle = '#ffd25a'; ctx.fillRect(bx - 1, by - 1, 12, 12);
      ctx.fillStyle = '#3a2a18'; ctx.fillRect(bx, by, 10, 10);
      ctx.fillStyle = '#b08850'; for (let k = 0; k < 6; k++) ctx.fillRect(bx + 2 + k, by + 7 - k, 1, 1);
      ctx.fillStyle = '#d0d6e0'; ctx.fillRect(bx + 4, by + 1, 5, 1); ctx.fillRect(bx + 8, by + 2, 1, 3); ctx.fillRect(bx + 3, by + 2, 1, 1);
    }
    // beasts' territory rings
    for (const b of G.beasts || []) {
      if (b.dead || b.hx < x0 - 12 || b.hx > x1 + 12 || b.hy < y0 - 12 || b.hy > y1 + 12) continue;
      const cx = b.hx * TS, cy = b.hy * TS;
      // territory ring: faint always, bold while hovered
      const hov = G.ui && G.ui.hoverBeast === b;
      ctx.save(); ctx.setLineDash([4, 4]); ctx.lineWidth = hov ? 1.5 : 1;
      ctx.strokeStyle = hov ? 'rgba(255,80,60,0.85)' : 'rgba(220,60,50,0.28)';
      ctx.beginPath(); ctx.arc(cx, cy, K.BEASTS[b.kind].roam * TS, 0, Math.PI * 2); ctx.stroke();
      if (hov) { ctx.fillStyle = 'rgba(255,60,40,0.07)'; ctx.fill(); }
      ctx.restore();
    }
    // planned trenches
    if (w.plan && w.plan.size) {
      ctx.lineWidth = 1;
      for (const i of w.plan) {
        const x = i & NM, y = i >> NS;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const fill = w.fillPlan.has(i);
        ctx.fillStyle = fill ? 'rgba(150,190,90,0.35)' : 'rgba(110,70,30,0.35)';
        ctx.fillRect(x * TS, y * TS, TS, TS);
        const pr = w.digProg && w.digProg.get(i);
        if (pr) { ctx.fillStyle = fill ? 'rgba(140,100,60,0.9)' : 'rgba(70,46,24,0.85)'; ctx.fillRect(x * TS + 2, y * TS + 2, (TS - 4) * Math.min(1, pr), TS - 4); }
        ctx.strokeStyle = fill ? 'rgba(190,240,130,0.85)' : 'rgba(240,200,120,0.8)';
        ctx.setLineDash([2, 2]); ctx.lineDashOffset = -time * 4;
        ctx.strokeRect(x * TS + 0.5, y * TS + 0.5, TS - 1, TS - 1);
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    // enemy covered bridges (planks under a hide roof) and engineers' work in progress
    if (w.ebridgeHp && w.ebridgeHp.size) {
      for (const [i, hp] of w.ebridgeHp) {
        const x = i & NM, y = i >> NS;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const px = x * TS, py = y * TS;
        ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px, py + 1, TS, TS - 2);
        ctx.fillStyle = '#87603a'; for (let k = 1; k < TS; k += 3) ctx.fillRect(px, py + k, TS, 1);
        ctx.fillStyle = '#4a3220'; ctx.fillRect(px + 1, py + 2, TS - 2, TS - 5);
        ctx.fillStyle = '#7c6046'; ctx.fillRect(px + 2, py + 3, TS - 4, 4);
        ctx.fillStyle = '#5d4630'; ctx.fillRect(px + 2, py + 7, TS - 4, 4);
        ctx.fillStyle = '#a4825a'; ctx.fillRect(px + 2, py + 6, TS - 4, 1);
        ctx.fillStyle = '#2c1e12'; ctx.fillRect(px + 1, py + TS - 3, TS - 2, 1);
        if (hp < K.ENG.bridgeHp) { ctx.fillStyle = '#000'; ctx.fillRect(px + 2, py - 3, 12, 2); ctx.fillStyle = '#e0a040'; ctx.fillRect(px + 2, py - 3, Math.ceil(12 * hp / K.ENG.bridgeHp), 2); }
      }
    }
    if (w.eWork && w.eWork.size) {
      for (const [i, j] of w.eWork) {
        const x = i & NM, y = i >> NS;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const px = x * TS, py = y * TS, f = Math.min(1, j.prog);
        if (j.kind === 'fill') { ctx.fillStyle = 'rgba(120,90,50,0.85)'; ctx.beginPath(); ctx.arc(px + 8, py + 8, 2 + f * 6, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px, py + 3, Math.ceil(TS * f), TS - 6); ctx.fillStyle = '#87603a'; for (let k = 0; k < TS * f; k += 3) ctx.fillRect(px + k, py + 3, 1, TS - 6); }
      }
    }
    // explosives: planned (dashed), armed traps (hidden mound), lit charges (sparking fuse)
    if (w.charges && w.charges.size) {
      for (const [i, c] of w.charges) {
        const x = i & NM, y = i >> NS;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const px = x * TS, py = y * TS;
        if (c.state === 'planned') {
          ctx.fillStyle = c.kind === 'blast' ? 'rgba(255,140,40,0.28)' : 'rgba(220,60,40,0.25)';
          ctx.fillRect(px, py, TS, TS);
          const pr = c.prog || 0;
          if (pr) { ctx.fillStyle = 'rgba(60,30,20,0.8)'; ctx.fillRect(px + 2, py + TS - 4, (TS - 4) * Math.min(1, pr), 2); }
          ctx.strokeStyle = 'rgba(255,170,90,0.9)'; ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]); ctx.lineDashOffset = -time * 4;
          ctx.strokeRect(px + 0.5, py + 0.5, TS - 1, TS - 1);
          ctx.setLineDash([]); ctx.lineDashOffset = 0;
          ctx.fillStyle = 'rgba(40,30,25,0.7)'; ctx.fillRect(px + 6, py + 6, 4, 5);
        } else if (c.state === 'armed') {
          ctx.fillStyle = '#5a4630'; ctx.fillRect(px + 4, py + 9, 8, 3);
          ctx.fillStyle = '#7a6040'; ctx.fillRect(px + 5, py + 8, 6, 1);
          if (Math.sin(time * 5 + i) > 0.6) { ctx.fillStyle = '#ff4a3a'; ctx.fillRect(px + 7, py + 7, 2, 1); }
        } else {
          ctx.fillStyle = '#3a2a1c'; ctx.fillRect(px + 5, py + 6, 6, 7);
          ctx.fillStyle = '#6a4a2a'; ctx.fillRect(px + 5, py + 7, 6, 1); ctx.fillRect(px + 5, py + 11, 6, 1);
          ctx.fillStyle = '#c8b090'; ctx.fillRect(px + 8, py + 3, 1, 3);
          const fl = (time * 20) % 2 < 1;
          ctx.fillStyle = fl ? '#ffe070' : '#ff8a30'; ctx.fillRect(px + 7 + (fl ? 1 : 0), py + 2, 2, 2);
          ctx.font = 'bold 6px monospace'; ctx.fillStyle = '#ffd060'; ctx.fillText(Math.ceil(c.t), px + 11, py + 5);
        }
      }
    }
    // while surveying: shade the border where the keep can't go (its realm would run off the map)
    // and outline the realm that the hovered site would give you
    if (G.phase === 'place' && N > K.PLAY_N) {
      const b = (K.PLAY_N / 2 - 1) * TS, full = N * TS;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
      ctx.strokeRect(b, b, full - 2 * b, full - 2 * b);
      const gh = G.ui && G.ui.ghost && G.ui.ghost[0];
      if (gh && gh.type === 'keep' && K.realmFits(gh.x, gh.y)) {
        const rx = (gh.x + 1 - K.PLAY_N / 2) * TS, ry = (gh.y + 1 - K.PLAY_N / 2) * TS;
        ctx.strokeStyle = gh.ok ? 'rgba(244,203,78,0.85)' : 'rgba(255,90,70,0.7)'; ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, K.PLAY_N * TS, K.PLAY_N * TS);
        ctx.font = 'bold 10px monospace'; ctx.fillStyle = 'rgba(244,203,78,0.9)';
        ctx.fillText('your realm', rx + 6, ry + 14);
      }
      ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    // land shaping: outline shaped tiles and the hovered tile
    if (G.phase === 'place' && G.ui && G.ui.shapeArea) {
      const A = G.ui.shapeArea;
      ctx.fillStyle = A.mode === 'raise' ? 'rgba(140,220,100,0.45)' : 'rgba(240,180,80,0.45)';
      for (const p of A.ok) ctx.fillRect(p.x * TS, p.y * TS, TS, TS);
      ctx.fillStyle = 'rgba(255,80,60,0.35)';
      for (const p of A.over) ctx.fillRect(p.x * TS, p.y * TS, TS, TS);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.strokeRect(A.x0 * TS + 0.5, A.y0 * TS + 0.5, (A.x1 - A.x0 + 1) * TS - 1, (A.y1 - A.y0 + 1) * TS - 1);
    }
    if (G.phase === 'place' && G.shaped && (G.shaped.size || (G.ui && G.ui.shapeHover))) {
      ctx.strokeStyle = 'rgba(160,230,120,0.7)'; ctx.lineWidth = 1;
      for (const i of G.shaped.keys()) ctx.strokeRect((i & NM) * TS + 0.5, (i >> NS) * TS + 0.5, TS - 1, TS - 1);
      const h = G.ui.shapeHover;
      if (h) {
        ctx.fillStyle = h.st === 'raise' ? 'rgba(140,220,100,0.45)' : h.st === 'undo' ? 'rgba(240,180,80,0.45)' : 'rgba(255,80,60,0.3)';
        ctx.fillRect(h.x * TS, h.y * TS, TS, TS);
      }
    }
    // suggested keep site while choosing a location
    if (G.phase === 'place' && w.start) {
      const a = 0.4 + Math.sin(time * 3) * 0.25;
      ctx.strokeStyle = `rgba(244,203,78,${a})`;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect((w.start.x - 1) * TS + 0.5, (w.start.y - 1) * TS + 0.5, 3 * TS - 1, 3 * TS - 1);
      ctx.setLineDash([]);
      ctx.font = 'bold 7px monospace'; ctx.fillStyle = `rgba(244,203,78,${a + 0.3})`;
      ctx.fillText('suggested', (w.start.x - 1) * TS + 6, (w.start.y - 1) * TS - 3);
    }
    // enemy entry markers (always visible so the player can plan)
    for (const e of G.activeEntries) {
      const pulse = 0.5 + Math.sin(time * 4) * 0.5;
      const cx = e.x * TS + 8, cy = e.y * TS + 8;
      ctx.fillStyle = `rgba(220,40,30,${0.15 + pulse * 0.2})`;
      ctx.beginPath(); ctx.arc(cx, cy, 40 + pulse * 6, 0, Math.PI * 2); ctx.fill();
      // banner
      ctx.fillStyle = '#3a2614'; ctx.fillRect(cx - 1, cy - 26, 2, 26);
      ctx.fillStyle = '#c63b2f';
      for (let k = 0; k < 12; k++) ctx.fillRect(cx + 1 + k, cy - 26 + Math.round(Math.sin(time * 5 - k * 0.6)), 1, 9);
      ctx.fillStyle = '#ece6da'; ctx.fillRect(cx + 5, cy - 23, 3, 3);
      // arrow pointing inward
      const ang = e.side === 'N' ? Math.PI / 2 : e.side === 'S' ? -Math.PI / 2 : e.side === 'W' ? 0 : Math.PI;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
      ctx.fillStyle = `rgba(255,80,60,${0.6 + pulse * 0.4})`;
      const o = 14 + pulse * 6;
      ctx.beginPath(); ctx.moveTo(o + 10, 0); ctx.lineTo(o, -7); ctx.lineTo(o, 7); ctx.fill();
      ctx.restore();
    }
    // build ghost
    const ui = G.ui;
    if (ui && ui.ghost) {
      for (const gh of ui.ghost) {
        const d = K.SDEF[gh.type];
        if (gh.type === 'keep') {
          ctx.globalAlpha = 0.65;
          const img = K.SPR.keep;
          ctx.drawImage(img, Math.round(gh.x * TS + (3 * TS - img.width) / 2), gh.y * TS + 3 * TS - img.height);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = gh.ok ? '#8ef59c' : '#ff6b5e';
          ctx.setLineDash([2, 2]);
          ctx.strokeRect((gh.x + 1) * TS + 0.5, (gh.y + 3) * TS + 0.5, TS - 1, TS - 1);
          ctx.setLineDash([]);
        }
        ctx.fillStyle = gh.ok ? 'rgba(90,230,110,0.35)' : 'rgba(240,60,50,0.4)';
        const gw = gh.w || d.w, ghh = gh.h || d.h;
        ctx.fillRect(gh.x * TS, gh.y * TS, gw * TS, ghh * TS);
        ctx.strokeStyle = gh.ok ? '#8ef59c' : '#ff6b5e';
        ctx.lineWidth = 1;
        ctx.strokeRect(gh.x * TS + 0.5, gh.y * TS + 0.5, gw * TS - 1, ghh * TS - 1);
        if (d.range && gh === ui.ghost[0]) {
          const onWall = K.inb(gh.x, gh.y) && w.structAt(gh.x, gh.y) && w.structAt(gh.x, gh.y).type === 'wall';
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc((gh.x + d.w / 2) * TS, (gh.y + d.h / 2) * TS, (onWall ? K.rangeVs(d.range, K.WALL_LIFT, 0) : d.range) * TS, 0, Math.PI * 2); ctx.stroke();
          if (d.minRange) minRing((gh.x + d.w / 2) * TS, (gh.y + d.h / 2) * TS, d.minRange);
          ctx.setLineDash([]);
        }
      }
    }
    if (ui && ui.selUnit && !ui.selUnit.dead) {
      // show available battlements and this archer's post
      const su = ui.selUnit;
      ctx.lineWidth = 1;
      for (const s of w.structs.values()) {
        if (s.type !== 'wall' || !s.battlement) continue;
        const mine = s.id === su.post;
        if (!mine && Math.abs(s.x - su.x) > 40) continue;
        ctx.strokeStyle = mine ? '#7dff8a' : 'rgba(125,255,138,0.28)';
        ctx.strokeRect(s.x * TS + 0.5, s.y * TS + 0.5, TS - 1, TS - 1);
      }
    }
    if (ui && ui.sel && ui.sel.length) {
      // attack-order markers
      const seen = new Set();
      for (const u of ui.sel) {
        if (!u.order || u.dead) continue;
        const k = u.order.x + ',' + u.order.y;
        if (seen.has(k)) continue;
        seen.add(k);
        const cx = (u.order.x + 0.5) * TS, cy = (u.order.y + 0.5) * TS;
        ctx.strokeStyle = 'rgba(255,90,70,0.85)'; ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,90,70,0.35)';
        ctx.beginPath(); ctx.arc(cx, cy, 6 * TS, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,90,70,0.9)';
        ctx.beginPath(); ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4); ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4); ctx.stroke();
      }
    }
    if (ui && ui.orderMark) {
      const a = (performance.now() - ui.orderMark.t) / 600;
      if (a >= 1) ui.orderMark = null;
      else {
        ctx.strokeStyle = `rgba(255,90,70,${1 - a})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc((ui.orderMark.x + 0.5) * TS, (ui.orderMark.y + 0.5) * TS, 4 + a * 14, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (ui && ui.selected && w.structs.has(ui.selected.id)) {
      const s = ui.selected;
      ctx.strokeStyle = '#f4cb4e';
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x * TS - 0.5, s.y * TS - 0.5, s.w * TS + 1, s.h * TS + 1);
      const eh = K.engineHost(w, s), es = eh || s;
      const d = eh ? K.SDEF[eh.engine ? eh.engine.type : eh.upg.engine] : K.SDEF[s.type];
      if (d.range) {
        const ex = (es.x + d.w / 2) * TS, ey = (es.y + d.h / 2) * TS;
        ctx.strokeStyle = 'rgba(244,203,78,0.5)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(ex, ey, (eh ? K.rangeVs(d.range, K.WALL_LIFT, 0) : d.range) * TS, 0, Math.PI * 2); ctx.stroke();
        if (d.minRange) minRing(ex, ey, d.minRange);
        ctx.setLineDash([]);
      }
    }
    // highlight the castle interior when the player toggles the view
    if (ui && ui.showInterior) {
      const o = w.computeOutside();
      ctx.fillStyle = 'rgba(80,160,255,0.22)';
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = K.idx(x, y);
          if (!o[i] && w.terrain[i] !== T.MOUNTAIN && !w.sgrid[i]) ctx.fillRect(x * TS, y * TS, TS, TS);
        }
    }
  }

  // dead zone inside a siege engine's minimum range
  function minRing(cx, cy, r) {
    const ctx = R.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(240,70,50,0.10)';
    ctx.strokeStyle = 'rgba(255,110,90,0.7)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.arc(cx, cy, r * TS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ---------------- minimap ----------------
  const MCOL = {};
  MCOL[T.GRASS] = [96, 150, 62]; MCOL[T.FOREST] = [40, 92, 38]; MCOL[T.ROCK] = [150, 146, 136]; MCOL[T.LAKE] = [44, 96, 150];
  MCOL[T.RIVER] = [62, 126, 174]; MCOL[T.MOUNTAIN] = [128, 116, 104]; MCOL[T.MINE] = [190, 110, 50]; MCOL[T.SAND] = [214, 196, 138];
  MCOL[T.DIRT] = [138, 106, 68]; MCOL[T.TRENCH] = [92, 68, 44]; MCOL[T.MOAT] = [58, 116, 162];

  R.drawMinimap = function (G, time) {
    const w = R.world, mc = R.miniCtx;
    R.miniT++;
    if (R.miniVer !== w.version && (R.miniVer < 0 || R.miniT % 15 === 0)) {
      R.miniVer = w.version;
      const d = R.miniImg.data;
      for (let i = 0; i < N * N; i++) {
        let c = MCOL[w.terrain[i] === T.MOAT && w.moatSrc && w.moatSrc[i] ? w.moatSrc[i] : w.terrain[i]];
        let f = 1;
        if (!K.isWater(w.terrain[i]) && w.terrain[i] !== T.MOUNTAIN) f = 0.9 + w.elev[i] * 0.06;
        if (w.terrain[i] === T.MOUNTAIN) f = 0.8 + w.h[i] * 0.3;
        if (w.sgrid[i]) {
          const s = w.structs.get(w.sgrid[i]);
          c = s.type === 'wall' || s.type === 'keep' ? [230, 226, 214] : s.type === 'farm' ? [200, 170, 80] : [170, 120, 70];
          f = 1;
        }
        d[i * 4] = Math.min(255, c[0] * f); d[i * 4 + 1] = Math.min(255, c[1] * f); d[i * 4 + 2] = Math.min(255, c[2] * f); d[i * 4 + 3] = 255;
      }
    }
    mc.putImageData(R.miniImg, 0, 0);
    for (const u of G.units) {
      if (u.hidden || u.dead || u.team === 1) continue;
      mc.fillStyle = u.kind === 'king' ? '#f4cb4e' : u.team ? '#ff3a2a' : '#7fb0ff';
      mc.fillRect(Math.floor(u.x) - (u.kind === 'king' ? 1 : 0), Math.floor(u.y) - (u.kind === 'king' ? 1 : 0), u.kind === 'king' ? 3 : 2, u.kind === 'king' ? 3 : 2);
    }
    for (const m of G.monsters) { mc.fillStyle = m.kind === 'croc' ? '#b6d84a' : '#c070ff'; mc.fillRect(Math.floor(m.x) - 1, Math.floor(m.y) - 1, 3, 3); }
    for (const b of G.beasts || []) {
      if (b.dead) continue;
      const r = b.young ? 1 : 2;
      mc.fillStyle = '#000'; mc.fillRect(Math.floor(b.x) - r, Math.floor(b.y) - r, r * 2 + 1, r * 2 + 1);
      mc.fillStyle = { spider: '#e04cff', troll: '#9adf5a', wolf: '#c8c8d4', wyvern: '#ff8a3a' }[b.kind]; mc.fillRect(Math.floor(b.x) - r + 1, Math.floor(b.y) - r + 1, r * 2 - 1, r * 2 - 1);
    }
    // mine sites (gold = open site, orange = built mine)
    for (const [mx, my] of w.mines || []) {
      const s = w.structAt(mx, my), built = s && s.type === 'mine';
      mc.fillStyle = '#1a120a'; mc.fillRect(mx - 2, my - 2, 6, 6);
      mc.fillStyle = built ? '#ff7a1a' : '#ffd23a'; mc.fillRect(mx - 1, my - 1, 4, 4);
      mc.fillStyle = built ? '#ffe0b0' : '#fff6c0'; mc.fillRect(mx, my - 1, 1, 1);
    }
    // enemy army on top: bold outlined red dots, siege engines larger
    const ep = 0.75 + 0.25 * Math.sin(time * 6);
    for (const u of G.units) {
      if (u.dead || u.hidden || u.team !== 1) continue;
      const st = K.unitStats(u), big = st && st.big;
      const r = big ? 2 : 1, x = Math.floor(u.x), y = Math.floor(u.y);
      mc.fillStyle = '#200000'; mc.fillRect(x - r - 1, y - r - 1, 2 * r + 3, 2 * r + 3);
      mc.fillStyle = `rgba(255,${Math.round(50 * ep)},${Math.round(30 * ep)},1)`; mc.fillRect(x - r, y - r, 2 * r + 1, 2 * r + 1);
    }
    if (G.phase === 'place' && N > K.PLAY_N) {
      const b = K.PLAY_N / 2 - 1;
      mc.strokeStyle = 'rgba(255,255,255,0.9)'; mc.lineWidth = Math.max(1, N / 256); mc.setLineDash([N / 64, N / 96]);
      mc.strokeRect(b, b, N - 2 * b, N - 2 * b);
      mc.setLineDash([]);
      const gh = G.ui && G.ui.ghost && G.ui.ghost[0];
      if (gh && gh.type === 'keep' && K.realmFits(gh.x, gh.y)) {
        mc.strokeStyle = 'rgba(244,203,78,0.9)'; mc.lineWidth = 2;
        mc.strokeRect(gh.x + 1 - K.PLAY_N / 2, gh.y + 1 - K.PLAY_N / 2, K.PLAY_N, K.PLAY_N);
      }
    }
    if (G.phase === 'place' && w.start) {
      mc.strokeStyle = '#f4cb4e'; mc.lineWidth = 1;
      mc.strokeRect(w.start.x - 3.5, w.start.y - 3.5, 7, 7);
    }
    const pulse = 0.5 + Math.sin(time * 5) * 0.5;
    const tgt = w.keep ? { x: w.keep.x + 1.5, y: w.keep.y + 1.5 } : { x: N / 2, y: N / 2 };
    for (const e of G.activeEntries) {
      const ang = e.side === 'N' ? Math.PI / 2 : e.side === 'S' ? -Math.PI / 2 : e.side === 'W' ? 0 : Math.PI;
      const ex = K.clamp(e.x + 0.5, 3, N - 3), ey = K.clamp(e.y + 0.5, 3, N - 3);
      // dashed line of approach toward the keep
      mc.strokeStyle = `rgba(255,70,50,${0.35 + pulse * 0.3})`;
      mc.lineWidth = 1.5;
      mc.setLineDash([4, 4]); mc.lineDashOffset = -time * 12;
      mc.beginPath(); mc.moveTo(ex, ey); mc.lineTo(ex + (tgt.x - ex) * 0.45, ey + (tgt.y - ey) * 0.45); mc.stroke();
      mc.setLineDash([]); mc.lineDashOffset = 0;
      // glow
      mc.fillStyle = `rgba(255,40,30,${0.18 + pulse * 0.22})`;
      mc.beginPath(); mc.arc(ex, ey, 14 + pulse * 4, 0, Math.PI * 2); mc.fill();
      // big inward arrow
      mc.save(); mc.translate(ex, ey); mc.rotate(ang);
      const o = 1 + pulse * 3;
      mc.beginPath(); mc.moveTo(o + 18, 0); mc.lineTo(o + 4, -10); mc.lineTo(o + 4, -4); mc.lineTo(o - 4, -4); mc.lineTo(o - 4, 4); mc.lineTo(o + 4, 4); mc.lineTo(o + 4, 10); mc.closePath();
      mc.fillStyle = '#ff2f1f'; mc.fill();
      mc.lineWidth = 1.5; mc.strokeStyle = '#fff'; mc.stroke();
      mc.restore();
    }
    const cam = R.cam;
    mc.strokeStyle = '#fff';
    mc.lineWidth = 1;
    mc.strokeRect(cam.x / TS + 0.5, cam.y / TS + 0.5, R.canvas.width / cam.zoom / TS, R.canvas.height / cam.zoom / TS);
  };
})();

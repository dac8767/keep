'use strict';
// World state: terrain + structures, placement rules, passability, pathfinding,
// enemy flow fields, castle enclosure and trench flooding.
(function () {
  const T = K.T;
  let N, NM, NS;
  K.onSize(() => { N = K.N; NM = N - 1; NS = Math.log2(N); });

  class World {
    constructor(gen) {
      Object.assign(this, gen);
      this.sgrid = new Int32Array(N * N);
      this.structs = new Map();
      this.nextId = 1;
      this.ladder = new Uint8Array(N * N);
      this.tower = new Uint8Array(N * N);
      this.stump = new Uint8Array(N * N);
      this.plan = new Set();
      this.fillPlan = new Set();
      this.charges = new Map();
      this.ladderHp = new Map();
      this.ebridge = new Uint8Array(N * N); // enemy covered bridges over water
      this.ebridgeHp = new Map();
      this.eWork = new Map(); // tile -> { prog, kind } for engineers' work in progress
      this.dirty = new Set();
      this.version = 1;
      this.outside = new Uint8Array(N * N);
      this.outsideVer = -1;
      this.fields = {};
      this.fieldKey = '';
      this.astarG = new Float32Array(N * N);
      this.astarFrom = new Int32Array(N * N);
      this.astarStamp = new Uint32Array(N * N);
      this.astarClosed = new Uint32Array(N * N);
      this.stampN = 1;
      this.shoreRisk = new Uint8Array(N * N); // shoreline a tentacle monster can reach: friendly paths avoid it
    }

    t(x, y) { return this.terrain[K.idx(x, y)]; }
    structAt(x, y) { if (!K.inb(x, y)) return null; const id = this.sgrid[K.idx(x, y)]; return id ? this.structs.get(id) : null; }
    touch(x, y) { this.dirty.add((y >> 5) * (N >> 5) + (x >> 5)); }
    bump() { this.version++; }

    setTerrain(i, t) {
      if (this.terrain[i] === t) return;
      this.terrain[i] = t;
      this.touch(i & NM, i >> NS);
      this.bump();
    }

    // ---------- placement ----------
    canPlace(type, x, y, game, rot) {
      const d = Object.assign({}, K.SDEF[type], K.dims(type, rot));
      // catapults and trebuchets can be hauled up onto finished battlements
      if ((type === 'catapult' || type === 'trebuchet') && this.structAt(x, y)) {
        const s0 = this.structAt(x, y);
        if (s0.type !== 'wall' && !(s0.type === 'site' && s0.final === 'wall')) return { ok: false, reason: 'Something is already built here' };
        for (let dy = 0; dy < d.h; dy++)
          for (let dx = 0; dx < d.w; dx++) {
            const s = K.inb(x + dx, y + dy) ? this.structAt(x + dx, y + dy) : null;
            if (!s || s.type !== 'wall') return { ok: false, reason: d.w > 1 ? 'A trebuchet needs a 2×2 block of walls with battlements' : 'Finish the wall first' };
            if (!s.battlement) return { ok: false, reason: 'Siege engines on walls need finished battlements' };
            if (s.upg || s.engine || s.engPart) return { ok: false, reason: 'This battlement is already in use' };
          }
        return { ok: true, mount: true };
      }
      if (type === 'battlement') {
        const s = this.structAt(x, y);
        const wallSite = s && s.type === 'site' && s.final === 'wall';
        if (!s || (s.type !== 'wall' && !wallSite)) return { ok: false, reason: 'Battlements go on top of stone walls' };
        if (s.battlement || s.upg || s.battle) return { ok: false, reason: 'Already has battlements' };
        return { ok: true };
      }
      if (type === 'fill') {
        if (!K.inb(x, y)) return { ok: false, reason: 'Out of bounds' };
        const t = this.t(x, y);
        if (this.structAt(x, y)) return { ok: false, reason: 'Something is built here' };
        if (!K.isWater(t) && t !== T.TRENCH) return { ok: false, reason: 'Only trenches and water can be filled' };
        if (this.plan.has(K.idx(x, y))) return { ok: false, reason: 'Already marked' };
        return { ok: true };
      }
      if (type === 'charge') {
        if (!K.inb(x, y) || x < 1 || y < 1 || x > N - 2 || y > N - 2) return { ok: false, reason: 'Out of bounds' };
        const t = this.t(x, y), i = K.idx(x, y);
        if (game && !K.hasStruct(game, 'explosives')) return { ok: false, reason: 'Build Explosives Research first' };
        if (this.charges.has(i)) return { ok: false, reason: 'Explosives already placed here' };
        if (this.sgrid[i]) return { ok: false, reason: 'Something is built here' };
        if (t === T.MINE) return { ok: false, reason: 'Blasting would ruin the mine' };
        if (K.isWater(t) || t === T.TRENCH) return { ok: false, reason: 'The powder would get wet' };
        if (this.plan.has(i)) return { ok: false, reason: 'Marked for digging' };
        if (t === T.MOUNTAIN || t === T.ROCK) {
          if (this.nearKeep(x, y, 2)) return { ok: false, reason: 'Too close to the keep' };
          return { ok: true, kind: 'blast' };
        }
        if (this.nearKeep(x, y, 1)) return { ok: false, reason: 'Too close to the keep' };
        return { ok: true, kind: 'trap' };
      }
      if (type === 'trench') {
        if (!K.inb(x, y)) return { ok: false, reason: 'Out of bounds' };
        const t = this.t(x, y);
        if (this.structAt(x, y)) return { ok: false, reason: 'Something is built here' };
        if (t === T.MOUNTAIN || t === T.MINE) return { ok: false, reason: 'Too rocky to dig' };
        if (K.isWater(t) || t === T.TRENCH) return { ok: false, reason: 'Already dug' };
        if (t === T.ROCK) return { ok: false, reason: 'Solid rock — cannot dig' };
        if (this.plan.has(K.idx(x, y))) return { ok: false, reason: 'Already marked for digging' };
        if (this.nearKeep(x, y, 1)) return { ok: false, reason: 'Too close to the keep' };
        return { ok: true };
      }
      const replace = [];
      let mineN = 0, rockN = 0;
      const e0 = K.inb(x, y) ? this.elev[K.idx(x, y)] : 0;
      for (let dy = 0; dy < d.h; dy++)
        for (let dx = 0; dx < d.w; dx++) {
          const tx = x + dx, ty = y + dy;
          if (!K.inb(tx, ty) || tx < 1 || ty < 1 || tx > N - 2 || ty > N - 2) return { ok: false, reason: 'Out of bounds' };
          const i = K.idx(tx, ty), t = this.terrain[i];
          if (this.sgrid[i]) {
            const s = this.structs.get(this.sgrid[i]);
            // gates can be cut into existing wall sections
            if (K.isGate(type) && (s.type === 'wall' || (s.type === 'site' && s.final === 'wall'))) { if (!replace.includes(s)) replace.push(s); continue; }
            return { ok: false, reason: 'Something is already built here' };
          }
          if (t === T.MOUNTAIN) return { ok: false, reason: 'Cannot build on mountains' };
          if (this.nearKeep(tx, ty, 0)) return { ok: false, reason: 'That is the throne room' };
          if (Math.abs(this.elev[i] - e0) > 1) return { ok: false, reason: 'Ground is too uneven' };
          if (d.rule === 'water') {
            if (type === 'drawbridge' && !K.isWater(t) && t !== T.TRENCH) {
              // on dry land the drawbridge comes with its own trench dug beneath it
              if (t === T.ROCK || t === T.MINE) return { ok: false, reason: 'Too rocky to dig a trench here' };
              if (this.nearKeep(tx, ty, 1)) return { ok: false, reason: 'Too close to the keep' };
              continue;
            }
            if (!K.isWater(t) && t !== T.TRENCH) return { ok: false, reason: 'Must be built over water' };
            continue;
          }
          if (K.isWater(t)) return { ok: false, reason: 'Cannot build on water' };
          if (t === T.TRENCH) return { ok: false, reason: 'Cannot build in a trench' };
          if (t === T.MINE) mineN++;
          if (t === T.ROCK) rockN++;
          if (d.rule === 'grass' && t !== T.GRASS && t !== T.FOREST && t !== T.DIRT) return { ok: false, reason: 'Farms need grassland' };
          if (!d.rule && (t === T.MINE)) return { ok: false, reason: 'Save mine sites for mines' };
        }
      if (d.rule === 'river' && !this.millRiver(x, y, d)) return { ok: false, reason: 'Must be built beside a flowing river' };
      if (d.rule === 'mine' && mineN < 3) return { ok: false, reason: 'Must be built on a mountain mine site' };
      if (d.rule === 'rock' && rockN < 2) return { ok: false, reason: 'Must be built on a rock patch' };
      if (type !== 'bridge' && type !== 'drawbridge' && type !== 'farm' && this.blocksUnits(x, y, d)) return { ok: false, reason: 'Units are in the way' };
      if (game && game.beastBlocks && game.beastBlocks(x, y, d.w, d.h)) return { ok: false, reason: 'A beast is lurking right there' };
      if (type === 'drawbridge' && !this.dbGroupOk(x, y)) return { ok: false, reason: 'Drawbridges can be at most 2 wide × 3 long' };
      return { ok: true, replace: replace.length ? replace : null };
    }

    // Connected drawbridge sections (4-adjacent) form one bridge.
    dbGroup(s) {
      const out = [s], seen = new Set([s.id]);
      for (let k = 0; k < out.length; k++)
        for (const [dx, dy] of K.DIRS4) {
          const n = this.structAt(out[k].x + dx, out[k].y + dy);
          if (n && n.type === 'drawbridge' && !seen.has(n.id)) { seen.add(n.id); out.push(n); }
        }
      return out;
    }
    // Bounding box of a drawbridge group.
    dbBox(grp) {
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (const s of grp) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y); }
      return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
    // Would a drawbridge at (x,y) (plus pending tiles from the same drag) keep its bridge within 2 wide x 3 long?
    dbGroupOk(x, y, pending) {
      const has = (i) => { if (pending && pending.has(i)) return true; const s = this.sgrid[i] && this.structs.get(this.sgrid[i]); return !!s && (s.type === 'drawbridge' || (s.type === 'site' && s.final === 'drawbridge')); };
      const q = [K.idx(x, y)], seen = new Set(q);
      let x0 = x, x1 = x, y0 = y, y1 = y;
      for (let k = 0; k < q.length; k++) {
        const cx = q[k] & NM, cy = q[k] >> NS;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        if (Math.min(bw, bh) > 2 || Math.max(bw, bh) > 3) return false;
        for (const [dx, dy] of K.DIRS4) {
          if (!K.inb(cx + dx, cy + dy)) continue;
          const j = K.idx(cx + dx, cy + dy);
          if (!seen.has(j) && has(j)) { seen.add(j); q.push(j); }
        }
      }
      return true;
    }
    nearKeep(x, y, pad) {
      const k = this.keep;
      if (!k) return false;
      return x >= k.x - pad && x < k.x + 3 + pad && y >= k.y - pad && y < k.y + 3 + pad;
    }
    blocksUnits() { return false; }

    place(type, x, y, opts) {
      const d = K.SDEF[type];
      const s = { id: this.nextId++, type, x, y, w: d.w, h: d.h, hp: d.hp, maxHp: d.hp, workers: new Set(), reload: 0, raised: false, battlement: false, built: 1 };
      if (opts) Object.assign(s, opts);
      this.structs.set(s.id, s);
      for (let dy = 0; dy < s.h; dy++)
        for (let dx = 0; dx < s.w; dx++) {
          const i = K.idx(x + dx, y + dy);
          this.sgrid[i] = s.id;
          this.plan.delete(i); this.fillPlan.delete(i);
          if (this.terrain[i] === T.FOREST) this.terrain[i] = T.GRASS;
          this.touch(x + dx, y + dy);
        }
      if (type === 'keep') this.keep = s;
      this.bump();
      return s;
    }

    remove(s) {
      if (!this.structs.has(s.id)) return;
      this.structs.delete(s.id);
      for (let dy = 0; dy < s.h; dy++)
        for (let dx = 0; dx < s.w; dx++) {
          const i = K.idx(s.x + dx, s.y + dy);
          if (this.sgrid[i] === s.id) this.sgrid[i] = 0;
          this.ladder[i] = 0; this.tower[i] = 0; this.ladderHp.delete(i);
          this.touch(s.x + dx, s.y + dy);
        }
      this.bump();
    }

    // ---------- passability ----------
    // Friendly units: can they stand on tile i? (opts.lowered treats drawbridges as down)
    // Construction sites are open scaffolding, but the exit check (lowered) judges them as finished.
    fPass(i, lowered) {
      const t = this.terrain[i];
      if (t === T.MOUNTAIN) return false;
      const sid = this.sgrid[i];
      if (sid) {
        const s = this.structs.get(sid);
        let type = s.type;
        if (type === 'site') { if (!lowered) return !K.isWater(t); type = s.final; }
        switch (type) {
          case 'gate': case 'irongate': case 'keepdoor': case 'bridge': case 'farm': return true;
          case 'drawbridge': return lowered || !s.raised;
          default: return false;
        }
      }
      return !K.isWater(t);
    }
    fCost(i) {
      const t = this.terrain[i];
      return t === T.FOREST ? 1.8 : t === T.TRENCH ? 2.5 : t === T.ROCK ? 1.3 : 1;
    }

    // The river tile beside a footprint that turns a water wheel (prefers the middle of a side), or null.
    millRiver(x, y, d) {
      d = d || { w: 2, h: 2 };
      let best = null, bs = -1;
      const side = (tx, ty, nx, ny) => {
        if (!K.inb(tx, ty)) return;
        const i = K.idx(tx, ty);
        if (this.terrain[i] !== T.RIVER || this.sgrid[i]) return;
        const f = this.flow ? this.flow[i] : 0;
        const [fx, fy] = f ? K.DIRS4[f - 1] : [0, 0];
        // the wheel needs current running along the bank, not straight into it
        const along = nx ? Math.abs(fy) : Math.abs(fx);
        const sc = (f ? 2 : 1) + along * 2;
        if (sc > bs) { bs = sc; best = { i, x: tx, y: ty, nx, ny, fx, fy }; }
      };
      for (let k = 0; k < d.w; k++) { side(x + k, y - 1, 0, -1); side(x + k, y + d.h, 0, 1); }
      for (let k = 0; k < d.h; k++) { side(x - 1, y + k, -1, 0); side(x + d.w, y + k, 1, 0); }
      return best;
    }

    // A diagonal step may not squeeze between two blockers, except along a bridge laid diagonally over
    // open water: then the corner tiles only need to be bare water.
    isSpan(i) {
      const sid = this.sgrid[i];
      if (sid) { const s = this.structs.get(sid), t = s.type === 'site' ? s.final : s.type; return t === 'bridge' || t === 'drawbridge'; }
      return !!this.ebridge[i] && K.isWater(this.terrain[i]);
    }
    diagOk(i, j, a, b, blocks) {
      if (!blocks(a) && !blocks(b)) return true;
      if (!this.isSpan(i) && !this.isSpan(j)) return false;
      const wet = (k) => !this.sgrid[k] && !this.ebridge[k] && K.isWater(this.terrain[k]);
      return (!blocks(a) || wet(a)) && (!blocks(b) || wet(b));
    }

    // Is there a walkable path from the keep to the map edge?
    hasExit(override) {
      const k = this.keep;
      if (!k) return true;
      const pass = (i) => (override && override.has(i) ? override.get(i) : this.fPass(i, true));
      const seen = new Uint8Array(N * N);
      const q = [];
      for (let y = k.y - 1; y <= k.y + 3; y++)
        for (let x = k.x - 1; x <= k.x + 3; x++) {
          const i = K.idx(x, y);
          if (this.sgrid[i] === k.id || !pass(i)) continue;
          seen[i] = 1; q.push(i);
        }
      while (q.length) {
        const i = q.pop(), x = i & NM, y = i >> NS;
        if (x === 0 || y === 0 || x === N - 1 || y === N - 1) return true;
        for (const [dx, dy] of K.DIRS8) {
          const j = K.idx(x + dx, y + dy);
          if (seen[j] || !pass(j)) continue;
          if (dx && dy && !this.diagOk(i, j, K.idx(x + dx, y), K.idx(x, y + dy), (k) => !pass(k))) continue;
          seen[j] = 1; q.push(j);
        }
      }
      return false;
    }

    // Trench tiles that would hold water if `extra` trench tiles were dug.
    floodSet(extra) {
      const isTrench = (i) => this.terrain[i] === T.TRENCH || (extra && extra.has(i));
      const out = new Set();
      const q = [];
      for (let i = 0; i < N * N; i++) {
        if (!isTrench(i)) continue;
        const x = i & NM, y = i >> NS;
        for (const [dx, dy] of K.DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (K.inb(nx, ny) && K.isWater(this.terrain[K.idx(nx, ny)])) { out.add(i); q.push(i); break; }
        }
      }
      while (q.length) {
        const i = q.pop(), x = i & NM, y = i >> NS;
        for (const [dx, dy] of K.DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (!K.inb(nx, ny)) continue;
          const j = K.idx(nx, ny);
          if (!out.has(j) && isTrench(j)) { out.add(j); q.push(j); }
        }
      }
      return out;
    }
    flood() {
      const f = this.floodSet();
      for (const i of f) { this.terrain[i] = T.MOAT; this.touch(i & NM, i >> NS); }
      if (f.size) this.bump();
      return f.size;
    }

    // ---------- enclosure ----------
    // outside[i] = reachable from the map edge without passing walls, gates or drawbridges.
    computeOutside() {
      if (this.outsideVer === this.version) return this.outside;
      this.outsideVer = this.version;
      const o = this.outside;
      o.fill(0);
      const q = [];
      const open = (i) => {
        if (this.terrain[i] === T.MOUNTAIN) return false;
        const sid = this.sgrid[i];
        if (!sid) return true;
        const s = this.structs.get(sid);
        return s.type === 'bridge' || s.type === 'site' || !!K.SDEF[s.type].eco;
      };
      for (let k = 0; k < N; k++)
        for (const i of [K.idx(k, 0), K.idx(k, N - 1), K.idx(0, k), K.idx(N - 1, k)])
          if (!o[i] && open(i)) { o[i] = 1; q.push(i); }
      while (q.length) {
        const i = q.pop(), x = i & NM, y = i >> NS;
        for (const [dx, dy] of K.DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (!K.inb(nx, ny)) continue;
          const j = K.idx(nx, ny);
          if (!o[j] && open(j)) { o[j] = 1; q.push(j); }
        }
      }
      return o;
    }
    isEnclosed() {
      const k = this.keep;
      if (!k) return false;
      const o = this.computeOutside();
      return !o[K.idx(k.x + 1, k.y + 3)];
    }

    // ---------- enemies ----------
    eCost(cls, i) {
      const t = this.terrain[i];
      if (t === T.MOUNTAIN) return Infinity;
      const sid = this.sgrid[i];
      if (sid && this.structs.get(sid).type !== 'site') {
        const s = this.structs.get(sid);
        switch (s.type) {
          case 'wall':
            if (this.tower[i] || (this.ladder[i] && cls !== 'horse')) return 3;
            return cls === 'ladder' ? 10 : 260;
          case 'gate': return 28;
          case 'irongate': return 60;
          case 'drawbridge': return s.raised ? 400 : 1;
          case 'bridge': return 1;
          case 'farm': return 1.4;
          case 'quarry': case 'mine': case 'bloomery': case 'lumbermill': return 2.5;
          case 'keep': return 500;
          default: return 22;
        }
      }
      // Foot soldiers cannot wade: any land detour, however long, beats water. Water keeps a finite cost
      // so a castle ringed by a moat still draws them to its banks.
      if (K.isWater(t)) return this.ebridge[i] ? 1.5 : cls === 'boat' ? 2 : 20000;
      return t === T.FOREST ? 1.8 : t === T.TRENCH ? 3 : t === T.ROCK ? 1.4 : 1;
    }
    // 0 = walkable, 1 = breakable obstacle, 2 = blocked
    eCan(cls, i) {
      const t = this.terrain[i];
      if (t === T.MOUNTAIN) return 2;
      const sid = this.sgrid[i];
      if (sid && this.structs.get(sid).type !== 'site') {
        const s = this.structs.get(sid);
        switch (s.type) {
          case 'wall': return this.tower[i] || (this.ladder[i] && cls !== 'horse') ? 0 : 2;
          case 'bridge': case 'farm': case 'quarry': case 'mine': case 'bloomery': case 'lumbermill': return 0;
          case 'drawbridge': return s.raised ? 2 : 0;
          case 'keep': return 2;
          default: return 1;
        }
      }
      if (K.isWater(t)) return cls === 'boat' || this.ebridge[i] ? 0 : 2;
      return 0;
    }
    field(cls, tx, ty) {
      const key = this.version + ':' + tx + ',' + ty;
      if (this.fields[cls] && this.fields[cls].key === key) return this.fields[cls].d;
      let f = this.fields[cls];
      if (!f) f = this.fields[cls] = { d: new Float32Array(N * N), key: '' };
      f.key = key;
      const d = f.d;
      d.fill(Infinity);
      const heap = new K.Heap();
      const s = K.idx(tx, ty);
      d[s] = 0;
      heap.push(0, s);
      while (heap.size) {
        const i = heap.pop();
        const x = i & NM, y = i >> NS, di = d[i];
        for (const [dx, dy, len] of K.DIRS8) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const j = ny * N + nx;
          if (dx && dy) {
            // no diagonal squeezing between blockers
            if (!this.diagOk(i, j, y * N + nx, ny * N + x, (k) => this.eCost(cls, k) > 5)) continue;
          }
          // d[j] = cost of stepping onto j and walking on from there, so a cheap tile next to a river
          // never hides the price of the water itself
          const cj = this.eCost(cls, j);
          if (cj === Infinity) continue;
          const nd = di + cj * len;
          if (nd < d[j]) { d[j] = nd; heap.push(nd, j); }
        }
      }
      return d;
    }

    // ---------- friendly A* ----------
    astar(sx, sy, goal, hx, hy, maxNodes) {
      const g = this.astarG, from = this.astarFrom, stamp = this.astarStamp, closed = this.astarClosed;
      const sN = ++this.stampN;
      const s = K.idx(sx, sy);
      const heap = new K.Heap();
      stamp[s] = sN; g[s] = 0; from[s] = -1;
      heap.push(0, s);
      let n = 0, bestI = -1;
      while (heap.size) {
        const i = heap.pop();
        if (closed[i] === sN) continue;
        closed[i] = sN;
        if (goal(i)) { bestI = i; break; }
        if (++n > (maxNodes || 30000)) break;
        const x = i & NM, y = i >> NS;
        for (const [dx, dy, len] of K.DIRS8) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const j = ny * N + nx;
          if (closed[j] === sN || !this.fPass(j)) continue;
          if (dx && dy && !this.diagOk(i, j, y * N + nx, ny * N + x, (k) => !this.fPass(k))) continue;
          const ng = g[i] + this.fCost(j) * len + (this.shoreRisk[j] ? 14 : 0);
          if (stamp[j] !== sN || ng < g[j]) {
            stamp[j] = sN; g[j] = ng; from[j] = i;
            heap.push(ng + Math.hypot(nx - hx, ny - hy), j);
          }
        }
      }
      if (bestI < 0) return null;
      const path = [];
      for (let i = bestI; i !== s && i >= 0; i = from[i]) path.push(i);
      path.reverse();
      return path;
    }
  }

  K.World = World;
})();

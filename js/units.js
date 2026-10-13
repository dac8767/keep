'use strict';
// Unit simulation: movement, friendly AI (jobs, recall, soldiers), combat helpers.
(function () {
  const T = K.T;
  let N, NM, NS;
  K.onSize(() => { N = K.N; NM = N - 1; NS = Math.log2(N); });
  const B = 8, BW = N / B; // spatial buckets of 8x8 tiles

  // ---------- spatial grid ----------
  function buildGrid(G) {
    const g = G.grid || (G.grid = Array.from({ length: BW * BW }, () => []));
    for (const b of g) b.length = 0;
    for (const u of G.units) {
      if (u.dead || u.hidden) continue;
      const bx = K.clamp(Math.floor(u.x / B), 0, BW - 1), by = K.clamp(Math.floor(u.y / B), 0, BW - 1);
      g[by * BW + bx].push(u);
    }
  }
  // nearest unit of team `team` within r of (x,y) passing filter
  K.nearest = function (G, x, y, r, team, filter) {
    let best = null, bd = r;
    const bx0 = K.clamp(Math.floor((x - r) / B), 0, BW - 1), bx1 = K.clamp(Math.floor((x + r) / B), 0, BW - 1);
    const by0 = K.clamp(Math.floor((y - r) / B), 0, BW - 1), by1 = K.clamp(Math.floor((y + r) / B), 0, BW - 1);
    for (let by = by0; by <= by1; by++)
      for (let bx = bx0; bx <= bx1; bx++)
        for (const v of G.grid[by * BW + bx]) {
          if (v.team !== team || v.dead || v.hidden) continue;
          const d = Math.hypot(v.x - x, v.y - y);
          if (d < bd && (!filter || filter(v, d))) { bd = d; best = v; }
        }
    return best;
  };
  K.around = function (G, x, y, r, fn) {
    const bx0 = K.clamp(Math.floor((x - r) / B), 0, BW - 1), bx1 = K.clamp(Math.floor((x + r) / B), 0, BW - 1);
    const by0 = K.clamp(Math.floor((y - r) / B), 0, BW - 1), by1 = K.clamp(Math.floor((y + r) / B), 0, BW - 1);
    for (let by = by0; by <= by1; by++)
      for (let bx = bx0; bx <= bx1; bx++)
        for (const v of G.grid[by * BW + bx]) if (!v.dead && !v.hidden && Math.hypot(v.x - x, v.y - y) <= r) fn(v);
  };

  // ---------- combat ----------
  K.damage = function (G, u, dmg, ranged) {
    if (u.dead || u.hidden || (G.god && u.team === 0)) return;
    const st = K.unitStats(u);
    let d = dmg * (1 - (st.armor || 0));
    if (ranged && u.onWall) d *= 0.5;
    if (u.working > 0) d *= ranged ? 0.25 : 0.6; // engineers work under hide-covered mantlets
    u.hp -= d;
    u.flash = 0.12;
    if (Math.random() < 0.5) G.particles.push({ kind: 'blood', x: u.x + (Math.random() - 0.5) * 0.4, y: u.y - 0.5, vx: (Math.random() - 0.5), vy: -Math.random(), life: 0.5, max: 0.5 });
    if (u.hp <= 0) K.killUnit(G, u);
  };
  K.killUnit = function (G, u, silent) {
    if (u.dead) return;
    u.dead = true;
    if (u.team === 0) K.releaseJob(G, u);
    if (u.dockTile != null) { G.world.tower[u.dockTile] = 0; G.world.bump(); }
    if (silent) return;
    const fr = K.SPR.unit[u.sprite] || K.SPR.unit.subject;
    G.particles.push({ kind: 'corpse', x: u.x, y: u.y - 0.4, life: 6, max: 6, img: fr[0], dir: u.face });
    if (u.team === 1) G.stats.kills++;
    else if (u.kind === 'subject') { G.stats.lost++; G.msg((u.job === 'idle' ? 'A subject' : 'One of your ' + K.JOB[u.job].name.toLowerCase()) + ' has fallen.', 'bad'); }
  };
  // ---- height: higher ground (and the top of a wall) shoots further ----
  K.HEIGHT_STEP = 0.12; // +12% range per level above the target, up to 4 levels
  K.WALL_LIFT = 2;      // standing on a wall counts as two levels up
  K.groundH = (w, x, y) => { x = Math.floor(x); y = Math.floor(y); return K.inb(x, y) ? Math.min(3, w.elev[K.idx(x, y)]) : 0; };
  K.unitH = (G, v) => K.groundH(G.world, v.x, v.y) + (v.onWall ? K.WALL_LIFT : 0);
  K.rangeVs = (base, h1, h2) => base * (1 + K.HEIGHT_STEP * Math.max(0, Math.min(4, h1 - h2)));
  // nearest target within range, where range grows with the shooter's height over each target
  K.nearestRanged = function (G, x, y, base, h, team, filter) {
    return K.nearest(G, x, y, base * (1 + 4 * K.HEIGHT_STEP), team, (v, d) => d <= K.rangeVs(base, h, K.unitH(G, v)) && (!filter || filter(v, d)));
  };
  // the wall that carries a mounted siege engine (s itself, or the anchor wall of a trebuchet)
  K.engineHost = (w, s) => (s && s.type === 'wall' ? (s.engine || (s.upg && s.upg.engine) ? s : s.engPart ? w.structs.get(s.engPart) || null : null) : null);
  K.damageStruct = function (G, s, dmg) {
    if (!G.world.structs.has(s.id) || G.god || K.SDEF[s.type].noRaze) return;
    s.hp -= dmg;
    s.hitT = 0.15;
    if (s.hp <= 0) K.destroyStruct(G, s);
  };
  const SOLID = { wall: 1, gate: 1, irongate: 1, keepdoor: 1, keep: 1, house: 1, tent: 1, quarry: 1, mine: 1, bloomery: 1, lumbermill: 1, catapult: 1, trebuchet: 1 };
  // Can a melee attack happen between a and b? (walls block, wall-top units only reachable from walls)
  K.meleeOk = function (G, a, b) {
    if (!!a.onWall !== !!b.onWall) return false;
    if (a.onWall) return true;
    const w = G.world, mx = Math.floor((a.x + b.x) / 2), my = Math.floor((a.y + b.y) / 2);
    const s = w.structAt(mx, my);
    return !(s && SOLID[s.type]);
  };
  // Is there a wall/gate/keep strictly between two points?
  K.wallBetween = function (w, x0, y0, x1, y1) {
    const a = K.idx(Math.floor(x0), Math.floor(y0)), b = K.idx(Math.floor(x1), Math.floor(y1));
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3);
    for (let k = 1; k < n; k++) {
      const x = Math.floor(x0 + ((x1 - x0) * k) / n), y = Math.floor(y0 + ((y1 - y0) * k) / n);
      if (!K.inb(x, y)) continue;
      const i = K.idx(x, y);
      if (i === a || i === b) continue;
      const s = w.structAt(x, y);
      if (s && (s.type === 'wall' || K.isGate(s.type) || s.type === 'keep' || s.type === 'keepdoor')) return true;
    }
    return false;
  };
  K.shoot = function (G, kind, sx, sy, tx, ty, o) {
    const d = Math.hypot(tx - sx, ty - sy);
    if (kind === 'arrow' && o.target && !o.target.onWall && !o.fromWall) o.blocked = K.wallBetween(G.world, sx, sy + 0.6, o.target.x, o.target.y);
    const sp = kind === 'stone' ? 7 : kind === 'bolt' ? 18 : 13;
    G.projectiles.push(Object.assign({ kind, sx, sy, tx, ty, t: 0, dur: Math.max(0.15, d / sp), arc: kind === 'stone' ? 0.6 + d * 0.18 : kind === 'bolt' ? 0.05 : 0.2 + d * 0.06 }, o));
  };

  // ---------- friendly movement ----------
  function tileOf(u) { return K.idx(K.clamp(Math.floor(u.x), 0, N - 1), K.clamp(Math.floor(u.y), 0, N - 1)); }
  K.tileOf = tileOf;

  // Request a path; returns 'ok' (has path), 'wait' (no budget), 'fail'
  function seek(G, u, goal, hx, hy, key) {
    if (u.path && u.pathKey === key) return 'ok';
    if (u.failKey === key && G.time < u.failT) return 'fail';
    if (G.pathBudget <= 0) return 'wait';
    G.pathBudget--;
    const i = tileOf(u);
    if (goal(i)) { u.path = []; u.pi = 0; u.pathKey = key; return 'ok'; }
    const p = G.world.astar(i & NM, i >> NS, goal, hx, hy, 25000);
    if (!p) { u.failKey = key; u.failT = G.time + 4; u.path = null; return 'fail'; }
    u.path = p; u.pi = 0; u.pathKey = key;
    return 'ok';
  }
  // Walk along u.path. Returns true when finished.
  function follow(G, u, dt) {
    const w = G.world;
    if (!u.path) return false;
    if (u.pi >= u.path.length) { u.moving = false; return true; }
    const n = u.path[u.pi];
    if (!w.fPass(n)) { u.path = null; u.moving = false; return false; }
    const tx = (n & NM) + 0.5, ty = (n >> NS) + 0.5;
    const sp = K.unitStats(u).speed / w.fCost(tileOf(u));
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    u.moving = true;
    if (Math.abs(dx) > 0.05) u.face = dx > 0 ? 1 : -1;
    const step = sp * dt;
    if (d <= step) { u.x = tx; u.y = ty; u.pi++; }
    else { u.x += (dx / d) * step; u.y += (dy / d) * step; }
    return false;
  }
  // Can a subject walk straight from (x0,y0) to (x1,y1) without crossing water, walls or other blocked tiles?
  function clearLine(w, x0, y0, x1, y1) {
    let px = Math.floor(x0), py = Math.floor(y0);
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2);
    for (let k = 1; k <= n; k++) {
      const fx = Math.floor(x0 + ((x1 - x0) * k) / n), fy = Math.floor(y0 + ((y1 - y0) * k) / n);
      if (fx === px && fy === py) continue;
      if (!K.inb(fx, fy) || !w.fPass(K.idx(fx, fy))) return false;
      if (fx !== px && fy !== py && (!w.fPass(K.idx(fx, py)) || !w.fPass(K.idx(px, fy)))) return false;
      px = fx; py = fy;
    }
    return true;
  }
  K.clearLine = clearLine;
  // Returns true when arrived, or when the way is blocked.
  function stepToward(w, u, x, y, dt, sp) {
    const dx = x - u.x, dy = y - u.y, d = Math.hypot(dx, dy);
    if (d < 0.03) { u.moving = false; return true; }
    const s = Math.min(d, sp * dt);
    const nx = u.x + (dx / d) * s, ny = u.y + (dy / d) * s;
    if (!clearLine(w, u.x, u.y, nx, ny)) { u.moving = false; return true; }
    u.moving = true;
    if (Math.abs(dx) > 0.03) u.face = dx > 0 ? 1 : -1;
    u.x = nx; u.y = ny;
    return false;
  }
  // go somewhere; returns true once there
  function goTo(G, u, dt, goal, hx, hy, key) {
    const r = seek(G, u, goal, hx, hy, key);
    if (r === 'fail') { u.moving = false; return null; }
    if (r === 'wait') { u.moving = false; return false; }
    return follow(G, u, dt);
  }
  const adjTo = (w, test) => (i) => {
    const x = i & NM, y = i >> NS;
    for (const [dx, dy] of K.DIRS8) { const nx = x + dx, ny = y + dy; if (K.inb(nx, ny) && test(K.idx(nx, ny))) return true; }
    return false;
  };

  // ---------- friendly AI ----------
  function hide(G, u, dt) {
    const w = G.world, k = w.keep;
    u.lastAt = null;
    if (u.onWall && (u.job !== 'archer' || G.allKeep)) { K.stepOffWall(G, u); u.wb = null; u.wpath = null; }
    if (!k) return wander(G, u, dt, G.kingSpot.x, G.kingSpot.y, 3);
    const r = goTo(G, u, dt, adjTo(w, (j) => w.sgrid[j] === k.id), k.x + 1, k.y + 1, 'keep');
    if (r) { deposit(G, u); u.hidden = true; if (G.phase === 'defense' || G.recall) u.shelt = true; u.path = null; u.moving = false; K.releaseJob(G, u); u.state = null; }
    else if (r === null) wander(G, u, dt, u.x, u.y, 1);
  }
  function wander(G, u, dt, cx, cy, rad) {
    if (!u.wt || u.wt <= 0 || !u.wx) {
      u.wt = 2 + Math.random() * 4;
      u.wx = null;
      for (let k = 0; k < 6; k++) {
        const x = cx + (Math.random() - 0.5) * 2 * rad, y = cy + (Math.random() - 0.5) * 2 * rad;
        // only stroll in a straight line over walkable ground (never across water or through walls)
        if (K.inb(Math.floor(x), Math.floor(y)) && clearLine(G.world, u.x, u.y, x, y)) { u.wx = x; u.wy = y; break; }
      }
    }
    u.wt -= dt;
    if (u.wx == null) { u.moving = false; return; }
    if (stepToward(G.world, u, u.wx, u.wy, dt, K.unitStats(u).speed * 0.5)) u.moving = false;
  }

  // A free tile beside tree i where a woodcutter can stand (not claimed by another woodcutter).
  function treeStand(G, i, u) {
    const w = G.world, x = i & NM, y = i >> NS;
    let best = -1, bd = 1e9;
    for (const [ax, ay] of K.DIRS4) {
      const nx = x + ax, ny = y + ay;
      if (!K.inb(nx, ny)) continue;
      const j = K.idx(nx, ny);
      if (!w.fPass(j) || G.reserved.has('s' + j)) continue;
      const d = Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }
  // Woodcutters clear the forest nearest the keep first, one woodcutter per tree.
  function findTree(G, u) {
    const w = G.world, k = w.keep;
    const cx = k ? k.x + 1 : Math.floor(u.x), cy = k ? k.y + 1 : Math.floor(u.y);
    const failed = u.badTrees || (u.badTrees = new Set());
    let best = -1, bd = 1e9;
    // walk square rings outwards; stop once no unseen tile can be closer than the best found
    for (let r = 1; r < N && r * r <= bd; r++)
      for (let dy = -r; dy <= r; dy++) {
        const step = dy === -r || dy === r ? 1 : 2 * r;
        for (let dx = -r; dx <= r; dx += step) {
          const x = cx + dx, y = cy + dy;
          if (!K.inb(x, y)) continue;
          const i = K.idx(x, y);
          if (w.terrain[i] !== T.FOREST || G.reserved.has(i) || failed.has(i)) continue;
          const d = dx * dx + dy * dy;
          if (d >= bd) continue;
          // woodcutters know to keep clear of beasts' lairs
          if (G.beasts && G.beasts.some((b) => !b.dead && K.dist(x, y, b.x, b.y) < K.BEASTS[b.kind].aggro + 1.5)) continue;
          if (treeStand(G, i, u) < 0) continue;
          bd = d; best = i;
        }
      }
    return best;
  }

  function doWood(G, u, dt) {
    const w = G.world;
    if (u.tree == null || w.terrain[u.tree] !== T.FOREST || u.stand == null || !w.fPass(u.stand)) {
      K.dropTree(G, u);
      u.chop = 0;
      if (u.searchT > G.time) return wander(G, u, dt, u.x, u.y, 1);
      const t = findTree(G, u);
      if (t < 0) { u.searchT = G.time + 5; return; }
      u.tree = t; G.reserved.add(t); u.path = null;
      u.stand = treeStand(G, t, u); G.reserved.add('s' + u.stand);
    }
    const tr = u.tree, tx = tr & NM, ty = tr >> NS, sd = u.stand;
    const r = goTo(G, u, dt, (i) => i === sd, sd & NM, sd >> NS, 'tree' + tr + ':' + sd);
    if (r === null) { u.badTrees.add(tr); K.dropTree(G, u); return; }
    if (!r) return;
    u.state = 'work';
    u.face = tx + 0.5 > u.x ? 1 : -1;
    u.chop = (u.chop || 0) + dt;
    u.atkAnim = (u.chop % 1) < 0.25 ? 0.1 : 0;
    if (u.chop >= K.RATES.chopTime) {
      u.chop = 0;
      u.carry = (u.carry || 0) + K.RATES.chopYield; u.carryRes = 'lumber';
      w.setTerrain(tr, T.GRASS);
      w.stump[tr] = 1;
      K.scheduleRegrow(G, tr, K.TREE_REGROW);
      K.dropTree(G, u);
      u.path = null; u.state = null;
    }
  }

  function deposit(G, u) {
    if (!u.carry) return;
    const res = u.carryRes || 'lumber';
    G.res[res] += u.carry;
    K.fx(G, u.x, u.y - 1, '+' + u.carry + ' ' + res, { lumber: '#e0b070', stone: '#d0d0d0', ore: '#e09060' }[res]);
    u.carry = 0; u.carryRes = null;
  }
  // Woodcutters, quarry workers and miners haul their loads back to the keep before they count.
  function haul(G, u, dt) {
    const w = G.world, k = w.keep;
    if (!k) { deposit(G, u); return; }
    u.state = 'haul';
    const r = goTo(G, u, dt, adjTo(w, (j) => w.sgrid[j] === k.id), k.x + 1, k.y + 1, 'keep');
    if (r) { deposit(G, u); u.path = null; u.state = null; }
    else if (r === null) wander(G, u, dt, u.x, u.y, 1);
  }

  // ---- dig dispatcher ----
  // Flood-label walkable ground (8-way, no corner cutting) so we know who can reach what.
  // Walkable tiles as a flat grid (bit 1: walkable now, bit 2: walkable or a drawbridge), rebuilt per map change.
  function passGrid(w) {
    if (w.passV === w.version && w.passG) return w.passG;
    const g = w.passG || (w.passG = new Uint8Array(N * N));
    for (let i = 0; i < N * N; i++) {
      const sid = w.sgrid[i];
      g[i] = w.fPass(i) ? 3 : sid && w.structs.get(sid).type === 'drawbridge' ? 2 : 0;
    }
    w.passV = w.version;
    return g;
  }
  const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
  // Flood out from the queued seeds over tiles where ok[] is set (no corner-cutting past blocked tiles).
  function spread(ok, mark, q, qt, id) {
    let qh = 0;
    while (qh < qt) {
      const i = q[qh++], x = i & NM, y = i >> NS;
      for (let d = 0; d < 8; d++) {
        const dx = DX8[d], dy = DY8[d], nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (mark[j] || !ok[j]) continue;
        if (dx && dy && (!ok[y * N + nx] || !ok[ny * N + x])) continue;
        mark[j] = id; q[qt++] = j;
      }
    }
  }
  function walkComps(w) {
    const g = passGrid(w), ok = new Uint8Array(N * N), comp = new Int32Array(N * N), q = new Int32Array(N * N);
    for (let i = 0; i < N * N; i++) ok[i] = g[i] & 1;
    let id = 0;
    for (let s = 0; s < N * N; s++) {
      if (comp[s] || !ok[s]) continue;
      id++; comp[s] = id; q[0] = s;
      spread(ok, comp, q, 1, id);
    }
    return comp;
  }
  // Tiles reachable from the Keep if the tiles in `wet` turned to water.
  function keepRegion(w, wet, lowered) {
    const k = w.keep;
    if (!k) return null;
    const g = passGrid(w), ok = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) ok[i] = lowered ? g[i] >> 1 : g[i] & 1;
    for (const i of wet) ok[i] = 0;
    const seen = new Uint8Array(N * N), q = new Int32Array(N * N);
    let qt = 0;
    for (let y = k.y - 1; y <= k.y + 3; y++)
      for (let x = k.x - 1; x <= k.x + 3; x++) {
        if (!K.inb(x, y)) continue;
        const i = K.idx(x, y);
        if (w.sgrid[i] === k.id || !ok[i]) continue;
        seen[i] = 1; q[qt++] = i;
      }
    spread(ok, seen, q, qt, 1);
    return seen;
  }
  K.keepRegion = keepRegion;
  // Everywhere a subject can walk to from the Keep (drawbridges counted as lowered), cached per world change.
  K.homeRegion = function (G) {
    const w = G.world;
    if (G.homeV !== w.version || G.homeW !== w) { G.homeV = w.version; G.homeW = w; G.home = keepRegion(w, new Set(), true); }
    return G.home;
  };
  const standsOf = (w, t, ok) => {
    const out = [], x = t & NM, y = t >> NS;
    for (const [dx, dy] of K.DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!K.inb(nx, ny)) continue;
      const j = ny * N + nx;
      // marked tiles that are still dry can be stood on (so a marked strip is dug from its tip back to shore)
      if ((!w.plan.has(j) || (!w.fillPlan.has(j) && !K.isWater(w.terrain[j]) && w.terrain[j] !== T.TRENCH)) && w.fPass(j) && ok(j)) out.push(j);
    }
    return out;
  };
  // Pair ditchers with marked tiles, nearest first. Ditchers still walking to a job can be reassigned
  // when someone closer is free. A tile that would flood is only dug if the digger keeps a dry way
  // home and no other marked tile gets cut off.
  K.assignDigs = function (G) {
    const w = G.world;
    const crew = G.units.filter((u) => u.team === 0 && !u.dead && !u.hidden && u.kind === 'subject' && u.job === 'dig' && !u.carry && !(u.digging > 0));
    if (!crew.length) return;
    for (const u of crew) if (u.digT != null) { G.reserved.delete(u.digT); }
    if (!w.plan.size) { for (const u of crew) { u.digT = null; u.digStands = null; } return; }
    // whole-map walk data only changes with the map, so keep it between rounds
    let C = G.digCache;
    if (!C || C.v !== w.version || C.w !== w) C = G.digCache = { v: w.version, w, comp: walkComps(w), home0: keepRegion(w, new Set()), wet: new Map() };
    const comp = C.comp;
    const tiles = [];
    for (const i of w.plan) if (!G.reserved.has(i)) tiles.push(i);
    // where a digger could stand for each tile (dry, not itself marked), by walk component
    const standComps = new Map();
    for (const t of tiles) standComps.set(t, new Set(standsOf(w, t, () => true).map((j) => comp[j])));
    const pairs = [];
    for (const u of crew) {
      const c = comp[tileOf(u)], bad = u.badPlan || (u.badPlan = new Map());
      if (!c) continue;
      for (const t of tiles) {
        if (!standComps.get(t).has(c) || bad.get(t) > G.time) continue;
        const fill = w.fillPlan.has(t);
        let edge = 0;
        for (const [dx, dy] of K.DIRS4) {
          const x = (t & NM) + dx, y = (t >> NS) + dy;
          if (!K.inb(x, y)) continue;
          const j = K.idx(x, y), tt = w.terrain[j];
          if (fill ? !K.isWater(tt) && tt !== T.TRENCH && !w.plan.has(j) : K.isWater(tt) || tt === T.TRENCH) edge = 1;
        }
        // moats grow out from the water, fills in from the shore; stick with the current job
        const d = K.dist(u.x, u.y, (t & NM) + 0.5, (t >> NS) + 0.5) - edge * 4 - (u.digT === t ? 3 : 0);
        pairs.push([d, u, t]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const home0 = C.home0;
    // every marked tile and construction job that can be reached now must stay reachable
    const needs = [];
    if (home0) {
      for (const t of w.plan) { const st = standsOf(w, t, () => true); if (st.some((j) => home0[j])) needs.push({ t, st }); }
      for (const o of w.structs.values()) if (o.type === 'site' || o.upg) { const st = K.buildSpots(w, o); if (st.some((j) => home0[j])) needs.push({ t: -1, st }); }
    }
    const doneU = new Set(), doneT = new Set(), deferred = new Set();
    const memo = C.wet;
    // what floods (and where people can still walk) once t and every tile already being dug are trenches
    const wetOf = (t) => {
      const digging = new Set([t, ...G.reserved, ...doneT]);
      const key = t + ':' + [...digging].sort((a, b) => a - b).join(',');
      if (memo.has(key)) return memo.get(key);
      let r = null, near = false;
      for (const [dx, dy] of K.DIRS4) {
        const x = (t & NM) + dx, y = (t >> NS) + dy;
        if (!K.inb(x, y)) continue;
        const j = K.idx(x, y);
        if (K.isWater(w.terrain[j]) || w.terrain[j] === T.TRENCH || digging.has(j)) near = true;
      }
      if (near) {
        const wet = new Set();
        for (const d of digging) if (!wet.has(d)) for (const j of w.floodFrom(d, digging)) if (w.terrain[j] !== T.MOAT) wet.add(j);
        if (wet.has(t)) r = { wet, home: keepRegion(w, wet) };
      }
      memo.set(key, r);
      return r;
    };
    // ditchers already at work, and where they stand: nobody digs out from under a ditcher
    const working = G.units.filter((v) => v.team === 0 && !v.dead && v.job === 'dig' && v.digT != null && !crew.includes(v));
    const standingOn = (t) => G.units.some((v) => v.team === 0 && !v.dead && !v.hidden && !crew.includes(v) && tileOf(v) === t) ||
      working.some((v) => v.digStands && v.digStands.has(t) && v.digStands.size === 1);
    const tryPair = (u, t, strict) => {
      const c = comp[tileOf(u)];
      if (standingOn(t)) return null;
      let ok = (j) => comp[j] === c && !G.reserved.has(j) && !doneT.has(j);
      if (!w.fillPlan.has(t) && home0 && home0[tileOf(u)]) {
        const f = wetOf(t);
        if (f) {
          const { wet, home } = f;
          ok = (j) => comp[j] === c && !wet.has(j) && home[j] && !G.reserved.has(j) && !doneT.has(j);
          if (strict) for (const n of needs) if (n.t !== t && !doneT.has(n.t) && !n.st.some((j) => !wet.has(j) && home[j])) return null;
        }
      }
      const st = standsOf(w, t, ok);
      return st.length ? st : null;
    };
    // a cut-off is only accepted when nothing else can be dug at all (one tile at a time)
    const busy = () => doneT.size || G.units.some((v) => v.job === 'dig' && v.digging > 0 && !v.dead);
    for (const strict of [true, false]) {
      if (!strict && busy()) break;
      for (const [, u, t] of pairs) {
        if (!strict && doneT.size) break;
        if (doneU.has(u) || doneT.has(t) || (strict && deferred.has(t))) continue;
        const st = tryPair(u, t, strict);
        if (!st) { deferred.add(t); continue; }
        // anyone already assigned may no longer stand on t
        let clash = false;
        for (const v of [...working, ...doneU]) if (v.digStands && v.digStands.has(t) && v.digStands.size === 1) clash = true;
        if (clash) { deferred.add(t); continue; }
        for (const v of [...working, ...doneU]) if (v.digStands) v.digStands.delete(t);
        doneU.add(u); doneT.add(t);
        if (u.digT !== t) { u.path = null; u.digging = 0; }
        u.digT = t; u.digStands = new Set(st); G.reserved.add(t);
      }
    }
    for (const u of crew) if (!doneU.has(u)) { if (u.digT != null) u.path = null; u.digT = null; u.digStands = null; }
  };

  function doDig(G, u, dt) {
    const w = G.world;
    if (u.digT == null || !w.plan.has(u.digT)) {
      if (u.digT != null) { G.reserved.delete(u.digT); G.digAssignT = 0; }
      u.digT = null; u.digging = 0;
      u.state = 'nowork';
      return wander(G, u, dt, w.keep ? w.keep.x + 1 : u.x, w.keep ? w.keep.y + 4 : u.y, 3);
    }
    const tr = u.digT, tx = tr & NM, ty = tr >> NS, stands = u.digStands;
    const r = goTo(G, u, dt, (i) => (stands ? stands.has(i) : i !== tr && Math.abs((i & NM) - tx) <= 1 && Math.abs((i >> NS) - ty) <= 1 && !w.plan.has(i)), tx, ty, 'dig' + tr);
    if (r === null) { (u.badPlan || (u.badPlan = new Map())).set(tr, G.time + 15); G.reserved.delete(tr); u.digT = null; G.digAssignT = 0; return; }
    if (!r) return;
    u.state = 'work'; u.moving = false;
    u.face = tx + 0.5 > u.x ? 1 : -1;
    u.digging = (u.digging || 0) + dt;
    u.atkAnim = (u.digging % 0.9) < 0.25 ? 0.1 : 0;
    w.digProg = w.digProg || new Map();
    w.digProg.set(tr, u.digging / K.RATES.digTime);
    if (Math.random() < dt * 1.5) G.particles.push({ kind: 'dust', x: tx + 0.5, y: ty + 0.5, vx: (Math.random() - 0.5) * 0.6, vy: -0.4, life: 0.6, max: 0.6 });
    if (u.digging >= K.RATES.digTime) {
      G.reserved.delete(tr); w.digProg.delete(tr);
      u.digT = null; u.digging = 0; u.path = null; u.state = null;
      K.digDone(G, tr);
      G.digAssignT = 0;
    }
  }

  // Demolition crews plant the explosives the player has marked.
  function findCharge(G, u) {
    const w = G.world, bad = u.badPlan || (u.badPlan = new Map());
    let best = -1, bd = 1e9;
    for (const [i, c] of w.charges) {
      if (c.state !== 'planned' || G.reserved.has('c' + i) || bad.get(i) > G.time) continue;
      // blast mountains and rock patches from the edge inward
      let open = 0;
      for (const [dx, dy] of K.DIRS4) { const x = (i & NM) + dx, y = (i >> NS) + dy; if (K.inb(x, y) && w.fPass(K.idx(x, y))) open = 1; }
      const d = K.dist(u.x, u.y, i & NM, i >> NS) - open * 20;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function doDemo(G, u, dt) {
    const w = G.world;
    const cur = u.chT != null && w.charges.get(u.chT);
    if (!cur || cur.state !== 'planned') {
      if (u.chT != null) G.reserved.delete('c' + u.chT);
      u.chT = null; u.planting = 0;
      if (!(u.searchT > G.time)) {
        const t = findCharge(G, u);
        if (t >= 0) { u.chT = t; G.reserved.add('c' + t); u.path = null; }
        else u.searchT = G.time + 2;
      }
      if (u.chT == null) { u.state = 'nowork'; return wander(G, u, dt, w.keep ? w.keep.x + 1 : u.x, w.keep ? w.keep.y + 4 : u.y, 3); }
    }
    const tr = u.chT, tx = tr & NM, ty = tr >> NS, c = w.charges.get(tr);
    // traps are planted standing on the tile; blasting charges from beside the rock face
    const goal = c.kind === 'trap' ? (i) => i === tr : (i) => i !== tr && Math.abs((i & NM) - tx) <= 1 && Math.abs((i >> NS) - ty) <= 1;
    const r = goTo(G, u, dt, goal, tx, ty, 'ch' + tr);
    if (r === null) { u.badPlan.set(tr, G.time + 15); G.reserved.delete('c' + tr); u.chT = null; return; }
    if (!r) return;
    u.state = 'work'; u.moving = false;
    u.face = tx + 0.5 > u.x ? 1 : tx + 0.5 < u.x ? -1 : u.face;
    u.planting = (u.planting || 0) + dt;
    u.atkAnim = (u.planting % 1) < 0.2 ? 0.1 : 0;
    c.prog = u.planting / K.RATES.plantTime;
    if (u.planting >= K.RATES.plantTime) {
      G.reserved.delete('c' + tr);
      u.chT = null; u.planting = 0; u.path = null; u.state = null;
      if (c.kind === 'trap') { c.state = 'armed'; K.fx(G, tx + 0.5, ty - 0.2, 'Trap set', '#ffb040'); }
      else { c.state = 'lit'; c.t = K.RATES.fuse; K.fx(G, tx + 0.5, ty - 0.2, 'Fuse lit!', '#ffd060'); }
    }
  }

  function doBuildingJob(G, u, dt, where) {
    const w = G.world;
    if (u.work && !w.structs.has(u.work.id)) { u.work = null; u.path = null; }
    if (!u.work) {
      let best = null, bd = 1e9;
      for (const s of w.structs.values()) {
        if ((s.type !== where && !(s.type === 'site' && s.final === where)) || s.workers.size >= K.SDEF[where].slots) continue;
        if (u.failKey === 's' + s.id && G.time < u.failT) continue;
        const d = K.dist(u.x, u.y, s.x, s.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (!best) { u.state = 'nowork'; return wander(G, u, dt, w.keep ? w.keep.x + 1 : u.x, w.keep ? w.keep.y + 4 : u.y, 3); }
      u.work = best; best.workers.add(u.id); u.path = null;
    }
    const s = u.work;
    const inside = (i) => w.sgrid[i] === s.id;
    const site = s.type === 'site';
    const goal = where === 'farm' && !site ? inside : adjTo(w, inside);
    const r = goTo(G, u, dt, goal, s.x + s.w / 2, s.y + s.h / 2, 's' + s.id);
    if (r === null) { s.workers.delete(u.id); u.work = null; return; }
    if (!r) return;
    if (site) {
      // the crew raises its own workplace first
      u.state = 'work'; u.moving = false; u.face = s.x + s.w / 2 > u.x ? 1 : -1;
      u.anim = (u.anim || 0) + dt;
      u.atkAnim = (u.anim % 0.8) < 0.2 ? 0.1 : 0;
      s.prog += dt;
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.9 * dt / s.time);
      if (s.prog >= s.time) { K.finishSite(G, s); u.work = null; u.path = null; }
      return;
    }
    u.state = 'work';
    if (where === 'farm') wander(G, u, dt, s.x + 1.5, s.y + 1.5, 1.3);
    else { u.moving = false; u.face = s.x + s.w / 2 > u.x ? 1 : -1; }
    u.anim = (u.anim || 0) + dt;
    u.atkAnim = (u.anim % 1.2) < 0.3 ? 0.1 : 0;
    const R = K.RATES;
    if (where === 'farm') G.res.food += R.farm * dt;
    else if (where === 'quarry' || where === 'mine') {
      // fill a basket, then haul it to the keep
      u.load = (u.load || 0) + dt;
      if (u.load >= R.loadTime) {
        u.load = 0;
        u.carry = where === 'quarry' ? R.stoneLoad : R.oreLoad;
        u.carryRes = where === 'quarry' ? 'stone' : 'ore';
        u.path = null; u.state = null;
      }
    }
    else if (where === 'bloomery') {
      if (G.res.ore >= 2 && G.res.lumber >= 1) {
        u.smelt = (u.smelt || 0) + dt;
        if (u.smelt >= R.smeltTime) {
          u.smelt = 0; G.res.ore -= 2; G.res.lumber -= 1; G.res.iron += 1;
          K.fx(G, s.x + 0.5, s.y, '+1 iron', '#c8d0e0');
          G.particles.push({ kind: 'smoke', x: s.x + 1.4, y: s.y - 0.8, vx: 0.1, vy: -0.6, life: 2, max: 2 });
        }
      } else u.atkAnim = 0;
    }
    else if (where === 'lumbermill') {
      if (G.res.lumber >= 2) {
        u.mill = (u.mill || 0) + dt;
        if (u.mill >= R.millTime) {
          u.mill = 0; G.res.lumber -= 2; G.res.plank = (G.res.plank || 0) + 1;
          K.fx(G, s.x + 0.5, s.y, '+1 processed lumber', '#e8c590');
        }
      } else u.atkAnim = 0;
    }
  }

  // Builders: build construction sites and battlement upgrades, then repair. During a siege
  // repairs come first and only sites inside the walls are worked on. Resource-building
  // sites are left to their own workers.
  const isBuildJob = (s) => (s.type === 'site' && !K.selfBuilt(s)) || !!s.upg;
  const siegeBuild = (s) => isBuildJob(s) && !(s.type === 'site' && K.SDEF[s.final].eco);
  K.needsMason = (s) => !K.selfBuilt(s) && (isBuildJob(s) || s.hp < s.maxHp);
  // Work squares for builders: walkable tiles beside the structure, diagonals included. Each holds
  // one builder, so (with wallSpots) this is also how many builders can work on it at once.
  const ring = (s, f) => {
    for (let y = s.y - 1; y <= s.y + s.h; y++)
      for (let x = s.x - 1; x <= s.x + s.w; x++) {
        if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) continue;
        if (K.inb(x, y)) f(K.idx(x, y));
      }
  };
  K.buildSpots = function (w, s) {
    const out = [];
    ring(s, (i) => { if (w.fPass(i) && w.sgrid[i] !== s.id) out.push(i); });
    return out;
  };
  const isBattle = (w, i) => { const o = w.sgrid[i] && w.structs.get(w.sgrid[i]); return !!o && o.type === 'wall' && o.battlement; };
  // Walk along the wall-walk from battlement `start` to the nearest one a builder can climb onto from
  // the ground. Returns { climb: ground tile, route: wall tiles from the climbing point to start }.
  function wallRoute(w, start, job) {
    const prev = new Map([[start, -1]]), q = [start];
    for (let k = 0; k < q.length && k < 400; k++) {
      const i = q[k], x = i & NM, y = i >> NS;
      for (const [dx, dy] of K.DIRS4) {
        if (!K.inb(x + dx, y + dy)) continue;
        const g = K.idx(x + dx, y + dy);
        if (!w.fPass(g) || (job && w.sgrid[g] === job.id)) continue;
        const route = [];
        for (let j = i; j !== -1; j = prev.get(j)) route.push(j);
        return { climb: g, route };
      }
      for (const [dx, dy] of K.DIRS8) {
        if (!K.inb(x + dx, y + dy)) continue;
        const j = K.idx(x + dx, y + dy);
        if (!prev.has(j) && isBattle(w, j)) { prev.set(j, i); q.push(j); }
      }
    }
    return null;
  }
  // Builders may also work standing on a finished battlement beside the job.
  K.wallSpots = function (w, s) {
    const out = [];
    ring(s, (i) => {
      if (w.sgrid[i] === s.id || !isBattle(w, i) || K.engineHost(w, w.structs.get(w.sgrid[i]))) return;
      const r = wallRoute(w, i, s);
      if (r) out.push({ i, climb: r.climb, route: r.route });
    });
    return out;
  };
  K.spotCount = (w, s) => K.buildSpots(w, s).length + K.wallSpots(w, s).length;

  // ---- never build in an order that cuts off other work ----
  const OPEN_DONE = new Set(['gate', 'irongate', 'keepdoor', 'bridge', 'drawbridge', 'farm']);
  // Where subjects could still walk from the Keep once site `s` is finished (null: nothing changes).
  function finishRegion(G, s) {
    const w = G.world;
    if (s.type !== 'site' || OPEN_DONE.has(s.final) || !w.keep) return null;
    if (G.finV !== w.version || G.finW !== w) { G.finV = w.version; G.finW = w; G.finC = new Map(); }
    if (!G.finC.has(s.id)) {
      const blk = new Set();
      for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) blk.add(K.idx(x, y));
      G.finC.set(s.id, keepRegion(w, blk, true));
    }
    return G.finC.get(s.id);
  }
  // Would finishing `s` cut someone off, or leave another job (site, battlements, trench) out of reach?
  K.strands = function (G, s, jobsOnly) {
    const w = G.world, home = K.homeRegion(G), R = finishRegion(G, s);
    if (!R || !home) return false;
    const lost = (st) => st.some((j) => home[j]) && !st.some((j) => R[j]);
    for (const o of w.structs.values()) {
      if (o === s || !(o.type === 'site' || o.upg)) continue;
      if (lost(K.buildSpots(w, o)) && !K.wallSpots(w, o).some((p) => R[p.climb])) return true;
    }
    for (const t of w.plan) if (lost(standsOf(w, t, () => true))) return true;
    if (jobsOnly) return false;
    for (const v of G.units) {
      if (v.team !== 0 || v.dead || v.hidden || v.onWall) continue;
      const i = tileOf(v);
      if (home[i] && !R[i] && w.sgrid[i] !== s.id) return true;
    }
    return false;
  };
  // walk a builder along the wall-walk (u.wpath: battlement tiles)
  function walkTiles(G, u, dt) {
    const w = G.world, i = u.wpath[0];
    if (!isBattle(w, i)) { u.wpath = null; K.stepOffWall(G, u); u.wb = null; u.rep = null; u.spot = null; return; }
    const tx = (i & NM) + 0.5, ty = (i >> NS) + 0.6, d = K.dist(u.x, u.y, tx, ty), step = K.unitStats(u).speed * 0.8 * dt;
    u.face = tx > u.x ? 1 : tx < u.x ? -1 : u.face;
    u.moving = true; u.state = 'walk';
    if (d <= step) { u.x = tx; u.y = ty; u.wpath.shift(); if (!u.wpath.length) u.moving = false; }
    else { u.x += ((tx - u.x) / d) * step; u.y += ((ty - u.y) / d) * step; }
  }
  // placement order of a construction job (sites and battlement upgrades)
  const buildOrd = (s) => (s.type === 'site' ? s.ord : s.upg && s.upg.ord) || s.id;
  function doRepair(G, u, dt) {
    const w = G.world, def = G.phase === 'defense', o = def ? w.computeOutside() : null;
    const valid = (s) => s && w.structs.has(s.id) && K.needsMason(s) && (!o || !o[K.idx(s.x, s.y)] || s.type === 'keep' || (!u.shelt && siegeBuild(s)));
    if (u.rep && (!valid(u.rep) || u.spot == null || (u.wb ? !isBattle(w, u.spot) : !w.fPass(u.spot)))) { u.rep = null; u.spot = null; u.path = null; }
    // up on the battlements: walk the wall-walk, and climb down again once the job is done
    if (u.onWall) {
      if (!isBattle(w, tileOf(u)) || !u.wb) { K.stepOffWall(G, u); u.wb = null; u.wpath = null; return; }
      if (!u.rep && !u.wbDown) {
        let k = 0, kd = 1e9;
        u.wb.route.forEach((j, n) => { const d = K.dist(u.x, u.y, (j & NM) + 0.5, (j >> NS) + 0.6); if (d < kd) { kd = d; k = n; } });
        u.wbDown = true; u.wpath = u.wb.route.slice(0, k).reverse();
      }
      if (u.wpath && u.wpath.length) return walkTiles(G, u, dt);
      if (u.wbDown) {
        u.x = (u.wb.climb & NM) + 0.5; u.y = (u.wb.climb >> NS) + 0.5;
        u.onWall = false; u.wb = null; u.wbDown = false; u.path = null;
        return;
      }
    }
    if (!u.rep) {
      if (!(u.repSearch > G.time)) {
        u.repSearch = G.time + 0.5;
        u.repBad = u.repBad || new Map();
        const claimed = new Set();
        for (const v of G.units) if (v !== u && !v.dead && !v.hidden && v.job === 'repair' && v.rep && v.spot != null) claimed.add(v.spot);
        // construction in the order it was placed; repairs (worst damage first) after it,
        // or before it during a siege
        const builds = [], repairs = [];
        for (const s of w.structs.values()) {
          if (!valid(s) || u.repBad.get(s.id) > G.time) continue;
          (isBuildJob(s) ? builds : repairs).push(s);
        }
        builds.sort((a, b) => buildOrd(a) - buildOrd(b));
        repairs.sort((a, b) => (K.dist(u.x, u.y, a.x, a.y) - (1 - a.hp / a.maxHp) * 30) - (K.dist(u.x, u.y, b.x, b.y) - (1 - b.hp / b.maxHp) * 30));
        const pick = (s) => {
          const R = finishRegion(G, s);
          let best = null, sd = 1e9;
          for (const strict of [true, false]) {
            // stand where you won't be shut in once it's finished
            for (const i of K.buildSpots(w, s)) {
              if (claimed.has(i) || (strict && R && !R[i])) continue;
              const d = K.dist(u.x, u.y, (i & NM) + 0.5, (i >> NS) + 0.5);
              if (d < sd) { sd = d; best = { i }; }
            }
            for (const p of K.wallSpots(w, s)) {
              if (claimed.has(p.i) || (strict && R && !R[p.climb])) continue;
              const d = K.dist(u.x, u.y, (p.climb & NM) + 0.5, (p.climb >> NS) + 0.5) + p.route.length + 1;
              if (d < sd) { sd = d; best = p; }
            }
            if (best) break;
            // only work from where you'd be shut in if there is no safe side at all
            if (R && (K.buildSpots(w, s).some((i) => R[i]) || K.wallSpots(w, s).some((p) => R[p.climb]))) break;
          }
          if (!best) return false;
          u.rep = s; u.spot = best.i; u.wb = best.climb != null ? { climb: best.climb, route: best.route } : null; u.path = null;
          return true;
        };
        const held = [];
        let free = false;
        for (const s of def ? repairs.concat(builds) : builds.concat(repairs)) {
          if (isBuildJob(s) && K.strands(G, s)) { held.push(s); continue; }
          if (isBuildJob(s)) free = true;
          if (pick(s)) break;
        }
        // a job that cuts something off waits until nothing else is left to build
        if (!u.rep && !free) for (const s of held) if (pick(s)) break;
      }
      if (!u.rep) { if (G.phase === 'defense') return hide(G, u, dt);
        u.state = 'nowork';
        // with nothing left to build, stay by the last job rather than heading home
        if (u.lastAt) return wander(G, u, dt, u.lastAt.x, u.lastAt.y, 2.5);
        return wander(G, u, dt, w.keep ? w.keep.x + 1 : u.x, w.keep ? w.keep.y + 4 : u.y, 3);
      }
    }
    const s = u.rep, sp = u.spot;
    if (u.wb && !u.onWall) {
      // walk to the foot of the wall, then climb onto the wall-walk
      const cl = u.wb.climb;
      const r = goTo(G, u, dt, (i) => i === cl, (cl & NM) + 0.5, (cl >> NS) + 0.5, 'c' + s.id + ':' + cl);
      if (r === null) { u.repBad.set(s.id, G.time + 6); u.rep = null; u.spot = null; u.wb = null; return; }
      if (!r) return;
      const r0 = u.wb.route[0];
      u.onWall = true; u.wbDown = false; u.path = null;
      u.x = (r0 & NM) + 0.5; u.y = (r0 >> NS) + 0.6;
      u.wpath = u.wb.route.slice(1);
      return;
    }
    if (u.onWall) { if (u.wpath && u.wpath.length) return walkTiles(G, u, dt); }
    else {
      const r = goTo(G, u, dt, (i) => i === sp, (sp & NM) + 0.5, (sp >> NS) + 0.5, 'r' + s.id + ':' + sp);
      if (r === null) { u.repBad.set(s.id, G.time + 6); u.rep = null; u.spot = null; return; }
      if (!r) return;
    }
    u.face = s.x + s.w / 2 > u.x ? 1 : -1;
    u.state = 'work'; u.moving = false;
    if (!u.onWall) u.lastAt = { x: u.x, y: u.y };
    u.anim = (u.anim || 0) + dt;
    u.atkAnim = (u.anim % 0.8) < 0.2 ? 0.1 : 0;
    if (s.type === 'site') {
      s.prog += dt;
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.9 * dt / s.time);
      if (s.prog >= s.time) {
        // finishing this now would shut something in: leave it for last
        if (K.strands(G, s, true) && [...w.structs.values()].some((o) => o !== s && isBuildJob(o) && valid(o) && !K.strands(G, o))) {
          s.prog = s.time; u.repBad.set(s.id, G.time + 4); u.rep = null; u.spot = null;
          if (!s.heldMsg) { s.heldMsg = true; G.msg('Builders leave a ' + K.SDEF[s.final].name.toLowerCase() + ' unfinished for now — closing it would cut off other work.', 'info'); }
          return;
        }
        // anyone who would be shut in walks out first (the builders wait for them)
        const R = finishRegion(G, s), home = K.homeRegion(G);
        if (R && home) {
          let wait = false;
          for (const v of G.units) {
            if (v.team !== 0 || v.dead || v.hidden || v.onWall) continue;
            const i = tileOf(v);
            if (home[i] && !R[i]) { v.evac = s.id; wait = true; }
          }
          s.holdT = (s.holdT || 0) + dt;
          if (wait && s.holdT < 25) { s.prog = s.time; return; }
        }
        K.finishSite(G, s); u.rep = null; u.spot = null;
      }
      return;
    }
    if (s.upg) {
      s.upg.prog += dt;
      if (s.upg.prog >= s.upg.time) { K.finishUpgrade(G, s); u.rep = null; u.spot = null; }
      return;
    }
    if (G.res.stone < 1) return;
    const amt = 20 * dt;
    s.hp = Math.min(s.maxHp, s.hp + amt);
    u.repAcc = (u.repAcc || 0) + amt / 25;
    if (u.repAcc >= 1) { u.repAcc -= 1; G.res.stone -= 1; }
  }

  // nearest planted ladder within r tiles
  function nearLadder(G, x, y, r) {
    let best = -1, bd = r;
    for (const i of G.world.ladderHp.keys()) { const d = K.dist(x, y, (i & NM) + 0.5, (i >> NS) + 0.5); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function hitLadder(G, u, i, mult) {
    const st = K.unitStats(u);
    u.moving = false; u.face = (i & NM) + 0.5 > u.x ? 1 : -1;
    if (u.cd <= 0) { u.cd = st.cd; u.atkAnim = 0.25; K.damageLadder(G, i, st.dmg * mult); }
  }
  K.nearLadder = nearLadder;

  function findPost(G, u) {
    const w = G.world, o = w.computeOutside();
    const k = w.keep || { x: G.kingSpot.x - 1, y: G.kingSpot.y - 3 };
    // prefer battlements facing the enemy entries
    let best = null, bd = 1e9;
    for (const s of w.structs.values()) {
      if (s.type !== 'wall' || !s.battlement || s.noAuto || K.engineHost(w, s) || G.postTaken.has(s.id)) continue;
      let ok = false, inside = false;
      for (const [dx, dy] of K.DIRS4) { const j = K.idx(s.x + dx, s.y + dy); if (K.inb(s.x + dx, s.y + dy) && w.fPass(j)) { ok = true; if (!o[j]) inside = true; } }
      if (!ok) continue;
      // face the enemy: score by distance to live attackers, or to the entry banners
      let d = 1e9;
      const foe = K.nearest(G, s.x, s.y, 25, 1);
      if (foe) d = K.dist(s.x, s.y, foe.x, foe.y) - 100;
      else for (const e of G.activeEntries) d = Math.min(d, K.dist(s.x, s.y, e.x, e.y));
      d += K.dist(s.x, s.y, k.x, k.y) * 0.05 + (inside ? 0 : 60);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // Battlement tiles joined to `s` along the wall-walk (diagonal walls included), nearest first.
  function wallWalk(w, s, max) {
    const start = K.idx(s.x, s.y), prev = new Map([[start, -1]]), q = [start];
    for (let k = 0; k < q.length && q.length < max; k++) {
      const i = q[k], x = i & NM, y = i >> NS;
      for (const [dx, dy] of K.DIRS8) {
        const o = w.structAt(x + dx, y + dy);
        if (!o || o.type !== 'wall' || !o.battlement) continue;
        const j = K.idx(o.x, o.y);
        if (!prev.has(j)) { prev.set(j, i); q.push(j); }
      }
    }
    return { order: q, prev };
  }
  function planWallMove(G, u, s) {
    const w = G.world, st = K.unitStats(u), reach = K.rangeVs(st.range, K.WALL_LIFT, 0) + 2;
    const { order, prev } = wallWalk(w, s, 80);
    if (order.length < 2) return false;
    let best = -1, bd = 1e9;
    for (let k = 1; k < order.length; k++) {
      const i = order[k], o = w.structs.get(w.sgrid[i]);
      if (!o || o.noAuto || K.engineHost(w, o) || (G.postTaken.has(o.id) && G.postTaken.get(o.id) !== u.id)) continue;
      const foe = K.nearest(G, (i & NM) + 0.5, (i >> NS) + 0.5, reach, 1);
      if (!foe) continue;
      const d = k + K.dist(i & NM, i >> NS, foe.x, foe.y) * 0.3; // BFS order ~ walking distance
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return false;
    const path = [];
    for (let i = best; i !== K.idx(s.x, s.y); i = prev.get(i)) path.push(i);
    path.reverse();
    const dest = w.structs.get(w.sgrid[best]);
    G.postTaken.delete(u.post);
    u.post = dest.id; G.postTaken.set(dest.id, u.id);
    u.wallPath = path;
    return true;
  }
  function walkWall(G, u, dt) {
    const w = G.world, i = u.wallPath[0], o = w.structs.get(w.sgrid[i]);
    if (!o || o.type !== 'wall' || !o.battlement) { u.wallPath = null; G.postTaken.delete(u.post); u.post = null; K.stepOffWall(G, u); return; }
    const tx = (i & NM) + 0.5, ty = (i >> NS) + 0.6, d = K.dist(u.x, u.y, tx, ty), step = K.unitStats(u).speed * 0.8 * dt;
    u.face = tx > u.x ? 1 : tx < u.x ? -1 : u.face;
    u.moving = true;
    if (d <= step) { u.x = tx; u.y = ty; u.wallPath.shift(); if (!u.wallPath.length) { u.wallPath = null; u.moving = false; } }
    else { u.x += ((tx - u.x) / d) * step; u.y += ((ty - u.y) / d) * step; }
  }

  function doArcher(G, u, dt) {
    const w = G.world;
    if (u.onWall) {
      const s = w.structs.get(u.post);
      if (!s) { u.onWall = false; u.post = null; K.unstick(G); return; }
      u.moving = false;
      const lad = nearLadder(G, u.x, u.y, 1.7);
      if (lad >= 0) { u.wallPath = null; hitLadder(G, u, lad, 1.6); return; }
      if (shootNearest(G, u, dt, 2)) { u.idleT = 0; return; }
      if (u.wallPath) return walkWall(G, u, dt);
      u.idleT = (u.idleT || 0) + dt;
      // nothing in range: walk the wall-walk to a free battlement that has targets
      if (u.idleT > 1.5 && !u.manualPost && !(u.wallSearch > G.time)) {
        u.wallSearch = G.time + 1.5;
        if (planWallMove(G, u, s)) { u.idleT = 0; return; }
      }
      if (u.idleT > 5 && !u.manualPost) {
        u.idleT = 0;
        const foe = K.nearest(G, G.kingSpot.x, G.kingSpot.y, 35, 1);
        const better = foe && findPost(G, u);
        if (better && K.dist(better.x, better.y, foe.x, foe.y) + 3 < K.dist(s.x, s.y, foe.x, foe.y)) {
          K.stepOffWall(G, u);
          G.postTaken.delete(u.post);
          u.post = better.id; G.postTaken.set(better.id, u.id); u.path = null;
        }
      }
      return;
    }
    if (u.post == null && !(u.postSearch > G.time)) {
      const p = findPost(G, u);
      if (p) { u.post = p.id; G.postTaken.set(p.id, u.id); u.path = null; }
      else u.postSearch = G.time + 3;
    }
    if (u.post != null) {
      const s = w.structs.get(u.post);
      if (!s || !s.battlement) { G.postTaken.delete(u.post); u.post = null; u.manualPost = false; return; }
      // climb up from any walkable tile beside the wall (inside the castle or out)
      const r = goTo(G, u, dt, (i) => Math.abs((i & NM) - s.x) + Math.abs((i >> NS) - s.y) === 1 && w.fPass(i), s.x, s.y, 'p' + s.id);
      if (r === null) {
        if (u.manualPost) G.msg('That archer cannot reach the battlement you chose.', 'warn');
        G.postTaken.delete(u.post); u.post = null; u.manualPost = false; u.postSearch = G.time + 5; return;
      }
      if (r) { u.onWall = true; u.x = s.x + 0.5; u.y = s.y + 0.6; u.path = null; }
      if (shootNearest(G, u, dt, 0)) u.moving = false;
      return;
    }
    // no battlements: defend from the courtyard
    const ks = G.kingSpot;
    if (!shootNearest(G, u, dt, 0)) {
      if (K.dist(u.x, u.y, ks.x, ks.y) > 3) goTo(G, u, dt, (i) => K.dist(i & NM, i >> NS, ks.x, ks.y) < 2.5, ks.x, ks.y, 'guard');
      else wander(G, u, dt, ks.x + 0.5, ks.y + 0.5, 2);
    }
  }
  function shootNearest(G, u, dt, bonus) {
    const st = K.unitStats(u);
    const t = K.nearestRanged(G, u.x, u.y, st.range + bonus, K.unitH(G, u), 1);
    if (!t) return false;
    u.face = t.x > u.x ? 1 : -1;
    if (u.cd <= 0) {
      u.cd = st.cd * (0.9 + Math.random() * 0.2);
      u.atkAnim = 0.25;
      K.shoot(G, 'arrow', u.x, u.y - (u.onWall ? 1.2 : 0.8), t.x + (Math.random() - 0.5) * 0.3, t.y - 0.4, { team: 0, dmg: st.dmg, target: t, fromWall: u.onWall });
    }
    return true;
  }

  function doMelee(G, u, dt, guardR) {
    const w = G.world, o = w.computeOutside(), ks = G.kingSpot;
    const st = K.unitStats(u);
    // engage enemies inside the castle, or near the King
    let t = u.foe && !u.foe.dead && !u.foe.hidden && !u.foe.retreat ? u.foe : null;
    if (!t || u.reFoe <= G.time) {
      u.reFoe = G.time + 1;
      const enclosed = w.isEnclosed();
      t = K.nearest(G, u.x, u.y, 14, 1, (v) => v.onWall || !o[tileOf(v)] || ((!enclosed || G.phase !== 'defense') && K.dist(v.x, v.y, ks.x, ks.y) < guardR));
      if (t !== u.foe) u.path = null;
      u.foe = t;
    }
    const d0 = t ? Math.hypot(t.x - u.x, t.y - u.y) : 1e9;
    // chop down an adjacent ladder unless a foe is already in reach
    const adj = nearLadder(G, u.x, u.y, 1.7);
    if (adj >= 0 && !u.onWall && !(d0 <= st.range && K.meleeOk(G, u, t))) return hitLadder(G, u, adj, 1);
    if (!t && !u.onWall) {
      // nothing to fight: go and throw down ladders on the walls
      const lad = nearLadder(G, u.x, u.y, 22);
      if (lad >= 0) {
        const lx = lad & NM, ly = lad >> NS;
        const r = goTo(G, u, dt, (i) => !o[i] && i !== lad && Math.abs((i & NM) - lx) <= 1 && Math.abs((i >> NS) - ly) <= 1, lx, ly, 'lad' + lad);
        if (r !== null) return;
      }
    }
    if (t) {
      const d = d0;
      if (d <= st.range && K.meleeOk(G, u, t)) return melee(G, u, t, st);
      const ti = tileOf(t);
      if (!u.path || u.pathTarget !== ti) { u.path = null; u.pathTarget = ti; }
      const r = goTo(G, u, dt, (i) => K.dist(i & NM, i >> NS, ti & NM, ti >> NS) < 1.5, ti & NM, ti >> NS, 'foe' + ti);
      if (r === null || r) { if (d < 2.5 && K.meleeOk(G, u, t)) stepToward(w, u, t.x, t.y, dt, st.speed); else u.foe = null; }
      return;
    }
    const gx = ks.x + ((u.id * 7) % 5) - 2, gy = ks.y + ((u.id * 3) % 3);
    if (K.dist(u.x, u.y, gx, gy) > 3) { if (goTo(G, u, dt, (i) => K.dist(i & NM, i >> NS, gx, gy) < 2.5, gx, gy, 'g' + gx + ',' + gy) === null) wander(G, u, dt, u.x, u.y, 1); }
    else wander(G, u, dt, gx + 0.5, gy + 0.5, 1.5);
  }
  function melee(G, u, t, st) {
    u.moving = false;
    u.face = t.x > u.x ? 1 : -1;
    if (u.cd <= 0) {
      u.cd = st.cd * (0.9 + Math.random() * 0.2);
      u.atkAnim = 0.25;
      K.damage(G, t, st.dmg * (0.85 + Math.random() * 0.3));
    }
  }
  K.melee = melee;

  // Attack-move: march to the ordered spot, fight anything near it (siege engines first), then hold there.
  function doOrder(G, u, dt) {
    const o = u.order, st = K.unitStats(u), w = G.world;
    const ox = o.x + 0.5, oy = o.y + 0.5;
    const archer = u.job === 'archer';
    const near = (v) => Math.hypot(v.x - ox, v.y - oy) < 6;
    // targets: siege engines at the spot, then anyone at the spot, then anyone already in reach
    const myR = (v) => (archer ? K.rangeVs(st.range, K.unitH(G, u), K.unitH(G, v)) : st.range);
    let t = u.foe && !u.foe.dead && !u.foe.hidden && !u.foe.retreat && (near(u.foe) || Math.hypot(u.foe.x - u.x, u.foe.y - u.y) < myR(u.foe) + 0.5) ? u.foe : null;
    if (!t || u.reFoe <= G.time) {
      u.reFoe = G.time + 0.8;
      const reach = archer ? st.range : 2.5;
      t = K.nearest(G, ox, oy, 6, 1, (v) => !!K.UDEF[v.type].siege) || K.nearest(G, ox, oy, 6, 1) || (archer ? K.nearestRanged(G, u.x, u.y, reach, K.unitH(G, u), 1) : K.nearest(G, u.x, u.y, reach, 1, (v) => K.meleeOk(G, u, v)));
      if (t !== u.foe) u.path = null;
      u.foe = t;
    }
    if (t) {
      const d = Math.hypot(t.x - u.x, t.y - u.y);
      if (archer) {
        if (d <= myR(t)) {
          u.moving = false; u.face = t.x > u.x ? 1 : -1;
          if (u.cd <= 0) {
            u.cd = st.cd * (0.9 + Math.random() * 0.2); u.atkAnim = 0.25;
            K.shoot(G, 'arrow', u.x, u.y - 0.8, t.x + (Math.random() - 0.5) * 0.3, t.y - 0.4, { team: 0, dmg: st.dmg, target: t });
          }
          return;
        }
      } else if (d <= st.range + (K.UDEF[t.type].big ? 0.6 : 0) && K.meleeOk(G, u, t)) return melee(G, u, t, st);
      const ti = tileOf(t), want = archer ? st.range - 1 : 1.5;
      const r = goTo(G, u, dt, (i) => K.dist(i & NM, i >> NS, ti & NM, ti >> NS) < want, ti & NM, ti >> NS, 'of' + ti);
      if (r === null || r) { if (!archer && d < 2.5) stepToward(w, u, t.x, t.y, dt, st.speed); else u.foe = null; }
      return;
    }
    if (K.dist(u.x, u.y, ox, oy) > 2) {
      const r = goTo(G, u, dt, (i) => K.dist(i & NM, i >> NS, o.x, o.y) < 2, o.x, o.y, 'ord' + o.x + ',' + o.y);
      if (r === null) {
        if (!o.warned) { o.warned = true; G.msg('Some soldiers cannot reach that spot — they will hold as close as they can.', 'warn'); }
        wander(G, u, dt, u.x, u.y, 0.5);
      }
    } else wander(G, u, dt, ox, oy, 1.2);
  }

  // A subject shut off from the Keep (walled in, cut off by water, standing in a structure) and with no
  // way out finds the cheapest way home anyway: climbing over structures, swimming, or scrambling over rock.
  function planEscape(G, u) {
    const w = G.world, home = K.homeRegion(G), k = w.keep;
    if (!home || !k) return null;
    const cost = (j) => {
      const sid = w.sgrid[j];
      if (sid === k.id) return 0;
      if (w.fPass(j)) return w.fCost(j);
      if (sid) return 6;
      const t = w.terrain[j];
      return t === T.MOUNTAIN ? 14 : K.isWater(t) ? 4 : 3;
    };
    const s = tileOf(u), g = new Map([[s, 0]]), from = new Map([[s, -1]]), done = new Set(), heap = new K.Heap();
    heap.push(0, s);
    let n = 0, end = -1;
    while (heap.size && n++ < 40000) {
      const i = heap.pop();
      if (done.has(i)) continue;
      done.add(i);
      if (home[i]) { end = i; break; }
      const x = i & NM, y = i >> NS;
      for (const [dx, dy, len] of K.DIRS8) {
        if (!K.inb(x + dx, y + dy)) continue;
        const j = K.idx(x + dx, y + dy), c = cost(j);
        if (!c) continue;
        const ng = g.get(i) + c * len;
        if (!g.has(j) || ng < g.get(j)) { g.set(j, ng); from.set(j, i); heap.push(ng, j); }
      }
    }
    if (end < 0) return null;
    const path = [];
    for (let i = end; i !== s && i >= 0; i = from.get(i)) path.push(i);
    return path.reverse();
  }
  function escape(G, u, dt) {
    const w = G.world, i = u.escape[0];
    const tx = (i & NM) + 0.5, ty = (i >> NS) + 0.5, d = K.dist(u.x, u.y, tx, ty);
    const step = (K.unitStats(u).speed * dt) / (w.fPass(i) ? w.fCost(i) : 2);
    u.moving = true; u.state = 'walk';
    if (Math.abs(tx - u.x) > 0.05) u.face = tx > u.x ? 1 : -1;
    if (d <= step) { u.x = tx; u.y = ty; u.escape.shift(); if (!u.escape.length) { u.escape = null; u.path = null; u.moving = false; } }
    else { u.x += ((tx - u.x) / d) * step; u.y += ((ty - u.y) / d) * step; }
  }
  function updateFriendly(G, u, dt) {
    const w = G.world;
    const danger = G.phase === 'defense' || G.recall;
    if (u.escape) return escape(G, u, dt);
    if (u.evac != null) {
      // step out of an enclosure that is about to be closed
      const es = w.structs.get(u.evac), R = es && es.type === 'site' && finishRegion(G, es);
      if (!R || R[tileOf(u)] || u.hidden || u.onWall) u.evac = null;
      else {
        const r = goTo(G, u, dt, (i) => !!R[i], es.x + 0.5, es.y + 0.5, 'evac' + es.id);
        if (r === null || r) { u.evac = null; u.path = null; }
        else return;
      }
    }
    if (!u.hidden && !u.onWall && !(u.trapT > G.time)) {
      u.trapT = G.time + 1 + Math.random();
      const home = K.homeRegion(G);
      if (home && !home[tileOf(u)]) {
        const p = planEscape(G, u);
        if (p && p.length) {
          const how = p.some((j) => w.sgrid[j] && !w.fPass(j)) ? 'climbs over the works' : p.some((j) => K.isWater(w.terrain[j]) && !w.fPass(j)) ? 'swims for it' : 'scrambles over the rocks';
          if (!(G.escMsgT > G.time)) { G.escMsgT = G.time + 8; G.msg('A subject cut off from the castle ' + how + ' to get home.', 'info'); }
          u.escape = p; u.path = null; u.wb = null; u.wpath = null;
          return escape(G, u, dt);
        }
      }
    }
    if (u.kind === 'king') {
      const st = K.unitStats(u);
      const t = K.nearest(G, u.x, u.y, st.range, 1, (v) => K.meleeOk(G, u, v));
      if (t) return melee(G, u, t, st);
      // the ruler holds court on the throne inside the Keep
      const ks = G.throne || G.kingSpot, ki = K.idx(ks.x, ks.y);
      if (K.dist(u.x, u.y, ks.x + 0.5, ks.y + 0.65) > 0.2) {
        u.seated = false;
        if (!w.fPass(ki)) return;
        const r = goTo(G, u, dt, (i) => i === ki, ks.x, ks.y, 'ks');
        if (r) stepToward(w, u, ks.x + 0.5, ks.y + 0.65, dt, st.speed);
        else if (r === null && !danger) wander(G, u, dt, u.x, u.y, 1);
      } else { u.moving = false; u.seated = !!G.throne; u.face = 1; }
      return;
    }
    // "All to Keep": everyone, whatever their job, shelters until released
    if (G.allKeep) { if (u.hidden) { u.moving = false; return; } u.order = null; return hide(G, u, dt); }
    if (u.hidden) {
      if (u.job === 'repair' && G.phase === 'defense') {
        if (Math.random() > dt * 0.5) return;
        const o = w.computeOutside();
        let need = false;
        for (const s of w.structs.values()) if (K.needsMason(s) && !o[K.idx(s.x, s.y)]) { need = true; break; }
        if (!need) return;
      } else if (danger && !K.isSoldier(u)) return;
      // come out of the keep
      const ks = G.kingSpot;
      u.hidden = false; u.x = ks.x + 0.5 + (Math.random() - 0.5); u.y = ks.y + 0.5; u.path = null; u.state = null;
      K.unstick(G);
    }
    // non-combatants fight back if cornered
    const st = K.unitStats(u);
    if (!K.isSoldier(u)) {
      // builders on castle works that may be raised during a siege carry on instead of sheltering
      if (danger && !(u.job === 'repair' && (G.phase === 'defense' || (!u.shelt && u.rep && w.structs.has(u.rep.id) && siegeBuild(u.rep))))) return hide(G, u, dt);
      const t = K.nearest(G, u.x, u.y, st.range, 1, (v) => K.meleeOk(G, u, v));
      if (t && G.phase === 'defense') return melee(G, u, t, st);
      if (u.carry) return haul(G, u, dt);
      switch (u.job) {
        case 'dig': return doDig(G, u, dt);
        case 'demo': return doDemo(G, u, dt);
        case 'wood': return doWood(G, u, dt);
        case 'repair': return doRepair(G, u, dt);
        case 'idle': return wander(G, u, dt, w.keep ? w.keep.x + 1.5 : u.x, w.keep ? w.keep.y + 4.5 : u.y, 4);
        default: return doBuildingJob(G, u, dt, K.JOB[u.job].where);
      }
    }
    if (u.order) return doOrder(G, u, dt);
    // archers man the battlements in every phase
    if (u.job === 'archer') return doArcher(G, u, dt);
    doMelee(G, u, dt, danger ? 9 : 30);
  }

  K.updateUnits = function (G, dt) {
    buildGrid(G);
    G.digAssignT = (G.digAssignT || 0) - dt;
    if (G.digAssignT <= 0) { G.digAssignT = 0.5; K.assignDigs(G); }
    for (const u of G.units) {
      if (u.dead) continue;
      u.cd -= dt; u.atkAnim -= dt; u.flash -= dt;
      if (u.team === 0) updateFriendly(G, u, dt);
      else K.updateEnemy(G, u, dt);
    }
    // King capture
    const k = G.king;
    if (!k.dead && G.phase === 'defense' && !G.god) {
      let foes = 0;
      K.around(G, k.x, k.y, 1.6, (v) => { if (v.team === 1 && !v.siege) foes++; });
      const guard = K.nearest(G, k.x, k.y, 4, 0, (v) => K.isSoldier(v) && !v.onWall);
      if (foes >= 3 && !guard) {
        if (G.captureT === 0) G.msg(G.ruler === 'queen' ? 'The Queen is surrounded! Send soldiers to her aid!' : 'The King is surrounded! Send soldiers to his aid!', 'bad');
        G.captureT += dt;
        if (G.captureT > 6) G.captured = true;
      } else G.captureT = Math.max(0, G.captureT - dt * 0.5);
    }
  };
})();

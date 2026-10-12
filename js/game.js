'use strict';
// Game state, phases, economy, jobs and the build API.
(function () {
  const T = K.T;
  let N, NM, NS;
  K.onSize(() => { N = K.N; NM = N - 1; NS = Math.log2(N); });

  K.rulerName = (G) => (G && G.ruler === 'queen' ? 'Queen' : 'King');
  K.newGame = function (seed, opts) {
    K.setSize(K.SURVEY_N);
    const gen = K.genMap(seed, opts);
    const w = new K.World(gen);
    const G = {
      world: w, seed, opts: gen.opts,
      res: { stone: 200, lumber: 250, plank: 0, ore: 0, iron: 30, food: 220 },
      units: [], monsters: [], projectiles: [], particles: [], messages: [],
      phase: 'place', timer: K.BUILD_TIME, round: 0, recall: false,
      activeEntries: [], spawnQueue: [], defenseLen: 0,
      time: 0, nextId: 1, farmGrowth: 0,
      popT: 0, starveT: 0, captureT: 0, horses: 0, horseAlloc: {},
      reserved: new Set(), postTaken: new Map(),
      stats: { kills: 0, lost: 0 },
      pathBudget: 0,
      rand: K.rng(seed * 7 + 1),
    };
    w.plan = new Set();
    G.kingSpot = null; G.king = null;
    G.shaped = new Map();
    spawnMonsters(G);
    G.activeEntries = [];
    K.placeBeasts(G);
    G.msg = (text, kind) => G.messages.push({ text, kind: kind || 'info', t: G.time });
    G.msg('Survey the land and choose where to raise your Keep.', 'info');
    return G;
  };

  function spawnMonsters(G) {
    const w = G.world;
    G.monsters = [];
    for (const L of w.lakes) {
      if (!L.monster) continue;
      // start the monster on the deepest-looking tile (closest to the lake centre)
      let best = L.tiles[0], bd = 1e9;
      for (const i of L.tiles) { const d = K.dist(i & NM, i >> NS, L.cx, L.cy); if (d < bd) { bd = d; best = i; } }
      G.monsters.push({ x: (best & NM) + 0.5, y: (best >> NS) + 0.5, path: null, pi: 0, wait: 0, cd: 0, attacking: 0, atkAng: 0, submerged: 0, phase: Math.random() * 10 });
    }
  }

  // Top-left of the playable realm for a keep at (x, y) on the survey map (keep centred).
  const realmOrigin = (x, y) => ({ x0: x + 1 - K.PLAY_N / 2, y0: y + 1 - K.PLAY_N / 2 });
  // While surveying, the keep must sit far enough from the edge for the realm to fit.
  K.realmFits = (x, y) => {
    if (K.N <= K.PLAY_N) return true;
    const { x0, y0 } = realmOrigin(x, y);
    return x0 >= 0 && y0 >= 0 && x0 + K.PLAY_N <= K.N && y0 + K.PLAY_N <= K.N;
  };

  // Shrink the survey map to the realm around the keep site; returns the keep's new top-left.
  function cropToRealm(G, x, y) {
    const big = G.world, bigN = K.N, { x0, y0 } = realmOrigin(x, y), n = K.PLAY_N;
    const gen = K.cropMap(big, x0, y0, n, { x: x + 1 - x0, y: y + 1 - y0 });
    const w = new K.World(gen);
    G.survey = { world: big, N: bigN, x0, y0, beasts: G.beasts, monsters: G.monsters };
    G.world = w;
    G.beasts = (G.beasts || []).filter((b) => b.hx - x0 > 3 && b.hy - y0 > 3 && b.hx - x0 < n - 3 && b.hy - y0 < n - 3 &&
      w.entries.every((e) => K.dist(b.hx - x0, b.hy - y0, e.x, e.y) >= 14));
    for (const b of G.beasts) { b.x -= x0; b.y -= y0; b.hx -= x0; b.hy -= y0; b.gx = b.gy = null; }
    spawnMonsters(G);
    return { x: x - x0, y: y - y0 };
  }
  // Undo cropToRealm when the site turns out to be unusable.
  function uncrop(G) {
    const S = G.survey;
    for (const b of G.beasts) { b.x += S.x0; b.y += S.y0; b.hx += S.x0; b.hy += S.y0; }
    G.world = S.world; G.beasts = S.beasts; G.monsters = S.monsters;
    K.setSize(S.N);
    G.survey = null;
  }

  // Before the keep is placed the player may reshape a few tiles of the survey map:
  // water or mountain becomes land (e.g. to reach a perfect but cut-off site). Shaping a tile
  // again restores it and refunds the point.
  K.SHAPE_BUDGET = 40;
  K.shapeState = (G, x, y) => {
    if (!K.inb(x, y)) return null;
    const i = K.idx(x, y), t = G.world.terrain[i];
    if (G.shaped.has(i)) return 'undo';
    if (t === T.MINE) return null;
    return K.isWater(t) || t === T.MOUNTAIN ? 'raise' : null;
  };
  K.shapeLand = function (G, x, y, mode) {
    const w = G.world;
    if (G.phase !== 'place') return false;
    const st = K.shapeState(G, x, y);
    if (!st || (mode && st !== mode)) return false;
    const i = K.idx(x, y);
    if (st === 'undo') {
      const o = G.shaped.get(i);
      G.shaped.delete(i);
      w.terrain[i] = o.t; w.elev[i] = o.e;
      if (o.lake) { o.lake.tiles.push(i); w.lakeId[i] = o.lake.id; }
    } else {
      if (G.shaped.size >= K.SHAPE_BUDGET) { G.msg('No land-shaping left — undo a shaped tile to move it elsewhere.', 'warn'); return false; }
      const t = w.terrain[i], lid = w.lakeId[i], lake = lid >= 0 ? w.lakes[lid] : null;
      G.shaped.set(i, { t, e: w.elev[i], lake: t === T.LAKE ? lake : null });
      // settle at the lowest neighbouring land level
      let e = 9;
      for (const [dx, dy] of K.DIRS8) {
        if (!K.inb(x + dx, y + dy)) continue;
        const j = K.idx(x + dx, y + dy), tj = w.terrain[j];
        if (!K.isWater(tj) && tj !== T.MOUNTAIN) e = Math.min(e, w.elev[j]);
      }
      w.terrain[i] = T.GRASS; w.elev[i] = e < 9 ? e : (t === T.MOUNTAIN ? 3 : 0);
      if (t === T.LAKE && lake) {
        lake.tiles = lake.tiles.filter((j) => j !== i); w.lakeId[i] = -1;
        for (const m of G.monsters)
          if (Math.floor(m.x) === x && Math.floor(m.y) === y && lake.tiles.length) { const j = lake.tiles[0]; m.x = (j & NM) + 0.5; m.y = (j >> NS) + 0.5; m.path = null; }
      }
    }
    for (const [dx, dy] of K.DIRS8) if (K.inb(x + dx, y + dy)) w.touch(x + dx, y + dy);
    w.touch(x, y); w.bump();
    return true;
  };

  // Can the 3x3 keep go with its top-left corner at (x, y)?
  K.keepSiteOk = function (G, x, y) {
    const w = G.world, M = 12;
    if (x < M || y < M || x + 3 > N - M || y + 4 > N - M) return { ok: false, reason: 'Too close to the edge of the map' };
    if (!K.realmFits(x, y)) return { ok: false, reason: `Too close to the edge — your ${K.PLAY_N}×${K.PLAY_N} realm must fit on the map` };
    const r = w.canPlace('keep', x, y, G);
    if (!r.ok) return r;
    for (const e of w.entries) if (K.dist(x + 1, y + 1, e.x, e.y) < 36) return { ok: false, reason: 'Too close to where enemies enter the map' };
    const ks = K.idx(x + 1, y + 3), t = w.terrain[ks];
    if (!w.fPass(ks) || t === T.MINE || t === T.ROCK || Math.abs(w.elev[ks] - w.elev[K.idx(x + 1, y + 1)]) > 1) return { ok: false, reason: "The " + K.rulerName(G) + "'s courtyard (south of the keep) must be open ground" };
    let open = 0;
    for (let dy = -3; dy <= 6; dy++) for (let dx = -3; dx <= 5; dx++) { const i = K.idx(x + dx, y + dy); if (w.fPass(i) && !w.sgrid[i]) open++; }
    if (open < 50) return { ok: false, reason: 'Not enough open ground around the keep' };
    for (const b of G.beasts || []) if (!b.dead && K.dist(x + 1, y + 1, b.hx, b.hy) < 6) return { ok: false, reason: 'Right on top of a beast\'s lair!' };
    return { ok: true };
  };

  K.placeKeep = function (G, x, y) {
    if (G.phase !== 'place') return false;
    const r = K.keepSiteOk(G, x, y);
    if (!r.ok) { G.msg(r.reason + '.', 'warn'); return false; }
    let cropped = false;
    if (K.N > K.PLAY_N) { ({ x, y } = cropToRealm(G, x, y)); cropped = true; }
    const w = G.world;
    w.place('keep', x, y);
    if (!w.hasExit()) {
      w.remove(w.keep); w.keep = null;
      if (cropped) uncrop(G);
      G.msg('That site is hemmed in — your subjects could never leave.', 'warn');
      return false;
    }
    chooseEntries(G);
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) w.stump[K.idx(x + dx, y + dy)] = 0;
    G.kingSpot = { x: x + 1, y: y + 3 };
    // the Keep is a hollow hall: an open throne tile in the middle, a door in the south wall
    G.throne = { x: x + 1, y: y + 1 };
    w.sgrid[K.idx(x + 1, y + 1)] = 0; w.touch(x + 1, y + 1);
    w.place('keepdoor', x + 1, y + 2, { hp: K.SDEF.keepdoor.hp, maxHp: K.SDEF.keepdoor.hp });
    G.king = K.spawnUnit(G, 'king', G.throne.x + 0.5, G.throne.y + 0.65);
    G.king.sprite = G.ruler === 'queen' ? 'queen' : 'king';
    let n = 0;
    for (let rad = 2.5; n < 14 && rad < 9; rad += 1)
      for (let k = 0; k < 16 && n < 14; k++) {
        const a = (k / 16) * Math.PI * 2, px = x + 1.5 + Math.cos(a) * rad, py = y + 2 + Math.sin(a) * rad;
        const i = K.idx(Math.floor(px), Math.floor(py));
        if (!w.fPass(i) || w.sgrid[i]) continue;
        K.spawnUnit(G, 'subject', px, py); n++;
      }
    while (n++ < 14) K.spawnUnit(G, 'subject', G.kingSpot.x + 0.5, G.kingSpot.y + 0.5);
    // a few Builders to start, since every building needs builders
    for (const u of G.units.filter((v) => v.kind === 'subject').slice(0, 3)) K.setJob(G, u, 'repair');
    G.phase = 'build';
    G.timer = K.BUILD_TIME;
    G.msg('Build your castle! The first assault comes in 5 minutes.', 'good');
    return true;
  };

  // God mode: invincible + unlimited resources (testing aid)
  K.setGod = function (G, on) {
    if (!!G.god === on) return;
    G.god = on;
    if (on) { G.realRes = Object.assign({}, G.res); fillRes(G); G.captureT = 0; G.msg('God mode enabled — invincible, unlimited resources.', 'info'); }
    else { if (G.realRes) G.res = G.realRes; G.realRes = null; G.msg('God mode disabled.', 'info'); }
  };
  function fillRes(G) { for (const k in G.res) G.res[k] = 99999; }

  function chooseEntries(G) {
    const n = G.round + 1;
    const count = n <= 3 ? 1 : n <= 7 ? 2 : 3;
    const all = G.world.entries.slice();
    const out = [];
    while (out.length < count && all.length) out.push(all.splice(Math.floor(G.rand() * all.length), 1)[0]);
    G.activeEntries = out;
  }

  // ---------------- units ----------------
  K.spawnUnit = function (G, kind, x, y, type) {
    const u = {
      id: G.nextId++, kind, team: kind === 'enemy' ? 1 : 0, x, y,
      job: 'idle', type: type || (kind === 'king' ? 'king' : 'subject'),
      sprite: type || (kind === 'king' ? 'king' : 'subject'),
      cd: 0, atkAnim: 0, flash: 0, face: 1, moving: false, path: null, pi: 0, state: null,
      ox: (Math.random() - 0.5) * 0.5, oy: (Math.random() - 0.5) * 0.5, noise: Math.random() * 0.4,
    };
    const st = K.unitStats(u);
    u.hp = u.maxHp = st.hp;
    // tougher (or softer) enemies on custom difficulty
    if (u.team === 1 && G.opts && G.opts.difficulty !== 1) u.hp = u.maxHp = Math.round(st.hp * (0.5 + 0.5 * G.opts.difficulty));
    if (type === 'e_boat') u.boat = true;
    if (type === 'e_engineer') u.eMode = Math.random() < 0.65 ? 'bridge' : 'fill';
    if (type === 'e_ladder') u.hasLadder = true;
    G.units.push(u);
    return u;
  };
  const mountedStats = {};
  K.unitStats = function (u) {
    if (u.kind === 'enemy') return K.UDEF[u.type];
    if (u.kind === 'king') return K.UDEF.king;
    const st = K.UDEF[u.job] || K.UDEF.subject;
    if (!u.horse) return st;
    if (u.job === 'knight') return K.UDEF.cavalry;
    return mountedStats[u.job] || (mountedStats[u.job] = Object.assign({}, st, { speed: st.speed * K.HORSE.speed }));
  };
  K.isSoldier = (u) => u.job === 'archer' || u.job === 'infantry' || u.job === 'knight';

  K.isCivil = (job) => job !== 'idle' && !K.JOB[job].soldier;
  // Workers who leave a civil job may not fight until a full round has passed, and vice versa.
  K.lockedFor = (G, u, job) => (K.JOB[job].soldier ? (u.noSoldierUntil || 0) : (u.noCivilUntil || 0)) > G.round;
  K.setJob = function (G, u, job) {
    if (job === 'idle' && K.isCivil(u.job)) u.noSoldierUntil = G.round + 1;
    if (job === 'idle' && K.isSoldier(u)) u.noCivilUntil = G.round + 1;
    releaseJob(G, u);
    if (u.horse) { u.horse = false; G.horses++; }
    u.order = null;
    const ratio = u.hp / u.maxHp;
    u.job = job;
    u.sprite = job === 'idle' ? 'subject' : job;
    const st = K.unitStats(u);
    u.maxHp = st.hp;
    u.hp = Math.max(1, Math.round(st.hp * ratio));
    if (u.onWall) stepOffWall(G, u);
    u.state = null; u.path = null; u.onWall = false; u.wallPath = null; u.wb = null; u.wpath = null;
  };
  function releaseJob(G, u) {
    if (u.work) { u.work.workers.delete(u.id); u.work = null; }
    K.dropTree(G, u);
    if (u.post != null) { G.postTaken.delete(u.post); u.post = null; }
    u.manualPost = false;
    if (u.chT != null) { G.reserved.delete('c' + u.chT); u.chT = null; }
    if (u.digT != null) { G.reserved.delete(u.digT); if (G.world.digProg) G.world.digProg.delete(u.digT); u.digT = null; }
    u.digStands = null; u.digging = 0;
  }
  K.releaseJob = releaseJob;
  K.dropTree = function (G, u) {
    if (u.tree != null) G.reserved.delete(u.tree);
    if (u.stand != null) G.reserved.delete('s' + u.stand);
    u.tree = null; u.stand = null;
  };

  // Station an archer on a chosen battlement (s = wall struct, or null to return to auto)
  function stepOffWall(G, u) {
    if (!u.onWall) return;
    const w = G.world, o = w.computeOutside(), x = Math.floor(u.x), y = Math.floor(u.y);
    let spot = null;
    for (const [dx, dy] of K.DIRS4) {
      const j = K.idx(x + dx, y + dy);
      if (!K.inb(x + dx, y + dy) || !w.fPass(j)) continue;
      if (!o[j]) { spot = [dx, dy]; break; }
      if (!spot) spot = [dx, dy];
    }
    if (spot) { u.x = x + spot[0] + 0.5; u.y = y + spot[1] + 0.5; }
    u.onWall = false; u.wallPath = null;
  }
  K.stepOffWall = stepOffWall;
  // Player orders: send soldiers to attack an area until the order is cleared
  K.orderUnits = function (G, us, x, y) {
    let n = 0;
    for (const u of us) {
      if (u.dead || !K.isSoldier(u)) continue;
      if (u.job === 'archer') {
        stepOffWall(G, u);
        if (u.post != null) G.postTaken.delete(u.post);
        u.post = null; u.manualPost = false;
      }
      u.order = { x: K.clamp(Math.floor(x), 0, N - 1), y: K.clamp(Math.floor(y), 0, N - 1), warned: false };
      u.path = null; u.foe = null; u.hidden = false;
      n++;
    }
    return n;
  };
  K.clearOrders = function (G, us) {
    let n = 0;
    for (const u of us) if (u.order) { u.order = null; u.path = null; u.foe = null; n++; }
    return n;
  };
  // archers free to be assigned: those not stationed by the player
  K.freeArchers = (G) => G.units.filter((u) => u.team === 0 && !u.dead && u.job === 'archer' && !u.manualPost && !u.hidden);
  K.archerOn = (G, s) => { const id = G.postTaken.get(s.id); return id == null ? null : G.units.find((x) => x.id === id && !x.dead && x.job === 'archer') || null; };
  // Assign the nearest free archer to battlement s
  K.assignBattlement = function (G, s) {
    if (!s || s.type !== 'wall' || !s.battlement) return false;
    if (K.archerOn(G, s)) { G.msg('That battlement is already manned.', 'warn'); return false; }
    const free = K.freeArchers(G);
    if (!free.length) { G.msg('No unassigned archers — train more or unassign one.', 'warn'); return false; }
    // prefer archers without any post, then the nearest
    free.sort((a, b) => (a.post != null) - (b.post != null) || K.dist(a.x, a.y, s.x, s.y) - K.dist(b.x, b.y, s.x, s.y));
    s.noAuto = false;
    return K.postArcher(G, free[0], s);
  };
  // Send the archer off battlement s; the battlement stays empty until assigned again
  K.unassignBattlement = function (G, s) {
    const u = K.archerOn(G, s);
    s.noAuto = true;
    if (!u) return false;
    G.postTaken.delete(s.id);
    u.post = null; u.manualPost = false; u.path = null; u.postSearch = G.time + 2; stepOffWall(G, u);
    G.msg('Archer unassigned from the battlement.', 'info');
    return true;
  };
  K.postArcher = function (G, u, s) {
    if (!u || u.dead || u.job !== 'archer') return false;
    if (!s) {
      if (u.post != null) G.postTaken.delete(u.post);
      u.post = null; u.manualPost = false; u.path = null; stepOffWall(G, u);
      G.msg('Archer returns to choosing their own post.', 'info');
      return true;
    }
    if (s.type !== 'wall' || !s.battlement) { G.msg('Archers can only be stationed on battlements.', 'warn'); return false; }
    if (u.post === s.id) return true;
    const old = u.post;
    const vid = G.postTaken.get(s.id);
    const v = vid != null && vid !== u.id ? G.units.find((x) => x.id === vid && !x.dead) : null;
    if (old != null) G.postTaken.delete(old);
    stepOffWall(G, u);
    if (v) {
      // swap: the displaced archer takes this archer's old post, or picks a new one
      stepOffWall(G, v);
      v.path = null; v.manualPost = false; v.post = null;
      if (old != null && G.world.structs.has(old)) { v.post = old; G.postTaken.set(old, v.id); }
    }
    u.post = s.id; u.manualPost = true; u.path = null; u.idleT = 0;
    G.postTaken.set(s.id, u.id);
    G.msg('Archer stationed on the battlement.', 'good');
    return true;
  };

  K.subjects = (G) => G.units.filter((u) => u.kind === 'subject' && !u.dead);
  K.jobCount = function (G) {
    const c = { idle: 0 };
    for (const j of K.JOBS) c[j.id] = 0;
    for (const u of G.units) if (u.kind === 'subject' && !u.dead) c[u.job]++;
    return c;
  };
  // Storage cap for a resource: the Keep plus every finished storage building.
  K.STORED = ['food', 'lumber', 'plank', 'stone', 'ore', 'iron'];
  K.resCap = function (G, r) {
    let c = 0;
    for (const s of G.world.structs.values()) { const st = K.SDEF[s.type].store; if (st && st[r]) c += st[r]; }
    return c;
  };
  K.foodCap = (G) => K.resCap(G, 'food');
  // ---------- horses ----------
  K.horseCap = function (G) {
    let c = 0;
    for (const s of G.world.structs.values()) c += K.SDEF[s.type].horses || 0;
    return c;
  };
  K.mounted = (G) => G.units.filter((u) => u.kind === 'subject' && !u.dead && u.horse);
  K.horseTotal = (G) => G.horses + K.mounted(G).length;
  K.buyHorse = function (G) {
    if (K.horseTotal(G) >= K.horseCap(G)) { G.msg('Your stables are full — build more Stables.', 'warn'); return false; }
    if (!K.canAfford(G, K.HORSE.cost)) { G.msg('Not enough resources to raise a horse (' + K.costText(K.HORSE.cost) + ').', 'warn'); return false; }
    K.pay(G, K.HORSE.cost);
    G.horses++;
    // a new horse goes to an unmounted knight by default
    const kn = G.units.filter((u) => u.kind === 'subject' && !u.dead && u.job === 'knight').length;
    if ((G.horseAlloc.knight || 0) < kn) G.horseAlloc.knight = (G.horseAlloc.knight || 0) + 1;
    return true;
  };
  K.allocHorse = function (G, job, d) {
    const a = G.horseAlloc, cur = a[job] || 0;
    let sum = 0;
    for (const k in a) sum += a[k];
    if (d > 0 && sum >= K.horseTotal(G)) return false;
    a[job] = Math.max(0, cur + d);
    K.updateHorses(G);
    return true;
  };
  function setMount(G, u, on) {
    const ratio = u.hp / u.maxHp;
    u.horse = on;
    if (u.job === 'knight') u.sprite = on ? 'cavalry' : 'knight';
    const st = K.unitStats(u);
    u.maxHp = st.hp;
    u.hp = Math.max(1, Math.round(st.hp * ratio));
  }
  // Match riders to the allocation table; horses are lost if Stables are destroyed or sold.
  K.updateHorses = function (G) {
    const cap = K.horseCap(G);
    let riders = K.mounted(G);
    let over = G.horses + riders.length - cap;
    if (over > 0) {
      const p = Math.min(over, G.horses);
      G.horses -= p; over -= p;
      for (let k = 0; k < over; k++) setMount(G, riders[k], false);
      G.msg('Without enough Stables, some of your horses have run off.', 'warn');
      riders = K.mounted(G);
    }
    const a = G.horseAlloc;
    let sum = 0;
    for (const k in a) sum += a[k];
    const tot = G.horses + riders.length;
    // trim the allocation if horses were lost
    for (let j = K.JOBS.length - 1; j >= 0 && sum > tot; j--) { const id = K.JOBS[j].id, t = Math.min(a[id] || 0, sum - tot); a[id] = (a[id] || 0) - t; sum -= t; }
    if (a.idle) { sum -= a.idle; a.idle = 0; }
    for (const j of K.JOBS) {
      const want = a[j.id] || 0;
      const us = G.units.filter((u) => u.kind === 'subject' && !u.dead && u.job === j.id);
      let have = us.filter((u) => u.horse).length;
      for (const u of us) {
        if (have > want && u.horse) { setMount(G, u, false); G.horses++; have--; }
      }
      for (const u of us) {
        if (have < want && !u.horse && G.horses > 0) { setMount(G, u, true); G.horses--; have++; }
      }
    }
  };
  K.housing = function (G) {
    let h = 0;
    for (const s of G.world.structs.values()) h += K.SDEF[s.type].housing || 0;
    return h;
  };
  K.hasStruct = (G, type) => { for (const s of G.world.structs.values()) if (s.type === type) return true; return false; };
  K.soldierCap = function (G) {
    let n = 0;
    for (const s of G.world.structs.values()) n += K.SDEF[s.type].soldiers || 0;
    return n;
  };
  K.soldierCount = (G) => G.units.filter((v) => v.kind === 'subject' && !v.dead && K.isSoldier(v)).length;
  // Put a freshly trained soldier beside a random barracks
  function musterAt(G, u) {
    const w = G.world, bs = [...w.structs.values()].filter((s) => s.type === 'barracks');
    if (!bs.length) return;
    const order = bs.sort(() => G.rand() - 0.5);
    for (const b of order) {
      const spots = [];
      for (let x = b.x - 1; x <= b.x + b.w; x++) for (let y = b.y - 1; y <= b.y + b.h; y++) {
        if ((x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) || !K.inb(x, y)) continue;
        if (w.fPass(K.idx(x, y))) spots.push([x, y]);
      }
      if (!spots.length) continue;
      const [x, y] = spots[Math.floor(G.rand() * spots.length)];
      u.x = x + 0.5; u.y = y + 0.5; u.hidden = false; u.path = null; u.moving = false;
      K.fx(G, u.x, u.y - 1, 'Mustered!', '#9ad0ff');
      return;
    }
  }
  // Work places at a building type. Sites of self-built resource buildings count too, since
  // their workers build them; pass builtOnly to count only finished buildings.
  K.slots = function (G, type, builtOnly) {
    let n = 0;
    const self = !builtOnly && K.SELF_BUILD[type];
    for (const s of G.world.structs.values()) if (s.type === type || (self && s.type === 'site' && s.final === type)) n += K.SDEF[type].slots;
    return n;
  };

  K.assignJob = function (G, job, delta) {
    let changed = 0;
    for (let k = 0; k < Math.abs(delta); k++) {
      if (delta > 0) {
        const idle = G.units.filter((v) => v.kind === 'subject' && !v.dead && v.job === 'idle');
        const u = idle.find((v) => !K.lockedFor(G, v, job));
        if (!u) {
          if (!changed) {
            if (idle.length) G.msg(K.JOB[job].soldier ? 'Your unassigned subjects just left their work — they must rest a full round before taking up arms.' : 'Your unassigned subjects just left the army — they must wait a full round before returning to civil work.', 'warn');
            else G.msg('No unassigned subjects. Build housing to attract more people.', 'warn');
          }
          break;
        }
        const where = K.JOB[job].where;
        if (where) {
          const sl = K.slots(G, where);
          if (G.units.filter((v) => v.kind === 'subject' && !v.dead && v.job === job).length >= sl) {
            if (!changed) G.msg(sl ? `All ${sl} ${K.JOB[job].name.toLowerCase()} places are filled. Build another ${K.SDEF[where].name} for more.` : `Build a ${K.SDEF[where].name} first.`, 'warn');
            break;
          }
        }
        const needs = K.JOB[job].needs;
        if (needs && !K.hasStruct(G, needs)) { G.msg('Build ' + K.SDEF[needs].name + ' to train ' + K.JOB[job].name + ' crews.', 'warn'); break; }
        if (K.JOB[job].soldier) {
          const cap = K.soldierCap(G);
          if (!cap) { G.msg('Build a Barracks to train soldiers.', 'warn'); break; }
          if (K.soldierCount(G) >= cap) { G.msg(`Soldier cap reached (${cap}). Build another Barracks to train more.`, 'warn'); break; }
        }
        const cost = K.JOB[job].cost;
        if (cost && !K.canAfford(G, cost)) { G.msg('Not enough resources to train ' + K.JOB[job].name + ' (' + K.costText(cost) + ').', 'warn'); break; }
        if (cost) K.pay(G, cost);
        K.setJob(G, u, job);
        if (K.JOB[job].soldier) musterAt(G, u);
      } else {
        const cands = G.units.filter((v) => v.kind === 'subject' && !v.dead && v.job === job);
        if (!cands.length) break;
        cands.sort((a, b) => (a.state === 'work' ? 1 : 0) - (b.state === 'work' ? 1 : 0));
        K.setJob(G, cands[0], 'idle');
      }
      changed++;
    }
    return changed;
  };

  K.canAfford = (G, cost) => Object.entries(cost).every(([k, v]) => (G.res[k] || 0) >= v);
  K.pay = (G, cost) => { for (const k in cost) G.res[k] -= cost[k]; };
  K.refund = (G, cost, f) => { for (const k in cost) G.res[k] += Math.floor(cost[k] * f); };

  K.fx = function (G, x, y, text, color) {
    G.particles.push({ kind: 'text', x, y, vx: 0, vy: -0.5, life: 1.6, max: 1.6, text, color });
  };

  // ---------------- building ----------------
  function walkableType(type) { return K.isGate(type) || type === 'farm' || type === 'bridge' || type === 'drawbridge'; }

  // tiles: [{x,y}] (drag builds pass many). Returns number placed.
  // Castle works may be raised during a siege; farms, quarries, mines and bloomeries may not.
  K.canBuildNow = function (G, type) {
    if (G.phase === 'build') return true;
    return G.phase === 'defense' && !K.SDEF[type].eco;
  };

  K.tryBuild = function (G, type, tiles) {
    const w = G.world, d0 = K.SDEF[type];
    if (!K.canBuildNow(G, type)) {
      G.msg(G.phase === 'defense' ? 'Workers cannot build ' + d0.name + 's during a siege — only castle defences.' : 'You cannot build right now.', 'warn');
      return 0;
    }
    if (type === 'demolish') return demolish(G, tiles);
    const valid = [];
    const seen = new Set();
    let reason = '';
    let budget = Object.assign({}, G.res);
    for (const t of tiles) {
      const key = t.x + ',' + t.y;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = Object.assign({}, d0, K.dims(type, t.rot));
      const r = w.canPlace(type, t.x, t.y, G, t.rot);
      if (!r.ok) { reason = r.reason; continue; }
      if (type === 'drawbridge' && !w.dbGroupOk(t.x, t.y, new Set(valid.map((v) => K.idx(v.x, v.y))))) { reason = 'Drawbridges can be at most 2 wide × 3 long'; continue; }
      if (type !== 'trench' && type !== 'fill' && G.kingSpot) {
        const ks = G.kingSpot;
        if (ks.x >= t.x && ks.x < t.x + d.w && ks.y >= t.y && ks.y < t.y + d.h) { reason = "The " + K.rulerName(G) + "'s courtyard must stay clear"; continue; }
      }
      // overlap with other tiles in the same drag
      if (d.w > 1 || d.h > 1) {
        let clash = false;
        for (const v of valid) if (t.x < v.x + v.w && t.x + d.w > v.x && t.y < v.y + v.h && t.y + d.h > v.y) clash = true;
        if (clash) continue;
      }
      if (!Object.entries(d.cost).every(([k, v]) => budget[k] >= v)) { reason = 'Not enough resources (' + K.costText(d.cost) + ')'; break; }
      for (const k in d.cost) budget[k] -= d.cost[k];
      valid.push(Object.assign({ replace: r.replace, kind: r.kind, mount: r.mount, w: d.w, h: d.h }, t));
    }
    if (!valid.length) { if (reason) G.msg(reason, 'warn'); return 0; }

    // exit rule: subjects must always be able to leave the castle
    const ov = new Map();
    if (type === 'trench') {
      const extra = new Set(valid.map((v) => K.idx(v.x, v.y)));
      for (const i of w.plan) extra.add(i);
      for (const i of w.floodSet(extra)) ov.set(i, crossing(w, i));
    } else if (type !== 'battlement' && type !== 'charge') {
      for (const v of valid)
        if (!v.mount) for (let dy = 0; dy < v.h; dy++) for (let dx = 0; dx < v.w; dx++) ov.set(K.idx(v.x + dx, v.y + dy), walkableType(type));
    }
    if (ov.size && !w.hasExit(ov)) {
      G.msg('There must always be a way for subjects to leave the castle! Leave a gap, gate or drawbridge.', 'warn');
      return 0;
    }

    const d = d0, instant = !!(G.god || G.instant);
    let dugUnder = false, sites = 0;
    for (const v of valid) {
      K.pay(G, d.cost);
      if (type === 'charge') {
        w.charges.set(K.idx(v.x, v.y), { kind: v.kind, state: 'planned', prog: 0 });
      } else if (type === 'trench' || type === 'fill') {
        w.plan.add(K.idx(v.x, v.y));
        if (type === 'fill') w.fillPlan.add(K.idx(v.x, v.y));
        w.touch(v.x, v.y);
      } else if (type === 'battlement') {
        const s = w.structAt(v.x, v.y);
        if (instant) { s.battlement = true; s.maxHp += 250; s.hp += 250; }
        else if (s.type === 'site') { s.battle = true; s.time += K.BUILD_SECS.battlement; }
        else s.upg = { prog: 0, time: K.BUILD_SECS.battlement, ord: (G.buildSeq = (G.buildSeq || 0) + 1) };
        w.touch(v.x, v.y); w.bump();
      } else if (v.mount) {
        // the anchor (top-left) wall carries the engine; the others are reserved for it
        const host = w.structAt(v.x, v.y);
        host.engParts = [];
        for (let dy = 0; dy < v.h; dy++) for (let dx = 0; dx < v.w; dx++) { const o = w.structAt(v.x + dx, v.y + dy); if (o !== host) { o.engPart = host.id; host.engParts.push(o.id); } }
        if (instant) host.engine = { type, reload: 0, fired: 0 };
        else { host.upg = { prog: 0, time: K.BUILD_SECS[type] || 20, ord: (G.buildSeq = (G.buildSeq || 0) + 1), engine: type }; sites++; }
        w.touch(v.x, v.y); w.bump();
      } else {
        let battle = false;
        if (v.replace) for (const s of v.replace) { if (s.battle) { battle = true; } w.remove(s); }
        let trees = 0;
        for (let dy = 0; dy < v.h; dy++) for (let dx = 0; dx < v.w; dx++) { const i = K.idx(v.x + dx, v.y + dy); if (w.terrain[i] === T.FOREST) trees++; w.stump[i] = 0; }
        if (trees) G.res.lumber += trees * 3;
        if (battle) K.refund(G, K.SDEF.battlement.cost, 1);
        if (instant) { if (completeStruct(G, w.place(type, v.x, v.y, { w: v.w, h: v.h, rot: v.rot ? 1 : 0 }))) dugUnder = true; }
        else {
          const maxHp = d.hp, time = K.BUILD_SECS[type] || 20;
          w.place('site', v.x, v.y, { final: type, w: v.w, h: v.h, rot: v.rot ? 1 : 0, prog: 0, time, maxHp, hp: Math.max(1, Math.round(maxHp * 0.1)), ord: (G.buildSeq = (G.buildSeq || 0) + 1) });
          sites++;
        }
      }
    }
    if (sites) {
      const job = K.JOB[K.SELF_BUILD[type] || 'repair'], nm = K.jobCount(G)[job.id] || 0;
      const who = K.SELF_BUILD[type] ? ' Assign ' + job.name + ' — they build it, then work there.' : ' Assign Builders to build ' + (sites > 1 ? 'them.' : 'it.');
      G.msg((sites > 1 ? sites + ' ' + d.name + ' sites marked out.' : d.name + ' site marked out.') + (nm && !K.SELF_BUILD[type] ? '' : who), nm || K.SELF_BUILD[type] ? 'info' : 'warn');
    }
    if (type === 'charge') {
      const nb = valid.filter((v) => v.kind === 'blast').length, nt = valid.length - nb;
      G.msg((nt ? nt + ' trap' + (nt > 1 ? 's' : '') : '') + (nt && nb ? ' and ' : '') + (nb ? nb + ' blasting charge' + (nb > 1 ? 's' : '') : '') + ' marked.' + (K.jobCount(G).demo ? '' : ' Assign a Demolition crew to plant them.'), 'info');
    }
    if (dugUnder) { const n = w.flood(); if (n) G.msg('Water rushes in beneath the drawbridge — ' + n + ' tile' + (n > 1 ? 's' : '') + ' of moat!', 'good'); }
    if (type === 'trench' || type === 'fill') {
      w.bump();
      if (!K.jobCount(G).dig) G.msg(valid.length + ' tile' + (valid.length > 1 ? 's' : '') + (type === 'fill' ? ' marked for filling' : ' of trench marked') + '. Assign Ditchers to do the work.', 'info');
    }
    if (K.isGate(type)) K.fixAllDrawbridges(G);
    K.unstick(G);
    return valid.length;
  };

  // Finish touches for a freshly placed structure. Returns true if it dug a trench underneath.
  function completeStruct(G, ns) {
    const w = G.world, type = ns.type;
    let dug = false;
    if (type === 'drawbridge') {
      const i = K.idx(ns.x, ns.y);
      // join a neighbouring bridge's orientation and position, otherwise span towards the land
      const mate = w.dbGroup(ns).find((o) => o !== ns && o.type === 'drawbridge' && o.vert != null);
      if (mate) { ns.vert = mate.vert; ns.raised = mate.raised; }
      else {
        const land = (x, y) => K.inb(x, y) && !K.isWater(w.terrain[K.idx(x, y)]);
        ns.vert = land(ns.x, ns.y - 1) || land(ns.x, ns.y + 1);
      }
      K.fixDrawbridge(G, ns);
      if (!K.isWater(w.terrain[i]) && w.terrain[i] !== T.TRENCH) { w.plan.delete(i); w.fillPlan.delete(i); w.setTerrain(i, T.TRENCH); dug = true; }
    }
    if (K.isGate(type)) K.fixAllDrawbridges(G);
    return dug;
  }

  // A construction site is finished: swap in the real structure.
  K.finishSite = function (G, s) {
    const w = G.world, type = s.final, frac = s.hp / s.maxHp;
    w.remove(s);
    const ns = w.place(type, s.x, s.y, { w: s.w, h: s.h, rot: s.rot });
    ns.hp = Math.max(1, Math.round(ns.maxHp * Math.min(1, frac)));
    if (s.battle) { ns.battlement = true; ns.maxHp += 250; ns.hp += 250; }
    if (completeStruct(G, ns)) { const n = w.flood(); if (n) G.msg('Water rushes in beneath the drawbridge — ' + n + ' tile' + (n > 1 ? 's' : '') + ' of moat!', 'good'); }
    K.unstick(G);
    if (type !== 'wall' && type !== 'bridge' && type !== 'drawbridge') G.msg(K.SDEF[type].name + ' completed.', 'good');
    return ns;
  };
  K.finishUpgrade = function (G, s) {
    if (s.upg && s.upg.engine) {
      s.engine = { type: s.upg.engine, reload: 0, fired: 0 }; s.upg = null;
      G.msg(K.SDEF[s.engine.type].name + ' hauled up onto the battlements.', 'good');
      G.world.touch(s.x, s.y); G.world.bump();
      return;
    }
    s.upg = null; s.battlement = true; s.maxHp += 250; s.hp += 250;
    G.world.touch(s.x, s.y); G.world.bump();
  };

  // A flooded tile stays passable if a bridge or drawbridge (or one being built) spans it.
  function crossing(w, i) {
    const s = w.sgrid[i] && w.structs.get(w.sgrid[i]);
    if (!s) return false;
    const t = s.type === 'site' ? s.final : s.type;
    return t === 'bridge' || t === 'drawbridge';
  }

  // Cancel a queued construction (site or battlement upgrade): everything is refunded.
  // Take a mounted (or half-built) siege engine off its walls; refund = true pays back a queued one.
  K.unmountEngine = function (G, s, refund) {
    const w = G.world, type = s.engine ? s.engine.type : s.upg && s.upg.engine;
    if (!type) return;
    if (refund && !s.engine) K.refund(G, K.SDEF[type].cost, 1);
    for (const id of s.engParts || []) { const o = w.structs.get(id); if (o && o.engPart === s.id) o.engPart = null; }
    s.engParts = null; s.engine = null;
    if (s.upg && s.upg.engine) s.upg = null;
    for (const u of G.units) if (u.rep === s) { u.rep = null; u.spot = null; }
    w.touch(s.x, s.y); w.bump();
  };
  K.cancelSite = function (G, s) {
    const w = G.world;
    if (!s || !w.structs.has(s.id)) return false;
    if (s.type === 'site') {
      K.refund(G, K.SDEF[s.final].cost, 1);
      if (s.battle) K.refund(G, K.SDEF.battlement.cost, 1);
      w.remove(s); K.unstick(G);
    } else if (s.upg && s.upg.engine) K.unmountEngine(G, s, true);
    else if (s.upg) { K.refund(G, K.SDEF.battlement.cost, 1); s.upg = null; w.bump(); }
    else return false;
    G.msg('Construction cancelled — fully refunded.', 'info');
    return true;
  };
  // Turn a gate (built or queued) a quarter turn, sliding it to the nearest free footprint that
  // overlaps where it stood. It never cuts into other structures.
  K.rotateGate = function (G, s) {
    const w = G.world;
    if (!s || !w.structs.has(s.id)) return false;
    const gt = s.type === 'site' ? s.final : s.type, rot = s.rot ? 0 : 1, d = K.dims(gt, rot), old = { x: s.x, y: s.y, w: s.w, h: s.h, rot: s.rot };
    const cands = [];
    for (let y = s.y - d.h + 1; y < s.y + s.h; y++)
      for (let x = s.x - d.w + 1; x < s.x + s.w; x++) cands.push([K.dist(x + d.w / 2, y + d.h / 2, s.x + s.w / 2, s.y + s.h / 2), x, y]);
    cands.sort((a, b) => a[0] - b[0]);
    w.remove(s);
    const put = (o) => {
      Object.assign(s, o);
      w.structs.set(s.id, s);
      for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) { w.sgrid[K.idx(s.x + dx, s.y + dy)] = s.id; w.touch(s.x + dx, s.y + dy); }
      w.bump();
    };
    for (const [, x, y] of cands) {
      const r = w.canPlace(gt, x, y, G, rot);
      if (!r.ok || r.replace) continue;
      const ks = G.kingSpot;
      if (ks && ks.x >= x && ks.x < x + d.w && ks.y >= y && ks.y < y + d.h) continue;
      put({ x, y, w: d.w, h: d.h, rot });
      if (!w.hasExit()) { w.remove(s); continue; }
      K.unstick(G);
      for (const u of G.units) if (u.rep === s) { u.rep = null; u.spot = null; u.path = null; }
      return true;
    }
    put(old);
    G.msg('No room to turn the gate here.', 'warn');
    return false;
  };

  function demolish(G, tiles) {
    const w = G.world;
    const done = new Set();
    let plans = 0;
    for (const t of tiles) {
      const pi = K.inb(t.x, t.y) ? K.idx(t.x, t.y) : -1;
      const ch = pi >= 0 && w.charges.get(pi);
      if (ch) {
        if (ch.state === 'lit') { G.msg('The fuse is already burning — stand clear!', 'warn'); continue; }
        K.refund(G, K.SDEF.charge.cost, ch.state === 'planned' ? 1 : 0.5);
        w.charges.delete(pi); plans++; continue;
      }
      if (w.plan.has(pi)) { K.refund(G, K.SDEF[w.fillPlan.has(pi) ? 'fill' : 'trench'].cost, 1); w.plan.delete(pi); w.fillPlan.delete(pi); w.touch(t.x, t.y); plans++; continue; }
      const s = w.structAt(t.x, t.y);
      if (!s || done.has(s.id)) continue;
      if (s.type === 'keep' || s.type === 'keepdoor') { G.msg('The Keep cannot be demolished.', 'warn'); continue; }
      // a siege engine on the walls comes down first; the walls stay
      const eh = K.engineHost(w, s);
      if (eh) {
        done.add(s.id); if (done.has(eh.id)) continue; done.add(eh.id);
        const et = eh.engine ? eh.engine.type : eh.upg.engine;
        K.refund(G, K.SDEF[et].cost, eh.engine ? 0.5 : 1);
        K.unmountEngine(G, eh, false); plans++;
        G.msg(K.SDEF[et].name + ' taken down from the walls.', 'info');
        continue;
      }
      // only removing a crossing (bridge/drawbridge over water) can cut off the way out
      if (s.type === 'bridge' || s.type === 'drawbridge') {
        const ov = new Map();
        for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) { const i = K.idx(s.x + dx, s.y + dy); ov.set(i, !K.isWater(w.terrain[i])); }
        if (w.hasExit() && !w.hasExit(ov)) { G.msg('Removing that would trap your subjects inside.', 'warn'); continue; }
      }
      // an unfinished site is simply cancelled: everything is refunded
      if (s.type === 'site') {
        done.add(s.id);
        K.refund(G, K.SDEF[s.final].cost, 1);
        if (s.battle) K.refund(G, K.SDEF.battlement.cost, 1);
        w.remove(s); K.unstick(G); plans++;
        continue;
      }
      if (s.upg) K.refund(G, K.SDEF.battlement.cost, 1);
      // selling always works; the labour eats whatever food is on hand
      G.res.food = Math.max(0, G.res.food - K.SDEF.demolish.cost.food);
      done.add(s.id);
      K.refund(G, K.SDEF[s.type].cost, 0.5);
      if (s.battlement) G.res.stone += 2;
      K.destroyStruct(G, s, true);
    }
    if (plans) w.bump();
    return done.size + plans;
  }

  // A digger finished excavating planned tile i.
  K.digDone = function (G, i) {
    const w = G.world, x = i & NM, y = i >> NS;
    w.plan.delete(i);
    w.touch(x, y);
    if (w.fillPlan.delete(i)) {
      if (!w.canPlace('fill', x, y, G).ok) { w.bump(); return; }
      w.setTerrain(i, T.DIRT);
      K.unstick(G);
      return;
    }
    if (!w.canPlace('trench', x, y, G).ok) { w.bump(); return; }
    const ov = new Map();
    for (const j of w.floodSet(new Set([i]))) ov.set(j, crossing(w, j));
    if (!w.hasExit(ov)) { w.bump(); G.msg('A trench was abandoned — it would have cut off the only way out of the castle.', 'warn'); return; }
    if (w.terrain[i] === T.FOREST) G.res.lumber += 3;
    w.stump[i] = 0;
    w.setTerrain(i, T.TRENCH);
    const n = w.flood();
    if (n) G.msg('Water rushes into the trench — ' + n + ' tile' + (n > 1 ? 's' : '') + ' of moat!', 'good');
    K.unstick(G);
  };

  K.destroyStruct = function (G, s, quiet) {
    const w = G.world;
    for (const id of s.workers) { const u = G.units.find((v) => v.id === id); if (u) { u.work = null; u.state = null; } }
    for (const u of G.units) if (u.post === s.id) { u.post = null; if (u.onWall) { u.onWall = false; u.hp -= 10; } }
    G.postTaken.delete(s.id);
    w.remove(s);
    if (K.isGate(s.type) || s.type === 'drawbridge') K.fixAllDrawbridges(G);
    // workers left without a workplace become unassigned (those who worked here go first)
    const st = s.type === 'site' && K.SELF_BUILD[s.final] ? s.final : s.type;
    for (const j of K.JOBS) {
      if (j.where !== st && j.needs !== st) continue;
      const room = j.where ? K.slots(G, j.where) : K.hasStruct(G, j.needs) ? Infinity : 0;
      const crew = G.units.filter((v) => v.kind === 'subject' && !v.dead && v.job === j.id).sort((a, b) => s.workers.has(b.id) - s.workers.has(a.id));
      let n = 0;
      while (crew.length > room) { const u = crew.shift(); if (u.carry && !u.hidden) { G.res[u.carryRes || 'lumber'] += u.carry; u.carry = 0; } K.setJob(G, u, 'idle'); n++; }
      if (n) G.msg(n + ' ' + j.name.toLowerCase() + ' lost their ' + K.SDEF[st].name + ' and are now unassigned.', 'info');
    }
    if (!quiet) {
      for (let k = 0; k < 10; k++) G.particles.push({ kind: 'dust', x: s.x + Math.random() * s.w, y: s.y + Math.random() * s.h, vx: (Math.random() - 0.5) * 0.8, vy: -Math.random() * 0.6, life: 1.5, max: 1.5 });
      G.msg(K.SDEF[s.type === 'site' ? s.final : s.type].name + (s.type === 'site' ? ' site' : '') + ' destroyed!', 'bad');
    }
    if (s.type === 'keep') {
      for (const u of G.units) if (u.hidden) { u.hidden = false; u.x = s.x + 1.5; u.y = s.y + 1.5; }
      const door = w.structAt(s.x + 1, s.y + 2);
      if (door && door.type === 'keepdoor') w.remove(door);
      G.throne = null;
    }
    K.unstick(G);
  };

  // Move friendly units off tiles that just became solid.
  // Raise or lower a drawbridge. Anyone standing on it when it rises is thrown off.
  K.setDrawbridge = function (G, s0, raised) {
    if (!s0 || s0.type !== 'drawbridge') return;
    for (const s of G.world.dbGroup(s0)) setDrawbridgeOne(G, s, raised);
  };
  K.rotateDrawbridge = function (G, s0) {
    const w = G.world, grp = w.dbGroup(s0), b = w.dbBox(grp);
    if (b.w !== b.h) return false; // a long bridge always spans its long way
    const v = !s0.vert;
    for (const s of grp) s.vert = v;
    K.fixDrawbridge(G, s0);
    return true;
  };
  // Settle a drawbridge group: a long (2x3 / 1x2...) bridge spans its long axis, and it is hinged on
  // the end nearest a gate (or the Keep when there is no gate), so it always pulls up towards the castle.
  K.fixDrawbridge = function (G, s0) {
    const w = G.world, grp = w.dbGroup(s0), b = w.dbBox(grp);
    let vert = s0.vert;
    if (b.w !== b.h) vert = b.h > b.w;
    const cx = (b.x0 + b.x1 + 1) / 2, cy = (b.y0 + b.y1 + 1) / 2;
    let tx = null, ty = null, bd = 1e9;
    for (const s of w.structs.values()) {
      if (!K.isGate(s.type)) continue;
      const d = K.dist(s.x + s.w / 2, s.y + s.h / 2, cx, cy);
      if (d < bd) { bd = d; tx = s.x + s.w / 2; ty = s.y + s.h / 2; }
    }
    if (tx == null && w.keep) { tx = w.keep.x + 1.5; ty = w.keep.y + 1.5; }
    if (tx == null) { tx = cx; ty = cy; }
    const far = vert ? ty > cy : tx > cx; // hinge on the south / east end
    for (const s of grp) { s.vert = vert; s.hingeFar = far; w.touch(s.x, s.y); }
  };
  K.fixAllDrawbridges = function (G) {
    const seen = new Set();
    for (const s of G.world.structs.values()) {
      if (s.type !== 'drawbridge' || seen.has(s.id)) continue;
      for (const o of G.world.dbGroup(s)) seen.add(o.id);
      K.fixDrawbridge(G, s);
    }
  };
  function setDrawbridgeOne(G, s, raised) {
    const w = G.world;
    if (s.raised === raised) return;
    s.raised = raised;
    w.touch(s.x, s.y); w.bump();
    if (raised) {
      const o = w.computeOutside();
      for (const u of G.units) {
        if (u.team !== 1 || u.dead || Math.floor(u.x) !== s.x || Math.floor(u.y) !== s.y) continue;
        let land = null;
        for (const [dx, dy] of K.DIRS4) { const x = s.x + dx, y = s.y + dy; if (K.inb(x, y) && o[K.idx(x, y)] && w.eCan('foot', K.idx(x, y)) === 0) { land = [x, y]; break; } }
        if (land) { u.x = land[0] + 0.5; u.y = land[1] + 0.5; }
        u.path = null;
        K.damage(G, u, 30);
        G.particles.push({ kind: 'splash', x: s.x + 0.5, y: s.y + 0.5, life: 0.6, max: 0.6 });
      }
      K.unstick(G);
      if (G.phase === 'build') {
        const out = G.units.filter((u) => u.team === 0 && !u.dead && !u.hidden && o[K.tileOf(u)]).length;
        if (out) G.msg(`Drawbridge raised — ${out} of your people are outside and may be cut off.`, 'warn');
      }
    }
  }
  K.toggleAllDrawbridges = function (G) {
    const bs = [...G.world.structs.values()].filter((s) => s.type === 'drawbridge');
    const raise = bs.some((s) => !s.raised);
    for (const s of bs) K.setDrawbridge(G, s, raise);
    return raise;
  };

  K.unstick = function (G) {
    const w = G.world;
    for (const u of G.units) {
      if (u.team || u.dead || u.hidden || u.onWall) continue;
      const i = K.idx(Math.floor(u.x), Math.floor(u.y));
      if (w.fPass(i)) continue;
      // nearest free tile, preferring one still connected to the Keep
      const home = K.homeRegion && K.homeRegion(G);
      let best = null;
      for (let pass = 0; pass < 2 && !best; pass++)
        for (let r = 1; r < 6 && !best; r++)
          for (let dy = -r; dy <= r && !best; dy++)
            for (let dx = -r; dx <= r && !best; dx++) {
              const x = Math.floor(u.x) + dx, y = Math.floor(u.y) + dy;
              if (!K.inb(x, y)) continue;
              const j = K.idx(x, y);
              if (w.fPass(j) && (pass || !home || home[j])) best = [x, y];
            }
      if (best) { u.x = best[0] + 0.5; u.y = best[1] + 0.5; }
      u.path = null; u.state = null;
    }
  };

  // ---------------- main update ----------------
  // ---------------- explosives ----------------
  function boom(G, x, y, r) {
    G.particles.push({ kind: 'boom', x, y, r, life: 0.6, max: 0.6 });
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * 2;
      G.particles.push({ kind: k % 2 ? 'smoke' : 'dust', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.5, life: 1 + Math.random(), max: 2 });
    }
  }
  function updateCharges(G, dt) {
    const w = G.world, RT = K.RATES;
    if (!w.charges || !w.charges.size) return;
    for (const [i, c] of w.charges) {
      const x = (i & NM) + 0.5, y = (i >> NS) + 0.5;
      if (c.state === 'armed') {
        if (!K.nearest(G, x, y, 0.9, 1, (v) => !v.retreat)) continue;
        w.charges.delete(i);
        boom(G, x, y, RT.trapR);
        let hit = 0;
        for (const u of G.units) if (u.team === 1 && !u.dead && K.dist(u.x, u.y, x, y) <= RT.trapR) { K.damage(G, u, RT.trapDmg * (1 - K.dist(u.x, u.y, x, y) / (RT.trapR * 2))); hit++; }
        K.fx(G, x, y - 1, 'BOOM!', '#ffb040');
        if (hit >= 3) G.msg('A buried charge tore through ' + hit + ' attackers!', 'good');
      } else if (c.state === 'lit') {
        c.t -= dt;
        if (c.t > 0) continue;
        w.charges.delete(i);
        blast(G, i);
      }
    }
  }
  function blast(G, i) {
    const w = G.world, RT = K.RATES, cx = i & NM, cy = i >> NS, rr = Math.ceil(RT.blastR);
    boom(G, cx + 0.5, cy + 0.5, RT.blastR + 0.5);
    let n = 0;
    for (let dy = -rr; dy <= rr; dy++)
      for (let dx = -rr; dx <= rr; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!K.inb(x, y) || dx * dx + dy * dy > RT.blastR * RT.blastR) continue;
        const j = K.idx(x, y);
        if ((w.terrain[j] !== T.MOUNTAIN && w.terrain[j] !== T.ROCK) || w.sgrid[j]) continue;
        // a rock patch just breaks up where it lies
        if (w.terrain[j] === T.ROCK) {
          w.setTerrain(j, T.DIRT);
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (K.inb(x + ax, y + ay)) w.touch(x + ax, y + ay);
          const rc = w.charges.get(j);
          if (rc && rc.kind === 'blast' && rc.state === 'planned') { w.charges.delete(j); K.refund(G, K.SDEF.charge.cost, 1); }
          n++;
          continue;
        }
        // settle the cleared ground at the height of the land around it
        let e = 0;
        for (const [ax, ay] of K.DIRS8 || [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          if (!K.inb(x + ax, y + ay)) continue;
          const k = K.idx(x + ax, y + ay);
          if (w.terrain[k] !== T.MOUNTAIN && w.terrain[k] !== T.MINE) e = Math.max(e, w.elev[k]);
        }
        w.elev[j] = Math.min(3, e || 3);
        w.setTerrain(j, T.DIRT);
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (K.inb(x + ax, y + ay)) w.touch(x + ax, y + ay);
        const pc = w.charges.get(j);
        if (pc && pc.kind === 'blast' && pc.state === 'planned') { w.charges.delete(j); K.refund(G, K.SDEF.charge.cost, 1); }
        n++;
      }
    if (n) {
      G.res.stone += n * RT.blastStone;
      K.fx(G, cx + 0.5, cy - 0.5, '+' + n * RT.blastStone + ' stone', '#d0d0d0');
      K.unstick(G);
    }
    G.stats.blasts = (G.stats.blasts || 0) + n;
  }
  K.blast = blast;

  K.update = function (G, dt) {
    if (G.phase === 'won' || G.phase === 'lost' || G.phase === 'place') return;
    const w = G.world;
    if (G.god) fillRes(G);
    G.time += dt;
    G.timer -= dt;
    G.pathBudget = 12;
    G.farmGrowth = (G.farmGrowth + dt / 60) % 3;
    if (!w.stump) w.stump = new Uint8Array(N * N);

    // phases
    if (G.phase === 'build') {
      if (!G.recall && G.timer <= K.RECALL_TIME) {
        G.recall = true;
        G.msg('Enemy banners on the horizon! Subjects are returning to the castle.', 'bad');
      }
      if (G.timer <= 0) startDefense(G);
    } else if (G.phase === 'defense') {
      while (G.spawnQueue.length && G.spawnQueue[0].t <= G.defenseLen - G.timer) spawnEnemy(G, G.spawnQueue.shift());
      const alive = G.units.some((u) => u.team === 1 && !u.dead && !u.retreat);
      if ((!alive && !G.spawnQueue.length) || G.timer <= 0) endDefense(G, alive);
    }

    G.horseT = (G.horseT || 0) - dt;
    if (G.horseT <= 0) { G.horseT = 1; K.updateHorses(G); }
    // economy
    const subs = K.subjects(G);
    G.res.food -= (subs.length + 1) * K.RATES.eat * dt;
    if (G.res.food <= 0) {
      G.res.food = 0;
      G.starveT += dt;
      if (G.starveT >= 30 && subs.length && !G.god) {
        G.starveT = 0;
        const u = subs.find((v) => v.job === 'idle') || subs[0];
        K.killUnit(G, u, true);
        G.stats.lost++;
        G.msg('A subject has starved to death! Grow more food.', 'bad');
      }
    } else G.starveT = 0;
    if (w.keep && !G.god) {
      G.capWarn = G.capWarn || {};
      for (const r of K.STORED) {
        const cap = K.resCap(G, r);
        if (G.res[r] <= cap) continue;
        if (!G.capWarn[r] || G.time - G.capWarn[r] > 90) {
          G.capWarn[r] = G.time;
          G.msg(r === 'food' ? 'Your food stores are full — build Food Storage or the surplus will spoil.' : 'Your ' + (K.RES_NAME[r] || r) + ' stores are full — build ' + K.SDEF[r === 'lumber' || r === 'plank' ? 'lumberyard' : r === 'stone' ? 'stoneyard' : 'metalstore'].name + ' or the surplus is lost.', 'warn');
        }
        G.res[r] = cap;
      }
    }
    if (G.phase === 'build' && !G.recall) {
      G.popT += dt;
      if (G.popT > 16) {
        G.popT = 0;
        if (subs.length < K.housing(G) && G.res.food > 15) arrive(G);
      }
    }
    // over the subject cap (houses lost): the homeless drift away, one at a time
    if (subs.length > K.housing(G) && !G.god) {
      G.homelessT = (G.homelessT || 0) + dt;
      if (G.homelessT > 30) {
        G.homelessT = 0;
        const u = subs.find((v) => v.job === 'idle') || subs.find((v) => !K.isSoldier(v)) || subs[0];
        K.killUnit(G, u, true);
        G.msg('A homeless subject has left your lands. Build more houses!', 'warn');
      }
    } else G.homelessT = 0;

    K.updateSquads(G, dt);
    K.updateUnits(G, dt);
    updateCharges(G, dt);
    heal(G, dt);
    K.updateBeasts(G, dt);
    K.updateMonsters(G, dt);
    K.updateStructs(G, dt);
    K.updateProjectiles(G, dt);
    for (const p of G.particles) {
      p.life -= dt;
      p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
    }
    G.particles = G.particles.filter((p) => p.life > 0);
    G.units = G.units.filter((u) => !u.dead);
    checkLoss(G);
  };

  // Medics at a tent (or sheltering in the keep, at half pace) heal the wounded.
  function heal(G, dt) {
    const tents = K.slots(G, 'tent') / K.SDEF.tent.slots;
    if (!tents) return;
    let medics = 0;
    for (const u of G.units) if (u.job === 'medic' && !u.dead) medics += u.state === 'work' ? 1 : u.hidden ? 0.5 : 0;
    if (!medics) return;
    let pool = medics * K.RATES.heal * (1 + 0.25 * (tents - 1)) * dt;
    const hurt = G.units.filter((u) => u.team === 0 && !u.dead && u.hp < u.maxHp);
    if (!hurt.length) return;
    const pri = (u) => (K.isSoldier(u) || u.kind === 'king' ? 0 : 1) + u.hp / u.maxHp;
    hurt.sort((a, b) => pri(a) - pri(b));
    const n = Math.min(hurt.length, Math.max(1, Math.ceil(medics)));
    for (let k = 0; k < n && pool > 0; k++) {
      const u = hurt[k], amt = Math.min(u.maxHp - u.hp, pool / (n - k));
      u.hp += amt; pool -= amt;
      if (!u.hidden && Math.random() < dt * 0.8) G.particles.push({ kind: 'text', x: u.x, y: u.y - 1.1, vx: 0, vy: -0.6, life: 0.9, max: 0.9, text: '+', color: '#7ef08a' });
    }
  }

  function arrive(G) {
    const w = G.world, k = w.keep || { x: G.kingSpot.x - 1, y: G.kingSpot.y - 3 };
    for (let t = 0; t < 40; t++) {
      const a = G.rand() * Math.PI * 2, d = 18 + G.rand() * 10;
      const x = Math.floor(k.x + 1 + Math.cos(a) * d), y = Math.floor(k.y + 1 + Math.sin(a) * d);
      if (!K.inb(x, y) || !w.fPass(K.idx(x, y))) continue;
      const u = K.spawnUnit(G, 'subject', x + 0.5, y + 0.5);
      K.fx(G, u.x, u.y - 1, 'new subject!', '#9fd0ff');
      G.msg('A new subject has joined your realm.', 'good');
      return;
    }
  }

  function startDefense(G) {
    const w = G.world;
    G.phase = 'defense';
    G.recall = true;
    G.defenseLen = G.timer = K.DEFENSE_TIME[Math.min(G.round, K.DEFENSE_TIME.length - 1)];
    const down = [...w.structs.values()].filter((s) => s.type === 'drawbridge' && !s.raised).length;
    if (down) G.msg(`${down} drawbridge${down > 1 ? 's are' : ' is'} still lowered — select ${down > 1 ? 'one' : 'it'} to raise it when your people are inside.`, 'warn');
    // schedule the assault
    const list = K.waveComp(G.round + 1, G.rand, G.opts.difficulty);
    // a moat with no way across: the enemy brings engineers and boats
    const locked = G.activeEntries.filter((e) => K.moatLocked(G, e.x, e.y)).length;
    if (locked) {
      const d = G.opts.difficulty || 1, n = G.round + 1;
      for (let k = Math.round((3 + n * 0.8) * d * locked); k > 0; k--) list.push('e_engineer');
      for (let k = Math.round((1 + n * 0.6) * d * locked); k > 0; k--) list.push('e_boat');
      G.msg('Scouts report the enemy brings engineers and boats to cross your moat.', 'warn');
    }
    G.squads = [];
    G.spawnQueue = K.planArmy(G, list, G.defenseLen);
    G.msg('Round ' + (G.round + 1) + ': the siege begins! ' + list.length + ' enemies approach.', 'bad');
    if (!w.isEnclosed()) G.msg('Warning: your ' + K.rulerName(G) + ' is not enclosed by walls!', 'warn');
  }

  function spawnEnemy(G, q) {
    if (q.types) { K.spawnSquad(G, q); return; }
    const e = q.entry;
    const lat = (G.rand() - 0.5) * 6;
    let x = e.x + 0.5, y = e.y + 0.5;
    if (e.side === 'W') { x = -1; y += lat; }
    else if (e.side === 'E') { x = N + 1; y += lat; }
    else if (e.side === 'N') { y = -1; x += lat; }
    else { y = N + 1; x += lat; }
    const u = K.spawnUnit(G, 'enemy', x, y, q.type);
    u.entry = e;
  }

  function endDefense(G, alive) {
    const w = G.world;
    for (const u of G.units) if (u.team === 1) u.retreat = true;
    if (K.clearOrders(G, G.units.filter((u) => u.team === 0 && !u.dead))) G.msg('The siege is over — your soldiers return to their posts.', 'info');
    G.round++;
    if (G.round === K.ROUNDS && !G.endless) {
      G.phase = 'won';
      G.msg('Victory! Your Keep has withstood ten sieges.', 'good');
      return;
    }
    G.msg(alive ? 'The enemy retreats! You held the castle.' : 'Every attacker has fallen. The siege is broken!', 'good');
    nextBuild(G);
  }

  // After victory: keep playing with ever-larger sieges.
  K.continueEndless = function (G) {
    G.endless = true;
    G.ended = false;
    G.msg('Endless mode: the sieges will keep coming, each one larger than the last.', 'info');
    nextBuild(G);
  };

  function nextBuild(G) {
    const w = G.world;
    // carpenters hang a new (weakened) Keep door if it was battered down
    if (w.keep && G.throne && !w.sgrid[K.idx(w.keep.x + 1, w.keep.y + 2)]) {
      const hp = K.SDEF.keepdoor.hp;
      w.place('keepdoor', w.keep.x + 1, w.keep.y + 2, { hp: hp * 0.3, maxHp: hp });
      K.unstick(G);
    }
    G.phase = 'build';
    G.timer = K.BUILD_TIME;
    G.recall = false;
    G.spawnQueue = [];
    G.squads = [];
    for (const s of w.structs.values()) if (s.type === 'drawbridge') { s.raised = false; w.touch(s.x, s.y); }
    for (const s of w.structs.values()) if (s.type === 'wall') { const i = K.idx(s.x, s.y); w.ladder[i] = 0; w.tower[i] = 0; }
    w.ladderHp.clear();
    if (w.ebridgeHp.size) G.msg('The retreating enemy burns its covered bridges behind it.', 'info');
    for (const i of w.ebridgeHp.keys()) { w.ebridge[i] = 0; w.touch(i & NM, i >> NS); }
    w.ebridgeHp.clear(); w.eWork.clear();
    w.bump();
    // archers posted on battlements stay there through the build phase
    const keepsPost = (u) => !u.dead && u.job === 'archer' && u.post != null && w.structs.has(u.post);
    for (const u of G.units) if (u.team === 0) { if (!keepsPost(u)) stepOffWall(G, u); u.wallPath = null; u.wb = null; u.wpath = null; u.state = null; u.path = null; }
    G.postTaken.clear();
    for (const u of G.units) { if (u.team === 0 && keepsPost(u)) G.postTaken.set(u.post, u.id); else { u.post = null; u.manualPost = false; } }
    chooseEntries(G);
    G.msg('Scouts report the next attack will come from the ' + G.activeEntries.map((e) => ({ N: 'north', S: 'south', W: 'west', E: 'east' })[e.side]).join(' and ') + '.', 'info');
  }

  function checkLoss(G) {
    if (G.phase === 'lost' || G.phase === 'won' || G.god) return;
    let why = null;
    const R = K.rulerName(G);
    if (G.king.dead) why = `The ${R} has been slain.`;
    else if (G.captured) why = `The ${R} has been captured!`;
    else if (!K.subjects(G).length) why = 'All of your subjects are gone.';
    else if (![...G.world.structs.values()].some((s) => !K.SDEF[s.type].eco)) why = 'Every structure has been destroyed.';
    if (why) { G.phase = 'lost'; G.lossReason = why; G.msg(why, 'bad'); }
  }

  K.chooseEntries = chooseEntries;
})();

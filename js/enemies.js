'use strict';
// Enemy AI, siege engines, the tentacle monster, player artillery and projectiles.
(function () {
  const T = K.T;
  let N, NM, NS;
  K.onSize(() => { N = K.N; NM = N - 1; NS = Math.log2(N); });

  // movement class: horses can't climb ladders, so mounted knights path as 'horse'
  function cls(u) {
    if (u.type === 'e_boat') return 'boat';
    if ((u.type === 'e_ladder' && u.hasLadder) || u.type === 'e_tower') return 'ladder';
    if (u.type === 'e_cavalry') return 'horse';
    return 'foot';
  }
  K.enemyCls = cls;

  // Planted ladders have hit points; defenders can hack or shove them down.
  K.damageLadder = function (G, i, dmg) {
    const w = G.world;
    if (!w.ladder[i]) return;
    const hp = (w.ladderHp.get(i) ?? K.LADDER_HP) - dmg;
    const x = i & NM, y = i >> NS;
    if (hp > 0) { w.ladderHp.set(i, hp); return; }
    w.ladder[i] = 0; w.ladderHp.delete(i);
    w.touch(x, y); w.bump();
    // anyone climbing falls back outside
    const o = w.computeOutside();
    let land = null;
    for (const [dx, dy] of K.DIRS4) { const j = K.idx(x + dx, y + dy); if (K.inb(x + dx, y + dy) && o[j] && w.eCan('foot', j) === 0) { land = j; break; } }
    for (const u of G.units) {
      if (u.team !== 1 || u.dead || Math.floor(u.x) !== x || Math.floor(u.y) !== y) continue;
      if (land != null) { u.x = (land & NM) + 0.5; u.y = (land >> NS) + 0.5; u.onWall = false; }
      K.damage(G, u, 25);
    }
    for (let k = 0; k < 5; k++) G.particles.push({ kind: 'dust', x: x + 0.5, y: y + 0.5, vx: (Math.random() - 0.5) * 1.2, vy: -Math.random(), life: 0.7, max: 0.7 });
    if (!(G.ladderMsgT > G.time)) { G.ladderMsgT = G.time + 6; G.msg('A siege ladder is thrown down!', 'good'); }
  };

  function moveTo(u, x, y, dt, sp) {
    const dx = x - u.x, dy = y - u.y, d = Math.hypot(dx, dy);
    if (d < 0.02) { u.moving = false; return true; }
    u.moving = true;
    if (Math.abs(dx) > 0.03) u.face = dx > 0 ? 1 : -1;
    const s = Math.min(d, sp * dt);
    u.x += (dx / d) * s; u.y += (dy / d) * s;
    return d <= sp * dt;
  }

  function speedAt(G, u, i) {
    const t = G.world.terrain[i];
    let f = 1;
    if (t === T.FOREST) f = 0.6; else if (t === T.TRENCH) f = 0.45; else if (K.isWater(t)) f = u.type === 'e_boat' ? 0.8 : 0.35;
    // armies march quickly across open country, then slow down for the assault
    const far = u.kingD > 30 ? 1.7 : u.kingD > 18 ? 1.3 : 1;
    return K.unitStats(u).speed * f * far;
  }

  const SMASH = { house: 1, tent: 1, catapult: 1, trebuchet: 1, gate: 1, irongate: 1 };
  // anything standing outside the walls (farms, quarries, mines, bloomeries, houses…) is fair game
  function outsideStruct(G, s) {
    if (s.type === 'wall' || s.type === 'keep') return false;
    const o = G.world.computeOutside();
    for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) if (o[K.idx(s.x + dx, s.y + dy)]) return true;
    return false;
  }
  K.outsideStruct = outsideStruct;
  function structTarget(G, u, r, filter, minR) {
    let best = null, bd = r;
    for (const s of G.world.structs.values()) {
      if (K.SDEF[s.type].noRaze || (K.SDEF[s.type].eco && !outsideStruct(G, s)) || (filter && !filter(s))) continue;
      const d = Math.hypot(s.x + s.w / 2 - u.x, s.y + s.h / 2 - u.y);
      if (minR && d < minR) continue;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  K.updateEnemy = function (G, u, dt) {
    const w = G.world, st = K.UDEF[u.type];
    u.siege = st.siege;
    const tx0 = Math.floor(u.x), ty0 = Math.floor(u.y);
    if (u.working > 0) u.working -= dt;

    if (u.retreat) {
      const e = u.entry || { x: 0, y: 0 };
      const ex = e.side === 'W' ? -3 : e.side === 'E' ? N + 3 : e.x, ey = e.side === 'N' ? -3 : e.side === 'S' ? N + 3 : e.y;
      u.onWall = false;
      if (moveTo(u, ex, ey, dt, st.speed * 1.2) || (u.retreatT = (u.retreatT || 0) + dt) > 25) u.dead = true;
      return;
    }
    // formations marching onto the map
    if (u.squad && !u.free && !K.inb(tx0, ty0)) { if (!K.followSlot(G, u, dt, st.speed * 1.4)) moveTo(u, u.entry.x + 0.5, u.entry.y + 0.5, dt, st.speed); return; }
    // marching onto the map
    if (!K.inb(tx0, ty0)) { moveTo(u, u.entry.x + 0.5, u.entry.y + 0.5, dt, st.speed); return; }

    const i = K.idx(tx0, ty0);
    u.kingD = Math.hypot(G.king.x - u.x, G.king.y - u.y);
    const s0 = w.sgrid[i] && w.structs.get(w.sgrid[i]);
    u.onWall = !!(s0 && s0.type === 'wall');

    if (u.docked) { u.moving = false; return; }
    if (u.busy > 0) { u.busy -= dt; u.moving = false; if (u.busy <= 0 && u.onDone) { u.onDone(); u.onDone = null; } return; }

    // ---- siege engines ----
    if (st.siege === 'catapult' || st.siege === 'trebuchet') {
      u.scanT = (u.scanT || 0) - dt;
      if (u.tgt) { const td = Math.hypot(u.tgt.x - u.x, u.tgt.y - u.y); if (!w.structs.has(u.tgt.id) || td > st.range + 1 || td < (st.minRange || 0) - 1) u.tgt = null; }
      if (!u.tgt && u.scanT <= 0) { u.scanT = 1; u.tgt = structTarget(G, u, st.range, null, st.minRange); }
      if (u.tgt) {
        u.moving = false;
        if (u.cd <= 0) {
          u.cd = st.cd; u.atkAnim = 0.5;
          const s = u.tgt, sc = Math.min(1.5, Math.hypot(s.x - u.x, s.y - u.y) / 8);
          K.shoot(G, 'stone', u.x, u.y - 1, s.x + 0.5 + (Math.random() - 0.5) * sc, s.y + 0.5 + (Math.random() - 0.5) * sc, { team: 1, dmg: st.dmg, splash: st.splash });
        }
        return;
      }
    } else if (st.siege === 'ballista') {
      const uh = K.unitH(G, u), t = K.nearestRanged(G, u.x, u.y, st.range, uh, 0, (v) => v.onWall || v.kind === 'king') || K.nearestRanged(G, u.x, u.y, st.range, uh, 0);
      if (t) {
        u.moving = false; u.face = t.x > u.x ? 1 : -1;
        if (u.cd <= 0) { u.cd = st.cd; u.atkAnim = 0.4; K.shoot(G, 'bolt', u.x, u.y - 0.6, t.x, t.y - 0.4, { team: 1, dmg: st.dmg, target: t }); }
        return;
      }
      const s = structTarget(G, u, st.range, (s) => s.type === 'catapult' || s.type === 'trebuchet' || !!s.engine);
      if (s) {
        u.moving = false;
        if (u.cd <= 0) { u.cd = st.cd; u.atkAnim = 0.4; K.shoot(G, 'bolt', u.x, u.y - 0.6, s.x + 0.5, s.y + 0.5, { team: 1, dmg: st.dmg * 1.5, struct: s }); }
        return;
      }
    } else if (st.ranged) {
      const uh = K.unitH(G, u), t = K.nearestRanged(G, u.x, u.y, st.range, uh, 0, (v) => v.kind === 'king') || K.nearestRanged(G, u.x, u.y, st.range, uh, 0);
      if (t) {
        u.moving = false; u.face = t.x > u.x ? 1 : -1;
        if (u.cd <= 0) { u.cd = st.cd * (0.9 + Math.random() * 0.3); u.atkAnim = 0.25; K.shoot(G, 'arrow', u.x, u.y - 0.8, t.x + (Math.random() - 0.5) * 0.5, t.y - 0.4, { team: 1, dmg: st.dmg, target: t }); }
        return;
      }
    } else if (st.dmg && st.siege !== 'ram') {
      // melee: hit adjacent friendlies; chase close ones
      // guards and escorts sally out a little further to protect their engines
      const sq = !u.free && u.squad, chase = sq && (u.role === 'guard' || u.role === 'escort') ? 5 : 2.6;
      const t = K.nearest(G, u.x, u.y, chase, 0, (v) => K.meleeOk(G, u, v) && (!sq || chase < 3 || Math.hypot(v.x - sq.x, v.y - sq.y) < 9));
      if (t) {
        const d = Math.hypot(t.x - u.x, t.y - u.y);
        if (d <= st.range) return K.melee(G, u, t, st);
        const nx = Math.floor(u.x + (t.x - u.x) / d * 0.6), ny = Math.floor(u.y + (t.y - u.y) / d * 0.6);
        if (K.inb(nx, ny) && w.eCan(cls(u), K.idx(nx, ny)) === 0) { moveTo(u, t.x, t.y, dt, speedAt(G, u, i)); return; }
      }
      // smash homes, tents and castle machinery within reach, and raid anything left outside the walls
      if (!u.onWall && !st.engineer) {
        if (u.smash && (!w.structs.has(u.smash.id) || u.smashT < G.time)) u.smash = null;
        if (!u.smash && !(u.smashScan > G.time)) {
          u.smashScan = G.time + 0.6 + Math.random() * 0.4;
          const near = (s, m) => Math.abs(s.x + s.w / 2 - u.x) < s.w / 2 + m && Math.abs(s.y + s.h / 2 - u.y) < s.h / 2 + m;
          const inForm = u.squad && !u.free, reach = inForm ? 4 : 7;
          let s = structTarget(G, u, 1.9, (s) => SMASH[s.type] && near(s, 1.1));
          if (!s && u.role !== 'engine') s = structTarget(G, u, reach + 2, (s) => near(s, reach) && outsideStruct(G, s));
          if (s) {
            u.smash = s; u.smashT = G.time + 20;
            if (inForm) u.free = true;
            if (K.SDEF[s.type].eco && !(G.raidMsgT > G.time)) { G.raidMsgT = G.time + 15; G.msg('Enemies are raiding your ' + K.SDEF[s.type].name.toLowerCase() + ' outside the walls!', 'bad'); }
          }
        }
        if (u.smash) {
          const s = u.smash;
          // walk up to it (or onto it — farms and workings can be trampled)
          const px = K.clamp(u.x, s.x + 0.2, s.x + s.w - 0.2), py = K.clamp(u.y, s.y + 0.2, s.y + s.h - 0.2);
          const dd = Math.hypot(px - u.x, py - u.y);
          if (dd > 1.1) {
            const nx = Math.floor(u.x + (px - u.x) / dd * 0.6), ny = Math.floor(u.y + (py - u.y) / dd * 0.6);
            const ni = K.inb(nx, ny) ? K.idx(nx, ny) : -1;
            if (ni >= 0 && (w.eCan(cls(u), ni) === 0 || w.sgrid[ni] === s.id)) { moveTo(u, px, py, dt, speedAt(G, u, i)); return; }
            u.smash = null; u.smashScan = G.time + 4;
          } else {
            u.moving = false; u.face = s.x + s.w / 2 > u.x ? 1 : -1;
            if (u.cd <= 0) { u.cd = st.cd; u.atkAnim = 0.3; K.damageStruct(G, s, st.dmg * 0.5); if (Math.random() < 0.4) G.particles.push({ kind: 'dust', x: s.x + s.w / 2, y: s.y + s.h / 2, vx: 0, vy: -0.4, life: 0.6, max: 0.6 }); }
            return;
          }
        }
      }
    }

    // ---- hold place in the formation ----
    if (u.squad && !u.free && K.followSlot(G, u, dt, speedAt(G, u, i))) return;

    // ---- follow the flow field toward the King ----
    const c = cls(u);
    const k = G.king;
    const kt = K.tileOf(k);
    const f = w.field(c, kt & NM, kt >> NS);
    let best = -1, bd = f[i];
    for (const [dx, dy] of K.DIRS8) {
      const nx = tx0 + dx, ny = ty0 + dy;
      if (!K.inb(nx, ny)) continue;
      const j = K.idx(nx, ny);
      if (dx && dy && !w.diagOk(i, j, K.idx(nx, ty0), K.idx(tx0, ny), (k) => w.eCan(c, k) !== 0)) continue;
      const fd = f[j] + (dx && dy ? 0.01 : 0);
      if (fd < bd) { bd = fd; best = j; }
    }
    if (best < 0) {
      // at the King (or stuck): attack anything adjacent
      if (st.dmg) { const t = K.nearest(G, u.x, u.y, st.range + 0.3, 0, (v) => K.meleeOk(G, u, v)); if (t) return K.melee(G, u, t, st); }
      u.moving = false;
      return;
    }
    const can = w.eCan(c, best);
    const bx = best & NM, by = best >> NS;
    // open water ahead: engineers bridge or fill it under cover; everyone else waits on the bank
    if (can === 2 && K.isWater(w.terrain[best]) && !w.sgrid[best]) {
      u.moving = false; u.face = bx + 0.5 > u.x ? 1 : -1;
      if (st.engineer) engineerWork(G, u, best, dt);
      return;
    }
    if (can === 0) {
      moveTo(u, bx + 0.5 + u.ox * 0.6, by + 0.5 + u.oy * 0.6, dt, speedAt(G, u, i));
      return;
    }
    const sb = w.sgrid[best] && w.structs.get(w.sgrid[best]);
    if (can === 1 && sb) {
      u.moving = false; u.face = bx + 0.5 > u.x ? 1 : -1;
      if (u.cd <= 0 && st.dmg) { u.cd = st.cd; u.atkAnim = 0.3; K.damageStruct(G, sb, st.dmg * (st.siege === 'ram' ? 1 : 0.35)); if (Math.random() < 0.4) G.particles.push({ kind: 'dust', x: bx + 0.5, y: by + 0.5, vx: 0, vy: -0.4, life: 0.6, max: 0.6 }); }
      return;
    }
    // blocked by a wall
    if (sb && sb.type === 'wall') {
      if (u.type === 'e_ladder' && u.hasLadder) {
        u.busy = 3; u.moving = false;
        u.onDone = () => {
          if (!w.structs.has(sb.id)) return;
          w.ladder[best] = 1; w.ladderHp.set(best, K.LADDER_HP); w.touch(bx, by); w.bump();
          u.hasLadder = false; u.sprite = 'e_ladder_free';
          G.msg('Enemies are scaling your walls with ladders!', 'bad');
        };
        return;
      }
      if (u.type === 'e_tower') {
        w.tower[best] = 1; w.touch(bx, by); w.bump();
        u.docked = true; u.dockTile = best;
        G.msg('A siege tower has reached your walls!', 'bad');
        return;
      }
    }
    // try any open neighbour that does not lead away
    const alt = [];
    for (const [dx, dy] of K.DIRS4) {
      const nx = tx0 + dx, ny = ty0 + dy;
      if (!K.inb(nx, ny)) continue;
      const j = K.idx(nx, ny);
      if (w.eCan(c, j) === 0 && f[j] <= f[i] + 0.5) alt.push(j);
    }
    if (alt.length) {
      if (u.alt == null || !alt.includes(u.alt)) u.alt = alt[Math.floor(Math.random() * alt.length)];
      moveTo(u, (u.alt & NM) + 0.5, (u.alt >> NS) + 0.5, dt, speedAt(G, u, i) * 0.6);
    } else u.moving = false;
  };

  function engineerWork(G, u, i, dt) {
    const w = G.world, x = i & NM, y = i >> NS;
    let job = w.eWork.get(i);
    if (!job) { job = { prog: 0, kind: u.eMode || 'bridge' }; w.eWork.set(i, job); w.touch(x, y); }
    u.working = 0.4;
    if (u.cd <= 0) { u.cd = 0.8; u.atkAnim = 0.3; }
    job.prog += dt / (job.kind === 'fill' ? K.ENG.fill : K.ENG.bridge);
    if (job.prog < 1) return;
    w.eWork.delete(i);
    if (job.kind === 'fill') {
      w.setTerrain(i, T.DIRT);
      K.unstick(G);
      if (!(G.fillMsgT > G.time)) { G.fillMsgT = G.time + 20; G.msg('Enemy engineers have filled in part of your moat!', 'bad'); }
    } else {
      w.ebridge[i] = 1; w.ebridgeHp.set(i, K.ENG.bridgeHp);
      if (!(G.bridgeMsgT > G.time)) { G.bridgeMsgT = G.time + 20; G.msg('Enemy engineers push a covered bridge across the water! Your catapults can smash it.', 'bad'); }
    }
    w.touch(x, y); w.bump();
  }
  // A covered bridge tile takes damage (stones, the tentacle beast); when it breaks, whoever is on it falls in.
  K.damageEBridge = function (G, i, dmg) {
    const w = G.world;
    if (!w.ebridge[i]) return;
    const hp = (w.ebridgeHp.get(i) ?? K.ENG.bridgeHp) - dmg;
    const x = i & NM, y = i >> NS;
    if (hp > 0) { w.ebridgeHp.set(i, hp); return; }
    w.ebridge[i] = 0; w.ebridgeHp.delete(i); w.touch(x, y); w.bump();
    for (const u of G.units) if (u.team === 1 && !u.dead && !u.boat && Math.floor(u.x) === x && Math.floor(u.y) === y) K.killUnit(G, u);
    for (let k = 0; k < 6; k++) G.particles.push({ kind: k % 2 ? 'splash' : 'dust', x: x + Math.random(), y: y + Math.random(), vx: (Math.random() - 0.5), vy: -Math.random(), life: 0.8, max: 0.8 });
    if (!(G.ebMsgT > G.time)) { G.ebMsgT = G.time + 8; G.msg('A covered bridge collapses into the water!', 'good'); }
  };

  // separation between enemies so crowds spread out
  function separate(G) {
    const w = G.world;
    for (const u of G.units) {
      if (u.team !== 1 || u.dead || u.docked || !K.inb(Math.floor(u.x), Math.floor(u.y))) continue;
      const r = K.UDEF[u.type].big ? 0.7 : 0.42;
      K.around(G, u.x, u.y, r, (v) => {
        if (v === u || v.team !== 1) return;
        let dx = u.x - v.x, dy = u.y - v.y, d = Math.hypot(dx, dy);
        if (d < 0.001) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = 0.5; }
        const push = (r - d) * 0.25;
        const nx = u.x + (dx / d) * push, ny = u.y + (dy / d) * push;
        const c = cls(u), j = K.idx(K.clamp(Math.floor(nx), 0, N - 1), K.clamp(Math.floor(ny), 0, N - 1));
        if (w.eCan(c, j) === 0 && K.inb(Math.floor(nx), Math.floor(ny))) { u.x = nx; u.y = ny; }
      });
    }
  }

  // ---------------- water beasts: tentacle monsters (lakes) and crocodiles (rivers) ----------------
  // Both attack anyone, friend or foe, in the water; tentacles also reach the shoreline.
  // Nobody on a bridge (or any other structure) can be attacked.
  K.WATER_BEASTS = {
    tentacle: { name: 'Tentacle Monster', dmg: 35, cd: 1.3, water: 3.2, shore: 1.6, speed: 1.5 },
    croc: { name: 'Crocodile', dmg: 30, cd: 1.5, water: 2.2, shore: 0, speed: 1.1 },
  };
  // tentacles roam any water; crocodiles keep to rivers and the moats joined to them
  const swims = (m, t) => (m.kind === 'croc' ? t === T.RIVER || t === T.MOAT : K.isWater(t));
  // Mark land within a step of water near each tentacle so friendly units path around it.
  function markShoreRisk(G) {
    const w = G.world, r = w.shoreRisk;
    if (w.riskTiles) for (const i of w.riskTiles) r[i] = 0;
    w.riskTiles = [];
    for (const m of G.monsters) {
      if (m.kind === 'croc') continue;
      const mx = Math.floor(m.x), my = Math.floor(m.y);
      for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
        const x = mx + dx, y = my + dy;
        if (!K.inb(x, y) || dx * dx + dy * dy > 49) continue;
        const i = K.idx(x, y);
        if (r[i] || K.isWater(w.terrain[i]) || w.sgrid[i]) continue;
        let shore = false;
        for (const [ex, ey] of K.DIRS8) if (K.inb(x + ex, y + ey) && K.isWater(w.terrain[K.idx(x + ex, y + ey)])) { shore = true; break; }
        if (shore) { r[i] = 1; w.riskTiles.push(i); }
      }
    }
  }
  K.updateMonsters = function (G, dt) {
    const w = G.world;
    G.riskT = (G.riskT || 0) - dt;
    if (G.riskT <= 0) { G.riskT = 0.5; markShoreRisk(G); }
    for (const m of G.monsters) {
      const md = K.WATER_BEASTS[m.kind || 'tentacle'];
      m.cd -= dt; m.attacking -= dt;
      const mi = K.idx(Math.floor(m.x), Math.floor(m.y));
      if (!swims(m, w.terrain[mi])) {
        // the water it was in vanished (bridge etc. doesn't count) — snap to nearest water
        let best = null, bd = 1e9;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          const x = Math.floor(m.x) + dx, y = Math.floor(m.y) + dy;
          if (K.inb(x, y) && swims(m, w.terrain[K.idx(x, y)]) && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = [x, y]; }
        }
        if (best) { m.x = best[0] + 0.5; m.y = best[1] + 0.5; }
        m.path = null;
      }
      // attack
      if (m.cd <= 0) {
        // prey: boats and anything in the water, either side; tentacles also snatch units at the
        // water's edge. Bridges, drawbridges and walls are safe.
        const ok = (v) => !v.retreat && !v.onWall && !w.sgrid[K.tileOf(v)] && clearLine(w, m.x, m.y, v.x, v.y);
        const inWater = (v) => K.isWater(w.terrain[K.tileOf(v)]);
        const pick = (r, f) => {
          const a = K.nearest(G, m.x, m.y, r, 0, f), e = K.nearest(G, m.x, m.y, r, 1, f);
          return a && e ? (Math.hypot(a.x - m.x, a.y - m.y) < Math.hypot(e.x - m.x, e.y - m.y) ? a : e) : a || e;
        };
        const t = pick(md.water, (v) => ok(v) && inWater(v)) || (md.shore ? pick(md.shore, (v) => ok(v) && !inWater(v)) : null);
        if (t) {
          m.cd = md.cd; m.attacking = 0.45; m.submerged = 0;
          m.atkAng = Math.atan2(t.y - m.y, t.x - m.x);
          if (m.kind === 'croc') m.ang = m.atkAng;
          K.damage(G, t, md.dmg);
          if (t.team === 0 && !(m.warned > G.time)) {
            m.warned = G.time + 30;
            G.msg(`A ${md.name.toLowerCase()} is attacking your ${t.kind === 'king' ? K.rulerName(G) : 'people'} at the water!`, 'bad');
          }
          G.particles.push({ kind: 'splash', x: m.x, y: m.y, life: 0.6, max: 0.6 });
          continue;
        }
        // tear at enemy covered bridges within reach
        let eb = -1;
        for (const i of w.ebridgeHp.keys()) if (Math.hypot((i & NM) + 0.5 - m.x, (i >> NS) + 0.5 - m.y) < 2.2) { eb = i; break; }
        if (eb >= 0 && m.kind !== 'croc') {
          m.cd = 1.6; m.attacking = 0.45; m.submerged = 0;
          m.atkAng = Math.atan2((eb >> NS) + 0.5 - m.y, (eb & NM) + 0.5 - m.x);
          K.damageEBridge(G, eb, 30);
          G.particles.push({ kind: 'splash', x: m.x, y: m.y, life: 0.6, max: 0.6 });
          continue;
        }
      }
      if (m.attacking > 0) continue;
      // wander
      if (m.submerged > 0) m.submerged -= dt;
      else if (Math.random() < dt * 0.04) m.submerged = 3 + Math.random() * 6;
      if (m.wait > 0) { m.wait -= dt; continue; }
      if (!m.path || m.pi >= m.path.length) {
        m.path = monsterPath(G, m);
        m.pi = 0;
        if (!m.path) { m.wait = 2; continue; }
      }
      const n = m.path[m.pi];
      if (!swims(m, w.terrain[n])) { m.path = null; continue; }
      const tx = (n & NM) + 0.5, ty = (n >> NS) + 0.5;
      const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy), sp = md.speed * dt;
      if (d > 0.01) { const a = Math.atan2(dy, dx), da = Math.atan2(Math.sin(a - (m.ang || 0)), Math.cos(a - (m.ang || 0))); m.ang = (m.ang || 0) + da * Math.min(1, dt * 5); }
      if (d <= sp) { m.x = tx; m.y = ty; m.pi++; if (m.pi >= m.path.length) m.wait = 1 + Math.random() * 4; }
      else { m.x += (dx / d) * sp; m.y += (dy / d) * sp; }
    }
  };
  function clearLine(w, x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3);
    for (let k = 1; k < n; k++) {
      const s = w.structAt(Math.floor(x0 + (x1 - x0) * k / n), Math.floor(y0 + (y1 - y0) * k / n));
      if (s && (s.type === 'wall' || K.isGate(s.type) || s.type === 'keep' || s.type === 'keepdoor')) return false;
    }
    return true;
  }
  // Random swim: BFS over nearby water; drift toward enemies if any are close.
  function monsterPath(G, m) {
    const w = G.world, s = K.idx(Math.floor(m.x), Math.floor(m.y));
    const prev = new Map([[s, -1]]), q = [s];
    for (let h = 0; h < q.length && q.length < 320; h++) {
      const i = q[h], x = i & NM, y = i >> NS;
      for (const [dx, dy] of K.DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!K.inb(nx, ny)) continue;
        const j = K.idx(nx, ny);
        if (prev.has(j) || !swims(m, w.terrain[j])) continue;
        prev.set(j, i); q.push(j);
      }
    }
    if (q.length < 2) return null;
    let goal;
    const foe = G.phase === 'defense' ? K.nearest(G, m.x, m.y, 14, 1) : null;
    if (foe) {
      let bd = 1e9;
      for (const i of q) { const d = K.dist(i & NM, i >> NS, foe.x, foe.y); if (d < bd) { bd = d; goal = i; } }
    } else goal = q[1 + Math.floor(Math.random() * (q.length - 1))];
    const path = [];
    for (let i = goal; i !== s && i >= 0; i = prev.get(i)) path.push(i);
    return path.reverse().slice(0, 40);
  }

  // nearest living land beast (not a flying wyvern) a siege engine can lob a stone at
  function beastInReach(G, x, y, base, h, minR) {
    let best = null, bd = 1e9;
    for (const b of G.beasts || []) {
      if (b.dead || K.BEASTS[b.kind].fly) continue;
      const dd = Math.hypot(b.x - x, b.y - y);
      if (dd <= minR || dd >= bd || dd > K.rangeVs(base, h, K.groundH(G.world, b.x, b.y))) continue;
      best = b; bd = dd;
    }
    return best;
  }
  // ---------------- player artillery ----------------
  K.updateStructs = function (G, dt) {
    const w = G.world;
    for (const s of w.structs.values()) {
      if (s.hitT > 0) s.hitT -= dt;
      if (s.fired > 0) s.fired -= dt;
      let d = K.SDEF[s.type], e = s, lift = 0;
      if (s.type === 'wall') {
        if (s.engPart && !K.engineHost(w, s)) s.engPart = null;
        const ek = s.engine ? s.engine.type : s.upg && s.upg.engine;
        if (!ek) continue;
        // a mounted engine needs every wall under it standing, with its battlements
        if (!(s.engParts || []).every((id) => { const o = w.structs.get(id); return o && o.battlement && o.engPart === s.id; }) || !s.battlement) {
          if (s.engine) G.msg('A mounted ' + K.SDEF[ek].name.toLowerCase() + ' crashes down from the ruined wall!', 'bad');
          K.unmountEngine(G, s, !s.engine);
          continue;
        }
        if (!s.engine) continue;
        e = s.engine; d = K.SDEF[e.type]; lift = K.WALL_LIFT;
        if (e.fired > 0) e.fired -= dt;
      }
      if (!d.range) continue;
      e.reload = (e.reload || 0) - dt;
      if ((G.phase !== 'defense' && G.phase !== 'build') || e.reload > 0) continue;
      const cx = s.x + d.w / 2, cy = s.y + d.h / 2, sh = K.groundH(w, cx, cy) + lift, minR = d.minRange || 2.5;
      // the besiegers come first; otherwise (or between sieges) any land beast in reach
      const t = (G.phase === 'defense' && K.nearestRanged(G, cx, cy, d.range, sh, 1, (v, dd) => dd > minR && !v.retreat)) || beastInReach(G, cx, cy, d.range, sh, minR);
      if (!t) continue;
      if (G.res.stone < d.ammo) { if (!G.ammoWarn || G.time - G.ammoWarn > 20) { G.ammoWarn = G.time; G.msg('Your siege engines are out of stone!', 'warn'); } continue; }
      G.res.stone -= d.ammo;
      e.reload = d.reload; e.fired = 0.6; e.face = t.x > cx ? 1 : -1;
      // lead the target a little
      K.shoot(G, 'stone', cx, cy - 1 - lift * 0.3, t.x + (Math.random() - 0.5) * 0.8, t.y + (Math.random() - 0.5) * 0.8, { team: 0, dmg: d.dmg, splash: d.splash });
    }
  };

  // ---------------- projectiles ----------------
  K.updateProjectiles = function (G, dt) {
    const w = G.world;
    separate(G);
    for (const p of G.projectiles) {
      p.t += dt;
      if (p.t < p.dur) continue;
      p.done = true;
      const ti = K.idx(K.clamp(Math.floor(p.tx), 0, N - 1), K.clamp(Math.floor(p.ty), 0, N - 1));
      if (p.kind === 'stone') {
        const foe = p.team === 0 ? 1 : 0;
        K.around(G, p.tx, p.ty, p.splash, (v) => { if (v.team === foe) K.damage(G, v, p.dmg * (v.onWall ? 0.7 : 1)); });
        // a stone landing among land beasts hurts them too (a wyvern overhead is out of reach)
        for (const b of G.beasts || []) {
          if (b.dead || K.BEASTS[b.kind].fly) continue;
          const bd = Math.hypot(b.x - p.tx, b.y - p.ty);
          if (bd <= Math.max(0.8, p.splash || 0)) { b.hp -= p.dmg * (bd < 0.6 ? 1 : 0.6); b.hurtT = 4; }
        }
        if (p.team === 0 && w.ebridgeHp.size) {
          const r = Math.max(1, p.splash || 1);
          for (const i of [...w.ebridgeHp.keys()]) if (Math.hypot((i & NM) + 0.5 - p.tx, (i >> NS) + 0.5 - p.ty) <= r) K.damageEBridge(G, i, p.dmg * (i === ti ? 1 : 0.5));
        }
        if (p.team === 1) {
          for (const s of new Set([w.sgrid[ti]].concat(neigh(w, p.tx, p.ty, p.splash)))) {
            const st = s && w.structs.get(s);
            if (st) K.damageStruct(G, st, st.id === w.sgrid[ti] ? p.dmg : p.dmg * 0.35);
          }
        }
        const wet = K.isWater(w.terrain[ti]) && !w.sgrid[ti];
        G.particles.push({ kind: wet ? 'splash' : 'dust', x: p.tx, y: p.ty, vx: 0, vy: -0.3, life: 0.8, max: 0.8 });
        if (!wet) for (let k = 0; k < 3; k++) G.particles.push({ kind: 'dust', x: p.tx + (Math.random() - 0.5), y: p.ty + (Math.random() - 0.5), vx: (Math.random() - 0.5), vy: -0.5, life: 0.9, max: 0.9 });
      } else if (p.struct) {
        if (w.structs.has(p.struct.id)) K.damageStruct(G, p.struct, p.dmg);
      } else if (p.beast) {
        if (!p.beast.dead) { p.beast.hp -= p.dmg; p.beast.hurtT = 4; }
      } else if (p.target && !p.target.dead) {
        const t = p.target;
        if (Math.hypot(t.x - p.tx, t.y - 0.4 - p.ty) < 1.2) {
          // walls between the archer and a ground target absorb most arrows
          if (!p.blocked || Math.random() < 0.2) K.damage(G, t, p.dmg, true);
        }
      }
    }
    G.projectiles = G.projectiles.filter((p) => !p.done);
  };
  function neigh(w, x, y, r) {
    const out = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
      if (K.inb(tx, ty) && Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= r && w.sgrid[K.idx(tx, ty)]) out.push(w.sgrid[K.idx(tx, ty)]);
    }
    return out;
  }
})();

'use strict';
// Territorial beasts: giant spiders lurk in forests, cave trolls near mountains.
// They attack any unit (yours or the enemy's) that strays near their lair, but never leave
// their territory, cannot pass walls and cannot bite through them — so a castle built
// around a lair can turn a beast into part of its defences.
(function () {
  const T = K.T;
  let N, NM, NS;
  K.onSize(() => { N = K.N; NM = N - 1; NS = Math.log2(N); });
  K.BEASTS = {
    spider: { name: 'Giant Spider', hp: 420, dmg: 16, cd: 0.9, speed: 2.6, aggro: 3.2, roam: 9, leash: 11, range: 1.25, regen: 6 },
    troll: { name: 'Cave Troll', hp: 900, dmg: 38, cd: 1.9, speed: 1.6, aggro: 2.8, roam: 7, leash: 9, range: 1.5, regen: 8 },
  };

  // Choose lairs for a new map (spiders in forests, trolls beside mountains).
  K.placeBeasts = function (G) {
    const w = G.world, R = G.rand, s = w.start;
    const lairs = [];
    const ok = (x, y, minStart) => x > 16 && y > 16 && x < N - 16 && y < N - 16 &&
      K.dist(x, y, s.x, s.y) >= minStart &&
      lairs.every((l) => K.dist(x, y, l.x, l.y) >= 22) &&
      w.entries.every((e) => K.dist(x, y, e.x, e.y) >= 20);
    const pick = (kind, count, test, minStart) => {
      for (let tries = 0, made = 0; made < count && tries < 4000; tries++) {
        const x = 16 + Math.floor(R() * (N - 32)), y = 16 + Math.floor(R() * (N - 32));
        if (!test(x, y) || !ok(x, y, minStart)) continue;
        lairs.push({ x, y, kind }); made++;
      }
    };
    const forest = (x, y) => {
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (w.t(x + dx, y + dy) === T.FOREST) n++;
      return w.t(x, y) === T.FOREST && n >= 14;
    };
    const cliff = (x, y) => {
      const t = w.t(x, y);
      if (t !== T.GRASS && t !== T.DIRT && t !== T.FOREST) return false;
      let m = 0;
      for (const [dx, dy] of K.DIRS8) if (w.t(x + dx * 2, y + dy * 2) === T.MOUNTAIN) m++;
      return m >= 2 && m <= 5;
    };
    // one spider within sight of the suggested keep site, so the gamble is on offer
    const bf = G.opts ? G.opts.beasts : 1, n = (c) => Math.round(c * bf * (N * N) / 65536);
    if (bf > 0) pick('spider', 1, (x, y) => forest(x, y) && K.dist(x, y, s.x, s.y) < 34, 18);
    pick('spider', n(4), forest, 30);
    pick('troll', n(3), cliff, 30);
    G.beasts = lairs.map((l) => {
      const d = K.BEASTS[l.kind];
      return { kind: l.kind, x: l.x + 0.5, y: l.y + 0.5, hx: l.x + 0.5, hy: l.y + 0.5, hp: d.hp, maxHp: d.hp, cd: 0, tgt: null, face: 1, atk: 0, wait: 0, gx: null, gy: null, hurtT: 0, phase: R() * 10, moving: false };
    });
    // structures cannot be dropped right on top of a beast
    G.beastBlocks = (x, y, bw, bh) => G.beasts.some((b) => !b.dead && b.x > x - 0.6 && b.x < x + bw + 0.6 && b.y > y - 0.6 && b.y < y + bh + 0.6);
  };

  function bPass(w, x, y) {
    if (!K.inb(x, y)) return false;
    const i = K.idx(x, y), t = w.terrain[i];
    if (t === T.MOUNTAIN || K.isWater(t)) return false;
    const s = w.sgrid[i] && w.structs.get(w.sgrid[i]);
    return !s || s.type === 'farm' || s.type === 'bridge';
  }
  // Walls, gates and the keep block a beast's reach.
  function clear(w, x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3);
    for (let k = 1; k < n; k++) {
      const s = w.structAt(Math.floor(x0 + (x1 - x0) * k / n), Math.floor(y0 + (y1 - y0) * k / n));
      if (s && !(s.type === 'farm' || s.type === 'bridge')) return false;
    }
    return true;
  }
  function step(G, b, tx, ty, sp, dt) {
    const w = G.world, dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
    if (d < 0.05) { b.moving = false; return true; }
    const s = Math.min(d, sp * dt), nx = b.x + (dx / d) * s, ny = b.y + (dy / d) * s;
    if (Math.abs(dx) > 0.05) b.face = dx > 0 ? 1 : -1;
    b.moving = true;
    if (bPass(w, Math.floor(nx), Math.floor(ny))) { b.x = nx; b.y = ny; return d <= sp * dt; }
    if (bPass(w, Math.floor(nx), Math.floor(b.y))) { b.x = nx; return false; }
    if (bPass(w, Math.floor(b.x), Math.floor(ny))) { b.y = ny; return false; }
    b.moving = false;
    return null; // blocked
  }

  K.updateBeasts = function (G, dt) {
    if (!G.beasts) return;
    const w = G.world;
    for (const b of G.beasts) {
      if (b.dead) continue;
      const d = K.BEASTS[b.kind];
      b.cd -= dt; b.atk -= dt; b.hurtT -= dt;
      if (b.hurtT <= 0 && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + d.regen * dt);
      // if a wall was built right where it stands, nudge it off
      if (!bPass(w, Math.floor(b.x), Math.floor(b.y))) {
        for (const [dx, dy] of K.DIRS8) if (bPass(w, Math.floor(b.x) + dx, Math.floor(b.y) + dy)) { b.x = Math.floor(b.x) + dx + 0.5; b.y = Math.floor(b.y) + dy + 0.5; break; }
      }
      const inLeash = (v) => Math.hypot(v.x - b.hx, v.y - b.hy) < d.leash + 1;
      const valid = (v) => !v.dead && !v.hidden && !v.retreat && !(v.onWall && w.structAt(Math.floor(v.x), Math.floor(v.y))) && inLeash(v) && clear(w, b.x, b.y, v.x, v.y);
      if (b.tgt && (!valid(b.tgt) || Math.hypot(b.tgt.x - b.x, b.tgt.y - b.y) > d.aggro + 3)) b.tgt = null;
      if (!b.tgt) {
        const a = K.nearest(G, b.x, b.y, d.aggro, 0, valid), e = K.nearest(G, b.x, b.y, d.aggro, 1, valid);
        b.tgt = a && e ? (Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(e.x - b.x, e.y - b.y) ? a : e) : a || e;
        if (b.tgt && b.tgt.team === 0 && !(b.warned > G.time)) {
          b.warned = G.time + 30;
          G.msg(`A ${d.name.toLowerCase()} is attacking your ${b.tgt.kind === 'king' ? 'King' : 'people'}!`, 'bad');
        }
      }
      if (b.tgt) {
        const t = b.tgt, dist = Math.hypot(t.x - b.x, t.y - b.y);
        if (dist <= d.range) {
          b.moving = false; b.face = t.x > b.x ? 1 : -1;
          if (b.cd <= 0) {
            b.cd = d.cd; b.atk = 0.35;
            K.damage(G, t, d.dmg);
            G.particles.push({ kind: 'dust', x: t.x, y: t.y - 0.3, vx: 0, vy: -0.4, life: 0.5, max: 0.5 });
          }
        } else if (step(G, b, t.x, t.y, d.speed, dt) === null) b.tgt = null;
        // melee fighters it is tangling with hit back
        K.around(G, b.x, b.y, 1.7, (v) => {
          const st = K.unitStats ? K.unitStats(v) : K.UDEF[v.type || v.kind];
          if (!st || !st.dmg || st.ranged || v.retreat) return;
          if (v.kind === 'subject' && v !== t) return;
          b.hp -= (st.dmg / (st.cd || 1)) * dt * 0.8; b.hurtT = 4;
        });
        if (b.hp <= 0) {
          b.dead = true;
          G.msg(`The ${d.name.toLowerCase()} has been slain!`, 'good');
          for (let k = 0; k < 6; k++) G.particles.push({ kind: 'dust', x: b.x + (Math.random() - 0.5), y: b.y + (Math.random() - 0.5), vx: Math.random() - 0.5, vy: -0.5, life: 1, max: 1 });
        }
        continue;
      }
      // wander around the lair
      if (b.wait > 0) { b.wait -= dt; b.moving = false; continue; }
      if (b.gx == null) {
        // pick a walkable spot anywhere in its territory; drift home if it strayed outside
        const out = Math.hypot(b.x - b.hx, b.y - b.hy) > d.roam;
        for (let k = 0; k < 8; k++) {
          const a = G.rand() * Math.PI * 2, r = (out ? 0.4 : 1) * Math.sqrt(G.rand()) * d.roam;
          b.gx = b.hx + Math.cos(a) * r; b.gy = b.hy + Math.sin(a) * r;
          if (bPass(w, Math.floor(b.gx), Math.floor(b.gy))) break;
        }
      }
      const r = step(G, b, b.gx, b.gy, d.speed * 0.35, dt);
      if (r !== false) { b.gx = null; b.wait = r === null ? 0.3 : 1 + G.rand() * 3; }
    }
  };
})();

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
    // dire wolves hunt in packs, chase further than other beasts and close in on a packmate's prey
    wolf: { name: 'Dire Wolf', hp: 240, dmg: 13, cd: 0.8, speed: 3.6, aggro: 4.5, roam: 12, leash: 17, range: 1.1, regen: 5, cap: 8 },
    // wyverns fly: over walls, water and mountains, and can snatch archers off the battlements,
    // but they are lightly built and archers can shoot them down
    wyvern: { name: 'Wyvern', hp: 380, dmg: 26, cd: 1.5, speed: 3.2, aggro: 4.5, roam: 13, leash: 16, range: 1.4, regen: 4, fly: true },
  };
  // Breeding: a male and female of the same kind within reach of each other produce a young
  // every BREED seconds; the young grows up after GROW seconds and then rests a full round
  // before it can breed. LAIR_CAP keeps a single lair from overrunning the map.
  K.BEAST_BREED = 120; K.BEAST_GROW = 120; K.BEAST_LAIR_CAP = 6;
  K.BEAST_YOUNG = 0.35; // young beasts' share of adult health and bite
  const mkBeast = (kind, x, y, hx, hy, sex, phase) => {
    const d = K.BEASTS[kind];
    return { kind, sex, x, y, hx, hy, hp: d.hp, maxHp: d.hp, cd: 0, tgt: null, face: 1, atk: 0, wait: 0, gx: null, gy: null, hurtT: 0, phase, moving: false, breedT: 0 };
  };
  const flies = (b) => !!K.BEASTS[b.kind].fly;
  K.beastCanBreed = (G, b) => !b.dead && !b.young && (b.noBreedUntil ?? -1) < G.round;

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
    pick('wolf', n(2), forest, 30);
    const peak = (x, y) => {
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (w.t(x + dx, y + dy) === T.MOUNTAIN) m++;
      return w.t(x, y) === T.MOUNTAIN && m >= 18;
    };
    pick('wyvern', n(1.5), peak, 36);
    G.beasts = [];
    for (const l of lairs) {
      const hx = l.x + 0.5, hy = l.y + 0.5;
      if (l.kind !== 'wolf') { G.beasts.push(mkBeast(l.kind, hx, hy, hx, hy, R() < 0.5 ? 'm' : 'f', R() * 10)); continue; }
      // a pack of 3-4 with both sexes; packs only begin breeding after the first siege
      const k = 3 + (R() < 0.5 ? 1 : 0);
      for (let j = 0; j < k; j++) {
        const b = mkBeast('wolf', hx + (R() - 0.5) * 2, hy + (R() - 0.5) * 2, hx, hy, j === 0 ? 'm' : j === 1 ? 'f' : R() < 0.5 ? 'm' : 'f', R() * 10);
        b.noBreedUntil = 0; G.beasts.push(b);
      }
    }
    // structures cannot be dropped right on top of a beast
    G.beastBlocks = (x, y, bw, bh) => G.beasts.some((b) => !b.dead && !flies(b) && b.x > x - 0.6 && b.x < x + bw + 0.6 && b.y > y - 0.6 && b.y < y + bh + 0.6);
  };

  // After cropping to the realm: if no wyvern survived the crop, nest one on a peak inside it.
  K.ensureWyvern = function (G, kx, ky) {
    const w = G.world, R = G.rand, n = K.PLAY_N, bf = G.opts ? G.opts.beasts : 1;
    if (bf <= 0 || G.beasts.some((b) => b.kind === 'wyvern')) return;
    const cand = [];
    for (let y = 8; y < n - 8; y++) for (let x = 8; x < n - 8; x++) {
      if (w.t(x, y) !== T.MOUNTAIN || K.dist(x, y, kx, ky) < 36) continue;
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (w.t(x + dx, y + dy) === T.MOUNTAIN) m++;
      if (m < 18 || !w.entries.every((e) => K.dist(x, y, e.x, e.y) >= 20)) continue;
      if (!G.beasts.every((b) => K.dist(x, y, b.hx, b.hy) >= 22)) continue;
      cand.push([x, y]);
    }
    if (!cand.length) return;
    const [x, y] = cand[Math.floor(R() * cand.length)];
    G.beasts.push(mkBeast('wyvern', x + 0.5, y + 0.5, x + 0.5, y + 0.5, R() < 0.5 ? 'm' : 'f', R() * 10));
  };

  function bPassG(w, x, y) {
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
  // Can a beast walk straight from (x0,y0) to (x1,y1) without meeting a wall, water or rock?
  function walkLine(w, x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4);
    for (let k = 1; k <= n; k++) {
      const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
      if (!bPassG(w, Math.floor(x), Math.floor(y))) return false;
    }
    return true;
  }
  // Can the beast still walk back to its lair? (search limited to its territory and a bit beyond)
  function reachesLair(w, b, lim) {
    const sx = Math.floor(b.x), sy = Math.floor(b.y), tx = Math.floor(b.hx), ty = Math.floor(b.hy);
    if (sx === tx && sy === ty) return true;
    const seen = new Set([sx + ',' + sy]), q = [[sx, sy]];
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      for (const [dx, dy] of K.DIRS4) {
        const nx = x + dx, ny = y + dy, key = nx + ',' + ny;
        if (seen.has(key) || Math.hypot(nx - tx, ny - ty) > lim) continue;
        seen.add(key);
        if (nx === tx && ny === ty) return true;
        if (bPassG(w, nx, ny)) q.push([nx, ny]);
      }
    }
    return false;
  }
  function step(G, b, tx, ty, sp, dt) {
    const w = G.world, dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
    const bPass = flies(b) ? (w2, x, y) => K.inb(x, y) : bPassG;
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

  function breed(G, dt) {
    const w = G.world;
    for (const b of G.beasts) {
      if (b.dead || !b.young) continue;
      b.growT -= dt;
      if (b.growT > 0) continue;
      // grows up: full size, and rests a full round before it may breed
      const d = K.BEASTS[b.kind];
      b.young = false; b.hp += d.hp - b.maxHp; b.maxHp = d.hp; b.noBreedUntil = G.round + 1;
    }
    const born = [];
    for (const b of G.beasts) if (b.sex === 'm') b.mate = null;
    for (const f of G.beasts) {
      if (f.sex !== 'f' || !K.beastCanBreed(G, f)) continue;
      const reach = K.BEASTS[f.kind].aggro;
      const mate = G.beasts.find((m) => m.sex === 'm' && m.kind === f.kind && K.beastCanBreed(G, m) &&
        Math.hypot(m.x - f.x, m.y - f.y) <= reach && (flies(f) || clear(w, f.x, f.y, m.x, m.y)));
      f.mate = mate || null;
      if (!mate) continue;
      mate.mate = f;
      f.breedT = (f.breedT || 0) + dt;
      if (f.breedT < K.BEAST_BREED) continue;
      f.breedT = 0;
      const brood = G.beasts.filter((v) => !v.dead && v.hx === f.hx && v.hy === f.hy).length + born.filter((v) => v.hx === f.hx && v.hy === f.hy).length;
      if (brood >= (K.BEASTS[f.kind].cap || K.BEAST_LAIR_CAP)) continue;
      const d = K.BEASTS[f.kind], c = mkBeast(f.kind, f.x, f.y, f.hx, f.hy, G.rand() < 0.5 ? 'm' : 'f', G.rand() * 10);
      for (const [dx, dy] of K.DIRS8) if (flies(f) || bPassG(w, Math.floor(f.x + dx * 0.6), Math.floor(f.y + dy * 0.6))) { c.x = f.x + dx * 0.6; c.y = f.y + dy * 0.6; break; }
      c.young = true; c.growT = K.BEAST_GROW; c.maxHp = c.hp = Math.round(d.hp * K.BEAST_YOUNG);
      born.push(c);
      G.msg(`A young ${d.name.toLowerCase()} has ${f.kind === 'spider' ? 'hatched' : 'been born'} — it will be fully grown in ${Math.round(K.BEAST_GROW / 60)} minutes.`, 'warn');
    }
    G.beasts.push(...born);
  }

  function slain(G, b) {
    b.dead = true;
    G.msg(`The ${K.BEASTS[b.kind].name.toLowerCase()} has been slain!`, 'good');
    for (let k = 0; k < 6; k++) G.particles.push({ kind: 'dust', x: b.x + (Math.random() - 0.5), y: b.y + (Math.random() - 0.5), vx: Math.random() - 0.5, vy: -0.5, life: 1, max: 1 });
  }
  // Archers (and any other ranged unit, either side) loose arrows at a wyvern overhead.
  function shootFlyers(G, dt) {
    for (const b of G.beasts) {
      if (b.dead || !flies(b)) continue;
      K.around(G, b.x, b.y, 8, (v) => {
        if (v.dead || v.hidden || v.retreat) return;
        const st = K.unitStats(v);
        if (!st || !st.ranged || !st.dmg) return;
        if (Math.hypot(v.x - b.x, v.y - b.y) > (st.range || 6) + (v.onWall ? 1 : 0)) return;
        v.flyCd = (v.flyCd || 0) - dt;
        if (v.flyCd > 0 || v.cd > 0) return;
        // shares the unit's normal attack cooldown, so a shot at a wyvern costs a shot at the enemy
        v.flyCd = (st.cd || 1) * 1.3; v.cd = st.cd * (0.9 + Math.random() * 0.2);
        K.shoot(G, 'arrow', v.x, v.y - 0.6, b.x, b.y - 1, { beast: b, dmg: st.dmg, team: v.team });
      });
    }
  }

  K.updateBeasts = function (G, dt) {
    if (!G.beasts) return;
    const w = G.world;
    breed(G, dt);
    shootFlyers(G, dt);
    for (const b of G.beasts) {
      if (b.dead) continue;
      const d = K.BEASTS[b.kind], fly = !!d.fly;
      if (b.hp <= 0) { slain(G, b); continue; }
      b.cd -= dt; b.atk -= dt; b.hurtT -= dt;
      if (b.hurtT <= 0 && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + d.regen * dt);
      // if a wall was built right where it stands, nudge it off
      if (!fly && !bPassG(w, Math.floor(b.x), Math.floor(b.y))) {
        for (const [dx, dy] of K.DIRS8) if (bPassG(w, Math.floor(b.x) + dx, Math.floor(b.y) + dy)) { b.x = Math.floor(b.x) + dx + 0.5; b.y = Math.floor(b.y) + dy + 0.5; break; }
      }
      const inLeash = (v) => Math.hypot(v.x - b.hx, v.y - b.hy) < d.leash + 1;
      const valid = (v) => !v.dead && !v.hidden && !v.retreat && (fly || !(v.onWall && w.structAt(Math.floor(v.x), Math.floor(v.y)))) && inLeash(v) && (fly || clear(w, b.x, b.y, v.x, v.y));
      if (b.tgt && (!valid(b.tgt) || Math.hypot(b.tgt.x - b.x, b.tgt.y - b.y) > d.aggro + 3)) b.tgt = null;
      if (!b.tgt) {
        const a = K.nearest(G, b.x, b.y, d.aggro, 0, valid), e = K.nearest(G, b.x, b.y, d.aggro, 1, valid);
        b.tgt = a && e ? (Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(e.x - b.x, e.y - b.y) ? a : e) : a || e;
        // the pack joins in: a wolf takes up any prey a packmate is chasing
        if (!b.tgt && b.kind === 'wolf') {
          const mate = G.beasts.find((o) => o !== b && !o.dead && o.kind === 'wolf' && o.hx === b.hx && o.hy === b.hy && o.tgt && valid(o.tgt));
          if (mate) b.tgt = mate.tgt;
        }
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
            K.damage(G, t, d.dmg * (b.young ? K.BEAST_YOUNG : 1));
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
        if (b.hp <= 0) slain(G, b);
        continue;
      }
      // cut off from its lair (walled or dug away)? it makes its home where it is now
      b.homeChk = (b.homeChk || 0) - dt;
      if (!fly && b.homeChk <= 0) {
        b.homeChk = 4 + G.rand() * 2;
        if (!reachesLair(w, b, d.leash + 4)) { b.hx = b.x; b.hy = b.y; b.gx = null; }
      }
      // courting: stay close to the mate rather than wandering off
      if (b.mate && !b.mate.dead) {
        const m = b.mate, dm = Math.hypot(m.x - b.x, m.y - b.y);
        b.gx = null;
        if (dm > 1.3) step(G, b, m.x, m.y, d.speed * 0.35, dt);
        else { b.moving = false; b.face = m.x > b.x ? 1 : -1; }
        continue;
      }
      // wander around the lair
      if (b.wait > 0) { b.wait -= dt; b.moving = false; continue; }
      if (b.gx == null) {
        // pick a spot in its territory it can walk straight to; drift home if it strayed outside
        const home = Math.hypot(b.x - b.hx, b.y - b.hy), out = home > d.roam;
        for (let k = 0; k < 16 && b.gx == null; k++) {
          // half the tries look nearby, so a beast boxed in by walls still finds somewhere to go
          const near = !fly && k >= 8, a = G.rand() * Math.PI * 2, r = near ? 1 + G.rand() * 4 : (out ? 0.4 : 1) * Math.sqrt(G.rand()) * d.roam;
          const gx = (near ? b.x : b.hx) + Math.cos(a) * r, gy = (near ? b.y : b.hy) + Math.sin(a) * r;
          if (near && Math.hypot(gx - b.hx, gy - b.hy) > Math.max(d.roam, home)) continue;
          if (fly ? K.inb(Math.floor(gx), Math.floor(gy)) : walkLine(w, b.x, b.y, gx, gy)) { b.gx = gx; b.gy = gy; }
        }
        if (b.gx == null) { b.wait = 0.5 + G.rand(); b.moving = false; continue; }
        b.gT = 0;
      }
      const r = step(G, b, b.gx, b.gy, d.speed * 0.35, dt);
      // sliding along an obstacle for too long: give up and pick another spot
      b.gT = (b.gT || 0) + dt;
      const lost = r === false && b.gT > Math.hypot(b.gx - b.x, b.gy - b.y) / (d.speed * 0.35) + 3;
      if (r !== false || lost) { b.gx = null; b.wait = r === null || lost ? 0.3 : 1 + G.rand() * 3; }
    }
  };
})();

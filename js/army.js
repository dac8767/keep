'use strict';
// Enemy hosts and formations, loosely modelled on how medieval armies besieged a castle:
//  - each host is split into "battles" (vanguard, main, rearguard) that march as blocks:
//    a shield wall of infantry (ladder men in the front rank), men-at-arms behind,
//    archers in the rear and mounted knights on the wings, held back as a reserve;
//  - a siege train of engines sets up out of bowshot behind a screen of guards;
//  - rams and siege towers advance under a "testudo" escort of infantry;
//  - battles halt out of bowshot to dress their ranks, then the foot assault while
//    archers close to bow range and loose volleys; cavalry is committed against a
//    breach or a sally, or once the assault has been underway for a while.
(function () {
  let N, NM, NS;
  K.onSize(() => { N = K.N; NM = N - 1; NS = Math.log2(N); });
  const SP = 0.9; // spacing between files and ranks, in tiles
  const ENGINES = { e_catapult: 1, e_trebuchet: 1, e_ballista: 1 };

  // ---------------- planning ----------------
  K.planArmy = function (G, list, defenseLen) {
    const E = G.activeEntries, R = G.rand;
    const byType = {};
    for (const t of list) (byType[t] = byType[t] || []).push(t);
    // share every unit type evenly across the entry points
    const share = E.map(() => ({}));
    for (const t in byType) byType[t].forEach((x, k) => { const s = share[k % E.length]; (s[t] = s[t] || []).push(t); });
    const window = defenseLen * 0.35;
    const out = [];
    E.forEach((entry, ei) => {
      const pool = share[ei];
      const take = (t, n) => (pool[t] || []).splice(0, n === undefined ? 1e9 : n);
      const off = ei * 6;
      // siege train with a guard screen
      const eng = [].concat(take('e_trebuchet'), take('e_catapult'), take('e_ballista'));
      if (eng.length) {
        const guard = [].concat(take('e_infantry', eng.length * 3), take('e_archer', eng.length * 2), take('e_knight', 1));
        out.push({ t: 4 + off, entry, kind: 'train', types: eng.concat(guard) });
      }
      // rams and towers, each with an escort
      const heavy = [].concat(take('e_ram'), take('e_tower'));
      heavy.forEach((t, k) => out.push({ t: window * 0.3 + k * 8 + off, entry, kind: t === 'e_ram' ? 'ram' : 'tower', types: [t].concat(take('e_infantry', 4), take('e_knight', t === 'e_ram' ? 1 : 0)) }));
      // engineers go ahead alone to bridge or fill the moat
      take('e_engineer').forEach((t, k) => out.push({ t: 3 + off + k * 2.2, entry, type: t }));
      // boats raid together
      const boats = take('e_boat');
      if (boats.length) out.push({ t: window * 0.45 + off, entry, kind: 'raid', types: boats });
      // the rest form battles of up to ~40 men
      const rest = [];
      for (const t in pool) rest.push(...pool[t]);
      const nb = Math.max(1, Math.ceil(rest.length / 40));
      const battles = Array.from({ length: nb }, () => []);
      const sorted = rest.sort();
      sorted.forEach((t, k) => battles[k % nb].push(t));
      battles.forEach((b, k) => { if (b.length) out.push({ t: 2 + off + (nb > 1 ? (k / (nb - 1)) * window : 0) + R() * 4, entry, kind: 'battle', types: b, name: nb === 1 ? 'host' : k === 0 ? 'vanguard' : k === nb - 1 ? 'rearguard' : 'main battle' }); });
    });
    return out.sort((a, b) => a.t - b.t);
  };

  // Lay out formation slots: f = forward (toward the foe), l = lateral. Anchor is the front centre.
  function rowsOf(units, f0, width, sp, role) {
    const out = [];
    units.forEach((t, k) => {
      const r = Math.floor(k / width), inRow = Math.min(width, units.length - r * width), c = k % width;
      out.push({ type: t, f: f0 - r * sp, l: (c - (inRow - 1) / 2) * sp, role });
    });
    return { slots: out, depth: Math.ceil(units.length / width) * sp };
  }
  function layout(q) {
    const types = q.types, slots = [];
    const of = (t) => types.filter((x) => x === t);
    if (q.kind === 'battle') {
      const front = of('e_ladder').concat(of('e_infantry'));
      const width = K.clamp(Math.ceil(Math.sqrt(front.length * 2.2)), 4, 10);
      let f = 0;
      const a = rowsOf(front, f, width, SP, 'front'); slots.push(...a.slots); f -= a.depth;
      const b = rowsOf(of('e_knight'), f, width, SP, 'front'); slots.push(...b.slots); f -= b.depth + 0.6;
      const c = rowsOf(of('e_archer'), f, width + 1, SP, 'archer'); slots.push(...c.slots);
      const cav = of('e_cavalry');
      const wing = (width - 1) / 2 * SP + 1.8;
      cav.forEach((t, k) => {
        const side = k % 2 ? 1 : -1, n = k >> 1;
        slots.push({ type: t, f: -0.4 - Math.floor(n / 2) * 1.3, l: side * (wing + (n % 2) * 1.2), role: 'cav' });
      });
    } else if (q.kind === 'train') {
      const eng = types.filter((t) => ENGINES[t]);
      const inf = of('e_infantry'), arc = of('e_archer'), kn = of('e_knight');
      slots.push(...rowsOf(inf, 0, Math.max(3, Math.ceil(inf.length / 2)), 1.1, 'guard').slots);
      slots.push(...rowsOf(arc, -2, Math.max(2, arc.length), 1.2, 'guard').slots);
      eng.forEach((t, k) => slots.push({ type: t, f: -4.5, l: (k - (eng.length - 1) / 2) * 2.4, role: 'engine' }));
      kn.forEach((t, k) => slots.push({ type: t, f: -3, l: (k % 2 ? 1 : -1) * (eng.length * 1.2 + 1.5), role: 'guard' }));
    } else if (q.kind === 'ram' || q.kind === 'tower') {
      slots.push({ type: types[0], f: 0, l: 0, role: 'leader' });
      const ring = [[0.2, -1.1], [0.2, 1.1], [-1.2, -0.9], [-1.2, 0.9], [-1.6, 0], [1.1, 0]];
      types.slice(1).forEach((t, k) => { const [f, l] = ring[k % ring.length]; slots.push({ type: t, f, l, role: 'escort' }); });
    } else {
      slots.push(...rowsOf(types, 0, 3, 1.3, 'front').slots);
    }
    return slots;
  }

  function sideVec(side) {
    return side === 'N' ? [0, 1] : side === 'S' ? [0, -1] : side === 'W' ? [1, 0] : [-1, 0];
  }

  K.spawnSquad = function (G, q) {
    const e = q.entry, [hx, hy] = sideVec(e.side);
    const sq = {
      id: (G.sqId = (G.sqId || 0) + 1), kind: q.kind, name: q.name, entry: e, hx, hy,
      x: e.x + 0.5 - hx * 4, y: e.y + 0.5 - hy * 4,
      state: 'march', members: [], leader: null, cls: q.kind === 'raid' ? 'boat' : 'foot',
      holdT: 0, scanT: 0, near: 1e9, assaultT: 0, idleT: 0, spread: 0,
    };
    // keep the whole block clear of the map edge sideways
    if (e.side === 'N' || e.side === 'S') sq.x = K.clamp(sq.x, 14, N - 14); else sq.y = K.clamp(sq.y, 14, N - 14);
    for (const s of layout(q)) {
      const px = sq.x + hx * s.f - hy * s.l, py = sq.y + hy * s.f + hx * s.l;
      const u = K.spawnUnit(G, 'enemy', px, py, s.type);
      u.entry = e; u.squad = sq; u.slot = s; u.role = s.role;
      if (s.role === 'leader') { sq.leader = u; u.free = true; }
      sq.members.push(u);
    }
    (G.squads = G.squads || []).push(sq);
    if (q.kind === 'battle' || q.kind === 'train') {
      const where = { N: 'north', S: 'south', W: 'west', E: 'east' }[e.side];
      G.msg(q.kind === 'train' ? `A siege train rolls in from the ${where}.` : `An enemy ${q.name} of ${sq.members.length} marches in from the ${where}.`, 'bad');
    }
    return sq;
  };

  // ---------------- per-tick squad control ----------------
  function nearestStruct(G, x, y) {
    let bd = 1e9;
    for (const s of G.world.structs.values()) {
      if (K.SDEF[s.type].eco) continue;
      const dx = Math.max(s.x - x, 0, x - (s.x + s.w)), dy = Math.max(s.y - y, 0, y - (s.y + s.h));
      const d = Math.hypot(dx, dy);
      if (d < bd) bd = d;
    }
    return Math.min(bd, G.king ? Math.hypot(G.king.x - x, G.king.y - y) : 1e9);
  }
  // True when every land route from (x, y) to the King crosses open water.
  K.moatLocked = function (G, x, y) {
    if (!G.king) return false;
    const w = G.world, kt = K.tileOf(G.king), f = w.field('foot', kt & NM, kt >> NS);
    const v = f[K.idx(K.clamp(Math.floor(x), 0, N - 1), K.clamp(Math.floor(y), 0, N - 1))];
    return v >= 20000 && v < Infinity;
  };
  function release(sq, pred) { for (const u of sq.members) if (!u.free && (!pred || pred(u))) u.free = true; }
  function say(G, key, text, kind) {
    G.sqSaid = G.sqSaid || {};
    if (G.sqSaid[key] === G.round) return;
    G.sqSaid[key] = G.round;
    G.msg(text, kind || 'bad');
  }

  K.updateSquads = function (G, dt) {
    if (!G.squads || !G.squads.length) return;
    const w = G.world;
    for (const sq of G.squads) {
      sq.members = sq.members.filter((u) => !u.dead);
      if (!sq.members.length) { sq.done = true; continue; }
      if (sq.members.some((u) => u.retreat)) { release(sq); sq.done = true; continue; }

      // rams and towers: the escort simply follows the engine
      if (sq.kind === 'ram' || sq.kind === 'tower') {
        const L = sq.leader;
        if (!L || L.dead) { release(sq); sq.done = true; continue; }
        const dx = L.x - sq.x, dy = L.y - sq.y, d = Math.hypot(dx, dy);
        if (d > 0.01) { sq.hx += (dx / d - sq.hx) * Math.min(1, dt * 2); sq.hy += (dy / d - sq.hy) * Math.min(1, dt * 2); norm(sq); }
        sq.x = L.x; sq.y = L.y;
        continue;
      }

      sq.scanT -= dt;
      if (sq.scanT <= 0) {
        sq.scanT = 0.5;
        sq.near = nearestStruct(G, sq.x, sq.y);
        let err = 0, n = 0;
        for (const u of sq.members) if (!u.free && u.slot) { const p = slotPos(sq, u.slot); err += Math.hypot(p.x - u.x, p.y - u.y); n++; }
        sq.spread = n ? err / n : 0;
      }

      if (sq.kind === 'train') { updateTrain(G, sq, dt); continue; }

      const locked = sq.kind !== 'raid' && K.moatLocked(G, sq.x, sq.y);
      if (sq.state === 'march') {
        const haltAt = sq.kind === 'raid' ? 9 : locked ? 17 : 13;
        const moved = advance(G, sq, dt);
        if (sq.near <= haltAt || !moved) {
          if (sq.kind === 'raid') { sq.state = 'assault'; release(sq); }
          else {
            sq.state = 'halt'; sq.holdT = 5 + G.rand() * 4;
            say(G, 'halt', 'The enemy halts out of bowshot and dresses its ranks…');
          }
        }
      } else if (sq.state === 'halt') {
        sq.holdT -= dt;
        if (sq.holdT <= 0 && locked) {
          sq.holdT = 2;
          say(G, 'moat', 'The enemy will not wade your moat — it waits for its engineers to cross.', 'warn');
        } else if (sq.holdT <= 0) {
          sq.state = 'assault'; sq.assaultT = 0;
          release(sq, (u) => u.role === 'front');
          say(G, 'charge', 'Horns sound — the enemy foot storms your walls under a hail of arrows!');
        }
      } else if (sq.state === 'assault') {
        sq.assaultT += dt;
        if (sq.assaultT > 75 && !locked) { release(sq); continue; }
        // the archer line closes to bow range, then stands and looses volleys
        if (sq.near > 6) advance(G, sq, dt, 0.8);
        // cavalry reserve: commit against a breach, a sally, or after a while
        if (sq.members.some((u) => u.role === 'cav' && !u.free)) {
          sq.cavT = (sq.cavT || 0) - dt;
          if (sq.cavT <= 0) {
            sq.cavT = 1;
            const breach = !w.isEnclosed(), sally = K.nearest(G, sq.x, sq.y, 10, 0);
            if (breach || sally || (sq.assaultT > 25 && !locked)) {
              release(sq, (u) => u.role === 'cav');
              say(G, 'cav', breach ? 'Enemy knights spur their horses toward the breach!' : 'The enemy commits its mounted knights!');
            }
          }
        }
      }
    }
    G.squads = G.squads.filter((s) => !s.done);
  };

  function updateTrain(G, sq, dt) {
    const eng = sq.members.filter((u) => u.role === 'engine');
    if (!eng.length) { release(sq); sq.done = true; return; }
    const firing = eng.some((u) => u.tgt);
    if (sq.state === 'march') {
      if (firing || sq.near <= 9) { sq.state = 'siege'; sq.idleT = 0; say(G, 'siege', 'Enemy engineers set up their siege engines behind a screen of guards.'); }
      else advance(G, sq, dt);
    } else {
      // creep forward if nothing is in range any more
      sq.idleT = firing ? 0 : sq.idleT + dt;
      if (sq.idleT > 8) sq.state = 'march';
    }
  }

  function norm(sq) { const d = Math.hypot(sq.hx, sq.hy) || 1; sq.hx /= d; sq.hy /= d; }
  function slotPos(sq, s) { return { x: sq.x + sq.hx * s.f - sq.hy * s.l, y: sq.y + sq.hy * s.f + sq.hx * s.l }; }

  // Move the formation's anchor one step along the flow field toward the King.
  // The block moves at the pace of its slowest member and waits for stragglers.
  function advance(G, sq, dt, mult) {
    const w = G.world;
    let base = 9;
    for (const u of sq.members) if (!u.free) base = Math.min(base, K.UDEF[u.type].speed);
    if (base === 9) return false;
    const kd = G.king ? Math.hypot(G.king.x - sq.x, G.king.y - sq.y) : 99;
    let sp = base * 0.85 * (kd > 30 ? 1.6 : kd > 18 ? 1.25 : 1) * (mult || 1);
    if (sq.spread > 2.2) sp *= 0.3; else if (sq.spread > 1.3) sp *= 0.65;
    const tx0 = Math.floor(sq.x), ty0 = Math.floor(sq.y);
    let gx, gy;
    if (!K.inb(tx0, ty0)) { gx = sq.entry.x + 0.5; gy = sq.entry.y + 0.5; }
    else {
      const i = K.idx(tx0, ty0), t = w.terrain[i];
      if (t === K.T.FOREST) sp *= 0.7; else if (K.isWater(t) && sq.cls !== 'boat') sp *= 0.5;
      const kt = K.tileOf(G.king), f = w.field(sq.cls, kt & NM, kt >> NS);
      let best = -1, bd = f[i];
      for (const [dx, dy] of K.DIRS8) {
        const nx = tx0 + dx, ny = ty0 + dy;
        if (!K.inb(nx, ny)) continue;
        const j = K.idx(nx, ny);
        if (w.eCan(sq.cls, j) !== 0) continue;
        if (dx && dy && !w.diagOk(i, j, K.idx(nx, ty0), K.idx(tx0, ny), (k) => w.eCan(sq.cls, k) !== 0)) continue;
        const fd = f[j] + (dx && dy ? 0.01 : 0);
        if (fd < bd) { bd = fd; best = j; }
      }
      if (best < 0) return false;
      gx = (best & NM) + 0.5; gy = (best >> NS) + 0.5;
    }
    const dx = gx - sq.x, dy = gy - sq.y, d = Math.hypot(dx, dy);
    if (d < 0.01) return true;
    // turn the block gradually so the ranks wheel rather than snap
    sq.hx += (dx / d - sq.hx) * Math.min(1, dt * 0.8); sq.hy += (dy / d - sq.hy) * Math.min(1, dt * 0.8); norm(sq);
    const s = Math.min(d, sp * dt);
    sq.x += (dx / d) * s; sq.y += (dy / d) * s;
    return true;
  }

  // Called from the enemy AI: walk to this unit's place in the formation.
  // Returns false when the unit should fall back to its own pathing.
  K.followSlot = function (G, u, dt, speed) {
    const sq = u.squad, w = G.world;
    const p = slotPos(sq, u.slot);
    let tx = p.x, ty = p.y;
    const ti = Math.floor(tx), tj = Math.floor(ty);
    const cls = K.enemyCls(u);
    if (K.inb(ti, tj) && w.eCan(cls, K.idx(ti, tj)) !== 0) {
      // slot is in a wall/lake: close in on the anchor instead
      tx = sq.x; ty = sq.y;
      if (K.inb(Math.floor(tx), Math.floor(ty)) && w.eCan(cls, K.idx(Math.floor(tx), Math.floor(ty))) !== 0) return false;
    }
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    const ui = Math.floor(u.x), uj = Math.floor(u.y), ai = Math.floor(sq.x), aj = Math.floor(sq.y);
    if (d > 2.5 && G.king && K.inb(ui, uj) && K.inb(ai, aj)) {
      // separated from the block (e.g. by a river): take the army's route to rejoin, or wait if ahead
      const kt = K.tileOf(G.king), f = w.field(cls, kt & NM, kt >> NS);
      if (f[K.idx(ui, uj)] < f[K.idx(ai, aj)] - 1) { u.moving = false; return true; }
      return false;
    }
    if (d < 0.12) { u.moving = false; if (Math.abs(sq.hx) > 0.3) u.face = sq.hx > 0 ? 1 : -1; return true; }
    const sp = speed * (d > 1.2 ? 1.3 : 1);
    const st = Math.min(d, sp * dt);
    const nx = u.x + (dx / d) * st, ny = u.y + (dy / d) * st;
    const ni = Math.floor(nx), nj = Math.floor(ny);
    if (K.inb(ni, nj) && w.eCan(cls, K.idx(ni, nj)) !== 0) {
      // slide along whichever axis is open
      if (K.inb(ni, Math.floor(u.y)) && w.eCan(cls, K.idx(ni, Math.floor(u.y))) === 0) { u.x = nx; }
      else if (K.inb(Math.floor(u.x), nj) && w.eCan(cls, K.idx(Math.floor(u.x), nj)) === 0) { u.y = ny; }
      else return false;
    } else { u.x = nx; u.y = ny; }
    u.moving = true;
    if (Math.abs(dx) > 0.03) u.face = dx > 0 ? 1 : -1;
    return true;
  };
})();

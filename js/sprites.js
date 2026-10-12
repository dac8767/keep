'use strict';
// All art is procedurally painted pixel-by-pixel into small offscreen canvases at startup.
(function () {
  const S = (K.SPR = {});
  const OUT = '#1b1622';

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const P = {
      c, g, w, h,
      p(x, y, col) { if (!col) return; g.fillStyle = col; g.fillRect(x | 0, y | 0, 1, 1); },
      r(x, y, w2, h2, col) { if (!col) return; g.fillStyle = col; g.fillRect(x | 0, y | 0, w2 | 0, h2 | 0); },
      line(x0, y0, x1, y1, col) {
        x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let e = dx + dy;
        for (;;) {
          P.p(x0, y0, col);
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * e;
          if (e2 >= dy) { e += dy; x0 += sx; }
          if (e2 <= dx) { e += dx; y0 += sy; }
        }
      },
      circ(cx, cy, rad, col) {
        for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad * 0.8) P.p(cx + x, cy + y, col);
      },
    };
    return P;
  }
  K.mkCanvas = mk;

  // Adds a 1px dark outline around all opaque pixels.
  function outline(P, col) {
    const { g, w, h } = P;
    const img = g.getImageData(0, 0, w, h), d = img.data;
    const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3]);
    const pts = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (a(x, y) === 0 && (a(x - 1, y) > 128 || a(x + 1, y) > 128 || a(x, y - 1) > 128 || a(x, y + 1) > 128)) pts.push([x, y]);
    g.fillStyle = col || OUT;
    for (const [x, y] of pts) g.fillRect(x, y, 1, 1);
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
    if (f > 0) { r += (255 - r) * f; gg += (255 - gg) * f; b += (255 - b) * f; }
    else { r *= 1 + f; gg *= 1 + f; b *= 1 + f; }
    return '#' + [r, gg, b].map((v) => Math.round(K.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  }
  K.shade = shade;

  const TEAM = [
    { a: '#3d63d8', b: '#253f92', c: '#86a6ff' },
    { a: '#c63b2f', b: '#7a1d16', c: '#ff8576' },
  ];
  const SKIN = '#f1c49b', SKIN2 = '#cf966a', METAL = '#c9ced8', METAL2 = '#848b99', WOOD = '#8a5a2c', WOOD2 = '#5f3c1b', GOLD = '#f4cb4e';

  // ---------------- humanoids ----------------
  // o: {body, belt, legs, hat, weapon, shield, cape, team}
  function humanoid(o, frame) {
    const P = mk(16, 18);
    const ox = 2, oy = 2;
    const p = (x, y, c) => P.p(x + ox, y + oy, c), r = (x, y, w, h, c) => P.r(x + ox, y + oy, w, h, c);
    const tm = TEAM[o.team];
    const body = o.body === 'team' ? tm.a : o.body;
    const body2 = o.body === 'team' ? tm.b : shade(body, -0.3);
    if (o.cape) r(2, 6, 8, 6, o.cape === 'team' ? tm.b : o.cape);
    if (o.hair2) { r(3, 2, 1, 6, o.hair2); r(8, 2, 1, 6, o.hair2); r(4, 6, 4, 1, o.hair2); }
    // long flowing hair falling past the shoulders
    if (o.longHair) { const h = o.longHair, h2 = shade(h, -0.25); r(3, 1, 6, 2, h); r(2, 2, 2, 8, h); r(8, 2, 2, 8, h); p(2, 9, h2); p(9, 9, h2); r(2, 4, 1, 5, h2); r(9, 4, 1, 5, h2); }
    // legs
    const L = o.legs || '#4b3a2b', shoe = '#2a1f17';
    const lA = frame === 1 ? 1 : 0, lB = frame === 2 ? 1 : 0;
    r(3, 10, 2, 2 - lA, L); p(3, 12 - lA, shoe); p(4, 12 - lA, shoe);
    r(7, 10, 2, 2 - lB, L); p(7, 12 - lB, shoe); p(8, 12 - lB, shoe);
    // a floor-length gown hides the legs
    if (o.gown) {
      r(3, 9, 6, 3, o.gown); r(2, 10, 8, 3, o.gown); r(1, 12, 10, 1, o.gown); r(1, 13, 10, 1, shade(o.gown, -0.3));
      r(5, 9, 2, 4, shade(o.gown, 0.25)); p(4, 12, GOLD); p(7, 12, GOLD);
    }
    // torso
    r(3, 6, 6, 4, body);
    r(8, 6, 1, 4, body2);
    r(3, 9, 6, 1, o.belt || '#5a3d22');
    if (o.tabard) { r(5, 6, 2, 4, tm.a); p(5, 9, tm.b); p(6, 9, tm.b); }
    if (o.chest) p(4, 7, o.chest);
    // ermine-trimmed mantle across the shoulders
    if (o.ermine) { r(2, 6, 8, 1, '#f4efe6'); r(3, 7, 6, 1, '#e4ddd0'); p(4, 6, '#222'); p(7, 7, '#222'); p(9, 6, '#222'); }
    if (o.necklace) { r(4, 6, 4, 1, GOLD); p(6, 7, '#5ad1ff'); }
    if (o.smock) { r(4, 7, 4, 3, o.smock); p(4, 6, o.smock); p(7, 6, o.smock); r(4, 9, 4, 1, shade(o.smock, -0.25)); p(6, 8, shade(o.smock, 0.2)); }
    // arms
    const arm = o.arm || body;
    const sw = frame === 3 ? -1 : 0;
    r(2, 6 + sw, 1, 2, arm); p(2, 8 + sw, SKIN);
    r(9, 6, 1, 2, shade(arm, -0.2)); p(9, 8, SKIN);
    // head
    r(4, 2, 4, 4, SKIN);
    r(4, 5, 4, 1, SKIN2);
    p(5, 4, '#2b1d14'); p(7, 4, '#2b1d14');
    if (o.lips) r(5, 5, 2, 1, o.lips);
    if (o.beard) { const b = o.beard; p(4, 4, b); p(7, 4, b); r(4, 5, 4, 2, b); r(5, 7, 2, 1, b); r(5, 5, 2, 1, shade(b, -0.3)); }
    switch (o.hat) {
      case 'hair': r(4, 1, 4, 2, o.hair || '#6b4423'); p(4, 3, o.hair || '#6b4423'); break;
      case 'cap': r(3, 1, 6, 2, o.capCol || tm.a); r(4, 0, 4, 1, o.capCol || tm.a); break;
      case 'straw':
        // wide-brimmed straw hat with a band, shading the face
        r(1, 2, 10, 1, '#e3c46a'); p(1, 2, '#c9a24a'); p(10, 2, '#c9a24a');
        r(2, 3, 8, 1, '#b8913f'); r(4, 3, 4, 1, SKIN2);
        r(4, 0, 4, 2, '#efd47c'); r(4, 1, 4, 1, '#9a4a26'); p(5, 0, '#fbe6a0');
        break;
      case 'hood': r(3, 1, 6, 2, tm.a); r(3, 3, 1, 3, tm.a); r(8, 3, 1, 3, tm.b); r(4, 0, 4, 1, tm.b); break;
      case 'helm': r(4, 0, 4, 2, METAL); r(3, 2, 6, 1, METAL2); p(5, 0, '#fff'); break;
      case 'greathelm':
        r(3, 1, 6, 5, METAL); r(8, 1, 1, 5, METAL2); r(4, 3, 4, 1, '#2b2b35'); p(5, 0, tm.a); p(6, 0, tm.a); p(6, -1, tm.c);
        break;
      case 'crown':
        r(4, 1, 4, 2, '#8a5a2a');
        r(4, 1, 4, 1, GOLD); p(4, 0, GOLD); p(7, 0, GOLD); p(5, 0, GOLD); p(6, 0, '#e2453c');
        break;
      case 'bigcrown':
        // a tall, heavy king's crown
        r(3, 1, 6, 2, GOLD); r(3, 2, 6, 1, '#c99a2a');
        p(3, 0, GOLD); p(3, -1, GOLD); p(5, 0, GOLD); p(6, 0, GOLD); p(5, -1, GOLD); p(6, -1, GOLD); p(5, -2, '#fff6c0'); p(8, 0, GOLD); p(8, -1, GOLD);
        p(4, 1, '#e2453c'); p(6, 1, '#3a7be0'); p(7, 1, '#e2453c');
        break;
      case 'tiara':
        // a slender tiara with a blue jewel
        r(4, 1, 4, 1, GOLD); p(5, 0, GOLD); p(6, 0, '#5ad1ff'); p(6, -1, GOLD); p(7, 0, GOLD);
        break;
    }
    // weapons
    const atk = frame === 3;
    switch (o.weapon) {
      case 'sword':
        if (atk) { P.line(ox + 10, oy + 8, ox + 14, oy + 4, METAL); p(10, 8, GOLD); }
        else { r(10, 2, 1, 6, METAL); p(10, 2, '#fff'); r(9, 8, 3, 1, GOLD); p(10, 9, WOOD2); }
        break;
      case 'spear':
        r(10, atk ? -2 : 0, 1, 12, WOOD); r(10, atk ? -3 : -1, 1, 2, METAL); p(10, atk ? -3 : -1, '#fff');
        break;
      case 'bow':
        P.line(ox + 10, oy + 3, ox + 11, oy + 5, WOOD); r(11, 5, 1, 3, WOOD); P.line(ox + 11, oy + 8, ox + 10, oy + 10, WOOD);
        r(atk ? 9 : 10, 4, 1, 6, '#ddd');
        if (atk) r(8, 6, 4, 1, '#a07a50');
        break;
      case 'axe': {
        const y0 = atk ? 1 : 4;
        r(10, y0, 1, 6, WOOD); r(10, y0, 2, 2, METAL); p(11, y0 + 2, METAL2);
        break;
      }
      case 'pick': {
        const y0 = atk ? 1 : 4;
        r(10, y0, 1, 6, WOOD); P.line(ox + 8, oy + y0, ox + 12, oy + y0 + 1, METAL2);
        break;
      }
      case 'hoe': r(10, atk ? 2 : 3, 1, 8, WOOD); r(10, atk ? 11 : 11, 2, 1, METAL2); break;
      case 'scythe':
        if (atk) { P.line(ox + 9, oy + 3, ox + 12, oy + 11, WOOD); p(10, 6, WOOD2); r(6, 12, 6, 1, METAL); p(5, 11, METAL); p(11, 11, METAL2); }
        else { r(10, -1, 1, 12, WOOD); p(9, 6, WOOD2); p(11, 4, WOOD2); r(6, -1, 4, 1, METAL); p(5, 0, METAL); p(6, 0, METAL2); p(9, -1, '#fff'); }
        break;
      case 'hammer': { const y0 = atk ? 2 : 5; r(10, y0, 1, 5, WOOD); r(9, y0, 3, 2, METAL2); break; }
      case 'shovel': { const y0 = atk ? 3 : 1; r(10, y0, 1, 8, WOOD); r(9, y0 + 8, 3, 3, METAL2); p(10, y0 + 10, METAL); break; }
      case 'satchel': r(9, 8, 3, 3, '#7a5230'); p(10, 9, '#d63a2f'); break;
      case 'scepter': r(10, 3, 1, 6, GOLD); p(10, 2, '#e2453c'); break;
      case 'kingsword':
        if (atk) { P.line(ox + 10, oy + 8, ox + 14, oy + 3, METAL); r(9, 8, 3, 1, GOLD); }
        else { r(10, 0, 1, 8, METAL); p(10, 0, '#fff'); r(9, 8, 3, 1, GOLD); p(10, 9, '#7a1f1f'); p(10, 10, GOLD); }
        break;
      case 'orb': r(9, 7, 3, 3, GOLD); p(10, 6, GOLD); p(10, 5, '#5ad1ff'); p(9, 7, '#fff6c0'); break;
      case 'mace': r(10, 4, 1, 5, WOOD); r(9, atk ? 1 : 2, 3, 2, METAL2); break;
    }
    if (o.shield) {
      r(0, 6, 3, 4, tm.a); r(0, 6, 3, 1, tm.c); p(1, 7, GOLD); r(0, 9, 3, 1, tm.b);
    }
    if (o.ladder) {
      // carried ladder overhead
      r(-2, -1, 16, 1, WOOD); r(-2, 2, 16, 1, WOOD);
      for (let x = -2; x < 14; x += 3) r(x, 0, 1, 2, WOOD2);
    }
    outline(P);
    return P.c;
  }

  function horseRider(team, frame, bare) {
    const P = mk(24, 22);
    const tm = TEAM[team];
    const H = '#7a5232', H2 = '#57391f', MANE = '#2f1f13';
    const ox = 2, oy = 5;
    const p = (x, y, c) => P.p(x + ox, y + oy, c), r = (x, y, w, h, c) => P.r(x + ox, y + oy, w, h, c);
    // legs (animated)
    const lg = [[3, 0], [6, 1], [12, 0], [15, 1]];
    for (const [lx, ph] of lg) {
      const up = (frame === 1 && ph === 0) || (frame === 2 && ph === 1) ? 1 : 0;
      r(lx, 11, 1, 3 - up, H2); p(lx, 14 - up, '#222');
    }
    // body
    r(2, 6, 15, 5, H); r(2, 10, 15, 1, H2); r(3, 6, 12, 1, shade(H, 0.15));
    // caparison
    r(5, 6, 9, 5, tm.a); r(5, 10, 9, 1, tm.b); r(5, 6, 9, 1, tm.c); p(9, 8, GOLD);
    // neck & head
    r(16, 3, 2, 5, H); r(17, 2, 3, 3, H); p(20, 4, H2); p(18, 3, '#111'); r(15, 2, 2, 4, MANE);
    // tail
    r(0, 6, 2, 1, MANE); r(0, 7, 1, 3, MANE);
    if (bare) {
      // saddle only: a subject sprite is drawn on top
      r(7, 5, 6, 2, '#3a2416'); r(8, 4, 4, 1, '#5a3a24');
      outline(P);
      return P.c;
    }
    // rider
    r(7, 0, 5, 6, METAL); r(11, 0, 1, 6, METAL2); r(8, 1, 3, 4, tm.a);
    r(8, -4, 4, 4, METAL); r(8, -2, 4, 1, '#2b2b35'); p(9, -5, tm.a); p(10, -5, tm.a);
    // lance
    if (frame === 3) P.line(ox + 11, oy + 2, ox + 22, oy - 1, WOOD);
    else P.line(ox + 11, oy + 3, ox + 19, oy - 5, WOOD);
    p(frame === 3 ? 21 : 19, frame === 3 ? -1 : -5, METAL);
    outline(P);
    return P.c;
  }

  const HUM = {
    queen: { body: '#c23a78', belt: GOLD, legs: '#3b2a4a', hat: 'tiara', longHair: '#e8b94a', lips: '#d0506a', necklace: true, weapon: 'orb', cape: '#2f5fb3', arm: '#c23a78', gown: '#a82c64' },
    king: { body: '#8e1f2a', belt: GOLD, legs: '#3b2a4a', hat: 'bigcrown', beard: '#6b3a1e', ermine: true, weapon: 'kingsword', cape: '#5a2d8c', arm: '#8e1f2a', chest: GOLD },
    subject: { body: '#a88a5c', belt: 'team', legs: '#5b4632', hat: 'hair' },
    wood: { body: '#7f9b4a', legs: '#5b4632', hat: 'hair', weapon: 'axe' },
    stone: { body: '#9c9284', legs: '#5b4632', hat: 'cap', capCol: '#8a7a64', weapon: 'pick' },
    ore: { body: '#6c6058', legs: '#3b302a', hat: 'cap', capCol: '#c8a23a', weapon: 'pick' },
    smelt: { body: '#a0522d', legs: '#3b302a', hat: 'hair', hair: '#222', weapon: 'hammer' },
    farm: { body: '#ece2c4', arm: '#e0d3ae', legs: '#7a6440', belt: '#6b4a24', smock: '#6f8a3a', hat: 'straw', weapon: 'scythe' },
    dig: { body: '#8a6a44', legs: '#4b3a2b', hat: 'cap', capCol: '#6b5134', weapon: 'shovel' },
    medic: { body: '#ece6da', legs: '#6b5c4a', hat: 'cap', capCol: '#ece6da', chest: '#d63a2f', belt: '#d63a2f', weapon: 'satchel' },
    repair: { body: '#8b8f99', legs: '#4a4a52', hat: 'cap', capCol: '#6d6255', weapon: 'hammer' },
    archer: { body: 'team', legs: '#4a3d2b', hat: 'hood', weapon: 'bow', belt: '#6b4a24' },
    infantry: { body: METAL2, arm: METAL2, legs: '#4b3a2b', hat: 'helm', weapon: 'spear', shield: true, tabard: true },
    knight: { body: METAL, arm: METAL, legs: METAL2, hat: 'greathelm', weapon: 'sword', shield: true, tabard: true },
    e_infantry: { body: METAL2, arm: '#6c4a32', legs: '#4b3a2b', hat: 'helm', weapon: 'spear', shield: true, tabard: true },
    e_archer: { body: 'team', legs: '#4a3d2b', hat: 'hood', weapon: 'bow' },
    e_knight: { body: METAL, arm: METAL, legs: METAL2, hat: 'greathelm', weapon: 'mace', shield: true, tabard: true },
    e_ladder: { body: '#7a5a3a', legs: '#4b3a2b', hat: 'helm', weapon: 'sword', tabard: true, ladder: true },
    e_engineer: { body: '#7d6a4a', arm: '#6c4a32', legs: '#4b3a2b', hat: 'helm', weapon: 'shovel', belt: '#3a2a1a', tabard: true },
    e_boat: { body: '#5a6a7a', legs: '#4b3a2b', hat: 'helm', weapon: 'axe', tabard: true },
  };

  function buildUnits() {
    S.unit = {};
    for (const k in HUM) {
      const o = Object.assign({}, HUM[k]);
      o.team = k.startsWith('e_') ? 1 : 0;
      if (o.belt === 'team') o.belt = TEAM[o.team].a;
      S.unit[k] = [0, 1, 2, 3].map((f) => humanoid(o, f));
      // a ladder-free version for after the ladder is planted
      if (o.ladder) { o.ladder = false; S.unit[k + '_free'] = [0, 1, 2, 3].map((f) => humanoid(o, f)); }
    }
    S.unit.e_cavalry = [0, 1, 2, 3].map((f) => horseRider(1, f));
    S.unit.cavalry = [0, 1, 2, 3].map((f) => horseRider(0, f));
    S.horse = [0, 1, 2, 3].map((f) => horseRider(0, f, true));
    S.unit.e_ram = [0, 1].map((f) => ram(f));
    S.unit.e_tower = [tower()];
    S.unit.e_catapult = [0, 1].map((f) => catapult(1, f));
    S.unit.e_ballista = [ballista()];
    S.unit.e_trebuchet = [0, 1].map((f) => trebuchet(1, f));
    S.boat = boat();
  }

  // ---------------- siege engines ----------------
  function wheel(P, x, y, f) {
    P.circ(x, y, 2, '#3a2512'); P.p(x, y, '#b08850');
    P.p(x + (f ? 1 : 0), y + (f ? 0 : 1), '#8a6a3a');
  }
  function ram(f) {
    const P = mk(26, 18);
    P.r(2, 4, 22, 9, '#6e4a26');
    for (let x = 3; x < 24; x += 3) P.r(x, 4, 2, 9, '#8a5e30');
    P.r(2, 4, 22, 1, '#a9773f');
    P.r(1, 12, 24, 2, '#4f3219');
    P.r(f ? 21 : 22, 8, 4, 3, '#6b4d33'); P.r(f ? 24 : 25, 8, 1, 3, '#555c66');
    P.r(0, 7, 3, 2, '#5a3d22');
    wheel(P, 5, 14, f); wheel(P, 12, 14, f); wheel(P, 19, 14, f);
    P.r(9, 2, 6, 2, TEAM[1].a);
    outline(P);
    return P.c;
  }
  function tower() {
    const P = mk(20, 32);
    P.r(3, 4, 14, 24, '#7a5530');
    for (let y = 5; y < 28; y += 3) P.r(3, y, 14, 1, '#5e3f20');
    P.r(3, 4, 2, 24, '#94683a'); P.r(15, 4, 2, 24, '#5a3c1e');
    P.r(4, 9, 12, 5, '#a8865a'); P.r(4, 9, 12, 1, '#c4a275');
    P.r(2, 2, 16, 3, '#6a4728');
    for (let x = 2; x < 18; x += 4) P.r(x, 0, 2, 2, '#6a4728');
    P.r(9, -0, 1, 1, '#000');
    P.r(10, 0, 1, 1, '#000');
    P.r(8, 16, 4, 7, '#3a2512');
    P.r(1, 27, 18, 2, '#4f3219');
    wheel(P, 4, 29, 0); wheel(P, 15, 29, 0);
    P.r(11, 1, 4, 3, TEAM[1].a);
    outline(P);
    return P.c;
  }
  function catapult(team, f) {
    const P = mk(20, 18);
    P.r(2, 9, 16, 4, '#6e4a26'); P.r(2, 9, 16, 1, '#9a6d3b');
    P.r(4, 5, 2, 5, '#5a3c1e'); P.r(14, 5, 2, 5, '#5a3c1e'); P.r(4, 5, 12, 1, '#7a5530');
    if (f === 0) { P.line(6, 9, 16, 6, '#8a5e30'); P.r(15, 4, 3, 3, '#4a3018'); P.p(16, 4, '#888'); }
    else { P.line(9, 9, 6, 1, '#8a5e30'); P.r(4, 0, 3, 2, '#4a3018'); }
    P.r(8, 8, 4, 2, TEAM[team].a);
    wheel(P, 4, 14, 0); wheel(P, 15, 14, 0);
    outline(P);
    return P.c;
  }
  function ballista() {
    const P = mk(18, 14);
    P.r(3, 7, 12, 3, '#6e4a26');
    P.line(1, 3, 8, 6, '#5a3c1e'); P.line(16, 3, 9, 6, '#5a3c1e');
    P.line(1, 3, 8, 8, '#ddd'); P.line(16, 3, 9, 8, '#ddd');
    P.r(8, 1, 2, 9, '#8a5e30'); P.r(8, 0, 2, 1, METAL);
    P.r(6, 7, 6, 1, TEAM[1].a);
    wheel(P, 4, 11, 0); wheel(P, 13, 11, 0);
    outline(P);
    return P.c;
  }
  function trebuchet(team, f) {
    const P = mk(28, 30);
    P.r(3, 24, 22, 3, '#5a3c1e');
    P.line(6, 24, 12, 8, '#6e4a26'); P.line(7, 24, 13, 8, '#6e4a26');
    P.line(21, 24, 15, 8, '#6e4a26'); P.line(20, 24, 14, 8, '#6e4a26');
    P.r(11, 7, 6, 2, '#8a5e30');
    if (f === 0) { P.line(14, 8, 25, 2, '#9a6d3b'); P.line(14, 8, 8, 12, '#9a6d3b'); P.r(5, 11, 5, 5, '#555c66'); P.r(5, 11, 5, 1, '#888f9a'); }
    else { P.line(14, 8, 4, 0, '#9a6d3b'); P.line(14, 8, 19, 14, '#9a6d3b'); P.r(17, 14, 5, 5, '#555c66'); P.r(17, 14, 5, 1, '#888f9a'); }
    P.r(12, 18, 4, 3, TEAM[team].a);
    wheel(P, 5, 27, 0); wheel(P, 22, 27, 0);
    outline(P);
    return P.c;
  }
  function boat() {
    const P = mk(18, 9);
    P.r(2, 2, 14, 5, '#7a5530'); P.r(1, 3, 1, 3, '#7a5530'); P.r(16, 3, 1, 3, '#7a5530');
    P.r(3, 3, 12, 3, '#4a2f17'); P.r(2, 2, 14, 1, '#a07040');
    P.r(4, 4, 1, 1, '#8a5e30'); P.r(13, 4, 1, 1, '#8a5e30');
    outline(P);
    return P.c;
  }

  // ---------------- terrain features ----------------
  function oak(v) {
    const P = mk(16, 16);
    const R = K.rng(1000 + v);
    const greens = ['#27561f', '#336f29', '#3f8833', '#53a243'];
    P.r(7, 10, 2, 5, '#5b3a1f'); P.p(8, 10, '#3e2713'); P.r(6, 14, 4, 1, '#4a2f17');
    const cx = 8, cy = 7, rad = 5 + (v % 2);
    for (let y = -rad; y <= rad; y++)
      for (let x = -rad; x <= rad; x++) {
        const d = Math.hypot(x, y * 1.1);
        if (d > rad - R() * 1.2) continue;
        const l = (-x - y) / (rad * 2) + R() * 0.35;
        P.p(cx + x, cy + y, greens[K.clamp(Math.floor((l + 0.6) * 2.4), 0, 3)]);
      }
    outline(P, '#14301099'.slice(0, 7));
    return P.c;
  }
  function pine(v) {
    const P = mk(16, 16);
    const R = K.rng(2000 + v);
    P.r(7, 12, 2, 3, '#4f321a');
    for (let y = 0; y < 13; y++) {
      const w = Math.floor(1 + y * 0.55 + (y % 4 === 3 ? -1 : 0));
      for (let x = -w; x <= w; x++) {
        const l = -x / (w + 1) + R() * 0.4 - (y % 4) * 0.1;
        P.p(8 + x, y + 1, l > 0.5 ? '#3d7a3a' : l > 0 ? '#2c5e2c' : '#1f4524');
      }
    }
    P.p(8, 0, '#3d7a3a');
    outline(P, '#10261a');
    return P.c;
  }
  function rocks(v) {
    const P = mk(16, 16);
    const R = K.rng(3000 + v);
    const n = 2 + (v % 3);
    for (let k = 0; k < n; k++) {
      const cx = 3 + R() * 10, cy = 4 + R() * 9, rad = 2 + R() * 2.5;
      for (let y = -rad; y <= rad; y++)
        for (let x = -rad; x <= rad; x++) {
          if (x * x + y * y * 1.4 > rad * rad) continue;
          const l = (-x - y) / rad;
          P.p(cx + x, cy + y, l > 0.6 ? '#c4c2bc' : l > -0.3 ? '#9b9890' : '#6f6c66');
        }
    }
    outline(P, '#3a3632');
    return P.c;
  }
  function stump() {
    const P = mk(16, 16);
    P.r(6, 9, 4, 3, '#6b4423'); P.r(6, 9, 4, 1, '#c79a5e'); P.p(7, 9, '#a87a44');
    outline(P, '#2b1a0e');
    return P.c;
  }

  // ---------------- player structures ----------------
  function bricks(P, x0, y0, w, h, base, mortar, hi) {
    P.r(x0, y0, w, h, base);
    for (let y = 0; y < h; y += 3) {
      P.r(x0, y0 + y, w, 1, mortar);
      const off = (y / 3) % 2 ? 2 : 0;
      for (let x = off; x < w; x += 5) P.r(x0 + x, y0 + y, 1, 3, mortar);
      if (hi) for (let x = off + 1; x < w; x += 5) P.p(x0 + x, y0 + y + 1, hi);
    }
  }
  // The Keep seen from above: a hollow stone hall with a throne in the middle. The 3x3 footprint
  // starts at y=12; the south-middle tile is the doorway (the door itself is its own sprite).
  function keep() {
    const P = mk(48, 60), Y = 12;
    const top = '#b9b3a6', topD = '#9a9486', face = '#8a8478', faceD = '#6c675e', mort = '#5d5850';
    // wall tops and the outer south face
    bricks(P, 0, Y, 48, 40, top, topD, '#d2ccbf');
    bricks(P, 0, Y + 40, 48, 8, face, mort);
    P.r(0, Y + 40, 48, 1, faceD);
    // the hall: inner face of the north wall, flagstone floor
    bricks(P, 15, Y + 14, 18, 5, face, mort);
    P.r(15, Y + 19, 18, 15, '#7d6a52');
    for (let y = Y + 19; y < Y + 34; y += 4) { P.r(15, y, 18, 1, '#6a5944'); for (let x = 15 + ((y >> 2) % 2) * 3; x < 33; x += 6) P.r(x, y, 1, 4, '#6a5944'); }
    P.r(15, Y + 14, 1, 20, '#55504a'); P.r(32, Y + 14, 1, 20, '#55504a');
    // doorway passage through the south wall
    P.r(18, Y + 34, 12, 14, '#6e5d48'); P.r(17, Y + 34, 1, 14, faceD); P.r(30, Y + 34, 1, 14, faceD);
    // red carpet from the door to the throne
    P.r(21, Y + 26, 6, 22, '#9c2a2e'); P.r(21, Y + 26, 1, 22, '#c9a23a'); P.r(26, Y + 26, 1, 22, '#c9a23a');
    // torches on the north wall
    for (const tx of [17, 30]) { P.r(tx, Y + 16, 1, 2, '#5a3a1a'); P.p(tx, Y + 15, '#ffb030'); P.p(tx, Y + 14, '#ffe08a'); }
    // the throne
    P.r(20, Y + 13, 8, 10, '#c9a23a'); P.r(21, Y + 14, 6, 8, '#a8262c'); P.r(21, Y + 14, 6, 1, '#d24a4a');
    P.p(20, Y + 12, GOLD); P.p(27, Y + 12, GOLD); P.p(23, Y + 11, GOLD); P.p(24, Y + 11, GOLD);
    P.r(19, Y + 22, 10, 4, '#a07a2a'); P.r(20, Y + 22, 8, 2, '#a8262c'); P.r(19, Y + 25, 10, 1, '#6e521c');
    // corner towers stand a little proud of the walls
    for (const [tx, ty] of [[0, Y - 4], [34, Y - 4], [0, Y + 30], [34, Y + 30]]) {
      bricks(P, tx, ty, 14, 14, '#c4bfb3', topD, '#ddd8cc');
      for (let x = 0; x < 14; x += 4) P.r(tx + x, ty - 2, 3, 2, '#c4bfb3');
      P.r(tx, ty + 13, 14, 1, faceD);
    }
    for (const tx of [3, 39]) P.r(tx, Y + 43, 2, 4, '#2b2630');
    // banner pole on the north-east tower
    P.r(41, 0, 1, Y - 2, '#4a3a2a');
    outline(P);
    return P.c;
  }
  function keepDoor() {
    const P = mk(16, 20);
    P.r(1, 0, 14, 4, '#9a9486'); P.r(1, 3, 14, 1, '#6c675e');
    P.r(2, 4, 12, 16, '#5e3c1c');
    for (const x of [5, 8, 11]) P.r(x, 4, 1, 16, '#3e2610');
    P.r(2, 8, 12, 1, '#2b2b35'); P.r(2, 15, 12, 1, '#2b2b35');
    P.p(9, 11, GOLD); P.p(10, 12, GOLD);
    outline(P, '#1e140a');
    return P.c;
  }
  function house(v) {
    const P = mk(32, 40);
    const roof = v ? ['#b04a3a', '#8a3328', '#d06a55'] : ['#caa24a', '#a07c2a', '#e2c26a'];
    // front wall
    P.r(3, 24, 26, 14, '#e8d9b5');
    P.r(3, 24, 2, 14, '#6b4423'); P.r(27, 24, 2, 14, '#6b4423'); P.r(3, 30, 26, 1, '#6b4423'); P.r(15, 24, 2, 14, '#6b4423');
    P.line(5, 24, 14, 30, '#6b4423');
    P.r(19, 30, 6, 8, '#5a3a1a'); P.r(19, 30, 6, 1, '#3a2614'); P.p(23, 34, GOLD);
    P.r(7, 32, 5, 4, '#7ab4d8'); P.r(9, 32, 1, 4, '#6b4423'); P.r(7, 34, 5, 1, '#6b4423');
    // roof (seen from above, slopes north/south)
    for (let y = 0; y < 24; y++) {
      const c = y < 12 ? roof[2] : roof[0];
      P.r(1, 2 + y, 30, 1, c);
      if (y % 3 === 0) P.r(1, 2 + y, 30, 1, roof[1]);
    }
    P.r(1, 13, 30, 2, roof[1]);
    P.r(22, 0, 4, 8, '#8a8478'); P.r(22, 0, 4, 1, '#5a5650');
    outline(P);
    return P.c;
  }
  function farm(stage) {
    const P = mk(48, 48);
    P.r(1, 1, 46, 46, '#7a5a34');
    const crop = [['#6a8a3a', '#557a2c'], ['#8fb348', '#6a9a34'], ['#e2c25a', '#c9a23a']][stage];
    for (let y = 3; y < 45; y += 3) {
      P.r(3, y, 42, 1, '#5e4426');
      for (let x = 3; x < 45; x++) if ((x + y) % 2 === 0) P.p(x, y + 1, crop[(x >> 2) % 2]);
      for (let x = 3; x < 45; x += 2) P.p(x, y + 2, crop[1]);
    }
    // fence
    for (const [x, y, w, h] of [[0, 0, 48, 1], [0, 47, 48, 1], [0, 0, 1, 48], [47, 0, 1, 48]]) P.r(x, y, w, h, '#a87a44');
    for (let k = 0; k < 48; k += 6) { P.r(k, 0, 1, 2, '#5f3c1b'); P.r(k, 46, 1, 2, '#5f3c1b'); P.r(0, k, 2, 1, '#5f3c1b'); P.r(46, k, 2, 1, '#5f3c1b'); }
    // scarecrow
    P.r(23, 18, 1, 9, '#5f3c1b'); P.r(20, 20, 7, 1, '#5f3c1b'); P.r(22, 16, 3, 3, '#e2c26a'); P.r(21, 15, 5, 1, '#6b4423');
    return P.c;
  }
  function quarry() {
    const P = mk(32, 32);
    P.r(1, 1, 30, 30, '#8f8a80');
    P.r(4, 4, 24, 22, '#6e6a62'); P.r(7, 8, 18, 15, '#57534c'); P.r(10, 12, 12, 8, '#45423d');
    P.r(4, 4, 24, 1, '#b5b0a5'); P.r(7, 8, 18, 1, '#9a958b'); P.r(10, 12, 12, 1, '#7d7970');
    // cut blocks
    for (const [x, y] of [[2, 26], [7, 27], [12, 26], [24, 25]]) { P.r(x, y, 4, 3, '#c9c4b8'); P.r(x, y, 4, 1, '#e6e1d6'); P.r(x + 3, y, 1, 3, '#9a958b'); }
    // crane
    P.r(26, 2, 1, 14, WOOD2); P.r(18, 2, 9, 1, WOOD); P.r(19, 3, 1, 8, '#ccc'); P.r(18, 11, 3, 2, '#c9c4b8');
    outline(P);
    return P.c;
  }
  function mine() {
    const P = mk(32, 40);
    // mountain face behind
    for (let y = 0; y < 22; y++) { const w = 6 + y; P.r(16 - w / 2 - 6, y, w + 12, 1, y % 4 ? '#7b6f63' : '#6a5f54'); }
    P.r(0, 14, 32, 10, '#6e6357');
    // timber-framed entrance
    P.r(9, 14, 14, 14, '#14101a');
    P.r(8, 12, 16, 3, WOOD); P.r(8, 12, 16, 1, '#b08850');
    P.r(8, 14, 3, 16, WOOD); P.r(21, 14, 3, 16, WOOD); P.r(10, 14, 1, 16, WOOD2);
    // rails
    P.r(11, 28, 1, 12, '#5a5a62'); P.r(20, 28, 1, 12, '#5a5a62');
    for (let y = 29; y < 40; y += 3) P.r(10, y, 12, 1, WOOD2);
    // cart with ore
    P.r(11, 30, 10, 5, '#4a4a52'); P.r(11, 30, 10, 1, '#6a6a74'); P.r(12, 28, 8, 2, '#a0522d'); P.p(14, 28, '#d97a3a'); P.p(17, 29, '#d97a3a');
    P.r(12, 35, 2, 2, '#222'); P.r(18, 35, 2, 2, '#222');
    // lantern
    P.p(9, 16, GOLD); P.p(22, 16, GOLD);
    outline(P);
    return P.c;
  }
  // Cave troll: hunched, mossy grey-green hide, a club.
  function troll(frame) {
    const P = mk(22, 26);
    const SK = '#6f8a62', SK2 = '#55704c', SK3 = '#8fa87e';
    const lg = frame === 1 ? 1 : 0, atk = frame === 2;
    // legs
    P.r(6, 19 - lg, 4, 6 + lg, SK2); P.r(12, 19 + lg - 1, 4, 6 - lg + 1, SK2);
    P.r(5, 24, 5, 2, '#3e5236'); P.r(12, 24, 5, 2, '#3e5236');
    // loincloth
    P.r(6, 17, 10, 4, '#6b4a2a'); P.r(6, 20, 10, 1, '#4a3018');
    // torso
    P.r(4, 8, 14, 10, SK); P.r(5, 9, 12, 3, SK3); P.r(4, 16, 14, 2, SK2);
    // head (hunched forward, low)
    P.r(7, 3, 8, 7, SK); P.r(8, 3, 6, 2, SK3);
    P.p(9, 6, '#ffd04a'); P.p(12, 6, '#ffd04a');
    P.r(9, 8, 4, 1, '#2e3a28'); P.p(9, 9, '#f0ead8'); P.p(12, 9, '#f0ead8');
    P.r(6, 5, 1, 2, SK2); P.r(15, 5, 1, 2, SK2);
    // arms
    P.r(2, 9, 3, 9, SK2); P.r(17, 9, 3, 8, SK2);
    P.r(1, 17, 4, 3, SK); P.r(17, 16, 4, 3, SK);
    // club
    if (atk) { P.r(18, 0, 3, 16, '#7a5530'); P.r(17, 0, 5, 5, '#5a3c1e'); P.p(18, 1, '#9a9486'); P.p(20, 3, '#9a9486'); }
    else { P.r(19, 14, 2, 10, '#7a5530'); P.r(18, 20, 4, 6, '#5a3c1e'); P.p(19, 22, '#9a9486'); }
    // moss
    P.p(6, 10, '#9ab060'); P.p(14, 12, '#9ab060'); P.p(10, 4, '#9ab060');
    outline(P);
    return P.c;
  }
  function tent() {
    const P = mk(32, 36);
    // canvas walls and a peaked roof, seen from above-front
    P.r(2, 20, 28, 14, '#d8d0bc');
    for (let x = 2; x < 30; x += 4) P.r(x, 20, 2, 14, '#ece6da');
    P.r(2, 33, 28, 1, '#9a907a');
    P.r(12, 23, 8, 11, '#5a3a24'); P.r(13, 24, 6, 10, '#3a2416');
    P.line(12, 23, 15, 33, '#ece6da'); P.line(19, 23, 16, 33, '#ece6da');
    for (let y = 0; y < 18; y++) {
      const w = 6 + y * 1.4;
      P.r(16 - w / 2, 4 + y, w, 1, y < 9 ? '#f4efe2' : '#ddd5c2');
    }
    P.r(2, 21, 28, 1, '#b8ae98');
    // red cross on the roof
    P.r(14, 9, 4, 10, '#d63a2f'); P.r(11, 12, 10, 4, '#d63a2f');
    // pole & pennant
    P.r(15, 0, 2, 5, WOOD2); P.r(17, 0, 5, 3, '#d63a2f');
    // supplies
    P.r(24, 30, 5, 4, '#8a5a2c'); P.r(24, 30, 5, 1, '#b07a44'); P.r(3, 31, 4, 3, '#ece6da'); P.p(4, 32, '#d63a2f');
    outline(P);
    return P.c;
  }
  function barracks() {
    const P = mk(48, 40);
    const ST = '#9a968c', ST2 = '#7a766c', BL = TEAM[0].a, BL2 = TEAM[0].c;
    // stone ground floor
    P.r(1, 20, 46, 18, ST); for (let y = 22; y < 38; y += 4) P.r(1, y, 46, 1, ST2);
    for (let x = 4; x < 46; x += 8) for (let y = 20; y < 38; y += 8) P.r(x, y + 2, 1, 2, ST2);
    // timber upper storey with a long roof
    for (let y = 0; y < 14; y++) { const inset = Math.max(0, 7 - y); P.r(inset, 6 + y, 48 - inset * 2, 1, y < 7 ? '#8a3a30' : '#a24a3a'); }
    P.r(0, 19, 48, 2, WOOD); P.r(0, 19, 48, 1, '#b08850');
    for (let x = 8; x < 46; x += 10) P.r(x, 9, 2, 3, '#6a2a22');
    // great door and windows
    P.r(19, 27, 10, 11, '#3a2416'); P.r(20, 28, 8, 10, '#5a3a24'); P.r(23, 28, 1, 10, '#3a2416'); P.r(19, 26, 10, 1, WOOD);
    P.r(6, 26, 5, 4, '#1c1820'); P.r(37, 26, 5, 4, '#1c1820');
    // banners either side of the door
    P.r(14, 22, 3, 10, BL); P.r(14, 22, 3, 1, BL2); P.p(15, 26, GOLD); P.r(14, 32, 1, 1, BL); P.r(16, 32, 1, 1, BL);
    P.r(31, 22, 3, 10, BL); P.r(31, 22, 3, 1, BL2); P.p(32, 26, GOLD); P.r(31, 32, 1, 1, BL); P.r(33, 32, 1, 1, BL);
    // weapon rack with spears and a shield
    P.r(39, 31, 7, 1, WOOD); P.r(39, 35, 7, 1, WOOD);
    for (const x of [40, 42, 44]) { P.r(x, 28, 1, 9, WOOD2); P.p(x, 27, METAL); }
    P.r(2, 31, 6, 6, BL); P.r(2, 31, 6, 1, BL2); P.p(4, 33, GOLD);
    // flag on the ridge
    P.r(23, 0, 1, 8, WOOD2); P.r(24, 0, 6, 4, BL); P.p(26, 1, GOLD);
    outline(P);
    return P.c;
  }
  function stables() {
    const P = mk(48, 40);
    // timber stable with a hay loft, open stalls and a paddock fence
    P.r(1, 20, 46, 18, '#7a5232'); for (let x = 1; x < 47; x += 4) P.r(x, 20, 1, 18, '#5e3d22');
    for (let y = 0; y < 14; y++) { const inset = Math.max(0, 7 - y); P.r(inset, 6 + y, 48 - inset * 2, 1, y % 3 === 0 ? '#b88a3a' : y < 7 ? '#e0b45a' : '#cfa04c'); }
    P.r(0, 19, 48, 2, WOOD); P.r(0, 19, 48, 1, '#b08850');
    // hay loft door with straw spilling out
    P.r(20, 9, 8, 7, '#3a2416'); P.r(21, 12, 6, 4, '#e8c862'); P.p(22, 11, '#f0d878'); P.p(25, 11, '#f0d878');
    // three stalls with horse heads looking out
    for (const [k, x] of [[0, 4], [1, 18], [2, 32]]) {
      P.r(x, 24, 12, 14, '#2a1a10'); P.r(x, 30, 12, 2, '#9a6a3a'); P.r(x, 24, 12, 1, WOOD);
      const c = ['#7a5232', '#3a2a1e', '#c8b8a0'][k];
      P.r(x + 4, 25, 4, 5, c); P.r(x + 5, 29, 3, 3, c); P.p(x + 5, 27, '#111'); P.r(x + 3, 25, 1, 4, '#2f1f13');
    }
    // water trough and hay bale
    P.r(1, 34, 3, 4, '#d8c070'); P.r(44, 34, 4, 4, '#5a4a3a'); P.r(44, 34, 4, 1, '#4a7ac0');
    P.r(23, 0, 1, 8, WOOD2); P.r(24, 0, 6, 4, TEAM[0].a); P.p(26, 1, GOLD);
    outline(P);
    return P.c;
  }
  function explosives() {
    const P = mk(32, 40);
    // squat stone powder-house with a heavy slate roof
    P.r(2, 18, 28, 20, '#8e8a80'); for (let y = 21; y < 38; y += 4) P.r(2, y, 28, 1, '#6e6a60');
    for (let x = 6; x < 30; x += 8) for (let y = 18; y < 38; y += 8) P.r(x, y + 2, 1, 2, '#6e6a60');
    for (let y = 0; y < 12; y++) { const inset = Math.max(0, 8 - y); P.r(inset, 6 + y, 32 - inset * 2, 1, y < 6 ? '#4a4e5a' : '#5a5e6a'); }
    P.r(0, 17, 32, 2, '#3a3e48');
    // iron-bound door with a warning sign
    P.r(12, 26, 8, 12, '#3a2416'); P.r(13, 27, 6, 11, '#5a3a24'); P.r(12, 30, 8, 1, METAL2); P.r(12, 35, 8, 1, METAL2);
    P.r(13, 21, 6, 4, '#e8c040'); P.p(15, 22, '#2a2420'); P.p(16, 22, '#2a2420'); P.p(15, 23, '#d63a2f'); P.p(16, 23, '#d63a2f');
    // powder kegs outside
    for (const [x, y] of [[2, 31], [24, 31], [27, 33]]) { P.r(x, y, 5, 6, '#7a5030'); P.r(x, y + 1, 5, 1, METAL2); P.r(x, y + 4, 5, 1, METAL2); P.r(x + 1, y, 3, 1, '#9a6a40'); }
    // chimney with smoke stain
    P.r(22, 2, 4, 8, '#7a766c'); P.r(22, 2, 4, 1, '#3a3a3a');
    outline(P);
    return P.c;
  }
  function granary() {
    const P = mk(32, 40);
    // round stone granary with a thatched cone roof, sacks and a smoke rack
    P.r(4, 20, 24, 18, '#a29a88'); for (let y = 23; y < 38; y += 4) P.r(4, y, 24, 1, '#7e7666');
    for (let x = 8; x < 28; x += 8) for (let y = 20; y < 38; y += 8) P.r(x, y + 2, 1, 2, '#7e7666');
    P.r(4, 20, 2, 18, '#bcb4a2'); P.r(26, 20, 2, 18, '#7e7666');
    for (let y = 0; y < 16; y++) { const w = 4 + y * 1.75; P.r(16 - w / 2, 4 + y, w, 1, y % 3 === 0 ? '#b88a3a' : y < 8 ? '#e0b45a' : '#cfa04c'); }
    P.r(2, 19, 28, 2, '#9a7030');
    P.r(15, 1, 2, 4, '#7a5530');
    P.r(12, 27, 8, 11, '#3a2416'); P.r(13, 28, 6, 10, '#6a4428'); P.r(12, 32, 8, 1, '#3a2416');
    for (const [x, y] of [[1, 31], [25, 32]]) { P.r(x, y, 6, 6, '#d8c48e'); P.r(x + 1, y - 1, 4, 2, '#c4ae78'); P.p(x + 2, y + 2, '#a8925c'); }
    P.r(20, 35, 3, 3, '#d6402f'); P.p(21, 35, '#ff8a7a');
    outline(P);
    return P.c;
  }
  function lumberyard() {
    const P = mk(32, 40);
    // open timber shed on posts, stacked logs beneath and beside it
    P.r(1, 24, 30, 14, '#6a8a3a');
    for (let y = 0; y < 9; y++) P.r(1, 10 + y, 30, 1, y % 3 === 0 ? '#5e3d22' : y < 5 ? '#9a6a3a' : '#87592e');
    P.r(0, 18, 32, 2, WOOD); P.r(0, 18, 32, 1, '#b08850');
    for (const x of [2, 15, 28]) P.r(x, 20, 2, 18, '#5e3d22');
    // log ends stacked in a pyramid under the roof
    const logs = [[4, 33], [8, 33], [12, 33], [17, 33], [21, 33], [6, 29], [10, 29], [19, 29], [23, 29], [8, 25], [21, 25]];
    for (const [x, y] of logs) { P.r(x, y, 4, 4, '#a0703a'); P.r(x + 1, y + 1, 2, 2, '#d8b070'); P.p(x + 1, y + 1, '#c09050'); }
    // loose planks and an axe in a chopping block
    P.r(25, 34, 6, 2, '#c09050'); P.r(25, 36, 6, 1, '#8a5e30');
    P.r(4, 6, 2, 5, WOOD2); P.r(3, 5, 4, 2, METAL2);
    outline(P);
    return P.c;
  }
  function stoneyard() {
    const P = mk(32, 40);
    // low dry-stone yard wall around stacks of cut blocks and a wooden hoist
    P.r(1, 22, 30, 16, '#8a8270');
    const blk = (x, y, w, h) => { P.r(x, y, w, h, '#b0aa9c'); P.r(x, y, w, 1, '#d2ccbe'); P.r(x + w - 1, y, 1, h, '#7e786a'); P.r(x, y + h - 1, w, 1, '#6e685c'); };
    for (const [x, y] of [[3, 32], [9, 32], [15, 32], [5, 27], [11, 27], [8, 22]]) blk(x, y, 6, 5);
    for (const [x, y] of [[21, 32], [26, 32], [23, 28]]) blk(x, y, 5, 4);
    // hoist: A-frame with rope and a dangling block
    P.r(20, 6, 1, 20, WOOD2); P.r(29, 6, 1, 20, WOOD2); P.r(19, 5, 12, 2, WOOD);
    P.r(25, 7, 1, 10, '#d8c8a0'); blk(23, 17, 5, 4);
    for (let x = 1; x < 31; x += 3) { P.r(x, 37, 2, 1, '#5a5448'); }
    outline(P);
    return P.c;
  }
  function metalstore() {
    const P = mk(32, 40);
    // squat stone strongroom with an iron-banded door, ore bin and ingot rack
    P.r(3, 16, 26, 22, '#8a8478'); for (let y = 19; y < 38; y += 4) P.r(3, y, 26, 1, '#66625a');
    for (let x = 7; x < 29; x += 7) for (let y = 16; y < 38; y += 8) P.r(x, y + 2, 1, 2, '#66625a');
    for (let y = 0; y < 10; y++) { const inset = Math.max(0, 6 - y); P.r(1 + inset, 6 + y, 30 - inset * 2, 1, y < 5 ? '#5a3a2a' : '#6e4a34'); }
    P.r(1, 15, 30, 2, '#3a2a20');
    P.r(12, 25, 8, 13, '#3a2416'); P.r(13, 26, 6, 12, '#5a3a24');
    for (const y of [28, 32, 36]) P.r(12, y, 8, 1, METAL2);
    P.p(18, 31, GOLD);
    // ore bin
    P.r(1, 30, 9, 8, '#6b4423'); P.r(1, 30, 9, 1, '#a07040');
    for (const [x, y] of [[2, 28], [5, 27], [7, 29], [3, 30]]) { P.r(x, y, 3, 3, '#a0522d'); P.p(x + 1, y, '#d97a3a'); }
    // iron ingots stacked on a rack
    P.r(22, 35, 9, 3, '#5a3a24');
    for (const [x, y] of [[22, 32], [26, 32], [24, 29]]) { P.r(x, y, 4, 3, '#9aa0aa'); P.r(x, y, 4, 1, '#d0d6e0'); }
    outline(P);
    return P.c;
  }
  function bloomery() {
    const P = mk(32, 40);
    P.r(2, 22, 28, 16, '#7a5a3a');
    // furnace (clay & stone)
    P.r(6, 10, 16, 26, '#9a6a4a'); P.r(6, 10, 16, 2, '#b8866a'); P.r(20, 10, 2, 26, '#7a4a2a');
    for (let y = 14; y < 36; y += 4) P.r(6, y, 14, 1, '#7a4a2a');
    P.r(10, 28, 8, 7, '#2a1208'); P.r(11, 30, 6, 5, '#e2541c'); P.r(12, 32, 4, 3, '#ffcc33');
    // chimney
    P.r(10, 0, 8, 11, '#8a8478'); P.r(10, 0, 8, 1, '#5a5650'); P.r(11, 1, 6, 1, '#2a2622');
    // bellows
    P.r(22, 26, 7, 5, '#6b4423'); P.r(22, 26, 7, 1, '#a07040'); P.r(21, 28, 2, 1, '#555');
    // ore pile
    for (const [x, y] of [[2, 32], [4, 30], [3, 34]]) { P.r(x, y, 3, 3, '#a0522d'); P.p(x + 1, y, '#d97a3a'); }
    // iron bars
    P.r(24, 34, 5, 2, '#9aa0aa'); P.r(24, 34, 5, 1, '#d0d6e0');
    outline(P);
    return P.c;
  }
  // Water-powered sawmill: timber hall, a log waiting at the saw, stacked planks.
  function lumbermill() {
    const P = mk(32, 40);
    P.r(1, 24, 30, 14, '#7a5a3a');
    // hall: plank walls under a shingle roof
    P.r(4, 16, 24, 20, '#9a6d3b');
    for (let x = 4; x < 28; x += 3) P.r(x, 16, 1, 20, '#7a5228');
    P.r(4, 16, 24, 1, '#c0905a');
    for (let y = 0; y < 9; y++) P.r(3 + y * 0.2, 7 + y, 26 - y * 0.4, 1, y % 3 === 2 ? '#5e3a1e' : '#7e5030');
    P.r(4, 6, 24, 2, '#a8784a'); P.r(14, 4, 4, 3, '#5e3a1e');
    // open saw bay with a log and the blade
    P.r(8, 26, 12, 10, '#2e1c0e');
    P.r(8, 31, 12, 3, '#a07040'); P.r(8, 31, 12, 1, '#c8955a'); P.r(19, 31, 1, 3, '#e8c590');
    P.circ(14, 29, 3, '#b8bec8'); P.p(14, 29, '#5a6070'); P.p(12, 27, '#eef');
    // plank stack
    for (const y of [30, 33, 36]) { P.r(22, y, 9, 2, '#d8a868'); P.r(22, y, 9, 1, '#f0c88a'); P.p(30, y + 1, '#a07040'); }
    // log pile
    for (const [x, y] of [[1, 33], [4, 33], [2, 30]]) { P.circ(x + 1, y + 1, 1, '#8a5a2c'); P.p(x + 1, y + 1, '#e0b070'); }
    outline(P);
    return P.c;
  }
  // Water wheel frames. Paddles repeat every 1/8 turn, so 6 frames loop seamlessly.
  // face: the wheel seen side-on (river north/south of the mill); edge: seen from its rim (river east/west).
  function waterWheel(edge, f) {
    const P = mk(edge ? 8 : 18, 18), cx = edge ? 4 : 9, cy = 9, R = 7, rx = edge ? 2 : R;
    const a0 = (f / 6) * (Math.PI / 4);
    if (!edge) {
      for (let k = 0; k < 4; k++) { const a = a0 + (k * Math.PI) / 4; P.line(cx - Math.cos(a) * 6, cy - Math.sin(a) * 6, cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, '#8a5e30'); }
      for (let t = 0; t < 64; t++) { const a = (t / 64) * Math.PI * 2; P.p(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), '#6b4423'); }
      P.r(cx - 1, cy - 1, 3, 3, '#3a2512');
    } else {
      P.r(cx - 1, 1, 3, 16, '#6b4423');
    }
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k * Math.PI) / 4, x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * R);
      if (edge && Math.cos(a) < -0.2) continue;
      P.r(x - 1, y - 1, edge ? 3 : 2, 2, '#c09060');
    }
    outline(P);
    return P.c;
  }
  // 2-wide gatehouse in an east-west wall: twin towers flanking double doors.
  const gateCols = (iron) => iron ? ['#5a6070', '#3a3f4b', '#23262e', '#1c1e24', '#b8c0cc'] : ['#7a5530', '#5a3c1e', '#3a2416', '#3d3d45', GOLD];
  function gate(open, iron) {
    const P = mk(32, 26), [DW, DP, DS, DB, DR] = gateCols(iron);
    bricks(P, 0, 0, 7, 26, '#9a9486', '#6c675e');
    bricks(P, 25, 0, 7, 26, '#9a9486', '#6c675e');
    for (const x of [0, 25]) { P.r(x, 0, 7, 3, '#b9b3a6'); for (let k = 0; k < 7; k += 3) P.r(x + k, 0, 2, 1, '#6c675e'); }
    P.r(7, 2, 18, 6, '#b9b3a6'); P.r(7, 7, 18, 1, '#6c675e');
    for (let k = 8; k < 24; k += 4) P.r(k, 2, 2, 1, '#6c675e');
    // arch
    P.r(9, 8, 14, 1, '#6c675e'); P.r(8, 9, 1, 17, '#6c675e'); P.r(23, 9, 1, 17, '#6c675e');
    if (open) {
      P.r(9, 9, 14, 17, '#2a2026');
      P.r(9, 9, 3, 17, DW); P.r(20, 9, 3, 17, DW);
      P.r(10, 10, 12, 1, '#555a66'); // raised portcullis teeth
      for (let x = 10; x < 22; x += 2) P.p(x, 11, '#555a66');
    } else {
      P.r(9, 9, 14, 17, DW);
      for (let x = 9; x < 23; x += 2) P.r(x, 9, 1, 17, DP);
      P.r(15, 9, 2, 17, DS);
      P.r(9, 13, 14, 1, DB); P.r(9, 21, 14, 1, DB);
      P.p(13, 17, DR); P.p(18, 17, DR);
    }
    // little banners on the towers
    P.r(3, 5, 2, 4, '#3d63d8'); P.r(27, 5, 2, 4, '#3d63d8');
    outline(P);
    return P.c;
  }
  // 2-tall gatehouse in a north-south wall, seen from above.
  function gateV(open, iron) {
    const P = mk(16, 36), [DW, DP, DS, DB, DR] = gateCols(iron);
    bricks(P, 0, 0, 16, 7, '#9a9486', '#6c675e');
    bricks(P, 0, 29, 16, 7, '#9a9486', '#6c675e');
    P.r(0, 0, 16, 2, '#b9b3a6'); P.r(0, 29, 16, 2, '#b9b3a6');
    P.r(1, 7, 2, 22, '#b9b3a6'); P.r(13, 7, 2, 22, '#b9b3a6');
    P.r(3, 7, 10, 22, '#6c675e');
    if (open) {
      P.r(4, 8, 8, 20, '#2a2026');
      P.r(4, 8, 8, 3, DW); P.r(4, 25, 8, 3, DW);
    } else {
      P.r(4, 8, 8, 20, DW);
      for (let y = 8; y < 28; y += 2) P.r(4, y, 8, 1, DP);
      P.r(4, 17, 8, 2, DS);
      P.r(6, 8, 1, 20, DB); P.r(9, 8, 1, 20, DB);
      P.p(7, 14, DR); P.p(7, 21, DR);
    }
    P.r(6, 2, 4, 3, '#3d63d8');
    outline(P);
    return P.c;
  }
  function drawbridge(raised, vert) {
    const P = mk(16, 16);
    if (!raised) {
      if (vert) { P.r(2, 0, 12, 16, '#8a5e30'); for (let y = 0; y < 16; y += 3) P.r(2, y, 12, 1, '#5a3c1e'); P.r(2, 0, 1, 16, '#3d3d45'); P.r(13, 0, 1, 16, '#3d3d45'); }
      else { P.r(0, 2, 16, 12, '#8a5e30'); for (let x = 0; x < 16; x += 3) P.r(x, 2, 1, 12, '#5a3c1e'); P.r(0, 2, 16, 1, '#3d3d45'); P.r(0, 13, 16, 1, '#3d3d45'); }
    } else {
      if (vert) { P.r(2, 0, 12, 4, '#8a5e30'); P.r(2, 3, 12, 1, '#5a3c1e'); P.r(2, 0, 1, 4, '#3d3d45'); P.r(13, 0, 1, 4, '#3d3d45'); P.line(3, 4, 3, 12, '#555'); P.line(12, 4, 12, 12, '#555'); }
      else { P.r(0, 2, 4, 12, '#8a5e30'); P.r(3, 2, 1, 12, '#5a3c1e'); P.line(4, 3, 12, 3, '#555'); P.line(4, 12, 12, 12, '#555'); }
    }
    outline(P);
    return P.c;
  }
  // One drawbridge section. a/b: joined to a neighbour on either side across the span; hinge: first row along the span.
  const dbCache = new Map();
  function dbTile(raised, vert, a, b, hinge, far) {
    const key = [raised, vert, a, b, hinge, far].map(Number).join('');
    if (dbCache.has(key)) return dbCache.get(key);
    const P = mk(16, 16);
    // draw as a north-south span, then rotate for east-west
    const l = a ? 0 : 2, r = b ? 16 : 14;
    if (!raised) {
      P.r(l, 0, r - l, 16, '#8a5e30');
      for (let y = 0; y < 16; y += 3) P.r(l, y, r - l, 1, '#5a3c1e');
      if (!a) P.r(2, 0, 1, 16, '#3d3d45');
      if (!b) P.r(13, 0, 1, 16, '#3d3d45');
      if (hinge) P.r(l, 0, r - l, 1, '#2e2e36');
    } else if (hinge) {
      P.r(l, 0, r - l, 5, '#8a5e30'); P.r(l, 3, r - l, 1, '#5a3c1e'); P.r(l, 4, r - l, 1, '#4a3018');
      if (!a) { P.r(2, 0, 1, 5, '#3d3d45'); P.line(3, 5, 3, 13, '#555'); }
      if (!b) { P.r(13, 0, 1, 5, '#3d3d45'); P.line(12, 5, 12, 13, '#555'); }
    }
    let c = P.c;
    if (far) {
      // hinge on the south (east once transposed) end
      const F = mk(16, 16);
      F.g.setTransform(1, 0, 0, -1, 0, 16);
      F.g.drawImage(c, 0, 0);
      c = F.c;
    }
    if (!vert) {
      const Q = mk(16, 16);
      Q.g.setTransform(0, 1, 1, 0, 0, 0); // transpose: the span runs west-east, hinge on the west
      Q.g.drawImage(c, 0, 0);
      c = Q.c;
    }
    const o = mk(16, 16); o.g.drawImage(c, 0, 0); outline(o); c = o.c;
    dbCache.set(key, c);
    return c;
  }
  S.dbTile = dbTile;
  function bridgeSpr(vert) {
    const P = mk(16, 16);
    if (vert) { P.r(3, 0, 10, 16, '#a07040'); for (let y = 0; y < 16; y += 2) P.r(3, y, 10, 1, '#7a5530'); P.r(2, 0, 1, 16, '#5a3c1e'); P.r(13, 0, 1, 16, '#5a3c1e'); }
    else { P.r(0, 3, 16, 10, '#a07040'); for (let x = 0; x < 16; x += 2) P.r(x, 3, 1, 10, '#7a5530'); P.r(0, 2, 16, 1, '#5a3c1e'); P.r(0, 13, 16, 1, '#5a3c1e'); }
    return P.c;
  }

  // Wall tile keyed by 4-bit neighbour mask (N=1,E=2,S=4,W=8) and battlement flag.
  function wallTile(mask, bat) {
    const P = mk(16, 24);
    const top = '#bdb7aa', topD = '#a29c8f', face = '#868074', mort = '#5d5850';
    // top surface spans y 4..19 (the tile, lifted 4px for height). Joined sides run to the tile edge and the
    // brick courses repeat every 16px, so neighbouring and multi-tile-thick walls read as one solid mass.
    const y0 = mask & 1 ? 0 : 4;
    P.r(0, y0, 16, 20 - y0, top);
    for (let y = y0; y < 20; y++) {
      const wy = y - 4 + 16;
      if (wy % 4 === 0) { P.r(0, y, 16, 1, topD); continue; }
      const off = (wy >> 2) % 2 ? 4 : 0;
      for (let x = off; x < 16; x += 8) P.p(x, y, topD);
      if (wy % 4 === 1) for (let x = off + 2; x < 16; x += 8) P.p(x, y, '#d6d0c3');
    }
    if (!(mask & 1)) P.r(0, 4, 16, 1, '#ddd7ca');
    if (!(mask & 8)) P.r(0, y0, 1, 20 - y0, '#d0cabd');
    if (!(mask & 2)) P.r(15, y0, 1, 20 - y0, '#8f897d');
    if (!(mask & 4)) { bricks(P, 0, 18, 16, 6, face, mort); P.r(0, 18, 16, 1, '#5d5850'); }
    if (bat) {
      // one continuous walkway along the whole wall, merlons only on its open edges
      const x0 = mask & 8 ? 0 : 3, x1 = mask & 2 ? 16 : 13, wy0 = mask & 1 ? 0 : 7, wy1 = mask & 4 ? 20 : 17;
      P.r(x0, wy0, x1 - x0, wy1 - wy0, '#958f82');
      for (let y = wy0; y < wy1; y++) if ((y - 4 + 16) % 8 === 0) P.r(x0, y, x1 - x0, 1, '#87816f');
      for (let x = x0; x < x1; x++) if (x % 8 === 0) P.r(x, wy0, 1, wy1 - wy0, '#87816f');
      const m = (x, y) => { P.r(x, y, 3, 3, '#d8d2c5'); P.r(x, y + 3, 3, 1, '#6c675e'); };
      if (!(mask & 1)) { m(1, 0); m(7, 0); m(12, 0); }
      if (!(mask & 4)) { m(1, 14); m(7, 14); m(12, 14); }
      if (!(mask & 8)) { m(0, 6); m(0, 12); }
      if (!(mask & 2)) { m(13, 6); m(13, 12); }
    }
    outline(P);
    return P.c;
  }
  function playerCatapult(f) {
    const P = mk(16, 18);
    P.r(1, 9, 14, 5, '#6e4a26'); P.r(1, 9, 14, 1, '#9a6d3b');
    P.r(3, 5, 2, 5, '#5a3c1e'); P.r(11, 5, 2, 5, '#5a3c1e'); P.r(3, 5, 10, 1, '#7a5530');
    if (!f) { P.line(4, 11, 13, 7, '#8a5e30'); P.r(12, 5, 3, 3, '#4a3018'); P.p(13, 5, '#999'); }
    else { P.line(8, 11, 4, 1, '#8a5e30'); P.r(2, 0, 3, 2, '#4a3018'); }
    P.r(6, 12, 4, 2, TEAM[0].a);
    P.circ(3, 14, 2, '#3a2512'); P.circ(12, 14, 2, '#3a2512');
    outline(P);
    return P.c;
  }

  // ---------------- UI icons ----------------
  function icon(kind) {
    const P = mk(14, 14);
    switch (kind) {
      case 'stone': P.circ(5, 8, 3, '#9b9890'); P.circ(9, 6, 3, '#b8b5ad'); P.p(8, 5, '#e0ddd5'); P.p(4, 7, '#c4c2bc'); break;
      case 'lumber': for (const y of [4, 7, 10]) { P.r(2, y, 10, 3, '#8a5a2c'); P.r(2, y, 10, 1, '#b07a44'); P.r(11, y, 2, 3, '#e0b070'); P.p(12, y + 1, '#8a5a2c'); } break;
      case 'ore': P.circ(7, 7, 4, '#6a5f54'); P.p(5, 6, '#d97a3a'); P.p(8, 5, '#e2884a'); P.p(7, 9, '#c0602a'); P.p(9, 8, '#d97a3a'); break;
      case 'plank': for (const y of [3, 7, 11]) { P.r(1, y, 12, 2, '#d8a868'); P.r(1, y, 12, 1, '#f0c88a'); P.p(12, y + 1, '#a07040'); } P.r(3, 3, 1, 10, '#b08048'); break;
      case 'iron': P.r(1, 6, 12, 4, '#8a909a'); P.r(2, 5, 10, 1, '#d0d6e0'); P.r(3, 3, 8, 3, '#b0b6c0'); P.r(4, 3, 6, 1, '#eef'); break;
      case 'food': P.circ(6, 8, 4, '#d6402f'); P.p(4, 6, '#ff8a7a'); P.r(7, 2, 1, 3, '#5f3c1b'); P.r(8, 3, 3, 2, '#4f9a3a'); break;
      case 'people': P.r(5, 2, 4, 4, SKIN); P.r(5, 1, 4, 1, '#6b4423'); P.r(3, 7, 8, 6, TEAM[0].a); P.r(3, 7, 8, 1, TEAM[0].c); break;
      case 'crown': P.r(2, 6, 10, 4, GOLD); P.p(2, 4, GOLD); P.p(2, 5, GOLD); P.p(7, 3, GOLD); P.r(6, 4, 3, 2, GOLD); P.p(11, 4, GOLD); P.p(11, 5, GOLD); P.p(7, 7, '#e2453c'); P.r(2, 9, 10, 1, '#b08a2a'); break;
      case 'repair': P.r(6, 5, 2, 8, WOOD); P.r(3, 2, 8, 3, METAL2); P.r(3, 2, 8, 1, METAL); break;
      case 'house': P.r(3, 7, 8, 6, '#e8d9b5'); for (let y = 0; y < 5; y++) P.r(6 - y, 2 + y, 2 + y * 2, 1, '#b04a3a'); P.r(6, 9, 2, 4, '#5a3a1a'); break;
      case 'shield': P.r(3, 2, 8, 7, TEAM[0].a); P.r(4, 9, 6, 2, TEAM[0].a); P.r(6, 11, 2, 1, TEAM[0].a); P.r(3, 2, 8, 1, TEAM[0].c); P.p(7, 6, GOLD); break;
      case 'dig': P.r(6, 1, 2, 7, WOOD); P.r(4, 8, 6, 5, METAL2); P.r(4, 8, 6, 1, METAL); P.r(5, 12, 4, 1, '#5a6070'); P.r(4, 1, 6, 1, WOOD2); break;
      case 'medic': P.r(1, 1, 12, 12, '#ece6da'); P.r(5, 3, 4, 8, '#d63a2f'); P.r(3, 5, 8, 4, '#d63a2f'); break;
      case 'horse': P.r(2, 5, 8, 4, '#7a5232'); P.r(9, 2, 2, 5, '#7a5232'); P.r(10, 1, 3, 3, '#7a5232'); P.r(8, 2, 2, 4, '#2f1f13'); P.r(1, 5, 1, 4, '#2f1f13'); for (const x of [3, 5, 7, 9]) P.r(x, 9, 1, 4, '#57391f'); P.p(11, 2, '#111'); break;
      case 'tent': P.r(1, 10, 12, 3, '#cfc6b0'); for (let y = 0; y < 9; y++) P.r(7 - y * 0.7, 2 + y, 1 + y * 1.4, 1, y % 2 ? '#ece6da' : '#d8d0bc'); P.r(6, 6, 2, 1, '#d63a2f'); P.r(6.5, 5, 1, 3, '#d63a2f'); break;
      case 'demo': P.r(3, 5, 8, 8, '#7a5030'); P.r(3, 6, 8, 1, METAL2); P.r(3, 11, 8, 1, METAL2); P.r(4, 5, 6, 1, '#9a6a40'); P.r(7, 2, 1, 3, '#c8b090'); P.r(7, 0, 2, 2, '#ffb030'); P.p(8, 0, '#ffe070'); break;
      case 'skull': P.r(3, 2, 8, 7, '#ece6da'); P.r(4, 9, 6, 3, '#ece6da'); P.r(4, 5, 2, 2, '#222'); P.r(8, 5, 2, 2, '#222'); P.p(7, 8, '#555'); break;
    }
    outline(P);
    return P.c;
  }
  function unitIcon(kind) {
    const src = S.unit[kind][0];
    const P = mk(Math.max(16, src.width), Math.max(18, src.height));
    P.g.drawImage(src, 0, 0);
    return P.c;
  }

  K.buildSprites = function () {
    buildUnits();
    S.oak = [0, 1, 2, 3, 4, 5].map(oak);
    S.pine = [0, 1, 2, 3].map(pine);
    S.rocks = [0, 1, 2, 3, 4, 5].map(rocks);
    S.stump = stump();
    S.keep = keep();
    S.keepdoor = keepDoor();
    S.house = [house(0), house(1)];
    S.farm = [farm(0), farm(1), farm(2)];
    S.quarry = quarry();
    S.mine = mine();
    S.bloomery = bloomery();
    S.lumbermill = lumbermill();
    S.wheel = [0, 1].map((e) => [0, 1, 2, 3, 4, 5].map((f) => waterWheel(!!e, f)));
    S.tent = tent();
    S.barracks = barracks();
    S.explosives = explosives();
    S.granary = granary();
    S.lumberyard = lumberyard();
    S.stoneyard = stoneyard();
    S.metalstore = metalstore();
    S.stables = stables();
    S.troll = [troll(0), troll(1), troll(2)];
    S.gate = [[gate(false), gate(true)], [gateV(false), gateV(true)]];
    S.irongate = [[gate(false, true), gate(true, true)], [gateV(false, true), gateV(true, true)]];
    S.drawbridge = { down: [drawbridge(false, false), drawbridge(false, true)], up: [drawbridge(true, false), drawbridge(true, true)] };
    S.bridge = [bridgeSpr(false), bridgeSpr(true)];
    S.wall = [];
    for (let m = 0; m < 16; m++) S.wall[m] = [wallTile(m, false), wallTile(m, true)];
    S.catapult = [playerCatapult(0), playerCatapult(1)];
    S.trebuchet = [trebuchet(0, 0), trebuchet(0, 1)];
    S.icon = {};
    for (const k of ['stone', 'lumber', 'plank', 'ore', 'iron', 'food', 'people', 'crown', 'repair', 'house', 'shield', 'skull', 'dig', 'medic', 'tent', 'demo', 'horse']) S.icon[k] = icon(k).toDataURL();
    for (const k of ['archer', 'infantry', 'knight', 'king', 'queen', 'subject', 'cavalry']) S.icon[k] = unitIcon(k).toDataURL();
    S.iconCanvas = (src) => src;
  };
})();

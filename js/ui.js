'use strict';
// DOM UI: resource bar, build menu, jobs table, info panel, alerts, input and camera.
(function () {
  const TS = K.TS;
  let N;
  K.onSize(() => { N = K.N; });
  const $ = (id) => document.getElementById(id);
  const ZMIN = 0.4, ZMAX = 5;
  const UI = (K.UI = { tool: null, drag: null, keys: {}, speed: 1, lastToast: 0 });

  const ic = (k) => `<img class="ic" src="${K.SPR.icon[k]}">`;
  const costHtml = (c) => {
    const e = Object.entries(c);
    return e.length ? e.map(([k, v]) => `<span>${ic(k)}${v}</span>`).join('') : '<span>free</span>';
  };

  UI.init = function (G) {
    UI.G = G;
    G.ui = { ghost: null, hover: null, selected: null, showInterior: false };
    G.messages.length = 0;
    UI.tool = null; UI.drag = null; UI.seenMsg = 0;
    UI.zoomTarget = K.Render.cam.zoom; UI.zoomAnchor = null;
    UI.alertQ = []; UI.alert = null;
    buildMenu();
    buildJobs();
    if (!UI.bound) bind();
    UI.bound = true;
  };

  // ---------- build menu ----------
  const CATS = { resources: 'Resources', terrain: 'Terrain', village: 'Village', storage: 'Storage', defense: 'Defenses' };
  function savedTab() { try { const t = localStorage.getItem('keep.tab'); return CATS[t] ? t : 'village'; } catch (e) { return 'village'; } }
  function showTab(c) {
    for (const b of document.querySelectorAll('.btab')) { const on = b.dataset.cat === c; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
    for (const p of document.querySelectorAll('.bpanel')) p.hidden = p.dataset.cat !== c;
    try { localStorage.setItem('keep.tab', c); } catch (e) { /* storage unavailable */ }
  }
  UI.showTab = showTab;
  function buildMenu() {
    let tabs = '', panels = '';
    for (const c in CATS) {
      let items = '';
      for (const id in K.SDEF) {
        const d = K.SDEF[id];
        if (d.cat !== c) continue;
        items += `<div class="bitem" data-type="${id}"><span>${d.name}</span><span class="key">${(d.key || '').toUpperCase()}</span><span class="cost">${costHtml(d.cost)}</span></div>`;
      }
      tabs += `<button class="btab" role="tab" data-cat="${c}">${CATS[c]}</button>`;
      panels += `<div class="bpanel" role="tabpanel" data-cat="${c}">${items}</div>`;
    }
    $('buildmenu').innerHTML = `<div class="btabs" role="tablist">${tabs}</div>${panels}`;
    for (const b of document.querySelectorAll('.btab')) b.onclick = () => showTab(b.dataset.cat);
    showTab(savedTab());
    for (const el of document.querySelectorAll('.bitem')) {
      el.onclick = () => setTool(UI.tool === el.dataset.type ? null : el.dataset.type);
      el.onmouseenter = (e) => { const d = K.SDEF[el.dataset.type]; tip(e, `<b>${d.name}</b><br>${d.desc}${d.eco ? '<br><i>Build phase only — workers shelter during sieges.</i>' : ''}`, 'b:' + d.name); };
      el.onmouseleave = () => tip(null);
    }
  }
  function setTool(t) {
    if (t && !K.canBuildNow(UI.G, t)) t = null;
    if (t && K.SDEF[t].cat) showTab(K.SDEF[t].cat);
    UI.tool = t;
    UI.drag = null;
    UI.G.ui.ghost = null;
    if (t) UI.G.ui.selected = null;
    for (const el of document.querySelectorAll('.bitem')) el.classList.toggle('on', el.dataset.type === t);
    K.Render.canvas.classList.toggle('tool', !!t);
    const tm = $('toolmode');
    if (t) {
      const d = K.SDEF[t];
      tm.innerHTML = `${t === 'demolish' ? 'Demolishing' : 'Building: ' + d.name}${d.rotates ? ' <button id="btn-toolrot" title="Turn it the other way (V)">⟳ Rotate</button>' : ''}<span class="note">${d.drag ? 'Click or drag on the map' : 'Click on the map'} · Right-click or Esc to cancel</span>`;
      const br = $('btn-toolrot');
      if (br) br.onclick = () => rotateTool();
    }
    tm.classList.toggle('hidden', !t);
    refreshInfo();
  }

  // Keep placement waits for the player to confirm the site.
  function keepConfirm(yes) {
    const G = UI.G, p = UI.pendingKeep;
    $('keepconf').classList.add('hidden');
    UI.pendingKeep = null;
    if (!yes || !p || G.phase !== 'place') return;
    if (K.placeKeep(G, p.x, p.y)) { UI.shaping = false; G.ui.ghost = null; tip(null); UI.centerOn(G.kingSpot.x, G.kingSpot.y); }
  }
  UI.keepConfirm = keepConfirm;

  function rotateTool() {
    UI.rot = UI.rot ? 0 : 1;
    if (UI.tool && UI.mouse) updateGhost();
    if (K.isGate(UI.tool)) UI.G.msg('Gate turned ' + (UI.rot ? 'across' : 'along') + ' the wall line.', 'info');
  }

  // ---------- jobs table ----------
  function buildJobs() {
    let h = '<h3 class="fold" id="jobs-head" title="Click to collapse or expand">Subjects<span class="sum" id="jobs-sum"></span></h3><table>';
    for (const j of K.JOBS) {
      const sep = j.id === 'dig' || j.id === 'archer' ? ' class="sep"' : '';
      h += `<tr${sep} data-job="${j.id}"><td>${ic(j.icon)} ${j.name}</td><td class="b"><button data-d="-1">−</button></td><td class="n" id="jn-${j.id}">0</td><td class="b"><button data-d="1">+</button></td>`
        + (j.id === 'idle' ? '<td class="hc" colspan="3"></td>' : `<td class="b hc"><button data-h="-1" title="Take a horse from ${j.name}">−</button></td><td class="n hc" id="jh-${j.id}">0</td><td class="b hc"><button data-h="1" title="Give a horse to ${j.name}">+</button></td>`) + '</tr>';
    }
    h += '</table><div id="jobfoot"></div>';
    $('jobs').innerHTML = h;
    const jobsEl = $('jobs');
    jobsEl.classList.toggle('collapsed', localStorage.getItem('keep.jobsCollapsed') === '1');
    $('jobs-head').onclick = () => { const c = jobsEl.classList.toggle('collapsed'); localStorage.setItem('keep.jobsCollapsed', c ? '1' : '0'); };
    for (const tr of document.querySelectorAll('#jobs tr')) {
      const j = K.JOB[tr.dataset.job];
      const nameCell = tr.cells[0];
      nameCell.onmouseenter = (e) => tip(e, `<b>${j.name}</b><br>${j.desc}${j.soldier ? '<br>Subjects who just left civil work must rest a full round before enlisting.' : '<br>Soldiers who just left the army must wait a full round before civil work.'}${j.cost ? '<br>Training cost: ' + K.costText(j.cost) : ''}${j.soldier ? '<br>Needs a Barracks; each raises the soldier cap by ' + K.SDEF.barracks.soldiers + '.' : ''}${j.where ? '<br>Needs a ' + K.SDEF[j.where].name + ' (' + K.SDEF[j.where].slots + ' workers each).' : ''}<br><i>Shift-click: ×5</i>`, 'j:' + j.id);
      nameCell.onmouseleave = () => tip(null);
      for (const b of tr.querySelectorAll('button[data-d]'))
        b.onclick = (e) => { K.assignJob(UI.G, j.id, +b.dataset.d * (e.shiftKey ? 5 : 1)); refreshJobs(); };
      for (const b of tr.querySelectorAll('button[data-h]'))
        b.onclick = (e) => { for (let n = e.shiftKey ? 5 : 1; n > 0; n--) K.allocHorse(UI.G, j.id, +b.dataset.h); refreshJobs(); refreshInfo(); };
    }
  }
  function refreshJobs() {
    const G = UI.G, c = K.jobCount(G);
    for (const j of K.JOBS) {
      let t = c[j.id];
      if (j.where) {
        const sl = K.slots(G, j.where);
        t = `<span class="${c[j.id] > sl ? 'warnc' : ''}">${c[j.id]}<span class="note">/${sl}</span></span>`;
        const p = document.querySelector(`#jobs tr[data-job="${j.id}"] button[data-d="1"]`);
        if (p) p.disabled = c[j.id] >= sl;
      }
      $('jn-' + j.id).innerHTML = t;
    }
    // horses: mounted riders / horses given, shown once there are Stables
    const hcap = K.horseCap(G);
    $('jobs').classList.toggle('nohorse', !hcap);
    let hfoot = '';
    if (hcap) {
      let given = 0;
      for (const k in G.horseAlloc) given += G.horseAlloc[k];
      const tot = K.horseTotal(G);
      for (const j of K.JOBS) {
        const el = $('jh-' + j.id);
        if (!el) continue;
        const m = G.units.filter((u) => u.kind === 'subject' && !u.dead && u.job === j.id && u.horse).length, a = G.horseAlloc[j.id] || 0;
        el.innerHTML = a || m ? `${m}<span class="note">/${a}</span>` : '<span class="note">·</span>';
        const tr = document.querySelector(`#jobs tr[data-job="${j.id}"]`);
        tr.querySelector('button[data-h="1"]').disabled = given >= tot;
        tr.querySelector('button[data-h="-1"]').disabled = !a;
      }
      hfoot = `<div class="note">${ic('horse')} Horses ${tot} / ${hcap} · ${tot - given} not given to a job — right-hand column: mounted / horses given</div>`;
    }
    const subs = K.subjects(G).length, house = K.housing(G);
    const prod = Math.min(c.farm, K.slots(G, 'farm', true)) * K.RATES.farm;
    const eat = (subs + 1) * K.RATES.eat;
    const net = (prod - eat) * 60;
    let need = '';
    for (const j of K.JOBS) if (j.where && c[j.id] > K.slots(G, j.where)) need += `<div class="note warnc">${c[j.id] - K.slots(G, j.where)} ${j.name.toLowerCase()} need a ${K.SDEF[j.where].name}</div>`;
    let restW = 0, restS = 0;
    for (const u of G.units) if (u.kind === 'subject' && !u.dead && u.job === 'idle') { if (u.noSoldierUntil > G.round) restW++; if (u.noCivilUntil > G.round) restS++; }
    const rest = restW || restS ? `<div class="note">${restW ? restW + ' ex-workers can\'t enlist yet' : ''}${restW && restS ? ' · ' : ''}${restS ? restS + ' ex-soldiers can\'t work yet' : ''}</div>` : '';
    if (G.world.plan.size) {
      const nf = G.world.fillPlan.size, nt = G.world.plan.size - nf;
      need += `<div class="note">${[nt ? nt + ' trench' : '', nf ? nf + ' fill' : ''].filter(Boolean).join(' + ')} tiles marked${c.dig ? '' : ' — assign Ditchers'}</div>`;
    }
    const sc = K.soldierCap(G), sn = K.soldierCount(G);
    const sold = `<div class="note${sn > sc ? ' warnc' : ''}">Soldiers ${sn} / ${sc} cap${sc ? (sn >= sc ? ' — build another Barracks to train more' : '') : ' — build a Barracks to train soldiers'}</div>`;
    for (const j of K.JOBS) if (j.soldier) { const p = document.querySelector(`#jobs tr[data-job="${j.id}"] button[data-d="1"]`); if (p) p.disabled = sn >= sc; }
    $('jobs-sum').textContent = c.idle + ' unassigned';
    $('jobfoot').innerHTML = `<div style="margin-top:4px">Unassigned: <span class="idle">${c.idle}</span></div>${rest}
      <div class="note${subs > house ? ' warnc' : ''}">Subjects ${subs} / ${house} cap${subs > house ? ' — build Houses!' : ''} · Food ${net >= 0 ? '+' : ''}${net.toFixed(0)}/min${G.res.food <= 0 && subs ? ' <span class="warnc">STARVING</span>' : ''}</div>${sold}${hfoot}${need}`;
  }

  // ---------- info panel ----------
  // Selected soldiers (G.ui.sel); G.ui.selUnit is set when exactly one archer is selected.
  function selectUnits(list, add) {
    const G = UI.G, prev = G.ui.sel || [];
    if (!add) for (const u of prev) u.selected = false;
    const set = new Set(add ? prev : []);
    for (const u of list) if (u && !u.dead && K.isSoldier(u)) set.add(u);
    G.ui.sel = [...set];
    for (const u of G.ui.sel) u.selected = true;
    G.ui.selUnit = G.ui.sel.length === 1 && G.ui.sel[0].job === 'archer' ? G.ui.sel[0] : null;
  }
  const selectUnit = (u) => selectUnits(u ? [u] : []);
  UI.selectUnit = selectUnit;
  UI.selectUnits = selectUnits;
  function refreshUnitInfo(G, sel, el) {
    el.classList.remove('hidden');
    const u = sel[0], ordered = sel.filter((v) => v.order).length;
    let h;
    if (sel.length === 1) {
      const st = K.unitStats(u);
      const s = u.post != null ? G.world.structs.get(u.post) : null;
      const where = u.order ? 'Attacking the marked area' : u.job !== 'archer' ? (u.foe ? 'Fighting' : 'Guarding the ' + K.rulerName(G)) : u.onWall ? 'On the battlements' : s ? 'Heading to a battlement' : 'Unposted';
      h = `<h3>${st.name}${u.horse && u.job !== 'knight' ? ' (mounted)' : ''}</h3>
        <div class="hpbar"><div style="width:${(100 * u.hp) / u.maxHp}%"></div></div>
        <div class="note">${Math.ceil(u.hp)} / ${u.maxHp} hp</div>
        <div>${where}${u.manualPost ? ' (stationed by you)' : ''}</div>`;
      if (u.job === 'archer' && !u.order) h += `<p class="note">To station archers, click a battlement and choose Assign.</p>`;
      if (u.manualPost && !u.order) h += `<p><button id="btn-autopost">Let archer choose post</button></p>`;
    } else {
      const by = {};
      for (const v of sel) { const n = K.unitStats(v).name; by[n] = (by[n] || 0) + 1; }
      h = `<h3>${sel.length} soldiers selected</h3><div>${Object.entries(by).map(([n, c]) => c + ' ' + n + (c > 1 && !/y$/.test(n) ? 's' : '')).join(' · ')}</div>`;
      if (ordered) h += `<div>${ordered} on attack orders</div>`;
    }
    h += `<p class="note">Right-click the map to send ${sel.length > 1 ? 'them' : 'it'} to attack there. Drag a box to select soldiers; Shift adds. Esc deselects.</p><p>`;
    if (ordered) h += `<button id="btn-clearord">Return to duty</button> `;
    h += `<button id="btn-desel">Deselect</button></p>`;
    if (el.dataset.h !== h) {
      el.innerHTML = h; el.dataset.h = h;
      const b = $('btn-autopost');
      if (b) b.onclick = () => { K.postArcher(G, u, null); refreshInfo(); };
      const bc = $('btn-clearord');
      if (bc) bc.onclick = () => { K.clearOrders(G, sel); refreshInfo(); };
      $('btn-desel').onclick = () => { selectUnit(null); refreshInfo(); };
    }
  }
  function refreshInfo() {
    const G = UI.G, s = G.ui.selected, el = $('info');
    if (G.ui.sel && G.ui.sel.length) {
      const live = G.ui.sel.filter((v) => !v.dead && K.isSoldier(v));
      if (live.length !== G.ui.sel.length) selectUnits(live);
      if (live.length) return refreshUnitInfo(G, live, el);
    }
    if (!s || !G.world.structs.has(s.id)) { G.ui.selected = null; el.classList.add('hidden'); return; }
    if (s.type === 'site') {
      const fd = K.SDEF[s.final], pct = Math.floor((100 * s.prog) / s.time);
      const self = K.SELF_BUILD[s.final], job = K.JOB[self || 'repair'], jn = job.name.toLowerCase();
      const nm = G.units.filter((u) => !u.dead && (self ? u.work === s : u.rep === s)).length;
      el.classList.remove('hidden');
      const h = `<h3>${fd.name}${s.battle ? ' + battlements' : ''} <small>(under construction)</small></h3>
        <div class="hpbar"><div style="width:${pct}%;background:#8ad0ff"></div></div>
        <div class="note">${pct}% built · ${nm ? nm + (self ? '' : '/' + K.spotCount(G.world, s)) + ' ' + (nm > 1 ? jn : jn.replace(/s$/, '')) + ' working' : (K.jobCount(G)[job.id] && !self ? 'waiting for a builder' : 'assign ' + job.name + ' to build it')}</div>
        <p>${fd.desc}</p><p><button id="btn-cancel">Cancel build (full refund)</button>${K.isGate(s.final) ? ' <button id="btn-grot">⟳ Rotate</button>' : ''}</p><p class="note">Or press Delete.</p>`;
      if (el.dataset.h !== h) {
        el.innerHTML = h; el.dataset.h = h;
        $('btn-cancel').onclick = () => { K.cancelSite(G, s); G.ui.selected = null; refreshInfo(); };
        const gr = $('btn-grot');
        if (gr) gr.onclick = () => { K.rotateGate(G, s); refreshInfo(); };
      }
      return;
    }
    const d = K.SDEF[s.type];
    el.classList.remove('hidden');
    let h = `<h3>${d.name}${s.battlement ? ' + battlements' : ''}${s.upg ? ' <small>(battlements ' + Math.floor(100 * s.upg.prog / s.upg.time) + '%)</small>' : ''}</h3>
      <div class="hpbar"><div style="width:${(100 * s.hp) / s.maxHp}%"></div></div>
      <div class="note">${Math.ceil(s.hp)} / ${s.maxHp} hp</div><p>${d.desc}</p>`;
    if (d.slots) h += `<div>Workers: ${s.workers.size} / ${d.slots}</div>`;
    if (d.housing) h += `<div>Housing: ${d.housing}</div>`;
    if (s.type === 'drawbridge') {
      const gn = G.world.dbGroup(s).length;
      h += `<div>${gn > 1 ? gn + ' joined sections · ' : ''}${s.raised ? 'Raised — blocks the crossing' : 'Lowered — anyone can cross'}</div>
        ${(() => { const bx = G.world.dbBox(G.world.dbGroup(s)); return bx.w === bx.h ? `<p><button id="btn-rotate">Rotate (${s.vert ? 'north–south' : 'east–west'})</button></p>` : `<p class="note">Spans ${s.vert ? 'north–south' : 'east–west'} (its long way)</p>`; })()}
        <p class="note">Hinged on the ${s.vert ? (s.hingeFar ? 'south' : 'north') : s.hingeFar ? 'east' : 'west'} end, nearest your gate.</p>
        <p><button id="btn-bridge">${s.raised ? 'Lower' : 'Raise'} drawbridge</button></p>`;
      const n = [...G.world.structs.values()].filter((x) => x.type === 'drawbridge').length;
      if (n > 1) h += `<p><button id="btn-bridges">${[...G.world.structs.values()].some((x) => x.type === 'drawbridge' && !x.raised) ? 'Raise' : 'Lower'} all ${n}</button></p>`;
    }
    const eh = K.engineHost(G.world, s);
    if (eh) {
      const et = eh.engine ? eh.engine.type : eh.upg.engine, ed = K.SDEF[et];
      h += `<div><b>${ed.name}</b> mounted on these battlements${eh.engine ? '' : ' — being hauled up'}</div>
        <div class="note">Range ${K.rangeVs(ed.range, K.WALL_LIFT, 0).toFixed(1)} from the walls (${ed.range} on the ground). Demolish removes the engine, not the wall.</div>`;
      if (!eh.engine) h += `<p><button id="btn-cancel">Cancel ${ed.name.toLowerCase()} (full refund)</button></p>`;
    } else if (s.type === 'wall' && s.battlement) {
      const a = K.archerOn(G, s);
      if (a) h += `<div>Manned by an archer${a.manualPost ? ' (assigned by you)' : ''}${a.onWall ? '' : ' — on the way'}</div><p><button id="btn-unassign">Unassign archer</button></p>`;
      else {
        const nf = K.freeArchers(G).length;
        h += `<div>Empty battlement${s.noAuto ? ' (kept empty)' : ''}</div>`;
        h += nf ? `<p><button id="btn-assign">Assign archer</button> <span class="note">${nf} unassigned</span></p>` : `<p class="note">No unassigned archers.</p>`;
      }
    }
    if (s.type === 'stables') {
      const tot = K.horseTotal(G), cap = K.horseCap(G);
      h += `<div>${ic('horse')} Horses ${tot} / ${cap} · ${G.horses} free in the stables</div>
        <p><button id="btn-horse"${tot >= cap || !K.canAfford(G, K.HORSE.cost) ? ' disabled' : ''}>Raise a horse (${K.costText(K.HORSE.cost)})</button></p>
        <p class="note">Give horses to jobs in the Subjects table (horse column): riders move ${K.HORSE.speed}× faster, and Knights become Mounted Knights.</p>`;
    }
    if (s.upg && !s.upg.engine) h += `<p><button id="btn-cancel">Cancel battlements (full refund)</button></p>`;
    if (K.isGate(s.type)) h += `<p><button id="btn-grot">⟳ Rotate gate</button> <span class="note">${s.rot ? 'north–south' : 'east–west'}</span></p>`;
    if (s.type !== 'keep' && s.type !== 'keepdoor' && (G.phase === 'build' || G.phase === 'defense')) h += `<p><button id="btn-demo">Demolish (50% refund)</button></p>`;
    if (el.dataset.h !== h) {
      el.innerHTML = h; el.dataset.h = h;
      const b = $('btn-demo');
      if (b) b.onclick = () => { K.tryBuild(G, 'demolish', [{ x: s.x, y: s.y }]); G.ui.selected = null; refreshInfo(); };
      const bb = $('btn-bridge');
      if (bb) bb.onclick = () => { K.setDrawbridge(G, s, !s.raised); refreshInfo(); };
      const bc = $('btn-cancel');
      if (bc) bc.onclick = () => { K.cancelSite(G, K.engineHost(G.world, s) || s); refreshInfo(); };
      const gr = $('btn-grot');
      if (gr) gr.onclick = () => { K.rotateGate(G, s); refreshInfo(); };
      const br = $('btn-rotate');
      if (br) br.onclick = () => { K.rotateDrawbridge(G, s); refreshInfo(); };
      const bas = $('btn-assign');
      if (bas) bas.onclick = () => { K.assignBattlement(G, s); refreshInfo(); };
      const bun = $('btn-unassign');
      if (bun) bun.onclick = () => { K.unassignBattlement(G, s); refreshInfo(); };
      const ba = $('btn-bridges');
      if (ba) ba.onclick = () => { K.toggleAllDrawbridges(G); refreshInfo(); };
      const bh = $('btn-horse');
      if (bh) bh.onclick = () => { K.buyHorse(G); K.updateHorses(G); refreshInfo(); refreshTop(); };
    }
  }

  // ---------- top bar ----------
  const roundTxt = (G) => (G.endless ? `Round ${G.round + 1} · Endless` : `Round ${G.round + 1}/${K.ROUNDS}`);
  function refreshTop() {
    const G = UI.G, r = G.res;
    const items = [['stone', r.stone], ['lumber', r.lumber], ['plank', r.plank || 0], ['ore', r.ore], ['iron', r.iron], ['food', r.food], ['people', K.subjects(G).length]];
    const hcap = K.horseCap(G);
    if (hcap) items.push(['horse', K.horseTotal(G)]);
    const cap = K.housing(G), rcap = (k) => (G.world.keep && !G.god && K.STORED.includes(k) ? K.resCap(G, k) : 0);
    const capOf = (k) => (k === 'people' ? '<small>/' + cap + '</small>' : k === 'horse' ? '<small>/' + hcap + '</small>' : rcap(k) ? '<small>/' + rcap(k) + '</small>' : '');
    const STORE_TIP = { food: 'Food Storage', lumber: 'Lumber Storage', plank: 'Lumber Storage', stone: 'Stone Storage', ore: 'Metal Storage', iron: 'Metal Storage' };
    const tip = (k) => (k === 'people' ? 'subjects / cap (build Houses to raise the cap)' : k === 'horse' ? 'horses / cap (raise them at Stables)' : STORE_TIP[k] ? (K.RES_NAME[k] || k) + ' / storage cap (build ' + STORE_TIP[k] + ' to raise it)' : k);
    const html = items.map(([k, v]) => `<div class="res${(k === 'food' && v < 20) || (k === 'people' && (v < 3 || v > cap)) ? ' low' : ''}${rcap(k) && v >= rcap(k) - 0.5 ? ' full' : ''}" title="${tip(k)}">${ic(k)}<span class="n">${Math.floor(v)}${capOf(k)}</span></div>`).join('');
    if ($('resources').dataset.h !== html) { $('resources').innerHTML = html; $('resources').dataset.h = html; }
    refreshPhase();
    $('btn-begin').disabled = G.phase !== 'build';
    {
      const sb = $('btn-shape'), t = `⛰ Shape land (${K.SHAPE_BUDGET - G.shaped.size} left)`;
      sb.classList.toggle('hidden', G.phase !== 'place');
      sb.classList.toggle('on', !!UI.shaping && G.phase === 'place');
      if (sb.textContent !== t) sb.textContent = t;
      if (G.phase !== 'place') UI.shaping = false;
    }
    {
      const dbs = [...G.world.structs.values()].filter((s) => s.type === 'drawbridge'), bb = $('btn-bridges');
      bb.classList.toggle('hidden', !dbs.length);
      const t = dbs.some((s) => !s.raised) ? '▲ Raise bridges' : '▼ Lower bridges';
      if (bb.textContent !== t) bb.textContent = t;
    }
    $('btn-god').classList.toggle('on', !!G.god);
    const ak = $('btn-allkeep'), akt = G.allKeep ? 'Release all' : 'All to Keep';
    ak.classList.toggle('on', !!G.allKeep);
    if (ak.textContent !== akt) ak.textContent = akt;
    for (const el of document.querySelectorAll('.bitem')) {
      el.classList.toggle('no', el.dataset.type !== 'demolish' && !K.canAfford(G, K.SDEF[el.dataset.type].cost));
      el.classList.toggle('locked', !K.canBuildNow(G, el.dataset.type));
    }
  }

  // Centre of the top bar: the current alert if there is one, otherwise the phase and timer.
  const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function refreshPhase() {
    const G = UI.G, ph = $('phase'), a = UI.alert;
    let txt, tm = '';
    if (G.phase === 'place') txt = UI.shaping ? 'Shaping land — click or drag over water/mountain to make land' : 'Choose a site for your Keep — click the map';
    else if (G.phase === 'build') { txt = `${roundTxt(G)} · ${G.recall ? 'Recall!' : 'Build phase'}`; tm = K.fmtTime(G.timer); }
    else if (G.phase === 'defense') {
      const left = G.units.filter((u) => u.team === 1 && !u.dead && !u.retreat).length + G.spawnQueue.length;
      txt = `${roundTxt(G)} · SIEGE · ${left} enemies`; tm = K.fmtTime(G.timer);
    } else txt = G.phase === 'won' ? 'Victory!' : 'Defeat';
    // persistent elements: only text changes, so nothing re-animates when the timer ticks
    if (!ph.querySelector('.lbl')) ph.innerHTML = '<span class="lbl"></span><span class="t"></span><span class="enc"></span>';
    const lbl = ph.querySelector('.lbl'), te = ph.querySelector('.t'), ee = ph.querySelector('.enc');
    if (a) {
      if (lbl.dataset.aid !== String(a.id)) {
        lbl.dataset.aid = a.id;
        lbl.innerHTML = `<span class="alert ${a.kind}"><span class="msg">${escH(a.text)}</span> <small class="n"></small> <small class="more"></small></span>`;
      }
      const n = lbl.querySelector('.n'), mo = lbl.querySelector('.more');
      const nt = a.n > 1 ? '×' + a.n : '', mt = UI.alertQ.length ? '+' + UI.alertQ.length + ' more' : '';
      if (n.textContent !== nt) n.textContent = nt;
      if (mo.textContent !== mt) mo.textContent = mt;
    } else if (lbl.dataset.aid !== 'status' || lbl.textContent !== txt) { lbl.dataset.aid = 'status'; lbl.textContent = txt; }
    if (te.textContent !== tm) te.textContent = tm;
    te.style.display = tm ? '' : 'none';
    const enc = G.world.isEnclosed(), et = G.world.keep && !a ? (enc ? '● ' + K.rulerName(G) + ' enclosed' : '○ ' + K.rulerName(G) + ' exposed') : '';
    if (ee.textContent !== et) { ee.textContent = et; ee.style.color = enc ? 'var(--green)' : 'var(--red)'; }
    ee.style.display = et ? '' : 'none';
    const cls = G.phase + (a ? ' alerting' : '');
    if (ph.className !== cls) ph.className = cls;
  }
  // Alerts queue up and show one at a time in the top bar.
  function alerts(dt) {
    const G = UI.G, q = UI.alertQ;
    while (UI.seenMsg < G.messages.length) {
      const m = G.messages[UI.seenMsg++];
      const same = q.length ? q[q.length - 1] : UI.alert;
      if (same && same.text === m.text) { same.n++; if (same === UI.alert) same.t = Math.max(same.t, 1.5); continue; }
      q.push({ text: m.text, kind: m.kind, n: 1, t: 0, id: (UI.alertId = (UI.alertId || 0) + 1) });
    }
    // never fall far behind: drop the oldest routine alerts first
    while (q.length > 6) { const j = q.findIndex((m) => m.kind !== 'bad'); q.splice(j >= 0 ? j : 0, 1); }
    if (G.messages.length > 200) { G.messages.splice(0, 100); UI.seenMsg -= 100; }
    if (UI.alert) UI.alert.t -= dt;
    if ((!UI.alert || UI.alert.t <= 0) && (q.length || UI.alert)) {
      UI.alert = q.shift() || null;
      if (UI.alert) UI.alert.t = q.length > 2 ? 2.6 : 4.5;
    }
  }

  let slow = 0;
  UI.frame = function (dt) {
    const G = UI.G;
    panKeys(dt);
    smoothZoom(dt);
    slow -= dt;
    alerts(dt);
    refreshPhase();
    if (slow <= 0) { slow = 0.2; refreshTop(); refreshJobs(); refreshInfo(); }
    if (UI.tool && UI.mouse) updateGhost();
    if (G.phase === 'place' && UI.shaping) {
      G.ui.ghost = null;
      G.ui.shapeHover = UI.mouse && !UI.shapeDrag ? { x: UI.mouse.tile.x, y: UI.mouse.tile.y, st: K.shapeState(G, UI.mouse.tile.x, UI.mouse.tile.y) } : null;
      if (UI.shapeDrag) {
        const d = UI.shapeDrag, m = UI.mouse ? UI.mouse.tile : d, tiles = shapeTiles(G);
        const left = d.mode === 'raise' ? K.SHAPE_BUDGET - G.shaped.size : tiles.length;
        G.ui.shapeArea = { x0: Math.min(d.x, m.x), y0: Math.min(d.y, m.y), x1: Math.max(d.x, m.x), y1: Math.max(d.y, m.y), mode: d.mode, ok: tiles.slice(0, left), over: tiles.slice(left) };
      } else G.ui.shapeArea = null;
    } else if (G.phase === 'place' && UI.pendingKeep) {
      G.ui.shapeHover = null;
      G.ui.ghost = [{ type: 'keep', x: UI.pendingKeep.x, y: UI.pendingKeep.y, ok: true }];
    } else if (G.phase === 'place') {
      G.ui.shapeHover = null;
      if (UI.mouse) { const x = UI.mouse.tile.x - 1, y = UI.mouse.tile.y - 1; G.ui.ghost = [{ type: 'keep', x, y, ok: K.keepSiteOk(G, x, y).ok }]; }
      else G.ui.ghost = null;
    } else if (G.ui.ghost && G.ui.ghost[0] && G.ui.ghost[0].type === 'keep') G.ui.ghost = null;
    if (UI.tool && !K.canBuildNow(G, UI.tool)) setTool(null);
  };

  // ---------- tooltip ----------
  // Details appear only after resting on the same thing for TIP_DELAY ms.
  const TIP_DELAY = 2000;
  const TT = { key: null, timer: 0, shown: false, html: '', x: 0, y: 0 };
  function tipShow() {
    const t = $('tooltip');
    t.innerHTML = TT.html; t.classList.remove('hidden'); TT.shown = true;
    t.style.left = Math.min(innerWidth - 270, TT.x + 14) + 'px';
    t.style.top = TT.y + 12 + 'px';
  }
  function tip(e, html, key) {
    if (!e || !html) { clearTimeout(TT.timer); TT.key = null; TT.shown = false; $('tooltip').classList.add('hidden'); return; }
    key = key || html;
    TT.html = html; TT.x = e.clientX; TT.y = e.clientY;
    if (key === TT.key) { if (TT.shown) tipShow(); return; }
    clearTimeout(TT.timer); TT.key = key; TT.shown = false;
    $('tooltip').classList.add('hidden');
    TT.timer = setTimeout(() => { if (TT.key === key) tipShow(); }, TIP_DELAY);
  }

  // ---------- camera & input ----------
  function screenToTile(sx, sy) {
    const c = K.Render.cam;
    return { x: Math.floor((c.x + sx / c.zoom) / TS), y: Math.floor((c.y + sy / c.zoom) / TS) };
  }
  UI.clampCam = function () {
    const c = K.Render.cam, cv = K.Render.canvas;
    const vw = cv.width / c.zoom, vh = cv.height / c.zoom;
    // let the map edges slide clear of the panels that sit over the canvas (plus a little breathing room)
    const sz = (id, k) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect()[k] + 12 : 0; };
    const L = (sz('buildmenu', 'width') + 40) / c.zoom, Rt = (sz('side', 'width') + 40) / c.zoom;
    const Tp = (sz('topbar', 'height') + 40) / c.zoom, B = 80 / c.zoom;
    const fit = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : K.clamp(v, lo, hi));
    c.x = fit(c.x, -L, N * TS - vw + Rt);
    c.y = fit(c.y, -Tp, N * TS - vh + B);
  };
  UI.centerOn = function (tx, ty) {
    const c = K.Render.cam, cv = K.Render.canvas;
    c.x = tx * TS - cv.width / c.zoom / 2;
    c.y = ty * TS - cv.height / c.zoom / 2;
    UI.clampCam();
  };
  // Zoom is eased toward a target, keeping the world point under the anchor fixed.
  function zoomBy(factor, sx, sy) {
    UI.zoomTarget = K.clamp((UI.zoomTarget || K.Render.cam.zoom) * factor, ZMIN, ZMAX);
    UI.zoomAnchor = { sx, sy };
  }
  function smoothZoom(dt) {
    const c = K.Render.cam, tz = UI.zoomTarget;
    if (!tz || !UI.zoomAnchor || c.zoom === tz) return;
    const { sx, sy } = UI.zoomAnchor;
    const wx = c.x + sx / c.zoom, wy = c.y + sy / c.zoom;
    let nz = c.zoom + (tz - c.zoom) * (1 - Math.exp(-dt * 16));
    if (Math.abs(nz - tz) < tz * 0.002) nz = tz;
    c.zoom = nz;
    c.x = wx - sx / nz; c.y = wy - sy / nz;
    UI.clampCam();
  }
  function panKeys(dt) {
    const k = UI.keys, c = K.Render.cam;
    const sp = (900 * dt) / c.zoom;
    if (k.a || k.arrowleft) c.x -= sp;
    if (k.d || k.arrowright) c.x += sp;
    if (k.w || k.arrowup) c.y -= sp;
    if (k.s || k.arrowdown) c.y += sp;
    UI.clampCam();
  }

  function dragTiles(type, a, b) {
    const d = K.SDEF[type];
    if (!d.drag || !a) return [b];
    const out = [];
    if (type === 'drawbridge') {
      // a rectangle, at most 2x2, anchored where the drag started
      const sx = b.x < a.x ? -1 : 1, sy = b.y < a.y ? -1 : 1;
      const nx = Math.min(1, Math.abs(b.x - a.x)), ny = Math.min(1, Math.abs(b.y - a.y));
      for (let dy = 0; dy <= ny; dy++) for (let dx = 0; dx <= nx; dx++) out.push({ x: a.x + dx * sx, y: a.y + dy * sy });
      return out;
    }
    const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
    if (UI.keys.shift || type === 'drawbridge') {
      // Shift: the old square corner — along the row, then down the column
      for (let x = a.x; ; x += sx) { out.push({ x, y: a.y }); if (x === b.x || !sx) break; }
      if (sy) for (let y = a.y + sy; ; y += sy) { out.push({ x: b.x, y }); if (y === b.y) break; }
      return out;
    }
    // a 45° diagonal leg from the anchor, then straight on to the cursor
    const n = Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    let x = a.x, y = a.y;
    out.push({ x, y });
    for (let k = 0; k < n; k++) { x += sx; y += sy; out.push({ x, y }); }
    while (x !== b.x || y !== b.y) { if (x !== b.x) x += sx; else y += sy; out.push({ x, y }); }
    return out;
  }
  function anchor(type, t) {
    let rot = 0;
    if (K.SDEF[type].rotates) {
      // match the wall line under the cursor, otherwise use the manual rotation (V)
      const w = UI.G.world, isW = (x, y) => { const s = w.structAt(x, y); return s && s.type === 'wall'; };
      const vert = isW(t.x, t.y - 1) || isW(t.x, t.y + 1), horz = isW(t.x - 1, t.y) || isW(t.x + 1, t.y);
      // it lines up with the wall under the cursor; V (or the Rotate button) turns it the other way
      rot = (vert && !horz ? 1 : 0) ^ (UI.rot || 0);
    }
    const d = K.dims(type, rot);
    return { x: t.x - ((d.w - 1) >> 1), y: t.y - ((d.h - 1) >> 1), rot };
  }
  // Tiles a shape-land drag will change, nearest the start first, trimmed to the remaining budget.
  function shapeTiles(G) {
    const d = UI.shapeDrag, m = UI.mouse ? UI.mouse.tile : d;
    if (!d) return [];
    const out = [];
    for (let y = Math.min(d.y, m.y); y <= Math.max(d.y, m.y); y++)
      for (let x = Math.min(d.x, m.x); x <= Math.max(d.x, m.x); x++)
        if (K.shapeState(G, x, y) === d.mode) out.push({ x, y, mode: d.mode });
    out.sort((a, b) => Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y));
    return out;
  }
  function updateGhost() {
    const G = UI.G, t = anchor(UI.tool, UI.mouse.tile);
    const tiles = dragTiles(UI.tool, UI.drag, t);
    if (tiles.length > 400) tiles.length = 400;
    G.ui.ghost = tiles.map((p) => {
      let ok;
      if (UI.tool === 'demolish') { const s = G.world.structAt(p.x, p.y); ok = !!s && s.type !== 'keep' && s.type !== 'keepdoor'; }
      else ok = G.world.canPlace(UI.tool, p.x, p.y, G, p.rot).ok;
      return Object.assign({ type: UI.tool, x: p.x, y: p.y, ok }, K.dims(UI.tool, p.rot));
    });
  }

  function bind() {
    const cv = $('game');
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      // trackpad pinch arrives as ctrl+wheel with small deltas
      zoomBy(Math.exp(-K.clamp(dy, -200, 200) * (e.ctrlKey ? 0.012 : 0.0016)), e.clientX, e.clientY);
    }, { passive: false });
    cv.addEventListener('mousedown', (e) => {
      const G = UI.G;
      if (e.button === 1 || e.button === 2) {
        UI.pan = { x: e.clientX, y: e.clientY, moved: false };
        return;
      }
      if (e.button !== 0) return;
      const t = screenToTile(e.clientX, e.clientY);
      if (G.phase === 'place' && UI.shaping) {
        // drag a box: every tile in it of the starting kind (land to raise, or shaped to undo) changes on release
        UI.shapeDrag = { x: t.x, y: t.y, mode: K.shapeState(G, t.x, t.y) || 'raise' };
        return;
      }
      if (G.phase === 'place') {
        if (UI.pendingKeep) return;
        const r = K.keepSiteOk(G, t.x - 1, t.y - 1);
        if (!r.ok) { G.msg(r.reason + '.', 'warn'); return; }
        UI.pendingKeep = { x: t.x - 1, y: t.y - 1 };
        tip(null);
        $('keepconf').classList.remove('hidden');
        $('keepconf-ok').focus();
        return;
      }
      if (UI.tool) {
        if (K.SDEF[UI.tool].drag) UI.drag = anchor(UI.tool, t);
        else { K.tryBuild(G, UI.tool, [anchor(UI.tool, t)]); if (!e.shiftKey && UI.tool !== 'demolish' && !K.canAfford(G, K.SDEF[UI.tool].cost)) setTool(null); }
      } else {
        // box-select starts here; a click without dragging is handled on mouseup
        UI.box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, shift: e.shiftKey, moved: false };
      }
    });
    function clickSelect(G, e) {
      const c = K.Render.cam, fx = (c.x + e.clientX / c.zoom) / TS, fy = (c.y + e.clientY / c.zoom) / TS;
      const t = screenToTile(e.clientX, e.clientY);
      const s = G.world.structAt(t.x, t.y);
      // clicking a wall (even with an archer on it) selects the wall; assign/unassign from its panel
      if (s && s.type === 'wall' && !e.shiftKey) { selectUnit(null); G.ui.selected = s; refreshInfo(); return; }
      // pick a soldier under the cursor (sprites stand above their tile)
      let best = null, bd = 0.9;
      for (const u of G.units) {
        if (u.team !== 0 || u.dead || u.hidden || !K.isSoldier(u)) continue;
        const d = Math.hypot(u.x - fx, u.y - 0.5 - fy);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) {
        if (e.shiftKey && best.selected) selectUnits(G.ui.sel.filter((v) => v !== best));
        else selectUnits([best], e.shiftKey);
        G.ui.selected = null;
      } else if (!e.shiftKey) { selectUnit(null); G.ui.selected = s; }
      refreshInfo();
    }
    function boxSelect(G, b) {
      const c = K.Render.cam;
      const x0 = (c.x + Math.min(b.x0, b.x1) / c.zoom) / TS, x1 = (c.x + Math.max(b.x0, b.x1) / c.zoom) / TS;
      const y0 = (c.y + Math.min(b.y0, b.y1) / c.zoom) / TS, y1 = (c.y + Math.max(b.y0, b.y1) / c.zoom) / TS;
      const list = G.units.filter((u) => u.team === 0 && !u.dead && !u.hidden && K.isSoldier(u) && u.x >= x0 - 0.3 && u.x <= x1 + 0.3 && u.y >= y0 && u.y - 1 <= y1);
      selectUnits(list, b.shift);
      if (list.length) G.ui.selected = null;
      refreshInfo();
    }
    const selbox = document.createElement('div');
    selbox.id = 'selbox';
    document.body.appendChild(selbox);
    addEventListener('mousemove', (e) => {
      if (!UI.G) return;
      if (UI.box) {
        const b = UI.box;
        b.x1 = e.clientX; b.y1 = e.clientY;
        if (Math.abs(b.x1 - b.x0) + Math.abs(b.y1 - b.y0) > 6) b.moved = true;
        if (b.moved) Object.assign(selbox.style, { display: 'block', left: Math.min(b.x0, b.x1) + 'px', top: Math.min(b.y0, b.y1) + 'px', width: Math.abs(b.x1 - b.x0) + 'px', height: Math.abs(b.y1 - b.y0) + 'px' });
      }
      if (UI.pan) {
        const c = K.Render.cam;
        c.x -= (e.clientX - UI.pan.x) / c.zoom; c.y -= (e.clientY - UI.pan.y) / c.zoom;
        if (Math.abs(e.clientX - UI.pan.x) + Math.abs(e.clientY - UI.pan.y) > 0) UI.pan.moved = true;
        UI.pan.x = e.clientX; UI.pan.y = e.clientY;
        UI.clampCam();
      }
      if (e.target !== cv) { UI.mouse = null; UI.G.ui.hover = null; if (UI.tool && !UI.drag) UI.G.ui.ghost = null; return; }
      const t = screenToTile(e.clientX, e.clientY);
      UI.mouse = { tile: t };
      UI.G.ui.hover = t;
      hoverTip(e, t);
    });
    addEventListener('mouseup', (e) => {
      if (!UI.G) return;
      if (e.button === 0 && UI.shapeDrag) {
        const G = UI.G, tiles = shapeTiles(G);
        UI.shapeDrag = null; G.ui.shapeArea = null;
        if (G.phase === 'place' && tiles.length) {
          let n = 0;
          for (const p of tiles) if (K.shapeLand(G, p.x, p.y, p.mode)) n++;
          if (n < tiles.length) G.msg(`Shaped ${n} of ${tiles.length} tiles — not enough land-shaping left.`, 'warn');
          refreshTop();
        }
        return;
      }
      if ((e.button === 2 || e.button === 1) && UI.pan) {
        if (!UI.pan.moved && e.button === 2) {
          const G = UI.G, sel = G.ui.sel || [];
          if (UI.tool) setTool(null);
          else if (sel.length && e.target === cv && G.phase !== 'place') {
            // attack order on the clicked spot
            const t = screenToTile(e.clientX, e.clientY);
            const n = K.orderUnits(G, sel, t.x, t.y);
            if (n) G.ui.orderMark = { x: t.x, y: t.y, t: performance.now() };
            refreshInfo();
          }
        }
        UI.pan = null;
        return;
      }
      if (e.button === 0 && UI.box) {
        const b = UI.box;
        UI.box = null; selbox.style.display = 'none';
        if (b.moved) boxSelect(UI.G, b);
        else if (e.target === cv) clickSelect(UI.G, e);
        return;
      }
      if (e.button === 0 && UI.drag && UI.tool && UI.mouse) {
        const tiles = dragTiles(UI.tool, UI.drag, anchor(UI.tool, UI.mouse.tile));
        K.tryBuild(UI.G, UI.tool, tiles);
        UI.drag = null;
      } else UI.drag = null;
    });
    addEventListener('keydown', (e) => {
      if (!UI.G || e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      UI.keys[k] = true;
      if (UI.pendingKeep && (k === 'escape' || k === 'enter')) { e.preventDefault(); keepConfirm(k === 'enter'); }
      else if ((k === 'delete' || k === 'backspace') && UI.G.ui.selected && UI.G.ui.selected.type === 'site') { e.preventDefault(); K.cancelSite(UI.G, UI.G.ui.selected); UI.G.ui.selected = null; refreshInfo(); }
      else if (k === 'escape') { setTool(null); UI.shaping = false; UI.G.ui.selected = null; selectUnit(null); refreshInfo(); }
      else if (k === ' ') { e.preventDefault(); setSpeed(UI.speed === 0 ? UI.prevSpeed || 1 : 0); }
      else if (k === '1') setSpeed(1);
      else if (k === '2') setSpeed(2);
      else if (k === '3') setSpeed(4);
      else if (k === 'home' || k === 'k') { const s = UI.G.kingSpot || UI.G.world.start; UI.centerOn(s.x, s.y); }
      else if (k === 'v') rotateTool();
      else if (k === '=' || k === '+') { e.preventDefault(); zoomBy(1.3, innerWidth / 2, innerHeight / 2); }
      else if (k === '-' || k === '_') { e.preventDefault(); zoomBy(1 / 1.3, innerWidth / 2, innerHeight / 2); }
      else if (!e.metaKey && !e.ctrlKey && !'wasd'.includes(k)) {
        for (const id in K.SDEF) if (K.SDEF[id].key === k) { setTool(UI.tool === id ? null : id); break; }
      }
    });
    addEventListener('keyup', (e) => { UI.keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { UI.keys = {}; });
    $('btn-begin').onclick = () => { const G = UI.G; if (G.phase === 'build') G.timer = Math.min(G.timer, K.RECALL_TIME + 0.01); };
    $('btn-allkeep').onclick = () => {
      const G = UI.G;
      G.allKeep = !G.allKeep;
      G.msg(G.allKeep ? 'Everyone is called into the Keep!' : 'Your people leave the Keep and return to their work.', G.allKeep ? 'warn' : 'info');
      refreshTop();
    };
    $('btn-bridges').onclick = () => { K.toggleAllDrawbridges(UI.G); refreshTop(); refreshInfo(); };
    // The info panel is re-rendered whenever its contents change (e.g. HP ticking during repairs or
    // attacks), which can replace a button between mousedown and mouseup and swallow the click.
    // Act on pointerdown instead so buttons always respond.
    if (!UI.infoBound) {
      UI.infoBound = true;
      $('info').addEventListener('pointerdown', (e) => {
        const b = e.target.closest('button');
        if (!b || !b.onclick || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const f = b.onclick; b.onclick = null;
        f(e);
        $('info').dataset.h = '';
        refreshInfo();
      });
    }
    $('btn-shape').onclick = () => { UI.shaping = !UI.shaping; refreshTop(); };
    $('keepconf-ok').onclick = () => keepConfirm(true);
    $('keepconf-no').onclick = () => keepConfirm(false);
    $('btn-god').onclick = () => { K.setGod(UI.G, !UI.G.god); refreshTop(); };
    for (const b of document.querySelectorAll('[data-speed]')) b.onclick = () => setSpeed(+b.dataset.speed);
    const mm = $('minimap');
    const mmGo = (e) => { const r = mm.getBoundingClientRect(); UI.centerOn(((e.clientX - r.left) / r.width) * N, ((e.clientY - r.top) / r.height) * N); };
    mm.addEventListener('mousedown', (e) => { mmGo(e); UI.mmDrag = true; });
    addEventListener('mousemove', (e) => { if (UI.mmDrag) mmGo(e); });
    addEventListener('mouseup', () => { UI.mmDrag = false; });
  }
  UI.setSpeed = (s) => setSpeed(s);
  function setSpeed(s) {
    if (s === 0 && UI.speed) UI.prevSpeed = UI.speed;
    UI.speed = s;
    for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('on', +b.dataset.speed === s);
  }

  function hoverTip(e, t) {
    const G = UI.G, w = G.world;
    G.ui.hoverBeast = null;
    if (!K.inb(t.x, t.y) || UI.tool) return tip(null);
    const bst = (G.beasts || []).find((b) => !b.dead && Math.hypot(b.x - t.x - 0.5, b.y - t.y - 0.5) < 1.3);
    G.ui.hoverBeast = bst || null;
    const mon = (G.monsters || []).find((m) => Math.hypot(m.x - t.x - 0.5, m.y - t.y - 0.5) < 1.3);
    if (mon && !bst) {
      const croc = mon.kind === 'croc';
      return tip(e, `<b>${croc ? 'Crocodile' : 'Tentacle Monster'}</b><br>${croc ? 'Lurks in the rivers (and moats joined to them) and seizes anyone — friend or foe — in the water.' : 'Roams its lake and any moat joined to it, seizing anyone — friend or foe — in the water or on the shore beside it. Your people keep a step back from the shore when it is near.'} Units on bridges are safe.`, mon);
    }
    if (bst) {
      const d = K.BEASTS[bst.kind], sx = bst.sex === 'm' ? '♂ male' : '♀ female', f = bst.sex === 'f' ? bst : null;
      let br;
      if (bst.young) br = `Young — fully grown in ${Math.ceil(bst.growT)}s.`;
      else if (!K.beastCanBreed(G, bst)) br = 'Newly grown — cannot breed until after the next siege.';
      else if (f && f.mate) br = `<span class="warnc">Breeding — young due in ${Math.ceil(K.BEAST_BREED - f.breedT)}s.</span>`;
      else br = `Will breed with a ${bst.sex === 'm' ? 'female' : 'male'} that comes within ${d.aggro} tiles (one young every ${K.BEAST_BREED / 60} min, at most ${K.BEAST_LAIR_CAP} per lair).`;
      return tip(e, `<b>${d.name}</b> ${sx} ${Math.ceil(bst.hp)}/${bst.maxHp}<br>${br}<br>Roams up to ${d.roam} tiles from its lair (red circle) and attacks anyone — friend or foe — who comes near. ${d.fly ? 'Flies over walls, water and mountains and can snatch archers off the battlements — but archers can shoot it down.' : bst.kind === 'wolf' ? 'Hunts with its pack and chases far. Cannot pass or bite through walls.' : 'Cannot pass or bite through walls.'}`, 'bst' + bst.kind + bst.hp + br);
    }
    if (G.phase === 'place') return tip(null);
    let h = '', key = null;
    const s = w.structAt(t.x, t.y);
    if (s) {
      h = `<b>${K.SDEF[s.type].name}</b> ${Math.ceil(s.hp)}/${s.maxHp}`; key = 's' + s.id;
      const i = K.idx(t.x, t.y);
      if (w.ladder[i]) h += `<br><span class="warnc">Siege ladder ${Math.ceil(w.ladderHp.get(i) ?? K.LADDER_HP)}/${K.LADDER_HP}</span> — your archers and soldiers will throw it down`;
      if (s.type === 'wall' && s.battlement) h += '<br><i>Click to assign or unassign an archer</i>';
    }
    let u = null, bd = 0.7;
    for (const v of G.units) { if (v.hidden || v.dead) continue; const d = Math.hypot(v.x - (t.x + 0.5), v.y - 0.4 - (t.y + 0.5)); if (d < bd) { bd = d; u = v; } }
    if (u) {
      const st = K.unitStats(u);
      const name = u.kind === 'king' ? 'Your ' + K.rulerName(G) : u.kind === 'enemy' ? 'Enemy ' + st.name : u.job === 'idle' ? 'Subject (unassigned)' : K.JOB[u.job].name.replace(/s$/, '');
      h = `<b>${name}</b> ${Math.ceil(u.hp)}/${u.maxHp}`; key = u;
      if (u.carry) h += `<br>Carrying ${u.carry} ${u.carryRes || 'lumber'} to the keep`;
      if (u.team === 0 && u.job === 'archer') h += u.manualPost ? '<br>Stationed by you' : '';
      if (u.job === 'idle' && u.noSoldierUntil > G.round) h += '<br><i>Resting — can enlist after the next siege</i>';
      if (u.job === 'idle' && u.noCivilUntil > G.round) h += '<br><i>Off duty — can work after the next siege</i>';
    }
    tip(e, h, key);
  }
})();

'use strict';
// In-game menu: pause, settings (map seed) and saved seeds kept in localStorage.
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'keep.savedSeeds';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function load() {
    try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function store(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); return true; } catch (e) { return false; } }
  function playUrl(seed, o) { return location.pathname + '?seed=' + seed + (o ? '&opts=' + o : '') + '&autostart'; }
  // saved maps are identified by seed + custom options
  const same = (s, seed, o) => s.seed === seed && (s.opts || '') === (o || '');
  const optWord = (d, v) => {
    if (d.id === 'difficulty') return (v < 0.75 ? 'Easy' : v < 0.95 ? 'Mild' : v <= 1.05 ? 'Normal' : v < 1.5 ? 'Hard' : v < 2.5 ? 'Brutal' : 'Insane') + ' ' + Math.round(v * 100) + '%';
    return v === 0 ? 'None' : Math.round(v * 100) + '%';
  };
  K.describeOpts = (o) => K.MAP_OPTS.filter((d) => o[d.id] !== 1).map((d) => d.name + ' ' + optWord(d, o[d.id])).join(' · ');

  // Render a list of saved seeds into el. opts.cur = current seed, opts.pick(seed) = Play handler.
  function renderList(el, opts) {
    const list = load();
    el.className = 'saved-list';
    if (!list.length) { el.innerHTML = '<div class="empty">No saved maps yet.</div>'; return; }
    const isCur = (s) => opts.cur != null && same(s, opts.cur, opts.curOpts);
    el.innerHTML = list.map((s, i) => `<div class="item${isCur(s) ? ' cur' : ''}"${s.opts ? ` title="${esc(K.describeOpts(K.decodeOpts(s.opts)))}"` : ''}>
        <span class="nm">${s.name ? esc(s.name) + ' <small>#' + s.seed + '</small>' : '#' + s.seed}${s.opts ? ' <small class="cust">custom</small>' : ''}
          <small>· ${new Date(s.at).toLocaleDateString()}</small></span>
        ${isCur(s) ? '<small>(this map)</small>' : `<button data-play="${i}">Play</button>`}
        <button data-del="${i}" title="Forget this map">✕</button></div>`).join('');
    for (const b of el.querySelectorAll('[data-play]')) b.onclick = () => { const s = list[+b.dataset.play]; opts.pick(s.seed, s.opts || ''); };
    for (const b of el.querySelectorAll('[data-del]')) b.onclick = () => { const d = list[+b.dataset.del]; store(load().filter((s) => !same(s, d.seed, d.opts))); opts.refresh(); };
  }

  const M = (K.Menu = { open: false });

  M.init = function (G) {
    M.G = G;
    $('btn-menu').onclick = () => (M.open ? close() : show());
    $('menu-resume').onclick = close;
    $('menu-settings').onclick = () => pane('set');
    $('menu-back').onclick = () => pane('main');
    $('menu-new').onclick = () => { if (confirm('Abandon this game and return to the title screen?')) location.href = location.pathname; };
    $('menu').addEventListener('mousedown', (e) => { if (e.target.id === 'menu') close(); });
    $('menu-copy').onclick = () => {
      const t = String(G.seed);
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(
        () => { $('menu-copy').textContent = 'Copied'; setTimeout(() => ($('menu-copy').textContent = 'Copy'), 1200); },
        () => { window.getSelection().selectAllChildren($('menu-seed')); });
    };
    $('menu-save').onclick = () => {
      const o = K.encodeOpts(G.opts), list = load().filter((s) => !same(s, G.seed, o));
      list.unshift({ seed: G.seed, opts: o, name: $('menu-name').value.trim(), at: Date.now() });
      if (!store(list)) { G.msg && G.msg('Could not save — browser storage is unavailable.', 'warn'); return; }
      refreshSet();
    };
    // capture so the game's own hotkeys don't fire while the menu is open
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && M.open) { e.stopImmediatePropagation(); close(); return; }
      if (M.open && e.target.tagName !== 'INPUT') e.stopImmediatePropagation();
    }, true);
  };

  function pane(p) {
    $('menu-main').classList.toggle('hidden', p !== 'main');
    $('menu-set').classList.toggle('hidden', p !== 'set');
    if (p === 'set') refreshSet();
  }
  function refreshSet() {
    const G = M.G, o = K.encodeOpts(G.opts), saved = load().find((s) => same(s, G.seed, o));
    $('menu-seed').textContent = G.seed;
    $('menu-opts').textContent = o ? 'Custom map: ' + K.describeOpts(G.opts) : 'Standard map settings';
    $('menu-save').textContent = saved ? 'Saved ✓ (update)' : 'Save Seed';
    if (saved && document.activeElement !== $('menu-name')) $('menu-name').value = saved.name || '';
    renderList($('menu-saved'), {
      cur: G.seed, curOpts: o, refresh: refreshSet,
      pick: (seed, so) => { if (confirm('Abandon this game and start map #' + seed + '?')) location.href = playUrl(seed, so); },
    });
  }
  function show() {
    M.open = true;
    M.prevSpeed = K.UI.speed;
    K.UI.setSpeed(0);
    $('menu').classList.remove('hidden');
    $('btn-menu').classList.add('on');
    pane('main');
  }
  function close() {
    M.open = false;
    $('menu').classList.add('hidden');
    $('btn-menu').classList.remove('on');
    if (K.UI.speed === 0 && M.prevSpeed) K.UI.setSpeed(M.prevSpeed);
  }

  // Custom-map sliders on the title screen.
  M.customUI = function (o) {
    const box = $('custom-sliders');
    if (!box.children.length) {
      box.innerHTML = K.MAP_OPTS.map((d) => `<label title="${d.tip}"><span>${d.name}</span>
          <input type="range" id="opt-${d.id}" min="${Math.round(d.min * 100)}" max="${Math.round(d.max * 100)}" step="5" value="100">
          <b id="optv-${d.id}"></b></label>`).join('');
      for (const d of K.MAP_OPTS) $('opt-' + d.id).oninput = label;
      $('btn-custom').onclick = () => toggle($('custom').classList.contains('hidden'));
      $('custom-reset').onclick = () => M.customUI(K.mapOpts({}));
      if ($('preset-save')) $('preset-save').onclick = savePreset;
      if ($('preset-name')) $('preset-name').onkeydown = (e) => { if (e.key === 'Enter') savePreset(); };
    }
    for (const d of K.MAP_OPTS) $('opt-' + d.id).value = Math.round(o[d.id] * 100);
    label();
    if (K.isCustom(o)) toggle(true);
  };

  // Saved slider settings (presets), reusable with any seed.
  const PKEY = 'keep.mapPresets';
  function loadP() {
    try { const a = JSON.parse(localStorage.getItem(PKEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function storeP(a) { try { localStorage.setItem(PKEY, JSON.stringify(a)); return true; } catch (e) { return false; } }
  function savePreset() {
    const inp = $('preset-name'), o = K.encodeOpts(M.customOpts());
    const name = inp.value.trim() || 'Settings ' + (loadP().length + 1);
    const list = loadP().filter((p) => p.name.toLowerCase() !== name.toLowerCase());
    list.unshift({ name, opts: o, at: Date.now() });
    if (!storeP(list)) { alert('Could not save — browser storage is unavailable.'); return; }
    inp.value = '';
    drawPresets();
  }
  function drawPresets() {
    const el = $('preset-list');
    if (!el) return;
    const list = loadP(), cur = K.encodeOpts(M.customOpts());
    el.className = 'saved-list';
    if (!list.length) { el.innerHTML = '<div class="empty">No saved settings yet. Name the current sliders and press Save.</div>'; return; }
    el.innerHTML = list.map((p, i) => `<div class="item${p.opts === cur ? ' cur' : ''}" title="${esc(p.opts ? K.describeOpts(K.decodeOpts(p.opts)) : 'Standard map settings')}">
        <span class="nm">${esc(p.name)}<small>${esc(p.opts ? K.describeOpts(K.decodeOpts(p.opts)) : 'Standard')}</small></span>
        ${p.opts === cur ? '<small>(in use)</small>' : `<button data-load="${i}">Load</button>`}
        <button data-pdel="${i}" title="Delete these settings">✕</button></div>`).join('');
    for (const b of el.querySelectorAll('[data-load]')) b.onclick = () => { const p = list[+b.dataset.load]; M.customUI(K.decodeOpts(p.opts)); $('preset-name').value = p.name; };
    for (const b of el.querySelectorAll('[data-pdel]')) b.onclick = () => { const d = list[+b.dataset.pdel]; storeP(loadP().filter((p) => p.name !== d.name)); drawPresets(); };
  }
  function toggle(on) {
    $('custom').classList.toggle('hidden', !on);
    $('btn-custom').textContent = on ? 'Customize map ▾' : 'Customize map ▸';
  }
  function label() {
    const o = M.customOpts();
    for (const d of K.MAP_OPTS) {
      $('optv-' + d.id).textContent = optWord(d, o[d.id]);
      $('optv-' + d.id).classList.toggle('mod', o[d.id] !== 1);
    }
    $('btn-custom').classList.toggle('on', K.isCustom(o));
    drawPresets();
  }
  M.customOpts = function () {
    const o = {};
    for (const d of K.MAP_OPTS) { const el = $('opt-' + d.id); if (el) o[d.id] = +el.value / 100; }
    return K.mapOpts(o);
  };

  // Saved maps on the title screen: Play fills in the seed field and custom settings.
  M.startList = function (pick) {
    const el = $('saved-start');
    const draw = () => {
      if (!load().length) { el.innerHTML = ''; return; }
      el.innerHTML = '<h3>Saved maps</h3><div></div>';
      renderList(el.lastChild, { cur: null, refresh: draw, pick });
    };
    draw();
  };
})();

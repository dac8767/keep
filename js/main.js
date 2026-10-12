'use strict';
// Boot: sprites, map, renderer and the fixed-step game loop.
(function () {
  const $ = (id) => document.getElementById(id);
  const STEP = 0.05;
  let G = null, acc = 0, last = 0, started = false;

  function resize() {
    const c = $('game');
    c.width = innerWidth; c.height = innerHeight;
    if (K.Render.ctx) K.Render.ctx.imageSmoothingEnabled = false;
  }

  const ruler = () => (document.querySelector('input[name=ruler]:checked') || {}).value === 'queen' ? 'queen' : 'king';
  function newSeed() { return Math.floor(Math.random() * 1e6); }

  function start(seed, opts) {
    const ov = $('overlay');
    ov.classList.add('loading');
    ov.querySelector('h1').textContent = 'KEEP';
    ov.querySelector('.sub').textContent = 'Surveying the land…';
    setTimeout(() => {
      G = K.newGame(seed, opts);
      G.ruler = ruler();
      window.G = G;
      K.Render.init(G.world, $('game'));
      resize();
      K.Render.cam.zoom = 1;
      K.UI.init(G);
      K.Menu.init(G);
      K.UI.centerOn(G.world.start.x, G.world.start.y);
      ov.style.display = 'none';
      ov.classList.remove('loading');
      started = true;
      G.ended = false;
    }, 30);
  }

  function endScreen() {
    const ov = $('overlay');
    const won = G.phase === 'won';
    ov.querySelector('.card').innerHTML = `
      <h1>${won ? 'VICTORY' : 'DEFEAT'}</h1>
      <p class="sub">${won ? 'Ten sieges broken. Songs will be sung of your Keep.' : G.lossReason}</p>
      <p>Rounds survived: <b>${G.round}</b> · Enemies slain: <b>${G.stats.kills}</b> · Subjects lost: <b>${G.stats.lost}</b></p>
      ${won ? '<button class="big" id="btn-endless">Continue in endless mode</button> ' : ''}<button class="big" id="btn-again">Play again</button>`;
    ov.style.display = 'flex';
    $('btn-again').onclick = () => location.reload();
    if (won) $('btn-endless').onclick = () => { ov.style.display = 'none'; K.continueEndless(G); };
  }

  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000 || 0);
    last = t;
    if (!started) return;
    const sp = K.UI.speed;
    acc += dt * sp;
    let n = 0;
    while (acc >= STEP && n < 10) { K.update(G, STEP); acc -= STEP; n++; }
    if (n >= 10) acc = 0;
    K.UI.frame(dt);
    K.Render.draw(G, t / 1000);
    if ((G.phase === 'won' || G.phase === 'lost') && !G.ended) { G.ended = true; setTimeout(endScreen, 1500); }
  }

  addEventListener('resize', () => { resize(); if (started) K.UI.clampCam(); });
  addEventListener('load', () => {
    K.buildSprites();
    const q = new URLSearchParams(location.search);
    for (const img of document.querySelectorAll('#overlay img[data-icon]')) img.src = K.SPR.icon[img.dataset.icon];
    const saved = q.get('ruler') || localStorage.getItem('keep.ruler');
    if (saved === 'queen') document.querySelector('input[name=ruler][value=queen]').checked = true;
    for (const r of document.querySelectorAll('input[name=ruler]')) r.onchange = () => localStorage.setItem('keep.ruler', ruler());
    $('seed').value = q.get('seed') || newSeed();
    $('btn-reroll').onclick = () => { $('seed').value = newSeed(); };
    K.Menu.customUI(K.decodeOpts(q.get('opts')));
    $('btn-start').onclick = () => start(parseInt($('seed').value, 10) || newSeed(), K.Menu.customOpts());
    K.Menu.startList((s, o) => { $('seed').value = s; K.Menu.customUI(K.decodeOpts(o)); });
    if (q.has('autostart')) start(parseInt($('seed').value, 10), K.decodeOpts(q.get('opts')));
    requestAnimationFrame(loop);
  });
})();

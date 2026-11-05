/* ------------------------------------------------------------
   Saad's portfolio — "AI agents build the page" engine
   Every element with data-b="<type>" is a layer. Agents (cursors)
   pick layers from a shared queue, select them and build them.
   Layers inside [data-scope="hero"] build on load; other scopes
   build when they scroll into view.
------------------------------------------------------------ */
(() => {
  const root = document.documentElement;
  const body = document.body;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = () => innerWidth <= 720;

  const CREW = [
    ['layout', '#FF4D5E'], ['type', '#FFB020'], ['photo', '#3DDC97'], ['color', '#4EA8FF'],
    ['copy', '#C77DFF'], ['grid', '#FF6FB5'], ['motion', '#00D1FF'], ['icons', '#9EF01A'],
    ['a11y', '#FFD23F'], ['seo', '#7B61FF'], ['perf', '#2EC4B6'], ['qa', '#FF8A5B']
  ];
  const ARROW = c => `<svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M2 1.5v16.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5H15z" fill="${c}" stroke="#0b0b0b" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

  const $ = s => document.querySelector(s);
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* big outline word always fills the content width exactly */
  const word = document.querySelector('.hero-word');
  function fitWord() {
    if (!word) return;
    word.style.fontSize = '';
    const span = word.firstElementChild, base = parseFloat(getComputedStyle(word).fontSize);
    const avail = word.clientWidth, used = span.offsetWidth;
    if (used) word.style.fontSize = Math.min(base * avail / used * 0.995, 400) + 'px';
  }
  fitWord();
  if (document.fonts) document.fonts.ready.then(fitWord);
  addEventListener('resize', fitWord);

  const items = [...document.querySelectorAll('[data-b]')];
  const bar = $('.builder');
  const ui = { agents: $('#bAgents'), done: $('#bDone'), total: $('#bTotal'), prog: $('#bProg'), state: $('#bState'), skip: $('#bSkip'), replay: $('#bReplay') };

  let gen = 0;               // bumps on skip/replay so running steps stop
  let queue = [], agents = [], doneCount = 0, published = false, observer = null, wanderTimer = null;
  const wfLayer = mk('div', 'wf-layer'); const agentLayer = mk('div', 'agents-layer');
  body.append(wfLayer, agentLayer);

  const startClass = { text: 'b-pending', count: 'b-pending', wipe: 'b-wipe', fade: 'b-fade', photo: 'b-photo' };
  const docRect = el => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };

  /* ---------- reset every layer to "not built" ---------- */
  function arm() {
    items.forEach(el => {
      if (el._html != null) el.innerHTML = el._html;
      el._html = null;
      el.classList.remove('b-pending', 'b-wipe', 'b-fade', 'b-photo', 'b-run', 'b-run2', 'b-done');
      el.classList.add(startClass[el.dataset.b] || 'b-fade');
      el._state = 'pending';
    });
    root.classList.add('ready');
  }

  function finishAll() {
    items.forEach(el => {
      if (el._html != null) { el.innerHTML = el._html; el._html = null; }
      el.classList.remove('b-pending', 'b-wipe', 'b-fade', 'b-photo', 'b-run', 'b-run2');
      el.classList.add('b-done'); el._state = 'done';
      if (el._box) { el._box.remove(); el._box = null; }
    });
    wfLayer.querySelectorAll('.sel').forEach(s => s.remove());
  }

  /* ---------- wireframe placeholders ---------- */
  function placeBoxes() {
    items.forEach(el => {
      if (el._state !== 'pending') return;
      const r = docRect(el);
      if (!el._box) { el._box = mk('div', 'wf-box'); wfLayer.append(el._box); }
      Object.assign(el._box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    });
  }
  addEventListener('resize', () => { if (!published || queue.length) placeBoxes(); });

  /* ---------- agents ---------- */
  function spawnAgents() {
    agentLayer.innerHTML = '';
    const n = small() ? 6 : 10;
    agents = CREW.slice(0, n).map(([name, c], i) => {
      const el = mk('div', 'agent', ARROW(c) + `<span>${name}</span>`);
      el.style.setProperty('--c', c);
      agentLayer.append(el);
      // enter from the bottom edge, fanned out
      const a = { el, name, c, x: innerWidth * (0.15 + 0.7 * i / n) + scrollX, y: scrollY + innerHeight + 40, busy: false };
      el.style.transform = `translate(${a.x}px,${a.y}px)`;
      return a;
    });
    ui.agents.textContent = n;
    $('.b-dots').innerHTML = agents.slice(0, 5).map(a => `<i style="background:${a.c}"></i>`).join('');
  }

  function moveTo(a, x, y, dur) {
    const from = `translate(${a.x}px,${a.y}px)`, to = `translate(${x}px,${y}px)`;
    if (dur == null) dur = clamp(Math.hypot(x - a.x, y - a.y) * 0.75, 260, 750);
    a.x = x; a.y = y;
    const anim = a.el.animate([{ transform: from }, { transform: to }], { duration: dur, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'forwards' });
    a.el.style.transform = to;
    return anim.finished.catch(() => {});
  }

  /* ---------- builders per layer type ---------- */
  const builders = {
    async fade(el) { el.classList.add('b-run'); await wait(450); },
    async wipe(el) { el.style.setProperty('--d', (el.dataset.d || 800) + 'ms'); el.classList.add('b-run'); await wait(+(el.dataset.d || 800)); },
    async photo(el, a, g) {
      el.classList.add('b-run'); await wait(560); if (g !== gen) return;
      el.classList.add('b-run2'); await wait(700);
    },
    async count(el, a, g) {
      const dd = el.querySelector('dd'), to = +dd.dataset.to, suf = dd.dataset.suf || '';
      el.classList.remove('b-pending');
      const t0 = performance.now(), D = 650;
      await new Promise(res => {
        const tick = t => { if (g !== gen) return res();
          const p = clamp((t - t0) / D, 0, 1); dd.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + (p === 1 ? suf : '');
          p < 1 ? requestAnimationFrame(tick) : res(); };
        requestAnimationFrame(tick);
      });
    },
    async text(el, a, g) {
      el._html = el.innerHTML;
      const nodes = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) if (walk.currentNode.nodeValue.trim()) nodes.push(walk.currentNode);
      const parts = nodes.map(n => {
        const ty = document.createTextNode(''), tr = mk('span', 'tw-rest'); tr.textContent = n.nodeValue;
        n.parentNode.insertBefore(ty, n); n.parentNode.insertBefore(tr, n); n.remove();
        return { ty, tr, text: tr.textContent };
      });
      const caret = mk('span', 'tw-caret');
      el.classList.remove('b-pending');
      const total = parts.reduce((s, p) => s + p.text.length, 0);
      const D = clamp(total * 16, 380, 1500), r = docRect(el);
      moveTo(a, r.x + Math.min(r.w - 8, r.w * 0.85), r.y + r.h - 6, D);
      const t0 = performance.now();
      await new Promise(res => {
        const tick = t => {
          if (g !== gen) return res();
          let n = Math.floor(clamp((t - t0) / D, 0, 1) * total);
          for (const p of parts) {
            const k = Math.min(n, p.text.length); n -= k;
            if (p.ty.nodeValue.length !== k) { p.ty.nodeValue = p.text.slice(0, k); p.tr.textContent = p.text.slice(k); }
            if (k < p.text.length && caret.previousSibling !== p.ty) p.tr.before(caret);
          }
          (t - t0) < D ? requestAnimationFrame(tick) : res();
        };
        requestAnimationFrame(tick);
      });
      if (g === gen) { el.innerHTML = el._html; el._html = null; }
    }
  };

  /* ---------- one agent working one layer ---------- */
  async function work(a, el, g) {
    const r = docRect(el);
    a.el.classList.remove('idle');
    await moveTo(a, r.x + Math.min(28, r.w * 0.3) + rand(-4, 8), r.y + Math.min(r.h * 0.55, 26) + rand(-4, 6));
    if (g !== gen) return;
    const sel = mk('div', 'sel', `<i></i><b>${Math.round(r.w)} × ${Math.round(r.h)}</b>`);
    sel.style.setProperty('--c', a.c);
    Object.assign(sel.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    wfLayer.append(sel);
    await wait(small() ? 120 : 200);
    if (g !== gen) return sel.remove();
    if (el._box) { el._box.classList.add('out'); const b = el._box; el._box = null; setTimeout(() => b.remove(), 400); }
    // fade/wipe/photo keep their start class; adding b-run animates them
    await (builders[el.dataset.b] || builders.fade)(el, a, g);
    if (g !== gen) return sel.remove();
    sel.classList.add('out'); setTimeout(() => sel.remove(), 320);
    el._state = 'done'; el.classList.add('b-done');
    doneCount++; progress();
  }

  async function runAgent(a, g) {
    if (a.busy) return; a.busy = true;
    while (queue.length && g === gen) {
      const el = queue.shift();
      if (el._state !== 'pending') continue;
      el._state = 'building';
      await work(a, el, g);
    }
    a.busy = false;
    if (g !== gen) return;
    a.el.classList.add('idle');
    checkScopeDone();
  }

  function enqueue(list, g) {
    list.filter(el => el._state === 'pending' && !queue.includes(el)).forEach(el => queue.push(el));
    agents.forEach((a, i) => setTimeout(() => runAgent(a, g), i * 90));
  }

  /* ---------- progress / publish ---------- */
  function progress() {
    ui.done.textContent = doneCount;
    ui.prog.style.width = (doneCount / items.length * 100) + '%';
  }

  function checkScopeDone() {
    if (published) return;
    const heroLeft = items.some(el => el.closest('[data-scope="hero"]') && el._state !== 'done');
    if (!heroLeft && agents.every(a => !a.busy)) publish();
  }

  function publish() {
    if (published) return; published = true;
    body.classList.remove('draft');
    bar.classList.add('live');
    ui.state.textContent = 'Live'; ui.skip.hidden = true; ui.replay.hidden = false;
    // crew drifts off; three stay around and wander
    agents.forEach((a, i) => {
      if (i < 3 && !small()) { moveTo(a, rand(.1, .9) * innerWidth + scrollX, rand(.25, .8) * innerHeight + scrollY, 1400); a.el.classList.add('idle'); }
      else { moveTo(a, a.x + rand(-60, 60), scrollY + innerHeight + 60, 900).then(() => a.el.classList.add('gone')); }
    });
    clearInterval(wanderTimer);
    if (!small()) wanderTimer = setInterval(wander, 2600);
  }

  function wander() {
    if (document.hidden) return;
    agents.slice(0, 3).forEach(a => {
      if (a.busy || a.el.classList.contains('gone')) return;
      const x = clamp(a.x + rand(-220, 220), scrollX + 40, scrollX + innerWidth - 60);
      const y = clamp(a.y + rand(-140, 140), scrollY + 90, scrollY + innerHeight - 90);
      moveTo(a, x, y, rand(1200, 2000));
    });
  }

  /* ---------- scopes below the hero build on scroll ---------- */
  function watchScopes(g) {
    observer && observer.disconnect();
    const scopes = [...document.querySelectorAll('[data-scope]:not([data-scope="hero"])')];
    if (!scopes.length) return;
    observer = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting || g !== gen) return;
      observer.unobserve(en.target);
      agents.forEach(a => a.el.classList.remove('gone'));
      enqueue([...en.target.querySelectorAll('[data-b]')], g);
    }), { threshold: 0.18 });
    scopes.forEach(s => observer.observe(s));
  }

  /* ---------- controls ---------- */
  function skip() {
    gen++; queue = []; clearInterval(wanderTimer);
    observer && observer.disconnect();
    agents.forEach(a => { a.busy = false; a.el.classList.add('gone'); });
    finishAll(); doneCount = items.length; progress();
    published = false; publish();
    agents.forEach(a => a.el.classList.add('gone'));
  }

  async function start() {
    const g = ++gen;
    queue = []; doneCount = 0; published = false; clearInterval(wanderTimer);
    wfLayer.innerHTML = ''; items.forEach(el => { el._box = null; });
    arm();
    body.classList.add('draft');
    bar.hidden = false; bar.classList.remove('live');
    ui.state.textContent = 'Building'; ui.skip.hidden = false; ui.replay.hidden = true;
    ui.total.textContent = items.length; progress();
    await Promise.race([document.fonts ? document.fonts.ready : null, wait(1500)]);
    if (g !== gen) return;
    placeBoxes();
    spawnAgents();
    await wait(350);
    if (g !== gen) return;
    const hero = items.filter(el => el.closest('[data-scope="hero"]'));
    // build order follows reading order, with the big word first
    hero.sort((p, q) => (p.classList.contains('hero-word') ? -1 : 0) - (q.classList.contains('hero-word') ? -1 : 0));
    enqueue(hero, g);
    watchScopes(g);
  }

  ui.skip.addEventListener('click', skip);
  ui.replay.addEventListener('click', () => { scrollTo({ top: 0, behavior: 'instant' }); agents.forEach(a => a.el.classList.remove('gone')); start(); });

  if (reduce) { root.classList.add('ready'); body.classList.remove('draft'); bar.hidden = true; return; }
  start();
})();

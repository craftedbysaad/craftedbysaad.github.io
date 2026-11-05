/* ------------------------------------------------------------
   Saad's portfolio — "AI agents build the page"
   Every element with data-b="<type>" is a layer. A crew of agent
   cursors (steering physics, flocking, heading rotation) picks
   layers from a shared queue: flies there, drags a box out with a
   crosshair, then types / paints / drops the content in.
   Hero builds on load after a short "scanning" swarm; the other
   sections build as they scroll into view; the crew ends in a ring.
------------------------------------------------------------ */
(() => {
  const root = document.documentElement, body = document.body;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = () => innerWidth <= 720;
  const $ = s => document.querySelector(s);
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const docRect = el => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };

  /* ---------- big outline word always fills the content width ---------- */
  const word = $('.hero-word');
  function fitWord() {
    if (!word) return;
    word.style.fontSize = '';
    const span = word.firstElementChild, base = parseFloat(getComputedStyle(word).fontSize);
    if (span.offsetWidth) word.style.fontSize = Math.min(base * word.clientWidth / span.offsetWidth * 0.995, 400) + 'px';
  }
  fitWord();
  if (document.fonts) document.fonts.ready.then(fitWord);
  addEventListener('resize', fitWord);

  /* ---------- copy email ---------- */
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const txt = b.dataset.copy, label = b.textContent;
    try { await navigator.clipboard.writeText(txt); b.textContent = 'Copied'; }
    catch { location.href = 'mailto:' + txt; }
    setTimeout(() => { b.textContent = label; }, 1600);
  }));

  const items = [...document.querySelectorAll('[data-b]')];
  const bar = $('.builder');
  const ui = { agents: $('#bAgents'), done: $('#bDone'), total: $('#bTotal'), prog: $('#bProg'), state: $('#bState'), skip: $('#bSkip'), replay: $('#bReplay') };

  if (reduce) { root.classList.add('ready'); body.classList.remove('draft'); return; }

  /* ---------- crew ---------- */
  const CREW = [
    ['layout', '#FF6B78'], ['type', '#FFC15E'], ['photo', '#5BE3A6'], ['color', '#6BB6FF'],
    ['copy', '#D29BFF'], ['grid', '#FF8CC6'], ['motion', '#4FE0F0'], ['icons', '#B5F25A'],
    ['a11y', '#FFE066'], ['seo', '#9C8CFF']
  ];
  const SVG = {
    fly: c => `<svg class="s-fly" width="16" height="12" viewBox="0 0 16 12"><path d="M1.5 1.3 15 6 1.5 10.7 4.4 6z" fill="${c}" stroke="#0b0b0b" stroke-width="1" stroke-linejoin="round"/></svg>`,
    cross: c => `<svg class="s-cross" width="16" height="16" viewBox="0 0 16 16"><path d="M8 1.5v13M1.5 8h13" stroke="#0b0b0b" stroke-width="3.6" stroke-linecap="round"/><path d="M8 1.5v13M1.5 8h13" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    ibeam: c => `<svg class="s-ibeam" width="10" height="20" viewBox="0 0 10 20"><path d="M1.5 1.5h7M5 1.5v17M1.5 18.5h7" stroke="#0b0b0b" stroke-width="3.4" stroke-linecap="round"/><path d="M1.5 1.5h7M5 1.5v17M1.5 18.5h7" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    arrow: c => `<svg class="s-arrow" width="18" height="22" viewBox="0 0 18 22"><path d="M2 1.5v16.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5H15z" fill="${c}" stroke="#0b0b0b" stroke-width="1.4" stroke-linejoin="round"/></svg>`
  };

  const drawLayer = mk('div', 'fx-layer fx-draw'), agentLayer = mk('div', 'fx-layer fx-agents');
  body.append(drawLayer, agentLayer);

  let gen = 0, queue = [], agents = [], doneCount = 0, published = false, restMode = 'hover';
  let observers = [], timers = [];

  function spawnAgents() {
    agentLayer.querySelectorAll('.agent').forEach(e => e.remove());
    const n = small() ? 6 : 10;
    agents = CREW.slice(0, n).map(([name, c], i) => {
      const el = mk('div', 'agent', SVG.fly(c) + SVG.cross(c) + SVG.ibeam(c) + SVG.arrow(c) + `<span class="tag">${name}</span>`);
      el.style.setProperty('--c', c);
      agentLayer.append(el);
      return { el, fly: el.querySelector('.s-fly'), name, c, i, x: 0, y: 0, vx: 0, vy: 0, ang: 0, mode: 'fly',
        tgt: null, lock: null, onArrive: null, near: null, busy: false, speedK: 1,
        phase: rand(0, Math.PI * 2), wf: rand(1.3, 2.6), group: i % 4 };
    });
    agents.forEach(a => setMode(a, 'fly'));
    ui.agents.textContent = n;
    $('.b-dots').innerHTML = agents.slice(0, 5).map(a => `<i style="background:${a.c}"></i>`).join('');
  }
  function setMode(a, m) { if (a.mode !== m || a.el.dataset.m !== m) { a.mode = m; a.el.dataset.m = m; } }

  /* ---------- physics: arrive + wander + separation, heading follows velocity ---------- */
  let last = performance.now(), simT = 0;
  function step(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now; simT += dt;
    if (!document.hidden) {
      const MAX = small() ? 1150 : 1500, ACC = small() ? 5200 : 6500, SLOW = 150;
      for (const a of agents) {
        if (a.lock) {
          const k = 1 - Math.exp(-dt * 30);
          const nx = a.x + (a.lock.x - a.x) * k, ny = a.y + (a.lock.y - a.y) * k;
          a.vx = (nx - a.x) / dt; a.vy = (ny - a.y) / dt; a.x = nx; a.y = ny;
        } else if (a.tgt) {
          const T = typeof a.tgt === 'function' ? a.tgt(simT, a) : a.tgt;
          const dx = T.x - a.x, dy = T.y - a.y, d = Math.hypot(dx, dy) || 0.001;
          const max = MAX * a.speedK;
          const sp = T.keep ? Math.min(max, d * 7 + 120) : (d < SLOW ? max * d / SLOW : max);
          // steer toward the desired velocity, with a capped acceleration (no instant turns)
          let ax = (dx / d * sp - a.vx) * 8, ay = (dy / d * sp - a.vy) * 8;
          const am = Math.hypot(ax, ay), lim = ACC * a.speedK;
          if (am > lim) { ax = ax / am * lim; ay = ay / am * lim; }
          if (d > 70) { // curvy, bird-like flight
            const w = Math.sin(simT * a.wf + a.phase) * 1800 * a.speedK;
            ax += -dy / d * w; ay += dx / d * w;
          }
          for (const b of agents) { // keep a little personal space
            if (b === a || b.lock) continue;
            const sx = a.x - b.x, sy = a.y - b.y, sd = Math.hypot(sx, sy);
            if (sd > 0 && sd < 18) { ax += sx / sd * (18 - sd) * 260; ay += sy / sd * (18 - sd) * 260; }
          }
          a.vx += ax * dt; a.vy += ay * dt;
          const s = Math.hypot(a.vx, a.vy);
          if (s > max) { a.vx *= max / s; a.vy *= max / s; }
          a.x += a.vx * dt; a.y += a.vy * dt;
          if (a.near && d < a.near.r) { const f = a.near.fn; a.near = null; f(); }
          if (a.onArrive && d < 3 && Math.hypot(a.vx, a.vy) < 70) {
            a.x = T.x; a.y = T.y; a.vx = a.vy = 0; const f = a.onArrive; a.onArrive = null; f();
          }
        }
        const s = Math.hypot(a.vx, a.vy);
        if (s > 25) {
          const ta = Math.atan2(a.vy, a.vx);
          let df = ta - a.ang; df = Math.atan2(Math.sin(df), Math.cos(df));
          a.ang += df * Math.min(1, dt * 14);
        }
        a.el.style.transform = `translate3d(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px,0)`;
        if (a.mode === 'fly') a.fly.style.transform = `rotate(${a.ang.toFixed(3)}rad)`;
        if (restMode === 'away' && !a.busy && a.y > scrollY + innerHeight + 10) a.el.classList.add('gone');
      }
    }
    requestAnimationFrame(step);
  }

  function flyTo(a, x, y, nearMode) {
    return new Promise(res => {
      a.lock = null; a.speedK = 1; setMode(a, 'fly'); a.el.classList.remove('gone');
      a.tgt = { x, y };
      a.near = nearMode ? { r: 46, fn: () => setMode(a, nearMode) } : null;
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      a.onArrive = fin;
      setTimeout(() => { if (!done) { a.x = x; a.y = y; a.vx = a.vy = 0; a.onArrive = null; fin(); } }, 2600);
    });
  }

  function drive(D, g, fn) {
    return new Promise(res => {
      const t0 = performance.now();
      const tick = t => { if (g !== gen) return res(); const p = clamp((t - t0) / D, 0, 1); fn(p); p < 1 ? requestAnimationFrame(tick) : res(); };
      requestAnimationFrame(tick);
    });
  }
  const ease = p => 1 - Math.pow(1 - p, 3);
  const inOut = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

  /* ---------- rest behaviours: hover, idle flock, ring, away ---------- */
  const footMark = $('.foot-mark');
  function restTarget(t, a) {
    if (restMode === 'ring' && footMark) {
      const r = docRect(footMark), R = small() ? 52 : 64;
      const ang = a.i / agents.length * Math.PI * 2 + t * 1.5;
      return { x: r.x + r.w / 2 + Math.cos(ang) * R * 1.25, y: r.y + r.h / 2 + Math.sin(ang) * R, keep: true };
    }
    if (restMode === 'idle') {
      const Lx = scrollX + innerWidth - Math.max(70, (innerWidth - 1320) / 2 + 10) + Math.sin(t * 0.33) * 18;
      const Ly = scrollY + innerHeight * (0.5 + 0.26 * Math.sin(t * 0.21));
      const ang = t * 0.6 + a.phase, R = 22 + (a.i % 4) * 12;
      return { x: Lx + Math.cos(ang) * R, y: Ly + Math.sin(ang) * R * 0.8, keep: true };
    }
    if (restMode === 'away') return { x: a.x + (a.i - agents.length / 2) * 8, y: scrollY + innerHeight + 80 };
    // hover: small lazy circle where it finished
    const ang = t * 1.2 + a.phase;
    return { x: a.hx + Math.cos(ang) * 14, y: a.hy + Math.sin(ang) * 10, keep: true };
  }
  function rest(a) {
    a.lock = null; a.onArrive = null; a.near = null; setMode(a, 'fly');
    a.hx = a.x; a.hy = a.y;
    a.speedK = restMode === 'ring' ? 0.9 : restMode === 'idle' ? 0.35 : restMode === 'away' ? 0.8 : 0.3;
    a.tgt = restTarget;
  }
  function setRest(mode) {
    restMode = mode;
    agents.forEach(a => { if (!a.busy) { if (mode !== 'away') a.el.classList.remove('gone'); rest(a); } });
  }
  const calmMode = () => small() ? 'away' : 'idle';

  /* ---------- layer states ---------- */
  const startClass = { text: 'b-pending', count: 'b-pending', wipe: 'b-wipe', fade: 'b-fade', card: 'b-card', photo: 'b-photo' };
  const ALL = ['b-pending', 'b-wipe', 'b-fade', 'b-card', 'b-photo', 'b-run', 'b-run2', 'b-done'];
  function arm() {
    items.forEach(el => {
      if (el._html != null) el.innerHTML = el._html;
      el._html = null; el._draw = null;
      el.classList.remove(...ALL);
      el.classList.add(startClass[el.dataset.b] || 'b-fade');
      el._state = 'pending';
    });
    root.classList.add('ready');
  }
  function finishEl(el) {
    if (el._state === 'done') return;
    if (el._html != null) { el.innerHTML = el._html; el._html = null; }
    el.classList.remove(...ALL); el.classList.add('b-done');
    if (el._draw) { el._draw.remove(); el._draw = null; }
    el._state = 'done'; doneCount++; progress();
  }
  function progress() {
    ui.done.textContent = Math.min(doneCount, items.length);
    ui.prog.style.width = (Math.min(doneCount, items.length) / items.length * 100) + '%';
  }

  /* ---------- content builders ---------- */
  const builders = {
    async text(el, a, g, r, K) {
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
      setMode(a, 'ibeam');
      const total = parts.reduce((s, p) => s + p.text.length, 0);
      await drive(clamp(total * 15, 360, 1500) * K, g, p => {
        let n = Math.floor(p * total);
        for (const q of parts) {
          const k = Math.min(n, q.text.length); n -= k;
          if (q.ty.nodeValue.length !== k) { q.ty.nodeValue = q.text.slice(0, k); q.tr.textContent = q.text.slice(k); }
          if (k < q.text.length && caret.previousSibling !== q.ty) q.tr.before(caret);
        }
        if (caret.isConnected) { const c = caret.getBoundingClientRect(); a.lock = { x: c.left + scrollX + 3, y: c.top + scrollY + c.height / 2 }; }
      });
      if (g === gen && el._html != null) { el.innerHTML = el._html; el._html = null; }
    },
    async wipe(el, a, g, r, K) {
      const D = +(el.dataset.d || 800) * K;
      el.style.setProperty('--d', D + 'ms'); el.classList.add('b-run');
      setMode(a, 'arrow');
      await drive(D, g, p => { const e = 1 - Math.pow(1 - p, 2.2); a.lock = { x: r.x + r.w * e, y: r.y + r.h * 0.55 }; });
    },
    async photo(el, a, g, r, K) {
      setMode(a, 'arrow'); el.classList.add('b-run');
      await drive(560 * K, g, p => { a.lock = { x: r.x + r.w * 0.5, y: r.y + r.h * (1 - inOut(p)) }; });
      if (g !== gen) return;
      el.classList.add('b-run2');
      await drive(700 * K, g, p => { a.lock = { x: r.x + r.w * (0.5 + 0.18 * Math.sin(p * 5)), y: r.y + r.h * (0.12 + 0.1 * p) }; });
    },
    async count(el, a, g, r, K) {
      const dd = el.querySelector('dd'), to = +dd.dataset.to, suf = dd.dataset.suf || '';
      el.classList.remove('b-pending'); setMode(a, 'arrow');
      await drive(650 * K, g, p => { const e = ease(p); dd.textContent = Math.round(to * e) + (p === 1 ? suf : ''); a.lock = { x: r.x + r.w * (0.3 + 0.4 * e), y: r.y + r.h * 0.4 }; });
    },
    async fade(el, a, g, r, K) {
      setMode(a, 'arrow'); el.classList.add('b-run');
      await drive(450 * K, g, p => { const e = ease(p); a.lock = { x: r.x + r.w * (1 - 0.45 * e), y: r.y + r.h * (1 - 0.4 * e) }; });
    },
    async card(el, a, g, r, K) {
      setMode(a, 'arrow'); el.classList.add('b-run');
      await drive(650 * K, g, p => { const e = inOut(p); a.lock = { x: r.x + r.w * (1 - 0.5 * e), y: r.y + r.h * (1 - 0.55 * e) }; });
    }
  };

  /* ---------- one agent builds one layer ---------- */
  async function work(a, el, g) {
    const K = el.closest('[data-scope="hero"]') ? 1 : 0.8;
    let r = docRect(el);
    await flyTo(a, r.x, r.y, 'cross');
    if (g !== gen || el._state === 'done') return;
    r = docRect(el); // layout may have settled while flying
    setMode(a, 'cross');
    const d = mk('div', 'draw' + (r.w < 90 || r.h < 22 ? ' small' : ''), '<div class="fill"></div><div class="frame"><i></i><i></i><i></i><i></i></div><b></b>');
    d.style.setProperty('--c', a.c);
    Object.assign(d.style, { left: r.x + 'px', top: r.y + 'px', width: '0px', height: '0px' });
    drawLayer.append(d); el._draw = d;
    const label = d.querySelector('b');
    await drive(clamp(200 + (r.w + r.h) * 0.3, 280, 650) * K, g, p => {
      const e = ease(p), w = r.w * e, h = r.h * e;
      d.style.width = w + 'px'; d.style.height = h + 'px';
      label.textContent = `${Math.round(w)} × ${Math.round(h)}`;
      a.lock = { x: r.x + w, y: r.y + h };
    });
    if (g !== gen || el._state === 'done') return;
    d.classList.add('fill-off');
    await (builders[el.dataset.b] || builders.fade)(el, a, g, r, K);
    if (g !== gen) return;
    d.classList.add('out'); setTimeout(() => d.remove(), 380); el._draw = null;
    if (el._state !== 'done') { el.classList.add('b-done'); el._state = 'done'; doneCount++; progress(); }
    a.lock = null;
  }

  async function runAgent(a, g) {
    if (a.busy) return;
    a.busy = true;
    while (queue.length && g === gen) {
      const el = queue.shift();
      if (el._state !== 'pending') continue;
      el._state = 'building';
      await work(a, el, g);
    }
    if (g !== gen) return;
    a.busy = false;
    rest(a);
    afterWork();
  }
  function enqueue(list, g) {
    list.filter(el => el._state === 'pending' && !queue.includes(el)).forEach(el => queue.push(el));
    agents.forEach((a, i) => setTimeout(() => { if (g === gen) runAgent(a, g); }, i * 70));
  }
  function afterWork() {
    if (!published) {
      const heroLeft = items.some(el => el.closest('[data-scope="hero"]') && el._state !== 'done');
      if (!heroLeft && agents.every(x => !x.busy)) publish();
      return;
    }
    if (agents.every(x => !x.busy) && !queue.length) setRest(footVisible ? 'ring' : calmMode());
  }

  /* ---------- publish ---------- */
  function publish() {
    if (published) return; published = true;
    body.classList.remove('draft');
    bar.classList.add('live');
    ui.state.textContent = 'Live'; ui.skip.hidden = true; ui.replay.hidden = false;
    setRest(footVisible ? 'ring' : calmMode());
  }

  /* ---------- scroll-triggered scopes + finale ring ---------- */
  let footVisible = false;
  function watch(g) {
    observers.forEach(o => o.disconnect()); observers = [];
    const scopes = [...document.querySelectorAll('[data-scope]:not([data-scope="hero"])')];
    const so = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting || g !== gen) return;
      so.unobserve(en.target);
      const list = [...en.target.querySelectorAll('[data-b]')];
      enqueue(list, g);
      // never leave a visitor staring at an empty section
      timers.push(setTimeout(() => { if (g !== gen) return; list.forEach(el => { if (el._state !== 'done') { queue = queue.filter(q => q !== el); finishEl(el); } }); }, 7000));
    }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    scopes.forEach(s => so.observe(s));
    const fo = new IntersectionObserver(([en]) => {
      footVisible = en.isIntersecting;
      if (!published || g !== gen) return;
      if (agents.every(x => !x.busy) && !queue.length) setRest(footVisible ? 'ring' : calmMode());
    }, { threshold: 0.6 });
    if (footMark) fo.observe(footMark);
    observers.push(so, fo);
  }

  /* ---------- intro: scanning swarm, then burst ---------- */
  async function intro(g) {
    const cx = scrollX + innerWidth / 2, cy = scrollY + innerHeight * 0.45;
    const scan = mk('div', 'scan', 'S'); scan.style.left = cx + 'px'; scan.style.top = cy + 'px';
    agentLayer.append(scan);
    const far = Math.max(innerWidth, innerHeight) * 0.65;
    agents.forEach(a => {
      const base = a.group * Math.PI / 2 + 0.6;
      a.x = cx + Math.cos(base) * far + rand(-30, 30); a.y = cy + Math.sin(base) * far * 0.8 + rand(-30, 30);
      a.vx = -Math.cos(base) * 500; a.vy = -Math.sin(base) * 500; a.ang = Math.atan2(a.vy, a.vx);
      a.lock = null; a.busy = false; a.speedK = 0.85; setMode(a, 'fly'); a.el.classList.remove('gone');
      const off = a.group * Math.PI / 2 + (Math.floor(a.i / 4)) * 0.32, R = 62 + (a.i % 3) * 9;
      a.tgt = t => ({ x: cx + Math.cos(off + t * 2.1) * R * 1.2, y: cy + Math.sin(off + t * 2.1) * R, keep: true });
    });
    await wait(small() ? 1500 : 1900);
    if (g !== gen) { scan.remove(); return; }
    scan.classList.add('out'); setTimeout(() => scan.remove(), 450);
    agents.forEach(a => { const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy) || 1; a.vx = dx / d * 900; a.vy = dy / d * 900; });
  }

  /* ---------- controls ---------- */
  function skip() {
    gen++; queue = [];
    timers.forEach(clearTimeout); timers = [];
    agentLayer.querySelectorAll('.scan').forEach(s => s.remove());
    agents.forEach(a => { a.busy = false; a.lock = null; });
    items.forEach(finishEl); drawLayer.innerHTML = '';
    doneCount = items.length; progress();
    published = false; publish();
    watch(gen);
  }

  async function start() {
    const g = ++gen;
    queue = []; doneCount = 0; published = false;
    timers.forEach(clearTimeout); timers = [];
    drawLayer.innerHTML = '';
    arm();
    body.classList.add('draft');
    bar.hidden = false; bar.classList.remove('live');
    ui.state.textContent = 'Scanning page…'; ui.skip.hidden = false; ui.replay.hidden = true;
    ui.total.textContent = items.length; progress();
    await Promise.race([document.fonts ? document.fonts.ready : null, wait(1500)]);
    if (g !== gen) return;
    fitWord();
    if (!agents.length || agents.length !== (small() ? 6 : 10)) spawnAgents();
    restMode = 'hover';
    await intro(g);
    if (g !== gen) return;
    ui.state.textContent = 'Building';
    enqueue(items.filter(el => el.closest('[data-scope="hero"]')), g);
    timers.push(setTimeout(() => { if (g === gen && !published) skip(); }, 14000));
    watch(g);
  }

  ui.skip.addEventListener('click', skip);
  ui.replay.addEventListener('click', () => { scrollTo({ top: 0, behavior: 'instant' }); start(); });

  requestAnimationFrame(t => { last = t; requestAnimationFrame(step); });
  start();
})();

/* Orbit Dodge: a one-button arcade game. A Brainstorming Games original. */
(function () {
  'use strict';
  var BG = window.BG;
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var panel = document.getElementById('panel');
  var el = function (id) { return document.getElementById(id); };
  var W = 0, H = 0, R = 0, dpr = 1;
  var angle = 0, dir = 1, speed = 2.1, sparks = [], dot = null, score = 0, best = 0, playing = false, last = 0, spawnIn = 0, elapsed = 0, rounds = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.32;
  }
  function placeDot() {
    // Never right on top of the player.
    dot = angle + Math.PI * (0.5 + Math.random());
  }
  function reset() {
    angle = -Math.PI / 2; dir = 1; speed = 2.1; sparks = []; score = 0; spawnIn = 0.9; elapsed = 0;
    placeDot();
    el('score').textContent = '0';
  }
  function flip() {
    if (playing) dir = -dir;
  }
  function spawn() {
    // A spark flies out from the core along a ray and crosses the orbit once.
    var a = Math.random() * Math.PI * 2;
    sparks.push({ a: a, r: 0, v: R * (0.42 + Math.min(elapsed / 60, 1) * 0.5) });
  }
  function norm(a) {
    a = a % (Math.PI * 2);
    return a < 0 ? a + Math.PI * 2 : a;
  }
  function near(a, b, limit) {
    var d = Math.abs(norm(a) - norm(b));
    return Math.min(d, Math.PI * 2 - d) < limit;
  }
  function step(dt) {
    elapsed += dt;
    speed = 2.1 + Math.min(elapsed / 45, 1) * 1.6;
    angle += dir * speed * dt;
    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawn();
      spawnIn = Math.max(0.32, 0.95 - elapsed / 70);
    }
    var hitArc = 13 / R;
    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.r += s.v * dt;
      if (Math.abs(s.r - R) < 11 && near(s.a, angle, hitArc)) return end();
      if (s.r > Math.max(W, H)) sparks.splice(i, 1);
    }
    if (near(dot, angle, 16 / R)) {
      score += 10;
      el('score').textContent = score;
      placeDot();
    }
  }
  function draw() {
    var cx = W / 2, cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#2a2c33'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#25272d';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff7a59';
    sparks.forEach(function (s) {
      ctx.beginPath(); ctx.arc(cx + Math.cos(s.a) * s.r, cy + Math.sin(s.a) * s.r, 7, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#00c0f0';
    ctx.beginPath(); ctx.arc(cx + Math.cos(dot) * R, cy + Math.sin(dot) * R, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6fe3ff';
    ctx.beginPath(); ctx.arc(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R, 11, 0, Math.PI * 2); ctx.fill();
  }
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (playing) step(dt);
    draw();
    requestAnimationFrame(frame);
  }
  function start() {
    reset();
    panel.hidden = true;
    playing = true;
    if (BG) BG.game.gameplayStart();
  }
  function end() {
    playing = false;
    rounds++;
    if (BG) BG.game.gameplayStop();
    var record = score > best;
    if (record) {
      best = score;
      el('best').textContent = best;
      if (BG) BG.data.set('best', best).catch(function () {});
    }
    if (BG) {
      BG.leaderboard.submit('score', score).catch(function () {});
      if (record && score > 0 && BG.game.celebrate) BG.game.celebrate();
    }
    el('panel-title').textContent = record && score > 0 ? 'New best: ' + score : 'Score ' + score;
    el('panel-text').textContent = 'A spark got you. Switch direction earlier and keep collecting.';
    el('start').textContent = 'Play again';
    panel.hidden = false;
  }

  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', flip);
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      if (playing) flip();
      else if (!panel.hidden) el('start').click();
    }
  });
  el('start').addEventListener('click', function () {
    if (BG && rounds > 0 && rounds % 3 === 0) BG.ad.midgame().then(start, start);
    else start();
  });
  // The game pauses itself when the tab is hidden, so playtime stays honest.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && playing) end();
  });

  resize();
  reset();
  last = performance.now();
  requestAnimationFrame(frame);

  // A click anywhere on the title panel starts the game too, not only on the button.
  panel.addEventListener('click', function (e) {
    if (e.target !== el('start')) el('start').click();
  });

  if (!BG) return;
  // The SDK only listens after init, so loading is reported from there.
  BG.init()
    .then(function () { BG.game.loadingStart(); return BG.data.get('best'); })
    .then(function (saved) {
      if (typeof saved === 'number') { best = saved; el('best').textContent = saved; }
    })
    .catch(function () {})
    .then(function () { BG.game.loadingStop(); });
})();

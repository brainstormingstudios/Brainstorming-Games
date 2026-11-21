/*
 * Star Catcher: the Brainstorming Games starter kit.
 *
 * A complete little game that uses every part of the SDK the right way. Change the drawing and
 * the rules; keep the SDK calls where they are and your game passes the automatic checks for
 * Full Launch. Every SDK call is marked with "SDK:".
 *
 * Controls: move with the mouse, touch, or the arrow keys / A and D.
 */
(function () {
  'use strict';

  var BG = window.BG || null; // SDK: null only if bg-sdk.js is missing (the game still runs).
  var ROUND_SECONDS = 45;
  var BOARD = 'main'; // SDK: leaderboard key. Ask us to create it (or use any key: we create it on first score).

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };
  var hud = { score: $('score'), best: $('best'), time: $('time') };
  var panel = $('panel');

  var W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  var state = {
    playing: false,
    score: 0,
    best: 0,
    timeLeft: ROUND_SECONDS,
    paddle: { x: W / 2, w: 120 },
    stars: [],
    sparks: [],
    spawnIn: 0,
    usedExtraTime: false,
    muted: false,
  };

  // ---- Input ----------------------------------------------------------------------------------
  var keys = {};
  window.addEventListener('keydown', function (e) { keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  function pointTo(x) { state.paddle.x = Math.max(state.paddle.w / 2, Math.min(W - state.paddle.w / 2, x)); }
  canvas.addEventListener('pointermove', function (e) { pointTo(e.clientX); });
  canvas.addEventListener('pointerdown', function (e) { pointTo(e.clientX); });

  // ---- Saves: in the cloud for signed-in players, on the device for guests ----------------------
  function loadBest() {
    if (!BG) return Promise.resolve(Number(localStorage.getItem('star-catcher-best')) || 0);
    return BG.data.get('best').then(function (v) { return Number(v) || 0; }).catch(function () { return 0; }); // SDK: cloud save
  }
  function saveBest(value) {
    if (!BG) return localStorage.setItem('star-catcher-best', String(value));
    BG.data.set('best', value).catch(function () {}); // SDK: cloud save
  }

  // ---- Game flow ---------------------------------------------------------------------------------
  function startRound(keepScore) {
    if (!keepScore) {
      state.score = 0;
      state.timeLeft = ROUND_SECONDS;
      state.usedExtraTime = false;
      state.stars = [];
    }
    state.playing = true;
    panel.hidden = true;
    if (BG) BG.game.gameplayStart(); // SDK: the player is playing (drives playtime and ad timing)
  }

  function endRound() {
    state.playing = false;
    if (BG) BG.game.gameplayStop(); // SDK: menus and game-over screens are not gameplay
    var newBest = state.score > state.best;
    if (newBest) {
      state.best = state.score;
      saveBest(state.best);
      if (BG) BG.game.celebrate(); // SDK: a big moment: the mascot pops in with confetti
    }
    if (BG) BG.leaderboard.submit(BOARD, state.score); // SDK: checked on the server; guests are ignored
    $('panel-title').textContent = newBest ? 'New best!' : "Time's up!";
    $('panel-text').textContent = 'You caught ' + state.score + (state.score === 1 ? ' star.' : ' stars.');
    $('more-time').hidden = state.usedExtraTime || !BG;
    panel.hidden = false;
    renderHud();
  }

  $('again').addEventListener('click', function () {
    // SDK: a break ad between rounds. The platform decides if one shows (never in the first
    // minute, at most every 3 minutes, never during Basic Launch). Pause your sound while it plays.
    if (!BG) return startRound(false);
    BG.ad.midgame({ onStart: function () { state.muted = true; }, onFinish: function () { state.muted = false; } })
      .then(function () { startRound(false); });
  });

  $('more-time').addEventListener('click', function () {
    // SDK: an ad the player chose to watch. Only reward when `rewarded` is true.
    BG.ad.rewarded({ onStart: function () { state.muted = true; } }).then(function (r) {
      state.muted = false;
      if (r.rewarded) {
        state.usedExtraTime = true;
        state.timeLeft = 10;
        startRound(true);
      } else {
        $('more-time').hidden = true;
      }
    });
  });

  // ---- Simulation --------------------------------------------------------------------------------
  function spawnStar() {
    var big = Math.random() < 0.12;
    state.stars.push({ x: 20 + Math.random() * (W - 40), y: -20, r: big ? 16 : 10, vy: 120 + Math.random() * 140 + (ROUND_SECONDS - state.timeLeft) * 4, points: big ? 5 : 1, spin: Math.random() * 6 });
  }

  function update(dt) {
    var speed = 600;
    if (keys.arrowleft || keys.a) pointTo(state.paddle.x - speed * dt);
    if (keys.arrowright || keys.d) pointTo(state.paddle.x + speed * dt);
    if (!state.playing) return;
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    state.spawnIn -= dt;
    if (state.spawnIn <= 0) {
      spawnStar();
      state.spawnIn = Math.max(0.18, 0.6 - (ROUND_SECONDS - state.timeLeft) * 0.008);
    }
    var paddleY = H - 48;
    for (var i = state.stars.length - 1; i >= 0; i--) {
      var s = state.stars[i];
      s.y += s.vy * dt;
      s.spin += dt * 3;
      var caught = s.y + s.r >= paddleY && s.y - s.r <= paddleY + 14 && Math.abs(s.x - state.paddle.x) <= state.paddle.w / 2 + s.r;
      if (caught) {
        state.score += s.points;
        for (var k = 0; k < 8; k++) state.sparks.push({ x: s.x, y: paddleY, vx: (Math.random() - 0.5) * 300, vy: -Math.random() * 260, life: 0.5 });
        state.stars.splice(i, 1);
      } else if (s.y - s.r > H) {
        state.stars.splice(i, 1);
      }
    }
    for (var j = state.sparks.length - 1; j >= 0; j--) {
      var p = state.sparks[j];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
      p.life -= dt;
      if (p.life <= 0) state.sparks.splice(j, 1);
    }
    if (state.timeLeft <= 0) endRound();
  }

  // ---- Drawing -----------------------------------------------------------------------------------
  function star(x, y, r, rot) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = rot + (i * Math.PI) / 5;
      var rr = i % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function draw() {
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1b1d22';
    for (var i = 0; i < 40; i++) ctx.fillRect((i * 97) % W, (i * 53 + Date.now() / 40) % H, 2, 2);
    for (var s = 0; s < state.stars.length; s++) {
      var st = state.stars[s];
      ctx.fillStyle = st.points > 1 ? '#ffd166' : '#6fe3ff';
      star(st.x, st.y, st.r, st.spin);
    }
    ctx.fillStyle = '#ffffff';
    for (var p = 0; p < state.sparks.length; p++) ctx.fillRect(state.sparks[p].x, state.sparks[p].y, 3, 3);
    ctx.fillStyle = '#00c0f0';
    var paddleY = H - 48;
    ctx.beginPath();
    ctx.roundRect(state.paddle.x - state.paddle.w / 2, paddleY, state.paddle.w, 14, 7);
    ctx.fill();
  }

  function renderHud() {
    hud.score.textContent = String(state.score);
    hud.best.textContent = String(Math.max(state.best, state.score));
    hud.time.textContent = String(Math.ceil(state.timeLeft));
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    renderHud();
    requestAnimationFrame(frame);
  }

  // ---- Start-up: the order matters ----------------------------------------------------------------
  // SDK: init first, then loadingStart / loadingStop around your asset loading, then gameplayStart.
  var ready = BG ? BG.init().catch(function () {}) : Promise.resolve();
  ready
    .then(function () {
      if (BG) BG.game.loadingStart(); // SDK: loading began
      return loadBest(); // a real game loads images, sounds and levels here
    })
    .then(function (best) {
      state.best = best;
      if (BG) BG.game.loadingStop(); // SDK: loading finished (your load-time KPI)
      requestAnimationFrame(frame);
      startRound(false); // gameplay starts right away: no "press start" screen keeps load times honest
    });
})();

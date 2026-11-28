/*
 * BS Kit: the shared toolkit for BS Originals.
 * Drawing (neon glow sprites), the game loop with hit-stop and slow motion, keyboard, mouse and
 * touch input (a floating thumb-stick), camera shake, particles, floating text, sounds made in the
 * browser, and a safe wrapper around the Brainstorming SDK.
 *
 * Every game loads it from its own folder as `bs-kit.js` (added when the game is served or packed).
 * No requests to other domains, no eval.
 */
(function () {
  'use strict';

  // ---------- Maths ----------
  var M = {
    TAU: Math.PI * 2,
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (list) { return list[Math.floor(Math.random() * list.length)]; },
    dist2: function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; },
    dist: function (ax, ay, bx, by) { return Math.sqrt(M.dist2(ax, ay, bx, by)); },
    angle: function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },
    shuffle: function (list) {
      for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = list[i]; list[i] = list[j]; list[j] = t; }
      return list;
    },
    /** Removes item i quickly by moving the last item into its place (order does not matter). */
    swapRemove: function (list, i) { var last = list.pop(); if (i < list.length) list[i] = last; },
  };

  // ---------- Stage ----------
  function createStage(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d', { alpha: false });
    var stage = { canvas: canvas, ctx: ctx, W: 0, H: 0, dpr: 1, scale: 1 };
    function resize() {
      stage.dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
      stage.W = window.innerWidth;
      stage.H = window.innerHeight;
      canvas.width = Math.round(stage.W * stage.dpr);
      canvas.height = Math.round(stage.H * stage.dpr);
      // `scale` keeps the world a similar size on phones and big screens.
      stage.scale = M.clamp(Math.min(stage.W, stage.H) / (opts.designSize || 720), 0.55, 1.4);
      if (stage.onResize) stage.onResize();
    }
    window.addEventListener('resize', resize);
    resize();
    stage.resize = resize;
    return stage;
  }

  // ---------- Neon glow sprites ----------
  var glowCache = {};
  /** A soft round glow, drawn once and reused. Drawing with 'lighter' makes colours add up. */
  function glowSprite(color, radius) {
    var r = Math.max(2, Math.round(radius));
    var key = color + '|' + r;
    var c = glowCache[key];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = r * 2;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, color);
    grad.addColorStop(0.25, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.globalAlpha = 1;
    g.fillRect(0, 0, r * 2, r * 2);
    glowCache[key] = c;
    return c;
  }
  function drawGlow(ctx, x, y, color, radius, alpha) {
    var s = glowSprite(color, radius);
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.drawImage(s, x - s.width / 2, y - s.height / 2);
    if (alpha != null) ctx.globalAlpha = 1;
  }
  /** A colour with an alpha, from a #rrggbb string. */
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // ---------- Loop ----------
  /**
   * Runs update(dt) and render() every frame. `loop.timeScale` gives slow motion; `loop.hitStop(s)`
   * freezes the action for a moment so big hits feel heavy.
   */
  function createLoop(update, render) {
    var loop = { timeScale: 1, running: true, time: 0, fps: 60 };
    var last = performance.now(), stopFor = 0, slowFor = 0, slowTo = 1, frames = 0, fpsClock = 0;
    loop.hitStop = function (s) { stopFor = Math.max(stopFor, s); };
    loop.slowMo = function (s, scale) { slowFor = s; slowTo = scale; };
    function frame(now) {
      var real = Math.min((now - last) / 1000, 0.05);
      last = now;
      frames++; fpsClock += real;
      if (fpsClock >= 1) { loop.fps = frames / fpsClock; frames = 0; fpsClock = 0; }
      var dt = real;
      if (slowFor > 0) { slowFor -= real; dt *= slowTo; }
      if (stopFor > 0) { stopFor -= real; dt = 0; }
      dt *= loop.timeScale;
      if (loop.running) { loop.time += dt; update(dt, real); }
      render(real);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return loop;
  }

  // ---------- Input ----------
  /**
   * Keyboard, mouse and touch. `input.move()` gives a direction {x, y} of length 0..1 from WASD,
   * the arrow keys or the floating thumb-stick (touch anywhere on the left 60% of the screen, or
   * anywhere when `wholeScreenStick` is set).
   */
  function createInput(canvas, opts) {
    opts = opts || {};
    var keys = {};
    var pressed = {};
    var input = {
      keys: keys,
      touch: false,
      pointer: { x: 0, y: 0, down: false },
      stick: { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0 },
      enabled: true,
    };
    var STICK_R = 60;
    window.addEventListener('keydown', function (e) {
      if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();
      if (!keys[e.code]) pressed[e.code] = true;
      keys[e.code] = true;
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () { for (var k in keys) keys[k] = false; input.stick.active = false; });
    /** True once per key press. */
    input.hit = function (code) { if (pressed[code]) { pressed[code] = false; return true; } return false; };
    input.endFrame = function () { pressed = {}; };

    canvas.addEventListener('pointerdown', function (e) {
      input.pointer.x = e.clientX; input.pointer.y = e.clientY; input.pointer.down = true;
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        input.touch = true;
        var s = input.stick;
        if (!s.active && (opts.wholeScreenStick || e.clientX < window.innerWidth * 0.6)) {
          s.active = true; s.id = e.pointerId; s.ox = s.x = e.clientX; s.oy = s.y = e.clientY; s.dx = s.dy = 0;
          try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
        }
      }
      if (input.onPointerDown) input.onPointerDown(e);
    });
    canvas.addEventListener('pointermove', function (e) {
      input.pointer.x = e.clientX; input.pointer.y = e.clientY;
      var s = input.stick;
      if (s.active && e.pointerId === s.id) {
        var dx = e.clientX - s.ox, dy = e.clientY - s.oy, d = Math.sqrt(dx * dx + dy * dy);
        // The stick follows the thumb when it goes past the edge, so it never feels stuck.
        if (d > STICK_R) { s.ox = e.clientX - (dx / d) * STICK_R; s.oy = e.clientY - (dy / d) * STICK_R; dx = e.clientX - s.ox; dy = e.clientY - s.oy; d = STICK_R; }
        s.x = e.clientX; s.y = e.clientY;
        s.dx = dx / STICK_R; s.dy = dy / STICK_R;
      }
    });
    function up(e) {
      input.pointer.down = false;
      var s = input.stick;
      if (s.active && e.pointerId === s.id) { s.active = false; s.dx = s.dy = 0; }
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    input.move = function () {
      if (!input.enabled) return { x: 0, y: 0 };
      var x = 0, y = 0;
      if (keys.KeyA || keys.ArrowLeft) x -= 1;
      if (keys.KeyD || keys.ArrowRight) x += 1;
      if (keys.KeyW || keys.ArrowUp) y -= 1;
      if (keys.KeyS || keys.ArrowDown) y += 1;
      if (x || y) { var d = Math.sqrt(x * x + y * y); return { x: x / d, y: y / d }; }
      var s = input.stick;
      if (s.active) {
        var m = Math.sqrt(s.dx * s.dx + s.dy * s.dy);
        if (m < 0.12) return { x: 0, y: 0 };
        var k = Math.min(1, m) / m;
        return { x: s.dx * k, y: s.dy * k };
      }
      return { x: 0, y: 0 };
    };
    /** Draws the thumb-stick while a finger is down. */
    input.drawStick = function (ctx) {
      var s = input.stick;
      if (!s.active) return;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.ox, s.oy, STICK_R, 0, M.TAU); ctx.stroke();
      ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(s.ox + s.dx * STICK_R, s.oy + s.dy * STICK_R, 26, 0, M.TAU); ctx.fill();
      ctx.restore();
    };
    return input;
  }

  // ---------- Camera ----------
  function createCamera() {
    var cam = { x: 0, y: 0, zoom: 1, shakeAmt: 0, sx: 0, sy: 0 };
    cam.shake = function (amount) { cam.shakeAmt = Math.min(28, Math.max(cam.shakeAmt, amount)); };
    cam.update = function (dt, tx, ty, follow) {
      var k = 1 - Math.pow(1 - (follow || 0.12), dt * 60);
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
      cam.shakeAmt *= Math.pow(0.0015, dt);
      if (cam.shakeAmt < 0.3) cam.shakeAmt = 0;
      cam.sx = (Math.random() * 2 - 1) * cam.shakeAmt;
      cam.sy = (Math.random() * 2 - 1) * cam.shakeAmt;
    };
    /** Moves the drawing so world (0,0) is where it should be on screen. */
    cam.apply = function (ctx, stage) {
      ctx.setTransform(stage.dpr * cam.zoom, 0, 0, stage.dpr * cam.zoom,
        stage.dpr * (stage.W / 2 - (cam.x + cam.sx) * cam.zoom),
        stage.dpr * (stage.H / 2 - (cam.y + cam.sy) * cam.zoom));
    };
    cam.screen = function (ctx, stage) { ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0); };
    /** The visible part of the world, with a margin. */
    cam.view = function (stage, margin) {
      var hw = stage.W / 2 / cam.zoom + (margin || 0), hh = stage.H / 2 / cam.zoom + (margin || 0);
      return { l: cam.x - hw, r: cam.x + hw, t: cam.y - hh, b: cam.y + hh };
    };
    return cam;
  }

  // ---------- Particles ----------
  function createParticles(max) {
    max = max || 1400;
    var list = [];
    var fx = { list: list };
    fx.spawn = function (x, y, o) {
      if (list.length >= max) list.shift();
      var a = o.angle != null ? o.angle + M.rand(-(o.spread || 0), o.spread || 0) : Math.random() * M.TAU;
      var sp = M.rand(o.speedMin != null ? o.speedMin : (o.speed || 120) * 0.4, o.speed || 120);
      var life = M.rand((o.life || 0.5) * 0.6, o.life || 0.5);
      list.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: life, max: life, size: o.size || 6, color: o.color || '#ffffff', drag: o.drag != null ? o.drag : 3, shrink: o.shrink !== false, line: !!o.line });
    };
    fx.burst = function (x, y, n, o) { for (var i = 0; i < n; i++) fx.spawn(x, y, o); };
    /** A ring that grows and fades: explosions and pulses. */
    var rings = [];
    fx.rings = rings;
    fx.ring = function (x, y, radius, color, life, width) {
      rings.push({ x: x, y: y, r: 0, max: radius, color: color, life: life || 0.4, t: 0, w: width || 6 });
    };
    fx.update = function (dt) {
      for (var i = list.length - 1; i >= 0; i--) {
        var p = list[i];
        p.life -= dt;
        if (p.life <= 0) { M.swapRemove(list, i); continue; }
        var d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      for (var j = rings.length - 1; j >= 0; j--) {
        var r = rings[j];
        r.t += dt;
        if (r.t >= r.life) { M.swapRemove(rings, j); continue; }
        var k = r.t / r.life;
        r.r = r.max * (1 - Math.pow(1 - k, 3));
      }
    };
    fx.draw = function (ctx, view) {
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (view && (p.x < view.l || p.x > view.r || p.y < view.t || p.y > view.b)) continue;
        var k = p.life / p.max;
        var s = p.shrink ? p.size * k : p.size;
        if (p.line) {
          ctx.strokeStyle = p.color; ctx.globalAlpha = k; ctx.lineWidth = Math.max(1, s * 0.5);
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
        } else {
          drawGlow(ctx, p.x, p.y, p.color, s * 2.2, k);
        }
      }
      ctx.globalAlpha = 1;
      for (var j = 0; j < rings.length; j++) {
        var r = rings[j];
        var a = 1 - r.t / r.life;
        ctx.strokeStyle = r.color; ctx.globalAlpha = a; ctx.lineWidth = r.w * a + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, M.TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    fx.clear = function () { list.length = 0; rings.length = 0; };
    return fx;
  }

  // ---------- Floating text ----------
  function createPopups(max) {
    max = max || 60;
    var list = [];
    var pop = { list: list };
    pop.add = function (x, y, text, color, size) {
      if (list.length >= max) list.shift();
      list.push({ x: x + M.rand(-6, 6), y: y, text: String(text), color: color || '#ffffff', size: size || 16, t: 0, life: 0.7 });
    };
    pop.update = function (dt) {
      for (var i = list.length - 1; i >= 0; i--) {
        var p = list[i];
        p.t += dt; p.y -= 40 * dt;
        if (p.t >= p.life) list.splice(i, 1);
      }
    };
    pop.draw = function (ctx) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var k = p.t / p.life;
        var s = p.size * (k < 0.15 ? 0.6 + k * 2.6 : 1);
        ctx.globalAlpha = 1 - k * k;
        ctx.font = '900 ' + s.toFixed(1) + 'px ui-sans-serif, system-ui, sans-serif';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    };
    pop.clear = function () { list.length = 0; };
    return pop;
  }

  // ---------- Sound ----------
  /**
   * Sounds made in the browser (no audio files). `sound.play(name)` plays a preset; repeated
   * sounds are limited so a hundred hits in one frame do not get louder and louder.
   */
  function createSound() {
    var ac = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
    var muted = false, userMuted = false;
    var lastPlayed = {};
    var sound = { musicOn: true };
    try { userMuted = localStorage.getItem('bs-kit-muted') === '1'; } catch (e) { /* storage blocked */ }
    function ensure() {
      if (ac) return ac;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      var comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      master.connect(comp); comp.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      applyMute();
      return ac;
    }
    function applyMute() { if (master) master.gain.value = muted || userMuted ? 0 : 1; }
    /** Call from a click or key press: browsers only allow sound after the player does something. */
    sound.unlock = function () { var c = ensure(); if (c && c.state === 'suspended') c.resume(); };
    sound.setMuted = function (m) { muted = !!m; applyMute(); };
    sound.toggleUser = function () {
      userMuted = !userMuted;
      try { localStorage.setItem('bs-kit-muted', userMuted ? '1' : '0'); } catch (e) { /* storage blocked */ }
      applyMute();
      return userMuted;
    };
    sound.isUserMuted = function () { return userMuted; };

    function tone(o) {
      var t = ac.currentTime + (o.delay || 0);
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.v || 0.3, t + (o.a || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
      osc.connect(g); g.connect(o.bus || sfxBus);
      osc.start(t); osc.stop(t + o.d + 0.02);
    }
    function noise(o) {
      var t = ac.currentTime + (o.delay || 0);
      var src = ac.createBufferSource();
      src.buffer = noiseBuf;
      var f = ac.createBiquadFilter();
      f.type = o.filter || 'lowpass';
      f.frequency.setValueAtTime(o.f || 2000, t);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.d);
      var g = ac.createGain();
      g.gain.setValueAtTime(o.v || 0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
      src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
      src.start(t, Math.random() * 0.5); src.stop(t + o.d + 0.02);
    }
    var PRESETS = {
      shoot: function () { tone({ f: 880, f2: 220, d: 0.08, v: 0.12, type: 'square' }); },
      laser: function () { tone({ f: 1400, f2: 300, d: 0.14, v: 0.12, type: 'sawtooth' }); },
      zap: function () { tone({ f: 2200, f2: 600, d: 0.09, v: 0.1, type: 'sawtooth' }); noise({ f: 6000, d: 0.06, v: 0.08, filter: 'highpass' }); },
      hit: function () { tone({ f: 320, f2: 90, d: 0.07, v: 0.16, type: 'triangle' }); },
      kill: function () { noise({ f: 2400, f2: 300, d: 0.12, v: 0.18 }); tone({ f: 200, f2: 60, d: 0.1, v: 0.15, type: 'sine' }); },
      boom: function () { noise({ f: 1800, f2: 80, d: 0.55, v: 0.55 }); tone({ f: 120, f2: 30, d: 0.5, v: 0.5, type: 'sine' }); },
      bigboom: function () { noise({ f: 1200, f2: 40, d: 1.2, v: 0.8 }); tone({ f: 90, f2: 22, d: 1.1, v: 0.7, type: 'sine' }); tone({ f: 60, f2: 25, d: 1.4, v: 0.5, type: 'triangle', delay: 0.05 }); },
      pickup: function () { tone({ f: 1200 + Math.random() * 300, f2: 1800, d: 0.06, v: 0.07, type: 'sine' }); },
      coin: function () { tone({ f: 1320, d: 0.06, v: 0.1, type: 'square' }); tone({ f: 1760, d: 0.12, v: 0.1, type: 'square', delay: 0.06 }); },
      heal: function () { [523, 659, 784].forEach(function (f, i) { tone({ f: f, d: 0.18, v: 0.12, type: 'sine', delay: i * 0.06 }); }); },
      levelup: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone({ f: f, d: 0.22, v: 0.14, type: 'square', delay: i * 0.07 }); }); },
      evolve: function () { [392, 523, 659, 784, 1047, 1319].forEach(function (f, i) { tone({ f: f, d: 0.3, v: 0.13, type: 'sawtooth', delay: i * 0.07 }); }); },
      hurt: function () { tone({ f: 200, f2: 60, d: 0.22, v: 0.3, type: 'sawtooth' }); noise({ f: 900, d: 0.15, v: 0.2 }); },
      warn: function () { tone({ f: 440, d: 0.25, v: 0.2, type: 'square' }); tone({ f: 330, d: 0.25, v: 0.2, type: 'square', delay: 0.3 }); tone({ f: 440, d: 0.25, v: 0.2, type: 'square', delay: 0.6 }); tone({ f: 330, d: 0.4, v: 0.2, type: 'square', delay: 0.9 }); },
      click: function () { tone({ f: 660, d: 0.05, v: 0.1, type: 'square' }); },
      whoosh: function () { noise({ f: 400, f2: 3000, d: 0.25, v: 0.25, filter: 'bandpass' }); },
      lose: function () { [392, 330, 262, 196].forEach(function (f, i) { tone({ f: f, d: 0.35, v: 0.16, type: 'triangle', delay: i * 0.18 }); }); },
      win: function () { [523, 659, 784, 1047, 784, 1047, 1319].forEach(function (f, i) { tone({ f: f, d: 0.3, v: 0.14, type: 'square', delay: i * 0.1 }); }); },
    };
    var GAP = { pickup: 0.03, hit: 0.035, shoot: 0.05, laser: 0.06, zap: 0.05, kill: 0.04 };
    /** Plays a sound by name. Games can add their own with sound.define(name, fn(tone, noise)). */
    sound.play = function (name) {
      if (!ac || ac.state !== 'running' || muted || userMuted) return;
      var now = ac.currentTime;
      var gap = GAP[name] != null ? GAP[name] : 0.02;
      if (lastPlayed[name] && now - lastPlayed[name] < gap) return;
      lastPlayed[name] = now;
      var fn = PRESETS[name];
      if (fn) fn();
    };
    sound.define = function (name, fn, gap) {
      PRESETS[name] = function () { fn(tone, noise); };
      if (gap != null) GAP[name] = gap;
    };

    // Music: a simple synthwave loop. Intensity 0..1 adds drums and a faster lead.
    var musicTimer = null, step = 0, nextAt = 0, intensity = 0;
    var BASS = [0, 0, 12, 0, 7, 0, 10, 12, 0, 0, 12, 0, 5, 7, 3, 5];
    var ROOTS = [45, 45, 41, 43];
    function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
    function schedule() {
      if (!ac) return;
      var bpm = 112 + intensity * 26, sixteenth = 60 / bpm / 4;
      while (nextAt < ac.currentTime + 0.15) {
        var bar = Math.floor(step / 16) % 4, s = step % 16, root = ROOTS[bar];
        var t = nextAt - ac.currentTime;
        tone({ f: midi(root - 12 + BASS[s]), d: sixteenth * 0.9, v: 0.22, type: 'sawtooth', bus: musicBus, delay: t });
        if (s % 4 === 0) tone({ f: 120, f2: 40, d: 0.18, v: 0.55, type: 'sine', bus: musicBus, delay: t });
        if (intensity > 0.25 && s % 8 === 4) noise({ f: 2500, d: 0.12, v: 0.25, bus: musicBus, delay: t });
        if (intensity > 0.1 && s % 2 === 1) noise({ f: 8000, d: 0.03, v: 0.07, filter: 'highpass', bus: musicBus, delay: t });
        if (intensity > 0.5 && (s === 0 || s === 3 || s === 6 || s === 10 || s === 12)) {
          tone({ f: midi(root + 24 + [0, 3, 7, 10, 7][[0, 3, 6, 10, 12].indexOf(s)]), d: sixteenth * 1.6, v: 0.07, type: 'square', bus: musicBus, delay: t });
        }
        nextAt += sixteenth;
        step++;
      }
    }
    sound.startMusic = function () {
      if (!ensure() || musicTimer || !sound.musicOn) return;
      nextAt = ac.currentTime + 0.05; step = 0;
      musicTimer = setInterval(schedule, 50);
    };
    sound.stopMusic = function () { if (musicTimer) clearInterval(musicTimer); musicTimer = null; };
    sound.setIntensity = function (v) { intensity = M.clamp(v, 0, 1); };
    return sound;
  }

  // ---------- Brainstorming SDK ----------
  /**
   * A wrapper that never throws: the game still runs when opened on its own, without the site.
   * It mutes the game when the site asks (muted player, an ad playing) and pauses it during ads.
   */
  function createSdk(sound, hooks) {
    hooks = hooks || {};
    var BG = window.BG;
    var sdk = { BG: BG || null, user: null, ready: false, settings: null };
    var playing = false;
    sdk.init = function () {
      if (!BG) return Promise.resolve();
      return BG.init()
        .then(function () {
          sdk.ready = true;
          BG.game.loadingStart();
          BG.game.onSettingsChange(function (s) { sdk.settings = s; sound.setMuted(s && s.muteAudio); });
          BG.game.onAdStateChange(function (st) {
            if (st.playing) { sound.setMuted(true); if (hooks.onAdStart) hooks.onAdStart(); }
            else { sound.setMuted(sdk.settings && sdk.settings.muteAudio); }
          });
          return BG.user.get().then(function (u) { sdk.user = u; }, function () {});
        })
        .catch(function () {});
    };
    sdk.loaded = function () { if (BG && sdk.ready) BG.game.loadingStop(); };
    sdk.start = function () { if (BG && sdk.ready && !playing) { playing = true; BG.game.gameplayStart(); } };
    sdk.stop = function () { if (BG && sdk.ready && playing) { playing = false; BG.game.gameplayStop(); } };
    sdk.get = function (key) { if (!BG || !sdk.ready) return Promise.resolve(null); return BG.data.get(key).catch(function () { return null; }); };
    sdk.set = function (key, value) { if (!BG || !sdk.ready) return Promise.resolve(); return BG.data.set(key, value).catch(function () {}); };
    sdk.submit = function (board, score) { if (BG && sdk.ready) BG.leaderboard.submit(board, Math.floor(score)).catch(function () {}); };
    sdk.celebrate = function () { if (BG && sdk.ready && BG.game.celebrate) BG.game.celebrate(); };
    sdk.track = function (event, value) { if (BG && sdk.ready && BG.quests) BG.quests.track(event, value); };
    /** A break between runs. Resolves when it is over (or straight away when none is shown). */
    sdk.midgame = function () {
      if (!BG || !sdk.ready) return Promise.resolve();
      return BG.ad.midgame({ onStart: function () { sound.setMuted(true); } })
        .catch(function () {})
        .then(function () { sound.setMuted(sdk.settings && sdk.settings.muteAudio); });
    };
    /** A rewarded ad. Resolves true only when the player earned the reward. */
    sdk.rewarded = function () {
      if (!BG || !sdk.ready) return Promise.resolve(false);
      return BG.ad.rewarded({ onStart: function () { sound.setMuted(true); } })
        .then(function (r) { return !!(r && r.rewarded); }, function () { return false; })
        .then(function (ok) { sound.setMuted(sdk.settings && sdk.settings.muteAudio); return ok; });
    };
    sdk.has = function () { return !!(BG && sdk.ready); };
    return sdk;
  }

  // ---------- Local save (falls back when the site is not there) ----------
  function createSave(sdk, key, defaults) {
    var save = { data: JSON.parse(JSON.stringify(defaults)) };
    function merge(obj) {
      if (!obj || typeof obj !== 'object') return;
      for (var k in defaults) if (Object.prototype.hasOwnProperty.call(obj, k)) save.data[k] = obj[k];
    }
    save.load = function () {
      try { merge(JSON.parse(localStorage.getItem(key) || 'null')); } catch (e) { /* storage blocked */ }
      return sdk.get(key).then(function (remote) { merge(remote); return save.data; });
    };
    save.write = function () {
      try { localStorage.setItem(key, JSON.stringify(save.data)); } catch (e) { /* storage blocked */ }
      return sdk.set(key, save.data);
    };
    return save;
  }

  // ---------- Spatial grid (fast "who is near me") ----------
  function createGrid(cell) {
    var map = new Map();
    var grid = {};
    function k(cx, cy) { return cx * 73856093 ^ cy * 19349663; }
    grid.clear = function () { map.clear(); };
    grid.add = function (obj) {
      var key = k(Math.floor(obj.x / cell), Math.floor(obj.y / cell));
      var b = map.get(key);
      if (!b) { b = []; map.set(key, b); }
      b.push(obj);
    };
    /** Calls fn(obj) for everything in cells touching the circle (x, y, r). Return true to stop. */
    grid.query = function (x, y, r, fn) {
      var x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
      var y0 = Math.floor((y - r) / cell), y1 = Math.floor((y + r) / cell);
      for (var cx = x0; cx <= x1; cx++) {
        for (var cy = y0; cy <= y1; cy++) {
          var b = map.get(k(cx, cy));
          if (!b) continue;
          for (var i = 0; i < b.length; i++) if (fn(b[i])) return;
        }
      }
    };
    return grid;
  }

  window.BSKit = {
    version: '1.0.0',
    M: M,
    rgba: rgba,
    glowSprite: glowSprite,
    drawGlow: drawGlow,
    createStage: createStage,
    createLoop: createLoop,
    createInput: createInput,
    createCamera: createCamera,
    createParticles: createParticles,
    createPopups: createPopups,
    createSound: createSound,
    createSdk: createSdk,
    createSave: createSave,
    createGrid: createGrid,
  };
})();

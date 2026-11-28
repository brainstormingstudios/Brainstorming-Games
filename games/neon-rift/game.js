/* Neon Rift.io: online arena shooter. A Brainstorming Games original, built on BS Kit. */
(function () {
  'use strict';
  var K = window.BSKit, M = K.M;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var SERVER = (params.get('server') || 'wss://bg-rooms.brainstorming-games.workers.dev').replace(/\/+$/, '');
  var DEBUG = params.get('debug') === '1';

  // ================= Shared numbers (the server has the same) =================
  var LEVEL_MAX = 45, STAT_MAX = 7, INTERP_MS = 110;
  function radiusFor(level) { return 18 + Math.min(level, LEVEL_MAX) * 0.42; }
  var COLORS = ['#5ef1ff', '#ff5ec8', '#ffe14d', '#7dff9e', '#ff7a3d', '#b47bff', '#ff3d6e', '#4d8bff'];
  var EMOTES = ['👋', 'GG', '😎', '😂', '🔥', '💀'];
  var STATS = [
    { id: 'dmg', name: 'Bullet damage', c: '#ff5e7a' },
    { id: 'rate', name: 'Fire rate', c: '#ffe14d' },
    { id: 'speed', name: 'Move speed', c: '#7dff9e' },
    { id: 'hp', name: 'Max health', c: '#ff7a3d' },
    { id: 'regen', name: 'Healing', c: '#ff9be0' },
    { id: 'range', name: 'Bullet range', c: '#5ef1ff' },
  ];
  var CLASSES = {
    blaster: { name: 'Blaster', info: 'One steady gun.', barrels: [[0, 0, 1, 0.5]] },
    twin: { name: 'Twin', info: 'Two guns side by side.', barrels: [[0, -9, 1, 0.42], [0, 9, 1, 0.42]] },
    sniper: { name: 'Sniper', info: 'Long range, big hits, goes through 2.', barrels: [[0, 0, 1.5, 0.45]] },
    gunner: { name: 'Gunner', info: 'A non-stop spray of bullets.', barrels: [[0, 0, 0.9, 0.75]] },
    hydra: { name: 'Hydra', info: 'Five guns in a wide fan.', barrels: [[-0.36, 0, 0.9, 0.36], [-0.18, 0, 1, 0.36], [0, 0, 1.1, 0.4], [0.18, 0, 1, 0.36], [0.36, 0, 0.9, 0.36]] },
    rail: { name: 'Railgun', info: 'Huge damage, pierces 5 ships.', barrels: [[0, 0, 1.8, 0.5]] },
    storm: { name: 'Storm', info: 'Twin guns at crazy speed.', barrels: [[0, -8, 1.05, 0.5], [0, 8, 1.05, 0.5]] },
    octo: { name: 'Octo', info: 'Shoots in all 8 directions.', barrels: [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return [i * Math.PI / 4, 0, 0.85, 0.38]; }) },
  };
  var POWER_LOOK = { shield: ['◎', '#4d8bff', 'SHIELD'], triple: ['⁂', '#ffe14d', 'TRIPLE SHOT'], speed: ['»', '#7dff9e', 'SPEED'], damage: ['✚', '#ff3d6e', 'DOUBLE DAMAGE'] };
  var STREAKS = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 5: 'RAMPAGE', 8: 'UNSTOPPABLE', 12: 'GODLIKE', 20: 'LEGENDARY' };

  // ================= Setup =================
  var stage = K.createStage($('c'), { designSize: 820 });
  var ctx = stage.ctx;
  var input = K.createInput(stage.canvas);
  var cam = K.createCamera();
  var fx = K.createParticles(1200);
  var pop = K.createPopups(50);
  var sound = K.createSound();
  var sdk = K.createSdk(sound);

  var state = 'menu'; // menu | connecting | play | dead
  var net = { ws: null, room: '', rtt: 90, lastSend: 0, sent: '', closing: false, quickIndex: 1 };
  var world = { size: 2600, rocks: [], orbs: new Map(), powers: [], roster: new Map() };
  var snaps = [];
  var myId = 0, me = null, local = null, lastShips = new Map();
  var bullets = [];
  var feed = [], lb = [], toast = null, deaths = 0, bestScore = 0, playStart = 0, killerName = '';
  var aim = { a: 0, fire: false, auto: false, mouseDown: false }, right = { id: -1, ox: 0, oy: 0, x: 0, y: 0, on: false };
  var myName = 'Pilot';
  var shotSoundT = 0;

  // ================= Networking =================
  function connect(room) {
    sound.unlock();
    state = 'connecting';
    setErr('Connecting…');
    net.room = room;
    net.closing = false;
    var ws;
    try {
      ws = new WebSocket(SERVER + '/ws?room=' + encodeURIComponent(room) + '&name=' + encodeURIComponent(myName));
    } catch (e) {
      return failConnect('Could not reach the game server.');
    }
    net.ws = ws;
    var opened = false;
    ws.onopen = function () { opened = true; };
    ws.onmessage = function (e) { onMessage(e.data); };
    ws.onclose = function (e) {
      if (net.ws !== ws) return;
      net.ws = null;
      if (e.code === 4001) {
        // This arena is full: quick play tries the next one.
        if (/^q[1-8]$/.test(room) && net.quickIndex < 8) { net.quickIndex++; connect('q' + net.quickIndex); return; }
        return failConnect(room.charAt(0) === 'p' ? 'That room is full (12 players).' : 'Every arena is full. Try again in a minute.');
      }
      if (net.closing) return;
      if (!opened) return failConnect('Could not reach the game server. Check your connection and try again.');
      failConnect('Connection lost. Press Play to jump back in.');
    };
  }
  function failConnect(msg) {
    endSession();
    setErr(msg);
  }
  function send(obj) {
    if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(obj));
  }
  function leave() {
    net.closing = true;
    if (net.ws) net.ws.close(1000, 'bye');
    net.ws = null;
    endSession();
    setErr('');
  }
  function endSession() {
    state = 'menu';
    sdk.stop();
    sound.stopMusic();
    snaps = []; bullets = []; feed = []; lb = []; me = null; local = null; myId = 0;
    world.orbs.clear(); world.roster.clear();
    ['dead', 'upg', 'classes', 'emotes', 'touchbar', 'topbtns'].forEach(function (id) { $(id).hidden = true; });
    $('menu').hidden = false;
    if (sdk.has() && sdk.BG.game.updateRoom) sdk.BG.game.updateRoom({ roomId: '', isJoinable: false });
  }

  function onMessage(raw) {
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'welcome') return onWelcome(m);
    if (m.t === 'pong') { net.rtt = M.lerp(net.rtt, performance.now() - m.c, 0.3); return; }
    if (m.t !== 's') return;
    var now = performance.now();
    var ships = new Map();
    for (var i = 0; i < m.s.length; i++) ships.set(m.s[i][0], m.s[i]);
    snaps.push({ t: now, ships: ships });
    if (snaps.length > 30) snaps.shift();
    ships.forEach(function (s, id) { lastShips.set(id, s); });
    if (m.r) setRoster(m.r);
    if (m.pw) world.powers = m.pw;
    if (m.oa) m.oa.forEach(function (o) { world.orbs.set(o[0], { x: o[1], y: o[2], v: o[3], ph: Math.random() * 6 }); });
    if (m.od) m.od.forEach(function (o) {
      var orb = world.orbs.get(o[0]);
      if (orb && o[1] === myId) { sound.play('pickup'); fx.burst(orb.x, orb.y, 3, { color: orbColor(orb.v), speed: 90, life: 0.3, size: 4 }); }
      world.orbs.delete(o[0]);
    });
    if (m.b) m.b.forEach(function (b) {
      bullets.push({ id: b[0], owner: b[1], x: b[2], y: b[3], vx: b[4], vy: b[5], r: b[6], life: b[7] / 100 });
      if (b[1] === myId && now - shotSoundT > 70) { shotSoundT = now; sound.play('shoot'); }
    });
    if (m.h) m.h.forEach(function (h) {
      for (var j = bullets.length - 1; j >= 0; j--) {
        if (bullets[j].id === h[0]) {
          var bl = bullets[j];
          fx.burst(bl.x, bl.y, h[1] ? 6 : 3, { color: h[1] ? '#ffffff' : '#b47bff', speed: 180, life: 0.25, size: 4 });
          bullets.splice(j, 1);
          break;
        }
      }
    });
    if (m.e) m.e.forEach(onEvent);
    if (m.lb) lb = m.lb;
    var wasAlive = me && me.alive;
    me = m.me;
    var mine = ships.get(myId);
    if (mine && local) reconcile(mine, now);
    if (mine && (!local || !wasAlive)) local = { x: mine[1], y: mine[2], vx: 0, vy: 0, hist: [], boostT: 0 };
    if (me && me.alive && state === 'dead') { state = 'play'; $('dead').hidden = true; showPlayUi(true); sdk.start(); playStart = now; }
    updatePanels();
  }
  function onWelcome(m) {
    myId = m.id;
    world.size = m.world;
    world.rocks = m.rocks;
    world.orbs.clear();
    m.orbs.forEach(function (o) { world.orbs.set(o[0], { x: o[1], y: o[2], v: o[3], ph: Math.random() * 6 }); });
    world.powers = m.powers;
    setRoster(m.roster);
    state = 'play';
    playStart = performance.now();
    setErr('');
    $('menu').hidden = true;
    showPlayUi(true);
    sound.startMusic();
    sound.setIntensity(0.3);
    sdk.start();
    var code = net.room.indexOf('p-') === 0 ? net.room.slice(2) : '';
    $('btn-invite').hidden = !code;
    if (code) {
      showToast('PRIVATE ROOM ' + code, '#5ef1ff', 3);
      if (sdk.has() && sdk.BG.game.updateRoom) sdk.BG.game.updateRoom({ roomId: code, isJoinable: true, inviteParams: { room: code } });
    }
  }
  function setRoster(list) {
    world.roster.clear();
    list.forEach(function (r) { world.roster.set(r[0], { name: r[1], color: COLORS[r[2] % COLORS.length], bot: !!r[3] }); });
  }
  function nameOf(id) { var r = world.roster.get(id); return r ? r.name : 'Someone'; }
  function colorOf(id) { var r = world.roster.get(id); return r ? r.color : '#ffffff'; }

  function onEvent(ev) {
    var kind = ev[0];
    var s = lastShips.get(ev[1]);
    if (kind === 'dmg') {
      if (ev[1] === myId) { cam.shake(Math.min(14, 3 + ev[2] / 4)); sound.play('hurt'); hurtFlash = 0.25; }
      else if (s) { pop.add(s[1], s[2] - radiusFor(s[5]) - 6, ev[2], '#ffffff', 14); sound.play('hit'); }
    } else if (kind === 'kill') {
      var victim = lastShips.get(ev[2]);
      if (victim) {
        var vc = colorOf(ev[2]);
        fx.burst(victim[1], victim[2], 40, { color: vc, speed: 420, life: 0.7, size: 6 });
        fx.burst(victim[1], victim[2], 16, { color: '#ffffff', speed: 260, life: 0.5, size: 4 });
        fx.ring(victim[1], victim[2], 120 + victim[5] * 3, vc, 0.5, 8);
        if (local && M.dist(local.x, local.y, victim[1], victim[2]) < 900) { sound.play('boom'); cam.shake(5); }
      }
      feed.unshift({ k: ev[1] ? nameOf(ev[1]) : '', kc: colorOf(ev[1]), v: nameOf(ev[2]), vc: colorOf(ev[2]), t: 6, me: ev[1] === myId || ev[2] === myId });
      if (feed.length > 5) feed.pop();
      if (ev[1] === myId) {
        sound.play('kill');
        var word = STREAKS[ev[3]];
        if (ev[4]) showToast('KINGSLAYER! +' + ev[5], '#ffd36b', 2.2);
        else if (word) showToast(word + '!', ev[3] >= 8 ? '#ff5ec8' : '#ffd36b', 1.8);
        else showToast('+' + ev[5], '#7dff9e', 1);
        if (ev[3] >= 3) sound.play('levelup');
        sound.setIntensity(Math.min(1, 0.3 + ev[3] * 0.1));
      }
      if (ev[2] === myId) onDeath(ev[1]);
    } else if (kind === 'level' && ev[1] === myId) {
      sound.play('levelup');
      if (local) fx.ring(local.x, local.y, 110, '#ffd36b', 0.5, 6);
    } else if (kind === 'power' && ev[1] === myId) {
      var look = POWER_LOOK[ev[2]];
      showToast(look[2] + '!', look[1], 1.6);
      sound.play('evolve');
    } else if (kind === 'leader' && ev[1] === myId && state === 'play') {
      showToast('YOU ARE THE LEADER 👑', '#ffd36b', 2.4);
      sound.play('win');
    } else if (kind === 'boost' && s && local && M.dist(local.x, local.y, s[1], s[2]) < 700) {
      sound.play('whoosh');
    } else if (kind === 'block' && s) {
      fx.ring(s[1], s[2], radiusFor(s[5]) + 14, '#4d8bff', 0.25, 4);
    } else if (kind === 'class' && ev[1] === myId) {
      sound.play('evolve');
      showToast(CLASSES[ev[2]].name.toUpperCase() + '!', '#ffd36b', 1.6);
      if (local) fx.ring(local.x, local.y, 200, '#ffd36b', 0.6, 10);
    }
  }
  var hurtFlash = 0;

  function onDeath(killerId) {
    killerName = killerId ? nameOf(killerId) : '';
    deaths++;
    state = 'dead';
    sdk.stop();
    sound.play('lose');
    var score = me ? me.score : 0;
    sdk.submit('score', score);
    var record = score > bestScore;
    if (record) { bestScore = score; sdk.set('best', bestScore); if (score > 0) sdk.celebrate(); }
    $('dead-title').textContent = 'DESTROYED';
    $('dead-text').textContent = (killerName ? 'Taken out by ' + killerName + '. ' : '') + (record && score > 0 ? 'New best score!' : 'Best ' + bestScore + '.');
    var box = $('dead-stats');
    box.innerHTML = '';
    var secs = Math.floor((performance.now() - playStart) / 1000);
    [['Score', score], ['Kills', me ? me.kills : 0], ['Level', me ? me.level : 1], ['Time', Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0')]].forEach(function (s) {
      var d = document.createElement('div');
      var b = document.createElement('b'); b.textContent = s[1];
      var sp = document.createElement('span'); sp.textContent = s[0];
      d.append(b, sp); box.appendChild(d);
    });
    showPlayUi(false);
    $('topbtns').hidden = false;
    $('dead').hidden = false;
    var btn = $('respawn');
    btn.disabled = true;
    var left = 2;
    btn.textContent = 'RESPAWN (' + left + ')';
    var timer = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = 'RESPAWN'; }
      else btn.textContent = 'RESPAWN (' + left + ')';
    }, 1000);
  }
  function respawn() {
    $('respawn').disabled = true;
    var go = function () { send({ t: 'respawn' }); };
    // A short break every third time (the site decides if an ad really shows).
    if (deaths % 3 === 0) sdk.midgame().then(go); else go();
  }

  // ================= Prediction for your own ship =================
  function reconcile(mine, now) {
    var target = now - net.rtt;
    var h = local.hist, best = null;
    for (var i = h.length - 1; i >= 0; i--) { if (h[i].t <= target) { best = h[i]; break; } }
    if (!best) best = h[0] || { x: local.x, y: local.y };
    var ex = mine[1] - best.x, ey = mine[2] - best.y;
    if (ex * ex + ey * ey > 260 * 260) { local.x = mine[1]; local.y = mine[2]; local.hist = []; return; }
    local.x += ex * 0.22; local.y += ey * 0.22;
    for (var j = 0; j < h.length; j++) { h[j].x += ex * 0.22; h[j].y += ey * 0.22; }
  }
  function predict(dt, mv) {
    if (!local || !me || !me.alive) return;
    var top = me.speed || 250;
    if (local.boostT > 0) local.boostT -= dt;
    else {
      var k = Math.min(1, dt * 7);
      local.vx += (mv.x * top - local.vx) * k;
      local.vy += (mv.y * top - local.vy) * k;
    }
    local.x += local.vx * dt; local.y += local.vy * dt;
    var r = radiusFor(me.level);
    local.x = M.clamp(local.x, r, world.size - r);
    local.y = M.clamp(local.y, r, world.size - r);
    for (var i = 0; i < world.rocks.length; i++) {
      var k2 = world.rocks[i], dx = local.x - k2.x, dy = local.y - k2.y, d = Math.sqrt(dx * dx + dy * dy), min = k2.r + r;
      if (d < min && d > 0.01) { local.x = k2.x + dx / d * min; local.y = k2.y + dy / d * min; }
    }
    var now = performance.now();
    local.hist.push({ t: now, x: local.x, y: local.y });
    while (local.hist.length && local.hist[0].t < now - 1500) local.hist.shift();
  }
  function boost() {
    if (state !== 'play' || !me || !me.alive || me.boostCd > 0 || !local) return;
    send({ t: 'boost' });
    var mv = input.move(), len = Math.hypot(mv.x, mv.y);
    var dx = len > 0.1 ? mv.x / len : Math.cos(aim.a), dy = len > 0.1 ? mv.y / len : Math.sin(aim.a);
    local.vx = dx * (me.speed || 250) * 2.6; local.vy = dy * (me.speed || 250) * 2.6; local.boostT = 0.22;
    me.boostCd = 3.5;
    fx.burst(local.x, local.y, 14, { color: '#5ef1ff', speed: 220, life: 0.4, size: 5, angle: Math.atan2(-dy, -dx), spread: 0.5 });
  }

  // ================= Input =================
  stage.canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') {
      if (e.button === 2) boost();
      else if (e.button === 0) aim.mouseDown = true;
      return;
    }
    // Touch: the right part of the screen is the aim-and-shoot stick.
    if (e.clientX >= window.innerWidth * 0.6 && !right.on) {
      right.on = true; right.id = e.pointerId; right.ox = right.x = e.clientX; right.oy = right.y = e.clientY;
      try { stage.canvas.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    }
  });
  stage.canvas.addEventListener('pointermove', function (e) {
    if (right.on && e.pointerId === right.id) { right.x = e.clientX; right.y = e.clientY; }
  });
  function pointerUp(e) {
    if (e.pointerType === 'mouse' && e.button === 0) aim.mouseDown = false;
    if (right.on && e.pointerId === right.id) right.on = false;
  }
  stage.canvas.addEventListener('pointerup', pointerUp);
  stage.canvas.addEventListener('pointercancel', pointerUp);
  window.addEventListener('blur', function () { aim.mouseDown = false; right.on = false; });
  window.addEventListener('keydown', function (e) {
    if (state === 'menu') { if (e.code === 'Enter') $('quick').click(); return; }
    if (e.code === 'Space') { e.preventDefault(); boost(); }
    else if (e.code === 'KeyE') toggleAuto();
    else if (/^Digit[1-6]$/.test(e.code)) upgrade(STATS[Number(e.code.slice(5)) - 1].id);
    else if (e.code === 'KeyG') emote(1);
  });
  function toggleAuto() {
    aim.auto = !aim.auto;
    $('btn-auto').textContent = 'Auto-fire: ' + (aim.auto ? 'on' : 'off') + (input.touch ? '' : ' (E)');
  }
  function upgrade(stat) { if (me && me.points > 0) { send({ t: 'up', s: stat }); sound.play('click'); } }
  function emote(i) { send({ t: 'emote', e: i }); }

  /** Test helper (?debug=1): set __nr.auto = true to let the computer play. */
  function autopilot() {
    var best = null, bd = 1e12, mx = 0, my = 0;
    interpShips().forEach(function (s) { if (s.id === myId) return; var d = M.dist2(local.x, local.y, s.x, s.y); if (d < bd) { bd = d; best = s; } });
    if (best && bd < 600 * 600) {
      aim.a = M.angle(local.x, local.y, best.x, best.y); aim.fire = true;
      var d = Math.sqrt(bd), side = Math.sin(performance.now() / 700) > 0 ? 1 : -1;
      mx = (best.x - local.x) / d * (d > 300 ? 1 : -0.6) + (-(best.y - local.y) / d) * side * 0.8;
      my = (best.y - local.y) / d * (d > 300 ? 1 : -0.6) + ((best.x - local.x) / d) * side * 0.8;
    } else {
      var orb = null, od = 1e12;
      world.orbs.forEach(function (o) { var d2 = M.dist2(local.x, local.y, o.x, o.y) - o.v * 4000; if (d2 < od) { od = d2; orb = o; } });
      if (orb) { mx = orb.x - local.x; my = orb.y - local.y; aim.a = Math.atan2(my, mx); }
      aim.fire = false;
    }
    if (me && me.points > 0) upgrade(STATS[Math.floor(Math.random() * 6)].id);
    if (me && me.choose) send({ t: 'cls', c: me.choose[Math.floor(Math.random() * me.choose.length)] });
    var l = Math.hypot(mx, my) || 1;
    return { x: mx / l, y: my / l };
  }
  function updateAim() {
    if (right.on) {
      var dx = right.x - right.ox, dy = right.y - right.oy;
      if (dx * dx + dy * dy > 64) aim.a = Math.atan2(dy, dx);
      aim.fire = dx * dx + dy * dy > 400 || aim.auto;
    } else if (input.touch) {
      aim.fire = aim.auto;
    } else if (local) {
      var sx = (local.x - cam.x) * cam.zoom + stage.W / 2, sy = (local.y - cam.y) * cam.zoom + stage.H / 2;
      aim.a = Math.atan2(input.pointer.y - sy, input.pointer.x - sx);
      aim.fire = aim.mouseDown || aim.auto;
    }
  }
  function sendInput(mv) {
    var now = performance.now();
    if (now - net.lastSend < 66) return;
    var msg = { t: 'in', mx: Math.round(mv.x * 20) / 20, my: Math.round(mv.y * 20) / 20, a: Math.round(aim.a * 50) / 50, f: aim.fire ? 1 : 0 };
    var key = msg.mx + ',' + msg.my + ',' + msg.a + ',' + msg.f;
    if (key === net.sent && now - net.lastSend < 1000) return;
    net.sent = key;
    net.lastSend = now;
    send(msg);
  }

  // ================= Panels =================
  var upgKey = '', clsKey = '';
  function updatePanels() {
    if (!me || state !== 'play') return;
    var k = me.points + '|' + STATS.map(function (s) { return me.stats[s.id]; }).join(',');
    if (k !== upgKey) {
      upgKey = k;
      var box = $('upg');
      box.hidden = me.points <= 0;
      box.innerHTML = '';
      if (me.points > 0) {
        var t = document.createElement('div'); t.className = 'title'; t.textContent = 'UPGRADE ×' + me.points;
        box.appendChild(t);
        STATS.forEach(function (s, i) {
          var b = document.createElement('button'); b.type = 'button';
          b.style.setProperty('--c', s.c);
          var key = document.createElement('i'); key.textContent = String(i + 1);
          var n = document.createElement('span'); n.className = 'n'; n.textContent = s.name;
          var pips = document.createElement('span'); pips.className = 'pips'; pips.style.color = s.c;
          pips.textContent = '■'.repeat(me.stats[s.id]) + '□'.repeat(STAT_MAX - me.stats[s.id]);
          var plus = document.createElement('b'); plus.textContent = '+';
          b.append(key, n, pips, plus);
          b.disabled = me.stats[s.id] >= STAT_MAX;
          b.addEventListener('click', function () { upgrade(s.id); });
          box.appendChild(b);
        });
      }
    }
    var ck = me.choose ? me.choose.join(',') : '';
    if (ck !== clsKey) {
      clsKey = ck;
      var cb = $('classes');
      cb.hidden = !me.choose;
      cb.innerHTML = '';
      if (me.choose) {
        var ct = document.createElement('div'); ct.className = 'title'; ct.textContent = 'NEW GUNS! Pick one:';
        cb.appendChild(ct);
        me.choose.forEach(function (c) {
          var b = document.createElement('button'); b.type = 'button';
          b.textContent = CLASSES[c].name;
          var sm = document.createElement('small'); sm.textContent = CLASSES[c].info;
          b.appendChild(sm);
          b.addEventListener('click', function () { send({ t: 'cls', c: c }); });
          cb.appendChild(b);
        });
      }
    }
  }
  function showPlayUi(on) {
    $('topbtns').hidden = !on;
    $('emotes').hidden = !on;
    $('touchbar').hidden = !on || !input.touch;
    if (!on) { $('upg').hidden = true; $('classes').hidden = true; upgKey = ''; clsKey = ''; }
  }
  EMOTES.forEach(function (e, i) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = e;
    b.setAttribute('aria-label', 'Emote ' + e);
    b.addEventListener('click', function () { emote(i); });
    $('emotes').appendChild(b);
  });
  function showToast(text, color, secs) { toast = { text: text, color: color, t: secs, max: secs }; }
  function setErr(t) { $('err').textContent = t; }
  function orbColor(v) { return v >= 10 ? '#ff5ec8' : v >= 3 ? '#7dff9e' : '#5ef1ff'; }

  // ================= Update =================
  var pingT = 0;
  function update(dt) {
    if (state === 'play' || state === 'dead') {
      var mv = state === 'play' && me && me.alive ? input.move() : { x: 0, y: 0 };
      updateAim();
      if (DEBUG && window.__nr.auto && state === 'play' && me && me.alive && local) mv = autopilot();
      if (DEBUG && window.__nr.auto && state === 'dead' && !$('respawn').disabled) respawn();
      if (state !== 'play') aim.fire = false;
      predict(dt, mv);
      sendInput(mv);
      pingT -= dt;
      if (pingT <= 0) { pingT = 2; send({ t: 'ping', c: performance.now() }); }
      for (var i = bullets.length - 1; i >= 0; i--) {
        var b = bullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        if (b.life <= 0) bullets.splice(i, 1);
      }
      if (local) cam.update(dt, local.x, local.y, 0.2);
      if (me && me.alive && local && local.boostT > 0) fx.spawn(local.x, local.y, { color: '#5ef1ff', speed: 40, life: 0.35, size: 6 });
      for (var f = feed.length - 1; f >= 0; f--) { feed[f].t -= dt; if (feed[f].t <= 0) feed.splice(f, 1); }
    } else {
      cam.update(dt, world.size / 2 + Math.cos(performance.now() / 9000) * 600, world.size / 2 + Math.sin(performance.now() / 9000) * 600, 0.02);
    }
    if (toast) { toast.t -= dt; if (toast.t <= 0) toast = null; }
    hurtFlash = Math.max(0, hurtFlash - dt);
    fx.update(dt);
    pop.update(dt);
    input.endFrame();
  }

  // ================= Drawing =================
  function interpShips() {
    var out = [];
    if (!snaps.length) return out;
    var rt = performance.now() - INTERP_MS, a = null, b = null;
    for (var i = snaps.length - 1; i >= 0; i--) { if (snaps[i].t <= rt) { a = snaps[i]; b = snaps[i + 1] || null; break; } }
    if (!a) { a = snaps[0]; b = null; }
    var k = b ? M.clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1) : 0;
    var latest = snaps[snaps.length - 1];
    latest.ships.forEach(function (s, id) {
      var s0 = a.ships.get(id), s1 = b ? b.ships.get(id) : null;
      var x = s[1], y = s[2], ang = s[3];
      if (s0 && s1) {
        x = M.lerp(s0[1], s1[1], k); y = M.lerp(s0[2], s1[2], k);
        var d = Math.atan2(Math.sin(s1[3] - s0[3]), Math.cos(s1[3] - s0[3]));
        ang = s0[3] + d * k;
      } else if (s0) { x = s0[1]; y = s0[2]; ang = s0[3]; }
      out.push({ id: id, x: x, y: y, a: ang, hp: s[4], level: s[5], cls: s[6], flags: s[7], emote: s[8] });
    });
    return out;
  }
  function drawBackground(v) {
    ctx.fillStyle = '#04050c';
    ctx.fillRect(v.l, v.t, v.r - v.l, v.b - v.t);
    var size = 100;
    ctx.strokeStyle = '#0f1a3d'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (var x = Math.max(0, Math.floor(v.l / size) * size); x <= Math.min(world.size, v.r); x += size) { ctx.moveTo(x, Math.max(0, v.t)); ctx.lineTo(x, Math.min(world.size, v.b)); }
    for (var y = Math.max(0, Math.floor(v.t / size) * size); y <= Math.min(world.size, v.b); y += size) { ctx.moveTo(Math.max(0, v.l), y); ctx.lineTo(Math.min(world.size, v.r), y); }
    ctx.stroke();
    // Outside the arena: dark red danger zone, and a glowing wall.
    ctx.fillStyle = 'rgba(80,0,20,0.35)';
    if (v.l < 0) ctx.fillRect(v.l, v.t, -v.l, v.b - v.t);
    if (v.r > world.size) ctx.fillRect(world.size, v.t, v.r - world.size, v.b - v.t);
    if (v.t < 0) ctx.fillRect(0, v.t, world.size, -v.t);
    if (v.b > world.size) ctx.fillRect(0, world.size, world.size, v.b - world.size);
    ctx.strokeStyle = '#ff3d6e'; ctx.lineWidth = 6;
    ctx.shadowColor = '#ff3d6e'; ctx.shadowBlur = 16;
    ctx.strokeRect(0, 0, world.size, world.size);
    ctx.shadowBlur = 0;
    world.rocks.forEach(function (k) {
      if (k.x + k.r < v.l || k.x - k.r > v.r || k.y + k.r < v.t || k.y - k.r > v.b) return;
      ctx.globalCompositeOperation = 'lighter';
      K.drawGlow(ctx, k.x, k.y, '#3b2a7a', k.r * 1.9, 0.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      for (var i = 0; i < 9; i++) { var a = i / 9 * M.TAU, rr = k.r * (0.9 + ((k.x * 7 + i * 13) % 10) / 70); ctx.lineTo(k.x + Math.cos(a) * rr, k.y + Math.sin(a) * rr); }
      ctx.closePath();
      ctx.fillStyle = '#120c2a'; ctx.fill();
      ctx.strokeStyle = '#8f6bff'; ctx.lineWidth = 3; ctx.stroke();
    });
  }
  function drawOrbsAndPowers(v, t) {
    ctx.globalCompositeOperation = 'lighter';
    world.orbs.forEach(function (o) {
      if (o.x < v.l || o.x > v.r || o.y < v.t || o.y > v.b) return;
      var s = o.v >= 10 ? 22 : o.v >= 3 ? 15 : 11;
      K.drawGlow(ctx, o.x, o.y + Math.sin(t * 3 + o.ph) * 2, orbColor(o.v), s, 0.95);
    });
    ctx.globalCompositeOperation = 'source-over';
    world.powers.forEach(function (w) {
      if (w.x < v.l || w.x > v.r || w.y < v.t || w.y > v.b) return;
      var look = POWER_LOOK[w.kind];
      ctx.globalCompositeOperation = 'lighter';
      K.drawGlow(ctx, w.x, w.y, look[1], 46, 0.8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(t * 1.5);
      ctx.strokeStyle = look[1]; ctx.lineWidth = 3;
      ctx.beginPath(); for (var i = 0; i < 6; i++) { var a = i / 6 * M.TAU; ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20); } ctx.closePath(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#ffffff'; ctx.font = '900 18px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(look[0], w.x, w.y + 1);
    });
  }
  function drawShip(s, isMe, t) {
    var r = radiusFor(s.level), color = colorOf(s.id), def = CLASSES[s.cls] || CLASSES.blaster;
    ctx.globalCompositeOperation = 'lighter';
    K.drawGlow(ctx, s.x, s.y, color, r * 2.6, isMe ? 0.75 : 0.5);
    if (s.flags & 32) K.drawGlow(ctx, s.x, s.y, '#ff3d6e', r * 3.2, 0.5);
    if (s.flags & 16) K.drawGlow(ctx, s.x, s.y, '#7dff9e', r * 3, 0.4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.a);
    def.barrels.forEach(function (b) {
      ctx.save();
      ctx.rotate(b[0]);
      var len = r * (1.45 + b[2] * 0.75), w = r * b[3] * 1.15;
      ctx.fillStyle = '#1b2244'; ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.rect(0, b[1] - w / 2, len, w); ctx.fill(); ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, M.TAU);
    ctx.fillStyle = '#0b0f26'; ctx.fill();
    ctx.lineWidth = isMe ? 4 : 3; ctx.strokeStyle = color; ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.45, 0, M.TAU); ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    if (s.flags & 1) {
      ctx.strokeStyle = 'rgba(77,139,255,' + (0.6 + Math.sin(t * 10) * 0.25) + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 10, 0, M.TAU); ctx.stroke();
    }
    if (s.flags & 8) { ctx.strokeStyle = '#ffe14d'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(s.x, s.y, r + 5, 0, M.TAU); ctx.stroke(); ctx.setLineDash([]); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    var top = s.y - r - 8;
    if (s.flags & 4) { ctx.font = '22px ui-sans-serif, system-ui, sans-serif'; ctx.fillText('👑', s.x, top); top -= 22; }
    ctx.font = '800 13px ui-sans-serif, system-ui, sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    var label = nameOf(s.id) + ' · ' + s.level;
    ctx.strokeText(label, s.x, top); ctx.fillStyle = isMe ? '#ffffff' : '#d9def5'; ctx.fillText(label, s.x, top);
    if (!isMe && s.hp < 100) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(s.x - r, s.y + r + 8, r * 2, 5);
      ctx.fillStyle = s.hp > 35 ? '#7dff9e' : '#ff3d6e'; ctx.fillRect(s.x - r, s.y + r + 8, r * 2 * s.hp / 100, 5);
    }
    if (s.emote >= 0) {
      var e = EMOTES[s.emote], ey = top - 20;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath(); ctx.arc(s.x, ey - 6, 17, 0, M.TAU); ctx.fill();
      ctx.font = '900 15px ui-sans-serif, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#10142e';
      ctx.fillText(e, s.x, ey - 6);
    }
  }
  function drawBullets(v) {
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      if (b.x < v.l || b.x > v.r || b.y < v.t || b.y > v.b) continue;
      K.drawGlow(ctx, b.x, b.y, colorOf(b.owner), b.r * 3.4, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    for (var j = 0; j < bullets.length; j++) {
      var c = bullets[j];
      if (c.x < v.l || c.x > v.r || c.y < v.t || c.y > v.b) continue;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.6, 0, M.TAU); ctx.fill();
    }
  }
  function drawHud(ships) {
    var W = stage.W, H = stage.H;
    ctx.textBaseline = 'top';
    // Kill feed, top left.
    ctx.textAlign = 'left';
    ctx.font = '800 13px ui-sans-serif, system-ui, sans-serif';
    feed.forEach(function (f, i) {
      var y = 12 + i * 20, x = 12;
      ctx.globalAlpha = Math.min(1, f.t);
      ctx.fillStyle = f.me ? 'rgba(255,211,107,0.18)' : 'rgba(0,0,0,0.45)';
      var txt = (f.k ? f.k + '  ⟶  ' : '') + f.v;
      ctx.fillRect(x - 4, y - 2, ctx.measureText(txt).width + 8, 18);
      if (f.k) { ctx.fillStyle = f.kc; ctx.fillText(f.k, x, y); x += ctx.measureText(f.k + '  ').width; ctx.fillStyle = '#ffffff'; ctx.fillText('⟶', x, y); x += ctx.measureText('⟶  ').width; }
      ctx.fillStyle = f.vc; ctx.fillText(f.v, x, y);
      ctx.globalAlpha = 1;
    });
    // Leaderboard, top right.
    var lw = Math.min(210, W * 0.42), lx = W - lw - 10, ly = 52;
    ctx.fillStyle = 'rgba(4,8,24,0.65)'; ctx.fillRect(lx, ly, lw, 22 + lb.length * 18);
    ctx.font = '900 12px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#ffd36b'; ctx.textAlign = 'left';
    ctx.fillText('LEADERBOARD', lx + 8, ly + 6);
    ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
    lb.forEach(function (row, i) {
      var y = ly + 24 + i * 18;
      ctx.fillStyle = row[0] === myId ? '#ffffff' : '#aab3d6';
      ctx.textAlign = 'left';
      var nm = (i === 0 ? '👑 ' : (i + 1) + '. ') + nameOf(row[0]);
      ctx.fillText(nm.length > 18 ? nm.slice(0, 17) + '…' : nm, lx + 8, y);
      ctx.textAlign = 'right'; ctx.fillText(String(row[1]), lx + lw - 8, y);
    });
    // Minimap, bottom right.
    var ms = Math.min(130, W * 0.26), mx = W - ms - 10, my = H - ms - 10, k = ms / world.size;
    ctx.fillStyle = 'rgba(4,8,24,0.7)'; ctx.fillRect(mx, my, ms, ms);
    ctx.strokeStyle = '#ff3d6e'; ctx.lineWidth = 1.5; ctx.strokeRect(mx, my, ms, ms);
    ctx.fillStyle = 'rgba(143,107,255,0.45)';
    world.rocks.forEach(function (r) { ctx.beginPath(); ctx.arc(mx + r.x * k, my + r.y * k, Math.max(2, r.r * k), 0, M.TAU); ctx.fill(); });
    ships.forEach(function (s) {
      if (s.flags & 4 && s.id !== myId) { ctx.fillStyle = '#ffd36b'; ctx.fillRect(mx + s.x * k - 3, my + s.y * k - 3, 6, 6); }
    });
    if (local && me && me.alive) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(mx + local.x * k, my + local.y * k, 3.5, 0, M.TAU); ctx.fill(); }
    if (!me) return;
    // Score, level bar, boost and power, bottom centre.
    var bw = Math.min(360, W * 0.5), bx = (W - bw) / 2, by = H - 74;
    ctx.textAlign = 'center';
    ctx.font = '900 18px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#ffffff';
    ctx.fillText('Score ' + me.score + '  ·  ' + me.kills + ' kills', W / 2, by - 44);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by - 20, bw, 14);
    ctx.fillStyle = '#ffd36b'; ctx.fillRect(bx, by - 20, bw * Math.min(1, me.xp / me.next), 14);
    ctx.font = '900 11px ui-sans-serif, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    var lvTxt = 'LEVEL ' + me.level + (CLASSES[me.cls] ? ' ' + CLASSES[me.cls].name.toUpperCase() : '');
    ctx.strokeText(lvTxt, W / 2, by - 19); ctx.fillStyle = '#ffffff'; ctx.fillText(lvTxt, W / 2, by - 19);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by - 2, bw, 8);
    ctx.fillStyle = me.hp / me.maxHp > 0.35 ? '#7dff9e' : '#ff3d6e'; ctx.fillRect(bx, by - 2, bw * me.hp / me.maxHp, 8);
    ctx.font = '800 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = me.boostCd > 0 ? '#7f8bb8' : '#5ef1ff';
    ctx.fillText(me.boostCd > 0 ? 'Boost in ' + me.boostCd.toFixed(1) + 's' : 'BOOST READY' + (input.touch ? '' : ' (Space)'), W / 2 - (me.power ? 80 : 0), by + 10);
    if (me.power) { var pl = POWER_LOOK[me.power]; ctx.fillStyle = pl[1]; ctx.fillText(pl[2] + ' ' + me.powerT + 's', W / 2 + 80, by + 10); }
    if (DEBUG) { ctx.textAlign = 'left'; ctx.fillStyle = '#7dff9e'; ctx.font = '700 11px monospace'; ctx.fillText(Math.round(loop.fps) + ' fps · ' + Math.round(net.rtt) + ' ms', 10, H - 18); }
    if (toast) {
      var ta = Math.min(1, toast.t * 3, (toast.max - toast.t) * 8);
      ctx.globalAlpha = ta;
      var size = Math.min(46, W / (toast.text.length * 0.6));
      ctx.font = '900 ' + size + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(toast.text, W / 2, H * 0.3);
      ctx.fillStyle = toast.color; ctx.fillText(toast.text, W / 2, H * 0.3);
      ctx.globalAlpha = 1;
    }
    if (hurtFlash > 0) {
      var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,0,40,0)'); g.addColorStop(1, 'rgba(255,0,40,' + hurtFlash * 1.6 + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }
  function drawRightStick() {
    if (!right.on) return;
    ctx.save();
    ctx.globalAlpha = 0.35; ctx.strokeStyle = '#ff5ec8'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(right.ox, right.oy, 60, 0, M.TAU); ctx.stroke();
    var dx = right.x - right.ox, dy = right.y - right.oy, d = Math.hypot(dx, dy), k = d > 60 ? 60 / d : 1;
    ctx.globalAlpha = 0.6; ctx.fillStyle = '#ff5ec8';
    ctx.beginPath(); ctx.arc(right.ox + dx * k, right.oy + dy * k, 24, 0, M.TAU); ctx.fill();
    ctx.restore();
  }

  function render() {
    var t = performance.now() / 1000;
    var level = me ? me.level : 1;
    cam.zoom = M.clamp(Math.min(stage.W, stage.H) / 820, 0.55, 1.15) * (1 - Math.min(level, LEVEL_MAX) * 0.005);
    cam.apply(ctx, stage);
    var v = cam.view(stage, 80);
    drawBackground(v);
    drawOrbsAndPowers(v, t);
    drawBullets(v);
    var ships = state === 'menu' ? [] : interpShips();
    ships.forEach(function (s) {
      if (s.id === myId) return;
      if (s.x < v.l - 60 || s.x > v.r + 60 || s.y < v.t - 60 || s.y > v.b + 60) return;
      drawShip(s, false, t);
    });
    if (me && me.alive && local) {
      var mine = ships.filter(function (s) { return s.id === myId; })[0];
      drawShip({ id: myId, x: local.x, y: local.y, a: aim.a, hp: 100, level: me.level, cls: me.cls, flags: mine ? mine.flags : 0, emote: mine ? mine.emote : -1 }, true, t);
    }
    fx.draw(ctx, v);
    pop.draw(ctx);
    cam.screen(ctx, stage);
    if (state === 'play' || state === 'dead') { drawHud(ships); input.drawStick(ctx); drawRightStick(); }
  }

  var loop = K.createLoop(update, render);

  // ================= Menu and wiring =================
  $('quick').addEventListener('click', function () { if (state !== 'menu') return; net.quickIndex = 1; connect('q1'); });
  $('private').addEventListener('click', function () {
    if (state !== 'menu') return;
    var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', code = '';
    for (var i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    connect('p-' + code);
  });
  $('join').addEventListener('click', function () {
    var code = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) return setErr('Room codes have 5 letters and numbers.');
    if (state === 'menu') connect('p-' + code);
  });
  $('respawn').addEventListener('click', respawn);
  $('to-menu').addEventListener('click', leave);
  $('btn-leave').addEventListener('click', leave);
  $('btn-auto').addEventListener('click', toggleAuto);
  $('btn-boost').addEventListener('pointerdown', function (e) { e.preventDefault(); boost(); });
  $('btn-mute').addEventListener('click', function () { var m = sound.toggleUser(); $('btn-mute').style.opacity = m ? 0.4 : 1; });
  $('btn-mute').style.opacity = sound.isUserMuted() ? 0.4 : 1;
  $('btn-invite').addEventListener('click', function () {
    var code = net.room.slice(2);
    var link = sdk.has() ? sdk.BG.game.inviteLink({ room: code }) : location.href.split('?')[0] + '?room=' + code;
    var done = function () { showToast('Invite link copied! Code ' + code, '#5ef1ff', 2.5); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { showToast('Room code: ' + code, '#5ef1ff', 4); });
    else showToast('Room code: ' + code, '#5ef1ff', 4);
  });
  $('code').addEventListener('keydown', function (e) { e.stopPropagation(); if (e.code === 'Enter') $('join').click(); });

  function guestName() {
    var n = null;
    try { n = localStorage.getItem('neon-rift-guest'); } catch (e) { /* storage blocked */ }
    if (!n) { n = 'Pilot' + Math.floor(1000 + Math.random() * 9000); try { localStorage.setItem('neon-rift-guest', n); } catch (e) { /* storage blocked */ } }
    return n;
  }
  myName = guestName();
  $('who').textContent = myName;
  sdk.init().then(function () {
    if (sdk.user && sdk.user.username) { myName = sdk.user.username; $('who').textContent = myName; }
    return sdk.get('best');
  }).then(function (b) {
    if (typeof b === 'number') bestScore = b;
    sdk.loaded();
    // Opened from a friend's invite: go straight into their room.
    var invite = (sdk.has() && sdk.BG.game.getInviteParam('room')) || params.get('room');
    if (invite && /^[A-Z0-9]{5}$/.test(invite)) { $('code').value = invite; connect('p-' + invite); }
  });
  if (DEBUG) window.__nr = { state: function () { return state; }, me: function () { return me; }, net: net, local: function () { return local; }, aim: aim, world: world, lb: function () { return lb; }, ships: function () { return snaps.length ? snaps[snaps.length - 1].ships.size : 0; } };
})();

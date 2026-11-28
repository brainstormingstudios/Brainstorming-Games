/* Last Light: horde survival. A Brainstorming Games original, built on BS Kit. */
(function () {
  'use strict';
  var K = window.BSKit, M = K.M;
  var $ = function (id) { return document.getElementById(id); };
  var DEBUG = /[?&]debug=1/.test(location.search);

  // ================= Setup =================
  var stage = K.createStage($('c'), { designSize: 760 });
  var ctx = stage.ctx;
  var input = K.createInput(stage.canvas, { wholeScreenStick: true });
  var cam = K.createCamera();
  var fx = K.createParticles(1500);
  var pop = K.createPopups(45);
  var sound = K.createSound();
  var sdk = K.createSdk(sound, { onAdStart: function () { if (state === 'play') pauseGame(); } });
  var save = K.createSave(sdk, 'last-light', {
    coins: 0, best: 0, bestTime: 0, wins: 0, runs: 0,
    heroes: ['nova'], maps: ['city'], hero: 'nova', map: 'city',
    perm: { hp: 0, dmg: 0, xp: 0, greed: 0 },
  });

  // ================= Content =================
  var HEROES = {
    nova: { name: 'Nova', color: '#5ef1ff', hp: 100, speed: 1, armor: 0, start: 'bolt', cost: 0, perk: 'Pulse Bolt · +10% XP', xp: 0.1 },
    blaze: { name: 'Blaze', color: '#ff7a3d', hp: 140, speed: 0.93, armor: 1, start: 'flame', cost: 400, perk: 'Flame Wave · tough, 140 health' },
    volt: { name: 'Volt', color: '#ffe14d', hp: 85, speed: 1.16, armor: 0, start: 'chain', cost: 700, perk: 'Chain Spark · the fastest hero' },
    warden: { name: 'Warden', color: '#b47bff', hp: 115, speed: 1, armor: 2, start: 'orbit', cost: 1200, perk: 'Orbit Blades · heavy armour' },
  };
  var MAPS = {
    city: { name: 'Neon City', bg: '#060818', grid: '#141d46', accent: '#2a3d8f', cost: 0, coin: 1, speed: 1, info: 'Where it begins.' },
    wastes: { name: 'Crimson Wastes', bg: '#12050a', grid: '#3a0e1c', accent: '#7a1a33', cost: 900, coin: 1.5, speed: 1.05, info: 'More brutes · coins x1.5' },
    void: { name: 'The Void', bg: '#020204', grid: '#1c1430', accent: '#4a2d7a', cost: 2000, coin: 2, speed: 1.15, info: 'Faster enemies · coins x2' },
  };
  var PERMS = {
    hp: { name: 'Vitality', info: '+10 max health', costs: [100, 200, 350, 550, 800] },
    dmg: { name: 'Power', info: '+5% damage', costs: [120, 240, 400, 620, 900] },
    xp: { name: 'Wisdom', info: '+6% XP', costs: [100, 200, 350, 550, 800] },
    greed: { name: 'Greed', info: '+10% coins', costs: [80, 160, 300, 480, 700] },
  };

  // Weapons: 8 to find, 4 evolutions. Values per level 1..5.
  var WEAPONS = {
    bolt: { name: 'Pulse Bolt', icon: '•', color: '#5ef1ff', info: 'Fires at the nearest enemy.', dmg: [16, 20, 25, 31, 38], cd: [0.7, 0.62, 0.56, 0.5, 0.44], n: [1, 1, 2, 2, 3], pierce: [1, 1, 1, 2, 2] },
    orbit: { name: 'Orbit Blades', icon: '✦', color: '#b47bff', info: 'Blades circle around you.', dmg: [10, 13, 15, 18, 22], n: [2, 2, 3, 4, 5] },
    nova: { name: 'Nova Ring', icon: '◎', color: '#ff5ec8', info: 'A blast around you that throws enemies back.', dmg: [18, 24, 30, 37, 45], cd: [3, 2.7, 2.5, 2.2, 2], rad: [120, 140, 155, 175, 200] },
    chain: { name: 'Chain Spark', icon: 'ϟ', color: '#ffe14d', info: 'Lightning that jumps between enemies.', dmg: [14, 17, 21, 26, 32], cd: [1.4, 1.25, 1.1, 0.95, 0.8], jumps: [3, 4, 5, 6, 7] },
    flame: { name: 'Flame Wave', icon: '▲', color: '#ff7a3d', info: 'A stream of fire where you move.', dmg: [5, 6, 7, 9, 11], n: [1, 1, 2, 2, 3] },
    missile: { name: 'Seeker Missiles', icon: '➹', color: '#ff3d5a', info: 'Homing missiles that explode.', dmg: [25, 30, 38, 46, 55], cd: [2.2, 2, 1.8, 1.6, 1.4], n: [1, 1, 2, 2, 3] },
    frost: { name: 'Frost Field', icon: '❄', color: '#9fe8ff', info: 'A cold aura that hurts and slows.', dmg: [4, 5, 6, 8, 10], rad: [80, 90, 100, 115, 130], slow: [0.3, 0.35, 0.4, 0.45, 0.5] },
    rail: { name: 'Railbeam', icon: '═', color: '#7dff9e', info: 'A beam that cuts through everything.', dmg: [40, 50, 60, 75, 90], cd: [2.5, 2.3, 2.1, 1.8, 1.6], n: [1, 1, 1, 2, 2] },
  };
  var EVOS = {
    storm: { from: 'bolt', need: 'twin', name: 'Storm Barrage', icon: '⁂', color: '#aef9ff', info: 'A non-stop storm of piercing bolts.' },
    saw: { from: 'orbit', need: 'boots', name: 'Saw Halo', icon: '✺', color: '#d6a8ff', info: 'Eight huge blades spinning at full speed.' },
    supernova: { from: 'nova', need: 'bigbang', name: 'Supernova', icon: '☀', color: '#ff9be0', info: 'A blast that fills the screen.' },
    thunder: { from: 'chain', need: 'overclock', name: 'Thunder God', icon: '⚡', color: '#fff27a', info: 'Lightning strikes again and again.' },
  };
  var PASSIVES = {
    power: { name: 'Power Core', icon: '✚', color: '#ff5e7a', info: '+12% damage', max: 5 },
    overclock: { name: 'Overclock', icon: '⟳', color: '#ffe14d', info: '8% faster weapons', max: 5 },
    magnet: { name: 'Magnet', icon: '∪', color: '#5ef1ff', info: '+35% pick-up range', max: 5 },
    boots: { name: 'Swift Boots', icon: '»', color: '#7dff9e', info: '+10% move speed', max: 5 },
    armor: { name: 'Armour Plate', icon: '▣', color: '#9aa0c4', info: 'Take 1 less damage per hit', max: 5 },
    bigbang: { name: 'Big Bang', icon: '◉', color: '#ff9be0', info: '+12% weapon area', max: 5 },
    twin: { name: 'Twin Shot', icon: '‖', color: '#aef9ff', info: '+1 projectile', max: 3 },
    heart: { name: 'Heart', icon: '♥', color: '#ff3d6e', info: '+20 max health and healing over time', max: 5 },
  };
  var MAX_SLOTS = 6;

  var ENEMIES = {
    crawler: { r: 12, hp: 14, speed: 72, dmg: 8, xp: 1, color: '#ff3d6e', shape: 'tri' },
    runner: { r: 10, hp: 8, speed: 138, dmg: 6, xp: 1, color: '#ffb13d', shape: 'dart' },
    brute: { r: 22, hp: 95, speed: 52, dmg: 16, xp: 5, color: '#a14dff', shape: 'hex', heavy: true },
    spitter: { r: 14, hp: 32, speed: 62, dmg: 8, xp: 3, color: '#3dff9e', shape: 'sq', ranged: true },
    exploder: { r: 13, hp: 22, speed: 98, dmg: 6, xp: 2, color: '#ff6a00', shape: 'star', bomb: true },
    ghost: { r: 13, hp: 42, speed: 118, dmg: 12, xp: 3, color: '#9fe8ff', shape: 'ghost' },
  };
  var BOSSES = [
    { at: 300, id: 'hive', name: 'HIVE MOTHER', hp: 3500, r: 50, speed: 62, dmg: 22, color: '#ff3d9a' },
    { at: 600, id: 'colossus', name: 'IRON COLOSSUS', hp: 15000, r: 66, speed: 42, dmg: 30, color: '#ff9d2e' },
    { at: 900, id: 'eclipse', name: 'THE ECLIPSE', hp: 40000, r: 58, speed: 78, dmg: 34, color: '#e9d8ff' },
  ];

  // ================= State =================
  var state = 'menu'; // menu | play | levelup | pause | over
  var P, S, enemies, bullets, shots, gems, items, beams, bolts, telegraphs, weapons, passives;
  var time, kills, combo, comboT, bestCombo, coinsRun, bossIndex, boss, bossesKilled, spawnAcc, eventT, eliteT;
  var pendingLevels, revived, won, endTimer, banner, flash;
  var grid = K.createGrid(64);
  // Slower phones get fewer enemies on screen (each one tougher), so the game stays smooth.
  var enemyCap = 620, slowFor = 0;
  function adaptToDevice(dt) {
    if (DEBUG && window.__auto) return;
    if (loop.fps < 45) slowFor += dt; else slowFor = Math.max(0, slowFor - dt * 0.5);
    if (slowFor > 3 && enemyCap > 260) { enemyCap = Math.round(enemyCap * 0.85); slowFor = 0; }
  }
  var nextId = 1;

  function newRun() {
    var hero = HEROES[save.data.hero] || HEROES.nova;
    P = { x: 0, y: 0, r: 14, hp: 1, vx: 0, vy: 0, fx: 1, fy: 0, xp: 0, level: 1, next: xpFor(1), invuln: 0, hero: hero, hurtT: 0 };
    weapons = []; passives = {};
    enemies = []; bullets = []; shots = []; gems = []; items = []; beams = []; bolts = []; telegraphs = [];
    time = 0; kills = 0; combo = 0; comboT = 0; bestCombo = 0; coinsRun = 0;
    bossIndex = 0; boss = null; bossesKilled = 0; spawnAcc = 0; eventT = 75; eliteT = 45;
    pendingLevels = 0; revived = false; won = false; endTimer = -1; banner = null; flash = 0;
    fx.clear(); pop.clear();
    addWeapon(hero.start);
    recalc();
    P.hp = S.maxHp;
    cam.x = 0; cam.y = 0;
  }
  function xpFor(level) { return Math.floor(6 + level * 6 + level * level * 1.4); }

  function plv(id) { return passives[id] || 0; }
  function recalc() {
    var hero = P.hero, perm = save.data.perm;
    S = {
      dmg: (1 + 0.12 * plv('power') + 0.05 * perm.dmg),
      cd: Math.pow(0.92, plv('overclock')),
      area: 1 + 0.12 * plv('bigbang'),
      proj: plv('twin'),
      speed: 200 * hero.speed * (1 + 0.1 * plv('boots')),
      magnet: 95 * (1 + 0.35 * plv('magnet')),
      armor: hero.armor + plv('armor'),
      maxHp: hero.hp + perm.hp * 10 + 20 * plv('heart'),
      regen: 0.5 * plv('heart'),
      xp: 1 + 0.06 * perm.xp + (hero.xp || 0),
      greed: (1 + 0.1 * perm.greed) * MAPS[save.data.map].coin,
    };
    if (P.hp > S.maxHp) P.hp = S.maxHp;
  }
  function weaponDef(w) { return w.evo ? EVOS[w.id] : WEAPONS[w.id]; }
  function addWeapon(id) { weapons.push({ id: id, level: 1, t: 0.4, evo: false, a: 0 }); }
  function findWeapon(id) { for (var i = 0; i < weapons.length; i++) if (weapons[i].id === id) return weapons[i]; return null; }
  function lv(w, key) { var arr = WEAPONS[w.id][key]; return arr[Math.min(w.level, 5) - 1]; }

  // ================= Damage =================
  function hurtEnemy(e, dmg, kx, ky, kb) {
    if (e.dead) return;
    dmg *= S.dmg;
    var crit = Math.random() < 0.08;
    if (crit) dmg *= 2;
    e.hp -= dmg;
    e.flash = 0.08;
    if (kb && !e.boss) {
      var k = e.heavy ? kb * 0.35 : kb;
      e.kx += kx * k; e.ky += ky * k;
    }
    if (crit || dmg >= 30 || e.boss) pop.add(e.x, e.y - e.r, Math.round(dmg), crit ? '#ffd36b' : '#ffffff', crit ? 20 : 15);
    sound.play('hit');
    if (e.hp <= 0) killEnemy(e);
  }
  function killEnemy(e) {
    e.dead = true;
    kills++;
    combo++; comboT = 2.2;
    if (combo > bestCombo) bestCombo = combo;
    if (combo === 50 || combo === 150 || combo === 300 || combo === 600 || combo === 1000) {
      var words = { 50: 'RAMPAGE!', 150: 'UNSTOPPABLE!', 300: 'GODLIKE!', 600: 'APOCALYPSE!', 1000: 'LAST LIGHT!' };
      showBanner(words[combo], '#ffd36b', 1.4);
      sound.play('levelup');
    }
    fx.burst(e.x, e.y, e.boss ? 80 : e.r > 18 ? 18 : 9, { color: e.color, speed: e.boss ? 520 : 260, life: 0.5, size: 5 });
    sound.play('kill');
    if (e.boss) return bossDown(e);
    var xp = e.xp * (1 + time / 1200);
    dropGem(e.x, e.y, xp);
    var roll = Math.random();
    if (e.elite) { items.push(item('chest', e.x, e.y)); fx.ring(e.x, e.y, 80, '#ffd36b', 0.5); }
    else if (roll < 0.012) items.push(item('heart', e.x, e.y));
    else if (roll < 0.016) items.push(item('magnet', e.x, e.y));
    else if (roll < 0.0185) items.push(item('bomb', e.x, e.y));
    else if (roll < 0.045) items.push(item('coin', e.x, e.y, M.randInt(1, 3)));
  }
  function dropGem(x, y, xp) {
    if (gems.length > 420) {
      // Too many gems on the floor: add the XP to an old one instead of making a new one.
      var g = gems[M.randInt(0, gems.length - 1)];
      g.v += xp; g.big = g.v >= 20;
      return;
    }
    gems.push({ x: x + M.rand(-5, 5), y: y + M.rand(-5, 5), v: xp, big: xp >= 20, pull: false });
  }
  function item(kind, x, y, v) { return { kind: kind, x: x, y: y, v: v || 0, t: 0, pull: false }; }

  function hurtPlayer(dmg) {
    if (P.invuln > 0 || state !== 'play' || endTimer >= 0) return;
    if (DEBUG && window.__god) return;
    dmg = Math.max(1, dmg - S.armor);
    P.hp -= dmg;
    if (DEBUG) window.__minHp = Math.min(window.__minHp == null ? 1e9 : window.__minHp, P.hp);
    P.invuln = 0.28;
    P.hurtT = 0.25;
    flash = 0.25;
    cam.shake(7);
    sound.play('hurt');
    pop.add(P.x, P.y - 24, '-' + Math.round(dmg), '#ff3d6e', 18);
    if (P.hp <= 0) { P.hp = 0; playerDown(); }
  }
  function explode(x, y, radius, dmg, color, hurtsPlayer) {
    fx.ring(x, y, radius, color, 0.4, 8);
    fx.burst(x, y, 22, { color: color, speed: radius * 4, life: 0.45, size: 6 });
    cam.shake(Math.min(14, radius / 8));
    sound.play('boom');
    grid.query(x, y, radius + 30, function (e) {
      if (!e.dead && M.dist2(x, y, e.x, e.y) < (radius + e.r) * (radius + e.r)) {
        var a = M.angle(x, y, e.x, e.y);
        hurtEnemy(e, dmg, Math.cos(a), Math.sin(a), 260);
      }
    });
    if (hurtsPlayer && M.dist2(x, y, P.x, P.y) < (radius + P.r) * (radius + P.r)) hurtPlayer(dmg);
  }

  // ================= Weapons =================
  function nearestEnemy(x, y, maxD, skip) {
    var best = null, bd = maxD * maxD;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead || (skip && skip.indexOf(e) >= 0)) continue;
      var d = M.dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  /** Aimed weapons go for the boss when it is close enough, so boss fights do not drag on. */
  function aimTarget(range) {
    if (boss && !boss.dead && M.dist2(P.x, P.y, boss.x, boss.y) < range * range) return boss;
    return nearestEnemy(P.x, P.y, range);
  }
  function randomVisibleEnemy() {
    var v = cam.view(stage, -20), pool = [];
    for (var i = 0; i < enemies.length && pool.length < 40; i++) {
      var e = enemies[i];
      if (!e.dead && e.x > v.l && e.x < v.r && e.y > v.t && e.y < v.b) pool.push(e);
    }
    if (boss && !boss.dead) pool.push(boss);
    return pool.length ? M.pick(pool) : null;
  }
  function shoot(x, y, a, speed, o) {
    shots.push({ x: x, y: y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: o.r || 6, dmg: o.dmg, pierce: o.pierce || 1, life: o.life || 1.4, color: o.color, kind: o.kind || 'bolt', hit: [], target: o.target || null, boom: o.boom || 0, turn: o.turn || 0 });
  }

  function tickWeapon(w, dt) {
    var def = weaponDef(w);
    w.t -= dt;
    var cdMul = S.cd;
    switch (w.evo ? w.id : w.id) {
      case 'bolt': {
        if (w.t > 0) return;
        var target = aimTarget(560);
        if (!target) { w.t = 0.1; return; }
        w.t = lv(w, 'cd') * cdMul;
        var n = lv(w, 'n') + S.proj, base = M.angle(P.x, P.y, target.x, target.y);
        for (var i = 0; i < n; i++) {
          var a = base + (i - (n - 1) / 2) * 0.16;
          shoot(P.x, P.y, a, 560, { dmg: lv(w, 'dmg'), pierce: lv(w, 'pierce'), color: def.color, r: 6 });
        }
        sound.play('shoot');
        return;
      }
      case 'storm': {
        if (w.t > 0) return;
        var t2 = aimTarget(620);
        w.t = 0.26 * cdMul;
        var base2 = t2 ? M.angle(P.x, P.y, t2.x, t2.y) : w.a;
        w.a += 0.7;
        var n2 = 3 + S.proj;
        for (var j = 0; j < n2; j++) shoot(P.x, P.y, base2 + (j - (n2 - 1) / 2) * 0.13, 680, { dmg: 34, pierce: 3, color: def.color, r: 7 });
        sound.play('shoot');
        return;
      }
      case 'orbit':
      case 'saw': {
        var evo = w.id === 'saw';
        var count = evo ? 8 : lv(w, 'n') + S.proj;
        var rad = (evo ? 100 : 72) * S.area;
        var dmgO = evo ? 30 : lv(w, 'dmg');
        w.a += dt * (evo ? 5.2 : 3.3);
        w.blades = [];
        for (var b = 0; b < count; b++) {
          var ang = w.a + (b / count) * M.TAU;
          var bx = P.x + Math.cos(ang) * rad, by = P.y + Math.sin(ang) * rad;
          w.blades.push({ x: bx, y: by, a: ang });
          grid.query(bx, by, 40, function (e) {
            if (e.dead || (e.orbitT || 0) > time) return;
            var rr = e.r + (evo ? 20 : 14);
            if (M.dist2(bx, by, e.x, e.y) < rr * rr) {
              e.orbitT = time + 0.42;
              var ka = M.angle(P.x, P.y, e.x, e.y);
              hurtEnemy(e, dmgO, Math.cos(ka), Math.sin(ka), 160);
            }
          });
          if (boss && !boss.dead && (boss.orbitT || 0) < time && M.dist2(bx, by, boss.x, boss.y) < Math.pow(boss.r + 16, 2)) { boss.orbitT = time + 0.42; hurtEnemy(boss, dmgO, 0, 0, 0); }
        }
        return;
      }
      case 'nova':
      case 'supernova': {
        if (w.t > 0) return;
        var sup = w.id === 'supernova';
        w.t = (sup ? 1.6 : lv(w, 'cd')) * cdMul;
        var radN = (sup ? 320 : lv(w, 'rad')) * S.area, dmgN = sup ? 80 : lv(w, 'dmg');
        fx.ring(P.x, P.y, radN, def.color, 0.45, sup ? 14 : 8);
        if (sup) fx.ring(P.x, P.y, radN * 0.6, '#ffffff', 0.35, 6);
        cam.shake(sup ? 8 : 3);
        sound.play(sup ? 'boom' : 'whoosh');
        grid.query(P.x, P.y, radN + 30, function (e) {
          if (!e.dead && M.dist2(P.x, P.y, e.x, e.y) < Math.pow(radN + e.r, 2)) {
            var na = M.angle(P.x, P.y, e.x, e.y);
            hurtEnemy(e, dmgN, Math.cos(na), Math.sin(na), sup ? 420 : 320);
          }
        });
        if (boss && !boss.dead && M.dist2(P.x, P.y, boss.x, boss.y) < Math.pow(radN + boss.r, 2)) hurtEnemy(boss, dmgN, 0, 0, 0);
        return;
      }
      case 'chain':
      case 'thunder': {
        if (w.t > 0) return;
        var th = w.id === 'thunder';
        w.t = (th ? 0.5 : lv(w, 'cd')) * cdMul;
        var strikes = th ? 3 : 1, jumps = th ? 10 : lv(w, 'jumps') + S.proj, dmgC = th ? 45 : lv(w, 'dmg');
        for (var s = 0; s < strikes; s++) {
          var first = s === 0 ? aimTarget(480) : randomVisibleEnemy();
          if (!first) break;
          var chain = [first], cx = P.x, cy = P.y, cur = first;
          var path = [{ x: cx, y: cy }];
          for (var jn = 0; jn < jumps && cur; jn++) {
            path.push({ x: cur.x, y: cur.y });
            hurtEnemy(cur, dmgC, 0, 0, 0);
            var nx = nearestEnemy(cur.x, cur.y, 170 * S.area, chain);
            if (nx) chain.push(nx);
            cur = nx;
          }
          bolts.push({ path: path, t: 0.18, color: def.color });
          fx.burst(first.x, first.y, 6, { color: def.color, speed: 200, life: 0.3, size: 4 });
        }
        sound.play('zap');
        return;
      }
      case 'flame': {
        if (w.t > 0) return;
        w.t = 0.11 * cdMul;
        var dir = Math.atan2(P.fy, P.fx);
        var nf = lv(w, 'n') + S.proj;
        for (var f = 0; f < nf; f++) {
          var fa = dir + M.rand(-0.32, 0.32) + (f - (nf - 1) / 2) * 0.35;
          shoot(P.x + P.fx * 10, P.y + P.fy * 10, fa, M.rand(330, 420) * Math.sqrt(S.area), { dmg: lv(w, 'dmg'), pierce: 99, color: '#ff7a3d', r: 12 * S.area, life: 0.38, kind: 'flame' });
        }
        return;
      }
      case 'missile': {
        if (w.t > 0) return;
        w.t = lv(w, 'cd') * cdMul;
        var nm = lv(w, 'n') + S.proj;
        for (var mi = 0; mi < nm; mi++) {
          var tgt = (boss && !boss.dead && mi % 2 === 0) ? boss : randomVisibleEnemy() || nearestEnemy(P.x, P.y, 800);
          shoot(P.x, P.y, M.rand(0, M.TAU), 260, { dmg: lv(w, 'dmg'), pierce: 1, color: def.color, r: 7, life: 3, kind: 'missile', target: tgt, boom: 62 * S.area, turn: 7 });
        }
        sound.play('whoosh');
        return;
      }
      case 'frost': {
        var radF = lv(w, 'rad') * S.area;
        w.rad = radF;
        if (w.t > 0) return;
        w.t = 0.5;
        var dmgF = lv(w, 'dmg'), slow = lv(w, 'slow');
        grid.query(P.x, P.y, radF + 30, function (e) {
          if (!e.dead && M.dist2(P.x, P.y, e.x, e.y) < Math.pow(radF + e.r, 2)) {
            e.slowT = 0.6; e.slowAmt = slow;
            hurtEnemy(e, dmgF, 0, 0, 0);
          }
        });
        if (boss && !boss.dead && M.dist2(P.x, P.y, boss.x, boss.y) < Math.pow(radF + boss.r, 2)) hurtEnemy(boss, dmgF, 0, 0, 0);
        return;
      }
      case 'rail': {
        if (w.t > 0) return;
        var tr = aimTarget(700);
        if (!tr) { w.t = 0.2; return; }
        w.t = lv(w, 'cd') * cdMul;
        var nr = lv(w, 'n') + Math.floor(S.proj / 2);
        var baseR = M.angle(P.x, P.y, tr.x, tr.y);
        for (var ri = 0; ri < nr; ri++) fireBeam(baseR + ri * Math.PI / Math.max(1, nr) * (nr > 1 ? 1 : 0), lv(w, 'dmg'), 16 * S.area, def.color);
        sound.play('laser');
        cam.shake(4);
        return;
      }
    }
  }
  function fireBeam(a, dmg, width, color) {
    var len = 1500, ex = P.x + Math.cos(a) * len, ey = P.y + Math.sin(a) * len;
    beams.push({ x1: P.x, y1: P.y, x2: ex, y2: ey, w: width, t: 0.22, color: color });
    var dx = Math.cos(a), dy = Math.sin(a);
    function check(e) {
      if (e.dead) return;
      var px = e.x - P.x, py = e.y - P.y, along = px * dx + py * dy;
      if (along < 0 || along > len) return;
      var off = Math.abs(px * dy - py * dx);
      if (off < width + e.r) hurtEnemy(e, dmg, dx, dy, 120);
    }
    for (var i = 0; i < enemies.length; i++) check(enemies[i]);
    if (boss) check(boss);
  }

  // ================= Level-ups =================
  function options() {
    var list = [];
    var wCount = weapons.length, pCount = Object.keys(passives).length;
    // Evolutions first: they are the big moments.
    for (var id in EVOS) {
      var evo = EVOS[id], w = findWeapon(evo.from);
      if (w && !w.evo && w.level >= 5 && plv(evo.need) > 0) list.push({ type: 'evo', id: id, weight: 1000 });
    }
    weapons.forEach(function (w2) { if (!w2.evo && w2.level < 5) list.push({ type: 'wup', id: w2.id, weight: 10 }); });
    if (wCount < MAX_SLOTS) for (var wid in WEAPONS) if (!findWeapon(wid) && !weapons.some(function (x) { return x.evo && EVOS[x.id].from === wid; })) list.push({ type: 'wnew', id: wid, weight: 6 });
    for (var pid in PASSIVES) {
      var have = plv(pid);
      if (have > 0 && have < PASSIVES[pid].max) list.push({ type: 'pup', id: pid, weight: 8 });
      else if (!have && pCount < MAX_SLOTS) list.push({ type: 'pnew', id: pid, weight: 5 });
    }
    var picked = [];
    var evos = list.filter(function (o) { return o.type === 'evo'; });
    if (evos.length) picked.push(evos[0]);
    var rest = list.filter(function (o) { return o.type !== 'evo'; });
    while (picked.length < 3 && rest.length) {
      var total = rest.reduce(function (s, o) { return s + o.weight; }, 0), r = Math.random() * total;
      for (var i = 0; i < rest.length; i++) { r -= rest[i].weight; if (r <= 0) { picked.push(rest.splice(i, 1)[0]); break; } }
    }
    if (!picked.length) picked.push({ type: 'heal' }, { type: 'gold' });
    return picked;
  }
  function describe(o) {
    if (o.type === 'evo') { var e = EVOS[o.id]; return { name: e.name, icon: e.icon, color: e.color, lvl: 'Evolution', info: e.info + ' Replaces ' + WEAPONS[e.from].name + '.', evo: true }; }
    if (o.type === 'wup' || o.type === 'wnew') {
      var d = WEAPONS[o.id], w = findWeapon(o.id);
      return { name: d.name, icon: d.icon, color: d.color, lvl: o.type === 'wnew' ? 'New weapon' : 'Level ' + (w.level + 1), info: o.type === 'wnew' ? d.info : upgradeText(o.id, w.level + 1) };
    }
    if (o.type === 'pup' || o.type === 'pnew') {
      var p = PASSIVES[o.id], evoHint = '';
      for (var id in EVOS) if (EVOS[id].need === o.id && findWeapon(EVOS[id].from) && !findWeapon(EVOS[id].from).evo) evoHint = ' Needed to evolve ' + WEAPONS[EVOS[id].from].name + '.';
      return { name: p.name, icon: p.icon, color: p.color, lvl: o.type === 'pnew' ? 'New' : 'Level ' + (plv(o.id) + 1), info: p.info + '.' + evoHint };
    }
    if (o.type === 'heal') return { name: 'Full heal', icon: '♥', color: '#ff3d6e', lvl: 'Bonus', info: 'Back to full health.' };
    return { name: 'Coin bag', icon: '◆', color: '#ffd36b', lvl: 'Bonus', info: '+40 coins.' };
  }
  function upgradeText(id, level) {
    var d = WEAPONS[id], i = level - 1, bits = [];
    if (d.dmg && d.dmg[i] !== d.dmg[i - 1]) bits.push('damage ' + d.dmg[i - 1] + ' → ' + d.dmg[i]);
    if (d.n && d.n[i] !== d.n[i - 1]) bits.push('+1 ' + (id === 'orbit' ? 'blade' : id === 'rail' ? 'beam' : 'shot'));
    if (d.cd && d.cd[i] !== d.cd[i - 1]) bits.push('faster');
    if (d.rad && d.rad[i] !== d.rad[i - 1]) bits.push('bigger');
    if (d.jumps && d.jumps[i] !== d.jumps[i - 1]) bits.push('+1 jump');
    if (d.pierce && d.pierce[i] !== d.pierce[i - 1]) bits.push('goes through 1 more');
    if (d.slow && d.slow[i] !== d.slow[i - 1]) bits.push('stronger slow');
    var txt = bits.join(', ');
    return txt.charAt(0).toUpperCase() + txt.slice(1) + '.' + (level === 5 ? ' Max level.' : '');
  }
  function apply(o) {
    if (o.type === 'evo') {
      var w = findWeapon(EVOS[o.id].from);
      w.id = o.id; w.evo = true; w.t = 0;
      sound.play('evolve');
      showBanner('EVOLVED: ' + EVOS[o.id].name.toUpperCase(), EVOS[o.id].color, 2);
      fx.ring(P.x, P.y, 260, EVOS[o.id].color, 0.7, 12);
    } else if (o.type === 'wup') findWeapon(o.id).level++;
    else if (o.type === 'wnew') addWeapon(o.id);
    else if (o.type === 'pup' || o.type === 'pnew') { passives[o.id] = plv(o.id) + 1; if (o.id === 'heart') P.hp += 20; }
    else if (o.type === 'heal') P.hp = S.maxHp;
    else if (o.type === 'gold') coinsRun += 40;
    recalc();
  }
  var currentOptions = [];
  function openLevelUp(fromChest) {
    state = 'levelup';
    loop.running = false;
    currentOptions = options();
    $('lu-title').textContent = fromChest ? 'TREASURE!' : 'LEVEL ' + P.level;
    $('lu-sub').textContent = input.touch ? 'Tap one to pick it.' : 'Pick one. Press 1, 2 or 3.';
    var box = $('cards');
    box.innerHTML = '';
    currentOptions.forEach(function (o, i) {
      var d = describe(o);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'card' + (d.evo ? ' evo' : '');
      b.style.setProperty('--c', d.color);
      var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = d.icon;
      var lvl = document.createElement('span'); lvl.className = 'lvl'; lvl.textContent = (i + 1) + ' · ' + d.lvl;
      var nm = document.createElement('b'); nm.textContent = d.name;
      var info = document.createElement('small'); info.textContent = d.info;
      b.append(ico, lvl, nm, info);
      b.addEventListener('click', function () { choose(i); });
      box.appendChild(b);
    });
    $('levelup').hidden = false;
    sound.play('levelup');
    if (DEBUG && window.__auto) choose(M.randInt(0, currentOptions.length - 1));
  }
  function choose(i) {
    if (state !== 'levelup' || !currentOptions[i]) return;
    apply(currentOptions[i]);
    sound.play('click');
    $('levelup').hidden = true;
    pendingLevels--;
    if (pendingLevels > 0) { openLevelUp(false); return; }
    state = 'play';
    loop.running = true;
    P.invuln = Math.max(P.invuln, 0.6);
  }

  // ================= Enemies and spawning =================
  function spawnEnemy(type, x, y, elite) {
    var t = ENEMIES[type], mapSpeed = MAPS[save.data.map].speed;
    var mm = time / 60, hpMul = (1 + mm * 0.6 + mm * mm * 0.12 + mm * mm * mm * 0.012) * (620 / enemyCap);
    var e = {
      id: nextId++, type: type, x: x, y: y, r: t.r * (elite ? 1.7 : 1), hp: t.hp * hpMul * (elite ? 9 : 1), speed: t.speed * mapSpeed * (1 + Math.min(time / 900, 0.35)) * M.rand(0.9, 1.1) * (elite ? 0.85 : 1),
      dmg: t.dmg * (1 + time / 600), xp: t.xp * (elite ? 12 : 1), color: t.color, shape: t.shape, heavy: t.heavy || elite, ranged: t.ranged, bomb: t.bomb,
      kx: 0, ky: 0, flash: 0, atk: 0, fire: M.rand(1, 2.5), fuse: -1, slowT: 0, slowAmt: 0, elite: !!elite, dead: false, wob: Math.random() * 10,
    };
    e.maxHp = e.hp;
    enemies.push(e);
    return e;
  }
  function edgePoint(extra) {
    var a = Math.random() * M.TAU;
    var d = Math.sqrt(stage.W * stage.W + stage.H * stage.H) / 2 / cam.zoom + 40 + (extra || 0);
    return { x: P.x + Math.cos(a) * d, y: P.y + Math.sin(a) * d, a: a };
  }
  function pickType() {
    var m = time / 60, map = save.data.map, pool = [['crawler', 10]];
    if (m > 0.7) pool.push(['runner', 5 + m]);
    if (m > 2.5) pool.push(['brute', (map === 'wastes' ? 4 : 2) + m * 0.4]);
    if (m > 3.5) pool.push(['spitter', 2 + m * 0.25]);
    if (m > 5.5) pool.push(['exploder', 2 + m * 0.3]);
    if (m > 8.5) pool.push(['ghost', 2 + m * 0.4]);
    var total = pool.reduce(function (s, p) { return s + p[1]; }, 0), r = Math.random() * total;
    for (var i = 0; i < pool.length; i++) { r -= pool[i][1]; if (r <= 0) return pool[i][0]; }
    return 'crawler';
  }
  function spawning(dt) {
    var m = time / 60;
    var target = Math.min(enemyCap, 20 + m * 36 + m * m * 2);
    var rate = 3 + m * 3.2;
    if (boss) { target *= 0.55; rate *= 0.6; }
    spawnAcc += rate * dt;
    while (spawnAcc >= 1) {
      spawnAcc -= 1;
      if (enemies.length < target) {
        var pt = edgePoint();
        spawnEnemy(pickType(), pt.x, pt.y, false);
      }
    }
    // An elite (tough, gold outline, drops a treasure chest) about every 50 seconds.
    eliteT -= dt;
    if (eliteT <= 0 && time > 40) {
      eliteT = M.rand(42, 58);
      var ep = edgePoint();
      spawnEnemy(m > 4 ? M.pick(['brute', 'spitter', 'crawler']) : 'crawler', ep.x, ep.y, true);
    }
    // Events: a ring of enemies closing in, or a rush from one side.
    eventT -= dt;
    if (eventT <= 0 && !boss) {
      eventT = M.rand(55, 80);
      if (Math.random() < 0.5) {
        var n = Math.min(70, 26 + Math.floor(m * 4)), rr = Math.max(stage.W, stage.H) / cam.zoom * 0.62;
        for (var i = 0; i < n; i++) { var a = (i / n) * M.TAU; spawnEnemy(m > 6 ? 'runner' : 'crawler', P.x + Math.cos(a) * rr, P.y + Math.sin(a) * rr); }
        showBanner('SURROUNDED!', '#ff3d6e', 1.6);
      } else {
        var side = edgePoint(60), nr = Math.min(60, 20 + Math.floor(m * 3));
        for (var j = 0; j < nr; j++) spawnEnemy('runner', side.x + M.rand(-140, 140), side.y + M.rand(-140, 140));
        showBanner('STAMPEDE!', '#ffb13d', 1.6);
      }
      sound.play('warn');
    }
    // Bosses.
    var nextBoss = BOSSES[bossIndex];
    if (nextBoss && !boss) {
      if (!nextBoss.warned && time >= nextBoss.at - 4) { nextBoss.warned = true; showBanner('BOSS INCOMING: ' + nextBoss.name, nextBoss.color, 3.5); sound.play('warn'); }
      if (time >= nextBoss.at) spawnBoss(nextBoss);
    }
  }
  function spawnBoss(def) {
    var pt = edgePoint(-80);
    boss = { boss: true, def: def, id: nextId++, name: def.name, x: pt.x, y: pt.y, r: def.r, hp: def.hp, maxHp: def.hp, speed: def.speed, dmg: def.dmg, color: def.color, kx: 0, ky: 0, flash: 0, atk: 0, dead: false, t1: 2, t2: 5, t3: 8, ang: 0, dash: 0, dashX: 0, dashY: 0, phase: 1, slowT: 0, slowAmt: 0 };
    bossIndex++;
    sound.setIntensity(1);
    cam.shake(12);
  }
  function enemyBullet(x, y, a, speed, dmg, color, r) {
    bullets.push({ x: x, y: y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: r || 7, dmg: dmg, life: 5, color: color || '#3dff9e' });
  }
  function updateBoss(dt) {
    var b = boss, id = b.def.id;
    b.flash = Math.max(0, b.flash - dt);
    var toP = M.angle(b.x, b.y, P.x, P.y);
    var sp = b.speed * (b.slowT > 0 ? 1 - b.slowAmt * 0.4 : 1);
    if (b.slowT > 0) b.slowT -= dt;
    b.t1 -= dt; b.t2 -= dt; b.t3 -= dt;
    if (b.hp < b.maxHp * 0.5 && b.phase === 1) { b.phase = 2; showBanner(b.name + ' IS ENRAGED', b.color, 2); sound.play('warn'); cam.shake(14); }
    var rage = b.phase === 2 ? 1.45 : 1;
    if (b.dash > 0) {
      b.dash -= dt;
      b.x += b.dashX * dt; b.y += b.dashY * dt;
      fx.spawn(b.x, b.y, { color: b.color, speed: 60, life: 0.4, size: 10 });
    } else if (b.windup > 0) {
      b.windup -= dt;
      if (b.windup <= 0) {
        var da = M.angle(b.x, b.y, P.x, P.y);
        b.dashX = Math.cos(da) * 720; b.dashY = Math.sin(da) * 720; b.dash = 0.55;
        sound.play('whoosh');
      }
    } else {
      b.x += Math.cos(toP) * sp * rage * dt;
      b.y += Math.sin(toP) * sp * rage * dt;
    }
    if (id === 'hive') {
      if (b.t1 <= 0) { b.t1 = 4 / rage; for (var i = 0; i < 9; i++) { var a = (i / 9) * M.TAU; spawnEnemy(b.phase === 2 ? 'runner' : 'crawler', b.x + Math.cos(a) * 70, b.y + Math.sin(a) * 70); } fx.ring(b.x, b.y, 90, b.color, 0.4); }
      if (b.t2 <= 0 && b.dash <= 0) { b.t2 = 5.5 / rage; b.windup = 0.8; telegraphs.push({ kind: 'line', x: b.x, y: b.y, a: toP, len: 420, w: b.r, t: 0.8, max: 0.8, color: b.color }); }
    } else if (id === 'colossus') {
      if (b.t1 <= 0) { b.t1 = 2.8 / rage; var n = b.phase === 2 ? 26 : 18, off = Math.random(); for (var j = 0; j < n; j++) enemyBullet(b.x, b.y, (j + off) / n * M.TAU, 190, 14, b.color, 9); sound.play('boom'); }
      if (b.t2 <= 0) { b.t2 = 7; b.stomp = 1.1; telegraphs.push({ kind: 'circle', x: b.x, y: b.y, r: 200, t: 1.1, max: 1.1, color: '#ff3d3d', follow: b }); }
      if (b.stomp > 0) { b.stomp -= dt; if (b.stomp <= 0) { explode(b.x, b.y, 200, 0, '#ff9d2e', false); if (M.dist2(b.x, b.y, P.x, P.y) < 220 * 220) hurtPlayer(32); cam.shake(22); } }
    } else if (id === 'eclipse') {
      b.ang += dt * (b.phase === 2 ? 2.6 : 1.7);
      if (b.t1 <= 0) { b.t1 = b.phase === 2 ? 0.09 : 0.14; var arms = b.phase === 2 ? 4 : 2; for (var k = 0; k < arms; k++) enemyBullet(b.x, b.y, b.ang + (k / arms) * M.TAU, 210, 15, '#c9a8ff', 7); }
      if (b.t2 <= 0) {
        b.t2 = 6 / rage;
        var tp = { x: P.x + M.rand(-260, 260), y: P.y + M.rand(-260, 260) };
        telegraphs.push({ kind: 'circle', x: tp.x, y: tp.y, r: b.r + 30, t: 0.7, max: 0.7, color: '#c9a8ff', onEnd: function () { fx.burst(b.x, b.y, 30, { color: '#c9a8ff', speed: 300 }); b.x = tp.x; b.y = tp.y; explode(b.x, b.y, 120, 0, '#c9a8ff', false); if (M.dist2(b.x, b.y, P.x, P.y) < 150 * 150) hurtPlayer(28); } });
      }
      if (b.t3 <= 0) { b.t3 = 9; for (var q = 0; q < 14; q++) { var qa = (q / 14) * M.TAU; spawnEnemy('ghost', P.x + Math.cos(qa) * 420, P.y + Math.sin(qa) * 420); } showBanner('THE DARK RISES', '#c9a8ff', 1.4); }
    }
    // Touching the boss hurts.
    if (M.dist2(b.x, b.y, P.x, P.y) < Math.pow(b.r + P.r, 2)) { hurtPlayer(b.dmg); var pa = M.angle(b.x, b.y, P.x, P.y); P.x += Math.cos(pa) * 30; P.y += Math.sin(pa) * 30; }
  }
  function bossDown(b) {
    bossesKilled++;
    loop.slowMo(1.4, 0.22);
    sound.play('bigboom');
    cam.shake(28);
    flash = 0.5;
    for (var i = 0; i < 4; i++) fx.ring(b.x, b.y, 160 + i * 120, i % 2 ? '#ffffff' : b.color, 0.6 + i * 0.15, 14);
    fx.burst(b.x, b.y, 120, { color: '#ffffff', speed: 700, life: 0.9, size: 7 });
    for (var c = 0; c < 18; c++) items.push(item('coin', b.x + M.rand(-60, 60), b.y + M.rand(-60, 60), 3));
    items.push(item('chest', b.x, b.y));
    dropGem(b.x, b.y, 60 + bossesKilled * 40);
    P.hp = S.maxHp;
    showBanner(b.name + ' DEFEATED', '#ffd36b', 2.5);
    boss = null;
    sound.setIntensity(Math.min(1, time / 900));
    if (b.def.id === 'eclipse') { won = true; endTimer = 2.2; }
  }

  function updateEnemies(dt) {
    grid.clear();
    for (var i = 0; i < enemies.length; i++) grid.add(enemies[i]);
    var far = Math.pow(Math.sqrt(stage.W * stage.W + stage.H * stage.H) / cam.zoom * 0.95 + 200, 2);
    for (var j = enemies.length - 1; j >= 0; j--) {
      var e = enemies[j];
      if (e.dead) { M.swapRemove(enemies, j); continue; }
      e.flash = Math.max(0, e.flash - dt);
      var sp = e.speed * (e.slowT > 0 ? 1 - e.slowAmt : 1);
      if (e.slowT > 0) e.slowT -= dt;
      var a = M.angle(e.x, e.y, P.x, P.y), d2 = M.dist2(e.x, e.y, P.x, P.y);
      // Too far behind: bring it back on the other side so the pressure stays on.
      if (d2 > far && !e.elite) { var pt = edgePoint(); e.x = pt.x; e.y = pt.y; continue; }
      var mx = Math.cos(a), my = Math.sin(a);
      if (e.ranged) {
        var d = Math.sqrt(d2);
        if (d < 230) { mx = -mx; my = -my; } else if (d < 290) { mx = -my * 0.6; my = Math.cos(a) * 0.6; }
        e.fire -= dt;
        if (e.fire <= 0 && d < 520) { e.fire = M.rand(2.2, 3); enemyBullet(e.x, e.y, a, 230, e.dmg + 2, e.color, 7); }
      }
      if (e.bomb) {
        if (e.fuse < 0 && d2 < 70 * 70) { e.fuse = 0.55; }
        if (e.fuse >= 0) {
          e.fuse -= dt; sp *= 0.2;
          if (e.fuse <= 0) { e.dead = true; explode(e.x, e.y, 80, 26, '#ff6a00', true); M.swapRemove(enemies, j); continue; }
        }
      }
      if (e.shape === 'ghost') { e.wob += dt * 4; mx += Math.cos(e.wob) * 0.4; my += Math.sin(e.wob) * 0.4; }
      e.x += (mx * sp + e.kx) * dt;
      e.y += (my * sp + e.ky) * dt;
      var kd = Math.exp(-9 * dt); e.kx *= kd; e.ky *= kd;
      // Keep enemies from stacking into one blob.
      var push = 0;
      grid.query(e.x, e.y, e.r * 2, function (o) {
        if (o === e || o.dead || push > 3) return;
        var dx = e.x - o.x, dy = e.y - o.y, dd = dx * dx + dy * dy, rr = e.r + o.r;
        if (dd > 0.01 && dd < rr * rr) {
          var dist = Math.sqrt(dd), f = (rr - dist) / dist * 0.35;
          e.x += dx * f; e.y += dy * f;
          push++;
        }
      });
      e.atk -= dt;
      if (e.atk <= 0 && d2 < Math.pow(e.r + P.r, 2)) { e.atk = 0.75; hurtPlayer(e.dmg); }
    }
  }

  // ================= Shots, pickups =================
  function updateShots(dt) {
    for (var i = shots.length - 1; i >= 0; i--) {
      var s = shots[i];
      s.life -= dt;
      if (s.kind === 'missile') {
        if (!s.target || s.target.dead) s.target = randomVisibleEnemy();
        if (s.target) {
          var want = M.angle(s.x, s.y, s.target.x, s.target.y), cur = Math.atan2(s.vy, s.vx);
          var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
          cur += M.clamp(diff, -s.turn * dt, s.turn * dt);
          var spd = Math.min(620, Math.sqrt(s.vx * s.vx + s.vy * s.vy) + 700 * dt);
          s.vx = Math.cos(cur) * spd; s.vy = Math.sin(cur) * spd;
        }
        if (Math.random() < 0.6) fx.spawn(s.x, s.y, { color: '#ffb13d', speed: 40, life: 0.3, size: 4 });
      }
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.life <= 0) { if (s.boom) explode(s.x, s.y, s.boom, s.dmg, s.color, false); M.swapRemove(shots, i); continue; }
      var done = false;
      var hitFn = function (e) {
        if (done || e.dead || s.hit.indexOf(e.id) >= 0) return;
        var rr = e.r + s.r;
        if (M.dist2(s.x, s.y, e.x, e.y) < rr * rr) {
          if (s.boom) { explode(s.x, s.y, s.boom, s.dmg, s.color, false); done = true; return true; }
          s.hit.push(e.id);
          var len = Math.sqrt(s.vx * s.vx + s.vy * s.vy) || 1;
          hurtEnemy(e, s.dmg, s.vx / len, s.vy / len, s.kind === 'flame' ? 30 : 110);
          if (s.kind !== 'flame') fx.burst(s.x, s.y, 3, { color: s.color, speed: 160, life: 0.25, size: 3 });
          if (--s.pierce <= 0) { done = true; return true; }
        }
      };
      grid.query(s.x, s.y, s.r + 30, hitFn);
      if (!done && boss && !boss.dead) hitFn(boss);
      if (done) M.swapRemove(shots, i);
    }
    for (var j = bullets.length - 1; j >= 0; j--) {
      var b = bullets[j];
      b.life -= dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.life <= 0) { M.swapRemove(bullets, j); continue; }
      if (M.dist2(b.x, b.y, P.x, P.y) < Math.pow(b.r + P.r - 3, 2)) { hurtPlayer(b.dmg); M.swapRemove(bullets, j); }
    }
  }
  function updatePickups(dt) {
    var mag2 = S.magnet * S.magnet;
    for (var i = gems.length - 1; i >= 0; i--) {
      var g = gems[i], d2 = M.dist2(g.x, g.y, P.x, P.y);
      if (g.pull || d2 < mag2) {
        g.pull = true;
        var a = M.angle(g.x, g.y, P.x, P.y), sp = 520 + (g.sp = (g.sp || 0) + dt * 900);
        g.x += Math.cos(a) * sp * dt; g.y += Math.sin(a) * sp * dt;
        if (d2 < 22 * 22) { gainXp(g.v); M.swapRemove(gems, i); sound.play('pickup'); }
      }
    }
    for (var j = items.length - 1; j >= 0; j--) {
      var it = items[j];
      it.t += dt;
      var dd = M.dist2(it.x, it.y, P.x, P.y);
      if (dd < Math.pow(S.magnet * 0.7, 2) || it.pull) {
        it.pull = true;
        var ia = M.angle(it.x, it.y, P.x, P.y);
        it.x += Math.cos(ia) * 600 * dt; it.y += Math.sin(ia) * 600 * dt;
      }
      if (dd < 26 * 26) { collect(it); M.swapRemove(items, j); }
    }
  }
  function collect(it) {
    if (it.kind === 'coin') { coinsRun += it.v; sound.play('coin'); pop.add(P.x, P.y - 26, '+' + it.v + ' ◆', '#ffd36b', 14); }
    else if (it.kind === 'heart') { P.hp = Math.min(S.maxHp, P.hp + 30); sound.play('heal'); pop.add(P.x, P.y - 26, '+30', '#7dff9e', 18); }
    else if (it.kind === 'magnet') { gems.forEach(function (g) { g.pull = true; }); sound.play('evolve'); fx.ring(P.x, P.y, 300, '#5ef1ff', 0.5); }
    else if (it.kind === 'bomb') {
      sound.play('bigboom'); cam.shake(20); flash = 0.4;
      fx.ring(P.x, P.y, 700, '#ffffff', 0.6, 16);
      var v = cam.view(stage, 0);
      enemies.forEach(function (e) { if (!e.dead && e.x > v.l && e.x < v.r && e.y > v.t && e.y < v.b) hurtEnemy(e, 9999 / S.dmg, 0, 0, 0); });
    } else if (it.kind === 'chest') { pendingLevels++; sound.play('win'); openLevelUp(true); }
  }
  function gainXp(v) {
    P.xp += v * S.xp;
    var ups = 0;
    while (P.xp >= P.next) { P.xp -= P.next; P.level++; P.next = xpFor(P.level); ups++; }
    if (ups) {
      pendingLevels += ups;
      fx.ring(P.x, P.y, 140, '#ffd36b', 0.5, 10);
      if (state === 'play') openLevelUp(false);
    }
  }

  // ================= Main update =================
  function update(dt) {
    if (state !== 'play') { input.endFrame(); return; }
    time += dt;

    // Player.
    var mv = input.move();
    if (DEBUG && window.__auto) mv = autopilot();
    if (endTimer >= 0) { mv = { x: 0, y: 0 }; }
    var accel = 1 - Math.pow(0.0001, dt);
    P.vx += (mv.x * S.speed - P.vx) * accel;
    P.vy += (mv.y * S.speed - P.vy) * accel;
    P.x += P.vx * dt; P.y += P.vy * dt;
    if (mv.x || mv.y) { P.fx = mv.x; P.fy = mv.y; var l = Math.sqrt(P.fx * P.fx + P.fy * P.fy); P.fx /= l; P.fy /= l; }
    P.invuln = Math.max(0, P.invuln - dt);
    P.hurtT = Math.max(0, P.hurtT - dt);
    if (S.regen && P.hp < S.maxHp) P.hp = Math.min(S.maxHp, P.hp + S.regen * dt);
    if (Math.random() < 0.5) fx.spawn(P.x - P.fx * 8, P.y - P.fy * 8, { color: P.hero.color, speed: 30, life: 0.35, size: 4 });

    adaptToDevice(dt);
    spawning(dt);
    updateEnemies(dt);
    if (boss) updateBoss(dt);
    for (var i = 0; i < weapons.length; i++) tickWeapon(weapons[i], dt);
    updateShots(dt);
    updatePickups(dt);

    for (var t = telegraphs.length - 1; t >= 0; t--) {
      var tg = telegraphs[t];
      tg.t -= dt;
      if (tg.follow) { tg.x = tg.follow.x; tg.y = tg.follow.y; }
      if (tg.t <= 0) { if (tg.onEnd) tg.onEnd(); telegraphs.splice(t, 1); }
    }
    for (var bi = beams.length - 1; bi >= 0; bi--) { beams[bi].t -= dt; if (beams[bi].t <= 0) beams.splice(bi, 1); }
    for (var bo = bolts.length - 1; bo >= 0; bo--) { bolts[bo].t -= dt; if (bolts[bo].t <= 0) bolts.splice(bo, 1); }

    comboT -= dt;
    if (comboT <= 0) combo = 0;
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    flash = Math.max(0, flash - dt);
    fx.update(dt);
    pop.update(dt);
    if (!boss) sound.setIntensity(Math.min(0.85, time / 600));
    cam.update(dt, P.x, P.y, 0.14);
    if (endTimer >= 0) { endTimer -= dt; if (endTimer < 0) winRun(); }
    input.endFrame();
  }

  // ================= Drawing =================
  function drawBackground(view) {
    var map = MAPS[save.data.map];
    ctx.fillStyle = map.bg;
    ctx.fillRect(view.l, view.t, view.r - view.l, view.b - view.t);
    var size = 80;
    ctx.strokeStyle = map.grid; ctx.lineWidth = 2;
    ctx.beginPath();
    for (var x = Math.floor(view.l / size) * size; x < view.r; x += size) { ctx.moveTo(x, view.t); ctx.lineTo(x, view.b); }
    for (var y = Math.floor(view.t / size) * size; y < view.b; y += size) { ctx.moveTo(view.l, y); ctx.lineTo(view.r, y); }
    ctx.stroke();
    // Faint glowing spots on some grid crossings, the same every time you pass.
    ctx.globalCompositeOperation = 'lighter';
    var big = 320;
    for (var gx = Math.floor(view.l / big) * big; gx < view.r; gx += big) {
      for (var gy = Math.floor(view.t / big) * big; gy < view.b; gy += big) {
        var h = Math.abs(Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453) % 1;
        if (h < 0.35) K.drawGlow(ctx, gx + h * 240, gy + (h * 7 % 1) * 240, map.accent, 60 + h * 90, 0.35);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function shapePath(shape, r, t) {
    ctx.beginPath();
    if (shape === 'tri') { for (var i = 0; i < 3; i++) { var a = t + i * M.TAU / 3; ctx.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15); } }
    else if (shape === 'dart') { ctx.moveTo(r * 1.4, 0); ctx.lineTo(-r, r * 0.8); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r, -r * 0.8); }
    else if (shape === 'hex') { for (var j = 0; j < 6; j++) { var b = j * M.TAU / 6; ctx.lineTo(Math.cos(b) * r, Math.sin(b) * r); } }
    else if (shape === 'sq') { ctx.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7); }
    else if (shape === 'star') { for (var k = 0; k < 10; k++) { var c = k * M.TAU / 10, rr = k % 2 ? r * 0.55 : r * 1.15; ctx.lineTo(Math.cos(c) * rr, Math.sin(c) * rr); } }
    else { ctx.arc(0, 0, r, 0, M.TAU); }
    ctx.closePath();
  }
  function drawEnemy(e) {
    var face = M.angle(e.x, e.y, P.x, P.y);
    ctx.save();
    ctx.translate(e.x, e.y);
    var spin = e.shape === 'tri' ? face : e.shape === 'dart' ? face : e.shape === 'star' ? time * 4 : e.shape === 'hex' ? time * 0.6 : 0;
    ctx.rotate(spin);
    var col = e.flash > 0 ? '#ffffff' : e.color;
    if (e.fuse >= 0) col = Math.floor(time * 20) % 2 ? '#ffffff' : '#ff2200';
    shapePath(e.shape, e.r, 0);
    ctx.fillStyle = K.rgba(e.color, e.shape === 'ghost' ? 0.25 : 0.35);
    ctx.fill();
    ctx.lineWidth = e.elite ? 4 : 2.5;
    ctx.strokeStyle = col;
    ctx.stroke();
    if (e.elite) { ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2; shapePath(e.shape, e.r + 6, 0); ctx.stroke(); }
    ctx.restore();
    // Eyes looking at you.
    ctx.fillStyle = '#ffffff';
    var ex = Math.cos(face) * e.r * 0.35, ey = Math.sin(face) * e.r * 0.35, s = Math.max(2, e.r * 0.16);
    ctx.fillRect(e.x + ex - s * 1.8, e.y + ey - s / 2, s, s);
    ctx.fillRect(e.x + ex + s * 0.8, e.y + ey - s / 2, s, s);
  }
  function drawBoss(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.globalCompositeOperation = 'lighter';
    K.drawGlow(ctx, 0, 0, b.color, b.r * 2.6, 0.55);
    ctx.globalCompositeOperation = 'source-over';
    var id = b.def.id, col = b.flash > 0 ? '#ffffff' : b.color;
    ctx.lineWidth = 5; ctx.strokeStyle = col; ctx.fillStyle = K.rgba(b.color, 0.3);
    if (id === 'hive') {
      ctx.rotate(time * 0.8);
      shapePath('star', b.r, 0); ctx.fill(); ctx.stroke();
      ctx.rotate(-time * 1.6); shapePath('hex', b.r * 0.55, 0); ctx.stroke();
    } else if (id === 'colossus') {
      ctx.rotate(time * 0.3);
      shapePath('hex', b.r, 0); ctx.fill(); ctx.stroke();
      ctx.rotate(Math.PI / 6); shapePath('hex', b.r * 0.7, 0); ctx.stroke();
      shapePath('sq', b.r * 0.32, 0); ctx.stroke();
    } else {
      ctx.fillStyle = '#05010d';
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, M.TAU); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.stroke();
      ctx.rotate(b.ang);
      for (var i = 0; i < 8; i++) { ctx.rotate(M.TAU / 8); ctx.beginPath(); ctx.moveTo(b.r + 6, 0); ctx.lineTo(b.r + 22 + Math.sin(time * 6 + i) * 6, 0); ctx.stroke(); }
    }
    ctx.restore();
    // Eye.
    var face = M.angle(b.x, b.y, P.x, P.y);
    ctx.fillStyle = b.phase === 2 ? '#ff2a2a' : '#ffffff';
    ctx.beginPath(); ctx.arc(b.x + Math.cos(face) * b.r * 0.3, b.y + Math.sin(face) * b.r * 0.3, b.r * 0.16, 0, M.TAU); ctx.fill();
  }
  function drawPlayer() {
    var c = P.hero.color;
    if (P.invuln > 0 && Math.floor(time * 30) % 2) return;
    ctx.globalCompositeOperation = 'lighter';
    K.drawGlow(ctx, P.x, P.y, c, 60, 0.7);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.rotate(Math.atan2(P.fy, P.fx));
    ctx.beginPath();
    ctx.moveTo(18, 0); ctx.lineTo(-12, 12); ctx.lineTo(-6, 0); ctx.lineTo(-12, -12); ctx.closePath();
    ctx.fillStyle = P.hurtT > 0 ? '#ff3d6e' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = c; ctx.stroke();
    ctx.restore();
    // Health bar under the hero.
    var w = 44, k = P.hp / S.maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(P.x - w / 2, P.y + 24, w, 6);
    ctx.fillStyle = k > 0.35 ? '#7dff9e' : '#ff3d6e'; ctx.fillRect(P.x - w / 2, P.y + 24, w * k, 6);
  }
  function drawWeaponsWorld() {
    weapons.forEach(function (w) {
      var def = weaponDef(w);
      if (w.blades) {
        ctx.globalCompositeOperation = 'lighter';
        w.blades.forEach(function (b) {
          K.drawGlow(ctx, b.x, b.y, def.color, w.id === 'saw' ? 46 : 32, 0.9);
          ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(time * 14);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
          var s = w.id === 'saw' ? 18 : 11;
          ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.stroke();
          ctx.restore();
        });
        ctx.globalCompositeOperation = 'source-over';
      }
      if (w.id === 'frost' && w.rad) {
        ctx.fillStyle = 'rgba(159,232,255,0.07)';
        ctx.strokeStyle = 'rgba(159,232,255,' + (0.3 + Math.sin(time * 4) * 0.1) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(P.x, P.y, w.rad, 0, M.TAU); ctx.fill(); ctx.stroke();
      }
    });
  }
  function drawShots(view) {
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i];
      if (s.x < view.l || s.x > view.r || s.y < view.t || s.y > view.b) continue;
      if (s.kind === 'flame') { var k = s.life / 0.38; K.drawGlow(ctx, s.x, s.y, k > 0.5 ? '#ffd36b' : '#ff5a1f', s.r * 2.4 * (1.4 - k), 0.8); continue; }
      K.drawGlow(ctx, s.x, s.y, s.color, s.r * 3.5, 1);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = s.r * 0.9;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.025, s.y - s.vy * 0.025); ctx.stroke();
    }
    for (var j = 0; j < bullets.length; j++) {
      var b = bullets[j];
      if (b.x < view.l || b.x > view.r || b.y < view.t || b.y > view.b) continue;
      K.drawGlow(ctx, b.x, b.y, b.color, b.r * 3.4, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (var jj = 0; jj < bullets.length; jj++) {
      var bb = bullets[jj];
      if (bb.x < view.l || bb.x > view.r || bb.y < view.t || bb.y > view.b) continue;
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bb.x, bb.y, bb.r * 0.55, 0, M.TAU); ctx.fill();
    }
    beams.forEach(function (b) {
      var k = b.t / 0.22;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = K.rgba(b.color, 0.6 * k); ctx.lineWidth = b.w * 2.4 * k;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + k + ')'; ctx.lineWidth = b.w * 0.6 * k;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    });
    bolts.forEach(function (b) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = b.color; ctx.lineWidth = 3; ctx.globalAlpha = b.t / 0.18;
      ctx.beginPath();
      for (var i = 0; i < b.path.length; i++) {
        var p = b.path[i];
        if (!i) { ctx.moveTo(p.x, p.y); continue; }
        var q = b.path[i - 1];
        for (var s = 1; s <= 4; s++) { var t = s / 4; ctx.lineTo(M.lerp(q.x, p.x, t) + (s < 4 ? M.rand(-9, 9) : 0), M.lerp(q.y, p.y, t) + (s < 4 ? M.rand(-9, 9) : 0)); }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    });
  }
  function drawPickups(view) {
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < gems.length; i++) {
      var g = gems[i];
      if (g.x < view.l || g.x > view.r || g.y < view.t || g.y > view.b) continue;
      var c = g.v >= 20 ? '#ff5ec8' : g.v >= 5 ? '#7dff9e' : '#5ef1ff';
      K.drawGlow(ctx, g.x, g.y, c, g.v >= 20 ? 20 : 13, 0.9);
    }
    ctx.globalCompositeOperation = 'source-over';
    items.forEach(function (it) {
      if (it.x < view.l || it.x > view.r || it.y < view.t || it.y > view.b) return;
      var bob = Math.sin(it.t * 5) * 3;
      var col = { coin: '#ffd36b', heart: '#ff3d6e', magnet: '#5ef1ff', bomb: '#ffffff', chest: '#ffd36b' }[it.kind];
      ctx.globalCompositeOperation = 'lighter';
      K.drawGlow(ctx, it.x, it.y + bob, col, it.kind === 'chest' ? 50 : 26, 0.8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = col; ctx.font = '900 ' + (it.kind === 'chest' ? 30 : 18) + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText({ coin: '◆', heart: '♥', magnet: '∪', bomb: '✹', chest: '▣' }[it.kind], it.x, it.y + bob);
    });
  }
  function drawTelegraphs() {
    telegraphs.forEach(function (t) {
      var k = 1 - t.t / t.max;
      ctx.fillStyle = K.rgba(t.color, 0.12 + k * 0.2);
      ctx.strokeStyle = K.rgba(t.color, 0.5 + k * 0.5); ctx.lineWidth = 3;
      if (t.kind === 'circle') { ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, M.TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(t.x, t.y, t.r * k, 0, M.TAU); ctx.stroke(); }
      else { ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.a); ctx.fillRect(0, -t.w, t.len, t.w * 2); ctx.strokeRect(0, -t.w, t.len * k, t.w * 2); ctx.restore(); }
    });
  }
  function fmtTime(s) { s = Math.floor(s); return (s / 60 < 10 ? '0' : '') + Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function drawHud() {
    var W = stage.W, H = stage.H, top = 0;
    // XP bar.
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, top, W, 10);
    var g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#2fa8ff'); g.addColorStop(1, '#7dfcff');
    ctx.fillStyle = g; ctx.fillRect(0, top, W * Math.min(1, P.xp / P.next), 10);
    ctx.textBaseline = 'top';
    // Timer.
    ctx.textAlign = 'center';
    ctx.font = '900 30px ui-sans-serif, system-ui, sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    var tt = fmtTime(time);
    ctx.strokeText(tt, W / 2, 18); ctx.fillStyle = time >= 900 ? '#ffd36b' : '#ffffff'; ctx.fillText(tt, W / 2, 18);
    // Left: level, kills, coins.
    ctx.textAlign = 'left';
    ctx.font = '800 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#ffd36b'; ctx.fillText('LV ' + P.level, 12, 18);
    ctx.fillStyle = '#ffffff'; ctx.fillText('☠ ' + kills, 12, 38);
    ctx.fillStyle = '#ffd36b'; ctx.fillText('◆ ' + coinsRun, 12, 58);
    // Combo.
    if (combo >= 10) {
      ctx.textAlign = 'center';
      var cs = Math.min(40, 18 + combo / 15);
      ctx.font = '900 ' + cs + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = combo >= 150 ? '#ff5ec8' : combo >= 50 ? '#ffd36b' : '#ffffff';
      ctx.globalAlpha = Math.min(1, comboT);
      ctx.fillText(combo + 'x', W / 2, 54);
      ctx.globalAlpha = 1;
    }
    // Weapons and passives, bottom left.
    var x = 12, y = H - 40;
    weapons.forEach(function (w) {
      var d = weaponDef(w);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, 30, 30);
      ctx.strokeStyle = d.color; ctx.lineWidth = 2; ctx.strokeRect(x, y, 30, 30);
      ctx.fillStyle = d.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 16px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(d.icon, x + 15, y + 14);
      ctx.font = '900 9px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#ffffff';
      ctx.fillText(w.evo ? '★' : String(w.level), x + 24, y + 25);
      x += 34;
    });
    x += 6;
    Object.keys(passives).forEach(function (id) {
      var d = PASSIVES[id];
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y + 6, 24, 24);
      ctx.fillStyle = d.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(d.icon, x + 12, y + 17);
      ctx.font = '900 8px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText(String(passives[id]), x + 19, y + 26);
      x += 27;
    });
    // Boss bar.
    if (boss) {
      var bw = Math.min(520, W - 40), bx = (W - bw) / 2, by = 80;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx, by, bw, 14);
      ctx.fillStyle = boss.phase === 2 ? '#ff2a2a' : boss.color; ctx.fillRect(bx, by, bw * Math.max(0, boss.hp / boss.maxHp), 14);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, 14);
      ctx.font = '900 13px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#ffffff';
      ctx.fillText(boss.name, W / 2, by - 3);
      // Arrow to the boss when it is off screen.
      var sx = (boss.x - cam.x) * cam.zoom + W / 2, sy = (boss.y - cam.y) * cam.zoom + H / 2;
      if (sx < 0 || sx > W || sy < 0 || sy > H) {
        var a = Math.atan2(sy - H / 2, sx - W / 2), ax = M.clamp(sx, 30, W - 30), ay = M.clamp(sy, 110, H - 60);
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
        ctx.fillStyle = boss.color; ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, 11); ctx.lineTo(-10, -11); ctx.fill();
        ctx.restore();
      }
    }
    // Banner.
    if (banner) {
      var k = Math.min(1, banner.t * 3, (banner.max - banner.t) * 6);
      ctx.globalAlpha = k;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var size = Math.min(44, W / (banner.text.length * 0.62));
      ctx.font = '900 ' + size + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(banner.text, W / 2, H * 0.3);
      ctx.fillStyle = banner.color; ctx.fillText(banner.text, W / 2, H * 0.3);
      ctx.globalAlpha = 1;
    }
    // Low health: a red pulse around the edge.
    var low = P.hp / S.maxHp;
    if (low < 0.35 || flash > 0) {
      var amt = Math.max(flash * 1.6, low < 0.35 ? (0.35 - low) * 1.6 * (0.7 + Math.sin(time * 8) * 0.3) : 0);
      var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, 'rgba(255,0,40,0)'); vg.addColorStop(1, 'rgba(255,0,40,' + Math.min(0.6, amt) + ')');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    if (DEBUG) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.font = '700 11px monospace'; ctx.fillStyle = '#7dff9e'; ctx.fillText(Math.round(loop.fps) + ' fps · ' + enemies.length + ' enemies', W - 10, H - 18); }
  }
  /** Test helper (?debug=1 only): steer away from danger and towards gems. */
  function autopilot() {
    var ax = 0, ay = 0;
    function away(x, y, w, range) { var d2 = M.dist2(x, y, P.x, P.y); if (d2 < range * range && d2 > 1) { var d = Math.sqrt(d2); ax += (P.x - x) / d * w * (1 - d / range); ay += (P.y - y) / d * w * (1 - d / range); } }
    enemies.forEach(function (e) { away(e.x, e.y, e.bomb ? 3 : 1, e.bomb ? 150 : 95); });
    bullets.forEach(function (b) { away(b.x, b.y, 2, 120); });
    if (boss) away(boss.x, boss.y, 8, 300);
    telegraphs.forEach(function (t) { if (t.kind === 'circle') away(t.x, t.y, 10, t.r + 60); });
    var g = gems[0];
    if (g) { var ga = M.angle(P.x, P.y, g.x, g.y); ax += Math.cos(ga) * 0.4; ay += Math.sin(ga) * 0.4; }
    ax += Math.cos(time * 0.3) * 0.3; ay += Math.sin(time * 0.3) * 0.3;
    var l = Math.sqrt(ax * ax + ay * ay) || 1;
    return { x: ax / l, y: ay / l };
  }
  function showBanner(text, color, secs) { banner = { text: text, color: color, t: secs, max: secs }; }

  function render() {
    cam.zoom = M.clamp(Math.min(stage.W, stage.H) / 700, 0.62, 1.15);
    if (!P) newRun();
    cam.apply(ctx, stage);
    var view = cam.view(stage, 60);
    drawBackground(view);
    drawTelegraphs();
    drawPickups(view);
    drawWeaponsWorld();
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.x < view.l || e.x > view.r || e.y < view.t || e.y > view.b) continue;
      drawEnemy(e);
    }
    if (boss) drawBoss(boss);
    drawShots(view);
    if (state !== 'menu') drawPlayer();
    fx.draw(ctx, view);
    pop.draw(ctx);
    cam.screen(ctx, stage);
    if (state !== 'menu') { drawHud(); input.drawStick(ctx); }
  }
  // The menu shows a slow drift through the map behind it.
  function menuDrift(dt) {
    if (state === 'menu' && P) { P.x += dt * 30; P.y += dt * 12; cam.update(dt, P.x, P.y, 0.05); }
  }

  var loop = K.createLoop(function (dt, real) { menuDrift(real); update(dt); }, render);

  // ================= Flow =================
  function startRun() {
    sound.unlock();
    BOSSES.forEach(function (b) { b.warned = false; });
    newRun();
    state = 'play';
    loop.running = true;
    loop.timeScale = DEBUG && window.__speed ? window.__speed : 1;
    ['menu', 'over', 'pause', 'levelup'].forEach(function (id) { $(id).hidden = true; });
    $('corner').hidden = false;
    sound.setIntensity(0);
    sound.startMusic();
    sdk.start();
    if (DEBUG) window.__ll = { P: P, S: function () { return S; }, apply: apply, setTime: function (t) { time = t; }, enemies: function () { return enemies; }, weapons: function () { return weapons; },
      step: function (secs) { var t0 = performance.now(); for (var i = 0; i < secs * 60 && state === 'play'; i++) { update(1 / 60); loop.time += 1 / 60; } render(); return { ms: Math.round(performance.now() - t0), time: Math.round(time), state: state, hp: Math.round(P.hp), lvl: P.level, kills: kills, enemies: enemies.length, shots: shots.length, boss: boss ? boss.name + ' ' + Math.round(boss.hp) : null, weapons: weapons.map(function (w) { return w.id + w.level; }).join(','), passives: JSON.stringify(passives), won: won, minHp: Math.round(window.__minHp || -1) }; } };
  }
  function pauseGame() {
    if (state !== 'play') return;
    state = 'pause';
    loop.running = false;
    sdk.stop();
    fillStats($('pause-stats'));
    $('pause').hidden = false;
  }
  function resumeGame() {
    if (state !== 'pause') return;
    $('pause').hidden = true;
    state = 'play';
    loop.running = true;
    sdk.start();
  }
  function fillStats(box) {
    box.innerHTML = '';
    [['Time', fmtTime(time)], ['Kills', kills], ['Level', P.level], ['Best combo', bestCombo + 'x'], ['Coins', coinsRun]].forEach(function (s) {
      var d = document.createElement('div');
      var b = document.createElement('b'); b.textContent = s[1];
      var sp = document.createElement('span'); sp.textContent = s[0];
      d.append(b, sp); box.appendChild(d);
    });
  }
  function score() { return kills + Math.floor(time) * 3 + bossesKilled * 1500 + (won ? 10000 : 0); }
  function playerDown() {
    sound.play('lose');
    cam.shake(20);
    fx.burst(P.x, P.y, 60, { color: P.hero.color, speed: 500, life: 0.9, size: 7 });
    state = 'over';
    loop.running = false;
    sdk.stop();
    showOver(false);
  }
  function showOver(final) {
    $('over-title').textContent = won ? 'YOU SURVIVED' : 'YOU FELL';
    $('over-title').style.color = won ? '#ffd36b' : '#ff3d6e';
    var canRevive = !final && !won && !revived && sdk.has();
    $('revive').hidden = !canRevive;
    $('over-text').textContent = won ? 'The Eclipse is gone. The light lives on.' : canRevive ? 'Watch a short ad to come back with full health, or end the run.' : 'Score ' + score() + '. Spend your coins on heroes and upgrades.';
    fillStats($('over-stats'));
    $('again').textContent = canRevive ? 'END RUN' : 'PLAY AGAIN';
    $('to-menu').hidden = canRevive;
    $('over').hidden = false;
    $('corner').hidden = true;
    if (!canRevive) finishRun();
  }
  var finished = false;
  function finishRun() {
    if (finished) return;
    finished = true;
    var earned = Math.floor((coinsRun + Math.floor(time / 30) * 5 + bossesKilled * 50) * S.greed);
    var sc = score();
    var record = sc > save.data.best;
    save.data.coins += earned;
    save.data.runs++;
    if (won) save.data.wins++;
    if (record) save.data.best = sc;
    if (time > save.data.bestTime) save.data.bestTime = Math.floor(time);
    save.write();
    sdk.submit('score', sc);
    if (record || won) sdk.celebrate();
    $('over-text').textContent = (won ? 'The Eclipse is gone. The light lives on. ' : '') + 'Score ' + sc + (record ? ' (new best!)' : '') + ' · +' + earned + ' coins.';
    sound.stopMusic();
  }
  function winRun() {
    if (state !== 'play') return;
    state = 'over';
    loop.running = false;
    sdk.stop();
    sound.play('win');
    showOver(true);
  }
  function revive() {
    $('revive').disabled = true;
    sdk.rewarded().then(function (ok) {
      $('revive').disabled = false;
      if (!ok) { $('over-text').textContent = 'The ad did not finish, so no revive this time.'; return; }
      revived = true;
      P.hp = S.maxHp;
      P.invuln = 2.5;
      $('over').hidden = true;
      $('corner').hidden = false;
      state = 'play';
      loop.running = true;
      sdk.start();
      // Clear space around the hero.
      fx.ring(P.x, P.y, 400, '#ffffff', 0.6, 14);
      enemies.forEach(function (e) { var d = M.dist(P.x, P.y, e.x, e.y); if (d < 400) { var a = M.angle(P.x, P.y, e.x, e.y); e.kx += Math.cos(a) * 900; e.ky += Math.sin(a) * 900; } });
      bullets.length = 0;
      sound.play('evolve');
    });
  }

  // ================= Menu =================
  function renderMenu() {
    $('coin-count').textContent = save.data.coins;
    $('best-score').textContent = save.data.best;
    var hb = $('heroes'); hb.innerHTML = '';
    Object.keys(HEROES).forEach(function (id) {
      var h = HEROES[id], owned = save.data.heroes.indexOf(id) >= 0;
      hb.appendChild(pickButton(h.name, h.perk, h.color, owned, h.cost, save.data.hero === id, function () {
        if (owned) save.data.hero = id;
        else if (save.data.coins >= h.cost) { save.data.coins -= h.cost; save.data.heroes.push(id); save.data.hero = id; sound.unlock(); sound.play('coin'); }
        else return sound.play('hurt');
        save.write(); renderMenu();
      }));
    });
    var mb = $('maps'); mb.innerHTML = '';
    Object.keys(MAPS).forEach(function (id) {
      var m = MAPS[id], owned = save.data.maps.indexOf(id) >= 0;
      mb.appendChild(pickButton(m.name, m.info, m.accent, owned, m.cost, save.data.map === id, function () {
        if (owned) save.data.map = id;
        else if (save.data.coins >= m.cost) { save.data.coins -= m.cost; save.data.maps.push(id); save.data.map = id; sound.unlock(); sound.play('coin'); }
        else return sound.play('hurt');
        save.write(); renderMenu();
      }));
    });
    var sb = $('shop'); sb.innerHTML = '';
    Object.keys(PERMS).forEach(function (id) {
      var p = PERMS[id], lvl = save.data.perm[id] || 0, cost = p.costs[lvl];
      var b = document.createElement('button'); b.type = 'button';
      var nm = document.createElement('b'); nm.textContent = p.name + ' ';
      var pips = document.createElement('span'); pips.className = 'pips'; pips.textContent = '●'.repeat(lvl) + '○'.repeat(5 - lvl);
      var sm = document.createElement('small'); sm.textContent = p.info + ' · ' + (cost ? cost + ' ◆' : 'Max');
      b.append(nm, pips, sm);
      b.disabled = !cost || save.data.coins < cost;
      b.addEventListener('click', function () {
        if (!cost || save.data.coins < cost) return;
        save.data.coins -= cost; save.data.perm[id] = lvl + 1; save.write();
        sound.unlock(); sound.play('levelup'); renderMenu();
      });
      sb.appendChild(b);
    });
  }
  function pickButton(name, info, color, owned, cost, on, onClick) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'pick' + (on ? ' on' : '') + (owned ? '' : ' locked');
    b.style.setProperty('--c', color);
    var t = document.createElement('b');
    var dot = document.createElement('span'); dot.className = 'dot';
    t.append(dot, document.createTextNode(name));
    var s = document.createElement('small'); s.textContent = info;
    b.append(t, s);
    if (!owned) { var pr = document.createElement('span'); pr.className = 'price'; pr.textContent = '🔒 ' + cost + ' ◆'; b.appendChild(pr); }
    b.addEventListener('click', onClick);
    return b;
  }
  function toMenu() {
    state = 'menu';
    ['over', 'pause', 'levelup'].forEach(function (id) { $(id).hidden = true; });
    $('corner').hidden = true;
    sound.stopMusic();
    newRun();
    enemies.length = 0;
    renderMenu();
    $('menu').hidden = false;
    loop.running = true;
  }

  // ================= Wiring =================
  $('play').addEventListener('click', function () { finished = false; startRun(); });
  $('again').addEventListener('click', function () {
    if (!$('revive').hidden && !finished) { $('revive').hidden = true; finishRun(); $('again').textContent = 'PLAY AGAIN'; $('to-menu').hidden = false; return; }
    finished = false;
    $('again').disabled = true;
    sdk.midgame().then(function () { $('again').disabled = false; startRun(); });
  });
  $('to-menu').addEventListener('click', toMenu);
  $('revive').addEventListener('click', revive);
  $('resume').addEventListener('click', resumeGame);
  $('quit').addEventListener('click', function () { $('pause').hidden = true; state = 'over'; sdk.stop(); revived = true; showOver(true); });
  $('btn-pause').addEventListener('click', pauseGame);
  $('btn-mute').addEventListener('click', function () { var m = sound.toggleUser(); $('btn-mute').style.opacity = m ? 0.4 : 1; });
  $('btn-mute').style.opacity = sound.isUserMuted() ? 0.4 : 1;
  window.addEventListener('keydown', function (e) {
    if (state === 'levelup' && /^Digit[1-3]$/.test(e.code)) choose(Number(e.code.slice(5)) - 1);
    else if (state === 'play' && (e.code === 'Escape' || e.code === 'KeyP')) pauseGame();
    else if (state === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) resumeGame();
    else if (state === 'menu' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); $('play').click(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseGame(); });

  // ================= Start =================
  newRun();
  enemies.length = 0;
  renderMenu();
  sdk.init()
    .then(function () { return save.load(); })
    .then(function () {
      if (save.data.heroes.indexOf(save.data.hero) < 0) save.data.hero = 'nova';
      if (save.data.maps.indexOf(save.data.map) < 0) save.data.map = 'city';
      renderMenu();
      sdk.loaded();
    });
})();

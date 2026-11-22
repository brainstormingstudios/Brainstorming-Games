/* Sum Sprint: 60 seconds of quick arithmetic. A Brainstorming Games original. */
(function () {
  'use strict';
  var BG = window.BG;
  var ROUND = 60;
  var el = function (id) { return document.getElementById(id); };
  var panel = el('panel'), question = el('question'), answers = el('answers'), fill = el('fill');
  var score = 0, streak = 0, best = 0, left = ROUND, answer = 0, playing = false, last = 0, rounds = 0;

  var rand = function (min, max) { return min + Math.floor(Math.random() * (max - min + 1)); };

  function next() {
    // Sums get harder as the score grows.
    var level = Math.min(4, Math.floor(score / 80));
    var kind = rand(0, level > 1 ? 2 : 1);
    var a, b, text;
    if (kind === 0) { a = rand(2, 9 + level * 12); b = rand(2, 9 + level * 12); answer = a + b; text = a + ' + ' + b; }
    else if (kind === 1) { a = rand(6, 14 + level * 14); b = rand(2, a - 1); answer = a - b; text = a + ' − ' + b; }
    else { a = rand(2, 5 + level * 2); b = rand(2, 9); answer = a * b; text = a + ' × ' + b; }
    question.textContent = text;
    var options = [answer];
    while (options.length < 4) {
      var wrong = answer + rand(-9, 9);
      if (wrong >= 0 && options.indexOf(wrong) === -1) options.push(wrong);
    }
    options.sort(function () { return Math.random() - 0.5; });
    answers.textContent = '';
    options.forEach(function (value, i) {
      var b2 = document.createElement('button');
      b2.type = 'button';
      b2.innerHTML = value + '<kbd>' + (i + 1) + '</kbd>';
      b2.addEventListener('click', function () { pick(value); });
      answers.appendChild(b2);
    });
  }
  function flash(cls) {
    question.classList.remove('right', 'wrong');
    void question.offsetWidth;
    question.classList.add(cls);
  }
  function pick(value) {
    if (!playing) return;
    if (value === answer) {
      streak++;
      score += 10 + Math.min(streak - 1, 10) * 2;
      flash('right');
      next();
    } else {
      streak = 0;
      left = Math.max(0, left - 2);
      flash('wrong');
    }
    el('score').textContent = score;
    el('streak').textContent = streak;
  }
  function tick(now) {
    if (!playing) return;
    left -= (now - last) / 1000;
    last = now;
    fill.style.transform = 'scaleX(' + Math.max(0, left / ROUND) + ')';
    if (left <= 0) return end();
    requestAnimationFrame(tick);
  }
  function start() {
    score = 0; streak = 0; left = ROUND;
    el('score').textContent = '0';
    el('streak').textContent = '0';
    panel.hidden = true;
    playing = true;
    next();
    last = performance.now();
    requestAnimationFrame(tick);
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
    el('panel-title').textContent = record && score > 0 ? 'New best: ' + score : 'Time! Score ' + score;
    el('panel-text').textContent = 'Keep a streak going: each correct answer in a row is worth more.';
    el('start').textContent = 'Go again';
    panel.hidden = false;
  }

  window.addEventListener('keydown', function (e) {
    var n = Number(e.key);
    if (playing && n >= 1 && n <= 4) answers.children[n - 1].click();
    else if (!playing && (e.code === 'Space' || e.code === 'Enter') && !panel.hidden) { e.preventDefault(); el('start').click(); }
  });
  el('start').addEventListener('click', function () {
    if (BG && rounds > 0 && rounds % 2 === 0) BG.ad.midgame().then(start, start);
    else start();
  });
  // Stop the clock when the tab is hidden: nobody loses time to a phone call.
  document.addEventListener('visibilitychange', function () {
    if (!playing) return;
    if (document.hidden) { if (BG) BG.game.gameplayStop(); }
    else { last = performance.now(); if (BG) BG.game.gameplayStart(); }
  });

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

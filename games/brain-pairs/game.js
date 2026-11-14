/* Brain Pairs: a memory game. A Brainstorming Games original. */
(function () {
  'use strict';
  var BG = window.BG;
  var SHAPES = [
    ['#ffd43b', '<circle cx="12" cy="12" r="9"/>'],
    ['#6fe3ff', '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/>'],
    ['#ff7a59', '<path d="M12 2.5 22 20.5H2z"/>'],
    ['#3ddc84', '<path d="M12 2 22 12 12 22 2 12z"/>'],
    ['#c79bff', '<path d="m12 2 2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.4 5.8 21l1.6-7L2 9.300l7.1-.7z"/>'],
    ['#ff5c8a', '<path d="M12 21s-8.5-5.3-8.5-11.2A4.8 4.8 0 0 1 12 6.700a4.800 4.800 0 0 1 8.500 3.100C20.500 15.700 12 21 12 21z"/>'],
    ['#f3f3f4', '<path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z"/>'],
    ['#ffb020', '<path d="M12 2a10 10 0 1 0 10 10h-10z"/>'],
  ];
  var board = document.getElementById('board');
  var panel = document.getElementById('panel');
  var el = function (id) { return document.getElementById(id); };
  var open = [], found = 0, moves = 0, seconds = 0, timer = null, locked = false, best = null, rounds = 0;

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }
  function clock() {
    el('time').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function deal() {
    board.textContent = '';
    open = []; found = 0; moves = 0; seconds = 0; locked = false;
    el('moves').textContent = '0';
    clock();
    shuffle(SHAPES.concat(SHAPES).map(function (s, i) { return { id: i % SHAPES.length, shape: s }; })).forEach(function (card) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile';
      b.setAttribute('aria-label', 'Hidden card');
      b.dataset.id = card.id;
      b.innerHTML = '<span class="face back"></span><span class="face front"><svg viewBox="0 0 24 24" fill="' + card.shape[0] + '" aria-hidden="true">' + card.shape[1] + '</svg></span>';
      b.addEventListener('click', function () { flip(b); });
      board.appendChild(b);
    });
  }
  function flip(tile) {
    if (locked || tile.classList.contains('open')) return;
    tile.classList.add('open');
    open.push(tile);
    if (open.length < 2) return;
    moves++;
    el('moves').textContent = moves;
    var a = open[0], b = open[1];
    open = [];
    if (a.dataset.id === b.dataset.id) {
      a.classList.add('done'); b.classList.add('done');
      a.disabled = b.disabled = true;
      if (++found === SHAPES.length) win();
      return;
    }
    locked = true;
    setTimeout(function () { a.classList.remove('open'); b.classList.remove('open'); locked = false; }, 750);
  }
  function start() {
    panel.hidden = true;
    deal();
    clearInterval(timer);
    timer = setInterval(function () { seconds++; clock(); }, 1000);
    if (BG) BG.game.gameplayStart();
  }
  function win() {
    clearInterval(timer);
    if (BG) BG.game.gameplayStop();
    rounds++;
    // Fewer moves and less time is better; leaderboards rank the highest score first.
    var score = Math.max(0, 2000 - moves * 40 - seconds * 5);
    var record = best == null || moves < best;
    if (record) {
      best = moves;
      el('best').textContent = best;
      if (BG) BG.data.set('best-moves', best).catch(function () {});
    }
    if (BG) {
      BG.leaderboard.submit('score', score).catch(function () {});
      if (record && BG.game.celebrate) BG.game.celebrate();
    }
    el('panel-title').textContent = record ? 'New best!' : 'All pairs found';
    el('panel-text').textContent = moves + ' moves in ' + el('time').textContent + '. Score ' + score + '.';
    el('start').textContent = 'Play again';
    panel.hidden = false;
  }

  el('start').addEventListener('click', function () {
    // A break between rounds is the natural place for an ad; the platform decides if one shows.
    if (BG && rounds > 0) BG.ad.midgame().then(start, start);
    else start();
  });

  if (!BG) return;
  BG.game.loadingStart();
  BG.init()
    .then(function () { return BG.data.get('best-moves'); })
    .then(function (saved) {
      if (typeof saved === 'number') { best = saved; el('best').textContent = saved; }
    })
    .catch(function () {})
    .then(function () { BG.game.loadingStop(); });
})();

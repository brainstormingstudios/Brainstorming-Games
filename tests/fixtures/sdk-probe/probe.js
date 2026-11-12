/*
 * SDK probe (test fixture). Loads the SDK from the site that frames it, then exposes one button
 * per SDK method. Results are written to #log as "name: json" so tests can read them.
 */
(function () {
  var logEl = document.getElementById('log');
  var envEl = document.querySelector('[data-testid="probe-env"]');
  var buttons = document.getElementById('buttons');

  function log(name, value) {
    var li = document.createElement('li');
    li.setAttribute('data-probe', name);
    var text;
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value);
    } catch (_e) {
      text = String(value);
    }
    li.textContent = name + ': ' + text;
    logEl.appendChild(li);
  }

  function button(name, run) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.setAttribute('data-testid', 'probe-' + name);
    b.addEventListener('click', function () {
      try {
        Promise.resolve(run()).then(
          function (result) {
            log(name, result === undefined ? 'ok' : result);
          },
          function (err) {
            log(name, 'error ' + (err && err.message ? err.message : err));
          },
        );
      } catch (err) {
        log(name, 'error ' + (err && err.message ? err.message : err));
      }
    });
    buttons.appendChild(b);
  }

  // The site that frames the probe passes its own origin, so the fixture works on any port.
  var params = new URLSearchParams(location.search);
  var site = params.get('bg_site') || document.referrer.replace(/\/[^/]*$/, '') || '';
  var sdkUrl = (site ? site.replace(/\/+$/, '') : '') + '/sdk/v1/bg-sdk.js';

  function start() {
    var BG = window.BG;
    if (!BG) {
      envEl.textContent = 'no-sdk';
      log('boot', 'sdk not available');
      return;
    }
    BG.init()
      .then(function () {
        envEl.textContent = BG.environment;
        log('init', { environment: BG.environment });

        button('loadingStart', function () { return BG.game.loadingStart(); });
        button('loadingStop', function () { return BG.game.loadingStop(); });
        button('gameplayStart', function () { return BG.game.gameplayStart(); });
        button('gameplayStop', function () { return BG.game.gameplayStop(); });
        button('celebrate', function () { return BG.game.celebrate(); });
        button('reportProgress', function () { return BG.game.reportProgress(50); });
        button('setContext', function () { return BG.game.setContext({ level: 3, seed: 'probe' }); });
        button('clearContext', function () { return BG.game.clearContext(); });
        button('settings', function () { return BG.game.settings; });
        button('inviteLink', function () { return BG.game.inviteLink({ room: 'r1' }); });
        button('getInviteParam', function () { return String(BG.game.getInviteParam('room')); });
        button('updateRoom', function () {
          return BG.game.updateRoom({ roomId: 'r1', isJoinable: true, inviteParams: { room: 'r1' } });
        });

        button('midgame', function () {
          return BG.ad.midgame({
            onStart: function () { log('midgame.onStart', 'ok'); },
            onFinish: function () { log('midgame.onFinish', 'ok'); },
          });
        });
        button('rewarded', function () {
          return BG.ad.rewarded({ onStart: function () { log('rewarded.onStart', 'ok'); } });
        });
        button('showBanner', function () {
          return BG.ad.showBanner({ containerId: 'banner-slot', size: '320x50' });
        });
        button('hideBanner', function () { return BG.ad.hideBanner('banner-slot'); });
        button('hasAdblock', function () { return BG.ad.hasAdblock(); });

        button('userGet', function () { return BG.user.get(); });
        button('getToken', function () {
          return BG.user.getToken().then(function (t) { return t ? 'token:' + String(t).split('.').length : null; });
        });
        button('promptLogin', function () { return BG.user.promptLogin(); });

        button('dataSet', function () { return BG.data.set('probe', { n: 1 }); });
        button('dataGet', function () { return BG.data.get('probe'); });
        button('dataRemove', function () { return BG.data.remove('probe'); });

        button('leaderboardSubmit', function () { return BG.leaderboard.submit('main', 42); });
        button('leaderboardTop', function () { return BG.leaderboard.top('main', { limit: 5 }); });

        button('questsTrack', function () { return BG.quests.track('probe_action', 1); });

        BG.game.onSettingsChange(function (s) { log('onSettingsChange', s); });
        BG.user.onAuthChange(function (u) { log('onAuthChange', u); });

        // A real game would do this itself: report loading, then start gameplay.
        BG.game.loadingStart();
        BG.game.loadingStop();
        BG.game.gameplayStart();
        log('auto', 'loadingStart,loadingStop,gameplayStart');
      })
      .catch(function (err) {
        envEl.textContent = 'error';
        log('init', 'error ' + (err && err.message ? err.message : err));
      });
  }

  var slot = document.createElement('div');
  slot.id = 'banner-slot';
  document.querySelector('main').appendChild(slot);

  var script = document.createElement('script');
  script.src = sdkUrl;
  script.onload = start;
  script.onerror = function () {
    envEl.textContent = 'no-sdk';
    log('boot', 'sdk failed to load from ' + sdkUrl);
  };
  document.head.appendChild(script);
})();

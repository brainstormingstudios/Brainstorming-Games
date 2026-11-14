/* Brainstorming SDK adapter for Project Homecoming.
   The game talks to one small object, window.BGAdapter: loading and gameplay signals, and a
   synchronous key/value store for saves and settings. Saves are written to the device at once
   and mirrored to the player's Brainstorming account (BG.data), so progress follows them. */
(function () {
  'use strict';
  var KEYS_INDEX = '__bg_homecoming_keys';
  var BG = window.BG || null;
  var ready = false;
  var loadingActive = false;
  var gameplayActive = false;
  var log = [];

  function note(action, detail) {
    log.push({ time: Date.now(), action: action, detail: detail });
    if (log.length > 200) log.shift();
  }
  function local(op, key, value) {
    try {
      if (op === 'get') return localStorage.getItem(key);
      if (op === 'set') localStorage.setItem(key, value);
      if (op === 'remove') localStorage.removeItem(key);
    } catch (_) {}
    return null;
  }
  function stamp(raw) {
    try {
      var parsed = JSON.parse(raw);
      return (parsed && parsed.updated) || 0;
    } catch (_) {
      return 0;
    }
  }
  function knownKeys() {
    try {
      return JSON.parse(local('get', KEYS_INDEX) || '[]');
    } catch (_) {
      return [];
    }
  }
  function remember(key) {
    var keys = knownKeys();
    if (keys.indexOf(key) === -1) {
      keys.push(key);
      local('set', KEYS_INDEX, JSON.stringify(keys));
    }
  }

  /** Pulls account saves that are newer than the device copy, and pushes device saves up. */
  function reconcile() {
    if (!BG) return Promise.resolve();
    return BG.data
      .get(KEYS_INDEX)
      .then(function (cloudKeys) {
        var keys = knownKeys();
        (Array.isArray(cloudKeys) ? cloudKeys : []).forEach(function (k) {
          if (keys.indexOf(k) === -1) keys.push(k);
        });
        return Promise.all(
          keys.map(function (key) {
            return BG.data.get(key).then(function (cloud) {
              var mine = local('get', key);
              if (typeof cloud === 'string' && (!mine || stamp(cloud) > stamp(mine))) {
                local('set', key, cloud);
                remember(key);
              } else if (mine && mine !== cloud) {
                return BG.data.set(key, mine);
              }
            });
          }),
        ).then(function () {
          return BG.data.set(KEYS_INDEX, knownKeys());
        });
      })
      .catch(function () {});
  }

  var adapter = {
    init: function () {
      if (!BG) {
        note('init', 'SDK script missing: running standalone');
        return Promise.resolve(false);
      }
      return BG.init()
        .then(reconcile)
        .then(function () {
          ready = true;
          note('init', BG.environment);
          try {
            window.dispatchEvent(new CustomEvent('bg:ready', { detail: { hasData: true } }));
          } catch (_) {}
          return true;
        })
        .catch(function (err) {
          note('init:error', String(err));
          return false;
        });
    },
    isReady: function () {
      return ready;
    },
    isOnPlatform: function () {
      return ready && BG && BG.environment === 'brainstorming';
    },
    hasDataModule: function () {
      return ready;
    },
    getItem: function (key) {
      return local('get', key);
    },
    setItem: function (key, value) {
      local('set', key, value);
      remember(key);
      if (ready) {
        BG.data.set(key, value).catch(function () {});
        BG.data.set(KEYS_INDEX, knownKeys()).catch(function () {});
      }
    },
    removeItem: function (key) {
      local('remove', key);
      if (ready) BG.data.remove(key).catch(function () {});
    },
    clear: function () {
      knownKeys().forEach(function (key) {
        adapter.removeItem(key);
      });
    },
    loadingStart: function () {
      if (loadingActive) return;
      loadingActive = true;
      note('loadingStart');
      if (BG) BG.game.loadingStart();
    },
    loadingStop: function () {
      if (!loadingActive) return;
      loadingActive = false;
      note('loadingStop');
      if (BG) BG.game.loadingStop();
    },
    gameplayStart: function () {
      if (gameplayActive) return;
      gameplayActive = true;
      note('gameplayStart');
      if (BG) BG.game.gameplayStart();
    },
    gameplayStop: function () {
      if (!gameplayActive) return;
      gameplayActive = false;
      note('gameplayStop');
      if (BG) BG.game.gameplayStop();
    },
    getEventLog: function () {
      return log.slice();
    },
    getStatus: function () {
      return { isReady: ready, gameplayActive: gameplayActive, loadingActive: loadingActive, eventCount: log.length };
    },
  };

  window.BGAdapter = adapter;
  adapter.init();
})();

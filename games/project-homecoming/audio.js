/* Project Homecoming — Central Audio System & Manager (Phase 1)
   Supports one-shot SFX, looping ambience, procedural synthesis fallbacks,
   separate audio buses (Master, SFX, Music, Ambience), user gesture unlock,
   rover engine pitch-shifting, astronaut footsteps, drone audio, and settings persistence. */

(function () {
  'use strict';

  const STORAGE_KEY = 'project-homecoming-audio-v1';
  const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

  function dispatchAudioEvent(name, detail) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent(name, { detail }));
      } catch (_) { }
    }
  }

  // Sound Asset Catalog with paths and intended triggers
  const ASSET_CATALOG = [
    // UI
    { id: 'ui_click', category: 'ui', path: 'assets/audio/ui/click.mp3', desc: 'Button click / menu selection' },
    { id: 'ui_hover', category: 'ui', path: 'assets/audio/ui/hover.mp3', desc: 'Button hover / focus' },
    { id: 'ui_back', category: 'ui', path: 'assets/audio/ui/back.mp3', desc: 'Cancel / back action' },
    // Astronaut
    { id: 'footstep', category: 'astronaut', path: 'assets/audio/astronaut/footstep_1.mp3', desc: 'Astronaut surface footsteps' },
    { id: 'jump', category: 'astronaut', path: 'assets/audio/astronaut/jump.mp3', desc: 'Astronaut jump whoosh' },
    { id: 'land', category: 'astronaut', path: 'assets/audio/astronaut/land.mp3', desc: 'Astronaut landing impact' },
    { id: 'suit_breathe', category: 'astronaut', path: 'assets/audio/astronaut/breathe.mp3', desc: 'Suit life-support breathing loop' },
    { id: 'warning_low_o2', category: 'astronaut', path: 'assets/audio/astronaut/warning_low_o2.mp3', desc: 'Low oxygen reserve warning beep' },
    { id: 'warning_suit', category: 'astronaut', path: 'assets/audio/astronaut/warning_suit.mp3', desc: 'Suit integrity damage alarm' },
    // Rover
    { id: 'rover_start', category: 'rover', path: 'assets/audio/rover/start.mp3', desc: 'Rover ignition startup' },
    { id: 'rover_engine', category: 'rover', path: 'assets/audio/rover/engine_loop.mp3', desc: 'Rover motor loop (pitch-shifted)' },
    { id: 'rover_brake', category: 'rover', path: 'assets/audio/rover/brake.mp3', desc: 'Rover braking skid / pneumatic hiss' },
    { id: 'rover_stop', category: 'rover', path: 'assets/audio/rover/stop.mp3', desc: 'Rover power-down shutdown' },
    // Interactions
    { id: 'terminal_open', category: 'interactions', path: 'assets/audio/interactions/terminal_open.mp3', desc: 'Terminal access chime' },
    { id: 'pickup_salvage', category: 'interactions', path: 'assets/audio/interactions/pickup_salvage.mp3', desc: 'Salvage / credit pickup' },
    { id: 'pickup_component', category: 'interactions', path: 'assets/audio/interactions/pickup_component.mp3', desc: 'Key ascent engine component collected' },
    { id: 'repair', category: 'interactions', path: 'assets/audio/interactions/repair.mp3', desc: 'Machinery repair / terminal online' },
    { id: 'audiolog_play', category: 'interactions', path: 'assets/audio/interactions/audiolog_play.mp3', desc: 'Audio log discovery radio burst' },
    // Puzzles
    { id: 'puzzle_start', category: 'puzzles', path: 'assets/audio/puzzles/puzzle_start.mp3', desc: 'Puzzle interface initialization' },
    { id: 'puzzle_click', category: 'puzzles', path: 'assets/audio/puzzles/puzzle_click.mp3', desc: 'Puzzle node connect / tile action' },
    { id: 'puzzle_success', category: 'puzzles', path: 'assets/audio/puzzles/puzzle_success.mp3', desc: 'Puzzle sub-step success chime' },
    { id: 'puzzle_error', category: 'puzzles', path: 'assets/audio/puzzles/puzzle_error.mp3', desc: 'Puzzle mistake warning tone' },
    { id: 'puzzle_complete', category: 'puzzles', path: 'assets/audio/puzzles/puzzle_complete.mp3', desc: 'Puzzle solved harmonic fanfare' },
    // Combat
    { id: 'drone_hum', category: 'combat', path: 'assets/audio/combat/drone_hum.mp3', desc: 'Patrol drone hovering hum (spatialized)' },
    { id: 'drone_alert', category: 'combat', path: 'assets/audio/combat/drone_alert.mp3', desc: 'Drone target acquisition alert' },
    { id: 'drone_laser', category: 'combat', path: 'assets/audio/combat/drone_laser.mp3', desc: 'Security drone red laser beam discharge' },
    { id: 'laser_impact', category: 'combat', path: 'assets/audio/combat/laser_impact.mp3', desc: 'Laser blast impact on astronaut suit' },
    { id: 'emp_blast', category: 'combat', path: 'assets/audio/combat/emp_blast.mp3', desc: 'EMP tool discharge impact' },
    { id: 'drone_shutdown', category: 'combat', path: 'assets/audio/combat/drone_shutdown.mp3', desc: 'Drone disabled power-down whine' },
    // Planets Ambience
    { id: 'ambience_mars', category: 'planets', path: 'assets/audio/planets/mars_ambience.mp3', desc: 'Mars wind gusts & dust rumble' },
    { id: 'ambience_phobos', category: 'planets', path: 'assets/audio/planets/phobos_ambience.mp3', desc: 'Phobos station interior vacuum hum' },
    { id: 'ambience_europa', category: 'planets', path: 'assets/audio/planets/europa_ambience.mp3', desc: 'Europa ice-plate stress & deep pings' },
    { id: 'ambience_titan', category: 'planets', path: 'assets/audio/planets/titan_ambience.mp3', desc: 'Titan heavy methane atmospheric roar' },
    { id: 'ambience_ceres', category: 'planets', path: 'assets/audio/planets/ceres_ambience.mp3', desc: 'Ceres cold void silence & debris ticks' },
    { id: 'ambience_earth', category: 'planets', path: 'assets/audio/planets/earth_ambience.mp3', desc: 'Earth atmospheric breeze & coastal drone' },
    // Spacecraft
    { id: 'departure', category: 'spacecraft', path: 'assets/audio/spacecraft/departure.mp3', desc: 'Ascent engine burn & launch roar' },
    { id: 'travel_loop', category: 'spacecraft', path: 'assets/audio/spacecraft/travel_loop.mp3', desc: 'Interplanetary transit drive hum' },
    { id: 'arrival', category: 'spacecraft', path: 'assets/audio/spacecraft/arrival.mp3', desc: 'Atmospheric entry burn & touchdown' },
    { id: 'ship_ignition', category: 'spacecraft', path: 'assets/audio/spacecraft/ignition.mp3', desc: 'Spacecraft main engine ignition' },
    { id: 'flight_thruster', category: 'spacecraft', path: 'assets/audio/spacecraft/thruster.mp3', desc: 'Spacecraft flight vector thrusters' },
    { id: 'asteroid_nearmiss', category: 'spacecraft', path: 'assets/audio/spacecraft/nearmiss.mp3', desc: 'Asteroid evasion near-miss whoosh' },
    { id: 'asteroid_collision', category: 'spacecraft', path: 'assets/audio/spacecraft/collision.mp3', desc: 'Asteroid shield impact collision' },
    { id: 'jump_charge', category: 'spacecraft', path: 'assets/audio/spacecraft/jump_charge.mp3', desc: 'Hyperspace jump drive capacitor charge' },
    { id: 'lightspeed_jump', category: 'spacecraft', path: 'assets/audio/spacecraft/lightspeed_jump.mp3', desc: 'Light-speed hyperspace acceleration boom' },
    { id: 'wormhole_vortex', category: 'spacecraft', path: 'assets/audio/spacecraft/wormhole_vortex.mp3', desc: 'Wormhole gravitational accretion vortex hum' },
    { id: 'wormhole_entry', category: 'spacecraft', path: 'assets/audio/spacecraft/wormhole_entry.mp3', desc: 'Wormhole singularity entry dimensional flare' },
    // ORA
    { id: 'ora_chime', category: 'ora', path: 'assets/audio/ora/chime.mp3', desc: 'ORA AI transmission alert chime' },
    // Music
    { id: 'music_theme', category: 'music', path: 'assets/audio/music/theme.mp3', desc: 'Project Homecoming ambient space theme' }
  ];

  class AudioManager {
    constructor() {
      this.ctx = null;
      this.unlocked = false;
      this.buffers = new Map();
      this.assetStatus = new Map(); // id -> 'loaded' | 'synthesized'

      // Gain buses
      this.masterGain = null;
      this.sfxGain = null;
      this.musicGain = null;
      this.ambienceGain = null;

      // Settings
      this.settings = this.loadSettings();

      // State tracking
      this.currentAmbienceId = null;
      this.ambienceNodes = null;
      this.musicNodes = null;
      this.roverEngineNodes = null;
      this.droneNodes = null;
      this.suitBreathingNodes = null;
      this.isPaused = false;
      this.lastWarningTime = 0;
      this.lastBrakeTime = 0;

      // Music and state tracking
      this.pendingMusicStart = true;

      // Noise buffer cache for procedural synthesis
      this.noiseBuffer = null;

      // Text-To-Speech (Web Speech API)
      this.initSpeech();

      // Bind comprehensive gesture unlock (clicks, touches, keys, pointerdown, wheel)
      if (typeof window !== 'undefined') {
        const unlock = () => {
          this.initContext();
          const startMusicIfPending = () => {
            if (this.pendingMusicStart || !this.musicNodes) {
              this.startMusic('theme');
            }
          };
          if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().then(() => {
              startMusicIfPending();
              dispatchAudioEvent('homecoming-audio-state', { playing: true });
            }).catch(() => { });
          } else {
            startMusicIfPending();
          }
        };

        const unlockEvents = ['click', 'pointerdown', 'mousedown', 'touchstart', 'touchend', 'keydown', 'wheel'];
        unlockEvents.forEach(ev => window.addEventListener(ev, unlock, { passive: true }));
      }
    }

    loadSettings() {
      const defaults = { master: 0.8, sfx: 0.85, music: 0.65, ambience: 0.75, voice: 0.9, voiceEnabled: true, muted: false };
      try {
        let raw = null;
        if (typeof window !== 'undefined' && window.BGAdapter && typeof window.BGAdapter.getItem === 'function') {
          raw = window.BGAdapter.getItem(STORAGE_KEY);
        }
        if (!raw && typeof localStorage !== 'undefined') {
          raw = localStorage.getItem(STORAGE_KEY);
        }
        if (!raw) return defaults;
        const saved = JSON.parse(raw);
        return Object.assign(defaults, saved);
      } catch (_) {
        return defaults;
      }
    }

    saveSettings() {
      try {
        const val = JSON.stringify(this.settings);
        if (typeof window !== 'undefined' && window.BGAdapter && typeof window.BGAdapter.setItem === 'function') {
          window.BGAdapter.setItem(STORAGE_KEY, val);
        } else if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, val);
        }
      } catch (_) { }
    }

    initContext() {
      if (this.ctx && this.ctx.state !== 'suspended') return;
      if (!AudioCtx) return;
      try {
        if (!this.ctx) {
          this.ctx = new AudioCtx();
          // Create Audio Graph Bus Architecture
          this.masterGain = this.ctx.createGain();
          this.sfxGain = this.ctx.createGain();
          this.musicGain = this.ctx.createGain();
          this.ambienceGain = this.ctx.createGain();

          this.sfxGain.connect(this.masterGain);
          this.musicGain.connect(this.masterGain);
          this.ambienceGain.connect(this.masterGain);
          this.masterGain.connect(this.ctx.destination);

          this.applyVolumes();
        }
        if (this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
        this.unlocked = true;
        this.initNoiseBuffer();
      } catch (err) {
        console.warn('AudioManager: Web Audio could not be initialized.', err);
      }
    }

    initNoiseBuffer() {
      if (!this.ctx || this.noiseBuffer) return;
      const sr = this.ctx.sampleRate;
      const dur = 2.0;
      const buf = this.ctx.createBuffer(1, sr * dur, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buf;
    }

    applyVolumes() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const m = this.settings.muted ? 0 : this.settings.master;
      this.masterGain.gain.setValueAtTime(m, t);
      this.sfxGain.gain.setValueAtTime(this.settings.sfx, t);
      this.musicGain.gain.setValueAtTime(this.settings.music, t);
      this.ambienceGain.gain.setValueAtTime(this.settings.ambience, t);
    }

    setMasterVolume(val) {
      this.settings.master = Math.max(0, Math.min(1, val));
      this.saveSettings();
      this.applyVolumes();
    }

    setSfxVolume(val) {
      this.settings.sfx = Math.max(0, Math.min(1, val));
      this.saveSettings();
      this.applyVolumes();
    }

    setMusicVolume(val) {
      this.settings.music = Math.max(0, Math.min(1, val));
      this.saveSettings();
      this.applyVolumes();
    }

    setAmbienceVolume(val) {
      this.settings.ambience = Math.max(0, Math.min(1, val));
      this.saveSettings();
      this.applyVolumes();
    }

    setMuted(muted) {
      this.settings.muted = !!muted;
      if (this.settings.muted) this.stopSpeech();
      this.saveSettings();
      this.applyVolumes();
    }

    setVoiceVolume(val) {
      this.settings.voice = Math.max(0, Math.min(1, val));
      this.saveSettings();
    }

    setVoiceEnabled(val) {
      this.settings.voiceEnabled = !!val;
      if (!this.settings.voiceEnabled) this.stopSpeech();
      this.saveSettings();
    }

    isSpeaking() {
      return typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking;
    }

    /* ─────────────────────────────────────────────────────────────────────
       TEXT-TO-SPEECH (TTS) NARRATION SYSTEM (Web Speech API)
       Voice synthesis for ORA AI, Expedition Audio Logs, and HUD Telemetry
       ───────────────────────────────────────────────────────────────────── */
    initSpeech() {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      this.speechSynth = window.speechSynthesis;
      this.voices = [];
      this.oraVoice = null;
      this.logVoice = null;

      const loadVoices = () => {
        try {
          this.voices = this.speechSynth.getVoices() || [];
          if (!this.voices.length) return;

          const enVoices = this.voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
          const pool = enVoices.length ? enVoices : this.voices;

          // 1. ORA AI Voice: prefer female, clear, synthetic or natural assistant voice
          this.oraVoice = pool.find(v => {
            const n = v.name.toLowerCase();
            return (n.includes('zira') || n.includes('samantha') || n.includes('jenny') || n.includes('victoria') || n.includes('female') || n.includes('google us english') || n.includes('eva') || n.includes('karen') || n.includes('serena'));
          }) || pool.find(v => v.name.toLowerCase().includes('female')) || pool[0];

          // 2. Expedition Log / Crew Voice: prefer warm, lower, human conversational voice
          this.logVoice = pool.find(v => {
            const n = v.name.toLowerCase();
            return (n.includes('david') || n.includes('mark') || n.includes('guy') || n.includes('alex') || n.includes('male') || n.includes('george') || n.includes('daniel') || n.includes('tom'));
          }) || pool.find(v => v !== this.oraVoice) || pool[0];
        } catch (_) { }
      };

      loadVoices();
      if (typeof this.speechSynth.onvoiceschanged !== 'undefined') {
        this.speechSynth.onvoiceschanged = loadVoices;
      }

      // Chrome watchdog to prevent speech synthesis from going idle on long utterances
      if (!this.speechWatchdog && typeof setInterval !== 'undefined') {
        this.speechWatchdog = setInterval(() => {
          if (this.speechSynth && this.speechSynth.speaking && !this.speechSynth.paused) {
            this.speechSynth.pause();
            this.speechSynth.resume();
          }
        }, 12000);
      }
    }

    calculateSpeechDuration(text) {
      if (!text || typeof text !== 'string') return 2.8;
      const clean = text.replace(/[^a-zA-Z0-9\s]/g, '').trim();
      // Average human/TTS reading pace: ~14 characters per second, bounded between 2.8s and 8.5s
      return Math.max(2.8, Math.min(8.5, clean.length / 13.5));
    }

    speak(text, role = 'ora', options = {}) {
      const onend = typeof options.onend === 'function' ? options.onend : null;
      const onerror = typeof options.onerror === 'function' ? options.onerror : null;
      let callbackFired = false;

      const triggerEnd = (ev) => {
        if (callbackFired) return;
        callbackFired = true;
        if (this._ttsFallbackTimer) {
          clearTimeout(this._ttsFallbackTimer);
          this._ttsFallbackTimer = null;
        }
        if (onend) {
          try { onend(ev); } catch (err) { console.warn('TTS onend callback error:', err); }
        }
      };

      if (!text || typeof text !== 'string') {
        if (onend) setTimeout(triggerEnd, 50);
        return;
      }

      const clean = text
        .replace(/\*+/g, '')
        .replace(/^ORA:\s*/i, '')
        .replace(/^▶\s*/, '')
        .replace(/["'«»]/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!clean) {
        if (onend) setTimeout(triggerEnd, 50);
        return;
      }

      const expectedDurationSec = this.calculateSpeechDuration(clean);

      // If speech synthesis is unavailable or muted/disabled, use calculated reading duration
      if (typeof window === 'undefined' || !('speechSynthesis' in window) || !this.settings || this.settings.muted || this.settings.voiceEnabled === false) {
        if (onend) {
          this._ttsFallbackTimer = setTimeout(triggerEnd, expectedDurationSec * 1000);
        }
        return;
      }

      try {
        if (!this.speechSynth) this.initSpeech();
        if (!this.speechSynth) {
          if (onend) {
            this._ttsFallbackTimer = setTimeout(triggerEnd, expectedDurationSec * 1000);
          }
          return;
        }

        if (options.interrupt !== false) {
          this.stopSpeech();
        }

        const utter = new SpeechSynthesisUtterance(clean);
        const voiceVol = this.settings.voice != null ? this.settings.voice : 0.9;
        const masterVol = this.settings.master != null ? this.settings.master : 0.8;
        utter.volume = Math.max(0, Math.min(1, voiceVol * masterVol));

        if (role === 'log') {
          // Expedition Crew Log: thoughtful, slightly lower pitch, steady cadence
          utter.pitch = options.pitch || 0.92;
          utter.rate = options.rate || 0.96;
          if (this.logVoice) utter.voice = this.logVoice;
        } else if (role === 'hud') {
          // HUD Telemetry / Navigation Announcement: clear, confident, crisp
          utter.pitch = options.pitch || 1.05;
          utter.rate = options.rate || 1.04;
          if (this.oraVoice) utter.voice = this.oraVoice;
        } else {
          // ORA AI Companion: melodic, futuristic, synthetic intelligence
          utter.pitch = options.pitch || 1.15;
          utter.rate = options.rate || 1.04;
          if (this.oraVoice) utter.voice = this.oraVoice;
        }

        utter.onend = (ev) => {
          triggerEnd(ev);
        };
        utter.onerror = (ev) => {
          if (onerror) {
            try { onerror(ev); } catch (_) { }
          }
          triggerEnd(ev);
        };

        // Safety watchdog: guarantees triggerEnd fires even if browser TTS engine stalls
        this._ttsFallbackTimer = setTimeout(() => {
          triggerEnd();
        }, (expectedDurationSec + 2.5) * 1000);

        this.speechSynth.speak(utter);
      } catch (err) {
        console.warn('AudioManager TTS speak error:', err);
        triggerEnd();
      }
    }

    stopSpeech() {
      if (this._ttsFallbackTimer) {
        clearTimeout(this._ttsFallbackTimer);
        this._ttsFallbackTimer = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (_) { }
      }
    }

    getSettings() {
      return Object.assign({}, this.settings);
    }

    /* ─────────────────────────────────────────────────────────────────────
       PROCEDURAL AUDIO SYNTHESIS GENERATORS (Web Audio API)
       ───────────────────────────────────────────────────────────────────── */
    play(soundId, options = {}) {
      this.initContext();
      if (!this.ctx || this.settings.muted || this.settings.master === 0) return;
      const t = this.ctx.currentTime;

      switch (soundId) {
        case 'ui_click':
          this.synthTone(880, 520, 0.05, 'sine', 0.18);
          break;
        case 'ui_hover':
          this.synthTone(1400, 1600, 0.03, 'sine', 0.06);
          break;
        case 'ui_back':
          this.synthTone(600, 320, 0.08, 'sine', 0.16);
          break;
        case 'jump':
          this.synthWhoosh(240, 850, 0.18, 0.22);
          break;
        case 'land':
          this.synthThud(65, 0.18, 0.35);
          break;
        case 'terminal_open':
          this.synthArp([440, 554.37, 659.25, 880], 0.06, 'sine', 0.18);
          break;
        case 'pickup_salvage':
          this.synthArp([587.33, 739.99, 880, 1174.66], 0.05, 'triangle', 0.22);
          break;
        case 'pickup_component':
          this.synthArp([392, 523.25, 659.25, 783.99, 1046.50], 0.08, 'sine', 0.32);
          break;
        case 'repair':
          this.synthRepairSequence();
          break;
        case 'audiolog_play':
          this.synthRadioStatic(0.32);
          setTimeout(() => this.synthTone(1200, 1200, 0.04, 'sine', 0.12), 220);
          break;
        case 'puzzle_start':
          this.synthArp([440, 659.25, 880], 0.08, 'sine', 0.18);
          break;
        case 'puzzle_click':
          this.synthTone(980, 780, 0.03, 'triangle', 0.14);
          break;
        case 'puzzle_success':
          this.synthArp([659.25, 987.77], 0.08, 'sine', 0.22);
          break;
        case 'puzzle_error':
          this.synthBuzz(130, 0.22, 0.25);
          break;
        case 'puzzle_complete':
          this.synthArp([523.25, 659.25, 783.99, 1046.50, 1318.51], 0.10, 'sine', 0.35);
          break;
        case 'emp_blast':
          this.synthEmp();
          break;
        case 'drone_alert':
          this.synthTone(1760, 1760, 0.06, 'square', 0.2);
          break;
        case 'drone_laser':
          this.synthTone(1420, 260, 0.24, 'sawtooth', 0.32);
          break;
        case 'laser_impact':
          this.synthTone(480, 85, 0.26, 'triangle', 0.42);
          break;
        case 'drone_shutdown':
          this.synthTone(750, 60, 0.6, 'sawtooth', 0.28);
          break;
        case 'departure':
          this.synthThruster(2.2);
          break;
        case 'arrival':
          this.synthThruster(1.5, true);
          break;
        case 'ship_ignition':
          this.synthShipIgnition();
          break;
        case 'flight_thruster':
          this.synthFlightThruster();
          break;
        case 'asteroid_nearmiss':
          this.synthAsteroidNearMiss();
          break;
        case 'asteroid_collision':
          this.synthAsteroidCollision();
          break;
        case 'jump_charge':
          this.synthJumpCharge();
          break;
        case 'lightspeed_jump':
          this.synthHyperspaceJump();
          break;
        case 'wormhole_vortex':
          this.synthWormholeVortex();
          break;
        case 'wormhole_entry':
          this.synthWormholeEntry();
          break;
        case 'mission_update':
          this.synthArp([523.25, 783.99], 0.12, 'sine', 0.24);
          break;
        case 'mission_complete':
          this.synthArp([440, 554.37, 659.25, 880, 1108.73], 0.12, 'triangle', 0.35);
          break;
        case 'ora_chime':
          this.synthArp([1760, 2093], 0.06, 'sine', 0.16);
          break;
        case 'scanner_start':
          this.synthTone(480, 1200, 0.16, 'sine', 0.2);
          break;
        case 'scanner_loop':
          this.synthTone(880, 920, 0.08, 'sine', 0.08);
          break;
        case 'scanner_complete':
          this.synthArp([523.25, 659.25, 783.99, 1046.50, 1318.51], 0.07, 'sine', 0.28);
          break;
        case 'scanner_abort':
          this.synthTone(500, 220, 0.14, 'triangle', 0.18);
          break;
        case 'fragment_found':
          this.synthArp([440, 554.37, 659.25, 880, 1108.73, 1318.51], 0.08, 'triangle', 0.32);
          break;
        case 'contract_complete':
          this.synthArp([587.33, 739.99, 880, 1174.66], 0.06, 'sine', 0.26);
          break;
        default:
          break;
      }
    }

    // Footstep with surface variation and randomized micro-pitch
    playFootstep(surface = 'mars', isRunning = false) {
      if (!this.ctx || this.settings.muted) return;
      const t = this.ctx.currentTime;
      const pitchMod = 0.92 + Math.random() * 0.16;
      const volMod = 0.85 + Math.random() * 0.25;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      let freq = 75 * pitchMod;
      let filterCutoff = 450;
      let duration = isRunning ? 0.06 : 0.08;

      if (surface === 'europa') { // Ice crack crunch
        freq = 110 * pitchMod;
        filterCutoff = 800;
        filter.type = 'highpass';
      } else if (surface === 'titan') { // Damp methane soil
        freq = 60 * pitchMod;
        filterCutoff = 320;
        filter.type = 'lowpass';
      } else { // Mars regolith
        filter.type = 'lowpass';
      }

      filter.frequency.setValueAtTime(filterCutoff, t);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + duration);

      const baseVol = (isRunning ? 0.22 : 0.15) * volMod;
      gain.gain.setValueAtTime(baseVol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + duration);

      // Noise layer for crunch
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const nFilter = this.ctx.createBiquadFilter();
        nFilter.type = 'bandpass';
        nFilter.frequency.setValueAtTime(surface === 'europa' ? 1200 : 500, t);
        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(baseVol * 0.7, t);
        nGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        noise.connect(nFilter);
        nFilter.connect(nGain);
        nGain.connect(this.sfxGain);
        noise.start(t);
        noise.stop(t + duration);
      }
    }

    // Suit life-support breathing rhythm
    startSuitBreathing() {
      if (this.suitBreathingNodes || !this.ctx) return;
      try {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
        gain.connect(this.sfxGain);

        // Slow cyclic breathing oscillator
        const lfo = this.ctx.createOscillator();
        lfo.frequency.setValueAtTime(0.25, this.ctx.currentTime); // ~4 sec respiratory cycle
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.setValueAtTime(0.03, this.ctx.currentTime);
        lfo.connect(lfoGain.gain);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(650, this.ctx.currentTime);
        filter.Q.setValueAtTime(1.5, this.ctx.currentTime);

        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        noise.loop = true;

        noise.connect(filter);
        filter.connect(gain);
        noise.start();
        lfo.start();

        this.suitBreathingNodes = { noise, lfo, gain };
      } catch (_) { }
    }

    stopSuitBreathing() {
      if (!this.suitBreathingNodes) return;
      try {
        this.suitBreathingNodes.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
        setTimeout(() => {
          if (this.suitBreathingNodes) {
            this.suitBreathingNodes.noise.stop();
            this.suitBreathingNodes.lfo.stop();
            this.suitBreathingNodes = null;
          }
        }, 350);
      } catch (_) {
        this.suitBreathingNodes = null;
      }
    }

    playWarning(type) {
      const now = performance.now();
      if (now - this.lastWarningTime < 3200) return; // Prevent spamming
      this.lastWarningTime = now;
      this.initContext();
      if (!this.ctx || this.settings.muted) return;

      const t = this.ctx.currentTime;
      // Staccato dual beep
      this.synthTone(880, 880, 0.08, 'square', 0.18, t);
      this.synthTone(660, 660, 0.08, 'square', 0.18, t + 0.12);
      this.synthTone(880, 880, 0.08, 'square', 0.18, t + 0.35);
      this.synthTone(660, 660, 0.08, 'square', 0.18, t + 0.47);
    }

    /* ─────────────────────────────────────────────────────────────────────
       ROVER ENGINE AUDIO (State-responsive pitch & load)
       ───────────────────────────────────────────────────────────────────── */
    startRoverEngine() {
      if (this.roverEngineNodes || !this.ctx) return;
      this.play('rover_start');
      const t = this.ctx.currentTime;

      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(45, t);
      osc2.frequency.setValueAtTime(90, t);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(260, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.4);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc1.start(t);
      osc2.start(t);

      this.roverEngineNodes = { osc1, osc2, filter, gain };
    }

    updateRoverEngine(speed, throttle, isBoost) {
      if (!this.roverEngineNodes || !this.ctx) return;
      const t = this.ctx.currentTime;
      const absSpeed = Math.abs(speed || 0);

      // Pitch shifts smoothly from 45Hz idle to 140Hz at top speed (24 m/s)
      const baseFreq = 45 + Math.min(95, (absSpeed / 24) * 95);
      this.roverEngineNodes.osc1.frequency.setTargetAtTime(baseFreq, t, 0.08);
      this.roverEngineNodes.osc2.frequency.setTargetAtTime(baseFreq * 1.8, t, 0.08);

      // Filter opens up under heavy throttle/boost
      const cutoff = 260 + (absSpeed / 24) * 600 + (isBoost ? 250 : 0) + (throttle > 0 ? 120 : 0);
      this.roverEngineNodes.filter.frequency.setTargetAtTime(cutoff, t, 0.08);

      // Volume responds to speed and load
      const vol = 0.18 + (absSpeed / 24) * 0.16 + (isBoost ? 0.08 : 0);
      this.roverEngineNodes.gain.gain.setTargetAtTime(vol, t, 0.08);

      // Braking sound when reversing while moving forward
      if (throttle < 0 && speed > 4) {
        const now = performance.now();
        if (now - this.lastBrakeTime > 900) {
          this.lastBrakeTime = now;
          this.synthWhoosh(600, 200, 0.25, 0.2);
        }
      }
    }

    stopRoverEngine() {
      if (!this.roverEngineNodes || !this.ctx) return;
      const t = this.ctx.currentTime;
      this.play('rover_stop');
      this.roverEngineNodes.gain.gain.linearRampToValueAtTime(0, t + 0.35);
      this.roverEngineNodes.osc1.frequency.exponentialRampToValueAtTime(25, t + 0.35);
      setTimeout(() => {
        if (this.roverEngineNodes) {
          this.roverEngineNodes.osc1.stop();
          this.roverEngineNodes.osc2.stop();
          this.roverEngineNodes = null;
        }
      }, 380);
    }

    /* ─────────────────────────────────────────────────────────────────────
       DRONE HOVER & SPATIAL AUDIO
       ───────────────────────────────────────────────────────────────────── */
    updateDrone(distance, isAlert, isDisabled) {
      if (isDisabled) {
        if (this.droneNodes) this.stopDrone();
        return;
      }
      if (!this.ctx || this.settings.muted) return;

      // Start drone loop if within 22m
      if (distance < 22) {
        if (!this.droneNodes) {
          const t = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const filter = this.ctx.createBiquadFilter();

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(115, t);
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(400, t);
          gain.gain.setValueAtTime(0.001, t);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.sfxGain);
          osc.start();

          this.droneNodes = { osc, gain, filter, wasAlert: false };
        }
        const t = this.ctx.currentTime;
        // Distance attenuation
        const vol = Math.max(0, (1 - distance / 22)) * (isAlert ? 0.35 : 0.22);
        this.droneNodes.gain.gain.setTargetAtTime(vol, t, 0.1);
        this.droneNodes.osc.frequency.setTargetAtTime(isAlert ? 165 : 115, t, 0.1);

        if (isAlert && !this.droneNodes.wasAlert) {
          this.play('drone_alert');
          this.droneNodes.wasAlert = true;
        } else if (!isAlert) {
          this.droneNodes.wasAlert = false;
        }
      } else if (this.droneNodes) {
        this.stopDrone();
      }
    }

    stopDrone() {
      if (!this.droneNodes || !this.ctx) return;
      try {
        this.droneNodes.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
        setTimeout(() => {
          if (this.droneNodes) {
            this.droneNodes.osc.stop();
            this.droneNodes = null;
          }
        }, 320);
      } catch (_) {
        this.droneNodes = null;
      }
    }

    /* ─────────────────────────────────────────────────────────────────────
       PLANET AMBIENCE & CROSSFADING
       ───────────────────────────────────────────────────────────────────── */
    setPlanetAmbience(planetId) {
      const ambId = 'ambience_' + planetId;
      if (this.currentAmbienceId === ambId) return;
      this.currentAmbienceId = ambId;
      this.stopAmbience();

      this.initContext();
      if (!this.ctx || this.settings.muted) return;
      const t = this.ctx.currentTime;

      // Create dual-layer planet ambience (low rumble drone + filtered wind)
      const droneOsc = this.ctx.createOscillator();
      const droneFilter = this.ctx.createBiquadFilter();
      const droneGain = this.ctx.createGain();

      let baseFreq = 50;
      let filterCutoff = 220;
      if (planetId === 'phobos') { baseFreq = 40; filterCutoff = 180; }
      else if (planetId === 'europa') { baseFreq = 62; filterCutoff = 380; }
      else if (planetId === 'titan') { baseFreq = 78; filterCutoff = 480; }
      else if (planetId === 'ceres') { baseFreq = 36; filterCutoff = 140; }
      else if (planetId === 'earth') { baseFreq = 55; filterCutoff = 300; }

      droneOsc.type = 'sine';
      droneOsc.frequency.setValueAtTime(baseFreq, t);
      droneFilter.type = 'lowpass';
      droneFilter.frequency.setValueAtTime(filterCutoff, t);

      droneGain.gain.setValueAtTime(0.001, t);
      droneGain.gain.linearRampToValueAtTime(0.28, t + 1.8);

      droneOsc.connect(droneFilter);
      droneFilter.connect(droneGain);
      droneGain.connect(this.ambienceGain);
      droneOsc.start(t);

      // Wind layer using noise buffer
      let windNodes = null;
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        noise.loop = true;
        const wFilter = this.ctx.createBiquadFilter();
        wFilter.type = 'bandpass';
        wFilter.frequency.setValueAtTime(planetId === 'titan' ? 380 : 260, t);
        wFilter.Q.setValueAtTime(1.8, t);
        const wGain = this.ctx.createGain();
        wGain.gain.setValueAtTime(0.001, t);
        wGain.gain.linearRampToValueAtTime(planetId === 'phobos' || planetId === 'ceres' ? 0.06 : 0.22, t + 2.0);

        noise.connect(wFilter);
        wFilter.connect(wGain);
        wGain.connect(this.ambienceGain);
        noise.start(t);
        windNodes = { noise, wGain };
      }

      this.ambienceNodes = { droneOsc, droneGain, windNodes };
    }

    setAmbience(type) {
      if (type === 'none') {
        this.stopAmbience();
      } else if (type === 'space_travel') {
        this.stopAmbience();
        this.synthSpaceTravelAmbience();
      } else if (type === 'title') {
        this.stopAmbience();
        this.synthTitleAmbience();
      }
    }

    stopAmbience() {
      if (!this.ambienceNodes || !this.ctx) return;
      const t = this.ctx.currentTime;
      try {
        this.ambienceNodes.droneGain.gain.linearRampToValueAtTime(0.001, t + 1.2);
        if (this.ambienceNodes.windNodes) {
          this.ambienceNodes.windNodes.wGain.gain.linearRampToValueAtTime(0.001, t + 1.2);
        }
        setTimeout(() => {
          if (this.ambienceNodes) {
            try { this.ambienceNodes.droneOsc.stop(); } catch (_) { }
            if (this.ambienceNodes.windNodes) {
              try { this.ambienceNodes.windNodes.noise.stop(); } catch (_) { }
            }
            this.ambienceNodes = null;
          }
        }, 1300);
      } catch (_) {
        this.ambienceNodes = null;
      }
    }

    /* ─────────────────────────────────────────────────────────────────────
       CINEMATIC MAIN THEME & BACKGROUND SPACE MUSIC
       Rich multi-layered space orchestral synthesizer:
       - Layer 1: Warm analog dual-oscillator bass (fundamental + 2nd harmonic)
       - Layer 2: Symphonic polyphonic celestial pads with chorus detuning
       - Layer 3: Shimmering starlight cosmic arpeggiator
       - Layer 4: Homecoming theme leitmotif melody bells
       - Immediate 0.2s attack bloom (no silent 2.5s delay)
       - Audible on laptop, mobile speakers, and high-fidelity headphones
       ───────────────────────────────────────────────────────────────────── */
    startThemeMusic() {
      this.startMusic('theme');
    }

    isMusicPlaying() {
      return Boolean(this.musicNodes && !this.settings.muted && this.ctx && this.ctx.state === 'running');
    }

    isAudioSuspended() {
      return Boolean(!this.ctx || this.ctx.state === 'suspended');
    }

    resumeAudio() {
      this.initContext();
      if (!this.ctx) return Promise.resolve(false);
      if (this.ctx.state === 'suspended') {
        return this.ctx.resume().then(() => {
          if (!this.musicNodes && !this.settings.muted) {
            this.startMusic('theme');
          }
          dispatchAudioEvent('homecoming-audio-state', { playing: true });
          return true;
        }).catch(() => false);
      }
      if (!this.musicNodes && !this.settings.muted) {
        this.startMusic('theme');
      }
      return Promise.resolve(true);
    }

    toggleMusic() {
      if (this.isMusicPlaying()) {
        this.stopMusic();
        return false;
      } else {
        if (this.settings.muted) this.setMuted(false);
        this.resumeAudio();
        return true;
      }
    }

    startMusic(mode = 'theme') {
      if (this.musicNodes || this.settings.muted) return;
      this.initContext();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.pendingMusicStart = true;
        // Attempt immediate resume if triggered during user gesture
        try {
          this.ctx.resume().then(() => {
            if (!this.musicNodes && !this.settings.muted) {
              this.startMusic(mode);
            }
          }).catch(() => { });
        } catch (_) { }
        return;
      }
      this.pendingMusicStart = false;

      // Majestic cinematic space chord progression: Dm9 -> Bbmaj9 -> Fmaj9 -> C9sus4
      const chords = [
        {
          name: 'Dm9',
          bass: 73.42, // D2
          pad: [146.83, 220.00, 261.63, 329.63, 440.00], // D3, A3, C4, E4, A4
          bells: [440.00, 523.25, 659.25, 587.33], // A4, C5, E5, D5 (Homecoming Leitmotif)
          arp: [293.66, 329.63, 440.00, 523.25, 587.33, 659.25, 587.33, 523.25] // D4, E4, A4, C5, D5, E5, D5, C5
        },
        {
          name: 'Bbmaj9',
          bass: 58.27, // Bb1
          pad: [116.54, 174.61, 220.00, 293.66, 349.23], // Bb2, F3, A3, D4, F4
          bells: [349.23, 440.00, 587.33, 523.25], // F4, A4, D5, C5
          arp: [233.08, 293.66, 349.23, 440.00, 523.25, 587.33, 523.25, 440.00]
        },
        {
          name: 'Fmaj9',
          bass: 43.65, // F1
          pad: [130.81, 196.00, 220.00, 329.63, 392.00], // C3, G3, A3, E4, G4
          bells: [392.00, 523.25, 659.25, 783.99], // G4, C5, E5, G5
          arp: [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 659.25, 523.25]
        },
        {
          name: 'C9sus4',
          bass: 65.41, // C2
          pad: [130.81, 196.00, 261.63, 293.66, 392.00], // C3, G3, C4, D4, G4
          bells: [293.66, 392.00, 523.25, 587.33], // D4, G4, C5, D5
          arp: [261.63, 293.66, 392.00, 523.25, 587.33, 659.25, 587.33, 392.00]
        }
      ];

      let chordIndex = 0;
      let isRunning = true;
      const activeVoiceNodes = [];
      const chordDuration = 6.8;

      const playChord = () => {
        if (!isRunning || !this.ctx || this.settings.muted) return;
        const now = this.ctx.currentTime;
        const cur = chords[chordIndex];
        chordIndex = (chordIndex + 1) % chords.length;

        // Clean up previously stopped nodes from active array
        activeVoiceNodes.length = 0;

        // 1. Warm Analog Dual-Oscillator Bass (Fundamental + 2nd Harmonic for laptop/mobile clarity)
        try {
          const bassOsc1 = this.ctx.createOscillator();
          const bassOsc2 = this.ctx.createOscillator();
          const bassGain = this.ctx.createGain();
          const bassFilter = this.ctx.createBiquadFilter();

          bassOsc1.type = 'sine';
          bassOsc1.frequency.setValueAtTime(cur.bass, now);

          bassOsc2.type = 'triangle';
          bassOsc2.frequency.setValueAtTime(cur.bass * 2.0, now);

          bassFilter.type = 'lowpass';
          bassFilter.frequency.setValueAtTime(220, now);

          // Prompt attack (0.2s) so music is heard right away, then steady warm sustain
          bassGain.gain.setValueAtTime(0.001, now);
          bassGain.gain.linearRampToValueAtTime(0.18, now + 0.22);
          bassGain.gain.exponentialRampToValueAtTime(0.001, now + chordDuration + 0.9);

          bassOsc1.connect(bassFilter);
          bassOsc2.connect(bassFilter);
          bassFilter.connect(bassGain);
          bassGain.connect(this.musicGain);

          bassOsc1.start(now);
          bassOsc2.start(now);
          bassOsc1.stop(now + chordDuration + 1.0);
          bassOsc2.stop(now + chordDuration + 1.0);
          activeVoiceNodes.push(bassOsc1, bassOsc2);
        } catch (_) { }

        // 2. Symphonic Celestial Space String/Synth Pads (Polyphonic with Chorus Detune)
        cur.pad.forEach((freq, idx) => {
          try {
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const filter = this.ctx.createBiquadFilter();

            osc1.type = idx % 2 === 0 ? 'triangle' : 'sine';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(freq, now);
            osc2.frequency.setValueAtTime(freq * 1.0028, now); // Warm chorusing

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(550, now);
            filter.frequency.linearRampToValueAtTime(950, now + 2.8);
            filter.frequency.linearRampToValueAtTime(500, now + chordDuration + 0.5);
            filter.Q.setValueAtTime(1.1, now);

            // Immediate 0.3s bloom to full rich volume
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.075, now + 0.32);
            gain.gain.exponentialRampToValueAtTime(0.001, now + chordDuration + 0.8);

            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(gain);
            gain.connect(this.musicGain);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + chordDuration + 1.0);
            osc2.stop(now + chordDuration + 1.0);
            activeVoiceNodes.push(osc1, osc2);
          } catch (_) { }
        });

        // 3. Shimmering Starlight Cosmic Arpeggio (Pulsing Space Motion)
        if (cur.arp && cur.arp.length) {
          const arpStep = chordDuration / cur.arp.length;
          cur.arp.forEach((arpFreq, aIdx) => {
            const arpTime = now + aIdx * arpStep;
            try {
              const aOsc = this.ctx.createOscillator();
              const aGain = this.ctx.createGain();
              const aFilter = this.ctx.createBiquadFilter();

              aOsc.type = 'sine';
              aOsc.frequency.setValueAtTime(arpFreq, arpTime);

              aFilter.type = 'bandpass';
              aFilter.frequency.setValueAtTime(arpFreq, arpTime);
              aFilter.Q.setValueAtTime(2.2, arpTime);

              aGain.gain.setValueAtTime(0.0001, arpTime);
              aGain.gain.linearRampToValueAtTime(0.042, arpTime + 0.02);
              aGain.gain.exponentialRampToValueAtTime(0.0001, arpTime + 0.55);

              aOsc.connect(aFilter);
              aFilter.connect(aGain);
              aGain.connect(this.musicGain);

              aOsc.start(arpTime);
              aOsc.stop(arpTime + 0.6);
              activeVoiceNodes.push(aOsc);
            } catch (_) { }
          });
        }

        // 4. Project Homecoming Leitmotif — Melodic Celestial Star Bells
        cur.bells.forEach((bellFreq, bIdx) => {
          const bellTime = now + 0.75 + bIdx * 1.35;
          try {
            const bOsc = this.ctx.createOscillator();
            const bHarmonic = this.ctx.createOscillator();
            const bGain = this.ctx.createGain();
            const bFilter = this.ctx.createBiquadFilter();

            bOsc.type = 'sine';
            bOsc.frequency.setValueAtTime(bellFreq, bellTime);
            bHarmonic.type = 'triangle';
            bHarmonic.frequency.setValueAtTime(bellFreq * 2.0, bellTime);

            bFilter.type = 'bandpass';
            bFilter.frequency.setValueAtTime(bellFreq * 1.5, bellTime);
            bFilter.Q.setValueAtTime(1.8, bellTime);

            bGain.gain.setValueAtTime(0.0001, bellTime);
            bGain.gain.linearRampToValueAtTime(0.085, bellTime + 0.025);
            bGain.gain.exponentialRampToValueAtTime(0.0001, bellTime + 2.2);

            bOsc.connect(bGain);
            bHarmonic.connect(bFilter);
            bFilter.connect(bGain);
            bGain.connect(this.musicGain);

            bOsc.start(bellTime);
            bHarmonic.start(bellTime);
            bOsc.stop(bellTime + 2.3);
            bHarmonic.stop(bellTime + 2.3);
            activeVoiceNodes.push(bOsc, bHarmonic);
          } catch (_) { }
        });

        this.musicTimer = setTimeout(playChord, (chordDuration - 0.2) * 1000);
      };

      playChord();
      this.musicNodes = {
        stop: () => {
          isRunning = false;
          clearTimeout(this.musicTimer);
          activeVoiceNodes.forEach(n => {
            try { n.stop(); } catch (_) { }
          });
          activeVoiceNodes.length = 0;
        }
      };

      dispatchAudioEvent('homecoming-audio-state', { playing: true });
    }

    stopMusic() {
      if (!this.musicNodes) return;
      try {
        this.musicNodes.stop();
        this.musicNodes = null;
      } catch (_) {
        this.musicNodes = null;
      }
      dispatchAudioEvent('homecoming-audio-state', { playing: false });
    }

    /* ─────────────────────────────────────────────────────────────────────
       SYNTHESIS HELPER UTILITIES
       ───────────────────────────────────────────────────────────────────── */
    synthTone(startFreq, endFreq, dur, type = 'sine', vol = 0.2, startTime = null) {
      if (!this.ctx) return;
      const t = startTime != null ? startTime : this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, t);
      if (endFreq !== startFreq) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      }

      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + dur);
    }

    synthArp(notes, noteDur, type = 'sine', vol = 0.2) {
      if (!this.ctx) return;
      let t = this.ctx.currentTime;
      notes.forEach((freq, i) => {
        this.synthTone(freq, freq, noteDur * 2.5, type, vol, t + i * noteDur);
      });
    }

    synthWhoosh(startFreq, endFreq, dur, vol = 0.25) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(startFreq, t);
      osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);

      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + dur);
    }

    synthThud(freq, dur, vol = 0.3) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(20, t + dur);

      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + dur);
    }

    synthBuzz(freq, dur, vol = 0.25) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.setValueAtTime(freq * 1.05, t + dur * 0.5);

      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + dur);
    }

    synthEmp() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      // High-power zap
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(2200, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.45);

      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.45);
    }

    synthRadioStatic(dur) {
      if (!this.ctx || !this.noiseBuffer) return;
      const t = this.ctx.currentTime;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, t);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);
      noise.start(t);
      noise.stop(t + dur);
    }

    synthRepairSequence() {
      this.synthRadioStatic(0.18);
      setTimeout(() => {
        this.synthTone(220, 880, 0.25, 'sine', 0.2);
        setTimeout(() => this.synthTone(880, 880, 0.15, 'sine', 0.22), 260);
      }, 190);
    }

    synthThruster(dur, isArrival = false) {
      if (!this.ctx || !this.noiseBuffer) return;
      const t = this.ctx.currentTime;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(isArrival ? 600 : 200, t);
      filter.frequency.linearRampToValueAtTime(isArrival ? 150 : 800, t + dur);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.35, t + dur * 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);
      noise.start(t);
      noise.stop(t + dur);
    }

    synthShipIgnition() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.synthTone(80, 360, 1.8, 'sawtooth', 0.22, t);
      this.synthRadioStatic(1.6);
      this.synthThud(50, 1.4, 0.4);
    }

    synthFlightThruster() {
      if (!this.ctx) return;
      this.synthTone(55, 65, 0.16, 'triangle', 0.12);
    }

    synthAsteroidNearMiss() {
      if (!this.ctx) return;
      this.synthWhoosh(920, 220, 0.45, 0.35);
    }

    synthAsteroidCollision() {
      if (!this.ctx) return;
      this.synthThud(45, 0.4, 0.6);
      this.synthTone(120, 45, 0.25, 'square', 0.3);
      this.synthRadioStatic(0.35);
    }

    synthJumpCharge() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.synthTone(120, 960, 1.6, 'sine', 0.26, t);
      this.synthTone(240, 1920, 1.6, 'triangle', 0.14, t);
    }

    synthHyperspaceJump() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.synthTone(160, 26, 1.8, 'sine', 0.65, t);
      this.synthRadioStatic(1.2);
      this.synthWhoosh(180, 1200, 0.6, 0.32);
    }

    synthWormholeVortex() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.synthTone(68, 120, 2.4, 'sine', 0.26, t);
      this.synthTone(136, 240, 2.4, 'triangle', 0.12, t);
    }

    synthWormholeEntry() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.synthArp([261.63, 392, 523.25, 783.99, 1046.5], 0.1, 'sine', 0.32);
      this.synthThud(32, 1.5, 0.7);
      this.synthRadioStatic(1.4);
    }

    synthTitleAmbience() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(55, t);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(180, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 2.0);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambienceGain);
      osc.start(t);

      this.ambienceNodes = { droneOsc: osc, droneGain: gain };
    }

    synthSpaceTravelAmbience() {
      if (!this.ctx || !this.noiseBuffer) return;
      const t = this.ctx.currentTime;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(320, t);
      filter.Q.setValueAtTime(2.2, t);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.24, t + 1.2);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambienceGain);
      noise.start(t);

      this.ambienceNodes = { droneGain: gain, windNodes: { noise, wGain: gain } };
    }

    /* ─────────────────────────────────────────────────────────────────────
       LIFECYCLE MANAGEMENT
       ───────────────────────────────────────────────────────────────────── */
    pause() {
      this.isPaused = true;
      if (this.ctx && this.masterGain) {
        this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      }
    }

    resume() {
      this.isPaused = false;
      if (this.ctx && this.masterGain) {
        const m = this.settings.muted ? 0 : this.settings.master;
        this.masterGain.gain.setTargetAtTime(m, this.ctx.currentTime, 0.08);
      }
    }

    stopAll() {
      this.stopRoverEngine();
      this.stopDrone();
      this.stopSuitBreathing();
      this.stopAmbience();
      this.stopMusic();
    }

    getAssetInventory() {
      return ASSET_CATALOG.map(item => ({
        id: item.id,
        category: item.category,
        path: item.path,
        description: item.desc,
        status: this.buffers.has(item.id) ? 'Loaded Audio File' : 'Active Procedural WebAudio Synthesis'
      }));
    }
  }

  // Export Singleton
  const instance = new AudioManager();
  if (typeof window !== 'undefined') {
    window.HomecomingAudio = instance;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = instance;
  }
})();

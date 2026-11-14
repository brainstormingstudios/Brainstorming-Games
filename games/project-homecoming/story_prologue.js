/* ─────────────────────────────────────────────────────────────────────────────
   PROJECT HOMECOMING — CINEMATIC STORY PROLOGUE
   Mars Approach, Atmospheric Entry Failure, Crash-Site Impact & ORA Awakening
   ───────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const PROLOGUE_PHASES = Object.freeze({
    IDLE: 'IDLE',
    APPROACH: 'APPROACH',           // 0.0s - 6.0s (Spacecraft approaching Mars from orbital void)
    ENTRY_FAILURE: 'ENTRY_FAILURE', // 6.0s - 12.0s (Atmospheric friction, alarm, engine failure, tumble)
    CRASH_IMPACT: 'CRASH_IMPACT',   // 12.0s - 15.0s (Surface impact, dust cloud, shockwave)
    BLACKOUT: 'BLACKOUT',           // 15.0s - 17.5s (Total blackout, damaged audio, life support boot)
    RECOVERY: 'RECOVERY',           // 17.5s - 29.5s (Visor blinking open, red strobe, ORA dialogue)
    WORLD_REVEAL: 'WORLD_REVEAL',   // 29.5s - 32.5s (Camera pull-back to 3rd-person, reveal crash site)
    COMPLETE: 'COMPLETE'
  });

  const SCRIPT_LINES = [
    {
      speaker: 'ORA',
      text: 'Commander… can you hear me?',
      chime: true,
      pauseAfter: 850
    },
    {
      speaker: 'ORA',
      text: 'You are alive. That is… a positive development.',
      chime: false,
      pauseAfter: 750
    },
    {
      speaker: 'ORA',
      text: 'Our spacecraft suffered a catastrophic failure during atmospheric entry. We have crashed on Mars.',
      chime: false,
      pauseAfter: 850
    },
    {
      speaker: 'ORA',
      text: 'Navigation is offline. Long-range communications are unavailable. Several critical systems have been damaged.',
      chime: false,
      pauseAfter: 950
    },
    {
      speaker: 'ORA',
      text: 'I cannot guarantee when rescue will arrive, Commander.',
      chime: false,
      cockpitFlicker: true,
      pauseAfter: 1100
    },
    {
      speaker: 'ORA',
      text: 'We need to restore power, assess the damage, and determine whether the spacecraft can fly again.',
      chime: false,
      pauseAfter: 850
    },
    {
      speaker: 'ORA',
      text: 'Please get up. I will guide you through the emergency checks.',
      chime: false,
      pauseAfter: 900
    }
  ];

  const PrologueState = {
    active: false,
    phase: PROLOGUE_PHASES.IDLE,
    elapsed: 0,
    shotTimer: 0,
    onComplete: null,
    currentLineIndex: -1,
    dialogueSeq: 0,
    dialogueStarted: false,
    dialogueTimer: null,
    worldRevealElapsed: 0,
    savedSceneState: null,
    shipMesh: null,
    marsGlobe: null,
    plasmaSheath: null,
    thrusterFlames: [],
    sparkParticles: null,
    dustShockwave: null,
    flameParticles: null,
    prologueGroup: null,
    originalCameraPos: null,
    originalCameraRot: null,
    shakeIntensity: 0
  };

  let dom = null;

  function getCore() {
    return (typeof window !== 'undefined' && window.ArcadeCore) ? window.ArcadeCore : null;
  }

  function getAudio() {
    return (typeof window !== 'undefined' && window.HomecomingAudio) ? window.HomecomingAudio : null;
  }

  function getHC() {
    return (typeof window !== 'undefined' && window.Homecoming) ? window.Homecoming.getHC() : null;
  }

  function getScene() {
    const core = getCore();
    if (core && core.scene) return core.scene;
    if (typeof window !== 'undefined' && window.scene) return window.scene;
    if (typeof global !== 'undefined' && global.scene) return global.scene;
    return null;
  }

  function getCam() {
    const core = getCore();
    if (core && core.cam) return core.cam;
    if (typeof window !== 'undefined' && window.cam) return window.cam;
    if (typeof global !== 'undefined' && global.cam) return global.cam;
    return null;
  }

  /* ─────────────────────────────────────────────────────────────────────
     DOM & UI OVERLAY MANAGEMENT
     ───────────────────────────────────────────────────────────────────── */
  function initDOM() {
    if (dom) return;
    let wrap = document.getElementById('hc-prologue-ui');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'hc-prologue-ui';
      wrap.className = 'hc-prologue-container hc-hidden';
      wrap.innerHTML = `
        <!-- Cinematic Letterbox Widescreen Bars -->
        <div id="hc-pro-bar-top" class="hc-pro-bar top"></div>
        <div id="hc-pro-bar-bottom" class="hc-pro-bar bottom"></div>

        <!-- Telemetry Header Overlay -->
        <div id="hc-pro-telemetry" class="hc-pro-telemetry">
          <div class="hc-pro-mission-tag">
            <span class="hc-pro-dot"></span>
            <span id="hc-pro-telemetry-tag">MISSION: ARES-7 // MARS SURVEY DIRECTIVE</span>
          </div>
          <div class="hc-pro-gauges">
            <span id="hc-pro-altitude" class="hc-pro-gauge">ALTITUDE: 180 KM</span>
            <span id="hc-pro-speed" class="hc-pro-gauge">VELOCITY: 11,200 KM/H</span>
            <span id="hc-pro-status" class="hc-pro-gauge status-ok">STATUS: ORBITAL TRAJECTORY</span>
          </div>
        </div>

        <!-- Skip Cinematic Button -->
        <button id="hc-pro-skip" class="hc-pro-skip-btn">
          <span>SKIP CINEMATIC</span>
          <kbd class="hc-pro-kbd">ESC</kbd>
        </button>

        <!-- Red Emergency Warning Flash -->
        <div id="hc-pro-alarm-flash" class="hc-pro-alarm-overlay"></div>

        <!-- Blackout Overlay -->
        <div id="hc-pro-blackout" class="hc-pro-blackout"></div>

        <!-- Grogginess / Blinking Eyelid Vignette -->
        <div id="hc-pro-eyelids" class="hc-pro-eyelids-wrap">
          <div id="hc-pro-eyelid-top" class="hc-pro-eyelid top"></div>
          <div id="hc-pro-eyelid-bottom" class="hc-pro-eyelid bottom"></div>
          <div id="hc-pro-visor-vignette" class="hc-pro-visor-hud">
            <div class="hc-pro-visor-grid"></div>
            <div id="hc-pro-boot-log" class="hc-pro-boot-log">
              <div>CRITICAL ENTRY FAILURE DETECTED</div>
              <div>LIFE SUPPORT: ACTIVE [HELMET SEAL: 100%]</div>
              <div>ORA A.I. RECOVERY: INITIALIZED</div>
            </div>
          </div>
        </div>

        <!-- ORA Subtitle & Dialogue Display -->
        <div id="hc-pro-subtitle-box" class="hc-pro-subtitle-card hc-hidden">
          <div class="hc-pro-subtitle-header">
            <div class="hc-pro-ai-pill">
              <span class="hc-pro-ai-icon">🤖</span>
              <span>ORA // EXPEDITION INTELLIGENCE</span>
            </div>
            <div class="hc-pro-audio-waves">
              <span></span><span></span><span></span><span></span>
            </div>
          </div>
          <div id="hc-pro-subtitle-text" class="hc-pro-subtitle-text"></div>
        </div>
      `;

      // Inject minimal, scoped, high-performance CSS
      const style = document.createElement('style');
      style.id = 'hc-prologue-styles';
      style.textContent = `
        .hc-prologue-container {
          position: fixed; inset: 0; pointer-events: none; z-index: 99990;
          font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
          overflow: hidden; user-select: none;
        }
        .hc-prologue-container.hc-hidden { display: none !important; }
        .hc-pro-bar {
          position: absolute; left: 0; right: 0; height: 11vh;
          background: #030406; z-index: 99995;
          box-shadow: 0 0 30px rgba(0,0,0,0.9);
          transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .hc-pro-bar.top { top: 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .hc-pro-bar.bottom { bottom: 0; border-top: 1px solid rgba(255,255,255,0.06); }
        .hc-pro-bar.retracted-top { transform: translateY(-100%); }
        .hc-pro-bar.retracted-bottom { transform: translateY(100%); }
        .hc-pro-telemetry {
          position: absolute; top: max(16px, 12vh); left: 24px; z-index: 99996;
          display: flex; flex-direction: column; gap: 6px; pointer-events: none;
        }
        .hc-pro-mission-tag {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 4px 10px; border-radius: 4px;
          background: rgba(8,12,16,0.75); border: 1px solid rgba(255,115,70,0.35);
          color: #ff8b55; font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .hc-pro-dot {
          width: 6px; height: 6px; border-radius: 50%; background: #ff7545;
          box-shadow: 0 0 8px #ff7545; animation: proPulse 1.2s infinite ease-in-out;
        }
        .hc-pro-gauges {
          display: flex; gap: 8px; font-size: 10px; font-weight: 600;
          color: #a4b3c4; letter-spacing: 0.08em;
        }
        .hc-pro-gauge {
          padding: 3px 8px; border-radius: 3px; background: rgba(5,8,12,0.65);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .hc-pro-gauge.status-ok { color: #7dff8a; border-color: rgba(125,255,138,0.25); }
        .hc-pro-gauge.status-warn { color: #ffca3a; border-color: rgba(255,202,58,0.4); animation: proPulse 0.5s infinite; }
        .hc-pro-gauge.status-crit { color: #ff4545; border-color: #ff4545; font-weight: 800; animation: proFlash 0.3s infinite; }
        .hc-pro-skip-btn {
          position: absolute; top: max(16px, env(safe-area-inset-top, 16px)); right: max(16px, env(safe-area-inset-right, 16px)); z-index: 99997;
          display: flex; align-items: center; gap: 8px; padding: 10px 18px;
          border-radius: 8px; background: rgba(12,18,24,0.88);
          border: 1.5px solid rgba(251,233,220,0.35); color: #e2ebf5;
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
          cursor: pointer; pointer-events: auto; touch-action: manipulation;
          transition: all 0.2s ease;
        }
        .hc-pro-skip-btn:hover {
          background: rgba(255,115,70,0.25); border-color: #ff8b55; color: #fff;
          box-shadow: 0 0 14px rgba(255,115,70,0.4);
        }
        .hc-pro-kbd {
          background: rgba(255,255,255,0.12); padding: 2px 6px; border-radius: 3px;
          font-family: inherit; font-size: 9px;
        }
        .hc-pro-alarm-overlay {
          position: absolute; inset: 0; pointer-events: none; z-index: 99992;
          background: radial-gradient(circle, transparent 40%, rgba(255,40,20,0.35) 90%);
          opacity: 0; transition: opacity 0.2s ease;
        }
        .hc-pro-blackout {
          position: absolute; inset: 0; background: #000; z-index: 99993;
          opacity: 0; pointer-events: none; transition: opacity 0.8s ease;
        }
        .hc-pro-eyelids-wrap {
          position: absolute; inset: 0; pointer-events: none; z-index: 99994;
          overflow: hidden; opacity: 0; transition: opacity 0.6s ease;
        }
        .hc-pro-eyelid {
          position: absolute; left: -10%; right: -10%; height: 55%;
          background: #020204; transition: transform 0.8s cubic-bezier(0.2, 0.9, 0.3, 1);
        }
        .hc-pro-eyelid.top { top: 0; border-radius: 0 0 50% 50%; transform: translateY(-100%); }
        .hc-pro-eyelid.bottom { bottom: 0; border-radius: 50% 50% 0 0; transform: translateY(100%); }
        .hc-pro-visor-hud {
          position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(circle at center, transparent 55%, rgba(10,25,35,0.65) 100%);
          border: 1px solid rgba(80,200,255,0.08);
        }
        .hc-pro-boot-log {
          position: absolute; top: 18%; left: 8%; color: rgba(120,225,255,0.85);
          font-family: monospace; font-size: 11px; line-height: 1.6;
          letter-spacing: 0.08em; text-shadow: 0 0 8px rgba(80,210,255,0.6);
        }
        .hc-pro-subtitle-card {
          position: absolute; bottom: max(24px, 12vh); left: 50%;
          transform: translateX(-50%); width: min(720px, calc(100vw - 32px));
          padding: 16px 22px; border-radius: 12px;
          background: rgba(8,12,18,0.92); backdrop-filter: blur(16px);
          border: 1px solid rgba(255,140,80,0.38);
          box-shadow: 0 12px 36px rgba(0,0,0,0.85), 0 0 24px rgba(255,90,40,0.18);
          z-index: 99998; pointer-events: auto;
          display: flex; flex-direction: column; gap: 8px;
          box-sizing: border-box; word-wrap: break-word; overflow-wrap: break-word;
          animation: proCardPop 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .hc-pro-subtitle-header {
          display: flex; justify-content: space-between; align-items: center;
        }
        .hc-pro-ai-pill {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px; font-weight: 800; letter-spacing: 0.12em;
          color: #ff9d66; text-transform: uppercase;
        }
        .hc-pro-audio-waves { display: flex; gap: 3px; align-items: center; height: 12px; }
        .hc-pro-audio-waves span {
          width: 2px; height: 100%; background: #ff9d66; border-radius: 1px;
          animation: proWave 0.6s infinite ease-in-out alternate;
        }
        .hc-pro-audio-waves span:nth-child(2) { animation-delay: 0.15s; }
        .hc-pro-audio-waves span:nth-child(3) { animation-delay: 0.3s; }
        .hc-pro-audio-waves span:nth-child(4) { animation-delay: 0.45s; }
        .hc-pro-subtitle-text {
          font-size: clamp(14px, 2.2vw, 16.5px); font-weight: 500; line-height: 1.55; color: #f5f8fc;
          letter-spacing: 0.02em; text-shadow: 0 1px 4px rgba(0,0,0,0.9);
          word-wrap: break-word; overflow-wrap: break-word;
        }
        @keyframes proPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
        @keyframes proFlash { 0%, 100% { opacity: 1; } 50% { opacity: 0.1; } }
        @keyframes proWave { 0% { height: 2px; } 100% { height: 12px; } }
        @keyframes proCardPop { 0% { opacity: 0; transform: translate(-50%, 10px); } 100% { opacity: 1; transform: translate(-50%, 0); } }
      `;
      document.head.appendChild(style);

      const uiRoot = document.getElementById('homecoming-ui') || document.body;
      uiRoot.appendChild(wrap);
    }

    dom = {
      wrap,
      barTop: wrap.querySelector('#hc-pro-bar-top'),
      barBottom: wrap.querySelector('#hc-pro-bar-bottom'),
      telemetry: wrap.querySelector('#hc-pro-telemetry'),
      altitude: wrap.querySelector('#hc-pro-altitude'),
      speed: wrap.querySelector('#hc-pro-speed'),
      status: wrap.querySelector('#hc-pro-status'),
      skipBtn: wrap.querySelector('#hc-pro-skip'),
      alarmFlash: wrap.querySelector('#hc-pro-alarm-flash'),
      blackout: wrap.querySelector('#hc-pro-blackout'),
      eyelidsWrap: wrap.querySelector('#hc-pro-eyelids'),
      eyelidTop: wrap.querySelector('#hc-pro-eyelid-top'),
      eyelidBottom: wrap.querySelector('#hc-pro-eyelid-bottom'),
      bootLog: wrap.querySelector('#hc-pro-boot-log'),
      subtitleBox: wrap.querySelector('#hc-pro-subtitle-box'),
      subtitleText: wrap.querySelector('#hc-pro-subtitle-text')
    };

    if (dom.skipBtn) {
      const handleSkip = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        skipPrologue();
      };
      dom.skipBtn.onclick = handleSkip;
      dom.skipBtn.ontouchstart = handleSkip;
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     3D SCENE CONSTRUCTION
     Reuses existing spacecraft assets, Mars globe, and cinematic effects
     ───────────────────────────────────────────────────────────────────── */
  function buildPrologueScene() {
    if (PrologueState.prologueGroup) return;

    const group = new THREE.Group();
    group.name = 'homecoming-prologue-scene';

    // 1. Mars Globe (Orbital view)
    const marsGeo = new THREE.SphereGeometry(95, 36, 24);
    // Warm Martian regolith material with bump detail
    const marsMat = new THREE.MeshStandardMaterial({
      color: 0xc85528,
      roughness: 0.88,
      metalness: 0.05
    });
    const marsMesh = new THREE.Mesh(marsGeo, marsMat);
    marsMesh.position.set(0, 0, -220);
    group.add(marsMesh);
    PrologueState.marsGlobe = marsMesh;

    // Martian Atmosphere Halo
    const atmGeo = new THREE.SphereGeometry(98.5, 32, 20);
    const atmMat = new THREE.MeshBasicMaterial({
      color: 0xff6a38,
      transparent: true,
      opacity: 0.28,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    const atmMesh = new THREE.Mesh(atmGeo, atmMat);
    marsMesh.add(atmMesh);

    // 2. Cosmic Starfield
    const starCount = 650;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 450;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 450;
      starPos[i * 3 + 2] = -100 - Math.random() * 300;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.4,
      transparent: true,
      opacity: 0.85
    });
    const starPoints = new THREE.Points(starGeo, starMat);
    group.add(starPoints);

    // 3. Cinematic Spacecraft
    let ship = null;
    if (window.Homecoming && typeof window.Homecoming.buildMainSpacecraft === 'function') {
      ship = window.Homecoming.buildMainSpacecraft('mars', false);
    } else {
      // Fallback robust representation
      ship = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.2, 8, 12), new THREE.MeshStandardMaterial({ color: 0x483f3b }));
      hull.rotation.z = Math.PI / 2;
      ship.add(hull);
    }
    ship.scale.setScalar(0.85);
    // Orient spacecraft so its nose points along -Z towards Mars, and engines point toward +Z
    ship.rotation.set(0.04, -Math.PI / 2, 0);
    ship.position.set(0, -4.5, -38);
    group.add(ship);
    PrologueState.shipMesh = ship;

    // 4. Glowing Twin Ion Thruster Plumes
    [-1.1, 1.1].forEach(zOff => {
      const plumeGeo = new THREE.ConeGeometry(0.55, 3.2, 10);
      const plumeMat = new THREE.MeshBasicMaterial({
        color: 0x3acaff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending
      });
      const plume = new THREE.Mesh(plumeGeo, plumeMat);
      plume.rotation.z = -Math.PI / 2;
      plume.position.set(6.2, 2.0, zOff);
      ship.add(plume);
      PrologueState.thrusterFlames.push(plume);
    });

    // 5. Plasma Entry Heat-Shield Sheath (activated during atmospheric entry)
    const plasmaGeo = new THREE.ConeGeometry(2.8, 5.0, 16, 1, true);
    const plasmaMat = new THREE.MeshBasicMaterial({
      color: 0xff6620,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const plasma = new THREE.Mesh(plasmaGeo, plasmaMat);
    plasma.rotation.z = Math.PI / 2;
    plasma.position.set(-5.6, 2.0, 0);
    ship.add(plasma);
    PrologueState.plasmaSheath = plasma;

    // 6. Entry Fire & Debris Particle Stream
    const partCount = 180;
    const partGeo = new THREE.BufferGeometry();
    const partPos = new Float32Array(partCount * 3);
    for (let i = 0; i < partCount; i++) {
      partPos[i * 3] = (Math.random() - 0.5) * 8;
      partPos[i * 3 + 1] = (Math.random() - 0.5) * 5;
      partPos[i * 3 + 2] = (Math.random() - 0.5) * 6;
    }
    partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
    const partMat = new THREE.PointsMaterial({
      color: 0xff8833,
      size: 1.8,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending
    });
    const flameParts = new THREE.Points(partGeo, partMat);
    ship.add(flameParts);
    PrologueState.flameParticles = flameParts;

    // 7. Ground Impact Shockwave Particles
    const dustCount = 220;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 2;
      dustPos[i * 3 + 1] = Math.random() * 1.5;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xb54d2b,
      size: 2.2,
      transparent: true,
      opacity: 0.0
    });
    const dust = new THREE.Points(dustGeo, dustMat);
    dust.position.set(-2, 0.5, -2);
    group.add(dust);
    PrologueState.dustShockwave = dust;

    // 8. Cinematic Directional Sunlight
    const dirLight = new THREE.DirectionalLight(0xffeedd, 1.4);
    dirLight.position.set(40, 60, 20);
    group.add(dirLight);

    const ambLight = new THREE.AmbientLight(0x221815, 0.6);
    group.add(ambLight);

    const scene = getScene();
    if (scene) scene.add(group);
    PrologueState.prologueGroup = group;
  }

  /* ─────────────────────────────────────────────────────────────────────
     CINEMATIC SEQUENCE LIFECYCLE
     ───────────────────────────────────────────────────────────────────── */
  function start(options = {}) {
    if (PrologueState.active) return;
    initDOM();

    PrologueState.active = true;
    PrologueState.elapsed = 0;
    PrologueState.phase = PROLOGUE_PHASES.APPROACH;
    PrologueState.onComplete = options.onComplete || null;
    PrologueState.currentLineIndex = -1;
    PrologueState.dialogueSeq = 0;
    PrologueState.dialogueStarted = false;
    PrologueState.worldRevealElapsed = 0;
    PrologueState.shakeIntensity = 0;

    if (PrologueState.dialogueTimer) {
      clearTimeout(PrologueState.dialogueTimer);
      PrologueState.dialogueTimer = null;
    }

    // Cache original scene camera
    const cam = getCam();
    if (cam) {
      PrologueState.originalCameraPos = cam.position.clone();
      PrologueState.originalCameraRot = cam.rotation.clone();
    }

    // Hide surface terrain during orbital approach
    const HC = getHC();
    if (HC) {
      HC.state = 'PROLOGUE';
      if (HC.world) HC.world.visible = false;
    }

    buildPrologueScene();

    // Reset DOM states
    if (dom.wrap) dom.wrap.classList.remove('hc-hidden');
    if (dom.barTop) dom.barTop.classList.remove('retracted-top');
    if (dom.barBottom) dom.barBottom.classList.remove('retracted-bottom');
    if (dom.blackout) dom.blackout.style.opacity = '0';
    if (dom.eyelidsWrap) dom.eyelidsWrap.style.opacity = '0';
    if (dom.alarmFlash) dom.alarmFlash.style.opacity = '0';
    if (dom.subtitleBox) dom.subtitleBox.classList.add('hc-hidden');
    if (dom.status) {
      dom.status.className = 'hc-pro-gauge status-ok';
      dom.status.textContent = 'STATUS: ORBITAL TRAJECTORY';
    }

    // Initial audio cues
    const audio = getAudio();
    if (audio) {
      audio.startMusic();
      audio.play('departure', { volume: 0.65 });
    }

    console.log('[HomecomingPrologue] Started cinematic story prologue');
  }

  function startDialogueSequence() {
    if (PrologueState.dialogueStarted || !PrologueState.active) return;
    PrologueState.dialogueStarted = true;
    playDialogueStep(0);
  }

  function playDialogueStep(lineIndex) {
    if (!PrologueState.active) return;
    if (lineIndex >= SCRIPT_LINES.length) {
      transitionToWorldReveal();
      return;
    }

    PrologueState.currentLineIndex = lineIndex;
    const line = SCRIPT_LINES[lineIndex];
    const seq = ++PrologueState.dialogueSeq;

    if (dom.subtitleBox && dom.subtitleText) {
      dom.subtitleBox.classList.remove('hc-hidden');
      dom.subtitleText.textContent = `"${line.text}"`;
    }

    const audio = getAudio();
    if (audio && line.chime && typeof audio.play === 'function') {
      audio.play('ora_chime');
    }

    if (line.cockpitFlicker && dom.alarmFlash) {
      dom.alarmFlash.style.opacity = '0.55';
      setTimeout(() => {
        if (dom.alarmFlash) dom.alarmFlash.style.opacity = '0.12';
      }, 350);
    }

    let lineCompleted = false;
    const onLineFinished = () => {
      if (lineCompleted || seq !== PrologueState.dialogueSeq || !PrologueState.active) return;
      lineCompleted = true;

      if (PrologueState.dialogueTimer) {
        clearTimeout(PrologueState.dialogueTimer);
        PrologueState.dialogueTimer = null;
      }

      // Natural pause before advancing to next line
      const pauseDuration = line.pauseAfter || 750;
      PrologueState.dialogueTimer = setTimeout(() => {
        if (seq !== PrologueState.dialogueSeq || !PrologueState.active) return;
        playDialogueStep(lineIndex + 1);
      }, pauseDuration);
    };

    if (audio && typeof audio.speak === 'function') {
      audio.speak(line.text, 'ora', {
        onend: () => onLineFinished()
      });
    } else {
      const estimatedMs = Math.max(2800, Math.min(8500, line.text.length * 68));
      PrologueState.dialogueTimer = setTimeout(onLineFinished, estimatedMs);
    }
  }

  function transitionToWorldReveal() {
    if (PrologueState.phase === PROLOGUE_PHASES.WORLD_REVEAL || !PrologueState.active) return;
    PrologueState.phase = PROLOGUE_PHASES.WORLD_REVEAL;
    PrologueState.worldRevealElapsed = 0;
  }

  function update(dt, now) {
    if (!PrologueState.active) return;
    PrologueState.elapsed += dt;
    const t = PrologueState.elapsed;
    const ship = PrologueState.shipMesh;
    const cam = getCam();

    // ─────────────────────────────────────────────────────────────────
    // SCENE 1: APPROACHING MARS (0.0s - 7.0s)
    // ─────────────────────────────────────────────────────────────────
    if (t < 7.0) {
      PrologueState.phase = PROLOGUE_PHASES.APPROACH;

      // Spacecraft flight along -Z toward Mars
      if (ship) {
        ship.rotation.set(0.04, -Math.PI / 2, Math.sin(t * 1.4) * 0.035);
        ship.position.set(
          Math.sin(t * 0.8) * 1.2,
          -4.5 + (t / 7.0) * 1.5,
          -38.0 - (t / 7.0) * 45.0
        );
      }

      // Shot 1: Establishing View (0.0s - 2.5s)
      if (t < 2.5) {
        const p1 = t / 2.5;
        if (cam) {
          // Wide three-quarter side shot establishing Mars and approaching spacecraft
          cam.position.set(16.0 - p1 * 3.0, 4.0 - p1 * 0.8, -22.0 - p1 * 12.0);
          cam.lookAt(0, -4.0, -85.0);
          cam.fov = 50;
          cam.updateProjectionMatrix();
        }
      }
      // Shot 2: Rear Three-Quarter Tracking Shot (2.5s - 7.0s)
      else {
        const p2 = (t - 2.5) / 4.5;
        if (cam && ship) {
          // Blend smoothly from wide establishing into close rear three-quarter tracking
          const blendFactor = Math.min(1.0, (t - 2.5) / 1.5);
          const easeBlend = blendFactor * blendFactor * (3 - 2 * blendFactor);

          const rearOffset = new THREE.Vector3(3.8, 2.2, 11.2);
          const rearCamPos = new THREE.Vector3(
            ship.position.x + rearOffset.x,
            ship.position.y + rearOffset.y,
            ship.position.z + rearOffset.z
          );

          const estTransitionPos = new THREE.Vector3(13.0 - p2 * 4.0, 3.2, -34.0 - p2 * 35.0);
          cam.position.set(
            estTransitionPos.x + (rearCamPos.x - estTransitionPos.x) * easeBlend,
            estTransitionPos.y + (rearCamPos.y - estTransitionPos.y) * easeBlend,
            estTransitionPos.z + (rearCamPos.z - estTransitionPos.z) * easeBlend
          );

          // Centerline look-through past cockpit toward Mars
          cam.lookAt(ship.position.x - 0.4, ship.position.y + 0.6, ship.position.z - 45.0);
          cam.fov = 48;
          cam.updateProjectionMatrix();
        }
      }

      // Thrusters pulse
      PrologueState.thrusterFlames.forEach((flame, idx) => {
        flame.scale.set(1, 1 + Math.sin(t * 14 + idx) * 0.18, 1);
      });

      // Telemetry update
      if (dom.altitude) dom.altitude.textContent = `ALTITUDE: ${(180 - (t / 7.0) * 60).toFixed(0)} KM`;
      if (dom.speed) dom.speed.textContent = `VELOCITY: ${(11200 + (t / 7.0) * 1200).toFixed(0)} KM/H`;
    }

    // ─────────────────────────────────────────────────────────────────
    // SCENE 2: ATMOSPHERIC ENTRY & LOSS OF CONTROL (7.0s - 12.0s)
    // ─────────────────────────────────────────────────────────────────
    else if (t >= 7.0 && t < 12.0) {
      PrologueState.phase = PROLOGUE_PHASES.ENTRY_FAILURE;
      const p = (t - 7.0) / 5.0;

      // Shot 3: Atmospheric entry rear tracking shot closing in
      if (ship) {
        ship.position.z -= dt * (22.0 + p * 15.0);
      }

      // Plasma heat-shield glow intensity increases
      if (PrologueState.plasmaSheath) {
        PrologueState.plasmaSheath.material.opacity = Math.min(0.88, p * 1.5);
      }
      if (PrologueState.flameParticles) {
        PrologueState.flameParticles.material.opacity = Math.min(0.92, p * 1.8);
      }

      // At 8.5s: CATASTROPHIC VECTOR FAILURE
      if (t >= 8.5) {
        PrologueState.shakeIntensity = Math.min(0.75, (t - 8.5) * 0.24);
        if (dom.status) {
          dom.status.className = 'hc-pro-gauge status-crit';
          dom.status.textContent = 'CRITICAL: VECTOR LOSS / DESCENT UNSTABLE';
        }
        if (dom.alarmFlash) {
          dom.alarmFlash.style.opacity = (Math.sin(t * 16) > 0) ? '0.65' : '0.1';
        }

        // Tumble dynamics
        if (ship) {
          ship.rotation.x += dt * 1.6;
          ship.rotation.z += dt * 3.0;
          ship.rotation.y -= dt * 0.8;
          ship.position.y -= dt * 22.0;
        }

        // Left engine flames out
        if (PrologueState.thrusterFlames[0]) {
          PrologueState.thrusterFlames[0].scale.set(0.08, 0.08, 0.08);
        }

        // Right engine sputters
        if (PrologueState.thrusterFlames[1]) {
          const sputter = Math.random() > 0.4 ? 1.2 : 0.2;
          PrologueState.thrusterFlames[1].scale.set(sputter, sputter, sputter);
        }

        // Audio alarm cue
        const audio = getAudio();
        if (audio && Math.abs(t - 8.6) < 0.08) {
          audio.play('drone_alert');
          audio.play('laser_impact');
        }
      } else {
        if (ship) {
          ship.rotation.set(0.04, -Math.PI / 2, Math.sin(t * 1.8) * 0.05);
          ship.position.y -= dt * 4.0;
        }
      }

      // Camera tracks tighter with turbulence vibration
      if (cam && ship) {
        const shakeX = (Math.random() - 0.5) * PrologueState.shakeIntensity;
        const shakeY = (Math.random() - 0.5) * PrologueState.shakeIntensity;
        cam.position.set(
          ship.position.x + 2.8 + shakeX,
          ship.position.y + 1.8 + shakeY,
          ship.position.z + 8.2
        );
        cam.lookAt(ship.position.x - 0.2, ship.position.y + 0.4, ship.position.z - 35.0);
        cam.fov = 44;
        cam.updateProjectionMatrix();
      }

      // Telemetry update
      if (dom.altitude) dom.altitude.textContent = `ALTITUDE: ${Math.max(1.8, (120 - p * 118)).toFixed(1)} KM`;
      if (dom.speed) dom.speed.textContent = `VELOCITY: ${(12400 - p * 4200).toFixed(0)} KM/H`;
    }

    // ─────────────────────────────────────────────────────────────────
    // SCENE 3: CRASH IMPACT & FLASH (12.0s - 15.0s)
    // ─────────────────────────────────────────────────────────────────
    else if (t >= 12.0 && t < 15.0) {
      PrologueState.phase = PROLOGUE_PHASES.CRASH_IMPACT;
      const p = (t - 12.0) / 3.0;

      // Trigger impact sound and flash on first frame of impact
      if (Math.abs(t - 12.05) < 0.08) {
        const audio = getAudio();
        if (audio) {
          audio.play('asteroid_collision', { volume: 1.0 });
          audio.play('arrival', { volume: 0.8 });
        }
        if (dom.blackout) dom.blackout.style.opacity = '1';
      }

      // Shockwave dust explosion expands
      if (PrologueState.dustShockwave) {
        PrologueState.dustShockwave.material.opacity = Math.max(0, 1.0 - p * 1.5);
        PrologueState.dustShockwave.scale.setScalar(1 + p * 8.0);
      }

      if (dom.status) {
        dom.status.className = 'hc-pro-gauge status-crit';
        dom.status.textContent = 'HULL IMPACT DETECTED';
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // SCENE 4: BLACKOUT & VISOR RECOVERY (15.0s+)
    // ─────────────────────────────────────────────────────────────────
    else if (t >= 15.0 && PrologueState.phase !== PROLOGUE_PHASES.WORLD_REVEAL && PrologueState.phase !== PROLOGUE_PHASES.COMPLETE) {
      PrologueState.phase = PROLOGUE_PHASES.RECOVERY;

      // Hide orbital prologue 3D meshes and prepare actual Mars world underneath
      if (PrologueState.prologueGroup && PrologueState.prologueGroup.visible) {
        PrologueState.prologueGroup.visible = false;
        const HC = getHC();
        if (HC && HC.world) {
          HC.world.visible = true;
          // Position astronaut at crash site spawn
          if (HC.astronaut && HC.astronaut.group) {
            HC.astronaut.group.position.set(3, 0, -7);
            HC.astronaut.group.visible = true;
          }
        }
      }

      // Groggy eyelid blinking opens gradually
      if (dom.eyelidsWrap) dom.eyelidsWrap.style.opacity = '1';
      if (dom.blackout) dom.blackout.style.opacity = '0.35';

      // Eyelid blink cycles: 17s-19s blink 1, 20s-22s blink 2, 23s+ open
      let blinkAmount = 0.85;
      if (t >= 16.5 && t < 18.5) {
        blinkAmount = 0.5 + Math.sin((t - 16.5) * Math.PI) * 0.45;
      } else if (t >= 19.5 && t < 22.0) {
        blinkAmount = 0.35 + Math.sin((t - 19.5) * Math.PI * 0.7) * 0.45;
      } else if (t >= 23.0) {
        blinkAmount = Math.max(0.1, 0.35 - (t - 23.0) * 0.05);
      }

      if (dom.eyelidTop) dom.eyelidTop.style.transform = `translateY(-${(1 - blinkAmount) * 100}%)`;
      if (dom.eyelidBottom) dom.eyelidBottom.style.transform = `translateY(${(1 - blinkAmount) * 100}%)`;

      // Position camera in cockpit / first-person visor view looking at crashed ship
      if (cam) {
        cam.position.set(3.0, 1.45 + Math.sin(t * 1.5) * 0.04, -7.0);
        cam.lookAt(-2.0, 1.8, -2.0); // Facing crashed spaceship hull
      }

      // Start sequenced dialogue queue if not yet started
      if (t >= 16.5 && !PrologueState.dialogueStarted) {
        startDialogueSequence();
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // SCENE 5: REVEAL ACTUAL WORLD & HANDOFF (3.0s duration)
    // ─────────────────────────────────────────────────────────────────
    else if (PrologueState.phase === PROLOGUE_PHASES.WORLD_REVEAL) {
      PrologueState.worldRevealElapsed = (PrologueState.worldRevealElapsed || 0) + dt;
      const p = Math.min(1.0, PrologueState.worldRevealElapsed / 3.0);

      // Smoothly retract eyelids & letterbox bars
      if (dom.eyelidTop) dom.eyelidTop.style.transform = 'translateY(-100%)';
      if (dom.eyelidBottom) dom.eyelidBottom.style.transform = 'translateY(100%)';
      if (dom.eyelidsWrap) dom.eyelidsWrap.style.opacity = String(1.0 - p);
      if (dom.blackout) dom.blackout.style.opacity = '0';
      if (dom.barTop) dom.barTop.classList.add('retracted-top');
      if (dom.barBottom) dom.barBottom.classList.add('retracted-bottom');

      // Camera pulls back smoothly from visor into 3rd-person gameplay camera
      if (cam) {
        const startX = 3.0, startY = 1.45, startZ = -7.0;
        const endX = 3.0, endY = 3.6, endZ = -12.5; // Behind astronaut at (3, -7)
        cam.position.set(
          startX + (endX - startX) * p,
          startY + (endY - startY) * p,
          startZ + (endZ - startZ) * p
        );
        cam.lookAt(0, 1.6, -4.5);
      }

      if (p >= 1.0) {
        completePrologue();
      }
    }
  }

  function completePrologue() {
    if (!PrologueState.active) return;
    console.log('[HomecomingPrologue] Cinematic story prologue complete, transitioning to exploration');
    cleanup();
    if (typeof PrologueState.onComplete === 'function') {
      PrologueState.onComplete();
    }
  }

  function skipPrologue() {
    if (!PrologueState.active) return;
    console.log('[HomecomingPrologue] Cinematic skipped by user');
    completePrologue();
  }

  function cleanup() {
    PrologueState.active = false;
    PrologueState.phase = PROLOGUE_PHASES.IDLE;
    PrologueState.dialogueStarted = false;

    if (PrologueState.dialogueTimer) {
      clearTimeout(PrologueState.dialogueTimer);
      PrologueState.dialogueTimer = null;
    }
    PrologueState.dialogueSeq++;

    // Stop speech synthesis
    const audio = getAudio();
    if (audio && typeof audio.stopSpeech === 'function') {
      audio.stopSpeech();
    }

    // Remove 3D prologue group
    const scene = getScene();
    if (PrologueState.prologueGroup && scene) {
      scene.remove(PrologueState.prologueGroup);
      PrologueState.prologueGroup = null;
      PrologueState.shipMesh = null;
      PrologueState.marsGlobe = null;
      PrologueState.plasmaSheath = null;
      PrologueState.thrusterFlames = [];
      PrologueState.flameParticles = null;
      PrologueState.dustShockwave = null;
    }

    // Hide DOM overlay
    if (dom && dom.wrap) {
      dom.wrap.classList.add('hc-hidden');
      if (dom.subtitleBox) dom.subtitleBox.classList.add('hc-hidden');
      if (dom.blackout) dom.blackout.style.opacity = '0';
      if (dom.alarmFlash) dom.alarmFlash.style.opacity = '0';
      if (dom.eyelidsWrap) dom.eyelidsWrap.style.opacity = '0';
    }

    // Restore Mars world visibility and astronaut position
    const HC = getHC();
    if (HC) {
      if (HC.world) HC.world.visible = true;
      if (HC.astronaut && HC.astronaut.group) {
        HC.astronaut.group.position.set(3, 0, -7);
        HC.astronaut.group.visible = true;
      }
    }
  }

  function onKey(e, down) {
    if (!PrologueState.active || !down) return;
    if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') {
      skipPrologue();
    }
  }

  // Register on window namespace
  window.HomecomingPrologue = {
    start: (options) => start(options),
    skip: () => skipPrologue(),
    update: (dt, now) => update(dt, now),
    cleanup: () => cleanup(),
    onKey: (e, down) => onKey(e, down),
    isActive: () => PrologueState.active,
    getPhase: () => PrologueState.phase,
    getElapsed: () => PrologueState.elapsed,
    getLines: () => SCRIPT_LINES,
    phases: PROLOGUE_PHASES
  };

  console.log('[HomecomingPrologue] Module initialized successfully');
})();

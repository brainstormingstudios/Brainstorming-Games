/* Project Homecoming — gameplay module. It intentionally shares Mars Arcade's
   original Three.js renderer, scene and animation loop instead of replacing it. */
(function () {
  'use strict';

  const SAVE_KEY = 'project-homecoming-save-v1';
  const SAVE_VERSION = 3;
  const STATES = Object.freeze({ TITLE: 'TITLE', INTRO: 'INTRO', HUB: 'HUB', EXPLORATION: 'EXPLORATION', PUZZLE: 'PUZZLE', PAUSED: 'PAUSED', TRAVEL: 'TRAVEL', CHAPTER_COMPLETE: 'CHAPTER_COMPLETE', ENDING: 'ENDING', DIALOGUE: 'DIALOGUE', COMMS: 'COMMS', EXPLORERS: 'EXPLORERS', DEPARTURE: 'DEPARTURE', PROLOGUE: 'PROLOGUE' });
  const HC = { state: STATES.TITLE, active: false, world: null, hub: null, travel: null, last: performance.now(), keys: new Set(), mouse: { yaw: 0, pitch: -.22, distance: 9 }, save: null, puzzle: null, planetAssets: {}, jumpVelocity: 0, isJumping: false, groundY: 0 };
  const V = THREE.Vector3, C = THREE.Color;
  const ui = {};

  /* ─────────────────────────────────────────────────────────────────────
     PLANETS — now includes Ceres (6 total campaign locations)
     ───────────────────────────────────────────────────────────────────── */
  const PLANETS = [
    { id: 'mars', name: 'Mars', subtitle: 'The Red Silence', chapter: 'Chapter 1', description: 'Recover the damaged expedition and follow the impossible signal.', sky: 0x160907, fog: 0x2a1008, atmosphere: 0xff6b38, palette: [0x542316, 0xa44c29, 0xd27b45, 0x351916], rock: 0x71331f, landmark: 'CRASH SITE', launch: [-2, -2], gravity: 3.7 },
    { id: 'phobos', name: 'Phobos Station', subtitle: 'Orbital Salvage', chapter: 'Chapter 2', description: 'Wake a dead dock and restore a drifting relay above Mars.', sky: 0x07090e, fog: 0x111720, atmosphere: 0xaac3d8, palette: [0x24272d, 0x616975, 0x9aa1a6, 0x15181d], rock: 0x39404a, landmark: 'DEAD DOCK', launch: [-34, -30], gravity: 0.006 },
    { id: 'europa', name: 'Europa', subtitle: 'White Silence', chapter: 'Chapter 3', description: 'Survey the ice shell and recover a signal from beneath the frozen crust.', sky: 0x07101a, fog: 0x142333, atmosphere: 0x9eeeff, palette: [0x31536c, 0x86b8d0, 0xd6f2f4, 0x18364f], rock: 0x618da4, landmark: 'ICE RESEARCH BASE', launch: [-34, -30], gravity: 1.315 },
    { id: 'titan', name: 'Titan', subtitle: 'Amber Skies', chapter: 'Chapter 4', description: 'Restore the methane fuel network hidden beneath Titan\'s haze.', sky: 0x211005, fog: 0x5b3511, atmosphere: 0xffb14f, palette: [0x5f3512, 0xa36624, 0xd89a47, 0x32200f], rock: 0x74421b, landmark: 'FUEL REFINERY', launch: [-34, -30], gravity: 1.352 },
    { id: 'ceres', name: 'Ceres', subtitle: 'Graveyard of Stars', chapter: 'Chapter 5', description: 'Search the graveyard of abandoned spacecraft and recover the black box.', sky: 0x050508, fog: 0x0e0e14, atmosphere: 0x8899bb, palette: [0x1f2028, 0x4a4d5c, 0x7b7f92, 0x131419], rock: 0x33354a, landmark: 'WRECK FIELD', launch: [-34, -30], gravity: 0.28 },
    { id: 'earth', name: 'Earth', subtitle: 'Homeward', chapter: 'Chapter 6', description: 'Guide the expedition home and complete the final landing sequence.', sky: 0x031221, fog: 0x0a2943, atmosphere: 0x75cfff, palette: [0x183b42, 0x36796a, 0x82b373, 0x152e31], rock: 0x326b58, landmark: 'LANDING ZONE', launch: [-34, -30], gravity: 9.8 }
  ];

  /* ─────────────────────────────────────────────────────────────────────
     PLANET-SPECIFIC PHYSICS CONFIGURATION (Task 4)
     Centralized physical properties and gameplay mechanics across the solar system.
     ───────────────────────────────────────────────────────────────────── */
  const PLANET_PHYSICS = {
    mars: {
      gravity: 8.5,           // ~0.38g scaled downward accel (m/s^2)
      jumpVelocity: 5.6,      // Initial vertical leap velocity (m/s)
      maxJumpHeight: 1.84,    // Mathematically derived: (v0^2)/(2*g) = (5.6^2)/(2*8.5) = 1.84 m
      airControl: 0.85,       // High responsive directional air control
      terminalVelocity: 18.0, // Maximum falling velocity (m/s)
      traction: 1.0,          // Firm basalt regolith grip
      speedMult: 1.0,
      description: 'Mars: 38% Earth gravity. Extended bounding leaps across dusty plains.'
    },
    phobos: {
      gravity: 3.2,           // Asteroid microgravity (scaled for playability)
      jumpVelocity: 4.2,      // Gentle leap impulse
      maxJumpHeight: 2.76,    // Derived: (4.2^2)/(2*3.2) = 17.64/6.4 = 2.76 m
      airControl: 0.95,       // Micro-thruster stabilized air control
      terminalVelocity: 6.0,  // Slow floating descent in vacuum
      traction: 0.85,
      speedMult: 0.95,
      description: 'Phobos: Orbital microgravity with gentle, lofty arcs.'
    },
    europa: {
      gravity: 5.0,           // ~0.13g Jovian ice gravity
      jumpVelocity: 5.0,      // Lofty leap
      maxJumpHeight: 2.50,    // Derived: (5.0^2)/(2*5.0) = 25.0/10.0 = 2.50 m
      airControl: 0.70,       // Vacuum air control
      terminalVelocity: 14.0,
      traction: 0.38,         // Low-friction icy surface: momentum drifts subtly on turning!
      speedMult: 1.05,
      description: 'Europa: Low Jovian gravity with low-friction cryo-ice traction.'
    },
    titan: {
      gravity: 5.2,           // Low gravity + dense atmosphere
      jumpVelocity: 5.4,
      maxJumpHeight: 2.80,    // Derived: (5.4^2)/(2*5.2) = 29.16/10.4 = 2.80 m
      airControl: 0.92,       // Thick atmosphere allows aerodynamic glide
      terminalVelocity: 6.5,  // Heavy nitrogen/methane drag limits fall speed!
      traction: 0.90,
      speedMult: 0.98,
      description: 'Titan: Low gravity with atmospheric buoyancy and gentle terminal descent.'
    },
    ceres: {
      gravity: 4.0,           // Asteroid belt regolith (~0.03g approx)
      jumpVelocity: 4.6,
      maxJumpHeight: 2.64,    // Derived: (4.6^2)/(2*4.0) = 21.16/8.0 = 2.64 m
      airControl: 0.90,       // Suit RCS attitude thrusters
      terminalVelocity: 7.5,
      traction: 0.80,
      speedMult: 0.95,
      description: 'Ceres: Asteroid microgravity. Lofty leaps stabilized by suit RCS.'
    },
    earth: {
      gravity: 18.0,          // Standard 1.0g terrestrial gravity scale
      jumpVelocity: 6.5,      // Snappy athletic leap
      maxJumpHeight: 1.17,    // Derived: (6.5^2)/(2*18.0) = 42.25/36.0 = 1.17 m
      airControl: 0.50,       // Grounded, realistic physics
      terminalVelocity: 24.0,
      traction: 1.0,          // Full terrestrial grip
      speedMult: 1.0,
      description: 'Earth: Standard 1.0g gravity. Athletic jumps and firm traction.'
    }
  };

  function getActivePhysics() {
    const cp = currentPlanet();
    const pid = cp ? cp.id : 'mars';
    return PLANET_PHYSICS[pid] || PLANET_PHYSICS.mars;
  }

  /* ─────────────────────────────────────────────────────────────────────
     BRAINSTORMING SDK INTEGRATION HELPERS (Task 2)
     ───────────────────────────────────────────────────────────────────── */
  function sdkGameplayStart() {
    if (window.BGAdapter) window.BGAdapter.gameplayStart();
  }
  function sdkGameplayStop() {
    if (window.BGAdapter) window.BGAdapter.gameplayStop();
  }
  function sdkLoadingStart() {
    if (window.BGAdapter) window.BGAdapter.loadingStart();
  }
  function sdkLoadingStop() {
    if (window.BGAdapter) window.BGAdapter.loadingStop();
  }

  /* ─────────────────────────────────────────────────────────────────────
     GRAPHICS PRESETS & QUALITY SETTINGS (Task 7)
     ───────────────────────────────────────────────────────────────────── */
  const GRAPHICS_SETTINGS_KEY = 'project-homecoming-graphics-v1';
  const GRAPHICS_PRESETS = {
    low: {
      name: 'Low',
      dpr: 0.85,
      maxDpr: 1.0,
      antialias: false,
      particles: 150,
      shadows: false,
      groundDetail: false,
      description: 'Maximum performance. Optimized for low-end mobile devices.'
    },
    medium: {
      name: 'Medium',
      dpr: 1.0,
      maxDpr: 1.0,
      antialias: true,
      particles: 400,
      shadows: false,
      groundDetail: true,
      description: 'Balanced performance and visual fidelity for standard mobile/laptops.'
    },
    high: {
      name: 'High',
      dpr: 1.5,
      maxDpr: 1.5,
      antialias: true,
      particles: 800,
      shadows: true,
      groundDetail: true,
      description: 'High fidelity with soft shadows, atmospheric glow, and rich particles.'
    },
    ultra: {
      name: 'Ultra',
      dpr: 2.0,
      maxDpr: 2.0,
      antialias: true,
      particles: 1400,
      shadows: true,
      groundDetail: true,
      description: 'Maximum visual excellence with native high-DPI and full atmospheric effects.'
    }
  };

  let currentGraphicsConfig = {
    preset: 'high',
    dataSaver: false
  };

  function loadGraphicsSettings() {
    try {
      let raw = null;
      if (window.BGAdapter && typeof window.BGAdapter.getItem === 'function') {
        raw = window.BGAdapter.getItem(GRAPHICS_SETTINGS_KEY);
      }
      if (!raw) raw = localStorage.getItem(GRAPHICS_SETTINGS_KEY);
      const saved = JSON.parse(raw);
      if (saved && GRAPHICS_PRESETS[saved.preset]) {
        currentGraphicsConfig.preset = saved.preset;
        currentGraphicsConfig.dataSaver = !!saved.dataSaver;
      } else {
        // High-performance mobile default: medium preset ensures stable 60 FPS on handheld devices
        if (detectCoarsePointer()) {
          currentGraphicsConfig.preset = 'medium';
        }
      }
    } catch (_) { }
  }

  function saveGraphicsSettings() {
    try {
      const val = JSON.stringify(currentGraphicsConfig);
      if (window.BGAdapter && typeof window.BGAdapter.setItem === 'function') {
        window.BGAdapter.setItem(GRAPHICS_SETTINGS_KEY, val);
      } else {
        localStorage.setItem(GRAPHICS_SETTINGS_KEY, val);
      }
    } catch (_) { }
  }

  function getRenderer() {
    try { if (typeof renderer !== 'undefined') return renderer; } catch (_) { }
    return (typeof window !== 'undefined' && window.ArcadeCore) ? window.ArcadeCore.renderer : null;
  }

  function applyGraphicsSettings(presetName, dataSaver) {
    if (presetName && GRAPHICS_PRESETS[presetName]) currentGraphicsConfig.preset = presetName;
    if (dataSaver !== undefined) currentGraphicsConfig.dataSaver = !!dataSaver;
    saveGraphicsSettings();

    const isMobile = detectCoarsePointer();
    const p = GRAPHICS_PRESETS[currentGraphicsConfig.preset];
    const ren = getRenderer();
    if (ren) {
      // Mobile fillrate optimization: cap max DPR to 1.15 on mobile
      const maxMobileDpr = 1.15;
      const targetMaxDpr = isMobile ? Math.min(p.maxDpr, maxMobileDpr) : p.maxDpr;
      const dpr = currentGraphicsConfig.dataSaver ? 0.85 : Math.min(window.devicePixelRatio || 1, targetMaxDpr);
      ren.setPixelRatio(dpr);
      ren.setSize(window.innerWidth, window.innerHeight);

      // Mobile GPU optimization: bypass dynamic PCF shadow mapping on mobile unless user explicitly selects ultra
      const enableShadow = !currentGraphicsConfig.dataSaver && !!p.shadows && (!isMobile || currentGraphicsConfig.preset === 'ultra');
      if (ren.shadowMap) {
        ren.shadowMap.enabled = enableShadow;
        ren.shadowMap.type = (currentGraphicsConfig.preset === 'ultra' || currentGraphicsConfig.preset === 'high') ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        ren.shadowMap.needsUpdate = true;
      }

      if (HC.sunLight) {
        HC.sunLight.castShadow = enableShadow;
        const res = (currentGraphicsConfig.preset === 'ultra') ? 2048 : (currentGraphicsConfig.preset === 'high' ? 1024 : 512);
        if (HC.sunLight.shadow && HC.sunLight.shadow.mapSize) {
          HC.sunLight.shadow.mapSize.set(res, res);
          if (HC.sunLight.shadow.map) {
            HC.sunLight.shadow.map.dispose();
            HC.sunLight.shadow.map = null;
          }
        }
      }
    }
    updateGraphicsUI();
  }

  function updateGraphicsUI() {
    const wrap = document.getElementById('homecoming-ui');
    if (!wrap) return;
    const btns = wrap.querySelectorAll('.hc-preset-btn');
    btns.forEach(b => {
      const id = b.id.replace('hc-preset-', '');
      b.classList.toggle('active', id === currentGraphicsConfig.preset);
    });
    const desc = wrap.querySelector('#hc-preset-desc');
    if (desc && GRAPHICS_PRESETS[currentGraphicsConfig.preset]) {
      desc.textContent = GRAPHICS_PRESETS[currentGraphicsConfig.preset].description;
    }
    const cb = wrap.querySelector('#hc-data-saver-cb');
    if (cb) cb.checked = !!currentGraphicsConfig.dataSaver;
    const dprLabel = wrap.querySelector('#hc-graphics-dpr-val');
    const ren = getRenderer();
    if (dprLabel && ren && typeof ren.getPixelRatio === 'function') {
      dprLabel.textContent = 'Preset: ' + GRAPHICS_PRESETS[currentGraphicsConfig.preset].name + ' (' + ren.getPixelRatio().toFixed(2) + 'x DPR)';
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     MAIN SPACECRAFT MODEL & CONTINUITY (Task 6)
     Visible across all 6 locations with damage and repaired states.
     ───────────────────────────────────────────────────────────────────── */
  function buildMainSpacecraft(planetId, isRepaired) {
    const ship = new THREE.Group();
    ship.name = 'main-spacecraft-' + planetId;

    // 1. Fuselage — Brushed aerospace alloy with thermal heat shield underbelly
    const hullMat = pbrMetal(isRepaired ? 0xd6dbe2 : 0x524c48, isRepaired ? 0.32 : 0.58, isRepaired ? 0.86 : 0.45);
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.3, 8.5, 14, 1, false), hullMat);
    fuselage.rotation.z = Math.PI / 2;
    fuselage.position.y = 2.0;
    ship.add(fuselage);

    // Heat Shield Underbelly Tile Shell
    const tileMat = material(0x18191d, 0.68, 0x000000, 0.15);
    const heatShield = new THREE.Mesh(new THREE.CylinderGeometry(1.63, 2.33, 8.3, 14, 1, false, 0, Math.PI), tileMat);
    heatShield.rotation.z = Math.PI / 2;
    heatShield.rotation.x = Math.PI;
    heatShield.position.y = 2.0;
    ship.add(heatShield);

    // 2. Cockpit Canopy with deep polarized gold/iridium avionics sheen
    const canopyMat = pbrGlass(isRepaired ? 0x0a2236 : 0x14100c, 0.05, 0.94, 1.0);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 12, 0, Math.PI, 0, Math.PI / 2), canopyMat);
    canopy.rotation.z = -Math.PI / 2;
    canopy.position.set(-3.2, 2.6, 0);
    ship.add(canopy);

    // 3. Forward Nose Aerospike & Pitot Sensor Mast
    const noseMat = pbrMetal(isRepaired ? 0xe2e6ec : 0x625a54, 0.28, 0.88);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.8, 14), noseMat);
    nose.rotation.z = Math.PI / 2;
    nose.position.set(-5.4, 2.0, 0);
    const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 1.4, 8), pbrMetal(0xfff0dd, 0.2, 0.95));
    spike.rotation.z = Math.PI / 2;
    spike.position.set(-7.2, 2.0, 0);
    ship.add(nose, spike);

    // 4. Swept Carbon-Composite Delta Wings with Navigation Strobes
    const wingMat = material(0x2a2d33, 0.48, 0x000000, 0.6);
    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 3.2), wingMat);
    leftWing.position.set(0.8, 1.8, 2.4);
    leftWing.rotation.y = -0.3;
    const rightWing = leftWing.clone();
    rightWing.position.set(0.8, 1.8, -2.4);
    rightWing.rotation.y = 0.3;

    // Wingtip navigation markers (Port Red, Starboard Green)
    const portMarker = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), material(0xff2211, 0.2, 0xff2211));
    portMarker.position.set(-0.8, 1.8, 3.8);
    const stbdMarker = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), material(0x22ff55, 0.2, 0x22ff55));
    stbdMarker.position.set(-0.8, 1.8, -3.8);
    ship.add(leftWing, rightWing, portMarker, stbdMarker);

    // 5. Twin Vectoring Ion Thruster Engines with glowing magnetic nozzle bells
    const engineMat = pbrMetal(0x24272c, 0.36, 0.92);
    const thrusterGlowMat = material(isRepaired ? 0x6beeff : 0x441b12, 0.22, isRepaired ? 0x3acaff : 0x882010);
    [-1.1, 1.1].forEach(zOff => {
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.98, 2.8, 12), engineMat);
      nacelle.rotation.z = Math.PI / 2;
      nacelle.position.set(4.0, 2.0, zOff);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.52, 0.85, 12), thrusterGlowMat);
      nozzle.rotation.z = Math.PI / 2;
      nozzle.position.set(5.5, 2.0, zOff);
      const coreLight = new THREE.PointLight(isRepaired ? 0x00e5ff : 0xff4411, isRepaired ? 0.9 : 0.4, 6.0);
      coreLight.position.set(5.7, 2.0, zOff);
      ship.add(nacelle, nozzle, coreLight);
    });

    // 6. Heavy Pneumatic Landing Gear Struts with Hydraulic Pistons
    const strutMat = pbrMetal(0x5a5e66, 0.38, 0.82);
    const pistonMat = pbrMetal(0xe8ecf2, 0.15, 0.95);
    [[-2.2, 1.8], [-2.2, -1.8], [2.2, 2.2], [2.2, -2.2]].forEach(([xOff, zOff]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.6, 8), strutMat);
      leg.position.set(xOff, 1.0, zOff);
      leg.rotation.z = xOff > 0 ? -0.2 : 0.2;
      leg.rotation.x = zOff > 0 ? 0.25 : -0.25;
      const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8), pistonMat);
      piston.position.set(xOff * 0.95, 0.7, zOff * 0.95);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.18, 10), strutMat);
      foot.position.set(xOff + (xOff > 0 ? 0.3 : -0.3), 0.06, zOff + (zOff > 0 ? 0.35 : -0.35));
      ship.add(leg, piston, foot);
    });

    // 7. Status Beacon & Mission Lighting
    const beaconLight = new THREE.PointLight(isRepaired ? 0x8fe7ff : 0xff7040, isRepaired ? 1.2 : 0.8, 18);
    beaconLight.position.set(0, 3.8, 0);
    ship.add(beaconLight);

    // If damaged (Mars initial crash), add electrical spark points
    if (!isRepaired) {
      const sparkGeo = new THREE.BufferGeometry();
      const sparkPos = new Float32Array(24 * 3);
      for (let i = 0; i < 24; i++) {
        sparkPos[i * 3] = (Math.random() - 0.5) * 1.5 + 2.0;
        sparkPos[i * 3 + 1] = Math.random() * 1.8 + 1.2;
        sparkPos[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      }
      sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
      const sparkMat = new THREE.PointsMaterial({ color: 0xffaa44, size: 0.18, transparent: true, opacity: 0.85 });
      const sparks = new THREE.Points(sparkGeo, sparkMat);
      sparks.name = 'ship-sparks';
      ship.add(sparks);
    }

    enableShadows(ship, true, true);
    return ship;
  }

  /* ─────────────────────────────────────────────────────────────────────
     CELESTIAL SKY PHENOMENA PER LOCATION (Task 8)
     ───────────────────────────────────────────────────────────────────── */
  let activeSkyWonder = null;

  function createSkyPhenomena(root, planetId) {
    if (activeSkyWonder && activeSkyWonder.group) {
      try { root.remove(activeSkyWonder.group); } catch (_) { }
      activeSkyWonder = null;
    }

    const g = new THREE.Group();
    g.name = 'sky-phenomenon-' + planetId;

    if (planetId === 'mars') {
      // Mars: Swirling Dust Devil Vortex particle column
      const count = 350;
      const posArr = new Float32Array(count * 3);
      const angles = new Float32Array(count);
      const heights = new Float32Array(count);
      const speeds = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const h = Math.random() * 26;
        const r = 0.8 + Math.pow(h / 26, 1.4) * 5.2;
        const a = Math.random() * Math.PI * 2;
        angles[i] = a;
        heights[i] = h;
        speeds[i] = 1.8 + Math.random() * 2.2;
        posArr[i * 3] = Math.cos(a) * r;
        posArr[i * 3 + 1] = h;
        posArr[i * 3 + 2] = Math.sin(a) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      const mat = new THREE.PointsMaterial({ color: 0xd27b45, size: 0.45, transparent: true, opacity: 0.65 });
      const vortex = new THREE.Points(geo, mat);
      g.add(vortex);
      g.position.copy(pos(45, 38));
      activeSkyWonder = { type: 'dust_devil', group: g, vortex, angles, heights, speeds, count, cx: 45, cz: 38, t: 0 };

    } else if (planetId === 'phobos') {
      // Phobos: Colossal Looming Mars high in the celestial orbital sky (~28° visual arc, completely above horizon mountains)
      const marsSphere = new THREE.Mesh(
        new THREE.SphereGeometry(56, 40, 32),
        new THREE.MeshStandardMaterial({
          color: 0xc4572b,
          roughness: 0.85,
          metalness: 0.05,
          emissive: 0x2b1008,
          emissiveIntensity: 0.28,
          fog: false
        })
      );
      marsSphere.position.set(-120, 160, -130);
      const [mMap, bMap] = getPlanetTexture('mars');
      if (mMap) { marsSphere.material.map = mMap; marsSphere.material.needsUpdate = true; }
      const rim = new THREE.Mesh(
        new THREE.SphereGeometry(57.8, 40, 32),
        new THREE.MeshBasicMaterial({ color: 0xff8855, transparent: true, opacity: 0.25, side: THREE.BackSide, fog: false })
      );
      marsSphere.add(rim);
      g.add(marsSphere);
      activeSkyWonder = { type: 'looming_mars', group: g, marsSphere };

    } else if (planetId === 'europa') {
      // Europa: Giant Banded Jupiter with Great Red Spot high in the Jovian sky + Cryo-Geyser Plumes
      const jupSphere = new THREE.Mesh(
        new THREE.SphereGeometry(64, 40, 32),
        new THREE.MeshStandardMaterial({
          map: generateJupiterTexture(),
          roughness: 0.9,
          emissive: 0x332015,
          emissiveIntensity: 0.25,
          fog: false
        })
      );
      jupSphere.position.set(-135, 165, -140);
      g.add(jupSphere);

      // Cryo-geyser erupting ice plume
      const geyserCount = 380;
      const gPos = new Float32Array(geyserCount * 3);
      const gVel = [];
      for (let i = 0; i < geyserCount; i++) {
        gPos[i * 3] = (Math.random() - 0.5) * 1.5;
        gPos[i * 3 + 1] = Math.random() * 30;
        gPos[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
        gVel.push({
          x: (Math.random() - 0.5) * 0.8,
          y: 6.0 + Math.random() * 10.0,
          z: (Math.random() - 0.5) * 0.8,
          life: Math.random() * 4.0
        });
      }
      const gGeo = new THREE.BufferGeometry();
      gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
      const gMat = new THREE.PointsMaterial({ color: 0xccf8ff, size: 0.42, transparent: true, opacity: 0.78 });
      const geyser = new THREE.Points(gGeo, gMat);
      geyser.position.copy(pos(24, 28));
      g.add(geyser);

      activeSkyWonder = { type: 'europa_sky', group: g, jupSphere, geyser, gVel, geyserCount };

    } else if (planetId === 'titan') {
      // Titan: Saturn with Majestic Tilted Rings floating high in the golden haze
      const satGroup = new THREE.Group();
      const sat = new THREE.Mesh(
        new THREE.SphereGeometry(42, 36, 28),
        new THREE.MeshStandardMaterial({ map: generateSaturnTexture(), roughness: 0.9, fog: false })
      );
      const ringTex = generateSaturnRingTexture();
      const ringGeo = new THREE.RingGeometry(52, 82, 64);
      const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, side: THREE.DoubleSide, transparent: true, opacity: 0.88, fog: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = 1.1;
      ring.rotation.y = -0.28;
      satGroup.add(sat, ring);
      satGroup.position.set(-130, 160, -135);
      g.add(satGroup);
      activeSkyWonder = { type: 'titan_sky', group: g, satGroup };

    } else if (planetId === 'ceres') {
      // Ceres: Asteroid Belt Micrometeorite Storm
      const astGroup = new THREE.Group();
      const dGeo = new THREE.DodecahedronGeometry(0.8, 1);
      const dMat = new THREE.MeshStandardMaterial({ color: 0x4a4d5c, roughness: 0.95 });
      const asteroids = [];
      for (let i = 0; i < 22; i++) {
        const m = new THREE.Mesh(dGeo, dMat);
        const ang = (i / 22) * Math.PI * 2;
        const rad = 25 + Math.random() * 30;
        m.position.set(Math.cos(ang) * rad, 16 + Math.random() * 22, Math.sin(ang) * rad);
        m.scale.setScalar(0.4 + Math.random() * 0.9);
        astGroup.add(m);
        asteroids.push({ mesh: m, rotSpeed: (Math.random() - 0.5) * 1.5 });
      }
      g.add(astGroup);
      activeSkyWonder = { type: 'ceres_sky', group: g, astGroup, asteroids };

    } else if (planetId === 'earth') {
      // Earth: Radiant Aurora Borealis Ribbon Curtain
      const ribbonGeo = new THREE.CylinderGeometry(85, 80, 24, 48, 8, true);
      const ribbonMat = new THREE.MeshBasicMaterial({
        color: 0x44ffaa,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide
      });
      const aurora = new THREE.Mesh(ribbonGeo, ribbonMat);
      aurora.position.set(0, 32, 0);
      g.add(aurora);
      activeSkyWonder = { type: 'earth_sky', group: g, aurora };
    }

    root.add(g);
  }

  function updateSkyPhenomena(dt, t) {
    if (!activeSkyWonder) return;
    const w = activeSkyWonder;
    if (w.type === 'dust_devil') {
      w.t += dt;
      w.group.position.x = w.cx + Math.sin(w.t * 0.25) * 12;
      w.group.position.z = w.cz + Math.cos(w.t * 0.25) * 10;
      w.vortex.rotation.y += dt * 4.5;
    } else if (w.type === 'looming_mars') {
      w.marsSphere.rotation.y += dt * 0.015;
    } else if (w.type === 'europa_sky') {
      w.jupSphere.rotation.y += dt * 0.01;
      const posAttr = w.geyser.geometry.attributes.position;
      const arr = posAttr.array;
      for (let i = 0; i < w.geyserCount; i++) {
        const vel = w.gVel[i];
        vel.life += dt;
        arr[i * 3 + 1] += vel.y * dt;
        arr[i * 3] += vel.x * dt;
        arr[i * 3 + 2] += vel.z * dt;
        if (arr[i * 3 + 1] > 38 || vel.life > 3.8) {
          arr[i * 3] = (Math.random() - 0.5) * 1.5;
          arr[i * 3 + 1] = 0;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
          vel.life = 0;
        }
      }
      posAttr.needsUpdate = true;
    } else if (w.type === 'titan_sky') {
      w.satGroup.rotation.y += dt * 0.008;
    } else if (w.type === 'ceres_sky') {
      w.asteroids.forEach(a => {
        a.mesh.rotation.x += dt * a.rotSpeed;
        a.mesh.rotation.y += dt * a.rotSpeed * 0.7;
      });
    } else if (w.type === 'earth_sky') {
      w.aurora.rotation.y += dt * 0.02;
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     MOBILE CONTROLS & VIRTUAL JOYSTICK (Task 3)
     ───────────────────────────────────────────────────────────────────── */
  let mobileControlsActive = false;
  let isTouchDevice = false;
  let touchModeAuthoritative = false;
  let coarsePointerDetected = false;
  let hasReceivedActualTouch = false;

  const touchState = {
    joystickTouchId: null,
    cameraTouchId: null,
    lastCameraX: 0,
    lastCameraY: 0,
    joystickX: 0,
    joystickZ: 0,
    running: false
  };
  HC.touchState = touchState;

  function detectCoarsePointer() {
    if (typeof window === 'undefined') return false;
    const matchCoarse = (typeof window.matchMedia === 'function') && window.matchMedia('(pointer: coarse)').matches;
    const matchHoverNone = (typeof window.matchMedia === 'function') && window.matchMedia('(hover: none)').matches;
    const hasTouchPoints = (typeof navigator !== 'undefined' && ((navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0))) || ('ontouchstart' in window);
    const ua = (typeof navigator !== 'undefined') ? (navigator.userAgent || '') : '';
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS|FxiOS|Tablet|Touch/i.test(ua);
    const isSmallScreen = (typeof window.innerWidth !== 'undefined' && (window.innerWidth <= 1024 || window.innerHeight <= 1024));
    return matchCoarse || isMobileUA || (hasTouchPoints && (isSmallScreen || matchHoverNone)) || hasTouchPoints;
  }

  function resetAllTouchMovement() {
    touchState.joystickTouchId = null;
    touchState.cameraTouchId = null;
    touchState.joystickX = 0;
    touchState.joystickZ = 0;
    const thumb = document.getElementById('hc-joy-thumb');
    if (thumb && thumb.style) thumb.style.transform = 'translate(0px, 0px)';
  }

  function initMobileControls() {
    coarsePointerDetected = detectCoarsePointer();
    isTouchDevice = coarsePointerDetected;
    // On mobile devices, default touch mode and mobile controls to active immediately.
    touchModeAuthoritative = coarsePointerDetected;
    mobileControlsActive = coarsePointerDetected || mobileControlsActive;

    const wrap = document.getElementById('homecoming-ui');
    if (!wrap) return;

    let mobileEl = document.getElementById('hc-mobile-controls');
    if (!mobileEl) {
      mobileEl = document.createElement('div');
      mobileEl.id = 'hc-mobile-controls';
      mobileEl.innerHTML = `
        <div class="hc-joystick-zone" id="hc-joy-zone">
          <div class="hc-joystick-base"></div>
          <div class="hc-joystick-thumb" id="hc-joy-thumb"></div>
        </div>
        <button class="hc-touch-btn" id="hc-btn-jump">JUMP</button>
        <button class="hc-touch-btn" id="hc-btn-interact">USE</button>
        <button class="hc-touch-btn" id="hc-btn-run">RUN</button>
        <button class="hc-touch-btn" id="hc-btn-scan">SCAN</button>
        <button class="hc-touch-btn" id="hc-btn-emp-mobile">EMP</button>
        <button class="hc-touch-btn" id="hc-btn-pause-mobile">MENU</button>
        <div id="hc-rover-mobile-controls" style="display:none;">
          <button class="hc-touch-btn" id="hc-btn-rover-exit">EXIT</button>
        </div>
      `;
      document.body.appendChild(mobileEl);
    }

    const zone = document.getElementById('hc-joy-zone');
    const thumb = document.getElementById('hc-joy-thumb');
    const canListen = (el) => el && typeof el.addEventListener === 'function';

    if (zone && thumb && canListen(zone)) {
      const getZoneCenter = () => {
        const rect = (typeof zone.getBoundingClientRect === 'function')
          ? zone.getBoundingClientRect()
          : { left: 12, top: 500, width: 160, height: 160 };
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };

      zone.addEventListener('touchstart', (e) => {
        if (e.preventDefault) e.preventDefault();
        if (touchState.joystickTouchId !== null) return;
        const touch = e.changedTouches ? e.changedTouches[0] : e;
        touchState.joystickTouchId = touch.identifier != null ? touch.identifier : 1;
        updateJoystick(touch);
      }, { passive: false });

      if (canListen(window)) {
        window.addEventListener('touchmove', (e) => {
          if (touchState.joystickTouchId === null || !e.changedTouches) return;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if ((t.identifier != null ? t.identifier : 1) === touchState.joystickTouchId) {
              updateJoystick(t);
              break;
            }
          }
        }, { passive: false });

        const endJoy = (e) => {
          if (!e.changedTouches) {
            resetAllTouchMovement();
            return;
          }
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if ((t.identifier != null ? t.identifier : 1) === touchState.joystickTouchId) {
              touchState.joystickTouchId = null;
              touchState.joystickX = 0;
              touchState.joystickZ = 0;
              if (thumb.style) thumb.style.transform = 'translate(0px, 0px)';
              break;
            }
          }
        };
        window.addEventListener('touchend', endJoy, { passive: false });
        window.addEventListener('touchcancel', endJoy, { passive: false });
      }

      function updateJoystick(touch) {
        const center = getZoneCenter();
        const dx = touch.clientX - center.x;
        const dy = touch.clientY - center.y;
        const maxR = Math.max(26, Math.min(46, ((zone.offsetWidth || 130) * 0.28) || 36));
        const dist = Math.hypot(dx, dy);
        if (dist < 4) {
          touchState.joystickX = 0;
          touchState.joystickZ = 0;
          if (thumb.style) thumb.style.transform = 'translate(0px, 0px)';
          return;
        }
        const clampedDist = Math.min(dist, maxR);
        const angle = Math.atan2(dy, dx);
        const tx = Math.cos(angle) * clampedDist;
        const ty = Math.sin(angle) * clampedDist;
        if (thumb.style) thumb.style.transform = `translate(${tx}px, ${ty}px)`;
        touchState.joystickX = tx / maxR;
        touchState.joystickZ = ty / maxR;
      }
    }

    // Touch camera drag: listen on window to smoothly pan across the entire screen
    if (canListen(window)) {
      window.addEventListener('touchstart', (e) => {
        if (!e.changedTouches) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const target = t.target || e.target;
          if (target && target.closest && (
            target.closest('.hc-touch-btn') ||
            target.closest('.hc-joystick-zone') ||
            target.closest('#homecoming-ui button') ||
            target.closest('#homecoming-ui a') ||
            target.closest('#homecoming-ui input') ||
            target.closest('.btn') ||
            target.closest('#hc-intro') ||
            target.closest('#hc-pause') ||
            target.closest('#hc-hub') ||
            target.closest('#hc-puzzle') ||
            target.closest('#hc-dialogue') ||
            target.closest('#hc-comms') ||
            target.closest('#hc-explorers')
          )) {
            continue;
          }
          // Avoid the bottom-left area reserved for joystick
          const isJoyArea = (t.clientX < Math.max(180, window.innerWidth * 0.35)) && (t.clientY > window.innerHeight * 0.55);
          if (isJoyArea) continue;

          if (touchState.cameraTouchId === null) {
            touchState.cameraTouchId = t.identifier != null ? t.identifier : 2;
            touchState.lastCameraX = t.clientX;
            touchState.lastCameraY = t.clientY;
            break;
          }
        }
      }, { passive: false });

      window.addEventListener('touchmove', (e) => {
        if (touchState.cameraTouchId === null || !e.changedTouches) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if ((t.identifier != null ? t.identifier : 2) === touchState.cameraTouchId) {
            const dx = t.clientX - touchState.lastCameraX;
            const dy = t.clientY - touchState.lastCameraY;
            touchState.lastCameraX = t.clientX;
            touchState.lastCameraY = t.clientY;
            // Smooth, responsive sensitivity tuned for mobile touch screens
            const sensX = 0.0030;
            const sensY = 0.0022;
            HC.mouse.yaw -= dx * sensX;
            HC.mouse.pitch = clamp(HC.mouse.pitch - dy * sensY, -0.62, 0.36);
            if (HC.rover && HC.rover.driving && (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4)) {
              notifyRoverCameraManualLook();
            }
            break;
          }
        }
      }, { passive: false });

      const endCam = (e) => {
        if (!e.changedTouches) {
          touchState.cameraTouchId = null;
          return;
        }
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if ((t.identifier != null ? t.identifier : 2) === touchState.cameraTouchId) {
            touchState.cameraTouchId = null;
            break;
          }
        }
      };
      window.addEventListener('touchend', endCam, { passive: false });
      window.addEventListener('touchcancel', endCam, { passive: false });

      // Safety resets on blur, pointercancel, and visibility change
      window.addEventListener('blur', () => {
        resetAllTouchMovement();
        if (HC.keys) HC.keys.clear();
      });
      window.addEventListener('pointercancel', resetAllTouchMovement);

      // Auto-detect dynamic touch vs desktop keyboard interaction
      window.addEventListener('touchstart', () => {
        hasReceivedActualTouch = true;
        if (!touchModeAuthoritative || !mobileControlsActive) {
          touchModeAuthoritative = true;
          isTouchDevice = true;
          mobileControlsActive = true;
          updateMobileControlsVisibility();
        }
      }, { passive: true });

      window.addEventListener('keydown', (e) => {
        const isTrueMobile = (typeof window.matchMedia === 'function') && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        if (touchModeAuthoritative && !isTrueMobile && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyE', 'KeyR', 'KeyF'].includes(e.code)) {
          touchModeAuthoritative = false;
          updateMobileControlsVisibility();
        }
      });
    }

    if (typeof document !== 'undefined' && canListen(document)) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) resetAllTouchMovement();
      });
    }

    // Synthetic click deduplication & touch action helper
    function bindTouchButton(btn, action) {
      if (!btn || !canListen(btn)) return;
      let lastTrigger = 0;
      const trigger = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const now = performance.now();
        if (now - lastTrigger < 250) return;
        lastTrigger = now;
        action();
      };
      btn.addEventListener('touchstart', trigger, { passive: false });
      btn.onclick = (e) => {
        if (performance.now() - lastTrigger < 400) {
          if (e && e.preventDefault) e.preventDefault();
          if (e && e.stopPropagation) e.stopPropagation();
          return;
        }
        trigger(e);
      };
    }

    // Touch buttons binding
    bindTouchButton(document.getElementById('hc-btn-jump'), () => jump());
    bindTouchButton(document.getElementById('hc-btn-interact'), () => interact());
    const btnRun = document.getElementById('hc-btn-run');
    bindTouchButton(btnRun, () => {
      touchState.running = !touchState.running;
      if (btnRun && btnRun.classList) btnRun.classList.toggle('pressed', touchState.running);
    });
    bindTouchButton(document.getElementById('hc-btn-scan'), () => triggerScanOrCancel());
    bindTouchButton(document.getElementById('hc-btn-emp-mobile'), () => emp());
    bindTouchButton(document.getElementById('hc-btn-pause-mobile'), () => pause());
    bindTouchButton(document.getElementById('hc-btn-rover-exit'), () => tryVehicle());

    updateMobileControlsVisibility();
  }

  function updateMobileControlsVisibility() {
    const el = document.getElementById('hc-mobile-controls');
    if (!el) return;
    const shouldShow = !!(mobileControlsActive && touchModeAuthoritative && (HC.state === STATES.EXPLORATION || HC.state === STATES.INTRO));
    if (el && el.classList && typeof el.classList.toggle === 'function') {
      el.classList.toggle('active', shouldShow);
    }
    if (typeof document !== 'undefined' && document.body && document.body.classList && typeof document.body.classList.toggle === 'function') {
      document.body.classList.toggle('hc-touch-mode', shouldShow);
    }
    const roverControls = document.getElementById('hc-rover-mobile-controls');
    const isDriving = !!(HC.rover && HC.rover.driving);
    if (roverControls) roverControls.style.display = (shouldShow && isDriving) ? 'flex' : 'none';
    const btnJump = document.getElementById('hc-btn-jump');
    if (btnJump) btnJump.style.display = (shouldShow && !isDriving) ? 'flex' : 'none';
    const btnRun = document.getElementById('hc-btn-run');
    if (btnRun) {
      btnRun.textContent = isDriving ? 'BOOST' : 'RUN';
      btnRun.style.display = shouldShow ? 'flex' : 'none';
    }
    const btnEmp = document.getElementById('hc-btn-emp-mobile');
    if (btnEmp) {
      btnEmp.style.display = (shouldShow && !isDriving) ? 'flex' : 'none';
    }
    if (typeof tutorialState !== 'undefined' && tutorialState && tutorialState.active) {
      const curStep = TUTORIAL_STEPS[tutorialState.stepIndex];
      const actEl = document.getElementById('hc-tut-action-txt');
      if (curStep && actEl) {
        actEl.innerHTML = formatActionHTML(curStep);
        highlightTutorialControls(curStep);
      }
    }
  }

  function setMobileControlsVisible(visible) {
    mobileControlsActive = !!visible;
    updateMobileControlsVisibility();
  }
  HC.setMobileControlsVisible = setMobileControlsVisible;
  HC.updateMobileControlsVisibility = updateMobileControlsVisibility;

  /* ─────────────────────────────────────────────────────────────────────
     UNIVERSAL CHECKPOINT CLEARANCE GUARANTEE
     Ensures that no tutorial waypoint, beacon, or mission checkpoint
     spawns inside a solid obstacle or collision mesh.
     ───────────────────────────────────────────────────────────────────── */
  function resolveClearCheckpointPosition(x, z, clearanceMargin = 1.8) {
    let resX = Number(x);
    let resZ = Number(z);
    if (isNaN(resX) || isNaN(resZ)) return { x: 0, z: 0 };
    if (!HC.solids || !HC.solids.length) return { x: resX, z: resZ };

    // Iteratively resolve against all solid collision obstacles in the world
    for (let pass = 0; pass < 3; pass++) {
      let adjusted = false;
      for (let i = 0; i < HC.solids.length; i++) {
        const s = HC.solids[i];
        if ((s.r || 1.0) < 2.2) continue;
        const safeRadius = (s.r || 1.0) + clearanceMargin;
        const dx = resX - s.x;
        const dz = resZ - s.z;
        const dist = Math.hypot(dx, dz);

        if (dist < safeRadius) {
          adjusted = true;
          if (dist > 0.05) {
            // Push outward along radial vector to safe clear ground
            const push = safeRadius / dist;
            resX = s.x + dx * push;
            resZ = s.z + dz * push;
          } else {
            // If placed directly at obstacle origin (e.g. spacecraft center at -2, -2),
            // push toward unobstructed rear engine staging area (+X direction)
            resX = s.x + safeRadius;
            resZ = s.z;
          }
        }
      }
      if (!adjusted) break;
    }
    return { x: resX, z: resZ };
  }

  /* ─────────────────────────────────────────────────────────────────────
     INTERACTIVE IN-GAME PLAYABLE TUTORIAL STATE MACHINE (Task 5)
     ───────────────────────────────────────────────────────────────────── */
  const TUTORIAL_STEPS = [
    {
      id: 'traversal',
      kicker: 'OBJECTIVE: ASSESS YOUR SURROUNDINGS',
      title: 'Assess Your Surroundings',
      body: 'Suit locomotive telemetry is active. Start by moving toward the damaged equipment ahead. I will guide you from there.',
      action: 'Move toward the damaged equipment beacon using [W][A][S][D] / Touch Joystick',
      hint: 'Use [W][A][S][D] on keyboard or drag the virtual joystick on mobile to walk toward the glowing marker.',
      control: 'movement',
      targetPos: { x: 7, z: -11 },
      check(dt, now) {
        const p = player();
        const dist = Math.hypot(p.x - 7, p.z - (-11));
        return dist <= 3.6 || (typeof tutorialState !== 'undefined' && (tutorialState.traversedDistance || 0) >= 6.0);
      }
    },
    {
      id: 'orientation',
      kicker: 'STEP 2 OF 9 · OPTICAL SURVEY',
      title: 'Look Around & Camera Orientation',
      body: 'Calibrate your optical tracking array. Survey the Mars landing site and orient your camera toward the expedition ascent spacecraft.',
      action: 'Rotate your view to look at the Ascent Spacecraft',
      hint: 'Move your mouse or swipe across the screen to orient your camera toward the spacecraft.',
      control: 'camera',
      targetPos: { x: 4.8, z: -2 },
      check(dt, now) {
        const p = player();
        const fX = -Math.sin(HC.mouse.yaw), fZ = -Math.cos(HC.mouse.yaw);
        const toShipX = -2 - p.x, toShipZ = -2 - p.z;
        const shipDist = Math.hypot(toShipX, toShipZ) || 1;
        const dot = (fX * toShipX + fZ * toShipZ) / shipDist;
        return dot >= 0.70 || (tutorialState && tutorialState.cameraAccumulatedYaw >= 1.5);
      }
    },
    {
      id: 'jumping',
      kicker: 'STEP 3 OF 9 · LOW-GRAVITY JUMPING',
      title: 'Planetary Gravity & Gravitational Jumping',
      body: 'Mars features 38% Earth gravity. Hold sprint to build forward momentum, then leap over the ridge obstacle to the landing zone.',
      action: 'Sprint [Shift/RUN] and Jump [Space/JUMP] over the ridge',
      hint: 'Hold [Shift] (or tap [RUN]), run toward the ridge, and press [Space] (or tap [JUMP]) to leap across.',
      control: 'jump',
      obstaclePos: { x: 10, z: -11 },
      targetPos: { x: 14, z: -11 },
      check(dt, now) {
        const p = player();
        const dist = Math.hypot(p.x - 14, p.z - (-11));
        return (tutorialState.jumpInitiated || HC.isJumping) && dist <= 2.8;
      }
    },
    {
      id: 'interaction',
      kicker: 'STEP 4 OF 9 · FIELD PROTOCOLS',
      title: 'Equipment Interaction & Salvage',
      body: 'A damaged telemetry pod is located nearby. Approach the equipment and initiate a manual interface sequence.',
      action: 'Approach the telemetry pod and press [E] / tap [USE]',
      hint: 'Walk close to the highlighted telemetry pod until the interaction prompt appears, then press [E] or tap [USE].',
      control: 'interact',
      targetPos: { x: 14, z: -7 },
      check(dt, now) {
        return tutorialState.podInteracted === true;
      }
    },
    {
      id: 'scanning',
      kicker: 'STEP 5 OF 9 · SPECTRAL ANALYSIS',
      title: 'Spectral Scanning System',
      body: 'Activate your suit-mounted 3D scanner. Face the hematite rock formation and engage the spectral analyzer.',
      action: 'Target the mineral formation and press [C] / tap [SCAN]',
      hint: 'Face the glowing mineral deposit within 12 meters, then press [C] or tap [SCAN] to start the 3D scanning beam.',
      control: 'scan',
      targetPos: { x: 10, z: -4 },
      check(dt, now) {
        return tutorialState.scanCompleted === true;
      }
    },
    {
      id: 'navigation',
      kicker: 'STEP 6 OF 9 · NAVIGATION HUD',
      title: 'Waypoint Compass & Minimap Navigation',
      body: 'The HUD compass strip and minimap track expedition waypoints. Follow the navigation pip to the survey staging ridge.',
      action: 'Follow the HUD compass marker to the survey waypoint',
      hint: 'Keep the cyan pip centered on your top compass strip and walk toward the staging ridge.',
      control: 'navigation',
      targetPos: { x: 2, z: -14 },
      check(dt, now) {
        const p = player();
        const dist = Math.hypot(p.x - 2, p.z - (-14));
        return dist <= 3.0;
      }
    },
    {
      id: 'rover',
      kicker: 'STEP 7 OF 9 · RAPID TRANSIT',
      title: 'Surface Exploration Rover',
      body: 'The all-terrain rover traverses Martian canyons at high speed. Board the rover, drive to the transit marker, and disembark.',
      action: 'Board rover [R], drive to the waypoint, and exit [R]',
      hint: 'Approach the rover and press [R] (or tap USE). Drive forward to the waypoint, then press [R] or tap EXIT.',
      control: 'rover',
      targetPos: { x: -2, z: -9 },
      waypointPos: { x: -18, z: -12 },
      check(dt, now) {
        if (!HC.rover) return true;
        return tutorialState.roverExited === true;
      }
    },
    {
      id: 'puzzle',
      kicker: 'STEP 8 OF 9 · FIELD DIAGNOSTICS',
      title: 'Solving Terminal Diagnostic Puzzles',
      body: 'Crucial systems require circuit diagnostics. Access the field terminal and solve the electrical wiring puzzle.',
      action: 'Access terminal [E] and match the colored wire circuits',
      hint: 'Interact with the terminal. Click each wire on the left, then click its matching colored socket on the right.',
      control: 'puzzle',
      targetPos: { x: -8, z: -5 },
      check(dt, now) {
        return tutorialState.puzzleSolved === true;
      }
    },
    {
      id: 'repair',
      kicker: 'STEP 9 OF 9 · EXPEDITION READINESS',
      title: 'Spacecraft Repair & Mission Briefing',
      body: 'Final preparation: inspect the ascent spacecraft engine manifold. To depart Mars, you must locate 3 scattered components and align the orbital relay.',
      action: 'Approach the Spacecraft Engine to complete orientation',
      hint: 'Walk to the rear engine section of the ascent spacecraft to complete your tutorial orientation.',
      control: 'repair',
      targetPos: { x: 4.8, z: -2 },
      check(dt, now) {
        const p = player();
        const distEngine = Math.hypot(p.x - 4.8, p.z - (-2));
        const distCenter = Math.hypot(p.x - (-2), p.z - (-2));
        return distEngine <= 4.0 || distCenter <= 5.5;
      }
    }
  ];

  const tutorialState = {
    active: false,
    stepIndex: 0,
    stepStartedAt: 0,
    cameraStartYaw: 0,
    cameraAccumulatedYaw: 0,
    lastCamYaw: 0,
    traversedDistance: 0,
    lastPlayerPos: null,
    jumpInitiated: false,
    podInteracted: false,
    scanCompleted: false,
    roverEntered: false,
    roverWayreached: false,
    roverExited: false,
    puzzleSolved: false,
    hintShown: false,
    markerGroup: null,
    landingRing: null,
    obstacleGroup: null,
    pod: null,
    mineral: null,
    terminal: null
  };

  function initTutorialObjects(root) {
    if (!root || typeof THREE === 'undefined') return;
    try {
      // 1. 3D Holographic Animated Waypoint Marker
      const mg = new THREE.Group();
      mg.name = 'tutorial-waypoint-beacon';
      mg.visible = false;

      // Pulsing outer ground ring
      const outRingGeo = new THREE.RingGeometry(1.6, 1.85, 32);
      const outRingMat = new THREE.MeshBasicMaterial({ color: 0x8fe7ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const outRing = new THREE.Mesh(outRingGeo, outRingMat);
      outRing.rotation.x = -Math.PI / 2;
      outRing.position.y = 0.04;
      mg.add(outRing);

      // Rotating inner ground ring
      const inRingGeo = new THREE.RingGeometry(0.75, 0.95, 32);
      const inRingMat = new THREE.MeshBasicMaterial({ color: 0xffa060, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
      const inRing = new THREE.Mesh(inRingGeo, inRingMat);
      inRing.rotation.x = -Math.PI / 2;
      inRing.position.y = 0.05;
      mg.add(inRing);

      // Vertical holographic light beam
      const beamGeo = new THREE.CylinderGeometry(0.12, 0.28, 7.5, 16, 1, true);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0x8fe7ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 3.75;
      mg.add(beam);

      // Floating rotating diamond
      const diamondGeo = new THREE.OctahedronGeometry(0.35, 0);
      const diamondMat = new THREE.MeshBasicMaterial({ color: 0x8fe7ff, wireframe: true });
      const diamond = new THREE.Mesh(diamondGeo, diamondMat);
      diamond.position.y = 3.2;
      mg.add(diamond);

      root.add(mg);
      tutorialState.markerGroup = mg;
      mg.userData = { outRing, inRing, beam, diamond };

      // 2. Obstacle Ridge for Gravitational Jump (Step 3)
      const rockMat = material(0x654332, .85);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.65, 1.4), rockMat);
      ridge.position.copy(pos(10, -11, 0.32));
      const rRock1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55), rockMat);
      rRock1.position.set(-1.2, 0.3, 0);
      ridge.add(rRock1);
      const rRock2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48), rockMat);
      rRock2.position.set(1.2, 0.25, 0);
      ridge.add(rRock2);
      root.add(ridge);
      tutorialState.obstacleGroup = ridge;

      // Target Landing Ring (Step 3)
      const landRing = new THREE.Mesh(
        new THREE.RingGeometry(1.2, 1.45, 32),
        new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
      );
      landRing.rotation.x = -Math.PI / 2;
      landRing.position.copy(pos(14, -11, 0.04));
      landRing.visible = false;
      root.add(landRing);
      tutorialState.landingRing = landRing;

      // 3. Damaged Telemetry Pod (Step 4)
      const pod = new THREE.Group();
      pod.name = 'tutorial-telemetry-pod';
      const podBox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.7), material(0x354050, 0.6));
      podBox.position.y = 0.4;
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4), material(0x8fe7ff, 0.2, 0x113355));
      antenna.position.set(0.25, 1.1, 0);
      const beaconLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffaa44 }));
      beaconLight.position.set(0.25, 1.8, 0);
      pod.add(podBox, antenna, beaconLight);
      pod.position.copy(pos(14, -7));
      root.add(pod);
      tutorialState.pod = pod;

      // 4. Scannable Mineral Outcrop (Step 5)
      const minGroup = new THREE.Group();
      minGroup.name = 'tutorial-mineral-outcrop';
      const core = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), material(0x753b28, 0.75));
      core.position.y = 0.45;
      core.scale.set(1.2, 0.9, 1.1);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), new THREE.MeshBasicMaterial({ color: 0x8fe7ff, wireframe: true }));
      crystal.position.set(0, 1.1, 0);
      minGroup.add(core, crystal);
      minGroup.position.copy(pos(10, -4));
      root.add(minGroup);
      tutorialState.mineral = {
        group: minGroup,
        pos: new V(10, yAt(10, -4), -4),
        name: 'Martian Hematite Spherule Formation',
        catalog: {
          id: 'tutorial-hematite',
          name: 'Martian Hematite Spherule Formation',
          category: 'Geology',
          description: 'Ferric-oxide spherule deposit ideal for sensor calibration.',
          duration: 2.0,
          reward: { credits: 60, salvage: 1 }
        },
        radius: 3.5
      };

      // 5. Diagnostic Terminal (Step 8)
      const term = terminalVisual(root, 'tutorial_term', -8, -5, 0x8fe7ff, 'Access Diagnostic Terminal [E]');
      tutorialState.terminal = term;
    } catch (e) {
      console.warn('initTutorialObjects error:', e);
    }
  }

  function animateTutorialMarker(t) {
    if (!tutorialState.markerGroup || !tutorialState.markerGroup.visible) return;
    const mg = tutorialState.markerGroup;
    const u = mg.userData;
    if (u && u.outRing && u.outRing.scale) u.outRing.scale.setScalar(1 + Math.sin(t * 3.5) * 0.12);
    if (u && u.inRing) u.inRing.rotation.z = t * 1.6;
    if (u && u.diamond) {
      u.diamond.rotation.y = t * 2.2;
      u.diamond.position.y = 3.2 + Math.sin(t * 2.8) * 0.2;
    }
  }

  function formatActionHTML(step) {
    const isTouch = touchModeAuthoritative || isTouchDevice;
    switch (step.id) {
      case 'traversal':
        return isTouch
          ? '<span class="hc-tut-keycap">JOYSTICK</span> Drag Virtual Joystick to beacon'
          : '<span class="hc-tut-keycap">W</span><span class="hc-tut-keycap">A</span><span class="hc-tut-keycap">S</span><span class="hc-tut-keycap">D</span> Move to navigation beacon';
      case 'orientation':
        return isTouch
          ? '<span class="hc-tut-keycap">SWIPE</span> Drag right side to look at Spacecraft'
          : '<span class="hc-tut-keycap">MOUSE</span> Move mouse to look at Spacecraft';
      case 'jumping':
        return isTouch
          ? '<span class="hc-tut-keycap">RUN</span> + <span class="hc-tut-keycap">JUMP</span> Leap over the ridge'
          : '<span class="hc-tut-keycap">SHIFT</span> + <span class="hc-tut-keycap">SPACE</span> Sprint & leap over the ridge';
      case 'interaction':
        return isTouch
          ? '<span class="hc-tut-keycap">USE</span> Tap USE on telemetry pod'
          : '<span class="hc-tut-keycap">E</span> Interact with telemetry pod';
      case 'scanning':
        return isTouch
          ? '<span class="hc-tut-keycap">SCAN</span> Tap SCAN to analyze mineral'
          : '<span class="hc-tut-keycap">C</span> Scan mineral formation';
      case 'navigation':
        return '<span class="hc-tut-keycap">HUD</span> Follow compass pip to staging ridge';
      case 'rover':
        if (!tutorialState.roverEntered) {
          return isTouch ? '<span class="hc-tut-keycap">USE</span> Board the rover' : '<span class="hc-tut-keycap">R</span> Board the rover';
        } else if (!tutorialState.roverWayreached) {
          return isTouch ? '<span class="hc-tut-keycap">DRIVE</span> Steer rover to transit beacon' : '<span class="hc-tut-keycap">WASD</span> Drive rover to transit beacon';
        } else {
          return isTouch ? '<span class="hc-tut-keycap">EXIT</span> Exit the rover' : '<span class="hc-tut-keycap">R</span> Exit the rover';
        }
      case 'puzzle':
        return isTouch
          ? '<span class="hc-tut-keycap">USE</span> Match colored wire circuits'
          : '<span class="hc-tut-keycap">E</span> Match colored wire circuits';
      case 'repair':
        return '<span class="hc-tut-keycap">SURVEY</span> Inspect Spacecraft Ascent Engine';
      default:
        return step.action;
    }
  }

  function clearTutorialHighlights() {
    if (typeof document === 'undefined') return;
    const ids = [
      'hc-joy-zone', 'hc-btn-jump', 'hc-btn-interact', 'hc-btn-run',
      'hc-btn-scan', 'hc-btn-rover-exit', 'hc-compass-pip', 'hc-minimap',
      'hc-prompt'
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.classList) el.classList.remove('hc-tut-glow');
    });
  }

  function highlightTutorialElement(id) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(id);
    if (el && el.classList) el.classList.add('hc-tut-glow');
  }

  function highlightTutorialControls(step) {
    clearTutorialHighlights();
    const isTouch = touchModeAuthoritative || isTouchDevice;
    switch (step.control) {
      case 'movement':
        if (isTouch) highlightTutorialElement('hc-joy-zone');
        break;
      case 'jump':
        if (isTouch) {
          highlightTutorialElement('hc-btn-jump');
          highlightTutorialElement('hc-btn-run');
        }
        break;
      case 'interact':
        if (isTouch) highlightTutorialElement('hc-btn-interact');
        highlightTutorialElement('hc-prompt');
        break;
      case 'scan':
        if (isTouch) highlightTutorialElement('hc-btn-scan');
        highlightTutorialElement('hc-prompt');
        break;
      case 'navigation':
        highlightTutorialElement('hc-compass-pip');
        highlightTutorialElement('hc-minimap');
        break;
      case 'rover':
        if (tutorialState.roverWayreached) {
          highlightTutorialElement('hc-btn-rover-exit');
        } else if (!tutorialState.roverEntered) {
          if (isTouch) highlightTutorialElement('hc-btn-interact');
        } else {
          if (isTouch) highlightTutorialElement('hc-joy-zone');
        }
        break;
      case 'puzzle':
        if (isTouch) highlightTutorialElement('hc-btn-interact');
        break;
    }
  }

  function renderTutorialHUD(step, stepIdx) {
    const el = document.getElementById('hc-tutorial');
    if (!el) return;
    el.innerHTML = `
      <div class="hc-tutorial-hud-card">
        <div class="hc-tut-header-row">
          <div class="hc-tut-step-tag">
            <span class="hc-tut-ora-dot"></span>
            <span id="hc-tut-step-txt">${step.kicker}</span>
          </div>
          <button class="hc-tut-skip-btn" id="hc-tut-skip">Skip Tutorial ✕</button>
        </div>
        <div class="hc-tut-main-row">
          <div class="hc-tut-ora-badge">🤖</div>
          <div class="hc-tut-body-wrap">
            <div class="hc-tut-title" id="hc-tut-title-txt">${step.title}</div>
            <div class="hc-tut-ora-msg" id="hc-tut-ora-txt">${step.body}</div>
            <div class="hc-tut-action-bar">
              <div class="hc-tut-instruction" id="hc-tut-action-txt">${formatActionHTML(step)}</div>
              <div class="hc-tut-dist" id="hc-tut-dist-txt">--</div>
            </div>
            <div class="hc-tut-hint hc-hidden" id="hc-tut-hint-txt"></div>
            <div class="hc-tut-progress-dots" id="hc-tut-dots">
              ${TUTORIAL_STEPS.map((_, i) => `<span class="hc-tut-pdot ${i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''}"></span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
    el.classList.add('active');
    const skipBtn = document.getElementById('hc-tut-skip');
    if (skipBtn) skipBtn.onclick = skipTutorial;
  }

  let currentTutorialIndex = 0;

  function showTutorial(stepIdx) {
    currentTutorialIndex = stepIdx || 0;
    if (currentTutorialIndex < 0) currentTutorialIndex = 0;
    if (currentTutorialIndex >= TUTORIAL_STEPS.length) {
      completeTutorial();
      return;
    }
    const step = TUTORIAL_STEPS[currentTutorialIndex];
    tutorialState.active = true;
    tutorialState.stepIndex = currentTutorialIndex;
    setMobileControlsVisible(true);
    tutorialState.stepStartedAt = performance.now();
    tutorialState.hintShown = false;
    tutorialState.cameraAccumulatedYaw = 0;
    tutorialState.lastCamYaw = (HC.mouse && HC.mouse.yaw) || 0;
    tutorialState.traversedDistance = 0;
    tutorialState.lastPlayerPos = null;
    tutorialState.jumpInitiated = false;
    tutorialState.podInteracted = false;
    tutorialState.scanCompleted = false;
    tutorialState.puzzleSolved = false;

    // Orient camera toward navigation beacon on Step 1 start
    if (currentTutorialIndex === 0 && HC.mouse && HC.astronaut && HC.astronaut.group) {
      const p = player();
      const dx = 7 - p.x;
      const dz = -11 - p.z;
      if (Math.hypot(dx, dz) > 0.5) {
        HC.mouse.yaw = Math.atan2(dx, dz);
      }
    }

    // Position 3D holographic waypoint (guaranteed clear of all solids)
    if (tutorialState.markerGroup) {
      tutorialState.markerGroup.visible = true;
      const rawTarget = step.targetPos || { x: 0, z: 0 };
      const posTarget = resolveClearCheckpointPosition(rawTarget.x, rawTarget.z, 1.8);
      tutorialState.markerGroup.position.copy(pos(posTarget.x, posTarget.z));
    }

    // Landing ring visibility for step 2 (Jumping)
    if (tutorialState.landingRing) {
      tutorialState.landingRing.visible = (step.id === 'jumping');
    }

    renderTutorialHUD(step, currentTutorialIndex);
    highlightTutorialControls(step);

    // Audio & ORA spoken transmission
    if (window.HomecomingAudio) {
      if (typeof window.HomecomingAudio.play === 'function') {
        window.HomecomingAudio.play('beacon_ping');
      }
      if (typeof window.HomecomingAudio.speak === 'function') {
        window.HomecomingAudio.speak(step.body, 'ora');
      }
    }
  }

  function updateInteractiveTutorial(dt, now) {
    if (!tutorialState.active) return;
    const step = TUTORIAL_STEPS[tutorialState.stepIndex];
    if (!step) return;

    // Track surface locomotion distance in traversal step
    if (step.id === 'traversal') {
      const p = player();
      if (tutorialState.lastPlayerPos) {
        const moved = Math.hypot(p.x - tutorialState.lastPlayerPos.x, p.z - tutorialState.lastPlayerPos.z);
        if (moved > 0.001 && moved < 5.0) {
          tutorialState.traversedDistance = (tutorialState.traversedDistance || 0) + moved;
        }
      }
      tutorialState.lastPlayerPos = { x: p.x, z: p.z };
    }

    // Track camera rotation in orientation step
    if (step.id === 'orientation') {
      const curYaw = (HC.mouse && HC.mouse.yaw) || 0;
      const dyaw = Math.abs(curYaw - tutorialState.lastCamYaw);
      tutorialState.cameraAccumulatedYaw += Math.min(dyaw, 0.4);
      tutorialState.lastCamYaw = curYaw;
    }

    // Track jumping in jumping step
    if (step.id === 'jumping' && HC.isJumping) {
      tutorialState.jumpInitiated = true;
    }

    // Rover step sub-phases
    if (step.id === 'rover') {
      if (!tutorialState.roverEntered && HC.rover && HC.rover.driving) {
        tutorialState.roverEntered = true;
        if (tutorialState.markerGroup) {
          const safeWp = resolveClearCheckpointPosition(step.waypointPos.x, step.waypointPos.z, 1.8);
          tutorialState.markerGroup.position.copy(pos(safeWp.x, safeWp.z));
        }
        const actEl = document.getElementById('hc-tut-action-txt');
        if (actEl) actEl.innerHTML = formatActionHTML(step);
        highlightTutorialControls(step);
        toast('Rover boarded. Drive to the transit waypoint ahead.');
        if (window.HomecomingAudio && window.HomecomingAudio.speak) {
          window.HomecomingAudio.speak('Rover systems active. Drive to the canyon transit beacon.', 'ora');
        }
      }
      if (tutorialState.roverEntered && !tutorialState.roverWayreached && HC.rover) {
        const dr = Math.hypot(HC.rover.group.position.x - step.waypointPos.x, HC.rover.group.position.z - step.waypointPos.z);
        if (dr <= 4.5) {
          tutorialState.roverWayreached = true;
          const actEl = document.getElementById('hc-tut-action-txt');
          if (actEl) actEl.innerHTML = formatActionHTML(step);
          highlightTutorialControls(step);
          toast('Transit point reached! Stop and exit rover [R] / tap [EXIT].');
          if (window.HomecomingAudio && window.HomecomingAudio.speak) {
            window.HomecomingAudio.speak('Target reached. Disembark from the rover.', 'ora');
          }
        }
      }
      if (tutorialState.roverWayreached && HC.rover && !HC.rover.driving) {
        tutorialState.roverExited = true;
      }
    }

    // Distance display (measures against clear, accessible coordinates)
    const distEl = document.getElementById('hc-tut-dist-txt');
    if (distEl) {
      let targetCoords = step.targetPos;
      if (step.id === 'rover' && tutorialState.roverEntered && !tutorialState.roverWayreached) {
        targetCoords = step.waypointPos;
      }
      if (targetCoords) {
        const safeCoords = resolveClearCheckpointPosition(targetCoords.x, targetCoords.z, 1.8);
        const p = player();
        const d = Math.hypot(p.x - safeCoords.x, p.z - safeCoords.z);
        distEl.textContent = d < 99 ? d.toFixed(1) + 'm' : '';
      } else {
        distEl.textContent = '';
      }
    }

    // Struggle hint timer
    if (!tutorialState.hintShown && (now - tutorialState.stepStartedAt) > 9000) {
      tutorialState.hintShown = true;
      const hintEl = document.getElementById('hc-tut-hint-txt');
      if (hintEl) {
        hintEl.textContent = 'ORA HINT: ' + step.hint;
        hintEl.classList.remove('hc-hidden');
      }
    }

    // Check step completion
    if (typeof step.check === 'function' && step.check(dt, now)) {
      advanceTutorialStep();
    }
  }

  function advanceTutorialStep() {
    if (!tutorialState.active) return;
    const curStep = TUTORIAL_STEPS[tutorialState.stepIndex];
    if (window.HomecomingAudio) {
      if (typeof window.HomecomingAudio.play === 'function') {
        window.HomecomingAudio.play('puzzle_click');
      }
      if (typeof window.HomecomingAudio.speak === 'function') {
        window.HomecomingAudio.speak('Calibration confirmed.', 'ora');
      }
    }
    toast('✓ ' + (curStep ? curStep.title : 'Step') + ' verified.');
    const nextIdx = tutorialState.stepIndex + 1;
    if (nextIdx < TUTORIAL_STEPS.length) {
      showTutorial(nextIdx);
    } else {
      completeTutorial();
    }
  }

  function completeTutorial() {
    tutorialState.active = false;
    clearTutorialHighlights();
    if (tutorialState.markerGroup) tutorialState.markerGroup.visible = false;
    if (tutorialState.landingRing) tutorialState.landingRing.visible = false;
    const el = document.getElementById('hc-tutorial');
    if (el) el.classList.remove('active');
    if (HC.save) {
      HC.save.tutorialCompleted = true;
      persist();
    }
    if (window.HomecomingAudio) {
      if (typeof window.HomecomingAudio.play === 'function') {
        window.HomecomingAudio.play('mission_complete');
      }
      if (typeof window.HomecomingAudio.speak === 'function') {
        window.HomecomingAudio.speak('All systems operational. Good luck, Commander.', 'ora');
      }
    }
    toast('Tutorial completed! Directive active: ' + ((mission() && mission().name) || 'Exploration'));
  }

  function skipTutorial() {
    tutorialState.active = false;
    clearTutorialHighlights();
    if (tutorialState.markerGroup) tutorialState.markerGroup.visible = false;
    if (tutorialState.landingRing) tutorialState.landingRing.visible = false;
    const el = document.getElementById('hc-tutorial');
    if (el) el.classList.remove('active');
    if (HC.save) {
      HC.save.tutorialCompleted = true;
      persist();
    }
    if (window.HomecomingAudio && typeof window.HomecomingAudio.stopSpeech === 'function') {
      window.HomecomingAudio.stopSpeech();
    }
    toast('Tutorial skipped. Directive active: ' + ((mission() && mission().name) || 'Exploration'));
  }

  /* ─────────────────────────────────────────────────────────────────────
     MISSIONS — full 30-mission campaign across all 6 locations
     ───────────────────────────────────────────────────────────────────── */
  const MISSIONS = [
    // Mars (5 missions)
    { planet: 0, id: 'wake', name: 'Wake Up, Commander', short: 'Emergency power', objective: 'Restore emergency power at the crash terminal.', target: 'power', puzzle: 'wiring', type: 'repair', reward: { credits: 80, salvage: 1 }, ora: 'Suit telemetry is stable. Restore power at the emergency terminal.' },
    { planet: 0, id: 'signal', name: 'The Missing Signal', short: 'Damaged comms', objective: 'Reach the damaged communications terminal and recover the signal.', target: 'comms', puzzle: 'signal', type: 'communications', reward: { credits: 110, salvage: 1 }, ora: 'A narrow-band transmission is repeating from the western ridge.' },
    { planet: 0, id: 'ghosts', name: 'Ghosts of the Outpost', short: 'Outpost terminal', objective: 'Disable the security drone with EMP, then access the abandoned outpost.', target: 'outpost', puzzle: 'evidence', type: 'exploration', reward: { credits: 160, salvage: 2 }, ora: 'Security hardware is active. Your EMP tool will temporarily disable a nearby drone.' },
    { planet: 0, id: 'shipbreaker', name: 'Shipbreaker', short: 'Engine components', objective: 'Locate three engine components around the crash field.', target: 'components', puzzle: 'circuit', type: 'salvage', reward: { credits: 220, salvage: 2 }, ora: 'The ascent engine needs three scattered components before I can route power.' },
    { planet: 0, id: 'departure', name: 'The First Departure', short: 'Orbital relay', objective: 'Activate the orbital relay and complete launch diagnostics.', target: 'relay', puzzle: 'sequence', type: 'navigation', reward: { credits: 300, salvage: 3 }, ora: 'The relay is receiving a signal that should not exist. Bring it online.' },
    // Phobos (5 missions)
    { planet: 1, id: 'dead-dock', name: 'Dead Dock', short: 'Restore docking clamps', objective: 'Bring the abandoned Phobos docking array back online.', target: 'dock', puzzle: 'routing', type: 'repair', reward: { credits: 380, salvage: 2 }, ora: 'Phobos is barely holding orbit. Restore the docking power grid.' },
    { planet: 1, id: 'silent-cargo', name: 'Silent Cargo', short: 'Inspect cargo modules', objective: 'Access the sealed cargo bay and log its contents.', target: 'cargo', puzzle: 'code', type: 'exploration', reward: { credits: 400, salvage: 2 }, ora: 'The cargo manifest is encrypted. Decode the access sequence.' },
    { planet: 1, id: 'security-sweep', name: 'Security Sweep', short: 'Clear security lockout', objective: 'Disable the station security grid to access restricted corridors.', target: 'security', puzzle: 'circuit', type: 'hazard', reward: { credits: 420, salvage: 2 }, ora: 'Automated defences are active. Route the override through the circuit panel.' },
    { planet: 1, id: 'reactor-puzzle', name: 'The Reactor Puzzle', short: 'Restart reactor', objective: 'Restore the station reactor to regain full system access.', target: 'reactor', puzzle: 'sequence', type: 'repair', reward: { credits: 440, salvage: 3 }, ora: 'The reactor is cold but intact. Follow the startup sequence exactly.' },
    { planet: 1, id: 'broken-coordinates', name: 'Broken Coordinates', short: 'Recover navigation data', objective: 'Decode the relay coordinates buried in the station debris.', target: 'coordinates', puzzle: 'evidence', type: 'science', reward: { credits: 460, salvage: 3 }, ora: 'The coordinates point toward Europa. The signal is moving again.' },
    // Europa (5 missions)
    { planet: 2, id: 'white-silence', name: 'White Silence', short: 'Survey ice surface', objective: 'Deploy the surface scanner at the research base entrance.', target: 'surface-scan', puzzle: 'pattern', type: 'science', reward: { credits: 490, salvage: 3 }, ora: 'Europa is silent on every frequency. Deploy the scanner to wake it up.' },
    { planet: 2, id: 'under-ice', name: 'Under Ice', short: 'Scan the ice shell', objective: 'Calibrate the sub-ice scanner at the research base.', target: 'scanner', puzzle: 'signal', type: 'science', reward: { credits: 510, salvage: 3 }, ora: 'A thermal cavity beneath the ice is carrying the transmission.' },
    { planet: 2, id: 'specimen-09', name: 'Specimen 09', short: 'Biological lab access', objective: 'Access the frozen research lab and catalogue specimen 09.', target: 'specimen', puzzle: 'code', type: 'exploration', reward: { credits: 530, salvage: 3 }, ora: 'The specimen records were deliberately deleted. Recover the original data.' },
    { planet: 2, id: 'cold-storage', name: 'Cold Storage', short: 'Restore cryo-array', objective: 'Restore power to the cold storage cryo-array.', target: 'cryo', puzzle: 'circuit', type: 'repair', reward: { credits: 550, salvage: 3 }, ora: 'Cryo-storage is losing power. Route emergency reserves to the array.' },
    { planet: 2, id: 'signal-beneath', name: 'The Signal Beneath', short: 'Thermal relay', objective: 'Route power through the frozen thermal relay.', target: 'thermal', puzzle: 'wiring', type: 'hazard', reward: { credits: 570, salvage: 3 }, ora: 'Keep the relay stable. The ice shelf is losing integrity.' },
    // Titan (5 missions)
    { planet: 3, id: 'amber-skies', name: 'Amber Skies', short: 'Atmospheric survey', objective: 'Deploy the atmospheric probe at the survey point.', target: 'atmo-probe', puzzle: 'signal', type: 'science', reward: { credits: 600, salvage: 3 }, ora: 'Titan\'s atmosphere is thick. Align the probe to cut through the haze.' },
    { planet: 3, id: 'fuel-road', name: 'Fuel for the Road', short: 'Fuel network', objective: 'Synchronise Titan\'s methane fuel manifold.', target: 'fuel', puzzle: 'routing', type: 'resource', reward: { credits: 650, salvage: 4 }, ora: 'The fuel is clean enough for one last long burn.' },
    { planet: 3, id: 'missing-miners', name: 'Missing Miners', short: 'Mining crew logs', objective: 'Investigate the abandoned mining camp and find crew records.', target: 'miners', puzzle: 'evidence', type: 'exploration', reward: { credits: 680, salvage: 4 }, ora: 'The mining crew left in a hurry. Their logs may explain why.' },
    { planet: 3, id: 'the-refinery', name: 'The Refinery', short: 'Refinery restart', objective: 'Restart the methane refinery processing core.', target: 'refinery-core', puzzle: 'circuit', type: 'repair', reward: { credits: 700, salvage: 4 }, ora: 'The refinery core needs a complete circuit rebuild before it can operate.' },
    { planet: 3, id: 'familiar-voice', name: 'A Familiar Voice', short: 'Refinery signal', objective: 'Align the refinery transmission with ORA\'s signal.', target: 'refinery', puzzle: 'signal', type: 'communications', reward: { credits: 720, salvage: 4 }, ora: 'The voice on the signal knows the route home.' },
    // Ceres (5 missions)
    { planet: 4, id: 'graveyard', name: 'Graveyard of Stars', short: 'Survey wreck field', objective: 'Chart the debris field and locate the primary wreck.', target: 'wreck-survey', puzzle: 'pattern', type: 'exploration', reward: { credits: 760, salvage: 4 }, ora: 'Dozens of derelict ships. One of them is ours. Find the primary hull.' },
    { planet: 4, id: 'black-box', name: 'The Black Box', short: 'Flight recorder', objective: 'Recover the original mission\'s flight recorder from the wreck.', target: 'black-box', puzzle: 'code', type: 'salvage', reward: { credits: 800, salvage: 5 }, ora: 'The black box should contain the last navigation coordinates before the accident.' },
    { planet: 4, id: 'echo-network', name: 'Echo Network', short: 'Relay network', objective: 'Reactivate the deep-space echo relay network.', target: 'echo-relay', puzzle: 'routing', type: 'communications', reward: { credits: 840, salvage: 5 }, ora: 'The echo network carried the signal outward. Reverse its path.' },
    { planet: 4, id: 'the-core', name: 'The Core', short: 'Central processor', objective: 'Access the derelict station core and extract navigation matrices.', target: 'core-access', puzzle: 'circuit', type: 'science', reward: { credits: 880, salvage: 5 }, ora: 'The core processor has the homeward vector. Route power carefully.' },
    { planet: 4, id: 'homeward-vector', name: 'The Homeward Vector', short: 'Final coordinates', objective: 'Compile the homeward navigation solution from all collected data.', target: 'nav-compile', puzzle: 'sequence', type: 'navigation', reward: { credits: 920, salvage: 5 }, ora: 'All the data converges. Run the final compilation sequence.' },
    // Earth (5 missions)
    { planet: 5, id: 'last-burn', name: 'Last Burn', short: 'Landing guidance', objective: 'Complete Earth landing diagnostics at the guidance beacon.', target: 'guidance', puzzle: 'sequence', type: 'navigation', reward: { credits: 950, salvage: 5 }, ora: 'Home is in range. Run the final landing sequence.' },
    { planet: 5, id: 'radio-silence', name: 'Radio Silence', short: 'Comms restoration', objective: 'Restore mission control communications.', target: 'earth-comms', puzzle: 'signal', type: 'communications', reward: { credits: 970, salvage: 5 }, ora: 'Mission control is broadcasting but our receiver is damaged. Tune it.' },
    { planet: 5, id: 'reentry', name: 'Re-entry', short: 'Heat shield check', objective: 'Complete the heat shield diagnostic before atmospheric entry.', target: 'heat-shield', puzzle: 'wiring', type: 'repair', reward: { credits: 990, salvage: 5 }, ora: 'Heat shield integrity is critical. Every wire must be connected.' },
    { planet: 5, id: 'landing', name: 'The Landing', short: 'Final approach', objective: 'Execute the final landing approach.', target: 'landing-pad', puzzle: 'routing', type: 'navigation', reward: { credits: 1000, salvage: 5 }, ora: 'Final approach. Route power to the landing thrusters in sequence.' },
    { planet: 5, id: 'signal-end', name: 'The Signal Isn\'t Over', short: 'Final signal', objective: 'Investigate the final transmission.', target: 'final-signal', puzzle: 'evidence', type: 'revelation', reward: { credits: 1200, salvage: 6 }, ora: 'Commander... I\'m receiving something that shouldn\'t be possible.' }
  ];

  /* ─────────────────────────────────────────────────────────────────────
     ORA — Contextual dialogue system
     ───────────────────────────────────────────────────────────────────── */
  const ORA_LINES = {
    discovery: [
      'Interesting. This data fragment doesn\'t match any known expedition protocol.',
      'Commander, this sample contains trace elements inconsistent with natural formation.',
      'The composition of this material suggests it was manufactured, not geological.',
      'ORA log: discovery catalogued. Cross-referencing with expedition database.'
    ],
    travel: {
      'mars-phobos': 'Phobos is barely 6,000 kilometres away. The signal\'s echo originated there.',
      'phobos-europa': 'Europa is 550 million kilometres distant. The signal is pulling us deeper into the outer system.',
      'europa-titan': 'Titan orbits Saturn. The expedition never planned to go this far.',
      'titan-ceres': 'Ceres sits in the asteroid belt. The graveyard of abandoned missions.',
      'ceres-earth': 'All navigation data compiled. The homeward vector is confirmed. We\'re going home, Commander.'
    },
    arrival: {
      mars: 'Mars orbital insertion confirmed. Telemetry synced. The red silence remains unbroken.',
      phobos: 'Phobos Station: last serviced four years ago. The docking array is dark.',
      europa: 'Europa surface temperature: minus 160 Celsius. Suit thermal management is active.',
      titan: 'Titan atmosphere: 95% nitrogen, 5% methane. Visibility: limited. Stay close to beacons.',
      ceres: 'Multiple derelict signatures. The wreck field extends for kilometres.',
      earth: 'Earth. I can see the blue from here. We\'re almost home, Commander.'
    },
    hints: {
      stuck: 'The active waypoint is on your HUD compass. Follow the directional arrow.',
      rover: 'The rover can cover ground faster. Press R near it to board.',
      emp: 'Security drones can be disabled with the EMP tool. Press F when in range.',
      puzzle: 'Each terminal requires a specific diagnostic. Study the instructions carefully.',
      components: 'Engine components are scattered around the crash field. Check your minimap.'
    },
    ending: [
      'Commander, the signal... it\'s not coming from where I expected.',
      'The transmission source is not extraterrestrial. It\'s terrestrial. It\'s coming from Earth.',
      'But that\'s impossible. This signal has been broadcasting for at least seven years.',
      'Before the expedition. Before the mission was even approved.',
      'Someone — or something — knew we would be here. Knew we would follow it home.',
      'I cannot explain this, Commander. But I believe the signal was never meant to lead us away.',
      'It was meant to bring us back.',
      'The signal isn\'t over. It\'s just beginning.'
    ]
  };

  /* Audio log system — optional discoverable content */
  const AUDIO_LOGS = {
    mars: [
      { id: 'log-mars-1', title: 'Expedition Day 1', text: '"Landing was rough. Hull took more damage than projected. Ramos says the nav computer is scrambled. We\'re on our own until comms are restored."', x: -18, z: 5 },
      { id: 'log-mars-2', title: 'Expedition Day 14', text: '"The signal started three days ago. Low frequency, repeating. ORA can\'t identify it. Ramos thinks it\'s geological. I\'m not so sure."', x: 22, z: -8 },
      { id: 'log-mars-3', title: 'Commander\'s Personal Log', text: '"If we don\'t fix the ascent engine, we die here. It\'s that simple. But the signal... it\'s getting louder. Almost like it wants us to follow it."', x: -8, z: 30 }
    ],
    phobos: [
      { id: 'log-phobos-1', title: 'Station Log 7-Alpha', text: '"Docking clamp failure on Bay 3. Automated repair drones are offline. Station is losing orbital stability."', x: -20, z: 12 },
      { id: 'log-phobos-2', title: 'Cargo Manifest Note', text: '"Classified cargo module sealed by Mars Command. Contents: navigation matrices for locations not on any chart."', x: 35, z: -15 }
    ],
    europa: [
      { id: 'log-europa-1', title: 'Research Note: Specimen 09', text: '"The ice sample from depth 4,200 metres contains crystalline structures. They are not ice. They are not mineral. I don\'t know what they are."', x: -25, z: 18 },
      { id: 'log-europa-2', title: 'Dr. Vasquez Personal Log', text: '"The signal is coming from beneath us. Under the ice. Under the ocean. Something is down there, and it\'s been waiting."', x: 15, z: -28 }
    ],
    titan: [
      { id: 'log-titan-1', title: 'Mining Crew Report', text: '"Methane extraction nominal until 0300. Then the ground shook. Not an earthquake — Titan doesn\'t have those. The miners evacuated."', x: -30, z: -10 },
      { id: 'log-titan-2', title: 'Refinery Foreman\'s Note', text: '"The thermal regulator is compatible with expedition hardware. Someone designed it that way. On purpose."', x: 25, z: 22 }
    ],
    ceres: [
      { id: 'log-ceres-1', title: 'Black Box Fragment', text: '"...mayday. Navigation failure. All coordinates show the same destination. Not possible. Every route leads to—" [RECORDING CORRUPTED]', x: -15, z: -20 },
      { id: 'log-ceres-2', title: 'Echo Network Log', text: '"The echo relay received its first signal seven years before any human transmitter was in range. The signal was already here."', x: 30, z: 8 }
    ],
    earth: [
      { id: 'log-earth-1', title: 'Mission Control Transcript', text: '"Welcome home, Commander. We have questions. The signal you followed — we\'ve been receiving it too. For seven years."', x: 18, z: -15 }
    ]
  };

  
  /* ─────────────────────────────────────────────────────────────────────
     SIGNAL FRAGMENTS CATALOG — 18 persistent story lore collectibles
     (3 per planet across Mars, Phobos, Europa, Titan, Ceres, Earth)
     ───────────────────────────────────────────────────────────────────── */
  const SIGNAL_FRAGMENTS = [
    // Mars
    {
      id: 'frag-mars-1',
      planet: 'mars',
      title: 'Transmission Echo Alpha // Carrier Lock',
      x: -24, z: -12,
      lore: 'Expedition Chrono -412: "The carrier wave is not a broadcast; it\'s an echo. It bounced off Olympus Mons before returning to the orbital array. Someone mapped this surface before humanity ever reached space."'
    },
    {
      id: 'frag-mars-2',
      planet: 'mars',
      title: 'Telemetry Fragment Beta // Vector Origin',
      x: 18, z: 28,
      lore: 'ORA Sub-Routine 9: "Signal telemetry exhibits sub-quantum entanglement. The broadcast vector does not originate from a single point; it traces a homeward return trajectory connecting outer planetary Lagrange points."'
    },
    {
      id: 'frag-mars-3',
      planet: 'mars',
      title: 'Ares Deep-Archive // Ramos Memo',
      x: 36, z: -15,
      lore: 'Chief Engineer Ramos: "We thought the ascent engine failed from dust ingress. But looking at the bus telemetry, the guidance computer rejected our ignition command. It locked onto an external navigation pulse."'
    },

    // Phobos
    {
      id: 'frag-phobos-1',
      planet: 'phobos',
      title: 'Stickney Array Log // Phobos Relay',
      x: -18, z: 22,
      lore: 'Station Automated Sweep: "Phobos orbital decay monitored at standard delta. Unidentified pulse detected from Stickney crater rim every 142.6 minutes. Harmonic matches Europa\'s orbital resonance."'
    },
    {
      id: 'frag-phobos-2',
      planet: 'phobos',
      title: 'Sealed Cargo Dispatch // Black Box 4',
      x: 25, z: 8,
      lore: 'Classified Manifest: "Container 09 contains recovered sensor cores from the outer boundary probes. Every unit recorded identical encrypted strings before telemetry cut out."'
    },
    {
      id: 'frag-phobos-3',
      planet: 'phobos',
      title: 'Orbital Sentry Transcript // Ghost Ping',
      x: -12, z: -28,
      lore: 'ORA Internal Diagnostic: "The ghost ping received by Bay 3 was not an inbound craft. It was an outbound acknowledgment ping — as if awaiting confirmation of our arrival."'
    },

    // Europa
    {
      id: 'frag-europa-1',
      planet: 'europa',
      title: 'Sub-Ice Hydrophone Record // Deep Harmonic',
      x: -20, z: -15,
      lore: 'Dr. Vasquez Log: "Under 12 kilometers of convective brine, acoustic arrays picked up rhythmic pulses. Not thermal cracking. Not cetacean. It is structured binary at 432 Hz."'
    },
    {
      id: 'frag-europa-2',
      planet: 'europa',
      title: 'Cryo-Drill Core Telemetry // Isotope Anomaly',
      x: 28, z: 16,
      lore: 'Field Analysis: "Ice cylinder 42 contains micro-filaments of synthetic graphene and noble metal alloys dating back over 70,000 years. Manufactured geometry preserved in cryogenic suspension."'
    },
    {
      id: 'frag-europa-3',
      planet: 'europa',
      title: 'Expedition Dispatch // The Abyssal Beacon',
      x: -10, z: 32,
      lore: 'Commander\'s Reflection: "The signal on Europa doesn\'t warn us away from the ocean depths. It serves as a navigational waystation, routing signals outward toward the Saturnian moons."'
    },

    // Titan
    {
      id: 'frag-titan-1',
      planet: 'titan',
      title: 'Methane Basin Survey // Kraken Telemetry',
      x: -16, z: 26,
      lore: 'Refinery Survey 3B: "Methane littoral zones show anomalous surface tension. Subsurface radar indicates structured geometry resting beneath the liquid hydrocarbon shelf."'
    },
    {
      id: 'frag-titan-2',
      planet: 'titan',
      title: 'Atmospheric Probe Decrypt // Nitrogen Haze',
      x: 22, z: -20,
      lore: 'ORA Atmospheric Analysis: "High-altitude tholin particles are ionizing in precise geometric bands. The atmosphere itself is acting as an ultra-low frequency waveguide for the transmission."'
    },
    {
      id: 'frag-titan-3',
      planet: 'titan',
      title: 'Mining Outpost Memory Reel // Evacuation',
      x: -32, z: -18,
      lore: 'Outpost Foreman: "The sirens didn\'t sound because of a methane leak. The communications console lit up with incoming transmissions from Ceres — using our own expedition security codes."'
    },

    // Ceres
    {
      id: 'frag-ceres-1',
      planet: 'ceres',
      title: 'Occator Facula Analysis // Salt Domes',
      x: -22, z: -14,
      lore: 'Derelict Scientific Terminal: "Sodium carbonate deposits at Occator Crater are acting as dielectric antennas. The bright spots are not merely salt — they are microwave resonator nodes."'
    },
    {
      id: 'frag-ceres-2',
      planet: 'ceres',
      title: 'Astraea Black Box Log // The Graveyard',
      x: 26, z: 20,
      lore: 'Wreckage Flight Recorder: "We found the derelict convoy. None of the ships suffered collisions. Every vessel\'s main drive shut down simultaneously when the Earthward vector was broadcast."'
    },
    {
      id: 'frag-ceres-3',
      planet: 'ceres',
      title: 'Station Core Decryption // The Vector',
      x: -14, z: 34,
      lore: 'Extracted Matrix: "The navigational beacon is pointing straight toward the inner solar system. Not outward to the stars. The message was sent from where we started."'
    },

    // Earth
    {
      id: 'frag-earth-1',
      planet: 'earth',
      title: 'Ground Station Genesis Archive // Day Zero',
      x: -20, z: -18,
      lore: 'Director Mitchell, 7 Years Ago: "The transmission began seven months before Project Homecoming was chartered. We didn\'t build the expedition to search for the signal; the signal commissioned the expedition."'
    },
    {
      id: 'frag-earth-2',
      planet: 'earth',
      title: 'Mission Control Deep Storage // Signal Cycle',
      x: 22, z: 24,
      lore: 'Telemetry Chief Kowalski: "Every planetary outpost we established along the route — Mars, Phobos, Europa, Titan, Ceres — was secretly aligned with pre-existing harmonic nodes detected in 2019."'
    },
    {
      id: 'frag-earth-3',
      planet: 'earth',
      title: 'Genesis Beacon Master Key // The Loop',
      x: -12, z: 28,
      lore: 'Final Archive Entry: "The signal was never a mystery to be solved. It was a homeward homing carrier, ensuring that whoever ventured out into the dark would always be guided back to Earth."'
    }
  ];

  /* ─────────────────────────────────────────────────────────────────────
     MILESTONE REWARDS — Signal Fragment Collection Tiers
     ───────────────────────────────────────────────────────────────────── */
  const MILESTONE_REWARDS = [
    { count: 3, id: 'reward-optics', title: 'Spectrum HUD Scanner Optics', desc: '+25% scan acquisition speed and extended detection range.' },
    { count: 6, id: 'reward-thermal', title: 'Cryo-Thermal Suit Lining', desc: '+20% environmental thermal resistance across all planetary surfaces.' },
    { count: 9, id: 'reward-thrusters', title: 'Rover Ion Pulse Thrusters', desc: '+25% rover boost acceleration and energy efficiency.' },
    { count: 12, id: 'reward-decryption', title: 'Deep-Space Decryption Module', desc: 'Reveals hidden planetary signal coordinates and contracts.' },
    { count: 15, id: 'reward-visor', title: 'Gold-Leaf Astronaut Visor', desc: 'Reflective ceremonial gold EVA helmet visor with radiation shielding.' },
    { count: 18, id: 'reward-archive', title: 'Genesis Master Archive & Cosmic Trim', desc: 'Full transmission archive deciphered, plus cosmetic cosmic rover trim.' }
  ];

  /* ─────────────────────────────────────────────────────────────────────
     SCANNER CATALOG — 30 scannable targets (5 per planet across 6 worlds)
     ───────────────────────────────────────────────────────────────────── */
  const SCAN_CATALOG = [
    // Mars
    { id: 'scan-mars-regolith', planet: 'mars', name: 'Basaltic Iron Regolith', category: 'Geology', x: -15, z: 10, radius: 3.2, duration: 2.2, description: 'Ferric-oxide regolith rich in hematite spherules exhibiting anomalous remnant magnetism.', reward: { credits: 80, salvage: 1 } },
    { id: 'scan-mars-beacon', planet: 'mars', name: 'Ares Emergency Transponder', category: 'Technology', x: 12, z: -18, radius: 3.2, duration: 2.5, description: 'Derelict transponder mast pulsing on UHF channel 14. Electronics weathered but salvageable.', reward: { credits: 90, salvage: 1 } },
    { id: 'scan-mars-crater', planet: 'mars', name: 'Impact Fracture S-4', category: 'Geology', x: -28, z: -25, radius: 3.2, duration: 2.4, description: 'Tectonic fissure displaying mineralized hydrothermal vein deposits from Mars\' warmer epoch.', reward: { credits: 85, salvage: 1 } },
    { id: 'scan-mars-solar', planet: 'mars', name: 'Photovoltaic Mast Array', category: 'Technology', x: 26, z: 14, radius: 3.2, duration: 2.6, description: 'Photovoltaic tracking array coated in regolith dust. Solid-state circuitry remains functional.', reward: { credits: 95, salvage: 1 } },
    { id: 'scan-mars-monolith', planet: 'mars', name: 'Subterranean Resonance Outcrop', category: 'Anomaly', x: 2, z: 32, radius: 3.5, duration: 3.0, description: 'Dense basalt pillar resonating at 432 Hz in harmonic alignment with outer system beacons.', reward: { credits: 120, salvage: 2 } },

    // Phobos
    { id: 'scan-phobos-crust', planet: 'phobos', name: 'Carbonaceous Regolith Mantle', category: 'Geology', x: -16, z: 12, radius: 3.2, duration: 2.2, description: 'Highly porous, low-density carbonaceous matrix with volatile water ice pockets.', reward: { credits: 90, salvage: 1 } },
    { id: 'scan-phobos-clamp', planet: 'phobos', name: 'Orbital Docking Coupler', category: 'Technology', x: 15, z: 20, radius: 3.2, duration: 2.5, description: 'Heavy titanium docking clamp showing mechanical fatigue from abrupt separation.', reward: { credits: 100, salvage: 1 } },
    { id: 'scan-phobos-dish', planet: 'phobos', name: 'Microwave Receiver Horn', category: 'Technology', x: -25, z: -16, radius: 3.2, duration: 2.6, description: 'Cryo-cooled parabolic receiver aligned along the Jupiter transfer vector.', reward: { credits: 105, salvage: 1 } },
    { id: 'scan-phobos-crevasse', planet: 'phobos', name: 'Stickney Groove Fracture', category: 'Geology', x: 22, z: -24, radius: 3.2, duration: 2.4, description: 'Radial fracture system formed during the catastrophic Stickney impact event.', reward: { credits: 95, salvage: 1 } },
    { id: 'scan-phobos-echo', planet: 'phobos', name: 'Autonomous Echo Relay', category: 'Signal', x: 0, z: 26, radius: 3.5, duration: 3.0, description: 'Unmarked telemetry repeater station caching encrypted subspace transmissions.', reward: { credits: 130, salvage: 2 } },

    // Europa
    { id: 'scan-europa-crust', planet: 'europa', name: 'Conamara Chaos Rafts', category: 'Geology', x: -18, z: 8, radius: 3.2, duration: 2.2, description: 'Tilted ice blocks rafted over slushy convective upwellings from the subsurface ocean.', reward: { credits: 100, salvage: 1 } },
    { id: 'scan-europa-cryo', planet: 'europa', name: 'Cryo-Geyser Salt Vent', category: 'Science', x: 16, z: -15, radius: 3.2, duration: 2.5, description: 'Sublimating vent depositing magnesium sulfate and organic precursors onto surface ice.', reward: { credits: 110, salvage: 1 } },
    { id: 'scan-europa-drill', planet: 'europa', name: 'Thermal Sub-Surface Core Drill', category: 'Technology', x: -26, z: 24, radius: 3.2, duration: 2.7, description: 'Abandoned melt-probe drill assembly engineered for ice penetration to 10 km depth.', reward: { credits: 115, salvage: 1 } },
    { id: 'scan-europa-crystals', planet: 'europa', name: 'Anomalous Hexagonal Brine Crystals', category: 'Science', x: 25, z: 22, radius: 3.2, duration: 2.5, description: 'Hyper-pure crystalline structures exhibiting lattice geometry unseen in natural ice.', reward: { credits: 110, salvage: 1 } },
    { id: 'scan-europa-abyss', planet: 'europa', name: 'Abyssal Acoustic Receiver', category: 'Signal', x: -8, z: -32, radius: 3.5, duration: 3.0, description: 'Deep hydrophone interface detecting low-frequency acoustic pulses from the planetary mantle.', reward: { credits: 140, salvage: 2 } },

    // Titan
    { id: 'scan-titan-shallows', planet: 'titan', name: 'Methane Littoral Shallows', category: 'Geology', x: -20, z: -12, radius: 3.2, duration: 2.3, description: 'Liquid ethane-methane tide line with dissolved atmospheric hydrocarbons and soot.', reward: { credits: 110, salvage: 1 } },
    { id: 'scan-titan-slush', planet: 'titan', name: 'Ammonia-Water Cryovolcanic Mound', category: 'Geology', x: 18, z: 20, radius: 3.2, duration: 2.4, description: 'Viscous cryolava flows slowly freezing in Titan\'s minus 179 Celsius atmosphere.', reward: { credits: 115, salvage: 1 } },
    { id: 'scan-titan-separator', planet: 'titan', name: 'Cryogenic Separator Column', category: 'Technology', x: -25, z: 18, radius: 3.2, duration: 2.6, description: 'Industrial gas processing unit with intact cryogenic valves and compression manifolds.', reward: { credits: 120, salvage: 1 } },
    { id: 'scan-titan-mast', planet: 'titan', name: 'High-Gain Atmospheric Mast', category: 'Technology', x: 24, z: -18, radius: 3.2, duration: 2.7, description: 'Directional telemetry mast constructed from high-tensile carbon composite.', reward: { credits: 125, salvage: 1 } },
    { id: 'scan-titan-strata', planet: 'titan', name: 'Pre-Biotic Tholin Sediments', category: 'Science', x: 0, z: -28, radius: 3.5, duration: 3.0, description: 'Fine organic aerosol fallout containing purines, pyrimidines, and complex amino chains.', reward: { credits: 150, salvage: 2 } },

    // Ceres
    { id: 'scan-ceres-facula', planet: 'ceres', name: 'Occator Sodium Carbonate Dome', category: 'Geology', x: -15, z: -18, radius: 3.2, duration: 2.3, description: 'Hydrothermally deposited sodium carbonate domes shining with 50% albedo.', reward: { credits: 120, salvage: 1 } },
    { id: 'scan-ceres-mantle', planet: 'ceres', name: 'Relict Brine Seepage', category: 'Science', x: 22, z: 12, radius: 3.2, duration: 2.5, description: 'Subsurface brine effusion leaving freshly crystallized salt efflorescence on the crater floor.', reward: { credits: 125, salvage: 1 } },
    { id: 'scan-ceres-freighter', planet: 'ceres', name: 'Astraea Convoy Wreckage', category: 'Technology', x: -28, z: 16, radius: 3.2, duration: 2.8, description: 'Shattered cargo pod from an automated supply freighter. Internal components intact.', reward: { credits: 135, salvage: 2 } },
    { id: 'scan-ceres-beacon', planet: 'ceres', name: 'Belt Navigation Transponder', category: 'Technology', x: 18, z: -26, radius: 3.2, duration: 2.7, description: 'Solar-powered transponder unit broadcasting orbital ephemeris data to belt vessels.', reward: { credits: 130, salvage: 1 } },
    { id: 'scan-ceres-core', planet: 'ceres', name: 'Derelict AI Navigation Module', category: 'Lore', x: 5, z: 28, radius: 3.5, duration: 3.0, description: 'Hardened optical memory core storing navigational waypoints for the Earth return journey.', reward: { credits: 160, salvage: 2 } },

    // Earth
    { id: 'scan-earth-guidance', planet: 'earth', name: 'Orbital Guidance Mast', category: 'Technology', x: -16, z: 15, radius: 3.2, duration: 2.3, description: 'Precision laser telemetry mast providing approach vectors for atmospheric re-entry.', reward: { credits: 140, salvage: 1 } },
    { id: 'scan-earth-dish', planet: 'earth', name: 'Deep Space Tracking Dish', category: 'Technology', x: 20, z: -14, radius: 3.2, duration: 2.6, description: 'Parabolic Cassegrain antenna array that monitored the expedition throughout the solar system.', reward: { credits: 150, salvage: 2 } },
    { id: 'scan-earth-archive', planet: 'earth', name: 'Expedition Genesis Server Rack', category: 'Lore', x: -22, z: -20, radius: 3.2, duration: 2.8, description: 'Mission Control data server housing original charters and early telemetry logs from 7 years ago.', reward: { credits: 160, salvage: 2 } },
    { id: 'scan-earth-tiles', planet: 'earth', name: 'Ablative Thermal Protection Matrix', category: 'Technology', x: 24, z: 18, radius: 3.2, duration: 2.5, description: 'Reinforced carbon-carbon heat shield segment recovered after successful atmospheric entry.', reward: { credits: 145, salvage: 1 } },
    { id: 'scan-earth-beacon', planet: 'earth', name: 'The Genesis Carrier Beacon', category: 'Signal', x: 0, z: -32, radius: 3.5, duration: 3.2, description: 'The master transmitter broadcasting the homeward carrier wave across the solar system.', reward: { credits: 200, salvage: 3 } }
  ];

  /* ─────────────────────────────────────────────────────────────────────
     OPTIONAL PLANETARY CONTRACTS POOL — Repeatable and deterministic
     ───────────────────────────────────────────────────────────────────── */
  const CONTRACTS_POOL = [
    // Mars
    { id: 'contract-mars-geo', planet: 'mars', title: 'Mars Geological Survey', desc: 'Scan Basaltic Iron Regolith and Impact Fracture S-4.', targetScans: ['scan-mars-regolith', 'scan-mars-crater'], reward: { credits: 120, salvage: 1 } },
    { id: 'contract-mars-tech', planet: 'mars', title: 'Ares Transponder Analysis', desc: 'Scan the Ares Emergency Transponder mast.', targetScans: ['scan-mars-beacon'], reward: { credits: 100, salvage: 1 } },
    { id: 'contract-mars-monolith', planet: 'mars', title: 'Resonance Beacon Inquiry', desc: 'Locate and scan the Subterranean Resonance Outcrop.', targetScans: ['scan-mars-monolith'], reward: { credits: 140, salvage: 2 } },
    { id: 'contract-mars-solar', planet: 'mars', title: 'Photovoltaic Array Alignment', desc: 'Scan the Photovoltaic Mast Array in the southern dunes.', targetScans: ['scan-mars-solar'], reward: { credits: 110, salvage: 1 } },

    // Phobos
    { id: 'contract-phobos-scan', planet: 'phobos', title: 'Docking Strain Analysis', desc: 'Scan the Orbital Docking Coupler and Microwave Horn.', targetScans: ['scan-phobos-clamp', 'scan-phobos-dish'], reward: { credits: 130, salvage: 1 } },
    { id: 'contract-phobos-echo', planet: 'phobos', title: 'Phobos Echo Triangulation', desc: 'Scan the Autonomous Echo Relay on Phobos.', targetScans: ['scan-phobos-echo'], reward: { credits: 140, salvage: 2 } },

    // Europa
    { id: 'contract-europa-cryo', planet: 'europa', title: 'Europa Vent Sampling', desc: 'Scan the Cryo-Geyser Salt Vent and Anomalous Hexagonal Crystals.', targetScans: ['scan-europa-cryo', 'scan-europa-crystals'], reward: { credits: 150, salvage: 1 } },
    { id: 'contract-europa-abyss', planet: 'europa', title: 'Abyssal Sonar Check', desc: 'Scan the Abyssal Acoustic Receiver node.', targetScans: ['scan-europa-abyss'], reward: { credits: 160, salvage: 2 } },
    { id: 'contract-europa-crystals', planet: 'europa', title: 'Hexagonal Crystal Lattice Sampling', desc: 'Scan the Anomalous Hexagonal Crystals in the thermal rift.', targetScans: ['scan-europa-crystals'], reward: { credits: 155, salvage: 2 } },

    // Titan
    { id: 'contract-titan-methane', planet: 'titan', title: 'Methane Littoral Survey', desc: 'Scan Methane Littoral Shallows and Cryogenic Separator Column.', targetScans: ['scan-titan-shallows', 'scan-titan-separator'], reward: { credits: 160, salvage: 1 } },
    { id: 'contract-titan-tholin', planet: 'titan', title: 'Pre-Biotic Strata Analysis', desc: 'Scan the Pre-Biotic Tholin Sediments in the methane fog.', targetScans: ['scan-titan-strata'], reward: { credits: 170, salvage: 2 } },
    { id: 'contract-titan-mast', planet: 'titan', title: 'Atmospheric Mast Telemetry Check', desc: 'Scan the High-Gain Atmospheric Mast through the dense methane haze.', targetScans: ['scan-titan-mast'], reward: { credits: 165, salvage: 2 } },

    // Ceres
    { id: 'contract-ceres-salvage', planet: 'ceres', title: 'Astraea Convoy Inspection', desc: 'Scan the Astraea Convoy Wreckage and Salt Dome.', targetScans: ['scan-ceres-freighter', 'scan-ceres-facula'], reward: { credits: 170, salvage: 2 } },
    { id: 'contract-ceres-core', planet: 'ceres', title: 'Derelict AI Core Decryption', desc: 'Scan the Derelict AI Navigation Module in the debris field.', targetScans: ['scan-ceres-core'], reward: { credits: 180, salvage: 2 } },
    { id: 'contract-ceres-beacon', planet: 'ceres', title: 'Belt Navigation Ephemeris Lock', desc: 'Scan the Belt Navigation Transponder in the asteroid cluster.', targetScans: ['scan-ceres-beacon'], reward: { credits: 175, salvage: 2 } },

    // Earth
    { id: 'contract-earth-telemetry', planet: 'earth', title: 'Expedition Ground Sync', desc: 'Scan the Deep Space Tracking Dish and Genesis Server Rack.', targetScans: ['scan-earth-dish', 'scan-earth-archive'], reward: { credits: 200, salvage: 2 } },
    { id: 'contract-earth-beacon', planet: 'earth', title: 'Genesis Beacon Final Protocol', desc: 'Scan the Genesis Carrier Beacon to archive the full signal.', targetScans: ['scan-earth-beacon'], reward: { credits: 220, salvage: 3 } },
    { id: 'contract-earth-guidance', planet: 'earth', title: 'Laser Guidance Mast Calibration', desc: 'Scan the Orbital Guidance Mast on the landing perimeter.', targetScans: ['scan-earth-guidance'], reward: { credits: 210, salvage: 2 } }
  ];

  function defaultSave() {
    return {
      version: SAVE_VERSION,
      seed: Math.floor(Math.random() * 1000000) + 1,
      mission: 0,
      planet: 0,
      departureReady: false,
      completed: [],
      components: [],
      resources: { suit: 100, oxygen: 100, hull: 62, salvage: 0, credits: 0 },
      upgrades: {},
      discoveries: [],
      optional: [],
      audioLogs: [],
      flags: {},
      stats: { planetsVisited: ['Mars'], mainMissions: 0, optionalMissions: 0, samples: 0, explorationSeconds: 0 },
      settings: { muted: false, volume: .75 },
      unlocked: ['Mars'],
      tutorialCompleted: false,
      graphicsPreset: 'high',
      scans: [],
      signalFragments: [],
      contracts: { active: [], completed: [], cycle: 0 },
      puzzleConfigs: {},
      unlockedRewards: [],
      postGameUnlocked: false,
      prologueCompleted: false,
      updated: Date.now()
    };
  }
  function loadSave() {
    try {
      let raw = null;
      if (window.BGAdapter && typeof window.BGAdapter.getItem === 'function') {
        raw = window.BGAdapter.getItem(SAVE_KEY);
      }
      if (!raw) {
        try { raw = localStorage.getItem(SAVE_KEY); } catch (_) {}
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !Number.isInteger(parsed.mission)) return defaultSave();
      const fresh = defaultSave();
      const merged = Object.assign(fresh, parsed, {
        version: SAVE_VERSION,
        resources: Object.assign(fresh.resources, parsed.resources || {}),
        settings: Object.assign(fresh.settings, parsed.settings || {}),
        stats: Object.assign(fresh.stats, parsed.stats || {})
      });
      if (!Array.isArray(merged.completed)) merged.completed = [];
      if (!Array.isArray(merged.unlocked)) merged.unlocked = ['Mars'];

      // Reconcile mission pointer: advance past any missions already recorded as completed
      while (merged.mission < MISSIONS.length && merged.completed.includes(MISSIONS[merged.mission].id)) {
        merged.mission++;
      }

      // Reconcile planet assignment
      const curM = merged.mission < MISSIONS.length ? MISSIONS[merged.mission] : null;
      if (Number.isInteger(parsed.planet) && parsed.planet >= 0 && parsed.planet < PLANETS.length) {
        merged.planet = parsed.planet;
      } else {
        merged.planet = curM ? curM.planet : 0;
      }

      // Ensure all planets up to the current mission's planet and the saved planet are in unlocked list
      const curMissionPlanet = curM ? curM.planet : merged.planet;
      for (let i = 0; i <= curMissionPlanet; i++) {
        if (PLANETS[i] && !merged.unlocked.includes(PLANETS[i].name)) {
          merged.unlocked.push(PLANETS[i].name);
        }
      }
      if (PLANETS[merged.planet] && !merged.unlocked.includes(PLANETS[merged.planet].name)) {
        merged.unlocked.push(PLANETS[merged.planet].name);
      }

      if (!merged.audioLogs) merged.audioLogs = [];
      if (!merged.discoveries) merged.discoveries = [];
      if (!merged.scans) merged.scans = [];
      if (!merged.signalFragments) merged.signalFragments = [];
      if (!merged.contracts) merged.contracts = { active: [], completed: [], cycle: 0 };
      if (!merged.contracts.active) merged.contracts.active = [];
      if (!merged.contracts.completed) merged.contracts.completed = [];
      if (merged.contracts.cycle == null) merged.contracts.cycle = 0;
      if (!merged.puzzleConfigs) {
        merged.puzzleConfigs = {};
      } else {
        for (const k of Object.keys(merged.puzzleConfigs)) {
          const c = merged.puzzleConfigs[k];
          if (c && c.type === 'circuit' && Array.isArray(c.pieces)) {
            const hasUpperBug = c.pieces.some(p => p.x === 0 && p.y === 1 && p.type === 'elbow' && p.target === 0);
            const hasCentralBug = c.pieces.some(p => p.x === 1 && p.y === 1 && p.type === 'elbow' && p.target === 2);
            const hasCenterWaveBug = c.pieces.some(p => p.x === 1 && p.y === 1 && p.type === 'elbow' && p.target === 0);
            if (hasUpperBug || hasCentralBug || hasCenterWaveBug) {
              delete merged.puzzleConfigs[k];
            }
          }
        }
      }
      if (!merged.seed) merged.seed = 42;
      if (!merged.unlockedRewards) merged.unlockedRewards = [];
      if (merged.postGameUnlocked === undefined) merged.postGameUnlocked = false;
      if (merged.prologueCompleted === undefined) {
        merged.prologueCompleted = !!(parsed.tutorialCompleted || (parsed.stats && parsed.stats.mainMissions > 0) || (parsed.mission && parsed.mission > 0) || (parsed.planet && parsed.planet > 0));
      }
      return merged;
    } catch (_) { return defaultSave(); }
  }
  function persist(message) {
    HC.save.updated = Date.now();
    try {
      const serialized = JSON.stringify(HC.save);
      if (window.BGAdapter && typeof window.BGAdapter.setItem === 'function') {
        window.BGAdapter.setItem(SAVE_KEY, serialized);
      } else {
        localStorage.setItem(SAVE_KEY, serialized);
      }
      if (message) toast(message);
    } catch (_) {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(HC.save));
        if (message) toast(message);
      } catch (e) {
        toast('Save unavailable in this browser session.');
      }
    }
  }
  function hasProgress() {
    try {
      if (window.BGAdapter && typeof window.BGAdapter.getItem === 'function') {
        if (window.BGAdapter.getItem(SAVE_KEY)) return true;
      }
      return !!localStorage.getItem(SAVE_KEY);
    } catch (_) {
      return false;
    }
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function angleLerp(a, b, amount) { let d = (b - a + Math.PI) % (Math.PI * 2) - Math.PI; return a + d * amount; }
  function rand(x, z) { return ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1; }
  function noise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = rand(xi, zi), b = rand(xi + 1, zi), c = rand(xi, zi + 1), d = rand(xi + 1, zi + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  function activePlanetId() {
    if (HC.planet && HC.planet.id) return HC.planet.id;
    if (HC.save && HC.save.planet != null && PLANETS[HC.save.planet]) return PLANETS[HC.save.planet].id;
    return 'mars';
  }
  function terrainHeight(x, z) {
    const pId = activePlanetId();
    let h = 0;
    const crater = (cx, cz, r, depth, rim) => {
      const d = Math.hypot(x - cx, z - cz) / r;
      return d < 1 ? (-depth * (1 - d * d) + rim * Math.exp(-Math.pow((d - 0.92) * 8, 2))) : 0;
    };

    if (pId === 'phobos') {
      // Phobos: Craggy jagged low-gravity asteroid! High-frequency crags, fault scarps, Stickney basin
      const crags = Math.abs(noise(x * 0.13 + 5, z * 0.13 - 8) - 0.5) * 3.2;
      const fault = Math.sin(x * 0.062 + z * 0.045) * 1.5;
      const stickney = -3.8 * Math.exp(-Math.hypot(x + 22, z - 18) / 16);
      h = crags + fault + stickney + crater(-10, -15, 7, 1.6, 0.6) + crater(18, 12, 8, 1.8, 0.7) + crater(-30, 25, 9, 2.0, 0.7);
    } else if (pId === 'europa') {
      // Europa: Jovian fractured ice shelf! Linear flexure pressure ridges, narrow cryo-crevasses, polished ice flats
      const ridge1 = Math.pow(Math.abs(Math.sin(x * 0.055 + z * 0.035)), 1.6) * 2.5;
      const ridge2 = Math.pow(Math.abs(Math.cos(x * 0.035 - z * 0.065)), 1.6) * 1.9;
      const crevasse = -Math.exp(-Math.pow(Math.sin(x * 0.045 + z * 0.02) * 6, 2)) * 1.7;
      const plains = (noise(x * 0.04 + 3, z * 0.04 - 5) - 0.5) * 0.6;
      const thermalBasin = -1.4 * Math.exp(-Math.hypot(x - 30, z + 23) / 12);
      h = ridge1 + ridge2 + crevasse + plains + thermalBasin - 0.7;
    } else if (pId === 'titan') {
      // Titan: Longitudinal hydrocarbon dunes & sunken liquid methane lake shores
      const dunes = Math.sin(z * 0.065 + Math.sin(x * 0.03) * 1.4) * 2.2;
      const terrace = Math.floor(noise(x * 0.04, z * 0.04) * 3.5) * 0.85;
      const lake = (x < -18) ? -2.2 : 0;
      const river = -1.5 * Math.exp(-Math.pow((z - Math.sin(x * 0.06) * 10) * 0.14, 2));
      h = dunes + terrace + lake + river;
    } else if (pId === 'ceres') {
      // Ceres: Heavily cratered dwarf-planet regolith with central Occator salt dome peak
      const craters = crater(0, 0, 15, 1.8, 0.7) + crater(-25, 15, 12, 1.7, 0.6) + crater(25, -20, 11, 1.6, 0.6) + crater(-30, -25, 9, 1.5, 0.5) + crater(15, 28, 8, 1.4, 0.5);
      const saltDome = Math.exp(-Math.hypot(x - 12, z + 12) / 6.5) * 4.2;
      const rough = (noise(x * 0.15 + 4, z * 0.15 - 4) - 0.5) * 1.3;
      h = craters + saltDome + rough;
    } else if (pId === 'earth') {
      // Earth: Rolling coastal hills, flat river plain, and bluffs
      const hills = Math.sin(x * 0.028) * 1.8 + Math.cos(z * 0.025) * 1.5;
      const riverbed = -1.3 * Math.exp(-Math.hypot(x - 5, z + 10) / 22);
      const bluffs = (z < -28) ? Math.min(3.8, (-28 - z) * 0.14) : 0;
      const smooth = (noise(x * 0.05, z * 0.05) - 0.5) * 0.5;
      h = hills + riverbed + bluffs + smooth;
    } else {
      // Mars: Rolling red dunes, broad canyon depression, impact craters
      const dunes = Math.sin(x * 0.038) * 1.1 + Math.cos(z * 0.042) * 0.95 + Math.sin((x + z) * 0.024) * 0.8;
      const canyon = -2.8 * Math.exp(-Math.pow((x - 18) * 0.11, 2));
      const fine = (noise(x * 0.12 + 7, z * 0.12 - 11) - 0.5) * 0.7;
      h = dunes + canyon + fine + crater(-28, 22, 13, 1.5, 0.6) + crater(29, -23, 10, 1.4, 0.55) + crater(7, 32, 8, 1.3, 0.5);
    }

    // Grand Natural Boundary Mountain Ring at radius > 64m:
    // Seamlessly rises up from the continuous terrain surface into towering jagged mountain ridges and peaks,
    // sealing the horizon with zero gaps, zero seams, and zero floating geometry!
    const dist = Math.hypot(x, z);
    if (dist > 64) {
      const edge = (dist - 64) / 22;
      const angle = Math.atan2(z, x);
      const peakJitter = Math.sin(angle * 7) * 0.35 + Math.cos(angle * 13) * 0.25 + (noise(x * 0.08, z * 0.08) - 0.5) * 0.4;
      const mountainHeight = pId === 'phobos' ? 16 : (pId === 'europa' ? 18 : 22);
      h += Math.pow(Math.max(0, edge), 1.7) * mountainHeight * (1 + peakJitter);
    }

    return h;
  }
  function yAt(x, z, lift) { return terrainHeight(x, z) + (lift || 0); }
  function pos(x, z, lift) { return new V(x, yAt(x, z, lift), z); }

  /* ─────────────────────────────────────────────────────────────────────
     UI injection
     ───────────────────────────────────────────────────────────────────── */
  function injectUI() {
    const wrap = document.createElement('div');
    wrap.id = 'homecoming-ui';
    wrap.innerHTML = `
      <section id="hc-intro" class="hc-hidden"><div class="hc-panel"><div class="hc-kicker">Project Homecoming / Opening transmission</div><h2>THE RED SILENCE</h2><p>After the Mars expedition is crippled, ORA detects an impossible signal crossing the outer system. Repair the ship, follow its path, and bring the crew's data home.</p><div class="hc-actions"><button class="btn" id="hc-deploy">Begin Mission</button><button class="btn hc-ghost" id="hc-skip">Skip Briefing</button><button class="btn hc-ghost" id="hc-title">Main Menu</button></div></div></section>
      <section id="hc-hud"><button class="btn hc-ghost hc-hud-comms-btn" id="hc-hud-comms" title="View Communications & Audio Logs [Shortcut: L]"><span class="hc-hud-icon">📡</span> COMM LOGS <span class="hc-hud-key">[L]</span></button><button class="btn hc-ghost hc-hud-explorers-btn" id="hc-hud-explorers" title="View Explorer's Log [Shortcut: X]"><span class="hc-hud-icon">🧭</span> EXPLORER'S LOG <span class="hc-hud-key">[X]</span></button><div id="hc-scan-hud"><div class="hc-scan-header"><span id="hc-scan-cat">GEOLOGICAL ANALYSIS</span><span id="hc-scan-pct">0%</span></div><div class="hc-scan-title" id="hc-scan-name">TARGET NAME</div><div class="hc-scan-bar-bg"><div class="hc-scan-bar-fill" id="hc-scan-fill"></div></div><div class="hc-scan-status" id="hc-scan-status">ANALYZING SPECTRAL SIGNATURE…</div></div><div class="hc-top"><div class="hc-compass-strip"><div class="hc-compass-pip" id="hc-compass-pip" title="Active Objective Waypoint"><span class="hc-pip-dot"></span><span class="hc-pip-arrow">▼</span></div><div class="hc-compass-center-mark">▼</div><div id="hc-compass">N · NE · E · SE · S · SW · W · NW</div></div><div id="hc-objective"></div><div id="hc-distance"></div></div><div class="hc-vitals"><div>Suit condition</div><div class="hc-meter"><i id="hc-suit"></i></div><div>Oxygen reserve</div><div class="hc-meter"><i id="hc-oxygen"></i></div><div id="hc-salvage">Salvage 0 · Credits 0</div></div><canvas id="hc-minimap" width="290" height="290" aria-label="Mission minimap"></canvas><div id="hc-emp">EMP READY [F]</div><div id="hc-prompt" class="hc-hidden"></div><div id="hc-toast"></div><div id="hc-damage-flash" style="position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, rgba(255,0,0,0) 30%, rgba(255,20,20,0.65) 100%);opacity:0;transition:opacity 0.12s ease-out;z-index:9999;"></div><div id="hc-controls" style="position:absolute;right:28px;top:max(20px,env(safe-area-inset-top));font-size:8px;letter-spacing:.12em;color:rgba(217,169,143,.5);text-transform:uppercase;text-align:right;line-height:2">WASD Move · Shift Run / Boost · Space Jump<br>E Interact · R Rover · F EMP<br>L Logs · Esc Pause · Mouse Look · Scroll Zoom</div></section>
      <section id="hc-hub" class="hc-hidden"><div class="hc-hub-card"><div class="hc-kicker" id="hc-hub-route">CURRENT DESTINATION</div><h2 id="hc-hub-name">MARS</h2><div class="hc-hub-subtitle" id="hc-hub-subtitle"></div><p id="hc-hub-description"></p><div id="hc-hub-mission"></div><div class="hc-actions"><button class="btn" id="hc-explore">Explore Surface</button><button class="btn hc-ghost" id="hc-route">Journey Route</button><button class="btn hc-ghost" id="hc-hub-title">Main Menu</button></div><div class="hc-route-list" id="hc-route-list"></div></div></section>
      <section id="hc-puzzle" class="hc-hidden"><div class="hc-panel hc-puzzle-panel"><div class="hc-kicker">ORA // FIELD DIAGNOSTIC</div><h2 id="hc-puzzle-title">SYSTEM LINK</h2><p class="hc-puzzle-help" id="hc-puzzle-help"></p><div class="hc-puzzle-board" id="hc-puzzle-board"></div><div class="hc-error" id="hc-puzzle-error"></div><div class="hc-actions"><button class="btn hc-ghost" id="hc-cancel">Cancel</button></div></div></section>
      <section id="hc-pause" class="hc-hidden"><div class="hc-panel hc-settings-panel"><div class="hc-kicker">Expedition settings</div><h2>SETTINGS</h2><p>Configure audio levels, visual performance, and controls.</p><div class="hc-settings-content"><div class="hc-audio-controls"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span class="hc-kicker" style="color:#d9a98f">Audio Settings</span><label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--mut);cursor:pointer;text-transform:uppercase;letter-spacing:.1em;"><input type="checkbox" id="hc-audio-mute" style="accent-color:#d9a98f;cursor:pointer;"> Mute</label></div><div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-bottom:3px;letter-spacing:.05em;"><span>Master Volume</span><span id="hc-master-vol-val">80%</span></div><input type="range" id="hc-master-vol" min="0" max="100" value="80" style="width:100%;accent-color:#d9a98f;cursor:pointer;"></div><div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-bottom:3px;letter-spacing:.05em;"><span>Voice Narration (TTS)</span><span id="hc-voice-vol-val">90%</span></div><input type="range" id="hc-voice-vol" min="0" max="100" value="90" style="width:100%;accent-color:#d9a98f;cursor:pointer;"></div><div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-bottom:3px;letter-spacing:.05em;"><span>Sound Effects</span><span id="hc-sfx-vol-val">85%</span></div><input type="range" id="hc-sfx-vol" min="0" max="100" value="85" style="width:100%;accent-color:#d9a98f;cursor:pointer;"></div><div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-bottom:3px;letter-spacing:.05em;"><span>Music</span><span id="hc-music-vol-val">65%</span></div><input type="range" id="hc-music-vol" min="0" max="100" value="65" style="width:100%;accent-color:#d9a98f;cursor:pointer;"></div><div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-bottom:3px;letter-spacing:.05em;"><span>Ambience</span><span id="hc-amb-vol-val">75%</span></div><input type="range" id="hc-amb-vol" min="0" max="100" value="75" style="width:100%;accent-color:#d9a98f;cursor:pointer;"></div></div>
        <div class="hc-graphics-section">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span class="hc-kicker" style="color:#d9a98f">Graphics Quality</span>
            <span id="hc-graphics-dpr-val" style="font-size:10px;color:var(--mut);letter-spacing:.05em;">Preset: High</span>
          </div>
          <div class="hc-preset-grid">
            <button class="hc-preset-btn" id="hc-preset-low">Low</button>
            <button class="hc-preset-btn" id="hc-preset-med">Medium</button>
            <button class="hc-preset-btn active" id="hc-preset-high">High</button>
            <button class="hc-preset-btn" id="hc-preset-ultra">Ultra</button>
          </div>
          <div class="hc-preset-desc" id="hc-preset-desc">High fidelity with soft shadows, atmospheric glow, and rich particles.</div>
          <div class="hc-data-saver">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--mut);cursor:pointer;text-transform:uppercase;letter-spacing:.08em;">
              <input type="checkbox" id="hc-data-saver-cb" style="accent-color:#d9a98f;cursor:pointer;"> Data Saver (Optimized Textures & DPR)
            </label>
          </div>
        </div>
        <div class="hc-settings-tutorial">
          <button class="btn hc-ghost" id="hc-btn-replay-tutorial">Replay Tutorial & Controls Guide</button>
        </div>
        <div class="hc-actions hc-settings-actions"><button class="btn" id="hc-resume">Resume</button><button class="btn hc-ghost" id="hc-save">Save now</button><button class="btn hc-ghost" id="hc-return">Return to orbit</button></div></div></div></section>
      <section id="hc-travel" class="hc-hidden"><div class="hc-travel-copy"><div class="hc-kicker" id="hc-travel-route">DEPARTING</div><h2 id="hc-travel-title">INTERPLANETARY TRANSIT</h2><p id="hc-travel-text">ORA is plotting a safe course.</p><div class="hc-progress"><i id="hc-travel-progress"></i></div><button class="btn hc-ghost" id="hc-skip-travel">Skip Travel Animation</button></div></section>
      <section id="hc-ending" class="hc-hidden"><div class="hc-panel"><div class="hc-kicker">Project Homecoming</div><h2 id="hc-ending-heading">MISSION COMPLETE</h2><p id="hc-ending-copy"></p><div class="hc-actions"><button class="btn" id="hc-play-again">Play Again</button><button class="btn" id="hc-btn-free-recon" style="background:rgba(125,255,138,0.2);border-color:#7dff8a;color:#fff;">🪐 Free Reconnaissance</button><button class="btn hc-ghost" id="hc-ending-title">Main Menu</button></div></div></section>
      <section id="hc-chapter" class="hc-hidden"><div class="hc-panel"><div class="hc-kicker" id="hc-chapter-kicker">Chapter complete</div><h2 id="hc-chapter-heading">THE FIRST DEPARTURE</h2><p id="hc-chapter-text"></p><div class="hc-actions"><button class="btn" id="hc-depart-close">Continue</button></div></div></section>
      <section id="hc-dialogue" class="hc-hidden"><div class="hc-panel" style="max-width:620px"><div class="hc-kicker">ORA // TRANSMISSION</div><h2 id="hc-dialogue-title">INCOMING</h2><p id="hc-dialogue-text" style="min-height:60px"></p><div class="hc-actions"><button class="btn" id="hc-dialogue-next">Continue</button><button class="btn hc-ghost" id="hc-dialogue-skip">Skip</button></div></div></section>
      <section id="hc-log" class="hc-hidden"><div class="hc-panel" style="max-width:580px"><div class="hc-kicker">RECOVERED AUDIO LOG</div><h2 id="hc-log-title"></h2><p id="hc-log-text" style="font-style:italic"></p><div class="hc-actions"><button class="btn" id="hc-log-close">Close</button></div></div></section>
      <section id="hc-comms" class="hc-hidden"><div class="hc-panel hc-comms-panel"><div class="hc-comms-header"><div><div class="hc-kicker">Expedition Archives // Signal Database</div><h2>COMMUNICATIONS & LOGS</h2></div><div id="hc-comms-counter" style="font-size:11px;color:var(--mut);letter-spacing:.12em;text-align:right;"></div></div><div class="hc-comms-tabs"><button class="hc-comms-tab-btn active" id="hc-tab-ora">ORA Transmissions</button><button class="hc-comms-tab-btn" id="hc-tab-logs">Expedition Audio Logs</button></div><div class="hc-comms-body" id="hc-comms-content"></div><div class="hc-comms-actions-bar"><span style="font-size:10px;letter-spacing:.15em;color:var(--mut);text-transform:uppercase;">Shortcut: Press L or C to toggle · Esc to close</span><button class="btn" id="hc-comms-close">Close Archive</button></div></div></section>
      <section id="hc-explorers" class="hc-hidden"><div class="hc-panel hc-explorers-panel"><div class="hc-explorers-header"><div><div class="hc-kicker">Project Homecoming // Replayability & Reconnaissance</div><h2>EXPLORER'S LOG</h2></div><button class="btn hc-ghost" id="hc-explorers-close">✕ Close</button></div><div class="hc-explorers-tabs"><button class="hc-explorers-tab-btn active" id="hc-tab-recon">Planetary Reconnaissance</button><button class="hc-explorers-tab-btn" id="hc-tab-fragments">Signal Fragments (0/18)</button><button class="hc-explorers-tab-btn" id="hc-tab-contracts">Planetary Contracts</button><button class="hc-explorers-tab-btn" id="hc-tab-discoveries">Field Discoveries</button></div><div class="hc-explorers-body" id="hc-explorers-content"></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid rgba(251,233,220,0.15);"><span style="font-size:10px;letter-spacing:.12em;color:var(--mut);">SHORTCUT: PRESS X TO TOGGLE EXPLORER'S LOG</span><button class="btn" id="hc-explorers-back">Back to Mission</button></div></div></section>`;
    document.body.appendChild(wrap);
    Object.assign(ui, {
      wrap, intro: wrap.querySelector('#hc-intro'), hub: wrap.querySelector('#hc-hub'), hud: wrap.querySelector('#hc-hud'), puzzle: wrap.querySelector('#hc-puzzle'), pause: wrap.querySelector('#hc-pause'), travel: wrap.querySelector('#hc-travel'), chapter: wrap.querySelector('#hc-chapter'), ending: wrap.querySelector('#hc-ending'), dialogue: wrap.querySelector('#hc-dialogue'), log: wrap.querySelector('#hc-log'),
      comms: wrap.querySelector('#hc-comms'), commsContent: wrap.querySelector('#hc-comms-content'), commsCounter: wrap.querySelector('#hc-comms-counter'), tabOra: wrap.querySelector('#hc-tab-ora'), tabLogs: wrap.querySelector('#hc-tab-logs'), hudComms: wrap.querySelector('#hc-hud-comms'),
      explorers: wrap.querySelector('#hc-explorers'), explorersContent: wrap.querySelector('#hc-explorers-content'), hudExplorers: wrap.querySelector('#hc-hud-explorers'), tabRecon: wrap.querySelector('#hc-tab-recon'), tabFragments: wrap.querySelector('#hc-tab-fragments'), tabContracts: wrap.querySelector('#hc-tab-contracts'), tabDiscoveries: wrap.querySelector('#hc-tab-discoveries'),
      objective: wrap.querySelector('#hc-objective'), compass: wrap.querySelector('#hc-compass'), compassPip: wrap.querySelector('#hc-compass-pip'), distance: wrap.querySelector('#hc-distance'), prompt: wrap.querySelector('#hc-prompt'), toast: wrap.querySelector('#hc-toast'),
      suit: wrap.querySelector('#hc-suit'), oxygen: wrap.querySelector('#hc-oxygen'), salvage: wrap.querySelector('#hc-salvage'), emp: wrap.querySelector('#hc-emp'), map: wrap.querySelector('#hc-minimap'), damageFlash: wrap.querySelector('#hc-damage-flash'),
      puzzleTitle: wrap.querySelector('#hc-puzzle-title'), puzzleHelp: wrap.querySelector('#hc-puzzle-help'), puzzleBoard: wrap.querySelector('#hc-puzzle-board'), puzzleError: wrap.querySelector('#hc-puzzle-error'),
      hubName: wrap.querySelector('#hc-hub-name'), hubSubtitle: wrap.querySelector('#hc-hub-subtitle'), hubDescription: wrap.querySelector('#hc-hub-description'), hubMission: wrap.querySelector('#hc-hub-mission'), hubRoute: wrap.querySelector('#hc-hub-route'), routeList: wrap.querySelector('#hc-route-list'), travelRoute: wrap.querySelector('#hc-travel-route'), travelTitle: wrap.querySelector('#hc-travel-title'), travelText: wrap.querySelector('#hc-travel-text'), travelProgress: wrap.querySelector('#hc-travel-progress'), endingCopy: wrap.querySelector('#hc-ending-copy'), endingHeading: wrap.querySelector('#hc-ending-heading'),
      chapterKicker: wrap.querySelector('#hc-chapter-kicker'), chapterHeading: wrap.querySelector('#hc-chapter-heading'), chapterText: wrap.querySelector('#hc-chapter-text'),
      dialogueTitle: wrap.querySelector('#hc-dialogue-title'), dialogueText: wrap.querySelector('#hc-dialogue-text')
    });
    wrap.querySelector('#hc-deploy').onclick = () => showHub(HC.save.planet || 0);
    wrap.querySelector('#hc-skip').onclick = () => showHub(HC.save.planet || 0);
    wrap.querySelector('#hc-title').onclick = returnTitle;
    wrap.querySelector('#hc-explore').onclick = beginExploration;
    wrap.querySelector('#hc-route').onclick = () => ui.routeList.classList.toggle('open');
    wrap.querySelector('#hc-hub-title').onclick = returnTitle;
    wrap.querySelector('#hc-resume').onclick = resume;
    wrap.querySelector('#hc-save').onclick = () => persist('Expedition saved.');
    wrap.querySelector('#hc-return').onclick = returnTitle;
    wrap.querySelector('#hc-depart-close').onclick = () => { show(ui.chapter, false); if (window.HomecomingAudio) window.HomecomingAudio.stopSpeech(); notifyNavigationUpdate('UPDATED NAVIGATION ON YOUR HUD'); };
    wrap.querySelector('#hc-skip-travel').onclick = finishTravel;
    wrap.querySelector('#hc-play-again').onclick = () => { HC.save = defaultSave(); persist(); showHub(0); };
    wrap.querySelector('#hc-ending-title').onclick = returnTitle;
    wrap.querySelector('#hc-cancel').onclick = cancelPuzzle;
    wrap.querySelector('#hc-dialogue-next').onclick = advanceDialogue;
    wrap.querySelector('#hc-dialogue-skip').onclick = skipDialogue;
    wrap.querySelector('#hc-log-close').onclick = closeLog;
    const hudComms = wrap.querySelector('#hc-hud-comms');
    if (hudComms) hudComms.onclick = () => openComms('ora');
    const hubComms = wrap.querySelector('#hc-hub-comms');
    const pauseComms = wrap.querySelector('#hc-pause-comms');
    if (pauseComms) pauseComms.onclick = () => openComms('ora');
    wrap.querySelector('#hc-comms-close').onclick = closeComms;
    wrap.querySelector('#hc-tab-ora').onclick = () => { currentCommsTab = 'ora'; renderComms(); };
    wrap.querySelector('#hc-tab-logs').onclick = () => { currentCommsTab = 'logs'; renderComms(); };

    // Dedicated smooth mouse-wheel scrolling for Comms & Logs modal
    const commsWrap = wrap.querySelector('#hc-comms');
    if (commsWrap && typeof commsWrap.addEventListener === 'function') {
      commsWrap.addEventListener('wheel', (e) => {
        e.stopPropagation();
        const content = wrap.querySelector('#hc-comms-content');
        if (content) {
          const delta = e.deltaY * (e.deltaMode === 1 ? 28 : 1);
          content.scrollTop += delta;
        }
      }, { passive: true });
    }
    const hudExplorers = wrap.querySelector('#hc-hud-explorers');
    if (hudExplorers) hudExplorers.onclick = () => openExplorersLog('recon');
    const pauseExplorers = wrap.querySelector('#hc-pause-explorers');
    if (pauseExplorers) pauseExplorers.onclick = () => openExplorersLog('recon');
    const explClose = wrap.querySelector('#hc-explorers-close');
    if (explClose) {
      explClose.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); closeExplorersLog(); };
      if (typeof explClose.addEventListener === 'function') explClose.addEventListener('click', (e) => { if (e && e.stopPropagation) e.stopPropagation(); closeExplorersLog(); });
    }
    const explBack = wrap.querySelector('#hc-explorers-back');
    if (explBack) {
      explBack.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); closeExplorersLog(); };
      if (typeof explBack.addEventListener === 'function') explBack.addEventListener('click', (e) => { if (e && e.stopPropagation) e.stopPropagation(); closeExplorersLog(); });
    }
    const explModal = wrap.querySelector('#hc-explorers');
    if (explModal) {
      explModal.onclick = (e) => {
        if (e.target && e.target.id === 'hc-explorers') closeExplorersLog();
      };
    }
    const tabRecon = wrap.querySelector('#hc-tab-recon');
    if (tabRecon) tabRecon.onclick = () => { currentExplorerTab = 'recon'; renderExplorersLog(); };
    const tabFrags = wrap.querySelector('#hc-tab-fragments');
    if (tabFrags) tabFrags.onclick = () => { currentExplorerTab = 'fragments'; renderExplorersLog(); };
    const tabConts = wrap.querySelector('#hc-tab-contracts');
    if (tabConts) tabConts.onclick = () => { currentExplorerTab = 'contracts'; renderExplorersLog(); };
    const tabDiscs = wrap.querySelector('#hc-tab-discoveries');
    if (tabDiscs) tabDiscs.onclick = () => { currentExplorerTab = 'discoveries'; renderExplorersLog(); };

    // Dedicated smooth mouse-wheel scrolling for Explorer's Log modal
    const expWrap = wrap.querySelector('#hc-explorers');
    if (expWrap && typeof expWrap.addEventListener === 'function') {
      expWrap.addEventListener('wheel', (e) => {
        e.stopPropagation();
        const content = wrap.querySelector('#hc-explorers-content');
        if (content) {
          const delta = e.deltaY * (e.deltaMode === 1 ? 28 : 1);
          content.scrollTop += delta;
        }
      }, { passive: true });
    }
    const freeReconBtn = wrap.querySelector('#hc-btn-free-recon');
    if (freeReconBtn) {
      freeReconBtn.onclick = () => {
        HC.save.postGameUnlocked = true;
        persist();
        show(ui.ending, false);
        showHub(0);
        toast('Free Reconnaissance Mode Activated. All 6 planetary systems unlocked.');
      };
    }

    // Audio settings panel event binding
    function syncAudioSliders() {
      if (!window.HomecomingAudio) return;
      const s = window.HomecomingAudio.getSettings();
      const muteEl = wrap.querySelector('#hc-audio-mute');
      const mVol = wrap.querySelector('#hc-master-vol'), mVal = wrap.querySelector('#hc-master-vol-val');
      const vVol = wrap.querySelector('#hc-voice-vol'), vVal = wrap.querySelector('#hc-voice-vol-val');
      const sVol = wrap.querySelector('#hc-sfx-vol'), sVal = wrap.querySelector('#hc-sfx-vol-val');
      const muVol = wrap.querySelector('#hc-music-vol'), muVal = wrap.querySelector('#hc-music-vol-val');
      const aVol = wrap.querySelector('#hc-amb-vol'), aVal = wrap.querySelector('#hc-amb-vol-val');
      if (muteEl) muteEl.checked = !!s.muted;
      if (mVol) { mVol.value = Math.round(s.master * 100); if (mVal) mVal.textContent = mVol.value + '%'; }
      if (vVol) { vVol.value = Math.round((s.voice != null ? s.voice : 0.9) * 100); if (vVal) vVal.textContent = vVol.value + '%'; }
      if (sVol) { sVol.value = Math.round(s.sfx * 100); if (sVal) sVal.textContent = sVol.value + '%'; }
      if (muVol) { muVol.value = Math.round(s.music * 100); if (muVal) muVal.textContent = muVol.value + '%'; }
      if (aVol) { aVol.value = Math.round(s.ambience * 100); if (aVal) aVal.textContent = aVol.value + '%'; }
    }
    ui.syncAudioSliders = syncAudioSliders;

    wrap.querySelector('#hc-audio-mute').onchange = (e) => {
      if (window.HomecomingAudio) window.HomecomingAudio.setMuted(e.target.checked);
    };
    wrap.querySelector('#hc-master-vol').oninput = (e) => {
      const v = e.target.value / 100;
      wrap.querySelector('#hc-master-vol-val').textContent = e.target.value + '%';
      if (window.HomecomingAudio) window.HomecomingAudio.setMasterVolume(v);
    };
    const voiceInput = wrap.querySelector('#hc-voice-vol');
    if (voiceInput) {
      voiceInput.oninput = (e) => {
        const v = e.target.value / 100;
        const valEl = wrap.querySelector('#hc-voice-vol-val');
        if (valEl) valEl.textContent = e.target.value + '%';
        if (window.HomecomingAudio) window.HomecomingAudio.setVoiceVolume(v);
      };
    }
    wrap.querySelector('#hc-sfx-vol').oninput = (e) => {
      const v = e.target.value / 100;
      wrap.querySelector('#hc-sfx-vol-val').textContent = e.target.value + '%';
      if (window.HomecomingAudio) window.HomecomingAudio.setSfxVolume(v);
    };
    wrap.querySelector('#hc-music-vol').oninput = (e) => {
      const v = e.target.value / 100;
      wrap.querySelector('#hc-music-vol-val').textContent = e.target.value + '%';
      if (window.HomecomingAudio) window.HomecomingAudio.setMusicVolume(v);
    };

    // Graphics presets binding
    ['low', 'med', 'high', 'ultra'].forEach(p => {
      const btn = wrap.querySelector('#hc-preset-' + p);
      if (btn) {
        btn.onclick = () => {
          const fullPreset = p === 'med' ? 'medium' : p;
          applyGraphicsSettings(fullPreset);
        };
      }
    });

    const dataSaverCb = wrap.querySelector('#hc-data-saver-cb');
    if (dataSaverCb) {
      dataSaverCb.onchange = (e) => {
        applyGraphicsSettings(undefined, e.target.checked);
      };
    }

    const replayTutBtn = wrap.querySelector('#hc-btn-replay-tutorial');
    if (replayTutBtn) {
      replayTutBtn.onclick = () => {
        show(ui.pause, false);
        const curP = HC.planet || PLANETS[HC.save ? HC.save.planet || 0 : 0];
        if (curP && curP.id !== 'mars') {
          toast('Tutorial is only available on Mars.', 3000);
          return;
        }
        showTutorial(0);
      };
    }

    initMobileControls();
    loadGraphicsSettings();
    applyGraphicsSettings();

    wrap.querySelector('#hc-amb-vol').oninput = (e) => {
      const v = e.target.value / 100;
      wrap.querySelector('#hc-amb-vol-val').textContent = e.target.value + '%';
      if (window.HomecomingAudio) window.HomecomingAudio.setAmbienceVolume(v);
    };

    // UI Click & Hover audio triggers
    wrap.addEventListener('click', (e) => {
      if (!window.HomecomingAudio) return;
      const b = e.target.closest('button, .btn, .hc-route-item');
      if (b) {
        const id = b.id;
        if (id === 'hc-cancel' || id === 'hc-return' || id === 'hc-title' || id === 'hc-hub-title' || id === 'hc-ending-title') {
          window.HomecomingAudio.play('ui_back');
        } else {
          window.HomecomingAudio.play('ui_click');
        }
      }
    });
    if (document.body && typeof document.body.addEventListener === 'function') {
      document.body.addEventListener('click', (e) => {
        if (!window.HomecomingAudio || !e.target || !e.target.closest) return;
        if (e.target.closest('#back')) window.HomecomingAudio.play('ui_back');
        else if (e.target.closest('#go')) window.HomecomingAudio.play('ui_click');
      });
    }
  }
  function triggerDamageFlash() {
    if (ui.damageFlash) {
      ui.damageFlash.style.opacity = '1';
      setTimeout(() => {
        if (ui.damageFlash) ui.damageFlash.style.opacity = '0';
      }, 260);
    }
  }
  function show(el, showIt) {
    el.classList.toggle('hc-hidden', !showIt);
    if (el === ui.hud) el.classList.toggle('on', showIt);
    if (el === ui.pause && showIt && ui.syncAudioSliders) ui.syncAudioSliders();
  }
  const ORA_PRIORITY = Object.freeze({
    AMBIENT: 1,
    MISSION: 2,
    COMBAT: 3,
    CRITICAL: 4
  });

  function toast(text, duration, priority = ORA_PRIORITY.MISSION) {
    if (!ui.toast) return;
    if (!text) {
      ui.toast.classList.remove('on');
      clearTimeout(HC.toastTimer);
      return;
    }

    const isOra = text.indexOf('ORA:') === 0;
    const isCritical = text.includes('CRITICAL') || text.includes('compromised');
    const isCombat = text.includes('Security') || text.includes('EMP');
    const actualPriority = isCritical ? ORA_PRIORITY.CRITICAL : (isCombat ? ORA_PRIORITY.COMBAT : (isOra ? priority : ORA_PRIORITY.MISSION));

    // Suppress lower-priority speech/toasts if a higher-priority line is actively being spoken
    if (HC.activeOraPriority && actualPriority < HC.activeOraPriority) {
      const audio = window.HomecomingAudio;
      if (audio && typeof audio.isSpeaking === 'function' && audio.isSpeaking()) {
        return;
      }
    }

    HC.activeOraPriority = actualPriority;
    const cleanSpeech = isOra ? text.replace(/^ORA:\s*/, '') : '';
    const audio = window.HomecomingAudio;
    const calcDuration = duration || (cleanSpeech && audio && typeof audio.calculateSpeechDuration === 'function'
      ? Math.round((audio.calculateSpeechDuration(cleanSpeech) + 0.8) * 1000)
      : Math.max(3400, Math.min(8500, text.length * 68)));

    ui.toast.textContent = text;
    ui.toast.classList.add('on');
    clearTimeout(HC.toastTimer);
    HC.toastSeq = (HC.toastSeq || 0) + 1;
    const seq = HC.toastSeq;

    HC.toastTimer = setTimeout(() => {
      if (seq === HC.toastSeq) {
        ui.toast.classList.remove('on');
        if (HC.activeOraPriority === actualPriority) {
          HC.activeOraPriority = 0;
        }
      }
    }, calcDuration);

    if (audio && (isOra || text.includes('MISSION COMPLETE'))) {
      audio.play('ora_chime');
    }

    if (audio && cleanSpeech) {
      audio.speak(cleanSpeech, 'ora', {
        onend: () => {
          if (HC.activeOraPriority === actualPriority) {
            HC.activeOraPriority = 0;
          }
        }
      });
    }
  }

  function notifyNavigationUpdate(customText) {
    const text = customText || 'UPDATED NAVIGATION ON YOUR HUD';
    HC.navUpdatedTime = performance.now() + 7500;
    if (window.HomecomingAudio) {
      window.HomecomingAudio.play('mission_update');
    }
    toast('▶ ' + text + ' — Follow the blue compass waypoint', 4800, ORA_PRIORITY.AMBIENT);
  }

  /* ─────────────────────────────────────────────────────────────────────
     ORA Dialogue system
     ───────────────────────────────────────────────────────────────────── */
  function showDialogueSequence(title, lines, onComplete) {
    HC.dialogueLines = lines.slice();
    HC.dialogueIndex = 0;
    HC.dialogueCallback = onComplete || null;
    HC.state = STATES.DIALOGUE;
    setMobileControlsVisible(false);
    show(ui.dialogue, true);
    ui.dialogueTitle.textContent = title;
    ui.dialogueText.textContent = lines[0];
    if (window.HomecomingAudio) {
      window.HomecomingAudio.play('ora_chime');
      window.HomecomingAudio.speak(lines[0], 'ora');
    }
    try { document.exitPointerLock(); } catch (_) { }
  }
  function advanceDialogue() {
    HC.dialogueIndex++;
    if (HC.dialogueIndex >= HC.dialogueLines.length) {
      endDialogue(); return;
    }
    if (window.HomecomingAudio) {
      window.HomecomingAudio.play('ui_click');
      window.HomecomingAudio.speak(HC.dialogueLines[HC.dialogueIndex], 'ora');
    }
    ui.dialogueText.textContent = HC.dialogueLines[HC.dialogueIndex];
  }
  function skipDialogue() {
    if (window.HomecomingAudio) window.HomecomingAudio.stopSpeech();
    endDialogue();
  }
  function endDialogue() {
    if (window.HomecomingAudio) window.HomecomingAudio.stopSpeech();
    show(ui.dialogue, false);
    const cb = HC.dialogueCallback;
    HC.dialogueCallback = null;
    HC.dialogueLines = [];
    HC.state = STATES.EXPLORATION;
    setMobileControlsVisible(true);
    if (cb) {
      try { cb(); } catch (err) { console.error('Dialogue callback error:', err); }
    }
    // Re-anchor camera position directly behind player/rover to guarantee zero camera jumps
    if (HC.cameraPosition) {
      const subject = player();
      const f = new THREE.Vector3(-Math.sin(HC.mouse.yaw), 0, -Math.cos(HC.mouse.yaw));
      const dist = (HC.rover && HC.rover.driving) ? HC.mouse.distance + 2.5 : HC.mouse.distance;
      const desired = subject.clone().addScaledVector(f, -dist);
      desired.y = Math.max(terrainHeight(desired.x, desired.z) + 1.2, subject.y + ((HC.rover && HC.rover.driving) ? 2.5 : 2.2));
      HC.cameraPosition.copy(desired);
      cam.position.copy(desired);
    }
  }

  /* Audio log viewer */
  function showLog(log) {
    HC.state = STATES.DIALOGUE;
    setMobileControlsVisible(false);
    show(ui.log, true);
    ui.log.querySelector('#hc-log-title').textContent = log.title;
    ui.log.querySelector('#hc-log-text').textContent = log.text;
    if (window.HomecomingAudio) {
      window.HomecomingAudio.play('audiolog_play');
      window.HomecomingAudio.speak(log.title + '. ' + log.text.replace(/["']/g, ''), 'log');
    }
    try { document.exitPointerLock(); } catch (_) { }
  }
  function closeLog() {
    show(ui.log, false);
    if (window.HomecomingAudio) window.HomecomingAudio.stopSpeech();
    if (HC.state !== STATES.COMMS) {
      HC.state = STATES.EXPLORATION;
      setMobileControlsVisible(true);
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     EXPEDITION COMM LOGS & ORA TRANSMISSIONS ARCHIVE
     ───────────────────────────────────────────────────────────────────── */
  let commsReturnState = STATES.TITLE;
  let currentCommsTab = 'ora';

  function openComms(tab) {
    if (HC.state === STATES.PUZZLE) return;
    commsReturnState = HC.state;
    if (HC.state === STATES.PAUSED) {
      show(ui.pause, false);
    } else if (HC.state === STATES.HUB) {
      show(ui.hub, false);
    } else if (HC.state === STATES.EXPLORATION) {
      try { document.exitPointerLock(); } catch (_) { }
    }
    HC.state = STATES.COMMS;
    setMobileControlsVisible(false);
    if (tab) currentCommsTab = tab;
    show(ui.comms, true);
    renderComms();
    if (window.HomecomingAudio) window.HomecomingAudio.play('ui_click');
  }

  function closeComms() {
    show(ui.comms, false);
    if (window.HomecomingAudio) {
      window.HomecomingAudio.play('ui_back');
      window.HomecomingAudio.stopSpeech();
    }
    const prev = commsReturnState;
    if (prev === STATES.PAUSED) {
      HC.state = STATES.PAUSED;
      show(ui.pause, true);
    } else if (prev === STATES.HUB) {
      HC.state = STATES.HUB;
      show(ui.hub, true);
    } else if (prev === STATES.EXPLORATION) {
      HC.state = STATES.EXPLORATION;
      setMobileControlsVisible(true);
    } else {
      HC.state = STATES.TITLE;
    }
  }

  function renderComms() {
    if (!ui.commsContent) return;
    if (ui.tabOra) ui.tabOra.classList.toggle('active', currentCommsTab === 'ora');
    if (ui.tabLogs) ui.tabLogs.classList.toggle('active', currentCommsTab === 'logs');
    ui.commsContent.innerHTML = '';

    if (currentCommsTab === 'ora') {
      renderOraTransmissions(ui.commsContent);
    } else {
      renderAudioLogArchives(ui.commsContent);
    }
  }

  function renderOraTransmissions(c) {
    const curIdx = Math.min(HC.save.mission, MISSIONS.length - 1);
    const curM = MISSIONS[curIdx] || MISSIONS[0];
    const curPlanet = PLANETS[curM.planet] || PLANETS[0];

    if (ui.commsCounter) {
      ui.commsCounter.innerHTML = `<span style="color:#8fe7ff">Active Directive: #${curIdx + 1}</span><br>30 Directives · 5 Routes · Revelation`;
    }

    // Active Mission Banner
    const activeCard = document.createElement('div');
    activeCard.className = 'hc-comms-entry ora-active';
    activeCard.innerHTML = `
      <div class="hc-comms-entry-top">
        <span class="hc-comms-tag" style="color:#ff8547">▶ ACTIVE ORA DIRECTIVE // ${curPlanet.name.toUpperCase()}</span>
        <span class="hc-comms-source">Directive #${curIdx + 1} of 30</span>
      </div>
      <p class="hc-comms-text" style="color:#fff;font-weight:500;">"${curM.ora}"</p>
      <div class="hc-comms-meta">
        <span>Task: ${curM.objective} · System: ${curM.target.toUpperCase()} [${curM.puzzle.toUpperCase()}]</span>
        <button class="hc-comms-mini-btn" id="hc-play-active-ora">▶ Replay Chime</button>
      </div>
    `;
    activeCard.querySelector('#hc-play-active-ora').onclick = () => {
      if (window.HomecomingAudio) window.HomecomingAudio.play('ora_chime');
    };
    c.appendChild(activeCard);

    // Section 1: Campaign Directives
    const sec1Title = document.createElement('div');
    sec1Title.className = 'hc-comms-section-title';
    sec1Title.textContent = 'Campaign Mission Transmissions & Operational Briefings';
    c.appendChild(sec1Title);

    PLANETS.forEach((planet, pIdx) => {
      const planetMissions = MISSIONS.filter(m => m.planet === pIdx);
      if (!planetMissions.length) return;

      // Filter: only show missions that have been reached/unlocked
      const visibleMissions = planetMissions.filter(m => MISSIONS.indexOf(m) <= HC.save.mission);
      if (!visibleMissions.length) return;

      const groupDiv = document.createElement('div');
      groupDiv.style.marginBottom = '6px';
      groupDiv.innerHTML = `<div style="font-size:11px;font-weight:600;letter-spacing:.12em;color:#d9a98f;margin:8px 0 4px;text-transform:uppercase;">${planet.name} — ${planet.subtitle}</div>`;

      visibleMissions.forEach(m => {
        const mGlobalIdx = MISSIONS.indexOf(m);
        const isDone = mGlobalIdx < HC.save.mission;
        const isCurrent = mGlobalIdx === HC.save.mission;
        const statusLabel = isDone ? 'COMPLETED' : 'ACTIVE';
        const statusColor = isDone ? '#7dff8a' : '#ff8547';

        const entry = document.createElement('div');
        entry.className = 'hc-comms-entry' + (isCurrent ? ' ora-active' : '');
        entry.style.marginBottom = '6px';
        entry.innerHTML = `
          <div class="hc-comms-entry-top">
            <span class="hc-comms-tag" style="color:${statusColor}">${statusLabel} // #${mGlobalIdx + 1} ${m.name}</span>
            <span class="hc-comms-source">${m.type.toUpperCase()} · ${m.target.toUpperCase()}</span>
          </div>
          <p class="hc-comms-text">"${m.ora}"</p>
          <div class="hc-comms-meta">
            <span>Objective: ${m.objective}</span>
            <button class="hc-comms-mini-btn" data-ora-chime="1">▶ Chime</button>
          </div>
        `;
        entry.querySelector('[data-ora-chime]').onclick = () => {
          if (window.HomecomingAudio) window.HomecomingAudio.play('ora_chime');
        };
        groupDiv.appendChild(entry);
      });
      c.appendChild(groupDiv);
    });

    // Section 2: Interplanetary Transit Logs
    const sec2Title = document.createElement('div');
    sec2Title.className = 'hc-comms-section-title';
    sec2Title.textContent = 'Interplanetary Transit Transmissions';
    c.appendChild(sec2Title);

    const routes = [
      { key: 'mars-phobos', label: 'Mars Orbit to Phobos Station', dist: '6,000 km' },
      { key: 'phobos-europa', label: 'Phobos Station to Europa Ice Shell', dist: '550M km' },
      { key: 'europa-titan', label: 'Europa to Titan (Saturn Orbit)', dist: '780M km' },
      { key: 'titan-ceres', label: 'Titan to Ceres Asteroid Graveyard', dist: '620M km' },
      { key: 'ceres-earth', label: 'Ceres Asteroid Belt to Earth Homeward Vector', dist: '410M km' }
    ];
    routes.forEach(r => {
      const text = ORA_LINES.travel[r.key] || '';
      const entry = document.createElement('div');
      entry.className = 'hc-comms-entry';
      entry.innerHTML = `
        <div class="hc-comms-entry-top">
          <span class="hc-comms-tag" style="color:#8fe7ff">TRANSIT LOG // ${r.label}</span>
          <span class="hc-comms-source">${r.dist}</span>
        </div>
        <p class="hc-comms-text">"${text}"</p>
        <div class="hc-comms-meta">
          <span>Flight telemetry verified by ORA nav-core</span>
          <button class="hc-comms-mini-btn" data-ora-chime="1">▶ Chime</button>
        </div>
      `;
      entry.querySelector('[data-ora-chime]').onclick = () => {
        if (window.HomecomingAudio) window.HomecomingAudio.play('ora_chime');
      };
      c.appendChild(entry);
    });

    // Section 3: Destination Arrival Reports
    const sec3Title = document.createElement('div');
    sec3Title.className = 'hc-comms-section-title';
    sec3Title.textContent = 'Planetary Arrival Diagnostics & Environmental Scans';
    c.appendChild(sec3Title);

    Object.keys(ORA_LINES.arrival).forEach(k => {
      const loc = PLANETS.find(p => p.id === k) || { name: k.toUpperCase() };
      const text = ORA_LINES.arrival[k];
      const entry = document.createElement('div');
      entry.className = 'hc-comms-entry';
      entry.innerHTML = `
        <div class="hc-comms-entry-top">
          <span class="hc-comms-tag" style="color:#d9a98f">ARRIVAL BRIEF // ${loc.name.toUpperCase()}</span>
          <span class="hc-comms-source">ATMOSPHERIC TELEMETRY</span>
        </div>
        <p class="hc-comms-text">"${text}"</p>
        <div class="hc-comms-meta">
          <span>Automated scan upon touchdown / orbital insertion</span>
          <button class="hc-comms-mini-btn" data-ora-chime="1">▶ Chime</button>
        </div>
      `;
      entry.querySelector('[data-ora-chime]').onclick = () => {
        if (window.HomecomingAudio) window.HomecomingAudio.play('ora_chime');
      };
      c.appendChild(entry);
    });

    // Section 4: Scientific Discoveries & Cataloged Findings
    const sec4Title = document.createElement('div');
    sec4Title.className = 'hc-comms-section-title';
    sec4Title.textContent = 'Scientific Observations & Sample Catalogues';
    c.appendChild(sec4Title);

    ORA_LINES.discovery.forEach((disc, dIdx) => {
      const entry = document.createElement('div');
      entry.className = 'hc-comms-entry';
      entry.innerHTML = `
        <div class="hc-comms-entry-top">
          <span class="hc-comms-tag" style="color:#7dff8a">DISCOVERY LOG #${dIdx + 1}</span>
          <span class="hc-comms-source">SPECTROMETRY & ANALYSIS</span>
        </div>
        <p class="hc-comms-text">"${disc}"</p>
        <div class="hc-comms-meta">
          <span>Catalogued in expedition field database</span>
          <button class="hc-comms-mini-btn" data-ora-chime="1">▶ Chime</button>
        </div>
      `;
      entry.querySelector('[data-ora-chime]').onclick = () => {
        if (window.HomecomingAudio) window.HomecomingAudio.play('ora_chime');
      };
      c.appendChild(entry);
    });

    // Section 5: Operational Guidelines & Tactical Protocols
    const sec5Title = document.createElement('div');
    sec5Title.className = 'hc-comms-section-title';
    sec5Title.textContent = 'Operational Directives & EVA Protocols';
    c.appendChild(sec5Title);

    const hintLabels = {
      stuck: 'HUD Compass Waypoint Guidance',
      rover: 'Surface Rover Deployment & Speed',
      emp: 'EMP Pulse Security Disruption',
      puzzle: 'Terminal Hardware Diagnostics',
      components: 'Scattered Engine Salvage Recovery'
    };
    Object.keys(ORA_LINES.hints).forEach(k => {
      const label = hintLabels[k] || k.toUpperCase();
      const text = ORA_LINES.hints[k];
      const entry = document.createElement('div');
      entry.className = 'hc-comms-entry';
      entry.innerHTML = `
        <div class="hc-comms-entry-top">
          <span class="hc-comms-tag" style="color:#8fe7ff">TACTICAL PROTOCOL // ${label.toUpperCase()}</span>
          <span class="hc-comms-source">STANDARD OPERATING PROCEDURE</span>
        </div>
        <p class="hc-comms-text">"${text}"</p>
        <div class="hc-comms-meta">
          <span>Transmission trigger: field operations & telemetry check</span>
          <button class="hc-comms-mini-btn" data-ora-chime="1">▶ Chime</button>
        </div>
      `;
      entry.querySelector('[data-ora-chime]').onclick = () => {
        if (window.HomecomingAudio) window.HomecomingAudio.play('ora_chime');
      };
      c.appendChild(entry);
    });

    // Section 6: The Homeward Revelation
    const sec6Title = document.createElement('div');
    sec6Title.className = 'hc-comms-section-title';
    sec6Title.textContent = 'The Final Transmission // Homeward Revelation';
    c.appendChild(sec6Title);

    const revEntry = document.createElement('div');
    revEntry.className = 'hc-comms-entry';
    revEntry.style.borderLeftColor = '#ff6b38';
    revEntry.innerHTML = `
      <div class="hc-comms-entry-top">
        <span class="hc-comms-tag" style="color:#ff7440">CLASSIFIED SIGNAL // EARTH ORIGIN REVELATION</span>
        <button class="hc-comms-mini-btn" id="hc-play-dialogue-seq" style="border-color:#ff7440;color:#ff9b88">▶ Play Full Dialogue Sequence</button>
      </div>
      <div style="font-size:12px;color:var(--mut);line-height:1.7;margin:8px 0;">
        ${ORA_LINES.ending.map((line, idx) => `<div style="margin-bottom:6px"><b style="color:#8fe7ff">ORA [0${idx + 1}]:</b> "${line}"</div>`).join('')}
      </div>
      <div class="hc-comms-meta">
        <span>Broadcast origin: terrestrial ground station (active 7 years prior to mission launch)</span>
        <button class="hc-comms-mini-btn" id="hc-chime-rev">▶ Chime</button>
      </div>
    `;
    revEntry.querySelector('#hc-play-dialogue-seq').onclick = () => {
      closeComms();
      showDialogueSequence('THE HOMEWARD SIGNAL', ORA_LINES.ending);
    };
    revEntry.querySelector('#hc-chime-rev').onclick = () => {
      if (window.HomecomingAudio) window.HomecomingAudio.play('ora_chime');
    };
    c.appendChild(revEntry);
  }

  function renderAudioLogArchives(c) {
    let totalLogs = 0;
    let unlockedLogs = 0;
    Object.keys(AUDIO_LOGS).forEach(pKey => {
      (AUDIO_LOGS[pKey] || []).forEach(log => {
        totalLogs++;
        if (HC.save.audioLogs && HC.save.audioLogs.includes(log.id)) unlockedLogs++;
      });
    });

    if (ui.commsCounter) {
      ui.commsCounter.innerHTML = `<span style="color:#ffd84a">Recovered: ${unlockedLogs} / ${totalLogs} Beacons</span><br>Click any log to play audio`;
    }

    // Top Summary Banner
    const sumCard = document.createElement('div');
    sumCard.className = 'hc-comms-entry audio-log';
    sumCard.innerHTML = `
      <div class="hc-comms-entry-top">
        <span class="hc-comms-tag" style="color:#ffd84a">EXPEDITION AUDIO LOGS & BLACK BOX ARCHIVE</span>
        <span class="hc-comms-source">${unlockedLogs} Discovered · ${totalLogs - unlockedLogs} Hidden</span>
      </div>
      <p class="hc-comms-text" style="color:var(--fg)">
        Audio logs are recorded by expedition crews and automated black box beacons. Search planetary surfaces to recover glowing gold audio beacons during EVA exploration. Only recovered and decrypted logs are listed in this archive.
      </p>
      <div class="hc-comms-meta">
        <span>Audio frequency: 1420.4 MHz · High-gain relay</span>
      </div>
    `;
    c.appendChild(sumCard);

    // Group logs by planet — ONLY DISPLAY LOGS THAT THE PLAYER HAS ACTUALLY DISCOVERED!
    let anyLogRendered = false;
    PLANETS.forEach(planet => {
      const logs = AUDIO_LOGS[planet.id] || [];
      const discoveredLogs = logs.filter(log => HC.save.audioLogs && HC.save.audioLogs.includes(log.id));
      if (!discoveredLogs.length) return; // Completely hide planet if 0 logs discovered on it!

      anyLogRendered = true;
      const pTitle = document.createElement('div');
      pTitle.className = 'hc-comms-section-title';
      pTitle.textContent = `${planet.name.toUpperCase()} // ${planet.subtitle.toUpperCase()} (${discoveredLogs.length} DISCOVERED)`;
      c.appendChild(pTitle);

      discoveredLogs.forEach(log => {
        const entry = document.createElement('div');
        entry.className = 'hc-comms-entry audio-log';
        entry.style.marginBottom = '8px';

        entry.innerHTML = `
          <div class="hc-comms-entry-top">
            <span class="hc-comms-tag" style="color:#7dff8a">DECRYPTED // ${log.title.toUpperCase()}</span>
            <span class="hc-comms-source" style="font-family:monospace;letter-spacing:.08em;font-size:10px;">GRID [X: ${log.x > 0 ? '+' + log.x : log.x}, Z: ${log.z > 0 ? '+' + log.z : log.z}]</span>
          </div>
          <p class="hc-comms-text" style="color:#fff;font-style:italic;">"${log.text}"</p>
          <div class="hc-comms-meta">
            <span>Beacon ID: ${log.id} · Location: ${planet.name}</span>
            <button class="hc-comms-mini-btn" data-play-log="${log.id}">▶ Play Audio</button>
          </div>
        `;

        entry.querySelector(`[data-play-log="${log.id}"]`).onclick = () => {
          if (window.HomecomingAudio) window.HomecomingAudio.play('audiolog_play');
          showLog(log);
        };

        c.appendChild(entry);
      });
    });

    if (!anyLogRendered) {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'hc-comms-entry';
      emptyCard.style.textAlign = 'center';
      emptyCard.style.padding = '32px 20px';
      emptyCard.innerHTML = `
        <div style="font-size:24px;margin-bottom:10px;">📡</div>
        <div class="hc-comms-tag" style="color:var(--mut);font-size:11px;">NO AUDIO LOGS RECOVERED YET</div>
        <p class="hc-comms-text" style="color:var(--mut);margin-top:8px;font-size:12px;">
          Expedition audio beacons are scattered across planetary surfaces. Approach glowing gold signal beacons and press [E] to recover and decode crew audio logs.
        </p>
      `;
      c.appendChild(emptyCard);
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     3D PLANET GLOBES, PROCEDURAL TEXTURES & CELESTIAL BACKDROPS
     ───────────────────────────────────────────────────────────────────── */
  const PLANET_TEXTURE_CACHE = (window.PLANET_TEXTURE_CACHE = window.PLANET_TEXTURE_CACHE || {});
  let currentGlobeIndex = -1;
  let standardSphereGeo = null;
  let phobosAsteroidGeo = null;
  let planetCompanions = null;

  function createPhobosGeometry() {
    const geo = new THREE.SphereGeometry(1.45, 64, 48);
    const pos = geo.attributes.position;
    const stickney = new THREE.Vector3(1.1, 0.25, 0.4).normalize();
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      x *= 1.18; y *= 0.78; z *= 0.88;
      const bump = 1 + 0.12 * Math.sin(x * 3.5 + y * 2.1) * Math.cos(z * 3.1 + x * 1.8)
        + 0.06 * Math.sin(y * 7.2) * Math.sin(z * 6.5);
      x *= bump; y *= bump; z *= bump;
      const v = new THREE.Vector3(x, y, z);
      const dot = v.clone().normalize().dot(stickney);
      if (dot > 0.65) {
        const dist = Math.acos(Math.min(1, dot));
        const rad = 0.6;
        if (dist < rad) {
          const t = dist / rad;
          const depth = 0.28 * Math.cos(t * Math.PI * 0.5);
          const rim = 0.08 * Math.sin(t * Math.PI);
          v.sub(stickney.clone().multiplyScalar(depth - rim));
          x = v.x; y = v.y; z = v.z;
        }
      }
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  function getFbm() {
    const AC = window.ArcadeCore;
    if (AC && AC.fbm) return AC.fbm;
    return function (x, y, z, o) {
      let s = 0, a = 0.5;
      for (let i = 0; i < o; i++) {
        s += a * (Math.sin(x) * Math.cos(y) * Math.sin(z) * 0.5 + 0.5);
        x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5;
      }
      return s;
    };
  }

  function generateMarsTexture() {
    const W = 512, H = 256;
    const cMap = document.createElement('canvas'), cBump = document.createElement('canvas');
    cMap.width = cBump.width = W; cMap.height = cBump.height = H;
    const ctx = cMap.getContext('2d'), bCtx = cBump.getContext('2d');
    const imgData = ctx.createImageData(W, H), bumpData = bCtx.createImageData(W, H);
    const d = imgData.data, bd = bumpData.data;
    const fbm = getFbm();
    const lo = [90, 31, 18], mi = [196, 87, 43], hi = [236, 150, 92], dk = [46, 20, 14];
    for (let j = 0; j < H; j++) {
      const lat = (0.5 - j / H) * Math.PI, cl = Math.cos(lat), y = Math.sin(lat);
      for (let i = 0; i < W; i++) {
        const lon = (i / W - 0.5) * 6.2832, x = cl * Math.cos(lon), z = cl * Math.sin(lon);
        let h = fbm(x * 2.2, y * 2.2, z * 2.2, 5) * 0.65 + fbm(x * 7 + 9, y * 7 + 9, z * 7 + 9, 4) * 0.35;
        const dark = fbm(x * 1.6 + 50, y * 1.6 + 50, z * 1.6 + 50, 4);
        let t = Math.min(1, Math.max(0, (h - 0.3) * 2.2));
        let col = t < 0.5 ? [0, 1, 2].map(q => lo[q] + (mi[q] - lo[q]) * t * 2) : [0, 1, 2].map(q => mi[q] + (hi[q] - mi[q]) * (t - 0.5) * 2);
        const dm = Math.min(1, Math.max(0, (dark - 0.5) / 0.12)) * 0.75;
        col = col.map((v, q) => v + (dk[q] - v) * dm);
        if (Math.abs(y) > 0.93) {
          const w = (Math.abs(y) - 0.93) / 0.07;
          col = col.map(v => v + (248 - v) * Math.min(1, w) * 0.88);
        }
        const p = (j * W + i) * 4;
        d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = 255;
        const g = Math.max(0, Math.min(255, h * 300 - 30));
        bd[p] = bd[p + 1] = bd[p + 2] = g; bd[p + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0); bCtx.putImageData(bumpData, 0, 0);
    const map = new THREE.CanvasTexture(cMap), bump = new THREE.CanvasTexture(cBump);
    map.anisotropy = bump.anisotropy = 4;
    return [map, bump];
  }

  function generatePhobosTexture() {
    const W = 512, H = 256;
    const cMap = document.createElement('canvas'), cBump = document.createElement('canvas');
    cMap.width = cBump.width = W; cMap.height = cBump.height = H;
    const ctx = cMap.getContext('2d'), bCtx = cBump.getContext('2d');
    const imgData = ctx.createImageData(W, H), bumpData = bCtx.createImageData(W, H);
    const d = imgData.data, bd = bumpData.data;
    const fbm = getFbm();
    for (let j = 0; j < H; j++) {
      const lat = (0.5 - j / H) * Math.PI, cl = Math.cos(lat), y = Math.sin(lat);
      for (let i = 0; i < W; i++) {
        const lon = (i / W - 0.5) * 6.2832, x = cl * Math.cos(lon), z = cl * Math.sin(lon);
        let n = fbm(x * 3.5, y * 3.5, z * 3.5, 4);
        let fine = fbm(x * 12 + 10, y * 12 + 10, z * 12 + 10, 3);
        let groove = Math.abs(Math.sin((x * 0.8 + y * 1.6 + z * 0.4) * 26 + n * 2));
        groove = Math.pow(groove, 0.4);
        let val = (n * 0.6 + fine * 0.25 + 0.15) * (0.7 + 0.3 * groove);
        let r = Math.min(255, Math.max(20, Math.floor(48 + val * 65)));
        let g = Math.min(255, Math.max(20, Math.floor(52 + val * 68)));
        let b = Math.min(255, Math.max(20, Math.floor(58 + val * 75)));
        const p = (j * W + i) * 4;
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
        const bp = Math.min(255, Math.max(0, Math.floor(val * 240)));
        bd[p] = bd[p + 1] = bd[p + 2] = bp; bd[p + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0); bCtx.putImageData(bumpData, 0, 0);
    const map = new THREE.CanvasTexture(cMap), bump = new THREE.CanvasTexture(cBump);
    map.anisotropy = bump.anisotropy = 4;
    return [map, bump];
  }

  function generateEuropaTexture() {
    const W = 512, H = 256;
    const cMap = document.createElement('canvas'), cBump = document.createElement('canvas');
    cMap.width = cBump.width = W; cMap.height = cBump.height = H;
    const ctx = cMap.getContext('2d'), bCtx = cBump.getContext('2d');
    const imgData = ctx.createImageData(W, H), bumpData = bCtx.createImageData(W, H);
    const d = imgData.data, bd = bumpData.data;
    const fbm = getFbm();
    for (let j = 0; j < H; j++) {
      const lat = (0.5 - j / H) * Math.PI, cl = Math.cos(lat), y = Math.sin(lat);
      for (let i = 0; i < W; i++) {
        const lon = (i / W - 0.5) * 6.2832, x = cl * Math.cos(lon), z = cl * Math.sin(lon);
        const baseNoise = fbm(x * 2.5, y * 2.5, z * 2.5, 4);
        const l1 = Math.sin(lon * 2.8 + Math.cos(lat * 3.2) * 2.1 + baseNoise * 1.5);
        const l2 = Math.cos(lon * 3.5 - lat * 4.0 + fbm(x * 4, y * 4, z * 4, 3) * 2.0);
        const l3 = Math.sin((x * 1.5 + y * 2.5 - z * 1.8) * 5.0);
        let crack = Math.min(Math.abs(l1), Math.min(Math.abs(l2), Math.abs(l3)));
        let crackIntensity = 0;
        if (crack < 0.12) {
          crackIntensity = Math.pow(1 - crack / 0.12, 1.8);
        }
        const chaos = fbm(x * 6 + 15, y * 6 + 15, z * 6 + 15, 3);
        const isChaos = Math.max(0, chaos - 0.58) * 2.5;

        let r = 180 + baseNoise * 32;
        let g = 198 + baseNoise * 22;
        let b = 218 + baseNoise * 18;

        const rustR = 158, rustG = 72, rustB = 46;
        const stain = Math.min(1, crackIntensity * 0.95 + isChaos * 0.7);
        r = r * (1 - stain) + rustR * stain;
        g = g * (1 - stain) + rustG * stain;
        b = b * (1 - stain) + rustB * stain;

        if (Math.abs(y) > 0.88) {
          const pFrost = (Math.abs(y) - 0.88) / 0.12;
          r += (255 - r) * pFrost * 0.7;
          g += (255 - g) * pFrost * 0.7;
          b += (255 - b) * pFrost * 0.7;
        }

        const p = (j * W + i) * 4;
        d[p] = Math.min(255, Math.max(0, Math.floor(r)));
        d[p + 1] = Math.min(255, Math.max(0, Math.floor(g)));
        d[p + 2] = Math.min(255, Math.max(0, Math.floor(b)));
        d[p + 3] = 255;
        const bumpVal = Math.floor(120 + crackIntensity * 110 - isChaos * 40);
        bd[p] = bd[p + 1] = bd[p + 2] = Math.min(255, Math.max(0, bumpVal));
        bd[p + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0); bCtx.putImageData(bumpData, 0, 0);
    const map = new THREE.CanvasTexture(cMap), bump = new THREE.CanvasTexture(cBump);
    map.anisotropy = bump.anisotropy = 4;
    return [map, bump];
  }

  function generateTitanTexture() {
    const W = 512, H = 256;
    const cMap = document.createElement('canvas'), cBump = document.createElement('canvas');
    cMap.width = cBump.width = W; cMap.height = cBump.height = H;
    const ctx = cMap.getContext('2d'), bCtx = cBump.getContext('2d');
    const imgData = ctx.createImageData(W, H), bumpData = bCtx.createImageData(W, H);
    const d = imgData.data, bd = bumpData.data;
    const fbm = getFbm();
    for (let j = 0; j < H; j++) {
      const lat = (0.5 - j / H) * Math.PI, cl = Math.cos(lat), y = Math.sin(lat);
      for (let i = 0; i < W; i++) {
        const lon = (i / W - 0.5) * 6.2832, x = cl * Math.cos(lon), z = cl * Math.sin(lon);
        const haze = fbm(x * 1.8, y * 1.8, z * 1.8, 4);
        let r = 220 + haze * 30;
        let g = 145 + haze * 35;
        let b = 50 + haze * 25;

        let isSea = 0;
        if (y > 0.48) {
          const seaNoise = fbm(x * 5 + 30, y * 5 + 30, z * 5 + 30, 4);
          if (seaNoise > 0.52) {
            isSea = Math.min(1, (seaNoise - 0.52) / 0.1);
          }
        }
        let isDune = 0;
        if (Math.abs(y) < 0.28) {
          const duneNoise = fbm(x * 8 + 70, y * 4 + 70, z * 8 + 70, 3);
          if (duneNoise > 0.48) isDune = Math.min(1, (duneNoise - 0.48) / 0.15) * (1 - Math.abs(y) / 0.28);
        }

        if (isSea > 0) {
          r = r * (1 - isSea) + 18 * isSea;
          g = g * (1 - isSea) + 26 * isSea;
          b = b * (1 - isSea) + 38 * isSea;
        }
        if (isDune > 0) {
          r = r * (1 - isDune) + 82 * isDune;
          g = g * (1 - isDune) + 54 * isDune;
          b = b * (1 - isDune) + 32 * isDune;
        }

        const p = (j * W + i) * 4;
        d[p] = Math.min(255, Math.max(0, Math.floor(r)));
        d[p + 1] = Math.min(255, Math.max(0, Math.floor(g)));
        d[p + 2] = Math.min(255, Math.max(0, Math.floor(b)));
        d[p + 3] = 255;
        const bp = isSea > 0.5 ? 20 : Math.floor(100 + haze * 60 + isDune * 40);
        bd[p] = bd[p + 1] = bd[p + 2] = bp; bd[p + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0); bCtx.putImageData(bumpData, 0, 0);
    const map = new THREE.CanvasTexture(cMap), bump = new THREE.CanvasTexture(cBump);
    map.anisotropy = bump.anisotropy = 4;
    return [map, bump];
  }

  function generateCeresTexture() {
    const W = 512, H = 256;
    const cMap = document.createElement('canvas'), cBump = document.createElement('canvas');
    cMap.width = cBump.width = W; cMap.height = cBump.height = H;
    const ctx = cMap.getContext('2d'), bCtx = cBump.getContext('2d');
    const imgData = ctx.createImageData(W, H), bumpData = bCtx.createImageData(W, H);
    const d = imgData.data, bd = bumpData.data;
    const fbm = getFbm();
    const occatorPos = new THREE.Vector3(0.92, 0.35, 0.15).normalize();
    for (let j = 0; j < H; j++) {
      const lat = (0.5 - j / H) * Math.PI, cl = Math.cos(lat), y = Math.sin(lat);
      for (let i = 0; i < W; i++) {
        const lon = (i / W - 0.5) * 6.2832, x = cl * Math.cos(lon), z = cl * Math.sin(lon);
        let n = fbm(x * 3.2, y * 3.2, z * 3.2, 5);
        let craters = fbm(x * 9 + 40, y * 9 + 40, z * 9 + 40, 3);
        let val = n * 0.65 + craters * 0.35;
        let r = 50 + val * 55, g = 52 + val * 57, b = 60 + val * 62;
        let bump = val * 220;

        const v = new THREE.Vector3(x, y, z);
        const dist = v.distanceTo(occatorPos);
        if (dist < 0.26) {
          const t = dist / 0.26;
          bump = t < 0.8 ? bump * 0.4 : bump * 1.5;
          if (dist < 0.08) {
            const facula = 1 - dist / 0.08;
            r = r * (1 - facula) + 255 * facula;
            g = g * (1 - facula) + 255 * facula;
            b = b * (1 - facula) + 255 * facula;
            bump += facula * 80;
          }
          const v2 = v.clone().sub(new THREE.Vector3(0.04, 0.02, 0.06));
          if (v2.distanceTo(occatorPos) < 0.04) {
            r = Math.min(255, r + 180); g = Math.min(255, g + 180); b = Math.min(255, b + 180);
          }
        }

        const p = (j * W + i) * 4;
        d[p] = Math.min(255, Math.max(0, Math.floor(r)));
        d[p + 1] = Math.min(255, Math.max(0, Math.floor(g)));
        d[p + 2] = Math.min(255, Math.max(0, Math.floor(b)));
        d[p + 3] = 255;
        bd[p] = bd[p + 1] = bd[p + 2] = Math.min(255, Math.max(0, Math.floor(bump)));
        bd[p + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0); bCtx.putImageData(bumpData, 0, 0);
    const map = new THREE.CanvasTexture(cMap), bump = new THREE.CanvasTexture(cBump);
    map.anisotropy = bump.anisotropy = 4;
    return [map, bump];
  }

  function generateEarthTexture() {
    const W = 512, H = 256;
    const cMap = document.createElement('canvas'), cBump = document.createElement('canvas');
    cMap.width = cBump.width = W; cMap.height = cBump.height = H;
    const ctx = cMap.getContext('2d'), bCtx = cBump.getContext('2d');
    const imgData = ctx.createImageData(W, H), bumpData = bCtx.createImageData(W, H);
    const d = imgData.data, bd = bumpData.data;
    const fbm = getFbm();
    for (let j = 0; j < H; j++) {
      const lat = (0.5 - j / H) * Math.PI, cl = Math.cos(lat), y = Math.sin(lat);
      for (let i = 0; i < W; i++) {
        const lon = (i / W - 0.5) * 6.2832, x = cl * Math.cos(lon), z = cl * Math.sin(lon);
        const landVal = fbm(x * 1.8, y * 1.8, z * 1.8, 5);
        let r, g, b, bump;
        if (landVal > 0.48) {
          const elev = (landVal - 0.48) / 0.52;
          const climate = fbm(x * 4 + 10, y * 4 + 10, z * 4 + 10, 3);
          if (Math.abs(y) < 0.25 && climate > 0.5) {
            r = 185 + elev * 30; g = 145 + elev * 20; b = 90 + elev * 10;
          } else {
            r = 38 + elev * 40; g = 105 + elev * 50; b = 48 + elev * 20;
          }
          bump = Math.floor(120 + elev * 135);
        } else {
          const depth = landVal / 0.48;
          r = Math.floor(8 + depth * 14);
          g = Math.floor(25 + depth * 40);
          b = Math.floor(70 + depth * 60);
          bump = 30;
        }

        const cloud1 = fbm(x * 3.5 + 8, y * 3.5 + 8, z * 3.5 + 8, 4);
        const cloud2 = Math.sin(lon * 4 + lat * 3 + cloud1 * 3);
        if (cloud1 > 0.52 && Math.abs(cloud2) > 0.2) {
          const cAlpha = Math.min(1, (cloud1 - 0.52) * 3.2);
          r = r * (1 - cAlpha) + 255 * cAlpha;
          g = g * (1 - cAlpha) + 255 * cAlpha;
          b = b * (1 - cAlpha) + 255 * cAlpha;
        }

        if (Math.abs(y) > 0.82) {
          const ice = (Math.abs(y) - 0.82) / 0.18;
          r = r * (1 - ice) + 250 * ice;
          g = g * (1 - ice) + 252 * ice;
          b = b * (1 - ice) + 255 * ice;
          bump = Math.max(bump, 160);
        }

        const p = (j * W + i) * 4;
        d[p] = Math.min(255, Math.max(0, Math.floor(r)));
        d[p + 1] = Math.min(255, Math.max(0, Math.floor(g)));
        d[p + 2] = Math.min(255, Math.max(0, Math.floor(b)));
        d[p + 3] = 255;
        bd[p] = bd[p + 1] = bd[p + 2] = bump; bd[p + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0); bCtx.putImageData(bumpData, 0, 0);
    const map = new THREE.CanvasTexture(cMap), bump = new THREE.CanvasTexture(cBump);
    map.anisotropy = bump.anisotropy = 4;
    return [map, bump];
  }

  function generateJupiterTexture() {
    const W = 256, H = 128;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(W, H), d = id.data;
    for (let j = 0; j < H; j++) {
      const v = j / H;
      const band = Math.sin(v * 24 + Math.sin(v * 48) * 0.3);
      const isRedSpot = Math.abs(v - 0.65) < 0.08;
      for (let i = 0; i < W; i++) {
        const u = i / W;
        let r, g, b;
        if (band > 0.3) {
          r = 230; g = 210; b = 180;
        } else if (band > -0.3) {
          r = 195; g = 140; b = 95;
        } else {
          r = 150; g = 85; b = 50;
        }
        if (isRedSpot && Math.abs(u - 0.45) < 0.06) {
          r = 190; g = 65; b = 45;
        }
        const p = (j * W + i) * 4;
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    return new THREE.CanvasTexture(c);
  }

  function generateSaturnTexture() {
    const W = 256, H = 128;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(W, H), d = id.data;
    for (let j = 0; j < H; j++) {
      const v = j / H;
      const band = Math.sin(v * 16) * 0.15;
      const r = Math.floor(225 + band * 40);
      const g = Math.floor(198 + band * 35);
      const b = Math.floor(155 + band * 25);
      for (let i = 0; i < W; i++) {
        const p = (j * W + i) * 4;
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    return new THREE.CanvasTexture(c);
  }

  function generateSaturnRingTexture() {
    const W = 256, H = 16;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(W, H), d = id.data;
    for (let i = 0; i < W; i++) {
      const t = i / W;
      let alpha = 0;
      let r = 220, g = 195, b = 155;
      if (t > 0.05 && t < 0.35) {
        alpha = 90;
      } else if (t >= 0.35 && t < 0.68) {
        alpha = 240;
        r = 235; g = 210; b = 175;
      } else if (t >= 0.68 && t < 0.74) {
        alpha = 15;
      } else if (t >= 0.74 && t < 0.96) {
        alpha = 180;
      }
      for (let j = 0; j < H; j++) {
        const p = (j * W + i) * 4;
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = alpha;
      }
    }
    ctx.putImageData(id, 0, 0);
    return new THREE.CanvasTexture(c);
  }

  function getPlanetTexture(planetId) {
    if (PLANET_TEXTURE_CACHE[planetId]) return PLANET_TEXTURE_CACHE[planetId];
    let textures;
    if (planetId === 'phobos') textures = generatePhobosTexture();
    else if (planetId === 'europa') textures = generateEuropaTexture();
    else if (planetId === 'titan') textures = generateTitanTexture();
    else if (planetId === 'ceres') textures = generateCeresTexture();
    else if (planetId === 'earth') textures = generateEarthTexture();
    else textures = generateMarsTexture();
    PLANET_TEXTURE_CACHE[planetId] = textures;
    return textures;
  }

  function initPlanetCompanions() {
    if (planetCompanions) return;
    const AC = window.ArcadeCore;
    if (!AC || !AC.scene) return;
    planetCompanions = new THREE.Group();
    AC.scene.add(planetCompanions);
  }

  function setupCompanions(planetIndex) {
    initPlanetCompanions();
    if (!planetCompanions) return;
    while (planetCompanions.children.length > 0) {
      const obj = planetCompanions.children[0];
      planetCompanions.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    }

    if (planetIndex === 1) {
      // Phobos: Giant Mars in background + Orbital Docking Station
      const marsGeo = new THREE.SphereGeometry(10.5, 36, 36);
      const marsTex = getPlanetTexture('mars')[0];
      const marsMat = new THREE.MeshStandardMaterial({ map: marsTex, roughness: 0.9, metalness: 0 });
      const marsMesh = new THREE.Mesh(marsGeo, marsMat);
      marsMesh.position.set(-13, -2, -26);
      marsMesh.rotation.z = 0.4;
      planetCompanions.add(marsMesh);

      const station = new THREE.Group();
      station.position.set(2.4, 0.6, 0.4);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 12, 36), new THREE.MeshStandardMaterial({ color: 0x99aab8, metalness: 0.8, roughness: 0.3 }));
      ring.rotation.x = Math.PI / 2;
      station.add(ring);
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x1a3a60, metalness: 0.9, roughness: 0.2 });
      const wing1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.3), wingMat);
      wing1.position.set(1.1, 0, 0);
      const wing2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.3), wingMat);
      wing2.position.set(-1.1, 0, 0);
      station.add(wing1, wing2);
      const beaconLight = new THREE.PointLight(0x00e5ff, 1.2, 8);
      beaconLight.position.set(0, 0.3, 0);
      station.add(beaconLight);
      station.userData = { isStation: true };
      planetCompanions.add(station);

    } else if (planetIndex === 2) {
      // Europa: Giant Jupiter gas giant in background
      const jupGeo = new THREE.SphereGeometry(13.5, 40, 40);
      const jupTex = generateJupiterTexture();
      const jupMat = new THREE.MeshStandardMaterial({ map: jupTex, roughness: 0.85, metalness: 0 });
      const jupMesh = new THREE.Mesh(jupGeo, jupMat);
      jupMesh.position.set(-15, 3.5, -30);
      jupMesh.userData = { isJupiter: true };
      planetCompanions.add(jupMesh);

      const ioGeo = new THREE.SphereGeometry(0.35, 16, 16);
      const ioMat = new THREE.MeshStandardMaterial({ color: 0xd4a040, roughness: 0.8 });
      const ioMesh = new THREE.Mesh(ioGeo, ioMat);
      ioMesh.position.set(-7.5, 7.0, -22);
      planetCompanions.add(ioMesh);

    } else if (planetIndex === 3) {
      // Titan: Giant Saturn with tilted planetary rings in background
      const satGeo = new THREE.SphereGeometry(8.5, 36, 36);
      const satTex = generateSaturnTexture();
      const satMat = new THREE.MeshStandardMaterial({ map: satTex, roughness: 0.85, metalness: 0 });
      const satMesh = new THREE.Mesh(satGeo, satMat);
      satMesh.position.set(-15, 4.0, -32);

      const ringGeo = new THREE.RingGeometry(10.5, 21.0, 64);
      const p = ringGeo.attributes.position;
      const uvs = ringGeo.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const rad = Math.hypot(p.getX(i), p.getY(i));
        const u = (rad - 10.5) / (21.0 - 10.5);
        uvs.setXY(i, u, 0.5);
      }
      ringGeo.uvsNeedUpdate = true;
      const ringTex = generateSaturnRingTexture();
      const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = 1.05;
      ringMesh.rotation.y = -0.3;
      satMesh.add(ringMesh);
      planetCompanions.add(satMesh);

    } else if (planetIndex === 4) {
      // Ceres: Asteroid belt field & derelict spacecraft debris
      const belt = new THREE.Group();
      const chunkGeo = new THREE.DodecahedronGeometry(0.18, 1);
      const chunkMat = new THREE.MeshStandardMaterial({ color: 0x444855, roughness: 0.95 });
      for (let i = 0; i < 14; i++) {
        const chunk = new THREE.Mesh(chunkGeo, chunkMat);
        const ang = (i / 14) * Math.PI * 2;
        const rad = 3.6 + (i % 3) * 0.8;
        chunk.position.set(Math.cos(ang) * rad, ((i % 5) - 2) * 0.4, Math.sin(ang) * rad);
        chunk.rotation.set(i, i * 2, 0);
        chunk.scale.setScalar(0.6 + (i % 4) * 0.3);
        belt.add(chunk);
      }
      const shipBeacon = new THREE.PointLight(0xffa500, 1.0, 6);
      shipBeacon.position.set(3.2, 0.5, -1.0);
      belt.add(shipBeacon);
      belt.userData = { isAsteroidBelt: true };
      planetCompanions.add(belt);

    } else if (planetIndex === 5) {
      // Earth: Earth's Moon (Luna)
      const moonGeo = new THREE.SphereGeometry(0.52, 24, 24);
      const moonMat = new THREE.MeshStandardMaterial({ color: 0x9fa4ab, roughness: 0.95 });
      const moonMesh = new THREE.Mesh(moonGeo, moonMat);
      moonMesh.position.set(4.4, 1.2, -4.0);
      moonMesh.userData = { isMoon: true };
      planetCompanions.add(moonMesh);
    }
  }

  function setGlobePlanet(planetIndex) {
    planetIndex = clamp(planetIndex, 0, PLANETS.length - 1);
    currentGlobeIndex = planetIndex;
    const p = PLANETS[planetIndex];
    const AC = window.ArcadeCore;
    if (!AC) return;

    if (!standardSphereGeo) {
      standardSphereGeo = (AC.mesh && AC.mesh.geometry) ? AC.mesh.geometry : (typeof THREE !== 'undefined' ? new THREE.SphereGeometry(1.8, 64, 48) : null);
    }
    if (!phobosAsteroidGeo) phobosAsteroidGeo = createPhobosGeometry();
    initPlanetCompanions();

    // 1. Geometry & Mesh Visibility
    if (AC.mesh) {
      if (planetIndex === 1) {
        AC.mesh.geometry = phobosAsteroidGeo;
      } else if (standardSphereGeo) {
        AC.mesh.geometry = standardSphereGeo;
      }
      AC.mesh.visible = true;
    }
    if (AC.planet) {
      AC.planet.visible = true;
      AC.planet.scale.setScalar(1.0);
    }

    // 2. Texture
    const [map, bump] = getPlanetTexture(p.id);
    if (AC.mat) {
      AC.mat.map = map;
      AC.mat.bumpMap = bump;
      AC.mat.color.set(0xffffff);
      AC.mat.needsUpdate = true;
    }

    // 3. Atmosphere
    if (AC.atmUniforms) {
      if (planetIndex === 1) { // Phobos (airless)
        AC.atmUniforms.uColor.value.setHex(0x556677);
        AC.atmUniforms.uIntensity.value = 0.0;
        if (AC.atm) AC.atm.visible = false;
      } else if (planetIndex === 2) { // Europa
        AC.atmUniforms.uColor.value.setHex(0x55d5ff);
        AC.atmUniforms.uIntensity.value = 0.85;
        if (AC.atm) AC.atm.visible = true;
      } else if (planetIndex === 3) { // Titan
        AC.atmUniforms.uColor.value.setHex(0xffa535);
        AC.atmUniforms.uIntensity.value = 2.4;
        if (AC.atm) AC.atm.visible = true;
      } else if (planetIndex === 4) { // Ceres
        AC.atmUniforms.uColor.value.setHex(0x8899bb);
        AC.atmUniforms.uIntensity.value = 0.35;
        if (AC.atm) AC.atm.visible = true;
      } else if (planetIndex === 5) { // Earth
        AC.atmUniforms.uColor.value.setHex(0x4fa8ff);
        AC.atmUniforms.uIntensity.value = 2.0;
        if (AC.atm) AC.atm.visible = true;
      } else { // Mars
        AC.atmUniforms.uColor.value.setHex(0xff6b38);
        AC.atmUniforms.uIntensity.value = 1.6;
        if (AC.atm) AC.atm.visible = true;
      }
    }

    // 4. Moons & Decor
    if (AC.moons) {
      if (planetIndex === 0) AC.moons.forEach(m => m.o.visible = true);
      else AC.moons.forEach(m => m.o.visible = false);
    }
    if (AC.decor) {
      AC.decor.visible = (planetIndex === 0 && AC.cam && AC.cam.position.z < 4.8);
    }

    // 5. Celestial Companions
    setupCompanions(planetIndex);
  }

  function updateGlobe(t) {
    if (planetCompanions && planetCompanions.children.length > 0) {
      planetCompanions.children.forEach(c => {
        if (c.userData.isStation) {
          c.rotation.y = t * 0.15;
        } else if (c.userData.isJupiter) {
          c.rotation.y = t * 0.008;
        } else if (c.userData.isAsteroidBelt) {
          c.rotation.y = t * 0.02;
        } else if (c.userData.isMoon) {
          const a = t * 0.04;
          c.position.set(Math.cos(a) * 4.5, 1.2, Math.sin(a) * 4.5 - 2);
        }
      });
    }
    const AC = window.ArcadeCore;
    if (AC && AC.planet && AC.atm) {
      AC.atm.position.copy(AC.planet.position);
      AC.atm.scale.copy(AC.planet.scale);
    }
  }

  function updateOrbitalView(state, planetIdx) {
    const AC = window.ArcadeCore;
    if (!AC) return;
    const pIdx = (planetIdx != null && planetIdx >= 0) ? planetIdx : ((HC.save && HC.save.planet) || 0);

    // 1. Camera orientation & position
    if (AC.cam) {
      AC.cam.fov = 40;
      AC.cam.updateProjectionMatrix();
      if (state === STATES.TRAVEL) {
        AC.cam.position.set(0, 0, 5.2);
        AC.cam.rotation.set(0, 0, 0);
        AC.cam.lookAt(0, 0, 0);
      } else {
        AC.cam.position.set(0, 0, 5.5);
        AC.cam.rotation.set(0, 0, 0);
        AC.cam.lookAt(0, 0, 0);
      }
    }

    // 2. Planet position & scale
    if (AC.planet) {
      AC.planet.visible = true;
      AC.planet.scale.setScalar(1.0);
      if (state === STATES.TRAVEL) {
        AC.planet.position.set(0, 0, 0);
      } else {
        const offsetX = window.innerWidth > 850 ? 1.4 : 0.5;
        AC.planet.position.set(offsetX, 0, 0);
      }
    }

    // 3. Atmosphere
    if (AC.atm && AC.planet) {
      AC.atm.visible = (pIdx !== 1); // Phobos is airless
      AC.atm.position.copy(AC.planet.position);
      AC.atm.scale.copy(AC.planet.scale);
    }

    // 4. Fog & Background - Never leave surface fog active in space/orbit
    if (AC.scene) {
      AC.scene.fog = null;
      AC.scene.background = null;
    }

    // 5. Starfield & companions
    if (AC.stars) AC.stars.visible = true;
    if (AC.brightStars) AC.brightStars.visible = true;
    if (AC.nebulae) AC.nebulae.visible = true;
    if (AC.stardust) AC.stardust.visible = true;
    if (AC.decor) AC.decor.visible = (pIdx === 0 && (!AC.cam || AC.cam.position.z < 4.8));
    if (planetCompanions) planetCompanions.visible = true;
  }

  function updateTitleScreenInfo() {
    const kicker = document.getElementById('hc-land-kicker');
    const titleH1 = document.getElementById('brand-title') || document.querySelector('#land h1');
    const subtitle = document.getElementById('brand-subtitle');
    const desc = document.getElementById('brand-desc') || document.querySelector('#land p');
    const cont = document.getElementById('hc-continue');
    const go = document.getElementById('go');
    const newBtn = document.getElementById('hc-new-expedition');
    const resetBtn = document.getElementById('hc-reset-expedition');

    if (hasProgress()) {
      const save = loadSave();
      const p = PLANETS[save.planet || 0] || PLANETS[0];
      const m = save.mission < MISSIONS.length ? MISSIONS[save.mission] : null;

      if (kicker) kicker.textContent = `${p.chapter.toUpperCase()} · CURRENT TARGET`;
      if (titleH1) titleH1.textContent = 'HOMECOMING';
      if (subtitle) subtitle.textContent = `${p.subtitle} (${p.name.toUpperCase()})`;
      if (desc) desc.textContent = p.description || 'Survey celestial anomalies and recover lost expedition signals.';
      if (cont) cont.textContent = `MISSION: ${m ? m.name : 'Sector Objectives Complete'}`;
      if (go) {
        go.textContent = 'Continue Expedition';
        go.style.gridColumn = '1 / -1';
      }

      if (newBtn) {
        newBtn.style.display = 'flex';
        newBtn.style.gridColumn = '';
        newBtn.onclick = () => {
          if (confirm('Start a new expedition? Your current saved progress will be replaced.')) begin(true);
        };
      }
      if (resetBtn) resetBtn.style.display = 'none';
    } else {
      if (kicker) kicker.textContent = 'PROJECT HOMECOMING // ORBITAL COMMAND';
      if (titleH1) titleH1.textContent = 'HOMECOMING';
      if (subtitle) subtitle.textContent = 'CHAPTER 1 · THE RED SILENCE';
      if (desc) desc.textContent = 'A deep-space reconnaissance expedition across the outer solar system. Reconstruct lost transmissions, locate research outposts, and guide the crew home.';
      if (cont) cont.textContent = 'MISSION: Signal Beacon Protocol (Mars)';
      if (go) {
        go.textContent = 'Play Expedition';
        go.style.gridColumn = '';
      }

      if (newBtn) newBtn.style.display = 'none';
      if (resetBtn) resetBtn.style.display = 'none';
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     HUB — planet information & "Explore Surface" button
     ───────────────────────────────────────────────────────────────────── */
  function showHub(planetIndex) {
    planetIndex = clamp(planetIndex, 0, PLANETS.length - 1);
    const p = PLANETS[planetIndex];
    HC.state = STATES.HUB;
    if (window.HomecomingAudio) {
      window.HomecomingAudio.stopSuitBreathing();
      window.HomecomingAudio.stopRoverEngine();
      window.HomecomingAudio.stopDrone();
      window.HomecomingAudio.setAmbience('title');
      window.HomecomingAudio.startMusic();
    }
    show(ui.intro, false);
    show(ui.hud, false);
    show(ui.puzzle, false);
    show(ui.pause, false);
    show(ui.chapter, false);
    show(ui.travel, false);
    show(ui.ending, false);
    show(ui.dialogue, false);
    show(ui.hub, true);

    const AC = window.ArcadeCore;
    if (AC) {
      if (AC.planet) AC.planet.visible = true;
      if (AC.atm) AC.atm.visible = true;
      if (AC.stars) AC.stars.visible = true;
      if (AC.brightStars) AC.brightStars.visible = true;
      if (AC.nebulae) AC.nebulae.visible = true;
      if (AC.stardust) AC.stardust.visible = true;
      if (AC.scene) {
        AC.scene.background = null;
        AC.scene.fog = null;
      }
      if (AC.renderer) {
        AC.renderer.toneMapping = THREE.NoToneMapping;
        AC.renderer.toneMappingExposure = 1.0;
      }
    }
    if (planetCompanions) planetCompanions.visible = true;

    // Switch 3D globe to this planet and align orbital camera & globe framing!
    setGlobePlanet(planetIndex);
    updateOrbitalView(STATES.HUB, planetIndex);

    ui.hubName.textContent = p.name.toUpperCase();
    ui.hubSubtitle.textContent = p.subtitle;
    ui.hubDescription.textContent = p.description;
    ui.hubRoute.textContent = p.chapter + ' · CURRENT DESTINATION';
    // Show current mission for this planet
    const m = mission();
    if (m && m.planet === planetIndex) {
      ui.hubMission.textContent = 'MISSION: ' + m.name;
      ui.hubMission.style.display = '';
    } else if (m && m.planet > planetIndex) {
      ui.hubMission.textContent = 'ALL MISSIONS COMPLETE · FREE RECONNAISSANCE';
      ui.hubMission.style.display = '';
    } else {
      ui.hubMission.textContent = 'TRAVEL REQUIRED';
      ui.hubMission.style.display = '';
    }
    // Build clickable route list with open-world flight capabilities
    let routeHTML = '';
    PLANETS.forEach((pl, i) => {
      const isTargetSector = (m && m.planet === i);
      const unlocked = HC.save.unlocked.includes(pl.name) || i === 0 || HC.save.postGameUnlocked || isTargetSector;
      const current = i === planetIndex;
      const done = m ? m.planet > i : false;
      const statusText = current ? '▸ CURRENT' : (done ? '✓ COMPLETE · [FLY HERE]' : (unlocked ? 'UNLOCKED · [FLY HERE]' : '🔒 LOCKED'));
      routeHTML += '<button class="hc-route-item' + (current ? ' active' : '') + '" data-planet="' + i + '" ' + (unlocked ? '' : 'disabled') + '>' +
        '<span>' + (current ? '<b>▸ ' : '') + pl.name + (current ? '</b>' : '') + '</span>' +
        '<span style="font-size:9px;opacity:.9">' + statusText + '</span>' +
        '</button>';
    });
    ui.routeList.innerHTML = routeHTML;

    // Attach click events to route items: triggers interplanetary transit cutscene to any unlocked/completed world!
    ui.routeList.querySelectorAll('.hc-route-item').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const pIdx = parseInt(btn.getAttribute('data-planet'), 10);
        if (isNaN(pIdx)) return;
        const targetPlanet = PLANETS[pIdx];
        const isTargetSector = (m && m.planet === pIdx);
        const isUnlocked = HC.save.unlocked.includes(targetPlanet.name) || pIdx === 0 || HC.save.postGameUnlocked || isTargetSector;
        if (!isUnlocked) return;
        if (pIdx !== planetIndex) {
          startTravelTo(pIdx, false);
        } else {
          ui.routeList.classList.remove('open');
        }
      };
    });

    // Make sure save reflects this planet if unlocked
    if (HC.save.unlocked.includes(p.name) || planetIndex === 0) {
      HC.save.planet = planetIndex;
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     TRAVEL — open-world interplanetary transit & arrival cutscenes
     ───────────────────────────────────────────────────────────────────── */
  function startTravelTo(toPlanetIdx, isCampaignProgression = false, fromDeparture = false) {
    toPlanetIdx = clamp(toPlanetIdx, 0, PLANETS.length - 1);
    const fromPlanet = currentPlanet();
    const toPlanet = PLANETS[toPlanetIdx];

    if (fromPlanet.id === toPlanet.id && !isCampaignProgression) {
      showHub(toPlanetIdx);
      return;
    }

    // Playable Space Departure Sequence (takeoff -> cockpit flight -> jump -> wormhole)
    if (!fromDeparture && window.HomecomingDeparture) {
      if (window.HomecomingDeparture.isActive()) return;
      const wasOnSurface = !!(HC.world && HC.world.visible);
      HC.state = STATES.DEPARTURE;
      show(ui.hud, false);
      show(ui.chapter, false);
      show(ui.hub, false);
      show(ui.pause, false);
      if (planetCompanions) planetCompanions.visible = false;
      if (HC.astronaut && HC.astronaut.group) HC.astronaut.group.visible = false;
      if (HC.astronaut && HC.astronaut.contactShadow) HC.astronaut.contactShadow.visible = false;
      if (HC.rover) HC.rover.driving = false;
      resetRoverCamera();
      if (!wasOnSurface && HC.world) HC.world.visible = false;

      // Hide the static surface spacecraft model in HC.world so it doesn't duplicate during takeoff!
      let launchPos = fromPlanet.launch || [-2, -2];
      let launchY = 0;
      if (HC.world) {
        HC.world.traverse(obj => {
          if (obj.name && obj.name.startsWith('main-spacecraft')) {
            launchPos = [obj.position.x, obj.position.z];
            launchY = obj.position.y;
            obj.visible = false;
          }
        });
      }

      window.HomecomingDeparture.start({
        fromPlanet: fromPlanet,
        toPlanet: toPlanet,
        toPlanetIndex: toPlanetIdx,
        isCampaignProgression: isCampaignProgression,
        fromSurface: wasOnSurface,
        launchPos: launchPos,
        launchY: launchY,
        onComplete: () => {
          // Seamless transition into existing travel cinematic
          startTravelTo(toPlanetIdx, isCampaignProgression, true);
        }
      });
      return;
    }

    // Clean up current world
    if (HC.world) { scene.remove(HC.world); HC.world = null; }

    HC.state = STATES.TRAVEL;
    if (window.HomecomingAudio) {
      window.HomecomingAudio.play('departure');
      window.HomecomingAudio.stopSuitBreathing();
      window.HomecomingAudio.stopRoverEngine();
      window.HomecomingAudio.stopDrone();
      window.HomecomingAudio.setAmbience('space_travel');
    }
    show(ui.hud, false);
    show(ui.chapter, false);
    show(ui.hub, false);
    show(ui.pause, false);

    // Show travel cutscene UI
    show(ui.travel, true);
    const routeKey = fromPlanet.id + '-' + toPlanet.id;
    let oraLine = ORA_LINES.travel[routeKey];
    if (!oraLine) {
      if (toPlanetIdx < (HC.save.planet || 0)) {
        oraLine = 'Course correction plotted. Returning to ' + toPlanet.name + '. Orbital archives and surface reconnaissance telemetry synced.';
      } else {
        oraLine = 'Interplanetary transfer burn calculated for ' + toPlanet.name + '. Engaging sub-light cruise.';
      }
    }
    ui.travelRoute.textContent = fromPlanet.name.toUpperCase() + ' → ' + toPlanet.name.toUpperCase();
    ui.travelTitle.textContent = toPlanet.name.toUpperCase();
    ui.travelText.textContent = oraLine;
    ui.travelProgress.style.width = '0%';

    // Show title scene objects during travel for visual backdrop
    setGlobePlanet(toPlanetIdx);
    updateOrbitalView(STATES.TRAVEL, toPlanetIdx);

    // Animate progress bar over 4.5 seconds
    HC.travelStart = performance.now();
    HC.travelDuration = 4500;
    HC.travelDestination = toPlanetIdx;

    // Unlock the destination planet
    if (!HC.save.unlocked.includes(toPlanet.name)) {
      HC.save.unlocked.push(toPlanet.name);
    }
    if (!HC.save.stats.planetsVisited.includes(toPlanet.name)) {
      HC.save.stats.planetsVisited.push(toPlanet.name);
    }
    HC.save.departureReady = false;
    HC.save.planet = toPlanetIdx;
    persist();
  }

  function beginTravel() {
    const m = mission();
    if (!m) { showEnding(); return; }
    startTravelTo(m.planet, true);
  }

  function updateTravel() {
    if (HC.state !== STATES.TRAVEL) return;
    updateOrbitalView(STATES.TRAVEL, HC.travelDestination);
    const elapsed = performance.now() - HC.travelStart;
    const progress = Math.min(1, elapsed / HC.travelDuration);
    ui.travelProgress.style.width = (progress * 100) + '%';

    // Slowly rotate the planet during travel
    const AC = window.ArcadeCore;
    if (AC && AC.planet) {
      AC.planet.rotation.y += 0.005;
    }
    if (typeof S !== 'undefined') {
      S.ry += 0.003;
    }

    if (progress >= 1) {
      finishTravel();
    }
  }

  function finishTravel() {
    show(ui.travel, false);
    const dest = (HC.travelDestination != null) ? HC.travelDestination : (HC.save.planet || 0);
    HC.save.planet = dest;
    persist();
    if (window.HomecomingAudio) window.HomecomingAudio.play('arrival');

    // Build the destination planet world
    makeWorld();

    // Show arrival cutscene dialogue
    const p = PLANETS[dest];
    const m = mission();
    const isCompleted = m ? (m.planet > dest) : false;
    const arrivalLine = isCompleted
      ? ('Welcome back to ' + p.name + ', Commander. Orbital telemetry synced. Surface reconnaissance grid is active.')
      : (ORA_LINES.arrival[p.id] || ('Orbital insertion complete around ' + p.name + '. Surface deployment ready.'));

    setGlobePlanet(dest);
    updateOrbitalView(STATES.HUB, dest);

    showDialogueSequence('ARRIVAL — ' + p.name.toUpperCase(), [
      'Approaching ' + p.name + ' orbital perimeter.',
      arrivalLine,
      'Surface deployment ready. Proceed to the orbital hub.'
    ], () => {
      setGlobePlanet(dest);
      showHub(dest);
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     3D world construction & PBR Materials
     ───────────────────────────────────────────────────────────────────── */
  function material(color, roughness, emissive, metalness) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: roughness == null ? .86 : roughness,
      metalness: metalness == null ? .08 : metalness,
      emissive: emissive || 0x000000
    });
  }
  function pbrMetal(color, roughness, metalness) {
    return new THREE.MeshStandardMaterial({
      color: color || 0xc0c8d0,
      roughness: roughness == null ? .32 : roughness,
      metalness: metalness == null ? .88 : metalness
    });
  }
  function pbrFabric(color, roughness) {
    return new THREE.MeshStandardMaterial({
      color: color || 0xd5d2cc,
      roughness: roughness == null ? .82 : roughness,
      metalness: 0.02
    });
  }
  function pbrGlass(color, roughness, metalness, clearcoat) {
    return new THREE.MeshPhysicalMaterial({
      color: color || 0x060f18,
      roughness: roughness == null ? .06 : roughness,
      metalness: metalness == null ? .92 : metalness,
      clearcoat: clearcoat == null ? 1.0 : clearcoat,
      clearcoatRoughness: 0.05,
      reflectivity: 0.95
    });
  }
  function pbrRubber(color, roughness) {
    return new THREE.MeshStandardMaterial({
      color: color || 0x141618,
      roughness: roughness == null ? .92 : roughness,
      metalness: 0.0
    });
  }

  function enableShadows(obj, cast = true, receive = true) {
    if (!obj) return;
    if (obj.isMesh) {
      obj.castShadow = cast;
      obj.receiveShadow = receive;
    }
    if (obj.children && obj.children.length) {
      obj.children.forEach(c => enableShadows(c, cast, receive));
    }
  }

  // r128 predates THREE.CapsuleGeometry. This small compound mesh keeps the
  // placeholder astronaut compatible with the renderer version Mars Arcade uses.
  function capsule(radius, length, mat) {
    const g = new THREE.Group(), cylinder = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), mat), top = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), mat), bottom = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), mat);
    top.position.y = length * .5; bottom.position.y = -length * .5; g.add(cylinder, top, bottom); return g;
  }
  function mesh(geo, mat, x, z, lift) { const m = new THREE.Mesh(geo, mat); m.position.copy(pos(x || 0, z || 0, lift)); return m; }
  function makeTerrain(root) {
    const geo = new THREE.PlaneGeometry(240, 240, 140, 140);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, colors = new Float32Array(p.count * 3);
    const planet = HC.planet || PLANETS[0];
    const pId = planet.id;
    const palette = planet.palette, low = new C(palette[0]), mid = new C(palette[1]), high = new C(palette[2]), rock = new C(palette[3]), cc = new C();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = terrainHeight(x, z), n = noise(x * .12 + 7, z * .12 - 11);
      p.setY(i, h);
      if (pId === 'europa') {
        // Deep ice crevasse sapphire in lows, cyan ice mids, bright white snow/frost on ridges
        const ridgeVal = Math.pow(Math.abs(Math.sin(x * 0.055 + z * 0.035)), 1.6);
        cc.copy(low).lerp(mid, clamp((h + 2) / 3.5, 0, 1));
        if (ridgeVal > 0.6) cc.lerp(new C(0xffffff), (ridgeVal - 0.6) * 2.2);
        if (h < -0.8) cc.lerp(new C(0x1a4568), 0.7);
      } else if (pId === 'titan') {
        // Dark liquid hydrocarbon shorelines in depressions, rich amber sands, bright golden dunes
        if (x < -18 && h <= -1.4) {
          cc.setHex(0x1a1208);
        } else {
          cc.copy(low).lerp(mid, clamp((h + 1.5) / 3.8, 0, 1)).lerp(high, Math.max(0, n - 0.5) * 1.5);
        }
      } else if (pId === 'ceres') {
        // Dark carbonaceous regolith with brilliant white salt-dome faculae (Occator Cerealia Facula)
        cc.copy(low).lerp(mid, clamp((h + 2) / 4.0, 0, 1));
        const distToDome = Math.hypot(x - 12, z + 12);
        if (distToDome < 8.5) {
          cc.lerp(new C(0xf0f4ff), clamp((8.5 - distToDome) / 5.5, 0, 1));
        }
        if (n < 0.2) cc.lerp(rock, 0.6);
      } else if (pId === 'phobos') {
        // High contrast moonlet: deep black crater shadows, silvery gunmetal regolith
        cc.copy(low).lerp(mid, clamp((h + 2.5) / 4.5, 0, 1)).lerp(high, Math.max(0, n - 0.6) * 1.8);
        if (h < -1.8) cc.lerp(new C(0x0a0c10), 0.85);
      } else if (pId === 'earth') {
        // Emerald valleys, slate river channels, lush rolling hills
        cc.copy(low).lerp(mid, clamp((h + 1.2) / 3.2, 0, 1)).lerp(high, Math.max(0, n - 0.55) * 1.4);
        if (h < -0.6) cc.lerp(new C(0x1a3a35), 0.75);
      } else {
        // Mars
        cc.copy(low).lerp(mid, clamp((h + 1.5) / 3.7, 0, 1)).lerp(high, Math.max(0, n - .65) * 1.7);
        if (n < .14) cc.lerp(rock, .6);
      }
      colors[i * 3] = cc.r; colors[i * 3 + 1] = cc.g; colors[i * 3 + 2] = cc.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: pId === 'europa' ? .28 : (pId === 'earth' ? .82 : .95),
      metalness: pId === 'europa' ? .18 : (pId === 'phobos' ? .12 : 0)
    });
    // Procedural micro-texture injection for tactile regolith surface grain & roughness variation
    groundMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldPos;'
      ).replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;'
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPos;
        float regolithHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float regolithNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(regolithHash(i), regolithHash(i + vec2(1.0, 0.0)), f.x),
                     mix(regolithHash(i + vec2(0.0, 1.0)), regolithHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }`
      ).replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float finePebble = regolithNoise(vWorldPos.xz * 8.0) * 0.5 + regolithNoise(vWorldPos.xz * 24.0) * 0.5;
        roughnessFactor = clamp(roughnessFactor * (0.85 + finePebble * 0.28), 0.05, 1.0);`
      ).replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float tactileGrain = (regolithNoise(vWorldPos.xz * 9.0) - 0.5) * 0.08;
        gl_FragColor.rgb = clamp(gl_FragColor.rgb + vec3(tactileGrain), 0.0, 1.0);`
      );
    };
    const ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    root.add(ground);

    const dustColor = pId === 'europa' ? 0x9eeeff : (pId === 'titan' ? 0xffb14f : (pId === 'earth' ? 0x9fe8cc : palette[2]));
    const dust = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: dustColor, size: pId === 'europa' ? .22 : .18, transparent: true, opacity: .28 }));
    const pts = new Float32Array(1200); for (let i = 0; i < 400; i++) { pts[i * 3] = (Math.random() - .5) * 200; pts[i * 3 + 1] = 1.5 + Math.random() * 14; pts[i * 3 + 2] = (Math.random() - .5) * 200; }
    dust.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3)); root.add(dust); HC.dust = dust;
  }
  function makeRockField(root) {
    const planet = HC.planet || PLANETS[0];
    const pId = planet.id;
    const avoid = [[0, 0], [7, 8], [-31, 20], [28, -26], [-42, -38], [30, -23], [-2, -2], [-34, -30], [3, -7], [5, -26], [-2, -9]];

    if (pId === 'europa') {
      // Europa: Glowing cyan ice crystals & ice boulders embedded firmly in frozen crust
      const crystalGeo = new THREE.ConeGeometry(0.35, 2.6, 5);
      const crystalMat = new THREE.MeshStandardMaterial({
        color: 0x9beeff,
        roughness: 0.16,
        metalness: 0.35,
        emissive: 0x113348
      });
      const iceBoulderGeo = new THREE.DodecahedronGeometry(1.0, 1);
      const iceBoulderMat = new THREE.MeshStandardMaterial({ color: 0x76b4cc, roughness: 0.35, metalness: 0.15 });

      for (let i = 0; i < 90; i++) {
        let x, z, tries = 0;
        do {
          const ang = Math.random() * Math.PI * 2;
          const rad = 6 + Math.random() * 52; // Strictly inside playable basin (6m to 58m)
          x = Math.cos(ang) * rad;
          z = Math.sin(ang) * rad;
          tries++;
        } while (avoid.some(a => Math.hypot(x - a[0], z - a[1]) < 7) && tries < 30);

        const groundY = terrainHeight(x, z);

        if (i % 2 === 0) {
          // Ice crystal spire: base anchored securely into the ice shell
          const spire = new THREE.Mesh(crystalGeo, crystalMat);
          const sc = 0.45 + Math.random() * 0.75;
          spire.scale.set(sc, sc * (1.1 + Math.random() * 0.5), sc);
          spire.rotation.set((Math.random() - .5) * 0.15, Math.random() * 6.28, (Math.random() - .5) * 0.15);
          const totalH = 2.6 * spire.scale.y;
          spire.position.set(x, groundY + totalH * 0.3, z);
          spire.castShadow = true;
          spire.receiveShadow = true;
          root.add(spire);
        } else {
          // Ice boulder: sunk 25% into the ground so it never floats
          const boulder = new THREE.Mesh(iceBoulderGeo, iceBoulderMat);
          const sc = 0.35 + Math.random() * 0.65;
          boulder.scale.setScalar(sc);
          boulder.rotation.set(Math.random() * 3, Math.random() * 3, 0);
          boulder.position.set(x, groundY - sc * 0.25, z);
          boulder.castShadow = true;
          boulder.receiveShadow = true;
          root.add(boulder);
        }
      }
    } else {
      // Mars, Phobos, Titan, Ceres, Earth
      const geo = pId === 'phobos' ? new THREE.TetrahedronGeometry(1.0, 0) : new THREE.DodecahedronGeometry(0.9, 0);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const f = .76 + rand(p.getX(i) * 7, p.getZ(i) * 9) * .45;
        p.setXYZ(i, p.getX(i) * f, p.getY(i) * (.55 + f * .45), p.getZ(i) * f);
      }
      geo.computeVertexNormals();
      const rockMat = new THREE.MeshStandardMaterial({
        color: planet.rock,
        roughness: 0.94,
        metalness: pId === 'phobos' ? 0.14 : 0.04
      });
      const rocks = new THREE.InstancedMesh(geo, rockMat, 110);
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      const ma = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V();

      for (let i = 0; i < 110; i++) {
        let x, z, tries = 0;
        do {
          const ang = Math.random() * Math.PI * 2;
          const rad = 6 + Math.random() * 52; // Strictly inside playable basin (6m to 58m)
          x = Math.cos(ang) * rad;
          z = Math.sin(ang) * rad;
          tries++;
        } while (avoid.some(a => Math.hypot(x - a[0], z - a[1]) < 7) && tries < 30);

        const groundY = terrainHeight(x, z);
        const scale = .25 + Math.random() * 0.95;
        q.setFromEuler(new THREE.Euler(Math.random() * 0.3, Math.random() * 6.28, Math.random() * 0.3));
        s.set(scale * (1 + Math.random() * .4), scale * (.55 + Math.random() * .35), scale);
        // Anchor rock 22% into the ground so lower half is buried in surface:
        ma.compose(new V(x, groundY - scale * 0.22, z), q, s);
        rocks.setMatrixAt(i, ma);
      }
      rocks.instanceMatrix.needsUpdate = true;
      root.add(rocks);
    }
  }
  function makeMountains(root) {
    // Boundary mountains are procedurally formed directly into the seamless terrain heightmap (terrainHeight)
    // with towering jagged perimeter ridges, eliminating all floating loose geometry.
  }
  
  /* ─────────────────────────────────────────────────────────────────────
     3D SCIENCE-FICTION SCANNER BEAM & HOLOGRAPHIC TARGET BOUNDARIES
     Originates from suit chest patch / control unit (local: 0, 1.15, -0.28)
     ───────────────────────────────────────────────────────────────────── */
  let scanner3D = null;
  let currentExplorerTab = 'recon';

  function initScannerVisual(root) {
    if (scanner3D && scanner3D.group) {
      if (scanner3D.group.parent !== root) root.add(scanner3D.group);
      return;
    }
    const group = new THREE.Group();
    group.name = 'scanner-visual-system';
    group.visible = false;

    // 1. Connecting beam from suit chest to target
    const lineGeo = new THREE.BufferGeometry();
    const linePositions = new Float32Array(6);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x65ddff,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      linewidth: 2
    });
    const beamLine = new THREE.Line(lineGeo, lineMat);
    group.add(beamLine);

    // 2. Holographic target wireframe box
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x65ddff,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const wireBox = new THREE.Mesh(boxGeo, wireMat);
    group.add(wireBox);

    // 3. Horizontal sweeping scan line/plane moving vertically across target
    const sweepGeo = new THREE.PlaneGeometry(1, 1);
    const sweepMat = new THREE.MeshBasicMaterial({
      color: 0x8fe7ff,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sweepPlane = new THREE.Mesh(sweepGeo, sweepMat);
    sweepPlane.rotation.x = Math.PI / 2;
    group.add(sweepPlane);

    root.add(group);
    scanner3D = {
      group,
      beamLine,
      linePositions,
      wireBox,
      sweepPlane
    };
  }

  function startScan(target) {
    if (!target) return;
    if (HC.scanner && HC.scanner.active) return;

    const me = player();
    const tPos = target.pos || (target.group && target.group.position) || target;
    const dist = me.distanceTo(tPos);
    if (dist > 12) {
      toast('Target out of scanner range. Move closer (max 12m).');
      return;
    }

    if (isLineOfSightBlocked(me, tPos)) {
      toast('Scanner line of sight obstructed by terrain or obstacle.');
      return;
    }

    const duration = target.isFragment ? 2.8 : (target.catalog ? target.catalog.duration : 2.5);
    HC.scanner = {
      active: true,
      target,
      progress: 0,
      duration,
      lastAudioTime: performance.now()
    };

    if (window.HomecomingAudio) window.HomecomingAudio.play('scanner_start');

    const scanHud = document.getElementById('hc-scan-hud');
    const scanName = document.getElementById('hc-scan-name');
    const scanCat = document.getElementById('hc-scan-cat');
    const scanFill = document.getElementById('hc-scan-fill');
    const scanPct = document.getElementById('hc-scan-pct');
    const scanStatus = document.getElementById('hc-scan-status');

    if (scanHud) scanHud.classList.add('active');
    if (scanName) scanName.textContent = target.name || (target.catalog ? target.catalog.name : 'Unknown Target');
    if (scanCat) scanCat.textContent = target.isFragment ? 'SIGNAL TRANSMISSION NODE' : (target.catalog ? target.catalog.category.toUpperCase() : 'SURFACE TARGET');
    if (scanFill) scanFill.style.width = '0%';
    if (scanPct) scanPct.textContent = '0%';
    if (scanStatus) scanStatus.textContent = 'ANALYZING SPECTRAL SIGNATURE…';
  }

  function updateScan(dt) {
    if (!HC.scanner || !HC.scanner.active) return;
    const target = HC.scanner.target;
    if (!target) { cancelScan(); return; }

    const pPos = player();
    const tPos = target.pos || (target.group && target.group.position) || target;
    const dist = pPos.distanceTo(tPos);
    if (dist > 14) {
      cancelScan('Target moved out of scanner range');
      return;
    }

    if (isLineOfSightBlocked(pPos, tPos)) {
      cancelScan('Line of sight obstructed');
      return;
    }

    const speedMult = (HC.save.unlockedRewards || []).includes('reward-optics') ? 1.25 : 1.0;
    HC.scanner.progress += dt * speedMult;
    const pct = Math.min(100, Math.round((HC.scanner.progress / HC.scanner.duration) * 100));

    const scanFill = document.getElementById('hc-scan-fill');
    const scanPct = document.getElementById('hc-scan-pct');
    const scanStatus = document.getElementById('hc-scan-status');

    if (scanFill) scanFill.style.width = pct + '%';
    if (scanPct) scanPct.textContent = pct + '%';
    if (scanStatus) {
      scanStatus.textContent = pct < 35 ? 'ANALYZING SPECTRAL SIGNATURE…' : (pct < 75 ? 'RESOLVING INTERNAL STRUCTURE…' : 'COMPILING DISCOVERY ARCHIVE…');
    }

    // Update 3D Beam and Sweeping Laser Line
    if (scanner3D && scanner3D.group) {
      scanner3D.group.visible = true;

      let chestWorld;
      if (HC.rover && HC.rover.driving) {
        chestWorld = HC.rover.group.localToWorld(new THREE.Vector3(0, 1.2, -1.8));
      } else if (HC.astronaut && HC.astronaut.group) {
        chestWorld = HC.astronaut.group.localToWorld(new THREE.Vector3(0, 1.15, -0.28));
      } else {
        chestWorld = pPos.clone().add(new THREE.Vector3(0, 1.15, 0));
      }

      const targetMesh = target.group || target.mesh || target;
      let sx, sy, sz;
      const center = new THREE.Vector3(tPos.x, tPos.y, tPos.z);

      if (target.isFragment) {
        // Signal fragment node is an octahedron at local y = 0.8; tight 1.1m box
        sx = 1.1;
        sy = 1.1;
        sz = 1.1;
        center.y = tPos.y + 0.8;
      } else if (target.catalog) {
        const cat = target.catalog;
        if (cat.category === 'Geology') {
          sx = 1.4;
          sy = 0.95;
          sz = 1.3;
          center.y = tPos.y + 0.45;
        } else if (cat.category === 'Technology') {
          sx = 1.1;
          sy = 2.1;
          sz = 1.1;
          center.y = tPos.y + 1.05;
        } else if (cat.category === 'Anomaly' || cat.category === 'Signal') {
          sx = 1.4;
          sy = 2.6;
          sz = 1.4;
          center.y = tPos.y + 1.3;
        } else { // Science pod
          sx = 1.1;
          sy = 1.1;
          sz = 1.1;
          center.y = tPos.y + 0.55;
        }
      } else {
        const box = new THREE.Box3().setFromObject(targetMesh);
        box.getCenter(center);
        const size = box.getSize(new THREE.Vector3());
        sx = Math.min(2.8, Math.max(0.9, size.x * 1.05));
        sy = Math.min(2.2, Math.max(0.8, size.y * 0.92));
        sz = Math.min(2.8, Math.max(0.9, size.z * 1.05));
        center.y = tPos.y + sy * 0.5;
      }

      scanner3D.wireBox.position.copy(center);
      scanner3D.wireBox.scale.set(sx, sy, sz);

      // Sweeping horizontal scan plane moving vertically up and down tightly across the target object
      const sweepPhase = Math.sin((HC.scanner.progress / HC.scanner.duration) * Math.PI * 4);
      const sweepY = center.y + (sy * 0.45) * sweepPhase;
      scanner3D.sweepPlane.position.set(center.x, sweepY, center.z);
      scanner3D.sweepPlane.scale.set(sx * 1.02, sz * 1.02, 1);

      // Connecting beam from suit chest / rover scanner to sweeping laser plane
      const posAttr = scanner3D.beamLine.geometry.attributes.position;
      posAttr.setXYZ(0, chestWorld.x, chestWorld.y, chestWorld.z);
      posAttr.setXYZ(1, center.x, sweepY, center.z);
      posAttr.needsUpdate = true;
    }

    // Audio loop pulses
    if (performance.now() - HC.scanner.lastAudioTime > 360) {
      HC.scanner.lastAudioTime = performance.now();
      if (window.HomecomingAudio) window.HomecomingAudio.play('scanner_loop');
    }

    if (HC.scanner.progress >= HC.scanner.duration) {
      completeScan();
    }
  }

  function completeScan() {
    if (!HC.scanner || !HC.scanner.active) return;
    const target = HC.scanner.target;
    HC.scanner.active = false;
    HC.scanner.target = null;
    HC.scanner.progress = 0;

    if (scanner3D && scanner3D.group) scanner3D.group.visible = false;
    const scanHud = document.getElementById('hc-scan-hud');
    if (scanHud) scanHud.classList.remove('active');

    if (window.HomecomingAudio) window.HomecomingAudio.play('scanner_complete');

    // Interactive Tutorial Scan Step Detection
    if (typeof tutorialState !== 'undefined' && tutorialState.active && tutorialState.stepIndex === 4) {
      tutorialState.scanCompleted = true;
    }

    // 1. Signal Fragment
    if (target.isFragment) {
      const frag = target.target.fragment;
      if (!HC.save.signalFragments.includes(frag.id)) {
        HC.save.signalFragments.push(frag.id);
        if (window.HomecomingAudio) window.HomecomingAudio.play('fragment_found');
        checkMilestoneRewards();
        persist();
        if (target.group) target.group.visible = false;
        const msg = 'SIGNAL FRAGMENT ARCHIVED: ' + frag.title;
        toast(msg + ' [Explorer\'s Log: X]', 4500);
        if (window.HomecomingAudio) window.HomecomingAudio.speak('Signal fragment archived. ' + frag.title, 'ora');
        if (HC.rover && HC.rover.driving) {
          // Keep driving seamlessly without jarring pause
        } else {
          showDialogueSequence(frag.title, [frag.lore], () => {
            toast(msg);
          });
        }
      } else {
        toast('Signal fragment already archived.');
      }
      return;
    }

    // 2. Planetary Landmark / Discovery
    const cat = target.catalog;
    if (cat) {
      const isFirstScan = !HC.save.scans.includes(cat.id);
      if (isFirstScan) {
        HC.save.scans.push(cat.id);
        if (cat.reward) {
          if (cat.reward.credits) HC.save.resources.credits = Math.min(99999, (HC.save.resources.credits || 0) + cat.reward.credits);
          if (cat.reward.salvage) HC.save.resources.salvage = Math.min(999, (HC.save.resources.salvage || 0) + cat.reward.salvage);
        }
        HC.save.stats.samples++;
        persist();
        checkContractsProgression(cat.id);
        const rewardText = cat.reward ? ' [+' + cat.reward.credits + ' Credits, +' + cat.reward.salvage + ' Salvage]' : '';
        toast('ANALYSIS COMPLETE: ' + cat.name + rewardText + ' [Archived: X]', 5000);
        if (window.HomecomingAudio) window.HomecomingAudio.speak(cat.name + '. ' + cat.description, 'ora');
        if (HC.rover && HC.rover.driving) {
          // While driving rover, seamlessly continue without modal interruption
        } else {
          showDialogueSequence(cat.name + ' // ' + cat.category.toUpperCase(), [cat.description, 'Telemetry archived to Explorer\'s Log.'], () => {});
        }
      } else {
        toast('ANALYSIS CONFIRMED: ' + cat.name + ' (Already Catalogued)');
      }
    }
  }

  function cancelScan(reason) {
    if (!HC.scanner || !HC.scanner.active) return;
    HC.scanner.active = false;
    HC.scanner.target = null;
    HC.scanner.progress = 0;
    if (scanner3D && scanner3D.group) scanner3D.group.visible = false;
    const scanHud = document.getElementById('hc-scan-hud');
    if (scanHud) scanHud.classList.remove('active');
    if (window.HomecomingAudio) window.HomecomingAudio.play('scanner_abort');
    if (reason) toast('Scan aborted: ' + reason);
  }

  function isLineOfSightBlocked(origin, targetPos) {
    if (!HC.solids || !HC.solids.length) return false;
    const ox = origin.x, oz = origin.z;
    const tx = targetPos.x, tz = targetPos.z;
    const dx = tx - ox, dz = tz - oz;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return false;
    const udx = dx / len, udz = dz / len;

    for (let i = 0; i < HC.solids.length; i++) {
      const s = HC.solids[i];
      const cx = s.x - ox, cz = s.z - oz;
      const proj = cx * udx + cz * udz;
      if (proj > 0.5 && proj < len - 0.5) {
        const perpX = cx - proj * udx;
        const perpZ = cz - proj * udz;
        const perpDist = Math.hypot(perpX, perpZ);
        if (perpDist < (s.r || 1.0) * 0.8) {
          return true;
        }
      }
    }
    return false;
  }

  function nearestScannable() {
    const me = player();
    let best = null;
    let minD = 12.0;

    // Signal fragments
    if (HC.signalFragmentObjects) {
      HC.signalFragmentObjects.forEach(obj => {
        if (!obj.group.visible) return;
        const d = me.distanceTo(obj.pos);
        if (d < minD) {
          minD = d;
          best = { id: obj.fragment.id, name: 'Signal Fragment: ' + obj.fragment.title, target: obj, isFragment: true, radius: 12.0, pos: obj.pos, group: obj.group };
        }
      });
    }

    // Scannable landmarks
    if (HC.scannableObjects) {
      HC.scannableObjects.forEach(obj => {
        const d = me.distanceTo(obj.pos);
        if (d < minD) {
          minD = d;
          best = { id: obj.catalog.id, name: obj.catalog.name, target: obj, catalog: obj.catalog, radius: 12.0, pos: obj.pos, group: obj.group };
        }
      });
    }
    // Interactive Tutorial Mineral Outcrop (Step 5)
    if (typeof tutorialState !== 'undefined' && tutorialState.active && tutorialState.stepIndex === 4 && tutorialState.mineral) {
      const d = me.distanceTo(tutorialState.mineral.pos);
      if (d < minD) {
        minD = d;
        best = tutorialState.mineral;
      }
    }

    return best;
  }

  function triggerScanOrCancel() {
    if (HC.scanner && HC.scanner.active) {
      cancelScan('Scan cancelled by user');
      return;
    }
    const target = nearestScannable();
    if (!target) {
      toast('No scannable target within scanner range (12m).');
      return;
    }
    startScan(target);
  }

  /* ─────────────────────────────────────────────────────────────────────
     SIGNAL FRAGMENT 3D BEACONS & SCANNABLE LANDMARK ANCHORS
     ───────────────────────────────────────────────────────────────────── */
  function makeSignalFragmentMarkers(root) {
    const curPId = activePlanetId();
    const fragments = SIGNAL_FRAGMENTS.filter(f => f.planet === curPId);
    HC.signalFragmentObjects = [];

    fragments.forEach(frag => {
      const isCollected = (HC.save.signalFragments || []).includes(frag.id);
      const g = new THREE.Group();
      g.name = 'signal-fragment-' + frag.id;

      // Inverted pulsing octahedron node
      const nodeGeo = new THREE.OctahedronGeometry(0.38, 0);
      const nodeMat = new THREE.MeshBasicMaterial({ color: 0x8fe7ff, wireframe: true });
      const node = new THREE.Mesh(nodeGeo, nodeMat);
      node.position.y = 0.8;

      // Soft glowing sphere
      const auraGeo = new THREE.SphereGeometry(0.5, 10, 8);
      const auraMat = new THREE.MeshBasicMaterial({ color: 0x65ddff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
      const aura = new THREE.Mesh(auraGeo, auraMat);
      aura.position.y = 0.8;

      // Thin beacon line
      const beamGeo = new THREE.CylinderGeometry(0.02, 0.02, 6, 6, 1, true);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0x8fe7ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 3.0;

      g.add(node, aura, beam);
      g.position.copy(pos(frag.x, frag.z, 0.1));
      if (isCollected) g.visible = false;
      root.add(g);

      HC.signalFragmentObjects.push({
        group: g,
        node,
        aura,
        fragment: frag,
        pos: new V(frag.x, yAt(frag.x, frag.z), frag.z),
        radius: 3.5
      });
    });
  }

  function makeScannableMarkers(root) {
    const curPId = activePlanetId();
    const scannables = SCAN_CATALOG.filter(s => s.planet === curPId);
    HC.scannableObjects = [];

    scannables.forEach(item => {
      const g = new THREE.Group();
      g.name = 'scannable-' + item.id;

      let visualMesh;
      if (item.category === 'Geology') {
        visualMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), material(0x655048, 0.8));
        visualMesh.position.y = 0.45;
        visualMesh.scale.set(1.2, 0.8, 1.1);
      } else if (item.category === 'Technology') {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 8), material(0x758095, 0.4, 0x111622));
        mast.position.y = 1.1;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.35), material(0x65ddff, 0.2, 0x113355));
        head.position.y = 2.1;
        g.add(mast, head);
      } else if (item.category === 'Anomaly' || item.category === 'Signal') {
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.45, 3.2, 6), material(0x1a2233, 0.2, 0x153555));
        spire.position.y = 1.6;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.04, 8, 24), new THREE.MeshBasicMaterial({ color: 0x8fe7ff, transparent: true, opacity: 0.6 }));
        ring.position.y = 2.4; ring.rotation.x = Math.PI / 2;
        g.add(spire, ring);
      } else { // Science / Lore
        const pod = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.6), material(0x445060, 0.6));
        pod.position.y = 0.45;
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7dff8a }));
        light.position.set(0, 0.8, 0.25);
        g.add(pod, light);
      }

      if (visualMesh) g.add(visualMesh);
      g.position.copy(pos(item.x, item.z, 0));
      root.add(g);

      HC.scannableObjects.push({
        group: g,
        catalog: item,
        pos: new V(item.x, yAt(item.x, item.z), item.z),
        radius: item.radius || 3.2
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     EXPLORER'S LOG & REPLAYABILITY CONTROLLER
     ───────────────────────────────────────────────────────────────────── */
  function isPlanetUnlocked(pIdx, planetId) {
    if (HC.save.postGameUnlocked) return true;
    if (pIdx === 0) return true;
    const pl = PLANETS[pIdx];
    if (HC.save.unlocked && HC.save.unlocked.includes(pl.name)) return true;
    const curP = HC.save.planet != null ? HC.save.planet : 0;
    if (curP >= pIdx) return true;
    const m = mission();
    if (m && m.planet >= pIdx) return true;
    return false;
  }

  function openExplorersLog(tab = 'recon') {
    if (HC.state !== STATES.EXPLORATION && HC.state !== STATES.PAUSED) return;
    currentExplorerTab = tab;
    HC.prevExplorersState = HC.state;
    HC.state = STATES.EXPLORERS;
    setMobileControlsVisible(false);
    try { document.exitPointerLock(); } catch (_) {}
    if (window.HomecomingAudio) window.HomecomingAudio.play('ui_click');
    show(ui.pause, false);
    show(ui.hud, false); // HIDE HUD TO PREVENT ANY OVERLAP!
    renderExplorersLog();
    show(ui.explorers, true);
  }

  function closeExplorersLog() {
    show(ui.explorers, false);
    if (window.HomecomingAudio) window.HomecomingAudio.play('ui_back');
    if (HC.prevExplorersState === STATES.PAUSED) {
      HC.state = STATES.PAUSED;
      show(ui.pause, true);
      setMobileControlsVisible(false);
    } else {
      HC.state = STATES.EXPLORATION;
      show(ui.hud, true); // RESTORE HUD CLEANLY!
      setMobileControlsVisible(true);
    }
  }

  function getExplorationProgress(planetId) {
    const p = PLANETS.find(pl => pl.id === planetId) || PLANETS[0];
    const pIdx = PLANETS.indexOf(p);
    const missionsForPlanet = MISSIONS.filter(m => m.planet === pIdx);
    const planetFrags = SIGNAL_FRAGMENTS.filter(f => f.planet === planetId);
    const planetScans = SCAN_CATALOG.filter(s => s.planet === planetId);
    const planetLogs = AUDIO_LOGS[planetId] || [];

    const unlocked = isPlanetUnlocked(pIdx, planetId);
    if (!unlocked) {
      return {
        planetId,
        planetName: p.name,
        totalPct: 0,
        isLocked: true,
        doneMissions: 0,
        totalMissions: missionsForPlanet.length,
        foundFrags: 0,
        totalFrags: planetFrags.length,
        doneScans: 0,
        totalScans: planetScans.length,
        doneLogs: 0,
        totalLogs: planetLogs.length,
        completedContracts: 0
      };
    }

    const doneMissions = missionsForPlanet.filter(m => (HC.save.mission > MISSIONS.indexOf(m)) || HC.save.postGameUnlocked).length;
    const missionScore = (doneMissions / (missionsForPlanet.length || 1)) * 50;

    const foundFrags = planetFrags.filter(f => (HC.save.signalFragments || []).includes(f.id)).length;
    const fragScore = (foundFrags / (planetFrags.length || 1)) * 20;

    const doneScans = planetScans.filter(s => (HC.save.scans || []).includes(s.id)).length;
    const scanScore = (doneScans / (planetScans.length || 1)) * 20;

    const doneLogs = planetLogs.filter(l => (HC.save.audioLogs || []).includes(l.id)).length;
    const logScore = (doneLogs / (planetLogs.length || 1)) * 10;

    const totalPct = Math.min(100, Math.round(missionScore + fragScore + scanScore + logScore));
    return {
      planetId,
      planetName: p.name,
      totalPct,
      isLocked: false,
      doneMissions,
      totalMissions: missionsForPlanet.length,
      foundFrags,
      totalFrags: planetFrags.length,
      doneScans,
      totalScans: planetScans.length,
      doneLogs,
      totalLogs: planetLogs.length,
      completedContracts: ((HC.save.contracts && HC.save.contracts.completed) || []).filter(cId => cId.includes(planetId)).length
    };
  }

  function renderExplorersLog() {
    if (!ui.explorersContent) return;

    ['recon', 'fragments', 'contracts', 'discoveries'].forEach(t => {
      const btn = ui['tab' + t.charAt(0).toUpperCase() + t.slice(1)];
      if (btn && btn.classList) btn.classList.toggle('active', currentExplorerTab === t);
    });

    const totalFragments = SIGNAL_FRAGMENTS.length;
    const foundFragments = (HC.save.signalFragments || []).length;
    if (ui.tabFragments) ui.tabFragments.textContent = 'Signal Fragments (' + foundFragments + '/' + totalFragments + ')';

    let html = '';

    if (currentExplorerTab === 'recon') {
      html += '<div class="hc-planet-grid">';
      PLANETS.forEach(pl => {
        const prog = getExplorationProgress(pl.id);
        if (prog.isLocked) {
          html += '<div class="hc-planet-recon-card" style="opacity:.45;border-style:dashed;">' +
            '<div class="hc-card-top">' +
              '<span class="hc-card-title" style="color:var(--mut);">' + pl.name + '</span>' +
              '<span class="hc-card-pct" style="color:var(--mut);font-size:11px;">🔒 LOCKED</span>' +
            '</div>' +
            '<div class="hc-mini-progress-bg"><div class="hc-mini-progress-fill" style="width:0%;"></div></div>' +
            '<div class="hc-card-stats" style="color:var(--mut);">' +
              '<div>🔒 Uncharted Celestial Body</div>' +
              '<div>Advance the campaign to unlock ' + pl.name + ' reconnaissance.</div>' +
            '</div>' +
          '</div>';
        } else {
          html += '<div class="hc-planet-recon-card">' +
            '<div class="hc-card-top">' +
              '<span class="hc-card-title">' + pl.name + '</span>' +
              '<span class="hc-card-pct">' + prog.totalPct + '%</span>' +
            '</div>' +
            '<div class="hc-mini-progress-bg"><div class="hc-mini-progress-fill" style="width:' + prog.totalPct + '%"></div></div>' +
            '<div class="hc-card-stats">' +
              '<div>Campaign Missions: ' + prog.doneMissions + '/' + prog.totalMissions + '</div>' +
              '<div>Signal Fragments: ' + prog.foundFrags + '/' + prog.totalFrags + '</div>' +
              '<div>Scanned Landmarks: ' + prog.doneScans + '/' + prog.totalScans + '</div>' +
              '<div>Expedition Logs: ' + prog.doneLogs + '/' + prog.totalLogs + '</div>' +
              '<div>Optional Contracts: ' + prog.completedContracts + ' completed</div>' +
            '</div>' +
          '</div>';
        }
      });
      html += '</div>';
    } else if (currentExplorerTab === 'fragments') {
      html += '<div style="background:rgba(101,221,255,0.06);border:1px solid rgba(101,221,255,0.25);border-radius:4px;padding:12px 16px;margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="font-weight:600;font-size:13px;color:#8fe7ff;letter-spacing:.08em;">SIGNAL TRANSMISSION RECONSTRUCTION</span>' +
          '<span style="font-weight:600;font-size:13px;color:#fff;">' + foundFragments + ' / ' + totalFragments + ' RECOVERED</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--mut);line-height:1.5;">' +
          'Collect hidden transmission fragments across planetary anomalies to decode the deep-space carrier wave and unlock advanced suit and rover upgrades.' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:14px;">' +
        '<div style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#d9a98f;margin-bottom:8px;">Exploration Milestones</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">';

      MILESTONE_REWARDS.forEach(m => {
        const unlocked = (HC.save.unlockedRewards || []).includes(m.id) || foundFragments >= m.count;
        html += '<div style="background:rgba(255,255,255,' + (unlocked ? '.06' : '.02') + ');border:1px solid ' + (unlocked ? 'rgba(125,255,138,.4)' : 'rgba(251,233,220,.15)') + ';border-radius:4px;padding:8px 12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span style="font-size:11px;font-weight:600;color:' + (unlocked ? '#7dff8a' : '#aaa') + ';">' + m.count + ' Fragments: ' + m.title + '</span>' +
            '<span class="hc-item-badge ' + (unlocked ? 'hc-badge-done' : 'hc-badge-pending') + '">' + (unlocked ? 'UNLOCKED' : 'LOCKED') + '</span>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--mut);">' + m.desc + '</div>' +
        '</div>';
      });
      html += '</div></div>';

      html += '<div style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#8fe7ff;margin-bottom:8px;">Decoded Transmissions Archive</div>';
      SIGNAL_FRAGMENTS.forEach(f => {
        const isFound = (HC.save.signalFragments || []).includes(f.id);
        const pObj = PLANETS.find(p => p.id === f.planet) || { name: f.planet.toUpperCase() };
        html += '<div class="hc-fragment-item ' + (isFound ? 'unlocked' : '') + '">' +
          '<div class="hc-item-header">' +
            '<span style="font-size:12px;font-weight:600;color:' + (isFound ? '#fff' : 'var(--mut)') + '">' + (isFound ? f.title : 'Encrypted Signal Node // [' + pObj.name + ']') + '</span>' +
            '<span class="hc-item-badge ' + (isFound ? 'hc-badge-done' : 'hc-badge-pending') + '">' + (isFound ? 'DECODED' : 'UNDISCOVERED') + '</span>' +
          '</div>' +
          '<div style="font-size:11px;color:' + (isFound ? '#f0ddd2' : 'rgba(217,169,143,.5)') + ';font-style:' + (isFound ? 'italic' : 'normal') + ';line-height:1.5;">' +
            (isFound ? f.lore : 'Sub-carrier frequency detected on ' + pObj.name + '. Search the outer terrain in the rover or on foot to scan and archive this fragment.') +
          '</div>' +
        '</div>';
      });
    } else if (currentExplorerTab === 'contracts') {
      const curPId = activePlanetId();
      const pObj = PLANETS.find(p => p.id === curPId) || PLANETS[0];
      const available = getAvailableContracts(curPId);

      html += '<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.03);border:1px solid rgba(251,233,220,0.2);padding:10px 14px;border-radius:4px;margin-bottom:12px;">' +
        '<div>' +
          '<span style="font-weight:600;font-size:13px;color:#fff;">' + pObj.name.toUpperCase() + ' // ACTIVE CONTRACTS</span>' +
          '<div style="font-size:10px;color:var(--mut);margin-top:2px;">Complete optional planetary survey tasks for credits and salvage.</div>' +
        '</div>' +
        '<button class="btn hc-ghost" id="hc-btn-cycle-contracts" style="font-size:10px;padding:6px 12px;">Cycle Contracts</button>' +
      '</div>';

      if (!available.length) {
        html += '<div style="padding:20px;text-align:center;color:var(--mut);font-size:12px;">No active contracts on this world. Use "Cycle Contracts" to refresh.</div>';
      } else {
        available.forEach(c => {
          const isDone = ((HC.save.contracts && HC.save.contracts.completed) || []).includes(c.id);
          const reqs = c.targetScans || [];
          const doneReqs = reqs.filter(sId => (HC.save.scans || []).includes(sId)).length;
          const readyToClaim = !isDone && doneReqs >= reqs.length;

          html += '<div class="hc-contract-item ' + (isDone ? 'completed' : '') + '">' +
            '<div class="hc-item-header">' +
              '<span style="font-weight:600;font-size:13px;color:#fff;">' + c.title + '</span>' +
              '<span class="hc-item-badge ' + (isDone ? 'hc-badge-done' : (readyToClaim ? 'hc-badge-done' : 'hc-badge-pending')) + '">' +
                (isDone ? 'COMPLETED' : (readyToClaim ? 'READY TO CLAIM' : 'IN PROGRESS: ' + doneReqs + '/' + reqs.length)) +
              '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--mut);">' + c.desc + '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">' +
              '<span style="font-size:10px;color:#8fe7ff;letter-spacing:.05em;">Reward: +' + c.reward.credits + ' Credits, +' + c.reward.salvage + ' Salvage</span>' +
              (readyToClaim ? '<button class="btn hc-claim-contract-btn" data-cid="' + c.id + '" style="font-size:10px;padding:4px 10px;">Claim Reward</button>' : '') +
            '</div>' +
          '</div>';
        });
      }
    } else if (currentExplorerTab === 'discoveries') {
      const scannedList = (HC.save.scans || []);
      html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(251,233,220,0.2);padding:10px 14px;border-radius:4px;margin-bottom:12px;">' +
        '<span style="font-weight:600;font-size:13px;color:#fff;">EXPEDITION FIELD DISCOVERY ARCHIVE</span>' +
        '<div style="font-size:10px;color:var(--mut);margin-top:2px;">' + scannedList.length + ' of ' + SCAN_CATALOG.length + ' Planetary Landmarks Analyzed</div>' +
      '</div>';

      if (!scannedList.length) {
        html += '<div style="padding:20px;text-align:center;color:var(--mut);font-size:12px;">No landmarks scanned yet. Equip your suit scanner and press [C] near geology, machinery, or anomalies.</div>';
      } else {
        scannedList.forEach(sId => {
          const item = SCAN_CATALOG.find(sc => sc.id === sId);
          if (!item) return;
          const pObj = PLANETS.find(p => p.id === item.planet) || { name: item.planet.toUpperCase() };
          html += '<div class="hc-discovery-item">' +
            '<div class="hc-item-header">' +
              '<span style="font-weight:600;font-size:13px;color:#fff;">' + item.name + '</span>' +
              '<span class="hc-item-badge hc-badge-done">' + item.category + ' · ' + pObj.name + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:#f0ddd2;line-height:1.5;">' + item.description + '</div>' +
          '</div>';
        });
      }
    }

    ui.explorersContent.innerHTML = html;

    const cycleBtn = ui.explorersContent.querySelector('#hc-btn-cycle-contracts');
    if (cycleBtn) {
      cycleBtn.onclick = () => {
        rotateContracts();
        renderExplorersLog();
      };
    }
    ui.explorersContent.querySelectorAll('.hc-claim-contract-btn').forEach(b => {
      b.onclick = () => {
        const cid = b.getAttribute('data-cid');
        claimContract(cid);
        renderExplorersLog();
      };
    });
  }

  function getAvailableContracts(planetId) {
    const planetPool = CONTRACTS_POOL.filter(c => c.planet === planetId);
    if (!planetPool.length) return [];
    const cycle = (HC.save.contracts && HC.save.contracts.cycle) || 0;
    const count = Math.min(2, planetPool.length);
    const result = [];
    for (let i = 0; i < count; i++) {
      const idx = (cycle + i) % planetPool.length;
      result.push(planetPool[idx]);
    }
    return result;
  }

  function rotateContracts() {
    if (!HC.save.contracts) HC.save.contracts = { active: [], completed: [], cycle: 0 };
    HC.save.contracts.cycle = ((HC.save.contracts.cycle || 0) + 1) % 100;
    persist('Planetary contracts updated.');
    if (window.HomecomingAudio) window.HomecomingAudio.play('ui_click');
  }

  function claimContract(contractId) {
    const c = CONTRACTS_POOL.find(item => item.id === contractId);
    if (!c) return;
    if (!HC.save.contracts.completed) HC.save.contracts.completed = [];
    if (HC.save.contracts.completed.includes(c.id)) {
      toast('Contract already completed.');
      return;
    }
    HC.save.contracts.completed.push(c.id);
    if (c.reward) {
      if (c.reward.credits) HC.save.resources.credits = Math.min(99999, (HC.save.resources.credits || 0) + c.reward.credits);
      if (c.reward.salvage) HC.save.resources.salvage = Math.min(999, (HC.save.resources.salvage || 0) + c.reward.salvage);
    }
    HC.save.stats.optionalMissions++;
    persist('Contract reward claimed: ' + c.title);
    if (window.HomecomingAudio) window.HomecomingAudio.play('contract_complete');
    toast('CONTRACT COMPLETE — +' + (c.reward.credits || 0) + ' Credits, +' + (c.reward.salvage || 0) + ' Salvage');
  }

  function checkContractsProgression(scannedId) {
    const curPId = activePlanetId();
    const available = getAvailableContracts(curPId);
    available.forEach(c => {
      if (((HC.save.contracts && HC.save.contracts.completed) || []).includes(c.id)) return;
      const reqs = c.targetScans || [];
      const doneReqs = reqs.filter(sId => (HC.save.scans || []).includes(sId)).length;
      if (doneReqs >= reqs.length) {
        toast('CONTRACT OBJECTIVE MET: ' + c.title + ' [Claim in Explorer\'s Log]');
        if (window.HomecomingAudio) window.HomecomingAudio.play('contract_complete');
      }
    });
  }

  function checkMilestoneRewards() {
    const count = (HC.save.signalFragments || []).length;
    MILESTONE_REWARDS.forEach(m => {
      if (count >= m.count && !(HC.save.unlockedRewards || []).includes(m.id)) {
        if (!HC.save.unlockedRewards) HC.save.unlockedRewards = [];
        HC.save.unlockedRewards.push(m.id);
        toast('EXPLORATION MILESTONE: Unlocked ' + m.title + '!');
        if (window.HomecomingAudio) window.HomecomingAudio.play('contract_complete');
      }
    });
  }

  function makeAstronaut(root) {
    const g = new THREE.Group(); g.name = 'procedural-astronaut-replaceable';
    const suitFabric = pbrFabric(0xd6d3cb, 0.72);
    const orangeAccent = pbrMetal(0xd45826, 0.45, 0.22);
    const jointSeal = pbrFabric(0x1c1e24, 0.82);
    const bootRubber = pbrRubber(0x16181b, 0.94);
    const visorMat = pbrGlass(0x140e06, 0.04, 0.96, 1.0);
    const panelMat = pbrMetal(0x1a1e24, 0.35, 0.85);

    // Torso & belt
    const torso = capsule(.38, .58, suitFabric); torso.position.y = 1.035; torso.scale.set(1, 1.1, .76); g.add(torso);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(.4, .4, .12, 16), orangeAccent); belt.position.y = .795; g.add(belt);

    // Helmet & Gold Reflective Visor Face Shield
    const helmetMat = pbrFabric(0xdcd9d2, 0.45);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(.34, 24, 18), helmetMat); helmet.position.y = 1.695; g.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.31, 24, 18), visorMat);
    visor.position.set(0, 1.71, -0.16);
    visor.scale.set(0.92, 0.76, 0.70);
    const visorBezel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 8, 24), pbrMetal(0x282c32, 0.32, 0.88));
    visorBezel.position.set(0, 1.71, -0.22);
    visorBezel.scale.set(1.0, 0.75, 1.0);
    g.add(visor, visorBezel);

    // Front Chest Control Patch / Life Support Module
    const chestPatch = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.06), jointSeal);
    chestPatch.position.set(0, 1.12, -0.265);
    chestPatch.rotation.x = -0.06;

    // Chest display readout & telemetry indicators
    const chestDisplay = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.02), panelMat);
    chestDisplay.position.set(0, 1.15, -0.295);
    chestDisplay.rotation.x = -0.06;
    const ledO2 = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.02), material(0x65ddff, .1, 0x33bbee));
    ledO2.position.set(-0.06, 1.055, -0.295); ledO2.rotation.x = -0.06;
    const ledSuit = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.02), material(0x66ff88, .1, 0x22cc55));
    ledSuit.position.set(0.0, 1.055, -0.295); ledSuit.rotation.x = -0.06;
    const ledWarn = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.02), material(0xffaa33, .1, 0xcc6611));
    ledWarn.position.set(0.06, 1.055, -0.295); ledWarn.rotation.x = -0.06;
    g.add(chestPatch, chestDisplay, ledO2, ledSuit, ledWarn);

    // Life support backpack (PLSS) with dual cryo-tanks & radiator grill
    const pack = new THREE.Mesh(new THREE.BoxGeometry(.55, .57, .2), jointSeal);
    pack.position.set(0, 1.135, .29);
    const tankMat = pbrMetal(0xb8c0c8, 0.25, 0.92);
    const tank1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.48, 10), tankMat);
    tank1.position.set(-0.16, 1.15, 0.41);
    const tank2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.48, 10), tankMat);
    tank2.position.set(0.16, 1.15, 0.41);
    const ventGrill = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.04), pbrMetal(0x181a1e, 0.45, 0.8));
    ventGrill.position.set(0, 1.36, 0.4);
    g.add(pack, tank1, tank2, ventGrill);

    // Helmet worklight lamp with subtle forward illumination
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(.08, .05, .05), pbrMetal(0x282c32, 0.35, 0.9));
    lamp.position.set(.24, 1.72, -.24);
    const lampLens = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.04), material(0xffffff, 0.1, 0xaae8ff));
    lampLens.position.set(.24, 1.72, -.266);
    g.add(lamp, lampLens);

    // Limbs
    const arm = (side) => {
      const pivot = new THREE.Group();
      const upper = capsule(.11, .37, suitFabric);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(.125, 10, 8), jointSeal);
      pivot.position.set(side * .45, 1.285, 0);
      upper.position.y = -.26;
      glove.position.y = -.55;
      pivot.add(upper, glove);
      g.add(pivot);
      return pivot;
    };
    const leg = (side) => {
      const pivot = new THREE.Group();
      const upper = capsule(.14, .4, suitFabric);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(.25, .15, .42), bootRubber);
      pivot.position.set(side * .2, .725, 0);
      upper.position.y = -.3;
      boot.position.set(0, -.65, -.09);
      pivot.add(upper, boot);
      g.add(pivot);
      return pivot;
    };
    HC.astronaut = { group: g, arms: [arm(-1), arm(1)], legs: [leg(-1), leg(1)], phase: 0, moving: 0 };

    // Soft contact shadow disc under astronaut feet to firmly ground character on terrain
    const contactShadowGeo = (typeof THREE !== 'undefined' && THREE.CircleGeometry)
      ? new THREE.CircleGeometry(0.46, 18)
      : new THREE.PlaneGeometry(0.9, 0.9);
    contactShadowGeo.rotateX(-Math.PI / 2);
    const contactShadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.38,
      depthWrite: false
    });
    const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    contactShadow.name = 'astronaut-contact-shadow';
    contactShadow.castShadow = false;
    contactShadow.receiveShadow = false;
    contactShadow.renderOrder = 2;
    root.add(contactShadow);
    HC.astronaut.contactShadow = contactShadow;

    enableShadows(g, true, true);

    // Spawn beside spacecraft staging area on arrival planet. Soles sit exactly at ground level.
    const curP = HC.planet || PLANETS[HC.save.planet || 0];
    if (curP && curP.id !== 'mars' && curP.launch) {
      g.position.copy(pos(curP.launch[0] + 3.2, curP.launch[1] + 1.8, 0));
    } else {
      g.position.copy(pos(3, -7, 0));
    }
    const initGroundY = terrainHeight(g.position.x, g.position.z);
    contactShadow.position.set(g.position.x, initGroundY + 0.02, g.position.z);
    root.add(g);
  }
  function alignRoverTerrain(r, x, z, heading, instant, dt) {
    const fwX = -Math.sin(heading), fwZ = -Math.cos(heading);
    const rtX = Math.cos(heading), rtZ = -Math.sin(heading);
    const wheelData = [
      { dx: -0.88, dz: -0.72 },
      { dx: 0.88, dz: -0.72 },
      { dx: -0.88, dz: 0.72 },
      { dx: 0.88, dz: 0.72 }
    ];
    const wheels = wheelData.map(w => {
      const wx = x + rtX * w.dx - fwX * w.dz;
      const wz = z + rtZ * w.dx - fwZ * w.dz;
      const h = terrainHeight(wx, wz);
      return { dx: w.dx, dz: w.dz, h };
    });

    const frontH = (wheels[0].h + wheels[1].h) * 0.5;
    const rearH = (wheels[2].h + wheels[3].h) * 0.5;
    const leftH = (wheels[0].h + wheels[2].h) * 0.5;
    const rightH = (wheels[1].h + wheels[3].h) * 0.5;

    const targetPitch = Math.atan2(frontH - rearH, 1.44);
    const targetRoll = Math.atan2(rightH - leftH, 1.76);

    // Front/rear bumpers clearance
    const fbX = x + fwX * 1.15, fbZ = z + fwZ * 1.15;
    const rbX = x - fwX * 1.15, rbZ = z - fwZ * 1.15;
    const hFB = terrainHeight(fbX, fbZ), hRB = terrainHeight(rbX, rbZ);

    let reqY = -Infinity;
    for (const w of wheels) {
      const relY = 0.34 * Math.cos(targetPitch) * Math.cos(targetRoll) - w.dz * Math.sin(targetPitch) + w.dx * Math.sin(targetRoll) - 0.35;
      const needed = w.h - relY;
      if (needed > reqY) reqY = needed;
    }
    const bumperNeed = Math.max(hFB - 0.45, hRB - 0.45);
    const targetY = Math.max(reqY + 0.04, bumperNeed);

    if (instant) {
      r.pitch = targetPitch;
      r.roll = targetRoll;
      r.group.position.set(x, targetY, z);
    } else {
      const pLerp = clamp((dt || 0.016) * 14, 0, 1);
      r.pitch = (r.pitch || 0) + (targetPitch - (r.pitch || 0)) * pLerp;
      r.roll = (r.roll || 0) + (targetRoll - (r.roll || 0)) * pLerp;
      r.group.position.x = x;
      r.group.position.z = z;
      r.group.position.y += (targetY - r.group.position.y) * pLerp;
    }
    r.group.rotation.order = 'YXZ';
    r.group.rotation.set(r.pitch, heading, r.roll);
  }
  /* ─────────────────────────────────────────────────────────────────────
     DUST PUFF VFX SYSTEM (High-performance particle pool)
     Zero-allocation ground and wheel dust puffs for Rover & Astronaut
     ───────────────────────────────────────────────────────────────────── */
  const DUST_POOL_SIZE = 36;
  const dustPuffMeshes = [];
  const dustPuffData = [];
  let dustPuffGroup = null;

  function getPlanetDustColor() {
    const p = HC.planet || PLANETS[HC.save ? HC.save.planet || 0 : 0];
    const map = {
      mars: 0xbf552a,
      phobos: 0x626670,
      europa: 0xa8ebfc,
      titan: 0xd28634,
      ceres: 0x484c56,
      earth: 0x786a58
    };
    return (p && map[p.id]) ? map[p.id] : 0xbf552a;
  }

  function initDustPuffPool(root) {
    if (dustPuffGroup && dustPuffGroup.parent) dustPuffGroup.parent.remove(dustPuffGroup);
    dustPuffGroup = new THREE.Group();
    dustPuffGroup.name = 'dust-puff-vfx';
    dustPuffMeshes.length = 0;
    dustPuffData.length = 0;

    const pCvs = document.createElement('canvas');
    pCvs.width = 64; pCvs.height = 64;
    let puffTex = null;
    try {
      const pCtx = pCvs.getContext('2d');
      if (pCtx && typeof pCtx.createRadialGradient === 'function') {
        const grad = pCtx.createRadialGradient(32, 32, 4, 32, 32, 30);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
        grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.35)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        pCtx.fillStyle = grad;
        pCtx.fillRect(0, 0, 64, 64);
        puffTex = new THREE.CanvasTexture(pCvs);
      }
    } catch (_) {}

    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < DUST_POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: puffTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      dustPuffGroup.add(m);
      dustPuffMeshes.push(m);
      dustPuffData.push({ active: false, life: 0, maxLife: 0.55, vx: 0, vy: 0, vz: 0, baseScale: 1, colorHex: 0xbf552a });
    }
    root.add(dustPuffGroup);
  }

  function emitDustPuff(pos, vel, colorHex, scale, duration) {
    for (let i = 0; i < DUST_POOL_SIZE; i++) {
      const d = dustPuffData[i];
      if (!d.active) {
        d.active = true;
        d.life = 0;
        d.maxLife = duration || 0.55;
        d.vx = vel.x; d.vy = vel.y; d.vz = vel.z;
        d.baseScale = scale || 0.65;
        d.colorHex = colorHex || getPlanetDustColor();
        const m = dustPuffMeshes[i];
        m.position.copy(pos);
        m.material.color.setHex(d.colorHex);
        m.material.opacity = 0.42;
        m.scale.setScalar(d.baseScale * 0.4);
        m.visible = true;
        return;
      }
    }
  }

  function updateDustPuffs(dt) {
    if (!dustPuffGroup || !dustPuffGroup.visible) return;
    const cam = (typeof camera !== 'undefined') ? camera : null;
    for (let i = 0; i < DUST_POOL_SIZE; i++) {
      const d = dustPuffData[i];
      if (d.active) {
        d.life += dt;
        if (d.life >= d.maxLife) {
          d.active = false;
          dustPuffMeshes[i].visible = false;
        } else {
          const progress = d.life / d.maxLife;
          const m = dustPuffMeshes[i];
          m.position.x += d.vx * dt;
          m.position.y += d.vy * dt;
          m.position.z += d.vz * dt;
          d.vy += dt * 0.12; // subtle thermal loft
          const curScale = d.baseScale * (0.4 + progress * 1.5);
          m.scale.setScalar(curScale);
          m.material.opacity = 0.42 * (1 - progress);
          if (cam) m.quaternion.copy(cam.quaternion); // Face camera billboard
        }
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     REALISTIC EXPLORATION ROVER MODEL (PBR Overhaul)
     Titanium chassis, rugged tires, alloy rims, roll-cage, real-time SpotLight
     ───────────────────────────────────────────────────────────────────── */
  function makeRover(root) {
    const g = new THREE.Group();
    g.name = 'exploration-rover';

    // 1. Titanium lower skid-plate chassis
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.22, 2.15), pbrMetal(0x282b30, 0.85, 0.35));
    chassis.position.y = 0.44;
    g.add(chassis);

    // 2. Armored upper body with beveled science payload mount
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.38, 2.15), pbrMetal(0x565f68, 0.48, 0.45));
    body.position.y = 0.64;
    g.add(body);

    // Front Crash Bumper / Bull Bar
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.14, 0.14), pbrMetal(0x1e2024, 0.7, 0.25));
    bumper.position.set(0, 0.52, -1.18);
    g.add(bumper);

    // 3. Pressurized Crew Cabin with Dark Polarized Quartz Glass & Roll Cage
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.48, 0.92), pbrGlass(0x14202c, 0.08, 0.95, 1.0));
    cabin.position.set(0, 0.98, -0.1);
    g.add(cabin);

    // Safety Roll Cage Tubular Frame (Aerospace Hazard Orange)
    const cageMat = pbrMetal(0xd06518, 0.42, 0.5);
    const cageTopL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 8), cageMat);
    cageTopL.rotation.x = Math.PI / 2; cageTopL.position.set(-0.58, 1.24, -0.1);
    const cageTopR = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 8), cageMat);
    cageTopR.rotation.x = Math.PI / 2; cageTopR.position.set(0.58, 1.24, -0.1);
    g.add(cageTopL, cageTopR);

    // 4. Rear Cargo Equipment Rack & Scientific Antenna Array
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.22, 0.55), pbrMetal(0x383e46, 0.6, 0.4));
    rack.position.set(0, 0.86, 0.78);
    g.add(rack);

    // Battery modules & power cells in rear bay
    const batt1 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.35), pbrMetal(0x181a1d, 0.8, 0.2));
    batt1.position.set(-0.38, 1.02, 0.78);
    const batt2 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.35), pbrMetal(0x181a1d, 0.8, 0.2));
    batt2.position.set(0.38, 1.02, 0.78);
    g.add(batt1, batt2);

    // High-gain comms dish & mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), pbrMetal(0x8a929b, 0.6, 0.3));
    mast.position.set(-0.5, 1.35, 0.85);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.04, 0.1, 12, 1, true), pbrMetal(0xdce2e8, 0.7, 0.3));
    dish.position.set(-0.5, 1.7, 0.85); dish.rotation.x = 0.5;
    g.add(mast, dish);

    // 5. Dual LED Headlights & Real-time Forward Illumination SpotLight
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xd8eeff,
      emissiveIntensity: 1.8,
      roughness: 0.1
    });
    [-0.46, 0.46].forEach(hx => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.06), headlightMat);
      hl.position.set(hx, 0.62, -1.14);
      g.add(hl);
    });

    // Real-time Forward SpotLight lighting up the ground in front of the rover
    const spot = new THREE.SpotLight(0xeef6ff, 1.5, 34, 0.62, 0.45, 1.8);
    spot.position.set(0, 0.72, -1.1);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 0.1, -15);
    g.add(spotTarget);
    spot.target = spotTarget;
    g.add(spot);

    // Rear Brake / Tail Lights (Emissive Red)
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff1100, emissiveIntensity: 1.4, roughness: 0.3 });
    [-0.58, 0.58].forEach(tx => {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.05), tailMat);
      tl.position.set(tx, 0.65, 1.12);
      g.add(tl);
    });

    // 6. Suspension Wishbones & Rugged Wheel Assemblies
    const tireMat = pbrRubber(0x1a1c20, 0.94);
    const rimMat = pbrMetal(0x828e9c, 0.76, 0.28);
    const hubMat = pbrMetal(0x22262c, 0.82, 0.25);
    const wheels = [];

    [-0.88, 0.88].forEach(x => {
      [-0.72, 0.72].forEach(z => {
        // Rocker-bogie suspension linkage arm from chassis
        const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.38, 6);
        const arm = new THREE.Mesh(armGeo, hubMat);
        arm.position.set(x * 0.65, 0.44, z);
        arm.rotation.z = x > 0 ? -0.45 : 0.45;
        g.add(arm);

        // Wheel Mesh (preserves w.rotation.x spinning logic)
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.22, 16), tireMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, 0.34, z);

        // Inner Alloy Rim
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.23, 14), rimMat);
        const centerNut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.25, 6), hubMat);
        w.add(rim, centerNut);

        g.add(w);
        wheels.push(w);
      });
    });

    // 7. Ground Contact Shadow Underbody Disc
    const cvs = document.createElement('canvas');
    cvs.width = 128; cvs.height = 128;
    let cTex = null;
    try {
      const ctx = cvs.getContext('2d');
      if (ctx && typeof ctx.createRadialGradient === 'function') {
        const rad = ctx.createRadialGradient(64, 64, 15, 64, 64, 62);
        rad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
        rad.addColorStop(0.55, 'rgba(0, 0, 0, 0.32)');
        rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = rad;
        ctx.fillRect(0, 0, 128, 128);
        cTex = new THREE.CanvasTexture(cvs);
      }
    } catch (_) {}
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: cTex, transparent: true, opacity: 0.55, depthWrite: false });
    const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 3.0), shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.set(0, 0.04, 0);
    g.add(shadowMesh);

    enableShadows(g);

    g.rotation.order = 'YXZ';
    HC.rover = { group: g, wheels, speed: 0, heading: 0, pitch: 0, roll: 0, driving: false };
    root.add(g);
    const curP = HC.planet || PLANETS[HC.save.planet || 0];
    const roverX = (curP && curP.id !== 'mars' && curP.launch) ? curP.launch[0] + 5.5 : -2;
    const roverZ = (curP && curP.id !== 'mars' && curP.launch) ? curP.launch[1] - 4.0 : -9;
    alignRoverTerrain(HC.rover, roverX, roverZ, 0, true);
    resetRoverCamera();
  }
  function buildContextualMissionModel(id, color, label) {
    const mg = new THREE.Group();
    let beaconY = 1.8;
    let customName = label;
    let animate = null;

    // 1. MARS: Emergency Power Generator (wake)
    if (id === 'power') {
      customName = 'Repair emergency power generator';
      const basePad = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.22, 8), material(0x2a221c, 0.9));
      basePad.position.y = 0.11;
      const genChassis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.35, 1.05), material(0xd8d4cc, 0.5));
      genChassis.position.y = 0.88;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.16, 1.07), material(0xff6a28, 0.4));
      stripe.position.y = 1.15;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.2, 0.05), material(0x40454d, 0.6));
      door.position.set(0.72, 0.88, 0.55);
      door.rotation.y = 1.15;
      const cavity = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.15, 0.35), material(0x121417, 0.95));
      cavity.position.set(0.18, 0.88, 0.45);
      const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.35, 8), material(0xb87333, 0.3));
      t1.position.set(0.08, 0.92, 0.45);
      const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.35, 8), material(0xb87333, 0.3));
      t2.position.set(0.28, 0.92, 0.45);
      const cable1 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.4, 8), material(0x1a1a1a, 0.8));
      cable1.position.set(0.25, 0.4, 0.7);
      cable1.rotation.x = 0.45; cable1.rotation.z = -0.3;
      const cable2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.2, 8), material(0x1a1a1a, 0.8));
      cable2.position.set(-0.4, 0.15, 0.8);
      cable2.rotation.z = Math.PI / 2; cable2.rotation.y = 0.4;
      const mastP = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 8), material(0x758090, 0.6));
      mastP.position.set(0, 1.7, 0);
      const solarPanel = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.42, 0.03), material(0x1a2e48, 0.3, 0x081525));
      solarPanel.position.set(0, 2.05, 0); solarPanel.rotation.x = 0.45;
      const sparkLight = new THREE.PointLight(0xff9922, 0.75, 4.0);
      sparkLight.position.set(0.25, 0.9, 0.65);
      mg.add(basePad, genChassis, stripe, door, cavity, t1, t2, cable1, cable2, mastP, solarPanel, sparkLight);
      beaconY = 2.2;
      animate = (t) => {
        const isSolved = HC.save && (HC.save.mission > 0 || (HC.puzzle && HC.puzzle.solved));
        if (!isSolved) {
          sparkLight.intensity = Math.random() > 0.82 ? 1.6 : (Math.random() > 0.5 ? 0.3 : 0.05);
          sparkLight.color.setHex(Math.random() > 0.6 ? 0xffbb44 : 0x77d0ff);
        } else {
          sparkLight.intensity = 0.5;
          sparkLight.color.setHex(0x55ff66);
        }
      };
    }

    // 2. MARS: Damaged Communications Mast (signal)
    else if (id === 'comms') {
      customName = 'Align communications dish';
      const rockFoot = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, 0.3, 8), material(0x40322a, 0.9));
      rockFoot.position.y = 0.15;
      const recRack = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.75), material(0x38404a, 0.6));
      recRack.position.set(0, 0.55, 0);
      const oscScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ color: 0x48e5ff, transparent: true, opacity: 0.85 }));
      oscScreen.position.set(0, 0.65, 0.38);
      const mastGroup = new THREE.Group();
      mastGroup.position.set(0, 0.8, 0); mastGroup.rotation.z = -0.38;
      const lattice = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.35, 3.8, 4), material(0x707a86, 0.5));
      lattice.position.y = 1.9;
      const dishGroup = new THREE.Group();
      dishGroup.position.set(0, 3.6, 0);
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.2, 0.42, 16, 1, true), material(0xd5dade, 0.4));
      dish.rotation.x = Math.PI / 2 + 0.2;
      const feedBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), material(0x505860, 0.5));
      feedBoom.position.z = 0.45; feedBoom.rotation.x = Math.PI / 2;
      const horn = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0x48e5ff }));
      horn.position.z = 0.85;
      dishGroup.add(dish, feedBoom, horn);
      mastGroup.add(lattice, dishGroup);
      mg.add(rockFoot, recRack, oscScreen, mastGroup);
      beaconY = 3.6;
      animate = (t) => {
        horn.scale.setScalar(1 + Math.sin(t * 4) * 0.2);
        dishGroup.rotation.y = Math.sin(t * 0.4) * 0.15;
      };
    }

    // 3. MARS: Outpost Airlock Console & Entrance (ghosts)
    else if (id === 'outpost') {
      customName = 'Access outpost airlock console';
      const arch = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.9, 0.9), material(0x30353c, 0.8));
      arch.position.y = 1.45;
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.3, 0.12), material(0x48505c, 0.6));
      hatch.position.set(0, 1.25, 0);
      const hazardStripe = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.18, 0.14), material(0xffaa22, 0.5));
      hazardStripe.position.set(0, 1.9, 0);
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.05, 0.35), material(0x5a626e, 0.6));
      ped.position.set(1.15, 0.55, 0.45);
      const keyScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.24), new THREE.MeshBasicMaterial({ color: 0x50c8ff, transparent: true, opacity: 0.9 }));
      keyScreen.position.set(1.15, 0.95, 0.63); keyScreen.rotation.x = -0.4;
      const camPod = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), material(0x1a1d22, 0.3, 0x440000));
      camPod.position.set(0, 2.7, 0.55);
      const laserBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.15, 2.2, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3322, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
      laserBeam.position.set(0, 1.6, 0.55); laserBeam.rotation.x = 0.25;
      mg.add(arch, hatch, hazardStripe, ped, keyScreen, camPod, laserBeam);
      beaconY = 2.9;
      animate = (t) => {
        const droneActive = HC.drone && performance.now() >= HC.drone.disabledUntil;
        laserBeam.visible = !!droneActive;
        keyScreen.material.color.setHex(droneActive ? 0xff4433 : 0x50e880);
      };
    }

    // 4. MARS: Engine Components (shipbreaker)
    else if (id.indexOf('component') === 0) {
      const cIdx = parseInt(id.replace('component', ''), 10) || 0;
      if (cIdx === 0) {
        customName = 'Recover turbopump assembly';
        const pumpBody = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.52, 0.82, 12), material(0x525c68, 0.4));
        pumpBody.rotation.z = 0.35; pumpBody.position.y = 0.35;
        const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.12, 12), material(0x3a424a, 0.6));
        flange.position.set(-0.12, 0.65, 0); flange.rotation.z = 0.35;
        const pipeOut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.65, 8), material(0xb87333, 0.3));
        pipeOut.position.set(0.2, 0.25, 0.2); pipeOut.rotation.x = Math.PI / 2;
        mg.add(pumpBody, flange, pipeOut);
        beaconY = 1.0;
      } else if (cIdx === 1) {
        customName = 'Recover thruster gimbal';
        const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.065, 8, 16), material(0x606a76, 0.5));
        outerRing.position.y = 0.55; outerRing.rotation.x = Math.PI / 2;
        const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.05, 8, 16), material(0x48525e, 0.4));
        innerRing.position.y = 0.55; innerRing.rotation.y = 0.6;
        const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.75, 8), material(0xb0b8c2, 0.2));
        piston.position.y = 0.55;
        mg.add(outerRing, innerRing, piston);
        beaconY = 1.0;
      } else {
        customName = 'Recover avionics flight core';
        const compBox = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.38, 6), material(0xd4af37, 0.3, 0x332605));
        compBox.position.y = 0.35; compBox.rotation.z = 0.2;
        const heatsink = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.55), material(0x22252a, 0.8));
        heatsink.position.set(0, 0.52, 0);
        const ledBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffcc33 }));
        ledBeacon.position.set(0, 0.65, 0);
        mg.add(compBox, heatsink, ledBeacon);
        beaconY = 0.9;
        animate = (t) => {
          ledBeacon.scale.setScalar(1 + Math.sin(t * 6) * 0.3);
        };
      }
    }

    // 5. MARS: Ascent Engine Test Stand (shipbreaker)
    else if (id === 'engine') {
      customName = 'Mount engine components & rebuild';
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 2.8, 3, 1, true), material(0x454e58, 0.6));
      stand.position.y = 1.4;
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 1.25, 1.8, 16, 1, true), material(0x282c32, 0.5));
      nozzle.position.y = 1.1;
      const chamber = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.85, 12), material(0x5a636e, 0.4));
      chamber.position.y = 2.25;
      const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.18, 8), material(0xff9944, 0.3, 0x442200));
      s1.position.set(0.48, 2.3, 0);
      const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.18, 8), material(0x44aaff, 0.3, 0x002244));
      s2.position.set(-0.24, 2.3, 0.42);
      const s3 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.18, 8), material(0xffcc33, 0.3, 0x332200));
      s3.position.set(-0.24, 2.3, -0.42);
      const armM = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), material(0x606870, 0.6));
      armM.position.set(1.1, 1.0, 0.8);
      const engineScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), new THREE.MeshBasicMaterial({ color: 0x48e5ff, transparent: true, opacity: 0.9 }));
      engineScreen.position.set(1.1, 1.35, 0.8); engineScreen.rotation.y = -0.5;
      mg.add(stand, nozzle, chamber, s1, s2, s3, armM, engineScreen);
      beaconY = 2.8;
      animate = (t) => {
        const count = HC.save ? HC.save.components.length : 0;
        s1.material.color.setHex(count >= 1 ? 0x44ff55 : 0xff9944);
        s2.material.color.setHex(count >= 2 ? 0x44ff55 : 0x44aaff);
        s3.material.color.setHex(count >= 3 ? 0x44ff55 : 0xffcc33);
      };
    }

    // 6. MARS: Phased-Array Orbital Uplink Tower (departure)
    else if (id === 'relay') {
      customName = 'Activate orbital uplink relay';
      const foundation = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.85, 0.35, 6), material(0x282320, 0.9));
      foundation.position.y = 0.17;
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.75, 4.8, 4), material(0x5a6370, 0.5));
      pylon.position.y = 2.6;
      const arrayHead = new THREE.Group();
      arrayHead.position.set(0, 5.0, 0);
      const dishP = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.2, 0.38, 12, 1, true), material(0xd8e0e8, 0.4));
      dishP.rotation.x = Math.PI / 2;
      const hornA = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6), material(0x404850, 0.5));
      hornA.position.z = 0.35; hornA.rotation.x = Math.PI / 2;
      arrayHead.add(dishP, hornA);
      const caps = [];
      for (let i = 0; i < 4; i++) {
        const ang = (i * Math.PI) / 2;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.85, 8), material(0x323a44, 0.4, 0x003366));
        cap.position.set(Math.cos(ang) * 0.95, 0.7, Math.sin(ang) * 0.95);
        caps.push(cap); mg.add(cap);
      }
      mg.add(foundation, pylon, arrayHead);
      beaconY = 5.2;
      animate = (t) => {
        arrayHead.rotation.y = t * 0.5;
        caps.forEach((c, idx) => {
          const lit = Math.sin(t * 3 + idx * 1.5) > 0;
          c.material.color.setHex(lit ? 0x00e5ff : 0x223544);
        });
      };
    }

    // 7. PHOBOS: Docking Clamp Array (dead-dock)
    else if (id === 'dock') {
      customName = 'Restore docking clamp gantry';
      const gantryBase = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.35, 1.4), material(0x282c35, 0.85));
      gantryBase.position.y = 0.17;
      const jaw1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.9, 0.55), material(0xffaa22, 0.4));
      jaw1.position.set(-0.75, 1.15, 0);
      const jaw2 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.9, 0.55), material(0xffaa22, 0.4));
      jaw2.position.set(0.75, 1.15, 0);
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8), material(0x758090, 0.5));
      boom.position.set(0, 1.4, -0.4); boom.rotation.x = -0.5;
      mg.add(gantryBase, jaw1, jaw2, boom);
      beaconY = 2.1;
    }

    // 8. PHOBOS: Sealed Cargo Pod (silent-cargo)
    else if (id === 'cargo') {
      customName = 'Access sealed orbital cargo pod';
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.2, 6), material(0x4a5568, 0.55));
      pod.rotation.z = Math.PI / 2; pod.position.y = 0.85;
      const keypad = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.08), material(0x1a202c, 0.7));
      keypad.position.set(0, 0.95, 1.25);
      const keyLed = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0x48e5ff }));
      keyLed.position.set(0, 1.1, 1.3);
      mg.add(pod, keypad, keyLed);
      beaconY = 1.8;
      animate = (t) => {
        keyLed.material.color.setHex(Math.sin(t * 5) > 0 ? 0x48e5ff : 0x114455);
      };
    }

    // 9. PHOBOS: Security Grid Gateway (security-sweep)
    else if (id === 'security') {
      customName = 'Override station security grid';
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.8, 0.35), material(0x323a44, 0.6));
      p1.position.set(-1.1, 1.4, 0);
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.8, 0.35), material(0x323a44, 0.6));
      p2.position.set(1.1, 1.4, 0);
      const barrier = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 2.2), new THREE.MeshBasicMaterial({ color: 0xff3322, transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      barrier.position.set(0, 1.4, 0);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.65, 0.25), material(0xff9922, 0.5));
      box.position.set(-1.1, 1.2, 0.28);
      mg.add(p1, p2, barrier, box);
      beaconY = 2.8;
      animate = (t) => {
        barrier.material.opacity = 0.35 + Math.sin(t * 8) * 0.15;
      };
    }

    // 10. PHOBOS: Station Fusion Tokamak Core (reactor-puzzle)
    else if (id === 'reactor') {
      customName = 'Restart station fusion reactor';
      const torus = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.38, 12, 24), material(0x3a424e, 0.5));
      torus.position.y = 1.5; torus.rotation.x = Math.PI / 2;
      const pipeA = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8), material(0x8faec5, 0.4, 0x112838));
      pipeA.position.set(0, 1.5, 0);
      const plasmaCore = new THREE.Mesh(new THREE.SphereGeometry(0.65, 14, 10), new THREE.MeshBasicMaterial({ color: 0x48e5ff, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending }));
      plasmaCore.position.y = 1.5;
      mg.add(torus, pipeA, plasmaCore);
      beaconY = 2.6;
      animate = (t) => {
        plasmaCore.scale.setScalar(1 + Math.sin(t * 4) * 0.12);
      };
    }

    // 11. PHOBOS: Shattered Telemetry Terminal (broken-coordinates)
    else if (id === 'coordinates') {
      customName = 'Decode navigation coordinates';
      const desk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.85, 0.8), material(0x282e36, 0.7));
      desk.position.y = 0.42;
      const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.45), new THREE.MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.85 }));
      mon.position.set(0, 0.88, 0.2); mon.rotation.x = -0.35;
      const truss = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 4), material(0x5a6370, 0.6));
      truss.position.set(0.4, 0.9, -0.1); truss.rotation.z = 0.6;
      mg.add(desk, mon, truss);
      beaconY = 1.5;
    }

    // 12. EUROPA: Sub-Ice Acoustic Probe (white-silence)
    else if (id === 'surface-scan') {
      customName = 'Deploy sub-ice acoustic probe';
      const drill = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.15, 2.4, 10), material(0x506575, 0.4));
      drill.position.y = 1.0;
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), material(0x8fa5b8, 0.5));
        leg.position.set(Math.cos(i * 2.09) * 0.7, 0.8, Math.sin(i * 2.09) * 0.7);
        leg.rotation.z = Math.cos(i * 2.09) * 0.5; leg.rotation.x = Math.sin(i * 2.09) * 0.5;
        mg.add(leg);
      }
      const hornT = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.7, 10), material(0x9ff5ff, 0.3, 0x113344));
      hornT.position.y = 2.4; hornT.rotation.x = Math.PI;
      mg.add(drill, hornT);
      beaconY = 2.6;
      animate = (t) => {
        hornT.rotation.y = t * 1.8;
      };
    }

    // 13. EUROPA: Deep-Ice Sonar Station (under-ice)
    else if (id === 'scanner') {
      customName = 'Calibrate deep-ice sonar station';
      const winchFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 1.2), material(0x354b5e, 0.7));
      winchFrame.position.y = 1.1;
      const cableDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.8, 12), material(0x7090a8, 0.4));
      cableDrum.rotation.z = Math.PI / 2; cableDrum.position.set(0, 1.3, 0);
      const sonarScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.35), new THREE.MeshBasicMaterial({ color: 0x48e5ff, transparent: true, opacity: 0.9 }));
      sonarScreen.position.set(0, 1.5, 0.62);
      mg.add(winchFrame, cableDrum, sonarScreen);
      beaconY = 2.3;
    }

    // 14. EUROPA: Cryogenic Specimen Chamber (specimen-09)
    else if (id === 'specimen') {
      customName = 'Access cryogenic specimen chamber';
      const podBase = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 0.4, 16), material(0x283848, 0.8));
      podBase.position.y = 0.2;
      const glassCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 1.5, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x9eeeff, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
      glassCylinder.position.y = 1.15;
      const podCap = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.65, 0.3, 16), material(0x283848, 0.8));
      podCap.position.y = 2.0;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: 0x48e5ff }));
      crystal.position.y = 1.15;
      const cLight = new THREE.PointLight(0x48e5ff, 0.8, 3.5);
      cLight.position.y = 1.15;
      mg.add(podBase, glassCylinder, podCap, crystal, cLight);
      beaconY = 2.2;
      animate = (t) => {
        crystal.rotation.y = t * 1.2; crystal.rotation.x = t * 0.7;
        crystal.position.y = 1.15 + Math.sin(t * 2) * 0.08;
      };
    }

    // 15. EUROPA: Cryo-Compressor Bank (cold-storage)
    else if (id === 'cryo') {
      customName = 'Restore cryo-compressor bank';
      const bankBase = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 1.4), material(0x223545, 0.85));
      bankBase.position.y = 0.17;
      for (let i = 0; i < 4; i++) {
        const finCol = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.8, 0.9), material(0x8faec5, 0.4, 0x112838));
        finCol.position.set(-0.75 + i * 0.5, 1.15, 0);
        mg.add(finCol);
      }
      mg.add(bankBase);
      beaconY = 2.2;
    }

    // 16. EUROPA: Geothermal Melt Relay (signal-beneath)
    else if (id === 'thermal') {
      customName = 'Regulate thermal melt relay';
      const meltWell = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.35, 0.3, 16), material(0x223545, 0.9));
      meltWell.position.y = 0.15;
      const inductionRod = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.5, 12), material(0xff7722, 0.3, 0x662200));
      inductionRod.position.y = 1.3;
      for (let i = 0; i < 3; i++) {
        const ringT = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 8, 16), new THREE.MeshBasicMaterial({ color: 0xff6622 }));
        ringT.position.y = 0.8 + i * 0.5; ringT.rotation.x = Math.PI / 2;
        mg.add(ringT);
      }
      mg.add(meltWell, inductionRod);
      beaconY = 2.6;
    }

    // 17. TITAN: Atmospheric Sounding Mast (amber-skies)
    else if (id === 'atmo-probe') {
      customName = 'Deploy atmospheric sounding mast';
      const atmoBase = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 0.4, 8), material(0x3a2512, 0.85));
      atmoBase.position.y = 0.2;
      const atmoPole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 3.8, 8), material(0x8a6530, 0.6));
      atmoPole.position.y = 2.1;
      const anemometer = new THREE.Group();
      anemometer.position.set(0, 3.9, 0);
      for (let i = 0; i < 3; i++) {
        const ang = (i * Math.PI * 2) / 3;
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45), material(0x332211, 0.6));
        arm.position.set(Math.cos(ang) * 0.22, 0, Math.sin(ang) * 0.22);
        arm.rotation.z = Math.PI / 2; arm.rotation.y = -ang;
        const cup = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), material(0xffaa22, 0.4));
        cup.position.set(Math.cos(ang) * 0.45, 0, Math.sin(ang) * 0.45);
        anemometer.add(arm, cup);
      }
      mg.add(atmoBase, atmoPole, anemometer);
      beaconY = 4.1;
      animate = (t) => {
        anemometer.rotation.y = t * 3.5;
      };
    }

    // 18. TITAN: Methane Pumping Manifold (fuel-road)
    else if (id === 'fuel') {
      customName = 'Synchronize methane fuel manifold';
      const pipeBase = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 1.5), material(0x32200f, 0.9));
      pipeBase.position.y = 0.17;
      const mainPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 2.2, 12), material(0xa36624, 0.6));
      mainPipe.rotation.z = Math.PI / 2; mainPipe.position.set(0, 0.75, 0);
      const dial1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12), material(0xd4af37, 0.4));
      dial1.position.set(-0.5, 1.15, 0);
      const dial2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12), material(0xd4af37, 0.4));
      dial2.position.set(0.5, 1.15, 0);
      mg.add(pipeBase, mainPipe, dial1, dial2);
      beaconY = 1.6;
    }

    // 19. TITAN: Mining Camp Datapad Workbench (missing-miners)
    else if (id === 'miners') {
      customName = 'Inspect mining camp datapad';
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.85, 0.9), material(0x5f3512, 0.8));
      bench.position.y = 0.42;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.65), material(0x32200f, 0.9));
      crate.position.set(1.1, 0.32, 0.2); crate.rotation.y = 0.4;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.25), material(0x1a202c, 0.7));
      pad.position.set(0, 0.87, 0);
      const padScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.2), new THREE.MeshBasicMaterial({ color: 0xffaa33 }));
      padScreen.rotation.x = -Math.PI / 2; padScreen.position.set(0, 0.895, 0);
      mg.add(bench, crate, pad, padScreen);
      beaconY = 1.2;
    }

    // 20. TITAN: Catalytic Cracker Column (the-refinery)
    else if (id === 'refinery-core') {
      customName = 'Restart catalytic cracker core';
      const coreTower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 3.2, 12), material(0x74421b, 0.65));
      coreTower.position.y = 1.6;
      const heatExchanger = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.14, 8, 16), material(0xff9933, 0.3, 0x442200));
      heatExchanger.position.y = 1.8; heatExchanger.rotation.x = Math.PI / 2;
      mg.add(coreTower, heatExchanger);
      beaconY = 3.3;
    }

    // 21. TITAN: Tropospheric Microwave Horn (familiar-voice)
    else if (id === 'refinery') {
      customName = 'Align tropospheric microwave horn';
      const mastR = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 3.2, 8), material(0x5f3512, 0.7));
      mastR.position.y = 1.6;
      const hornBox = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.85, 1.6), material(0xd89a47, 0.5));
      hornBox.position.set(0, 3.2, 0); hornBox.rotation.x = -0.45;
      mg.add(mastR, hornBox);
      beaconY = 3.5;
    }

    // 22. CERES: Crashed Scout Fuselage (graveyard)
    else if (id === 'wreck-survey') {
      customName = 'Survey crashed scout fuselage';
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, 3.8, 8, 1, false), material(0x3a3d4a, 0.7));
      hull.position.set(0, 0.75, 0); hull.rotation.z = 0.45; hull.rotation.y = 0.6;
      const wingStub = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.85), material(0x282a32, 0.8));
      wingStub.position.set(0.8, 0.9, 0); wingStub.rotation.z = 0.2;
      mg.add(hull, wingStub);
      beaconY = 2.2;
    }

    // 23. CERES: Armored Flight Recorder (black-box)
    else if (id === 'black-box') {
      customName = 'Recover flight data recorder';
      const debris = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.2), material(0x24262e, 0.85));
      debris.position.y = 0.45;
      const blackBox = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.65, 12), material(0xff5511, 0.3, 0x441100));
      blackBox.rotation.z = Math.PI / 2; blackBox.position.set(0, 0.95, 0);
      const pinger = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffaa22 }));
      pinger.position.set(0.35, 0.95, 0);
      mg.add(debris, blackBox, pinger);
      beaconY = 1.3;
      animate = (t) => {
        pinger.scale.setScalar(1 + Math.sin(t * 8) * 0.3);
      };
    }

    // 24. CERES: Asteroid Echo Transponder (echo-relay)
    else if (id === 'echo-relay') {
      customName = 'Reactivate asteroid echo repeater';
      const anchorPylon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 3.4, 6), material(0x4a4d5c, 0.6));
      anchorPylon.position.y = 1.7;
      const wing1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.03), material(0x1a2e48, 0.3, 0x081525));
      wing1.position.set(-0.8, 2.6, 0);
      const wing2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.03), material(0x1a2e48, 0.3, 0x081525));
      wing2.position.set(0.8, 2.6, 0);
      mg.add(anchorPylon, wing1, wing2);
      beaconY = 3.5;
    }

    // 25. CERES: Quantum Mainframe Core (core-access)
    else if (id === 'core-access') {
      customName = 'Access quantum station core';
      const rack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 0.95), material(0x1a1c22, 0.85));
      rack.position.y = 1.3;
      for (let i = 0; i < 4; i++) {
        const mem = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.25, 0.12), new THREE.MeshBasicMaterial({ color: 0x48e5ff, transparent: true, opacity: 0.8 }));
        mem.position.set(0, 0.6 + i * 0.5, 0.48);
        mg.add(mem);
      }
      mg.add(rack);
      beaconY = 2.7;
    }

    // 26. CERES: Astrogation Holotable Console (homeward-vector)
    else if (id === 'nav-compile') {
      customName = 'Compile homeward vector on holotable';
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.55, 0.85, 24), material(0x282c35, 0.6));
      pedestal.position.y = 0.42;
      const holoRim = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.35, 24), material(0x3a424e, 0.4, 0x112838));
      holoRim.rotation.x = -Math.PI / 2; holoRim.position.y = 0.86;
      const holoGroup = new THREE.Group();
      holoGroup.position.set(0, 1.45, 0);
      const holoSun = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.85 }));
      const orbit1 = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.48, 32), new THREE.MeshBasicMaterial({ color: 0x48e5ff, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
      orbit1.rotation.x = Math.PI / 2;
      const orbit2 = new THREE.Mesh(new THREE.RingGeometry(0.85, 0.89, 32), new THREE.MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
      orbit2.rotation.x = Math.PI / 2 + 0.2;
      const trajectoryBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
      trajectoryBeam.rotation.z = Math.PI / 3;
      holoGroup.add(holoSun, orbit1, orbit2, trajectoryBeam);
      mg.add(pedestal, holoRim, holoGroup);
      beaconY = 2.2;
      animate = (t) => {
        holoGroup.rotation.y = t * 0.7;
        orbit1.rotation.z = t * 1.2;
        orbit2.rotation.z = -t * 0.8;
      };
    }

    // 27. EARTH: Laser Guidance Station (last-burn)
    else if (id === 'guidance') {
      customName = 'Run landing guidance diagnostics';
      const guidPod = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 1.2, 12), material(0xd8e0e8, 0.4));
      guidPod.position.y = 0.6;
      const laserSky = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 18, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x55ff66, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
      laserSky.position.y = 9.8;
      mg.add(guidPod, laserSky);
      beaconY = 1.6;
    }

    // 28. EARTH: Mission Control Satellite Terminal (radio-silence)
    else if (id === 'earth-comms') {
      customName = 'Restore Mission Control satellite link';
      const satBase = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.85, 1.1), material(0x323a42, 0.7));
      satBase.position.y = 0.42;
      const satDish = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.2, 0.45, 16, 1, true), material(0xeef2f5, 0.3));
      satDish.position.set(0, 1.8, 0); satDish.rotation.x = Math.PI / 3;
      mg.add(satBase, satDish);
      beaconY = 2.2;
      animate = (t) => {
        satDish.rotation.y = Math.sin(t * 0.3) * 0.25;
      };
    }

    // 29. EARTH: Heat Shield Inspection Rig (reentry)
    else if (id === 'heat-shield') {
      customName = 'Run heat shield test rig';
      const cradle = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 1.4), material(0x28323a, 0.8));
      cradle.position.y = 0.2;
      const shieldSeg = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.15, 16, 1, false, 0, Math.PI), material(0x1a1a1a, 0.95));
      shieldSeg.position.set(0, 0.95, 0); shieldSeg.rotation.x = Math.PI / 2;
      mg.add(cradle, shieldSeg);
      beaconY = 1.6;
    }

    // 30. EARTH: Runway Touchdown Hub (landing-pad)
    else if (id === 'landing-pad') {
      customName = 'Execute runway touchdown sequence';
      const pylonH = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.4, 0.85), material(0x3a4855, 0.6));
      pylonH.position.y = 1.2;
      for (let i = 0; i < 4; i++) {
        const ang = (i * Math.PI) / 2;
        const flood = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.35), new THREE.MeshBasicMaterial({ color: 0x48e5ff }));
        flood.position.set(Math.cos(ang) * 0.5, 2.3, Math.sin(ang) * 0.5);
        flood.rotation.y = -ang;
        mg.add(flood);
      }
      mg.add(pylonH);
      beaconY = 2.6;
    }

    // 31. EARTH: Genesis Carrier Beacon (final-signal)
    else if (id === 'final-signal') {
      customName = 'Interface with Genesis Carrier Beacon';
      const plaza1 = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.0, 0.45, 24), material(0xd0d8e0, 0.4));
      plaza1.position.y = 0.22;
      const plaza2 = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.4, 24), material(0x90a0b0, 0.5));
      plaza2.position.y = 0.62;
      const towerCore = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.95, 7.5, 8), material(0xeef5fc, 0.2, 0x112838));
      towerCore.position.y = 4.3;
      const ringG1 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.08, 8, 32), new THREE.MeshBasicMaterial({ color: 0x48e5ff, transparent: true, opacity: 0.8 }));
      ringG1.position.y = 3.5; ringG1.rotation.x = Math.PI / 2;
      const ringG2 = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.08, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.8 }));
      ringG2.position.y = 5.2; ringG2.rotation.x = Math.PI / 2;
      const energyOrb = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      energyOrb.position.y = 8.1;
      const orbLight = new THREE.PointLight(0xffeedd, 1.4, 12);
      orbLight.position.y = 8.1;
      mg.add(plaza1, plaza2, towerCore, ringG1, ringG2, energyOrb, orbLight);
      beaconY = 8.3;
      animate = (t) => {
        ringG1.rotation.z = t * 0.8;
        ringG2.rotation.z = -t * 0.6;
        energyOrb.scale.setScalar(1 + Math.sin(t * 3) * 0.15);
      };
    }

    // 32. AUX: Spacecraft Boarding Gantry Platform (launch)
    else if (id === 'launch') {
      customName = label || 'Board spacecraft and depart';
      const gantryBase = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 2.2), material(0x283038, 0.8));
      gantryBase.position.y = 0.12;
      const stairs = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.4), material(0x4a5562, 0.6));
      stairs.position.set(0, 0.45, 0.3);
      const consoleStand = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.25), material(0x5a6572, 0.6));
      consoleStand.position.set(0.65, 0.95, -0.6);
      const boardScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.22), new THREE.MeshBasicMaterial({ color: 0x44ff66 }));
      boardScreen.position.set(0.65, 1.25, -0.46); boardScreen.rotation.x = -0.3;
      mg.add(gantryBase, stairs, consoleStand, boardScreen);
      beaconY = 1.6;
      animate = (t) => {
        const canLaunch = HC.save && HC.save.departureReady;
        boardScreen.material.color.setHex(canLaunch ? 0x44ff66 : 0x48e5ff);
      };
    }

    // 33. AUX: Geological Science Samples (sample0..2)
    else if (id.indexOf('sample') === 0) {
      customName = 'Collect scientific sample';
      const rockMound = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65, 0), material(0x543b32, 0.9));
      rockMound.position.y = 0.35;
      const crystalA = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), new THREE.MeshBasicMaterial({ color: 0xff7733 }));
      crystalA.position.set(0.18, 0.65, 0.12);
      const crystalB = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), new THREE.MeshBasicMaterial({ color: 0xffaa44 }));
      crystalB.position.set(-0.2, 0.6, -0.15);
      const drillTripod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9), material(0x8fa0b0, 0.5));
      drillTripod.position.set(0, 0.7, 0);
      mg.add(rockMound, crystalA, crystalB, drillTripod);
      beaconY = 1.0;
    }

    // Fallback: High-Tech Industrial Terminal Pedestal
    else {
      const basePad = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.2, 10), material(0x323842, 0.85));
      basePad.position.y = 0.1;
      const column = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.15, 0.42), material(0x556070, 0.6));
      column.position.y = 0.68;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.42), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      scr.position.set(0, 0.82, 0.22);
      mg.add(basePad, column, scr);
      beaconY = 1.4;
    }

    return { mesh: mg, beaconY, name: customName, animate };
  }

  function terminalVisual(root, id, x, z, color, label) {
    const g = new THREE.Group();
    g.name = 'homecoming-' + id;
    const baseP = pos(x, z);
    g.position.copy(baseP);
    root.add(g);

    // Contextual 3D model generation based on specific mission objective
    const modelData = buildContextualMissionModel(id, color, label);
    g.add(modelData.mesh);

    // Ground interaction ring flush with terrain
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.32, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .7, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos(x, z, .035));
    root.add(ring);

    // Contextual status beacon (mounted directly on top of the apparatus rather than a 5m pole!)
    const beacon = new THREE.Group();
    const topY = modelData.beaconY || 1.8;
    const topSphere = new THREE.Mesh(
      new THREE.SphereGeometry(.12, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85 })
    );
    topSphere.position.y = topY;
    const glowSphere = new THREE.Mesh(
      new THREE.SphereGeometry(.32, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glowSphere.position.y = topY;
    const accentSpire = new THREE.Mesh(
      new THREE.CylinderGeometry(.012, .012, 1.0, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    accentSpire.position.y = topY + 0.5;
    beacon.add(topSphere, glowSphere, accentSpire);
    beacon.position.copy(pos(x, z));
    root.add(beacon);

    // Register active animator if model provides dynamic motion
    if (typeof modelData.animate === 'function') {
      if (!HC.missionObjectAnimators) HC.missionObjectAnimators = [];
      HC.missionObjectAnimators.push(modelData.animate);
    }

    const object = {
      id,
      name: modelData.name || label,
      pos: new V(x, yAt(x, z), z),
      group: g,
      ring,
      beacon,
      radius: (id === 'launch' || id === 'cargo') ? 5.2 : 4.8,
      collected: false
    };
    HC.objects[id] = object;
    return object;
  }
  function makeAudioLogMarkers(root) {
    const p = HC.planet || PLANETS[0];
    const logs = AUDIO_LOGS[p.id] || [];
    HC.audioLogObjects = [];
    logs.forEach(log => {
      if (HC.save.audioLogs.includes(log.id)) return; // Already collected
      const g = new THREE.Group();
      // Small glowing cube marker
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(.3, .3, .3),
        new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: .8 })
      );
      cube.position.y = .5;
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(.4, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: .2, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      glow.position.y = .5;
      g.add(cube, glow);
      g.position.copy(pos(log.x, log.z, .1));
      root.add(g);
      HC.audioLogObjects.push({ group: g, log, pos: new V(log.x, yAt(log.x, log.z), log.z), radius: 2.8 });
    });
  }
  function makeWorld() {
    HC.planet = PLANETS[HC.save.planet || 0];
    // Clean up old world if present
    if (HC.world) { scene.remove(HC.world); HC.world = null; }
    if (HC.planet.id !== 'mars') { makeGenericWorld(HC.planet); return; }
    HC.world = new THREE.Group(); HC.world.visible = false; HC.world.name = 'homecoming-mars-world'; scene.add(HC.world); scene.fog = new THREE.FogExp2(0x120706, .012);
    initDustPuffPool(HC.world);
    makeTerrain(HC.world); makeRockField(HC.world); makeMountains(HC.world); makeAstronaut(HC.world); makeRover(HC.world); HC.objects = {}; HC.optionalObjects = []; HC.missionObjectAnimators = [];
    terminalVisual(HC.world, 'power', 7, 8, 0xff7545, 'Repair emergency terminal');
    terminalVisual(HC.world, 'comms', -31, 20, 0x74dfff, 'Align communications terminal');
    terminalVisual(HC.world, 'outpost', 28, -26, 0x8de7ff, 'Access outpost terminal');
    terminalVisual(HC.world, 'engine', 5, -26, 0xffb15c, 'Repair ascent engine');
    terminalVisual(HC.world, 'relay', -42, -38, 0xff7050, 'Activate orbital relay');
    terminalVisual(HC.world, 'launch', -2, -9, 0x8fe7ff, 'Board the ascent craft');
    [[-14, -17], [17, 19], [35, 7]].forEach((p, i) => terminalVisual(HC.world, 'component' + i, p[0], p[1], 0xffcc7a, 'Collect engine component'));
    // Main Spacecraft at Mars Landing/Crash Site with visible repair state (Task 6)
    const isMarsRepaired = HC.save && (HC.save.mission >= 4 || HC.save.departureReady);
    const mainShipMars = buildMainSpacecraft('mars', isMarsRepaired);
    mainShipMars.position.copy(pos(-2, -2));
    HC.world.add(mainShipMars);
    createSkyPhenomena(HC.world, 'mars');

    // High-Fidelity Mars Habitat Outpost with Insulated Beta-Cloth Dome & Titanium Airlock
    const outpost = new THREE.Group();
    outpost.name = 'mars-outpost-base';
    const outFoundation = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.8, 3.2, 24), pbrMetal(0x282b30, 0.85, 0.25));
    outFoundation.position.y = -0.6;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), pbrFabric(0xe6eaee, 0.92));
    dome.position.y = 1.0;
    const module = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.4, 4.2), pbrMetal(0x424952, 0.65, 0.38));
    module.position.y = 1.1;
    const airlockDoor = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.8, 0.15), pbrMetal(0x252a32, 0.5, 0.5));
    airlockDoor.position.set(0, 0.9, 2.15);
    const airlockLed = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0x55ff66 }));
    airlockLed.position.set(0.9, 1.6, 2.18);
    const roofAntenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4.2, 6), pbrMetal(0x8894a0, 0.6, 0.3));
    roofAntenna.position.set(2.5, 4.8, -1.0);
    outpost.add(outFoundation, module, dome, airlockDoor, airlockLed, roofAntenna);
    enableShadows(outpost);
    outpost.position.copy(pos(31, -23));
    HC.world.add(outpost);

    HC.solids = [{ x: -2, z: -2, r: 4 }, { x: 33, z: -21, r: 3.0 }, { x: 7, z: 8, r: 1.1 }, { x: -31, z: 20, r: 1.2 }, { x: -42, z: -38, r: 1.2 }];
    makeDrone(HC.world);
    // Optional sample pickups
    for (let i = 0; i < 3; i++) { const x = -16 + i * 20, z = -17 + (i % 2) * 31, id = 'sample' + i; const o = terminalVisual(HC.world, id, x, z, 0xff6b38, 'Collect scientific sample'); o.optional = true; HC.optionalObjects.push(o); }
    makeAudioLogMarkers(HC.world);
    initScannerVisual(HC.world);
    makeSignalFragmentMarkers(HC.world);
    makeScannableMarkers(HC.world);
    initTutorialObjects(HC.world);

    // Realistic Mars Directional Sunlight with Soft Shadows
    const amb = new THREE.HemisphereLight(0xffb18d, 0x17090a, .42);
    const sun2 = new THREE.DirectionalLight(0xffd0ae, .78);
    sun2.position.set(-30, 42, 19);
    sun2.castShadow = true;
    sun2.shadow.mapSize.width = 2048;
    sun2.shadow.mapSize.height = 2048;
    sun2.shadow.camera.near = 2;
    sun2.shadow.camera.far = 140;
    sun2.shadow.camera.left = -58;
    sun2.shadow.camera.right = 58;
    sun2.shadow.camera.top = 58;
    sun2.shadow.camera.bottom = -58;
    sun2.shadow.bias = -0.0003;
    sun2.shadow.normalBias = 0.02;
    HC.sunLight = sun2;
    HC.world.add(amb, sun2);
    HC.world.add(new THREE.PointLight(0xff6434, .55, 28).translateX(-2).translateZ(-2));
  }
  function makeGenericWorld(p) {
    HC.world = new THREE.Group(); HC.world.visible = false; HC.world.name = 'homecoming-' + p.id + '-world'; scene.add(HC.world); scene.fog = new THREE.FogExp2(p.fog, .009); HC.objects = {}; HC.optionalObjects = []; HC.missionObjectAnimators = [];
    initDustPuffPool(HC.world);
    makeTerrain(HC.world); makeRockField(HC.world); makeMountains(HC.world); makeAstronaut(HC.world); makeRover(HC.world);
    const layout = {
      phobos: [
        ['dock', 8, 10, 0x9edbff, 'Restore docking array'],
        ['cargo', -22, 15, 0xb3cfff, 'Access sealed cargo bay'],
        ['security', 30, -12, 0xff9b88, 'Disable security grid'],
        ['reactor', -15, -25, 0xffc466, 'Restart station reactor'],
        ['coordinates', -30, 19, 0xb9d0ff, 'Decode navigation coordinates']
      ],
      europa: [
        ['surface-scan', 8, 10, 0x9ff5ff, 'Deploy surface scanner'],
        ['scanner', 22, -18, 0x8ad6ff, 'Calibrate sub-ice scanner'],
        ['specimen', -28, 14, 0xb9e8ff, 'Access frozen research lab'],
        ['cryo', 35, 25, 0x7cc8ff, 'Restore cryo-array power'],
        ['thermal', -31, 20, 0x7cc8ff, 'Stabilise thermal relay']
      ],
      titan: [
        ['atmo-probe', 10, 12, 0xffd080, 'Deploy atmospheric probe'],
        ['fuel', -20, 15, 0xffbf62, 'Synchronise fuel manifold'],
        ['miners', 30, -13, 0xff9e55, 'Investigate mining camp'],
        ['refinery-core', -25, -22, 0xff7d4a, 'Restart refinery core'],
        ['refinery', 15, -30, 0xff7d4a, 'Align refinery signal']
      ],
      ceres: [
        ['wreck-survey', 10, 12, 0x8899bb, 'Chart debris field'],
        ['black-box', -28, 18, 0x99aacc, 'Recover flight recorder'],
        ['echo-relay', 30, -15, 0x7788aa, 'Reactivate echo relay'],
        ['core-access', -20, -25, 0xaabbdd, 'Access station core'],
        ['nav-compile', -35, -32, 0x8fe7ff, 'Compile navigation solution']
      ],
      earth: [
        ['guidance', 9, 10, 0x83eaff, 'Run landing guidance'],
        ['earth-comms', -25, 16, 0x7cc8ff, 'Restore mission control comms'],
        ['heat-shield', 30, -13, 0xff9b88, 'Heat shield diagnostic'],
        ['landing-pad', -18, -28, 0x83eaff, 'Execute landing approach'],
        ['final-signal', 0, -40, 0xffd84a, 'Investigate final transmission']
      ]
    }[p.id] || [];
    layout.forEach(row => terminalVisual(HC.world, row[0], row[1], row[2], row[3], row[4]));
    terminalVisual(HC.world, 'launch', p.launch[0], p.launch[1], 0x8fe7ff, p.id === 'earth' ? 'Enter mission command' : 'Board spacecraft and depart');

    // Planet-specific landmarks with deep embedded foundations (ZERO gaps!)
    const landmark = new THREE.Group();
    if (p.id === 'phobos') {
      // Space station modules
      const foundation = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.8, 3.5, 16), material(p.rock, .85));
      foundation.position.y = -0.5;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.8, 1.5, 16), material(0x2a2f3a, .8));
      base.position.y = 1.5;
      const module1 = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 4.5), material(0x4a5060, .68));
      const module2 = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 6, 10), material(0x3a4050, .72));
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, 7, 6), material(0x8899aa, .5));
      module1.position.y = 3.2; module2.position.set(5, 3.2, 0); module2.rotation.z = Math.PI / 2; antenna.position.set(0, 6.5, 0);
      landmark.add(foundation, base, module1, module2, antenna);
    } else if (p.id === 'europa') {
      // Ice research dome - completely sealed with deep foundation and zero floating gaps!
      const foundation = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.8, 3.5, 24), material(0x223545, .85));
      foundation.position.y = -0.5; // extends 2.25m into the ice ground!
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.8, 2.0, 24), material(0x354b5e, .75));
      wall.position.y = 1.8; // extends from 0.8 to 2.8, meeting the foundation!
      const dome = new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), material(0x88bbcc, .55, 0x112838));
      dome.position.y = 2.8; // sits directly flush on top of wall, completely sealed!
      const airlock = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 4.0), material(0x2c3e50, .8));
      airlock.position.set(0, 1.0, 4.2);
      const commTower = new THREE.Mesh(new THREE.CylinderGeometry(.12, .18, 7.5, 8), material(0x8faec5, .5));
      commTower.position.set(-4.5, 4.5, -2.5);
      const iceColumn = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1.4, 7, 6), material(0xd6f2f4, .25, 0x2a6680));
      iceColumn.position.set(-6, 2.5, 1.5);
      landmark.add(foundation, wall, dome, airlock, commTower, iceColumn);
    } else if (p.id === 'titan') {
      // Refinery complex with solid foundation
      const foundation = new THREE.Mesh(new THREE.BoxGeometry(14, 3.0, 10), material(0x3a2512, .85));
      foundation.position.y = -0.5;
      const silo1 = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 7, 10), material(0x8a6530, .65));
      const silo2 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2, 5, 10), material(0x7a5520, .65));
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 8, 8), material(0x554422, .7));
      silo1.position.y = 4.5; silo2.position.set(4, 3.5, 0); pipe.position.set(2, 2, 2); pipe.rotation.z = Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, .12, 8, 36), material(0xffa03a, .4, 0x582700));
      ring.rotation.x = Math.PI / 2; ring.position.y = 7.5;
      landmark.add(foundation, silo1, silo2, pipe, ring);
    } else if (p.id === 'ceres') {
      // Derelict wreck field partially embedded in impact crater
      const craterBed = new THREE.Mesh(new THREE.CylinderGeometry(8, 9, 3.0, 16), material(0x1a1b22, .9));
      craterBed.position.y = -1.0;
      const wreck1 = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2, 8, 8), material(0x3a3d4a, .75));
      wreck1.rotation.z = Math.PI * .15; wreck1.position.set(0, 1.5, 0);
      const wreck2 = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 3), material(0x2a2d38, .8));
      wreck2.position.set(5, 0.8, -3); wreck2.rotation.y = .4;
      const debris1 = new THREE.Mesh(new THREE.TetrahedronGeometry(1.5, 0), material(0x4a4d5c, .9));
      debris1.position.set(-4, .6, 2);
      const debris2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), material(0x33354a, .85));
      debris2.position.set(3, .5, 4);
      landmark.add(craterBed, wreck1, wreck2, debris1, debris2);
    } else if (p.id === 'earth') {
      // Landing pad
      const foundation = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.5, 3.0, 24), material(0x253b28, .85));
      foundation.position.y = -1.0;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, .5, 24), material(0x556b55, .7));
      pad.position.y = 0.5;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.5, 9, 1.5), material(0x445544, .6));
      tower.position.set(7, 4.5, 0);
      const light = new THREE.Mesh(new THREE.SphereGeometry(.35, 8, 6), material(0x55ff55, .2, 0x22aa22));
      light.position.set(7, 9.2, 0);
      landmark.add(foundation, pad, tower, light);
    } else {
      const foundation = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.8, 3.5, 16), material(p.rock, .85));
      foundation.position.y = -0.5;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 5.1, .75, 14), material(p.rock, .75));
      const tower = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.2, 4.2), material(p.palette[1], .68));
      base.position.y = .38; tower.position.y = 2;
      landmark.add(foundation, base, tower);
    }
    enableShadows(landmark);
    landmark.position.copy(pos(30, -23)); HC.world.add(landmark);

    // Optional sample pickups
    for (let i = 0; i < 3; i++) { const x = -16 + i * 20, z = -17 + (i % 2) * 31, id = 'sample' + i; const o = terminalVisual(HC.world, id, x, z, p.atmosphere, 'Collect scientific sample'); o.optional = true; HC.optionalObjects.push(o); }
    makeAudioLogMarkers(HC.world);
    initScannerVisual(HC.world);
    makeSignalFragmentMarkers(HC.world);
    makeScannableMarkers(HC.world);
    // Main Spacecraft visible at Destination (Task 6)
    const mainShipDest = buildMainSpacecraft(p.id, true);
    mainShipDest.position.copy(pos(p.launch[0], p.launch[1]));
    HC.world.add(mainShipDest);
    createSkyPhenomena(HC.world, p.id);

    HC.solids = [{ x: 30, z: -23, r: 5.4 }, { x: p.launch[0], z: p.launch[1], r: 2.5 }].concat(layout.map(row => ({ x: row[1], z: row[2], r: 0.85 })));
    HC.drone = null;

    // Planet-specific security cameras & drones (combat variety)
    makeDrone(HC.world, 15, -10);

    // Realistic Planetary Directional Sunlight with Soft Shadows
    const amb = new THREE.HemisphereLight(p.palette[2], p.sky, .52);
    const sun2 = new THREE.DirectionalLight(0xffe0c0, .75);
    sun2.position.set(-30, 42, 19);
    sun2.castShadow = true;
    sun2.shadow.mapSize.width = 2048;
    sun2.shadow.mapSize.height = 2048;
    sun2.shadow.camera.near = 2;
    sun2.shadow.camera.far = 140;
    sun2.shadow.camera.left = -58;
    sun2.shadow.camera.right = 58;
    sun2.shadow.camera.top = 58;
    sun2.shadow.camera.bottom = -58;
    sun2.shadow.bias = -0.0003;
    sun2.shadow.normalBias = 0.02;
    HC.sunLight = sun2;
    HC.world.add(amb, sun2);
    HC.world.add(new THREE.PointLight(p.atmosphere, .5, 28).translateX(p.launch[0]).translateZ(p.launch[1]));
  }

  function checkLineOfSight(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 16.0) return false;
    const steps = Math.max(5, Math.min(14, Math.floor(dist * 1.5)));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const sx = p1.x + dx * f;
      const sy = p1.y + dy * f;
      const sz = p1.z + dz * f;
      if (typeof terrainHeight === 'function') {
        const gh = terrainHeight(sx, sz);
        if (gh > sy + 0.35) return false;
      }
      if (HC.solids && HC.solids.length) {
        for (let j = 0; j < HC.solids.length; j++) {
          const s = HC.solids[j];
          if (Math.hypot(sx - s.x, sz - s.z) < s.r * 0.9) return false;
        }
      }
    }
    return true;
  }

  function aimAtTarget(head, groupPos, targetPos, dt, speed) {
    if (!head) return;
    const dx = targetPos.x - groupPos.x;
    const dy = targetPos.y - (groupPos.y + 0.3);
    const dz = targetPos.z - groupPos.z;
    // Eye lens is on -Z in head coordinates, so add Math.PI to yaw
    const targetYaw = Math.atan2(dx, dz) + Math.PI;
    const targetPitch = Math.atan2(dy, Math.hypot(dx, dz));
    head.rotation.y = angleLerp(head.rotation.y, targetYaw, clamp(dt * speed, 0, 1));
    head.rotation.x = angleLerp(head.rotation.x, -targetPitch, clamp(dt * speed, 0, 1));
  }

  function makeDrone(root, x = 22, z = -19) {
    const g = new THREE.Group();
    g.name = 'security-drone-camera';

    // Pedestal mounting bracket
    const baseBracket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.36, 0.45, 8),
      material(0x242830, 0.85)
    );
    baseBracket.position.y = -0.3;
    g.add(baseBracket);

    // Aiming Head unit (rotates on yaw and pitch)
    const head = new THREE.Group();
    head.name = 'drone-head';

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 16, 12),
      material(0x323941, 0.35, 0x101418)
    );

    // Security Camera Red Eye Lens
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0x220503,
        emissive: 0x661108,
        roughness: 0.2,
        metalness: 0.8
      })
    );
    eye.position.set(0, 0, -0.42);

    // Lens reticle shroud / bezel
    const lensBezel = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.025, 8, 16),
      material(0x55606d, 0.5)
    );
    lensBezel.position.set(0, 0, -0.42);

    // Horizontal side stabilizer arms
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 1.5, 8),
      material(0x555b61, 0.5)
    );
    arm.rotation.z = Math.PI / 2;

    // Surveillance warning point light at the eye
    const warningLight = new THREE.PointLight(0xff2211, 0.4, 4.0);
    warningLight.position.set(0, 0, -0.5);

    head.add(core, eye, lensBezel, arm, warningLight);
    g.add(head);
    enableShadows(g);

    g.position.copy(pos(x, z, 1.6));
    root.add(g);

    // Reusable Red Laser Beam Assembly
    const laserGroup = new THREE.Group();
    laserGroup.name = 'drone-red-laser';
    laserGroup.visible = false;

    // Inner intense core beam
    const coreGeom = new THREE.CylinderGeometry(0.035, 0.035, 1.0, 8, 1, true);
    coreGeom.translate(0, 0.5, 0); // origin at base for direct scaling & positioning
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    const coreMesh = new THREE.Mesh(coreGeom, coreMat);

    // Outer red glow beam
    const glowGeom = new THREE.CylinderGeometry(0.14, 0.14, 1.0, 8, 1, true);
    glowGeom.translate(0, 0.5, 0);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff1100, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowMesh = new THREE.Mesh(glowGeom, glowMat);

    // Targeting tracer line (for CHARGING warning phase)
    const tracerGeom = new THREE.CylinderGeometry(0.008, 0.008, 1.0, 6, 1, true);
    tracerGeom.translate(0, 0.5, 0);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xff4411, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const tracerMesh = new THREE.Mesh(tracerGeom, tracerMat);

    laserGroup.add(coreMesh, glowMesh, tracerMesh);
    root.add(laserGroup);

    // Laser Impact Burst Mesh
    const impactGeom = new THREE.SphereGeometry(0.24, 8, 6);
    const impactMat = new THREE.MeshBasicMaterial({ color: 0xff3311, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
    const impactMesh = new THREE.Mesh(impactGeom, impactMat);
    impactMesh.visible = false;
    root.add(impactMesh);

    HC.drone = {
      group: g,
      head,
      core,
      eye,
      warningLight,
      laserGroup,
      coreMesh,
      glowMesh,
      tracerMesh,
      impactMesh,
      state: 'IDLE',
      stateTimer: 0,
      disabledUntil: 0,
      alert: false,
      phase: 0,
      baseYaw: 0,
      hasFiredInCycle: false,
      lastDamageTime: 0
    };
  }

  function player() { return HC.rover.driving ? HC.rover.group.position : HC.astronaut.group.position; }
  function currentPlanet() { return PLANETS[HC.save.planet || 0]; }
  function mission() { return HC.save.mission < MISSIONS.length ? MISSIONS[HC.save.mission] : null; }
  function activeObjectIds() {
    if (HC.save.departureReady) return ['launch'];
    const curP = HC.save.planet || 0;
    const m = mission();
    if (!m || m.planet !== curP) return ['launch'];
    if (m.target === 'components') { const missing = ['component0', 'component1', 'component2'].filter(id => !HC.save.components.includes(id)); return missing.length ? missing : ['engine']; }
    return [m.target];
  }
  function waypoint() {
    let wp = null;
    if (typeof tutorialState !== 'undefined' && tutorialState.active) {
      if (tutorialState.stepIndex === 0) {
        wp = { id: 'tutorial_beacon', name: 'Navigation Beacon', pos: new V(7, yAt(7, -11), -11), radius: 3.5 };
      } else if (tutorialState.stepIndex === 1) {
        wp = { id: 'tutorial_ship', name: 'Ascent Spacecraft', pos: new V(4.8, yAt(4.8, -2), -2), radius: 3.5 };
      } else if (tutorialState.stepIndex === 2) {
        wp = { id: 'tutorial_landing', name: 'Landing Zone', pos: new V(14, yAt(14, -11), -11), radius: 3.5 };
      } else if (tutorialState.stepIndex === 3) {
        wp = { id: 'tutorial_pod', name: 'Telemetry Pod', pos: new V(14, yAt(14, -7), -7), radius: 3.5 };
      } else if (tutorialState.stepIndex === 4) {
        wp = { id: 'tutorial_mineral', name: 'Hematite Mineral', pos: new V(10, yAt(10, -4), -4), radius: 3.5 };
      } else if (tutorialState.stepIndex === 5) {
        wp = { id: 'tutorial_nav', name: 'Survey Staging Ridge', pos: new V(2, yAt(2, -14), -14), radius: 3.5 };
      } else if (tutorialState.stepIndex === 6) {
        if (!tutorialState.roverEntered) {
          wp = { id: 'tutorial_rover', name: 'Exploration Rover', pos: new V(-2, yAt(-2, -9), -9), radius: 3.5 };
        } else {
          wp = { id: 'tutorial_transit', name: 'Transit Marker', pos: new V(-18, yAt(-18, -12), -12), radius: 4.5 };
        }
      } else if (tutorialState.stepIndex === 7) {
        wp = { id: 'tutorial_terminal', name: 'Field Terminal', pos: new V(-8, yAt(-8, -5), -5), radius: 3.5 };
      } else if (tutorialState.stepIndex === 8) {
        wp = { id: 'tutorial_engine', name: 'Spacecraft Engine', pos: new V(4.8, yAt(4.8, -2), -2), radius: 4.0 };
      }
    } else {
      const ids = activeObjectIds(); if (!ids.length) return null;
      const me = player();
      wp = ids.map(id => HC.objects[id]).filter(o => o).sort((a, b) => me.distanceToSquared(a.pos) - me.distanceToSquared(b.pos))[0];
    }
    if (!wp || !wp.pos) return wp;
    const safe = resolveClearCheckpointPosition(wp.pos.x, wp.pos.z, 1.8);
    if (Math.abs(safe.x - wp.pos.x) > 0.05 || Math.abs(safe.z - wp.pos.z) > 0.05) {
      return { id: wp.id, name: wp.name, pos: new V(safe.x, yAt(safe.x, safe.z), safe.z), radius: Math.max(wp.radius || 3.5, 3.8) };
    }
    return wp;
  }
  function isCollision(p, radius) { return Math.abs(p.x) > 86 || Math.abs(p.z) > 86 || HC.solids.some(s => Math.hypot(p.x - s.x, p.z - s.z) < s.r + radius); }
  function updateMarkers(t) {
    const active = activeObjectIds(); Object.keys(HC.objects).forEach(id => { const o = HC.objects[id], on = HC.state === STATES.EXPLORATION && active.includes(id) && !o.collected, optional = o.optional && !HC.save.optional.includes(id); o.beacon.visible = on || optional; o.ring.visible = on || optional; o.beacon.children.forEach(c => { if (optional && !on) c.material.opacity = .14; else if (c.material) c.material.opacity = .55; }); o.ring.material.opacity = optional && !on ? .28 : .7; o.ring.rotation.z = t * .9; o.ring.scale.setScalar(1 + Math.sin(t * 3 + id.length) * .08); });
    // Animate active contextual mission apparatus models (sparks, rotating dishes, monitors, plasma core)
    if (HC.missionObjectAnimators && HC.missionObjectAnimators.length) {
      for (let i = 0; i < HC.missionObjectAnimators.length; i++) {
        try { HC.missionObjectAnimators[i](t); } catch (e) {}
      }
    }
    // Signal fragment markers bob & spin
    if (HC.signalFragmentObjects) {
      HC.signalFragmentObjects.forEach(obj => {
        if (!obj.group.visible) return;
        obj.node.rotation.y = t * 1.5;
        obj.node.rotation.x = t * 0.8;
        obj.aura.scale.setScalar(1 + Math.sin(t * 3.5) * 0.12);
        obj.group.position.y = yAt(obj.fragment.x, obj.fragment.z, 0.1) + Math.sin(t * 2.5) * 0.15;
      });
    }
    // Audio log markers bob
    if (HC.audioLogObjects) {
      HC.audioLogObjects.forEach(obj => {
        if (!obj.group.visible) return;
        obj.group.children[0].rotation.y = t * 2;
        obj.group.children[0].position.y = .5 + Math.sin(t * 3) * .1;
      });
    }
    // Interactive Tutorial 3D marker animation
    if (typeof tutorialState !== 'undefined' && tutorialState.active && tutorialState.markerGroup) {
      animateTutorialMarker(t);
    }
  }
  function nearestInteractable() {
    if (HC.rover && HC.rover.driving) return null;
    const active = activeObjectIds(), me = player();
    if (!me) return null;
    let best = null;
    let bestDistSq = Infinity;

    // Interactive Tutorial Pod (Step 4)
    if (typeof tutorialState !== 'undefined' && tutorialState.active && tutorialState.stepIndex === 3 && tutorialState.pod) {
      const dSq = (me.x - tutorialState.pod.position.x) ** 2 + (me.z - tutorialState.pod.position.z) ** 2;
      if (dSq <= 3.8 * 3.8 && Math.abs(me.y - tutorialState.pod.position.y) <= 4.2) {
        return { id: 'tutorial_pod', name: 'Access Telemetry Pod', pos: tutorialState.pod.position, radius: 3.8 };
      }
    }
    // Interactive Tutorial Diagnostic Terminal (Step 8)
    if (typeof tutorialState !== 'undefined' && tutorialState.active && tutorialState.stepIndex === 7 && tutorialState.terminal) {
      const dSq = (me.x - tutorialState.terminal.pos.x) ** 2 + (me.z - tutorialState.terminal.pos.z) ** 2;
      if (dSq <= 3.8 * 3.8 && Math.abs(me.y - tutorialState.terminal.pos.y) <= 4.2) {
        return { id: 'tutorial_terminal', name: 'Access Diagnostic Terminal', pos: tutorialState.terminal.pos, radius: 3.8 };
      }
    }

    // Active Mission Objectives (highest priority, selects closest)
    active.forEach(id => {
      const o = HC.objects && HC.objects[id];
      if (o && !o.collected) {
        const dSq = (me.x - o.pos.x) ** 2 + (me.z - o.pos.z) ** 2;
        const vDiff = Math.abs(me.y - o.pos.y);
        const r = o.radius || 4.5;
        if (dSq <= r * r && vDiff <= 4.2) {
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            best = o;
          }
        }
      }
    });
    if (best) return best;

    // Optional Discovery Samples
    (HC.optionalObjects || []).forEach(o => {
      if (o && !HC.save.optional.includes(o.id)) {
        const dSq = (me.x - o.pos.x) ** 2 + (me.z - o.pos.z) ** 2;
        const vDiff = Math.abs(me.y - o.pos.y);
        const r = o.radius || 4.5;
        if (dSq <= r * r && vDiff <= 4.2 && dSq < bestDistSq) {
          bestDistSq = dSq;
          best = o;
        }
      }
    });
    if (best) return best;

    // Audio Logs
    if (HC.audioLogObjects) {
      HC.audioLogObjects.forEach(obj => {
        if (obj && obj.group && obj.group.visible) {
          const dSq = (me.x - obj.pos.x) ** 2 + (me.z - obj.pos.z) ** 2;
          const vDiff = Math.abs(me.y - obj.pos.y);
          const r = obj.radius || 3.5;
          if (dSq <= r * r && vDiff <= 4.2 && dSq < bestDistSq) {
            bestDistSq = dSq;
            best = { id: 'audiolog', name: 'Play audio log: ' + obj.log.title, log: obj.log, pos: obj.pos, radius: r, group: obj.group };
          }
        }
      });
    }
    if (best) return best;

    // Rover
    if (HC.rover && !HC.rover.driving && HC.rover.group) {
      const dSq = (me.x - HC.rover.group.position.x) ** 2 + (me.z - HC.rover.group.position.z) ** 2;
      if (dSq <= 3.8 * 3.8) {
        return { id: 'enter-rover', name: 'Enter rover', pos: HC.rover.group.position, radius: 3.8 };
      }
    }

    // Inactive Sector Mission Apparatus Check (provides active directive guidance instead of dead silence)
    if (!best && HC.objects) {
      Object.keys(HC.objects).forEach(id => {
        const o = HC.objects[id];
        if (o && !o.collected && id !== 'launch') {
          const dSq = (me.x - o.pos.x) ** 2 + (me.z - o.pos.z) ** 2;
          const vDiff = Math.abs(me.y - o.pos.y);
          const r = o.radius || 4.8;
          if (dSq <= r * r && vDiff <= 4.2 && dSq < bestDistSq) {
            bestDistSq = dSq;
            best = { ...o, isLockedDirective: true };
          }
        }
      });
    }
    return best;
  }
  function updatePrompt() {
    if (HC.state !== STATES.EXPLORATION) { show(ui.prompt, false); return; }
    const o = nearestInteractable();
    const sc = nearestScannable();
    const me = player();
    const droneNear = me && HC.drone && HC.drone.group && HC.drone.group.visible &&
      ((me.x - HC.drone.group.position.x) ** 2 + (me.z - HC.drone.group.position.z) ** 2 <= 8.0 * 8.0) &&
      (performance.now() >= HC.drone.disabledUntil);

    if (!o && !sc && !droneNear) { show(ui.prompt, false); return; }
    show(ui.prompt, true);

    const isTouch = touchModeAuthoritative || isTouchDevice;
    const parts = [];
    if (o) {
      if (o.isLockedDirective) {
        parts.push((isTouch ? 'USE — ' : 'E — ') + o.name + ' [LOCKED — SEE COMPASS]');
      } else {
        const keyPrefix = o.id === 'enter-rover' ? (isTouch ? 'ROVER — ' : 'R — ') : (isTouch ? 'USE — ' : 'E — ');
        parts.push(keyPrefix + o.name);
      }
    }
    if (droneNear) {
      parts.push((isTouch ? 'EMP — ' : 'F — ') + 'Disable Security Camera');
    }
    if (sc) {
      parts.push((isTouch ? 'SCAN — ' : 'C — ') + 'Scan ' + sc.name);
    }
    ui.prompt.textContent = parts.join('  |  ');
  }
  function interact() {
    const o = nearestInteractable(); if (!o) return;
    if (o.isLockedDirective) {
      if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_error');
      const curM = mission();
      const directiveName = curM ? curM.name : 'Sector Objectives';
      toast('ACCESS RESTRICTED: Active directive is "' + directiveName + '". Follow your HUD compass waypoint.', 5000);
      HC.navUpdatedTime = performance.now() + 4500;
      return;
    }
    if (o.id === 'tutorial_pod') {
      if (window.HomecomingAudio && typeof window.HomecomingAudio.play === 'function') {
        window.HomecomingAudio.play('pickup_salvage');
      }
      if (typeof tutorialState !== 'undefined') {
        tutorialState.podInteracted = true;
        if (tutorialState.pod && tutorialState.pod.children && tutorialState.pod.children[2]) {
          const beaconLight = tutorialState.pod.children[2];
          if (beaconLight.material) beaconLight.material.color.setHex(0x7dff8a);
        }
      }
      toast('TELEMETRY POD ARCHIVED: Surface telemetry verified (+1 salvage).');
      if (HC.save) {
        HC.save.resources.salvage += 1;
        persist();
      }
      return;
    }
    if (o.id === 'tutorial_terminal') {
      if (window.HomecomingAudio && typeof window.HomecomingAudio.play === 'function') {
        window.HomecomingAudio.play('terminal_open');
      }
      startTutorialPuzzle();
      return;
    }
    if (o.id === 'enter-rover') { tryVehicle(); return; }
    if (o.id === 'audiolog') {
      if (window.HomecomingAudio) window.HomecomingAudio.play('audiolog_play');
      o.group.visible = false;
      HC.save.audioLogs.push(o.log.id);
      HC.save.stats.optionalMissions++;
      persist();
      showLog(o.log);
      return;
    }
    if (o.optional) {
      if (window.HomecomingAudio) window.HomecomingAudio.play('pickup_salvage');
      o.collected = true; HC.save.optional.push(o.id); HC.save.resources.salvage += 1; HC.save.stats.optionalMissions++; HC.save.stats.samples++; persist('Scientific sample catalogued.'); toast('OPTIONAL DISCOVERY — sample catalogued  +1 salvage'); return;
    }
    if (o.id === 'launch') {
      if (HC.save.departureReady) { beginTravel(); return; }
      const curP = HC.save.planet || 0;
      const m = mission();
      if (!m || m.planet !== curP) {
        showHub(curP);
        toast('Returned to orbital hub. Select next destination via Journey Route.');
        return;
      }
      toast('Ascent craft is awaiting mission clearance. Complete local sector objectives first.');
      return;
    }
    if (o.id.indexOf('component') === 0) {
      if (window.HomecomingAudio) window.HomecomingAudio.play('pickup_component');
      o.collected = true; HC.save.components.push(o.id); HC.save.resources.salvage += 1; persist('Engine component secured.'); toast('Component ' + HC.save.components.length + ' of 3 secured.'); return;
    }
    if (o.id === 'outpost') {
      if (HC.drone && performance.now() < HC.drone.disabledUntil) {
        /* drone disabled, allow */
      } else if (HC.drone) {
        toast('Security drone active. Use EMP [F] before accessing the terminal.');
        return;
      }
    }
    if (o.id === 'engine' && HC.save.components.length < 3) {
      toast('ORA: recover all three engine components first (' + HC.save.components.length + '/3).');
      return;
    }
    const m = mission();
    if (m) {
      const isTarget = (m.target === o.id) || (m.target === 'components' && o.id === 'engine');
      if (isTarget) {
        if (window.HomecomingAudio) window.HomecomingAudio.play('terminal_open');
        startPuzzle(m.puzzle);
      } else {
        toast('Terminal offline or assigned to a different mission protocol.');
      }
    }
  }
  function tryVehicle() {
    if (HC.state !== STATES.EXPLORATION) return;
    if (!HC.rover.driving) {
      if (player().distanceTo(HC.rover.group.position) > 3) { toast('Move closer to the rover to enter it.'); return; }
      HC.rover.driving = true;
      HC.astronaut.group.visible = false;
      // Initialize GTA-style rover vehicle camera
      roverCamState.active = true;
      roverCamState.mode = ROVER_CAM_STATES.FOLLOW_REAR;
      roverCamState.lastInputTime = 0;
      roverCamState.turnSideBias = 1;
      if (typeof HC.mouse.yaw !== 'number' || isNaN(HC.mouse.yaw)) {
        HC.mouse.yaw = HC.rover.heading;
      }
      HC.mouse.pitch = roverCamConfig.pitchBase;
      if (window.HomecomingAudio) {
        window.HomecomingAudio.stopSuitBreathing();
        window.HomecomingAudio.startRoverEngine();
      }
      toast('Rover linked. WASD drive · Shift boost · R exit.');
      updateMobileControlsVisibility();
    } else {
      const side = new V(Math.cos(HC.rover.heading), 0, Math.sin(HC.rover.heading)); let candidate = HC.rover.group.position.clone().add(side.multiplyScalar(2));
      if (isCollision(candidate, .5)) candidate = HC.rover.group.position.clone().add(side.multiplyScalar(-2));
      if (isCollision(candidate, .5)) { toast('No safe exit position.'); return; }
      candidate.y = yAt(candidate.x, candidate.z, 0); HC.astronaut.group.position.copy(candidate); HC.astronaut.group.visible = true; HC.rover.driving = false; HC.rover.speed = 0; alignRoverTerrain(HC.rover, HC.rover.group.position.x, HC.rover.group.position.z, HC.rover.heading, true);
      // Clean up rover vehicle camera
      resetRoverCamera();
      if (window.HomecomingAudio) {
        window.HomecomingAudio.stopRoverEngine();
        window.HomecomingAudio.startSuitBreathing();
      }
      toast('Exited rover.');
      updateMobileControlsVisibility();
    }
  }
  function emp() {
    if (HC.state !== STATES.EXPLORATION || HC.rover.driving) return;
    const now = performance.now(); if (now < HC.empReady) { toast('EMP recharging.'); return; }
    HC.empReady = now + 6500;
    if (window.HomecomingAudio) window.HomecomingAudio.play('emp_blast');
    const d = HC.drone ? player().distanceTo(HC.drone.group.position) : Infinity;
    if (HC.drone && d < 13) {
      HC.drone.disabledUntil = now + 11000;
      HC.drone.alert = false;
      HC.drone.state = 'DISABLED';
      HC.drone.stateTimer = 11.0;
      if (HC.drone.laserGroup) HC.drone.laserGroup.visible = false;
      if (HC.drone.impactMesh) HC.drone.impactMesh.visible = false;
      if (HC.drone.eye && HC.drone.eye.material && HC.drone.eye.material.emissive) {
        HC.drone.eye.material.emissive.setHex(0x112833);
      }
      if (HC.drone.warningLight) HC.drone.warningLight.intensity = 0;
      if (window.HomecomingAudio) window.HomecomingAudio.play('drone_shutdown');
      toast('EMP pulse successful — security camera disabled for 11s.');
    }
    else toast('EMP pulse dissipated. No target in range.');
  }

  /* ─────────────────────────────────────────────────────────────────────
     DYNAMIC PUZZLE ENGINE & PLANET-SPECIFIC THEMES
     ───────────────────────────────────────────────────────────────────── */
  function createSeededPRNG(seed) {
    let s = (Math.abs(seed) % 2147483647) || 12345;
    return function() {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function stringToSeed(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function shuffleWithPRNG(array, prng) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    return copy;
  }

  const PLANET_PUZZLE_THEMES = {
    mars: {
      name: 'Mars Outpost',
      kicker: 'ARES OUTPOST // POWER GRID DIAGNOSTIC',
      wireTitle: 'Damaged Outpost Power Shunt',
      signalName: 'Ares Emergency UHF Beacon',
      baseFreq: 73.0,
      freqRange: [48.0, 92.0],
      wires: [['Power Main', '#ff7a3d'], ['Telemetry Line', '#65ddff'], ['Emergency Override', '#bd8aff'], ['Grounding Shunt', '#a7f36f']],
      relays: ['Main Inverter', 'Capacitor Bank', 'Bus Relay', 'Substation Shunt']
    },
    phobos: {
      name: 'Phobos Station',
      kicker: 'PHOBOS ORBITAL DOCK // SECURITY GRID',
      wireTitle: 'Docking Coupler Actuator Wiring',
      signalName: 'Autonomous Echo Transponder',
      baseFreq: 64.4,
      freqRange: [45.0, 88.0],
      wires: [['Magnetic Lock', '#4deeea'], ['Servo Actuator', '#ffe700'], ['Coupler Bus', '#74ee15'], ['Hydraulic Sensor', '#ff5252']],
      relays: ['Clamp Primary', 'Pressurization', 'Guidance Grid', 'Airlock Relay']
    },
    europa: {
      name: 'Europa Sub-Ice Lab',
      kicker: 'EUROPA RESEARCH BASE // CRYO-CONDUIT',
      wireTitle: 'Sub-Ice Thermal Relay Wiring',
      signalName: 'Sub-Ice Hydroacoustic Transceiver',
      baseFreq: 58.2,
      freqRange: [42.0, 85.0],
      wires: [['Cryo-Coolant', '#65ddff'], ['Superconducting Core', '#a7f36f'], ['Thermal Resistor', '#ffd24d'], ['Plasma Stabilizer', '#f06292']],
      relays: ['Thermal Heater', 'Brine Pump', 'Sonar Hydrophone', 'Containment Grid']
    },
    titan: {
      name: 'Titan Methane Refinery',
      kicker: 'TITAN REFINERY // INDUSTRIAL AUTOMATION',
      wireTitle: 'Methane Manifold Control Wiring',
      signalName: 'Atmospheric Penetration Carrier',
      baseFreq: 84.6,
      freqRange: [55.0, 105.0],
      wires: [['Methane Pump', '#00e5ff'], ['Tholin Filter', '#ffaa22'], ['Nitrogen Purge', '#b0bec5'], ['Pressure Valve', '#76ff03']],
      relays: ['Manifold Valve', 'Turbine Compressor', 'Separator Column', 'Flare Igniter']
    },
    ceres: {
      name: 'Ceres Derelict Convoy',
      kicker: 'CERES ASTRAEA CONVOY // DERELICT SALVAGE',
      wireTitle: 'Derelict Ship Power Bus',
      signalName: 'Deep-Space Echo Network',
      baseFreq: 77.8,
      freqRange: [50.0, 100.0],
      wires: [['Astraea Primary', '#ffd700'], ['Nav Computer', '#00e5ff'], ['Sub-Space Comm', '#e040fb'], ['Emergency Cells', '#76ff03'], ['Shield Coil', '#ff6e40']],
      relays: ['Echo Beacon', 'Storage Capacitor', 'Relict Fusion Cell', 'Transponder Node']
    },
    earth: {
      name: 'Mission Control Genesis',
      kicker: 'EARTH MISSION CONTROL // RE-ENTRY TELEMETRY',
      wireTitle: 'Ablative Heat Shield Diagnostic Bus',
      signalName: 'The Genesis Master Carrier Beacon',
      baseFreq: 92.4,
      freqRange: [60.0, 108.0],
      wires: [['Ablative Sensor', '#ff5722'], ['Guidance Telemetry', '#00e5ff'], ['Avionics Bus', '#b388ff'], ['Reaction Thruster', '#ffeb3b'], ['Thermal Matrix', '#00e676']],
      relays: ['Retro-Thruster', 'Guidance Computer', 'Parachute Drogue', 'Beacon Uplink']
    }
  };

  function getPuzzleConfig(type, missionId, planetId) {
    if (!HC.save) return generatePuzzleConfig(type, planetId || 'mars', 12345, missionId || 'default');
    if (!HC.save.puzzleConfigs) HC.save.puzzleConfigs = {};
    const key = (missionId || type) + '_' + (planetId || activePlanetId());
    if (HC.save.puzzleConfigs[key]) {
      const savedCfg = HC.save.puzzleConfigs[key];
      if (type === 'circuit' && savedCfg && Array.isArray(savedCfg.pieces)) {
        const hasUpperBug = savedCfg.pieces.some(p => p.x === 0 && p.y === 1 && p.type === 'elbow' && p.target === 0);
        const hasCentralBug = savedCfg.pieces.some(p => p.x === 1 && p.y === 1 && p.type === 'elbow' && p.target === 2);
        const hasCenterWaveBug = savedCfg.pieces.some(p => p.x === 1 && p.y === 1 && p.type === 'elbow' && p.target === 0);
        if (hasUpperBug || hasCentralBug || hasCenterWaveBug) {
          delete HC.save.puzzleConfigs[key];
        } else {
          return savedCfg;
        }
      } else {
        return savedCfg;
      }
    }
    const seed = stringToSeed(key + '_' + (HC.save.seed || 101));
    const cfg = generatePuzzleConfig(type, planetId || activePlanetId(), seed, missionId);
    HC.save.puzzleConfigs[key] = cfg;
    persist();
    return cfg;
  }

  function generatePuzzleConfig(type, planetId, seed, missionId) {
    const prng = createSeededPRNG(seed);
    const pKey = (planetId || 'mars').toLowerCase();
    const theme = PLANET_PUZZLE_THEMES[pKey] || PLANET_PUZZLE_THEMES.mars;

    switch (type) {
      case 'wiring': {
        const wires = theme.wires.slice();
        let sockets = [2, 0, 3, 1];
        if (wires.length === 4) {
          if (missionId !== 'wake') {
            const perms = [
              [1, 3, 0, 2],
              [3, 0, 1, 2],
              [2, 3, 1, 0],
              [1, 2, 3, 0],
              [3, 2, 0, 1],
              [2, 0, 3, 1]
            ];
            sockets = perms[Math.floor(prng() * perms.length)];
          }
        } else if (wires.length === 5) {
          sockets = [3, 0, 4, 1, 2];
        }
        return {
          type: 'wiring',
          wires,
          sockets,
          title: theme.wireTitle,
          help: 'Select a wire, then select its matching socket. Every circuit must be connected.'
        };
      }

      case 'signal': {
        let target = theme.baseFreq;
        if (missionId === 'signal') {
          target = 73.0;
        } else {
          const min = theme.freqRange[0];
          const max = theme.freqRange[1];
          target = Math.round((min + 6.0 + prng() * (max - min - 12.0)) * 10) / 10;
        }
        const tolerance = (pKey === 'earth') ? 0.8 : 1.0;
        return {
          type: 'signal',
          target,
          min: theme.freqRange[0],
          max: theme.freqRange[1],
          tolerance,
          name: theme.signalName,
          help: 'Match the incoming waveform at ' + target.toFixed(1) + ' MHz, then lock the carrier.'
        };
      }

      case 'code': {
        let clue, answer;
        if (missionId === 'black-box') {
          clue = 'Black box lock: "Mission number (12), crew section (B=02), emergency code (88)."';
          answer = '120288';
        } else if (missionId === 'specimen-09') {
          clue = 'Lab access: "Specimen number (09), discovery year (31), researcher ID (07)."';
          answer = '093107';
        } else if (missionId === 'silent-cargo') {
          clue = 'Cargo lock: "Docking bay (04), container tier (18), authorization index (55)."'
          answer = '041855';
        } else {
          clue = 'Diagnostic clue: "The code is the launch day (07), crew count (03), and red-sun index (04), in that order."';
          answer = '070304';
        }
        return {
          type: 'code',
          clue,
          answer
        };
      }

      case 'circuit': {
        const pathways = [
          // Path 0: Classic bottom-shelf (canonical)
          {
            hint: 'SOURCE → enter left-middle, exit right-bottom',
            pieces: [
              { x: 0, y: 1, type: 'elbow', target: 1 },
              { x: 0, y: 2, type: 'elbow', target: 3 },
              { x: 1, y: 2, type: 'line', target: 0 },
              { x: 2, y: 2, type: 'line', target: 0 }
            ]
          },
          // Path 1: Central step
          {
            hint: 'SOURCE → route through central nexus to engine output',
            pieces: [
              { x: 0, y: 1, type: 'line', target: 0 },
              { x: 1, y: 1, type: 'elbow', target: 1 },
              { x: 1, y: 2, type: 'elbow', target: 3 },
              { x: 2, y: 2, type: 'line', target: 0 }
            ]
          },
          // Path 2: Upper bypass
          {
            hint: 'SOURCE → route across upper bypass to power capacitor',
            pieces: [
              { x: 0, y: 1, type: 'elbow', target: 2 },
              { x: 0, y: 0, type: 'elbow', target: 0 },
              { x: 1, y: 0, type: 'line', target: 0 },
              { x: 2, y: 0, type: 'elbow', target: 1 },
              { x: 2, y: 1, type: 'line', target: 1 },
              { x: 2, y: 2, type: 'elbow', target: 3 }
            ]
          },
          // Path 3: Center-wave
          {
            hint: 'SOURCE → route straight through mid-conduit to output coupler',
            pieces: [
              { x: 0, y: 1, type: 'line', target: 0 },
              { x: 1, y: 1, type: 'line', target: 0 },
              { x: 2, y: 1, type: 'elbow', target: 1 },
              { x: 2, y: 2, type: 'elbow', target: 3 }
            ]
          }
        ];
        const pathIdx = (missionId === 'shipbreaker') ? 0 : Math.floor(prng() * pathways.length);
        const sel = pathways[pathIdx];
        const pieces = sel.pieces.map(p => ({
          ...p,
          initialR: (p.target + 1 + Math.floor(prng() * 3)) % 4
        }));
        return {
          type: 'circuit',
          hint: sel.hint,
          pieces
        };
      }

      case 'sequence': {
        let seq = [2, 0, 3, 1, 2];
        if (missionId !== 'departure') {
          const len = (pKey === 'phobos' || pKey === 'mars') ? 4 : 5;
          seq = [];
          for (let i = 0; i < len; i++) {
            let nextBtn = Math.floor(prng() * 4);
            if (i > 1 && nextBtn === seq[i - 1] && nextBtn === seq[i - 2]) {
              nextBtn = (nextBtn + 1) % 4;
            }
            seq.push(nextBtn);
          }
        }
        return {
          type: 'sequence',
          seq,
          help: 'Watch the diagnostic pattern, then repeat it. Input remains locked while ORA transmits.'
        };
      }

      case 'pattern': {
        const patterns = [
          {
            question: 'The scan repeats TRIANGLE, CIRCLE, SQUARE. Choose the missing fourth symbol.',
            answer: 'Triangle',
            distractors: ['Circle', 'Square', 'Hexagon'],
            help: 'Inspect the repeating triplet sequence.'
          },
          {
            question: 'Diagnostic cycle: TRIANGLE (3), SQUARE (4), PENTAGON (5). Choose the next vertex order.',
            answer: 'Hexagon',
            distractors: ['Heptagon', 'Octagon', 'Square'],
            help: 'Detect the vertex progression rule.'
          },
          {
            question: 'Harmonic resonance: 220 Hz, 440 Hz, 880 Hz. Choose the next octave frequency.',
            answer: '1760 Hz',
            distractors: ['1320 Hz', '1100 Hz', '3520 Hz'],
            help: 'Calculate the harmonic frequency octave.'
          },
          {
            question: 'Telemetry channels: ALPHA, BETA, GAMMA. Choose the subsequent channel.',
            answer: 'Delta',
            distractors: ['Epsilon', 'Zeta', 'Omega'],
            help: 'Follow the Greek astronomical sequence.'
          }
        ];
        const pIdx = (missionId === 'white-silence') ? 0 : Math.floor(prng() * patterns.length);
        const curP = patterns[pIdx];
        const allOpts = [curP.answer, ...curP.distractors];
        const shuffled = shuffleWithPRNG(allOpts, prng);
        return {
          type: 'pattern',
          question: curP.question,
          options: shuffled,
          correctIndex: shuffled.indexOf(curP.answer),
          answer: curP.answer
        };
      }

      case 'routing': {
        let target = [1, 3, 0, 2];
        let labels = ['1', '2', '3', '4'];
        let help = 'Trace power from lowest to highest relay number: 2 → 4 → 1 → 3.';

        if (missionId !== 'dead-dock') {
          const perms = [
            { target: [0, 2, 3, 1], seq: ['1', '3', '4', '2'] },
            { target: [2, 0, 1, 3], seq: ['3', '1', '2', '4'] },
            { target: [3, 1, 0, 2], seq: ['4', '2', '1', '3'] },
            { target: [1, 3, 0, 2], seq: ['2', '4', '1', '3'] }
          ];
          const choice = perms[Math.floor(prng() * perms.length)];
          target = choice.target;
          help = 'Trace power from lowest to highest relay: ' + choice.seq.join(' → ') + '.';
        }

        return {
          type: 'routing',
          target,
          labels,
          help
        };
      }

      case 'evidence': {
        let question, answers, correctIndex;
        if (missionId === 'missing-miners') {
          question = 'Mining crew log: "Seismic event at 0300. Equipment showed no tectonic origin. The miners left a single boot behind." What caused the evacuation?';
          answers = ['Tectonic earthquake', 'Equipment malfunction', 'Unknown subsurface event', 'Atmospheric pressure drop'];
          correctIndex = 2;
        } else if (missionId === 'broken-coordinates') {
          question = 'Station log: "All outbound coordinates converge on the same destination. Navigation error or deliberate routing?" Which explanation fits the relay data?';
          answers = ['Random navigation error', 'Deliberate signal routing', 'Sensor calibration drift', 'Solar interference'];
          correctIndex = 1;
        } else if (missionId === 'signal-end') {
          question = 'Final analysis: "The signal predates the expedition by seven years. Its encoding matches ORA\'s architecture. Its source is on Earth." What conclusion follows?';
          answers = ['The signal is a natural phenomenon', 'The signal was sent by the expedition retrospectively', 'Someone designed ORA to follow the signal', 'The signal is extraterrestrial in origin'];
          correctIndex = 2;
        } else {
          question = 'Outpost log: "The drone followed the blue maintenance route. The emergency crew never used the blue route." Which record was falsified?';
          answers = ['Emergency beacon', 'Drone patrol log', 'Oxygen manifest', 'Launch weather'];
          correctIndex = 1;
        }
        return {
          type: 'evidence',
          question,
          answers,
          correctIndex
        };
      }

      default:
        return { type };
    }
  }

  function startPuzzle(type) {
    if (HC.state !== STATES.EXPLORATION) return;
    HC.state = STATES.PUZZLE;
    sdkGameplayStop();
    setMobileControlsVisible(false);

    const m = mission();
    const pId = activePlanetId();
    const mId = m ? m.id : (HC.puzzle && HC.puzzle.isTutorial ? 'tutorial-' + type : 'default');
    const cfg = getPuzzleConfig(type, mId, pId);

    HC.puzzle = { type, solved: false, config: cfg, missionId: mId, planetId: pId };
    show(ui.puzzle, true);
    ui.puzzleBoard.innerHTML = '';
    ui.puzzleError.textContent = '';
    try { document.exitPointerLock(); } catch (_) { }

    if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_start');

    const theme = PLANET_PUZZLE_THEMES[pId] || PLANET_PUZZLE_THEMES.mars;
    const title = {
      wiring: theme.wireTitle.toUpperCase(),
      signal: theme.signalName.toUpperCase(),
      evidence: 'EVIDENCE DEDUCTION',
      circuit: 'CIRCUIT ROUTING',
      sequence: 'LAUNCH DIAGNOSTIC',
      pattern: 'PATTERN RECOGNITION',
      code: 'ACCESS CODE',
      routing: 'POWER ROUTING'
    };
    ui.puzzleTitle.textContent = title[type] || 'FIELD DIAGNOSTIC';
    const render = { wiring: puzzleWiring, signal: puzzleSignal, evidence: puzzleEvidence, circuit: puzzleCircuit, sequence: puzzleSequence, pattern: puzzlePattern, code: puzzleCode, routing: puzzleRouting }[type];
    if (typeof render === 'function') render();
  }
  function puzzleFail(text) {
    ui.puzzleError.textContent = text || 'Connection rejected. Try again.';
    if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_error');
  }
  function startTutorialPuzzle() {
    startPuzzle('wiring');
    if (HC.puzzle) HC.puzzle.isTutorial = true;
  }

  function puzzleSuccess() {
    if (!HC.puzzle || HC.puzzle.solved) return;
    HC.puzzle.solved = true;
    if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_complete');
    show(ui.puzzle, false);
    HC.state = STATES.EXPLORATION;
    sdkGameplayStart();
    setMobileControlsVisible(true);
    if (HC.puzzle.isTutorial) {
      if (typeof tutorialState !== 'undefined') tutorialState.puzzleSolved = true;
      toast('Diagnostic circuit validated.');
      return;
    }
    completeMission();
  }
  function cancelPuzzle() {
    if (HC.state !== STATES.PUZZLE) return;
    HC.puzzle = null;
    show(ui.puzzle, false);
    HC.state = STATES.EXPLORATION;
    sdkGameplayStart();
    setMobileControlsVisible(true);
    toast('Diagnostic cancelled.');
  }

  function puzzleWiring() {
    const m = mission();
    const pId = activePlanetId();
    const mId = m ? m.id : (HC.puzzle && HC.puzzle.isTutorial ? 'tutorial-wiring' : 'wake');
    const cfg = getPuzzleConfig('wiring', mId, pId);

    ui.puzzleHelp.textContent = cfg.help || 'Select a wire, then select its matching socket. Every circuit must be connected.';
    const colors = cfg.wires;
    let selected = null;
    const done = new Set();
    const left = document.createElement('div');
    const right = document.createElement('div');
    left.className = right.className = 'hc-wire-col';

    colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'hc-wire-row';
      b.innerHTML = `<span class="hc-wire-dot" style="color:${c[1]};background:${c[1]}"></span><span>${c[0]}</span><span class="hc-wire-line" style="color:${c[1]}"></span>`;
      b.onclick = () => {
        if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_click');
        selected = i;
        [...left.children].forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
      };
      left.appendChild(b);
    });

    cfg.sockets.forEach(i => {
      const b = document.createElement('button');
      b.textContent = colors[i][0] + ' socket';
      b.style.borderColor = colors[i][1];
      b.onclick = () => {
        if (selected === null) return puzzleFail('Select a wire first.');
        if (selected !== i) return puzzleFail('That socket has a different frequency.');
        if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_click');
        done.add(i);
        left.children[i].classList.add('done');
        b.disabled = true;
        b.textContent = 'CONNECTED';
        selected = null;
        if (done.size === colors.length) puzzleSuccess();
      };
      right.appendChild(b);
    });

    ui.puzzleBoard.append(left, right);
  }

  function puzzleSignal() {
    const m = mission();
    const pId = activePlanetId();
    const mId = m ? m.id : 'signal';
    const cfg = getPuzzleConfig('signal', mId, pId);
    const target = cfg.target;

    ui.puzzleHelp.textContent = cfg.help || ('Match the incoming waveform at ' + target.toFixed(1) + ' MHz, then lock the carrier.');
    const freq = document.createElement('div');
    const slider = document.createElement('input');
    const button = document.createElement('button');

    freq.className = 'hc-frequency';
    slider.type = 'range';
    slider.className = 'hc-signal';
    slider.min = cfg.min;
    slider.max = cfg.max;
    slider.step = '0.1';
    slider.value = String(cfg.min + 2.0);
    button.textContent = 'Lock signal';
    button.className = 'btn';

    const update = () => {
      const v = +slider.value;
      freq.textContent = v.toFixed(1) + ' MHz';
      freq.style.color = Math.abs(v - target) < 2 ? '#a8f7ff' : '#ffb18b';
    };
    slider.oninput = update;
    button.onclick = () => {
      if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_click');
      Math.abs(+slider.value - target) <= (cfg.tolerance || 1.0) ? puzzleSuccess() : puzzleFail('Carrier mismatch. Use the waveform readout to tune closer.');
    };
    update();
    ui.puzzleBoard.append(freq, slider, button);
  }

  function puzzleEvidence() {
    const m = mission();
    const pId = activePlanetId();
    const mId = m ? m.id : 'ghosts';
    const cfg = getPuzzleConfig('evidence', mId, pId);

    ui.puzzleHelp.textContent = cfg.question;
    const box = document.createElement('div');
    box.className = 'hc-options';
    cfg.answers.forEach((a, i) => {
      const b = document.createElement('button');
      b.textContent = a;
      b.onclick = () => {
        if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_click');
        i === cfg.correctIndex ? puzzleSuccess() : puzzleFail('That conclusion does not follow from the evidence.');
      };
      box.appendChild(b);
    });
    ui.puzzleBoard.appendChild(box);
  }

  function getCircuitTileConnections(type, r) {
    const rot = ((r % 4) + 4) % 4;
    if (type === 'line') {
      return (rot % 2 === 0) ? ['W', 'E'] : ['N', 'S'];
    }
    if (type === 'elbow') {
      if (rot === 0) return ['E', 'S'];
      if (rot === 1) return ['S', 'W'];
      if (rot === 2) return ['W', 'N'];
      if (rot === 3) return ['N', 'E'];
    }
    return [];
  }

  function isCircuitConnected(tiles) {
    const tileMap = new Map();
    for (const t of tiles) {
      const r = +t.el.dataset.r;
      tileMap.set(`${t.spec.x},${t.spec.y}`, {
        x: t.spec.x,
        y: t.spec.y,
        type: t.spec.type,
        connections: getCircuitTileConnections(t.spec.type, r)
      });
    }

    const startTile = tileMap.get('0,1');
    if (!startTile || !startTile.connections.includes('W')) {
      return false;
    }

    const endTile = tileMap.get('2,2');
    if (!endTile || !endTile.connections.includes('E')) {
      return false;
    }

    const visited = new Set(['0,1']);
    const queue = [{ x: 0, y: 1 }];

    const opposites = {
      N: { opp: 'S', dx: 0, dy: -1 },
      S: { opp: 'N', dx: 0, dy: 1 },
      E: { opp: 'W', dx: 1, dy: 0 },
      W: { opp: 'E', dx: -1, dy: 0 }
    };

    while (queue.length > 0) {
      const curr = queue.shift();
      if (curr.x === 2 && curr.y === 2) {
        return true;
      }
      const currentTile = tileMap.get(`${curr.x},${curr.y}`);
      if (!currentTile) continue;

      for (const dir of currentTile.connections) {
        const step = opposites[dir];
        if (!step) continue;
        const nx = curr.x + step.dx;
        const ny = curr.y + step.dy;
        const nKey = `${nx},${ny}`;

        if (visited.has(nKey)) continue;

        const neighbor = tileMap.get(nKey);
        if (neighbor && neighbor.connections.includes(step.opp)) {
          visited.add(nKey);
          queue.push({ x: nx, y: ny });
        }
      }
    }

    return false;
  }

  function puzzleCircuit() {
    const m = mission();
    const pId = activePlanetId();
    const mId = m ? m.id : 'shipbreaker';
    const cfg = getPuzzleConfig('circuit', mId, pId);

    ui.puzzleHelp.textContent = 'Rotate each active circuit tile to route current from SOURCE to the engine destination.';
    const grid = document.createElement('div');
    grid.className = 'hc-circuit';
    const tiles = [];

    function checkCircuitSuccess() {
      const matchesTargets = tiles.every(t => {
        const r = +t.el.dataset.r;
        return (t.spec.type === 'line') ? (r % 2 === t.spec.target % 2) : (r === t.spec.target);
      });
      return matchesTargets || isCircuitConnected(tiles);
    }

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const spec = cfg.pieces.find(p => p.x === x && p.y === y);
        const b = document.createElement('button');
        if (spec) {
          b.className = 'hc-tile ' + spec.type;
          b.dataset.r = String(spec.initialR != null ? spec.initialR : ((spec.target + 1) % 4));
          b.onclick = () => {
            if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_click');
            b.dataset.r = String((+b.dataset.r + 1) % 4);
            if (checkCircuitSuccess()) {
              puzzleSuccess();
            }
          };
          tiles.push({ el: b, spec });
        } else {
          b.className = 'hc-tile';
          b.disabled = true;
        }
        grid.appendChild(b);
      }
    }
    ui.puzzleBoard.append(grid);
    const hint = document.createElement('div');
    hint.className = 'hc-source';
    hint.textContent = cfg.hint || 'SOURCE → enter left-middle, exit right-bottom';
    ui.puzzleBoard.append(hint);
  }

  function puzzleSequence() {
    const m = mission();
    const pId = activePlanetId();
    const mId = m ? m.id : 'departure';
    const cfg = getPuzzleConfig('sequence', mId, pId);
    const seq = cfg.seq;

    ui.puzzleHelp.textContent = cfg.help || 'Watch the diagnostic pattern, then repeat it. Input remains locked while ORA transmits.';
    const holder = document.createElement('div');
    holder.className = 'hc-seq';
    const buttons = [];
    let unlocked = false;
    let input = [];

    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.textContent = String(i + 1);
      b.disabled = true;
      b.onclick = () => {
        if (!unlocked) return;
        if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_click');
        input.push(i);
        if (i !== seq[input.length - 1]) {
          input = [];
          puzzleFail('Sequence error. ORA will replay the diagnostic.');
          play();
          return;
        }
        if (input.length === seq.length) puzzleSuccess();
      };
      buttons.push(b);
      holder.appendChild(b);
    }
    ui.puzzleBoard.append(holder);

    function play() {
      unlocked = false;
      buttons.forEach(b => b.disabled = true);
      seq.forEach((n, index) => {
        setTimeout(() => {
          buttons[n].classList.add('flash');
          setTimeout(() => buttons[n].classList.remove('flash'), 330);
          if (index === seq.length - 1) {
            setTimeout(() => {
              unlocked = true;
              buttons.forEach(b => b.disabled = false);
            }, 560);
          }
        }, 450 + index * 700);
      });
    }
    play();
  }

  function puzzlePattern() {
    const m = mission();
    const pId = activePlanetId();
    const mId = m ? m.id : 'white-silence';
    const cfg = getPuzzleConfig('pattern', mId, pId);

    ui.puzzleHelp.textContent = cfg.question;
    const box = document.createElement('div');
    box.className = 'hc-options';
    cfg.options.forEach((optText, i) => {
      const b = document.createElement('button');
      b.textContent = optText;
      b.onclick = () => {
        if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_click');
        i === cfg.correctIndex ? puzzleSuccess() : puzzleFail('Pattern discontinuity. Inspect the repeating triplet.');
      };
      box.append(b);
    });
    ui.puzzleBoard.append(box);
  }

  function puzzleCode() {
    const m = mission();
    const pId = activePlanetId();
    const mId = m ? m.id : 'silent-cargo';
    const cfg = getPuzzleConfig('code', mId, pId);

    ui.puzzleHelp.textContent = cfg.clue;
    const box = document.createElement('div');
    box.className = 'hc-code';
    const input = document.createElement('input');
    const b = document.createElement('button');
    input.placeholder = '000000';
    input.maxLength = 6;
    b.textContent = 'Submit';
    b.className = 'btn';
    b.onclick = () => {
      if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_click');
      input.value === cfg.answer ? puzzleSuccess() : puzzleFail('Incorrect code. Combine all diagnostic values in order.');
    };
    box.append(input, b);
    ui.puzzleBoard.append(box);
  }

  function puzzleRouting() {
    const m = mission();
    const pId = activePlanetId();
    const mId = m ? m.id : 'dead-dock';
    const cfg = getPuzzleConfig('routing', mId, pId);
    const target = cfg.target;
    const input = [];

    ui.puzzleHelp.textContent = cfg.help;
    const box = document.createElement('div');
    box.className = 'hc-seq';
    cfg.labels.forEach((n, i) => {
      const b = document.createElement('button');
      b.textContent = n;
      b.onclick = () => {
        if (window.HomecomingAudio) window.HomecomingAudio.play('puzzle_click');
        input.push(i);
        if (i !== target[input.length - 1]) {
          input.length = 0;
          puzzleFail('Power spike detected. Start the relay sequence again.');
        } else if (input.length === target.length) {
          puzzleSuccess();
        }
      };
      box.append(b);
    });
    ui.puzzleBoard.append(box);
  }

  /* ─────────────────────────────────────────────────────────────────────
     MISSION COMPLETION & CAMPAIGN PROGRESSION
     ───────────────────────────────────────────────────────────────────── */
  function completeMission() {
    const m = mission();
    if (!m || m.planet !== HC.save.planet) return;

    // Idempotent progression check: only award resources and increment counter once
    if (!HC.save.completed.includes(m.id)) {
      HC.save.completed.push(m.id);
      HC.save.resources.credits += m.reward.credits;
      HC.save.resources.salvage += m.reward.salvage;
      HC.save.stats.mainMissions++;
    }

    // Advance mission index past all completed missions
    while (HC.save.mission < MISSIONS.length && HC.save.completed.includes(MISSIONS[HC.save.mission].id)) {
      HC.save.mission++;
    }

    if (m.target && HC.objects[m.target]) HC.objects[m.target].collected = true;
    persist(m.name + ' complete.');
    if (window.HomecomingAudio) window.HomecomingAudio.play('mission_complete');
    toast('MISSION COMPLETE — ' + m.name + '  +' + m.reward.credits + ' credits', 4400);

    const next = mission();
    // Campaign complete — show ending
    if (!next) {
      // Show the Earth ending sequence
      setTimeout(() => showFinalEnding(), 1500);
      return;
    }
    // Next mission is on a different planet — departure needed
    if (next.planet !== HC.save.planet) {
      HC.save.departureReady = true;
      if (!HC.save.unlocked.includes(PLANETS[next.planet].name)) {
        HC.save.unlocked.push(PLANETS[next.planet].name);
      }
      persist();
      showDeparture(next);
      return;
    }
    // Next mission is on the same planet: play ORA dialogue once with proper duration
    const oraDuration = Math.max(4500, Math.min(8500, (next.ora || '').length * 70));
    setTimeout(() => {
      if (!HC.spokenMissions) HC.spokenMissions = new Set();
      HC.spokenMissions.add(next.id);
      toast('ORA: ' + next.ora, oraDuration, ORA_PRIORITY.MISSION);
    }, 800);
  }

  function showDeparture(next) {
    if (window.HomecomingAudio) window.HomecomingAudio.play('mission_update');
    show(ui.hud, true);
    show(ui.chapter, true);
    try { document.exitPointerLock(); } catch (_) { }
    const cp = currentPlanet();
    const np = PLANETS[next.planet];
    ui.chapterKicker.textContent = cp.chapter + ' · ' + cp.name + ' COMPLETE';
    ui.chapterHeading.textContent = 'DEPART FOR ' + np.name.toUpperCase();
    const oraLine = ORA_LINES.travel[cp.id + '-' + np.id] || 'Plotting course.';
    ui.chapterText.innerHTML = cp.name + ' is secure. Your next destination is <strong>' + np.name + '</strong>.<br><br>Drive or walk to the marked ascent craft, then interact [E] to begin the interplanetary journey.<br><br><em>ORA: ' + oraLine + '</em>';
    if (window.HomecomingAudio) window.HomecomingAudio.speak(cp.name + ' is secure. Your next destination is ' + np.name + '. ' + oraLine, 'ora');
  }

  /* ─────────────────────────────────────────────────────────────────────
     FINAL ENDING — Earth chapter completion with cliffhanger
     ───────────────────────────────────────────────────────────────────── */
  function showFinalEnding() {
    HC.state = STATES.ENDING;
    show(ui.hud, false);
    show(ui.chapter, false);
    try { document.exitPointerLock(); } catch (_) { }
    if (window.HomecomingAudio) {
      window.HomecomingAudio.stopSuitBreathing();
      window.HomecomingAudio.stopRoverEngine();
      window.HomecomingAudio.stopDrone();
    }

    // Show the ending dialogue sequence first
    showDialogueSequence('ORA // FINAL TRANSMISSION', ORA_LINES.ending, () => {
      // After dialogue, show the ending screen
      show(ui.ending, true);
      HC.state = STATES.ENDING;
      if (window.HomecomingAudio) window.HomecomingAudio.play('mission_complete');

      const s = HC.save.stats;
      const pct = Math.round((s.mainMissions / MISSIONS.length) * 100);
      const totalLogs = HC.save.audioLogs ? HC.save.audioLogs.length : 0;

      HC.save.postGameUnlocked = true;
      persist();
      ui.endingHeading.textContent = 'END OF CHAPTER ONE';
      ui.endingCopy.innerHTML =
        '<strong style="font-size:clamp(20px,3vw,32px);font-family:Cormorant Garamond,Georgia,serif;display:block;margin-bottom:16px">PROJECT HOMEcoming</strong>' +
        '<span style="display:block;margin-bottom:20px;color:#8fe7ff;font-size:10px;letter-spacing:.25em">THE SIGNAL ISN\'T OVER</span>' +
        'Earth landing confirmed. The crew\'s data is recovered.<br>' +
        'But the signal remains. Its origin changes everything.<br><br>' +
        '<span style="font-size:10px;letter-spacing:.15em;color:#d9a98f">' +
        'Planets visited: ' + s.planetsVisited.length + ' / ' + PLANETS.length + '<br>' +
        'Main missions: ' + s.mainMissions + ' / ' + MISSIONS.length + '<br>' +
        'Optional discoveries: ' + s.optionalMissions + '<br>' +
        'Audio logs recovered: ' + totalLogs + '<br>' +
        'Scientific samples: ' + s.samples + '<br>' +
        'Exploration time: ' + Math.floor(s.explorationSeconds / 60) + ' min<br>' +
        'Campaign completion: ' + pct + '%</span>';
      persist();
    });
  }

  function showEnding() {
    // Legacy ending path (shouldn't normally be reached with new mission structure)
    showFinalEnding();
  }

  /* ─────────────────────────────────────────────────────────────────────
     ASTRONAUT UPDATE — now with jumping
     ───────────────────────────────────────────────────────────────────── */
  function updateAstronaut(dt) {
    const phys = getActivePhysics();
    const a = HC.astronaut;
    const isShift = HC.keys.has('ShiftLeft') || HC.keys.has('ShiftRight') || touchState.running;
    const baseSpeed = isShift ? 8.3 : 4.3;
    const speed = baseSpeed * phys.speedMult;

    // Anti-Stuck: Ensure astronaut never remains trapped inside an obstacle solid
    if (HC.solids && HC.solids.length && !HC.rover.driving) {
      for (let i = 0; i < HC.solids.length; i++) {
        const s = HC.solids[i];
        const minDist = s.r + 0.48;
        const dx = a.group.position.x - s.x;
        const dz = a.group.position.z - s.z;
        const dist = Math.hypot(dx, dz);
        if (dist < minDist) {
          if (dist > 0.001) {
            a.group.position.x = s.x + (dx / dist) * minDist;
            a.group.position.z = s.z + (dz / dist) * minDist;
          } else {
            a.group.position.x += minDist;
          }
        }
      }
    }

    let dx = 0, dz = 0;
    if (HC.keys.has('KeyW')) dz -= 1;
    if (HC.keys.has('KeyS')) dz += 1;
    if (HC.keys.has('KeyA')) dx -= 1;
    if (HC.keys.has('KeyD')) dx += 1;

    // Mobile Virtual Joystick input
    if (touchState.joystickX !== 0 || touchState.joystickZ !== 0) {
      dx += touchState.joystickX;
      dz += touchState.joystickZ;
    }

    const len = Math.hypot(dx, dz);
    let moving = false;
    if (len > 0.05) {
      const ndx = dx / (len > 1 ? len : 1);
      const ndz = dz / (len > 1 ? len : 1);
      const f = new V(-Math.sin(HC.mouse.yaw), 0, -Math.cos(HC.mouse.yaw));
      const r = new V(Math.cos(HC.mouse.yaw), 0, -Math.sin(HC.mouse.yaw));
      const dir = f.multiplyScalar(-ndz).add(r.multiplyScalar(ndx));

      // Air control factor: if jumping, direction response is governed by phys.airControl
      const effectiveSpeed = HC.isJumping ? speed * phys.airControl : speed;
      let nextX = a.group.position.x + dir.x * effectiveSpeed * dt;
      let nextZ = a.group.position.z + dir.z * effectiveSpeed * dt;

      // Kinematic obstacle resolution with tangential sliding
      if (HC.solids && HC.solids.length) {
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < HC.solids.length; i++) {
            const s = HC.solids[i];
            const minDist = s.r + 0.45;
            const dx = nextX - s.x;
            const dz = nextZ - s.z;
            const dist = Math.hypot(dx, dz);
            if (dist < minDist) {
              if (dist > 0.001) {
                nextX = s.x + (dx / dist) * minDist;
                nextZ = s.z + (dz / dist) * minDist;
              } else {
                nextX += minDist;
              }
            }
          }
        }
      }

      nextX = clamp(nextX, -86, 86);
      nextZ = clamp(nextZ, -86, 86);

      // Low-friction surface traction (e.g. Europa ice shelf sliding)
      if (phys.traction < 1.0 && !HC.isJumping) {
        a.group.position.x = a.group.position.x * (1 - phys.traction) + nextX * phys.traction;
        a.group.position.z = a.group.position.z * (1 - phys.traction) + nextZ * phys.traction;
      } else {
        a.group.position.x = nextX;
        a.group.position.z = nextZ;
      }
      const target = Math.atan2(-dir.x, -dir.z);
      a.group.rotation.y = angleLerp(a.group.rotation.y, target, clamp(dt * 10, 0, 1));
      moving = true;
    }

    a.moving += ((moving ? 1 : 0) - a.moving) * clamp(dt * 10, 0, 1);
    a.phase += dt * (moving ? speed * 2 : 1.25);
    const swing = Math.sin(a.phase) * 0.72 * a.moving;
    a.legs[0].rotation.x = swing;
    a.legs[1].rotation.x = -swing;
    a.arms[0].rotation.x = -swing * 0.72;
    a.arms[1].rotation.x = swing * 0.72;

    // Footsteps
    if (moving && !HC.rover.driving && !HC.isJumping) {
      a.stepTimer = (a.stepTimer || 0) + dt;
      const isRunning = isShift;
      const stepInterval = isRunning ? 0.28 : 0.44;
      if (a.stepTimer >= stepInterval) {
        a.stepTimer = 0;
        if (window.HomecomingAudio) {
          const cp = currentPlanet();
          window.HomecomingAudio.playFootstep(cp ? cp.id : 'mars', isRunning);
        }
        // Emit subtle footstep dust puff at astronaut foot level
        if (typeof emitDustPuff === 'function') {
          const footX = a.group.position.x + (Math.random() - 0.5) * 0.25;
          const footZ = a.group.position.z + (Math.random() - 0.5) * 0.25;
          const footY = terrainHeight(footX, footZ) + 0.04;
          emitDustPuff(new V(footX, footY, footZ), new V((Math.random() - 0.5) * 0.4, 0.45, (Math.random() - 0.5) * 0.4), getPlanetDustColor(), isRunning ? 0.6 : 0.4, 0.42);
        }
      }
    } else {
      a.stepTimer = 0;
    }

    // Ground tracking & Planet-specific Jump physics (Task 4)
    const groundY = terrainHeight(a.group.position.x, a.group.position.z);
    if (HC.isJumping) {
      HC.jumpVelocity -= phys.gravity * dt;
      // Clamp terminal fall speed
      if (HC.jumpVelocity < -phys.terminalVelocity) HC.jumpVelocity = -phys.terminalVelocity;
      a.group.position.y += HC.jumpVelocity * dt;
      if (a.group.position.y <= groundY) {
        a.group.position.y = groundY;
        if (window.HomecomingAudio) window.HomecomingAudio.play('land');
        HC.isJumping = false;
        HC.jumpVelocity = 0;
        // Emit radial landing dust puff
        if (typeof emitDustPuff === 'function') {
          for (let k = 0; k < 3; k++) {
            const ang = (k / 3) * Math.PI * 2 + Math.random() * 0.5;
            const px = a.group.position.x + Math.cos(ang) * 0.35;
            const pz = a.group.position.z + Math.sin(ang) * 0.35;
            emitDustPuff(new V(px, groundY + 0.05, pz), new V(Math.cos(ang) * 0.8, 0.55, Math.sin(ang) * 0.8), getPlanetDustColor(), 0.65, 0.55);
          }
        }
      }
    } else {
      a.group.position.y = groundY + Math.sin(a.phase * 2) * 0.008 * (1 - a.moving);
    }

    // Ground-pinned contact shadow: strictly anchored to terrain, never jumps with the boots into the sky
    if (a.contactShadow && a.contactShadow.material) {
      const altitude = Math.max(0, a.group.position.y - groundY);
      a.contactShadow.position.set(a.group.position.x, groundY + 0.02, a.group.position.z);
      a.contactShadow.rotation.y = a.group.rotation.y;
      const fade = Math.max(0, 1.0 - altitude * 0.65);
      a.contactShadow.material.opacity = 0.38 * fade;
      const s = Math.max(0.15, 1.0 - altitude * 0.25);
      a.contactShadow.scale.set(s, s, s);
      a.contactShadow.visible = !HC.rover.driving && altitude < 3.0;
    }
  }

  function jump() {
    if (HC.isJumping || HC.rover.driving || HC.state !== STATES.EXPLORATION) return;
    const phys = getActivePhysics();
    HC.isJumping = true;
    HC.jumpVelocity = phys.jumpVelocity;
    if (window.HomecomingAudio) window.HomecomingAudio.play('jump');
  }

  function updateRover(dt) {
    const r = HC.rover;
    let throttle = 0;
    if (HC.keys.has('KeyW')) throttle += 1;
    if (HC.keys.has('KeyS')) throttle -= 1;
    if (touchState.joystickZ < -0.2) throttle += 1;
    if (touchState.joystickZ > 0.2) throttle -= 1;
    const isBoost = HC.keys.has('ShiftLeft') || HC.keys.has('ShiftRight') || touchState.running;
    // Normal cruising speed is 16 m/s (nearly 2x character sprint of 8.3 m/s), boost reaches 24 m/s (nearly 3x)
    const cap = isBoost ? 24 : 16;
    const accel = isBoost ? 38 : 25;
    const slopeFactor = Math.sin(r.pitch || 0) * 3.8;
    r.speed += (throttle * accel - slopeFactor) * dt;
    r.speed *= 1 - Math.min(.85, dt * 1.35);
    r.speed = clamp(r.speed, -6, cap);
    let steer = (HC.keys.has('KeyA') ? 1 : 0) - (HC.keys.has('KeyD') ? 1 : 0);
    if (touchState.joystickX < -0.2) steer += 1;
    if (touchState.joystickX > 0.2) steer -= 1;
    const steerSpeed = (1.8 + Math.min(10, Math.abs(r.speed)) * 0.04);
    r.heading += steer * dt * steerSpeed * (r.speed >= 0 ? 1 : -1);
    const forward = new V(-Math.sin(r.heading), 0, -Math.cos(r.heading)), next = r.group.position.clone().addScaledVector(forward, r.speed * dt);
    if (!isCollision(next, 1.25)) {
      alignRoverTerrain(r, next.x, next.z, r.heading, false, dt);
    } else {
      r.speed *= -.2;
      alignRoverTerrain(r, r.group.position.x, r.group.position.z, r.heading, false, dt);
    }
    r.wheels.forEach(w => w.rotation.x += r.speed * dt * 2.8);

    // Rover wheel dust kick-up particles when driving
    if (Math.abs(r.speed) > 1.4 && typeof emitDustPuff === 'function') {
      r.dustTimer = (r.dustTimer || 0) + dt;
      if (r.dustTimer > 0.06) {
        r.dustTimer = 0;
        const rtX = Math.cos(r.heading), rtZ = -Math.sin(r.heading);
        const fwX = -Math.sin(r.heading), fwZ = -Math.cos(r.heading);
        // Rear wheels offset: dx = ±0.88, dz = 0.72
        const rearDz = 0.75;
        const side = Math.random() > 0.5 ? 0.88 : -0.88;
        const wx = r.group.position.x + rtX * side - fwX * rearDz;
        const wz = r.group.position.z + rtZ * side - fwZ * rearDz;
        const wy = terrainHeight(wx, wz) + 0.08;
        const kickV = new V(-fwX * r.speed * 0.18 + (Math.random() - 0.5) * 0.4, 0.55 + Math.random() * 0.35, -fwZ * r.speed * 0.18 + (Math.random() - 0.5) * 0.4);
        emitDustPuff(new V(wx, wy, wz), kickV, getPlanetDustColor(), 0.75 + Math.min(0.5, Math.abs(r.speed) * 0.03), 0.65);
      }
    }

    // Rover engine audio continuous update
    if (HC.rover.driving && window.HomecomingAudio) {
      window.HomecomingAudio.updateRoverEngine(r.speed, throttle, isBoost);
    }
  }
  function updateDrone(dt, t) {
    const d = HC.drone;
    if (!d || !d.group) return;

    // Security camera drone is active across all worlds where security perimeters exist
    const present = true;
    d.group.visible = present;
    if (!present) {
      if (d.laserGroup) d.laserGroup.visible = false;
      if (d.impactMesh) d.impactMesh.visible = false;
      if (window.HomecomingAudio) window.HomecomingAudio.stopDrone();
      return;
    }

    const now = performance.now();
    const isDisabled = now < d.disabledUntil;
    const isPlayerAlive = HC.save && HC.save.resources && HC.save.resources.suit > 0 && HC.state === STATES.EXPLORATION;

    // Target position (aim at astronaut's upper torso / suit life support pack)
    const me = player();
    const targetChest = new THREE.Vector3(me.x, me.y + (HC.rover && HC.rover.driving ? 0.8 : 1.15), me.z);

    // Muzzle position in world space
    const muzzlePos = new THREE.Vector3();
    if (d.eye) {
      d.eye.getWorldPosition(muzzlePos);
    } else {
      muzzlePos.copy(d.group.position).add(new THREE.Vector3(0, 0, -0.45));
    }

    const dist = muzzlePos.distanceTo(targetChest);

    // Audio update (distance attenuation & alert status)
    if (window.HomecomingAudio) {
      window.HomecomingAudio.updateDrone(dist, d.alert, isDisabled);
    }

    // ── STATE: DISABLED (EMP) ──
    if (isDisabled) {
      d.state = 'DISABLED';
      d.alert = false;
      if (d.laserGroup) d.laserGroup.visible = false;
      if (d.impactMesh) d.impactMesh.visible = false;
      if (d.warningLight) d.warningLight.intensity = 0;
      if (d.eye && d.eye.material) {
        if (d.eye.material.emissive) d.eye.material.emissive.setHex(0x112833);
        if (d.eye.material.color) d.eye.material.color.setHex(0x183038);
      }
      // Drone droops/tilts down while powered off
      if (d.head) {
        d.head.rotation.x = angleLerp(d.head.rotation.x, 0.45, clamp(dt * 3.5, 0, 1));
        d.head.rotation.y += dt * 0.15;
      }
      return;
    }

    // Recovering from DISABLED state
    if (d.state === 'DISABLED') {
      d.state = 'COOLDOWN';
      d.stateTimer = 1.5;
    }

    // Line of sight check
    const hasLoS = isPlayerAlive && (dist <= 15.0) && checkLineOfSight(muzzlePos, targetChest);

    // Update state timer
    d.stateTimer = Math.max(0, (d.stateTimer || 0) - dt);

    // ── STATE MACHINE EXECUTION ──
    switch (d.state) {
      case 'IDLE': {
        d.alert = false;
        if (d.laserGroup) d.laserGroup.visible = false;
        if (d.impactMesh) d.impactMesh.visible = false;
        if (d.warningLight) d.warningLight.intensity = 0.2 + Math.sin(t * 0.003) * 0.15;
        if (d.eye && d.eye.material && d.eye.material.emissive) {
          d.eye.material.emissive.setHex(0x661108);
        }

        // Idle scan rotation (sweeping back and forth)
        d.phase += dt;
        if (d.head) {
          d.head.rotation.y = Math.sin(d.phase * 0.7) * 0.85;
          d.head.rotation.x = angleLerp(d.head.rotation.x, 0, clamp(dt * 3, 0, 1));
        }

        if (hasLoS && dist <= 14.0) {
          d.state = 'DETECTING';
          d.stateTimer = 0.35;
          d.alert = true;
          if (window.HomecomingAudio) window.HomecomingAudio.play('drone_alert');
        }
        break;
      }

      case 'DETECTING': {
        d.alert = true;
        if (d.laserGroup) d.laserGroup.visible = false;
        if (d.impactMesh) d.impactMesh.visible = false;
        if (d.warningLight) d.warningLight.intensity = 0.8;
        if (d.eye && d.eye.material && d.eye.material.emissive) {
          d.eye.material.emissive.setHex(0xff3311);
        }

        aimAtTarget(d.head, d.group.position, targetChest, dt, 5.0);

        if (!hasLoS) {
          d.state = 'SEARCHING';
          d.stateTimer = 2.5;
        } else if (d.stateTimer <= 0) {
          d.state = 'TRACKING';
          d.stateTimer = 0.45;
        }
        break;
      }

      case 'TRACKING': {
        d.alert = true;
        if (d.laserGroup) d.laserGroup.visible = false;
        if (d.impactMesh) d.impactMesh.visible = false;
        if (d.warningLight) d.warningLight.intensity = 1.0;
        if (d.eye && d.eye.material && d.eye.material.emissive) {
          d.eye.material.emissive.setHex(0xff2200);
        }

        aimAtTarget(d.head, d.group.position, targetChest, dt, 7.0);

        if (!hasLoS) {
          d.state = 'SEARCHING';
          d.stateTimer = 2.5;
        } else if (d.stateTimer <= 0) {
          d.state = 'CHARGING';
          d.stateTimer = 1.0; // 1.0 second reaction window!
          if (d.laserGroup && d.tracerMesh) {
            d.laserGroup.visible = true;
            d.coreMesh.visible = false;
            d.glowMesh.visible = false;
            d.tracerMesh.visible = true;
            if (d.impactMesh) d.impactMesh.visible = false;
          }
        }
        break;
      }

      case 'CHARGING': {
        d.alert = true;
        aimAtTarget(d.head, d.group.position, targetChest, dt, 9.0);

        // Flash eye rapidly
        const strobe = Math.sin(t * 0.03) > 0;
        if (d.eye && d.eye.material && d.eye.material.emissive) {
          d.eye.material.emissive.setHex(strobe ? 0xff5500 : 0xff0000);
        }
        if (d.warningLight) d.warningLight.intensity = strobe ? 1.6 : 0.4;

        // Render thin targeting laser tracer line to give player reaction warning!
        if (d.laserGroup && d.tracerMesh) {
          d.laserGroup.visible = true;
          d.coreMesh.visible = false;
          d.glowMesh.visible = false;
          d.tracerMesh.visible = true;
          if (d.impactMesh) d.impactMesh.visible = false;

          d.laserGroup.position.copy(muzzlePos);
          d.laserGroup.scale.set(1, dist, 1);
          const dir = targetChest.clone().sub(muzzlePos).normalize();
          d.laserGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          d.tracerMesh.material.opacity = 0.25 + (strobe ? 0.35 : 0.0);
        }

        if (!hasLoS) {
          if (d.laserGroup) d.laserGroup.visible = false;
          d.state = 'SEARCHING';
          d.stateTimer = 2.5;
        } else if (d.stateTimer <= 0) {
          d.state = 'FIRING';
          d.stateTimer = 0.35; // beam duration
          d.hasFiredInCycle = false;
          if (d.laserGroup && d.coreMesh && d.glowMesh) {
            d.laserGroup.visible = true;
            d.coreMesh.visible = true;
            d.glowMesh.visible = true;
            if (d.tracerMesh) d.tracerMesh.visible = false;
            if (d.impactMesh) d.impactMesh.visible = true;
            d.laserGroup.position.copy(muzzlePos);
            d.laserGroup.scale.set(1, dist, 1);
            const dir = targetChest.clone().sub(muzzlePos).normalize();
            d.laserGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            if (d.impactMesh) d.impactMesh.position.copy(targetChest);
          }
          if (!d.hasFiredInCycle) {
            d.hasFiredInCycle = true;
            if (HC.state === STATES.EXPLORATION) {
              const damage = 20; // 20% suit integrity
              HC.save.resources.suit = Math.max(0, HC.save.resources.suit - damage);
              persist();
              if (ui.suit) ui.suit.style.width = clamp(HC.save.resources.suit, 0, 100) + '%';
              triggerDamageFlash();
              if (window.HomecomingAudio) {
                window.HomecomingAudio.play('drone_laser');
                window.HomecomingAudio.play('laser_impact');
                window.HomecomingAudio.playWarning('suit');
              }
              if (HC.save.resources.suit < 25) {
                toast('CRITICAL: Suit integrity compromised!', 2500);
              }
            }
          }
        }
        break;
      }

      case 'FIRING': {
        d.alert = true;
        aimAtTarget(d.head, d.group.position, targetChest, dt, 12.0);

        if (d.eye && d.eye.material && d.eye.material.emissive) {
          d.eye.material.emissive.setHex(0xffffff); // flare
        }
        if (d.warningLight) d.warningLight.intensity = 2.5;

        // Render high-intensity red laser beam!
        if (d.laserGroup && d.coreMesh && d.glowMesh) {
          d.laserGroup.visible = true;
          d.coreMesh.visible = true;
          d.glowMesh.visible = true;
          if (d.tracerMesh) d.tracerMesh.visible = false;

          d.laserGroup.position.copy(muzzlePos);
          d.laserGroup.scale.set(1, dist, 1);
          const dir = targetChest.clone().sub(muzzlePos).normalize();
          d.laserGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

          if (d.impactMesh) {
            d.impactMesh.visible = true;
            d.impactMesh.position.copy(targetChest);
            d.impactMesh.scale.setScalar(1.0 + Math.sin(t * 0.04) * 0.4);
          }
        }

        // Apply discrete damage ONCE per firing cycle
        if (!d.hasFiredInCycle) {
          d.hasFiredInCycle = true;
          if (HC.state === STATES.EXPLORATION) {
            const damage = 20; // 20% suit integrity
            HC.save.resources.suit = Math.max(0, HC.save.resources.suit - damage);
            persist();
            if (ui.suit) ui.suit.style.width = clamp(HC.save.resources.suit, 0, 100) + '%';
            triggerDamageFlash();
            if (window.HomecomingAudio) {
              window.HomecomingAudio.play('drone_laser');
              window.HomecomingAudio.play('laser_impact');
              window.HomecomingAudio.playWarning('suit');
            }
            if (HC.save.resources.suit < 25) {
              toast('CRITICAL: Suit integrity compromised!', 2500);
            }
          }
        }

        if (d.stateTimer <= 0) {
          if (d.laserGroup) d.laserGroup.visible = false;
          if (d.impactMesh) d.impactMesh.visible = false;
          d.state = 'COOLDOWN';
          d.stateTimer = 1.6; // cooldown between shots
          d.hasFiredInCycle = false;
        }
        break;
      }

      case 'COOLDOWN': {
        d.alert = true;
        if (d.laserGroup) d.laserGroup.visible = false;
        if (d.impactMesh) d.impactMesh.visible = false;
        if (d.warningLight) d.warningLight.intensity = 0.4;
        if (d.eye && d.eye.material && d.eye.material.emissive) {
          d.eye.material.emissive.setHex(0x992208);
        }

        if (hasLoS) {
          aimAtTarget(d.head, d.group.position, targetChest, dt, 4.0);
        }

        if (d.stateTimer <= 0) {
          d.hasFiredInCycle = false;
          if (hasLoS && dist <= 14.0) {
            d.state = 'TRACKING';
            d.stateTimer = 0.35;
          } else {
            d.state = 'SEARCHING';
            d.stateTimer = 2.5;
          }
        }
        break;
      }

      case 'SEARCHING': {
        d.alert = false;
        if (d.laserGroup) d.laserGroup.visible = false;
        if (d.impactMesh) d.impactMesh.visible = false;
        if (d.warningLight) d.warningLight.intensity = 0.3;
        if (d.eye && d.eye.material && d.eye.material.emissive) {
          d.eye.material.emissive.setHex(0xcc6611); // searching amber
        }

        if (d.head) {
          d.head.rotation.y += Math.sin(t * 0.005) * dt * 1.5;
          d.head.rotation.x = angleLerp(d.head.rotation.x, 0, clamp(dt * 2.5, 0, 1));
        }

        if (hasLoS && dist <= 14.0) {
          d.state = 'DETECTING';
          d.stateTimer = 0.25;
        } else if (d.stateTimer <= 0) {
          d.state = 'IDLE';
        }
        break;
      }

      default:
        d.state = 'IDLE';
        break;
    }
  }
  /* ─────────────────────────────────────────────────────────────────────
     GTA-STYLE ROVER VEHICLE CAMERA CONTROLLER
     Automatic rear follow, reverse front camera, manual mouse-look with
     inactivity return, terrain clearance, and obstacle collision avoidance.
     ───────────────────────────────────────────────────────────────────── */
  const ROVER_CAM_STATES = Object.freeze({
    FOLLOW_REAR: 'FOLLOW_REAR',
    MANUAL_LOOK: 'MANUAL_LOOK',
    FOLLOW_FRONT: 'FOLLOW_FRONT',
    RETURNING: 'RETURNING'
  });

  const roverCamConfig = {
    followDistance: 9.5,
    followHeight: 2.8,
    focusLeadDistance: 4.8,
    pitchBase: -0.16,
    returnDelayMs: 2000,
    yawFollowSpeed: 2.8,
    yawReturnSpeed: 3.5,
    pitchReturnSpeed: 2.5,
    reverseSpeedThreshold: -0.6
  };

  const roverCamState = {
    active: false,
    mode: ROVER_CAM_STATES.FOLLOW_REAR,
    lastInputTime: 0,
    turnSideBias: 1
  };

  function shortestAngleDiff(from, to) {
    let diff = (to - from) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
  }

  function resetRoverCamera() {
    roverCamState.active = false;
    roverCamState.mode = ROVER_CAM_STATES.FOLLOW_REAR;
    roverCamState.lastInputTime = 0;
    roverCamState.turnSideBias = 1;
  }

  function notifyRoverCameraManualLook() {
    roverCamState.mode = ROVER_CAM_STATES.MANUAL_LOOK;
    roverCamState.lastInputTime = performance.now();
  }

  function updateRoverCamera(dt, now) {
    const r = HC.rover;
    if (!r || !r.group) return;

    // Detect reverse vs forward input and movement
    const isReverseInput = HC.keys.has('KeyS') || (typeof touchState !== 'undefined' && touchState.joystickZ > 0.2);
    const isForwardInput = HC.keys.has('KeyW') || (typeof touchState !== 'undefined' && touchState.joystickZ < -0.2);
    const isMovingReverse = r.speed < roverCamConfig.reverseSpeedThreshold;
    const isMovingForward = r.speed > 0.4;
    const isBraking = isReverseInput && r.speed >= 0;

    // Track steering for side-bias during 180-degree transitions
    let steer = (HC.keys.has('KeyA') ? 1 : 0) - (HC.keys.has('KeyD') ? 1 : 0);
    if (typeof touchState !== 'undefined') {
      if (touchState.joystickX < -0.2) steer += 1;
      if (touchState.joystickX > 0.2) steer -= 1;
    }
    if (steer !== 0) {
      roverCamState.turnSideBias = steer > 0 ? -1 : 1;
    }

    // 1. Manage State Transitions
    if (roverCamState.mode === ROVER_CAM_STATES.MANUAL_LOOK) {
      const elapsed = now - (roverCamState.lastInputTime || 0);
      if (elapsed >= roverCamConfig.returnDelayMs) {
        roverCamState.mode = ROVER_CAM_STATES.RETURNING;
      }
    } else if (roverCamState.mode === ROVER_CAM_STATES.RETURNING) {
      // Handled during interpolation below
    } else {
      // Automatic Driving Modes: FOLLOW_REAR or FOLLOW_FRONT
      if (isMovingReverse && isReverseInput && !isBraking) {
        roverCamState.mode = ROVER_CAM_STATES.FOLLOW_FRONT;
      } else if (isMovingForward || isForwardInput) {
        roverCamState.mode = ROVER_CAM_STATES.FOLLOW_REAR;
      }
    }

    // 2. Determine target yaw and pitch
    const isReversePreferred = (roverCamState.mode === ROVER_CAM_STATES.FOLLOW_FRONT) ||
      (roverCamState.mode === ROVER_CAM_STATES.RETURNING && isMovingReverse && isReverseInput && !isBraking);

    let targetYaw = isReversePreferred ? (r.heading + Math.PI) : r.heading;
    let targetPitch = roverCamConfig.pitchBase;

    // 3. Smooth Yaw & Pitch Interpolation
    if (roverCamState.mode === ROVER_CAM_STATES.MANUAL_LOOK) {
      HC.mouse.pitch = clamp(HC.mouse.pitch, -0.62, 0.36);
    } else if (roverCamState.mode === ROVER_CAM_STATES.RETURNING) {
      let diff = shortestAngleDiff(HC.mouse.yaw, targetYaw);
      if (Math.abs(Math.abs(diff) - Math.PI) < 0.05) {
        diff = Math.PI * (roverCamState.turnSideBias || 1);
      }
      const returnYawRate = Math.min(1.0, dt * roverCamConfig.yawReturnSpeed);
      HC.mouse.yaw += diff * returnYawRate;

      const returnPitchRate = Math.min(1.0, dt * roverCamConfig.pitchReturnSpeed);
      HC.mouse.pitch += (targetPitch - HC.mouse.pitch) * returnPitchRate;

      if (Math.abs(diff) < 0.04 && Math.abs(HC.mouse.pitch - targetPitch) < 0.04) {
        roverCamState.mode = isReversePreferred ? ROVER_CAM_STATES.FOLLOW_FRONT : ROVER_CAM_STATES.FOLLOW_REAR;
      }
    } else {
      let diff = shortestAngleDiff(HC.mouse.yaw, targetYaw);
      if (Math.abs(Math.abs(diff) - Math.PI) < 0.05) {
        diff = Math.PI * (roverCamState.turnSideBias || 1);
      }
      const followRate = Math.min(1.0, dt * roverCamConfig.yawFollowSpeed);
      HC.mouse.yaw += diff * followRate;

      HC.mouse.pitch += (targetPitch - HC.mouse.pitch) * Math.min(1.0, dt * 2.0);
    }

    // 4. Calculate Camera 3D Position
    const subject = r.group.position;
    const f = new V(-Math.sin(HC.mouse.yaw), 0, -Math.cos(HC.mouse.yaw));
    const dist = roverCamConfig.followDistance;
    const desired = subject.clone().addScaledVector(f, -dist);

    // Height & ground clearance
    const groundUnderCam = terrainHeight(desired.x, desired.z);
    desired.y = Math.max(groundUnderCam + 1.4, subject.y + roverCamConfig.followHeight + Math.sin(HC.mouse.pitch) * 2.5);

    // Solid obstacles collision avoidance
    if (HC.solids && HC.solids.length) {
      const rx = subject.x, rz = subject.z;
      const toCamX = desired.x - rx, toCamZ = desired.z - rz;
      const rayLen = Math.hypot(toCamX, toCamZ);
      if (rayLen > 0.5) {
        const uX = toCamX / rayLen, uZ = toCamZ / rayLen;
        for (let i = 0; i < HC.solids.length; i++) {
          const s = HC.solids[i];
          const toObsX = s.x - rx, toObsZ = s.z - rz;
          const proj = toObsX * uX + toObsZ * uZ;
          if (proj > 1.0 && proj < rayLen) {
            const perpDist = Math.hypot(toObsX - proj * uX, toObsZ - proj * uZ);
            if (perpDist < (s.r || 1.5) + 0.7) {
              const safeDist = Math.max(3.2, proj - (s.r || 1.5) - 0.4);
              desired.x = rx + uX * safeDist;
              desired.z = rz + uZ * safeDist;
              desired.y = Math.max(terrainHeight(desired.x, desired.z) + 1.4, desired.y);
              break;
            }
          }
        }
      }
    }

    // 5. Camera Aim Focus Point
    const focusLead = roverCamConfig.focusLeadDistance;
    const focus = subject.clone().addScaledVector(f, focusLead);
    focus.y = terrainHeight(focus.x, focus.z) + 1.1;

    // 6. Smooth Position Damping
    if (!HC.cameraPosition) HC.cameraPosition = cam.position.clone();
    HC.cameraPosition.lerp(desired, clamp(dt * 8.5, 0, 1));
    cam.position.copy(HC.cameraPosition);

    // 7. Dynamic Vehicle Speed FOV & Responsive Portrait Adaptation
    const speedFovBonus = Math.min(7, Math.abs(r.speed) * 0.3);
    const baseRoverFov = 54 + speedFovBonus;
    const aspectR = (cam && cam.aspect) || (window.innerWidth / Math.max(1, window.innerHeight));
    if (aspectR < 1.0) {
      cam.fov = clamp(baseRoverFov / Math.max(0.65, aspectR), baseRoverFov, 78);
    } else {
      cam.fov = baseRoverFov;
    }
    cam.updateProjectionMatrix();

    cam.lookAt(focus);
  }

  function updateCamera(dt, now) {
    if (HC.rover && HC.rover.driving) {
      updateRoverCamera(dt, now || performance.now());
      return;
    }
    const subject = player(), f = new V(-Math.sin(HC.mouse.yaw), 0, -Math.cos(HC.mouse.yaw)), distance = HC.mouse.distance;
    const desired = subject.clone().addScaledVector(f, -distance);
    const groundUnderCam = terrainHeight(desired.x, desired.z);
    desired.y = Math.max(groundUnderCam + 1.2, subject.y + 2.2 + Math.sin(HC.mouse.pitch) * 2.5);
    const focus = subject.clone().addScaledVector(f, 3.0);
    focus.y = terrainHeight(focus.x, focus.z) + 1.2;
    if (!HC.cameraPosition) HC.cameraPosition = cam.position.clone();
    HC.cameraPosition.lerp(desired, clamp(dt * 7, 0, 1));
    cam.position.copy(HC.cameraPosition);
    const baseFov = 52;
    const aspect = (cam && cam.aspect) || (window.innerWidth / Math.max(1, window.innerHeight));
    if (aspect < 1.0) {
      cam.fov = clamp(baseFov / Math.max(0.65, aspect), baseFov, 75);
    } else {
      cam.fov = baseFov;
    }
    cam.updateProjectionMatrix();
    cam.lookAt(focus);
  }
  function updateHUD(t) {
    const curP = HC.save.planet || 0;
    const m = mission();
    const isCompletedPlanet = m ? (m.planet > curP) : true;
    const w = waypoint(), me = player();
    const distance = w ? Math.round(me.distanceTo(w.pos)) : 0;
    const bearing = w ? Math.atan2(w.pos.x - me.x, -(w.pos.z - me.z)) - HC.mouse.yaw : 0;
    const arrow = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][Math.round((((bearing % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];

    // Navigation update banner state
    const isNavUpdating = performance.now() < (HC.navUpdatedTime || 0);
    if (ui.distance) {
      ui.distance.classList.toggle('nav-updating', isNavUpdating);
    }

    if (isCompletedPlanet) {
      const pName = PLANETS[curP].name.toUpperCase();
      ui.objective.textContent = 'FREE RECONNAISSANCE · ' + pName;
      if (isNavUpdating) {
        ui.distance.textContent = '▶ UPDATED NAVIGATION ON YOUR HUD ◀ · ASCENT CRAFT TRACKING';
      } else {
        ui.distance.textContent = w ? (arrow + ' ASCENT CRAFT · ' + distance + ' M · ESC TO ORBIT') : 'SURFACE TELEMETRY ACTIVE · ESC TO ORBIT';
      }
    } else {
      ui.objective.textContent = m.name;
      if (isNavUpdating) {
        ui.distance.textContent = '▶ UPDATED NAVIGATION ON YOUR HUD ◀ · ' + (w ? arrow + ' ' + w.name.toUpperCase() + ' · ' + distance + ' M' : 'NEW OBJECTIVE ACQUIRED');
      } else {
        ui.distance.textContent = (m.target === 'components' && HC.save.components.length < 3 ? ('ENGINE COMPONENTS ' + HC.save.components.length + '/3 · ') : '') + (w ? arrow + ' ' + w.name.toUpperCase() + ' · ' + distance + ' M' : 'UPDATED NAVIGATION ON YOUR HUD');
      }
    }

    const heading = ((HC.mouse.yaw * 180 / Math.PI) % 360 + 360) % 360;
    ui.compass.textContent = 'N · NE · E · SE · S · SW · W · NW   ' + Math.round(heading).toString().padStart(3, '0') + '°';

    // Update Blue Waypoint Dot on Compass Strip
    if (ui.compassPip) {
      if (w) {
        const targetAngle = Math.atan2(w.pos.x - me.x, -(w.pos.z - me.z));
        let diff = targetAngle - HC.mouse.yaw;
        diff = ((diff % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;

        const halfFov = Math.PI * 0.52;
        let pct = 50 + (diff / halfFov) * 50;
        const arrowEl = ui.compassPip.querySelector('.hc-pip-arrow');

        if (diff > halfFov) {
          pct = 97;
          if (arrowEl) arrowEl.textContent = '▸';
        } else if (diff < -halfFov) {
          pct = 3;
          if (arrowEl) arrowEl.textContent = '◂';
        } else {
          pct = clamp(pct, 4, 96);
          if (arrowEl) {
            if (Math.abs(diff) < 0.08) arrowEl.textContent = '▼';
            else arrowEl.textContent = diff > 0 ? '▸' : '◂';
          }
        }

        ui.compassPip.style.left = pct.toFixed(1) + '%';
        ui.compassPip.classList.add('on');
      } else {
        ui.compassPip.classList.remove('on');
      }
    }

    ui.suit.style.width = clamp(HC.save.resources.suit, 0, 100) + '%';
    ui.oxygen.style.width = clamp(HC.save.resources.oxygen, 0, 100) + '%';
    ui.salvage.textContent = 'Salvage ' + HC.save.resources.salvage + ' · Credits ' + HC.save.resources.credits;
    const left = Math.max(0, (HC.empReady - t) / 1000);
    ui.emp.textContent = left ? 'EMP CHARGING ' + left.toFixed(1) + ' S' : 'EMP READY [F]';
    // Low suit/oxygen audio alarms
    if (window.HomecomingAudio && HC.state === STATES.EXPLORATION) {
      if (HC.save.resources.suit < 25) window.HomecomingAudio.playWarning('suit');
      else if (HC.save.resources.oxygen < 25) window.HomecomingAudio.playWarning('oxygen');
    }
    drawMap(w);
  }
  function drawMap(w) {
    const c = ui.map, x = c.getContext('2d'), me = player(), scale = 1.25, half = c.width / 2; x.clearRect(0, 0, c.width, c.height); x.save(); x.translate(half, half); x.fillStyle = 'rgba(204,87,45,.12)'; x.beginPath(); x.arc(0, 0, 138, 0, Math.PI * 2); x.fill(); x.strokeStyle = 'rgba(251,233,220,.3)'; x.lineWidth = 1; x.beginPath(); x.arc(0, 0, 116, 0, Math.PI * 2); x.stroke();
    HC.solids.forEach(s => { const sx = (s.x - me.x) * scale, sz = (s.z - me.z) * scale; x.fillStyle = '#785243'; x.beginPath(); x.arc(sx, sz, Math.max(3, s.r * scale), 0, Math.PI * 2); x.fill(); });
    if (HC.rover && !HC.rover.driving) { const rx = (HC.rover.group.position.x - me.x) * scale, rz = (HC.rover.group.position.z - me.z) * scale; x.fillStyle = '#e8bf8a'; x.fillRect(rx - 3, rz - 3, 6, 6); }
    // Audio log markers on minimap
    if (HC.audioLogObjects) {
      HC.audioLogObjects.forEach(obj => {
        if (!obj.group.visible) return;
        const lx = (obj.pos.x - me.x) * scale, lz = (obj.pos.z - me.z) * scale;
        x.fillStyle = '#ffd84a'; x.beginPath(); x.arc(lx, lz, 4, 0, Math.PI * 2); x.fill();
      });
    }
    if (w) { const wx = (w.pos.x - me.x) * scale, wz = (w.pos.z - me.z) * scale; x.strokeStyle = '#72e9ff'; x.lineWidth = 3; x.beginPath(); x.arc(wx, wz, 7, 0, Math.PI * 2); x.stroke(); }
    // Canvas Y runs downward, so the world-facing yaw needs the opposite sign.
    x.rotate(-(HC.rover.driving ? HC.rover.heading : HC.astronaut.group.rotation.y)); x.fillStyle = '#fff7e7'; x.beginPath(); x.moveTo(0, -9); x.lineTo(6, 7); x.lineTo(-6, 7); x.closePath(); x.fill(); x.restore();
  }

  /* ─────────────────────────────────────────────────────────────────────
     STATE TRANSITIONS
     ───────────────────────────────────────────────────────────────────── */
  function beginExploration() {
    HC.state = STATES.EXPLORATION;
    show(ui.intro, false);
    show(ui.hub, false);
    show(ui.hud, true);
    const curP = currentPlanet();
    if (!HC.world || !HC.planet || HC.planet.id !== curP.id) {
      makeWorld();
    }
    HC.world.visible = true;
    const AC = window.ArcadeCore;
    if (AC) {
      if (AC.planet) AC.planet.visible = false;
      if (AC.atm) AC.atm.visible = false;
      if (AC.decor) AC.decor.visible = false;
      if (AC.moons) AC.moons.forEach(m => m.o.visible = false);
      if (AC.stars) AC.stars.visible = false;
      if (AC.brightStars) AC.brightStars.visible = false;
      if (AC.nebulae) AC.nebulae.visible = false;
      if (AC.stardust) AC.stardust.visible = false;
    }
    if (planetCompanions) planetCompanions.visible = false;
    HC.cameraPosition = cam.position.clone();
    HC.titleToneMapping = renderer.toneMapping;
    HC.titleExposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .9;
    const p = currentPlanet();
    scene.background = new THREE.Color(p.sky);
    scene.fog = new THREE.FogExp2(p.fog, .007);
    if (cam && cam.far < 650) {
      cam.far = 650;
      cam.updateProjectionMatrix();
    }

    // Audio: start planet ambience loop, space music, and suit breathing
    if (window.HomecomingAudio) {
      window.HomecomingAudio.setPlanetAmbience(p.id);
      window.HomecomingAudio.startMusic();
      if (!HC.rover.driving) window.HomecomingAudio.startSuitBreathing();
    }

    const isTutorialStarting = HC.save && !HC.save.tutorialCompleted && HC.save.stats.mainMissions === 0;

    const m = mission();
    if (m) {
      if (!HC.spokenMissions) HC.spokenMissions = new Set();
      const isNewMission = !HC.spokenMissions.has(m.id);

      // Only speak mission briefing if this mission hasn't been spoken and tutorial is not starting
      if (isNewMission && !isTutorialStarting) {
        HC.spokenMissions.add(m.id);
        const oraDur = Math.max(4500, Math.min(8500, m.ora.length * 75));
        toast('ORA: ' + m.ora, oraDur, ORA_PRIORITY.MISSION);
      }

      // Gentle orientation toward current mission objective
      const wp = waypoint();
      if (wp && HC.mouse && HC.astronaut && HC.astronaut.group) {
        const aPos = HC.astronaut.group.position;
        const dx = wp.pos.x - aPos.x;
        const dz = wp.pos.z - aPos.z;
        if (Math.hypot(dx, dz) > 1.0) {
          HC.mouse.yaw = Math.atan2(dx, dz);
        }
      }
    } else {
      toast('ORA: All missions on this planet are complete.', 3000, ORA_PRIORITY.MISSION);
    }
    persist();
    sdkGameplayStart();
    setMobileControlsVisible(true);
    if (isTutorialStarting) {
      setTimeout(() => showTutorial(0), 600);
    }
  }

  function begin(newGame) {
    if (newGame) {
      HC.save = defaultSave();
      persist();
      HC.active = true;
      document.body.classList.add('play', 'expedition');
      ui.wrap.classList.add('active');
      document.getElementById('go').blur();
      makeWorld();
      setGlobePlanet(0);

      // Trigger Cinematic Story Prologue for new game
      if (window.HomecomingPrologue && !HC.save.prologueCompleted) {
        HC.state = STATES.PROLOGUE;
        show(ui.intro, false);
        show(ui.hud, false);
        show(ui.pause, false);
        show(ui.chapter, false);
        show(ui.hub, false);
        show(ui.travel, false);
        show(ui.ending, false);
        show(ui.dialogue, false);
        window.HomecomingPrologue.start({
          onComplete: () => {
            HC.save.prologueCompleted = true;
            persist();
            beginExploration();
          }
        });
        return;
      }

      HC.state = STATES.INTRO;
      setMobileControlsVisible(true);
      show(ui.intro, true);
      show(ui.hud, false);
      show(ui.pause, false);
      show(ui.chapter, false);
      show(ui.hub, false);
      show(ui.travel, false);
      show(ui.ending, false);
      show(ui.dialogue, false);
    } else {
      HC.save = loadSave();
      HC.active = true;
      document.body.classList.add('play', 'expedition');
      ui.wrap.classList.add('active');
      document.getElementById('go').blur();
      makeWorld();
      // Directly open Mission Hub with the current saved planet!
      const dest = HC.save.planet || 0;
      setGlobePlanet(dest);
      showHub(dest);
    }
  }

  function returnTitle() {
    sdkGameplayStop();
    setMobileControlsVisible(false);
    try { document.exitPointerLock(); } catch (_) { }
    if (window.HomecomingDeparture && window.HomecomingDeparture.isActive()) {
      window.HomecomingDeparture.cleanup();
    }
    if (window.HomecomingPrologue && window.HomecomingPrologue.isActive()) {
      window.HomecomingPrologue.cleanup();
    }
    HC.active = false;
    HC.state = STATES.TITLE;
    HC.keys.clear();
    if (HC.world) { HC.world.visible = false; }
    
    // Set globe to the current saved planet and update orbital perspective
    const savedPlanet = (HC.save && HC.save.planet) || 0;
    setGlobePlanet(savedPlanet);
    updateOrbitalView(STATES.TITLE, savedPlanet);

    const AC = window.ArcadeCore;
    if (AC) {
      if (AC.moons) AC.moons.forEach(m => m.o.visible = savedPlanet === 0);
      if (AC.renderer) {
        AC.renderer.toneMapping = HC.titleToneMapping == null ? THREE.NoToneMapping : HC.titleToneMapping;
        AC.renderer.toneMappingExposure = HC.titleExposure == null ? 1 : HC.titleExposure;
      }
      if (AC.S) {
        AC.S.play = false;
        AC.S.zo = 0;
      }
    }

    HC.cameraPosition = null;
    document.body.classList.remove('play', 'expedition');
    ui.wrap.classList.remove('active');
    show(ui.intro, false);
    show(ui.hud, false);
    show(ui.pause, false);
    show(ui.puzzle, false);
    show(ui.chapter, false);
    show(ui.hub, false);
    show(ui.travel, false);
    show(ui.ending, false);
    show(ui.dialogue, false);
    show(ui.log, false);
    if (HC.rover) HC.rover.driving = false;
    resetRoverCamera();
    if (HC.astronaut) HC.astronaut.group.visible = true;
    toast('');
    updateTitleScreenInfo();

    // Audio cleanup and title ambience + main theme music
    if (window.HomecomingAudio) {
      window.HomecomingAudio.stopSuitBreathing();
      window.HomecomingAudio.stopRoverEngine();
      window.HomecomingAudio.stopDrone();
      window.HomecomingAudio.setAmbience('title');
      window.HomecomingAudio.startMusic();
    }
  }

  function pause() {
    if (HC.state !== STATES.EXPLORATION) return;
    HC.state = STATES.PAUSED;
    sdkGameplayStop();
    setMobileControlsVisible(false);
    show(ui.pause, true);
    if (window.HomecomingAudio) {
      window.HomecomingAudio.pause();
      window.HomecomingAudio.stopSpeech();
    }
    try { document.exitPointerLock(); } catch (_) { }
  }
  function resume() {
    show(ui.pause, false);
    if (HC.state === STATES.PAUSED) {
      HC.state = STATES.EXPLORATION;
      sdkGameplayStart();
      setMobileControlsVisible(true);
      if (window.HomecomingAudio) window.HomecomingAudio.resume();
    }
  }
  function resetProgress() {
    if (confirm('Reset all Project Homecoming expedition progress on this device?')) {
      try {
        if (window.BGAdapter && typeof window.BGAdapter.removeItem === 'function') {
          window.BGAdapter.removeItem(SAVE_KEY);
        } else {
          localStorage.removeItem(SAVE_KEY);
        }
      } catch (_) { }
      HC.save = defaultSave();
      setGlobePlanet(0);
      returnTitle();
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     CONTROLS
     ───────────────────────────────────────────────────────────────────── */
  function onKey(e, down) {
    if (!HC.active) return; if (down && ['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (down && e.code === 'Escape') {
      if (HC.state === STATES.PROLOGUE) {
        if (window.HomecomingPrologue) window.HomecomingPrologue.skip();
        return;
      }
      if (ui.pause && !ui.pause.classList.contains('hc-hidden')) { resume(); return; }
      if (HC.state === STATES.EXPLORERS) { closeExplorersLog(); return; }
      if (HC.state === STATES.COMMS) { closeComms(); return; }
      if (HC.state === STATES.PUZZLE) { cancelPuzzle(); return; }
      if (HC.state === STATES.DIALOGUE) { skipDialogue(); return; }
      if (document.pointerLockElement === renderer.domElement) { try { document.exitPointerLock(); } catch (_) { } return; }
      if (HC.state === STATES.EXPLORATION) pause(); return;
    }
    if (down && e.code === 'KeyX') {
      if (HC.state === STATES.EXPLORERS) { closeExplorersLog(); return; }
      if (HC.state === STATES.EXPLORATION || HC.state === STATES.PAUSED) { openExplorersLog(); return; }
    }
    if (down && e.code === 'KeyL') {
      if (HC.state === STATES.COMMS) { closeComms(); return; }
      if (HC.state === STATES.EXPLORATION) { openComms('ora'); return; }
    }
    if (down && e.code === 'KeyC') {
      if (HC.state === STATES.EXPLORATION) {
        triggerScanOrCancel();
        return;
      }
    }
    if (!down) { HC.keys.delete(e.code); return; } HC.keys.add(e.code); if (e.repeat) return;
    if (HC.state === STATES.PROLOGUE) {
      if (window.HomecomingPrologue) window.HomecomingPrologue.onKey(e, down);
      return;
    }
    if (HC.state === STATES.DEPARTURE) {
      if (window.HomecomingDeparture) window.HomecomingDeparture.onKey(e, down);
      return;
    }
    if (HC.state !== STATES.EXPLORATION) return;
    if (e.code === 'KeyE') interact();
    else if (e.code === 'KeyR') tryVehicle();
    else if (e.code === 'KeyF') emp();
    else if (e.code === 'KeyP') pause();
    else if (e.code === 'Space') jump();
  }
  function bindControls() {
    window.addEventListener('keydown', e => onKey(e, true)); window.addEventListener('keyup', e => onKey(e, false));
    renderer.domElement.addEventListener('click', e => { if (HC.state === STATES.EXPLORATION && !e.target.closest('#homecoming-ui')) renderer.domElement.requestPointerLock(); });
    document.addEventListener('mousemove', e => {
      if (HC.active && HC.state === STATES.EXPLORATION && document.pointerLockElement === renderer.domElement) {
        HC.mouse.yaw -= e.movementX * .0028;
        HC.mouse.pitch = clamp(HC.mouse.pitch - e.movementY * .002, -.62, .36);
        if (HC.rover && HC.rover.driving && (Math.abs(e.movementX) > 0.4 || Math.abs(e.movementY) > 0.4)) {
          notifyRoverCameraManualLook();
        }
      }
    });
    renderer.domElement.addEventListener('wheel', e => { if (HC.active && HC.state === STATES.EXPLORATION) { HC.mouse.distance = clamp(HC.mouse.distance + e.deltaY * .012, 4.5, 15); } }, { passive: true });
  }

  /* ─────────────────────────────────────────────────────────────────────
     FRAME LOOP
     ───────────────────────────────────────────────────────────────────── */
  function frame(t) {
    const now = performance.now(), dt = Math.min(.05, Math.max(.001, (now - HC.last) / 1000)); HC.last = now;

    // Travel animation update
    if (HC.state === STATES.TRAVEL) {
      updateOrbitalView(STATES.TRAVEL, HC.travelDestination);
      updateTravel();
      return;
    }

    // Playable Space Departure, Cockpit Asteroid Flight, Jump & Wormhole
    if (HC.state === STATES.DEPARTURE) {
      if (planetCompanions) planetCompanions.visible = false;
      const AC = window.ArcadeCore;
      if (AC) {
        if (AC.planet) AC.planet.visible = false;
        if (AC.atm) AC.atm.visible = false;
        if (AC.decor) AC.decor.visible = false;
        if (AC.moons) AC.moons.forEach(m => { if (m && m.o) m.o.visible = false; });
      }
      if (window.HomecomingDeparture && window.HomecomingDeparture.isActive()) {
        window.HomecomingDeparture.update(dt, now);
      }
      return;
    }

    // Cinematic Story Prologue
    if (HC.state === STATES.PROLOGUE) {
      if (window.HomecomingPrologue && window.HomecomingPrologue.isActive()) {
        window.HomecomingPrologue.update(dt, now);
      }
      return;
    }

    // Orbital Hub screen update
    if (HC.state === STATES.HUB) {
      updateOrbitalView(STATES.HUB, HC.save ? HC.save.planet : 0);
      return;
    }

    // If on planetary surface, continuously keep camera tracking the player/rover
    if (HC.world && HC.world.visible) {
      updateCamera(dt, now);
      if (HC.dust) HC.dust.rotation.y += dt * .01;
      updateSkyPhenomena(dt, now);
      if (typeof updateDustPuffs === 'function') updateDustPuffs(dt);
    }

    if (HC.state !== STATES.EXPLORATION) return;
    if (HC.rover.driving) updateRover(dt); else updateAstronaut(dt);
    updateScan(dt);
    HC.save.resources.oxygen = Math.max(0, HC.save.resources.oxygen - dt * .016);
    HC.save.stats.explorationSeconds += dt;
    updateDrone(dt, now); updateMarkers(t); updatePrompt(); updateHUD(now);
    if (typeof tutorialState !== 'undefined' && tutorialState.active) updateInteractiveTutorial(dt, now);
    if (HC.save.resources.suit <= 0 || HC.save.resources.oxygen <= 0) {
      HC.save.resources.suit = Math.max(45, HC.save.resources.suit);
      HC.save.resources.oxygen = Math.max(45, HC.save.resources.oxygen);
      const curP = HC.planet || PLANETS[HC.save.planet || 0];
      if (curP && curP.id !== 'mars' && curP.launch) {
        HC.astronaut.group.position.copy(pos(curP.launch[0] + 3.2, curP.launch[1] + 1.8, 0));
      } else {
        HC.astronaut.group.position.copy(pos(3, -7, 0));
      }
      if (HC.drone) {
        HC.drone.state = 'COOLDOWN';
        HC.drone.stateTimer = 4.0;
        if (HC.drone.laserGroup) HC.drone.laserGroup.visible = false;
        if (HC.drone.impactMesh) HC.drone.impactMesh.visible = false;
      }
      toast('ORA: Emergency recovery complete. Suit reserves restored.', 3500);
      persist();
    }

    // Periodic ORA hints (every ~90 seconds if player seems stuck)
    if (!HC.lastHintTime) HC.lastHintTime = now;
    if (now - HC.lastHintTime > 90000) {
      HC.lastHintTime = now;
      const m = mission();
      if (m && m.planet === HC.save.planet) {
        const w = waypoint();
        if (w && player().distanceTo(w.pos) > 30) {
          toast('ORA: ' + ORA_LINES.hints.stuck, 4000);
        }
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     INITIALIZATION
     ───────────────────────────────────────────────────────────────────── */
  function init() {
    injectUI();
    HC.save = loadSave();
    makeWorld();
    HC.empReady = 0;
    bindControls();
    const handleStartGame = () => begin(!hasProgress());
    const goBtn = document.getElementById('go');
    if (goBtn) {
      goBtn.onclick = handleStartGame;
      goBtn.ontouchstart = (e) => {
        if (e && e.cancelable) e.preventDefault();
        handleStartGame();
      };
    }
    document.getElementById('back').onclick = returnTitle;
    window.addEventListener('bg:ready', () => {
      if (HC.state === STATES.TITLE) {
        const cloudSave = loadSave();
        if (cloudSave && cloudSave.updated && (!HC.save || cloudSave.updated > (HC.save.updated || 0))) {
          HC.save = cloudSave;
          if (typeof setGlobePlanet === 'function') setGlobePlanet(HC.save.planet || 0);
          const dynamicGoBtn = document.getElementById('go');
          if (dynamicGoBtn) {
            dynamicGoBtn.onclick = handleStartGame;
            dynamicGoBtn.ontouchstart = (e) => {
              if (e && e.cancelable) e.preventDefault();
              handleStartGame();
            };
          }
        }
      }
    });
    function updateTitleAudioUI() {
      const themeBanner = document.getElementById('hc-theme-banner');
      const audio = window.HomecomingAudio;
      if (!audio) return;
      const isPlaying = typeof audio.isMusicPlaying === 'function' ? audio.isMusicPlaying() : (audio.musicNodes && !audio.settings.muted);

      if (themeBanner) {
        themeBanner.style.display = 'none';
      }
    }

    const settingsBtn = document.getElementById('hc-title-settings') || document.getElementById('hc-title-audio');
    if (settingsBtn) {
      settingsBtn.innerHTML = '<span class="hc-settings-icon">⚙️</span> SETTINGS';
      settingsBtn.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        show(ui.pause, true);
        if (ui.syncAudioSliders) ui.syncAudioSliders();
        if (typeof updateGraphicsUI === 'function') updateGraphicsUI();
      };
    }

    const themeBanner = document.getElementById('hc-theme-banner');
    if (themeBanner) {
      themeBanner.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const audio = window.HomecomingAudio;
        if (audio) {
          if (audio.settings.muted) audio.setMuted(false);
          if (audio.resumeAudio) audio.resumeAudio(); else audio.startMusic('theme');
        }
        updateTitleAudioUI();
      };
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('homecoming-audio-state', updateTitleAudioUI);
      ['click', 'pointerdown', 'keydown', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, () => setTimeout(updateTitleAudioUI, 120), { passive: true });
      });
    }

    // Position globe nicely on the right side of the screen for title screen
    const AC = window.ArcadeCore;
    if (AC && AC.planet && AC.atm) {
      const offsetX = window.innerWidth > 850 ? 1.4 : 0.5;
      AC.planet.position.set(offsetX, 0, 0);
      AC.atm.position.copy(AC.planet.position);
    }

    const onWindowResizeHandler = () => {
      const AC = window.ArcadeCore;
      const w = window.innerWidth, h = window.innerHeight;
      if (w <= 0 || h <= 0) return;

      if (AC) {
        if (AC.cam) {
          AC.cam.aspect = w / h;
          AC.cam.updateProjectionMatrix();
        }
        if (AC.renderer) {
          AC.renderer.setSize(w, h);
        }
        if (AC.planet && (HC.state === STATES.TITLE || HC.state === STATES.HUB)) {
          const offsetX = w > 850 ? 1.4 : (w > 500 ? 0.7 : 0.2);
          AC.planet.position.set(offsetX, 0, 0);
          if (AC.atm) AC.atm.position.copy(AC.planet.position);
        }
      }
      coarsePointerDetected = detectCoarsePointer();
      updateMobileControlsVisibility();
    };

    window.addEventListener('resize', onWindowResizeHandler);
    window.addEventListener('orientationchange', () => {
      setTimeout(onWindowResizeHandler, 100);
      setTimeout(onWindowResizeHandler, 300);
    });

    updateTitleScreenInfo();

    // Immediately set the 3D globe to the player's saved planet!
    const startPlanet = (HC.save && HC.save.planet) || 0;
    setGlobePlanet(startPlanet);

    // Audio: Start title space ambience and main theme music
    if (window.HomecomingAudio) {
      window.HomecomingAudio.setAmbience('title');
      window.HomecomingAudio.startMusic();
    }

    window.Homecoming = {
      isActive: () => HC.active,
      frame,
      updateGlobe,
      getCurrentPlanetIndex: () => (currentGlobeIndex >= 0 ? currentGlobeIndex : ((HC.save && HC.save.planet) || 0)),
      setGlobePlanet,
      setPlanetCompanionsVisible: (v) => { if (planetCompanions) planetCompanions.visible = !!v; },
      startNew: () => begin(true),
      resetProgress,
      states: STATES,
      STATES: STATES,
      terrainHeight: (x, z) => terrainHeight(x, z),
      yAt: (x, z, lift) => yAt(x, z, lift),
      updateAstronaut: (dt) => updateAstronaut(dt),
      audio: window.HomecomingAudio,
      openComms: (tab) => openComms(tab),
      closeComms: () => closeComms(),
      getAudioLogs: () => AUDIO_LOGS,
      getOraLines: () => ORA_LINES,
      physics: PLANET_PHYSICS,
      getActivePhysics,
      getGraphicsConfig: () => currentGraphicsConfig,
      applyGraphicsSettings,
      showTutorial,
      getTutorialSteps: () => TUTORIAL_STEPS,
      getTutorialState: () => tutorialState,
      skipTutorial: () => skipTutorial(),
      getSkyWonder: () => activeSkyWonder,
      getScanCatalog: () => SCAN_CATALOG,
      getSignalFragments: () => SIGNAL_FRAGMENTS,
      startPuzzle: (type, opts) => startPuzzle(type, opts),
      cancelPuzzle: () => cancelPuzzle(),
      getPuzzleState: () => HC.puzzle,
      getPuzzleConfig: (type, missionId, planetId) => getPuzzleConfig(type, missionId, planetId),
      generatePuzzleConfig: (type, planetId, seed, missionId) => generatePuzzleConfig(type, planetId, seed, missionId),
      getContractsPool: () => CONTRACTS_POOL,
      getMilestoneRewards: () => MILESTONE_REWARDS,
      startScan: (target) => startScan(target),
      cancelScan: (reason) => cancelScan(reason),
      triggerScanOrCancel: () => triggerScanOrCancel(),
      getScannerState: () => HC.scanner,
      openExplorersLog: (tab) => openExplorersLog(tab),
      closeExplorersLog: () => closeExplorersLog(),
      getExplorationProgress: (planetId) => getExplorationProgress(planetId),
      claimContract: (cId) => claimContract(cId),
      rotateContracts: () => rotateContracts(),
      unlockPostGame: () => { HC.save.postGameUnlocked = true; persist(); },
      getWorld: () => HC.world,
      buildMainSpacecraft: (planetId, isRepaired) => buildMainSpacecraft(planetId, isRepaired),
      getDeparture: () => window.HomecomingDeparture,
      startTravelTo: (pIdx, isProgression, fromDep) => startTravelTo(pIdx, isProgression, fromDep),
      getSave: () => HC.save,
      getState: () => HC.state,
      setState: (s) => { HC.state = s; },
      persist: () => persist(),
      puzzleSuccess: () => puzzleSuccess(),
      puzzleFail: (txt) => puzzleFail(txt),
      getHC: () => HC,
      getMissions: () => MISSIONS,
      activeObjectIds: () => activeObjectIds(),
      nearestInteractable: () => nearestInteractable(),
      interact: () => interact(),
      completeMission: () => completeMission(),
      loadSave: () => loadSave(),
      showHub: (p) => showHub(p),
      makeWorld: () => makeWorld(),
      waypoint: () => waypoint(),
      updateMarkers: (t) => updateMarkers(t),
      updatePrompt: () => updatePrompt(),
      beginExploration: () => beginExploration(),
      getDrone: () => HC.drone,
      getDroneState: () => HC.drone ? HC.drone.state : null,
      updateDrone: (dt, t) => updateDrone(dt, t),
      emp: () => emp(),
      updateOrbitalView: (state, planetIdx) => updateOrbitalView(state, planetIdx),
      getTouchState: () => touchState,
      getRoverCamState: () => roverCamState,
      getRoverCamConfig: () => roverCamConfig,
      setRoverCamConfig: (cfg) => Object.assign(roverCamConfig, cfg),
      resetRoverCamera: () => resetRoverCamera(),
      notifyRoverCameraManualLook: () => notifyRoverCameraManualLook(),
      updateRoverCamera: (dt, now) => updateRoverCamera(dt, now),
      roverCamStates: ROVER_CAM_STATES,
      resolveClearCheckpointPosition: (x, z, margin) => resolveClearCheckpointPosition(x, z, margin)
    };
  }
  init();
})();

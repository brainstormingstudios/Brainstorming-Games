/* ─────────────────────────────────────────────────────────────────────────────
   PROJECT HOMECOMING — PLAYABLE SPACE DEPARTURE, ASTEROID FLIGHT,
   LIGHT-SPEED JUMP & WORMHOLE TRANSITION SYSTEM
   ───────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const DEPARTURE_PHASES = Object.freeze({
    IDLE: 'IDLE',
    LAUNCH: 'LAUNCH',
    FLIGHT: 'FLIGHT',
    JUMP_READY: 'JUMP_READY',
    LIGHTSPEED: 'LIGHTSPEED',
    WORMHOLE: 'WORMHOLE',
    HANDOFF: 'HANDOFF'
  });

  const DepartureState = {
    active: false,
    phase: DEPARTURE_PHASES.IDLE,
    fromPlanet: null,
    toPlanet: null,
    toPlanetIndex: 0,
    isCampaignProgression: false,
    onComplete: null,
    timer: 0,
    phaseTime: 0,
    flightDuration: 60.0, // Target ~60 seconds of active flight
    flightProgress: 0,
    integrity: 100,
    maxIntegrity: 100,
    speed: 1840,
    evasions: 0,
    collisions: 0,
    jumpArmed: false,
    keys: { w: false, s: false, a: false, d: false },
    shipPos: { x: 0, y: 0 },
    shipVel: { x: 0, y: 0 },
    touchInput: { x: 0, y: 0, active: false }
  };

  // 3D Scene Objects Cache for Departure
  let depGroup = null;
  let shipGroup = null;
  let cockpitGroup = null;
  let asteroidPool = [];
  let starStreaks = null;
  let wormholeGroup = null;
  let thrusterGlowJets = [];
  let liftoffDust = null;
  let spaceDust = null;
  let depSunLight = null;
  let depAmbLight = null;
  let originalCameraPos = null;
  let originalCameraRot = null;

  // Scene Backdrop Cache for Seamless Restoration
  let savedSceneState = {
    planetVisible: true,
    planetPos: null,
    atmVisible: true,
    atmPos: null,
    decorVisible: true,
    moonsVisible: [],
    worldVisible: false,
    sceneFog: null
  };

  // DOM Elements Cache
  let dom = null;

  function getCore() {
    return (typeof window !== 'undefined' && window.ArcadeCore) ? window.ArcadeCore : null;
  }

  function getAudio() {
    return (typeof window !== 'undefined' && window.HomecomingAudio) ? window.HomecomingAudio : null;
  }

  function getGraphicsPreset() {
    try {
      if (typeof window !== 'undefined' && window.Homecoming && typeof window.Homecoming.getGraphicsConfig === 'function') {
        return window.Homecoming.getGraphicsConfig().preset || 'high';
      }
    } catch (_) { }
    return 'high';
  }

  /* ─────────────────────────────────────────────────────────────────────────────
     UI DOM INJECTION
     ───────────────────────────────────────────────────────────────────────────── */
  function ensureDOM() {
    if (dom) return dom;
    if (typeof document === 'undefined') return null;

    let wrap = document.getElementById('hc-departure');
    if (!wrap) {
      wrap = document.createElement('section');
      wrap.id = 'hc-departure';
      wrap.className = 'hc-hidden';
      wrap.innerHTML = `
        <!-- Launch Cinematic HUD -->
        <div id="hc-launch-hud" class="hc-dep-hud">
          <div class="hc-dep-badge">ORBITAL ASCENT</div>
          <div class="hc-dep-title" id="hc-launch-title">ASCENT TRAJECTORY INITIATED</div>
          <div class="hc-dep-sub" id="hc-launch-sub">DEPARTING SURFACE // SUB-ORBITAL VECTOR</div>
          <button class="btn hc-ghost hc-dep-skip" id="hc-skip-launch">Skip Launch</button>
        </div>

        <!-- Asteroid Flight Cockpit HUD (Hidden/Retired - directly transitions from Launch to Outer Space Jump) -->
        <div id="hc-flight-hud" class="hc-dep-hud hc-hidden" style="display: none !important;" aria-hidden="true">
          <div class="hc-flight-top">
            <div class="hc-flight-kicker">ORBITAL ESCAPE CORRIDOR // ASTEROID BELT TRANSIT</div>
            <div class="hc-flight-bar-wrap">
              <div class="hc-flight-bar-fill" id="hc-flight-progress" style="width:0%"></div>
            </div>
            <div class="hc-flight-stats">
              <span id="hc-flight-timer">ESCAPE IN: 60s</span>
              <span id="hc-flight-evasions">EVASIONS: 0</span>
            </div>
          </div>

          <div class="hc-flight-center">
            <div class="hc-flight-crosshair" id="hc-flight-reticle"></div>
            <div class="hc-flight-alert hc-hidden" id="hc-flight-alert">⚠️ PROXIMITY ALERT — COLLISION COURSE</div>
            <div class="hc-flight-toast hc-hidden" id="hc-flight-toast">NEAR MISS — DEFLECTORS HOLDING</div>
          </div>

          <div class="hc-flight-dash">
            <div class="hc-dash-gauge">
              <div class="hc-dash-label">HULL INTEGRITY</div>
              <div class="hc-dash-meter"><div class="hc-dash-fill" id="hc-flight-integrity" style="width:100%"></div></div>
              <div class="hc-dash-val" id="hc-flight-integrity-val">100%</div>
            </div>
            <div class="hc-dash-gauge">
              <div class="hc-dash-label">VELOCITY</div>
              <div class="hc-dash-speed" id="hc-flight-speed">1,840 KM/S</div>
            </div>
            <div class="hc-dash-controls-hint">
              WASD / Arrows to Steer · Dodge Approaching Asteroids
            </div>
          </div>

          <!-- Virtual Touch Area for Mobile -->
          <div id="hc-flight-touch" class="hc-flight-touch-area">
            <div id="hc-flight-stick" class="hc-flight-stick"></div>
          </div>

          <button class="btn hc-ghost hc-dep-skip" id="hc-skip-flight">Skip Flight</button>
        </div>

        <!-- ORA Outer-Space Confirmation & JUMP Button Modal -->
        <div id="hc-jump-hud" class="hc-dep-hud hc-hidden">
          <div class="hc-jump-panel">
            <div class="hc-jump-corner-tl"></div>
            <div class="hc-jump-corner-tr"></div>
            <div class="hc-jump-corner-bl"></div>
            <div class="hc-jump-corner-br"></div>

            <div class="hc-jump-header-row">
              <div class="hc-jump-ora-pill">
                <span class="hc-jump-status-dot"></span>
                <span>ORA // TELEMETRY LINK SYNCHRONIZED</span>
              </div>
              <div class="hc-jump-meta-pills">
                <span class="hc-jump-coord-badge">VEL: 11.2 KM/S</span>
                <span class="hc-jump-sys-badge">RELATIVISTIC LOCK: 100%</span>
              </div>
            </div>

            <div class="hc-jump-title-wrap">
              <div class="hc-jump-kicker">ORBITAL INSERTION COMPLETE // FLIGHT CLEARANCE GRANTED</div>
              <h2 id="hc-jump-heading" class="hc-jump-heading">OUTER SPACE ENTRY CONFIRMED</h2>
            </div>

            <div class="hc-jump-telemetry-grid">
              <div class="hc-telemetry-item">
                <span class="telemetry-label">TRAJECTORY VECTOR</span>
                <span class="telemetry-value"><span class="telemetry-dot dot-green"></span>ESCAPE SECURED</span>
              </div>
              <div class="hc-telemetry-item">
                <span class="telemetry-label">ORBITAL CORRIDOR</span>
                <span class="telemetry-value"><span class="telemetry-dot dot-cyan"></span>PERIMETER CLEAR</span>
              </div>
              <div class="hc-telemetry-item highlight">
                <span class="telemetry-label">HYPERDRIVE COILS</span>
                <span class="telemetry-value"><span class="telemetry-dot dot-orange pulse"></span>PRIMED FOR JUMP</span>
              </div>
            </div>

            <div class="hc-jump-transmission-box">
              <div class="hc-jump-speaker">ORA FLIGHT DIRECTIVE:</div>
              <p id="hc-jump-desc" class="hc-jump-desc">
                Sub-orbital trajectory complete. Relativistic navigational lock acquired. All primary thruster banks primed for light-speed jump.
              </p>
            </div>

            <div class="hc-jump-action">
              <button class="btn hc-jump-btn" id="hc-btn-departure-jump">
                <span class="hc-jump-glow-sweep"></span>
                <span class="hc-jump-bolt">⚡</span>
                <span class="hc-jump-btn-title">ENGAGE LIGHT-SPEED JUMP</span>
                <span class="hc-jump-key"><kbd>SPACE</kbd> / CLICK</span>
              </button>
            </div>
            <div class="hc-jump-subhint">PRESS SPACEBAR OR CLICK TO INITIATE HYPERDRIVE</div>
          </div>
        </div>

        <!-- Hyperspace & Wormhole HUD -->
        <div id="hc-warp-hud" class="hc-dep-hud hc-hidden">
          <div class="hc-warp-card">
            <div class="hc-kicker" id="hc-warp-kicker">HYPERSPACE RELATIVISTIC DRIVE</div>
            <h2 id="hc-warp-title">WARP ACCELERATION</h2>
            <div class="hc-warp-speed" id="hc-warp-speed">299,792 KM/S (WARP 1.0)</div>
            <div class="hc-warp-status" id="hc-warp-status">APPROACHING GRAVITATIONAL WORMHOLE SINGULARITY…</div>
          </div>
          <button class="btn hc-ghost hc-dep-skip" id="hc-skip-warp">Skip Cinematic</button>
        </div>
      `;
      const uiRoot = document.getElementById('homecoming-ui') || document.body;
      uiRoot.appendChild(wrap);
    }

    dom = {
      wrap,
      launchHud: wrap.querySelector('#hc-launch-hud'),
      launchTitle: wrap.querySelector('#hc-launch-title'),
      launchSub: wrap.querySelector('#hc-launch-sub'),
      skipLaunch: wrap.querySelector('#hc-skip-launch'),
      flightHud: wrap.querySelector('#hc-flight-hud'),
      flightProgress: wrap.querySelector('#hc-flight-progress'),
      flightTimer: wrap.querySelector('#hc-flight-timer'),
      flightEvasions: wrap.querySelector('#hc-flight-evasions'),
      flightReticle: wrap.querySelector('#hc-flight-reticle'),
      flightAlert: wrap.querySelector('#hc-flight-alert'),
      flightToast: wrap.querySelector('#hc-flight-toast'),
      flightIntegrity: wrap.querySelector('#hc-flight-integrity'),
      flightIntegrityVal: wrap.querySelector('#hc-flight-integrity-val'),
      flightSpeed: wrap.querySelector('#hc-flight-speed'),
      flightTouch: wrap.querySelector('#hc-flight-touch'),
      flightStick: wrap.querySelector('#hc-flight-stick'),
      skipFlight: wrap.querySelector('#hc-skip-flight'),
      jumpHud: wrap.querySelector('#hc-jump-hud'),
      jumpHeading: wrap.querySelector('#hc-jump-heading'),
      jumpDesc: wrap.querySelector('#hc-jump-desc'),
      btnJump: wrap.querySelector('#hc-btn-departure-jump') || wrap.querySelector('#hc-btn-jump'),
      warpHud: wrap.querySelector('#hc-warp-hud'),
      warpTitle: wrap.querySelector('#hc-warp-title'),
      warpSpeed: wrap.querySelector('#hc-warp-speed'),
      warpStatus: wrap.querySelector('#hc-warp-status'),
      skipWarp: wrap.querySelector('#hc-skip-warp')
    };

    // Event Bindings
    const bindTouchAction = (btn, action) => {
      if (!btn) return;
      btn.onclick = () => action();
      btn.ontouchstart = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        action();
      };
    };
    bindTouchAction(dom.skipLaunch, () => skipCurrentPhase());
    bindTouchAction(dom.skipFlight, () => skipCurrentPhase());
    bindTouchAction(dom.skipWarp, () => skipCurrentPhase());
    bindTouchAction(dom.btnJump, () => engageJump());

    // Mobile Virtual Joystick Steering
    if (dom.flightTouch) {
      let touchActive = false;
      let startX = 0, startY = 0;
      const onTouchStart = (e) => {
        if (e && e.cancelable && e.preventDefault) e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        if (!touch) return;
        touchActive = true;
        startX = touch.clientX;
        startY = touch.clientY;
        DepartureState.touchInput.active = true;
      };
      const onTouchMove = (e) => {
        if (!touchActive) return;
        if (e && e.cancelable && e.preventDefault) e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        if (!touch) return;
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        const maxDist = 48;
        const clampedX = Math.max(-maxDist, Math.min(maxDist, dx));
        const clampedY = Math.max(-maxDist, Math.min(maxDist, dy));
        DepartureState.touchInput.x = clampedX / maxDist;
        DepartureState.touchInput.y = clampedY / maxDist;
        if (dom.flightStick) {
          dom.flightStick.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
        }
      };
      const onTouchEnd = () => {
        touchActive = false;
        DepartureState.touchInput.active = false;
        DepartureState.touchInput.x = 0;
        DepartureState.touchInput.y = 0;
        if (dom.flightStick) {
          dom.flightStick.style.transform = 'translate(0px, 0px)';
        }
      };
      dom.flightTouch.addEventListener('touchstart', onTouchStart, { passive: false });
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd, { passive: false });
      window.addEventListener('touchcancel', onTouchEnd, { passive: false });
      window.addEventListener('blur', onTouchEnd);
    }

    return dom;
  }

  /* ─────────────────────────────────────────────────────────────────────────────
     3D ASSETS: SPACECRAFT, COCKPIT, ASTEROIDS, STARS & WORMHOLE
     ───────────────────────────────────────────────────────────────────────────── */
  function getSpacecraftModel(planetId = 'mars', isRepaired = true) {
    const root = new THREE.Group();
    root.name = 'departure-spacecraft-root';

    const inner = new THREE.Group();
    inner.name = 'spacecraft-orientation-wrapper';
    root.add(inner);

    let baseShip = null;
    if (typeof window !== 'undefined' && window.Homecoming && typeof window.Homecoming.buildMainSpacecraft === 'function') {
      try {
        baseShip = window.Homecoming.buildMainSpacecraft(planetId, isRepaired);
      } catch (_) { }
    }

    if (baseShip) {
      // buildMainSpacecraft has fuselage along X with nose at -5.4, engines at +5.5.
      // Rotate by -Math.PI / 2 around Y so nose points to -Z (Forward) and engines point to +Z (Rear).
      baseShip.rotation.y = -Math.PI / 2;
      // Retract/hide surface landing gear legs for flight
      if (typeof baseShip.traverse === 'function') {
        baseShip.traverse(child => {
          if (child && child.geometry && child.geometry instanceof THREE.CylinderGeometry) {
            const p = child.geometry.parameters;
            if (p && ((p.radiusTop <= 0.25 && p.height >= 2.0) || (p.radiusTop <= 0.55 && p.height <= 0.4))) {
              child.visible = false;
            }
          }
        });
      }
      inner.add(baseShip);
    } else {
      // Standalone high-fidelity model (used as standalone fallback and in test environments)
      const hullMat = new THREE.MeshStandardMaterial({
        color: isRepaired ? 0xd0d5db : 0x483f3b,
        roughness: 0.45,
        metalness: 0.5
      });
      const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 8.5, 16), hullMat);
      fuselage.rotation.x = Math.PI / 2;
      fuselage.position.set(0, 1.2, 0);

      const nose = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.6, 16), hullMat);
      nose.rotation.x = -Math.PI / 2;
      nose.position.set(0, 1.2, -6.05);

      const canopyMat = new THREE.MeshStandardMaterial({
        color: 0x163448,
        roughness: 0.2,
        emissive: 0x2288bb
      });
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat);
      canopy.scale.set(0.85, 0.65, 2.2);
      canopy.position.set(0, 2.1, -2.2);

      const wingMat = new THREE.MeshStandardMaterial({ color: 0x32353a, roughness: 0.6 });
      const leftWing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 3.8), wingMat);
      leftWing.position.set(-2.8, 1.0, 1.2);
      leftWing.rotation.y = 0.35;
      const rightWing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 3.8), wingMat);
      rightWing.position.set(2.8, 1.0, 1.2);
      rightWing.rotation.y = -0.35;

      inner.add(fuselage, nose, canopy, leftWing, rightWing);
    }

    // Navigation Strobe Lights on Wingtips
    const strobes = [];
    if (THREE.Mesh && THREE.SphereGeometry && THREE.MeshBasicMaterial) {
      const redMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
      const grnMat = new THREE.MeshBasicMaterial({ color: 0x22ff44 });
      const sGeo = new THREE.SphereGeometry(0.12, 8, 8);
      const port = new THREE.Mesh(sGeo, redMat); port.position.set(-3.8, 1.2, 1.5);
      const stbd = new THREE.Mesh(sGeo, grnMat); stbd.position.set(3.8, 1.2, 1.5);
      inner.add(port, stbd);
      strobes.push(port, stbd);
    }
    root.userData.strobes = strobes;

    // Twin Ion Exhaust Flame Jets firing backwards along +Z
    const thrusterJets = [];
    [-1.1, 1.1].forEach(xOff => {
      const jetGeo = new THREE.ConeGeometry(0.75, 4.8, 12);
      if (typeof jetGeo.rotateX === 'function') jetGeo.rotateX(-Math.PI / 2);
      if (typeof jetGeo.translate === 'function') jetGeo.translate(0, 0, 2.4);
      const jetMat = new THREE.MeshBasicMaterial({
        color: 0x4df0ff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending
      });
      const jet = new THREE.Mesh(jetGeo, jetMat);
      jet.position.set(xOff, 1.2, 5.5);
      inner.add(jet);
      thrusterJets.push(jet);
    });
    root.userData.thrusterJets = thrusterJets;

    return root;
  }

  function buildCockpitModel() {
    const cockpit = new THREE.Group();
    cockpit.name = 'departure-cockpit';

    // 1. Sleek Carbon Canopy Frame Struts
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.7, metalness: 0.4 });
    const consoleMat = new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x06121d, roughness: 0.08, transparent: true, opacity: 0.2 });

    // Center canopy arch & side A-pillar framing
    const archGeo = new THREE.TorusGeometry(1.45, 0.05, 8, 24, Math.PI);
    const arch = new THREE.Mesh(archGeo, frameMat);
    arch.position.set(0, 0.22, -1.0);
    cockpit.add(arch);

    // Left and right angled viewport A-pillars
    const pillarGeo = new THREE.BoxGeometry(0.08, 1.5, 0.08);
    const leftPillar = new THREE.Mesh(pillarGeo, frameMat);
    leftPillar.position.set(-1.1, 0.3, -1.0);
    leftPillar.rotation.z = -0.32;
    const rightPillar = new THREE.Mesh(pillarGeo, frameMat);
    rightPillar.position.set(1.1, 0.3, -1.0);
    rightPillar.rotation.z = 0.32;
    cockpit.add(leftPillar, rightPillar);

    // Forward viewport glass
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 1.3, 16, 1, true, 0, Math.PI), glassMat);
    glass.rotation.z = Math.PI / 2;
    glass.position.set(0, 0.35, -1.1);
    cockpit.add(glass);

    // 2. Angled Instrument Dashboard Console
    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.0), consoleMat);
    dash.position.set(0, -0.68, -0.92);
    dash.rotation.x = 0.32;
    cockpit.add(dash);

    // Glowing telemetry screens on dashboard
    const screenMatLeft = new THREE.MeshBasicMaterial({ color: 0x2cd5ff });
    const screen1 = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.24), screenMatLeft);
    screen1.position.set(-0.65, -0.6, -0.8);
    screen1.rotation.x = -0.4;

    const screenMatRight = new THREE.MeshBasicMaterial({ color: 0x2ee5a2 });
    const screen2 = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.24), screenMatRight);
    screen2.position.set(0.65, -0.6, -0.8);
    screen2.rotation.x = -0.4;
    cockpit.add(screen1, screen2);

    // 3. Visible forward aerospike nose cone outside viewport (matching ship exterior!)
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xc8ced6, roughness: 0.4, metalness: 0.3 });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.38, 2.0, 12), noseMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, -0.28, -2.5);
    cockpit.add(nose);

    // Small aerodynamic forward canards
    const canardMat = new THREE.MeshStandardMaterial({ color: 0x333842, roughness: 0.5 });
    const canardL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.4), canardMat);
    canardL.position.set(-0.65, -0.32, -2.2);
    canardL.rotation.y = 0.2;
    const canardR = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.4), canardMat);
    canardR.position.set(0.65, -0.32, -2.2);
    canardR.rotation.y = -0.2;
    cockpit.add(canardL, canardR);

    return cockpit;
  }

  function buildSpaceDust(count = 220) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 28;
      pos[i * 3 + 2] = -Math.random() * 140;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8fe7ff,
      size: 0.4,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    return new THREE.Points(geo, mat);
  }

  function buildAsteroidPool(count = 24) {
    const pool = [];
    const mat = new THREE.MeshStandardMaterial({
      color: 0x5a544e,
      roughness: 0.88,
      flatShading: true
    });

    for (let i = 0; i < count; i++) {
      // Irregular, randomized low-poly asteroid rock
      const radius = 1.0 + Math.random() * 2.8;
      const geo = new THREE.DodecahedronGeometry(radius, 1);
      const posAttr = geo.attributes.position;
      if (posAttr) {
        for (let j = 0; j < posAttr.count; j++) {
          const vx = posAttr.getX(j);
          const vy = posAttr.getY(j);
          const vz = posAttr.getZ(j);
          const noise = 0.8 + Math.random() * 0.4;
          posAttr.setXYZ(j, vx * noise, vy * noise, vz * noise);
        }
      }
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.userData = {
        active: false,
        speed: 80 + Math.random() * 50,
        rotSpeed: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2),
        radius: radius * 1.1,
        evaded: false
      };
      pool.push(mesh);
    }
    return pool;
  }

  function buildHyperspaceStreaks(count = 700) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 6); // 2 vertices per line streak
    const colors = new Float32Array(count * 6);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 3.0 + Math.random() * 32.0;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      const z = -Math.random() * 220;
      const len = 4.0 + Math.random() * 16.0;

      // Start vertex
      positions[i * 6] = x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z;

      // End vertex (stretched backward along Z)
      positions[i * 6 + 3] = x;
      positions[i * 6 + 4] = y;
      positions[i * 6 + 5] = z + len;

      // Cyan to white streak color
      const isCyan = Math.random() > 0.4;
      colors[i * 6] = isCyan ? 0.4 : 0.95;
      colors[i * 6 + 1] = isCyan ? 0.85 : 0.95;
      colors[i * 6 + 2] = 1.0;

      colors[i * 6 + 3] = 0.2;
      colors[i * 6 + 4] = 0.5;
      colors[i * 6 + 5] = 0.8;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
    return new THREE.LineSegments(geo, mat);
  }

  function buildWormholeStreamlines(count = 160) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 6);
    const colors = new Float32Array(count * 6);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      // Keep clear radius in the center so the ship and event horizon are unobstructed
      const dist = 14.0 + Math.random() * 32.0;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      const z = -Math.random() * 160.0;
      const len = 6.0 + Math.random() * 18.0;

      positions[i * 6] = x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z;

      positions[i * 6 + 3] = x;
      positions[i * 6 + 4] = y;
      positions[i * 6 + 5] = z + len;

      // Color: restrained cyan or warm gold to match engines and accretion disk
      const isCyan = (i % 3 === 0);
      if (isCyan) {
        colors[i * 6] = 0.2; colors[i * 6 + 1] = 0.8; colors[i * 6 + 2] = 1.0;
        colors[i * 6 + 3] = 0.05; colors[i * 6 + 4] = 0.3; colors[i * 6 + 5] = 0.7;
      } else {
        colors[i * 6] = 1.0; colors[i * 6 + 1] = 0.7; colors[i * 6 + 2] = 0.2;
        colors[i * 6 + 3] = 0.6; colors[i * 6 + 4] = 0.2; colors[i * 6 + 5] = 0.05;
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });
    return new THREE.LineSegments(geo, mat);
  }

  function buildWormholeVortex(preset = 'high') {
    const group = new THREE.Group();
    group.name = 'wormhole-vortex';

    const isLow = preset === 'low';

    // ─── 1. Volumetric Tapered Accretion Tunnel (Throat Funnel) ───
    // An elongated funnel stretching down -Z from the outer mouth (radius 36)
    // to the event horizon throat (radius 4.2 at z = -72).
    const funnelGeo = new THREE.CylinderGeometry(4.2, 36.0, 72.0, isLow ? 24 : 36, isLow ? 4 : 8, true);
    const funnelMat = new THREE.MeshBasicMaterial({
      color: 0xff5511,
      wireframe: true,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const funnel = new THREE.Mesh(funnelGeo, funnelMat);
    funnel.rotation.x = -Math.PI / 2; // Aligns along -Z
    funnel.position.z = -36.0;
    group.add(funnel);
    group.userData.funnel = funnel;

    // ─── 2. Multi-Depth Accretion Rings with Gravitational Lensing Arcs ───
    // Instead of flat concentric 2D rings at z=0, rings are distributed along the tunnel depth
    // with independent radii, inclinations, rotational speeds, and directional flow.
    const rings = [];
    const ringSpecs = [
      // Outer massive accretion disk (entrance threshold)
      { inner: 28.0, outer: 48.0, z: 0.0, col: 0xff500a, rotSpeed: 0.22, opacity: 0.65, tiltX: 0.0, tiltY: 0.0 },
      // Gravitational lensing bent halo (tilted around X to simulate Einstein ring lensing!)
      { inner: 22.0, outer: 40.0, z: -4.0, col: 0xff8818, rotSpeed: -0.16, opacity: 0.50, tiltX: 0.32, tiltY: 0.12 },
      // Intermediate churning accretion band
      { inner: 16.0, outer: 30.0, z: -14.0, col: 0xffaa22, rotSpeed: 0.35, opacity: 0.70, tiltX: -0.15, tiltY: 0.20 },
      // Deeper funnel compression ring
      { inner: 11.0, outer: 22.0, z: -28.0, col: 0xffcc33, rotSpeed: -0.42, opacity: 0.75, tiltX: 0.18, tiltY: -0.14 },
      // Accelerated high-energy inner throat ring
      { inner: 7.0, outer: 15.0, z: -44.0, col: 0xffe055, rotSpeed: 0.65, opacity: 0.85, tiltX: -0.08, tiltY: 0.10 },
      // Throat photon sphere boundary with electric cyan highlight
      { inner: 4.5, outer: 9.5, z: -60.0, col: 0x8fe7ff, rotSpeed: -0.85, opacity: 0.90, tiltX: 0.0, tiltY: 0.0 }
    ];

    ringSpecs.forEach(spec => {
      const geo = new THREE.RingGeometry(spec.inner, spec.outer, isLow ? 32 : 48);
      const mat = new THREE.MeshBasicMaterial({
        color: spec.col,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: spec.opacity,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.position.z = spec.z;
      ring.rotation.x = spec.tiltX;
      ring.rotation.y = spec.tiltY;
      ring.userData = {
        rotSpeed: spec.rotSpeed,
        baseOpacity: spec.opacity,
        baseZ: spec.z,
        tiltX: spec.tiltX,
        tiltY: spec.tiltY
      };
      rings.push(ring);
      group.add(ring);
    });
    group.userData.rings = rings;

    // ─── 3. Segmented Gravitational Spiral Arcs ───
    // Gives active spiral arms appearance (breaks up uniform circular target look!)
    const arcs = [];
    const arcCount = isLow ? 4 : 8;
    for (let i = 0; i < arcCount; i++) {
      const arcAngle = (i / arcCount) * Math.PI * 2;
      const arcGeo = new THREE.RingGeometry(14 + (i % 3) * 6, 26 + (i % 3) * 6, isLow ? 16 : 24, 1, arcAngle, Math.PI * 0.75);
      const arcMat = new THREE.MeshBasicMaterial({
        color: (i % 2 === 0) ? 0xffa428 : 0xff7014,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending
      });
      const arc = new THREE.Mesh(arcGeo, arcMat);
      arc.position.z = -8.0 - (i % 4) * 6.0;
      arc.userData = { rotSpeed: (i % 2 === 0 ? 0.45 : -0.38) * (1.0 + i * 0.08) };
      arcs.push(arc);
      group.add(arc);
    }
    group.userData.arcs = arcs;

    // ─── 4. Luminous Photon Sphere Rim (Glowing Singularity Horizon) ───
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const photonRim = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.45, 8, 36), rimMat);
    photonRim.position.z = -70.0;
    group.add(photonRim);
    group.userData.photonRim = photonRim;

    // ─── 5. Central Gravitational Event Horizon Void (Pitch Black Throat) ───
    // Dark central region creating maximum contrast with illuminated outer rings
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const voidSphere = new THREE.Mesh(new THREE.SphereGeometry(4.4, 24, 24), voidMat);
    voidSphere.position.z = -72.0;
    group.add(voidSphere);
    group.userData.voidSphere = voidSphere;

    // ─── 6. Relativistic Inward-Spiraling Accretion Filaments (Particles) ───
    const particleCount = isLow ? 140 : 380;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(particleCount * 3);
    const pColors = new Float32Array(particleCount * 3);
    const particleData = [];

    for (let i = 0; i < particleCount; i++) {
      const radius = 5.0 + Math.random() * 38.0;
      const theta = Math.random() * Math.PI * 2;
      const depthZ = -Math.random() * 68.0;

      pPos[i * 3] = Math.cos(theta) * radius;
      pPos[i * 3 + 1] = Math.sin(theta) * radius;
      pPos[i * 3 + 2] = depthZ;

      // Color gradient: warm orange/gold outer, electric cyan inner
      const normR = radius / 40.0;
      if (normR < 0.28) {
        pColors[i * 3] = 0.55;
        pColors[i * 3 + 1] = 0.92;
        pColors[i * 3 + 2] = 1.0;
      } else if (normR < 0.6) {
        pColors[i * 3] = 1.0;
        pColors[i * 3 + 1] = 0.85;
        pColors[i * 3 + 2] = 0.25;
      } else {
        pColors[i * 3] = 1.0;
        pColors[i * 3 + 1] = 0.42;
        pColors[i * 3 + 2] = 0.08;
      }

      particleData.push({
        radius,
        theta,
        z: depthZ,
        speedTheta: (0.4 + Math.random() * 1.2) * (Math.random() > 0.4 ? 1 : -1),
        speedZ: 14.0 + Math.random() * 22.0
      });
    }

    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3));

    const pMat = new THREE.PointsMaterial({
      size: isLow ? 0.9 : 1.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const particles = new THREE.Points(pGeo, pMat);
    group.add(particles);
    group.userData.particles = particles;
    group.userData.particleData = particleData;

    return group;
  }

  /* ─────────────────────────────────────────────────────────────────────────────
     DEPARTURE STATE MACHINE & SCENE CONTROLLERS
     ───────────────────────────────────────────────────────────────────────────── */

  function start(options = {}) {
    if (DepartureState.active) return;
    const core = getCore();
    if (!core || !core.scene || !core.cam) {
      console.warn('DepartureSystem: ArcadeCore not ready, bypassing departure.');
      if (typeof options.onComplete === 'function') options.onComplete();
      return;
    }

    DepartureState.active = true;
    DepartureState.fromPlanet = options.fromPlanet || { id: 'mars', name: 'Mars' };
    DepartureState.toPlanet = options.toPlanet || { id: 'phobos', name: 'Phobos Station' };
    DepartureState.toPlanetIndex = options.toPlanetIndex || 1;
    DepartureState.isCampaignProgression = !!options.isCampaignProgression;
    DepartureState.onComplete = options.onComplete || null;
    DepartureState.timer = 0;
    DepartureState.phaseTime = 0;
    DepartureState.flightProgress = 0;
    DepartureState.integrity = 100;
    DepartureState.evasions = 0;
    DepartureState.collisions = 0;
    DepartureState.jumpArmed = false;
    DepartureState.shipPos = { x: 0, y: 0 };
    DepartureState.shipVel = { x: 0, y: 0 };

    const lp = options.launchPos || (DepartureState.fromPlanet && DepartureState.fromPlanet.launch) || [-2, -2];
    DepartureState.launchPos = {
      x: lp[0],
      y: (options.launchY !== undefined ? options.launchY : 0),
      z: lp[1]
    };

    // Hide any surface spacecraft and astronaut inside Homecoming world to prevent duplicate ship or floating astronaut
    if (typeof window !== 'undefined' && window.Homecoming) {
      const w = window.Homecoming.getWorld ? window.Homecoming.getWorld() : null;
      if (w) {
        w.traverse(obj => {
          if (obj.name && obj.name.startsWith('main-spacecraft')) {
            DepartureState.launchPos.x = obj.position.x;
            DepartureState.launchPos.y = obj.position.y;
            DepartureState.launchPos.z = obj.position.z;
            obj.visible = false;
          }
        });
      }
      const a = window.Homecoming.getAstronaut ? window.Homecoming.getAstronaut() : null;
      if (a && a.group) a.group.visible = false;
    }

    ensureDOM();

    // Cache original camera transform
    originalCameraPos = core.cam.position.clone();
    originalCameraRot = core.cam.rotation.clone();

    // Save backdrop state so we can restore it cleanly at handoff
    if (core.planet) {
      savedSceneState.planetVisible = core.planet.visible;
      savedSceneState.planetPos = core.planet.position.clone();
      core.planet.visible = false;
    }
    if (core.atm) {
      savedSceneState.atmVisible = core.atm.visible;
      savedSceneState.atmPos = core.atm.position.clone();
      // Crucial: hide additive atmosphere immediately to prevent white blown-out glare
      core.atm.visible = false;
    }
    if (core.decor) {
      savedSceneState.decorVisible = core.decor.visible;
      core.decor.visible = false;
    }
    if (core.moons) {
      savedSceneState.moonsVisible = core.moons.map(m => (m && m.o) ? m.o.visible : true);
      core.moons.forEach(m => { if (m && m.o) m.o.visible = false; });
    }
    if (core.scene) {
      savedSceneState.sceneFog = core.scene.fog;
    }

    // Suppress planet companions (e.g. giant Mars in Phobos sky, Jupiter on Europa, Saturn on Titan)
    if (typeof window !== 'undefined' && window.Homecoming && window.Homecoming.setPlanetCompanionsVisible) {
      window.Homecoming.setPlanetCompanionsVisible(false);
    }
    if (core && core.scene && typeof core.scene.traverse === 'function') {
      core.scene.traverse((obj) => {
        if (obj && (obj.name === 'planet-companions' || (obj.parent && obj.parent.name === 'planet-companions') || obj.userData.isStation || obj.userData.isJupiter || obj.userData.isMoon || obj.userData.isAsteroidBelt)) {
          obj.visible = false;
        }
      });
    }

    // Create Root Departure 3D Group
    if (depGroup && depGroup.parent) depGroup.parent.remove(depGroup);
    depGroup = new THREE.Group();
    depGroup.name = 'departure-root-group';
    core.scene.add(depGroup);

    // Add crisp lighting inside depGroup
    if (typeof THREE.DirectionalLight === 'function') {
      depSunLight = new THREE.DirectionalLight(0xfff3e6, 2.0);
      depSunLight.position.set(-15, 14, 12);
      depGroup.add(depSunLight);
    }
    if (typeof THREE.AmbientLight === 'function') {
      depAmbLight = new THREE.AmbientLight(0x141a28, 0.75);
      depGroup.add(depAmbLight);
    }

    // Check if on planetary surface or launching from hub
    const isOnSurface = (options.fromSurface !== undefined) ? !!options.fromSurface : (!!(window.Homecoming && window.Homecoming.isActive && window.Homecoming.isActive()));
    DepartureState.isOnSurface = isOnSurface;
    enterPhase(DEPARTURE_PHASES.LAUNCH);
  }

  function enterPhase(newPhase) {
    DepartureState.phase = newPhase;
    DepartureState.phaseTime = 0;
    const core = getCore();
    const audio = getAudio();
    const d = ensureDOM();
    if (!d) return;

    // Reset UI visibility
    d.wrap.classList.remove('hc-hidden');
    d.launchHud.classList.add('hc-hidden');
    d.flightHud.classList.add('hc-hidden');
    d.jumpHud.classList.add('hc-hidden');
    d.warpHud.classList.add('hc-hidden');

    switch (newPhase) {
      case DEPARTURE_PHASES.LAUNCH: {
        d.launchHud.classList.remove('hc-hidden');
        if (DepartureState.isOnSurface) {
          if (core && core.planet) core.planet.visible = false;
          if (core && core.atm) core.atm.visible = false;
          d.launchTitle.textContent = 'ASCENT TRAJECTORY INITIATED';
          d.launchSub.textContent = `DEPARTING ${DepartureState.fromPlanet.name.toUpperCase()} // SUB-ORBITAL ASCENT`;

          // Surface liftoff dust effect
          const dustGeo = new THREE.BufferGeometry();
          const dCount = 140;
          const dPos = new Float32Array(dCount * 3);
          for (let i = 0; i < dCount; i++) {
            const ang = Math.random() * Math.PI * 2;
            const r = 2.0 + Math.random() * 5.5;
            dPos[i * 3] = Math.cos(ang) * r;
            dPos[i * 3 + 1] = Math.random() * 0.3;
            dPos[i * 3 + 2] = Math.sin(ang) * r;
          }
          dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
          const dustMat = new THREE.PointsMaterial({ color: 0xd99a6c, size: 0.4, transparent: true, opacity: 0.7 });
          liftoffDust = new THREE.Points(dustGeo, dustMat);
          depGroup.add(liftoffDust);
        } else {
          // Orbital Dock Departure: hide planet & atmosphere to prevent clipping glitches
          if (core && core.planet) core.planet.visible = false;
          if (core && core.atm) core.atm.visible = false;
          if (typeof window !== 'undefined' && window.Homecoming && window.Homecoming.getWorld) {
            const w = window.Homecoming.getWorld();
            if (w) w.visible = false;
          }
          d.launchTitle.textContent = 'ORBITAL DOCK DISENGAGED';
          d.launchSub.textContent = `DEPARTING ${DepartureState.fromPlanet.name.toUpperCase()} // ORBITAL DEPARTURE VECTOR`;
        }

        if (audio) {
          audio.play('ship_ignition');
          audio.stopRoverEngine();
          audio.stopSuitBreathing();
        }

        const lx = (DepartureState.isOnSurface && DepartureState.launchPos) ? DepartureState.launchPos.x : 0;
        const ly = (DepartureState.isOnSurface && DepartureState.launchPos) ? DepartureState.launchPos.y : 0;
        const lz = (DepartureState.isOnSurface && DepartureState.launchPos) ? DepartureState.launchPos.z : 0;

        // Spawn spacecraft properly oriented (nose along -Z, engines at +Z)
        if (shipGroup && shipGroup.parent) shipGroup.parent.remove(shipGroup);
        shipGroup = getSpacecraftModel(DepartureState.fromPlanet.id, true);
        shipGroup.position.set(lx, ly, lz);
        shipGroup.rotation.set(0, 0, 0);
        depGroup.add(shipGroup);

        if (liftoffDust) {
          liftoffDust.position.set(lx, ly, lz);
        }

        thrusterGlowJets = shipGroup.userData.thrusterJets || [];

        // Camera setup for launch cinematic
        if (core && core.cam) {
          core.cam.fov = 45;
          core.cam.updateProjectionMatrix();
          if (DepartureState.isOnSurface) {
            core.cam.position.set(lx - 10, ly + 3.2, lz + 16);
            core.cam.lookAt(lx, ly + 2.5, lz);
          } else {
            core.cam.position.set(-9, 3.8, 14);
            core.cam.lookAt(0, 1.8, -10);
          }
        }
        break;
      }

      case DEPARTURE_PHASES.FLIGHT: {
        d.flightHud.classList.remove('hc-hidden');
        d.flightProgress.style.width = '0%';
        d.flightTimer.textContent = 'ESCAPE IN: 60s';
        d.flightIntegrity.style.width = '100%';
        d.flightIntegrityVal.textContent = '100%';
        d.flightSpeed.textContent = '1,840 KM/S';
        d.flightEvasions.textContent = 'EVASIONS: 0';

        if (audio) {
          audio.setAmbience('space_travel');
          audio.play('departure');
        }

        // Ensure background is pure outer space void: hide planet, atmosphere, moons, world, fog
        if (core) {
          if (core.planet) core.planet.visible = false;
          if (core.atm) core.atm.visible = false;
          if (core.decor) core.decor.visible = false;
          if (core.moons) core.moons.forEach(m => { if (m && m.o) m.o.visible = false; });
          if (core.scene) core.scene.fog = null;
        }
        if (typeof window !== 'undefined' && window.Homecoming && window.Homecoming.getWorld) {
          const w = window.Homecoming.getWorld();
          if (w) w.visible = false;
        }

        // Clear previous meshes from depGroup
        while (depGroup.children.length > 0) {
          depGroup.remove(depGroup.children[0]);
        }

        // Re-add lights to depGroup
        if (typeof THREE.DirectionalLight === 'function') {
          depSunLight = new THREE.DirectionalLight(0xfff3e6, 2.0);
          depSunLight.position.set(-15, 14, 12);
          depGroup.add(depSunLight);
        }
        if (typeof THREE.AmbientLight === 'function') {
          depAmbLight = new THREE.AmbientLight(0x141a28, 0.75);
          depGroup.add(depAmbLight);
        }

        // Add First-Person Cockpit Model
        cockpitGroup = buildCockpitModel();
        depGroup.add(cockpitGroup);

        // Add High-Speed Space Dust Particles (1,840 KM/S sensation)
        spaceDust = buildSpaceDust(getGraphicsPreset() === 'low' ? 100 : 220);
        depGroup.add(spaceDust);

        // Add Asteroid Pool
        const pCount = getGraphicsPreset() === 'low' ? 14 : 24;
        asteroidPool = buildAsteroidPool(pCount);
        asteroidPool.forEach(a => depGroup.add(a));

        // Camera locked inside cockpit
        if (core && core.cam) {
          core.cam.position.set(0, 0, 0);
          core.cam.rotation.set(0, 0, 0);
          core.cam.fov = 55;
          core.cam.updateProjectionMatrix();
        }
        break;
      }

      case DEPARTURE_PHASES.JUMP_READY: {
        d.jumpHud.classList.remove('hc-hidden');
        d.jumpHeading.textContent = 'OUTER SPACE ENTRY CONFIRMED';
        d.jumpDesc.textContent = 'Sub-orbital trajectory complete. Relativistic navigational lock acquired. All primary thruster banks primed for light-speed jump.';
        DepartureState.jumpArmed = true;

        if (audio) {
          audio.setAmbience('space_travel');
          audio.play('ora_chime');
          audio.speak('Sub-orbital clear. Outer space perimeter established. Ready for light-speed jump on your command.', 'ora');
        }

        // Ensure backdrop remains pure dark space: hide planet, atmosphere, moons, world, fog
        if (core) {
          if (core.planet) core.planet.visible = false;
          if (core.atm) core.atm.visible = false;
          if (core.decor) core.decor.visible = false;
          if (core.moons) core.moons.forEach(m => { if (m && m.o) m.o.visible = false; });
          if (core.scene) core.scene.fog = null;
        }
        if (typeof window !== 'undefined' && window.Homecoming && window.Homecoming.getWorld) {
          const w = window.Homecoming.getWorld();
          if (w) w.visible = false;
        }

        // Clean up any surface liftoff dust
        if (liftoffDust && liftoffDust.parent) {
          liftoffDust.parent.remove(liftoffDust);
          liftoffDust = null;
        }

        // Hide asteroid pool and cockpit if any existed
        asteroidPool.forEach(a => { a.visible = false; });
        if (cockpitGroup && cockpitGroup.parent) {
          cockpitGroup.parent.remove(cockpitGroup);
          cockpitGroup = null;
        }

        // Spawn or reposition spacecraft model in 3rd person cruising pose
        if (!shipGroup || !shipGroup.parent) {
          shipGroup = getSpacecraftModel(DepartureState.fromPlanet.id, true);
          depGroup.add(shipGroup);
        }
        shipGroup.position.set(0, 0, 0);
        shipGroup.rotation.set(0, 0, 0);
        shipGroup.visible = true;

        thrusterGlowJets = shipGroup.userData.thrusterJets || [];
        thrusterGlowJets.forEach(jet => {
          jet.scale.set(1.0, 1.0, 1.2);
        });

        // Add subtle cosmic motes
        if (!spaceDust) {
          spaceDust = buildSpaceDust(getGraphicsPreset() === 'low' ? 60 : 140);
          depGroup.add(spaceDust);
        }
        spaceDust.visible = true;

        // Ensure lighting inside depGroup
        if (!depSunLight || !depSunLight.parent) {
          if (typeof THREE.DirectionalLight === 'function') {
            depSunLight = new THREE.DirectionalLight(0xfff3e6, 2.0);
            depSunLight.position.set(-15, 14, 12);
            depGroup.add(depSunLight);
          }
        }
        if (!depAmbLight || !depAmbLight.parent) {
          if (typeof THREE.AmbientLight === 'function') {
            depAmbLight = new THREE.AmbientLight(0x141a28, 0.75);
            depGroup.add(depAmbLight);
          }
        }

        // Cinematic 3rd-person camera viewing ship against deep space
        if (core && core.cam) {
          core.cam.fov = 48;
          core.cam.updateProjectionMatrix();
          core.cam.position.set(2.4, 1.2, 9.2);
          core.cam.lookAt(0, 0.7, -3.0);
        }
        break;
      }

      case DEPARTURE_PHASES.LIGHTSPEED: {
        d.warpHud.classList.remove('hc-hidden');
        d.warpTitle.textContent = 'LIGHT-SPEED ACCELERATION';
        d.warpSpeed.textContent = '299,792 KM/S (WARP 1.0)';
        d.warpStatus.textContent = 'ENGAGING HYPERSPACE DRIVE… RELATIVISTIC STREAMS ACTIVE';

        if (audio) {
          audio.play('jump_charge');
          setTimeout(() => { if (DepartureState.active) audio.play('lightspeed_jump'); }, 500);
        }

        // Remove cockpit and attach full spacecraft in 3rd-person chase view
        while (depGroup.children.length > 0) {
          depGroup.remove(depGroup.children[0]);
        }

        // Re-add lights
        if (typeof THREE.DirectionalLight === 'function') {
          depSunLight = new THREE.DirectionalLight(0xfff3e6, 2.0);
          depSunLight.position.set(-15, 14, 12);
          depGroup.add(depSunLight);
        }
        if (typeof THREE.AmbientLight === 'function') {
          depAmbLight = new THREE.AmbientLight(0x141a28, 0.75);
          depGroup.add(depAmbLight);
        }

        shipGroup = getSpacecraftModel(DepartureState.fromPlanet.id, true);
        shipGroup.position.set(0, 0, 0);
        shipGroup.rotation.set(0, 0, 0); // Forward along -Z!
        depGroup.add(shipGroup);

        thrusterGlowJets = shipGroup.userData.thrusterJets || [];

        // Flare engine plumes to hyperdrive size
        thrusterGlowJets.forEach(jet => {
          jet.scale.set(1.8, 1.8, 2.8);
        });

        // Add 800+ Streaming Hyperspace Light Streaks
        const streakCount = getGraphicsPreset() === 'low' ? 350 : 800;
        starStreaks = buildHyperspaceStreaks(streakCount);
        depGroup.add(starStreaks);

        // Third-person chase camera aligned with ship's forward vector (-Z)
        if (core && core.cam) {
          core.cam.fov = 65;
          core.cam.updateProjectionMatrix();
          core.cam.position.set(0, 3.2, 11);
          core.cam.lookAt(0, 1.2, -40);
        }
        break;
      }

      case DEPARTURE_PHASES.WORMHOLE: {
        d.warpHud.classList.remove('hc-hidden');
        d.warpTitle.textContent = 'WORMHOLE SINGULARITY';
        d.warpSpeed.textContent = 'TRANSDIMENSIONAL CORRIDOR';
        d.warpStatus.textContent = 'ENTERING GRAVITATIONAL ACCRETION VORTEX…';

        if (audio) {
          audio.play('wormhole_vortex');
        }

        // Clean up previous high-speed star streaks from lightspeed phase
        if (starStreaks && starStreaks.parent) {
          starStreaks.parent.remove(starStreaks);
          starStreaks = null;
        }

        // Add streamlined tunnel light-filaments
        const streamCount = getGraphicsPreset() === 'low' ? 70 : 160;
        starStreaks = buildWormholeStreamlines(streamCount);
        depGroup.add(starStreaks);

        // Build 3D Wormhole Vortex Tunnel
        if (wormholeGroup && wormholeGroup.parent) wormholeGroup.parent.remove(wormholeGroup);
        wormholeGroup = buildWormholeVortex(getGraphicsPreset());
        wormholeGroup.position.set(0, 0, -50);
        depGroup.add(wormholeGroup);

        // Position ship in foreground angled toward the wormhole mouth
        if (shipGroup) {
          shipGroup.position.set(3.5, -1.2, 14.0);
          shipGroup.rotation.set(0.06, -0.15, 0.0);
          shipGroup.visible = true;
        }

        // Camera setup for Phase A approach
        if (core && core.cam) {
          core.cam.fov = 58;
          core.cam.updateProjectionMatrix();
          core.cam.position.set(5.5, 2.8, 26.0);
          core.cam.lookAt(0, 0, -80);
        }
        break;
      }

      case DEPARTURE_PHASES.HANDOFF: {
        cleanup();
        if (typeof DepartureState.onComplete === 'function') {
          DepartureState.onComplete();
        }
        break;
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────────
     PER-FRAME TICK UPDATE
     ───────────────────────────────────────────────────────────────────────────── */
  function update(dt, now) {
    if (!DepartureState.active) return;
    DepartureState.timer += dt;
    DepartureState.phaseTime += dt;
    const core = getCore();
    const d = dom;

    // Continuously guarantee clean celestial void during departure & warp
    if (core) {
      if (core.planet) core.planet.visible = false;
      if (core.atm) core.atm.visible = false;
      if (core.decor) core.decor.visible = false;
      if (core.moons) core.moons.forEach(m => { if (m && m.o) m.o.visible = false; });
    }
    if (typeof window !== 'undefined' && window.Homecoming && window.Homecoming.setPlanetCompanionsVisible) {
      window.Homecoming.setPlanetCompanionsVisible(false);
    }

    switch (DepartureState.phase) {
      /* Scene 1: Spacecraft Launch & Departure Vector */
      case DEPARTURE_PHASES.LAUNCH: {
        const t = DepartureState.phaseTime;
        if (shipGroup) {
          if (DepartureState.isOnSurface) {
            const lx = (DepartureState.isOnSurface && DepartureState.launchPos) ? DepartureState.launchPos.x : 0;
            const ly = (DepartureState.isOnSurface && DepartureState.launchPos) ? DepartureState.launchPos.y : 0;
            const lz = (DepartureState.isOnSurface && DepartureState.launchPos) ? DepartureState.launchPos.z : 0;

            // Upward vertical liftoff accelerating into an ascent climb
            const liftY = Math.pow(Math.min(4.5, t) / 2.8, 2) * 22.0;
            const forwardZ = -Math.pow(Math.min(4.5, t) / 3.0, 2) * 35.0;
            shipGroup.position.set(lx, ly + liftY, lz + forwardZ);
            // Pitch nose upward/forward into ascent corridor
            shipGroup.rotation.x = -Math.min(0.42, t * 0.11);

            if (liftoffDust) {
              liftoffDust.scale.x += dt * 1.8;
              liftoffDust.scale.z += dt * 1.8;
              if (liftoffDust.material) liftoffDust.material.opacity = Math.max(0, 0.7 - t * 0.16);
            }

            // Camera tracks climbing craft
            if (core && core.cam) {
              core.cam.position.y += dt * 4.2;
              core.cam.position.z += dt * 1.6;
              core.cam.lookAt(shipGroup.position.x, shipGroup.position.y + 2.0, shipGroup.position.z);
            }
          } else {
            // Orbital departure: clean forward acceleration along departure vector (-Z)
            shipGroup.position.z -= dt * (14 + t * 22);
            shipGroup.position.y += dt * 0.8;
            shipGroup.rotation.set(0, 0, 0);

            // Camera smoothly dollies forward and tracks the accelerating vessel
            if (core && core.cam) {
              core.cam.position.z -= dt * 4.8;
              core.cam.lookAt(shipGroup.position.x, shipGroup.position.y + 0.5, shipGroup.position.z - 15);
            }
          }

          // Pulse thrusters and blink wingtip strobes
          thrusterGlowJets.forEach((jet, i) => {
            const s = 1.0 + Math.sin(now * 0.03 + i) * 0.15;
            jet.scale.set(s, s, 1.0 + Math.sin(now * 0.05) * 0.25);
          });
          if (shipGroup.userData && shipGroup.userData.strobes) {
            const flash = (Math.sin(now * 0.008) > 0.85);
            shipGroup.userData.strobes.forEach(s => {
              if (s && s.material) s.material.opacity = flash ? 1.0 : 0.2;
            });
          }
        }

        if (t >= 4.5) {
          enterPhase(DEPARTURE_PHASES.JUMP_READY);
        }
        break;
      }

      /* Scene 2: First-Person Asteroid Flight Challenge */
      case DEPARTURE_PHASES.FLIGHT: {
        // Update flight timing & progress (60 seconds target duration)
        DepartureState.flightProgress = Math.min(1.0, DepartureState.phaseTime / DepartureState.flightDuration);
        const remTime = Math.max(0, Math.ceil(DepartureState.flightDuration - DepartureState.phaseTime));

        if (d) {
          d.flightProgress.style.width = (DepartureState.flightProgress * 100).toFixed(1) + '%';
          d.flightTimer.textContent = `ESCAPE IN: ${remTime}s`;
          d.flightIntegrity.style.width = DepartureState.integrity + '%';
          d.flightIntegrityVal.textContent = Math.round(DepartureState.integrity) + '%';
          d.flightEvasions.textContent = `EVASIONS: ${DepartureState.evasions}`;
        }

        // Steering Physics & Inertia
        let steerX = 0, steerY = 0;
        if (DepartureState.keys.a) steerX -= 1;
        if (DepartureState.keys.d) steerX += 1;
        if (DepartureState.keys.w) steerY += 1; // pitch down / dive
        if (DepartureState.keys.s) steerY -= 1; // pitch up / climb

        // Add touch input if active
        if (DepartureState.touchInput.active) {
          steerX += DepartureState.touchInput.x;
          steerY -= DepartureState.touchInput.y;
        }

        const maxSpeed = 16.0;
        DepartureState.shipVel.x += (steerX * maxSpeed - DepartureState.shipVel.x) * dt * 4.5;
        DepartureState.shipVel.y += (steerY * maxSpeed - DepartureState.shipVel.y) * dt * 4.5;

        DepartureState.shipPos.x = Math.max(-14, Math.min(14, DepartureState.shipPos.x + DepartureState.shipVel.x * dt));
        DepartureState.shipPos.y = Math.max(-9, Math.min(9, DepartureState.shipPos.y + DepartureState.shipVel.y * dt));

        // Update Cockpit Transform & Banking Roll
        if (cockpitGroup) {
          cockpitGroup.position.x = DepartureState.shipPos.x * 0.15;
          cockpitGroup.position.y = DepartureState.shipPos.y * 0.15;
          cockpitGroup.rotation.z = -DepartureState.shipVel.x * 0.035; // Bank into turns
          cockpitGroup.rotation.x = DepartureState.shipVel.y * 0.025;
        }

        // Stream space dust motes past the cockpit for high-velocity sensation
        if (spaceDust && spaceDust.geometry && spaceDust.geometry.attributes && spaceDust.geometry.attributes.position) {
          const p = spaceDust.geometry.attributes.position;
          const dustSpeed = 110.0;
          for (let i = 0; i < p.count; i++) {
            let z = p.getZ(i) + dustSpeed * dt;
            if (z > 8) z -= 140;
            p.setZ(i, z);
          }
          p.needsUpdate = true;
        }

        // Asteroids Wave Generation & Collision Checks
        let proximityDanger = false;
        const wave = Math.floor(DepartureState.phaseTime / 15); // 4 progressive waves

        asteroidPool.forEach((rock, idx) => {
          if (!rock.userData.active) {
            // Respawn asteroid ahead if corridor is open
            if (Math.random() < 0.08 + wave * 0.03) {
              rock.userData.active = true;
              rock.visible = true;
              rock.userData.evaded = false;
              // Fair procedural positioning leaving escape corridors
              const spreadX = (Math.random() - 0.5) * 32.0;
              const spreadY = (Math.random() - 0.5) * 20.0;
              rock.position.set(spreadX, spreadY, -190 - Math.random() * 40);
              rock.userData.speed = 90 + Math.random() * 45;
            }
          } else {
            // Move asteroid toward camera
            rock.position.z += rock.userData.speed * dt;
            rock.rotation.x += rock.userData.rotSpeed.x * dt;
            rock.rotation.y += rock.userData.rotSpeed.y * dt;

            // Distance to ship/cockpit (at (shipPos.x, shipPos.y, 0))
            const dx = rock.position.x - DepartureState.shipPos.x;
            const dy = rock.position.y - DepartureState.shipPos.y;
            const dz = rock.position.z;
            const dist = Math.hypot(dx, dy, dz);

            // Proximity Warning
            if (rock.position.z > -70 && rock.position.z < -10 && Math.hypot(dx, dy) < 4.8) {
              proximityDanger = true;
            }

            // Collision check (< 2.2m)
            if (dist < (rock.userData.radius + 1.2) && rock.position.z > -4 && rock.position.z < 4) {
              onAsteroidCollision(rock);
            }
            // Near-miss check (2.4m - 5.0m)
            else if (!rock.userData.evaded && rock.position.z > 0 && Math.hypot(dx, dy) < 4.6) {
              onAsteroidNearMiss(rock);
            }

            // Recycle passed asteroid
            if (rock.position.z > 25) {
              rock.userData.active = false;
              rock.visible = false;
            }
          }
        });

        // Update Proximity Alert UI
        if (d && d.flightAlert) {
          d.flightAlert.classList.toggle('hc-hidden', !proximityDanger);
        }

        // Shield / Integrity Auto-Regeneration (+2.5% per second)
        if (DepartureState.integrity < DepartureState.maxIntegrity) {
          DepartureState.integrity = Math.min(DepartureState.maxIntegrity, DepartureState.integrity + dt * 2.5);
        }

        // Check 60s Flight Challenge Completion (if ever invoked directly)
        if (DepartureState.phaseTime >= DepartureState.flightDuration) {
          enterPhase(DEPARTURE_PHASES.JUMP_READY);
        }
        break;
      }

      /* Scene 3: Outer Space Orbital Cruise & Jump Readiness */
      case DEPARTURE_PHASES.JUMP_READY: {
        const t = DepartureState.phaseTime;
        if (shipGroup) {
          // Smooth cosmic idle float
          shipGroup.position.y = Math.sin(t * 0.9) * 0.12;
          shipGroup.rotation.z = Math.sin(t * 0.6) * 0.015;

          // Pulse thruster glows
          thrusterGlowJets.forEach((jet, i) => {
            const s = 1.0 + Math.sin(now * 0.025 + i) * 0.12;
            jet.scale.set(s, s, 1.2 + Math.sin(now * 0.04) * 0.18);
          });

          // Wingtip navigation strobe pulses
          if (shipGroup.userData && shipGroup.userData.strobes) {
            const flash = (Math.sin(now * 0.008) > 0.85);
            shipGroup.userData.strobes.forEach(s => {
              if (s && s.material) s.material.opacity = flash ? 1.0 : 0.2;
            });
          }
        }

        // Cinematic camera tracking with soft drift
        if (core && core.cam) {
          core.cam.position.set(
            2.4 + Math.sin(t * 0.35) * 0.35,
            1.2 + Math.cos(t * 0.28) * 0.15,
            9.2
          );
          core.cam.lookAt(0, 0.7, -3.0);
        }

        // Subtle cosmic dust motes drift
        if (spaceDust && spaceDust.geometry && spaceDust.geometry.attributes && spaceDust.geometry.attributes.position) {
          const p = spaceDust.geometry.attributes.position;
          for (let i = 0; i < p.count; i++) {
            let z = p.getZ(i) + dt * 12.0;
            if (z > 15) z -= 140;
            p.setZ(i, z);
          }
          p.needsUpdate = true;
        }
        break;
      }

      /* Scene 4: Light-Speed Acceleration */
      case DEPARTURE_PHASES.LIGHTSPEED: {
        const t = DepartureState.phaseTime;

        // Move stars backward at warp speed
        if (starStreaks && starStreaks.geometry && starStreaks.geometry.attributes && starStreaks.geometry.attributes.position) {
          const pos = starStreaks.geometry.attributes.position;
          const warpSpeed = 180 + Math.pow(t, 2) * 220;
          for (let i = 0; i < pos.count; i++) {
            let z = pos.getZ(i) + warpSpeed * dt;
            if (z > 20) z -= 240;
            pos.setZ(i, z);
          }
          pos.needsUpdate = true;
        }

        // Spacecraft surges forward
        if (shipGroup) {
          shipGroup.position.z -= dt * (22 + t * 45);
        }

        // Dynamic Camera FOV Expansion
        if (core && core.cam) {
          core.cam.fov = Math.min(80, 65 + t * 3.5);
          core.cam.updateProjectionMatrix();
        }

        if (t >= 4.0) {
          enterPhase(DEPARTURE_PHASES.WORMHOLE);
        }
        break;
      }

      /* Scene 5: Wormhole Approach, Entry, Transit & Exit (Cinematic Phases A -> B -> C -> D) */
      case DEPARTURE_PHASES.WORMHOLE: {
        const t = DepartureState.phaseTime;

        // 1. Dynamic Gravitational Motion of Wormhole Rings, Arcs, Funnel, and Particles
        if (wormholeGroup) {
          // Differential accretion ring rotations & subtle undulation
          if (wormholeGroup.userData.rings) {
            wormholeGroup.userData.rings.forEach(r => {
              r.rotation.z += r.userData.rotSpeed * dt * (1.0 + t * 0.35);
              if (r.userData.tiltX) {
                r.rotation.x = r.userData.tiltX + Math.sin(t * 2.2) * 0.04;
              }
            });
          }

          // Spiral gravitational arcs
          if (wormholeGroup.userData.arcs) {
            wormholeGroup.userData.arcs.forEach(a => {
              a.rotation.z += a.userData.rotSpeed * dt * (1.0 + t * 0.4);
            });
          }

          // Funnel throat rotation
          if (wormholeGroup.userData.funnel) {
            wormholeGroup.userData.funnel.rotation.z += dt * 0.45;
          }

          // Singularity photon sphere pulse
          if (wormholeGroup.userData.photonRim) {
            const rimPulse = 1.0 + Math.sin(t * 6.5) * 0.07;
            wormholeGroup.userData.photonRim.scale.set(rimPulse, rimPulse, 1.0);
          }

          // Inward-spiraling accretion filament particles
          if (wormholeGroup.userData.particles && wormholeGroup.userData.particleData) {
            const posAttr = wormholeGroup.userData.particles.geometry.attributes.position;
            const pData = wormholeGroup.userData.particleData;
            for (let i = 0; i < pData.length; i++) {
              const p = pData[i];
              const spinSpeed = p.speedTheta * (1.0 + 12.0 / (p.radius + 1.0));
              p.theta += spinSpeed * dt;
              p.radius -= dt * (3.0 + (42.0 - p.radius) * 0.08);
              p.z -= p.speedZ * dt;

              if (p.z < -70.0 || p.radius < 3.8) {
                p.radius = 32.0 + Math.random() * 16.0;
                p.theta = Math.random() * Math.PI * 2;
                p.z = -Math.random() * 8.0;
              }

              posAttr.setXYZ(i, Math.cos(p.theta) * p.radius, Math.sin(p.theta) * p.radius, p.z);
            }
            posAttr.needsUpdate = true;
          }
        }

        // 2. Streamlined Tunnel Light Streaks
        if (starStreaks && starStreaks.geometry && starStreaks.geometry.attributes && starStreaks.geometry.attributes.position) {
          const pos = starStreaks.geometry.attributes.position;
          const streamSpeed = 90.0 + t * 60.0;
          for (let i = 0; i < pos.count; i++) {
            let z = pos.getZ(i) + streamSpeed * dt;
            if (z > 25.0) z -= 160.0;
            pos.setZ(i, z);
          }
          pos.needsUpdate = true;
        }

        // 3. Spacecraft Flight Path & Direction of Travel
        if (shipGroup) {
          // Normalized cinematic progress from 0.0 to 1.0 over 4.2s
          const enterProgress = Math.min(1.0, t / 4.2);
          const p = enterProgress;

          // Continuous smooth trajectory from foreground (3.5, -1.2, 14) into throat (0, 0, -72)
          const easeProgress = Math.pow(p, 1.35);
          shipGroup.position.x = 3.5 * Math.pow(1.0 - p, 1.8) + (p > 0.65 ? Math.sin(t * 28.0) * 0.04 : 0.0);
          shipGroup.position.y = -1.2 * Math.pow(1.0 - p, 1.8) + (p > 0.65 ? Math.cos(t * 28.0) * 0.04 : 0.0);
          shipGroup.position.z = 14.0 - easeProgress * 86.0;

          // Align ship heading straight into the singularity throat with subtle bank angle
          shipGroup.rotation.y = -0.15 * Math.pow(1.0 - p, 1.5);
          shipGroup.rotation.x = 0.06 * Math.pow(1.0 - p, 1.5);
          shipGroup.rotation.z = Math.sin(t * 2.0) * 0.06 * (1.0 - p);

          // Intense engine plume scaling
          if (thrusterGlowJets && thrusterGlowJets.length) {
            const jetPulse = 1.6 + Math.sin(t * 16.0) * 0.25 + t * 0.25;
            thrusterGlowJets.forEach(jet => {
              jet.scale.set(jetPulse, jetPulse, jetPulse * 1.5);
            });
          }

          // Trigger entry audio and warp flash as ship crosses photon sphere
          if (enterProgress > 0.88 && !DepartureState.warped) {
            DepartureState.warped = true;
            const audio = getAudio();
            if (audio) audio.play('wormhole_entry');
            if (d && d.wrap) d.wrap.classList.add('hc-warp-flash');
          }
        }

        // 4. Smooth Cinematic Camera Progression
        if (core && core.cam) {
          const camLag = Math.min(1.0, t / 4.4);
          const camEase = Math.pow(camLag, 1.25);
          core.cam.position.x = 5.5 * Math.pow(1.0 - camLag, 1.4) + (t > 2.8 ? Math.sin(t * 24.0) * 0.03 : 0.0);
          core.cam.position.y = 2.8 * Math.pow(1.0 - camLag, 1.4) + 0.35 + (t > 2.8 ? Math.cos(t * 24.0) * 0.03 : 0.0);
          core.cam.position.z = 26.0 - camEase * 74.0;
          core.cam.lookAt(0, 0, -85);
        }

        // 5. Completion & Seamless Handoff
        if (t >= 4.5) {
          enterPhase(DEPARTURE_PHASES.HANDOFF);
        }
        break;
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────────
     EVENT HANDLERS & FLIGHT MECHANICS
     ───────────────────────────────────────────────────────────────────────────── */
  function onAsteroidCollision(rock) {
    rock.userData.active = false;
    rock.visible = false;
    DepartureState.collisions++;
    DepartureState.integrity = Math.max(15, DepartureState.integrity - 15); // Fair damage, cannot drop below 15%

    const audio = getAudio();
    if (audio) audio.play('asteroid_collision');

    // Camera shake
    const core = getCore();
    if (core && core.cam) {
      core.cam.position.x += (Math.random() - 0.5) * 0.6;
      core.cam.position.y += (Math.random() - 0.5) * 0.6;
    }

    if (dom && dom.flightIntegrity) {
      dom.flightIntegrity.style.background = '#ff4d4d';
      setTimeout(() => { if (dom && dom.flightIntegrity) dom.flightIntegrity.style.background = ''; }, 320);
    }
  }

  function onAsteroidNearMiss(rock) {
    rock.userData.evaded = true;
    DepartureState.evasions++;
    const audio = getAudio();
    if (audio) audio.play('asteroid_nearmiss');

    if (dom && dom.flightToast) {
      dom.flightToast.textContent = `NEAR MISS — DEFLECTORS HOLDING (+1 EVASION)`;
      dom.flightToast.classList.remove('hc-hidden');
      setTimeout(() => { if (dom && dom.flightToast) dom.flightToast.classList.add('hc-hidden'); }, 1200);
    }
  }

  function engageJump() {
    if (DepartureState.phase !== DEPARTURE_PHASES.JUMP_READY) return;
    enterPhase(DEPARTURE_PHASES.LIGHTSPEED);
  }

  function skipCurrentPhase() {
    if (!DepartureState.active) return;
    switch (DepartureState.phase) {
      case DEPARTURE_PHASES.LAUNCH:
        enterPhase(DEPARTURE_PHASES.JUMP_READY);
        break;
      case DEPARTURE_PHASES.FLIGHT:
        enterPhase(DEPARTURE_PHASES.JUMP_READY);
        break;
      case DEPARTURE_PHASES.JUMP_READY:
        engageJump();
        break;
      case DEPARTURE_PHASES.LIGHTSPEED:
      case DEPARTURE_PHASES.WORMHOLE:
        enterPhase(DEPARTURE_PHASES.HANDOFF);
        break;
      default:
        break;
    }
  }

  function onKey(e, isDown) {
    if (!DepartureState.active) return;
    const code = e.code;

    if (code === 'KeyW' || code === 'ArrowUp') DepartureState.keys.w = isDown;
    if (code === 'KeyS' || code === 'ArrowDown') DepartureState.keys.s = isDown;
    if (code === 'KeyA' || code === 'ArrowLeft') DepartureState.keys.a = isDown;
    if (code === 'KeyD' || code === 'ArrowRight') DepartureState.keys.d = isDown;

    if (isDown && code === 'Space') {
      if (DepartureState.phase === DEPARTURE_PHASES.JUMP_READY) {
        engageJump();
      }
    }
    if (isDown && code === 'Escape') {
      skipCurrentPhase();
    }
  }

  function cleanup() {
    DepartureState.active = false;
    DepartureState.phase = DEPARTURE_PHASES.IDLE;
    DepartureState.warped = false;

    // Remove departure 3D group from scene
    const core = getCore();
    if (depGroup && depGroup.parent) {
      depGroup.parent.remove(depGroup);
    }
    depGroup = null;
    shipGroup = null;
    cockpitGroup = null;
    asteroidPool = [];
    starStreaks = null;
    wormholeGroup = null;
    spaceDust = null;
    thrusterGlowJets = [];

    // Reset camera to clean orbital perspective
    if (core && core.cam) {
      core.cam.position.set(0, 0, 5.5);
      core.cam.rotation.set(0, 0, 0);
      core.cam.fov = 40;
      core.cam.updateProjectionMatrix();
      core.cam.lookAt(0, 0, 0);
    }

    // Restore scene backdrop objects
    if (core) {
      if (core.planet) {
        core.planet.visible = true;
        core.planet.position.set(0, 0, 0);
        core.planet.scale.setScalar(1.0);
      }
      if (core.atm) {
        core.atm.visible = true;
        core.atm.position.set(0, 0, 0);
        core.atm.scale.setScalar(1.0);
      }
      if (core.scene) {
        core.scene.fog = null;
        core.scene.background = null;
      }
      if (core.decor) {
        core.decor.visible = (savedSceneState.decorVisible !== false);
      }
      if (core.moons && savedSceneState.moonsVisible) {
        core.moons.forEach((m, idx) => {
          if (m && m.o) m.o.visible = (savedSceneState.moonsVisible[idx] !== false);
        });
      }
      if (core.scene && savedSceneState.sceneFog) {
        core.scene.fog = savedSceneState.sceneFog;
      }
    }

    // Restore surface objects if Homecoming world still exists (e.g. cancelled/aborted)
    if (typeof window !== 'undefined' && window.Homecoming) {
      const w = window.Homecoming.getWorld ? window.Homecoming.getWorld() : null;
      if (w) {
        w.traverse(obj => {
          if (obj.name && obj.name.startsWith('main-spacecraft')) {
            obj.visible = true;
          }
        });
      }
      const a = window.Homecoming.getAstronaut ? window.Homecoming.getAstronaut() : null;
      if (a && a.group) a.group.visible = true;
    }

    // Hide DOM
    if (dom && dom.wrap) {
      dom.wrap.classList.add('hc-hidden');
      dom.wrap.classList.remove('hc-warp-flash');
      dom.launchHud.classList.add('hc-hidden');
      dom.flightHud.classList.add('hc-hidden');
      dom.jumpHud.classList.add('hc-hidden');
      dom.warpHud.classList.add('hc-hidden');
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────────
     PUBLIC API EXPORT
     ───────────────────────────────────────────────────────────────────────────── */
  const api = {
    PHASES: DEPARTURE_PHASES,
    start,
    update,
    onKey,
    engageJump,
    skipCurrentPhase,
    cleanup,
    isActive: () => DepartureState.active,
    getPhase: () => DepartureState.phase,
    getStats: () => ({
      phase: DepartureState.phase,
      flightProgress: DepartureState.flightProgress,
      integrity: DepartureState.integrity,
      evasions: DepartureState.evasions,
      collisions: DepartureState.collisions,
      active: DepartureState.active
    })
  };

  if (typeof window !== 'undefined') {
    window.HomecomingDeparture = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();

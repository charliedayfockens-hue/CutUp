import * as THREE from 'three';
import { ROAD_HALF, laneToX } from './World.js';

// ---- Direct Mapping Steering ----
const BINDINGS = {
  'a': { move: -1, wheel: -30 },
  'd': { move:  1, wheel:  30 },
};

// ---- Tuning ----
const MAX_SPEED       = 280;   // km/h
const ACCEL           = 48;    // km/h per second
const BRAKE_FORCE     = 65;
const ENGINE_BRAKE    = 10;
const LATERAL_SPEED   = 14;    // m/s lateral movement
const WHEEL_TURN_MAX  = Math.PI / 6; // 30 degrees
const NITRO_MULTIPLIER = 1.4;  // Speed multiplier when nitro active

// ---- Toon / DS-style materials ----
const bodyMat  = new THREE.MeshToonMaterial({ color: 0x33cc55 });
const cabinMat = new THREE.MeshToonMaterial({ color: 0x222244, transparent: true, opacity: 0.7 });
const darkMat  = new THREE.MeshToonMaterial({ color: 0x111111 });
const wheelMat = new THREE.MeshToonMaterial({ color: 0x1a1a1a });
const hlMat    = new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0xffffcc, emissiveIntensity: 0.5 });
const tlMat    = new THREE.MeshToonMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.4 });
const grilleMat = new THREE.MeshToonMaterial({ color: 0x333333 });
const bedMat   = new THREE.MeshToonMaterial({ color: 0x444444 });

// ---- Galaxy ShaderMaterial ----
const galaxyVertexShader = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const galaxyFragmentShader = `
  uniform float uTime;
  varying vec3 vPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vPos.xz * 1.5 + uTime * 0.08;
    float stars = 0.0;
    for (float i = 0.0; i < 3.0; i++) {
      vec2 grid = floor(uv * (8.0 + i * 6.0));
      float h = hash(grid + i * 13.0);
      if (h > 0.92) {
        stars += (h - 0.92) * 12.5 * (0.5 + 0.5 * sin(uTime * 2.0 + h * 40.0));
      }
    }
    vec3 base = mix(vec3(0.05, 0.0, 0.15), vec3(0.0, 0.05, 0.2), sin(uv.x * 2.0) * 0.5 + 0.5);
    vec3 col = base + vec3(stars * 0.8, stars * 0.7, stars);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const galaxyMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: galaxyVertexShader,
  fragmentShader: galaxyFragmentShader,
});

// Outline helper
function addOutline(parent, geo, scale) {
  const outMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  const outline = new THREE.Mesh(geo, outMat);
  outline.scale.multiplyScalar(scale || 1.06);
  parent.add(outline);
  return outline;
}

// Shared wheel geometry
const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
const bigWGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 16);

export { BINDINGS, galaxyMat };

// ============================================================
// Vehicle dimensions used for collision and camera
// ============================================================
const VEHICLE_SPECS = {
  sports: { halfW: 1.0, halfL: 2.1, lateralSpeed: 14, wheelTurnMax: Math.PI / 6 },
  truck:  { halfW: 1.15, halfL: 2.75, lateralSpeed: 11, wheelTurnMax: Math.PI / 8 },
  limo:   { halfW: 1.0, halfL: 4.0, lateralSpeed: 10, wheelTurnMax: Math.PI / 7 },
};

export class CarController {
  constructor(scene) {
    this.scene = scene;
    this.playerGroup = new THREE.Group();
    this.frontWheelPivots = [];
    this.allWheels = [];

    // State
    this.speed = 0;
    this._targetX = 0;
    this._lateralDir = 0;

    // Vehicle type
    this._vehicleType = 'sports';
    this.halfW = VEHICLE_SPECS.sports.halfW;
    this.halfL = VEHICLE_SPECS.sports.halfL;

    // Color mode: 'solid' | 'rainbow' | 'galaxy'
    this._colorMode = 'solid';
    this._rainbowHue = 0;
    this._chassisMesh = null;

    // Nitro state
    this.nitroActive = false;

    // Custom car group reference (set by editor)
    this._customCarGroup = null;
    this._usingCustom = false;

    this._buildSportsCar();

    const startX = laneToX(1);
    this.playerGroup.position.set(startX, 0, 0);
    this._targetX = startX;
    scene.add(this.playerGroup);
  }

  // ---- Set vehicle type ----
  setVehicle(type) {
    this._vehicleType = type || 'sports';
    const specs = VEHICLE_SPECS[this._vehicleType] || VEHICLE_SPECS.sports;
    this.halfW = specs.halfW;
    this.halfL = specs.halfL;

    // If switching to a standard vehicle, detach custom group
    this._usingCustom = false;

    // Save position
    const pos = this.playerGroup.position.clone();

    // Clear existing mesh
    while (this.playerGroup.children.length > 0) {
      const child = this.playerGroup.children[0];
      this.playerGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
    this.frontWheelPivots = [];
    this.allWheels = [];
    this._chassisMesh = null;

    // Build new mesh
    if (this._vehicleType === 'truck') {
      this._buildTruck();
    } else if (this._vehicleType === 'limo') {
      this._buildLimo();
    } else {
      this._buildSportsCar();
    }

    // Restore position
    this.playerGroup.position.copy(pos);
  }

  // ---- Attach custom car group from editor ----
  attachCustomGroup(customGroup) {
    this._customCarGroup = customGroup;
  }

  useCustomCar() {
    if (!this._customCarGroup) return;

    // Clear default mesh children (keep group)
    while (this.playerGroup.children.length > 0) {
      const child = this.playerGroup.children[0];
      this.playerGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
    this.frontWheelPivots = [];
    this.allWheels = [];
    this._chassisMesh = null;

    // Clone custom parts into playerGroup
    for (const child of this._customCarGroup.children) {
      const clone = child.clone();
      this.playerGroup.add(clone);
    }

    this._usingCustom = true;
    this._vehicleType = 'custom';
    // Use sports car collision bounds as default for custom
    this.halfW = VEHICLE_SPECS.sports.halfW;
    this.halfL = VEHICLE_SPECS.sports.halfL;
  }

  // ---- Set car color ----
  setColor(value) {
    this._colorMode = 'solid';

    if (value === 'rainbow') {
      this._colorMode = 'rainbow';
      this._rainbowHue = 0;
      if (!this._usingCustom && this._chassisMesh) {
        this._chassisMesh.material = bodyMat;
      }
    } else if (value === 'galaxy') {
      this._colorMode = 'galaxy';
      if (this._usingCustom) {
        this.playerGroup.traverse(child => {
          if (child.isMesh && child.userData.isColorable) {
            child.material = galaxyMat;
          }
        });
      } else {
        if (this._chassisMesh) this._chassisMesh.material = galaxyMat;
      }
    } else {
      const hex = (typeof value === 'string' && value.startsWith('#')) ? value : null;
      const colorMap = { green: 0x33cc55, yellow: 0xffdd00, red: 0xff2200, blue: 0x3366ff };
      if (this._usingCustom) {
        const col = hex || '#33cc55';
        this.playerGroup.traverse(child => {
          if (child.isMesh && child.userData.isColorable) {
            if (!child.material.color) {
              child.material = new THREE.MeshToonMaterial({ color: 0x888888 });
            }
            child.material.color.set(col);
          }
        });
      } else {
        if (this._chassisMesh) this._chassisMesh.material = bodyMat;
        if (hex) {
          bodyMat.color.set(hex);
        } else {
          bodyMat.color.setHex(colorMap[value] || 0x33cc55);
        }
      }
    }
  }

  // ============================================================
  //  SPORTS CAR — Low profile, wide stance, large spoiler
  // ============================================================
  _buildSportsCar() {
    const g = this.playerGroup;

    // Chassis — low, wide
    const chassisGeo = new THREE.BoxGeometry(2.0, 0.5, 4.2);
    const chassis = new THREE.Mesh(chassisGeo, bodyMat);
    chassis.position.y = 0.45;
    chassis.castShadow = true;
    g.add(chassis);
    addOutline(chassis, chassisGeo, 1.04);
    this._chassisMesh = chassis;

    // Cabin — low, sleek
    const cabGeo = new THREE.BoxGeometry(1.6, 0.4, 1.8);
    const cabin = new THREE.Mesh(cabGeo, cabinMat);
    cabin.position.set(0, 0.9, -0.3);
    cabin.castShadow = true;
    g.add(cabin);

    // Front splitter — wide
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.5), darkMat);
    splitter.position.set(0, 0.22, 2.2);
    g.add(splitter);

    // Large rear spoiler
    const wingGeo = new THREE.BoxGeometry(2.2, 0.1, 0.4);
    const wing = new THREE.Mesh(wingGeo, darkMat);
    wing.position.set(0, 1.25, -2.0);
    g.add(wing);
    for (const sx of [-0.8, 0.8]) {
      const sup = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), darkMat);
      sup.position.set(sx, 1.0, -2.0);
      g.add(sup);
    }

    // Wheels — wide stance
    this._addFrontWheels(g, wGeo, [-1.05, 1.05], 0.35, 1.4);
    this._addRearWheels(g, wGeo, [-1.05, 1.05], 0.35, -1.4);

    // Headlights
    this._addHeadlights(g, 2.15);
    this._addTaillights(g, -2.15);
  }

  // ============================================================
  //  TRUCK — Tall cabin, big grille, long bed, raised wheels
  // ============================================================
  _buildTruck() {
    const g = this.playerGroup;

    // Main body/cab — tall and wide
    const cabBodyGeo = new THREE.BoxGeometry(2.3, 1.0, 2.5);
    const cabBody = new THREE.Mesh(cabBodyGeo, bodyMat);
    cabBody.position.set(0, 0.8, 1.0);
    cabBody.castShadow = true;
    g.add(cabBody);
    addOutline(cabBody, cabBodyGeo, 1.04);
    this._chassisMesh = cabBody;

    // Cabin glass — tall
    const cabGeo = new THREE.BoxGeometry(2.0, 0.6, 1.5);
    const cabin = new THREE.Mesh(cabGeo, cabinMat);
    cabin.position.set(0, 1.6, 1.1);
    cabin.castShadow = true;
    g.add(cabin);

    // Front grille
    const grilleGeo = new THREE.BoxGeometry(2.1, 0.7, 0.15);
    const grille = new THREE.Mesh(grilleGeo, grilleMat);
    grille.position.set(0, 0.65, 2.3);
    g.add(grille);

    // Bed — long rectangular
    const bedGeo = new THREE.BoxGeometry(2.2, 0.6, 3.0);
    const bed = new THREE.Mesh(bedGeo, bedMat);
    bed.position.set(0, 0.6, -1.5);
    bed.castShadow = true;
    g.add(bed);
    addOutline(bed, bedGeo, 1.03);

    // Bed walls
    for (const sx of [-1.1, 1.1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 3.0), bedMat);
      wall.position.set(sx, 1.1, -1.5);
      g.add(wall);
    }
    const tailgate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.08), bedMat);
    tailgate.position.set(0, 1.1, -3.0);
    g.add(tailgate);

    // Bumper
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 0.3), darkMat);
    bumper.position.set(0, 0.35, 2.35);
    g.add(bumper);

    // Wheels — big, raised
    this._addFrontWheels(g, bigWGeo, [-1.15, 1.15], 0.45, 1.6);
    this._addRearWheels(g, bigWGeo, [-1.15, 1.15], 0.45, -2.2);

    // Lights
    this._addHeadlights(g, 2.35);
    this._addTaillights(g, -3.05);
  }

  // ============================================================
  //  LIMO — Elongated chassis, extra middle wheels
  // ============================================================
  _buildLimo() {
    const g = this.playerGroup;

    // Extended chassis — very long
    const chassisGeo = new THREE.BoxGeometry(2.0, 0.55, 8.0);
    const chassis = new THREE.Mesh(chassisGeo, bodyMat);
    chassis.position.y = 0.5;
    chassis.castShadow = true;
    g.add(chassis);
    addOutline(chassis, chassisGeo, 1.03);
    this._chassisMesh = chassis;

    // Front cabin
    const frontCabGeo = new THREE.BoxGeometry(1.7, 0.5, 1.8);
    const frontCab = new THREE.Mesh(frontCabGeo, cabinMat);
    frontCab.position.set(0, 1.0, 2.0);
    frontCab.castShadow = true;
    g.add(frontCab);

    // Rear cabin — taller, tinted
    const rearCabGeo = new THREE.BoxGeometry(1.7, 0.5, 3.0);
    const rearCab = new THREE.Mesh(rearCabGeo, cabinMat);
    rearCab.position.set(0, 1.0, -1.0);
    rearCab.castShadow = true;
    g.add(rearCab);

    // Divider pillar between front and rear
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.12), darkMat);
    pillar.position.set(0, 1.0, 0.8);
    g.add(pillar);

    // Front splitter
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.35), darkMat);
    splitter.position.set(0, 0.25, 4.05);
    g.add(splitter);

    // Chrome trim lines along sides
    for (const sx of [-1.01, 1.01]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 7.6), grilleMat);
      trim.position.set(sx, 0.78, 0);
      g.add(trim);
    }

    // Front wheels
    this._addFrontWheels(g, wGeo, [-1.0, 1.0], 0.35, 3.0);
    // Middle wheels (limo-specific)
    this._addRearWheels(g, wGeo, [-1.0, 1.0], 0.35, 0.0);
    // Rear wheels
    this._addRearWheels(g, wGeo, [-1.0, 1.0], 0.35, -3.0);

    // Lights
    this._addHeadlights(g, 4.05);
    this._addTaillights(g, -4.05);
  }

  // ============================================================
  //  Shared wheel/light helpers
  // ============================================================
  _addFrontWheels(g, geo, xPositions, yPos, zPos) {
    for (const x of xPositions) {
      const pivot = new THREE.Group();
      pivot.position.set(x, yPos, zPos);
      const wheel = new THREE.Mesh(geo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      pivot.add(wheel);
      g.add(pivot);
      this.frontWheelPivots.push(pivot);
      this.allWheels.push(wheel);
    }
  }

  _addRearWheels(g, geo, xPositions, yPos, zPos) {
    for (const x of xPositions) {
      const wheel = new THREE.Mesh(geo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, yPos, zPos);
      wheel.castShadow = true;
      g.add(wheel);
      this.allWheels.push(wheel);
    }
  }

  _addHeadlights(g, z) {
    const hlGeo = new THREE.SphereGeometry(0.14, 8, 8);
    for (const sx of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(hlGeo, hlMat);
      hl.position.set(sx, 0.55, z);
      g.add(hl);
    }
  }

  _addTaillights(g, z) {
    const tlGeo = new THREE.BoxGeometry(0.28, 0.1, 0.05);
    for (const sx of [-0.7, 0.7]) {
      const tl = new THREE.Mesh(tlGeo, tlMat);
      tl.position.set(sx, 0.55, z);
      g.add(tl);
    }
  }

  // ---- Per-frame update ----
  update(dt, input) {
    // Effective max speed (nitro boost)
    const effectiveMax = this.nitroActive ? MAX_SPEED * NITRO_MULTIPLIER : MAX_SPEED;

    // Forward speed
    if (input.gas) {
      this.speed = Math.min(effectiveMax, this.speed + ACCEL * dt);
    } else if (input.brake) {
      this.speed = Math.max(0, this.speed - BRAKE_FORCE * dt);
    } else {
      this.speed = Math.max(0, this.speed - ENGINE_BRAKE * dt);
    }

    const speedMs = this.speed / 3.6;

    // ── Smooth continuous steering (Gold Standard — do not revert) ──
    const specs = VEHICLE_SPECS[this._vehicleType] || VEHICLE_SPECS.sports;
    this._lateralDir = 0;
    if (input.left  || input.moveDir < 0) this._lateralDir = -1;
    if (input.right || input.moveDir > 0) this._lateralDir =  1;

    this._targetX += this._lateralDir * specs.lateralSpeed * dt;
    const limit = ROAD_HALF - 1.6;
    this._targetX = Math.max(-limit, Math.min(limit, this._targetX));
    this.playerGroup.position.x = THREE.MathUtils.lerp(
      this.playerGroup.position.x, this._targetX, 0.2
    );

    // Forward
    this.playerGroup.position.z += speedMs * dt;
    this.playerGroup.position.y = 0;
    this.playerGroup.rotation.set(0, 0, 0);

    // ── Front wheel steering ────────────────────────────────────
    let targetWheelY = 0;
    if (this._lateralDir < 0) targetWheelY =  0.5;
    if (this._lateralDir > 0) targetWheelY = -0.5;
    for (const pivot of this.frontWheelPivots) {
      pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, targetWheelY, Math.min(1, 12 * dt));
    }

    // Custom car wheel steering by mesh name
    if (this._usingCustom) {
      const fl = this.playerGroup.getObjectByName('wheel_fl');
      const fr = this.playerGroup.getObjectByName('wheel_fr');
      if (fl) fl.rotation.y = THREE.MathUtils.lerp(fl.rotation.y, targetWheelY, Math.min(1, 12 * dt));
      if (fr) fr.rotation.y = THREE.MathUtils.lerp(fr.rotation.y, targetWheelY, Math.min(1, 12 * dt));
    }

    // Wheel spin
    const spin = speedMs * dt * 3;
    for (const w of this.allWheels) w.rotation.x += spin;

    // Color mode updates
    this._tickColorAnimations();
  }

  // ---- Tick shader/color animations without advancing physics ----
  // Called during garage turntable preview so rainbow/galaxy stay alive.
  tickAnimations() {
    this._tickColorAnimations();
  }

  _tickColorAnimations() {
    if (this._colorMode === 'rainbow') {
      const hsl = (Date.now() * 0.0005) % 1;
      if (this._usingCustom) {
        const color = new THREE.Color().setHSL(hsl, 1, 0.5);
        this.playerGroup.traverse(child => {
          if (child.isMesh && child.userData.isColorable && child.material.color) {
            child.material.color.copy(color);
          }
        });
      } else {
        bodyMat.color.setHSL(hsl, 1, 0.5);
      }
    } else if (this._colorMode === 'galaxy') {
      galaxyMat.uniforms.uTime.value = performance.now() * 0.001;
    }
  }

  // ---- Reset ----
  reset() {
    this.speed       = 0;
    this._lateralDir = 0;
    this.nitroActive = false;
    this._targetX    = laneToX(1); // centre lane
    this.playerGroup.position.set(this._targetX, 0, 0);
    this.playerGroup.rotation.set(0, 0, 0);
    for (const pivot of this.frontWheelPivots) pivot.rotation.y = 0;
  }

  get absSpeed()   { return Math.abs(this.speed); }
  get posX()       { return this.playerGroup.position.x; }
  get posZ()       { return this.playerGroup.position.z; }
  // Exposed for camera Z-roll: -1 (left), 0 (straight), +1 (right)
  get lateralDir() { return this._lateralDir; }
}

import * as THREE from 'three';
import { ROAD_HALF, laneToX } from './World.js';

// ---- Direct Mapping Steering ----
// Swap the move values (1 and -1) if steering feels backward.
const BINDINGS = {
  'a': { move: 1, wheel: -30 },
  'd': { move: -1, wheel: 30 },
};

// ---- Tuning ----
const MAX_SPEED       = 280;   // km/h
const ACCEL           = 48;    // km/h per second
const BRAKE_FORCE     = 65;
const ENGINE_BRAKE    = 10;
const LATERAL_SPEED   = 14;    // m/s lateral movement
const WHEEL_TURN_MAX  = Math.PI / 6; // 30 degrees

// ---- Toon / DS-style materials ----
const bodyMat  = new THREE.MeshToonMaterial({ color: 0x33cc55 }); // default green, changed by car select
const cabinMat = new THREE.MeshToonMaterial({ color: 0x222244, transparent: true, opacity: 0.7 });
const darkMat  = new THREE.MeshToonMaterial({ color: 0x111111 });
const wheelMat = new THREE.MeshToonMaterial({ color: 0x1a1a1a });
const hlMat    = new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0xffffcc, emissiveIntensity: 0.5 });
const tlMat    = new THREE.MeshToonMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.4 });

// Outline helper — black slightly-larger duplicate behind
function addOutline(parent, geo, scale) {
  const outMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  const outline = new THREE.Mesh(geo, outMat);
  outline.scale.multiplyScalar(scale || 1.06);
  parent.add(outline);
  return outline;
}

export { BINDINGS };

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

    // Rainbow mode
    this._rainbowMode = false;
    this._rainbowHue = 0;

    this._buildMesh();

    const startX = laneToX(1);
    this.playerGroup.position.set(startX, 0, 0);
    this._targetX = startX;
    scene.add(this.playerGroup);
  }

  // ---- Set car color ----
  setColor(colorName) {
    this._rainbowMode = false;
    const colorMap = {
      green:  0x33cc55,
      yellow: 0xffdd00,
      red:    0xff2200,
      blue:   0x3366ff,
    };
    if (colorName === 'rainbow') {
      this._rainbowMode = true;
      this._rainbowHue = 0;
    } else {
      bodyMat.color.setHex(colorMap[colorName] || 0x33cc55);
    }
  }

  // ---- Geometry ----
  _buildMesh() {
    // Chassis
    const chassisGeo = new THREE.BoxGeometry(2.0, 0.6, 4.2);
    const chassis = new THREE.Mesh(chassisGeo, bodyMat);
    chassis.position.y = 0.5;
    chassis.castShadow = true;
    this.playerGroup.add(chassis);
    addOutline(chassis, chassisGeo, 1.04);

    // Cabin
    const cabGeo = new THREE.BoxGeometry(1.7, 0.5, 2.0);
    const cabin = new THREE.Mesh(cabGeo, cabinMat);
    cabin.position.set(0, 1.0, -0.3);
    cabin.castShadow = true;
    this.playerGroup.add(cabin);

    // Front splitter
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.14, 0.4), darkMat);
    splitter.position.set(0, 0.25, 2.2);
    this.playerGroup.add(splitter);

    // Rear wing + supports
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.35), darkMat);
    wing.position.set(0, 1.3, -2.0);
    this.playerGroup.add(wing);
    for (const sx of [-0.7, 0.7]) {
      const sup = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), darkMat);
      sup.position.set(sx, 1.15, -2.0);
      this.playerGroup.add(sup);
    }

    // ---- Wheels ----
    const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);

    // Front wheels
    for (const x of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.35, 1.3);
      const wheel = new THREE.Mesh(wGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      pivot.add(wheel);
      this.playerGroup.add(pivot);
      this.frontWheelPivots.push(pivot);
      this.allWheels.push(wheel);
    }

    // Rear wheels
    for (const x of [-1, 1]) {
      const wheel = new THREE.Mesh(wGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.35, -1.3);
      wheel.castShadow = true;
      this.playerGroup.add(wheel);
      this.allWheels.push(wheel);
    }

    // Headlights
    const hlGeo = new THREE.SphereGeometry(0.14, 8, 8);
    for (const sx of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(hlGeo, hlMat);
      hl.position.set(sx, 0.55, 2.15);
      this.playerGroup.add(hl);
    }

    // Tail lights
    const tlGeo = new THREE.BoxGeometry(0.28, 0.1, 0.05);
    for (const sx of [-0.7, 0.7]) {
      const tl = new THREE.Mesh(tlGeo, tlMat);
      tl.position.set(sx, 0.55, -2.15);
      this.playerGroup.add(tl);
    }
  }

  // ---- Per-frame update ----
  update(dt, input) {
    // ---- Forward speed ----
    if (input.gas) {
      this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    } else if (input.brake) {
      this.speed = Math.max(0, this.speed - BRAKE_FORCE * dt);
    } else {
      this.speed = Math.max(0, this.speed - ENGINE_BRAKE * dt);
    }

    const speedMs = this.speed / 3.6;

    // ---- Lateral: direct mapping from BINDINGS ----
    this._lateralDir = 0;
    if (input.moveDir !== undefined && input.moveDir !== 0) {
      this._lateralDir = input.moveDir;
    }

    this._targetX += this._lateralDir * LATERAL_SPEED * dt;

    // Barrier clamp
    const limit = ROAD_HALF - 1.6;
    if (this._targetX < -limit) this._targetX = -limit;
    if (this._targetX >  limit) this._targetX =  limit;

    // Smooth lerp
    const alpha = 1 - Math.pow(0.0001, dt);
    this.playerGroup.position.x = THREE.MathUtils.lerp(
      this.playerGroup.position.x, this._targetX, alpha
    );

    // Forward
    this.playerGroup.position.z += speedMs * dt;
    this.playerGroup.position.y = 0;

    // No yaw
    this.playerGroup.rotation.set(0, 0, 0);

    // ---- Front wheel steering visual ----
    const wheelAngle = (input.wheelAngle || 0) * (Math.PI / 180);
    for (const pivot of this.frontWheelPivots) {
      pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, wheelAngle, alpha);
    }

    // ---- Wheel spin (all 4) ----
    const spin = speedMs * dt * 3;
    for (const w of this.allWheels) w.rotation.x += spin;

    // ---- Rainbow mode ----
    if (this._rainbowMode) {
      this._rainbowHue = (this._rainbowHue + dt * 0.5) % 1;
      bodyMat.color.setHSL(this._rainbowHue, 0.9, 0.55);
    }
  }

  // ---- Reset ----
  reset() {
    this.speed = 0;
    this._lateralDir = 0;
    const startX = laneToX(1);
    this._targetX = startX;
    this.playerGroup.position.set(startX, 0, 0);
    this.playerGroup.rotation.set(0, 0, 0);
    for (const pivot of this.frontWheelPivots) pivot.rotation.y = 0;
  }

  get absSpeed() { return Math.abs(this.speed); }
  get posX()     { return this.playerGroup.position.x; }
  get posZ()     { return this.playerGroup.position.z; }
}

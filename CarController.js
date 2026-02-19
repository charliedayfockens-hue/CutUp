import * as THREE from 'three';
import { ROAD_HALF, laneToX } from './World.js';

// ---- Tuning ----
const MAX_SPEED       = 280;   // km/h
const ACCEL           = 48;    // km/h per second
const BRAKE_FORCE     = 65;
const ENGINE_BRAKE    = 10;
const LATERAL_SPEED   = 14;    // m/s lateral movement
const WHEEL_TURN_MAX  = Math.PI / 6; // 30 degrees

// Materials
const bodyMat  = new THREE.MeshStandardMaterial({ color: 0xff2200, roughness: 0.3, metalness: 0.7 });
const cabinMat = new THREE.MeshStandardMaterial({ color: 0x222244, roughness: 0.1, metalness: 0.8, transparent: true, opacity: 0.7 });
const darkMat  = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.5 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7, metalness: 0.3 });
const hlMat    = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffcc, emissiveIntensity: 0.5 });
const tlMat    = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.4 });

export class CarController {
  constructor(scene) {
    this.scene = scene;

    // The single Group that holds the entire car — swap children to load a 3D model later.
    this.playerGroup = new THREE.Group();

    // Wheel references
    this.frontWheelPivots = [];
    this.allWheels = [];

    // State — simple and linear, no drift/slide
    this.speed = 0;          // km/h (forward)
    this._targetX = 0;       // lateral target for lerp
    this._lateralDir = 0;    // current frame lateral input: -1 / 0 / +1

    this._buildMesh();

    const startX = laneToX(1);
    this.playerGroup.position.set(startX, 0, 0);
    this._targetX = startX;
    scene.add(this.playerGroup);
  }

  // ---- Geometry ----
  _buildMesh() {
    // Chassis
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 4.2), bodyMat);
    chassis.position.y = 0.5;
    chassis.castShadow = true;
    this.playerGroup.add(chassis);

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.0), cabinMat);
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

    // Front wheels — pivot groups for Y-axis steering visual
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

    // Rear wheels — no pivot
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
      // Engine braking
      this.speed = Math.max(0, this.speed - ENGINE_BRAKE * dt);
    }

    const speedMs = this.speed / 3.6;

    // ---- Lateral: direct, linear, unambiguous ----
    // A / ArrowLeft  → -X → visual left on screen
    // D / ArrowRight → +X → visual right on screen
    this._lateralDir = 0;
    if (input.left)  this._lateralDir = -1;
    if (input.right) this._lateralDir =  1;

    this._targetX += this._lateralDir * LATERAL_SPEED * dt;

    // Barrier clamp
    const limit = ROAD_HALF - 1.6;
    if (this._targetX < -limit) this._targetX = -limit;
    if (this._targetX >  limit) this._targetX =  limit;

    // Smooth lerp — frame-rate independent
    const alpha = 1 - Math.pow(0.0001, dt);
    this.playerGroup.position.x = THREE.MathUtils.lerp(
      this.playerGroup.position.x, this._targetX, alpha
    );

    // Forward
    this.playerGroup.position.z += speedMs * dt;
    this.playerGroup.position.y = 0;

    // ---- Visual: body stays parallel to road (no yaw) ----
    this.playerGroup.rotation.set(0, 0, 0);

    // ---- Front wheel steering visual ----
    // Negative Y rotation = wheels point right (+X), positive = left (-X)
    const wheelAngle = -this._lateralDir * WHEEL_TURN_MAX;
    for (const pivot of this.frontWheelPivots) {
      // Smooth the wheel turn
      pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, wheelAngle, alpha);
    }

    // ---- Wheel spin (all 4) ----
    const spin = speedMs * dt * 3;
    for (const w of this.allWheels) w.rotation.x += spin;
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

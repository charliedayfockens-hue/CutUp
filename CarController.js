import * as THREE from 'three';
import { ROAD_HALF, laneToX } from './World.js';

// ---- Tuning constants ----
const MAX_SPEED       = 280;   // km/h
const ACCEL           = 48;    // km/h per second
const BRAKE_FORCE     = 65;
const ENGINE_BRAKE    = 10;
const STEER_SPEED     = 2.8;
const STEER_RETURN    = 4.5;
const MAX_STEER       = 0.6;
const GRIP            = 0.95;
const DRIFT_GRIP      = 0.90;
const LATERAL_LERP    = 12;    // lerp speed for smooth lane changes
const WHEEL_TURN_MAX  = Math.PI / 6; // 30 degrees max front-wheel turn

// Materials (shared, created once)
const bodyMat  = new THREE.MeshStandardMaterial({ color: 0xff2200, roughness: 0.3, metalness: 0.7 });
const cabinMat = new THREE.MeshStandardMaterial({ color: 0x222244, roughness: 0.1, metalness: 0.8, transparent: true, opacity: 0.7 });
const darkMat  = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.5 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7, metalness: 0.3 });
const hlMat    = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffcc, emissiveIntensity: 0.5 });
const tlMat    = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.4 });

export class CarController {
  constructor(scene) {
    this.scene = scene;
    this.mesh = new THREE.Group();

    // Wheel arrays — separated for steering visuals
    this.frontWheelPivots = [];  // Group pivots that rotate on Y for steering
    this.allWheels = [];         // All 4 wheel meshes for spin

    // State
    this.speed = 0;            // km/h
    this.steer = 0;            // current steer value (-MAX_STEER .. +MAX_STEER)
    this.lateralVel = 0;       // physics lateral velocity
    this._targetX = 0;         // smoothed lateral target position
    this.drifting = false;
    this.heat = 0;

    this._buildMesh();

    // Place at lane 1
    const startX = laneToX(1);
    this.mesh.position.set(startX, 0, 0);
    this._targetX = startX;
    scene.add(this.mesh);
  }

  // ---- Build car geometry ----
  _buildMesh() {
    // Chassis
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 4.2), bodyMat);
    chassis.position.y = 0.5;
    chassis.castShadow = true;
    this.mesh.add(chassis);

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.0), cabinMat);
    cabin.position.set(0, 1.0, -0.3);
    cabin.castShadow = true;
    this.mesh.add(cabin);

    // Front splitter
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.14, 0.4), darkMat);
    splitter.position.set(0, 0.25, 2.2);
    this.mesh.add(splitter);

    // Rear wing + supports
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.35), darkMat);
    wing.position.set(0, 1.3, -2.0);
    this.mesh.add(wing);
    for (const sx of [-0.7, 0.7]) {
      const sup = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), darkMat);
      sup.position.set(sx, 1.15, -2.0);
      this.mesh.add(sup);
    }

    // ---- Wheels ----
    const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);

    // Front wheels (z = +1.3) — wrapped in pivot groups for Y-axis steering
    for (const x of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.35, 1.3);

      const wheel = new THREE.Mesh(wGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      pivot.add(wheel);

      this.mesh.add(pivot);
      this.frontWheelPivots.push(pivot);
      this.allWheels.push(wheel);
    }

    // Rear wheels (z = -1.3) — no pivot needed, attached directly
    for (const x of [-1, 1]) {
      const wheel = new THREE.Mesh(wGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.35, -1.3);
      wheel.castShadow = true;
      this.mesh.add(wheel);
      this.allWheels.push(wheel);
    }

    // Headlights
    const hlGeo = new THREE.SphereGeometry(0.14, 8, 8);
    for (const sx of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(hlGeo, hlMat);
      hl.position.set(sx, 0.55, 2.15);
      this.mesh.add(hl);
    }

    // Tail lights
    const tlGeo = new THREE.BoxGeometry(0.28, 0.1, 0.05);
    for (const sx of [-0.7, 0.7]) {
      const tl = new THREE.Mesh(tlGeo, tlMat);
      tl.position.set(sx, 0.55, -2.15);
      this.mesh.add(tl);
    }
  }

  // ---- Per-frame update ----
  update(dt, input) {
    // ---- Acceleration / braking ----
    if (input.gas) {
      this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    } else if (input.brake) {
      this.speed = Math.max(-20, this.speed - BRAKE_FORCE * dt);
    } else {
      if (this.speed > 0)      this.speed = Math.max(0, this.speed - ENGINE_BRAKE * dt);
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + ENGINE_BRAKE * dt);
    }

    const speedMs = this.speed / 3.6;

    // ---- Steering input ----
    // Left (A) produces positive steer → positive lateralVel → _targetX decreases → car moves to -X → screen left.
    // Right (D) produces negative steer → negative lateralVel → _targetX increases → car moves to +X → screen right.
    const sIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    if (sIn !== 0) {
      this.steer += sIn * STEER_SPEED * dt;
      this.steer = THREE.MathUtils.clamp(this.steer, -MAX_STEER, MAX_STEER);
    } else {
      // Auto-return to center
      if (Math.abs(this.steer) < 0.04) this.steer = 0;
      else this.steer -= Math.sign(this.steer) * STEER_RETURN * dt;
    }

    // ---- Lateral force ----
    const sFactor = Math.min(1, Math.abs(speedMs) / 10);
    const latForce = this.steer * speedMs * 0.6 * sFactor;

    // ---- Drift / grip ----
    if (input.drift && Math.abs(speedMs) > 5) {
      this.drifting = true;
      this.lateralVel += latForce * dt * 2;
      this.lateralVel *= DRIFT_GRIP;
      this.speed *= 0.998;
      this.heat = Math.min(100, this.heat + 15 * dt);
    } else {
      this.drifting = false;
      this.lateralVel += latForce * dt;
      this.lateralVel *= GRIP;
    }

    // ---- Heat ----
    if (!this.drifting) this.heat = Math.max(0, this.heat - 5 * dt);
    if (this.heat >= 100) this.speed *= 0.99;

    // ---- Position: forward (Z) is direct, lateral (X) is lerped ----
    this.mesh.position.z += speedMs * dt;
    this.mesh.position.y = 0;

    // Physics target for lateral position
    this._targetX -= this.lateralVel * dt;

    // Barrier clamp on target
    if (Math.abs(this._targetX) > ROAD_HALF - 1.5) {
      this.lateralVel *= -0.5;
      this._targetX = Math.sign(this._targetX) * (ROAD_HALF - 1.6);
      this.speed *= 0.9;
      this.heat = Math.min(100, this.heat + 5);
    }

    // Smooth lerp toward target X — eliminates jitter on fast key taps
    const lerpAlpha = 1 - Math.pow(0.001, dt);  // frame-rate independent, ~smooth at any fps
    this.mesh.position.x = THREE.MathUtils.lerp(this.mesh.position.x, this._targetX, lerpAlpha);

    // ---- Visual: body stays PARALLEL to highway (no yaw/roll/pitch) ----
    this.mesh.rotation.set(0, 0, 0);

    // ---- Visual: front wheels turn on Y-axis ----
    // Map steer value to wheel angle (inverted because steer>0 = turning left)
    const wheelAngle = -(this.steer / MAX_STEER) * WHEEL_TURN_MAX;
    for (const pivot of this.frontWheelPivots) {
      pivot.rotation.y = wheelAngle;
    }

    // ---- Wheel spin (all 4) ----
    const spin = speedMs * dt * 3;
    for (const w of this.allWheels) w.rotation.x += spin;
  }

  // ---- Reset for new game ----
  reset() {
    this.speed = 0;
    this.steer = 0;
    this.lateralVel = 0;
    this.drifting = false;
    this.heat = 0;
    const startX = laneToX(1);
    this._targetX = startX;
    this.mesh.position.set(startX, 0, 0);
    this.mesh.rotation.set(0, 0, 0);
    for (const pivot of this.frontWheelPivots) pivot.rotation.y = 0;
  }

  get absSpeed() { return Math.abs(this.speed); }
  get posX() { return this.mesh.position.x; }
  get posZ() { return this.mesh.position.z; }
}

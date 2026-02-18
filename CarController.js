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

// Materials (shared)
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
    this.wheels = [];

    // State
    this.speed = 0;            // km/h
    this.steer = 0;
    this.lateralVel = 0;
    this.drifting = false;
    this.heat = 0;

    this._buildMesh();

    // Place at lane 1
    this.mesh.position.set(laneToX(1), 0, 0);
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

    // Wheels
    const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
    const positions = [[-1, 0.35, 1.3], [1, 0.35, 1.3], [-1, 0.35, -1.3], [1, 0.35, -1.3]];
    for (const [x, y, z] of positions) {
      const w = new THREE.Mesh(wGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, y, z);
      w.castShadow = true;
      this.mesh.add(w);
      this.wheels.push(w);
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
    // Acceleration / braking
    if (input.gas) {
      this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    } else if (input.brake) {
      this.speed = Math.max(-20, this.speed - BRAKE_FORCE * dt);
    } else {
      // Engine braking towards 0
      if (this.speed > 0)      this.speed = Math.max(0, this.speed - ENGINE_BRAKE * dt);
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + ENGINE_BRAKE * dt);
    }

    const speedMs = this.speed / 3.6;

    // Steering
    const sIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    if (sIn !== 0) {
      this.steer += sIn * STEER_SPEED * dt;
      this.steer = THREE.MathUtils.clamp(this.steer, -MAX_STEER, MAX_STEER);
    } else {
      if (Math.abs(this.steer) < 0.04) this.steer = 0;
      else this.steer -= Math.sign(this.steer) * STEER_RETURN * dt;
    }

    // Lateral force from steering
    const sFactor = Math.min(1, Math.abs(speedMs) / 10);
    const latForce = this.steer * speedMs * 0.6 * sFactor;

    // Drift / grip
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

    // Heat decay
    if (!this.drifting) this.heat = Math.max(0, this.heat - 5 * dt);
    // Heat penalty
    if (this.heat >= 100) this.speed *= 0.99;

    // Move
    this.mesh.position.z += speedMs * dt;
    this.mesh.position.x -= this.lateralVel * dt;
    this.mesh.position.y = 0;

    // Barrier bounce
    if (Math.abs(this.mesh.position.x) > ROAD_HALF - 1.5) {
      this.lateralVel *= -0.5;
      this.mesh.position.x = Math.sign(this.mesh.position.x) * (ROAD_HALF - 1.6);
      this.speed *= 0.9;
      this.heat = Math.min(100, this.heat + 5);
    }

    // Visual rotation
    this.mesh.rotation.y = this.steer * 0.3;
    this.mesh.rotation.z = this.lateralVel * 0.02;
    this.mesh.rotation.x = -this.steer * 0.12;

    // Wheel spin
    const spin = speedMs * dt * 3;
    for (const w of this.wheels) w.rotation.x += spin;
  }

  // Reset for new game
  reset() {
    this.speed = 0;
    this.steer = 0;
    this.lateralVel = 0;
    this.drifting = false;
    this.heat = 0;
    this.mesh.position.set(laneToX(1), 0, 0);
    this.mesh.rotation.set(0, 0, 0);
  }

  get absSpeed() { return Math.abs(this.speed); }
  get posX() { return this.mesh.position.x; }
  get posZ() { return this.mesh.position.z; }
}

import * as THREE from 'three';
import { LANE_COUNT, LANE_WIDTH, laneToX } from './World.js';

// ---- Config ----
const POOL_SIZE        = 30;
const SPAWN_AHEAD      = 300;
const DESPAWN_BEHIND   = 80;
const MIN_SPEED        = 60;   // km/h
const MAX_SPEED        = 120;
const LANE_CHANGE_P    = 0.003;
const NEAR_MISS_DIST   = 2.5;
const NEAR_MISS_Z      = 5;

const COLORS = [
  0xff3333, 0x3355ff, 0x33cc55, 0xffee33, 0xff33ff,
  0x33eeff, 0xff8833, 0x8833ff, 0xeeeeee, 0x444444,
  0xff6600, 0x0066ff, 0x00cc44, 0xcc0044
];

// Shared geometry (toon materials for DS look)
const sedanBodyGeo  = new THREE.BoxGeometry(1.9, 0.55, 4.0);
const sedanCabGeo   = new THREE.BoxGeometry(1.6, 0.45, 1.8);
const suvBodyGeo    = new THREE.BoxGeometry(2.1, 0.8, 4.5);
const suvCabGeo     = new THREE.BoxGeometry(1.8, 0.55, 2.2);
const truckBodyGeo  = new THREE.BoxGeometry(2.2, 1.5, 5.5);
const wheelGeo      = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10);
const wheelMat      = new THREE.MeshToonMaterial({ color: 0x222222 });
const cabMat        = new THREE.MeshToonMaterial({ color: 0x334455, transparent: true, opacity: 0.6 });
const tlGeo         = new THREE.BoxGeometry(0.2, 0.1, 0.05);
const tlMat         = new THREE.MeshToonMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.3 });

// Outline material for cel-shaded look
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export class TrafficManager {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.spawnAccum = 0;
    this.onNearMiss = null;
    this._buildPool();
  }

  _buildPool() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const car = this._createCar();
      car.visible = false;
      car.userData = {
        active: false,
        speed: 0,
        lane: 0,
        targetLane: 0,
        lcTimer: 0,
        nearMissCounted: false,
        halfW: 0.95,
        halfL: 2.0,
        bodyMesh: car.children[0]
      };
      this.pool.push(car);
      this.scene.add(car);
    }
  }

  _createCar() {
    const g = new THREE.Group();
    const col = randomColor();
    const t = Math.random();

    if (t < 0.5) {
      // Sedan
      const body = new THREE.Mesh(sedanBodyGeo, new THREE.MeshToonMaterial({ color: col }));
      body.position.y = 0.5;
      body.castShadow = true;
      g.add(body);
      // Outline
      const outline = new THREE.Mesh(sedanBodyGeo, outlineMat.clone());
      outline.position.y = 0.5;
      outline.scale.multiplyScalar(1.04);
      g.add(outline);
      const cab = new THREE.Mesh(sedanCabGeo, cabMat);
      cab.position.set(0, 0.97, -0.2);
      g.add(cab);
      g.userData.halfL = 2.0;
      g.userData.halfW = 0.95;
    } else if (t < 0.8) {
      // SUV
      const body = new THREE.Mesh(suvBodyGeo, new THREE.MeshToonMaterial({ color: col }));
      body.position.y = 0.65;
      body.castShadow = true;
      g.add(body);
      const outline = new THREE.Mesh(suvBodyGeo, outlineMat.clone());
      outline.position.y = 0.65;
      outline.scale.multiplyScalar(1.04);
      g.add(outline);
      const cab = new THREE.Mesh(suvCabGeo, cabMat);
      cab.position.set(0, 1.3, -0.3);
      g.add(cab);
      g.userData.halfL = 2.25;
      g.userData.halfW = 1.05;
    } else {
      // Truck
      const body = new THREE.Mesh(truckBodyGeo, new THREE.MeshToonMaterial({ color: col }));
      body.position.y = 0.95;
      body.castShadow = true;
      g.add(body);
      const outline = new THREE.Mesh(truckBodyGeo, outlineMat.clone());
      outline.position.y = 0.95;
      outline.scale.multiplyScalar(1.04);
      g.add(outline);
      g.userData.halfL = 2.75;
      g.userData.halfW = 1.1;
    }

    // Wheels
    for (const [x, z] of [[-0.85, 1.2], [0.85, 1.2], [-0.85, -1.2], [0.85, -1.2]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.3, z);
      g.add(w);
    }

    // Tail lights
    for (const sx of [-0.6, 0.6]) {
      const tl = new THREE.Mesh(tlGeo, tlMat);
      tl.position.set(sx, 0.55, -(g.userData.halfL || 2.0));
      g.add(tl);
    }

    return g;
  }

  _getInactive() {
    for (const c of this.pool) if (!c.userData.active) return c;
    return null;
  }

  _spawn(playerZ, distanceTraveled) {
    const targetCount = Math.min(POOL_SIZE, 12 + Math.floor(distanceTraveled / 500));
    let active = 0;
    for (const c of this.pool) if (c.userData.active) active++;
    if (active >= targetCount) return;

    const car = this._getInactive();
    if (!car) return;

    const lane = Math.floor(Math.random() * LANE_COUNT);
    const x = laneToX(lane);
    const z = playerZ + SPAWN_AHEAD + Math.random() * 100;

    for (const o of this.pool) {
      if (o.userData.active && Math.abs(o.position.z - z) < 10 && Math.abs(o.position.x - x) < 3) return;
    }

    car.visible = true;
    car.userData.active = true;
    car.userData.lane = lane;
    car.userData.targetLane = lane;
    car.userData.speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    car.userData.lcTimer = 0;
    car.userData.nearMissCounted = false;
    car.position.set(x, 0, z);
    car.rotation.set(0, 0, 0);

    const nc = randomColor();
    car.children[0].material.color.setHex(nc);
  }

  update(dt, playerX, playerZ, playerSpeed, distanceTraveled) {
    this.spawnAccum += dt;
    if (this.spawnAccum > 0.3) {
      this._spawn(playerZ, distanceTraveled);
      this.spawnAccum = 0;
    }

    for (const car of this.pool) {
      if (!car.userData.active) continue;
      const d = car.userData;

      car.position.z += (d.speed / 3.6) * dt;

      d.lcTimer -= dt;
      if (d.lcTimer <= 0 && Math.random() < LANE_CHANGE_P) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        const nl = d.targetLane + dir;
        if (nl >= 0 && nl < LANE_COUNT) {
          let clear = true;
          for (const o of this.pool) {
            if (o === car || !o.userData.active) continue;
            if (o.userData.lane === nl && Math.abs(o.position.z - car.position.z) < 12) { clear = false; break; }
          }
          if (clear) {
            d.targetLane = nl;
            d.lcTimer = 3 + Math.random() * 5;
          }
        }
      }

      const tx = laneToX(d.targetLane);
      car.position.x += (tx - car.position.x) * dt * 2.5;
      if (Math.abs(car.position.x - tx) < 0.1) d.lane = d.targetLane;

      if (car.position.z < playerZ - DESPAWN_BEHIND) {
        car.visible = false;
        d.active = false;
        continue;
      }

      if (!d.nearMissCounted) {
        const dx = Math.abs(car.position.x - playerX);
        const dz = Math.abs(car.position.z - playerZ);
        if (dx < NEAR_MISS_DIST && dz < NEAR_MISS_Z && playerSpeed > d.speed * 1.2) {
          d.nearMissCounted = true;
          if (this.onNearMiss) this.onNearMiss();
        }
      }
    }
  }

  checkCollision(px, pz, pHalfW, pHalfL) {
    for (const car of this.pool) {
      if (!car.userData.active) continue;
      const d = car.userData;
      if (
        Math.abs(px - car.position.x) < (pHalfW + d.halfW) * 0.85 &&
        Math.abs(pz - car.position.z) < (pHalfL + d.halfL) * 0.85
      ) {
        return true;
      }
    }
    return false;
  }

  reset() {
    for (const car of this.pool) {
      car.visible = false;
      car.userData.active = false;
    }
    this.spawnAccum = 0;
  }
}

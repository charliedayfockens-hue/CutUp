import * as THREE from 'three';

// ---- Constants ----
export const LANE_COUNT = 4;
export const LANE_WIDTH = 3.8;
export const ROAD_WIDTH = LANE_COUNT * LANE_WIDTH + 4; // + shoulders
export const ROAD_HALF = ROAD_WIDTH / 2;
export const SEGMENT_LEN = 60;
const SEGMENT_POOL = 24;

export function laneToX(lane) {
  return (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
}

// ---- Shared materials (created once) ----
const asphaltMat  = new THREE.MeshStandardMaterial({ color: 0x333338, roughness: 0.85 });
const dashMat     = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
const yellowMat   = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.5 });
const edgeMat     = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
const barrierMat  = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.4 });
const poleMat     = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.5 });
const lampMat     = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: 0.3 });
const grassMat    = new THREE.MeshStandardMaterial({ color: 0x3a5f2c, roughness: 0.95 });

// ---- Shared geometries (created once) ----
const roadGeo     = new THREE.PlaneGeometry(ROAD_WIDTH, SEGMENT_LEN);
const dashGeo     = new THREE.PlaneGeometry(0.15, 3);
const solidGeo    = new THREE.PlaneGeometry(0.2, SEGMENT_LEN);
const barrierGeo  = new THREE.BoxGeometry(0.3, 0.8, SEGMENT_LEN);
const poleGeo     = new THREE.CylinderGeometry(0.08, 0.08, 6, 6);
const lampGeo     = new THREE.SphereGeometry(0.25, 6, 6);

export class World {
  constructor(scene) {
    this.scene = scene;
    this.segments = [];
    this.sunLight = null;
    this.ambientLight = null;
    this.hemiLight = null;
    this.fog = null;
    this.dayNightT = 0;

    this._buildLighting();
    this._buildGround();
    this._buildSegmentPool();
  }

  // ---- Lighting ----
  _buildLighting() {
    // Ambient — always-on base fill so nothing is ever black
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambientLight);

    // Hemisphere — sky/ground color bleed
    this.hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3a5f2c, 0.4);
    this.scene.add(this.hemiLight);

    // Directional "sun" — the primary light with shadows
    this.sunLight = new THREE.DirectionalLight(0xfff5e0, 1.2);
    this.sunLight.position.set(40, 60, 25);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.near = 1; sc.far = 250;
    sc.left = -60; sc.right = 60;
    sc.top = 60; sc.bottom = -60;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Fog
    this.fog = new THREE.FogExp2(0x87CEEB, 0.0022);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x87CEEB);
  }

  // ---- Ground plane ----
  _buildGround() {
    const geo = new THREE.PlaneGeometry(2000, 2000);
    const mesh = new THREE.Mesh(geo, grassMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.05;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ---- Road segment pool ----
  _buildSegmentPool() {
    for (let i = 0; i < SEGMENT_POOL; i++) {
      const seg = this._createSegment();
      seg.position.z = i * SEGMENT_LEN;
      this.segments.push(seg);
      this.scene.add(seg);
    }
  }

  _createSegment() {
    const g = new THREE.Group();

    // Road surface
    const road = new THREE.Mesh(roadGeo, asphaltMat);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01;
    road.receiveShadow = true;
    g.add(road);

    // Center double-yellow
    for (const off of [-0.2, 0.2]) {
      const m = new THREE.Mesh(solidGeo, yellowMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(off, 0.02, 0);
      g.add(m);
    }

    // Lane dashes
    const dashLen = 3, dashGap = 4;
    for (let lane = 1; lane < LANE_COUNT / 2; lane++) {
      for (const side of [-1, 1]) {
        const x = side * lane * LANE_WIDTH;
        for (let d = -SEGMENT_LEN / 2; d < SEGMENT_LEN / 2; d += dashLen + dashGap) {
          const m = new THREE.Mesh(dashGeo, dashMat);
          m.rotation.x = -Math.PI / 2;
          m.position.set(x, 0.02, d + dashLen / 2);
          g.add(m);
        }
      }
    }

    // Edge lines
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(solidGeo, edgeMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(side * (ROAD_HALF - 1.5), 0.02, 0);
      g.add(m);
    }

    // Barriers
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(barrierGeo, barrierMat);
      m.position.set(side * (ROAD_HALF + 0.15), 0.4, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }

    // Lamp posts
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(side * (ROAD_HALF + 2), 3, 0);
      pole.castShadow = true;
      g.add(pole);

      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(side * (ROAD_HALF + 2), 6, 0);
      g.add(lamp);
    }

    return g;
  }

  // ---- Recycle segments ----
  update(playerZ) {
    for (const seg of this.segments) {
      if (seg.position.z < playerZ - SEGMENT_LEN * 2) {
        let maxZ = -Infinity;
        for (const s of this.segments) {
          if (s.position.z > maxZ) maxZ = s.position.z;
        }
        seg.position.z = maxZ + SEGMENT_LEN;
      }
    }
  }

  // ---- Day/night cycle ----
  updateDayNight(dt, renderer) {
    this.dayNightT += dt * 0.02;
    const t = (Math.sin(this.dayNightT) + 1) / 2; // 0 = night, 1 = day

    // Sun orbit
    this.sunLight.position.x = Math.cos(this.dayNightT) * 80;
    this.sunLight.position.y = Math.sin(this.dayNightT) * 80 + 10;

    // Intensities
    this.sunLight.intensity   = THREE.MathUtils.lerp(0.08, 1.3, t);
    this.ambientLight.intensity = THREE.MathUtils.lerp(0.15, 0.5, t);
    this.hemiLight.intensity  = THREE.MathUtils.lerp(0.12, 0.4, t);

    // Sky color
    const day   = new THREE.Color(0x87CEEB);
    const night = new THREE.Color(0x0a0a2e);
    const sky   = night.clone().lerp(day, t);
    this.scene.background.copy(sky);
    this.fog.color.copy(sky);

    // Fog density
    this.fog.density = THREE.MathUtils.lerp(0.005, 0.0022, t);

    // Tone mapping exposure
    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.35, 1.0, t);
  }

  // Follow the player so sun/shadow stay relevant
  followPlayer(px, pz) {
    this.sunLight.target.position.set(px, 0, pz);
    this.sunLight.position.x = px + 40;
    this.sunLight.position.z = pz + 25;
  }
}

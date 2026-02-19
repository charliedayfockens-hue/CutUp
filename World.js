import * as THREE from 'three';

// ---- Constants ----
export const LANE_COUNT = 4;
export const LANE_WIDTH = 3.8;
export const ROAD_WIDTH = LANE_COUNT * LANE_WIDTH + 4;
export const ROAD_HALF  = ROAD_WIDTH / 2;
export const SEGMENT_LEN = 60;
const SEGMENT_POOL = 24;

export function laneToX(lane) {
  return (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
}

// ---- Theme definitions ----
const THEMES = {
  snow: {
    sky:        0xc8d8e8,
    fogColor:   0xc8d8e8,
    fogDensity: 0.004,
    sunColor:   0xd0e0ff,
    sunIntensity: 0.9,
    ambientIntensity: 0.55,
    hemiSky:    0xc8d8e8,
    hemiGround: 0xffffff,
    hemiIntensity: 0.4,
    road:       0x6a6a70,
    roadRough:  0.7,
    roadMetal:  0.15,
    exposure:   0.9,
  },
  desert: {
    sky:        0xdec89a,
    fogColor:   0xdec89a,
    fogDensity: 0.0018,
    sunColor:   0xfff0a0,
    sunIntensity: 1.5,
    ambientIntensity: 0.5,
    hemiSky:    0xffeebb,
    hemiGround: 0xc8a060,
    hemiIntensity: 0.45,
    road:       0x555550,
    roadRough:  0.9,
    roadMetal:  0.05,
    exposure:   1.1,
  },
  rain: {
    sky:        0x444455,
    fogColor:   0x444455,
    fogDensity: 0.005,
    sunColor:   0x889999,
    sunIntensity: 0.45,
    ambientIntensity: 0.35,
    hemiSky:    0x556666,
    hemiGround: 0x333344,
    hemiIntensity: 0.3,
    road:       0x222228,
    roadRough:  0.2,
    roadMetal:  0.6,
    exposure:   0.65,
  },
  day: {
    sky:        0x87CEEB,
    fogColor:   0x87CEEB,
    fogDensity: 0.0022,
    sunColor:   0xfff5e0,
    sunIntensity: 1.2,
    ambientIntensity: 0.5,
    hemiSky:    0x87CEEB,
    hemiGround: 0x555555,
    hemiIntensity: 0.4,
    road:       0x333338,
    roadRough:  0.85,
    roadMetal:  0.1,
    exposure:   1.0,
  },
};

// Cycle order for dynamic mode
const DYNAMIC_ORDER = ['day', 'snow', 'desert', 'rain'];
const DYNAMIC_INTERVAL = 60;

// ---- Shared geometries ----
const roadGeo    = new THREE.PlaneGeometry(ROAD_WIDTH, SEGMENT_LEN);
const dashGeo    = new THREE.PlaneGeometry(0.15, 3);
const solidGeo   = new THREE.PlaneGeometry(0.2, SEGMENT_LEN);
const barrierGeo = new THREE.BoxGeometry(0.3, 0.8, SEGMENT_LEN);
const poleGeo    = new THREE.CylinderGeometry(0.08, 0.08, 6, 6);
const lampGeo    = new THREE.SphereGeometry(0.25, 6, 6);

// ---- Toon materials for DS look ----
const asphaltMat = new THREE.MeshToonMaterial({ color: 0x333338 });
const dashMat    = new THREE.MeshToonMaterial({ color: 0xffffff });
const yellowMat  = new THREE.MeshToonMaterial({ color: 0xffcc00 });
const edgeMat    = new THREE.MeshToonMaterial({ color: 0xffffff });
const barrierMat = new THREE.MeshToonMaterial({ color: 0x888888 });
const poleMat    = new THREE.MeshToonMaterial({ color: 0x666666 });
const lampMat    = new THREE.MeshToonMaterial({ color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: 0.3 });

export class World {
  constructor(scene) {
    this.scene = scene;
    this.segments = [];
    this.sunLight = null;
    this.ambientLight = null;
    this.hemiLight = null;
    this.fog = null;

    this.theme = 'day';
    this._dynamicTimer = 0;
    this._dynamicIndex = 0;

    this._buildLighting();
    this._buildSegmentPool();
  }

  _buildLighting() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x555555, 0.4);
    this.scene.add(this.hemiLight);

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

    this.fog = new THREE.FogExp2(0x87CEEB, 0.0022);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x87CEEB);
  }

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

  reset() {
    for (let i = 0; i < this.segments.length; i++) {
      this.segments[i].position.z = i * SEGMENT_LEN;
    }
    this._dynamicTimer = 0;
    this._dynamicIndex = 0;
  }

  setTheme(name) {
    this.theme = name;
    if (name === 'dynamic') {
      this._dynamicIndex = 0;
      this._dynamicTimer = 0;
      this._applyThemeConfig(THEMES[DYNAMIC_ORDER[0]]);
    } else {
      this._applyThemeConfig(THEMES[name] || THEMES.day);
    }
  }

  _applyThemeConfig(cfg) {
    this.scene.background.setHex(cfg.sky);
    this.fog.color.setHex(cfg.fogColor);
    this.fog.density = cfg.fogDensity;

    this.sunLight.color.setHex(cfg.sunColor);
    this.sunLight.intensity = cfg.sunIntensity;
    this.ambientLight.intensity = cfg.ambientIntensity;
    this.hemiLight.color.setHex(cfg.hemiSky);
    this.hemiLight.groundColor.setHex(cfg.hemiGround);
    this.hemiLight.intensity = cfg.hemiIntensity;

    asphaltMat.color.setHex(cfg.road);
    asphaltMat.needsUpdate = true;
  }

  updateTheme(dt, renderer) {
    if (this.theme === 'dynamic') {
      this._dynamicTimer += dt;
      if (this._dynamicTimer >= DYNAMIC_INTERVAL) {
        this._dynamicTimer = 0;
        this._dynamicIndex = (this._dynamicIndex + 1) % DYNAMIC_ORDER.length;
      }

      const target = THEMES[DYNAMIC_ORDER[this._dynamicIndex]];
      const t = Math.min(1, dt * 2);

      this.scene.background.lerp(new THREE.Color(target.sky), t);
      this.fog.color.lerp(new THREE.Color(target.fogColor), t);
      this.fog.density += (target.fogDensity - this.fog.density) * t;

      this.sunLight.color.lerp(new THREE.Color(target.sunColor), t);
      this.sunLight.intensity += (target.sunIntensity - this.sunLight.intensity) * t;
      this.ambientLight.intensity += (target.ambientIntensity - this.ambientLight.intensity) * t;
      this.hemiLight.color.lerp(new THREE.Color(target.hemiSky), t);
      this.hemiLight.groundColor.lerp(new THREE.Color(target.hemiGround), t);
      this.hemiLight.intensity += (target.hemiIntensity - this.hemiLight.intensity) * t;

      asphaltMat.color.lerp(new THREE.Color(target.road), t);

      renderer.toneMappingExposure += (target.exposure - renderer.toneMappingExposure) * t;
    } else {
      const cfg = THEMES[this.theme] || THEMES.day;
      renderer.toneMappingExposure = cfg.exposure;
    }
  }

  followPlayer(px, pz) {
    this.sunLight.target.position.set(px, 0, pz);
    this.sunLight.position.x = px + 40;
    this.sunLight.position.z = pz + 25;
  }
}

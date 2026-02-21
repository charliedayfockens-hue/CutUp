// CarEditor.js — Unity-style custom car architect (v3)
// Uses THREE.TransformControls for gizmo-based transforms.
// W = Translate | E = Rotate | R = Scale
// Default 4 wheels are auto-spawned, locked in position, non-deletable.
// userData flags: isColorable, isWheel, isDeletable

import * as THREE from 'three';
import { OrbitControls }     from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const MAX_PARTS = 20; // excludes the 4 default wheels

const PART_TYPES = {
  box:      () => new THREE.BoxGeometry(1, 1, 1),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  sphere:   () => new THREE.SphereGeometry(0.5, 16, 12),
};

// Wheel geometry
const WHEEL_GEO = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);

// Matte black wheel material — stays black regardless of car color
const wheelBlackMat = new THREE.MeshToonMaterial({ color: 0x111111 });

// Exact wheel positions and names per spec
const WHEEL_DEFS = [
  { name: 'wheel_fl', x: -0.8, y: 0.4, z:  1.5 },   // Front Left
  { name: 'wheel_fr', x:  0.8, y: 0.4, z:  1.5 },   // Front Right
  { name: 'wheel_bl', x: -0.8, y: 0.4, z: -1.5 },   // Back Left
  { name: 'wheel_br', x:  0.8, y: 0.4, z: -1.5 },   // Back Right
];

// Shared toon material for spawned parts
const editorMat = new THREE.MeshToonMaterial({ color: 0x888888 });

let _idCounter = 0;
function nextId() { return `part_${++_idCounter}`; }

export class CarEditor {
  /**
   * @param {THREE.Scene}    scene
   * @param {THREE.Camera}   camera
   * @param {THREE.Renderer} renderer   — renderer.domElement = canvas
   * @param {SaveManager}    saveManager
   */
  constructor(scene, camera, renderer, saveManager) {
    this.scene       = scene;
    this.camera      = camera;
    this.renderer    = renderer;
    this._canvas     = renderer.domElement;
    this.saveManager = saveManager || null;

    // ---- Parts storage ----
    // Each entry: { mesh, id, name?, type, isDefault, isColorable, color, metadata }
    this.parts = [];
    this.selectedPartId = null;

    // ---- ID of the car currently being edited (null = new build) ----
    this.editingCarId = null;

    // ---- Car group used in gameplay ----
    this.customCarGroup = new THREE.Group();
    this.customCarGroup.visible = false;
    this.scene.add(this.customCarGroup);

    // ---- Editor-only scene objects ----
    this._gridHelper    = null;
    this._editorAmbient = null;
    this._editorDir     = null;

    // ---- Controls ----
    this._orbitControls     = null;
    this._transformControls = null;
    this._currentMode       = 'translate';

    // ---- Raycaster ----
    this._raycaster = new THREE.Raycaster();
    this._pointer   = new THREE.Vector2();

    // ---- Main color (synced from garage) ----
    this.mainColor = '#33cc55';

    // ---- Active state ----
    this.active = false;

    // ---- Bound handlers ----
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onKeyDown     = this._handleKeyDown.bind(this);

    // ---- Callbacks ----
    this.onDone = null;   // () => void — called when DONE is pressed

    this._initControls();
    this._buildUI();
    this._spawnDefaultWheels();
  }

  // ============================================================
  //  INIT CONTROLS (once, not per-enter)
  // ============================================================

  _initControls() {
    this._orbitControls = new OrbitControls(this.camera, this._canvas);
    this._orbitControls.enableDamping = true;
    this._orbitControls.dampingFactor = 0.12;
    this._orbitControls.minDistance   = 3;
    this._orbitControls.maxDistance   = 20;
    this._orbitControls.target.set(0, 0.8, 0);
    this._orbitControls.enabled       = false;

    this._transformControls = new TransformControls(this.camera, this._canvas);
    this._transformControls.setMode(this._currentMode);
    this.scene.add(this._transformControls);

    // Disable orbit while dragging a gizmo
    this._transformControls.addEventListener('dragging-changed', e => {
      this._orbitControls.enabled = this.active && !e.value;
    });

    // Sync metadata every time the gizmo changes the object
    this._transformControls.addEventListener('objectChange', () => {
      this._syncMetadataFromMesh();
      this._refreshInfoPanel();
    });
  }

  // ============================================================
  //  ENTER / EXIT
  // ============================================================

  /**
   * @param {string}      mainColor  — hex color or 'rainbow'/'galaxy'
   * @param {string|null} carId      — existing car ID to load, or null for new
   */
  enter(mainColor, carId) {
    this.active    = true;
    this.mainColor = mainColor || this.mainColor;
    this.editingCarId = carId || null;

    if (carId && this.saveManager) {
      const saved = this.saveManager.getCar(carId);
      if (saved) {
        this.importParts(saved.parts, saved.mainColor || this.mainColor);
      }
    } else {
      // Fresh canvas — keep only the default wheels
      this._resetToDefaultWheels();
    }

    this.applyMainColor(this.mainColor);

    this.customCarGroup.visible = true;
    this.customCarGroup.position.set(0, 0, 0);
    this.customCarGroup.rotation.set(0, 0, 0);

    this._setupEnv();

    this._orbitControls.enabled = true;
    this._orbitControls.target.set(0, 0.8, 0);
    this.camera.position.set(5, 4, 6);
    this.camera.lookAt(0, 0.8, 0);

    const panel = document.getElementById('editor-panel');
    if (panel) panel.style.display = 'flex';

    document.addEventListener('keydown', this._onKeyDown);
    this._canvas.addEventListener('pointerdown', this._onPointerDown);

    this._updatePartsCount();
    this._updatePartsList();
    this._refreshInfoPanel();
    this._updateModeIndicator();
  }

  exit() {
    this.active = false;
    this._transformControls.detach();
    this._teardownEnv();
    this._orbitControls.enabled = false;

    const panel = document.getElementById('editor-panel');
    if (panel) panel.style.display = 'none';

    document.removeEventListener('keydown', this._onKeyDown);
    this._canvas.removeEventListener('pointerdown', this._onPointerDown);
  }

  // ============================================================
  //  ENVIRONMENT
  // ============================================================

  _setupEnv() {
    this._gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
    this.scene.add(this._gridHelper);

    this._editorAmbient = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(this._editorAmbient);

    this._editorDir = new THREE.DirectionalLight(0xffffff, 0.85);
    this._editorDir.position.set(5, 10, 5);
    this.scene.add(this._editorDir);
  }

  _teardownEnv() {
    for (const obj of [this._gridHelper, this._editorAmbient, this._editorDir]) {
      if (obj) { this.scene.remove(obj); if (obj.dispose) obj.dispose(); }
    }
    this._gridHelper = this._editorAmbient = this._editorDir = null;
  }

  // ============================================================
  //  DEFAULT WHEELS — auto-spawned, fixed, non-deletable
  // ============================================================

  _spawnDefaultWheels() {
    for (const def of WHEEL_DEFS) {
      // Matte black — never follows car color (clone so dispose is safe)
      const mesh = new THREE.Mesh(WHEEL_GEO, wheelBlackMat.clone());
      mesh.name            = def.name;
      mesh.rotation.z      = Math.PI / 2;
      mesh.castShadow      = true;
      mesh.position.set(def.x, def.y, def.z);

      // userData flags for gameplay and editor
      mesh.userData.isColorable  = false;  // stays matte black
      mesh.userData.isWheel      = true;
      mesh.userData.isDeletable  = false;

      const id = nextId();
      mesh.userData.editorId = id;
      this.customCarGroup.add(mesh);

      this.parts.push({
        mesh,
        id,
        name:        def.name,
        type:        'cylinder',
        isDefault:   true,
        isColorable: false,
        color:       '#111111',
        metadata: {
          pos:   { x: def.x, y: def.y, z: def.z },
          rot:   { x: 0, y: 0, z: 90 },
          scale: { x: 1, y: 1, z: 1 },
        },
      });
    }
  }

  _resetToDefaultWheels() {
    // Remove all parts (both user and default) then re-spawn fresh wheels
    this._transformControls.detach();
    this.selectedPartId = null;

    for (const p of this.parts) {
      this.customCarGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.parts = [];
    this._spawnDefaultWheels();
  }

  // ============================================================
  //  PART MANAGEMENT
  // ============================================================

  get _userPartCount() {
    return this.parts.filter(p => !p.isDefault).length;
  }

  spawnPart(type) {
    if (this._userPartCount >= MAX_PARTS) return null;
    if (!PART_TYPES[type]) return null;

    const geo  = PART_TYPES[type]();
    const mat  = editorMat.clone();
    mat.color.set(this.mainColor);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(0, 0.5, 0);

    // userData flags
    mesh.userData.isColorable = true;
    mesh.userData.isWheel     = false;
    mesh.userData.isDeletable = true;

    const id = nextId();
    mesh.userData.editorId = id;
    this.customCarGroup.add(mesh);

    const entry = {
      mesh,
      id,
      type,
      isDefault:   false,
      isColorable: true,
      color:       this.mainColor,
      metadata: {
        pos:   { x: 0, y: 0.5, z: 0 },
        rot:   { x: 0, y: 0,   z: 0 },
        scale: { x: 1, y: 1,   z: 1 },
      },
    };
    this.parts.push(entry);
    this.selectPart(id);
    this._updatePartsCount();
    return entry;
  }

  removePart(id) {
    const idx = this.parts.findIndex(p => p.id === id);
    if (idx === -1) return;
    const entry = this.parts[idx];
    if (entry.isDefault) return; // wheels are locked

    if (this.selectedPartId === id) {
      this._transformControls.detach();
      this.selectedPartId = null;
    }

    this.customCarGroup.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
    this.parts.splice(idx, 1);

    this._updatePartsCount();
    this._updatePartsList();
    this._refreshInfoPanel();
  }

  removeSelected() {
    if (this.selectedPartId) this.removePart(this.selectedPartId);
  }

  selectPart(id) {
    const part = this.parts.find(p => p.id === id);
    if (!part) return;

    this.selectedPartId = id;

    // Gizmo only attaches to non-default, non-wheel parts
    if (!part.isDefault && !part.mesh.userData.isWheel) {
      this._transformControls.attach(part.mesh);
    } else {
      this._transformControls.detach();
    }

    this._updatePartsList();
    this._refreshInfoPanel();
  }

  getSelected() {
    return this.parts.find(p => p.id === this.selectedPartId) || null;
  }

  clearUserParts() {
    this._transformControls.detach();
    this.selectedPartId = null;

    for (const p of this.parts.filter(p => !p.isDefault)) {
      this.customCarGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.parts = this.parts.filter(p => p.isDefault);

    this._updatePartsCount();
    this._updatePartsList();
    this._refreshInfoPanel();
  }

  // ============================================================
  //  TRANSFORM MODE
  // ============================================================

  setMode(mode) {
    this._currentMode = mode;
    this._transformControls.setMode(mode);
    this._updateModeIndicator();
  }

  _updateModeIndicator() {
    const el = document.getElementById('editor-mode-indicator');
    if (!el) return;
    const labels = { translate: 'W MOVE', rotate: 'E ROTATE', scale: 'R SCALE' };
    el.textContent = labels[this._currentMode] || this._currentMode.toUpperCase();
  }

  // ============================================================
  //  METADATA SYNC
  // ============================================================

  _syncMetadataFromMesh() {
    const part = this.getSelected();
    if (!part || part.isDefault) return;

    const m = part.mesh;
    part.metadata.pos   = { x: m.position.x, y: m.position.y, z: m.position.z };
    part.metadata.rot   = {
      x: THREE.MathUtils.radToDeg(m.rotation.x),
      y: THREE.MathUtils.radToDeg(m.rotation.y),
      z: THREE.MathUtils.radToDeg(m.rotation.z),
    };
    part.metadata.scale = { x: m.scale.x, y: m.scale.y, z: m.scale.z };
  }

  // ============================================================
  //  COLOR
  // ============================================================

  setPartColorable(isColorable) {
    const part = this.getSelected();
    if (!part) return;
    part.isColorable = isColorable;
    part.mesh.userData.isColorable = isColorable;
    if (isColorable) {
      part.color = this.mainColor;
      part.mesh.material.color.set(this.mainColor);
    }
    this._refreshInfoPanel();
  }

  setPartColor(hex) {
    const part = this.getSelected();
    if (!part || part.isColorable) return;
    part.color = hex;
    part.mesh.material.color.set(hex);
  }

  applyMainColor(color) {
    this.mainColor = color;
    for (const p of this.parts) {
      if (p.isColorable) {
        p.color = color;
        p.mesh.material.color.set(color);
        p.mesh.userData.isColorable = true;
      }
    }
  }

  // ============================================================
  //  EXPORT / IMPORT
  // ============================================================

  exportParts() {
    return this.parts.map(p => ({
      id:          p.id,
      name:        p.name || null,
      type:        p.type,
      isDefault:   p.isDefault,
      isColorable: p.isColorable,
      color:       p.color,
      pos:   { ...p.metadata.pos },
      rot:   { ...p.metadata.rot },
      scale: { ...p.metadata.scale },
    }));
  }

  importParts(partsData, mainColor) {
    this._resetToDefaultWheels();
    this.mainColor = mainColor || this.mainColor;

    // Remove auto-spawned defaults so we re-create from saved data
    for (const p of [...this.parts]) {
      this.customCarGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.parts = [];

    for (const pd of (partsData || [])) {
      const geoFactory = PART_TYPES[pd.type];
      if (!geoFactory) continue;
      if (!pd.isDefault && this._userPartCount >= MAX_PARTS) continue;

      const geo = geoFactory();
      // Wheels always use matte black; other parts use their saved color
      const isWheel = !!pd.isDefault;
      const mat = isWheel ? wheelBlackMat.clone() : editorMat.clone();
      if (!isWheel) {
        const col = pd.isColorable ? this.mainColor : (pd.color || '#888888');
        mat.color.set(col);
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;

      mesh.position.set(pd.pos.x, pd.pos.y, pd.pos.z);
      mesh.rotation.set(
        THREE.MathUtils.degToRad(pd.rot.x),
        THREE.MathUtils.degToRad(pd.rot.y),
        THREE.MathUtils.degToRad(pd.rot.z),
      );
      mesh.scale.set(pd.scale.x, pd.scale.y, pd.scale.z);

      const id = pd.id || nextId();
      mesh.name              = pd.name || '';
      mesh.userData.editorId = id;
      mesh.userData.isColorable = isWheel ? false : (pd.isColorable !== false);
      mesh.userData.isWheel     = isWheel;
      mesh.userData.isDeletable = !isWheel;

      if (pd.isDefault) {
        // Restore rotation for wheels
        mesh.rotation.z = Math.PI / 2;
      }

      this.customCarGroup.add(mesh);

      this.parts.push({
        mesh,
        id,
        name:        pd.name || null,
        type:        pd.type,
        isDefault:   isWheel,
        isColorable: isWheel ? false : (pd.isColorable !== false),
        color:       isWheel ? '#111111' : (pd.isColorable ? this.mainColor : (pd.color || '#888888')),
        metadata: {
          pos:   { ...pd.pos },
          rot:   { ...pd.rot },
          scale: { ...pd.scale },
        },
      });
    }

    // If import had no defaults, re-spawn wheels
    if (!this.parts.some(p => p.isDefault)) {
      this._spawnDefaultWheels();
    }

    this._updatePartsCount();
    this._updatePartsList();
  }

  hasCustomParts() {
    return this._userPartCount > 0;
  }

  getCustomCarGroup() {
    return this.customCarGroup;
  }

  // ============================================================
  //  SAVE
  // ============================================================

  _saveCurrentBuild() {
    if (!this.saveManager) return null;

    const data = {
      name:        `Build ${this.saveManager.getAllCars().length + 1}`,
      mainColor:   this.mainColor,
      vehicleType: 'custom',
      parts:       this.exportParts(),
    };

    if (this.editingCarId) {
      this.saveManager.updateCar(this.editingCarId, data);
      return this.editingCarId;
    } else {
      const newId = this.saveManager.saveCar(data);
      this.editingCarId = newId;
      return newId;
    }
  }

  // ============================================================
  //  UPDATE (main loop)
  // ============================================================

  update() {
    if (!this.active) return;
    this._orbitControls.update();
  }

  // ============================================================
  //  INPUT HANDLERS
  // ============================================================

  _handleKeyDown(e) {
    if (!this.active) return;
    if (e.target && e.target.tagName === 'INPUT') return;

    switch (e.code) {
      case 'KeyW': e.preventDefault(); this.setMode('translate'); break;
      case 'KeyE': e.preventDefault(); this.setMode('rotate');    break;
      case 'KeyR': e.preventDefault(); this.setMode('scale');     break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.removeSelected();
        break;
    }
  }

  _handlePointerDown(e) {
    if (!this.active) return;
    if (this._transformControls.dragging) return;

    const rect = this._canvas.getBoundingClientRect();
    this._pointer.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._pointer, this.camera);

    const meshes = this.parts.map(p => p.mesh);
    const hits   = this._raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
      const id = hits[0].object.userData.editorId;
      if (id) this.selectPart(id);
    } else {
      this.selectedPartId = null;
      this._transformControls.detach();
      this._updatePartsList();
      this._refreshInfoPanel();
    }
  }

  // ============================================================
  //  UI
  // ============================================================

  _buildUI() {
    const on = (id, ev, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    on('editor-spawn-box', 'click', () => this.spawnPart('box'));
    on('editor-spawn-cyl', 'click', () => this.spawnPart('cylinder'));
    on('editor-spawn-sph', 'click', () => this.spawnPart('sphere'));

    on('editor-btn-move',   'click', () => this.setMode('translate'));
    on('editor-btn-rotate', 'click', () => this.setMode('rotate'));
    on('editor-btn-scale',  'click', () => this.setMode('scale'));

    on('editor-delete-part', 'click', () => this.removeSelected());
    on('editor-clear-all',   'click', () => {
      if (confirm('Clear all custom parts? Wheels will remain.')) this.clearUserParts();
    });

    on('editor-colorable', 'change', () => {
      const cb = document.getElementById('editor-colorable');
      if (cb) this.setPartColorable(cb.checked);
    });

    on('editor-part-color', 'input', () => {
      const inp = document.getElementById('editor-part-color');
      if (inp) this.setPartColor(inp.value);
    });

    // SAVE — persist to SaveManager and stay in editor
    on('editor-save-btn', 'click', () => {
      const id = this._saveCurrentBuild();
      if (id) {
        const btn = document.getElementById('editor-save-btn');
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = '✓ SAVED';
          setTimeout(() => { btn.textContent = orig; }, 1200);
        }
      }
    });

    // DONE — save + close editor
    on('editor-done-btn', 'click', () => {
      const savedId = this._saveCurrentBuild();
      if (this.onDone) this.onDone(savedId);
    });
  }

  _updatePartsCount() {
    const el = document.getElementById('editor-parts-count');
    if (el) el.textContent = `${this._userPartCount} / ${MAX_PARTS}`;
  }

  _updatePartsList() {
    const list = document.getElementById('editor-parts-list');
    if (!list) return;

    list.innerHTML = '';
    for (const part of this.parts) {
      const item = document.createElement('div');
      item.className = 'editor-part-item';
      if (part.isDefault) item.classList.add('default-part');
      if (part.id === this.selectedPartId) item.classList.add('selected');
      item.textContent = part.isDefault
        ? `⚙ ${part.name || 'wheel'} (locked)`
        : `${part.type} · ${part.id}`;
      item.addEventListener('click', () => this.selectPart(part.id));
      list.appendChild(item);
    }
  }

  _refreshInfoPanel() {
    const part = this.getSelected();

    const cbColorable = document.getElementById('editor-colorable');
    if (cbColorable) {
      cbColorable.checked  = part ? part.isColorable : true;
      cbColorable.disabled = !part || part.isDefault;
    }

    const colorPicker = document.getElementById('editor-part-color');
    if (colorPicker) {
      colorPicker.value    = part ? part.color : '#888888';
      colorPicker.disabled = !part || part.isColorable || part.isDefault;
    }

    if (part && !part.isDefault) {
      const fmt = v => v.toFixed(2);
      const m   = part.mesh;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('info-pos',   `${fmt(m.position.x)}, ${fmt(m.position.y)}, ${fmt(m.position.z)}`);
      set('info-rot',   `${fmt(THREE.MathUtils.radToDeg(m.rotation.x))}°, ${fmt(THREE.MathUtils.radToDeg(m.rotation.y))}°, ${fmt(THREE.MathUtils.radToDeg(m.rotation.z))}°`);
      set('info-scale', `${fmt(m.scale.x)}, ${fmt(m.scale.y)}, ${fmt(m.scale.z)}`);
    } else {
      for (const id of ['info-pos', 'info-rot', 'info-scale']) {
        const el = document.getElementById(id); if (el) el.textContent = '—';
      }
    }

    const delBtn = document.getElementById('editor-delete-part');
    if (delBtn) {
      delBtn.style.opacity = (part && !part.isDefault) ? '1' : '0.3';
      delBtn.disabled = !part || part.isDefault;
    }
  }
}

// CarEditor.js — Unity-style custom car architect
// Allows spawning up to 20 primitives with full transform control,
// isColorable flag, and hierarchy management via customCarGroup.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MAX_PARTS = 20;
const PART_TYPES = {
  box:      () => new THREE.BoxGeometry(1, 1, 1),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  sphere:   () => new THREE.SphereGeometry(0.5, 16, 12),
};

// Toon material for editor parts (matches game aesthetic)
const editorMat = new THREE.MeshToonMaterial({ color: 0x888888 });

let _idCounter = 0;
function nextId() { return `part_${++_idCounter}`; }

export class CarEditor {
  constructor(scene, camera, canvas, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.renderer = renderer;

    // ---- Parts storage ----
    // Each entry: { mesh: THREE.Mesh, id: string, isColorable: boolean,
    //               type: string, color: string,
    //               metadata: { pos:{x,y,z}, rot:{x,y,z}, scale:{x,y,z} } }
    this.parts = [];
    this.selectedPartId = null;

    // ---- Custom car group (attached to gameplay later) ----
    this.customCarGroup = new THREE.Group();
    this.customCarGroup.visible = false;
    this.scene.add(this.customCarGroup);

    // ---- Editor environment ----
    this._gridHelper = null;
    this._editorAmbient = null;
    this._editorDirectional = null;
    this._orbitControls = null;

    // ---- Raycaster for part selection ----
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    // ---- Selection highlight ----
    this._outlineMesh = null;

    // ---- Main car color (from garage) ----
    this.mainColor = '#33cc55';

    // ---- State ----
    this.active = false;

    // ---- Build the UI panel ----
    this._panel = document.getElementById('editor-panel');
    this._buildUI();

    // ---- Build orbit controls ----
    this._orbitControls = new OrbitControls(this.camera, this.canvas);
    this._orbitControls.enableDamping = true;
    this._orbitControls.dampingFactor = 0.12;
    this._orbitControls.minDistance = 3;
    this._orbitControls.maxDistance = 20;
    this._orbitControls.target.set(0, 0.8, 0);
    this._orbitControls.enabled = false;

    // ---- Click-to-select ----
    this._onPointerDown = this._onPointerDown.bind(this);
  }

  // ============================================================
  //  ENTER / EXIT editor mode
  // ============================================================

  enter(mainColor) {
    this.active = true;
    this.mainColor = mainColor || this.mainColor;

    // Show the group and center it
    this.customCarGroup.visible = true;
    this.customCarGroup.position.set(0, 0, 0);
    this.customCarGroup.rotation.set(0, 0, 0);

    // Build editor environment
    this._setupEditorEnv();

    // Enable orbit controls
    this._orbitControls.enabled = true;
    this._orbitControls.target.set(0, 0.8, 0);

    // Reset camera for editor
    this.camera.position.set(4, 3, 5);
    this.camera.lookAt(0, 0.8, 0);

    // Show UI panel
    this._panel.style.display = 'flex';

    // Add click listener
    this.canvas.addEventListener('pointerdown', this._onPointerDown);

    // Update parts count badge
    this._updatePartsCount();
    this._updateSliderValues();
  }

  exit() {
    this.active = false;

    // Tear down editor env
    this._teardownEditorEnv();

    // Disable orbit controls
    this._orbitControls.enabled = false;

    // Hide UI
    this._panel.style.display = 'none';

    // Remove click listener
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);

    // Clear selection highlight
    this._clearHighlight();
  }

  // ============================================================
  //  EDITOR ENVIRONMENT (grid, lights)
  // ============================================================

  _setupEditorEnv() {
    // Grid
    this._gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
    this.scene.add(this._gridHelper);

    // Editor-specific lighting
    this._editorAmbient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this._editorAmbient);

    this._editorDirectional = new THREE.DirectionalLight(0xffffff, 0.8);
    this._editorDirectional.position.set(5, 10, 5);
    this.scene.add(this._editorDirectional);
  }

  _teardownEditorEnv() {
    if (this._gridHelper) {
      this.scene.remove(this._gridHelper);
      this._gridHelper.dispose();
      this._gridHelper = null;
    }
    if (this._editorAmbient) {
      this.scene.remove(this._editorAmbient);
      this._editorAmbient = null;
    }
    if (this._editorDirectional) {
      this.scene.remove(this._editorDirectional);
      this._editorDirectional = null;
    }
  }

  // ============================================================
  //  PART MANAGEMENT
  // ============================================================

  spawnPart(type) {
    if (this.parts.length >= MAX_PARTS) return null;
    if (!PART_TYPES[type]) return null;

    const geo = PART_TYPES[type]();
    const mat = editorMat.clone();
    mat.color.set(this.mainColor);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(0, 0.5, 0);

    const id = nextId();
    mesh.userData.editorId = id;

    this.customCarGroup.add(mesh);

    const entry = {
      mesh,
      id,
      type,
      isColorable: true,
      color: this.mainColor,
      metadata: {
        pos: { x: 0, y: 0.5, z: 0 },
        rot: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
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
    this.customCarGroup.remove(entry.mesh);
    if (entry.mesh.geometry) entry.mesh.geometry.dispose();
    if (entry.mesh.material) entry.mesh.material.dispose();

    this.parts.splice(idx, 1);

    if (this.selectedPartId === id) {
      this.selectedPartId = null;
      this._clearHighlight();
      this._updateSliderValues();
    }
    this._updatePartsCount();
    this._updatePartsList();
  }

  removeSelected() {
    if (this.selectedPartId) {
      this.removePart(this.selectedPartId);
    }
  }

  selectPart(id) {
    this.selectedPartId = id;
    this._updateSliderValues();
    this._updatePartsList();
    this._highlightSelected();
  }

  getSelected() {
    return this.parts.find(p => p.id === this.selectedPartId) || null;
  }

  // ============================================================
  //  TRANSFORM UPDATES
  // ============================================================

  updatePartTransform(property, axis, value) {
    const part = this.getSelected();
    if (!part) return;

    const v = parseFloat(value);
    if (isNaN(v)) return;

    if (property === 'pos') {
      part.mesh.position[axis] = v;
      part.metadata.pos[axis] = v;
    } else if (property === 'rot') {
      const rad = THREE.MathUtils.degToRad(v);
      part.mesh.rotation[axis] = rad;
      part.metadata.rot[axis] = v; // store degrees
    } else if (property === 'scale') {
      part.mesh.scale[axis] = Math.max(0.05, v);
      part.metadata.scale[axis] = Math.max(0.05, v);
    }
  }

  setPartColorable(isColorable) {
    const part = this.getSelected();
    if (!part) return;
    part.isColorable = isColorable;

    if (isColorable) {
      part.mesh.material.color.set(this.mainColor);
      part.color = this.mainColor;
    }
    // If not colorable, color stays at whatever hex is assigned
  }

  setPartColor(hex) {
    const part = this.getSelected();
    if (!part) return;
    part.color = hex;
    part.mesh.material.color.set(hex);
  }

  // ---- Apply main color to all colorable parts ----
  applyMainColor(color) {
    this.mainColor = color;
    for (const part of this.parts) {
      if (part.isColorable) {
        part.color = color;
        part.mesh.material.color.set(color);
      }
    }
  }

  // ============================================================
  //  SELECTION HIGHLIGHT
  // ============================================================

  _highlightSelected() {
    this._clearHighlight();
    const part = this.getSelected();
    if (!part) return;

    const geo = part.mesh.geometry.clone();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });
    this._outlineMesh = new THREE.Mesh(geo, mat);
    this._outlineMesh.scale.copy(part.mesh.scale).multiplyScalar(1.05);
    this._outlineMesh.position.copy(part.mesh.position);
    this._outlineMesh.rotation.copy(part.mesh.rotation);
    this.customCarGroup.add(this._outlineMesh);
  }

  _clearHighlight() {
    if (this._outlineMesh) {
      this.customCarGroup.remove(this._outlineMesh);
      if (this._outlineMesh.geometry) this._outlineMesh.geometry.dispose();
      if (this._outlineMesh.material) this._outlineMesh.material.dispose();
      this._outlineMesh = null;
    }
  }

  // ============================================================
  //  CLICK-TO-SELECT (Raycasting)
  // ============================================================

  _onPointerDown(event) {
    if (!this.active) return;

    const rect = this.canvas.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._pointer, this.camera);

    const meshes = this.parts.map(p => p.mesh);
    const intersects = this._raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const id = hit.userData.editorId;
      if (id) this.selectPart(id);
    }
  }

  // ============================================================
  //  EXPORT / IMPORT (for SaveManager)
  // ============================================================

  exportParts() {
    return this.parts.map(p => ({
      id: p.id,
      type: p.type,
      isColorable: p.isColorable,
      color: p.color,
      pos: { ...p.metadata.pos },
      rot: { ...p.metadata.rot },
      scale: { ...p.metadata.scale },
    }));
  }

  importParts(partsData, mainColor) {
    // Clear existing parts
    this.clearAllParts();
    this.mainColor = mainColor || this.mainColor;

    for (const pd of partsData) {
      if (this.parts.length >= MAX_PARTS) break;
      if (!PART_TYPES[pd.type]) continue;

      const geo = PART_TYPES[pd.type]();
      const mat = editorMat.clone();
      const color = pd.isColorable ? this.mainColor : (pd.color || '#888888');
      mat.color.set(color);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;

      mesh.position.set(pd.pos.x, pd.pos.y, pd.pos.z);
      mesh.rotation.set(
        THREE.MathUtils.degToRad(pd.rot.x),
        THREE.MathUtils.degToRad(pd.rot.y),
        THREE.MathUtils.degToRad(pd.rot.z)
      );
      mesh.scale.set(pd.scale.x, pd.scale.y, pd.scale.z);

      const id = pd.id || nextId();
      mesh.userData.editorId = id;

      this.customCarGroup.add(mesh);

      this.parts.push({
        mesh,
        id,
        type: pd.type,
        isColorable: pd.isColorable,
        color: pd.isColorable ? this.mainColor : (pd.color || '#888888'),
        metadata: {
          pos: { ...pd.pos },
          rot: { ...pd.rot },
          scale: { ...pd.scale },
        },
      });
    }
    this._updatePartsCount();
    this._updatePartsList();
  }

  clearAllParts() {
    this._clearHighlight();
    for (const p of this.parts) {
      this.customCarGroup.remove(p.mesh);
      if (p.mesh.geometry) p.mesh.geometry.dispose();
      if (p.mesh.material) p.mesh.material.dispose();
    }
    this.parts = [];
    this.selectedPartId = null;
    this._updatePartsCount();
    this._updatePartsList();
  }

  // ---- Return the group for gameplay ----
  getCustomCarGroup() {
    return this.customCarGroup;
  }

  hasCustomParts() {
    return this.parts.length > 0;
  }

  // ============================================================
  //  UPDATE (called each frame when editor is active)
  // ============================================================

  update() {
    if (!this.active) return;
    this._orbitControls.update();

    // Keep highlight in sync with selected part transforms
    if (this._outlineMesh && this.selectedPartId) {
      const part = this.getSelected();
      if (part) {
        this._outlineMesh.position.copy(part.mesh.position);
        this._outlineMesh.rotation.copy(part.mesh.rotation);
        this._outlineMesh.scale.copy(part.mesh.scale).multiplyScalar(1.05);
      }
    }
  }

  // ============================================================
  //  UI PANEL CONSTRUCTION
  // ============================================================

  _buildUI() {
    // All UI elements are in the #editor-panel defined in index.html.
    // We attach listeners here.

    // Spawn buttons
    const spawnBox = document.getElementById('editor-spawn-box');
    const spawnCyl = document.getElementById('editor-spawn-cyl');
    const spawnSph = document.getElementById('editor-spawn-sph');

    if (spawnBox) spawnBox.addEventListener('click', () => this.spawnPart('box'));
    if (spawnCyl) spawnCyl.addEventListener('click', () => this.spawnPart('cylinder'));
    if (spawnSph) spawnSph.addEventListener('click', () => this.spawnPart('sphere'));

    // Delete button
    const delBtn = document.getElementById('editor-delete-part');
    if (delBtn) delBtn.addEventListener('click', () => this.removeSelected());

    // Clear all button
    const clearBtn = document.getElementById('editor-clear-all');
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearAllParts());

    // Transform sliders
    const axes = ['x', 'y', 'z'];
    for (const prop of ['pos', 'rot', 'scale']) {
      for (const axis of axes) {
        const slider = document.getElementById(`editor-${prop}-${axis}`);
        if (slider) {
          slider.addEventListener('input', () => {
            this.updatePartTransform(prop, axis, slider.value);
            this._highlightSelected();
          });
        }
      }
    }

    // isColorable checkbox
    const colorableCheck = document.getElementById('editor-colorable');
    if (colorableCheck) {
      colorableCheck.addEventListener('change', () => {
        this.setPartColorable(colorableCheck.checked);
      });
    }

    // Part color (for non-colorable parts)
    const partColorInput = document.getElementById('editor-part-color');
    if (partColorInput) {
      partColorInput.addEventListener('input', () => {
        this.setPartColor(partColorInput.value);
      });
    }

    // Done button (exit editor)
    const doneBtn = document.getElementById('editor-done-btn');
    if (doneBtn) {
      doneBtn.addEventListener('click', () => {
        if (this.onDone) this.onDone();
      });
    }
  }

  // ---- Sync slider values to the selected part ----
  _updateSliderValues() {
    const part = this.getSelected();
    const axes = ['x', 'y', 'z'];

    for (const prop of ['pos', 'rot', 'scale']) {
      for (const axis of axes) {
        const slider = document.getElementById(`editor-${prop}-${axis}`);
        if (!slider) continue;

        if (part) {
          slider.value = part.metadata[prop][axis];
          slider.disabled = false;
        } else {
          slider.value = prop === 'scale' ? 1 : 0;
          slider.disabled = true;
        }

        // Update adjacent value label
        const label = document.getElementById(`editor-${prop}-${axis}-val`);
        if (label) label.textContent = parseFloat(slider.value).toFixed(2);
      }
    }

    // isColorable checkbox
    const colorableCheck = document.getElementById('editor-colorable');
    if (colorableCheck) {
      colorableCheck.checked = part ? part.isColorable : true;
      colorableCheck.disabled = !part;
    }

    // Part color input
    const partColorInput = document.getElementById('editor-part-color');
    if (partColorInput) {
      partColorInput.value = part ? part.color : '#888888';
      partColorInput.disabled = !part || part.isColorable;
    }
  }

  _updatePartsCount() {
    const badge = document.getElementById('editor-parts-count');
    if (badge) badge.textContent = `${this.parts.length} / ${MAX_PARTS}`;
  }

  _updatePartsList() {
    const list = document.getElementById('editor-parts-list');
    if (!list) return;

    list.innerHTML = '';
    for (const part of this.parts) {
      const item = document.createElement('div');
      item.className = 'editor-part-item';
      if (part.id === this.selectedPartId) item.classList.add('selected');
      item.textContent = `${part.type} (${part.id})`;
      item.addEventListener('click', () => this.selectPart(part.id));
      list.appendChild(item);
    }
  }

  // ---- Callback: set by main.js to handle editor exit ----
  onDone = null;
}

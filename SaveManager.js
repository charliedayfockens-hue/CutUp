// SaveManager.js — Infinite persistent save system (v3)
// Stores an unlimited array of custom car builds under a single localStorage key.
// Uses unique string IDs (never array indices) for stable references.

const STORAGE_KEY = 'racing_custom_cars';
const ACTIVE_KEY  = 'racing_active_car_id';

function _uid() {
  return `car_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function _sanitiseParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.map(p => ({
    id:          String(p.id || _uid()),
    type:        p.type        || 'box',
    isDefault:   !!p.isDefault,
    isColorable: p.isColorable !== false,
    color:       p.color       || '#888888',
    pos:   { x: +(p.pos?.x   ?? 0), y: +(p.pos?.y   ?? 0.5), z: +(p.pos?.z   ?? 0) },
    rot:   { x: +(p.rot?.x   ?? 0), y: +(p.rot?.y   ?? 0),   z: +(p.rot?.z   ?? 0) },
    scale: { x: +(p.scale?.x ?? 1), y: +(p.scale?.y ?? 1),   z: +(p.scale?.z ?? 1) },
  }));
}

export class SaveManager {
  // ============================================================
  //  INTERNAL I/O
  // ============================================================

  _read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = JSON.parse(raw || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  _write(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  }

  // ============================================================
  //  CREATE — push a new car and return its ID
  // ============================================================

  saveCar(data) {
    const arr = this._read();
    const entry = {
      id:          _uid(),
      name:        data.name        || `Build ${arr.length + 1}`,
      mainColor:   data.mainColor   || '#33cc55',
      vehicleType: data.vehicleType || 'custom',
      parts:       _sanitiseParts(data.parts),
      savedAt:     Date.now(),
    };
    arr.push(entry);
    this._write(arr);
    this.setActiveCar(entry.id);
    return entry.id;
  }

  // ============================================================
  //  UPDATE — overwrite an existing car by ID
  // ============================================================

  updateCar(id, data) {
    const arr = this._read();
    const idx = arr.findIndex(c => c.id === id);
    if (idx === -1) return;
    arr[idx] = {
      ...arr[idx],
      name:        data.name        ?? arr[idx].name,
      mainColor:   data.mainColor   ?? arr[idx].mainColor,
      vehicleType: data.vehicleType ?? arr[idx].vehicleType,
      parts:       data.parts !== undefined ? _sanitiseParts(data.parts) : arr[idx].parts,
      savedAt:     Date.now(),
      id,            // preserve ID
    };
    this._write(arr);
  }

  // ============================================================
  //  DELETE — remove by ID, fix active pointer if needed
  // ============================================================

  deleteCar(id) {
    const arr = this._read().filter(c => c.id !== id);
    this._write(arr);
    if (this.getActiveCarId() === id) {
      this.setActiveCar(arr.length > 0 ? arr[arr.length - 1].id : null);
    }
  }

  // ============================================================
  //  READ
  // ============================================================

  getCar(id) {
    return this._read().find(c => c.id === id) ?? null;
  }

  getAllCars() {
    return this._read();
  }

  hasSaves() {
    return this._read().length > 0;
  }

  // ============================================================
  //  ACTIVE CAR — persisted separately so it survives tab refreshes
  // ============================================================

  getActiveCarId() {
    return localStorage.getItem(ACTIVE_KEY) || null;
  }

  setActiveCar(id) {
    if (id) {
      localStorage.setItem(ACTIVE_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }
  }

  getActiveCar() {
    const id = this.getActiveCarId();
    return id ? this.getCar(id) : null;
  }

  // ============================================================
  //  LEGACY COMPAT — old Menu.js called these; kept to avoid crashes
  // ============================================================

  saveToSlot(slotId, data)    { return this.saveCar(data); }
  loadFromSlot(_slotId)       { return this.getActiveCar(); }
  getSlots()                  { return []; }
  get currentActiveIndex()    { return -1; }
}

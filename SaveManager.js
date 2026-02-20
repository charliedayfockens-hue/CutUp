// SaveManager.js — Persistent save/load system using localStorage
// JSON Schema: { slotId, carType, mainColor, parts: [{ id, type, isColorable, color, pos, rot, scale }] }

const STORAGE_KEY = 'cutup_saves';
const MAX_SLOTS = 3;

export class SaveManager {
  constructor() {
    this._cache = this._readAll();
  }

  // ---- Read all slots from localStorage ----
  _readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  _writeAll(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    this._cache = data;
  }

  // ---- Save to a specific slot (1, 2, or 3) ----
  saveToSlot(id, data) {
    if (id < 1 || id > MAX_SLOTS) return false;
    const all = this._readAll();
    all[`slot_${id}`] = {
      slotId: id,
      carType: data.carType || 'sports',
      mainColor: data.mainColor || '#33cc55',
      vehicleType: data.vehicleType || 'sports',
      parts: (data.parts || []).map(p => ({
        id: p.id,
        type: p.type,
        isColorable: !!p.isColorable,
        color: p.color || '#888888',
        pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
        rot: { x: p.rot.x, y: p.rot.y, z: p.rot.z },
        scale: { x: p.scale.x, y: p.scale.y, z: p.scale.z },
      })),
      timestamp: Date.now(),
    };
    this._writeAll(all);
    return true;
  }

  // ---- Load from a specific slot ----
  loadFromSlot(id) {
    if (id < 1 || id > MAX_SLOTS) return null;
    const all = this._readAll();
    return all[`slot_${id}`] || null;
  }

  // ---- Delete a slot ----
  deleteSlot(id) {
    if (id < 1 || id > MAX_SLOTS) return;
    const all = this._readAll();
    delete all[`slot_${id}`];
    this._writeAll(all);
  }

  // ---- Get all slots (for UI display) ----
  getSlots() {
    const all = this._readAll();
    const result = [];
    for (let i = 1; i <= MAX_SLOTS; i++) {
      const slot = all[`slot_${i}`] || null;
      result.push({
        id: i,
        empty: !slot,
        data: slot,
        label: slot
          ? `Slot ${i}: ${slot.parts.length} parts`
          : `Slot ${i}: Empty`,
      });
    }
    return result;
  }

  // ---- Check if any saves exist ----
  hasSaves() {
    const all = this._readAll();
    for (let i = 1; i <= MAX_SLOTS; i++) {
      if (all[`slot_${i}`]) return true;
    }
    return false;
  }
}

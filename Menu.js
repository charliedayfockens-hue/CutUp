// Menu.js — Full state-machine menu (v3)
// Flow:
//   Main → Mode (Stock | Custom)
//   Stock → Stock Gallery (Sports, Limo) → Map Select → Garage
//   Custom → Custom Gallery (scrollable Build Cards) → Map Select → Garage
//             [+] New Build → Editor → back to Custom Gallery
//             [Edit] → Editor (load existing) → back to Custom Gallery
//             [Delete] → remove card, refresh gallery

import { SaveManager } from './SaveManager.js';

const THEME_LABELS = {
  snow: 'Snow', desert: 'Desert', rain: 'Rain', dynamic: 'Dynamic',
};

const STOCK_VEHICLES = [
  { type: 'sports', name: 'Sports Car' },
  { type: 'limo',   name: 'Limo'       },
];

export class Menu {
  constructor(onStart, onGaragePreview) {
    this._onStart         = onStart;          // (theme, carColor, vehicleType, carId)
    this._onGaragePreview = onGaragePreview;  // (theme, vehicleType, carColor)

    // External callbacks wired up by main.js
    this.onEditorOpen  = null;   // (carId | null) — null means fresh canvas
    this.saveManager   = new SaveManager();

    // Selection state
    this._mode           = 'stock';    // 'stock' | 'custom'
    this._vehicleType    = 'sports';
    this._selectedColor  = '#33cc55';
    this._selectedTheme  = 'dynamic';
    this._activeCarId    = null;       // custom car being previewed / edited
    this._editingCarId   = null;       // ID when editing an existing build

    // Stage history stack for back navigation
    this._stageHistory = [];

    // DOM refs
    this._startScreen = document.getElementById('start-screen');
    this._garagePanel = document.getElementById('garage-panel');
    this._colorInput  = document.getElementById('car-color-input');

    this._initMenu();
    this._initGarage();
  }

  // ============================================================
  //  PUBLIC API
  // ============================================================

  /** Called by main.js when returning from game-over or main-menu button */
  show() {
    this._garagePanel.classList.remove('visible');
    this._startScreen.style.display = 'flex';
    this._showStage('main');
    this._stageHistory = [];
  }

  hideGarage() {
    this._garagePanel.classList.remove('visible');
  }

  showGarage() {
    this._garagePanel.classList.add('visible');
  }

  /**
   * Called by main.js after editor closes.
   * savedCarId — ID of the just-saved/edited car, or null if no save.
   */
  onEditorClosed(savedCarId) {
    if (savedCarId) {
      this._activeCarId = savedCarId;
      this.saveManager.setActiveCar(savedCarId);
    }
    // Restore start-screen at custom gallery
    this._startScreen.style.display = 'flex';
    this._showStage('custom');
    this._renderCustomGallery();
  }

  get selectedTheme()  { return this._selectedTheme; }
  get selectedCar()    { return this._selectedColor; }
  get currentVehicle() { return this._vehicleType; }
  get activeCarId()    { return this._activeCarId; }

  // ============================================================
  //  STAGE NAVIGATION
  // ============================================================

  _showStage(id) {
    const allStages = ['main', 'mode', 'stock', 'custom', 'map'];
    allStages.forEach(s => {
      const el = document.getElementById(`stage-${s}`);
      if (el) el.style.display = 'none';
    });
    const target = document.getElementById(`stage-${id}`);
    if (target) target.style.display = 'flex';
  }

  _pushStage(id) {
    this._stageHistory.push(id);
    this._showStage(id);
  }

  _popStage() {
    this._stageHistory.pop();
    const prev = this._stageHistory[this._stageHistory.length - 1] || 'main';
    this._showStage(prev);
  }

  // ============================================================
  //  MENU INIT
  // ============================================================

  _initMenu() {
    // ── Stage 1: Main ──────────────────────────────────────────
    document.getElementById('btn-play').addEventListener('click', () => {
      this._stageHistory = ['main'];
      this._pushStage('mode');
    });

    // ── Stage 2: Mode Select ───────────────────────────────────
    document.getElementById('btn-mode-stock').addEventListener('click', () => {
      this._mode = 'stock';
      this._pushStage('stock');
    });

    document.getElementById('btn-mode-custom').addEventListener('click', () => {
      this._mode = 'custom';
      this._renderCustomGallery();
      this._pushStage('custom');
    });

    // ── Stage 3a: Stock vehicle cards ─────────────────────────
    document.querySelectorAll('.stock-card').forEach(card => {
      card.addEventListener('click', () => {
        this._vehicleType = card.dataset.vehicle;
        this._activeCarId = null;
        this._pushStage('map');
      });
    });

    document.getElementById('btn-stock-back').addEventListener('click', () => {
      this._popStage();
    });

    // ── Stage 3b: Custom gallery ───────────────────────────────
    document.getElementById('btn-new-build').addEventListener('click', () => {
      this._editingCarId = null;  // fresh build
      this._activeCarId  = null;
      this._startScreen.style.display = 'none';
      if (this.onEditorOpen) this.onEditorOpen(null);
    });

    document.getElementById('btn-custom-back').addEventListener('click', () => {
      this._popStage();
    });

    // ── Stage 4: Map Select ────────────────────────────────────
    document.querySelectorAll('.map-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._selectedTheme = btn.dataset.theme;
        this._enterGarage();
      });
    });

    document.getElementById('btn-map-back').addEventListener('click', () => {
      this._popStage();
    });
  }

  // ============================================================
  //  GARAGE INIT
  // ============================================================

  _initGarage() {
    // Color picker live update
    this._colorInput.addEventListener('input', () => {
      document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
      this._selectedColor = this._colorInput.value;
      this._syncGaragePreview();
    });

    // Special color swatches (rainbow / galaxy)
    document.querySelectorAll('.car-btn.swatch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedColor = btn.dataset.color;
        this._syncGaragePreview();
      });
    });

    // Vehicle cycler (only used in stock mode)
    document.getElementById('prev-vehicle').addEventListener('click', () => {
      const idx = STOCK_VEHICLES.findIndex(v => v.type === this._vehicleType);
      const next = (idx - 1 + STOCK_VEHICLES.length) % STOCK_VEHICLES.length;
      this._vehicleType = STOCK_VEHICLES[next].type;
      this._syncGaragePreview();
    });

    document.getElementById('next-vehicle').addEventListener('click', () => {
      const idx = STOCK_VEHICLES.findIndex(v => v.type === this._vehicleType);
      const next = (idx + 1) % STOCK_VEHICLES.length;
      this._vehicleType = STOCK_VEHICLES[next].type;
      this._syncGaragePreview();
    });

    // Editor button (custom mode only)
    const editorBtn = document.getElementById('btn-editor');
    if (editorBtn) {
      editorBtn.addEventListener('click', () => {
        this._editingCarId = this._activeCarId;
        this._garagePanel.classList.remove('visible');
        this._startScreen.style.display = 'none';
        if (this.onEditorOpen) this.onEditorOpen(this._activeCarId);
      });
    }

    // GO! — launch game
    document.getElementById('btn-go').addEventListener('click', () => {
      this._launch();
    });
  }

  // ============================================================
  //  ENTER GARAGE
  // ============================================================

  _enterGarage() {
    // Reset color pickers
    this._selectedColor = '#33cc55';
    this._colorInput.value = '#33cc55';
    document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));

    // Garage map badge
    document.getElementById('garage-map-label').textContent =
      `MAP: ${(THEME_LABELS[this._selectedTheme] || this._selectedTheme).toUpperCase()}`;

    // Mode-specific garage layout
    const cyclerRow = document.getElementById('garage-cycler-row');
    const editorBtn = document.getElementById('btn-editor');

    if (this._mode === 'stock') {
      if (cyclerRow) cyclerRow.style.display = 'flex';
      if (editorBtn) editorBtn.style.display = 'none';
    } else {
      // Custom: no cycler, show editor button
      if (cyclerRow) cyclerRow.style.display = 'none';
      if (editorBtn) editorBtn.style.display = 'block';
    }

    // Hide start screen, show garage
    this._startScreen.style.display = 'none';
    this._garagePanel.classList.add('visible');

    // Trigger 3D preview
    this._syncGaragePreview();
  }

  _syncGaragePreview() {
    const label = document.getElementById('vehicle-name-label');
    if (label) {
      if (this._mode === 'stock') {
        const v = STOCK_VEHICLES.find(v => v.type === this._vehicleType);
        label.textContent = v ? v.name : 'Sports Car';
      } else {
        const car = this._activeCarId
          ? this.saveManager.getCar(this._activeCarId)
          : null;
        label.textContent = car ? car.name : 'Custom Build';
      }
    }

    if (this._onGaragePreview) {
      // Pass activeCarId as 4th arg so main.js knows which custom build to show
      this._onGaragePreview(this._selectedTheme, this._vehicleType, this._selectedColor, this._activeCarId);
    }
  }

  _launch() {
    this._garagePanel.classList.remove('visible');
    this._onStart(
      this._selectedTheme,
      this._selectedColor,
      this._vehicleType,
      this._activeCarId,
    );
  }

  // ============================================================
  //  CUSTOM CAR GALLERY
  // ============================================================

  _renderCustomGallery() {
    const grid     = document.getElementById('custom-car-grid');
    const emptyMsg = document.getElementById('custom-empty-hint');
    if (!grid) return;

    grid.innerHTML = '';
    const cars = this.saveManager.getAllCars();

    if (cars.length === 0) {
      if (emptyMsg) emptyMsg.style.display = 'block';
      return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';

    for (const car of cars) {
      grid.appendChild(this._makeCarCard(car));
    }
  }

  _makeCarCard(car) {
    const card = document.createElement('div');
    card.className = 'build-card';
    card.dataset.carId = car.id;

    // Color swatch preview
    const swatch = document.createElement('div');
    swatch.className = 'build-card-swatch';
    const col = car.mainColor;
    if (col === 'rainbow') {
      swatch.style.background = 'linear-gradient(90deg,red,orange,yellow,green,blue,violet)';
    } else if (col === 'galaxy') {
      swatch.style.background = 'linear-gradient(135deg,#050015,#001040,#0a0a30)';
    } else {
      swatch.style.background = col || '#33cc55';
    }

    // Info block
    const info = document.createElement('div');
    info.className = 'build-card-info';

    const nameEl = document.createElement('span');
    nameEl.className = 'build-card-name';
    nameEl.textContent = car.name || 'Unnamed Build';

    const metaEl = document.createElement('span');
    metaEl.className = 'build-card-meta';
    const partCount = (car.parts || []).filter(p => !p.isDefault).length;
    metaEl.textContent = `${partCount} part${partCount !== 1 ? 's' : ''} · ${_dateLabel(car.savedAt)}`;

    info.appendChild(nameEl);
    info.appendChild(metaEl);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'build-card-actions';

    // [Play]
    const playBtn = document.createElement('button');
    playBtn.className = 'build-card-btn play';
    playBtn.textContent = '▶ PLAY';
    playBtn.addEventListener('click', () => {
      this._activeCarId = car.id;
      this._vehicleType = car.vehicleType || 'custom';
      this.saveManager.setActiveCar(car.id);
      this._pushStage('map');
    });

    // [Edit]
    const editBtn = document.createElement('button');
    editBtn.className = 'build-card-btn edit';
    editBtn.textContent = '✏ EDIT';
    editBtn.addEventListener('click', () => {
      this._activeCarId  = car.id;
      this._editingCarId = car.id;
      this.saveManager.setActiveCar(car.id);
      this._startScreen.style.display = 'none';
      if (this.onEditorOpen) this.onEditorOpen(car.id);
    });

    // [Delete]
    const delBtn = document.createElement('button');
    delBtn.className = 'build-card-btn delete';
    delBtn.textContent = '✕ DEL';
    delBtn.addEventListener('click', () => {
      if (confirm(`Delete "${car.name || 'this build'}"?`)) {
        this.saveManager.deleteCar(car.id);
        if (this._activeCarId === car.id) this._activeCarId = null;
        this._renderCustomGallery();
      }
    });

    actions.appendChild(playBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(swatch);
    card.appendChild(info);
    card.appendChild(actions);
    return card;
  }
}

// ── Helpers ──────────────────────────────────────────────────

function _dateLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

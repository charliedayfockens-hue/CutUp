// Menu.js — Two-stage menu + independent garage panel
// Flow: Main ─► Map Select ─► Garage Panel (turntable) ─► Gameplay

const VEHICLES      = ['sports', 'limo'];
const VEHICLE_NAMES = { sports: 'Sports Car', limo: 'Limo' };
const THEME_LABELS  = { day: 'Day', snow: 'Snow', desert: 'Desert', rain: 'Rain', dynamic: 'Dynamic' };

export class Menu {
  constructor(onStart, onGaragePreview) {
    this._onStart         = onStart;           // (theme, carColor, vehicleType)
    this._onGaragePreview = onGaragePreview;   // (theme, vehicleType, carColor)

    this._selectedTheme = 'day';
    this._selectedCar   = '#33cc55';
    this._vehicleIndex  = 0;

    // DOM refs
    this._startScreen   = document.getElementById('start-screen');
    this._garagePanel   = document.getElementById('garage-panel');
    this._vehicleLabel  = document.getElementById('vehicle-name-label');
    this._mapBadge      = document.getElementById('garage-map-label');
    this._colorInput    = document.getElementById('car-color-input');

    // ── Stage 1: Play ───────────────────────────────────────────
    document.getElementById('btn-play').addEventListener('click', () => {
      this._showStage('map');
    });

    // ── Stage 2: Map Select → open Garage panel ─────────────────
    document.querySelectorAll('.map-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._selectedTheme = btn.dataset.theme;
        this._enterGarage();
      });
    });

    // ── Garage: Vehicle cycler ───────────────────────────────────
    document.getElementById('prev-vehicle').addEventListener('click', () => {
      this._vehicleIndex = (this._vehicleIndex - 1 + VEHICLES.length) % VEHICLES.length;
      this._syncPreview();
    });
    document.getElementById('next-vehicle').addEventListener('click', () => {
      this._vehicleIndex = (this._vehicleIndex + 1) % VEHICLES.length;
      this._syncPreview();
    });

    // ── Garage: Color picker (live) ──────────────────────────────
    this._colorInput.addEventListener('input', () => {
      // Clicking the native color picker deselects any swatch
      document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
      this._selectedCar = this._colorInput.value;
      this._syncPreview();
    });

    // ── Garage: Special color swatches ───────────────────────────
    document.querySelectorAll('.car-btn.swatch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedCar = btn.dataset.color;  // 'rainbow' or 'galaxy'
        this._syncPreview();
      });
    });

    // ── Garage: GO — launch game ─────────────────────────────────
    document.getElementById('btn-go').addEventListener('click', () => {
      this._launch();
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────

  get _currentVehicle() { return VEHICLES[this._vehicleIndex]; }

  _enterGarage() {
    // Reset selections to defaults
    this._vehicleIndex = 0;
    this._selectedCar  = '#33cc55';
    this._colorInput.value = '#33cc55';
    document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));

    // Update map badge label
    this._mapBadge.textContent = `MAP: ${THEME_LABELS[this._selectedTheme] || this._selectedTheme.toUpperCase()}`;

    // Hide start-screen, reveal garage panel
    this._startScreen.style.display = 'none';
    this._garagePanel.classList.add('visible');

    // Kick off turntable
    this._syncPreview();
  }

  _syncPreview() {
    this._vehicleLabel.textContent = VEHICLE_NAMES[this._currentVehicle];
    if (this._onGaragePreview) {
      this._onGaragePreview(this._selectedTheme, this._currentVehicle, this._selectedCar);
    }
  }

  _launch() {
    this._garagePanel.classList.remove('visible');
    this._onStart(this._selectedTheme, this._selectedCar, this._currentVehicle);
  }

  _showStage(stage) {
    document.getElementById('stage-main').style.display = stage === 'main' ? 'flex' : 'none';
    document.getElementById('stage-map').style.display  = stage === 'map'  ? 'flex' : 'none';
  }

  // Called externally (e.g. from goToMainMenu)
  show() {
    this._garagePanel.classList.remove('visible');
    this._startScreen.style.display = 'flex';
    this._showStage('main');
  }
}

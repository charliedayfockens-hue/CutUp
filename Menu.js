// Menu.js — Multi-stage CRT-style menu overlay
// Stage 1: Main (Play)
// Stage 2: Map Select (Snow, Desert, Rain, Dynamic)
// Stage 3: Garage (Color picker + Rainbow / Galaxy specials)
// Stage 4: Game Over (Retry, Main Menu) — handled externally

export class Menu {
  constructor(onStart) {
    this._onStart = onStart;       // callback(theme, carColor)
    this._selectedTheme = 'day';
    this._selectedCar = '#33cc55';

    // DOM refs
    this._overlay = document.getElementById('start-screen');
    this._stageMain = document.getElementById('stage-main');
    this._stageMap = document.getElementById('stage-map');
    this._stageCar = document.getElementById('stage-car');
    this._colorInput = document.getElementById('car-color-input');

    // Stage 1: Play button
    document.getElementById('btn-play').addEventListener('click', () => {
      this._showStage('map');
    });

    // Stage 2: Map select buttons
    document.querySelectorAll('.map-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._selectedTheme = btn.dataset.theme;
        document.querySelectorAll('.map-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this._showStage('car');
      });
    });

    // Stage 3a: Color picker "GO" button
    document.getElementById('btn-pick-color').addEventListener('click', () => {
      this._selectedCar = this._colorInput.value; // hex string like "#ff2200"
      this._launch();
    });

    // Stage 3b: Special color buttons (Rainbow, Galaxy)
    document.querySelectorAll('.car-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._selectedCar = btn.dataset.color;  // 'rainbow' or 'galaxy'
        this._launch();
      });
    });
  }

  _launch() {
    this.hide();
    this._onStart(this._selectedTheme, this._selectedCar);
  }

  _showStage(stage) {
    this._stageMain.style.display = stage === 'main' ? 'flex' : 'none';
    this._stageMap.style.display  = stage === 'map'  ? 'flex' : 'none';
    this._stageCar.style.display  = stage === 'car'  ? 'flex' : 'none';
  }

  show() {
    this._overlay.style.display = 'flex';
    this._showStage('main');
  }

  hide() {
    this._overlay.style.display = 'none';
  }
}

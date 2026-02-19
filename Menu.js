// Menu.js — Map selection overlay
// Reads theme from data-theme attribute on buttons in #map-select.
// Calls onStart(themeName) when the player picks one.

export class Menu {
  constructor(onStart) {
    this._onStart = onStart;
    this._mapSelect = document.getElementById('map-select');

    // Bind every theme button
    this._mapSelect.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        this.hide();
        this._onStart(theme);
      });
    });
  }

  show() {
    this._mapSelect.style.display = 'flex';
  }

  hide() {
    this._mapSelect.style.display = 'none';
  }
}

import * as THREE from 'three';
import { World } from './World.js';
import { CarController, BINDINGS } from './CarController.js';
import { TrafficManager } from './TrafficManager.js';
import { Menu } from './Menu.js';

// ============================================================
//  GAME STATE
// ============================================================
let state = 'menu';   // 'menu' | 'garage' | 'playing' | 'gameover'
let score = 0;
let distance = 0;
let nearMissCombo = 0;
let nearMissTimer = 0;
let screenShake = 0;

// Current selections (persisted for Retry)
let currentTheme   = 'day';
let currentCar     = '#33cc55';
let currentVehicle = 'sports';

// ============================================================
//  INPUT — Direct Mapping via BINDINGS
// ============================================================
const keysDown = {};
const touch = { left: false, right: false, gas: false, brake: false };

document.addEventListener('keydown', e => { keysDown[e.code] = true; keysDown[e.key.toLowerCase()] = true; });
document.addEventListener('keyup',   e => { keysDown[e.code] = false; keysDown[e.key.toLowerCase()] = false; });

function getInput() {
  const gas   = keysDown['KeyW'] || keysDown['ArrowUp'] || touch.gas;
  const brake = keysDown['Space'] || touch.brake;

  let moveDir = 0;
  let wheelAngle = 0;

  for (const [key, cfg] of Object.entries(BINDINGS)) {
    if (keysDown[key]) {
      moveDir    += cfg.move;
      wheelAngle += cfg.wheel;
    }
  }

  if (keysDown['ArrowLeft'] || touch.left) {
    moveDir    += BINDINGS['a'].move;
    wheelAngle += BINDINGS['a'].wheel;
  }
  if (keysDown['ArrowRight'] || touch.right) {
    moveDir    += BINDINGS['d'].move;
    wheelAngle += BINDINGS['d'].wheel;
  }

  moveDir    = Math.max(-1, Math.min(1, moveDir));
  wheelAngle = Math.max(-30, Math.min(30, wheelAngle));

  return { gas, brake, moveDir, wheelAngle };
}

// Mobile touch
if ('ontouchstart' in window) {
  document.getElementById('mobile-controls').style.display = 'block';
  for (const [id, prop] of [['btn-left','left'],['btn-right','right'],['btn-gas','gas'],['btn-brake','brake']]) {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); touch[prop] = true; },  { passive: false });
    el.addEventListener('touchend',   e => { e.preventDefault(); touch[prop] = false; }, { passive: false });
    el.addEventListener('touchcancel',e => { e.preventDefault(); touch[prop] = false; }, { passive: false });
  }
}

// ============================================================
//  DOM REFS
// ============================================================
const dom = {
  startScreen: document.getElementById('start-screen'),
  gameOver:    document.getElementById('game-over'),
  hud:         document.getElementById('hud'),
  speedVal:    document.getElementById('speed-value'),
  scoreVal:    document.getElementById('score-value'),
  nearMiss:    document.getElementById('near-miss-popup'),
  finalScore:  document.getElementById('final-score-value'),
};

// ============================================================
//  THREE.JS SETUP — Low-res pixelated renderer (DS style)
// ============================================================
const RENDER_W = 640;
const RENDER_H = 360;

const canvas   = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(RENDER_W, RENDER_H, false);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, RENDER_W / RENDER_H, 0.5, 1000);

// ============================================================
//  CREATE GAME OBJECTS
// ============================================================
const world   = new World(scene);
const player  = new CarController(scene);
const traffic = new TrafficManager(scene);

// ============================================================
//  CAMERA — Strictly locked (no speed zoom, no FOV change)
//  Y and Z are hard-set each frame. Only X has speed-sway.
// ============================================================
const CAM_DIST = 7;
const CAM_H    = 3;
const MAX_SPEED = 280;

function updateCamera() {
  const speedRatio = player.absSpeed / MAX_SPEED;

  // Subtle X-axis sine sway proportional to speed
  const sway = Math.sin(Date.now() * 0.005) * speedRatio * 0.5;

  // Strictly locked — Y and Z never deviate from the fixed offset
  camera.position.x = player.posX + sway;
  camera.position.y = CAM_H;
  camera.position.z = player.posZ - CAM_DIST;

  // Screen shake on top of locked position
  if (screenShake > 0) {
    camera.position.x += (Math.random() - 0.5) * screenShake * 2;
    camera.position.y += (Math.random() - 0.5) * screenShake;
    screenShake *= 0.88;
    if (screenShake < 0.01) screenShake = 0;
  }

  camera.lookAt(player.posX, 1.2, player.posZ + 16);
  camera.fov = 65;
  camera.updateProjectionMatrix();
}

// ============================================================
//  DEMO MODE — auto-driving car shown behind main menu
// ============================================================
function updateDemo(dt) {
  const t = performance.now() * 0.001;
  const weave = Math.sin(t * 0.4) * 0.3;
  player.update(dt, { gas: true, brake: false, moveDir: weave, wheelAngle: weave * 15 });

  world.update(player.posZ);
  world.updateTheme(dt, renderer);
  world.updateWeather(dt, player.posX, player.posZ);
  world.updateClouds(dt, player.posZ);
  world.followPlayer(player.posX, player.posZ);
  traffic.update(dt, player.posX, player.posZ, player.absSpeed, 0);

  updateCamera();
}

// ============================================================
//  GARAGE TURNTABLE — 3D preview during vehicle/color select
// ============================================================

// Called by Menu whenever the player changes vehicle type or color
function onGaragePreview(theme, vehicleType, carColor) {
  currentTheme   = theme;
  currentVehicle = vehicleType  || 'sports';
  currentCar     = carColor     || '#33cc55';

  // Apply theme so background/lighting matches the selected map
  world.setTheme(theme);

  // Rebuild vehicle mesh if type changed, then apply color
  player.setVehicle(currentVehicle);
  player.setColor(currentCar);

  // Move car to world center for turntable display
  player.playerGroup.position.set(0, 0, 0);
  player.playerGroup.rotation.set(0, 0, 0);

  // Dim the overlay so the 3D preview is clearly visible
  dom.startScreen.classList.add('garage-mode');

  state = 'garage';
}

function updateGarage(dt) {
  // Slowly spin the car on its Y-axis (~0.005 rad/frame at 60fps)
  player.playerGroup.rotation.y += 0.8 * dt;

  // Keep shader animations alive (rainbow HSL cycle, galaxy uTime)
  player.tickAnimations();

  // Close turntable camera — strictly positioned, no lerp
  camera.position.set(0, 2, 5);
  camera.lookAt(0, 1, 0);
  camera.fov = 65;
  camera.updateProjectionMatrix();
}

// ============================================================
//  NEAR-MISS CALLBACK
// ============================================================
traffic.onNearMiss = () => {
  if (state !== 'playing') return;
  if (nearMissTimer > 0) nearMissCombo++; else nearMissCombo = 1;
  nearMissTimer = 3;
  const bonus = 50 * nearMissCombo;
  score += bonus;
  screenShake = 0.35;

  dom.nearMiss.textContent = nearMissCombo > 1
    ? `NEAR MISS x${nearMissCombo}! +${bonus}`
    : `NEAR MISS! +${bonus}`;
  dom.nearMiss.classList.add('show');
  setTimeout(() => dom.nearMiss.classList.remove('show'), 700);
};

// ============================================================
//  HUD
// ============================================================
function updateHUD() {
  dom.speedVal.textContent = Math.floor(player.absSpeed);
  dom.scoreVal.textContent = Math.floor(score);
}

// ============================================================
//  GAME FLOW
// ============================================================
function startGame(theme, carColor, vehicleType) {
  currentTheme   = theme;
  currentCar     = carColor     || '#33cc55';
  currentVehicle = vehicleType  || 'sports';

  // Hide menu, remove garage tint, show HUD
  dom.startScreen.style.display = 'none';
  dom.startScreen.classList.remove('garage-mode');
  dom.hud.style.display = 'block';

  world.setTheme(theme);

  // Rebuild vehicle (in case user reached Play without preview)
  player.setVehicle(currentVehicle);
  player.setColor(currentCar);

  // Reset car rotation and game state, then snap camera
  player.playerGroup.rotation.set(0, 0, 0);
  resetGame();

  state = 'playing';
}

function retryGame() {
  dom.gameOver.style.display = 'none';
  dom.hud.style.display = 'block';
  player.setVehicle(currentVehicle);
  player.setColor(currentCar);
  player.playerGroup.rotation.set(0, 0, 0);
  resetGame();
  state = 'playing';
}

function goToMainMenu() {
  dom.gameOver.style.display = 'none';
  dom.hud.style.display = 'none';
  dom.startScreen.classList.remove('garage-mode');
  resetGame();
  state = 'menu';
  world.setTheme('day');
  menu.show();
}

function resetGame() {
  score = 0;
  distance = 0;
  nearMissCombo = 0;
  nearMissTimer = 0;
  screenShake = 0;
  player.reset();
  traffic.reset();
  world.reset();

  // Snap camera directly to gameplay position behind the car
  camera.position.set(player.posX, CAM_H, player.posZ - CAM_DIST);
  camera.lookAt(player.posX, 1.2, player.posZ + 16);
  camera.fov = 65;
  camera.updateProjectionMatrix();
}

function crash() {
  state = 'gameover';
  dom.hud.style.display = 'none';
  dom.gameOver.style.display = 'flex';
  dom.finalScore.textContent = Math.floor(score);
}

// ============================================================
//  MENU
// ============================================================
const menu = new Menu(startGame, onGaragePreview);

document.getElementById('retry-btn').addEventListener('click', retryGame);
document.getElementById('mainmenu-btn').addEventListener('click', goToMainMenu);

// ============================================================
//  MAIN LOOP
// ============================================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state === 'menu') {
    updateDemo(dt);
  } else if (state === 'garage') {
    updateGarage(dt);
  } else if (state === 'playing') {
    player.update(dt, getInput());

    const ms = player.absSpeed / 3.6;
    distance += ms * dt;
    score    += ms * dt * 0.5;

    updateCamera();

    world.update(player.posZ);
    world.updateTheme(dt, renderer);
    world.updateWeather(dt, player.posX, player.posZ);
    world.updateClouds(dt, player.posZ);
    world.followPlayer(player.posX, player.posZ);

    traffic.update(dt, player.posX, player.posZ, player.absSpeed, distance);

    if (traffic.checkCollision(player.posX, player.posZ, player.halfW, player.halfL)) {
      crash();
    }

    if (nearMissTimer > 0) {
      nearMissTimer -= dt;
      if (nearMissTimer <= 0) nearMissCombo = 0;
    }

    updateHUD();
  }

  renderer.render(scene, camera);
}

animate();

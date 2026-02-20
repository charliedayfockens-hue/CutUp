import * as THREE from 'three';
import { World } from './World.js';
import { CarController, BINDINGS } from './CarController.js';
import { TrafficManager } from './TrafficManager.js';
import { Menu } from './Menu.js';

// ============================================================
//  GAME STATE
// ============================================================
let state = 'menu';   // 'menu' | 'garage' | 'playing' | 'paused' | 'gameover'
let score = 0;
let distance = 0;
let nearMissCombo = 0;
let nearMissTimer = 0;
let screenShake = 0;

let currentTheme   = 'day';
let currentCar     = '#33cc55';
let currentVehicle = 'sports';

// ============================================================
//  INPUT — Direct Mapping via BINDINGS
// ============================================================
const keysDown = {};
const touch = { left: false, right: false, gas: false, brake: false };

document.addEventListener('keydown', e => {
  // Escape toggles pause
  if (e.code === 'Escape') {
    if (state === 'playing') { pause(); return; }
    if (state === 'paused')  { resume(); return; }
  }
  keysDown[e.code] = true;
  keysDown[e.key.toLowerCase()] = true;
});
document.addEventListener('keyup', e => {
  keysDown[e.code] = false;
  keysDown[e.key.toLowerCase()] = false;
});

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
  startScreen:  document.getElementById('start-screen'),
  garagePanel:  document.getElementById('garage-panel'),
  pauseScreen:  document.getElementById('pause-screen'),
  gameOver:     document.getElementById('game-over'),
  hud:          document.getElementById('hud'),
  speedVal:     document.getElementById('speed-value'),
  scoreVal:     document.getElementById('score-value'),
  nearMiss:     document.getElementById('near-miss-popup'),
  finalScore:   document.getElementById('final-score-value'),
};

// ============================================================
//  THREE.JS SETUP
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
const camera = new THREE.PerspectiveCamera(60, RENDER_W / RENDER_H, 0.5, 1000);

// ============================================================
//  GAME OBJECTS
// ============================================================
const world   = new World(scene);
const player  = new CarController(scene);
const traffic = new TrafficManager(scene);

// ============================================================
//  CAMERA
//  - Y and Z strictly locked to player offset (no speed zoom on Z)
//  - X has subtle speed-proportional sine sway
//  - FOV lerps from 60 (stopped) to 66 (max speed) — 10% boost
//  - Z-axis quaternion roll when turning, lerps back to 0
// ============================================================
const CAM_DIST    = 7;
const CAM_H       = 3;
const CAM_FOV_MIN = 60;
const CAM_FOV_MAX = 66;   // exactly 10% higher than base
const MAX_SPEED   = 280;

let camRoll = 0;
const _rollQ    = new THREE.Quaternion();
const _rollAxis = new THREE.Vector3(0, 0, 1);

function updateCamera() {
  const speedRatio = player.absSpeed / MAX_SPEED;

  // Subtle X-axis sine sway — speed-proportional, no Z zoom
  const sway = Math.sin(Date.now() * 0.005) * speedRatio * 0.5;

  // Strictly locked Y and Z
  camera.position.x = player.posX + sway;
  camera.position.y = CAM_H;
  camera.position.z = player.posZ - CAM_DIST;

  // Screen shake
  if (screenShake > 0) {
    camera.position.x += (Math.random() - 0.5) * screenShake * 2;
    camera.position.y += (Math.random() - 0.5) * screenShake;
    screenShake *= 0.88;
    if (screenShake < 0.01) screenShake = 0;
  }

  // Look slightly ahead
  camera.lookAt(player.posX, 1.2, player.posZ + 16);

  // Smooth Z-roll when turning (simulate weight transfer)
  const targetRoll = -player.lateralDir * (Math.PI / 64);
  camRoll = THREE.MathUtils.lerp(camRoll, targetRoll, 0.1);
  if (Math.abs(camRoll) > 0.0001) {
    _rollQ.setFromAxisAngle(_rollAxis, camRoll);
    camera.quaternion.multiply(_rollQ);
  }

  // 10% FOV speed boost — lerp so it feels smooth
  camera.fov = THREE.MathUtils.lerp(
    camera.fov,
    CAM_FOV_MIN + speedRatio * (CAM_FOV_MAX - CAM_FOV_MIN),
    0.05
  );
  camera.updateProjectionMatrix();
}

// ============================================================
//  DEMO MODE — auto-drive behind main-menu
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
//  GARAGE TURNTABLE — 3D preview while in garage panel
// ============================================================
function onGaragePreview(theme, vehicleType, carColor) {
  currentTheme   = theme;
  currentVehicle = vehicleType || 'sports';
  currentCar     = carColor    || '#33cc55';

  world.setTheme(theme);
  player.setVehicle(currentVehicle);
  player.setColor(currentCar);

  player.playerGroup.position.set(0, 0, 0);
  player.playerGroup.rotation.set(0, 0, 0);

  state = 'garage';
}

function updateGarage(dt) {
  player.playerGroup.rotation.y += 0.8 * dt;
  player.tickAnimations();

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
  currentCar     = carColor    || '#33cc55';
  currentVehicle = vehicleType || 'sports';

  dom.garagePanel.classList.remove('visible');
  dom.hud.style.display = 'block';

  world.setTheme(theme);
  player.setVehicle(currentVehicle);
  player.setColor(currentCar);
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
  dom.gameOver.style.display  = 'none';
  dom.pauseScreen.style.display = 'none';
  dom.hud.style.display       = 'none';
  resetGame();
  state = 'menu';
  world.setTheme('day');
  menu.show();
}

function pause() {
  state = 'paused';
  dom.pauseScreen.style.display = 'flex';
}

function resume() {
  dom.pauseScreen.style.display = 'none';
  clock.getDelta(); // flush dt accumulated during pause
  state = 'playing';
}

function resetGame() {
  score = 0; distance = 0;
  nearMissCombo = 0; nearMissTimer = 0;
  screenShake = 0; camRoll = 0;
  player.reset();
  traffic.reset();
  world.reset();

  // Snap camera behind car at highway start
  camera.position.set(player.posX, CAM_H, player.posZ - CAM_DIST);
  camera.lookAt(player.posX, 1.2, player.posZ + 16);
  camera.fov = CAM_FOV_MIN;
  camera.updateProjectionMatrix();
}

function crash() {
  state = 'gameover';
  dom.hud.style.display  = 'none';
  dom.gameOver.style.display = 'flex';
  dom.finalScore.textContent = Math.floor(score);
}

// ============================================================
//  MENU + BUTTON WIRING
// ============================================================
const menu = new Menu(startGame, onGaragePreview);

document.getElementById('retry-btn').addEventListener('click', retryGame);
document.getElementById('mainmenu-btn').addEventListener('click', goToMainMenu);
document.getElementById('pause-btn').addEventListener('click', pause);
document.getElementById('resume-btn').addEventListener('click', resume);
document.getElementById('pause-mainmenu-btn').addEventListener('click', goToMainMenu);

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

    const ms  = player.absSpeed / 3.6;
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

  } else if (state === 'paused') {
    // Freeze — just render the current frame with no updates
  }

  renderer.render(scene, camera);
}

animate();

import * as THREE from 'three';
import { World } from './World.js';
import { CarController, BINDINGS } from './CarController.js';
import { TrafficManager } from './TrafficManager.js';
import { Menu } from './Menu.js';

// ============================================================
//  GAME STATE
// ============================================================
let state = 'menu';   // 'menu' | 'playing' | 'gameover'
let score = 0;
let distance = 0;
let nearMissCombo = 0;
let nearMissTimer = 0;
let screenShake = 0;

// Current selections (persisted for Retry)
let currentTheme = 'day';
let currentCar = '#33cc55';
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
      moveDir += cfg.move;
      wheelAngle += cfg.wheel;
    }
  }

  if (keysDown['ArrowLeft'] || touch.left) {
    moveDir += BINDINGS['a'].move;
    wheelAngle += BINDINGS['a'].wheel;
  }
  if (keysDown['ArrowRight'] || touch.right) {
    moveDir += BINDINGS['d'].move;
    wheelAngle += BINDINGS['d'].wheel;
  }

  moveDir = Math.max(-1, Math.min(1, moveDir));
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

const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(RENDER_W, RENDER_H, false);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, RENDER_W / RENDER_H, 0.5, 1000);
camera.position.set(0, 3, -7);
camera.lookAt(0, 0, 10);

// ============================================================
//  CREATE GAME OBJECTS
// ============================================================
const world   = new World(scene);
const player  = new CarController(scene);
const traffic = new TrafficManager(scene);

// ============================================================
//  DEMO MODE — auto-driving car shown behind menu
// ============================================================
function updateDemo(dt) {
  const demoInput = { gas: true, brake: false, moveDir: 0, wheelAngle: 0 };
  const t = performance.now() * 0.001;
  const weave = Math.sin(t * 0.4) * 0.3;
  demoInput.moveDir = weave;
  demoInput.wheelAngle = weave * 15;

  player.update(dt, demoInput);

  world.update(player.posZ);
  world.updateTheme(dt, renderer);
  world.updateWeather(dt, player.posX, player.posZ);
  world.updateClouds(dt, player.posZ);
  world.followPlayer(player.posX, player.posZ);

  traffic.update(dt, player.posX, player.posZ, player.absSpeed, 0);

  updateCamera(dt);
}

// Near-miss callback
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
//  CAMERA — Fixed distance (Z=7, Y=3) + speed-based sway
// ============================================================
const CAM_DIST = 7;
const CAM_H    = 3;
const MAX_SPEED = 280;

function updateCamera(dt) {
  const speedRatio = player.absSpeed / MAX_SPEED;

  // Sway: subtle sine on X proportional to speed
  const sway = Math.sin(Date.now() * 0.005) * speedRatio * 0.5;

  const tx = player.posX + sway;
  const ty = CAM_H;
  const tz = player.posZ - CAM_DIST;

  const s = 4 * dt;
  camera.position.x += (tx - camera.position.x) * s;
  camera.position.y += (ty - camera.position.y) * s * 0.8;
  camera.position.z += (tz - camera.position.z) * s;

  // Shake
  if (screenShake > 0) {
    camera.position.x += (Math.random() - 0.5) * screenShake * 2;
    camera.position.y += (Math.random() - 0.5) * screenShake;
    screenShake *= 0.88;
    if (screenShake < 0.01) screenShake = 0;
  }

  // Fixed look-ahead
  camera.lookAt(player.posX, 1.2, player.posZ + 16);

  // Fixed FOV — no speed zoom
  camera.fov = 65;
  camera.updateProjectionMatrix();
}

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
  currentTheme = theme;
  currentCar = carColor || '#33cc55';
  currentVehicle = vehicleType || 'sports';

  dom.startScreen.style.display = 'none';
  dom.hud.style.display = 'block';
  world.setTheme(theme);
  player.setVehicle(currentVehicle);
  player.setColor(currentCar);
  resetGame();
  state = 'playing';
}

function retryGame() {
  dom.gameOver.style.display = 'none';
  dom.hud.style.display = 'block';
  resetGame();
  state = 'playing';
}

function goToMainMenu() {
  dom.gameOver.style.display = 'none';
  dom.hud.style.display = 'none';
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
  camera.position.set(player.posX, CAM_H, player.posZ - CAM_DIST);
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
const menu = new Menu(startGame);

// Game Over buttons
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
  } else if (state === 'playing') {
    // Player
    player.update(dt, getInput());

    // Distance / score
    const ms = player.absSpeed / 3.6;
    distance += ms * dt;
    score += ms * dt * 0.5;

    // Camera
    updateCamera(dt);

    // World
    world.update(player.posZ);
    world.updateTheme(dt, renderer);
    world.updateWeather(dt, player.posX, player.posZ);
    world.updateClouds(dt, player.posZ);
    world.followPlayer(player.posX, player.posZ);

    // Traffic
    traffic.update(dt, player.posX, player.posZ, player.absSpeed, distance);

    // Collision — uses per-vehicle hitbox dimensions
    if (traffic.checkCollision(player.posX, player.posZ, player.halfW, player.halfL)) {
      crash();
    }

    // Near-miss combo timer
    if (nearMissTimer > 0) {
      nearMissTimer -= dt;
      if (nearMissTimer <= 0) nearMissCombo = 0;
    }

    // HUD
    updateHUD();
  }

  renderer.render(scene, camera);
}

animate();

import * as THREE from 'three';
import { World } from './World.js';
import { CarController } from './CarController.js';
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

// ============================================================
//  INPUT
// ============================================================
const keys = {};
const touch = { left: false, right: false, gas: false, brake: false };

document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup',   e => { keys[e.code] = false; });

function getInput() {
  return {
    gas:   keys['KeyW'] || keys['ArrowUp']    || touch.gas,
    brake: keys['KeyS'] || keys['ArrowDown']  || keys['Space'] || touch.brake,
    left:  keys['KeyA'] || keys['ArrowLeft']  || touch.left,
    right: keys['KeyD'] || keys['ArrowRight'] || touch.right,
  };
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
//  THREE.JS SETUP
// ============================================================
const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 1000);
camera.position.set(0, 8, -14);
camera.lookAt(0, 0, 20);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
//  CREATE GAME OBJECTS
// ============================================================
const world   = new World(scene);
const player  = new CarController(scene);
const traffic = new TrafficManager(scene);

// Near-miss callback
traffic.onNearMiss = () => {
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
//  CAMERA CONTROLLER
// ============================================================
function updateCamera(dt) {
  const ratio = player.absSpeed / 280;
  const dist  = 13 + ratio * 4;
  const h     = 5.5 + ratio * 1.8;
  const tx = player.posX;
  const ty = h;
  const tz = player.posZ - dist;

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

  // Look ahead
  camera.lookAt(player.posX, 1.5, player.posZ + 18 + ratio * 22);

  // Speed FOV
  const targetFov = 65 + ratio * 15;
  camera.fov += (targetFov - camera.fov) * dt * 2;
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
function startGame(theme) {
  dom.startScreen.style.display = 'none';
  dom.hud.style.display = 'block';
  world.setTheme(theme);
  resetGame();
  state = 'playing';
}

function restartGame() {
  dom.gameOver.style.display = 'none';
  dom.hud.style.display = 'block';
  resetGame();
  state = 'playing';
}

function resetGame() {
  score = 0;
  distance = 0;
  nearMissCombo = 0;
  nearMissTimer = 0;
  screenShake = 0;
  player.reset();
  traffic.reset();
  world.reset();                       // <-- fixes "Try Again" vanishing road
  camera.position.set(player.posX, 8, player.posZ - 14);
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
// The map-selection overlay is shown first; once a theme is picked,
// it hides and calls startGame(theme).
const menu = new Menu(startGame);

// "Try Again" goes straight back without re-showing map select
document.getElementById('restart-btn').addEventListener('click', restartGame);

// ============================================================
//  MAIN LOOP
// ============================================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state === 'playing') {
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
    world.followPlayer(player.posX, player.posZ);

    // Traffic
    traffic.update(dt, player.posX, player.posZ, player.absSpeed, distance);

    // Collision
    if (traffic.checkCollision(player.posX, player.posZ, 1.0, 2.1)) {
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

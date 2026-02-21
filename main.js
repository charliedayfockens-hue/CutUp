import * as THREE from 'three';
import { World } from './World.js';
import { CarController, BINDINGS, galaxyMat } from './CarController.js';
import { TrafficManager } from './TrafficManager.js';
import { Menu } from './Menu.js';
import { CarEditor } from './CarEditor.js';

// ============================================================
//  GAME STATE
// ============================================================
let state = 'menu';   // 'menu' | 'garage' | 'editor' | 'playing' | 'paused' | 'gameover'
let score = 0;
let distance = 0;
let nearMissCombo = 0;
let nearMissTimer = 0;
let screenShake = 0;

let currentTheme   = 'day';
let currentCar     = '#33cc55';
let currentVehicle = 'sports';
let activeCarId    = null;   // null = stock, string = custom save ID

// ---- Nitro ----
let nitroLevel    = 0;   // 0–100
const NITRO_MAX   = 100;
const NITRO_DRAIN = 20;
const NITRO_GAIN_TOP_SPEED = 5;
const NITRO_GAIN_NEAR_MISS = 15;

// ---- Hit-stop ----
let hitStopTimer = 0;
let gameSpeed    = 1;

// ============================================================
//  INPUT — Direct Mapping via BINDINGS
// ============================================================
const keysDown = {};
const touch = { left: false, right: false, gas: false, brake: false };

document.addEventListener('keydown', e => {
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
  const nitro = keysDown['ShiftLeft'] || keysDown['ShiftRight'];

  // Lane-based directional intent
  const left  = keysDown['KeyA'] || keysDown['a'] || keysDown['ArrowLeft']  || touch.left;
  const right = keysDown['KeyD'] || keysDown['d'] || keysDown['ArrowRight'] || touch.right;

  let moveDir = 0;
  if (left)  moveDir = -1;
  if (right) moveDir =  1;

  return { gas, brake, moveDir, left, right, nitro };
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
  nitroFill:    document.getElementById('nitro-fill'),
  comboDisplay: document.getElementById('combo-display'),
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
//  Menu is created first so editor can share its SaveManager.
// ============================================================
const world   = new World(scene);
const player  = new CarController(scene);
const traffic = new TrafficManager(scene);

// Menu must come before editor so we can pass menu.saveManager
const menu = new Menu(startGame, onGaragePreview);

// Editor receives the shared SaveManager from Menu
const editor = new CarEditor(scene, camera, renderer, menu.saveManager);

// Attach default custom group to player
player.attachCustomGroup(editor.getCustomCarGroup());

// ============================================================
//  CAMERA
// ============================================================
const CAM_DIST    = 7;
const CAM_H       = 3;
const CAM_FOV_MIN = 60;
const CAM_FOV_MAX = 66;   // 10% higher than base at max speed
const CAM_FOV_NITRO = 70;
const MAX_SPEED   = 280;

let camRoll = 0;
const _rollQ    = new THREE.Quaternion();
const _rollAxis = new THREE.Vector3(0, 0, 1);

function updateCamera() {
  const speedRatio = player.absSpeed / MAX_SPEED;

  // Subtle X-axis sine sway — speed-proportional, Z stays locked
  const sway = Math.sin(Date.now() * 0.005) * speedRatio * 0.5;

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

  camera.lookAt(player.posX, 1.2, player.posZ + 16);

  // Smooth Z-roll (G-force simulation)
  const targetRoll = -player.lateralDir * (Math.PI / 64);
  camRoll = THREE.MathUtils.lerp(camRoll, targetRoll, 0.1);
  if (Math.abs(camRoll) > 0.0001) {
    _rollQ.setFromAxisAngle(_rollAxis, camRoll);
    camera.quaternion.multiply(_rollQ);
  }

  // FOV: +10% at max speed, extra for nitro
  const targetFov = player.nitroActive
    ? CAM_FOV_NITRO
    : CAM_FOV_MIN + speedRatio * (CAM_FOV_MAX - CAM_FOV_MIN);
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.05);
  camera.updateProjectionMatrix();
}

// ============================================================
//  DEMO MODE — auto-drive behind main-menu
// ============================================================
function updateDemo(dt) {
  const t = performance.now() * 0.001;
  const weave = Math.sin(t * 0.4) * 0.3;
  player.update(dt, { gas: true, brake: false, moveDir: weave, left: false, right: false, nitro: false });

  world.update(player.posZ);
  world.updateTheme(dt, renderer);
  world.updateWeather(dt, player.posX, player.posZ);
  world.updateClouds(dt, player.posZ);
  world.followPlayer(player.posX, player.posZ);
  traffic.update(dt, player.posX, player.posZ, player.absSpeed, 0);

  updateCamera();
}

// ============================================================
//  GARAGE TURNTABLE
// ============================================================
function onGaragePreview(theme, vehicleType, carColor, carId) {
  currentTheme   = theme;
  currentVehicle = vehicleType || 'sports';
  currentCar     = carColor    || '#33cc55';
  // Sync activeCarId from menu so garage shows the right car
  activeCarId    = carId || null;

  world.setTheme(theme);

  // Rebuild garage preview from the correct source
  if (activeCarId) {
    // Custom build: load from SaveManager into editor.customCarGroup, show it directly.
    // Player group is hidden so only the editor's group is visible (no duplicates).
    const saved = menu.saveManager.getCar(activeCarId);
    if (saved) {
      const baseColor = (currentCar === 'rainbow' || currentCar === 'galaxy')
        ? '#33cc55'
        : currentCar;
      editor.importParts(saved.parts, baseColor);
      if (currentCar === 'galaxy') {
        // Apply galaxy shader to colorable parts in the custom car group
        editor.customCarGroup.traverse(child => {
          if (child.isMesh && child.userData.isColorable) {
            child.material = galaxyMat;
          }
        });
      } else if (currentCar !== 'rainbow') {
        editor.applyMainColor(currentCar);
      }
      // rainbow: let updateGarage animate colors each frame
    }
    editor.customCarGroup.position.set(0, 0, 0);
    editor.customCarGroup.rotation.set(0, 0, 0);
    editor.customCarGroup.visible = true;
    player.playerGroup.visible = false;
  } else {
    // Stock: hide custom group, show player with correct vehicle
    editor.customCarGroup.visible = false;
    player.playerGroup.visible = true;
    player.setVehicle(currentVehicle);
    player.setColor(currentCar);
    player.playerGroup.position.set(0, 0, 0);
    player.playerGroup.rotation.set(0, 0, 0);
  }

  state = 'garage';
}

function updateGarage(dt) {
  // Spinning turntable — explicitly gated to GARAGE state
  if (state === 'garage') {
    if (activeCarId && editor.customCarGroup.visible) {
      // Custom car: rotate the editor group directly
      editor.customCarGroup.rotation.y += 0.8 * dt;
      // Animate special color modes on the custom car group
      if (currentCar === 'rainbow') {
        const hsl = (Date.now() * 0.0005) % 1;
        const color = new THREE.Color().setHSL(hsl, 1, 0.5);
        editor.customCarGroup.traverse(child => {
          if (child.isMesh && child.userData.isColorable && child.material.color) {
            child.material.color.copy(color);
          }
        });
      } else if (currentCar === 'galaxy') {
        galaxyMat.uniforms.uTime.value = performance.now() * 0.001;
      }
    } else {
      // Stock car: rotate the player group
      player.playerGroup.rotation.y += 0.8 * dt;
      player.tickAnimations();
    }
  }

  camera.position.set(0, 2, 5);
  camera.lookAt(0, 1, 0);
  camera.fov = 65;
  camera.updateProjectionMatrix();
}

// ============================================================
//  EDITOR STATE
// ============================================================

/**
 * @param {string|null} carId — null for a fresh build, string to edit existing
 */
function enterEditor(carId) {
  state = 'editor';

  // Track which car we're editing at the top level
  activeCarId = carId || null;

  menu.hideGarage();

  world.setVisibility(false);
  traffic.setVisibility(false);
  player.playerGroup.visible = false;

  // Enter editor: loads carId data if provided, else fresh canvas
  editor.enter(currentCar, carId);
}

function exitEditor(savedCarId) {
  editor.exit();

  world.setVisibility(true);
  traffic.setVisibility(true);
  player.playerGroup.visible = true;

  // Tell menu to return to custom gallery
  menu.onEditorClosed(savedCarId);

  state = 'menu';
}

function updateEditor() {
  editor.update();
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

  nitroLevel = Math.min(NITRO_MAX, nitroLevel + NITRO_GAIN_NEAR_MISS);

  dom.nearMiss.textContent = nearMissCombo > 1
    ? `NEAR MISS x${nearMissCombo}! +${bonus}`
    : `NEAR MISS! +${bonus}`;
  dom.nearMiss.classList.add('show');
  setTimeout(() => dom.nearMiss.classList.remove('show'), 700);

  if (nearMissCombo > 1) {
    dom.comboDisplay.textContent = `COMBO x${nearMissCombo}`;
    dom.comboDisplay.classList.add('show');
  }
};

// ============================================================
//  NITRO SYSTEM
// ============================================================
function updateNitro(dt, input) {
  const speedRatio = player.absSpeed / MAX_SPEED;
  if (speedRatio > 0.9) {
    nitroLevel = Math.min(NITRO_MAX, nitroLevel + NITRO_GAIN_TOP_SPEED * dt);
  }

  if (input.nitro && nitroLevel > 0) {
    player.nitroActive = true;
    nitroLevel = Math.max(0, nitroLevel - NITRO_DRAIN * dt);
  } else {
    player.nitroActive = false;
  }

  const pct = (nitroLevel / NITRO_MAX) * 100;
  dom.nitroFill.style.width = `${pct}%`;
  if (player.nitroActive) {
    dom.nitroFill.classList.add('active');
  } else {
    dom.nitroFill.classList.remove('active');
  }
}

// ============================================================
//  HIT-STOP EFFECT
// ============================================================
function triggerHitStop() {
  hitStopTimer = 0.3; // 300ms
  gameSpeed = 0.1;
  screenShake = 1.0;
}

function updateHitStop(dt) {
  if (hitStopTimer > 0) {
    hitStopTimer -= dt;
    if (hitStopTimer <= 0) {
      hitStopTimer = 0;
      gameSpeed = 1;
    }
  }
}

// ============================================================
//  HUD
// ============================================================
function updateHUD() {
  dom.speedVal.textContent = Math.floor(player.absSpeed);
  dom.scoreVal.textContent = Math.floor(score);

  if (nearMissTimer <= 0 && nearMissCombo === 0) {
    dom.comboDisplay.classList.remove('show');
  }
}

// ============================================================
//  GAME FLOW
// ============================================================

/**
 * Called by Menu when the user clicks GO!
 * @param {string}      theme
 * @param {string}      carColor    — hex, 'rainbow', or 'galaxy'
 * @param {string}      vehicleType — 'sports' | 'limo' | 'custom'
 * @param {string|null} carId       — null = stock, string = custom build ID
 */
function startGame(theme, carColor, vehicleType, carId) {
  currentTheme   = theme;
  currentCar     = carColor    || '#33cc55';
  currentVehicle = vehicleType || 'sports';
  activeCarId    = carId || null;

  dom.garagePanel.classList.remove('visible');
  dom.hud.style.display = 'block';

  world.setTheme(theme);

  if (activeCarId) {
    // Custom build: import → clone into playerGroup → hide editor group
    const saved = menu.saveManager.getCar(activeCarId);
    if (saved) {
      editor.importParts(saved.parts, saved.mainColor || currentCar);
      editor.applyMainColor(currentCar);
      editor.customCarGroup.visible = false; // avoid double-rendering
      player.attachCustomGroup(editor.getCustomCarGroup());
      player.useCustomCar();
      player.setColor(currentCar);  // apply solid/rainbow/galaxy to custom parts
      player.playerGroup.visible = true;
    }
  } else {
    // Stock vehicle
    editor.customCarGroup.visible = false;
    player.setVehicle(currentVehicle);
    player.setColor(currentCar);
    player.playerGroup.visible = true;
  }

  player.playerGroup.rotation.set(0, 0, 0);

  resetGame();
  state = 'playing';
}

function retryGame() {
  dom.gameOver.style.display = 'none';
  dom.hud.style.display = 'block';

  if (activeCarId) {
    const saved = menu.saveManager.getCar(activeCarId);
    if (saved) {
      editor.importParts(saved.parts, saved.mainColor || currentCar);
      editor.applyMainColor(currentCar);
      editor.customCarGroup.visible = false;
      player.attachCustomGroup(editor.getCustomCarGroup());
      player.useCustomCar();
      player.setColor(currentCar);  // apply solid/rainbow/galaxy to custom parts
      player.playerGroup.visible = true;
    }
  } else {
    editor.customCarGroup.visible = false;
    player.setVehicle(currentVehicle);
    player.setColor(currentCar);
    player.playerGroup.visible = true;
  }

  player.playerGroup.rotation.set(0, 0, 0);
  resetGame();
  state = 'playing';
}

function goToMainMenu() {
  dom.gameOver.style.display    = 'none';
  dom.pauseScreen.style.display = 'none';
  dom.hud.style.display         = 'none';
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
  clock.getDelta(); // flush accumulated dt during pause
  state = 'playing';
}

function resetGame() {
  score = 0; distance = 0;
  nearMissCombo = 0; nearMissTimer = 0;
  screenShake = 0; camRoll = 0;
  nitroLevel = 0; hitStopTimer = 0; gameSpeed = 1;
  player.reset();
  traffic.reset();
  world.reset();

  dom.nitroFill.style.width = '0%';
  dom.nitroFill.classList.remove('active');
  dom.comboDisplay.classList.remove('show');

  camera.position.set(player.posX, CAM_H, player.posZ - CAM_DIST);
  camera.lookAt(player.posX, 1.2, player.posZ + 16);
  camera.fov = CAM_FOV_MIN;
  camera.updateProjectionMatrix();
}

function crash() {
  triggerHitStop();

  setTimeout(() => {
    state = 'gameover';
    dom.hud.style.display      = 'none';
    dom.gameOver.style.display = 'flex';
    dom.finalScore.textContent = Math.floor(score);
    gameSpeed    = 1;
    hitStopTimer = 0;
  }, 350);
}

// ============================================================
//  MENU + BUTTON WIRING
// ============================================================

// Wire editor-open callback — receives carId (null = new build)
menu.onEditorOpen = enterEditor;

// Wire editor done callback — receives savedCarId from editor
editor.onDone = exitEditor;

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
  const rawDt = Math.min(clock.getDelta(), 0.05);

  updateHitStop(rawDt);
  const dt = rawDt * gameSpeed;

  if (state === 'menu') {
    updateDemo(dt);

  } else if (state === 'garage') {
    updateGarage(dt);

  } else if (state === 'editor') {
    updateEditor();

  } else if (state === 'playing') {
    const input = getInput();
    player.update(dt, input);

    updateNitro(dt, input);

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
    // Frozen — render current frame only
  }

  renderer.render(scene, camera);
}

animate();

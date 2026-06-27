import * as THREE from "three";
import { GLTFLoader } from "../vendor/three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "../vendor/three/examples/jsm/loaders/DRACOLoader.js";
import { PointerLockControls } from "../vendor/three/examples/jsm/controls/PointerLockControls.js";
import { EffectComposer } from "../vendor/three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { clone as cloneSkinned } from "../vendor/three/examples/jsm/utils/SkeletonUtils.js";

const statusEl = document.getElementById("status");
const overlayEl = document.getElementById("overlay");
const errorBoxEl = document.getElementById("errorBox");
const startBtn = document.getElementById("startBtn");
const homeBtn = document.getElementById("homeBtn");
const app = document.getElementById("app");

const CORRIDOR_LENGTH = 28.0;
const CORRIDOR_WIDTH = 2.9;
const CORRIDOR_HEIGHT = 3.25;
const WALL_THICKNESS = 0.18;

const SECRET_ROOM_LENGTH = 5.5;
const SECRET_ROOM_DEPTH = 4.2;
const SECRET_ROOM_HEIGHT = 3.1;
const SECRET_ROOM_OPENING = 1.55;
const SECRET_ROOM_CENTER_Y = CORRIDOR_LENGTH * 0.74;

const CEILING_LIGHT_CONFIG = [
  { name: "CeilingLight_01", state: "ON" },
  { name: "CeilingLight_02", state: "BROKEN" },
  { name: "CeilingLight_03", state: "OFF" },
  { name: "CeilingLight_04", state: "ON" },
  { name: "CeilingLight_05", state: "BROKEN" },
  { name: "CeilingLight_06", state: "ON" },
  { name: "CeilingLight_07", state: "OFF" },
];

const ASSET_PATHS = {
  vending_machine: "../realistic_vending_machine__3d_model/scene.glb",
  wheelchair: "../wheel_chair/scene.gltf",
  chair_a: "../chair/scene.gltf",
  chair_b: "../chair%20(1)/scene.gltf",
  steel_door: "../worn_steel_door/scene.gltf",
  zombie: "../animated_injured_zombie_crawling_loop/scene.gltf",
};
const MUSIC_PATH = "../Hollow%20Framework.mp3";
const SCENE_FETCH_TIMEOUT_MS = 30000;
const ASSET_LOAD_TIMEOUT_MS = 120000;
const TEXTURE_LOAD_TIMEOUT_MS = 120000;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080a);
scene.fog = new THREE.FogExp2(0x090b0d, 0.055);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
app.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(0.0, 1.62, -1.25);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.95, 0.65, 0.18));

const controls = new PointerLockControls(camera, document.body);

const clock = new THREE.Clock();
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("../vendor/three/examples/jsm/libs/draco/gltf/");
loader.setDRACOLoader(dracoLoader);
const textureLoader = new THREE.TextureLoader();
const movement = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
};

const velocity = new THREE.Vector3();
const previousPosition = new THREE.Vector3();
const ceilingFixtures = [];
const strobeLights = [];
const pointAtmospherics = [];
const neonSigns = [];
const animationMixers = [];
const zombieActors = [];
const assetCache = new Map();
let sceneData = null;
let ready = false;
let bootstrapPromise = null;
let animationStarted = false;
let flashlightEnabled = true;
let musicWanted = true;
let interactiveDoor = null;
let zombieMaterialTemplate = null;

const ambientTrack = new Audio(MUSIC_PATH);
ambientTrack.loop = true;
ambientTrack.preload = "metadata";
ambientTrack.volume = 0.34;

const flashlight = new THREE.SpotLight(0xf4f1de, 12, 12, Math.PI / 6, 0.55, 1.9);
flashlight.position.set(0, 0, 0);
flashlight.target.position.set(0, 0, -5);
camera.add(flashlight);
camera.add(flashlight.target);
scene.add(camera);

const ambient = new THREE.AmbientLight(0x5a625d, 0.18);
scene.add(ambient);

const hemisphere = new THREE.HemisphereLight(0x667170, 0x100d0a, 0.15);
scene.add(hemisphere);

const backGlow = new THREE.PointLight(0xffd19b, 2.4, 18, 1.9);
backGlow.position.set(0.0, 2.35, -24.8);
scene.add(backGlow);

const entryLeak = new THREE.PointLight(0xdde8ff, 0.55, 8, 2.0);
entryLeak.position.set(-0.55, 2.6, -1.8);
scene.add(entryLeak);

const blenderBasis = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const blenderBasisInv = blenderBasis.clone().invert();

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#ffd9df" : "#eff4ff";
}

function showError(message) {
  errorBoxEl.style.display = "block";
  errorBoxEl.textContent = message;
  setStatus(message, true);
}

function hideOverlay() {
  overlayEl.style.display = "none";
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} non ha risposto entro ${Math.round(timeoutMs / 1000)} secondi.`)), timeoutMs);
    }),
  ]);
}

function showOverlay(message = "Premi Entra per tornare nel corridoio.") {
  if (controls.isLocked) {
    controls.unlock();
  }
  overlayEl.style.display = "grid";
  errorBoxEl.style.display = "none";
  errorBoxEl.textContent = "";
  startBtn.disabled = false;
  startBtn.textContent = "Entra";
  setStatus(message);
}

function syncMusicButton() {
  return !ambientTrack.paused && musicWanted;
}

async function ensureMusicStarted() {
  if (!musicWanted) {
    syncMusicButton();
    return;
  }

  try {
    await ambientTrack.play();
  } catch (error) {
    console.warn("Music playback deferred:", error);
  }
  syncMusicButton();
}

function pauseMusic() {
  ambientTrack.pause();
  syncMusicButton();
}

async function toggleMusic() {
  musicWanted = !musicWanted;
  if (musicWanted) {
    await ensureMusicStarted();
  } else {
    pauseMusic();
  }
}

function createCanvasTexture(width, height, painter) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  painter(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function makeWallTexture() {
  const texture = createCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#5e6157";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4200; i += 1) {
      const shade = 92 + Math.random() * 34;
      ctx.fillStyle = `rgba(${shade}, ${shade - 4}, ${shade - 10}, ${0.08 + Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2 + Math.random() * 8);
    }
    for (let i = 0; i < 70; i += 1) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 40 + Math.random() * 160;
      const grad = ctx.createLinearGradient(x, y, x, y + len);
      grad.addColorStop(0, "rgba(22, 18, 12, 0)");
      grad.addColorStop(0.5, "rgba(22, 18, 12, 0.18)");
      grad.addColorStop(1, "rgba(22, 18, 12, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, 10 + Math.random() * 16, len);
    }
  });
  texture.repeat.set(3, 6);
  return texture;
}

function makeFloorTexture() {
  const texture = createCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#34281e";
    ctx.fillRect(0, 0, w, h);
    const rows = 18;
    const rowH = h / rows;
    for (let r = 0; r < rows; r += 1) {
      ctx.fillStyle = r % 2 === 0 ? "#423124" : "#372a1f";
      ctx.fillRect(0, r * rowH, w, rowH);
      ctx.strokeStyle = "rgba(18, 12, 8, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, r * rowH);
      ctx.lineTo(w, r * rowH);
      ctx.stroke();
    }
    for (let i = 0; i < 1200; i += 1) {
      const shade = 18 + Math.random() * 20;
      ctx.fillStyle = `rgba(${shade}, ${shade - 2}, ${shade - 4}, ${0.05 + Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 9, 1 + Math.random() * 18);
    }
  });
  texture.repeat.set(2.2, 16);
  return texture;
}

function makeCeilingTexture() {
  const texture = createCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#2b2a27";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i += 1) {
      const shade = 80 + Math.random() * 24;
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade - 4}, ${0.06 + Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6);
    }
  });
  texture.repeat.set(2.5, 18);
  return texture;
}

function makeSecretWallTexture() {
  const texture = createCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#332022";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i += 1) {
      const red = 70 + Math.random() * 28;
      ctx.fillStyle = `rgba(${red}, ${28 + Math.random() * 18}, ${30 + Math.random() * 20}, ${0.09 + Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 2 + Math.random() * 10);
    }
  });
  texture.repeat.set(2.3, 5);
  return texture;
}

const materials = {
  corridorWall: new THREE.MeshStandardMaterial({
    map: makeWallTexture(),
    color: 0xb4b2a1,
    roughness: 0.92,
    metalness: 0.03,
    side: THREE.DoubleSide,
  }),
  corridorCeiling: new THREE.MeshStandardMaterial({
    map: makeCeilingTexture(),
    color: 0x6b685d,
    roughness: 0.94,
    metalness: 0.03,
    side: THREE.DoubleSide,
  }),
  corridorFloor: new THREE.MeshStandardMaterial({
    map: makeFloorTexture(),
    color: 0x6f5948,
    roughness: 0.82,
    metalness: 0.08,
    side: THREE.DoubleSide,
  }),
  trim: new THREE.MeshStandardMaterial({
    color: 0x2e302b,
    roughness: 0.88,
    metalness: 0.08,
  }),
  secretWall: new THREE.MeshStandardMaterial({
    map: makeSecretWallTexture(),
    color: 0x7d5452,
    roughness: 0.93,
    metalness: 0.04,
    side: THREE.DoubleSide,
  }),
  secretFloor: new THREE.MeshStandardMaterial({
    color: 0x241a1a,
    roughness: 0.95,
    metalness: 0.03,
    side: THREE.DoubleSide,
  }),
  rustDoor: new THREE.MeshStandardMaterial({
    color: 0x7a3b22,
    roughness: 0.96,
    metalness: 0.58,
    emissive: 0x140603,
    emissiveIntensity: 0.18,
  }),
};

function fromBlenderPosition(x, y, z) {
  return new THREE.Vector3(x, z, -y);
}

function applyBlenderTransform(object, transform) {
  const position = new THREE.Vector3(
    transform.location[0],
    transform.location[1],
    transform.location[2],
  );
  const rotation = new THREE.Euler(
    transform.rotation_euler[0],
    transform.rotation_euler[1],
    transform.rotation_euler[2],
    "XYZ",
  );
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  const scale = new THREE.Vector3(
    transform.scale[0],
    transform.scale[1],
    transform.scale[2],
  );

  const source = new THREE.Matrix4().compose(position, quaternion, scale);
  const converted = blenderBasis.clone().multiply(source).multiply(blenderBasisInv);
  converted.decompose(object.position, object.quaternion, object.scale);
}

function getObjectBounds(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  return {
    box,
    size: box.getSize(new THREE.Vector3()),
    center: box.getCenter(new THREE.Vector3()),
  };
}

function fitObjectHeight(object, targetHeight) {
  const { size } = getObjectBounds(object);
  if (size.y <= 0.0001) {
    return;
  }
  const scaleFactor = targetHeight / size.y;
  object.scale.multiplyScalar(scaleFactor);
  object.updateMatrixWorld(true);
}

function centerObjectAtOrigin(object) {
  const { center } = getObjectBounds(object);
  object.position.sub(center);
  object.updateMatrixWorld(true);
}

function placeObjectBaseAtOrigin(object) {
  const { box, center } = getObjectBounds(object);
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
}

function prepareDoorInstance(instance) {
  instance.rotation.y += Math.PI / 2;
  instance.updateMatrixWorld(true);
  fitObjectHeight(instance, 2.25);
  centerObjectAtOrigin(instance);
  instance.updateMatrixWorld(true);
}

function prepareZombieInstance(instance) {
  instance.rotation.y += Math.PI;
  instance.updateMatrixWorld(true);
  fitObjectHeight(instance, 1.42);
  placeObjectBaseAtOrigin(instance);
  instance.updateMatrixWorld(true);
}

function plane(width, height, material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function box(width, height, depth, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function addWallTrim(group, x, zCenter, length, side) {
  const sign = side === "left" ? -1 : 1;
  const baseboard = box(0.08, 0.2, length, materials.trim);
  baseboard.position.set(x - sign * 0.02, 0.1, zCenter);
  group.add(baseboard);

  const midRail = box(0.06, 0.08, length, materials.trim);
  midRail.position.set(x - sign * 0.025, 1.02, zCenter);
  group.add(midRail);
}

function buildCorridor() {
  const group = new THREE.Group();

  const floor = plane(CORRIDOR_WIDTH, CORRIDOR_LENGTH, materials.corridorFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -CORRIDOR_LENGTH * 0.5);
  group.add(floor);

  const ceiling = plane(CORRIDOR_WIDTH, CORRIDOR_LENGTH, materials.corridorCeiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, CORRIDOR_HEIGHT, -CORRIDOR_LENGTH * 0.5);
  group.add(ceiling);

  const leftWall = plane(CORRIDOR_LENGTH, CORRIDOR_HEIGHT, materials.corridorWall);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-CORRIDOR_WIDTH * 0.5, CORRIDOR_HEIGHT * 0.5, -CORRIDOR_LENGTH * 0.5);
  group.add(leftWall);
  addWallTrim(group, -CORRIDOR_WIDTH * 0.5 + 0.01, -CORRIDOR_LENGTH * 0.5, CORRIDOR_LENGTH, "left");

  const openingStart = SECRET_ROOM_CENTER_Y - SECRET_ROOM_OPENING * 0.5;
  const openingEnd = SECRET_ROOM_CENTER_Y + SECRET_ROOM_OPENING * 0.5;
  const frontLen = openingStart;
  const backLen = CORRIDOR_LENGTH - openingEnd;
  const rightX = CORRIDOR_WIDTH * 0.5;

  const rightWallFront = plane(frontLen, CORRIDOR_HEIGHT, materials.corridorWall);
  rightWallFront.rotation.y = -Math.PI / 2;
  rightWallFront.position.set(rightX, CORRIDOR_HEIGHT * 0.5, -frontLen * 0.5);
  group.add(rightWallFront);
  addWallTrim(group, rightX - 0.01, -frontLen * 0.5, frontLen, "right");

  const rightWallBack = plane(backLen, CORRIDOR_HEIGHT, materials.corridorWall);
  rightWallBack.rotation.y = -Math.PI / 2;
  rightWallBack.position.set(rightX, CORRIDOR_HEIGHT * 0.5, -(openingEnd + backLen * 0.5));
  group.add(rightWallBack);
  addWallTrim(group, rightX - 0.01, -(openingEnd + backLen * 0.5), backLen, "right");

  const endWall = plane(CORRIDOR_WIDTH, CORRIDOR_HEIGHT, materials.corridorWall);
  endWall.position.set(0, CORRIDOR_HEIGHT * 0.5, -CORRIDOR_LENGTH);
  group.add(endWall);

  const floorLip = box(CORRIDOR_WIDTH + 0.16, 0.08, 0.12, materials.trim);
  floorLip.position.set(0, 0.04, -CORRIDOR_LENGTH);
  group.add(floorLip);

  scene.add(group);
}

function buildSecretRoom() {
  const group = new THREE.Group();
  const rightStartX = CORRIDOR_WIDTH * 0.5;
  const roomCenterX = rightStartX + SECRET_ROOM_DEPTH * 0.5;
  const roomCenterZ = -SECRET_ROOM_CENTER_Y;

  const floor = plane(SECRET_ROOM_DEPTH, SECRET_ROOM_LENGTH, materials.secretFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(roomCenterX, 0, roomCenterZ);
  group.add(floor);

  const ceiling = plane(SECRET_ROOM_DEPTH, SECRET_ROOM_LENGTH, materials.corridorCeiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(roomCenterX, SECRET_ROOM_HEIGHT, roomCenterZ);
  group.add(ceiling);

  const rightWall = plane(SECRET_ROOM_LENGTH, SECRET_ROOM_HEIGHT, materials.secretWall);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(rightStartX + SECRET_ROOM_DEPTH, SECRET_ROOM_HEIGHT * 0.5, roomCenterZ);
  group.add(rightWall);
  addWallTrim(group, rightStartX + SECRET_ROOM_DEPTH - 0.02, roomCenterZ, SECRET_ROOM_LENGTH, "right");

  const backWall = plane(SECRET_ROOM_DEPTH, SECRET_ROOM_HEIGHT, materials.secretWall);
  backWall.position.set(roomCenterX, SECRET_ROOM_HEIGHT * 0.5, -(SECRET_ROOM_CENTER_Y + SECRET_ROOM_LENGTH * 0.5));
  group.add(backWall);

  const frontWall = plane(SECRET_ROOM_DEPTH, SECRET_ROOM_HEIGHT, materials.secretWall);
  frontWall.rotation.y = Math.PI;
  frontWall.position.set(roomCenterX, SECRET_ROOM_HEIGHT * 0.5, -(SECRET_ROOM_CENTER_Y - SECRET_ROOM_LENGTH * 0.5));
  group.add(frontWall);

  scene.add(group);
}

function createFixture(config, position) {
  const group = new THREE.Group();
  group.position.copy(position);

  const housing = box(0.58, 0.12, 1.55, new THREE.MeshStandardMaterial({
    color: 0x4b4f4e,
    roughness: 0.76,
    metalness: 0.34,
  }));
  housing.position.y = 0;
  group.add(housing);

  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0xb5ced9,
    emissive: 0x83b9da,
    emissiveIntensity: 3.5,
    roughness: 0.15,
    metalness: 0.0,
  });
  const panel = box(0.42, 0.04, 1.22, panelMaterial);
  panel.position.y = -0.07;
  group.add(panel);

  const key = new THREE.SpotLight(0xd8e8f1, 20, 8.5, Math.PI / 4.8, 0.55, 1.6);
  key.position.set(0, -0.1, 0);
  key.target.position.set(0, -3.5, 0);
  key.castShadow = false;
  group.add(key);
  group.add(key.target);

  const fill = new THREE.PointLight(0xa6bdd0, 0.65, 5.5, 2);
  fill.position.set(0, -0.18, 0);
  group.add(fill);

  const state = String(config.state).toUpperCase();
  if (state === "OFF") {
    key.intensity = 0;
    fill.intensity = 0;
    panelMaterial.emissiveIntensity = 0.15;
  }

  ceilingFixtures.push({
    state,
    key,
    fill,
    panelMaterial,
    nextBeat: 0,
    active: true,
  });

  scene.add(group);
}

function buildCeilingLights() {
  const spacing = (CORRIDOR_LENGTH - 5.5) / Math.max(CEILING_LIGHT_CONFIG.length - 1, 1);
  const ceilingY = CORRIDOR_HEIGHT - 0.06;
  CEILING_LIGHT_CONFIG.forEach((config, index) => {
    const blenderPos = fromBlenderPosition(0.0, 2.8 + spacing * index, ceilingY);
    createFixture(config, blenderPos);
  });
}

function drawNeonCables(ctx, width, height, lines) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(205, 187, 160, 0.18)";
  ctx.shadowBlur = 0;

  lines.forEach((_, index) => {
    const anchorX = width * (0.28 + index * 0.22);
    const anchorY = height * (0.32 + index * 0.17);
    const drop = height * (0.18 + index * 0.04);

    ctx.lineWidth = 4 + index;
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.bezierCurveTo(
      anchorX - 12,
      anchorY + drop * 0.18,
      anchorX + 24,
      anchorY + drop * 0.65,
      anchorX + (index % 2 === 0 ? -14 : 18),
      anchorY + drop,
    );
    ctx.stroke();
  });

  ctx.restore();
}

function buildCharMaskLookup(charMask = {}) {
  const lookup = new Map();
  for (const [lineIndex, indices] of Object.entries(charMask)) {
    lookup.set(Number(lineIndex), new Set(indices));
  }
  return lookup;
}

function shouldDrawNeonChar(maskLookup, maskMode, lineIndex, charIndex, char) {
  if (char === " ") {
    return false;
  }

  const masked = maskLookup.get(lineIndex)?.has(charIndex) ?? false;
  if (maskMode === "onlyMasked") {
    return masked;
  }
  if (maskMode === "excludeMasked") {
    return !masked;
  }
  return true;
}

function drawNeonBackdrop(ctx, width, height, lineYs, fontSize, strength = 1) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  lineYs.forEach((y, index) => {
    const bandHeight = fontSize * (0.92 + index * 0.06);
    const bandWidth = width * 0.76;
    const grad = ctx.createRadialGradient(
      width * 0.5,
      y,
      fontSize * 0.18,
      width * 0.5,
      y,
      bandWidth * 0.48,
    );
    grad.addColorStop(0, `rgba(4, 3, 5, ${0.52 * strength})`);
    grad.addColorStop(0.42, `rgba(7, 5, 8, ${0.34 * strength})`);
    grad.addColorStop(1, "rgba(8, 6, 9, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(width * 0.12, y - bandHeight * 0.72, bandWidth, bandHeight * 1.45);
  });

  for (let i = 0; i < 18; i += 1) {
    const dripX = width * (0.18 + Math.random() * 0.64);
    const dripY = height * (0.2 + Math.random() * 0.5);
    const dripLength = fontSize * (0.22 + Math.random() * 0.55);
    const dripWidth = 2 + Math.random() * 4;
    const grad = ctx.createLinearGradient(dripX, dripY, dripX, dripY + dripLength);
    grad.addColorStop(0, `rgba(12, 9, 10, ${0.16 * strength})`);
    grad.addColorStop(1, "rgba(12, 9, 10, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(dripX, dripY, dripWidth, dripLength);
  }

  ctx.restore();
}

function applyNeonWear(ctx, width, height, amount = 0.35) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";

  const scratchCount = Math.floor(10 + amount * 24);
  for (let i = 0; i < scratchCount; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const len = 14 + Math.random() * 80;
    ctx.strokeStyle = `rgba(0, 0, 0, ${0.018 + Math.random() * 0.04})`;
    ctx.lineWidth = 1 + Math.random() * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (-8 + Math.random() * 16));
    ctx.stroke();
  }

  const deadSpotCount = Math.floor(60 + amount * 160);
  for (let i = 0; i < deadSpotCount; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const w = 1 + Math.random() * 10;
    const h = 1 + Math.random() * 4;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.01 + Math.random() * 0.03})`;
    ctx.fillRect(x, y, w, h);
  }

  ctx.restore();
}

function drawNeonCharacter(ctx, character, x, y, fontSize, tubeColor, glowColor, boost = 1) {
  ctx.globalAlpha = 0.36 * boost;
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(4, 3, 5, 0.98)";
  ctx.lineWidth = fontSize * 0.28;
  ctx.strokeText(character, x + fontSize * 0.012, y + fontSize * 0.02);

  ctx.globalAlpha = 0.26 * boost;
  ctx.shadowBlur = 8;
  ctx.shadowColor = "rgba(0, 0, 0, 0.86)";
  ctx.strokeStyle = "rgba(8, 5, 11, 0.94)";
  ctx.lineWidth = fontSize * 0.18;
  ctx.strokeText(character, x, y);

  for (let i = 3; i >= 1; i -= 1) {
    ctx.globalAlpha = 0.022 * boost;
    ctx.shadowBlur = 8 * i;
    ctx.shadowColor = glowColor;
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = fontSize * (0.088 + i * 0.005);
    ctx.strokeText(character, x, y);
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 5;
  ctx.shadowColor = glowColor;
  ctx.strokeStyle = tubeColor;
  ctx.lineWidth = fontSize * 0.082;
  ctx.strokeText(character, x, y);

  ctx.globalAlpha = 0.06 * boost;
  ctx.shadowBlur = 2;
  ctx.shadowColor = "#fff7fe";
  ctx.fillStyle = "#f5eef9";
  ctx.fillText(character, x, y);

  ctx.globalAlpha = 0.52 * boost;
  ctx.shadowBlur = 3;
  ctx.shadowColor = "#f3efff";
  ctx.strokeStyle = "#fff5fb";
  ctx.lineWidth = fontSize * 0.014;
  ctx.strokeText(character, x, y);
}

function drawNeonLine(ctx, text, y, fontSize, tubeColor, glowColor, predicate, letterSpacingScale = 0.035) {
  const characters = [...text.toUpperCase()];
  const letterSpacing = fontSize * letterSpacingScale;
  const widths = characters.map((character) => {
    const measured = character === " "
      ? ctx.measureText("M").width * 0.5
      : ctx.measureText(character).width;
    return measured + letterSpacing;
  });

  const totalWidth = widths.reduce((sum, width) => sum + width, 0) - letterSpacing;
  let cursorX = ctx.canvas.width * 0.5 - totalWidth * 0.5;

  characters.forEach((character, index) => {
    const charWidth = widths[index] - letterSpacing;
    const charCenterX = cursorX + charWidth * 0.5;
    if (predicate(index, character)) {
      drawNeonCharacter(ctx, character, charCenterX, y, fontSize, tubeColor, glowColor);
    }
    cursorX += widths[index];
  });
}

function makeNeonTexture({
  lines,
  tubeColor,
  glowColor,
  charMask,
  maskMode = "all",
  letterSpacingScale = 0.035,
  wear = 0.35,
  backdropStrength = 1,
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = Math.max(520, 280 + lines.length * 220);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const maxLength = Math.max(...lines.map((line) => line.length));
  const fontSize = maxLength > 13 ? 126 : maxLength > 8 ? 144 : 162;
  const lineSpacing = fontSize * 1.02;
  const startY = canvas.height * 0.5 - ((lines.length - 1) * lineSpacing) * 0.5;
  ctx.font = `italic 700 ${fontSize}px 'Bahnschrift SemiCondensed', 'Trebuchet MS', 'Arial Narrow', sans-serif`;

  drawNeonCables(ctx, canvas.width, canvas.height, lines);
  const maskLookup = buildCharMaskLookup(charMask);
  const lineYs = lines.map((_, index) => startY + index * lineSpacing);
  drawNeonBackdrop(ctx, canvas.width, canvas.height, lineYs, fontSize, backdropStrength);

  lines.forEach((line, index) => {
    const y = lineYs[index];
    drawNeonLine(
      ctx,
      line,
      y,
      fontSize,
      tubeColor,
      glowColor,
      (charIndex, character) => shouldDrawNeonChar(maskLookup, maskMode, index, charIndex, character),
      letterSpacingScale,
    );
  });

  applyNeonWear(ctx, canvas.width, canvas.height, wear);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createWallNeon({
  lines,
  tubeColor,
  glowColor,
  position,
  rotationY,
  width,
  height = 0.8,
  lightIntensity = 5.8,
  flicker = null,
  letterSpacingScale = 0.035,
  wear = 0.35,
  backdropStrength = 1,
}) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;

  const cableShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.02, height * 1.02),
    new THREE.MeshBasicMaterial({
      color: 0x140f0b,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  cableShadow.position.z = -0.012;
  group.add(cableShadow);

  const sootPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.08, height * 1.12),
    new THREE.MeshBasicMaterial({
      color: 0x080709,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sootPlate.position.z = -0.006;
  group.add(sootPlate);

  const clipMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b7556,
    roughness: 0.76,
    metalness: 0.38,
  });
  const clipOffsetX = Math.max(0.22, width * 0.24);
  [-clipOffsetX, clipOffsetX].forEach((x) => {
    const clip = box(0.04, 0.05, 0.035, clipMaterial);
    clip.position.set(x, height * 0.35, -0.018);
    group.add(clip);
  });

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: makeNeonTexture({
        lines,
        tubeColor,
        glowColor,
        charMask: flicker?.type === "letters" ? flicker.charMask : undefined,
        maskMode: flicker?.type === "letters" ? "excludeMasked" : "all",
        letterSpacingScale,
        wear,
        backdropStrength,
      }),
      transparent: true,
      color: 0xffffff,
      opacity: 0.98,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.position.z = 0.02;
  group.add(mesh);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.12, height * 1.22),
    new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.045,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  glow.position.z = 0.01;
  group.add(glow);

  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.22, height * 1.32),
    new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.014,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  wash.position.z = 0.0;
  group.add(wash);

  const light = new THREE.PointLight(new THREE.Color(glowColor), lightIntensity, 6.2, 2.0);
  light.position.set(0, 0, 0.24);
  group.add(light);

  let overlayMaterial = null;
  let overlayGlowMaterial = null;
  let overlayWashMaterial = null;
  let overlayLight = null;
  if (flicker?.type === "letters") {
    const overlayMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        map: makeNeonTexture({
          lines,
          tubeColor,
          glowColor,
          charMask: flicker.charMask,
          maskMode: "onlyMasked",
          letterSpacingScale,
          wear,
          backdropStrength: backdropStrength * 0.7,
        }),
        transparent: true,
        color: 0xffffff,
        opacity: 0.96,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    overlayMesh.position.z = 0.035;
    overlayMaterial = overlayMesh.material;
    group.add(overlayMesh);

    const overlayGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.08, height * 1.18),
      new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    overlayGlow.position.z = 0.025;
    overlayGlowMaterial = overlayGlow.material;
    group.add(overlayGlow);

    const overlayWash = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.16, height * 1.24),
      new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.018,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    overlayWash.position.z = 0.018;
    overlayWashMaterial = overlayWash.material;
    group.add(overlayWash);

    overlayLight = new THREE.PointLight(new THREE.Color(glowColor), lightIntensity * 0.24, 4.8, 2.0);
    overlayLight.position.set(0.0, 0.0, 0.18);
    group.add(overlayLight);
  }

  neonSigns.push({
    light,
    meshMaterial: mesh.material,
    glowMaterial: glow.material,
    washMaterial: wash.material,
    baseLightIntensity: lightIntensity,
    baseGlowOpacity: 0.045,
    baseWashOpacity: 0.014,
    baseMeshOpacity: 0.98,
    phase: Math.random() * Math.PI * 2,
    flickerType: flicker?.type ?? "none",
    nextBeat: 0,
    active: true,
    burstRemaining: 0,
    dropoutLevel: 0.18 + Math.random() * 0.16,
    overlayMaterial,
    overlayGlowMaterial,
    overlayWashMaterial,
    overlayLight,
    overlayBaseOpacity: 0.96,
    overlayBaseGlowOpacity: 0.055,
    overlayBaseWashOpacity: 0.018,
    overlayBaseLightIntensity: lightIntensity * 0.24,
    overlayNextBeat: 0,
    overlayActive: true,
    overlayBurstRemaining: 0,
    overlayDropoutLevel: 0.02 + Math.random() * 0.08,
  });

  scene.add(group);
}

function buildNeons() {
  createWallNeon({
    lines: ["Die"],
    tubeColor: "#ff7c90",
    glowColor: "#ff173a",
    position: new THREE.Vector3(-CORRIDOR_WIDTH * 0.5 + 0.028, 1.98, -24.65),
    rotationY: Math.PI / 2,
    width: 1.9,
    height: 0.76,
    lightIntensity: 2.2,
    letterSpacingScale: 0.14,
    wear: 0.5,
    backdropStrength: 1.42,
    flicker: {
      type: "soft",
    },
  });

  createWallNeon({
    lines: ["You will", "last here"],
    tubeColor: "#d5a7ff",
    glowColor: "#8f32ff",
    position: new THREE.Vector3(CORRIDOR_WIDTH * 0.5 - 0.028, 2.18, -24.28),
    rotationY: -Math.PI / 2,
    width: 3.2,
    height: 1.58,
    lightIntensity: 2.7,
    wear: 0.46,
    backdropStrength: 1.34,
    flicker: {
      type: "letters",
      charMask: {
        0: [4],
        1: [6, 8],
      },
    },
  });

  createWallNeon({
    lines: ["The last", "choice"],
    tubeColor: "#9af6ff",
    glowColor: "#12d7ff",
    position: new THREE.Vector3(0.0, 2.46, -27.82),
    rotationY: 0,
    width: 3.2,
    height: 1.48,
    lightIntensity: 2.9,
    wear: 0.48,
    backdropStrength: 1.36,
    flicker: {
      type: "letters",
      charMask: {
        1: [0, 5],
      },
    },
  });
}

function buildSecretStrobes() {
  const green = new THREE.PointLight(0x44ff5f, 8.5, 9.5, 1.8);
  green.position.copy(fromBlenderPosition(CORRIDOR_WIDTH * 0.5 + SECRET_ROOM_DEPTH * 0.52, SECRET_ROOM_CENTER_Y - 0.5, 2.35));
  scene.add(green);

  const red = new THREE.PointLight(0x8b1117, 6.5, 9.5, 1.8);
  red.position.copy(fromBlenderPosition(CORRIDOR_WIDTH * 0.5 + SECRET_ROOM_DEPTH * 0.25, SECRET_ROOM_CENTER_Y + 0.4, 1.95));
  scene.add(red);

  strobeLights.push({ green, red });
}

function buildAtmosphere() {
  const particleGeometry = new THREE.BufferGeometry();
  const particleCount = 240;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    positions[i * 3] = (Math.random() - 0.25) * 7.2;
    positions[i * 3 + 1] = 0.1 + Math.random() * 3.1;
    positions[i * 3 + 2] = -Math.random() * (CORRIDOR_LENGTH + 1.0);
  }
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const particleMaterial = new THREE.PointsMaterial({
    color: 0x9db2ba,
    size: 0.055,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });

  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);
}

async function loadAsset(name, url) {
  if (assetCache.has(name)) {
    return assetCache.get(name);
  }

  let asset;
  try {
    asset = await withTimeout(loader.loadAsync(url), ASSET_LOAD_TIMEOUT_MS, `Asset ${name}`);
  } catch (error) {
    console.warn(`Asset ${name} non caricato, uso fallback procedurale.`, error);
    const fallback = createFallbackAsset(name);
    assetCache.set(name, fallback);
    return fallback;
  }

  asset.scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material = child.material.clone();
        if (child.material.map) {
          child.material.map.colorSpace = THREE.SRGBColorSpace;
        }
        if (child.material.emissiveMap) {
          child.material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        }
        if ("side" in child.material) {
          child.material.side = THREE.DoubleSide;
        }
        child.material.needsUpdate = true;
      }
    }
  });
  const prepared = {
    scene: asset.scene,
    animations: asset.animations ?? [],
  };
  assetCache.set(name, prepared);
  return prepared;
}

function createFallbackAsset(name) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({
    color: 0x111519,
    roughness: 0.72,
    metalness: 0.2,
  });
  const worn = new THREE.MeshStandardMaterial({
    color: 0x343a3f,
    roughness: 0.84,
    metalness: 0.08,
  });
  const red = new THREE.MeshStandardMaterial({
    color: 0x351016,
    roughness: 0.58,
    metalness: 0.12,
    emissive: 0x180306,
    emissiveIntensity: 0.2,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0xff4f6f,
    emissive: 0xff2440,
    emissiveIntensity: 1.3,
    roughness: 0.4,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x7cd2ff,
    transparent: true,
    opacity: 0.42,
    roughness: 0.18,
    metalness: 0.05,
    emissive: 0x123442,
    emissiveIntensity: 0.24,
  });

  const addBox = (material, position, scale) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  if (name === "vending_machine") {
    addBox(red, [0, 1.15, 0], [1.05, 2.3, 0.55]);
    addBox(glass, [-0.16, 1.48, -0.31], [0.62, 1.28, 0.04]);
    addBox(dark, [0.38, 1.45, -0.34], [0.22, 1.25, 0.06]);
    for (let i = 0; i < 3; i += 1) {
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 18), glow);
      button.rotation.x = Math.PI / 2;
      button.position.set(0.38, 1.85 - i * 0.22, -0.39);
      group.add(button);
    }
    const light = new THREE.PointLight(0xff405e, 0.9, 2.4, 2);
    light.position.set(-0.1, 1.6, -0.42);
    group.add(light);
  } else if (name === "wheelchair") {
    addBox(dark, [0, 0.55, 0], [0.72, 0.12, 0.54]);
    addBox(dark, [0, 0.98, 0.26], [0.72, 0.78, 0.08]);
    const wheelGeometry = new THREE.TorusGeometry(0.34, 0.035, 10, 36);
    for (const side of [-0.46, 0.46]) {
      const wheel = new THREE.Mesh(wheelGeometry, worn);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(side, 0.36, 0);
      wheel.castShadow = true;
      group.add(wheel);
    }
  } else if (name === "chair_a" || name === "chair_b") {
    addBox(worn, [0, 0.55, 0], [0.55, 0.1, 0.55]);
    addBox(worn, [0, 1, 0.24], [0.55, 0.72, 0.08]);
    for (const x of [-0.2, 0.2]) {
      for (const z of [-0.2, 0.2]) {
        addBox(dark, [x, 0.26, z], [0.05, 0.52, 0.05]);
      }
    }
  } else if (name === "steel_door") {
    addBox(worn, [0, 1.1, 0], [0.12, 2.2, 1.0]);
    addBox(dark, [0.01, 1.1, -0.42], [0.02, 0.18, 0.08]);
  } else if (name === "zombie") {
    addBox(red, [0, 0.42, 0], [0.32, 0.84, 0.18]);
    addBox(dark, [0, 0.96, 0], [0.22, 0.22, 0.2]);
    addBox(dark, [-0.2, 0.2, 0], [0.08, 0.42, 0.08]);
    addBox(dark, [0.2, 0.2, 0], [0.08, 0.42, 0.08]);
  }

  return {
    scene: group,
    animations: [],
  };
}

async function buildProps() {
  const response = await withTimeout(fetch("../Scene_Exports/scene_entities.json"), SCENE_FETCH_TIMEOUT_MS, "Scene_Exports/scene_entities.json");
  if (!response.ok) {
    throw new Error(`Impossibile leggere scene_entities.json (${response.status}).`);
  }
  sceneData = await response.json();

  const baseAssets = await Promise.all([
    loadAsset("vending_machine", ASSET_PATHS.vending_machine),
    loadAsset("wheelchair", ASSET_PATHS.wheelchair),
    loadAsset("chair_a", ASSET_PATHS.chair_a),
    loadAsset("chair_b", ASSET_PATHS.chair_b),
    loadAsset("steel_door", ASSET_PATHS.steel_door),
    loadAsset("zombie", ASSET_PATHS.zombie),
  ]);

  const assetScenes = {
    vending_machine: baseAssets[0],
    wheelchair: baseAssets[1],
    chair_a: baseAssets[2],
    chair_b: baseAssets[3],
    steel_door: baseAssets[4],
    zombie: baseAssets[5],
  };

  for (const entity of sceneData.entities) {
    let assetKey = null;
    if (entity.asset_type === "vending_machine") {
      assetKey = "vending_machine";
    } else if (entity.asset_type === "wheelchair") {
      assetKey = "wheelchair";
    } else if (entity.asset_type === "chair_instance") {
      assetKey = entity.source_path.includes("chair (1)") ? "chair_b" : "chair_a";
    } else if (entity.asset_type === "procedural_door") {
      assetKey = "steel_door";
    }

    if (!assetKey) {
      continue;
    }

    if (!entity.source_path && assetKey !== "steel_door") {
      continue;
    }

    const instance = assetScenes[assetKey].scene.clone(true);
    if (assetKey === "steel_door") {
      prepareDoorInstance(instance);
      const doorRoot = new THREE.Group();
      const doorPivot = new THREE.Group();
      const { size } = getObjectBounds(instance);
      const primaryAxis = size.z >= size.x ? "z" : "x";
      const hingeOffset = (primaryAxis === "z" ? size.z : size.x) * 0.48;

      if (primaryAxis === "z") {
        instance.position.z -= hingeOffset;
      } else {
        instance.position.x -= hingeOffset;
      }
      instance.updateMatrixWorld(true);

      doorPivot.add(instance);
      doorRoot.add(doorPivot);
      applyBlenderTransform(doorRoot, entity.transform);
      scene.add(doorRoot);

      interactiveDoor = {
        root: doorRoot,
        pivot: doorPivot,
        progress: 0,
        target: 0,
        openAngle: THREE.MathUtils.degToRad(84),
      };
    } else {
      applyBlenderTransform(instance, entity.transform);
      scene.add(instance);
    }
  }

  await buildZombiePresence(assetScenes.zombie);
}

function createZombieCurve() {
  return new THREE.CatmullRomCurve3([
    fromBlenderPosition(CORRIDOR_WIDTH * 0.5 + SECRET_ROOM_DEPTH * 0.72, SECRET_ROOM_CENTER_Y + 1.2, 0.02),
    fromBlenderPosition(CORRIDOR_WIDTH * 0.5 + SECRET_ROOM_DEPTH * 0.44, SECRET_ROOM_CENTER_Y + 0.35, 0.02),
    fromBlenderPosition(CORRIDOR_WIDTH * 0.5 + 0.36, SECRET_ROOM_CENTER_Y + 0.08, 0.02),
    fromBlenderPosition(0.4, SECRET_ROOM_CENTER_Y - 1.55, 0.02),
    fromBlenderPosition(-0.22, SECRET_ROOM_CENTER_Y + 1.1, 0.02),
  ], false, "centripetal", 0.45);
}

async function loadZombieMaterialTemplate() {
  if (zombieMaterialTemplate) {
    return zombieMaterialTemplate;
  }

  try {
    const [diffuse, normal] = await Promise.all([
      withTimeout(textureLoader.loadAsync("../animated_injured_zombie_crawling_loop/textures/ZombieGirl_Material_diffuse.png"), TEXTURE_LOAD_TIMEOUT_MS, "Texture zombie diffuse"),
      withTimeout(textureLoader.loadAsync("../animated_injured_zombie_crawling_loop/textures/ZombieGirl_Material_normal.png"), TEXTURE_LOAD_TIMEOUT_MS, "Texture zombie normal"),
    ]);

    diffuse.colorSpace = THREE.SRGBColorSpace;
    diffuse.flipY = false;
    diffuse.needsUpdate = true;
    normal.flipY = false;
    normal.needsUpdate = true;

    zombieMaterialTemplate = new THREE.MeshStandardMaterial({
      map: diffuse,
      normalMap: normal,
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.02,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
    });
  } catch (error) {
    console.warn("Texture zombie non caricate, uso materiale procedurale.", error);
    zombieMaterialTemplate = new THREE.MeshStandardMaterial({
      color: 0x4b161b,
      emissive: 0x120305,
      emissiveIntensity: 0.18,
      roughness: 0.92,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
  }
  zombieMaterialTemplate.needsUpdate = true;
  return zombieMaterialTemplate;
}

async function applyZombieFallbackMaterials(root) {
  const template = await loadZombieMaterialTemplate();
  root.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    const material = template.clone();
    if ("skinning" in material) {
      material.skinning = Boolean(child.isSkinnedMesh);
    }
    material.needsUpdate = true;
    child.material = material;
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

async function buildZombiePresence(zombieAsset) {
  if (!zombieAsset?.scene) {
    return;
  }

  const actorRoot = new THREE.Group();
  const zombie = cloneSkinned(zombieAsset.scene);
  await applyZombieFallbackMaterials(zombie);
  prepareZombieInstance(zombie);
  actorRoot.add(zombie);
  actorRoot.position.copy(fromBlenderPosition(CORRIDOR_WIDTH * 0.5 + SECRET_ROOM_DEPTH * 0.7, SECRET_ROOM_CENTER_Y + 1.0, 0.02));
  scene.add(actorRoot);

  if (zombieAsset.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(zombie);
    const action = mixer.clipAction(zombieAsset.animations[0]);
    action.play();
    action.timeScale = 0.82;
    animationMixers.push(mixer);
  }

  zombieActors.push({
    root: actorRoot,
    curve: createZombieCurve(),
    speed: 0.038,
    offset: 0.12,
    headingOffset: Math.PI,
    bobPhase: Math.random() * Math.PI * 2,
  });
}

function buildReferenceMood() {
  const wetPatch = plane(CORRIDOR_WIDTH * 0.86, 8.4, new THREE.MeshBasicMaterial({
    color: 0x161718,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
  }));
  wetPatch.rotation.x = -Math.PI / 2;
  wetPatch.position.set(0.05, 0.011, -13.8);
  scene.add(wetPatch);

  const wallSplotchMaterial = new THREE.MeshBasicMaterial({
    color: 0x121110,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
  });

  for (let i = 0; i < 7; i += 1) {
    const splotch = plane(0.65 + Math.random() * 0.5, 0.5 + Math.random() * 0.5, wallSplotchMaterial);
    splotch.position.set(
      CORRIDOR_WIDTH * 0.5 - 0.01,
      2.0 + Math.random() * 0.8,
      -(3.5 + i * 3.1 + Math.random()),
    );
    splotch.rotation.y = -Math.PI / 2;
    scene.add(splotch);
  }
}

function updateLights(elapsed) {
  for (const fixture of ceilingFixtures) {
    if (fixture.state === "OFF") {
      continue;
    }
    if (fixture.state === "ON") {
      fixture.key.intensity = 16;
      fixture.fill.intensity = 0.55;
      fixture.panelMaterial.emissiveIntensity = 3.5;
      continue;
    }

    if (elapsed >= fixture.nextBeat) {
      fixture.active = !fixture.active;
      fixture.nextBeat = elapsed + (fixture.active ? 0.05 + Math.random() * 0.35 : 0.04 + Math.random() * 0.12);
      if (fixture.active) {
        fixture.key.intensity = 8 + Math.random() * 16;
        fixture.fill.intensity = 0.2 + Math.random() * 0.6;
        fixture.panelMaterial.emissiveIntensity = 1.5 + Math.random() * 3.5;
      } else {
        fixture.key.intensity = Math.random() > 0.74 ? 2 : 0;
        fixture.fill.intensity = 0.0;
        fixture.panelMaterial.emissiveIntensity = 0.1 + Math.random() * 0.3;
      }
    }
  }

  for (const pair of strobeLights) {
    const phase = Math.floor(elapsed * 7.2) % 2 === 0;
    pair.green.intensity = phase ? 9.5 : 0.3;
    pair.red.intensity = phase ? 0.35 : 7.8;
  }

  for (const sign of neonSigns) {
    const hum = 0.98
      + Math.sin(elapsed * 1.35 + sign.phase) * 0.035
      + Math.sin(elapsed * 7.9 + sign.phase * 1.7) * 0.02
      + Math.sin(elapsed * 16.4 + sign.phase * 0.6) * 0.01;
    let masterFactor = hum;

    if (sign.flickerType === "soft") {
      if (elapsed >= sign.nextBeat) {
        if (sign.burstRemaining > 0) {
          sign.active = !sign.active;
          sign.burstRemaining -= 1;
          sign.nextBeat = elapsed + (sign.active ? 0.025 + Math.random() * 0.08 : 0.015 + Math.random() * 0.045);
          if (sign.burstRemaining <= 0) {
            sign.active = true;
            sign.nextBeat = elapsed + 0.55 + Math.random() * 1.8;
          }
        } else if (Math.random() < 0.34) {
          sign.burstRemaining = 2 + Math.floor(Math.random() * 5);
          sign.active = false;
          sign.dropoutLevel = 0.08 + Math.random() * 0.14;
          sign.nextBeat = elapsed + 0.014 + Math.random() * 0.04;
        } else {
          sign.active = true;
          sign.nextBeat = elapsed + 0.42 + Math.random() * 2.6;
        }
      }
      masterFactor *= sign.active ? 1 : sign.dropoutLevel;
    }

    sign.meshMaterial.opacity = sign.baseMeshOpacity * masterFactor;
    sign.glowMaterial.opacity = sign.baseGlowOpacity * masterFactor;
    sign.washMaterial.opacity = sign.baseWashOpacity * masterFactor;
    sign.light.intensity = sign.baseLightIntensity * masterFactor;

    if (sign.flickerType === "letters" && sign.overlayMaterial && sign.overlayGlowMaterial && sign.overlayWashMaterial && sign.overlayLight) {
      if (elapsed >= sign.overlayNextBeat) {
        if (sign.overlayBurstRemaining > 0) {
          sign.overlayActive = !sign.overlayActive;
          sign.overlayBurstRemaining -= 1;
          sign.overlayNextBeat = elapsed + (sign.overlayActive ? 0.024 + Math.random() * 0.08 : 0.012 + Math.random() * 0.045);
          if (sign.overlayBurstRemaining <= 0) {
            sign.overlayActive = true;
            sign.overlayNextBeat = elapsed + 0.35 + Math.random() * 1.9;
          }
        } else if (Math.random() < 0.38) {
          sign.overlayBurstRemaining = 2 + Math.floor(Math.random() * 6);
          sign.overlayActive = false;
          sign.overlayDropoutLevel = 0.0 + Math.random() * 0.08;
          sign.overlayNextBeat = elapsed + 0.012 + Math.random() * 0.05;
        } else {
          sign.overlayActive = true;
          sign.overlayNextBeat = elapsed + 0.28 + Math.random() * 1.45;
        }
      }

      const overlayHum = 0.98
        + Math.sin(elapsed * 2.05 + sign.phase) * 0.05
        + Math.sin(elapsed * 14.0 + sign.phase * 1.3) * 0.025;
      const overlayFactor = sign.overlayActive ? overlayHum : sign.overlayDropoutLevel;
      sign.overlayMaterial.opacity = sign.overlayBaseOpacity * overlayFactor;
      sign.overlayGlowMaterial.opacity = sign.overlayBaseGlowOpacity * overlayFactor;
      sign.overlayWashMaterial.opacity = sign.overlayBaseWashOpacity * overlayFactor;
      sign.overlayLight.intensity = sign.overlayBaseLightIntensity * overlayFactor;
    }
  }

  for (const pulse of pointAtmospherics) {
    pulse.light.intensity = 4.8 + Math.sin(elapsed * 2.4 + pulse.phase) * pulse.amp;
  }
}

function updateDoor(delta) {
  if (!interactiveDoor) {
    return;
  }

  const inDoorBand = Math.abs(camera.position.z + SECRET_ROOM_CENTER_Y) < 1.18;
  const pushingFromCorridor = inDoorBand && camera.position.x > CORRIDOR_WIDTH * 0.5 - 0.34 && camera.position.x < CORRIDOR_WIDTH * 0.5 + 0.24;
  const pushingFromRoom = inDoorBand && camera.position.x >= CORRIDOR_WIDTH * 0.5 + 0.24 && camera.position.x < CORRIDOR_WIDTH * 0.5 + 1.55;
  interactiveDoor.target = pushingFromCorridor || pushingFromRoom ? 1 : 0;

  const sideSign = camera.position.x <= interactiveDoor.root.position.x ? -1 : 1;
  const easing = interactiveDoor.target > interactiveDoor.progress ? 8.5 : 5.0;
  interactiveDoor.progress = THREE.MathUtils.damp(interactiveDoor.progress, interactiveDoor.target, easing, delta);
  interactiveDoor.pivot.rotation.y = sideSign * interactiveDoor.openAngle * interactiveDoor.progress;
}

function updateZombies(delta, elapsed) {
  for (const mixer of animationMixers) {
    mixer.update(delta);
  }

  for (const actor of zombieActors) {
    const loopValue = ((elapsed * actor.speed) + actor.offset) % 2;
    const pathT = loopValue <= 1 ? loopValue : 2 - loopValue;
    const current = actor.curve.getPointAt(THREE.MathUtils.clamp(pathT, 0.001, 0.999));
    const lookAheadT = Math.min(0.999, pathT + 0.02);
    const next = actor.curve.getPointAt(lookAheadT);
    actor.root.position.copy(current);
    actor.root.position.y = current.y + Math.sin(elapsed * 5.5 + actor.bobPhase) * 0.025;
    actor.root.lookAt(next.x, actor.root.position.y, next.z);
    actor.root.rotateY(actor.headingOffset);
  }
}

function updateMovement(delta) {
  if (!controls.isLocked) {
    return;
  }

  previousPosition.copy(camera.position);

  const speed = movement.sprint ? 4.9 : 2.7;
  velocity.x -= velocity.x * 8.0 * delta;
  velocity.z -= velocity.z * 8.0 * delta;

  const direction = new THREE.Vector3(
    Number(movement.right) - Number(movement.left),
    0,
    Number(movement.backward) - Number(movement.forward),
  );

  if (direction.lengthSq() > 0) {
    direction.normalize();
    velocity.x += direction.x * speed * delta * 12;
    velocity.z += direction.z * speed * delta * 12;
  }

  controls.moveRight(velocity.x * delta);
  controls.moveForward(-velocity.z * delta);

  camera.position.y = 1.62;
  if (!isInsidePlayableArea(camera.position.x, camera.position.z)) {
    camera.position.copy(previousPosition);
  }
}

function isInsidePlayableArea(x, z) {
  const corridor = (
    x > -CORRIDOR_WIDTH * 0.5 + 0.16 &&
    x < CORRIDOR_WIDTH * 0.5 - 0.16 &&
    z < 0.15 &&
    z > -(CORRIDOR_LENGTH - 0.25)
  );

  const doorway = (
    x > CORRIDOR_WIDTH * 0.5 - 0.14 &&
    x < CORRIDOR_WIDTH * 0.5 + 0.48 &&
    z < -(SECRET_ROOM_CENTER_Y - SECRET_ROOM_OPENING * 0.9) &&
    z > -(SECRET_ROOM_CENTER_Y + SECRET_ROOM_OPENING * 0.9)
  );

  const secretRoom = (
    x > CORRIDOR_WIDTH * 0.5 + 0.06 &&
    x < CORRIDOR_WIDTH * 0.5 + SECRET_ROOM_DEPTH - 0.16 &&
    z < -(SECRET_ROOM_CENTER_Y - SECRET_ROOM_LENGTH * 0.5) + 0.18 &&
    z > -(SECRET_ROOM_CENTER_Y + SECRET_ROOM_LENGTH * 0.5) - 0.18
  );

  return corridor || doorway || secretRoom;
}

function onKey(event, pressed) {
  if (pressed && event.repeat) {
    return;
  }

  switch (event.code) {
    case "KeyW":
      movement.forward = pressed;
      break;
    case "KeyS":
      movement.backward = pressed;
      break;
    case "KeyA":
      movement.left = pressed;
      break;
    case "KeyD":
      movement.right = pressed;
      break;
    case "ShiftLeft":
    case "ShiftRight":
      movement.sprint = pressed;
      break;
    case "KeyF":
      if (pressed) {
        flashlightEnabled = !flashlightEnabled;
        flashlight.visible = flashlightEnabled;
      }
      break;
    case "KeyM":
      if (pressed) {
        toggleMusic();
      }
      break;
    default:
      break;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.033);
  const elapsed = clock.elapsedTime;
  updateLights(elapsed);
  updateDoor(delta);
  updateZombies(delta, elapsed);
  updateMovement(delta);
  composer.render();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

async function bootstrapScene() {
  setStatus("Costruzione della scena realtime...");
  buildCorridor();
  buildSecretRoom();
  buildCeilingLights();
  buildNeons();
  buildSecretStrobes();
  buildAtmosphere();
  buildReferenceMood();

  setStatus("Caricamento modelli 3D e texture. Su Render puo richiedere un po...");
  await buildProps();

  ready = true;
  setStatus("Scena pronta. Premi Entra per iniziare.");
}

function ensureSceneReady() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapScene();
  }
  return bootstrapPromise;
}

function startAnimationLoop() {
  if (animationStarted) {
    return;
  }

  animationStarted = true;
  animate();
}

async function startExperience() {
  if (ready) {
    ensureMusicStarted();
    hideOverlay();
    controls.lock();
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = "Caricamento...";
  try {
    ensureMusicStarted();
    await ensureSceneReady();
    startAnimationLoop();
    hideOverlay();
    controls.lock();
  } catch (error) {
    console.error(error);
    showError(`Il viewer realtime non e riuscito a inizializzare la scena: ${error.message || error}.`);
    startBtn.disabled = false;
    startBtn.textContent = "Riprova";
  }
}

startBtn.addEventListener("click", startExperience);
homeBtn.addEventListener("click", () => {
  if (ready) {
    showOverlay("Premi Entra per tornare nel corridoio.");
  } else {
    showOverlay("In attesa del caricamento della scena...");
  }
});
renderer.domElement.addEventListener("click", () => {
  if (ready && overlayEl.style.display === "none" && !controls.isLocked) {
    controls.lock();
  }
});

controls.addEventListener("lock", () => {
  setStatus("Pointer lock attivo. Usa WASD per muoverti.");
});

controls.addEventListener("unlock", () => {
  if (overlayEl.style.display === "grid") {
    setStatus(ready ? "Premi Entra per tornare nel corridoio." : "In attesa del caricamento della scena...");
    return;
  }
  setStatus("Pointer lock disattivato. Fai click nella scena per riprendere.");
});

window.addEventListener("resize", onResize);
window.addEventListener("keydown", (event) => onKey(event, true));
window.addEventListener("keyup", (event) => onKey(event, false));

onResize();
flashlight.visible = flashlightEnabled;
syncMusicButton();

startBtn.disabled = true;
startBtn.textContent = "Caricamento...";
ensureSceneReady()
  .then(() => {
    startAnimationLoop();
    startBtn.disabled = false;
    startBtn.textContent = "Entra";
  })
  .catch((error) => {
    console.error(error);
    showError(`Il viewer realtime non e riuscito a inizializzare la scena: ${error.message || error}.`);
    startBtn.disabled = false;
    startBtn.textContent = "Riprova";
  });


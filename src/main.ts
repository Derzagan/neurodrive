import "./style.css";
import { AdaptiveAI } from "./ai/adaptive";
import { GESTURE_HINT, GESTURE_LABEL, GestureEngine, type Gesture } from "./gestures/recognizer";
import { Renderer } from "./game/renderer3d";
import { MAX_SPEED, World } from "./game/world";

const canvas = document.querySelector<HTMLCanvasElement>("#race")!;
const video = document.querySelector<HTMLVideoElement>("#webcam")!;
const hands = document.querySelector<HTMLCanvasElement>("#hands")!;
const hctx = hands.getContext("2d")!;
const menu = document.querySelector<HTMLElement>("#menu")!;
const results = document.querySelector<HTMLElement>("#results")!;
const camStatus = document.querySelector<HTMLElement>("#cam-status")!;
const app = document.querySelector<HTMLElement>("#app")!;

const world = new World();
const renderer = new Renderer(canvas);
const ai = new AdaptiveAI();
const gestures = new GestureEngine();

const keys = new Set<string>();
let running = false;
let last = performance.now();
let cameraOn = false;
let steerSmoothed = 0;
let lastGestureCheck = 0;
let activeGesture: Gesture = "none";

const hud = {
  speed: document.querySelector("#speed-value")!,
  speedBar: document.querySelector<HTMLElement>("#speed-bar")!,
  distance: document.querySelector("#distance-value")!,
  score: document.querySelector("#score-value")!,
  nitro: document.querySelector<HTMLElement>("#nitro-bar")!,
  gesture: document.querySelector("#gesture-name")!,
  hint: document.querySelector("#gesture-hint")!,
  style: document.querySelector("#drive-style")!,
  rivals: document.querySelector("#rival-level")!,
  obstacles: document.querySelector("#obstacle-level")!,
  track: document.querySelector("#track-level")!,
  chip: document.querySelector("#ai-chip-text")!,
};

addEventListener("resize", () => renderer.resize());
renderer.resize();

function onKey(e: KeyboardEvent, down: boolean) {
  const k = e.key.toLowerCase();
  if (down) keys.add(k);
  else keys.delete(k);
}
window.addEventListener("keydown", (e) => onKey(e, true));
window.addEventListener("keyup", (e) => onKey(e, false));

document.querySelector("#start-btn")!.addEventListener("click", startRace);
document.querySelector("#again-btn")!.addEventListener("click", startRace);
document.querySelector("#camera-btn")!.addEventListener("click", enableCamera);

function startRace() {
  world.reset();
  ai.reset();
  running = true;
  app.classList.add("race-active");
  menu.classList.add("hidden");
  results.classList.add("hidden");
}

async function enableCamera() {
  if (cameraOn) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 480 },
        height: { ideal: 360 },
        frameRate: { ideal: 24, max: 24 },
        facingMode: "user",
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    hands.width = video.videoWidth || 640;
    hands.height = video.videoHeight || 480;
    camStatus.textContent = "Загрузка модели руки…";
    await gestures.init();
    cameraOn = true;
    app.classList.add("camera-on");
    camStatus.textContent = "Камера готова. Покажите жест, затем нажмите «Запустить гонку».";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "неизвестная ошибка";
    camStatus.textContent = `Не удалось включить камеру: ${reason}. Можно играть с клавиатуры.`;
  }
}

function inputFrom(gesture: Gesture, dt: number) {
  let steer = 0;
  let throttle = 0;
  let brake = 0;
  let nitro = false;

  if (keys.has("arrowleft") || keys.has("a")) steer -= 1;
  if (keys.has("arrowright") || keys.has("d")) steer += 1;
  if (keys.has("w") || keys.has("arrowup")) throttle = 1;
  if (keys.has("s") || keys.has("arrowdown")) brake = 1;
  if (keys.has("shift")) nitro = true;

  if (gesture === "left") steer -= 1;
  if (gesture === "right") steer += 1;
  if (gesture === "throttle") throttle = 1;
  if (gesture === "brake") brake = 1;
  if (gesture === "nitro") {
    nitro = true;
    throttle = 1;
  }

  const steeringResponse = 1 - Math.exp(-dt / 0.12);
  steerSmoothed += (Math.max(-1, Math.min(1, steer)) - steerSmoothed) * steeringResponse;
  return { steer: steerSmoothed, throttle, brake, nitro };
}

function drawHandOverlay() {
  if (!gestures.landmarks.length) {
    hctx.clearRect(0, 0, hands.width, hands.height);
    return;
  }

  const w = Math.max(120, hands.width || 120);
  const h = Math.max(90, hands.height || 90);
  hctx.clearRect(0, 0, w, h);
  hctx.strokeStyle = "rgba(77,240,255,0.8)";
  hctx.fillStyle = "rgba(255,77,206,0.8)";
  hctx.lineWidth = 1.2;

  const map = (i: number) => ({
    x: gestures.landmarks[i].x * w,
    y: gestures.landmarks[i].y * h,
  });

  const pairs: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20]];

  hctx.beginPath();
  for (const [a, b] of pairs) {
    const pa = map(a);
    const pb = map(b);
    hctx.moveTo(pa.x, pa.y);
    hctx.lineTo(pb.x, pb.y);
  }
  hctx.stroke();

  for (let i = 0; i < 21; i++) {
    const p = map(i);
    hctx.beginPath();
    hctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
    hctx.fill();
  }
}

function loop(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  if (cameraOn && now - lastGestureCheck > 100) {
    lastGestureCheck = now;
    activeGesture = gestures.detect(video);
    if (activeGesture !== "none") drawHandOverlay();
    else hctx.clearRect(0, 0, hands.width, hands.height);
  }

  const input = inputFrom(activeGesture, dt);
  if (running) {
    const beforeHits = world.hits;
    world.step(dt, input, ai.snapshot());
    const crashed = world.hits > beforeHits;
    ai.observe({
      speed: world.player.speed,
      maxSpeed: MAX_SPEED,
      steer: input.steer,
      crashed,
      nitro: world.usingNitro,
      dt,
    });
    if (world.finished) {
      running = false;
      showResults();
    }
  }

  if (!running) world.player.z += 420 * dt;

  renderer.draw(world, activeGesture);
  paintHud(activeGesture);

  requestAnimationFrame(loop);
}

function paintHud(gesture: Gesture) {
  const adapt = ai.snapshot();
  hud.speed.textContent = Math.round(world.player.speed).toString().padStart(3, "0");
  hud.speedBar.style.width = `${(world.player.speed / MAX_SPEED) * 100}%`;
  hud.distance.textContent = `${world.distance.toFixed(2)} км`;
  hud.score.textContent = Math.floor(world.distance * 1000).toLocaleString("ru-RU");
  hud.nitro.style.width = `${world.nitro * 100}%`;
  hud.gesture.textContent = GESTURE_LABEL[gesture];
  hud.hint.textContent = GESTURE_HINT[gesture];
  hud.style.textContent = adapt.style;
  hud.rivals.textContent = adapt.labels.rivals;
  hud.obstacles.textContent = adapt.labels.obstacles;
  hud.track.textContent = adapt.labels.track;
  hud.chip.textContent = `ИИ · стиль: ${adapt.style}`;
}

function showResults() {
  results.classList.remove("hidden");
  app.classList.remove("race-active");
  const adapt = ai.snapshot();
  document.querySelector("#result-title")!.textContent = "Анализ заезда";
  document.querySelector("#result-text")!.textContent =
    `Очки за дистанцию: ${Math.floor(world.distance * 1000).toLocaleString("ru-RU")}. ` +
    `Стиль «${adapt.style}». Столкновений: ${world.hits}. ИИ выставил соперников на «${adapt.labels.rivals}», ` +
    `препятствия на «${adapt.labels.obstacles}», трассу на «${adapt.labels.track}».`;
}

requestAnimationFrame(loop);

import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export type Gesture =
  | "none"
  | "throttle"
  | "brake"
  | "left"
  | "right"
  | "nitro";

export const GESTURE_LABEL: Record<Gesture, string> = {
  none: "нет руки",
  throttle: "газ",
  brake: "тормоз",
  left: "влево",
  right: "вправо",
  nitro: "нитро",
};

export const GESTURE_HINT: Record<Gesture, string> = {
  none: "Покажите ладонь камере",
  throttle: "Открытая ладонь — ускорение",
  brake: "Кулак — замедление",
  left: "Наклоните или сдвиньте ладонь влево",
  right: "Наклоните или сдвиньте ладонь вправо",
  nitro: "Виктория — форсаж",
};

export class GestureEngine {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private lastDetectAt = 0;
  private candidateGesture: Gesture = "none";
  private candidateFrames = 0;
  gesture: Gesture = "none";
  ready = false;
  landmarks: NormalizedLandmark[] = [];

  async init() {
    const files = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm",
    );
    this.landmarker = await HandLandmarker.createFromOptions(files, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      },
      runningMode: "VIDEO",
      numHands: 1,
    });
    this.ready = true;
  }

  detect(video: HTMLVideoElement) {
    if (!this.landmarker || video.readyState < 2) {
      this.gesture = "none";
      this.landmarks = [];
      return this.gesture;
    }

    const now = performance.now();
    if (now - this.lastDetectAt < 110) return this.gesture;
    this.lastDetectAt = now;

    if (video.currentTime === this.lastVideoTime) return this.gesture;
    this.lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, now);
    const hand = result.landmarks[0];
    if (!hand) {
      this.gesture = "none";
      this.candidateGesture = "none";
      this.candidateFrames = 0;
      this.landmarks = [];
      return this.gesture;
    }
    this.landmarks = hand;
    const detected = classify(hand);
    if (detected === this.candidateGesture) this.candidateFrames += 1;
    else {
      this.candidateGesture = detected;
      this.candidateFrames = 1;
    }
    const requiredFrames = detected === "left" || detected === "right" ? 2 : 1;
    if (this.candidateFrames >= requiredFrames) this.gesture = detected;
    return this.gesture;
  }
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function extended(hand: NormalizedLandmark[], tip: number, pip: number, mcp: number) {
  return dist(hand[tip], hand[mcp]) > dist(hand[pip], hand[mcp]) * 1.15;
}

function classify(hand: NormalizedLandmark[]): Gesture {
  const fingers = [
    extended(hand, 8, 6, 5),
    extended(hand, 12, 10, 9),
    extended(hand, 16, 14, 13),
    extended(hand, 20, 18, 17),
  ];
  const thumbOut = dist(hand[4], hand[17]) > dist(hand[2], hand[17]) * 1.05;
  const openCount = fingers.filter(Boolean).length + (thumbOut ? 1 : 0);
  const palmAxisX = hand[9].x - hand[0].x;
  const palmAxisY = Math.abs(hand[0].y - hand[9].y);
  const wristTilt = Math.atan2(palmAxisX, Math.max(0.001, palmAxisY));
  const palmCenterX = (hand[0].x + hand[9].x) / 2;

  if (fingers[0] && fingers[1] && !fingers[2] && !fingers[3]) return "nitro";
  if (openCount <= 1) return "brake";
  if (openCount >= 3 && (wristTilt < -0.2 || palmCenterX < 0.37)) return "right";
  if (openCount >= 3 && (wristTilt > 0.2 || palmCenterX > 0.63)) return "left";
  if (openCount >= 4) return "throttle";
  return "throttle";
}

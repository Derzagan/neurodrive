import type { Adaptation } from "../ai/adaptive";
import type { Car, Obstacle, Segment } from "./types";

export const MAX_SPEED = 320;
const SEGMENTS = 900;
const SEGMENT_LENGTH = 120;

export class World {
  player: Car = {
    x: 0,
    z: 0,
    speed: 0,
    color: "#4df0ff",
    accent: "#ff4dce",
    width: 0.18,
  };
  roadLimit = 1.7;
  playerRoadLimit = 1.7;
  rivals: Car[] = [];
  obstacles: Obstacle[] = [];
  segments: Segment[] = [];
  nitro = 1;
  usingNitro = false;
  distance = 0;
  hits = 0;
  finished = false;
  raceTime = 0;
  crashFlash = 0;
  private steeringVelocity = 0;
  shake = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.player.x = 0;
    this.player.z = 0;
    this.player.speed = 0;
    this.roadLimit = 1.7;
    this.playerRoadLimit = 1.7;
    this.nitro = 1;
    this.usingNitro = false;
    this.distance = 0;
    this.hits = 0;
    this.finished = false;
    this.raceTime = 0;
    this.crashFlash = 0;
    this.steeringVelocity = 0;
    this.shake = 0;
    const rawSegments = Array.from({ length: SEGMENTS }, (_, i) => {
      const wave = Math.sin(i * 0.012) * 2.4 + Math.sin(i * 0.00467) * 1.6;
      return { curve: wave, light: i % 16 < 8 ? 1 : 0 };
    });
    const curveMean = rawSegments.reduce((sum, segment) => sum + segment.curve, 0) / SEGMENTS;
    let heading = 0;
    const headings = rawSegments.map((segment) => {
      heading += (segment.curve - curveMean) * 0.22;
      return heading;
    });
    const headingMean = headings.reduce((sum, value) => sum + value, 0) / SEGMENTS;
    let offset = 0;
    this.segments = rawSegments.map((segment, i) => {
      const current = { ...segment, curve: segment.curve - curveMean, offset };
      offset += headings[i] - headingMean;
      return current;
    });
    this.rivals = [
      { x: -0.35, z: 220, speed: 168, color: "#ff5d8f", accent: "#ffd166", width: 0.22 },
      { x: 0.28, z: 480, speed: 176, color: "#7dffb3", accent: "#4df0ff", width: 0.22 },
      { x: 0.02, z: 760, speed: 184, color: "#c084fc", accent: "#fff", width: 0.22 },
    ];
    this.obstacles = [];
    const lanePattern = [-0.9, -0.38, 0.2, 0.88];
    for (let i = 0; i < 9; i++) {
      const lane = lanePattern[(i + Math.floor(Math.random() * lanePattern.length)) % lanePattern.length];
      const jitter = (Math.random() - 0.5) * 0.18;
      this.obstacles.push({
        x: clamp(lane + jitter, -0.92, 0.92),
        z: i * 1500 + 1400,
        kind:
          i % 7 === 0
            ? "stop"
            : i % 7 === 1 || i % 7 === 4
              ? "pedestrian"
              : i % 7 === 2
                ? "drone"
                : i % 7 === 3
                  ? "barrier"
                  : "cone",
      });
    }
  }

  step(
    dt: number,
    input: { steer: number; throttle: number; brake: number; nitro: boolean },
    ai: Adaptation,
  ) {
    if (this.finished) return;
    this.raceTime += dt;
    this.crashFlash = Math.max(0, this.crashFlash - dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);

    const accel = 78 * input.throttle - 110 * input.brake - this.player.speed * 0.18;
    this.usingNitro = input.nitro && this.nitro > 0.05;
    if (this.usingNitro) {
      this.player.speed += 90 * dt;
      this.nitro = Math.max(0, this.nitro - 0.22 * dt);
    } else {
      this.nitro = Math.min(1, this.nitro + 0.07 * dt);
    }

    this.player.speed = clamp(this.player.speed + accel * dt, 0, MAX_SPEED);
    const dz = this.player.speed * 5.4 * dt;
    this.player.z += dz;
    this.distance += dz * 0.00012;

    const curve = this.curveAt(this.player.z) * ai.curveScale;
    const steeringAcceleration = input.steer * (3.4 + this.player.speed / 150);
    this.steeringVelocity += steeringAcceleration * dt;
    this.steeringVelocity *= Math.exp(-5.5 * dt);
    this.player.x += this.steeringVelocity * dt;
    this.player.x -= curve * this.player.speed * 0.00018 * dt;
    const limit = this.roadLimit * (ai.roadWidth / 1.3);
    this.playerRoadLimit = limit;
    if (Math.abs(this.player.x) > limit) {
      this.player.x = clamp(this.player.x, -limit, limit);
      this.steeringVelocity = 0;
    }

    for (const car of this.rivals) {
      car.speed = 150 + 48 * ai.rivalSpeed + Math.sin(this.raceTime + car.z) * 8;
      car.z += car.speed * 5.1 * dt;
      car.x += Math.sin(car.z * 0.0007) * 0.0018;
      car.x = clamp(car.x, -0.7, 0.7);
      if (car.z < this.player.z - 800 || car.z > this.player.z + 3000) {
        car.z = this.player.z + 220 + Math.random() * 1100;
        const lanes = [-0.62, -0.3, 0.3, 0.62];
        car.x = lanes[Math.floor(Math.random() * lanes.length)];
      }
    }

    const spawnBoost = ai.obstacleRate;
    const lanePattern = [-0.92, -0.38, 0.2, 0.9];
    for (const ob of this.obstacles) {
      if (ob.z < this.player.z - 300) {
        const lane = lanePattern[Math.floor(Math.random() * lanePattern.length)];
        const jitter = (Math.random() - 0.5) * 0.2;
        ob.z = this.player.z + 4200 + Math.random() * 2400 * (2.2 - spawnBoost);
        ob.x = clamp((lane + jitter) * (0.95 + ai.roadWidth * 0.22), -1.02, 1.02);
      }
    }

    this.collide();
    if (this.distance > 4.8) this.finished = true;
  }

  curveAt(z: number) {
    const position = z / SEGMENT_LENGTH;
    const index = Math.floor(position);
    const fraction = position - index;
    const length = this.segments.length;
    const current = this.segments[((index % length) + length) % length];
    const next = this.segments[((index + 1) % length + length) % length];
    return current.curve + (next.curve - current.curve) * fraction;
  }

  routeOffsetAt(z: number) {
    const position = z / SEGMENT_LENGTH;
    const index = Math.floor(position);
    const fraction = position - index;
    const length = this.segments.length;
    const current = this.segments[((index % length) + length) % length];
    const next = this.segments[((index + 1) % length + length) % length];
    return current.offset + (next.offset - current.offset) * fraction;
  }

  private collide() {
    const hit = (x: number, z: number, w: number) =>
      Math.abs(z - this.player.z) < 65 && Math.abs(x - this.player.x) < this.player.width * 0.45 + w * 0.7;

    for (const car of this.rivals) {
      if (hit(car.x, car.z, 0.12)) this.bump();
    }
    for (const ob of this.obstacles) {
      if (ob.kind !== "stop" && hit(ob.x, ob.z, ob.kind === "barrier" ? 0.16 : 0.1)) {
        this.bump();
      }
    }
  }

  private bump() {
    if (this.crashFlash > 0) return;
    this.crashFlash = 0.35;
    this.shake = Math.max(this.shake, 1.5);
    this.hits += 1;
    this.player.speed *= 0.82;
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export { SEGMENT_LENGTH };

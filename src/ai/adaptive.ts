export type DriveStyle = "агрессивный" | "спокойный" | "рваный" | "точный" | "калибровка";

export interface Telemetry {
  speed: number;
  maxSpeed: number;
  steer: number;
  crashed: boolean;
  nitro: boolean;
  dt: number;
}

export interface Adaptation {
  rivalSpeed: number;
  obstacleRate: number;
  curveScale: number;
  roadWidth: number;
  style: DriveStyle;
  labels: {
    rivals: string;
    obstacles: string;
    track: string;
  };
}

const empty = {
  time: 0,
  speedSum: 0,
  steerJitter: 0,
  lastSteer: 0,
  crashes: 0,
  nitroTime: 0,
  samples: 0,
};

export class AdaptiveAI {
  private stats = { ...empty };
  private current: Adaptation = {
    rivalSpeed: 1,
    obstacleRate: 1,
    curveScale: 1,
    roadWidth: 1,
    style: "калибровка",
    labels: { rivals: "норм", obstacles: "норм", track: "норм" },
  };

  observe(t: Telemetry) {
    this.stats.time += t.dt;
    this.stats.samples += 1;
    this.stats.speedSum += t.speed / t.maxSpeed;
    this.stats.steerJitter += Math.abs(t.steer - this.stats.lastSteer);
    this.stats.lastSteer = t.steer;
    if (t.crashed) this.stats.crashes += 1;
    if (t.nitro) this.stats.nitroTime += t.dt;
    if (this.stats.time > 2.2) this.recompute();
  }

  snapshot() {
    return this.current;
  }

  reset() {
    this.stats = { ...empty };
    this.current = {
      rivalSpeed: 1,
      obstacleRate: 1,
      curveScale: 1,
      roadWidth: 1,
      style: "калибровка",
      labels: { rivals: "норм", obstacles: "норм", track: "норм" },
    };
  }

  private recompute() {
    const avgSpeed = this.stats.speedSum / Math.max(1, this.stats.samples);
    const jitter = this.stats.steerJitter / Math.max(1, this.stats.samples);
    const crashRate = this.stats.crashes / Math.max(1, this.stats.time);
    const nitroShare = this.stats.nitroTime / Math.max(1, this.stats.time);

    let style: DriveStyle = "точный";
    if (crashRate > 0.18 || jitter > 0.085) style = "рваный";
    else if (avgSpeed > 0.72 && nitroShare > 0.12) style = "агрессивный";
    else if (avgSpeed < 0.42) style = "спокойный";

    let rivalSpeed = 0.92;
    let obstacleRate = 0.9;
    let curveScale = 0.9;
    let roadWidth = 1.3;

    if (style === "агрессивный") {
      rivalSpeed = 1.18;
      obstacleRate = 1.25;
      curveScale = 1.15;
      roadWidth = 1.1;
    } else if (style === "точный") {
      rivalSpeed = 1.28;
      obstacleRate = 1.35;
      curveScale = 1.28;
      roadWidth = 1.04;
    } else if (style === "спокойный") {
      rivalSpeed = 0.82;
      obstacleRate = 0.72;
      curveScale = 0.78;
      roadWidth = 1.46;
    } else if (style === "рваный") {
      rivalSpeed = 0.88;
      obstacleRate = 0.8;
      curveScale = 0.7;
      roadWidth = 1.52;
    }

    this.current = {
      rivalSpeed,
      obstacleRate,
      curveScale,
      roadWidth,
      style,
      labels: {
        rivals: levelWord(rivalSpeed),
        obstacles: levelWord(obstacleRate),
        track: levelWord(curveScale),
      },
    };

    this.stats = { ...empty, lastSteer: this.stats.lastSteer };
  }
}

function levelWord(v: number) {
  if (v > 1.2) return "жёстко";
  if (v > 1.05) return "выше";
  if (v < 0.8) return "мягче";
  return "норм";
}

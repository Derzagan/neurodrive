import type { Gesture } from "../gestures/recognizer";
import { SEGMENT_LENGTH, World } from "./world";

type Point = { x: number; y: number; w: number; z: number; scale: number };

export class Renderer {
  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
  ) {}

  resize() {
    const dpr = Math.min(devicePixelRatio, 1.5);
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(world: World, gesture: Gesture) {
    const w = innerWidth;
    const h = innerHeight;
    const ctx = this.ctx;
    const horizon = h * 0.36;
    const near = 140;
    const depth = 110;

    const crashShake = Math.min(1, world.shake / 1.5);
    const shakeX = Math.sin(world.raceTime * 38) * crashShake * 3;
    const shakeY = Math.cos(world.raceTime * 52) * crashShake * 2;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#071116");
    sky.addColorStop(0.42, "#173a3d");
    sky.addColorStop(0.68, "#6e3a32");
    sky.addColorStop(1, "#101817");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    this.stars(w, horizon);
    this.city(w, horizon, world.player.z);
    this.speedTrails(w, h, world);

    const pts: Point[] = [];
    const start = Math.ceil(world.player.z / SEGMENT_LENGTH);
    const cameraOffset = world.routeOffsetAt(world.player.z);
    const cameraScale = 1 / 0.72;
    pts.push({
      x: w / 2,
      y: horizon + (h - horizon) * 0.92 * cameraScale,
      w: Math.min(w * 1.8, 2800 * cameraScale),
      z: world.player.z,
      scale: cameraScale,
    });
    for (let n = 0; n < depth; n++) {
      const segmentIndex = ((start + n) % world.segments.length + world.segments.length) % world.segments.length;
      const z = (start + n) * SEGMENT_LENGTH;
      const rel = z - world.player.z + near;
      const seg = world.segments[segmentIndex];
      const scale = 1 / (rel * 0.0036 + 0.72);
      pts.push({
        x: w / 2 + (seg.offset - cameraOffset) * scale * 0.35,
        y: horizon + (h - horizon) * 0.92 * scale,
        w: Math.min(w * 1.8, 2800 * scale),
        z,
        scale,
      });
    }

    ctx.fillStyle = "#192521";
    ctx.fillRect(0, horizon, w, h - horizon);
    this.roadSurface(pts);
    this.roadMarkings(world, w, h, horizon, cameraOffset, near);

    this.roadside(pts, w);
    this.drawSprites(world, pts, w, horizon, near);
    this.car(w, h, world, gesture);

    if (world.crashFlash > 0) {
      ctx.fillStyle = `rgba(255, 70, 120, ${world.crashFlash * 0.35})`;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.restore();
  }

  private roadSurface(pts: Point[]) {
    const ctx = this.ctx;
    this.roadStrip(pts, 1.62, "#293536");
    this.roadStrip(pts, 1.34, "#626b63");
    this.roadStrip(pts, 1.22, "#a4a08b");
    this.roadStrip(pts, 1.18, "#58645d");
    this.roadStrip(pts, 1.08, "#d08b52");
    this.roadStrip(pts, 1, "#303638");

    ctx.strokeStyle = "#e4e6d5";
    ctx.lineWidth = 2.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let index = pts.length - 1; index >= 0; index--) {
        const point = pts[index];
        const x = point.x + side * point.w * 0.495;
        if (index === pts.length - 1) ctx.moveTo(x, point.y);
        else ctx.lineTo(x, point.y);
      }
      ctx.stroke();
    }
  }

  private roadStrip(pts: Point[], widthScale: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let index = pts.length - 1; index >= 0; index--) {
      const point = pts[index];
      const x = point.x - point.w * widthScale * 0.5;
      if (index === pts.length - 1) ctx.moveTo(x, point.y);
      else ctx.lineTo(x, point.y);
    }
    for (let index = 0; index < pts.length; index++) {
      const point = pts[index];
      ctx.lineTo(point.x + point.w * widthScale * 0.5, point.y);
    }
    ctx.closePath();
    ctx.fill();
  }

  private roadMarkings(
    world: World,
    w: number,
    h: number,
    horizon: number,
    cameraOffset: number,
    near: number,
  ) {
    const ctx = this.ctx;
    const projectLane = (z: number, lane: number) => {
      const rel = z - world.player.z + near;
      const scale = 1 / (rel * 0.0036 + 0.72);
      const center = w / 2 + (world.routeOffsetAt(z) - cameraOffset) * scale * 0.35;
      return {
        x: center + lane * Math.min(w * 1.8, 2800 * scale),
        y: horizon + (h - horizon) * 0.92 * scale,
        width: Math.min(w * 1.8, 2800 * scale),
      };
    };

    ctx.strokeStyle = "rgba(241, 238, 210, 0.92)";
    ctx.lineCap = "butt";
    for (let markingZ = Math.ceil((world.player.z + near) / 160) * 160; markingZ < world.player.z + 14000; markingZ += 160) {
      if (Math.floor(markingZ / 160) % 2 !== 0) continue;
      const endZ = markingZ + 80;
      for (const lane of [-0.19, 0, 0.19]) {
        const start = projectLane(markingZ, lane);
        const end = projectLane(endZ, lane);
        ctx.lineWidth = Math.max(1, Math.min(14, ((start.width + end.width) / 2) * 0.007));
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(246, 190, 121, 0.68)";
      for (const lane of [-0.72, 0.72]) {
        const start = projectLane(markingZ, lane);
        const end = projectLane(endZ, lane);
        ctx.lineWidth = Math.max(1, Math.min(9, ((start.width + end.width) / 2) * 0.004));
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(241, 238, 210, 0.92)";
    }
  }

  private stars(w: number, horizon: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(235, 239, 209, 0.62)";
    for (let i = 0; i < 46; i++) {
      const x = (i * 197 + 31) % w;
      const y = (i * 73 + 19) % Math.max(20, horizon * 0.72);
      ctx.fillRect(x, y, i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1);
    }
  }

  private city(w: number, horizon: number, z: number) {
    const ctx = this.ctx;
    const dusk = ctx.createRadialGradient(w * 0.72, horizon * 0.62, 2, w * 0.72, horizon * 0.62, w * 0.48);
    dusk.addColorStop(0, "rgba(255, 156, 91, 0.34)");
    dusk.addColorStop(0.42, "rgba(224, 96, 65, 0.12)");
    dusk.addColorStop(1, "rgba(224, 96, 65, 0)");
    ctx.fillStyle = dusk;
    ctx.fillRect(0, 0, w, horizon + 40);

    for (let layer = 0; layer < 2; layer++) {
      const pitch = layer === 0 ? 108 : 164;
      const drift = (z * (layer === 0 ? 0.016 : 0.009)) % pitch;
      const count = Math.ceil(w / pitch) + 3;
      for (let i = -1; i < count; i++) {
        const seed = i + Math.floor(z * (layer === 0 ? 0.00022 : 0.0001));
        const shape = Math.abs(Math.sin(seed * 127.1 + layer * 311.7));
        const x = i * pitch - drift;
        const width = pitch * (0.62 + shape * 0.27);
        const height = horizon * (0.16 + shape * (layer === 0 ? 0.44 : 0.78));
        const top = horizon - height;
        ctx.fillStyle = layer === 0 ? "#172327" : "#101a1e";
        ctx.fillRect(x, top, width, height + 5);
        ctx.fillStyle = layer === 0 ? "rgba(221, 130, 81, 0.5)" : "rgba(186, 218, 172, 0.34)";
        ctx.fillRect(x + width * 0.12, top + 5, width * 0.76, 2);

        const columns = Math.max(2, Math.floor(width / 18));
        const rows = Math.max(1, Math.floor(height / 23));
        for (let row = 0; row < rows; row++) {
          for (let column = 0; column < columns; column++) {
            const lit = Math.sin(seed * 19 + row * 7.3 + column * 13.1) > 0.12;
            if (!lit) continue;
            const warm = (row + column + i) % 3 === 0;
            ctx.fillStyle = warm ? "rgba(255, 180, 103, 0.52)" : "rgba(137, 213, 196, 0.42)";
            ctx.fillRect(x + 8 + column * 17, top + 15 + row * 22, 4, 6);
          }
        }

        if (layer === 0 && shape > 0.64) {
          ctx.fillStyle = "#c2d4bc";
          ctx.fillRect(x + width * 0.42, top - 8, 2, 8);
          ctx.fillStyle = "rgba(255, 137, 77, 0.74)";
          ctx.fillRect(x + width * 0.42 - 2, top - 10, 6, 3);
        }
      }
    }

    const haze = ctx.createLinearGradient(0, horizon - 24, 0, horizon + 8);
    haze.addColorStop(0, "rgba(255, 166, 100, 0)");
    haze.addColorStop(1, "rgba(196, 219, 170, 0.3)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - 24, w, 34);
  }

  private roadside(pts: Point[], w: number) {
    const ctx = this.ctx;
    for (let i = pts.length - 1; i >= 4; i -= 7) {
      const point = pts[i];
      const interval = Math.floor(point.z / (SEGMENT_LENGTH * 5));
      for (const side of [-1, 1]) {
        const seed = Math.sin(interval * 12.9898 + side * 78.233);
        const buildingWidth = point.scale * (270 + Math.abs(seed) * 180);
        const buildingHeight = point.scale * (540 + Math.abs(seed) * 660);
        const x = point.x + side * (point.w * 0.5 + buildingWidth * 0.55 + point.scale * 45);
        const left = x - buildingWidth / 2;
        const top = point.y - buildingHeight;
        if (left > w + buildingWidth || left + buildingWidth < -buildingWidth) continue;

        const facades = ["#182426", "#202a2d", "#263033", "#1c2929"];
        const facade = facades[Math.floor(Math.abs(seed) * facades.length) % facades.length];
        ctx.fillStyle = "rgba(7, 13, 16, 0.48)";
        ctx.fillRect(left - buildingWidth * 0.06, top + buildingHeight * 0.08, buildingWidth * 1.12, buildingHeight * 0.92);
        ctx.fillStyle = facade;
        ctx.fillRect(left, top, buildingWidth, buildingHeight);
        ctx.fillStyle = "rgba(171, 209, 195, 0.35)";
        ctx.fillRect(left, top, buildingWidth, Math.max(1, point.scale * 7));

        if (buildingWidth > 13 && buildingHeight > 18) {
          const columns = Math.min(5, Math.max(1, Math.floor(buildingWidth / Math.max(5, point.scale * 32))));
          const rows = Math.min(7, Math.max(1, Math.floor(buildingHeight / Math.max(8, point.scale * 42))));
          const windowWidth = Math.max(1, buildingWidth * 0.075);
          const windowHeight = Math.max(1, buildingHeight * 0.027);
          for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
              const lit = Math.sin(interval * 17 + row * 8.3 + column * 13.7) > -0.05;
              if (!lit) continue;
              const warm = (row + column + interval) % 4 === 0;
              ctx.fillStyle = warm ? "rgba(255, 187, 105, 0.9)" : "rgba(106, 224, 222, 0.76)";
              ctx.fillRect(
                left + ((column + 1) * buildingWidth) / (columns + 1) - windowWidth / 2,
                top + ((row + 1) * buildingHeight) / (rows + 1) - windowHeight / 2,
                windowWidth,
                windowHeight,
              );
            }
          }

          const storefrontHeight = buildingHeight * 0.14;
          ctx.fillStyle = "#10191c";
          ctx.fillRect(left + buildingWidth * 0.08, point.y - storefrontHeight, buildingWidth * 0.84, storefrontHeight);
          ctx.fillStyle = interval % 2 === 0 ? "#e67c4f" : "#51c6be";
          ctx.fillRect(left + buildingWidth * 0.13, point.y - storefrontHeight * 0.82, buildingWidth * 0.74, Math.max(1, point.scale * 8));
          if (buildingWidth > 34 && interval % 3 === 0) {
            ctx.fillStyle = "#f3ead4";
            ctx.font = `700 ${Math.max(4, point.scale * 12)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("NIGHT CITY", x, point.y - storefrontHeight * 0.82 + point.scale * 4, buildingWidth * 0.68);
          }
        }

        if (interval % 2 === (side === -1 ? 0 : 1)) {
          const poleX = point.x + side * (point.w * 0.5 + point.scale * 52);
          const lampHeight = point.scale * 145;
          const lampY = point.y - lampHeight;
          ctx.fillStyle = "rgba(255, 190, 112, 0.16)";
          ctx.beginPath();
          ctx.arc(poleX, lampY, Math.max(2, point.scale * 14), 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#89928a";
          ctx.lineWidth = Math.max(1, point.scale * 2.5);
          ctx.beginPath();
          ctx.moveTo(poleX, point.y);
          ctx.lineTo(poleX, lampY);
          ctx.lineTo(poleX - side * point.scale * 22, lampY);
          ctx.stroke();
          ctx.fillStyle = "#ffd394";
          ctx.beginPath();
          ctx.arc(poleX - side * point.scale * 22, lampY, Math.max(1, point.scale * 4), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private speedTrails(w: number, h: number, world: World) {
    const ctx = this.ctx;
    const count = 22;
    const speed = Math.min(1, world.player.speed / 220);
    for (let i = 0; i < count; i++) {
      const x = w * (0.22 + ((i / count) * 0.56)) + Math.sin(i + world.raceTime * 16) * 12;
      const y = h * (0.78 + (i % 3) * 0.04) + (i * 8) * (1 + speed);
      const alpha = 0.12 + (i / count) * 0.22 + speed * 0.2;
      ctx.strokeStyle = `rgba(77, 240, 255, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 18, y + 28 + speed * 24);
      ctx.stroke();
    }
  }

  private project(rel: number, playerX: number, w: number, horizon: number, h: number) {
    const scale = 1 / (rel * 0.0036 + 0.72);
    return {
      x: w / 2 - playerX * 340 * scale,
      y: horizon + (h - horizon) * 0.92 * scale,
      scale,
    };
  }

  private drawSprites(world: World, pts: Point[], w: number, horizon: number, near: number) {
    const h = innerHeight;
    const sprites = [
      ...world.obstacles.map((o) => ({ z: o.z, x: o.x, kind: o.kind, color: "" })),
      ...world.rivals.map((c) => ({ z: c.z, x: c.x, kind: "car" as const, color: c.color })),
    ].sort((a, b) => b.z - a.z);

    for (const s of sprites) {
      const rel = s.z - world.player.z + near;
      if (rel < 80 || rel > 14000) continue;
      const p = this.project(rel, world.player.x, w, horizon, h);
      const idx = Math.min(pts.length - 1, Math.max(0, Math.floor((s.z - world.player.z) / SEGMENT_LENGTH) + 1));
      const roadX = pts[idx]?.x ?? p.x;
      const roadWidth = pts[idx]?.w ?? 0;
      const x = s.kind === "stop"
        ? roadX + Math.sign(s.x || 1) * (roadWidth * 0.5 + 32 * p.scale)
        : roadX + (s.x / world.playerRoadLimit) * roadWidth * 0.5;
      const y = p.y;
      if (s.kind === "car") this.rival(x, y, p.scale, s.color);
      else if (s.kind === "cone") this.cone(x, y, p.scale);
      else if (s.kind === "barrier") this.barrier(x, y, p.scale);
      else if (s.kind === "stop") this.stopSign(x, y, p.scale);
      else if (s.kind === "pedestrian") this.pedestrian(x, y, p.scale);
      else this.drone(x, y, p.scale);
    }
  }

  private rival(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    const scale = s * 1.55;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 12 * scale, 96 * scale, 16 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-68 * scale, 8 * scale);
    ctx.lineTo(-38 * scale, -38 * scale);
    ctx.lineTo(38 * scale, -38 * scale);
    ctx.lineTo(68 * scale, 8 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#071018";
    ctx.fillRect(-28 * scale, -32 * scale, 56 * scale, 18 * scale);
    ctx.fillStyle = "#fff8";
    ctx.fillRect(-46 * scale, -4 * scale, 16 * scale, 7 * scale);
    ctx.fillRect(30 * scale, -4 * scale, 16 * scale, 7 * scale);
    ctx.restore();
  }

  private cone(x: number, y: number, s: number) {
    const ctx = this.ctx;
    const scale = s * 1.8;
    ctx.fillStyle = "#ff7a3c";
    ctx.beginPath();
    ctx.moveTo(x, y - 64 * scale);
    ctx.lineTo(x + 26 * scale, y);
    ctx.lineTo(x - 26 * scale, y);
    ctx.fill();
  }

  private barrier(x: number, y: number, s: number) {
    const ctx = this.ctx;
    const scale = s * 1.8;
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(x - 54 * scale, y - 38 * scale, 108 * scale, 32 * scale);
    ctx.fillStyle = "#1b1208";
    ctx.fillRect(x - 54 * scale, y - 26 * scale, 108 * scale, 10 * scale);
  }

  private stopSign(x: number, y: number, s: number) {
    const ctx = this.ctx;
    const scale = s * 2.2;
    ctx.strokeStyle = "#d8e2eb";
    ctx.lineWidth = Math.max(1, 3 * scale);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 58 * scale);
    ctx.stroke();
    ctx.fillStyle = "#f4f6f8";
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 8) + (i * Math.PI) / 4;
      const px = x + Math.cos(angle) * 25 * scale;
      const py = y - 70 * scale + Math.sin(angle) * 25 * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#df3038";
    ctx.beginPath();
    ctx.arc(x, y - 70 * scale, 21 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(4, 10 * scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("STOP", x, y - 70 * scale);
  }

  private pedestrian(x: number, y: number, s: number) {
    const ctx = this.ctx;
    const scale = s * 2.1;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let stripe = -2; stripe <= 2; stripe++) {
      ctx.fillRect(x + stripe * 12 * scale - 4 * scale, y - 3 * scale, 7 * scale, 3 * scale);
    }
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = Math.max(1.5, 6 * scale);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y - 30 * scale);
    ctx.lineTo(x, y - 12 * scale);
    ctx.moveTo(x, y - 25 * scale);
    ctx.lineTo(x - 10 * scale, y - 18 * scale);
    ctx.moveTo(x, y - 25 * scale);
    ctx.lineTo(x + 10 * scale, y - 19 * scale);
    ctx.moveTo(x, y - 12 * scale);
    ctx.lineTo(x - 8 * scale, y - 2 * scale);
    ctx.moveTo(x, y - 12 * scale);
    ctx.lineTo(x + 8 * scale, y - 2 * scale);
    ctx.stroke();
    ctx.fillStyle = "#f2c9a5";
    ctx.beginPath();
    ctx.arc(x, y - 38 * scale, 7 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  private drone(x: number, y: number, s: number) {
    const ctx = this.ctx;
    const scale = s * 1.7;
    ctx.strokeStyle = "#4df0ff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y - 68 * scale, 20 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ff4dce";
    ctx.beginPath();
    ctx.arc(x, y - 68 * scale, 6 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  private car(w: number, h: number, world: World, gesture: Gesture) {
    const ctx = this.ctx;
    const y = h * (w < 500 ? 0.62 : 0.78);
    const horizon = h * 0.36;
    const carScale = (y + 36 - horizon) / ((h - horizon) * 0.92);
    const roadWidth = Math.min(w * 1.8, 2800 * carScale);
    const x = w / 2 + (world.player.x / world.playerRoadLimit) * roadWidth * 0.5;
    const tilt = world.player.x * 0.16;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    const glow = ctx.createRadialGradient(0, 20, 10, 0, 20, 180);
    glow.addColorStop(0, "rgba(77,240,255,0.36)");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, 36, 170, 28, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0b1524";
    roundRect(ctx, -96, -18, 192, 52, 16);
    ctx.fill();
    const body = ctx.createLinearGradient(-100, -44, 100, 34);
    body.addColorStop(0, "#4df0ff");
    body.addColorStop(0.5, "#7aa7ff");
    body.addColorStop(1, "#ff4dce");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-74, 12);
    ctx.lineTo(-42, -40);
    ctx.lineTo(42, -40);
    ctx.lineTo(74, 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(6,12,24,0.86)";
    roundRect(ctx, -34, -36, 68, 22, 9);
    ctx.fill();
    ctx.fillStyle = world.usingNitro ? "#ffd166" : "#f8fbff";
    ctx.fillRect(-60, 8, 18, 8);
    ctx.fillRect(42, 8, 18, 8);
    if (world.usingNitro) {
      ctx.fillStyle = "rgba(255, 125, 40, 0.75)";
      ctx.beginPath();
      ctx.moveTo(-16, 18);
      ctx.lineTo(0, 54);
      ctx.lineTo(16, 18);
      ctx.fill();
    }
    ctx.restore();

    if (gesture !== "none") {
      ctx.font = "600 13px Manrope";
      ctx.fillStyle = "rgba(233,246,255,0.7)";
      ctx.textAlign = "center";
      ctx.fillText("жест активен", x, y + 58);
    }
  }

}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

import * as THREE from "three";
import type { Car, Obstacle } from "./types";
import { SEGMENT_LENGTH, World } from "./world";
import type { Gesture } from "../gestures/recognizer";

const ROAD_HALF_WIDTH = 10;
const ROUTE_SCALE = 0.0015;
const Z_SCALE = 0.035;
const COURSE_SEGMENTS = 430;

type Instance = {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: number;
  color: THREE.Color;
};

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(64, 1, 0.1, 900);
  private readonly sky: THREE.Mesh;
  private readonly track = new THREE.Group();
  private readonly playerModel = createCar("#40dfff", true);
  private readonly rivals = new Map<Car, THREE.Group>();
  private readonly obstacles = new Map<Obstacle, THREE.Group>();
  private readonly streetLights: THREE.PointLight[] = [];
  private readonly crashGlow: THREE.Mesh;
  private sourceSegments: World["segments"] | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene.fog = new THREE.Fog(0x263542, 110, 340);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(480, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `varying float vHeight;
          void main() {
            vHeight = normalize(position).y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `varying float vHeight;
          void main() {
            vec3 horizon = vec3(0.82, 0.35, 0.24);
            vec3 dusk = vec3(0.16, 0.25, 0.34);
            vec3 zenith = vec3(0.025, 0.06, 0.12);
            float blend = smoothstep(-0.2, 0.55, vHeight);
            vec3 color = mix(horizon, dusk, blend);
            color = mix(color, zenith, smoothstep(0.35, 0.95, vHeight));
            gl_FragColor = vec4(color, 1.0);
          }`,
      }),
    );
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    this.scene.add(new THREE.HemisphereLight(0xc0e2ff, 0x18202a, 2.1));
    const moon = new THREE.DirectionalLight(0xb9d8ff, 1.4);
    moon.position.set(-30, 60, -20);
    this.scene.add(moon);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(420, COURSE_SEGMENTS * SEGMENT_LENGTH * Z_SCALE + 100),
      new THREE.MeshStandardMaterial({ color: 0x243b3d, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.24, (COURSE_SEGMENTS * SEGMENT_LENGTH * Z_SCALE) / 2);
    this.scene.add(ground);

    this.scene.add(this.track);
    this.scene.add(this.playerModel);
    this.createStreetLights();
    this.crashGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ color: 0xff405d, transparent: true, opacity: 0, depthTest: false }),
    );
    this.crashGlow.renderOrder = 20;
    this.camera.add(this.crashGlow);
    this.crashGlow.position.set(0, 0, -0.5);
    this.scene.add(this.camera);
    this.resize();
  }

  resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  draw(world: World, _gesture: Gesture) {
    if (this.sourceSegments !== world.segments) this.rebuildTrack(world);

    const playerZ = world.player.z * Z_SCALE;
    const roadCenter = this.routeX(world, world.player.z);
    const aheadCenter = this.routeX(world, world.player.z + 140);
    const laneScale = ROAD_HALF_WIDTH / world.playerRoadLimit;
    const playerX = roadCenter + world.player.x * laneScale;
    const roadTurn = Math.atan2(aheadCenter - roadCenter, 140 * Z_SCALE);

    this.sky.position.set(roadCenter, 0, playerZ + 80);
    this.camera.position.set(roadCenter + world.player.x * laneScale * 0.08, 5.6, playerZ - 13);
    this.camera.lookAt(roadCenter + (aheadCenter - roadCenter) * 0.34, 1.5, playerZ + 34);

    this.playerModel.position.set(playerX, 0.04, playerZ + 1.2);
    this.playerModel.rotation.y = roadTurn;
    this.playerModel.rotation.z = THREE.MathUtils.clamp(-world.player.x * 0.035, -0.08, 0.08);
    this.playerModel.scale.setScalar(1);
    const boostFlames = this.playerModel.userData.boostFlames as THREE.Mesh[];
    for (let index = 0; index < boostFlames.length; index++) {
      const flame = boostFlames[index];
      flame.visible = world.usingNitro;
      flame.scale.y = 0.8 + (Math.sin(world.raceTime * 34 + index * 2) + 1) * 0.24;
    }
    const boostLight = this.playerModel.userData.boostLight as THREE.PointLight | undefined;
    if (boostLight) boostLight.intensity = world.usingNitro ? 38 : 18;

    this.syncEntities(world, laneScale);
    this.updateStreetLights(world, playerZ);
    (this.crashGlow.material as THREE.MeshBasicMaterial).opacity = Math.min(0.32, world.crashFlash * 0.5);
    this.renderer.render(this.scene, this.camera);
  }

  private rebuildTrack(world: World) {
    disposeGroup(this.track);
    this.sourceSegments = world.segments;

    this.addRibbon(world, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.005, asphaltMaterial());
    this.addRibbon(world, -19, -12, -0.02, asphaltMaterial(0x323d40));
    this.addRibbon(world, 12, 19, -0.02, asphaltMaterial(0x323d40));
    this.addRibbon(world, -12, -10, 0.035, new THREE.MeshStandardMaterial({ color: 0x9ba397, roughness: 0.85 }));
    this.addRibbon(world, 10, 12, 0.035, new THREE.MeshStandardMaterial({ color: 0x9ba397, roughness: 0.85 }));
    this.addRibbon(world, -10.15, -9.95, 0.055, new THREE.MeshBasicMaterial({ color: 0xffa65e }));
    this.addRibbon(world, 9.95, 10.15, 0.055, new THREE.MeshBasicMaterial({ color: 0xffa65e }));
    this.addLaneDashes(world, [-3.8, 0, 3.8], 0xf3ecd1, 0.14);
    this.addLaneDashes(world, [-15.5, 15.5], 0xe9a35f, 0.11);
    this.createCity(world);
  }

  private addRibbon(
    world: World,
    left: number,
    right: number,
    y: number,
    material: THREE.Material,
  ) {
    const positions: number[] = [];
    const indices: number[] = [];
    const first = -4;
    const last = COURSE_SEGMENTS;
    for (let index = first; index <= last; index++) {
      const segmentIndex = Math.max(0, index) % world.segments.length;
      const center = world.segments[segmentIndex].offset * ROUTE_SCALE;
      const z = index * SEGMENT_LENGTH * Z_SCALE;
      positions.push(center + left, y, z, center + right, y, z);
      if (index < last) {
        const vertex = (index - first) * 2;
        indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.track.add(mesh);
  }

  private addLaneDashes(world: World, lanes: number[], color: number, width: number) {
    const positions: number[] = [];
    const indices: number[] = [];
    const dashEvery = 4;
    const dashLength = 2;
    for (let index = 0; index < COURSE_SEGMENTS - dashLength; index += dashEvery) {
      const next = index + dashLength;
      const start = world.segments[index];
      const end = world.segments[next];
      const startCenter = start.offset * ROUTE_SCALE;
      const endCenter = end.offset * ROUTE_SCALE;
      const startZ = index * SEGMENT_LENGTH * Z_SCALE;
      const endZ = next * SEGMENT_LENGTH * Z_SCALE;
      for (const lane of lanes) {
        const vertex = positions.length / 3;
        positions.push(
          startCenter + lane - width / 2, 0.035, startZ,
          startCenter + lane + width / 2, 0.035, startZ,
          endCenter + lane - width / 2, 0.035, endZ,
          endCenter + lane + width / 2, 0.035, endZ,
        );
        indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const markings = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    markings.frustumCulled = false;
    this.track.add(markings);
  }

  private createCity(world: World) {
    const buildings: Instance[] = [];
    const windows: Instance[] = [];
    const signs: Instance[] = [];
    const distantTowers: Instance[] = [];
    const unitBox = new THREE.BoxGeometry(1, 1, 1);

    for (let index = 4; index < COURSE_SEGMENTS; index += 4) {
      const segment = world.segments[index];
      const nextSegment = world.segments[index + 1];
      const centerX = segment.offset * ROUTE_SCALE;
      const z = index * SEGMENT_LENGTH * Z_SCALE;
      const yaw = Math.atan2((nextSegment.offset - segment.offset) * ROUTE_SCALE, SEGMENT_LENGTH * Z_SCALE);

      for (const side of [-1, 1]) {
        const seed = Math.sin(index * 17.17 + side * 4.91);
        const width = 8 + Math.abs(seed) * 7;
        const depth = 9 + Math.abs(Math.sin(seed * 3.7)) * 9;
        const height = 13 + Math.abs(Math.cos(seed * 5.3)) * 24;
        const buildingX = centerX + side * (ROAD_HALF_WIDTH + width / 2 + 4.4);
        const buildingZ = z + depth * 0.35;
        const facadeColor = [0x29414a, 0x35434b, 0x3e4547, 0x2b3c46][Math.floor(Math.abs(seed) * 4) % 4];
        buildings.push({
          position: new THREE.Vector3(buildingX, height / 2, buildingZ),
          scale: new THREE.Vector3(width, height, depth),
          rotation: yaw,
          color: new THREE.Color(facadeColor),
        });

        const columnCount = Math.max(2, Math.floor(depth / 4));
        const rowCount = Math.max(2, Math.floor(height / 5));
        for (let row = 0; row < rowCount; row++) {
          for (let column = 0; column < columnCount; column++) {
            const lit = Math.sin(index * 9 + row * 6.7 + column * 13.1 + side) > -0.1;
            if (!lit) continue;
            const localX = -side * (width / 2 + 0.035);
            const localZ = ((column + 1) / (columnCount + 1) - 0.5) * depth * 0.72;
            windows.push({
              position: localToWorld(buildingX, 2.6 + row * 4.1, buildingZ, localX, localZ, yaw),
              scale: new THREE.Vector3(0.08, 1.35, Math.min(1.7, depth / (columnCount + 1) * 0.56)),
              rotation: yaw,
              color: new THREE.Color((row + column + index) % 3 === 0 ? 0xffb76b : 0x70e2e4),
            });
          }
        }

        if (index % 12 === 4) {
          signs.push({
            position: localToWorld(buildingX, 3.7, buildingZ, -side * (width / 2 + 0.1), 0, yaw),
            scale: new THREE.Vector3(0.18, 1.1, Math.min(6, depth * 0.72)),
            rotation: yaw,
            color: new THREE.Color(index % 24 === 4 ? 0xff725e : 0x57dbe8),
          });
        }

        if (index % 16 === 4) {
          const towerWidth = 18 + Math.abs(Math.sin(seed * 2)) * 14;
          const towerDepth = 14 + Math.abs(Math.cos(seed * 3)) * 10;
          const towerHeight = 42 + Math.abs(Math.sin(seed * 7)) * 82;
          distantTowers.push({
            position: new THREE.Vector3(centerX + side * (52 + towerWidth / 2), towerHeight / 2, z + 24),
            scale: new THREE.Vector3(towerWidth, towerHeight, towerDepth),
            rotation: yaw * 0.55,
            color: new THREE.Color(index % 32 === 4 ? 0x303a4c : 0x253544),
          });
        }
      }
    }

    this.addInstances(unitBox, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.08 }), buildings);
    this.addInstances(
      unitBox,
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      windows,
    );
    this.addInstances(
      unitBox,
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      signs,
    );
    this.addInstances(unitBox, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 }), distantTowers);
    this.createStreetFurniture(world);
  }

  private addInstances(geometry: THREE.BufferGeometry, material: THREE.Material, instances: Instance[]) {
    if (!instances.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
    const helper = new THREE.Object3D();
    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index];
      helper.position.copy(instance.position);
      helper.rotation.set(0, instance.rotation, 0);
      helper.scale.copy(instance.scale);
      helper.updateMatrix();
      mesh.setMatrixAt(index, helper.matrix);
      mesh.setColorAt(index, instance.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this.track.add(mesh);
  }

  private createStreetFurniture(world: World) {
    const poles: Instance[] = [];
    const lamps: Instance[] = [];
    const poleGeometry = new THREE.CylinderGeometry(0.075, 0.12, 1, 6);
    const lampGeometry = new THREE.SphereGeometry(0.24, 8, 6);
    for (let index = 8; index < COURSE_SEGMENTS; index += 8) {
      const segment = world.segments[index];
      const centerX = segment.offset * ROUTE_SCALE;
      const z = index * SEGMENT_LENGTH * Z_SCALE;
      const yaw = Math.atan2((world.segments[index + 1].offset - segment.offset) * ROUTE_SCALE, SEGMENT_LENGTH * Z_SCALE);
      const side = index % 16 === 8 ? -1 : 1;
      const x = centerX + side * 13.2;
      const height = 8.5;
      poles.push({
        position: new THREE.Vector3(x, height / 2, z),
        scale: new THREE.Vector3(1, height, 1),
        rotation: yaw,
        color: new THREE.Color(0x687a80),
      });
      lamps.push({
        position: new THREE.Vector3(x - side * 1.3, height, z),
        scale: new THREE.Vector3(1.8, 0.4, 0.45),
        rotation: yaw,
        color: new THREE.Color(0xffd18c),
      });
    }
    this.addInstances(poleGeometry, new THREE.MeshStandardMaterial({ color: 0x758990, metalness: 0.65, roughness: 0.38 }), poles);
    this.addInstances(lampGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lamps);
  }

  private createStreetLights() {
    for (let index = 0; index < 8; index++) {
      const light = new THREE.PointLight(index % 2 ? 0x5edbe9 : 0xffab6b, 28, 38, 2);
      light.position.set(0, 7, 0);
      this.scene.add(light);
      this.streetLights.push(light);
    }
  }

  private updateStreetLights(world: World, playerZ: number) {
    for (let index = 0; index < this.streetLights.length; index++) {
      const offset = 18 + index * 18;
      const worldZ = world.player.z + offset / Z_SCALE;
      const centerX = this.routeX(world, worldZ);
      const side = index % 2 === 0 ? -1 : 1;
      const light = this.streetLights[index];
      light.position.set(centerX + side * 13.2, 7.6, playerZ + offset);
    }
  }

  private syncEntities(world: World, laneScale: number) {
    const activeRivals = new Set(world.rivals);
    for (const [car, model] of this.rivals) {
      if (activeRivals.has(car)) continue;
      this.scene.remove(model);
      disposeObject(model);
      this.rivals.delete(car);
    }
    for (const car of world.rivals) {
      let model = this.rivals.get(car);
      if (!model) {
        model = createCar(car.color, false);
        model.scale.setScalar(1.18);
        this.rivals.set(car, model);
        this.scene.add(model);
      }
      const centerX = this.routeX(world, car.z);
      model.position.set(centerX + car.x * laneScale, 0.05, car.z * Z_SCALE);
      model.rotation.y = this.routeAngle(world, car.z);
    }

    const activeObstacles = new Set(world.obstacles);
    for (const [obstacle, model] of this.obstacles) {
      if (activeObstacles.has(obstacle)) continue;
      this.scene.remove(model);
      disposeObject(model);
      this.obstacles.delete(obstacle);
    }
    for (const obstacle of world.obstacles) {
      let model = this.obstacles.get(obstacle);
      if (!model) {
        model = createObstacle(obstacle.kind);
        this.obstacles.set(obstacle, model);
        this.scene.add(model);
      }
      const centerX = this.routeX(world, obstacle.z);
      const signOffset = obstacle.kind === "stop" ? Math.sign(obstacle.x || 1) * (ROAD_HALF_WIDTH + 1.4) : obstacle.x * laneScale;
      model.position.set(centerX + signOffset, 0, obstacle.z * Z_SCALE);
      model.rotation.y = this.routeAngle(world, obstacle.z);
    }
  }

  private routeX(world: World, z: number) {
    return world.routeOffsetAt(z) * ROUTE_SCALE;
  }

  private routeAngle(world: World, z: number) {
    return Math.atan2(
      (world.routeOffsetAt(z + 120) - world.routeOffsetAt(z)) * ROUTE_SCALE,
      120 * Z_SCALE,
    );
  }
}

function asphaltMaterial(color = 0x303941) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12, side: THREE.DoubleSide });
}

function createCar(color: string, player: boolean) {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, metalness: 0.48, roughness: 0.3 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x11232d, metalness: 0.28, roughness: 0.18 });
  const rubberMaterial = new THREE.MeshStandardMaterial({ color: 0x080d12, roughness: 0.88 });
  const tailMaterial = new THREE.MeshBasicMaterial({ color: player ? 0xff453d : 0xff725e, toneMapped: false });

  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.5, 4.2), bodyMaterial);
  lowerBody.position.y = 0.56;
  group.add(lowerBody);

  const rearDeck = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.2, 1.1), bodyMaterial);
  rearDeck.position.set(0, 0.84, -1.32);
  group.add(rearDeck);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.66, 2.0), glassMaterial);
  cabin.position.set(0, 1.02, 0.16);
  group.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.09, 1.12), bodyMaterial);
  roof.position.set(0, 1.39, 0.28);
  group.add(roof);

  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.18, 0.24), new THREE.MeshStandardMaterial({ color: 0x111921, metalness: 0.38, roughness: 0.4 }));
  bumper.position.set(0, 0.37, -2.13);
  group.add(bumper);

  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.3, 12), rubberMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.08, 0.4, 1.18);
    group.add(wheel);
    const rearWheel = wheel.clone();
    rearWheel.position.z = -1.3;
    group.add(rearWheel);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.08), tailMaterial);
    tail.position.set(side * 0.64, 0.72, -2.16);
    group.add(tail);
  }

  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.18, 0.04), new THREE.MeshBasicMaterial({ color: 0xe5e8df }));
  plate.position.set(0, 0.54, -2.16);
  group.add(plate);

  if (player) {
    const boostFlames: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.24, 1.25, 8),
        new THREE.MeshBasicMaterial({
          color: side < 0 ? 0xff8a43 : 0x54dfff,
          transparent: true,
          opacity: 0.86,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(side * 0.44, 0.56, -2.8);
      flame.visible = false;
      group.add(flame);
      boostFlames.push(flame);
    }
    group.userData.boostFlames = boostFlames;
    const underglow = new THREE.PointLight(0x3ae7ff, 18, 9, 2);
    underglow.position.set(0, 0.3, 0);
    group.add(underglow);
    group.userData.boostLight = underglow;
  }
  return group;
}

function createObstacle(kind: Obstacle["kind"]) {
  const group = new THREE.Group();
  if (kind === "stop") {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.8, 7), new THREE.MeshStandardMaterial({ color: 0xc3c8c0, metalness: 0.4 }));
    pole.position.y = 1.4;
    group.add(pole);
    const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.16, 8), new THREE.MeshBasicMaterial({ color: 0xef443c, toneMapped: false }));
    sign.rotation.x = Math.PI / 2;
    sign.position.set(0, 2.5, 0);
    group.add(sign);
  } else if (kind === "cone") {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.25, 7), new THREE.MeshStandardMaterial({ color: 0xff793e, roughness: 0.55 }));
    cone.position.y = 0.62;
    group.add(cone);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), new THREE.MeshStandardMaterial({ color: 0xffd494 }));
    base.position.y = 0.06;
    group.add(base);
  } else if (kind === "barrier") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.34), new THREE.MeshStandardMaterial({ color: 0xe2a34f, roughness: 0.65 }));
    body.position.y = 0.55;
    group.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.22, 0.2, 0.37), new THREE.MeshBasicMaterial({ color: 0xf7e8c1 }));
    stripe.position.set(0, 0.55, 0.02);
    group.add(stripe);
  } else if (kind === "pedestrian") {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.0, 4, 7), new THREE.MeshStandardMaterial({ color: 0xffc46d, emissive: 0x4b2507, emissiveIntensity: 0.6 }));
    body.position.y = 0.95;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf0c39b }));
    head.position.y = 1.78;
    group.add(head);
  } else {
    const drone = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), new THREE.MeshStandardMaterial({ color: 0x58e6f4, emissive: 0x1ca9be, emissiveIntensity: 1.3, metalness: 0.4 }));
    drone.position.y = 3.2;
    group.add(drone);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.18), new THREE.MeshBasicMaterial({ color: 0xff5d8a, toneMapped: false }));
    wing.position.y = 3.2;
    group.add(wing);
  }
  return group;
}

function localToWorld(centerX: number, y: number, centerZ: number, localX: number, localZ: number, rotation: number) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return new THREE.Vector3(
    centerX + localX * cosine + localZ * sine,
    y,
    centerZ - localX * sine + localZ * cosine,
  );
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
  group.clear();
}

function disposeObject(object: THREE.Group) {
  disposeGroup(object);
}
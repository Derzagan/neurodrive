export interface Car {
  x: number;
  z: number;
  speed: number;
  color: string;
  accent: string;
  width: number;
}

export interface Obstacle {
  x: number;
  z: number;
  kind: "cone" | "barrier" | "drone" | "stop" | "pedestrian";
}

export interface Segment {
  curve: number;
  light: number;
  offset: number;
}

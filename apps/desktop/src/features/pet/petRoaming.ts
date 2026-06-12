export type RoamingPoint = {
  x: number;
  y: number;
};

export type RoamingSize = {
  width: number;
  height: number;
};

export type RoamingRect = RoamingPoint & RoamingSize;

export type RoamingPose = "running" | "running-left" | "running-right";

export type RoamingState = {
  progress: number;
  direction: 1 | -1;
  lastTickMs: number;
  pose: RoamingPose;
};

export type RoamingConfig = {
  margin: number;
  speedPxPerSecond: number;
  maxStepMs: number;
};

export type RoamingFrame = {
  bounds: RoamingRect;
  position: RoamingPoint;
  pose: RoamingPose;
  state: RoamingState;
};

export const defaultRoamingConfig: RoamingConfig = {
  margin: 18,
  speedPxPerSecond: 190,
  maxStepMs: 90,
};

export function createRoamingState(input: {
  position: RoamingPoint;
  petSize: RoamingSize;
  workArea: RoamingRect;
  nowMs: number;
  config?: Partial<RoamingConfig>;
  direction?: 1 | -1;
}): RoamingState {
  const config = resolveConfig(input.config);
  const bounds = buildRoamingBounds(input.workArea, input.petSize, config.margin);

  return {
    progress: nearestEdgeProgress(input.position, bounds),
    direction: input.direction ?? 1,
    lastTickMs: input.nowMs,
    pose: "running",
  };
}

export function advanceRoamingState(
  state: RoamingState,
  input: {
    petSize: RoamingSize;
    workArea: RoamingRect;
    nowMs: number;
    config?: Partial<RoamingConfig>;
  },
): RoamingFrame {
  const config = resolveConfig(input.config);
  const bounds = buildRoamingBounds(input.workArea, input.petSize, config.margin);
  const perimeter = roamingPerimeter(bounds);

  if (perimeter <= 0) {
    const position = { x: bounds.x, y: bounds.y };
    const nextState = { ...state, progress: 0, lastTickMs: input.nowMs, pose: "running" as const };
    return { bounds, position, pose: nextState.pose, state: nextState };
  }

  const elapsedMs = Math.min(Math.max(0, input.nowMs - state.lastTickMs), config.maxStepMs);
  const previousPosition = edgePointAt(state.progress, bounds);
  const nextProgress = wrapProgress(state.progress + state.direction * config.speedPxPerSecond * (elapsedMs / 1000), perimeter);
  const position = edgePointAt(nextProgress, bounds);
  const pose = poseForDelta(position.x - previousPosition.x, position.y - previousPosition.y, state.direction);
  const nextState = {
    ...state,
    progress: nextProgress,
    lastTickMs: input.nowMs,
    pose,
  };

  return { bounds, position, pose, state: nextState };
}

export function buildRoamingBounds(workArea: RoamingRect, petSize: RoamingSize, margin = defaultRoamingConfig.margin): RoamingRect {
  const safeMargin = Math.max(0, margin);
  const width = Math.max(0, workArea.width - petSize.width - safeMargin * 2);
  const height = Math.max(0, workArea.height - petSize.height - safeMargin * 2);

  return {
    x: workArea.x + safeMargin,
    y: workArea.y + safeMargin,
    width,
    height,
  };
}

export function edgePointAt(progress: number, bounds: RoamingRect): RoamingPoint {
  const width = Math.max(0, bounds.width);
  const height = Math.max(0, bounds.height);
  const perimeter = roamingPerimeter(bounds);
  const value = perimeter > 0 ? wrapProgress(progress, perimeter) : 0;

  if (width === 0 && height === 0) return { x: bounds.x, y: bounds.y };
  if (height === 0) return { x: bounds.x + oneDimensionalProgress(value, width), y: bounds.y };
  if (width === 0) return { x: bounds.x, y: bounds.y + oneDimensionalProgress(value, height) };
  if (value <= width) return { x: bounds.x + value, y: bounds.y };
  if (value <= width + height) return { x: bounds.x + width, y: bounds.y + value - width };
  if (value <= width * 2 + height) return { x: bounds.x + width - (value - width - height), y: bounds.y + height };
  return { x: bounds.x, y: bounds.y + height - (value - width * 2 - height) };
}

export function nearestEdgeProgress(position: RoamingPoint, bounds: RoamingRect): number {
  const width = Math.max(0, bounds.width);
  const height = Math.max(0, bounds.height);
  const right = bounds.x + width;
  const bottom = bounds.y + height;
  const clampedX = clamp(position.x, bounds.x, right);
  const clampedY = clamp(position.y, bounds.y, bottom);
  const candidates = [
    { progress: clampedX - bounds.x, point: { x: clampedX, y: bounds.y } },
    { progress: width + clampedY - bounds.y, point: { x: right, y: clampedY } },
    { progress: width + height + right - clampedX, point: { x: clampedX, y: bottom } },
    { progress: width * 2 + height + bottom - clampedY, point: { x: bounds.x, y: clampedY } },
  ];

  let nearest = candidates[0]!;
  let nearestDistance = squaredDistance(position, nearest.point);

  for (const candidate of candidates.slice(1)) {
    const distance = squaredDistance(position, candidate.point);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return wrapProgress(nearest.progress, roamingPerimeter(bounds));
}

export function isOnRoamingEdge(position: RoamingPoint, bounds: RoamingRect, tolerance = 0.01) {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const withinX = position.x >= bounds.x - tolerance && position.x <= right + tolerance;
  const withinY = position.y >= bounds.y - tolerance && position.y <= bottom + tolerance;
  const onHorizontal = withinX && (Math.abs(position.y - bounds.y) <= tolerance || Math.abs(position.y - bottom) <= tolerance);
  const onVertical = withinY && (Math.abs(position.x - bounds.x) <= tolerance || Math.abs(position.x - right) <= tolerance);
  return onHorizontal || onVertical;
}

function resolveConfig(config?: Partial<RoamingConfig>): RoamingConfig {
  return {
    ...defaultRoamingConfig,
    ...config,
  };
}

function roamingPerimeter(bounds: RoamingRect) {
  return Math.max(0, bounds.width) * 2 + Math.max(0, bounds.height) * 2;
}

function wrapProgress(value: number, perimeter: number) {
  if (perimeter <= 0) return 0;
  return ((value % perimeter) + perimeter) % perimeter;
}

function oneDimensionalProgress(value: number, length: number) {
  const safeLength = Math.max(0, length);
  return value <= safeLength ? value : safeLength * 2 - value;
}

function poseForDelta(deltaX: number, deltaY: number, direction: 1 | -1): RoamingPose {
  if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 0.01) {
    return deltaX > 0 ? "running-right" : "running-left";
  }

  if (Math.abs(deltaY) > 0.01) return "running";
  return direction > 0 ? "running-right" : "running-left";
}

function squaredDistance(a: RoamingPoint, b: RoamingPoint) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

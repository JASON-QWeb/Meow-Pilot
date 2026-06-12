import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceRoamingState,
  buildRoamingBounds,
  createRoamingState,
  edgePointAt,
  isOnRoamingEdge,
  type RoamingRect,
  type RoamingState,
} from "./petRoaming";

const workArea: RoamingRect = { x: 0, y: 0, width: 1000, height: 700 };
const petSize = { width: 120, height: 100 };
const config = { margin: 20, speedPxPerSecond: 200, maxStepMs: 50 };

test("buildRoamingBounds keeps the pet inside the work area", () => {
  const bounds = buildRoamingBounds(workArea, petSize, config.margin);

  assert.deepEqual(bounds, { x: 20, y: 20, width: 840, height: 560 });
  assert.equal(bounds.x + bounds.width + petSize.width + config.margin, workArea.width);
  assert.equal(bounds.y + bounds.height + petSize.height + config.margin, workArea.height);
});

test("roaming advances only on the edge track", () => {
  let nowMs = 0;
  let state = createRoamingState({
    position: { x: 420, y: 260 },
    petSize,
    workArea,
    nowMs,
    config,
  });
  const bounds = buildRoamingBounds(workArea, petSize, config.margin);

  for (let index = 0; index < 160; index += 1) {
    nowMs += 34;
    const frame = advanceRoamingState(state, { petSize, workArea, nowMs, config });
    state = frame.state;

    assert.equal(isOnRoamingEdge(frame.position, bounds), true);
    assert.equal(isInsideAvoidedCenter(frame.position, bounds), false);
  }
});

test("roaming pose follows horizontal and vertical movement", () => {
  const bounds = buildRoamingBounds(workArea, petSize, config.margin);
  const baseState: RoamingState = { progress: 0, direction: 1, lastTickMs: 0, pose: "running" };

  const movingRight = advanceRoamingState(baseState, { petSize, workArea, nowMs: 50, config });
  assert.equal(movingRight.pose, "running-right");

  const movingDown = advanceRoamingState({ ...baseState, progress: bounds.width + 4 }, { petSize, workArea, nowMs: 50, config });
  assert.equal(movingDown.pose, "running");

  const movingLeft = advanceRoamingState({ ...baseState, progress: bounds.width + bounds.height + 4 }, { petSize, workArea, nowMs: 50, config });
  assert.equal(movingLeft.pose, "running-left");
});

test("tiny work areas collapse to one safe point", () => {
  const tinyWorkArea = { x: 100, y: 80, width: 80, height: 70 };
  const bounds = buildRoamingBounds(tinyWorkArea, petSize, config.margin);
  const state = createRoamingState({ position: { x: 500, y: 500 }, petSize, workArea: tinyWorkArea, nowMs: 0, config });
  const frame = advanceRoamingState(state, { petSize, workArea: tinyWorkArea, nowMs: 50, config });

  assert.deepEqual(bounds, { x: 120, y: 100, width: 0, height: 0 });
  assert.deepEqual(edgePointAt(100, bounds), { x: 120, y: 100 });
  assert.deepEqual(frame.position, { x: 120, y: 100 });
});

test("one-dimensional edge tracks move back from the end point", () => {
  const flatBounds = { x: 10, y: 20, width: 100, height: 0 };

  assert.deepEqual(edgePointAt(25, flatBounds), { x: 35, y: 20 });
  assert.deepEqual(edgePointAt(115, flatBounds), { x: 95, y: 20 });
});

function isInsideAvoidedCenter(position: { x: number; y: number }, bounds: RoamingRect) {
  return position.x > bounds.x && position.x < bounds.x + bounds.width && position.y > bounds.y && position.y < bounds.y + bounds.height;
}

import test from "node:test";
import assert from "node:assert/strict";
import { ObservedMaximum } from "../src/heater/observed-max.js";
import type { DisplayFrame } from "../src/camera/module.js";

const number = (at: number, value: number): DisplayFrame =>
  ({ value, visible: true, light: "lit", observedAt: at, captureStartedAt: at - 50, purpose: "mirror" });
const dark = (at: number): DisplayFrame =>
  ({ value: null, visible: false, light: "dark", observedAt: at, captureStartedAt: at - 50, purpose: "mirror" });
const failed = (at: number): DisplayFrame =>
  ({ value: null, visible: false, light: "unknown", observedAt: at, captureStartedAt: at - 50, purpose: "mirror" });

test("requires two matching physical lit observations across a fresh blank", () => {
  const max = new ObservedMaximum();
  max.observe(number(1000, 45), 1000);
  max.observe(number(1200, 45), 1200);
  assert.equal(max.snapshot(1200).temperatureMax, null);
  max.observe(dark(1500), 1500);
  max.observe(number(2000, 45), 2000);
  assert.deepEqual(max.snapshot(2000), { temperatureMax: 45, temperatureMaxObservedAt: new Date(2000).toISOString(), temperatureMaxSelected: true });
  assert.equal(max.snapshot(8000).temperatureMaxSelected, true);
  assert.equal(max.snapshot(8001).temperatureMaxSelected, false);
  assert.equal(max.snapshot(302001).temperatureMax, null);
});

test("loss, mismatched values, stale frames and long gaps cannot create a target", () => {
  const max = new ObservedMaximum();
  max.observe(number(1000, 37), 1000);
  max.observe(failed(1300), 1300);
  max.observe(dark(1500), 1500);
  max.observe(number(2000, 37), 2000);
  assert.equal(max.snapshot(2000).temperatureMax, null);
  max.observe(dark(2400), 2400);
  max.observe(number(2700, 38), 2700);
  assert.equal(max.snapshot(2700).temperatureMax, null);
  max.observe(dark(2900), 2900);
  max.observe(number(8001, 38), 8001);
  assert.equal(max.snapshot(8001).temperatureMax, null);
  max.observe(dark(8100), 8100);
  max.observe(number(8200, 38), 12000);
  assert.equal(max.snapshot(12000).temperatureMax, null);
});


test("overlapping or repeated captures do not establish a maximum", () => {
  const max = new ObservedMaximum();
  max.observe(number(1000, 45), 1000);
  max.observe({ ...dark(1100), captureStartedAt: 990 }, 1100);
  max.observe(number(1200, 45), 1200);
  assert.equal(max.snapshot(1200).temperatureMax, null);
});

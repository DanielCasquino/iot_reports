import test from "node:test";
import assert from "node:assert/strict";
import { classifyPilot, HeaterObservation } from "../src/heater/state.js";

test("pilot requires calibration; low light is not proof of OFF or power failure", () => {
  const env = { COLOR_RED_REFERENCE: "80,10,10,100", COLOR_GREEN_REFERENCE: "10,80,10,100",
    COLOR_MAX_DISTANCE: "0.1", COLOR_DARK_MAX_CLEAR: "3" };
  assert.equal(classifyPilot("80,10,10,100", {}), "unknown");
  assert.equal(classifyPilot("80,10,10,100", env), "heating");
  assert.equal(classifyPilot("20,160,20,200", env), "ready");
  assert.equal(classifyPilot("1,1,1,2", env), "unlit");
  assert.equal(classifyPilot("40,40,40,100", env), "unknown");
  assert.equal(classifyPilot("unavailable", env), "unknown");
  assert.equal(classifyPilot("65536,0,0,100", env), "unknown");
  assert.equal(classifyPilot("80,10,10,100", { ...env, COLOR_GREEN_REFERENCE: env.COLOR_RED_REFERENCE }), "unknown");
});

test("a matching reference alone is enough to infer that state", () => {
  const redOnly = { COLOR_RED_REFERENCE: "80,10,10,100", COLOR_MAX_DISTANCE: "0.1" };
  assert.equal(classifyPilot("80,10,10,100", redOnly), "heating");
  assert.equal(classifyPilot("10,80,10,100", redOnly), "unknown");
  const greenOnly = { COLOR_GREEN_REFERENCE: "10,80,10,100", COLOR_MAX_DISTANCE: "0.1" };
  assert.equal(classifyPilot("10,80,10,100", greenOnly), "ready");
  assert.equal(classifyPilot("80,10,10,100", greenOnly), "unknown");
  // A reference without a tolerance still cannot classify.
  assert.equal(classifyPilot("80,10,10,100", { COLOR_RED_REFERENCE: "80,10,10,100" }), "unknown");
});

test("retained and expired telemetry cannot enable commands; OCR failure does not mean asleep", () => {
  const state = new HeaterObservation();
  const camera = { available: true, value: 48, observedAt: new Date(1000).toISOString() };
  state.update("heater/status", "online", true, 1000);
  state.update("heater/state/power", "true", true, 1000);
  assert.equal(state.snapshot(camera, 1000).online, false);
  state.update("heater/status", "online", false, 1000);
  state.update("heater/state/power", "true", false, 1000);
  assert.equal(state.snapshot(camera, 1000).power, true);
  assert.equal(state.snapshot(camera, 1000).display, "readable");
  assert.equal(state.snapshot({ ...camera, available: false, value: null }, 1000).display, "unreadable");
  assert.equal(state.snapshot(camera, 11001).online, false);
  assert.equal(state.snapshot(camera, 11001).temperature, null);
  state.disconnect();
  assert.equal(state.snapshot(camera, 1000).power, null);
});

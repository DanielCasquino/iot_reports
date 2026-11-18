import test from "node:test";
import assert from "node:assert/strict";
import { buildStatusResponse } from "../src/heater/status-response.js";

test("controller values are unavailable when offline while independent camera remains", () => {
  const input = { online: false, autoShutdown: true, flowrate: 4, volume: 42,
    temperatureControl: { base: 42, target: 42, status: "idle", locked: false, min: 30, max: 75,
      commandId: 2, result: "accepted", autoShutdownTarget: 42 }, camera: { value: 39 } };
  const offline = buildStatusResponse(input);
  assert.equal(offline.temperatureControl, null);
  assert.equal(offline.autoShutdownTarget, null);
  assert.equal(offline.flowrate, null);
  assert.equal(offline.camera.value, 39);
  const online = buildStatusResponse({ ...input, online: true });
  assert.equal(online.temperatureControl?.base, 42);
  assert.equal(online.autoShutdownTarget, 42);
});

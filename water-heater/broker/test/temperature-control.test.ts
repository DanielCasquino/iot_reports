import test from "node:test";
import assert from "node:assert/strict";
import { parseTemperatureControl } from "../src/heater/temperature-control.js";
test("only coherent controller snapshots establish the temperature lock and baseline", () => {
  const state = { base: 43, target: 46, status: "applying", locked: true, min: 30, max: 75, commandId: 1, result: "accepted" };
  assert.deepEqual(parseTemperatureControl(JSON.stringify(state)), state);
  for (const patch of [{ base: 76 }, { base: 43.5 }, { locked: false }, { commandId: -1 }, { max: 100 }, { status: "bad" }, { result: "ok" }])
    assert.equal(parseTemperatureControl(JSON.stringify({ ...state, ...patch })), null);
  assert.deepEqual(parseTemperatureControl(JSON.stringify({ ...state, base: -1 })), { ...state, base: -1 });
  assert.equal(parseTemperatureControl("null"), null);
  assert.equal(parseTemperatureControl("{"), null);
});


test("auto-off target is optional for old firmware and never accepts an invented threshold", () => {
  const state = { base: 50, target: 60, status: "idle", locked: false, min: 30, max: 75, commandId: 1, result: "accepted" };
  assert.ok(parseTemperatureControl(JSON.stringify(state)));
  for (const autoShutdownTarget of [-1, 30, 42, 60, 75])
    assert.equal(parseTemperatureControl(JSON.stringify({ ...state, autoShutdownTarget }))?.autoShutdownTarget, autoShutdownTarget);
  for (const autoShutdownTarget of [0, 29, 76, 40.5, "42", null])
    assert.equal(parseTemperatureControl(JSON.stringify({ ...state, autoShutdownTarget })), null);
});

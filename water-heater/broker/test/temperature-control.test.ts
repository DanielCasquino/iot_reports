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

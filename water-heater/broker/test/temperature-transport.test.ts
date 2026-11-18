import test from "node:test";
import assert from "node:assert/strict";
import { temperatureTransport } from "../src/heater/temperature-transport.js";

const control = { base: -1, target: 0, status: "idle", locked: false, min: 30, max: 75,
  commandId: 0, result: "none", temperatureV2Token: 123 };
test("QoS 1 is opt-in, capability gated, bounded by receipt age, and never retained", () => {
  assert.deepEqual(temperatureTransport("42,-1,45", control, 1000, 1100, false),
    { topic: "heater/set/temperature", payload: "42,-1,45", qos: 0 });
  assert.deepEqual(temperatureTransport("42,-1,45", null, 1000, 1100, true),
    { topic: "heater/set/temperature", payload: "42,-1,45", qos: 0 });
  assert.deepEqual(temperatureTransport("42,-1,45", control, 1000, 1100, true),
    { topic: "heater/set/temperature_v2", payload: "42,-1,45,123", qos: 1 });
  assert.equal(temperatureTransport("42,-1,45", control, 1000, 3500, true), null);
  assert.equal(temperatureTransport("42,-1,45", control, 1000, 999, true), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { pilotCommand } from "../src/heater/pilot-command.js";
import { classifyPilot } from "../src/heater/state.js";

const policy = { retained: false, sensorTestMode: false, brokerConnected: true, controllerOnline: true };
const env = { COLOR_RED_REFERENCE: "301,25,34,331", COLOR_GREEN_REFERENCE: "17,22,8,46",
  COLOR_MAX_DISTANCE: "0.07", COLOR_DARK_MAX_CLEAR: "7" };

test("fresh real telemetry forwards lit, unlit and unknown classifications without inferring power", () => {
  for (const [raw, expected] of [
    ["301,25,34,331", "heating"], ["17,22,8,46", "ready"],
    ["5,4,4,6", "unlit"], ["unavailable", "unknown"], ["malformed", "unknown"],
  ] as const) {
    assert.deepEqual(pilotCommand(classifyPilot(raw, env), policy), {
      topic: "heater/input/pilot", payload: expected, options: { qos: 0, retain: false },
    });
  }
});

test("repeated classifications produce a command for every fresh sample", () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(pilotCommand("unlit", policy)?.payload, "unlit");
  }
});

test("retained telemetry, probe mode and either offline connection suppress every pilot state", () => {
  for (const blocked of [
    { retained: true }, { sensorTestMode: true },
    { brokerConnected: false }, { controllerOnline: false },
  ]) {
    for (const pilot of ["heating", "ready", "unlit", "unknown"] as const) {
      assert.equal(pilotCommand(pilot, { ...policy, ...blocked }), null);
    }
  }
});

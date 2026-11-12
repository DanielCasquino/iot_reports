import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/websocket/command.js";

test("malformed or unexpected WebSocket input never crashes or becomes an actuator command", () => {
  for (const value of ["{", "null", "42", "[]", "{}", '{"event":"set_heater_power"}',
    '{"event":"set_heater_power","data":{"enabled":"false"}}',
    '{"event":"wake_display","data":{"enabled":true}}'])
    assert.equal(parseCommand(value), null, value);
  assert.deepEqual(parseCommand('{"event":"set_heater_power","data":{"enabled":false}}'),
    { topic: "heater/set/power", payload: "false" });
  assert.deepEqual(parseCommand('{"event":"set_auto_shutdown","data":{"enabled":true}}'),
    { topic: "heater/set/autoshutdown", payload: "true" });
});

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

test("temperature commands validate integer targets, baseline and request IDs", () => {
  assert.deepEqual(parseCommand(JSON.stringify({ event: "set_temperature", data: { target: 46, base: 43, requestId: 123 } })),
    { topic: "heater/set/temperature", payload: "123,43,46" });
  assert.deepEqual(parseCommand(JSON.stringify({ event: "sync_temperature_base", data: { target: 43, base: 46, requestId: 124 } })),
    { topic: "heater/set/temperature_base", payload: "124,46,43" });
  assert.deepEqual(parseCommand(JSON.stringify({ event: "sync_temperature_base", data: { target: 43, base: -1, requestId: 125 } })),
    { topic: "heater/set/temperature_base", payload: "125,-1,43" });
  assert.deepEqual(parseCommand(JSON.stringify({ event: "set_temperature", data: { target: 43, base: -1, requestId: 126 } })), { topic: "heater/set/temperature", payload: "126,-1,43" });
  for (const target of [29, 76, 43.5, "44", null])
    assert.equal(parseCommand(JSON.stringify({ event: "set_temperature", data: { target, base: 43, requestId: 1 } })), null);
  for (const data of [{ target: 44, base: 43 }, { target: 44, base: 0, requestId: 1 },
    { target: 44, base: 43, requestId: 0 }, { target: 44, base: 43, requestId: 4294967296 }])
    assert.equal(parseCommand(JSON.stringify({ event: "set_temperature", data })), null);
});


test("temperature control accepts the physical circular endpoints", () => {
  for (const [base, target] of [[30, 75], [75, 30]]) {
    assert.deepEqual(parseCommand(JSON.stringify({ event: "set_temperature", data: { base, target, requestId: 77 } })),
      { topic: "heater/set/temperature", payload: `77,${base},${target}` });
  }
});

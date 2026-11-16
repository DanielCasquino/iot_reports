import test from "node:test";
import assert from "node:assert/strict";
import { logServoSequence } from "../src/heater/control-log.js";

test("servo log distinguishes a PWM sequence from physical confirmation and rejects forged success", () => {
  const tap = { pin: 27, button: "plus", reason: "open_target", commandId: 42,
    estimatedBefore: -1, estimatedAfter: -1, target: 30, press: 16, rest: 0,
    startedAt: 0xfffffff0, completedAt: 484, mechanicalConfirmed: false };
  const entries: string[] = [];
  const previous = console.log;
  console.log = line => entries.push(line);
  try {
    assert.equal(logServoSequence(JSON.stringify(tap)), true);
    const logged = JSON.parse(entries[0]!);
    assert.equal(logged.event, "servo_sequence_sent");
    assert.equal(logged.mechanicalConfirmed, false);
    assert.equal(logged.commandId, 42);
    assert.equal(logged.reason, "open_target");
    assert.ok(Number.isFinite(Date.parse(logged.at)));
    for (const invalid of [{ ...tap, mechanicalConfirmed: true }, { ...tap, pin: 26 },
      { ...tap, pin: "27" }, { ...tap, reason: "physical_success" }, { ...tap, press: 999 }])
      assert.equal(logServoSequence(JSON.stringify(invalid)), false);
    assert.equal(logServoSequence("not JSON"), false);
    assert.equal(entries.length, 1);
    assert.equal(logServoSequence(JSON.stringify({ ...tap, pin: 25, button: "power", reason: "auto_shutdown_at_target", target: 42 })), true);
    assert.equal(JSON.parse(entries[1]!).reason, "auto_shutdown_at_target");
  } finally { console.log = previous; }
});

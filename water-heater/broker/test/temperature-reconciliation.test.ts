import test from "node:test";
import assert from "node:assert/strict";
import { TemperatureReconciliation } from "../src/heater/temperature-reconciliation.js";
const idle = { base: -1, target: 0, status: "idle", locked: false, min: 30, max: 75, commandId: 0, result: "none" };
test("startup waits for fresh connection and display; confirmation compares setpoint rather than water", () => {
  const r = new TemperatureReconciliation(); r.request(44, undefined, 0);
  assert.equal(r.poll(idle, false, true, 1), null);
  assert.equal(r.poll(idle, true, false, 2), null);
  const command = r.poll(idle, true, true, 3)!; assert.equal(command.target, 44);
  assert.equal(r.poll({ ...idle, commandId: command.id, base: 43 }, true, true, 4), null);
  assert.equal(r.poll({ ...idle, commandId: command.id, base: 44 }, true, true, 5), null);
  assert.equal(r.snapshot().status, "confirmed");
});
test("three bounded attempts, no overlapping commands, user can start again", () => {
  const r = new TemperatureReconciliation(); r.request(44, undefined, 0);
  for (let i = 0; i < 3; i++) {
    const command = r.poll(idle, true, true, i * 10000)!; assert.ok(command);
    assert.equal(r.poll(idle, true, true, i * 10000 + 1), null);
    r.poll({ ...idle, commandId: command.id, status: "error", locked: true }, true, true, i * 10000 + 2);
  }
  assert.equal(r.poll(idle, true, true, 40000), null);
  assert.equal(r.snapshot().status, "failed");
  r.request(45, undefined, 50000); assert.equal(r.poll(idle, true, true, 50000)?.target, 45);
});

test("unavailable telemetry eventually fails instead of waiting forever; an explicit retry resets the deadline", () => {
  const r = new TemperatureReconciliation(); r.request(44, undefined, 0);
  assert.equal(r.poll(null, false, false, 90000), null);
  assert.equal(r.snapshot().status, "failed");
  r.request(44, undefined, 91000);
  assert.ok(r.poll(idle, true, true, 91001));
});

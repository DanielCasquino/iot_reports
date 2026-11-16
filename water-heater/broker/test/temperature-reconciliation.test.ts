import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
test("three bounded reconnect attempts, no overlapping commands, user can start again", () => {
  const r = new TemperatureReconciliation(); r.request(44, undefined, 0);
  for (let i = 0; i < 3; i++) {
    const command = r.poll(idle, true, true, i * 10000)!; assert.ok(command);
    assert.equal(r.poll(idle, true, true, i * 10000 + 1), null);
    r.poll(idle, false, false, i * 10000 + 2);
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

function storage(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "heater-temperature-operation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, file: join(directory, "temperature-operation.json") };
}

test("failed operation survives restarts without another three attempts; explicit request resets it", t => {
  const { file } = storage(t);
  const r = new TemperatureReconciliation(file);
  r.request(44, undefined, 1000);
  const command = r.poll(idle, true, true, 1001)!;
  assert.ok(command);
  r.poll({ ...idle, commandId: command.id, status: "error", locked: true }, true, true, 1002);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    target: 44, attempts: 1, requestedAt: 1000, completed: false, failed: true,
  });
  for (let i = 0; i < 3; i++) {
    const restarted = new TemperatureReconciliation(file);
    assert.equal(restarted.poll(idle, true, true, 40000 + i), null);
    assert.deepEqual(restarted.snapshot(), { target: 44, attempts: 1, status: "failed" });
  }
  const restarted = new TemperatureReconciliation(file);
  restarted.request(44, undefined, 100000);
  assert.deepEqual(restarted.snapshot(), { target: 44, attempts: 0, status: "waiting" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    target: 44, attempts: 0, requestedAt: 100000, completed: false, failed: false,
  });
  assert.ok(restarted.poll(idle, true, true, 100001));
});

test("in-flight restart drops the pending ID but preserves attempt budget and original deadline", t => {
  const { file } = storage(t);
  const r = new TemperatureReconciliation(file);
  r.request(44, 123, 1000);
  const restarted = new TemperatureReconciliation(file);
  assert.deepEqual(restarted.snapshot(), { target: 44, attempts: 1, status: "waiting" });
  assert.equal(restarted.poll(idle, false, true, 2000), null);
  assert.equal(restarted.poll({ ...idle, locked: true, status: "applying" }, true, true, 2001), null);
  const retry = restarted.poll(idle, true, true, 3000)!;
  assert.ok(retry);
  assert.notEqual(retry.id, 123);
  assert.equal(restarted.snapshot().attempts, 2);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).requestedAt, 1000);
  const expired = new TemperatureReconciliation(file);
  assert.equal(expired.poll(idle, true, true, 91000), null);
  assert.equal(expired.snapshot().status, "failed");
  assert.equal(new TemperatureReconciliation(file).poll(idle, true, true, 92000), null);
});

test("restored completion permits the existing reconnect reconfirmation", t => {
  const { file } = storage(t);
  const r = new TemperatureReconciliation(file);
  r.request(44, undefined, 1000);
  const command = r.poll(idle, true, true, 1001)!;
  r.poll({ ...idle, commandId: command.id, base: 44 }, true, true, 1002);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).completed, true);
  const restarted = new TemperatureReconciliation(file);
  assert.equal(restarted.snapshot().status, "confirmed");
  assert.equal(restarted.poll(idle, false, true, 100000), null);
  const confirm = restarted.poll({ ...idle, base: 44 }, true, true, 100001)!;
  assert.ok(confirm);
  assert.equal(confirm.target, 44);
  assert.equal(restarted.snapshot().attempts, 1);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).requestedAt, 100001);
});

test("missing or malformed storage is not overwritten by loading or unchanged polling", t => {
  const { directory, file } = storage(t);
  const empty = new TemperatureReconciliation(file);
  assert.equal(empty.poll(null, false, false, 1000), null);
  assert.equal(existsSync(file), false);
  for (const source of ["{", "null", "[]", "{}", JSON.stringify({
    target: 44, attempts: 4, requestedAt: 1000, completed: false, failed: true,
  })]) {
    writeFileSync(file, source);
    const restored = new TemperatureReconciliation(file);
    assert.deepEqual(restored.snapshot(), { target: null, attempts: 0, status: "waiting" });
    assert.equal(restored.poll(null, false, false, 1000), null);
    assert.equal(readFileSync(file, "utf8"), source);
  }
  const valid = new TemperatureReconciliation(file);
  valid.request(45, undefined, 2000);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).target, 45);
  const before = statSync(file, { bigint: true }).ino;
  valid.poll(null, false, false, 2001);
  valid.poll(null, false, false, 2002);
  assert.equal(statSync(file, { bigint: true }).ino, before);
  assert.deepEqual(readdirSync(directory), ["temperature-operation.json"]);
});


test("a verified controller error stops after one physical operation until an explicit user request", () => {
  const r = new TemperatureReconciliation(); r.request(50, 123, 1000);
  r.poll({ ...idle, commandId: 123, status: "error", locked: true }, true, true, 1100);
  assert.deepEqual(r.snapshot(), { target: 50, attempts: 1, status: "failed" });
  for (let now = 1200; now < 30000; now += 1000) assert.equal(r.poll(idle, true, true, now), null);
  r.poll(idle, false, false, 30000);
  assert.equal(r.poll(idle, true, true, 31000), null);
  r.request(50, undefined, 32000);
  assert.equal(r.poll(idle, true, true, 32001)?.target, 50);
});

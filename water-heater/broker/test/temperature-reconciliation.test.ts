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
test("disconnect stops an in-flight operation; a new request can try again", () => {
  const r = new TemperatureReconciliation(); r.request(44, undefined, 0);
  assert.ok(r.poll(idle, true, true, 1));
  assert.equal(r.poll(idle, true, true, 2), null);
  assert.equal(r.poll(idle, false, false, 3), null);
  assert.equal(r.poll(idle, true, true, 4), null);
  assert.deepEqual(r.snapshot(), { target: 44, attempts: 1, status: "failed" });
  r.request(45, undefined, 50000); assert.equal(r.poll(idle, true, true, 50000)?.target, 45);
});

test("a verified target completes during settling; an estimate or stale acknowledgement cannot complete it", () => {
  const r = new TemperatureReconciliation(); r.request(44, 21, 1000);
  const control = { ...idle, base: 44, target: 44, commandId: 21, locked: true, result: "accepted" };
  r.poll({ ...control, status: "verifying" }, true, false, 2000);
  r.poll({ ...control, status: "settling", commandId: 20 }, true, false, 2001);
  r.poll({ ...control, status: "settling", target: 43 }, true, false, 2002);
  assert.equal(r.snapshot().status, "verifying");
  r.poll({ ...control, status: "settling" }, true, false, 2003);
  assert.deepEqual(r.snapshot(), { target: 44, attempts: 1, status: "confirmed" });
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
  for (let i = 0; i < 3; i++) {
    const command = r.poll(idle, true, true, 1000 + i * 10000)!;
    assert.ok(command);
    r.poll({ ...idle, commandId: command.id, status: "error", locked: true }, true, true, 1002 + i * 10000);
  }
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    target: 44, attempts: 3, requestedAt: 1000, completed: false, failed: true,
  });
  for (let i = 0; i < 3; i++) {
    const restarted = new TemperatureReconciliation(file);
    assert.equal(restarted.poll(idle, true, true, 40000 + i), null);
    assert.deepEqual(restarted.snapshot(), { target: 44, attempts: 3, status: "failed" });
  }
  const restarted = new TemperatureReconciliation(file);
  restarted.request(44, undefined, 100000);
  assert.deepEqual(restarted.snapshot(), { target: 44, attempts: 0, status: "waiting" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    target: 44, attempts: 0, requestedAt: 100000, completed: false, failed: false,
  });
  assert.ok(restarted.poll(idle, true, true, 100001));
});

test("an in-flight restart keeps the desired target but never replays it", t => {
  const { file } = storage(t);
  const r = new TemperatureReconciliation(file);
  r.request(44, 123, 1000);
  const restarted = new TemperatureReconciliation(file);
  assert.deepEqual(restarted.snapshot(), { target: 44, attempts: 1, status: "failed" });
  assert.equal(restarted.poll(idle, false, true, 2000), null);
  assert.equal(restarted.poll(idle, true, true, 3000), null);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    target: 44, attempts: 1, requestedAt: 1000, completed: false, failed: true,
  });
});

test("a historical completion stays quiet even if a reboot loses the controller base", t => {
  const { file } = storage(t);
  const r = new TemperatureReconciliation(file);
  r.request(44, undefined, 1000);
  const command = r.poll(idle, true, true, 1001)!;
  r.poll({ ...idle, commandId: command.id, base: 44 }, true, true, 1002);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).completed, true);
  const restarted = new TemperatureReconciliation(file);
  assert.equal(restarted.poll(idle, false, false, 100003), null);
  assert.equal(restarted.poll(idle, true, true, 100004), null);
  assert.equal(restarted.snapshot().status, "confirmed");
  restarted.request(44, undefined, 100005);
  assert.equal(restarted.poll(idle, true, true, 100006)?.target, 44);
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


test("missed presses permit three fresh operations, never overlap, then require manual recovery", () => {
  const r = new TemperatureReconciliation(); r.request(50, 123, 1000);
  let id = 123;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const now = 1000 + attempt * 10000;
    r.poll({ ...idle, commandId: id, status: "error", locked: true }, true, true, now);
    assert.equal(r.poll({ ...idle, status: "settling", locked: true }, true, true, now + 1), null);
    assert.equal(r.poll(idle, true, false, now + 2), null);
    if (attempt < 3) {
      const next = r.poll(idle, true, true, now + 3)!;
      assert.ok(next); assert.notEqual(next.id, id); assert.equal(next.base, -1);
      id = next.id;
    }
  }
  assert.deepEqual(r.snapshot(), { target: 50, attempts: 3, status: "failed" });
  for (let now = 40000; now < 60000; now += 1000) assert.equal(r.poll(idle, true, true, now), null);
  r.request(50, undefined, 62000);
  assert.equal(r.poll(idle, true, true, 62001)?.target, 50);
});

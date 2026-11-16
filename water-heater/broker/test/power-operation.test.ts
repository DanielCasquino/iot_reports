import test from "node:test";
import assert from "node:assert/strict";
import { PowerOperation } from "../src/heater/power-operation.js";

test("unknown, busy or cached observations never cause another power tap", () => {
  const operation = new PowerOperation(); operation.request(false, 0);
  for (let at = 15000; at < 30000; at += 1000) {
    assert.equal(operation.poll(true, true, null, { power: null, observedAt: null }, at), null);
    assert.equal(operation.poll(true, false, true, { power: true, observedAt: at }, at), null);
    assert.equal(operation.poll(true, true, true, { power: true, observedAt: 15000 }, at), null);
  }
  assert.equal(operation.snapshot().attempts, 1);
});

test("a missed power press gets at most three absolute requests with new opposite-state evidence", () => {
  const operation = new PowerOperation(); operation.request(false, 0);
  let sentAt = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (let elapsed = 15000; elapsed < 18000; elapsed += 1000)
      assert.equal(operation.poll(true, true, true, { power: true, observedAt: sentAt + elapsed }, sentAt + elapsed), null);
    const retry = operation.poll(true, true, true, { power: true, observedAt: sentAt + 18000 }, sentAt + 18000);
    if (attempt < 3) assert.deepEqual(retry, { power: false });
    else { assert.equal(retry, null); assert.equal(operation.snapshot().status, "failed"); }
    sentAt += 18000;
  }
  assert.equal(operation.snapshot().attempts, 3);
  assert.equal(operation.poll(true, true, true, { power: true, observedAt: 55000 }, 55000), null);
});

test("matching optical/controller feedback completes; disconnect and deadline never replay", () => {
  const operation = new PowerOperation(); operation.request(true, 1000);
  operation.poll(true, true, true, { power: true, observedAt: 2000 }, 2000);
  assert.equal(operation.snapshot().status, "confirmed");
  operation.request(false, 3000); operation.disconnect();
  assert.equal(operation.poll(true, true, true, { power: true, observedAt: 25000 }, 25000), null);
  assert.equal(operation.snapshot().status, "failed");
  operation.request(false, 30000);
  operation.poll(true, true, null, { power: null, observedAt: null }, 120000);
  assert.equal(operation.snapshot().status, "failed");
});

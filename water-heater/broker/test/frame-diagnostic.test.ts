import test from "node:test";
import assert from "node:assert/strict";
import { FrameDiagnostic } from "../src/camera/frame-diagnostic.js";

test("frame diagnostic suppresses blink transitions and emits a sustained crop change", () => {
  const d = new FrameDiagnostic();
  const lit = { crop: "primary" as const, light: "lit" as const, visible: true, readable: true,
    brightness: 245, observedAt: 1, rejectedValue: null };
  const dark = { ...lit, light: "dark" as const, visible: false, readable: false };
  assert.equal(d.observe(lit, 0), null);
  assert.equal(d.observe(dark, 2000), null);
  assert.equal(d.observe(lit, 4000), null);
  assert.equal(d.observe(lit, 8999), null);
  assert.deepEqual(d.observe(lit, 9000), lit);
  assert.equal(d.observe({ ...lit, brightness: 240 }, 15000), null);
  const guard = { ...lit, crop: "guard" as const, readable: false };
  assert.equal(d.observe(guard, 16000), null);
  assert.deepEqual(d.observe(guard, 21000), guard);
  assert.equal(d.snapshot()?.crop, "guard");
});

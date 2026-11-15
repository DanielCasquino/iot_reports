import test from "node:test";
import assert from "node:assert/strict";
import { HeaterPanelState } from "../src/heater/panel-state.js";

const frame = (value: number | null, observedAt: number, visible = true,
  purpose: "water" | "target" | "mirror" = "mirror") => ({ value, observedAt, visible, purpose });

test("buttons follow joint heater and display state, not pilot darkness", () => {
  const panel = new HeaterPanelState(0);
  panel.observeMode("off", null, 0);
  assert.equal(panel.buttonEffect("power"), "power_on");
  assert.equal(panel.buttonEffect("plus"), "unknown");
  panel.observeMode("standby", 47, 1);
  assert.equal(panel.snapshot(1).power, true);
  for (const button of ["power", "plus", "minus"] as const) assert.equal(panel.buttonEffect(button), "wake");
  panel.observeMode("water", 47, 2);
  assert.equal(panel.buttonEffect("plus"), "show_target");
  assert.equal(panel.buttonEffect("minus"), "show_target");
  assert.equal(panel.buttonEffect("power"), "power_off");
  panel.observeMode("target", 43, 3);
  assert.equal(panel.buttonEffect("plus"), "increase");
  assert.equal(panel.buttonEffect("minus"), "decrease");
  assert.equal(panel.snapshot(3).water, 47);
  assert.equal(panel.snapshot(3).target, 43);
  assert.equal(panel.snapshot(3).waterFresh, false);
});

test("unreadable frames and blank blink phases never prove OFF", () => {
  const panel = new HeaterPanelState(0);
  panel.observeMode("water", 47, 0);
  panel.observeFrame(frame(null, 100, false), true);
  assert.equal(panel.snapshot(100).power, true);
  assert.equal(panel.snapshot(100).mode, "water");
  assert.equal(panel.tick(1000, true), null);
  panel.observeFrame(frame(43, 1100, true, "target"), true);
  assert.equal(panel.snapshot(1100).mode, "target");
  assert.equal(panel.snapshot(1100).water, 47);
});

test("automatic recovery taps plus once, waits six seconds, then asks for fresh water", () => {
  const panel = new HeaterPanelState(0);
  panel.observeMode("water", 47, 0);
  panel.observeFrame(frame(null, 100), true);
  panel.observeFrame(frame(null, 6100), true);
  assert.equal(panel.tick(6100, false), null);
  assert.equal(panel.tick(6100, true), "press_plus");
  assert.equal(panel.tick(12100 - 1, true), null);
  assert.equal(panel.tick(12100, true), "capture_water");
  panel.observeFrame(frame(47, 12200, true, "water"), true);
  assert.equal(panel.snapshot(12200).recovery, "idle");
  assert.equal(panel.snapshot(12200).water, 47);
  assert.equal(panel.tick(12200, true), null);
});

test("recovery never starts on stale frames, an OFF panel or during a blink window", () => {
  const stale = new HeaterPanelState(0);
  stale.observeFrame(frame(null, 0), true);
  assert.equal(stale.tick(3001, true), null);
  const off = new HeaterPanelState(0);
  off.observeFrame(frame(null, 0), true);
  off.observeFrame(frame(null, 3100), true);
  off.observeMode("off", null, 3100);
  assert.equal(off.tick(3100, true), null);
  const blinking = new HeaterPanelState(0);
  blinking.observeFrame(frame(null, 0), true);
  blinking.observeFrame(frame(null, 2000, false), true);
  blinking.observeFrame(frame(null, 3100), true);
  assert.equal(blinking.tick(3100, true), null);
});

test("limited recovery attempts end in a recoverable failure without repeated button presses", () => {
  const panel = new HeaterPanelState(0);
  panel.observeMode("water", 47, 0);
  panel.observeFrame(frame(null, 0), true);
  for (const start of [6000, 66000, 126000]) {
    panel.observeFrame(frame(null, start), true);
    assert.equal(panel.tick(start, true), "press_plus");
    assert.equal(panel.tick(start + 5999, true), null);
    assert.equal(panel.tick(start + 6000, true), "capture_water");
    assert.equal(panel.tick(start + 16000, true), "failed");
  }
  assert.equal(panel.snapshot(140000).recovery, "failed");
  panel.observeFrame(frame(null, 200000), true);
  assert.equal(panel.tick(200000, true), null);
  panel.observeFrame(frame(47, 200001, true, "water"), true);
  assert.equal(panel.snapshot(200001).recovery, "idle");
  assert.equal(panel.snapshot(200001).attempts, 0);
});

test("disconnect cancels delayed recovery without replenishing its retry budget", () => {
  const panel = new HeaterPanelState(0);
  panel.observeMode("water", 47, 0);
  panel.observeFrame(frame(null, 0), true);
  panel.observeFrame(frame(null, 6000), true);
  assert.equal(panel.tick(6000, true), "press_plus");
  panel.disconnect();
  assert.equal(panel.snapshot(12000).power, null);
  assert.equal(panel.snapshot(12000).fresh, false);
  assert.equal(panel.snapshot(12000).waterFresh, false);
  assert.equal(panel.snapshot(12000).attempts, 1);
  assert.equal(panel.tick(12000, true), null);
  panel.observeFrame(frame(47, 12001, true, "water"), true);
  assert.equal(panel.snapshot(12001).waterFresh, true);
  assert.equal(panel.snapshot(12001).attempts, 0);
});

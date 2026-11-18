import test from "node:test";
import assert from "node:assert/strict";
import { DisplayPowerObservation } from "../src/heater/display-power.js";
import type { DisplayFrame } from "../src/camera/module.js";

const dark = (at: number): DisplayFrame => ({ value: null, visible: false, light: "dark", brightness: 16,
  observedAt: at, captureStartedAt: at, purpose: "mirror" });

test("GREEN to dim/unlit enters standby and startup can recover the calibrated dim state", () => {
  const observation = new DisplayPowerObservation();
  observation.observe({ ...dark(0), value: 60, visible: true, light: "lit", brightness: 244 }, true, "ready", 0);
  for (const at of [1000, 2000]) observation.observe({ ...dark(at), value: 59, visible: true, light: "lit", brightness: 145 }, true, "unlit", at);
  assert.equal(observation.snapshot(2000).mode, "standby");
  assert.equal(observation.snapshot(2000).power, true);
  observation.reset(3000);
  for (const at of [3000, 4000]) observation.observe({ ...dark(at), visible: true, light: "lit", brightness: 145 }, true, "unlit", at);
  assert.equal(observation.snapshot(4000).mode, "standby");
  for (const at of [5000, 6000]) observation.observe({ ...dark(at), value: 59, visible: true, light: "lit", brightness: 145 }, true, "heating", at);
  assert.equal(observation.snapshot(6000).mode, "on");
});

test("OFF needs a continuous window longer than the full blink train and multiple fresh captures", () => {
  const observation = new DisplayPowerObservation();
  for (const at of [0, 1000, 2000, 3000, 4000, 5000, 6000]) {
    observation.observe(dark(at), true, "unlit", at);
    assert.equal(observation.snapshot(at).power, null);
  }
  observation.observe(dark(6500), true, "unlit", 6500);
  assert.equal(observation.snapshot(6500).power, false);
  assert.equal(observation.snapshot(6500).display, "off");
  assert.equal(observation.snapshot(9501).power, null);
});

test("dim segments establish ON without inventing a water temperature", () => {
  const observation = new DisplayPowerObservation();
  for (const at of [0, 1000]) observation.observe({ ...dark(at), visible: true, light: "lit", brightness: 88 }, true, "unknown", at);
  assert.equal(observation.snapshot(1000).power, true);
  assert.equal(observation.snapshot(1000).display, "dim");
});

test("lit phases and intermediate brightness interrupt OFF; five-second blinking stays ON/unknown", () => {
  const observation = new DisplayPowerObservation();
  for (let at = 0; at <= 12000; at += 250) {
    const visible = at % 1000 >= 500;
    observation.observe({ ...dark(at), visible, light: visible ? "lit" : "dark", value: visible ? 51 : null }, true, "unknown", at);
    assert.notEqual(observation.snapshot(at).power, false);
  }
  observation.reset(13000);
  for (let at = 13000; at <= 20000; at += 1000)
    observation.observe({ ...dark(at), light: at === 17000 ? "unknown" : "dark" }, true, "unknown", at);
  assert.notEqual(observation.snapshot(20000).power, false);
});

test("capture gaps, failed captures, lit RGB, selection and stale requests cannot confirm OFF", () => {
  for (const interrupt of ["gap", "failure", "pilot", "target", "busy", "command"] as const) {
    const observation = new DisplayPowerObservation();
    for (let at = 0; at <= 4000; at += 1000) observation.observe(dark(at), true, "unlit", at);
    if (interrupt === "command") observation.reset(11000);
    if (interrupt === "gap") observation.observe(dark(9000), true, "unlit", 9000);
    else observation.observe({ ...dark(5000), light: interrupt === "failure" ? "unknown" : "dark",
      purpose: interrupt === "target" ? "target" : "mirror" }, interrupt !== "busy", interrupt === "pilot" ? "ready" : "unlit", 5000);
    observation.observe(dark(10000), true, "unlit", 10000);
    assert.equal(observation.snapshot(10000).power, null, interrupt);
  }
  const observation = new DisplayPowerObservation();
  observation.reset(6000);
  observation.observe({ ...dark(7000), captureStartedAt: 5000, value: 51 }, true, "unlit", 7000);
  observation.observe(dark(20000), true, "unlit", 24000); // Too old.
  observation.observe(dark(30000), true, "unlit", 29000); // Future.
  assert.equal(observation.snapshot(30000).power, null);
});

test("glare after confirmed OFF exposes bounded history while control still requires fresh evidence", () => {
  const observation = new DisplayPowerObservation();
  for (let at = 0; at <= 7000; at += 1000) observation.observe(dark(at), true, "unknown", at);
  const glare = (at: number) => ({ ...dark(at), light: "unknown" as const, daylightGlare: true });
  for (let at = 8000; at <= 11000; at += 1000) observation.observe(glare(at), true, "unknown", at);
  assert.equal(observation.snapshot(11000).lastConfirmedOff, true);
  assert.equal(observation.snapshot(11000).power, null);
  assert.equal(observation.snapshot(14001).lastConfirmedOff, false);
  observation.observe(glare(68000), true, "unknown", 68000);
  assert.equal(observation.snapshot(68000).lastConfirmedOff, false);
  observation.reset();
  assert.equal(observation.snapshot().lastConfirmedOff, false);
});

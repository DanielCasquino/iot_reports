import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseTemperatureControl } from "../src/heater/temperature-control.js";

const html = readFileSync(new URL("../../front/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)]
  .map(([, file]) => ({ file, code: readFileSync(new URL(`../../front/${file}`, import.meta.url), "utf8") }));
const idle = { base: 43, target: 0, status: "idle", locked: false,
  min: 30, max: 75, commandId: 0, result: "none" };

function front() {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1]!, {
    textContent: "", value: "", disabled: false, hidden: false, checked: false,
    style: { opacity: 0 }, className: "", title: "", open: false,
    setAttribute() {}, reportValidity: () => true,
  }]));
  const sent: unknown[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  const socketListeners = new Map<string, (data?: unknown) => void>();
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    addEventListener(event: string, callback: (data?: unknown) => void) { socketListeners.set(event, callback); }
    send(value: string) { sent.push(JSON.parse(value)); }
    close() { socketListeners.get("close")?.(); }
  }
  const context = vm.createContext({
    location: { protocol: "http:", hostname: "localhost" },
    document: { getElementById: (id: string) => elements.get(id), activeElement: null,
      querySelector: () => ({ open: false }) },
    window: { addEventListener() {} }, WebSocket: Socket,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {} },
    crypto: { getRandomValues: (values: Uint32Array) => { values[0] = 123; return values; } },
    console: { log() {}, debug() {}, error() {} },
    setTimeout: (callback: () => void, ms: number) => { timers.push({ callback, ms }); return timers.length; },
    AbortSignal, fetch: async () => { throw new Error("No external services"); },
  });
  for (const { file, code } of scripts) vm.runInContext(code, context, { filename: file });
  const run = (code: string) => vm.runInContext(code, context);
  run("connect(); updateBrokerStatus(true)");
  const message = (event: string, data: unknown) => run(`handleMessage(${JSON.stringify({ event, data })})`);
  const mqtt = (topic: string, payload: string) => message("mqtt_message", { topic, payload });
  const snapshot = (patch: Record<string, unknown> = {}) => message("state_snapshot", {
    status: "online", power: true, temperature: 37, temperatureControl: idle,
    desired: { power: true, temperature: 44 }, reconciliation: { target: 44, attempts: 0, status: "waiting" },
    flowrate: 2, volume: 3, ...patch,
  });
  return { elements, sent, timers, run, message, mqtt, snapshot,
    poll: async (state: unknown) => {
      context.fetch = async () => ({ ok: true, json: async () => state });
      await run("refreshObservation()");
    }, disconnect: () => socketListeners.get("close")?.() };
}

test("persisted desired target remains distinct from measured temperature and observed setpoint", () => {
  const f = front(); f.snapshot();
  assert.equal(f.elements.get("target-temperature")!.textContent, "44°C");
  assert.equal(f.elements.get("temp-display")!.textContent, "37.0°C");
  f.run("changeTarget(1)");
  f.snapshot({ desired: { power: true, temperature: 46 } });
  assert.equal(f.elements.get("target-temperature")!.textContent, "45°C");
  assert.equal(f.sent.length, 0);
});

test("raw visor MQTT cannot overwrite a validated or unavailable backend temperature", () => {
  const f = front(); f.snapshot({ temperature: null, temperatureControl: { ...idle, status: "settling", locked: true } });
  f.mqtt("heater/state/temperature", "75");
  assert.equal(f.elements.get("temp-display")!.textContent, "--.-°C");
  f.snapshot({ temperature: 0 });
  f.mqtt("heater/state/temperature", "99");
  assert.equal(f.elements.get("temp-display")!.textContent, "0.0°C");
  f.mqtt("heater/state/temperature", "unavailable");
  assert.equal(f.elements.get("temp-display")!.textContent, "0.0°C");
  assert.equal(f.run("heaterState.waterTemperature"), null);
});

test("failed readings retain the last valid display through unit changes and disconnects", () => {
  const f = front();
  f.snapshot({ temperature: 31 });
  f.snapshot({ temperature: null });
  assert.equal(f.elements.get("temp-display")!.textContent, "31.0°C");
  assert.match(f.elements.get("temp-display")!.title, /not current/);
  assert.equal(f.run("heaterState.waterTemperature"), null);
  f.run("toggleFahrenheit({ checked: true })");
  assert.equal(f.elements.get("temp-display")!.textContent, "87.8°F");
  f.disconnect();
  assert.equal(f.elements.get("temp-display")!.textContent, "87.8°F");
  assert.equal(f.elements.get("big-button")!.disabled, true);
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
  f.run("updateBrokerStatus(true)");
  f.snapshot({ temperature: 32 });
  assert.equal(f.elements.get("temp-display")!.textContent, "89.6°F");
  assert.equal(f.elements.get("temp-display")!.title, "Current temperature reading");
  assert.equal(f.sent.length, 0);
});

test("confirmed OFF labels the last water reading as historical", () => {
  const f = front(); f.snapshot({ temperature: 39 });
  assert.equal(f.elements.get("temperature-status")!.hidden, true);
  f.mqtt("heater/state/power", "false");
  f.snapshot({ power: false, temperature: 42 });
  assert.equal(f.elements.get("temp-display")!.textContent, "39.0°C");
  assert.equal(f.elements.get("temperature-status")!.textContent, "Last reading · heater off");
  assert.equal(f.elements.get("temperature-status")!.hidden, false);
});

test("actuator controls explain their lock while the local unit selector stays available", () => {
  const f = front();
  f.snapshot({ temperatureControl: { ...idle, status: "applying", locked: true } });
  assert.ok(f.elements.get("automated-shutdown")!.disabled);
  assert.ok(f.elements.get("big-button")!.disabled);
  assert.ok(f.elements.get("save-temperature")!.disabled);
  assert.equal(f.elements.get("fahrenheit")!.disabled, false);
  assert.match(f.elements.get("auto-shutdown-status")!.textContent, /Temperature adjustment in progress/);
  f.snapshot();
  assert.equal(f.elements.get("automated-shutdown")!.disabled, false);
});

test("the auto-off switch waits for the controller rather than changing optimistically", () => {
  const f = front(); f.snapshot({ autoShutdown: false });
  const toggle = f.elements.get("automated-shutdown")!;
  toggle.checked = true;
  f.run('toggleAutomatedShutdown(document.getElementById("automated-shutdown"))');
  assert.deepEqual(f.sent, [{ event: "set_auto_shutdown", data: { enabled: true } }]);
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, true);
  assert.match(f.elements.get("auto-shutdown-status")!.textContent, /Confirming auto-off/);
  f.snapshot({ autoShutdown: false });
  assert.equal(toggle.disabled, true);
  f.mqtt("heater/state/autoshutdown", "true");
  assert.equal(toggle.checked, true);
  assert.equal(toggle.disabled, false);
  assert.match(f.elements.get("auto-shutdown-status")!.textContent, /No auto-off target/);
});

test("camera diagnostics follow capture connectivity through unreadable, offline and recovered states", async () => {
  const f = front();
  const icon = f.elements.get("camera-indicator")!;
  assert.match(html, /<summary id="camera-indicator" class="icon-wrapper icon-wrapper-off"/);
  f.snapshot({ power: false, camera: { connected: true, available: false, value: null } });
  assert.match(icon.className, /icon-wrapper-on/);
  f.snapshot({ camera: { connected: false, available: false, lastValue: 39 } });
  assert.match(icon.className, /icon-wrapper-off/);
  f.disconnect();
  await f.poll({ online: false, camera: { connected: true, available: false } });
  assert.match(icon.className, /icon-wrapper-on/);
  assert.match(icon.title, /Camera connected.*diagnostics/);
});

test("Wi-Fi shows the live connection even when HTTP is available separately", async () => {
  const f = front();
  assert.match(f.elements.get("broker-status")!.className, /icon-wrapper-on/);
  f.disconnect();
  await f.poll({ online: true, power: false, camera: { available: false, value: null } });
  assert.match(f.elements.get("broker-status")!.className, /icon-wrapper-off/);
  assert.equal(f.elements.get("capture-temperature")!.disabled, false);
});

test("Low Cortisol shows the verification and its actual armed threshold", () => {
  const f = front();
  f.snapshot({ autoShutdown: false, temperatureControl: { ...idle, base: -1, status: "verifying", locked: true,
    autoShutdownTarget: -1, autoShutdownArmStatus: "verifying" } });
  assert.match(f.elements.get("auto-shutdown-status")!.textContent, /checking the maximum temperature/);
  assert.ok(f.elements.get("automated-shutdown")!.disabled);
  f.snapshot({ autoShutdown: true, temperatureControl: { ...idle, autoShutdownTarget: 40, autoShutdownArmStatus: "confirmed" } });
  assert.equal(f.elements.get("auto-shutdown-status")!.textContent, "Auto-off target · 40°C");
});

test("a saved confirmed goal is labeled as historical while the current maximum is unknown", () => {
  const f = front(); f.snapshot({ power: false, temperatureMax: null,
    reconciliation: { target: 44, attempts: 1, status: "confirmed" } });
  assert.equal(f.elements.get("observed-maximum")!.textContent, "Unconfirmed");
  assert.match(f.elements.get("adjustment-status")!.textContent, /Last confirmed target · 44°C/);
});

test("manual target digits never replace hot water in the web reading or heat effect", () => {
  const f = front();
  f.snapshot({ temperature: 60, camera: { available: true, value: 60 } });
  f.snapshot({ temperature: null, camera: { available: true, value: 49 },
    temperatureControl: { ...idle, base: -1, target: 0, status: "settling", locked: true } });
  assert.equal(f.elements.get("temp-display")!.textContent, "60.0°C");
  assert.match(f.elements.get("temp-display")!.title, /not current/);
  assert.equal(f.run("heaterState.lastValidTemperature"), 60);
  assert.equal(f.elements.get("fg")!.style.opacity, 0.6);
  f.snapshot({ temperature: null, camera: { available: true, value: 42 } });
  assert.equal(f.elements.get("temp-display")!.textContent, "60.0°C");
  f.snapshot({ temperature: 59, camera: { available: true, value: 59 } });
  assert.equal(f.elements.get("temp-display")!.textContent, "59.0°C");
  assert.equal(f.sent.length, 0);
});

test("camera display is visible with ESP32 offline and actuator controls stay disabled", () => {
  const f = front();
  f.snapshot({ status: "offline", power: null, temperature: null, temperatureControl: null,
    camera: { available: true, value: 31 } });
  assert.equal(f.elements.get("temp-display")!.textContent, "31.0°C");
  assert.equal(f.elements.get("temp-display")!.title, "Camera display reading");
  assert.equal(f.elements.get("capture-temperature")!.disabled, false);
  assert.equal(f.elements.get("big-button")!.disabled, true);
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
  assert.equal(f.run("heaterState.waterTemperature"), null);
  f.mqtt("heater/status", "offline");
  assert.equal(f.elements.get("temp-display")!.textContent, "31.0°C");
  f.snapshot({ status: "offline", temperature: null, temperatureControl: null,
    camera: { available: false, value: null } });
  assert.equal(f.elements.get("temp-display")!.textContent, "31.0°C");
  assert.match(f.elements.get("temp-display")!.title, /not current/);
  f.disconnect();
  assert.equal(f.elements.get("capture-temperature")!.disabled, true);
  assert.equal(f.sent.length, 0);
});

test("HTTP consumes authoritative measured state, desired target and restored failure", async () => {
  const f = front();
  await f.poll({ online: true, power: true, temperature: 36, temperatureControl: { ...idle, base: 44 },
    desired: { power: true, temperature: 44 }, reconciliation: { target: 44, attempts: 3, status: "failed" },
    pilot: "unlit", display: "readable", flowrate: 0, volume: 0,
    rawDisplay: { value: 75 }, lastValue: 75 });
  assert.equal(f.elements.get("temp-display")!.textContent, "36.0°C");
  assert.match(f.elements.get("adjustment-status")!.textContent, /Could not confirm/);
  assert.equal(f.elements.get("save-temperature")!.disabled, false);
  assert.match(f.elements.get("flow-display")!.textContent, /0.00 L\/min/);
  assert.equal(f.sent.length, 0);
});

test("failed reconciliation can be retried only by an explicit save; stale terminal result does not release a new request", () => {
  const f = front(); f.snapshot({ temperatureControl: { ...idle, base: 44 },
    reconciliation: { target: 44, attempts: 3, status: "failed" } });
  f.run("saveTarget()");
  assert.equal(f.sent.length, 1);
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
  f.message("temperature_result", { target: 44, attempts: 3, status: "failed" });
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
  const timeout = f.timers.find(timer => timer.ms === 15000)!;
  timeout.callback();
  assert.equal(f.sent.length, 1);
  f.message("temperature_result", { target: 44, attempts: 1, status: "verifying" });
  f.message("temperature_result", { target: 44, attempts: 3, status: "failed" });
  assert.equal(f.elements.get("save-temperature")!.disabled, false);
  assert.equal(f.sent.length, 1);
});

test("disconnect clears stale flow and observed power without deleting desired target", async () => {
  const f = front(); f.snapshot(); f.disconnect();
  assert.match(f.elements.get("flow-display")!.textContent, /unavailable/);
  assert.equal(f.elements.get("big-button")!.disabled, true);
  f.run("updateBrokerStatus(true)");
  f.mqtt("heater/status", "online");
  assert.match(f.elements.get("flow-display")!.textContent, /unavailable/);
  assert.equal(f.elements.get("big-button")!.disabled, true);
  assert.equal(f.elements.get("target-temperature")!.textContent, "44°C");
});

test("controller payload validation matches backend and stale result for a different target is ignored", () => {
  const f = front(); f.snapshot();
  f.message("temperature_result", { target: 45, attempts: 3, status: "failed" });
  assert.doesNotMatch(f.elements.get("adjustment-status")!.textContent, /Could not confirm/);
  const invalid = { ...idle, result: "invented" };
  assert.equal(parseTemperatureControl(JSON.stringify(invalid)), null);
  f.mqtt("heater/state/temperature_control", JSON.stringify(invalid));
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
});

test("offline reload displays the persisted target without using desired power as observed power", () => {
  const f = front();
  f.snapshot({ status: "offline", power: null, temperature: null, temperatureControl: null,
    desired: { power: true, temperature: 44 }, reconciliation: { target: 44, attempts: 3, status: "failed" } });
  assert.equal(f.elements.get("target-temperature")!.textContent, "44°C");
  assert.equal(f.elements.get("temp-display")!.textContent, "--.-°C");
  assert.equal(f.elements.get("big-button")!.disabled, true);
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
  assert.equal(f.sent.length, 0);
});

test("firmware locks stay authoritative and Fahrenheit changes presentation only", () => {
  const f = front();
  f.snapshot({ temperature: 0, temperatureControl: { ...idle, status: "settling", locked: true } });
  f.message("temperature_result", { target: 44, attempts: 3, status: "failed" });
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
  assert.equal(f.elements.get("temperature-up")!.disabled, true);
  f.run("toggleFahrenheit({ checked: true })");
  assert.equal(f.elements.get("temp-display")!.textContent, "32.0°F");
  assert.equal(f.elements.get("target-temperature")!.textContent, "111.2°F");
  assert.equal(f.sent.length, 0);
});

test("HTTP loss invalidates controls and flow; explicit command acknowledgement preserves the new desired target", async () => {
  const f = front(); f.snapshot();
  f.run("changeTarget(1); saveTarget()");
  f.mqtt("heater/state/temperature_control", JSON.stringify({ ...idle, commandId: 123, target: 45,
    status: "applying", locked: true, result: "accepted" }));
  assert.equal(f.elements.get("target-temperature")!.textContent, "45°C");
  assert.equal(f.sent.length, 1);
  await f.run("refreshObservation()");
  assert.equal(f.elements.get("big-button")!.disabled, true);
  assert.equal(f.elements.get("temp-display")!.textContent, "37.0°C");
  assert.match(f.elements.get("flow-display")!.textContent, /unavailable/);
  assert.equal(f.sent.length, 1);
});

test("uncorrelated command errors cannot unlock an in-flight temperature request", () => {
  const f = front(); f.snapshot(); f.run("saveTarget()");
  assert.equal(f.sent.length, 1);
  f.message("command_error", { error: "Controller unavailable" });
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
  f.message("command_error", { requestId: 456, error: "Another request failed" });
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
  f.message("command_error", { requestId: 123, error: "Could not save the requested state" });
  assert.equal(f.elements.get("save-temperature")!.disabled, false);
  assert.equal(f.sent.length, 1);
});

test("recent OFF under glare is presented as historical and leaves the power button locked", () => {
  const f = front();
  f.snapshot({ power: null, temperature: null, displayState: { power: null, lastConfirmedOff: true } });
  assert.equal(f.elements.get("temperature-status")!.textContent, "Last confirmed off · checking display");
  assert.equal(f.elements.get("big-button")!.disabled, true);
  f.snapshot({ power: true, temperature: 34 });
  assert.equal(f.elements.get("temperature-status")!.hidden, true);
});

test("a new dashboard holds water through maximum digits and blanks while power is rechecked", () => {
  const f = front();
  const lastWater = { value: 31, observedAt: 1800 };
  f.snapshot({ power: null, temperature: null, temperatureMax: 34, temperatureMaxSelected: true,
    camera: { available: true, value: 34 } });
  f.message("presentation_history", { lastWater, lastPower: { value: false, observedAt: 2000 },
    lastMaximum: { value: 34, observedAt: 1600 } });
  assert.equal(f.elements.get("temp-display")!.textContent, "31.0°C");
  assert.equal(f.run("heaterState.waterTemperature"), null);
  assert.equal(f.elements.get("big-button")!.disabled, true);
  assert.match(f.elements.get("heater-observation")!.textContent, /Last confirmed off/);
  f.snapshot({ power: false, temperature: null, lastWater: { value: 30, observedAt: 1200 },
    camera: { available: false, displayMirror: { text: "blank" } } });
  assert.equal(f.elements.get("temp-display")!.textContent, "31.0°C");
  assert.match(f.elements.get("temperature-status")!.textContent, /heater off/);
  assert.equal(f.elements.get("observed-maximum")!.textContent, "Last seen · 34°C");
  assert.equal(f.run("heaterState.temperatureMax"), null);
  assert.equal(f.sent.length, 0);
});

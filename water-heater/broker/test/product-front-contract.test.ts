import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseTemperatureControl } from "../src/heater/temperature-control.js";

const source = readFileSync(new URL("../../front/script.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../front/index.html", import.meta.url), "utf8");
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
  vm.runInContext(source, context);
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
  assert.equal(f.run("heaterState.temperature"), null);
});

test("failed readings retain the last valid display through unit changes and disconnects", () => {
  const f = front();
  f.snapshot({ temperature: 31 });
  f.snapshot({ temperature: null });
  assert.equal(f.elements.get("temp-display")!.textContent, "31.0°C");
  assert.match(f.elements.get("temp-display")!.title, /not current/);
  assert.equal(f.run("heaterState.temperature"), null);
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

test("camera display is visible with ESP32 offline and actuator controls stay disabled", () => {
  const f = front();
  f.snapshot({ status: "offline", power: null, temperature: null, temperatureControl: null,
    camera: { available: true, value: 31 } });
  assert.equal(f.elements.get("temp-display")!.textContent, "31.0°C");
  assert.equal(f.elements.get("temp-display")!.title, "Camera display reading");
  assert.equal(f.elements.get("capture-temperature")!.disabled, false);
  assert.equal(f.elements.get("big-button")!.disabled, true);
  assert.equal(f.elements.get("save-temperature")!.disabled, true);
  assert.equal(f.run("heaterState.temperature"), null);
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

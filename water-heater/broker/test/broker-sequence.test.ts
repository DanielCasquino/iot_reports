import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as state from "../src/heater/state.js";
import * as pilot from "../src/heater/pilot-command.js";
import * as control from "../src/heater/temperature-control.js";
import * as transport from "../src/heater/temperature-transport.js";
import * as command from "../src/websocket/command.js";
import * as reconciliation from "../src/heater/temperature-reconciliation.js";
import * as panel from "../src/heater/panel-state.js";
import * as powerOps from "../src/heater/power-operation.js";
import * as diagnostics from "../src/heater/control-log.js";
import * as optical from "../src/heater/display-power.js";
import type { DisplayFrame } from "../src/camera/module.js";
import * as desired from "../src/heater/desired-state.js";
import * as statusResponse from "../src/heater/status-response.js";
import * as history from "../src/heater/presentation-history.js";
import * as observedMax from "../src/heater/observed-max.js";

// Run the real application wiring against in-memory transports: no broker,
// sockets, timer, camera, service or hardware is opened by this fixture.
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "heater-broker-sequence-"));
  const mqtt = new EventEmitter() as EventEmitter & { publish: (...args: unknown[]) => void };
  const wss = new EventEmitter();
  const publishes: unknown[][] = [];
  mqtt.publish = (...args) => { publishes.push(args); };
  const routes = new Map<string, (...args: any[]) => void>();
  const ticks: (() => void)[] = [];
  const app = { get: (route: string, handler: (...args: any[]) => void) => routes.set(route, handler), use() {}, listen() {} };
  let cameraState: { available: boolean; value: number | null; observedAt: string | null } = { available: false, value: null, observedAt: null };
  let observeFrame: (frame: DisplayFrame) => boolean;
  let manualWindows = 0;
  class Camera {
    observeManualPlus() { manualWindows++; }
    constructor(_mqtt: unknown, onFrame: typeof observeFrame) { observeFrame = onFrame; }
    setup() {}
    getState() { return cameraState; }
    getDiagnosticEvidence() { return { ...cameraState, frameDiagnostic: null }; }
    async readDisplayTemperature() { return false; }
  }
  const modules: Record<string, unknown> = {
    "./heater/presentation-history.js": history, "dotenv/config": {}, "./mqtt/client.js": { mqttClient: mqtt },
    "./websocket/server.js": { wss, broadcast() {} }, url: { fileURLToPath },
    express: Object.assign(() => app, { static() {} }), path,
    "./camera/module.js": { CameraModule: Camera }, "./heater/state.js": state,
    "./heater/status-response.js": statusResponse, "./heater/pilot-command.js": pilot, "./heater/temperature-control.js": control, "./heater/temperature-transport.js": transport,
    "./websocket/command.js": command, "./heater/temperature-reconciliation.js": reconciliation,
    "./heater/control-log.js": diagnostics, "./heater/power-operation.js": powerOps, "./heater/display-power.js": optical, "./heater/panel-state.js": panel, "./heater/desired-state.js": desired, "./heater/observed-max.js": observedMax,
  };
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")
    .replaceAll("import.meta.url", JSON.stringify("file:///fixture/src/index.js"));
  const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  vm.runInNewContext(compiled, {
    exports: {}, require: (name: string) => {
      assert.ok(name in modules, `unexpected external dependency: ${name}`);
      return modules[name];
    },
    process: { env: { HEATER_DESIRED_STATE_FILE: path.join(directory, "desired.json") } },
    console: { log() {}, warn() {}, error() {} }, Date,
    setInterval: (callback: () => void) => { ticks.push(callback); },
  });
  const send = (topic: string, value: string, retain = false) => mqtt.emit("message", topic, Buffer.from(value), { retain });
  const socket = new EventEmitter() as EventEmitter & { send: (raw: string) => void };
  const replies: any[] = [];
  socket.send = raw => replies.push(JSON.parse(raw));
  const connectSocket = () => wss.emit("connection", socket);
  return { get manualWindows() { return manualWindows; }, mqtt, send, publishes, replies, connectSocket,
    status: () => {
      let body: any;
      routes.get("/api/heater/status")!({}, { set() { return this; }, json(value: unknown) { body = value; } });
      return body;
    },
    frame: (value: number | null, purpose: "water" | "mirror" = "water", light: "dark" | "lit" | "unknown" = "unknown", captureStartedAt?: number) => {
      const now = Date.now();
      const accepted = observeFrame({ value, visible: value !== null, observedAt: now, captureStartedAt: captureStartedAt ?? now, purpose, light });
      cameraState = { available: value !== null, value, observedAt: new Date(now).toISOString() };
      return accepted;
    },
    request: (event: string, enabled: boolean) => socket.emit("message", Buffer.from(JSON.stringify({ event, data: { enabled } }))),
    tick: () => ticks.forEach(tick => tick()),
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("a power request is sent once; unknown acknowledgement preserves desired state without blind retry", () => {
  const f = fixture();
  try {
    f.mqtt.emit("connect");
    f.send("heater/status", "online");
    f.send("heater/state/power", "true");
    f.send("heater/state/temperature_control", JSON.stringify({ base: 56, target: 56, status: "idle", locked: false, min: 30, max: 75, commandId: 0, result: "none" }));
    f.connectSocket();
    f.request("set_heater_power", false);
    assert.equal(f.publishes.filter(message => message[0] === "heater/set/power").length, 1);
    f.send("heater/state/power", "unknown");
    for (let i = 0; i < 5; i++) f.tick();
    f.request("set_heater_power", false);
    assert.equal(f.publishes.filter(message => message[0] === "heater/set/power").length, 1);
    assert.equal(f.replies.at(-1).event, "command_error");
    f.connectSocket();
    assert.equal(f.replies.at(-1).data.power, null);
    assert.equal(f.replies.at(-1).data.desired.power, false);
    f.mqtt.emit("close"); f.mqtt.emit("connect"); f.tick();
    assert.equal(f.publishes.filter(message => message[0] === "heater/set/power").length, 1);
  } finally { f.cleanup(); }
});

test("HTTP and WebSocket expose the camera while controller commands remain unavailable", () => {
  const f = fixture();
  try {
    assert.equal(f.frame(31), false);
    f.connectSocket();
    assert.equal(f.replies.at(-1).data.status, "offline");
    assert.equal(f.replies.at(-1).data.camera.value, 31);
    assert.equal(f.status().camera.available, true);
    assert.equal(f.status().temperature, null);
    f.request("set_heater_power", true);
    f.tick();
    assert.equal(f.replies.at(-1).event, "command_error");
    assert.equal(f.publishes.length, 0);
  } finally { f.cleanup(); }
});

test("HTTP auto-off flag follows the controller and becomes unknown on disconnect", () => {
  const f = fixture();
  try {
    f.mqtt.emit("connect"); f.send("heater/status", "online");
    f.send("heater/state/autoshutdown", "true");
    assert.equal(f.status().autoShutdown, true);
    assert.equal(f.status().autoShutdownTarget, null);
    f.send("heater/state/temperature_control", JSON.stringify({ base: 50, target: 60, status: "idle", locked: false,
      min: 30, max: 75, commandId: 1, result: "accepted", autoShutdownTarget: 60 }));
    assert.equal(f.status().autoShutdownTarget, 60);
    f.send("heater/state/autoshutdown", "false");
    assert.equal(f.status().autoShutdown, false);
    f.send("heater/status", "offline");
    assert.equal(f.status().autoShutdown, null);
    assert.equal(f.status().autoShutdownTarget, null);
  } finally { f.cleanup(); }
});

test("explicit auto enable requires supported optical acquisition; disable remains available", () => {
  const f = fixture();
  try {
    f.mqtt.emit("connect"); f.send("heater/status", "online"); f.send("heater/state/power", "true");
    const control = { base: -1, target: 0, status: "idle", locked: false, min: 30, max: 75,
      commandId: 0, result: "none", autoShutdownTarget: -1 };
    f.send("heater/state/temperature_control", JSON.stringify(control));
    f.connectSocket();
    f.request("set_auto_shutdown", true);
    assert.equal(f.replies.at(-1).event, "command_error");
    assert.equal(f.publishes.length, 0);
    f.send("heater/state/temperature_control", JSON.stringify({ ...control, autoShutdownRead: 1 }));
    f.request("set_auto_shutdown", true);
    assert.equal(f.replies.at(-1).event, "command_error");
    assert.equal(f.publishes.length, 0);
    assert.equal(f.frame(40, "water", "lit"), true);
    f.request("set_auto_shutdown", true);
    assert.deepEqual(f.publishes.at(-1)?.slice(0, 2), ["heater/set/autoshutdown", "true"]);
    f.send("heater/state/power", "unknown");
    f.request("set_auto_shutdown", false);
    assert.deepEqual(f.publishes.at(-1)?.slice(0, 2), ["heater/set/autoshutdown", "false"]);
  } finally { f.cleanup(); }
});

test("a newer raw mirror frame cannot replace the panel's confirmed water reading", () => {
  const f = fixture();
  try {
    f.mqtt.emit("connect"); f.send("heater/status", "online"); f.send("heater/state/power", "true");
    f.send("heater/state/temperature_control", JSON.stringify({ base: 43, target: 0, status: "idle", locked: false,
      min: 30, max: 75, commandId: 0, result: "none" }));
    assert.equal(f.frame(35), true);
    assert.equal(f.frame(59, "mirror"), false);
    assert.equal(f.status().temperature, 35);
    assert.equal(f.status().camera.value, 59);
  } finally { f.cleanup(); }
});

test("malformed autoshutdown and controller reconnect cannot resurrect cached observations", () => {
  const f = fixture();
  try {
    f.mqtt.emit("connect");
    f.send("heater/status", "online");
    f.send("heater/state/power", "true");
    f.send("heater/state/autoshutdown", "invalid");
    f.connectSocket();
    assert.equal(f.replies.at(-1).data.autoShutdown, null);
    f.send("heater/state/temperature_control", JSON.stringify({ base: 43, target: 0, status: "idle", locked: false,
      min: 30, max: 75, commandId: 0, result: "none" }));
    f.send("heater/status", "offline"); f.send("heater/status", "online");
    f.connectSocket();
    assert.equal(f.replies.at(-1).data.temperatureControl, null);
    assert.equal(f.replies.at(-1).data.power, null);
    assert.equal(f.replies.at(-1).data.panel.power, null);
  } finally { f.cleanup(); }
});

test("application snapshots hide cached water immediately when a target-selection lock arrives", () => {
  const f = fixture();
  const idle = { base: 43, target: 0, status: "idle", locked: false, min: 30, max: 75, commandId: 0, result: "none" };
  try {
    f.mqtt.emit("connect");
    f.send("heater/status", "online");
    f.send("heater/state/power", "true");
    f.send("heater/state/temperature_control", JSON.stringify(idle));
    assert.equal(f.frame(47), true);
    f.connectSocket();
    assert.equal(f.replies.at(-1).data.temperature, 47);
    f.send("heater/state/temperature_control", JSON.stringify({ ...idle, status: "selecting" }));
    f.connectSocket();
    assert.equal(f.replies.at(-1).data.temperature, null);
    assert.equal(f.frame(44), false);
    f.connectSocket();
    assert.equal(f.replies.at(-1).data.temperature, null);
  } finally { f.cleanup(); }
});


test("calibrated OFF reaches the controller and its false acknowledgement re-enables web ON", () => {
  const originalNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  const f = fixture();
  const idle = JSON.stringify({ base: -1, target: 0, status: "idle", locked: false, min: 30, max: 75, commandId: 0, result: "none" });
  try {
    f.mqtt.emit("connect"); f.send("heater/status", "online");
    f.send("heater/state/power", "unknown"); f.send("heater/state/temperature_control", idle);
    for (const elapsed of [0, 1000, 2000, 3000, 4000, 5000, 6000]) {
      now = 100000 + elapsed; f.frame(null, "mirror", "dark");
    }
    assert.equal(f.publishes.some(m => m[0] === "heater/input/power"), false);
    now = 107500; f.frame(null, "mirror", "dark");
    assert.equal(JSON.stringify(f.publishes.filter(m => m[0] === "heater/input/power").at(-1)), JSON.stringify(["heater/input/power", "false", { qos: 0, retain: false }]));
    f.send("heater/state/power", "false");
    f.connectSocket();
    assert.equal(f.replies.at(-1).data.power, false);
    f.request("set_heater_power", true);
    assert.equal(JSON.stringify(f.publishes.at(-1)), JSON.stringify(["heater/set/power", "true", { qos: 0, retain: false }]));
    const count = f.publishes.filter(m => m[0] === "heater/input/power").length;
    now += 1000; f.frame(null, "mirror", "dark");
    assert.equal(f.publishes.filter(m => m[0] === "heater/input/power").length, count);
    f.send("heater/status", "offline"); f.send("heater/status", "online");
    now += 7000; f.frame(null, "mirror", "dark");
    assert.equal(f.publishes.filter(m => m[0] === "heater/input/power").length, count);
  } finally { f.cleanup(); Date.now = originalNow; }
});


test("a frame captured during Power cannot restore ON or water after the unknown acknowledgement", () => {
  const originalNow = Date.now; let now = 100000; Date.now = () => now;
  const f = fixture();
  try {
    f.mqtt.emit("connect"); f.send("heater/status", "online"); f.send("heater/state/power", "true");
    f.send("heater/state/temperature_control", JSON.stringify({ base: 56, target: 56, status: "idle", locked: false,
      min: 30, max: 75, commandId: 1, result: "accepted" }));
    assert.equal(f.frame(59), true);
    now = 100500; f.send("heater/state/power", "unknown");
    now = 100700;
    assert.equal(f.frame(59, "water", "lit", 100400), false);
    assert.equal(f.status().temperature, null);
    assert.equal(f.publishes.some(m => m[0] === "heater/input/power"), false);
    now = 102000;
    assert.equal(f.frame(59, "water", "lit", 101600), true);
    assert.equal(f.publishes.some(m => m[0] === "heater/input/power" && m[1] === "true"), true);
  } finally { f.cleanup(); Date.now = originalNow; }
});

test("only a live manual plus starts the camera mirror burst without a control publication", () => {
  const f = fixture();
  const tap = { pin: 27, button: "plus", reason: "manual_plus", commandId: 0,
    estimatedBefore: -1, estimatedAfter: -1, target: -1, press: 16, rest: 0,
    startedAt: 1000, completedAt: 1500, mechanicalConfirmed: false };
  try {
    const topic = "heater/diagnostic/servo";
    f.send(topic, JSON.stringify(tap), true);
    f.send(topic, JSON.stringify({ ...tap, reason: "open_target" }));
    f.send(topic, JSON.stringify({ ...tap, pin: 25, button: "power" }));
    f.send(topic, "{");
    assert.equal(f.manualWindows, 0);
    f.send(topic, JSON.stringify(tap));
    assert.equal(f.manualWindows, 1);
    assert.equal(f.publishes.length, 0);
  } finally { f.cleanup(); }
});

test("new clients receive confirmed history across a restart without replaying controls", () => {
  const f = fixture();
  const at = Date.now() - 86400000;
  const cached = (topic: string, value: unknown, observedAt = at, retain = true) =>
    f.send(topic, JSON.stringify({ value, observedAt }), retain);
  try {
    cached(history.WATER_HISTORY, 31);
    cached(history.POWER_HISTORY, false);
    cached(history.WATER_HISTORY, 34, at - 1);
    cached(history.WATER_HISTORY, 75, at + 1, false);
    cached(history.WATER_HISTORY, 200, at + 2);
    cached(history.WATER_HISTORY, 42, Date.now() + 100000);
    f.frame(34, "mirror");
    f.connectSocket();
    for (const state of [f.status(), f.replies.at(-1).data]) {
      assert.equal(state.lastWater.value, 31);
      assert.equal(state.lastWater.observedAt, at);
      assert.equal(state.lastPower.value, false);
      assert.equal(state.temperature, null);
      assert.equal(state.power, null);
    }
    assert.equal(f.publishes.length, 0);
    f.mqtt.emit("connect"); f.send("heater/status", "online");
    f.send("heater/state/temperature_control", JSON.stringify({ base: 34, target: 0, status: "idle",
      locked: false, min: 30, max: 75, commandId: 0, result: "none" }));
    assert.equal(f.frame(32), true);
    assert.equal(f.status().lastWater.value, 32);
    const publication = f.publishes.find(m => m[0] === history.WATER_HISTORY)!;
    assert.deepEqual(JSON.parse(String(publication[1])).value, 32);
    assert.deepEqual(publication[2], { qos: 1, retain: true });
    f.frame(34, "mirror");
    assert.equal(f.status().lastWater.value, 32);
  } finally { f.cleanup(); }
});

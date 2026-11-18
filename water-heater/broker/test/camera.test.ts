import test from "node:test";
import { EventEmitter } from "node:events";
import express from "express";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { MqttClient } from "mqtt";
import { CameraModule } from "../src/camera/module.js";

test("OLED mirrors a confirmed blink while retaining its coherent number through98 and capture failure", async () => {
  const previous = { ...process.env };
  const oldFetch = globalThis.fetch, oldLog = console.log;
  Object.assign(process.env, { CAMERA_URL: "http://camera.test", CAMERA_READER: "tesseract", CAMERA_CROP: "",
    CAMERA_DISPLAY_REGION: "0,0,80,40", CAMERA_DISPLAY_DARK_MAX: "40", CAMERA_DISPLAY_LIT_MIN: "70" });
  const white = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).jpeg().toBuffer();
  const black = await sharp({ create: { width: 80, height: 40, channels: 3, background: "black" } }).jpeg().toBuffer();
  let digits = "22", failed = false;
  globalThis.fetch = async () => failed ? new Response("failed", { status: 503 }) :
    new Response(digits ? white : black, { headers: { "x-capture-fresh": "1", "content-type": "image/jpeg" } });
  const messages: { topic: string; payload: string }[] = [], logs: Record<string, unknown>[] = [];
  const frames: { value: number | null }[] = [];
  const mqtt = { connected: true, publish(topic: string, payload: string, _options: unknown, callback?: () => void) {
    messages.push({ topic, payload }); callback?.();
  } } as unknown as MqttClient;
  const camera = new CameraModule(mqtt, frame => { frames.push(frame); return true; });
  (camera as unknown as { ocrWorker: unknown }).ocrWorker = {
    recognize: async () => ({ data: { text: digits, confidence: 95 } }), terminate: async () => {},
  };
  console.log = line => { try { logs.push(JSON.parse(line)); } catch {} };
  try {
    assert.equal(await camera.readDisplayTemperature(), true); // Cold water below30 stays valid.
    const observedAt = camera.getState().displayMirror.observedAt;
    digits = "98";
    assert.equal(await camera.readDisplayTemperature(), false);
    assert.equal(frames.at(-1)?.value, null);
    assert.equal(camera.getState().lastValue, 22);
    digits = "";
    assert.equal(await camera.readDisplayTemperature(), false);
    failed = true;
    assert.equal(await camera.readDisplayTemperature(), false);
    assert.equal(camera.getState().displayMirror.text, "22");
    assert.equal(camera.getState().displayMirror.observedAt, observedAt);
    assert.deepEqual(messages.filter(m => m.topic === "heater/input/display").map(m => m.payload), ["22", "22", "blank", "22"]);
    assert.deepEqual(messages.filter(m => m.topic === "heater/input/temperature").map(m => m.payload),
      ["22", "unavailable", "unavailable", "unavailable"]);
    assert.ok(logs.some(entry => entry.event === "display_mirror_sent" && entry.held === true && entry.rejectedValue === 98));
    assert.ok(logs.some(entry => entry.event === "display_mirror_sent" && entry.rawText === "blank" && entry.text === "blank" && entry.held === false));
    failed = false; digits = "23";
    assert.equal(await camera.readDisplayTemperature(), true);
    assert.equal(camera.getState().displayMirror.text, "23");
  } finally {
    console.log = oldLog; await camera.close(); globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("capture publishes non-retained OCR; unreadable image or HTTP failure invalidates it", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.CAMERA_URL;
  process.env.CAMERA_URL = "http://camera.test";
  const jpeg = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).jpeg().toBuffer();
  const messages: { topic: string; payload: string; options: unknown }[] = [];
  const mqtt = { connected: true, publish(topic: string, payload: string, options: unknown, callback?: (e?: Error) => void) {
    messages.push({ topic, payload, options }); callback?.();
  } } as unknown as MqttClient;
  const frames: { visible: boolean; value: number | null; purpose: string }[] = [];
  const module = new CameraModule(mqtt, frame => { frames.push(frame); });
  let reads = 0;
  globalThis.fetch = (async () => { reads++; return new Response(jpeg, { headers: { "content-type": "image/jpeg" } }); }) as typeof fetch;
  const mockWorker = { recognize: async () => ({ data: { text: "48", confidence: 95 } }), terminate: async () => {} };
  (module as unknown as { ocrWorker: unknown }).ocrWorker = mockWorker;
  try {
    assert.equal(await module.readDisplayTemperature(), true);
    assert.equal(reads, 2);
    mockWorker.recognize = async () => ({ data: { text: "43", confidence: 95 } });
    assert.equal(await module.readDisplayTemperature(false, "123"), true);
    assert.equal(module.getState().value, 43);
    assert.equal(module.getState().displayMirror.text, "43");
    assert.equal(messages.filter(message => message.topic === "heater/input/temperature").length, 1);
    assert.equal(reads, 4); // Verification takes new frames, rather than reusing the last value.
    assert.deepEqual(messages.at(-1), { topic: "heater/input/temperature_verification", payload: "123,43", options: { qos: 0, retain: false } });
    assert.equal(await module.readDisplayTemperature(false, "124", false, true), true);
    assert.equal(reads, 6);
    assert.equal(frames.at(-1)?.purpose, "wake");
    assert.deepEqual(messages.at(-1), { topic: "heater/input/wake_verification", payload: "124,43", options: { qos: 0, retain: false } });
    assert.equal(messages.filter(message => message.topic === "heater/input/temperature").length, 1);
    assert.equal(await module.readDisplayTemperature(false, undefined, true), true);
    assert.equal(reads, 8); // Old firmware also needs a discarded frame for mirror reads.
    globalThis.fetch = (async () => { reads++; return new Response(jpeg,
      { headers: { "content-type": "image/jpeg", "x-capture-fresh": "1" } }); }) as typeof fetch;
    assert.equal(await module.readDisplayTemperature(false, undefined, true), true);
    assert.equal(reads, 9); // New firmware certifies flushing inside /capture: only one request.
    const delivered = messages.length;
    assert.equal(await module.readDisplayTemperature(true), false);
    assert.equal(module.getState().available, true);
    assert.equal(messages.length, delivered);
    assert.deepEqual(messages.find(message => message.topic === "heater/input/temperature"), { topic: "heater/input/temperature", payload: "48", options: { qos: 0, retain: false } });
    mockWorker.recognize = async () => ({ data: { text: "", confidence: 0 } });
    assert.equal(await module.readDisplayTemperature(), false);
    assert.equal(messages.at(-1)?.payload, "unavailable");
    assert.equal(frames.at(-1)?.visible, false); // Empty OCR is not proof of a lit display.
    globalThis.fetch = (async () => new Response("error", { status: 503 })) as typeof fetch;
    assert.equal(await module.readDisplayTemperature(), false);
    assert.equal(messages.at(-1)?.payload, "unavailable");
  } finally {
    await module.close(); globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.CAMERA_URL; else process.env.CAMERA_URL = oldUrl;
  }
});

test("legacy wake requests never press power; ordinary capture remains available", async () => {
  const messages: { topic: string; payload: string }[] = [];
  const mqtt = { connected: true, publish(topic: string, payload: string) { messages.push({ topic, payload }); } } as unknown as MqttClient;
  const module = new CameraModule(mqtt);
  try {
    assert.equal(await module.readDisplayTemperature(true), false);
    assert.equal(messages.some(m => m.topic === "heater/command/wake_display" || m.topic === "heater/set/power"), false);
    assert.match(module.getState().error!, /wake taps are disabled/);
  } finally { await module.close(); }
});

test("verification subscribes after reconnect and ignores retained or malformed requests", async () => {
  const { EventEmitter } = await import("node:events");
  const mqtt = new EventEmitter() as EventEmitter & { connected: boolean; subscribe: (topic: string) => void };
  const subscriptions: string[] = [];
  mqtt.connected = true;
  mqtt.subscribe = topic => { subscriptions.push(topic); };
  const module = new CameraModule(mqtt as unknown as MqttClient);
  const requests: { id: string; wake: boolean }[] = [];
  module.readDisplayTemperature = async (_wake, id, _mirror, wake) => { requests.push({ id: id!, wake: wake ?? false }); return true; };
  const previousPoll = process.env.CAMERA_POLL_MS;
  process.env.CAMERA_POLL_MS = "0";
  const app = { get() {}, post() {} } as unknown as import("express").Express;
  try {
    module.setup(app);
    mqtt.emit("connect");
    assert.deepEqual(subscriptions, ["heater/command/verify_temperature", "heater/command/verify_wake",
      "heater/presentation/display-cache", "heater/command/verify_temperature", "heater/command/verify_wake", "heater/presentation/display-cache"]);
    for (const topic of ["heater/command/verify_temperature", "heater/command/verify_wake"]) {
      for (const id of ["", "-1", "4294967296", "12,48"])
        mqtt.emit("message", topic, Buffer.from(id), { retain: false });
      mqtt.emit("message", topic, Buffer.from("7"), { retain: true });
    }
    mqtt.emit("message", "heater/command/verify_temperature", Buffer.from("7"), { retain: true });
    mqtt.emit("message", "heater/command/other", Buffer.from("7"), { retain: false });
    assert.deepEqual(requests, []);
    mqtt.emit("message", "heater/command/verify_temperature", Buffer.from("7"), { retain: false });
    assert.deepEqual(requests, [{ id: "7", wake: false }]);
    for (let i = 0; i < 4; i++) mqtt.emit("message", "heater/command/verify_wake", Buffer.from("7"), { retain: false });
    assert.deepEqual(requests, [{ id: "7", wake: false }, ...Array.from({ length: 3 }, () => ({ id: "7", wake: true }))]);
    for (let i = 0; i < 8; i++) mqtt.emit("message", "heater/command/verify_temperature", Buffer.from("8"), { retain: false });
    assert.equal(requests.filter(request => request.id === "8" && !request.wake).length, 6);
    await module.close();
    assert.equal(mqtt.listenerCount("message"), 0);
  } finally {
    await module.close();
    if (previousPoll === undefined) delete process.env.CAMERA_POLL_MS;
    else process.env.CAMERA_POLL_MS = previousPoll;
  }
});

test("readable setpoint/recovery frames update the mirror but cannot enter water telemetry", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.CAMERA_URL;
  process.env.CAMERA_URL = "http://camera.test";
  const jpeg = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).jpeg().toBuffer();
  const messages: { topic: string; payload: string }[] = [];
  const mqtt = { connected: true, publish(topic: string, payload: string, _options: unknown, callback?: (e?: Error) => void) {
    messages.push({ topic, payload }); callback?.();
  } } as unknown as MqttClient;
  let accepted = false;
  const module = new CameraModule(mqtt, () => accepted);
  (module as unknown as { ocrWorker: unknown }).ocrWorker = {
    recognize: async () => ({ data: { text: "44", confidence: 95 } }), terminate: async () => {},
  };
  globalThis.fetch = (async () => new Response(jpeg, { headers: { "content-type": "image/jpeg" } })) as typeof fetch;
  try {
    assert.equal(await module.readDisplayTemperature(false, "88", false, true), true);
    assert.equal(messages.at(-1)?.topic, "heater/input/wake_verification");
    assert.equal(messages.some(m => m.topic === "heater/input/temperature"), false);
    assert.equal(await module.readDisplayTemperature(), true);
    assert.equal(module.getState().available, true);
    assert.equal(module.getState().value, 44);
    assert.equal(module.getState().displayMirror.text, "44");
    assert.equal(module.getState().error, null);
    assert.equal(messages.some(m => m.topic === "heater/input/temperature" && m.payload === "44"), false);
    assert.equal(messages.at(-1)?.payload, "unavailable");
    accepted = true;
    assert.equal(await module.readDisplayTemperature(), true);
    assert.equal(module.getState().value, 44);
    assert.equal(messages.at(-1)?.payload, "44");
  } finally {
    await module.close(); globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.CAMERA_URL; else process.env.CAMERA_URL = oldUrl;
  }
});

test("ordinary and wake-only OCR crossing an MQTT or controller reconnect cannot publish into the new session", async () => {
  const { EventEmitter } = await import("node:events");
  const mqtt = new EventEmitter() as EventEmitter & { connected: boolean; subscribe: (topic: string) => void;
    publish: (topic: string, payload: string, options: unknown, callback?: (e?: Error) => void) => void };
  const messages: { topic: string; payload: string }[] = [];
  mqtt.connected = true;
  mqtt.subscribe = () => {};
  mqtt.publish = (topic, payload, _options, callback) => { messages.push({ topic, payload }); callback?.(); };
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.CAMERA_URL;
  const oldPoll = process.env.CAMERA_POLL_MS;
  const oldMirror = process.env.CAMERA_MIRROR_POLL_MS;
  process.env.CAMERA_URL = "http://camera.test";
  process.env.CAMERA_POLL_MS = process.env.CAMERA_MIRROR_POLL_MS = "0";
  const jpeg = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).jpeg().toBuffer();
  globalThis.fetch = (async () => new Response(jpeg, { headers: { "content-type": "image/jpeg" } })) as typeof fetch;
  let finish!: (data: { data: { text: string; confidence: number } }) => void;
  let started!: () => void;
  let recognizing = new Promise<void>(resolve => { started = resolve; });
  const module = new CameraModule(mqtt as unknown as MqttClient);
  (module as unknown as { ocrWorker: unknown }).ocrWorker = {
    recognize: () => { started(); return new Promise(resolve => { finish = resolve; }); }, terminate: async () => {},
  };
  module.setup({ get() {}, post() {} } as unknown as import("express").Express);
  try {
    for (const wake of [false, true]) for (const reconnect of [() => { mqtt.emit("close"); mqtt.emit("connect"); },
      () => { mqtt.emit("message", "heater/status", Buffer.from("online"), { retain: false }); }]) {
      const capture = wake ? module.readDisplayTemperature(false, "19", false, true) : module.readDisplayTemperature();
      await recognizing;
      reconnect();
      finish({ data: { text: "48", confidence: 95 } });
      assert.equal(await capture, true);
      assert.deepEqual(messages, []);
      assert.equal(module.getState().available, true);
      assert.equal(module.getState().value, 48);
      assert.equal(module.getState().error, null);
      recognizing = new Promise<void>(resolve => { started = resolve; });
    }
  } finally {
    await module.close(); globalThis.fetch = oldFetch;
    for (const [key, old] of [["CAMERA_URL", oldUrl], ["CAMERA_POLL_MS", oldPoll], ["CAMERA_MIRROR_POLL_MS", oldMirror]]) {
      if (old === undefined) delete process.env[key!]; else process.env[key!] = old;
    }
  }
});

test("optical capture works without MQTT and controller water acceptance", async () => {
  const oldFetch = globalThis.fetch, oldUrl = process.env.CAMERA_URL;
  process.env.CAMERA_URL = "http://camera.test";
  const jpeg = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).jpeg().toBuffer();
  const messages: { topic: string; payload: string }[] = [];
  const mqtt = { connected: false, publish(topic: string, payload: string) { messages.push({ topic, payload }); } };
  const camera = new CameraModule(mqtt as unknown as MqttClient, () => false);
  (camera as unknown as { ocrWorker: unknown }).ocrWorker = {
    recognize: async () => ({ data: { text: "31", confidence: 95 } }), terminate: async () => {},
  };
  globalThis.fetch = async () => new Response(jpeg, { headers: { "content-type": "image/jpeg", "x-capture-fresh": "1" } });
  try {
    assert.equal(await camera.readDisplayTemperature(), true);
    assert.equal(camera.getState().available, true);
    assert.equal(camera.getState().value, 31);
    assert.equal(messages.length, 0);
    mqtt.connected = true;
    assert.equal(await camera.readDisplayTemperature(), true);
    assert.equal(camera.getState().value, 31);
    assert.equal(messages.at(-1)?.payload, "unavailable");
    assert.equal(messages.some(m => m.topic === "heater/input/temperature" && m.payload === "31"), false);
  } finally {
    await camera.close(); globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.CAMERA_URL; else process.env.CAMERA_URL = oldUrl;
  }
});


test("active target verification requires fresh selection blink, not two stable water captures", async () => {
  const logEntries: Record<string, unknown>[] = [];
  const previousLog = console.log;
  console.log = line => { try { logEntries.push(JSON.parse(line)); } catch {} };
  const { EventEmitter } = await import("node:events");
  const previous = { ...process.env };
  const oldFetch = globalThis.fetch;
  Object.assign(process.env, { CAMERA_URL: "http://camera.test", CAMERA_POLL_MS: "0", CAMERA_MIRROR_POLL_MS: "0",
    CAMERA_DISPLAY_REGION: "0,0,80,40", CAMERA_DISPLAY_DARK_MAX: "40", CAMERA_DISPLAY_LIT_MIN: "70", CAMERA_READER: "tesseract" });
  const white = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).jpeg().toBuffer();
  const black = await sharp({ create: { width: 80, height: 40, channels: 3, background: "black" } }).jpeg().toBuffer();
  let blank = false;
  let digits = "57";
  globalThis.fetch = async () => new Response(blank ? black : white, { headers: { "content-type": "image/jpeg", "x-capture-fresh": "1" } });
  const messages: { topic: string; payload: string }[] = [];
  const mqtt = Object.assign(new EventEmitter(), { connected: true, subscribe() {},
    publish(topic: string, payload: string) { messages.push({ topic, payload }); } });
  const camera = new CameraModule(mqtt as unknown as MqttClient);
  (camera as unknown as { ocrWorker: unknown }).ocrWorker = {
    recognize: async () => ({ data: { text: blank ? "" : digits, confidence: 95 } }), terminate: async () => {},
  };
  const read = camera.readDisplayTemperature.bind(camera);
  let pending: Promise<boolean> = Promise.resolve(false);
  camera.readDisplayTemperature = (...args) => pending = read(...args);
  camera.setup({ get() {}, post() {} } as unknown as import("express").Express);
  const request = (id: string) => mqtt.emit("message", "heater/command/verify_temperature", Buffer.from(id), { retain: false });
  try {
    request("9"); await pending; request("9"); await pending;
    assert.equal(messages.some(m => m.topic === "heater/input/temperature_verification"), false);
    assert.ok(logEntries.some(entry => entry.decision === "blocked_missing_selection_blink"));
    blank = true;
    await camera.readDisplayTemperature(false, undefined, true); // Fresh blank after request, even during mirror polling.
    blank = false;
    request("9"); await pending;
    assert.equal(messages.at(-1)?.topic, "heater/input/temperature_verification");
    assert.equal(messages.at(-1)?.payload, "9,57");
    assert.ok(logEntries.some(entry => entry.event === "camera_candidate_sent" && entry.verificationId === "9" &&
      entry.selectionBlankSeen === true && entry.controllerConfirmationPending === true));
    const delivered = messages.filter(m => m.topic === "heater/input/temperature_verification").length;
    request("10"); await pending;
    assert.equal(messages.filter(m => m.topic === "heater/input/temperature_verification").length, delivered);
    mqtt.emit("close"); mqtt.emit("connect");
    request("10"); await pending;
    assert.equal(messages.filter(m => m.topic === "heater/input/temperature_verification").length, delivered);
    // Explicit verification can land on blanks while continuous captures see
    // the digits. Those fresh mirrors must supply the same guarded candidates.
    blank = true;
    request("10"); await pending;
    blank = false;
    await camera.readDisplayTemperature(false, undefined, true);
    await camera.readDisplayTemperature(false, undefined, true);
    assert.equal(messages.filter(m => m.topic === "heater/input/temperature_verification").length, delivered + 2);
    assert.ok(logEntries.some(entry => entry.event === "camera_candidate_sent" && entry.origin === "mirror" && entry.verificationId === "10"));
    digits = "98";
    await camera.readDisplayTemperature(false, undefined, true);
    assert.equal(messages.filter(m => m.topic === "heater/input/temperature_verification").length, delivered + 2);
    assert.ok(logEntries.some(entry => entry.event === "camera_reading_rejected" && entry.reason === "outside_heater_range"));
    digits = "57";
    request("11"); await pending;
    await camera.readDisplayTemperature(false, undefined, true);
    assert.equal(messages.filter(m => m.topic === "heater/input/temperature_verification").length, delivered + 2);
    // Once the request expires, even a remembered blank is insufficient.
    blank = true; request("11"); await pending; blank = false;
    const beforeExpiry = messages.filter(m => m.topic === "heater/input/temperature_verification").length;
    const previousNow = Date.now;
    const future = previousNow() + 5000;
    Date.now = () => future;
    try { await camera.readDisplayTemperature(false, undefined, true); }
    finally { Date.now = previousNow; }
    assert.equal(messages.filter(m => m.topic === "heater/input/temperature_verification").length, beforeExpiry);
  } finally {
    console.log = previousLog;
    await camera.close(); globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});


test("retained OLED presentation is bounded, historical and never a control observation", async () => {
  class FakeMqtt extends EventEmitter {
    connected = true;
    messages: { topic: string; payload: string; options: unknown }[] = [];
    subscribe(_topic: string, _options?: unknown) {}
    publish(topic: string, payload: string, options: unknown) { this.messages.push({ topic, payload, options }); }
  }
  const mqtt = new FakeMqtt();
  let observations = 0;
  const camera = new CameraModule(mqtt as unknown as MqttClient, () => { observations++; });
  camera.setup(express());
  const topic = "heater/presentation/display-cache";
  const send = (value: unknown, age: number, retain = true) =>
    mqtt.emit("message", topic, Buffer.from(JSON.stringify({ value, observedAt: new Date(Date.now() - age).toISOString() })), { retain });
  try {
    send(40, 301000);
    send(99, 10);
    send(41, -1000);
    send(42, 10, false);
    assert.equal(camera.getState().displayMirror.text, "unknown");
    send(43, 1000);
    assert.equal(camera.getState().displayMirror.text, "43");
    assert.equal(camera.getState().displayMirror.historical, true);
    assert.equal(camera.getState().value, null);
    assert.equal(observations, 0);
    assert.deepEqual(mqtt.messages, [{ topic: "heater/input/display", payload: "h43:30000", options: { qos: 0, retain: false } }]);
    send(41, 3000);
    assert.equal(camera.getState().displayMirror.text, "43");
    assert.equal(mqtt.messages.some(m => m.topic === topic), false);
    const oldNow = Date.now;
    try {
      const initialNow = Date.now();
      Date.now = () => initialNow + 293000;
      (camera as unknown as { publishMirror(raw: string, at: null, rejected: null): void }).publishMirror("unknown", null, null);
      const late = mqtt.messages.at(-1)?.payload ?? "";
      assert.match(late, /^h43:[1-9][0-9]{0,3}$/);
      assert.ok(Number(late.split(":")[1]) <= 1000);
      Date.now = () => initialNow + 301000;
      (camera as unknown as { publishMirror(raw: string, at: null, rejected: null): void }).publishMirror("unknown", null, null);
      assert.equal(camera.getState().displayMirror.text, "unknown");
      assert.equal(mqtt.messages.at(-1)?.payload, "unknown");
    } finally { Date.now = oldNow; }
  } finally { await camera.close(); }
});

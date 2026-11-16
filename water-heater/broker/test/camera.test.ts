import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { MqttClient } from "mqtt";
import { CameraModule } from "../src/camera/module.js";

test("capture publishes non-retained OCR; unreadable image or HTTP failure invalidates it", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.CAMERA_URL;
  process.env.CAMERA_URL = "http://camera.test";
  const jpeg = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).jpeg().toBuffer();
  const messages: { topic: string; payload: string; options: unknown }[] = [];
  const mqtt = { connected: true, publish(topic: string, payload: string, options: unknown, callback?: (e?: Error) => void) {
    messages.push({ topic, payload, options }); callback?.();
  } } as unknown as MqttClient;
  const frames: { visible: boolean; value: number | null }[] = [];
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
    assert.equal(await module.readDisplayTemperature(false, undefined, true), true);
    assert.equal(reads, 6); // Old firmware also needs a discarded frame for mirror reads.
    globalThis.fetch = (async () => { reads++; return new Response(jpeg,
      { headers: { "content-type": "image/jpeg", "x-capture-fresh": "1" } }); }) as typeof fetch;
    assert.equal(await module.readDisplayTemperature(false, undefined, true), true);
    assert.equal(reads, 7); // New firmware certifies flushing inside /capture: only one request.
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
  const requests: string[] = [];
  module.readDisplayTemperature = async (_wake, id) => { requests.push(id!); return true; };
  const previousPoll = process.env.CAMERA_POLL_MS;
  process.env.CAMERA_POLL_MS = "0";
  const app = { get() {}, post() {} } as unknown as import("express").Express;
  try {
    module.setup(app);
    mqtt.emit("connect");
    assert.deepEqual(subscriptions, ["heater/command/verify_temperature", "heater/command/verify_temperature"]);
    for (const id of ["", "-1", "4294967296", "12,48"])
      mqtt.emit("message", "heater/command/verify_temperature", Buffer.from(id), { retain: false });
    mqtt.emit("message", "heater/command/verify_temperature", Buffer.from("7"), { retain: true });
    mqtt.emit("message", "heater/command/other", Buffer.from("7"), { retain: false });
    assert.deepEqual(requests, []);
    mqtt.emit("message", "heater/command/verify_temperature", Buffer.from("7"), { retain: false });
    assert.deepEqual(requests, ["7"]);
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

test("an OCR operation crossing an MQTT or controller reconnect cannot publish into the new session", async () => {
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
    for (const reconnect of [() => { mqtt.emit("close"); mqtt.emit("connect"); },
      () => { mqtt.emit("message", "heater/status", Buffer.from("online"), { retain: false }); }]) {
      const capture = module.readDisplayTemperature();
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

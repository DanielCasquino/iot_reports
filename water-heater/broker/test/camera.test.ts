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
  const module = new CameraModule(mqtt);
  let reads = 0;
  globalThis.fetch = (async () => { reads++; return new Response(jpeg, { headers: { "content-type": "image/jpeg" } }); }) as typeof fetch;
  const mockWorker = { recognize: async () => ({ data: { text: "48", confidence: 95 } }), terminate: async () => {} };
  (module as unknown as { ocrWorker: unknown }).ocrWorker = mockWorker;
  try {
    assert.equal(await module.readDisplayTemperature(), true);
    assert.equal(reads, 2);
    assert.equal(await module.readDisplayTemperature(false, "123"), true);
    assert.equal(reads, 4); // Verification takes new frames, rather than reusing the last value.
    assert.deepEqual(messages.at(-1), { topic: "heater/input/temperature_verification", payload: "123,48", options: { qos: 0, retain: false } });
    const delivered = messages.length;
    assert.equal(await module.readDisplayTemperature(true), false);
    assert.equal(module.getState().available, true);
    assert.equal(messages.length, delivered);
    assert.deepEqual(messages[0], { topic: "heater/input/temperature", payload: "48", options: { qos: 0, retain: false } });
    mockWorker.recognize = async () => ({ data: { text: "", confidence: 0 } });
    assert.equal(await module.readDisplayTemperature(), false);
    assert.equal(messages.at(-1)?.payload, "unavailable");
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

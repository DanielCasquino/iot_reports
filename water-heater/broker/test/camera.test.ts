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
  (module as unknown as { worker: unknown }).worker = mockWorker;
  try {
    assert.equal(await module.capture(), true);
    assert.equal(reads, 2);
    assert.deepEqual(messages[0], { topic: "heater/input/temperature", payload: "48", options: { qos: 0, retain: false } });
    mockWorker.recognize = async () => ({ data: { text: "", confidence: 0 } });
    assert.equal(await module.capture(), false);
    assert.equal(messages.at(-1)?.payload, "unavailable");
    globalThis.fetch = (async () => new Response("error", { status: 503 })) as typeof fetch;
    assert.equal(await module.capture(), false);
    assert.equal(messages.at(-1)?.payload, "unavailable");
  } finally {
    await module.close(); globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.CAMERA_URL; else process.env.CAMERA_URL = oldUrl;
  }
});

test("wake is explicit, guarded by known ON state, and never sends a power command", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.CAMERA_URL;
  process.env.CAMERA_URL = "http://camera.test";
  const jpeg = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).jpeg().toBuffer();
  const messages: { topic: string; payload: string; options: unknown }[] = [];
  const mqtt = { connected: true, publish(topic: string, payload: string, options: unknown, callback?: (e?: Error) => void) {
    messages.push({ topic, payload, options }); callback?.();
  } } as unknown as MqttClient;
  let powered = false;
  const module = new CameraModule(mqtt, () => powered);
  (module as unknown as { worker: unknown }).worker = {
    recognize: async () => ({ data: { text: "48", confidence: 95 } }), terminate: async () => {},
  };
  globalThis.fetch = (async () => new Response(jpeg, { headers: { "content-type": "image/jpeg" } })) as typeof fetch;
  try {
    assert.equal(await module.capture(true), false);
    assert.equal(messages.some(m => m.topic === "heater/command/wake_display"), false);
    powered = true;
    assert.equal(await module.capture(true), true);
    assert.deepEqual(messages.filter(m => m.topic === "heater/command/wake_display"), [
      { topic: "heater/command/wake_display", payload: "tap", options: { qos: 0, retain: false } },
    ]);
    assert.equal(messages.some(m => m.topic === "heater/set/power"), false);
  } finally {
    await module.close(); globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.CAMERA_URL; else process.env.CAMERA_URL = oldUrl;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { classifyDisplayLight, measureDisplayBrightness } from "../src/camera/display-light.js";
import { CameraModule } from "../src/camera/module.js";

test("display brightness uses only the configured region", async () => {
  const white = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  const image = await sharp({ create: { width: 40, height: 20, channels: 3, background: "black" } })
    .composite([{ input: white, left: 20, top: 0 }]).png().toBuffer();
  assert.equal(await measureDisplayBrightness(image), null);
  assert.equal(await measureDisplayBrightness(image, "0,0,20,20"), 0);
  assert.equal(await measureDisplayBrightness(image, "20,0,20,20"), 255);
  for (const region of ["0,,20,20", "-1,0,20,20", "0,0,0,20", "20,0,30,20"])
    await assert.rejects(measureDisplayBrightness(image, region));
});

test("display light requires calibration and leaves an uncertain gap", () => {
  const env = { CAMERA_DISPLAY_DARK_MAX: "40", CAMERA_DISPLAY_LIT_MIN: "70" };
  assert.equal(classifyDisplayLight(31, {}), "unknown");
  assert.equal(classifyDisplayLight(31, env), "dark");
  assert.equal(classifyDisplayLight(55, env), "unknown");
  assert.equal(classifyDisplayLight(80, env), "lit");
  for (const value of [null, NaN, -1, 256]) assert.equal(classifyDisplayLight(value, env), "unknown");
  assert.equal(classifyDisplayLight(31, { ...env, CAMERA_DISPLAY_LIT_MIN: "30" }), "unknown");
});

test("a valid dark frame stays distinct from lost, stale and malformed captures", async () => {
  const keys = ["CAMERA_URL", "CAMERA_SEVEN_SEGMENT", "CAMERA_DISPLAY_REGION", "CAMERA_DISPLAY_DARK_MAX", "CAMERA_DISPLAY_LIT_MIN"];
  const previous = keys.map(key => process.env[key]);
  const fetch = globalThis.fetch;
  const now = Date.now;
  const messages: string[] = [];
  const mqtt = { connected: true, publish(_topic: string, value: string, _options: unknown, done?: () => void) {
    messages.push(value); done?.();
  } };
  const camera = new CameraModule(mqtt as unknown as import("mqtt").MqttClient);
  try {
    Object.assign(process.env, { CAMERA_URL: "http://camera.test", CAMERA_SEVEN_SEGMENT: "true",
      CAMERA_DISPLAY_REGION: "0,0,20,20", CAMERA_DISPLAY_DARK_MAX: "10", CAMERA_DISPLAY_LIT_MIN: "30" });
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "black" } }).jpeg().toBuffer();
    globalThis.fetch = async () => new Response(image, { headers: { "content-type": "image/jpeg" } });
    assert.equal(await camera.readDisplayTemperature(), false);
    assert.equal(camera.getState().displayLight, "dark");
    assert.equal(camera.getState().displayBrightness, 0);
    assert.equal(camera.getState().value, null);
    const capturedAt = Date.parse(camera.getState().observedAt!);
    Date.now = () => capturedAt + 30001;
    assert.equal(camera.getState().displayLight, "unknown");
    Date.now = () => capturedAt - 1;
    assert.equal(camera.getState().displayLight, "unknown");
    Date.now = now;
    process.env.CAMERA_DISPLAY_REGION = "0,0,50,50";
    assert.equal(await camera.readDisplayTemperature(), false);
    assert.equal(camera.getState().displayLight, "unknown");
    assert.equal(camera.getState().displayBrightness, null);
    globalThis.fetch = async () => { throw new Error("Camera disconnected"); };
    assert.equal(await camera.readDisplayTemperature(), false);
    assert.equal(camera.getState().observedAt, null);
    assert.equal(camera.getState().displayLight, "unknown");
    assert.ok(messages.every(value => value === "unavailable"));
  } finally {
    Date.now = now;
    globalThis.fetch = fetch;
    await camera.close();
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

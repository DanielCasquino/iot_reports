import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { SsocrReader } from "../src/camera/ssocr.js";
import { CameraModule } from "../src/camera/module.js";
import type { MqttClient } from "mqtt";

async function fixture(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "ssocr-test-"));
  const binary = join(directory, "reader");
  const marker = join(directory, "marker.json");
  await writeFile(binary, `#!${process.execPath}\nimport fs from 'node:fs';\nconst marker=${JSON.stringify(marker)};\n${source}`, { mode: 0o700 });
  const image = await sharp({ create: { width: 240, height: 180, channels: 3, background: "#ffbb33" } }).png().toBuffer();
  return { directory, binary, marker, image };
}

const successful = `
const args=process.argv.slice(2);const output=args[args.indexOf('-o')+1];
fs.copyFileSync(args.at(-1),output);
fs.writeFileSync(marker,JSON.stringify({args,pid:process.pid,output}));
console.log('31');`;

test("deskew uses image height, two matching filters accept, and private images are removed", async () => {
  const f = await fixture(successful);
  const reader = new SsocrReader(f.binary, .06);
  try {
    const r = await reader.read(f.image);
    assert.equal(r.value, 31); assert.equal(r.visible, true);
    const { args, output } = JSON.parse(await readFile(f.marker, "utf8"));
    assert.equal(args[args.indexOf("shear") + 1], "11");
    assert.equal(existsSync(dirname(output)), false);
  } finally { await reader.close(); await rm(f.directory, { recursive: true, force: true }); }
});

test("contradictory numbers, malformed output and nonzero OCR exits are never accepted", async () => {
  for (const source of [
    "console.log(process.argv.includes('-T')?'32':'31');",
    "console.log('31 extra');",
    "console.log('31');process.exit(2);",
  ]) {
    const f = await fixture(source); const reader = new SsocrReader(f.binary);
    try { assert.equal((await reader.read(f.image)).value, null); }
    finally { await reader.close(); await rm(f.directory, { recursive: true, force: true }); }
  }
});

test("a dark blink phase needs no executable and cannot manufacture a digit", async () => {
  const reader = new SsocrReader("/missing-ssocr");
  try {
    const image = await sharp({ create: { width: 240, height: 180, channels: 3, background: "black" } }).png().toBuffer();
    const r = await reader.read(image);
    assert.equal(r.visible, false); assert.equal(r.value, null);
  } finally { await reader.close(); }
});

test("a missing native binary is a finite actionable failure", async () => {
  const f = await fixture(successful); const reader = new SsocrReader(join(f.directory, "missing"));
  try { await assert.rejects(reader.read(f.image), /install ssocr or set SSOCR_PATH/); }
  finally { await reader.close(); await rm(f.directory, { recursive: true, force: true }); }
});

test("a hung native process is killed, reaped and its input removed", async () => {
  const f = await fixture("fs.writeFileSync(marker,JSON.stringify({pid:process.pid,input:process.argv.at(-1)}));setInterval(()=>{},1000);");
  const reader = new SsocrReader(f.binary, 0, 250);
  try {
    await assert.rejects(reader.read(f.image), /SSOCR timed out/);
    const { pid, input } = JSON.parse(await readFile(f.marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), (e: unknown) => (e as NodeJS.ErrnoException).code === "ESRCH");
    assert.equal(existsSync(dirname(input)), false);
  } finally { await reader.close(); await rm(f.directory, { recursive: true, force: true }); }
});

test("camera routes through SSOCR and retains its MQTT freshness/error contract", async () => {
  const f = await fixture(successful);
  const keys = ["CAMERA_URL", "CAMERA_READER", "SSOCR_PATH", "CAMERA_SSOCR_SHEAR", "CAMERA_CROP", "CAMERA_ROTATION"];
  const before = keys.map(key => process.env[key]); const oldFetch = globalThis.fetch;
  const messages: { topic: string; payload: string; options: unknown }[] = [];
  const mqtt = { connected: true, publish(topic: string, payload: string, options: unknown, callback?: () => void) {
    messages.push({ topic, payload, options }); callback?.();
  } } as unknown as MqttClient;
  process.env.CAMERA_URL = "http://camera.test"; process.env.CAMERA_READER = "ssocr";
  process.env.SSOCR_PATH = f.binary; process.env.CAMERA_SSOCR_SHEAR = ".06";
  delete process.env.CAMERA_CROP; delete process.env.CAMERA_ROTATION;
  globalThis.fetch = async () => new Response(f.image, { headers: { "content-type": "image/jpeg", "x-capture-fresh": "1" } });
  const camera = new CameraModule(mqtt);
  try {
    assert.equal(await camera.readDisplayTemperature(), true);
    assert.equal(camera.getState().reader, "ssocr"); assert.equal(camera.getState().value, 31);
    assert.equal(camera.getState().confidence, null);
    assert.deepEqual(messages.at(-1), { topic: "heater/input/temperature", payload: "31", options: { qos: 0, retain: false } });
    globalThis.fetch = async () => new Response("offline", { status: 503 });
    assert.equal(await camera.readDisplayTemperature(), false);
    assert.equal(camera.getState().value, null); assert.equal(camera.getState().lastValue, 31);
    assert.equal(messages.at(-1)?.payload, "unavailable");
  } finally {
    await camera.close(); globalThis.fetch = oldFetch;
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("closing a running reader reaps the process and does not start another filter", async () => {
  const f = await fixture("fs.writeFileSync(marker,JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);");
  const reader = new SsocrReader(f.binary);
  const reading = reader.read(f.image);
  const failure = assert.rejects(reading, /SSOCR closed/);
  try {
    for (let i = 0; i < 100 && !existsSync(f.marker); i++)
      await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(existsSync(f.marker), true);
    const { pid } = JSON.parse(await readFile(f.marker, "utf8"));
    await reader.close(); await failure;
    assert.throws(() => process.kill(pid, 0), (e: unknown) => (e as NodeJS.ErrnoException).code === "ESRCH");
    await assert.rejects(reader.read(f.image), /SSOCR closed/);
  } finally { await reader.close(); await rm(f.directory, { recursive: true, force: true }); }
});

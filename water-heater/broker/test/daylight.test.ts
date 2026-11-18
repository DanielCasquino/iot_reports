import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { DaylightCalibration, enhanceAmberSegments } from "../src/camera/daylight.js";

test("neutral glare cannot make a digit and bright, dark and displaced scenes stay distinct", async () => {
  const dir = await mkdtemp(join(tmpdir(), "daylight-test-"));
  try {
    const reference = join(dir, "off.png");
    const blank = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#aaa" } }).png().toBuffer();
    await sharp(blank).toFile(reference);
    const calibration = new DaylightCalibration(reference);
    assert.equal(await calibration.inspect(blank, 35), "off-reference");
    assert.equal(await enhanceAmberSegments(blank), null);
    const glint = await sharp({ create: { width: 5, height: 5, channels: 3, background: "white" } }).png().toBuffer();
    const reflection = await sharp(blank).composite([{ input: glint, left: 82, top: 33 }]).png().toBuffer();
    assert.equal(await calibration.inspect(reflection, 35), "off-reference");
    const patch = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#ffb950" } }).png().toBuffer();
    const lit = await sharp(blank).composite([{ input: patch, left: 55, top: 25 }]).png().toBuffer();
    assert.equal(await calibration.inspect(lit, 35), "day");
    assert.ok(await enhanceAmberSegments(lit));
    const night = await sharp(blank).linear(.2).png().toBuffer();
    assert.equal(await calibration.inspect(night, 35), "night");
    assert.equal(calibration.confirm(29, 1000), null);
    assert.equal(calibration.confirm(29, 1500), 29);
    assert.equal(calibration.confirm(30, 1800), null);
    assert.equal(calibration.confirm(30, 4500), null);
    assert.equal(calibration.confirm(null, 4700), null);
    assert.equal(calibration.confirm(30, 4900), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

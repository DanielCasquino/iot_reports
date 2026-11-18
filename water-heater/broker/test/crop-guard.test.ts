import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { selectOcrCrop } from "../src/camera/crop-guard.js";

const primary = "40,0,60,80", guard = "20,0,100,80";
async function image(rect?: { left: number; top: number; width: number; height: number }) {
  const base = sharp({ create: { width: 140, height: 80, channels: 3, background: "black" } });
  return (rect ? base.composite([{ input: {
    create: { width: rect.width, height: rect.height, channels: 3, background: "white" }
  }, left: rect.left, top: rect.top }]) : base).png().toBuffer();
}
test("guard crop requires a bright segment crossing a seam", async () => {
  assert.equal((await selectOcrCrop(await image(), primary, guard)).left, 40);
  assert.equal((await selectOcrCrop(await image({left: 50, top: 10, width: 20, height: 10}), primary, guard)).left, 40);
  assert.equal((await selectOcrCrop(await image({left: 37, top: 10, width: 8, height: 6}), primary, guard)).left, 20);
  assert.equal((await selectOcrCrop(await image({left: 98, top: 20, width: 8, height: 6}), primary, guard)).left, 20);
  assert.equal((await selectOcrCrop(await image({left: 38, top: 10, width: 4, height: 2}), primary, guard)).left, 40);
});
test("invalid or incompatible guard is rejected", async () => {
  const frame = await image();
  for (const invalid of ["x,0,100,80", "41,0,80,80", "20,1,100,79", "20,0,200,80", "20,0,0,80"]) {
    await assert.rejects(selectOcrCrop(frame, primary, invalid));
  }
});

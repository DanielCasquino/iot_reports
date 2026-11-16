import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { IsolatedOcr } from "../src/camera/ocr.js";

function activePid(reader: IsolatedOcr): number {
  return (reader as unknown as { child: { pid: number } }).child.pid;
}
function assertGone(pid: number) {
  assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
}

test("real missing-language failure cannot kill or hang the application; its process is reaped", async () => {
  const directory = mkdtempSync(join(tmpdir(), "heater-ocr-missing-language-"));
  const cwd = process.cwd(), langPath = process.env.OCR_LANG_PATH;
  const reader = new IsolatedOcr();
  const image = await sharp({ create: { width: 40, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  try {
    process.chdir(directory); // No prewarmed model cache can hide the missing asset.
    process.env.OCR_LANG_PATH = join(directory, "missing-language");
    const recognition = reader.recognize(image);
    const pid = activePid(reader);
    await assert.rejects(recognition, /OCR process failed/);
    assertGone(pid);
    assert.equal((reader as unknown as { child: unknown }).child, null);
  } finally {
    await reader.terminate(); process.chdir(cwd);
    if (langPath === undefined) delete process.env.OCR_LANG_PATH; else process.env.OCR_LANG_PATH = langPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("hung, prematurely exiting and oversized-response OCR processes fail finitely and are reaped", async () => {
  const directory = mkdtempSync(join(tmpdir(), "heater-ocr-process-"));
  try {
    for (const [name, source, expected] of [
      ["hang", "process.on('message', () => setInterval(() => {}, 1000));", /OCR timed out/],
      ["exit", "process.once('message', () => process.exit(2));", /OCR process failed/],
      ["oversized", "process.once('message', () => process.send({data:{text:'x'.repeat(129),confidence:90}}));", /Invalid OCR response/],
    ] as const) {
      const file = join(directory, name + ".mjs"); writeFileSync(file, source);
      const reader = new IsolatedOcr(pathToFileURL(file), name === "hang" ? 150 : 3000);
      const recognition = reader.recognize(Buffer.from("finite input"));
      const pid = activePid(reader);
      await assert.rejects(recognition, expected);
      assertGone(pid);
      await reader.terminate();
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("oversized OCR input never starts a process", async () => {
  const reader = new IsolatedOcr();
  await assert.rejects(reader.recognize(Buffer.alloc(1024 * 1024 + 1)), /OCR image/);
  assert.equal((reader as unknown as { child: unknown }).child, null);
});

test("closing a camera reader during OCR waits for the child to be reaped", async () => {
  const directory = mkdtempSync(join(tmpdir(), "heater-ocr-close-"));
  const file = join(directory, "hang.mjs");
  writeFileSync(file, "process.on('message', () => setInterval(() => {}, 1000));");
  const reader = new IsolatedOcr(pathToFileURL(file));
  try {
    const recognition = reader.recognize(Buffer.from("finite input"));
    const pid = activePid(reader);
    const failure = assert.rejects(recognition, /OCR process failed/);
    await reader.terminate();
    await failure;
    assertGone(pid);
  } finally { await reader.terminate(); rmSync(directory, { recursive: true, force: true }); }
});

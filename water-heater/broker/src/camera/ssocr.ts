import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export class SsocrReader {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopped = false;
  private busy = false;

  constructor(private readonly binary = process.env.SSOCR_PATH ?? "ssocr",
    private readonly shear = Number(process.env.CAMERA_SSOCR_SHEAR ?? 0),
    private readonly timeoutMs = 1500) {}

  private run(args: string[]): Promise<string | null> {
    if (this.stopped) return Promise.reject(new Error("SSOCR closed"));
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, { stdio: "pipe", windowsHide: true });
      this.child = child;
      let stdout = "", stderr = "", failure: Error | null = null;
      const fail = (error: Error) => { failure = error; child.kill("SIGKILL"); };
      const timer = setTimeout(() => fail(new Error("SSOCR timed out")), this.timeoutMs);
      child.stdin.on("error", () => fail(new Error("SSOCR input failed")));
      child.stdin.end();
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > 256) fail(new Error("SSOCR output too large"));
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 2048) fail(new Error("SSOCR output too large"));
      });
      child.once("error", () => fail(new Error("Cannot start SSOCR; install ssocr or set SSOCR_PATH")));
      child.once("close", code => {
        clearTimeout(timer);
        this.child = null;
        if (failure) reject(failure);
        else if (this.stopped) reject(new Error("SSOCR closed"));
        else if (code === 1 || code === 2) resolve(null);
        else if (code !== 0) reject(new Error("SSOCR process failed"));
        else resolve(/^\d{2}\s*$/.test(stdout) ? stdout.trim() : null);
      });
    });
  }

  async read(image: Buffer): Promise<{ value: number | null; image: Buffer; visible: boolean }> {
    if (this.stopped) throw new Error("SSOCR closed");
    if (this.busy) throw new Error("SSOCR already running");
    if (!image.length || image.length > 1024 * 1024) throw new Error("SSOCR image must be 1..1048576 bytes");
    if (!Number.isFinite(this.shear) || Math.abs(this.shear) > .25)
      throw new Error("CAMERA_SSOCR_SHEAR must be between -0.25 and 0.25 of image height");
    this.busy = true;
    let directory: string | null = null;
    try {
      const { data, info } = await sharp(image, { limitInputPixels: 4_000_000 })
        .removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
      let amber = 0;
      for (let i = 0; i < data.length; i += info.channels)
        if (.6 * data[i]! + .4 * data[i + 1]! > 60 && data[i]! > data[i + 1]! * .85 &&
            data[i]! > data[i + 2]! * 1.1) amber++;
      const visible = amber / (info.width * info.height) >= .005;
      // A dark blink phase is an observation, never a guessed digit.
      if (!visible) return { value: null, image, visible };
      directory = await mkdtemp(join(tmpdir(), "heater-ssocr-"));
      const input = join(directory, "input.png");
      await writeFile(input, image, { mode: 0o600 });
      const offset = Math.round(info.height * this.shear);
      const readings: { value: number; image: Buffer }[] = [];
      let preview = image;
      for (const [index, threshold] of [["-T"], ["-t", "35"], ["-t", "45"]].entries()) {
        const output = join(directory, `processed-${index}.png`);
        const text = await this.run(["-d", "2", "-c", "digits", "-f", "white", ...threshold,
          "-o", output, ...(offset ? ["shear", String(offset)] : []), input]);
        const processed = await readFile(output).catch(() => image);
        preview = processed;
        if (text !== null) readings.push({ value: Number(text), image: processed });
      }
      const first = readings[0];
      const accepted = first && readings.length >= 2 && readings.every(r => r.value === first.value);
      return { value: accepted ? first.value : null, image: accepted ? first.image : preview, visible };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
      this.busy = false;
    }
  }

  async close() {
    this.stopped = true;
    const child = this.child;
    if (child) {
      const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
      child.kill("SIGKILL");
      await closed;
    }
  }
}

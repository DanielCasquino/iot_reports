import { fork, type ChildProcess } from "node:child_process";

export interface OcrResult { data: { text: string; confidence: number } }
export interface OcrReader { recognize(image: Buffer): Promise<OcrResult>; terminate(): Promise<void> }
const script = new URL(import.meta.url.endsWith(".ts") ? "./ocr-child.ts" : "./ocr-child.js", import.meta.url);

// The installed Tesseract version can throw outside its initialization promise.
// A finite process contains crashes/hangs and makes all of its WASM/threads
// reclaimable, including initialization failures with no returned Worker handle.
export class IsolatedOcr implements OcrReader {
  private child: ChildProcess | null = null;
  constructor(private readonly workerScript = script, private readonly timeoutMs = 15000) {}

  recognize(image: Buffer): Promise<OcrResult> {
    if (!image.length || image.length > 1024 * 1024) return Promise.reject(new Error("OCR image must be 1..1048576 bytes"));
    if (this.child) return Promise.reject(new Error("OCR already running"));
    return new Promise((resolve, reject) => {
      const child = fork(this.workerScript, [], { serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"] });
      this.child = child;
      let result: OcrResult | null = null;
      let error: Error | null = null;
      const fail = (reason: Error) => { error = reason; child.kill("SIGKILL"); };
      const timer = setTimeout(() => fail(new Error("OCR timed out")), this.timeoutMs);
      child.on("message", (message: unknown) => {
        const value = message as OcrResult;
        if (result || !value || typeof value.data?.text !== "string" || value.data.text.length > 128 ||
            !Number.isFinite(value.data.confidence) || value.data.confidence < 0 || value.data.confidence > 100) {
          fail(new Error("Invalid OCR response")); return;
        }
        result = value;
      });
      child.once("error", fail);
      child.once("close", code => {
        clearTimeout(timer);
        this.child = null;
        if (!error && code === 0 && result) resolve(result);
        else reject(error ?? new Error("OCR process failed; verify the language model and configuration"));
      });
      child.send(image, error => { if (error) fail(error); });
    });
  }

  async terminate() {
    const child = this.child;
    if (child) await new Promise<void>(resolve => {
      child.once("close", () => resolve());
      child.kill("SIGKILL");
    });
  }
}

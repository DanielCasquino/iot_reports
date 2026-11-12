import type { Express } from "express";
import type { MqttClient } from "mqtt";
import sharp from "sharp";
import { readSevenSegmentImage } from "./seven-segment.js";
import { createWorker, PSM } from "tesseract.js";
import { parseTemperature } from "./temperature.js";

const INPUT_TOPIC = "heater/input/temperature";
const MAX_IMAGE_BYTES = 1024 * 1024;

export class CameraModule {
  private ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
  private busy = false;
  private image: Buffer | null = null;
  private processed: Buffer | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private state: { available: boolean; value: number | null; lastValue: number | null;
    observedAt: string | null; text: string; confidence: number | null; reader: string; error: string | null } = {
    available: false, value: null, lastValue: null, observedAt: null,
    text: "", confidence: null, reader: "tesseract", error: "No capture yet",
  };

  constructor(private mqtt: MqttClient) {}

  setup(app: Express) {
    app.get("/api/camera/status", (_req, res) => res.set("Cache-Control", "no-store").json(this.getState()));
    app.get("/api/camera/image", (_req, res) => {
      if (!this.image) { res.status(404).end(); return; }
      res.set("Cache-Control", "no-store").type("jpeg").send(this.image);
    });
    app.get("/api/camera/processed", (_req, res) => {
      if (!this.processed) { res.status(404).end(); return; }
      res.set("Cache-Control", "no-store").type("png").send(this.processed);
    });
    app.post("/api/camera/capture", async (req, res) => {
      if (this.busy) { res.status(409).json({ error: "Capture already running" }); return; }
      const ok = await this.readDisplayTemperature(req.query.wake === "1");
      res.status(ok ? 200 : 422).json(this.getState());
    });
    const interval = Number(process.env.CAMERA_POLL_MS ?? 5000);
    if (!Number.isFinite(interval) || interval < 0 || (interval > 0 && interval < 1000))
      throw new Error("CAMERA_POLL_MS must be 0 (manual) or at least 1000");
    if (process.env.CAMERA_URL && interval > 0) {
      const poll = async () => {
        if (!this.busy) await this.readDisplayTemperature();
        if (!this.stopped) this.timer = setTimeout(poll, interval);
      };
      this.timer = setTimeout(poll, 0);
    }
  }

  getState() {
    const fresh = this.state.observedAt !== null && Date.now() - Date.parse(this.state.observedAt) <= 30000;
    return { ...this.state, available: this.state.available && fresh,
      value: this.state.available && fresh ? this.state.value : null };
  }

  private async requestCameraJpeg(): Promise<Buffer> {
    const base = process.env.CAMERA_URL;
    if (!base) throw new Error("Set CAMERA_URL=http://<camera-IP> in broker/.env");
    const url = new URL("/capture", base);
    url.searchParams.set("t", String(Date.now()));
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!response.ok || !response.headers.get("content-type")?.includes("image/jpeg") || !response.body)
      throw new Error(`Camera did not return JPEG (HTTP ${response.status})`);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_IMAGE_BYTES) { await response.body.cancel().catch(() => {}); throw new Error("Camera image too large"); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async readDisplayTemperature(wake = false): Promise<boolean> {
    if (this.busy || this.stopped) return false;
    if (wake) {
      this.state.error = "Display wake taps are disabled; capture without pressing power";
      return false;
    }
    this.busy = true;
    let capturedAt: string | null = null;
    try {
      await this.requestCameraJpeg();
      this.image = await this.requestCameraJpeg();
      this.processed = null;
      const observedAt = new Date().toISOString();
      capturedAt = observedAt;
      let pipeline = sharp(this.image, { limitInputPixels: 4_000_000 });
      const crop = process.env.CAMERA_CROP;
      if (crop) {
        const values = crop.split(",").map(Number);
        if (values.length !== 4 || values.some((v) => !Number.isInteger(v)) ||
            values[0]! < 0 || values[1]! < 0 || values[2]! <= 0 || values[3]! <= 0)
          throw new Error("CAMERA_CROP must be left,top,width,height in image pixels");
        pipeline = pipeline.extract({ left: values[0]!, top: values[1]!, width: values[2]!, height: values[3]! });
      }
      const sevenSegment = process.env.CAMERA_SEVEN_SEGMENT === "true";
      let value: number | null;
      let text: string;
      let confidence: number | null = null;
      if (sevenSegment) {
        if (!crop) throw new Error("Set CAMERA_CROP around the two digits for seven-segment mode");
        const reading = await readSevenSegmentImage(await pipeline.png().toBuffer());
        this.processed = reading.image;
        value = reading.value;
        text = value === null ? "" : String(value);
      } else {
        pipeline = pipeline.resize({ width: 800 }).grayscale().normalise();
        if (process.env.CAMERA_INVERT === "true") pipeline = pipeline.negate();
        if (process.env.CAMERA_THRESHOLD) {
          const threshold = Number(process.env.CAMERA_THRESHOLD);
          if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255)
            throw new Error("CAMERA_THRESHOLD must be 0..255");
          pipeline = pipeline.threshold(threshold);
        }
        this.processed = await pipeline.png().toBuffer();
        if (!this.ocrWorker) {
          this.ocrWorker = await createWorker("eng", 1, process.env.OCR_LANG_PATH ? { langPath: process.env.OCR_LANG_PATH } : {});
          await this.ocrWorker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE,
            tessedit_char_whitelist: "0123456789.,Cc°" });
        }
        const { data } = await this.ocrWorker.recognize(this.processed);
        const minimumConfidence = Number(process.env.CAMERA_MIN_CONFIDENCE ?? 80);
        if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 100)
          throw new Error("CAMERA_MIN_CONFIDENCE must be 0..100");
        value = parseTemperature(data.text, data.confidence, minimumConfidence);
        text = data.text.trim();
        confidence = data.confidence;
      }
      if (Date.now() - Date.parse(observedAt) > 15000) throw new Error("OCR result too old; capture again");
      this.state = { ...this.state, available: value !== null, value, observedAt,
        text, confidence, reader: sevenSegment ? "seven-segment" : "tesseract", error: value === null ? (sevenSegment ? "Ambiguous or incomplete seven-segment display" : "Unreadable or low-confidence display") : null };
      if (value === null) throw new Error(this.state.error!);
      if (!this.mqtt.connected) throw new Error("MQTT disconnected; reading not delivered");
      await new Promise<void>((resolve, reject) => {
        this.mqtt.publish(INPUT_TOPIC, String(value), { qos: 0, retain: false }, (error) => error ? reject(error) : resolve());
      });
      this.state.lastValue = value;
      return true;
    } catch (error) {
      this.state = { ...this.state, available: false, value: null, observedAt: capturedAt,
        error: error instanceof Error ? error.message : "Capture failed" };
      if (this.mqtt.connected) this.mqtt.publish(INPUT_TOPIC, "unavailable", { qos: 0, retain: false });
      return false;
    } finally { this.busy = false; }
  }

  async close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.ocrWorker) await this.ocrWorker.terminate();
  }
}

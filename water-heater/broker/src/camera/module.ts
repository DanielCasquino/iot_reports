import type { Express } from "express";
import type { MqttClient } from "mqtt";
import sharp from "sharp";
import { selectOcrCrop } from "./crop-guard.js";
import { readSevenSegmentImage } from "./seven-segment.js";
import { IsolatedOcr, type OcrReader } from "./ocr.js";
import { SsocrReader } from "./ssocr.js";
import { parseTemperature } from "./temperature.js";
import { classifyDisplayLight, measureDisplayBrightness } from "./display-light.js";
import { controlLog } from "../heater/control-log.js";

export interface DisplayFrame {
  value: number | null; visible: boolean; observedAt: number;
  purpose: "water" | "target" | "mirror" | "wake";
  light?: "dark" | "lit" | "unknown";
  brightness?: number | null;
  captureStartedAt?: number;
}

const MIRROR_TOPIC = "heater/input/display";
const INPUT_TOPIC = "heater/input/temperature";
const MAX_IMAGE_BYTES = 1024 * 1024;

export class CameraModule {
  private ocrWorker: OcrReader | null = null;
  private ssocr: SsocrReader | null = null;
  private busy = false;
  private image: Buffer | null = null;
  private processed: Buffer | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private mirrorState: { text: string; observedAt: string | null } = { text: "unknown", observedAt: null };
  private mirrorLogSignature = "";
  private captureDiagnostic = "";
  private captureLoggedAt = Number.NEGATIVE_INFINITY;
  private lastTemperaturePollAt = 0;
  private verificationId: string | null = null;
  private verificationPurpose: "target" | "wake" | null = null;
  private verificationAttempts = 0;
  private verificationStartedAt = 0;
  private targetBlankSeen = false;
  private mqttGeneration = 0;
  private state: { available: boolean; value: number | null; lastValue: number | null;
    observedAt: string | null; text: string; confidence: number | null; reader: string; error: string | null;
    displayBrightness: number | null; displayLight: "dark" | "lit" | "unknown" } = {
    available: false, value: null, lastValue: null, observedAt: null,
    text: "", confidence: null, reader: "tesseract", error: "No capture yet",
    displayBrightness: null, displayLight: "unknown",
  };

  constructor(private mqtt: MqttClient, private readonly onDisplayFrame?: (frame: DisplayFrame) => boolean | void) {}

  private subscribeVerification = () => {
    this.invalidateMqttSession();
    this.mqtt.subscribe("heater/command/verify_temperature");
    this.mqtt.subscribe("heater/command/verify_wake");
  };
  private invalidateMqttSession = () => {
    this.mqttGeneration++;
    this.verificationId = null;
    this.verificationPurpose = null;
    this.verificationAttempts = 0;
    this.verificationStartedAt = 0;
    this.targetBlankSeen = false;
  };
  private handleMqttMessage = (topic: string, payload: Buffer, packet: { retain?: boolean }) => {
    if (topic === "heater/status" && (!packet.retain || payload.toString() === "offline")) {
      this.invalidateMqttSession();
      return;
    }
    if (!["heater/command/verify_temperature", "heater/command/verify_wake"].includes(topic) || packet.retain) return;
    const purpose = topic === "heater/command/verify_wake" ? "wake" : "target";
    const id = payload.toString();
    if (!/^\d{1,10}$/.test(id) || Number(id) > 0xffffffff) return;
    if (id !== this.verificationId || purpose !== this.verificationPurpose) {
      this.verificationId = id;
      this.verificationPurpose = purpose;
      this.verificationAttempts = 0;
      this.verificationStartedAt = Date.now();
      this.targetBlankSeen = false;
      controlLog("camera_verification_started", { verificationId: id, purpose,
        required: purpose === "target" ? "fresh_selection_blank_then_digits" : "fresh_visible_digits" });
    }
    const limit = purpose === "target" ? 6 : 3;
    if (this.busy || this.verificationAttempts >= limit || Date.now() - this.verificationStartedAt >= 4500) return;
    this.verificationAttempts++;
    void this.readDisplayTemperature(false, id, false, purpose === "wake");
  };

  setup(app: Express) {
    this.mqtt.on("connect", this.subscribeVerification);
    this.mqtt.on("offline", this.invalidateMqttSession);
    this.mqtt.on("close", this.invalidateMqttSession);
    this.mqtt.on("message", this.handleMqttMessage);
    if (this.mqtt.connected) this.subscribeVerification();
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
    const mirrorInterval = Number(process.env.CAMERA_MIRROR_POLL_MS ?? 0);
    if (!Number.isFinite(mirrorInterval) || mirrorInterval < 0 || (mirrorInterval > 0 && mirrorInterval < 200))
      throw new Error("CAMERA_MIRROR_POLL_MS must be 0 or at least 200");
    if (process.env.CAMERA_URL && (interval > 0 || mirrorInterval > 0)) {
      const poll = async () => {
        const normalDue = interval > 0 && Date.now() - this.lastTemperaturePollAt >= interval &&
          Date.now() - this.verificationStartedAt >= 5000;
        if (!this.busy && (normalDue || mirrorInterval > 0)) {
          if (normalDue) this.lastTemperaturePollAt = Date.now();
          await this.readDisplayTemperature(false, undefined, !normalDue);
        }
        if (!this.stopped) this.timer = setTimeout(poll, mirrorInterval > 0 ? mirrorInterval : interval);
      };
      this.timer = setTimeout(poll, 0);
    }
  }

  getState() {
    const age = this.state.observedAt === null ? NaN : Date.now() - Date.parse(this.state.observedAt);
    const fresh = Number.isFinite(age) && age >= 0 && age <= 30000;
    return { ...this.state, displayMirror: { ...this.mirrorState }, available: this.state.available && fresh,
      value: this.state.available && fresh ? this.state.value : null,
      displayBrightness: fresh ? this.state.displayBrightness : null,
      displayLight: fresh ? this.state.displayLight : "unknown" };
  }

  private logCaptureAvailability(state: string, now = Date.now()) {
    if (state === this.captureDiagnostic || now - this.captureLoggedAt < 10000) return;
    this.captureDiagnostic = state;
    this.captureLoggedAt = now;
    controlLog("camera_capture_connection", { status: state });
  }

  private async requestCameraJpeg(): Promise<{ image: Buffer; fresh: boolean }> {
    const base = process.env.CAMERA_URL;
    if (!base) throw new Error("Set CAMERA_URL=http://<camera-IP> in broker/.env");
    const url = new URL("/capture", base);
    url.searchParams.set("t", String(Date.now()));
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!response.ok || !response.headers.get("content-type")?.includes("image/jpeg") || !response.body) {
      const code = response.ok ? "NOT_JPEG" : `HTTP_${response.status}`;
      throw Object.assign(new Error(`Camera did not return JPEG (HTTP ${response.status})`), { code });
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_IMAGE_BYTES) { await response.body.cancel().catch(() => {}); throw new Error("Camera image too large"); }
      chunks.push(chunk);
    }
    return { image: Buffer.concat(chunks), fresh: response.headers.get("x-capture-fresh") === "1" };
  }

  async readDisplayTemperature(wake = false, verificationId?: string, mirrorOnly = false, wakeVerification = false): Promise<boolean> {
    if (this.busy || this.stopped) return false;
    if (wake) {
      this.state.error = "Display wake taps are disabled; capture without pressing power";
      return false;
    }
    this.busy = true;
    const captureStartedAt = Date.now();
    const targetRequestAtCapture = this.verificationId;
    let frameReported = false;
    const mqttGeneration = this.mqttGeneration;
    let readingState = { ...this.state };
    const waterReading = !mirrorOnly && verificationId === undefined;
    let capturedAt: string | null = null;
    let mirrored = false;
    let captureSucceeded = false;
    try {
      const firstFrame = await this.requestCameraJpeg();
      // New firmware flushes its queued buffer inside /capture. Keep a bounded
      // two-request fallback for older cameras, including mirror-only reads.
      this.image = firstFrame.fresh ? firstFrame.image : (await this.requestCameraJpeg()).image;
      this.processed = null;
      const observedAt = new Date().toISOString();
      capturedAt = observedAt;
      this.logCaptureAvailability("ok");
      readingState = { ...readingState, displayBrightness: null, displayLight: "unknown" };
      const displayBrightness = await measureDisplayBrightness(this.image, process.env.CAMERA_DISPLAY_REGION);
      readingState = { ...readingState, displayBrightness, displayLight: classifyDisplayLight(displayBrightness) };
      const reader = process.env.CAMERA_READER ??
        (process.env.CAMERA_SEVEN_SEGMENT === "true" ? "seven-segment" : "tesseract");
      if (!["ssocr", "seven-segment", "tesseract"].includes(reader))
        throw new Error("CAMERA_READER must be ssocr, seven-segment or tesseract");
      let pipeline = sharp(this.image, { limitInputPixels: 4_000_000 });
      const crop = process.env.CAMERA_CROP;
      const guard = process.env.CAMERA_OCR_GUARD_CROP;
      if (reader === "ssocr" && guard && !crop)
        throw new Error("CAMERA_OCR_GUARD_CROP requires CAMERA_CROP");
      if (crop) {
        const values = crop.split(",").map(Number);
        if (values.length !== 4 || values.some((v) => !Number.isInteger(v)) ||
            values[0]! < 0 || values[1]! < 0 || values[2]! <= 0 || values[3]! <= 0)
          throw new Error("CAMERA_CROP must be left,top,width,height in image pixels");
        const selected = reader === "ssocr" && guard
          ? await selectOcrCrop(this.image, crop, guard)
          : { left: values[0]!, top: values[1]!, width: values[2]!, height: values[3]! };
        pipeline = pipeline.extract(selected);
      }
      const rotation = Number(process.env.CAMERA_ROTATION ?? 0);
      if (![0, 90, 180, 270].includes(rotation)) throw new Error("CAMERA_ROTATION must be 0, 90, 180 or 270");
      pipeline = pipeline.rotate(rotation);
      readingState = { ...readingState, reader };
      let value: number | null;
      let text: string;
      let confidence: number | null = null;
      // OCR failure alone does not establish a visibly lit display. Without
      // calibrated light or readable digits it must not authorize a wake tap.
      let displayVisible = readingState.displayLight === "lit";
      if (reader !== "tesseract") {
        const input = await pipeline.png().toBuffer();
        if (reader === "ssocr") this.ssocr ??= new SsocrReader();
        const reading = reader === "ssocr" ? await this.ssocr!.read(input) : await readSevenSegmentImage(input);
        this.processed = reading.image;
        value = reading.value;
        displayVisible = reading.visible;
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
        this.ocrWorker ??= new IsolatedOcr();
        const { data } = await this.ocrWorker.recognize(this.processed);
        const minimumConfidence = Number(process.env.CAMERA_MIN_CONFIDENCE ?? 80);
        if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 100)
          throw new Error("CAMERA_MIN_CONFIDENCE must be 0..100");
        value = parseTemperature(data.text, data.confidence, minimumConfidence);
        text = data.text.trim();
        confidence = data.confidence;
      }
      if (Date.now() - Date.parse(observedAt) > 15000) throw new Error("OCR result too old; capture again");
      // The heater can show cold water below its minimum setpoint, but an OCR
      // value above its75C maximum must not flash on the mirror or enter control.
      const rejectedValue = value !== null && value > 75 ? value : null;
      if (rejectedValue !== null) {
        controlLog("camera_reading_rejected", { value: rejectedValue, reason: "outside_heater_range", maximum: 75 });
        value = null;
      }
      readingState = { ...readingState, available: value !== null, value, observedAt,
        text, confidence, reader, error: rejectedValue !== null ? "Reading outside heater range (0-75C)" :
          value === null ? (reader !== "tesseract" ? "Ambiguous or incomplete seven-segment display" : "Unreadable or low-confidence display") : null };
      if (this.stopped) throw new Error("Camera stopped during capture");
      const sameSession = mqttGeneration === this.mqttGeneration;
      const activeTarget = sameSession && this.verificationPurpose === "target" && this.verificationId !== null &&
        targetRequestAtCapture === this.verificationId &&
        captureStartedAt >= this.verificationStartedAt && Date.now() - this.verificationStartedAt < 4500;
      if (activeTarget && value === null && !displayVisible && (reader !== "tesseract" || readingState.displayLight === "dark"))
        this.targetBlankSeen = true;
      if (activeTarget) {
        controlLog("camera_target_frame", { verificationId: this.verificationId, value, visible: displayVisible,
          light: readingState.displayLight, captureStartedAt, capturedAt, selectionBlankSeen: this.targetBlankSeen,
          decision: verificationId !== undefined && verificationId !== this.verificationId ? "stale_verification_capture" :
            value === null ? "waiting_for_digits" : value < 30 || value > 75 ? "blocked_outside_target_range" :
            verificationId === undefined && !mirrorOnly ? "water_poll_only" :
            this.targetBlankSeen ? "eligible_for_verification" : "blocked_missing_selection_blink" });
      }
      frameReported = true;
      const waterAccepted = sameSession ? this.onDisplayFrame?.({ value, visible: displayVisible, observedAt: Date.parse(observedAt),
        light: readingState.displayLight, brightness: readingState.displayBrightness, captureStartedAt,
        purpose: verificationId !== undefined ? wakeVerification ? "wake" : "target" : mirrorOnly ? "mirror" : "water" }) : false;
      captureSucceeded = value !== null;
      if (value !== null) readingState.lastValue = value;
      if (value !== null) this.mirrorState = { text: String(value), observedAt };
      const rawMirrorText = value !== null ? String(value) : displayVisible ? "unknown" : "blank";
      if (this.mqtt.connected && mqttGeneration === this.mqttGeneration && !this.stopped) {
        this.publishMirror(rawMirrorText, observedAt, rejectedValue, value !== null && waterReading && waterAccepted !== false);
        mirrored = true;
      }
      if (value === null) throw new Error(readingState.error!);
      // Seeing the visor is independent of controller availability. Only water
      // delivery/verification belongs to a live, unchanged controller session.
      if (!sameSession || !this.mqtt.connected) return true;
      // A readable number may still be a setpoint/blink/recovery frame. The
      // panel/controller must accept it as water before it enters the control path.
      if (waterReading && waterAccepted === false) {
        this.mqtt.publish(INPUT_TOPIC, "unavailable", { qos: 0, retain: false });
        return true;
      }
      if (mirrorOnly) {
        // The normal polling loop may see digits while explicit verification
        // captures coincide with blink blanks. Reuse only a new capture from
        // this active request, after its blank proof; MCU still requires two
        // agreeing candidates and enforces its own shorter selection deadline.
        if (activeTarget && this.targetBlankSeen)
          this.sendVerificationCandidate(this.verificationId!, value, false, "mirror");
        return true;
      }
      if (waterReading) await new Promise<void>((resolve, reject) => {
        this.mqtt.publish(INPUT_TOPIC, String(value), { qos: 0, retain: false }, (error) => error ? reject(error) : resolve());
      });
      if (verificationId !== undefined) {
        // A steady water number is not a setpoint, even if two captures agree.
        // Active target requests require a fresh blank phase of selection.
        if (!wakeVerification && verificationId === this.verificationId && !this.targetBlankSeen) return true;
        this.sendVerificationCandidate(verificationId, value, wakeVerification, "verification");
      }
      return true;
    } catch (error) {
      if (capturedAt === null && !this.stopped) {
        const detail = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
        const code = detail?.cause?.code ?? detail?.code;
        this.logCaptureAvailability(typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code)
          ? code : detail?.name === "TimeoutError" ? "TIMEOUT" : "FETCH_FAILED");
      }
      if (!frameReported && mqttGeneration === this.mqttGeneration && !this.stopped)
        this.onDisplayFrame?.({ value: null, visible: false, observedAt: Date.now(),
          light: "unknown", brightness: null, captureStartedAt, purpose: "mirror" });
      readingState = { ...readingState, available: captureSucceeded,
        value: captureSucceeded ? readingState.value : null, observedAt: capturedAt,
        error: captureSucceeded ? null : error instanceof Error ? error.message : "Capture failed" };
      if (this.mqtt.connected && mqttGeneration === this.mqttGeneration && !this.stopped) {
        if (!mirrored) this.publishMirror("unknown", capturedAt, null);
        if (waterReading) this.mqtt.publish(INPUT_TOPIC, "unavailable", { qos: 0, retain: false });
      }
      return captureSucceeded;
    } finally {
      this.state = readingState;
      this.busy = false;
    }
  }

  private publishMirror(rawText: string, capturedAt: string | null, rejectedValue: number | null, waterEligible = false) {
    // Retain only the OLED presentation. Blank/failed captures remain invalid
    // for temperature/control and still establish selection blink separately.
    const { text, observedAt } = this.mirrorState;
    const held = rawText !== text;
    this.mqtt.publish(MIRROR_TOPIC, text, { qos: 0, retain: false });
    const signature = JSON.stringify([text, rawText, rejectedValue, held, waterEligible]);
    if (signature === this.mirrorLogSignature) return;
    this.mirrorLogSignature = signature;
    controlLog("display_mirror_sent", { topic: MIRROR_TOPIC, text, rawText, observedAt, capturedAt, rejectedValue, held, waterEligible,
      effect: text === "unknown" ? "no_valid_reading_yet" : held ? "show_last_coherent" : "show_new_reading",
      delivery: "published_to_mqtt" });
  }

  private sendVerificationCandidate(verificationId: string, value: number, wake: boolean, origin: "mirror" | "verification") {
    if (!wake && (value < 30 || value > 75)) {
      controlLog("camera_candidate_rejected", { verificationId, value, origin, reason: "outside_target_range" });
      return;
    }
    this.mqtt.publish(wake ? "heater/input/wake_verification" : "heater/input/temperature_verification",
      `${verificationId},${value}`, { qos: 0, retain: false });
    controlLog("camera_candidate_sent", { verificationId, value, purpose: wake ? "wake" : "target", origin,
      selectionBlankSeen: wake ? null : this.targetBlankSeen, controllerConfirmationPending: true });
  }

  async close() {
    this.stopped = true;
    this.invalidateMqttSession();
    this.mqtt.removeListener?.("connect", this.subscribeVerification);
    this.mqtt.removeListener?.("offline", this.invalidateMqttSession);
    this.mqtt.removeListener?.("close", this.invalidateMqttSession);
    this.mqtt.removeListener?.("message", this.handleMqttMessage);
    if (this.timer) clearTimeout(this.timer);
    if (this.ocrWorker) await this.ocrWorker.terminate();
    if (this.ssocr) await this.ssocr.close();
  }
}

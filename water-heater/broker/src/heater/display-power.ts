import type { DisplayFrame } from "../camera/module.js";
import type { PilotState } from "./state.js";

// A number and the presence of a lit visor are separate observations. In
// particular, neither an OCR rejection nor a missing camera frame proves OFF.
export class DisplayPowerObservation {
  private power: boolean | null = null;
  private confirmedAt = -Infinity;
  private lastFrameAt = -Infinity;
  private captureAfter = -Infinity;
  private darkSince: number | null = null;
  private darkFrames = 0;
  private litSince: number | null = null;
  private brightness: number | null = null;
  private readySeen = false;
  private standbySince: number | null = null;

  reset(captureAfter = Date.now()) {
    this.power = null;
    this.confirmedAt = this.lastFrameAt = -Infinity;
    this.captureAfter = Math.max(this.captureAfter, captureAfter);
    this.darkSince = this.litSince = null;
    this.darkFrames = 0;
    this.readySeen = false;
    this.standbySince = null;
  }

  acceptsCapture(frame: DisplayFrame, now = Date.now()) {
    const at = frame.observedAt;
    return Number.isFinite(at) && at <= now && now - at <= 3000 && (frame.captureStartedAt ?? at) >= this.captureAfter;
  }

  observe(frame: DisplayFrame, controllerIdle: boolean, pilot: PilotState, now = Date.now()) {
    const at = frame.observedAt;
    if (!this.acceptsCapture(frame, now) || at <= this.lastFrameAt) return;
    const continuous = at - this.lastFrameAt <= 3000;
    this.lastFrameAt = at;
    this.brightness = frame.brightness ?? null;
    if (!continuous) {
      this.darkSince = this.litSince = null;
      this.darkFrames = 0;
      this.standbySince = null;
    }
    if (!controllerIdle || frame.purpose === "target" || frame.purpose === "wake") {
      this.reset(at);
      return;
    }
    const number = frame.value !== null && Number.isInteger(frame.value) && frame.value >= 0 && frame.value <= 100;
    if (pilot === "ready") this.readySeen = true;
    if (pilot === "heating") { this.readySeen = false; this.standbySince = null; }
    if (number || (frame.visible && frame.light === "lit")) {
      this.darkSince = null;
      this.darkFrames = 0;
      this.litSince ??= at;
      if (number || at - this.litSince >= 1000) {
        this.power = true;
        this.confirmedAt = at;
      }
      // GREEN -> dim remains ON. A calibrated dim visor with an unlit pilot
      // also recovers standby after startup, when its earlier GREEN was unseen.
      if (this.brightness !== null && this.brightness < 180 && pilot !== "heating" && (this.readySeen || pilot === "unlit"))
        this.standbySince ??= at;
      else this.standbySince = null;
    } else if (frame.light === "dark" && !frame.visible && pilot !== "heating" && pilot !== "ready") {
      this.standbySince = null;
      this.litSince = null;
      this.darkSince ??= at;
      this.darkFrames++;
      // Covers the whole ~5s selection/blink window, with multiple independent
      // captures. A gap, ambiguous frame, active pilot or failed capture resets it.
      if (this.darkFrames >= 4 && at - this.darkSince >= 6500) {
        this.power = false;
        this.confirmedAt = at;
        this.readySeen = false;
      }
    } else {
      this.standbySince = null;
      if (pilot === "heating" || pilot === "ready") {
        this.power = null;
        this.confirmedAt = -Infinity;
      }
      this.darkSince = this.litSince = null;
      this.darkFrames = 0;
    }
  }

  snapshot(now = Date.now()) {
    const fresh = now >= this.confirmedAt && now - this.confirmedAt <= 3000;
    const power = fresh ? this.power : null;
    const mode = power === false ? "off" : power === true
      ? this.standbySince !== null && now - this.standbySince >= 1000 ? "standby" : "on" : "unknown";
    return { power, mode, display: power === false ? "off" : power === true
      ? this.brightness !== null && this.brightness < 180 ? "dim" : "lit" : "unknown",
      observedAt: fresh ? this.confirmedAt : null };
  }
}

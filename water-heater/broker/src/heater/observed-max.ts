import type { DisplayFrame } from "../camera/module.js";

// Display evidence is presentation only and never sets an actuator target.
export class ObservedMaximum {
  private firstValue: number | null = null;
  private firstAt = 0;
  private lastAt = -Infinity;
  private blankSeen = false;
  private value: number | null = null;
  private observedAt: number | null = null;
  private selectedUntil = -Infinity;

  clear() {
    this.firstValue = null;
    this.blankSeen = false;
    this.value = null;
    this.observedAt = null;
    this.selectedUntil = -Infinity;
  }

  observe(frame: DisplayFrame, now = Date.now()) {
    const at = frame.observedAt;
    if (!Number.isFinite(at) || at <= this.lastAt || at > now || now - at > 3000 ||
        !Number.isFinite(frame.captureStartedAt) || frame.captureStartedAt! > at || frame.captureStartedAt! <= this.lastAt ||
        frame.light === "unknown" || frame.light === undefined) {
      this.firstValue = null;
      this.blankSeen = false;
      this.selectedUntil = -Infinity;
      return;
    }
    this.lastAt = at;
    if (this.firstValue !== null && at - this.firstAt > 5000) {
      this.firstValue = null;
      this.blankSeen = false;
    }
    if (frame.light === "dark" && !frame.visible && frame.value === null) {
      if (this.firstValue !== null) this.blankSeen = true;
      if (this.selectedUntil >= at) this.selectedUntil = at + 6000;
      return;
    }
    if (!frame.visible || frame.value === null || !Number.isInteger(frame.value) ||
        frame.value < 30 || frame.value > 75) {
      this.firstValue = null;
      this.blankSeen = false;
      return;
    }
    if (frame.light !== "lit") {
      this.firstValue = null;
      this.blankSeen = false;
      return;
    }
    if (this.blankSeen && this.firstValue === frame.value) {
      this.value = frame.value;
      this.observedAt = at;
      this.selectedUntil = at + 6000;
      this.firstValue = null;
      this.blankSeen = false;
      return;
    }
    if (this.firstValue === null || this.firstValue !== frame.value) {
      this.firstValue = frame.value;
      this.firstAt = at;
      this.blankSeen = false;
    }
  }

  snapshot(now = Date.now()) {
    if (this.observedAt === null || now < this.observedAt || now - this.observedAt > 300000)
      return { temperatureMax: null, temperatureMaxObservedAt: null, temperatureMaxSelected: false };
    return { temperatureMax: this.value, temperatureMaxObservedAt: new Date(this.observedAt).toISOString(),
      temperatureMaxSelected: now <= this.selectedUntil };
  }
}

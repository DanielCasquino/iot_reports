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
    this.resetCandidate();
    this.value = null;
    this.observedAt = null;
    this.selectedUntil = -Infinity;
  }

  private resetCandidate() {
    this.firstValue = null;
    this.blankSeen = false;
  }

  observe(frame: DisplayFrame, now = Date.now()) {
    const at = frame.observedAt;
    const startedAt = frame.captureStartedAt;
    if (!Number.isFinite(at) || at <= this.lastAt || at > now || now - at > 3000 ||
        startedAt === undefined || !Number.isFinite(startedAt) || startedAt > at || startedAt <= this.lastAt) {
      this.resetCandidate();
      return;
    }
    this.lastAt = at;
    if (this.firstValue !== null && at - this.firstAt > 5000) {
      this.resetCandidate();
    }
    if (frame.light === "dark" && !frame.visible && frame.value === null) {
      if (this.firstValue !== null) this.blankSeen = true;
      return;
    }
    if (frame.light !== "lit" || !frame.visible || frame.value === null || !Number.isInteger(frame.value) ||
        frame.value < 30 || frame.value > 75) {
      this.resetCandidate();
      return;
    }
    if (this.blankSeen && this.firstValue === frame.value) {
      this.value = frame.value;
      this.observedAt = at;
      this.selectedUntil = at + 6000;
      this.resetCandidate();
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

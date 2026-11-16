export type PanelMode = "unknown" | "on" | "off" | "water" | "standby" | "target";
export type PanelButton = "power" | "plus" | "minus";
export type ButtonEffect = "unknown" | "power_on" | "power_off" | "wake" | "show_target" | "increase" | "decrease";
export type PanelEffect = "press_plus" | "capture_water" | "failed";
type RecoveryPhase = "idle" | "settling" | "reading" | "failed";

const buttonEffects: Record<PanelMode, Record<PanelButton, ButtonEffect>> = {
  unknown: { power: "unknown", plus: "unknown", minus: "unknown" },
  on: { power: "unknown", plus: "unknown", minus: "unknown" },
  off: { power: "power_on", plus: "unknown", minus: "unknown" },
  water: { power: "power_off", plus: "show_target", minus: "show_target" },
  standby: { power: "wake", plus: "wake", minus: "wake" },
  target: { power: "power_off", plus: "increase", minus: "decrease" },
};

export class HeaterPanelState {
  private mode: PanelMode = "unknown";
  private power: boolean | null = null;
  private water: number | null = null;
  private target: number | null = null;
  private observedAt = -Infinity;
  private waterAt = -Infinity;
  private targetAt = -Infinity;
  private frameAt = -Infinity;
  private lastBlankAt = -Infinity;
  private unreadableSince: number | null = null;
  private visible = false;
  private phase: RecoveryPhase = "idle";
  private attempts = 0;
  private deadline = 0;
  private lastWakeAt = -Infinity;

  constructor(private readonly startedAt = Date.now()) {}

  disconnect() {
    // A recovery belongs to one controller session. Keep its attempt budget,
    // but never let its delayed capture survive a reconnect.
    this.mode = "unknown";
    this.power = null;
    this.observedAt = this.waterAt = this.targetAt = this.frameAt = -Infinity;
    this.visible = false;
    this.unreadableSince = null;
    this.phase = "idle";
  }

  buttonEffect(button: PanelButton): ButtonEffect {
    return buttonEffects[this.mode][button];
  }

  observeStandby(now: number) {
    this.mode = "standby";
    this.power = true;
    this.observedAt = now;
    this.unreadableSince = null;
    this.phase = "idle";
    // Knowing the visor mode does not refresh a previous water measurement.
  }

  observeMode(mode: Exclude<PanelMode, "unknown">, value: number | null, now: number) {
    if (mode === "target" && (value === null || value < 30 || value > 75)) return;
    if (mode !== "off" && (value === null || !Number.isInteger(value) || value < 0 || value > 100)) return;
    this.mode = mode;
    this.power = mode !== "off";
    if (mode === "water" || mode === "standby") { this.water = value; this.waterAt = now; }
    if (mode === "target") { this.target = value; this.targetAt = now; }
    this.observedAt = now;
    this.unreadableSince = null;
  }

  observeFrame(frame: { value: number | null; visible: boolean; observedAt: number;
    purpose: "water" | "target" | "mirror" | "wake" }, controllerIdle: boolean) {
    const now = frame.observedAt;
    if (!Number.isFinite(now) || now < this.frameAt) return;
    this.frameAt = now;
    const validNumber = frame.value !== null && Number.isInteger(frame.value) && frame.value >= 0 && frame.value <= 100;
    this.visible = frame.visible || validNumber;
    if (!this.visible) this.lastBlankAt = now;
    if (!validNumber) {
      this.unreadableSince ??= now;
      return;
    }
    this.power = true;
    if (this.mode === "unknown" || this.mode === "off") this.observeMode("on", frame.value, now);
    this.unreadableSince = null;
    if (frame.purpose === "target") {
      this.observeMode("target", frame.value, now);
      return;
    }
    if (frame.purpose !== "water" || !controllerIdle || this.phase === "settling") return;
    if (now - this.lastBlankAt < 6000) return;
    this.observeMode("water", frame.value, now);
    this.phase = "idle";
    this.attempts = 0;
  }

  tick(now: number, controllerIdle: boolean): PanelEffect | null {
    // Normal, optically confirmed standby needs no periodic wake taps. Pending
    // user controls already execute their own wake/selection sequence.
    if (this.mode === "standby") return null;
    switch (this.phase) {
      case "idle": {
        const needsWake = this.unreadableSince !== null && now - this.unreadableSince >= 3000;
        const freshVisibleFrame = this.visible && now >= this.frameAt && now - this.frameAt <= 2000;
        if (now - this.startedAt < 6000 || this.mode === "off" || !controllerIdle || !needsWake || !freshVisibleFrame || now - this.lastBlankAt < 6000 ||
            now - this.lastWakeAt < 60000 || this.attempts >= 3) return null;
        this.attempts++;
        this.lastWakeAt = now;
        this.deadline = now + 6000;
        this.phase = "settling";
        return "press_plus";
      }
      case "settling":
        if (now < this.deadline) return null;
        if (!controllerIdle) {
          if (now < this.deadline + 10000) return null;
          this.phase = "failed";
          return "failed";
        }
        this.phase = "reading";
        this.deadline = now + 10000;
        return "capture_water";
      case "reading":
        if (now < this.deadline) return null;
        this.phase = this.attempts >= 3 ? "failed" : "idle";
        return "failed";
      case "failed":
        return null;
    }
  }

  snapshot(now = Date.now()) {
    return { mode: this.mode, power: this.power, water: this.water, target: this.target,
      observedAt: Number.isFinite(this.observedAt) ? this.observedAt : null,
      waterObservedAt: Number.isFinite(this.waterAt) ? this.waterAt : null,
      fresh: this.unreadableSince === null && now >= this.observedAt && now - this.observedAt <= 30000,
      waterFresh: this.unreadableSince === null && now - this.lastBlankAt >= 6000 && this.phase === "idle" && (this.mode === "water" || this.mode === "standby") && now >= this.waterAt && now - this.waterAt <= 30000,
      targetObservedAt: Number.isFinite(this.targetAt) ? this.targetAt : null,
      recovery: this.phase, attempts: this.attempts };
  }
}

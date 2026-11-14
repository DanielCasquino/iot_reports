import { parseTemperatureControl } from "./temperature-control.js";
export type PilotState = "heating" | "ready" | "unlit" | "unknown";
type Color = [number, number, number, number];

function parseColor(value: string | undefined): Color | null {
  if (!value || value.split(",").some(v => !v.trim())) return null;
  const parts = value.split(",").map(Number);
  return parts.length === 4 && parts.every(v => Number.isInteger(v) && v >= 0 && v <= 65535)
    ? parts as Color : null;
}

function distance(a: Color, b: Color): number {
  return Math.hypot(...a.slice(0, 3).map((v, i) => v / a[3] - b[i]! / b[3]));
}

// References and tolerance must come from the mounted sensor, not guessed RGB thresholds.
export function classifyPilot(raw: string | null, env: NodeJS.ProcessEnv = process.env): PilotState {
  const sample = parseColor(raw ?? undefined);
  if (!sample) return "unknown";
  const unlit = parseColor(env.COLOR_UNLIT_REFERENCE);
  const dark = Number(env.COLOR_DARK_MAX_CLEAR);
  if (!unlit?.[3] && env.COLOR_DARK_MAX_CLEAR && Number.isInteger(dark) && dark >= 0 && dark <= 65535 && sample[3] <= dark)
    return "unlit";
  if (!sample[3]) return "unknown";
  const red = parseColor(env.COLOR_RED_REFERENCE);
  const green = parseColor(env.COLOR_GREEN_REFERENCE);
  const tolerance = Number(env.COLOR_MAX_DISTANCE);
  // A positive match against either measured reference is enough to establish
  // that state. Requiring both references blocked red-only calibration, which
  // is exactly the case needed to recover from an unknown power state.
  if ((!red?.[3] && !green?.[3] && !unlit?.[3]) || !Number.isFinite(tolerance) || tolerance <= 0) return "unknown";
  const references: [Color | null, PilotState][] = [[red, "heating"], [green, "ready"], [unlit, "unlit"]];
  const matches = references.filter(([reference]) => reference !== null && reference[3] > 0 && distance(sample, reference) <= tolerance);
  // Overlapping calibration regions are ambiguous, not evidence for either state.
  return matches.length === 1 ? matches[0]![1] : "unknown";
}

export class HeaterObservation {
  constructor(private readonly sensorTestMode = false) {}
  private temperature: number | null = null;
  private temperatureAt = -Infinity;
  private color: string | null = null;
  private colorAt = -Infinity;
  private onlineAt = -Infinity;
  private online = false;
  private power: boolean | null = null;
  private temperatureLocked = false;
  private temperatureValidAfter = -Infinity;

  update(topic: string, value: string, retained = false, now = Date.now()) {
    // A retained snapshot cannot establish a fresh hardware observation.
    if (retained) { if (topic === "heater/status" && value === "offline") this.disconnect(); return; }
    if (topic === "heater/status") {
      this.online = value === "online";
      this.onlineAt = now;
      this.color = null;
      this.colorAt = -Infinity;
      this.power = null;
      this.temperature = null;
      this.temperatureAt = -Infinity;
    }
    if (topic === "heater/state/temperature") {
      const reading = value.trim() === "" ? NaN : Number(value);
      this.temperature = Number.isFinite(reading) && reading >= 0 && reading <= 100 ? reading : null;
      this.temperatureAt = now;
    }
    if (topic === "heater/state/temperature_control") {
      const control = parseTemperatureControl(value);
      const locked = control === null || control.locked;
      if (locked || this.temperatureLocked) this.temperatureValidAfter = now;
      this.temperatureLocked = locked;
    }
    if (topic === "heater/state/color") { this.color = value; this.colorAt = now; }
    if (topic === "heater/state/power") this.power = value === "true" ? true : value === "false" ? false : null;
    if (topic.startsWith("heater/state/")) { this.online = true; this.onlineAt = now; }
  }

  disconnect() {
    this.temperature = null;
    this.temperatureAt = -Infinity;
    this.online = false;
    this.power = null;
    this.color = null;
    this.colorAt = -Infinity;
  }

  snapshot(camera: { available: boolean; value: number | null; observedAt: string | null }, now = Date.now()) {
    const online = this.online && now - this.onlineAt <= 10000;
    const observedAt = camera.observedAt === null ? NaN : Date.parse(camera.observedAt);
    const cameraFresh = online && Number.isFinite(observedAt) && now - observedAt >= 0 && now - observedAt <= 30000;
    const pilot = online && now - this.colorAt <= 10000 ? classifyPilot(this.color) : "unknown";
    return {
      online, power: online ? this.power : null, pilot,
      display: !cameraFresh ? "unknown" : camera.available ? "readable" : "unreadable",
      // TEMPORARY: physical probe telemetry replaces the OCR temperature gate.
      temperature: this.sensorTestMode
        ? online && now - this.temperatureAt <= 30000 ? this.temperature : null
        : cameraFresh && camera.available && !this.temperatureLocked &&
          observedAt >= this.temperatureValidAfter ? camera.value : null,
      temperatureSource: this.sensorTestMode ? "probe" : "camera",
      reason: !online ? "No fresh controller telemetry" : this.sensorTestMode ? null : pilot === "unknown" ? "RGB unavailable, stale or not calibrated"
        : pilot === "unlit" ? "Unlit pilot does not establish power loss" : null,
    };
  }
}

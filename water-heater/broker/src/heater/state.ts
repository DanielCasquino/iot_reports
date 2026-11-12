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
  const dark = Number(env.COLOR_DARK_MAX_CLEAR);
  if (env.COLOR_DARK_MAX_CLEAR && Number.isInteger(dark) && dark >= 0 && dark <= 65535 && sample[3] <= dark)
    return "unlit";
  if (!sample[3]) return "unknown";
  const red = parseColor(env.COLOR_RED_REFERENCE);
  const green = parseColor(env.COLOR_GREEN_REFERENCE);
  const tolerance = Number(env.COLOR_MAX_DISTANCE);
  if (!red?.[3] || !green?.[3] || !Number.isFinite(tolerance) || tolerance <= 0) return "unknown";
  const r = distance(sample, red), g = distance(sample, green);
  // Overlapping calibration regions are ambiguous, not evidence for either state.
  if ((r <= tolerance) === (g <= tolerance)) return "unknown";
  return r <= tolerance ? "heating" : "ready";
}

export class HeaterObservation {
  private color: string | null = null;
  private colorAt = -Infinity;
  private onlineAt = -Infinity;
  private online = false;
  private power: boolean | null = null;

  update(topic: string, value: string, retained = false, now = Date.now()) {
    // A retained snapshot cannot establish a fresh hardware observation.
    if (retained) { if (topic === "heater/status" && value === "offline") this.disconnect(); return; }
    if (topic === "heater/status") {
      this.online = value === "online";
      this.onlineAt = now;
      this.color = null;
      this.colorAt = -Infinity;
      this.power = null;
    }
    if (topic === "heater/state/color") { this.color = value; this.colorAt = now; }
    if (topic === "heater/state/power") this.power = value === "true" ? true : value === "false" ? false : null;
    if (topic.startsWith("heater/state/")) { this.online = true; this.onlineAt = now; }
  }

  disconnect() {
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
      temperature: cameraFresh && camera.available ? camera.value : null,
      reason: !online ? "No fresh controller telemetry" : pilot === "unknown" ? "RGB unavailable, stale or not calibrated"
        : pilot === "unlit" ? "Unlit pilot does not establish power loss" : null,
    };
  }
}

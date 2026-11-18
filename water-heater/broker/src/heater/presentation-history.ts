import type { MqttClient } from "mqtt";

export const WATER_HISTORY = "heater/presentation/last-water";
export const POWER_HISTORY = "heater/presentation/last-power";

interface Reading<T> { value: T; observedAt: number }

// A retained reading can seed a dashboard. Only a new observation can drive control.
export class PresentationHistory<T> {
  private latest: Reading<T> | null = null;
  private publishedAt = -Infinity;

  constructor(private readonly topic: string, private readonly accepts: (value: unknown) => value is T) {}

  snapshot() { return this.latest; }

  restore(payload: Buffer) {
    if (payload.length > 256) return false;
    try {
      const item = JSON.parse(payload.toString());
      if (item && this.accepts(item.value) && this.isNewer(item.observedAt)) {
        this.latest = { value: item.value, observedAt: item.observedAt };
        return true;
      }
    } catch { /* Ignore malformed presentation data. */ }
    return false;
  }

  observe(value: T, observedAt: number, mqtt: MqttClient) {
    if (!this.accepts(value) || !this.isNewer(observedAt)) return;
    const changed = this.latest?.value !== value;
    this.latest = { value, observedAt };
    if (changed || observedAt - this.publishedAt >= 30000) {
      mqtt.publish(this.topic, JSON.stringify(this.latest), { qos: 1, retain: true });
      this.publishedAt = observedAt;
    }
  }

  private isNewer(at: number) {
    return Number.isSafeInteger(at) && at > (this.latest?.observedAt ?? 0) && at <= Date.now();
  }
}

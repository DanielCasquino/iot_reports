import type { MqttClient } from "mqtt";

export const presentationTopics = {
  water: "heater/presentation/last-water",
  power: "heater/presentation/last-power",
  maximum: "heater/presentation/last-maximum",
} as const;

const REFRESH_INTERVAL_MS = 30_000;

interface Reading<T> { value: T; observedAt: number }

// A retained reading can seed a dashboard. Only a new observation can drive control.
class RetainedReading<T> {
  private latest: Reading<T> | null = null;
  private publishedAt = -Infinity;

  constructor(readonly topic: string, private readonly mqtt: MqttClient, private readonly accepts: (value: unknown) => value is T) {}

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

  observe(value: T, observedAt: number) {
    if (!this.accepts(value) || !this.isNewer(observedAt)) return;
    const changed = this.latest?.value !== value;
    this.latest = { value, observedAt };
    if (changed || observedAt - this.publishedAt >= REFRESH_INTERVAL_MS) {
      this.mqtt.publish(this.topic, JSON.stringify(this.latest), { qos: 1, retain: true });
      this.publishedAt = observedAt;
    }
  }

  private isNewer(at: number) {
    return Number.isSafeInteger(at) && at > (this.latest?.observedAt ?? 0) && at <= Date.now();
  }
}

function temperatureFrom(minimum: number) {
  return (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= 75;
}

export function createPresentationHistory(mqtt: MqttClient) {
  const water = new RetainedReading(presentationTopics.water, mqtt, temperatureFrom(0));
  const power = new RetainedReading(presentationTopics.power, mqtt, (value): value is boolean => typeof value === "boolean");
  const maximum = new RetainedReading(presentationTopics.maximum, mqtt, temperatureFrom(30));
  const byTopic = new Map<string, RetainedReading<number> | RetainedReading<boolean>>(
    [water, power, maximum].map(reading => [reading.topic, reading]),
  );

  return {
    water, power, maximum,
    forTopic: (topic: string) => byTopic.get(topic),
    snapshot: () => ({ lastWater: water.snapshot(), lastPower: power.snapshot(), lastMaximum: maximum.snapshot() }),
  };
}

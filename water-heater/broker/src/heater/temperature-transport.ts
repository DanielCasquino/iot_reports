import type { TemperatureControl } from "./temperature-control.js";

export function temperatureTransport(payload: string, control: TemperatureControl | null,
  receivedAt: number, now: number, enabled: boolean) {
  const token = control?.temperatureV2Token;
  if (!enabled || token === undefined)
    return { topic: "heater/set/temperature", payload, qos: 0 as const };
  if (now < receivedAt || now - receivedAt >= 2500) return null;
  return { topic: "heater/set/temperature_v2", payload: `${payload},${token}`, qos: 1 as const };
}

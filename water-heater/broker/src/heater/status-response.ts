import type { TemperatureControl } from "./temperature-control.js";

interface StatusInputs {
  online: boolean;
  temperatureControl: TemperatureControl | null;
  autoShutdown: boolean | null;
  flowrate: number | null;
  volume: number | null;
}

// The physical controller is the source of its own state; display cache is
// presentation only. Preserve null for stale telemetry while disconnected.
export function buildStatusResponse<T extends StatusInputs>(input: T) {
  const { online, temperatureControl } = input;
  const target = temperatureControl?.autoShutdownTarget ?? -1;
  return { ...input,
    autoShutdown: online ? input.autoShutdown : null,
    autoShutdownTarget: online && target >= 30 ? target : null,
    temperatureControl: online ? temperatureControl : null,
    flowrate: online ? input.flowrate : null,
    volume: online ? input.volume : null,
  };
}

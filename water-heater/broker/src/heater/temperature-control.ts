export interface TemperatureControl {
  base: number; target: number; status: string; locked: boolean;
  min: number; max: number; commandId: number; result: string;
  autoShutdownTarget?: number; temperatureV2Token?: number;
  failureReason?: string; observedMaximumAtFailure?: number;
}
export function parseTemperatureControl(raw: string): TemperatureControl | null {
  try {
    const value = JSON.parse(raw);
    if (value?.temperatureV2Token !== undefined &&
        (!Number.isInteger(value.temperatureV2Token) || value.temperatureV2Token <= 0 ||
          value.temperatureV2Token > 0xffffffff)) return null;
    if (value?.autoShutdownTarget !== undefined &&
        (!Number.isInteger(value.autoShutdownTarget) || (value.autoShutdownTarget !== -1 &&
          (value.autoShutdownTarget < 30 || value.autoShutdownTarget > 75)))) return null;
    if (value?.failureReason !== undefined &&
        !["opening_window_expired", "maximum_read_timeout", "confirmation_timeout",
          "selection_window_expired", "maximum_mismatch"].includes(value.failureReason)) return null;
    const observedMaximumAtFailure = value?.observedMaximumAtFailure;
    if (observedMaximumAtFailure !== undefined && (!Number.isInteger(observedMaximumAtFailure) ||
        (observedMaximumAtFailure !== -1 && (observedMaximumAtFailure < 30 || observedMaximumAtFailure > 75)))) return null;
    if (!value || !Number.isInteger(value.base) || (value.base !== -1 && (value.base < 30 || value.base > 75)) ||
        !Number.isInteger(value.target) || value.target < 0 || value.target > 75 ||
        !["idle", "selecting", "applying", "settling", "verifying", "error"].includes(value.status) ||
        typeof value.locked !== "boolean" || value.locked !== !["idle", "selecting"].includes(value.status) ||
        value.min !== 30 || value.max !== 75 || !Number.isInteger(value.commandId) ||
        value.commandId < 0 || value.commandId > 0xffffffff ||
        !["none", "accepted", "busy", "off", "base_mismatch", "invalid", "disabled"].includes(value.result)) return null;
    return value as TemperatureControl;
  } catch { return null; }
}

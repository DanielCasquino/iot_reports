export interface TemperatureControl {
  base: number; target: number; status: string; locked: boolean;
  min: number; max: number; commandId: number; result: string;
}
export function parseTemperatureControl(raw: string): TemperatureControl | null {
  try {
    const value = JSON.parse(raw);
    if (!value || !Number.isInteger(value.base) || (value.base !== -1 && (value.base < 35 || value.base > 75)) ||
        !Number.isInteger(value.target) || value.target < 0 || value.target > 75 ||
        !["idle", "selecting", "applying", "settling", "verifying", "error"].includes(value.status) ||
        typeof value.locked !== "boolean" || value.locked !== !["idle", "selecting"].includes(value.status) ||
        value.min !== 35 || value.max !== 75 || !Number.isInteger(value.commandId) ||
        value.commandId < 0 || value.commandId > 0xffffffff ||
        !["none", "accepted", "busy", "off", "base_mismatch", "invalid", "disabled"].includes(value.result)) return null;
    return value as TemperatureControl;
  } catch { return null; }
}

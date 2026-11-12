export function parseCommand(raw: string): { topic: string; payload: string } | null {
  try {
    const message = JSON.parse(raw);
    if (!message || typeof message !== "object") return null;
    if (message.event === "set_temperature" || message.event === "sync_temperature_base") {
      const { target, base, requestId } = message.data ?? {};
      if (!Number.isInteger(target) || target < 35 || target > 75 ||
          !Number.isInteger(base) || base < 35 || base > 75 ||
          !Number.isInteger(requestId) || requestId <= 0 || requestId > 0xffffffff) return null;
      return { topic: message.event === "set_temperature" ? "heater/set/temperature" : "heater/set/temperature_base",
        payload: `${requestId},${base},${target}` };
    }
    if (typeof message.data?.enabled !== "boolean") return null;
    if (message.event === "set_heater_power")
      return { topic: "heater/set/power", payload: String(message.data.enabled) };
    if (message.event === "set_auto_shutdown")
      return { topic: "heater/set/autoshutdown", payload: String(message.data.enabled) };
    return null;
  } catch { return null; }
}

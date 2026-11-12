export function parseCommand(raw: string): { topic: string; payload: string } | null {
  try {
    const message = JSON.parse(raw);
    if (!message || typeof message !== "object" || typeof message.data?.enabled !== "boolean") return null;
    if (message.event === "set_heater_power")
      return { topic: "heater/set/power", payload: String(message.data.enabled) };
    if (message.event === "set_auto_shutdown")
      return { topic: "heater/set/autoshutdown", payload: String(message.data.enabled) };
    return null;
  } catch { return null; }
}

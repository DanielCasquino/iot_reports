export function controlLog(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({ ...details, at: new Date().toISOString(), source: "heater-control", event }));
}

// Diagnostic telemetry never becomes an observation or a control command.
export function logServoSequence(raw: string): boolean {
  try {
    const tap = JSON.parse(raw);
    const buttons: Record<number, string> = { 25: "power", 27: "plus", 26: "minus" };
    if (!tap || !Number.isInteger(tap.pin) || tap.button !== buttons[tap.pin] || !buttons[tap.pin] || tap.mechanicalConfirmed !== false ||
        !["manual_power", "manual_plus", "manual_minus", "display_wake", "wake_or_open", "open_target",
          "adjust_target_shortest_wrap", "wake_before_power", "power_toggle"].includes(tap.reason) ||
        !["commandId", "startedAt", "completedAt"].every(key => Number.isInteger(tap[key]) && tap[key] >= 0 && tap[key] <= 0xffffffff) ||
        !["press", "rest"].every(key => Number.isInteger(tap[key]) && tap[key] >= 0 && tap[key] <= 180) ||
        !["estimatedBefore", "estimatedAfter", "target"].every(key => Number.isInteger(tap[key]) && (tap[key] === -1 || tap[key] >= 0 && tap[key] <= 75))) return false;
    controlLog("servo_sequence_sent", { pin: tap.pin, button: tap.button, reason: tap.reason,
      commandId: tap.commandId, estimatedBefore: tap.estimatedBefore, estimatedAfter: tap.estimatedAfter,
      target: tap.target, press: tap.press, rest: tap.rest, mcuStartedAt: tap.startedAt, mcuCompletedAt: tap.completedAt,
      mechanicalConfirmed: false });
    return true;
  } catch { return false; }
}

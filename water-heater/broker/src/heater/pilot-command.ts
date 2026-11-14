import type { PilotState } from "./state.js";

export function pilotCommand(pilot: PilotState, policy: {
  retained: boolean;
  sensorTestMode: boolean;
  brokerConnected: boolean;
  controllerOnline: boolean;
}) {
  if (policy.retained || policy.sensorTestMode || !policy.brokerConnected || !policy.controllerOnline) return null;
  return {
    topic: "heater/input/pilot",
    payload: pilot,
    options: { qos: 0 as const, retain: false as const },
  };
}

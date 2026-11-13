// Measure the mounted pilot and print the .env value for one pilot state.
// Usage (from water-heater/broker):
//   npm run calibrate:color red
//   npm run calibrate:color green
//   npm run calibrate:color unlit
// Keep the pilot in that state for the whole capture, then restart the backend.
import "dotenv/config";
import mqtt from "mqtt";

const label = (process.argv[2] ?? "red").toLowerCase();
const seconds = Number(process.argv[3] ?? 20);
if (!["red", "green", "unlit"].includes(label))
  throw new Error("Use red, green or unlit as the first argument");
if (!Number.isFinite(seconds) || seconds < 6 || seconds > 120)
  throw new Error("Capture seconds must be between 6 and 120");

const url = process.env.MQTT_URL ?? "mqtt://192.168.1.225:1883";
const samples = [];
const client = mqtt.connect(url, { reconnectPeriod: 2000, queueQoSZero: false });

const normalize = ([r, g, b, c]) => [r / c, g / c, b / c];
const distance = (a, b) => Math.hypot(...normalize(a).map((v, i) => v - normalize(b)[i]));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

let finished = false;
let timer;
function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  client.end(true);

  if (!samples.length) {
    console.error(`No usable heater/state/color samples received in ${seconds}s.`);
    process.exitCode = 1;
    return;
  }

  const reference = [0, 1, 2, 3].map(i => median(samples.map(sample => sample[i])));
  const spread = Math.max(...samples.map(sample => distance(sample, reference)));

  console.log(`\n${samples.length} samples for "${label}"`);
  console.log(`Median raw: ${reference.join(",")}`);
  if (label === "unlit") {
    const clear = Math.max(...samples.map(sample => sample[3]));
    console.log(`COLOR_DARK_MAX_CLEAR=${Math.ceil(clear * 1.1)}`);
    console.log(`Highest measured clear: ${clear}. Set the value above it, then restart the backend.`);
    return;
  }

  const prefix = label === "red" ? "COLOR_RED_REFERENCE" : "COLOR_GREEN_REFERENCE";
  const other = label === "red" ? process.env.COLOR_GREEN_REFERENCE : process.env.COLOR_RED_REFERENCE;
  console.log(`${prefix}=${reference.join(",")}`);
  console.log(`Observed spread (max normalized distance from median): ${spread.toFixed(3)}`);
  console.log(`Set COLOR_MAX_DISTANCE above ${spread.toFixed(3)} (for example ${Math.max(0.05, spread * 1.5).toFixed(2)}).`);
  if (other) {
    const parts = other.split(",").map(Number);
    if (parts.length === 4 && parts.every(v => Number.isInteger(v) && v >= 0 && v <= 65535) && parts[3] > 0) {
      const separation = distance(reference, parts);
      console.log(`Distance to the configured opposite reference: ${separation.toFixed(3)}.`);
      console.log("Keep COLOR_MAX_DISTANCE below half of that distance so the two states cannot overlap.");
    }
  }
  console.log("Restart the backend after updating .env.");
}

timer = setTimeout(finish, seconds * 1000);
client.on("error", error => {
  console.error("MQTT error:", error.message);
  finish();
});
client.on("connect", () => client.subscribe("heater/state/color"));
client.on("message", (topic, payload) => {
  if (topic !== "heater/state/color" || finished) return;
  const value = payload.toString();
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some(v => !Number.isInteger(v) || v < 0 || v > 65535) || parts[3] === 0)
    return;
  samples.push(parts);
  console.log(`sample ${samples.length}: ${value}  normalized ${normalize(parts).map(v => v.toFixed(3)).join(",")}`);
  if (samples.length >= 8) finish();
});

console.log(`Listening for ${label} pilot samples on ${url} ...`);

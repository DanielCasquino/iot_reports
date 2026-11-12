// Read-only snapshot for the bench log. Redirect stdout to a private CSV file.
// Usage: node scripts/record-observation.mjs http://localhost:3000 48
// Last argument is the temperature independently read by a person; omit if unknown.
const args = process.argv.slice(2);
const base = new URL(args[0] ?? 'http://localhost:3000');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password)
  throw new Error('Use an HTTP(S) backend URL without credentials');
const reference = args[1] === undefined ? null : Number(args[1]);
if (reference !== null && (!Number.isFinite(reference) || reference < 0 || reference > 100))
  throw new Error('Reference must be a human-observed temperature in 0..100 C');
async function read(endpoint) {
  try {
    const response = await fetch(new URL(endpoint, base), { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { data: await response.json(), error: '' };
  } catch (error) { return { data: null, error: error.message }; }
}
const [heater, camera] = await Promise.all([read('/api/heater/status'), read('/api/camera/status')]);
const now = new Date().toISOString();
const header = ['recorded_at', 'online', 'power', 'pilot', 'display', 'temperature_C', 'human_reference_C',
  'difference_C', 'flow_L_min', 'volume_since_restart_L', 'ocr_observed_at', 'ocr_confidence', 'error'];
const value = heater.data?.online === true && typeof heater.data.temperature === 'number' ? heater.data.temperature : null;
const row = [now, heater.data?.online, heater.data?.power, heater.data?.pilot, heater.data?.display, value,
  reference, value !== null && reference !== null ? value - reference : null,
  heater.data?.flowrate, heater.data?.volume, camera.data?.observedAt, camera.data?.confidence,
  [heater.error, camera.error, camera.data?.error].filter(Boolean).join('; ')];
const csv = values => values.map(v => v == null ? '' : '"' + String(v).replaceAll('"', '""') + '"').join(',');
console.log(csv(header));
console.log(csv(row));
if (heater.error || camera.error) process.exitCode = 1;

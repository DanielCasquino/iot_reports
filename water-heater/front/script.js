const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8080`;
const heaterSocket = createHeaterSocket({ url: WS_URL, onConnection: updateConnection, onMessage: handleMessage });
const connect = heaterSocket.connect;

let fahrenheit = false;
let brokerConnected = false;
let capturePending = false;
let temperatureControl = null;
let requestedTemperature = null;
let savedRequestedTemperature = null;
let temperatureDraftDirty = false;
let pendingTemperatureCommand = null;
let temperatureMessage = "";
let temperatureOperation = null;

let observationText = "Waiting for fresh readings";
let powerControl = null;
let pendingPowerChange = null;
let pendingAutomaticShutdown = null;
let autoShutdownFeedback = "";

function receivePowerResult(result) {
  if (!result || !Number.isInteger(result.attempts) || result.attempts < 0 || result.attempts > 3 ||
      !["idle", "verifying", "confirmed", "failed"].includes(result.status)) return;
  powerControl = result;
  if (result.status !== "idle" && pendingPowerChange?.enabled === result.target) pendingPowerChange = null;
  updateControls();
}

const heaterState = {
  power: null,
  autoShutdown: false,
  waterTemperature: null,
  temperatureMax: null,
  temperatureMaxSelected: false,
  cameraTemperature: null,
  lastValidTemperature: null,
  status: "offline",
  pilotRgbSample: null,
  flowrate: null,
  volume: null,
};

function updatePowerButton() {
  const button = document.getElementById("big-button");

  if (!button) return;

  const confirmed = brokerConnected && heaterState.status === "online" && typeof heaterState.power === "boolean";
  button.setAttribute("aria-label", confirmed ? (heaterState.power ? "Turn heater off" : "Turn heater on") : "Heater power unconfirmed");
  button.setAttribute("aria-pressed", String(confirmed && heaterState.power));
  button.className = `big-button big-button-${confirmed && heaterState.power ? "on" : "off"}`;
}

function updateAutoShutdown() {
  const checkbox = document.getElementById("automated-shutdown");

  if (!checkbox) return;

  checkbox.checked = heaterState.autoShutdown;
}

function receiveAutoShutdown(enabled) {
  heaterState.autoShutdown = enabled;
  if (pendingAutomaticShutdown?.enabled === enabled) {
    pendingAutomaticShutdown = null;
    autoShutdownFeedback = "";
  }
  updateAutoShutdown();
  updateControls();
}

function updateTemperature() {
  const heaterOff = heaterState.power === false;
  const cameraReading = heaterState.status === "offline" && !heaterState.temperatureMaxSelected
    ? heaterState.cameraTemperature : null;
  const reading = heaterOff ? null : heaterState.waterTemperature ?? cameraReading;
  if (reading !== null) heaterState.lastValidTemperature = reading;

  renderTemperatureReadout({
    reading, lastReading: heaterState.lastValidTemperature, heaterOff,
    temperatureMax: heaterState.temperatureMax,
    fromCamera: heaterState.waterTemperature === null && reading !== null,
    fahrenheit,
  });
}

function updateBrokerStatus(connected) {
  const indicator = document.getElementById("broker-status");

  if (!indicator) return;

  brokerConnected = connected;
  updateControls();
  indicator.title = connected ? "WebSocket connected" : "WebSocket disconnected";
  indicator.setAttribute("aria-label", indicator.title);
  indicator.className = `icon-wrapper icon-wrapper-${connected ? "on" : "off"}`;
}

function updateEspStatus() {
  const indicator = document.getElementById("esp-status");

  if (!indicator) return;

  updateControls();
  indicator.title = heaterState.status === "online" ? "Device online" : "Device offline";
  indicator.setAttribute("aria-label", indicator.title);
  indicator.className = `icon-wrapper icon-wrapper-${heaterState.status === "online" ? "on" : "off"}`;
}

function handleMqttMessage(data) {
  const { topic, payload } = data;

  switch (topic) {
    case "heater/state/temperature_control": {
      try { receiveTemperatureControl(JSON.parse(payload)); } catch { temperatureControl = null; updateControls(); }
      break;
    }
    case "heater/state/power": {
      heaterState.power = payload === "true" ? true : payload === "false" ? false : null;
      if (heaterState.power !== true) heaterState.waterTemperature = null;
      if (pendingPowerChange?.enabled === heaterState.power) pendingPowerChange = null;
      updateTemperature();
      updateControls();
      break;
    }
    case "heater/state/autoshutdown": {
      if (payload === "true" || payload === "false") receiveAutoShutdown(payload === "true");
      break;
    }
    case "heater/state/temperature": {
      if (payload === "unavailable") {
        heaterState.waterTemperature = null;
        updateTemperature();
      }
      break;
    }
    case "heater/state/flowrate":
    case "heater/state/volume": {
      const value = payload.trim() === "" ? NaN : Number(payload);
      heaterState[topic.endsWith("/flowrate") ? "flowrate" : "volume"] = heaterState.status === "online" && Number.isFinite(value) && value >= 0 ? value : null;
      updateFlow();
      break;
    }
    case "heater/state/color": {
      heaterState.pilotRgbSample = payload === "unavailable" ? null : payload;
      updateColor();
      break;
    }
    case "heater/status": {
      heaterState.status = payload === "online" ? "online" : "offline";
      heaterState.power = null;
      heaterState.waterTemperature = null;
      heaterState.flowrate = null;
      heaterState.volume = null;
      temperatureControl = null;
      powerControl = null;
      pendingPowerChange = null;
      pendingAutomaticShutdown = null;
      updateTemperature();
      updateEspStatus();
      break;
    }
  }
}

// here we either received a state snapshot after requesting it on connection
// or we receive a command
function handleMessage(message) {
  switch (message.event) {
    case "state_snapshot":
      receiveHeaterSnapshot(message.data);
      break;
    case "temperature_max":
      receiveTemperatureMaximum(message.data);
      updateTemperature();
      break;
    case "temperature_result":
      receiveTemperatureResult(message.data);
      break;
    case "power_result":
      receivePowerResult(message.data);
      break;
    case "command_error":
      if (pendingTemperatureCommand) {
        if (message.data.requestId === pendingTemperatureCommand.id) pendingTemperatureCommand = null;
        else pendingTemperatureCommand.timedOut = true;
        temperatureMessage = message.data.error;
        updateControls();
      }
      if (message.data.topic === "heater/set/power") pendingPowerChange = null;
      if (message.data.topic === "heater/set/autoshutdown") {
        pendingAutomaticShutdown = null;
        autoShutdownFeedback = message.data.error;
      }
      if (["heater/set/power", "heater/set/autoshutdown"].includes(message.data.topic)) updateControls();
      break;
    case "mqtt_message":
      handleMqttMessage(message.data);
      break;
  }
}

function receiveTemperatureMaximum(data) {
  const maximum = data?.temperatureMax;
  heaterState.temperatureMax = Number.isInteger(maximum) && maximum >= 30 && maximum <= 75 ? maximum : null;
  heaterState.temperatureMaxSelected = data?.temperatureMaxSelected === true;
}

function receiveHeaterSnapshot(state) {
  receiveTemperatureMaximum(state);
  const online = typeof state.online === "boolean" ? state.online : state.status === "online";
  heaterState.status = online ? "online" : "offline";
  heaterState.power = online && typeof state.power === "boolean" ? state.power : null;
  heaterState.waterTemperature = online && typeof state.temperature === "number" &&
    Number.isFinite(state.temperature) && state.temperature >= 0 && state.temperature <= 75 ? state.temperature : null;
  const camera = state.camera;
  heaterState.cameraTemperature = camera?.available === true && typeof camera.value === "number" &&
    Number.isFinite(camera.value) && camera.value >= 0 && camera.value <= 75 ? camera.value : null;
  for (const field of ["flowrate", "volume"]) {
    const value = state[field];
    heaterState[field] = online && typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof state.autoShutdown === "boolean") receiveAutoShutdown(state.autoShutdown);
  if (!online || "color" in state) heaterState.pilotRgbSample = online && typeof state.color === "string" ? state.color : null;
  const target = state.desired?.temperature;
  savedRequestedTemperature = Number.isInteger(target) && target >= 30 && target <= 75 ? target : null;
  if (!temperatureDraftDirty && !pendingTemperatureCommand && savedRequestedTemperature !== null)
    requestedTemperature = savedRequestedTemperature;
  receiveTemperatureControl(online ? state.temperatureControl : null);
  receiveTemperatureResult(state.reconciliation);
  if (state.powerControl) receivePowerResult(state.powerControl);
  if ("pilot" in state || "display" in state) {
    const pilot = { heating: "Heating reference matched", ready: "Ready reference matched", unlit: "Pilot unlit", unknown: "Pilot not confirmed" };
    const display = { readable: "display readable", unreadable: "display unreadable", off: "display off", dim: "display dim", lit: "display on", unknown: "display not confirmed" };
    const visor = state.displayState && state.displayState.display !== "unknown" ? state.displayState.display : state.display;
    observationText = online ? `${pilot[state.pilot] || pilot.unknown} · ${display[visor] || display.unknown}` : "Waiting for fresh device readings";
  }
  updateAutoShutdown();
  updateTemperature();
  updateColor();
  updateEspStatus();
}

function receiveTemperatureResult(result) {
  if (!result || !Number.isInteger(result.target) || result.target < 30 || result.target > 75 ||
      !Number.isInteger(result.attempts) || result.attempts < 0 || result.attempts > 3 ||
      !["waiting", "verifying", "confirmed", "failed"].includes(result.status)) return;
  const target = pendingTemperatureCommand?.target ?? savedRequestedTemperature ?? requestedTemperature;
  if (result.target !== target || pendingTemperatureCommand?.calibrate) return;
  if (pendingTemperatureCommand) {
    if (result.status === "waiting" || result.status === "verifying") pendingTemperatureCommand.reconciliationStarted = true;
    else if (!pendingTemperatureCommand.reconciliationStarted) return;
    else pendingTemperatureCommand = null;
  }
  temperatureOperation = result;
  temperatureMessage = result.status === "failed"
    ? "Could not confirm the adjustment. Check servo mounting/contact and the camera view before retrying." : "";
  updateControls();
}

function updateConnection(connected) {
  if (!connected) {
    heaterState.status = "offline";
    heaterState.power = null;
    heaterState.waterTemperature = null;
    heaterState.cameraTemperature = null;
    heaterState.flowrate = null;
    heaterState.volume = null;
    heaterState.pilotRgbSample = null;
    temperatureControl = null;
    powerControl = null;
    pendingPowerChange = null;
    pendingAutomaticShutdown = null;
    updateColor();
    updateEspStatus();
    updateTemperature();
  }
  updateBrokerStatus(connected);
}

function sendCommand(event, data) {
  return brokerConnected && heaterState.status === "online" && heaterSocket.send(event, data);
}

function toggleTerma() {
  if (!temperatureControl || hardwareLockReason()) return;
  const request = { enabled: !heaterState.power };
  if (!sendCommand("set_heater_power", request)) return;
  pendingPowerChange = request;
  updateControls();
  setTimeout(() => {
    if (pendingPowerChange !== request) return;
    pendingPowerChange = null;
    updateControls();
  }, 8000);
}

function toggleAutomatedShutdown(checkbox) {
  const requestedState = checkbox.checked;
  checkbox.checked = heaterState.autoShutdown;
  if (hardwareLockReason()) return;
  const request = { enabled: requestedState };
  if (!sendCommand("set_auto_shutdown", request)) return;
  pendingAutomaticShutdown = request;
  autoShutdownFeedback = "";
  updateControls();
  setTimeout(() => {
    if (pendingAutomaticShutdown !== request) return;
    pendingAutomaticShutdown = null;
    autoShutdownFeedback = "Autoapagado sin confirmar.";
    updateControls();
  }, 7000);
}

function toggleFahrenheit(checkbox) {
  fahrenheit = checkbox.checked;

  try { localStorage.setItem("fahrenheit", String(fahrenheit)); } catch {}

  updateTemperature();
  updateTemperatureControls();
}

function retrieveLocalSettings() {
  try { fahrenheit = localStorage.getItem("fahrenheit") === "true"; } catch {}

  const checkbox = document.getElementById("fahrenheit");

  if (checkbox) {
    checkbox.checked = fahrenheit;
  }

  updateTemperature();
}

window.addEventListener("load", () => {
  retrieveLocalSettings();

  updatePowerButton();
  updateAutoShutdown();
  updateBrokerStatus(false);
  updateEspStatus();

  connect();
});

async function captureTemperature() {
  if (!brokerConnected || capturePending) return;
  capturePending = true;
  updateControls();
  const status = document.getElementById("camera-status");
  if (status) status.textContent = "Capturing and reading display...";
  try {
    const response = await fetch("/api/camera/capture", { method: "POST", cache: "no-store" });
    const result = await response.json();
    if (!response.ok || result.error || typeof result.value !== "number" || !Number.isFinite(result.value)) {
      if (status) status.textContent = "Display unreadable or capture unavailable. No new temperature confirmed.";
    } else if (status) status.textContent = `Captured OCR: ${result.value}°C`;
    const image = document.getElementById("camera-preview");
    if (image) image.src = `/api/camera/image?t=${Date.now()}`;
  } catch (error) {
    if (status) status.textContent = "Camera/backend unavailable";
  } finally { capturePending = false; updateControls(); }
}

function updateColor() {
  const display = document.getElementById("color-display");
  if (display) display.textContent = heaterState.pilotRgbSample === null ? "Piloto LED · RGB no disponible" : `Piloto LED · RGB y claro: ${heaterState.pilotRgbSample}`;
}

function currentOperationLock() {
  if (pendingPowerChange || powerControl?.status === "verifying") return "Confirmando encendido o apagado…";
  if (pendingAutomaticShutdown) return "Confirmando autoapagado…";
  if (pendingTemperatureCommand || temperatureControl?.locked || temperatureControl?.status === "selecting" ||
      (temperatureOperation?.status === "verifying" && temperatureOperation.attempts > 0))
    return "Ajuste de temperatura máx. en curso.";
  return null;
}

function hardwareLockReason() {
  if (!brokerConnected || heaterState.status !== "online") return "Controlador sin conexión.";
  return currentOperationLock() ?? (typeof heaterState.power !== "boolean" ? "Esperando confirmación de encendido." : null);
}

function showControlFeedback(id, message) {
  const status = document.getElementById(id);
  if (status) {
    status.textContent = message ?? "";
    status.hidden = !message;
  }
}

function updateControls() {
  const available = brokerConnected && heaterState.status === "online";
  updatePowerButton();
  updateFlow();
  updateTemperatureControls();
  const powerText = powerControl?.status === "failed"
    ? "Power change not confirmed. Check servo mounting/contact and the camera view before retrying."
    : powerControl?.status === "verifying" ? `Confirming power: attempt ${powerControl.attempts}/3` : observationText;
  document.getElementById("heater-observation").textContent = available ? powerText : "Waiting for fresh readings";
  const lockReason = hardwareLockReason();
  const powerReason = lockReason ?? (temperatureControl ? null : "Esperando estado del controlador.");
  document.getElementById("big-button").disabled = Boolean(powerReason);
  document.getElementById("automated-shutdown").disabled = Boolean(lockReason);
  document.getElementById("capture-temperature").disabled = !brokerConnected || capturePending;
  showControlFeedback("power-lock-status", powerReason);
  showControlFeedback("auto-shutdown-status", lockReason ?? (autoShutdownFeedback || null));
  const status = document.getElementById("connection-status");
  if (status) status.textContent = !available ? (heaterState.cameraTemperature === null ? "Disconnected · controls unavailable" : "Controller offline · camera reading available") :
    typeof heaterState.power !== "boolean" ? "Connected · waiting for power confirmation" :
    currentOperationLock() ? "Connected · adjustment in progress" : "Connected · controls ready";
}

// The backend combines fresh observations; a failed OCR does not establish sleep.
async function refreshObservation() {
  try {
    const response = await fetch("/api/heater/status", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error("Status unavailable");
    const state = await response.json();
    receiveHeaterSnapshot(state);
  } catch {
    observationText = "Live status unavailable";
    heaterState.status = "offline";
    heaterState.power = null;
    heaterState.flowrate = null;
    heaterState.volume = null;
    temperatureControl = null;
    heaterState.waterTemperature = null;
    heaterState.cameraTemperature = null;
    receiveTemperatureMaximum(null);
    updateEspStatus();
    updateTemperature();
  } finally { setTimeout(refreshObservation, 5000); }
}
window.addEventListener("load", refreshObservation);

function updateFlow() {
  const available = brokerConnected && heaterState.status === "online";
  const rate = available && typeof heaterState.flowrate === "number" ? `${heaterState.flowrate.toFixed(2)} L/min` : "unavailable";
  const volume = available && typeof heaterState.volume === "number" ? `${heaterState.volume.toFixed(2)} L since restart` : "unavailable";
  document.getElementById("flow-display").textContent = `Flow: ${rate} · Volume: ${volume}`;
}

// The draft stays local. Only Save sends a target; the controller owns the lock.
function receiveTemperatureControl(control) {
  if (!control || !Number.isInteger(control.base) || (control.base !== -1 && (control.base < 30 || control.base > 75)) ||
      !["idle", "selecting", "applying", "settling", "verifying", "error"].includes(control.status) ||
      typeof control.locked !== "boolean" || control.locked !== !["idle", "selecting"].includes(control.status) ||
      control.min !== 30 || control.max !== 75 || !Number.isInteger(control.target) || control.target < 0 || control.target > 75 ||
      !Number.isInteger(control.commandId) || control.commandId < 0 || control.commandId > 0xffffffff ||
      !["none", "accepted", "busy", "off", "base_mismatch", "invalid", "disabled"].includes(control.result)) {
    temperatureControl = null;
    updateControls();
    return;
  }
  temperatureControl = control;
  if (control.status === "error") temperatureMessage = "Could not confirm the change. Try again.";
  if (pendingTemperatureCommand && control.commandId === pendingTemperatureCommand.id) {
    if (control.result !== "accepted") {
      const errors = { busy: "Another adjustment is in progress.", off: "Turn the heater on first.",
        base_mismatch: "The heater setting changed. Check the current value and save again.",
        disabled: "Temperature control is disabled.", invalid: "Invalid temperature." };
      temperatureMessage = errors[control.result] || "The command was not accepted.";
    } else {
      temperatureMessage = pendingTemperatureCommand.calibrate ? "Current setting synchronized. No servos moved." : "";
      if (!pendingTemperatureCommand.calibrate) savedRequestedTemperature = pendingTemperatureCommand.target;
      temperatureDraftDirty = false;
    }
    pendingTemperatureCommand = null;
  }
  if (requestedTemperature === null || (!temperatureDraftDirty && !pendingTemperatureCommand))
    requestedTemperature = savedRequestedTemperature ?? ((control.locked || control.status === "selecting") && control.target >= control.min ? control.target : control.base === -1 ? (control.target >= control.min ? control.target : null) : control.base);
  const input = document.getElementById("base-temperature");
  if (document.activeElement !== input) input.value = control.base === -1 ? "" : control.base;
  updateControls();
}
function updateTemperatureControls() {
  const online = brokerConnected && heaterState.status === "online" && temperatureControl;
  const locked = Boolean(currentOperationLock());
  const editable = online && heaterState.power === true && !locked;
  document.getElementById("temperature-down").disabled = !editable;
  document.getElementById("temperature-up").disabled = !editable;
  const retry = temperatureOperation?.status === "failed" && temperatureOperation.target === requestedTemperature;
  document.getElementById("save-temperature").disabled = !editable || requestedTemperature === null || (requestedTemperature === temperatureControl?.base && !retry);
  document.getElementById("sync-base").disabled = !online || locked;
  document.getElementById("base-temperature").disabled = !online || locked;
  const output = document.getElementById("target-temperature");
  output.textContent = formatTemperature(requestedTemperature, fahrenheit, fahrenheit ? 1 : 0);
  document.getElementById("adjustment-lock").hidden = !locked;
  const states = { applying: "Adjusting the heater. Controls are locked.", settling: "Saving on the heater. Please wait.",
    verifying: "Waiting for confirmation.", selecting: "An adjustment is being selected on the device.", error: "Could not confirm the change. Try again." };
  const confirmed = !temperatureDraftDirty && temperatureOperation?.status === "confirmed" &&
    temperatureOperation.target === requestedTemperature;
  document.getElementById("adjustment-status").textContent = !online ? "Waiting for the controller" :
    pendingTemperatureCommand ? (pendingTemperatureCommand.timedOut ? "No acknowledgement received. Check the heater and reload before retrying." : "Sending command. Please wait…") :
    confirmed && ["settling", "idle"].includes(temperatureControl.status) ? `Temperatura máx. confirmada: ${output.textContent}` :
    states[temperatureControl.status] || currentOperationLock() || temperatureMessage ||
    (heaterState.power !== true ? "Turn the heater on to adjust." : temperatureDraftDirty ? "Not saved yet. Press Save to apply." : (temperatureControl.base === -1 ? "The display will be read before adjusting." : `Estimated setting: ${temperatureControl.base}°C · range ${temperatureControl.min}–${temperatureControl.max}°C`));
  document.getElementById("base-status").textContent = !online ? "Waiting for the controller" : locked ? "Calibration is locked during adjustment." : (temperatureControl.base === -1 ? "Current setting unknown" : `Estimated setting: ${temperatureControl.base}°C`);
  document.getElementById("save-temperature").textContent = locked ? "Adjustment locked" : "Save temperature";
}
function changeTarget(direction) {
  if (document.getElementById(direction > 0 ? "temperature-up" : "temperature-down").disabled) return;
  const next = requestedTemperature === null ? (direction > 0 ? temperatureControl.min : temperatureControl.max) : requestedTemperature + direction;
  requestedTemperature = next < temperatureControl.min ? temperatureControl.max :
    next > temperatureControl.max ? temperatureControl.min : next;
  temperatureDraftDirty = requestedTemperature !== temperatureControl.base;
  temperatureMessage = "";
  updateTemperatureControls();
}
function sendTemperatureCommand(calibrate, target) {
  if (!temperatureControl || pendingTemperatureCommand || temperatureControl.status !== "idle") return;
  const id = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  if (sendCommand(calibrate ? "sync_temperature_base" : "set_temperature", { target, base: temperatureControl.base, requestId: id })) {
    pendingTemperatureCommand = { id, target, calibrate, timedOut: false, reconciliationStarted: false };
    if (!calibrate) temperatureOperation = null;
    // Never unlock or replay movement commands on a timeout: their delivery is unknown.
    setTimeout(() => {
      if (pendingTemperatureCommand?.id === id) {
        pendingTemperatureCommand.timedOut = true;
        updateControls();
      }
    }, 15000);
    temperatureMessage = "";
    updateControls();
  }
}
function saveTarget() {
  if (!document.getElementById("save-temperature").disabled) sendTemperatureCommand(false, requestedTemperature);
}
function syncTemperatureBase(event) {
  event.preventDefault();
  const input = document.getElementById("base-temperature");
  if (input.reportValidity() && !document.getElementById("sync-base").disabled)
    sendTemperatureCommand(true, Number(input.value));
}
// Keep one diagnostics panel: expanded in the desktop column, collapsible on phones.
const desktopLayout = matchMedia("(min-width: 960px)");
function arrangeDiagnostics() { document.querySelector(".diagnostics").open = desktopLayout.matches; }
desktopLayout.addEventListener("change", arrangeDiagnostics);
arrangeDiagnostics();

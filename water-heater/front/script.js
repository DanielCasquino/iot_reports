const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8080`;
const heaterSocket = createHeaterSocket({ url: WS_URL, onConnection: updateConnection, onMessage: handleMessage });
const connect = heaterSocket.connect;

let fahrenheit = false;
let brokerConnected = false;
let httpConnected = false;
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
  brokerConnected = connected;
  updateBackendIndicator();
  updateControls();
}

function updateBackendIndicator() {
  const indicator = document.getElementById("broker-status");
  indicator.title = brokerConnected ? "Backend connected"
    : httpConnected ? "Backend responding · live connection lost" : "Backend disconnected";
  indicator.setAttribute("aria-label", indicator.title);
  indicator.className = `icon-wrapper icon-wrapper-${brokerConnected ? "on" : "off"}`;
}

function updateEspStatus() {
  const indicator = document.getElementById("esp-status");

  if (!indicator) return;

  updateControls();
  indicator.title = heaterState.status === "online" ? "ESP32 connected" : "ESP32 disconnected";
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
        autoShutdownFeedback = heaterState.power === false ? "Turn the heater on to check its maximum temperature."
          : "Auto-off could not start. Wait for a steady display and try again.";
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
    const pilot = { heating: "Heating", ready: "Ready", unlit: "Pilot off", unknown: "Pilot unconfirmed" };
    const display = { readable: "display readable", unreadable: "display unreadable", off: "display off", dim: "display dim", lit: "display on", unknown: "display unconfirmed" };
    const visor = state.displayState && state.displayState.display !== "unknown" ? state.displayState.display : state.display;
    observationText = online ? `${pilot[state.pilot] || pilot.unknown} · ${display[visor] || display.unknown}` : "Waiting for the ESP32";
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
  if (result.target !== target) return;
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
    autoShutdownFeedback = "Auto-off not confirmed.";
    updateControls();
  }, 7000);
}

function toggleFahrenheit(checkbox) {
  fahrenheit = checkbox.checked;

  try { localStorage.setItem("fahrenheit", String(fahrenheit)); } catch {}

  updateTemperature();
  updateControls();
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
  if (!(brokerConnected || httpConnected) || capturePending) return;
  capturePending = true;
  updateControls();
  const status = document.getElementById("camera-status");
  if (status) status.textContent = "Reading the display…";
  try {
    const response = await fetch("/api/camera/capture", { method: "POST", cache: "no-store" });
    const result = await response.json();
    if (response.status === 409) {
      if (status) status.textContent = "A capture is already in progress.";
      return;
    }
    if (!response.ok || result.error || typeof result.value !== "number" || !Number.isFinite(result.value)) {
      if (status) status.textContent = result.observedAt ? "The camera responded. The display could not be read." : "The camera did not return an image.";
    } else if (status) status.textContent = `Display reading · ${result.value} °C`;
    const image = document.getElementById("camera-preview");
    if (image) image.src = `/api/camera/image?t=${Date.now()}`;
  } catch {
    if (status) status.textContent = "The backend did not respond to the capture.";
  } finally { capturePending = false; updateControls(); }
}

function updateColor() {
  const display = document.getElementById("color-display");
  if (display) display.textContent = heaterState.pilotRgbSample === null ? "Pilot LED · RGB unavailable" : `Pilot LED · RGB and clear ${heaterState.pilotRgbSample}`;
}

function currentOperationLock() {
  if (pendingPowerChange || powerControl?.status === "verifying") return "Confirming power…";
  if (temperatureControl?.autoShutdownArmStatus === "verifying") return "Low Cortisol is checking the maximum temperature…";
  if (pendingAutomaticShutdown) return "Confirming auto-off…";
  if (pendingTemperatureCommand || temperatureControl?.locked || temperatureControl?.status === "selecting" ||
      (temperatureOperation?.status === "verifying" && temperatureOperation.attempts > 0))
    return "Temperature adjustment in progress.";
  return null;
}

function hardwareLockReason() {
  if (!brokerConnected || heaterState.status !== "online") return "Controller disconnected.";
  return currentOperationLock() ?? (typeof heaterState.power !== "boolean" ? "Waiting for power confirmation." : null);
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
  document.getElementById("heater-observation").textContent = heaterState.status === "online" ? powerText : "Waiting for the ESP32";
  const lockReason = hardwareLockReason();
  const powerReason = lockReason ?? (temperatureControl ? null : "Waiting for controller status.");
  document.getElementById("big-button").disabled = Boolean(powerReason);
  document.getElementById("automated-shutdown").disabled = Boolean(lockReason);
  document.getElementById("capture-temperature").disabled = !(brokerConnected || httpConnected) || capturePending;
  showControlFeedback("power-lock-status", powerReason);
  const autoTarget = temperatureControl?.autoShutdownTarget;
  const armed = heaterState.autoShutdown && Number.isInteger(autoTarget) && autoTarget >= 30;
  const autoStatus = armed ? `Auto-off target · ${formatTemperature(autoTarget, fahrenheit, fahrenheit ? 1 : 0)}`
    : heaterState.autoShutdown ? "No auto-off target. Re-enable to check the maximum." : null;
  showControlFeedback("auto-shutdown-status", lockReason ?? (autoShutdownFeedback || autoStatus));
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
    httpConnected = true;
    updateBackendIndicator();
    receiveHeaterSnapshot(state);
  } catch {
    httpConnected = false;
    updateBackendIndicator();
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
  const rate = heaterState.status === "online" && typeof heaterState.flowrate === "number" ? heaterState.flowrate : null;
  const volume = heaterState.status === "online" && typeof heaterState.volume === "number" ? heaterState.volume : null;
  document.getElementById("flow-display").textContent = rate === null ? "Flow unavailable"
    : `Flow · ${rate.toFixed(2)} L/min` + (volume === null ? "" : ` · Volume · ${volume.toFixed(2)} L since startup`);
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
  if (control.autoShutdownArmStatus === "verifying") {
    if (pendingAutomaticShutdown?.enabled) pendingAutomaticShutdown = null;
    autoShutdownFeedback = "";
  } else if (control.autoShutdownArmStatus === "failed") {
    if (pendingAutomaticShutdown?.enabled) pendingAutomaticShutdown = null;
    autoShutdownFeedback = "Low Cortisol could not read the maximum. Check the display and try again.";
  }
  if (control.status === "error") temperatureMessage = "Could not confirm the change. Try again.";
  if (pendingTemperatureCommand && control.commandId === pendingTemperatureCommand.id) {
    if (control.result !== "accepted") {
      const errors = { busy: "Another adjustment is in progress.", off: "Turn the heater on first.",
        base_mismatch: "The heater setting changed. Check the current value and save again.",
        disabled: "Temperature control is disabled.", invalid: "Invalid temperature." };
      temperatureMessage = errors[control.result] || "The command was not accepted.";
    } else {
      temperatureMessage = "";
      savedRequestedTemperature = pendingTemperatureCommand.target;
      temperatureDraftDirty = false;
    }
    pendingTemperatureCommand = null;
  }
  if (requestedTemperature === null || (!temperatureDraftDirty && !pendingTemperatureCommand))
    requestedTemperature = savedRequestedTemperature ?? ((control.locked || control.status === "selecting") && control.target >= control.min ? control.target : control.base === -1 ? (control.target >= control.min ? control.target : null) : control.base);
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
  const output = document.getElementById("target-temperature");
  output.textContent = formatTemperature(requestedTemperature, fahrenheit, fahrenheit ? 1 : 0);
  document.getElementById("adjustment-lock").hidden = !locked;
  const states = { applying: "Adjusting the heater. Controls are locked.", settling: "Saving on the heater. Please wait.",
    verifying: "Waiting for confirmation.", selecting: "An adjustment is being selected on the device.", error: "Could not confirm the change. Try again." };
  const confirmed = !temperatureDraftDirty && temperatureOperation?.status === "confirmed" &&
    temperatureOperation.target === requestedTemperature;
  const confirmationLabel = heaterState.temperatureMax === requestedTemperature
    ? "Maximum temperature confirmed" : "Last confirmed target";
  document.getElementById("adjustment-status").textContent = !online ? "Waiting for the controller" :
    pendingTemperatureCommand ? (pendingTemperatureCommand.timedOut ? "No acknowledgement received. Check the heater and reload before retrying." : "Sending command. Please wait…") :
    confirmed && ["settling", "idle"].includes(temperatureControl.status) ? `${confirmationLabel} · ${output.textContent}` :
    states[temperatureControl.status] || currentOperationLock() || temperatureMessage ||
    (heaterState.power !== true ? "Turn the heater on to adjust." : temperatureDraftDirty ? "Not saved yet. Press Save to apply." : (temperatureControl.base === -1 ? "The display will be read before adjusting." : `Estimated setting: ${temperatureControl.base}°C · range ${temperatureControl.min}–${temperatureControl.max}°C`));
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
function sendTemperatureCommand(target) {
  if (!temperatureControl || pendingTemperatureCommand || temperatureControl.status !== "idle") return;
  const id = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  if (sendCommand("set_temperature", { target, base: temperatureControl.base, requestId: id })) {
    pendingTemperatureCommand = { id, target, timedOut: false, reconciliationStarted: false };
    temperatureOperation = null;
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
  if (!document.getElementById("save-temperature").disabled) sendTemperatureCommand(requestedTemperature);
}

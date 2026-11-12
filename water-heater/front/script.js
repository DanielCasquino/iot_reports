const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8080`;
const RECONNECT_DELAY_MS = 2000;

let fahrenheit = false;
let socket;
let brokerConnected = false;
let capturePending = false;
let reconnectTimeout;
let temperatureControl = null;
let desiredTemperature = null;
let temperatureDraftDirty = false;
let pendingTemperatureCommand = null;
let temperatureMessage = "";

let observationText = "Waiting for fresh readings";

const heaterState = {
  power: null,
  autoShutdown: false,
  temperature: null,
  lastTemperature: null,
  status: "offline",
  color: null,
  flowrate: null,
  volume: null,
};

// for weird people
function c2f(temp) {
  return temp * (9 / 5) + 32;
}

// ui shi
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

function updateTemperature() {
  const display = document.getElementById("temp-display");
  const fg = document.getElementById("fg");

  if (fg && heaterState.temperature !== null) {
    const temp = heaterState.temperature;
    const opacity = Math.max(
      0.0,
      Math.min(0.6, ((temp - 30) / (40 - 30)) * 0.6),
    );
    fg.style.opacity = opacity;
  }

  if (!display) return;
  if (heaterState.temperature === null) {
    display.textContent = fahrenheit ? "--.-°F" : "--.-°C";
    if (fg) fg.style.opacity = 0;
    const status = document.getElementById("temperature-status");
    if (status) status.textContent = heaterState.lastTemperature === null
      ? "Temperature unavailable" : `Last reading: ${(fahrenheit ? c2f(heaterState.lastTemperature) : heaterState.lastTemperature).toFixed(1)}${fahrenheit ? "°F" : "°C"} (not current)`;
    return;
  }
  heaterState.lastTemperature = heaterState.temperature;
  const status = document.getElementById("temperature-status");
  if (status) status.textContent = "Current temperature reading";

  const temperature = fahrenheit
    ? c2f(heaterState.temperature)
    : heaterState.temperature;

  const unit = fahrenheit ? "°F" : "°C"; // 😭

  display.textContent = `${temperature.toFixed(1)}${unit}`;
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

// mqtt shi
function handleMqttMessage(data) {
  const { topic, payload } = data;

  switch (topic) {
    case "heater/state/temperature_control": {
      try { receiveTemperatureControl(JSON.parse(payload)); } catch { temperatureControl = null; updateTemperatureControls(); }
      break;
    }
    case "heater/state/power": {
      heaterState.power = payload === "true" ? true : payload === "false" ? false : null;
      updateControls();
      break;
    }
    case "heater/state/autoshutdown": {
      heaterState.autoShutdown = payload === "true";
      updateAutoShutdown();
      break;
    }
    case "heater/state/temperature": {
      const temperature = payload.trim() === "" ? NaN : Number(payload);
      heaterState.temperature = heaterState.status === "online" && Number.isFinite(temperature) && temperature >= 0 && temperature <= 100 ? temperature : null;
      updateTemperature();
      break;
    }
    case "heater/state/flowrate":
    case "heater/state/volume": {
      const value = payload.trim() === "" ? NaN : Number(payload);
      heaterState[topic.endsWith("/flowrate") ? "flowrate" : "volume"] = Number.isFinite(value) && value >= 0 ? value : null;
      updateFlow();
      break;
    }
    case "heater/state/color": {
      heaterState.color = payload === "unavailable" ? null : payload;
      updateColor();
      break;
    }
    case "heater/status": {
      console.log("received " + payload + " from status");
      heaterState.status = payload === "online" ? "online" : "offline";
      if (heaterState.status === "offline") { heaterState.temperature = null; updateTemperature(); }
      updateEspStatus();
    }
    default:
      console.debug("wuduhelllllllllllllllll ooomaga no wayayayyyy:", topic);
      break;
  }
}

// here we either received a state snapshot after requesting it on connection
// or we receive a command
function handleMessage(message) {
  switch (message.event) {
    case "state_snapshot":
      Object.assign(heaterState, message.data);
      receiveTemperatureControl(message.data.temperatureControl);
      const t = heaterState.temperature;
      heaterState.temperature = heaterState.status === "online" && typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= 100 ? t : null;
      updatePowerButton(heaterState.power);
      updateAutoShutdown(heaterState.autoShutdown);
      updateTemperature();
      updateEspStatus(heaterState.status);
      updateColor();
      updateFlow();
      break;
    case "command_error":
      if (pendingTemperatureCommand) {
        pendingTemperatureCommand = null;
        temperatureMessage = message.data.error;
        updateTemperatureControls();
      }
      break;
    case "mqtt_message":
      handleMqttMessage(message.data);
      break;
    default:
      console.debug("wtf message", message);
      break;
  }
}

function connect() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  console.log("Connecting to WebSocket server...");

  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    console.log("WebSocket connected.");
    updateBrokerStatus(true);
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      handleMessage(message);
    } catch (error) {
      console.error("Invalid WebSocket message:", error);
    }
  });

  socket.addEventListener("close", () => {
    console.log("WebSocket disconnected.");
    updateBrokerStatus(false);
    heaterState.status = "offline";
    temperatureControl = null;
    updateTemperatureControls();
    heaterState.color = null;
    updateColor();
    updateEspStatus();
    heaterState.temperature = null;
    updateTemperature();

    reconnectTimeout = setTimeout(connect, RECONNECT_DELAY_MS);
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
    socket.close();
  });
}

function sendCommand(event, data) {
  if (!brokerConnected || heaterState.status !== "online" || !socket || socket.readyState !== WebSocket.OPEN) {
    console.error("Cannot send command: WebSocket is not connected.");
    return false;
  }

  socket.send(JSON.stringify({ event, data }));
  console.log(JSON.stringify({ event, data }));
  return true;
}

// ui input shi
function toggleTerma() {
  if (typeof heaterState.power !== "boolean") return;
  sendCommand("set_heater_power", {
    enabled: !heaterState.power,
  });
}

function toggleAutomatedShutdown(checkbox) {
  const requestedState = checkbox.checked;

  checkbox.checked = heaterState.autoShutdown;

  sendCommand("set_auto_shutdown", {
    enabled: requestedState,
  });
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

// int main type shi
window.addEventListener("load", () => {
  retrieveLocalSettings();

  updatePowerButton();
  updateAutoShutdown();
  updateBrokerStatus(false);
  updateEspStatus();

  connect();
});

async function captureTemperature(wake = false) {
  if (!brokerConnected || heaterState.status !== "online" || capturePending || (wake && !heaterState.power)) return;
  capturePending = true;
  const button = document.getElementById("capture-temperature");
  const status = document.getElementById("camera-status");
  const wakeButton = document.getElementById("wake-temperature");
  if (button) button.disabled = true;
  if (wakeButton) wakeButton.disabled = true;
  if (status) status.textContent = "Capturing and reading display...";
  try {
    const response = await fetch(wake ? "/api/camera/capture?wake=1" : "/api/camera/capture", { method: "POST", cache: "no-store" });
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
  if (display) display.textContent = heaterState.color === null ? "RGB sensor unavailable" : `Raw R,G,B,C: ${heaterState.color}`;
}

function updateControls() {
  const available = brokerConnected && heaterState.status === "online";
  updatePowerButton();
  updateFlow();
  updateTemperatureControls();
  document.getElementById("heater-observation").textContent = available ? observationText : "Waiting for fresh readings";
  for (const id of ["big-button", "automated-shutdown", "capture-temperature", "wake-temperature"]) {
    const control = document.getElementById(id);
    if (control) control.disabled = !available || (id === "big-button" && typeof heaterState.power !== "boolean") || ((id.includes("temperature")) && capturePending) || (id === "wake-temperature" && !heaterState.power);
  }
  const status = document.getElementById("connection-status");
  if (status) status.textContent = available ? "Connected · controls ready" : "Disconnected · controls unavailable";
}

// The backend combines fresh observations; a failed OCR does not establish sleep.
async function refreshObservation() {
  try {
    const response = await fetch("/api/heater/status", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error("Status unavailable");
    const state = await response.json();
    const pilot = { heating: "Heating", ready: "Maintaining temperature", unlit: "Pilot unlit", unknown: "Pilot not confirmed" };
    const display = { readable: "display readable", unreadable: "display unreadable", unknown: "display not confirmed" };
    observationText = state.online
      ? `${pilot[state.pilot] || pilot.unknown} · ${display[state.display] || display.unknown}`
      : "Waiting for fresh device readings";
    heaterState.status = state.online ? "online" : "offline";
    heaterState.power = typeof state.power === "boolean" ? state.power : null;
    updateEspStatus();
    if (!state.online) {
      heaterState.status = "offline";
      heaterState.color = null;
      updateColor();
      updateEspStatus();
    }
    if (!state.online || state.temperature === null) {
      heaterState.temperature = null;
      updateTemperature();
    }
  } catch {
    observationText = "Live status unavailable";
    heaterState.status = "offline";
    heaterState.temperature = null;
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
  if (!control || !Number.isInteger(control.base) || control.base < 35 || control.base > 75 ||
      !["idle", "selecting", "applying", "settling", "verifying", "error"].includes(control.status) ||
      typeof control.locked !== "boolean" || control.locked !== !["idle", "selecting"].includes(control.status) ||
      control.min !== 35 || control.max !== 75 || !Number.isInteger(control.target) || control.target < 0 || control.target > 75 ||
      !Number.isInteger(control.commandId) || control.commandId < 0 || control.commandId > 0xffffffff) {
    temperatureControl = null;
    updateTemperatureControls();
    return;
  }
  temperatureControl = control;
  if (pendingTemperatureCommand && control.commandId === pendingTemperatureCommand.id) {
    if (control.result !== "accepted") {
      const errors = { busy: "Another adjustment is in progress.", off: "Turn the heater on first.",
        base_mismatch: "The heater setting changed. Check the current value and save again.",
        disabled: "Temperature control is disabled.", invalid: "Invalid temperature." };
      temperatureMessage = errors[control.result] || "The command was not accepted.";
    } else {
      temperatureMessage = pendingTemperatureCommand.calibrate ? "Current setting synchronized. No servos moved." : "";
      temperatureDraftDirty = false;
    }
    pendingTemperatureCommand = null;
  }
  if (desiredTemperature === null || (!temperatureDraftDirty && !pendingTemperatureCommand))
    desiredTemperature = control.locked || control.status === "selecting" ? control.target : control.base;
  const input = document.getElementById("base-temperature");
  if (document.activeElement !== input) input.value = control.base;
  updateTemperatureControls();
}
function updateTemperatureControls() {
  const online = brokerConnected && heaterState.status === "online" && temperatureControl;
  const locked = Boolean(pendingTemperatureCommand || temperatureControl?.locked || temperatureControl?.status === "selecting");
  const editable = online && heaterState.power === true && !locked;
  document.getElementById("temperature-down").disabled = !editable || desiredTemperature <= (temperatureControl?.min ?? 35);
  document.getElementById("temperature-up").disabled = !editable || desiredTemperature >= (temperatureControl?.max ?? 75);
  document.getElementById("save-temperature").disabled = !editable || desiredTemperature === temperatureControl?.base;
  document.getElementById("sync-base").disabled = !online || locked;
  document.getElementById("base-temperature").disabled = !online || locked;
  const output = document.getElementById("target-temperature");
  output.textContent = desiredTemperature === null ? "--°C" : `${fahrenheit ? c2f(desiredTemperature).toFixed(1) : desiredTemperature}°${fahrenheit ? "F" : "C"}`;
  document.getElementById("adjustment-lock").hidden = !locked;
  const states = { applying: "Adjusting the heater. Controls are locked.", settling: "Saving on the heater. Please wait.",
    verifying: "Waiting for confirmation.", selecting: "An adjustment is being selected on the device.", error: "Adjustment failed. Check the heater before continuing." };
  document.getElementById("adjustment-status").textContent = !online ? "Waiting for the controller" :
    pendingTemperatureCommand ? (pendingTemperatureCommand.timedOut ? "No acknowledgement received. Check the heater and reload before retrying." : "Sending command. Please wait…") : states[temperatureControl.status] || temperatureMessage ||
    (heaterState.power !== true ? "Turn the heater on to adjust." : temperatureDraftDirty ? "Not saved yet. Press Save to apply." : `Estimated setting: ${temperatureControl.base}°C · range ${temperatureControl.min}–${temperatureControl.max}°C`);
  document.getElementById("base-status").textContent = !online ? "Waiting for the controller" : locked ? "Calibration is locked during adjustment." : `Estimated setting: ${temperatureControl.base}°C`;
  document.getElementById("save-temperature").textContent = locked ? "Adjustment locked" : "Save temperature";
}
function changeTarget(direction) {
  if (document.getElementById(direction > 0 ? "temperature-up" : "temperature-down").disabled) return;
  desiredTemperature = Math.max(temperatureControl.min, Math.min(temperatureControl.max, desiredTemperature + direction));
  temperatureDraftDirty = desiredTemperature !== temperatureControl.base;
  temperatureMessage = "";
  updateTemperatureControls();
}
function sendTemperatureCommand(calibrate, target) {
  if (!temperatureControl || pendingTemperatureCommand || temperatureControl.status !== "idle") return;
  const id = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  if (sendCommand(calibrate ? "sync_temperature_base" : "set_temperature", { target, base: temperatureControl.base, requestId: id })) {
    pendingTemperatureCommand = { id, calibrate, timedOut: false };
    // Never unlock or replay movement commands on a timeout: their delivery is unknown.
    setTimeout(() => {
      if (pendingTemperatureCommand?.id === id) {
        pendingTemperatureCommand.timedOut = true;
        updateTemperatureControls();
      }
    }, 15000);
    temperatureMessage = "";
    updateTemperatureControls();
  }
}
function saveTarget() {
  if (!document.getElementById("save-temperature").disabled) sendTemperatureCommand(false, desiredTemperature);
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

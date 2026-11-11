const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8080`;
const RECONNECT_DELAY_MS = 2000;

let fahrenheit = false;
let socket;

const heaterState = {
  power: false,
  autoShutdown: false,
  temperature: null,
  lastTemperature: null,
  status: "offline",
  color: null,
};

// for weird people
function c2f(temp) {
  return temp * (9 / 5) + 32;
}

// ui shi
function updatePowerButton() {
  const button = document.getElementById("big-button");

  if (!button) return;

  button.className = `big-button big-button-${heaterState.power ? "on" : "off"}`;
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
    display.textContent = "--.-°C";
    if (fg) fg.style.opacity = 0;
    const status = document.getElementById("temperature-status");
    if (status) status.textContent = heaterState.lastTemperature === null
      ? "Temperature unavailable" : `Last reading: ${heaterState.lastTemperature.toFixed(1)}°C (not current)`;
    return;
  }
  heaterState.lastTemperature = heaterState.temperature;
  const status = document.getElementById("temperature-status");
  if (status) status.textContent = "Current OCR reading";

  const temperature = fahrenheit
    ? c2f(heaterState.temperature)
    : heaterState.temperature;

  const unit = fahrenheit ? "°F" : "°C"; // 😭

  display.textContent = `${temperature.toFixed(1)}${unit}`;
}

function updateBrokerStatus(connected) {
  const indicator = document.getElementById("broker-status");

  if (!indicator) return;

  indicator.className = `icon-wrapper icon-wrapper-${connected ? "on" : "off"}`;
}

function updateEspStatus() {
  const indicator = document.getElementById("esp-status");

  if (!indicator) return;

  indicator.className = `icon-wrapper icon-wrapper-${heaterState.status === "online" ? "on" : "off"}`;
}

// mqtt shi
function handleMqttMessage(data) {
  const { topic, payload } = data;

  switch (topic) {
    case "heater/state/power": {
      heaterState.power = payload === "true";
      updatePowerButton();
      break;
    }
    case "heater/state/autoshutdown": {
      heaterState.autoShutdown = payload === "true";
      updateAutoShutdown();
      break;
    }
    case "heater/state/temperature": {
      const temperature = payload.trim() === "" ? NaN : Number(payload);
      heaterState.temperature = Number.isFinite(temperature) && temperature >= 0 && temperature <= 100 ? temperature : null;
      updateTemperature();
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
      updatePowerButton(heaterState.power);
      updateAutoShutdown(heaterState.autoShutdown);
      updateTemperature();
      updateEspStatus(heaterState.status);
      updateColor();
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
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error("Cannot send command: WebSocket is not connected.");
    return;
  }

  socket.send(JSON.stringify({ event, data }));
  console.log(JSON.stringify({ event, data }));
}

// ui input shi
function toggleTerma() {
  sendCommand("set_heater_power", {
    enabled: !heaterState.power,
  });
}

function toggleAutomatedShutdown(checkbox) {
  sendCommand("set_auto_shutdown", {
    enabled: checkbox.checked,
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

  localStorage.setItem("fahrenheit", String(fahrenheit));

  updateTemperature();
}

function retrieveLocalSettings() {
  fahrenheit = localStorage.getItem("fahrenheit") === "true";

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
  const button = document.getElementById("capture-temperature");
  const status = document.getElementById("camera-status");
  const wakeButton = document.getElementById("wake-temperature");
  if (button) button.disabled = true;
  if (wakeButton) wakeButton.disabled = true;
  if (status) status.textContent = "Capturing and reading display...";
  try {
    const response = await fetch(wake ? "/api/camera/capture?wake=1" : "/api/camera/capture", { method: "POST" });
    const result = await response.json();
    if (status) status.textContent = result.error || `OCR: ${result.value}°C (${Math.round(result.confidence)}%)`;
    const image = document.getElementById("camera-preview");
    if (image) image.src = `/api/camera/image?t=${Date.now()}`;
  } catch (error) {
    if (status) status.textContent = "Camera/backend unavailable";
  } finally { if (button) button.disabled = false; if (wakeButton) wakeButton.disabled = false; }
}

function updateColor() {
  const display = document.getElementById("color-display");
  if (display) display.textContent = heaterState.color === null ? "RGB sensor unavailable" : `Raw R,G,B,C: ${heaterState.color}`;
}

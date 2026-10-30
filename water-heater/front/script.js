const WS_URL = "ws://10.117.122.228:8080";
const RECONNECT_DELAY_MS = 2000;

let fahrenheit = false;
let socket;

const heaterState = {
  power: false,
  autoShutdown: false,
  temperature: 0,
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

  if (!display || heaterState.temperature === null) return;

  const temperature = fahrenheit
    ? c2f(heaterState.temperature)
    : heaterState.temperature;

  const unit = fahrenheit ? "°F" : "°C"; // 😭

  display.textContent = `${temperature.toFixed(1)}${unit}`;
}

function updateConnectionStatus(connected) {
  const indicator = document.getElementById("top-bar");

  if (!indicator) return;

  indicator.className = `top-bar top-bar-${connected ? "on" : "off"}`;
}

// mqtt shi
function handleMqttMessage(data) {
  const { topic, payload } = data;

  switch (topic) {
    case "heater/state/power":
      heaterState.power = payload === "true";
      updatePowerButton();
      break;

    case "heater/state/autoshutdown":
      heaterState.autoShutdown = payload === "true";
      updateAutoShutdown();
      break;

    case "heater/state/temperature":
      {
        const temperature = Number.parseFloat(payload);

        if (Number.isFinite(temperature)) {
          heaterState.temperature = temperature;
          updateTemperature();
        }
      }
      break;
    default:
      console.debug("wuduhelllllllllllllllll ooomaga no wayayayyyy:", topic);
      break;
  }
}

function handleMessage(message) {
  switch (message.event) {
    case "state_snapshot":
      Object.assign(heaterState, message.data);
      updatePowerButton(heaterState.power);
      updateAutoShutdown(heaterState.autoShutdown);
      if (heaterState.temperature !== null)
        updateTemperature(heaterState.temperature);
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
    updateConnectionStatus(true);
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
    updateConnectionStatus(false);

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
  updateConnectionStatus(false);

  connect();
});

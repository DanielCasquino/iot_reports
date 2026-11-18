function formatTemperature(value, fahrenheit, precision = 1) {
  const unit = fahrenheit ? "°F" : "°C";
  if (value === null) return (precision ? "--.-" : "--") + unit;
  return (fahrenheit ? value * 9 / 5 + 32 : value).toFixed(precision) + unit;
}

function renderTemperatureReadout({ reading, lastReading, temperatureMax, heaterOff, fromCamera, fahrenheit }) {
  const display = document.getElementById("temp-display");
  const maximum = document.getElementById("observed-maximum");
  const status = document.getElementById("temperature-status");
  const effect = document.getElementById("fg");
  const displayedTemperature = reading ?? lastReading;

  if (maximum) maximum.textContent = temperatureMax === null ? "Unconfirmed"
    : formatTemperature(temperatureMax, fahrenheit, fahrenheit ? 1 : 0);
  if (effect) effect.style.opacity = displayedTemperature === null ? 0
    : Math.max(0, Math.min(0.6, ((displayedTemperature - 30) / (40 - 30)) * 0.6));
  if (display) {
    display.textContent = formatTemperature(displayedTemperature, fahrenheit);
    display.title = reading !== null ? (fromCamera ? "Camera display reading" : "Current temperature reading")
      : lastReading === null ? "Temperature unavailable" : "Last valid reading (not current)";
  }
  if (status) {
    status.hidden = reading !== null && !fromCamera;
    status.textContent = reading !== null ? (fromCamera ? "Display reading · ESP32 disconnected" : "")
      : lastReading === null ? (heaterOff ? "Heater off · no reading" : "Temperature unavailable")
      : heaterOff ? "Last reading · heater off" : "Last reading · live reading unavailable";
  }
}

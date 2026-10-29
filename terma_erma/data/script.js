var farenheit = false;
var cachedTemp = 29.0;

function c2f(temp) {
    return temp * (9 / 5) + 32;
}

async function toggleTerma() {
    try {
        const response = await fetch("/toggle_terma");
        if (!response.ok) return;
        const t = await response.text();
        let isTermaOn = t == 1;
        document.getElementById("big-button").classList = "big-button big-button-" + (isTermaOn ? "on" : "off");
    }
    catch {
        return;
    }
}

async function getTerma() {
    try {
        const response = await fetch("/get_terma");
        if (!response.ok) return;
        const t = await response.text();
        let isTermaOn = t == 1;
        document.getElementById("big-button").classList = "big-button big-button-" + (isTermaOn ? "on" : "off");
    }
    catch {
        return;
    }
}

async function getTemp() {
    try {
        const response = await fetch("/get_temp");
        if (!response.ok) return;
        const t = await response.text();
        cachedTemp = parseFloat(t);
        if (farenheit)
            document.getElementById("temp-display").innerText = c2f(cachedTemp).toFixed(1) + "°F";
        else
            document.getElementById("temp-display").innerText = cachedTemp.toFixed(1) + "°C";
    }
    catch {
        return;
    }
}

async function getAutomatedShutdown() {
    try {
        const response = await fetch("/get_lowcort");
        if (!response.ok) return;
        const t = await response.text();
        let enabled = t == 1;
        document.getElementById("automated-shutdown").checked = enabled;
    }
    catch {
        return;
    }
}

async function toggleAutomatedShutdown(checkbox) {
    try {
        const response = await fetch("/toggle_lowcort");
        if (!response.ok) return;
        const t = await response.text();
        let enabled = t == 1;
        document.getElementById("automated-shutdown").checked = enabled;
    }
    catch {
        return;
    }
}

async function toggleFarenheit(checkbox) {
    farenheit = checkbox.checked;
    if (farenheit)
        document.getElementById("temp-display").innerText = c2f(cachedTemp).toFixed(1) + "°F";
    else
        document.getElementById("temp-display").innerText = cachedTemp.toFixed(1) + "°C";
    localStorage.setItem("farenheit", true);
}

async function retrieveLocalSettings() {
    farenheit = localStorage.getItem("farenheit");
    document.getElementById("farenheit").checked = farenheit;
}

setInterval(getTemp, 2000);
setInterval(getTerma, 2000);
setInterval(getAutomatedShutdown, 2000);

window.onload = () => {
    retrieveLocalSettings();
    getTemp();
    getTerma();
    getAutomatedShutdown();
};

// this is awful code
/**
 * Fischertechnik Factory — Glass Dashboard
 * Live data polling and UI updates via /api/data
 */

const POLL_INTERVAL = 500; // ms
const MAX_HISTORY = 300;   // ~2.5 min at 500ms

// --- History buffers ---
const history = {
    timestamps: [],
    "Oven Lamp": [],
    "Saw": [],
    "Compressor MS": [],
    "Color Sensor": [],
    "MS Step": [],
};

const HISTORY_KEYS_MAP = {
    "Oven Lamp": { station: "MS", group: "actuators", label: "Oven Lamp (Burn)" },
    "Saw": { station: "MS", group: "actuators", label: "Saw" },
    "Compressor MS": { station: "MS", group: "actuators", label: "Compressor MS" },
    "Color Sensor": { station: "SL", group: "sensors", label: "Color Sensor" },
    "MS Step": { station: "State", group: "state", label: "MS Process Step" },
};

const CHART_COLORS = {
    "Oven Lamp": "#FF9F0A",
    "Saw": "#007AFF",
    "Compressor MS": "#BF5AF2",
    "Color Sensor": "#64D2FF",
    "MS Step": "#30D158",
};

// --- Variable config (fetched from server) ---
let varConfig = null;

// --- Chart.js instance ---
let chart = null;

// ============================================
//  Initialization
// ============================================

async function init() {
    try {
        const res = await fetch("/api/config");
        varConfig = await res.json();
    } catch {
        varConfig = null;
    }

    if (varConfig) {
        buildVariableElements();
    }

    initChart();
    buildLegend();
    poll();
}

// ============================================
//  Build DOM elements for variables
// ============================================

function buildVariableElements() {
    for (const [station, groups] of Object.entries(varConfig)) {
        for (const [groupName, vars] of Object.entries(groups)) {
            const containerId = station === "State"
                ? `state-${station}`
                : `${groupName}-${station}`;
            const container = document.getElementById(containerId);
            if (!container) continue;

            for (const [label, varType] of Object.entries(vars)) {
                const id = makeId(station, label);

                if (station === "State") {
                    const isEmergency = label.toLowerCase().includes("emergency");
                    const div = document.createElement("div");
                    div.className = `state-var${isEmergency ? " emergency" : ""}`;
                    div.innerHTML = `
                        <span class="var-label">${label}</span>
                        <span class="var-value" id="val-${id}">--</span>
                    `;
                    container.appendChild(div);
                } else {
                    const div = document.createElement("div");
                    div.className = "var-item";
                    div.id = `item-${id}`;
                    div.innerHTML = `
                        <span class="var-indicator"></span>
                        <span class="var-label" title="${label}">${label}</span>
                        <span class="var-value" id="val-${id}">--</span>
                    `;
                    container.appendChild(div);
                }
            }
        }
    }
}

function makeId(station, label) {
    return `${station}-${label}`.replace(/[^a-zA-Z0-9]/g, "_");
}

// ============================================
//  Chart.js Setup
// ============================================

function initChart() {
    const ctx = document.getElementById("timeline-chart").getContext("2d");

    const datasets = Object.keys(CHART_COLORS).map(key => ({
        label: key,
        data: [],
        borderColor: CHART_COLORS[key],
        backgroundColor: CHART_COLORS[key] + "20",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
    }));

    chart = new Chart(ctx, {
        type: "line",
        data: { labels: [], datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 200 },
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "rgba(20, 20, 30, 0.9)",
                    backdropFilter: "blur(12px)",
                    titleFont: { family: "Inter", weight: "600", size: 12 },
                    bodyFont: { family: "'SF Mono', monospace", size: 11 },
                    padding: 10,
                    cornerRadius: 10,
                    borderColor: "rgba(255,255,255,0.1)",
                    borderWidth: 1,
                },
            },
            scales: {
                x: {
                    display: true,
                    grid: { display: false },
                    ticks: {
                        color: "rgba(255,255,255,0.25)",
                        font: { family: "'SF Mono', monospace", size: 10 },
                        maxTicksLimit: 8,
                    },
                },
                y: {
                    display: true,
                    grid: {
                        color: "rgba(255,255,255,0.04)",
                        drawBorder: false,
                    },
                    ticks: {
                        color: "rgba(255,255,255,0.25)",
                        font: { family: "'SF Mono', monospace", size: 10 },
                    },
                },
            },
        },
    });
}

function buildLegend() {
    const container = document.getElementById("chart-legend");
    for (const [key, color] of Object.entries(CHART_COLORS)) {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${key}`;
        container.appendChild(item);
    }
}

// ============================================
//  Polling & Data Update
// ============================================

async function poll() {
    try {
        const res = await fetch("/api/data");
        const json = await res.json();
        updateUI(json);
    } catch {
        updateConnectionStatus("disconnected", "Offline");
    }
    setTimeout(poll, POLL_INTERVAL);
}

function updateUI(json) {
    const { status, data } = json;
    const now = new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
    });

    // Connection status
    updateConnectionStatus(status === "connected" ? "connected" : "disconnected",
        status === "connected" ? "Connected" : "Disconnected");

    // Timestamp
    document.getElementById("timestamp").textContent = now;

    if (!data || Object.keys(data).length === 0) return;

    // Update variable indicators
    for (const [station, groups] of Object.entries(data)) {
        let stationHasActivity = false;

        for (const [groupName, vars] of Object.entries(groups)) {
            for (const [label, value] of Object.entries(vars)) {
                const id = makeId(station, label);

                if (station === "State") {
                    updateStateVar(id, label, value);
                } else {
                    const isActive = updateVarItem(id, value);
                    if (isActive) stationHasActivity = true;
                }
            }
        }

        // Update station status badge
        if (station !== "State") {
            updateStationStatus(station, stationHasActivity);
        }
    }

    // Emergency shutdown
    const emergencyVal = data?.State?.state?.["Emergency Shutdown"];
    const banner = document.getElementById("emergency-banner");
    if (emergencyVal === true) {
        banner.style.display = "flex";
    } else {
        banner.style.display = "none";
    }

    // Process steps
    const msStep = data?.State?.state?.["MS Process Step"];
    updateProcessSteps(msStep);

    // Color sensor
    const colorVal = data?.SL?.sensors?.["Color Sensor"];
    updateColorSensor(colorVal);

    // Update history & chart
    updateHistory(data, now);
}

function updateConnectionStatus(state, text) {
    const badge = document.getElementById("connection-badge");
    const textEl = document.getElementById("connection-text");
    badge.className = `connection-badge ${state}`;
    textEl.textContent = text;
}

function updateVarItem(id, value) {
    const item = document.getElementById(`item-${id}`);
    const valEl = document.getElementById(`val-${id}`);
    if (!item || !valEl) return false;

    const isError = typeof value === "string" && value.startsWith("ERR");
    const isBool = typeof value === "boolean";
    const isActive = isBool ? value : false;

    item.className = "var-item" + (isActive ? " active" : "") + (isError ? " error" : "");

    if (isError) {
        valEl.textContent = "ERR";
    } else if (isBool) {
        valEl.textContent = value ? "ON" : "OFF";
    } else {
        valEl.textContent = value ?? "--";
    }

    return isActive;
}

function updateStateVar(id, label, value) {
    const valEl = document.getElementById(`val-${id}`);
    if (!valEl) return;

    if (typeof value === "boolean") {
        valEl.textContent = value ? "ACTIVE" : "OK";
        valEl.style.color = value ? "var(--red)" : "var(--green)";
    } else {
        valEl.textContent = value ?? "--";
    }
}

function updateStationStatus(station, hasActivity) {
    const statusEl = document.getElementById(`status-${station}`);
    if (!statusEl) return;
    const dot = statusEl.querySelector(".status-dot");
    const label = statusEl.querySelector(".status-label");

    if (hasActivity) {
        dot.className = "status-dot active";
        label.textContent = "Active";
        label.style.color = "var(--green)";
    } else {
        dot.className = "status-dot idle";
        label.textContent = "Idle";
        label.style.color = "var(--text-tertiary)";
    }
}

function updateProcessSteps(step) {
    const steps = document.querySelectorAll(".step-item");
    const connectors = document.querySelectorAll(".step-connector");
    if (step == null) return;

    steps.forEach((el, i) => {
        const s = parseInt(el.dataset.step);
        el.classList.remove("active", "completed");
        if (s === step) el.classList.add("active");
        else if (s < step) el.classList.add("completed");
    });

    connectors.forEach((el, i) => {
        el.classList.remove("active", "completed");
        if (i < step) el.classList.add("completed");
        else if (i === step - 1) el.classList.add("active");
    });
}

function updateColorSensor(value) {
    const fill = document.getElementById("color-bar-fill");
    const valEl = document.getElementById("color-value");
    if (!fill || !valEl || value == null) return;

    const numVal = typeof value === "number" ? value : parseInt(value) || 0;
    const pct = Math.min(100, (numVal / 300) * 100);
    fill.style.width = pct + "%";

    // Color classification: blue <100, red 100-220, white >220
    fill.className = "color-bar-fill";
    if (numVal > 220) fill.classList.add("white");
    else if (numVal > 100) fill.classList.add("red");
    else fill.classList.add("blue");

    valEl.textContent = numVal;
}

// ============================================
//  History & Chart Update
// ============================================

function updateHistory(data, timestamp) {
    history.timestamps.push(timestamp);
    if (history.timestamps.length > MAX_HISTORY) {
        history.timestamps.shift();
    }

    for (const [key, mapping] of Object.entries(HISTORY_KEYS_MAP)) {
        let value = data?.[mapping.station]?.[mapping.group]?.[mapping.label];
        if (typeof value === "boolean") value = value ? 1 : 0;
        if (typeof value === "string") value = 0;
        value = value ?? 0;

        history[key].push(value);
        if (history[key].length > MAX_HISTORY) {
            history[key].shift();
        }
    }

    // Update chart
    chart.data.labels = [...history.timestamps];
    const keys = Object.keys(CHART_COLORS);
    keys.forEach((key, i) => {
        chart.data.datasets[i].data = [...history[key]];
    });
    chart.update("none"); // skip animation for performance
}

// ============================================
//  Start
// ============================================

document.addEventListener("DOMContentLoaded", init);

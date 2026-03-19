/**
 * Fischertechnik Factory — Glass Dashboard
 * Fully data-driven: builds station cards from /api/config,
 * polls /api/data for live or demo-replay updates.
 */

const POLL_INTERVAL = 400;
const MAX_HISTORY = 300;

// Station metadata for styling
const STATION_META = {
    MS:    { name: "Machining Station", accent: "#007AFF", icon: "gear" },
    SL:    { name: "Sorting Line",      accent: "#FF9F0A", icon: "sort" },
    Crane: { name: "Crane",             accent: "#30D158", icon: "crane" },
    HBW:   { name: "High Bay Warehouse",accent: "#BF5AF2", icon: "warehouse" },
    PM:    { name: "Punching Machine",  accent: "#FF453A", icon: "punch" },
    State: { name: "Process State",     accent: "#64D2FF", icon: "info" },
};

const STATION_ICONS = {
    gear: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"/></svg>`,
    sort: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M3 3a1 1 0 000 2h11a1 1 0 100-2H3zM3 7a1 1 0 000 2h7a1 1 0 100-2H3zM3 11a1 1 0 100 2h4a1 1 0 100-2H3zM15 8a1 1 0 10-2 0v5.586l-1.293-1.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L15 13.586V8z"/></svg>`,
    crane: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"/></svg>`,
    warehouse: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4zM3 8h2v9a2 2 0 002 2h6a2 2 0 002-2V8h2a1 1 0 001-1H2a1 1 0 001 1zm5 2a1 1 0 112 0v4a1 1 0 11-2 0v-4z"/></svg>`,
    punch: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z"/></svg>`,
    info: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/></svg>`,
};

// --- History for chart ---
const history = { timestamps: [] };
const TRACKED_SIGNALS = {};  // Will be auto-populated

// --- Chart ---
let chart = null;
let varConfig = null;

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
        buildStationCards(varConfig);
        autoDetectTrackedSignals(varConfig);
    }

    initChart();
    poll();
}

// ============================================
//  Dynamic Station Card Generation
// ============================================

function buildStationCards(config) {
    const grid = document.getElementById("station-grid");
    grid.innerHTML = "";

    // Order stations
    const stationOrder = ["MS", "SL", "Crane", "HBW", "PM", "State"];
    const stations = stationOrder.filter(s => config[s]);
    // Add any unknown stations
    for (const s of Object.keys(config)) {
        if (!stations.includes(s)) stations.push(s);
    }

    for (const station of stations) {
        const groups = config[station];
        const meta = STATION_META[station] || { name: station, accent: "#64D2FF", icon: "info" };

        const card = document.createElement("div");
        card.className = "station-card glass";
        card.dataset.station = station;

        // Header
        const isState = station === "State";
        card.innerHTML = `
            <div class="card-header">
                <div class="station-icon" style="--accent: ${meta.accent}">
                    ${STATION_ICONS[meta.icon] || STATION_ICONS.info}
                </div>
                <div>
                    <h2 class="station-name">${meta.name}</h2>
                    <span class="station-tag">${station}</span>
                </div>
                ${!isState ? `
                <div class="station-status" id="status-${station}">
                    <span class="status-dot idle"></span>
                    <span class="status-label">Idle</span>
                </div>` : ""}
            </div>
            <div class="card-body" id="body-${station}"></div>
        `;

        const body = card.querySelector(".card-body");

        for (const [groupName, vars] of Object.entries(groups)) {
            if (isState) {
                // State variables rendered as key-value rows
                for (const [label, varType] of Object.entries(vars)) {
                    const id = makeId(station, label);
                    const div = document.createElement("div");
                    div.className = "state-var";
                    div.innerHTML = `
                        <span class="var-label">${label}</span>
                        <span class="var-value" id="val-${id}">--</span>
                    `;
                    body.appendChild(div);
                }
            } else {
                const section = document.createElement("div");
                section.className = "var-section";
                section.innerHTML = `<h3 class="section-label">${groupName}</h3>`;

                const varGrid = document.createElement("div");
                varGrid.className = "var-grid";
                varGrid.id = `${groupName}-${station}`;

                for (const [label, varType] of Object.entries(vars)) {
                    const id = makeId(station, label);
                    const div = document.createElement("div");
                    div.className = "var-item";
                    div.id = `item-${id}`;
                    div.innerHTML = `
                        <span class="var-indicator"></span>
                        <span class="var-label" title="${label}">${label}</span>
                        <span class="var-value" id="val-${id}">--</span>
                    `;
                    varGrid.appendChild(div);
                }

                section.appendChild(varGrid);
                body.appendChild(section);
            }
        }

        // Add color sensor bar for SL
        if (station === "SL") {
            const colorDiv = document.createElement("div");
            colorDiv.className = "color-sensor-display";
            colorDiv.id = "color-sensor-display";
            colorDiv.innerHTML = `
                <span class="section-label">Color Sensor Value</span>
                <div class="color-bar-track">
                    <div class="color-bar-fill" id="color-bar-fill"></div>
                </div>
                <div class="color-bar-labels">
                    <span class="color-label blue">Blue (0-100)</span>
                    <span class="color-label red">Red (100-220)</span>
                    <span class="color-label white">White (220+)</span>
                </div>
                <span class="color-value" id="color-value">--</span>
            `;
            body.appendChild(colorDiv);
        }

        grid.appendChild(card);
    }
}

function makeId(station, label) {
    return `${station}-${label}`.replace(/[^a-zA-Z0-9]/g, "_");
}

// ============================================
//  Auto-detect interesting signals for chart
// ============================================

function autoDetectTrackedSignals(config) {
    const CHART_COLORS = ["#FF9F0A", "#007AFF", "#BF5AF2", "#64D2FF", "#30D158", "#FF375F", "#FF453A"];
    const interestingPatterns = [
        { pattern: /lamp/i, station: null },
        { pattern: /saw/i, station: null },
        { pattern: /compressor/i, station: "MS" },
        { pattern: /color.?sensor/i, station: null },
        { pattern: /conveyor.*belt/i, station: "MS" },
        { pattern: /oven.*door/i, station: null },
        { pattern: /tool.*down/i, station: null },
    ];

    let colorIdx = 0;
    const maxSignals = 6;

    for (const { pattern, station: preferStation } of interestingPatterns) {
        if (Object.keys(TRACKED_SIGNALS).length >= maxSignals) break;

        for (const [station, groups] of Object.entries(config)) {
            if (preferStation && station !== preferStation) continue;
            if (station === "State") continue;

            for (const [group, vars] of Object.entries(groups)) {
                for (const label of Object.keys(vars)) {
                    if (pattern.test(label) && !TRACKED_SIGNALS[label]) {
                        TRACKED_SIGNALS[label] = {
                            station, group, label,
                            color: CHART_COLORS[colorIdx % CHART_COLORS.length],
                        };
                        history[label] = [];
                        colorIdx++;
                        break;
                    }
                }
                if (TRACKED_SIGNALS[label]) break;
            }
        }
    }

    // Build legend
    const legendEl = document.getElementById("chart-legend");
    legendEl.innerHTML = "";
    for (const [key, sig] of Object.entries(TRACKED_SIGNALS)) {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `<span class="legend-dot" style="background:${sig.color}"></span>${key}`;
        legendEl.appendChild(item);
    }
}

// ============================================
//  Chart.js Setup
// ============================================

function initChart() {
    const ctx = document.getElementById("timeline-chart").getContext("2d");

    chart = new Chart(ctx, {
        type: "line",
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 150 },
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "rgba(20, 20, 30, 0.92)",
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
                    grid: { color: "rgba(255,255,255,0.04)", drawBorder: false },
                    ticks: {
                        color: "rgba(255,255,255,0.25)",
                        font: { family: "'SF Mono', monospace", size: 10 },
                    },
                },
            },
        },
    });

    // Build datasets from tracked signals
    rebuildChartDatasets();
}

function rebuildChartDatasets() {
    if (!chart) return;
    chart.data.datasets = Object.entries(TRACKED_SIGNALS).map(([key, sig]) => ({
        label: key,
        data: [],
        borderColor: sig.color,
        backgroundColor: sig.color + "20",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
    }));
}

// ============================================
//  Polling & UI Update
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
    const { status, data, mode: serverMode, progress } = json;
    const now = new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

    // Connection
    updateConnectionStatus(
        status === "connected" ? "connected" : "disconnected",
        status === "connected" ? "Connected" : "Disconnected"
    );

    // Mode badge
    const modeBadge = document.getElementById("mode-badge");
    const modeText = document.getElementById("mode-text");
    if (serverMode === "demo") {
        modeBadge.style.display = "flex";
        modeText.textContent = "DEMO";
        // Update progress ring
        const circle = document.getElementById("progress-circle");
        const circumference = 2 * Math.PI * 8; // r=8
        circle.setAttribute("stroke-dashoffset", circumference * (1 - (progress || 0)));
    } else {
        modeBadge.style.display = "none";
    }

    document.getElementById("timestamp").textContent = now;

    if (!data || Object.keys(data).length === 0) return;

    // Update all variables
    for (const [station, groups] of Object.entries(data)) {
        let stationHasActivity = false;

        for (const [groupName, vars] of Object.entries(groups)) {
            for (const [label, value] of Object.entries(vars)) {
                const id = makeId(station, label);

                if (station === "State") {
                    updateStateVar(id, label, value);
                } else {
                    if (updateVarItem(id, value)) stationHasActivity = true;
                }
            }
        }

        if (station !== "State") {
            updateStationStatus(station, stationHasActivity);
        }
    }

    // Color sensor
    updateColorSensor(data);

    // History & chart
    updateHistory(data, now);
}

function updateConnectionStatus(state, text) {
    const badge = document.getElementById("connection-badge");
    document.getElementById("connection-text").textContent = text;
    badge.className = `connection-badge ${state}`;
}

function updateVarItem(id, value) {
    const item = document.getElementById(`item-${id}`);
    const valEl = document.getElementById(`val-${id}`);
    if (!item || !valEl) return false;

    const isError = typeof value === "string" && value.startsWith("ERR");
    const isBool = typeof value === "boolean";
    const isActive = isBool ? value : false;

    item.className = "var-item" + (isActive ? " active" : "") + (isError ? " error" : "");

    if (isError) valEl.textContent = "ERR";
    else if (isBool) valEl.textContent = value ? "ON" : "OFF";
    else valEl.textContent = value ?? "--";

    return isActive;
}

function updateStateVar(id, label, value) {
    const valEl = document.getElementById(`val-${id}`);
    if (!valEl) return;

    if (typeof value === "boolean") {
        valEl.textContent = value ? "ACTIVE" : "OK";
        valEl.style.color = value ? "var(--red)" : "var(--green)";
    } else if (typeof value === "string" && value.length > 20) {
        valEl.textContent = "[data]";
        valEl.title = value;
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
        label.style.color = "";
    }
}

function updateColorSensor(data) {
    const fill = document.getElementById("color-bar-fill");
    const valEl = document.getElementById("color-value");
    if (!fill || !valEl) return;

    // Find color sensor value in SL sensors
    let colorVal = null;
    const slSensors = data?.SL?.sensors;
    if (slSensors) {
        for (const [label, val] of Object.entries(slSensors)) {
            if (/color.?sensor/i.test(label)) {
                colorVal = val;
                break;
            }
        }
    }
    if (colorVal == null) return;

    const numVal = typeof colorVal === "number" ? colorVal : parseInt(colorVal) || 0;
    fill.style.width = Math.min(100, (numVal / 300) * 100) + "%";

    fill.className = "color-bar-fill";
    if (numVal > 220) fill.classList.add("white");
    else if (numVal > 100) fill.classList.add("red");
    else fill.classList.add("blue");

    valEl.textContent = numVal;
}

// ============================================
//  History & Chart
// ============================================

function updateHistory(data, timestamp) {
    history.timestamps.push(timestamp);
    if (history.timestamps.length > MAX_HISTORY) history.timestamps.shift();

    for (const [key, sig] of Object.entries(TRACKED_SIGNALS)) {
        let value = data?.[sig.station]?.[sig.group]?.[sig.label];
        if (typeof value === "boolean") value = value ? 1 : 0;
        if (typeof value === "string") value = 0;
        value = value ?? 0;

        history[key].push(value);
        if (history[key].length > MAX_HISTORY) history[key].shift();
    }

    // Update chart
    chart.data.labels = [...history.timestamps];
    const keys = Object.keys(TRACKED_SIGNALS);
    keys.forEach((key, i) => {
        if (chart.data.datasets[i]) {
            chart.data.datasets[i].data = [...history[key]];
        }
    });
    chart.update("none");
}

// ============================================
//  Start
// ============================================

document.addEventListener("DOMContentLoaded", init);

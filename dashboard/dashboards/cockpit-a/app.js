/**
 * Cockpit A — FINAL Premium Andon Board
 *
 * 7-step process: HBW -> Crane -> Oven -> Color -> Sort -> Crane(back) -> Rack
 * Traffic light rings, oven burn glow, color reveal at measurement,
 * HBW rack dots (3x3), sorting bins (W/R/B x 3), production progress.
 *
 * Polls /api/data every 400ms, /api/analytics/* every 5s.
 */

// ============================================
//  Constants
// ============================================

const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};

const STEPS = [
    { id: 'HBW',    station: 'HBW',   label: 'Rack Storage' },
    { id: 'Crane1', station: 'Crane', label: 'To Oven' },
    { id: 'Oven',   station: 'MS',    label: 'Burn' },
    { id: 'Color',  station: 'SL',    label: 'Measurement' },
    { id: 'Sort',   station: 'SL',    label: 'By Color' },
    { id: 'Crane2', station: 'Crane', label: 'To Rack' },
    { id: 'Rack',   station: 'HBW',   label: 'Store' },
];

// Traffic light thresholds (seconds) — green -> orange -> red
const THRESHOLDS = {
    HBW:    { orange: 14, red: 22 },
    Crane1: { orange: 14, red: 22 },
    Oven:   { orange: 22, red: 35 },
    Color:  { orange: 8,  red: 15 },
    Sort:   { orange: 8,  red: 15 },
    Crane2: { orange: 14, red: 22 },
    Rack:   { orange: 10, red: 18 },
};

// Ring math: r=63, C=2*pi*63
const RING_C = 2 * Math.PI * 63;

// Color sensor value ranges
function colorFromSensor(val) {
    if (val >= 230 && val <= 320) return 'white';
    if (val >= 100 && val <= 210) return 'red';
    if (val >= 30 && val <= 70)   return 'blue';
    return null;
}

// ============================================
//  State
// ============================================

let lastFetch = 0;
let alertsOpen = false;
let activeStep = null;
let prevActiveStep = null;
let ovenBurning = false;
let currentColor = null;
let stepTimers = {};
let prevStationActive = {};

// Tracking
let producedPieces = [];
let rackSlots = new Array(9).fill(null);
let binCounts = { white: 0, red: 0, blue: 0 };
let lastSortKey = '';

// Prevent double-counting from analytics sync
let analyticsProducedCount = 0;

// Cycle tracking
let cycleStartTime = null;
let hadOvenThisCycle = false;
let hadSortThisCycle = false;

// ============================================
//  Init
// ============================================

function init() {
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(updateStaleness, 1000);

    // Traffic ring timer — update every 200ms for smooth fill
    setInterval(updateTrafficRings, 200);

    loadAnalytics();
    setInterval(loadAnalytics, 5000);

    // Load DB stats for footer
    loadDbStats();
    setInterval(loadDbStats, 30000);

    pollLoop();
}

// ============================================
//  Data Polling — 400ms
// ============================================

async function pollLoop() {
    try {
        const res = await fetch('/api/data');
        const json = await res.json();
        lastFetch = Date.now();
        processData(json.data || {});
        updateFooterMode(json.mode || 'live');
    } catch (e) {
        setLineState('idle');
    }
    setTimeout(pollLoop, 400);
}

// ============================================
//  Process Data
// ============================================

function processData(data) {
    // Determine active stations
    const active = {};
    for (const st of ['HBW', 'Crane', 'MS', 'SL', 'PM']) {
        active[st] = isStationActive(data[st]);
    }

    // Read specific signals
    const ovenLamp = getVal(data, 'MS', 'actuators', 'Oven Lamp (Burn)');
    const colorVal = getVal(data, 'SL', 'sensors', 'Color Sensor');
    const convSL = getVal(data, 'SL', 'actuators', 'Conveyor Belt');
    const lbBefore = getVal(data, 'SL', 'sensors', 'LB Before Color');
    const lbAfter = getVal(data, 'SL', 'sensors', 'LB After Color');
    const cylW = getVal(data, 'SL', 'actuators', 'Cylinder White');
    const cylR = getVal(data, 'SL', 'actuators', 'Cylinder Red');
    const cylB = getVal(data, 'SL', 'actuators', 'Cylinder Blue');

    // Oven burning
    const wasBurning = ovenBurning;
    ovenBurning = ovenLamp === true;
    updateOvenVisuals();

    // Color detection — only at color measurement step
    if (typeof colorVal === 'number' && colorVal > 10) {
        const detected = colorFromSensor(colorVal);
        if (detected && currentColor !== detected) {
            currentColor = detected;
            onColorDetected(detected);
        }
    }

    // Determine active step
    const newStep = determineStep(active, data, { ovenLamp, convSL, lbBefore, lbAfter, cylW, cylR, cylB });

    if (newStep !== activeStep) {
        if (activeStep) onStepLeave(activeStep);
        prevActiveStep = activeStep;
        activeStep = newStep;
        if (newStep) onStepEnter(newStep);
    }

    // Track cycle phases
    if (activeStep === 'Oven') hadOvenThisCycle = true;
    if (activeStep === 'Sort') hadSortThisCycle = true;

    // Update all step visuals
    STEPS.forEach(s => renderStep(s.id, s.id === activeStep, s.station));

    // Detect sorting
    if (cylW || cylR || cylB) {
        const sortColor = cylW ? 'white' : (cylR ? 'red' : 'blue');
        onPieceSorted(sortColor);
    }

    // Line state
    const anyActive = Object.values(active).some(v => v);
    setLineState(anyActive ? 'running' : 'idle');

    // Start cycle timer if first activity
    if (anyActive && !cycleStartTime) {
        cycleStartTime = Date.now();
    }

    // Detect cycle end: Rack step completes (was active, now idle), or all idle after sort+crane
    if (!anyActive && hadOvenThisCycle && hadSortThisCycle && cycleStartTime) {
        onCycleComplete();
    }

    prevStationActive = active;
}

function determineStep(active, data, signals) {
    const { ovenLamp, convSL, lbBefore, lbAfter, cylW, cylR, cylB } = signals;

    // Sorting cylinders active
    if (cylW || cylR || cylB) return 'Sort';

    // Color measurement: SL + conveyor + light barrier near sensor
    if (active.SL && convSL && (lbBefore || lbAfter)) return 'Color';
    if (active.SL && convSL) return 'Color';

    // Oven
    if (active.MS) return 'Oven';

    // Crane — distinguish direction
    if (active.Crane) {
        if (hadSortThisCycle || stepTimers['Sort'] || stepTimers['Color']) return 'Crane2';
        return 'Crane1';
    }

    // HBW — distinguish pickup vs store-back
    if (active.HBW) {
        if (hadSortThisCycle && currentColor) return 'Rack';
        return 'HBW';
    }

    return null;
}

// ============================================
//  Step Lifecycle
// ============================================

function onStepEnter(stepId) {
    stepTimers[stepId] = Date.now();

    // Show workpiece dot
    const wp = document.getElementById('wp-' + stepId);
    if (wp) {
        wp.classList.add('show');
        // Color known? Apply it for post-measurement steps
        if (currentColor && isPostMeasurement(stepId)) {
            wp.className = 'wp-dot show wp-' + currentColor;
        }
    }
}

function onStepLeave(stepId) {
    const wp = document.getElementById('wp-' + stepId);
    if (wp) {
        wp.classList.remove('show');
        wp.className = 'wp-dot';
    }
}

function isPostMeasurement(stepId) {
    return ['Color', 'Sort', 'Crane2', 'Rack'].includes(stepId);
}

function onColorDetected(color) {
    // Reveal color on the Color step dot
    const wpColor = document.getElementById('wp-Color');
    if (wpColor && wpColor.classList.contains('show')) {
        wpColor.className = 'wp-dot show wp-' + color;
    }
}

function onPieceSorted(color) {
    if (!color) return;
    const key = color + '-' + (binCounts.white + binCounts.red + binCounts.blue);
    if (lastSortKey === key) return;
    lastSortKey = key;

    const total = binCounts.white + binCounts.red + binCounts.blue;
    if (total >= 9) return;

    binCounts[color]++;
    renderSortBins();
}

function onCycleComplete() {
    if (currentColor) {
        producedPieces.push({ color: currentColor });
        renderProduction();

        // Update rack
        const empty = rackSlots.indexOf(null);
        if (empty >= 0) {
            rackSlots[empty] = currentColor;
            renderRack();
        }
    }

    // Reset cycle
    currentColor = null;
    stepTimers = {};
    cycleStartTime = null;
    hadOvenThisCycle = false;
    hadSortThisCycle = false;
}

// ============================================
//  Visual Rendering
// ============================================

function renderStep(stepId, isActive, station) {
    const circle = document.getElementById('circle-' + stepId);
    const card = document.getElementById('step-' + stepId);
    if (!circle || !card) return;

    if (isActive) {
        circle.className = 'step-circle lit-' + station;
        card.classList.add('active');

        // Oven burn extra class
        if (stepId === 'Oven' && ovenBurning) {
            circle.classList.add('oven-burn');
        }
    } else {
        circle.className = 'step-circle';
        card.classList.remove('active');
    }
}

function updateOvenVisuals() {
    const flames = document.getElementById('oven-flames');
    if (flames) {
        flames.classList.toggle('burning', ovenBurning);
    }

    const circle = document.getElementById('circle-Oven');
    if (circle && circle.classList.contains('lit-MS')) {
        circle.classList.toggle('oven-burn', ovenBurning);
    }
}

function updateTrafficRings() {
    const now = Date.now();

    STEPS.forEach(step => {
        const ring = document.getElementById('ring-' + step.id);
        if (!ring) return;

        const start = stepTimers[step.id];
        const isActive = step.id === activeStep;

        if (!isActive || !start) {
            ring.style.strokeDashoffset = RING_C;
            ring.classList.remove('orange', 'red');
            ring.style.stroke = '';
            return;
        }

        const elapsed = (now - start) / 1000;
        const th = THRESHOLDS[step.id] || { orange: 15, red: 25 };

        // Fill proportional to red threshold
        const progress = Math.min(elapsed / th.red, 1);
        ring.style.strokeDashoffset = RING_C * (1 - progress);

        // Color
        ring.classList.remove('orange', 'red');
        if (elapsed >= th.red) {
            ring.classList.add('red');
            ring.style.stroke = '';
        } else if (elapsed >= th.orange) {
            ring.classList.add('orange');
            ring.style.stroke = '';
        } else {
            ring.style.stroke = '';
            ring.classList.remove('orange', 'red');
        }
    });
}

function renderRack() {
    const dots = document.querySelectorAll('#rack-grid .rack-dot');
    dots.forEach((dot, i) => {
        dot.className = 'rack-dot';
        if (rackSlots[i]) {
            dot.classList.add('occupied', 'dot-' + rackSlots[i]);
        }
    });
}

function renderSortBins() {
    const colorMap = { white: 'W', red: 'R', blue: 'B' };
    for (const [color, letter] of Object.entries(colorMap)) {
        const col = document.getElementById('bin-' + letter);
        if (!col) continue;
        const slots = col.querySelectorAll('.bin-slot');
        const count = binCounts[color] || 0;
        slots.forEach((slot, i) => {
            slot.className = 'bin-slot';
            if (i < count) {
                slot.classList.add('fill-' + letter);
            }
        });
    }
}

function renderProduction() {
    const total = producedPieces.length;
    const countEl = document.getElementById('prod-count');
    const fillEl = document.getElementById('prod-fill');
    const pipsEl = document.getElementById('prod-pips');

    if (countEl) countEl.textContent = total + ' / 9';
    if (fillEl) fillEl.style.width = Math.min((total / 9) * 100, 100) + '%';

    if (pipsEl) {
        pipsEl.innerHTML = producedPieces.map(p =>
            '<div class="pip c-' + (p.color || 'white') + '"></div>'
        ).join('');
    }
}

// ============================================
//  Line State
// ============================================

function setLineState(state) {
    const andon = document.querySelector('.andon');
    const title = document.getElementById('header-title');
    if (!andon || !title) return;

    andon.classList.remove('line-running', 'line-idle', 'line-alert');

    switch (state) {
        case 'running':
            andon.classList.add('line-running');
            title.textContent = 'LINE RUNNING';
            break;
        case 'alert':
            andon.classList.add('line-alert');
            title.textContent = 'LINE ALERT';
            break;
        default:
            andon.classList.add('line-idle');
            title.textContent = 'LINE IDLE';
    }
}

// ============================================
//  Analytics — 5s
// ============================================

async function loadAnalytics() {
    try {
        const [alertsRes, cycleRes, qualityRes] = await Promise.all([
            fetch('/api/analytics/alerts'),
            fetch('/api/analytics/cycle-times'),
            fetch('/api/analytics/quality-grades'),
        ]);

        const alerts = await alertsRes.json();
        const cycles = await cycleRes.json();
        const quality = await qualityRes.json();

        renderAlerts(alerts);
        renderCycleFromAnalytics(cycles);
        syncProductionFromAnalytics(quality);
    } catch (e) {
        // Silent fail — analytics is optional
    }
}

function renderCycleFromAnalytics(data) {
    if (!data || data.length === 0) return;

    const last = data[data.length - 1];
    const lastTotal = last.total || 0;
    const totals = data.filter(d => d.total > 0).map(d => d.total);
    const avg = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;

    const valEl = document.getElementById('cycle-last');
    const avgEl = document.getElementById('cycle-avg');

    if (valEl) valEl.textContent = lastTotal.toFixed(1);
    if (avgEl) avgEl.textContent = 'avg ' + avg.toFixed(1) + 's';
}

function syncProductionFromAnalytics(quality) {
    if (!quality || quality.length === 0) return;

    // Only sync if analytics has more data than local tracking
    if (quality.length > producedPieces.length) {
        producedPieces = quality.map(q => ({
            color: q.color_name || 'unknown'
        }));
        renderProduction();

        // Rebuild bins
        binCounts = { white: 0, red: 0, blue: 0 };
        quality.forEach(q => {
            const cn = q.color_name;
            if (cn && binCounts.hasOwnProperty(cn)) binCounts[cn]++;
        });
        renderSortBins();

        // Rebuild rack
        rackSlots = new Array(9).fill(null);
        quality.forEach((q, i) => {
            if (i < 9) rackSlots[i] = q.color_name || null;
        });
        renderRack();

        analyticsProducedCount = quality.length;
    }
}

// ============================================
//  Alerts
// ============================================

function renderAlerts(alerts) {
    const data = alerts || [];
    const pill = document.getElementById('alert-pill');
    const label = document.getElementById('alert-label');
    const list = document.getElementById('alert-list');

    const errors = data.filter(a => a.severity === 'error').length;
    const total = data.length;

    pill.classList.remove('clear', 'warn', 'crit');

    if (total === 0) {
        pill.classList.add('clear');
        label.textContent = 'ALL CLEAR';
    } else if (errors > 0) {
        pill.classList.add('crit');
        label.textContent = total + ' ALERT' + (total !== 1 ? 'S' : '');
    } else {
        pill.classList.add('warn');
        label.textContent = total + ' ALERT' + (total !== 1 ? 'S' : '');
    }

    // Sort by severity, show top 3
    const order = { error: 0, warning: 1, info: 2 };
    const sorted = [...data].sort((a, b) => {
        const diff = (order[a.severity] || 3) - (order[b.severity] || 3);
        if (diff !== 0) return diff;
        return (b.run || 0) - (a.run || 0);
    });

    const top = sorted.slice(0, 3);
    list.innerHTML = top.map(a => {
        const bg = STATION_COLORS[a.station] || '#5AC8FA';
        return '<div class="alert-row severity-' + (a.severity || 'info') + '">' +
            '<span class="alert-tag" style="background:' + bg + '">' + (a.station || '--') + '</span>' +
            '<span class="alert-msg">' + (a.message || 'Unknown alert') + '</span>' +
            '</div>';
    }).join('');
}

function toggleAlerts() {
    alertsOpen = !alertsOpen;
    const drawer = document.getElementById('alert-drawer');
    const chevron = document.getElementById('alert-chevron');
    if (drawer) drawer.classList.toggle('open', alertsOpen);
    if (chevron) chevron.classList.toggle('open', alertsOpen);
}

// ============================================
//  Helpers
// ============================================

function isStationActive(stationData) {
    if (!stationData) return false;
    for (const [, vars] of Object.entries(stationData)) {
        for (const [label, value] of Object.entries(vars)) {
            if (typeof value === 'boolean' && value === true) {
                if (/motor|valve|lamp|compressor|conveyor|cylinder/i.test(label)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function getVal(data, station, group, label) {
    const sd = data[station];
    if (!sd) return null;

    // Try specified group first
    if (sd[group] && sd[group].hasOwnProperty(label)) return sd[group][label];

    // Fallback: search all groups
    for (const [, vars] of Object.entries(sd)) {
        if (vars && typeof vars === 'object' && vars.hasOwnProperty(label)) return vars[label];
    }
    return null;
}

// ============================================
//  Footer
// ============================================

function updateClock() {
    const el = document.getElementById('footer-time');
    if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function updateStaleness() {
    const el = document.getElementById('footer-updated');
    if (!el) return;
    if (lastFetch === 0) { el.textContent = '--'; return; }
    const secs = Math.round((Date.now() - lastFetch) / 1000);
    el.textContent = secs <= 1 ? 'live' : secs + 's ago';
}

function updateFooterMode(mode) {
    const el = document.getElementById('footer-mode');
    if (el) el.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
}

// ============================================
//  DB Stats (SQLite history)
// ============================================

async function loadDbStats() {
    try {
        var resp = await fetch('/api/db-stats');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var stats = await resp.json();
        if (stats.error) throw new Error(stats.error);

        var el = document.getElementById('footer-db');
        if (el) {
            var total = stats.total_events || 0;
            var runs = stats.total_runs || 0;
            if (total > 0) {
                var label = total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total;
                el.textContent = 'DB: ' + label + ' events, ' + runs + ' runs';
                el.title = 'SQLite: ' + total + ' events across ' + runs + ' runs';
            } else {
                el.textContent = 'DB: empty';
            }
        }
    } catch (_) {
        var el = document.getElementById('footer-db');
        if (el) el.textContent = 'DB: offline';
    }
}

// ============================================
//  Theme
// ============================================

function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

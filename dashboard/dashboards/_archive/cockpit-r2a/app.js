/**
 * Cockpit R2A — Andon Board, Round 2 Version A
 *
 * Correct process flow: HBW -> Crane -> Oven -> Color -> Sort -> Crane back
 * 7 process steps, traffic light rings, oven burn glow, color reveal,
 * HBW rack dots, sorting bins, production progress.
 *
 * Polls /api/data every 400ms, /api/analytics/* every 5s.
 */

// ============================================
//  Constants
// ============================================

const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};

// Process steps mapped to their station and detection logic
const STEPS = [
    { id: 'HBW',    station: 'HBW',   label: 'Rack Storage' },
    { id: 'Crane1', station: 'Crane', label: 'To Oven' },
    { id: 'Oven',   station: 'MS',    label: 'Burn' },
    { id: 'Color',  station: 'SL',    label: 'Measurement' },
    { id: 'Sort',   station: 'SL',    label: 'By Color' },
    { id: 'Crane2', station: 'Crane', label: 'To Rack' },
];

// Traffic light thresholds (seconds) — green/amber/red
const STEP_THRESHOLDS = {
    HBW:    { amber: 14, red: 22 },
    Crane1: { amber: 14, red: 22 },
    Oven:   { amber: 22, red: 35 },
    Color:  { amber: 8,  red: 15 },
    Sort:   { amber: 8,  red: 15 },
    Crane2: { amber: 14, red: 22 },
};

// Color mapping from sensor value
function colorFromSensor(val) {
    if (val >= 250 && val <= 300) return 'white';
    if (val >= 130 && val <= 190) return 'red';
    if (val >= 40 && val <= 60)   return 'blue';
    return null;
}

function gradeFromColor(name) {
    return { white: 'A', red: 'B', blue: 'C' }[name] || null;
}

// SVG ring circumference (r=56 -> 2*pi*56 = 351.86)
const RING_CIRCUMFERENCE = 2 * Math.PI * 56;

// ============================================
//  State
// ============================================

let lastFetch = 0;
let alertsOpen = false;
let prevStationActive = {};
let stepTimers = {};        // { stepId: startTimestamp }
let activeStep = null;      // currently active step id
let ovenBurning = false;
let currentColor = null;    // detected color name (null until measured)
let colorSensorValue = 0;

// Track production
let producedPieces = [];    // array of { color, grade }
let rackSlots = new Array(9).fill(null);  // null or color name
let binCounts = { white: 0, red: 0, blue: 0 };

// Analytics cache
let cycleData = [];
let alertData = [];

// ============================================
//  Init
// ============================================

function init() {
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(updateStaleness, 1000);

    loadAnalytics();
    setInterval(loadAnalytics, 5000);

    pollLoop();
}

// ============================================
//  Data Polling — 400ms
// ============================================

async function pollLoop() {
    await pollOnce();
    setTimeout(pollLoop, 400);
}

async function pollOnce() {
    try {
        const res = await fetch('/api/data');
        const json = await res.json();
        lastFetch = Date.now();

        const data = json.data || {};
        processData(data);
        updateFooterMode(json.mode || 'demo');
    } catch (e) {
        STEPS.forEach(s => setStepState(s.id, false));
        setBannerState('idle');
    }
}

// ============================================
//  Process Data — detect active stations + steps
// ============================================

function processData(data) {
    // Determine which stations are active
    const stationActive = {};
    for (const station of ['HBW', 'Crane', 'MS', 'SL', 'PM']) {
        stationActive[station] = isStationActive(data[station]);
    }

    // Detect specific sub-states
    const ovenLamp = getActuatorValue(data, 'MS', 'Oven Lamp (Burn)');
    const colorVal = getSensorValue(data, 'SL', 'Color Sensor');
    const conveyorSL = getActuatorValue(data, 'SL', 'Conveyor Belt');
    const cylinderWhite = getActuatorValue(data, 'SL', 'Cylinder White');
    const cylinderRed = getActuatorValue(data, 'SL', 'Cylinder Red');
    const cylinderBlue = getActuatorValue(data, 'SL', 'Cylinder Blue');
    const lbBeforeColor = getSensorValue(data, 'SL', 'LB Before Color');
    const lbAfterColor = getSensorValue(data, 'SL', 'LB After Color');

    // Update oven burning state
    const wasBurning = ovenBurning;
    ovenBurning = ovenLamp === true;
    updateOvenVisual();

    // Detect color sensor reading
    if (typeof colorVal === 'number' && colorVal > 10) {
        const detected = colorFromSensor(colorVal);
        if (detected && currentColor !== detected) {
            currentColor = detected;
            colorSensorValue = colorVal;
            onColorDetected(detected);
        }
    }

    // Determine active process step
    const newStep = determineActiveStep(stationActive, data);
    if (newStep !== activeStep) {
        if (activeStep) onStepEnd(activeStep);
        activeStep = newStep;
        if (newStep) onStepStart(newStep);
    }

    // Update step visuals
    STEPS.forEach(step => {
        const isActive = step.id === activeStep;
        setStepState(step.id, isActive, step.station);
    });

    // Update traffic light rings for active step
    updateTrafficRings();

    // Update banner
    const anyActive = Object.values(stationActive).some(v => v);
    setBannerState(anyActive ? 'running' : 'idle');

    // Detect sorting events
    if (cylinderWhite === true || cylinderRed === true || cylinderBlue === true) {
        let sortColor = null;
        if (cylinderWhite) sortColor = 'white';
        else if (cylinderRed) sortColor = 'red';
        else if (cylinderBlue) sortColor = 'blue';
        onPieceSorted(sortColor);
    }

    prevStationActive = stationActive;
}

function determineActiveStep(stationActive, data) {
    // Priority-based step detection following the process flow
    // Check in reverse order (latest step wins if multiple are active)

    const hbwActive = stationActive.HBW;
    const craneActive = stationActive.Crane;
    const msActive = stationActive.MS;
    const slActive = stationActive.SL;

    const ovenLamp = getActuatorValue(data, 'MS', 'Oven Lamp (Burn)');
    const convSL = getActuatorValue(data, 'SL', 'Conveyor Belt');
    const lbBeforeColor = getSensorValue(data, 'SL', 'LB Before Color');
    const lbAfterColor = getSensorValue(data, 'SL', 'LB After Color');
    const cylWhite = getActuatorValue(data, 'SL', 'Cylinder White');
    const cylRed = getActuatorValue(data, 'SL', 'Cylinder Red');
    const cylBlue = getActuatorValue(data, 'SL', 'Cylinder Blue');

    // Sorting — any cylinder active
    if (cylWhite || cylRed || cylBlue) return 'Sort';

    // Color — SL conveyor active and light barrier triggered near color sensor
    if (slActive && convSL && (lbBeforeColor || lbAfterColor)) return 'Color';

    // SL active without specific sorting/color → could be either color or sort
    if (slActive && convSL) return 'Color';

    // Oven — MS active with oven lamp or oven-related actuators
    if (msActive) return 'Oven';

    // Crane — need to distinguish Crane1 (to oven) vs Crane2 (back to rack)
    if (craneActive) {
        // If we already had oven/color/sort steps in this cycle, crane is going back
        if (producedPieces.length > 0 || currentColor !== null) {
            // Check if SL has already run in this cycle
            if (stepTimers['Sort'] || stepTimers['Color']) return 'Crane2';
        }
        // Default: crane to oven
        return 'Crane1';
    }

    // HBW
    if (hbwActive) return 'HBW';

    return null;
}

// ============================================
//  Step lifecycle
// ============================================

function onStepStart(stepId) {
    stepTimers[stepId] = Date.now();

    // Show workpiece dot at new step
    const wpEl = document.getElementById('wp-' + stepId);
    if (wpEl) {
        wpEl.classList.add('visible', 'entering');
        // Apply current color class if known
        if (currentColor && ['Color', 'Sort', 'Crane2'].includes(stepId)) {
            wpEl.className = 'workpiece-dot visible entering wp-' + currentColor;
        }
        setTimeout(() => wpEl.classList.remove('entering'), 400);
    }
}

function onStepEnd(stepId) {
    // Hide workpiece dot at old step
    const wpEl = document.getElementById('wp-' + stepId);
    if (wpEl) {
        wpEl.classList.remove('visible', 'entering');
        wpEl.className = 'workpiece-dot';
    }

    // Reset timer (keep for this cycle for detection logic)
}

function onColorDetected(color) {
    // Make the color-reveal dot show with the detected color
    const wpColor = document.getElementById('wp-Color');
    if (wpColor) {
        wpColor.className = 'workpiece-dot visible wp-' + color;
    }

    // Also update Sort and Crane2 dots if they become active later
    const wpSort = document.getElementById('wp-Sort');
    if (wpSort && wpSort.classList.contains('visible')) {
        wpSort.className = 'workpiece-dot visible wp-' + color;
    }
}

function onPieceSorted(color) {
    if (!color) return;

    // Avoid double-counting in same poll cycle
    const key = 'lastSort';
    if (window[key] === color + '-' + producedPieces.length) return;
    window[key] = color + '-' + producedPieces.length;

    // Only count if we haven't exceeded 9
    const totalInBins = binCounts.white + binCounts.red + binCounts.blue;
    if (totalInBins >= 9) return;

    binCounts[color]++;
    updateSortBins();
}

function onCycleComplete() {
    if (currentColor) {
        const grade = gradeFromColor(currentColor);
        producedPieces.push({ color: currentColor, grade: grade });
        updateProductionProgress();

        // Add to rack
        const emptySlot = rackSlots.indexOf(null);
        if (emptySlot >= 0) {
            rackSlots[emptySlot] = currentColor;
            updateRackGrid();
        }
    }

    // Reset cycle state
    currentColor = null;
    colorSensorValue = 0;
    stepTimers = {};
}

// ============================================
//  Visual Updates
// ============================================

function setStepState(stepId, active, station) {
    const circle = document.getElementById('circle-' + stepId);
    const card = document.getElementById('step-' + stepId);
    if (!circle || !card) return;

    if (active) {
        // Map step to correct station color class
        let stationKey = station;
        if (!stationKey) {
            const stepDef = STEPS.find(s => s.id === stepId);
            stationKey = stepDef ? stepDef.station : 'MS';
        }
        circle.className = 'step-circle active-' + stationKey;
        card.classList.add('active');

        // Oven burning gets extra class
        if (stepId === 'Oven' && ovenBurning) {
            circle.classList.add('oven-burning');
        }
    } else {
        circle.className = 'step-circle idle';
        card.classList.remove('active');
    }
}

function updateOvenVisual() {
    const icon = document.getElementById('oven-icon');
    if (icon) {
        icon.classList.toggle('burning', ovenBurning);
    }

    const circle = document.getElementById('circle-Oven');
    if (circle && !circle.classList.contains('idle')) {
        circle.classList.toggle('oven-burning', ovenBurning);
    }
}

function updateTrafficRings() {
    const now = Date.now();

    STEPS.forEach(step => {
        const ringEl = document.getElementById('ring-' + step.id);
        if (!ringEl) return;

        const startTime = stepTimers[step.id];
        const isActive = step.id === activeStep;

        if (!isActive || !startTime) {
            // Reset ring
            ringEl.style.strokeDashoffset = RING_CIRCUMFERENCE;
            ringEl.classList.remove('amber', 'red');
            ringEl.style.stroke = '';
            return;
        }

        const elapsed = (now - startTime) / 1000;
        const thresholds = STEP_THRESHOLDS[step.id] || { amber: 15, red: 25 };

        // Fill the ring proportionally (full circle = red threshold)
        const progress = Math.min(elapsed / thresholds.red, 1);
        const offset = RING_CIRCUMFERENCE * (1 - progress);
        ringEl.style.strokeDashoffset = offset;

        // Color based on thresholds
        ringEl.classList.remove('amber', 'red');
        if (elapsed >= thresholds.red) {
            ringEl.classList.add('red');
            ringEl.style.stroke = '';
        } else if (elapsed >= thresholds.amber) {
            ringEl.classList.add('amber');
            ringEl.style.stroke = '';
        } else {
            ringEl.style.stroke = 'var(--c-green)';
        }
    });
}

function updateRackGrid() {
    const dots = document.querySelectorAll('#rack-grid .rack-dot');
    dots.forEach((dot, i) => {
        dot.classList.remove('occupied', 'dot-white', 'dot-red', 'dot-blue');
        if (rackSlots[i]) {
            dot.classList.add('occupied', 'dot-' + rackSlots[i]);
        }
    });
}

function updateSortBins() {
    ['white', 'red', 'blue'].forEach(color => {
        const col = document.getElementById('bin-' + color);
        if (!col) return;
        const slots = col.querySelectorAll('.bin-slot');
        const count = binCounts[color] || 0;
        slots.forEach((slot, i) => {
            slot.classList.remove('filled-white', 'filled-red', 'filled-blue');
            if (i < count) {
                slot.classList.add('filled-' + color);
            }
        });
    });
}

function updateProductionProgress() {
    const total = producedPieces.length;
    const countEl = document.getElementById('prod-count');
    const fillEl = document.getElementById('prod-fill');
    const gradesEl = document.getElementById('prod-grades');

    if (countEl) countEl.textContent = total + ' / 9';
    if (fillEl) fillEl.style.width = Math.min((total / 9) * 100, 100) + '%';

    if (gradesEl) {
        gradesEl.innerHTML = producedPieces.map(p => {
            const gradeClass = p.grade ? 'grade-' + p.grade : '';
            return '<div class="grade-pip ' + gradeClass + '"></div>';
        }).join('');
    }
}

// ============================================
//  Analytics — 5s polling
// ============================================

async function loadAnalytics() {
    try {
        const [alertsRes, cycleRes, qualityRes, throughputRes] = await Promise.all([
            fetch('/api/analytics/alerts'),
            fetch('/api/analytics/cycle-times'),
            fetch('/api/analytics/quality-grades'),
            fetch('/api/analytics/throughput'),
        ]);

        const alerts = await alertsRes.json();
        cycleData = await cycleRes.json();
        const quality = await qualityRes.json();
        const throughput = await throughputRes.json();

        renderAlerts(alerts);
        renderCycleTime(cycleData);
        renderProductionFromAnalytics(quality, throughput);
    } catch (e) {
        console.error('Analytics load failed:', e);
    }
}

function renderCycleTime(data) {
    if (!data || data.length === 0) return;

    const last = data[data.length - 1];
    const lastTotal = last.total || 0;

    // Average
    const totals = data.filter(d => d.total).map(d => d.total);
    const avg = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;

    const valEl = document.getElementById('cycle-value');
    const avgEl = document.getElementById('cycle-avg');

    if (valEl) valEl.textContent = lastTotal.toFixed(1) + 's';
    if (avgEl) avgEl.textContent = 'avg ' + avg.toFixed(1) + 's';
}

function renderProductionFromAnalytics(quality, throughput) {
    if (!quality || quality.length === 0) return;

    // Rebuild produced pieces from analytics if our local tracking is behind
    if (quality.length > producedPieces.length) {
        producedPieces = quality.map(q => ({
            color: q.color_name || 'unknown',
            grade: q.grade || null,
        }));
        updateProductionProgress();

        // Rebuild bin counts
        binCounts = { white: 0, red: 0, blue: 0 };
        quality.forEach(q => {
            const cn = q.color_name;
            if (cn && binCounts.hasOwnProperty(cn)) {
                binCounts[cn]++;
            }
        });
        updateSortBins();

        // Rebuild rack
        rackSlots = new Array(9).fill(null);
        quality.forEach((q, i) => {
            if (i < 9) rackSlots[i] = q.color_name || null;
        });
        updateRackGrid();
    }
}

// ============================================
//  Alerts
// ============================================

function renderAlerts(alerts) {
    alertData = alerts || [];
    const badge = document.getElementById('alert-badge');
    const textEl = document.getElementById('alert-text');
    const list = document.getElementById('alert-list');

    const errorCount = alertData.filter(a => a.severity === 'error').length;
    const totalCount = alertData.length;

    badge.classList.remove('has-alerts', 'has-errors', 'all-clear');

    if (totalCount === 0) {
        badge.classList.add('all-clear');
        textEl.textContent = 'NO ALERTS';
    } else if (errorCount > 0) {
        badge.classList.add('has-errors');
        textEl.textContent = totalCount + ' ALERT' + (totalCount !== 1 ? 'S' : '');
    } else {
        badge.classList.add('has-alerts');
        textEl.textContent = totalCount + ' ALERT' + (totalCount !== 1 ? 'S' : '');
    }

    // Build top 5 alerts
    const severityOrder = { error: 0, warning: 1, info: 2 };
    const sorted = [...alertData].sort((a, b) => {
        const sA = severityOrder[a.severity] || 3;
        const sB = severityOrder[b.severity] || 3;
        if (sA !== sB) return sA - sB;
        return (b.run || 0) - (a.run || 0);
    });

    const top5 = sorted.slice(0, 5);
    list.innerHTML = top5.map(a => {
        const bgColor = STATION_COLORS[a.station] || '#5AC8FA';
        return '<div class="alert-item ' + (a.severity || 'info') + '">' +
            '<span class="alert-station-tag" style="background:' + bgColor + '">' +
            (a.station || '--') + '</span>' +
            '<span class="alert-message">' + (a.message || 'Unknown') + '</span>' +
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
//  Banner
// ============================================

function setBannerState(state) {
    const banner = document.getElementById('health-banner');
    const text = document.getElementById('health-text');
    if (!banner || !text) return;

    banner.classList.remove('running', 'idle', 'alert');
    banner.classList.add(state);

    switch (state) {
        case 'running': text.textContent = 'LINE RUNNING'; break;
        case 'idle':    text.textContent = 'LINE IDLE'; break;
        case 'alert':   text.textContent = 'LINE ALERT'; break;
        default:        text.textContent = 'CONNECTING';
    }
}

// ============================================
//  Helpers — read specific values from data
// ============================================

function isStationActive(stationData) {
    if (!stationData) return false;
    for (const [, vars] of Object.entries(stationData)) {
        for (const [label, value] of Object.entries(vars)) {
            if (typeof value === 'boolean' && value === true) {
                if (/motor|valve|lamp|compressor/i.test(label)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function getActuatorValue(data, station, label) {
    const sd = data[station];
    if (!sd) return null;
    const actuators = sd.actuators || {};
    if (actuators.hasOwnProperty(label)) return actuators[label];
    // Fallback: search all groups
    for (const [, vars] of Object.entries(sd)) {
        if (vars && vars.hasOwnProperty(label)) return vars[label];
    }
    return null;
}

function getSensorValue(data, station, label) {
    const sd = data[station];
    if (!sd) return null;
    const sensors = sd.sensors || {};
    if (sensors.hasOwnProperty(label)) return sensors[label];
    for (const [, vars] of Object.entries(sd)) {
        if (vars && vars.hasOwnProperty(label)) return vars[label];
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
    el.textContent = secs + 's ago';
}

function updateFooterMode(mode) {
    const el = document.getElementById('footer-mode');
    if (el) el.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

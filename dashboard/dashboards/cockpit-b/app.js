/**
 * Cockpit B — Compact Horizontal Pipeline
 *
 * 6-node pipeline: HBW -> Crane1 -> Oven -> Color -> Sort -> Crane2
 * Traffic light rings, oven burn glow, color reveal at SL measurement,
 * HBW rack dots (3x3), sorting bins (W/R/B x 3), production pips.
 *
 * Polls /api/data every 400ms, /api/analytics/summary + alerts every 5s.
 */

// ============================================
//  Constants
// ============================================

const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};

const STEPS = [
    { id: 'HBW',    station: 'HBW',   desc: 'Storage' },
    { id: 'Crane1', station: 'Crane', desc: 'To Oven' },
    { id: 'Oven',   station: 'MS',    desc: 'Burn' },
    { id: 'Color',  station: 'SL',    desc: 'Measure' },
    { id: 'Sort',   station: 'SL',    desc: 'Classify' },
    { id: 'Crane2', station: 'Crane', desc: 'To Rack' },
];

// Traffic light thresholds (seconds) — green -> amber -> red
const THRESHOLDS = {
    HBW:    { amber: 14, red: 22 },
    Crane1: { amber: 14, red: 22 },
    Oven:   { amber: 22, red: 35 },
    Color:  { amber: 8,  red: 15 },
    Sort:   { amber: 8,  red: 15 },
    Crane2: { amber: 14, red: 22 },
};

// SVG ring math: r=46, C=2*pi*46
const RING_C = 2 * Math.PI * 46;

// Color sensor value ranges
function colorFromSensor(val) {
    if (val >= 250 && val <= 300) return 'white';
    if (val >= 130 && val <= 190) return 'red';
    if (val >= 40 && val <= 60)   return 'blue';
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
        updateFooterMode(json.mode || 'demo');
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

    // Update connector lines (flowing when adjacent steps are active)
    updatePipeLines();

    // Detect sorting
    if (cylW || cylR || cylB) {
        const sortColor = cylW ? 'white' : (cylR ? 'red' : 'blue');
        onPieceSorted(sortColor);
    }

    // Line state
    const anyActive = Object.values(active).some(v => v);
    setLineState(anyActive ? 'running' : 'idle');

    // Update active step name display
    updateActiveStepName();

    // Start cycle timer if first activity
    if (anyActive && !cycleStartTime) {
        cycleStartTime = Date.now();
    }

    // Detect cycle end: all idle after oven + sort phases complete
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

    // HBW
    if (active.HBW) {
        return 'HBW';
    }

    return null;
}

// ============================================
//  Step Lifecycle
// ============================================

function onStepEnter(stepId) {
    stepTimers[stepId] = Date.now();

    // Show workpiece dot with pop animation
    const wp = document.getElementById('wp-' + stepId);
    if (wp) {
        wp.classList.add('visible', 'entering');
        // Remove entering class after animation completes
        setTimeout(() => wp.classList.remove('entering'), 400);

        // Apply color for post-measurement steps
        if (currentColor && isPostMeasurement(stepId)) {
            applyWpColor(wp, currentColor);
        }
    }

    // Update description
    const desc = document.getElementById('desc-' + stepId);
    if (desc) {
        const step = STEPS.find(s => s.id === stepId);
        if (step) desc.textContent = step.desc;
    }
}

function onStepLeave(stepId) {
    const wp = document.getElementById('wp-' + stepId);
    if (wp) {
        wp.classList.remove('visible', 'entering');
        wp.className = 'wp-dot';
        // Re-add color-reveal class for color step
        if (stepId === 'Color') wp.classList.add('color-reveal');
    }
}

function isPostMeasurement(stepId) {
    return ['Color', 'Sort', 'Crane2'].includes(stepId);
}

function applyWpColor(el, color) {
    el.classList.remove('wp-white', 'wp-red', 'wp-blue');
    el.classList.add('wp-' + color);
}

function onColorDetected(color) {
    // Reveal color on the Color step dot
    const wpColor = document.getElementById('wp-Color');
    if (wpColor && wpColor.classList.contains('visible')) {
        applyWpColor(wpColor, color);
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
    const node = document.getElementById('node-' + stepId);
    if (!circle) return;

    if (isActive) {
        // Map station to the CSS active class
        const activeClass = 'active-' + stationToCssKey(station);
        circle.className = 'node-circle ' + activeClass;

        // Oven burn extra class
        if (stepId === 'Oven' && ovenBurning) {
            circle.classList.add('oven-burning');
        }

        if (node) node.classList.add('active');
    } else {
        circle.className = 'node-circle idle';
        if (node) node.classList.remove('active');
    }
}

function stationToCssKey(station) {
    // CSS classes: active-HBW, active-Crane, active-MS, active-SL
    switch (station) {
        case 'HBW':   return 'HBW';
        case 'Crane':  return 'Crane';
        case 'MS':     return 'MS';
        case 'SL':     return 'SL';
        case 'PM':     return 'PM';
        default:       return 'MS';
    }
}

function updateOvenVisuals() {
    const flames = document.getElementById('oven-flames');
    if (flames) {
        flames.classList.toggle('burning', ovenBurning);
    }

    const circle = document.getElementById('circle-Oven');
    if (circle && !circle.classList.contains('idle')) {
        circle.classList.toggle('oven-burning', ovenBurning);
    }

    // Oven wrap glow
    const wrap = document.getElementById('oven-wrap');
    if (wrap) {
        wrap.classList.toggle('burning', ovenBurning);
    }
}

function updateTrafficRings() {
    const now = Date.now();

    STEPS.forEach(step => {
        const ring = document.getElementById('tl-' + step.id);
        if (!ring) return;

        const start = stepTimers[step.id];
        const isActive = step.id === activeStep;

        if (!isActive || !start) {
            ring.style.strokeDashoffset = RING_C;
            ring.classList.remove('amber', 'red');
            return;
        }

        const elapsed = (now - start) / 1000;
        const th = THRESHOLDS[step.id] || { amber: 15, red: 25 };

        // Fill proportional to red threshold
        const progress = Math.min(elapsed / th.red, 1);
        ring.style.strokeDashoffset = RING_C * (1 - progress);

        // Color transitions
        ring.classList.remove('amber', 'red');
        if (elapsed >= th.red) {
            ring.classList.add('red');
        } else if (elapsed >= th.amber) {
            ring.classList.add('amber');
        }
    });
}

function updatePipeLines() {
    // Lines connect adjacent steps; light up when workpiece flows between them
    const stepIds = STEPS.map(s => s.id);
    const activeIdx = activeStep ? stepIds.indexOf(activeStep) : -1;

    for (let i = 0; i < 5; i++) {
        const line = document.getElementById('line-' + i);
        if (!line) continue;

        // Flow the connector when the step to its right is active
        // (workpiece is arriving at that step)
        const flowing = (activeIdx === i + 1) || (activeIdx === i);
        line.classList.toggle('flowing', flowing && activeStep !== null);
    }
}

function updateActiveStepName() {
    const el = document.getElementById('active-step-name');
    if (!el) return;

    if (!activeStep) {
        el.textContent = 'Idle';
        el.style.color = '';
        return;
    }

    const step = STEPS.find(s => s.id === activeStep);
    if (step) {
        const names = {
            'HBW': 'HBW Pickup',
            'Crane1': 'Crane -> Oven',
            'Oven': 'Oven Burn',
            'Color': 'Color Read',
            'Sort': 'Sorting',
            'Crane2': 'Crane -> Rack'
        };
        el.textContent = names[activeStep] || activeStep;
        el.style.color = STATION_COLORS[step.station] || '';
    }
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
    const bins = {
        white: document.getElementById('bin-white'),
        red: document.getElementById('bin-red'),
        blue: document.getElementById('bin-blue'),
    };

    for (const [color, colEl] of Object.entries(bins)) {
        if (!colEl) continue;
        const slots = colEl.querySelectorAll('.bin-slot');
        const count = binCounts[color] || 0;
        // bin-col uses column-reverse, so fill from first child (bottom visually)
        slots.forEach((slot, i) => {
            slot.className = 'bin-slot';
            if (i < count) {
                slot.classList.add('filled-' + color);
            }
        });
    }
}

function renderProduction() {
    const total = producedPieces.length;
    const countEl = document.getElementById('produced-count');
    const pipsEl = document.getElementById('produced-pips');

    if (countEl) countEl.textContent = total + '/9';

    if (pipsEl) {
        const pips = pipsEl.querySelectorAll('.pip');
        pips.forEach((pip, i) => {
            pip.className = 'pip';
            if (i < producedPieces.length) {
                const color = producedPieces[i].color || 'white';
                pip.classList.add('filled-' + color);
            }
        });
    }
}

// ============================================
//  Line State (status beacon)
// ============================================

function setLineState(state) {
    const beacon = document.getElementById('status-beacon');
    const label = document.getElementById('status-label');
    if (!beacon || !label) return;

    beacon.classList.remove('running', 'idle', 'alert');

    switch (state) {
        case 'running':
            beacon.classList.add('running');
            label.textContent = 'RUNNING';
            break;
        case 'alert':
            beacon.classList.add('alert');
            label.textContent = 'ALERT';
            break;
        default:
            beacon.classList.add('idle');
            label.textContent = 'IDLE';
    }
}

// ============================================
//  Analytics — 5s polling
// ============================================

async function loadAnalytics() {
    try {
        const [summaryRes, alertsRes] = await Promise.all([
            fetch('/api/analytics/summary'),
            fetch('/api/analytics/alerts'),
        ]);

        const summary = await summaryRes.json();
        const alerts = await alertsRes.json();

        renderSummary(summary);
        renderAlerts(alerts);
        syncProductionFromSummary(summary);
    } catch (e) {
        // Silent fail — analytics is optional
    }
}

function renderSummary(summary) {
    if (!summary) return;

    // Cycle times from throughput data
    const tp = summary.throughput;
    if (tp) {
        const lastEl = document.getElementById('cycle-last');
        const avgEl = document.getElementById('cycle-avg');

        // Try to compute from cumulative data
        if (tp.total_runs > 0 && tp.total_time_min > 0) {
            const avgCycle = (tp.total_time_min * 60) / tp.total_runs;
            if (avgEl) avgEl.textContent = avgCycle.toFixed(1) + 's';
        }

        // Use throughput rate as a proxy for last cycle estimate
        if (tp.per_hour > 0) {
            const estCycle = 3600 / tp.per_hour;
            if (lastEl) lastEl.textContent = estCycle.toFixed(1) + 's';
        }
    }
}

function syncProductionFromSummary(summary) {
    if (!summary || !summary.quality) return;

    const total = summary.quality.total_produced || 0;
    const dist = summary.quality.grade_distribution || {};

    // Only sync if analytics has more data than local tracking
    if (total > producedPieces.length) {
        // Rebuild produced list from grade distribution
        // We don't have per-piece color from summary, so keep existing if possible
        // Fetch quality-grades for accurate colors
        fetchQualityGrades();
    }
}

async function fetchQualityGrades() {
    try {
        const res = await fetch('/api/analytics/quality-grades');
        const grades = await res.json();
        if (!grades || grades.length <= producedPieces.length) return;

        producedPieces = grades.map(q => ({
            color: q.color_name || 'unknown'
        }));
        renderProduction();

        // Rebuild bins
        binCounts = { white: 0, red: 0, blue: 0 };
        grades.forEach(q => {
            const cn = q.color_name;
            if (cn && binCounts.hasOwnProperty(cn)) binCounts[cn]++;
        });
        renderSortBins();

        // Rebuild rack
        rackSlots = new Array(9).fill(null);
        grades.forEach((q, i) => {
            if (i < 9) rackSlots[i] = q.color_name || null;
        });
        renderRack();
    } catch (e) {
        // Silent
    }
}

// ============================================
//  Alerts
// ============================================

function renderAlerts(alerts) {
    const data = Array.isArray(alerts) ? alerts : [];
    const toggleBtn = document.getElementById('alert-toggle');
    const indicator = document.getElementById('alert-indicator');
    const countEl = document.getElementById('alert-count');
    const listEl = document.getElementById('alert-list');

    const errors = data.filter(a => a.severity === 'error').length;
    const warnings = data.filter(a => a.severity === 'warning').length;
    const total = data.length;

    // Update toggle button class
    if (toggleBtn) {
        toggleBtn.classList.remove('has-errors', 'has-alerts', 'all-clear');
        if (errors > 0) {
            toggleBtn.classList.add('has-errors');
        } else if (warnings > 0) {
            toggleBtn.classList.add('has-alerts');
        } else {
            toggleBtn.classList.add('all-clear');
        }
    }

    // Count label
    if (countEl) {
        if (total === 0) {
            countEl.textContent = 'OK';
        } else {
            countEl.textContent = total + ' Alert' + (total !== 1 ? 's' : '');
        }
    }

    // Status beacon: if errors, show alert state
    if (errors > 0) {
        setLineState('alert');
    }

    // Sort by severity, show top 4
    const order = { error: 0, warning: 1, info: 2 };
    const sorted = [...data].sort((a, b) => {
        const diff = (order[a.severity] || 3) - (order[b.severity] || 3);
        if (diff !== 0) return diff;
        return (b.run || 0) - (a.run || 0);
    });

    const top = sorted.slice(0, 4);

    if (listEl) {
        listEl.innerHTML = top.map(a => {
            const sevClass = a.severity || 'info';
            const bg = STATION_COLORS[a.station] || '#5AC8FA';
            return '<div class="alert-item ' + sevClass + '">' +
                '<span class="alert-station-tag" style="background:' + bg + '">' +
                (a.station || '--') + '</span>' +
                '<span class="alert-message">' +
                (a.message || 'Unknown alert') + '</span>' +
                '</div>';
        }).join('');
    }
}

function toggleAlerts() {
    alertsOpen = !alertsOpen;
    const feed = document.getElementById('alert-feed');
    const chevron = document.getElementById('alert-chevron');
    if (feed) feed.classList.toggle('open', alertsOpen);
    if (chevron) chevron.classList.toggle('open', alertsOpen);
}

// ============================================
//  Helpers
// ============================================

function isStationActive(stationData) {
    if (!stationData) return false;
    for (const [, vars] of Object.entries(stationData)) {
        if (!vars || typeof vars !== 'object') continue;
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
    const el = document.getElementById('ft-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function updateStaleness() {
    const el = document.getElementById('ft-updated');
    if (!el) return;
    if (lastFetch === 0) { el.textContent = '--'; return; }
    const secs = Math.round((Date.now() - lastFetch) / 1000);
    el.textContent = secs <= 1 ? 'live' : secs + 's ago';
}

function updateFooterMode(mode) {
    const el = document.getElementById('ft-mode');
    if (el) el.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
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

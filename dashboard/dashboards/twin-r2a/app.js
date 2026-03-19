/* ============================================
   Digital Twin R2A — Minimal Animated Tracker
   One workpiece. Eight steps. That's it.

   Process: HBW -> Crane -> Oven -> Out ->
            Color -> Sort -> Crane Return -> Rack
   ============================================ */

const POLL_MS = 400;
const LERP = 0.09;

// ============================================================
//  PROCESS STEPS (maps to SVG stations)
//  Each step has a center position for the workpiece dot
// ============================================================

const STEPS = [
    { id: 'hbw',    label: 'HBW',     cx: 104, cy: 210, station: 'HBW',   color: '#AF52DE' },
    { id: 'crane',  label: 'Crane',   cx: 390, cy: 205, station: 'Crane', color: '#30D158' },
    { id: 'oven',   label: 'Oven',    cx: 524, cy: 85,  station: 'MS',    color: '#007AFF' },
    { id: 'out',    label: 'Out',     cx: 674, cy: 85,  station: 'MS',    color: '#007AFF' },
    { id: 'color',  label: 'Color',   cx: 760, cy: 210, station: 'SL',    color: '#5AC8FA' },
    { id: 'sort',   label: 'Sort',    cx: 674, cy: 345, station: 'SL',    color: '#FF9F0A' },
    { id: 'return', label: 'Return',  cx: 390, cy: 315, station: 'Crane', color: '#30D158' },
    { id: 'rack',   label: 'Rack',    cx: 104, cy: 280, station: 'HBW',   color: '#AF52DE' },
];

// Theoretical times per logical step (seconds)
const EXPECTED_TIMES = {
    hbw: 12, crane: 12, oven: 18, out: 3, color: 4, sort: 4, return: 8, rack: 5,
};

// Connection path IDs between consecutive steps
const CONN_IDS = ['conn-1', 'conn-2', 'conn-3', 'conn-4', 'conn-5', 'conn-6', 'conn-7'];

// ============================================================
//  ACTION MAP — human-readable PLC actions
// ============================================================

const ACTION_MAP = {
    HBW: [
        { keys: ['Motor Conveyor Belt Forward'],                  text: 'Conveyor fwd' },
        { keys: ['Motor Stacker Crane \u2192 Rack'],             text: 'Stacker -> rack' },
        { keys: ['Motor Stacker Crane \u2192 Conv Belt'],        text: 'Stacker -> belt' },
        { keys: ['Motor Stacker Crane Upward'],                  text: 'Stacker up' },
        { keys: ['Motor Stacker Crane Downward'],                text: 'Stacker down' },
        { keys: ['Motor Cantilever Forward'],                    text: 'Cantilever out' },
        { keys: ['Motor Cantilever Backward'],                   text: 'Cantilever in' },
    ],
    Crane: [
        { keys: ['Motor Clockwise'],           text: 'Rotate CW' },
        { keys: ['Motor Counterclockwise'],    text: 'Rotate CCW' },
        { keys: ['Motor Forward'],             text: 'Arm fwd' },
        { keys: ['Motor Backward'],            text: 'Arm back' },
        { keys: ['Motor Upward'],              text: 'Lift up' },
        { keys: ['Motor Downward'],            text: 'Lower down' },
        { keys: ['Valve'],                     text: 'Vacuum grip' },
    ],
    MS: [
        { keys: ['Motor Conveyor Belt Forward'],               text: 'Conveyor fwd' },
        { keys: ['Motor Turntable Clockwise'],                 text: 'Turntable CW' },
        { keys: ['Motor Turntable Counterclockwise'],          text: 'Turntable CCW' },
        { keys: ['Motor Transfer Unit \u2192 Oven'],           text: 'Transfer -> oven' },
        { keys: ['Motor Transfer Unit \u2192 Turntable'],      text: 'Transfer -> TT' },
        { keys: ['Motor Oven Slider Move In'],                 text: 'Slider in' },
        { keys: ['Motor Oven Slider Move Out'],                text: 'Slider out' },
        { keys: ['Valve Ovendoor'],                            text: 'Oven door' },
        { keys: ['Lamp'],                                      text: 'Burning' },
        { keys: ['Motor Saw'],                                 text: 'Saw cutting' },
        { keys: ['Valve Ejector'],                             text: 'Ejecting' },
    ],
    SL: [
        { keys: ['Motor Conveyor Belt'],  text: 'Conveyor fwd' },
        { keys: ['Valve White'],          text: 'Sort -> W' },
        { keys: ['Valve Red'],            text: 'Sort -> R' },
        { keys: ['Valve Blue'],           text: 'Sort -> B' },
    ],
};

// ============================================================
//  STATE
// ============================================================

let latestData = null;
let lastFetchTime = 0;
let activeStep = -1;          // index into STEPS
let prevActiveStep = -1;
let wpPos = { x: 0, y: 0 };
let wpTarget = { x: 0, y: 0 };
let wpVisible = false;
let wpColor = '#666';
let colorDetected = null;
let ovenBurning = false;

// Timers per logical step
let stepTimers = {};          // { stepId: { start, elapsed } }
let lastStepTimes = {};       // { stepId: lastCompletedTime }
let avgStepTimes = {};        // { stepId: [times] }
let lastTotalCycle = null;

// ============================================================
//  HELPERS
// ============================================================

function isOn(stationData, group, label) {
    const v = stationData?.[group]?.[label];
    return v === true || v === 'True';
}

function hasActiveActuator(stationData) {
    const acts = stationData?.actuators;
    if (!acts) return false;
    for (const k in acts) {
        if (acts[k] === true || acts[k] === 'True') return true;
    }
    return false;
}

function deriveAction(stationName, stationData) {
    if (!stationData?.actuators) return '--';
    const map = ACTION_MAP[stationName];
    if (!map) return '--';
    for (const entry of map) {
        for (const key of entry.keys) {
            if (stationData.actuators[key] === true || stationData.actuators[key] === 'True') {
                if (entry.text === 'Compressor on') continue;
                return entry.text;
            }
        }
    }
    return '--';
}

// ============================================================
//  STEP DETECTION — maps PLC actuator state to one of 8 steps
// ============================================================

function detectCurrentStep(data) {
    if (!data) return -1;

    const hbw   = data.HBW   || {};
    const crane = data.Crane  || {};
    const ms    = data.MS     || {};
    const sl    = data.SL     || {};

    // ---- SL Sorting (step 5: sort) ----
    if (isOn(sl, 'actuators', 'Valve Blue') ||
        isOn(sl, 'actuators', 'Valve Red') ||
        isOn(sl, 'actuators', 'Valve White')) {
        return 5; // sort
    }

    // ---- SL Color sensor active (step 4: color) ----
    if (isOn(sl, 'actuators', 'Motor Conveyor Belt')) {
        const sensorVal = sl?.sensors?.['Color Sensor'];
        // If sensor is reading OR light barriers suggest near sensor
        if (typeof sensorVal === 'number' && sensorVal > 10) return 4; // color
        if (!isOn(sl, 'sensors', 'Light Barrier After Color')) return 4; // color
        return 4; // color (conveyor moving = somewhere in SL)
    }
    if (isOn(sl, 'actuators', 'Compressor') && !hasActiveActuator(crane)) {
        return 4; // color
    }

    // ---- MS Oven burn (step 2: oven) ----
    if (isOn(ms, 'actuators', 'Lamp')) return 2; // oven - burning

    // ---- MS Oven loading/slider (step 2: oven) ----
    if (isOn(ms, 'actuators', 'Motor Oven Slider Move In') ||
        isOn(ms, 'actuators', 'Valve Ovendoor') ||
        isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Oven') ||
        isOn(ms, 'actuators', 'Motor Oven Slider Move Out')) {
        return 2; // oven
    }

    // ---- MS Turntable/Conveyor pre-oven (step 2: oven) ----
    if (isOn(ms, 'actuators', 'Motor Conveyor Belt Forward') ||
        isOn(ms, 'actuators', 'Motor Turntable Clockwise') ||
        isOn(ms, 'actuators', 'Motor Turntable Counterclockwise') ||
        isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Turntable') ||
        isOn(ms, 'actuators', 'Valve Vacuum') ||
        isOn(ms, 'actuators', 'Valve Transfer Unit')) {
        // After oven = ejector/saw = step 3
        if (isOn(ms, 'actuators', 'Motor Saw') || isOn(ms, 'actuators', 'Valve Ejector')) {
            return 3; // out (eject)
        }
        // Transfer back from oven
        if (isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Turntable')) {
            return 3; // out
        }
        return 2; // oven (pre-oven stages)
    }

    // ---- MS Saw/Eject (step 3: out) ----
    if (isOn(ms, 'actuators', 'Motor Saw') ||
        isOn(ms, 'actuators', 'Valve Ejector')) {
        return 3; // out
    }

    // ---- MS Compressor only = still in MS ----
    if (isOn(ms, 'actuators', 'Compressor') && !hasActiveActuator(crane)) {
        return 2; // oven
    }

    // ---- Crane ----
    const craneActive = hasActiveActuator(crane);
    if (craneActive) {
        // Is it returning from SL (step 6) or transporting to oven (step 1)?
        // After sorting (SL was most recent), crane = return
        if (activeStep >= 5) return 6; // return
        // Before oven, crane = transport
        if (activeStep <= 1 || activeStep === -1) return 1; // crane
        // Default: if workpiece has been through oven already
        if (activeStep >= 3) return 6; // return
        return 1; // crane
    }

    // ---- HBW ----
    const hbwActive = hasActiveActuator(hbw);
    if (hbwActive) {
        // If we already went through the full cycle, this is rack storage
        if (activeStep >= 6) return 7; // rack
        return 0; // hbw retrieve
    }

    return -1; // idle
}

// ============================================================
//  THEME
// ============================================================

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

// ============================================================
//  SVG UPDATES
// ============================================================

function updateStations(step) {
    for (let i = 0; i < STEPS.length; i++) {
        const el = document.getElementById('stn-' + STEPS[i].id);
        if (!el) continue;

        el.classList.remove('active', 'visited');
        if (i === step) {
            el.classList.add('active');
            // Apply glow filter
            el.querySelector('.stn-box').style.filter = 'url(#glow-' + STEPS[i].id + ')';
        } else if (step >= 0 && i < step) {
            el.classList.add('visited');
            el.querySelector('.stn-box').style.filter = 'none';
        } else {
            el.querySelector('.stn-box').style.filter = 'none';
        }
    }
}

function updateConnections(step) {
    for (let i = 0; i < CONN_IDS.length; i++) {
        const el = document.getElementById(CONN_IDS[i]);
        if (!el) continue;
        // Active: the connection leading TO the current step
        if (step > 0 && i === step - 1) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    }
}

function updateActions(data) {
    if (!data) return;
    // HBW action
    const hbwAct = deriveAction('HBW', data.HBW);
    const el0 = document.getElementById('action-hbw');
    if (el0) el0.textContent = hbwAct;

    // Crane action
    const craneAct = deriveAction('Crane', data.Crane);
    const el1 = document.getElementById('action-crane');
    if (el1) el1.textContent = craneAct;

    // Oven action (MS)
    const msAct = deriveAction('MS', data.MS);
    const el2 = document.getElementById('action-oven');
    if (el2) el2.textContent = msAct;

    // Out action (MS eject/saw)
    const el3 = document.getElementById('action-out');
    if (el3) {
        const ms = data.MS || {};
        if (isOn(ms, 'actuators', 'Valve Ejector')) el3.textContent = 'Ejecting';
        else if (isOn(ms, 'actuators', 'Motor Saw')) el3.textContent = 'Saw cutting';
        else if (isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Turntable')) el3.textContent = 'Transfer back';
        else el3.textContent = msAct !== '--' ? msAct : '--';
    }

    // Color action
    const slAct = deriveAction('SL', data.SL);
    const el4 = document.getElementById('action-color');
    if (el4) el4.textContent = slAct;

    // Sort action
    const el5 = document.getElementById('action-sort');
    if (el5) {
        const sl = data.SL || {};
        if (isOn(sl, 'actuators', 'Valve White')) el5.textContent = 'Sort -> W';
        else if (isOn(sl, 'actuators', 'Valve Red')) el5.textContent = 'Sort -> R';
        else if (isOn(sl, 'actuators', 'Valve Blue')) el5.textContent = 'Sort -> B';
        else el5.textContent = slAct;
    }
}

function updateOvenVisual(data) {
    const ms = data?.MS || {};
    const burning = isOn(ms, 'actuators', 'Lamp');
    const ovenBox = document.querySelector('#stn-oven .stn-box');
    const ovenInner = document.getElementById('oven-glow-rect');
    const wpGroup = document.getElementById('wp-group');

    if (burning && !ovenBurning) {
        if (ovenBox) ovenBox.classList.add('burning');
        if (ovenInner) ovenInner.classList.add('burning');
        if (ovenBox) ovenBox.style.stroke = '#FF453A';
        ovenBurning = true;
    } else if (!burning && ovenBurning) {
        if (ovenBox) ovenBox.classList.remove('burning');
        if (ovenInner) ovenInner.classList.remove('burning');
        if (ovenBox) ovenBox.style.stroke = '';
        ovenBurning = false;
    }

    // Orange glow on workpiece during oven
    if (wpGroup) {
        if (burning) wpGroup.classList.add('in-oven');
        else wpGroup.classList.remove('in-oven');
    }
}

function updateColorDetection(data) {
    const sl = data?.SL || {};
    const val = sl?.sensors?.['Color Sensor'];
    if (typeof val === 'number' && val > 10) {
        if (val >= 250) colorDetected = { name: 'White', css: '#e0e0e0', value: val };
        else if (val >= 130) colorDetected = { name: 'Red', css: '#FF453A', value: val };
        else if (val >= 40)  colorDetected = { name: 'Blue', css: '#007AFF', value: val };

        if (colorDetected && wpColor === '#666') {
            wpColor = colorDetected.css;
            // Flash
            const dot = document.getElementById('wp-dot');
            if (dot) {
                dot.classList.remove('color-flash');
                void dot.offsetWidth;
                dot.classList.add('color-flash');
            }
        }
    }
}

// ============================================================
//  WORKPIECE POSITION
// ============================================================

function updateWorkpiece(step) {
    const group = document.getElementById('wp-group');
    const dot = document.getElementById('wp-dot');
    if (!group || !dot) return;

    if (step < 0) {
        // No activity — keep last position but don't hide immediately
        return;
    }

    const s = STEPS[step];
    wpTarget.x = s.cx;
    wpTarget.y = s.cy;

    if (!wpVisible) {
        wpPos.x = s.cx;
        wpPos.y = s.cy;
        wpVisible = true;
        group.setAttribute('visibility', 'visible');
    }

    // Reset workpiece on new cycle
    if (step === 0 && prevActiveStep >= 6) {
        wpColor = '#666';
        colorDetected = null;
    }

    dot.setAttribute('fill', wpColor);
    dot.setAttribute('stroke', wpColor === '#666' ? 'rgba(255,255,255,0.3)' : wpColor);
}

// ============================================================
//  TIMERS & TRAFFIC LIGHTS
// ============================================================

function updateTimers(step) {
    const now = Date.now();

    // Start timer for active step
    if (step >= 0) {
        const sid = STEPS[step].id;
        if (!stepTimers[sid]) {
            stepTimers[sid] = { start: now, elapsed: 0 };
        }
        stepTimers[sid].elapsed = (now - stepTimers[sid].start) / 1000;
    }

    // End timers for steps we left
    if (prevActiveStep >= 0 && prevActiveStep !== step) {
        const prevId = STEPS[prevActiveStep].id;
        if (stepTimers[prevId] && stepTimers[prevId].elapsed > 0.3) {
            const t = stepTimers[prevId].elapsed;
            lastStepTimes[prevId] = t;
            if (!avgStepTimes[prevId]) avgStepTimes[prevId] = [];
            avgStepTimes[prevId].push(t);
            // Keep last 10
            if (avgStepTimes[prevId].length > 10) avgStepTimes[prevId].shift();
        }
        stepTimers[prevId] = null;
    }

    // Cycle complete detection
    if (step === 7 && prevActiveStep !== 7) {
        // Tally total
        let total = 0;
        for (const s of STEPS) {
            const lt = lastStepTimes[s.id];
            if (lt) total += lt;
        }
        if (total > 0) lastTotalCycle = total;
    }

    // Update timing pills
    const mappedSteps = {
        hbw:   ['hbw', 'rack'],
        crane: ['crane', 'return'],
        oven:  ['oven'],
        color: ['color', 'out'],
        sort:  ['sort'],
    };

    for (const [pillId, stepIds] of Object.entries(mappedSteps)) {
        const timeEl = document.getElementById('time-' + pillId);
        const tlEl = document.getElementById('tl-' + pillId);
        if (!timeEl || !tlEl) continue;

        // Sum last times for grouped steps
        let totalTime = 0;
        let hasData = false;
        let isCurrentlyActive = false;

        for (const sid of stepIds) {
            if (stepTimers[sid]) {
                totalTime += stepTimers[sid].elapsed;
                isCurrentlyActive = true;
                hasData = true;
            } else if (lastStepTimes[sid]) {
                totalTime += lastStepTimes[sid];
                hasData = true;
            }
        }

        if (hasData) {
            timeEl.textContent = totalTime.toFixed(1) + 's';
        } else {
            timeEl.textContent = '--';
        }

        // Traffic light
        tlEl.className = 'pill-dot';
        const pill = tlEl.closest('.timing-pill');
        if (pill) pill.classList.remove('active-pill');

        if (isCurrentlyActive) {
            tlEl.classList.add('tl-active');
            if (pill) pill.classList.add('active-pill');
        } else if (hasData) {
            // Compare to expected
            let expected = 0;
            for (const sid of stepIds) {
                expected += (EXPECTED_TIMES[sid] || 10);
            }
            const ratio = totalTime / expected;
            if (ratio <= 1.15) {
                tlEl.classList.add('tl-green');
            } else if (ratio <= 1.5) {
                tlEl.classList.add('tl-orange');
            } else {
                tlEl.classList.add('tl-red');
            }
        }
    }

    // Total
    const totalEl = document.getElementById('time-total');
    if (totalEl) {
        if (lastTotalCycle) {
            totalEl.textContent = lastTotalCycle.toFixed(1) + 's';
        } else {
            // Sum current known
            let running = 0;
            let any = false;
            for (const s of STEPS) {
                if (stepTimers[s.id]) { running += stepTimers[s.id].elapsed; any = true; }
                else if (lastStepTimes[s.id]) { running += lastStepTimes[s.id]; any = true; }
            }
            totalEl.textContent = any ? running.toFixed(1) + 's' : '--';
        }
    }
}

// ============================================================
//  LIVE PILL
// ============================================================

function updateLivePill() {
    const pill = document.getElementById('live-pill');
    const lat = document.getElementById('live-latency');
    if (!pill) return;

    if (lastFetchTime === 0) {
        pill.className = 'live-pill';
        if (lat) lat.textContent = '--';
        return;
    }

    const ago = ((Date.now() - lastFetchTime) / 1000).toFixed(1);
    if (lat) lat.textContent = ago + 's';

    pill.className = parseFloat(ago) > 10 ? 'live-pill stale' : 'live-pill connected';
}

// ============================================================
//  ANIMATION LOOP
// ============================================================

function animate() {
    if (wpVisible) {
        wpPos.x += (wpTarget.x - wpPos.x) * LERP;
        wpPos.y += (wpTarget.y - wpPos.y) * LERP;

        const group = document.getElementById('wp-group');
        if (group) {
            group.setAttribute('transform',
                'translate(' + wpPos.x.toFixed(1) + ',' + wpPos.y.toFixed(1) + ')');
        }
    }

    // Update active step timer display continuously
    if (activeStep >= 0) {
        const sid = STEPS[activeStep].id;
        if (stepTimers[sid]) {
            stepTimers[sid].elapsed = (Date.now() - stepTimers[sid].start) / 1000;
        }

        // Update pill times smoothly
        const mappedSteps = {
            hbw:   ['hbw', 'rack'],
            crane: ['crane', 'return'],
            oven:  ['oven'],
            color: ['color', 'out'],
            sort:  ['sort'],
        };

        for (const [pillId, stepIds] of Object.entries(mappedSteps)) {
            let isActive = false;
            let totalTime = 0;
            for (const s of stepIds) {
                if (stepTimers[s]) { totalTime += stepTimers[s].elapsed; isActive = true; }
                else if (lastStepTimes[s]) { totalTime += lastStepTimes[s]; }
            }
            if (isActive) {
                const el = document.getElementById('time-' + pillId);
                if (el) el.textContent = totalTime.toFixed(1) + 's';
            }
        }
    }

    requestAnimationFrame(animate);
}

// ============================================================
//  MAIN UPDATE
// ============================================================

async function update() {
    try {
        const resp = await fetch('/api/data');
        if (!resp.ok) return;
        const data = await resp.json();

        lastFetchTime = Date.now();
        latestData = data;

        const allData = data?.data;
        if (!allData) return;

        const step = detectCurrentStep(allData);

        // Save previous
        if (step !== activeStep) {
            prevActiveStep = activeStep;
        }
        activeStep = step;

        updateStations(step);
        updateConnections(step);
        updateWorkpiece(step);
        updateActions(allData);
        updateOvenVisual(allData);
        updateColorDetection(allData);
        updateTimers(step);
    } catch (e) {
        // silent
    }
}

// ============================================================
//  INIT
// ============================================================

function init() {
    requestAnimationFrame(animate);
    setInterval(update, POLL_MS);
    setInterval(updateLivePill, 500);
    update();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

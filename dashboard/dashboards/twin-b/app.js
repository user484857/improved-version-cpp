/* ============================================
   Digital Twin B — SVG Factory + Click-to-Inspect
   Polls /api/data, tracks workpiece, animates
   stations, detail panel on click.

   Process: HBW -> Crane -> Oven -> Out ->
            Color -> Sort -> Crane Return -> Rack
   ============================================ */

const POLL_MS = 400;
const LERP = 0.12;

// ============================================================
//  PROCESS STEPS — cx/cy = workpiece target in SVG coords
// ============================================================

const STEPS = [
    { id: 'hbw',    label: 'HBW',          cx: 104, cy: 210, station: 'HBW',   color: '#AF52DE', step: 1, fullName: 'High-Bay Warehouse', sub: 'Retrieve from rack' },
    { id: 'crane',  label: 'Crane',        cx: 390, cy: 205, station: 'Crane', color: '#30D158', step: 2, fullName: 'Vacuum Crane',       sub: 'Transport to oven' },
    { id: 'oven',   label: 'Oven',         cx: 524, cy: 85,  station: 'MS',    color: '#007AFF', step: 3, fullName: 'Machining Station',   sub: 'Burn workpiece' },
    { id: 'out',    label: 'Out',          cx: 674, cy: 85,  station: 'MS',    color: '#007AFF', step: 4, fullName: 'Machining Station',   sub: 'Eject from oven' },
    { id: 'color',  label: 'Color',        cx: 760, cy: 210, station: 'SL',    color: '#5AC8FA', step: 5, fullName: 'Sorting Line',        sub: 'Color measurement' },
    { id: 'sort',   label: 'Sort',         cx: 674, cy: 345, station: 'SL',    color: '#FF9F0A', step: 6, fullName: 'Sorting Line',        sub: 'Classify by color' },
    { id: 'return', label: 'Crane Return', cx: 390, cy: 315, station: 'Crane', color: '#30D158', step: 7, fullName: 'Vacuum Crane',       sub: 'Return to warehouse' },
    { id: 'rack',   label: 'Rack Store',   cx: 104, cy: 280, station: 'HBW',   color: '#AF52DE', step: 8, fullName: 'High-Bay Warehouse', sub: 'Store in rack' },
];

// Expected durations (seconds) for traffic-light thresholds
const EXPECTED = {
    hbw: 12, crane: 12, oven: 18, out: 3, color: 4, sort: 4, return: 8, rack: 5,
};

const CONN_IDS = ['conn-1', 'conn-2', 'conn-3', 'conn-4', 'conn-5', 'conn-6', 'conn-7'];

// ============================================================
//  ACTION MAP — human-readable labels per PLC station
//  Keys match config.py OPC UA label names
// ============================================================

const ACTION_MAP = {
    HBW: [
        { keys: ['Conv Forward'],        text: 'Conveyor fwd' },
        { keys: ['Conv Backward'],       text: 'Conveyor bwd' },
        { keys: ['Stacker Fwd'],         text: 'Stacker fwd' },
        { keys: ['Stacker Bwd'],         text: 'Stacker bwd' },
        { keys: ['Stacker Up'],          text: 'Stacker up' },
        { keys: ['Stacker Down'],        text: 'Stacker down' },
        { keys: ['Cantilever Extend'],   text: 'Cantilever out' },
        { keys: ['Cantilever Retract'],  text: 'Cantilever in' },
    ],
    Crane: [
        { keys: ['Motor CW'],       text: 'Rotate CW' },
        { keys: ['Motor CCW'],      text: 'Rotate CCW' },
        { keys: ['Motor Forward'],   text: 'Arm fwd' },
        { keys: ['Motor Backward'],  text: 'Arm back' },
        { keys: ['Motor Up'],        text: 'Lift up' },
        { keys: ['Motor Down'],      text: 'Lower down' },
        { keys: ['Vacuum Valve'],    text: 'Vacuum grip' },
    ],
    MS: [
        { keys: ['Conveyor Fwd'],          text: 'Conveyor fwd' },
        { keys: ['Conveyor Bwd'],          text: 'Conveyor bwd' },
        { keys: ['Turntable CW'],          text: 'Turntable CW' },
        { keys: ['Turntable CCW'],         text: 'Turntable CCW' },
        { keys: ['Oven Slider Extend'],    text: 'Slider \u2192 oven' },
        { keys: ['Oven Slider Retract'],   text: 'Slider out' },
        { keys: ['Oven Door Valve'],       text: 'Oven door' },
        { keys: ['Oven Lamp (Burn)'],      text: 'Burning' },
        { keys: ['Saw'],                   text: 'Saw cutting' },
    ],
    SL: [
        { keys: ['Conveyor Belt'],     text: 'Conveyor fwd' },
        { keys: ['Cylinder White'],    text: 'Sort \u2192 White' },
        { keys: ['Cylinder Red'],      text: 'Sort \u2192 Red' },
        { keys: ['Cylinder Blue'],     text: 'Sort \u2192 Blue' },
    ],
};

// I/O definitions for detail panel — actuators and sensors per station
const IO_DEFS = {
    HBW: {
        actuators: [
            'Conv Forward', 'Conv Backward',
            'Stacker Fwd', 'Stacker Bwd', 'Stacker Up', 'Stacker Down',
            'Cantilever Extend', 'Cantilever Retract',
        ],
        sensors: [
            'Ref Horizontal', 'Ref Vertical',
            'Ref Cantilever Front', 'Ref Cantilever Back',
            'LB Inside Conv', 'LB Outside Conv',
        ],
    },
    Crane: {
        actuators: [
            'Motor Up', 'Motor Down', 'Motor Forward', 'Motor Backward',
            'Motor CW', 'Motor CCW', 'Compressor C', 'Vacuum Valve',
        ],
        sensors: [
            'Ref Vertical', 'Ref Horizontal', 'Ref Rotate',
        ],
    },
    MS: {
        actuators: [
            'Turntable CW', 'Turntable CCW',
            'Conveyor Fwd', 'Conveyor Bwd',
            'Saw', 'Oven Slider Retract', 'Oven Slider Extend',
            'Oven Door Valve', 'Oven Lamp (Burn)', 'Compressor MS',
        ],
        sensors: [
            'Turntable @ Oven', 'Turntable @ Conveyor', 'Turntable @ Saw',
            'Oven Slider Inside', 'Oven Slider Outside',
            'LB Turntable', 'LB Conveyor', 'LB Oven',
        ],
    },
    SL: {
        actuators: [
            'Conveyor Belt',
            'Cylinder White', 'Cylinder Red', 'Cylinder Blue',
            'Compressor SL',
        ],
        sensors: [
            'LB Before Color', 'LB After Color',
            'LB Storage White', 'LB Storage Red', 'LB Storage Blue',
            'Color Sensor',
        ],
    },
};

// Pill grouping: logical steps that roll into each timing pill
const PILL_MAP = {
    hbw:   ['hbw', 'rack'],
    crane: ['crane', 'return'],
    oven:  ['oven'],
    color: ['color', 'out'],
    sort:  ['sort'],
};

// ============================================================
//  STATE
// ============================================================

let latestData   = null;
let lastFetchTs  = 0;
let activeStep   = -1;
let prevStep     = -1;
let wpPos        = { x: 0, y: 0 };
let wpTarget     = { x: 0, y: 0 };
let wpVisible    = false;
let wpColor      = '#888';
let colorResult  = null;
let ovenBurning  = false;
let selectedStn  = null;        // currently inspected station id

// Timing
let stepTimers    = {};         // { stepId: { start, elapsed } }
let lastTimes     = {};         // { stepId: number }
let avgTimes      = {};         // { stepId: [number] }
let lastTotalTime = null;

// ============================================================
//  HELPERS
// ============================================================

function isOn(stn, group, label) {
    const v = stn?.[group]?.[label];
    return v === true || v === 'True';
}

function anyActuator(stn) {
    const a = stn?.actuators;
    if (!a) return false;
    for (const k in a) {
        if (a[k] === true || a[k] === 'True') return true;
    }
    return false;
}

function deriveAction(stationName, stn) {
    if (!stn?.actuators) return '--';
    const map = ACTION_MAP[stationName];
    if (!map) return '--';
    for (const e of map) {
        for (const k of e.keys) {
            if (stn.actuators[k] === true || stn.actuators[k] === 'True') {
                return e.text;
            }
        }
    }
    return '--';
}

function fmtTime(s) {
    if (s == null || isNaN(s)) return '--';
    return s.toFixed(1) + 's';
}

// ============================================================
//  STEP DETECTION — maps live PLC state to one of 8 steps
// ============================================================

function detectStep(data) {
    if (!data) return -1;

    const hbw   = data.HBW   || {};
    const crane = data.Crane  || {};
    const ms    = data.MS     || {};
    const sl    = data.SL     || {};

    // -- SL Sorting (step 5: sort) --
    if (isOn(sl, 'actuators', 'Cylinder Blue') ||
        isOn(sl, 'actuators', 'Cylinder Red')  ||
        isOn(sl, 'actuators', 'Cylinder White')) {
        return 5;
    }

    // -- SL Color / conveyor (step 4: color) --
    if (isOn(sl, 'actuators', 'Conveyor Belt')) {
        const sv = sl?.sensors?.['Color Sensor'];
        if (typeof sv === 'number' && sv > 10) return 4;
        if (!isOn(sl, 'sensors', 'LB After Color')) return 4;
        return 4;
    }
    if (isOn(sl, 'actuators', 'Compressor SL') && !anyActuator(crane)) {
        return 4;
    }

    // -- MS Oven burn (step 2: oven) --
    if (isOn(ms, 'actuators', 'Oven Lamp (Burn)')) return 2;

    // -- MS Oven loading/slider (step 2: oven) --
    if (isOn(ms, 'actuators', 'Oven Slider Extend') ||
        isOn(ms, 'actuators', 'Oven Door Valve') ||
        isOn(ms, 'actuators', 'Oven Slider Retract')) {
        return 2;
    }

    // -- MS Turntable/conveyor --
    if (isOn(ms, 'actuators', 'Conveyor Fwd') ||
        isOn(ms, 'actuators', 'Conveyor Bwd') ||
        isOn(ms, 'actuators', 'Turntable CW') ||
        isOn(ms, 'actuators', 'Turntable CCW')) {
        // Post-oven: saw = step 3
        if (isOn(ms, 'actuators', 'Saw')) return 3;
        // Transfer back from oven area = step 3
        if (activeStep >= 2 &&
            (isOn(ms, 'actuators', 'Turntable CCW') || isOn(ms, 'actuators', 'Turntable CW')) &&
            isOn(ms, 'sensors', 'Turntable @ Conveyor')) return 3;
        return 2;
    }

    // -- MS Saw (step 3: out) --
    if (isOn(ms, 'actuators', 'Saw')) return 3;

    // -- MS Compressor only --
    if (isOn(ms, 'actuators', 'Compressor MS') && !anyActuator(crane)) return 2;

    // -- Crane --
    if (anyActuator(crane)) {
        if (activeStep >= 5) return 6;          // after sort = return
        if (activeStep <= 1 || activeStep === -1) return 1;
        if (activeStep >= 3) return 6;
        return 1;
    }

    // -- HBW --
    if (anyActuator(hbw)) {
        if (activeStep >= 6) return 7;          // storing
        return 0;                               // retrieving
    }

    return -1;
}

// ============================================================
//  THEME TOGGLE
// ============================================================

function toggleTheme() {
    const cur  = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

// ============================================================
//  SVG — STATION HIGHLIGHTS
// ============================================================

function updateStations(step) {
    for (let i = 0; i < STEPS.length; i++) {
        const el = document.getElementById('stn-' + STEPS[i].id);
        if (!el) continue;
        const box = el.querySelector('.stn-box');

        el.classList.remove('active', 'visited');
        if (box) box.style.filter = 'none';

        if (i === step) {
            el.classList.add('active');
            if (box) box.style.filter = 'url(#glow-' + STEPS[i].id + ')';
        } else if (step >= 0 && i < step) {
            el.classList.add('visited');
        }
    }
}

// ============================================================
//  SVG — CONNECTION PATHS
// ============================================================

function updateConnections(step) {
    for (let i = 0; i < CONN_IDS.length; i++) {
        const el = document.getElementById(CONN_IDS[i]);
        if (!el) continue;
        el.classList.remove('active', 'visited');
        if (step > 0 && i === step - 1) {
            el.classList.add('active');
        } else if (step > 0 && i < step - 1) {
            el.classList.add('visited');
        }
    }
}

// ============================================================
//  SVG — ACTION LABELS ON STATIONS
// ============================================================

function updateActions(data) {
    if (!data) return;

    const set = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    };

    set('action-hbw',   deriveAction('HBW', data.HBW));
    set('action-crane', deriveAction('Crane', data.Crane));
    set('action-oven',  deriveAction('MS', data.MS));

    // Out: specific eject/saw actions
    const ms = data.MS || {};
    if (isOn(ms, 'actuators', 'Saw'))                 set('action-out', 'Saw cutting');
    else if (isOn(ms, 'actuators', 'Turntable CCW'))  set('action-out', 'Transfer back');
    else if (isOn(ms, 'actuators', 'Turntable CW'))   set('action-out', 'Transfer fwd');
    else                                               set('action-out', deriveAction('MS', data.MS));

    set('action-color', deriveAction('SL', data.SL));

    // Sort: specific valve
    const sl = data.SL || {};
    if      (isOn(sl, 'actuators', 'Cylinder White')) set('action-sort', 'Sort \u2192 W');
    else if (isOn(sl, 'actuators', 'Cylinder Red'))   set('action-sort', 'Sort \u2192 R');
    else if (isOn(sl, 'actuators', 'Cylinder Blue'))  set('action-sort', 'Sort \u2192 B');
    else                                               set('action-sort', deriveAction('SL', data.SL));
}

// ============================================================
//  SVG — OVEN GLOW
// ============================================================

function updateOven(data) {
    const ms      = data?.MS || {};
    const burning = isOn(ms, 'actuators', 'Oven Lamp (Burn)');
    const ovenStn = document.querySelector('#stn-oven .stn-box.stn-oven');
    const inner   = document.getElementById('oven-glow-rect');
    const wpG     = document.getElementById('wp-group');

    if (burning && !ovenBurning) {
        ovenStn?.classList.add('burning');
        inner?.classList.add('burning');
        if (ovenStn) ovenStn.style.stroke = '#FF453A';
        ovenBurning = true;
    } else if (!burning && ovenBurning) {
        ovenStn?.classList.remove('burning');
        inner?.classList.remove('burning');
        if (ovenStn) ovenStn.style.stroke = '';
        ovenBurning = false;
    }

    if (wpG) wpG.classList.toggle('in-oven', burning);
}

// ============================================================
//  SVG — COLOR SENSOR
// ============================================================

function updateColorSensor(data) {
    const sl  = data?.SL || {};
    const val = sl?.sensors?.['Color Sensor'];

    if (typeof val === 'number' && val > 10) {
        if      (val >= 250) colorResult = { name: 'White', css: '#e0e0e0', value: val };
        else if (val >= 130) colorResult = { name: 'Red',   css: '#FF453A', value: val };
        else if (val >= 40)  colorResult = { name: 'Blue',  css: '#007AFF', value: val };

        if (colorResult && wpColor === '#888') {
            wpColor = colorResult.css;
            const dot = document.getElementById('wp-dot');
            if (dot) {
                dot.classList.remove('color-flash');
                void dot.offsetWidth;               // trigger reflow
                dot.classList.add('color-flash');
            }
        }
    }
}

// ============================================================
//  WORKPIECE POSITION
// ============================================================

function updateWorkpiece(step) {
    const grp = document.getElementById('wp-group');
    const dot = document.getElementById('wp-dot');
    if (!grp || !dot) return;

    if (step < 0) return;       // idle: hold position

    const s = STEPS[step];
    wpTarget.x = s.cx;
    wpTarget.y = s.cy;

    if (!wpVisible) {
        wpPos.x = s.cx;
        wpPos.y = s.cy;
        wpVisible = true;
        grp.setAttribute('visibility', 'visible');
    }

    // New cycle resets color
    if (step === 0 && prevStep >= 6) {
        wpColor = '#888';
        colorResult = null;
    }

    dot.setAttribute('fill', wpColor);
    dot.setAttribute('stroke', wpColor === '#888' ? 'rgba(255,255,255,0.25)' : wpColor);
}

// ============================================================
//  TIMERS + TRAFFIC LIGHTS
// ============================================================

function updateTimers(step) {
    const now = Date.now();

    // Start timer for current step
    if (step >= 0) {
        const sid = STEPS[step].id;
        if (!stepTimers[sid]) {
            stepTimers[sid] = { start: now, elapsed: 0 };
        }
        stepTimers[sid].elapsed = (now - stepTimers[sid].start) / 1000;
    }

    // Finalize timer for step we just left
    if (prevStep >= 0 && prevStep !== step) {
        const pid = STEPS[prevStep].id;
        if (stepTimers[pid] && stepTimers[pid].elapsed > 0.3) {
            const t = stepTimers[pid].elapsed;
            lastTimes[pid] = t;
            if (!avgTimes[pid]) avgTimes[pid] = [];
            avgTimes[pid].push(t);
            if (avgTimes[pid].length > 10) avgTimes[pid].shift();
        }
        stepTimers[pid] = null;
    }

    // Cycle complete at step 7 (rack)
    if (step === 7 && prevStep !== 7) {
        let total = 0;
        for (const s of STEPS) {
            if (lastTimes[s.id]) total += lastTimes[s.id];
        }
        if (total > 0) lastTotalTime = total;
    }

    // Update timing pills
    for (const [pill, sids] of Object.entries(PILL_MAP)) {
        const timeEl = document.getElementById('time-' + pill);
        const tlEl   = document.getElementById('tl-' + pill);
        if (!timeEl || !tlEl) continue;

        let sum = 0, hasData = false, isActive = false;

        for (const sid of sids) {
            if (stepTimers[sid]) {
                sum += stepTimers[sid].elapsed;
                isActive = true;
                hasData = true;
            } else if (lastTimes[sid]) {
                sum += lastTimes[sid];
                hasData = true;
            }
        }

        timeEl.textContent = hasData ? fmtTime(sum) : '--';

        // Traffic light on pill dot
        tlEl.className = 'pill-dot';
        const pillEl = tlEl.closest('.timing-pill');
        if (pillEl) pillEl.classList.remove('active-pill');

        if (isActive) {
            tlEl.classList.add('tl-active');
            if (pillEl) pillEl.classList.add('active-pill');
        } else if (hasData) {
            let expected = 0;
            for (const sid of sids) expected += (EXPECTED[sid] || 10);
            const ratio = sum / expected;
            if      (ratio <= 1.15) tlEl.classList.add('tl-green');
            else if (ratio <= 1.5)  tlEl.classList.add('tl-orange');
            else                    tlEl.classList.add('tl-red');
        }
    }

    // Total pill
    const totalEl = document.getElementById('time-total');
    if (totalEl) {
        if (lastTotalTime) {
            totalEl.textContent = fmtTime(lastTotalTime);
        } else {
            let running = 0, any = false;
            for (const s of STEPS) {
                if (stepTimers[s.id])       { running += stepTimers[s.id].elapsed; any = true; }
                else if (lastTimes[s.id])   { running += lastTimes[s.id]; any = true; }
            }
            totalEl.textContent = any ? fmtTime(running) : '--';
        }
    }
}

// ============================================================
//  LIVE PILL
// ============================================================

function updateLivePill() {
    const pill = document.getElementById('live-pill');
    const lat  = document.getElementById('live-latency');
    if (!pill) return;

    if (lastFetchTs === 0) {
        pill.className = 'live-pill';
        if (lat) lat.textContent = '--';
        return;
    }

    const ago = ((Date.now() - lastFetchTs) / 1000).toFixed(1);
    if (lat) lat.textContent = ago + 's';
    pill.className = parseFloat(ago) > 10 ? 'live-pill stale' : 'live-pill connected';
}

// ============================================================
//  DETAIL PANEL — click-to-inspect
// ============================================================

function openDetailPanel(stepId) {
    const panel   = document.getElementById('detail-panel');
    const overlay = document.getElementById('detail-overlay');
    if (!panel || !overlay) return;

    selectedStn = stepId;

    // Highlight selected station in SVG
    document.querySelectorAll('.stn').forEach(s => s.classList.remove('selected'));
    const stnEl = document.getElementById('stn-' + stepId);
    if (stnEl) stnEl.classList.add('selected');

    panel.classList.add('open');
    overlay.classList.add('visible');

    populateDetailPanel();
}

function closeDetailPanel() {
    const panel   = document.getElementById('detail-panel');
    const overlay = document.getElementById('detail-overlay');

    panel?.classList.remove('open');
    overlay?.classList.remove('visible');

    document.querySelectorAll('.stn').forEach(s => s.classList.remove('selected'));
    selectedStn = null;
}

function populateDetailPanel() {
    if (!selectedStn) return;

    const step = STEPS.find(s => s.id === selectedStn);
    if (!step) return;

    const data = latestData?.data;
    const stnData = data?.[step.station] || {};
    const isActive = activeStep >= 0 && STEPS[activeStep]?.id === selectedStn;

    // Header
    const dotEl = document.getElementById('detail-dot');
    if (dotEl) {
        dotEl.style.background = step.color;
        dotEl.style.boxShadow = '0 0 8px ' + step.color + '66';
    }
    const titleEl = document.getElementById('detail-title');
    if (titleEl) titleEl.textContent = step.fullName + ' \u2014 ' + step.label;

    const statusEl = document.getElementById('detail-status');
    if (statusEl) {
        statusEl.textContent = isActive ? 'Active' : 'Idle';
        statusEl.className = 'detail-status ' + (isActive ? 'active' : 'idle');
    }

    // Current action
    const actionBox  = document.getElementById('detail-action');
    const actionText = actionBox?.querySelector('.detail-action-text');
    const action     = deriveAction(step.station, stnData);
    if (actionText) actionText.textContent = isActive ? action : 'Idle';
    if (actionBox)  actionBox.classList.toggle('active-action', isActive && action !== '--');

    // Timing
    populateDetailTiming(step);

    // Actuators
    const actContainer = document.getElementById('detail-actuators');
    const ioDefs = IO_DEFS[step.station];
    if (actContainer && ioDefs) {
        const actuators = stnData?.actuators || {};
        actContainer.innerHTML = ioDefs.actuators.map(name => {
            const val = actuators[name];
            const on = val === true || val === 'True';
            return '<div class="detail-io-item' + (on ? ' on' : '') + '">' +
                   '<span class="detail-io-dot"></span>' +
                   '<span class="detail-io-name">' + escHtml(name) + '</span>' +
                   '<span class="detail-io-value">' + (on ? 'ON' : 'OFF') + '</span>' +
                   '</div>';
        }).join('');
    }

    // Sensors
    const senContainer = document.getElementById('detail-sensors');
    if (senContainer && ioDefs) {
        const sensors = stnData?.sensors || {};
        senContainer.innerHTML = ioDefs.sensors.map(name => {
            const val = sensors[name];
            const isNum = typeof val === 'number';
            const on = isNum ? val > 0 : (val === true || val === 'True');
            const display = isNum ? String(val) : (on ? 'ON' : 'OFF');
            return '<div class="detail-io-item' + (on ? ' on' : '') + '">' +
                   '<span class="detail-io-dot"></span>' +
                   '<span class="detail-io-name">' + escHtml(name) + '</span>' +
                   '<span class="detail-io-value">' + display + '</span>' +
                   '</div>';
        }).join('');
    }

    // Step indicator
    const stepNumEl = document.getElementById('detail-step-num');
    if (stepNumEl) stepNumEl.textContent = step.step;
}

function populateDetailTiming(step) {
    const sid = step.id;

    // Last cycle
    const lastEl = document.getElementById('detail-last-time');
    if (lastEl) lastEl.textContent = fmtTime(lastTimes[sid] ?? null);

    // Average
    const avgEl = document.getElementById('detail-avg-time');
    if (avgEl) {
        const arr = avgTimes[sid];
        if (arr && arr.length > 0) {
            const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
            avgEl.textContent = fmtTime(avg);
        } else {
            avgEl.textContent = '--';
        }
    }

    // Expected
    const expEl = document.getElementById('detail-expected-time');
    const exp = EXPECTED[sid] || 10;
    if (expEl) expEl.textContent = fmtTime(exp);

    // Progress bar + traffic light
    const fillEl    = document.getElementById('detail-timing-fill');
    const targetEl  = document.getElementById('detail-timing-target');
    const trafficEl = document.getElementById('detail-traffic-dot');
    const tlLabel   = document.getElementById('detail-traffic-label');

    // Determine the relevant time
    let currentTime = null;
    if (stepTimers[sid]) {
        currentTime = stepTimers[sid].elapsed;
    } else if (lastTimes[sid]) {
        currentTime = lastTimes[sid];
    }

    if (fillEl && targetEl) {
        if (currentTime != null) {
            const pct = Math.min((currentTime / (exp * 1.6)) * 100, 100);
            fillEl.style.width = pct + '%';

            // Target marker at expected position
            const targetPct = (exp / (exp * 1.6)) * 100;
            targetEl.style.left = targetPct + '%';

            // Color the fill bar
            const ratio = currentTime / exp;
            fillEl.classList.remove('warn', 'critical');
            if (ratio > 1.5) fillEl.classList.add('critical');
            else if (ratio > 1.15) fillEl.classList.add('warn');
        } else {
            fillEl.style.width = '0%';
        }
    }

    if (trafficEl && tlLabel) {
        trafficEl.className = 'detail-traffic-dot';
        if (stepTimers[sid]) {
            // Currently running
            trafficEl.classList.add('active-dot');
            tlLabel.textContent = 'Running';
        } else if (currentTime != null) {
            const ratio = currentTime / exp;
            if (ratio <= 1.15) {
                trafficEl.classList.add('green');
                tlLabel.textContent = 'On time';
            } else if (ratio <= 1.5) {
                trafficEl.classList.add('orange');
                tlLabel.textContent = 'Slow';
            } else {
                trafficEl.classList.add('red');
                tlLabel.textContent = 'Critical';
            }
        } else {
            tlLabel.textContent = '--';
        }
    }
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ============================================================
//  ANIMATION LOOP
// ============================================================

function animate() {
    // Lerp workpiece position
    if (wpVisible) {
        wpPos.x += (wpTarget.x - wpPos.x) * LERP;
        wpPos.y += (wpTarget.y - wpPos.y) * LERP;

        const grp = document.getElementById('wp-group');
        if (grp) {
            grp.setAttribute('transform',
                'translate(' + wpPos.x.toFixed(1) + ',' + wpPos.y.toFixed(1) + ')');
        }
    }

    // Real-time timer display during animation
    if (activeStep >= 0) {
        const sid = STEPS[activeStep].id;
        if (stepTimers[sid]) {
            stepTimers[sid].elapsed = (Date.now() - stepTimers[sid].start) / 1000;
        }

        // Update active pill timer smoothly
        for (const [pill, sids] of Object.entries(PILL_MAP)) {
            let isAct = false, total = 0;
            for (const s of sids) {
                if (stepTimers[s])       { total += stepTimers[s].elapsed; isAct = true; }
                else if (lastTimes[s])   { total += lastTimes[s]; }
            }
            if (isAct) {
                const el = document.getElementById('time-' + pill);
                if (el) el.textContent = fmtTime(total);
            }
        }

        // Update total in real-time
        const totalEl = document.getElementById('time-total');
        if (totalEl && !lastTotalTime) {
            let running = 0, any = false;
            for (const s of STEPS) {
                if (stepTimers[s.id])       { running += stepTimers[s.id].elapsed; any = true; }
                else if (lastTimes[s.id])   { running += lastTimes[s.id]; any = true; }
            }
            if (any) totalEl.textContent = fmtTime(running);
        }
    }

    // Update detail panel if open (live refresh)
    if (selectedStn) {
        populateDetailPanel();
    }

    requestAnimationFrame(animate);
}

// ============================================================
//  MAIN POLL
// ============================================================

async function poll() {
    try {
        const resp = await fetch('/api/data');
        if (!resp.ok) return;
        const json = await resp.json();

        lastFetchTs = Date.now();
        latestData  = json;

        const d = json?.data;
        if (!d) return;

        const step = detectStep(d);

        if (step !== activeStep) {
            prevStep = activeStep;
        }
        activeStep = step;

        updateStations(step);
        updateConnections(step);
        updateWorkpiece(step);
        updateActions(d);
        updateOven(d);
        updateColorSensor(d);
        updateTimers(step);
    } catch (_) {
        // silent
    }
}

// ============================================================
//  EVENT BINDINGS
// ============================================================

function bindEvents() {
    // Click on stations
    document.querySelectorAll('.stn-clickable').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const stepId = el.getAttribute('data-step') || el.id.replace('stn-', '');
            openDetailPanel(stepId);
        });
    });

    // Close panel
    const closeBtn = document.getElementById('detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDetailPanel);

    const overlay = document.getElementById('detail-overlay');
    if (overlay) overlay.addEventListener('click', closeDetailPanel);

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && selectedStn) closeDetailPanel();
    });
}

// ============================================================
//  INIT
// ============================================================

function init() {
    bindEvents();
    requestAnimationFrame(animate);
    setInterval(poll, POLL_MS);
    setInterval(updateLivePill, 500);
    poll();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

/* ============================================
   Digital Twin A — Final Version
   Minimal SVG factory floor. One workpiece.
   Crane-centered layout. Timing row below.

   Process: HBW -> Crane -> Oven -> Out ->
            Color -> Sort -> Crane Return -> Rack
   ============================================ */

const POLL_MS = 400;
const LERP = 0.1;

// ============================================================
//  PROCESS STEPS — maps to SVG stations
//  cx/cy = workpiece dot target position
// ============================================================

const STEPS = [
    { id: 'hbw',    label: 'HBW',    cx: 110, cy: 211, station: 'HBW',   color: '#AF52DE' },
    { id: 'crane',  label: 'Crane',  cx: 400, cy: 206, station: 'Crane', color: '#30D158' },
    { id: 'oven',   label: 'Oven',   cx: 545, cy: 81,  station: 'MS',    color: '#007AFF' },
    { id: 'out',    label: 'Out',    cx: 693, cy: 81,  station: 'MS',    color: '#007AFF' },
    { id: 'color',  label: 'Color',  cx: 770, cy: 236, station: 'SL',    color: '#5AC8FA' },
    { id: 'sort',   label: 'Sort',   cx: 693, cy: 361, station: 'SL',    color: '#FF9F0A' },
    { id: 'return', label: 'Return', cx: 400, cy: 271, station: 'Crane', color: '#30D158' },
    { id: 'rack',   label: 'Rack',   cx: 110, cy: 281, station: 'HBW',   color: '#AF52DE' },
];

// Expected times per logical step (seconds, for traffic light thresholds)
const EXPECTED = {
    hbw: 12, crane: 12, oven: 18, out: 3, color: 4, sort: 4, return: 8, rack: 5,
};

// Connection path IDs between consecutive steps
const CONN_IDS = ['conn-1', 'conn-2', 'conn-3', 'conn-4', 'conn-5', 'conn-6', 'conn-7'];

// ============================================================
//  ACTION MAP — human-readable PLC actuator labels
// ============================================================

const ACTION_MAP = {
    HBW: [
        { keys: ['Motor Conveyor Belt Forward'],           text: 'Conveyor fwd' },
        { keys: ['Motor Stacker Crane \u2192 Rack'],      text: 'Stacker \u2192 rack' },
        { keys: ['Motor Stacker Crane \u2192 Conv Belt'], text: 'Stacker \u2192 belt' },
        { keys: ['Motor Stacker Crane Upward'],            text: 'Stacker up' },
        { keys: ['Motor Stacker Crane Downward'],          text: 'Stacker down' },
        { keys: ['Motor Cantilever Forward'],              text: 'Cantilever out' },
        { keys: ['Motor Cantilever Backward'],             text: 'Cantilever in' },
    ],
    Crane: [
        { keys: ['Motor Clockwise'],        text: 'Rotate CW' },
        { keys: ['Motor Counterclockwise'], text: 'Rotate CCW' },
        { keys: ['Motor Forward'],          text: 'Arm fwd' },
        { keys: ['Motor Backward'],         text: 'Arm back' },
        { keys: ['Motor Upward'],           text: 'Lift up' },
        { keys: ['Motor Downward'],         text: 'Lower down' },
        { keys: ['Valve'],                  text: 'Vacuum grip' },
    ],
    MS: [
        { keys: ['Motor Conveyor Belt Forward'],          text: 'Conveyor fwd' },
        { keys: ['Motor Turntable Clockwise'],            text: 'Turntable CW' },
        { keys: ['Motor Turntable Counterclockwise'],     text: 'Turntable CCW' },
        { keys: ['Motor Transfer Unit \u2192 Oven'],      text: 'Transfer \u2192 oven' },
        { keys: ['Motor Transfer Unit \u2192 Turntable'], text: 'Transfer \u2192 TT' },
        { keys: ['Motor Oven Slider Move In'],            text: 'Slider in' },
        { keys: ['Motor Oven Slider Move Out'],           text: 'Slider out' },
        { keys: ['Valve Ovendoor'],                       text: 'Oven door' },
        { keys: ['Lamp'],                                 text: 'Burning' },
        { keys: ['Motor Saw'],                            text: 'Saw cutting' },
        { keys: ['Valve Ejector'],                        text: 'Ejecting' },
    ],
    SL: [
        { keys: ['Motor Conveyor Belt'], text: 'Conveyor fwd' },
        { keys: ['Valve White'],         text: 'Sort \u2192 W' },
        { keys: ['Valve Red'],           text: 'Sort \u2192 R' },
        { keys: ['Valve Blue'],          text: 'Sort \u2192 B' },
    ],
};

// Pill grouping: which logical steps roll up into each pill
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

// Timing state
let stepTimers    = {};   // { stepId: { start, elapsed } }
let lastTimes     = {};   // { stepId: number }
let avgTimes      = {};   // { stepId: [number] }
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

// ============================================================
//  STEP DETECTION — maps PLC state to one of 8 steps
// ============================================================

function detectStep(data) {
    if (!data) return -1;

    const hbw   = data.HBW   || {};
    const crane = data.Crane  || {};
    const ms    = data.MS     || {};
    const sl    = data.SL     || {};

    // -- SL Sorting (step 5: sort) --
    if (isOn(sl, 'actuators', 'Valve Blue') ||
        isOn(sl, 'actuators', 'Valve Red')  ||
        isOn(sl, 'actuators', 'Valve White')) {
        return 5;
    }

    // -- SL Color / conveyor (step 4: color) --
    if (isOn(sl, 'actuators', 'Motor Conveyor Belt')) {
        const sv = sl?.sensors?.['Color Sensor'];
        if (typeof sv === 'number' && sv > 10) return 4;
        if (!isOn(sl, 'sensors', 'Light Barrier After Color')) return 4;
        return 4;
    }
    if (isOn(sl, 'actuators', 'Compressor') && !anyActuator(crane)) {
        return 4;
    }

    // -- MS Oven burn (step 2: oven) --
    if (isOn(ms, 'actuators', 'Lamp')) return 2;

    // -- MS Oven loading/slider (step 2: oven) --
    if (isOn(ms, 'actuators', 'Motor Oven Slider Move In') ||
        isOn(ms, 'actuators', 'Valve Ovendoor') ||
        isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Oven') ||
        isOn(ms, 'actuators', 'Motor Oven Slider Move Out')) {
        return 2;
    }

    // -- MS Turntable/conveyor (pre-oven or post-oven) --
    if (isOn(ms, 'actuators', 'Motor Conveyor Belt Forward') ||
        isOn(ms, 'actuators', 'Motor Turntable Clockwise') ||
        isOn(ms, 'actuators', 'Motor Turntable Counterclockwise') ||
        isOn(ms, 'actuators', 'Valve Vacuum') ||
        isOn(ms, 'actuators', 'Valve Transfer Unit') ||
        isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Turntable')) {
        // Post-oven: saw/ejector = step 3
        if (isOn(ms, 'actuators', 'Motor Saw') || isOn(ms, 'actuators', 'Valve Ejector')) return 3;
        if (isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Turntable')) return 3;
        return 2;
    }

    // -- MS Saw/Eject (step 3: out) --
    if (isOn(ms, 'actuators', 'Motor Saw') || isOn(ms, 'actuators', 'Valve Ejector')) return 3;

    // -- MS Compressor only --
    if (isOn(ms, 'actuators', 'Compressor') && !anyActuator(crane)) return 2;

    // -- Crane --
    if (anyActuator(crane)) {
        if (activeStep >= 5) return 6;          // after sort = return
        if (activeStep <= 1 || activeStep === -1) return 1; // to oven
        if (activeStep >= 3) return 6;          // past oven = return
        return 1;
    }

    // -- HBW --
    if (anyActuator(hbw)) {
        if (activeStep >= 6) return 7;          // storing to rack
        return 0;                               // retrieving
    }

    return -1;
}

// ============================================================
//  THEME
// ============================================================

function toggleTheme() {
    const cur  = document.documentElement.getAttribute('data-theme');
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
        const box = el.querySelector('.stn-bg');

        el.classList.remove('active', 'visited');
        box.style.filter = 'none';

        if (i === step) {
            el.classList.add('active');
            box.style.filter = 'url(#glow-' + STEPS[i].id + ')';
        } else if (step >= 0 && i < step) {
            el.classList.add('visited');
        }
    }
}

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
    if (isOn(ms, 'actuators', 'Valve Ejector'))                        set('action-out', 'Ejecting');
    else if (isOn(ms, 'actuators', 'Motor Saw'))                       set('action-out', 'Saw cutting');
    else if (isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Turntable')) set('action-out', 'Transfer back');
    else                                                                set('action-out', deriveAction('MS', data.MS));

    set('action-color', deriveAction('SL', data.SL));

    // Sort: specific valve actions
    const sl = data.SL || {};
    if      (isOn(sl, 'actuators', 'Valve White')) set('action-sort', 'Sort \u2192 W');
    else if (isOn(sl, 'actuators', 'Valve Red'))   set('action-sort', 'Sort \u2192 R');
    else if (isOn(sl, 'actuators', 'Valve Blue'))  set('action-sort', 'Sort \u2192 B');
    else                                            set('action-sort', deriveAction('SL', data.SL));
}

function updateOven(data) {
    const ms      = data?.MS || {};
    const burning = isOn(ms, 'actuators', 'Lamp');
    const box     = document.querySelector('#stn-oven .stn-oven-box');
    const inner   = document.getElementById('oven-glow-rect');
    const wpG     = document.getElementById('wp-group');

    if (burning && !ovenBurning) {
        box?.classList.add('burning');
        inner?.classList.add('burning');
        if (box) box.style.stroke = '#FF453A';
        ovenBurning = true;
    } else if (!burning && ovenBurning) {
        box?.classList.remove('burning');
        inner?.classList.remove('burning');
        if (box) box.style.stroke = '';
        ovenBurning = false;
    }

    // Orange/red glow on workpiece
    if (wpG) {
        wpG.classList.toggle('in-oven', burning);
    }
}

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
    const grp = document.getElementById('wp-group');
    const dot = document.getElementById('wp-dot');
    if (!grp || !dot) return;

    if (step < 0) return;  // idle: keep last position

    const s = STEPS[step];
    wpTarget.x = s.cx;
    wpTarget.y = s.cy;

    if (!wpVisible) {
        wpPos.x = s.cx;
        wpPos.y = s.cy;
        wpVisible = true;
        grp.setAttribute('visibility', 'visible');
    }

    // New cycle: reset color
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

    // Start timer for new step
    if (step >= 0) {
        const sid = STEPS[step].id;
        if (!stepTimers[sid]) {
            stepTimers[sid] = { start: now, elapsed: 0 };
        }
        stepTimers[sid].elapsed = (now - stepTimers[sid].start) / 1000;
    }

    // Finish timer for step we just left
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

    // Cycle-complete
    if (step === 7 && prevStep !== 7) {
        let total = 0;
        for (const s of STEPS) {
            if (lastTimes[s.id]) total += lastTimes[s.id];
        }
        if (total > 0) lastTotalTime = total;
    }

    // Update pills
    for (const [pill, sids] of Object.entries(PILL_MAP)) {
        const timeEl = document.getElementById('time-' + pill);
        const avgEl  = document.getElementById('avg-' + pill);
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

        timeEl.textContent = hasData ? sum.toFixed(1) + 's' : '--';

        // Average
        if (avgEl) {
            let avgSum = 0, avgCnt = 0;
            for (const sid of sids) {
                if (avgTimes[sid] && avgTimes[sid].length > 0) {
                    const a = avgTimes[sid].reduce((x, y) => x + y, 0) / avgTimes[sid].length;
                    avgSum += a;
                    avgCnt++;
                }
            }
            avgEl.textContent = avgCnt > 0 ? '\u00F8 ' + avgSum.toFixed(1) + 's' : '';
        }

        // Traffic light
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

    // Total
    const totalEl = document.getElementById('time-total');
    if (totalEl) {
        if (lastTotalTime) {
            totalEl.textContent = lastTotalTime.toFixed(1) + 's';
        } else {
            let running = 0, any = false;
            for (const s of STEPS) {
                if (stepTimers[s.id])  { running += stepTimers[s.id].elapsed; any = true; }
                else if (lastTimes[s.id]) { running += lastTimes[s.id]; any = true; }
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
//  ANIMATION LOOP
// ============================================================

function animate() {
    if (wpVisible) {
        wpPos.x += (wpTarget.x - wpPos.x) * LERP;
        wpPos.y += (wpTarget.y - wpPos.y) * LERP;

        const grp = document.getElementById('wp-group');
        if (grp) {
            grp.setAttribute('transform',
                'translate(' + wpPos.x.toFixed(1) + ',' + wpPos.y.toFixed(1) + ')');
        }
    }

    // Smooth timer updates during animation frames
    if (activeStep >= 0) {
        const sid = STEPS[activeStep].id;
        if (stepTimers[sid]) {
            stepTimers[sid].elapsed = (Date.now() - stepTimers[sid].start) / 1000;
        }

        for (const [pill, sids] of Object.entries(PILL_MAP)) {
            let isAct = false, total = 0;
            for (const s of sids) {
                if (stepTimers[s]) { total += stepTimers[s].elapsed; isAct = true; }
                else if (lastTimes[s]) { total += lastTimes[s]; }
            }
            if (isAct) {
                const el = document.getElementById('time-' + pill);
                if (el) el.textContent = total.toFixed(1) + 's';
            }
        }
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
            prevStep   = activeStep;
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
//  EVENT LOG (SQLite history)
// ============================================================

const STATION_COLORS_LOG = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', SL: '#FF9F0A', PM: '#FF453A'
};

let eventLogFilter = '';

async function loadEventLog() {
    try {
        let url = '/api/history/activity?limit=40';
        if (eventLogFilter) url += '&station=' + encodeURIComponent(eventLogFilter);

        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const events = await resp.json();

        if (events.error) {
            renderEventLogEmpty('Database not available');
            return;
        }

        renderEventLog(events);
    } catch (_) {
        renderEventLogEmpty('No history data');
    }
}

function renderEventLog(events) {
    const body = document.getElementById('event-log-body');
    const countEl = document.getElementById('event-log-count');
    if (!body) return;

    if (!events || events.length === 0) {
        renderEventLogEmpty('No events recorded');
        return;
    }

    if (countEl) countEl.textContent = events.length + ' events';

    body.innerHTML = events.map(function(e) {
        var color = STATION_COLORS_LOG[e.station] || '#5AC8FA';
        var isOn = e.value === 'True' || e.value === 'true';
        var stateClass = isOn ? 'state-on' : 'state-off';
        var stateLabel = isOn ? 'ON' : 'OFF';
        var varShort = e.variable
            .replace(/^bMotor_/, '')
            .replace(/^bValve_/, '')
            .replace(/^bLamp_/, '')
            .replace(/^bCompressor_/, '')
            .replace(/_/g, ' ');
        var ts = e.timestamp.split(' ')[1] || e.timestamp;
        // Trim to HH:MM:SS.mmm
        if (ts.length > 12) ts = ts.substring(0, 12);

        return '<div class="event-row">'
            + '<span class="event-time mono">' + ts + '</span>'
            + '<span class="event-station" style="background:' + color + '">' + e.station + '</span>'
            + '<span class="event-var">' + varShort + '</span>'
            + '<span class="event-state ' + stateClass + '">' + stateLabel + '</span>'
            + '</div>';
    }).join('');
}

function renderEventLogEmpty(msg) {
    var body = document.getElementById('event-log-body');
    var countEl = document.getElementById('event-log-count');
    if (body) body.innerHTML = '<div class="event-log-empty mono">' + msg + '</div>';
    if (countEl) countEl.textContent = '--';
}

function filterEventLog() {
    var sel = document.getElementById('event-log-filter');
    eventLogFilter = sel ? sel.value : '';
    loadEventLog();
}

// ============================================================
//  INIT
// ============================================================

function init() {
    requestAnimationFrame(animate);
    setInterval(poll, POLL_MS);
    setInterval(updateLivePill, 500);
    poll();

    // Load event log from SQLite history
    loadEventLog();
    setInterval(loadEventLog, 10000);  // refresh every 10s
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

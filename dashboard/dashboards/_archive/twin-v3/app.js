/* ============================================
   Digital Twin v3 — Engineering Console
   Data-dense dashboard: schematic + live vars
   ============================================ */

// ============================================================
//  CONSTANTS
// ============================================================

const STATION_COLORS = {
    HBW:   '#AF52DE',
    Crane: '#30D158',
    MS:    '#007AFF',
    PM:    '#FF453A',
    SL:    '#FF9F0A',
    State: '#888888'
};

const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

const STATION_NAMES = {
    HBW:   'High-Bay Warehouse',
    Crane: 'Vacuum Gripper Crane',
    MS:    'Machining Station',
    PM:    'Punching Machine',
    SL:    'Sorting Line',
    State: 'System State'
};

const POLL_INTERVAL = 400;   // ms
const MAX_EVENTS    = 60;    // max events in log

// Flow connection IDs between stations
const FLOW_IDS = {
    'HBW-Crane': 'flow-hbw-crane',
    'Crane-MS':  'flow-crane-ms',
    'MS-PM':     'flow-ms-pm',
    'Crane-SL':  'flow-crane-sl',
    'SL-HBW':    'flow-sl-hbw'
};

// ============================================================
//  STATE
// ============================================================

let previousData    = null;    // previous poll's full data (for diff)
let latestData      = null;    // most recent poll data
let selectedStation = null;    // currently selected station in panel
let activeTab       = 'variables';
let eventLog        = [];      // array of event objects
let eventCounter    = 0;
let pollCount       = 0;
let lastPollMs      = 0;       // time of last successful poll
let lastPollLatency = 0;       // latency of last poll in ms

// Timing tracker: { station: { activeSince, lastCycleStart, lastCycleTime, totalActive } }
let stationTimers = {};
for (const s of STATION_ORDER) {
    stationTimers[s] = {
        activeSince: null,
        lastCycleStart: null,
        lastCycleTime: null,
        totalActive: 0,
        wasActive: false
    };
}

// Workpiece tracker: which station currently has the workpiece
let workpieceStation = null;
let workpiecePastStations = new Set();

// Crane arm angle for schematic
let craneAngle = 0;

// ============================================================
//  THEME
// ============================================================

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

// ============================================================
//  DATA FETCHING
// ============================================================

async function fetchData() {
    const t0 = performance.now();
    try {
        const resp = await fetch('/api/data');
        if (!resp.ok) return null;
        const json = await resp.json();
        lastPollLatency = Math.round(performance.now() - t0);
        lastPollMs = Date.now();
        pollCount++;
        return json;
    } catch (e) {
        return null;
    }
}

// ============================================================
//  HELPERS
// ============================================================

function isOn(stationData, group, label) {
    const val = stationData?.[group]?.[label];
    return val === true || val === 'True';
}

function hasActiveActuator(stationData) {
    const acts = stationData?.actuators;
    if (!acts) return false;
    for (const key in acts) {
        if (acts[key] === true || acts[key] === 'True') return true;
    }
    return false;
}

function countActive(obj) {
    if (!obj) return 0;
    let c = 0;
    for (const k in obj) {
        if (obj[k] === true || obj[k] === 'True') c++;
    }
    return c;
}

function totalVars(obj) {
    if (!obj) return 0;
    return Object.keys(obj).length;
}

function formatTime(date) {
    return date.toLocaleTimeString('en-GB', { hour12: false });
}

// ============================================================
//  DIFF ENGINE — detect what changed between polls
// ============================================================

function diffData(prev, curr) {
    const changes = [];
    if (!prev || !curr) return changes;

    for (const station in curr) {
        const prevStation = prev[station] || {};
        const currStation = curr[station];

        for (const group in currStation) {
            const prevGroup = prevStation[group] || {};
            const currGroup = currStation[group];

            for (const label in currGroup) {
                const prevVal = prevGroup[label];
                const currVal = currGroup[label];

                if (prevVal !== currVal && prevVal !== undefined) {
                    changes.push({
                        station,
                        group,
                        label,
                        oldVal: prevVal,
                        newVal: currVal,
                        time: new Date()
                    });
                }
            }
        }
    }
    return changes;
}

// ============================================================
//  EVENT LOG
// ============================================================

function addEvents(changes) {
    for (const c of changes) {
        eventCounter++;
        eventLog.unshift({
            id: eventCounter,
            time: c.time,
            station: c.station,
            group: c.group,
            label: c.label,
            oldVal: c.oldVal,
            newVal: c.newVal
        });
    }

    // Trim
    if (eventLog.length > MAX_EVENTS) {
        eventLog.length = MAX_EVENTS;
    }

    renderEventLog();
}

function renderEventLog() {
    const body = document.getElementById('event-log-body');
    const countEl = document.getElementById('event-count');
    if (!body) return;

    if (eventLog.length === 0) {
        body.innerHTML = '<div class="event-log-empty mono">Waiting for state changes...</div>';
        if (countEl) countEl.textContent = '0 events';
        return;
    }

    if (countEl) countEl.textContent = eventCounter + ' events';

    // Only render visible portion (max 30 shown)
    const visible = eventLog.slice(0, 30);
    let html = '';
    for (const ev of visible) {
        const timeStr = formatTime(ev.time);
        const stationClass = 'station-c-' + ev.station;

        let valHtml = '';
        if (typeof ev.newVal === 'boolean') {
            valHtml = ev.newVal
                ? '<span class="event-val on">ON</span>'
                : '<span class="event-val off">OFF</span>';
        } else {
            valHtml = '<span class="event-val int">' + ev.newVal + '</span>';
        }

        html += '<div class="event-row">'
            + '<span class="event-time">' + timeStr + '</span>'
            + '<span class="event-station ' + stationClass + '">' + ev.station + '</span>'
            + '<span class="event-detail">' + escHtml(ev.label) + '</span>'
            + valHtml
            + '</div>';
    }
    body.innerHTML = html;
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================================
//  WORKPIECE TRACKER
// ============================================================

function updateWorkpieceTracker(data) {
    if (!data) return;

    // Find which station currently has active actuators
    // Progression: HBW -> Crane -> MS -> PM -> SL
    let activeStation = null;
    for (const s of STATION_ORDER) {
        if (data[s] && hasActiveActuator(data[s])) {
            activeStation = s;
        }
    }

    // Use forward-only heuristic: only advance, never go back
    if (activeStation) {
        const newIdx = STATION_ORDER.indexOf(activeStation);
        const curIdx = workpieceStation ? STATION_ORDER.indexOf(workpieceStation) : -1;

        if (newIdx >= curIdx) {
            // Mark all stations up to current as "past"
            if (workpieceStation) {
                for (let i = 0; i <= curIdx; i++) {
                    workpiecePastStations.add(STATION_ORDER[i]);
                }
            }
            workpieceStation = activeStation;
        }
    }

    // If SL sorting valves fire, the workpiece is done -> reset for next cycle
    if (data.SL) {
        const sl = data.SL;
        if (isOn(sl, 'actuators', 'Valve White') ||
            isOn(sl, 'actuators', 'Valve Red') ||
            isOn(sl, 'actuators', 'Valve Blue') ||
            isOn(sl, 'actuators', 'Cylinder White') ||
            isOn(sl, 'actuators', 'Cylinder Red') ||
            isOn(sl, 'actuators', 'Cylinder Blue')) {
            // Will reset on next HBW activation
        }
    }

    // If HBW activates and workpiece was at SL (or completed), reset
    if (activeStation === 'HBW' && workpiecePastStations.has('SL')) {
        workpiecePastStations.clear();
        workpieceStation = 'HBW';
    }

    // Update DOM
    for (let i = 0; i < STATION_ORDER.length; i++) {
        const s = STATION_ORDER[i];
        const node = document.getElementById('tracker-' + s);
        if (!node) continue;

        node.classList.remove('active', 'past');

        if (s === workpieceStation) {
            node.classList.add('active');
        } else if (workpiecePastStations.has(s)) {
            node.classList.add('past');
        }
    }

    // Connectors
    const wpIdx = workpieceStation ? STATION_ORDER.indexOf(workpieceStation) : -1;
    for (let i = 0; i < 4; i++) {
        const conn = document.getElementById('tconn-' + i);
        if (!conn) continue;
        if (i < wpIdx) {
            conn.classList.add('passed');
        } else {
            conn.classList.remove('passed');
        }
    }

    // Tracker timing
    const timingEl = document.getElementById('tracker-timing');
    if (timingEl && workpieceStation) {
        const timer = stationTimers[workpieceStation];
        if (timer && timer.activeSince) {
            const elapsed = ((Date.now() - timer.activeSince) / 1000).toFixed(1);
            timingEl.textContent = workpieceStation + ' active ' + elapsed + 's';
        } else {
            timingEl.textContent = workpieceStation + ' idle';
        }
    }
}

// ============================================================
//  STATION TIMERS
// ============================================================

function updateStationTimers(data) {
    const now = Date.now();

    for (const s of STATION_ORDER) {
        const sd = data?.[s];
        const active = sd ? hasActiveActuator(sd) : false;
        const timer = stationTimers[s];

        if (active && !timer.wasActive) {
            // Rising edge: station just became active
            timer.activeSince = now;
            timer.lastCycleStart = now;
        } else if (!active && timer.wasActive) {
            // Falling edge: station just went idle
            if (timer.lastCycleStart) {
                timer.lastCycleTime = (now - timer.lastCycleStart) / 1000;
            }
            timer.activeSince = null;
        }

        timer.wasActive = active;
    }
}

// ============================================================
//  SCHEMATIC UPDATES
// ============================================================

function updateSchematic(data) {
    if (!data) return;

    for (const s of STATION_ORDER) {
        const sd = data[s];
        const active = sd ? hasActiveActuator(sd) : false;

        // LED
        const led = document.getElementById('sch-led-' + s);
        if (led) {
            if (active) {
                led.classList.add('on');
            } else {
                led.classList.remove('on');
            }
        }

        // Station group class
        const group = document.getElementById('sch-' + s);
        if (group) {
            if (active) {
                group.classList.add('active');
            } else {
                group.classList.remove('active');
            }
        }
    }

    // Flow connections
    for (const key in FLOW_IDS) {
        const el = document.getElementById(FLOW_IDS[key]);
        if (!el) continue;
        const [from, to] = key.split('-');
        const fromActive = data[from] ? hasActiveActuator(data[from]) : false;
        const toActive = data[to] ? hasActiveActuator(data[to]) : false;
        if (fromActive || toActive) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    }

    // Oven glow
    const ovenGlow = document.getElementById('sch-oven-glow');
    if (ovenGlow && data.MS) {
        const lampOn = isOn(data.MS, 'actuators', 'Lamp') ||
                       isOn(data.MS, 'actuators', 'Oven Lamp (Burn)') ||
                       isOn(data.MS, 'actuators', 'Lamp Oven');
        ovenGlow.setAttribute('fill-opacity', lampOn ? '0.35' : '0');
    }

    // Punch tip
    const punchTip = document.getElementById('sch-punch-tip');
    if (punchTip && data.PM) {
        const down = isOn(data.PM, 'actuators', 'Motor Tool Downward') ||
                     isOn(data.PM, 'actuators', 'Tool Down');
        punchTip.setAttribute('y', down ? '93' : '89');
        punchTip.setAttribute('fill-opacity', down ? '0.6' : '0.3');
    }

    // Crane arm rotation
    const arm = document.getElementById('sch-crane-arm');
    if (arm && data.Crane) {
        const active = hasActiveActuator(data.Crane);
        if (active) {
            const cw = isOn(data.Crane, 'actuators', 'Motor Clockwise') ||
                       isOn(data.Crane, 'actuators', 'Motor CW');
            const ccw = isOn(data.Crane, 'actuators', 'Motor Counterclockwise') ||
                        isOn(data.Crane, 'actuators', 'Motor CCW');
            if (cw) craneAngle = (craneAngle + 3) % 360;
            else if (ccw) craneAngle = (craneAngle - 3 + 360) % 360;
            else craneAngle = (craneAngle + 1.5) % 360;
        }
        const rad = (craneAngle * Math.PI) / 180;
        const cx = 370, cy = 225, len = 24;
        const ex = cx + Math.sin(rad) * len;
        const ey = cy - Math.cos(rad) * len;
        arm.setAttribute('x2', ex.toFixed(1));
        arm.setAttribute('y2', ey.toFixed(1));
    }

    // Color sensor value
    const colorValEl = document.getElementById('sch-color-val');
    if (colorValEl && data.SL && data.SL.sensors) {
        const cv = data.SL.sensors['Color Sensor'];
        if (typeof cv === 'number' && cv > 0) {
            colorValEl.textContent = cv;
            if (cv >= 250) colorValEl.setAttribute('fill', '#e8e8e8');
            else if (cv >= 130) colorValEl.setAttribute('fill', '#FF453A');
            else if (cv >= 40) colorValEl.setAttribute('fill', '#007AFF');
            else colorValEl.setAttribute('fill', 'var(--text-tertiary)');
        } else {
            colorValEl.textContent = '--';
            colorValEl.setAttribute('fill', 'var(--text-tertiary)');
        }
    }
}

// ============================================================
//  SCHEMATIC CLICK HANDLING
// ============================================================

function setupSchematicClicks() {
    const stations = document.querySelectorAll('.station-schematic');
    stations.forEach(el => {
        el.addEventListener('click', () => {
            const s = el.getAttribute('data-station');
            selectStation(s);
        });
    });

    // Also allow clicking tracker nodes
    const trackerNodes = document.querySelectorAll('.tracker-node');
    trackerNodes.forEach(el => {
        el.addEventListener('click', () => {
            const s = el.getAttribute('data-station');
            selectStation(s);
        });
    });
}

function selectStation(station) {
    selectedStation = station;

    // Update SVG selection ring
    const ring = document.getElementById('selection-ring');
    const schGroup = document.getElementById('sch-' + station);

    // Remove selected class from all
    document.querySelectorAll('.station-schematic').forEach(el => el.classList.remove('selected'));

    if (schGroup) {
        schGroup.classList.add('selected');

        // Position selection ring around the station box
        const box = schGroup.querySelector('.sch-station-box');
        if (box && ring) {
            const x = parseFloat(box.getAttribute('x')) - 3;
            const y = parseFloat(box.getAttribute('y')) - 3;
            const w = parseFloat(box.getAttribute('width')) + 6;
            const h = parseFloat(box.getAttribute('height')) + 6;
            ring.setAttribute('x', x);
            ring.setAttribute('y', y);
            ring.setAttribute('width', w);
            ring.setAttribute('height', h);
            ring.setAttribute('visibility', 'visible');
            ring.setAttribute('stroke', STATION_COLORS[station] || 'var(--blue)');
        }
    }

    // Switch to variables tab
    switchTab('variables');

    // Update panel header
    const label = document.getElementById('dp-station-label');
    const dot = document.getElementById('dp-station-dot');
    if (label) label.textContent = station + ' — ' + (STATION_NAMES[station] || '');
    if (dot) dot.style.background = STATION_COLORS[station] || 'var(--text-tertiary)';

    // Render variables
    renderStationVariables();
}

// ============================================================
//  TABS
// ============================================================

function switchTab(tab) {
    activeTab = tab;

    // Update tab buttons
    document.querySelectorAll('.dp-tab').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-tab') === tab);
    });

    // Update tab bodies
    document.querySelectorAll('.dp-tab-body').forEach(el => {
        el.classList.toggle('active', el.id === 'tab-' + tab);
    });

    // Render tab content
    if (tab === 'timing') renderTimingTab();
    if (tab === 'all') renderAllStationsTab();
    if (tab === 'variables') renderStationVariables();
}

// ============================================================
//  VARIABLES PANEL
// ============================================================

function renderStationVariables() {
    const placeholder = document.getElementById('dp-placeholder');
    const actSection = document.getElementById('dp-actuators-section');
    const senSection = document.getElementById('dp-sensors-section');
    const stateSection = document.getElementById('dp-state-section');

    if (!selectedStation || !latestData?.data) {
        if (placeholder) placeholder.style.display = '';
        if (actSection) actSection.style.display = 'none';
        if (senSection) senSection.style.display = 'none';
        if (stateSection) stateSection.style.display = 'none';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';

    const sd = latestData.data[selectedStation] || {};
    const actuators = sd.actuators || {};
    const sensors = sd.sensors || {};
    const state = sd.state || {};

    // Previous data for change detection
    const prevSd = previousData?.[selectedStation] || {};
    const prevActuators = prevSd.actuators || {};
    const prevSensors = prevSd.sensors || {};

    // Status
    const statusEl = document.getElementById('dp-status');
    const isActive = hasActiveActuator(sd);
    if (statusEl) {
        statusEl.textContent = isActive ? 'ACTIVE' : 'IDLE';
        statusEl.className = 'dp-status ' + (isActive ? 'active' : 'idle');
    }

    // Actuators
    if (Object.keys(actuators).length > 0) {
        if (actSection) actSection.style.display = '';
        const list = document.getElementById('dp-actuators-list');
        const countEl = document.getElementById('dp-act-count');
        const activeCount = countActive(actuators);
        if (countEl) countEl.textContent = activeCount + ' / ' + totalVars(actuators);
        if (list) list.innerHTML = renderVarRows(actuators, prevActuators, 'bool');
    } else {
        if (actSection) actSection.style.display = 'none';
    }

    // Sensors
    if (Object.keys(sensors).length > 0) {
        if (senSection) senSection.style.display = '';
        const list = document.getElementById('dp-sensors-list');
        const countEl = document.getElementById('dp-sen-count');
        const activeCount = countActive(sensors);
        if (countEl) countEl.textContent = activeCount + ' / ' + totalVars(sensors);
        if (list) list.innerHTML = renderVarRows(sensors, prevSensors, 'mixed');
    } else {
        if (senSection) senSection.style.display = 'none';
    }

    // State
    if (Object.keys(state).length > 0) {
        if (stateSection) stateSection.style.display = '';
        const list = document.getElementById('dp-state-list');
        const prevState = prevSd.state || {};
        if (list) list.innerHTML = renderVarRows(state, prevState, 'mixed');
    } else {
        if (stateSection) stateSection.style.display = 'none';
    }
}

function renderVarRows(vars, prevVars, type) {
    let html = '';
    // Sort: active first, then alphabetical
    const keys = Object.keys(vars).sort((a, b) => {
        const aOn = vars[a] === true || vars[a] === 'True';
        const bOn = vars[b] === true || vars[b] === 'True';
        if (aOn && !bOn) return -1;
        if (!aOn && bOn) return 1;
        return a.localeCompare(b);
    });

    for (const key of keys) {
        const val = vars[key];
        const prevVal = prevVars[key];
        const changed = prevVal !== undefined && prevVal !== val;
        const isBool = typeof val === 'boolean';
        const on = val === true || val === 'True';

        let dotClass, valText, valClass, rowClass;

        if (isBool) {
            dotClass = on ? 'var-dot on' : 'var-dot off';
            valText = on ? 'ON' : 'OFF';
            valClass = on ? 'var-value on' : 'var-value';
            rowClass = on ? 'var-row on' : 'var-row';
        } else {
            dotClass = 'var-dot off';
            valText = String(val);
            valClass = 'var-value int-val';
            rowClass = 'var-row';
        }

        if (changed) rowClass += ' just-changed';

        html += '<div class="' + rowClass + '">'
            + '<span class="' + dotClass + '"></span>'
            + '<span class="var-name">' + escHtml(key) + '</span>'
            + '<span class="' + valClass + '">' + escHtml(valText) + '</span>'
            + '</div>';
    }
    return html;
}

// ============================================================
//  TIMING TAB
// ============================================================

function renderTimingTab() {
    const grid = document.getElementById('timing-grid');
    if (!grid) return;

    let html = '';
    for (const s of STATION_ORDER) {
        const timer = stationTimers[s];
        const color = STATION_COLORS[s];
        const active = timer.wasActive;

        let activeDuration = '--';
        if (timer.activeSince) {
            activeDuration = ((Date.now() - timer.activeSince) / 1000).toFixed(1) + 's';
        }

        let lastCycle = timer.lastCycleTime !== null
            ? timer.lastCycleTime.toFixed(1) + 's'
            : '--';

        // Count current actuators
        const sd = latestData?.data?.[s];
        const actCount = sd ? countActive(sd.actuators) : 0;
        const senCount = sd ? countActive(sd.sensors) : 0;

        html += '<div class="timing-card">'
            + '<div class="timing-card-header">'
            + '<span class="timing-station" style="color:' + color + '">' + s + '</span>'
            + '<span class="timing-status ' + (active ? 'active' : 'idle') + '">'
            + (active ? 'Active' : 'Idle') + '</span>'
            + '</div>'
            + '<div class="timing-rows">'
            + '<div class="timing-row"><span class="timing-label">Active since</span><span class="timing-val">' + activeDuration + '</span></div>'
            + '<div class="timing-row"><span class="timing-label">Last cycle</span><span class="timing-val">' + lastCycle + '</span></div>'
            + '<div class="timing-row"><span class="timing-label">Actuators ON</span><span class="timing-val">' + actCount + '</span></div>'
            + '<div class="timing-row"><span class="timing-label">Sensors TRUE</span><span class="timing-val">' + senCount + '</span></div>'
            + '</div>'
            + '</div>';
    }
    grid.innerHTML = html;
}

// ============================================================
//  ALL STATIONS TAB
// ============================================================

function renderAllStationsTab() {
    const grid = document.getElementById('all-stations-grid');
    if (!grid) return;

    const allStations = [...STATION_ORDER];
    // Add State if present
    if (latestData?.data?.State) {
        allStations.push('State');
    }

    let html = '';
    for (const s of allStations) {
        const sd = latestData?.data?.[s];
        const color = STATION_COLORS[s] || '#888';
        const active = sd ? hasActiveActuator(sd) : false;
        const actCount = sd ? countActive(sd.actuators) : 0;
        const actTotal = sd ? totalVars(sd.actuators) : 0;
        const senCount = sd ? countActive(sd.sensors) : 0;
        const senTotal = sd ? totalVars(sd.sensors) : 0;

        html += '<div class="all-station-row" onclick="selectStation(\'' + s + '\')">'
            + '<div class="all-station-dot" style="background:' + color + ';opacity:' + (active ? '1' : '0.3') + '"></div>'
            + '<span class="all-station-name" style="color:' + color + '">' + s + '</span>'
            + '<span class="all-station-fullname">' + (STATION_NAMES[s] || '') + '</span>'
            + '<div class="all-station-stats">'
            + '<span class="all-station-stat"><span class="count">' + actCount + '/' + actTotal + '</span><span class="label">act</span></span>'
            + '<span class="all-station-stat"><span class="count">' + senCount + '/' + senTotal + '</span><span class="label">sen</span></span>'
            + '</div>'
            + '</div>';
    }
    grid.innerHTML = html;
}

// ============================================================
//  POLL INDICATOR
// ============================================================

function updatePollIndicator() {
    const dot = document.getElementById('poll-dot');
    const text = document.getElementById('poll-text');
    if (!dot || !text) return;

    if (lastPollMs === 0) {
        text.textContent = 'Connecting...';
        return;
    }

    dot.classList.add('active');

    const ago = ((Date.now() - lastPollMs) / 1000).toFixed(1);
    text.textContent = 'Polling ' + POLL_INTERVAL + 'ms \u00B7 ' + lastPollLatency + 'ms \u00B7 ' + ago + 's ago';

    // Flash on poll
    dot.classList.remove('pulse');
    void dot.offsetWidth;
    dot.classList.add('pulse');
}

// ============================================================
//  MAIN UPDATE
// ============================================================

async function update() {
    const result = await fetchData();
    if (!result || !result.data) return;

    const data = result.data;

    // Diff against previous
    if (previousData) {
        const changes = diffData(previousData, data);
        if (changes.length > 0) {
            addEvents(changes);
        }
    }

    // Store
    previousData = latestData ? latestData.data : null;
    latestData = result;

    // Update all components
    updateSchematic(data);
    updateStationTimers(data);
    updateWorkpieceTracker(data);
    updatePollIndicator();

    // Refresh selected station panel if on variables tab
    if (activeTab === 'variables') {
        renderStationVariables();
    } else if (activeTab === 'timing') {
        renderTimingTab();
    } else if (activeTab === 'all') {
        renderAllStationsTab();
    }
}

// ============================================================
//  ANIMATION LOOP (for smooth crane arm)
// ============================================================

function animationLoop() {
    // Smooth crane arm
    if (latestData?.data?.Crane) {
        const crane = latestData.data.Crane;
        if (hasActiveActuator(crane)) {
            const arm = document.getElementById('sch-crane-arm');
            if (arm) {
                const rad = (craneAngle * Math.PI) / 180;
                const cx = 370, cy = 225, len = 24;
                const ex = cx + Math.sin(rad) * len;
                const ey = cy - Math.cos(rad) * len;
                arm.setAttribute('x2', ex.toFixed(1));
                arm.setAttribute('y2', ey.toFixed(1));
            }
        }
    }

    // Update timing display for active station
    if (activeTab === 'timing') {
        // Only update active durations, not full re-render
        const cards = document.querySelectorAll('.timing-card');
        cards.forEach((card, i) => {
            if (i < STATION_ORDER.length) {
                const timer = stationTimers[STATION_ORDER[i]];
                if (timer.activeSince) {
                    const valEls = card.querySelectorAll('.timing-val');
                    if (valEls[0]) {
                        valEls[0].textContent = ((Date.now() - timer.activeSince) / 1000).toFixed(1) + 's';
                    }
                }
            }
        });
    }

    // Update tracker timing
    const timingEl = document.getElementById('tracker-timing');
    if (timingEl && workpieceStation) {
        const timer = stationTimers[workpieceStation];
        if (timer && timer.activeSince) {
            const elapsed = ((Date.now() - timer.activeSince) / 1000).toFixed(1);
            timingEl.textContent = workpieceStation + ' active ' + elapsed + 's';
        }
    }

    requestAnimationFrame(animationLoop);
}

// ============================================================
//  INITIALIZATION
// ============================================================

function init() {
    setupSchematicClicks();

    // Start animation loop
    requestAnimationFrame(animationLoop);

    // Start polling
    update();
    setInterval(update, POLL_INTERVAL);

    // Poll indicator refresh
    setInterval(updatePollIndicator, 200);

    // Auto-select HBW to show something useful immediately
    setTimeout(() => {
        if (!selectedStation) {
            selectStation('HBW');
        }
    }, 600);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

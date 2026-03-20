/* ============================================
   SCADA V1 — Minimal Industrial Control Room
   Pure status. No decoration.
   ============================================ */

// ============================================================
//  CONSTANTS
// ============================================================

const POLL_MS = 400;
const STATIONS = ['HBW', 'Crane', 'MS', 'PM', 'SL'];
const STN_KEYS = { HBW: 'hbw', Crane: 'crane', MS: 'ms', PM: 'pm', SL: 'sl' };

// SVG workpiece waypoints (matching the SCADA factory layout)
const WP = {
    hbw_rack:           { x: 100, y: 260 },
    hbw_conv_start:     { x: 165, y: 315 },
    hbw_conv_end:       { x: 205, y: 315 },
    crane_pickup:       { x: 340, y: 285 },
    crane_center:       { x: 370, y: 285 },
    crane_place:        { x: 420, y: 275 },
    ms_conv:            { x: 465, y: 94  },
    ms_turntable:       { x: 520, y: 94  },
    ms_oven:            { x: 585, y: 135 },
    ms_saw:             { x: 505, y: 151 },
    ms_eject:           { x: 465, y: 151 },
    pm_entry:           { x: 680, y: 124 },
    pm_tool:            { x: 708, y: 124 },
    pm_exit:            { x: 735, y: 124 },
    sl_entry:           { x: 460, y: 393 },
    sl_sensor:          { x: 505, y: 393 },
    sl_white:           { x: 557, y: 383 },
    sl_red:             { x: 557, y: 405 },
    sl_blue:            { x: 557, y: 427 }
};

// Connection line element IDs for each transition
const CONNS = {
    'HBW-Crane':  'conn-hbw-crane',
    'Crane-MS':   'conn-crane-ms',
    'MS-PM':      'conn-ms-pm',
    'Crane-SL':   'conn-crane-sl',
    'SL-HBW':     'conn-sl-hbw'
};

// ============================================================
//  STATE
// ============================================================

let lastFetch = 0;
let latestData = null;
let prevVarValues = {};          // for flash-on-change
let craneAngle = 0;
let stationTimers = {};          // { station: { start: timestamp, elapsed: 0 } }
let lastCycleTime = null;
let wpStation = null;            // current station the workpiece is at
let wpVisible = false;
let wpCurrentPos = { x: 0, y: 0 };
let wpTargetPos = { x: 0, y: 0 };
let wpColor = '#555';
let colorDetected = null;        // { name, css, value }
let visitedStations = new Set();

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
    for (const k in acts) {
        if (acts[k] === true || acts[k] === 'True') return true;
    }
    return false;
}

function stationIndex(s) {
    return STATIONS.indexOf(s);
}

// ============================================================
//  CLOCK
// ============================================================

function updateClock() {
    const el = document.getElementById('scada-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
}

// ============================================================
//  STALENESS & CONNECTION INDICATOR
// ============================================================

function updateStaleness() {
    const el = document.getElementById('scada-update');
    const conn = document.getElementById('scada-conn');
    if (!el) return;

    if (lastFetch === 0) {
        el.textContent = 'LAST UPDATE: --';
        el.classList.remove('stale');
        if (conn) {
            conn.textContent = 'DISCONNECTED';
            conn.className = 'scada-conn disconnected';
        }
        return;
    }

    const ago = ((Date.now() - lastFetch) / 1000).toFixed(1);
    el.textContent = 'LAST UPDATE: ' + ago + 's AGO';

    if (parseFloat(ago) > 5) {
        el.classList.add('stale');
        if (conn) {
            conn.textContent = 'STALE';
            conn.className = 'scada-conn disconnected';
        }
    } else {
        el.classList.remove('stale');
        if (conn) {
            conn.textContent = 'CONNECTED';
            conn.className = 'scada-conn connected';
        }
    }
}

// ============================================================
//  STATION STATUS
// ============================================================

function deriveStates(data) {
    const states = {};
    if (!data?.data) return states;

    for (const stn of STATIONS) {
        const sd = data.data[stn];
        if (!sd) {
            states[stn] = { active: false, actCount: 0 };
            continue;
        }
        const acts = sd.actuators || {};
        let count = 0;
        for (const k in acts) {
            if (acts[k] === true || acts[k] === 'True') count++;
        }
        states[stn] = { active: count > 0, actCount: count };
    }
    return states;
}

function updateStationStatus(states) {
    for (const stn of STATIONS) {
        const key = STN_KEYS[stn];
        const ind = document.getElementById('ind-' + key);
        const stateEl = document.getElementById('state-' + key);
        const timeEl = document.getElementById('time-' + key);
        const stnRect = document.querySelector('#station-' + key + ' .stn-rect');
        const stnStatusDot = document.getElementById('stn-status-' + key);

        const s = states[stn];
        const active = s && s.active;

        // Sidebar indicator
        if (ind) {
            ind.className = 'status-indicator' + (active ? ' active' : '');
        }
        if (stateEl) {
            stateEl.textContent = active ? 'RUN' : 'IDLE';
            stateEl.className = 'status-state' + (active ? ' active' : '');
        }

        // SVG station rect
        if (stnRect) {
            stnRect.classList.toggle('active', active);
        }

        // SVG status dot
        if (stnStatusDot) {
            stnStatusDot.setAttribute('fill', active ? '#00ff41' : '#333');
        }

        // Timer
        if (active) {
            if (!stationTimers[stn]) {
                stationTimers[stn] = { start: Date.now(), elapsed: 0 };
            }
            stationTimers[stn].elapsed = (Date.now() - stationTimers[stn].start) / 1000;
        } else {
            if (stationTimers[stn] && stationTimers[stn].elapsed > 0.5) {
                lastCycleTime = {
                    station: stn,
                    time: stationTimers[stn].elapsed
                };
            }
            stationTimers[stn] = null;
        }

        if (timeEl) {
            if (stationTimers[stn]) {
                timeEl.textContent = stationTimers[stn].elapsed.toFixed(1) + 's';
            } else {
                timeEl.textContent = '--';
            }
        }
    }
}

// ============================================================
//  CYCLE TIMING DISPLAY
// ============================================================

function updateCycleDisplay(states) {
    const activeEl = document.getElementById('cycle-active');
    const currentEl = document.getElementById('cycle-current');
    const lastEl = document.getElementById('cycle-last');
    const progressEl = document.getElementById('cycle-progress');

    // Find active station
    let activeStn = null;
    let activeTime = 0;
    for (const stn of STATIONS) {
        if (states[stn] && states[stn].active) {
            activeStn = stn;
            if (stationTimers[stn]) {
                activeTime = stationTimers[stn].elapsed;
            }
            break;
        }
    }

    if (activeEl) activeEl.textContent = activeStn || '--';
    if (currentEl) currentEl.textContent = activeStn ? activeTime.toFixed(1) + 's' : '0.0s';

    if (lastEl && lastCycleTime) {
        lastEl.textContent = lastCycleTime.station + ' ' + lastCycleTime.time.toFixed(1) + 's';
    }

    // Progress from API
    if (progressEl && latestData && latestData.progress !== undefined) {
        progressEl.textContent = Math.round(latestData.progress * 100) + '%';
    }
}

// ============================================================
//  CONNECTION PATHS
// ============================================================

function updateConnections() {
    // Reset all
    for (const key in CONNS) {
        const el = document.getElementById(CONNS[key]);
        if (el) el.classList.remove('active');
    }

    if (!wpStation) return;

    // Activate relevant connections
    const adj = {
        HBW:   ['HBW-Crane'],
        Crane: ['HBW-Crane', 'Crane-MS', 'Crane-SL'],
        MS:    ['Crane-MS', 'MS-PM'],
        PM:    ['MS-PM'],
        SL:    ['Crane-SL', 'SL-HBW']
    };

    const conns = adj[wpStation] || [];
    for (const c of conns) {
        const el = document.getElementById(CONNS[c]);
        if (el) el.classList.add('active');
    }
}

// ============================================================
//  WORKPIECE WAYPOINT DETECTION (reuse from twin/app.js logic)
// ============================================================

function detectWaypoint(data) {
    if (!data) return null;

    // Check stations in order
    const hbw = data.HBW || {};
    const crane = data.Crane || {};
    const ms = data.MS || {};
    const pm = data.PM || {};
    const sl = data.SL || {};

    // SL
    if (isOn(sl, 'actuators', 'Valve Blue'))  return { station: 'SL', wp: 'sl_blue' };
    if (isOn(sl, 'actuators', 'Valve Red'))   return { station: 'SL', wp: 'sl_red' };
    if (isOn(sl, 'actuators', 'Valve White')) return { station: 'SL', wp: 'sl_white' };
    if (isOn(sl, 'actuators', 'Motor Conveyor Belt')) {
        if (!isOn(sl, 'sensors', 'Light Barrier After Color'))  return { station: 'SL', wp: 'sl_sensor' };
        if (!isOn(sl, 'sensors', 'Light Barrier Before Color')) return { station: 'SL', wp: 'sl_sensor' };
        return { station: 'SL', wp: 'sl_entry' };
    }
    if (isOn(sl, 'actuators', 'Compressor')) return { station: 'SL', wp: 'sl_entry' };

    // PM
    if (isOn(pm, 'actuators', 'Motor Tool Downward') || isOn(pm, 'actuators', 'Motor Tool Upward'))
        return { station: 'PM', wp: 'pm_tool' };
    if (isOn(pm, 'actuators', 'Motor Conveyor Belt Forward')) {
        if (!isOn(pm, 'sensors', 'Light Barrier Tool')) return { station: 'PM', wp: 'pm_tool' };
        return { station: 'PM', wp: 'pm_entry' };
    }
    if (hasActiveActuator(pm)) return { station: 'PM', wp: 'pm_entry' };

    // MS
    if (isOn(ms, 'actuators', 'Valve Ejector')) return { station: 'MS', wp: 'ms_eject' };
    if (isOn(ms, 'actuators', 'Motor Saw'))     return { station: 'MS', wp: 'ms_saw' };
    if (isOn(ms, 'sensors', 'Ref Switch Turntable @ Saw') && hasActiveActuator(ms))
        return { station: 'MS', wp: 'ms_saw' };
    if (isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Turntable')) return { station: 'MS', wp: 'ms_oven' };
    if (isOn(ms, 'actuators', 'Lamp')) return { station: 'MS', wp: 'ms_oven' };
    if (isOn(ms, 'actuators', 'Motor Oven Slider Move In') || isOn(ms, 'actuators', 'Valve Ovendoor'))
        return { station: 'MS', wp: 'ms_oven' };
    if (isOn(ms, 'actuators', 'Motor Oven Slider Move Out'))     return { station: 'MS', wp: 'ms_oven' };
    if (isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Oven')) return { station: 'MS', wp: 'ms_turntable' };
    if (isOn(ms, 'sensors', 'Ref Switch Turntable @ Transfer Unit') && hasActiveActuator(ms))
        return { station: 'MS', wp: 'ms_turntable' };
    if (isOn(ms, 'actuators', 'Motor Turntable Clockwise') || isOn(ms, 'actuators', 'Motor Turntable Counterclockwise'))
        return { station: 'MS', wp: 'ms_turntable' };
    if (isOn(ms, 'actuators', 'Motor Conveyor Belt Forward')) return { station: 'MS', wp: 'ms_conv' };
    if (isOn(ms, 'actuators', 'Valve Vacuum') || isOn(ms, 'actuators', 'Valve Transfer Unit'))
        return { station: 'MS', wp: 'ms_turntable' };
    if (isOn(ms, 'actuators', 'Compressor')) return { station: 'MS', wp: 'ms_turntable' };

    // Crane
    if (isOn(crane, 'actuators', 'Motor Counterclockwise') ||
        (isOn(crane, 'actuators', 'Motor Forward') && !isOn(crane, 'actuators', 'Motor Clockwise')))
        return { station: 'Crane', wp: 'crane_place' };
    if (isOn(crane, 'actuators', 'Valve') || isOn(crane, 'actuators', 'Motor Downward') || isOn(crane, 'actuators', 'Motor Upward'))
        return { station: 'Crane', wp: 'crane_center' };
    if (isOn(crane, 'actuators', 'Motor Clockwise') || isOn(crane, 'actuators', 'Compressor'))
        return { station: 'Crane', wp: 'crane_pickup' };
    if (isOn(crane, 'actuators', 'Motor Backward')) return { station: 'Crane', wp: 'crane_center' };

    // HBW
    if (isOn(hbw, 'actuators', 'Motor Conveyor Belt Forward')) return { station: 'HBW', wp: 'hbw_conv_start' };
    if (isOn(hbw, 'actuators', 'Motor Cantilever Forward') || isOn(hbw, 'actuators', 'Motor Cantilever Backward'))
        return { station: 'HBW', wp: 'hbw_rack' };
    if (isOn(hbw, 'actuators', 'Motor Stacker Crane \u2192 Rack') ||
        isOn(hbw, 'actuators', 'Motor Stacker Crane Downward') ||
        isOn(hbw, 'actuators', 'Motor Stacker Crane Upward') ||
        isOn(hbw, 'actuators', 'Motor Stacker Crane \u2192 Conv Belt'))
        return { station: 'HBW', wp: 'hbw_rack' };

    return null;
}

// ============================================================
//  WORKPIECE UPDATE
// ============================================================

function updateWorkpiece(data) {
    const allData = data?.data;
    if (!allData) return;

    const detected = detectWaypoint(allData);

    if (detected && WP[detected.wp]) {
        const pos = WP[detected.wp];
        wpTargetPos.x = pos.x;
        wpTargetPos.y = pos.y;
        wpStation = detected.station;
        visitedStations.add(detected.station);

        if (!wpVisible) {
            wpCurrentPos.x = pos.x;
            wpCurrentPos.y = pos.y;
            wpVisible = true;
            const dot = document.getElementById('wp-dot');
            if (dot) dot.setAttribute('visibility', 'visible');
        }
    }

    // Color detection at SL
    const sl = allData.SL || {};
    const colorVal = sl?.sensors?.['Color Sensor'];
    if (typeof colorVal === 'number' && colorVal > 10) {
        if (colorVal >= 250) colorDetected = { name: 'WHITE', css: '#e0e0e0', value: colorVal };
        else if (colorVal >= 130) colorDetected = { name: 'RED', css: '#ff1744', value: colorVal };
        else if (colorVal >= 40) colorDetected = { name: 'BLUE', css: '#2979ff', value: colorVal };

        if (colorDetected) {
            wpColor = colorDetected.css;
        }
    }

    // Detect sort completion (valve firing) — reset workpiece
    if (isOn(sl, 'actuators', 'Valve Blue') || isOn(sl, 'actuators', 'Valve Red') || isOn(sl, 'actuators', 'Valve White')) {
        // Will fade out next cycle when no more activity
    }
}

// ============================================================
//  WORKPIECE TRACKER (sidebar path)
// ============================================================

function updateTracker() {
    for (const stn of STATIONS) {
        const key = STN_KEYS[stn];
        const node = document.getElementById('tn-' + key);
        if (!node) continue;

        node.classList.remove('current', 'visited');
        if (stn === wpStation) {
            node.classList.add('current');
        } else if (visitedStations.has(stn)) {
            node.classList.add('visited');
        }
    }

    // Color display
    const swatch = document.getElementById('tc-swatch');
    const val = document.getElementById('tc-val');
    const colorEl = document.getElementById('cycle-color');

    if (colorDetected) {
        if (swatch) {
            swatch.style.background = colorDetected.css;
            swatch.style.borderColor = colorDetected.css;
        }
        if (val) val.textContent = colorDetected.name + ' (' + colorDetected.value + ')';
        if (colorEl) colorEl.textContent = colorDetected.name + ' ' + colorDetected.value;
    }
}

// ============================================================
//  SVG EFFECTS
// ============================================================

function updateOven(data) {
    const glow = document.getElementById('oven-glow');
    if (!glow || !data?.data) return;
    const ms = data.data.MS || {};
    const on = isOn(ms, 'actuators', 'Lamp');
    if (on) {
        glow.classList.add('burning');
        glow.setAttribute('fill-opacity', '0.2');
    } else {
        glow.classList.remove('burning');
        glow.setAttribute('fill-opacity', '0');
    }
}

function updateSaw(data) {
    const blade = document.getElementById('saw-blade');
    if (!blade || !data?.data) return;
    const ms = data.data.MS || {};
    const on = isOn(ms, 'actuators', 'Motor Saw');
    blade.classList.toggle('spinning', on);
}

function updatePunch(data) {
    const tip = document.getElementById('punch-tip');
    if (!tip || !data?.data) return;
    const pm = data.data.PM || {};
    const on = isOn(pm, 'actuators', 'Motor Tool Downward');
    tip.classList.toggle('punching', on);
}

function updateCraneArm(states, data) {
    const arm = document.getElementById('crane-arm');
    const grip = document.getElementById('crane-grip');
    if (!arm || !grip) return;

    const cs = states.Crane;
    if (cs && cs.active) {
        const crane = data?.data?.Crane || {};
        const cw = isOn(crane, 'actuators', 'Motor Clockwise');
        const ccw = isOn(crane, 'actuators', 'Motor Counterclockwise');
        if (cw) craneAngle = (craneAngle + 2.5) % 360;
        else if (ccw) craneAngle = (craneAngle - 2.5 + 360) % 360;
        else craneAngle = (craneAngle + 1.5) % 360;
    }

    const rad = (craneAngle * Math.PI) / 180;
    const cx = 370, cy = 285, len = 38;
    const ex = cx + Math.sin(rad) * len;
    const ey = cy - Math.cos(rad) * len;

    arm.setAttribute('x2', ex.toFixed(1));
    arm.setAttribute('y2', ey.toFixed(1));
    grip.setAttribute('cx', ex.toFixed(1));
    grip.setAttribute('cy', ey.toFixed(1));
}

function updateBins(data) {
    if (!data?.data) return;
    const sl = data.data.SL || {};
    const bins = [
        { id: 'bin-w', valve: 'Valve White', color: '#e0e0e0' },
        { id: 'bin-r', valve: 'Valve Red',   color: '#ff1744' },
        { id: 'bin-b', valve: 'Valve Blue',  color: '#2979ff' }
    ];
    for (const bin of bins) {
        const el = document.getElementById(bin.id);
        if (!el) continue;
        const active = isOn(sl, 'actuators', bin.valve);
        el.setAttribute('fill', active ? bin.color : '#222');
    }
}

// ============================================================
//  LIVE VARIABLE TABLE
// ============================================================

function updateVarTable(data) {
    const tbody = document.getElementById('var-tbody');
    const countEl = document.getElementById('var-count');
    if (!tbody || !data?.data) return;

    let rows = '';
    let total = 0;
    let activeCount = 0;

    for (const stn of STATIONS) {
        const sd = data.data[stn];
        if (!sd) continue;

        for (const groupName of ['actuators', 'sensors']) {
            const group = sd[groupName];
            if (!group) continue;

            for (const varName in group) {
                const val = group[varName];
                const key = stn + '.' + groupName + '.' + varName;
                total++;

                let valClass = 'val-false';
                let valText = String(val);
                let rowClass = '';

                if (val === true || val === 'True') {
                    valClass = 'val-true';
                    valText = 'TRUE';
                    rowClass = 'active-row';
                    activeCount++;
                } else if (val === false || val === 'False') {
                    valClass = 'val-false';
                    valText = 'FALSE';
                } else if (typeof val === 'number') {
                    valClass = 'val-num';
                    valText = val.toString();
                    if (val !== 0) {
                        rowClass = 'active-row';
                        activeCount++;
                    }
                }

                // Check for change
                let changed = false;
                if (prevVarValues[key] !== undefined && prevVarValues[key] !== val) {
                    changed = true;
                }
                prevVarValues[key] = val;

                const typeClass = groupName === 'actuators' ? 'act' : 'sen';
                const typeLabel = groupName === 'actuators' ? 'ACT' : 'SEN';

                // Abbreviate variable name
                const shortName = varName.length > 28 ? varName.substring(0, 26) + '..' : varName;

                rows += '<tr class="' + rowClass + '">' +
                    '<td class="stn-col">' + stn + '</td>' +
                    '<td class="type-col ' + typeClass + '">' + typeLabel + '</td>' +
                    '<td>' + shortName + '</td>' +
                    '<td class="' + valClass + (changed ? ' just-changed' : '') + '">' + valText + '</td>' +
                    '</tr>';
            }
        }
    }

    tbody.innerHTML = rows;
    if (countEl) countEl.textContent = activeCount + '/' + total;
}

// ============================================================
//  ANIMATION LOOP
// ============================================================

function animate() {
    // Lerp workpiece position
    if (wpVisible) {
        wpCurrentPos.x += (wpTargetPos.x - wpCurrentPos.x) * 0.1;
        wpCurrentPos.y += (wpTargetPos.y - wpCurrentPos.y) * 0.1;

        const dot = document.getElementById('wp-dot');
        if (dot) {
            dot.setAttribute('cx', wpCurrentPos.x.toFixed(1));
            dot.setAttribute('cy', wpCurrentPos.y.toFixed(1));
            dot.setAttribute('fill', wpColor);
            dot.setAttribute('stroke', wpColor === '#555' ? '#777' : wpColor);
        }
    }

    // Keep crane spinning smoothly
    if (latestData) {
        const states = deriveStates(latestData);
        if (states.Crane && states.Crane.active) {
            updateCraneArm(states, latestData);
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

        lastFetch = Date.now();
        latestData = data;

        // Mode indicator
        const modeEl = document.getElementById('scada-mode');
        if (modeEl && data.mode) {
            modeEl.textContent = data.mode.toUpperCase();
        }

        // Derive states
        const states = deriveStates(data);

        // Update everything
        updateStationStatus(states);
        updateCycleDisplay(states);
        updateWorkpiece(data);
        updateTracker();
        updateConnections();
        updateOven(data);
        updateSaw(data);
        updatePunch(data);
        updateCraneArm(states, data);
        updateBins(data);
        updateVarTable(data);
    } catch (e) {
        // silent fail
    }
}

// ============================================================
//  INIT
// ============================================================

function init() {
    // Start polling
    setInterval(update, POLL_MS);
    update();

    // Clock + staleness
    setInterval(updateClock, 1000);
    setInterval(updateStaleness, 500);
    updateClock();

    // Animation
    requestAnimationFrame(animate);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

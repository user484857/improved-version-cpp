/* ============================================
   Digital Twin V2 — Clean Technical Glass
   Human-readable station actions from PLC data
   ============================================ */

// ============================================================
//  CONSTANTS
// ============================================================

const STATIONS = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

const STATION_COLORS = {
    HBW:   '#AF52DE',
    Crane: '#30D158',
    MS:    '#007AFF',
    PM:    '#FF453A',
    SL:    '#FF9F0A'
};

const POLL_MS      = 400;
const LERP_SPEED   = 0.08;
const TRAIL_MAX    = 8;
const TRAIL_MS     = 120;
const FADEOUT_MS   = 500;
const SVG_NS       = 'http://www.w3.org/2000/svg';

// ============================================================
//  HUMAN-READABLE ACTION MAPS
//  PLC actuator names -> plain English descriptions
// ============================================================

const ACTION_MAP = {
    HBW: [
        { keys: ['Motor Conveyor Belt Forward'],                          text: 'Conveyor -> forward' },
        { keys: ['Motor Stacker Crane \u2192 Rack'],                     text: 'Stacker -> rack' },
        { keys: ['Motor Stacker Crane \u2192 Conv Belt'],                text: 'Stacker -> conveyor' },
        { keys: ['Motor Stacker Crane Upward'],                          text: 'Stacker -> up' },
        { keys: ['Motor Stacker Crane Downward'],                        text: 'Stacker -> down' },
        { keys: ['Motor Cantilever Forward'],                            text: 'Cantilever -> extend' },
        { keys: ['Motor Cantilever Backward'],                           text: 'Cantilever -> retract' },
    ],
    Crane: [
        { keys: ['Motor Clockwise'],                                     text: 'Rotating -> CW' },
        { keys: ['Motor Counterclockwise'],                              text: 'Rotating -> CCW' },
        { keys: ['Motor Forward'],                                       text: 'Arm -> forward' },
        { keys: ['Motor Backward'],                                      text: 'Arm -> backward' },
        { keys: ['Motor Upward'],                                        text: 'Lifting -> up' },
        { keys: ['Motor Downward'],                                      text: 'Lowering -> down' },
        { keys: ['Valve'],                                               text: 'Vacuum -> grip' },
        { keys: ['Compressor'],                                          text: 'Compressor -> on' },
    ],
    MS: [
        { keys: ['Motor Conveyor Belt Forward'],                         text: 'Conveyor -> forward' },
        { keys: ['Motor Turntable Clockwise'],                           text: 'Turntable -> CW' },
        { keys: ['Motor Turntable Counterclockwise'],                    text: 'Turntable -> CCW' },
        { keys: ['Motor Transfer Unit \u2192 Oven'],                     text: 'Transfer -> oven' },
        { keys: ['Motor Transfer Unit \u2192 Turntable'],                text: 'Transfer -> turntable' },
        { keys: ['Motor Oven Slider Move In'],                           text: 'Oven slider -> in' },
        { keys: ['Motor Oven Slider Move Out'],                          text: 'Oven slider -> out' },
        { keys: ['Valve Ovendoor'],                                      text: 'Oven door -> open' },
        { keys: ['Lamp'],                                                text: 'Oven -> heating' },
        { keys: ['Motor Saw'],                                           text: 'Saw -> cutting' },
        { keys: ['Valve Ejector'],                                       text: 'Ejector -> push' },
        { keys: ['Valve Vacuum'],                                        text: 'Vacuum -> grip' },
        { keys: ['Compressor'],                                          text: 'Compressor -> on' },
    ],
    PM: [
        { keys: ['Motor Conveyor Belt Forward'],                         text: 'Conveyor -> forward' },
        { keys: ['Motor Tool Downward'],                                 text: 'Punch -> down' },
        { keys: ['Motor Tool Upward'],                                   text: 'Punch -> up' },
        { keys: ['Compressor'],                                          text: 'Compressor -> on' },
    ],
    SL: [
        { keys: ['Motor Conveyor Belt'],                                 text: 'Conveyor -> forward' },
        { keys: ['Valve White'],                                         text: 'Sort -> White bin' },
        { keys: ['Valve Red'],                                           text: 'Sort -> Red bin' },
        { keys: ['Valve Blue'],                                          text: 'Sort -> Blue bin' },
        { keys: ['Compressor'],                                          text: 'Compressor -> on' },
    ],
};

// ============================================================
//  WAYPOINTS (SVG coordinates)
// ============================================================

const WAYPOINTS = {
    hbw_rack:           { x: 95,  y: 255 },
    hbw_conveyor_start: { x: 160, y: 335 },
    hbw_conveyor_end:   { x: 200, y: 335 },

    crane_pickup:       { x: 370, y: 275 },
    crane_center:       { x: 420, y: 275 },
    crane_place:        { x: 475, y: 265 },

    ms_conveyor:        { x: 580, y: 93 },
    ms_turntable:       { x: 630, y: 93 },
    ms_oven:            { x: 691, y: 143 },
    ms_saw:             { x: 611, y: 153 },
    ms_eject:           { x: 575, y: 153 },

    pm_entry:           { x: 815, y: 145 },
    pm_tool:            { x: 857, y: 145 },
    pm_exit:            { x: 870, y: 145 },

    sl_entry:           { x: 575, y: 385 },
    sl_sensor:          { x: 615, y: 385 },
    sl_white:           { x: 665, y: 370 },
    sl_red:             { x: 665, y: 388 },
    sl_blue:            { x: 665, y: 408 },
};

const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

const CONNECTIONS = {
    'hbw-crane':  'conn-hbw-crane',
    'crane-ms':   'conn-crane-ms',
    'ms-pm':      'conn-ms-pm',
    'crane-sl':   'conn-crane-sl',
    'sl-hbw':     'conn-sl-hbw'
};

// ============================================================
//  STATE
// ============================================================

let stationStates    = {};
let latestData       = null;
let lastFetchTime    = 0;
let craneAngle       = 0;
let cachedCycleTimes = {};
let sawWasSpinning   = false;
let ovenWasBurning   = false;
let punchWasDropping = false;
let prevStationActive = {};

// ============================================================
//  WORKPIECE SYSTEM (simplified from v1)
// ============================================================

let _wpId = 0;

class Workpiece {
    constructor() {
        this.id = ++_wpId;
        this.pos     = { x: 0, y: 0 };
        this.target  = { x: 0, y: 0 };
        this.color   = '#777';
        this.colorName = null;
        this.visible = false;
        this.fadingOut = false;
        this.fadeStart = 0;
        this.removed = false;
        this.station = null;
        this.waypoint = null;
        this.prevWaypoint = null;
        this.svgGroup = null;
        this.svgBody  = null;
        this.trailDots = [];
        this.lastTrailTime = 0;
    }
}

class WPManager {
    constructor() {
        this.list = [];
        this.hbwWasActive = false;
    }

    spawn() {
        const wp = new Workpiece();
        this._createSvg(wp);
        this.list.push(wp);
        return wp;
    }

    _createSvg(wp) {
        const svg = document.getElementById('factory-svg');
        if (!svg) return;
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('visibility', 'hidden');
        g.setAttribute('filter', 'url(#glow-wp)');

        // Outer glow
        const r1 = document.createElementNS(SVG_NS, 'circle');
        r1.setAttribute('r', '12');
        r1.setAttribute('fill', 'currentColor');
        r1.setAttribute('opacity', '0.06');
        r1.classList.add('wp-trail-ring');
        g.appendChild(r1);

        const r2 = document.createElementNS(SVG_NS, 'circle');
        r2.setAttribute('r', '9');
        r2.setAttribute('fill', 'currentColor');
        r2.setAttribute('opacity', '0.1');
        r2.classList.add('wp-trail-ring');
        g.appendChild(r2);

        // Main body
        const body = document.createElementNS(SVG_NS, 'circle');
        body.setAttribute('r', '6');
        body.setAttribute('fill', '#777');
        body.setAttribute('stroke', 'rgba(255,255,255,0.35)');
        body.setAttribute('stroke-width', '1.2');
        body.classList.add('wp-body');
        g.appendChild(body);

        // Specular highlight
        const hl = document.createElementNS(SVG_NS, 'circle');
        hl.setAttribute('r', '2.5');
        hl.setAttribute('fill', 'rgba(255,255,255,0.25)');
        hl.setAttribute('cx', '-1');
        hl.setAttribute('cy', '-1.5');
        g.appendChild(hl);

        const trail = document.getElementById('trail-group');
        if (trail && trail.nextSibling) {
            svg.insertBefore(g, trail.nextSibling);
        } else {
            svg.appendChild(g);
        }

        wp.svgGroup = g;
        wp.svgBody = body;
    }

    removeSvg(wp) {
        for (const d of wp.trailDots) {
            if (d.el.parentNode) d.el.parentNode.removeChild(d.el);
        }
        wp.trailDots = [];
        if (wp.svgGroup?.parentNode) wp.svgGroup.parentNode.removeChild(wp.svgGroup);
        wp.svgGroup = null;
        wp.svgBody = null;
    }

    startFade(wp) {
        if (wp.fadingOut) return;
        wp.fadingOut = true;
        wp.fadeStart = performance.now();
    }

    cleanup() {
        const dead = this.list.filter(w => w.removed);
        for (const w of dead) this.removeSvg(w);
        this.list = this.list.filter(w => !w.removed);
    }

    getAt(station) {
        return this.list.find(w => !w.fadingOut && !w.removed && w.station === station);
    }

    activeCount() {
        return this.list.filter(w => !w.fadingOut && !w.removed).length;
    }

    all() {
        return this.list.filter(w => !w.removed);
    }
}

const wpMgr = new WPManager();

// ============================================================
//  HELPERS
// ============================================================

function isOn(station, group, label) {
    const v = station?.[group]?.[label];
    return v === true || v === 'True';
}

function hasActiveActuator(station) {
    const acts = station?.actuators;
    if (!acts) return false;
    for (const k in acts) {
        if (acts[k] === true || acts[k] === 'True') return true;
    }
    return false;
}

function waypointStation(wp) {
    if (!wp) return null;
    if (wp.startsWith('hbw'))   return 'HBW';
    if (wp.startsWith('crane')) return 'Crane';
    if (wp.startsWith('ms'))    return 'MS';
    if (wp.startsWith('pm'))    return 'PM';
    if (wp.startsWith('sl'))    return 'SL';
    return null;
}

function stationIdx(s) {
    return STATION_ORDER.indexOf(s);
}

function isSortBin(wp) {
    return wp === 'sl_white' || wp === 'sl_red' || wp === 'sl_blue';
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
//  DATA FETCHING
// ============================================================

async function fetchData() {
    try {
        const r = await fetch('/api/data');
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; }
}

async function fetchAnalytics(ep) {
    try {
        const r = await fetch('/api/analytics/' + ep);
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; }
}

// ============================================================
//  HUMAN-READABLE ACTION DERIVATION
// ============================================================

function deriveAction(stationName, stationData) {
    if (!stationData?.actuators) return '--';
    const acts = stationData.actuators;
    const map = ACTION_MAP[stationName];
    if (!map) return '--';

    // Find all currently active actions
    const active = [];
    for (const entry of map) {
        for (const key of entry.keys) {
            if (acts[key] === true || acts[key] === 'True') {
                active.push(entry.text);
                break;
            }
        }
    }

    if (active.length === 0) return '--';

    // Skip "Compressor -> on" if there is something more interesting
    const interesting = active.filter(a => a !== 'Compressor -> on');
    if (interesting.length > 0) return interesting[0];
    return active[0];
}

// ============================================================
//  STATION STATUS
// ============================================================

function deriveStationStates(data) {
    const states = {};
    if (!data?.data) return states;

    for (const s of STATIONS) {
        const sd = data.data[s];
        if (!sd) {
            states[s] = { active: false, actuators: 0 };
            continue;
        }
        let count = 0;
        const acts = sd.actuators || {};
        for (const k in acts) {
            if (acts[k] === true || acts[k] === 'True') count++;
        }
        states[s] = { active: count > 0, actuators: count };
    }
    return states;
}

// ============================================================
//  PER-STATION WAYPOINT DETECTION
// ============================================================

function detectWaypoint_HBW(data) {
    const hbw = data.HBW || {};
    if (isOn(hbw, 'actuators', 'Motor Conveyor Belt Forward')) return 'hbw_conveyor_start';
    if (isOn(hbw, 'actuators', 'Motor Cantilever Forward') || isOn(hbw, 'actuators', 'Motor Cantilever Backward')) return 'hbw_rack';
    if (isOn(hbw, 'actuators', 'Motor Stacker Crane \u2192 Rack') ||
        isOn(hbw, 'actuators', 'Motor Stacker Crane Downward') ||
        isOn(hbw, 'actuators', 'Motor Stacker Crane Upward') ||
        isOn(hbw, 'actuators', 'Motor Stacker Crane \u2192 Conv Belt')) return 'hbw_rack';
    return null;
}

function detectWaypoint_Crane(data) {
    const c = data.Crane || {};
    if (isOn(c, 'actuators', 'Motor Counterclockwise') ||
        (isOn(c, 'actuators', 'Motor Forward') && !isOn(c, 'actuators', 'Motor Clockwise'))) return 'crane_place';
    if (isOn(c, 'actuators', 'Valve') || isOn(c, 'actuators', 'Motor Downward') || isOn(c, 'actuators', 'Motor Upward')) return 'crane_center';
    if (isOn(c, 'actuators', 'Motor Clockwise') || isOn(c, 'actuators', 'Compressor')) return 'crane_pickup';
    if (isOn(c, 'actuators', 'Motor Backward')) return 'crane_center';
    return null;
}

function detectWaypoint_MS(data) {
    const ms = data.MS || {};
    if (isOn(ms, 'actuators', 'Valve Ejector')) return 'ms_eject';
    if (isOn(ms, 'actuators', 'Motor Saw')) return 'ms_saw';
    if (isOn(ms, 'sensors', 'Ref Switch Turntable @ Saw') && hasActiveActuator(ms)) return 'ms_saw';
    if (isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Turntable')) return 'ms_oven';
    if (isOn(ms, 'actuators', 'Lamp')) return 'ms_oven';
    if (isOn(ms, 'actuators', 'Motor Oven Slider Move In') || isOn(ms, 'actuators', 'Valve Ovendoor')) return 'ms_oven';
    if (isOn(ms, 'actuators', 'Motor Oven Slider Move Out')) return 'ms_oven';
    if (isOn(ms, 'actuators', 'Motor Transfer Unit \u2192 Oven')) return 'ms_turntable';
    if (isOn(ms, 'sensors', 'Ref Switch Turntable @ Transfer Unit') && hasActiveActuator(ms)) return 'ms_turntable';
    if (isOn(ms, 'actuators', 'Motor Turntable Clockwise') || isOn(ms, 'actuators', 'Motor Turntable Counterclockwise')) return 'ms_turntable';
    if (isOn(ms, 'actuators', 'Motor Conveyor Belt Forward')) return 'ms_conveyor';
    if (isOn(ms, 'actuators', 'Valve Vacuum') || isOn(ms, 'actuators', 'Valve Transfer Unit')) return 'ms_turntable';
    if (isOn(ms, 'actuators', 'Compressor')) return 'ms_turntable';
    return null;
}

function detectWaypoint_PM(data) {
    const pm = data.PM || {};
    if (isOn(pm, 'actuators', 'Motor Tool Downward') || isOn(pm, 'actuators', 'Motor Tool Upward')) return 'pm_tool';
    if (isOn(pm, 'actuators', 'Motor Conveyor Belt Forward')) {
        if (!isOn(pm, 'sensors', 'Light Barrier Tool')) return 'pm_tool';
        return 'pm_entry';
    }
    if (hasActiveActuator(pm)) return 'pm_entry';
    return null;
}

function detectWaypoint_SL(data) {
    const sl = data.SL || {};
    if (isOn(sl, 'actuators', 'Valve Blue'))   return 'sl_blue';
    if (isOn(sl, 'actuators', 'Valve Red'))    return 'sl_red';
    if (isOn(sl, 'actuators', 'Valve White'))  return 'sl_white';
    if (isOn(sl, 'actuators', 'Motor Conveyor Belt')) {
        if (!isOn(sl, 'sensors', 'Light Barrier After Color'))  return 'sl_sensor';
        if (!isOn(sl, 'sensors', 'Light Barrier Before Color')) return 'sl_sensor';
        return 'sl_entry';
    }
    if (isOn(sl, 'actuators', 'Compressor')) return 'sl_entry';
    return null;
}

const WAYPOINT_DETECTORS = {
    HBW: detectWaypoint_HBW,
    Crane: detectWaypoint_Crane,
    MS: detectWaypoint_MS,
    PM: detectWaypoint_PM,
    SL: detectWaypoint_SL,
};

function detectActiveWaypoints(data) {
    const result = {};
    for (const s of STATIONS) {
        const w = WAYPOINT_DETECTORS[s](data);
        if (w) result[s] = w;
    }
    return result;
}

// ============================================================
//  COLOR DETECTION
// ============================================================

function detectColor(data) {
    const val = data?.SL?.sensors?.['Color Sensor'];
    if (typeof val === 'number' && val > 10) {
        if (val >= 250) return { name: 'white', css: '#e0e0e0', value: val };
        if (val >= 130) return { name: 'red',   css: '#FF453A',  value: val };
        if (val >= 40)  return { name: 'blue',  css: '#007AFF',  value: val };
    }
    return null;
}

// ============================================================
//  SVG UPDATES
// ============================================================

function updateStatusDots(states) {
    for (const s of STATIONS) {
        const dot = document.getElementById('dot-' + s.toLowerCase());
        if (!dot) continue;
        if (states[s]?.active) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    }
}

function updateStationGlows(states) {
    for (const s of STATIONS) {
        const group = document.getElementById('station-' + s.toLowerCase());
        if (!group) continue;
        if (states[s]?.active) {
            group.classList.add('active');
            group.style.filter = 'url(#glow-' + s.toLowerCase() + ')';
        } else {
            group.classList.remove('active');
            group.style.filter = 'none';
        }
    }
}

function updateOven(data) {
    const glow = document.getElementById('oven-glow');
    if (!glow || !data?.data) return;
    const lampOn = isOn(data.data.MS || {}, 'actuators', 'Lamp');
    if (lampOn && !ovenWasBurning) {
        glow.classList.add('burning');
        glow.setAttribute('fill-opacity', '0.2');
        ovenWasBurning = true;
    } else if (!lampOn && ovenWasBurning) {
        glow.classList.remove('burning');
        glow.setAttribute('fill-opacity', '0');
        ovenWasBurning = false;
    }
}

function updateSaw(data) {
    const blade = document.getElementById('saw-blade');
    if (!blade || !data?.data) return;
    const on = isOn(data.data.MS || {}, 'actuators', 'Motor Saw');
    if (on && !sawWasSpinning) { blade.classList.add('spinning'); sawWasSpinning = true; }
    else if (!on && sawWasSpinning) { blade.classList.remove('spinning'); sawWasSpinning = false; }
}

function updatePunch(data) {
    const tip = document.getElementById('punch-tip');
    if (!tip || !data?.data) return;
    const on = isOn(data.data.PM || {}, 'actuators', 'Motor Tool Downward');
    if (on && !punchWasDropping) { tip.classList.add('punching'); punchWasDropping = true; }
    else if (!on && punchWasDropping) { tip.classList.remove('punching'); punchWasDropping = false; }
}

function updateCraneArm(states, data) {
    const arm = document.getElementById('crane-arm');
    const grip = document.getElementById('crane-gripper');
    if (!arm || !grip) return;

    if (states.Crane?.active) {
        const c = data?.data?.Crane || {};
        const cw  = isOn(c, 'actuators', 'Motor Clockwise');
        const ccw = isOn(c, 'actuators', 'Motor Counterclockwise');
        if (cw) craneAngle = (craneAngle + 2.5) % 360;
        else if (ccw) craneAngle = (craneAngle - 2.5 + 360) % 360;
        else craneAngle = (craneAngle + 1.5) % 360;
    }

    const rad = (craneAngle * Math.PI) / 180;
    const cx = 420, cy = 275, len = 43;
    const ex = cx + Math.sin(rad) * len;
    const ey = cy - Math.cos(rad) * len;
    arm.setAttribute('x2', ex.toFixed(1));
    arm.setAttribute('y2', ey.toFixed(1));
    grip.setAttribute('cx', ex.toFixed(1));
    grip.setAttribute('cy', ey.toFixed(1));
}

function updateConnections(workpieces) {
    for (const key in CONNECTIONS) {
        const el = document.getElementById(CONNECTIONS[key]);
        if (el) el.classList.remove('active');
    }
    const adj = {
        HBW:   ['hbw-crane'],
        Crane: ['hbw-crane', 'crane-ms', 'crane-sl'],
        MS:    ['crane-ms', 'ms-pm'],
        PM:    ['ms-pm'],
        SL:    ['crane-sl', 'sl-hbw']
    };
    for (const w of workpieces) {
        if (w.fadingOut || w.removed || !w.waypoint) continue;
        const s = waypointStation(w.waypoint);
        if (!s) continue;
        for (const c of (adj[s] || [])) {
            const el = document.getElementById(CONNECTIONS[c]);
            if (el) el.classList.add('active');
        }
    }
}

function updateBinLights(data) {
    if (!data?.data) return;
    const sl = data.data.SL || {};
    const bins = [
        { id: 'bin-white', valve: 'Valve White', color: '#e0e0e0' },
        { id: 'bin-red',   valve: 'Valve Red',   color: '#FF453A' },
        { id: 'bin-blue',  valve: 'Valve Blue',  color: '#007AFF' },
    ];
    for (const b of bins) {
        const el = document.getElementById(b.id);
        if (!el) continue;
        const on = isOn(sl, 'actuators', b.valve);
        if (on) {
            el.setAttribute('fill', b.color);
            el.setAttribute('r', '3.5');
            el.style.filter = 'drop-shadow(0 0 3px ' + b.color + ')';
        } else {
            el.setAttribute('fill', 'transparent');
            el.setAttribute('r', '2.5');
            el.style.filter = 'none';
        }
    }
}

// ============================================================
//  STATION CARDS
// ============================================================

function updateCards(states, data) {
    for (const s of STATIONS) {
        const key = s.toLowerCase();
        const card   = document.getElementById('card-' + key);
        const status = document.getElementById('card-status-' + key);
        const action = document.getElementById('card-action-' + key);
        const cycle  = document.getElementById('card-cycle-' + key);
        if (!card) continue;

        const st = states[s];
        const sd = data?.data?.[s];

        // Active / idle state
        if (st?.active) {
            card.classList.add('active');
            if (status) { status.textContent = 'Active'; status.className = 'card-status active'; }
        } else {
            card.classList.remove('active');
            if (status) { status.textContent = 'Idle'; status.className = 'card-status idle'; }
        }

        // Human-readable action
        if (action) action.textContent = deriveAction(s, sd);

        // Cycle time
        if (cycle) cycle.textContent = cachedCycleTimes[s] || '--';
    }
}

// ============================================================
//  MULTI-WORKPIECE STATE MACHINE
// ============================================================

function updateWorkpieces(data) {
    const allData = data?.data;
    if (!allData) return;

    const activeWP = detectActiveWaypoints(allData);
    const currentActivity = {};
    for (const s of STATIONS) currentActivity[s] = !!activeWP[s];

    // Spawn at HBW (rising edge)
    const hbwActive = currentActivity.HBW;
    const hbwWp = activeWP.HBW;
    const hbwRetrieving = hbwWp === 'hbw_rack' || hbwWp === 'hbw_conveyor_start';

    if (hbwActive && hbwRetrieving && !wpMgr.hbwWasActive) {
        if (!wpMgr.getAt('HBW') && wpMgr.activeCount() < 2) {
            const nw = wpMgr.spawn();
            nw.station = 'HBW';
            nw.waypoint = hbwWp;
        }
    }
    wpMgr.hbwWasActive = hbwActive && hbwRetrieving;

    // Assign waypoints to workpieces
    for (const station of STATION_ORDER) {
        const wp = activeWP[station];
        if (!wp) continue;

        let assigned = wpMgr.getAt(station);

        if (!assigned) {
            const sIdx = stationIdx(station);
            let best = null, bestDist = 999;
            for (const w of wpMgr.list) {
                if (w.fadingOut || w.removed) continue;
                const wIdx = stationIdx(w.station);
                if (wIdx >= 0 && wIdx < sIdx && (sIdx - wIdx) < bestDist) {
                    bestDist = sIdx - wIdx;
                    best = w;
                }
            }
            if (best) {
                const prev = best.station;
                if (!currentActivity[prev] || bestDist === 1) {
                    assigned = best;
                    assigned.station = station;
                }
            }
        }

        if (!assigned && wpMgr.activeCount() === 0 && station === 'HBW') {
            assigned = wpMgr.spawn();
            assigned.station = 'HBW';
        }

        if (assigned && WAYPOINTS[wp]) {
            const prev = assigned.waypoint;
            assigned.waypoint = wp;
            assigned.station = station;
            const pos = WAYPOINTS[wp];
            assigned.target.x = pos.x;
            assigned.target.y = pos.y;

            if (!assigned.visible) {
                assigned.pos.x = pos.x;
                assigned.pos.y = pos.y;
                assigned.visible = true;
                if (assigned.svgGroup) assigned.svgGroup.setAttribute('visibility', 'visible');
            }
            assigned.prevWaypoint = prev;
        }
    }

    // Color detection
    const colorResult = detectColor(allData);
    if (colorResult) {
        const slW = wpMgr.getAt('SL');
        if (slW && !slW.colorName) {
            slW.color = colorResult.css;
            slW.colorName = colorResult.name;
            if (slW.svgBody) {
                slW.svgBody.classList.remove('flash');
                void slW.svgBody.offsetWidth;
                slW.svgBody.classList.add('flash');
            }
        }
    }

    // Fade-out at sorting bins
    for (const w of wpMgr.list) {
        if (!w.fadingOut && !w.removed && w.waypoint && isSortBin(w.waypoint)) {
            wpMgr.startFade(w);
        }
    }

    // Update SVG fills
    for (const w of wpMgr.list) {
        if (!w.removed && w.svgBody) w.svgBody.setAttribute('fill', w.color);
    }

    updateConnections(wpMgr.list);
    prevStationActive = { ...currentActivity };
}

// ============================================================
//  TRAIL EFFECTS
// ============================================================

function dropTrail(wp, ts) {
    if (!wp.visible || wp.fadingOut) return;
    if (ts - wp.lastTrailTime < TRAIL_MS) return;
    wp.lastTrailTime = ts;

    const dx = wp.target.x - wp.pos.x;
    const dy = wp.target.y - wp.pos.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    const tg = document.getElementById('trail-group');
    if (!tg) return;

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', wp.pos.x.toFixed(1));
    dot.setAttribute('cy', wp.pos.y.toFixed(1));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', wp.color);
    dot.classList.add('trail-dot');
    tg.appendChild(dot);
    wp.trailDots.push({ el: dot, time: ts });

    while (wp.trailDots.length > TRAIL_MAX) {
        const old = wp.trailDots.shift();
        if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
}

function pruneTrails(wp, ts) {
    while (wp.trailDots.length > 0 && ts - wp.trailDots[0].time > 1500) {
        const old = wp.trailDots.shift();
        if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
}

// ============================================================
//  ANIMATION LOOP
// ============================================================

function animate(ts) {
    for (const wp of wpMgr.list) {
        if (wp.removed) continue;

        if (wp.fadingOut) {
            const p = Math.min((ts - wp.fadeStart) / FADEOUT_MS, 1);
            if (wp.svgGroup) wp.svgGroup.style.opacity = (1 - p).toFixed(2);
            if (p >= 1) { wp.removed = true; continue; }
        }

        wp.pos.x += (wp.target.x - wp.pos.x) * LERP_SPEED;
        wp.pos.y += (wp.target.y - wp.pos.y) * LERP_SPEED;

        if (wp.svgGroup && wp.visible) {
            wp.svgGroup.setAttribute('transform',
                'translate(' + wp.pos.x.toFixed(1) + ',' + wp.pos.y.toFixed(1) + ')');
        }

        dropTrail(wp, ts);
        pruneTrails(wp, ts);
    }

    wpMgr.cleanup();

    if (stationStates.Crane?.active) {
        updateCraneArm(stationStates, latestData);
    }

    requestAnimationFrame(animate);
}

// ============================================================
//  LIVE PILL
// ============================================================

function updateLivePill() {
    const pill = document.getElementById('live-pill');
    const lat  = document.getElementById('live-latency');
    if (!pill) return;

    if (lastFetchTime === 0) {
        pill.className = 'live-pill';
        if (lat) lat.textContent = '--';
        return;
    }

    const ago = ((Date.now() - lastFetchTime) / 1000).toFixed(1);
    if (lat) lat.textContent = ago + 's';

    if (parseFloat(ago) > 30) {
        pill.className = 'live-pill stale';
    } else {
        pill.className = 'live-pill connected';
    }
}

// ============================================================
//  ANALYTICS
// ============================================================

async function refreshCycleTimes() {
    const data = await fetchAnalytics('cycle-times');
    if (data?.length > 0) {
        const latest = data[data.length - 1];
        if (latest?.stations) {
            for (const s of STATIONS) {
                const ct = latest.stations[s];
                cachedCycleTimes[s] = (ct != null) ? ct.toFixed(1) + 's' : '--';
            }
        }
    }
}

// ============================================================
//  MAIN UPDATE
// ============================================================

async function update() {
    const data = await fetchData();
    if (!data) return;

    lastFetchTime = Date.now();
    latestData = data;

    stationStates = deriveStationStates(data);

    updateStatusDots(stationStates);
    updateStationGlows(stationStates);
    updateOven(data);
    updateSaw(data);
    updatePunch(data);
    updateCraneArm(stationStates, data);
    updateBinLights(data);
    updateWorkpieces(data);
    updateCards(stationStates, data);
}

// ============================================================
//  INIT
// ============================================================

function init() {
    requestAnimationFrame(animate);
    setInterval(update, POLL_MS);
    setInterval(updateLivePill, 500);

    refreshCycleTimes();
    setInterval(refreshCycleTimes, 5000);

    update();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

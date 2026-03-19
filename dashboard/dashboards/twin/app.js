/* ============================================
   Digital Twin — App Logic
   Battery Cell Testing Line visualization
   with multi-workpiece tracking & state machine
   ============================================ */

// ============================================================
//  CONSTANTS
// ============================================================

const STATION_COLORS = {
    HBW:   '#AF52DE',
    Crane: '#30D158',
    MS:    '#007AFF',
    PM:    '#FF453A',
    SL:    '#FF9F0A'
};

const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

const STATION_NAMES = {
    HBW:   'Cell Storage',
    Crane: 'Cell Handler',
    MS:    'Testing Station',
    PM:    'Capacity Test',
    SL:    'Quality Classification'
};

// Workpiece waypoints across the factory (SVG coordinates)
// Layout: HBW(left) -> Crane(center hub) -> MS(upper-right) -> PM(far-right) -> SL(lower-right)
const WAYPOINTS = {
    // HBW (x=30-240, y=200-430)
    hbw_rack:            { x: 110, y: 306 },
    hbw_conveyor_start:  { x: 165, y: 393 },
    hbw_conveyor_end:    { x: 225, y: 393 },

    // Crane (x=340-530, y=220-430) — central hub
    crane_pickup:        { x: 380, y: 340 },
    crane_center:        { x: 435, y: 340 },
    crane_place:         { x: 490, y: 330 },

    // MS (x=510-740, y=40-260) — upper right of Crane
    ms_conveyor:         { x: 555, y: 125 },
    ms_turntable:        { x: 620, y: 125 },
    ms_oven:             { x: 699, y: 183 },
    ms_saw:              { x: 608, y: 199 },
    ms_eject:            { x: 555, y: 196 },

    // PM (x=780-965, y=40-235) — far right, same height as MS
    pm_entry:            { x: 815, y: 167 },
    pm_tool:             { x: 864, y: 167 },
    pm_exit:             { x: 890, y: 167 },

    // SL (x=510-740, y=350-535) — lower right of Crane
    sl_entry:            { x: 548, y: 425 },
    sl_sensor:           { x: 607, y: 425 },
    sl_white:            { x: 670, y: 410 },
    sl_red:              { x: 670, y: 440 },
    sl_blue:             { x: 670, y: 473 }
};

// Station progression order (used for forward-only movement heuristic)
const STATION_PROGRESSION = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

// Connection path IDs between stations
const CONNECTIONS = {
    'hbw-crane':  'conn-hbw-crane',
    'crane-ms':   'conn-crane-ms',
    'ms-pm':      'conn-ms-pm',
    'crane-sl':   'conn-crane-sl',
    'sl-hbw':     'conn-sl-hbw'
};

const POLL_INTERVAL   = 400;   // ms
const LERP_SPEED      = 0.08;  // smooth interpolation factor
const TRAIL_MAX       = 8;     // max trail dots per workpiece
const TRAIL_INTERVAL  = 120;   // ms between trail drops
const FADEOUT_MS      = 500;   // fade-out duration when sorted
const SVG_NS          = 'http://www.w3.org/2000/svg';

// ============================================================
//  WORKPIECE CLASS
// ============================================================

let _wpIdCounter = 0;

class Workpiece {
    constructor() {
        this.id = ++_wpIdCounter;
        this.currentPos = { x: 0, y: 0 };
        this.targetPos  = { x: 0, y: 0 };
        this.color      = '#888';       // grey = unknown
        this.colorName  = null;         // null until detected at SL
        this.colorCSS   = null;
        this.colorValue = null;
        this.station    = null;         // current station name (HBW, Crane, ...)
        this.waypoint   = null;         // current waypoint key
        this.prevWaypoint = null;
        this.visible    = false;
        this.svgGroup   = null;         // SVG <g> element
        this.svgBody    = null;         // the main circle
        this.trailDots  = [];
        this.lastTrailTime = 0;
        this.fadingOut  = false;        // true during fade-out animation
        this.fadeStart  = 0;            // timestamp when fade started
        this.removed    = false;        // marked for cleanup
        this.createdAt  = performance.now();
    }
}

// ============================================================
//  WORKPIECE MANAGER
// ============================================================

class WorkpieceManager {
    constructor() {
        this.workpieces = [];           // active workpieces
        this.hbwWasActive = false;      // edge detection for HBW start
    }

    // --- SVG creation for a workpiece ---
    createSvgElements(wp) {
        const svg = document.getElementById('factory-svg');
        if (!svg) return;

        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('id', 'workpiece-' + wp.id);
        g.setAttribute('visibility', 'hidden');
        g.setAttribute('filter', 'url(#glow-wp)');

        // Outer glow rings
        const trail1 = document.createElementNS(SVG_NS, 'circle');
        trail1.setAttribute('r', '16');
        trail1.setAttribute('fill', 'currentColor');
        trail1.setAttribute('opacity', '0.06');
        trail1.classList.add('wp-trail');
        g.appendChild(trail1);

        const trail2 = document.createElementNS(SVG_NS, 'circle');
        trail2.setAttribute('r', '12');
        trail2.setAttribute('fill', 'currentColor');
        trail2.setAttribute('opacity', '0.1');
        trail2.classList.add('wp-trail');
        g.appendChild(trail2);

        // Main body
        const body = document.createElementNS(SVG_NS, 'circle');
        body.setAttribute('r', '7');
        body.setAttribute('fill', '#888');
        body.setAttribute('stroke', 'rgba(255,255,255,0.4)');
        body.setAttribute('stroke-width', '1.5');
        body.classList.add('wp-body');
        body.setAttribute('id', 'wp-body-' + wp.id);
        g.appendChild(body);

        // Highlight
        const highlight = document.createElementNS(SVG_NS, 'circle');
        highlight.setAttribute('r', '3');
        highlight.setAttribute('fill', 'rgba(255,255,255,0.3)');
        highlight.classList.add('wp-highlight');
        g.appendChild(highlight);

        // Insert after trail-group so workpieces render on top of trails
        const trailGroup = document.getElementById('trail-group');
        if (trailGroup && trailGroup.nextSibling) {
            svg.insertBefore(g, trailGroup.nextSibling);
        } else {
            svg.appendChild(g);
        }

        wp.svgGroup = g;
        wp.svgBody = body;
    }

    // --- Remove SVG elements for a workpiece ---
    removeSvgElements(wp) {
        // Remove trail dots
        for (const dot of wp.trailDots) {
            if (dot.el.parentNode) dot.el.parentNode.removeChild(dot.el);
        }
        wp.trailDots = [];

        // Remove group
        if (wp.svgGroup && wp.svgGroup.parentNode) {
            wp.svgGroup.parentNode.removeChild(wp.svgGroup);
        }
        wp.svgGroup = null;
        wp.svgBody = null;
    }

    // --- Spawn a new workpiece at HBW ---
    spawn() {
        const wp = new Workpiece();
        this.createSvgElements(wp);
        this.workpieces.push(wp);
        return wp;
    }

    // --- Start fade-out for a workpiece (sorted into bin) ---
    startFadeOut(wp, timestamp) {
        if (wp.fadingOut) return;
        wp.fadingOut = true;
        wp.fadeStart = timestamp || performance.now();
    }

    // --- Clean up removed workpieces ---
    cleanup() {
        const toRemove = this.workpieces.filter(wp => wp.removed);
        for (const wp of toRemove) {
            this.removeSvgElements(wp);
        }
        this.workpieces = this.workpieces.filter(wp => !wp.removed);
    }

    // --- Get workpiece at a given station (or closest match) ---
    getAtStation(stationName) {
        return this.workpieces.find(wp =>
            !wp.fadingOut && !wp.removed && wp.station === stationName
        );
    }

    // --- Count active (non-fading, non-removed) workpieces ---
    activeCount() {
        return this.workpieces.filter(wp => !wp.fadingOut && !wp.removed).length;
    }

    // --- Get all workpieces (including fading) ---
    all() {
        return this.workpieces.filter(wp => !wp.removed);
    }
}

// ============================================================
//  STATE
// ============================================================

let stationStates    = {};
let cachedCycleTimes = {};
let lastColorValue   = null;
let lastColorName    = null;
let lastColorCSS     = null;
let craneAngle       = 0;
let tooltipTimeout   = null;
let latestData       = null;
let sawWasSpinning   = false;
let ovenWasBurning   = false;
let punchWasDropping = false;

// Multi-workpiece manager
const wpManager = new WorkpieceManager();

// Track previous station activity for edge detection
let prevStationActive = {};

// ============================================================
//  THEME TOGGLE
// ============================================================

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

// ============================================================
//  SETTINGS PANEL
// ============================================================

function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    const overlay = document.getElementById('settings-overlay');
    const btn = document.querySelector('.settings-toggle');
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
        panel.classList.remove('open');
        overlay.classList.remove('visible');
        if (btn) btn.classList.remove('active');
    } else {
        panel.classList.add('open');
        overlay.classList.add('visible');
        if (btn) btn.classList.add('active');
    }
}

function setDataMode(mode) {
    if (mode === 'live' || mode === 'history') return;
    localStorage.setItem('dataMode', mode);
    applyDataModeUI(mode);
    showSettingsToast('Data source: ' + mode.charAt(0).toUpperCase() + mode.slice(1));
}

function setAudienceProfile(profile) {
    localStorage.setItem('audienceProfile', profile);
    applyAudienceProfileUI(profile);
    applyNavVisibility(profile);
    showSettingsToast('Profile: ' + profile.charAt(0).toUpperCase() + profile.slice(1));
}

function applyDataModeUI(mode) {
    var group = document.getElementById('data-mode-group');
    if (!group) return;
    group.querySelectorAll('.toggle-option').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
}

function applyAudienceProfileUI(profile) {
    var group = document.getElementById('audience-profile-group');
    if (!group) return;
    group.querySelectorAll('.toggle-option').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-profile') === profile);
    });
}

function applyNavVisibility(profile) {
    var nav = document.querySelector('.dash-nav');
    if (!nav) return;
    nav.querySelectorAll('a').forEach(function(link) {
        var href = link.getAttribute('href');
        if (profile === 'management' && (href === '/twin' || href === '/quality')) {
            link.classList.add('nav-hidden');
        } else {
            link.classList.remove('nav-hidden');
        }
    });
}

function showSettingsToast(message) {
    var toast = document.getElementById('settings-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() { toast.classList.remove('visible'); }, 2000);
}

function initSettings() {
    var mode = localStorage.getItem('dataMode') || 'demo';
    var profile = localStorage.getItem('audienceProfile') || 'engineer';
    applyDataModeUI(mode);
    applyAudienceProfileUI(profile);
    applyNavVisibility(profile);
}

// ============================================================
//  DATA FETCHING
// ============================================================

async function fetchData() {
    try {
        const resp = await fetch('/api/data');
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        return null;
    }
}

async function fetchAnalytics(endpoint) {
    try {
        const resp = await fetch('/api/analytics/' + endpoint);
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        return null;
    }
}

// ============================================================
//  HELPER: Check boolean sensor/actuator values
// ============================================================

function isOn(station, group, label) {
    const val = station?.[group]?.[label];
    return val === true || val === 'True';
}

// Check if any actuator in this station is currently active
function hasActiveActuator(station) {
    const acts = station?.actuators;
    if (!acts) return false;
    for (const key in acts) {
        if (acts[key] === true || acts[key] === 'True') return true;
    }
    return false;
}

// ============================================================
//  PER-STATION WAYPOINT DETECTION
//  (Split from old monolithic determineWorkpiecePosition)
// ============================================================

function detectHBWWaypoint(data) {
    const hbw = data.HBW || {};
    if (isOn(hbw, 'actuators', 'Motor Conveyor Belt Forward')) return 'hbw_conveyor_start';
    if (isOn(hbw, 'actuators', 'Motor Cantilever Forward') || isOn(hbw, 'actuators', 'Motor Cantilever Backward')) return 'hbw_rack';
    if (isOn(hbw, 'actuators', 'Motor Stacker Crane \u2192 Rack') ||
        isOn(hbw, 'actuators', 'Motor Stacker Crane Downward') ||
        isOn(hbw, 'actuators', 'Motor Stacker Crane Upward') ||
        isOn(hbw, 'actuators', 'Motor Stacker Crane \u2192 Conv Belt')) return 'hbw_rack';
    return null;
}

function detectCraneWaypoint(data) {
    const crane = data.Crane || {};
    if (isOn(crane, 'actuators', 'Motor Counterclockwise') ||
        (isOn(crane, 'actuators', 'Motor Forward') && !isOn(crane, 'actuators', 'Motor Clockwise'))) return 'crane_place';
    if (isOn(crane, 'actuators', 'Valve') || isOn(crane, 'actuators', 'Motor Downward') || isOn(crane, 'actuators', 'Motor Upward')) return 'crane_center';
    if (isOn(crane, 'actuators', 'Motor Clockwise') || isOn(crane, 'actuators', 'Compressor')) return 'crane_pickup';
    if (isOn(crane, 'actuators', 'Motor Backward')) return 'crane_center';
    return null;
}

function detectMSWaypoint(data) {
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

function detectPMWaypoint(data) {
    const pm = data.PM || {};
    if (isOn(pm, 'actuators', 'Motor Tool Downward') || isOn(pm, 'actuators', 'Motor Tool Upward')) return 'pm_tool';
    if (isOn(pm, 'actuators', 'Motor Conveyor Belt Forward')) {
        if (!isOn(pm, 'sensors', 'Light Barrier Tool')) return 'pm_tool';
        return 'pm_entry';
    }
    if (hasActiveActuator(pm)) return 'pm_entry';
    return null;
}

function detectSLWaypoint(data) {
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

// Map of per-station waypoint detectors
const STATION_WAYPOINT_DETECTORS = {
    HBW:   detectHBWWaypoint,
    Crane: detectCraneWaypoint,
    MS:    detectMSWaypoint,
    PM:    detectPMWaypoint,
    SL:    detectSLWaypoint
};

// Detect all active stations and their waypoints this tick
function detectActiveStationWaypoints(data) {
    const result = {};
    for (const station of STATION_ORDER) {
        const wp = STATION_WAYPOINT_DETECTORS[station](data);
        if (wp) {
            result[station] = wp;
        }
    }
    return result;
}

// Which station the waypoint belongs to
function waypointStation(wp) {
    if (!wp) return null;
    if (wp.startsWith('hbw'))   return 'HBW';
    if (wp.startsWith('crane')) return 'Crane';
    if (wp.startsWith('ms'))    return 'MS';
    if (wp.startsWith('pm'))    return 'PM';
    if (wp.startsWith('sl'))    return 'SL';
    return null;
}

// Station index in progression (higher = further along)
function stationIndex(stationName) {
    const idx = STATION_PROGRESSION.indexOf(stationName);
    return idx >= 0 ? idx : -1;
}

// Is this a sorting-bin waypoint (workpiece has been sorted)?
function isSortingBin(wp) {
    return wp === 'sl_white' || wp === 'sl_red' || wp === 'sl_blue';
}

// ============================================================
//  COLOR DETECTION
// ============================================================

function detectColor(data) {
    if (!data) return null;
    const sl = data.SL || {};
    const colorVal = sl?.sensors?.['Color Sensor'];
    if (typeof colorVal === 'number' && colorVal > 10) {
        if (colorVal >= 250) return { name: 'white', css: '#e8e8e8', value: colorVal };
        if (colorVal >= 130) return { name: 'red',   css: '#FF453A',  value: colorVal };
        if (colorVal >= 40)  return { name: 'blue',  css: '#007AFF',  value: colorVal };
    }
    return null;
}

// ============================================================
//  STATION STATUS DERIVATION
// ============================================================

function deriveStationStatus(data) {
    const states = {};
    if (!data || !data.data) return states;

    for (const station of STATION_ORDER) {
        const sd = data.data[station];
        if (!sd) {
            states[station] = { active: false, actuatorCount: 0, sensorCount: 0 };
            continue;
        }

        const actuators = sd.actuators || {};
        const sensors   = sd.sensors   || {};
        let aCount = 0;
        let sCount = 0;

        for (const key in actuators) {
            if (actuators[key] === true || actuators[key] === 'True') aCount++;
        }
        for (const key in sensors) {
            if (sensors[key] === true || sensors[key] === 'True') sCount++;
        }

        // Station is "active" only when at least one actuator is on.
        // Many sensors (light barriers, ref switches) are normally-closed
        // and read True at rest, so sensor count alone is unreliable.
        states[station] = {
            active: aCount > 0,
            actuatorCount: aCount,
            sensorCount: sCount
        };
    }
    return states;
}

// ============================================================
//  SVG ELEMENT UPDATES
// ============================================================

// --- Traffic Lights ---
function updateTrafficLights(states) {
    for (const station of STATION_ORDER) {
        const light = document.getElementById('light-' + station.toLowerCase());
        if (!light) continue;
        const s = states[station];
        if (s && s.active) {
            light.classList.add('active');
            light.classList.remove('idle');
        } else {
            light.classList.remove('active');
            light.classList.add('idle');
        }
    }
}

// --- Station Glow ---
function updateStationGlows(states) {
    for (const station of STATION_ORDER) {
        const group = document.getElementById('station-' + station.toLowerCase());
        if (!group) continue;
        const s = states[station];
        const bg = group.querySelector('.station-bg');
        if (!bg) continue;

        if (s && s.active) {
            bg.setAttribute('stroke-opacity', '0.6');
            group.style.filter = 'url(#glow-' + station.toLowerCase() + ')';
            group.classList.add('active');
        } else {
            bg.setAttribute('stroke-opacity', '0.3');
            group.style.filter = 'none';
            group.classList.remove('active');
        }
    }
}

// --- Oven Effect ---
function updateOvenEffect(data) {
    const ovenGlow = document.getElementById('oven-glow');
    if (!ovenGlow || !data || !data.data) return;

    const ms = data.data.MS || {};
    const lampOn = isOn(ms, 'actuators', 'Lamp');

    if (lampOn) {
        if (!ovenWasBurning) {
            ovenGlow.classList.add('burning');
            ovenGlow.setAttribute('fill-opacity', '0.25');
            ovenWasBurning = true;
        }
    } else {
        if (ovenWasBurning) {
            ovenGlow.classList.remove('burning');
            ovenGlow.setAttribute('fill-opacity', '0');
            ovenWasBurning = false;
        }
    }
}

// --- Saw Effect ---
function updateSawEffect(data) {
    const sawGroup = document.getElementById('saw-blade-group');
    if (!sawGroup || !data || !data.data) return;

    const ms = data.data.MS || {};
    const sawOn = isOn(ms, 'actuators', 'Motor Saw');

    if (sawOn && !sawWasSpinning) {
        sawGroup.classList.add('spinning');
        sawWasSpinning = true;
    } else if (!sawOn && sawWasSpinning) {
        sawGroup.classList.remove('spinning');
        sawWasSpinning = false;
    }
}

// --- Punch Effect ---
function updatePunchEffect(data) {
    const punchTip  = document.getElementById('punch-tip');
    const punchShaft = document.getElementById('punch-shaft');
    if (!punchTip || !data || !data.data) return;

    const pm = data.data.PM || {};
    const toolDown = isOn(pm, 'actuators', 'Motor Tool Downward');

    if (toolDown && !punchWasDropping) {
        punchTip.classList.add('punching');
        punchWasDropping = true;
    } else if (!toolDown && punchWasDropping) {
        punchTip.classList.remove('punching');
        punchWasDropping = false;
    }
}

// --- Crane Arm Rotation ---
function updateCraneArm(states, data) {
    const arm     = document.getElementById('crane-arm');
    const gripper = document.getElementById('crane-gripper');
    const gripIn  = document.getElementById('crane-gripper-inner');
    if (!arm || !gripper) return;

    const cs = states.Crane;
    if (cs && cs.active) {
        const crane = data?.data?.Crane || {};
        const cw  = isOn(crane, 'actuators', 'Motor Clockwise');
        const ccw = isOn(crane, 'actuators', 'Motor Counterclockwise');
        if (cw) craneAngle = (craneAngle + 2.5) % 360;
        else if (ccw) craneAngle = (craneAngle - 2.5 + 360) % 360;
        else craneAngle = (craneAngle + 1.5) % 360;
    }

    const rad = (craneAngle * Math.PI) / 180;
    const cx = 435, cy = 340, len = 50;
    const ex = cx + Math.sin(rad) * len;
    const ey = cy - Math.cos(rad) * len;

    arm.setAttribute('x2', ex.toFixed(1));
    arm.setAttribute('y2', ey.toFixed(1));
    gripper.setAttribute('cx', ex.toFixed(1));
    gripper.setAttribute('cy', ey.toFixed(1));
    if (gripIn) {
        gripIn.setAttribute('cx', ex.toFixed(1));
        gripIn.setAttribute('cy', ey.toFixed(1));
    }
}

// --- Connection Paths (multi-workpiece aware) ---
function updateConnectionPaths(workpieces) {
    // Deactivate all
    for (const key in CONNECTIONS) {
        const pathEl = document.getElementById(CONNECTIONS[key]);
        if (pathEl) pathEl.classList.remove('active');
    }

    // Activate connections for all active workpieces
    const adj = {
        HBW:   ['hbw-crane'],
        Crane: ['hbw-crane', 'crane-ms', 'crane-sl'],
        MS:    ['crane-ms', 'ms-pm'],
        PM:    ['ms-pm'],
        SL:    ['crane-sl', 'sl-hbw']
    };

    for (const wp of workpieces) {
        if (wp.fadingOut || wp.removed || !wp.waypoint) continue;
        const station = waypointStation(wp.waypoint);
        if (!station) continue;

        const conns = adj[station] || [];
        for (const c of conns) {
            const pathEl = document.getElementById(CONNECTIONS[c]);
            if (pathEl) pathEl.classList.add('active');
        }
    }
}

// --- Sorting Bin Lights ---
function updateBinLights(data) {
    if (!data || !data.data) return;
    const sl = data.data.SL || {};

    const bins = [
        { id: 'bin-light-white', sensor: 'Light Barrier White', valve: 'Valve White', color: '#e8e8e8' },
        { id: 'bin-light-red',   sensor: 'Light Barrier Red',   valve: 'Valve Red',   color: '#FF453A' },
        { id: 'bin-light-blue',  sensor: 'Light Barrier Blue',  valve: 'Valve Blue',  color: '#007AFF' }
    ];

    for (const bin of bins) {
        const el = document.getElementById(bin.id);
        if (!el) continue;
        // Light barriers are normally-closed (True at rest), so only use valve
        // activation or light barrier going False (beam blocked) as evidence
        const active = isOn(sl, 'actuators', bin.valve) ||
                       (!isOn(sl, 'sensors', bin.sensor) && hasActiveActuator(sl));
        if (active) {
            el.setAttribute('fill', bin.color);
            el.setAttribute('r', '4');
            el.style.filter = 'drop-shadow(0 0 4px ' + bin.color + ')';
        } else {
            el.setAttribute('fill', 'transparent');
            el.setAttribute('r', '3');
            el.style.filter = 'none';
        }
    }
}

// ============================================================
//  MULTI-WORKPIECE STATE MACHINE
// ============================================================

function updateWorkpieces(data) {
    const allData = data?.data;
    if (!allData) return;

    // Detect which stations are currently producing waypoints
    const activeWaypoints = detectActiveStationWaypoints(allData);
    const currentActivity = {};
    for (const station of STATION_ORDER) {
        currentActivity[station] = !!activeWaypoints[station];
    }

    // --- STEP 1: Detect HBW activation (rising edge) -> spawn new workpiece ---
    const hbwActive = currentActivity.HBW;
    const hbwWp = activeWaypoints.HBW;
    const hbwIsRetrieving = hbwWp === 'hbw_rack' || hbwWp === 'hbw_conveyor_start';

    if (hbwActive && hbwIsRetrieving && !wpManager.hbwWasActive) {
        // Only spawn if no existing workpiece is already at HBW
        const existingAtHBW = wpManager.getAtStation('HBW');
        if (!existingAtHBW && wpManager.activeCount() < 2) {
            const newWp = wpManager.spawn();
            newWp.station = 'HBW';
            newWp.waypoint = hbwWp;
        }
    }
    wpManager.hbwWasActive = hbwActive && hbwIsRetrieving;

    // --- STEP 2: Assign station waypoints to workpieces ---
    // For each station that shows activity, find the right workpiece
    // to assign the waypoint to. Strategy:
    //   1) If a workpiece is already at this station, update it.
    //   2) Otherwise, find the nearest workpiece from an earlier station
    //      (forward-only progression).
    //   3) For the very first workpiece, spawn as failsafe at HBW.

    for (const station of STATION_ORDER) {
        const wp = activeWaypoints[station];
        if (!wp) continue;

        let assignedWp = null;

        // Check if a workpiece is already at this station
        assignedWp = wpManager.getAtStation(station);

        // If not, look for the best candidate from a prior station
        if (!assignedWp) {
            const sIdx = stationIndex(station);
            let bestCandidate = null;
            let bestDist = 999;

            for (const w of wpManager.workpieces) {
                if (w.fadingOut || w.removed) continue;
                const wIdx = stationIndex(w.station);
                // Only allow forward movement
                if (wIdx >= 0 && wIdx < sIdx) {
                    const dist = sIdx - wIdx;
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestCandidate = w;
                    }
                }
            }

            // Advance the workpiece forward if its previous station went idle
            // or it is exactly one step behind
            if (bestCandidate) {
                const prevStation = bestCandidate.station;
                const nowActive = currentActivity[prevStation];
                if (!nowActive || bestDist === 1) {
                    assignedWp = bestCandidate;
                    assignedWp.station = station;
                }
            }
        }

        // Failsafe: if no workpieces exist at all, spawn at HBW
        if (!assignedWp && wpManager.activeCount() === 0 && station === 'HBW') {
            assignedWp = wpManager.spawn();
            assignedWp.station = 'HBW';
        }

        // Update position target
        if (assignedWp && WAYPOINTS[wp]) {
            const prevWp = assignedWp.waypoint;
            assignedWp.waypoint = wp;
            assignedWp.station = station;

            const pos = WAYPOINTS[wp];
            assignedWp.targetPos.x = pos.x;
            assignedWp.targetPos.y = pos.y;

            if (!assignedWp.visible) {
                // First appearance: jump to position instantly
                assignedWp.currentPos.x = pos.x;
                assignedWp.currentPos.y = pos.y;
                assignedWp.visible = true;
                if (assignedWp.svgGroup) {
                    assignedWp.svgGroup.setAttribute('visibility', 'visible');
                }
            }

            assignedWp.prevWaypoint = prevWp;
        }
    }

    // --- STEP 3: Color detection at SL ---
    const colorResult = detectColor(allData);
    if (colorResult) {
        // Apply color to the workpiece currently at SL that has no color yet
        const slWp = wpManager.getAtStation('SL');
        if (slWp && !slWp.colorName) {
            const prevColor = slWp.color;
            slWp.color = colorResult.css;
            slWp.colorName = colorResult.name;
            slWp.colorCSS = colorResult.css;
            slWp.colorValue = colorResult.value;

            // Update global KPI tracking
            lastColorName  = colorResult.name;
            lastColorCSS   = colorResult.css;
            lastColorValue = colorResult.value;

            // Flash animation on color reveal
            if (prevColor !== colorResult.css && slWp.svgBody) {
                slWp.svgBody.classList.remove('color-flash');
                void slWp.svgBody.offsetWidth; // force reflow
                slWp.svgBody.classList.add('color-flash');
            }
        }
    }

    // --- STEP 4: Detect sorting (bin waypoint) -> start fade-out ---
    for (const w of wpManager.workpieces) {
        if (w.fadingOut || w.removed) continue;
        if (w.waypoint && isSortingBin(w.waypoint)) {
            wpManager.startFadeOut(w, performance.now());
        }
    }

    // --- STEP 5: Update SVG fills for all workpieces ---
    for (const w of wpManager.workpieces) {
        if (w.removed) continue;
        if (w.svgBody) {
            w.svgBody.setAttribute('fill', w.color);
        }
    }

    // --- STEP 6: Update connection paths ---
    updateConnectionPaths(wpManager.workpieces);

    // Save activity for next tick
    prevStationActive = { ...currentActivity };
}

// ============================================================
//  TRAIL EFFECT (per workpiece)
// ============================================================

function dropTrailForWorkpiece(wp, timestamp) {
    if (!wp.visible || wp.fadingOut) return;
    if (timestamp - wp.lastTrailTime < TRAIL_INTERVAL) return;
    wp.lastTrailTime = timestamp;

    const trailGroup = document.getElementById('trail-group');
    if (!trailGroup) return;

    // Only drop trail if workpiece is actually moving
    const dx = wp.targetPos.x - wp.currentPos.x;
    const dy = wp.targetPos.y - wp.currentPos.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', wp.currentPos.x.toFixed(1));
    dot.setAttribute('cy', wp.currentPos.y.toFixed(1));
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', wp.color);
    dot.classList.add('trail-dot');
    trailGroup.appendChild(dot);
    wp.trailDots.push({ el: dot, time: timestamp });

    // Per-workpiece trail limit
    while (wp.trailDots.length > TRAIL_MAX) {
        const old = wp.trailDots.shift();
        if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
}

function pruneTrailsForWorkpiece(wp, timestamp) {
    const maxAge = 1800; // ms
    while (wp.trailDots.length > 0 && timestamp - wp.trailDots[0].time > maxAge) {
        const old = wp.trailDots.shift();
        if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
}

// ============================================================
//  ANIMATION LOOP (requestAnimationFrame)
// ============================================================

function animationLoop(timestamp) {
    // Update ALL workpieces
    for (const wp of wpManager.workpieces) {
        if (wp.removed) continue;

        // --- Fade-out animation ---
        if (wp.fadingOut) {
            const elapsed = timestamp - wp.fadeStart;
            const progress = Math.min(elapsed / FADEOUT_MS, 1);
            const opacity = 1 - progress;

            if (wp.svgGroup) {
                wp.svgGroup.style.opacity = opacity.toFixed(2);
            }

            if (progress >= 1) {
                wp.removed = true;
                continue;
            }
        }

        // --- Lerp position ---
        wp.currentPos.x += (wp.targetPos.x - wp.currentPos.x) * LERP_SPEED;
        wp.currentPos.y += (wp.targetPos.y - wp.currentPos.y) * LERP_SPEED;

        // --- Update SVG transform ---
        if (wp.svgGroup && wp.visible) {
            wp.svgGroup.setAttribute('transform',
                'translate(' + wp.currentPos.x.toFixed(1) + ',' + wp.currentPos.y.toFixed(1) + ')');
        }

        // --- Trails ---
        dropTrailForWorkpiece(wp, timestamp);
        pruneTrailsForWorkpiece(wp, timestamp);
    }

    // Cleanup fully removed workpieces
    wpManager.cleanup();

    // Crane arm (smooth even between polls)
    if (stationStates.Crane && stationStates.Crane.active) {
        updateCraneArm(stationStates, latestData);
    }

    requestAnimationFrame(animationLoop);
}

// ============================================================
//  KPI UPDATES
// ============================================================

function updateKPIs(data) {
    // Progress
    if (data && data.progress !== undefined) {
        const pct = Math.round(data.progress * 100);
        const el  = document.getElementById('kpi-progress');
        const bar = document.getElementById('progress-bar');
        if (el) el.textContent = pct + '%';
        if (bar) bar.style.width = pct + '%';
    }

    // Color swatch
    updateColorKPI();
}

function updateColorKPI() {
    const swatch = document.getElementById('kpi-color-swatch');
    const value  = document.getElementById('kpi-color-value');

    if (lastColorName && swatch) {
        swatch.innerHTML = '<span class="color-circle ' + lastColorName + '"></span>';
    }
    if (lastColorValue !== null && value) {
        value.textContent = lastColorValue;
    }
}

async function updateAnalyticsKPIs() {
    // Throughput
    const throughput = await fetchAnalytics('throughput');
    if (throughput) {
        const el = document.getElementById('kpi-throughput');
        if (el) el.textContent = throughput.per_hour || '--';
    }

    // Bottleneck
    const bottleneck = await fetchAnalytics('bottleneck');
    if (bottleneck) {
        const stationEl = document.getElementById('kpi-bottleneck-station');
        const timeEl    = document.getElementById('kpi-bottleneck-time');
        if (stationEl) stationEl.textContent = bottleneck.station || '--';
        if (timeEl) timeEl.textContent = bottleneck.avg_cycle_time
            ? bottleneck.avg_cycle_time.toFixed(1) + 's'
            : '--';
        if (stationEl && bottleneck.station && STATION_COLORS[bottleneck.station]) {
            stationEl.style.color = STATION_COLORS[bottleneck.station];
        }
    }
}

async function refreshCycleTimes() {
    const data = await fetchAnalytics('cycle-times');
    if (data && data.length > 0) {
        const latest = data[data.length - 1];
        if (latest && latest.stations) {
            for (const s of STATION_ORDER) {
                const ct = latest.stations[s];
                cachedCycleTimes[s] = (ct !== null && ct !== undefined)
                    ? ct.toFixed(1) + 's'
                    : '--';
            }
        }
    }
}

// ============================================================
//  TOOLTIP LOGIC
// ============================================================

function setupTooltips() {
    const tooltip      = document.getElementById('station-tooltip');
    const svgContainer = document.getElementById('svg-container');
    if (!tooltip || !svgContainer) return;

    STATION_ORDER.forEach(station => {
        const group = document.getElementById('station-' + station.toLowerCase());
        if (!group) return;

        group.addEventListener('mouseenter', (e) => {
            if (tooltipTimeout) clearTimeout(tooltipTimeout);
            showTooltip(station, e);
        });

        group.addEventListener('mousemove', (e) => {
            positionTooltip(e);
        });

        group.addEventListener('mouseleave', () => {
            tooltipTimeout = setTimeout(() => {
                tooltip.classList.remove('visible');
                setTimeout(() => { tooltip.style.display = 'none'; }, 200);
            }, 80);
        });
    });
}

function showTooltip(station, e) {
    const tooltip     = document.getElementById('station-tooltip');
    const nameEl      = document.getElementById('tooltip-name');
    const statusEl    = document.getElementById('tooltip-status');
    const cycleEl     = document.getElementById('tooltip-cycle');
    const actuatorsEl = document.getElementById('tooltip-actuators');

    const state = stationStates[station] || { active: false, actuatorCount: 0 };

    if (nameEl) {
        nameEl.textContent = station + ' \u2014 ' + (STATION_NAMES[station] || '');
        nameEl.style.color = STATION_COLORS[station] || 'inherit';
    }

    if (statusEl) {
        if (state.active) {
            statusEl.textContent = 'Active';
            statusEl.className = 'tooltip-status active';
        } else {
            statusEl.textContent = 'Idle';
            statusEl.className = 'tooltip-status idle';
        }
    }

    if (actuatorsEl) actuatorsEl.textContent = state.actuatorCount;
    if (cycleEl) cycleEl.textContent = cachedCycleTimes[station] || '--';

    tooltip.style.display = 'block';
    positionTooltip(e);
    requestAnimationFrame(() => { tooltip.classList.add('visible'); });
}

function positionTooltip(e) {
    const tooltip   = document.getElementById('station-tooltip');
    const container = document.getElementById('svg-container');
    if (!tooltip || !container) return;

    const rect = container.getBoundingClientRect();
    let x = e.clientX - rect.left + 16;
    let y = e.clientY - rect.top - 10;

    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    if (x + tw > rect.width - 10)  x = e.clientX - rect.left - tw - 16;
    if (y + th > rect.height - 10) y = rect.height - th - 10;
    if (y < 0) y = 10;

    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
}

// ============================================================
//  MAIN UPDATE (called every POLL_INTERVAL)
// ============================================================

async function update() {
    const data = await fetchData();
    if (!data) return;

    latestData = data;

    // Derive station states
    stationStates = deriveStationStatus(data);

    // Update SVG effects
    updateTrafficLights(stationStates);
    updateStationGlows(stationStates);
    updateOvenEffect(data);
    updateSawEffect(data);
    updatePunchEffect(data);
    updateCraneArm(stationStates, data);
    updateBinLights(data);

    // Multi-workpiece tracking (replaces old updateWorkpieceTarget)
    updateWorkpieces(data);

    // Update KPIs
    updateKPIs(data);
}

// ============================================================
//  INITIALIZATION
// ============================================================

function init() {
    // Remove the static workpiece SVG element from HTML —
    // workpieces are now created dynamically by WorkpieceManager
    const staticWp = document.getElementById('workpiece');
    if (staticWp && staticWp.parentNode) {
        staticWp.parentNode.removeChild(staticWp);
    }

    initSettings();
    setupTooltips();

    // Start animation loop (runs at display refresh rate)
    requestAnimationFrame(animationLoop);

    // Start data polling (400ms)
    setInterval(update, POLL_INTERVAL);

    // Slower analytics refresh (every 5s)
    updateAnalyticsKPIs();
    refreshCycleTimes();
    setInterval(() => {
        updateAnalyticsKPIs();
        refreshCycleTimes();
    }, 5000);

    // Initial data fetch
    update();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

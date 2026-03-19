/**
 * Executive Cockpit — Battery Cell Production Overview & Alerts
 *
 * Fetches analytics data once on load, polls /api/data every 2s
 * for live station status.
 */

const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};
const STATION_NAMES = {
    HBW: 'Cell Storage', Crane: 'Cell Handler', MS: 'Testing Station',
    PM: 'Marking Station', SL: 'Quality Classification'
};
const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

let timelineChart = null;
let pollTimer = null;
let analyticsData = {};

// ============================================
//  Theme
// ============================================

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateChartTheme();
}

// ============================================
//  Settings Panel
// ============================================

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

function isDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
}

function updateChartTheme() {
    if (!timelineChart) return;
    const dark = isDark();
    const tickColor = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)';
    const gridColor = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
    const tooltipBg = dark ? 'rgba(20,20,30,0.92)' : 'rgba(255,255,255,0.95)';
    const tooltipBorder = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
    const tooltipText = dark ? '#fff' : '#000';

    timelineChart.options.scales.x.ticks.color = tickColor;
    timelineChart.options.scales.x.grid.color = gridColor;
    timelineChart.options.scales.y.ticks.color = tickColor;
    timelineChart.options.plugins.tooltip.backgroundColor = tooltipBg;
    timelineChart.options.plugins.tooltip.borderColor = tooltipBorder;
    timelineChart.options.plugins.tooltip.titleColor = tooltipText;
    timelineChart.options.plugins.tooltip.bodyColor = tooltipText;
    timelineChart.update('none');
}

// ============================================
//  Initialization
// ============================================

async function init() {
    initSettings();
    await loadAnalytics();
    startPolling();
}

async function loadAnalytics() {
    try {
        const [summaryRes, alertsRes, timelineRes, cycleRes] = await Promise.all([
            fetch('/api/analytics/summary'),
            fetch('/api/analytics/alerts'),
            fetch('/api/analytics/timeline'),
            fetch('/api/analytics/cycle-times'),
        ]);

        const summary = await summaryRes.json();
        const alerts = await alertsRes.json();
        const timeline = await timelineRes.json();
        const cycleTimes = await cycleRes.json();

        analyticsData = { summary, alerts, timeline, cycleTimes };

        renderSQCDP(summary);
        renderAlerts(alerts);
        renderTimeline(timeline);
        renderCycleTimes(cycleTimes);
        renderShiftSummary(summary, alerts, cycleTimes);
    } catch (e) {
        console.error('Failed to load analytics:', e);
    }
}

// ============================================
//  SQCDP Tiles
// ============================================

function renderSQCDP(summary) {
    const oee = summary.oee || {};
    const throughput = summary.throughput || {};
    const quality = summary.quality || {};

    // S - Safety: check for emergency in data
    const safetyOk = true; // No emergency shutdown signal in analytics
    setSQCDP('s', safetyOk ? 'OK' : 'ALERT', safetyOk ? 'green' : 'red');

    // Q - Quality: First Pass Yield
    const fpy = quality.first_pass_yield || 0;
    const fpyPct = (fpy * 100).toFixed(1) + '%';
    const fpyColor = fpy > 0.8 ? 'green' : fpy >= 0.5 ? 'yellow' : 'red';
    setSQCDP('q', fpyPct, fpyColor);

    // C - Cost/OEE
    const oeeVal = oee.oee || 0;
    const oeePct = (oeeVal * 100).toFixed(1) + '%';
    const oeeColor = oeeVal > 0.85 ? 'green' : oeeVal >= 0.65 ? 'yellow' : 'red';
    setSQCDP('c', oeePct, oeeColor);

    // D - Delivery: throughput
    const perHour = throughput.per_hour || 0;
    const util = throughput.utilization || 0;
    const dText = perHour.toFixed(1) + '/hr';
    const dColor = util > 0.8 ? 'green' : util >= 0.5 ? 'yellow' : 'red';
    setSQCDP('d', dText, dColor);

    // P - Process: availability
    const avail = oee.availability || 0;
    const availPct = (avail * 100).toFixed(1) + '%';
    const pColor = avail > 0.9 ? 'green' : avail >= 0.7 ? 'yellow' : 'red';
    setSQCDP('p', availPct, pColor);
}

function setSQCDP(letter, value, colorClass) {
    const tile = document.getElementById('tile-' + letter);
    const valEl = document.getElementById('sqcdp-' + letter + '-value');
    if (!tile || !valEl) return;

    tile.classList.remove('green', 'yellow', 'red');
    tile.classList.add(colorClass);
    valEl.textContent = value;
}

// ============================================
//  Alert Log
// ============================================

function renderAlerts(alerts) {
    const list = document.getElementById('alert-list');
    const countEl = document.getElementById('alert-count');

    // Sort: errors first, then warnings, then info; then by run descending
    const severityOrder = { error: 0, warning: 1, info: 2 };
    const sorted = [...alerts].sort((a, b) => {
        const sA = severityOrder[a.severity] ?? 3;
        const sB = severityOrder[b.severity] ?? 3;
        if (sA !== sB) return sA - sB;
        return (b.run || 0) - (a.run || 0);
    });

    const display = sorted.slice(0, 20);
    countEl.textContent = alerts.length + ' total';

    if (display.length === 0) {
        list.innerHTML = '<div class="alert-empty">No alerts detected</div>';
        return;
    }

    list.innerHTML = display.map(a => {
        const stationColor = STATION_COLORS[a.station] || '#5AC8FA';
        const sevClass = a.severity || 'info';
        const runText = a.run ? 'Run #' + a.run : '';
        const tsText = a.timestamp ? a.timestamp.split(' ')[1] || '' : '';

        return `<div class="alert-item ${sevClass}">
            <span class="alert-station" style="background:${stationColor}">${a.station || '--'}</span>
            <div class="alert-content">
                <div class="alert-text">${a.message || 'Unknown alert'}</div>
                <div class="alert-run">${runText}${tsText ? ' | ' + tsText : ''}</div>
            </div>
        </div>`;
    }).join('');
}

// ============================================
//  Production Timeline (Gantt Chart)
// ============================================

function renderTimeline(timeline) {
    if (!timeline || timeline.length === 0) return;

    // Find the earliest timestamp to compute offsets
    let minTs = Infinity;
    for (const entry of timeline) {
        const ts = new Date(entry.start).getTime();
        if (ts < minTs) minTs = ts;
    }

    // Group by run, build datasets per station
    const runMap = {};
    for (const entry of timeline) {
        const runKey = entry.run;
        if (!runMap[runKey]) runMap[runKey] = {};
        const startOff = (new Date(entry.start).getTime() - minTs) / 1000;
        const endOff = (new Date(entry.end).getTime() - minTs) / 1000;
        runMap[runKey][entry.station] = [startOff, endOff];
    }

    const runs = Object.keys(runMap).map(Number).sort((a, b) => a - b);
    const datasets = [];

    for (const run of runs) {
        const runData = runMap[run];
        const opacity = 0.55 + (run % 3) * 0.15;

        for (const station of STATION_ORDER) {
            if (!runData[station]) continue;
            const [start, end] = runData[station];
            const color = STATION_COLORS[station];
            const rgbaFill = hexToRgba(color, opacity);
            const rgbaBorder = hexToRgba(color, Math.min(opacity + 0.3, 1.0));

            datasets.push({
                label: station + ' #' + run,
                data: STATION_ORDER.map(s => s === station ? [start, end] : null),
                backgroundColor: rgbaFill,
                borderColor: rgbaBorder,
                borderWidth: 1,
                borderRadius: 3,
                borderSkipped: false,
                barPercentage: 0.7,
                categoryPercentage: 0.85,
            });
        }
    }

    const ctx = document.getElementById('chart-timeline').getContext('2d');
    const dark = isDark();

    timelineChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: STATION_ORDER,
            datasets: datasets,
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: dark ? 'rgba(20,20,30,0.92)' : 'rgba(255,255,255,0.95)',
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: "'SF Mono', monospace", size: 11 },
                    titleColor: dark ? '#fff' : '#000',
                    bodyColor: dark ? '#fff' : '#000',
                    padding: 10,
                    cornerRadius: 8,
                    borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                    borderWidth: 1,
                    callbacks: {
                        title: function(items) {
                            if (!items.length) return '';
                            return items[0].dataset.label;
                        },
                        label: function(ctx) {
                            const val = ctx.raw;
                            if (!val) return '';
                            return 'Time: ' + val[0].toFixed(1) + 's - ' + val[1].toFixed(1) + 's (' + (val[1] - val[0]).toFixed(1) + 's)';
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Time (seconds)',
                        font: { family: 'Inter', size: 11, weight: '500' },
                        color: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
                    },
                    grid: {
                        color: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                        drawBorder: false,
                    },
                    ticks: {
                        color: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)',
                        font: { family: "'SF Mono', monospace", size: 10 },
                        callback: function(val) { return val + 's'; },
                    },
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)',
                        font: { family: 'Inter', size: 11, weight: '600' },
                    },
                },
            },
        },
    });
}

// ============================================
//  Cycle Times for Traffic Cards
// ============================================

function renderCycleTimes(cycleTimes) {
    if (!cycleTimes || cycleTimes.length === 0) return;

    const lastRun = cycleTimes[cycleTimes.length - 1];
    for (const station of STATION_ORDER) {
        const el = document.getElementById('cycle-' + station);
        if (!el) continue;
        const ct = lastRun.stations[station];
        el.textContent = ct != null ? ct.toFixed(1) + 's cycle' : 'No data';
    }
}

// ============================================
//  Shift Summary
// ============================================

function renderShiftSummary(summary, alerts, cycleTimes) {
    const quality = summary.quality || {};
    const gradeDist = quality.grade_distribution || {};

    // Total produced
    const totalEl = document.getElementById('sum-total');
    totalEl.textContent = (quality.total_produced || 0) + ' cells';

    // Grade distribution
    const gradesEl = document.getElementById('sum-grades');
    const aCount = gradeDist.A || 0;
    const bCount = gradeDist.B || 0;
    const cCount = gradeDist.C || 0;
    gradesEl.innerHTML =
        '<span class="grade-dot a"></span><span class="grade-count">' + aCount + '</span>' +
        '<span class="grade-sep">|</span>' +
        '<span class="grade-dot b"></span><span class="grade-count">' + bCount + '</span>' +
        '<span class="grade-sep">|</span>' +
        '<span class="grade-dot c"></span><span class="grade-count">' + cCount + '</span>';

    // Average cycle time
    const avgCycleEl = document.getElementById('sum-avg-cycle');
    if (cycleTimes && cycleTimes.length > 0) {
        const totals = cycleTimes.filter(r => r.total != null).map(r => r.total);
        if (totals.length > 0) {
            const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
            avgCycleEl.textContent = avg.toFixed(1) + 's';
        }
    }

    // Best run (fastest total)
    const bestEl = document.getElementById('sum-best');
    const worstEl = document.getElementById('sum-worst');
    if (cycleTimes && cycleTimes.length > 0) {
        const withTotals = cycleTimes.filter(r => r.total != null);
        if (withTotals.length > 0) {
            const best = withTotals.reduce((a, b) => a.total < b.total ? a : b);
            const worst = withTotals.reduce((a, b) => a.total > b.total ? a : b);
            bestEl.textContent = '#' + best.run + ' (' + best.total.toFixed(1) + 's)';
            worstEl.textContent = '#' + worst.run + ' (' + worst.total.toFixed(1) + 's)';
        }
    }

    // Alert count
    const alertsEl = document.getElementById('sum-alerts');
    if (alerts) {
        const warnings = alerts.filter(a => a.severity === 'warning').length;
        const errors = alerts.filter(a => a.severity === 'error').length;
        const infos = alerts.filter(a => a.severity === 'info').length;
        alertsEl.innerHTML =
            (errors > 0 ? '<span class="alert-count-err">' + errors + ' errors</span>, ' : '') +
            '<span class="alert-count-warn">' + warnings + ' warn</span>, ' +
            infos + ' info';
    }
}

// ============================================
//  Station Status Polling
// ============================================

function startPolling() {
    pollOnce();
}

async function pollOnce() {
    try {
        const res = await fetch('/api/data');
        const json = await res.json();
        updateStationStatus(json.data || {});
    } catch (e) {
        // Set all stations to idle on error
        for (const station of STATION_ORDER) {
            setStationLight(station, false);
        }
    }
    pollTimer = setTimeout(pollOnce, 2000);
}

function updateStationStatus(data) {
    for (const station of STATION_ORDER) {
        const stationData = data[station];
        let isActive = false;

        if (stationData) {
            for (const [groupName, vars] of Object.entries(stationData)) {
                for (const [label, value] of Object.entries(vars)) {
                    if (typeof value === 'boolean' && value === true) {
                        // Check if it's an actuator-like variable
                        if (/motor|valve|lamp|compressor/i.test(label)) {
                            isActive = true;
                        }
                    }
                }
            }
        }

        setStationLight(station, isActive);
    }
}

function setStationLight(station, active) {
    const light = document.getElementById('light-' + station);
    const stateEl = document.getElementById('state-' + station);
    if (!light || !stateEl) return;

    if (active) {
        light.className = 'traffic-light active';
        stateEl.textContent = 'Active';
        stateEl.classList.add('active-text');
    } else {
        light.className = 'traffic-light grey';
        stateEl.textContent = 'Idle';
        stateEl.classList.remove('active-text');
    }
}

// ============================================
//  Utilities
// ============================================

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

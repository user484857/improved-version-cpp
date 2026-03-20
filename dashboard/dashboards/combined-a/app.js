/**
 * Combined Dashboard A — Factory Overview
 *
 * Single-page dashboard combining:
 *   - KPI pills (avg cycle time, throughput, uptime)
 *   - Cycle time stacked comparison bars (4 stations, NO PM)
 *   - Digital twin SVG with timing pills
 *   - Color sensor scatter chart
 *   - Station timing cards with traffic lights
 *
 * Fetches from /api/analytics/* endpoints.
 * Refreshes every 8 seconds.
 */

// ============================================
//  Constants (NO PM station)
// ============================================

var STATIONS = [
    { key: 'HBW',   name: 'HBW',   fullName: 'High-Bay Warehouse', target: 10, color: '#AF52DE' },
    { key: 'Crane', name: 'Crane', fullName: 'Transport Crane',    target: 12, color: '#30D158' },
    { key: 'MS',    name: 'MS',    fullName: 'Machining Station',   target: 18, color: '#007AFF' },
    { key: 'SL',    name: 'SL',    fullName: 'Sorting Line',        target: 5,  color: '#FF9F0A' },
];

var TOTAL_TARGET = 45; // 10+12+18+5 (no PM)

var GRADE_COLORS = { A: '#f0f0f0', B: '#FF453A', C: '#007AFF' };
var GRADE_COLORS_LIGHT = { A: '#999999', B: '#FF3B30', C: '#007AFF' };
var TREND_COLOR = '#AF52DE';

// Twin station-to-timing mapping
var TWIN_STATIONS = [
    { pillId: 'hbw',   actionId: 'action-hbw',   cycleKey: 'HBW', tlId: 'tl-hbw',   target: 10 },
    { pillId: 'crane', actionId: 'action-crane', cycleKey: 'Crane', tlId: 'tl-crane', target: 12 },
    { pillId: 'oven',  actionId: 'action-oven',  cycleKey: 'MS',    tlId: 'tl-oven',  target: 18 },
    { pillId: 'color', actionId: 'action-color', cycleKey: 'SL',    tlId: 'tl-color', target: 5 },
    { pillId: 'sort',  actionId: 'action-sort',  cycleKey: 'SL',    tlId: 'tl-sort',  target: 5 },
];

// ============================================
//  State
// ============================================

var cycleData = [];
var qualityData = [];
var throughputData = null;
var summaryData = null;
var bottleneckData = null;
var avgActuals = {};
var chartScatter = null;

// Live polling state
var liveData = null;
var lastFetchTs = 0;
var activeStep = -1;
var prevStep = -1;
var activeStations = {};   // {hbw: bool, crane: bool, ms: bool, sl: bool}
var prevActiveStations = {};  // previous tick — for detecting station-off edges
var msSubStep = 'idle';    // 'conveyor'|'oven'|'saw'|'sort'|'idle'
var currentMode = 'live';

// Track last known cycle time per pill (persists across runs)
var lastKnownTimes = { hbw: null, crane: null, oven: null, color: null, sort: null, total: null };
var displayedTimes = { hbw: null, crane: null, oven: null, color: null, sort: null, total: null };
var lastKnownRunCount = 0;

// ============================================
//  Init
// ============================================

function init() {
    updateClock();
    setInterval(updateClock, 1000);
    loadData();
    setInterval(loadData, 8000);

    // Sync mode from server on page load
    fetch('/api/status').then(function(r) { return r.json(); }).then(function(s) {
        if (s.mode) {
            currentMode = s.mode;
            document.querySelectorAll('#mode-toggle .toggle-option').forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.mode === currentMode);
            });
        }
    }).catch(function() {});

    // Live polling for Digital Twin (400ms)
    setInterval(pollLiveData, 400);
    pollLiveData();
}

// ============================================
//  Clock
// ============================================

function updateClock() {
    var el = document.getElementById('header-clock');
    if (!el) return;
    var now = new Date();
    el.textContent = now.toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

// ============================================
//  Data Loading
// ============================================

async function fetchJSON(url) {
    try {
        var res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function loadData() {
    var results = await Promise.all([
        fetchJSON('/api/analytics/cycle-times'),
        fetchJSON('/api/analytics/quality-grades'),
        fetchJSON('/api/analytics/throughput'),
        fetchJSON('/api/analytics/summary'),
        fetchJSON('/api/analytics/bottleneck'),
    ]);

    cycleData = results[0] || [];
    qualityData = results[1] || [];
    throughputData = results[2];
    summaryData = results[3];
    bottleneckData = results[4];

    computeAverages();
    renderKPIs();
    renderStackedBars();
    renderTwinTimings();
    renderScatterChart();
    renderStationCards();
}

// ============================================
//  Compute Averages (NO PM)
// ============================================

function computeAverages() {
    var sums = {};
    var counts = {};
    STATIONS.forEach(function(st) { sums[st.key] = 0; counts[st.key] = 0; });

    cycleData.forEach(function(run) {
        STATIONS.forEach(function(st) {
            var v = run.stations[st.key];
            if (v != null) {
                sums[st.key] += v;
                counts[st.key]++;
            }
        });
    });

    STATIONS.forEach(function(st) {
        avgActuals[st.key] = counts[st.key] > 0
            ? sums[st.key] / counts[st.key]
            : st.target;
    });
}

// ============================================
//  KPI Pills
// ============================================

function renderKPIs() {
    // Average cycle time (total across 4 stations)
    var avgTotal = STATIONS.reduce(function(s, st) {
        return s + (avgActuals[st.key] || st.target);
    }, 0);
    var ctEl = document.getElementById('kpi-cycle-time');
    if (ctEl) ctEl.textContent = avgTotal.toFixed(1) + 's';

    // Throughput per hour
    var tpEl = document.getElementById('kpi-throughput');
    if (tpEl && throughputData) {
        tpEl.textContent = throughputData.per_hour.toFixed(1);
    }

    // Uptime
    var upEl = document.getElementById('kpi-uptime');
    if (upEl && summaryData && summaryData.oee) {
        var totalSec = summaryData.oee.total_time_s || 0;
        if (totalSec > 0) {
            var hours = Math.floor(totalSec / 3600);
            var mins = Math.floor((totalSec % 3600) / 60);
            upEl.textContent = hours + 'h ' + mins + 'm';
        } else {
            upEl.textContent = '--';
        }
    }
}

// ============================================
//  Stacked Comparison Bars (NO PM)
// ============================================

function renderStackedBars() {
    var runsLabel = document.getElementById('stacked-runs-label');
    if (runsLabel) runsLabel.textContent = cycleData.length + ' runs';

    var actualTotal = STATIONS.reduce(function(s, st) {
        return s + (avgActuals[st.key] || 0);
    }, 0);
    var maxTotal = Math.max(actualTotal, TOTAL_TARGET);

    // Actual bar
    var actualTrack = document.getElementById('stacked-actual-track');
    if (actualTrack) {
        actualTrack.innerHTML = STATIONS.map(function(st) {
            var val = avgActuals[st.key] || 0;
            var pct = (val / maxTotal) * 100;
            return '<div class="stacked-segment" style="width:' + pct.toFixed(1) + '%;background:' + st.color + '"'
                + ' title="' + st.key + ': ' + val.toFixed(1) + 's">'
                + (pct > 6 ? val.toFixed(1) + 's' : '') + '</div>';
        }).join('');
    }
    var actualTotalEl = document.getElementById('stacked-actual-total');
    if (actualTotalEl) actualTotalEl.textContent = actualTotal.toFixed(1) + 's';


    // Legend
    var legend = document.getElementById('stacked-legend');
    if (legend) {
        legend.innerHTML = STATIONS.map(function(st) {
            return '<div class="stacked-legend-item">'
                + '<div class="stacked-legend-dot" style="background:' + st.color + '"></div>'
                + '<span>' + st.key + '</span>'
                + '</div>';
        }).join('');
    }
}

// ============================================
//  Digital Twin Timings
// ============================================

function renderTwinTimings() {
    if (!cycleData.length) return;

    // Find last non-null value per station across ALL runs (not just last run)
    var twinPillMap = {
        hbw:   { cycle: 'HBW',   target: 10 },
        crane: { cycle: 'Crane', target: 12 },
        oven:  { cycle: 'MS',    target: 18 },
        color: { cycle: 'SL',    target: 5 },
        sort:  { cycle: 'SL',    target: 5 },
    };

    var stationAvgs = {};
    STATIONS.forEach(function(st) {
        stationAvgs[st.key] = avgActuals[st.key] || 0;
    });

    // Scan runs in reverse to find the most recent non-null value per station
    Object.keys(twinPillMap).forEach(function(pillKey) {
        var map = twinPillMap[pillKey];
        for (var i = cycleData.length - 1; i >= 0; i--) {
            var v = cycleData[i].stations[map.cycle];
            if (v != null) {
                lastKnownTimes[pillKey] = v;
                break;
            }
        }
    });

    // Find last non-null total
    for (var i = cycleData.length - 1; i >= 0; i--) {
        if (cycleData[i].total != null) {
            lastKnownTimes.total = cycleData[i].total;
            break;
        }
    }

    // Update SVG action labels with last known values
    TWIN_STATIONS.forEach(function(ts) {
        var actionEl = document.getElementById(ts.actionId);
        if (actionEl) {
            // Find last non-null for this specific twin station
            var val = null;
            for (var i = cycleData.length - 1; i >= 0; i--) {
                var v = cycleData[i].stations[ts.cycleKey];
                if (v != null) { val = v; break; }
            }
            if (val != null) {
                actionEl.textContent = val.toFixed(1) + 's';
            }
        }
    });

    // Update timing pills — always show last known, flash on change
    Object.keys(twinPillMap).forEach(function(pillKey) {
        var map = twinPillMap[pillKey];
        var val = lastKnownTimes[pillKey];
        var avgVal = stationAvgs[map.cycle];

        var timeEl = document.getElementById('time-' + pillKey);
        var avgEl = document.getElementById('avg-' + pillKey);
        var tlEl = document.getElementById('tl-' + pillKey);

        if (timeEl && val != null) {
            var newText = val.toFixed(1) + 's';
            // Flash if value changed
            if (displayedTimes[pillKey] !== null && displayedTimes[pillKey] !== val) {
                flashElement(timeEl);
            }
            timeEl.textContent = newText;
            displayedTimes[pillKey] = val;
        }
        if (avgEl && avgVal > 0) {
            avgEl.textContent = 'avg ' + avgVal.toFixed(1) + 's';
        }

        // Traffic light for timing pill dot
        if (tlEl && avgVal > 0) {
            var pctOver = ((avgVal - map.target) / map.target) * 100;
            tlEl.className = 'pill-dot';
            if (pctOver > 30) {
                tlEl.classList.add('tl-red');
            } else if (pctOver > 10) {
                tlEl.classList.add('tl-orange');
            } else {
                tlEl.classList.add('tl-green');
            }
        }
    });

    // Total — show last known, flash on change
    var totalEl = document.getElementById('time-total');
    var totalVal = lastKnownTimes.total;
    if (totalEl && totalVal != null) {
        if (displayedTimes.total !== null && displayedTimes.total !== totalVal) {
            flashElement(totalEl);
        }
        totalEl.textContent = totalVal.toFixed(1) + 's';
        displayedTimes.total = totalVal;
    }
}

// Flash animation helper — briefly highlights an element
function flashElement(el) {
    el.classList.remove('value-flash');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('value-flash');
}

// ============================================
//  Color Sensor Scatter Chart
// ============================================

function renderScatterChart() {
    if (!qualityData || !qualityData.length) return;

    var dark = isDark();
    var gc = dark ? GRADE_COLORS : GRADE_COLORS_LIGHT;
    var tc = themeColors();

    // Build scatter points
    var scatterData = qualityData
        .filter(function(g) { return g.color_value != null; })
        .map(function(g) {
            return { x: g.run, y: g.color_value, grade: g.grade };
        });

    var pointColors = scatterData.map(function(d) { return gc[d.grade] || gc.C; });
    var pointBorderColors = scatterData.map(function(d) {
        if (d.grade === 'A') {
            return dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)';
        }
        return gc[d.grade] || gc.C;
    });

    var datasets = [{
        label: 'Color Sensor Value',
        data: scatterData,
        backgroundColor: pointColors,
        borderColor: pointBorderColors,
        borderWidth: scatterData.map(function(d) { return d.grade === 'A' ? 1.5 : 1; }),
        pointRadius: 7,
        pointHoverRadius: 10,
        showLine: false,
    }];

    // Trend line via linear regression
    if (qualityData.length >= 2) {
        var allPoints = qualityData
            .filter(function(g) { return g.color_value != null; })
            .map(function(g) { return { x: g.run, y: g.color_value }; });

        if (allPoints.length >= 2) {
            var reg = linearRegression(allPoints);
            var xMin = allPoints[0].x;
            var xMax = allPoints[allPoints.length - 1].x;
            datasets.push({
                label: 'Trend',
                data: [
                    { x: xMin, y: reg.slope * xMin + reg.intercept },
                    { x: xMax, y: reg.slope * xMax + reg.intercept },
                ],
                borderColor: TREND_COLOR,
                borderWidth: 2,
                borderDash: [6, 4],
                pointRadius: 0,
                showLine: true,
                fill: false,
                tension: 0,
            });
        }
    }

    // Grade threshold bands plugin
    var bandPlugin = {
        id: 'gradeBands',
        beforeDraw: function(chart) {
            var ctx = chart.ctx;
            var chartArea = chart.chartArea;
            var yScale = chart.scales.y;
            if (!chartArea || !yScale) return;

            var bands = [
                { min: 230, max: 320, color: gc.A, label: 'A (230-320)' },
                { min: 100, max: 210, color: gc.B, label: 'B (100-210)' },
                { min: 30,  max: 70,  color: gc.C, label: 'C (30-70)' },
            ];

            ctx.save();
            for (var i = 0; i < bands.length; i++) {
                var band = bands[i];
                var yTop = yScale.getPixelForValue(band.max);
                var yBot = yScale.getPixelForValue(band.min);
                var h = yBot - yTop;

                if (band.color === '#f0f0f0' || band.color === '#999999') {
                    ctx.fillStyle = dark
                        ? 'rgba(255,255,255,' + tc.bandAlpha + ')'
                        : 'rgba(0,0,0,' + tc.bandAlpha + ')';
                } else {
                    ctx.fillStyle = hexToRgba(band.color, parseFloat(tc.bandAlpha));
                }
                ctx.fillRect(chartArea.left, yTop, chartArea.width, h);

                // Band label
                ctx.fillStyle = dark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)';
                ctx.font = "600 10px 'SF Mono', monospace";
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(band.label, chartArea.left + 6, yTop + h / 2);
            }
            ctx.restore();
        },
    };

    var maxRun = qualityData.length > 0
        ? Math.max.apply(null, qualityData.map(function(g) { return g.run; }))
        : 20;

    var canvas = document.getElementById('chart-scatter');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    if (chartScatter) chartScatter.destroy();

    chartScatter = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: tc.tooltipBg,
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 11 },
                    titleColor: tc.tooltipText,
                    bodyColor: tc.tooltipText,
                    padding: 10,
                    cornerRadius: 8,
                    borderColor: tc.tooltipBdr,
                    borderWidth: 1,
                    callbacks: {
                        title: function(items) {
                            if (!items.length) return '';
                            return 'Run #' + items[0].raw.x;
                        },
                        label: function(ctx) {
                            var d = ctx.raw;
                            if (d.grade) {
                                var colorName = { A: 'White', B: 'Red', C: 'Blue' }[d.grade] || '';
                                return 'Value: ' + d.y + '  |  Grade ' + d.grade + ' (' + colorName + ')';
                            }
                            return 'Trend: ' + d.y.toFixed(1);
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    min: 0.5,
                    max: maxRun + 0.5,
                    ticks: {
                        stepSize: 1,
                        color: tc.tick,
                        font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 10 },
                        callback: function(val) { return Number.isInteger(val) ? val : ''; },
                    },
                    grid: { color: 'transparent', drawBorder: false },
                    title: {
                        display: true,
                        text: 'Run Number',
                        color: tc.tick,
                        font: { family: 'Inter', size: 11, weight: '500' },
                    },
                },
                y: {
                    min: 0,
                    max: 320,
                    ticks: {
                        stepSize: 50,
                        color: tc.tick,
                        font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 10 },
                    },
                    grid: { color: tc.grid, drawBorder: false },
                    title: {
                        display: true,
                        text: 'Color Sensor Value',
                        color: tc.tick,
                        font: { family: 'Inter', size: 11, weight: '500' },
                    },
                },
            },
            animation: { duration: 500 },
        },
        plugins: [bandPlugin],
    });
}

// ============================================
//  Station Timing Cards (NO PM)
// ============================================

function renderStationCards() {
    var grid = document.getElementById('station-cards-grid');
    if (!grid) return;

    grid.innerHTML = STATIONS.map(function(st) {
        var actual = avgActuals[st.key] || 0;
        var gap = actual - st.target;
        var gapPct = st.target > 0 ? (gap / st.target) * 100 : 0;

        // Traffic light: green <= 10%, orange 10-30%, red > 30%
        var trafficClass = 'traffic-green';
        if (gapPct > 30) trafficClass = 'traffic-red';
        else if (gapPct > 10) trafficClass = 'traffic-orange';

        // Mini bar
        var barMax = st.target * 2;
        var fillPct = Math.min((actual / barMax) * 100, 100);
        var targetPct = Math.min((st.target / barMax) * 100, 100);

        var fillColor = st.color;
        if (gapPct > 30) fillColor = 'var(--red)';
        else if (gapPct > 10) fillColor = 'var(--orange)';

        return '<div class="station-timing-card glass">'
            + '<div class="station-accent" style="background:' + st.color + '"></div>'
            + '<div class="station-card-head">'
            +   '<div>'
            +     '<span class="station-card-name">' + st.key + '</span>'
            +     '<span class="station-card-fullname">' + st.fullName + '</span>'
            +   '</div>'
            +   '<div class="station-traffic-dot ' + trafficClass + '"></div>'
            + '</div>'
            + '<div class="station-card-times">'
            +   '<span class="station-card-actual">' + actual.toFixed(1) + '</span>'
            +   '<span class="station-card-unit">s avg</span>'
            + '</div>'
            + '<div class="station-card-meta">'
            +   '<span class="station-card-target">target: ' + st.target + 's</span>'
            +   '<span class="station-card-gap ' + (gap > 0 ? 'gap-over' : 'gap-ok') + '">'
            +     (gap > 0 ? '+' : '') + gap.toFixed(1) + 's'
            +   '</span>'
            + '</div>'
            + '<div class="station-mini-bar-track">'
            +   '<div class="station-mini-bar-fill" style="width:' + fillPct.toFixed(1) + '%;background:' + fillColor + '"></div>'
            +   '<div class="station-mini-bar-target" style="left:' + targetPct.toFixed(1) + '%"></div>'
            + '</div>'
            + '</div>';
    }).join('');
}

// ============================================
//  Theme Toggle
// ============================================

function toggleTheme() {
    var html = document.documentElement;
    var current = html.getAttribute('data-theme') || 'dark';
    var next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);

    // Re-render chart with new theme colors
    renderScatterChart();
}

function isDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
}

function themeColors() {
    var dark = isDark();
    return {
        tick:        dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)',
        grid:        dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
        tooltipBg:   dark ? 'rgba(20,20,30,0.92)'    : 'rgba(255,255,255,0.95)',
        tooltipBdr:  dark ? 'rgba(255,255,255,0.1)'   : 'rgba(0,0,0,0.08)',
        tooltipText: dark ? '#fff'                    : '#000',
        bandAlpha:   dark ? '0.06'                    : '0.05',
    };
}

// ============================================
//  Live Polling — Digital Twin
// ============================================

function isOn(stn, group, label) {
    var v = stn && stn[group] && stn[group][label];
    return v === true || v === 'True';
}

function anyActuator(stn) {
    var a = stn && stn.actuators;
    if (!a) return false;
    for (var k in a) {
        if (a[k] === true || a[k] === 'True') return true;
    }
    return false;
}

function detectActiveStations(data) {
    // Returns which stations are active RIGHT NOW based on actuator state.
    // Each station is independent — multiple can be active simultaneously.
    if (!data) return { hbw: false, crane: false, ms: false, sl: false };
    var hbw = data.HBW || {};
    var crane = data.Crane || {};
    var ms = data.MS || {};
    var sl = data.SL || {};

    return {
        hbw:   anyActuator(hbw),
        crane: anyActuator(crane),
        ms:    anyActuator(ms),
        sl:    anyActuator(sl),
    };
}

function detectMsSubStep(data) {
    // Determine which MS sub-process is active for the oven glow etc.
    var ms = (data && data.MS) || {};
    if (isOn(ms, 'actuators', 'Lamp')) return 'burn';
    if (isOn(ms, 'actuators', 'Oven Slider In') || isOn(ms, 'actuators', 'Oven Slider Out') ||
        isOn(ms, 'actuators', 'Oven Door Valve') || isOn(ms, 'actuators', 'Transfer To Oven') ||
        isOn(ms, 'actuators', 'Transfer To Turntable')) return 'oven';
    if (isOn(ms, 'actuators', 'Saw') || isOn(ms, 'actuators', 'Ejector Valve')) return 'saw';
    if (isOn(ms, 'actuators', 'Conveyor Fwd') || isOn(ms, 'actuators', 'Turntable CW') ||
        isOn(ms, 'actuators', 'Turntable CCW')) return 'conveyor';
    if (isOn(ms, 'actuators', 'Compressor') || isOn(ms, 'actuators', 'Vacuum Valve')) return 'oven';
    return 'idle';
}

function detectSlSubStep(data) {
    var sl = (data && data.SL) || {};
    if (isOn(sl, 'actuators', 'Valve Blue') || isOn(sl, 'actuators', 'Valve Red') || isOn(sl, 'actuators', 'Valve White')) return 'sort';
    if (isOn(sl, 'actuators', 'Conveyor Belt') || isOn(sl, 'actuators', 'Compressor')) return 'color';
    return 'idle';
}

// Legacy wrapper — keeps old code working
function detectStep(data) {
    var s = detectActiveStations(data);
    if (s.sl) { var sub = detectSlSubStep(data); return sub === 'sort' ? 5 : 4; }
    if (s.ms) { var sub = detectMsSubStep(data); return sub === 'saw' ? 3 : 2; }
    if (s.crane) return activeStep >= 4 ? 6 : 1;
    if (s.hbw) return activeStep >= 6 ? 7 : 0;
    return -1;
}

async function pollLiveData() {
    try {
        var resp = await fetch('/api/data');
        if (!resp.ok) return;
        var json = await resp.json();
        lastFetchTs = Date.now();
        liveData = json;

        var d = json && json.data;
        if (!d || Object.keys(d).length === 0) return;

        // Detect ALL active stations concurrently
        activeStations = detectActiveStations(d);
        msSubStep = detectMsSubStep(d);

        // Legacy single-step for connection paths
        var step = detectStep(d);
        if (step !== activeStep) prevStep = activeStep;
        activeStep = step;

        updateTwinFromLive(step, d);
        updateLiveIndicator(json.status, json.mode);
    } catch (e) {
        // silent
    }
}

function updateTwinFromLive(step, data) {
    // Station SVG IDs and their colors
    var STN_MAP = {
        hbw:   { ids: ['stn-hbw', 'stn-rack'],            color: '#AF52DE' },
        crane: { ids: ['stn-crane', 'stn-return'],         color: '#30D158' },
        ms:    { ids: ['stn-oven', 'stn-out'],             color: '#007AFF' },
        sl:    { ids: ['stn-color', 'stn-sort'],           color: '#FF9F0A' },
    };

    // Reset all station highlights
    var ALL_IDS = ['stn-hbw', 'stn-crane', 'stn-oven', 'stn-out', 'stn-color', 'stn-sort', 'stn-return', 'stn-rack'];
    for (var i = 0; i < ALL_IDS.length; i++) {
        var el = document.getElementById(ALL_IDS[i]);
        if (!el) continue;
        var bg = el.querySelector('.stn-bg');
        if (bg) {
            bg.style.strokeWidth = '1.2';
            bg.style.stroke = '';
        }
    }

    // Highlight ALL active stations simultaneously
    for (var key in activeStations) {
        if (!activeStations[key]) continue;
        var info = STN_MAP[key];
        if (!info) continue;
        for (var j = 0; j < info.ids.length; j++) {
            var el = document.getElementById(info.ids[j]);
            if (!el) continue;
            var bg = el.querySelector('.stn-bg');
            if (bg) {
                bg.style.strokeWidth = '2.5';
                bg.style.stroke = info.color;
            }
        }
    }

    // MS sub-step: highlight specific boxes
    if (activeStations.ms) {
        var ovenEl = document.getElementById('stn-oven');
        var outEl = document.getElementById('stn-out');
        if (msSubStep === 'burn' || msSubStep === 'oven') {
            // Oven active
            if (ovenEl) { var bg = ovenEl.querySelector('.stn-bg'); if (bg) { bg.style.strokeWidth = '2.5'; bg.style.stroke = '#007AFF'; } }
        }
        if (msSubStep === 'saw') {
            // Saw/eject active
            if (outEl) { var bg = outEl.querySelector('.stn-bg'); if (bg) { bg.style.strokeWidth = '2.5'; bg.style.stroke = '#007AFF'; } }
        }
    }

    // SL sub-step: highlight specific boxes
    if (activeStations.sl) {
        var slSub = detectSlSubStep(data);
        var colorEl = document.getElementById('stn-color');
        var sortEl = document.getElementById('stn-sort');
        if (slSub === 'color' && colorEl) {
            var bg = colorEl.querySelector('.stn-bg'); if (bg) { bg.style.strokeWidth = '2.5'; bg.style.stroke = '#5AC8FA'; }
        }
        if (slSub === 'sort' && sortEl) {
            var bg = sortEl.querySelector('.stn-bg'); if (bg) { bg.style.strokeWidth = '2.5'; bg.style.stroke = '#FF9F0A'; }
        }
    }

    // Connection paths — show active based on which stations are running
    var CONN_IDS = ['conn-1', 'conn-2', 'conn-3', 'conn-4', 'conn-5', 'conn-6', 'conn-7'];
    for (var i = 0; i < CONN_IDS.length; i++) {
        var conn = document.getElementById(CONN_IDS[i]);
        if (!conn) continue;
        conn.classList.remove('active', 'visited');
    }
    // Activate connections between active stations
    if (activeStations.hbw)   { setConn('conn-1', 'active'); }
    if (activeStations.crane) { setConn('conn-1', 'active'); setConn('conn-2', 'active'); setConn('conn-5', 'active'); setConn('conn-6', 'active'); }
    if (activeStations.ms)    { setConn('conn-2', 'active'); setConn('conn-3', 'active'); }
    if (activeStations.sl)    { setConn('conn-4', 'active'); setConn('conn-5', 'active'); }

    // Oven glow when burning
    var ovenBox = document.querySelector('#stn-oven .stn-bg');
    if (ovenBox) {
        var ms = data.MS || {};
        var burning = isOn(ms, 'actuators', 'Lamp');
        if (burning) {
            ovenBox.style.stroke = '#FF453A';
            ovenBox.style.strokeWidth = '3';
        }
    }
}

function setConn(id, cls) {
    var el = document.getElementById(id);
    if (el) el.classList.add(cls);
}

// ============================================
//  Mode Switching
// ============================================


function updateLiveIndicator(status, mode) {
    var dot = document.getElementById('live-dot');
    var text = document.getElementById('live-text');
    if (!dot || !text) return;

    dot.className = 'live-dot';
    if (status === 'connected') {
        dot.classList.add('connected');
        text.textContent = 'Live';
    } else if (status === 'disconnected') {
        dot.classList.add('disconnected');
        text.textContent = 'Offline';
    } else {
        dot.classList.add('stale');
        text.textContent = 'No data';
    }
}

// ============================================
//  Utilities
// ============================================

function linearRegression(points) {
    var n = points.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (var i = 0; i < n; i++) {
        sumX += points[i].x;
        sumY += points[i].y;
        sumXY += points[i].x * points[i].y;
        sumXX += points[i].x * points[i].x;
    }
    var denom = n * sumXX - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: sumY / n };
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    return { slope: slope, intercept: intercept };
}

function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

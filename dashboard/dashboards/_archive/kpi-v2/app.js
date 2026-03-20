/* ============================================
   KPI v2 — Balanced Metrics Cards
   App Logic
   ============================================ */

// --- Constants ---
const THEORETICAL = { HBW: 12.0, Crane: 12.0, MS: 18.0, PM: 5.0, SL: 6.0 };
const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};
const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

// --- Chart instances ---
let ctChart = null;
let ganttChart = null;

// --- Theme ---
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    refreshChartTheme();
}

function getThemeColors() {
    const s = getComputedStyle(document.documentElement);
    return {
        text:      s.getPropertyValue('--text-primary').trim(),
        textSec:   s.getPropertyValue('--text-secondary').trim(),
        textTert:  s.getPropertyValue('--text-tertiary').trim(),
        grid:      s.getPropertyValue('--chart-grid').trim(),
        tick:      s.getPropertyValue('--chart-tick').trim(),
        separator: s.getPropertyValue('--separator').trim(),
        green:     s.getPropertyValue('--green').trim(),
        red:       s.getPropertyValue('--red').trim(),
        blue:      s.getPropertyValue('--blue').trim(),
        orange:    s.getPropertyValue('--orange').trim(),
        purple:    s.getPropertyValue('--purple').trim(),
        cyan:      s.getPropertyValue('--cyan').trim()
    };
}

function refreshChartTheme() {
    const c = getThemeColors();
    [ctChart, ganttChart].forEach(function(chart) {
        if (!chart) return;
        var opts = chart.options;
        if (opts.scales) {
            Object.values(opts.scales).forEach(function(scale) {
                if (scale.grid) scale.grid.color = c.grid;
                if (scale.ticks) scale.ticks.color = c.tick;
                if (scale.title) scale.title.color = c.textSec;
            });
        }
        if (opts.plugins && opts.plugins.legend && opts.plugins.legend.labels) {
            opts.plugins.legend.labels.color = c.textSec;
        }
        chart.update('none');
    });
}

// --- Data Fetch ---
async function fetchJSON(url) {
    try {
        var r = await fetch(url);
        if (!r.ok) throw new Error(r.statusText);
        return await r.json();
    } catch (e) {
        console.error('Fetch error:', url, e);
        return null;
    }
}

// --- Gauge helpers ---
// 270-degree arc, radius 58, circumference = 2*PI*58 = 364.42
var GAUGE_ARC = 273.32;   // 364.42 * 0.75
var GAUGE_CIRC = 364.42;

function setGaugeArc(id, value, color) {
    var el = document.getElementById(id);
    if (!el) return;
    var clamped = Math.max(0, Math.min(1, value));
    el.setAttribute('stroke-dasharray', (clamped * GAUGE_ARC) + ' ' + GAUGE_CIRC);
    if (color) el.setAttribute('stroke', color);
}

function oeeColor(val) {
    var c = getThemeColors();
    if (val >= 0.85) return c.green;
    if (val >= 0.65) return c.orange;
    return c.red;
}

function pctStr(v) { return (v * 100).toFixed(1) + '%'; }

// --- Render: OEE Card ---
function renderOEE(data) {
    if (!data) return;

    var oee = data.oee;
    setGaugeArc('oee-arc', oee, oeeColor(oee));
    document.getElementById('oee-value').textContent = pctStr(oee);

    // A/P/Q bars
    document.getElementById('avail-bar').style.width = (data.availability * 100) + '%';
    document.getElementById('perf-bar').style.width = (data.performance * 100) + '%';
    document.getElementById('qual-bar').style.width = (data.quality * 100) + '%';

    document.getElementById('avail-val').textContent = pctStr(data.availability);
    document.getElementById('perf-val').textContent = pctStr(data.performance);
    document.getElementById('qual-val').textContent = pctStr(data.quality);

    // Color the bars by value
    var c = getThemeColors();
    applyBarColor('avail-bar', data.availability, c);
    applyBarColor('perf-bar', data.performance, c);
    applyBarColor('qual-bar', data.quality, c);

    // Formula
    document.getElementById('oee-formula').textContent =
        (data.availability * 100).toFixed(0) + '% x ' +
        (data.performance * 100).toFixed(0) + '% x ' +
        (data.quality * 100).toFixed(0) + '% = ' +
        pctStr(oee);

    // Status badge
    var badge = document.getElementById('oee-status-badge');
    if (oee >= 0.85) {
        badge.textContent = 'World Class';
        badge.className = 'metric-card-badge good';
    } else if (oee >= 0.65) {
        badge.textContent = 'Acceptable';
        badge.className = 'metric-card-badge warn';
    } else {
        badge.textContent = 'Below Target';
        badge.className = 'metric-card-badge constraint';
    }
}

function applyBarColor(id, val, c) {
    var el = document.getElementById(id);
    if (!el) return;
    if (val >= 0.9) {
        el.style.background = c.green;
    } else if (val >= 0.7) {
        el.style.background = c.orange;
    } else {
        el.style.background = c.red;
    }
}

// --- Render: Bottleneck Card ---
function renderBottleneck(data) {
    if (!data) return;

    var nameEl = document.getElementById('bn-name');
    nameEl.textContent = data.station;
    nameEl.style.color = STATION_COLORS[data.station] || 'var(--text-primary)';

    var actual = data.avg_cycle_time;
    var theo = data.theoretical;
    var maxVal = Math.max(actual, theo) * 1.15;

    document.getElementById('bn-actual-val').textContent = actual.toFixed(1) + 's';
    document.getElementById('bn-target-val').textContent = theo.toFixed(1) + 's';
    document.getElementById('bn-actual-bar').style.width = (actual / maxVal * 100) + '%';
    document.getElementById('bn-target-bar').style.width = (theo / maxVal * 100) + '%';

    // Chips
    var container = document.getElementById('bn-chips');
    container.innerHTML = '';
    if (data.all_averages) {
        STATION_ORDER.forEach(function(st) {
            var val = data.all_averages[st];
            if (val === undefined) return;
            var chip = document.createElement('div');
            chip.className = 'bn-chip' + (st === data.station ? ' is-bottleneck' : '');
            chip.innerHTML = '<span class="dot" style="background:' + STATION_COLORS[st] + '"></span>' +
                st + ' <span class="val">' + val.toFixed(1) + 's</span>';
            container.appendChild(chip);
        });
    }

    document.getElementById('bn-rec-text').textContent = data.recommendation || '--';
}

// --- Render: Throughput Card ---
function renderThroughput(tpData, oeeData, qualData) {
    if (!tpData) return;

    document.getElementById('tp-val').textContent = tpData.per_hour.toFixed(1);
    document.getElementById('tp-max-val').innerHTML = tpData.theoretical_max.toFixed(1) + '<span class="tp-compare-unit"> /hr</span>';
    document.getElementById('tp-util-pct').textContent = pctStr(tpData.utilization);
    document.getElementById('tp-util-bar').style.width = (tpData.utilization * 100) + '%';
    document.getElementById('tp-runs').textContent = tpData.total_runs;

    if (tpData.total_time_min !== undefined) {
        document.getElementById('tp-time').textContent = tpData.total_time_min.toFixed(1) + ' min';
    }

    // Quality yield from OEE data
    if (oeeData && oeeData.quality !== undefined) {
        document.getElementById('tp-yield').textContent = pctStr(oeeData.quality);
    }

    // Badge shows run count
    var badge = document.getElementById('tp-badge');
    badge.textContent = tpData.total_runs + ' runs';
    badge.className = 'metric-card-badge info';
}

// --- Render: Cycle Time Horizontal Bar Chart ---
function renderCycleTimeChart(cycleData) {
    if (!cycleData || !cycleData.length) return;

    var c = getThemeColors();

    // Calculate medians per station
    var stationVals = {};
    STATION_ORDER.forEach(function(st) { stationVals[st] = []; });
    cycleData.forEach(function(run) {
        if (!run.stations) return;
        STATION_ORDER.forEach(function(st) {
            if (run.stations[st] != null) stationVals[st].push(run.stations[st]);
        });
    });

    var medians = {};
    STATION_ORDER.forEach(function(st) {
        var arr = stationVals[st].slice().sort(function(a, b) { return a - b; });
        if (!arr.length) { medians[st] = 0; return; }
        var mid = Math.floor(arr.length / 2);
        medians[st] = arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    });

    document.getElementById('ct-run-count').textContent = cycleData.length + ' runs';

    // Reversed so HBW is at top
    var reversed = STATION_ORDER.slice().reverse();
    var barColors = reversed.map(function(st) { return STATION_COLORS[st]; });

    var ctx = document.getElementById('ct-chart').getContext('2d');
    if (ctChart) ctChart.destroy();

    ctChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: reversed,
            datasets: [{
                data: reversed.map(function(st) { return medians[st]; }),
                backgroundColor: barColors.map(function(col) { return col + '55'; }),
                borderColor: barColors,
                borderWidth: 1.5,
                borderRadius: 6,
                borderSkipped: false,
                barThickness: 28
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.82)',
                    titleFont: { family: 'Inter', weight: '600' },
                    bodyFont: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 12 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) {
                            var st = reversed[ctx.dataIndex];
                            return 'Median: ' + ctx.raw.toFixed(1) + 's  |  Target: ' + THEORETICAL[st].toFixed(1) + 's';
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Cycle Time (seconds)', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: { color: c.tick, font: { size: 11 } },
                    beginAtZero: true
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: c.tick,
                        font: { size: 12, weight: '600' }
                    }
                }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        },
        plugins: [{
            id: 'theoreticalDashed',
            afterDatasetsDraw: function(chart) {
                var chartCtx = chart.ctx;
                var xScale = chart.scales.x;
                var yScale = chart.scales.y;

                reversed.forEach(function(st, i) {
                    var theo = THEORETICAL[st];
                    var med = medians[st];
                    var xTheo = xScale.getPixelForValue(theo);
                    var yCenter = yScale.getPixelForValue(i);

                    // Dashed theoretical target line
                    chartCtx.save();
                    chartCtx.setLineDash([5, 4]);
                    chartCtx.strokeStyle = c.textTert;
                    chartCtx.lineWidth = 1.5;
                    chartCtx.beginPath();
                    chartCtx.moveTo(xTheo, yCenter - 20);
                    chartCtx.lineTo(xTheo, yCenter + 20);
                    chartCtx.stroke();
                    chartCtx.restore();

                    // Value label on bar
                    var barEnd = xScale.getPixelForValue(med);
                    var barStart = xScale.getPixelForValue(0);
                    chartCtx.save();
                    chartCtx.font = "600 11px 'SF Mono', 'JetBrains Mono', monospace";
                    chartCtx.fillStyle = c.text;
                    if (barEnd - barStart > 55) {
                        chartCtx.textAlign = 'right';
                        chartCtx.fillText(med.toFixed(1) + 's', barEnd - 8, yCenter + 4);
                    } else {
                        chartCtx.textAlign = 'left';
                        chartCtx.fillText(med.toFixed(1) + 's', barEnd + 8, yCenter + 4);
                    }
                    chartCtx.restore();

                    // Station color dot
                    chartCtx.save();
                    chartCtx.beginPath();
                    chartCtx.arc(yScale.left - 8, yCenter, 4, 0, Math.PI * 2);
                    chartCtx.fillStyle = STATION_COLORS[st];
                    chartCtx.fill();
                    chartCtx.restore();
                });
            }
        }]
    });
}

// --- Render: Production Timeline (Gantt) ---
function renderGantt(timeline) {
    if (!timeline || !timeline.length) return;

    var minTs = Infinity;
    timeline.forEach(function(e) {
        var ts = new Date(e.start).getTime();
        if (ts < minTs) minTs = ts;
    });

    var runMap = {};
    timeline.forEach(function(e) {
        if (!runMap[e.run]) runMap[e.run] = {};
        var s = (new Date(e.start).getTime() - minTs) / 1000;
        var en = (new Date(e.end).getTime() - minTs) / 1000;
        runMap[e.run][e.station] = [s, en];
    });

    var runs = Object.keys(runMap).map(Number).sort(function(a, b) { return a - b; });
    var datasets = [];

    runs.forEach(function(run) {
        var rd = runMap[run];
        var opacity = 0.55 + (run % 3) * 0.15;

        STATION_ORDER.forEach(function(station) {
            if (!rd[station]) return;
            var seg = rd[station];
            var color = STATION_COLORS[station];

            datasets.push({
                label: station + ' #' + run,
                data: STATION_ORDER.map(function(s) { return s === station ? seg : null; }),
                backgroundColor: hexToRgba(color, opacity),
                borderColor: hexToRgba(color, Math.min(opacity + 0.3, 1.0)),
                borderWidth: 1,
                borderRadius: 3,
                borderSkipped: false,
                barPercentage: 0.7,
                categoryPercentage: 0.85
            });
        });
    });

    var ctx = document.getElementById('gantt-chart');
    if (!ctx) return;
    var c = getThemeColors();

    if (ganttChart) ganttChart.destroy();

    ganttChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: { labels: STATION_ORDER, datasets: datasets },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.82)',
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: "'SF Mono', monospace", size: 11 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        title: function(items) { return items.length ? items[0].dataset.label : ''; },
                        label: function(ctx) {
                            var val = ctx.raw;
                            if (!val) return '';
                            return 'Time: ' + val[0].toFixed(1) + 's - ' + val[1].toFixed(1) + 's (' + (val[1] - val[0]).toFixed(1) + 's)';
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Time (seconds)', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: {
                        color: c.tick,
                        font: { family: "'SF Mono', monospace", size: 10 },
                        callback: function(val) { return val + 's'; }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: c.tick, font: { size: 11, weight: '600' } }
                }
            }
        }
    });
}

// --- Collapsible ---
function toggleCollapsible(headerEl) {
    var body = headerEl.nextElementSibling;
    if (!body || !body.classList.contains('collapsible-body')) return;
    var isExpanded = body.classList.contains('expanded');
    if (isExpanded) {
        body.classList.remove('expanded');
        headerEl.classList.remove('expanded');
    } else {
        body.classList.add('expanded');
        headerEl.classList.add('expanded');
    }
}

// --- Utility ---
function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// --- Init ---
async function init() {
    // Fetch all data in parallel
    var results = await Promise.all([
        fetchJSON('/api/analytics/cycle-times'),
        fetchJSON('/api/analytics/oee'),
        fetchJSON('/api/analytics/throughput'),
        fetchJSON('/api/analytics/bottleneck'),
        fetchJSON('/api/analytics/timeline'),
        fetchJSON('/api/analytics/quality-grades')
    ]);

    var cycleData     = results[0];
    var oeeData       = results[1];
    var throughputData = results[2];
    var bottleneckData = results[3];
    var timelineData   = results[4];
    var qualityData    = results[5];

    renderOEE(oeeData);
    renderBottleneck(bottleneckData);
    renderThroughput(throughputData, oeeData, qualityData);
    renderCycleTimeChart(cycleData);
    renderGantt(timelineData);

    // Last updated timestamp
    var now = new Date();
    document.getElementById('last-updated').textContent =
        now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

document.addEventListener('DOMContentLoaded', init);

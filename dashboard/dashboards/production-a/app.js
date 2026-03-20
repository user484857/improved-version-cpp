/**
 * Production A — KPI Analytics Dashboard
 *
 * OEE, throughput, WIP (Little's Law), cycle times, and alert feed.
 * Fetches from: /api/analytics/cycle-times, throughput, wip, oee, alerts, bottleneck, /api/db-stats
 */

// ============================================
//  Constants
// ============================================

const STATIONS = [
    { key: 'MS',    name: 'MS',    fullName: 'Machining Station', target: 18, color: '#007AFF' },
    { key: 'SL',    name: 'SL',    fullName: 'Sorting Line',      target: 5,  color: '#FF9F0A' },
    { key: 'Crane', name: 'Crane', fullName: 'Transport Crane',   target: 12, color: '#30D158' },
    { key: 'HBW',   name: 'HBW',   fullName: 'High-Bay Warehouse', target: 10, color: '#AF52DE' },
    { key: 'PM',    name: 'PM',    fullName: 'Punching Machine',  target: 4,  color: '#FF453A' },
];

const CHART_COLORS = {
    gridDark:  'rgba(255,255,255,0.04)',
    gridLight: 'rgba(0,0,0,0.04)',
    tickDark:  'rgba(255,255,255,0.22)',
    tickLight: 'rgba(0,0,0,0.30)',
};

// ============================================
//  State
// ============================================

let cycleData     = [];
let throughputData = null;
let wipData       = null;
let oeeData       = null;
let alertsData    = [];
let bottleneckData = null;

let cycleChart      = null;
let throughputChart = null;
let wipChart        = null;

let alertsShownCount = 10;

// ============================================
//  Init
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setInterval(loadData, 8000);
    loadDbStats();
    setInterval(loadDbStats, 30000);
});

// ============================================
//  Data Loading
// ============================================

async function loadData() {
    try {
        const [cycleRes, throughputRes, wipRes, oeeRes, alertsRes, bottleneckRes] = await Promise.all([
            fetch('/api/analytics/cycle-times').then(r => r.json()),
            fetch('/api/analytics/throughput').then(r => r.json()),
            fetch('/api/analytics/wip').then(r => r.json()),
            fetch('/api/analytics/oee').then(r => r.json()),
            fetch('/api/analytics/alerts').then(r => r.json()),
            fetch('/api/analytics/bottleneck').then(r => r.json()),
        ]);

        cycleData      = cycleRes;
        throughputData = throughputRes;
        wipData        = wipRes;
        oeeData        = oeeRes;
        alertsData     = alertsRes;
        bottleneckData = bottleneckRes;

        renderOeeHero();
        renderKpiTiles();
        renderCycleChart();
        renderThroughputChart();
        renderWipSection();
        renderOeeBreakdown();
        renderAlerts();
        updateTimestamp();
    } catch (e) {
        // silent fail — data may not be available yet
    }
}

async function loadDbStats() {
    try {
        var resp = await fetch('/api/db-stats');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var stats = await resp.json();
        if (stats.error) throw new Error(stats.error);

        var el = document.getElementById('footer-db');
        if (el) {
            var total = stats.total_events || 0;
            var runs = stats.total_runs || 0;
            if (total > 0) {
                var label = total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total;
                el.textContent = 'DB: ' + label + ' events, ' + runs + ' runs';
            } else {
                el.textContent = 'DB: empty';
            }
        }
    } catch (_) {
        var el = document.getElementById('footer-db');
        if (el) el.textContent = 'DB: offline';
    }
}

function updateTimestamp() {
    var el = document.getElementById('last-updated');
    if (el) {
        var now = new Date();
        el.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
}

// ============================================
//  Theme Helpers
// ============================================

function isDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
}

function tooltipStyle() {
    var dark = isDark();
    return {
        backgroundColor: dark ? 'rgba(30,30,34,0.95)' : 'rgba(255,255,255,0.95)',
        titleColor: dark ? '#fff' : '#000',
        bodyColor: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
        borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
    };
}

function gridColor() {
    return isDark() ? CHART_COLORS.gridDark : CHART_COLORS.gridLight;
}

function tickColor() {
    return isDark() ? CHART_COLORS.tickDark : CHART_COLORS.tickLight;
}

function hexWithAlpha(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ============================================
//  1. OEE Hero Banner
// ============================================

function renderOeeHero() {
    if (!oeeData) return;

    var oee = (oeeData.oee || 0) * 100;
    var avail = (oeeData.availability || 0) * 100;
    var perf = (oeeData.performance || 0) * 100;
    var qual = (oeeData.quality || 0) * 100;

    // Big value
    var valueEl = document.getElementById('oee-value');
    if (valueEl) {
        animateValue(valueEl, oee);
        if (oee >= 65) valueEl.style.color = 'var(--green)';
        else if (oee >= 40) valueEl.style.color = 'var(--orange)';
        else valueEl.style.color = 'var(--red)';
    }

    // Progress bar
    var barFill = document.getElementById('oee-bar-fill');
    if (barFill) {
        barFill.style.width = Math.min(oee, 100).toFixed(1) + '%';
        if (oee >= 65) barFill.style.background = 'linear-gradient(90deg, rgba(48,209,88,0.3), rgba(48,209,88,0.7))';
        else if (oee >= 40) barFill.style.background = 'linear-gradient(90deg, rgba(255,159,10,0.3), rgba(255,159,10,0.7))';
        else barFill.style.background = 'linear-gradient(90deg, rgba(255,69,58,0.3), rgba(255,69,58,0.7))';
    }

    // Factor labels
    var fa = document.getElementById('oee-factor-a');
    var fp = document.getElementById('oee-factor-p');
    var fq = document.getElementById('oee-factor-q');
    var fo = document.getElementById('oee-factor-oee');
    if (fa) fa.textContent = avail.toFixed(0) + '%';
    if (fp) fp.textContent = perf.toFixed(0) + '%';
    if (fq) fq.textContent = qual.toFixed(0) + '%';
    if (fo) fo.textContent = oee.toFixed(1) + '% OEE';
}

function animateValue(el, target) {
    var start = parseFloat(el.textContent) || 0;
    var diff = target - start;
    var duration = 800;
    var startTime = performance.now();

    function tick(now) {
        var elapsed = now - startTime;
        var progress = Math.min(elapsed / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = (start + diff * eased).toFixed(1);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ============================================
//  2. KPI Tiles
// ============================================

function renderKpiTiles() {
    // Throughput
    var tpEl = document.getElementById('kpi-throughput');
    if (tpEl && throughputData) {
        tpEl.textContent = (throughputData.per_hour || 0).toFixed(1);
    }
    var tpTrend = document.getElementById('kpi-throughput-trend');
    if (tpTrend && throughputData) {
        var runs = throughputData.total_runs || 0;
        tpTrend.textContent = runs + ' runs total';
        tpTrend.className = 'kpi-trend neutral';
    }

    // WIP
    var wipEl = document.getElementById('kpi-wip');
    if (wipEl && wipData) {
        wipEl.textContent = (wipData.wip || 0).toFixed(1);
    }

    // Avg Cycle Time
    var cycleEl = document.getElementById('kpi-cycle');
    if (cycleEl && wipData) {
        cycleEl.textContent = (wipData.avg_throughput_time_s || 0).toFixed(1);
    }

    // Alerts
    var alertEl = document.getElementById('kpi-alerts');
    if (alertEl) {
        var errCount = 0;
        var warnCount = 0;
        alertsData.forEach(function(a) {
            if (a.severity === 'error') errCount++;
            else if (a.severity === 'warning') warnCount++;
        });
        alertEl.textContent = alertsData.length;
        var alertTrend = document.getElementById('kpi-alerts-trend');
        if (alertTrend) {
            if (errCount > 0) {
                alertTrend.textContent = errCount + ' error' + (errCount > 1 ? 's' : '');
                alertTrend.className = 'kpi-trend down';
            } else if (warnCount > 0) {
                alertTrend.textContent = warnCount + ' warning' + (warnCount > 1 ? 's' : '');
                alertTrend.className = 'kpi-trend neutral';
            } else {
                alertTrend.textContent = 'No issues';
                alertTrend.className = 'kpi-trend up';
            }
        }
    }
}

// ============================================
//  3. Cycle Times — Grouped Bar Chart
// ============================================

function renderCycleChart() {
    if (!cycleData || cycleData.length === 0) return;

    var runsLabel = document.getElementById('cycle-runs-label');
    if (runsLabel) runsLabel.textContent = cycleData.length + ' runs';

    // Compute averages per station
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

    var avgs = {};
    STATIONS.forEach(function(st) {
        avgs[st.key] = counts[st.key] > 0 ? sums[st.key] / counts[st.key] : st.target;
    });

    var labels = STATIONS.map(function(st) { return st.key; });
    var actualValues = STATIONS.map(function(st) { return avgs[st.key]; });
    var targetValues = STATIONS.map(function(st) { return st.target; });
    var actualColors = STATIONS.map(function(st) { return st.color; });
    var targetColors = STATIONS.map(function(st) { return hexWithAlpha(st.color, 0.2); });
    var targetBorders = STATIONS.map(function(st) { return hexWithAlpha(st.color, 0.5); });

    // Legend
    var legendEl = document.getElementById('cycle-legend');
    if (legendEl) {
        var bottleneckKey = bottleneckData ? bottleneckData.station : null;
        var html = '<div class="cycle-legend-item"><div class="cycle-legend-swatch" style="background:var(--blue)"></div>Actual avg</div>';
        html += '<div class="cycle-legend-item"><div class="cycle-legend-swatch outline" style="border-color:var(--text-tertiary)"></div>Target</div>';
        if (bottleneckKey) {
            html += '<span class="bottleneck-badge">Bottleneck: ' + bottleneckKey + '</span>';
        }
        legendEl.innerHTML = html;
    }

    // Chart
    var canvas = document.getElementById('cycle-chart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    if (cycleChart) cycleChart.destroy();

    cycleChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Actual Avg',
                    data: actualValues,
                    backgroundColor: actualColors,
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 36,
                    order: 1,
                },
                {
                    label: 'Target',
                    data: targetValues,
                    backgroundColor: targetColors,
                    borderColor: targetBorders,
                    borderWidth: 2,
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 36,
                    order: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: Object.assign({}, tooltipStyle(), {
                    callbacks: {
                        label: function(ctx) {
                            return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + 's';
                        },
                    },
                }),
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: tickColor(),
                        font: { size: 12, family: 'Inter', weight: 600 },
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: gridColor() },
                    ticks: {
                        color: tickColor(),
                        font: { size: 10, family: "'JetBrains Mono', monospace" },
                        callback: function(v) { return v + 's'; },
                    },
                    title: {
                        display: true,
                        text: 'Seconds',
                        color: tickColor(),
                        font: { size: 10, family: 'Inter', weight: 500 },
                    },
                },
            },
        },
    });
}

// ============================================
//  4. Throughput — Trend + Cumulative
// ============================================

function renderThroughputChart() {
    if (!throughputData || !wipData) return;

    // Stats bar
    var rateEl = document.getElementById('throughput-rate');
    var utilEl = document.getElementById('throughput-util');
    if (rateEl) rateEl.textContent = (throughputData.per_hour || 0).toFixed(1) + ' parts/hr';
    if (utilEl) utilEl.textContent = ((throughputData.utilization || 0) * 100).toFixed(1) + '% util';

    // Build datasets
    var cumulative = throughputData.cumulative || [];
    var perRun = wipData.per_run || [];

    if (cumulative.length === 0 && perRun.length === 0) return;

    var labels = [];
    var throughputTimes = [];
    var cumulativeCounts = [];

    // Use per_run for throughput time axis
    perRun.forEach(function(r) {
        labels.push('Run ' + r.run);
        throughputTimes.push(r.throughput_time_s);
    });

    // Use cumulative for count axis
    cumulative.forEach(function(c, i) {
        if (i < cumulativeCounts.length) return;
        cumulativeCounts.push(c.count);
    });

    // Pad to same length
    while (cumulativeCounts.length < labels.length) {
        cumulativeCounts.push(cumulativeCounts.length > 0 ? cumulativeCounts[cumulativeCounts.length - 1] : 0);
    }
    while (cumulativeCounts.length > labels.length) {
        labels.push('Run ' + (labels.length + 1));
        throughputTimes.push(null);
    }

    var canvas = document.getElementById('throughput-chart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    if (throughputChart) throughputChart.destroy();

    throughputChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Throughput Time',
                    data: throughputTimes,
                    borderColor: '#007AFF',
                    backgroundColor: hexWithAlpha('#007AFF', 0.08),
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#007AFF',
                    pointBorderColor: isDark() ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
                    pointBorderWidth: 2,
                    borderWidth: 2.5,
                    yAxisID: 'y',
                },
                {
                    label: 'Cumulative Count',
                    data: cumulativeCounts,
                    borderColor: '#30D158',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [],
                    stepped: true,
                    pointRadius: 3,
                    pointBackgroundColor: '#30D158',
                    pointBorderColor: isDark() ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
                    pointBorderWidth: 1.5,
                    yAxisID: 'y1',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: tickColor(),
                        font: { size: 11, family: 'Inter', weight: 500 },
                        boxWidth: 14,
                        boxHeight: 3,
                        padding: 16,
                        usePointStyle: false,
                    },
                },
                tooltip: Object.assign({}, tooltipStyle(), {
                    callbacks: {
                        label: function(ctx) {
                            if (ctx.datasetIndex === 0) return 'Throughput: ' + (ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) + 's' : '--');
                            return 'Parts: ' + ctx.parsed.y;
                        },
                    },
                }),
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: tickColor(),
                        font: { size: 10, family: "'JetBrains Mono', monospace" },
                        maxRotation: 0,
                    },
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    grid: { color: gridColor() },
                    ticks: {
                        color: tickColor(),
                        font: { size: 10, family: "'JetBrains Mono', monospace" },
                        callback: function(v) { return v + 's'; },
                    },
                    title: {
                        display: true,
                        text: 'Throughput Time (s)',
                        color: tickColor(),
                        font: { size: 10, family: 'Inter', weight: 500 },
                    },
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: '#30D158',
                        font: { size: 10, family: "'JetBrains Mono', monospace" },
                        stepSize: 1,
                    },
                    title: {
                        display: true,
                        text: 'Cumulative Parts',
                        color: '#30D158',
                        font: { size: 10, family: 'Inter', weight: 500 },
                    },
                },
            },
        },
    });
}

// ============================================
//  5. WIP — Big Number + Little's Law
// ============================================

function renderWipSection() {
    if (!wipData || !throughputData) return;

    var wip = wipData.wip || 0;
    var tpHr = throughputData.per_hour || 0;
    var avgTT = wipData.avg_throughput_time_s || 0;
    var avgTThr = avgTT / 3600;

    // Big value
    var wipVal = document.getElementById('wip-value');
    if (wipVal) wipVal.textContent = wip.toFixed(1);

    // Formula with actual values
    var formulaEl = document.getElementById('wip-formula-actual');
    if (formulaEl) {
        formulaEl.textContent = 'WIP = ' + tpHr.toFixed(1) + ' \u00D7 ' + avgTThr.toFixed(4) + 'h = ' + wip.toFixed(1) + ' parts';
    }

    // Mini bar chart of per-run throughput times
    var perRun = wipData.per_run || [];
    if (perRun.length === 0) return;

    var labels = perRun.map(function(r) { return '#' + r.run; });
    var values = perRun.map(function(r) { return r.throughput_time_s; });
    var avgLine = avgTT;

    var canvas = document.getElementById('wip-chart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    if (wipChart) wipChart.destroy();

    wipChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Throughput Time',
                    data: values,
                    backgroundColor: hexWithAlpha('#007AFF', 0.55),
                    borderRadius: 4,
                    borderSkipped: false,
                    maxBarThickness: 28,
                },
                {
                    label: 'Average',
                    data: new Array(labels.length).fill(avgLine),
                    type: 'line',
                    borderColor: isDark() ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
                    borderDash: [6, 4],
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: Object.assign({}, tooltipStyle(), {
                    callbacks: {
                        label: function(ctx) {
                            if (ctx.datasetIndex === 0) return ctx.parsed.y.toFixed(1) + 's';
                            return 'Avg: ' + avgLine.toFixed(1) + 's';
                        },
                    },
                }),
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: tickColor(),
                        font: { size: 9, family: "'JetBrains Mono', monospace" },
                        maxRotation: 0,
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: gridColor() },
                    ticks: {
                        color: tickColor(),
                        font: { size: 9, family: "'JetBrains Mono', monospace" },
                        callback: function(v) { return v + 's'; },
                    },
                },
            },
        },
    });
}

// ============================================
//  6. OEE Breakdown — Three Horizontal Bars
// ============================================

function renderOeeBreakdown() {
    if (!oeeData) return;

    var avail = (oeeData.availability || 0) * 100;
    var perf = (oeeData.performance || 0) * 100;
    var qual = (oeeData.quality || 0) * 100;
    var oee = (oeeData.oee || 0) * 100;

    // Total label
    var totalEl = document.getElementById('oee-breakdown-total');
    if (totalEl) totalEl.textContent = 'OEE: ' + oee.toFixed(1) + '%';

    // Availability
    var availPct = document.getElementById('oee-avail-pct');
    var availFill = document.getElementById('oee-avail-fill');
    var availDetail = document.getElementById('oee-avail-detail');
    if (availPct) availPct.textContent = avail.toFixed(1) + '%';
    if (availFill) availFill.style.width = Math.min(avail, 100).toFixed(1) + '%';
    if (availDetail) {
        var activeMin = ((oeeData.active_time_s || 0) / 60).toFixed(1);
        var totalMin = ((oeeData.total_time_s || 0) / 60).toFixed(1);
        availDetail.textContent = 'Active: ' + activeMin + ' min / ' + totalMin + ' min total';
    }

    // Performance
    var perfPct = document.getElementById('oee-perf-pct');
    var perfFill = document.getElementById('oee-perf-fill');
    var perfDetail = document.getElementById('oee-perf-detail');
    if (perfPct) perfPct.textContent = perf.toFixed(1) + '%';
    if (perfFill) perfFill.style.width = Math.min(perf, 100).toFixed(1) + '%';
    if (perfDetail) {
        var actual = (throughputData ? throughputData.per_hour : 0).toFixed(1);
        var max = (throughputData ? throughputData.theoretical_max : 0).toFixed(1);
        perfDetail.textContent = 'Actual: ' + actual + ' parts/hr vs. theoretical max: ' + max + ' parts/hr';
    }

    // Quality
    var qualPct = document.getElementById('oee-qual-pct');
    var qualFill = document.getElementById('oee-qual-fill');
    var qualDetail = document.getElementById('oee-qual-detail');
    if (qualPct) qualPct.textContent = qual.toFixed(1) + '%';
    if (qualFill) qualFill.style.width = Math.min(qual, 100).toFixed(1) + '%';
    if (qualDetail) {
        var gradeA = oeeData.grade_a_count || 0;
        var totalRuns = oeeData.total_runs || 0;
        qualDetail.textContent = 'Grade A: ' + gradeA + ' / ' + totalRuns + ' total runs';
    }
}

// ============================================
//  7. Alerts — Feed (Collapsible)
// ============================================

function renderAlerts() {
    var subtitle = document.getElementById('alerts-subtitle');
    if (subtitle) {
        var errCount = alertsData.filter(function(a) { return a.severity === 'error'; }).length;
        var warnCount = alertsData.filter(function(a) { return a.severity === 'warning'; }).length;
        subtitle.textContent = alertsData.length + ' alerts (' + errCount + ' errors, ' + warnCount + ' warnings)';
    }

    var list = document.getElementById('alerts-list');
    if (!list) return;

    var toShow = alertsData.slice(0, alertsShownCount);

    list.innerHTML = toShow.map(function(alert) {
        var sevClass = alert.severity || 'info';
        var iconSymbol = sevClass === 'error' ? '!' : sevClass === 'warning' ? '!' : 'i';

        var stationColor = '#007AFF';
        if (alert.station) {
            var st = STATIONS.find(function(s) { return s.key === alert.station; });
            if (st) stationColor = st.color;
        }

        var ts = '';
        if (alert.timestamp) {
            var d = new Date(alert.timestamp);
            ts = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        return '<div class="alert-item ' + sevClass + '">'
            + '<div class="alert-icon ' + sevClass + '">' + iconSymbol + '</div>'
            + '<div style="flex:1;min-width:0">'
            +   '<div class="alert-text">'
            +     (alert.station ? '<span class="alert-station-tag" style="background:' + hexWithAlpha(stationColor, 0.12) + ';color:' + stationColor + '">' + alert.station + '</span>' : '')
            +     (alert.message || '')
            +   '</div>'
            +   '<div class="alert-meta">'
            +     (alert.run != null ? 'Run #' + alert.run : '')
            +     (ts ? ' \u00B7 ' + ts : '')
            +   '</div>'
            + '</div>'
            + '</div>';
    }).join('');

    // Show more button
    var btn = document.getElementById('alerts-show-more');
    if (btn) {
        btn.style.display = alertsData.length > alertsShownCount ? 'block' : 'none';
        btn.textContent = 'Show more (' + (alertsData.length - alertsShownCount) + ' remaining)';
    }
}

function showMoreAlerts() {
    alertsShownCount += 10;
    renderAlerts();
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

    // Re-render charts for new theme colors
    renderCycleChart();
    renderThroughputChart();
    renderWipSection();
}

// ============================================
//  Collapsible Sections
// ============================================

function toggleCollapsible(headerEl) {
    headerEl.classList.toggle('expanded');
    var body = headerEl.nextElementSibling;
    if (body && body.classList.contains('collapsible-body')) {
        body.classList.toggle('expanded');
    }
}

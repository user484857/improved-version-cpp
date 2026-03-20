/**
 * Production B — Operations Monitor
 *
 * Control-room style dashboard: dense scorecard hero, cycle time waterfall,
 * throughput vs cycle time with real-time/historical toggle, WIP visualization,
 * OEE breakdown cards, always-visible live error feed.
 *
 * Polls all analytics endpoints every 8 seconds.
 */

// ============================================
//  Station Colors
// ============================================

const STATION_COLORS = {
    MS:    '#007AFF',
    SL:    '#FF9F0A',
    Crane: '#30D158',
    HBW:   '#AF52DE',
    PM:    '#FF453A',
};

const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

// ============================================
//  Chart instances
// ============================================

let waterfallChart = null;
let throughputCycleChart = null;
let throughputTimesChart = null;

// ============================================
//  State
// ============================================

let currentView = 'realtime';
let lastLoadTime = 0;

// Cached data for view toggling
let cachedCycleData = [];
let cachedThroughputData = null;

// ============================================
//  Theme
// ============================================

function toggleTheme() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    rebuildCharts();
}

function getChartColors() {
    const style = getComputedStyle(document.documentElement);
    return {
        grid: style.getPropertyValue('--chart-grid').trim(),
        tick: style.getPropertyValue('--chart-tick').trim(),
        text: style.getPropertyValue('--text-secondary').trim(),
        textTertiary: style.getPropertyValue('--text-tertiary').trim(),
    };
}

// ============================================
//  Init
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setInterval(loadData, 8000);
    setInterval(updateTimestamp, 1000);
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

        lastLoadTime = Date.now();
        cachedCycleData = Array.isArray(cycleRes) ? cycleRes : [];
        cachedThroughputData = throughputRes;

        renderScorecard(oeeRes, throughputRes, wipRes, alertsRes);
        renderWaterfall(cachedCycleData, bottleneckRes);
        renderThroughputCycle(cachedCycleData, throughputRes);
        renderWIP(wipRes, throughputRes);
        renderOEE(oeeRes);
        renderErrorFeed(alertsRes);
    } catch (e) {
        console.error('Failed to load data:', e);
    }
}

// ============================================
//  Timestamp
// ============================================

function updateTimestamp() {
    const el = document.getElementById('last-updated');
    if (!el) return;
    if (lastLoadTime === 0) { el.textContent = '--'; return; }
    const secs = Math.round((Date.now() - lastLoadTime) / 1000);
    el.textContent = secs <= 2 ? 'live' : secs + 's ago';
    el.classList.toggle('stale', secs > 15);
}

// ============================================
//  1. SCORECARD
// ============================================

function renderScorecard(oee, throughput, wip, alerts) {
    // OEE
    const oeeVal = oee && typeof oee.oee === 'number' ? (oee.oee * 100).toFixed(1) : '--';
    setText('oee-value', oeeVal + '%');
    setDotColor('oee-dot', oee ? getStatusLevel(oee.oee, 0.65, 0.40) : 'green');

    // Throughput
    const tpVal = throughput && typeof throughput.per_hour === 'number' ? throughput.per_hour.toFixed(1) : '--';
    setText('throughput-value', tpVal + ' /hr');
    setDotColor('throughput-dot', throughput ? getStatusLevel(throughput.utilization, 0.5, 0.25) : 'green');

    // WIP
    const wipVal = wip && typeof wip.wip === 'number' ? wip.wip.toFixed(1) : '--';
    setText('wip-value', wipVal);
    setDotColor('wip-dot', 'green');

    // Active errors
    const alertArr = Array.isArray(alerts) ? alerts : [];
    const errorCount = alertArr.filter(a => a.severity === 'error').length;
    setText('errors-value', String(errorCount));
    setDotColor('errors-dot', errorCount > 0 ? 'red' : (alertArr.length > 0 ? 'yellow' : 'green'));
}

function getStatusLevel(value, goodThreshold, badThreshold) {
    if (typeof value !== 'number') return 'green';
    if (value >= goodThreshold) return 'green';
    if (value >= badThreshold) return 'yellow';
    return 'red';
}

// ============================================
//  2. WATERFALL CHART
// ============================================

function renderWaterfall(cycleData, bottleneck) {
    if (!cycleData || cycleData.length === 0) return;

    // Average across all runs
    const avgStations = {};
    STATION_ORDER.forEach(s => { avgStations[s] = []; });

    cycleData.forEach(run => {
        if (!run.stations) return;
        STATION_ORDER.forEach(s => {
            if (typeof run.stations[s] === 'number') {
                avgStations[s].push(run.stations[s]);
            }
        });
    });

    const avgValues = {};
    let total = 0;
    STATION_ORDER.forEach(s => {
        const arr = avgStations[s];
        avgValues[s] = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        total += avgValues[s];
    });

    setText('waterfall-total', total.toFixed(1) + 's');

    const bottleneckStation = bottleneck ? bottleneck.station : null;
    const theoreticalTotal = bottleneck && bottleneck.theoretical ? bottleneck.theoretical * STATION_ORDER.length : null;

    const ctx = document.getElementById('chart-waterfall');
    if (!ctx) return;
    const colors = getChartColors();

    const barColors = STATION_ORDER.map(s => STATION_COLORS[s]);
    const borderWidths = STATION_ORDER.map(s => s === bottleneckStation ? 2 : 0);
    const borderColors = STATION_ORDER.map(s =>
        s === bottleneckStation ? '#ffffff' : 'transparent'
    );

    if (waterfallChart) {
        waterfallChart.data.labels = STATION_ORDER;
        waterfallChart.data.datasets[0].data = STATION_ORDER.map(s => avgValues[s]);
        waterfallChart.data.datasets[0].backgroundColor = barColors;
        waterfallChart.data.datasets[0].borderWidth = borderWidths;
        waterfallChart.data.datasets[0].borderColor = borderColors;
        waterfallChart.update('none');
        return;
    }

    waterfallChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: STATION_ORDER,
            datasets: [{
                data: STATION_ORDER.map(s => avgValues[s]),
                backgroundColor: barColors,
                borderWidth: borderWidths,
                borderColor: borderColors,
                borderRadius: 4,
                barThickness: 28,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { right: 16 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: 'JetBrains Mono', size: 11 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) {
                            const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : '0';
                            const suffix = ctx.label === bottleneckStation ? ' (bottleneck)' : '';
                            return ctx.raw.toFixed(1) + 's  (' + pct + '%)' + suffix;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Seconds', color: colors.textTertiary, font: { size: 10, family: 'Inter' } },
                    grid: { color: colors.grid },
                    ticks: { color: colors.tick, font: { family: 'JetBrains Mono', size: 10 } },
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: function(context) {
                            const label = context.tick.label;
                            return STATION_COLORS[label] || colors.tick;
                        },
                        font: { family: 'Inter', weight: '600', size: 11 }
                    },
                }
            }
        }
    });
}

// ============================================
//  3. THROUGHPUT vs CYCLE TIME
// ============================================

function switchView(view) {
    currentView = view;
    document.querySelectorAll('#view-toggle .toggle-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    const subtitle = document.getElementById('throughput-chart-subtitle');
    if (subtitle) {
        subtitle.textContent = view === 'realtime'
            ? 'Latest 10 production runs'
            : 'All runs with moving average';
    }

    renderThroughputCycle(cachedCycleData, cachedThroughputData);
}

function renderThroughputCycle(cycleData, throughput) {
    if (!cycleData || cycleData.length === 0) return;

    const ctx = document.getElementById('chart-throughput-cycle');
    if (!ctx) return;
    const colors = getChartColors();

    const runs = currentView === 'realtime'
        ? cycleData.slice(-10)
        : cycleData;

    const labels = runs.map(r => 'Run ' + r.run);
    const cycleTimes = runs.map(r => r.total || 0);

    // Compute throughput rate per run (parts/hr based on cumulative)
    let throughputRates = [];
    if (throughput && throughput.cumulative && throughput.cumulative.length > 0) {
        const cumul = throughput.cumulative;
        const relevantCumul = currentView === 'realtime'
            ? cumul.slice(-10)
            : cumul;

        throughputRates = relevantCumul.map(c => c.rate_per_hour || 0);

        // Pad if needed
        while (throughputRates.length < runs.length) {
            throughputRates.unshift(throughput.per_hour || 0);
        }
        throughputRates = throughputRates.slice(-runs.length);
    } else {
        throughputRates = runs.map(() => throughput ? throughput.per_hour || 0 : 0);
    }

    // Moving average for historical view
    let maData = null;
    if (currentView === 'historical' && cycleTimes.length >= 3) {
        maData = computeMovingAverage(cycleTimes, 3);
    }

    const datasets = [
        {
            label: 'Cycle Time (s)',
            type: 'bar',
            data: cycleTimes,
            backgroundColor: 'rgba(0, 122, 255, 0.25)',
            borderColor: 'rgba(0, 122, 255, 0.6)',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y',
            order: 2,
        },
        {
            label: 'Throughput (/hr)',
            type: 'line',
            data: throughputRates,
            borderColor: '#30D158',
            backgroundColor: 'rgba(48, 209, 88, 0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#30D158',
            fill: true,
            tension: 0.3,
            yAxisID: 'y1',
            order: 1,
        }
    ];

    if (maData) {
        datasets.push({
            label: 'Moving Avg (3)',
            type: 'line',
            data: maData,
            borderColor: '#FF9F0A',
            borderWidth: 2,
            borderDash: [6, 3],
            pointRadius: 0,
            fill: false,
            tension: 0.3,
            yAxisID: 'y',
            order: 0,
        });
    }

    if (throughputCycleChart) {
        throughputCycleChart.data.labels = labels;
        throughputCycleChart.data.datasets = datasets;
        throughputCycleChart.update('none');
        return;
    }

    throughputCycleChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: colors.tick,
                        font: { family: 'Inter', size: 10, weight: '500' },
                        boxWidth: 10,
                        boxHeight: 10,
                        borderRadius: 3,
                        useBorderRadius: true,
                        padding: 12,
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: 'JetBrains Mono', size: 11 },
                    padding: 10,
                    cornerRadius: 8,
                }
            },
            scales: {
                x: {
                    grid: { color: colors.grid },
                    ticks: { color: colors.tick, font: { family: 'Inter', size: 10 } },
                },
                y: {
                    position: 'left',
                    title: { display: true, text: 'Cycle Time (s)', color: colors.textTertiary, font: { size: 10, family: 'Inter' } },
                    grid: { color: colors.grid },
                    ticks: { color: colors.tick, font: { family: 'JetBrains Mono', size: 10 } },
                },
                y1: {
                    position: 'right',
                    title: { display: true, text: 'Throughput (/hr)', color: colors.textTertiary, font: { size: 10, family: 'Inter' } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#30D158', font: { family: 'JetBrains Mono', size: 10 } },
                }
            }
        }
    });
}

function computeMovingAverage(data, window) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < window - 1) {
            result.push(null);
        } else {
            let sum = 0;
            for (let j = 0; j < window; j++) {
                sum += data[i - j];
            }
            result.push(sum / window);
        }
    }
    return result;
}

// ============================================
//  4. WIP + THROUGHPUT TIMES
// ============================================

function renderWIP(wip, throughput) {
    if (!wip) return;

    // Big WIP number
    setText('wip-big', typeof wip.wip === 'number' ? wip.wip.toFixed(1) : '--');

    // Meta values
    const tpRate = throughput && typeof throughput.per_hour === 'number' ? throughput.per_hour.toFixed(1) : '--';
    const avgCt = typeof wip.avg_throughput_time_s === 'number' ? wip.avg_throughput_time_s.toFixed(1) : '--';

    setText('wip-tp-rate', tpRate + ' /hr');
    setText('wip-avg-ct', avgCt + 's');

    // Formula values
    const wipVal = typeof wip.wip === 'number' ? wip.wip.toFixed(2) : '--';
    const tpRateHr = throughput && typeof throughput.per_hour === 'number' ? (throughput.per_hour / 3600).toFixed(4) : '--';
    const el = document.getElementById('wip-formula-values');
    if (el) {
        el.textContent = wipVal + ' = ' + tpRateHr + '/s \u00D7 ' + avgCt + 's';
    }

    // Throughput times bar chart
    renderThroughputTimesChart(wip);
}

function renderThroughputTimesChart(wip) {
    const perRun = wip.per_run || [];
    if (perRun.length === 0) return;

    const ctx = document.getElementById('chart-throughput-times');
    if (!ctx) return;
    const colors = getChartColors();

    const labels = perRun.map(r => '#' + r.run);
    const data = perRun.map(r => r.throughput_time_s);
    const avg = wip.avg_throughput_time_s || 0;

    const barColors = data.map(v =>
        v > avg * 1.2 ? 'rgba(255, 69, 58, 0.5)' :
        v < avg * 0.8 ? 'rgba(48, 209, 88, 0.5)' :
        'rgba(0, 122, 255, 0.35)'
    );

    if (throughputTimesChart) {
        throughputTimesChart.data.labels = labels;
        throughputTimesChart.data.datasets[0].data = data;
        throughputTimesChart.data.datasets[0].backgroundColor = barColors;
        throughputTimesChart.update('none');
        return;
    }

    throughputTimesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: barColors,
                borderRadius: 3,
                barThickness: perRun.length > 12 ? undefined : 18,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    bodyFont: { family: 'JetBrains Mono', size: 11 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) { return ctx.raw.toFixed(1) + 's'; }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: colors.tick, font: { family: 'Inter', size: 9 } },
                },
                y: {
                    grid: { color: colors.grid },
                    ticks: { color: colors.tick, font: { family: 'JetBrains Mono', size: 10 } },
                    title: { display: true, text: 'Seconds', color: colors.textTertiary, font: { size: 10, family: 'Inter' } },
                }
            }
        }
    });
}

// ============================================
//  5. OEE BREAKDOWN
// ============================================

function renderOEE(oee) {
    if (!oee) return;

    const factors = [
        { key: 'availability', id: 'avail', value: oee.availability },
        { key: 'performance', id: 'perf', value: oee.performance },
        { key: 'quality', id: 'qual', value: oee.quality },
    ];

    factors.forEach(f => {
        const pct = typeof f.value === 'number' ? (f.value * 100).toFixed(1) : '--';
        setText('oee-' + f.id + '-value', pct + '%');

        // Status dot
        const level = typeof f.value === 'number' ? getStatusLevel(f.value, 0.75, 0.50) : 'green';
        setDotColor('oee-' + f.id + '-dot', level);

        // Horizontal bar
        const bar = document.getElementById('oee-' + f.id + '-bar');
        if (bar && typeof f.value === 'number') {
            bar.style.width = Math.min(f.value * 100, 100) + '%';
            bar.classList.remove('warning', 'critical');
            if (f.value < 0.50) bar.classList.add('critical');
            else if (f.value < 0.75) bar.classList.add('warning');
        }
    });

    // Equation
    const a = typeof oee.availability === 'number' ? (oee.availability * 100).toFixed(0) + '%' : '--';
    const p = typeof oee.performance === 'number' ? (oee.performance * 100).toFixed(0) + '%' : '--';
    const q = typeof oee.quality === 'number' ? (oee.quality * 100).toFixed(0) + '%' : '--';
    const result = typeof oee.oee === 'number' ? (oee.oee * 100).toFixed(1) + '%' : '--%';

    setText('oee-eq-a', a);
    setText('oee-eq-p', p);
    setText('oee-eq-q', q);
    setText('oee-eq-result', result);
}

// ============================================
//  6. LIVE ERROR FEED
// ============================================

function renderErrorFeed(alerts) {
    const data = Array.isArray(alerts) ? alerts : [];
    const feed = document.getElementById('error-feed');
    const emptyState = document.getElementById('error-feed-empty');
    const countEl = document.getElementById('feed-count');
    const feedDot = document.getElementById('feed-status-dot');

    const errors = data.filter(a => a.severity === 'error').length;
    const warnings = data.filter(a => a.severity === 'warning').length;

    // Count label
    if (countEl) {
        countEl.textContent = data.length === 0 ? '0 alerts' : data.length + ' alert' + (data.length !== 1 ? 's' : '');
    }

    // Feed status dot
    if (feedDot) {
        feedDot.className = 'status-dot';
        if (errors > 0) feedDot.classList.add('red');
        else if (warnings > 0) feedDot.classList.add('yellow');
        else feedDot.classList.add('green');
    }

    if (!feed) return;

    if (data.length === 0) {
        feed.innerHTML = '<div class="error-feed-empty"><span class="status-dot green"></span><span>No active alerts</span></div>';
        return;
    }

    // Sort: errors first, then warnings, then info; newest first within same severity
    const order = { error: 0, warning: 1, info: 2 };
    const sorted = [...data].sort((a, b) => {
        const sevDiff = (order[a.severity] || 3) - (order[b.severity] || 3);
        if (sevDiff !== 0) return sevDiff;
        return (b.run || 0) - (a.run || 0);
    });

    feed.innerHTML = sorted.map(alert => {
        const sevClass = alert.severity || 'info';
        const typeClass = getBadgeClass(alert.type);
        const typeLabel = formatAlertType(alert.type);
        const ts = formatTimestamp(alert.timestamp);

        return '<div class="alert-item ' + sevClass + '">' +
            '<div class="alert-content">' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<span class="alert-badge ' + typeClass + '">' + typeLabel + '</span>' +
                    '<span class="alert-severity-indicator ' + sevClass + '"></span>' +
                    (alert.station ? '<span style="font-size:0.65rem;font-weight:600;color:' + (STATION_COLORS[alert.station] || 'var(--text-secondary)') + ';">' + alert.station + '</span>' : '') +
                '</div>' +
                '<span class="alert-text">' + (alert.message || 'Unknown alert') + '</span>' +
            '</div>' +
            '<span class="alert-timestamp">' + ts + '</span>' +
        '</div>';
    }).join('');

    // Auto-scroll to bottom (newest)
    feed.scrollTop = feed.scrollHeight;
}

function getBadgeClass(type) {
    const known = ['cycle_time', 'quality_drift', 'oee_low', 'bottleneck'];
    return known.includes(type) ? type : 'default';
}

function formatAlertType(type) {
    if (!type) return 'Alert';
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatTimestamp(ts) {
    if (!ts) return '--';
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return ts;
    }
}

// ============================================
//  Rebuild Charts (theme change)
// ============================================

function rebuildCharts() {
    if (waterfallChart) { waterfallChart.destroy(); waterfallChart = null; }
    if (throughputCycleChart) { throughputCycleChart.destroy(); throughputCycleChart = null; }
    if (throughputTimesChart) { throughputTimesChart.destroy(); throughputTimesChart = null; }
    loadData();
}

// ============================================
//  Helpers
// ============================================

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setDotColor(id, level) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'status-dot';
    el.classList.add(level);
}

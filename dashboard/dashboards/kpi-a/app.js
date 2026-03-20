/**
 * KPI A — Production Efficiency Gap Dashboard
 *
 * Gap analysis + interactive what-if optimization.
 * Fetches /api/analytics/cycle-times, /api/analytics/oee,
 *         /api/analytics/bottleneck, /api/analytics/timeline
 *
 * Theoretical targets: HBW=10s, Crane=12s, MS=18s, PM=4s, SL=5s
 */

// ============================================
//  Constants
// ============================================

const STATIONS = [
    { key: 'HBW',   name: 'HBW',   fullName: 'High-Bay Warehouse', target: 10, color: '#AF52DE' },
    { key: 'Crane', name: 'Crane', fullName: 'Transport Crane',    target: 12, color: '#30D158' },
    { key: 'MS',    name: 'MS',    fullName: 'Machining Station',   target: 18, color: '#007AFF' },
    { key: 'PM',    name: 'PM',    fullName: 'Punching Machine',    target: 4,  color: '#FF453A' },
    { key: 'SL',    name: 'SL',    fullName: 'Sorting Line',        target: 5,  color: '#FF9F0A' },
];

const TOTAL_TARGET = STATIONS.reduce((s, st) => s + st.target, 0); // 49s

const CHART_COLORS = {
    gridDark:  'rgba(255,255,255,0.04)',
    gridLight: 'rgba(0,0,0,0.04)',
    tickDark:  'rgba(255,255,255,0.22)',
    tickLight: 'rgba(0,0,0,0.30)',
};

// ============================================
//  State
// ============================================

let cycleData   = [];   // from /api/analytics/cycle-times
let bottleneck  = null; // from /api/analytics/bottleneck
let avgActuals  = {};   // computed average per station
let whatIfVals  = {};   // current slider values

let selectedStation = null;  // for station breakdown
let selectedRun     = null;  // for run deep-dive

let yamazumiChart = null;
let trendChart    = null;
let waterfallChart = null;

// ============================================
//  Init
// ============================================

function init() {
    loadData();
    setInterval(loadData, 8000);

    // Load DB stats indicator
    loadDbStats();
    setInterval(loadDbStats, 30000);
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

async function loadData() {
    try {
        const [ctRes, bnRes] = await Promise.all([
            fetch('/api/analytics/cycle-times'),
            fetch('/api/analytics/bottleneck'),
        ]);
        cycleData  = await ctRes.json();
        bottleneck = await bnRes.json();

        computeAverages();
        renderHero();
        renderStackedBars();
        renderStationCards();
        initWhatIf();
        renderStationToggles();
        renderRunSelector();
        renderWaterfallChart();
    } catch (e) {
        // silent fail — data may not be available yet
    }
}

// ============================================
//  Compute Averages
// ============================================

function computeAverages() {
    const sums = {};
    const counts = {};
    STATIONS.forEach(st => { sums[st.key] = 0; counts[st.key] = 0; });

    cycleData.forEach(run => {
        STATIONS.forEach(st => {
            const v = run.stations[st.key];
            if (v != null) {
                sums[st.key] += v;
                counts[st.key]++;
            }
        });
    });

    STATIONS.forEach(st => {
        avgActuals[st.key] = counts[st.key] > 0
            ? sums[st.key] / counts[st.key]
            : st.target;
    });
}

// ============================================
//  Hero Banner
// ============================================

function renderHero() {
    const actualTotal = STATIONS.reduce((s, st) => s + (avgActuals[st.key] || st.target), 0);
    const excess = Math.max(actualTotal - TOTAL_TARGET, 0);
    const gapPct = (excess / TOTAL_TARGET) * 100;
    const effPct = Math.max(100 - gapPct, 0);

    // Gap value
    const gapEl = document.getElementById('hero-gap-value');
    if (gapEl) {
        animateValue(gapEl, gapPct);
        gapEl.style.color = gapPct > 30 ? 'var(--red)' : gapPct > 15 ? 'var(--orange)' : 'var(--green)';
    }

    // Animated bars
    const barEff = document.getElementById('hero-bar-eff');
    const barGap = document.getElementById('hero-bar-gap');
    if (barEff) barEff.style.width = effPct.toFixed(1) + '%';
    if (barGap) barGap.style.width = (100 - effPct).toFixed(1) + '%';

    // Labels
    const labelEff = document.getElementById('hero-label-eff');
    const labelGap = document.getElementById('hero-label-gap');
    if (labelEff) labelEff.textContent = 'Efficient: ' + effPct.toFixed(1) + '%';
    if (labelGap) labelGap.textContent = 'Gap: ' + gapPct.toFixed(1) + '%';

    // Totals
    const elActual = document.getElementById('hero-actual-total');
    const elTarget = document.getElementById('hero-target-total');
    const elExcess = document.getElementById('hero-excess-total');
    if (elActual) elActual.textContent = 'Actual: ' + actualTotal.toFixed(1) + 's';
    if (elTarget) elTarget.textContent = 'Target: ' + TOTAL_TARGET + 's';
    if (elExcess) elExcess.textContent = 'Excess: +' + excess.toFixed(1) + 's';
}

function animateValue(el, target) {
    const start = parseFloat(el.textContent) || 0;
    const diff = target - start;
    const duration = 800;
    const startTime = performance.now();

    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        el.textContent = (start + diff * eased).toFixed(1);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ============================================
//  Stacked Comparison Bars
// ============================================

function renderStackedBars() {
    const runsLabel = document.getElementById('stacked-runs-label');
    if (runsLabel) runsLabel.textContent = cycleData.length + ' runs';

    const actualTotal = STATIONS.reduce((s, st) => s + (avgActuals[st.key] || 0), 0);
    const maxTotal = Math.max(actualTotal, TOTAL_TARGET);

    // Actual bar
    const actualTrack = document.getElementById('stacked-actual-track');
    if (actualTrack) {
        actualTrack.innerHTML = STATIONS.map(st => {
            const val = avgActuals[st.key] || 0;
            const pct = (val / maxTotal) * 100;
            return '<div class="stacked-segment" style="width:' + pct.toFixed(1) + '%;background:' + st.color + '"'
                + ' title="' + st.key + ': ' + val.toFixed(1) + 's">'
                + (pct > 6 ? val.toFixed(1) + 's' : '') + '</div>';
        }).join('');
    }
    const actualTotalEl = document.getElementById('stacked-actual-total');
    if (actualTotalEl) actualTotalEl.textContent = actualTotal.toFixed(1) + 's';

    // Target bar
    const targetTrack = document.getElementById('stacked-target-track');
    if (targetTrack) {
        targetTrack.innerHTML = STATIONS.map(st => {
            const pct = (st.target / maxTotal) * 100;
            return '<div class="stacked-segment" style="width:' + pct.toFixed(1) + '%;background:' + st.color + ';opacity:0.5"'
                + ' title="' + st.key + ': ' + st.target + 's">'
                + (pct > 6 ? st.target + 's' : '') + '</div>';
        }).join('');
    }
    const targetTotalEl = document.getElementById('stacked-target-total');
    if (targetTotalEl) targetTotalEl.textContent = TOTAL_TARGET + 's';

    // Legend
    const legend = document.getElementById('stacked-legend');
    if (legend) {
        legend.innerHTML = STATIONS.map(st =>
            '<div class="stacked-legend-item">'
            + '<div class="stacked-legend-dot" style="background:' + st.color + '"></div>'
            + '<span>' + st.key + '</span>'
            + '</div>'
        ).join('');
    }
}

// ============================================
//  Station Timing Cards (Traffic Lights)
// ============================================

function renderStationCards() {
    const grid = document.getElementById('station-cards-grid');
    if (!grid) return;

    grid.innerHTML = STATIONS.map(st => {
        const actual = avgActuals[st.key] || 0;
        const gap = actual - st.target;
        const gapPct = st.target > 0 ? (gap / st.target) * 100 : 0;

        // Traffic light: green <= 10%, orange 10-30%, red > 30%
        let trafficClass = 'traffic-green';
        if (gapPct > 30) trafficClass = 'traffic-red';
        else if (gapPct > 10) trafficClass = 'traffic-orange';

        // Mini bar: fill relative to 2x target as max
        const barMax = st.target * 2;
        const fillPct = Math.min((actual / barMax) * 100, 100);
        const targetPct = Math.min((st.target / barMax) * 100, 100);

        // Fill color
        let fillColor = st.color;
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
//  What-If Optimizer
// ============================================

let whatIfInitialized = false;

function initWhatIf() {
    if (whatIfInitialized) return;
    whatIfInitialized = true;

    const container = document.getElementById('whatif-container');
    if (!container) return;

    // Initialize slider values to current actuals
    STATIONS.forEach(st => {
        whatIfVals[st.key] = avgActuals[st.key] || st.target;
    });

    container.innerHTML = STATIONS.map(st => {
        const actual = avgActuals[st.key] || st.target;
        const minVal = st.target;
        const maxVal = Math.max(actual * 1.5, st.target * 2);
        const sliderBg = computeSliderBg(actual, minVal, maxVal, st.color);

        return '<div class="whatif-row">'
            + '<span class="whatif-station-label" style="color:' + st.color + '">' + st.key + '</span>'
            + '<div class="whatif-slider-area">'
            +   '<div class="whatif-slider-labels">'
            +     '<span>' + minVal.toFixed(0) + 's (target)</span>'
            +     '<span>' + maxVal.toFixed(0) + 's</span>'
            +   '</div>'
            +   '<input type="range" class="whatif-slider" '
            +     'id="whatif-slider-' + st.key + '" '
            +     'min="' + minVal + '" max="' + maxVal + '" step="0.1" '
            +     'value="' + actual.toFixed(1) + '" '
            +     'style="--slider-color:' + st.color + ';' + sliderBg + '" '
            +     'oninput="onWhatIfChange(\'' + st.key + '\', this)">'
            + '</div>'
            + '<span class="whatif-current-val" id="whatif-val-' + st.key + '" style="color:' + st.color + '">'
            +   actual.toFixed(1) + 's'
            + '</span>'
            + '</div>';
    }).join('');

    updateWhatIfResult();
}

function computeSliderBg(val, min, max, color) {
    const pct = ((val - min) / (max - min)) * 100;
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const trackBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    return 'background: linear-gradient(90deg, ' + color + ' 0%, ' + color + ' ' + pct + '%, ' + trackBg + ' ' + pct + '%, ' + trackBg + ' 100%)';
}

function onWhatIfChange(stationKey, slider) {
    const val = parseFloat(slider.value);
    whatIfVals[stationKey] = val;

    const label = document.getElementById('whatif-val-' + stationKey);
    if (label) label.textContent = val.toFixed(1) + 's';

    // Update slider background fill
    const st = STATIONS.find(s => s.key === stationKey);
    if (st) {
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        slider.style.cssText += computeSliderBg(val, min, max, st.color);
    }

    updateWhatIfResult();
}

function updateWhatIfResult() {
    const currentTotal = STATIONS.reduce((s, st) => s + (avgActuals[st.key] || st.target), 0);
    const projectedTotal = STATIONS.reduce((s, st) => s + (whatIfVals[st.key] || avgActuals[st.key] || st.target), 0);

    const projectedEl = document.getElementById('whatif-projected');
    if (projectedEl) projectedEl.textContent = projectedTotal.toFixed(1) + 's';

    // Bar
    const maxBar = Math.max(currentTotal, projectedTotal, TOTAL_TARGET) * 1.1;
    const barCurrent = document.getElementById('whatif-bar-current');
    const barProjected = document.getElementById('whatif-bar-projected');
    if (barCurrent) barCurrent.style.width = ((currentTotal / maxBar) * 100).toFixed(1) + '%';
    if (barProjected) barProjected.style.width = ((projectedTotal / maxBar) * 100).toFixed(1) + '%';

    // Savings chips
    const savingsEl = document.getElementById('whatif-savings');
    if (savingsEl) {
        let html = '';
        let totalSaved = 0;

        STATIONS.forEach(st => {
            const actual = avgActuals[st.key] || st.target;
            const projected = whatIfVals[st.key] || actual;
            const saved = actual - projected;
            totalSaved += saved;

            if (Math.abs(saved) > 0.05) {
                html += '<div class="whatif-savings-chip">'
                    + '<span class="chip-dot" style="background:' + st.color + '"></span>'
                    + st.key + ': ' + (saved > 0 ? '-' : '+') + Math.abs(saved).toFixed(1) + 's'
                    + '</div>';
            } else {
                html += '<div class="whatif-savings-chip no-change">'
                    + '<span class="chip-dot" style="background:' + st.color + '"></span>'
                    + st.key + ': 0s'
                    + '</div>';
            }
        });

        if (Math.abs(totalSaved) > 0.05) {
            html += '<div class="whatif-savings-total">'
                + 'Total: ' + (totalSaved > 0 ? '-' : '+') + Math.abs(totalSaved).toFixed(1) + 's '
                + '(' + (totalSaved > 0 ? '-' : '+') + Math.abs((totalSaved / currentTotal) * 100).toFixed(1) + '%)'
                + '</div>';
        }

        savingsEl.innerHTML = html;
    }
}

// ============================================
//  Station Breakdown (Yamazumi + Trend)
// ============================================

function renderStationToggles() {
    const row = document.getElementById('station-toggle-row');
    if (!row) return;

    row.innerHTML = STATIONS.map(st =>
        '<button class="station-toggle-btn' + (selectedStation === st.key ? ' active' : '') + '"'
        + ' onclick="selectStation(\'' + st.key + '\')">'
        + st.key
        + '</button>'
    ).join('');
}

function selectStation(key) {
    selectedStation = key;
    renderStationToggles();
    renderYamazumi(key);
    renderTrend(key);
}

function renderYamazumi(stationKey) {
    const titleEl = document.getElementById('yamazumi-title');
    const subtitleEl = document.getElementById('yamazumi-subtitle');
    const canvas = document.getElementById('yamazumi-chart');
    if (!canvas) return;

    const st = STATIONS.find(s => s.key === stationKey);
    if (titleEl) titleEl.textContent = (st ? st.fullName : stationKey) + ' Breakdown';

    // Collect sub-step data — only MS has ms_substeps
    if (stationKey === 'MS') {
        const substepSums = {};
        const substepCounts = {};

        cycleData.forEach(run => {
            const sub = run.ms_substeps;
            if (!sub) return;
            Object.keys(sub).forEach(k => {
                substepSums[k] = (substepSums[k] || 0) + sub[k];
                substepCounts[k] = (substepCounts[k] || 0) + 1;
            });
        });

        const substepKeys = Object.keys(substepSums);
        if (substepKeys.length === 0) {
            if (subtitleEl) subtitleEl.textContent = 'No sub-step data available';
            destroyChart('yamazumi');
            return;
        }

        const labels = substepKeys.map(k => formatSubstepName(k));
        const values = substepKeys.map(k => substepSums[k] / substepCounts[k]);
        const colors = generateSubstepColors(substepKeys.length, st.color);

        if (subtitleEl) subtitleEl.textContent = substepKeys.length + ' sub-steps, avg over ' + cycleData.length + ' runs';

        renderYamazumiChart(labels, values, colors);
    } else {
        // Non-MS stations: show single bar with actual vs target
        const actual = avgActuals[stationKey] || 0;
        const labels = ['Actual', 'Target'];
        const values = [actual, st.target];
        const colors = [st.color, hexWithAlpha(st.color, 0.35)];

        if (subtitleEl) subtitleEl.textContent = 'Avg: ' + actual.toFixed(1) + 's / Target: ' + st.target + 's';

        renderYamazumiChart(labels, values, colors);
    }
}

function renderYamazumiChart(labels, values, colors) {
    const canvas = document.getElementById('yamazumi-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (yamazumiChart) yamazumiChart.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    yamazumiChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderRadius: 6,
                borderSkipped: false,
                maxBarThickness: 44,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(30,30,34,0.95)' : 'rgba(255,255,255,0.95)',
                    titleColor: isDark ? '#fff' : '#000',
                    bodyColor: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) { return ctx.parsed.y.toFixed(2) + 's'; },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: isDark ? CHART_COLORS.tickDark : CHART_COLORS.tickLight,
                        font: { size: 10, family: 'Inter', weight: 500 },
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: isDark ? CHART_COLORS.gridDark : CHART_COLORS.gridLight },
                    ticks: {
                        color: isDark ? CHART_COLORS.tickDark : CHART_COLORS.tickLight,
                        font: { size: 10, family: "'SF Mono', 'JetBrains Mono', monospace" },
                        callback: function(v) { return v + 's'; },
                    },
                },
            },
        },
    });
}

function renderTrend(stationKey) {
    const titleEl = document.getElementById('trend-title');
    const subtitleEl = document.getElementById('trend-subtitle');
    const canvas = document.getElementById('trend-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const st = STATIONS.find(s => s.key === stationKey);
    if (titleEl) titleEl.textContent = stationKey + ' Cycle Time Trend';

    const runs = [];
    const values = [];
    cycleData.forEach(run => {
        const v = run.stations[stationKey];
        if (v != null) {
            runs.push('Run ' + run.run);
            values.push(v);
        }
    });

    if (subtitleEl) subtitleEl.textContent = values.length + ' runs recorded';

    if (trendChart) trendChart.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const targetLine = st ? st.target : 0;

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: runs,
            datasets: [
                {
                    label: stationKey + ' actual',
                    data: values,
                    borderColor: st ? st.color : '#007AFF',
                    backgroundColor: st ? hexWithAlpha(st.color, 0.08) : 'rgba(0,122,255,0.08)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: st ? st.color : '#007AFF',
                    pointBorderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
                    pointBorderWidth: 2,
                    borderWidth: 2,
                },
                {
                    label: 'Target',
                    data: new Array(runs.length).fill(targetLine),
                    borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)',
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
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(30,30,34,0.95)' : 'rgba(255,255,255,0.95)',
                    titleColor: isDark ? '#fff' : '#000',
                    bodyColor: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) + 's'; },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: isDark ? CHART_COLORS.tickDark : CHART_COLORS.tickLight,
                        font: { size: 10, family: "'SF Mono', 'JetBrains Mono', monospace" },
                        maxRotation: 0,
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: isDark ? CHART_COLORS.gridDark : CHART_COLORS.gridLight },
                    ticks: {
                        color: isDark ? CHART_COLORS.tickDark : CHART_COLORS.tickLight,
                        font: { size: 10, family: "'SF Mono', 'JetBrains Mono', monospace" },
                        callback: function(v) { return v + 's'; },
                    },
                },
            },
        },
    });
}

// ============================================
//  Run Deep-Dive
// ============================================

function renderRunSelector() {
    const row = document.getElementById('run-selector-row');
    if (!row || cycleData.length === 0) return;

    row.innerHTML = cycleData.map(run =>
        '<button class="run-btn' + (selectedRun === run.run ? ' active' : '') + '"'
        + ' onclick="selectRun(' + run.run + ')">'
        + '#' + run.run
        + '</button>'
    ).join('');
}

function selectRun(runNum) {
    selectedRun = runNum;
    renderRunSelector();
    renderRunDetail(runNum);
}

function renderRunDetail(runNum) {
    const container = document.getElementById('run-detail-container');
    if (!container) return;

    const run = cycleData.find(r => r.run === runNum);
    if (!run) {
        container.innerHTML = '<div class="run-detail-placeholder">Run data not found</div>';
        return;
    }

    let runTotal = 0;
    const cards = STATIONS.map(st => {
        const val = run.stations[st.key];
        const actual = val != null ? val : 0;
        runTotal += actual;
        const diff = actual - st.target;
        const diffClass = diff > 0 ? 'gap-over' : 'gap-ok';

        // Traffic dot
        const pctOver = st.target > 0 ? (diff / st.target) * 100 : 0;
        let trafficClass = 'traffic-green';
        if (pctOver > 30) trafficClass = 'traffic-red';
        else if (pctOver > 10) trafficClass = 'traffic-orange';

        return '<div class="run-station-card glass">'
            + '<div class="station-accent" style="background:' + st.color + '"></div>'
            + '<div class="run-card-head">'
            +   '<span class="run-card-name" style="color:' + st.color + '">' + st.key + '</span>'
            +   '<div class="station-traffic-dot ' + trafficClass + '"></div>'
            + '</div>'
            + '<div class="run-card-time">' + actual.toFixed(1) + 's</div>'
            + '<div class="run-card-meta">'
            +   '<span class="run-card-target">target: ' + st.target + 's</span>'
            +   '<span class="run-card-diff ' + diffClass + '">'
            +     (diff > 0 ? '+' : '') + diff.toFixed(1) + 's'
            +   '</span>'
            + '</div>'
            + '</div>';
    }).join('');

    const totalDiff = runTotal - TOTAL_TARGET;
    const totalDiffClass = totalDiff > 0 ? 'gap-over' : 'gap-ok';

    container.innerHTML = '<div class="run-detail-grid">' + cards + '</div>'
        + '<div class="run-total-banner">'
        +   '<span class="run-total-label">Run #' + runNum + ' total</span>'
        +   '<div>'
        +     '<span class="run-total-value">' + runTotal.toFixed(1) + 's</span>'
        +     '<span class="run-total-diff ' + totalDiffClass + '">'
        +       (totalDiff > 0 ? '+' : '') + totalDiff.toFixed(1) + 's vs target'
        +     '</span>'
        +   '</div>'
        + '</div>';
}

// ============================================
//  Waterfall Chart
// ============================================

function renderWaterfallChart() {
    const canvas = document.getElementById('waterfall-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const totalExcessEl = document.getElementById('waterfall-total');

    // Compute losses per station
    const losses = [];
    let totalExcess = 0;

    STATIONS.forEach(st => {
        const actual = avgActuals[st.key] || 0;
        const loss = Math.max(actual - st.target, 0);
        losses.push({ station: st, loss: loss });
        totalExcess += loss;
    });

    if (totalExcessEl) totalExcessEl.textContent = 'Total excess: +' + totalExcess.toFixed(1) + 's';

    // Sort by loss descending for waterfall impact
    const sorted = [...losses].sort((a, b) => b.loss - a.loss);

    // Build waterfall data: floating bars
    const labels = [];
    const barData = [];
    const bgColors = [];
    let cumulative = 0;

    // Starting point: target
    labels.push('Target');
    barData.push([0, TOTAL_TARGET]);
    bgColors.push('rgba(48, 209, 88, 0.6)');

    sorted.forEach(item => {
        if (item.loss > 0.05) {
            labels.push(item.station.key + ' +' + item.loss.toFixed(1) + 's');
            barData.push([TOTAL_TARGET + cumulative, TOTAL_TARGET + cumulative + item.loss]);
            bgColors.push(hexWithAlpha(item.station.color, 0.7));
            cumulative += item.loss;
        }
    });

    // Total bar
    const actualTotal = TOTAL_TARGET + totalExcess;
    labels.push('Actual');
    barData.push([0, actualTotal]);
    bgColors.push('rgba(255, 69, 58, 0.5)');

    if (waterfallChart) waterfallChart.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    waterfallChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: barData,
                backgroundColor: bgColors,
                borderRadius: 4,
                borderSkipped: false,
                maxBarThickness: 56,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(30,30,34,0.95)' : 'rgba(255,255,255,0.95)',
                    titleColor: isDark ? '#fff' : '#000',
                    bodyColor: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) {
                            const range = ctx.raw;
                            if (Array.isArray(range)) {
                                return (range[1] - range[0]).toFixed(1) + 's';
                            }
                            return ctx.parsed.x.toFixed(1) + 's';
                        },
                    },
                },
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: isDark ? CHART_COLORS.gridDark : CHART_COLORS.gridLight },
                    ticks: {
                        color: isDark ? CHART_COLORS.tickDark : CHART_COLORS.tickLight,
                        font: { size: 10, family: "'SF Mono', 'JetBrains Mono', monospace" },
                        callback: function(v) { return v + 's'; },
                    },
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: isDark ? CHART_COLORS.tickDark : CHART_COLORS.tickLight,
                        font: { size: 11, family: 'Inter', weight: 600 },
                    },
                },
            },
        },
    });
}

// ============================================
//  Theme Toggle
// ============================================

function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);

    // Refresh charts with new theme colors
    if (selectedStation) {
        renderYamazumi(selectedStation);
        renderTrend(selectedStation);
    }
    renderWaterfallChart();

    // Refresh what-if slider backgrounds
    STATIONS.forEach(st => {
        const slider = document.getElementById('whatif-slider-' + st.key);
        if (slider) {
            const val = parseFloat(slider.value);
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            slider.style.cssText += computeSliderBg(val, min, max, st.color);
        }
    });
}

// ============================================
//  Collapsible Sections
// ============================================

function toggleCollapsible(headerEl) {
    headerEl.classList.toggle('expanded');
    const body = headerEl.nextElementSibling;
    if (body && body.classList.contains('collapsible-body')) {
        body.classList.toggle('expanded');
    }
}

// ============================================
//  Helpers
// ============================================

function formatSubstepName(key) {
    const map = {
        conveyor: 'Conveyor',
        transfer_to_oven: 'Transfer In',
        burn: 'Burn',
        saw: 'Saw',
        eject: 'Eject',
        oven_load: 'Oven Load',
        oven_unload: 'Oven Unload',
        transfer_back: 'Transfer Out',
        turntable_to_saw: 'TT to Saw',
    };
    return map[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function generateSubstepColors(count, baseColor) {
    // Generate a palette from the base color with varying opacity
    const colors = [];
    for (let i = 0; i < count; i++) {
        const alpha = 0.45 + (0.55 * (i / Math.max(count - 1, 1)));
        colors.push(hexWithAlpha(baseColor, alpha));
    }
    return colors;
}

function hexWithAlpha(hex, alpha) {
    // Convert hex like #007AFF to rgba
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function destroyChart(name) {
    if (name === 'yamazumi' && yamazumiChart) {
        yamazumiChart.destroy();
        yamazumiChart = null;
    }
    if (name === 'trend' && trendChart) {
        trendChart.destroy();
        trendChart = null;
    }
    if (name === 'waterfall' && waterfallChart) {
        waterfallChart.destroy();
        waterfallChart = null;
    }
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

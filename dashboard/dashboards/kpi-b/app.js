/**
 * KPI B -- Bottleneck Hero + Stacked Timeline
 *
 * Fetches /api/analytics/cycle-times, /api/analytics/bottleneck, /api/analytics/oee
 * Renders hero bottleneck card, stacked bars, station pills with traffic lights,
 * collapsible per-station trend, collapsible waterfall chart.
 *
 * Theoretical cycle times (seconds):
 *   HBW=10, Crane=12, MS=18, PM=4, SL=5
 */

// ============================================
//  Constants
// ============================================

const STATIONS = [
    { key: 'HBW',   label: 'High-Bay Warehouse', target: 10 },
    { key: 'Crane', label: 'Transport Crane',     target: 12 },
    { key: 'MS',    label: 'Machining Station',   target: 18 },
    { key: 'PM',    label: 'Punching Machine',    target: 4  },
    { key: 'SL',    label: 'Sorting Line',        target: 5  },
];

const STATION_COLORS = {
    HBW:   '#AF52DE',
    Crane: '#30D158',
    MS:    '#007AFF',
    PM:    '#FF453A',
    SL:    '#5AC8FA',
};

const TARGET_MAP = {};
STATIONS.forEach(s => { TARGET_MAP[s.key] = s.target; });

const TOTAL_TARGET = STATIONS.reduce((sum, s) => sum + s.target, 0);

// Traffic light thresholds: green < 1.15x, orange 1.15x-1.5x, red > 1.5x
const TRAFFIC_MULT = { orange: 1.15, red: 1.50 };

// ============================================
//  State
// ============================================

let cycleData = [];
let bottleneckData = null;
let selectedStation = null;
let trendChart = null;
let waterfallChart = null;

// ============================================
//  Init
// ============================================

function init() {
    loadData();
    setInterval(loadData, 8000);
}

async function loadData() {
    try {
        const [cycleRes, bottleRes] = await Promise.all([
            fetch('/api/analytics/cycle-times'),
            fetch('/api/analytics/bottleneck'),
        ]);

        cycleData = await cycleRes.json();
        bottleneckData = await bottleRes.json();

        renderAll();
    } catch (e) {
        // Silent — retry on next interval
    }
}

// ============================================
//  Render All
// ============================================

function renderAll() {
    renderHero();
    renderStacked();
    renderPills();
    if (selectedStation) renderTrend(selectedStation);
    renderWaterfall();
}

// ============================================
//  Hero: Bottleneck Card
// ============================================

function renderHero() {
    if (!bottleneckData || !bottleneckData.station) return;

    const st = bottleneckData.station;
    const avg = bottleneckData.avg_cycle_time;
    const target = TARGET_MAP[st] || 0;
    const excess = Math.max(avg - target, 0);
    const info = STATIONS.find(s => s.key === st);

    // Station name
    const nameEl = document.getElementById('hero-station-name');
    const fullnameEl = document.getElementById('hero-station-fullname');
    if (nameEl) nameEl.textContent = st;
    if (fullnameEl) fullnameEl.textContent = info ? info.label : st;

    // Color the station name
    if (nameEl) nameEl.style.color = STATION_COLORS[st] || 'inherit';

    // Timing values
    const actualEl = document.getElementById('hero-actual');
    const targetEl = document.getElementById('hero-target');
    const excessEl = document.getElementById('hero-excess-val');
    if (actualEl) actualEl.textContent = avg.toFixed(1);
    if (targetEl) targetEl.textContent = target.toFixed(0);
    if (excessEl) excessEl.textContent = '+' + excess.toFixed(1) + 's';

    // Hero bar: fill proportional to actual, marker at target
    const maxBar = Math.max(avg, target) * 1.2;
    const fillPct = (avg / maxBar) * 100;
    const markerPct = (target / maxBar) * 100;

    const fillEl = document.getElementById('hero-bar-fill');
    const markerEl = document.getElementById('hero-bar-marker');
    if (fillEl) fillEl.style.width = fillPct + '%';
    if (markerEl) markerEl.style.left = markerPct + '%';

    // Gradient color based on severity
    if (fillEl) {
        const ratio = avg / target;
        if (ratio > TRAFFIC_MULT.red) {
            fillEl.style.background = 'linear-gradient(90deg, #FF453A, #FF6B6B)';
        } else if (ratio > TRAFFIC_MULT.orange) {
            fillEl.style.background = 'linear-gradient(90deg, #FF9F0A, #FFB340)';
        } else {
            fillEl.style.background = 'linear-gradient(90deg, #30D158, #5DD97B)';
        }
    }

    // Insight text
    const insightEl = document.getElementById('hero-insight-text');
    if (insightEl && bottleneckData.all_averages) {
        const totalActual = Object.values(bottleneckData.all_averages).reduce((a, b) => a + b, 0);
        const savings = excess;
        if (savings > 0.5) {
            insightEl.textContent = 'Optimizing ' + st + ' to target saves ' +
                savings.toFixed(1) + 's per cycle (' +
                ((savings / totalActual) * 100).toFixed(0) + '% of total). ' +
                bottleneckData.recommendation;
        } else {
            insightEl.textContent = 'All stations operating near target. ' +
                'Total cycle: ' + totalActual.toFixed(1) + 's vs ' + TOTAL_TARGET + 's target.';
        }
    }

    // Badge color matches station
    const badge = document.getElementById('hero-badge');
    if (badge) {
        const c = STATION_COLORS[st] || '#FF453A';
        badge.style.background = hexToRgba(c, 0.10);
        badge.style.borderColor = hexToRgba(c, 0.18);
        const badgeLabel = badge.querySelector('.hero-badge-label');
        if (badgeLabel) badgeLabel.style.color = c;
    }
}

// ============================================
//  Stacked Bars: Actual vs Target
// ============================================

function renderStacked() {
    if (!cycleData || cycleData.length === 0) return;

    // Compute averages per station
    const avgs = {};
    STATIONS.forEach(s => {
        const vals = cycleData
            .map(r => r.stations[s.key])
            .filter(v => v != null);
        avgs[s.key] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });

    const actualTotal = STATIONS.reduce((sum, s) => sum + (avgs[s.key] || 0), 0);

    // Max for scaling both bars
    const maxTotal = Math.max(actualTotal, TOTAL_TARGET);

    // Actual bar
    const actualTrack = document.getElementById('stacked-actual-track');
    if (actualTrack) {
        actualTrack.innerHTML = STATIONS.map(s => {
            const val = avgs[s.key] || 0;
            const pct = (val / maxTotal) * 100;
            const color = STATION_COLORS[s.key];
            const label = pct > 6 ? (val.toFixed(1) + 's') : '';
            return '<div class="stacked-segment" style="width:' + pct +
                '%;background:' + color + '" title="' + s.key + ': ' +
                val.toFixed(1) + 's">' + label + '</div>';
        }).join('');
    }

    // Target bar
    const targetTrack = document.getElementById('stacked-target-track');
    if (targetTrack) {
        targetTrack.innerHTML = STATIONS.map(s => {
            const pct = (s.target / maxTotal) * 100;
            const color = STATION_COLORS[s.key];
            const label = pct > 6 ? (s.target + 's') : '';
            return '<div class="stacked-segment" style="width:' + pct +
                '%;background:' + color + ';opacity:0.45" title="' + s.key +
                ' target: ' + s.target + 's">' + label + '</div>';
        }).join('');
    }

    // Totals
    const actualTotalEl = document.getElementById('stacked-actual-total');
    const targetTotalEl = document.getElementById('stacked-target-total');
    if (actualTotalEl) actualTotalEl.textContent = actualTotal.toFixed(1) + 's';
    if (targetTotalEl) targetTotalEl.textContent = TOTAL_TARGET + 's';

    // Runs label
    const runsLabel = document.getElementById('stacked-runs-label');
    if (runsLabel) runsLabel.textContent = cycleData.length + ' runs';

    // Legend
    const legendEl = document.getElementById('stacked-legend');
    if (legendEl) {
        legendEl.innerHTML = STATIONS.map(s =>
            '<div class="stacked-legend-item">' +
            '<div class="stacked-legend-dot" style="background:' + STATION_COLORS[s.key] + '"></div>' +
            '<span>' + s.key + '</span></div>'
        ).join('');
    }
}

// ============================================
//  Station Pills with Traffic Lights
// ============================================

function renderPills() {
    const container = document.getElementById('station-pills');
    if (!container) return;

    // Compute averages
    const avgs = {};
    STATIONS.forEach(s => {
        const vals = cycleData
            .map(r => r.stations[s.key])
            .filter(v => v != null);
        avgs[s.key] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });

    container.innerHTML = STATIONS.map(s => {
        const avg = avgs[s.key] || 0;
        const ratio = avg / s.target;
        const diff = avg - s.target;

        let trafficClass = 'traffic-green';
        if (ratio > TRAFFIC_MULT.red) trafficClass = 'traffic-red';
        else if (ratio > TRAFFIC_MULT.orange) trafficClass = 'traffic-orange';

        const gapClass = diff > 0 ? 'over' : 'ok';
        const gapSign = diff > 0 ? '+' : '';
        const isActive = selectedStation === s.key ? ' active' : '';

        return '<div class="station-pill' + isActive + '" data-station="' + s.key +
            '" onclick="selectStation(\'' + s.key + '\')">' +
            '<div class="pill-traffic-dot ' + trafficClass + '"></div>' +
            '<div class="pill-info">' +
            '<span class="pill-station-name">' + s.key + '</span>' +
            '<span class="pill-timing">' + avg.toFixed(1) + 's / ' + s.target + 's</span>' +
            '</div>' +
            '<span class="pill-gap ' + gapClass + '">' + gapSign + diff.toFixed(1) + 's</span>' +
            '</div>';
    }).join('');
}

// ============================================
//  Station Selection -> Trend
// ============================================

function selectStation(stKey) {
    const trendSection = document.getElementById('trend-section');
    if (!trendSection) return;

    if (selectedStation === stKey) {
        // Deselect
        selectedStation = null;
        trendSection.style.display = 'none';
        renderPills();
        return;
    }

    selectedStation = stKey;
    trendSection.style.display = '';
    renderPills();
    renderTrend(stKey);
}

// ============================================
//  Trend Chart (per-station, per-run)
// ============================================

function renderTrend(stKey) {
    const info = STATIONS.find(s => s.key === stKey);
    if (!info) return;

    const titleEl = document.getElementById('trend-title');
    const subtitleEl = document.getElementById('trend-subtitle');
    if (titleEl) titleEl.textContent = stKey + ' Trend';
    if (subtitleEl) subtitleEl.textContent = info.label + ' -- cycle time per run';

    const runs = cycleData.map(r => r.run);
    const values = cycleData.map(r => r.stations[stKey] || null);
    const color = STATION_COLORS[stKey] || '#007AFF';

    const ctx = document.getElementById('trend-chart');
    if (!ctx) return;

    if (trendChart) trendChart.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
    const tickColor = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)';

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: runs.map(r => 'Run ' + r),
            datasets: [
                {
                    label: stKey + ' Actual',
                    data: values,
                    borderColor: color,
                    backgroundColor: hexToRgba(color, 0.08),
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: color,
                    pointBorderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
                    pointBorderWidth: 2,
                    borderWidth: 2.5,
                },
                {
                    label: 'Target',
                    data: runs.map(() => info.target),
                    borderColor: isDark ? 'rgba(48,209,88,0.5)' : 'rgba(40,205,65,0.5)',
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
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: "'SF Mono','JetBrains Mono',monospace", size: 11 },
                    callbacks: {
                        label: function(ctx) {
                            return ctx.dataset.label + ': ' + (ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) + 's' : '--');
                        }
                    }
                },
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: tickColor, font: { family: "'SF Mono','JetBrains Mono',monospace", size: 10 } },
                },
                y: {
                    grid: { color: gridColor },
                    ticks: {
                        color: tickColor,
                        font: { family: "'SF Mono','JetBrains Mono',monospace", size: 10 },
                        callback: function(v) { return v + 's'; }
                    },
                    beginAtZero: true,
                },
            },
        },
    });
}

// ============================================
//  Waterfall: Cumulative Excess Time
// ============================================

function renderWaterfall() {
    if (!cycleData || cycleData.length === 0) return;

    // Compute averages
    const avgs = {};
    STATIONS.forEach(s => {
        const vals = cycleData
            .map(r => r.stations[s.key])
            .filter(v => v != null);
        avgs[s.key] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });

    // Sort by excess descending
    const sorted = STATIONS.map(s => ({
        key: s.key,
        excess: Math.max((avgs[s.key] || 0) - s.target, 0),
        color: STATION_COLORS[s.key],
    })).sort((a, b) => b.excess - a.excess);

    // Waterfall: invisible base + excess stacked
    const labels = sorted.map(s => s.key);
    const bases = [];
    const excesses = [];
    let cumulative = 0;

    sorted.forEach(s => {
        bases.push(cumulative);
        excesses.push(s.excess);
        cumulative += s.excess;
    });

    // Add total bar
    labels.push('Total');
    bases.push(0);
    excesses.push(cumulative);

    // Update total label
    const totalLabel = document.getElementById('waterfall-total');
    if (totalLabel) totalLabel.textContent = 'Total excess: +' + cumulative.toFixed(1) + 's';

    const ctx = document.getElementById('waterfall-chart');
    if (!ctx) return;

    if (waterfallChart) waterfallChart.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
    const tickColor = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)';

    const barColors = sorted.map(s => s.color);
    barColors.push(isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)');

    waterfallChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Base',
                    data: bases,
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7,
                },
                {
                    label: 'Excess',
                    data: excesses,
                    backgroundColor: barColors,
                    borderRadius: 4,
                    borderSkipped: false,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7,
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
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: "'SF Mono','JetBrains Mono',monospace", size: 11 },
                    filter: function(item) {
                        return item.datasetIndex === 1;
                    },
                    callbacks: {
                        label: function(ctx) {
                            const idx = ctx.dataIndex;
                            if (idx === labels.length - 1) {
                                return 'Total excess: +' + ctx.parsed.y.toFixed(1) + 's';
                            }
                            return ctx.label + ' excess: +' + ctx.parsed.y.toFixed(1) + 's';
                        }
                    }
                },
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: {
                        color: tickColor,
                        font: { family: 'Inter', weight: '600', size: 11 },
                    },
                },
                y: {
                    stacked: true,
                    grid: { color: gridColor },
                    ticks: {
                        color: tickColor,
                        font: { family: "'SF Mono','JetBrains Mono',monospace", size: 10 },
                        callback: function(v) { return '+' + v + 's'; }
                    },
                    beginAtZero: true,
                },
            },
        },
    });
}

// ============================================
//  Collapsible Sections
// ============================================

function toggleCollapsible(header) {
    const isExpanded = header.classList.contains('expanded');
    header.classList.toggle('expanded', !isExpanded);

    const body = header.nextElementSibling;
    if (body && body.classList.contains('collapsible-body')) {
        body.classList.toggle('expanded', !isExpanded);
    }
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

    // Re-render charts with new theme colors
    if (selectedStation) renderTrend(selectedStation);
    renderWaterfall();
}

// ============================================
//  Helpers
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

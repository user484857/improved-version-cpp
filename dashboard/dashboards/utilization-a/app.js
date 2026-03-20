/* ============================================
   Utilization A — Machine Run Times
   Dashboard logic & rendering
   ============================================ */

// ---- Station metadata ----
const STATION_COLORS = {
    SAW:     '#007AFF',
    Oven:    '#FF9F0A',
    Sorting: '#30D158',
    Crane:   '#30D158',
    HBW:     '#AF52DE',
    MS:      '#007AFF',
    PM:      '#FF453A',
};

const GRADE_COLORS = {
    A: '#FFD60A',
    B: '#FF9F0A',
    C: 'rgba(255,255,255,0.30)',
};

const GRADE_COLORS_LIGHT = {
    A: '#FFD60A',
    B: '#FF9500',
    C: 'rgba(0,0,0,0.25)',
};

// ---- Chart instances ----
let scatterChart = null;
let histogramChart = null;

// ---- Previous data for trend comparison ----
let prevThroughput = null;
let prevCycleTimes = null;

// ---- Theme ----
function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function getChartColors() {
    const dark = isDark();
    return {
        grid: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
        tick: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)',
        gradeColors: dark ? GRADE_COLORS : GRADE_COLORS_LIGHT,
    };
}

function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    // Rebuild charts with new theme colors
    if (lastQualityData) renderQualityScatter(lastQualityData);
    if (lastQualityData) renderQualityHistogram(lastQualityData);
}

function toggleCollapsible(header) {
    header.classList.toggle('expanded');
    header.nextElementSibling.classList.toggle('expanded');
}

// ---- Data cache for theme toggling ----
let lastQualityData = null;

// ---- Init ----
function init() {
    loadData();
    setInterval(loadData, 8000);
}

// ---- Data loading ----
async function loadData() {
    try {
        const [utilRes, throughputRes, qualityRes, cycleRes] = await Promise.all([
            fetch('/api/analytics/utilization').then(r => r.json()),
            fetch('/api/analytics/throughput').then(r => r.json()),
            fetch('/api/analytics/quality-grades').then(r => r.json()),
            fetch('/api/analytics/cycle-times').then(r => r.json()),
        ]);

        renderHero(utilRes);
        renderUtilizationBars(utilRes);
        renderKPIs(throughputRes, cycleRes, utilRes);
        renderQualityScatter(qualityRes);
        renderQualityHistogram(qualityRes);
        renderMachineDetail(utilRes);
        updateTimestamp();

        lastQualityData = qualityRes;
        prevThroughput = throughputRes;
        prevCycleTimes = cycleRes;

    } catch (err) {
        console.error('Data load error:', err);
    }
}

// ---- Timestamp ----
function updateTimestamp() {
    const el = document.getElementById('lastUpdated');
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    el.classList.remove('stale');
}

// ---- Hero Banner ----
function renderHero(data) {
    const machines = Object.keys(data).filter(k => k !== '_categories');
    if (machines.length === 0) return;

    const avgUtil = machines.reduce((sum, m) => sum + (data[m].utilization || 0), 0) / machines.length;
    const pct = (avgUtil * 100).toFixed(1);

    const heroNum = document.getElementById('heroNumber');
    heroNum.textContent = pct;

    // Color class
    heroNum.classList.remove('high', 'medium', 'low');
    if (avgUtil >= 0.5) heroNum.classList.add('high');
    else if (avgUtil >= 0.25) heroNum.classList.add('medium');
    else heroNum.classList.add('low');

    // Meta line
    const activeMachines = machines.filter(m => data[m].utilization > 0).length;
    document.getElementById('heroMeta').textContent =
        `${activeMachines} of ${machines.length} machines active`;

    // Status badge
    const statusEl = document.getElementById('heroStatus');
    let dotClass, label;
    if (avgUtil >= 0.5) { dotClass = 'green'; label = 'Healthy'; }
    else if (avgUtil >= 0.2) { dotClass = 'yellow'; label = 'Moderate'; }
    else if (avgUtil > 0) { dotClass = 'red'; label = 'Low'; }
    else { dotClass = 'grey'; label = 'Offline'; }

    statusEl.innerHTML = `
        <span class="status-dot ${dotClass}"></span>
        <span class="hero-status-label">${label}</span>
    `;
}

// ---- Utilization Bars ----
function renderUtilizationBars(data) {
    const container = document.getElementById('utilizationBars');
    const categories = data._categories || {};

    const categoryMeta = [
        { key: 'value_adding', label: 'Value Adding' },
        { key: 'quality',      label: 'Quality' },
        { key: 'transport',    label: 'Transport' },
    ];

    let html = '';

    categoryMeta.forEach(cat => {
        const stations = categories[cat.key] || [];
        if (stations.length === 0) return;

        html += `<div class="bar-category">`;
        html += `<div class="bar-category-label">${cat.label}</div>`;

        stations.forEach(station => {
            const info = data[station];
            if (!info) return;
            const pct = (info.utilization * 100).toFixed(1);
            const widthPct = Math.max(info.utilization * 100, 0.5);

            html += `
                <div class="bar-row">
                    <div class="bar-station-name">
                        <span class="bar-station-dot" data-station="${station}"></span>
                        ${station}
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill" data-station="${station}" data-target="${widthPct}" style="width: 0%">
                            <span class="bar-fill-label">${formatTime(info.run_time_s)} run</span>
                        </div>
                    </div>
                    <div class="bar-pct">${pct}%</div>
                </div>
            `;
        });

        html += `</div>`;
    });

    container.innerHTML = html;

    // Animate bars after render
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            container.querySelectorAll('.bar-fill').forEach(bar => {
                const target = bar.getAttribute('data-target');
                bar.style.width = target + '%';
                // Show inner label only for bars wide enough
                if (parseFloat(target) > 20) {
                    setTimeout(() => {
                        const label = bar.querySelector('.bar-fill-label');
                        if (label) label.classList.add('visible');
                    }, 600);
                }
            });
        });
    });
}

function formatTime(seconds) {
    if (seconds == null || isNaN(seconds)) return '--';
    if (seconds < 60) return seconds.toFixed(0) + 's';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m + 'm ' + (s > 0 ? s + 's' : '');
}

// ---- KPI Tiles ----
function renderKPIs(throughput, cycleTimes, utilData) {
    // Parts per hour
    const pph = throughput.per_hour != null ? throughput.per_hour.toFixed(1) : '--';
    document.getElementById('kpiPartsHour').textContent = pph;

    // Total parts
    document.getElementById('kpiTotalParts').textContent =
        throughput.total_runs != null ? throughput.total_runs : '--';

    // Avg cycle time
    let avgCycle = '--';
    if (Array.isArray(cycleTimes) && cycleTimes.length > 0) {
        const totals = cycleTimes.map(r => r.total).filter(t => t != null);
        if (totals.length > 0) {
            avgCycle = (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1) + 's';
        }
    }
    document.getElementById('kpiAvgCycle').textContent = avgCycle;

    // Throughput utilization
    const tUtil = throughput.utilization != null
        ? (throughput.utilization * 100).toFixed(1) + '%'
        : '--';
    document.getElementById('kpiUtilization').textContent = tUtil;

    // Trends
    renderTrend('kpiPartsHourTrend', prevThroughput?.per_hour, throughput.per_hour, true);
    if (Array.isArray(cycleTimes) && cycleTimes.length > 0 && prevCycleTimes?.length > 0) {
        const currAvg = cycleTimes.map(r => r.total).filter(Boolean).reduce((a, b) => a + b, 0) / cycleTimes.length;
        const prevAvg = prevCycleTimes.map(r => r.total).filter(Boolean).reduce((a, b) => a + b, 0) / prevCycleTimes.length;
        // Lower cycle time is better, so invert
        renderTrend('kpiAvgCycleTrend', prevAvg, currAvg, false);
    }
}

function renderTrend(elId, prev, curr, higherIsBetter) {
    const el = document.getElementById(elId);
    if (!el || prev == null || curr == null) return;
    const diff = curr - prev;
    if (Math.abs(diff) < 0.01) {
        el.className = 'kpi-trend neutral';
        el.textContent = '--';
        return;
    }
    const isUp = diff > 0;
    const isGood = higherIsBetter ? isUp : !isUp;
    el.className = 'kpi-trend ' + (isGood ? 'up' : 'down');
    el.innerHTML = (isUp ? '&#9650;' : '&#9660;') + ' ' + Math.abs(diff).toFixed(1);
}

// ---- Quality Scatter ----
function renderQualityScatter(qualityData) {
    const ctx = document.getElementById('qualityScatter');
    if (!ctx) return;
    const { grid, tick, gradeColors } = getChartColors();

    const datasets = ['A', 'B', 'C'].map(grade => {
        const pts = qualityData
            .filter(d => d.grade === grade)
            .map(d => ({ x: d.run, y: d.color_value }));
        return {
            label: 'Grade ' + grade,
            data: pts,
            backgroundColor: gradeColors[grade],
            borderColor: 'transparent',
            pointRadius: 6,
            pointHoverRadius: 9,
            pointBorderWidth: 0,
        };
    });

    if (scatterChart) {
        scatterChart.data.datasets = datasets;
        scatterChart.options.scales.x.grid.color = grid;
        scatterChart.options.scales.x.ticks.color = tick;
        scatterChart.options.scales.y.grid.color = grid;
        scatterChart.options.scales.y.ticks.color = tick;
        scatterChart.update('none');
        return;
    }

    scatterChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 600 },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        boxWidth: 8,
                        boxHeight: 8,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 16,
                        font: { family: 'Inter', size: 11, weight: '500' },
                        color: tick,
                    },
                },
                tooltip: {
                    backgroundColor: isDark() ? 'rgba(28,28,30,0.95)' : 'rgba(255,255,255,0.95)',
                    titleColor: isDark() ? '#fff' : '#000',
                    bodyColor: isDark() ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
                    borderColor: isDark() ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    cornerRadius: 10,
                    padding: 12,
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: 'JetBrains Mono', size: 11 },
                    callbacks: {
                        title: (items) => 'Run #' + items[0].parsed.x,
                        label: (item) => 'Sensor: ' + item.parsed.y,
                    },
                },
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Run',
                        font: { family: 'Inter', size: 11, weight: '500' },
                        color: tick,
                    },
                    grid: { color: grid, drawBorder: false },
                    ticks: { color: tick, font: { family: 'JetBrains Mono', size: 10 } },
                    border: { display: false },
                },
                y: {
                    title: {
                        display: true,
                        text: 'Color Sensor Value',
                        font: { family: 'Inter', size: 11, weight: '500' },
                        color: tick,
                    },
                    grid: { color: grid, drawBorder: false },
                    ticks: { color: tick, font: { family: 'JetBrains Mono', size: 10 } },
                    border: { display: false },
                },
            },
        },
        plugins: [gradeRangePlugin()],
    });
}

// Plugin: draw horizontal bands for grade ranges
function gradeRangePlugin() {
    return {
        id: 'gradeRanges',
        beforeDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.y) return;

            const dark = isDark();
            const ranges = [
                { min: 0,   max: 200, color: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', label: 'C' },
                { min: 200, max: 350, color: dark ? 'rgba(255,159,10,0.04)' : 'rgba(255,149,0,0.05)', label: 'B' },
                { min: 350, max: 600, color: dark ? 'rgba(255,214,10,0.04)' : 'rgba(255,214,10,0.06)', label: 'A' },
            ];

            const yScale = scales.y;
            ranges.forEach(range => {
                const top = yScale.getPixelForValue(range.max);
                const bottom = yScale.getPixelForValue(range.min);
                const clampedTop = Math.max(top, chartArea.top);
                const clampedBottom = Math.min(bottom, chartArea.bottom);
                if (clampedTop >= clampedBottom) return;

                ctx.save();
                ctx.fillStyle = range.color;
                ctx.fillRect(chartArea.left, clampedTop, chartArea.right - chartArea.left, clampedBottom - clampedTop);
                ctx.restore();
            });
        },
    };
}

// ---- Quality Histogram ----
function renderQualityHistogram(qualityData) {
    const ctx = document.getElementById('qualityHistogram');
    if (!ctx) return;
    const { grid, tick, gradeColors } = getChartColors();

    const counts = { A: 0, B: 0, C: 0 };
    qualityData.forEach(d => {
        if (counts.hasOwnProperty(d.grade)) counts[d.grade]++;
    });

    const colors = [gradeColors.A, gradeColors.B, gradeColors.C];
    const chartData = {
        labels: ['Grade A', 'Grade B', 'Grade C'],
        datasets: [{
            data: [counts.A, counts.B, counts.C],
            backgroundColor: colors.map(c => {
                // Semi-transparent fill
                if (c.startsWith('rgba')) return c;
                return hexToRgba(c, 0.7);
            }),
            borderColor: colors,
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 56,
        }],
    };

    if (histogramChart) {
        histogramChart.data = chartData;
        histogramChart.options.scales.x.grid.color = grid;
        histogramChart.options.scales.x.ticks.color = tick;
        histogramChart.options.scales.y.grid.color = grid;
        histogramChart.options.scales.y.ticks.color = tick;
        histogramChart.update('none');
        return;
    }

    histogramChart = new Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 600 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark() ? 'rgba(28,28,30,0.95)' : 'rgba(255,255,255,0.95)',
                    titleColor: isDark() ? '#fff' : '#000',
                    bodyColor: isDark() ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
                    borderColor: isDark() ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    cornerRadius: 10,
                    padding: 12,
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: 'JetBrains Mono', size: 11 },
                    callbacks: {
                        label: (item) => item.parsed.y + ' parts',
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: tick,
                        font: { family: 'Inter', size: 11, weight: '600' },
                    },
                    border: { display: false },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: grid, drawBorder: false },
                    ticks: {
                        color: tick,
                        font: { family: 'JetBrains Mono', size: 10 },
                        stepSize: 1,
                        precision: 0,
                    },
                    border: { display: false },
                },
            },
        },
    });
}

// ---- Machine Detail Table ----
function renderMachineDetail(data) {
    const tbody = document.getElementById('machineDetailBody');
    if (!tbody) return;

    const categories = data._categories || {};
    const categoryMap = {};
    Object.entries(categories).forEach(([cat, stations]) => {
        stations.forEach(s => { categoryMap[s] = cat; });
    });

    const machines = Object.keys(data).filter(k => k !== '_categories');
    if (machines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary)">No data</td></tr>';
        return;
    }

    // Sort by utilization descending
    machines.sort((a, b) => (data[b].utilization || 0) - (data[a].utilization || 0));

    const categoryLabels = {
        value_adding: 'Value Adding',
        quality: 'Quality',
        transport: 'Transport',
    };

    tbody.innerHTML = machines.map(station => {
        const info = data[station];
        const pct = ((info.utilization || 0) * 100).toFixed(1);
        const color = STATION_COLORS[station] || '#666';
        const cat = categoryMap[station] || 'unknown';
        const catLabel = categoryLabels[cat] || cat;

        let statusDot, statusLabel;
        if (info.utilization >= 0.5)  { statusDot = 'green'; statusLabel = 'High'; }
        else if (info.utilization >= 0.2) { statusDot = 'yellow'; statusLabel = 'Medium'; }
        else if (info.utilization > 0) { statusDot = 'red'; statusLabel = 'Low'; }
        else { statusDot = 'grey'; statusLabel = 'Idle'; }

        return `
            <tr>
                <td style="color:var(--text-primary);font-weight:600;font-family:Inter,sans-serif">
                    <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};margin-right:8px;vertical-align:middle;box-shadow:0 0 5px ${color}55"></span>
                    ${station}
                </td>
                <td style="font-family:Inter,sans-serif">${catLabel}</td>
                <td>
                    <span class="util-bar-mini">
                        <span class="util-bar-mini-fill" style="width:${pct}%;background:${color}"></span>
                    </span>
                    ${pct}%
                </td>
                <td>${formatTime(info.run_time_s)}</td>
                <td>${formatTime(info.idle_time_s)}</td>
                <td>
                    <span class="status-dot ${statusDot}"></span>
                    <span style="margin-left:6px;font-family:Inter,sans-serif">${statusLabel}</span>
                </td>
            </tr>
        `;
    }).join('');
}

// ---- Helpers ----
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', init);

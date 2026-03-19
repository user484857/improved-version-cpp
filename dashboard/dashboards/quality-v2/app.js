/**
 * Quality Dashboard v2 — Interactive Drill-Down
 *
 * Design: Start minimal, click to explore deeper. Progressive disclosure.
 *
 * KNOWN DATA (real sensors):
 *   - Color grade (A/B/C) from iColorSensor_SL
 *   - Burn time from bLamp_MS on/off events
 *   - Run count from HBW start marker
 *   - Cycle times per station from actuator events
 *
 * NOT AVAILABLE (no sensor):
 *   - Temperature (would require Newton's law estimation)
 *   - Capacity / throughput limits
 *   - Failure causes (Grade C is a valid sort outcome)
 *
 * Grade mapping:
 *   A (gold)   = White sensor 250-300
 *   B (orange) = Red sensor 130-190
 *   C (grey)   = Blue sensor 40-60
 */

const GRADE_COLORS = { A: '#FFD60A', B: '#FF9F0A', C: '#8E8E93' };
const GRADE_LABELS = {
    A: 'Grade A — Premium',
    B: 'Grade B — Standard',
    C: 'Grade C — Economy',
};

// ============================================
//  Theme
// ============================================

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateAllChartThemes();
}

function isDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
}

function themeColors() {
    const dark = isDark();
    return {
        tick:        dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)',
        grid:        dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
        tooltipBg:   dark ? 'rgba(20,20,30,0.92)'    : 'rgba(255,255,255,0.95)',
        tooltipBdr:  dark ? 'rgba(255,255,255,0.1)'   : 'rgba(0,0,0,0.08)',
        tooltipText: dark ? '#fff'                    : '#000',
        refLine:     dark ? 'rgba(255,255,255,0.18)'  : 'rgba(0,0,0,0.15)',
    };
}

// ============================================
//  Chart Helpers
// ============================================

function baseTooltip() {
    const tc = themeColors();
    return {
        backgroundColor: tc.tooltipBg,
        titleFont: { family: 'Inter', weight: '600', size: 12 },
        bodyFont: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 11 },
        titleColor: tc.tooltipText,
        bodyColor: tc.tooltipText,
        padding: 10,
        cornerRadius: 8,
        borderColor: tc.tooltipBdr,
        borderWidth: 1,
    };
}

function baseScale(axis) {
    const tc = themeColors();
    return {
        ticks: {
            color: tc.tick,
            font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 10 },
        },
        grid: {
            color: axis === 'x' ? 'transparent' : tc.grid,
            drawBorder: false,
        },
    };
}

// ============================================
//  Chart Instances
// ============================================

let chartDonut = null;
let chartHistogram = null;
let chartTiming = null;

// ============================================
//  Data
// ============================================

let _gradesData = null;
let _cycleData = null;

async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// ============================================
//  Init
// ============================================

async function init() {
    const [grades, cycles] = await Promise.all([
        fetchJSON('/api/analytics/quality-grades'),
        fetchJSON('/api/analytics/cycle-times'),
    ]);

    if (!grades || grades.length === 0) {
        showEmpty();
        return;
    }

    _gradesData = grades;
    _cycleData = cycles;

    renderKPIs(grades);
    renderDonut(grades);
    renderHistogram(grades);
    renderTable(grades);
    renderTimingChart(grades);
    renderTimingStats(grades);
    updateTimestamp();
}

function showEmpty() {
    document.querySelector('.app').insertAdjacentHTML('beforeend',
        '<div class="empty-state">' +
        '<svg width="48" height="48" viewBox="0 0 20 20" fill="currentColor">' +
        '<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/>' +
        '</svg>' +
        '<span>No quality data available. Start a production run to generate grading data.</span>' +
        '</div>'
    );
}

function updateTimestamp() {
    const el = document.getElementById('last-updated');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

// ============================================
//  KPI Pills
// ============================================

function renderKPIs(grades) {
    const total = grades.length;
    const gradeA = grades.filter(g => g.grade === 'A').length;
    const fpy = total > 0 ? ((gradeA / total) * 100).toFixed(1) : '0.0';

    const burnTimes = grades.map(g => g.burn_time).filter(t => t != null);
    const avgBurn = burnTimes.length > 0
        ? (burnTimes.reduce((s, t) => s + t, 0) / burnTimes.length).toFixed(2)
        : '--';

    document.getElementById('kpi-yield').textContent = fpy + '%';
    document.getElementById('kpi-runs').textContent = total;
    document.getElementById('kpi-chamber').textContent = avgBurn + ' s';
    document.getElementById('kpi-grade-a').textContent = gradeA;

    // Badge for run details section
    document.getElementById('run-count-badge').textContent = total + ' runs';
}

// ============================================
//  Donut Chart
// ============================================

function renderDonut(grades) {
    const counts = { A: 0, B: 0, C: 0 };
    grades.forEach(g => { if (counts[g.grade] !== undefined) counts[g.grade]++; });
    const total = grades.length;
    const fpy = total > 0 ? ((counts.A / total) * 100).toFixed(1) : '0.0';

    document.getElementById('donut-pct').textContent = fpy + '%';

    // Legend
    const legendEl = document.getElementById('donut-legend');
    legendEl.innerHTML = '';
    for (const [grade, label] of Object.entries(GRADE_LABELS)) {
        const pct = total > 0 ? ((counts[grade] / total) * 100).toFixed(0) : '0';
        const row = document.createElement('div');
        row.className = 'legend-row';
        row.innerHTML =
            '<span class="legend-swatch" style="background:' + GRADE_COLORS[grade] + '"></span>' +
            '<span class="legend-label">' + label + '</span>' +
            '<span class="legend-pct">' + pct + '%</span>' +
            '<span class="legend-count">' + counts[grade] + '</span>';
        legendEl.appendChild(row);
    }

    const ctx = document.getElementById('chart-donut').getContext('2d');
    chartDonut = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.values(GRADE_LABELS),
            datasets: [{
                data: [counts.A, counts.B, counts.C],
                backgroundColor: [GRADE_COLORS.A, GRADE_COLORS.B, GRADE_COLORS.C],
                borderWidth: 0,
                hoverOffset: 6,
                spacing: 2,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...baseTooltip(),
                    callbacks: {
                        label(ctx) {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
                            return ctx.label + ': ' + ctx.parsed + ' (' + pct + '%)';
                        },
                    },
                },
            },
            animation: {
                animateRotate: true,
                duration: 800,
            },
        },
    });
}

// ============================================
//  Histogram
// ============================================

function renderHistogram(grades) {
    const bins = [
        { label: '0-50',    min: 0,   max: 50,  grade: 'C' },
        { label: '50-100',  min: 50,  max: 100, grade: null },
        { label: '100-150', min: 100, max: 150, grade: 'B' },
        { label: '150-200', min: 150, max: 200, grade: 'B' },
        { label: '200-250', min: 200, max: 250, grade: null },
        { label: '250-300', min: 250, max: 300, grade: 'A' },
    ];

    const counts = bins.map(() => 0);
    grades.forEach(g => {
        const v = g.color_value;
        for (let i = 0; i < bins.length; i++) {
            if (v >= bins[i].min && v < bins[i].max) { counts[i]++; break; }
            if (i === bins.length - 1 && v >= bins[i].min && v <= bins[i].max) { counts[i]++; }
        }
    });

    // Bar colors based on grade range
    const barColors = bins.map(b => {
        const mid = (b.min + b.max) / 2;
        if (mid <= 60)  return GRADE_COLORS.C;
        if (mid <= 190) return GRADE_COLORS.B;
        return GRADE_COLORS.A;
    });

    const tc = themeColors();

    // Grade boundary lines plugin
    const boundaryPlugin = {
        id: 'gradeBoundariesV2',
        afterDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            const xScale = scales.x;
            if (!xScale || !chartArea) return;

            const boundaries = [
                { index: 2, label: 'C | B' },
                { index: 4.35, label: 'B | A' },
            ];

            c.save();
            c.setLineDash([5, 4]);
            c.lineWidth = 1;
            c.strokeStyle = themeColors().refLine;
            c.font = "10px 'SF Mono', monospace";
            c.fillStyle = themeColors().tick;
            c.textAlign = 'center';

            for (const bd of boundaries) {
                const x = xScale.getPixelForValue(bd.index);
                c.beginPath();
                c.moveTo(x, chartArea.top);
                c.lineTo(x, chartArea.bottom);
                c.stroke();
                c.fillText(bd.label, x, chartArea.top - 6);
            }
            c.restore();
        },
    };

    const ctx = document.getElementById('chart-histogram').getContext('2d');
    chartHistogram = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: bins.map(b => b.label),
            datasets: [{
                label: 'Count',
                data: counts,
                backgroundColor: barColors.map(c => c + 'BB'),
                borderColor: barColors,
                borderWidth: 1,
                borderRadius: 6,
                maxBarThickness: 56,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...baseTooltip(),
                    callbacks: {
                        title(items) {
                            return 'Sensor Range: ' + items[0].label;
                        },
                        label(ctx) {
                            return ctx.parsed.y + ' workpieces';
                        },
                    },
                },
            },
            scales: {
                x: {
                    ...baseScale('x'),
                    title: {
                        display: true,
                        text: 'Color Sensor Value',
                        color: tc.tick,
                        font: { family: 'Inter', size: 11, weight: '500' },
                    },
                },
                y: {
                    ...baseScale('y'),
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Count',
                        color: tc.tick,
                        font: { family: 'Inter', size: 11, weight: '500' },
                    },
                },
            },
            animation: {
                duration: 600,
            },
        },
        plugins: [boundaryPlugin],
    });
}

// ============================================
//  Expandable Sections
// ============================================

function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;

    const wasOpen = section.classList.contains('open');
    section.classList.toggle('open');

    // Lazy-render timing chart on first open
    if (sectionId === 'section-timing' && !wasOpen && chartTiming === null && _gradesData) {
        // Small delay to let the section expand before rendering
        setTimeout(function() {
            renderTimingChart(_gradesData);
        }, 100);
    }
}

// ============================================
//  Run Details Table
// ============================================

let _tableExpanded = false;
const TABLE_PREVIEW_ROWS = 5;

function renderTable(grades) {
    const sorted = [...grades].sort((a, b) => b.run - a.run);
    const tbody = document.getElementById('trace-tbody');
    const showMoreBtn = document.getElementById('table-show-more');

    const display = _tableExpanded ? sorted : sorted.slice(0, TABLE_PREVIEW_ROWS);

    tbody.innerHTML = display.map(g => {
        const ts = g.timestamp ? new Date(g.timestamp).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }) : '--';
        return '<tr>' +
            '<td>#' + g.run + '</td>' +
            '<td>' + (g.burn_time != null ? g.burn_time.toFixed(2) + ' s' : '--') + '</td>' +
            '<td>' + (g.color_value != null ? g.color_value : '--') + '</td>' +
            '<td><span class="grade-badge grade-badge-' + g.grade + '">Grade ' + g.grade + '</span></td>' +
            '<td>' + ts + '</td>' +
            '</tr>';
    }).join('');

    // Show more button
    if (!_tableExpanded && sorted.length > TABLE_PREVIEW_ROWS) {
        showMoreBtn.textContent = 'Show all ' + sorted.length + ' records';
        showMoreBtn.style.display = 'block';
        showMoreBtn.onclick = function() {
            _tableExpanded = true;
            renderTable(grades);
        };
    } else {
        showMoreBtn.style.display = 'none';
    }
}

// ============================================
//  Timing Analysis (Grouped Bar Chart)
// ============================================

function renderTimingChart(grades) {
    if (!grades || grades.length === 0) return;

    // Group burn times by grade
    const byGrade = { A: [], B: [], C: [] };
    grades.forEach(g => {
        if (g.burn_time != null && byGrade[g.grade]) {
            byGrade[g.grade].push({ run: g.run, burn_time: g.burn_time });
        }
    });

    // Find max runs across all grades for x-axis labels
    const maxRuns = Math.max(
        byGrade.A.length,
        byGrade.B.length,
        byGrade.C.length
    );

    if (maxRuns === 0) return;

    // Build labels: "Run 1", "Run 2", etc. per-grade
    // Use grouped bar approach: one dataset per grade, each bar is an individual run
    // Approach: x-axis = run number, bars grouped by grade
    const allRuns = grades
        .filter(g => g.burn_time != null)
        .sort((a, b) => a.run - b.run);

    const runLabels = allRuns.map(g => 'Run ' + g.run);

    // For each grade, create data aligned with all runs
    const datasets = ['A', 'B', 'C'].map(grade => ({
        label: 'Grade ' + grade,
        data: allRuns.map(g => g.grade === grade ? g.burn_time : null),
        backgroundColor: GRADE_COLORS[grade] + 'CC',
        borderColor: GRADE_COLORS[grade],
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 32,
        skipNull: true,
    }));

    const tc = themeColors();
    const ctx = document.getElementById('chart-timing').getContext('2d');

    if (chartTiming) chartTiming.destroy();

    chartTiming = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: runLabels,
            datasets: datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: tc.tick,
                        font: { family: 'Inter', size: 10 },
                        boxWidth: 10,
                        boxHeight: 10,
                        padding: 14,
                        usePointStyle: true,
                    },
                },
                tooltip: {
                    ...baseTooltip(),
                    callbacks: {
                        label(ctx) {
                            if (ctx.parsed.y == null) return null;
                            return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) + ' s';
                        },
                    },
                    filter(item) {
                        return item.parsed.y != null;
                    },
                },
            },
            scales: {
                x: {
                    ...baseScale('x'),
                    title: {
                        display: true,
                        text: 'Production Run',
                        color: tc.tick,
                        font: { family: 'Inter', size: 11, weight: '500' },
                    },
                },
                y: {
                    ...baseScale('y'),
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Burn Time (s)',
                        color: tc.tick,
                        font: { family: 'Inter', size: 11, weight: '500' },
                    },
                },
            },
            animation: {
                duration: 600,
            },
        },
    });

    // Update timing badge
    const avgBurn = allRuns.reduce((s, g) => s + g.burn_time, 0) / allRuns.length;
    document.getElementById('timing-badge').textContent = avgBurn.toFixed(2) + ' s avg';
}

function renderTimingStats(grades) {
    const el = document.getElementById('timing-stats');
    if (!el) return;

    const byGrade = { A: [], B: [], C: [] };
    grades.forEach(g => {
        if (g.burn_time != null && byGrade[g.grade]) {
            byGrade[g.grade].push(g.burn_time);
        }
    });

    const stats = [];
    for (const [grade, times] of Object.entries(byGrade)) {
        if (times.length === 0) continue;
        const avg = times.reduce((s, t) => s + t, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);
        stats.push({ grade, avg, min, max, count: times.length });
    }

    el.innerHTML = stats.map(s =>
        '<div class="timing-stat">' +
        '<span class="timing-stat-value" style="color:' + GRADE_COLORS[s.grade] + '">' + s.avg.toFixed(2) + ' s</span>' +
        '<span class="timing-stat-label">Grade ' + s.grade + ' avg (' + s.count + ' runs)</span>' +
        '</div>'
    ).join('') +
    '<div class="timing-stat">' +
    '<span class="timing-stat-value">' +
        (stats.length > 0 ? (Math.max(...stats.map(s => s.max)) - Math.min(...stats.map(s => s.min))).toFixed(2) + ' s' : '--') +
    '</span>' +
    '<span class="timing-stat-label">Range (max - min)</span>' +
    '</div>';
}

// ============================================
//  Theme Update for All Charts
// ============================================

function updateAllChartThemes() {
    const tc = themeColors();
    const charts = [chartDonut, chartHistogram, chartTiming];

    for (const ch of charts) {
        if (!ch) continue;

        // Tooltip
        if (ch.options.plugins && ch.options.plugins.tooltip) {
            ch.options.plugins.tooltip.backgroundColor = tc.tooltipBg;
            ch.options.plugins.tooltip.borderColor = tc.tooltipBdr;
            ch.options.plugins.tooltip.titleColor = tc.tooltipText;
            ch.options.plugins.tooltip.bodyColor = tc.tooltipText;
        }

        // Scales
        for (const axisKey of ['x', 'y']) {
            const scale = ch.options.scales && ch.options.scales[axisKey];
            if (!scale) continue;
            if (scale.ticks) scale.ticks.color = tc.tick;
            if (scale.grid) scale.grid.color = axisKey === 'x' ? 'transparent' : tc.grid;
            if (scale.title) scale.title.color = tc.tick;
        }

        // Legend
        if (ch.options.plugins && ch.options.plugins.legend && ch.options.plugins.legend.labels) {
            ch.options.plugins.legend.labels.color = tc.tick;
        }

        ch.update('none');
    }
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

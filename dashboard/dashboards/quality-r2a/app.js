/**
 * Quality Analysis R2A — Color Sensor Grading
 *
 * Round 2 Version A: Feedback-driven redesign
 *
 * KEY CHANGES FROM R1:
 *   - NO donut/pie chart (always ~33% per color, meaningless)
 *   - NO yellow color scheme (user disliked it)
 *   - Color sensor value is the PRIMARY metric (Y-axis)
 *   - Grade colors = actual workpiece colors:
 *       A = white/light (#f0f0f0)  — sensor 250-300
 *       B = red (#FF453A)          — sensor 130-190
 *       C = blue (#007AFF)         — sensor 40-60
 *   - Horizontal bands show grade thresholds
 *   - Trend line for drift detection
 *   - Stacked horizontal bar instead of donut
 *   - Quartiles instead of min/max
 *   - Filter by grade
 *   - Collapsible sections for Run Details + Data Transparency
 *
 * KNOWN DATA (real sensors):
 *   - Color grade (A/B/C) from iColorSensor_SL
 *   - Burn time from bLamp_MS on/off events
 *   - Run count from HBW start marker
 *
 * NOT AVAILABLE:
 *   - Temperature (no sensor — Newton's law estimation only)
 *   - Failure causes (Grade C is valid, not a defect)
 */

// Grade colors matching actual workpiece colors
const GRADE_COLORS = {
    A: '#f0f0f0',   // white workpiece
    B: '#FF453A',   // red workpiece
    C: '#007AFF',   // blue workpiece
};

const GRADE_COLORS_LIGHT = {
    A: '#999999',
    B: '#FF3B30',
    C: '#007AFF',
};

const TREND_COLOR = '#AF52DE';

// ============================================
//  State
// ============================================

let _gradesData = null;
let _activeGradeFilter = 'all';
let _showTrendLine = true;
let chartScatter = null;
let _tableExpanded = false;
const TABLE_PREVIEW_ROWS = 8;

// ============================================
//  Theme
// ============================================

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    if (_gradesData) {
        renderScatterChart(_gradesData);
    }
}

function isDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
}

function gradeColors() {
    return isDark() ? GRADE_COLORS : GRADE_COLORS_LIGHT;
}

function themeColors() {
    const dark = isDark();
    return {
        tick:        dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)',
        grid:        dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
        tooltipBg:   dark ? 'rgba(20,20,30,0.92)'    : 'rgba(255,255,255,0.95)',
        tooltipBdr:  dark ? 'rgba(255,255,255,0.1)'   : 'rgba(0,0,0,0.08)',
        tooltipText: dark ? '#fff'                    : '#000',
        bandAlpha:   dark ? '0.06'                    : '0.05',
    };
}

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

// ============================================
//  Data
// ============================================

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
    const [grades, drift] = await Promise.all([
        fetchJSON('/api/analytics/quality-grades'),
        fetchJSON('/api/analytics/drift'),
    ]);

    if (!grades || grades.length === 0) {
        showEmpty();
        return;
    }

    _gradesData = grades;

    renderKPIs(grades);
    renderScatterChart(grades);
    renderDistribution(grades);
    renderQuartiles(grades);
    renderTable(grades);
    renderDrift(drift);
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
    const counts = { A: 0, B: 0, C: 0 };
    grades.forEach(g => { if (counts[g.grade] !== undefined) counts[g.grade]++; });
    const total = grades.length;

    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-grade-a').textContent = counts.A;
    document.getElementById('kpi-grade-b').textContent = counts.B;
    document.getElementById('kpi-grade-c').textContent = counts.C;

    // Run details badge
    document.getElementById('run-count-badge').textContent = total + ' runs';
}

// ============================================
//  Filter
// ============================================

function setGradeFilter(grade) {
    _activeGradeFilter = grade;

    // Update pill states
    document.querySelectorAll('#grade-filter .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.grade === grade);
    });

    if (_gradesData) {
        renderScatterChart(_gradesData);
    }
}

function toggleTrendLine(show) {
    _showTrendLine = show;

    document.querySelectorAll('#trend-toggle .filter-pill').forEach(btn => {
        const isOn = btn.dataset.trend === 'on';
        btn.classList.toggle('active', show ? isOn : !isOn);
    });

    if (_gradesData) {
        renderScatterChart(_gradesData);
    }
}

// ============================================
//  Main Scatter Chart
// ============================================

function renderScatterChart(grades) {
    const tc = themeColors();
    const gc = gradeColors();

    // Filter data
    const filtered = _activeGradeFilter === 'all'
        ? grades
        : grades.filter(g => g.grade === _activeGradeFilter);

    // Build scatter points
    const scatterData = filtered
        .filter(g => g.color_value != null)
        .map(g => ({
            x: g.run,
            y: g.color_value,
            grade: g.grade,
        }));

    // Point colors
    const pointColors = scatterData.map(d => gc[d.grade] || gc.C);
    const pointBorderColors = scatterData.map(d => {
        if (d.grade === 'A') {
            return isDark() ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)';
        }
        return gc[d.grade] || gc.C;
    });

    // Datasets
    const datasets = [{
        label: 'Color Sensor Value',
        data: scatterData,
        backgroundColor: pointColors,
        borderColor: pointBorderColors,
        borderWidth: scatterData.map(d => d.grade === 'A' ? 1.5 : 1),
        pointRadius: 7,
        pointHoverRadius: 10,
        showLine: false,
    }];

    // Trend line (linear regression on all data, not filtered)
    if (_showTrendLine && grades.length >= 2) {
        const allPoints = grades
            .filter(g => g.color_value != null)
            .map(g => ({ x: g.run, y: g.color_value }));

        if (allPoints.length >= 2) {
            const regression = linearRegression(allPoints);
            const xMin = allPoints[0].x;
            const xMax = allPoints[allPoints.length - 1].x;

            datasets.push({
                label: 'Trend',
                data: [
                    { x: xMin, y: regression.slope * xMin + regression.intercept },
                    { x: xMax, y: regression.slope * xMax + regression.intercept },
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
    const bandPlugin = {
        id: 'gradeBands',
        beforeDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.y) return;

            const yScale = scales.y;

            const bands = [
                { min: 250, max: 300, color: gc.A, label: 'A (250-300)', alpha: tc.bandAlpha },
                { min: 130, max: 190, color: gc.B, label: 'B (130-190)', alpha: tc.bandAlpha },
                { min: 40,  max: 60,  color: gc.C, label: 'C (40-60)',   alpha: tc.bandAlpha },
            ];

            ctx.save();
            for (const band of bands) {
                const yTop = yScale.getPixelForValue(band.max);
                const yBot = yScale.getPixelForValue(band.min);
                const h = yBot - yTop;

                ctx.fillStyle = band.color === '#f0f0f0'
                    ? (isDark() ? 'rgba(255,255,255,' + band.alpha + ')' : 'rgba(0,0,0,' + band.alpha + ')')
                    : hexToRgba(band.color, parseFloat(band.alpha));
                ctx.fillRect(chartArea.left, yTop, chartArea.width, h);

                // Band label on left
                ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)';
                ctx.font = "600 10px 'SF Mono', monospace";
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(band.label, chartArea.left + 6, yTop + h / 2);
            }
            ctx.restore();
        },
    };

    // Determine axis range
    const maxRun = grades.length > 0 ? Math.max(...grades.map(g => g.run)) : 20;

    const ctx = document.getElementById('chart-scatter').getContext('2d');

    if (chartScatter) chartScatter.destroy();

    chartScatter = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...baseTooltip(),
                    callbacks: {
                        title(items) {
                            if (!items.length) return '';
                            const d = items[0].raw;
                            return 'Run #' + d.x;
                        },
                        label(ctx) {
                            const d = ctx.raw;
                            if (d.grade) {
                                const colorName = { A: 'White', B: 'Red', C: 'Blue' }[d.grade] || '';
                                return 'Color Value: ' + d.y + '  |  Grade ' + d.grade + ' (' + colorName + ')';
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
                        callback(val) { return Number.isInteger(val) ? val : ''; },
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
                    grid: {
                        color: tc.grid,
                        drawBorder: false,
                    },
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
//  Linear Regression
// ============================================

function linearRegression(points) {
    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (const p of points) {
        sumX += p.x;
        sumY += p.y;
        sumXY += p.x * p.y;
        sumXX += p.x * p.x;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
}

// ============================================
//  Grade Distribution Bar
// ============================================

function renderDistribution(grades) {
    const counts = { A: 0, B: 0, C: 0 };
    grades.forEach(g => { if (counts[g.grade] !== undefined) counts[g.grade]++; });
    const total = grades.length || 1;

    const pctA = (counts.A / total) * 100;
    const pctB = (counts.B / total) * 100;
    const pctC = (counts.C / total) * 100;

    document.getElementById('dist-seg-a').style.width = pctA + '%';
    document.getElementById('dist-seg-b').style.width = pctB + '%';
    document.getElementById('dist-seg-c').style.width = pctC + '%';

    document.getElementById('dist-summary').textContent =
        counts.A + 'A / ' + counts.B + 'B / ' + counts.C + 'C';

    const labelsEl = document.getElementById('dist-labels');
    labelsEl.innerHTML = [
        { grade: 'A', label: 'Grade A (White)', count: counts.A, pct: pctA, dotClass: 'dist-label-dot-a' },
        { grade: 'B', label: 'Grade B (Red)',   count: counts.B, pct: pctB, dotClass: 'dist-label-dot-b' },
        { grade: 'C', label: 'Grade C (Blue)',  count: counts.C, pct: pctC, dotClass: 'dist-label-dot-c' },
    ].map(d =>
        '<div class="dist-label">' +
        '<span class="dist-label-dot ' + d.dotClass + '"></span>' +
        '<span>' + d.label + '</span>' +
        '<span class="dist-label-count">' + d.count + '</span>' +
        '<span class="dist-label-pct">(' + d.pct.toFixed(0) + '%)</span>' +
        '</div>'
    ).join('');
}

// ============================================
//  Quartile Statistics
// ============================================

function renderQuartiles(grades) {
    const gc = gradeColors();
    const grid = document.getElementById('quartile-grid');

    const byGrade = { A: [], B: [], C: [] };
    grades.forEach(g => {
        if (g.color_value != null && byGrade[g.grade]) {
            byGrade[g.grade].push(g.color_value);
        }
    });

    grid.innerHTML = ['A', 'B', 'C'].map(grade => {
        const values = byGrade[grade].sort((a, b) => a - b);
        const n = values.length;

        if (n === 0) {
            return '<div class="quartile-block">' +
                '<div class="quartile-header">' +
                '<span class="quartile-grade-dot dot-' + grade.toLowerCase() + '"></span>' +
                '<span class="quartile-grade-label">Grade ' + grade + '</span>' +
                '<span class="quartile-grade-n">n=0</span>' +
                '</div>' +
                '<div class="quartile-rows">' +
                '<div class="quartile-row"><span class="quartile-stat-label">No data</span></div>' +
                '</div></div>';
        }

        const q1 = percentile(values, 25);
        const q2 = percentile(values, 50);
        const q3 = percentile(values, 75);
        const min = values[0];
        const max = values[n - 1];
        const mean = values.reduce((s, v) => s + v, 0) / n;
        const iqr = q3 - q1;

        return '<div class="quartile-block">' +
            '<div class="quartile-header">' +
            '<span class="quartile-grade-dot dot-' + grade.toLowerCase() + '"></span>' +
            '<span class="quartile-grade-label">Grade ' + grade + ' (' + { A: 'White', B: 'Red', C: 'Blue' }[grade] + ')</span>' +
            '<span class="quartile-grade-n">n=' + n + '</span>' +
            '</div>' +
            '<div class="quartile-rows">' +
            '<div class="quartile-row"><span class="quartile-stat-label">Median (Q2)</span><span class="quartile-stat-value highlight">' + q2.toFixed(0) + '</span></div>' +
            '<div class="quartile-row"><span class="quartile-stat-label">Mean</span><span class="quartile-stat-value">' + mean.toFixed(1) + '</span></div>' +
            '<div class="quartile-row"><span class="quartile-stat-label">Q1 (25th)</span><span class="quartile-stat-value">' + q1.toFixed(0) + '</span></div>' +
            '<div class="quartile-row"><span class="quartile-stat-label">Q3 (75th)</span><span class="quartile-stat-value">' + q3.toFixed(0) + '</span></div>' +
            '<div class="quartile-row"><span class="quartile-stat-label">IQR</span><span class="quartile-stat-value">' + iqr.toFixed(0) + '</span></div>' +
            '<div class="quartile-row"><span class="quartile-stat-label">Range</span><span class="quartile-stat-value">' + min + ' - ' + max + '</span></div>' +
            '</div></div>';
    }).join('');
}

function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const frac = idx - lo;
    return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

// ============================================
//  Expandable Sections
// ============================================

function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.classList.toggle('open');
}

// ============================================
//  Run Details Table
// ============================================

function renderTable(grades) {
    const sorted = [...grades].sort((a, b) => b.run - a.run);
    const tbody = document.getElementById('trace-tbody');
    const showMoreBtn = document.getElementById('table-show-more');

    const display = _tableExpanded ? sorted : sorted.slice(0, TABLE_PREVIEW_ROWS);

    tbody.innerHTML = display.map(g => {
        const ts = g.timestamp ? new Date(g.timestamp).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }) : '--';
        const colorName = { A: 'White', B: 'Red', C: 'Blue' }[g.grade] || '?';
        return '<tr>' +
            '<td>#' + g.run + '</td>' +
            '<td><span class="grade-badge grade-badge-' + g.grade + '"><span class="grade-badge-swatch"></span> ' + g.grade + ' (' + colorName + ')</span></td>' +
            '<td>' + (g.color_value != null ? g.color_value : '--') + '</td>' +
            '<td>' + (g.burn_time != null ? g.burn_time.toFixed(2) + ' s' : '--') + '</td>' +
            '<td>' + ts + '</td>' +
            '</tr>';
    }).join('');

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
//  Drift Detection
// ============================================

function renderDrift(driftData) {
    const grid = document.getElementById('drift-grid');
    const badge = document.getElementById('drift-badge');

    if (!driftData || Object.keys(driftData).length === 0) {
        grid.innerHTML = '<div class="quartile-block"><span class="quartile-stat-label">Insufficient data for drift analysis</span></div>';
        badge.textContent = 'N/A';
        return;
    }

    const params = [
        { key: 'color_sensor_value', label: 'Color Sensor Value', unit: '' },
        { key: 'burn_time', label: 'Chamber Burn Time', unit: ' s' },
    ];

    let overallTrend = 'stable';

    grid.innerHTML = params.map(param => {
        const d = driftData[param.key];
        if (!d || d.trend === 'insufficient_data') {
            return '<div class="drift-block">' +
                '<div class="drift-block-title">' + param.label + '</div>' +
                '<p style="font-size:0.72rem;color:var(--text-tertiary)">Not enough data (need 4+ runs)</p>' +
                '</div>';
        }

        if (d.trend === 'degrading') overallTrend = 'degrading';
        else if (d.trend === 'improving' && overallTrend !== 'degrading') overallTrend = 'improving';

        const trendClass = 'drift-trend-' + d.trend;
        const arrow = d.mean_shift > 0 ? '&#8599;' : (d.mean_shift < 0 ? '&#8600;' : '&#8594;');

        return '<div class="drift-block">' +
            '<div class="drift-block-title">' +
            param.label +
            ' <span class="drift-trend-badge ' + trendClass + '">' + d.trend + '</span>' +
            '</div>' +
            '<div class="drift-comparison">' +
            '<div class="drift-half">' +
            '<div class="drift-half-label">First ' + d.first_n + ' runs</div>' +
            '<div class="drift-half-value">' + d.first_half_mean.toFixed(1) + param.unit + '</div>' +
            '<div class="drift-half-sigma">&sigma; ' + d.first_half_sigma.toFixed(2) + '</div>' +
            '</div>' +
            '<div class="drift-arrow-col">' +
            '<span class="drift-arrow-icon">' + arrow + '</span>' +
            '<span class="drift-shift-value">' + (d.mean_shift >= 0 ? '+' : '') + d.mean_shift.toFixed(1) + param.unit + '</span>' +
            '</div>' +
            '<div class="drift-half">' +
            '<div class="drift-half-label">Last ' + d.second_n + ' runs</div>' +
            '<div class="drift-half-value">' + d.second_half_mean.toFixed(1) + param.unit + '</div>' +
            '<div class="drift-half-sigma">&sigma; ' + d.second_half_sigma.toFixed(2) + '</div>' +
            '</div>' +
            '</div>' +
            '</div>';
    }).join('');

    badge.textContent = overallTrend;
}

// ============================================
//  Utility
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

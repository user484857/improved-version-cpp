/**
 * Quality Analysis A -- Color Sensor Scatter
 *
 * Data-driven quality grading dashboard.
 * Fetches /api/analytics/quality-grades and /api/analytics/cycle-times.
 * Refreshes every 5 seconds.
 *
 * Grade colors = actual workpiece colors:
 *   A = white (#f0f0f0)  sensor 230-320
 *   B = red   (#FF453A)  sensor 100-210
 *   C = blue  (#007AFF)  sensor 30-70
 *
 * NO yellow anywhere.
 */

// -- Grade colors (workpiece actual) --
const GRADE_COLORS = {
    A: '#f0f0f0',
    B: '#FF453A',
    C: '#007AFF',
};

const GRADE_COLORS_LIGHT = {
    A: '#999999',
    B: '#FF3B30',
    C: '#007AFF',
};

const TREND_COLOR = '#AF52DE';

// -- State --
let _gradesData = null;
let _cycleData = null;
let _activeGradeFilter = 'all';
let _showTrendLine = true;
let _tableExpanded = false;
let chartScatter = null;
const TABLE_PREVIEW_ROWS = 8;
let _refreshTimer = null;

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
//  Data fetching
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
//  Init + refresh loop
// ============================================

async function init() {
    await loadData();
    _refreshTimer = setInterval(loadData, 5000);
}

async function loadData() {
    const [grades, cycles] = await Promise.all([
        fetchJSON('/api/analytics/quality-grades'),
        fetchJSON('/api/analytics/cycle-times'),
    ]);

    if (!grades || grades.length === 0) {
        if (!_gradesData) showEmpty();
        return;
    }

    _gradesData = grades;
    _cycleData = cycles;

    renderKPIs(grades);
    renderDistribution(grades);
    renderScatterChart(grades);
    renderQuartiles(grades);
    renderTable(grades, cycles);
    renderDrift(grades);
    updateTimestamp();
}

function showEmpty() {
    const app = document.querySelector('.app');
    if (app.querySelector('.empty-state')) return;
    app.insertAdjacentHTML('beforeend',
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
    el.classList.remove('stale');
}

// ============================================
//  KPI Pills
// ============================================

function renderKPIs(grades) {
    const counts = { A: 0, B: 0, C: 0 };
    grades.forEach(function(g) {
        if (counts[g.grade] !== undefined) counts[g.grade]++;
    });
    const total = grades.length;

    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-grade-a').textContent = counts.A;
    document.getElementById('kpi-grade-b').textContent = counts.B;
    document.getElementById('kpi-grade-c').textContent = counts.C;

    // Run details badge
    const badge = document.getElementById('run-count-badge');
    if (badge) badge.textContent = total + ' runs';
}

// ============================================
//  Grade Distribution (stacked horizontal bar)
// ============================================

function renderDistribution(grades) {
    const counts = { A: 0, B: 0, C: 0 };
    grades.forEach(function(g) {
        if (counts[g.grade] !== undefined) counts[g.grade]++;
    });
    const total = grades.length || 1;

    const pctA = (counts.A / total) * 100;
    const pctB = (counts.B / total) * 100;
    const pctC = (counts.C / total) * 100;

    document.getElementById('dist-seg-a').style.width = pctA + '%';
    document.getElementById('dist-seg-b').style.width = pctB + '%';
    document.getElementById('dist-seg-c').style.width = pctC + '%';

    document.getElementById('dist-pct-a').textContent = pctA >= 8 ? pctA.toFixed(0) + '%' : '';
    document.getElementById('dist-pct-b').textContent = pctB >= 8 ? pctB.toFixed(0) + '%' : '';
    document.getElementById('dist-pct-c').textContent = pctC >= 8 ? pctC.toFixed(0) + '%' : '';

    document.getElementById('dist-summary').textContent =
        counts.A + 'A / ' + counts.B + 'B / ' + counts.C + 'C';
}

// ============================================
//  Grade Filter
// ============================================

function setGradeFilter(grade) {
    _activeGradeFilter = grade;

    document.querySelectorAll('#grade-filter .filter-pill').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.grade === grade);
    });

    if (_gradesData) {
        renderScatterChart(_gradesData);
    }
}

// ============================================
//  Trend Line Toggle
// ============================================

function toggleTrendLine(show) {
    _showTrendLine = show;

    document.querySelectorAll('#trend-toggle .filter-pill').forEach(function(btn) {
        var isOn = btn.dataset.trend === 'on';
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
    var tc = themeColors();
    var gc = gradeColors();

    // Filter data
    var filtered = _activeGradeFilter === 'all'
        ? grades
        : grades.filter(function(g) { return g.grade === _activeGradeFilter; });

    // Build scatter points
    var scatterData = filtered
        .filter(function(g) { return g.color_value != null; })
        .map(function(g) {
            return { x: g.run, y: g.color_value, grade: g.grade };
        });

    // Point colors
    var pointColors = scatterData.map(function(d) { return gc[d.grade] || gc.C; });
    var pointBorderColors = scatterData.map(function(d) {
        if (d.grade === 'A') {
            return isDark() ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)';
        }
        return gc[d.grade] || gc.C;
    });

    // Datasets
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

    // Trend line via linear regression on ALL data (not filtered)
    if (_showTrendLine && grades.length >= 2) {
        var allPoints = grades
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
                    ctx.fillStyle = isDark()
                        ? 'rgba(255,255,255,' + tc.bandAlpha + ')'
                        : 'rgba(0,0,0,' + tc.bandAlpha + ')';
                } else {
                    ctx.fillStyle = hexToRgba(band.color, parseFloat(tc.bandAlpha));
                }
                ctx.fillRect(chartArea.left, yTop, chartArea.width, h);

                // Band label on left edge
                ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)';
                ctx.font = "600 10px 'SF Mono', monospace";
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(band.label, chartArea.left + 6, yTop + h / 2);
            }
            ctx.restore();
        },
    };

    // Axis range
    var maxRun = grades.length > 0
        ? Math.max.apply(null, grades.map(function(g) { return g.run; }))
        : 20;

    var canvas = document.getElementById('chart-scatter');
    var ctx2 = canvas.getContext('2d');

    if (chartScatter) chartScatter.destroy();

    chartScatter = new Chart(ctx2, {
        type: 'scatter',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: Object.assign({}, baseTooltip(), {
                    callbacks: {
                        title: function(items) {
                            if (!items.length) return '';
                            return 'Run #' + items[0].raw.x;
                        },
                        label: function(ctx) {
                            var d = ctx.raw;
                            if (d.grade) {
                                var colorName = { A: 'White', B: 'Red', C: 'Blue' }[d.grade] || '';
                                return 'Color Value: ' + d.y + '  |  Grade ' + d.grade + ' (' + colorName + ')';
                            }
                            return 'Trend: ' + d.y.toFixed(1);
                        },
                    },
                }),
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

// ============================================
//  Quartile Statistics
// ============================================

function renderQuartiles(grades) {
    var gc = gradeColors();
    var grid = document.getElementById('quartile-grid');

    var byGrade = { A: [], B: [], C: [] };
    grades.forEach(function(g) {
        if (g.color_value != null && byGrade[g.grade]) {
            byGrade[g.grade].push(g.color_value);
        }
    });

    var gradeNames = { A: 'White', B: 'Red', C: 'Blue' };

    grid.innerHTML = ['A', 'B', 'C'].map(function(grade) {
        var values = byGrade[grade].slice().sort(function(a, b) { return a - b; });
        var n = values.length;

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

        var q1 = percentile(values, 25);
        var q2 = percentile(values, 50);
        var q3 = percentile(values, 75);
        var min = values[0];
        var max = values[n - 1];
        var mean = values.reduce(function(s, v) { return s + v; }, 0) / n;
        var iqr = q3 - q1;

        // Box-plot range for visualization (0-300 scale)
        var scaleMin = 0;
        var scaleMax = 300;
        var range = scaleMax - scaleMin;
        var iqrLeft = ((q1 - scaleMin) / range * 100).toFixed(1);
        var iqrWidth = ((iqr) / range * 100).toFixed(1);
        var medianPos = ((q2 - scaleMin) / range * 100).toFixed(1);

        var accentColor = gc[grade];

        return '<div class="quartile-block">' +
            '<div class="quartile-header">' +
            '<span class="quartile-grade-dot dot-' + grade.toLowerCase() + '"></span>' +
            '<span class="quartile-grade-label">Grade ' + grade + ' (' + gradeNames[grade] + ')</span>' +
            '<span class="quartile-grade-n">n=' + n + '</span>' +
            '</div>' +
            // Box-plot mini visualization
            '<div class="quartile-boxplot">' +
            '<div class="quartile-boxplot-iqr" style="left:' + iqrLeft + '%;width:' + iqrWidth + '%;background:' + accentColor + '"></div>' +
            '<div class="quartile-boxplot-median" style="left:' + medianPos + '%;background:' + accentColor + '"></div>' +
            '</div>' +
            '<div class="quartile-boxplot-labels">' +
            '<span class="quartile-boxplot-label">' + min + '</span>' +
            '<span class="quartile-boxplot-label">' + max + '</span>' +
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
    var idx = (p / 100) * (sorted.length - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    var frac = idx - lo;
    return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

// ============================================
//  Expandable Sections
// ============================================

function toggleSection(sectionId) {
    var section = document.getElementById(sectionId);
    if (!section) return;
    section.classList.toggle('open');
}

// ============================================
//  Run Details Table
// ============================================

function renderTable(grades, cycles) {
    // Merge cycle-time data into grades by run number
    var cycleMap = {};
    if (cycles && cycles.length) {
        cycles.forEach(function(c) {
            if (c.run != null) cycleMap[c.run] = c;
        });
    }

    var sorted = grades.slice().sort(function(a, b) { return b.run - a.run; });
    var tbody = document.getElementById('trace-tbody');
    var showMoreBtn = document.getElementById('table-show-more');

    var display = _tableExpanded ? sorted : sorted.slice(0, TABLE_PREVIEW_ROWS);

    tbody.innerHTML = display.map(function(g) {
        var ts = g.timestamp ? new Date(g.timestamp).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }) : '--';
        var colorName = { A: 'White', B: 'Red', C: 'Blue' }[g.grade] || '?';

        // Chamber time: prefer burn_time from grades, fallback to cycle data MS station
        var chamberTime = '--';
        if (g.burn_time != null) {
            chamberTime = g.burn_time.toFixed(2) + ' s';
        } else if (cycleMap[g.run] && cycleMap[g.run].stations && cycleMap[g.run].stations.MS != null) {
            chamberTime = cycleMap[g.run].stations.MS.toFixed(2) + ' s';
        }

        return '<tr>' +
            '<td>#' + g.run + '</td>' +
            '<td><span class="grade-badge grade-badge-' + g.grade + '">' +
            '<span class="grade-badge-swatch"></span> ' + g.grade + ' (' + colorName + ')' +
            '</span></td>' +
            '<td>' + (g.color_value != null ? g.color_value : '--') + '</td>' +
            '<td>' + chamberTime + '</td>' +
            '<td>' + ts + '</td>' +
            '</tr>';
    }).join('');

    if (!_tableExpanded && sorted.length > TABLE_PREVIEW_ROWS) {
        showMoreBtn.textContent = 'Show all ' + sorted.length + ' records';
        showMoreBtn.style.display = 'block';
        showMoreBtn.onclick = function() {
            _tableExpanded = true;
            renderTable(grades, cycles);
        };
    } else {
        showMoreBtn.style.display = 'none';
    }
}

// ============================================
//  Drift Detection (computed client-side from grades)
// ============================================

function renderDrift(grades) {
    var grid = document.getElementById('drift-grid');
    var badge = document.getElementById('drift-badge');

    if (!grades || grades.length < 4) {
        grid.innerHTML = '<div class="quartile-block"><span class="quartile-stat-label">Insufficient data for drift analysis (need 4+ runs)</span></div>';
        badge.textContent = 'N/A';
        return;
    }

    // Compute drift for color sensor values and burn time
    var params = [
        { key: 'color_value', label: 'Color Sensor Value', unit: '' },
        { key: 'burn_time', label: 'Chamber Burn Time', unit: ' s' },
    ];

    var overallTrend = 'stable';

    grid.innerHTML = params.map(function(param) {
        var values = [];
        grades.forEach(function(g) {
            if (g[param.key] != null) values.push(g[param.key]);
        });

        if (values.length < 4) {
            return '<div class="drift-block">' +
                '<div class="drift-block-title">' + param.label + '</div>' +
                '<p style="font-size:0.72rem;color:var(--text-tertiary)">Not enough data (need 4+ runs)</p>' +
                '</div>';
        }

        var mid = Math.floor(values.length / 2);
        var firstHalf = values.slice(0, mid);
        var secondHalf = values.slice(mid);

        var m1 = mean(firstHalf);
        var m2 = mean(secondHalf);
        var s1 = sigma(firstHalf);
        var s2 = sigma(secondHalf);
        var meanShift = m2 - m1;
        var sigmaChange = s2 - s1;

        // Determine trend
        var trend;
        if (param.key === 'burn_time') {
            var target = 3.0;
            var d1 = Math.abs(m1 - target);
            var d2 = Math.abs(m2 - target);
            if (d2 < d1 - 0.05) trend = 'improving';
            else if (d2 > d1 + 0.05) trend = 'degrading';
            else trend = 'stable';
        } else {
            if (Math.abs(sigmaChange) < 2.0) trend = 'stable';
            else if (sigmaChange < 0) trend = 'improving';
            else trend = 'degrading';
        }

        if (trend === 'degrading') overallTrend = 'degrading';
        else if (trend === 'improving' && overallTrend !== 'degrading') overallTrend = 'improving';

        var trendClass = 'drift-trend-' + trend;
        var arrow = meanShift > 0.01 ? '&#8599;' : (meanShift < -0.01 ? '&#8600;' : '&#8594;');

        return '<div class="drift-block">' +
            '<div class="drift-block-title">' +
            param.label +
            ' <span class="drift-trend-badge ' + trendClass + '">' + trend + '</span>' +
            '</div>' +
            '<div class="drift-comparison">' +
            '<div class="drift-half">' +
            '<div class="drift-half-label">First ' + firstHalf.length + ' runs</div>' +
            '<div class="drift-half-value">' + m1.toFixed(1) + param.unit + '</div>' +
            '<div class="drift-half-sigma">&sigma; ' + s1.toFixed(2) + '</div>' +
            '</div>' +
            '<div class="drift-arrow-col">' +
            '<span class="drift-arrow-icon">' + arrow + '</span>' +
            '<span class="drift-shift-value">' + (meanShift >= 0 ? '+' : '') + meanShift.toFixed(1) + param.unit + '</span>' +
            '</div>' +
            '<div class="drift-half">' +
            '<div class="drift-half-label">Last ' + secondHalf.length + ' runs</div>' +
            '<div class="drift-half-value">' + m2.toFixed(1) + param.unit + '</div>' +
            '<div class="drift-half-sigma">&sigma; ' + s2.toFixed(2) + '</div>' +
            '</div>' +
            '</div>' +
            '</div>';
    }).join('');

    badge.textContent = overallTrend;
}

// ============================================
//  Math Utilities
// ============================================

function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce(function(s, v) { return s + v; }, 0) / arr.length;
}

function sigma(arr) {
    if (arr.length < 2) return 0;
    var m = mean(arr);
    var sumSq = arr.reduce(function(s, v) { return s + (v - m) * (v - m); }, 0);
    return Math.sqrt(sumSq / (arr.length - 1));
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

/**
 * Quality B — Run-by-Run Timeline
 *
 * Production narrative dashboard: every run is a colored block.
 *
 * HERO:      Bar chart — one bar per run, height = color sensor value,
 *            color = grade (A white, B red, C blue). Trend overlay toggle.
 * SECONDARY: Color sensor scatter with threshold bands.
 * COLLAPSIBLE: Quartile stats, sortable run table, data transparency.
 *
 * NO donut. NO yellow. Grade colors = workpiece colors.
 *
 * APIs:
 *   /api/analytics/quality-grades  → [{run, color_value, grade, color_name, burn_time, peak_temp, timestamp}]
 *   /api/analytics/cycle-times     → [{run, stations:{…}, ms_substeps:{…}, total, timestamp}]
 */

// ============================================
//  Constants
// ============================================

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

const GRADE_NAMES = { A: 'White', B: 'Red', C: 'Blue' };
const TREND_COLOR = '#AF52DE';

// ============================================
//  State
// ============================================

let _gradesData = null;
let _cycleData = null;
let _showTrend = true;
let _tableExpanded = false;
let _sortCol = 'run';
let _sortDir = 'desc';
const TABLE_PREVIEW = 10;

let chartTimeline = null;
let chartScatter = null;

// ============================================
//  Theme
// ============================================

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    if (_gradesData) {
        renderTimeline(_gradesData);
        renderScatter(_gradesData);
    }
}

function isDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
}

function gc() {
    return isDark() ? GRADE_COLORS : GRADE_COLORS_LIGHT;
}

function tc() {
    const dark = isDark();
    return {
        tick:       dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)',
        grid:       dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
        tooltipBg:  dark ? 'rgba(20,20,30,0.92)'    : 'rgba(255,255,255,0.95)',
        tooltipBdr: dark ? 'rgba(255,255,255,0.1)'   : 'rgba(0,0,0,0.08)',
        tooltipTxt: dark ? '#fff'                    : '#000',
        bandAlpha:  dark ? 0.06                      : 0.05,
    };
}

function baseTooltip() {
    const t = tc();
    return {
        backgroundColor: t.tooltipBg,
        titleFont: { family: 'Inter', weight: '600', size: 12 },
        bodyFont: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 11 },
        titleColor: t.tooltipTxt,
        bodyColor: t.tooltipTxt,
        padding: 10,
        cornerRadius: 8,
        borderColor: t.tooltipBdr,
        borderWidth: 1,
    };
}

// ============================================
//  Data
// ============================================

async function fetchJSON(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; }
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
    renderGradeBar(grades);
    renderTimeline(grades);
    renderScatter(grades);
    renderPatterns(grades);
    renderQuartiles(grades);
    renderTable(grades);
    updateTimestamp();
}

function showEmpty() {
    document.querySelector('.app').insertAdjacentHTML('beforeend',
        '<div class="empty-state">' +
        '<svg width="48" height="48" viewBox="0 0 20 20" fill="currentColor">' +
        '<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/>' +
        '</svg>' +
        '<span>No quality data yet. Start a production run to see grading results.</span>' +
        '</div>'
    );
}

function updateTimestamp() {
    const el = document.getElementById('last-updated');
    if (!el) return;
    el.textContent = new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

// ============================================
//  KPI Pills
// ============================================

function renderKPIs(grades) {
    const counts = { A: 0, B: 0, C: 0 };
    grades.forEach(g => { if (counts[g.grade] !== undefined) counts[g.grade]++; });

    document.getElementById('kpi-total').textContent = grades.length;
    document.getElementById('kpi-grade-a').textContent = counts.A;
    document.getElementById('kpi-grade-b').textContent = counts.B;
    document.getElementById('kpi-grade-c').textContent = counts.C;
    document.getElementById('run-count-badge').textContent = grades.length + ' runs';
}

// ============================================
//  Stacked Grade Bar
// ============================================

function renderGradeBar(grades) {
    const counts = { A: 0, B: 0, C: 0 };
    grades.forEach(g => { if (counts[g.grade] !== undefined) counts[g.grade]++; });
    const total = grades.length || 1;

    const pA = (counts.A / total) * 100;
    const pB = (counts.B / total) * 100;
    const pC = (counts.C / total) * 100;

    document.getElementById('bar-a').style.width = pA + '%';
    document.getElementById('bar-b').style.width = pB + '%';
    document.getElementById('bar-c').style.width = pC + '%';

    const labelsEl = document.getElementById('grade-bar-labels');
    labelsEl.innerHTML =
        '<span class="grade-bar-label">A ' + pA.toFixed(0) + '%</span>' +
        '<span class="grade-bar-label">B ' + pB.toFixed(0) + '%</span>' +
        '<span class="grade-bar-label">C ' + pC.toFixed(0) + '%</span>';
}

// ============================================
//  Trend Toggle
// ============================================

function toggleTrend(on) {
    _showTrend = on;
    document.querySelectorAll('#trend-toggle .filter-pill').forEach(btn => {
        const isOn = btn.dataset.trend === 'on';
        btn.classList.toggle('active', on ? isOn : !isOn);
    });
    if (_gradesData) renderTimeline(_gradesData);
}

// ============================================
//  HERO: Run-by-Run Timeline (Bar Chart)
// ============================================

function renderTimeline(grades) {
    const colors = gc();
    const theme = tc();

    const filtered = grades.filter(g => g.color_value != null);
    if (filtered.length === 0) return;

    const labels = filtered.map(g => '#' + g.run);
    const values = filtered.map(g => g.color_value);
    const bgColors = filtered.map(g => {
        const c = colors[g.grade] || colors.C;
        // For grade A in dark mode, use a slightly visible fill
        if (g.grade === 'A' && isDark()) return 'rgba(240,240,240,0.55)';
        if (g.grade === 'A' && !isDark()) return 'rgba(150,150,150,0.65)';
        return c;
    });
    const borderColors = filtered.map(g => {
        if (g.grade === 'A') return isDark() ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.2)';
        return colors[g.grade] || colors.C;
    });

    const datasets = [{
        label: 'Color Sensor Value',
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: 0.82,
        categoryPercentage: 0.88,
    }];

    // Trend overlay — line on top of bar chart
    if (_showTrend && filtered.length >= 2) {
        const reg = linearRegression(filtered.map((g, i) => ({ x: i, y: g.color_value })));
        const trendVals = filtered.map((_, i) => reg.slope * i + reg.intercept);
        datasets.push({
            label: 'Trend',
            data: trendVals,
            type: 'line',
            borderColor: TREND_COLOR,
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            tension: 0,
            order: 0,
        });
    }

    const ctx = document.getElementById('chart-timeline').getContext('2d');
    if (chartTimeline) chartTimeline.destroy();

    chartTimeline = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...baseTooltip(),
                    filter: function(item) { return item.dataset.label !== 'Trend'; },
                    callbacks: {
                        title: function(items) {
                            if (!items.length) return '';
                            const idx = items[0].dataIndex;
                            return 'Run ' + labels[idx];
                        },
                        afterTitle: function(items) {
                            if (!items.length) return '';
                            const idx = items[0].dataIndex;
                            const g = filtered[idx];
                            return 'Grade ' + g.grade + ' (' + (GRADE_NAMES[g.grade] || '') + ')';
                        },
                        label: function(item) {
                            const idx = item.dataIndex;
                            const g = filtered[idx];
                            const lines = ['Color Value: ' + g.color_value];
                            if (g.burn_time != null) lines.push('Burn Time: ' + g.burn_time.toFixed(2) + ' s');
                            if (g.timestamp) {
                                const d = new Date(g.timestamp);
                                lines.push('Time: ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
                            }
                            return lines;
                        },
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        color: theme.tick,
                        font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 10 },
                        maxRotation: 0,
                    },
                    grid: { display: false },
                },
                y: {
                    min: 0,
                    max: 320,
                    ticks: {
                        stepSize: 50,
                        color: theme.tick,
                        font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 10 },
                    },
                    grid: { color: theme.grid, drawBorder: false },
                    title: {
                        display: true,
                        text: 'Color Sensor Value',
                        color: theme.tick,
                        font: { family: 'Inter', size: 11, weight: '500' },
                    },
                },
            },
            animation: { duration: 600 },
        },
    });
}

// ============================================
//  Pattern Narrative Strip
// ============================================

function renderPatterns(grades) {
    const strip = document.getElementById('pattern-strip');
    if (!strip) return;

    const tags = [];

    // Longest Grade-A streak
    let maxStreak = 0, curStreak = 0;
    grades.forEach(g => {
        if (g.grade === 'A') { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
        else curStreak = 0;
    });
    if (maxStreak >= 2) {
        tags.push({ cls: 'pattern-tag-streak', icon: '\u2713', text: maxStreak + '-run A streak' });
    }

    // Back-to-back non-A
    let maxNonA = 0, curNonA = 0;
    grades.forEach(g => {
        if (g.grade !== 'A') { curNonA++; maxNonA = Math.max(maxNonA, curNonA); }
        else curNonA = 0;
    });
    if (maxNonA >= 2) {
        tags.push({ cls: 'pattern-tag-run', icon: '!', text: maxNonA + ' non-A in a row' });
    }

    // Drift detection
    if (grades.length >= 4) {
        const vals = grades.filter(g => g.color_value != null).map(g => g.color_value);
        if (vals.length >= 4) {
            const half = Math.floor(vals.length / 2);
            const firstHalf = vals.slice(0, half);
            const secondHalf = vals.slice(half);
            const mean1 = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
            const mean2 = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
            const shift = Math.abs(mean2 - mean1);
            if (shift > 20) {
                const dir = mean2 > mean1 ? 'upward' : 'downward';
                tags.push({ cls: 'pattern-tag-drift', icon: '\u2248', text: 'Sensor drift ' + dir + ' (' + shift.toFixed(0) + ')' });
            }
        }
    }

    // Grade distribution note
    const counts = { A: 0, B: 0, C: 0 };
    grades.forEach(g => { if (counts[g.grade] !== undefined) counts[g.grade]++; });
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (dominant && grades.length >= 3) {
        const pct = ((dominant[1] / grades.length) * 100).toFixed(0);
        tags.push({ cls: 'pattern-tag-neutral', icon: '\u25CF', text: pct + '% Grade ' + dominant[0] });
    }

    strip.innerHTML = tags.map(t =>
        '<span class="pattern-tag ' + t.cls + '">' +
        '<span class="pattern-tag-icon">' + t.icon + '</span>' +
        t.text +
        '</span>'
    ).join('');
}

// ============================================
//  Secondary: Color Sensor Scatter
// ============================================

function renderScatter(grades) {
    const colors = gc();
    const theme = tc();

    const filtered = grades.filter(g => g.color_value != null);
    if (filtered.length === 0) return;

    const scatterData = filtered.map(g => ({
        x: g.run,
        y: g.color_value,
        grade: g.grade,
    }));

    const pointBg = scatterData.map(d => colors[d.grade] || colors.C);
    const pointBorder = scatterData.map(d => {
        if (d.grade === 'A') return isDark() ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)';
        return colors[d.grade] || colors.C;
    });

    const datasets = [{
        label: 'Color Sensor Value',
        data: scatterData,
        backgroundColor: pointBg,
        borderColor: pointBorder,
        borderWidth: scatterData.map(d => d.grade === 'A' ? 1.5 : 1),
        pointRadius: 6,
        pointHoverRadius: 9,
        showLine: true,
        tension: 0.2,
        fill: false,
        borderColor: 'rgba(128,128,128,0.15)',
        borderWidth: 1,
        segment: {
            borderColor: 'rgba(128,128,128,0.12)',
        },
    }];

    const maxRun = Math.max(...grades.map(g => g.run), 1);

    // Threshold band plugin
    const bandPlugin = {
        id: 'gradeBandScatter',
        beforeDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.y) return;
            const yScale = scales.y;

            const bands = [
                { min: 250, max: 300, color: colors.A, label: 'A (250-300)' },
                { min: 130, max: 190, color: colors.B, label: 'B (130-190)' },
                { min: 40,  max: 60,  color: colors.C, label: 'C (40-60)' },
            ];

            ctx.save();
            for (const band of bands) {
                const yTop = yScale.getPixelForValue(band.max);
                const yBot = yScale.getPixelForValue(band.min);
                const h = yBot - yTop;

                if (band.color === '#f0f0f0' || band.color === '#999999') {
                    ctx.fillStyle = isDark()
                        ? 'rgba(255,255,255,' + theme.bandAlpha + ')'
                        : 'rgba(0,0,0,' + theme.bandAlpha + ')';
                } else {
                    ctx.fillStyle = hexToRgba(band.color, theme.bandAlpha);
                }
                ctx.fillRect(chartArea.left, yTop, chartArea.width, h);

                ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)';
                ctx.font = "600 9px 'SF Mono', monospace";
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(band.label, chartArea.left + 6, yTop + h / 2);
            }
            ctx.restore();
        },
    };

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
                            return 'Run #' + items[0].raw.x;
                        },
                        label(ctx) {
                            const d = ctx.raw;
                            return 'Value: ' + d.y + '  |  Grade ' + d.grade + ' (' + (GRADE_NAMES[d.grade] || '') + ')';
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
                        color: theme.tick,
                        font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 10 },
                        callback(val) { return Number.isInteger(val) ? val : ''; },
                    },
                    grid: { display: false },
                    title: {
                        display: true,
                        text: 'Run Number',
                        color: theme.tick,
                        font: { family: 'Inter', size: 11, weight: '500' },
                    },
                },
                y: {
                    min: 0,
                    max: 320,
                    ticks: {
                        stepSize: 50,
                        color: theme.tick,
                        font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 10 },
                    },
                    grid: { color: theme.grid, drawBorder: false },
                    title: {
                        display: true,
                        text: 'Color Sensor Value',
                        color: theme.tick,
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
//  Quartile Comparison
// ============================================

function renderQuartiles(grades) {
    const grid = document.getElementById('quartile-grid');
    if (!grid) return;

    const byGrade = { A: [], B: [], C: [] };
    grades.forEach(g => {
        if (g.color_value != null && byGrade[g.grade]) {
            byGrade[g.grade].push(g.color_value);
        }
    });

    grid.innerHTML = ['A', 'B', 'C'].map(grade => {
        const values = byGrade[grade].slice().sort((a, b) => a - b);
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
        const sigma = stdDev(values, mean);

        return '<div class="quartile-block">' +
            '<div class="quartile-header">' +
            '<span class="quartile-grade-dot dot-' + grade.toLowerCase() + '"></span>' +
            '<span class="quartile-grade-label">Grade ' + grade + ' (' + GRADE_NAMES[grade] + ')</span>' +
            '<span class="quartile-grade-n">n=' + n + '</span>' +
            '</div>' +
            '<div class="quartile-rows">' +
            row('Median (Q2)', q2.toFixed(0), true) +
            row('Mean', mean.toFixed(1)) +
            row('Q1 (25th)', q1.toFixed(0)) +
            row('Q3 (75th)', q3.toFixed(0)) +
            row('IQR', iqr.toFixed(0)) +
            row('Std Dev', sigma.toFixed(1)) +
            row('Range', min + ' \u2013 ' + max) +
            '</div></div>';
    }).join('');
}

function row(label, value, highlight) {
    return '<div class="quartile-row">' +
        '<span class="quartile-stat-label">' + label + '</span>' +
        '<span class="quartile-stat-value' + (highlight ? ' highlight' : '') + '">' + value + '</span>' +
        '</div>';
}

// ============================================
//  Expandable Sections
// ============================================

function toggleSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.classList.toggle('open');
}

// ============================================
//  Sortable Run Details Table
// ============================================

function renderTable(grades) {
    const sorted = sortData([...grades]);
    const tbody = document.getElementById('trace-tbody');
    const showMoreBtn = document.getElementById('table-show-more');

    const display = _tableExpanded ? sorted : sorted.slice(0, TABLE_PREVIEW);

    tbody.innerHTML = display.map(g => {
        const ts = g.timestamp ? new Date(g.timestamp).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }) : '--';
        const colorName = GRADE_NAMES[g.grade] || '?';

        return '<tr>' +
            '<td>#' + g.run + '</td>' +
            '<td><span class="grade-badge grade-badge-' + g.grade + '"><span class="grade-badge-swatch"></span> ' + g.grade + ' (' + colorName + ')</span></td>' +
            '<td>' + (g.color_value != null ? g.color_value : '--') + '</td>' +
            '<td>' + (g.burn_time != null ? g.burn_time.toFixed(2) + ' s' : '--') + '</td>' +
            '<td>' + ts + '</td>' +
            '</tr>';
    }).join('');

    // Update sort arrows
    ['run', 'grade', 'color_value', 'burn_time', 'timestamp'].forEach(col => {
        const arrow = document.getElementById('sort-' + col);
        if (!arrow) return;
        arrow.className = 'sort-arrow';
        if (col === _sortCol) {
            arrow.classList.add(_sortDir);
        }
    });

    if (!_tableExpanded && sorted.length > TABLE_PREVIEW) {
        showMoreBtn.textContent = 'Show all ' + sorted.length + ' records';
        showMoreBtn.style.display = 'block';
        showMoreBtn.onclick = function() {
            _tableExpanded = true;
            renderTable(_gradesData);
        };
    } else {
        showMoreBtn.style.display = 'none';
    }
}

function sortTable(col) {
    if (_sortCol === col) {
        _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        _sortCol = col;
        _sortDir = col === 'run' ? 'desc' : 'asc';
    }
    if (_gradesData) renderTable(_gradesData);
}

function sortData(data) {
    const col = _sortCol;
    const dir = _sortDir === 'asc' ? 1 : -1;

    return data.sort((a, b) => {
        let va = a[col];
        let vb = b[col];

        if (va == null) va = '';
        if (vb == null) vb = '';

        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
        return (String(va) > String(vb) ? 1 : -1) * dir;
    });
}

// ============================================
//  Math Helpers
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
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: sumY / n };
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
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

function stdDev(values, mean) {
    if (values.length < 2) return 0;
    const sumSq = values.reduce((s, v) => s + (v - mean) * (v - mean), 0);
    return Math.sqrt(sumSq / (values.length - 1));
}

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

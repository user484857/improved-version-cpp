/**
 * Quality Analysis v3 -- Full Transparency
 *
 * Design direction: Show everything we have, be brutally honest
 * about what is measured vs modeled.
 *
 * Grade A (gold)   = White sensor 250-300
 * Grade B (orange) = Red sensor 130-190
 * Grade C (grey)   = Blue sensor 40-60
 */

const GRADE_COLORS = { A: '#FFD60A', B: '#FF9F0A', C: '#8E8E93' };
const GRADE_LABELS = { A: 'Grade A -- EV/Racing', B: 'Grade B -- Stationary', C: 'Grade C -- Consumer' };

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
//  Chart instances
// ============================================

let chartDonut = null;
let chartBurnHist = null;
let chartGradeBurn = null;

// ============================================
//  Data fetch + init
// ============================================

let _allGrades = null;
let _sortCol = 'run';
let _sortDir = 'desc';

async function init() {
    const gradesData = await fetchJSON('/api/analytics/quality-grades');

    if (!gradesData || gradesData.length === 0) {
        showEmpty();
        return;
    }

    _allGrades = gradesData;

    renderKPIs(gradesData);
    renderDonut(gradesData);
    renderBurnHistogram(gradesData);
    renderTimeline(gradesData);
    renderGradeBurn(gradesData);
    renderTable(gradesData);
    initSortableHeaders();
}

async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

function showEmpty() {
    document.querySelector('.app').insertAdjacentHTML('beforeend',
        '<div style="display:flex;flex-direction:column;align-items:center;padding:60px 20px;color:var(--text-tertiary);font-size:0.85rem;gap:10px;text-align:center;">' +
        '<svg width="48" height="48" viewBox="0 0 20 20" fill="currentColor" style="opacity:0.3">' +
        '<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/>' +
        '</svg><span>No quality data available. Run a production cycle to generate data.</span></div>'
    );
}

// ============================================
//  Shared chart helpers
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
//  1. KPI Tiles with trend arrows
// ============================================

function renderKPIs(grades) {
    const total = grades.length;
    const gradeA = grades.filter(g => g.grade === 'A').length;
    const fpy = total > 0 ? ((gradeA / total) * 100).toFixed(1) : '0.0';

    const burnTimes = grades.filter(g => g.burn_time != null).map(g => g.burn_time);
    const avgBurn = burnTimes.length > 0
        ? (burnTimes.reduce((s, v) => s + v, 0) / burnTimes.length).toFixed(2)
        : '--';

    document.getElementById('kpi-yield').textContent = fpy + '%';
    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-chamber').textContent = avgBurn !== '--' ? avgBurn + ' s' : '--';

    // Compute trends by comparing first half vs second half
    if (grades.length >= 4) {
        const mid = Math.floor(grades.length / 2);
        const firstHalf = grades.slice(0, mid);
        const secondHalf = grades.slice(mid);

        // Yield trend
        const fhYield = firstHalf.filter(g => g.grade === 'A').length / firstHalf.length;
        const shYield = secondHalf.filter(g => g.grade === 'A').length / secondHalf.length;
        setTrend('kpi-yield-trend', shYield - fhYield, 0.05);

        // Total trend -- always up if producing
        setTrendFixed('kpi-total-trend', 'up', '+' + secondHalf.length + ' recent');

        // Chamber time trend -- closer to 3.0 target is better
        const fhBurn = firstHalf.filter(g => g.burn_time != null).map(g => g.burn_time);
        const shBurn = secondHalf.filter(g => g.burn_time != null).map(g => g.burn_time);
        if (fhBurn.length > 0 && shBurn.length > 0) {
            const fhAvg = fhBurn.reduce((s, v) => s + v, 0) / fhBurn.length;
            const shAvg = shBurn.reduce((s, v) => s + v, 0) / shBurn.length;
            const fhDist = Math.abs(fhAvg - 3.0);
            const shDist = Math.abs(shAvg - 3.0);
            setTrend('kpi-chamber-trend', fhDist - shDist, 0.03);
        }
    }
}

function setTrend(elId, diff, threshold) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (diff > threshold) {
        el.className = 'kpi-trend up';
        el.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 2L8 6H2z" fill="currentColor"/></svg> improving';
    } else if (diff < -threshold) {
        el.className = 'kpi-trend down';
        el.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 8L2 4h6z" fill="currentColor"/></svg> declining';
    } else {
        el.className = 'kpi-trend neutral';
        el.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5h6" stroke="currentColor" stroke-width="1.5"/></svg> stable';
    }
}

function setTrendFixed(elId, direction, text) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = 'kpi-trend ' + direction;
    if (direction === 'up') {
        el.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 2L8 6H2z" fill="currentColor"/></svg> ' + text;
    } else if (direction === 'down') {
        el.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 8L2 4h6z" fill="currentColor"/></svg> ' + text;
    } else {
        el.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5h6" stroke="currentColor" stroke-width="1.5"/></svg> ' + text;
    }
}

// ============================================
//  2. Grade Distribution Donut
// ============================================

function renderDonut(grades) {
    const counts = { A: 0, B: 0, C: 0 };
    grades.forEach(g => { if (counts[g.grade] !== undefined) counts[g.grade]++; });
    const total = grades.length;
    const fpy = total > 0 ? ((counts.A / total) * 100).toFixed(1) : '0.0';

    document.getElementById('donut-pct').textContent = fpy + '%';

    const legendEl = document.getElementById('donut-legend');
    legendEl.innerHTML = '';
    for (const [grade, label] of Object.entries(GRADE_LABELS)) {
        const pct = total > 0 ? ((counts[grade] / total) * 100).toFixed(0) : '0';
        const row = document.createElement('div');
        row.className = 'legend-row';
        row.innerHTML =
            '<span class="legend-swatch" style="background:' + GRADE_COLORS[grade] + '"></span>' +
            '<span class="legend-label">' + label + '</span>' +
            '<span class="legend-count">' + counts[grade] + '</span>' +
            '<span class="legend-pct">' + pct + '%</span>';
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
        },
    });
}

// ============================================
//  3. Burn Time Histogram
// ============================================

function renderBurnHistogram(grades) {
    const burnTimes = grades.filter(g => g.burn_time != null).map(g => g.burn_time);
    if (burnTimes.length === 0) return;

    const min = Math.floor(Math.min(...burnTimes) * 10) / 10;
    const max = Math.ceil(Math.max(...burnTimes) * 10) / 10;
    const range = max - min;
    const binCount = Math.max(6, Math.min(15, Math.ceil(Math.sqrt(burnTimes.length))));
    const binWidth = range / binCount || 0.1;

    const bins = [];
    for (let i = 0; i < binCount; i++) {
        const lo = min + i * binWidth;
        const hi = lo + binWidth;
        bins.push({
            label: lo.toFixed(2) + '-' + hi.toFixed(2),
            lo: lo,
            hi: hi,
            count: 0,
        });
    }

    burnTimes.forEach(bt => {
        for (let i = 0; i < bins.length; i++) {
            if (bt >= bins[i].lo && (bt < bins[i].hi || (i === bins.length - 1 && bt <= bins[i].hi))) {
                bins[i].count++;
                break;
            }
        }
    });

    // Color bins by proximity to target (3.0s)
    const target = 3.0;
    const barColors = bins.map(b => {
        const mid = (b.lo + b.hi) / 2;
        const dist = Math.abs(mid - target);
        if (dist < 0.15) return '#30D158';
        if (dist < 0.3) return '#007AFF';
        if (dist < 0.5) return '#FF9F0A';
        return '#FF453A';
    });

    const tc = themeColors();
    const ctx = document.getElementById('chart-burn-hist').getContext('2d');

    // Target line plugin
    const targetPlugin = {
        id: 'burnTarget',
        afterDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            if (!scales.x || !chartArea) return;

            // Find the bin index closest to target
            let targetIdx = 0;
            let minDist = Infinity;
            bins.forEach((b, i) => {
                const mid = (b.lo + b.hi) / 2;
                const d = Math.abs(mid - target);
                if (d < minDist) { minDist = d; targetIdx = i; }
            });

            const x = scales.x.getPixelForValue(targetIdx);
            c.save();
            c.setLineDash([5, 4]);
            c.lineWidth = 1;
            c.strokeStyle = themeColors().refLine;
            c.beginPath();
            c.moveTo(x, chartArea.top);
            c.lineTo(x, chartArea.bottom);
            c.stroke();

            c.fillStyle = themeColors().tick;
            c.font = "10px 'SF Mono', monospace";
            c.textAlign = 'center';
            c.fillText('Target 3.0s', x, chartArea.top - 6);
            c.restore();
        },
    };

    chartBurnHist = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: bins.map(b => b.label),
            datasets: [{
                label: 'Count',
                data: bins.map(b => b.count),
                backgroundColor: barColors.map(c => c + 'CC'),
                borderColor: barColors,
                borderWidth: 1,
                borderRadius: 4,
                maxBarThickness: 48,
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
                            return 'Burn Time: ' + items[0].label + 's';
                        },
                        label(ctx) {
                            return ctx.parsed.y + ' run' + (ctx.parsed.y !== 1 ? 's' : '');
                        },
                    },
                },
            },
            scales: {
                x: {
                    ...baseScale('x'),
                    title: { display: true, text: 'Chamber Time (s)', color: tc.tick, font: { family: 'Inter', size: 11, weight: '500' } },
                    ticks: {
                        color: tc.tick,
                        font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 9 },
                        maxRotation: 45,
                    },
                },
                y: {
                    ...baseScale('y'),
                    beginAtZero: true,
                    title: { display: true, text: 'Count', color: tc.tick, font: { family: 'Inter', size: 11, weight: '500' } },
                },
            },
        },
        plugins: [targetPlugin],
    });
}

// ============================================
//  4. Run-by-Run Timeline
// ============================================

function renderTimeline(grades) {
    const container = document.getElementById('timeline-container');
    const tooltip = document.getElementById('timeline-tooltip');
    container.innerHTML = '';

    // Normalize heights by burn time
    const burnTimes = grades.filter(g => g.burn_time != null).map(g => g.burn_time);
    const maxBurn = burnTimes.length > 0 ? Math.max(...burnTimes) : 3.5;
    const minBurn = burnTimes.length > 0 ? Math.min(...burnTimes) : 2.5;
    const burnRange = maxBurn - minBurn || 1;

    grades.forEach(g => {
        const block = document.createElement('div');
        block.className = 'run-block run-block-' + (g.grade || 'unknown').toLowerCase();

        // Height proportional to burn time (min 28px, max 56px)
        const bt = g.burn_time || 3.0;
        const normalized = (bt - minBurn) / burnRange;
        const height = 28 + normalized * 28;
        block.style.height = height.toFixed(0) + 'px';

        // Run label for every Nth run
        if (g.run === 1 || g.run === grades.length || g.run % 5 === 0) {
            const label = document.createElement('span');
            label.className = 'run-label';
            label.textContent = '#' + g.run;
            block.appendChild(label);
        }

        // Hover tooltip
        block.addEventListener('mouseenter', function(e) {
            const ts = g.timestamp ? new Date(g.timestamp).toLocaleString('de-DE', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
            }) : '--';

            tooltip.innerHTML =
                '<div class="tooltip-run">Run #' + g.run + ' -- Grade ' + (g.grade || '?') + '</div>' +
                '<div class="tooltip-row"><span class="tooltip-label">Chamber Time</span><span class="tooltip-val">' + (g.burn_time != null ? g.burn_time.toFixed(2) + 's' : 'N/A') + '</span></div>' +
                '<div class="tooltip-row"><span class="tooltip-label">Color Sensor</span><span class="tooltip-val">' + (g.color_value != null ? g.color_value : 'N/A') + '</span></div>' +
                '<div class="tooltip-row"><span class="tooltip-label">Color</span><span class="tooltip-val">' + (g.color_name || 'N/A') + '</span></div>' +
                '<div class="tooltip-row"><span class="tooltip-label">Time</span><span class="tooltip-val">' + ts + '</span></div>';

            tooltip.classList.add('visible');
        });

        block.addEventListener('mousemove', function(e) {
            tooltip.style.left = (e.clientX + 14) + 'px';
            tooltip.style.top = (e.clientY - 10) + 'px';
        });

        block.addEventListener('mouseleave', function() {
            tooltip.classList.remove('visible');
        });

        container.appendChild(block);
    });
}

// ============================================
//  5. Burn Time per Grade (grouped bar)
// ============================================

function renderGradeBurn(grades) {
    const grouped = { A: [], B: [], C: [] };
    grades.forEach(g => {
        if (g.grade && g.burn_time != null && grouped[g.grade]) {
            grouped[g.grade].push(g.burn_time);
        }
    });

    // For each grade compute: min, q1, median, q3, max
    function stats(arr) {
        if (arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const n = sorted.length;
        const min = sorted[0];
        const max = sorted[n - 1];
        const median = n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
        const q1Idx = Math.floor(n * 0.25);
        const q3Idx = Math.floor(n * 0.75);
        const q1 = sorted[q1Idx];
        const q3 = sorted[Math.min(q3Idx, n - 1)];
        const mean = arr.reduce((s, v) => s + v, 0) / n;
        return { min, q1, median, q3, max, mean, n };
    }

    const statsA = stats(grouped.A);
    const statsB = stats(grouped.B);
    const statsC = stats(grouped.C);

    // Build datasets: show min, mean, max as grouped bars
    const gradeLabels = [];
    const meanData = [];
    const minData = [];
    const maxData = [];
    const colors = [];
    const borderColors = [];

    [['A', statsA], ['B', statsB], ['C', statsC]].forEach(([grade, s]) => {
        if (s) {
            gradeLabels.push('Grade ' + grade + ' (n=' + s.n + ')');
            meanData.push(parseFloat(s.mean.toFixed(3)));
            minData.push(parseFloat(s.min.toFixed(3)));
            maxData.push(parseFloat(s.max.toFixed(3)));
            colors.push(GRADE_COLORS[grade] + 'CC');
            borderColors.push(GRADE_COLORS[grade]);
        }
    });

    const tc = themeColors();
    const ctx = document.getElementById('chart-grade-burn').getContext('2d');

    // Reference line at target 3.0s
    const targetPlugin = {
        id: 'gradeTarget',
        afterDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            if (!scales.y || !chartArea) return;
            const y = scales.y.getPixelForValue(3.0);
            if (y < chartArea.top || y > chartArea.bottom) return;

            c.save();
            c.setLineDash([5, 4]);
            c.lineWidth = 1;
            c.strokeStyle = themeColors().refLine;
            c.beginPath();
            c.moveTo(chartArea.left, y);
            c.lineTo(chartArea.right, y);
            c.stroke();

            c.fillStyle = themeColors().tick;
            c.font = "10px 'SF Mono', monospace";
            c.textAlign = 'left';
            c.fillText('Target 3.0s', chartArea.left + 4, y - 6);
            c.restore();
        },
    };

    chartGradeBurn = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: gradeLabels,
            datasets: [
                {
                    label: 'Min',
                    data: minData,
                    backgroundColor: colors.map(c => {
                        // Parse hex, make it dimmer
                        return c.replace('CC', '55');
                    }),
                    borderColor: borderColors.map(c => c + '88'),
                    borderWidth: 1,
                    borderRadius: 3,
                    maxBarThickness: 36,
                },
                {
                    label: 'Mean',
                    data: meanData,
                    backgroundColor: colors,
                    borderColor: borderColors,
                    borderWidth: 1,
                    borderRadius: 4,
                    maxBarThickness: 36,
                },
                {
                    label: 'Max',
                    data: maxData,
                    backgroundColor: colors.map(c => c.replace('CC', '55')),
                    borderColor: borderColors.map(c => c + '88'),
                    borderWidth: 1,
                    borderRadius: 3,
                    maxBarThickness: 36,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
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
                    },
                },
                tooltip: {
                    ...baseTooltip(),
                    callbacks: {
                        label(ctx) {
                            return ctx.dataset.label + ': ' + ctx.parsed.x.toFixed(3) + 's';
                        },
                    },
                },
            },
            scales: {
                x: {
                    ...baseScale('x'),
                    title: { display: true, text: 'Chamber Time (s)', color: tc.tick, font: { family: 'Inter', size: 11, weight: '500' } },
                },
                y: {
                    ...baseScale('y'),
                    grid: { display: false },
                },
            },
        },
        plugins: [targetPlugin],
    });
}

// ============================================
//  6. Traceability Table (sortable)
// ============================================

function renderTable(grades) {
    const sorted = sortGrades(grades, _sortCol, _sortDir);
    const tbody = document.getElementById('trace-tbody');
    const countEl = document.getElementById('table-count');

    if (countEl) countEl.textContent = sorted.length + ' records';

    tbody.innerHTML = sorted.map((g, i) => {
        const ts = g.timestamp ? new Date(g.timestamp).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }) : '--';
        return '<tr>' +
            '<td>' + g.run + '</td>' +
            '<td>' + (g.burn_time != null ? g.burn_time.toFixed(2) + ' s' : '--') + '</td>' +
            '<td>' + (g.color_value != null ? g.color_value : '--') + '</td>' +
            '<td><span class="grade-badge grade-badge-' + (g.grade || 'C') + '">Grade ' + (g.grade || '?') + '</span></td>' +
            '<td>' + (g.color_name || '--') + '</td>' +
            '<td>' + ts + '</td>' +
            '</tr>';
    }).join('');
}

function sortGrades(grades, col, dir) {
    const arr = [...grades];
    const mult = dir === 'asc' ? 1 : -1;

    arr.sort((a, b) => {
        let va = a[col];
        let vb = b[col];
        if (va == null) va = dir === 'asc' ? Infinity : -Infinity;
        if (vb == null) vb = dir === 'asc' ? Infinity : -Infinity;
        if (typeof va === 'string') return va.localeCompare(vb) * mult;
        return (va - vb) * mult;
    });

    return arr;
}

function initSortableHeaders() {
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', function() {
            const col = this.dataset.col;
            if (_sortCol === col) {
                _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _sortCol = col;
                _sortDir = 'desc';
            }

            // Update header classes
            document.querySelectorAll('.sortable').forEach(h => {
                h.classList.remove('asc', 'desc');
            });
            this.classList.add(_sortDir);

            if (_allGrades) renderTable(_allGrades);
        });
    });

    // Set initial sort indicator
    const initialTh = document.querySelector('.sortable[data-col="run"]');
    if (initialTh) initialTh.classList.add('desc');
}

// ============================================
//  Theme updates for all charts
// ============================================

function updateAllChartThemes() {
    const tc = themeColors();
    const charts = [chartDonut, chartBurnHist, chartGradeBurn];

    for (const ch of charts) {
        if (!ch) continue;

        if (ch.options.plugins && ch.options.plugins.tooltip) {
            ch.options.plugins.tooltip.backgroundColor = tc.tooltipBg;
            ch.options.plugins.tooltip.borderColor = tc.tooltipBdr;
            ch.options.plugins.tooltip.titleColor = tc.tooltipText;
            ch.options.plugins.tooltip.bodyColor = tc.tooltipText;
        }

        for (const axisKey of ['x', 'y']) {
            const scale = ch.options.scales && ch.options.scales[axisKey];
            if (!scale) continue;
            if (scale.ticks) scale.ticks.color = tc.tick;
            if (scale.grid) scale.grid.color = axisKey === 'x' ? 'transparent' : tc.grid;
            if (scale.title) scale.title.color = tc.tick;
        }

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

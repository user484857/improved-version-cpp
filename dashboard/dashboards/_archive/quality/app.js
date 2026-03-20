/**
 * Quality Binning Dashboard
 * Battery cell grading visualization — maps color sorting to industrial quality grading.
 *
 * Grade A (gold)   = White sensor 250-300 = EV/Racing applications, premium, 2000+ cycles
 * Grade B (orange) = Red sensor 130-190   = Stationary storage, mid-tier, 500-1000 cycles
 * Grade C (grey)   = Blue sensor 40-60    = Consumer electronics, budget, <100 cycles
 */

const GRADE_COLORS = { A: '#FFD60A', B: '#FF9F0A', C: '#8E8E93' };
const GRADE_LABELS = { A: 'Grade A — EV/Racing', B: 'Grade B — Stationary Storage', C: 'Grade C — Consumer Electronics' };

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

// ============================================
//  Settings Panel
// ============================================

function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    const overlay = document.getElementById('settings-overlay');
    const btn = document.querySelector('.settings-toggle');
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
        panel.classList.remove('open');
        overlay.classList.remove('visible');
        if (btn) btn.classList.remove('active');
    } else {
        panel.classList.add('open');
        overlay.classList.add('visible');
        if (btn) btn.classList.add('active');
    }
}

function setDataMode(mode) {
    if (mode === 'live' || mode === 'history') return;
    localStorage.setItem('dataMode', mode);
    applyDataModeUI(mode);
    showSettingsToast('Data source: ' + mode.charAt(0).toUpperCase() + mode.slice(1));
}

function setAudienceProfile(profile) {
    localStorage.setItem('audienceProfile', profile);
    applyAudienceProfileUI(profile);
    applyNavVisibility(profile);
    showSettingsToast('Profile: ' + profile.charAt(0).toUpperCase() + profile.slice(1));
}

function applyDataModeUI(mode) {
    var group = document.getElementById('data-mode-group');
    if (!group) return;
    group.querySelectorAll('.toggle-option').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
}

function applyAudienceProfileUI(profile) {
    var group = document.getElementById('audience-profile-group');
    if (!group) return;
    group.querySelectorAll('.toggle-option').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-profile') === profile);
    });
}

function applyNavVisibility(profile) {
    var nav = document.querySelector('.dash-nav');
    if (!nav) return;
    nav.querySelectorAll('a').forEach(function(link) {
        var href = link.getAttribute('href');
        if (profile === 'management' && (href === '/twin' || href === '/quality')) {
            link.classList.add('nav-hidden');
        } else {
            link.classList.remove('nav-hidden');
        }
    });
}

function showSettingsToast(message) {
    var toast = document.getElementById('settings-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() { toast.classList.remove('visible'); }, 2000);
}

function initSettings() {
    var mode = localStorage.getItem('dataMode') || 'demo';
    var profile = localStorage.getItem('audienceProfile') || 'engineer';
    applyDataModeUI(mode);
    applyAudienceProfileUI(profile);
    applyNavVisibility(profile);
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
        bandAlpha:   dark ? '0.06'                    : '0.08',
    };
}

// ============================================
//  Chart instances
// ============================================

let chartDonut = null;
let chartHistogram = null;
let chartTemp = null;
let chartScatter = null;
let chartSpcBell = null;
let chartDriftBurn = null;
let chartDriftColor = null;

// SPC state
let spcData = null;
let driftData = null;
let spcSelectedParam = 'burn_time';

// ============================================
//  Data fetch + init
// ============================================

async function init() {
    initSettings();
    const [gradesData, tempData, spcResp, driftResp] = await Promise.all([
        fetchJSON('/api/analytics/quality-grades'),
        fetchJSON('/api/analytics/temperature'),
        fetchJSON('/api/analytics/spc'),
        fetchJSON('/api/analytics/drift'),
    ]);

    if (!gradesData || gradesData.length === 0) {
        showEmpty();
        return;
    }

    spcData = spcResp;
    driftData = driftResp;

    renderKPIs(gradesData);
    renderDonut(gradesData);
    renderHistogram(gradesData);
    renderTempCurves(tempData, gradesData);
    renderScatter(gradesData);
    renderSPC();
    renderDrift();
    initSPCSelector();
    renderTable(gradesData);
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
        '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 20 20" fill="currentColor">' +
        '<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/>' +
        '</svg><span>No quality data available yet. Run a battery cell testing cycle to generate grading data.</span></div>'
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
//  1. KPI Tiles
// ============================================

function renderKPIs(grades) {
    const total = grades.length;
    const gradeA = grades.filter(g => g.grade === 'A').length;
    const fpy = total > 0 ? ((gradeA / total) * 100).toFixed(1) : '0.0';

    const avgBurn = total > 0
        ? (grades.reduce((s, g) => s + (g.burn_time || 0), 0) / total).toFixed(2)
        : '--';

    const avgPeak = total > 0
        ? (grades.reduce((s, g) => s + (g.peak_temp || 0), 0) / total).toFixed(1)
        : '--';

    document.getElementById('kpi-fpy').textContent = fpy + '%';
    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-burn-time').textContent = avgBurn + ' s';
    document.getElementById('kpi-peak-temp').textContent = avgPeak + ' \u00B0C';
}

// ============================================
//  2. Quality Yield Donut
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
        const row = document.createElement('div');
        row.className = 'legend-row';
        row.innerHTML =
            '<span class="legend-swatch" style="background:' + GRADE_COLORS[grade] + '"></span>' +
            '<span class="legend-label">' + label + '</span>' +
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
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { display: false },
                tooltip: baseTooltip(),
            },
        },
    });
}

// ============================================
//  3. Grading Distribution Histogram
// ============================================

function renderHistogram(grades) {
    const bins = [
        { label: '0-50',    min: 0,   max: 50  },
        { label: '50-100',  min: 50,  max: 100 },
        { label: '100-150', min: 100, max: 150 },
        { label: '150-200', min: 150, max: 200 },
        { label: '200-250', min: 200, max: 250 },
        { label: '250-300', min: 250, max: 300 },
    ];

    const counts = bins.map(() => 0);
    grades.forEach(g => {
        const v = g.color_value;
        for (let i = 0; i < bins.length; i++) {
            if (v >= bins[i].min && v < bins[i].max) { counts[i]++; break; }
            if (i === bins.length - 1 && v >= bins[i].min && v <= bins[i].max) { counts[i]++; }
        }
    });

    // Bar colors: Blue for 0-100, Red for 100-220, Gold for 220-300
    const barColors = bins.map(b => {
        const mid = (b.min + b.max) / 2;
        if (mid < 100) return '#4A90D9';
        if (mid < 220) return '#E8534A';
        return '#FFD60A';
    });

    const tc = themeColors();
    const ctx = document.getElementById('chart-histogram').getContext('2d');

    // Annotation plugin for dashed boundary lines
    const boundaryPlugin = {
        id: 'gradeBoundaries',
        afterDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            const xScale = scales.x;
            if (!xScale || !chartArea) return;

            const boundaries = [
                { index: 2, label: 'Grade C | B' },
                { index: 4.35, label: 'Grade B | A' },
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

    chartHistogram = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: bins.map(b => b.label),
            datasets: [{
                label: 'Count',
                data: counts,
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
                tooltip: baseTooltip(),
            },
            scales: {
                x: {
                    ...baseScale('x'),
                    title: { display: true, text: 'Color Sensor Value', color: tc.tick, font: { family: 'Inter', size: 11, weight: '500' } },
                },
                y: {
                    ...baseScale('y'),
                    beginAtZero: true,
                    title: { display: true, text: 'Count', color: tc.tick, font: { family: 'Inter', size: 11, weight: '500' } },
                },
            },
        },
        plugins: [boundaryPlugin],
    });
}

// ============================================
//  4. Temperature Curves
// ============================================

function renderTempCurves(tempData, gradesData) {
    if (!tempData || tempData.length === 0) return;

    // Build a run->grade lookup
    const gradeMap = {};
    gradesData.forEach(g => { gradeMap[g.run] = g.grade; });

    // Take the last 5 runs
    const lastRuns = tempData.slice(-5);

    const datasets = lastRuns.map((run, i) => {
        const grade = gradeMap[run.run] || 'C';
        const color = GRADE_COLORS[grade] || GRADE_COLORS.C;
        return {
            label: 'Run ' + run.run + ' (' + grade + ')',
            data: run.t.map((t, j) => ({ x: t, y: run.T[j] })),
            borderColor: color,
            backgroundColor: color + '18',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
        };
    });

    const tc = themeColors();
    const ctx = document.getElementById('chart-temp').getContext('2d');

    // Reference line plugin for target temp
    const refLinePlugin = {
        id: 'tempRefLine',
        afterDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            if (!scales.y || !chartArea) return;
            const y = scales.y.getPixelForValue(180);
            if (y < chartArea.top || y > chartArea.bottom) return;

            c.save();
            c.setLineDash([6, 4]);
            c.lineWidth = 1;
            c.strokeStyle = themeColors().refLine;
            c.beginPath();
            c.moveTo(chartArea.left, y);
            c.lineTo(chartArea.right, y);
            c.stroke();

            c.fillStyle = themeColors().tick;
            c.font = "10px 'SF Mono', monospace";
            c.textAlign = 'left';
            c.fillText('Target 180 \u00B0C', chartArea.left + 4, y - 6);
            c.restore();
        },
    };

    chartTemp = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: tc.tick,
                        font: { family: 'Inter', size: 10 },
                        boxWidth: 10,
                        boxHeight: 2,
                        padding: 12,
                        usePointStyle: false,
                    },
                },
                tooltip: baseTooltip(),
            },
            scales: {
                x: {
                    type: 'linear',
                    ...baseScale('x'),
                    title: { display: true, text: 'Time (s)', color: tc.tick, font: { family: 'Inter', size: 11, weight: '500' } },
                },
                y: {
                    ...baseScale('y'),
                    title: { display: true, text: 'Temperature (\u00B0C)', color: tc.tick, font: { family: 'Inter', size: 11, weight: '500' } },
                },
            },
        },
        plugins: [refLinePlugin],
    });
}

// ============================================
//  5. Burn Time vs Grade Scatter
// ============================================

function renderScatter(grades) {
    // Group points by grade
    const datasets = ['A', 'B', 'C'].map(grade => ({
        label: GRADE_LABELS[grade],
        data: grades
            .filter(g => g.grade === grade)
            .map(g => ({ x: g.burn_time, y: g.color_value })),
        backgroundColor: GRADE_COLORS[grade] + 'BB',
        borderColor: GRADE_COLORS[grade],
        borderWidth: 1,
        pointRadius: 8,
        pointHoverRadius: 10,
    }));

    const tc = themeColors();

    // Band drawing plugin
    const bandPlugin = {
        id: 'gradeBands',
        beforeDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            if (!scales.y || !chartArea) return;

            c.save();
            const bands = [
                { yMin: 40,  yMax: 60,  color: GRADE_COLORS.C },
                { yMin: 130, yMax: 190, color: GRADE_COLORS.B },
                { yMin: 250, yMax: 300, color: GRADE_COLORS.A },
            ];
            const alpha = isDark() ? 0.06 : 0.08;

            for (const band of bands) {
                const top = Math.max(scales.y.getPixelForValue(band.yMax), chartArea.top);
                const bottom = Math.min(scales.y.getPixelForValue(band.yMin), chartArea.bottom);
                if (top >= chartArea.bottom || bottom <= chartArea.top) continue;

                c.fillStyle = band.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
                c.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
            }
            c.restore();
        },
    };

    const ctx = document.getElementById('chart-scatter').getContext('2d');
    chartScatter = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
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
                        padding: 12,
                        usePointStyle: true,
                    },
                },
                tooltip: {
                    ...baseTooltip(),
                    callbacks: {
                        label(ctx) {
                            return ctx.dataset.label + ': Chamber=' + ctx.parsed.x.toFixed(2) + 's, Sensor=' + ctx.parsed.y;
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
                    min: 0,
                    max: 320,
                    title: { display: true, text: 'Color Sensor Value', color: tc.tick, font: { family: 'Inter', size: 11, weight: '500' } },
                },
            },
        },
        plugins: [bandPlugin],
    });
}

// ============================================
//  6. Traceability Table
// ============================================

let tableExpanded = false;

function renderTable(grades) {
    const sorted = [...grades].sort((a, b) => b.run - a.run);
    const tbody = document.getElementById('trace-tbody');
    const countEl = document.getElementById('table-count');

    if (countEl) countEl.textContent = sorted.length + ' records';

    const display = tableExpanded ? sorted : sorted.slice(0, 3);

    tbody.innerHTML = display.map(g => {
        const ts = g.timestamp ? new Date(g.timestamp).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }) : '--';
        return '<tr>' +
            '<td>' + g.run + '</td>' +
            '<td>' + (g.burn_time != null ? g.burn_time.toFixed(2) : '--') + '</td>' +
            '<td>' + (g.peak_temp != null ? g.peak_temp.toFixed(1) + ' \u00B0C' : '--') + '</td>' +
            '<td>' + (g.color_value != null ? g.color_value : '--') + '</td>' +
            '<td><span class="grade-badge grade-badge-' + g.grade + '">Grade ' + g.grade + '</span></td>' +
            '<td>' + ts + '</td>' +
            '</tr>';
    }).join('');

    // Show more button
    const existingBtn = document.getElementById('table-show-more');
    if (existingBtn) existingBtn.remove();

    if (!tableExpanded && sorted.length > 3) {
        const btn = document.createElement('button');
        btn.id = 'table-show-more';
        btn.className = 'show-more-btn';
        btn.textContent = 'Show all ' + sorted.length + ' records';
        btn.onclick = function() {
            tableExpanded = true;
            renderTable(grades);
        };
        const tableCard = tbody.closest('.card-body');
        if (tableCard) tableCard.appendChild(btn);
    }
}

// Store grades globally for re-render
let _allGrades = null;

// ============================================
//  8. SPC Metrics (Cp/Cpk + Bell Curve)
// ============================================

function initSPCSelector() {
    // Only burn_time Cpk is shown (color_sensor_value Cpk removed as statistically
    // meaningless across 3 disjoint populations). No selector needed.
    spcSelectedParam = 'burn_time';
}

function cpkColorClass(cpk) {
    if (cpk === null || cpk === undefined) return '';
    if (cpk >= 1.33) return 'cpk-green';
    if (cpk >= 1.0) return 'cpk-orange';
    return 'cpk-red';
}

function cpkStatusText(cpk) {
    if (cpk === null || cpk === undefined) return '';
    if (cpk >= 1.33) return 'Capable';
    if (cpk >= 1.0) return 'Marginal';
    return 'Not Capable';
}

function renderSPC() {
    if (!spcData) return;
    const d = spcData[spcSelectedParam];
    if (!d) return;

    // Update metric values
    const cpEl = document.getElementById('spc-cp');
    const cpkEl = document.getElementById('spc-cpk');
    const meanEl = document.getElementById('spc-mean');
    const sigmaEl = document.getElementById('spc-sigma');
    const cpDesc = document.getElementById('spc-cp-desc');
    const cpkDesc = document.getElementById('spc-cpk-desc');

    cpEl.textContent = d.Cp != null ? d.Cp.toFixed(2) : '--';
    cpkEl.textContent = d.Cpk != null ? d.Cpk.toFixed(2) : '--';
    meanEl.textContent = d.mean != null ? d.mean.toFixed(3) + (d.unit ? ' ' + d.unit : '') : '--';
    sigmaEl.textContent = d.sigma != null ? d.sigma.toFixed(4) : '--';

    // Color coding for Cpk
    cpkEl.className = 'spc-metric-value mono ' + cpkColorClass(d.Cpk);
    cpkDesc.textContent = cpkStatusText(d.Cpk) || 'Centered Capability';
    cpDesc.textContent = 'Process Capability';

    // Render bell curve
    renderBellCurve(d);
}

function renderBellCurve(d) {
    if (chartSpcBell) chartSpcBell.destroy();
    if (d.mean == null || d.sigma == null || d.sigma === 0) return;

    const mean = d.mean;
    const sigma = d.sigma;
    const lsl = d.LSL;
    const usl = d.USL;

    // Generate normal distribution points
    const xMin = mean - 4 * sigma;
    const xMax = mean + 4 * sigma;
    const step = (xMax - xMin) / 100;
    const points = [];
    const invSqrt2Pi = 1 / (sigma * Math.sqrt(2 * Math.PI));

    for (let x = xMin; x <= xMax; x += step) {
        const z = (x - mean) / sigma;
        const y = invSqrt2Pi * Math.exp(-0.5 * z * z);
        points.push({ x: parseFloat(x.toFixed(4)), y: parseFloat(y.toFixed(6)) });
    }

    const tc = themeColors();
    const ctx = document.getElementById('chart-spc-bell').getContext('2d');

    // Plugin to draw LSL/USL lines and shaded tails
    const specLinesPlugin = {
        id: 'spcSpecLines',
        beforeDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            if (!scales.x || !scales.y || !chartArea) return;

            c.save();
            // Shade areas outside spec limits
            const lslPx = scales.x.getPixelForValue(lsl);
            const uslPx = scales.x.getPixelForValue(usl);
            const alpha = isDark() ? 0.08 : 0.10;

            // Left tail (below LSL)
            if (lslPx > chartArea.left) {
                c.fillStyle = 'rgba(255, 69, 58, ' + alpha + ')';
                c.fillRect(chartArea.left, chartArea.top, lslPx - chartArea.left, chartArea.bottom - chartArea.top);
            }

            // Right tail (above USL)
            if (uslPx < chartArea.right) {
                c.fillStyle = 'rgba(255, 69, 58, ' + alpha + ')';
                c.fillRect(uslPx, chartArea.top, chartArea.right - uslPx, chartArea.bottom - chartArea.top);
            }

            c.restore();
        },
        afterDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            if (!scales.x || !scales.y || !chartArea) return;

            c.save();
            const lslPx = scales.x.getPixelForValue(lsl);
            const uslPx = scales.x.getPixelForValue(usl);
            const meanPx = scales.x.getPixelForValue(mean);

            // LSL line
            c.setLineDash([5, 4]);
            c.lineWidth = 1.5;
            c.strokeStyle = '#FF453A';
            c.beginPath();
            c.moveTo(lslPx, chartArea.top);
            c.lineTo(lslPx, chartArea.bottom);
            c.stroke();

            // USL line
            c.beginPath();
            c.moveTo(uslPx, chartArea.top);
            c.lineTo(uslPx, chartArea.bottom);
            c.stroke();

            // Mean line
            c.strokeStyle = '#007AFF';
            c.setLineDash([3, 3]);
            c.beginPath();
            c.moveTo(meanPx, chartArea.top);
            c.lineTo(meanPx, chartArea.bottom);
            c.stroke();

            // Labels
            c.setLineDash([]);
            c.font = "10px 'SF Mono', monospace";
            c.textAlign = 'center';
            c.fillStyle = '#FF453A';
            c.fillText('LSL ' + lsl, lslPx, chartArea.top - 6);
            c.fillText('USL ' + usl, uslPx, chartArea.top - 6);
            c.fillStyle = '#007AFF';
            c.fillText('\u03BC ' + mean.toFixed(2), meanPx, chartArea.bottom + 14);

            c.restore();
        },
    };

    chartSpcBell = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Normal Distribution',
                data: points,
                borderColor: '#007AFF',
                backgroundColor: 'rgba(0, 122, 255, 0.08)',
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.4,
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
                        label(ctx) {
                            return 'x=' + ctx.parsed.x.toFixed(3) + ', density=' + ctx.parsed.y.toFixed(4);
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    ...baseScale('x'),
                    min: Math.min(lsl - sigma, xMin),
                    max: Math.max(usl + sigma, xMax),
                    title: { display: true, text: spcSelectedParam === 'burn_time' ? 'Burn Time (s)' : 'Color Sensor Value', color: tc.tick, font: { family: 'Inter', size: 11, weight: '500' } },
                },
                y: {
                    ...baseScale('y'),
                    display: false,
                },
            },
            layout: {
                padding: { top: 16, bottom: 4 },
            },
        },
        plugins: [specLinesPlugin],
    });
}

// ============================================
//  9. Process Drift Detection
// ============================================

function renderDrift() {
    if (!driftData) return;

    renderDriftParam('burn_time', 'chart-drift-burn', 'drift-burn-arrow', 'drift-burn-summary');
    renderDriftParam('color_sensor_value', 'chart-drift-color', 'drift-color-arrow', 'drift-color-summary');
}

function renderDriftParam(param, canvasId, arrowId, summaryId) {
    const d = driftData[param];
    const arrowEl = document.getElementById(arrowId);
    const summaryEl = document.getElementById(summaryId);

    if (!d || d.trend === 'insufficient_data') {
        arrowEl.textContent = '--';
        arrowEl.className = 'drift-arrow';
        summaryEl.textContent = 'Insufficient data';
        return;
    }

    // Arrow indicator
    const arrows = { improving: '\u2193', degrading: '\u2191', stable: '\u2192' };
    const arrowClasses = { improving: 'drift-arrow drift-improving', degrading: 'drift-arrow drift-degrading', stable: 'drift-arrow drift-stable' };
    arrowEl.textContent = arrows[d.trend] || '\u2192';
    arrowEl.className = arrowClasses[d.trend] || 'drift-arrow';

    // Summary text
    const paramLabel = param === 'burn_time' ? 'Burn time' : 'Color sensor';
    const shiftDir = d.mean_shift >= 0 ? '+' : '';
    const shiftVal = param === 'burn_time'
        ? shiftDir + d.mean_shift.toFixed(3) + 's'
        : shiftDir + d.mean_shift.toFixed(1);
    summaryEl.textContent = paramLabel + ' mean shifted ' + shiftVal + ' (' + d.trend + ')';

    // Render bar chart
    const tc = themeColors();
    const ctx = document.getElementById(canvasId).getContext('2d');

    const existing = param === 'burn_time' ? chartDriftBurn : chartDriftColor;
    if (existing) existing.destroy();

    const barColors = {
        improving: ['#30D158CC', '#30D158'],
        degrading: ['#FF453ACC', '#FF453A'],
        stable:    ['#007AFFCC', '#007AFF'],
    };
    const colors = barColors[d.trend] || barColors.stable;

    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['First Half', 'Second Half'],
            datasets: [
                {
                    label: 'Mean',
                    data: [d.first_half_mean, d.second_half_mean],
                    backgroundColor: [colors[0], colors[0]],
                    borderColor: [colors[1], colors[1]],
                    borderWidth: 1,
                    borderRadius: 4,
                    maxBarThickness: 40,
                },
                {
                    label: 'Sigma',
                    data: [d.first_half_sigma, d.second_half_sigma],
                    backgroundColor: [tc.tick, tc.tick],
                    borderColor: [tc.tick, tc.tick],
                    borderWidth: 0,
                    borderRadius: 4,
                    maxBarThickness: 20,
                    hidden: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...baseTooltip(),
                    callbacks: {
                        label(ctx) {
                            return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(3) + (d.unit ? ' ' + d.unit : '');
                        },
                    },
                },
            },
            scales: {
                x: {
                    ...baseScale('x'),
                    grid: { display: false },
                },
                y: {
                    ...baseScale('y'),
                    beginAtZero: false,
                    title: { display: false },
                    ticks: {
                        color: tc.tick,
                        font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 9 },
                        maxTicksLimit: 4,
                    },
                },
            },
        },
    });

    if (param === 'burn_time') chartDriftBurn = chart;
    else chartDriftColor = chart;
}

// ============================================
//  Theme updates for all charts
// ============================================

function updateAllChartThemes() {
    const tc = themeColors();
    const charts = [chartDonut, chartHistogram, chartTemp, chartScatter, chartSpcBell, chartDriftBurn, chartDriftColor];

    for (const ch of charts) {
        if (!ch) continue;

        // Update tooltip
        if (ch.options.plugins && ch.options.plugins.tooltip) {
            ch.options.plugins.tooltip.backgroundColor = tc.tooltipBg;
            ch.options.plugins.tooltip.borderColor = tc.tooltipBdr;
            ch.options.plugins.tooltip.titleColor = tc.tooltipText;
            ch.options.plugins.tooltip.bodyColor = tc.tooltipText;
        }

        // Update scales
        for (const axisKey of ['x', 'y']) {
            const scale = ch.options.scales && ch.options.scales[axisKey];
            if (!scale) continue;
            if (scale.ticks) scale.ticks.color = tc.tick;
            if (scale.grid) scale.grid.color = axisKey === 'x' ? 'transparent' : tc.grid;
            if (scale.title) scale.title.color = tc.tick;
        }

        // Update legend colors
        if (ch.options.plugins && ch.options.plugins.legend && ch.options.plugins.legend.labels) {
            ch.options.plugins.legend.labels.color = tc.tick;
        }

        ch.update('none');
    }
}

// ============================================
//  Collapsible Sections
// ============================================

function toggleCollapsible(headerEl) {
    const body = headerEl.nextElementSibling;
    if (!body || !body.classList.contains('collapsible-body')) return;
    const isExpanded = body.classList.contains('expanded');
    if (isExpanded) {
        body.classList.remove('expanded');
        headerEl.classList.remove('expanded');
    } else {
        body.classList.add('expanded');
        headerEl.classList.add('expanded');
    }
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

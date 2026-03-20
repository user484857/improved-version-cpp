/* ============================================
   Combined Dashboard B — 2-Column Sidebar Layout
   Fetches analytics API, renders:
   - KPI cards (sidebar)
   - Station status cards (sidebar)
   - Digital Twin SVG (main)
   - Timing pills (main)
   - Quality scatter chart (main)
   - Stacked cycle time bars (main)
   ============================================ */

// -- Station constants (NO PM) ----------------------------------------

const STATIONS = [
    { key: 'HBW',   name: 'HBW',   fullName: 'High-Bay Warehouse', target: 10, color: '#AF52DE' },
    { key: 'Crane', name: 'Crane', fullName: 'Transport Crane',     target: 12, color: '#30D158' },
    { key: 'MS',    name: 'MS',    fullName: 'Machining Station',   target: 18, color: '#007AFF' },
    { key: 'SL',    name: 'SL',    fullName: 'Sorting Line',        target: 5,  color: '#FF9F0A' },
];

const TOTAL_TARGET = 45;

const GRADE_COLORS = { A: '#f0f0f0', B: '#FF453A', C: '#007AFF' };

const REFRESH_MS = 8000;

// -- State ------------------------------------------------------------

let scatterChart = null;
let lastCycleData = null;
let lastQualityData = null;
let lastThroughputData = null;
let lastSummaryData = null;

// Live polling state
let liveData = null;
let lastFetchTs = 0;
let activeStep = -1;
let prevStep = -1;
let currentMode = 'live';

// -- Theme toggle -----------------------------------------------------

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);

    // Update icons
    const moon = document.querySelector('.icon-moon');
    const sun = document.querySelector('.icon-sun');
    if (moon && sun) {
        moon.style.display = next === 'dark' ? 'block' : 'none';
        sun.style.display = next === 'light' ? 'block' : 'none';
    }

    // Redraw charts with new theme colors
    if (scatterChart) {
        updateScatterColors();
        scatterChart.update('none');
    }
}

function getThemeColors() {
    const s = getComputedStyle(document.documentElement);
    return {
        text: s.getPropertyValue('--text-primary').trim(),
        textSec: s.getPropertyValue('--text-secondary').trim(),
        textTer: s.getPropertyValue('--text-tertiary').trim(),
        grid: s.getPropertyValue('--chart-grid').trim(),
        tick: s.getPropertyValue('--chart-tick').trim(),
    };
}

// -- Clock ------------------------------------------------------------

function updateClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-GB');
}

// -- API fetch helpers ------------------------------------------------

async function fetchJSON(url) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        return null;
    }
}

// -- KPI Cards --------------------------------------------------------

function renderKPIs(cycleData, throughputData, summaryData) {
    // Avg cycle time
    const cycleVal = document.getElementById('kpi-cycle-val');
    const cycleTrend = document.getElementById('kpi-cycle-trend');
    if (cycleData && cycleData.length > 0) {
        const totals = cycleData.filter(r => r.total != null).map(r => r.total);
        if (totals.length > 0) {
            const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
            cycleVal.textContent = avg.toFixed(1) + 's';

            // Trend: compare last 3 vs first 3
            if (totals.length >= 6) {
                const first3 = totals.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
                const last3 = totals.slice(-3).reduce((a, b) => a + b, 0) / 3;
                const diff = last3 - first3;
                if (diff < -1) {
                    cycleTrend.className = 'kpi-card-trend up';
                    cycleTrend.textContent = diff.toFixed(1) + 's faster';
                } else if (diff > 1) {
                    cycleTrend.className = 'kpi-card-trend down';
                    cycleTrend.textContent = '+' + diff.toFixed(1) + 's slower';
                } else {
                    cycleTrend.className = 'kpi-card-trend neutral';
                    cycleTrend.textContent = 'Stable';
                }
            } else {
                cycleTrend.className = 'kpi-card-trend neutral';
                cycleTrend.textContent = totals.length + ' runs';
            }

            // Color the KPI accent based on vs target
            const card = document.getElementById('kpi-cycle');
            card.classList.remove('kpi-green', 'kpi-orange', 'kpi-purple');
            if (avg <= TOTAL_TARGET * 1.1) card.classList.add('kpi-green');
            else if (avg <= TOTAL_TARGET * 1.3) card.classList.add('kpi-orange');
        }
    }

    // Throughput
    const tpVal = document.getElementById('kpi-tp-val');
    const tpTrend = document.getElementById('kpi-tp-trend');
    if (throughputData) {
        tpVal.textContent = throughputData.per_hour != null
            ? throughputData.per_hour.toFixed(1)
            : '--';
        if (throughputData.theoretical_max) {
            const pct = ((throughputData.per_hour / throughputData.theoretical_max) * 100).toFixed(0);
            tpTrend.className = 'kpi-card-trend neutral';
            tpTrend.textContent = pct + '% of theoretical max';
        }
    }

    // Uptime
    const uptimeVal = document.getElementById('kpi-uptime-val');
    const uptimeTrend = document.getElementById('kpi-uptime-trend');
    if (throughputData && throughputData.total_time_min != null) {
        const totalMin = throughputData.total_time_min;
        const hrs = Math.floor(totalMin / 60);
        const mins = Math.round(totalMin % 60);
        if (hrs > 0) {
            uptimeVal.textContent = hrs + 'h ' + mins + 'm';
        } else {
            uptimeVal.textContent = mins + 'm';
        }
        uptimeTrend.className = 'kpi-card-trend neutral';
        uptimeTrend.textContent = (throughputData.total_runs || 0) + ' total runs';
    }
}

// -- Station Status Cards ---------------------------------------------

function renderStationCards(cycleData) {
    const container = document.getElementById('station-cards');
    if (!container || !cycleData || cycleData.length === 0) return;

    // Compute per-station averages
    const avgs = {};
    const lastVals = {};
    for (const stn of STATIONS) {
        const times = cycleData
            .map(r => r.stations?.[stn.key])
            .filter(v => v != null);
        avgs[stn.key] = times.length > 0
            ? times.reduce((a, b) => a + b, 0) / times.length
            : null;
        lastVals[stn.key] = times.length > 0 ? times[times.length - 1] : null;
    }

    let html = '';
    for (const stn of STATIONS) {
        const avg = avgs[stn.key];
        const last = lastVals[stn.key];
        const display = avg != null ? avg.toFixed(1) + 's' : '--';

        // Traffic light
        let dotClass = 'traffic-grey';
        if (avg != null) {
            const ratio = avg / stn.target;
            if (ratio <= 1.15) dotClass = 'traffic-green';
            else if (ratio <= 1.5) dotClass = 'traffic-orange';
            else dotClass = 'traffic-red';
        }

        // Target comparison
        let targetText = 'Target: ' + stn.target + 's';
        if (avg != null) {
            const diff = avg - stn.target;
            if (diff > 0.5) {
                targetText += '  (+' + diff.toFixed(1) + 's)';
            } else if (diff < -0.5) {
                targetText += '  (' + diff.toFixed(1) + 's)';
            } else {
                targetText += '  (on target)';
            }
        }

        html += '<div class="station-mini-card glass">'
            + '<div class="station-mini-accent" style="background:' + stn.color + '"></div>'
            + '<div class="station-mini-info">'
            + '<div class="station-mini-name">' + stn.fullName + '</div>'
            + '<div class="station-mini-time mono">' + display + '</div>'
            + '<div class="station-mini-target">' + targetText + '</div>'
            + '</div>'
            + '<div class="station-mini-dot ' + dotClass + '"></div>'
            + '</div>';
    }

    container.innerHTML = html;
}

// -- Timing Pills (below Digital Twin) --------------------------------

function renderTimingPills(cycleData) {
    const container = document.getElementById('timing-row');
    if (!container || !cycleData || cycleData.length === 0) return;

    // Use the last run for "last" values, compute averages
    const lastRun = cycleData[cycleData.length - 1];

    // The pills map logical stations: HBW, Crane, Oven (=MS), SL-Color, SL-Sort, Total
    const pills = [
        { id: 'hbw',   name: 'HBW',   key: 'HBW',   target: 10 },
        { id: 'crane', name: 'Crane', key: 'Crane', target: 12 },
        { id: 'oven',  name: 'MS',    key: 'MS',    target: 18 },
        { id: 'sl',    name: 'SL',    key: 'SL',    target: 5 },
    ];

    let html = '';
    for (const pill of pills) {
        const lastVal = lastRun.stations?.[pill.key];
        const allVals = cycleData
            .map(r => r.stations?.[pill.key])
            .filter(v => v != null);
        const avg = allVals.length > 0
            ? allVals.reduce((a, b) => a + b, 0) / allVals.length
            : null;

        // Traffic light for pill dot
        let dotClass = 'pill-dot';
        if (avg != null) {
            const ratio = avg / pill.target;
            if (ratio <= 1.15) dotClass += ' tl-green';
            else if (ratio <= 1.5) dotClass += ' tl-orange';
            else dotClass += ' tl-red';
        }

        html += '<div class="timing-pill glass">'
            + '<div class="pill-head">'
            + '<span class="' + dotClass + '"></span>'
            + '<span class="pill-name">' + pill.name + '</span>'
            + '</div>'
            + '<span class="pill-last mono">' + (lastVal != null ? lastVal.toFixed(1) + 's' : '--') + '</span>'
            + '<span class="pill-avg">' + (avg != null ? '\u00F8 ' + avg.toFixed(1) + 's' : '') + '</span>'
            + '</div>';
    }

    // Total pill
    const lastTotal = lastRun.total;
    const allTotals = cycleData.filter(r => r.total != null).map(r => r.total);
    const avgTotal = allTotals.length > 0
        ? allTotals.reduce((a, b) => a + b, 0) / allTotals.length
        : null;

    html += '<div class="timing-pill glass">'
        + '<div class="pill-head">'
        + '<span class="pill-name" style="font-weight:700">Total</span>'
        + '</div>'
        + '<span class="pill-last mono">' + (lastTotal != null ? lastTotal.toFixed(1) + 's' : '--') + '</span>'
        + '<span class="pill-avg">' + (avgTotal != null ? '\u00F8 ' + avgTotal.toFixed(1) + 's' : '') + '</span>'
        + '</div>';

    container.innerHTML = html;
}

// -- Quality Scatter Chart --------------------------------------------

function initScatterChart() {
    const ctx = document.getElementById('scatter-chart');
    if (!ctx) return;

    const tc = getThemeColors();

    scatterChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Grade A (White)',
                    data: [],
                    backgroundColor: 'rgba(240,240,240,0.7)',
                    borderColor: 'rgba(240,240,240,0.9)',
                    borderWidth: 1,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                },
                {
                    label: 'Grade B (Red)',
                    data: [],
                    backgroundColor: 'rgba(255,69,58,0.6)',
                    borderColor: 'rgba(255,69,58,0.9)',
                    borderWidth: 1,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                },
                {
                    label: 'Grade C (Blue)',
                    data: [],
                    backgroundColor: 'rgba(0,122,255,0.6)',
                    borderColor: 'rgba(0,122,255,0.9)',
                    borderWidth: 1,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: tc.textSec,
                        font: { size: 11, family: 'Inter' },
                        padding: 14,
                        usePointStyle: true,
                        pointStyle: 'circle',
                    },
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { family: 'Inter', weight: '600' },
                    bodyFont: { family: 'SF Mono, monospace' },
                    callbacks: {
                        label: function(ctx) {
                            return 'Run #' + ctx.raw.x + '  Sensor: ' + ctx.raw.y;
                        }
                    }
                },
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Run #',
                        color: tc.textTer,
                        font: { size: 11, family: 'Inter', weight: '500' },
                    },
                    grid: { color: tc.grid },
                    ticks: { color: tc.tick, font: { size: 10, family: 'SF Mono, monospace' } },
                },
                y: {
                    title: {
                        display: true,
                        text: 'Color Sensor Value',
                        color: tc.textTer,
                        font: { size: 11, family: 'Inter', weight: '500' },
                    },
                    grid: { color: tc.grid },
                    ticks: { color: tc.tick, font: { size: 10, family: 'SF Mono, monospace' } },
                    min: 0,
                    max: 350,
                },
            },
        },
        plugins: [{
            id: 'gradeBands',
            beforeDraw: function(chart) {
                const ctx2 = chart.ctx;
                const yScale = chart.scales.y;
                const xArea = chart.chartArea;

                // Grade bands
                const bands = [
                    { min: 230, max: 320, color: 'rgba(240,240,240,0.04)', label: 'A' },
                    { min: 100, max: 210, color: 'rgba(255,69,58,0.04)', label: 'B' },
                    { min: 30,  max: 70,  color: 'rgba(0,122,255,0.04)', label: 'C' },
                ];

                for (const band of bands) {
                    const yTop = yScale.getPixelForValue(band.max);
                    const yBot = yScale.getPixelForValue(band.min);
                    ctx2.fillStyle = band.color;
                    ctx2.fillRect(xArea.left, yTop, xArea.right - xArea.left, yBot - yTop);

                    // Band label on right edge
                    ctx2.fillStyle = getComputedStyle(document.documentElement)
                        .getPropertyValue('--text-tertiary').trim();
                    ctx2.font = '600 10px "SF Mono", monospace';
                    ctx2.textAlign = 'right';
                    ctx2.fillText('Grade ' + band.label, xArea.right - 6, yTop + 12);
                }
            }
        }],
    });
}

function updateScatterColors() {
    if (!scatterChart) return;
    const tc = getThemeColors();
    scatterChart.options.plugins.legend.labels.color = tc.textSec;
    scatterChart.options.scales.x.title.color = tc.textTer;
    scatterChart.options.scales.x.grid.color = tc.grid;
    scatterChart.options.scales.x.ticks.color = tc.tick;
    scatterChart.options.scales.y.title.color = tc.textTer;
    scatterChart.options.scales.y.grid.color = tc.grid;
    scatterChart.options.scales.y.ticks.color = tc.tick;
}

function updateScatterData(qualityData) {
    if (!scatterChart || !qualityData) return;

    const gradeA = [];
    const gradeB = [];
    const gradeC = [];

    for (const q of qualityData) {
        if (q.color_value == null) continue;
        const point = { x: q.run, y: q.color_value };
        if (q.grade === 'A') gradeA.push(point);
        else if (q.grade === 'B') gradeB.push(point);
        else if (q.grade === 'C') gradeC.push(point);
        else {
            // Unknown grade, pick by value range
            if (q.color_value >= 230) gradeA.push(point);
            else if (q.color_value >= 100) gradeB.push(point);
            else if (q.color_value >= 30) gradeC.push(point);
            // Values < 30 are noise, skip
        }
    }

    scatterChart.data.datasets[0].data = gradeA;
    scatterChart.data.datasets[1].data = gradeB;
    scatterChart.data.datasets[2].data = gradeC;
    updateScatterColors();
    scatterChart.update('none');
}

// -- Stacked Cycle Time Bars ------------------------------------------

function renderStackedBars(cycleData) {
    const container = document.getElementById('stacked-bars');
    if (!container || !cycleData || cycleData.length === 0) return;

    // Show last 8 runs max
    const runs = cycleData.slice(-8);

    // Find max total for scaling
    let maxTotal = 0;
    for (const run of runs) {
        let sum = 0;
        for (const stn of STATIONS) {
            sum += run.stations?.[stn.key] || 0;
        }
        if (sum > maxTotal) maxTotal = sum;
    }
    if (maxTotal === 0) maxTotal = 1;

    let html = '<div class="stacked-container">';

    for (const run of runs) {
        let runTotal = 0;
        let segments = '';

        for (const stn of STATIONS) {
            const val = run.stations?.[stn.key] || 0;
            runTotal += val;
            const pct = (val / maxTotal) * 100;
            if (pct > 1) {
                segments += '<div class="stacked-segment" style="width:' + pct.toFixed(1) + '%;background:' + stn.color + '">'
                    + (pct > 8 ? val.toFixed(1) : '')
                    + '</div>';
            }
        }

        const gapClass = runTotal > TOTAL_TARGET ? 'gap-over' : 'gap-ok';
        const gapText = runTotal > TOTAL_TARGET
            ? '+' + (runTotal - TOTAL_TARGET).toFixed(1)
            : (runTotal - TOTAL_TARGET).toFixed(1);

        html += '<div class="stacked-row">'
            + '<span class="stacked-label">R' + run.run + '</span>'
            + '<div class="stacked-bar-track">' + segments + '</div>'
            + '<span class="stacked-total"><span class="' + gapClass + '">' + runTotal.toFixed(1) + 's</span></span>'
            + '</div>';
    }

    // Legend
    html += '<div class="stacked-legend">';
    for (const stn of STATIONS) {
        html += '<div class="stacked-legend-item">'
            + '<div class="stacked-legend-dot" style="background:' + stn.color + '"></div>'
            + stn.name
            + '</div>';
    }
    html += '<div class="stacked-legend-item">'
        + '<div class="stacked-legend-dot" style="background:var(--text-tertiary)"></div>'
        + 'Target: ' + TOTAL_TARGET + 's'
        + '</div>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
}

// -- Live Digital Twin Polling ----------------------------------------

function isOn(stn, group, label) {
    const v = stn?.[group]?.[label];
    return v === true || v === 'True';
}

function anyActuator(stn) {
    const a = stn?.actuators;
    if (!a) return false;
    for (const k in a) if (a[k] === true || a[k] === 'True') return true;
    return false;
}

function detectStep(data) {
    if (!data) return -1;
    const hbw = data.HBW || {}, crane = data.Crane || {}, ms = data.MS || {}, sl = data.SL || {};

    if (isOn(sl, 'actuators', 'Valve Blue') || isOn(sl, 'actuators', 'Valve Red') || isOn(sl, 'actuators', 'Valve White')) return 5;
    if (isOn(sl, 'actuators', 'Conveyor Belt') || isOn(sl, 'actuators', 'Motor Conveyor Belt')) return 4;
    if (isOn(sl, 'actuators', 'Compressor') && !anyActuator(crane)) return 4;
    if (isOn(ms, 'actuators', 'Lamp')) return 2;
    if (isOn(ms, 'actuators', 'Oven Slider In') || isOn(ms, 'actuators', 'Motor Oven Slider Move In') ||
        isOn(ms, 'actuators', 'Ovendoor') || isOn(ms, 'actuators', 'Valve Ovendoor') ||
        isOn(ms, 'actuators', 'Transfer To Oven') || isOn(ms, 'actuators', 'Motor Transfer Unit → Oven') ||
        isOn(ms, 'actuators', 'Oven Slider Out') || isOn(ms, 'actuators', 'Motor Oven Slider Move Out')) return 2;
    if (isOn(ms, 'actuators', 'Saw') || isOn(ms, 'actuators', 'Motor Saw') ||
        isOn(ms, 'actuators', 'Ejector Valve') || isOn(ms, 'actuators', 'Valve Ejector')) return 3;
    if (isOn(ms, 'actuators', 'Conveyor Fwd') || isOn(ms, 'actuators', 'Motor Conveyor Belt Forward') ||
        isOn(ms, 'actuators', 'Turntable CW') || isOn(ms, 'actuators', 'Motor Turntable Clockwise') ||
        isOn(ms, 'actuators', 'Turntable CCW') || isOn(ms, 'actuators', 'Motor Turntable Counterclockwise') ||
        isOn(ms, 'actuators', 'Transfer To Turntable') || isOn(ms, 'actuators', 'Motor Transfer Unit → Turntable')) return 2;
    if (isOn(ms, 'actuators', 'Compressor') && !anyActuator(crane)) return 2;
    if (anyActuator(crane)) {
        if (activeStep >= 5) return 6;
        if (activeStep <= 1 || activeStep === -1) return 1;
        if (activeStep >= 3) return 6;
        return 1;
    }
    if (anyActuator(hbw)) {
        if (activeStep >= 6) return 7;
        return 0;
    }
    return -1;
}

function updateTwinFromLive(step, data) {
    const STEP_STNS = ['stn-hbw', 'stn-crane', 'stn-oven', 'stn-out', 'stn-color', 'stn-sort'];
    const STEP_COLORS = ['#AF52DE', '#30D158', '#007AFF', '#007AFF', '#5AC8FA', '#FF9F0A'];

    // Reset all
    STEP_STNS.forEach((id, i) => {
        const el = document.getElementById(id);
        if (!el) return;
        const bg = el.querySelector('.stn-bg');
        if (bg) { bg.style.strokeWidth = '1.2'; bg.style.stroke = ''; }
    });

    // Highlight active
    if (step >= 0 && step < STEP_STNS.length) {
        const el = document.getElementById(STEP_STNS[step]);
        if (el) {
            const bg = el.querySelector('.stn-bg');
            if (bg) { bg.style.strokeWidth = '2.5'; bg.style.stroke = STEP_COLORS[step]; }
        }
    }

    // Connection paths
    const CONN_IDS = ['conn-1', 'conn-2', 'conn-3', 'conn-4', 'conn-5'];
    CONN_IDS.forEach((id, i) => {
        const conn = document.getElementById(id);
        if (!conn) return;
        conn.classList.remove('active', 'visited');
        if (step > 0 && i === step - 1) conn.classList.add('active');
        else if (step > 0 && i < step - 1) conn.classList.add('visited');
    });

    // Oven glow
    const ovenBox = document.querySelector('#stn-oven .stn-bg');
    if (ovenBox) {
        const burning = isOn(data.MS || {}, 'actuators', 'Lamp');
        ovenBox.style.stroke = burning ? '#FF453A' : '';
        ovenBox.style.strokeWidth = burning ? '3' : '';
    }
}

async function pollLiveData() {
    try {
        const resp = await fetch('/api/data');
        if (!resp.ok) return;
        const json = await resp.json();
        lastFetchTs = Date.now();
        liveData = json;

        const d = json?.data;
        if (!d || Object.keys(d).length === 0) return;

        const step = detectStep(d);
        if (step !== activeStep) prevStep = activeStep;
        activeStep = step;

        updateTwinFromLive(step, d);
        updateLiveIndicator(json.status, json.mode);
    } catch (e) {}
}


function updateLiveIndicator(status, serverMode) {
    const dot = document.getElementById('live-dot');
    const text = document.getElementById('live-text');
    if (!dot || !text) return;
    dot.className = 'live-dot';
    if (status === 'connected') {
        text.textContent = 'Live';
    } else if (status === 'disconnected') {
        dot.classList.add('disconnected');
        text.textContent = 'Offline';
    } else {
        dot.classList.add('stale');
        text.textContent = 'No data';
    }
}

// -- Main data fetch and render ---------------------------------------

async function refreshData() {
    const [cycleData, qualityData, throughputData, summaryData] = await Promise.all([
        fetchJSON('/api/analytics/cycle-times'),
        fetchJSON('/api/analytics/quality-grades'),
        fetchJSON('/api/analytics/throughput'),
        fetchJSON('/api/analytics/summary'),
    ]);

    lastCycleData = cycleData;
    lastQualityData = qualityData;
    lastThroughputData = throughputData;
    lastSummaryData = summaryData;

    // Render everything
    renderKPIs(cycleData, throughputData, summaryData);
    renderStationCards(cycleData);
    renderTimingPills(cycleData);
    updateScatterData(qualityData);
    renderStackedBars(cycleData);
}

// -- Init -------------------------------------------------------------

function init() {
    // Theme icon sync
    const theme = document.documentElement.getAttribute('data-theme');
    const moon = document.querySelector('.icon-moon');
    const sun = document.querySelector('.icon-sun');
    if (moon && sun) {
        moon.style.display = theme === 'dark' ? 'block' : 'none';
        sun.style.display = theme === 'light' ? 'block' : 'none';
    }

    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Init chart
    initScatterChart();

    // First data load
    refreshData();

    // Refresh loop
    setInterval(refreshData, REFRESH_MS);

    // Live polling for Digital Twin
    setInterval(pollLiveData, 400);
    pollLiveData();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

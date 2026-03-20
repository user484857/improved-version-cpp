/* ============================================
   KPI & Process Analytics — Application Logic
   ============================================ */

// --- Constants ---
const THEORETICAL = { HBW: 12.0, Crane: 12.0, MS: 18.0, PM: 5.0, SL: 6.0 };
const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};
const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

const MS_SUBSTEP_COLORS = {
    conveyor:           '#5AC8FA',
    transfer_to_oven:   '#007AFF',
    oven_load:          '#AF52DE',
    burn:               '#FF6B35',
    oven_unload:        '#BF5AF2',
    transfer_back:      '#32ADE6',
    turntable_to_saw:   '#30D158',
    saw:                '#28CD41',
    eject:              '#8E8E93'
};

const MS_SUBSTEP_LABELS = {
    conveyor:           'Conveyor',
    transfer_to_oven:   'Transfer to Chamber',
    oven_load:          'Chamber Load',
    burn:               'Stress Test',
    oven_unload:        'Chamber Unload',
    transfer_back:      'Transfer Back',
    turntable_to_saw:   'Turntable to Cap. Test',
    saw:                'Capacity Test',
    eject:              'Eject'
};

const MS_SUBSTEP_ORDER = [
    'conveyor', 'transfer_to_oven', 'oven_load', 'burn',
    'oven_unload', 'transfer_back', 'turntable_to_saw', 'saw', 'eject'
];

// --- Chart instances ---
let cycleTimeChart = null;
let msSubstepChart = null;
let trendChart = null;
let cumulativeChart = null;
let timelineChart = null;

// --- Theme ---
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateChartTheme();
}

// --- Settings Panel ---
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

function getThemeColors() {
    const s = getComputedStyle(document.documentElement);
    return {
        text:      s.getPropertyValue('--text-primary').trim(),
        textSec:   s.getPropertyValue('--text-secondary').trim(),
        textTert:  s.getPropertyValue('--text-tertiary').trim(),
        grid:      s.getPropertyValue('--chart-grid').trim(),
        tick:      s.getPropertyValue('--chart-tick').trim(),
        separator: s.getPropertyValue('--separator').trim(),
        green:     s.getPropertyValue('--green').trim(),
        red:       s.getPropertyValue('--red').trim(),
        blue:      s.getPropertyValue('--blue').trim(),
        orange:    s.getPropertyValue('--orange').trim()
    };
}

function updateChartTheme() {
    const c = getThemeColors();
    [cycleTimeChart, msSubstepChart, trendChart, cumulativeChart, timelineChart].forEach(chart => {
        if (!chart) return;
        const opts = chart.options;
        if (opts.scales) {
            Object.values(opts.scales).forEach(scale => {
                if (scale.grid) scale.grid.color = c.grid;
                if (scale.ticks) scale.ticks.color = c.tick;
                if (scale.title) scale.title.color = c.textSec;
            });
        }
        if (opts.plugins && opts.plugins.legend && opts.plugins.legend.labels) {
            opts.plugins.legend.labels.color = c.textSec;
        }
        chart.update('none');
    });
}

// --- Gauge Drawing ---
// Large gauge: 270-degree arc, radius 68, circumference = 2*PI*68 = 427.26
// Arc length for 270 deg = 427.26 * 0.75 = 320.44
const GAUGE_LG_ARC = 320.44;
const GAUGE_LG_CIRC = 427.26;
// Small gauge: radius 32, circumference = 2*PI*32 = 201.06
const GAUGE_SM_ARC = 150.80;
const GAUGE_SM_CIRC = 201.06;

function setGaugeValue(arcId, value, maxArc, maxCirc, color) {
    const el = document.getElementById(arcId);
    if (!el) return;
    const clamped = Math.max(0, Math.min(1, value));
    const dashLen = clamped * maxArc;
    el.setAttribute('stroke-dasharray', dashLen + ' ' + maxCirc);
    if (color) el.setAttribute('stroke', color);
}

function getOEEColor(value) {
    if (value >= 0.85) return getThemeColors().green;
    if (value >= 0.65) return getThemeColors().orange;
    return getThemeColors().red;
}

// --- Data Fetch ---
async function fetchJSON(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(r.statusText);
        return await r.json();
    } catch (e) {
        console.error('Fetch error:', url, e);
        return null;
    }
}

// --- Render: OEE ---
function renderOEE(data) {
    if (!data) return;

    const oeeVal = data.oee;
    const oeeColor = getOEEColor(oeeVal);

    // Main gauge
    setGaugeValue('oee-arc', oeeVal, GAUGE_LG_ARC, GAUGE_LG_CIRC, oeeColor);
    document.getElementById('oee-value').textContent = (oeeVal * 100).toFixed(1) + '%';

    // Sub gauges
    setGaugeValue('avail-arc', data.availability, GAUGE_SM_ARC, GAUGE_SM_CIRC);
    setGaugeValue('perf-arc', data.performance, GAUGE_SM_ARC, GAUGE_SM_CIRC);
    setGaugeValue('qual-arc', data.quality, GAUGE_SM_ARC, GAUGE_SM_CIRC);

    document.getElementById('avail-value').textContent = (data.availability * 100).toFixed(1) + '%';
    document.getElementById('perf-value').textContent = (data.performance * 100).toFixed(1) + '%';
    document.getElementById('qual-value').textContent = (data.quality * 100).toFixed(1) + '%';

    // Color sub-gauge arcs by value
    const avColor = data.availability >= 0.9 ? getThemeColors().green : (data.availability >= 0.7 ? getThemeColors().orange : getThemeColors().red);
    const pfColor = data.performance >= 0.9 ? getThemeColors().green : (data.performance >= 0.7 ? getThemeColors().orange : getThemeColors().red);
    const qlColor = data.quality >= 0.9 ? getThemeColors().green : (data.quality >= 0.7 ? getThemeColors().orange : getThemeColors().red);
    document.getElementById('avail-arc').setAttribute('stroke', avColor);
    document.getElementById('perf-arc').setAttribute('stroke', pfColor);
    document.getElementById('qual-arc').setAttribute('stroke', qlColor);

    // Formula
    document.getElementById('formula-a').textContent = (data.availability * 100).toFixed(0) + '%';
    document.getElementById('formula-p').textContent = (data.performance * 100).toFixed(0) + '%';
    document.getElementById('formula-q').textContent = (data.quality * 100).toFixed(0) + '%';
    document.getElementById('formula-oee').textContent = (oeeVal * 100).toFixed(1) + '%';

    // Show context note when OEE is low (demo mode artifact)
    const noteEl = document.getElementById('oee-context-note');
    if (noteEl) {
        noteEl.style.display = oeeVal < 0.50 ? 'block' : 'none';
    }
}

// --- Render: Bottleneck ---
function renderBottleneck(data) {
    if (!data) return;

    document.getElementById('bottleneck-badge').textContent = 'Constraint';
    const nameEl = document.getElementById('bottleneck-name');
    nameEl.textContent = data.station;
    nameEl.style.color = STATION_COLORS[data.station] || 'var(--text-primary)';

    const actual = data.avg_cycle_time;
    const theo = data.theoretical;
    const maxVal = Math.max(actual, theo) * 1.1;

    document.getElementById('bn-actual-val').textContent = actual.toFixed(1) + 's';
    document.getElementById('bn-theo-val').textContent = theo.toFixed(1) + 's';
    document.getElementById('bn-actual-bar').style.width = (actual / maxVal * 100) + '%';
    document.getElementById('bn-theo-bar').style.width = (theo / maxVal * 100) + '%';

    // All stations chips
    const container = document.getElementById('bottleneck-all-stations');
    container.innerHTML = '';
    if (data.all_averages) {
        STATION_ORDER.forEach(st => {
            const val = data.all_averages[st];
            if (val === undefined) return;
            const chip = document.createElement('div');
            chip.className = 'bn-station-chip' + (st === data.station ? ' is-bottleneck' : '');
            chip.innerHTML = '<span class="chip-dot" style="background:' + STATION_COLORS[st] + '"></span>' +
                st + ' <span class="chip-val">' + val.toFixed(1) + 's</span>';
            container.appendChild(chip);
        });
    }

    // Recommendation
    document.getElementById('rec-text').textContent = data.recommendation || 'No recommendation available.';
}

// --- Render: Throughput ---
function renderThroughput(data) {
    if (!data) return;

    document.getElementById('throughput-val').textContent = data.per_hour.toFixed(1);
    document.getElementById('throughput-max-val').textContent = data.theoretical_max.toFixed(1);
    document.getElementById('utilization-pct').textContent = (data.utilization * 100).toFixed(1) + '%';
    document.getElementById('utilization-bar').style.width = (data.utilization * 100) + '%';
    document.getElementById('total-runs').textContent = data.total_runs;

    if (data.total_time_min !== undefined) {
        document.getElementById('total-time').textContent = data.total_time_min.toFixed(1) + ' min';
    } else {
        document.getElementById('total-time').textContent = '--';
    }
}

// --- Render: Cycle Time Bar Chart ---
function renderCycleTimeChart(cycleData) {
    if (!cycleData || !cycleData.length) return;

    const c = getThemeColors();

    // Calculate medians per station
    const stationVals = {};
    STATION_ORDER.forEach(st => stationVals[st] = []);
    cycleData.forEach(run => {
        if (run.stations) {
            STATION_ORDER.forEach(st => {
                if (run.stations[st] !== undefined) stationVals[st].push(run.stations[st]);
            });
        }
    });

    const medians = {};
    STATION_ORDER.forEach(st => {
        const arr = stationVals[st].sort((a, b) => a - b);
        if (arr.length === 0) { medians[st] = 0; return; }
        const mid = Math.floor(arr.length / 2);
        medians[st] = arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    });

    const barColors = STATION_ORDER.map(st => medians[st] > THEORETICAL[st] ? c.red : c.green);
    const reversedStations = [...STATION_ORDER].reverse();

    const ctx = document.getElementById('cycle-time-chart').getContext('2d');

    // Annotation lines for theoretical values
    const theoAnnotations = reversedStations.map((st, i) => ({
        type: 'line',
        xMin: THEORETICAL[st],
        xMax: THEORETICAL[st],
        yMin: i - 0.4,
        yMax: i + 0.4,
        borderColor: c.textTert,
        borderWidth: 1.5,
        borderDash: [4, 3]
    }));

    if (cycleTimeChart) cycleTimeChart.destroy();

    cycleTimeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: reversedStations,
            datasets: [{
                data: reversedStations.map(st => medians[st]),
                backgroundColor: [...barColors].reverse(),
                borderRadius: 4,
                borderSkipped: false,
                barThickness: 22
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { family: 'Inter' },
                    bodyFont: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 12 },
                    callbacks: {
                        label: function(ctx) {
                            const st = reversedStations[ctx.dataIndex];
                            return 'Median: ' + ctx.raw.toFixed(1) + 's  |  Theoretical: ' + THEORETICAL[st].toFixed(1) + 's';
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Cycle Time (seconds)', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: { color: c.tick, font: { size: 11 } },
                    beginAtZero: true
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: c.tick,
                        font: { size: 12, weight: '600' },
                        callback: function(value, index) {
                            return reversedStations[index];
                        }
                    }
                }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        },
        plugins: [{
            id: 'theoreticalLines',
            afterDatasetsDraw(chart) {
                const { ctx, scales } = chart;
                const yScale = scales.y;
                const xScale = scales.x;

                reversedStations.forEach((st, i) => {
                    const theo = THEORETICAL[st];
                    const xPos = xScale.getPixelForValue(theo);
                    const yCenter = yScale.getPixelForValue(i);
                    const barHeight = 22;

                    ctx.save();
                    ctx.setLineDash([4, 3]);
                    ctx.strokeStyle = c.textTert;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(xPos, yCenter - barHeight);
                    ctx.lineTo(xPos, yCenter + barHeight);
                    ctx.stroke();
                    ctx.restore();

                    // Draw median value on bar
                    const med = medians[st];
                    const barEnd = xScale.getPixelForValue(med);
                    ctx.save();
                    ctx.font = "600 11px 'SF Mono', 'JetBrains Mono', monospace";
                    ctx.fillStyle = c.text;
                    ctx.textAlign = barEnd - xScale.getPixelForValue(0) > 50 ? 'right' : 'left';
                    const textX = barEnd - xScale.getPixelForValue(0) > 50 ? barEnd - 8 : barEnd + 8;
                    ctx.textBaseline = 'middle';
                    ctx.fillText(med.toFixed(1) + 's', textX, yCenter);
                    ctx.restore();
                });

                // Station color dots
                reversedStations.forEach((st, i) => {
                    const yCenter = yScale.getPixelForValue(i);
                    const xStart = yScale.left - 8;
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(xStart, yCenter, 4, 0, Math.PI * 2);
                    ctx.fillStyle = STATION_COLORS[st];
                    ctx.fill();
                    ctx.restore();
                });
            }
        }]
    });
}

// --- Render: MS Sub-Step Breakdown ---
function renderMSSubsteps(cycleData) {
    if (!cycleData || !cycleData.length) return;

    const c = getThemeColors();

    // Average sub-step values
    const sums = {};
    let count = 0;
    MS_SUBSTEP_ORDER.forEach(k => sums[k] = 0);

    cycleData.forEach(run => {
        if (run.ms_substeps) {
            count++;
            MS_SUBSTEP_ORDER.forEach(k => {
                sums[k] += (run.ms_substeps[k] || 0);
            });
        }
    });

    const avgs = {};
    let totalMS = 0;
    MS_SUBSTEP_ORDER.forEach(k => {
        avgs[k] = count > 0 ? sums[k] / count : 0;
        totalMS += avgs[k];
    });

    document.getElementById('ms-total-label').textContent = 'Total: ' + totalMS.toFixed(1) + 's';

    // Build datasets (one per substep for stacking)
    const datasets = MS_SUBSTEP_ORDER.map(key => ({
        label: MS_SUBSTEP_LABELS[key],
        data: [avgs[key]],
        backgroundColor: MS_SUBSTEP_COLORS[key],
        borderRadius: 0,
        barThickness: 32
    }));

    // First and last get rounded corners
    datasets[0].borderRadius = { topLeft: 4, bottomLeft: 4, topRight: 0, bottomRight: 0 };
    datasets[datasets.length - 1].borderRadius = { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 };

    const ctx = document.getElementById('ms-substep-chart').getContext('2d');
    if (msSubstepChart) msSubstepChart.destroy();

    msSubstepChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Testing Station (MS)'],
            datasets: datasets
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    bodyFont: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 12 },
                    callbacks: {
                        label: function(ctx) {
                            return ctx.dataset.label + ': ' + ctx.raw.toFixed(1) + 's';
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    title: { display: true, text: 'Time (seconds)', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: { color: c.tick, font: { size: 11 } },
                    beginAtZero: true
                },
                y: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { display: false }
                }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        }
    });

    // Legend
    const legendEl = document.getElementById('ms-legend');
    legendEl.innerHTML = '';
    MS_SUBSTEP_ORDER.forEach(key => {
        const item = document.createElement('div');
        item.className = 'ms-legend-item';
        item.innerHTML = '<span class="ms-legend-dot" style="background:' + MS_SUBSTEP_COLORS[key] + '"></span>' +
            MS_SUBSTEP_LABELS[key] + ' <span class="ms-legend-val">' + avgs[key].toFixed(1) + 's</span>';
        legendEl.appendChild(item);
    });
}

// --- Render: Cycle Time Trend ---
function renderTrendChart(cycleData) {
    if (!cycleData || !cycleData.length) return;

    const c = getThemeColors();
    const runs = cycleData.map((d, i) => d.run || (i + 1));

    const datasets = STATION_ORDER.map(st => ({
        label: st,
        data: cycleData.map(d => d.stations ? (d.stations[st] || null) : null),
        borderColor: STATION_COLORS[st],
        backgroundColor: STATION_COLORS[st] + '18',
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: STATION_COLORS[st],
        tension: 0.3,
        fill: false
    }));

    const ctx = document.getElementById('trend-chart').getContext('2d');
    if (trendChart) trendChart.destroy();

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: runs,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: c.textSec,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 14,
                        font: { size: 11, weight: '500' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { family: 'Inter', size: 12 },
                    bodyFont: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 11 },
                    callbacks: {
                        label: function(ctx) {
                            return ctx.dataset.label + ': ' + (ctx.raw !== null ? ctx.raw.toFixed(1) + 's' : 'N/A');
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Run', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: { color: c.tick, font: { size: 11 } }
                },
                y: {
                    title: { display: true, text: 'Cycle Time (s)', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: { color: c.tick, font: { size: 11 } },
                    beginAtZero: true
                }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        },
        plugins: [{
            id: 'theoreticalBands',
            beforeDatasetsDraw(chart) {
                const { ctx, scales } = chart;
                const xScale = scales.x;
                const yScale = scales.y;
                const left = xScale.left;
                const right = xScale.right;

                // Draw theoretical reference lines and +-10% bands
                STATION_ORDER.forEach(st => {
                    const theo = THEORETICAL[st];
                    const yPos = yScale.getPixelForValue(theo);
                    const yTop = yScale.getPixelForValue(theo * 1.1);
                    const yBot = yScale.getPixelForValue(theo * 0.9);

                    // Green band (+-10%)
                    ctx.save();
                    ctx.fillStyle = STATION_COLORS[st] + '08';
                    ctx.fillRect(left, yTop, right - left, yBot - yTop);
                    ctx.restore();

                    // Dashed reference line
                    ctx.save();
                    ctx.setLineDash([4, 4]);
                    ctx.strokeStyle = STATION_COLORS[st] + '40';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(left, yPos);
                    ctx.lineTo(right, yPos);
                    ctx.stroke();
                    ctx.restore();
                });
            }
        }]
    });
}

// --- Render: Cumulative Production ---
function renderCumulativeChart(throughputData) {
    if (!throughputData || !throughputData.cumulative || !throughputData.cumulative.length) return;

    const c = getThemeColors();
    const cumData = throughputData.cumulative;

    // Parse timestamps for labels
    const labels = cumData.map(d => {
        if (d.timestamp) {
            const dt = new Date(d.timestamp);
            return dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        }
        return 'Run ' + d.run;
    });
    const counts = cumData.map(d => d.count);

    // Theoretical pace line: from first to last timestamp
    const theoMax = throughputData.theoretical_max || 60;
    const theoPerSec = theoMax / 3600;
    let theoPace = [];
    if (cumData.length >= 2 && cumData[0].timestamp && cumData[cumData.length - 1].timestamp) {
        const t0 = new Date(cumData[0].timestamp).getTime();
        theoPace = cumData.map(d => {
            const t = new Date(d.timestamp).getTime();
            const elapsed = (t - t0) / 1000;
            return Math.round(theoPerSec * elapsed * 10) / 10;
        });
    } else {
        // Fallback: linear based on run index
        theoPace = cumData.map((d, i) => {
            return Math.round((i + 1) * (theoMax / throughputData.per_hour) * 10) / 10;
        });
    }

    const ctx = document.getElementById('cumulative-chart').getContext('2d');
    if (cumulativeChart) cumulativeChart.destroy();

    cumulativeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Actual Production',
                    data: counts,
                    borderColor: c.blue,
                    backgroundColor: c.blue + '15',
                    borderWidth: 2.5,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: c.blue,
                    stepped: 'after',
                    fill: true
                },
                {
                    label: 'Theoretical Pace',
                    data: theoPace,
                    borderColor: c.textTert,
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: c.textSec,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 14,
                        font: { size: 11, weight: '500' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { family: 'Inter', size: 12 },
                    bodyFont: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 11 },
                    callbacks: {
                        label: function(ctx) {
                            return ctx.dataset.label + ': ' + ctx.raw;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Time', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: {
                        color: c.tick,
                        font: { size: 10 },
                        maxRotation: 45,
                        maxTicksLimit: 12
                    }
                },
                y: {
                    title: { display: true, text: 'Cumulative Cells Tested', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: { color: c.tick, font: { size: 11 } },
                    beginAtZero: true
                }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        }
    });
}

// --- Collapsible Sections ---
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

// --- Utility ---
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// --- Render: Production Timeline (Gantt) ---
function renderTimeline(timeline) {
    if (!timeline || timeline.length === 0) return;

    let minTs = Infinity;
    for (const entry of timeline) {
        const ts = new Date(entry.start).getTime();
        if (ts < minTs) minTs = ts;
    }

    const runMap = {};
    for (const entry of timeline) {
        const runKey = entry.run;
        if (!runMap[runKey]) runMap[runKey] = {};
        const startOff = (new Date(entry.start).getTime() - minTs) / 1000;
        const endOff = (new Date(entry.end).getTime() - minTs) / 1000;
        runMap[runKey][entry.station] = [startOff, endOff];
    }

    const runs = Object.keys(runMap).map(Number).sort((a, b) => a - b);
    const datasets = [];

    for (const run of runs) {
        const runData = runMap[run];
        const opacity = 0.55 + (run % 3) * 0.15;

        for (const station of STATION_ORDER) {
            if (!runData[station]) continue;
            const [start, end] = runData[station];
            const color = STATION_COLORS[station];
            const rgbaFill = hexToRgba(color, opacity);
            const rgbaBorder = hexToRgba(color, Math.min(opacity + 0.3, 1.0));

            datasets.push({
                label: station + ' #' + run,
                data: STATION_ORDER.map(s => s === station ? [start, end] : null),
                backgroundColor: rgbaFill,
                borderColor: rgbaBorder,
                borderWidth: 1,
                borderRadius: 3,
                borderSkipped: false,
                barPercentage: 0.7,
                categoryPercentage: 0.85,
            });
        }
    }

    const ctx = document.getElementById('chart-timeline');
    if (!ctx) return;
    const c = getThemeColors();

    if (timelineChart) timelineChart.destroy();

    timelineChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: { labels: STATION_ORDER, datasets: datasets },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: "'SF Mono', monospace", size: 11 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        title: function(items) { return items.length ? items[0].dataset.label : ''; },
                        label: function(ctx) {
                            const val = ctx.raw;
                            if (!val) return '';
                            return 'Time: ' + val[0].toFixed(1) + 's - ' + val[1].toFixed(1) + 's (' + (val[1] - val[0]).toFixed(1) + 's)';
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Time (seconds)', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: { color: c.tick, font: { family: "'SF Mono', monospace", size: 10 }, callback: function(val) { return val + 's'; } },
                },
                y: {
                    grid: { display: false },
                    ticks: { color: c.tick, font: { size: 11, weight: '600' } },
                },
            },
        },
    });
}

// --- Init ---
async function init() {
    initSettings();
    const [cycleData, oeeData, throughputData, bottleneckData, timelineData] = await Promise.all([
        fetchJSON('/api/analytics/cycle-times'),
        fetchJSON('/api/analytics/oee'),
        fetchJSON('/api/analytics/throughput'),
        fetchJSON('/api/analytics/bottleneck'),
        fetchJSON('/api/analytics/timeline')
    ]);

    renderOEE(oeeData);
    renderBottleneck(bottleneckData);
    renderThroughput(throughputData);
    renderCycleTimeChart(cycleData);
    renderMSSubsteps(cycleData);
    renderTrendChart(cycleData);
    renderTimeline(timelineData);
    renderCumulativeChart(throughputData);
}

document.addEventListener('DOMContentLoaded', init);

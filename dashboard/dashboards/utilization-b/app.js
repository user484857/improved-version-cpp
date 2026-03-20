/* ============================================
   Utilization B — Machine Grid Dashboard
   ============================================ */

const STATION_COLORS = {
    SAW:     '#FF9F0A',
    Oven:    '#FF9F0A',
    Sorting: '#30D158',
    Crane:   '#30D158',
    HBW:     '#AF52DE',
    MS:      '#007AFF',
    PM:      '#FF453A'
};

const MACHINES = ['SAW', 'Oven', 'Sorting', 'Crane', 'HBW', 'MS', 'PM'];

let cumulativeChart = null;

// ---- Theme ----
function toggleTheme() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    if (cumulativeChart) updateChartTheme(cumulativeChart);
}

// ---- Collapsible ----
function toggleCollapsible(header) {
    header.classList.toggle('expanded');
    header.nextElementSibling.classList.toggle('expanded');
}

// ---- Helpers ----
function getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
        grid: style.getPropertyValue('--chart-grid').trim(),
        tick: style.getPropertyValue('--chart-tick').trim(),
        textSecondary: style.getPropertyValue('--text-secondary').trim(),
        textTertiary: style.getPropertyValue('--text-tertiary').trim(),
        blue: style.getPropertyValue('--blue').trim()
    };
}

function statusDotClass(pct) {
    if (pct >= 0.50) return 'green';
    if (pct >= 0.20) return 'yellow';
    return 'red';
}

function formatTime(seconds) {
    if (seconds < 60) return seconds.toFixed(0) + 's';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m + 'm ' + s + 's';
}

function categoryForMachine(machine, categories) {
    if (!categories) return '---';
    if (categories.value_adding && categories.value_adding.includes(machine)) return 'Value Adding';
    if (categories.quality && categories.quality.includes(machine)) return 'Quality';
    if (categories.transport && categories.transport.includes(machine)) return 'Transport';
    return '---';
}

// ---- Update timestamp ----
function updateTimestamp() {
    const el = document.getElementById('lastUpdated');
    const now = new Date();
    el.textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.classList.remove('stale');
}

// ---- Thermometer Bars ----
function updateThermoBars(utilData) {
    MACHINES.forEach(m => {
        const info = utilData[m];
        const barEl = document.getElementById('bar-' + m);
        const pctEl = document.getElementById('pct-' + m);
        const dotEl = document.getElementById('dot-' + m);

        if (!info || !barEl) return;

        const pct = Math.round(info.utilization * 100);
        // Animate height with requestAnimationFrame for smoothness
        requestAnimationFrame(() => {
            barEl.style.height = pct + '%';
        });
        pctEl.textContent = pct + '%';

        // Status dot
        dotEl.className = 'thermo-status-dot status-dot ' + statusDotClass(info.utilization);
    });
}

// ---- Hero Bar ----
function updateHero(utilData, throughputData, qualityData) {
    // Average utilization
    let sum = 0, count = 0;
    MACHINES.forEach(m => {
        if (utilData[m]) {
            sum += utilData[m].utilization;
            count++;
        }
    });
    const avgPct = count > 0 ? Math.round((sum / count) * 100) : 0;
    document.getElementById('heroUtilization').textContent = avgPct + '%';

    // Live status dot
    const dot = document.getElementById('liveStatusDot');
    dot.className = 'status-dot ' + (avgPct >= 30 ? 'green' : avgPct >= 10 ? 'yellow' : 'red');
    document.getElementById('heroStatus').textContent = avgPct >= 10 ? 'Online' : 'Idle';

    // Parts
    if (throughputData) {
        document.getElementById('heroParts').textContent = throughputData.total_runs || 0;
        const rate = throughputData.per_hour != null ? throughputData.per_hour.toFixed(1) : '--';
        document.getElementById('heroThroughput').textContent = rate + ' /hr';
    }

    // Quality A-rate
    if (qualityData && qualityData.length > 0) {
        const aCount = qualityData.filter(r => r.grade === 'A').length;
        const aRate = Math.round((aCount / qualityData.length) * 100);
        document.getElementById('heroQuality').textContent = aRate + '%';
    }
}

// ---- Cumulative Line Chart ----
function buildCumulativeChart(cumData) {
    const ctx = document.getElementById('cumulativeChart');
    if (!ctx) return;

    const tc = getThemeColors();

    const labels = cumData.map((p, i) => {
        if (p.timestamp) {
            const d = new Date(p.timestamp);
            return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        }
        return 'Run ' + (i + 1);
    });
    const values = cumData.map(p => p.count != null ? p.count : p.cumulative != null ? p.cumulative : p);

    if (cumulativeChart) {
        cumulativeChart.data.labels = labels;
        cumulativeChart.data.datasets[0].data = values;
        updateChartTheme(cumulativeChart);
        cumulativeChart.update('none');
        return;
    }

    cumulativeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Parts',
                data: values,
                borderColor: tc.blue || '#007AFF',
                backgroundColor: createGradient(ctx, tc.blue || '#007AFF'),
                borderWidth: 2.5,
                pointRadius: 3,
                pointBackgroundColor: tc.blue || '#007AFF',
                pointBorderColor: 'transparent',
                pointHoverRadius: 5,
                tension: 0.35,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(28,28,30,0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.7)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    cornerRadius: 10,
                    padding: 10,
                    titleFont: { family: 'Inter', weight: '600', size: 12 },
                    bodyFont: { family: 'JetBrains Mono', size: 11 }
                }
            },
            scales: {
                x: {
                    grid: { color: tc.grid, drawBorder: false },
                    ticks: {
                        color: tc.tick,
                        font: { family: 'Inter', size: 10 },
                        maxRotation: 0
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: tc.grid, drawBorder: false },
                    ticks: {
                        color: tc.tick,
                        font: { family: 'JetBrains Mono', size: 10 },
                        precision: 0
                    }
                }
            }
        }
    });
}

function createGradient(ctx, color) {
    const canvas = ctx.getContext ? ctx : ctx.canvas || ctx;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height || 280);
    gradient.addColorStop(0, hexToRGBA(color, 0.25));
    gradient.addColorStop(1, hexToRGBA(color, 0.02));
    return gradient;
}

function hexToRGBA(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function updateChartTheme(chart) {
    const tc = getThemeColors();
    const scales = chart.options.scales;
    if (scales.x) {
        scales.x.grid.color = tc.grid;
        scales.x.ticks.color = tc.tick;
    }
    if (scales.y) {
        scales.y.grid.color = tc.grid;
        scales.y.ticks.color = tc.tick;
    }
    chart.update('none');
}

// ---- Quality Run Grid ----
function buildRunGrid(qualityData) {
    const grid = document.getElementById('runGrid');
    grid.innerHTML = '';

    if (!qualityData || qualityData.length === 0) {
        grid.innerHTML = '<div class="run-grid-empty">No production runs yet</div>';
        return;
    }

    qualityData.forEach(run => {
        const sq = document.createElement('div');
        const g = (run.grade || 'C').toUpperCase();
        sq.className = 'run-square grade-' + g.toLowerCase();
        sq.textContent = run.run;
        sq.dataset.run = run.run;
        sq.dataset.grade = g;
        sq.dataset.colorValue = run.color_value != null ? run.color_value : '';
        sq.dataset.colorName = run.color_name || '';
        sq.dataset.burnTime = run.burn_time != null ? run.burn_time : '';

        sq.addEventListener('mouseenter', showRunTooltip);
        sq.addEventListener('mouseleave', hideRunTooltip);
        sq.addEventListener('mousemove', moveRunTooltip);

        grid.appendChild(sq);
    });
}

function showRunTooltip(e) {
    const el = e.currentTarget;
    const tip = document.getElementById('runTooltip');
    const lines = [
        '<div class="run-tooltip-row"><span class="run-tooltip-label">Run</span><span class="run-tooltip-value">#' + el.dataset.run + '</span></div>',
        '<div class="run-tooltip-row"><span class="run-tooltip-label">Grade</span><span class="run-tooltip-value">' + el.dataset.grade + '</span></div>'
    ];
    if (el.dataset.colorName) {
        lines.push('<div class="run-tooltip-row"><span class="run-tooltip-label">Color</span><span class="run-tooltip-value">' + el.dataset.colorName + '</span></div>');
    }
    if (el.dataset.colorValue) {
        lines.push('<div class="run-tooltip-row"><span class="run-tooltip-label">Value</span><span class="run-tooltip-value">' + el.dataset.colorValue + '</span></div>');
    }
    if (el.dataset.burnTime) {
        lines.push('<div class="run-tooltip-row"><span class="run-tooltip-label">Burn</span><span class="run-tooltip-value">' + el.dataset.burnTime + 's</span></div>');
    }
    tip.innerHTML = lines.join('');
    tip.classList.add('visible');
}

function hideRunTooltip() {
    document.getElementById('runTooltip').classList.remove('visible');
}

function moveRunTooltip(e) {
    const tip = document.getElementById('runTooltip');
    tip.style.left = (e.clientX + 12) + 'px';
    tip.style.top = (e.clientY - 10) + 'px';
}

// ---- Quality Summary ----
function updateQualitySummary(qualityData) {
    if (!qualityData) return;
    let a = 0, b = 0, c = 0;
    qualityData.forEach(r => {
        const g = (r.grade || 'C').toUpperCase();
        if (g === 'A') a++;
        else if (g === 'B') b++;
        else c++;
    });
    document.getElementById('gradeACount').textContent = a;
    document.getElementById('gradeBCount').textContent = b;
    document.getElementById('gradeCCount').textContent = c;
}

// ---- Detail Table ----
function updateDetailTable(utilData) {
    const tbody = document.getElementById('detailTableBody');
    const categories = utilData._categories || {};

    const rows = MACHINES.map(m => {
        const info = utilData[m];
        if (!info) return '';
        const pct = (info.utilization * 100).toFixed(1);
        const cat = categoryForMachine(m, categories);
        const dotClass = statusDotClass(info.utilization);
        return '<tr>' +
            '<td><span class="status-dot ' + dotClass + '" style="margin-right:6px"></span>' + m + '</td>' +
            '<td>' + cat + '</td>' +
            '<td>' + formatTime(info.run_time_s) + '</td>' +
            '<td>' + formatTime(info.idle_time_s) + '</td>' +
            '<td>' + formatTime(info.total_time_s) + '</td>' +
            '<td style="font-weight:600;color:var(--text-primary)">' + pct + '%</td>' +
            '</tr>';
    });

    tbody.innerHTML = rows.join('');
}

// ---- Data Loading ----
async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function loadData() {
    const [utilData, throughputData, qualityData] = await Promise.all([
        fetchJSON('/api/analytics/utilization'),
        fetchJSON('/api/analytics/throughput'),
        fetchJSON('/api/analytics/quality-grades')
    ]);

    updateTimestamp();

    if (utilData) {
        updateThermoBars(utilData);
        updateDetailTable(utilData);
    }

    updateHero(utilData || {}, throughputData, qualityData);

    // Cumulative chart
    if (throughputData && throughputData.cumulative && throughputData.cumulative.length > 0) {
        buildCumulativeChart(throughputData.cumulative);
    } else if (throughputData) {
        // Fallback: single point
        buildCumulativeChart([{ count: throughputData.total_runs || 0 }]);
    }

    // Rate display
    if (throughputData) {
        const rateEl = document.getElementById('rateValue');
        rateEl.textContent = (throughputData.per_hour != null ? throughputData.per_hour.toFixed(1) : '--') + ' /hr';
    }

    // Quality
    if (qualityData) {
        buildRunGrid(qualityData);
        updateQualitySummary(qualityData);
    }
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setInterval(loadData, 8000);
});

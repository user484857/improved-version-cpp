/* ============================================
   KPI V3 — Gap Analysis Dashboard
   Actual vs Target: Where efficiency is lost
   ============================================ */

// --- Constants ---
const THEORETICAL = { HBW: 12.0, Crane: 12.0, MS: 18.0, PM: 5.0, SL: 6.0 };
const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};
const STATION_NAMES = {
    HBW: 'High Bay Warehouse', Crane: 'Crane', MS: 'Testing Station', PM: 'Punching Machine', SL: 'Sorting Line'
};
const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

let waterfallChart = null;

// --- Theme ---
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    if (waterfallChart) {
        updateWaterfallTheme();
    }
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
        orange:    s.getPropertyValue('--orange').trim(),
        purple:    s.getPropertyValue('--purple').trim(),
    };
}

function updateWaterfallTheme() {
    if (!waterfallChart) return;
    const c = getThemeColors();
    const opts = waterfallChart.options;
    if (opts.scales) {
        Object.values(opts.scales).forEach(function(scale) {
            if (scale.grid) scale.grid.color = c.grid;
            if (scale.ticks) scale.ticks.color = c.tick;
            if (scale.title) scale.title.color = c.textSec;
        });
    }
    waterfallChart.update('none');
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

// --- Compute Medians ---
function computeMedians(cycleData) {
    var stationVals = {};
    STATION_ORDER.forEach(function(st) { stationVals[st] = []; });

    cycleData.forEach(function(run) {
        if (run.stations) {
            STATION_ORDER.forEach(function(st) {
                var v = run.stations[st];
                if (v !== undefined && v !== null) stationVals[st].push(v);
            });
        }
    });

    var medians = {};
    STATION_ORDER.forEach(function(st) {
        var arr = stationVals[st].slice().sort(function(a, b) { return a - b; });
        if (arr.length === 0) { medians[st] = null; return; }
        var mid = Math.floor(arr.length / 2);
        medians[st] = arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    });

    return medians;
}

// --- Gap Classification ---
function getGapClass(actual, target) {
    if (actual === null || target === null || target === 0) return { pct: 0, cls: 'green', label: 'N/A' };
    var pct = ((actual - target) / target) * 100;
    if (pct <= 10) return { pct: pct, cls: 'green', label: 'On Target' };
    if (pct <= 25) return { pct: pct, cls: 'yellow', label: 'Caution' };
    return { pct: pct, cls: 'red', label: 'Over Target' };
}

// --- Render: Gap Banner ---
function renderGapBanner(medians) {
    var totalActual = 0;
    var totalTarget = 0;
    var count = 0;

    STATION_ORDER.forEach(function(st) {
        if (medians[st] !== null) {
            totalActual += medians[st];
            totalTarget += THEORETICAL[st];
            count++;
        }
    });

    if (count === 0) return;

    var gapPct = ((totalActual - totalTarget) / totalTarget) * 100;
    var effPct = Math.min(100, (totalTarget / totalActual) * 100);

    document.getElementById('gap-banner-value').textContent = gapPct.toFixed(1);

    var barEff = document.getElementById('gap-banner-bar-eff');
    var barWaste = document.getElementById('gap-banner-bar-waste');
    barEff.style.width = effPct.toFixed(1) + '%';
    barWaste.style.width = (100 - effPct).toFixed(1) + '%';

    document.getElementById('gap-bar-label-eff').textContent = 'Efficient: ' + effPct.toFixed(1) + '%';
    document.getElementById('gap-bar-label-waste').textContent = 'Gap: ' + (100 - effPct).toFixed(1) + '%';

    // Color the value: positive gap = red, near zero = green
    var valEl = document.getElementById('gap-banner-value');
    if (gapPct <= 10) {
        valEl.style.color = 'var(--green)';
        valEl.style.textShadow = '0 0 40px rgba(48, 209, 88, 0.3)';
    } else if (gapPct <= 25) {
        valEl.style.color = 'var(--orange)';
        valEl.style.textShadow = '0 0 40px rgba(255, 159, 10, 0.3)';
    } else {
        valEl.style.color = 'var(--red)';
        valEl.style.textShadow = '0 0 40px rgba(255, 69, 58, 0.3)';
    }
}

// --- Render: Station Gap Cards ---
function renderStationCards(medians) {
    var container = document.getElementById('station-cards-row');
    container.innerHTML = '';

    // Find max time for bar scaling
    var maxTime = 0;
    STATION_ORDER.forEach(function(st) {
        var v = medians[st] || 0;
        if (v > maxTime) maxTime = v;
        if (THEORETICAL[st] > maxTime) maxTime = THEORETICAL[st];
    });

    STATION_ORDER.forEach(function(st) {
        var actual = medians[st];
        var target = THEORETICAL[st];
        var gap = getGapClass(actual, target);
        var color = STATION_COLORS[st];

        var card = document.createElement('div');
        card.className = 'station-gap-card glass';
        card.style.setProperty('--station-color', color);

        // Left color stripe
        var stripe = document.createElement('div');
        stripe.style.cssText = 'position:absolute;top:0;left:0;width:3px;height:100%;background:' + color + ';border-radius:3px 0 0 3px;';
        card.appendChild(stripe);

        // Header: name + traffic light
        var head = document.createElement('div');
        head.className = 'station-gap-card-head';

        var nameEl = document.createElement('span');
        nameEl.className = 'station-gap-name';
        nameEl.style.color = color;
        nameEl.textContent = st;
        head.appendChild(nameEl);

        var light = document.createElement('div');
        light.className = 'station-traffic-light traffic-' + gap.cls;
        light.title = gap.label + ' (' + gap.pct.toFixed(1) + '% over target)';
        head.appendChild(light);

        card.appendChild(head);

        // Actual time (large)
        var timesRow = document.createElement('div');
        timesRow.className = 'station-gap-times';

        var actualEl = document.createElement('span');
        actualEl.className = 'station-actual-time';
        actualEl.textContent = actual !== null ? actual.toFixed(1) : '--';
        timesRow.appendChild(actualEl);

        var unitEl = document.createElement('span');
        unitEl.className = 'station-actual-unit';
        unitEl.textContent = 's';
        timesRow.appendChild(unitEl);

        card.appendChild(timesRow);

        // Target row
        var targetRow = document.createElement('div');
        targetRow.className = 'station-target-row';

        var targetLabel = document.createElement('span');
        targetLabel.className = 'station-target-label';
        targetLabel.textContent = 'Target';
        targetRow.appendChild(targetLabel);

        var targetVal = document.createElement('span');
        targetVal.className = 'station-target-val';
        targetVal.textContent = target.toFixed(1) + 's';
        targetRow.appendChild(targetVal);

        card.appendChild(targetRow);

        // Gap bar
        var barArea = document.createElement('div');
        barArea.className = 'station-gap-bar-area';

        var barTrack = document.createElement('div');
        barTrack.className = 'station-gap-bar-track';

        if (actual !== null && maxTime > 0) {
            var targetPct = (target / maxTime) * 100;
            var actualPct = (actual / maxTime) * 100;

            // Target zone (background indicator)
            var targetZone = document.createElement('div');
            targetZone.className = 'station-gap-bar-target';
            targetZone.style.width = targetPct + '%';
            barTrack.appendChild(targetZone);

            if (actual <= target) {
                // Under or at target: green bar
                var fill = document.createElement('div');
                fill.className = 'station-gap-bar-fill';
                fill.style.width = actualPct + '%';
                fill.style.background = 'linear-gradient(90deg, ' + color + ', ' + color + ')';
                barTrack.appendChild(fill);
            } else {
                // Over target: green portion + red excess
                var fillGreen = document.createElement('div');
                fillGreen.className = 'station-gap-bar-fill';
                fillGreen.style.width = targetPct + '%';
                fillGreen.style.background = color;
                barTrack.appendChild(fillGreen);

                var excess = document.createElement('div');
                excess.className = 'station-gap-bar-excess';
                excess.style.left = targetPct + '%';
                excess.style.width = (actualPct - targetPct) + '%';
                excess.style.background = 'linear-gradient(90deg, #FF453A, #FF6B6B)';
                barTrack.appendChild(excess);
            }
        }

        barArea.appendChild(barTrack);

        // Gap percentage
        var gapLabel = document.createElement('span');
        gapLabel.className = 'station-gap-pct';
        if (actual !== null && actual > target) {
            gapLabel.className += ' gap-pct-over';
            gapLabel.textContent = '+' + gap.pct.toFixed(1) + '% over target';
        } else if (actual !== null) {
            gapLabel.className += ' gap-pct-ok';
            var underPct = ((target - actual) / target * 100);
            gapLabel.textContent = underPct.toFixed(1) + '% under target';
        } else {
            gapLabel.textContent = 'No data';
            gapLabel.style.color = 'var(--text-tertiary)';
        }

        barArea.appendChild(gapLabel);
        card.appendChild(barArea);

        container.appendChild(card);
    });
}

// --- Render: Waterfall Chart ---
function renderWaterfallChart(medians) {
    var c = getThemeColors();

    // Calculate excess time per station
    var excessData = [];
    var cumulativeBase = 0;

    STATION_ORDER.forEach(function(st) {
        var actual = medians[st];
        var target = THEORETICAL[st];
        if (actual === null) return;

        var excess = actual - target;
        excessData.push({
            station: st,
            excess: excess,
            base: cumulativeBase,
            color: STATION_COLORS[st],
            actual: actual,
            target: target,
        });
        if (excess > 0) cumulativeBase += excess;
    });

    var totalExcess = excessData.reduce(function(sum, d) { return sum + Math.max(0, d.excess); }, 0);
    document.getElementById('waterfall-total').textContent = 'Total excess: ' + totalExcess.toFixed(1) + 's';

    // Build chart datasets
    // Waterfall: invisible base bar + colored top bar
    var labels = excessData.map(function(d) { return d.station; });
    labels.push('TOTAL');

    var bases = excessData.map(function(d) { return d.excess > 0 ? d.base : 0; });
    bases.push(0);

    var values = excessData.map(function(d) { return d.excess; });
    values.push(totalExcess);

    var barColors = excessData.map(function(d) {
        return d.excess > 0 ? 'rgba(255, 69, 58, 0.85)' : 'rgba(48, 209, 88, 0.85)';
    });
    barColors.push('rgba(255, 69, 58, 0.95)');

    var borderColors = excessData.map(function(d) {
        return d.excess > 0 ? '#FF453A' : '#30D158';
    });
    borderColors.push('#FF453A');

    var ctx = document.getElementById('waterfall-chart').getContext('2d');
    if (waterfallChart) waterfallChart.destroy();

    waterfallChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Base',
                    data: bases,
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    barThickness: 36,
                },
                {
                    label: 'Excess / Savings',
                    data: values.map(function(v) { return Math.abs(v); }),
                    backgroundColor: barColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                    borderRadius: 4,
                    barThickness: 36,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.85)',
                    titleFont: { family: 'Inter', weight: '600', size: 13 },
                    bodyFont: { family: "'JetBrains Mono', 'SF Mono', monospace", size: 12 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        title: function(items) {
                            var idx = items[0].dataIndex;
                            if (idx < excessData.length) {
                                return excessData[idx].station + ' (' + STATION_NAMES[excessData[idx].station] + ')';
                            }
                            return 'Total Excess';
                        },
                        label: function(ctx) {
                            if (ctx.datasetIndex === 0) return null;
                            var idx = ctx.dataIndex;
                            if (idx < excessData.length) {
                                var d = excessData[idx];
                                return [
                                    'Actual: ' + d.actual.toFixed(1) + 's',
                                    'Target: ' + d.target.toFixed(1) + 's',
                                    (d.excess >= 0 ? 'Excess: +' : 'Savings: ') + d.excess.toFixed(1) + 's'
                                ];
                            }
                            return 'Total: ' + totalExcess.toFixed(1) + 's';
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: {
                        color: c.tick,
                        font: { size: 12, weight: '600' },
                    }
                },
                y: {
                    stacked: true,
                    title: { display: true, text: 'Excess Time (seconds)', color: c.textSec, font: { size: 11 } },
                    grid: { color: c.grid },
                    ticks: {
                        color: c.tick,
                        font: { family: "'JetBrains Mono', monospace", size: 11 },
                        callback: function(val) { return val + 's'; }
                    },
                    beginAtZero: true,
                }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        },
        plugins: [{
            id: 'waterfallLabels',
            afterDatasetsDraw: function(chart) {
                var ctx2 = chart.ctx;
                var meta = chart.getDatasetMeta(1);

                meta.data.forEach(function(bar, i) {
                    var val = values[i];
                    var sign = val >= 0 ? '+' : '';
                    var label = sign + val.toFixed(1) + 's';

                    ctx2.save();
                    ctx2.font = "700 11px 'JetBrains Mono', monospace";
                    ctx2.fillStyle = val >= 0 ? '#FF453A' : '#30D158';
                    ctx2.textAlign = 'center';
                    ctx2.textBaseline = 'bottom';
                    ctx2.fillText(label, bar.x, bar.y - 6);
                    ctx2.restore();
                });

                // Station color dots below labels
                var xScale = chart.scales.x;
                excessData.forEach(function(d, i) {
                    var xPos = xScale.getPixelForValue(i);
                    var yPos = xScale.bottom + 20;
                    ctx2.save();
                    ctx2.beginPath();
                    ctx2.arc(xPos, yPos, 4, 0, Math.PI * 2);
                    ctx2.fillStyle = d.color;
                    ctx2.fill();
                    ctx2.restore();
                });
            }
        }]
    });
}

// --- Render: OEE Loss Decomposition ---
function renderOEEDecomposition(oeeData) {
    if (!oeeData) return;

    var avail = oeeData.availability || 0;
    var perf = oeeData.performance || 0;
    var qual = oeeData.quality || 0;
    var oee = oeeData.oee || 0;

    // Loss calculations
    var availLoss = 1 - avail;
    var perfLoss = avail * (1 - perf);
    var qualLoss = avail * perf * (1 - qual);
    var effective = oee;

    // Normalize to 100%
    var total = effective + availLoss + perfLoss + qualLoss;
    if (total <= 0) total = 1;
    var effPct = (effective / total) * 100;
    var availPct = (availLoss / total) * 100;
    var perfPct = (perfLoss / total) * 100;
    var qualPct = (qualLoss / total) * 100;

    document.getElementById('oee-total-label').textContent = 'OEE: ' + (oee * 100).toFixed(1) + '%';

    // Build bar segments
    var track = document.getElementById('oee-bar-track');
    track.innerHTML = '';

    var segments = [
        { cls: 'seg-effective', pct: effPct, label: (oee * 100).toFixed(1) + '%' },
        { cls: 'seg-avail-loss', pct: availPct, label: (availLoss * 100).toFixed(1) + '%' },
        { cls: 'seg-perf-loss', pct: perfPct, label: (perfLoss * 100).toFixed(1) + '%' },
        { cls: 'seg-qual-loss', pct: qualPct, label: (qualLoss * 100).toFixed(1) + '%' },
    ];

    segments.forEach(function(seg) {
        var el = document.createElement('div');
        el.className = 'oee-decomp-seg ' + seg.cls;
        el.style.width = seg.pct.toFixed(1) + '%';
        if (seg.pct > 8) {
            el.textContent = seg.label;
        }
        track.appendChild(el);
    });

    // Labels below bar
    var labelsEl = document.getElementById('oee-decomp-labels');
    labelsEl.innerHTML = '';
    var labelTexts = ['Effective Output', 'Availability Loss', 'Performance Loss', 'Quality Loss'];
    segments.forEach(function(seg, i) {
        var span = document.createElement('span');
        span.style.width = seg.pct.toFixed(1) + '%';
        span.textContent = seg.pct > 6 ? labelTexts[i] : '';
        labelsEl.appendChild(span);
    });

    // Legend
    var legend = document.getElementById('oee-decomp-legend');
    legend.innerHTML = '';
    var legendItems = [
        { color: '#30D158', name: 'Effective Output', val: (oee * 100).toFixed(1) + '%' },
        { color: '#FF453A', name: 'Availability Loss', val: (availLoss * 100).toFixed(1) + '%' },
        { color: '#FF9F0A', name: 'Performance Loss', val: (perfLoss * 100).toFixed(1) + '%' },
        { color: '#AF52DE', name: 'Quality Loss', val: (qualLoss * 100).toFixed(1) + '%' },
    ];

    legendItems.forEach(function(item) {
        var el = document.createElement('div');
        el.className = 'oee-legend-item';
        el.innerHTML = '<span class="oee-legend-dot" style="background:' + item.color + '"></span>' +
            item.name + ' <span class="oee-legend-val">' + item.val + '</span>';
        legend.appendChild(el);
    });

    // Detail cards
    var details = document.getElementById('oee-decomp-details');
    details.innerHTML = '';

    var detailData = [
        {
            title: 'OEE',
            value: (oee * 100).toFixed(1) + '%',
            color: oee >= 0.65 ? 'var(--green)' : (oee >= 0.40 ? 'var(--orange)' : 'var(--red)'),
            sub: 'A x P x Q'
        },
        {
            title: 'Availability',
            value: (avail * 100).toFixed(1) + '%',
            color: avail >= 0.90 ? 'var(--green)' : (avail >= 0.70 ? 'var(--orange)' : 'var(--red)'),
            sub: 'Active: ' + (oeeData.active_time_s || 0).toFixed(0) + 's / ' + (oeeData.total_time_s || 0).toFixed(0) + 's'
        },
        {
            title: 'Performance',
            value: (perf * 100).toFixed(1) + '%',
            color: perf >= 0.90 ? 'var(--green)' : (perf >= 0.70 ? 'var(--orange)' : 'var(--red)'),
            sub: 'Theo. cycle / Actual cycle'
        },
        {
            title: 'Quality',
            value: (qual * 100).toFixed(1) + '%',
            color: qual >= 0.90 ? 'var(--green)' : (qual >= 0.70 ? 'var(--orange)' : 'var(--red)'),
            sub: 'Grade A: ' + (oeeData.grade_a_count || 0) + ' / ' + (oeeData.total_runs || 0) + ' runs'
        }
    ];

    detailData.forEach(function(d) {
        var card = document.createElement('div');
        card.className = 'oee-detail-card';
        card.innerHTML =
            '<div class="oee-detail-title">' + d.title + '</div>' +
            '<div class="oee-detail-value" style="color:' + d.color + '">' + d.value + '</div>' +
            '<div class="oee-detail-sub">' + d.sub + '</div>';
        details.appendChild(card);
    });
}

// --- Init ---
async function init() {
    // Fetch all data in parallel
    var results = await Promise.all([
        fetchJSON('/api/analytics/cycle-times'),
        fetchJSON('/api/analytics/oee'),
        fetchJSON('/api/analytics/bottleneck'),
    ]);

    var cycleData = results[0];
    var oeeData = results[1];
    var bottleneckData = results[2];

    if (!cycleData || !cycleData.length) {
        document.getElementById('station-cards-row').innerHTML =
            '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-tertiary)">No cycle time data available. Start the main server with CSV replay.</div>';
        return;
    }

    // Compute medians
    var medians = computeMedians(cycleData);

    // Render all sections
    renderGapBanner(medians);
    renderStationCards(medians);
    renderWaterfallChart(medians);
    renderOEEDecomposition(oeeData);
}

document.addEventListener('DOMContentLoaded', init);

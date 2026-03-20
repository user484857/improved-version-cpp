/* ============================================
   KPI R2A — Production Efficiency Gap Dashboard
   Round 2, Version A

   Sections:
     1. Hero banner — "Production Efficiency Gap: X%"
     2. Stacked comparison — actual vs. theoretical
     3. Per-station timing cards with traffic light
     4. What-If optimizer (interactive sliders)
     5. Time loss waterfall (collapsible)
   ============================================ */

// --- Constants ---
var THEORETICAL = { HBW: 12.0, Crane: 12.0, MS: 18.0, PM: 5.0, SL: 6.0 };
var STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#5AC8FA'
};
var STATION_NAMES = {
    HBW: 'High Bay Warehouse',
    Crane: 'Crane Transport',
    MS: 'Testing Station',
    PM: 'Punching Machine',
    SL: 'Sorting Line'
};
var STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];

// State
var medians = {};
var waterfallChart = null;
var whatifValues = {};

// --- Theme ---
function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    if (waterfallChart) updateChartTheme();
    updateSliderStyles();
}

function getThemeColors() {
    var s = getComputedStyle(document.documentElement);
    return {
        text:     s.getPropertyValue('--text-primary').trim(),
        textSec:  s.getPropertyValue('--text-secondary').trim(),
        textTert: s.getPropertyValue('--text-tertiary').trim(),
        grid:     s.getPropertyValue('--chart-grid').trim(),
        tick:     s.getPropertyValue('--chart-tick').trim(),
        green:    s.getPropertyValue('--green').trim(),
        red:      s.getPropertyValue('--red').trim(),
        blue:     s.getPropertyValue('--blue').trim(),
        orange:   s.getPropertyValue('--orange').trim(),
    };
}

function updateChartTheme() {
    if (!waterfallChart) return;
    var c = getThemeColors();
    var opts = waterfallChart.options;
    if (opts.scales) {
        Object.values(opts.scales).forEach(function(scale) {
            if (scale.grid) scale.grid.color = c.grid;
            if (scale.ticks) scale.ticks.color = c.tick;
            if (scale.title) scale.title.color = c.textSec;
        });
    }
    waterfallChart.update('none');
}

// --- Data ---
async function fetchJSON(url) {
    try {
        var r = await fetch(url);
        if (!r.ok) throw new Error(r.statusText);
        return await r.json();
    } catch (e) {
        console.error('Fetch error:', url, e);
        return null;
    }
}

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

    var result = {};
    STATION_ORDER.forEach(function(st) {
        var arr = stationVals[st].slice().sort(function(a, b) { return a - b; });
        if (arr.length === 0) { result[st] = null; return; }
        var mid = Math.floor(arr.length / 2);
        result[st] = arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    });

    return result;
}

// --- Gap Classification ---
function getGapInfo(actual, target) {
    if (actual === null || target === null || target === 0) return { pct: 0, cls: 'green', label: 'N/A' };
    var pct = ((actual - target) / target) * 100;
    if (pct <= 10) return { pct: pct, cls: 'green', label: 'On Target' };
    if (pct <= 30) return { pct: pct, cls: 'orange', label: 'Caution' };
    return { pct: pct, cls: 'red', label: 'Over Target' };
}

// --- Collapsible ---
function toggleCollapsible(headerEl) {
    var body = headerEl.nextElementSibling;
    if (!body || !body.classList.contains('collapsible-body')) return;
    var isExpanded = body.classList.contains('expanded');
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
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// =========================================================================
// SECTION 1: Hero Banner
// =========================================================================
function renderHeroBanner() {
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
    var excess = totalActual - totalTarget;

    // Gap value
    var valEl = document.getElementById('hero-gap-value');
    valEl.textContent = gapPct.toFixed(1);

    // Color the value
    var unitEl = document.querySelector('.hero-unit');
    if (gapPct <= 10) {
        valEl.style.color = 'var(--green)';
        valEl.style.textShadow = '0 0 40px rgba(48, 209, 88, 0.25)';
        unitEl.style.color = 'var(--green)';
    } else if (gapPct <= 25) {
        valEl.style.color = 'var(--orange)';
        valEl.style.textShadow = '0 0 40px rgba(255, 159, 10, 0.25)';
        unitEl.style.color = 'var(--orange)';
    } else {
        valEl.style.color = 'var(--red)';
        valEl.style.textShadow = '0 0 40px rgba(255, 69, 58, 0.25)';
        unitEl.style.color = 'var(--red)';
    }

    // Efficiency bar
    document.getElementById('hero-bar-eff').style.width = effPct.toFixed(1) + '%';
    document.getElementById('hero-bar-gap').style.width = (100 - effPct).toFixed(1) + '%';

    // Labels
    document.getElementById('hero-label-eff').textContent = 'Efficient: ' + effPct.toFixed(1) + '%';
    document.getElementById('hero-label-gap').textContent = 'Gap: ' + (100 - effPct).toFixed(1) + '%';

    // Totals
    document.getElementById('hero-actual-total').textContent = 'Actual: ' + totalActual.toFixed(1) + 's';
    document.getElementById('hero-target-total').textContent = 'Target: ' + totalTarget.toFixed(1) + 's';
    document.getElementById('hero-excess-total').textContent = 'Excess: +' + excess.toFixed(1) + 's';
}

// =========================================================================
// SECTION 2: Stacked Comparison Bars
// =========================================================================
function renderStackedBars(runCount) {
    var totalActual = 0;
    var totalTarget = 0;

    STATION_ORDER.forEach(function(st) {
        totalActual += (medians[st] || 0);
        totalTarget += THEORETICAL[st];
    });

    var maxTotal = Math.max(totalActual, totalTarget);
    if (maxTotal <= 0) return;

    document.getElementById('stacked-runs-label').textContent = runCount + ' runs (median)';

    // Build actual segments
    var actualTrack = document.getElementById('stacked-actual-track');
    actualTrack.innerHTML = '';

    STATION_ORDER.forEach(function(st) {
        var val = medians[st] || 0;
        var pct = (val / maxTotal) * 100;
        var seg = document.createElement('div');
        seg.className = 'stacked-segment';
        seg.style.width = pct.toFixed(2) + '%';
        seg.style.background = 'linear-gradient(135deg, ' + STATION_COLORS[st] + ', ' + hexToRgba(STATION_COLORS[st], 0.75) + ')';
        if (pct > 8) {
            seg.textContent = val.toFixed(1) + 's';
        }
        seg.title = st + ': ' + val.toFixed(1) + 's (actual)';
        actualTrack.appendChild(seg);
    });

    document.getElementById('stacked-actual-total').textContent = totalActual.toFixed(1) + 's';

    // Build target segments
    var targetTrack = document.getElementById('stacked-target-track');
    targetTrack.innerHTML = '';

    STATION_ORDER.forEach(function(st) {
        var val = THEORETICAL[st];
        var pct = (val / maxTotal) * 100;
        var seg = document.createElement('div');
        seg.className = 'stacked-segment';
        seg.style.width = pct.toFixed(2) + '%';
        seg.style.background = 'linear-gradient(135deg, ' + hexToRgba(STATION_COLORS[st], 0.4) + ', ' + hexToRgba(STATION_COLORS[st], 0.25) + ')';
        if (pct > 8) {
            seg.textContent = val.toFixed(1) + 's';
        }
        seg.title = st + ': ' + val.toFixed(1) + 's (target)';
        targetTrack.appendChild(seg);
    });

    document.getElementById('stacked-target-total').textContent = totalTarget.toFixed(1) + 's';

    // Legend
    var legend = document.getElementById('stacked-legend');
    legend.innerHTML = '';
    STATION_ORDER.forEach(function(st) {
        var item = document.createElement('div');
        item.className = 'stacked-legend-item';
        item.innerHTML = '<span class="stacked-legend-dot" style="background:' + STATION_COLORS[st] + '"></span>' + st;
        legend.appendChild(item);
    });
}

// =========================================================================
// SECTION 3: Per-Station Timing Cards
// =========================================================================
function renderStationCards() {
    var container = document.getElementById('station-cards-grid');
    container.innerHTML = '';

    // Find max for bar scaling
    var maxTime = 0;
    STATION_ORDER.forEach(function(st) {
        var v = medians[st] || 0;
        if (v > maxTime) maxTime = v;
        if (THEORETICAL[st] > maxTime) maxTime = THEORETICAL[st];
    });

    STATION_ORDER.forEach(function(st) {
        var actual = medians[st];
        var target = THEORETICAL[st];
        var gap = getGapInfo(actual, target);
        var color = STATION_COLORS[st];

        var card = document.createElement('div');
        card.className = 'station-timing-card glass';

        // Top accent bar
        var accent = document.createElement('div');
        accent.className = 'station-accent';
        accent.style.background = 'linear-gradient(90deg, ' + color + ', ' + hexToRgba(color, 0.3) + ')';
        card.appendChild(accent);

        // Header
        var head = document.createElement('div');
        head.className = 'station-card-head';

        var nameWrap = document.createElement('div');
        var nameEl = document.createElement('span');
        nameEl.className = 'station-card-name';
        nameEl.style.color = color;
        nameEl.textContent = st;

        var fullname = document.createElement('span');
        fullname.className = 'station-card-fullname';
        fullname.textContent = STATION_NAMES[st];

        nameWrap.appendChild(nameEl);
        nameWrap.appendChild(fullname);
        head.appendChild(nameWrap);

        var dot = document.createElement('div');
        dot.className = 'station-traffic-dot traffic-' + gap.cls;
        dot.title = gap.label;
        head.appendChild(dot);

        card.appendChild(head);

        // Actual time
        var times = document.createElement('div');
        times.className = 'station-card-times';

        var actualEl = document.createElement('span');
        actualEl.className = 'station-card-actual';
        actualEl.textContent = actual !== null ? actual.toFixed(1) : '--';
        times.appendChild(actualEl);

        var unitEl = document.createElement('span');
        unitEl.className = 'station-card-unit';
        unitEl.textContent = 's';
        times.appendChild(unitEl);

        card.appendChild(times);

        // Meta: target + gap
        var meta = document.createElement('div');
        meta.className = 'station-card-meta';

        var targetEl = document.createElement('span');
        targetEl.className = 'station-card-target';
        targetEl.textContent = 'Target ' + target.toFixed(1) + 's';
        meta.appendChild(targetEl);

        var gapEl = document.createElement('span');
        gapEl.className = 'station-card-gap';
        if (actual !== null && actual > target) {
            gapEl.className += ' gap-over';
            gapEl.textContent = '+' + (actual - target).toFixed(1) + 's';
        } else if (actual !== null) {
            gapEl.className += ' gap-ok';
            gapEl.textContent = '-' + (target - actual).toFixed(1) + 's';
        } else {
            gapEl.textContent = '--';
            gapEl.style.color = 'var(--text-tertiary)';
        }
        meta.appendChild(gapEl);

        card.appendChild(meta);

        // Mini bar
        var barTrack = document.createElement('div');
        barTrack.className = 'station-mini-bar-track';

        if (actual !== null && maxTime > 0) {
            var actualPct = (actual / (maxTime * 1.1)) * 100;
            var targetPct = (target / (maxTime * 1.1)) * 100;

            var fill = document.createElement('div');
            fill.className = 'station-mini-bar-fill';
            fill.style.width = actualPct + '%';

            // Gradient: station color, but extend to red if over target
            if (actual > target) {
                var splitPct = (targetPct / actualPct * 100).toFixed(0);
                fill.style.background = 'linear-gradient(90deg, ' + color + ' ' + splitPct + '%, #FF453A 100%)';
            } else {
                fill.style.background = color;
            }
            barTrack.appendChild(fill);

            // Target marker
            var targetMarker = document.createElement('div');
            targetMarker.className = 'station-mini-bar-target';
            targetMarker.style.left = targetPct + '%';
            targetMarker.title = 'Target: ' + target.toFixed(1) + 's';
            barTrack.appendChild(targetMarker);
        }

        card.appendChild(barTrack);
        container.appendChild(card);
    });
}

// =========================================================================
// SECTION 4: What-If Optimizer
// =========================================================================
function renderWhatIf() {
    var container = document.getElementById('whatif-container');
    container.innerHTML = '';

    // Initialize whatif values from medians
    STATION_ORDER.forEach(function(st) {
        whatifValues[st] = medians[st] || THEORETICAL[st];
    });

    STATION_ORDER.forEach(function(st) {
        var actual = medians[st];
        var target = THEORETICAL[st];
        var color = STATION_COLORS[st];
        if (actual === null) actual = target;

        var row = document.createElement('div');
        row.className = 'whatif-row';

        // Station label
        var label = document.createElement('span');
        label.className = 'whatif-station-label';
        label.style.color = color;
        label.textContent = st;
        row.appendChild(label);

        // Slider area
        var sliderArea = document.createElement('div');
        sliderArea.className = 'whatif-slider-area';

        // Slider
        var slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'whatif-slider';
        slider.min = (target * 0.8).toFixed(1);
        slider.max = (actual * 1.1).toFixed(1);
        slider.step = '0.1';
        slider.value = actual.toFixed(1);
        slider.dataset.station = st;
        slider.dataset.color = color;

        // Set station color on slider thumb via CSS custom property
        slider.style.setProperty('--slider-color', color);

        // Style slider track with gradient
        updateSliderTrackStyle(slider, actual, target, color);

        slider.addEventListener('input', function(e) {
            var val = parseFloat(e.target.value);
            whatifValues[e.target.dataset.station] = val;
            updateSliderTrackStyle(e.target, val, THEORETICAL[e.target.dataset.station], e.target.dataset.color);

            // Update current value display
            var valDisplay = e.target.parentElement.parentElement.querySelector('.whatif-current-val');
            if (valDisplay) valDisplay.textContent = val.toFixed(1) + 's';

            updateWhatIfResult();
        });

        // Labels below slider
        var labels = document.createElement('div');
        labels.className = 'whatif-slider-labels';
        labels.innerHTML = '<span>Target: ' + target.toFixed(1) + 's</span><span>Actual: ' + actual.toFixed(1) + 's</span>';

        sliderArea.appendChild(slider);
        sliderArea.appendChild(labels);
        row.appendChild(sliderArea);

        // Current value display
        var valDisplay = document.createElement('span');
        valDisplay.className = 'whatif-current-val';
        valDisplay.style.color = color;
        valDisplay.textContent = actual.toFixed(1) + 's';
        row.appendChild(valDisplay);

        container.appendChild(row);
    });

    updateWhatIfResult();
}

function updateSliderTrackStyle(slider, currentVal, target, color) {
    var min = parseFloat(slider.min);
    var max = parseFloat(slider.max);
    var val = parseFloat(slider.value);
    var pct = ((val - min) / (max - min)) * 100;

    // Slider track: colored portion up to thumb, dim after
    var bgColor = hexToRgba(color, 0.3);
    var dimColor = 'rgba(255,255,255,0.06)';
    var theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'light') dimColor = 'rgba(0,0,0,0.06)';

    slider.style.background = 'linear-gradient(90deg, ' + bgColor + ' 0%, ' + bgColor + ' ' + pct + '%, ' + dimColor + ' ' + pct + '%, ' + dimColor + ' 100%)';
}

function updateSliderStyles() {
    var sliders = document.querySelectorAll('.whatif-slider');
    sliders.forEach(function(slider) {
        var st = slider.dataset.station;
        var color = slider.dataset.color;
        var target = THEORETICAL[st];
        updateSliderTrackStyle(slider, whatifValues[st], target, color);
    });
}

function updateWhatIfResult() {
    var totalActual = 0;
    var totalProjected = 0;
    var totalTarget = 0;

    STATION_ORDER.forEach(function(st) {
        totalActual += (medians[st] || THEORETICAL[st]);
        totalProjected += whatifValues[st];
        totalTarget += THEORETICAL[st];
    });

    var projectedEl = document.getElementById('whatif-projected');
    projectedEl.textContent = totalProjected.toFixed(1) + 's';

    var saving = totalActual - totalProjected;
    if (saving > 0.05) {
        projectedEl.style.color = 'var(--green)';
    } else {
        projectedEl.style.color = 'var(--blue)';
    }

    // Bar visualization
    var maxBar = totalActual * 1.05;
    var currentPct = (totalActual / maxBar) * 100;
    var projectedPct = (totalProjected / maxBar) * 100;

    document.getElementById('whatif-bar-current').style.width = currentPct + '%';
    document.getElementById('whatif-bar-projected').style.width = projectedPct + '%';

    // Savings chips
    var savingsContainer = document.getElementById('whatif-savings');
    savingsContainer.innerHTML = '';

    var totalSaving = 0;

    STATION_ORDER.forEach(function(st) {
        var actual = medians[st] || THEORETICAL[st];
        var projected = whatifValues[st];
        var diff = actual - projected;
        totalSaving += diff;

        var chip = document.createElement('span');
        chip.className = 'whatif-savings-chip' + (Math.abs(diff) < 0.05 ? ' no-change' : '');

        var dot = document.createElement('span');
        dot.className = 'chip-dot';
        dot.style.background = STATION_COLORS[st];
        chip.appendChild(dot);

        var text = document.createTextNode(st + ': ');
        chip.appendChild(text);

        var valText = document.createTextNode(diff > 0.05 ? '-' + diff.toFixed(1) + 's' : (diff < -0.05 ? '+' + Math.abs(diff).toFixed(1) + 's' : '0.0s'));
        chip.appendChild(valText);

        savingsContainer.appendChild(chip);
    });

    // Total savings chip
    var totalChip = document.createElement('span');
    totalChip.className = 'whatif-savings-total';
    totalChip.textContent = 'Total: ' + (totalSaving > 0 ? '-' : '+') + Math.abs(totalSaving).toFixed(1) + 's';
    if (totalSaving > 0.05) {
        totalChip.style.color = 'var(--green)';
        totalChip.style.background = 'rgba(48, 209, 88, 0.08)';
        totalChip.style.borderColor = 'rgba(48, 209, 88, 0.15)';
    }
    savingsContainer.appendChild(totalChip);

    // New gap percentage
    var newGapPct = ((totalProjected - totalTarget) / totalTarget) * 100;
    var newEffPct = Math.min(100, (totalTarget / totalProjected) * 100);

    var gapChip = document.createElement('span');
    gapChip.className = 'whatif-savings-total';
    gapChip.textContent = 'New gap: ' + newGapPct.toFixed(1) + '%';
    if (newGapPct <= 10) {
        gapChip.style.color = 'var(--green)';
        gapChip.style.background = 'rgba(48, 209, 88, 0.08)';
        gapChip.style.borderColor = 'rgba(48, 209, 88, 0.15)';
    } else if (newGapPct <= 25) {
        gapChip.style.color = 'var(--orange)';
        gapChip.style.background = 'rgba(255, 159, 10, 0.08)';
        gapChip.style.borderColor = 'rgba(255, 159, 10, 0.15)';
    } else {
        gapChip.style.color = 'var(--red)';
        gapChip.style.background = 'rgba(255, 69, 58, 0.08)';
        gapChip.style.borderColor = 'rgba(255, 69, 58, 0.15)';
    }
    savingsContainer.appendChild(gapChip);
}

// =========================================================================
// SECTION 5: Waterfall Chart
// =========================================================================
function renderWaterfallChart() {
    var c = getThemeColors();

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

    // Chart data
    var labels = excessData.map(function(d) { return d.station; });
    labels.push('TOTAL');

    var bases = excessData.map(function(d) { return d.excess > 0 ? d.base : 0; });
    bases.push(0);

    var values = excessData.map(function(d) { return d.excess; });
    values.push(totalExcess);

    // Use station colors for individual bars, red for total
    var barBgColors = excessData.map(function(d) {
        return d.excess > 0 ? hexToRgba(d.color, 0.65) : hexToRgba('#30D158', 0.65);
    });
    barBgColors.push('rgba(255, 69, 58, 0.75)');

    var barBorderColors = excessData.map(function(d) {
        return d.excess > 0 ? d.color : '#30D158';
    });
    barBorderColors.push('#FF453A');

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
                    barThickness: 40,
                },
                {
                    label: 'Excess / Savings',
                    data: values.map(function(v) { return Math.abs(v); }),
                    backgroundColor: barBgColors,
                    borderColor: barBorderColors,
                    borderWidth: 1.5,
                    borderRadius: 6,
                    barThickness: 40,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.88)',
                    titleFont: { family: 'Inter', weight: '600', size: 13 },
                    bodyFont: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 12 },
                    padding: 14,
                    cornerRadius: 10,
                    callbacks: {
                        title: function(items) {
                            var idx = items[0].dataIndex;
                            if (idx < excessData.length) {
                                return excessData[idx].station + ' (' + STATION_NAMES[excessData[idx].station] + ')';
                            }
                            return 'Total Excess';
                        },
                        label: function(tipCtx) {
                            if (tipCtx.datasetIndex === 0) return null;
                            var idx = tipCtx.dataIndex;
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
                        font: { size: 12, weight: '600', family: 'Inter' },
                    }
                },
                y: {
                    stacked: true,
                    title: { display: true, text: 'Excess Time (seconds)', color: c.textSec, font: { size: 11, family: 'Inter' } },
                    grid: { color: c.grid },
                    ticks: {
                        color: c.tick,
                        font: { family: "'SF Mono', 'JetBrains Mono', monospace", size: 11 },
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
                var chartCtx = chart.ctx;
                var meta = chart.getDatasetMeta(1);

                meta.data.forEach(function(bar, i) {
                    var val = values[i];
                    var sign = val >= 0 ? '+' : '';
                    var labelText = sign + val.toFixed(1) + 's';

                    chartCtx.save();
                    chartCtx.font = "700 11px 'SF Mono', 'JetBrains Mono', monospace";
                    chartCtx.fillStyle = val >= 0 ? barBorderColors[i] : '#30D158';
                    chartCtx.textAlign = 'center';
                    chartCtx.textBaseline = 'bottom';
                    chartCtx.fillText(labelText, bar.x, bar.y - 6);
                    chartCtx.restore();
                });

                // Station color dots below x-axis labels
                var xScale = chart.scales.x;
                excessData.forEach(function(d, i) {
                    var xPos = xScale.getPixelForValue(i);
                    var yPos = xScale.bottom + 22;
                    chartCtx.save();
                    chartCtx.beginPath();
                    chartCtx.arc(xPos, yPos, 4, 0, Math.PI * 2);
                    chartCtx.fillStyle = d.color;
                    chartCtx.fill();
                    chartCtx.restore();
                });
            }
        }]
    });
}

// =========================================================================
// INIT
// =========================================================================
async function init() {
    var cycleData = await fetchJSON('/api/analytics/cycle-times');

    if (!cycleData || !cycleData.length) {
        document.getElementById('station-cards-grid').innerHTML =
            '<div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--text-tertiary);font-size:0.85rem;">' +
            'No cycle time data available. Start the server with CSV replay.' +
            '</div>';
        return;
    }

    // Compute medians
    medians = computeMedians(cycleData);

    // Render all sections
    renderHeroBanner();
    renderStackedBars(cycleData.length);
    renderStationCards();
    renderWhatIf();
    renderWaterfallChart();
}

document.addEventListener('DOMContentLoaded', init);

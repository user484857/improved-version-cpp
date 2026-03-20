/**
 * Command Center V3 — Flight Deck / NOC Dashboard
 *
 * Dense single-screen view: everything visible in 10 seconds.
 * Polls /api/data every 1.5s for station status.
 * Fetches analytics once on load for KPIs, alerts, timeline.
 */

const STATIONS = ['HBW', 'Crane', 'MS', 'PM', 'SL'];
const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};
const STATION_LABELS = {
    HBW: 'Storage', Crane: 'Handler', MS: 'Machining', PM: 'Punching', SL: 'Sorting'
};

let pollTimer = null;
let lastFetchTime = 0;
let analyticsLoaded = false;

// ============================================
//  Theme
// ============================================

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

// ============================================
//  Clock
// ============================================

function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const clockEl = document.getElementById('cc-clock');
    if (clockEl) clockEl.textContent = h + ':' + m + ':' + s;

    // Uptime indicator
    const uptimeEl = document.getElementById('cc-uptime');
    if (uptimeEl && lastFetchTime > 0) {
        const ago = Math.round((Date.now() - lastFetchTime) / 1000);
        uptimeEl.textContent = 'UPD ' + ago + 's';
        if (ago > 10) {
            uptimeEl.style.color = 'var(--cc-orange)';
        } else {
            uptimeEl.style.color = '';
        }
    }
}

// ============================================
//  Init
// ============================================

async function init() {
    updateClock();
    setInterval(updateClock, 1000);
    loadAnalytics();
    startPolling();
}

// ============================================
//  Analytics (one-time load)
// ============================================

async function loadAnalytics() {
    try {
        const [summaryRes, alertsRes, cycleRes, qualityRes, bottleneckRes] = await Promise.all([
            fetch('/api/analytics/summary'),
            fetch('/api/analytics/alerts'),
            fetch('/api/analytics/cycle-times'),
            fetch('/api/analytics/quality-grades'),
            fetch('/api/analytics/bottleneck'),
        ]);

        const summary = await summaryRes.json();
        const alerts = await alertsRes.json();
        const cycleTimes = await cycleRes.json();
        const qualityGrades = await qualityRes.json();
        const bottleneck = await bottleneckRes.json();

        analyticsLoaded = true;

        renderMetrics(summary, bottleneck);
        renderTimeline(qualityGrades);
        renderAlerts(alerts);
        renderCycleTimes(cycleTimes);
        renderShiftSummary(summary, cycleTimes, alerts);
    } catch (e) {
        console.error('Analytics load failed:', e);
    }
}

// ============================================
//  Metrics (2x2 grid)
// ============================================

function renderMetrics(summary, bottleneck) {
    const oee = summary.oee || {};
    const throughput = summary.throughput || {};
    const quality = summary.quality || {};

    // OEE
    const oeeVal = oee.oee || 0;
    setMetric('oee',
        (oeeVal * 100).toFixed(1) + '%',
        oeeVal > 0.85 ? 'green' : oeeVal >= 0.65 ? 'yellow' : 'red',
        '',
        'flat',
        'A ' + ((oee.availability || 0) * 100).toFixed(0) + '% | P ' + ((oee.performance || 0) * 100).toFixed(0) + '% | Q ' + ((oee.quality || 0) * 100).toFixed(0) + '%'
    );

    // Quality (FPY)
    const fpy = quality.first_pass_yield || 0;
    const gradeDist = quality.grade_distribution || {};
    setMetric('quality',
        (fpy * 100).toFixed(1) + '%',
        fpy > 0.8 ? 'green' : fpy >= 0.5 ? 'yellow' : 'red',
        '',
        'flat',
        'A:' + (gradeDist.A || 0) + ' B:' + (gradeDist.B || 0) + ' C:' + (gradeDist.C || 0)
    );

    // Throughput
    const perHour = throughput.per_hour || 0;
    const util = throughput.utilization || 0;
    setMetric('throughput',
        perHour.toFixed(1) + '/h',
        util > 0.8 ? 'green' : util >= 0.5 ? 'yellow' : 'red',
        '',
        'flat',
        (throughput.total_runs || 0) + ' runs | ' + (throughput.total_time_min || 0).toFixed(1) + 'min'
    );

    // Bottleneck
    if (bottleneck && bottleneck.station) {
        const avgCt = bottleneck.avg_cycle_time || 0;
        const theo = bottleneck.theoretical || 0;
        const delta = avgCt - theo;
        setMetric('bottleneck',
            bottleneck.station,
            delta > 5 ? 'red' : delta > 2 ? 'yellow' : 'green',
            (delta > 0 ? '+' : '') + delta.toFixed(1) + 's',
            delta > 0 ? 'down' : 'up',
            'avg ' + avgCt.toFixed(1) + 's | theo ' + theo.toFixed(0) + 's'
        );
    }
}

function setMetric(id, value, lightColor, trendText, trendDir, subText) {
    const valEl = document.getElementById('val-' + id);
    const lightEl = document.getElementById('light-' + id);
    const trendEl = document.getElementById('trend-' + id);
    const subEl = document.getElementById('sub-' + id);

    if (valEl) valEl.textContent = value;
    if (lightEl) {
        lightEl.className = 'cc-metric-light ' + lightColor;
    }
    if (trendEl) {
        trendEl.textContent = trendText;
        trendEl.className = 'cc-metric-trend mono ' + trendDir;
    }
    if (subEl) subEl.textContent = subText;
}

// ============================================
//  Production Timeline (sparkline of grades)
// ============================================

function renderTimeline(qualityGrades) {
    const track = document.getElementById('cc-timeline-track');
    const countEl = document.getElementById('timeline-count');
    if (!track || !qualityGrades || qualityGrades.length === 0) return;

    // Show last 20 runs max for visual clarity
    const runs = qualityGrades.slice(-20);
    countEl.textContent = qualityGrades.length + ' runs';

    let html = '';
    for (const run of runs) {
        const grade = (run.grade || 'unknown').toLowerCase();
        const gradeClass = 'grade-' + (grade === 'a' || grade === 'b' || grade === 'c' ? grade : 'unknown');
        const ct = run.burn_time ? run.burn_time.toFixed(1) + 's' : '--';
        html += '<div class="cc-timeline-block ' + gradeClass + '">' +
                '<span class="cc-block-tooltip">Run #' + run.run + ' | Grade ' + (run.grade || '?') + ' | ' + ct + '</span>' +
                '</div>';
    }

    track.innerHTML = html;
}

// ============================================
//  Alerts
// ============================================

function renderAlerts(alerts) {
    const feed = document.getElementById('cc-alert-feed');
    const countEl = document.getElementById('alert-count');
    if (!feed) return;

    if (!alerts || alerts.length === 0) {
        feed.innerHTML = '<div class="cc-alert-empty mono">NO ALERTS</div>';
        if (countEl) countEl.textContent = '0';
        return;
    }

    if (countEl) countEl.textContent = String(alerts.length);

    // Sort: errors first, then by recency
    const sevOrder = { error: 0, warning: 1, info: 2 };
    const sorted = [...alerts].sort((a, b) => {
        const sa = sevOrder[a.severity] ?? 3;
        const sb = sevOrder[b.severity] ?? 3;
        if (sa !== sb) return sa - sb;
        return (b.run || 0) - (a.run || 0);
    });

    // Show top 5
    const display = sorted.slice(0, 5);

    let html = '';
    for (const a of display) {
        const sev = a.severity || 'info';
        const stationColor = STATION_COLORS[a.station] || '#5AC8FA';
        const runText = a.run ? 'R#' + a.run : '';
        const tsText = a.timestamp ? a.timestamp.split(' ')[1] || '' : '';

        html += '<div class="cc-alert-item ' + sev + '">' +
                '<span class="cc-alert-badge" style="background:' + stationColor + '">' + (a.station || '--') + '</span>' +
                '<div class="cc-alert-body">' +
                '<div class="cc-alert-msg">' + (a.message || 'Unknown') + '</div>' +
                '<div class="cc-alert-meta">' + runText + (tsText ? ' | ' + tsText : '') + '</div>' +
                '</div>' +
                '</div>';
    }

    if (sorted.length > 5) {
        html += '<div class="cc-alert-meta" style="padding:6px 16px;text-align:center">+ ' + (sorted.length - 5) + ' more alerts</div>';
    }

    feed.innerHTML = html;
}

// ============================================
//  Cycle Times (for station rows)
// ============================================

function renderCycleTimes(cycleTimes) {
    if (!cycleTimes || cycleTimes.length === 0) return;

    // Average cycle time per station across all runs
    const sums = {};
    const counts = {};
    for (const station of STATIONS) {
        sums[station] = 0;
        counts[station] = 0;
    }

    for (const run of cycleTimes) {
        for (const station of STATIONS) {
            const ct = run.stations[station];
            if (ct != null) {
                sums[station] += ct;
                counts[station]++;
            }
        }
    }

    for (const station of STATIONS) {
        const el = document.getElementById('cycle-' + station);
        if (!el) continue;
        if (counts[station] > 0) {
            const avg = sums[station] / counts[station];
            el.textContent = avg.toFixed(1) + 's';
        } else {
            el.textContent = '--';
        }
    }
}

// ============================================
//  Shift Summary
// ============================================

function renderShiftSummary(summary, cycleTimes, alerts) {
    const quality = summary.quality || {};
    const throughput = summary.throughput || {};
    const gradeDist = quality.grade_distribution || {};

    // Runs
    const runsEl = document.getElementById('shift-runs');
    if (runsEl) runsEl.textContent = String(quality.total_produced || throughput.total_runs || 0);

    // Total time
    const timeEl = document.getElementById('shift-time');
    if (timeEl && throughput.total_time_min != null) {
        timeEl.textContent = throughput.total_time_min.toFixed(1) + 'min';
    }

    // Best / Worst station by average cycle time
    if (cycleTimes && cycleTimes.length > 0) {
        const avgs = {};
        const counts = {};
        for (const station of STATIONS) {
            avgs[station] = 0;
            counts[station] = 0;
        }
        for (const run of cycleTimes) {
            for (const station of STATIONS) {
                const ct = run.stations[station];
                if (ct != null) {
                    avgs[station] += ct;
                    counts[station]++;
                }
            }
        }

        let bestStation = null, bestAvg = Infinity;
        let worstStation = null, worstAvg = -Infinity;

        for (const station of STATIONS) {
            if (counts[station] > 0) {
                const avg = avgs[station] / counts[station];
                if (avg < bestAvg) { bestAvg = avg; bestStation = station; }
                if (avg > worstAvg) { worstAvg = avg; worstStation = station; }
            }
        }

        const bestEl = document.getElementById('shift-best');
        const worstEl = document.getElementById('shift-worst');
        if (bestEl && bestStation) bestEl.textContent = bestStation + ' ' + bestAvg.toFixed(1) + 's';
        if (worstEl && worstStation) worstEl.textContent = worstStation + ' ' + worstAvg.toFixed(1) + 's';
    }

    // Grades
    const gradesEl = document.getElementById('shift-grades');
    if (gradesEl) {
        const aCount = gradeDist.A || 0;
        const bCount = gradeDist.B || 0;
        const cCount = gradeDist.C || 0;
        gradesEl.innerHTML =
            '<span class="cc-grade-pip" style="background:#FFD60A"></span>' + aCount +
            ' <span class="cc-grade-pip" style="background:#FF9F0A"></span>' + bCount +
            ' <span class="cc-grade-pip" style="background:#636366"></span>' + cCount;
    }
}

// ============================================
//  Live Polling — Station Status
// ============================================

function startPolling() {
    pollOnce();
}

async function pollOnce() {
    try {
        const res = await fetch('/api/data');
        const json = await res.json();
        lastFetchTime = Date.now();
        updateStations(json.data || {});
        updateBanner(json.data || {});
    } catch (e) {
        // All idle on error
        for (const station of STATIONS) {
            setStationActive(station, false);
        }
        setBanner(false, []);
    }
    pollTimer = setTimeout(pollOnce, 1500);
}

function updateStations(data) {
    const activeStations = [];

    for (const station of STATIONS) {
        const stationData = data[station];
        let isActive = false;

        if (stationData) {
            for (const [groupName, vars] of Object.entries(stationData)) {
                for (const [label, value] of Object.entries(vars)) {
                    if (typeof value === 'boolean' && value === true) {
                        if (/motor|valve|lamp|compressor/i.test(label)) {
                            isActive = true;
                        }
                    }
                }
            }
        }

        setStationActive(station, isActive);
        if (isActive) activeStations.push(station);
    }

    // Update active detail
    const activeNameEl = document.getElementById('cc-active-name');
    if (activeNameEl) {
        if (activeStations.length > 0) {
            activeNameEl.textContent = activeStations.join(' + ');
            activeNameEl.style.color = 'var(--cc-blue)';
        } else {
            activeNameEl.textContent = 'NONE';
            activeNameEl.style.color = 'var(--cc-text-muted)';
        }
    }
}

function setStationActive(station, active) {
    const row = document.getElementById('station-row-' + station);
    const statusEl = document.getElementById('status-' + station);
    if (!row || !statusEl) return;

    if (active) {
        row.classList.add('active');
        statusEl.textContent = 'RUN';
        statusEl.classList.add('active-status');
    } else {
        row.classList.remove('active');
        statusEl.textContent = 'IDLE';
        statusEl.classList.remove('active-status');
    }
}

function updateBanner(data) {
    let anyActive = false;
    const activeList = [];

    for (const station of STATIONS) {
        const stationData = data[station];
        if (stationData) {
            for (const [groupName, vars] of Object.entries(stationData)) {
                for (const [label, value] of Object.entries(vars)) {
                    if (typeof value === 'boolean' && value === true) {
                        if (/motor|valve|lamp|compressor/i.test(label)) {
                            anyActive = true;
                            if (!activeList.includes(station)) activeList.push(station);
                        }
                    }
                }
            }
        }
    }

    setBanner(anyActive, activeList);
}

function setBanner(running, activeStations) {
    const banner = document.getElementById('cc-banner');
    const label = document.getElementById('cc-banner-label');
    if (!banner || !label) return;

    banner.classList.remove('running', 'idle');

    if (running) {
        banner.classList.add('running');
        label.textContent = 'RUNNING';
    } else {
        banner.classList.add('idle');
        label.textContent = 'IDLE';
    }
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

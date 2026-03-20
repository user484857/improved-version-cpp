/**
 * Cockpit v2 -- Status Board with Expandable SQCDP Tiles
 *
 * Design: Progressive disclosure. Each tile shows a summary value;
 * clicking expands it to reveal detailed breakdowns.
 *
 * Data sources:
 *   - /api/analytics/summary   -> OEE, throughput, quality grades, bottleneck
 *   - /api/analytics/alerts    -> anomaly alerts
 *   - /api/analytics/cycle-times -> per-station cycle times
 *   - /api/analytics/oee       -> A x P x Q breakdown
 *   - /api/analytics/throughput -> delivery metrics
 *   - /api/data                -> live station status (polled every 2s)
 */

const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};
const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];
const STATION_LABELS = {
    HBW: 'HBW', Crane: 'Crane', MS: 'MS', PM: 'PM', SL: 'SL'
};
const THEORETICAL_CYCLE = { HBW: 12.0, Crane: 12.0, MS: 18.0, PM: 5.0, SL: 6.0 };

let pollTimer = null;
let lastSuccessfulFetch = 0;
let analyticsCache = {};
let alertsExpanded = false;
let prevThroughput = null;

// ============================================
//  Theme
// ============================================

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

// ============================================
//  Tile Expand / Collapse
// ============================================

function toggleTile(key) {
    const tile = document.getElementById('tile-' + key);
    if (!tile) return;
    const wasExpanded = tile.classList.contains('expanded');

    // Close all tiles first for clean behavior
    document.querySelectorAll('.sqcdp-tile.expanded').forEach(t => {
        t.classList.remove('expanded');
    });

    // Toggle the clicked one (if it was closed, open it)
    if (!wasExpanded) {
        tile.classList.add('expanded');
    }
}

// ============================================
//  Initialization
// ============================================

async function init() {
    await loadAllAnalytics();
    startPolling();
    setInterval(updateFreshness, 1000);
}

async function loadAllAnalytics() {
    try {
        const [summaryRes, alertsRes, cycleRes, oeeRes, throughputRes] = await Promise.all([
            fetch('/api/analytics/summary'),
            fetch('/api/analytics/alerts'),
            fetch('/api/analytics/cycle-times'),
            fetch('/api/analytics/oee'),
            fetch('/api/analytics/throughput'),
        ]);

        const summary = await summaryRes.json();
        const alerts = await alertsRes.json();
        const cycleTimes = await cycleRes.json();
        const oee = await oeeRes.json();
        const throughput = await throughputRes.json();

        analyticsCache = { summary, alerts, cycleTimes, oee, throughput };

        renderHealthBannerMetrics(summary, throughput);
        renderSQCDP(summary);
        renderQualityDetail(summary);
        renderOEEDetail(oee);
        renderDeliveryDetail(throughput, cycleTimes);
        renderProcessDetail(cycleTimes);
        renderAlerts(alerts);
    } catch (e) {
        console.error('Failed to load analytics:', e);
    }
}

// ============================================
//  Health Banner (static metrics from analytics)
// ============================================

function renderHealthBannerMetrics(summary, throughput) {
    const tp = throughput || {};
    const quality = summary.quality || {};
    const fpy = quality.first_pass_yield || 0;

    const tpEl = document.getElementById('health-throughput');
    const fpyEl = document.getElementById('health-fpy');

    if (tpEl) tpEl.textContent = (tp.per_hour || 0).toFixed(0) + '/hr';
    if (fpyEl) fpyEl.textContent = (fpy * 100).toFixed(0) + '% FPY';
}

// ============================================
//  SQCDP Tile Values
// ============================================

function renderSQCDP(summary) {
    const oee = summary.oee || {};
    const throughput = summary.throughput || {};
    const quality = summary.quality || {};

    // S - Safety (hardcoded, no sensors)
    setTileValue('s', 'OK', 'green');

    // Q - Quality: FPY with thresholds from spec
    const fpy = quality.first_pass_yield || 0;
    const fpyPct = (fpy * 100).toFixed(1) + '%';
    const qColor = fpy > 0.60 ? 'green' : fpy >= 0.40 ? 'yellow' : 'red';
    setTileValue('q', fpyPct, qColor);

    // C - Cost / OEE
    const oeeVal = oee.oee || 0;
    const oeePct = (oeeVal * 100).toFixed(1) + '%';
    const cColor = oeeVal > 0.60 ? 'green' : oeeVal >= 0.40 ? 'yellow' : 'red';
    setTileValue('c', oeePct, cColor);

    // D - Delivery: throughput per hour with trend arrow
    const perHour = throughput.per_hour || 0;
    const dText = perHour.toFixed(1) + '/hr';
    const util = throughput.utilization || 0;
    const dColor = util > 0.80 ? 'green' : util >= 0.50 ? 'yellow' : 'red';
    setTileValue('d', dText, dColor);

    // Trend arrow for delivery
    const trendEl = document.getElementById('trend-d');
    if (trendEl) {
        if (prevThroughput !== null) {
            if (perHour > prevThroughput) {
                trendEl.textContent = '\u2191';
                trendEl.className = 'tile-trend up';
            } else if (perHour < prevThroughput) {
                trendEl.textContent = '\u2193';
                trendEl.className = 'tile-trend down';
            } else {
                trendEl.textContent = '\u2192';
                trendEl.className = 'tile-trend flat';
            }
        } else {
            trendEl.textContent = '\u2192';
            trendEl.className = 'tile-trend flat';
        }
        prevThroughput = perHour;
    }

    // P - Process / Uptime: availability
    const avail = oee.availability || 0;
    const availPct = (avail * 100).toFixed(1) + '%';
    const pColor = avail > 0.90 ? 'green' : avail >= 0.70 ? 'yellow' : 'red';
    setTileValue('p', availPct, pColor);
}

function setTileValue(key, value, colorClass) {
    const tile = document.getElementById('tile-' + key);
    const valEl = document.getElementById('val-' + key);
    if (!tile || !valEl) return;

    tile.classList.remove('green', 'yellow', 'red', 'neutral');
    tile.classList.add(colorClass);
    valEl.textContent = value;
}

// ============================================
//  Expanded Detail: Quality
// ============================================

function renderQualityDetail(summary) {
    const quality = summary.quality || {};
    const dist = quality.grade_distribution || {};
    const total = quality.total_produced || 1;

    const a = dist.A || 0;
    const b = dist.B || 0;
    const c = dist.C || 0;

    setBar('bar-a', 'count-a', a, total);
    setBar('bar-b', 'count-b', b, total);
    setBar('bar-c', 'count-c', c, total);
}

function setBar(barId, countId, count, total) {
    const bar = document.getElementById(barId);
    const countEl = document.getElementById(countId);
    if (bar) bar.style.width = (total > 0 ? (count / total) * 100 : 0) + '%';
    if (countEl) countEl.textContent = count;
}

// ============================================
//  Expanded Detail: OEE
// ============================================

function renderOEEDetail(oee) {
    const a = oee.availability || 0;
    const p = oee.performance || 0;
    const q = oee.quality || 0;

    setOEEBar('oee-avail', 'oee-avail-val', a);
    setOEEBar('oee-perf', 'oee-perf-val', p);
    setOEEBar('oee-qual', 'oee-qual-val', q);
}

function setOEEBar(barId, valId, value) {
    const bar = document.getElementById(barId);
    const valEl = document.getElementById(valId);
    if (bar) bar.style.width = Math.min(value * 100, 100) + '%';
    if (valEl) valEl.textContent = (value * 100).toFixed(1) + '%';
}

// ============================================
//  Expanded Detail: Delivery
// ============================================

function renderDeliveryDetail(throughput, cycleTimes) {
    const tp = throughput || {};
    const ct = cycleTimes || [];

    const runsEl = document.getElementById('del-runs');
    const avgEl = document.getElementById('del-avg');
    const totalEl = document.getElementById('del-total');
    const maxEl = document.getElementById('del-max');

    if (runsEl) runsEl.textContent = tp.total_runs || '--';

    if (avgEl && ct.length > 0) {
        const totals = ct.filter(r => r.total != null).map(r => r.total);
        if (totals.length > 0) {
            const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
            avgEl.textContent = avg.toFixed(1) + 's';
        }
    }

    if (totalEl) {
        const mins = tp.total_time_min || 0;
        if (mins > 0) {
            totalEl.textContent = mins.toFixed(1) + ' min';
        }
    }

    if (maxEl) {
        maxEl.textContent = (tp.theoretical_max || 0).toFixed(1) + '/hr';
    }
}

// ============================================
//  Expanded Detail: Process (Station Utilization)
// ============================================

function renderProcessDetail(cycleTimes) {
    const container = document.getElementById('station-bars');
    if (!container || !cycleTimes || cycleTimes.length === 0) return;

    // Average cycle time per station
    const sums = {};
    const counts = {};

    for (const run of cycleTimes) {
        for (const station of STATION_ORDER) {
            const ct = run.stations[station];
            if (ct != null) {
                sums[station] = (sums[station] || 0) + ct;
                counts[station] = (counts[station] || 0) + 1;
            }
        }
    }

    // Utilization = avg actual / theoretical
    let html = '';
    for (const station of STATION_ORDER) {
        const avg = counts[station] > 0 ? sums[station] / counts[station] : 0;
        const theo = THEORETICAL_CYCLE[station] || 1;
        // "Utilization" here shows how much of theoretical time is used
        // Higher = slower than theoretical = busier
        const pct = Math.min((avg / theo) * 100, 150);
        const color = STATION_COLORS[station] || '#5AC8FA';

        html += `<div class="station-bar-row">
            <span class="station-bar-name">${station}</span>
            <div class="station-bar-track">
                <div class="station-bar-fill" style="width:${Math.min(pct, 100)}%;background:${color}"></div>
            </div>
            <span class="station-bar-val">${avg.toFixed(1)}s</span>
        </div>`;
    }

    container.innerHTML = html;
}

// ============================================
//  Alerts
// ============================================

function renderAlerts(alerts) {
    const body = document.getElementById('alerts-body');
    const countEl = document.getElementById('alerts-count');
    const moreBtn = document.getElementById('show-more-btn');
    if (!body) return;

    // Sort: errors first, then warnings, info; newest first
    const severityOrder = { error: 0, warning: 1, info: 2 };
    const sorted = [...alerts].sort((a, b) => {
        const sA = severityOrder[a.severity] ?? 3;
        const sB = severityOrder[b.severity] ?? 3;
        if (sA !== sB) return sA - sB;
        return (b.run || 0) - (a.run || 0);
    });

    if (countEl) countEl.textContent = sorted.length;

    if (sorted.length === 0) {
        body.innerHTML = '<div class="alert-empty">No alerts detected</div>';
        if (moreBtn) moreBtn.style.display = 'none';
        return;
    }

    const display = alertsExpanded ? sorted : sorted.slice(0, 3);

    body.innerHTML = display.map(a => {
        const stationColor = STATION_COLORS[a.station] || '#5AC8FA';
        const sev = a.severity || 'info';
        const runText = a.run ? 'Run #' + a.run : '';
        const tsText = a.timestamp ? a.timestamp.split(' ')[1] || '' : '';

        return `<div class="v2-alert ${sev}">
            <span class="v2-alert-station" style="background:${stationColor}">${a.station || '--'}</span>
            <div class="v2-alert-body">
                <div class="v2-alert-msg">${a.message || 'Unknown'}</div>
                <div class="v2-alert-meta">${runText}${tsText ? ' \u00b7 ' + tsText : ''}</div>
            </div>
        </div>`;
    }).join('');

    if (moreBtn) {
        if (!alertsExpanded && sorted.length > 3) {
            moreBtn.style.display = 'block';
            moreBtn.textContent = 'Show all ' + sorted.length + ' alerts';
        } else {
            moreBtn.style.display = 'none';
        }
    }
}

function expandAlerts() {
    alertsExpanded = true;
    if (analyticsCache.alerts) renderAlerts(analyticsCache.alerts);
}

// ============================================
//  Live Polling (station status + health banner)
// ============================================

function startPolling() {
    pollOnce();
}

async function pollOnce() {
    try {
        const res = await fetch('/api/data');
        const json = await res.json();
        lastSuccessfulFetch = Date.now();
        updateHealthBannerLive(json.data || {});
    } catch (e) {
        setHealthBannerState('idle', 'Disconnected');
    }
    pollTimer = setTimeout(pollOnce, 2000);
}

function updateHealthBannerLive(data) {
    let anyActive = false;

    for (const station of STATION_ORDER) {
        const stationData = data[station];
        if (stationData) {
            for (const [groupName, vars] of Object.entries(stationData)) {
                for (const [label, value] of Object.entries(vars)) {
                    if (typeof value === 'boolean' && value === true) {
                        if (/motor|valve|lamp|compressor/i.test(label)) {
                            anyActive = true;
                        }
                    }
                }
            }
        }
    }

    if (anyActive) {
        setHealthBannerState('running', 'Running');
    } else {
        setHealthBannerState('idle', 'Idle');
    }
}

function setHealthBannerState(state, label) {
    const banner = document.getElementById('health-banner');
    const textEl = document.getElementById('health-text');
    if (!banner) return;

    banner.classList.remove('running', 'idle');
    banner.classList.add(state);
    if (textEl) textEl.textContent = label;
}

// ============================================
//  Freshness Indicator
// ============================================

function updateFreshness() {
    const el = document.getElementById('health-freshness');
    const updEl = document.getElementById('last-updated');

    if (lastSuccessfulFetch === 0) {
        if (el) el.textContent = '--';
        if (updEl) { updEl.textContent = 'Last updated: --'; updEl.classList.remove('stale'); }
        return;
    }

    const secsAgo = Math.round((Date.now() - lastSuccessfulFetch) / 1000);

    if (el) el.textContent = 'Last: ' + secsAgo + 's ago';
    if (updEl) {
        updEl.textContent = 'Updated ' + secsAgo + 's ago';
        if (secsAgo > 30) {
            updEl.classList.add('stale');
        } else {
            updEl.classList.remove('stale');
        }
    }
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

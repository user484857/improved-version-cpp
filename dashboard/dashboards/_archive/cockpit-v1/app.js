/**
 * Cockpit V1 — Traffic Light Wall / Andon Board
 *
 * Giant indicators. Minimum text. Maximum signal.
 * Polls /api/data every 2s for station status.
 * Fetches analytics once on load for metrics + alerts.
 */

const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];
const STATION_COLORS = {
    HBW: '#AF52DE', Crane: '#30D158', MS: '#007AFF', PM: '#FF453A', SL: '#FF9F0A'
};

let lastFetch = 0;
let alertsOpen = false;
let alertData = [];

// ============================================
//  Init
// ============================================

async function init() {
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(updateStaleness, 1000);

    await loadAnalytics();
    pollLoop();
}

// ============================================
//  Analytics — one-time fetch
// ============================================

async function loadAnalytics() {
    try {
        const [summaryRes, alertsRes, throughputRes] = await Promise.all([
            fetch('/api/analytics/summary'),
            fetch('/api/analytics/alerts'),
            fetch('/api/analytics/throughput'),
        ]);

        const summary = await summaryRes.json();
        const alerts = await alertsRes.json();
        const throughput = await throughputRes.json();

        renderMetrics(summary, throughput);
        renderAlerts(alerts);
    } catch (e) {
        console.error('Analytics load failed:', e);
    }
}

// ============================================
//  Metrics — Quality, OEE, Throughput
// ============================================

function renderMetrics(summary, throughput) {
    const oee = summary.oee || {};
    const quality = summary.quality || {};

    // Quality — First Pass Yield
    const fpy = quality.first_pass_yield || 0;
    const fpyPct = Math.round(fpy * 100);
    setMetric('quality', fpyPct + '%', getTrafficColor(fpyPct, 80, 50));

    // OEE
    const oeeVal = oee.oee || 0;
    const oeePct = Math.round(oeeVal * 100);
    setMetric('oee', oeePct + '%', getTrafficColor(oeePct, 65, 40));

    // Throughput
    const perHour = throughput.per_hour || 0;
    const util = throughput.utilization || 0;
    const utilPct = Math.round(util * 100);
    setMetric('throughput', Math.round(perHour) + '/hr', getTrafficColor(utilPct, 70, 40));
}

function setMetric(id, value, color) {
    const valueEl = document.getElementById('value-' + id);
    const indicatorEl = document.getElementById('indicator-' + id);
    const blockEl = document.getElementById('metric-' + id);
    if (valueEl) valueEl.textContent = value;
    if (indicatorEl) {
        indicatorEl.className = 'metric-indicator ' + color;
    }
    if (blockEl) {
        blockEl.classList.remove('green-border', 'yellow-border', 'red-border');
        blockEl.classList.add(color + '-border');
    }
}

function getTrafficColor(value, greenThreshold, yellowThreshold) {
    if (value >= greenThreshold) return 'green';
    if (value >= yellowThreshold) return 'yellow';
    return 'red';
}

// ============================================
//  Alerts
// ============================================

function renderAlerts(alerts) {
    alertData = alerts || [];
    const badge = document.getElementById('alert-badge');
    const textEl = document.getElementById('alert-badge-text') || document.getElementById('alert-text');
    const list = document.getElementById('alert-list');

    const errorCount = alertData.filter(a => a.severity === 'error').length;
    const warnCount = alertData.filter(a => a.severity === 'warning').length;
    const totalCount = alertData.length;

    // Badge styling
    badge.classList.remove('has-alerts', 'has-errors', 'all-clear');

    if (totalCount === 0) {
        badge.classList.add('all-clear');
        textEl.textContent = 'NO ALERTS';
    } else if (errorCount > 0) {
        badge.classList.add('has-errors');
        textEl.textContent = totalCount + ' ALERT' + (totalCount !== 1 ? 'S' : '');
    } else {
        badge.classList.add('has-alerts');
        textEl.textContent = totalCount + ' ALERT' + (totalCount !== 1 ? 'S' : '');
    }

    // Build top 3 alerts in drawer
    const severityOrder = { error: 0, warning: 1, info: 2 };
    const sorted = [...alertData].sort((a, b) => {
        const sA = severityOrder[a.severity] || 3;
        const sB = severityOrder[b.severity] || 3;
        if (sA !== sB) return sA - sB;
        return (b.run || 0) - (a.run || 0);
    });

    const top3 = sorted.slice(0, 3);
    list.innerHTML = top3.map(a => {
        const bgColor = STATION_COLORS[a.station] || '#5AC8FA';
        return '<div class="alert-item ' + (a.severity || 'info') + '">' +
            '<span class="alert-station-tag" style="background:' + bgColor + '">' +
            (a.station || '--') + '</span>' +
            '<span class="alert-message">' + (a.message || 'Unknown') + '</span>' +
            '</div>';
    }).join('');
}

function toggleAlerts() {
    alertsOpen = !alertsOpen;
    const drawer = document.getElementById('alert-drawer');
    const chevron = document.getElementById('alert-chevron');
    if (drawer) drawer.classList.toggle('open', alertsOpen);
    if (chevron) chevron.classList.toggle('open', alertsOpen);
}

// ============================================
//  Station Polling — real-time status
// ============================================

async function pollLoop() {
    await pollOnce();
    setTimeout(pollLoop, 2000);
}

async function pollOnce() {
    try {
        const res = await fetch('/api/data');
        const json = await res.json();
        lastFetch = Date.now();

        const data = json.data || {};
        updateStations(data);
        updateBanner(data);
        updateFooterMode(json.mode || 'demo');
    } catch (e) {
        // All idle on error
        STATION_ORDER.forEach(s => setStationState(s, false));
        setBannerState('idle');
    }
}

function updateStations(data) {
    for (const station of STATION_ORDER) {
        const stationData = data[station];
        let isActive = false;

        if (stationData) {
            for (const [, vars] of Object.entries(stationData)) {
                for (const [label, value] of Object.entries(vars)) {
                    if (typeof value === 'boolean' && value === true) {
                        if (/motor|valve|lamp|compressor/i.test(label)) {
                            isActive = true;
                        }
                    }
                }
            }
        }

        setStationState(station, isActive);
    }
}

function setStationState(station, active) {
    const circle = document.getElementById('circle-' + station);
    const card = document.getElementById('station-' + station);
    if (!circle || !card) return;

    if (active) {
        circle.className = 'light-circle active-' + station;
        card.classList.add('active-station');
    } else {
        circle.className = 'light-circle idle';
        card.classList.remove('active-station');
    }
}

function updateBanner(data) {
    let anyActive = false;
    for (const station of STATION_ORDER) {
        const stationData = data[station];
        if (stationData) {
            for (const [, vars] of Object.entries(stationData)) {
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

    setBannerState(anyActive ? 'running' : 'idle');
}

function setBannerState(state) {
    const banner = document.getElementById('health-banner');
    const text = document.getElementById('health-text');
    if (!banner || !text) return;

    banner.classList.remove('running', 'idle', 'alert');
    banner.classList.add(state);

    switch (state) {
        case 'running':
            text.textContent = 'LINE RUNNING';
            break;
        case 'idle':
            text.textContent = 'LINE IDLE';
            break;
        case 'alert':
            text.textContent = 'LINE ALERT';
            break;
        default:
            text.textContent = 'CONNECTING...';
    }
}

// ============================================
//  Footer
// ============================================

function updateClock() {
    const el = document.getElementById('footer-time');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
}

function updateStaleness() {
    const el = document.getElementById('footer-updated');
    if (!el) return;
    if (lastFetch === 0) {
        el.textContent = '--';
        return;
    }
    const secs = Math.round((Date.now() - lastFetch) / 1000);
    el.textContent = secs + 's ago';
}

function updateFooterMode(mode) {
    const el = document.getElementById('footer-mode');
    if (!el) return;
    el.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
}

// ============================================
//  Start
// ============================================

document.addEventListener('DOMContentLoaded', init);

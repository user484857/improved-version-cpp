/* ============================================
   KPI V1 — OEE Hero Dashboard
   Pure metrics: OEE gauge, A*P*Q decomposition,
   bottleneck identification, station timing pills.
   ============================================ */

(function () {
    'use strict';

    // ---- Constants ----
    const THEORETICAL_CYCLE = { HBW: 12.0, Crane: 12.0, MS: 18.0, PM: 5.0, SL: 6.0 };
    const STATION_ORDER = ['HBW', 'Crane', 'MS', 'PM', 'SL'];
    const STATION_COLORS = {
        HBW:   { main: '#AF52DE', bg: 'rgba(175, 82, 222, 0.12)' },
        Crane: { main: '#30D158', bg: 'rgba(48, 209, 88, 0.12)' },
        MS:    { main: '#007AFF', bg: 'rgba(0, 122, 255, 0.12)' },
        PM:    { main: '#FF453A', bg: 'rgba(255, 69, 58, 0.12)' },
        SL:    { main: '#FF9F0A', bg: 'rgba(255, 159, 10, 0.12)' },
    };

    const POLL_INTERVAL = 4000;
    let animFrame = null;

    // ---- Theme ----
    window.toggleTheme = function () {
        const html = document.documentElement;
        const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    };

    // ---- Canvas Gauge Drawing ----

    function getGaugeColors() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        return {
            track: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            text:  isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.85)',
        };
    }

    /**
     * Draw a semi-circular gauge on a canvas.
     * @param {string} canvasId
     * @param {number} value - 0..1
     * @param {string} color - arc color
     * @param {object} opts - { lineWidth, radius, startAngle, endAngle }
     */
    function drawGauge(canvasId, value, color, opts = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width;
        const h = canvas.height;

        // HiDPI scaling
        if (!canvas._scaled) {
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.scale(dpr, dpr);
            canvas._scaled = true;
        }

        ctx.clearRect(0, 0, w, h);

        const lineWidth = opts.lineWidth || 14;
        const radius = opts.radius || (Math.min(w, h) * 0.42);
        const cx = w / 2;
        const cy = opts.cy || (h * 0.78);
        const startAngle = opts.startAngle || Math.PI;
        const endAngle = opts.endAngle || (2 * Math.PI);
        const sweepAngle = endAngle - startAngle;

        const gc = getGaugeColors();

        // Track
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.strokeStyle = gc.track;
        ctx.stroke();

        // Value arc
        if (value > 0.002) {
            const valEnd = startAngle + sweepAngle * Math.min(value, 1);
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, valEnd, false);
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.strokeStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    /**
     * Draw a full-circle ring gauge (for APQ mini gauges).
     */
    function drawRingGauge(canvasId, value, color, opts = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width;
        const h = canvas.height;

        if (!canvas._scaled) {
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.scale(dpr, dpr);
            canvas._scaled = true;
        }

        ctx.clearRect(0, 0, w, h);

        const lineWidth = opts.lineWidth || 10;
        const radius = (Math.min(w, h) / 2) - lineWidth - 4;
        const cx = w / 2;
        const cy = h / 2;
        const startAngle = -Math.PI / 2;
        const sweepAngle = 2 * Math.PI;

        const gc = getGaugeColors();

        // Track
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI, false);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = gc.track;
        ctx.stroke();

        // Value arc
        if (value > 0.002) {
            const valEnd = startAngle + sweepAngle * Math.min(value, 1);
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, valEnd, false);
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.strokeStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    // ---- Color helpers ----

    function oeeColor(val) {
        if (val >= 0.65) return '#30D158';
        if (val >= 0.40) return '#FF9F0A';
        return '#FF453A';
    }

    function factorClass(val) {
        if (val >= 0.70) return 'apq-good';
        if (val >= 0.45) return 'apq-warn';
        return 'apq-bad';
    }

    function factorColor(val) {
        if (val >= 0.70) return '#30D158';
        if (val >= 0.45) return '#FF9F0A';
        return '#FF453A';
    }

    // ---- Smooth number animation ----
    const _animValues = {};

    function animateValue(key, target, duration) {
        const now = performance.now();
        const prev = _animValues[key];
        if (prev && Math.abs(prev.target - target) < 0.001) return prev.current;

        if (!prev) {
            _animValues[key] = { current: target, target: target, start: now, startVal: target, duration: duration };
            return target;
        }

        _animValues[key] = { current: prev.current, target: target, start: now, startVal: prev.current, duration: duration };
        return prev.current;
    }

    function tickAnimations() {
        const now = performance.now();
        for (const key in _animValues) {
            const a = _animValues[key];
            const elapsed = now - a.start;
            const t = Math.min(elapsed / a.duration, 1);
            const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
            a.current = a.startVal + (a.target - a.startVal) * ease;
        }
    }

    function getAnimated(key) {
        return _animValues[key] ? _animValues[key].current : 0;
    }

    // ---- Data fetching ----

    async function fetchJSON(url) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) return null;
            return await resp.json();
        } catch (e) {
            return null;
        }
    }

    // ---- Rendering ----

    let _lastData = null;

    function renderAll() {
        if (!_lastData) return;
        const { oee, bottleneck, cycleTimes } = _lastData;

        tickAnimations();

        // -- OEE Hero gauge --
        const oeeVal = oee.oee || 0;
        const oeeAnim = animateValue('oee', oeeVal, 1200);
        const avail = oee.availability || 0;
        const perf = oee.performance || 0;
        const qual = oee.quality || 0;

        drawGauge('oee-gauge', getAnimated('oee'), oeeColor(oeeVal), {
            lineWidth: 20,
            radius: 150,
            cy: 190,
        });

        document.getElementById('oee-value').textContent = (getAnimated('oee') * 100).toFixed(1);
        document.getElementById('oee-runs').textContent = (oee.total_runs || 0) + ' runs';
        document.getElementById('oee-time').textContent = ((oee.total_time_s || 0) / 60).toFixed(1) + ' min recorded';

        // -- APQ mini gauges --
        animateValue('avail', avail, 1000);
        animateValue('perf', perf, 1000);
        animateValue('qual', qual, 1000);

        drawRingGauge('avail-gauge', getAnimated('avail'), factorColor(avail));
        drawRingGauge('perf-gauge', getAnimated('perf'), factorColor(perf));
        drawRingGauge('qual-gauge', getAnimated('qual'), factorColor(qual));

        const availEl = document.getElementById('avail-value');
        const perfEl = document.getElementById('perf-value');
        const qualEl = document.getElementById('qual-value');

        availEl.textContent = (getAnimated('avail') * 100).toFixed(1);
        perfEl.textContent = (getAnimated('perf') * 100).toFixed(1);
        qualEl.textContent = (getAnimated('qual') * 100).toFixed(1);

        availEl.className = 'apq-value ' + factorClass(avail);
        perfEl.className = 'apq-value ' + factorClass(perf);
        qualEl.className = 'apq-value ' + factorClass(qual);

        // Detail lines
        document.getElementById('avail-detail').textContent =
            `${((oee.active_time_s || 0) / 60).toFixed(1)} min active of ${((oee.total_time_s || 0) / 60).toFixed(1)} min`;
        document.getElementById('perf-detail').textContent =
            `Theoretical vs. actual speed`;
        document.getElementById('qual-detail').textContent =
            `${oee.grade_a_count || 0} Grade A of ${oee.total_runs || 0} runs`;

        // -- Bottleneck card --
        if (bottleneck) {
            document.getElementById('bottleneck-title').textContent =
                `${bottleneck.station} is the constraint at ${bottleneck.avg_cycle_time}s`;
            document.getElementById('bottleneck-sub').textContent =
                `Theoretical: ${bottleneck.theoretical}s \u2014 ${bottleneck.recommendation}`;
        } else {
            document.getElementById('bottleneck-title').textContent = 'No bottleneck data yet';
            document.getElementById('bottleneck-sub').textContent = '';
        }

        // -- Station timing pills --
        renderStationPills(cycleTimes, bottleneck);

        animFrame = requestAnimationFrame(renderAll);
    }

    function renderStationPills(cycleTimes, bottleneck) {
        const container = document.getElementById('station-pills');
        const bottleneckStation = bottleneck ? bottleneck.station : null;
        const averages = bottleneck ? bottleneck.all_averages : {};

        // Compute averages ourselves if bottleneck data lacks them
        let avgs = averages;
        if (!avgs || Object.keys(avgs).length === 0) {
            avgs = {};
            if (cycleTimes && cycleTimes.length) {
                for (const s of STATION_ORDER) {
                    const vals = cycleTimes.map(r => r.stations[s]).filter(v => v != null);
                    if (vals.length) avgs[s] = vals.reduce((a, b) => a + b, 0) / vals.length;
                }
            }
        }

        // Only rebuild DOM if pills don't exist yet
        if (container.children.length !== STATION_ORDER.length) {
            container.innerHTML = '';
            for (const station of STATION_ORDER) {
                const pill = document.createElement('div');
                pill.className = 'station-pill';
                pill.dataset.station = station;
                pill.innerHTML = `
                    <div class="pill-name">${station}</div>
                    <div class="pill-time" id="pill-time-${station}">--</div>
                    <div class="pill-unit">sec avg</div>
                    <span class="pill-theo" id="pill-theo-${station}">theo: ${THEORETICAL_CYCLE[station]}s</span>
                `;
                container.appendChild(pill);
            }
        }

        // Update values
        for (const station of STATION_ORDER) {
            const avg = avgs[station];
            const theo = THEORETICAL_CYCLE[station];
            const pill = container.querySelector(`[data-station="${station}"]`);
            if (!pill) continue;

            const timeEl = pill.querySelector('.pill-time');
            const theoEl = pill.querySelector('.pill-theo');

            if (avg != null) {
                const animKey = 'pill_' + station;
                animateValue(animKey, avg, 800);
                const current = getAnimated(animKey);
                timeEl.textContent = current.toFixed(1);
                timeEl.style.color = STATION_COLORS[station].main;

                const delta = avg - theo;
                const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
                const deltaClass = delta > 0.5 ? 'over' : (delta < -0.5 ? 'under' : 'at');
                theoEl.innerHTML = `theo: ${theo}s <span class="pill-delta ${deltaClass}">(${deltaStr}s)</span>`;

                // Border color classes
                pill.classList.toggle('is-bottleneck', station === bottleneckStation);
                pill.classList.toggle('over-theo', delta > 0.5 && station !== bottleneckStation);
                pill.classList.toggle('within-theo', delta <= 0.5 && station !== bottleneckStation);
            } else {
                timeEl.textContent = '--';
                timeEl.style.color = '';
            }
        }
    }

    // ---- Polling ----

    async function poll() {
        const [oee, bottleneck, cycleTimes] = await Promise.all([
            fetchJSON('/api/analytics/oee'),
            fetchJSON('/api/analytics/bottleneck'),
            fetchJSON('/api/analytics/cycle-times'),
        ]);

        if (oee) {
            _lastData = { oee, bottleneck, cycleTimes };
            if (!animFrame) {
                animFrame = requestAnimationFrame(renderAll);
            }
        }
    }

    // ---- Init ----
    function init() {
        // Draw empty gauges immediately
        drawGauge('oee-gauge', 0, '#333', { lineWidth: 20, radius: 150, cy: 190 });
        drawRingGauge('avail-gauge', 0, '#333');
        drawRingGauge('perf-gauge', 0, '#333');
        drawRingGauge('qual-gauge', 0, '#333');

        poll();
        setInterval(poll, POLL_INTERVAL);

        // Redraw on theme change
        const observer = new MutationObserver(() => {
            // Reset scaled flag so gauges redraw with new colors
            document.querySelectorAll('canvas').forEach(c => { c._scaled = false; });
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

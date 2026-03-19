/* ============================================
   Quality v1 — Minimal Yield Focus
   Polls /api/analytics/quality-grades and
         /api/analytics/cycle-times
   ============================================ */

(function () {
    "use strict";

    // ---- Theme toggle ----
    window.toggleTheme = function () {
        const html = document.documentElement;
        const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
        html.setAttribute("data-theme", next);
        localStorage.setItem("theme", next);
        rebuildCharts();
    };

    // ---- Chart.js defaults ----
    function getThemeColors() {
        const style = getComputedStyle(document.documentElement);
        return {
            textPrimary: style.getPropertyValue("--text-primary").trim(),
            textSecondary: style.getPropertyValue("--text-secondary").trim(),
            textTertiary: style.getPropertyValue("--text-tertiary").trim(),
            grid: style.getPropertyValue("--chart-grid").trim(),
            tick: style.getPropertyValue("--chart-tick").trim(),
            gold: style.getPropertyValue("--gold").trim(),
            orange: style.getPropertyValue("--orange").trim(),
            blue: style.getPropertyValue("--blue").trim(),
            green: style.getPropertyValue("--green").trim(),
        };
    }

    // ---- State ----
    let donutChart = null;
    let burnChart = null;
    let lastGrades = null;
    let lastCycles = null;

    // ---- DOM refs ----
    const $heroPct = document.getElementById("hero-pct");
    const $heroDetail = document.getElementById("hero-detail");
    const $donutPct = document.getElementById("donut-center-pct");
    const $gradeACount = document.getElementById("grade-a-count");
    const $gradeAPct = document.getElementById("grade-a-pct");
    const $gradeBCount = document.getElementById("grade-b-count");
    const $gradeBPct = document.getElementById("grade-b-pct");
    const $gradeCCount = document.getElementById("grade-c-count");
    const $gradeCPct = document.getElementById("grade-c-pct");
    const $burnAvg = document.getElementById("burn-avg");
    const $lastUpdated = document.getElementById("last-updated");

    // ---- Fetch helpers ----
    async function fetchJSON(url) {
        try {
            const r = await fetch(url);
            if (!r.ok) return null;
            return await r.json();
        } catch {
            return null;
        }
    }

    // ---- Update UI from data ----
    function updateUI() {
        if (!lastGrades || !lastGrades.length) return;

        const total = lastGrades.length;
        const counts = { A: 0, B: 0, C: 0 };
        lastGrades.forEach(function (g) {
            if (g.grade in counts) counts[g.grade]++;
        });

        const yieldPct = total > 0 ? ((counts.A / total) * 100) : 0;

        // Hero
        $heroPct.textContent = Math.round(yieldPct) + "%";
        $heroDetail.textContent =
            counts.A + " of " + total + " units classified as Grade A (white)";
        $donutPct.textContent = Math.round(yieldPct) + "%";

        // Grade cards
        $gradeACount.textContent = counts.A;
        $gradeAPct.textContent = pctStr(counts.A, total);
        $gradeBCount.textContent = counts.B;
        $gradeBPct.textContent = pctStr(counts.B, total);
        $gradeCCount.textContent = counts.C;
        $gradeCPct.textContent = pctStr(counts.C, total);

        // Burn avg
        const burnTimes = lastGrades
            .map(function (g) { return g.burn_time; })
            .filter(function (b) { return b != null; });
        if (burnTimes.length > 0) {
            const avg = burnTimes.reduce(function (a, b) { return a + b; }, 0) / burnTimes.length;
            $burnAvg.textContent = "Avg: " + avg.toFixed(2) + "s";
        }

        // Timestamp
        $lastUpdated.textContent = new Date().toLocaleTimeString();

        // Charts
        updateDonut(counts, total);
        updateBurnChart();
    }

    function pctStr(count, total) {
        if (total === 0) return "0%";
        return ((count / total) * 100).toFixed(1) + "%";
    }

    // ---- Donut Chart ----
    function updateDonut(counts, total) {
        const ctx = document.getElementById("chart-donut");
        if (!ctx) return;
        const colors = getThemeColors();

        const data = [counts.A, counts.B, counts.C];
        const bgColors = [colors.gold, colors.orange, "rgba(128,128,128,0.35)"];
        const borderColors = ["rgba(255,214,10,0.6)", "rgba(255,159,10,0.6)", "rgba(128,128,128,0.2)"];

        if (donutChart) {
            donutChart.data.datasets[0].data = data;
            donutChart.data.datasets[0].backgroundColor = bgColors;
            donutChart.data.datasets[0].borderColor = borderColors;
            donutChart.update("none");
            return;
        }

        donutChart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: ["Grade A", "Grade B", "Grade C"],
                datasets: [{
                    data: data,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1.5,
                    hoverOffset: 6,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "70%",
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "rgba(0,0,0,0.75)",
                        titleFont: { family: "Inter", size: 12, weight: 600 },
                        bodyFont: { family: "Inter", size: 11 },
                        cornerRadius: 8,
                        padding: 10,
                        callbacks: {
                            label: function (ctx) {
                                var pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                                return ctx.label + ": " + ctx.raw + " (" + pct + "%)";
                            },
                        },
                    },
                },
                animation: {
                    animateRotate: true,
                    duration: 600,
                },
            },
        });
    }

    // ---- Burn Time Bar Chart ----
    function updateBurnChart() {
        if (!lastGrades) return;
        const ctx = document.getElementById("chart-burn");
        if (!ctx) return;
        const colors = getThemeColors();

        // Collect burn times per run, colored by grade
        const labels = [];
        const values = [];
        const barColors = [];

        lastGrades.forEach(function (g) {
            if (g.burn_time == null) return;
            labels.push("Run " + g.run);
            values.push(g.burn_time);
            if (g.grade === "A") barColors.push(colors.gold);
            else if (g.grade === "B") barColors.push(colors.orange);
            else barColors.push("rgba(128,128,128,0.5)");
        });

        if (burnChart) {
            burnChart.data.labels = labels;
            burnChart.data.datasets[0].data = values;
            burnChart.data.datasets[0].backgroundColor = barColors;
            burnChart.options.scales.x.ticks.color = colors.tick;
            burnChart.options.scales.y.ticks.color = colors.tick;
            burnChart.options.scales.x.grid.color = colors.grid;
            burnChart.options.scales.y.grid.color = colors.grid;
            burnChart.update("none");
            return;
        }

        burnChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Burn Time (s)",
                    data: values,
                    backgroundColor: barColors,
                    borderRadius: 4,
                    borderSkipped: false,
                    maxBarThickness: 40,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "rgba(0,0,0,0.75)",
                        titleFont: { family: "Inter", size: 12, weight: 600 },
                        bodyFont: { family: "Inter", size: 11 },
                        cornerRadius: 8,
                        padding: 10,
                        callbacks: {
                            label: function (ctx) {
                                return ctx.raw.toFixed(2) + "s";
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { color: colors.grid, drawBorder: false },
                        ticks: {
                            color: colors.tick,
                            font: { family: "Inter", size: 10, weight: 500 },
                            maxRotation: 0,
                        },
                    },
                    y: {
                        grid: { color: colors.grid, drawBorder: false },
                        ticks: {
                            color: colors.tick,
                            font: { family: "'SF Mono', monospace", size: 10 },
                            callback: function (v) { return v.toFixed(1) + "s"; },
                        },
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: "Duration (s)",
                            color: colors.textTertiary,
                            font: { family: "Inter", size: 11, weight: 500 },
                        },
                    },
                },
                animation: {
                    duration: 400,
                },
            },
        });
    }

    // ---- Rebuild charts on theme switch ----
    function rebuildCharts() {
        if (donutChart) { donutChart.destroy(); donutChart = null; }
        if (burnChart) { burnChart.destroy(); burnChart = null; }
        // Small delay so CSS variables resolve
        setTimeout(updateUI, 60);
    }

    // ---- Polling ----
    async function poll() {
        const [grades, cycles] = await Promise.all([
            fetchJSON("/api/analytics/quality-grades"),
            fetchJSON("/api/analytics/cycle-times"),
        ]);

        if (grades) lastGrades = grades;
        if (cycles) lastCycles = cycles;

        updateUI();
    }

    // Initial load + poll
    poll();
    setInterval(poll, 3000);
})();

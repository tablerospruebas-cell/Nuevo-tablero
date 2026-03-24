"use strict";

geotab.addin.rendimiento = function () {
    let api;
    let selectedDays = 7;
    let customFromDate = null;
    let customToDate = null;
    let isCustomRange = false;
    let allRecords = [];
    let filteredRecords = [];

    // Chart instances
    let chartEffByUnit, chartTrend, chartDistribution, chartScatter;

    // DOM refs
    let btnRefresh, lastUpdatedEl, errorToast, errorToastMsg, searchInput;

    // ─── Helpers ─────────────────────────────────────────────────────────────
    const getDateRange = () => {
        if (isCustomRange && customFromDate && customToDate) {
            return { fromDate: customFromDate, toDate: customToDate };
        }
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - selectedDays);
        return { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() };
    };

    const formatDateShort = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
    };

    const formatTimeShort = (isoStr) => {
        if (!isoStr) return "";
        const d = new Date(isoStr);
        return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    };

    const formatOdometer = (meters) => {
        if (!meters && meters !== 0) return "—";
        return `${Math.round(meters / 1000).toLocaleString("es-MX")} km`;
    };

    const getDeviceName = (record) => {
        return (record.device && record.device.name)
            ? record.device.name
            : (record.device && record.device.id ? record.device.id : "Desconocido");
    };

    const getDriverName = (record) => {
        return (record.driver && record.driver.name)
            ? record.driver.name
            : (record.driver && record.driver.id && record.driver.id !== "UnknownDriverId" ? record.driver.id : "Desconocido");
    };

    const showError = (msg) => {
        errorToastMsg.textContent = msg;
        errorToast.style.display = "flex";
        setTimeout(() => { errorToast.style.display = "none"; }, 5000);
    };

    const animateCount = (el, target, decimals = 0, suffix = "") => {
        const duration = 900;
        const start = performance.now();
        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = target * eased;
            el.textContent = (decimals > 0
                ? current.toFixed(decimals)
                : Math.round(current).toLocaleString("es-MX")) + suffix;
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    // ─── Compute performance data from FuelUsage ─────────────────────────────
    // Each FuelUsage record has: device, driver, dateTime, volume (liters used), distance (meters), odometer
    const computePerformanceData = (records) => {
        const byDevice = {};

        records.forEach(r => {
            const name = getDeviceName(r);
            if (!byDevice[name]) {
                byDevice[name] = { name, totalDistance: 0, totalFuel: 0, records: [], drivers: new Set() };
            }
            const dist = parseFloat(r.distance) || 0; // meters
            const fuel = parseFloat(r.volume) || 0;   // liters
            byDevice[name].totalDistance += dist;
            byDevice[name].totalFuel += fuel;
            byDevice[name].records.push(r);
            const driverName = getDriverName(r);
            if (driverName !== "Desconocido") byDevice[name].drivers.add(driverName);
        });

        // Calculate km/L for each device
        const devices = Object.values(byDevice).map(d => {
            const distKm = d.totalDistance / 1000;
            const kmPerL = d.totalFuel > 0 ? distKm / d.totalFuel : 0;
            return { ...d, distKm, kmPerL };
        });

        return devices;
    };

    const getEffClass = (kmPerL) => {
        if (kmPerL >= 12) return "eff-excellent";
        if (kmPerL >= 8) return "eff-good";
        if (kmPerL >= 5) return "eff-average";
        return "eff-poor";
    };

    const getEffLabel = (kmPerL) => {
        if (kmPerL >= 12) return "Excelente";
        if (kmPerL >= 8) return "Bueno";
        if (kmPerL >= 5) return "Regular";
        return "Bajo";
    };

    // ─── Render summary KPIs ─────────────────────────────────────────────────
    const renderSummary = (records) => {
        const totalDistance = records.reduce((s, r) => s + (parseFloat(r.distance) || 0), 0);
        const totalFuel = records.reduce((s, r) => s + (parseFloat(r.volume) || 0), 0);
        const distKm = totalDistance / 1000;
        const avgKmPerL = totalFuel > 0 ? distKm / totalFuel : 0;
        const costPerKm = totalFuel > 0 ? (totalFuel * 24.5) / distKm : 0; // ~$24.5/L estimate
        const deviceSet = new Set(records.map(r => getDeviceName(r)));

        const elRendimiento = document.getElementById("stat-rendimiento");
        const elDistancia = document.getElementById("stat-distancia");
        const elCombustible = document.getElementById("stat-combustible");
        const elCosto = document.getElementById("stat-costo");
        const elUnidades = document.getElementById("stat-unidades");

        if (elRendimiento) { elRendimiento.classList.remove("skeleton"); animateCount(elRendimiento, avgKmPerL, 1, " km/L"); }
        if (elDistancia) { elDistancia.classList.remove("skeleton"); animateCount(elDistancia, Math.round(distKm), 0, ""); elDistancia.textContent = Math.round(distKm).toLocaleString("es-MX"); }
        if (elCombustible) { elCombustible.classList.remove("skeleton"); animateCount(elCombustible, Math.round(totalFuel), 0, ""); }
        if (elCosto) { elCosto.classList.remove("skeleton"); elCosto.textContent = "$" + costPerKm.toFixed(2); }
        if (elUnidades) { elUnidades.classList.remove("skeleton"); animateCount(elUnidades, deviceSet.size, 0, ""); }

        const totalBadge = document.getElementById("stat-total-badge");
        if (totalBadge) totalBadge.textContent = isCustomRange ? "rango personalizado" : `últimos ${selectedDays} días`;

        const badgeRanking = document.getElementById("badge-ranking");
        if (badgeRanking) {
            badgeRanking.classList.remove("skeleton");
            badgeRanking.textContent = `${deviceSet.size} unidades`;
        }
    };

    // ─── Render ranking (by best km/L) ──────────────────────────────────────
    const renderRanking = (records) => {
        const devices = computePerformanceData(records);
        const sorted = devices
            .filter(d => d.kmPerL > 0)
            .sort((a, b) => b.kmPerL - a.kmPerL);

        const maxKmPerL = sorted.length > 0 ? sorted[0].kmPerL : 1;
        const ul = document.getElementById("ranking-list");
        if (!ul) return;
        ul.innerHTML = "";

        if (sorted.length === 0) {
            ul.innerHTML = `<li class="ranking-empty">Sin datos en el periodo seleccionado</li>`;
            return;
        }

        sorted.forEach((item, idx) => {
            const pct = Math.round((item.kmPerL / maxKmPerL) * 100);
            const li = document.createElement("li");
            li.className = "ranking-item";
            li.innerHTML = `
                <div class="ranking-pos">${idx + 1}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${item.name}</div>
                    <div class="ranking-bar-wrap">
                        <div class="ranking-bar" style="width:${pct}%"></div>
                    </div>
                </div>
                <div class="ranking-stats">
                    <span class="ranking-count">${item.kmPerL.toFixed(1)}</span>
                    <span class="ranking-liters">km/L</span>
                </div>
            `;
            ul.appendChild(li);
        });
    };

    // ─── Render table ─────────────────────────────────────────────────────────
    const renderTable = (records) => {
        const tbody = document.getElementById("perf-tbody");
        const emptyEl = document.getElementById("table-empty");
        const badgeTable = document.getElementById("badge-table");

        if (!tbody) return;
        tbody.innerHTML = "";

        if (badgeTable) badgeTable.textContent = `${records.length} registros`;

        if (records.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            return;
        }
        if (emptyEl) emptyEl.style.display = "none";

        const sorted = [...records].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

        sorted.forEach(r => {
            const tr = document.createElement("tr");
            tr.className = "perf-row";
            const dist = (parseFloat(r.distance) || 0) / 1000;
            const fuel = parseFloat(r.volume) || 0;
            const kmPerL = fuel > 0 ? dist / fuel : 0;
            const effClass = getEffClass(kmPerL);

            tr.innerHTML = `
                <td>
                    <div class="unit-chip">
                        <div class="unit-dot"></div>
                        <span>${getDeviceName(r)}</span>
                    </div>
                </td>
                <td>${getDriverName(r)}</td>
                <td>
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(r.dateTime)}</span>
                        <span class="date-time">${formatTimeShort(r.dateTime)}</span>
                    </div>
                </td>
                <td>${dist.toFixed(1)} km</td>
                <td>${fuel.toFixed(1)} L</td>
                <td>
                    <span class="eff-badge ${effClass}">${kmPerL.toFixed(1)} km/L</span>
                </td>
                <td>${formatOdometer(r.odometer)}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Reset UI ─────────────────────────────────────────────────────────────
    const resetUI = () => {
        ["stat-rendimiento", "stat-distancia", "stat-combustible", "stat-costo", "stat-unidades"].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = "—"; el.classList.add("skeleton"); }
        });

        const ul = document.getElementById("ranking-list");
        if (ul) ul.innerHTML = `
            <li class="ranking-skeleton"></li>
            <li class="ranking-skeleton"></li>
            <li class="ranking-skeleton"></li>
            <li class="ranking-skeleton"></li>
            <li class="ranking-skeleton"></li>
        `;

        const badgeRanking = document.getElementById("badge-ranking");
        if (badgeRanking) { badgeRanking.textContent = "—"; badgeRanking.classList.add("skeleton"); }

        const tbody = document.getElementById("perf-tbody");
        if (tbody) tbody.innerHTML = `
            <tr class="tr-skeleton"><td colspan="7"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="7"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="7"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="7"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="7"><div class="td-skel"></div></td></tr>
        `;

        const badgeTable = document.getElementById("badge-table");
        if (badgeTable) badgeTable.textContent = "—";

        const emptyEl = document.getElementById("table-empty");
        if (emptyEl) emptyEl.style.display = "none";

        if (searchInput) searchInput.value = "";
    };

    // ─── Render Charts ────────────────────────────────────────────────────────
    const renderCharts = (records) => {
        if (!window.ApexCharts) return;

        const cCyan = "#00b1e1";
        const cBlue = "#003666";
        const cGreen = "#3b753c";
        const cOrange = "#f29300";
        const cRed = "#cc0000";
        const cPurple = "#813896";
        const textMuted = "#5e6c84";
        const fontFamily = "'Inter', sans-serif";

        const commonOptions = {
            chart: { fontFamily, toolbar: { show: false } },
            dataLabels: { enabled: false },
            tooltip: { theme: 'light' }
        };

        const devices = computePerformanceData(records);

        // 1. Rendimiento por Unidad (horizontal bar chart)
        const sortedByEff = [...devices].filter(d => d.kmPerL > 0).sort((a, b) => b.kmPerL - a.kmPerL).slice(0, 15);
        const optEffByUnit = {
            ...commonOptions,
            series: [{ name: 'km/L', data: sortedByEff.map(d => parseFloat(d.kmPerL.toFixed(1))) }],
            chart: { type: 'bar', height: 260, toolbar: { show: false } },
            colors: sortedByEff.map(d => d.kmPerL >= 12 ? cGreen : d.kmPerL >= 8 ? cCyan : d.kmPerL >= 5 ? cOrange : cRed),
            plotOptions: {
                bar: {
                    horizontal: true,
                    borderRadius: 4,
                    distributed: true,
                    dataLabels: { position: 'top' }
                }
            },
            dataLabels: {
                enabled: true,
                textAnchor: 'start',
                offsetX: 5,
                formatter: val => val + " km/L",
                style: { colors: [textMuted], fontSize: '10px', fontWeight: 600 }
            },
            xaxis: { categories: sortedByEff.map(d => d.name), labels: { style: { colors: textMuted } } },
            yaxis: { labels: { style: { colors: textMuted, fontSize: '11px' } } },
            legend: { show: false },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };

        if (chartEffByUnit) chartEffByUnit.destroy();
        chartEffByUnit = new ApexCharts(document.querySelector("#chart-eff-unit"), optEffByUnit);
        chartEffByUnit.render();

        // 2. Tendencia de Rendimiento (line chart — daily avg km/L)
        const dailyData = {};
        records.forEach(r => {
            if (!r.dateTime) return;
            const d = new Date(r.dateTime);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!dailyData[key]) dailyData[key] = { totalDist: 0, totalFuel: 0 };
            dailyData[key].totalDist += (parseFloat(r.distance) || 0) / 1000;
            dailyData[key].totalFuel += parseFloat(r.volume) || 0;
        });

        const sortedDays = Object.keys(dailyData).sort();
        const trendSeries = sortedDays.map(k => {
            const d = dailyData[k];
            return d.totalFuel > 0 ? parseFloat((d.totalDist / d.totalFuel).toFixed(1)) : 0;
        });

        const optTrend = {
            ...commonOptions,
            series: [{ name: 'km/L Promedio', data: trendSeries }],
            chart: { type: 'area', height: 260, toolbar: { show: false }, zoom: { enabled: false } },
            colors: [cGreen],
            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } },
            stroke: { curve: 'smooth', width: 2.5 },
            xaxis: {
                categories: sortedDays.map(k => {
                    const parts = k.split('-');
                    return `${parts[2]}/${parts[1]}`;
                }),
                labels: { style: { colors: textMuted }, rotate: -45, rotateAlways: sortedDays.length > 10 }
            },
            yaxis: { labels: { formatter: val => val + " km/L", style: { colors: textMuted } } },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };

        if (chartTrend) chartTrend.destroy();
        chartTrend = new ApexCharts(document.querySelector("#chart-trend"), optTrend);
        chartTrend.render();

        // 3. Distribución de Eficiencia (donut chart)
        const effCounts = { Excelente: 0, Bueno: 0, Regular: 0, Bajo: 0 };
        devices.forEach(d => {
            if (d.kmPerL <= 0) return;
            if (d.kmPerL >= 12) effCounts.Excelente++;
            else if (d.kmPerL >= 8) effCounts.Bueno++;
            else if (d.kmPerL >= 5) effCounts.Regular++;
            else effCounts.Bajo++;
        });

        const optDist = {
            ...commonOptions,
            series: Object.values(effCounts),
            chart: { type: 'donut', height: 260 },
            labels: Object.keys(effCounts),
            colors: [cGreen, cCyan, cOrange, cRed],
            plotOptions: {
                pie: {
                    donut: {
                        size: '60%',
                        labels: {
                            show: true,
                            total: {
                                show: true,
                                label: 'Unidades',
                                formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0)
                            }
                        }
                    }
                }
            },
            legend: { position: 'bottom', fontSize: '11px', fontWeight: 600 },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };

        if (chartDistribution) chartDistribution.destroy();
        chartDistribution = new ApexCharts(document.querySelector("#chart-distribution"), optDist);
        chartDistribution.render();

        // 4. Consumo vs Distancia (scatter chart)
        const scatterData = devices
            .filter(d => d.totalFuel > 0 && d.distKm > 0)
            .map(d => ({
                x: parseFloat(d.distKm.toFixed(1)),
                y: parseFloat(d.totalFuel.toFixed(1))
            }));

        const optScatter = {
            ...commonOptions,
            series: [{ name: 'Unidades', data: scatterData }],
            chart: { type: 'scatter', height: 260, toolbar: { show: false }, zoom: { enabled: true } },
            colors: [cBlue],
            xaxis: {
                title: { text: 'Distancia (km)', style: { color: textMuted, fontSize: '11px', fontWeight: 600 } },
                labels: { formatter: val => Math.round(val) + " km", style: { colors: textMuted } }
            },
            yaxis: {
                title: { text: 'Combustible (L)', style: { color: textMuted, fontSize: '11px', fontWeight: 600 } },
                labels: { formatter: val => Math.round(val) + " L", style: { colors: textMuted } }
            },
            markers: { size: 6, strokeWidth: 0, hover: { size: 9 } },
            tooltip: {
                custom: ({ seriesIndex, dataPointIndex, w }) => {
                    const point = w.config.series[seriesIndex].data[dataPointIndex];
                    const kmPerL = point.y > 0 ? (point.x / point.y).toFixed(1) : '—';
                    return `<div style="padding:8px 12px;font-size:12px;">
                        <b>Distancia:</b> ${point.x} km<br>
                        <b>Combustible:</b> ${point.y} L<br>
                        <b>Rendimiento:</b> ${kmPerL} km/L
                    </div>`;
                }
            },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };

        if (chartScatter) chartScatter.destroy();
        chartScatter = new ApexCharts(document.querySelector("#chart-scatter"), optScatter);
        chartScatter.render();
    };

    // ─── Filter by search ─────────────────────────────────────────────────────
    const applySearch = (query) => {
        if (!query || query.trim() === "") {
            filteredRecords = [...allRecords];
        } else {
            const q = query.trim().toLowerCase();
            filteredRecords = allRecords.filter(r => getDeviceName(r).toLowerCase().includes(q));
        }
        renderTable(filteredRecords);
        renderCharts(filteredRecords);
        const badgeTable = document.getElementById("badge-table");
        if (badgeTable) badgeTable.textContent = `${filteredRecords.length} registros`;
    };

    // ─── MAIN DATA LOADER ─────────────────────────────────────────────────────
    const loadData = () => {
        resetUI();
        btnRefresh.disabled = true;
        btnRefresh.classList.add("loading");

        const { fromDate, toDate } = getDateRange();

        api.multiCall([
            ["Get", { typeName: "FuelUsage", search: { fromDate, toDate } }],
            ["Get", { typeName: "Device" }]
        ], (results) => {
            const raw = results[0] || [];
            const devices = results[1] || [];

            // Map device ids to names
            const deviceMap = {};
            devices.forEach(d => { deviceMap[d.id] = d.name; });

            raw.forEach(r => {
                if (r.device && r.device.id && deviceMap[r.device.id]) {
                    r.device.name = deviceMap[r.device.id];
                }
            });

            allRecords = raw;
            filteredRecords = [...allRecords];

            renderSummary(allRecords);
            renderRanking(allRecords);
            renderTable(filteredRecords);
            renderCharts(filteredRecords);

            if (window.lucide) {
                lucide.createIcons();
            }

            const now = new Date();
            lastUpdatedEl.textContent = `Actualizado: ${now.toLocaleTimeString("es-MX", {
                hour: "2-digit", minute: "2-digit", second: "2-digit"
            })}`;

            btnRefresh.disabled = false;
            btnRefresh.classList.remove("loading");
        }, (err) => {
            console.error("Error fetching data:", err);
            showError("Error al cargar los datos. Verifique la conexión.");
            btnRefresh.disabled = false;
            btnRefresh.classList.remove("loading");
        });
    };

    // ─── ADD-IN LIFECYCLE ─────────────────────────────────────────────────────
    return {
        initialize: function (_api, state, callback) {
            api = _api;

            if (window.lucide) {
                lucide.createIcons();
            }

            btnRefresh = document.getElementById("btn-refresh");
            lastUpdatedEl = document.getElementById("last-updated-time");
            errorToast = document.getElementById("error-toast");
            errorToastMsg = document.getElementById("error-toast-msg");
            searchInput = document.getElementById("search-input");

            // ── Pre-set date range buttons ────────────────────────────────
            document.querySelectorAll(".btn-range[data-days]").forEach(btn => {
                btn.addEventListener("click", () => {
                    document.querySelectorAll(".btn-range").forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    selectedDays = parseInt(btn.dataset.days, 10);
                    isCustomRange = false;
                    customFromDate = null;
                    customToDate = null;
                    const btnCustom = document.getElementById("btn-custom");
                    if (btnCustom) {
                        btnCustom.innerHTML = `
                            <i data-lucide="calendar" width="13" height="13" stroke-width="2.5"></i>
                            Personalizado
                        `;
                        if (window.lucide) lucide.createIcons();
                    }
                    loadData();
                });
            });

            // ── Custom date range popover ────────────────────────────────
            const btnCustom = document.getElementById("btn-custom");
            const datePopover = document.getElementById("date-popover");
            const dateFromInput = document.getElementById("date-from");
            const dateToInput = document.getElementById("date-to");
            const btnApply = document.getElementById("btn-date-apply");
            const btnCancel = document.getElementById("btn-date-cancel");

            const todayStr = new Date().toISOString().slice(0, 10);
            const weekAgoStr = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
            dateFromInput.value = weekAgoStr;
            dateToInput.value = todayStr;
            dateToInput.max = todayStr;

            const closePopover = () => datePopover.classList.remove("open");

            btnCustom.addEventListener("click", (e) => {
                e.stopPropagation();
                datePopover.classList.toggle("open");
            });

            btnCancel.addEventListener("click", closePopover);

            btnApply.addEventListener("click", () => {
                const from = dateFromInput.value;
                const to = dateToInput.value;
                if (!from || !to) { showError("Selecciona ambas fechas antes de aplicar."); return; }
                if (new Date(from) > new Date(to)) { showError("La fecha 'Desde' no puede ser mayor que 'Hasta'."); return; }

                customFromDate = new Date(from + "T00:00:00").toISOString();
                customToDate = new Date(to + "T23:59:59").toISOString();
                isCustomRange = true;

                const fmt = (s) => new Date(s + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
                btnCustom.innerHTML = `
                    <i data-lucide="calendar" width="13" height="13" stroke-width="2.5"></i>
                    ${fmt(from)} – ${fmt(to)}
                `;
                if (window.lucide) lucide.createIcons();

                document.querySelectorAll(".btn-range").forEach(b => b.classList.remove("active"));
                btnCustom.classList.add("active");
                closePopover();
                loadData();
            });

            document.addEventListener("click", (e) => {
                if (!datePopover.contains(e.target) && e.target !== btnCustom) closePopover();
            });

            dateFromInput.addEventListener("change", () => { dateToInput.min = dateFromInput.value; });

            // ── Search box ────────────────────────────────────────────────
            if (searchInput) {
                let searchTimer = null;
                searchInput.addEventListener("input", () => {
                    clearTimeout(searchTimer);
                    searchTimer = setTimeout(() => applySearch(searchInput.value), 250);
                });
            }

            btnRefresh.addEventListener("click", () => { loadData(); });

            callback();
        },
        focus: function (_api, state) {
            api = _api;
            loadData();
        },
        blur: function (_api, state) {
            // nothing
        }
    };
};

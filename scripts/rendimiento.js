"use strict";

geotab.addin.rendimiento = function () {
    let api;
    let selectedDays = 7;
    let customFromDate = null;
    let customToDate = null;
    let isCustomRange = false;
    let allRecords = [];       // Processed performance records (per device)
    let filteredRecords = [];
    let rawStatusData = [];    // Raw StatusData for the raw table

    // Chart instances
    let chartEffByUnit, chartTrend, chartDistribution, chartScatter;

    // DOM refs
    let btnRefresh, lastUpdatedEl, errorToast, errorToastMsg, searchInput;

    // Geotab Diagnostic IDs
    const DIAG_FUEL_USED = "DiagnosticDeviceTotalFuelId";
    const DIAG_ODOMETER = "DiagnosticOdometerId";

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

    const formatDateTime = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleString("es-MX", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
    };

    const formatOdometer = (meters) => {
        if (!meters && meters !== 0) return "—";
        return `${Math.round(meters / 1000).toLocaleString("es-MX")} km`;
    };

    const getDeviceName = (record) => {
        if (record.deviceName) return record.deviceName;
        return (record.device && record.device.name)
            ? record.device.name
            : (record.device && record.device.id ? record.device.id : "Desconocido");
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

    const getEffClass = (kmPerL) => {
        if (kmPerL >= 12) return "eff-excellent";
        if (kmPerL >= 8) return "eff-good";
        if (kmPerL >= 5) return "eff-average";
        return "eff-poor";
    };

    // ─── Process StatusData into performance records per device ───────────────
    const processStatusData = (fuelData, odoData, deviceMap) => {
        // Group by device
        const fuelByDevice = {};
        const odoByDevice = {};

        fuelData.forEach(s => {
            const devId = s.device ? s.device.id : null;
            if (!devId) return;
            if (!fuelByDevice[devId]) fuelByDevice[devId] = [];
            fuelByDevice[devId].push({ dateTime: s.dateTime, value: s.data || 0 });
        });

        odoData.forEach(s => {
            const devId = s.device ? s.device.id : null;
            if (!devId) return;
            if (!odoByDevice[devId]) odoByDevice[devId] = [];
            odoByDevice[devId].push({ dateTime: s.dateTime, value: s.data || 0 });
        });

        const perfRecords = [];

        // For each device, compute fuel used and distance from first to last reading
        const allDeviceIds = new Set([...Object.keys(fuelByDevice), ...Object.keys(odoByDevice)]);

        allDeviceIds.forEach(devId => {
            const fuelReadings = (fuelByDevice[devId] || []).sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
            const odoReadings = (odoByDevice[devId] || []).sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

            const deviceName = deviceMap[devId] || devId;

            if (fuelReadings.length >= 2 && odoReadings.length >= 2) {
                const fuelStart = fuelReadings[0].value;
                const fuelEnd = fuelReadings[fuelReadings.length - 1].value;
                const odoStart = odoReadings[0].value;
                const odoEnd = odoReadings[odoReadings.length - 1].value;

                const fuelUsed = fuelEnd - fuelStart;   // liters
                const distMeters = odoEnd - odoStart;    // meters
                const distKm = distMeters / 1000;
                const kmPerL = fuelUsed > 0 ? distKm / fuelUsed : 0;

                perfRecords.push({
                    deviceId: devId,
                    deviceName: deviceName,
                    fuelUsed: fuelUsed > 0 ? fuelUsed : 0,
                    distKm: distKm > 0 ? distKm : 0,
                    kmPerL: kmPerL > 0 ? kmPerL : 0,
                    odoStart,
                    odoEnd,
                    dateStart: fuelReadings[0].dateTime,
                    dateEnd: fuelReadings[fuelReadings.length - 1].dateTime,
                    fuelReadingsCount: fuelReadings.length,
                    odoReadingsCount: odoReadings.length
                });
            } else if (odoReadings.length >= 2) {
                const odoStart = odoReadings[0].value;
                const odoEnd = odoReadings[odoReadings.length - 1].value;
                const distKm = (odoEnd - odoStart) / 1000;

                perfRecords.push({
                    deviceId: devId,
                    deviceName: deviceName,
                    fuelUsed: 0,
                    distKm: distKm > 0 ? distKm : 0,
                    kmPerL: 0,
                    odoStart,
                    odoEnd,
                    dateStart: odoReadings[0].dateTime,
                    dateEnd: odoReadings[odoReadings.length - 1].dateTime,
                    fuelReadingsCount: fuelReadings.length,
                    odoReadingsCount: odoReadings.length
                });
            }
        });

        return perfRecords;
    };

    // ─── Render summary KPIs ─────────────────────────────────────────────────
    const renderSummary = (records) => {
        const totalDist = records.reduce((s, r) => s + r.distKm, 0);
        const totalFuel = records.reduce((s, r) => s + r.fuelUsed, 0);
        const avgKmPerL = totalFuel > 0 ? totalDist / totalFuel : 0;
        const costPerKm = totalDist > 0 ? (totalFuel * 24.5) / totalDist : 0;
        const unidades = records.length;

        const elRendimiento = document.getElementById("stat-rendimiento");
        const elDistancia = document.getElementById("stat-distancia");
        const elCombustible = document.getElementById("stat-combustible");
        const elCosto = document.getElementById("stat-costo");
        const elUnidades = document.getElementById("stat-unidades");

        if (elRendimiento) { elRendimiento.classList.remove("skeleton"); animateCount(elRendimiento, avgKmPerL, 1, " km/L"); }
        if (elDistancia) { elDistancia.classList.remove("skeleton"); animateCount(elDistancia, Math.round(totalDist), 0, ""); }
        if (elCombustible) { elCombustible.classList.remove("skeleton"); animateCount(elCombustible, Math.round(totalFuel), 0, ""); }
        if (elCosto) { elCosto.classList.remove("skeleton"); elCosto.textContent = "$" + costPerKm.toFixed(2); }
        if (elUnidades) { elUnidades.classList.remove("skeleton"); animateCount(elUnidades, unidades, 0, ""); }

        const totalBadge = document.getElementById("stat-total-badge");
        if (totalBadge) totalBadge.textContent = isCustomRange ? "rango personalizado" : `últimos ${selectedDays} días`;

        const badgeRanking = document.getElementById("badge-ranking");
        if (badgeRanking) {
            badgeRanking.classList.remove("skeleton");
            badgeRanking.textContent = `${unidades} unidades`;
        }
    };

    // ─── Render ranking (by best km/L) ──────────────────────────────────────
    const renderRanking = (records) => {
        const sorted = [...records]
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
                    <div class="ranking-name">${item.deviceName}</div>
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

        const sorted = [...records].sort((a, b) => b.kmPerL - a.kmPerL);

        sorted.forEach(r => {
            const tr = document.createElement("tr");
            tr.className = "perf-row";
            const effClass = getEffClass(r.kmPerL);

            tr.innerHTML = `
                <td>
                    <div class="unit-chip">
                        <div class="unit-dot"></div>
                        <span>${r.deviceName}</span>
                    </div>
                </td>
                <td>
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(r.dateStart)}</span>
                        <span class="date-time">→ ${formatDateShort(r.dateEnd)}</span>
                    </div>
                </td>
                <td>${r.distKm.toFixed(1)} km</td>
                <td>${r.fuelUsed > 0 ? r.fuelUsed.toFixed(1) + " L" : "—"}</td>
                <td>
                    <span class="eff-badge ${effClass}">${r.kmPerL > 0 ? r.kmPerL.toFixed(1) + " km/L" : "—"}</span>
                </td>
                <td>${formatOdometer(r.odoEnd)}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Render Raw StatusData Table ──────────────────────────────────────────
    const renderRawTable = (data, deviceMap) => {
        const thead = document.getElementById("raw-thead");
        const tbody = document.getElementById("raw-tbody");
        const badgeRaw = document.getElementById("badge-raw");
        if (!thead || !tbody) return;

        if (badgeRaw) badgeRaw.textContent = `${data.length} registros`;

        if (data.length === 0) {
            thead.innerHTML = "<tr><th>Sin datos</th></tr>";
            tbody.innerHTML = '<tr><td style="text-align:center; padding: 2rem;">No se encontraron registros en el periodo seleccionado.</td></tr>';
            return;
        }

        // Define columns
        thead.innerHTML = "";
        const trHead = document.createElement("tr");
        const columns = ["Dispositivo", "Diagnóstico ID", "Fecha y Hora", "Valor (data)", "Unidad", "ID"];
        columns.forEach(col => {
            const th = document.createElement("th");
            th.textContent = col;
            trHead.appendChild(th);
        });
        thead.appendChild(trHead);

        // Body — show all StatusData records
        tbody.innerHTML = "";
        const sorted = [...data].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

        sorted.forEach(s => {
            const tr = document.createElement("tr");
            const devId = s.device ? s.device.id : "—";
            const devName = deviceMap[devId] || devId;
            const diagId = s.diagnostic ? s.diagnostic.id : "—";
            const dateStr = formatDateTime(s.dateTime);
            const value = s.data !== undefined && s.data !== null ? s.data : "—";

            // Determine unit based on diagnostic
            let unit = "—";
            if (diagId.toLowerCase().includes("fuel")) unit = "L";
            else if (diagId.toLowerCase().includes("odometer")) unit = "m";
            else if (diagId.toLowerCase().includes("speed")) unit = "km/h";
            else if (diagId.toLowerCase().includes("rpm")) unit = "RPM";
            else if (diagId.toLowerCase().includes("temp")) unit = "°C";

            const rid = s.id || "—";

            tr.innerHTML = `
                <td>${devName}</td>
                <td style="font-family:monospace; font-size:0.72rem;">${diagId}</td>
                <td>${dateStr}</td>
                <td style="font-weight:700; text-align:right;">${typeof value === "number" ? value.toLocaleString("es-MX", { maximumFractionDigits: 2 }) : value}</td>
                <td>${unit}</td>
                <td style="font-family:monospace; font-size:0.7rem; color:var(--color-text-muted);">${rid}</td>
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
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
        `;

        const badgeTable = document.getElementById("badge-table");
        if (badgeTable) badgeTable.textContent = "—";

        const emptyEl = document.getElementById("table-empty");
        if (emptyEl) emptyEl.style.display = "none";

        // Raw table
        const rawThead = document.getElementById("raw-thead");
        const rawTbody = document.getElementById("raw-tbody");
        if (rawThead) rawThead.innerHTML = `<tr><th>Cargando...</th></tr>`;
        if (rawTbody) rawTbody.innerHTML = `<tr class="tr-skeleton"><td><div class="td-skel"></div></td></tr>`;

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
        const textMuted = "#5e6c84";
        const fontFamily = "'Inter', sans-serif";

        const commonOptions = {
            chart: { fontFamily, toolbar: { show: false } },
            dataLabels: { enabled: false },
            tooltip: { theme: 'light' }
        };

        // 1. Rendimiento por Unidad (horizontal bar)
        const sortedByEff = [...records].filter(d => d.kmPerL > 0).sort((a, b) => b.kmPerL - a.kmPerL).slice(0, 15);
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
            xaxis: { categories: sortedByEff.map(d => d.deviceName), labels: { style: { colors: textMuted } } },
            yaxis: { labels: { style: { colors: textMuted, fontSize: '11px' } } },
            legend: { show: false },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };

        if (chartEffByUnit) chartEffByUnit.destroy();
        chartEffByUnit = new ApexCharts(document.querySelector("#chart-eff-unit"), optEffByUnit);
        chartEffByUnit.render();

        // 2. Tendencia de Rendimiento (bar chart: km/L por unidad)
        const withFuel = records.filter(d => d.kmPerL > 0);
        const categories = withFuel.map(d => d.deviceName);
        const distSeries = withFuel.map(d => parseFloat(d.distKm.toFixed(1)));
        const fuelSeries = withFuel.map(d => parseFloat(d.fuelUsed.toFixed(1)));

        const optTrend = {
            ...commonOptions,
            series: [
                { name: 'Distancia (km)', data: distSeries },
                { name: 'Combustible (L)', data: fuelSeries }
            ],
            chart: { type: 'bar', height: 260, toolbar: { show: false }, stacked: false },
            colors: [cCyan, cOrange],
            plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
            xaxis: { categories, labels: { style: { colors: textMuted, fontSize: '10px' }, rotate: -45 } },
            yaxis: { labels: { style: { colors: textMuted } } },
            legend: { position: 'top', fontSize: '11px' },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };

        if (chartTrend) chartTrend.destroy();
        chartTrend = new ApexCharts(document.querySelector("#chart-trend"), optTrend);
        chartTrend.render();

        // 3. Distribución de Eficiencia (donut)
        const effCounts = { Excelente: 0, Bueno: 0, Regular: 0, Bajo: 0 };
        records.forEach(d => {
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

        // 4. Consumo vs Distancia (scatter)
        const scatterData = records
            .filter(d => d.fuelUsed > 0 && d.distKm > 0)
            .map(d => ({ x: parseFloat(d.distKm.toFixed(1)), y: parseFloat(d.fuelUsed.toFixed(1)) }));

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
            filteredRecords = allRecords.filter(r => r.deviceName.toLowerCase().includes(q));
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
            ["Get", {
                typeName: "StatusData",
                search: {
                    fromDate,
                    toDate,
                    diagnosticSearch: { id: DIAG_FUEL_USED }
                }
            }],
            ["Get", {
                typeName: "StatusData",
                search: {
                    fromDate,
                    toDate,
                    diagnosticSearch: { id: DIAG_ODOMETER }
                }
            }],
            ["Get", { typeName: "Device" }]
        ], (results) => {
            const fuelData = results[0] || [];
            const odoData = results[1] || [];
            const devices = results[2] || [];

            // Map device ids to names
            const deviceMap = {};
            devices.forEach(d => { deviceMap[d.id] = d.name; });

            // Store all raw StatusData for the raw table
            rawStatusData = [...fuelData, ...odoData];

            // Enrich raw data with device names
            rawStatusData.forEach(s => {
                if (s.device && s.device.id && deviceMap[s.device.id]) {
                    s.device.name = deviceMap[s.device.id];
                }
            });

            // Process into performance records
            allRecords = processStatusData(fuelData, odoData, deviceMap);
            filteredRecords = [...allRecords];

            renderSummary(allRecords);
            renderRanking(allRecords);
            renderTable(filteredRecords);
            renderCharts(filteredRecords);
            renderRawTable(rawStatusData, deviceMap);

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

            // ── Pre-set date range buttons
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

            // ── Custom date range popover
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

            // ── Search box
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

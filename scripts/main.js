"use strict";

geotab.addin.dashboard = function () {
    let api;
    let selectedDays = 7;
    let customFromDate = null;
    let customToDate = null;
    let isCustomRange = false;
    let allFillups = [];       // All raw FillUp records
    let filteredFillups = [];  // After search filter
    let charts = {};
    let currentInterval = "month";

    // ─── DOM refs ────────────────────────────────────────────────────────────
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

    const formatDateTime = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleString("es-MX", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
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

    const formatDuration = (seconds) => {
        if (!seconds && seconds !== 0) return "—";
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    };

    const formatOdometer = (meters) => {
        if (!meters && meters !== 0) return "—";
        return `${Math.round(meters / 1000).toLocaleString("es-MX")} km`;
    };

    const formatVolume = (liters) => {
        if (!liters && liters !== 0) return "—";
        return `${(+liters).toFixed(1)} L`;
    };

    const getDeviceName = (fillup) => {
        return (fillup.device && fillup.device.name)
            ? fillup.device.name
            : (fillup.device && fillup.device.id ? fillup.device.id : "Desconocido");
    };

    const getDriverName = (fillup) => {
        return (fillup.driver && fillup.driver.name)
            ? fillup.driver.name
            : (fillup.driver && fillup.driver.id && fillup.driver.id !== "UnknownDriverId" ? fillup.driver.id : "Desconocido");
    };

    const getFuelTypeLabel = (fillup) => {
        const ft = fillup.fuelType || fillup.tankCapacity || null;
        if (!ft) return "—";
        return String(ft);
    };

    const showError = (msg) => {
        errorToastMsg.textContent = msg;
        errorToast.style.display = "flex";
        setTimeout(() => { errorToast.style.display = "none"; }, 5000);
    };

    const removeSkeleton = (...ids) => {
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove("skeleton");
        });
    };

    const animateCount = (el, target, decimals = 0) => {
        const duration = 900;
        const start = performance.now();
        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = target * eased;
            el.textContent = decimals > 0
                ? current.toFixed(decimals).toLocaleString("es-MX")
                : Math.round(current).toLocaleString("es-MX");
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    // ─── Render summary KPIs ─────────────────────────────────────────────────
    const renderSummary = (fillups) => {
        const total = fillups.length;
        const totalLitros = fillups.reduce((s, f) => s + (parseFloat(f.derivedVolume) || 0), 0);
        const promedio = total > 0 ? totalLitros / total : 0;

        const deviceSet = new Set(fillups.map(f => getDeviceName(f)));
        const unidades = deviceSet.size;

        // Most recent
        let ultimo = null;
        fillups.forEach(f => {
            if (!ultimo || new Date(f.dateTime) > new Date(ultimo.dateTime)) ultimo = f;
        });

        // Animate counters
        const totalEl = document.getElementById("stat-total");
        const litrosEl = document.getElementById("stat-litros");
        const promedioEl = document.getElementById("stat-promedio");
        const unidadesEl = document.getElementById("stat-unidades");

        if (totalEl) { totalEl.classList.remove("skeleton"); animateCount(totalEl, total); }
        if (litrosEl) { litrosEl.classList.remove("skeleton"); animateCount(litrosEl, Math.round(totalLitros)); }
        if (promedioEl) { promedioEl.classList.remove("skeleton"); promedioEl.textContent = promedio.toFixed(1) + " L"; }
        if (unidadesEl) { unidadesEl.classList.remove("skeleton"); animateCount(unidadesEl, unidades); }

        // Last fill-up
        const ultimoFechaEl = document.getElementById("stat-ultimo-fecha");
        const ultimoUnidadEl = document.getElementById("stat-ultimo-unidad");
        if (ultimoFechaEl) {
            ultimoFechaEl.classList.remove("skeleton");
            ultimoFechaEl.textContent = ultimo ? formatDateShort(ultimo.dateTime) : "Sin datos";
        }
        if (ultimoUnidadEl) {
            ultimoUnidadEl.classList.remove("skeleton");
            ultimoUnidadEl.textContent = ultimo
                ? `${getDeviceName(ultimo)} · ${formatTimeShort(ultimo.dateTime)}`
                : "—";
        }

        // Badge
        const badgeRanking = document.getElementById("badge-ranking");
        if (badgeRanking) {
            badgeRanking.classList.remove("skeleton");
            badgeRanking.textContent = `${deviceSet.size} unidades`;
        }

        // Stat sub for total
        const totalBadge = document.getElementById("stat-total-badge");
        if (totalBadge) totalBadge.textContent = isCustomRange ? "rango personalizado" : `últimos ${selectedDays} días`;
    };

    // ─── Render ranking list ──────────────────────────────────────────────────
    const renderRanking = (fillups) => {
        const byDevice = {};
        const litrosByDevice = {};
        fillups.forEach(f => {
            const name = getDeviceName(f);
            byDevice[name] = (byDevice[name] || 0) + 1;
            litrosByDevice[name] = (litrosByDevice[name] || 0) + (parseFloat(f.derivedVolume) || 0);
        });

        const items = Object.entries(byDevice)
            .map(([name, count]) => ({ name, count, litros: litrosByDevice[name] || 0 }))
            .sort((a, b) => b.count - a.count);

        const maxCount = items.length > 0 ? items[0].count : 1;

        const ul = document.getElementById("ranking-list");
        if (!ul) return;
        ul.innerHTML = "";

        if (items.length === 0) {
            ul.innerHTML = `<li class="ranking-empty">Sin datos en el periodo seleccionado</li>`;
            return;
        }

        items.forEach((item, idx) => {
            const pct = Math.round((item.count / maxCount) * 100);
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
                    <span class="ranking-count">${item.count}</span>
                    <span class="ranking-liters">${item.litros.toFixed(0)} L</span>
                </div>
            `;
            ul.appendChild(li);
        });
    };

    // ─── Render table ─────────────────────────────────────────────────────────
    const renderTable = (fillups) => {
        const tbody = document.getElementById("fillup-tbody");
        const emptyEl = document.getElementById("table-empty");
        const badgeTable = document.getElementById("badge-table");

        if (!tbody) return;
        tbody.innerHTML = "";

        if (badgeTable) badgeTable.textContent = `${fillups.length} registros`;

        if (fillups.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            return;
        }
        if (emptyEl) emptyEl.style.display = "none";

        // Sort by most recent first
        const sorted = [...fillups].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

        sorted.forEach(f => {
            const tr = document.createElement("tr");
            tr.className = "fillup-row";
            const vol = parseFloat(f.derivedVolume) || 0;
            const volClass = vol > 50 ? "vol-high" : vol > 20 ? "vol-mid" : "vol-low";

            tr.innerHTML = `
                <td class="col-unit">
                    <div class="unit-chip">
                        <div class="unit-dot"></div>
                        <span>${getDeviceName(f)}</span>
                    </div>
                </td>
                <td class="col-driver">${getDriverName(f)}</td>
                <td class="col-date">
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(f.dateTime)}</span>
                        <span class="date-time">${formatTimeShort(f.dateTime)}</span>
                    </div>
                </td>
                <td class="col-vol">
                    <span class="vol-badge ${volClass}">${formatVolume(f.derivedVolume)}</span>
                </td>
                <td class="col-odo">${formatOdometer(f.odometer)}</td>
                <td class="col-loc">
                    ${(f.location && f.location.x && f.location.y)
                    ? `<button class="btn-location" data-lat="${f.location.y}" data-lng="${f.location.x}" data-unit="${getDeviceName(f)}">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                    <circle cx="12" cy="10" r="3" />
                                </svg>
                                Ver Mapa
                           </button>`
                    : (f.location ? JSON.stringify(f.location) : "—")
                }
                </td>
            `;
            tbody.appendChild(tr);
        });

        bindLocationButtons();
    };

    const bindLocationButtons = () => {
        document.querySelectorAll('.btn-location').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const lat = btn.getAttribute('data-lat');
                const lng = btn.getAttribute('data-lng');
                const unit = btn.getAttribute('data-unit');

                const mapModal = document.getElementById("map-modal");
                const mapIframe = document.getElementById("map-iframe");
                const modalTitle = document.getElementById("map-modal-title");

                if (modalTitle) modalTitle.textContent = `Ubicación: ${unit}`;
                if (mapIframe) mapIframe.src = `https://maps.google.com/maps?q=${lat},${lng}&hl=es&z=16&t=k&output=embed`;
                if (mapModal) mapModal.style.display = "flex";
            });
        });
    };

    // ─── Render raw table (all data) ──────────────────────────────────────────
    const renderRawTable = (fillups) => {
        const thead = document.getElementById("raw-thead");
        const tbody = document.getElementById("raw-tbody");
        if (!thead || !tbody) return;

        if (fillups.length === 0) {
            thead.innerHTML = "<tr><th>Sin datos</th></tr>";
            tbody.innerHTML = "<tr><td style=\"text-align:center; padding: 2rem;\">No se encontraron llenados en el periodo seleccionado.</td></tr>";
            return;
        }

        // Collect all unique keys from all objects
        const keySet = new Set();
        fillups.forEach(f => {
            Object.keys(f).forEach(k => keySet.add(k));
        });

        // Sort keys alphabetically but prioritize common ones
        const priorityKeys = ["device", "dateTime", "derivedVolume", "location", "odometer"];
        const columns = Array.from(keySet).sort((a, b) => {
            const pA = priorityKeys.indexOf(a);
            const pB = priorityKeys.indexOf(b);
            if (pA !== -1 && pB !== -1) return pA - pB;
            if (pA !== -1) return -1;
            if (pB !== -1) return 1;
            return a.localeCompare(b);
        });

        // Header
        const trHead = document.createElement("tr");
        columns.forEach(col => {
            const th = document.createElement("th");
            th.textContent = col;
            trHead.appendChild(th);
        });
        thead.innerHTML = "";
        thead.appendChild(trHead);

        // Body
        tbody.innerHTML = "";
        fillups.forEach(f => {
            const tr = document.createElement("tr");
            columns.forEach(col => {
                const td = document.createElement("td");
                let val = f[col];
                if (val !== null && typeof val === "object") {
                    val = val.name ? val.name : (val.id ? val.id : JSON.stringify(val));
                }
                td.textContent = (val !== undefined && val !== null && val !== "") ? val : "—";
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    };

    // ─── Reset UI ─────────────────────────────────────────────────────────────
    const resetUI = () => {
        // Summary stats
        ["stat-total", "stat-litros", "stat-promedio", "stat-unidades",
            "stat-ultimo-fecha", "stat-ultimo-unidad"].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.textContent = "—"; el.classList.add("skeleton"); }
            });

        // Ranking
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

        // Table
        const tbody = document.getElementById("fillup-tbody");
        if (tbody) tbody.innerHTML = `
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
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

        // Raw Table
        const rawThead = document.getElementById("raw-thead");
        const rawTbody = document.getElementById("raw-tbody");
        if (rawThead) rawThead.innerHTML = `<tr><th>Cargando...</th></tr>`;
        if (rawTbody) rawTbody.innerHTML = `<tr class="tr-skeleton"><td><div class="td-skel"></div></td></tr>`;

        if (searchInput) searchInput.value = "";
    };

    // ─── Filter by search ─────────────────────────────────────────────────────
    const applySearch = (query) => {
        if (!query || query.trim() === "") {
            filteredFillups = [...allFillups];
        } else {
            const q = query.trim().toLowerCase();
            filteredFillups = allFillups.filter(f => getDeviceName(f).toLowerCase().includes(q));
        }
        renderTable(filteredFillups);
        renderRawTable(filteredFillups);
        const badgeTable = document.getElementById("badge-table");
        if (badgeTable) badgeTable.textContent = `${filteredFillups.length} registros`;
    };

    // ─── MAIN DATA LOADER ─────────────────────────────────────────────────────
    const loadData = () => {
        resetUI();
        btnRefresh.disabled = true;
        btnRefresh.classList.add("loading");

        const { fromDate, toDate } = getDateRange();

        api.multiCall([
            ["Get", { typeName: "FillUp", search: { fromDate, toDate } }],
            ["Get", { typeName: "Device" }]
        ], (results) => {
            const result = results[0] || [];
            const devices = results[1] || [];

            // Map devices id -> name
            const deviceMap = {};
            devices.forEach(d => { deviceMap[d.id] = d.name; });

            // Enrich fillups with real name
            result.forEach(f => {
                if (f.device && f.device.id && deviceMap[f.device.id]) {
                    f.device.name = deviceMap[f.device.id];
                }
            });

            allFillups = result;
            filteredFillups = [...allFillups];

            renderSummary(allFillups);
            renderRanking(allFillups);
            renderTable(filteredFillups);
            renderRawTable(filteredFillups);
            updateCharts(allFillups);

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
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                <line x1="16" y1="2" x2="16" y2="6"/>
                                <line x1="8" y1="2" x2="8" y2="6"/>
                                <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            Personalizado
                        `;
                    }
                    loadData();
                });
            });

            // ── Custom date range button / popover ────────────────────────
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
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    ${fmt(from)} – ${fmt(to)}
                `;

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

            // ── Modal listeners ───────────────────────────────────────────
            const mapModal = document.getElementById("map-modal");
            const btnCloseMap = document.getElementById("btn-close-map");
            const mapIframe = document.getElementById("map-iframe");

            if (btnCloseMap && mapModal) {
                btnCloseMap.addEventListener("click", () => {
                    mapModal.style.display = "none";
                    if (mapIframe) mapIframe.src = "";
                });
                mapModal.addEventListener("click", (e) => {
                    if (e.target === mapModal) {
                        mapModal.style.display = "none";
                        if (mapIframe) mapIframe.src = "";
                    }
                });
            }

            // ── Chart interval buttons ───────────────────────────────────
            document.querySelectorAll(".btn-interval").forEach(btn => {
                btn.addEventListener("click", () => {
                    document.querySelectorAll(".btn-interval").forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    currentInterval = btn.dataset.interval;
                    updateCharts(allFillups);
                });
            });

            initCharts();
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

    // ─── Chart Logic ──────────────────────────────────────────────────────────
    function initCharts() {
        const textColor = '#5e6c84'; // matches --color-text-muted
        const commonOptions = {
            chart: { height: '100%', toolbar: { show: false }, animations: { enabled: true } },
            colors: ['#003666', '#00b1e1', '#3b753c', '#f29300', '#cc0000'],
            dataLabels: { enabled: false },
            grid: { borderColor: '#f1f5f9' },
            xaxis: {
                labels: {
                    show: true,
                    hideOverlappingLabels: true,
                    style: { colors: textColor, fontSize: '11px', fontWeight: 500 }
                },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                labels: {
                    show: true,
                    style: { colors: textColor, fontSize: '11px' }
                }
            }
        };

        // Monthly Trend
        charts.monthly = new ApexCharts(document.querySelector("#chart-monthly"), {
            ...commonOptions,
            chart: { ...commonOptions.chart, type: 'area', sparkline: { enabled: false } },
            series: [{ name: 'Litros', data: [] }],
            xaxis: {
                ...commonOptions.xaxis,
                type: 'category',
                labels: { ...commonOptions.xaxis.labels, rotate: -45, rotateAlways: false }
            },
            stroke: { curve: 'straight', width: 2 },
            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } }
        });

        // Day of Week
        charts.dow = new ApexCharts(document.querySelector("#chart-dow"), {
            ...commonOptions,
            chart: { ...commonOptions.chart, type: 'bar' },
            series: [{ name: 'Litros', data: [] }],
            plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
            xaxis: {
                ...commonOptions.xaxis,
                categories: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
            }
        });

        // Histogram
        charts.histogram = new ApexCharts(document.querySelector("#chart-histogram"), {
            ...commonOptions,
            chart: { ...commonOptions.chart, type: 'bar' },
            series: [{ name: 'Cargas', data: [] }],
            plotOptions: { bar: { borderRadius: 4, horizontal: false } },
            xaxis: {
                ...commonOptions.xaxis,
                title: { text: 'Rango (L)', style: { color: textColor, fontSize: '10px' } }
            }
        });

        // Heatmap
        charts.heatmap = new ApexCharts(document.querySelector("#chart-heatmap"), {
            ...commonOptions,
            chart: { ...commonOptions.chart, type: 'heatmap' },
            series: [],
            plotOptions: {
                heatmap: {
                    shadeIntensity: 0.5,
                    colorScale: {
                        ranges: [
                            { from: 0, to: 0, color: '#f8fafc', name: 'sin actividad' },
                            { from: 1, to: 5, color: '#e0f2fe', name: 'baja' },
                            { from: 6, to: 15, color: '#7dd3fc', name: 'media' },
                            { from: 16, to: 100, color: '#0ea5e9', name: 'alta' }
                        ]
                    }
                }
            },
            xaxis: {
                ...commonOptions.xaxis,
                labels: { ...commonOptions.xaxis.labels, show: true }
            }
        });

        Object.values(charts).forEach(c => c.render());
    }

    function updateCharts(data) {
        if (!data || data.length === 0) return;

        // 1. Trend Chart
        const trend = getTrendData(data, currentInterval);
        charts.monthly.updateSeries([{ name: 'Litros', data: trend.values }]);
        charts.monthly.updateOptions({ xaxis: { categories: trend.labels } });

        // 2. Day of Week
        const dow = getDoWData(data);
        charts.dow.updateSeries([{ name: 'Litros', data: dow }]);

        // 3. Histogram
        const hist = getHistogramData(data);
        charts.histogram.updateSeries([{ name: 'Cargas', data: hist.values }]);
        charts.histogram.updateOptions({ xaxis: { categories: hist.labels } });

        // 4. Heatmap
        const heatmapData = getHeatmapData(data);
        charts.heatmap.updateSeries(heatmapData);
    }

    function getTrendData(data, interval) {
        const groups = {};
        const sorted = [...data].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

        sorted.forEach(f => {
            const d = new Date(f.dateTime);
            let key;
            if (interval === 'day') {
                key = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
            } else if (interval === 'week') {
                const tempDate = new Date(d.getTime());
                const dayOfWeek = (tempDate.getDay() + 6) % 7; // 0=Mon, ..., 6=Sun
                const monday = new Date(tempDate.getFullYear(), tempDate.getMonth(), tempDate.getDate() - dayOfWeek);
                key = "Sem " + monday.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
            } else {
                key = d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
            }
            groups[key] = (groups[key] || 0) + (parseFloat(f.derivedVolume) || 0);
        });

        return {
            labels: Object.keys(groups),
            values: Object.values(groups).map(v => Math.round(v))
        };
    }

    function getDoWData(data) {
        const dow = new Array(7).fill(0);
        data.forEach(f => {
            const d = new Date(f.dateTime);
            let day = d.getDay(); // 0=Sun
            day = day === 0 ? 6 : day - 1; // 0=Mon, ..., 6=Sun
            dow[day] += (parseFloat(f.derivedVolume) || 0);
        });
        return dow.map(v => Math.round(v));
    }

    function getHistogramData(data) {
        const buckets = ["0-20", "20-40", "40-60", "60-80", "80-100", "100+"];
        const values = new Array(buckets.length).fill(0);
        data.forEach(f => {
            const v = parseFloat(f.derivedVolume) || 0;
            if (v < 20) values[0]++;
            else if (v < 40) values[1]++;
            else if (v < 60) values[2]++;
            else if (v < 80) values[3]++;
            else if (v < 100) values[4]++;
            else values[5]++;
        });
        return { labels: buckets, values };
    }

    function getHeatmapData(data) {
        // 7 days (Mon-Sun) x 24 hours
        const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        const matrix = days.map(day => ({ name: day, data: [] }));

        for (let d = 0; d < 7; d++) {
            for (let h = 0; h < 24; h++) {
                matrix[d].data.push({ x: `${h}h`, y: 0 });
            }
        }

        data.forEach(f => {
            const d = new Date(f.dateTime);
            let dayIdx = d.getDay();
            dayIdx = dayIdx === 0 ? 6 : dayIdx - 1;
            const hour = d.getHours();
            matrix[dayIdx].data[hour].y++;
        });

        return matrix;
    }
};

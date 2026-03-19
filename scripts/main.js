"use strict";

geotab.addin.dashboard = function () {
    let api;
    let selectedDays = 7;
    let customFromDate = null;
    let customToDate = null;
    let isCustomRange = false;
    let allFillups = [];       // All raw FillUp records
    let filteredFillups = [];  // After search filter

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
        const totalLitros = fillups.reduce((s, f) => s + (parseFloat(f.fuelVolumeAdded) || 0), 0);
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
            litrosByDevice[name] = (litrosByDevice[name] || 0) + (parseFloat(f.fuelVolumeAdded) || 0);
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
            const vol = parseFloat(f.fuelVolumeAdded) || 0;
            const volClass = vol > 50 ? "vol-high" : vol > 20 ? "vol-mid" : "vol-low";

            tr.innerHTML = `
                <td class="col-unit">
                    <div class="unit-chip">
                        <div class="unit-dot"></div>
                        <span>${getDeviceName(f)}</span>
                    </div>
                </td>
                <td class="col-date">
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(f.dateTime)}</span>
                        <span class="date-time">${formatTimeShort(f.dateTime)}</span>
                    </div>
                </td>
                <td class="col-vol">
                    <span class="vol-badge ${volClass}">${formatVolume(f.fuelVolumeAdded)}</span>
                </td>
                <td class="col-odo">${formatOdometer(f.odometer)}</td>
                <td class="col-dur">${formatDuration(f.durationOfFill)}</td>
                <td class="col-tank">${f.fuelType || "—"}</td>
            `;
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
        const badgeTable = document.getElementById("badge-table");
        if (badgeTable) badgeTable.textContent = `${filteredFillups.length} registros`;
    };

    // ─── MAIN DATA LOADER ─────────────────────────────────────────────────────
    const loadData = () => {
        resetUI();
        btnRefresh.disabled = true;
        btnRefresh.classList.add("loading");

        const { fromDate, toDate } = getDateRange();

        api.call("Get", {
            typeName: "FillUp",
            search: { fromDate, toDate }
        }, (result) => {
            allFillups = result || [];
            filteredFillups = [...allFillups];

            renderSummary(allFillups);
            renderRanking(allFillups);
            renderTable(filteredFillups);

            const now = new Date();
            lastUpdatedEl.textContent = `Actualizado: ${now.toLocaleTimeString("es-MX", {
                hour: "2-digit", minute: "2-digit", second: "2-digit"
            })}`;

            btnRefresh.disabled = false;
            btnRefresh.classList.remove("loading");
        }, (err) => {
            console.error("Error fetching FillUp:", err);
            showError("Error al cargar los llenados. Verifique la conexión.");
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

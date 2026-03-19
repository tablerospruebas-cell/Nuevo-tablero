"use strict";

geotab.addin.dashboard = function () {
    let api;
    let selectedDays = 7;
    let customFromDate = null;   // ISO string when custom range is active
    let customToDate = null;
    let isCustomRange = false;

    // ─── DOM refs ───────────────────────────────────────────────────────────
    let btnRefresh, lastUpdatedEl, errorToast, errorToastMsg;

    // ─── Helpers ────────────────────────────────────────────────────────────
    const getDateRange = () => {
        if (isCustomRange && customFromDate && customToDate) {
            return { fromDate: customFromDate, toDate: customToDate };
        }
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - selectedDays);
        return { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() };
    };

    const formatDate = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
    };

    const showError = (msg) => {
        errorToastMsg.textContent = msg;
        errorToast.style.display = "flex";
        setTimeout(() => { errorToast.style.display = "none"; }, 5000);
    };

    // Remove skeleton class once data is loaded
    const removeSkeleton = (...ids) => {
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove("skeleton");
        });
    };

    // Animate counter from 0 to target
    const animateCount = (el, target, suffix = "") => {
        const duration = 900;
        const start = performance.now();
        const from = 0;
        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(from + (target - from) * eased);
            el.textContent = current.toLocaleString("es-MX") + suffix;
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    // Build a small list of top items inside a kpi-list element
    const renderList = (listId, items) => {
        const ul = document.getElementById(listId);
        if (!ul) return;
        ul.innerHTML = "";
        if (!items || items.length === 0) {
            ul.innerHTML = `<li class="kpi-list-empty">Sin datos en el periodo</li>`;
            return;
        }
        items.forEach(item => {
            const li = document.createElement("li");
            li.className = "kpi-list-item";
            li.innerHTML = `
                <span class="kpi-list-name">${item.name}</span>
                <span class="kpi-list-count">${item.count.toLocaleString("es-MX")}${item.suffix || ""}</span>
            `;
            ul.appendChild(li);
        });
    };

    // ─── Aggregate exception events by device name ───────────────────────────
    const aggregateByDevice = (events) => {
        const map = {};
        events.forEach(ev => {
            const name = (ev.device && ev.device.name) ? ev.device.name : (ev.device && ev.device.id ? ev.device.id : "Desconocido");
            map[name] = (map[name] || 0) + 1;
        });
        return Object.entries(map)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    };

    // ─── Update a KPI card ────────────────────────────────────────────────────
    const updateCard = ({ countId, badgeId, topId, trendId, listId, events, valueExtractor, topLabel, suffix = "" }) => {
        let total;
        let topItems;

        if (valueExtractor) {
            // For fuel: sum a numeric field, topItems show top consumers
            const byDevice = {};
            events.forEach(ev => {
                const name = (ev.device && ev.device.name) ? ev.device.name : "Desconocido";
                byDevice[name] = (byDevice[name] || 0) + (valueExtractor(ev) || 0);
            });
            topItems = Object.entries(byDevice)
                .map(([name, count]) => ({ name, count: Math.round(count * 10) / 10, suffix }))
                .sort((a, b) => b.count - a.count);
            total = Math.round(topItems.reduce((s, i) => s + i.count, 0) * 10) / 10;
        } else {
            topItems = aggregateByDevice(events).map(i => ({ ...i, suffix }));
            total = events.length;
        }

        const countEl = document.getElementById(countId);
        const badgeEl = document.getElementById(badgeId);
        const topEl = document.getElementById(topId);
        const trendEl = document.getElementById(trendId);

        if (countEl) animateCount(countEl, total, valueExtractor ? "" : "");
        if (badgeEl) { badgeEl.textContent = `${selectedDays}d`; }

        if (topEl) {
            topEl.textContent = topItems.length > 0
                ? `${topItems[0].name} (${topItems[0].count.toLocaleString("es-MX")}${suffix})`
                : "Sin datos";
        }

        if (trendEl && topItems.length > 0) {
            const pct = total > 0 ? Math.round((topItems[0].count / total) * 100) : 0;
            trendEl.textContent = `${pct}% concentrado`;
        }

        renderList(listId, topItems.slice(0, 5));
        removeSkeleton(countId, badgeId, topId);
    };

    // ─── Fuel: special card update ───────────────────────────────────────────
    const updateFuelCard = (fuelUsed) => {
        const byDevice = {};
        fuelUsed.forEach(ev => {
            const name = (ev.device && ev.device.name) ? ev.device.name : "Desconocido";
            byDevice[name] = (byDevice[name] || 0) + (ev.fuelUsedLiters || ev.value || 0);
        });
        const topItems = Object.entries(byDevice)
            .map(([name, count]) => ({ name, count: +(count.toFixed(1)), suffix: " L" }))
            .sort((a, b) => b.count - a.count);
        const total = +(topItems.reduce((s, i) => s + i.count, 0).toFixed(1));

        const countEl = document.getElementById("count-fuel");
        const badgeEl = document.getElementById("badge-fuel");
        const topEl = document.getElementById("top-fuel");
        const trendEl = document.getElementById("trend-fuel");

        if (countEl) animateCount(countEl, Math.round(total));
        if (badgeEl) badgeEl.textContent = `${selectedDays}d`;
        if (topEl) topEl.textContent = topItems.length > 0 ? `${topItems[0].name} (${topItems[0].count.toLocaleString("es-MX")} L)` : "Sin datos";
        if (trendEl && topItems.length > 0) {
            const pct = total > 0 ? Math.round((topItems[0].count / total) * 100) : 0;
            trendEl.textContent = `${pct}% del total`;
        }
        renderList("list-fuel", topItems.slice(0, 5));
        removeSkeleton("count-fuel", "badge-fuel", "top-fuel");
    };

    // ─── Fillup card ─────────────────────────────────────────────────────────
    const updateFillupCard = (transactions) => {
        const byDevice = {};
        let lastDate = null;

        transactions.forEach(tx => {
            const name = (tx.device && tx.device.name) ? tx.device.name : "Desconocido";
            byDevice[name] = (byDevice[name] || 0) + 1;
            if (!lastDate || new Date(tx.dateTime) > new Date(lastDate)) {
                lastDate = tx.dateTime;
            }
        });

        const topItems = Object.entries(byDevice)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
        const total = transactions.length;

        const countEl = document.getElementById("count-fillup");
        const badgeEl = document.getElementById("badge-fillup");
        const topEl = document.getElementById("top-fillup");
        const trendEl = document.getElementById("trend-fillup");

        if (countEl) animateCount(countEl, total);
        if (badgeEl) badgeEl.textContent = `${selectedDays}d`;
        if (topEl) topEl.textContent = lastDate ? `Último: ${formatDate(lastDate)}` : "Sin datos";
        if (trendEl && topItems.length > 0) {
            trendEl.textContent = `${topItems[0].name} (${topItems[0].count} llenados)`;
        }
        renderList("list-fillup", topItems.slice(0, 5));
        removeSkeleton("count-fillup", "badge-fillup", "top-fillup");
    };

    // ─── Reset all cards to skeleton/loading state ────────────────────────────
    const resetCards = () => {
        const counters = ["count-mantto", "count-rpm", "count-speed", "count-collision", "count-fuel", "count-fillup"];
        const badges = ["badge-mantto", "badge-rpm", "badge-speed", "badge-collision", "badge-fuel", "badge-fillup"];
        const tops = ["top-mantto", "top-rpm", "top-speed", "top-collision", "top-fuel", "top-fillup"];
        const lists = ["list-mantto", "list-rpm", "list-speed", "list-collision", "list-fuel", "list-fillup"];

        [...counters, ...badges, ...tops].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = "—"; el.classList.add("skeleton"); }
        });

        lists.forEach(listId => {
            const ul = document.getElementById(listId);
            if (ul) ul.innerHTML = `<li class="kpi-list-skeleton"></li><li class="kpi-list-skeleton"></li><li class="kpi-list-skeleton"></li>`;
        });

        ["trend-mantto", "trend-rpm", "trend-speed", "trend-collision", "trend-fuel", "trend-fillup"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = "";
        });
    };

    // ─── MAIN DATA LOADER ─────────────────────────────────────────────────────
    const loadData = () => {
        resetCards();
        btnRefresh.disabled = true;
        btnRefresh.classList.add("loading");

        const { fromDate, toDate } = getDateRange();

        // Helper to do a single Get call returning a Promise
        const apiGet = (typeName, search) => new Promise((resolve) => {
            api.call("Get", { typeName, search }, (result) => resolve(result || []), (err) => {
                console.error(`Error fetching ${typeName}:`, err);
                resolve([]);
            });
        });

        // ── 1. Mantto Correctivo: FaultData ─────────────────────────────────
        const faultData = apiGet("FaultData", { fromDate, toDate });

        // ── 2. RPM Exceptions ────────────────────────────────────────────────
        const rpmExceptions = apiGet("ExceptionEvent", {
            fromDate, toDate,
            ruleSearch: { name: "RPM" }
        });

        // ── 3. Speed Exceptions ──────────────────────────────────────────────
        const speedExceptions = apiGet("ExceptionEvent", {
            fromDate, toDate,
            ruleSearch: { name: "Velocidad" }
        });

        // ── 3b. Speed fallback with English keyword ──────────────────────────
        const speedExceptionsEn = apiGet("ExceptionEvent", {
            fromDate, toDate,
            ruleSearch: { name: "Speed" }
        });

        // ── 4. Collision Risk ────────────────────────────────────────────────
        const collisionEvents = apiGet("ExceptionEvent", {
            fromDate, toDate,
            ruleSearch: { name: "Colision" }
        });
        const collisionEventsEn = apiGet("ExceptionEvent", {
            fromDate, toDate,
            ruleSearch: { name: "Collision" }
        });

        // ── 5. Fuel Usage ────────────────────────────────────────────────────
        const fuelUsed = apiGet("FuelUsed", { fromDate, toDate });

        // ── 6. Fill-ups (FillUp) ─────────────────────────────────────────────
        const fillUps = apiGet("FillUp", { fromDate, toDate });

        // ── Wait for all and update cards ────────────────────────────────────
        Promise.all([faultData, rpmExceptions, speedExceptions, speedExceptionsEn,
            collisionEvents, collisionEventsEn, fuelUsed, fillUps])
            .then(([faults, rpm, speedEs, speedEn, collEs, collEn, fuel, fillups]) => {

                // Merge Spanish + English speed and collision results (deduplicate by id)
                const mergeUniq = (a, b) => {
                    const seen = new Set(a.map(e => e.id));
                    return [...a, ...b.filter(e => !seen.has(e.id))];
                };

                const speedAll = mergeUniq(speedEs, speedEn);
                const collAll = mergeUniq(collEs, collEn);

                // ── Mantto Correctivo ────────────────────────────────────────
                updateCard({
                    countId: "count-mantto", badgeId: "badge-mantto",
                    topId: "top-mantto", trendId: "trend-mantto", listId: "list-mantto",
                    events: faults
                });

                // ── RPM ──────────────────────────────────────────────────────
                updateCard({
                    countId: "count-rpm", badgeId: "badge-rpm",
                    topId: "top-rpm", trendId: "trend-rpm", listId: "list-rpm",
                    events: rpm
                });

                // ── Velocidad ────────────────────────────────────────────────
                updateCard({
                    countId: "count-speed", badgeId: "badge-speed",
                    topId: "top-speed", trendId: "trend-speed", listId: "list-speed",
                    events: speedAll
                });

                // ── Colisión ─────────────────────────────────────────────────
                updateCard({
                    countId: "count-collision", badgeId: "badge-collision",
                    topId: "top-collision", trendId: "trend-collision", listId: "list-collision",
                    events: collAll
                });

                // ── Combustible ──────────────────────────────────────────────
                updateFuelCard(fuel);

                // ── Llenados ─────────────────────────────────────────────────
                updateFillupCard(fillups);

                // Timestamp
                const now = new Date();
                lastUpdatedEl.textContent = `Actualizado: ${now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

                btnRefresh.disabled = false;
                btnRefresh.classList.remove("loading");
            })
            .catch(err => {
                console.error("Error general:", err);
                showError("Error al cargar uno o más indicadores. Verifique la conexión.");
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

            // ── Pre-set date range buttons ────────────────────────────────
            document.querySelectorAll(".btn-range[data-days]").forEach(btn => {
                btn.addEventListener("click", () => {
                    document.querySelectorAll(".btn-range").forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    selectedDays = parseInt(btn.dataset.days, 10);
                    isCustomRange = false;
                    customFromDate = null;
                    customToDate = null;
                    // Reset custom button label
                    const btnCustom = document.getElementById("btn-custom");
                    if (btnCustom) btnCustom.dataset.label = "";
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

            // Set default values (today and 7 days ago)
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
                if (!from || !to) {
                    showError("Selecciona ambas fechas antes de aplicar.");
                    return;
                }
                if (new Date(from) > new Date(to)) {
                    showError("La fecha 'Desde' no puede ser mayor que 'Hasta'.");
                    return;
                }
                customFromDate = new Date(from + "T00:00:00").toISOString();
                customToDate = new Date(to + "T23:59:59").toISOString();
                isCustomRange = true;

                // Update button label with chosen range
                const fmt = (s) => new Date(s + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
                btnCustom.innerHTML = `
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    ${fmt(from)} – ${fmt(to)}
                `;

                // Deactivate preset buttons, activate custom
                document.querySelectorAll(".btn-range").forEach(b => b.classList.remove("active"));
                btnCustom.classList.add("active");

                closePopover();
                loadData();
            });

            // Close popover when clicking outside
            document.addEventListener("click", (e) => {
                if (!datePopover.contains(e.target) && e.target !== btnCustom) {
                    closePopover();
                }
            });

            // Enforce max date on "from" input
            dateFromInput.addEventListener("change", () => {
                dateToInput.min = dateFromInput.value;
            });

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

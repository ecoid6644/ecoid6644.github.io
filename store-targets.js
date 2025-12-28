(function () {
  /* ====== Model & helpers ====== */
  const DEFAULT_METRICS = [{
    key: "GP", label: "GP", target: 0, mtd: 0
  }, {
    key: "GM", label: "GM", target: 0, mtd: 0
  }, {
    key: "NC", label: "NC", target: 0, mtd: 0
  }, {
    key: "FAB", label: "FAB", target: 0, mtd: 0
  }, {
    key: "BFAB", label: "BFAB", target: 0, mtd: 0
  }, {
    key: "ICT", label: "ICT", target: 0, mtd: 0
  }, {
    key: "P2P", label: "P2P", target: 0, mtd: 0
  }, {
    key: "BOA", label: "BOA", target: 0, mtd: 0
  }];
  let currentStore = null;
  let storeData = null;
  let setupNames = [];
  const $ = s => document.querySelector(s);

  const money2 = v => {
    const n = Number(v || 0);
    return (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  };
  const isMoney2 = k => ["GP", "GMM", "GM"].includes(String(k || "").toUpperCase());

  const fmt = (v, k) => isMoney2(k) ? money2(v) : Number(v || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
  const clamp01to100 = p => Math.max(0, Math.min(100, p));
  const round2 = x => Math.round(Number(x || 0) * 100) / 100;

  const fmtPct2 = p => (isFinite(p) ? round2(p) : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }) + "%";

  const keyNew = s => `area_targets_store::${s}`;

  const legacyKeys = s => [
    keyNew(s),
    `OneNZ_store::${s}`,
    `targets_store::${s}`,
    `store::${s}`
  ];

  /* Note: Dark Mode Toggle logic removed as it is handled by the main app */

  /* Dates */
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function autoSetDatesIfEmpty() {
    const now = new Date();
    const y = now.getFullYear(),
      m = pad(now.getMonth() + 1),
      d = pad(now.getDate());

    const mp = $("#monthPicker");
    const tp = $("#todayPicker");
    if (mp && !mp.value) mp.value = `${y}-${m}`;
    if (tp && !tp.value) tp.value = `${y}-${m}-${d}`;
  }

  function applyDatesToStore() {
    if (!storeData) return;
    const mp = $("#monthPicker");
    const tp = $("#todayPicker");
    if (mp && !storeData.month) storeData.month = mp.value;
    if (tp && !storeData.today) storeData.today = tp.value;
    saveStore();
  }

  /* Storage */
  function readStore(s) {
    for (const k of legacyKeys(s)) {
      const raw = localStorage.getItem(k);
      if (raw && raw !== "undefined") {
        try {
          return JSON.parse(raw);
        } catch { }
      }
    }
    return null;
  }

  function ensureStoreRecord(s) {
    const f = readStore(s);

    if (f) {
      if (!Array.isArray(f.metrics)) f.metrics = JSON.parse(JSON.stringify(DEFAULT_METRICS));
      if (!Array.isArray(f.roster)) f.roster = [];

      f.storeRates = f.storeRates || {};
      f.csvImported = !!f.csvImported;
      return f;
    }

    return {
      month: "",
      today: "",
      metrics: JSON.parse(JSON.stringify(DEFAULT_METRICS)),
      roster: [],
      storeRates: {},
      csvImported: false
    };
  }

  function saveStore() {
    if (currentStore) localStorage.setItem(keyNew(currentStore), JSON.stringify(storeData));
  }

  function needSetup(d) {
    return !d || !d.csvImported || !(d.roster || []).length;
  }

  /* Parsing */
  function normHeader(h) {
    return String(h || "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9]/g, " ").trim();
  }

  function parsePercentCell(v) {
    if (v == null) return NaN;
    let s = String(v).replace(/^\uFEFF/, "").trim();
    if (!s) return NaN;
    if (s.includes("%")) s = s.replace("%", "").trim();
    const n = Number(s);
    if (!isFinite(n)) return NaN;
    const c = (Math.abs(n) <= 1) ? (n * 100) : n;
    return c < 0 ? 0 : c;
  }

  function parseNumberCell(v) {
    if (v == null || v === "") return 0;
    const s = String(v).replace(/^\uFEFF/, "").replace(/[^0-9\.\-]/g, "");
    const n = parseFloat(s);
    return isFinite(n) ? n : 0
  }

  function parseCSV(text) {
    const rows = [];
    let i = 0,
      cur = "",
      inQ = false,
      row = [];

    while (i < text.length) {
      const c = text[i];

      if (c == '"') {
        if (inQ && text[i + 1] == '"') {
          cur += '"';
          i++
        } else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        row.push(cur);
        cur = ""
      } else if ((c == '\n' || c == '\r') && !inQ) {
        if (cur !== "" || row.length) {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = ""
        }
      } else cur += c;
      i++
    }

    if (cur !== "" || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return rows.filter(r => r.length && r.some(x => String(x).trim() !== ""));
  }

  function parseTSV(text) {
    return text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.match.length > 0).map(line => line.split("\t"));
  }

  function parseTable(text) {
    const first = (text.split(/\r?\n/)[0] || "");
    const tabs = (first.match(/\t/g) || []).length;
    const commas = (first.match(/, /g) || []).length;
    return (tabs > commas) ? parseTSV(text) : parseCSV(text);
  }

  function findCol(headerNorm, patterns) {
    const pats = patterns.map(p => normHeader(p));

    for (let i = 0; i < headerNorm.length; i++) {
      const h = headerNorm[i];

      for (const p of pats) {
        if (h === p || h.includes(p)) return i;
      }
    }
    return -1;
  }

  /* Importer */
  async function handleCSVImport(files, {
    logEl, nextBtn, doneBtn, collectNames = false
  } = {}) {
    if (!files || !files.length) {
      if (logEl) logEl.textContent = "No files selected.";
      return
    }

    if (!currentStore) {
      const il = document.getElementById('importLog');
      if (il) il.textContent = "Select a store first.";
      openStart();
      return
    }

    const logs = [];
    let storeTotals = {};
    let repTotals = {};
    const repRatesSum = {}, repRatesCnt = {};
    storeData.storeRates = storeData.storeRates || {};
    const directRates = {};

    const exact = {
      name: ["Rep", "Name"], gp: ["Total Gross Profit", "Gross Profit", "Total GP"], gm: ["General Merchandise Margin", "GM", "General Merchandise Margin ex Trend"],
      trend_ar: ["Trend Micro attach to IFP devices", "Trend attach to IFP", "Trend Micro attach"], trend_43: ["Trend Micro 4 device 3 year ratio", "Trend 4/3 ratio", "4 device 3 year ratio", "Trend Micro 4 device 3 year"],
      one_ar: ["One Upgrade attach to IFP devices", "One Upgrade attach"], nc: ["Consumer On Account", "On Account"], p2p: ["Consumer Pre2Post", "Pre2Post", "Pre to Post", "Pre 2 Post"],
      fab: ["Consumer New Broadband", "New Broadband (consumer)", "New Broadband"], boa: ["Business On Account", "BOA", "Business on a c", "Business on a/c"], bfab: ["Business new broadband", "Business broadband new", "BB new"],
      ict_new: ["ICT (new)", "ICT new", "ICT- new", "ICT new only"], ict_any: ["ICT"]
    };
    const seenNames = new Set();
    let filesHandled = 0;

    for (const f of files) {
      const text = await f.text();
      const rows = parseTable(text);

      if (!rows.length) {
        logs.push(`Skipped (empty): ${f.name}`);
        continue
      }

      const headerNorm = rows[0].map(normHeader);

      const idx = {
        name: findCol(headerNorm, exact.name), gp: findCol(headerNorm, exact.gp), gm: findCol(headerNorm, exact.gm),
        trend: findCol(headerNorm, exact.trend_ar), r43: findCol(headerNorm, exact.trend_43), one: findCol(headerNorm, exact.one_ar),
        nc: findCol(headerNorm, exact.nc), p2p: findCol(headerNorm, exact.p2p), fab: findCol(headerNorm, exact.fab), boa: findCol(headerNorm, exact.boa),
        bfab: findCol(headerNorm, exact.bfab), ictn: findCol(headerNorm, exact.ict_new), ict: findCol(headerNorm, exact.ict_any)
      };

      const hasAnyRate = [idx.trend, idx.r43, idx.one].some(i => i > -1);
      const hasAnyCount = [idx.nc, idx.p2p, idx.fab, idx.boa, idx.bfab, idx.ictn].some(i => i > -1);
      const hasRep = idx.name > -1;

      if (!(hasRep || hasAnyRate || hasAnyCount)) {
        logs.push(`Skipped (unrecognized columns): ${f.name}`);
        continue
      }

      filesHandled++;

      if (hasRep) {
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          const who = String(row[idx.name] || "").trim();
          if (!who) continue;
          seenNames.add(who);

          if (idx.gp > -1) {
            const v = parseNumberCell(row[idx.gp]);
            storeTotals.GP = (storeTotals.GP || 0) + v;
            (repTotals.GP || (repTotals.GP = {}))[who] = (repTotals.GP[who] || 0) + v
          }

          if (idx.gm > -1) {
            const v = parseNumberCell(row[idx.gm]);
            storeTotals.GM = (storeTotals.GM || 0) + v;
            (repTotals.GM || (repTotals.GM = {}))[who] = (repTotals.GM[who] || 0) + v
          }

          if (idx.nc > -1) {
            const v = parseNumberCell(row[idx.nc]);
            storeTotals.NC = (storeTotals.NC || 0) + v;
            (repTotals.NC || (repTotals.NC = {}))[who] = (repTotals.NC[who] || 0) + v
          }

          if (idx.p2p > -1) {
            const v = parseNumberCell(row[idx.p2p]);
            storeTotals.P2P = (storeTotals.P2P || 0) + v;
            (repTotals.P2P || (repTotals.P2P = {}))[who] = (repTotals.P2P[who] || 0) + v
          }

          if (idx.fab > -1) {
            const v = parseNumberCell(row[idx.fab]);
            storeTotals.FAB = (storeTotals.FAB || 0) + v;
            (repTotals.FAB || (repTotals.FAB = {}))[who] = (repTotals.FAB[who] || 0) + v
          }

          if (idx.boa > -1) {
            const v = parseNumberCell(row[idx.boa]);
            storeTotals.BOA = (storeTotals.BOA || 0) + v;
            (repTotals.BOA || (repTotals.BOA = {}))[who] = (repTotals.BOA[who] || 0) + v
          }

          if (idx.bfab > -1) {
            const v = parseNumberCell(row[idx.bfab]);
            storeTotals.BFAB = (storeTotals.BFAB || 0) + v;
            (repTotals.BFAB || (repTotals.BFAB = {}))[who] = (repTotals.BFAB[who] || 0) + v
          }

          if (idx.ictn > -1) {
            const v = parseNumberCell(row[idx.ictn]);
            storeTotals.ICT = (storeTotals.ICT || 0) + v;
            (repTotals.ICT || (repTotals.ICT = {}))[who] = (repTotals.ICT[who] || 0) + v
          }

          if (idx.trend > -1) {
            const p = parsePercentCell(row[idx.trend]);
            if (isFinite(p)) {
              (repRatesSum.TREND_AR || (repRatesSum.TREND_AR = {}))[who] = (repRatesSum.TREND_AR[who] || 0) + p;
              (repRatesCnt.TREND_AR || (repRatesCnt.TREND_AR = {}))[who] = (repRatesCnt.TREND_AR[who] || 0) + 1
            }
          }

          if (idx.r43 > -1) {
            const p = parsePercentCell(row[idx.r43]);
            if (isFinite(p)) {
              (repRatesSum.TREND_4_3 || (repRatesSum.TREND_4_3 = {}))[who] = (repRatesSum.TREND_4_3[who] || 0) + p;
              (repRatesCnt.TREND_4_3 || (repRatesCnt.TREND_4_3 = {}))[who] = (repRatesCnt.TREND_4_3[who] || 0) + 1
            }
          }

          if (idx.one > -1) {
            const p = parsePercentCell(row[idx.one]);
            if (isFinite(p)) {
              (repRatesSum.ONE_AR || (repRatesSum.ONE_AR = {}))[who] = (repRatesSum.ONE_AR[who] || 0) + p;
              (repRatesCnt.ONE_AR || (repRatesCnt.ONE_AR = {}))[who] = (repRatesCnt.ONE_AR[who] || 0) + 1
            }
          }
        }

        const foundCols = ["Rep/Name",
          (idx.trend > -1 ? "Trend attach" : null),
          (idx.r43 > -1 ? "Trend 4/3" : null),
          (idx.one > -1 ? "One Upgrade" : null),
          (idx.gp > -1 ? "GP" : null),
          (idx.gm > -1 ? "GM" : null),
          (idx.nc > -1 ? "NC" : null),
          (idx.p2p > -1 ? "P2P" : null),
          (idx.fab > -1 ? "FAB" : null),
          (idx.boa > -1 ? "BOA" : null),
          (idx.bfab > -1 ? "BFAB" : null),
          (idx.ictn > -1 ? "ICT(new)" : null)].filter(Boolean).join(", ");

        logs.push(`Imported ${rows.length - 1} rows (per-rep): ${f.name} • cols: ${foundCols}`);
      } else if (hasAnyRate) {
        const grabAvg = (colIdx, key) => {
          if (colIdx > -1) {
            const vals = [];
            for (let r = 1; r < rows.length; r++) {
              const p = parsePercentCell(rows[r][colIdx]);
              if (isFinite(p)) vals.push(p)
            }
            if (vals.length) directRates[key] = vals.reduce((a, b) => a + b, 0) / vals.length
          }
        }

        grabAvg(idx.trend, "TREND_AR");
        grabAvg(idx.r43, "TREND_4_3");
        grabAvg(idx.one, "ONE_AR");
        const foundCols = [(idx.trend > -1 ? "Trend attach" : null),
        (idx.r43 > -1 ? "Trend 4/3" : null),
        (idx.one > -1 ? "One Upgrade" : null)].filter(Boolean).join(", ");

        logs.push(`Imported ${rows.length - 1} rows (rate-only): ${f.name} • cols: ${foundCols}`);
      } else {
        logs.push(`Skipped (no Rep/Name to map counts per person): ${f.name}`);
      }
    }

    const repRatesFinal = {};
    ["TREND_AR", "TREND_4_3", "ONE_AR"].forEach(k => {
      repRatesFinal[k] = {};
      const s = repRatesSum[k] || {}, c = repRatesCnt[k] || {};
      const names = new Set([...(storeData.roster || []).map(r => r.name).filter(Boolean), ...seenNames]);
      for (const n of names) {
        if (s[n] == null) repRatesFinal[k][n] = 0; else repRatesFinal[k][n] = clamp01to100(s[n] / (c[n] || 1))
      }
    });

    function avgRoster(key) {
      const names = (storeData.roster || []).filter(r => r.active !== false).map(r => r.name).filter(Boolean);
      if (!names.length) return NaN;
      const map = repRatesFinal[key] || {};
      const arr = names.map(n => Number(map[n] ?? 0));
      return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN
    }

    storeData.storeRates = storeData.storeRates || {};
    ["TREND_AR", "TREND_4_3", "ONE_AR"].forEach(k => {
      let v = avgRoster(k);
      if (!isFinite(v)) v = (directRates[k] != null) ? directRates[k] : storeData.storeRates[k];
      storeData.storeRates[k] = isFinite(v) ? v : 0
    });

    localStorage.setItem(`rep_totals_cache::${currentStore}`, JSON.stringify(repTotals));
    localStorage.setItem(`rep_rates_cache::${currentStore}`, JSON.stringify(repRatesFinal));

    // CRITICAL FIX: Clear manual overrides for metrics that were just imported
    (storeData.roster || []).forEach((r, i) => {
      (storeData.metrics || []).forEach(m => {
        const k = m.key.toUpperCase();
        if (storeTotals[k] != null) {
          localStorage.removeItem(`${currentStore}::${m.key}::${i}::mtd`);
        }
      });
    });

    (storeData.metrics || []).forEach(m => {
      const k = m.key.toUpperCase();
      if (storeTotals[k] != null) m.mtd = isMoney2(k) ? Number(storeTotals[k].toFixed(2)) : Math.round(storeTotals[k])
    });

    if (logEl) logEl.textContent = logs.join(" • ");
    const il = document.getElementById("importLog");
    if (il) il.textContent = logs.join(" • ");
    if (filesHandled > 0) storeData.csvImported = true;
    const cs = document.getElementById("csvStatus");
    if (cs) cs.textContent = storeData.csvImported ? "Imported" : "Not imported yet";
    saveStore();
    renderAll();

    if (collectNames) {
      setupNames = [...new Set([...setupNames, ...Array.from(seenNames)])];
      buildRosterConfirm(setupNames);
      if (nextBtn) nextBtn.disabled = setupNames.length === 0
    }

    if (doneBtn) doneBtn.disabled = false;
  }

  /* Store rates from cache (include missing = 0%) */
  function computeStoreRatesFromCache() {
    const cache = JSON.parse(localStorage.getItem(`rep_rates_cache::${currentStore}`) || "{}");
    const active = (storeData.roster || []).filter(r => r.active !== false).map(r => r.name).filter(Boolean);

    function avg(key) {
      if (!active.length) return 0;
      const map = cache[key] || {};
      const vals = active.map(n => Number(map[n] ?? 0));
      return vals.reduce((a, b) => a + b, 0) / vals.length
    }

    const computed = {
      TREND_AR: avg("TREND_AR"), ONE_AR: avg("ONE_AR"), TREND_4_3: avg("TREND_4_3")
    };

    storeData.storeRates = {
      ...storeData.storeRates,
      ...computed
    };
    saveStore();
    return computed;
  }

  /* Setup roster confirm */
  function buildRosterConfirm(names) {
    const box = $("#confirmRoster");
    if (!box) return;
    box.innerHTML = "";

    if (!names.length) {
      box.innerHTML = '<div class="mini">No names detected in CSVs yet.</div>';
      return;
    }

    names.sort((a, b) => a.localeCompare(b));

    names.forEach(n => {
      const row = document.createElement("div"); row.className = "flex"; row.style.margin = "6px 0";

      row.innerHTML = ` <input type="checkbox" class="cr-check" data-name="${n}" checked style="width:18px;height:18px" > <div style="flex:1" >${n}</div> <select class="cr-type" data-name="${n}" style="max-width:80px" > <option value="FT" selected>FT</option><option value="PT" >PT</option> </select> <input class="cr-hours" data-name="${n}" type="number" min="1" max="80" step="1" value="40" style="max-width:90px" > `;
      box.appendChild(row);
    });

    // Default FT/PT hours 40/20
    box.querySelectorAll(".cr-type").forEach(sel => {
      sel.addEventListener("change", e => {
        const nm = e.target.dataset.name;
        const hours = box.querySelector(`.cr-hours[data-name="${nm}"]`);
        hours.value = (e.target.value === "PT" ? 20 : 40);
      });
    });
  }

  /* Rendering */
  function getActiveRosterWithWeights() {
    const ra = (storeData.roster || []).map((r, i) => ({
      ...r, i
    })).filter(r => r.active !== false);
    const w = ra.map(r => Math.max(1, Math.min(80, Number(r.hours || (r.type === "PT" ? 20 : 40)))) / 40);
    const sum = w.reduce((a, b) => a + b, 0) || 1;

    return {
      rosterActive: ra, weights: w, wSum: sum
    }
  }

  function calcDaysLeft() {
    const mp = $("#monthPicker");
    const tp = $("#todayPicker");
    if (!mp || !tp) return { daysLeft: 0, daysIn: 0 };
    const m = mp.value,
      t = tp.value;

    if (!m || !t) return {
      daysLeft: 0, daysIn: 0
    };
    const total = new Date(m.split('-')[0], m.split('-')[1], 0).getDate();
    const td = new Date(t).getDate();

    return {
      daysLeft: Math.max(total - (td - 1), 0), daysIn: total
    }
  }

  function renderMetricsList() {
    const holder = $("#metricsList");
    if (!holder) return;
    holder.innerHTML = "";

    (storeData?.metrics || []).forEach((m, idx) => {
      const row = document.createElement("div");
      row.className = "p-4 bg-white/50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600/50 mb-3 hover:border-emerald-400 transition-colors group";
      row.innerHTML = `
        <div class="flex items-start gap-3 mb-3">
          <div class="flex-1">
             <label class="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1 block">Metric Name</label>
             <input class="w-full input-premium py-2 px-3 text-base font-bold rounded-lg" value="${m.label}" data-idx="${idx}" data-k="label">
          </div>
          <button id="btnRemoveMetric-${idx}" class="p-2 text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
             <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 18 18"/></svg>
          </button>
        </div>
        <div class="grid grid-cols-2 gap-4">
           <div>
              <label class="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1 block">Monthly Target</label>
              <input class="w-full input-premium py-1.5 px-3 text-sm rounded-lg" type="number" step="${isMoney2(m.key) ? "0.01" : "1"}" value="${m.target}" data-idx="${idx}" data-k="target">
           </div>
           <div>
              <label class="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1 block">MTD So Far</label>
              <input class="w-full input-premium py-1.5 px-3 text-sm rounded-lg" type="number" step="${isMoney2(m.key) ? "0.01" : "1"}" value="${m.mtd}" data-idx="${idx}" data-k="mtd">
           </div>
        </div>
      `;
      holder.appendChild(row);
      // Bind remove directly
      setTimeout(() => {
        const btn = document.getElementById(`btnRemoveMetric-${idx}`);
        if (btn) btn.onclick = () => removeMetric(idx);
      }, 0);
    });

    holder.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("input", e => {
        const i = Number(e.target.dataset.idx), k = e.target.dataset.k;
        const key = storeData.metrics[i].key;
        const val = isMoney2(key) ? Number(e.target.value || 0) : Math.round(Number(e.target.value || 0));
        storeData.metrics[i][k] = (k === "label") ? e.target.value : val;
        storeData.metrics[i].key = storeData.metrics[i].label.toUpperCase();
        saveStore();
        renderKPIs()
      })
    })
  }

  function addMetric() {
    if (!storeData) return;

    storeData.metrics.push({
      key: "NEW", label: "NEW", target: 0, mtd: 0
    });
    saveStore();
    renderAll()
  }
  // Expose
  window.addMetric = addMetric;

  function removeMetric(i) {
    storeData.metrics.splice(i, 1);
    saveStore();
    renderAll()
  }

  function renderRoster() {
    const box = $("#repsList");
    if (!box) return;
    box.innerHTML = "";
    const r = storeData?.roster || [];

    const rc = $("#rosterCount");
    if (rc) rc.textContent = `${r.filter(x => x.active !== false).length} active`;

    r.forEach((rep, i) => {
      const row = document.createElement("div");
      row.className = "p-4 bg-white/50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600/50 mb-3 hover:border-blue-400 transition-colors group";
      row.innerHTML = `
        <div class="flex items-start gap-3 mb-3">
           <div class="flex-1">
              <label class="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1 block">Staff Name</label>
              <input class="w-full input-premium py-2 px-3 text-base font-bold rounded-lg" value="${rep.name || ""}" data-i="${i}" data-k="name" placeholder="Enter name...">
           </div>
           <button id="btnRemoveRep-${i}" class="p-2 text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 mt-5">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 18 18"/></svg>
           </button>
        </div>
        <div class="grid grid-cols-2 gap-4">
           <div>
              <label class="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1 block">Role Type</label>
              <select class="w-full input-premium py-1.5 px-3 text-sm rounded-lg" data-i="${i}" data-k="type"><option ${rep.type === "FT" ? "selected" : ""}>FT</option><option ${rep.type === "PT" ? "selected" : ""}>PT</option></select>
           </div>
           <div>
              <label class="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1 block">Hours / Week</label>
              <input class="w-full input-premium py-1.5 px-3 text-sm rounded-lg" type="number" min="1" max="80" step="1" value="${Number(rep.hours || (rep.type === "PT" ? 20 : 40))}" data-i="${i}" data-k="hours">
           </div>
        </div>
      `;
      box.appendChild(row);
      setTimeout(() => {
        const btn = document.getElementById(`btnRemoveRep-${i}`);
        if (btn) btn.onclick = () => removeRep(i);
      }, 0);
    });

    box.querySelectorAll("input,select").forEach(inp => {
      inp.addEventListener("input", e => {
        const i = Number(e.target.dataset.i), k = e.target.dataset.k;
        let v = e.target.value;
        if (k === "active") v = (v === "true");
        if (k === "hours") v = Math.max(1, Math.min(80, Math.round(Number(v) || 0)));
        if (k === "type") {
          storeData.roster[i].type = v; storeData.roster[i].hours = (v === "PT" ? 20 : 40)
        } else {
          storeData.roster[i][k] = v
        }

        saveStore(); renderKPIs()
      })
    })
  }

  function addRep(type) {
    (storeData.roster || []).push({
      name: "New Rep", type, hours: (type === "PT" ? 20 : 40), active: true
    });
    saveStore();
    renderAll()
  }
  window.addRep = addRep;

  function removeRep(i) {
    storeData.roster.splice(i, 1);
    saveStore();
    renderAll()
  }

  function recomputeMetricMTD(key) {
    if (!storeData) return;
    const roster = (storeData.roster || []);
    let sum = 0;

    for (let i = 0; i < roster.length; i++) {
      const v = Number(localStorage.getItem(`${currentStore}::${key}::${i}::mtd`) || "0");
      if (isFinite(v)) sum += v
    }

    const cache = JSON.parse(localStorage.getItem(`rep_totals_cache::${currentStore}`) || "{}");

    const map = cache[key.toUpperCase()] || {};
    const names = new Set(roster.map(r => r.name));

    for (const [n, val] of Object.entries(map)) {
      if (!names.has(n)) sum += Number(val || 0)
    }

    const m = (storeData.metrics || []).find(x => String(x.key).toUpperCase() === key.toUpperCase());

    if (m) {
      m.mtd = isMoney2(key) ? Math.round(sum * 100) / 100 : Math.round(sum);
      saveStore();
      renderKPIs()
    }
  }
  window.recomputeMetricMTD = recomputeMetricMTD; // needed for inline onchange

  function renderKPIs() {
    const {
      daysLeft,
      daysIn
    } = calcDaysLeft();

    const dlp = $("#daysLeftPill");
    if (dlp) dlp.textContent = (daysLeft ? `${daysLeft} day${daysLeft > 1 ? "s" : ""} left · ${daysIn} in month` : "Set month + today");
    const grid = $("#storeCards");
    if (!grid) return;
    grid.innerHTML = "";

    (storeData.metrics || []).forEach(m => {
      const tgt = Math.max(0, m.target || 0), mtd = Math.max(0, m.mtd || 0);
      const rem = Math.max(tgt - mtd, 0);
      const pctRaw = (tgt > 0) ? (mtd / tgt * 100) : 0;
      const overBy = Math.max(mtd - tgt, 0);
      const pct = clamp01to100(pctRaw);

      let perDay = 0; if (daysLeft > 0) {
        perDay = isMoney2(m.key) ? (rem / daysLeft) : Math.ceil(rem / daysLeft)
      }

      const overDisplay = isMoney2(m.key) ? Math.round(overBy * 100) / 100 : Math.ceil(overBy);
      const card = document.createElement("div");
      card.className = "kpi-card";

      // Dynamic font size: smaller for money to prevent clutter
      const isMoney = isMoney2(m.key);
      const valFontSize = isMoney ? "1.75rem" : "2.5rem";

      card.innerHTML = `
        <div class="kpi-top" style="align-items:center; margin-bottom:0.25rem">
          <div class="kpi-title" style="margin:0">${m.label}</div>
          <div class="mini" style="font-weight:600; opacity:0.8">TARGET <span style="font-weight:800; margin-left:4px">${fmt(tgt, m.key)}</span></div>
        </div>
        
        <div class="kpi-val" style="
           font-size: ${valFontSize};
           margin-bottom: 0.75rem;
           letter-spacing: -0.02em;
           line-height: 1.1;
           white-space: nowrap;
           overflow: hidden;
           text-overflow: ellipsis;
        ">${fmt(mtd, m.key)}</div>

        <div class="bar" style="margin-bottom: 0.5rem"><i style="width:${pct}%"></i></div>

        <div class="kpi-sub">
          <div class="mini">
            ${overBy > 0 ? `<span class="pill over">Over ${fmt(overDisplay, m.key)}</span>` : `To go <strong>${fmt(rem, m.key)}</strong>`}
          </div>
          <div class="mini" style="margin-left:auto">Daily <strong>${fmt(perDay, m.key)}</strong></div>
        </div>
      `;
      grid.appendChild(card);
    });

    // Rates – vertical list with donuts
    const sr = computeStoreRatesFromCache();

    const metrics = [{
      label: "Trend Attach Rate", val: sr.TREND_AR
    }, {
      label: "One Upgrade Attach Rate", val: sr.ONE_AR
    }, {
      label: "Trend 4/3 Ratio", val: sr.TREND_4_3
    }].map(d => {
      const r = 26, c = 2 * Math.PI * r, off = c - (clamp01to100(d.val) / 100) * c;

      return `<div class="rate-item">
        <div class="donut">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle class="trk" cx="32" cy="32" r="${r}"></circle>
            <circle class="val" cx="32" cy="32" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}"></circle>
          </svg>
          <div class="center">${fmtPct2(d.val)}</div>
        </div>
        <div class="rate-text">
          <div class="rate-title">${d.label}</div>
          <div class="rate-sub">Averaged across active roster (missing=0.00%)</div>
        </div>
      </div>`;
    }).join("");
    const ro = $("#ratesOverview");
    if (ro) ro.innerHTML = metrics;

    renderRepTables();
    renderLeaderboards();
  }

  function renderRepTables() {
    const holder = $("#repTables");
    if (!holder) return;
    holder.innerHTML = "";
    holder.className = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"; // Grid layout

    const { rosterActive, weights, wSum } = getActiveRosterWithWeights();

    if (!rosterActive.length) {
      holder.innerHTML = '<div class="col-span-full text-center text-slate-500 py-8">Add staff to the roster to see their progress dashboard.</div>';
      return;
    }

    // Pre-calc totals and rates
    const totalsCache = JSON.parse(localStorage.getItem(`rep_totals_cache::${currentStore}`) || "{}");
    const ratesCache = JSON.parse(localStorage.getItem(`rep_rates_cache::${currentStore}`) || "{}");

    rosterActive.forEach((r, idx) => {
      const card = document.createElement("div");
      card.className = "glass-panel p-6 rounded-2xl flex flex-col gap-6 hover:border-emerald-400/50 transition-all duration-300";

      // Header
      let html = `
        <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-600/50/50 pb-4">
           <div>
              <h3 class="font-bold text-lg text-slate-800 dark:text-white">${r.name}</h3>
              <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider">${r.type} · ${r.hours} hrs</div>
           </div>
           <div class="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 font-bold">
              ${r.name.charAt(0)}
           </div>
        </div>
        <div class="space-y-5">
      `;

      // Metrics List
      (storeData.metrics || []).forEach(m => {
        const unit = (m.target || 0) / (wSum || 1);
        let kpi = isMoney2(m.key) ? Math.round((unit * weights[idx]) * 100) / 100 : Math.round(unit * weights[idx]);

        // Ensure minimum target of 1 when store target exists (prevents 0 targets for small numbers)
        if (!isMoney2(m.key) && m.target > 0 && kpi === 0) {
          kpi = 1;
        }

        const repKey = `${currentStore}::${m.key}::${r.i}::mtd`;
        const saved = localStorage.getItem(repKey);

        const metricCache = totalsCache[m.key?.toUpperCase?.() || ""] || {};
        const hasCSVData = Object.keys(metricCache).length > 0;

        let mtdDefault = 0;
        if (metricCache[r.name] != null) {
          mtdDefault = metricCache[r.name];
        } else if (hasCSVData) {
          mtdDefault = 0;
        } else {
          mtdDefault = ((m.mtd || 0) * (weights[idx] / (wSum || 1)));
        }

        const repMTD = saved ? Number(saved) : mtdDefault;
        const repMTDrounded = isMoney2(m.key) ? Math.round(repMTD * 100) / 100 : Math.round(repMTD);

        const pctRaw = kpi > 0 ? ((repMTDrounded / kpi) * 100) : 0;
        const pct = clamp01to100(pctRaw);
        const isOver = repMTDrounded >= kpi;
        const overBy = Math.max(repMTDrounded - kpi, 0);
        const overDisplay = isMoney2(m.key) ? Math.round(overBy * 100) / 100 : Math.ceil(overBy);
        const colorClass = isOver ? "bg-emerald-500" : "bg-slate-500 dark:bg-slate-600";
        const inputValue = isMoney2(m.key) ? repMTDrounded.toFixed(2) : repMTDrounded;

        html += `
           <div>
              <div class="flex items-center justify-between mb-1.5">
                 <span class="text-xs font-bold text-slate-500 uppercase tracking-wide">${m.label}</span>
                 <span class="text-xs font-bold ${isOver ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}">
                    ${isMoney2(m.key) ? money2(repMTDrounded) : repMTDrounded} <span class="text-slate-300 dark:text-slate-600 font-normal">/ ${isMoney2(m.key) ? money2(kpi) : kpi}</span>
                 </span>
              </div>
              <div class="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-2">
                 <div class="h-full ${colorClass} rounded-full transition-all duration-1000" style="width:${pct}%"></div>
              </div>
              ${isOver && overBy > 0 ? `<div class="mb-2"><span class="inline-block px-2 py-0.5 text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full">Over by ${isMoney2(m.key) ? money2(overDisplay) : overDisplay}</span></div>` : ''}
              <div class="flex justify-end">
                 <input class="input-premium py-1 px-2 text-xs text-right w-24 rounded focus:w-full transition-all duration-300" 
                        type="number" 
                        placeholder="Update..."
                        step="${isMoney2(m.key) ? "0.01" : "1"}" 
                        value="${inputValue}" 
                        onchange="localStorage.setItem('${repKey}', String(this.value)); recomputeMetricMTD('${m.key}');">
              </div>
           </div>
         `;
      });

      // Rates List (Integrated)
      const rateKeys = [
        { key: "TREND_AR", label: "Trend AR" },
        { key: "ONE_AR", label: "One Upgrade" },
        { key: "TREND_4_3", label: "Trend 4/3" }
      ];

      if (rateKeys.some(rk => ratesCache[rk.key]?.[r.name] != null)) {
        html += `<div class="pt-4 border-t border-slate-100 dark:border-slate-600/50/50 mt-2"><div class="grid grid-cols-3 gap-2">`;
        rateKeys.forEach(rk => {
          const val = ratesCache[rk.key]?.[r.name] || 0;
          html += `
               <div class="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-700/60">
                  <div class="text-[10px] text-slate-400 font-bold uppercase mb-1">${rk.label}</div>
                  <div class="text-sm font-bold text-slate-700 dark:text-slate-200">${fmtPct2(val)}</div>
               </div>
             `;
        });
        html += `</div></div>`;
      }

      html += `</div>`; // End body
      card.innerHTML = html;
      holder.appendChild(card);
    });
  }

  function renderLeaderboards() {
    const holder = $("#leaderboards");
    if (!holder) return;
    holder.innerHTML = "";

    const { rosterActive, weights, wSum } = getActiveRosterWithWeights();

    if (!rosterActive.length) {
      holder.innerHTML = '<div class="text-center text-slate-500 py-8">Add staff to the roster to see leaderboards.</div>';
      return;
    }

    // Pre-calc totals
    const totalsCache = JSON.parse(localStorage.getItem(`rep_totals_cache::${currentStore}`) || "{}");

    // Create leaderboard grid with stagger animation
    const leaderboardGrid = document.createElement("div");
    leaderboardGrid.className = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8";

    (storeData.metrics || []).forEach((m, metricIndex) => {
      // Calculate each person's MTD for this metric
      const repData = rosterActive.map((r, idx) => {
        const repKey = `${currentStore}::${m.key}::${r.i}::mtd`;
        const saved = localStorage.getItem(repKey);

        const metricCache = totalsCache[m.key?.toUpperCase?.() || ""] || {};
        const hasCSVData = Object.keys(metricCache).length > 0;

        let mtdDefault = 0;
        if (metricCache[r.name] != null) {
          mtdDefault = metricCache[r.name];
        } else if (hasCSVData) {
          mtdDefault = 0;
        } else {
          mtdDefault = ((m.mtd || 0) * (weights[idx] / (wSum || 1)));
        }

        const repMTD = saved ? Number(saved) : mtdDefault;
        const repMTDrounded = isMoney2(m.key) ? Math.round(repMTD * 100) / 100 : Math.round(repMTD);

        return {
          name: r.name,
          mtd: repMTDrounded,
          type: r.type,
          hours: r.hours
        };
      });

      // Sort by MTD descending
      repData.sort((a, b) => b.mtd - a.mtd);

      // Skip this leaderboard if no one has any progress (all zeros)
      const hasProgress = repData.some(rep => rep.mtd > 0);

      // Create leaderboard card with entrance animation
      const card = document.createElement("div");
      const animDelay = metricIndex * 50; // Stagger animation
      card.style.animationDelay = `${animDelay}ms`;
      card.className = "relative overflow-hidden rounded-3xl border-2 border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-br from-white via-slate-50/50 to-white dark:from-slate-800 dark:via-slate-800/80 dark:to-slate-900 backdrop-blur-xl shadow-xl hover:shadow-2xl hover:scale-[1.02] transition-all duration-500 ease-out opacity-0 animate-[slideUp_0.6s_cubic-bezier(0.16,1,0.3,1)_forwards]";

      // Determine if this metric has a clear winner (significant lead)
      const hasWinner = repData.length > 1 && repData[0].mtd > repData[1].mtd * 1.2;
      const winnerGlow = hasWinner ? 'after:absolute after:inset-0 after:bg-gradient-to-br after:from-amber-400/10 after:to-transparent after:pointer-events-none after:rounded-3xl' : '';

      let html = `
        <div class="relative ${winnerGlow}">
          <div class="p-7">
            <div class="flex items-center justify-between mb-7">
              <h3 class="text-xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">${m.label}</h3>
              <div class="text-xs font-bold text-slate-500 dark:text-slate-400 bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-700 dark:to-slate-800 px-4 py-2 rounded-full shadow-inner border border-slate-200/50 dark:border-slate-600/50">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-1.5 text-amber-500">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
                </svg>
                TOP 5
              </div>
            </div>
      `;

      if (!hasProgress) {
        // Show "No progress yet" message when everyone has 0
        html += `
            <div class="flex flex-col items-center justify-center py-12 text-center">
              <div class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-slate-400">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <p class="text-sm font-semibold text-slate-500 dark:text-slate-400">No progress yet</p>
              <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">Start tracking ${m.label} to see rankings</p>
            </div>
        `;
      } else {
        // Show leaderboard with top performers
        html += `<div class="space-y-2.5">`;

        // Show top 5 performers
        const topPerformers = repData.slice(0, Math.min(5, repData.length));

        topPerformers.forEach((rep, index) => {
          const isMoney = isMoney2(m.key);
          const displayValue = isMoney ? money2(rep.mtd) : rep.mtd.toLocaleString();

          // Medal colors, icons, and effects
          let medalIcon = "";
          let rankBg = "bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800";
          let rankText = "text-slate-700 dark:text-slate-300";
          let rowBg = "bg-white/70 dark:bg-slate-700/30";
          let glowEffect = "";
          let valueColor = "text-slate-800 dark:text-slate-200";

          if (index === 0) {
            medalIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="text-white drop-shadow-lg"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>';
            rankBg = "bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 shadow-lg shadow-amber-500/50";
            rankText = "text-white";
            rowBg = "bg-gradient-to-r from-amber-50/80 via-white/70 to-white/70 dark:from-amber-900/20 dark:via-slate-700/40 dark:to-slate-700/30";
            glowEffect = "ring-2 ring-amber-400/30 dark:ring-amber-500/30";
            valueColor = "text-amber-700 dark:text-amber-400";
          } else if (index === 1) {
            medalIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="text-white drop-shadow-md"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>';
            rankBg = "bg-gradient-to-br from-slate-300 via-slate-400 to-slate-500 shadow-md shadow-slate-400/40";
            rankText = "text-white";
            rowBg = "bg-gradient-to-r from-slate-100/80 via-white/70 to-white/70 dark:from-slate-600/20 dark:via-slate-700/40 dark:to-slate-700/30";
            valueColor = "text-slate-700 dark:text-slate-300";
          } else if (index === 2) {
            medalIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="text-white drop-shadow-md"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>';
            rankBg = "bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 shadow-md shadow-orange-400/40";
            rankText = "text-white";
            rowBg = "bg-gradient-to-r from-orange-50/80 via-white/70 to-white/70 dark:from-orange-900/20 dark:via-slate-700/40 dark:to-slate-700/30";
            valueColor = "text-orange-700 dark:text-orange-400";
          }

          const scaleEffect = index === 0 ? "scale-[1.03]" : "";
          const hoverScale = index === 0 ? "hover:scale-[1.05]" : "hover:scale-[1.02]";

          html += `
            <div class="flex items-center gap-4 p-4 rounded-2xl ${rowBg} border border-slate-200/40 dark:border-slate-600/30 ${glowEffect} hover:border-emerald-400/60 dark:hover:border-emerald-500/50 transition-all duration-500 ease-out group ${scaleEffect} ${hoverScale} backdrop-blur-sm" style="animation-delay: ${(index + 1) * 50}ms">
              <div class="flex-shrink-0 w-12 h-12 ${rankBg} rounded-2xl flex items-center justify-center font-black text-base shadow-lg transform group-hover:rotate-6 transition-transform duration-300 ${rankText}">
                ${index < 3 ? medalIcon : `<span class="text-lg">${index + 1}</span>`}
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-bold text-base text-slate-900 dark:text-white truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors duration-300">${rep.name}</div>
                <div class="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">${rep.type} · ${rep.hours}h/wk</div>
              </div>
              <div class="flex-shrink-0 text-right">
                <div class="font-black text-xl ${valueColor} tabular-nums tracking-tight">${displayValue}</div>
              </div>
            </div>
          `;
        });

        html += `</div>`;
      }

      html += `
            </div>
          </div>
        </div>
      `;

      card.innerHTML = html;
      leaderboardGrid.appendChild(card);
    });

    holder.appendChild(leaderboardGrid);
  }

  /* Master render */
  function renderAll() {
    renderMetricsList();
    renderRoster();
    renderKPIs()
  }

  /* Start & Setup flow */
  function openStart() {
    const el = document.getElementById('startBackdrop');
    if (el) el.classList.add('show');
  }

  function closeStart() {
    const el = document.getElementById('startBackdrop');
    if (el) el.classList.remove('show');
  }

  function openSetup() {
    const n = $("#setupStoreName");
    if (n) n.textContent = currentStore || "";
    const l = $("#setupLog");
    if (l) l.textContent = "";
    document.getElementById('setupBackdrop').classList.add('show');
    $("#setupStep1").style.display = "block";
    $("#setupStep2").style.display = "none";
    $("#setupNext").disabled = true;
    setupNames = []
  }

  function toStep2() {
    $("#setupStep1").style.display = "none";
    $("#setupStep2").style.display = "block"
  }

  function backToStep1() {
    $("#setupStep2").style.display = "none";
    $("#setupStep1").style.display = "block"
  }

  function closeSetup() {
    document.getElementById('setupBackdrop').classList.remove('show')
  }
  window.closeSetup = closeSetup;

  function loadStore(s) {
    currentStore = s;
    storeData = ensureStoreRecord(s);

    const title = $("#title"); // Beware: index.html header uses h1 but maybe no ID. Targets.html used id="title"
    if (title) title.textContent = `Store Targets — ${s}`;
    const ss = $("#storeSelect");
    if (ss) ss.value = s;
    autoSetDatesIfEmpty();
    applyDatesToStore();
    const cs = $("#csvStatus");
    if (cs) cs.textContent = storeData.csvImported ? "Imported" : "Not imported yet";
    renderAll();
    if (needSetup(storeData)) openSetup()
  }

  window.loadStore = loadStore;

  /* Wire up */
  // We need to wait for DOM to be ready, but this script is likely deferred or at end of body.
  // We will attach listeners if elements exist.

  function initTargets() {
    const startGo = document.getElementById("startGo");
    if (startGo) {
      startGo.addEventListener("click", () => {
        const v = $("#startStore").value; if (!v) return; closeStart(); loadStore(v)
      });
    }

    const startStore = document.getElementById("startStore");
    if (startStore) {
      startStore.addEventListener("change", e => {
        const btn = document.getElementById("startGo");
        if (btn) btn.disabled = !e.target.value
      });
    }

    const storeSelect = document.getElementById("storeSelect");
    if (storeSelect) {
      storeSelect.addEventListener("change", e => {
        if (e.target.value) loadStore(e.target.value)
      });
    }

    const csvFiles = document.getElementById("csvFiles");
    if (csvFiles) {
      csvFiles.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        const logEl = document.getElementById("importLog");

        if (!files.length) {
          if (logEl) logEl.textContent = "No files selected."; return
        }

        if (logEl) logEl.textContent = `Importing ${files.length} file(s)…`;

        try {
          await handleCSVImport(files, {
            logEl
          })
        } catch (err) {
          if (logEl) logEl.textContent = `Import failed: ${err.message || err}`; console.error(err)
        }

        e.target.value = "";
      });
    }

    const setupCsvFiles = document.getElementById("setupCsvFiles");
    if (setupCsvFiles) {
      setupCsvFiles.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        const logEl = document.getElementById("setupLog");
        const nextBtn = document.getElementById("setupNext");

        if (!files.length) {
          if (logEl) logEl.textContent = "No files selected."; return
        }
        if (logEl) logEl.textContent = `Importing ${files.length} file(s)…`;

        try {
          await handleCSVImport(files, {
            logEl, nextBtn, collectNames: true
          })
        } catch (err) {
          if (logEl) logEl.textContent = `Import failed: ${err.message || err}`; console.error(err)
        }

        e.target.value = "";
      });
    }

    const sn = document.getElementById("setupNext"); if (sn) sn.addEventListener("click", toStep2);
    const sb = document.getElementById("setupBack"); if (sb) sb.addEventListener("click", backToStep1);

    const sd = document.getElementById("setupDone");
    if (sd) {
      sd.addEventListener("click", () => {
        const checks = [...document.querySelectorAll(".cr-check")];
        const types = [...document.querySelectorAll(".cr-type")];
        const hours = [...document.querySelectorAll(".cr-hours")];
        const mapType = Object.fromEntries(types.map(s => [s.dataset.name, s.value]));
        const mapHours = Object.fromEntries(hours.map(s => [s.dataset.name, Math.max(1, Math.min(80, Math.round(Number(s.value) || 40)))]));
        const roster = checks.filter(c => c.checked).map(c => ({
          name: c.dataset.name, type: mapType[c.dataset.name] || "FT", hours: mapHours[c.dataset.name] || 40, active: true
        }));
        storeData.roster = roster; saveStore(); renderAll(); closeSetup()
      });
    }

    const mp = document.getElementById("monthPicker");
    if (mp) {
      mp.addEventListener("input", e => {
        if (!storeData) return; storeData.month = e.target.value; saveStore(); renderKPIs()
      });
    }

    const tp = document.getElementById("todayPicker");
    if (tp) {
      tp.addEventListener("input", e => {
        if (!storeData) return; storeData.today = e.target.value; saveStore(); renderKPIs()
      });
    }

    // Initial load logic
    // In index.html, this functionality is hidden by default. 
    // We should probably NOT trigger openStart() immediately unless this tab is active.
    // However, Targets.html logic was: window.addEventListener("load", openStart);
    // tailored for standalone.

    // We can leave it for the user to select the tab, then maybe we trigger it?
    // Or just run it once.

    autoSetDatesIfEmpty();
  }

  // Hook into our custom event or general load
  window.addEventListener("load", initTargets);
  // Also hook into tab show if possible, or just let init run once.
})();

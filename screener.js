/**
 * EMA Strong Bullish Screener
 * Finds NSE stocks where:
 *   1. EMA5 crossed ABOVE EMA13  within the last 30 trading days
 *   2. EMA5 crossed ABOVE EMA26  within the last 30 trading days
 *   3. EMA5 is still above EMA13 today (not reversed)
 *
 * Click any result → navigates to analysis.html?sym=...&name=...&sector=...
 */
"use strict";

// ─────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────
const CONFIG = {
  ema1: 5, ema2: 13, ema3: 26,
  corsProxy: "https://api.allorigins.win/raw?url=",
  yahooBase:  "https://query1.finance.yahoo.com/v8/finance/chart/",
  period:    "2y",
  interval:  "1d",
  scanBars:  10,        // look-back window for EMA5×EMA13 crossover
  batchSize: 5,         // parallel fetches
};

// ─────────────────────────────────────────────────────
// CACHE  (localStorage — avoids re-fetching on reload)
// ─────────────────────────────────────────────────────
const CACHE_KEY = "ema_sb_cache_v3";      // bump version to bust stale cache
const CACHE_TTL = 6 * 60 * 60 * 1000;   // 6 hours in ms

// ─────────────────────────────────────────────────────
// NSE STOCK UNIVERSE
// ─────────────────────────────────────────────────────
const NSE_STOCKS = [
  { sym:"RELIANCE.NS",   name:"Reliance Industries",       sector:"Energy"  },
  { sym:"TCS.NS",        name:"Tata Consultancy Services", sector:"IT"      },
  { sym:"HDFCBANK.NS",   name:"HDFC Bank",                 sector:"Bank"    },
  { sym:"INFY.NS",       name:"Infosys",                   sector:"IT"      },
  { sym:"ICICIBANK.NS",  name:"ICICI Bank",                sector:"Bank"    },
  { sym:"HINDUNILVR.NS", name:"Hindustan Unilever",        sector:"FMCG"    },
  { sym:"SBIN.NS",       name:"State Bank of India",       sector:"Bank"    },
  { sym:"BAJFINANCE.NS", name:"Bajaj Finance",             sector:"Bank"    },
  { sym:"BHARTIARTL.NS", name:"Bharti Airtel",             sector:"IT"      },
  { sym:"KOTAKBANK.NS",  name:"Kotak Mahindra Bank",       sector:"Bank"    },
  { sym:"WIPRO.NS",      name:"Wipro",                     sector:"IT"      },
  { sym:"LTIM.NS",       name:"LTIMindtree",               sector:"IT"      },
  { sym:"HCLTECH.NS",    name:"HCL Technologies",          sector:"IT"      },
  { sym:"ASIANPAINT.NS", name:"Asian Paints",              sector:"FMCG"    },
  { sym:"AXISBANK.NS",   name:"Axis Bank",                 sector:"Bank"    },
  { sym:"MARUTI.NS",     name:"Maruti Suzuki",             sector:"Auto"    },
  { sym:"SUNPHARMA.NS",  name:"Sun Pharmaceutical",        sector:"Pharma"  },
  { sym:"TATAMOTORS.NS", name:"Tata Motors",               sector:"Auto"    },
  { sym:"NESTLEIND.NS",  name:"Nestle India",              sector:"FMCG"    },
  { sym:"ULTRACEMCO.NS", name:"UltraTech Cement",          sector:"Metal"   },
  { sym:"POWERGRID.NS",  name:"Power Grid Corporation",    sector:"Energy"  },
  { sym:"NTPC.NS",       name:"NTPC Limited",              sector:"Energy"  },
  { sym:"ONGC.NS",       name:"Oil & Natural Gas Corp",    sector:"Energy"  },
  { sym:"COALINDIA.NS",  name:"Coal India",                sector:"Metal"   },
  { sym:"TATASTEEL.NS",  name:"Tata Steel",                sector:"Metal"   },
  { sym:"JSWSTEEL.NS",   name:"JSW Steel",                 sector:"Metal"   },
  { sym:"HINDALCO.NS",   name:"Hindalco Industries",       sector:"Metal"   },
  { sym:"M_M.NS",        name:"Mahindra & Mahindra",       sector:"Auto"    },
  { sym:"BAJAJ-AUTO.NS", name:"Bajaj Auto",                sector:"Auto"    },
  { sym:"HEROMOTOCO.NS", name:"Hero MotoCorp",             sector:"Auto"    },
  { sym:"DRREDDY.NS",    name:"Dr. Reddy's Laboratories",  sector:"Pharma"  },
  { sym:"CIPLA.NS",      name:"Cipla",                     sector:"Pharma"  },
  { sym:"DIVISLAB.NS",   name:"Divi's Laboratories",       sector:"Pharma"  },
  { sym:"APOLLOHOSP.NS", name:"Apollo Hospitals",          sector:"Pharma"  },
  { sym:"BRITANNIA.NS",  name:"Britannia Industries",      sector:"FMCG"    },
  { sym:"MARICO.NS",     name:"Marico",                    sector:"FMCG"    },
  { sym:"DABUR.NS",      name:"Dabur India",               sector:"FMCG"    },
  { sym:"ITC.NS",        name:"ITC Limited",               sector:"FMCG"    },
  { sym:"ADANIPORTS.NS", name:"Adani Ports & SEZ",         sector:"Energy"  },
  { sym:"ADANIGREEN.NS", name:"Adani Green Energy",        sector:"Energy"  },
  { sym:"TATAPOWER.NS",  name:"Tata Power",                sector:"Energy"  },
  { sym:"INDIGO.NS",     name:"IndiGo (InterGlobe)",       sector:"Auto"    },
  { sym:"BPCL.NS",       name:"BPCL",                      sector:"Energy"  },
  { sym:"IOC.NS",        name:"Indian Oil Corporation",    sector:"Energy"  },
  { sym:"GAIL.NS",       name:"GAIL (India)",              sector:"Energy"  },
  { sym:"TECHM.NS",      name:"Tech Mahindra",             sector:"IT"      },
  { sym:"MPHASIS.NS",    name:"Mphasis",                   sector:"IT"      },
  { sym:"PERSISTENT.NS", name:"Persistent Systems",        sector:"IT"      },
  { sym:"COFORGE.NS",    name:"Coforge",                   sector:"IT"      },
  { sym:"LT.NS",         name:"Larsen & Toubro",           sector:"Metal"   },
  { sym:"BANKBARODA.NS", name:"Bank of Baroda",            sector:"Bank"    },
];

// ─────────────────────────────────────────────────────
// APPLICATION STATE
// ─────────────────────────────────────────────────────
let state = {
  sector:     "all",
  search:     "",
  results:    [],
  allResults: [],
  sortCol:    "cross13Days",
  sortDir:    1,          // ascending = most recent cross first
  running:    false,
};

// ─────────────────────────────────────────────────────
// EMA CALCULATION  (identical to TradingView ta.ema)
// alpha = 2 / (length + 1)
// ─────────────────────────────────────────────────────
function calcEMA(closes, length) {
  if (closes.length < length) return [];
  const alpha = 2 / (length + 1);
  const emas  = new Array(closes.length).fill(null);
  let   seed  = 0;
  for (let i = 0; i < length; i++) seed += closes[i];
  emas[length - 1] = seed / length;
  for (let i = length; i < closes.length; i++) {
    emas[i] = alpha * closes[i] + (1 - alpha) * emas[i - 1];
  }
  return emas;
}

function computeEMAs(closes) {
  const e5  = calcEMA(closes, CONFIG.ema1);
  const e13 = calcEMA(closes, CONFIG.ema2);
  const e26 = calcEMA(closes, CONFIG.ema3);
  return closes.map((_, i) => ({ e5: e5[i]??null, e13: e13[i]??null, e26: e26[i]??null }));
}

// ─────────────────────────────────────────────────────
// STRONG BULLISH EVALUATOR  — 2-step logic:
//
//  STEP 1: Scan last 30 trading bars for EMA5 crossing ABOVE EMA13
//          (prev.e5 ≤ prev.e13  AND  curr.e5 > curr.e13)
//          Record the most recent such crossover date.
//
//  STEP 2: From that EMA13-cross bar onward, scan forward for NEXT
//          EMA5 crossing ABOVE EMA26
//          (prev.e5 ≤ prev.e26  AND  curr.e5 > curr.e26)
//
//  ALSO:   EMA5 must still be above EMA13 at the latest bar (signal holding)
// ─────────────────────────────────────────────────────
function evaluateStrongBullish(emaSeries, timestamps) {
  const n        = emaSeries.length;
  const startIdx = Math.max(1, n - CONFIG.scanBars); // last 30 bars
  const now      = Date.now();

  // ── STEP 1: Find most recent EMA5 × EMA13 bullish cross ──
  let c13Idx   = null;
  let c13Ts    = null;
  let c13Date  = null;
  let c13Price = null;

  for (let i = startIdx; i < n; i++) {
    const prev = emaSeries[i - 1];
    const curr = emaSeries[i];
    if (!prev || !curr) continue;
    if (prev.e5 === null || prev.e13 === null) continue;
    if (curr.e5 === null || curr.e13 === null) continue;

    if (prev.e5 <= prev.e13 && curr.e5 > curr.e13) {
      // Bullish cross — keep updating so we get the MOST RECENT one
      c13Idx   = i;
      c13Ts    = timestamps[i];
      c13Date  = new Date(c13Ts * 1000);
      c13Price = curr.e5;
    }
  }

  // No EMA5×EMA13 cross found in last 30 bars → skip this stock
  if (c13Idx === null) return null;

  // ── STEP 2: From the cross bar onward, find NEXT EMA5 × EMA26 cross ──
  let c26Ts    = null;
  let c26Date  = null;
  let c26Price = null;

  // ── STEP 2: starting up to 5 bars BEFORE the EMA13 cross, find the
  //   NEXT (first) EMA5 × EMA26 bullish cross from that point onward.
  //
  //   Why 5 bars before? With 1-year EMA data the EMA26 level differs
  //   slightly from a 3-month seed, so the EMA26 cross sometimes lands
  //   1-2 bars before the EMA13 cross. Starting 5 bars back ensures we
  //   never miss it.
  const c26ScanStart = Math.max(1, c13Idx - 5);

  for (let i = c26ScanStart; i < n; i++) {
    const prev = emaSeries[i - 1];
    const curr = emaSeries[i];
    if (!prev || !curr) continue;
    if (prev.e5 === null || prev.e26 === null) continue;
    if (curr.e5 === null || curr.e26 === null) continue;

    if (prev.e5 <= prev.e26 && curr.e5 > curr.e26) {
      // Take the FIRST EMA5×EMA26 cross at or near the EMA13 cross
      c26Ts    = timestamps[i];
      c26Date  = new Date(c26Ts * 1000);
      c26Price = curr.e5;
      break;
    }
  }

  // EMA5×EMA26 cross must also have been found
  if (!c26Date) return null;

  // ── EMA5 must still be above EMA13 today (signal not reversed) ──
  const last = emaSeries[n - 1];
  if (!last || last.e5 === null || last.e13 === null) return null;
  if (last.e5 <= last.e13) return null;

  return {
    cross13Date:  c13Date,
    cross13Price: c13Price,
    cross13Days:  Math.floor((now - c13Ts * 1000) / 86_400_000),
    cross26Date:  c26Date,
    cross26Price: c26Price,
    cross26Days:  Math.floor((now - c26Ts * 1000) / 86_400_000),
    fullyAligned: last.e5 > last.e13 && last.e13 > last.e26,
  };
}

// ─────────────────────────────────────────────────────
// DATA FETCH  (Yahoo Finance via allorigins CORS proxy)
// ─────────────────────────────────────────────────────
async function fetchStockData(symbol) {
  const url     = `${CONFIG.yahooBase}${encodeURIComponent(symbol)}?interval=${CONFIG.interval}&range=${CONFIG.period}`;
  const proxied = `${CONFIG.corsProxy}${encodeURIComponent(url)}`;
  const res     = await fetch(proxied, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data   = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("No data");

  const timestamps = result.timestamp || [];
  const quotes     = result.indicators?.quote?.[0] || {};
  const closes     = quotes.close || [];
  const meta       = result.meta  || {};

  const valid = timestamps
    .map((t, i) => ({ t, c: closes[i] }))
    .filter(d => d.c != null && isFinite(d.c));

  return {
    currentPrice:  meta.regularMarketPrice ?? valid[valid.length-1]?.c ?? 0,
    previousClose: valid[valid.length-2]?.c ?? valid[valid.length-1]?.c ?? 0,
    closes:        valid.map(d => d.c),
    timestamps:    valid.map(d => d.t),
  };
}

// ─────────────────────────────────────────────────────
// MAIN SCREENER
// ─────────────────────────────────────────────────────
async function runScreener() {
  if (state.running) return;
  state.running = true;

  document.getElementById("emptyState").style.display   = "none";
  document.getElementById("resultsPanel").style.display = "none";
  document.getElementById("statsRow").style.display     = "none";
  document.getElementById("loadingState").style.display = "block";
  document.getElementById("btnLoader").style.display    = "block";
  document.querySelector(".btn-text").textContent       = "Scanning…";

  const stepsEl = document.getElementById("loadingSteps");
  stepsEl.innerHTML = "";
  const addStep = txt => {
    const el = document.createElement("div");
    el.className   = "loading-step";
    el.textContent = `▸ ${txt}`;
    stepsEl.appendChild(el);
    stepsEl.scrollTop = stepsEl.scrollHeight;
  };

  let stockList = NSE_STOCKS;
  if (state.sector !== "all") stockList = stockList.filter(s => s.sector === state.sector);

  addStep(`Scanning ${stockList.length} stocks for Double EMA Crossover (last 30 days)…`);
  loadingText("Fetching live data from Yahoo Finance…");

  const matched = [];
  let processed = 0;

  for (let i = 0; i < stockList.length; i += CONFIG.batchSize) {
    const batch       = stockList.slice(i, i + CONFIG.batchSize);
    const batchLabels = batch.map(s => s.sym.replace(".NS","")).join(", ");
    addStep(`[${processed+1}–${Math.min(processed+CONFIG.batchSize, stockList.length)}/${stockList.length}] ${batchLabels}`);

    const batchResults = await Promise.allSettled(
      batch.map(async stock => {
        const raw     = await fetchStockData(stock.sym);
        const emas    = computeEMAs(raw.closes);
        const signal  = evaluateStrongBullish(emas, raw.timestamps);
        if (!signal) return null;

        const last   = emas[emas.length - 1];
        const change = raw.previousClose > 0
          ? ((raw.currentPrice - raw.previousClose) / raw.previousClose) * 100
          : 0;

        return {
          sym:          stock.sym,
          symbol:       stock.sym.replace(".NS",""),
          name:         stock.name,
          sector:       stock.sector,
          price:        raw.currentPrice,
          change,
          ema5:         last.e5,
          ema13:        last.e13,
          ema26:        last.e26,
          cross13Date:  signal.cross13Date,
          cross13Price: signal.cross13Price,
          cross13Days:  signal.cross13Days,
          cross26Date:  signal.cross26Date,
          cross26Price: signal.cross26Price,
          cross26Days:  signal.cross26Days,
          fullyAligned: signal.fullyAligned,
          closes:       raw.closes,
          timestamps:   raw.timestamps,
          emaSeries:    emas,
        };
      })
    );

    batchResults.forEach(r => { if (r.status === "fulfilled" && r.value) matched.push(r.value); });
    processed += batch.length;
    loadingText(`Processed ${processed}/${stockList.length} — ${matched.length} strong bullish found…`);
  }

  state.allResults = matched;
  state.results    = [...matched];
  addStep(`✅ Done! Found ${matched.length} Strong Bullish stocks.`);

  // ── Save to localStorage so next page-open is instant ──
  saveCache(matched, state.sector);

  setTimeout(() => {
    document.getElementById("loadingState").style.display = "none";
    document.getElementById("btnLoader").style.display    = "none";
    document.querySelector(".btn-text").textContent       = "🔥 Find Strong Bullish";
    state.running = false;
    applyFiltersAndRender();
  }, 500);
}

// ─────────────────────────────────────────────────────
// DEBUG HELPER  — open DevTools console and run:
//   debugStock("LT.NS")      ← or any symbol
// to see exactly why a stock passes or fails the filter.
// ─────────────────────────────────────────────────────
window.debugStock = async function(sym = "LT.NS") {
  console.group(`🔍 DEBUG: ${sym}`);
  console.log("Fetching 1-year daily data…");
  let raw;
  try {
    raw = await fetchStockData(sym);
  } catch(e) {
    console.error("❌ fetchStockData FAILED:", e.message);
    console.groupEnd(); return;
  }
  console.log(`✅ Got ${raw.closes.length} bars. Latest close: ₹${raw.currentPrice}`);

  const emas = computeEMAs(raw.closes);
  const n    = emas.length;
  console.log(`EMA series length: ${n}`);

  const SCAN = CONFIG.scanBars;
  const startIdx = Math.max(1, n - SCAN);
  console.log(`Scanning bars [${startIdx} → ${n-1}] (last ${SCAN} bars)`);

  // Print last 5 EMA values
  console.log("Last 5 EMA values:");
  for (let i = Math.max(0, n-5); i < n; i++) {
    const e = emas[i], d = new Date(raw.timestamps[i]*1000).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
    console.log(`  [${i}] ${d}: EMA5=${e.e5?.toFixed(2)} | EMA13=${e.e13?.toFixed(2)} | EMA26=${e.e26?.toFixed(2)}`);
  }

  // Find EMA5×EMA13 cross
  let c13Idx=null, c13Date=null;
  for (let i = startIdx; i < n; i++) {
    const p=emas[i-1], c=emas[i];
    if (!p||!c||p.e5===null||p.e13===null||c.e5===null||c.e13===null) continue;
    if (p.e5 <= p.e13 && c.e5 > c.e13) {
      c13Idx = i; c13Date = new Date(raw.timestamps[i]*1000);
      const d = c13Date.toLocaleDateString("en-IN",{day:"numeric",month:"short"});
      console.log(`⚡ EMA5×EMA13 cross found at bar[${i}] = ${d}  EMA5=${c.e5?.toFixed(2)}, EMA13=${c.e13?.toFixed(2)}`);
    }
  }
  if (c13Idx === null) {
    console.warn(`❌ NO EMA5×EMA13 bullish cross found in last ${SCAN} bars — stock excluded`);
    console.groupEnd(); return;
  }

  // Find EMA5×EMA26 cross
  const c26Start = Math.max(1, c13Idx - 5);
  console.log(`Searching EMA5×EMA26 from bar[${c26Start}] onward (5 before EMA13 cross)…`);
  let c26Date=null, c26Found=false;
  for (let i = c26Start; i < n; i++) {
    const p=emas[i-1], c=emas[i];
    if (!p||!c||p.e5===null||p.e26===null||c.e5===null||c.e26===null) continue;
    const d = new Date(raw.timestamps[i]*1000).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
    if (p.e5 <= p.e26 && c.e5 > c.e26) {
      c26Date = new Date(raw.timestamps[i]*1000);
      console.log(`🔶 EMA5×EMA26 cross found at bar[${i}] = ${d}  EMA5=${c.e5?.toFixed(2)}, EMA26=${c.e26?.toFixed(2)}`);
      c26Found = true; break;
    }
  }
  if (!c26Found) {
    console.warn("❌ NO EMA5×EMA26 bullish cross found after EMA13 cross — stock excluded");
    // Print EMA5 vs EMA26 around the EMA13 cross for diagnosis
    console.log("EMA5 vs EMA26 comparison around EMA13 cross:");
    for (let i = Math.max(1,c13Idx-5); i < Math.min(n, c13Idx+10); i++) {
      const p=emas[i-1],c=emas[i];
      if (!p||!c) continue;
      const d=new Date(raw.timestamps[i]*1000).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
      console.log(`  [${i}] ${d}: prevE5=${p.e5?.toFixed(2)} prevE26=${p.e26?.toFixed(2)} currE5=${c.e5?.toFixed(2)} currE26=${c.e26?.toFixed(2)} → cross=${p.e5<=p.e26&&c.e5>c.e26}`);
    }
    console.groupEnd(); return;
  }

  // EMA5 > EMA13 check
  const last = emas[n-1];
  if (!last || last.e5 <= last.e13) {
    console.warn(`❌ EMA5 (${last?.e5?.toFixed(2)}) ≤ EMA13 (${last?.e13?.toFixed(2)}) today — cross reversed, stock excluded`);
    console.groupEnd(); return;
  }

  console.log(`✅ PASS — ${sym} qualifies as Strong Bullish!`);
  console.log(`   EMA5×EMA13: ${c13Date?.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`);
  console.log(`   EMA5×EMA26: ${c26Date?.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`);
  console.log(`   Current EMA5=${last.e5?.toFixed(2)} EMA13=${last.e13?.toFixed(2)} EMA26=${last.e26?.toFixed(2)}`);
  console.groupEnd();
};


// ─────────────────────────────────────────────────────
// FILTER + SORT + RENDER
// ─────────────────────────────────────────────────────
function applyFiltersAndRender() {
  let results = [...state.allResults];
  const q = state.search.toLowerCase();
  if (q) results = results.filter(r => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));

  results.sort((a, b) => {
    const av = a[state.sortCol] ?? 0;
    const bv = b[state.sortCol] ?? 0;
    if (typeof av === "string") return av.localeCompare(bv) * state.sortDir;
    return (av - bv) * state.sortDir;
  });

  state.results = results;

  if (results.length === 0) {
    document.getElementById("resultsPanel").style.display = "none";
    document.getElementById("statsRow").style.display     = "none";
    document.getElementById("emptyState").style.display   = "block";
    document.querySelector(".empty-state h3").textContent = "No Stocks Found";
    document.querySelector(".empty-state p").innerHTML    =
      "No stocks matched the Double EMA Crossover signal in the last 30 days.<br/>Try selecting a different sector or run again.";
    return;
  }

  renderStats(results);
  renderTable(results);
  document.getElementById("statsRow").style.display     = "flex";
  document.getElementById("resultsPanel").style.display = "block";
  document.getElementById("emptyState").style.display   = "none";
}

function renderStats(results) {
  const fresh   = results.filter(r => r.cross13Days <= 7).length;
  const aligned = results.filter(r => r.fullyAligned).length;
  const sectors = new Set(results.map(r => r.sector)).size;
  animateCounter("statTotal",   results.length);
  animateCounter("statFresh",   fresh);
  animateCounter("statAligned", aligned);
  animateCounter("statSectors", sectors);
}

function renderTable(results) {
  const body = document.getElementById("tableBody");
  document.getElementById("resultCount").textContent  = `${results.length} stocks`;
  document.getElementById("resultsTitle").textContent = `🔥 Strong Bullish — Double EMA Cross (Last 30 Days)`;
  body.innerHTML = "";

  results.forEach((r, i) => {
    const chgClass = r.change >= 0 ? "pos" : "neg";
    const chgSign  = r.change >= 0 ? "+" : "";
    const delay    = Math.min(i * 35, 500);

    // Freshness colouring for "days ago"
    const c13Class = r.cross13Days <= 7  ? "strong" : r.cross13Days <= 14 ? "medium" : "weak";
    const c26Class = r.cross26Days <= 7  ? "strong" : r.cross26Days <= 14 ? "medium" : "weak";

    // Signal badge
    const freshDays = Math.min(r.cross13Days, r.cross26Days);
    const badge = r.fullyAligned
      ? (freshDays <= 5
          ? `<span class="signal-badge strong-bull">🔥 Fresh ${freshDays}d</span>`
          : `<span class="signal-badge strong-bull">🟢 Aligned ${freshDays}d</span>`)
      : `<span class="signal-badge moderate-bull">⚡ Cross ${freshDays}d</span>`;

    // Bookmark state
    const sym = r.sym || (r.symbol + ".NS");
    const alreadyBm = (typeof isBookmarked === "function") ? isBookmarked(sym) : false;
    const bmLabel   = alreadyBm ? "✅ Saved" : "📌";
    const bmCls     = alreadyBm ? "bm-row-btn bookmarked" : "bm-row-btn";

    const tr = document.createElement("tr");
    tr.style.animationDelay = `${delay}ms`;
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td style="color:var(--text-muted);font-size:12px;font-family:var(--mono)">${i+1}</td>
      <td class="td-symbol">${r.symbol}</td>
      <td class="td-name">${r.name}</td>
      <td><span class="td-sector-tag">${r.sector}</span></td>
      <td class="td-price">₹${fmt(r.price)}</td>
      <td class="td-change ${chgClass}">${chgSign}${r.change.toFixed(2)}%</td>
      <td class="td-ema" style="color:var(--green)">₹${fmt(r.ema5)}</td>
      <td class="td-ema" style="color:var(--yellow)">₹${fmt(r.ema13)}</td>
      <td class="td-ema" style="color:var(--purple)">₹${fmt(r.ema26)}</td>
      <td>
        <div class="cross-cell">
          <span class="cross-pill c13">⚡ ${fmtDate(r.cross13Date)}</span>
          <span class="cross-sub td-days ${c13Class}">${r.cross13Days}d ago · ₹${fmt(r.cross13Price)}</span>
        </div>
      </td>
      <td>
        <div class="cross-cell">
          <span class="cross-pill c26">🔶 ${fmtDate(r.cross26Date)}</span>
          <span class="cross-sub td-days ${c26Class}">${r.cross26Days}d ago · ₹${fmt(r.cross26Price)}</span>
        </div>
      </td>
      <td>${badge}</td>
      <td>
        <button class="${bmCls}" id="bmbtn-${r.symbol}" title="${alreadyBm?'Remove bookmark':'Bookmark this stock'}">${bmLabel}</button>
      </td>
    `;

    // Bookmark button click (independent of row click)
    const bmBtn = tr.querySelector(`#bmbtn-${r.symbol}`);
    if (bmBtn && typeof toggleBookmark === "function") {
      bmBtn.addEventListener("click", (e) => {
        toggleBookmark(sym, r, bmBtn, e);
      });
    }

    // Click → save full stock data to sessionStorage then navigate
    tr.addEventListener("click", () => {
      const sym = (r.sym && r.sym.trim() && r.sym !== "undefined" && r.sym !== "null")
        ? r.sym.trim()
        : (r.symbol ? r.symbol.trim() + ".NS" : null);

      if (!sym) {
        alert("Could not determine ticker. Please run a fresh scan.");
        return;
      }

      // Save full stock info to sessionStorage — analysis.html reads this
      try {
        sessionStorage.setItem("ema_selected_stock", JSON.stringify({
          sym,
          symbol:       r.symbol       || sym.replace(".NS",""),
          name:         r.name         || sym.replace(".NS",""),
          sector:       r.sector       || "—",
          price:        r.price        || 0,
          change:       r.change       || 0,
          ema5:         r.ema5,
          ema13:        r.ema13,
          ema26:        r.ema26,
          cross13Date:  r.cross13Date instanceof Date ? r.cross13Date.toISOString() : (r.cross13Date || null),
          cross13Price: r.cross13Price,
          cross13Days:  r.cross13Days,
          cross26Date:  r.cross26Date instanceof Date ? r.cross26Date.toISOString() : (r.cross26Date || null),
          cross26Price: r.cross26Price,
          cross26Days:  r.cross26Days,
          fullyAligned: r.fullyAligned,
        }));
      } catch(e) {
        console.warn("sessionStorage save failed:", e);
      }

      console.log(`📊 Navigating to analysis: ${sym}`);
      window.location.href = `analysis.html?sym=${encodeURIComponent(sym)}`;
    });
    body.appendChild(tr);
  });
}

// ─────────────────────────────────────────────────────
// NAVIGATION TO ANALYSIS PAGE
// ─────────────────────────────────────────────────────
function openAnalysis(stock) {
  // Build the .NS ticker defensively — stock.sym may be undefined
  // if data was loaded from an older cache version.
  const sym = (stock.sym && stock.sym.trim() && stock.sym !== "undefined")
    ? stock.sym
    : (stock.symbol ? stock.symbol.replace(/\.NS$/i, "") + ".NS" : null);

  if (!sym) {
    console.error("openAnalysis: cannot determine ticker symbol", stock);
    return;
  }

  // Pass key metadata in URL so analysis.html can show info instantly
  const p = new URLSearchParams({
    sym,
    name:          stock.name      || sym.replace(".NS", ""),
    sector:        stock.sector    || "—",
    cross13:       stock.cross13Date ? stock.cross13Date.toISOString() : "",
    cross13price:  stock.cross13Price != null ? String(stock.cross13Price) : "",
    cross13days:   stock.cross13Days  != null ? String(stock.cross13Days)  : "",
    cross26:       stock.cross26Date ? stock.cross26Date.toISOString() : "",
    cross26price:  stock.cross26Price != null ? String(stock.cross26Price) : "",
    cross26days:   stock.cross26Days  != null ? String(stock.cross26Days)  : "",
  });

  console.log(`📊 Opening analysis for: ${sym}`);
  window.location.href = `analysis.html?${p.toString()}`;
}

// ─────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return "—";
  return n >= 1000
    ? n.toLocaleString("en-IN", { maximumFractionDigits: 0 })
    : n.toFixed(2);
}

function fmtDate(d) {
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day:"numeric", month:"short" });
}

function animateCounter(id, target) {
  const el    = document.getElementById(id);
  const start = parseInt(el.textContent) || 0;
  const t0    = performance.now();
  const run   = now => {
    const p = Math.min((now - t0) / 600, 1);
    el.textContent = Math.round(start + (target - start) * (1 - Math.pow(1-p, 3)));
    if (p < 1) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

function loadingText(t) { document.getElementById("loadingText").textContent = t; }

function applySectorFilter() {
  state.sector = document.getElementById("sectorFilter").value;
  if (state.allResults.length) applyFiltersAndRender();
}

function filterSearch(val) {
  state.search = val;
  if (state.allResults.length) applyFiltersAndRender();
}

function sortTable(col) {
  if (state.sortCol === col) { state.sortDir *= -1; }
  else { state.sortCol = col; state.sortDir = col === "cross13Days" ? 1 : -1; }
  applyFiltersAndRender();
}

// ─────────────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────────────
function exportCSV() {
  const rows = [["Symbol","Company","Sector","LTP","Change%","EMA5","EMA13","EMA26",
                  "EMA5×EMA13 Date","EMA5×EMA13 Days Ago","EMA5×EMA13 Price",
                  "EMA5×EMA26 Date","EMA5×EMA26 Days Ago","EMA5×EMA26 Price","Fully Aligned"]];
  state.results.forEach(r => rows.push([
    r.symbol, r.name, r.sector,
    r.price.toFixed(2), r.change.toFixed(2),
    (r.ema5||0).toFixed(2), (r.ema13||0).toFixed(2), (r.ema26||0).toFixed(2),
    fmtDate(r.cross13Date), r.cross13Days, (r.cross13Price||0).toFixed(2),
    fmtDate(r.cross26Date), r.cross26Days, (r.cross26Price||0).toFixed(2),
    r.fullyAligned ? "Yes" : "No",
  ]));
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type:"text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `strong_bullish_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────
// LOCAL-STORAGE CACHE
// ─────────────────────────────────────────────────────

/** Serialize results (stripping large arrays) and save to localStorage */
function saveCache(results, sector) {
  try {
    const payload = {
      ts:      Date.now(),
      sector,
      results: results.map(r => ({
        sym:          r.sym,
        symbol:       r.symbol,
        name:         r.name,
        sector:       r.sector,
        price:        r.price,
        change:       r.change,
        ema5:         r.ema5,
        ema13:        r.ema13,
        ema26:        r.ema26,
        cross13Date:  r.cross13Date?.toISOString() ?? null,
        cross13Price: r.cross13Price,
        cross13Days:  r.cross13Days,
        cross26Date:  r.cross26Date?.toISOString() ?? null,
        cross26Price: r.cross26Price,
        cross26Days:  r.cross26Days,
        fullyAligned: r.fullyAligned,
        // NOTE: closes / emaSeries / timestamps NOT stored (too large).
        // The analysis page fetches its own data fresh.
      })),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    console.log(`💾 Cached ${results.length} results (sector: ${sector})`);
  } catch (e) {
    console.warn("Cache save failed:", e);
  }
}

/** Load + validate cache. Returns { results, ts } or null. */
function loadCache(sector) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const payload = JSON.parse(raw);

    // Sector must match current filter
    if (payload.sector !== sector) return null;

    // Must be within TTL
    if (Date.now() - payload.ts > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    // Rehydrate Date objects
    const results = payload.results.map(r => ({
      ...r,
      cross13Date: r.cross13Date ? new Date(r.cross13Date) : null,
      cross26Date: r.cross26Date ? new Date(r.cross26Date) : null,
    }));

    return { results, ts: payload.ts };
  } catch (e) {
    console.warn("Cache load failed:", e);
    return null;
  }
}

/** Remove cache (called by "Refresh Data" button) */
function clearCacheAndRescan() {
  localStorage.removeItem(CACHE_KEY);
  hideCacheBanner();
  runScreener();
}

/** Show a banner telling the user data came from cache */
function showCacheBanner(ts) {
  let banner = document.getElementById("cacheBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "cacheBanner";
    banner.style.cssText = [
      "position:fixed","bottom:24px","right:24px",
      "z-index:999",
      "display:flex","align-items:center","gap:14px",
      "padding:12px 20px",
      "border-radius:12px",
      "background:rgba(6,11,20,0.92)",
      "border:1px solid rgba(0,212,170,0.35)",
      "backdrop-filter:blur(16px)",
      "box-shadow:0 8px 32px rgba(0,0,0,.5)",
      "font-size:13px",
      "color:#8892a4",
      "animation:fadeInUp .4s both",
    ].join(";");
    document.body.appendChild(banner);
  }
  const age   = Math.round((Date.now() - ts) / 60000);  // minutes
  const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age/60)}h ago`;
  banner.innerHTML = `
    <span style="font-size:18px">📦</span>
    <span><strong style="color:#f0f6ff">Loaded from cache</strong> · saved ${ageStr}</span>
    <button onclick="clearCacheAndRescan()"
      style="padding:6px 14px;border-radius:8px;border:1px solid rgba(0,212,170,.4);
             background:rgba(0,212,170,.1);color:#00d4aa;font-size:12px;
             font-weight:700;cursor:pointer;font-family:var(--font);white-space:nowrap;">
      🔄 Refresh Data
    </button>
    <button onclick="hideCacheBanner()"
      style="padding:4px 8px;border:none;background:transparent;color:#4a5568;
             font-size:16px;cursor:pointer;line-height:1;">✕</button>
  `;
}

function hideCacheBanner() {
  const b = document.getElementById("cacheBanner");
  if (b) b.remove();
}

// ─────────────────────────────────────────────────────
// BACKGROUND PARTICLES
// ─────────────────────────────────────────────────────
function initParticles() {
  const container = document.getElementById("bgParticles");
  const colors    = ["#00d4aa","#a855f7","#f6c90e","#3b82f6","#ff6b35"];
  for (let i = 0; i < 20; i++) {
    const p    = document.createElement("div");
    p.className = "particle";
    const sz   = Math.random() * 4 + 2;
    const col  = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText = `width:${sz}px;height:${sz}px;left:${Math.random()*100}%;
      background:${col};box-shadow:0 0 ${sz*3}px ${col};
      animation-duration:${10+Math.random()*20}s;animation-delay:${Math.random()*15}s;`;
    container.appendChild(p);
  }
}

// ─────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initParticles();

  const now = new Date();
  document.getElementById("lastUpdated").textContent =
    `NSE India · ${now.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`;

  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && !state.running) runScreener();
  });

  // ── Try to restore from localStorage cache ──
  const cached = loadCache(state.sector);
  if (cached && cached.results.length > 0) {
    console.log(`📦 Restored ${cached.results.length} results from cache`);
    state.allResults = cached.results;
    state.results    = [...cached.results];
    applyFiltersAndRender();
    showCacheBanner(cached.ts);
  } else {
    console.log("🔥 Strong Bullish EMA Screener — no cache, ready to scan.");
  }
});

/* Остальные вкладки: Новости Форекс, Аналитики, Инвестпакет, Календарь биржи, Усреднение. */
(function (g) {
  'use strict';
  const D = g.DATA, A = g.ANALYSIS, APP = g.APP, L = A.L, fmt = A.fmt, $ = APP.$, $$ = APP.$$, esc = APP.esc;
  const TABS = g.TABS = g.TABS || {};
  const SET = () => g.SETTINGS;
  const pad = n => String(n).padStart(2, '0');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function pollJob(name, onTick) {
    for (;;) { const st = await D.status(); if (!st) return; const j = st.jobs[name]; onTick(j); if (!j.running) return j; await sleep(3000); }
  }

  /* ======================= НОВОСТИ ФОРЕКС ======================= */
  const FX = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD', 'NZDUSD', 'XAUUSD', 'BRENT', 'SPX500', 'NAS100', 'BTCUSD', 'SEDG', 'SPCX', 'TSEM'];
  const FX_NAMES = { XAUUSD: L('Золото', 'Gold'), BRENT: L('Нефть Brent', 'Brent oil'), SPX500: 'S&P 500', NAS100: 'Nasdaq 100', BTCUSD: L('Биткоин', 'Bitcoin') };
  let fxData = null;
  TABS.forex = async () => {
    const sel = $('#fxInstr'); if (!sel.options.length || sel.dataset.lang !== SET().lang) { sel.innerHTML = `<option value="">${L('Все инструменты', 'All instruments')}</option>` + FX.map(x => `<option value="${x}">${x}${FX_NAMES[x] ? ' — ' + FX_NAMES[x] : ''}</option>`).join(''); sel.dataset.lang = SET().lang; }
    if (!fxData && D.server) { try { fxData = await D.api('/api/forex'); } catch (e) { fxData = null; } }
    renderFx();
  };
  function renderFx() {
    const st = $('#forexStatus');
    if (D.server === false) st.textContent = L('Сервер не запущен: сбор новостей работает в terminal_app.py.', 'Server not running: news collection works in terminal_app.py.');
    if (!fxData || !fxData.news || !fxData.news.length) { $('#fxNews').innerHTML = `<div class="muted">${L('Новостей нет. Нажмите «Собрать новости».', 'No news. Press "Collect news".')}</div>`; $('#fxSummary').innerHTML = ''; renderFxCal([]); return; }
    st.textContent = `${L('Собрано', 'Collected')}: ${D.fmtDT(fxData.updated)} · ${fxData.claude ? L('оценка Claude', 'rated by Claude') : L('оценка по словарю (без Claude)', 'keyword rating (no Claude)')}`;
    const ins = $('#fxInstr').value, minI = +$('#fxImpact').value, dir = $('#fxDir').value;
    const sum = {}; FX.forEach(x => sum[x] = 0); fxData.news.forEach(n => Object.entries(n.impact || {}).forEach(([k, v]) => { if (sum[k] != null) sum[k] += v; }));
    $('#fxSummary').innerHTML = FX.map(x => `<span class="chip">${x} <b class="${sum[x] > 0 ? 'up' : sum[x] < 0 ? 'down' : 'muted'}">${sum[x] > 0 ? '+' : ''}${sum[x]}</b></span>`).join('');
    const list = fxData.news.filter(n => { const imp = n.impact || {}; const vals = ins ? [imp[ins] || 0] : Object.values(imp); if (ins && !imp[ins]) return false; if (minI && !vals.some(v => Math.abs(v) >= minI)) return false; if (dir && !vals.some(v => Math.sign(v) === +dir)) return false; return true; });
    $('#fxNews').innerHTML = list.map(n => `<div class="news-item">${'★'.repeat(n.importance || 1)} ${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)}
      <div>${Object.entries(n.impact || {}).map(([k, v]) => `<span class="pill ${v > 0 ? 'p' : v < 0 ? 'n' : 'z'}">${k} ${v > 0 ? '+' : ''}${v}</span>`).join('')}</div>
      <div class="meta">${esc(n.publisher || '')} · ${D.fmtDT(n.time)}${n.why ? ' · ' + esc(n.why) : ''}</div></div>`).join('') || `<div class="muted">${L('По фильтрам ничего нет', 'Nothing matches the filters')}</div>`;
    renderFxCal(fxData.calendar || []);
  }
  function renderFxCal(cal) {
    const auto = TABS.macroUpcoming(7).map(m => ({ date: D.fmtDate(m.t), time: D.fmtTime(m.t), event: m.title, importance: m.imp, above: m.above, below: m.below }));
    const rows = (cal.length ? cal.map(c => ({ ...c, time: c.time || '' })) : auto);
    $('#fxCal').innerHTML = `<div class="tablewrap"><table class="tbl"><tr><th>${L('Дата', 'Date')}</th><th>${L('Время', 'Time')}</th><th class="l">${L('Событие', 'Event')}</th><th>${L('Важн.', 'Imp.')}</th><th class="l">${L('Выше прогноза', 'Above forecast')}</th><th class="l">${L('Ниже прогноза', 'Below forecast')}</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td class="l">${esc(r.event)}</td><td>${'★'.repeat(r.importance || 1)}</td><td class="l small">${esc(r.above || '')}</td><td class="l small">${esc(r.below || '')}</td></tr>`).join('')}</table></div>
      <div class="small muted">${cal.length ? L('Календарь составлен Claude по свежим новостям.', 'Calendar compiled by Claude from fresh news.') : L('Встроенный календарь США (даты ориентировочные; время — ваш пояс).', 'Built-in US calendar (approximate dates; your time zone).')}</div>`;
  }
  function initFx() {
    ['#fxInstr', '#fxImpact', '#fxDir'].forEach(s => $(s).addEventListener('change', renderFx));
    $('#btnForex').onclick = async () => {
      if (!D.server) { APP.toast(L('Запустите terminal_app.py', 'Run terminal_app.py')); return; }
      await D.api('/api/forex/collect', { body: {} });
      const j = await pollJob('forex', j => { $('#forexStatus').textContent = `${L('Сбор', 'Collecting')}: ${j.done}/${j.total} ${j.message || ''}${j.done >= j.total && j.running ? L(' · оценка влияния…', ' · rating impact…') : ''}`; });
      fxData = await D.api('/api/forex'); renderFx();
      if (j && j.errors.length) APP.toast(j.errors.slice(0, 3).join('; '), 8000);
    };
    $('#btnFxOwn').onclick = async () => {
      const t = $('#fxOwn').value.trim(); if (!t) return; $('#fxOwnRes').textContent = L('Claude анализирует…', 'Claude is analysing…');
      try {
        const txt = await APP.claude(`Ты — трейдер с 30-летним стажем. Оцени влияние новости на инструменты ${FX.join(', ')} по шкале -3..+3 (только ненулевые) и объясни на ${SET().lang === 'en' ? 'английском' : 'русском'} в 2–3 предложениях. Формат: сначала строка JSON {"EURUSD":1,...}, затем пояснение.\nНовость: ${t}`, 1500);
        const m = txt.match(/\{[\s\S]*?\}/); let imp = {}; try { imp = m ? JSON.parse(m[0]) : {}; } catch (e) { imp = {}; }
        $('#fxOwnRes').innerHTML = `<div>${Object.entries(imp).map(([k, v]) => `<span class="pill ${v > 0 ? 'p' : 'n'}">${esc(k)} ${v > 0 ? '+' : ''}${esc(v)}</span>`).join('')}</div><p>${esc(m ? txt.replace(m[0], '').trim() : txt)}</p>`;
      } catch (e) { $('#fxOwnRes').textContent = e.message; }
    };
  }

  /* ======================= АНАЛИТИКИ ======================= */
  let anData = null, anSort = { k: 'upside', d: -1 };
  async function loadAnalysts() {
    if (D.server) { try { const r = await D.api('/api/analysts'); if (r.items && r.items.length) return r; } catch (e) { /* нет */ } }
    // запасной вариант: из загруженных данных по тикерам (демо или кеш)
    const items = [];
    for (const s of D.ANALYST) {
      const d = await D.load(s), f = d.fundamentals || {}, price = (d.quote && d.quote.price) || d.frames['1D'].slice(-1)[0].c;
      items.push({ symbol: s, name: d.name, price, recKey: f.recommendationKey, recMean: f.recommendationMean, count: f.numberOfAnalystOpinions, targetMean: f.targetMeanPrice, targetMedian: f.targetMedianPrice, targetLow: f.targetLowPrice, targetHigh: f.targetHighPrice, sector: f.sector, actions: [] });
    }
    return { items, updated: Math.floor(Date.now() / 1000), fallback: true };
  }
  const REC = { strong_buy: ['Активно покупать', 'Strong buy'], buy: ['Покупать', 'Buy'], hold: ['Держать', 'Hold'], underperform: ['Хуже рынка', 'Underperform'], sell: ['Продавать', 'Sell'], strong_sell: ['Активно продавать', 'Strong sell'] };
  TABS.analysts = async () => { if (!anData) { $('#anTable').innerHTML = `<tr><td>${L('Загрузка…', 'Loading…')}</td></tr>`; anData = await loadAnalysts(); } renderAnalysts(); };
  function renderAnalysts() {
    const fav = $('#anFav').checked, favs = SET().favorites;
    const rows = anData.items.filter(x => !fav || favs.includes(x.symbol)).map(x => {
      const cnt = k => (x.actions || []).filter(a => (a.action || '').toLowerCase() === k).length;
      const pt = (x.actions || []).filter(a => a.pt && a.ptPrior && a.pt !== a.ptPrior);
      const tgt = x.targetMedian || x.targetMean;
      return { ...x, upside: x.price && tgt ? (tgt / x.price - 1) * 100 : null, up: cnt('up'), down: cnt('down'), init: cnt('init'), ptCh: pt.length, ptUp: pt.filter(a => a.pt > a.ptPrior).length };
    });
    rows.sort((a, b) => { const va = a[anSort.k], vb = b[anSort.k]; if (va == null) return 1; if (vb == null) return -1; return (va > vb ? 1 : va < vb ? -1 : 0) * anSort.d; });
    const H = [['symbol', L('Тикер', 'Ticker')], ['price', L('Цена', 'Price')], ['recMean', L('Консенсус', 'Consensus')], ['count', L('Аналит.', 'Analysts')], ['targetMedian', L('Медиана', 'Median')], ['targetLow', L('Мин.', 'Low')], ['targetHigh', L('Макс.', 'High')], ['upside', L('Потенциал', 'Upside')], ['up', '↑'], ['down', '↓'], ['init', L('Нач.', 'Init')], ['ptCh', L('Цели ±', 'PT ±')], ['view', L('Оптимисты / пессимисты', 'Bulls / bears')]];
    $('#anTable').innerHTML = `<tr>${H.map(([k, n]) => `<th data-k="${k}" class="${k === 'view' ? 'l' : ''}">${n}${anSort.k === k ? (anSort.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr>` + rows.map(r => {
      const rk = REC[(r.recKey || '').toLowerCase()];
      const bull = r.targetHigh && r.price ? `${L('опт.', 'bull')} ${fmt(r.targetHigh)} (+${fmt((r.targetHigh / r.price - 1) * 100, 0)}%)` : '';
      const bear = r.targetLow && r.price ? `${L('песс.', 'bear')} ${fmt(r.targetLow)} (${fmt((r.targetLow / r.price - 1) * 100, 0)}%)` : '';
      return `<tr><td><a href="#" data-open="${r.symbol}"><b>${r.symbol}</b></a> ${SET().favorites.includes(r.symbol) ? '★' : ''}</td><td>${fmt(r.price)}</td><td>${rk ? L(rk[0], rk[1]) : '—'} ${r.recMean ? '(' + fmt(r.recMean, 1) + ')' : ''}</td><td>${fmt(r.count, 0)}</td>
        <td>${fmt(r.targetMedian)}</td><td>${fmt(r.targetLow)}</td><td>${fmt(r.targetHigh)}</td><td class="${(r.upside || 0) >= 0 ? 'up' : 'down'}">${r.upside != null ? (r.upside >= 0 ? '+' : '') + fmt(r.upside, 1) + '%' : '—'}</td>
        <td class="up">${r.up || ''}</td><td class="down">${r.down || ''}</td><td>${r.init || ''}</td><td>${r.ptCh ? r.ptUp + '↑ ' + (r.ptCh - r.ptUp) + '↓' : ''}</td><td class="l small">${bull}${bull && bear ? ' · ' : ''}${bear}</td></tr>`;
    }).join('');
    $('#anStatus').textContent = (anData.fallback ? L('Данные из карточек тикеров (нажмите «Собрать» для рейтингов банков). ', 'From ticker data (press Collect for bank ratings). ') : '') + L('Обновлено: ', 'Updated: ') + D.fmtDT(anData.updated);
    const acts = anData.items.flatMap(x => (x.actions || []).map(a => ({ ...a, symbol: x.symbol }))).sort((a, b) => b.time - a.time);
    const AN = { up: L('Повышение', 'Upgrade'), down: L('Понижение', 'Downgrade'), init: L('Начало покрытия', 'Initiated'), main: L('Подтверждение', 'Maintained'), reit: L('Подтверждение', 'Reiterated') };
    $('#anActions').innerHTML = acts.length ? `<div class="tablewrap"><table class="tbl"><tr><th>${L('Дата', 'Date')}</th><th>${L('Тикер', 'Ticker')}</th><th class="l">${L('Банк', 'Firm')}</th><th>${L('Действие', 'Action')}</th><th class="l">${L('Рейтинг', 'Rating')}</th><th>${L('Цель', 'Target')}</th></tr>
      ${acts.slice(0, 200).map(a => `<tr><td>${D.fmtDate(a.time)}</td><td>${a.symbol}</td><td class="l">${esc(a.firm)}</td><td class="${a.action === 'up' ? 'up' : a.action === 'down' ? 'down' : ''}">${AN[a.action] || esc(a.action)}</td><td class="l">${esc(a.from ? a.from + ' → ' : '')}${esc(a.to)}</td><td>${a.pt ? (a.ptPrior ? fmt(a.ptPrior) + ' → ' : '') + fmt(a.pt) : ''}</td></tr>`).join('')}</table></div>`
      : `<div class="muted">${L('Нет данных о действиях банков. Нажмите «Собрать» (нужен terminal_app.py).', 'No bank actions. Press Collect (needs terminal_app.py).')}</div>`;
  }
  function initAnalysts() {
    $('#anTable').addEventListener('click', e => { const th = e.target.closest('th[data-k]'); if (!th || th.dataset.k === 'view') return; anSort = { k: th.dataset.k, d: anSort.k === th.dataset.k ? -anSort.d : -1 }; renderAnalysts(); });
    $('#anFav').onchange = renderAnalysts;
    $('#btnAnalysts').onclick = async () => {
      if (!D.server) { APP.toast(L('Запустите terminal_app.py', 'Run terminal_app.py')); return; }
      await D.api('/api/analysts/collect', { body: {} });
      await pollJob('analysts', j => { $('#anStatus').textContent = `${L('Сбор', 'Collecting')}: ${j.done}/${j.total} ${j.message || ''}`; });
      anData = await loadAnalysts(); renderAnalysts();
    };
  }

  /* ======================= ИНВЕСТПАКЕТ ======================= */
  let ipManual = APP.store.get('ipManual', null); // { include: {sym:true/false}, extra: [] }
  async function ipCandidates() {
    const an = anData || (anData = await loadAnalysts());
    const map = Object.fromEntries(an.items.map(x => [x.symbol, x]));
    const out = [];
    const syms = D.ANALYST.concat(((ipManual && ipManual.extra) || []).filter(s => !D.ANALYST.includes(s)));
    for (const s of syms) {
      const info = await APP.dailyInfo(s).catch(() => null); if (!info) continue;
      const a = map[s] || {}, f = info.data.fundamentals || {}, price = info.price;
      const tgt = a.targetMedian || a.targetMean || f.targetMedianPrice || f.targetMeanPrice;
      const upside = tgt ? tgt / price - 1 : 0, rec = (a.recKey || f.recommendationKey || '').toLowerCase();
      const recB = { strong_buy: 0.12, buy: 0.06, hold: 0, underperform: -0.08, sell: -0.12 }[rec] || 0;
      const score = 0.55 * Math.max(-0.3, Math.min(0.6, upside)) / 0.6 + 0.35 * info.ev.total / 100 + recB;
      out.push({ sym: s, price, upside, rec, score, signal: info.ev.signal, sector: a.sector || f.sector || D.SECTORS[s] || '—' });
      await sleep(0);
    }
    return out;
  }
  TABS.invest = async () => {
    const h = $('#ipH'); h.onchange = () => { $('#ipHc').classList.toggle('hidden', h.value !== 'custom'); TABS.invest.run && TABS.invest.run(); };
    if (!TABS.invest.cands) { $('#ipTable').innerHTML = `<tr><td>${L('Считаю сигналы по 21 акции…', 'Computing signals for 21 stocks…')}</td></tr>`; TABS.invest.cands = await ipCandidates(); }
    runIp();
  };
  function runIp() {
    TABS.invest.run = runIp;
    const cands = TABS.invest.cands; if (!cands) return;
    const sum = parseFloat($('#ipSum').value) || 0, N = Math.max(1, parseInt($('#ipN').value) || 6), maxP = (parseFloat($('#ipMax').value) || 35) / 100, secP = (parseFloat($('#ipSec').value) || 50) / 100, broker = $('#ipBroker').value;
    const hv = $('#ipH').value, H = hv === 'custom' ? (parseFloat($('#ipHc').value) || 180) : +hv;
    // автоподбор
    const sorted = [...cands].sort((a, b) => b.score - a.score), pick = [], secCount = {};
    const maxPerSector = Math.max(1, Math.floor(N * secP + 1e-9));
    for (const c of sorted) {
      if (pick.length >= N) break;
      if (c.signal === 'AVOID' || c.signal === 'SELL' || c.upside <= 0) continue;
      if ((secCount[c.sector] || 0) >= maxPerSector) continue;
      pick.push(c); secCount[c.sector] = (secCount[c.sector] || 0) + 1;
    }
    const auto = new Set(pick.map(c => c.sym));
    const inc = s => ipManual && ipManual.include && ipManual.include[s] != null ? ipManual.include[s] : auto.has(s);
    const chosen = cands.filter(c => inc(c.sym));
    // доли
    let w = chosen.map(c => $('#ipW').value === 'eq' ? 1 : Math.max(0.05, c.score + 0.3));
    const norm = () => { const s = w.reduce((a, b) => a + b, 0) || 1; w = w.map(x => x / s); };
    norm(); for (let k = 0; k < 10; k++) { let over = 0; w = w.map(x => { if (x > maxP) { over += x - maxP; return maxP; } return x; }); if (over < 1e-9) break; const free = w.filter(x => x < maxP).length; if (!free) break; w = w.map(x => x < maxP ? x + over / free : x); }
    let spent = 0, fees = 0;
    const rows = chosen.map((c, k) => { const alloc = sum * w[k]; let q = Math.floor(alloc / c.price); while (q > 0 && q * c.price + APP.fee(q, c.price, broker) > alloc + 1e-6) q--; const f = APP.fee(q, c.price, broker); spent += q * c.price; fees += f; return { ...c, w: w[k], qty: q, cost: q * c.price, fee: f }; });
    const gain = (r, d) => r.cost * r.upside * Math.min(1, d / 365) - r.fee;
    const Hs = [10, 30, 91, 365]; if (!Hs.includes(H)) Hs.push(H);
    const all = [...rows, ...cands.filter(c => !inc(c.sym)).sort((a, b) => b.score - a.score).map(c => ({ ...c, off: true }))];
    $('#ipTable').innerHTML = `<tr><th>${L('Мой выбор', 'My pick')}</th><th>${L('Тикер', 'Ticker')}</th><th class="l">${L('Отрасль', 'Sector')}</th><th>${L('Цена', 'Price')}</th><th>${L('Потенциал', 'Upside')}</th><th>${L('Сигнал 1Д', 'Signal 1D')}</th><th>${L('Оценка', 'Score')}</th><th>${L('Доля', 'Weight')}</th><th>${L('Акций', 'Shares')}</th><th>${L('Сумма $', 'Amount $')}</th><th>${L('Комиссия', 'Fee')}</th>${Hs.map(d => `<th>${L('Выгода', 'Gain')} ${d}${L('д', 'd')}</th>`).join('')}</tr>` +
      all.map(r => `<tr class="${r.off ? 'muted' : ''}"><td><input type="checkbox" data-ip="${r.sym}" ${r.off ? '' : 'checked'}> ${auto.has(r.sym) ? '🤖' : ''}</td><td><a href="#" data-open="${r.sym}"><b>${r.sym}</b></a></td><td class="l small">${esc(r.sector)}</td><td>${fmt(r.price)}</td>
        <td class="${r.upside >= 0 ? 'up' : 'down'}">${(r.upside * 100 >= 0 ? '+' : '') + fmt(r.upside * 100, 1)}%</td><td>${APP.sigTag(r.signal)}</td><td>${fmt(r.score * 100, 0)}</td>
        ${r.off ? `<td colspan="${4 + Hs.length}"></td>` : `<td>${fmt(r.w * 100, 1)}%</td><td>${r.qty}</td><td>${fmt(r.cost, 2)}</td><td>${fmt(r.fee, 2)}</td>${Hs.map(d => { const v = gain(r, d); return `<td class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${fmt(v, 2)}</td>`; }).join('')}`}</tr>`).join('');
    const totalGain = d => rows.reduce((s, r) => s + gain(r, d), 0);
    $('#ipTotal').innerHTML = `<div class="row wrap"><b>${L('Вложено', 'Invested')}: ${fmt(spent, 2)} $</b> · ${L('комиссии', 'fees')} ${fmt(fees, 2)} $ · ${L('остаток', 'cash left')} ${fmt(sum - spent - fees, 2)} $ · ${Hs.map(d => `${d}${L('д', 'd')}: <b class="${totalGain(d) >= 0 ? 'up' : 'down'}">${fmt(totalGain(d), 2)} $</b>`).join(' · ')}</div>
      <div class="row wrap"><select id="ipAdd" class="sel">${D.ALL.concat((APP.status && APP.status.extra) || []).filter(s => !cands.find(c => c.sym === s)).map(s => `<option>${s}</option>`).join('')}</select><button class="btn sm" id="ipAddBtn">${L('+ Добавить свою акцию', '+ Add my stock')}</button></div>
      <div class="small muted">${L('Выгода — доля потенциала до 12-месячной цели аналитиков, пропорционально сроку, минус комиссия. Учебный расчёт, не рекомендация.', 'Gain = share of upside to the 12-month analyst target, pro-rated by horizon, minus fees. Educational, not advice.')}</div>`;
    $('#ipAddBtn').onclick = async () => { const s = $('#ipAdd').value; ipManual = ipManual || { include: {}, extra: [] }; ipManual.extra.push(s); ipManual.include[s] = true; APP.store.set('ipManual', ipManual); TABS.invest.cands = await ipCandidates(); runIp(); };
  }
  function initInvest() {
    ['#ipSum', '#ipN', '#ipW', '#ipMax', '#ipSec', '#ipBroker', '#ipHc'].forEach(s => $(s).addEventListener('change', runIp));
    $('#btnIp').onclick = async () => { TABS.invest.cands = await ipCandidates(); runIp(); };
    $('#ipTable').addEventListener('change', e => { const s = e.target.dataset.ip; if (!s) return; ipManual = ipManual || { include: {}, extra: [] }; ipManual.include[s] = e.target.checked; APP.store.set('ipManual', ipManual); runIp(); });
    $('#btnIpReset').onclick = () => { ipManual = null; APP.store.set('ipManual', null); TABS.invest.cands = null; TABS.invest(); };
  }

  /* ======================= КАЛЕНДАРЬ БИРЖИ ======================= */
  const FOMC = { 2026: ['01-28', '03-18', '04-29', '06-17', '07-29', '09-16', '10-28', '12-09'], 2027: ['01-27', '03-17', '04-28', '06-16', '07-28', '09-22', '10-27', '12-08'] };
  const nthWeekday = (y, m, wd, n) => { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return 1 + ((wd - first + 7) % 7) + (n - 1) * 7; };
  const lastWeekday = (y, m, wd) => { const last = new Date(Date.UTC(y, m, 0)); const d = last.getUTCDate(); return d - ((last.getUTCDay() - wd + 7) % 7); };
  const nextTrading = (y, m, d) => { for (let k = 0; k < 7; k++) { const dt = new Date(Date.UTC(y, m - 1, d + k)); if (D.isTradingDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())) return dt; } return new Date(Date.UTC(y, m - 1, d)); };
  const NY = 'America/New_York';
  function macroEvents(y, m) {
    const ev = [], add = (d, H, M, type, ru, en, imp, above, below) => { const t = D.zonedTime(y, m, d, H, M, NY); ev.push({ t, y, m, d, type, title: L(ru, en), imp, above, below }); };
    (FOMC[y] || []).forEach(md => { const [mm, dd] = md.split('-').map(Number); if (mm === m) add(dd, 14, 0, 'fed', `Решение ФРС по ставке${y === 2027 ? ' (предв.)' : ''}`, `FOMC rate decision${y === 2027 ? ' (tent.)' : ''}`, 3, L('ястребы: доллар ↑, акции ↓', 'hawkish: USD ↑, stocks ↓'), L('голуби: доллар ↓, акции ↑, золото ↑', 'dovish: USD ↓, stocks ↑, gold ↑'));
      const mn = new Date(Date.UTC(y, mm - 1, dd + 21)); if (mn.getUTCMonth() + 1 === m && mn.getUTCFullYear() === y) add(mn.getUTCDate(), 14, 0, 'fed', 'Протокол заседания ФРС', 'FOMC minutes', 2, '', ''); });
    // протоколы прошлого месяца, попадающие в этот
    (FOMC[y] || []).concat((FOMC[y - 1] || []).slice(-1).map(x => 'prev-' + x)).forEach(md => { if (!md.startsWith('prev-')) return; const [mm, dd] = md.slice(5).split('-').map(Number); const mn = new Date(Date.UTC(y - 1, mm - 1, dd + 21)); if (mn.getUTCMonth() + 1 === m && mn.getUTCFullYear() === y) add(mn.getUTCDate(), 14, 0, 'fed', 'Протокол заседания ФРС', 'FOMC minutes', 2, '', ''); });
    const nfp = nthWeekday(y, m, 5, 1); add(nfp, 8, 30, 'macro', 'Nonfarm Payrolls (≈)', 'Nonfarm Payrolls (≈)', 3, L('сильный рынок труда: доллар ↑', 'strong jobs: USD ↑'), L('слабый: доллар ↓, золото ↑', 'weak: USD ↓, gold ↑'));
    const cpi = nextTrading(y, m, 11); add(cpi.getUTCDate(), 8, 30, 'macro', 'Инфляция CPI (≈)', 'CPI inflation (≈)', 3, L('инфляция выше: доллар ↑, Nasdaq ↓', 'hot CPI: USD ↑, Nasdaq ↓'), L('ниже: акции ↑, золото ↑', 'cool CPI: stocks ↑, gold ↑'));
    const ppi = nextTrading(y, m, cpi.getUTCDate() + 1); add(ppi.getUTCDate(), 8, 30, 'macro', 'Цены производителей PPI (≈)', 'PPI (≈)', 2, '', '');
    const pce = lastWeekday(y, m, 5); add(pce, 8, 30, 'macro', 'PCE / доходы и расходы (≈)', 'PCE / income & spending (≈)', 2, L('выше: доллар ↑', 'hot: USD ↑'), L('ниже: акции ↑', 'cool: stocks ↑'));
    const gdp = lastWeekday(y, m, 4); add(gdp, 8, 30, 'macro', 'ВВП США (≈)', 'US GDP (≈)', 2, L('сильный рост: акции ↑', 'strong: stocks ↑'), L('слабый: риск рецессии', 'weak: recession risk'));
    const jolts = nthWeekday(y, m, 2, 1); add(jolts, 10, 0, 'macro', 'Вакансии JOLTS (≈)', 'JOLTS job openings (≈)', 1, '', '');
    const opex = nthWeekday(y, m, 5, 3), qw = [3, 6, 9, 12].includes(m);
    add(D.isTradingDay(y, m, opex) ? opex : opex - 1, 9, 30, 'opex', qw ? 'Квадрупл-витчинг (экспирация)' : 'Экспирация опционов', qw ? 'Quadruple witching' : 'Monthly options expiration', qw ? 3 : 2, '', '');
    return ev;
  }
  function companyEvents(y, m) {
    const ev = [];
    Object.values(D.cache).forEach(d => {
      const e = d.events || {}, add = (t, type, ru, en) => { if (!t) return; const p = D.parts(t, NY); if (p.y === y && p.m === m) ev.push({ t, y, m, d: p.d, type, title: d.symbol + ': ' + L(ru, en), imp: 2, sym: d.symbol }); };
      (e.earnings || []).forEach(t => add(t, 'earn', 'отчёт', 'earnings')); add(e.exDividend, 'div', 'экс-дивиденд', 'ex-dividend'); add(e.dividendDate, 'div', 'выплата дивиденда', 'dividend payment');
    });
    if (fxData && fxData.calendar) fxData.calendar.forEach(c => { const mt = /(\d{4})-(\d{2})-(\d{2})/.exec(c.date || ''); if (mt && +mt[1] === y && +mt[2] === m) ev.push({ t: D.zonedTime(y, m, +mt[3], 12, 0, NY), y, m, d: +mt[3], type: 'news', title: c.event, imp: c.importance || 1 }); });
    return ev;
  }
  TABS.macroUpcoming = days => {
    const now = Date.now() / 1000, p = D.parts(now, NY), out = [];
    for (let k = 0; k < 2; k++) { const dt = new Date(Date.UTC(p.y, p.m - 1 + k, 1)); out.push(...macroEvents(dt.getUTCFullYear(), dt.getUTCMonth() + 1)); }
    return out.filter(e => e.t >= now - 3600 && e.t <= now + days * 86400).sort((a, b) => a.t - b.t);
  };
  const CALF = [['hol', 'Праздники', 'Holidays'], ['fed', 'ФРС', 'Fed'], ['macro', 'Макро США', 'US macro'], ['opex', 'Экспирации', 'Expirations'], ['earn', 'Отчёты', 'Earnings'], ['div', 'Дивиденды', 'Dividends'], ['news', 'Новости Форекс', 'Forex news']];
  let calY, calM, calSel, calF = APP.store.get('calF', { hol: true, fed: true, macro: true, opex: true, earn: true, div: true, news: true });
  TABS.calendar = async () => {
    if (calY == null) { const p = D.parts(Date.now() / 1000, D.userTZ()); calY = p.y; calM = p.m; calSel = p.d; }
    renderCal();
    if (!TABS.calendar.loaded) { TABS.calendar.loaded = true; for (const s of D.ALL) { await D.load(s).catch(() => null); await sleep(0); } renderCal(); }
  };
  function sessionHours(y, m, d) {
    const tz = D.userTZ(), iso = D.isoDay(y, m, d), early = !!D.EARLY[iso];
    const T = (H, M) => D.fmtTime(D.zonedTime(y, m, d, H, M, NY), tz);
    return { pre: T(4, 0) + '–' + T(9, 30), reg: T(9, 30) + '–' + (early ? T(13, 0) : T(16, 0)), post: (early ? T(13, 0) : T(16, 0)) + '–' + (early ? T(17, 0) : T(20, 0)), early, diff: (D.tzOffset(D.zonedTime(y, m, d, 12, 0, NY), tz) - D.tzOffset(D.zonedTime(y, m, d, 12, 0, NY), NY)) / 3600 };
  }
  function renderCal() {
    $('#calFilters').innerHTML = CALF.map(([k, ru, en]) => `<label class="small"><input type="checkbox" data-cf="${k}" ${calF[k] ? 'checked' : ''}> ${L(ru, en)}</label>`).join('');
    const months = L(['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'], ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
    $('#calTitle').textContent = months[calM - 1] + ' ' + calY + ' · NYSE / Nasdaq';
    const evs = macroEvents(calY, calM).concat(companyEvents(calY, calM)).filter(e => calF[e.type]);
    const first = (new Date(Date.UTC(calY, calM - 1, 1)).getUTCDay() + 6) % 7, days = new Date(Date.UTC(calY, calM, 0)).getUTCDate();
    const today = D.parts(Date.now() / 1000, D.userTZ());
    const wd = L(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    let h = wd.map(x => `<div class="h">${x}</div>`).join('') + '<div></div>'.repeat(first);
    for (let d = 1; d <= days; d++) {
      const iso = D.isoDay(calY, calM, d), hol = D.HOLIDAYS[iso], early = D.EARLY[iso], dow = new Date(Date.UTC(calY, calM - 1, d)).getUTCDay(), we = dow === 0 || dow === 6;
      const de = evs.filter(e => e.d === d);
      const cls = ['d', we ? 'we' : '', hol && calF.hol ? 'hol' : '', early && calF.hol ? 'early' : '', calY === today.y && calM === today.m && d === today.d ? 'today' : '', d === calSel ? 'sel' : '', de.length ? 'has' : ''].join(' ');
      h += `<div class="${cls}" data-d="${d}"><span class="n">${d}</span>${hol && calF.hol ? `<span class="ev">⛔ ${esc(L(hol, D.HOLIDAYS_EN[hol] || hol))}</span>` : ''}${early && calF.hol ? `<span class="ev">⏰ ${L('сокр.', 'early')}</span>` : ''}${de.slice(0, 3).map(e => `<span class="ev ${e.type}">${esc(e.title)}</span>`).join('')}${de.length > 3 ? `<span class="muted">+${de.length - 3}</span>` : ''}</div>`;
    }
    $('#calMonth').innerHTML = h;
    const sh = sessionHours(calY, calM, Math.min(calSel || 1, days));
    $('#calSessions').innerHTML = `${L('Часы сессий в вашем поясе', 'Session hours in your time zone')} (${esc(D.userTZ())}): ${L('премаркет', 'pre')} ${sh.pre}, ${L('основная', 'regular')} ${sh.reg}, ${L('постмаркет', 'post')} ${sh.post}. ${L('Разница с Нью-Йорком', 'Offset vs New York')}: ${sh.diff >= 0 ? '+' : ''}${sh.diff} ${L('ч', 'h')}${Math.abs(sh.diff) !== 7 && D.userTZ() === 'Asia/Jerusalem' ? L(' — переходный период перевода часов!', ' — DST transition period!') : ''}.`;
    renderCalDay(evs);
    const up = TABS.macroUpcoming(14).concat(Object.values(D.cache).flatMap(d => { const e = d.events || {}, now = Date.now() / 1000; return [].concat((e.earnings || []).map(t => ({ t, title: d.symbol + ': ' + L('отчёт', 'earnings'), type: 'earn', imp: 2 })), e.exDividend ? [{ t: e.exDividend, title: d.symbol + ': ' + L('экс-дивиденд', 'ex-dividend'), type: 'div', imp: 1 }] : []).filter(x => x.t >= now - 86400 && x.t <= now + 14 * 86400); }))
      .filter(e => calF[e.type]);
    const now = Date.now() / 1000;
    Object.keys(D.HOLIDAYS).forEach(iso => { const [y, m, d] = iso.split('-').map(Number), t = D.zonedTime(y, m, d, 9, 30, NY); if (t >= now - 86400 && t <= now + 14 * 86400 && calF.hol) up.push({ t, title: '⛔ ' + L(D.HOLIDAYS[iso], D.HOLIDAYS_EN[D.HOLIDAYS[iso]] || ''), type: 'hol', imp: 3 }); });
    up.sort((a, b) => a.t - b.t);
    $('#calUpcoming').innerHTML = up.map(e => `<div class="news-item"><span class="ev ${e.type}">${'★'.repeat(e.imp || 1)}</span> <b>${D.fmtDate(e.t)}</b> ${e.type === 'earn' || e.type === 'div' || e.type === 'hol' ? '' : D.fmtTime(e.t)} — ${esc(e.title)}</div>`).join('') || `<div class="muted">${L('Событий нет', 'No events')}</div>`;
  }
  function renderCalDay(evs) {
    const d = calSel; if (!d) return; const iso = D.isoDay(calY, calM, d), hol = D.HOLIDAYS[iso], early = D.EARLY[iso];
    const trading = D.isTradingDay(calY, calM, d), sh = sessionHours(calY, calM, d);
    $('#calDayTitle').textContent = L('Детали дня', 'Day details') + ': ' + pad(d) + '.' + pad(calM) + '.' + calY;
    $('#calDay').innerHTML = `<div><b>${trading ? (early ? L('Сокращённый торговый день (закрытие 13:00 NY)', 'Early close (13:00 NY)') : L('Торговый день', 'Trading day')) : hol ? '⛔ ' + esc(L(hol, D.HOLIDAYS_EN[hol] || hol)) + L(' — биржа закрыта', ' — market closed') : L('Выходной', 'Weekend')}</b></div>
      ${trading ? `<div class="small">${L('Премаркет', 'Pre')} ${sh.pre} · ${L('Основная', 'Regular')} ${sh.reg} · ${L('Постмаркет', 'Post')} ${sh.post}</div>` : ''}
      ${evs.filter(e => e.d === d).sort((a, b) => a.t - b.t).map(e => `<div class="news-item"><span class="ev ${e.type}">${'★'.repeat(e.imp || 1)}</span> ${D.fmtTime(e.t)} — ${esc(e.title)}${e.above ? `<div class="small muted">▲ ${esc(e.above)}${e.below ? ' · ▼ ' + esc(e.below) : ''}</div>` : ''}</div>`).join('')}`;
  }
  function initCal() {
    $('#calPrev').onclick = () => { calM--; if (calM < 1) { calM = 12; calY--; } calSel = 1; renderCal(); };
    $('#calNext').onclick = () => { calM++; if (calM > 12) { calM = 1; calY++; } calSel = 1; renderCal(); };
    $('#calMonth').onclick = e => { const c = e.target.closest('[data-d]'); if (!c) return; calSel = +c.dataset.d; renderCal(); };
    $('#calFilters').onchange = e => { const k = e.target.dataset.cf; if (!k) return; calF[k] = e.target.checked; APP.store.set('calF', calF); renderCal(); };
  }

  /* ======================= УСРЕДНЕНИЕ ======================= */
  let avState = null;
  const avKey = () => 'avg_' + $('#avTicker').value;
  const num = v => parseFloat(String(v).replace(',', '.')) || 0;
  TABS.avg = async () => {
    const sel = $('#avTicker'); if (!sel.options.length) { sel.innerHTML = D.ALL.map(s => `<option>${s}</option>`).join(''); sel.value = SET().sym && D.ALL.includes(SET().sym) ? SET().sym : 'AAPL'; }
    await loadAv(); renderAv();
  };
  async function loadAv() {
    const s = $('#avTicker').value, d = await D.load(s), price = (d.quote && d.quote.price) || d.frames['1D'].slice(-1)[0].c;
    avState = APP.store.get(avKey(), null) || { qty: 10, avg: +(price * 1.1).toFixed(2), buys: [{ mode: 'usd', value: 1000, price: +(price).toFixed(2) }], broker: SET().broker };
    avState.cur = price;
    $('#avQty').value = avState.qty; $('#avAvg').value = avState.avg; $('#avBroker').value = avState.broker || SET().broker;
    $('#avTarget').value = avState.target || +(price * 1.03).toFixed(2); $('#avTPrice').value = avState.tprice || +(price).toFixed(2);
  }
  function saveAv() { const { cur, ...rest } = avState; void cur; APP.store.set(avKey(), rest); }
  function renderAv() {
    const st = avState, broker = $('#avBroker').value, cur = st.cur;
    st.qty = num($('#avQty').value); st.avg = num($('#avAvg').value); st.broker = broker;
    $('#avBuys').innerHTML = st.buys.map((b, k) => `<div class="buyrow"><b>#${k + 1}</b><select class="sel" data-bk="${k}" data-f="mode"><option value="usd" ${b.mode === 'usd' ? 'selected' : ''}>${L('на сумму $', 'amount $')}</option><option value="qty" ${b.mode === 'qty' ? 'selected' : ''}>${L('штук', 'shares')}</option></select>
      <input data-bk="${k}" data-f="value" value="${b.value}"> ${L('по цене', 'at price')} <input data-bk="${k}" data-f="price" value="${b.price}"><button class="btn sm" data-del="${k}">✕</button></div>`).join('');
    let Q = st.qty, cost = st.qty * st.avg, fees = 0; const steps = [{ n: L('Позиция', 'Position'), q: st.qty, p: st.avg, Q, avg: st.avg, inv: cost, fee: 0 }];
    st.buys.forEach((b, k) => {
      const q = b.mode === 'usd' ? Math.floor(num(b.value) / Math.max(1e-9, num(b.price)) * 1e4) / 1e4 : num(b.value), wq = D.isCrypto($('#avTicker').value) ? q : Math.floor(q);
      const f = APP.fee(wq, num(b.price), broker); Q += wq; cost += wq * num(b.price); fees += f;
      steps.push({ n: L('Докупка #', 'Buy #') + (k + 1), q: wq, p: num(b.price), Q, avg: Q ? cost / Q : 0, inv: cost, fee: f });
    });
    const avg = Q ? cost / Q : 0, value = Q * cur, sellFee = APP.fee(Q, cur, broker), pl = value - cost - fees - sellFee, be = Q ? (cost + fees + sellFee) / Q : 0;
    $('#avRes').innerHTML = `<div class="plan-grid"><span>${L('Новая средняя', 'New average')}</span><b>${fmt(avg)}</b><span>${L('Всего акций', 'Total shares')}</span><b>${fmt(Q, Q % 1 ? 4 : 0)}</b>
      <span>${L('Вложено', 'Invested')}</span><b>${fmt(cost, 2)} $ + ${L('комиссии', 'fees')} ${fmt(fees, 2)} $</b><span>${L('Стоимость по текущей', 'Value at current')} ${fmt(cur)}</span><b>${fmt(value, 2)} $</b>
      <span>${L('Прибыль / убыток', 'Profit / loss')}</span><b class="${pl >= 0 ? 'up' : 'down'}">${pl >= 0 ? '+' : ''}${fmt(pl, 2)} $ (${cost ? fmt(pl / cost * 100, 2) : 0}%)</b><span>${L('Безубыток с комиссиями', 'Breakeven incl. fees')}</span><b>${fmt(be)}</b></div>`;
    const marks = [[st.avg, L('старая средняя', 'old avg'), 'var(--muted)'], [avg, L('новая средняя', 'new avg'), 'var(--accent)'], [be, L('безубыток', 'breakeven'), 'var(--warn)'], [cur, L('текущая', 'current'), cur >= be ? 'var(--up)' : 'var(--down)']].concat(st.buys.map((b, k) => [num(b.price), '#' + (k + 1), 'var(--fg)']));
    const vs = marks.map(m => m[0]).filter(v => v > 0), lo = Math.min(...vs) * 0.98, hi = Math.max(...vs) * 1.02;
    $('#avScale').innerHTML = '<div class="ln"></div>' + marks.filter(m => m[0] > 0).map((m, k) => `<div class="mk" style="left:${(m[0] - lo) / (hi - lo) * 100}%;color:${m[2]};top:${k % 2 ? 24 : 0}px">${k % 2 ? '<i></i>' : ''}${esc(m[1])} ${fmt(m[0])}${k % 2 ? '' : '<i></i>'}</div>`).join('');
    $('#avSteps').innerHTML = `<tr><th>${L('Шаг', 'Step')}</th><th>${L('Кол-во', 'Qty')}</th><th>${L('Цена', 'Price')}</th><th>${L('Итого акций', 'Total qty')}</th><th>${L('Средняя', 'Average')}</th><th>${L('Вложено', 'Invested')}</th><th>${L('Комиссия', 'Fee')}</th></tr>` + steps.map(s => `<tr><td>${s.n}</td><td>${fmt(s.q, s.q % 1 ? 4 : 0)}</td><td>${fmt(s.p)}</td><td>${fmt(s.Q, s.Q % 1 ? 4 : 0)}</td><td>${fmt(s.avg)}</td><td>${fmt(s.inv, 2)}</td><td>${fmt(s.fee, 2)}</td></tr>`).join('');
    // обратная задача
    const T = num($('#avTarget').value), P = num($('#avTPrice').value); st.target = T; st.tprice = P;
    let rev;
    if (!(P < T && T < avg) && !(P > T && T > avg)) rev = L('Недостижимо: нужная средняя должна быть между ценой докупки и текущей средней.', 'Impossible: target must lie between the buy price and the current average.');
    else { const x = Q * (avg - T) / (T - P), xi = D.isCrypto($('#avTicker').value) ? x : Math.ceil(x); rev = L(`Нужно докупить <b>${fmt(xi, xi % 1 ? 4 : 0)}</b> акций по ${fmt(P)} = <b>${fmt(xi * P, 2)} $</b> (+ комиссия ${fmt(APP.fee(xi, P, broker), 2)} $).`, `Buy <b>${fmt(xi, xi % 1 ? 4 : 0)}</b> shares at ${fmt(P)} = <b>${fmt(xi * P, 2)} $</b> (+ fee ${fmt(APP.fee(xi, P, broker), 2)} $).`); }
    $('#avReverse').innerHTML = `<div>${rev}</div><div class="small muted">${L('Считается от текущей позиции с учётом докупок выше.', 'Based on the current position including the buys above.')}</div>`;
    saveAv();
  }
  function initAvg() {
    $('#avTicker').onchange = async () => { await loadAv(); renderAv(); };
    ['#avQty', '#avAvg', '#avBroker', '#avTarget', '#avTPrice'].forEach(s => $(s).addEventListener('input', renderAv));
    $('#avBuys').addEventListener('change', e => { const k = e.target.dataset.bk; if (k == null) return; const f = e.target.dataset.f; avState.buys[k][f] = f === 'mode' ? e.target.value : num(e.target.value); renderAv(); });
    $('#avBuys').addEventListener('click', e => { const k = e.target.dataset.del; if (k == null) return; avState.buys.splice(+k, 1); renderAv(); });
    $('#avAdd').onclick = () => { avState.buys.push({ mode: 'usd', value: 1000, price: +avState.cur.toFixed(2) }); renderAv(); };
    $$('[data-q]').forEach(b => b.onclick = () => { const pct = +b.dataset.q; avState.buys.push({ mode: 'usd', value: 1000, price: +(avState.cur * (1 - pct / 100)).toFixed(4) }); renderAv(); });
  }

  document.addEventListener('DOMContentLoaded', () => { initFx(); initAnalysts(); initInvest(); initCal(); initAvg(); });
})(window);

/* Интерфейс терминала. */
(function (g) {
  'use strict';
  const D = g.DATA, A = g.ANALYSIS, C = g.CANDLES, I = g.IND, L = A.L, fmt = A.fmt;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('term_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('term_' + k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
  };
  const LAYERS = [
    ['reversals', 'Развороты', 'Reversals'], ['ichimoku', 'Ишимоку', 'Ichimoku'], ['bb', 'Боллинджер', 'Bollinger'], ['ma', 'MA', 'MA'],
    ['vwap', 'VWAP', 'VWAP'], ['levels', 'Уровни', 'Levels'], ['liquidity', 'Ликвидность', 'Liquidity'], ['volprofile', 'Профиль объёма', 'Volume profile'],
    ['patterns', 'Свечи', 'Patterns'], ['fibo', 'Фибоначчи', 'Fibonacci'], ['trend', 'Линии тренда', 'Trend lines'], ['gusev', 'Свечи Гусева', 'Gusev signals'],
  ];
  const BROKERS = [
    { id: 'ibkr', ru: 'Interactive Brokers: $0,005/акц., мин. $1', en: 'Interactive Brokers: $0.005/sh, min $1', perShare: 0.005, min: 1, pct: 0, maxPct: 1 },
    { id: 'il_bank', ru: 'Израильский банк: 0,1%, мин. $7', en: 'Israeli bank: 0.1%, min $7', perShare: 0, min: 7, pct: 0.1 },
    { id: 'il_broker', ru: 'Израильский брокер: $2,5 фикс.', en: 'Israeli broker: $2.5 flat', perShare: 0, min: 2.5, pct: 0, flat: 2.5 },
    { id: 'zero', ru: 'Без комиссии', en: 'Zero commission', perShare: 0, min: 0, pct: 0 },
    { id: 'custom', ru: 'Своя (в параметрах)', en: 'Custom (in settings)', custom: true },
  ];

  /* ---------------- настройки ---------------- */
  const S0 = {
    lang: 'ru', theme: 'auto', tz: 'Asia/Jerusalem', sym: 'AAPL', tf: '1D', longOnly: true,
    params: { ...A.DEFAULT_PARAMS }, weights: A.defaultWeights(), layers: { levels: true, ma: true, patterns: true, gusev: false, ichimoku: false, vwap: false },
    favorites: ['AAPL', 'NVDA', 'BTC'], deposit: 10000, riskPct: 1, broker: 'ibkr', custom: { perShare: 0.01, min: 2, pct: 0 },
  };
  const SETTINGS = g.SETTINGS = Object.assign({}, S0, store.get('settings', {}));
  SETTINGS.params = Object.assign({}, A.DEFAULT_PARAMS, SETTINGS.params);
  SETTINGS.weights = Object.assign(A.defaultWeights(), SETTINGS.weights);
  const save = () => store.set('settings', SETTINGS);

  const APP = g.APP = { $, $$, esc, store, save, BROKERS, toast, fee, brokerName, dailyInfo, openTicker, claude, L };

  function toast(msg, ms = 4000) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms); }
  function fee(qty, price, brokerId) {
    const b0 = BROKERS.find(b => b.id === brokerId) || BROKERS[0], b = b0.custom ? { ...SETTINGS.custom } : b0;
    if (!qty) return 0;
    if (b.flat) return b.flat;
    let f = qty * (b.perShare || 0) + qty * price * (b.pct || 0) / 100;
    f = Math.max(f, b.min || 0);
    if (b.maxPct) f = Math.min(f, qty * price * b.maxPct / 100);
    return f;
  }
  function brokerName(b) { return L(b.ru, b.en); }
  function fillBrokers() { $$('.brokerSel').forEach(sel => { const v = sel.value || SETTINGS.broker; sel.innerHTML = BROKERS.map(b => `<option value="${b.id}">${esc(brokerName(b))}</option>`).join(''); sel.value = v; }); }

  /* ---------------- язык ---------------- */
  function applyLang() {
    document.documentElement.lang = SETTINGS.lang;
    $$('[data-en]').forEach(el => {
      if (el.dataset.ru == null) el.dataset.ru = el.textContent;
      el.textContent = SETTINGS.lang === 'en' ? el.dataset.en : el.dataset.ru;
    });
    $$('[data-ph-en]').forEach(el => { if (el.dataset.phRu == null) el.dataset.phRu = el.placeholder; el.placeholder = SETTINGS.lang === 'en' ? el.dataset.phEn : el.dataset.phRu; });
    $('#langSel').value = SETTINGS.lang;
  }

  /* ---------------- тема: авто по рассвету/закату (Израиль) ---------------- */
  function sunTimes(date, lat = 32.08, lon = 34.78) {
    const rad = Math.PI / 180, day = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 864e5);
    const decl = 23.44 * Math.sin(rad * 360 / 365 * (day - 81));
    const ha = Math.acos(Math.max(-1, Math.min(1, (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl * rad)) / (Math.cos(lat * rad) * Math.cos(decl * rad))))) / rad;
    const B = rad * 360 / 365 * (day - 81), eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const noon = 720 - 4 * lon - eot; // минуты UTC
    return { rise: noon - ha * 4, set: noon + ha * 4 };
  }
  function applyTheme() {
    let t = SETTINGS.theme; const root = document.documentElement;
    root.removeAttribute('data-glow');
    if (t === 'auto') {
      const now = new Date(), st = sunTimes(now), m = now.getUTCHours() * 60 + now.getUTCMinutes();
      t = m > st.rise && m < st.set ? 'light' : 'dark';
      if (Math.abs(m - st.rise) < 45 || Math.abs(m - st.set) < 45) root.setAttribute('data-glow', '1'); // подсветка в сумерках
    }
    root.setAttribute('data-theme', t);
    $('#themeSel').value = SETTINGS.theme;
    if (APP.chart) APP.chart.draw();
  }

  /* ---------------- подсказки и экскурсия ---------------- */
  function initTips() {
    const tip = $('#tip');
    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[data-tip]'); if (!el || !APP.guide) { tip.classList.add('hidden'); return; }
      tip.textContent = SETTINGS.lang === 'en' && el.dataset.tipEn ? el.dataset.tipEn : el.dataset.tip; tip.classList.remove('hidden');
    });
    document.addEventListener('mousemove', e => { if (!tip.classList.contains('hidden')) { tip.style.left = Math.min(innerWidth - 310, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; } });
    const steps = ['.brand', '.search', '#btnRefresh', '#signalBox', '.gaugebox', '.calc', '#tfSeg', '#layers', '#lamp', '#cardFactors', '#cardPlan', '#cardSessions', '#cardPatterns', '#cardBT', '#cardExpert', '#tabs', '#favBar'];
    let k = 0;
    const show = () => {
      $$('.tour-hl').forEach(e => e.classList.remove('tour-hl'));
      const sel = steps[k], el = $(sel); if (!el || el.offsetParent === null) { if (k < steps.length - 1) { k++; return show(); } }
      if (el) { el.classList.add('tour-hl'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      $('#tourText').textContent = el ? (SETTINGS.lang === 'en' && el.dataset.tipEn ? el.dataset.tipEn : el.dataset.tip || '') : '';
      $('#tourN').textContent = (k + 1) + ' / ' + steps.length;
    };
    $('#btnGuide').onclick = () => {
      APP.guide = !APP.guide; $('#btnGuide').classList.toggle('primary', APP.guide);
      if (APP.guide) { k = 0; showTab('terminal'); $('#tour').classList.remove('hidden'); show(); toast(L('Подсказки включены: наведите на любой блок', 'Tooltips on: hover any block'), 2500); }
      else { $('#tour').classList.add('hidden'); $$('.tour-hl').forEach(e => e.classList.remove('tour-hl')); }
    };
    $('#tourNext').onclick = () => { k = Math.min(steps.length - 1, k + 1); show(); };
    $('#tourPrev').onclick = () => { k = Math.max(0, k - 1); show(); };
    $('#tourEnd').onclick = () => { $('#tour').classList.add('hidden'); $$('.tour-hl').forEach(e => e.classList.remove('tour-hl')); };
  }

  /* ---------------- вкладки ---------------- */
  function showTab(name) {
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    SETTINGS.tab = name; save();
    if (g.TABS && g.TABS[name]) g.TABS[name]();
    if (name === 'terminal' && APP.chart) { APP.chart.resize(); APP.chart.draw(); }
  }
  APP.showTab = showTab;

  /* ---------------- часы, лампа, статус ---------------- */
  function tick() {
    const now = Date.now() / 1000, ms = D.marketState(now), tz = D.userTZ();
    const names = { pre: L('премаркет', 'pre-market'), regular: L('основная сессия', 'regular session'), post: L('постмаркет', 'post-market'), closed: L('биржа закрыта', 'market closed') };
    const left = ms.next ? Math.max(0, ms.next - now) : 0, hh = Math.floor(left / 3600), mm = Math.floor(left % 3600 / 60);
    const untilTxt = ms.state === 'closed' ? L(`до премаркета ${hh} ч ${mm} мин`, `pre-market in ${hh}h ${mm}m`) : L(`до конца: ${hh} ч ${mm} мин`, `ends in ${hh}h ${mm}m`);
    $('#brokerClock').innerHTML = `🕒 <b>${D.fmtTime(now, tz)}</b> ${esc(tz.split('/').pop())} · NY ${D.fmtTime(now, 'America/New_York')} · ${names[ms.state]} (${untilTxt})`;
    const lamp = $('#lamp'), crypto = APP.data && APP.data.kind === 'crypto';
    lamp.classList.toggle('on', crypto || ms.state !== 'closed');
    lamp.querySelector('span').textContent = crypto ? L('Крипто 24/7', 'Crypto 24/7') : names[ms.state] + (ms.state === 'closed' && ms.next ? L(' · откроется ', ' · opens ') + D.fmtDT(ms.next, tz) : '');
  }
  async function updateStatus() {
    const st = await D.status(); APP.status = st;
    const el = $('#dataStatus');
    if (!st) { el.innerHTML = L('⚠ сервер не найден — <b>демо-данные</b>', '⚠ no server — <b>demo data</b>'); return st; }
    const j = st.jobs.refresh, n = Object.keys(st.cached).length, last = Math.max(0, ...Object.values(st.cached));
    if (j.running) el.innerHTML = `⟳ Yahoo: <b>${j.done}/${j.total}</b> ${esc(j.message || '')}`;
    else el.innerHTML = n ? `Yahoo: <b>${n}</b> ${L('тикеров', 'tickers')}, ${D.fmtDT(last)}${j.errors && j.errors.length ? ' ⚠' + j.errors.length : ''}` : L('Yahoo: данных нет — нажмите «⟳ Обновить»', 'Yahoo: no data — press ⟳ Refresh');
    el.title = (j.errors || []).join('\n');
    return st;
  }
  async function refresh() {
    if (D.server === false) { toast(L('Запустите terminal_app.py — обновление идёт через Python и yfinance.', 'Run terminal_app.py — refresh uses Python + yfinance.'), 6000); return; }
    try { await D.api('/api/refresh', { body: {} }); } catch (e) { toast(e.message); return; }
    toast(L('Загрузка всех тикеров началась (3–6 минут). График перерисуется сам.', 'Downloading all tickers (3–6 min). The chart redraws by itself.'));
    $('#btnRefresh').disabled = true;
    const poll = async () => {
      const st = await updateStatus();
      if (st && st.jobs.refresh.running) return setTimeout(poll, 3000);
      $('#btnRefresh').disabled = false; D.invalidate(); APP.daily = {};
      await openTicker(SETTINGS.sym, true); renderStrip(); renderFav();
      toast(L('Данные обновлены', 'Data updated'));
    };
    setTimeout(poll, 2000);
  }

  /* ---------------- поиск и CSV ---------------- */
  function initSearch() {
    const inp = $('#search'), res = $('#searchRes'); let h;
    const local = q => D.ALL.filter(s => s.includes(q.toUpperCase()) || (D.NAMES[s] || '').toLowerCase().includes(q.toLowerCase())).map(s => ({ symbol: s, name: D.NAMES[s] || '', exchange: D.isCrypto(s) ? 'Crypto' : 'US' }));
    const render = list => { res.innerHTML = list.slice(0, 12).map(q => `<div data-s="${esc(q.symbol)}"><b>${esc(q.symbol)}</b><span class="muted">${esc(q.name)} ${esc(q.exchange || '')}</span></div>`).join('') || `<div class="muted">${L('ничего не найдено', 'nothing found')}</div>`; res.classList.remove('hidden'); };
    inp.addEventListener('input', () => {
      clearTimeout(h); const q = inp.value.trim(); if (!q) { res.classList.add('hidden'); return; }
      const loc = local(q); render(loc);
      if (D.server) h = setTimeout(async () => { try { const r = await D.api('/api/search?q=' + encodeURIComponent(q)); const seen = new Set(loc.map(x => x.symbol)); render(loc.concat(r.quotes.filter(x => !seen.has(x.symbol)))); } catch (e) { /* офлайн */ } }, 350);
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = res.querySelector('[data-s]'); pick(f ? f.dataset.s : inp.value.trim().toUpperCase()); } });
    res.addEventListener('click', e => { const d = e.target.closest('[data-s]'); if (d) pick(d.dataset.s); });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) res.classList.add('hidden'); });
    async function pick(sym) {
      if (!sym) return; res.classList.add('hidden'); inp.value = '';
      let s = sym.replace(/-USD$/, '') === sym ? sym : sym; if (D.CRYPTO.includes(sym.replace(/-USD$/, ''))) s = sym.replace(/-USD$/, '');
      if (!D.ALL.includes(s) && D.server) {
        toast(L('Загружаю ', 'Loading ') + s + L(' из Yahoo…', ' from Yahoo…'));
        try { const data = await D.api('/api/load', { body: { ticker: s } }); D.put(data); }
        catch (e) { toast(e.message); return; }
      }
      showTab('terminal'); openTicker(s);
    }
    $('#csvFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => {
        try { const name = f.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 12) || 'CSV'; const d = D.parseCSV(r.result, name); D.put(d); showTab('terminal'); openTicker(name); toast(L('CSV загружен: ', 'CSV loaded: ') + name); }
        catch (err) { toast('CSV: ' + err.message); }
      }; r.readAsText(f); e.target.value = '';
    });
  }

  /* ---------------- лента тикеров и избранное ---------------- */
  function renderStrip() {
    const extra = (APP.status && APP.status.extra) || [];
    $('#tickerStrip').innerHTML = D.ALL.concat(extra).map(s => `<span class="chip ${s === SETTINGS.sym ? 'active' : ''}" data-s="${esc(s)}">${esc(s)}</span>`).join('');
  }
  APP.daily = {};
  async function dailyInfo(sym) {
    if (APP.daily[sym]) return APP.daily[sym];
    const data = await D.load(sym), c = data.frames['1D'];
    if (!c || c.length < 60) return null;
    const S = A.prepare(c, '1D', SETTINGS.params), ev = A.evaluate(S, c.length - 1, { weights: SETTINGS.weights, longOnly: SETTINGS.longOnly, news: data.news });
    const price = (data.quote && data.quote.price) || c[c.length - 1].c, prev = (data.quote && data.quote.prevClose) || c[c.length - 2].c;
    return (APP.daily[sym] = { sym, ev, price, change: prev ? (price / prev - 1) * 100 : 0, data, S });
  }
  const sigTag = s => s === 'BUY' ? `<span class="tag b">${L('ПОКУП.', 'BUY')}</span>` : s === 'WAIT' ? `<span class="tag w">${L('ЖДАТЬ', 'WAIT')}</span>` : `<span class="tag s">${L('НЕ ПОК.', 'NO BUY')}</span>`;
  APP.sigTag = sigTag;
  async function renderFav() {
    const bar = $('#favBar'); const favs = SETTINGS.favorites.slice(0, 30);
    bar.innerHTML = favs.map(s => `<span class="chip" data-s="${esc(s)}" id="fav_${esc(s.replace(/[^A-Za-z0-9]/g, '_'))}">★ <b>${esc(s)}</b> …</span>`).join('');
    for (const s of favs) {
      const info = await dailyInfo(s).catch(() => null); const el = $('#fav_' + s.replace(/[^A-Za-z0-9]/g, '_')); if (!el || !info) continue;
      el.innerHTML = `★ <b>${esc(s)}</b> ${fmt(info.price)} <span class="${info.change >= 0 ? 'up' : 'down'}">${info.change >= 0 ? '+' : ''}${info.change.toFixed(2)}%</span> ${sigTag(info.ev.signal)}`;
      await new Promise(r => setTimeout(r, 0));
    }
    $('#favToggle').textContent = SETTINGS.favorites.includes(SETTINGS.sym) ? '★' : '☆';
  }
  APP.renderFav = renderFav;

  /* ---------------- терминал ---------------- */
  function initTerminalControls() {
    $('#tfSeg').innerHTML = D.TF.map(tf => `<button data-tf="${tf}">${{ '5m': '5м', '15m': '15м', '1h': '1ч', '4h': '4ч', '1D': '1Д', '1W': '1Н', '1M': '1Мес' }[tf]}</button>`).join('');
    $('#tfSeg').onclick = e => { const b = e.target.closest('[data-tf]'); if (!b) return; SETTINGS.tf = b.dataset.tf; save(); render(); };
    $('#periodSeg').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; $$('#periodSeg button').forEach(x => x.classList.toggle('active', x === b)); APP.chart.setPeriod(+b.dataset.p); };
    const lay = $('#layers');
    const drawLayers = () => { lay.innerHTML = LAYERS.map(([k, ru, en]) => `<label class="${SETTINGS.layers[k] ? 'on' : ''}"><input type="checkbox" data-l="${k}" ${SETTINGS.layers[k] ? 'checked' : ''}>${L(ru, en)}</label>`).join(''); };
    drawLayers(); APP.drawLayers = drawLayers;
    lay.onchange = e => { const k = e.target.dataset.l; if (!k) return; SETTINGS.layers[k] = e.target.checked; save(); drawLayers(); APP.chart.layers = SETTINGS.layers; APP.chart.draw(); };
    $('#longOnly').checked = SETTINGS.longOnly;
    $('#longOnly').onchange = e => { SETTINGS.longOnly = e.target.checked; save(); APP.daily = {}; render(); renderFav(); };
    $('#deposit').value = SETTINGS.deposit; $('#riskPct').value = SETTINGS.riskPct;
    ['deposit', 'riskPct'].forEach(id => $('#' + id).addEventListener('change', e => { SETTINGS[id] = parseFloat(e.target.value.replace(',', '.')) || S0[id]; save(); render(); }));
    $('#favToggle').onclick = () => {
      const s = SETTINGS.sym, f = SETTINGS.favorites;
      if (f.includes(s)) f.splice(f.indexOf(s), 1); else { if (f.length >= 30) { toast(L('В избранном максимум 30 тикеров', 'Max 30 favourites')); return; } f.push(s); }
      save(); renderFav();
    };
    document.addEventListener('click', e => { const chip = e.target.closest('#tickerStrip .chip, #favBar .chip'); if (chip) { showTab('terminal'); openTicker(chip.dataset.s); } });
    // калькулятор
    $('#calcQty').addEventListener('input', renderCalc);
    $$('.calc [data-add]').forEach(b => b.onclick = () => { const q = parseFloat($('#calcQty').value.replace(',', '.')) || 0, a = +b.dataset.add; $('#calcQty').value = a ? String(+(q + a).toFixed(6)).replace('.', ',') : '0'; renderCalc(); });
    $('#calcBroker').onchange = e => { SETTINGS.broker = e.target.value; save(); renderCalc(); };
  }
  function renderCalc() {
    const q = parseFloat($('#calcQty').value.replace(',', '.')) || 0, p = APP.price || 0, f = fee(q, p, $('#calcBroker').value || SETTINGS.broker);
    $('#calcRes').innerHTML = `${fmt(q, q % 1 ? 4 : 0)} × ${fmt(p)} = ${fmt(q * p, 2)} $<br>${L('Комиссия', 'Fee')}: ${fmt(f, 2)} $<br>${L('Итого', 'Total')}: <b>${fmt(q * p + f, 2)} $</b>`;
  }

  async function openTicker(sym, force) {
    SETTINGS.sym = sym; save();
    $('#qSym').textContent = sym; $('#qName').textContent = L('загрузка…', 'loading…');
    APP.data = await D.load(sym);
    renderStrip(); render(force);
  }

  function tfName(tf) { return L({ '5m': '5 мин', '15m': '15 мин', '1h': '1 час', '4h': '4 часа', '1D': 'дневки', '1W': 'недели', '1M': 'месяцы' }[tf], { '5m': '5 min', '15m': '15 min', '1h': '1 hour', '4h': '4 hours', '1D': 'daily', '1W': 'weekly', '1M': 'monthly' }[tf]); }

  function render() {
    const data = APP.data; if (!data) return;
    let tf = SETTINGS.tf, c = data.frames[tf];
    if (!c || c.length < 30) { const alt = D.TF.find(t => data.frames[t] && data.frames[t].length >= 60); if (alt) { if (c !== undefined) toast(L(`Нет данных для ${tf} — показываю ${alt}`, `No ${tf} data — showing ${alt}`)); tf = alt; c = data.frames[tf]; } }
    $$('#tfSeg button').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));
    if (!c || c.length < 30) { $('#qName').textContent = L('недостаточно данных', 'not enough data'); return; }
    const S = A.prepare(c, tf, SETTINGS.params); S.crypto = data.kind === 'crypto';
    const i = c.length - 1;
    const ev = A.evaluate(S, i, { weights: SETTINGS.weights, longOnly: SETTINGS.longOnly, news: data.news.concat(APP.ownNews || []), deposit: SETTINGS.deposit, riskPct: SETTINGS.riskPct });
    APP.S = S; APP.ev = ev; APP.tf = tf;
    const q = data.quote || {}, x = c[i];
    APP.price = q.price && D.intraday(tf) === false ? q.price : x.c;
    // шапка
    $('#qSym').textContent = data.symbol; $('#qName').textContent = data.name + (data.source === 'demo' ? ' · DEMO' : data.source === 'csv' ? ' · CSV' : '');
    $('#demoNote').classList.toggle('hidden', data.source !== 'demo');
    const prev = D.intraday(tf) ? c[i - 1].c : (q.prevClose || c[i - 1].c), ch = (APP.price / prev - 1) * 100;
    $('#qPrice').textContent = fmt(APP.price);
    $('#qChange').innerHTML = `<span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${fmt(APP.price - prev)} (${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%)</span> <span class="muted small">${D.intraday(tf) ? L('за бар', 'per bar') : L('за сессию', 'session')}</span>`;
    const vp = I.volumeProfile(c, Math.max(0, i - 120), i, 40);
    $('#qStats').innerHTML = [
      ['ATR', fmt(S.atr[i])], ['RSI', fmt(S.rsi[i], 1)], ['VWAP', fmt(S.vwap.v[i])], ['POC', fmt(vp && vp.poc)],
      [L('Фаза рынка', 'Market phase'), A.cyclePhase(S, i)], [L('Объём', 'Volume'), g.fmtV(x.v)],
    ].map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('');
    // сигнал
    const labels = { BUY: L('ПОКУПАТЬ СЕЙЧАС', 'BUY NOW'), SELL: L('ПРОДАВАТЬ', 'SELL'), AVOID: L('НЕ ПОКУПАТЬ (В СТОРОНЕ)', 'DO NOT BUY (STAND ASIDE)'), WAIT: L('ВНЕ РЫНКА (ОЖИДАНИЕ)', 'OUT OF MARKET (WAIT)') };
    const sl = $('#sigLabel'); sl.className = 'sig-label ' + ev.signal; sl.textContent = labels[ev.signal];
    $('#sigConf').textContent = Math.round(ev.conf) + '%'; $('#sigReason').textContent = ev.reason;
    drawGauge(ev.gauge);
    renderCalc();
    // график
    const gusev = C.signals(c, S.atr, S.patterns, SETTINGS.longOnly);
    APP.chart.layers = SETTINGS.layers;
    APP.chart.set(S, { sym: data.symbol, gusev, plan: ev.signal === 'BUY' || ev.signal === 'SELL' ? ev.plan : null, count: D.intraday(tf) ? 160 : 150 });
    renderFactors(ev); renderPlan(ev, S); renderSessions(data, S); renderDensity(S, vp); renderPsy(ev, S); renderPatterns(S, gusev, tf);
    renderEvents(data); renderFeed(data); renderExpert(data, ev, S, tf);
    $('#favToggle').textContent = SETTINGS.favorites.includes(data.symbol) ? '★' : '☆';
    tick();
  }
  APP.render = render;

  function drawGauge(v) {
    const svg = $('#gauge'), cx = 110, cy = 110, r = 90, seg = [[0, 20, '#dc2626'], [20, 40, '#f97316'], [40, 60, '#a3a3a3'], [60, 80, '#84cc16'], [80, 100, '#16a34a']];
    const pt = (val, rr) => { const a = Math.PI * (1 - val / 100); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)]; };
    let h = seg.map(([a, b, col]) => { const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r); return `<path d="M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}" stroke="${col}" stroke-width="16" fill="none"/>`; }).join('');
    const [nx, ny] = pt(v, r - 22);
    h += `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="var(--fg)" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="6" fill="var(--fg)"/>`;
    h += `<text x="${cx}" y="${cy - 28}" text-anchor="middle" font-size="26" font-weight="800" fill="var(--fg)">${Math.round(v)}</text>`;
    h += `<text x="14" y="126" font-size="11" fill="var(--muted)">${L('продавать', 'sell')}</text><text x="206" y="126" font-size="11" text-anchor="end" fill="var(--muted)">${L('покупать', 'buy')}</text>`;
    const lab = v < 20 ? L('Сильно продавать', 'Strong sell') : v < 40 ? L('Продавать', 'Sell') : v <= 60 ? L('Равновесие', 'Neutral') : v <= 80 ? L('Покупать', 'Buy') : L('Сильно покупать', 'Strong buy');
    h += `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="12" fill="var(--muted)">${lab}</text>`;
    svg.innerHTML = h;
  }

  function renderFactors(ev) {
    $('#factors').innerHTML = ev.factors.map(f => {
      const w = Math.abs(f.score) * 50, col = f.score >= 0 ? 'var(--up)' : 'var(--down)';
      return `<div class="factor"><div><b>${esc(f.name)}</b> <span class="muted small">${L('вес', 'w')} ${f.w}</span></div><div class="${f.score >= 0 ? 'up' : 'down'}"><b>${f.score >= 0 ? '+' : ''}${(f.score * f.w).toFixed(1)}</b></div>
        <div class="bar"><i style="left:${f.score >= 0 ? 50 : 50 - w}%;width:${w}%;background:${col}"></i><i style="left:50%;width:1px;background:var(--muted)"></i></div><div class="ftext">${esc(f.text)}</div></div>`;
    }).join('') + `<div class="row"><b>${L('Итого балл', 'Total score')}: <span class="${ev.total >= 0 ? 'up' : 'down'}">${ev.total >= 0 ? '+' : ''}${ev.total.toFixed(1)}</span></b> · ${L('шкала', 'gauge')} ${Math.round(ev.gauge)} · ${L('согласие факторов', 'factor agreement')} ${Math.round(ev.agree * 100)}% · ${L('уверенность', 'confidence')} ${Math.round(ev.conf)}%${ev.against ? ' · ' + L('−12 за разворотную модель против', '−12 for a reversal pattern against') : ''}</div>`;
  }
  function renderPlan(ev, S) {
    const p = ev.plan, dir = p.dir > 0 ? L('покупка', 'long') : L('продажа', 'short');
    const sz = S.crypto ? fmt(p.qty, 4) : fmt(Math.floor(p.qty), 0);
    $('#plan').innerHTML = `<div class="plan-grid">
      <span>${L('Направление', 'Direction')}</span><b>${dir}</b>
      <span>${L('Вход', 'Entry')}</span><b>${fmt(p.entry)}</b>
      <span>${L('Стоп', 'Stop')}</span><b class="down">${fmt(p.stop)} (${fmt(Math.abs(p.entry - p.stop) / p.entry * 100, 2)}%)</b>
      <span>${L('Цель 1', 'Target 1')}</span><b class="up">${fmt(p.t1)} (R/R 1:${fmt(p.rr, 2)})</b>
      <span>${L('Цель 2', 'Target 2')}</span><b class="up">${fmt(p.t2)} (R/R 1:${fmt(p.rr2, 2)})</b>
      <span>${L('Риск на сделку', 'Risk per trade')}</span><b>${fmt(p.riskMoney, 2)} $</b>
      <span>${L('Размер позиции', 'Position size')}</span><b>${sz} ${L('шт.', 'sh')} ≈ ${fmt((S.crypto ? p.qty : Math.floor(p.qty)) * p.entry, 2)} $</b>
      <span>ATR</span><b>${fmt(p.atr)}</b></div>
      <div class="small muted">${p.rr != null && p.rr < SETTINGS.params.minRR ? L(`⚠ R/R ниже ${SETTINGS.params.minRR} — по правилу санпо вход не делаем.`, `⚠ R/R below ${SETTINGS.params.minRR} — sanpo rule: no entry.`) : L('Стоп ставится сразу при входе. Половину позиции фиксируем на цели 1, стоп переносим в безубыток.', 'Place the stop at entry. Take half at target 1, move stop to breakeven.')}</div>`;
  }
  function renderSessions(data, S) {
    const q = data.quote || {}, tz = D.userTZ(), c = S.c;
    if (data.kind === 'crypto') $('#sessions').innerHTML = `<div class="muted">${L('Криптовалюта торгуется круглосуточно, 24/7.', 'Crypto trades 24/7.')}</div>`;
    else {
      const row = (n, p, t, chg) => `<tr><td>${n}</td><td>${fmt(p)}</td><td class="${(chg || 0) >= 0 ? 'up' : 'down'}">${chg != null ? (chg >= 0 ? '+' : '') + fmt(chg, 2) + '%' : '—'}</td><td>${t ? D.fmtDT(t, tz) : '—'}</td></tr>`;
      const reg = q.price || c[c.length - 1].c, pc = q.prevClose;
      $('#sessions').innerHTML = `<table class="tbl"><tr><th>${L('Сессия', 'Session')}</th><th>${L('Цена', 'Price')}</th><th>%</th><th>${L('Последняя сделка', 'Last trade')}</th></tr>
        ${row(L('Премаркет', 'Pre-market'), q.pre, q.preTime, q.preChange != null ? q.preChange : (q.pre && pc ? (q.pre / pc - 1) * 100 : null))}
        ${row(L('Основная', 'Regular'), reg, q.regTime || c[c.length - 1].t, pc ? (reg / pc - 1) * 100 : null)}
        ${row(L('Постмаркет', 'Post-market'), q.post, q.postTime, q.postChange != null ? q.postChange : (q.post && reg ? (q.post / reg - 1) * 100 : null))}</table>
        <div class="small muted">${L('Время — по вашему часовому поясу', 'Times in your time zone')} (${esc(tz)}).</div>`;
    }
    const fv = A.fairValue(data.fundamentals, APP.price); APP.fv = fv;
    if (!fv) { $('#fair').innerHTML = `<div class="muted small">${L('Справедливая стоимость: нет фундаментальных данных', 'Fair value: no fundamentals')}</div>`; return; }
    $('#fair').innerHTML = `<h4>${L('Сводная справедливая цена', 'Blended fair value')}: <b>${fmt(fv.fair)}</b> — <span class="${fv.diff > 0.1 ? 'up' : fv.diff < -0.1 ? 'down' : ''}">${fv.verdict} (${fv.diff >= 0 ? '+' : ''}${fmt(fv.diff * 100, 1)}%)</span></h4>
      <table class="tbl">${fv.parts.map(p => `<tr><td>${esc(L(p.ru, p.en))}</td><td>${p.w}%</td><td>${fmt(p.v)}</td></tr>`).join('')}</table>
      ${data.fundamentals.targetLowPrice ? `<div class="small muted">${L('Цели аналитиков', 'Analyst targets')}: ${fmt(data.fundamentals.targetLowPrice)} – ${fmt(data.fundamentals.targetHighPrice)}, ${L('медиана', 'median')} ${fmt(data.fundamentals.targetMedianPrice)} (${fmt(data.fundamentals.numberOfAnalystOpinions, 0)} ${L('аналитиков', 'analysts')})</div>` : ''}`;
  }
  function renderDensity(S, vp) {
    if (!vp) { $('#density').innerHTML = '—'; return; }
    const price = S.c[S.c.length - 1].c, rows = [];
    vp.vol.forEach((v, k) => rows.push({ p: vp.lo + (k + 0.5) * vp.step, v, buy: vp.buy[k] }));
    const near = rows.sort((a, b) => Math.abs(a.p - price) - Math.abs(b.p - price)).slice(0, 14).sort((a, b) => b.p - a.p);
    const mx = Math.max(...near.map(r => r.v)) || 1;
    $('#density').innerHTML = `<div class="book">${near.map(r => { const ask = r.p > price; const big = r.v > mx * 0.75;
      return `<div class="lv"><span class="${ask ? 'down' : 'up'}">${fmt(r.p)}</span><div class="b" style="width:${r.v / mx * 100}%;background:${ask ? 'rgba(220,38,38,.45)' : 'rgba(22,163,74,.45)'}"></div><span>${g.fmtV(r.v)}${big ? ' ◆' : ''}</span></div>`; }).join('')}</div>
      <div class="small muted">${L('◆ плотность — уровень с крупным объёмом. Выше цены — продавцы (ask), ниже — покупатели (bid). POC', '◆ density — high-volume level. Above price — sellers (ask), below — buyers (bid). POC')} ${fmt(vp.poc)}, ${L('зона стоимости', 'value area')} ${fmt(vp.val)}–${fmt(vp.vah)}.</div>`;
    // индикатор объёма: крупные покупки и продажи за 30 баров
    const c = S.c, n = c.length, big = [];
    for (let j = Math.max(0, n - 30); j < n; j++) if (S.volSma[j] && c[j].v > 1.8 * S.volSma[j]) big.push({ j, buy: c[j].c >= c[j].o, k: c[j].v / S.volSma[j] });
    const bv = big.filter(b => b.buy).length, sv = big.length - bv, d = S.delta.slice(-30).reduce((a, b) => a + b, 0), tv = c.slice(-30).reduce((a, b) => a + b.v, 0);
    $('#volind').innerHTML = `<div>${L('Крупные покупки', 'Large buys')}: <b class="up">${bv}</b> · ${L('крупные продажи', 'large sells')}: <b class="down">${sv}</b> · ${L('дельта 30 баров', '30-bar delta')}: <b class="${d >= 0 ? 'up' : 'down'}">${tv ? fmt(d / tv * 100, 1) : 0}%</b> · CMF <b>${fmt(S.cmf[n - 1], 2)}</b></div>
      <div class="small">${big.slice(-6).reverse().map(b => `<span class="pill ${b.buy ? 'p' : 'n'}">${b.buy ? '▲' : '▼'} ${D.fmtDate(c[b.j].t).slice(0, 5)} ×${b.k.toFixed(1)}</span>`).join('')}</div>`;
  }
  function renderPsy(ev, S) {
    const fg = ev.fg, col = fg < 25 ? 'var(--down)' : fg < 45 ? '#f97316' : fg <= 55 ? 'var(--muted)' : fg <= 75 ? '#84cc16' : 'var(--up)';
    const fl = ev.flow;
    $('#psy').innerHTML = `<div style="font-size:34px;font-weight:800;color:${col}">${fg}</div><div><b>${A.fgLabel(fg)}</b></div>
      <div class="progress"><i style="width:${fg}%;background:${col}"></i></div>
      <div>${L('Фаза цикла', 'Cycle phase')}: <b>${A.cyclePhase(S, S.c.length - 1)}</b></div>
      <div class="small muted">${L('Крупные игроки', 'Big players')}: ${fl.bigN ? (fl.big > 0 ? L('скорее покупают', 'mostly buying') : fl.big < 0 ? L('скорее продают', 'mostly selling') : L('нейтральны', 'neutral')) + ` (${fl.bigN} ${L('всплесков объёма за 20 баров', 'volume spikes in 20 bars')})` : L('всплесков объёма нет', 'no volume spikes')}.
      ${fg > 80 ? L(' Толпа жадничает — время осторожности.', ' Crowd is greedy — time for caution.') : fg < 20 ? L(' Толпа в панике — профессионалы ищут покупки.', ' Crowd panics — pros look for buys.') : ''}</div>`;
  }
  function renderPatterns(S, gusev, tf) {
    const c = S.c, recent = S.patterns.filter(m => m.i >= c.length - 30).reverse().slice(0, 12);
    const st = gusev.stats, last = gusev.points.slice(-1)[0];
    $('#patterns').innerHTML = (recent.length ? `<table class="tbl"><tr><th>${L('Модель', 'Pattern')}</th><th>${L('Дата', 'Date')}</th><th>${L('Место', 'Location')}</th><th>${L('Сила', 'Strength')}</th><th>${L('Подтв.', 'Conf.')}</th></tr>${recent.map(m => `<tr>
      <td class="l ${m.dir > 0 ? 'up' : 'down'}">${m.dir > 0 ? '▲' : '▼'} ${esc(L(C.P[m.key][0], C.P[m.key][1]))}</td><td>${D.intraday(tf) ? D.fmtDT(c[m.i].t) : D.fmtDate(c[m.i].t)}</td>
      <td>${m.placeOk ? '✓ ' + (m.trend > 0 ? L('после роста', 'after rally') : m.trend < 0 ? L('после падения', 'after decline') : L('флэт', 'range')) : L('✗ не на месте', '✗ wrong place')}</td><td>${'●'.repeat(m.strength)}${'○'.repeat(3 - m.strength)}</td>
      <td>${m.confirmed === true ? '✓' : m.confirmed === false ? '✗' : '…'}</td></tr>`).join('')}</table>` : `<div class="muted">${L('За последние 30 свечей моделей нет', 'No patterns in the last 30 candles')}</div>`) +
      `<div class="small" style="margin-top:6px">${L('Точки Гусева на истории', 'Gusev signals on history')}: ${st.trades} ${L('сделок', 'trades')}, ${L('прибыльных', 'winners')} ${st.winRate != null ? Math.round(st.winRate * 100) + '%' : '—'}. ${last ? L('Последняя точка', 'Last signal') + ': <b>' + ({ BUY: L('ПОКУПКА', 'BUY'), SELL: L('ПРОДАЖА', 'SELL'), EXIT: L('ВЫХОД', 'EXIT'), AVOID: L('НЕ ПОКУПАТЬ', 'AVOID') }[last.type]) + '</b> ' + D.fmtDate(c[last.i].t) + ' ' + L('по', 'at') + ' ' + fmt(last.price) + (last.stop ? ', ' + L('стоп', 'stop') + ' ' + fmt(last.stop) : '') : ''}
      ${['1W', '1M'].includes(tf) ? '<br>' + L('Правило «новых максимумов» Сакаты применяется только до дневок.', "Sakata's new-highs rule applies only up to daily.") : ''}</div>`;
  }
  function renderEvents(data) {
    const e = data.events || {}, tz = D.userTZ(), now = Date.now() / 1000, items = [];
    (e.earnings || []).forEach(t => items.push(`📊 ${L('Отчёт', 'Earnings')}: <b>${D.fmtDate(t, tz)}</b>${t > now ? ` (${L('через', 'in')} ${Math.ceil((t - now) / 86400)} ${L('дн.', 'd')})` : ''}`));
    if (e.exDividend) items.push(`💵 ${L('Экс-дивидендная дата', 'Ex-dividend date')}: <b>${D.fmtDate(e.exDividend, tz)}</b>`);
    if (e.dividendDate) items.push(`💵 ${L('Выплата дивиденда', 'Dividend payment')}: <b>${D.fmtDate(e.dividendDate, tz)}</b>`);
    const macro = (g.TABS && g.TABS.macroUpcoming) ? g.TABS.macroUpcoming(7) : [];
    macro.slice(0, 5).forEach(m => items.push(`🏛 ${esc(m.title)}: <b>${D.fmtDate(m.t, tz)}</b>`));
    const f = A.evaluate(APP.S, APP.S.c.length - 1, { news: data.news.concat(APP.ownNews || []), weights: SETTINGS.weights }).factors.find(x => x.key === 'news');
    $('#events').innerHTML = `<div>${items.join('<br>') || L('Событий нет', 'No events')}</div><div class="small" style="margin:6px 0">${L('Фактор новостей', 'News factor')}: <b class="${f.score >= 0 ? 'up' : 'down'}">${f.score >= 0 ? '+' : ''}${f.score.toFixed(2)}</b> — ${esc(f.text)}</div>`;
  }
  function renderFeed(data) {
    const tz = D.userTZ(), list = (APP.ownNews || []).concat(data.news || []);
    $('#feed').innerHTML = list.map(n => { const t = n.userTone != null ? n.userTone : A.tone(n.title);
      return `<div class="news-item"><span class="pill ${t > 0.1 ? 'p' : t < -0.1 ? 'n' : 'z'}">${t > 0.1 ? '+' : t < -0.1 ? '−' : '0'}${Math.abs(t).toFixed(1)}</span>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)}
      <div class="meta">${esc(n.publisher || (n.own ? L('ваш заголовок', 'your headline') : ''))} · ${n.time ? D.fmtDT(n.time, tz) : ''}${n.mentioned === false ? ' · ' + L('бумага не в заголовке — не учитывается', 'not in headline — ignored') : ''}</div></div>`; }).join('') || `<div class="muted">${L('Новостей нет', 'No news')}</div>`;
  }
  function initOwnNews() {
    const parse = () => $('#ownNews').value.split('\n').map(s => s.trim()).filter(Boolean);
    $('#btnRateOwn').onclick = () => {
      const now = Date.now() / 1000; APP.ownNews = parse().map(t => ({ title: t, time: now, own: true, mentioned: true, userTone: A.tone(t) }));
      $('#ownNewsRes').innerHTML = APP.ownNews.map(n => `<div class="small">${n.userTone >= 0 ? '+' : ''}${n.userTone.toFixed(1)} — ${esc(n.title)}</div>`).join(''); render();
    };
    $('#btnRateClaude').onclick = async () => {
      const lines = parse(); if (!lines.length) return;
      $('#ownNewsRes').textContent = L('Claude оценивает…', 'Claude is rating…');
      try {
        const txt = await claude(`Ты — трейдер с 30-летним стажем. Оцени влияние каждого заголовка на акцию ${SETTINGS.sym} по шкале от -1 (очень негативно) до +1 (очень позитивно). Ответь только JSON-массивом чисел той же длины, без пояснений.\n` + lines.map((l, k) => `${k + 1}. ${l}`).join('\n'), 800);
        const arr = JSON.parse(txt.match(/\[[\s\S]*\]/)[0]); const now = Date.now() / 1000;
        APP.ownNews = lines.map((t, k) => ({ title: t, time: now, own: true, mentioned: true, userTone: Math.max(-1, Math.min(1, +arr[k] || 0)) }));
        $('#ownNewsRes').innerHTML = APP.ownNews.map(n => `<div class="small">Claude: ${n.userTone >= 0 ? '+' : ''}${n.userTone.toFixed(2)} — ${esc(n.title)}</div>`).join(''); render();
      } catch (e) { $('#ownNewsRes').textContent = e.message; }
    };
  }
  async function claude(prompt, max = 2000) {
    if (D.server === false) throw new Error(L('Claude работает только через terminal_app.py с ключом ANTHROPIC_API_KEY', 'Claude works only via terminal_app.py with ANTHROPIC_API_KEY'));
    const r = await D.api('/api/claude', { body: { prompt, max_tokens: max } }); return r.text;
  }

  /* ---------------- экспертное резюме и озвучка ---------------- */
  function renderExpert(data, ev, S, tf) {
    const ex = A.expert(data.symbol, ev, S, APP.fv, tfName(tf)); APP.expertText = ex;
    $('#expert').innerHTML = `<p>${esc(ex.text)}</p><p><b>${esc(ex.short)}</b></p><p class="small muted">${esc(ex.disclaimer)}</p>`;
  }
  function initTTS() {
    const fill = () => {
      const lang = $('#ttsLang').value, vs = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith(lang));
      $('#ttsVoice').innerHTML = vs.map((v, k) => `<option value="${k}">${esc(v.name)}</option>`).join('') || `<option>${L('голос по умолчанию', 'default voice')}</option>`;
      APP.voices = vs;
    };
    if (!('speechSynthesis' in g)) { $('.tts').innerHTML = `<span class="muted small">${L('Озвучка не поддерживается браузером', 'Speech not supported by this browser')}</span>`; return; }
    speechSynthesis.onvoiceschanged = fill; fill();
    $('#ttsLang').value = SETTINGS.lang; $('#ttsLang').onchange = fill;
    const speak = async text => {
      speechSynthesis.cancel(); const lang = $('#ttsLang').value, voice = (APP.voices || [])[+$('#ttsVoice').value];
      const pause = (parseFloat($('#ttsPause').value.replace(',', '.')) || 0) * 1000, rate = +$('#ttsRate').value;
      const parts = text.split(/(?<=[.!?])\s+/); APP.ttsStop = false;
      for (const p of parts) {
        if (APP.ttsStop) break;
        await new Promise(res => { const u = new SpeechSynthesisUtterance(p); u.lang = lang === 'ru' ? 'ru-RU' : 'en-US'; if (voice) u.voice = voice; u.rate = rate; u.onend = u.onerror = res; speechSynthesis.speak(u); });
        if (pause) await new Promise(r => setTimeout(r, pause));
      }
    };
    const textFor = lang => { const keep = SETTINGS.lang; SETTINGS.lang = lang; const ex = A.expert(APP.data.symbol, A.evaluate(APP.S, APP.S.c.length - 1, { weights: SETTINGS.weights, longOnly: SETTINGS.longOnly, news: APP.data.news, deposit: SETTINGS.deposit, riskPct: SETTINGS.riskPct }), APP.S, A.fairValue(APP.data.fundamentals, APP.price), tfName(APP.tf)); SETTINGS.lang = keep; return ex.text + ' ' + ex.short; };
    $('#ttsPlay').onclick = () => speak(textFor($('#ttsLang').value));
    $('#ttsStop').onclick = () => { APP.ttsStop = true; speechSynthesis.cancel(); };
    $('#ttsLive').onclick = async () => {
      const lang = $('#ttsLang').value; toast(L('Claude готовит живой пересказ…', 'Claude is preparing a live retelling…'));
      try {
        const txt = await claude((lang === 'ru' ? 'Перескажи живым разговорным языком, как опытный трейдер с 30-летним стажем говорит с учеником, коротко (до 120 слов), на русском. В конце скажи, что это не инвестиционная рекомендация. Текст: ' : 'Retell this in lively spoken English, as a trader with 30 years of experience talking to a student, briefly (under 120 words). End by saying it is not investment advice. Text: ') + textFor(lang), 1200);
        $('#expert').insertAdjacentHTML('beforeend', `<p class="small"><b>Claude:</b> ${esc(txt)}</p>`); speak(txt);
      } catch (e) { toast(e.message); }
    };
  }

  /* ---------------- бэктест ---------------- */
  function initBacktest() {
    $('#btLong').checked = SETTINGS.longOnly;
    const opts = () => ({ commission: parseFloat($('#btComm').value.replace(',', '.')) || 0, slippage: parseFloat($('#btSlip').value.replace(',', '.')) || 0, longOnly: $('#btLong').checked });
    const series = async scope => {
      const list = scope === 'all' ? D.ALL : [SETTINGS.sym], out = [];
      for (const s of list) { const d = await D.load(s), c = d.frames[APP.tf] && d.frames[APP.tf].length > 260 ? d.frames[APP.tf] : d.frames['1D']; if (!c || c.length < 260) continue; const S = A.prepare(c, c === d.frames[APP.tf] ? APP.tf : '1D', SETTINGS.params); S.sym = s; out.push(S); }
      return out;
    };
    $('#btnBT').onclick = async () => {
      const scope = $('#btScope').value; $('#btRes').innerHTML = `<div class="muted">${L('Считаю…', 'Computing…')}</div><div class="progress"><i id="btProg" style="width:0"></i></div>`;
      await new Promise(r => setTimeout(r, 30));
      const list = await series(scope), res = [];
      for (let k = 0; k < list.length; k++) { const st = A.backtest(list[k], { ...opts(), weights: SETTINGS.weights }); st.sym = list[k].sym; st.tf = list[k].tf; res.push(st); const p = $('#btProg'); if (p) p.style.width = ((k + 1) / list.length * 100) + '%'; await new Promise(r => setTimeout(r, 0)); }
      const all = A.btStats(res.flatMap(r => r.trades), 0);
      APP.btLast = { all, res };
      $('#btRes').innerHTML = btHTML(all, res);
    };
    $('#btnOpt').onclick = async () => {
      const list = await series($('#btScope').value); if (!list.length) return;
      $('#btRes').innerHTML = `<div class="muted">${L('Подбираю веса факторов…', 'Tuning factor weights…')}</div><div class="progress"><i id="optProg" style="width:0"></i></div>`;
      const base = A.backtest(list[0], { ...opts(), weights: SETTINGS.weights });
      void base;
      const r = await A.optimizeWeights(list, SETTINGS.weights, { ...opts(), iters: list.length > 5 ? 16 : 30 }, (k, n) => { const p = $('#optProg'); if (p) p.style.width = (k / n * 100) + '%'; });
      APP.optWeights = r.weights; $('#btnOptApply').disabled = false;
      $('#btRes').innerHTML = `<div>${L('Найденные веса', 'Found weights')} (${L('сумма R', 'total R')} ${r.value.toFixed(1)}):</div><div class="small">${A.FACTORS.map(f => `${L(f.ru, f.en)}: <b>${SETTINGS.weights[f.key]} → ${r.weights[f.key]}</b>`).join(' · ')}</div><div class="small muted">${L('Осторожно: подгонка под историю может не работать в будущем.', 'Caution: curve-fitting may not work in the future.')}</div>`;
    };
    $('#btnOptApply').onclick = () => { if (!APP.optWeights) return; SETTINGS.weights = APP.optWeights; save(); APP.daily = {}; render(); renderFav(); toast(L('Веса применены', 'Weights applied')); };
    $('#btnOptReset').onclick = () => { SETTINGS.weights = A.defaultWeights(); save(); APP.daily = {}; render(); renderFav(); toast(L('Веса сброшены', 'Weights reset')); };
  }
  function btHTML(all, res) {
    const v = { yes: L('✅ Стоит брать: сигнал прошёл проверки', '✅ Worth taking: the signal passed the checks'), maybe: L('⚠ С осторожностью: часть проверок не пройдена', '⚠ With caution: some checks failed'), no: L('⛔ Не стоит брать: сигнал не прошёл проверки', '⛔ Not worth taking: the signal failed the checks') }[all.verdict];
    let eq = 0; const pts = all.trades.sort((a, b) => a.t - b.t).map(t => (eq += t.r));
    const mn = Math.min(0, ...pts), mx = Math.max(0.1, ...pts), w = 600, h = 120;
    const path = pts.map((p, k) => `${k ? 'L' : 'M'}${(k / Math.max(1, pts.length - 1) * w).toFixed(1)} ${(h - (p - mn) / (mx - mn) * h).toFixed(1)}`).join(' ');
    const cur = APP.ev, same = all.trades.filter(t => cur && ((cur.signal === 'BUY' && t.dir > 0) || (cur.signal === 'SELL' && t.dir < 0)));
    const sameWr = same.length ? same.filter(t => t.r > 0).length / same.length : null;
    return `<div class="verdict ${all.verdict}">${v} (${all.score}/6)</div>
      <div class="row wrap"><b>${L('Итог', 'Result')}: <span class="${all.sumR >= 0 ? 'up' : 'down'}">${all.sumR >= 0 ? '+' : ''}${all.sumR.toFixed(1)}R</span></b> · ${L('сделок', 'trades')} ${all.n} · ${L('прибыльных', 'win rate')} ${(all.winRate * 100).toFixed(0)}% · PF ${all.pf.toFixed(2)} · ${L('ожидание', 'expectancy')} ${all.exp.toFixed(2)}R · ${L('макс. просадка', 'max DD')} ${all.maxDD.toFixed(1)}R</div>
      <div class="checks">${all.checks.map(c => `<div>${c.ok ? '✅' : '❌'} ${L(c.ru, c.en)}</div>`).join('')}</div>
      <svg class="eqcurve" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${h - (0 - mn) / (mx - mn) * h}" y2="${h - (0 - mn) / (mx - mn) * h}" stroke="var(--line)"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>
      <div class="small">${L('Индикатор по данным бэктеста', 'Backtest-based indicator')}: ${cur && sameWr != null ? L(`текущий сигнал исторически срабатывал в ${(sameWr * 100).toFixed(0)}% случаев (${same.length} сделок)`, `the current signal historically worked ${(sameWr * 100).toFixed(0)}% of the time (${same.length} trades)`) : L('для текущего сигнала нет сделок в истории', 'no historical trades for the current signal')}</div>
      ${res.length > 1 ? `<details open><summary>${L('Раскрытие по тикерам', 'Per-ticker breakdown')}</summary><div class="tablewrap"><table class="tbl"><tr><th>${L('Тикер', 'Ticker')}</th><th>TF</th><th>${L('Сделок', 'Trades')}</th><th>${L('Прибыльных', 'Win %')}</th><th>PF</th><th>R</th><th>${L('Вердикт', 'Verdict')}</th></tr>
      ${res.sort((a, b) => b.sumR - a.sumR).map(r => `<tr><td><a href="#" data-open="${r.sym}">${r.sym}</a></td><td>${r.tf}</td><td>${r.n}</td><td>${(r.winRate * 100).toFixed(0)}%</td><td>${r.pf.toFixed(2)}</td><td class="${r.sumR >= 0 ? 'up' : 'down'}">${r.sumR.toFixed(1)}</td><td>${{ yes: '✅', maybe: '⚠', no: '⛔' }[r.verdict]} ${r.score}/6</td></tr>`).join('')}</table></div></details>` : ''}
      <div class="small muted">${L('Вход на открытии следующего бара, выход по стопу, цели 1, смене сигнала или через 20 баров. Новости в бэктесте не учитываются.', 'Entry at next bar open; exit at stop, target 1, signal flip or after 20 bars. News ignored in backtest.')}</div>`;
  }

  /* ---------------- параметры ---------------- */
  function initSettings() {
    const labels = { ichiT: 'Ишимоку Tenkan', ichiK: 'Ишимоку Kijun', ichiS: 'Ишимоку Senkou B', bbN: 'Боллинджер период', bbK: 'Боллинджер σ', ema: 'EMA', sma50: 'SMA средняя', sma200: 'SMA длинная', vwapN: 'VWAP (D+) баров', cmfN: 'CMF период', atrN: 'ATR период', rsiN: 'RSI период', buyTh: 'Порог ПОКУПАТЬ', sellTh: 'Порог ПРОДАВАТЬ', confTh: 'Мин. уверенность %', minRR: 'Мин. риск/прибыль', gusevPenalty: 'Штраф Гусева', pivotK: 'Баров для разворота' };
    const open = () => {
      $('#settingsForm').innerHTML = Object.keys(A.DEFAULT_PARAMS).map(k => `<label>${labels[k] || k} <input data-p="${k}" value="${SETTINGS.params[k]}"></label>`).join('') +
        `<label>${L('Своя комиссия $/акц.', 'Custom fee $/sh')} <input data-c="perShare" value="${SETTINGS.custom.perShare}"></label><label>${L('Своя мин. $', 'Custom min $')} <input data-c="min" value="${SETTINGS.custom.min}"></label><label>${L('Своя комиссия %', 'Custom fee %')} <input data-c="pct" value="${SETTINGS.custom.pct}"></label>`;
      $('#weightsForm').innerHTML = A.FACTORS.map(f => `<label>${L(f.ru, f.en)} <input data-w="${f.key}" value="${SETTINGS.weights[f.key]}"></label>`).join('');
      $('#tzInput').value = SETTINGS.tz; $('#settingsModal').classList.remove('hidden');
    };
    $('#btnSettings').onclick = open;
    $('#sClose').onclick = () => $('#settingsModal').classList.add('hidden');
    $('#sSave').onclick = () => {
      $$('#settingsForm [data-p]').forEach(i => { const v = parseFloat(i.value.replace(',', '.')); if (isFinite(v)) SETTINGS.params[i.dataset.p] = v; });
      $$('#settingsForm [data-c]').forEach(i => { const v = parseFloat(i.value.replace(',', '.')); if (isFinite(v)) SETTINGS.custom[i.dataset.c] = v; });
      $$('#weightsForm [data-w]').forEach(i => { const v = parseFloat(i.value.replace(',', '.')); if (isFinite(v)) SETTINGS.weights[i.dataset.w] = v; });
      const tz = $('#tzInput').value.trim(); try { new Intl.DateTimeFormat('en', { timeZone: tz }); SETTINGS.tz = tz; } catch (e) { toast(L('Неверный часовой пояс', 'Invalid time zone')); }
      save(); APP.daily = {}; $('#settingsModal').classList.add('hidden'); render(); renderFav(); toast(L('Параметры сохранены', 'Settings saved'));
    };
    $('#sReset').onclick = () => { SETTINGS.params = { ...A.DEFAULT_PARAMS }; SETTINGS.weights = A.defaultWeights(); SETTINGS.tz = 'Asia/Jerusalem'; save(); open(); APP.daily = {}; render(); };
  }

  /* ---------------- старт ---------------- */
  async function start() {
    APP.chart = new g.Chart($('#chart'), $('#legend'));
    applyTheme(); setInterval(applyTheme, 5 * 60 * 1000);
    applyLang(); fillBrokers(); $('#calcBroker').value = SETTINGS.broker;
    initTips(); initSearch(); initTerminalControls(); initOwnNews(); initTTS(); initBacktest(); initSettings();
    $('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };
    $('#btnRefresh').onclick = refresh;
    $('#themeSel').onchange = e => { SETTINGS.theme = e.target.value; save(); applyTheme(); };
    $('#langSel').onchange = e => { SETTINGS.lang = e.target.value; save(); applyLang(); fillBrokers(); APP.drawLayers(); APP.daily = {}; render(); renderFav(); const t = SETTINGS.tab; if (t && t !== 'terminal' && g.TABS[t]) g.TABS[t](); };
    document.addEventListener('click', e => { const a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); showTab('terminal'); openTicker(a.dataset.open); } });
    setInterval(tick, 15000);
    const st = await updateStatus();
    if (st && st.jobs.refresh.running) { $('#btnRefresh').disabled = true; refresh.poll = setInterval(async () => { const s = await updateStatus(); if (!s.jobs.refresh.running) { clearInterval(refresh.poll); $('#btnRefresh').disabled = false; D.invalidate(); openTicker(SETTINGS.sym); } }, 3000); }
    renderStrip();
    await openTicker(SETTINGS.sym);
    if (SETTINGS.tab && SETTINGS.tab !== 'terminal') showTab(SETTINGS.tab);
    renderFav();
  }
  APP.start = start;
  document.addEventListener('DOMContentLoaded', () => { if (!g.TABS) g.TABS = {}; start().catch(e => { console.error(e); toast('Ошибка: ' + e.message, 8000); }); });
})(window);

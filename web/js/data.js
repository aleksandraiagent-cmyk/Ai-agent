/* Данные: сервер (yfinance), демо-генератор, CSV, пересборка таймфреймов, время и сессии. */
(function (g) {
  'use strict';
  const D = {};
  D.STOCKS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NFLX', 'AMD', 'INTC', 'JPM', 'BA', 'KO', 'XOM', 'V', 'DIS', 'SPY', 'QQQ', 'TEVA', 'CHKP', 'SEDG', 'TSEM', 'SPCX'];
  D.CRYPTO = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'];
  D.ALL = D.STOCKS.concat(D.CRYPTO);
  D.ANALYST = D.STOCKS.filter(s => s !== 'SPY' && s !== 'QQQ');
  D.NAMES = { AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', TSLA: 'Tesla', AMZN: 'Amazon', GOOGL: 'Alphabet', META: 'Meta Platforms', NFLX: 'Netflix', AMD: 'AMD', INTC: 'Intel', JPM: 'JPMorgan Chase', BA: 'Boeing', KO: 'Coca-Cola', XOM: 'Exxon Mobil', V: 'Visa', DIS: 'Disney', SPY: 'SPDR S&P 500 ETF', QQQ: 'Invesco QQQ', TEVA: 'Teva Pharmaceutical', CHKP: 'Check Point Software', SEDG: 'SolarEdge', TSEM: 'Tower Semiconductor', SPCX: 'SPCX', BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB', DOGE: 'Dogecoin' };
  D.SECTORS = { AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology', AMD: 'Technology', INTC: 'Technology', CHKP: 'Technology', TSEM: 'Technology', SEDG: 'Technology', TSLA: 'Consumer Cyclical', AMZN: 'Consumer Cyclical', GOOGL: 'Communication Services', META: 'Communication Services', NFLX: 'Communication Services', DIS: 'Communication Services', JPM: 'Financial Services', V: 'Financial Services', BA: 'Industrials', KO: 'Consumer Defensive', XOM: 'Energy', TEVA: 'Healthcare', SPCX: 'Financial Services' };
  D.isCrypto = s => D.CRYPTO.includes(s) || /-USD$/.test(s);

  /* ---------- часовые пояса ---------- */
  D.userTZ = () => (g.SETTINGS && SETTINGS.tz) || 'Asia/Jerusalem';
  const fmtCache = {};
  function parts(t, tz) {
    const key = tz; if (!fmtCache[key]) fmtCache[key] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    const o = {}; fmtCache[key].formatToParts(new Date(t * 1000)).forEach(p => o[p.type] = p.value);
    return { y: +o.year, m: +o.month, d: +o.day, H: +o.hour % 24, M: +o.minute, S: +o.second, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
  }
  D.parts = parts;
  D.dayKey = (t, tz) => { const p = parts(t, tz); return p.y * 10000 + p.m * 100 + p.d; };
  D.nyDay = t => D.dayKey(t, 'America/New_York');
  /* смещение пояса (сек) для момента t */
  D.tzOffset = (t, tz) => { const p = parts(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) / 1000 - Math.floor(t); };
  /* unix-время для локальной даты/времени в поясе */
  D.zonedTime = (y, m, d, H, M, tz) => { let t = Date.UTC(y, m - 1, d, H, M) / 1000; t -= D.tzOffset(t, tz); t = Date.UTC(y, m - 1, d, H, M) / 1000 - D.tzOffset(t, tz); return t; };
  const pad = n => String(n).padStart(2, '0');
  D.fmtTime = (t, tz = D.userTZ()) => { const p = parts(t, tz); return pad(p.H) + ':' + pad(p.M); };
  D.fmtDate = (t, tz = D.userTZ()) => { const p = parts(t, tz); return pad(p.d) + '.' + pad(p.m) + '.' + p.y; };
  D.fmtDT = (t, tz = D.userTZ()) => t ? D.fmtDate(t, tz) + ' ' + D.fmtTime(t, tz) : '—';

  /* ---------- биржевой календарь NYSE/Nasdaq ---------- */
  D.HOLIDAYS = {
    '2025-01-01': 'Новый год', '2025-01-09': 'День траура (Картер)', '2025-01-20': 'День Мартина Лютера Кинга', '2025-02-17': 'День президентов', '2025-04-18': 'Страстная пятница', '2025-05-26': 'День памяти', '2025-06-19': 'Джуннтин', '2025-07-04': 'День независимости', '2025-09-01': 'День труда', '2025-11-27': 'День благодарения', '2025-12-25': 'Рождество',
    '2026-01-01': 'Новый год', '2026-01-19': 'День Мартина Лютера Кинга', '2026-02-16': 'День президентов', '2026-04-03': 'Страстная пятница', '2026-05-25': 'День памяти', '2026-06-19': 'Джуннтин', '2026-07-03': 'День независимости (перенос)', '2026-09-07': 'День труда', '2026-11-26': 'День благодарения', '2026-12-25': 'Рождество',
    '2027-01-01': 'Новый год', '2027-01-18': 'День Мартина Лютера Кинга', '2027-02-15': 'День президентов', '2027-03-26': 'Страстная пятница', '2027-05-31': 'День памяти', '2027-06-18': 'Джуннтин (перенос)', '2027-07-05': 'День независимости (перенос)', '2027-09-06': 'День труда', '2027-11-25': 'День благодарения', '2027-12-24': 'Рождество (перенос)',
  };
  D.HOLIDAYS_EN = { 'Новый год': "New Year's Day", 'День Мартина Лютера Кинга': 'Martin Luther King Jr. Day', 'День президентов': "Presidents' Day", 'Страстная пятница': 'Good Friday', 'День памяти': 'Memorial Day', 'Джуннтин': 'Juneteenth', 'Джуннтин (перенос)': 'Juneteenth (observed)', 'День независимости': 'Independence Day', 'День независимости (перенос)': 'Independence Day (observed)', 'День труда': 'Labor Day', 'День благодарения': 'Thanksgiving', 'Рождество': 'Christmas', 'Рождество (перенос)': 'Christmas (observed)', 'День траура (Картер)': 'National Day of Mourning' };
  D.EARLY = { '2025-07-03': 'Сокращённый день', '2025-11-28': 'Сокращённый день', '2025-12-24': 'Сокращённый день', '2026-11-27': 'Сокращённый день', '2026-12-24': 'Сокращённый день', '2027-11-26': 'Сокращённый день' };
  D.isoDay = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  D.isTradingDay = (y, m, d) => { const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return wd !== 0 && wd !== 6 && !D.HOLIDAYS[D.isoDay(y, m, d)]; };
  /* Состояние биржи США на момент t: pre / regular / post / closed + следующее событие */
  D.marketState = (t = Date.now() / 1000) => {
    const p = parts(t, 'America/New_York'), iso = D.isoDay(p.y, p.m, p.d), mins = p.H * 60 + p.M;
    const trading = D.isTradingDay(p.y, p.m, p.d), early = !!D.EARLY[iso];
    const close = early ? 13 * 60 : 16 * 60, postEnd = early ? 17 * 60 : 20 * 60;
    let state = 'closed';
    if (trading) { if (mins >= 240 && mins < 570) state = 'pre'; else if (mins >= 570 && mins < close) state = 'regular'; else if (mins >= close && mins < postEnd) state = 'post'; }
    // следующее открытие премаркета
    let next = null;
    if (state === 'closed') {
      for (let k = 0; k < 10; k++) {
        const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + k)); const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
        if (!D.isTradingDay(y, m, d)) continue;
        const s = D.zonedTime(y, m, d, 4, 0, 'America/New_York'); if (s > t) { next = s; break; }
      }
    } else {
      const ends = { pre: 570, regular: close, post: postEnd }[state];
      next = D.zonedTime(p.y, p.m, p.d, Math.floor(ends / 60), ends % 60, 'America/New_York');
    }
    return { state, next, early, nyMinutes: mins };
  };

  /* ---------- пересборка таймфреймов ---------- */
  function agg(group) {
    const o = group[0], r = { t: o.t, o: o.o, h: -Infinity, l: Infinity, c: group[group.length - 1].c, v: 0 };
    group.forEach(x => { if (x.h > r.h) r.h = x.h; if (x.l < r.l) r.l = x.l; r.v += x.v; });
    return r;
  }
  D.resample = (c, keyFn) => {
    const out = []; let cur = [], k = null;
    c.forEach(x => { const kk = keyFn(x.t); if (kk !== k && cur.length) { out.push(agg(cur)); cur = []; } k = kk; cur.push(x); });
    if (cur.length) out.push(agg(cur));
    return out;
  };
  D.toCandles = arr => (arr || []).map(a => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] || 0 }));
  /* Все таймфреймы из базовых рядов */
  D.buildFrames = (raw, crypto) => {
    const c5 = D.toCandles(raw['5m']), c1h = D.toCandles(raw['1h']), c1d = D.toCandles(raw['1d']), cmo = D.toCandles(raw['1mo']);
    const f = { '5m': c5, '1h': c1h, '1D': c1d };
    f['15m'] = D.resample(c5, t => Math.floor(t / 900));
    if (crypto) f['4h'] = D.resample(c1h, t => Math.floor(t / 14400));
    else f['4h'] = D.resample(c1h, t => { const p = parts(t, 'America/New_York'); return D.isoDay(p.y, p.m, p.d) + (p.H * 60 + p.M < 13 * 60 + 30 ? 'a' : 'b'); });
    f['1W'] = D.resample(c1d, t => Math.floor((Math.floor(t / 86400) + 3) / 7)); // недели с понедельника
    f['1M'] = cmo.length ? cmo : D.resample(c1d, t => { const p = parts(t, 'UTC'); return p.y * 100 + p.m; });
    return f;
  };
  D.TF = ['5m', '15m', '1h', '4h', '1D', '1W', '1M'];
  D.TF_SEC = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400, '1W': 604800, '1M': 2592000 };
  D.intraday = tf => ['5m', '15m', '1h', '4h'].includes(tf);

  /* ---------- демо-генератор (когда нет данных Yahoo) ---------- */
  function rng(seed) { let s = 0; for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const gauss = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const BASE = { AAPL: 230, MSFT: 480, NVDA: 180, TSLA: 400, AMZN: 220, GOOGL: 250, META: 700, NFLX: 1150, AMD: 220, INTC: 35, JPM: 300, BA: 220, KO: 70, XOM: 115, V: 350, DIS: 115, SPY: 670, QQQ: 600, TEVA: 20, CHKP: 200, SEDG: 35, TSEM: 75, SPCX: 25, BTC: 104000, ETH: 3600, SOL: 170, XRP: 2.4, BNB: 1000, DOGE: 0.19 };
  D.demo = (sym) => {
    const r = rng(sym), crypto = D.isCrypto(sym), now = Math.floor(Date.now() / 1000);
    const vol = crypto ? 0.035 : 0.019, base = BASE[sym] || 50 + r() * 200;
    const days = 365 * 5 + 60, daily = [];
    // строим дневной ряд назад от текущей цены
    let p = base, drift = (r() - 0.45) * 0.0012, regime = 0;
    const closes = [p];
    for (let i = 1; i < days; i++) { if (i % 60 === 0) regime = (r() - 0.5) * 0.004; p = p / Math.exp(drift + regime + vol * gauss(r)); closes.push(p); }
    closes.reverse();
    const dayStart = Math.floor(now / 86400) * 86400; let k = 0;
    for (let i = days - 1; i >= 0; i--) {
      const t = dayStart - i * 86400, wd = new Date(t * 1000).getUTCDay();
      if (!crypto && (wd === 0 || wd === 6)) { k++; continue; }
      const c = closes[k++], o = (daily.length ? daily[daily.length - 1].c : c) * (1 + vol * 0.3 * gauss(r));
      const h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * vol * 0.5), l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * vol * 0.5);
      const v = Math.round((crypto ? 3e4 : 2e7) * (base > 1000 ? 1 : 1) * (0.6 + r()) * (1 + Math.abs(c - o) / c / vol));
      daily.push({ t: crypto ? t : t + 13.5 * 3600, o, h, l, c, v });
    }
    // внутридневные ряды из дневных (броуновский мост)
    const intra = (stepSec, nDays) => {
      const out = [], last = daily.slice(-nDays);
      last.forEach(d => {
        const start = crypto ? d.t : d.t, n = crypto ? 86400 / stepSec : Math.round(6.5 * 3600 / stepSec);
        let price = d.o; const target = d.c;
        for (let j = 0; j < n; j++) {
          const remain = n - j, step = (target - price) / remain + price * vol / Math.sqrt(n) * gauss(r) * 0.8;
          const o = price, c = j === n - 1 ? target : price + step;
          const h = Math.min(d.h, Math.max(o, c) * (1 + Math.abs(gauss(r)) * vol / Math.sqrt(n) * 0.4)), l = Math.max(d.l, Math.min(o, c) * (1 - Math.abs(gauss(r)) * vol / Math.sqrt(n) * 0.4));
          const u = j / n, vv = d.v / n * (1.6 - Math.sin(Math.PI * u)) * (0.5 + r());
          out.push({ t: start + j * stepSec, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: Math.round(vv) });
          price = c;
        }
      });
      return out;
    };
    const tz = 'America/New_York';
    const fixStart = arr => crypto ? arr : arr; // дневные уже на 9:30 NY (13:30 UTC приблизительно)
    const c1h = fixStart(intra(3600, 730)), c5 = fixStart(intra(300, 30));
    const pack = a => a.map(x => [x.t, x.o, x.h, x.l, x.c, x.v]);
    const price = daily[daily.length - 1].c, prev = daily[daily.length - 2].c;
    const up = 1 + (r() - 0.35) * 0.4;
    void tz;
    return {
      symbol: sym, name: D.NAMES[sym] || sym, kind: crypto ? 'crypto' : 'stock', demo: true,
      candles: { '1d': pack(daily), '1h': pack(c1h), '5m': pack(c5), '1mo': [] },
      quote: { price, prevClose: prev, regTime: daily[daily.length - 1].t, pre: crypto ? null : price * (1 + (r() - 0.5) * 0.01), preTime: now - 3600 * 5, post: crypto ? null : price * (1 + (r() - 0.5) * 0.008), postTime: now - 3600 * 2, currency: 'USD' },
      fundamentals: crypto ? {} : {
        targetMeanPrice: price * up, targetMedianPrice: price * up * 0.99, targetLowPrice: price * up * 0.75, targetHighPrice: price * up * 1.3,
        numberOfAnalystOpinions: Math.round(8 + r() * 40), recommendationKey: up > 1.15 ? 'buy' : up > 1 ? 'hold' : 'underperform', recommendationMean: 3.2 - (up - 1) * 6,
        trailingEps: price / (18 + r() * 25), forwardEps: price / (16 + r() * 20), earningsGrowth: (r() - 0.2) * 0.3, bookValue: price / (3 + r() * 10),
        freeCashflow: price * 1e8 * (0.3 + r()), sharesOutstanding: 2e9 * (0.5 + r()), sector: D.SECTORS[sym], fiftyTwoWeekHigh: Math.max(...daily.slice(-252).map(x => x.h)), fiftyTwoWeekLow: Math.min(...daily.slice(-252).map(x => x.l)),
      },
      events: crypto ? {} : { earnings: [now + Math.round(5 + r() * 80) * 86400], exDividend: r() > 0.5 ? now + Math.round(r() * 60) * 86400 : null },
      news: demoNews(sym, r, now), updated: now, source: 'demo',
    };
  };
  function demoNews(sym, r, now) {
    const n = D.NAMES[sym] || sym, tpl = [
      `${n} shares rise after strong quarterly results`, `${sym} gains as analysts raise price target`, `${n} faces regulatory probe, stock slips`,
      `Why ${n} stock is moving today`, `${n} announces new product line, investors optimistic`, `${sym}: options traders bet on volatility ahead of earnings`,
      `${n} downgraded on valuation concerns`, `${n} hits record high`];
    const out = []; for (let i = 0; i < 6; i++) out.push({ title: tpl[Math.floor(r() * tpl.length)], publisher: 'Demo', time: now - Math.round(r() * 6 * 86400), link: '', mentioned: true });
    return out.sort((a, b) => b.time - a.time);
  }

  /* ---------- CSV: дата, открытие, максимум, минимум, закрытие, объём ---------- */
  D.parseCSV = (text, sym = 'CSV') => {
    const lines = text.trim().split(/\r?\n/); const rows = [];
    const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
    lines.forEach((ln, idx) => {
      const f = ln.split(sep).map(s => s.trim().replace(/^"|"$/g, ''));
      if (f.length < 5) return;
      let t = Date.parse(f[0]);
      if (isNaN(t)) { const m = f[0].match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/); if (m) t = Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)); }
      if (isNaN(t)) { if (idx === 0) return; t = +f[0] * (f[0].length > 11 ? 1 : 1000); }
      const num = s => parseFloat(String(s).replace(',', '.'));
      const o = num(f[1]), h = num(f[2]), l = num(f[3]), c = num(f[4]), v = num(f[5] || 0) || 0;
      if ([o, h, l, c].some(isNaN)) return;
      rows.push([Math.floor(t / 1000), o, h, l, c, v]);
    });
    rows.sort((a, b) => a[0] - b[0]);
    if (rows.length < 30) throw new Error('В CSV меньше 30 строк');
    const step = rows.length > 2 ? rows[rows.length - 1][0] - rows[rows.length - 2][0] : 86400;
    const candles = { '1d': [], '1h': [], '5m': [], '1mo': [] };
    if (step < 3600) candles['5m'] = rows; else if (step < 86400) candles['1h'] = rows; else candles['1d'] = rows;
    const last = rows[rows.length - 1];
    return { symbol: sym, name: sym + ' (CSV)', kind: 'stock', csv: true, candles, quote: { price: last[4], prevClose: rows[rows.length - 2][4] }, fundamentals: {}, events: {}, news: [], updated: Math.floor(Date.now() / 1000), source: 'csv' };
  };

  /* ---------- сервер ---------- */
  D.server = null; // null — неизвестно, true/false
  D.api = async (path, opts = {}) => {
    const r = await fetch(path, { method: opts.body ? 'POST' : (opts.method || 'GET'), headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.data = j; throw e; }
    return j;
  };
  D.status = async () => { try { const s = await D.api('/api/status'); D.server = true; return s; } catch (e) { D.server = false; return null; } };
  D.cache = {};
  D.load = async (sym) => {
    if (D.cache[sym]) return D.cache[sym];
    let data = null;
    if (D.server !== false) { try { data = await D.api('/api/data?ticker=' + encodeURIComponent(sym)); if (data.error) data = null; } catch (e) { if (e.status === undefined) D.server = false; } }
    if (!data) data = D.demo(sym);
    data.frames = D.buildFrames(data.candles, data.kind === 'crypto');
    D.cache[sym] = data;
    return data;
  };
  D.put = (data) => { data.frames = D.buildFrames(data.candles, data.kind === 'crypto'); D.cache[data.symbol] = data; return data; };
  D.invalidate = () => { D.cache = {}; };

  g.DATA = D;
})(window);

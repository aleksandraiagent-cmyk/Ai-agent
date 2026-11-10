/* Методика: 9 факторов с весами → балл −100…+100 → сигнал, уверенность, план сделки, мнение трейдера. */
(function (g) {
  'use strict';
  const I = g.IND, C = g.CANDLES;
  const A = {};
  const L = (ru, en) => (g.SETTINGS && SETTINGS.lang === 'en') ? en : ru;
  A.L = L;

  A.FACTORS = [
    { key: 'ichimoku', w: 18, ru: 'Облако Ишимоку', en: 'Ichimoku cloud' },
    { key: 'ma', w: 14, ru: 'Скользящие средние', en: 'Moving averages' },
    { key: 'bb', w: 10, ru: 'Линии Боллинджера', en: 'Bollinger Bands' },
    { key: 'vwap', w: 10, ru: 'VWAP ±1σ/±2σ', en: 'VWAP ±1σ/±2σ' },
    { key: 'flow', w: 12, ru: 'Поток денег / Time & Sales', en: 'Money flow / Time & Sales' },
    { key: 'levels', w: 12, ru: 'Уровни и ликвидность', en: 'Levels & liquidity' },
    { key: 'candles', w: 14, ru: 'Японские свечи (Гусев)', en: 'Candlesticks (Gusev)' },
    { key: 'news', w: 5, ru: 'Новости', en: 'News' },
    { key: 'psy', w: 5, ru: 'Психология рынка', en: 'Market psychology' },
  ];
  A.DEFAULT_PARAMS = {
    ichiT: 9, ichiK: 26, ichiS: 52, bbN: 20, bbK: 2, ema: 20, sma50: 50, sma200: 200, vwapN: 20, cmfN: 20, atrN: 14, rsiN: 14,
    buyTh: 22, sellTh: -22, confTh: 55, minRR: 1.3, gusevPenalty: 12, pivotK: 3,
  };
  A.defaultWeights = () => Object.fromEntries(A.FACTORS.map(f => [f.key, f.w]));
  const fmt = (x, d) => x == null || !isFinite(x) ? '—' : (+x).toFixed(d == null ? (Math.abs(x) >= 1000 ? 0 : Math.abs(x) >= 1 ? 2 : 4) : d);
  A.fmt = fmt;

  /* ---------- предварительный расчёт рядов ---------- */
  A.prepare = (c, tf, P = A.DEFAULT_PARAMS) => {
    const cl = c.map(x => x.c), intr = g.DATA.intraday(tf);
    const S = { c, tf, P, intraday: intr };
    S.atr = I.atr(c, P.atrN); S.rsi = I.rsi(cl, P.rsiN);
    S.ema20 = I.ema(cl, P.ema); S.sma50 = I.sma(cl, P.sma50); S.sma200 = I.sma(cl, P.sma200);
    S.bb = I.bollinger(cl, P.bbN, P.bbK);
    S.ichi = I.ichimoku(c, P.ichiT, P.ichiK, P.ichiS);
    S.vwap = I.vwap(c, intr && tf !== '4h', P.vwapN, t => g.DATA.nyDay(t));
    S.cmf = I.cmf(c, P.cmfN); S.obv = I.obv(c); S.obvSma = I.sma(S.obv, 20); S.delta = I.delta(c);
    S.volSma = I.sma(c.map(x => x.v || 0), 20);
    S.piv = I.pivots(c, tf === '1M' || tf === '1W' ? 2 : P.pivotK);
    S.bwRank = S.bb.bw.map((b, i) => { if (b == null || i < 120) return null; let n = 0, k = 0; for (let j = i - 120; j < i; j++) if (S.bb.bw[j] != null) { k++; if (S.bb.bw[j] < b) n++; } return k ? n / k : null; });
    S.patterns = C.scan(c, S.atr, { sakata: true, newHighs: !['1W', '1M'].includes(tf) });
    return S;
  };

  /* ---------- отдельные факторы (оценка −1…+1 и пояснение) ---------- */
  function fIchimoku(S, i) {
    const { ichi, c } = S, x = c[i], a = ichi.spanA[i], b = ichi.spanB[i], t = ichi.ten[i], k = ichi.kij[i];
    if (a == null || b == null || t == null) return { score: 0, text: L('недостаточно истории', 'not enough history') };
    const top = Math.max(a, b), bot = Math.min(a, b);
    const pos = x.c > top ? 1 : x.c < bot ? -1 : 0;
    const tk = t > k ? 1 : t < k ? -1 : 0;
    const fa = ichi.rawA[i], fb = ichi.rawB[i], fut = fa != null && fb != null ? (fa > fb ? 1 : -1) : 0;
    const ch = i >= S.ichi.shift ? (x.c > c[i - S.ichi.shift].c ? 1 : -1) : 0;
    const score = 0.4 * pos + 0.2 * tk + 0.2 * fut + 0.2 * ch;
    const text = L(
      `цена ${pos > 0 ? 'над облаком' : pos < 0 ? 'под облаком' : 'в облаке'}; Tenkan ${tk > 0 ? 'выше' : tk < 0 ? 'ниже' : 'равен'} Kijun; будущее облако ${fut > 0 ? 'зелёное' : 'красное'}; Chikou ${ch > 0 ? 'выше' : 'ниже'} цены 26 баров назад`,
      `price ${pos > 0 ? 'above' : pos < 0 ? 'below' : 'inside'} the cloud; Tenkan ${tk > 0 ? 'above' : tk < 0 ? 'below' : 'equal to'} Kijun; future cloud ${fut > 0 ? 'green' : 'red'}; Chikou ${ch > 0 ? 'above' : 'below'} price 26 bars ago`);
    return { score, text };
  }
  function fMA(S, i) {
    const x = S.c[i].c, e = S.ema20[i], s50 = S.sma50[i], s200 = S.sma200[i];
    if (e == null || s50 == null) return { score: 0, text: L('мало данных', 'not enough data') };
    let sc = 0.25 * Math.sign(x - e) + 0.25 * Math.sign(x - s50);
    let cross = L('SMA200 нет', 'no SMA200');
    if (s200 != null) {
      sc += 0.2 * Math.sign(x - s200) + 0.15 * Math.sign(s50 - s200);
      let recent = ''; for (let j = i; j > i - 20 && j > 0; j--) { const p50 = S.sma50[j - 1], p200 = S.sma200[j - 1]; if (p50 == null || p200 == null) break; if (Math.sign(S.sma50[j] - S.sma200[j]) !== Math.sign(p50 - p200)) { recent = S.sma50[j] > S.sma200[j] ? 'golden' : 'death'; break; } }
      cross = s50 > s200 ? L('SMA50 выше SMA200', 'SMA50 above SMA200') : L('SMA50 ниже SMA200', 'SMA50 below SMA200');
      if (recent === 'golden') cross += L(' — недавно золотой крест', ' — recent golden cross');
      if (recent === 'death') cross += L(' — недавно мёртвый крест', ' — recent death cross');
    }
    const sl = I.slope(S.sma50, i, 10); sc += 0.15 * I.clamp(sl * 50);
    return { score: sc, text: L(`цена ${x > e ? 'выше' : 'ниже'} EMA20 и ${x > s50 ? 'выше' : 'ниже'} SMA50${s200 != null ? `, ${x > s200 ? 'выше' : 'ниже'} SMA200` : ''}; ${cross}; наклон SMA50 ${sl > 0.002 ? 'вверх' : sl < -0.002 ? 'вниз' : 'плоский'}`,
      `price ${x > e ? 'above' : 'below'} EMA20 and ${x > s50 ? 'above' : 'below'} SMA50${s200 != null ? `, ${x > s200 ? 'above' : 'below'} SMA200` : ''}; ${cross}; SMA50 slope ${sl > 0.002 ? 'up' : sl < -0.002 ? 'down' : 'flat'}`) };
  }
  function fBB(S, i) {
    const pb = S.bb.pb[i], mid = S.bb.mid[i]; if (pb == null) return { score: 0, text: '—' };
    const x = S.c[i].c, slope = I.slope(S.bb.mid, i, 5), rank = S.bwRank[i];
    let sc = 0.35 * Math.sign(x - mid) + 0.25 * I.clamp(slope * 80), state = '';
    if (pb > 1) { sc -= 0.6; state = L('выше верхней полосы — перекупленность', 'above upper band — overbought'); }
    else if (pb < 0) { sc += 0.6; state = L('ниже нижней полосы — перепроданность', 'below lower band — oversold'); }
    else if (pb > 0.85) { sc -= 0.2; state = L('у верхней полосы', 'near upper band'); }
    else if (pb < 0.15) { sc += 0.2; state = L('у нижней полосы', 'near lower band'); }
    else state = L('внутри полос', 'inside the bands');
    let sq = '';
    if (rank != null && rank < 0.15) { sq = L('; сжатие полос — ждём выхода', '; squeeze — breakout expected'); sc *= 0.7; }
    else if (rank != null && rank > 0.85) sq = L('; полосы расширяются', '; bands expanding');
    return { score: I.clamp(sc), text: `%B ${fmt(pb * 100, 0)}% — ${state}${sq}` };
  }
  function fVWAP(S, i) {
    const v = S.vwap.v[i], sd = S.vwap.sd[i]; if (v == null) return { score: 0, text: '—' };
    const x = S.c[i].c, d = sd ? (x - v) / sd : 0;
    let sc = d > 2 ? -0.3 : d > 0 ? 0.3 + 0.35 * Math.min(d, 1) : d < -2 ? 0.3 : -0.3 - 0.35 * Math.min(-d, 1);
    sc += 0.25 * I.clamp(I.slope(S.vwap.v, i, 5) * 80);
    return { score: I.clamp(sc), text: L(`цена ${d >= 0 ? 'выше' : 'ниже'} ${S.intraday ? 'сессионного ' : ''}VWAP на ${fmt(Math.abs(d), 1)}σ${Math.abs(d) > 2 ? ' — растянуто, возможен возврат' : ''}`,
      `price ${d >= 0 ? 'above' : 'below'} ${S.intraday ? 'session ' : ''}VWAP by ${fmt(Math.abs(d), 1)}σ${Math.abs(d) > 2 ? ' — stretched, mean reversion possible' : ''}`), dev: d };
  }
  function fFlow(S, i) {
    const cmf = S.cmf[i] || 0, obv = S.obv[i], obs = S.obvSma[i];
    let dsum = 0, vsum = 0, big = 0, bigN = 0;
    for (let j = Math.max(0, i - 19); j <= i; j++) { dsum += S.delta[j]; vsum += S.c[j].v || 0; if (S.volSma[j] && S.c[j].v > 2 * S.volSma[j]) { big += Math.sign(S.c[j].c - S.c[j].o); bigN++; } }
    const dn = vsum ? dsum / vsum : 0;
    const sc = 0.35 * I.clamp(cmf * 4) + 0.25 * (obs != null ? Math.sign(obv - obs) : 0) + 0.25 * I.clamp(dn * 3) + 0.15 * (bigN ? I.clamp(big / bigN) : 0);
    return { score: I.clamp(sc), cmf, delta: dn, bigN, big, text: L(`CMF ${fmt(cmf, 2)}; OBV ${obv > obs ? 'растёт' : 'падает'}; дельта ${dn >= 0 ? 'покупок' : 'продаж'} ${fmt(Math.abs(dn) * 100, 0)}%; всплесков объёма ${bigN}${bigN ? (big > 0 ? ' (крупные покупают)' : big < 0 ? ' (крупные продают)' : '') : ''}`,
      `CMF ${fmt(cmf, 2)}; OBV ${obv > obs ? 'rising' : 'falling'}; ${dn >= 0 ? 'buy' : 'sell'} delta ${fmt(Math.abs(dn) * 100, 0)}%; volume spikes ${bigN}${bigN ? (big > 0 ? ' (big players buying)' : big < 0 ? ' (big players selling)' : '') : ''}`) };
  }
  function nearestLevels(S, i) {
    const atr = S.atr[i] || S.c[i].c * 0.01, price = S.c[i].c;
    const lv = I.levels(S.c, S.piv, i, atr);
    const sup = lv.filter(l => l.price < price - atr * 0.3).sort((a, b) => b.price - a.price);
    const res = lv.filter(l => l.price > price + atr * 0.3).sort((a, b) => a.price - b.price);
    return { lv, sup, res, atr };
  }
  function fLevels(S, i, N) {
    const { sup, res, atr } = N, x = S.c[i], price = x.c;
    const ds = sup[0] ? (price - sup[0].price) / atr : 99, dr = res[0] ? (res[0].price - price) / atr : 99;
    let sc = 0, notes = [];
    if (ds < 1) { sc += 0.45; notes.push(L('цена у поддержки', 'price at support')); }
    if (dr < 1) { sc -= 0.45; notes.push(L('цена у сопротивления', 'price at resistance')); }
    if (ds >= 1 && dr >= 1) sc += I.clamp((dr - ds) / 6) * 0.4;
    // пробои и снятие ликвидности за 3 бара
    const prev = S.piv.filter(p => p.conf <= i - 1).slice(-12);
    const lastH = prev.filter(p => p.type === 'H').slice(-1)[0], lastL = prev.filter(p => p.type === 'L').slice(-1)[0];
    if (lastH && x.c > lastH.p && S.c[i - 1] && S.c[i - 1].c <= lastH.p) { sc += 0.5; notes.push(L('пробой сопротивления', 'resistance breakout')); }
    if (lastL && x.c < lastL.p && S.c[i - 1] && S.c[i - 1].c >= lastL.p) { sc -= 0.5; notes.push(L('пробой поддержки', 'support breakdown')); }
    if (lastL && x.l < lastL.p && x.c > lastL.p) { sc += 0.55; notes.push(L('снятие ликвидности под минимумом (бычье)', 'liquidity sweep below low (bullish)')); }
    if (lastH && x.h > lastH.p && x.c < lastH.p) { sc -= 0.55; notes.push(L('снятие ликвидности над максимумом (медвежье)', 'liquidity sweep above high (bearish)')); }
    return { score: I.clamp(sc), text: L(`до поддержки ${fmt(ds > 50 ? null : ds, 1)} ATR, до сопротивления ${fmt(dr > 50 ? null : dr, 1)} ATR`, `to support ${fmt(ds > 50 ? null : ds, 1)} ATR, to resistance ${fmt(dr > 50 ? null : dr, 1)} ATR`) + (notes.length ? '; ' + notes.join(', ') : '') };
  }
  function fCandles(S, i) {
    const f = C.factor(S.patterns, i, 5);
    const names = f.used.map(m => (L(C.P[m.key][0], C.P[m.key][1])) + (m.conf === true ? ' ✓' : m.conf === false ? ' ✗' : ' …'));
    return { score: f.score, used: f.used, text: names.length ? names.join(', ') : L('значимых моделей за 5 свечей нет', 'no significant patterns in last 5 candles') };
  }
  const POS = ['beat', 'surge', 'soar', 'rally', 'jump', 'gain', 'rise', 'record', 'upgrade', 'strong', 'bullish', 'growth', 'profit', 'boost', 'higher', 'optimis', 'approv', 'wins', 'tops', 'raise', 'buyback', 'outperform'];
  const NEG = ['miss', 'plunge', 'fall', 'drop', 'slump', 'tumble', 'cut', 'downgrade', 'weak', 'bearish', 'loss', 'lawsuit', 'probe', 'fear', 'lower', 'recession', 'crash', 'warn', 'sink', 'slide', 'tariff', 'layoff', 'recall', 'slip', 'underperform', 'investigat'];
  A.tone = title => { const t = title.toLowerCase(); let s = 0; POS.forEach(w => { if (t.includes(w)) s++; }); NEG.forEach(w => { if (t.includes(w)) s--; }); return I.clamp(s / 2); };
  function fNews(news, now) {
    const rel = (news || []).filter(n => n.mentioned !== false);
    if (!rel.length) return { score: 0, text: L('свежих заголовков про бумагу нет', 'no fresh headlines about the security') };
    let s = 0, w = 0; rel.forEach(n => { const age = Math.max(0, (now - (n.time || now)) / 86400), k = Math.exp(-age / 3); s += (n.userTone != null ? n.userTone : A.tone(n.title)) * k; w += k; });
    const sc = w ? I.clamp(s / w * 1.5) : 0;
    return { score: sc, text: L(`${rel.length} заголовков, тон ${sc > 0.15 ? 'позитивный' : sc < -0.15 ? 'негативный' : 'нейтральный'}`, `${rel.length} headlines, tone ${sc > 0.15 ? 'positive' : sc < -0.15 ? 'negative' : 'neutral'}`) };
  }
  /* Индекс страха и жадности 0–100 по бумаге */
  A.fearGreed = (S, i) => {
    const c = S.c, x = c[i].c, rsi = S.rsi[i] || 50;
    const n125 = Math.max(0, i - 125); let s = 0; for (let j = n125; j <= i; j++) s += c[j].c; const ma = s / (i - n125 + 1);
    const mom = I.clamp((x / ma - 1) * 5) * 50 + 50;
    const n = Math.max(0, i - 250); let hi = -Infinity, lo = Infinity; for (let j = n; j <= i; j++) { hi = Math.max(hi, c[j].h); lo = Math.min(lo, c[j].l); }
    const pos = hi > lo ? (x - lo) / (hi - lo) * 100 : 50;
    let atrAvg = 0, k = 0; for (let j = Math.max(14, i - 100); j <= i; j++) if (S.atr[j]) { atrAvg += S.atr[j]; k++; }
    const volR = k ? S.atr[i] / (atrAvg / k) : 1, vol = I.clamp(1 - volR, -1, 1) * 50 + 50;
    let up = 0, dn = 0; for (let j = Math.max(1, i - 19); j <= i; j++) { if (c[j].c >= c[j - 1].c) up += c[j].v; else dn += c[j].v; }
    const breadth = up + dn ? up / (up + dn) * 100 : 50;
    const fg = Math.round(0.25 * rsi + 0.25 * mom + 0.2 * pos + 0.15 * vol + 0.15 * breadth);
    return Math.max(0, Math.min(100, fg));
  };
  A.fgLabel = fg => fg < 20 ? L('Крайний страх', 'Extreme fear') : fg < 40 ? L('Страх', 'Fear') : fg <= 60 ? L('Нейтрально', 'Neutral') : fg <= 80 ? L('Жадность', 'Greed') : L('Крайняя жадность', 'Extreme greed');
  A.cyclePhase = (S, i) => {
    const x = S.c[i].c, s50 = S.sma50[i], s200 = S.sma200[i] || s50, sl = I.slope(S.sma50, i, 10);
    if (s50 == null) return L('неопределённая', 'undefined');
    if (x > s50 && s50 > s200 && sl > 0) return L('рост (разметка)', 'markup');
    if (x < s50 && s50 < s200 && sl < 0) return L('падение (снижение)', 'markdown');
    if (x > s50 && sl <= 0) return L('распределение', 'distribution');
    return L('накопление', 'accumulation');
  };
  function fPsy(S, i, flow) {
    const fg = A.fearGreed(S, i);
    let sc = fg > 85 ? -0.6 : fg > 70 ? 0.2 : fg >= 50 ? 0.4 : fg >= 30 ? -0.3 : fg >= 15 ? 0.1 : 0.5;
    sc = 0.7 * sc + 0.3 * (flow.bigN ? I.clamp(flow.big / flow.bigN) : 0);
    return { score: I.clamp(sc), fg, text: L(`индекс страха/жадности ${fg} — ${A.fgLabel(fg).toLowerCase()}; фаза: ${A.cyclePhase(S, i)}`, `fear & greed ${fg} — ${A.fgLabel(fg).toLowerCase()}; phase: ${A.cyclePhase(S, i)}`) };
  }

  /* ---------- главный расчёт на баре i ---------- */
  /* Сырые оценки факторов не зависят от весов — в бэктесте кешируются, чтобы подбор весов был быстрым */
  A.raw = (S, i, ctx = {}) => {
    if (ctx.noNews && S.rawCache && S.rawCache[i] && S.rawCache[i].lang === (g.SETTINGS && SETTINGS.lang)) return S.rawCache[i];
    const now = ctx.now || Date.now() / 1000;
    const N = nearestLevels(S, i);
    const flow = fFlow(S, i);
    const raw = {
      ichimoku: fIchimoku(S, i), ma: fMA(S, i), bb: fBB(S, i), vwap: fVWAP(S, i), flow,
      levels: fLevels(S, i, N), candles: fCandles(S, i),
      news: ctx.noNews ? { score: 0, text: L('не учитываются в бэктесте', 'ignored in backtest') } : fNews(ctx.news, now),
      psy: fPsy(S, i, flow),
    };
    const R = { raw, N, flow, lang: g.SETTINGS && SETTINGS.lang, plans: {} };
    if (ctx.noNews) { S.rawCache = S.rawCache || []; S.rawCache[i] = R; }
    return R;
  };
  A.evaluate = (S, i, ctx = {}) => {
    const P = S.P, W = ctx.weights || A.defaultWeights();
    const R = A.raw(S, i, ctx), { raw, N, flow } = R;
    const wsum = A.FACTORS.reduce((s, f) => s + (W[f.key] || 0), 0) || 1;
    const factors = A.FACTORS.map(f => ({ key: f.key, name: L(f.ru, f.en), w: W[f.key] || 0, score: I.clamp(raw[f.key].score), text: raw[f.key].text }));
    const total = factors.reduce((s, f) => s + f.score * f.w, 0) * 100 / wsum;
    const sign = Math.sign(total) || 1;
    let agreeW = 0, activeW = 0; factors.forEach(f => { if (Math.abs(f.score) > 0.05 && f.w > 0) { activeW += f.w; if (Math.sign(f.score) === sign) agreeW += f.w; } });
    const agree = activeW ? agreeW / activeW : 0.5;
    let conf = 55 * Math.min(1, Math.abs(total) / 50) + 45 * agree;
    // разворотная модель Гусева против сигнала
    const against = (raw.candles.used || []).find(m => m.reversal && m.placeOk && Math.sign(m.dir) === -sign && m.conf !== false);
    if (against) conf -= P.gusevPenalty;
    conf = Math.max(0, Math.min(100, conf));
    const pdir = total >= 0 ? 1 : -1, pkey = pdir + ':' + (ctx.deposit || 0) + ':' + (ctx.riskPct || 0);
    const plan = R.plans[pkey] || (R.plans[pkey] = A.plan(S, i, N, pdir, ctx));
    let signal = 'WAIT', reason = '';
    const dirOk = total >= P.buyTh ? 1 : total <= P.sellTh ? -1 : 0;
    if (dirOk && conf >= P.confTh) {
      if (dirOk < 0 && ctx.longOnly) { signal = 'AVOID'; reason = L(`балл ${fmt(total, 0)}, перевес продавцов — покупки не открываем`, `score ${fmt(total, 0)}, sellers dominate — no long entries`); }
      else if (plan.rr != null && plan.rr < P.minRR) { signal = 'WAIT'; reason = L(`риск/прибыль ${fmt(plan.rr, 2)} < ${P.minRR} — правило санпо, ждём`, `risk/reward ${fmt(plan.rr, 2)} < ${P.minRR} — sanpo rule, wait`); }
      else if (dirOk > 0) { signal = 'BUY'; reason = L(`балл ${fmt(total, 0)}, ${Math.round(agree * 100)}% веса факторов за покупку`, `score ${fmt(total, 0)}, ${Math.round(agree * 100)}% of factor weight bullish`); }
      else { signal = ctx.longOnly ? 'AVOID' : 'SELL'; reason = L(`балл ${fmt(total, 0)}, перевес продавцов`, `score ${fmt(total, 0)}, sellers dominate`); }
    } else if (dirOk) reason = L(`уверенность ${Math.round(conf)}% ниже порога ${P.confTh}%`, `confidence ${Math.round(conf)}% below ${P.confTh}% threshold`) + (against ? L(' (разворотная модель против)', ' (reversal pattern against)') : '');
    else reason = L(`балл ${fmt(total, 0)} в зоне неопределённости (${P.sellTh}…+${P.buyTh})`, `score ${fmt(total, 0)} in neutral zone (${P.sellTh}…+${P.buyTh})`);
    return { i, factors, total, conf, agree, signal, reason, plan, gauge: Math.max(0, Math.min(100, 50 + total / 2)), N, against, fg: raw.psy.fg, flow, vwapDev: raw.vwap.dev, candlesUsed: raw.candles.used || [] };
  };

  /* План сделки: вход, стоп, две цели, R/R, размер позиции */
  A.plan = (S, i, N, dir, ctx = {}) => {
    const x = S.c[i], price = x.c, atr = N.atr;
    let stop, t1, t2;
    if (dir > 0) {
      const s = N.sup[0] ? N.sup[0].price - 0.25 * atr : price - 1.5 * atr;
      stop = Math.min(price - 0.8 * atr, Math.max(s, price - 3 * atr));
      t1 = N.res[0] ? N.res[0].price : price + 2 * atr;
      t2 = N.res[1] ? N.res[1].price : price + 2 * (t1 - price);
    } else {
      const s = N.res[0] ? N.res[0].price + 0.25 * atr : price + 1.5 * atr;
      stop = Math.max(price + 0.8 * atr, Math.min(s, price + 3 * atr));
      t1 = N.sup[0] ? N.sup[0].price : price - 2 * atr;
      t2 = N.sup[1] ? N.sup[1].price : price - 2 * (price - t1);
    }
    const risk = Math.abs(price - stop), rr = risk ? Math.abs(t1 - price) / risk : null, rr2 = risk ? Math.abs(t2 - price) / risk : null;
    const dep = ctx.deposit || 10000, rp = (ctx.riskPct || 1) / 100;
    const qty = risk ? Math.floor(dep * rp / risk * (S.c[i].c < 1 ? 1 : 1) * 1000) / 1000 : 0;
    const maxQty = dep / price;
    const size = Math.min(qty, maxQty);
    return { dir, entry: price, stop, t1, t2, risk, rr, rr2, qty: S.crypto ? size : Math.floor(size), amount: Math.floor(size) * price, riskMoney: dep * rp, atr };
  };

  /* Справедливая стоимость: аналитики 40%, DCF 30%, Линч 20%, Грэм 10% */
  A.fairValue = (f, price) => {
    if (!f) return null;
    const parts = [];
    if (f.targetMeanPrice) parts.push({ k: 'analysts', ru: 'Консенсус аналитиков', en: 'Analyst consensus', v: f.targetMeanPrice, w: 40 });
    const eps = f.trailingEps, g0 = f.earningsGrowth != null ? f.earningsGrowth : null;
    if (f.freeCashflow && f.sharesOutstanding && f.freeCashflow > 0) {
      const fcf = f.freeCashflow / f.sharesOutstanding, gr = Math.max(0, Math.min(0.2, g0 != null ? g0 : 0.06)), r = 0.10, tg = 0.03;
      let pv = 0, cf = fcf; for (let y = 1; y <= 10; y++) { cf *= 1 + gr * (1 - (y - 1) / 15); pv += cf / (1 + r) ** y; }
      pv += cf * (1 + tg) / (r - tg) / (1 + r) ** 10;
      parts.push({ k: 'dcf', ru: 'DCF (10 лет, ставка 10%)', en: 'DCF (10y, 10% discount)', v: pv, w: 30 });
    }
    if (eps && eps > 0) {
      const gp = Math.max(5, Math.min(25, (g0 != null ? g0 : 0.08) * 100));
      parts.push({ k: 'lynch', ru: 'Метод Линча (PEG = 1)', en: 'Lynch (PEG = 1)', v: eps * gp, w: 20 });
      if (f.bookValue && f.bookValue > 0) parts.push({ k: 'graham', ru: 'Число Грэма', en: 'Graham number', v: Math.sqrt(22.5 * eps * f.bookValue), w: 10 });
    }
    if (!parts.length) return null;
    const ws = parts.reduce((s, p) => s + p.w, 0), fair = parts.reduce((s, p) => s + p.v * p.w, 0) / ws;
    const diff = price ? fair / price - 1 : 0;
    const verdict = diff > 0.1 ? L('недооценена', 'undervalued') : diff < -0.1 ? L('переоценена', 'overvalued') : L('оценена справедливо', 'fairly valued');
    return { parts, fair, diff, verdict };
  };

  /* Мнение трейдера с 30-летним стажем и короткий вывод */
  A.expert = (sym, ev, S, fv, tfName) => {
    const x = S.c[ev.i], f = Object.fromEntries(ev.factors.map(q => [q.key, q])), p = ev.plan;
    const best = [...ev.factors].sort((a, b) => b.score * b.w - a.score * a.w), pro = best.filter(q => q.score > 0.15).slice(0, 3), con = best.reverse().filter(q => q.score < -0.15).slice(0, 3);
    const lines = [];
    lines.push(L(`${sym}, ${tfName}. Цена ${fmt(x.c)}. Балл ${fmt(ev.total, 0)} из ±100, уверенность ${Math.round(ev.conf)}%.`, `${sym}, ${tfName}. Price ${fmt(x.c)}. Score ${fmt(ev.total, 0)} of ±100, confidence ${Math.round(ev.conf)}%.`));
    if (pro.length) lines.push(L('За покупку говорят: ', 'In favour of buying: ') + pro.map(q => q.name.toLowerCase() + ' (' + q.text + ')').join('; ') + '.');
    if (con.length) lines.push(L('Против: ', 'Against: ') + con.map(q => q.name.toLowerCase() + ' (' + q.text + ')').join('; ') + '.');
    lines.push(L(`Ближайшая поддержка ${fmt(ev.N.sup[0] && ev.N.sup[0].price)}, сопротивление ${fmt(ev.N.res[0] && ev.N.res[0].price)}. ATR ${fmt(p.atr)}.`, `Nearest support ${fmt(ev.N.sup[0] && ev.N.sup[0].price)}, resistance ${fmt(ev.N.res[0] && ev.N.res[0].price)}. ATR ${fmt(p.atr)}.`));
    if (fv) lines.push(L(`По фундаменту бумага ${fv.verdict}: справедливая цена около ${fmt(fv.fair)} (${fv.diff >= 0 ? '+' : ''}${fmt(fv.diff * 100, 1)}%).`, `Fundamentally the stock is ${fv.verdict}: fair value about ${fmt(fv.fair)} (${fv.diff >= 0 ? '+' : ''}${fmt(fv.diff * 100, 1)}%).`));
    const wisdom = {
      BUY: L('За тридцать лет я усвоил: покупать нужно, когда тренд, объём и место на графике говорят одно и то же. Сейчас так и есть — но стоп ставится в момент входа, а не потом.', 'Thirty years taught me: buy when trend, volume and location all agree. They do now — but the stop goes in at entry, not later.'),
      SELL: L('Рынок показывает слабость. Не ловите падающий нож: продавцы контролируют ситуацию, пока цена не вернётся выше ключевых уровней.', 'The market shows weakness. Do not catch a falling knife: sellers are in control until price reclaims key levels.'),
      AVOID: L('Перевес у продавцов. В режиме «только покупки» лучшее решение — остаться в стороне и сохранить деньги для лучшей точки.', 'Sellers dominate. In long-only mode the best move is to stand aside and keep cash for a better entry.'),
      WAIT: L('Сигналы противоречат друг другу. Старое правило: если сомневаешься — не входи. Деньги, которые вы не потеряли, — тоже прибыль.', 'Signals conflict. Old rule: when in doubt, stay out. Money not lost is also profit.'),
    }[ev.signal];
    lines.push(wisdom);
    if (ev.signal === 'BUY' || ev.signal === 'SELL') lines.push(L(`План: вход ${fmt(p.entry)}, стоп ${fmt(p.stop)}, цели ${fmt(p.t1)} и ${fmt(p.t2)}, риск/прибыль 1:${fmt(p.rr, 1)}.`, `Plan: entry ${fmt(p.entry)}, stop ${fmt(p.stop)}, targets ${fmt(p.t1)} and ${fmt(p.t2)}, risk/reward 1:${fmt(p.rr, 1)}.`));
    const short = {
      BUY: L('Вывод: покупать частями, со стопом.', 'Bottom line: buy in parts, with a stop.'),
      SELL: L('Вывод: продавать / не держать длинную позицию.', 'Bottom line: sell / do not hold longs.'),
      AVOID: L('Вывод: не покупать, ждать.', 'Bottom line: do not buy, wait.'),
      WAIT: L('Вывод: вне рынка, ждать подтверждения.', 'Bottom line: stay out, wait for confirmation.'),
    }[ev.signal];
    return { text: lines.join(' '), short, disclaimer: L('Учебный инструмент. Сигналы рассчитаны алгоритмически и не являются инвестиционной рекомендацией.', 'Educational tool. Signals are algorithmic and are not investment advice.') };
  };

  /* ---------- бэктест ---------- */
  A.backtest = (S, opts = {}) => {
    const c = S.c, start = Math.max(opts.start || 210, 60), trades = [];
    const commR = opts.commission || 0, slip = (opts.slippage || 0) / 100, maxHold = opts.maxHold || 20;
    let pos = null; const W = opts.weights;
    const cache = opts.evals || [];
    for (let i = start; i < c.length - 1; i++) {
      const ev = cache[i] || (cache[i] = A.evaluate(S, i, { weights: W, longOnly: opts.longOnly, noNews: true }));
      if (pos) {
        const x = c[i]; let exit = null;
        if (pos.dir > 0) { if (x.l <= pos.stop) exit = pos.stop; else if (x.h >= pos.t1) exit = pos.t1; }
        else { if (x.h >= pos.stop) exit = pos.stop; else if (x.l <= pos.t1) exit = pos.t1; }
        const flip = (pos.dir > 0 && (ev.signal === 'SELL' || ev.signal === 'AVOID')) || (pos.dir < 0 && ev.signal === 'BUY');
        if (exit == null && (i - pos.i >= maxHold || flip)) exit = x.c;
        if (exit != null) {
          const px = exit * (1 - slip * pos.dir);
          const r = (px - pos.entry) * pos.dir / pos.risk - commR;
          trades.push({ entryI: pos.i, exitI: i, dir: pos.dir, entry: pos.entry, exit: px, r, t: c[i].t });
          pos = null;
        }
      }
      if (!pos && (ev.signal === 'BUY' || (!opts.longOnly && ev.signal === 'SELL'))) {
        const n = c[i + 1], dir = ev.signal === 'BUY' ? 1 : -1, entry = n.o * (1 + slip * dir);
        const risk = Math.abs(entry - ev.plan.stop);
        if (risk > 0 && (dir > 0 ? ev.plan.stop < entry : ev.plan.stop > entry)) pos = { i: i + 1, dir, entry, stop: ev.plan.stop, t1: ev.plan.t1, risk };
      }
    }
    return A.btStats(trades, c.length - start);
  };
  A.btStats = (trades, bars) => {
    const n = trades.length, wins = trades.filter(t => t.r > 0), loss = trades.filter(t => t.r <= 0);
    const sumR = trades.reduce((s, t) => s + t.r, 0), gp = wins.reduce((s, t) => s + t.r, 0), gl = -loss.reduce((s, t) => s + t.r, 0);
    let eq = 0, peak = 0, dd = 0; trades.forEach(t => { eq += t.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); });
    const third = trades.slice(Math.floor(n * 2 / 3)), lastExp = third.length ? third.reduce((s, t) => s + t.r, 0) / third.length : 0;
    const st = { n, wins: wins.length, winRate: n ? wins.length / n : 0, sumR, exp: n ? sumR / n : 0, pf: gl ? gp / gl : (gp ? 99 : 0), maxDD: dd, lastExp, trades, bars };
    st.checks = [
      { ok: n >= 20, ru: `Сделок ≥ 20 (${n})`, en: `Trades ≥ 20 (${n})` },
      { ok: st.winRate >= 0.45, ru: `Доля прибыльных ≥ 45% (${(st.winRate * 100).toFixed(0)}%)`, en: `Win rate ≥ 45% (${(st.winRate * 100).toFixed(0)}%)` },
      { ok: st.pf >= 1.3, ru: `Профит-фактор ≥ 1,3 (${st.pf.toFixed(2)})`, en: `Profit factor ≥ 1.3 (${st.pf.toFixed(2)})` },
      { ok: st.exp > 0.1, ru: `Ожидание > 0,1R (${st.exp.toFixed(2)}R)`, en: `Expectancy > 0.1R (${st.exp.toFixed(2)}R)` },
      { ok: st.maxDD < 10, ru: `Макс. просадка < 10R (${st.maxDD.toFixed(1)}R)`, en: `Max drawdown < 10R (${st.maxDD.toFixed(1)}R)` },
      { ok: st.lastExp > 0, ru: `Последняя треть истории в плюсе (${st.lastExp.toFixed(2)}R)`, en: `Last third of history positive (${st.lastExp.toFixed(2)}R)` },
    ];
    const ok = st.checks.filter(x => x.ok).length;
    st.score = ok;
    st.verdict = ok >= 5 ? 'yes' : ok === 4 ? 'maybe' : 'no';
    return st;
  };
  /* Подбор весов: случайный поиск вокруг текущих весов, цель — сумма R по набору рядов */
  A.optimizeWeights = async (seriesList, base, opts, onProgress) => {
    const evalW = W => seriesList.reduce((s, S) => { const st = A.backtest(S, { ...opts, weights: W }); return s + st.sumR - Math.max(0, st.maxDD - 10) * 0.5; }, 0);
    let best = { ...base }, bestV = evalW(best);
    const keys = A.FACTORS.map(f => f.key).filter(k => k !== 'news');
    const iters = opts.iters || 24;
    for (let it = 0; it < iters; it++) {
      const cand = { ...best };
      const k = keys[Math.floor(Math.random() * keys.length)], k2 = keys[Math.floor(Math.random() * keys.length)];
      cand[k] = Math.max(0, Math.round(cand[k] * (0.4 + Math.random() * 1.4)));
      cand[k2] = Math.max(0, Math.round(cand[k2] * (0.6 + Math.random() * 0.9)));
      const sum = Object.values(cand).reduce((a, b) => a + b, 0) || 1; Object.keys(cand).forEach(q => cand[q] = Math.round(cand[q] * 100 / sum));
      const v = evalW(cand); if (v > bestV) { best = cand; bestV = v; }
      if (onProgress) onProgress(it + 1, iters, bestV);
      await new Promise(r => setTimeout(r, 0));
    }
    return { weights: best, value: bestV };
  };

  g.ANALYSIS = A;
})(window);

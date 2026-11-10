/* Японские свечи по конспекту книги Гусева: модель + её место в тренде + подтверждение следующей свечой.
   Возвращает найденные модели и торговые точки ПОКУПКА / ВЫХОД / ПРОДАЖА. */
(function (g) {
  'use strict';
  const body = x => Math.abs(x.c - x.o), range = x => Math.max(1e-12, x.h - x.l);
  const upSh = x => x.h - Math.max(x.o, x.c), loSh = x => Math.min(x.o, x.c) - x.l;
  const bull = x => x.c > x.o, bear = x => x.c < x.o;

  /* тренд перед баром i: наклон закрытий за n баров относительно ATR */
  function trendAt(c, i, atr, n = 8) {
    if (i < n) return 0;
    const d = (c[i - 1].c - c[i - n].c) / ((atr[i] || range(c[i])) * Math.sqrt(n));
    return d > 0.6 ? 1 : d < -0.6 ? -1 : 0;
  }

  /* Справочник моделей (название RU/EN, направление, разворот?, сила 1-3) */
  const P = {
    hammer: ['Молот', 'Hammer', 1, true, 2],
    hanging: ['Повешенный', 'Hanging man', -1, true, 2],
    invhammer: ['Перевёрнутый молот', 'Inverted hammer', 1, true, 1],
    shooting: ['Падающая звезда', 'Shooting star', -1, true, 2],
    bullEngulf: ['Бычье поглощение', 'Bullish engulfing', 1, true, 3],
    bearEngulf: ['Медвежье поглощение', 'Bearish engulfing', -1, true, 3],
    piercing: ['Просвет в облаках', 'Piercing line', 1, true, 2],
    darkCloud: ['Завеса из тёмных облаков', 'Dark cloud cover', -1, true, 2],
    morningStar: ['Утренняя звезда', 'Morning star', 1, true, 3],
    eveningStar: ['Вечерняя звезда', 'Evening star', -1, true, 3],
    bullHarami: ['Бычий харами', 'Bullish harami', 1, true, 1],
    bearHarami: ['Медвежий харами', 'Bearish harami', -1, true, 1],
    soldiers: ['Три белых солдата', 'Three white soldiers', 1, false, 2],
    crows: ['Три чёрные вороны', 'Three black crows', -1, false, 2],
    dojiTop: ['Доджи на вершине', 'Doji at top', -1, true, 1],
    dojiBottom: ['Доджи на дне', 'Doji at bottom', 1, true, 1],
    tweezerTop: ['Вершина «пинцет»', 'Tweezer top', -1, true, 1],
    tweezerBottom: ['Основание «пинцет»', 'Tweezer bottom', 1, true, 1],
    gapsUp: ['Три разрыва вверх (Саката)', 'Three gaps up (Sakata)', -1, true, 2],
    gapsDown: ['Три разрыва вниз (Саката)', 'Three gaps down (Sakata)', 1, true, 2],
    newHighs: ['8–10 новых максимумов (Саката)', '8–10 new highs (Sakata)', -1, true, 1],
    newLows: ['8–10 новых минимумов (Саката)', '8–10 new lows (Sakata)', 1, true, 1],
  };

  function detectAt(c, i, atr, opts) {
    const out = [], x = c[i], p = c[i - 1], pp = c[i - 2], a = atr[i] || range(x), tr = trendAt(c, i - (p ? 0 : 0), atr);
    const add = (key, extra = {}) => out.push({ key, i, ...extra });
    if (!p) return out;
    const small = body(x) <= range(x) * 0.33;
    if (small && loSh(x) >= 2 * body(x) && upSh(x) <= range(x) * 0.15 && range(x) > a * 0.6) add(tr <= 0 ? 'hammer' : 'hanging');
    if (small && upSh(x) >= 2 * body(x) && loSh(x) <= range(x) * 0.15 && range(x) > a * 0.6) add(tr >= 0 ? 'shooting' : 'invhammer');
    if (bull(x) && bear(p) && x.c >= p.o && x.o <= p.c && body(x) > body(p)) add('bullEngulf');
    if (bear(x) && bull(p) && x.o >= p.c && x.c <= p.o && body(x) > body(p)) add('bearEngulf');
    if (bear(p) && bull(x) && body(p) > a * 0.6 && x.o < p.l + range(p) * 0.25 && x.c > (p.o + p.c) / 2 && x.c < p.o) add('piercing');
    if (bull(p) && bear(x) && body(p) > a * 0.6 && x.o > p.h - range(p) * 0.25 && x.c < (p.o + p.c) / 2 && x.c > p.o) add('darkCloud');
    if (pp && bear(pp) && body(pp) > a * 0.6 && body(p) < body(pp) * 0.4 && bull(x) && x.c > (pp.o + pp.c) / 2) add('morningStar');
    if (pp && bull(pp) && body(pp) > a * 0.6 && body(p) < body(pp) * 0.4 && bear(x) && x.c < (pp.o + pp.c) / 2) add('eveningStar');
    if (bear(p) && body(p) > a * 0.6 && Math.max(x.o, x.c) < p.o && Math.min(x.o, x.c) > p.c && body(x) < body(p) * 0.5) add('bullHarami');
    if (bull(p) && body(p) > a * 0.6 && Math.max(x.o, x.c) < p.c && Math.min(x.o, x.c) > p.o && body(x) < body(p) * 0.5) add('bearHarami');
    if (pp && [pp, p, x].every(bull) && p.c > pp.c && x.c > p.c && [pp, p, x].every(y => body(y) > range(y) * 0.55 && body(y) > a * 0.4)) add('soldiers');
    if (pp && [pp, p, x].every(bear) && p.c < pp.c && x.c < p.c && [pp, p, x].every(y => body(y) > range(y) * 0.55 && body(y) > a * 0.4)) add('crows');
    if (body(x) <= range(x) * 0.08 && range(x) > a * 0.5) { if (tr > 0) add('dojiTop'); else if (tr < 0) add('dojiBottom'); }
    if (Math.abs(x.h - p.h) <= a * 0.05 && bull(p) && bear(x) && tr > 0) add('tweezerTop');
    if (Math.abs(x.l - p.l) <= a * 0.05 && bear(p) && bull(x) && tr < 0) add('tweezerBottom');
    if (opts.sakata) {
      // три разрыва Сакаты за последние ~10 баров
      let gu = 0, gd = 0; for (let j = Math.max(1, i - 9); j <= i; j++) { if (c[j].l > c[j - 1].h) gu++; if (c[j].h < c[j - 1].l) gd++; }
      if (gu >= 3 && c[i].l > c[i - 1].h) add('gapsUp');
      if (gd >= 3 && c[i].h < c[i - 1].l) add('gapsDown');
      // правило «новых максимумов» — только до дневок включительно
      if (opts.newHighs) {
        let nh = 0, nl = 0; for (let j = i; j > i - 12 && j > 0; j--) { if (c[j].h > c[j - 1].h) nh++; else break; }
        for (let j = i; j > i - 12 && j > 0; j--) { if (c[j].l < c[j - 1].l) nl++; else break; }
        if (nh === 8 || nh === 10) add('newHighs');
        if (nl === 8 || nl === 10) add('newLows');
      }
    }
    return out.map(m => {
      const d = P[m.key];
      const placeOk = !d[3] ? true : (d[2] > 0 ? tr < 0 : tr > 0) || m.key.startsWith('gaps') || m.key.startsWith('new');
      return { ...m, dir: d[2], reversal: d[3], strength: d[4], placeOk, trend: tr };
    });
  }

  /* подтверждение: следующая свеча закрывается за пределом модели в сторону сигнала */
  function confirm(c, m) {
    const n = c[m.i + 1]; if (!n) return null;
    const x = c[m.i];
    return m.dir > 0 ? n.c > Math.max(x.c, x.o) : n.c < Math.min(x.c, x.o);
  }

  function scan(c, atr, opts = {}) {
    const res = [];
    for (let i = 2; i < c.length; i++) detectAt(c, i, atr, opts).forEach(m => { m.confirmed = confirm(c, m); res.push(m); });
    return res;
  }

  /* Точки ПОКУПКА / ВЫХОД / ПРОДАЖА: подтверждённая модель в правильном месте; вход на закрытии подтверждающей свечи,
     стоп за экстремумом модели. */
  function signals(c, atr, patterns, longOnly = true) {
    const out = []; let pos = null;
    const byConf = {}; patterns.forEach(m => { if (m.confirmed && m.placeOk && m.strength >= 1) (byConf[m.i + 1] = byConf[m.i + 1] || []).push(m); });
    for (let i = 0; i < c.length; i++) {
      if (pos) {
        const x = c[i];
        if (pos.dir > 0 && (x.l <= pos.stop || x.h >= pos.target)) { const win = x.h >= pos.target && !(x.l <= pos.stop); out.push({ i, type: 'EXIT', price: win ? pos.target : pos.stop, win, entry: pos }); pos = null; }
        else if (pos && pos.dir < 0 && (x.h >= pos.stop || x.l <= pos.target)) { const win = x.l <= pos.target && !(x.h >= pos.stop); out.push({ i, type: 'EXIT', price: win ? pos.target : pos.stop, win, entry: pos }); pos = null; }
      }
      const ms = byConf[i]; if (!ms) continue;
      const m = ms.sort((a, b) => b.strength - a.strength)[0], a = atr[i] || range(c[i]);
      if (!pos && m.dir > 0) {
        const stop = Math.min(c[m.i].l, c[i].l) - a * 0.1, risk = c[i].c - stop;
        if (risk > 0) { pos = { dir: 1, i, price: c[i].c, stop, target: c[i].c + Math.max(2 * risk, 1.5 * a), pattern: m.key }; out.push({ i, type: 'BUY', price: c[i].c, stop, pattern: m.key }); }
      } else if (pos && pos.dir > 0 && m.dir < 0) {
        out.push({ i, type: 'EXIT', price: c[i].c, win: c[i].c > pos.price, entry: pos, pattern: m.key }); pos = null;
      } else if (!pos && m.dir < 0) {
        if (longOnly) { out.push({ i, type: 'AVOID', price: c[i].c, pattern: m.key }); continue; }
        const stop = Math.max(c[m.i].h, c[i].h) + a * 0.1, risk = stop - c[i].c;
        if (risk > 0) { pos = { dir: -1, i, price: c[i].c, stop, target: c[i].c - Math.max(2 * risk, 1.5 * a), pattern: m.key }; out.push({ i, type: 'SELL', price: c[i].c, stop, pattern: m.key }); }
      }
    }
    const exits = out.filter(s => s.type === 'EXIT');
    const wins = exits.filter(s => s.win).length;
    return { points: out, stats: { trades: exits.length, wins, winRate: exits.length ? wins / exits.length : null } };
  }

  /* Оценка фактора «японские свечи» за последние 5 свечей до бара i (-1..+1) */
  function factor(patterns, i, look = 5) {
    let s = 0; const used = [];
    patterns.forEach(m => {
      if (m.i > i || m.i < i - look + 1) return;
      const conf = m.i + 1 <= i ? !!m.confirmed : null;
      const w = m.dir * m.strength / 3 * (m.placeOk ? 1 : 0.4) * (conf === true ? 1 : conf === null ? 0.6 : 0.25) * (1 - (i - m.i) * 0.12);
      s += w; used.push({ ...m, conf, w });
    });
    return { score: Math.max(-1, Math.min(1, s)), used };
  }

  g.CANDLES = { P, scan, signals, factor, trendAt };
})(window);

/* Индикаторы. Свеча: {t,o,h,l,c,v}. Все функции возвращают массивы той же длины (null — нет данных). */
(function (g) {
  'use strict';
  const I = {};

  I.sma = (a, n) => {
    const r = new Array(a.length).fill(null); let s = 0;
    for (let i = 0; i < a.length; i++) {
      s += a[i]; if (i >= n) s -= a[i - n];
      if (i >= n - 1) r[i] = s / n;
    }
    return r;
  };
  I.ema = (a, n) => {
    const r = new Array(a.length).fill(null); const k = 2 / (n + 1); let e = null;
    for (let i = 0; i < a.length; i++) {
      if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += a[j]; e = s / n; }
      else if (i >= n) e = a[i] * k + e * (1 - k);
      r[i] = e;
    }
    return r;
  };
  I.stdev = (a, n) => {
    const r = new Array(a.length).fill(null);
    for (let i = n - 1; i < a.length; i++) {
      let m = 0; for (let j = i - n + 1; j <= i; j++) m += a[j]; m /= n;
      let v = 0; for (let j = i - n + 1; j <= i; j++) v += (a[j] - m) ** 2;
      r[i] = Math.sqrt(v / n);
    }
    return r;
  };
  I.atr = (c, n = 14) => {
    const tr = c.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c)));
    const r = new Array(c.length).fill(null); let a = null;
    for (let i = 0; i < c.length; i++) {
      if (i === n - 1) { a = 0; for (let j = 0; j < n; j++) a += tr[j]; a /= n; }
      else if (i >= n) a = (a * (n - 1) + tr[i]) / n;
      r[i] = a;
    }
    return r;
  };
  I.rsi = (cl, n = 14) => {
    const r = new Array(cl.length).fill(null); let ag = 0, al = 0;
    for (let i = 1; i < cl.length; i++) {
      const d = cl[i] - cl[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { ag += up; al += dn; if (i === n) { ag /= n; al /= n; r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
      else { ag = (ag * (n - 1) + up) / n; al = (al * (n - 1) + dn) / n; r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    }
    return r;
  };
  I.bollinger = (cl, n = 20, k = 2) => {
    const mid = I.sma(cl, n), sd = I.stdev(cl, n);
    const up = mid.map((m, i) => m == null ? null : m + k * sd[i]);
    const lo = mid.map((m, i) => m == null ? null : m - k * sd[i]);
    const pb = cl.map((c, i) => up[i] == null || up[i] === lo[i] ? null : (c - lo[i]) / (up[i] - lo[i]));
    const bw = mid.map((m, i) => m ? (up[i] - lo[i]) / m : null);
    return { mid, up, lo, pb, bw };
  };
  const hl = (c, i, n) => { let h = -Infinity, l = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) { if (c[j].h > h) h = c[j].h; if (c[j].l < l) l = c[j].l; } return (h + l) / 2; };
  /* Ишимоку как в TradingView: облако сдвинуто вперёд на kijun-1, chikou назад на kijun-1. Возвращаем значения «по индексу бара»,
     spanA/spanB[i] — значения облака, видимые над баром i (то есть посчитанные на i-shift). fA/fB — будущее облако (на текущем баре). */
  I.ichimoku = (c, t = 9, k = 26, s = 52) => {
    const n = c.length, shift = k - 1;
    const ten = c.map((_, i) => i >= t - 1 ? hl(c, i, t) : null);
    const kij = c.map((_, i) => i >= k - 1 ? hl(c, i, k) : null);
    const rawA = c.map((_, i) => ten[i] != null && kij[i] != null ? (ten[i] + kij[i]) / 2 : null);
    const rawB = c.map((_, i) => i >= s - 1 ? hl(c, i, s) : null);
    const spanA = new Array(n + shift).fill(null), spanB = new Array(n + shift).fill(null);
    for (let i = 0; i < n; i++) { spanA[i + shift] = rawA[i]; spanB[i + shift] = rawB[i]; }
    return { ten, kij, spanA, spanB, rawA, rawB, shift };
  };
  /* VWAP: intraday — сессионный (сброс по дню), иначе скользящий за n баров. Полосы ±1σ/±2σ */
  I.vwap = (c, intraday, n = 20, tzDay) => {
    const len = c.length, v = new Array(len).fill(null), sd = new Array(len).fill(null);
    if (intraday) {
      let pv = 0, vv = 0, p2 = 0, day = null;
      for (let i = 0; i < len; i++) {
        const d = tzDay(c[i].t); if (d !== day) { pv = vv = p2 = 0; day = d; }
        const tp = (c[i].h + c[i].l + c[i].c) / 3, vol = c[i].v || 1;
        pv += tp * vol; vv += vol; p2 += tp * tp * vol;
        v[i] = pv / vv; sd[i] = Math.sqrt(Math.max(0, p2 / vv - v[i] * v[i]));
      }
    } else {
      for (let i = n - 1; i < len; i++) {
        let pv = 0, vv = 0, p2 = 0;
        for (let j = i - n + 1; j <= i; j++) { const tp = (c[j].h + c[j].l + c[j].c) / 3, vol = c[j].v || 1; pv += tp * vol; vv += vol; p2 += tp * tp * vol; }
        v[i] = pv / vv; sd[i] = Math.sqrt(Math.max(0, p2 / vv - v[i] * v[i]));
      }
    }
    return { v, sd };
  };
  I.cmf = (c, n = 20) => {
    const mfv = c.map(x => x.h === x.l ? 0 : ((x.c - x.l) - (x.h - x.c)) / (x.h - x.l) * (x.v || 0));
    const r = new Array(c.length).fill(null);
    for (let i = n - 1; i < c.length; i++) { let a = 0, b = 0; for (let j = i - n + 1; j <= i; j++) { a += mfv[j]; b += c[j].v || 0; } r[i] = b ? a / b : 0; }
    return r;
  };
  I.obv = c => { const r = [0]; for (let i = 1; i < c.length; i++) r.push(r[i - 1] + (c[i].c > c[i - 1].c ? c[i].v : c[i].c < c[i - 1].c ? -c[i].v : 0)); return r; };
  /* Дельта покупок/продаж по свече (оценка Time & Sales по форме свечи) */
  I.delta = c => c.map(x => x.h === x.l ? 0 : (x.v || 0) * ((x.c - x.o) / (x.h - x.l)));
  /* Точки разворота: pivot high/low с подтверждением через k баров */
  I.pivots = (c, k = 3) => {
    const res = [];
    for (let i = k; i < c.length - k; i++) {
      let ph = true, pl = true;
      for (let j = i - k; j <= i + k; j++) { if (j === i) continue; if (c[j].h >= c[i].h) ph = false; if (c[j].l <= c[i].l) pl = false; }
      if (ph) res.push({ i, type: 'H', p: c[i].h, conf: i + k });
      if (pl) res.push({ i, type: 'L', p: c[i].l, conf: i + k });
    }
    return res;
  };
  /* Уровни поддержки/сопротивления: кластеризация точек разворота до бара `upto` */
  I.levels = (c, piv, upto, atr, maxPivots = 60) => {
    const pts = []; for (let q = piv.length - 1; q >= 0 && pts.length < maxPivots; q--) if (piv[q].conf <= upto) pts.push(piv[q]);
    const tol = (atr || (c[upto].c * 0.01)) * 0.6, cl = [];
    pts.forEach(p => {
      const z = cl.find(z => Math.abs(z.p - p.p) <= tol);
      if (z) { z.p = (z.p * z.n + p.p) / (z.n + 1); z.n++; z.last = Math.max(z.last, p.i); z.types.add(p.type); }
      else cl.push({ p: p.p, n: 1, last: p.i, types: new Set([p.type]) });
    });
    const price = c[upto].c;
    const lv = cl.map(z => ({ price: z.p, touches: z.n, last: z.last, kind: z.p < price ? 'S' : 'R', key: z.n >= 3 || z.types.size > 1 }));
    lv.sort((a, b) => a.price - b.price);
    return lv;
  };
  /* Профиль объёма: POC и зона стоимости 70% */
  I.volumeProfile = (c, from, to, bins = 40) => {
    from = Math.max(0, from); let lo = Infinity, hi = -Infinity;
    for (let i = from; i <= to; i++) { if (c[i].l < lo) lo = c[i].l; if (c[i].h > hi) hi = c[i].h; }
    if (!isFinite(lo) || hi <= lo) return null;
    const step = (hi - lo) / bins, vol = new Array(bins).fill(0), buy = new Array(bins).fill(0);
    for (let i = from; i <= to; i++) {
      const x = c[i], a = Math.max(0, Math.floor((x.l - lo) / step)), b = Math.min(bins - 1, Math.floor((x.h - lo) / step));
      const share = (x.v || 0) / (b - a + 1), bull = x.c >= x.o;
      for (let k = a; k <= b; k++) { vol[k] += share; if (bull) buy[k] += share; }
    }
    let poc = 0; vol.forEach((v, k) => { if (v > vol[poc]) poc = k; });
    const total = vol.reduce((a, b) => a + b, 0); let acc = vol[poc], L = poc, H = poc;
    while (acc < total * 0.7 && (L > 0 || H < bins - 1)) {
      const dn = L > 0 ? vol[L - 1] : -1, up = H < bins - 1 ? vol[H + 1] : -1;
      if (up >= dn) { H++; acc += vol[H]; } else { L--; acc += vol[L]; }
    }
    return { lo, hi, step, vol, buy, poc: lo + (poc + 0.5) * step, val: lo + L * step, vah: lo + (H + 1) * step, max: vol[poc] };
  };
  /* Зоны ликвидности — скопления стопов за свинг-экстремумами (равные максимумы/минимумы) */
  I.liquidity = (c, piv, upto, atr) => {
    const recent = piv.filter(p => p.conf <= upto).slice(-30), zones = [];
    const tol = (atr || c[upto].c * 0.01) * 0.35;
    recent.forEach(p => {
      const swept = c.slice(p.i + 1, upto + 1).some(x => p.type === 'H' ? x.h > p.p + tol * 0.2 : x.l < p.p - tol * 0.2);
      const z = zones.find(z => z.type === p.type && Math.abs(z.p - p.p) <= tol);
      if (z) { z.n++; z.p = (z.p + p.p) / 2; z.swept = z.swept && swept; } else zones.push({ type: p.type, p: p.p, n: 1, i: p.i, swept });
    });
    return zones.filter(z => !z.swept).map(z => ({ ...z, strength: z.n }));
  };
  /* Фибоначчи по видимой части */
  I.fibo = (c, from, to) => {
    let hi = -Infinity, lo = Infinity, hiI = from, loI = from;
    for (let i = Math.max(0, from); i <= to; i++) { if (c[i].h > hi) { hi = c[i].h; hiI = i; } if (c[i].l < lo) { lo = c[i].l; loI = i; } }
    const up = loI < hiI; const lv = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    return { up, levels: lv.map(r => ({ r, p: up ? hi - (hi - lo) * r : lo + (hi - lo) * r })) };
  };
  /* Линии тренда по точкам разворота: последние 2 повышающихся минимума / понижающихся максимума */
  I.trendlines = (c, piv, upto) => {
    const lows = piv.filter(p => p.type === 'L' && p.conf <= upto), highs = piv.filter(p => p.type === 'H' && p.conf <= upto), out = [];
    const mk = (arr, type) => {
      for (let a = arr.length - 1; a > 0 && a > arr.length - 6; a--) {
        const p2 = arr[a]; for (let b = a - 1; b >= 0 && b > a - 6; b--) {
          const p1 = arr[b]; if (type === 'L' ? p1.p >= p2.p : p1.p <= p2.p) continue;
          const slope = (p2.p - p1.p) / (p2.i - p1.i); let ok = true;
          for (let i = p1.i; i <= upto; i++) { const y = p1.p + slope * (i - p1.i); if (type === 'L' ? c[i].c < y * 0.997 : c[i].c > y * 1.003) { ok = false; break; } }
          if (ok) { out.push({ type, i1: p1.i, p1: p1.p, slope }); return; }
        }
      }
    };
    mk(lows, 'L'); mk(highs, 'H');
    return out;
  };
  I.slope = (a, i, n) => (a[i] != null && a[i - n] != null && a[i - n] !== 0) ? (a[i] - a[i - n]) / Math.abs(a[i - n]) : 0;
  I.clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));

  g.IND = I;
})(window);

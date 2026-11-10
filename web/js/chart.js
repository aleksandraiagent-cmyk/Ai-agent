/* Ценовой график на canvas: свечи, объём, 12 слоёв, масштаб, перетаскивание, колесо мыши, перекрестие с легендой OHLC. */
(function (g) {
  'use strict';
  const I = g.IND;
  class Chart {
    constructor(canvas, legend) {
      this.cv = canvas; this.ctx = canvas.getContext('2d'); this.legend = legend;
      this.c = []; this.S = null; this.layers = {}; this.view = { end: 0, count: 120 }; this.mouse = null; this.extra = {};
      this.bind(); this.resize();
      new ResizeObserver(() => { this.resize(); this.draw(); }).observe(canvas.parentElement);
    }
    resize() {
      const r = this.cv.parentElement.getBoundingClientRect(), dpr = g.devicePixelRatio || 1;
      this.W = Math.max(300, r.width); this.H = Math.max(260, r.height);
      this.cv.width = this.W * dpr; this.cv.height = this.H * dpr; this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    set(S, extra = {}) {
      const keep = this.c.length && this.S && S && this.S.tf === S.tf && this.sym === extra.sym;
      this.S = S; this.c = S ? S.c : []; this.extra = extra; this.sym = extra.sym;
      if (!keep) this.view = { end: this.c.length - 1 + 5, count: Math.min(this.c.length + 5, extra.count || 140) };
      this.draw();
    }
    setPeriod(days) {
      if (!this.c.length) return;
      const last = this.c[this.c.length - 1].t; let n = this.c.length;
      if (days) { n = this.c.filter(x => x.t >= last - days * 86400).length; }
      this.view = { end: this.c.length - 1 + 5, count: Math.max(20, n + 5) }; this.draw();
    }
    bind() {
      const cv = this.cv; let drag = null;
      const pos = e => { const r = cv.getBoundingClientRect(), p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; };
      cv.addEventListener('mousedown', e => { drag = { ...pos(e), end: this.view.end }; });
      g.addEventListener('mouseup', () => { drag = null; });
      cv.addEventListener('mousemove', e => {
        const p = pos(e); this.mouse = p;
        if (drag) { const bw = this.plotW() / this.view.count; this.view.end = drag.end - (p.x - drag.x) / bw; this.clampView(); }
        this.draw();
      });
      cv.addEventListener('mouseleave', () => { this.mouse = null; this.draw(); });
      cv.addEventListener('wheel', e => {
        e.preventDefault(); const k = e.deltaY > 0 ? 1.12 : 1 / 1.12, p = pos(e);
        const frac = p.x / this.plotW(), anchor = this.view.end - this.view.count * (1 - frac);
        this.view.count = Math.max(15, Math.min(this.c.length + 20, this.view.count * k));
        this.view.end = anchor + this.view.count * (1 - frac); this.clampView(); this.draw();
      }, { passive: false });
      let pinch = null;
      cv.addEventListener('touchstart', e => {
        if (e.touches.length === 2) pinch = { d: Math.abs(e.touches[0].clientX - e.touches[1].clientX), count: this.view.count };
        else drag = { ...pos(e), end: this.view.end };
      }, { passive: true });
      cv.addEventListener('touchmove', e => {
        if (pinch && e.touches.length === 2) { const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1; this.view.count = Math.max(15, Math.min(this.c.length + 20, pinch.count * pinch.d / d)); this.clampView(); this.draw(); e.preventDefault(); return; }
        if (drag) { const p = pos(e), bw = this.plotW() / this.view.count; this.view.end = drag.end - (p.x - drag.x) / bw; this.clampView(); this.mouse = p; this.draw(); e.preventDefault(); }
      }, { passive: false });
      cv.addEventListener('touchend', () => { drag = null; pinch = null; });
      cv.addEventListener('dblclick', () => { this.view = { end: this.c.length + 4, count: Math.min(140, this.c.length + 5) }; this.draw(); });
    }
    clampView() { this.view.end = Math.max(10, Math.min(this.c.length - 1 + this.view.count * 0.6, this.view.end)); }
    plotW() { return this.W - 64; }
    colors() {
      const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
      return { bg: v('--chart-bg'), grid: v('--grid'), text: v('--muted'), up: v('--up'), down: v('--down'), fg: v('--fg'), accent: v('--accent'), warn: v('--warn') };
    }
    draw() {
      const ctx = this.ctx, W = this.W, H = this.H, col = this.colors();
      ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, H);
      if (!this.c.length) { ctx.fillStyle = col.text; ctx.font = '14px system-ui'; ctx.fillText('Нет данных', 20, 30); return; }
      const c = this.c, S = this.S, L = this.layers, pw = this.plotW(), volH = H * 0.16, ph = H - volH - 22;
      const end = this.view.end, cnt = this.view.count, bw = pw / cnt;
      const i0 = Math.max(0, Math.floor(end - cnt + 1)), i1 = Math.min(c.length - 1, Math.ceil(end));
      const X = i => pw - (end - i + 0.5) * bw;
      // диапазон цен
      let lo = Infinity, hi = -Infinity;
      for (let i = i0; i <= i1; i++) { lo = Math.min(lo, c[i].l); hi = Math.max(hi, c[i].h); }
      const incl = arr => { if (!arr) return; for (let i = i0; i <= i1; i++) { const v = arr[i]; if (v != null && isFinite(v)) { if (v < lo) lo = Math.min(lo, v); if (v > hi) hi = Math.max(hi, v); } } };
      if (L.ma) { incl(S.ema20); incl(S.sma50); }
      if (L.bb) { incl(S.bb.up); incl(S.bb.lo); }
      const pad = (hi - lo) * 0.06 || hi * 0.01; lo -= pad; hi += pad;
      const Y = p => 8 + (hi - p) / (hi - lo) * (ph - 8);
      this.geom = { X, Y, i0, i1, bw, lo, hi, ph };
      // сетка
      ctx.strokeStyle = col.grid; ctx.lineWidth = 1; ctx.fillStyle = col.text; ctx.font = '11px system-ui';
      const step = niceStep((hi - lo) / 6);
      for (let p = Math.ceil(lo / step) * step; p < hi; p += step) { const y = Math.round(Y(p)) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pw, y); ctx.stroke(); ctx.fillText(fmtP(p), pw + 6, y + 4); }
      const tfSec = g.DATA.TF_SEC[S.tf] || 86400, every = Math.max(1, Math.round(90 / bw));
      for (let i = i0; i <= i1; i++) if (i % every === 0) { const x = Math.round(X(i)) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 20); ctx.stroke(); ctx.fillText(tfSec < 86400 ? g.DATA.fmtTime(c[i].t) + ' ' + g.DATA.fmtDate(c[i].t).slice(0, 5) : g.DATA.fmtDate(c[i].t), x - 28, H - 6); }
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pw, H); ctx.clip();
      // облако Ишимоку
      if (L.ichimoku) {
        const { spanA, spanB, ten, kij, shift } = S.ichi, j1 = Math.min(i1 + shift, spanA.length - 1);
        for (let i = i0; i < j1; i++) {
          const a = spanA[i], b = spanB[i], a2 = spanA[i + 1], b2 = spanB[i + 1]; if (a == null || b == null || a2 == null || b2 == null) continue;
          ctx.fillStyle = a >= b ? 'rgba(38,166,91,.16)' : 'rgba(229,57,53,.16)';
          ctx.beginPath(); ctx.moveTo(X(i), Y(a)); ctx.lineTo(X(i + 1), Y(a2)); ctx.lineTo(X(i + 1), Y(b2)); ctx.lineTo(X(i), Y(b)); ctx.fill();
        }
        line(ctx, spanA, X, Y, i0, j1, 'rgba(38,166,91,.7)', 1); line(ctx, spanB, X, Y, i0, j1, 'rgba(229,57,53,.7)', 1);
        line(ctx, ten, X, Y, i0, i1, '#2196f3', 1.2); line(ctx, kij, X, Y, i0, i1, '#b71c1c', 1.2);
        const chik = c.map((_, i) => c[i + shift] ? c[i + shift].c : null); line(ctx, chik, X, Y, i0, i1, 'rgba(156,39,176,.7)', 1);
      }
      if (L.bb) { line(ctx, S.bb.up, X, Y, i0, i1, 'rgba(33,150,243,.8)', 1); line(ctx, S.bb.lo, X, Y, i0, i1, 'rgba(33,150,243,.8)', 1); line(ctx, S.bb.mid, X, Y, i0, i1, 'rgba(33,150,243,.5)', 1, [4, 3]); }
      if (L.ma) { line(ctx, S.ema20, X, Y, i0, i1, '#ff9800', 1.4); line(ctx, S.sma50, X, Y, i0, i1, '#03a9f4', 1.4); line(ctx, S.sma200, X, Y, i0, i1, '#e91e63', 1.6); }
      if (L.vwap) {
        const v = S.vwap.v, sd = S.vwap.sd;
        line(ctx, v, X, Y, i0, i1, '#9c27b0', 1.6);
        [1, 2, -1, -2].forEach(k => line(ctx, v.map((x, i) => x == null ? null : x + k * sd[i]), X, Y, i0, i1, Math.abs(k) === 1 ? 'rgba(156,39,176,.45)' : 'rgba(156,39,176,.28)', 1, [3, 3]));
      }
      const last = Math.min(i1, c.length - 1);
      if (L.volprofile) {
        const vp = I.volumeProfile(c, i0, last, 48);
        if (vp) {
          const maxW = pw * 0.22;
          vp.vol.forEach((v, k) => {
            const y1 = Y(vp.lo + (k + 1) * vp.step), y0 = Y(vp.lo + k * vp.step), w = v / vp.max * maxW, wb = vp.buy[k] / vp.max * maxW;
            const inVA = vp.lo + k * vp.step >= vp.val && vp.lo + (k + 1) * vp.step <= vp.vah + 1e-9;
            ctx.fillStyle = inVA ? 'rgba(38,166,91,.28)' : 'rgba(128,128,128,.18)'; ctx.fillRect(pw - wb, y1, wb, Math.max(1, y0 - y1 - 1));
            ctx.fillStyle = inVA ? 'rgba(229,57,53,.24)' : 'rgba(128,128,128,.12)'; ctx.fillRect(pw - w, y1, w - wb, Math.max(1, y0 - y1 - 1));
          });
          hline(ctx, Y(vp.poc), 0, pw, '#ffb300', 1.5, [6, 3], 'POC ' + fmtP(vp.poc));
          hline(ctx, Y(vp.vah), 0, pw, 'rgba(255,179,0,.5)', 1, [2, 4], 'VAH'); hline(ctx, Y(vp.val), 0, pw, 'rgba(255,179,0,.5)', 1, [2, 4], 'VAL');
        }
      }
      const atr = S.atr[last] || (c[last].c * 0.01);
      if (L.levels) {
        I.levels(c, S.piv, last, atr).forEach(lv => {
          if (lv.price < lo || lv.price > hi) return;
          const y = Y(lv.price), clr = lv.kind === 'S' ? col.up : col.down;
          ctx.fillStyle = lv.kind === 'S' ? 'rgba(38,166,91,.10)' : 'rgba(229,57,53,.10)';
          ctx.fillRect(0, Y(lv.price + atr * 0.15), pw, Math.max(2, Y(lv.price - atr * 0.15) - Y(lv.price + atr * 0.15)));
          hline(ctx, y, 0, pw, clr, lv.key ? 1.6 : 1, lv.key ? [] : [5, 4], (lv.kind === 'S' ? 'S ' : 'R ') + fmtP(lv.price) + (lv.key ? ' ★' : '') + ' ×' + lv.touches);
        });
      }
      if (L.liquidity) {
        I.liquidity(c, S.piv, last, atr).forEach(z => {
          if (z.p < lo || z.p > hi) return; const y = Y(z.p), x0 = X(z.i);
          ctx.fillStyle = z.type === 'H' ? 'rgba(255,152,0,.18)' : 'rgba(0,188,212,.18)';
          const h = Math.max(3, Math.abs(Y(z.p) - Y(z.p + atr * 0.25)));
          ctx.fillRect(x0, z.type === 'H' ? y - h : y, pw - x0, h);
          ctx.fillStyle = z.type === 'H' ? '#ff9800' : '#00acc1'; ctx.font = '10px system-ui';
          ctx.fillText((z.type === 'H' ? '$$$ ↑ ' : '$$$ ↓ ') + (z.n > 1 ? '×' + z.n : ''), Math.max(4, x0 + 2), z.type === 'H' ? y - h - 2 : y + h + 10);
        });
      }
      if (L.fibo) {
        const f = I.fibo(c, i0, last);
        f.levels.forEach(l => hline(ctx, Y(l.p), 0, pw, 'rgba(255,193,7,.75)', 1, [1, 3], (l.r * 100).toFixed(1) + '% ' + fmtP(l.p)));
      }
      if (L.trend) {
        I.trendlines(c, S.piv, last).forEach(t => {
          ctx.strokeStyle = t.type === 'L' ? col.up : col.down; ctx.lineWidth = 1.5; ctx.setLineDash([]);
          const xe = i1 + 3; ctx.beginPath(); ctx.moveTo(X(t.i1), Y(t.p1)); ctx.lineTo(X(xe), Y(t.p1 + t.slope * (xe - t.i1))); ctx.stroke();
        });
      }
      // свечи
      const cw = Math.max(1, bw * 0.7);
      for (let i = i0; i <= i1; i++) {
        const x = c[i], up = x.c >= x.o, cx = X(i);
        ctx.strokeStyle = ctx.fillStyle = up ? col.up : col.down; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(cx) + 0.5, Y(x.h)); ctx.lineTo(Math.round(cx) + 0.5, Y(x.l)); ctx.stroke();
        const yo = Y(x.o), yc = Y(x.c); ctx.fillRect(cx - cw / 2, Math.min(yo, yc), cw, Math.max(1, Math.abs(yo - yc)));
      }
      // развороты
      if (L.reversals) {
        S.piv.forEach(p => { if (p.i < i0 || p.i > i1 || p.conf > c.length - 1) return; arrow(ctx, X(p.i), p.type === 'H' ? Y(c[p.i].h) - 6 : Y(c[p.i].l) + 6, p.type === 'H' ? -1 : 1, p.type === 'H' ? col.down : col.up); });
      }
      if (L.patterns) {
        ctx.font = '10px system-ui';
        S.patterns.forEach(m => {
          if (m.i < i0 || m.i > i1) return; const x = X(m.i), name = g.ANALYSIS.L(g.CANDLES.P[m.key][0], g.CANDLES.P[m.key][1]);
          ctx.fillStyle = m.dir > 0 ? col.up : col.down;
          const y = m.dir > 0 ? Y(c[m.i].l) + 18 : Y(c[m.i].h) - 12;
          ctx.fillText((m.dir > 0 ? '▲' : '▼') + (bw > 9 ? ' ' + abbreviate(name) : ''), x - 4, y);
        });
      }
      if (L.gusev && this.extra.gusev) {
        this.extra.gusev.points.forEach(s => {
          if (s.i < i0 || s.i > i1) return; const x = X(s.i);
          const map = { BUY: [col.up, 'ПОКУПКА', 'BUY', 1], SELL: [col.down, 'ПРОДАЖА', 'SELL', -1], EXIT: ['#ff9800', 'ВЫХОД', 'EXIT', -1], AVOID: ['#9e9e9e', 'НЕ ПОК.', 'AVOID', -1] }[s.type];
          const y = map[3] > 0 ? Y(c[s.i].l) + 30 : Y(c[s.i].h) - 26;
          ctx.fillStyle = map[0]; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.3); ctx.fill();
          ctx.font = 'bold 10px system-ui'; ctx.fillText(g.ANALYSIS.L(map[1], map[2]), x + 6, y + 3);
          if (s.stop) { ctx.strokeStyle = col.down; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x - 6, Y(s.stop)); ctx.lineTo(x + 26, Y(s.stop)); ctx.stroke(); ctx.setLineDash([]); }
        });
      }
      // план сделки
      if (this.extra.plan && L.levels) {
        const p = this.extra.plan;
        [[p.stop, col.down, 'SL'], [p.t1, col.up, 'TP1'], [p.t2, col.up, 'TP2']].forEach(([v, cl, t]) => { if (v > lo && v < hi) hline(ctx, Y(v), pw * 0.72, pw, cl, 1.2, [6, 2], t + ' ' + fmtP(v)); });
      }
      ctx.restore();
      // объём
      let vmax = 0; for (let i = i0; i <= i1; i++) vmax = Math.max(vmax, c[i].v || 0);
      const vy0 = H - 20;
      for (let i = i0; i <= i1; i++) { const x = c[i], h = vmax ? (x.v || 0) / vmax * (volH - 6) : 0; ctx.fillStyle = x.c >= x.o ? 'rgba(38,166,91,.45)' : 'rgba(229,57,53,.45)'; ctx.fillRect(X(i) - cw / 2, vy0 - h, cw, h); }
      // последняя цена
      const lp = c[c.length - 1].c; if (lp > lo && lp < hi) { const y = Y(lp); ctx.fillStyle = lp >= c[c.length - 1].o ? col.up : col.down; ctx.fillRect(pw, y - 9, 64, 18); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.fillText(fmtP(lp), pw + 4, y + 4); hline(ctx, y, 0, pw, ctx.fillStyle === '#fff' ? col.up : 'rgba(128,128,128,.6)', 1, [2, 2]); }
      // перекрестие
      if (this.mouse && this.mouse.x < pw) {
        const i = Math.round(end - (pw - this.mouse.x) / bw + 0.5 - 1 + 0.5), k = Math.max(0, Math.min(c.length - 1, i));
        const x = X(k), y = this.mouse.y;
        ctx.strokeStyle = col.text; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 20); ctx.moveTo(0, y); ctx.lineTo(pw, y); ctx.stroke(); ctx.setLineDash([]);
        if (y < ph) { const p = hi - (y - 8) / (ph - 8) * (hi - lo); ctx.fillStyle = col.fg; ctx.fillRect(pw, y - 9, 64, 18); ctx.fillStyle = col.bg; ctx.font = '11px system-ui'; ctx.fillText(fmtP(p), pw + 4, y + 4); }
        this.showLegend(k);
      } else this.showLegend(c.length - 1);
    }
    showLegend(k) {
      if (!this.legend) return; const x = this.c[k]; if (!x) return;
      const ch = k > 0 ? (x.c / this.c[k - 1].c - 1) * 100 : 0;
      const dt = (g.DATA.TF_SEC[this.S.tf] || 86400) < 86400 ? g.DATA.fmtDT(x.t) : g.DATA.fmtDate(x.t);
      this.legend.innerHTML = `<b>${dt}</b> O <b>${fmtP(x.o)}</b> H <b>${fmtP(x.h)}</b> L <b>${fmtP(x.l)}</b> C <b>${fmtP(x.c)}</b> <span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</span> V <b>${fmtV(x.v)}</b>`;
    }
  }
  function line(ctx, arr, X, Y, i0, i1, color, w, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); let on = false;
    for (let i = i0; i <= i1 && i < arr.length; i++) { const v = arr[i]; if (v == null || !isFinite(v)) { on = false; continue; } const x = X(i), y = Y(v); if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  function hline(ctx, y, x0, x1, color, w, dash, label) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
    if (label) { ctx.fillStyle = color; ctx.font = '10px system-ui'; ctx.fillText(label, x0 + 4, y - 3); }
  }
  function arrow(ctx, x, y, dir, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y - 7 * dir); ctx.lineTo(x + 4, y - 7 * dir); ctx.fill(); }
  function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r))), n = r / p; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p; }
  function fmtP(p) { const a = Math.abs(p); return a >= 1000 ? p.toFixed(0) : a >= 10 ? p.toFixed(2) : a >= 1 ? p.toFixed(3) : p.toFixed(5); }
  function fmtV(v) { return v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v || 0)); }
  function abbreviate(s) { return s.split(' ').map(w => w.length > 6 ? w.slice(0, 5) + '.' : w).join(' ').slice(0, 18); }
  g.Chart = Chart; g.fmtV = fmtV; g.fmtP = fmtP;
})(window);

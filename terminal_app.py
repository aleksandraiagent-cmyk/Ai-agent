#!/usr/bin/env python3
"""
TerminalApp — «Терминал анализа акций — сигнал «Покупать / Продавать»» на компьютере.

Показывает тот же терминал, что и в Claude (app/index.html), в браузере или в отдельном окне
и сам выполняет задачи его кнопок через Yahoo Finance (yfinance):
  • «⟳ Обновить» — все тикеры или один (котировки 1д/1ч/5м/1мес, новости, отчётность, справедливая цена);
  • поиск любого тикера Yahoo — загружает его отдельно (data/extra.json);
  • «Аналитики» — рейтинги и целевые цены банков за 30 дней из Yahoo;
  • «Новости Форекс» — сбор через Claude с веб-поиском (нужен ANTHROPIC_API_KEY), иначе — последние сохранённые.

Запуск:
    python terminal_app.py            # сервер + браузер
    python terminal_app.py --window   # отдельное окно (pywebview)
    python terminal_app.py --lan      # открыть с телефона в той же Wi-Fi сети

Учебный инструмент. Не является инвестиционной рекомендацией.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import socket
import sys
import threading
import time
import traceback
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

FROZEN = bool(getattr(sys, "frozen", False))
BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
APP_DIR = BASE_DIR / "app"                      # index.html + исходный снимок data/
CLAUDE_MODEL = "claude-opus-5-5"

# идентификаторы задач, которые присылает страница терминала (fire_trigger)
TRIG_REFRESH = "trig_017W1ytcraAtywN9U9kUV1MV"   # «ТИКЕР: ALL» / «ТИКЕР: XXX»
TRIG_ANY = "trig_01QLbDpYb6pWUsBrjcDyruCi"       # «ЗАПРОС: <тикер или название>»
TRIG_ANALYSTS = "trig_01Ej9NUAUDdbufc8EKtBpXCP"
TRIG_FOREX = "trig_0143qLYrs1opxBfZvpYQW3bG"

# Yahoo-символы для тикеров терминала, у которых они отличаются
YAHOO_MAP = {"US500": "^GSPC", "NDX": "^NDX", "LCO1": "BZ=F"}


# ------------------------------------------------------------------ папка данных
def _writable(d: Path) -> bool:
    try:
        d.mkdir(parents=True, exist_ok=True)
        probe = d / ".write_test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


def _pick_data_root() -> Path:
    cands = []
    if os.environ.get("TERMINAL_DATA_DIR"):
        cands.append(Path(os.environ["TERMINAL_DATA_DIR"]))
    cands.append((Path(sys.executable).resolve().parent if FROZEN else Path.cwd()) / "terminal_data")
    home = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
    cands.append(Path(home) / "TerminalApp" / "terminal_data")
    cands.append(Path(os.environ.get("TEMP", "/tmp")) / "TerminalApp" / "terminal_data")
    for d in cands:
        if _writable(d):
            return d
    return cands[-1]


DATA_ROOT = _pick_data_root()
DATA = DATA_ROOT / "data"


def seed_data():
    """При первом запуске кладём снимок данных из Claude, чтобы терминал сразу был с котировками."""
    DATA.mkdir(parents=True, exist_ok=True)
    src = APP_DIR / "data"
    if not src.is_dir():
        return
    for f in src.glob("*.json"):
        dst = DATA / f.name
        if not dst.exists():
            shutil.copyfile(f, dst)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def load_json(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return default


def save_json(p: Path, obj):
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, p)


# ------------------------------------------------------------------ yfinance: общие функции
def yf():
    import yfinance  # noqa: WPS433
    return yfinance


def num(x):
    try:
        x = float(x)
        return x if math.isfinite(x) else None
    except Exception:  # noqa: BLE001
        return None


def r6(v):
    v = float(v)
    return round(v, 6 if abs(v) < 1 else 4)


def series(t, period, interval, keep, daily=False):
    try:
        h = t.history(period=period, interval=interval, auto_adjust=False, actions=False, prepost=False)
    except Exception:  # noqa: BLE001
        return None
    if h is None or not len(h):
        return None
    h = h.dropna(subset=["Open", "High", "Low", "Close"]).tail(keep)

    def ts(ix):
        if daily:  # дневки и месячные — полночь UTC календарной даты (как в выгрузке Claude)
            return int(datetime(ix.year, ix.month, ix.day, tzinfo=timezone.utc).timestamp())
        return int(ix.timestamp())

    return {
        "t": [ts(ix) for ix in h.index],
        "o": [r6(v) for v in h["Open"]], "h": [r6(v) for v in h["High"]],
        "l": [r6(v) for v in h["Low"]], "c": [r6(v) for v in h["Close"]],
        "v": [int(v) if num(v) else 0 for v in h["Volume"]],
    }


_SUFFIX = {"inc", "corp", "corporation", "co", "ltd", "plc", "ag", "sa", "nv", "se", "group", "holdings",
           "company", "technologies", "the", "etf", "trust", "fund", "usd", "class", "a", "b", "ishares",
           "invesco", "spdr"}


def news_match(sym, name):
    """Новость про бумагу — только если она названа в заголовке: тикер или главное слово названия."""
    base = sym.split("-")[0].split(".")[0].lstrip("^").split("=")[0]
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z&'\-]+", name or "") if w.lower().strip(".") not in _SUFFIX]
    pats = []
    if words:
        pats.append(re.compile(r"(?<!\w)" + re.escape(words[0]) + r"(?!\w)", re.I))
    if len(base) >= 2:
        pats.append(re.compile(r"(?<![\w$])\$?" + re.escape(base) + r"(?!\w)"))
    return lambda title: any(p.search(title) for p in pats) if pats else True


def _news_items(t):
    items = []
    try:
        items = t.get_news(count=40) if hasattr(t, "get_news") else (t.news or [])
    except Exception:  # noqa: BLE001
        items = []
    if not items:
        try:
            items = yf().Search(t.ticker, max_results=1, news_count=40).news or []
        except Exception:  # noqa: BLE001
            items = []
    return items


def news_of(t, name="", general_ok=False):
    match = news_match(t.ticker, name)
    direct, general, seen = [], [], set()
    items = list(_news_items(t))
    queries = [q for q in dict.fromkeys([name, t.ticker.lstrip("^")]) if q]
    for q in queries:  # мало новостей по тикеру — добираем поиском Yahoo по названию
        if sum(1 for n in items if match(((n.get("content", n) if isinstance(n, dict) else {}).get("title") or ""))) >= 12:
            break
        try:
            items += yf().Search(q, max_results=1, news_count=40).news or []
        except Exception:  # noqa: BLE001
            pass
    for n in items:
        c = n.get("content", n) if isinstance(n, dict) else {}
        title = c.get("title")
        if not title or title in seen:
            continue
        seen.add(title)
        pub = (c.get("provider") or {}).get("displayName") or c.get("publisher") or "Yahoo Finance"
        ts = c.get("pubDate") or c.get("providerPublishTime")
        if isinstance(ts, str):
            try:
                ts = int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
            except Exception:  # noqa: BLE001
                ts = int(time.time())
        link = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url") or c.get("link") or "")
        item = {"title": title, "pub": pub, "t": int(ts or time.time()), "link": link if link.startswith("https://") else ""}
        if match(title):
            direct.append({**item, "direct": True})
        else:
            general.append({**item, "direct": False})
    out = direct[:12]
    if general_ok and len(out) < 12:  # индексы, ETF, фьючерсы: добираем общими новостями рынка (категория «Рынок»)
        out += general[:12 - len(out)]
    out.sort(key=lambda x: x["t"], reverse=True)
    return out


def fair_value(info, price):
    eps, feps, bv = num(info.get("trailingEps")), num(info.get("forwardEps")), num(info.get("bookValue"))
    sh = num(info.get("sharesOutstanding"))
    fcf, cash, debt = num(info.get("freeCashflow")), num(info.get("totalCash")), num(info.get("totalDebt"))
    fcfps = fcf / sh if fcf and sh else None
    netcash = (cash or 0) - (debt or 0) if (cash is not None or debt is not None) else None
    netcashps = netcash / sh if netcash is not None and sh else None
    g = num(info.get("earningsGrowth"))
    if (g is None or g <= 0) and eps and feps and eps > 0:
        g = feps / eps - 1
    g = min(max(g or 0.05, 0.02), 0.25)
    m = {}
    if eps and bv and eps > 0 and bv > 0:
        m["graham"] = math.sqrt(22.5 * eps * bv)
    if fcfps and fcfps > 0:
        r, tg, v, f = 0.09, 0.03, 0, fcfps
        for y in range(1, 11):
            f *= 1 + (g if y <= 5 else g / 2)
            v += f / (1 + r) ** y
        v += f * (1 + tg) / (r - tg) / (1 + r) ** 10
        m["dcf"] = v + (netcashps or 0)
    base = feps if feps and feps > 0 else eps
    if base and base > 0:
        m["lynch"] = base * g * 100
    a = {"mean": num(info.get("targetMeanPrice")), "median": num(info.get("targetMedianPrice")),
         "low": num(info.get("targetLowPrice")), "high": num(info.get("targetHighPrice")),
         "n": int(info.get("numberOfAnalystOpinions") or 0), "rec": info.get("recommendationKey") or "none"}
    if a["median"] or a["mean"]:
        m["analysts"] = a["median"] or a["mean"]
    if not m:
        return None
    w = {"analysts": .4, "dcf": .25, "lynch": .2, "graham": .15}
    fair = sum(m[k] * w[k] for k in m) / sum(w[k] for k in m)
    return {"fair": round(fair, 4), "lo": round(min(m.values()), 4), "hi": round(max(m.values()), 4),
            "models": {k: round(v, 4) for k, v in m.items()},
            "analysts": a if a["n"] else None, "growth": round(g, 4),
            "inputs": {"eps": eps, "feps": feps, "bv": bv, "pe": num(info.get("trailingPE")), "fpe": num(info.get("forwardPE")),
                       "fcfps": fcfps, "netcashps": netcashps}}


def _ext_session(t):
    """Премаркет и постмаркет по 5-минуткам с расширенными часами."""
    out = {}
    try:
        h = t.history(period="5d", interval="5m", prepost=True, auto_adjust=False, actions=False)
        if h is None or not len(h):
            return out
        h = h.tz_convert("America/New_York")
        days = sorted({ix.date() for ix in h.index})
        for key, cond in (("pre", lambda ix: ix.hour * 60 + ix.minute < 570),
                          ("post", lambda ix: ix.hour * 60 + ix.minute >= 960)):
            for d in reversed(days):
                part = h[[ix.date() == d and cond(ix) for ix in h.index]]
                if len(part):
                    out[key] = {"price": r6(part["Close"].iloc[-1]), "t": int(part.index[-1].timestamp()) + 300,
                                "hi": r6(part["High"].max()), "lo": r6(part["Low"].min()), "vol": 0}
                    break
    except Exception:  # noqa: BLE001
        pass
    return out


def build_quote(t, info, d1):
    price = num(info.get("regularMarketPrice")) or (d1["c"][-1] if d1 else None)
    q = {"state": info.get("marketState") or "CLOSED", "type": info.get("quoteType") or "EQUITY", "price": price,
         "prev": num(info.get("regularMarketPreviousClose")) or (d1["c"][-2] if d1 and len(d1["c"]) > 1 else price),
         "t": int(info.get("regularMarketTime") or (d1["t"][-1] if d1 else time.time())), "cur": info.get("currency") or "USD"}
    ext = _ext_session(t)
    for k, pk, tk in (("pre", "preMarketPrice", "preMarketTime"), ("post", "postMarketPrice", "postMarketTime")):
        p = num(info.get(pk))
        if k in ext:
            if p:
                ext[k]["price"] = p
                ext[k]["t"] = int(info.get(tk) or ext[k]["t"])
            q[k] = ext[k]
        elif p:
            q[k] = {"price": p, "t": int(info.get(tk) or 0), "hi": p, "lo": p, "vol": 0}
    return q


def _ts_any(v):
    if v is None:
        return None
    try:
        if isinstance(v, (int, float)):
            return int(v)
        if hasattr(v, "timestamp"):
            if getattr(v, "tzinfo", None) is None and isinstance(v, datetime):
                v = v.replace(tzinfo=timezone.utc)
            return int(v.timestamp())
        if hasattr(v, "year"):
            return int(datetime(v.year, v.month, v.day, tzinfo=timezone.utc).timestamp())
    except Exception:  # noqa: BLE001
        return None
    return None


def events(t, info):
    now = time.time()
    ev = {}
    earn = None
    for k in ("earningsTimestampStart", "earningsTimestamp", "earningsTimestampEnd"):
        v = _ts_any(info.get(k))
        if v and v > now - 86400:
            earn = v
            break
    if not earn:
        try:
            cal = t.calendar or {}
            for d in cal.get("Earnings Date") or []:
                v = _ts_any(d)
                if v and v > now - 86400:
                    earn = v
                    break
        except Exception:  # noqa: BLE001
            pass
    if earn:
        ev["earn"] = earn
        ev["earnEst"] = bool(info.get("isEarningsDateEstimate", info.get("earningsTimestampStart") != info.get("earningsTimestampEnd")))
    try:
        ed = t.get_earnings_dates(limit=12)
        past = [int(ix.timestamp()) for ix in ed.index if ix.timestamp() < now] if ed is not None else []
        if past:
            ev["earnLast"] = max(past)
    except Exception:  # noqa: BLE001
        pass
    if "earnLast" not in ev:
        v = _ts_any(info.get("earningsTimestamp"))
        if v and v < now:
            ev["earnLast"] = v
    year_ago = now - 400 * 86400  # старые дивидендные даты (например, у бумаг без дивидендов) не показываем
    ex = _ts_any(info.get("exDividendDate"))
    dv = _ts_any(info.get("dividendDate"))
    if ex and ex > year_ago:
        ev["exDiv"] = ex
    if dv and dv > year_ago:
        ev["div"] = dv
    if num(info.get("dividendRate")) and ("exDiv" in ev or "div" in ev):
        ev["divRate"] = num(info.get("dividendRate"))
    return ev


# ------------------------------------------------------------------ финансовая отчётность (блок fin)
def _stmt(df, rows, n):
    if df is None or not len(df.columns):
        return None
    cols = list(df.columns)[:n]
    out = {"p": [c.strftime("%Y-%m-%d") for c in cols]}
    for key, names in rows.items():
        vals = None
        for nm in names:
            if nm in df.index:
                vals = [num(df.loc[nm, c]) for c in cols]
                break
        out[key] = vals if vals is not None else [None] * len(cols)
    return out


IS_ROWS = {"rev": ["Total Revenue", "Operating Revenue"], "gp": ["Gross Profit"], "op": ["Operating Income"],
           "ni": ["Net Income", "Net Income Common Stockholders"], "eps": ["Diluted EPS", "Basic EPS"],
           "ebitda": ["EBITDA", "Normalized EBITDA"], "rd": ["Research And Development"]}
BS_ROWS = {"assets": ["Total Assets"], "liab": ["Total Liabilities Net Minority Interest"],
           "eq": ["Stockholders Equity", "Common Stock Equity"],
           "cash": ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"], "debt": ["Total Debt"]}
CF_ROWS = {"ocf": ["Operating Cash Flow"], "capex": ["Capital Expenditure"], "fcf": ["Free Cash Flow"]}


def _qend(d):
    """Конец календарного квартала, в который попадает дата d."""
    m = ((d.month - 1) // 3 + 1) * 3
    nxt = datetime(d.year + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    return nxt - timedelta(days=1)


def _prev_qend(d):
    """Последний конец квартала, который строго раньше даты d."""
    start = datetime(d.year, ((d.month - 1) // 3) * 3 + 1, 1, tzinfo=timezone.utc)
    return start - timedelta(days=1)


def _fq(end, fy_end_month):
    if not fy_end_month:
        return ""
    q = ((end.month - fy_end_month - 1) % 12) // 3 + 1
    y = end.year if end.month <= fy_end_month else end.year + 1
    return f"{q}Q{y}"


def _est_table(df):
    if df is None or not len(df):
        return None
    out = {}
    for period, row in df.iterrows():
        out[str(period)] = {str(k): num(v) for k, v in row.items() if num(v) is not None}
    return out


def build_fin(t, info, old_fin, rev_hist):
    fin = {}
    old_fin = old_fin or {}

    def part(name, fn):
        try:
            v = fn()
            if v:
                fin[name] = v
                return
        except Exception as exc:  # noqa: BLE001
            log(f"   {t.ticker} fin.{name}: {exc}")
        if name in old_fin:
            fin[name] = old_fin[name]

    part("q", lambda: {k: v for k, v in (("is", _stmt(t.quarterly_income_stmt, IS_ROWS, 6)),
                                          ("bs", _stmt(t.quarterly_balance_sheet, BS_ROWS, 7)),
                                          ("cf", _stmt(t.quarterly_cashflow, CF_ROWS, 7))) if v})
    part("a", lambda: {k: v for k, v in (("is", _stmt(t.income_stmt, IS_ROWS, 4)),
                                          ("bs", _stmt(t.balance_sheet, BS_ROWS, 4)),
                                          ("cf", _stmt(t.cashflow, CF_ROWS, 4))) if v})

    def eh():
        df = t.earnings_history
        if df is None or not len(df):
            return None
        rows = []
        for ix, r in df.iterrows():
            q = ix.strftime("%Y-%m-%d") if hasattr(ix, "strftime") else str(ix)[:10]
            sp = num(r.get("surprisePercent"))
            rows.append({"q": q, "est": num(r.get("epsEstimate")), "act": num(r.get("epsActual")), "sp": sp})
        rows.sort(key=lambda x: x["q"])
        return rows[-5:]
    part("eh", eh)

    fy_ts = _ts_any(info.get("lastFiscalYearEnd"))
    fy_m = datetime.fromtimestamp(fy_ts, timezone.utc).month if fy_ts else None

    def rel():
        ed = t.get_earnings_dates(limit=16)
        if ed is None or not len(ed):
            return None
        now = time.time()
        rows = []
        for ix, r in ed.iterrows():
            rd = int(ix.timestamp())
            if rd > now:
                continue
            act, est = num(r.get("Reported EPS")), num(r.get("EPS Estimate"))
            sp = num(r.get("Surprise(%)"))
            end = _prev_qend(datetime.fromtimestamp(rd, timezone.utc) - timedelta(days=10))
            end_d = datetime(end.year, end.month, end.day, tzinfo=timezone.utc)
            rows.append({"rd": rd, "end": int(end_d.timestamp()), "cq": f"{(end_d.month - 1) // 3 + 1}Q{end_d.year}",
                         "fq": _fq(end_d, fy_m), "act": act, "est": est, "sp": sp / 100 if sp is not None else None})
        rows.sort(key=lambda x: x["rd"])
        return rows[-5:]
    part("rel", rel)

    def est():
        e = {"eps": _est_table(t.earnings_estimate), "rev": _est_table(t.revenue_estimate)}
        return {k: v for k, v in e.items() if v}
    part("est", est)

    ev = events(t, info)
    E = fin.get("est") or {}

    def nxt():
        last_end = max([r["end"] for r in fin.get("rel") or []] or [0])
        base = datetime.fromtimestamp(last_end, timezone.utc) if last_end else datetime.now(timezone.utc) - timedelta(days=60)
        end = _qend(base + timedelta(days=45))
        e0, r0 = (E.get("eps") or {}).get("0q") or {}, (E.get("rev") or {}).get("0q") or {}
        return {"rd": ev.get("earn"), "estDate": bool(ev.get("earnEst")),
                "end": int(datetime(end.year, end.month, end.day, tzinfo=timezone.utc).timestamp()),
                "cq": "", "fq": "", "epsAvg": e0.get("avg"), "epsLow": e0.get("low"), "epsHigh": e0.get("high"),
                "revAvg": r0.get("avg"), "revLow": r0.get("low"), "revHigh": r0.get("high")}
    part("next", nxt)

    g = lambda k: num(info.get(k))  # noqa: E731
    fin["r"] = {k: v for k, v in {
        "mcap": g("marketCap"), "ev": g("enterpriseValue"), "pe": g("trailingPE"), "fpe": g("forwardPE"),
        "peg": g("trailingPegRatio") or g("pegRatio"), "pb": g("priceToBook"), "ps": g("priceToSalesTrailing12Months"),
        "gm": g("grossMargins"), "om": g("operatingMargins"), "pm": g("profitMargins"), "roe": g("returnOnEquity"),
        "roa": g("returnOnAssets"), "de": g("debtToEquity"), "cr": g("currentRatio"), "rg": g("revenueGrowth"),
        "eg": g("earningsGrowth"), "dy": g("dividendYield"), "pr": g("payoutRatio"), "beta": g("beta"),
        "revTtm": g("totalRevenue"), "fcfTtm": g("freeCashflow"), "epsTtm": g("trailingEps"), "epsFwd": g("forwardEps"),
    }.items() if v is not None} or old_fin.get("r", {})

    # история прогнозов выручки по кварталам: нужна, чтобы после отчёта сравнить факт с ожиданием
    hist = dict(rev_hist or {})
    hist.update(old_fin.get("revEst") or {})
    nx = fin.get("next") or {}
    if nx.get("end") and nx.get("revAvg"):
        key = datetime.fromtimestamp(nx["end"], timezone.utc).strftime("%Y-%m-%d")
        hist[key] = {"avg": nx["revAvg"], "t": int(time.time())}
    if hist:
        fin["revEst"] = dict(sorted(hist.items())[-8:])
    return fin, ev


# ------------------------------------------------------------------ выгрузка одного тикера
def fetch_doc(tk: str, yahoo: str, name_hint: str | None, old: dict | None, rev_hist=None) -> dict:
    t = yf().Ticker(yahoo)
    try:
        info = t.info or {}
    except Exception:  # noqa: BLE001
        info = {}
    qt = info.get("quoteType") or ((old or {}).get("quote") or {}).get("type") or "EQUITY"
    d1 = series(t, "5y", "1d", 1255, daily=True)
    if not d1 or len(d1["t"]) < 60:
        raise RuntimeError("Yahoo не вернул дневную историю")
    name = name_hint or (old or {}).get("name") or info.get("longName") or info.get("shortName") or yahoo
    mkt = (old or {}).get("mkt") or ("CR" if qt == "CRYPTOCURRENCY" else "CM" if qt == "FUTURE" else "US")
    doc = {"tk": tk, "yahoo": yahoo, "name": name, "mkt": mkt, "updated": int(time.time()), "1d": d1}
    for key, per, iv in (("1h", "730d", "1h"), ("5m", "60d", "5m")):
        s = series(t, per, iv, 1500)
        if s and len(s["t"]) >= 60:
            doc[key] = s
        elif old and key in old:
            doc[key] = old[key]
    s = series(t, "max", "1mo", 100000, daily=True)
    if s and len(s["t"]) >= 12:
        doc["1mo"] = s
    elif old and "1mo" in old:
        doc["1mo"] = old["1mo"]
    news = news_of(t, info.get("longName") or name, general_ok=qt in ("INDEX", "FUTURE", "CURRENCY", "ETF"))
    doc["news"] = news or (old or {}).get("news", [])
    q = build_quote(t, info, d1)
    q["type"] = qt
    ev = {}
    if qt == "EQUITY":
        fin, ev = build_fin(t, info, (old or {}).get("fin"), rev_hist)
        doc["fv"] = fair_value(info, q["price"])
        doc["fin"] = fin
    else:
        doc["fv"] = None
    if qt == "EQUITY":
        q["ev"] = ev
    doc["quote"] = q
    return doc


def index_entry(doc, old_entry):
    e = {"name": (old_entry or {}).get("name") or doc["name"], "mkt": doc["mkt"], "last": doc["quote"]["price"],
         "type": doc["quote"]["type"], "intervals": [k for k in ("1d", "1h", "5m", "1mo") if k in doc],
         "news": len(doc.get("news") or [])}
    if doc["quote"].get("ev"):
        e["ev"] = doc["quote"]["ev"]
    if (doc.get("fin") or {}).get("revEst"):
        e["revEst"] = doc["fin"]["revEst"]
    return e


# ------------------------------------------------------------------ задачи кнопок
JOB_LOCK = threading.Lock()
BUSY = {}


def run_job(name, fn, *a):
    with JOB_LOCK:
        if BUSY.get(name):
            return False
        BUSY[name] = True

    def wrap():
        try:
            fn(*a)
        except Exception:  # noqa: BLE001
            log(f"Ошибка задачи «{name}»:\n" + traceback.format_exc())
        finally:
            BUSY[name] = False
    threading.Thread(target=wrap, daemon=True).start()
    return True


def job_refresh(which: str):
    idx = load_json(DATA / "index.json", {"tickers": {}}) or {"tickers": {}}
    tickers = idx.get("tickers") or {}
    extra = (load_json(DATA / "extra.json", {}) or {}).get("tickers") or {}
    if which != "ALL":
        if which in extra and which not in tickers:
            return job_any(extra[which].get("yahoo") or which)
        if which not in tickers:
            log(f"Тикера {which} нет в списке терминала")
            return
        names = [which]
    else:
        names = list(tickers)
    log(f"Обновление котировок Yahoo: {len(names)} тикеров…")
    t0 = time.time()
    done, fails = [], []

    def one(tk):
        old = load_json(DATA / f"{tk}.json")
        yahoo = (old or {}).get("yahoo") or YAHOO_MAP.get(tk, tk)
        try:
            doc = fetch_doc(tk, yahoo, (tickers.get(tk) or {}).get("name"), old, (tickers.get(tk) or {}).get("revEst"))
            save_json(DATA / f"{tk}.json", doc)
            done.append(tk)
            log(f"  ✓ {tk} ({len(done)}/{len(names)})")
            return tk, doc
        except Exception as exc:  # noqa: BLE001
            fails.append(tk)
            log(f"  ✗ {tk}: {exc}")
            return tk, None

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(one, names))
    if which == "ALL" and done:
        new_t = {}
        for tk, doc in results:
            new_t[tk] = index_entry(doc, tickers.get(tk)) if doc else tickers.get(tk)
        idx = {"updated": int(time.time()), "source": "Yahoo Finance (yfinance)", "tickers": new_t}
        save_json(DATA / "index.json", idx)
    log(f"Готово: обновлено {len(done)} из {len(names)} за {int(time.time() - t0)} с"
        + (f"; не удалось: {', '.join(fails)}" if fails else ""))


def _resolve(q):
    q = q.strip()
    cand = q.upper().replace(" ", "")
    if re.fullmatch(r"[A-Z0-9.\-=^]{1,15}", cand):
        try:
            if len(yf().Ticker(cand).history(period="5d")):
                return cand
        except Exception:  # noqa: BLE001
            pass
    try:
        res = yf().Search(q, max_results=8, news_count=0).quotes
    except Exception:  # noqa: BLE001
        res = []
    for r in res:
        if r.get("symbol") and r.get("quoteType") in ("EQUITY", "ETF", "CRYPTOCURRENCY", "INDEX", "CURRENCY", "FUTURE", "MUTUALFUND"):
            return r["symbol"]
    return res[0]["symbol"] if res and res[0].get("symbol") else None


def _extra_save(mut):
    xp = DATA / "extra.json"
    ex = load_json(xp, None) or {"v": 1, "tickers": {}}
    mut(ex)
    ex["updated"] = int(time.time())
    save_json(xp, ex)


def job_any(query: str):
    query = re.sub(r"[^\w .&\-=^]", "", query.strip())[:60].strip()
    if not query:
        return
    log(f"Поиск тикера «{query}» на Yahoo…")
    sym = _resolve(query)
    if not sym:
        _extra_save(lambda ex: ex.setdefault("fail", {}).__setitem__(query.lower(), {"t": int(time.time()), "err": "не найден на Yahoo"}))
        log(f"  «{query}» не найден на Yahoo")
        return
    tk = re.sub(r"[^A-Z0-9]", "", sym.upper())[:14] or "X"
    idx_t = (load_json(DATA / "index.json", {}) or {}).get("tickers") or {}
    if tk in idx_t:  # тикер из основного списка — обычное обновление
        return job_refresh(tk)
    old = load_json(DATA / f"{tk}.json")
    try:
        doc = fetch_doc(tk, sym, None, old)
    except Exception as exc:  # noqa: BLE001
        _extra_save(lambda ex: ex.setdefault("fail", {}).__setitem__(query.lower(), {"t": int(time.time()), "err": "мало истории котировок"}))
        log(f"  {sym}: {exc}")
        return
    info_type = doc["quote"]["type"]
    if info_type not in ("EQUITY", "ETF", "FUTURE"):
        doc["mkt"] = "CR" if info_type == "CRYPTOCURRENCY" else "OT"
    save_json(DATA / f"{tk}.json", doc)
    q = doc["quote"]

    def mut(ex):
        prev = ex.get("tickers", {}).get(tk, {})
        ex.setdefault("tickers", {})[tk] = {
            "name": doc["name"], "mkt": doc["mkt"], "yahoo": sym, "cur": q["cur"], "last": q["price"],
            "intervals": [k for k in ("1d", "1h", "5m") if k in doc], "news": len(doc["news"]), "q": query.lower(),
            "added": prev.get("added") or int(time.time()), "updated": doc["updated"]}
        ex.get("fail", {}).pop(query.lower(), None)
    _extra_save(mut)
    log(f"  ✓ {tk} ({doc['name']}) загружен")


def job_analysts():
    path = DATA / "analysts.json"
    old = load_json(path, {}) or {}
    old_t = old.get("tickers") or {}
    names = list(old_t) or [k for k, v in ((load_json(DATA / "index.json", {}) or {}).get("tickers") or {}).items() if v.get("type") == "EQUITY"]
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    log(f"Сбор действий аналитиков из Yahoo: {len(names)} акций…")
    out = {}
    total = 0
    for tk in names:
        prev = old_t.get(tk) or {}
        acts = []
        try:
            ud = yf().Ticker(YAHOO_MAP.get(tk, tk)).upgrades_downgrades
            if ud is not None and len(ud):
                for ix, r in ud.iterrows():
                    dt = ix.to_pydatetime() if hasattr(ix, "to_pydatetime") else ix
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    if dt < cutoff:
                        continue
                    action = str(r.get("Action") or "").lower()
                    pt, ptp = num(r.get("currentPriceTarget")), num(r.get("priorPriceTarget"))
                    pt = pt if pt and pt > 0 else None
                    ptp = ptp if ptp and ptp > 0 else None
                    kind = {"up": "up", "down": "down", "init": "init"}.get(action)
                    if not kind:
                        kind = "pt_up" if pt and ptp and pt > ptp else "pt_down" if pt and ptp and pt < ptp else "reit"
                    a = {"t": dt.strftime("%Y-%m-%d"), "firm": str(r.get("Firm") or ""), "kind": kind}
                    if r.get("ToGrade"):
                        a["rating"] = str(r.get("ToGrade"))
                    if r.get("FromGrade") and kind in ("up", "down"):
                        a["ratingPrev"] = str(r.get("FromGrade"))
                    if pt:
                        a["pt"] = pt
                    if ptp:
                        a["ptPrev"] = ptp
                    acts.append(a)
        except Exception as exc:  # noqa: BLE001
            log(f"  {tk}: {exc}")
        seen = {(a["t"], a["firm"].lower()) for a in acts}
        cut = cutoff.strftime("%Y-%m-%d")
        for a in prev.get("actions") or []:  # сохраняем найденное раньше (с пояснениями и ссылками), если оно не старше 30 дней
            key = (a.get("t"), str(a.get("firm", "")).lower())
            if a.get("t", "") >= cut and key not in seen:
                acts.append(a)
                seen.add(key)
            elif key in seen:
                for b in acts:
                    if (b["t"], b["firm"].lower()) == key:
                        for k in ("note", "src"):
                            if a.get(k) and not b.get(k):
                                b[k] = a[k]
        acts.sort(key=lambda a: a.get("t", ""), reverse=True)
        acts = acts[:12]
        total += len(acts)
        out[tk] = {"summary": prev.get("summary", ""), "actions": acts}
        time.sleep(0.2)
    save_json(path, {"v": 1, "updated": int(time.time()), "asOf": datetime.now().strftime("%Y-%m-%d"), "tickers": out})
    log(f"Готово: {len(out)} акций, {total} действий аналитиков")


# ------------------------------------------------------------------ Claude (по желанию)
def claude_available() -> bool:
    try:
        import anthropic  # noqa: F401,WPS433
    except ImportError:
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def job_forex():
    import anthropic  # noqa: WPS433
    path = DATA / "forex_news.json"
    cur = load_json(path, {}) or {}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log("Сбор новостей Форекс через Claude с веб-поиском (5–10 минут)…")
    prompt = (
        "Обнови ленту «Новости Форекс» для учебного терминала. Ниже текущий JSON — образец структуры и прошлые новости.\n"
        "Через веб-поиск собери: а) главные новости Форекс за последние 72 часа (центробанки ФРС, ЕЦБ, Банк Англии, Банк Японии, "
        "РБА, РБНЗ, Банк Канады, ШНБ; инфляция, занятость, ВВП, PMI, розничные продажи; геополитика, нефть, золото, индексы США, биткоин); "
        "б) новости SolarEdge (SEDG), SpaceX (SPCX), Tower Semiconductor (TSEM) за 7 дней; в) экономический календарь с сегодняшнего дня "
        f"({today}) на 7 дней: время, прогноз, предыдущее, у вышедших — факт; плюс события SEDG, SPCX, TSEM в эти дни.\n"
        "Только факты из источников; не выдумывать цифры и время (неизвестное — пустая строка, неизвестное время — dateOnly: true).\n"
        "Верни ТОЛЬКО JSON той же структуры: v=1, updated=Unix-время, asOf=сегодня, note — как есть, instruments — тот же список из 15 "
        "в том же порядке с теми же name (level обновить, если есть свежий); news — 15–30 новостей за 7 дней (поля id, t ISO UTC, dateOnly, "
        "cat, imp 1–3, title, why по-русски, effects {символ: −3…3} только для инструментов из списка, src [{name,url}] https); "
        "calendar — события на 7 дней (t, dateOnly, cur, imp, event, fc, prev, act, scen [2 исхода], above, note, src).\n\n"
        "Текущий JSON:\n" + json.dumps(cur, ensure_ascii=False))
    client = anthropic.Anthropic()
    tools = [{"type": "web_search_20260209", "name": "web_search"}, {"type": "web_fetch_20260209", "name": "web_fetch"}]
    messages = [{"role": "user", "content": prompt}]
    resp = None
    for _ in range(8):
        with client.beta.messages.stream(model=CLAUDE_MODEL, max_tokens=64000, betas=["server-side-fallback-2026-07-01"],
                                         fallbacks="default", output_config={"effort": "medium"},
                                         tools=tools, messages=messages) as stream:
            resp = stream.get_final_message()
        if resp.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": resp.content})
            continue
        break
    if resp is None or resp.stop_reason == "refusal":
        raise RuntimeError("Claude не вернул результат")
    text = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{[\s\S]*\}", text)
    data = json.loads(m.group(0)) if m else None
    if not data or not isinstance(data.get("news"), list) or not data["news"]:
        raise RuntimeError("Claude вернул неполный JSON")
    syms = {i.get("sym") for i in (cur.get("instruments") or data.get("instruments") or [])}
    for n in data["news"]:
        n["effects"] = {k: max(-3, min(3, int(v))) for k, v in (n.get("effects") or {}).items() if k in syms}
    for c in data.get("calendar") or []:
        c["above"] = {k: max(-3, min(3, int(v))) for k, v in (c.get("above") or {}).items() if k in syms}
    data["v"] = 1
    data["updated"] = int(time.time())
    data.setdefault("note", cur.get("note", ""))
    data["instruments"] = data.get("instruments") or cur.get("instruments")
    save_json(path, data)
    log(f"Готово: новостей {len(data['news'])}, событий {len(data.get('calendar') or [])}")


# ------------------------------------------------------------------ HTTP-сервер
def page_html() -> bytes:
    html = (APP_DIR / "index.html").read_text(encoding="utf-8")
    inject = "<script>window.LOCAL_APP=true;</script>"
    html = re.sub(r"<head>", "<head>" + inject, html, count=1, flags=re.I) if re.search(r"<head>", html, re.I) else inject + html
    return html.encode("utf-8")


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body: bytes, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):  # noqa: N802
        path = unquote(urlparse(self.path).path)
        if path in ("/", "/index.html"):
            return self._send(200, page_html(), "text/html; charset=utf-8")
        if path == "/api/status":
            return self._json({"ok": True, "busy": {k: v for k, v in BUSY.items() if v}, "claude": claude_available(),
                               "data": str(DATA)})
        if path.startswith("/data/"):
            name = path[len("/data/"):]
            if not re.fullmatch(r"[A-Za-z0-9_.\-]+\.json", name):
                return self._send(404, b"not found", "text/plain")
            p = DATA / name
            if not p.exists():
                return self._send(404, b"not found", "text/plain")
            return self._send(200, p.read_bytes(), "application/json; charset=utf-8")
        if path.startswith("/tools/"):
            p = APP_DIR / path.lstrip("/")
            if p.is_file():
                return self._send(200, p.read_bytes(), "text/plain; charset=utf-8")
        return self._send(404, b"not found", "text/plain")

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        except Exception:  # noqa: BLE001
            body = {}
        if path != "/api/trigger":
            return self._json({"ok": False, "err": "not found"}, 404)
        trig, text = body.get("trigger_id"), str(body.get("text") or "")
        if trig == TRIG_REFRESH:
            m = re.search(r"ТИКЕР:\s*([A-Za-z0-9]{1,14})", text)
            which = m.group(1).upper() if m else "ALL"
            run_job("refresh:" + which, job_refresh, which)
            return self._json({"ok": True})
        if trig == TRIG_ANY:
            q = re.sub(r"^\s*ЗАПРОС:\s*", "", text)
            run_job("any:" + q.lower(), job_any, q)
            return self._json({"ok": True})
        if trig == TRIG_ANALYSTS:
            run_job("analysts", job_analysts)
            return self._json({"ok": True})
        if trig == TRIG_FOREX:
            if not claude_available():
                return self._json({"ok": False, "code": "local",
                                   "err": "Сбор новостей Форекс в приложении работает через Claude: установите пакет anthropic "
                                          "и задайте ANTHROPIC_API_KEY. Сейчас показаны последние сохранённые новости."})
            run_job("forex", job_forex)
            return self._json({"ok": True})
        return self._json({"ok": False, "code": "local", "err": "Неизвестная задача"})


# ------------------------------------------------------------------ запуск
def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except Exception:  # noqa: BLE001
        return "127.0.0.1"
    finally:
        s.close()


def _already_running(port: int) -> bool:
    import urllib.request  # noqa: WPS433
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=2) as r:
            return b'"ok"' in r.read(300)
    except Exception:  # noqa: BLE001
        return False


def main():
    ap = argparse.ArgumentParser(description="Терминал анализа акций — сигнал «Покупать / Продавать»")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--lan", action="store_true", help="доступ с телефона в той же Wi-Fi сети")
    ap.add_argument("--window", action="store_true", help="открыть в отдельном окне (pywebview)")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="сразу обновить все котировки и выйти")
    args = ap.parse_args()
    if not (APP_DIR / "index.html").is_file():
        raise RuntimeError(f"Не найден терминал: {APP_DIR / 'index.html'}")
    seed_data()
    if args.refresh:
        job_refresh("ALL")
        return
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    srv = None
    for port in range(args.port, args.port + 20):
        try:
            srv = ThreadingHTTPServer((host, port), Handler)
            break
        except OSError:
            if port == args.port and _already_running(port):
                url = f"http://127.0.0.1:{port}/"
                print("Терминал уже запущен:", url, "— открываю его.")
                if not args.no_browser:
                    webbrowser.open(url)
                return
            print(f"Порт {port} занят, пробую следующий…")
    if srv is None:
        raise RuntimeError("Нет свободного порта. Запустите с --port 9000")
    url = f"http://127.0.0.1:{port}/"
    print("=" * 60)
    print("Терминал анализа акций — сигнал «Покупать / Продавать»")
    print("Открыт:", url)
    if args.lan:
        print("С телефона (та же Wi-Fi сеть):", f"http://{lan_ip()}:{port}/")
    print("Данные:", DATA)
    print("Claude (новости Форекс):", "подключён" if claude_available() else "не подключён (нужен ANTHROPIC_API_KEY)")
    print("Не закрывайте это окно, пока работаете с терминалом.")
    print("=" * 60, flush=True)
    if args.window:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            import webview  # noqa: WPS433
            webview.create_window("Терминал анализа акций", url, width=1440, height=900)
            webview.start()
            return
        except ImportError:
            print("pywebview не установлен — открываю браузер.")
            webbrowser.open(url)
            threading.Event().wait()
    else:
        if not args.no_browser:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nОстановлено.")


def run():
    try:
        main()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        return
    except BaseException:  # noqa: BLE001
        text = traceback.format_exc()
        print("\n" + "=" * 60 + "\nОШИБКА ЗАПУСКА ТЕРМИНАЛА:\n" + text)
        try:
            with open(DATA_ROOT / "error.log", "a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + text + "\n")
            print("Текст ошибки сохранён в файл:", DATA_ROOT / "error.log")
        except OSError:
            pass
        print("Пришлите этот текст или скриншот этого окна.\n" + "=" * 60)
        if FROZEN or os.name == "nt":
            try:
                input("Нажмите Enter, чтобы закрыть окно…")
            except EOFError:
                pass
        sys.exit(1)


if __name__ == "__main__":
    run()

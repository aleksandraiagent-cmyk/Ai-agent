#!/usr/bin/env python3
"""
TerminalApp — терминал анализа акций «Покупать / Продавать».

Запуск:
    python terminal_app.py            # сервер + открыть браузер
    python terminal_app.py --window   # отдельное окно (нужен pywebview)
    python terminal_app.py --lan      # доступ с телефона в той же Wi-Fi сети
    python terminal_app.py --port 8765 --no-browser

Котировки, новости и рейтинги банков берутся из Yahoo Finance через yfinance
только по кнопке «⟳ Обновить» (автообновления по расписанию нет).
Функции Claude (новости Форекс, живой пересказ, перевод, оценка своих заголовков)
работают, если установлен пакет `anthropic` и задан ANTHROPIC_API_KEY.

Учебный инструмент. Не является инвестиционной рекомендацией.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
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
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
WEB_DIR = BASE_DIR / "web"
DATA_DIR = Path(os.environ.get("TERMINAL_DATA_DIR", Path.cwd() / "terminal_data"))
CACHE_DIR = DATA_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

CLAUDE_MODEL = "claude-opus-5-5"

STOCKS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "NFLX", "AMD", "INTC",
          "JPM", "BA", "KO", "XOM", "V", "DIS", "SPY", "QQQ", "TEVA", "CHKP", "SEDG", "TSEM", "SPCX"]
CRYPTO = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE"]
ALL_TICKERS = STOCKS + CRYPTO
ANALYST_TICKERS = [t for t in STOCKS if t not in ("SPY", "QQQ")]  # 21 акция

FOREX_INSTRUMENTS = {
    "EURUSD": "EURUSD=X", "GBPUSD": "GBPUSD=X", "USDJPY": "USDJPY=X", "AUDUSD": "AUDUSD=X",
    "USDCHF": "USDCHF=X", "USDCAD": "USDCAD=X", "NZDUSD": "NZDUSD=X", "XAUUSD": "GC=F",
    "BRENT": "BZ=F", "SPX500": "^GSPC", "NAS100": "^NDX", "BTCUSD": "BTC-USD",
    "SEDG": "SEDG", "SPCX": "SPCX", "TSEM": "TSEM",
}

HISTORY_PLAN = [  # (ключ, период, интервал)
    ("1d", "5y", "1d"),
    ("1h", "730d", "1h"),
    ("5m", "30d", "5m"),
    ("1mo", "max", "1mo"),
]


def yahoo_symbol(sym: str) -> str:
    sym = sym.upper().strip()
    if sym in CRYPTO:
        return f"{sym}-USD"
    return sym


def is_crypto(sym: str) -> bool:
    s = sym.upper()
    return s in CRYPTO or s.endswith("-USD")


def _yf():
    try:
        import yfinance as yf  # noqa: WPS433
        return yf
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("Не установлен yfinance: pip install yfinance") from exc


def _num(v):
    try:
        if v is None:
            return None
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _ts(v):
    """Любую дату → unix seconds (UTC)."""
    if v is None:
        return None
    try:
        if isinstance(v, (int, float)):
            return int(v)
        if hasattr(v, "timestamp"):
            if getattr(v, "tzinfo", None) is None and isinstance(v, datetime):
                v = v.replace(tzinfo=timezone.utc)
            return int(v.timestamp())
        if hasattr(v, "isoformat"):  # date
            return int(datetime(v.year, v.month, v.day, tzinfo=timezone.utc).timestamp())
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


def df_to_candles(df):
    out = []
    if df is None or len(df) == 0:
        return out
    for idx, row in df.iterrows():
        o, h, l, c = (_num(row.get(k)) for k in ("Open", "High", "Low", "Close"))
        if None in (o, h, l, c):
            continue
        v = _num(row.get("Volume")) or 0.0
        out.append([int(idx.timestamp()), round(o, 6), round(h, 6), round(l, 6), round(c, 6), round(v)])
    return out


def parse_news(items, sym: str, name: str | None):
    """Только новости, где бумага названа в самом заголовке."""
    res = []
    keys = {sym.upper().replace("-USD", "")}
    if name:
        first = re.split(r"[ ,.]", name)[0]
        if len(first) > 2 and first.lower() not in ("the", "invesco", "spdr", "ishares"):
            keys.add(first)
    crypto_names = {"BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "XRP": "XRP",
                    "BNB": "BNB", "DOGE": "Dogecoin"}
    if sym.upper() in crypto_names:
        keys.add(crypto_names[sym.upper()])
    for it in items or []:
        c = it.get("content") if isinstance(it, dict) and "content" in it else it
        if not isinstance(c, dict):
            continue
        title = c.get("title") or ""
        if not title:
            continue
        publisher = (c.get("provider") or {}).get("displayName") if isinstance(c.get("provider"), dict) else c.get("publisher")
        link = (c.get("canonicalUrl") or {}).get("url") if isinstance(c.get("canonicalUrl"), dict) else c.get("link")
        t = _ts(c.get("pubDate") or c.get("displayTime")) or _ts(c.get("providerPublishTime"))
        mentioned = any(re.search(r"(?<![A-Za-z])" + re.escape(k) + r"(?![A-Za-z])", title, re.I if len(k) > 4 else 0)
                        for k in keys)
        res.append({"title": title, "publisher": publisher or "", "time": t, "link": link or "",
                    "mentioned": bool(mentioned)})
    res.sort(key=lambda x: x["time"] or 0, reverse=True)
    return res


# ---------------------------------------------------------------- загрузка тикера
def fetch_ticker(sym: str, light: bool = False) -> dict:
    yf = _yf()
    ysym = yahoo_symbol(sym)
    t = yf.Ticker(ysym)
    candles = {}
    for key, period, interval in HISTORY_PLAN:
        if light and key not in ("1d", "1h"):
            continue
        try:
            df = t.history(period=period, interval=interval, auto_adjust=False, prepost=False)
            candles[key] = df_to_candles(df)
        except Exception as exc:  # noqa: BLE001
            candles[key] = []
            print(f"[{sym}] {interval}: {exc}")
    info = {}
    try:
        info = t.info or {}
    except Exception as exc:  # noqa: BLE001
        print(f"[{sym}] info: {exc}")
    name = info.get("longName") or info.get("shortName") or sym
    quote = {
        "price": _num(info.get("regularMarketPrice") or info.get("currentPrice")),
        "prevClose": _num(info.get("regularMarketPreviousClose") or info.get("previousClose")),
        "regTime": _ts(info.get("regularMarketTime")),
        "pre": _num(info.get("preMarketPrice")), "preTime": _ts(info.get("preMarketTime")),
        "preChange": _num(info.get("preMarketChangePercent")),
        "post": _num(info.get("postMarketPrice")), "postTime": _ts(info.get("postMarketTime")),
        "postChange": _num(info.get("postMarketChangePercent")),
        "marketState": info.get("marketState"),
        "currency": info.get("currency", "USD"),
    }
    fundamentals = {k: _num(info.get(k)) for k in (
        "targetMeanPrice", "targetLowPrice", "targetHighPrice", "targetMedianPrice",
        "numberOfAnalystOpinions", "recommendationMean", "trailingEps", "forwardEps",
        "earningsGrowth", "revenueGrowth", "bookValue", "freeCashflow", "sharesOutstanding",
        "dividendRate", "dividendYield", "trailingPE", "forwardPE", "pegRatio", "marketCap",
        "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "beta")}
    fundamentals["recommendationKey"] = info.get("recommendationKey")
    fundamentals["sector"] = info.get("sector")
    fundamentals["industry"] = info.get("industry")
    events = {"earnings": [], "exDividend": None, "dividendDate": None}
    try:
        cal = t.calendar
        if isinstance(cal, dict):
            events["earnings"] = [_ts(x) for x in (cal.get("Earnings Date") or []) if _ts(x)]
            events["exDividend"] = _ts(cal.get("Ex-Dividend Date"))
            events["dividendDate"] = _ts(cal.get("Dividend Date"))
    except Exception:  # noqa: BLE001
        pass
    if not events["exDividend"]:
        events["exDividend"] = _ts(info.get("exDividendDate"))
    news = []
    try:
        raw = t.get_news(count=30) if hasattr(t, "get_news") else t.news
        news = parse_news(raw, sym, name)
    except Exception as exc:  # noqa: BLE001
        print(f"[{sym}] news: {exc}")
    return {
        "symbol": sym.upper(), "yahoo": ysym, "name": name,
        "kind": "crypto" if is_crypto(sym) else "stock",
        "candles": candles, "quote": quote, "fundamentals": fundamentals,
        "events": events, "news": news, "updated": int(time.time()), "source": "yahoo",
    }


def cache_path(sym: str) -> Path:
    return CACHE_DIR / (re.sub(r"[^A-Za-z0-9_.^=-]", "_", sym.upper()) + ".json")


def save_cache(sym: str, data: dict):
    p = cache_path(sym)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(p)


def load_cache(sym: str):
    p = cache_path(sym)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return None
    return None


# ---------------------------------------------------------------- фоновые задачи
class Job:
    def __init__(self, name):
        self.name = name
        self.lock = threading.Lock()
        self.state = {"name": name, "running": False, "done": 0, "total": 0, "errors": [],
                      "started": None, "finished": None, "message": ""}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def start(self, total, target):
        with self.lock:
            if self.state["running"]:
                return False
            self.state.update(running=True, done=0, total=total, errors=[], started=int(time.time()),
                              finished=None, message="")
        threading.Thread(target=self._run, args=(target,), daemon=True).start()
        return True

    def _run(self, target):
        try:
            target(self)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self.error(str(exc))
        finally:
            with self.lock:
                self.state["running"] = False
                self.state["finished"] = int(time.time())

    def step(self, msg=""):
        with self.lock:
            self.state["done"] += 1
            self.state["message"] = msg

    def error(self, msg):
        with self.lock:
            self.state["errors"].append(msg)


JOBS = {"refresh": Job("refresh"), "analysts": Job("analysts"), "forex": Job("forex")}
EXTRA_TICKERS_FILE = DATA_DIR / "extra_tickers.json"


def extra_tickers():
    try:
        return json.loads(EXTRA_TICKERS_FILE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return []


def add_extra_ticker(sym):
    lst = extra_tickers()
    if sym not in lst and sym not in ALL_TICKERS:
        lst.append(sym)
        EXTRA_TICKERS_FILE.write_text(json.dumps(lst), encoding="utf-8")


def refresh_all(job: Job):
    tickers = ALL_TICKERS + extra_tickers()

    def one(sym):
        try:
            save_cache(sym, fetch_ticker(sym))
            job.step(sym)
        except Exception as exc:  # noqa: BLE001
            job.error(f"{sym}: {exc}")
            job.step(sym)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(one, tickers))


# ---------------------------------------------------------------- аналитики
def collect_analysts(job: Job):
    yf = _yf()
    out = {"updated": int(time.time()), "items": []}
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    for sym in ANALYST_TICKERS:
        item = {"symbol": sym, "actions": []}
        try:
            t = yf.Ticker(sym)
            info = t.info or {}
            item.update({
                "name": info.get("shortName") or sym,
                "price": _num(info.get("regularMarketPrice") or info.get("currentPrice")),
                "recKey": info.get("recommendationKey"), "recMean": _num(info.get("recommendationMean")),
                "count": _num(info.get("numberOfAnalystOpinions")),
                "targetMean": _num(info.get("targetMeanPrice")), "targetMedian": _num(info.get("targetMedianPrice")),
                "targetLow": _num(info.get("targetLowPrice")), "targetHigh": _num(info.get("targetHighPrice")),
                "sector": info.get("sector"),
            })
            try:
                ud = t.upgrades_downgrades
                if ud is not None and len(ud):
                    for idx, row in ud.iterrows():
                        dt = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        if dt < cutoff:
                            continue
                        item["actions"].append({
                            "time": int(dt.timestamp()), "firm": row.get("Firm"),
                            "to": row.get("ToGrade"), "from": row.get("FromGrade"),
                            "action": row.get("Action"),
                            "ptAction": row.get("priceTargetAction"),
                            "pt": _num(row.get("currentPriceTarget")), "ptPrior": _num(row.get("priorPriceTarget")),
                        })
            except Exception as exc:  # noqa: BLE001
                job.error(f"{sym} upgrades: {exc}")
            try:
                rs = t.recommendations_summary if hasattr(t, "recommendations_summary") else None
                if rs is not None and len(rs):
                    r0 = rs.iloc[0]
                    item["summary"] = {k: int(r0.get(k, 0) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}
            except Exception:  # noqa: BLE001
                pass
        except Exception as exc:  # noqa: BLE001
            job.error(f"{sym}: {exc}")
        out["items"].append(item)
        job.step(sym)
        time.sleep(0.3)
    (DATA_DIR / "analysts.json").write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")


# ---------------------------------------------------------------- Claude
def claude_available() -> bool:
    try:
        import anthropic  # noqa: F401,WPS433
    except ImportError:
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def ask_claude(prompt: str, system: str | None = None, max_tokens: int = 8000, effort: str = "low") -> str:
    import anthropic  # noqa: WPS433
    client = anthropic.Anthropic()
    kwargs = dict(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": effort},
        messages=[{"role": "user", "content": prompt}],
    )
    if system:
        kwargs["system"] = system
    resp = client.beta.messages.create(**kwargs)
    if resp.stop_reason == "refusal":
        raise RuntimeError("Claude отклонил запрос")
    return "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text").strip()


def extract_json(text: str):
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0] or [0])
    return json.loads(text[start:])


# ---------------------------------------------------------------- Форекс
POS_WORDS = ["beat", "beats", "surge", "soar", "rally", "jump", "gain", "rise", "record", "upgrade", "strong",
             "bullish", "growth", "profit", "boost", "higher", "optimism", "approval", "wins", "tops", "raises"]
NEG_WORDS = ["miss", "plunge", "fall", "drop", "slump", "tumble", "cut", "downgrade", "weak", "bearish", "loss",
             "lawsuit", "probe", "fear", "lower", "recession", "crash", "warns", "sinks", "slides", "tariff", "risk"]


def keyword_tone(title: str) -> int:
    tl = title.lower()
    s = sum(1 for w in POS_WORDS if re.search(r"\b" + w, tl)) - sum(1 for w in NEG_WORDS if re.search(r"\b" + w, tl))
    return max(-3, min(3, s))


def collect_forex(job: Job):
    yf = _yf()
    week_ago = time.time() - 7 * 86400
    news, seen = [], set()
    for name, ysym in FOREX_INSTRUMENTS.items():
        try:
            t = yf.Ticker(ysym)
            raw = t.get_news(count=20) if hasattr(t, "get_news") else t.news
            for n in parse_news(raw, name, None):
                if (n["time"] or 0) < week_ago or n["title"] in seen:
                    continue
                seen.add(n["title"])
                n["source_instrument"] = name
                news.append(n)
        except Exception as exc:  # noqa: BLE001
            job.error(f"{name}: {exc}")
        job.step(name)
    news.sort(key=lambda x: x["time"] or 0, reverse=True)
    news = news[:80]
    instruments = list(FOREX_INSTRUMENTS)
    used_claude = False
    calendar = []
    if claude_available() and news:
        try:
            lines = "\n".join(f"{i}. {n['title']}" for i, n in enumerate(news))
            prompt = (
                "Ты — трейдер с 30-летним стажем. Для каждого заголовка оцени влияние на инструменты "
                f"{', '.join(instruments)} по шкале -3..+3 (0 — нет влияния; указывай только ненулевые), "
                "важность 1-3 и краткое пояснение на русском (до 20 слов). Также составь экономический календарь США "
                "и мира на ближайшие 7 дней (от " + datetime.now(timezone.utc).strftime("%Y-%m-%d") + ") со сценариями "
                "«выше прогноза / ниже прогноза» для ключевых инструментов. Ответь ТОЛЬКО JSON вида "
                '{"news":[{"i":0,"importance":2,"why":"...","impact":{"EURUSD":-1}}],'
                '"calendar":[{"date":"YYYY-MM-DD","time":"HH:MM ET","event":"...","importance":3,'
                '"above":"...","below":"..."}]}\n\nЗаголовки:\n' + lines)
            data = extract_json(ask_claude(prompt, max_tokens=16000))
            for row in data.get("news", []):
                i = int(row.get("i", -1))
                if 0 <= i < len(news):
                    news[i]["impact"] = {k: int(v) for k, v in (row.get("impact") or {}).items() if k in instruments}
                    news[i]["importance"] = row.get("importance", 1)
                    news[i]["why"] = row.get("why", "")
            calendar = data.get("calendar", [])
            used_claude = True
        except Exception as exc:  # noqa: BLE001
            job.error(f"Claude: {exc}")
    if not used_claude:
        for n in news:
            tone = keyword_tone(n["title"])
            n["impact"] = {n["source_instrument"]: tone} if tone else {}
            n["importance"] = 1 + min(2, abs(tone))
            n["why"] = "оценка по ключевым словам (Claude недоступен)"
    out = {"updated": int(time.time()), "news": news, "calendar": calendar, "instruments": instruments,
           "claude": used_claude}
    (DATA_DIR / "forex.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB_DIR), **kw)

    def log_message(self, fmt, *args):  # тише
        if "/api/" in (args[0] if args else ""):
            return
        super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:  # noqa: BLE001
            return {}

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/api/status":
                cached = {p.stem: int(p.stat().st_mtime) for p in CACHE_DIR.glob("*.json")}
                return self._json({"ok": True, "jobs": {k: j.snapshot() for k, j in JOBS.items()},
                                   "cached": cached, "tickers": ALL_TICKERS, "extra": extra_tickers(),
                                   "claude": claude_available(), "server_time": int(time.time())})
            if u.path == "/api/data":
                sym = (q.get("ticker") or "").upper()
                data = load_cache(sym)
                return self._json(data if data else {"error": "no-data", "symbol": sym})
            if u.path == "/api/search":
                return self._json(self.search(q.get("q", "")))
            if u.path == "/api/analysts":
                p = DATA_DIR / "analysts.json"
                return self._json(json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"items": []})
            if u.path == "/api/forex":
                p = DATA_DIR / "forex.json"
                return self._json(json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"news": []})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return self._json({"error": str(exc)}, 500)
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        u = urlparse(self.path)
        body = self._body()
        try:
            if u.path == "/api/refresh":
                ok = JOBS["refresh"].start(len(ALL_TICKERS) + len(extra_tickers()), refresh_all)
                return self._json({"started": ok, "job": JOBS["refresh"].snapshot()})
            if u.path == "/api/analysts/collect":
                ok = JOBS["analysts"].start(len(ANALYST_TICKERS), collect_analysts)
                return self._json({"started": ok})
            if u.path == "/api/forex/collect":
                ok = JOBS["forex"].start(len(FOREX_INSTRUMENTS), collect_forex)
                return self._json({"started": ok})
            if u.path == "/api/load":
                sym = (body.get("ticker") or "").upper().strip()
                if not re.fullmatch(r"[A-Z0-9.^=\-]{1,15}", sym):
                    return self._json({"error": "bad ticker"}, 400)
                data = fetch_ticker(sym)
                if not data["candles"].get("1d"):
                    return self._json({"error": "Нет данных Yahoo по тикеру " + sym}, 404)
                save_cache(sym, data)
                add_extra_ticker(sym)
                return self._json(data)
            if u.path == "/api/claude":
                if not claude_available():
                    return self._json({"error": "Claude недоступен: установите anthropic и задайте ANTHROPIC_API_KEY"}, 503)
                text = ask_claude(str(body.get("prompt", ""))[:60000], body.get("system"),
                                  max_tokens=int(body.get("max_tokens", 4000)))
                return self._json({"text": text})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return self._json({"error": str(exc)}, 500)
        return self._json({"error": "not found"}, 404)

    @staticmethod
    def search(query: str):
        query = query.strip()
        if not query:
            return {"quotes": []}
        yf = _yf()
        try:
            s = yf.Search(query, max_results=10, news_count=0)
            quotes = [{"symbol": x.get("symbol"), "name": x.get("longname") or x.get("shortname") or "",
                       "exchange": x.get("exchDisp") or x.get("exchange") or "", "type": x.get("quoteType", "")}
                      for x in (s.quotes or []) if x.get("symbol")]
            return {"quotes": quotes}
        except Exception as exc:  # noqa: BLE001
            return {"quotes": [{"symbol": query.upper(), "name": "", "exchange": "", "type": ""}], "warning": str(exc)}


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except Exception:  # noqa: BLE001
        return "127.0.0.1"
    finally:
        s.close()


def main():
    ap = argparse.ArgumentParser(description="Терминал анализа акций «Покупать / Продавать»")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--lan", action="store_true", help="слушать 0.0.0.0 (телефон в той же Wi-Fi сети)")
    ap.add_argument("--window", action="store_true", help="открыть в отдельном окне (pywebview)")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    srv = ThreadingHTTPServer((host, args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print("Терминал запущен:", url)
    if args.lan:
        print("С телефона (та же Wi-Fi сеть):", f"http://{lan_ip()}:{args.port}/")
    print("Данные:", DATA_DIR)
    print("Claude:", "доступен" if claude_available() else "недоступен (нет anthropic или ANTHROPIC_API_KEY)")
    if args.window:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            import webview  # noqa: WPS433
            webview.create_window("Терминал «Покупать / Продавать»", url, width=1440, height=900)
            webview.start()
            return
        except ImportError:
            print("pywebview не установлен (pip install pywebview) — открываю браузер.")
            webbrowser.open(url)
            threading.Event().wait()
    else:
        if not args.no_browser:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nОстановлено.")


if __name__ == "__main__":
    main()

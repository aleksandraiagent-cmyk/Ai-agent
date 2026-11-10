"""Проверка: терминал не зависает в Edge на свежих данных Yahoo.

1) запускает terminal_app.py на чистой папке данных и обновляет все тикеры;
2) открывает терминал в Microsoft Edge (Playwright, channel=msedge);
3) проверяет, что часы в шапке идут и вкладки нажимаются;
4) если страница зависла — ставит JS на паузу и печатает стек (где именно застрял код).
Результаты (скриншоты, данные) — в папке check_out/.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "check_out"
OUT.mkdir(exist_ok=True)
DATA = OUT / "tdata"
PORT = 8811


def wait_http(url, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            time.sleep(1)
    raise RuntimeError("сервер не ответил: " + url)


def main():
    env = dict(os.environ, TERMINAL_DATA_DIR=str(DATA), PYTHONIOENCODING="utf-8")
    env.pop("ANTHROPIC_API_KEY", None)
    if "--no-refresh" not in sys.argv:
        print("Обновляю все тикеры…", flush=True)
        subprocess.run([sys.executable, str(ROOT / "terminal_app.py"), "--refresh"], env=env, check=True, timeout=1500)
    srv = subprocess.Popen([sys.executable, str(ROOT / "terminal_app.py"), "--no-browser", "--port", str(PORT)], env=env)
    problems = []
    try:
        wait_http(f"http://127.0.0.1:{PORT}/api/status")
        from playwright.sync_api import sync_playwright
        tickers = list(json.loads(wait_http(f"http://127.0.0.1:{PORT}/data/index.json"))["tickers"])
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="msedge") if os.name == "nt" else pw.chromium.launch(executable_path=os.environ.get("PW_CHROMIUM") or None)
            for lang in ("ru", "en"):
                for tk in ["AAPL"] + ([t for t in tickers if t != "AAPL"] if lang == "ru" else []):
                    res = check_one(br, lang, tk)
                    print(f"[{lang}] {tk}: {res['verdict']} {res.get('detail', '')}", flush=True)
                    if res["verdict"] != "OK":
                        problems.append(f"{lang} {tk}: {res['verdict']} {res.get('detail', '')}")
                        if res.get("stack"):
                            print("   СТЕК ЗАВИСАНИЯ:\n   " + "\n   ".join(res["stack"]), flush=True)
                        if len(problems) >= 3:
                            break
            br.close()
    finally:
        srv.terminate()
    if problems:
        print("ПРОБЛЕМЫ:\n" + "\n".join(problems))
        sys.exit(1)
    print("OK: терминал откликается на всех тикерах")


def check_one(br, lang, tk):
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(f"try{{localStorage.setItem('sig.lang','{lang}')}}catch(e){{}}")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:200]))
    cdp = ctx.new_cdp_session(page)
    paused = {}
    cdp.on("Debugger.paused", lambda ev: paused.setdefault("frames", ev.get("callFrames", [])))
    cdp.send("Debugger.enable")
    res = {"verdict": "OK"}
    try:
        page.goto(f"http://127.0.0.1:{PORT}/#{tk}", wait_until="commit", timeout=30000)
        page.wait_for_timeout(6000)
        alive = probe(page)
        if not alive:
            res["verdict"] = "ЗАВИСЛА"
            cdp.send("Debugger.pause")
            t0 = time.time()
            while "frames" not in paused and time.time() - t0 < 10:
                time.sleep(0.2)
            res["stack"] = [f"{f.get('functionName') or '(anon)'} @ строка {f['location']['lineNumber'] + 1}:{f['location'].get('columnNumber', 0)}"
                            for f in paused.get("frames", [])[:12]]
        else:
            t1 = 1
            page.click(".tabs button >> nth=2", timeout=5000)
            page.wait_for_timeout(1000)
            if not probe(page):
                res["verdict"] = "ЗАВИСЛА ПОСЛЕ НАЖАТИЯ"
            page.click(".tabs button >> nth=0", timeout=5000)
            res["detail"] = f"tabs={t1}"
        if errors:
            res["detail"] = (res.get("detail", "") + " ошибки JS: " + " | ".join(errors[:3])).strip()
            if res["verdict"] == "OK":
                res["verdict"] = "OK (с ошибками JS)"
        try:
            page.screenshot(path=str(OUT / f"{lang}_{tk}.png"), timeout=5000)
        except Exception:  # noqa: BLE001
            pass
    except Exception as exc:  # noqa: BLE001
        res = {"verdict": "ОШИБКА", "detail": str(exc)[:300]}
    finally:
        try:
            ctx.close()
        except Exception:  # noqa: BLE001
            pass
    return res


def probe(page):
    """Страница жива, если JS отвечает и текст часов брокера меняется (ожидания с таймаутом — не виснут вместе со страницей)."""
    try:
        page.wait_for_function("() => { window.__p = (document.querySelector('.hbtn.tase')||{}).textContent||''; return true }", timeout=5000)
        page.wait_for_function("() => ((document.querySelector('.hbtn.tase')||{}).textContent||'') !== window.__p", timeout=6000)
        return True
    except Exception:  # noqa: BLE001
        return False


if __name__ == "__main__":
    main()

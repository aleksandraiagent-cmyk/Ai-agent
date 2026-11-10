"""Проверка: данные, которые выгружает terminal_app.py, совпадают по структуре с выгрузкой из Claude (app/data).

Запуск (нужен интернет и yfinance):  python tools/check_format.py
Код выхода 1 — если не хватает полей, которые есть в исходных данных терминала.
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import terminal_app as T  # noqa: E402

SAMPLES = [("AAPL", "AAPL"), ("SPY", "SPY"), ("US500", "^GSPC"), ("LCO1", "BZ=F"), ("TSEM", "TSEM")]


def shape(x, depth=0):
    if isinstance(x, dict):
        if depth >= 3:
            return "dict"
        return {k: shape(v, depth + 1) for k, v in x.items()}
    if isinstance(x, list):
        return "list"
    return type(x).__name__


def missing(ref, got, path=""):
    out = []
    if isinstance(ref, dict) and isinstance(got, dict):
        for k, v in ref.items():
            if k in ("revEst",) and path.endswith("fin"):
                continue
            if k not in got:
                out.append(path + "." + k)
            elif isinstance(v, dict) and not (path.endswith("est.eps") or path.endswith("est.rev") or path.endswith(".revEst")):
                out += missing(v, got[k], path + "." + k)
    return out


def main():
    problems = []
    for tk, yahoo in SAMPLES:
        ref = json.loads((ROOT / "app" / "data" / f"{tk}.json").read_text(encoding="utf-8"))
        t0 = time.time()
        doc = T.fetch_doc(tk, yahoo, None, None)
        bars = {k: len(doc[k]["t"]) for k in ("1d", "1h", "5m", "1mo") if k in doc}
        refbars = {k: len(ref[k]["t"]) for k in ("1d", "1h", "5m", "1mo") if k in ref}
        print(f"{tk}: {time.time() - t0:.1f} c, бары {bars} (в Claude {refbars}), новостей {len(doc['news'])}, "
              f"цена {doc['quote']['price']}, тип {doc['quote']['type']}")
        # дневки — полночь UTC, как в исходных данных
        if doc["1d"]["t"][-1] % 86400 != 0:
            problems.append(f"{tk}: время дневок не в полночь UTC")
        miss = missing(shape(ref), shape(doc), tk)
        miss = [m for m in miss if not m.endswith((".pre", ".post", ".divRate", ".exDiv", ".div", ".earn", ".earnEst", ".earnLast"))]
        if miss:
            problems.append(f"{tk}: нет полей {miss}")
        if "fin" in doc:
            f = doc["fin"]
            print(f"   fin: q.is.p={f.get('q', {}).get('is', {}).get('p')}  rel={[(r['cq'], r['fq'], r['act']) for r in f.get('rel', [])][-2:]}")
            print(f"   next={f.get('next')}")
            print(f"   ev={doc['quote'].get('ev')}  fv.fair={(doc.get('fv') or {}).get('fair')}")
        print(f"   pre={doc['quote'].get('pre')} post={doc['quote'].get('post')}")
    # аналитики по двум бумагам
    T.DATA = Path(ROOT / "build_check_data")
    T.DATA.mkdir(exist_ok=True)
    (T.DATA / "analysts.json").write_text(json.dumps({"tickers": {"AAPL": {"summary": "", "actions": []}, "NVDA": {"summary": "", "actions": []}}}), encoding="utf-8")
    T.job_analysts()
    an = json.loads((T.DATA / "analysts.json").read_text(encoding="utf-8"))
    for tk, v in an["tickers"].items():
        print(f"аналитики {tk}: {len(v['actions'])} действий, пример {v['actions'][:2]}")
    if problems:
        print("ПРОБЛЕМЫ:\n" + "\n".join(problems))
        sys.exit(1)
    print("OK: формат совпадает с данными терминала")


if __name__ == "__main__":
    main()

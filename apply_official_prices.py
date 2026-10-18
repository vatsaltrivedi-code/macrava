"""Replace all restaurant prices in rest.json with prices read from the chains' own websites.

Every old price (collected from Swiggy) is removed. Only items listed in data/official_prices.json get a price,
stored under "Delhi NCR" (the city the chain sites were read for); the app shows it as approximate elsewhere.
Run after make_rest.py:  python3 apply_official_prices.py
"""
import json, pathlib, re

d = pathlib.Path(__file__).resolve().parent
rest = json.loads((d / "rest.json").read_text(encoding="utf-8"))
off = json.loads((d / "data" / "official_prices.json").read_text(encoding="utf-8"))
CITY = "Delhi NCR"

def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower().replace("&", " and ")).strip()

for r in rest:
    r["prices"] = None

priced, unmatched = 0, []

def put(match, price, city=CITY):
    global priced
    hits = [r for r in rest if match(r)]
    if not hits:
        return False
    for r in hits:
        r["prices"] = {city: price}
        priced += 1
    return True

# Domino's: Medium Hand Tossed rows in our data are half a medium (3 slices) -> half the menu price
dom = off.get("Domino's", {})
for name, p in dom.get("medium", {}).items():
    ok = put(lambda r, n=name: r["chain"] == "Domino's" and r["name"].startswith(n + " (Medium hand tossed"), int(p / 2 + 0.5))
    if not ok: unmatched.append("Domino's medium: " + name)
for name, p in dom.get("pizza_mania", {}).items():
    ok = put(lambda r, n=name: r["chain"] == "Domino's" and r["name"] == n + " (Pizza Mania)", p)
    if not ok: unmatched.append("Domino's mania: " + name)

# Other chains: {"items": {"<exact name in rest.json>": price}}
for chain in ("KFC", "McDonald's", "Pizza Hut", "Burger King"):
    spec = off.get(chain, {})
    region, city = spec.get("_region"), spec.get("_city", CITY)  # e.g. McDonald's West & South, read for Mumbai
    for name, p in spec.get("items", {}).items():
        ok = put(lambda r, c=chain, n=name: r["chain"] == c and norm(r["name"]) == norm(n)
                 and (region is None or r.get("region") == region), p, city)
        if not ok: unmatched.append(chain + ": " + name)

(d / "rest.json").write_text(json.dumps(rest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"priced {priced} of {len(rest)} restaurant rows from official sites")
if unmatched:
    print("NOT MATCHED (check names):", *unmatched, sep="\n  ")
    raise SystemExit(1)

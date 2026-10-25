"""Extra products checked after the big sheet: data/*_more_*.txt (Blinkit, Zepto) and data/eatclub_*.txt (restaurant).
build_local.py appends them to foods.json / rest.json when it builds the app, so existing ids never change."""
import json, re, pathlib
D = pathlib.Path(__file__).resolve().parent

def cat_of(n):
    l = n.lower()
    if "egg" in l: return "Eggs"
    if "peanut butter" in l or "peanut spread" in l: return "Spreads"
    if "tofu" in l or "paneer" in l or "tempeh" in l: return "Paneer & tofu"
    if re.search(r"soya.*(chunk|granule)|mealmaker", l): return "Soya & dal"
    if "soy beverage" in l: return "Milk"
    if "roasted soyabean" in l: return "Snacks"
    if "whey" in l: return "Protein powder"
    if "protein bar" in l: return "Protein bar"
    if re.search(r"\blassi\b|buttermilk", l): return "Dairy drink"
    if "milkshake" in l: return "Protein shake"
    if "yogurt" in l: return "Yogurt"
    if "curd" in l or "dahi" in l: return "Curd"
    if "milk" in l: return "Milk"
    if "bread" in l: return "Bread"
    if "peanut" in l: return "Nuts & seeds" if re.search(r"khari|salted peanuts|jumbo", l) else "Snacks"
    raise SystemExit("no category for " + n)

def qty(pack):
    p = pack.lower().replace("ltr", "l")
    m = re.match(r"(\d+)\s*x\s*([\d.]+)\s*(g|ml|l|kg)", p)
    mult = 1
    if m: mult, p = int(m.group(1)), f"{m.group(2)} {m.group(3)}"
    m = re.match(r"([\d.]+)\s*(g|ml|l|kg|pcs)", p)
    n, u = float(m.group(1)), m.group(2)
    if u in ("l", "kg"): n *= 1000
    return n * mult, u

def more_foods(foods):
    foods = list(foods)
    have_ids = {re.search(r"prid/(\d+)", f["link"]).group(1) for f in foods if f.get("link") and "prid/" in f["link"]}
    have_names = {(f["name"].lower(), str(f["pack"]).lower()) for f in foods}
    for path in sorted(D.glob("data/*_more_*.txt")):
        store = "Zepto" if "zepto" in path.name else "Blinkit"
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("#") or not line.strip(): continue
            pid, name, pack, price, P, kcal, C, F, serve, diet = line.split("|")
            if store == "Blinkit" and pid in have_ids: continue
            P, kcal, C, F, price = float(P), float(kcal), float(C), float(F), float(price)
            q, u = qty(pack)
            perpack = name.endswith(" [pack]"); name = name.replace(" [pack]", "")
            if (name.lower(), pack.lower()) in have_names: continue
            if perpack: P, kcal, C, F = (x * 100 / q for x in (P, kcal, C, F))
            cat = cat_of(name)
            unit = None
            if u == "pcs":
                unit = {"name": "egg", "g": 50}; q = q * 50
            elif cat == "Protein bar":
                unit = {"name": "bar", "g": float(re.match(r"([\d.]+)", serve or pack).group(1))}
            elif cat == "Protein powder":
                unit = {"name": "scoop", "g": float(re.match(r"([\d.]+)", serve).group(1))}
            liquid = u in ("ml", "l")
            if P > 100 or kcal > 950 or P <= 0: continue
            foods.append({"id": len(foods), "name": name, "cat": cat, "store": store,
                "diet": {"v": "veg", "egg": "egg", "nv": "nonveg"}[diet],
                "pack": pack, "packQty": q, "price": price, "unitLabel": "ml" if liquid else "g",
                "kcal": kcal / 100, "p": P / 100, "c": C / 100, "f": F / 100,
                "basis": "100 ml" if liquid else "100 g", "unit": unit,
                "link": f"https://blinkit.com/prn/x/prid/{pid}" if store == "Blinkit" else "https://www.zepto.com/search?query=" + (name + " " + pack).replace(" ", "+"),
                "check": bool(abs(4 * P + 4 * C + 9 * F - kcal) / kcal > 0.15),
                "note": f"{store} price in Gurugram on 26 Oct 2026"})
            have_names.add((name.lower(), pack.lower()))
    return foods

def more_rest(rest):
    rest = list(rest)
    nid = max(r["id"] for r in rest) + 1
    have = {(r["chain"], r["name"]) for r in rest}
    for path in sorted(D.glob("data/eatclub_*.txt")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("#") or not line.strip(): continue
            name, k, p, c, f, price, diet = line.split("|")
            if ("EatClub", name) in have: continue
            rest.append({"id": nid, "chain": "EatClub", "name": name, "g": None, "kcal": float(k), "p": float(p), "c": float(c), "f": float(f),
                         "diet": diet, "prices": {"Delhi NCR": float(price)}})
            nid += 1
    return rest

if __name__ == "__main__":
    from collections import Counter
    base = json.loads((D / "foods.json").read_text(encoding="utf-8"))
    f = more_foods(base); r = more_rest(json.loads((D / "rest.json").read_text(encoding="utf-8")))
    print("foods", len(base), "->", len(f), Counter(x["store"] for x in f[len(base):]), "| restaurants ->", len(r))

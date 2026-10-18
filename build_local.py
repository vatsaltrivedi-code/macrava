"""Build macro-budget-planner.html from template2.html, data, plan.js and vendor/*.js.
Optional config.json: {"supabaseUrl": "...", "supabaseKey": "...", "cfBeacon": "..."} (publishable values only).
cfBeacon is the Cloudflare Web Analytics token; when set, the beacon is added to the app and to pages/*.html copies in dist/."""
import json, pathlib
d = pathlib.Path(__file__).resolve().parent
r = lambda n: (d / n).read_text(encoding="utf-8")
safe = lambda t: t.replace("</", "<\\/")
cfg = json.loads(r("config.json")) if (d / "config.json").exists() else {}
url, key = str(cfg.get("supabaseUrl", "")), str(cfg.get("supabaseKey", ""))
s = r("template2.html")
s = (s.replace("__SOLVER__", safe(r("vendor/solver.js")))
      .replace("__SUPABASE__", safe(r("vendor/supabase.js")))
      .replace("__SUPA_URL__", safe(json.dumps(url)))
      .replace("__SUPA_KEY__", safe(json.dumps(key)))
      .replace("__FOODS__", safe(r("foods.json")))
      .replace("__REST__", safe(r("rest.json")))
      .replace("__PLAN__", r("plan.js"))
      .replace("__GLOGO__", "data:image/svg+xml;base64," + __import__("base64").b64encode((d / "vendor/google-g.svg").read_bytes()).decode()))
beacon = str(cfg.get("cfBeacon", ""))
tag = ""
if beacon:
    assert all(c in "0123456789abcdef" for c in beacon), "cfBeacon must be the hex token"
    tag = ("<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' "
           "data-cf-beacon='{\"token\": \"%s\"}'></script>" % beacon)
    s = s.replace("</body>", tag + "</body>", 1) if "</body>" in s else s + "\n" + tag + "\n"
(d / "macro-budget-planner.html").write_text(s, encoding="utf-8")
# Deployable copies of the legal pages (with the beacon when set)
(d / "dist").mkdir(exist_ok=True)
for n in ("privacy.html", "terms.html"):
    t = r("pages/" + n)
    (d / "dist" / n).write_text(t.replace("</body>", tag + "</body>", 1) if tag else t, encoding="utf-8")
print("ok", len(s), "cloud" if url else "guest-only")

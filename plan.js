// Macro Budget Planner core: picks the cheapest daily mix of foods that hits the targets.
// Works in the browser (global `solver` from javascript-lp-solver) and in Node (for tests).

// Most a person would sensibly eat of each kind of food in one day (grams or ml).
const CAT_MAX = {
  "Protein powder": 70, "Protein bar": 80, "Protein shake": 500, "Snacks": 50,
  "Yogurt": 400, "Curd": 400, "Oats & muesli": 120, "Bread": 200,
  "Paneer & tofu": 200, "Soya & dal": 150, "Milk": 750, "Dairy drink": 400,
  "Chicken": 300, "Fish & seafood": 250, "Mutton": 200, "Ready non-veg": 250, "Eggs": 300, "Cheese": 50,
  "Spreads": 40, "Nuts & seeds": 50, "Grains & atta": 300,
  "Pasta & noodles": 150, "Frozen dessert": 120,
};
const MEAT_MAX = 350;   // chicken, fish and mutton together, grams per day
const SOYA_MAX = 80;    // dry soya chunks per day
const PULSE_MAX = 150;  // all dals, besan, rajma, chana, sattu and soya together
const PULSE = /dal|masoor|moong|rajma|chana|besan|sattu|soya|panchmel/i;
// What a food needs before you can eat it. Hostels and PGs have no stove, so:
//  stove     - must be cooked (raw chicken, dal, atta, pasta, frozen nuggets)
//  heat      - hot water or a quick heat: an electric kettle or a microwave works (boiled eggs, instant noodles, RTE dal pouches)
//  microwave - heat-and-eat packs
//  fridge    - goes off at room temperature (milk pouches, curd, paneer, cold cuts)
function needs(f) {
  const c = f.cat, n = f.name;
  if (c === "Grains & atta") return /sattu/i.test(n) ? [] : ["stove"];
  if (c === "Soya & dal") return /sattu/i.test(n) ? [] : /ready to eat|kitchens of india/i.test(n) ? ["heat"] : ["stove"];
  if (c === "Pasta & noodles") return /maggi|2 minutes|instant/i.test(n) ? ["heat"] : ["stove"];
  if (c === "Chicken") return /lyoner|salami/i.test(n) ? ["fridge"] : ["stove"];
  if (c === "Fish & seafood") return /in oil|in tomato|in brine|tuna/i.test(n) ? [] : /smoked salmon/i.test(n) ? ["fridge"] : ["stove"];
  if (c === "Mutton") return ["stove"];
  if (c === "Ready non-veg") return /microwave/i.test(f.prep || "") ? ["microwave", "fridge"] : ["fridge"];
  if (c === "Eggs") return ["heat"];
  if (c === "Oats & muesli") return /masala/i.test(n) ? ["heat"] : [];
  if (c === "Paneer & tofu") return /tempeh/i.test(n) ? ["stove"] : ["fridge"];
  if (["Milk", "Curd", "Yogurt", "Cheese", "Frozen dessert"].includes(c)) return /so good|uht|amul high protein/i.test(n) ? [] : ["fridge"];
  if (c === "Dairy drink") return /smoothie|milo|cold coffee|flavoured milk/i.test(n) ? [] : ["fridge"];
  if (c === "Protein shake") return /raw pressery/i.test(n) ? ["fridge"] : [];
  return [];
}
// Small chilled packs (a yogurt cup, a 200 ml lassi) can be bought and finished the same day without a fridge
const SINGLE_SERVE = (f) => f.packQty <= 250 && ["Yogurt", "Curd", "Milk", "Dairy drink", "Protein shake", "Frozen dessert"].includes(f.cat);
const DEFAULT_GEAR = { kettle: false, microwave: false, fridge: false };
function canMake(f, gear) {
  const g = Object.assign({}, DEFAULT_GEAR, gear);
  return needs(f).every(x => x === "stove" ? false : x === "heat" ? (g.kettle || g.microwave)
    : x === "microwave" ? g.microwave : x === "fridge" ? (g.fridge || SINGLE_SERVE(f)) : true);
}
// Single cups and bottles are bought and eaten whole: give them a "unit" so plans use whole ones.
const UNIT_WORD = { "Yogurt": "cup", "Curd": "cup", "Frozen dessert": "cup", "Dairy drink": "bottle", "Protein shake": "bottle", "Milk": "bottle" };
function normalizeUnits(foods) {
  if (foods._norm) return foods;
  for (const f of foods) if (!f.unit && SINGLE_SERVE(f)) f.unit = { name: /stick/i.test(f.name) ? "stick" : UNIT_WORD[f.cat], g: f.packQty };
  Object.defineProperty(foods, "_norm", { value: true });
  return foods;
}
// How long an opened pack may last before it goes off or ties up too much money (days)
const PERISHABLE = ["Milk", "Curd", "Paneer & tofu", "Yogurt", "Cheese", "Chicken", "Fish & seafood", "Mutton", "Ready non-veg", "Dairy drink"];
function packDays(f, budget) {
  let d = f.cat === "Bread" ? 6 : PERISHABLE.includes(f.cat) && needs(f).includes("fridge") ? 7 : f.cat === "Eggs" ? 14 : 30;
  if (f.cat === "Protein powder" || f.cat === "Nuts & seeds") return 45;   // tubs and nut packs are normal monthly buys
  if (f.price > 4 * budget) d = Math.min(d, 14);   // a pack costing 4+ days' budget should be used up in two weeks
  else if (f.price > 2 * budget) d = Math.min(d, 21);   // 2+ days' budget: within three weeks
  return d;
}
// Complete, well-absorbed protein (DIAAS about 0.9 or more: dairy, eggs, meat, fish, soya, whey).
// Cereals, nuts, dals, chana and sattu score lower (about 0.4-0.8), so they may add protein but not carry the plan.
const HQ_CATS = ["Milk", "Curd", "Yogurt", "Cheese", "Paneer & tofu", "Eggs", "Chicken", "Fish & seafood", "Mutton", "Ready non-veg", "Dairy drink"];
function hq(f) {
  if (HQ_CATS.includes(f.cat)) return true;
  if (f.cat === "Soya & dal") return /soya/i.test(f.name);
  if (f.cat === "Protein powder" || f.cat === "Protein shake") return !/pea|plant/i.test(f.name);   // whey, milk and yeast proteins
  return false;
}
const QUALITY = 0.65;   // share of the day's protein that should come from those foods
// A proper breakfast: a base (bread, oats, muesli) and a protein food that belongs at breakfast
const BF_BASE = (f) => f.cat === "Bread" || f.cat === "Oats & muesli";
const BF_PROT = (f) => ["Milk", "Eggs", "Curd", "Yogurt", "Cheese", "Paneer & tofu", "Dairy drink"].includes(f.cat) && !/tempeh/i.test(f.name);
// Salty packaged snacks: cheap calories, but not more than a small bowl a day
const SALTY = /namkeen|bhujia|chips|mixture|papdi|crusher|sev\b|puffs|crisps|nachos/i;
const SALTY_MAX = 30;

// One line telling a hostel or PG student how to have it
function howTo(f, gear) {
  const g = Object.assign({}, DEFAULT_GEAR, gear), nd = needs(f);
  const fresh = nd.includes("fridge") && !g.fridge ? " · buy fresh, finish the same day" : "";
  if (f.cat === "Eggs") return (g.kettle ? "Boil in your kettle, 12 min" : "Microwave in water with a lid, about 8 min") + fresh;
  if (nd.includes("microwave")) return "Microwave 2 min" + fresh;
  if (nd.includes("heat")) return (/noodle|maggi/i.test(f.name) ? "Add boiling water from your kettle, cover 3 min"
    : /oats/i.test(f.name) ? "Add hot water or hot milk, 3 min" : "Heat the pouch in hot water") + fresh;
  if (f.cat === "Oats & muesli") return /muesli|granola/i.test(f.name) ? "Eat with milk, curd or water" : "Soak in milk or water overnight" + fresh;
  if (f.cat === "Soya & dal" || f.cat === "Grains & atta") return "Mix in water or milk, no cooking";
  if (f.cat === "Protein powder") return "Shake with water or milk";
  if (nd.includes("fridge")) return g.fridge ? "Keep in the fridge" : "Buy fresh, finish the same day";
  return f.unitLabel === "ml" ? "Drink as it is" : "Eat as it is";
}

// Plan styles. Cheapest = lowest cost. Balanced and Tasty spread the day over more foods and
// treat plain staples as "costlier" (so nicer foods win when the budget allows); the real ₹
// budget is still enforced on true prices.
const STAPLE = (f) => ["Grains & atta", "Soya & dal", "Bread", "Pasta & noodles"].includes(f.cat) ||
  (f.cat === "Oats & muesli" && /rolled oats|plain|instant/i.test(f.name));
const NICE = (f) => ["Protein bar", "Protein shake", "Yogurt", "Paneer & tofu", "Chicken", "Fish & seafood",
  "Ready non-veg", "Frozen dessert", "Cheese", "Eggs", "Dairy drink", "Curd", "Milk"].includes(f.cat);
const STYLE = {
  cheap:    { weight: () => 1 },
  // Balanced: no single kind of food dominates; staples count a bit "dearer" so the plan mixes in nicer foods
  balanced: { weight: (f) => STAPLE(f) ? 1.6 : NICE(f) ? 0.85 : 1, catMax: 150, liquidMax: 350,
              tighter: { "Grains & atta": 150, "Bread": 100, "Snacks": 30, "Soya & dal": 120, "Eggs": 150 } },
  // Tasty: uses more of the budget on dairy, eggs, chicken, bars and shakes
  tasty:    { weight: (f) => STAPLE(f) ? 2.5 : NICE(f) ? 0.6 : 1, catMax: 150, liquidMax: 350,
              tighter: { "Grains & atta": 120, "Bread": 100, "Soya & dal": 80, "Eggs": 150 } },
};
const LIQUID_CATS = ["Milk", "Curd", "Yogurt", "Protein shake", "Dairy drink"];

// Quality and a proper breakfast are kept whenever the budget allows; if a plan can't be made with them,
// they're relaxed step by step (and the plan says so) rather than leaving the person with nothing.
function planDay(foods, opts, lp) {
  const q = opts && opts.quality != null ? opts.quality : QUALITY, bf = !!(opts && opts.breakfast);
  const run = (qq, bb) => { const r = planStyled(foods, Object.assign({}, opts, { quality: qq, breakfast: bb }), lp); r.quality = qq; r.breakfast = bb; return r; };
  const fine = (x) => x.ok && !x.closest && !x.overBudget && !x.budgetShort;
  const usable = (x) => x.ok && !x.closest && !x.overBudget;
  // 1) the full rules; a short budget may loosen quality a step at a time, but only for a real protein gain
  let best = run(q, bf);
  for (const qq of [0.5, 0.35].filter(v => v < q)) {
    if (fine(best)) break;
    const r = run(qq, bf);
    if (fine(r) || (usable(r) && (!usable(best) || r.totals.p >= best.totals.p * 1.1))) best = r;
  }
  // 2) a budget too small to even cover the calories: the amount of protein matters most, so the rules may go
  if (usable(best) && best.budgetSoft) {
    const r = run(0, false);
    if (usable(r) && r.totals.p >= best.totals.p * 1.1) best = r;
  }
  // 3) nothing workable at all: drop quality, then the breakfast rule
  if (!usable(best)) for (const [qq, bb] of [[0, bf], [0, false]]) {
    const r = run(qq, bb);
    if (usable(r) || (r.ok && !best.ok)) { best = r; if (usable(r)) break; }
  }
  best.qualityRelaxed = best.quality < q; best.breakfastRelaxed = bf && !best.breakfast;
  return best;
}
function planStyled(foods, opts, lp) {
  const style = (opts && opts.style) || "cheap";
  const r = planCore(foods, Object.assign({}, opts, { style }), lp);
  if (style === "cheap") return r;
  // If the nicer style can't reach what the cheapest plan reaches, fall back and say so.
  const rank = (x) => !x.ok ? 3 : x.closest ? 2 : (x.overBudget || x.budgetShort) ? 1 : 0;
  const base = planCore(foods, Object.assign({}, opts, { style: "cheap" }), lp);
  if (rank(r) > rank(base)) {
    // What the chosen style would cost with no budget limit, so the app can offer to raise the budget
    const free = planCore(foods, Object.assign({}, opts, { style, budget: 1e6 }), lp);
    const styleNeed = free.ok && !free.closest && !free.budgetShort ? free.totals.cost : null;
    return Object.assign(base, { styleRelaxed: style, styleNeed });
  }
  // On a short budget the point is the most protein; don't let the style cost protein
  // (but quote the chosen style's price for the full target, so raising the budget unlocks both)
  if (r.budgetShort && base.budgetShort && base.totals.p > r.totals.p + 3) {
    const free = planCore(foods, Object.assign({}, opts, { style, budget: 1e6 }), lp);
    const styleNeed = free.ok && !free.closest ? free.totals.cost : null;
    return Object.assign(base, { styleRelaxed: style, needCost: Math.max(styleNeed || 0, r.needCost || 0, base.needCost || 0) || null });
  }
  return r;
}

function planCore(foods, opts, lp) {
  normalizeUnits(foods);
  // The person's own price for a pack (if they corrected it) wins over ours
  const priceOf = (f) => (opts && opts.prices && opts.prices[f.id]) || f.price;
  const planCost = (r) => Object.keys(r).filter(k => k[0] === "x").reduce((s, k) => { const f = foods[+k.slice(1)]; return s + r[k] * priceOf(f) / f.packQty; }, 0);
  const o = Object.assign({
    budget: 200, protein: 120, kcal: 2200, kcalTol: 0.07, fatMax: null, fatMinShare: 0.2, kitchen: true,
    diet: "nonveg", stores: ["Blinkit", "Zepto", "Licious", "Brand store"], exclude: [], gear: DEFAULT_GEAR,
    have: { p: 0, kcal: 0, c: 0, f: 0 }, include: [], style: "cheap",
    carbs: null, fat: null, macroTol: 0.1, quality: QUALITY, breakfast: false, prices: {}, penalty: {}, keep: [],   // optional carbs / fat targets in grams (null = no target)   // include: [{ id, g }] foods the person wants every day
  }, opts);
  const allowDiet = { veg: ["veg"], egg: ["veg", "egg"], nonveg: ["veg", "egg", "nonveg"] }[o.diet];
  let pool = foods.filter(f => allowDiet.includes(f.diet) && o.stores.includes(f.store) && !o.exclude.includes(f.id)
    && (o.kitchen || canMake(f, o.gear)));

  // Foods the person picked are always in the pool (if their diet allows)
  const inc = o.include.filter(x => foods[x.id] && allowDiet.includes(foods[x.id].diet));
  for (const x of inc) if (!pool.includes(foods[x.id])) pool.push(foods[x.id]);
  const incIds = new Set(inc.map(x => x.id));
  // keep: foods that must stay in (at least this much) without being shown as the person's pick
  const keep = o.keep.filter(x => foods[x.id] && allowDiet.includes(foods[x.id].diet));
  for (const x of keep) if (!pool.includes(foods[x.id])) pool.push(foods[x.id]);
  const keepIds = new Set(keep.map(x => x.id));
  const forcedBy = (key) => inc.reduce((s, x) => s + (key(foods[x.id]) ? x.g : 0), 0);
  const poolSize = pool.length;
  const needP = Math.max(0, o.protein - o.have.p);
  const needK = Math.max(0, o.kcal - o.have.kcal);
  const needC = o.carbs == null ? null : Math.max(0, o.carbs - (o.have.c || 0));
  const needF = o.fat == null ? null : Math.max(0, o.fat - (o.have.f || 0));

  // soft = targets become goals: the solver may fall short, paying a big penalty per gram
  // of protein missed and per kcal outside the range, so it always returns the closest plan.
  const st = STYLE[o.style] || STYLE.cheap;
  const fixed = {};   // id -> exact grams, set while tidying the plan into whole units
  // maxP = the targets don't fit the budget: get as much protein as the budget allows instead
  const build = (withBudget, soft, maxP) => {
    const model = maxP ? { optimize: "score", opType: "max", constraints: {}, variables: {} }
                       : { optimize: "cost", opType: "min", constraints: {}, variables: {} };
    const c = model.constraints;
    // Protein is a target, not just a minimum: stay within +10% (at least 10 g) of it
    const pMax = Math.max(needP * 1.1, needP + 10);
    c.protein = maxP ? { max: pMax } : { min: needP, max: pMax };
    if (needC != null) c.carbs = { min: needC * (1 - o.macroTol), max: needC * (1 + o.macroTol) };
    if (needF != null) c.fatT = { min: needF * (1 - o.macroTol), max: needF * (1 + o.macroTol) };
    c.kcal = { min: needK * (1 - o.kcalTol), max: needK * (1 + o.kcalTol) };
    // At least ~20% of calories from fat, so the plan isn't a fat-free bread-and-dal diet
    if (needF == null) c.fatShare = { min: 0 };
    if (o.fatMax != null) c.fat = { max: Math.max(0, o.fatMax) };
    if (withBudget) c.budget = { max: o.budget };
    // Most of the day's protein (mess food counts as ordinary protein) from complete sources
    if (o.quality > 0) c.quality = { min: o.quality * o.have.p };
    if (o.breakfast) { c.bfBase = { min: 50 }; c.bfProt = { min: 12 }; }
    for (const f of pool) {
      const v = { cost: priceOf(f) / f.packQty * st.weight(f) * (o.penalty[f.id] || 1), budget: priceOf(f) / f.packQty, protein: f.p, kcal: f.kcal, fat: f.f,
        fatShare: 9 * f.f - o.fatMinShare * f.kcal, carbs: f.c, fatT: f.f };
      // protein counts far more than rupees, so this finds the most protein, then the cheapest way to get it
      if (maxP) v.score = 100 * f.p - v.cost;
      if (PULSE.test(f.name) && ["Soya & dal", "Grains & atta"].includes(f.cat) && !/atta$|wheat|khapli|multigrain/i.test(f.name)) v.pulse = 1;
      v["cat:" + f.cat] = 1;
      if (o.quality > 0) v.quality = f.p * ((hq(f) ? 1 : 0) - o.quality);
      if (o.breakfast) { if (BF_BASE(f)) v.bfBase = 1; if (BF_PROT(f)) v.bfProt = f.p; }
      if (!(f.cat in CAT_MAX)) { v["item:" + f.id] = 1; c["item:" + f.id] = { max: 100 }; }
      if (/soya/i.test(f.name) && f.cat === "Soya & dal") { v.soya = 1; }
      if (["Chicken", "Fish & seafood", "Mutton"].includes(f.cat)) v.meat = 1;
      if (f.cat === "Snacks" && SALTY.test(f.name)) v.salty = 1;
      if (fixed[f.id] != null) { v["fix:" + f.id] = 1; c["fix:" + f.id] = { min: fixed[f.id], max: fixed[f.id] }; }
      model.variables["x" + f.id] = v;
    }
    if (soft) {
      model.variables.sP = { cost: 20, protein: 1 };          // ₹20 penalty per gram of protein short
      model.variables.sPhi = { cost: 20, protein: -1 };       // and per gram over the range
      model.variables.sKlo = { cost: 1, kcal: 1 };            // ₹1 per kcal below the range
      model.variables.sKhi = { cost: 1, kcal: -1 };           // ₹1 per kcal above the range
      if (needC != null) { model.variables.sClo = { cost: 3, carbs: 1 }; model.variables.sChi = { cost: 3, carbs: -1 }; }
      if (needF != null) { model.variables.sFlo = { cost: 6, fatT: 1 }; model.variables.sFhi = { cost: 6, fatT: -1 }; }
    }
    for (const x of inc) { model.variables["x" + x.id]["inc:" + x.id] = 1; c["inc:" + x.id] = { min: x.g }; }
    for (const x of keep) if (model.variables["x" + x.id]) { model.variables["x" + x.id]["keep:" + x.id] = 1; c["keep:" + x.id] = { min: x.g }; }
    for (const cat in CAT_MAX) {
      let cap = CAT_MAX[cat];
      if (st.catMax) cap = Math.min(cap, LIQUID_CATS.includes(cat) ? st.liquidMax : st.catMax);
      if (st.tighter && st.tighter[cat] != null) cap = Math.min(cap, st.tighter[cat]);
      c["cat:" + cat] = { max: Math.max(cap, forcedBy(f => f.cat === cat)) };
    }
    c.soya = { max: SOYA_MAX };
    c.salty = { max: SALTY_MAX };
    c.pulse = { max: PULSE_MAX };
    c.meat = { max: Math.max(MEAT_MAX, forcedBy(f => ["Chicken", "Fish & seafood", "Mutton"].includes(f.cat))) };
    return model;
  };

  // Solve; then drop "sprinkle" amounts (a few grams of something) that would add a whole pack
  // to the shopping list, and re-solve while the plan stays feasible.
  const solveClean = (withBudget, soft, maxP) => {
    const mode = [withBudget, soft, !!maxP];
    let res = lp.Solve(build(withBudget, soft, maxP));
    for (let pass = 0; pass < 4 && res.feasible; pass++) {
      const tiny = Object.keys(res).filter(k => k[0] === "x" && res[k] > 1e-6 && res[k] < 15).map(k => +k.slice(1)).filter(id => !incIds.has(id) && !keepIds.has(id));
      if (!tiny.length) break;
      const keep = pool;
      pool = pool.filter(f => !tiny.includes(f.id));
      const next = lp.Solve(build(withBudget, soft, maxP));
      if (!next.feasible) { pool = keep; break; }
      res = next;
    }
    res._mode = mode;
    return res;
  };
  let res = solveClean(true, false);
  let overBudget = false, closest = false, budgetShort = false, budgetSoft = false, needCost = null;
  if (!res.feasible) {
    // 1) Targets are reachable, just not on this budget: show the most protein the budget buys,
    //    and remember what the full targets would cost
    const full = solveClean(false, false);
    if (full.feasible) {
      needCost = planCost(full);
      let best = solveClean(true, false, true);
      // the budget can't even cover the calories: closest plan that stays within budget
      if (!best.feasible) { best = solveClean(true, true); budgetSoft = best.feasible; }
      if (best.feasible) { res = best; budgetShort = true; }
      else { res = full; overBudget = true; }
    } else res = full;
  }
  if (!res.feasible) {
    // 2) Targets aren't reachable with these foods at all: closest plan within budget
    closest = true; overBudget = false;
    res = solveClean(true, true);
    if (!res.feasible) { res = solveClean(false, true); overBudget = true; }
    if (!res.feasible) return { ok: false, reason: "targets" };
  }
  // Tidy the plan so a person can actually follow it: whole eggs, bars, cups and bottles; no crumbs
  // (a few grams of something that would add a whole pack to the list); and no pack that would go
  // off, or sit around for weeks, before it's used up. Each fix is tried and kept only if the plan
  // still meets the same targets; otherwise the next option is tried.
  const mode = res._mode;
  const minG = (f) => f.unit ? f.unit.g : 15;
  const counted = (f) => f.unit && f.unit.name !== "scoop";   // eggs, bars, cups, bottles: whole ones only
  const issueOf = (id, g) => {
    const f = foods[id];
    if (incIds.has(id) || keepIds.has(id) || fixed[id] != null) return null;
    const need = f.packQty / packDays(f, o.budget);            // daily amount that finishes a pack in time
    const cap = CAT_MAX[f.cat] || 100;
    if (counted(f)) {
      const ug = f.unit.g, u = g / ug;
      const minU = need > ug * 1.02 ? Math.ceil(need / ug - 0.02) : 1;
      let cands = [...new Set([Math.round(u), Math.floor(u), Math.ceil(u), minU])].filter(n => n === 0 || n >= minU);
      if (!cands.includes(0)) cands.push(0);
      const ok = Math.abs(u - Math.round(u)) <= 0.05 && Math.round(u) >= minU;
      if (ok) return null;
      return { id, opts: cands.map(n => n * ug).filter(v => v <= Math.max(cap, ug)), size: g, pack: Math.round(u) < minU };
    }
    const minG = Math.max(15, need);
    if (g < minG - 0.5) return { id, opts: [0, ...(minG <= cap ? [minG] : [])], size: g, pack: need > 15 };
    return null;
  };
  const tried = {};
  for (let pass = 0; pass < 30; pass++) {
    const issues = Object.keys(res).filter(k => k[0] === "x" && res[k] > 1e-6).map(k => issueOf(+k.slice(1), res[k]))
      .filter(x => x && (tried[x.id] || 0) < 2).sort((a, b) => (b.pack ? 1 : 0) - (a.pack ? 1 : 0) || b.size - a.size);
    if (!issues.length) break;
    const is = issues[0]; tried[is.id] = (tried[is.id] || 0) + 1;
    // try the option closest to what the solver chose first
    const optsSorted = is.opts.sort((a, b) => Math.abs(a - is.size) - Math.abs(b - is.size));
    for (const g of optsSorted) {
      const keepPool = pool;
      if (g === 0) pool = pool.filter(f => f.id !== is.id); else fixed[is.id] = g;
      const next = lp.Solve(build(mode[0], mode[1], mode[2]));
      if (next.feasible) { next._mode = mode; res = next; break; }
      pool = keepPool; delete fixed[is.id];
    }
  }
  // One kind of bread, one spread and one milk is how people shop: drop the smaller duplicate if the plan still works
  const groupOf = (f) => f.cat === "Soya & dal" && /soya/i.test(f.name) ? "soya" : /atta$|atta \(|flour/i.test(f.name) && f.cat === "Grains & atta" ? "atta" : f.cat;
  for (const cat of ["Bread", "Spreads", "Milk", "Oats & muesli", "soya", "atta"]) {
    const ids = Object.keys(res).filter(k => k[0] === "x" && res[k] > 1e-6 && groupOf(foods[+k.slice(1)]) === cat && !incIds.has(+k.slice(1)) && !keepIds.has(+k.slice(1)))
      .map(k => +k.slice(1)).sort((a, b) => res["x" + a] - res["x" + b]);
    while (ids.length > 1) {
      const id = ids.shift(), keepPool = pool, fx = fixed[id];
      pool = pool.filter(f => f.id !== id); delete fixed[id];
      const next = lp.Solve(build(mode[0], mode[1], mode[2]));
      if (next.feasible) { next._mode = mode; res = next; } else { pool = keepPool; if (fx != null) fixed[id] = fx; }
    }
  }
  let items = [];
  for (const k in res) {
    if (k[0] !== "x") continue;
    const g = res[k];
    if (g < 0.5) continue; // ignore crumbs
    const f = foods[+k.slice(1)];
    items.push({ food: f, grams: g, cost: g * priceOf(f) / f.packQty, picked: incIds.has(f.id) });
  }
  // Last tidy-up. The solver sometimes needs a pinch of a "filler" food to land exactly on a limit.
  // A few grams aren't worth a pack: drop them (it moves the totals by a few kcal). Part-cups and
  // part-bottles become whole ones when that still fits the budget, otherwise they're dropped.
  let spent = items.reduce((s, it) => s + it.cost, 0);
  // First drop crumbs (so their cost frees up budget), then settle part-cups and part-bottles,
  // the most protein first, so rounding up spends the budget where it matters.
  const settle = (it, g) => { spent += (g - it.grams) * priceOf(it.food) / it.food.packQty; it.grams = g; it.cost = g * priceOf(it.food) / it.food.packQty; };
  items = items.filter(it => {
    const f = it.food;
    if (it.picked || keepIds.has(f.id) || counted(f)) return true;
    if (it.grams >= 10) return true;
    spent -= it.cost; return false;
  });
  const parts = items.filter(it => !it.picked && counted(it.food)).sort((a, b) => b.food.p * b.grams - a.food.p * a.grams);
  const gone = new Set();
  // tiny part-cups that can't be rounded up are let go first, so their cost doesn't block the rest
  for (const it of parts) {
    const ug = it.food.unit.g, u = it.grams / ug;
    if (!keepIds.has(it.food.id) && u < 0.35 && it.grams * it.food.p < 2) { spent -= it.cost; gone.add(it); }
  }
  for (const it of parts) {
    if (gone.has(it)) continue;
    const f = it.food, ug = f.unit.g;
    if (keepIds.has(f.id)) {
      const up = Math.ceil(it.grams / ug - 0.05) * ug, extra = (up - it.grams) * priceOf(f) / f.packQty;
      settle(it, spent + extra <= o.budget + 0.5 ? up : Math.max(ug, Math.floor(it.grams / ug + 0.05) * ug));
      continue;
    }
    const u = it.grams / ug, r = Math.round(u);
    if (Math.abs(u - r) <= 0.05 && r >= 1) { settle(it, r * ug); continue; }
    const up = Math.max(1, Math.ceil(u - 0.05)), extra = (up * ug - it.grams) * priceOf(f) / f.packQty;
    if (u >= 0.35 && spent + extra <= o.budget + 0.5) { settle(it, up * ug); continue; }
    if (u >= 1) { settle(it, Math.floor(u) * ug); continue; }
    if (it.grams * f.p < 2) { spent -= it.cost; gone.add(it); }   // a sip that adds under 2 g protein is dropped; something the plan really leans on stays
  }
  items = items.filter(it => !gone.has(it));
  items.sort((a, b) => b.food.p * b.grams - a.food.p * a.grams);
  const sum = (fn) => items.reduce((s, it) => s + fn(it), 0);
  const totals = {
    cost: sum(it => it.cost),
    p: sum(it => it.grams * it.food.p) + o.have.p,
    c: sum(it => it.grams * it.food.c) + (o.have.c || 0),
    f: sum(it => it.grams * it.food.f) + (o.have.f || 0),
    kcal: sum(it => it.grams * it.food.kcal) + o.have.kcal,
    hq: sum(it => hq(it.food) ? it.grams * it.food.p : 0),
  };
  // Weekly shop: whole packs needed for 7 days
  const week = items.map(it => {
    const packs = Math.max(1, Math.ceil((it.grams * 7) / it.food.packQty - 1e-6));
    return { food: it.food, packs, cost: packs * priceOf(it.food), lastsDays: (packs * it.food.packQty) / it.grams };
  });
  return { ok: true, overBudget, closest, budgetShort, budgetSoft, needCost, items, totals, week, weekCost: week.reduce((s, w) => s + w.cost, 0), poolSize: poolSize };
}

// A week that isn't the same food every day: two day-plans that alternate (A, B, A, B...).
// Day B makes the foods carrying most of day A's protein a bit "dearer" in the solver, so it
// leans on other foods; it still meets the same budget and targets on real prices.
function planWeek(foods, opts, lp) {
  const A = planDay(foods, opts, lp);
  if (!A.ok) return { ok: false, A };
  // The main protein food of day A gets dearer; foods not already in the cupboard get a little dearer
  // too, so day B mostly reuses what's been bought (fewer extra packs, nothing left to go off).
  const pen = Object.assign({}, opts && opts.penalty);
  const inA = new Set(A.items.map(it => it.food.id));
  const top = A.items.filter(it => !it.picked).sort((a, b) => b.grams * b.food.p - a.grams * a.food.p)[0];
  for (const f of foods) if (!inA.has(f.id)) pen[f.id] = (pen[f.id] || 1) * (PERISHABLE.includes(f.cat) || f.cat === "Bread" ? 1.35 : 1.12);
  if (top) pen[top.food.id] = (pen[top.food.id] || 1) * 1.8;
  // Fresh food bought for day A (bread, milk, curd, paneer...) is eaten on day B too, so it doesn't go off
  const fresh = A.items.filter(it => !it.picked && (PERISHABLE.includes(it.food.cat) || it.food.cat === "Bread"))
    .map(it => ({ id: it.food.id, g: it.grams }));
  for (const x of fresh) delete pen[x.id];
  let B = planDay(foods, Object.assign({}, opts, { penalty: pen, keep: fresh }), lp);
  const rank = (x) => !x.ok ? 3 : x.closest ? 2 : (x.overBudget || x.budgetShort) ? 1 : 0;
  if (!B.ok || rank(B) > rank(A) || (A.budgetShort && B.totals.p < A.totals.p - 3)) B = A;
  // Day B's own "what would it cost" figures come from a tweaked solve; quote day A's
  if (B !== A) for (const k of ["styleNeed", "needCost"]) if (A[k] != null) B[k] = A[k];
  const days = [A, B, A, B, A, B, A];
  // Weekly shop: whole packs for the 7 days
  const byId = new Map();
  for (const d of days) for (const it of d.items) {
    const w = byId.get(it.food.id) || { food: it.food, grams: 0, unitCost: it.cost / it.grams };
    w.grams += it.grams; byId.set(it.food.id, w);
  }
  const week = [...byId.values()].map(w => {
    const packs = Math.max(1, Math.ceil(w.grams / w.food.packQty - 1e-6));
    const packPrice = w.unitCost * w.food.packQty;
    return { food: w.food, grams: w.grams, packPrice, packs, cost: packs * packPrice, eatenCost: w.grams * w.unitCost, lastsDays: packs * w.food.packQty / (w.grams / 7) };
  }).sort((a, b) => b.cost - a.cost);
  return { ok: true, A, B, days, same: B === A, week, weekCost: week.reduce((s, w) => s + w.cost, 0), eatenCost: week.reduce((s, w) => s + w.eatenCost, 0) };
}

if (typeof module !== "undefined") module.exports = { planDay, planWeek, normalizeUnits, CAT_MAX, STYLE, needs, canMake, howTo, hq, QUALITY };

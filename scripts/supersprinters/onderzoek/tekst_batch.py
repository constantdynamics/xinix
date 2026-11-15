"""Laat Claude de SEC-stukken lezen: opdrachten bouwen, tokens tellen, in bulk versturen, uitkomsten ophalen, kosten bewaken.

  SEC_KEY=<sleutel> python3 tekst_batch.py <ssdata> <url van de hulpfunctie> <opdracht> [...]      (na tekst_haal.py)

Claude legt per stuk alleen feiten vast (wat is er gemeld, op welke voorwaarden wordt geld opgehaald) en voorspelt
niets: het kent de afloop van oude koersen uit zijn training, dus een voorspelling op oude gevallen zou niets bewijzen.
De sleutel voor de Claude API staat alleen in Supabase; alle verzoeken lopen via de tijdelijke hulpfunctie.

Opdrachten:
  steekproef            kiest 300 stukken (180 nieuws, 120 prospectus of registratie; vaste volgorde) → claude/steekproef.json
  schat                 schat de tokens en de kosten per model (4 tekens per token), zonder de API
  tel [n]               telt de tokens van n opdrachten per soort bij de API (gratis) en ijkt daarmee de schatting
  probeer <model> [n]   stuurt n stukken direct (gewone prijs) en toont de antwoorden: om de vraagstelling te proberen
  stuur <model> <set>   verstuurt in bulk (halve prijs); set = steekproef of rest
  haal                  haalt de uitkomsten van afgeronde opdrachten op en werkt het kasboek bij
  stand                 toont het kasboek: verstuurd, uitgegeven, plafond
  vergelijk             vergelijkt de modellen op de steekproef, veld voor veld
  bewaar <map>          zet de gelukte antwoorden per model en het kasboek in een map die bewaard wordt (proefdata)

Het kasboek (claude/kasboek.json) telt wat de API in rekening brengt (tokens × prijs). `stuur` weigert als de uitgaven
plus de verwachte kosten van de nieuwe opdrachten boven het plafond van $80 komen.
"""
import os, sys, json, gzip, glob, time, random, re
import pandas as pd
import requests

ROOT, URL, CMD = sys.argv[1], sys.argv[2], sys.argv[3]
ARGS = sys.argv[4:]
KEY = os.environ["SEC_KEY"]
D = os.path.join(ROOT, "sec"); CL = os.path.join(D, "claude"); os.makedirs(CL, exist_ok=True)
PLAFOND = 80.0
PRIJS = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.10, 0.50)}   # $ per miljoen tokens, in en uit
EFFORT = {"claude-opus-5-5": "medium", "claude-sonnet-5-5": "low", "claude-haiku-5-5": "low"}
MAX_TOKENS = 4000
KORT = {"claude-opus-5-5": "opus", "claude-sonnet-5-5": "sonnet", "claude-haiku-5-5": "haiku"}
S = requests.Session(); S.headers.update({"x-onderzoek": KEY, "content-type": "application/json"})

# Het schema staat bij elke opdracht in de invoer en kost per teken ongeveer twee keer zoveel tokens als gewone tekst.
# Daarom bevat het schema alleen namen, soorten en keuzelijsten; de uitleg per veld staat in de vraagstelling.
REGELS = """You extract facts from documents that companies file with the US Securities and Exchange Commission. The facts feed a statistical study of small-cap stocks. Nobody reads your answer directly; a program parses it, so precision matters and style does not.

Rules:
- Use only what the document says. Do not use anything you may know about the company or about what happened to its stock afterwards, and do not judge whether the stock will rise or fall.
- The text can be an excerpt. Where a part ends with "[... the document continues; the rest was not provided]", the rest is unknown to you. If a fact is not in the text, answer null; never estimate or guess a number.
- Amounts are US dollars as plain numbers (12500000, not "12.5 million"); share and warrant counts are plain numbers. If an amount is only given in another currency, answer null.
- Forward-looking-statement disclaimers and signature blocks are boilerplate: ignore them.

The financing object describes the capital raise the document is about; null if the document is not about the company raising money.
- structure: how the money is raised. equity_line = shares the company may sell to one investor over time.
- stage: proposed = announced without final terms; priced_or_signed = price and size are fixed; closed = money received; program_established = an at-the-market program or equity line was set up; program_update = sales under an existing program.
- gross_proceeds_usd: gross proceeds of this raise, before fees. max_program_usd: the maximum that may be sold under an at-the-market program, equity line or shelf.
- shares: common shares sold or to be sold, including pre-funded warrants and shares in units. warrant_shares: shares underlying warrants issued in this raise, not counting pre-funded warrants.
- floating_price: true if a conversion, exercise or purchase price depends on the future market price (discount to VWAP, reset provisions, variable-rate notes, equity line).
- strategic_or_insider_buyer: true if a named strategic partner or company insiders buy a meaningful part. proceeds_for_digital_assets: true if the stated main use of proceeds is buying cryptocurrency or other digital assets."""
SYSTEM = {
    "nieuws": REGELS + """

Fields for this current report (8-K or 6-K, with its press release if attached):
- events: the one to three most important things the filing reports, most important first. kind: strategy_pivot = a new line of business or a change of what the company is; digital_asset_treasury = buying or holding cryptocurrency as a treasury strategy; shareholder_vote_or_charter includes an increase of authorized shares.
- hardness: completed_or_binding = it happened or is contractually binding (reported results, a regulator's decision, a signed definitive agreement, a closed deal); planned_or_nonbinding = intentions, letters of intent, memoranda of understanding, proposals, plans.
- tone, for the business as the document states it: positive (growth, approval, new contract, results above the company's earlier guidance), negative (failed study, lost contract, deficiency notice, default, lawsuit against the company), neutral (administrative, or a capital raise on ordinary terms).
- amount_usd: the dollar size of the event if stated (contract value, purchase price, amount raised). named_counterparty: true if an identifiable other party is named (customer, partner, acquirer, regulator).
- takeover_cash_price_usd: if the company itself is being acquired for cash, the price per share. reverse_split_ratio: old shares per new share (20 for a 1-for-20 reverse split).
- authorized_shares_increase: true if the filing reports an approved or proposed increase of the authorized share count. going_concern_or_default: true if it reports substantial doubt about going concern, a default, a forbearance or a bankruptcy filing.
- summary_nl: one plain sentence in Dutch, at most 30 words, saying what the filing reports.""",
    "geld": REGELS + """

Fields for this prospectus or registration statement:
- role: priced_offering = final terms of a sale by the company; preliminary_offering = a sale by the company without final price; at_the_market_program = the company may sell shares into the market over time; equity_line = shares the company may sell to one investor over time; shelf_registration = registers securities for future sales without a specific deal; resale_by_holders = existing holders may sell and the company receives nothing (except on warrant exercise).
- resale_shares: shares registered for resale by holders, including shares underlying their warrants or notes.
- shares_outstanding_before and shares_outstanding_after: common shares outstanding before and after the offering, as stated (without exercise of warrants or options).
- last_reported_price_usd: the last reported sale price of the common stock stated in the document.
- non_affiliate_float_usd: aggregate market value of common stock held by non-affiliates, as stated under General Instruction I.B.6 of Form S-3 or I.B.5 of Form F-3. baby_shelf_limited: true if the document says the company is subject to that instruction (sales limited to one third of the public float in 12 months).
- going_concern: true if the text mentions substantial doubt about the company's ability to continue as a going concern.
- summary_nl: one plain sentence in Dutch, at most 30 words, saying what this document registers or offers.""",
}

NUM = {"anyOf": [{"type": "number"}, {"type": "null"}]}
BOOL = {"type": "boolean"}


def obj(props):
    return {"type": "object", "additionalProperties": False, "properties": props, "required": list(props)}


FINANCING = obj({
    "structure": {"type": "string", "enum": ["underwritten_public_offering", "registered_direct", "private_placement", "at_the_market_program", "equity_line", "warrant_exercise_or_inducement", "convertible_notes", "preferred_stock", "debt_not_convertible", "rights_offering", "other"]},
    "stage": {"type": "string", "enum": ["proposed", "priced_or_signed", "closed", "program_established", "program_update", "terminated"]},
    "gross_proceeds_usd": NUM, "max_program_usd": NUM, "shares": NUM, "price_per_share_usd": NUM, "warrant_shares": NUM, "warrant_exercise_price_usd": NUM,
    "floating_price": BOOL, "strategic_or_insider_buyer": BOOL, "proceeds_for_digital_assets": BOOL,
})
KINDS = ["earnings_or_guidance", "clinical_or_regulatory", "contract_or_partnership", "product_or_technology", "company_is_being_acquired", "company_acquires_business",
         "reverse_merger_or_spac", "equity_financing", "debt_or_convertible_financing", "strategy_pivot", "digital_asset_treasury", "listing_deficiency",
         "listing_compliance_regained", "reverse_split", "split_dividend_or_buyback", "management_or_board", "legal_or_investigation", "distress_or_default",
         "shareholder_vote_or_charter", "other"]
SCHEMA = {
    "nieuws": obj({
        "events": {"type": "array", "items": obj({
            "kind": {"type": "string", "enum": KINDS},
            "hardness": {"type": "string", "enum": ["completed_or_binding", "planned_or_nonbinding"]},
            "tone": {"type": "string", "enum": ["positive", "negative", "neutral"]},
            "amount_usd": NUM, "named_counterparty": BOOL})},
        "financing": {"anyOf": [FINANCING, {"type": "null"}]},
        "takeover_cash_price_usd": NUM, "reverse_split_ratio": NUM, "authorized_shares_increase": BOOL, "going_concern_or_default": BOOL,
        "summary_nl": {"type": "string"}}),
    "geld": obj({
        "role": {"type": "string", "enum": ["priced_offering", "preliminary_offering", "at_the_market_program", "equity_line", "shelf_registration", "resale_by_holders",
                                             "ipo_or_uplisting", "merger_or_exchange", "employee_plan", "other"]},
        "financing": {"anyOf": [FINANCING, {"type": "null"}]},
        "resale_shares": NUM, "shares_outstanding_before": NUM, "shares_outstanding_after": NUM, "last_reported_price_usd": NUM, "non_affiliate_float_usd": NUM,
        "baby_shelf_limited": BOOL, "going_concern": BOOL, "summary_nl": {"type": "string"}}),
}


def post(body, timeout=145):
    for attempt in range(4):
        try:
            r = S.post(URL, data=json.dumps(body), timeout=timeout)
            if r.status_code == 200: return r.json()
            print(f"HTTP {r.status_code}: {r.text[:400]}", flush=True)
            if r.status_code in (400, 401): sys.exit(1)
        except Exception as e:
            print(str(e)[:200], flush=True)
        time.sleep(15 * (attempt + 1))
    sys.exit("geen antwoord van de hulpfunctie")


def get(query, raw=False, timeout=145):
    for attempt in range(4):
        try:
            r = S.get(URL + "?" + query, timeout=timeout)
            if r.status_code == 200: return r.text if raw else r.json()
            print(f"HTTP {r.status_code}: {r.text[:400]}", flush=True)
            if r.status_code in (400, 401): sys.exit(1)
        except Exception as e:
            print(str(e)[:200], flush=True)
        time.sleep(15 * (attempt + 1))
    sys.exit("geen antwoord van de hulpfunctie")


def load_docs():
    """Per stuk de laatste opgehaalde tekst, met het soort stuk en de datum uit tekst_docs.parquet."""
    meta = pd.read_parquet(os.path.join(D, "tekst_docs.parquet")).set_index(["cik", "acc"])
    out = {}
    for p in sorted(glob.glob(os.path.join(D, "tekst", "part_*.jsonl.gz"))):
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for line in f:
                j = json.loads(line)
                if "error" in j or not j["docs"]: continue
                k = (int(j["cik"]), j["acc"])
                if k in meta.index: out[k] = j
    return meta, out


def doc_id(k):
    return f"{k[0]}_{k[1]}"


ITEM = re.compile(r"\bItem\s+\d\.\d\d")


def bericht(j, m):
    parts = []
    for i, d in enumerate(j["docs"]):
        kop = "MAIN DOCUMENT" if i == 0 else f"EXHIBIT {d['type']}"
        t = d["text"]
        if i == 0 and m.form.startswith("8-K"):
            # Het voorblad van een 8-K (adres, aankruisvakjes, genoteerde effecten) bevat geen feiten: begin bij het eerste onderdeel.
            hit = ITEM.search(t)
            if hit and 300 < hit.start() < 6000: t = t[hit.start():]
        parts.append(f"=== {kop} ===\n{t}" + ("\n[... the document continues; the rest was not provided]" if d["cut"] else ""))
    return f"Filing type: {m.form}\nFiling date: {m.date}\n\n" + "\n\n".join(parts) + "\n\nFill in the fields for this filing."


def params(model, soort, text):
    # De vraagstelling en het schema zijn bij elke opdracht van dezelfde soort gelijk (±3.000 tokens). Met cache_control
    # onthoudt de API dat vaste deel: de eerste opdracht betaalt er 1,25× voor, volgende opdrachten binnen vijf minuten 0,05×
    # (Haiku 0,1×). In bulk lukt dat niet bij elke opdracht; het kasboek rekent met wat de API werkelijk meldt.
    return {"model": model, "max_tokens": MAX_TOKENS, "system": [{"type": "text", "text": SYSTEM[soort], "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": text}],
            "output_config": {"effort": EFFORT[model], "format": {"type": "json_schema", "schema": SCHEMA[soort]}}}


def soort_van(m):
    return "nieuws" if m.soort == "nieuws" else "geld"


def kasboek():
    p = os.path.join(CL, "kasboek.json")
    return json.load(open(p)) if os.path.exists(p) else {"batches": [], "los": []}


def bewaar(kb):
    json.dump(kb, open(os.path.join(CL, "kasboek.json"), "w"), indent=1)


LEES_ONTHOUDEN = {"claude-opus-5-5": 0.05, "claude-sonnet-5-5": 0.05, "claude-haiku-5-5": 0.10}     # prijs van onthouden invoer t.o.v. gewone invoer


def kosten(model, usage, bulk):
    pin, puit = PRIJS[model]
    f = 0.5 if bulk else 1.0
    g = lambda k: usage.get(k) or 0
    tin = g("input_tokens") + 1.25 * g("cache_creation_input_tokens") + LEES_ONTHOUDEN[model] * g("cache_read_input_tokens")
    return f * (tin * pin + g("output_tokens") * puit) / 1e6


def uitgegeven(kb):
    return sum(b.get("kosten", 0.0) for b in kb["batches"]) + sum(x["kosten"] for x in kb["los"])


def onderweg(kb):
    return sum(b["verwacht"] for b in kb["batches"] if not b.get("klaar"))


def ijk():
    p = os.path.join(CL, "ijk.json")
    return json.load(open(p)) if os.path.exists(p) else {"tekens_per_token": 4.0, "vast": 1500, "uit": {"claude-opus-5-5": 1200, "claude-sonnet-5-5": 700, "claude-haiku-5-5": 700}}


def schat_tokens(text):
    y = ijk()
    return int(len(text) / y["tekens_per_token"]) + y["vast"]


meta, DOCS = load_docs()
keys = sorted(DOCS)
print(f"stukken met tekst: {len(keys)} van {len(meta)}", flush=True)

if CMD == "steekproef":
    rnd = random.Random(20261115)
    nieuws = [k for k in keys if meta.loc[k].soort == "nieuws"]; geld = [k for k in keys if meta.loc[k].soort != "nieuws"]
    pick = rnd.sample(nieuws, min(180, len(nieuws))) + rnd.sample(geld, min(120, len(geld)))
    json.dump([list(k) for k in pick], open(os.path.join(CL, "steekproef.json"), "w"))
    print(f"steekproef: {len(pick)} stukken; per jaar {pd.Series([meta.loc[k].date[:4] for k in pick]).value_counts().sort_index().to_dict()}")

elif CMD == "schat":
    sp = {tuple(k) for k in json.load(open(os.path.join(CL, "steekproef.json")))} if os.path.exists(os.path.join(CL, "steekproef.json")) else set()
    y = ijk()
    for naam, ks in (("steekproef", [k for k in keys if k in sp]), ("rest", [k for k in keys if k not in sp]), ("alles", keys)):
        tin = sum(schat_tokens(bericht(DOCS[k], meta.loc[k])) for k in ks)
        print(f"{naam}: {len(ks)} stukken, ±{tin / 1e6:.1f} mln tokens invoer | " + " | ".join(
            f"{KORT[m]} ${0.5 * (tin * PRIJS[m][0] + len(ks) * y['uit'][m] * PRIJS[m][1]) / 1e6:.2f}" for m in PRIJS) + "  (in bulk)")
    print(f"ijking: {y['tekens_per_token']:.2f} tekens per token, {y['vast']} tokens vast per opdracht, antwoord {y['uit']}")

elif CMD == "tel":
    n = int(ARGS[0]) if ARGS else 12
    rnd = random.Random(7); y = ijk(); rows = []
    for soort in ("nieuws", "geld"):
        ks = rnd.sample([k for k in keys if soort_van(meta.loc[k]) == soort], n)
        for model in ("claude-sonnet-5-5",):
            items = [{k2: v for k2, v in params(model, soort, bericht(DOCS[k], meta.loc[k])).items() if k2 != "max_tokens"} for k in ks]
            cnt = post({"op": "count", "items": items})
            for k, c in zip(ks, cnt): rows.append((soort, len(bericht(DOCS[k], meta.loc[k])), c))
    T = pd.DataFrame(rows, columns=["soort", "tekens", "tokens"])
    # tokens = vast + tekens / verhouding: kleinste kwadraten
    import numpy as np
    A = np.c_[np.ones(len(T)), T.tekens]; (vast, per), *_ = np.linalg.lstsq(A, T.tokens, rcond=None)
    y.update(tekens_per_token=float(1 / per), vast=int(vast)); json.dump(y, open(os.path.join(CL, "ijk.json"), "w"))
    print(T.groupby("soort").agg(n=("tokens", "size"), tekens=("tekens", "mean"), tokens=("tokens", "mean")).round(0).to_string())
    print(f"ijking: {1 / per:.2f} tekens per token, {int(vast)} tokens vast per opdracht (vraagstelling en schema)")

elif CMD == "probeer":
    model = ARGS[0]; n = int(ARGS[1]) if len(ARGS) > 1 else 4
    sp = [tuple(k) for k in json.load(open(os.path.join(CL, "steekproef.json")))]
    ks = [k for k in sp if soort_van(meta.loc[k]) == "nieuws"][:n] + [k for k in sp if soort_van(meta.loc[k]) == "geld"][:n]
    kb = kasboek()
    for k in ks:
        m = meta.loc[k]
        r = post({"op": "message", "params": params(model, soort_van(m), bericht(DOCS[k], m))}, timeout=145)
        c = kosten(model, r["usage"], bulk=False); kb["los"].append({"model": model, "doc": doc_id(k), "kosten": c, "usage": {a: r["usage"].get(a) for a in ("input_tokens", "output_tokens")}}); bewaar(kb)
        u = r["usage"]
        print(f"\n=== {doc_id(k)} {m.form} {m.date} | tokens in {u.get('input_tokens')} (+{u.get('cache_creation_input_tokens') or 0} geschreven, {u.get('cache_read_input_tokens') or 0} gelezen) uit {u.get('output_tokens')} | ${c:.4f} | einde: {r['stop']} | model {r['model']}")
        print(r["text"])
    print(f"\nuitgegeven tot nu toe: ${uitgegeven(kb):.2f}")

elif CMD == "stuur":
    model, welke = ARGS[0], ARGS[1]
    sp = [tuple(k) for k in json.load(open(os.path.join(CL, "steekproef.json")))]
    kb = kasboek(); y = ijk()
    # Al gedaan = wat voor dit model gelukt is, plus wat nog onderweg is. Een opdracht die mislukte (bijvoorbeeld door een
    # bestedingslimiet bij de API) gaat dus opnieuw mee.
    gedaan = set()
    for b in kb["batches"]:
        if b["model"] == model and not b.get("klaar"): gedaan |= set(b["docs"])
    for f in glob.glob(os.path.join(CL, f"uit_{KORT[model]}_*.jsonl")):
        for line in open(f):
            if line.strip():
                x = json.loads(line)
                if x.get("ok") and x.get("stop") == "end_turn": gedaan.add(x["id"])
    ks = [k for k in (sp if welke == "steekproef" else [k for k in keys if k not in set(sp)]) if k in DOCS and doc_id(k) not in gedaan]
    ks.sort(key=lambda k: (soort_van(meta.loc[k]), k))          # per soort bij elkaar: zelfde vaste deel achter elkaar
    if len(ARGS) > 2: ks = ks[:int(ARGS[2])]
    print(f"{model}, {welke}: {len(ks)} stukken te versturen", flush=True)
    pin, puit = PRIJS[model]
    i = 0
    while i < len(ks):
        chunk, size = [], 0
        while i < len(ks) and len(chunk) < 250:
            k = ks[i]; t = bericht(DOCS[k], meta.loc[k])
            if chunk and size + len(t) > 3_000_000: break
            chunk.append((k, t)); size += len(t); i += 1
        verwacht = 0.5 * (sum(schat_tokens(t) for _, t in chunk) * pin + len(chunk) * y["uit"][model] * 1.3 * puit) / 1e6
        if uitgegeven(kb) + onderweg(kb) + verwacht > PLAFOND:
            print(f"GESTOPT: uitgegeven ${uitgegeven(kb):.2f} + onderweg ${onderweg(kb):.2f} + deze ${verwacht:.2f} komt boven het plafond van ${PLAFOND:.0f}"); break
        r = post({"op": "batch_create", "requests": [{"custom_id": doc_id(k), "params": params(model, soort_van(meta.loc[k]), t)} for k, t in chunk]})
        kb["batches"].append({"id": r["id"], "model": model, "set": welke, "n": len(chunk), "docs": [doc_id(k) for k, _ in chunk], "verwacht": round(verwacht, 3), "verstuurd": time.strftime("%Y-%m-%d %H:%M")}); bewaar(kb)
        print(f"verstuurd: {r['id']} met {len(chunk)} stukken, verwacht ${verwacht:.2f} | uitgegeven ${uitgegeven(kb):.2f}, onderweg ${onderweg(kb):.2f}", flush=True)
        time.sleep(2)

elif CMD == "haal":
    kb = kasboek()
    for b in kb["batches"]:
        if b.get("klaar"): continue
        st = get(f"op=batch_get&id={b['id']}")
        print(f"{b['id']} ({KORT[b['model']]}, {b['n']}): {st['processing_status']} {st['request_counts']}", flush=True)
        if st["processing_status"] != "ended": continue
        raw = get(f"op=batch_results&id={b['id']}", raw=True, timeout=300)
        open(os.path.join(CL, f"uit_{KORT[b['model']]}_{b['id']}.jsonl"), "w").write(raw)
        lines = [json.loads(x) for x in raw.split("\n") if x.strip()]
        ok = [x for x in lines if x.get("ok")]
        b["kosten"] = round(sum(kosten(b["model"], x["usage"], bulk=True) for x in ok), 4)
        b["gelukt"] = len(ok); b["mislukt"] = len(lines) - len(ok); b["klaar"] = True
        tel_ = lambda k: sum((x["usage"].get(k) or 0) for x in ok)
        b["tokens_in"] = tel_("input_tokens"); b["tokens_uit"] = tel_("output_tokens")
        b["onthouden_geschreven"] = tel_("cache_creation_input_tokens"); b["onthouden_gelezen"] = tel_("cache_read_input_tokens")
        b["einde"] = pd.Series([x["stop"] for x in ok]).value_counts().to_dict()
        bewaar(kb)
        print(f"   opgehaald: {b['gelukt']} gelukt, {b['mislukt']} mislukt, ${b['kosten']:.2f} (verwacht ${b['verwacht']:.2f}); antwoord gemiddeld {b['tokens_uit'] // max(1, len(ok))} tokens; "
              f"vast deel onthouden bij {100 * b['onthouden_gelezen'] / max(1, b['onthouden_gelezen'] + b['onthouden_geschreven']):.0f}%; einde {b['einde']}")
    # ijk de verwachte antwoordlengte op wat er werkelijk terugkwam
    y = ijk()
    for m in PRIJS:
        bs = [b for b in kb["batches"] if b.get("klaar") and b["model"] == m and b.get("gelukt")]
        if bs: y["uit"][m] = int(sum(b["tokens_uit"] for b in bs) / sum(b["gelukt"] for b in bs))
    json.dump(y, open(os.path.join(CL, "ijk.json"), "w"))
    print(f"uitgegeven ${uitgegeven(kb):.2f}, onderweg ${onderweg(kb):.2f}, plafond ${PLAFOND:.0f}")

elif CMD == "stand":
    kb = kasboek()
    for b in kb["batches"]:
        print(f"{b['verstuurd']} {b['id']} {KORT[b['model']]:6s} {b['set']:10s} n={b['n']:4d} " + (f"klaar: {b['gelukt']} gelukt, ${b['kosten']:.2f}" if b.get("klaar") else f"onderweg, verwacht ${b['verwacht']:.2f}"))
    print(f"los geprobeerd: {len(kb['los'])} stukken, ${sum(x['kosten'] for x in kb['los']):.2f}")
    print(f"uitgegeven ${uitgegeven(kb):.2f}, onderweg ${onderweg(kb):.2f}, plafond ${PLAFOND:.0f}")

elif CMD == "vergelijk":
    res = {}
    for p in sorted(glob.glob(os.path.join(CL, "uit_*.jsonl"))):
        m = os.path.basename(p).split("_")[1]
        for line in open(p):
            if not line.strip(): continue
            x = json.loads(line)
            if not x.get("ok") or x.get("stop") != "end_turn": continue
            try: res.setdefault(m, {})[x["id"]] = json.loads(x["text"])
            except Exception: pass
    sp = [doc_id(tuple(k)) for k in json.load(open(os.path.join(CL, "steekproef.json")))]
    soort = {doc_id(k): soort_van(meta.loc[k]) for k in keys}
    print({m: sum(1 for d in sp if d in v) for m, v in res.items()})

    def eq(a, b):
        if a is None or b is None: return a is None and b is None
        if isinstance(a, bool) or isinstance(b, bool) or isinstance(a, str) or isinstance(b, str): return a == b
        return abs(a - b) <= 0.02 * max(abs(a), abs(b), 1e-9)

    def fin(v, f):
        return (v.get("financing") or {}).get(f) if v.get("financing") else None

    VELDEN = {
        "nieuws": {"eerste soort gebeurtenis": lambda v: v["events"][0]["kind"] if v["events"] else None,
                   "alle soorten (als verzameling)": lambda v: ",".join(sorted({e["kind"] for e in v["events"]})),
                   "hard of voorgenomen (eerste)": lambda v: v["events"][0]["hardness"] if v["events"] else None,
                   "toon (eerste)": lambda v: v["events"][0]["tone"] if v["events"] else None,
                   "bedrag (eerste)": lambda v: v["events"][0]["amount_usd"] if v["events"] else None,
                   "geld ophalen ja/nee": lambda v: v["financing"] is not None,
                   "vorm": lambda v: fin(v, "structure"), "stadium": lambda v: fin(v, "stage"), "opbrengst": lambda v: fin(v, "gross_proceeds_usd"),
                   "aandelen": lambda v: fin(v, "shares"), "prijs": lambda v: fin(v, "price_per_share_usd"), "warrants": lambda v: fin(v, "warrant_shares"),
                   "zwevende prijs": lambda v: fin(v, "floating_price"), "omgekeerde split": lambda v: v["reverse_split_ratio"],
                   "bod in contanten": lambda v: v["takeover_cash_price_usd"], "meer toegestane aandelen": lambda v: v["authorized_shares_increase"],
                   "voortbestaan of wanbetaling": lambda v: v["going_concern_or_default"]},
        "geld": {"rol van het stuk": lambda v: v["role"], "geld ophalen ja/nee": lambda v: v["financing"] is not None,
                 "vorm": lambda v: fin(v, "structure"), "stadium": lambda v: fin(v, "stage"), "opbrengst": lambda v: fin(v, "gross_proceeds_usd"),
                 "maximum programma": lambda v: fin(v, "max_program_usd"), "aandelen": lambda v: fin(v, "shares"), "prijs": lambda v: fin(v, "price_per_share_usd"),
                 "warrants": lambda v: fin(v, "warrant_shares"), "warrantprijs": lambda v: fin(v, "warrant_exercise_price_usd"), "zwevende prijs": lambda v: fin(v, "floating_price"),
                 "aandelen voor doorverkoop": lambda v: v["resale_shares"], "uitstaand vóór": lambda v: v["shares_outstanding_before"], "uitstaand na": lambda v: v["shares_outstanding_after"],
                 "laatste koers": lambda v: v["last_reported_price_usd"], "vrij verhandelbare waarde": lambda v: v["non_affiliate_float_usd"],
                 "baby shelf": lambda v: v["baby_shelf_limited"], "voortbestaan": lambda v: v["going_concern"]},
    }
    ref = "opus"
    for other in [m for m in res if m != ref]:
        print(f"\n== {other} tegenover {ref} ==")
        for srt, velden in VELDEN.items():
            ds = [d for d in sp if soort.get(d) == srt and d in res.get(ref, {}) and d in res[other]]
            print(f"-- {srt}: {len(ds)} stukken --")
            for naam, f in velden.items():
                a = [f(res[ref][d]) for d in ds]; b = [f(res[other][d]) for d in ds]
                same = sum(eq(x, y) for x, y in zip(a, b))
                gevuld = sum(1 for x in a if x not in (None, False))
                print(f"   {naam:34s} gelijk {100 * same / max(1, len(ds)):5.1f}%   (bij {ref} ingevuld: {gevuld})")
        # De feiten waar de meting op draait (tekst_feiten.py): hoe vaak zeggen de twee modellen hetzelfde, en kappa
        # (overeenstemming boven toeval: 1 = volledig, 0 = niet beter dan toeval).
        from tekst_feiten import feit, BOOL_NIEUWS, BOOL_GELD
        print(f"-- afgeleide feiten per stuk ({other} tegenover {ref}) --")
        for srt, velden in (("nieuws", BOOL_NIEUWS), ("geld", BOOL_GELD)):
            ds = [d for d in sp if soort.get(d) == srt and d in res.get(ref, {}) and d in res[other]]
            fa = [feit(res[ref][d], srt) for d in ds]; fb = [feit(res[other][d], srt) for d in ds]
            for k in velden:
                a = [bool(x[k]) for x in fa]; b = [bool(x[k]) for x in fb]; n = max(1, len(ds))
                po = sum(x == y for x, y in zip(a, b)) / n; pa, pb = sum(a) / n, sum(b) / n
                pe = pa * pb + (1 - pa) * (1 - pb); kappa = (po - pe) / (1 - pe) if pe < 1 else float("nan")
                print(f"   {srt:6s} {k:12s} gelijk {100 * po:5.1f}%  kappa {kappa:5.2f}  (ja bij {ref}: {sum(a)}, bij {other}: {sum(b)})")
elif CMD == "bewaar":
    # De antwoorden hebben geld gekost: per model alle gelukte antwoorden in één bestand, plus het kasboek, naar de
    # map die bewaard wordt (onderzoek/proefdata in de repository). Terugzetten: zie LEESMIJ.md daar.
    doel = ARGS[0]; os.makedirs(doel, exist_ok=True)
    for kort in KORT.values():
        best = {}
        for f in sorted(glob.glob(os.path.join(CL, f"uit_{kort}_*.jsonl"))):
            for line in open(f):
                if line.strip():
                    x = json.loads(line)
                    if x.get("ok") and x.get("stop") == "end_turn": best[x["id"]] = line.strip()
        if not best: continue
        with gzip.open(os.path.join(doel, f"uit_{kort}_alles.jsonl.gz"), "wt", encoding="utf-8") as f:
            for k in sorted(best): f.write(best[k] + "\n")
        print(f"{kort}: {len(best)} antwoorden bewaard")
    kb = kasboek(); json.dump(kb, open(os.path.join(doel, "kasboek.json"), "w"), indent=1)
    print(f"kasboek bewaard: uitgegeven ${uitgegeven(kb):.2f}")

else:
    sys.exit("onbekende opdracht")

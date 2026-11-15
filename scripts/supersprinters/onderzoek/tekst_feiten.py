"""Feiten per stuk, afgeleid uit het antwoord van Claude. Gedeeld door tekst_test.py (de meting) en tekst_batch.py
(de vergelijking van modellen), zodat beide precies dezelfde feiten bedoelen."""
import numpy as np

POS = {"clinical_or_regulatory", "contract_or_partnership", "product_or_technology", "earnings_or_guidance", "company_acquires_business"}
EQUITY = {"underwritten_public_offering", "registered_direct", "private_placement", "at_the_market_program", "equity_line", "warrant_exercise_or_inducement", "rights_offering", "preferred_stock"}
# Ja/nee-feiten per stuk waarop de feiten per kandidaat-dag gebouwd zijn.
BOOL_NIEUWS = ["hard_pos", "soft_pos", "equity_news", "priced", "warrants", "floating", "pivot", "target", "listing", "negative"]
BOOL_GELD = ["priced", "atm", "resale", "baby", "going", "floating", "warrants"]


def num(x):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else np.nan


def feit(v, soort):
    """v = het antwoord van Claude (dict) of None; soort = "nieuws" of iets anders (prospectus, registratie)."""
    if v is None: return None
    f = v.get("financing") or {}
    o = {"soort": soort, "fin": bool(f), "structure": f.get("structure"), "stage": f.get("stage"),
         "priced": f.get("stage") in ("priced_or_signed", "closed"), "equity": f.get("structure") in EQUITY,
         "warrants": num(f.get("warrant_shares")) > 0, "floating": bool(f.get("floating_price")),
         "price": num(f.get("price_per_share_usd")), "wprice": num(f.get("warrant_exercise_price_usd")), "shares": num(f.get("shares")),
         "gross": num(f.get("gross_proceeds_usd")), "crypto": bool(f.get("proceeds_for_digital_assets"))}
    if soort == "nieuws":
        ev = v.get("events") or []
        kinds = {e["kind"] for e in ev}
        o.update(first=ev[0]["kind"] if ev else None, kinds=kinds,
                 hard_pos=any(e["kind"] in POS and e["hardness"] == "completed_or_binding" and e["tone"] == "positive" for e in ev),
                 soft_pos=any(e["kind"] in POS and e["hardness"] == "planned_or_nonbinding" and e["tone"] == "positive" for e in ev),
                 equity_news=("equity_financing" in kinds) or o["equity"],
                 pivot=bool(kinds & {"strategy_pivot", "digital_asset_treasury"}),
                 target=("company_is_being_acquired" in kinds) or bool(np.isfinite(num(v.get("takeover_cash_price_usd")))),
                 listing=bool(kinds & {"listing_deficiency", "reverse_split"}) or bool(np.isfinite(num(v.get("reverse_split_ratio")))),
                 negative=any(e["tone"] == "negative" for e in ev) or bool(v.get("going_concern_or_default")) or bool(kinds & {"distress_or_default"}))
    else:
        role = v.get("role")
        o.update(role=role, priced=o["priced"] or role == "priced_offering", atm=role in ("at_the_market_program", "equity_line") or f.get("structure") in ("at_the_market_program", "equity_line"),
                 resale=role == "resale_by_holders", baby=bool(v.get("baby_shelf_limited")), going=bool(v.get("going_concern")),
                 before=num(v.get("shares_outstanding_before")), resale_shares=num(v.get("resale_shares")))
    return o

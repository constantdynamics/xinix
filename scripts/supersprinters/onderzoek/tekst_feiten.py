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
    vast = f.get("stage") in ("priced_or_signed", "closed")            # de voorwaarden liggen vast
    o = {"soort": soort, "fin": bool(f), "structure": f.get("structure"), "stage": f.get("stage"),
         "vast": vast, "priced": vast, "equity": f.get("structure") in EQUITY,
         "warrants": num(f.get("warrant_shares")) > 0,
         # Een doorlopend verkoopprogramma verkoopt tegen de koers van de dag; dat is feit P2, niet "een prijs die meebeweegt".
         "floating": bool(f.get("floating_price")) and f.get("structure") != "at_the_market_program",
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
        rs = num(v.get("resale_shares"))
        # Geprijsde uitgifte = een prospectus met de definitieve voorwaarden van een verkoop door het bedrijf zelf. Een
        # registratie voor doorverkoop beschrijft wel de (gesloten) plaatsing waar de aandelen uit komen, maar is feit P3.
        o.update(role=role, priced=role == "priced_offering" or (role == "ipo_or_uplisting" and vast),
                 atm=role in ("at_the_market_program", "equity_line") or f.get("structure") in ("at_the_market_program", "equity_line"),
                 # De registratie waarmee de belegger achter een kredietlijn doorverkoopt hoort bij de kredietlijn (P2), niet bij P3.
                 resale=role == "resale_by_holders" and f.get("structure") not in ("at_the_market_program", "equity_line"),
                 baby=bool(v.get("baby_shelf_limited")), going=bool(v.get("going_concern")),
                 before=num(v.get("shares_outstanding_before")), resale_shares=rs,
                 shares=o["shares"] if np.isfinite(o["shares"]) else rs)
    return o

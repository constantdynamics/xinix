#!/bin/bash
# De vijf modellen op uitkomsten vanaf de opening, na elkaar (elk ±10 minuten; een jaar dat al klaar is wordt overgeslagen).
#   bash open_modellen.sh        vanuit scripts/supersprinters/onderzoek; logboeken in ../ssdata/runs
cd "$(dirname "$0")" || exit 1
R=../ssdata/runs; mkdir -p $R
Y=2019,2020,2021,2022,2023,2024,2025,2026
python3 exp_open.py open_yo yo $Y >> $R/open_yo.log 2>&1                           # raak vanaf de opening
python3 exp_open.py open_yo_gap yo $Y extra=gap1 >> $R/open_yo_gap.log 2>&1        # idem, met de opening zelf als kenmerk
python3 exp_open.py open_loss 'r10o<-0.3' $Y >> $R/open_loss.log 2>&1              # 30% of meer lager na 10 handelsdagen
python3 exp_open.py open_win 'r10o>0.2' $Y >> $R/open_win.log 2>&1                 # 20% of meer hoger na 10 handelsdagen
python3 exp_open.py open_ret r10o $Y obj=huber clip=-0.6,1.5 >> $R/open_ret.log 2>&1   # verwacht rendement

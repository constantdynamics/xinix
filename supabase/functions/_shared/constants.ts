// Gedeelde constanten voor alle edge functions.
// Wijzig hier — niet in de individuele functiebestanden.

// Marktconforme transactiekosten: 0,1% per transactie (kopen én verkopen).
// Rekenformule: kopen → cash -= qty × prijs × (1 + TX_COST)
//               verkopen → cash += qty × prijs × (1 - TX_COST)
// Bron: IBKR/Alpaca tarieven voor kleine US posities.
export const TX_COST = 0.001;

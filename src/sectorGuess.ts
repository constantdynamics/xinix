// Raad de sector uit een bedrijfsnaam. Gebruikt bij het inladen van tickers,
// waar Yahoo wel een naam maar geen bruikbare sector teruggeeft.
//
// Volgorde telt: mining eerst (commodity-woorden zijn het sterkste signaal),
// dan AI/semiconductor, dan biotech — anders zou "Applied Sciences" in een
// chipnaam als biotech binnenkomen, en "BioGold Resources" als biotech in
// plaats van mining.

import type { Sector } from "./types";

const MINING_RE =
  /\b(mining|miner|mines|metals?|minerals?|resources?|exploration|drill(?:ing)?|royalt(?:y|ies)|streaming|gold|silver|copper|lithium|uranium|nickel|cobalt|graphite|zinc|platinum|palladium|tin|tungsten|molybdenum|rare\s*earth|potash|iron\s*ore|coal)\b/i;

const AI_RE =
  /\b(semiconductors?|semis?|microelectronics?|micro\s*devices|foundr(?:y|ies)|wafers?|photonics?|optoelectronics?|lidar|silicon|chips?|chipsets?|integrated\s*circuits?|processors?|gpu|npu|fpga|artificial\s*intelligence|machine\s*learning|neural|data\s*cent(?:er|re)|cloud\s*computing|software|computing)\b/i;

const BIOTECH_RE =
  /\b(pharma(?:ceuticals?)?|biopharma|therapeutics|bio(?:science|tech(?:nology)?|logics|pharm)?|genomics?|gene(?:tic|ric)?|oncolog(?:y|ic)|immuno(?:logy|therap)|cell\s*(?:therap|technolog)|gene\s*therap|medicines?|medical|laboratories|labs|sciences|clinical|antibody|antibodies|vaccines?|RNA|DNA|protein)\b/i;

export function inferSector(company: string | null | undefined): Sector {
  if (!company) return "other";
  if (MINING_RE.test(company)) return "mining";
  if (AI_RE.test(company)) return "ai";
  if (BIOTECH_RE.test(company)) return "biotech";
  return "other";
}

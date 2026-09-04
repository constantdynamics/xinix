// Neon-palet voor de kolomkleuren in de kolom-kiezer. 25 tinten die alle
// duidelijk afsteken tegen het pikzwarte canvas (#0a0a0a): geen enkele
// kleur zit onder ~65% luminantie-contrast met de achtergrond.
export interface NeonKleur {
  hex: string;
  naam: string;
}

export const NEON_KLEUREN: NeonKleur[] = [
  { hex: "#ff1f8f", naam: "Hot pink" },
  { hex: "#ff5cab", naam: "Roze" },
  { hex: "#ff2d55", naam: "Framboos" },
  { hex: "#ff4d4d", naam: "Koraalrood" },
  { hex: "#ff6f00", naam: "Oranje" },
  { hex: "#ff9500", naam: "Amber" },
  { hex: "#ffb300", naam: "Goud" },
  { hex: "#ffd60a", naam: "Geel" },
  { hex: "#eaff00", naam: "Citroen" },
  { hex: "#a7ff1f", naam: "Limoen" },
  { hex: "#66ff33", naam: "Gifgroen" },
  { hex: "#1ae85a", naam: "Smaragd" },
  { hex: "#00ff9d", naam: "Mint" },
  { hex: "#00ffd5", naam: "Turkoois" },
  { hex: "#22d3ee", naam: "Cyaan" },
  { hex: "#38bdf8", naam: "Hemelblauw" },
  { hex: "#4d94ff", naam: "Azuur" },
  { hex: "#7c8cff", naam: "Indigo" },
  { hex: "#a78bfa", naam: "Lavendel" },
  { hex: "#c77dff", naam: "Violet" },
  { hex: "#e05cff", naam: "Magenta" },
  { hex: "#ff7ae0", naam: "Fuchsia" },
  { hex: "#ffb3c1", naam: "Zalm" },
  { hex: "#d4d4d4", naam: "Zilver" },
  { hex: "#ffffff", naam: "Wit" },
];

export const NEON_HEX = new Set(NEON_KLEUREN.map((k) => k.hex));

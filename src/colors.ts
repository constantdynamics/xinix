import type { Color } from "./types";

export const COLOR_BG: Record<Color, string> = {
  white: "bg-slate-100 text-slate-900 border-slate-300",
  yellow: "bg-yellow-300 text-slate-900 border-yellow-500",
  orange: "bg-orange-500 text-white border-orange-700",
  red: "bg-red-600 text-white border-red-800",
};

export const COLOR_DOT: Record<Color, string> = {
  white: "bg-slate-200 ring-slate-400",
  yellow: "bg-yellow-300 ring-yellow-500",
  orange: "bg-orange-500 ring-orange-700",
  red: "bg-red-600 ring-red-800",
};

export const COLOR_LABEL_NL: Record<Color, string> = {
  white: "Geen signaal",
  yellow: "Lichte verwachting",
  orange: "Sterke verwachting",
  red: "Mega-verwachting",
};

export const COLOR_RANK: Record<Color, number> = {
  white: 0,
  yellow: 1,
  orange: 2,
  red: 3,
};

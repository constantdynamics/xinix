// Gedeelde tab-iconen. Gebruikt door de tabbalk (App.tsx), de view-koppen
// en de uitleg-panelen, zodat elk tabblad overal hetzelfde icoon toont.
import type { ReactNode } from "react";
import type { Tab } from "./tabsConfig";

export const ICON_BASE = `${import.meta.env.BASE_URL}icons/`;

// Kleurverloop van het Xinix-logo — zie .wordmark in index.css.
export const XINIX_GRADIENT =
  "linear-gradient(135deg, #6633ff 0%, #0099ff 40%, #00ddcc 70%, #00ff88 100%)";

// PNG-masker-iconen per tab (uit public/icons/).
const IMAGE_ICON: Partial<Record<Tab, { file: string; flip?: boolean }>> = {
  dashboard: { file: "observatory.png" },
  limits: { file: "rainbow.png" },
  xinix: { file: "leaderboard.png" },
  feniks: { file: "phoenix.png" },
  poefies: { file: "lightning.png" },
  zwitserleven: { file: "palm-tree.png", flip: true },
};

// Hikkertjes tab → W-wave glow (poefjes-variant 05). `gradient` vult de lijn
// met het Xinix-kleurverloop in plaats van currentColor.
function WaveTabIcon({ gradient }: { gradient?: boolean }) {
  return (
    <svg
      viewBox="0 0 32 32"
      style={{ width: "1em", height: "1em", filter: "drop-shadow(0 0 2px currentColor)" }}
      aria-hidden="true"
    >
      {gradient && (
        <defs>
          <linearGradient id="xinix-wave-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6633ff" />
            <stop offset="40%" stopColor="#0099ff" />
            <stop offset="70%" stopColor="#00ddcc" />
            <stop offset="100%" stopColor="#00ff88" />
          </linearGradient>
        </defs>
      )}
      <polyline
        points="1,22 6,10 11,22 16,10 21,22 26,10 31,22"
        fill="none"
        stroke={gradient ? "url(#xinix-wave-grad)" : "currentColor"}
        strokeWidth="3"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
    </svg>
  );
}

// PNG-masker-icoon — erft de steunkleur (currentColor) van de context, of
// vult met het Xinix-kleurverloop als `gradient` is gezet.
function TabImageIcon({ file, flip, gradient }: { file: string; flip?: boolean; gradient?: boolean }) {
  const src = `${ICON_BASE}${file}`;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "1.15em",
        height: "1.15em",
        background: gradient ? XINIX_GRADIENT : "currentColor",
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        transform: flip ? "scaleX(-1)" : undefined,
        // Zachte gloed in de eigen kleur — laat het icoon op zwart feller oogen.
        filter: gradient ? undefined : "drop-shadow(0 0 2px currentColor)",
      }}
    />
  );
}

export const TAB_ICONS: Partial<Record<Tab, ReactNode>> = {
  dashboard: <TabImageIcon file="observatory.png" />,
  limits: <TabImageIcon file="rainbow.png" />,
  xinix: <TabImageIcon file="leaderboard.png" />,
  feniks: <TabImageIcon file="phoenix.png" />,
  poefies: <TabImageIcon file="lightning.png" />,
  hikkertjes: <WaveTabIcon />,
  zwitserleven: <TabImageIcon file="palm-tree.png" flip />,
};

// Tab-icoon in het Xinix-kleurverloop — voor de uitleg-panelen bovenaan
// elk tabblad. `null` als het tabblad geen icoon heeft.
export function GradientTabIcon({ tab }: { tab: Tab }) {
  if (tab === "hikkertjes") return <WaveTabIcon gradient />;
  const img = IMAGE_ICON[tab];
  if (!img) return null;
  return <TabImageIcon file={img.file} flip={img.flip} gradient />;
}

// Het tab-icoon voor gebruik in een view-kop of -tegel. `null` als het
// tabblad (nog) geen icoon heeft.
export function TabIcon({ tab }: { tab: Tab }) {
  return <>{TAB_ICONS[tab] ?? null}</>;
}

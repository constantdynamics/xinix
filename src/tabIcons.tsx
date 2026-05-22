// Gedeelde tab-iconen. Gebruikt door de tabbalk (App.tsx) én door de
// view-koppen/tegels, zodat elk tabblad overal hetzelfde icoon toont.
import type { ReactNode } from "react";
import type { Tab } from "./tabsConfig";

// Hikkertjes tab → W-wave glow (poefjes-variant 05)
function WaveTabIcon() {
  return (
    <svg viewBox="0 0 32 32" style={{ width: "1em", height: "1em", filter: "drop-shadow(0 0 2px currentColor)" }} aria-hidden="true">
      <polyline points="1,22 6,10 11,22 16,10 21,22 26,10 31,22" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="miter" strokeLinecap="square"/>
    </svg>
  );
}

// Tab-iconen uit public/icons/ — een PNG-masker, zodat het icoon de
// steunkleur (currentColor) erft van de context waarin het staat.
function TabImageIcon({ src, flip }: { src: string; flip?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "1.15em",
        height: "1.15em",
        backgroundColor: "currentColor",
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
        filter: "drop-shadow(0 0 2px currentColor)",
      }}
    />
  );
}

export const ICON_BASE = `${import.meta.env.BASE_URL}icons/`;

export const TAB_ICONS: Partial<Record<Tab, ReactNode>> = {
  dashboard: <TabImageIcon src={`${ICON_BASE}observatory.png`} />,
  limits: <TabImageIcon src={`${ICON_BASE}rainbow.png`} />,
  xinix: <TabImageIcon src={`${ICON_BASE}leaderboard.png`} />,
  feniks: <TabImageIcon src={`${ICON_BASE}phoenix.png`} />,
  poefies: <TabImageIcon src={`${ICON_BASE}lightning.png`} />,
  hikkertjes: <WaveTabIcon />,
  zwitserleven: <TabImageIcon src={`${ICON_BASE}palm-tree.png`} flip />,
};

// Het tab-icoon voor gebruik in een view-kop of -tegel. `null` als het
// tabblad (nog) geen icoon heeft.
export function TabIcon({ tab }: { tab: Tab }) {
  return <>{TAB_ICONS[tab] ?? null}</>;
}

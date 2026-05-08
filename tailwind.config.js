/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Defog-inspired palet — pikzwart canvas, hot pink + lime accent.
        ink: {
          0: "#000000",
          1: "#0a0a0a", // page bg
          2: "#101010", // surface
          3: "#161616", // surface-elevated / hover
          4: "#1c1c1c", // surface-2
          5: "#262626", // border
          6: "#404040", // border-bright / focus
        },
        fog: {
          // Brand pink — wordmark, primary actie, FAB
          pink: "#ff1f8f",
          "pink-soft": "#ff5cab",
          "pink-bg": "#3a0a23", // pink-tinted dark surface (filter pill bg)
          // Lime green — BUY!, sterke positieve actie
          lime: "#a7ff1f",
          "lime-soft": "#c8ff5c",
          "lime-bg": "#1f3a0a",
          // Status
          gain: "#1ae85a",
          loss: "#ff1a1a",
          warn: "#ff6f00",
          watch: "#ffb300",
          info: "#22d3ee",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        display: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,31,143,0.25), 0 8px 32px -8px rgba(255,31,143,0.35)",
        "glow-lime":
          "0 0 0 1px rgba(167,255,31,0.25), 0 8px 32px -8px rgba(167,255,31,0.35)",
        sink: "inset 0 1px 0 rgba(255,255,255,0.04)",
      },
      borderRadius: {
        pill: "9999px",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        "fade-up": "fade-up 0.18s ease-out",
      },
    },
  },
  plugins: [],
};

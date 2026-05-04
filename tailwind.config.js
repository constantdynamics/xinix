/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        signal: {
          white: "#f8fafc",
          yellow: "#facc15",
          orange: "#f97316",
          red: "#dc2626",
        },
      },
    },
  },
  plugins: [],
};

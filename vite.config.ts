import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `BUILD_TARGET=pages` zet de base op /xinix/ zodat de assets onder
// constantdynamics.github.io/xinix/ werken. Default (Netlify) blijft "/".
const isPages = process.env.BUILD_TARGET === "pages";

export default defineConfig({
  plugins: [react()],
  base: isPages ? "/xinix/" : "/",
  server: {
    port: 5173,
  },
});

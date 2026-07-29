import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        bg: "#0a0710",
        panel: "#14101f",
        border: "#241d33",
        accent: "#8b5cf6",
      },
    },
  },
  plugins: [],
};
export default config;

import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // 編輯部 / 研究機構風：標題 serif，內文 sans，數字 mono
        serif: ["'Source Serif Pro'", "'Noto Serif TC'", "Georgia", "serif"],
        sans: ["Inter", "'Noto Sans TC'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "'IBM Plex Mono'", "Menlo", "monospace"],
      },
      colors: {
        ink: {
          50:  "#fafaf9",
          100: "#f5f5f4",
          200: "#e7e5e4",
          300: "#d6d3d1",
          400: "#a8a29e",
          500: "#78716c",
          600: "#57534e",
          700: "#44403c",
          800: "#292524",
          900: "#1c1917",
          950: "#0c0a09",
        },
        accent: {
          DEFAULT: "#1d4ed8", // indigo-700
          fg: "#eef2ff",
        },
        up:   "#047857",  // emerald-700
        down: "#b91c1c",  // red-700
      },
      letterSpacing: {
        tightish: "-0.011em",
      },
    },
  },
  plugins: [],
} satisfies Config;

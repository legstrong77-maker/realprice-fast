import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // 精品財經誌：display 用 Fraunces（光學尺寸 soft-serif），CJK 標題 Noto Serif TC
        serif: ["Fraunces", "'Noto Serif TC'", "Georgia", "serif"],
        sans: ["Inter", "'Noto Sans TC'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "'IBM Plex Mono'", "Menlo", "monospace"],
      },
      colors: {
        // 暖紙色系（warm paper / ink），取代原本偏冷的 stone
        ink: {
          50:  "#f8f4ec",  // 紙
          100: "#f1ebdf",
          200: "#e3dac8",  // 髮絲線
          300: "#cfc2a9",
          400: "#a99e86",
          500: "#7d7361",  // 次要文字
          600: "#5b5345",
          700: "#403a30",
          800: "#2a251d",
          900: "#1c1813",  // 深墨
          950: "#100d09",
        },
        // 黃銅金點綴
        brass: {
          50:  "#faf4e6",
          100: "#f3e7c8",
          200: "#e6cf94",
          300: "#d6b25e",
          400: "#c79a3b",
          500: "#b8862c",  // DEFAULT 黃銅
          600: "#9a6c22",
          700: "#7a531d",
          800: "#5c3e18",
          900: "#3f2b12",
        },
        accent: {
          DEFAULT: "#b8862c",  // 黃銅金（取代原本的 indigo）
          fg: "#fbf6ea",
          deep: "#7a531d",     // 深黃銅（深色文字/連結）
        },
        up:   "#1f7a5c",  // 沉穩翠綠
        down: "#b14026",  // 赤陶紅
      },
      letterSpacing: {
        tightish: "-0.014em",
        tighter2: "-0.03em",
      },
      boxShadow: {
        card: "0 1px 2px rgba(28,24,19,0.04), 0 8px 24px -12px rgba(28,24,19,0.12)",
        lift: "0 2px 4px rgba(28,24,19,0.05), 0 18px 40px -16px rgba(28,24,19,0.22)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.6)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "draw-line": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.7s cubic-bezier(0.22,1,0.36,1) both",
        "fade-in": "fade-in 0.8s ease both",
        "scale-in": "scale-in 0.6s cubic-bezier(0.22,1,0.36,1) both",
        shimmer: "shimmer 2.4s linear infinite",
        "draw-line": "draw-line 0.9s cubic-bezier(0.22,1,0.36,1) both",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;

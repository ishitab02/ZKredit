/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#03140F",
          800: "#061E16",
          700: "#0A2A20",
          600: "#0F3B2D",
        },
        teal: {
          DEFAULT: "#00827c",
          bright: "#7FEBD9",
          glow: "#00A79B",
          deep: "#013D3A",
        },
        haze: {
          lav: "#FDE9FF",
          pink: "#FAD1FF",
        },
        amber: {
          DEFAULT: "#F5A623",
          bright: "#FBCB6B",
          glow: "#F5A623",
          deep: "#7A5410",
        },
        fog: {
          DEFAULT: "#EDFFFE",
          muted: "#BBC7C6",
          faint: "#6C807D",
        },
        abyss: "#012624",
        trench: "#011d1c",
        reef: "#003734",
        "ice-mist": "#edfffe",
        "snow-sheet": "#ffffff",
        aurora: "#cbfffc",
      },
      fontFamily: {
        display: ['"Clash Display"', "system-ui", "sans-serif"],
        sans: ['"Satoshi"', "system-ui", "sans-serif"],
        mono: ['"Space Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-xl": ["clamp(3rem, 11vw, 10.5rem)", { lineHeight: "0.92", letterSpacing: "-0.03em" }],
        "display-lg": ["clamp(2.5rem, 7vw, 6rem)", { lineHeight: "0.98", letterSpacing: "-0.02em" }],
        "display-md": ["clamp(2rem, 4.5vw, 3.75rem)", { lineHeight: "1.02", letterSpacing: "-0.015em" }],
      },
      maxWidth: {
        page: "1240px",
        prose: "720px",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseglow: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "0.9" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both",
        pulseglow: "pulseglow 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

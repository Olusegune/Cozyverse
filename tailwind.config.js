/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Near-black, neutral panels — matching the reference apps (RenderZero, Storymaker) rather
        // than the warm-brown take this replaces. A hint of warmth only, not a brown cast.
        base: {
          950: "#0b0a0c",
          900: "#121115",
          800: "#1a181d",
          700: "#29262d",
          600: "#3a363f",
        },
        // Solid gold/amber, replacing both the original purple and the terracotta this in turn
        // replaces — matches the CTA color in both reference apps. Buttons on this color use dark
        // text (text-base-950), not white, for contrast — see accentText below.
        accent: {
          500: "#e0a034",
          400: "#eeb658",
        },
        accentText: "#1a140a",
        // Overrides Tailwind's built-in "slate" scale with a neutral (not warm-tinted) dark-UI gray —
        // used extensively as text-slate-*/border-slate-* throughout every page, so retinting the
        // scale itself carries the palette everywhere from this one place.
        slate: {
          50: "#f4f4f5",
          100: "#e4e4e7",
          200: "#c9c9cf",
          300: "#a8a8b3",
          400: "#87868f",
          500: "#6c6b74",
          600: "#535259",
          700: "#3a3940",
          800: "#252428",
          900: "#18171a",
          950: "#0e0d0f",
        },
      },
      fontFamily: {
        // A bold geometric sans across the whole app, matching the reference apps' one-family
        // approach — no serif pairing, which read as "editorial blog" rather than production tool.
        display: ["\"Plus Jakarta Sans\"", "system-ui", "sans-serif"],
        sans: ["\"Plus Jakarta Sans\"", "system-ui", "sans-serif"],
      },
      // Overriding the whole scale (not just adding to it) so every existing rounded-md/lg/xl/full
      // class across every component sharpens up in one place, matching the reference apps' square
      // cards and buttons — no per-component className editing needed. "full" deliberately no longer
      // means a pill; nothing in this app should render as a true pill/circle button anymore.
      borderRadius: {
        none: "0px",
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "5px",
        xl: "6px",
        "2xl": "7px",
        "3xl": "8px",
        full: "4px",
      },
    },
  },
  plugins: [],
};

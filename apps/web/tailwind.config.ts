import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d2433",
        mist: "#eef2f6",
        line: "#d8dee8",
        brand: "#0f766e",
        coral: "#e76f51"
      }
    }
  },
  plugins: []
} satisfies Config;

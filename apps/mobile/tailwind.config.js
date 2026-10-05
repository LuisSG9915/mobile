/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Paleta neutra + acento índigo
        accent: {
          DEFAULT: "#4f46e5",
          soft: "#eef2ff",
          dark: "#3730a3",
        },
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
      },
    },
  },
  plugins: [],
};

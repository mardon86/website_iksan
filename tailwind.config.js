/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,njk,md}",
    "./src/**/*.js",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#fb2222",
          dark: "#c81a1a",
        },
        ink: {
          DEFAULT: "#111111",
          soft: "#1f2937",
        },
      },
    },
  },
  plugins: [],
};

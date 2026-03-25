/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        labPurple: "#7c3aed",
      },
      boxShadow: {
        panel: "0 12px 28px rgba(15, 23, 42, 0.06)",
      },
    },
  },
  plugins: [],
};

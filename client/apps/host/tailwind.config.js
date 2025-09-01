import path from "path";

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",

    // 👇 Add this so Tailwind scans your lib package
    path.join(__dirname, "../../packages/lib/src/**/*.{js,ts,jsx,tsx}"),
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

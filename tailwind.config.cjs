const path = require("node:path");

const repoGlob = (pattern) => path.join(__dirname, pattern).replace(/\\/g, "/");

module.exports = {
  content: [
    repoGlob("apps/workflow-builder/index.html"),
    repoGlob("apps/workflow-builder/src/**/*.{ts,tsx}"),
    repoGlob("packages/workflow-editor/src/**/*.{ts,tsx}"),
    repoGlob("packages/ui-platform/src/**/*.{ts,tsx}"),
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["Consolas", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

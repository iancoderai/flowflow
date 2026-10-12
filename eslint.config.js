const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [".expo/**", ".native-backup/**", "android/**", "ios/**", "node_modules/**"],
  },
  {
    files: ["scripts/**/*.js", "**/*.cjs"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
      },
    },
  },
]);

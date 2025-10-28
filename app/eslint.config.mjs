import next from "eslint-config-next";

export default [
  ...next,
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      "react/no-unescaped-entities": "warn",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "eslint-comments/no-unused-disable": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
];

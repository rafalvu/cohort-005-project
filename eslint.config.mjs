import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import a11y from "eslint-plugin-jsx-a11y";
import imports from "eslint-plugin-import";
import vitest from "@vitest/eslint-plugin";

const error = "error";
const syntax = [
  {
    selector:
      "CallExpression[callee.object.name='sql'][callee.property.name='raw']",
    message: "Use the parameterized Drizzle sql template.",
  },
  {
    selector:
      ":matches(CallExpression[callee.property.name='prepare'],CallExpression[callee.property.name='exec']) > :matches(BinaryExpression[operator='+'],TemplateLiteral[expressions.length>0])",
    message: "Bind query parameters instead of interpolating SQL text.",
  },
  {
    selector:
      "TSAsExpression[expression.type='CallExpression'][expression.callee.property.name='get'][typeAnnotation.type='TSStringKeyword']",
    message: "Validate the input with a schema.",
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: "Render text or use a reviewed HTML rendering boundary.",
  },
  {
    selector: "Literal[value=/^#[a-fA-F0-9]{3,8}$/]",
    message:
      "Use a design token. Document external palette requirements locally.",
  },
  {
    selector: "Literal[value=/[#][a-fA-F0-9]{3,8}\\]/]",
    message: "Use a design token in the utility class.",
  },
];

export default [
  {
    ignores: [
      "**/node_modules/**",
      "build/**",
      ".react-router/**",
      ".claude/**",
      "reports/**",
      ".agents/**",
      "coverage/**",
    ],
  },
  {
    files: ["app/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      react,
      "react-hooks": hooks,
      "jsx-a11y": a11y,
      import: imports,
    },
    settings: {
      react: { version: "detect" },
      "jsx-a11y": {
        components: {
          Input: "input",
          Textarea: "textarea",
          Label: "label",
          Button: "button",
        },
      },
      linkComponents: [{ name: "Link", linkAttribute: "to" }],
    },
    rules: {
      "@typescript-eslint/no-explicit-any": error,
      "@typescript-eslint/no-non-null-assertion": error,
      "@typescript-eslint/no-inferrable-types": error,
      "@typescript-eslint/only-throw-error": [
        error,
        {
          allow: [
            {
              from: "package",
              package: "react-router",
              name: "DataWithResponseInit",
            },
            { from: "lib", name: "Response" },
          ],
        },
      ],
      eqeqeq: [error, "always", { null: "ignore" }],
      "no-useless-catch": error,
      "no-param-reassign": [error, { props: true }],
      "prefer-const": error,
      "no-var": error,
      "prefer-arrow-callback": error,
      "no-console": error,
      "no-restricted-syntax": [error, ...syntax],
      "import/order": [
        error,
        {
          groups: [
            ["builtin", "external"],
            "internal",
            ["parent", "sibling", "index"],
          ],
          pathGroups: [{ pattern: "~/**", group: "internal" }],
          pathGroupsExcludedImportTypes: ["builtin"],
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-default-export": error,
      "react/jsx-key": error,
      "react/no-array-index-key": error,
      "react/jsx-no-target-blank": error,
      "react-hooks/rules-of-hooks": error,
      "react-hooks/exhaustive-deps": error,
      "react-hooks/purity": error,
      "react-hooks/globals": error,
      "react-hooks/immutability": error,
      "react-hooks/set-state-in-render": error,
      "jsx-a11y/alt-text": error,
      "jsx-a11y/label-has-associated-control": error,
      "jsx-a11y/tabindex-no-positive": error,
      "jsx-a11y/no-static-element-interactions": error,
      "jsx-a11y/click-events-have-key-events": error,
      "jsx-a11y/interactive-supports-focus": error,
      "jsx-a11y/prefer-tag-over-role": error,
    },
  },
  {
    files: ["app/lib/log.server.ts"],
    rules: { "no-console": [error, { allow: ["info", "error"] }] },
  },
  {
    files: ["app/routes/**/*", "app/root.tsx", "app/routes.ts", "app/entry.*"],
    rules: { "import/no-default-export": "off" },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    plugins: { vitest },
    rules: {
      "vitest/no-disabled-tests": error,
      "vitest/no-focused-tests": error,
    },
  },
];

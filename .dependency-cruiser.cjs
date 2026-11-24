// @ts-check
// Deep-module enforcement for dependency-cruiser.
//
// Each package under the packages root is a DEEP MODULE: a lot of behaviour
// behind a small interface. A package's PUBLIC SURFACE is its ENTRY POINTS:
// the files at the package root. Implementation lives in SUBFOLDERS and is
// private (by convention `lib/` for implementation and `tests/` for tests,
// though any subfolder is private). A package may expose several small entry
// points (index.ts, client.ts, server.ts, …); prefer that over one giant
// barrel index.
//
// Set PACKAGES_ROOT for the layout; add module-specific dependency rules below.

/** Where packages live. One immediate child dir per package (flat, no nesting). */
const PACKAGES_ROOT = "app/modules";

// --- derived patterns (no need to edit) -------------------------------------
const R = PACKAGES_ROOT;
/**
 * A package's private internals: anything nested inside a package subfolder.
 * The package's root files are its entry points and are NOT matched here:
 * they stay importable from outside.
 */
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "course-offerings-no-global-db",
      comment:
        "Course offering operations receive their database from the caller.",
      severity: "error",
      from: {
        path: `^${R}/course-offerings/`,
        pathNot: `^${R}/course-offerings/tests/`,
      },
      to: { path: "^app/db/index\\.ts$" },
    },
    {
      name: "instructor-operations-no-global-db",
      comment: "Instructor operations receive their database from the caller.",
      severity: "error",
      from: {
        path: `^${R}/instructor-operations/`,
        pathNot: `^${R}/instructor-operations/tests/`,
      },
      to: { path: "^app/db/index\\.ts$" },
    },
    {
      name: "lesson-operations-no-global-db",
      comment: "Lesson operations receive the database from their caller.",
      severity: "error",
      from: {
        path: `^${R}/lesson-operations/`,
        pathNot: `^${R}/lesson-operations/tests/`,
      },
      to: { path: "^app/db/index\\.ts$" },
    },
    {
      name: "course-permissions-no-global-db",
      comment:
        "Course permissions receive the database from their caller; the global application database is not a dependency.",
      severity: "error",
      from: {
        path: `^${R}/course-permissions/`,
        pathNot: `^${R}/course-permissions/tests/`,
      },
      to: { path: "^app/db/index\\.ts$" },
    },
    {
      name: "instructor-analytics-no-global-db",
      comment:
        "Instructor analytics receives its database from the caller. Schema imports are allowed, but importing the application database instance is not.",
      severity: "error",
      from: { path: `^${R}/instructor-analytics/` },
      to: { path: "^app/db/index\\.ts$" },
    },
    {
      name: "entrypoint-boundary-from-app",
      comment:
        "App/root code may import a package's entry points (its root files), but nothing inside its subfolders.",
      severity: "error",
      from: { pathNot: `^${R}/` }, // importer is NOT inside any package
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment:
        "A package's own files import each other freely, but may reach OTHER packages only through their entry points, never their internals.",
      severity: "error",
      // importer is inside a package ($1), but is not a test file
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/`, // same package → intra-package freedom
      },
    },
    {
      name: "tests-through-entrypoints",
      comment:
        "A package's tests exercise it through its entry points like everyone else: they may import any package's entry points and their own tests/ fixtures, but never any package's internals, not even their own.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/tests/` }, // a test file, in package $1
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/tests/`, // own tests/ fixtures → allowed
      },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "A package's tests/ folder is reachable only from tests: nothing else may import fixtures.",
      severity: "error",
      from: { pathNot: `^${R}/[^/]+/tests/` }, // importer is not itself a test
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: "no-circular",
      comment:
        "No dependency cycles. Scope to `^${R}/` if you want to allow cycles outside packages.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // --- Layering (optional, off by default) ----------------------------------
    // Interface-hiding controls HOW you import (through the entry points).
    // Layering controls WHICH packages may depend on which. Add your own rules
    // here, e.g.:
    //
    // {
    //   name: "ui-may-not-depend-on-billing",
    //   severity: "error",
    //   from: { path: `^${R}/ui/` },
    //   to:   { path: `^${R}/billing/` },
    // },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};

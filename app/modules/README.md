# Deep modules

Copy or delete `example/` when starting a module. Each immediate child of
`app/modules/` is one module; modules do not contain other modules.

```text
app/modules/<name>/
  index.ts           # Public entry point
  index.server.ts    # Optional server-only entry point
  lib/               # Private implementation
  tests/             # Tests and their fixtures
```

**Entry points:** Import only through a module's entry points (its root files).
Everything in any subfolder is private. Discourage barrel files: expose several
small entry points instead of re-exporting a whole subtree through one index.

**Implementation:** A module's implementation files may import each other freely.
Other modules' implementation remains private. Keep test fixtures in `tests/`,
reachable only by that module's tests.

**Tests:** Tests exercise modules through their entry points, including their own
module. They may import fixtures from their own `tests/` folder, but cannot import
implementation files or another module's fixtures.

**Cycles:** Dependency cycles are errors. Run `npm run lint:boundaries` to check
the import rules across `app/`. Include this command in CI alongside typecheck
and tests.

# Coding standards

## Fail with a thrown response, not a return value

A loader or an action that cannot continue throws. It does not return an
error shape for the component to unpack.

```ts
if (!course) throw data("Course not found", { status: 404 });
```

The route then has one success path. A returned error shape gives every
component a second path to forget about.

## Parse untrusted input with a schema

Form data, search parameters and request bodies get a zod schema before the
values reach any query. Do not read `formData.get("x") as string`. The cast
is a lie the type checker believes.

## Do not write `any`, and do not write `!`

Both switch the type checker off at the exact point you are least sure. If a
value can be missing, narrow it with a check. If you cannot name the type,
the shape is wrong — fix the shape.

## Let the code explain itself

Name and extract until a comment is unnecessary. A comment earns its place
only for a _why_ the code cannot express: a constraint, a decision, a link to
the ADR behind it. A comment that restates _what_ the code does goes stale the
first time the code changes.

## Arrange tests through the module under test

Test setup calls the module's own functions. When the function you need does
not exist, add it to the module rather than inserting rows directly, so a
change to how the module stores its data leaves its tests alone.

## Keep database queries behind the module's interface

Once behaviour belongs to a module, routes call its public entry points rather
than querying its tables themselves. Import modules through their root files;
implementation subfolders are private. Follow the layout and test-import rules
in [app/modules/README.md](./app/modules/README.md).

Instructor analytics receives its database as an argument. Its implementation
may import schema definitions, but must not import the global database from
`~/db` or an equivalent relative path. The analytics route currently imports
`db` only to pass it to `getInstructorAnalytics`; that wiring does not permit
adding analytics queries to the route.

During review, check both which files a dependency-cruiser rule covers and how
the imported dependency is used. Run `npm run lint:boundaries` after changing
imports; these rules are command-line checks, not TypeScript or editor
restrictions. A passing check does not replace reviewing query ownership.

## Use domain language in the interface

Navigation labels, page headings and route names use the concepts in
`GLOSSARY.md`. Review the visible language as well as identifiers: a page listing
Bookmarks and Notes should name those concepts, rather than introduce "Saved"
as another domain name. Ordinary action words such as "Save" remain appropriate.

When specification wording conflicts with the glossary, report the conflict
alongside the affected requirement. Apply an explicit user resolution across
navigation, headings and routes; otherwise keep the conflict visible in the
review rather than declaring both standards and specification satisfied.

## Review test setup at the public boundary

Arrange domain state through existing public operations, including Enrollment,
Seat claims, Refund Requests, Bookmarks and Notes. Review setup as well as
assertions. Prerequisites without a service creation API belong in the designated
fixture infrastructure; exceptional historical states need a fixture explaining
why the public operation cannot create them. See
[the testing guide](.agents/skills/tdd/tests.md#test-setup).

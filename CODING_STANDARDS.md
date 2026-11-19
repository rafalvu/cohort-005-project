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

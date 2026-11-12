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

## Store money as integer cents

Store every amount of money in an integer column containing cents. Calculate
discounts in cents and round once with `Math.round` at the point of sale.
Use `formatPrice(cents)` to display amounts. Floating-point dollar amounts
introduce rounding errors, and SQLite has no true decimal type.

## Use the existing Prettier configuration

Format files with Prettier and the repository's existing `.prettierrc`.
Do not change its settings to suit personal formatting preferences.

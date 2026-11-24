import { describe, expect, it } from "vitest";
import { greet } from "../index";

describe("greet", () => {
  it("greets a person with a normalized name", () => {
    expect(greet("  Ada   Lovelace  ")).toBe("Hello, Ada Lovelace!");
  });

  it("greets someone without a name", () => {
    expect(greet("   ")).toBe("Hello, friend!");
  });
});

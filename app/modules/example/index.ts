import { normalizeName } from "./lib/impl";

export function greet(name: string): string {
  return `Hello, ${normalizeName(name)}!`;
}

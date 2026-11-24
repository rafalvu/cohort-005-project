import { z } from "zod";

export const PAGE_SIZE = 25;
const pageNumber = z
  .string()
  .regex(/^[1-9]\d*$/)
  .pipe(
    z.coerce
      .number()
      .int()
      .max(Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE))
  );

export function readPage(url: URL, parameter = "page") {
  const result = pageNumber.safeParse(url.searchParams.get(parameter));
  return result.success ? result.data : 1;
}

export function pageOf<T>(rows: T[]) {
  return { items: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

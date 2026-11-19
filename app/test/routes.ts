import { createStaticHandler, type RouteObject } from "react-router";
import { setCurrentUserId } from "~/lib/session";

/** Exercise real route handlers with signed sessions, without opening a socket. */
export function createRouteHarness(routes: RouteObject[]) {
  const handler = createStaticHandler(routes);
  return async function request(
    path: string,
    options: {
      studentId?: number;
      country?: string;
      form?: Record<string, string>;
    } = {}
  ) {
    const headers = new Headers({ "CF-IPCountry": options.country ?? "US" });
    if (options.studentId !== undefined) {
      const cookie = await setCurrentUserId(
        new Request("http://localhost/"),
        options.studentId
      );
      headers.set("Cookie", cookie.split(";")[0]);
    }
    const result = await handler.query(
      new Request(`http://localhost${path}`, {
        headers,
        method: options.form ? "POST" : "GET",
        body: options.form ? new URLSearchParams(options.form) : undefined,
      })
    );
    if (result instanceof Response)
      throw new Error(`Unexpected redirect/response: ${result.status}`);
    return result;
  };
}

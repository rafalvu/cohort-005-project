// The provider can attach requests, headers and bodies to an exception. Only
// copy diagnostic fields, then redact credentials that also occur in text.
function redact(text: string) {
  const secrets = [
    "KNOCK_SECRET_API_KEY",
    "KNOCK_SIGNING_KEY",
    "POSTMARK_SERVER_TOKEN",
  ]
    .map((key) => process.env[key])
    .filter((value): value is string => Boolean(value));
  let safe = text
    .replace(
      /\b(?:authorization|cookie|set-cookie|x-postmark-server-token)\s*[:=][^\r\n]*/gi,
      "[redacted]"
    )
    .replace(/\bBearer\s+\S+/gi, "[redacted]");
  for (const secret of secrets) safe = safe.replaceAll(secret, "[redacted]");
  return safe;
}

function diagnostic(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return "Unknown error";
  const stack = redact(error.stack ?? error.message);
  return error.cause && depth < 3
    ? stack + "\nCaused by: " + diagnostic(error.cause, depth + 1)
    : stack;
}

export function logError(context: string, error: unknown) {
  console.error(redact(context), diagnostic(error));
}

export function logInfo(context: string) {
  console.info(redact(context));
}

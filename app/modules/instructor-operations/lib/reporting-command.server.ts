import { data } from "react-router";

export async function readCommand(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw data("Invalid form data.", { status: 400 });
  }
  const command: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of form) {
    if (Object.hasOwn(command, key))
      throw data("Duplicate form field.", { status: 400 });
    Object.defineProperty(command, key, { value, enumerable: true });
  }
  return command;
}

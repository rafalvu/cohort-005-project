import { expect, it } from "vitest";
import ts from "typescript";
import path from "node:path";
import { findDatabaseWrites } from "./database-access";

const root = process.cwd();
const config = ts.readConfigFile(
  path.join(root, "tsconfig.json"),
  ts.sys.readFile
);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);

it("recognizes database writes through aliases while allowing domain operations and ordinary collections", () => {
  const filename = path.join(root, "app/test/database-rule-example.ts");
  const source = `
import { createTestDb } from "./setup";
import { enrollStudentInTransaction } from "~/lib/enrollments.server";
import { users } from "~/db/schema";
const db = createTestDb();
const connection = db;
connection.insert(users);
connection["update"](users);
const { delete: remove } = connection;
remove(users);
connection.transaction(tx => { tx.delete(users); });
connection.$client.prepare("DELETE FROM users");
connection.$client.exec("DELETE FROM users");
connection.run("DELETE FROM users");
connection.get("DELETE FROM users RETURNING id");
connection.all("DELETE FROM users RETURNING id");
connection.values("DELETE FROM users RETURNING id");
enrollStudentInTransaction(db, 1, 2, new Date());
new Map().delete("key");
connection.$client.close();
`;
  const host = ts.createCompilerHost(parsed.options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (
    file,
    languageVersion,
    onError,
    shouldCreateNewSourceFile
  ) =>
    file === filename
      ? ts.createSourceFile(file, source, languageVersion, true)
      : original(file, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], parsed.options, host);
  const file = program.getSourceFile(filename);
  if (!file) throw new Error("Missing rule example");
  expect(
    findDatabaseWrites(file, program.getTypeChecker()).map(
      ({ method }) => method
    )
  ).toEqual([
    "insert",
    "update",
    "delete",
    "delete",
    "prepare",
    "exec",
    "run",
    "get",
    "all",
    "values",
  ]);
});

it("keeps direct database writes in the designated fixture infrastructure", () => {
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const violations = program.getSourceFiles().flatMap((file) => {
    const relative = path
      .relative(root, file.fileName)
      .replaceAll(path.sep, "/");
    const isTest =
      relative.startsWith("app/") &&
      (/\.(test|spec)\.[cm]?[jt]sx?$/.test(relative) ||
        relative.startsWith("app/test/"));
    if (
      !isTest ||
      ["app/test/setup.ts", "app/test/fixtures.ts"].includes(relative)
    )
      return [];
    return findDatabaseWrites(file, checker).map(
      ({ line, method }) =>
        `${relative}:${line}: ${method} — use a domain operation or app/test/fixtures.ts`
    );
  });
  expect(violations).toEqual([]);
}, 15000);

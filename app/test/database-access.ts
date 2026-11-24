import ts from "typescript";

export function findDatabaseWrites(
  source: ts.SourceFile,
  checker: ts.TypeChecker
) {
  const writes: { line: number; method: string }[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      const name =
        declaration && "name" in declaration ? declaration.name : undefined;
      const method = name && ts.isIdentifier(name) ? name.text : "";
      const file =
        declaration?.getSourceFile().fileName.replaceAll("\\", "/") ?? "";
      if (
        /\/node_modules\/(drizzle-orm|@types\/better-sqlite3)\//.test(file) &&
        (["insert", "update", "delete", "run", "exec", "prepare"].includes(
          method
        ) ||
          (file.endsWith("/sqlite-core/db.d.ts") &&
            ["get", "all", "values"].includes(method)))
      ) {
        writes.push({
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          method,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return writes;
}

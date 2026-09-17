import ts from "typescript-compiler-api";
import { SymbolNotFoundError } from "../errors.js";

export interface FunctionSignature {
  name: string;
  signature: string;
  jsDoc?: string;
}

export interface ImportUsage {
  name: string;
  modulePath: string;
  isLocal: boolean;
  calledDirectly: boolean;
  /** Name to look up in the target module; undefined for namespace imports (`import * as ns`). */
  exportedName?: string;
}

export interface SymbolAnalysis {
  symbol: string;
  usedImports: ImportUsage[];
  calledSiblings: FunctionSignature[];
}

type FunctionLikeNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

interface FunctionEntry {
  name: string;
  fnNode: FunctionLikeNode;
  /** Node to search for a leading JSDoc comment on (differs from fnNode for `const x = () => {}`). */
  docNode: ts.Node;
}

interface ImportEntry {
  localName: string;
  exportedName: string | undefined;
  modulePath: string;
  isLocal: boolean;
}

/**
 * Parses `sourceText` with the TypeScript compiler API and analyzes the
 * top-level declaration named `symbolName`: which imports it uses and
 * which same-file sibling functions it calls. One-hop only — does not
 * follow imports transitively, and matches identifiers syntactically by
 * name rather than resolving scope with the type checker.
 */
export function analyzeSymbol(sourceText: string, symbolName: string, fileLabel = "<source>"): SymbolAnalysis {
  const sourceFile = parse(sourceText, fileLabel);
  const functions = collectTopLevelFunctions(sourceFile);
  const imports = collectTopLevelImports(sourceFile);

  const target = functions.get(symbolName);
  if (!target) {
    throw new SymbolNotFoundError(symbolName, fileLabel);
  }

  const referencedNames = new Set<string>();
  const calledNames = new Set<string>();
  walkBody(getBody(target.fnNode), referencedNames, calledNames);

  const usedImports: ImportUsage[] = [];
  for (const name of referencedNames) {
    const entry = imports.get(name);
    if (!entry) continue;
    usedImports.push({
      name: entry.localName,
      modulePath: entry.modulePath,
      isLocal: entry.isLocal,
      calledDirectly: calledNames.has(name),
      ...(entry.exportedName !== undefined ? { exportedName: entry.exportedName } : {}),
    });
  }

  const calledSiblings: FunctionSignature[] = [];
  for (const name of calledNames) {
    if (name === symbolName) continue;
    const entry = functions.get(name);
    if (!entry) continue;
    calledSiblings.push(buildSignature(entry, sourceFile));
  }

  return { symbol: symbolName, usedImports, calledSiblings };
}

/**
 * Parses `sourceText` and returns the signature (name, params, return
 * type, JSDoc) of the top-level declaration named `name`, or `undefined`
 * if no such declaration exists. Used both for same-file siblings and for
 * resolving a one-hop local import to the symbol it points at.
 */
export function extractSignature(
  sourceText: string,
  name: string,
  fileLabel = "<source>",
): FunctionSignature | undefined {
  const sourceFile = parse(sourceText, fileLabel);
  const functions = collectTopLevelFunctions(sourceFile);
  const entry = functions.get(name) ?? resolveDefaultExport(sourceFile, functions, name);
  return entry ? buildSignature(entry, sourceFile) : undefined;
}

function parse(sourceText: string, fileLabel: string): ts.SourceFile {
  return ts.createSourceFile(fileLabel, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Returns the names of top-level functions whose source range contains at
 * least one of `changedLines` (1-indexed lines in this same version of the
 * file). Used to map a diff's changed lines to "the changed symbol" that
 * `analyzeSymbol` then explains context for.
 */
export function findChangedSymbols(sourceText: string, changedLines: number[], fileLabel = "<source>"): string[] {
  const sourceFile = parse(sourceText, fileLabel);
  const functions = collectTopLevelFunctions(sourceFile);
  const changed = new Set(changedLines);

  const matches: string[] = [];
  for (const entry of functions.values()) {
    const startLine = sourceFile.getLineAndCharacterOfPosition(entry.fnNode.getStart(sourceFile)).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(entry.fnNode.getEnd()).line + 1;
    for (const line of changed) {
      if (line >= startLine && line <= endLine) {
        matches.push(entry.name);
        break;
      }
    }
  }

  return matches;
}

function collectTopLevelFunctions(sourceFile: ts.SourceFile): Map<string, FunctionEntry> {
  const functions = new Map<string, FunctionEntry>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      functions.set(statement.name.text, {
        name: statement.name.text,
        fnNode: statement,
        docNode: statement,
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          functions.set(decl.name.text, {
            name: decl.name.text,
            fnNode: decl.initializer,
            docNode: statement,
          });
        }
      }
    }
  }

  return functions;
}

function resolveDefaultExport(
  sourceFile: ts.SourceFile,
  functions: Map<string, FunctionEntry>,
  requestedName: string,
): FunctionEntry | undefined {
  if (requestedName !== "default") return undefined;

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body && hasDefaultModifier(statement)) {
      return { name: statement.name?.text ?? "default", fnNode: statement, docNode: statement };
    }
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      const target = functions.get(statement.expression.text);
      if (target) return target;
    }
  }

  return undefined;
}

function hasDefaultModifier(node: ts.FunctionDeclaration): boolean {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0;
}

function collectTopLevelImports(sourceFile: ts.SourceFile): Map<string, ImportEntry> {
  const imports = new Map<string, ImportEntry>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const modulePath = statement.moduleSpecifier.text;
    const isLocal = modulePath.startsWith(".") || modulePath.startsWith("/");
    const clause = statement.importClause;

    if (clause.name) {
      imports.set(clause.name.text, {
        localName: clause.name.text,
        exportedName: "default",
        modulePath,
        isLocal,
      });
    }

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        imports.set(clause.namedBindings.name.text, {
          localName: clause.namedBindings.name.text,
          exportedName: undefined,
          modulePath,
          isLocal,
        });
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) {
          const exportedName = spec.propertyName ? spec.propertyName.text : spec.name.text;
          imports.set(spec.name.text, {
            localName: spec.name.text,
            exportedName,
            modulePath,
            isLocal,
          });
        }
      }
    }
  }

  return imports;
}

function getBody(fnNode: FunctionLikeNode): ts.Node {
  if (!fnNode.body) {
    throw new Error("unreachable: function entries are only collected when a body is present");
  }
  return fnNode.body;
}

function walkBody(node: ts.Node, referencedNames: Set<string>, calledNames: Set<string>): void {
  if (ts.isIdentifier(node)) {
    referencedNames.add(node.text);
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    calledNames.add(node.expression.text);
  }
  ts.forEachChild(node, (child) => walkBody(child, referencedNames, calledNames));
}

function buildSignature(entry: FunctionEntry, sourceFile: ts.SourceFile): FunctionSignature {
  const { fnNode, docNode, name } = entry;
  const typeParams =
    fnNode.typeParameters && fnNode.typeParameters.length > 0
      ? `<${fnNode.typeParameters.map((tp) => tp.getText(sourceFile)).join(", ")}>`
      : "";
  const params = fnNode.parameters.map((p) => p.getText(sourceFile)).join(", ");
  const returnType = fnNode.type ? `: ${fnNode.type.getText(sourceFile)}` : "";
  const isAsync = ts.getModifiers(fnNode)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  const jsDoc = getLeadingJsDoc(docNode, sourceFile);

  return {
    name,
    signature: `${isAsync ? "async " : ""}function ${name}${typeParams}(${params})${returnType}`,
    ...(jsDoc !== undefined ? { jsDoc } : {}),
  };
}

function getLeadingJsDoc(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const fullText = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!ranges || ranges.length === 0) return undefined;

  const last = ranges[ranges.length - 1];
  if (!last) return undefined;

  const text = fullText.slice(last.pos, last.end);
  return text.startsWith("/**") ? text : undefined;
}

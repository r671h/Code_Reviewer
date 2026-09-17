import { describe, expect, it } from "vitest";
import {
  analyzeSymbol,
  extractSignature,
  findChangedSymbols,
} from "../../../src/mcp-server/github/related-context-ast.js";
import { SymbolNotFoundError } from "../../../src/mcp-server/errors.js";

describe("analyzeSymbol", () => {
  const source = `
import { helper } from "./helper";
import { unused } from "./unused";
import React from "react";

/**
 * Target function under review.
 */
function target(x: number): number {
  return sibling(x) + helper(x) + React.version.length;
}

function sibling(x: number): number {
  return x * 2;
}

function notCalled(): void {}
`;

  it("collects used imports referenced in the symbol's body, excluding unused ones", () => {
    const result = analyzeSymbol(source, "target");

    const names = result.usedImports.map((imp) => imp.name).sort();
    expect(names).toEqual(["React", "helper"]);
  });

  it("marks a local import as isLocal true and an external package as isLocal false", () => {
    const result = analyzeSymbol(source, "target");

    const helperImport = result.usedImports.find((imp) => imp.name === "helper");
    const reactImport = result.usedImports.find((imp) => imp.name === "React");

    expect(helperImport).toMatchObject({ modulePath: "./helper", isLocal: true });
    expect(reactImport).toMatchObject({ modulePath: "react", isLocal: false });
  });

  it("flags calledDirectly true only for imports actually called, not just referenced", () => {
    const result = analyzeSymbol(source, "target");

    const helperImport = result.usedImports.find((imp) => imp.name === "helper");
    const reactImport = result.usedImports.find((imp) => imp.name === "React");

    expect(helperImport?.calledDirectly).toBe(true);
    expect(reactImport?.calledDirectly).toBe(false);
  });

  it("includes signatures only for same-file sibling functions actually called", () => {
    const result = analyzeSymbol(source, "target");

    expect(result.calledSiblings).toEqual([
      { name: "sibling", signature: "function sibling(x: number): number", jsDoc: undefined },
    ]);
  });

  it("throws SymbolNotFoundError when the symbol does not exist in the file", () => {
    expect(() => analyzeSymbol(source, "doesNotExist")).toThrow(SymbolNotFoundError);
  });
});

describe("extractSignature", () => {
  it("extracts name, params, and return type for a function declaration", () => {
    const source = `function add(a: number, b: number): number { return a + b; }`;

    const result = extractSignature(source, "add");

    expect(result?.signature).toBe("function add(a: number, b: number): number");
  });

  it("extracts the JSDoc comment attached to the declaration", () => {
    const source = `
/**
 * Adds two numbers.
 */
function add(a: number, b: number): number { return a + b; }
`;

    const result = extractSignature(source, "add");

    expect(result?.jsDoc).toContain("Adds two numbers.");
  });

  it("extracts a signature and JSDoc for a const arrow function assignment", () => {
    const source = `
/**
 * Formats a date.
 */
const formatDate = (d: Date): string => d.toISOString();
`;

    const result = extractSignature(source, "formatDate");

    expect(result?.signature).toBe("function formatDate(d: Date): string");
    expect(result?.jsDoc).toContain("Formats a date.");
  });

  it("returns undefined when the named symbol is not found", () => {
    const result = extractSignature("const x = 1;", "missing");

    expect(result).toBeUndefined();
  });
});

describe("findChangedSymbols", () => {
  // Line numbers (1-indexed):
  // 1: function first(x: number): number {
  // 2:   return x + 1;
  // 3: }
  // 4:
  // 5: function second(x: number): number {
  // 6:   return x + 2;
  // 7: }
  const source = `function first(x: number): number {
  return x + 1;
}

function second(x: number): number {
  return x + 2;
}
`;

  it("returns the name of the top-level function whose range contains a changed line", () => {
    expect(findChangedSymbols(source, [2])).toEqual(["first"]);
  });

  it("returns multiple names when changed lines land in multiple functions", () => {
    expect(findChangedSymbols(source, [2, 6])).toEqual(["first", "second"]);
  });

  it("returns an empty array when no changed line falls inside a function", () => {
    expect(findChangedSymbols(source, [4])).toEqual([]);
  });
});

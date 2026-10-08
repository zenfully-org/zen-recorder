/**
 * Names the function that holds a position ESLint reported, as the chain of enclosing functions:
 * `createPageSession > handle > arrow#2`. A declaration, a method, or a function assigned to a
 * `const` or an object property carries that name; an anonymous callback is its kind (`arrow`,
 * `function`) and its place among the anonymous functions of the same kind under the same parent.
 * Line numbers are not part of the name, so the baseline keyed by it survives edits above the
 * function. A position outside every function (a file-level metric, reported at line 0) is `file`.
 * The last file's syntax tree is kept, so naming every function of a file parses it once.
 */
import ts from 'typescript';

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

/** One check per kind of FunctionNode. */
const FUNCTION_KINDS: ((node: ts.Node) => boolean)[] = [
  ts.isFunctionDeclaration,
  ts.isFunctionExpression,
  ts.isArrowFunction,
  ts.isMethodDeclaration,
  ts.isConstructorDeclaration,
  ts.isGetAccessorDeclaration,
  ts.isSetAccessorDeclaration,
];

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return FUNCTION_KINDS.some((isKind) => isKind(node));
}

/** The functions directly under `scope`: reached without crossing another function. */
function directFunctions(scope: ts.Node): FunctionNode[] {
  const found: FunctionNode[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionNode(node)) {
      found.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return found;
}

function ownName(node: FunctionNode): string | null {
  if (ts.isArrowFunction(node)) return null;
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  return node.name === undefined ? null : node.name.getText();
}

/** The name a function expression or arrow takes from where it sits: `const handle = ...`, `stop: ...`. */
function assignedName(node: FunctionNode): string | null {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return parent.name.getText();
  }
  return null;
}

/**
 * Where a function starts for a reported position: ESLint reports some rules at a function's head,
 * which for the value of a property starts at the property's key (`stop: () => ...`).
 */
function headStart(node: FunctionNode, tree: ts.SourceFile): number {
  const parent = node.parent;
  const isValue =
    (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.initializer === node;
  return isValue ? parent.getStart(tree) : node.getStart(tree);
}

function kindOf(node: FunctionNode): string {
  return ts.isArrowFunction(node) ? 'arrow' : 'function';
}

function labelOf(node: FunctionNode, siblings: FunctionNode[]): string {
  const named = ownName(node) ?? assignedName(node);
  if (named !== null) return named;
  const kind = kindOf(node);
  const anonymous = siblings.filter(
    (sibling) =>
      ownName(sibling) === null && assignedName(sibling) === null && kindOf(sibling) === kind,
  );
  return `${kind}#${anonymous.indexOf(node) + 1}`;
}

function chainAt(scope: ts.Node, tree: ts.SourceFile, position: number): string[] {
  const functions = directFunctions(scope);
  for (const node of functions) {
    if (headStart(node, tree) <= position && position < node.getEnd()) {
      return [labelOf(node, functions), ...chainAt(node, tree, position)];
    }
  }
  return [];
}

let parsed: { fileName: string; source: string; tree: ts.SourceFile } | null = null;

function treeOf(fileName: string, source: string): ts.SourceFile {
  if (parsed?.fileName === fileName && parsed.source === source) return parsed.tree;
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  parsed = { fileName, source, tree };
  return tree;
}

export function nameFunction(
  fileName: string,
  source: string,
  line: number,
  column: number,
): string {
  if (line < 1) return 'file';
  const tree = treeOf(fileName, source);
  const lineStart = tree.getLineStarts()[line - 1];
  if (lineStart === undefined) return 'file';
  const chain = chainAt(tree, tree, lineStart + column - 1);
  return chain.length === 0 ? 'file' : chain.join(' > ');
}

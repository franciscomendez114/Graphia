/**
 * AST node shapes and builders.
 *
 * Every node is a plain object so it can be cloned, compared and serialised
 * without ceremony. Builders exist so the differentiation rules read like the
 * rules you'd write on paper.
 */

export const NUM = 'num';
export const CONST = 'const';
export const VAR = 'var';
export const UNARY = 'unary';
export const BINARY = 'binary';
export const CALL = 'call';

export const num = (value) => ({ type: NUM, value });
export const constant = (name) => ({ type: CONST, name });
export const variable = (name = 'x') => ({ type: VAR, name });
export const negate = (arg) => ({ type: UNARY, op: '-', arg });
export const binary = (op, left, right) => ({ type: BINARY, op, left, right });
export const call = (name, args) => ({ type: CALL, name, args });

export const add = (l, r) => binary('+', l, r);
export const sub = (l, r) => binary('-', l, r);
export const mul = (l, r) => binary('*', l, r);
export const div = (l, r) => binary('/', l, r);
export const pow = (l, r) => binary('^', l, r);

/** True for a numeric literal, optionally testing its value. */
export const isNum = (node, value) =>
    node.type === NUM && (value === undefined || node.value === value);

/** Does this subtree mention the differentiation variable? */
export function containsVar(node, name = 'x') {
    switch (node.type) {
        case NUM:
        case CONST:
            return false;
        case VAR:
            return node.name === name;
        case UNARY:
            return containsVar(node.arg, name);
        case BINARY:
            return containsVar(node.left, name) || containsVar(node.right, name);
        case CALL:
            return node.args.some((a) => containsVar(a, name));
        default:
            return false;
    }
}

/** Structural equality — used by the simplifier for rules like `a - a = 0`. */
export function equalNodes(a, b) {
    if (a === b) return true;
    if (!a || !b || a.type !== b.type) return false;
    switch (a.type) {
        case NUM:
            return a.value === b.value;
        case CONST:
        case VAR:
            return a.name === b.name;
        case UNARY:
            return a.op === b.op && equalNodes(a.arg, b.arg);
        case BINARY:
            return (
                a.op === b.op &&
                equalNodes(a.left, b.left) &&
                equalNodes(a.right, b.right)
            );
        case CALL:
            return (
                a.name === b.name &&
                a.args.length === b.args.length &&
                a.args.every((arg, i) => equalNodes(arg, b.args[i]))
            );
        default:
            return false;
    }
}

/** Depth-first walk, parents before children. */
export function walk(node, visit) {
    visit(node);
    switch (node.type) {
        case UNARY:
            walk(node.arg, visit);
            break;
        case BINARY:
            walk(node.left, visit);
            walk(node.right, visit);
            break;
        case CALL:
            node.args.forEach((a) => walk(a, visit));
            break;
        default:
            break;
    }
}

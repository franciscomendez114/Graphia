/**
 * Symbolic differentiation.
 *
 * Straight transcription of the rules from a first calculus course. Each
 * built-in function contributes only its outer derivative (see functions.js);
 * the chain rule is applied here, once, for every one of them.
 *
 * Functions with no symbolic rule (min, max, mod, …) raise NotDifferentiable so
 * callers can fall back to a numeric derivative instead of showing nothing.
 */

import {
    NUM,
    CONST,
    VAR,
    UNARY,
    BINARY,
    CALL,
    num,
    negate,
    add,
    sub,
    mul,
    div,
    pow,
    call,
    containsVar,
} from './ast.js';
import { FUNCTIONS } from './functions.js';
import { simplify } from './simplify.js';

export class NotDifferentiable extends Error {
    constructor(name) {
        super(`I can't differentiate ${name}() symbolically`);
        this.name = 'NotDifferentiable';
        this.functionName = name;
    }
}

/** Raw derivative, before simplification. */
export function derive(node, v = 'x') {
    switch (node.type) {
        case NUM:
        case CONST:
            return num(0);

        case VAR:
            return num(node.name === v ? 1 : 0);

        case UNARY:
            return negate(derive(node.arg, v));

        case BINARY:
            return deriveBinary(node, v);

        case CALL:
            return deriveCall(node, v);

        default:
            throw new Error(`Cannot differentiate node type "${node.type}"`);
    }
}

function deriveBinary(node, v) {
    const { op, left: f, right: g } = node;
    const df = () => derive(f, v);
    const dg = () => derive(g, v);

    switch (op) {
        case '+':
            return add(df(), dg());

        case '-':
            return sub(df(), dg());

        // Product rule.
        case '*':
            return add(mul(df(), g), mul(f, dg()));

        case '/':
            // A constant denominator only scales the derivative. Worth special
            // casing: the quotient rule would turn `x/3` into `3/9`.
            if (!containsVar(g, v)) return div(df(), g);
            // Quotient rule.
            return div(sub(mul(df(), g), mul(f, dg())), pow(g, num(2)));

        case '^':
            return derivePower(f, g, v);

        default:
            throw new Error(`Cannot differentiate operator "${op}"`);
    }
}

/**
 * Three cases, cheapest first:
 *   constant exponent — power rule:  n·f^(n-1)·f'
 *   constant base     — exponential: b^g·ln(b)·g'
 *   both variable     — general:     f^g·(g'·ln f + g·f'/f)
 */
function derivePower(f, g, v) {
    const baseVaries = containsVar(f, v);
    const exponentVaries = containsVar(g, v);

    if (!baseVaries && !exponentVaries) return num(0);

    if (!exponentVaries) {
        return mul(mul(g, pow(f, sub(g, num(1)))), derive(f, v));
    }

    if (!baseVaries) {
        return mul(mul(pow(f, g), call('ln', [f])), derive(g, v));
    }

    return mul(
        pow(f, g),
        add(mul(derive(g, v), call('ln', [f])), div(mul(g, derive(f, v)), f)),
    );
}

function deriveCall(node, v) {
    const entry = FUNCTIONS[node.name];
    if (!entry || !entry.deriv) throw new NotDifferentiable(node.name);

    const [argument] = node.args;
    const outer = entry.deriv(argument);
    const inner = derive(argument, v);

    // Chain rule, applied uniformly to every built-in.
    return mul(outer, inner);
}

/** Derivative with the simplifier run over it — what the UI displays. */
export function derivative(node, v = 'x') {
    // Two passes: the first collapses the noise the rules generate, the second
    // catches identities that only become visible afterwards.
    return simplify(simplify(derive(node, v)));
}

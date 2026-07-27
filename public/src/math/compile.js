/**
 * AST → JavaScript closure.
 *
 * The sampler calls the compiled function once per pixel column (and more where
 * a curve bends), so this is the hottest code in the app. Two things keep it
 * fast: the tree is walked once at compile time rather than once per evaluation,
 * and any subtree without `x` in it is folded to a literal up front.
 */

import { NUM, CONST, VAR, UNARY, BINARY, CALL, containsVar } from './ast.js';
import { FUNCTIONS, CONSTANTS } from './functions.js';

/**
 * @param {object} node   AST produced by parse()
 * @returns {(x: number) => number}
 */
export function compile(node) {
    // Constant folding: evaluate `2*pi` or `sqrt(5)` exactly once.
    if (!containsVar(node)) {
        const value = build(node)(0);
        return () => value;
    }
    return build(node);
}

function build(node) {
    switch (node.type) {
        case NUM: {
            const { value } = node;
            return () => value;
        }

        case CONST: {
            const value = CONSTANTS[node.name];
            return () => value;
        }

        case VAR:
            return (x) => x;

        case UNARY: {
            const arg = build(node.arg);
            return (x) => -arg(x);
        }

        case BINARY:
            return buildBinary(node);

        case CALL: {
            const { fn } = FUNCTIONS[node.name];
            const args = node.args.map(build);
            // Specialise the common arities; `fn.apply` only for the rest.
            if (args.length === 1) {
                const [a] = args;
                return (x) => fn(a(x));
            }
            if (args.length === 2) {
                const [a, b] = args;
                return (x) => fn(a(x), b(x));
            }
            return (x) => fn(...args.map((f) => f(x)));
        }

        default:
            throw new Error(`Cannot compile node of type "${node.type}"`);
    }
}

function buildBinary(node) {
    const left = foldOrBuild(node.left);
    const right = foldOrBuild(node.right);

    switch (node.op) {
        case '+':
            return (x) => left(x) + right(x);
        case '-':
            return (x) => left(x) - right(x);
        case '*':
            return (x) => left(x) * right(x);
        case '/':
            return (x) => left(x) / right(x);
        case '^':
            return buildPower(node, left, right);
        default:
            throw new Error(`Unknown operator "${node.op}"`);
    }
}

/**
 * `x^3` is far quicker as `x*x*x` than as `Math.pow`, and small integer powers
 * are overwhelmingly the common case in a graphing calculator.
 *
 * Negative bases also need care: `(-8)^(1/3)` is NaN under Math.pow but the
 * real cube root is -2, so odd integer-reciprocal exponents route through cbrt-
 * style handling to keep curves like `x^(1/3)` continuous through the origin.
 */
function buildPower(node, left, right) {
    // A constant exponent covers `x^2`, `x^(1/3)` and `x^pi` alike.
    if (!containsVar(node.right)) {
        const exponent = right(0);

        if (Number.isInteger(exponent) && exponent >= 0 && exponent <= 8) {
            switch (exponent) {
                case 0:
                    return () => 1;
                case 1:
                    return left;
                case 2:
                    return (x) => {
                        const a = left(x);
                        return a * a;
                    };
                case 3:
                    return (x) => {
                        const a = left(x);
                        return a * a * a;
                    };
                default:
                    return (x) => Math.pow(left(x), exponent);
            }
        }

        // 1/n with odd n — the real root of a negative number exists, so keep
        // curves like x^(1/3) continuous through the origin instead of letting
        // Math.pow return NaN for x < 0.
        const reciprocal = 1 / exponent;
        const rounded = Math.round(reciprocal);
        if (Math.abs(reciprocal - rounded) < 1e-9 && Math.abs(rounded % 2) === 1) {
            return (x) => {
                const a = left(x);
                return a < 0
                    ? -Math.pow(-a, exponent)
                    : Math.pow(a, exponent);
            };
        }

        return (x) => Math.pow(left(x), exponent);
    }

    return (x) => Math.pow(left(x), right(x));
}

/** Collapse a variable-free subtree to a literal closure. */
function foldOrBuild(node) {
    if (node.type !== NUM && !containsVar(node)) {
        const value = build(node)(0);
        return () => value;
    }
    return build(node);
}

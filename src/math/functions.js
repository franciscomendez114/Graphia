/**
 * The function and constant registry.
 *
 * One entry per built-in function holds everything the rest of the engine needs
 * to know about it:
 *
 *   arity  — how many arguments it accepts
 *   fn     — the numeric implementation, used by the compiler
 *   deriv  — f'(u) as an AST, given the argument AST `u`. The chain rule is
 *            applied generically in derive.js, so entries only state the outer
 *            derivative. `null` means "no symbolic rule" and the caller falls
 *            back to numeric differentiation.
 *   help   — one-line description shown in the syntax reference
 */

import { num, negate, add, sub, mul, div, pow, call } from './ast.js';

const LN10 = Math.LN10;
const LN2 = Math.LN2;

/** sec, csc and cot are not on Math, so define them once here. */
const sec = (x) => 1 / Math.cos(x);
const csc = (x) => 1 / Math.sin(x);
const cot = (x) => 1 / Math.tan(x);
const acot = (x) => Math.PI / 2 - Math.atan(x);
const sech = (x) => 1 / Math.cosh(x);
const csch = (x) => 1 / Math.sinh(x);
const coth = (x) => 1 / Math.tanh(x);

/** Mathematical modulo — result carries the sign of the divisor. */
const mod = (a, b) => ((a % b) + b) % b;

const u = (name, argument) => call(name, [argument]);

export const FUNCTIONS = {
    sin: {
        arity: 1,
        fn: Math.sin,
        deriv: (a) => u('cos', a),
        help: 'sine (radians)',
    },
    cos: {
        arity: 1,
        fn: Math.cos,
        deriv: (a) => negate(u('sin', a)),
        help: 'cosine (radians)',
    },
    tan: {
        arity: 1,
        fn: Math.tan,
        deriv: (a) => pow(u('sec', a), num(2)),
        help: 'tangent (radians)',
    },
    sec: {
        arity: 1,
        fn: sec,
        deriv: (a) => mul(u('sec', a), u('tan', a)),
        help: 'secant = 1/cos',
    },
    csc: {
        arity: 1,
        fn: csc,
        deriv: (a) => negate(mul(u('csc', a), u('cot', a))),
        help: 'cosecant = 1/sin',
    },
    cot: {
        arity: 1,
        fn: cot,
        deriv: (a) => negate(pow(u('csc', a), num(2))),
        help: 'cotangent = 1/tan',
    },

    asin: {
        arity: 1,
        fn: Math.asin,
        deriv: (a) => div(num(1), u('sqrt', sub(num(1), pow(a, num(2))))),
        help: 'inverse sine',
    },
    acos: {
        arity: 1,
        fn: Math.acos,
        deriv: (a) => negate(div(num(1), u('sqrt', sub(num(1), pow(a, num(2)))))),
        help: 'inverse cosine',
    },
    atan: {
        arity: 1,
        fn: Math.atan,
        deriv: (a) => div(num(1), add(num(1), pow(a, num(2)))),
        help: 'inverse tangent',
    },
    acot: {
        arity: 1,
        fn: acot,
        deriv: (a) => negate(div(num(1), add(num(1), pow(a, num(2))))),
        help: 'inverse cotangent',
    },

    sinh: { arity: 1, fn: Math.sinh, deriv: (a) => u('cosh', a), help: 'hyperbolic sine' },
    cosh: { arity: 1, fn: Math.cosh, deriv: (a) => u('sinh', a), help: 'hyperbolic cosine' },
    tanh: {
        arity: 1,
        fn: Math.tanh,
        deriv: (a) => pow(u('sech', a), num(2)),
        help: 'hyperbolic tangent',
    },
    sech: {
        arity: 1,
        fn: sech,
        deriv: (a) => negate(mul(u('sech', a), u('tanh', a))),
        help: 'hyperbolic secant',
    },
    csch: {
        arity: 1,
        fn: csch,
        deriv: (a) => negate(mul(u('csch', a), u('coth', a))),
        help: 'hyperbolic cosecant',
    },
    coth: {
        arity: 1,
        fn: coth,
        deriv: (a) => negate(pow(u('csch', a), num(2))),
        help: 'hyperbolic cotangent',
    },
    asinh: {
        arity: 1,
        fn: Math.asinh,
        deriv: (a) => div(num(1), u('sqrt', add(pow(a, num(2)), num(1)))),
        help: 'inverse hyperbolic sine',
    },
    acosh: {
        arity: 1,
        fn: Math.acosh,
        deriv: (a) => div(num(1), u('sqrt', sub(pow(a, num(2)), num(1)))),
        help: 'inverse hyperbolic cosine',
    },
    atanh: {
        arity: 1,
        fn: Math.atanh,
        deriv: (a) => div(num(1), sub(num(1), pow(a, num(2)))),
        help: 'inverse hyperbolic tangent',
    },

    exp: { arity: 1, fn: Math.exp, deriv: (a) => u('exp', a), help: 'e raised to a power' },
    ln: { arity: 1, fn: Math.log, deriv: (a) => div(num(1), a), help: 'natural logarithm' },
    log: {
        arity: 1,
        fn: Math.log10,
        deriv: (a) => div(num(1), mul(a, num(LN10))),
        help: 'base-10 logarithm',
    },
    log10: {
        arity: 1,
        fn: Math.log10,
        deriv: (a) => div(num(1), mul(a, num(LN10))),
        help: 'base-10 logarithm',
    },
    log2: {
        arity: 1,
        fn: Math.log2,
        deriv: (a) => div(num(1), mul(a, num(LN2))),
        help: 'base-2 logarithm',
    },
    sqrt: {
        arity: 1,
        fn: Math.sqrt,
        deriv: (a) => div(num(1), mul(num(2), u('sqrt', a))),
        help: 'square root',
    },
    cbrt: {
        arity: 1,
        fn: Math.cbrt,
        deriv: (a) => div(num(1), mul(num(3), pow(u('cbrt', a), num(2)))),
        help: 'cube root (defined for negatives)',
    },
    abs: {
        arity: 1,
        fn: Math.abs,
        deriv: (a) => u('sign', a),
        help: 'absolute value — |x| also works',
    },

    // Piecewise-constant: the derivative is 0 wherever it exists.
    sign: { arity: 1, fn: Math.sign, deriv: () => num(0), help: '-1, 0 or 1' },
    floor: { arity: 1, fn: Math.floor, deriv: () => num(0), help: 'round down' },
    ceil: { arity: 1, fn: Math.ceil, deriv: () => num(0), help: 'round up' },
    round: { arity: 1, fn: Math.round, deriv: () => num(0), help: 'round to nearest' },

    // No symbolic rule — callers fall back to numeric differentiation.
    min: { arity: -1, fn: Math.min, deriv: null, help: 'smallest of its arguments' },
    max: { arity: -1, fn: Math.max, deriv: null, help: 'largest of its arguments' },
    mod: { arity: 2, fn: mod, deriv: null, help: 'mod(a, b) remainder' },
    logbase: {
        arity: 2,
        fn: (b, x) => Math.log(x) / Math.log(b),
        deriv: null,
        help: 'logbase(b, x) logarithm with base b',
    },
    atan2: { arity: 2, fn: Math.atan2, deriv: null, help: 'atan2(y, x) angle of a vector' },
};

export const CONSTANTS = {
    pi: Math.PI,
    tau: Math.PI * 2,
    e: Math.E,
    phi: (1 + Math.sqrt(5)) / 2,
};

/**
 * Names the lexer must recognise, longest first so `sinh` wins over `sin` and
 * `exp` wins over `e`.
 */
export const KNOWN_NAMES = [
    ...Object.keys(FUNCTIONS),
    ...Object.keys(CONSTANTS),
    'x',
].sort((a, b) => b.length - a.length);

export function isFunctionName(name) {
    return Object.prototype.hasOwnProperty.call(FUNCTIONS, name);
}

export function isConstantName(name) {
    return Object.prototype.hasOwnProperty.call(CONSTANTS, name);
}

/** Does the registry accept `count` arguments for `name`? */
export function acceptsArity(name, count) {
    const arity = FUNCTIONS[name].arity;
    return arity === -1 ? count >= 1 : arity === count;
}

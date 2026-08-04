/**
 * AST → readable text.
 *
 * Parentheses are inserted from operator precedence rather than being kept from
 * the input, so `d/dx` output reads like handwriting: `2x`, `-sin(x)`, `1/x^2`.
 */

import { NUM, CONST, VAR, UNARY, BINARY, CALL } from './ast.js';

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
const UNARY_PRECEDENCE = 3;
const ATOM_PRECEDENCE = 5;

const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/**
 * Round for human eyes: integers stay exact, everything else keeps 6
 * significant digits with trailing zeros trimmed.
 */
export function formatNumber(value, significantDigits = 6) {
    if (!Number.isFinite(value)) {
        if (Number.isNaN(value)) return 'undefined';
        return value > 0 ? '∞' : '-∞';
    }
    if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);

    const magnitude = Math.abs(value);
    if (magnitude >= 1e9 || magnitude < 1e-6) {
        return trimExponential(value.toExponential(Math.max(0, significantDigits - 3)));
    }
    const rounded = Number(value.toPrecision(significantDigits));
    return String(rounded);
}

function trimExponential(text) {
    return text.replace(/\.?0+e/, 'e').replace('e+', 'e');
}

function precedenceOf(node) {
    if (node.type === BINARY) return PRECEDENCE[node.op] ?? ATOM_PRECEDENCE;
    if (node.type === UNARY) return UNARY_PRECEDENCE;
    // A negative literal behaves like a unary minus when nested.
    if (node.type === NUM && node.value < 0) return UNARY_PRECEDENCE;
    return ATOM_PRECEDENCE;
}

/**
 * @param {object} node
 * @param {{implicit?: boolean, superscripts?: boolean, digits?: number}} options
 *   implicit     — write `2x` instead of `2*x` (default true)
 *   superscripts — write `x²` instead of `x^2` for small integer powers
 */
export function format(node, options = {}) {
    const settings = {
        implicit: true,
        superscripts: false,
        digits: 6,
        ...options,
    };
    return write(node, settings);
}

function write(node, options) {
    switch (node.type) {
        case NUM:
            return formatNumber(node.value, options.digits);

        case CONST:
            return node.name === 'pi' ? 'π' : node.name;

        case VAR:
            return node.name;

        case UNARY: {
            const inner = wrap(node.arg, UNARY_PRECEDENCE, options);
            return `-${inner}`;
        }

        case BINARY:
            return writeBinary(node, options);

        case CALL:
            return `${node.name}(${node.args.map((a) => write(a, options)).join(', ')})`;

        default:
            return '?';
    }
}

function writeBinary(node, options) {
    const { op } = node;
    const precedence = PRECEDENCE[op];

    if (op === '^') {
        const base = wrap(node.left, ATOM_PRECEDENCE, options);
        if (options.superscripts) {
            const superscript = toSuperscript(node.right);
            if (superscript) return `${base}${superscript}`;
        }
        // Right associative, so the exponent only needs parentheses when it
        // binds more loosely than `^` itself.
        const exponent = wrap(node.right, precedence, options);
        return `${base}^${exponent}`;
    }

    const left = wrap(node.left, precedence, options);
    // `-` and `/` are left associative: a - (b - c) must keep its parentheses.
    const right = wrap(node.right, op === '-' || op === '/' ? precedence + 1 : precedence, options);

    if (op === '*' && options.implicit && canJuxtapose(node.left, node.right)) {
        return `${left}${right}`;
    }
    if (op === '+' || op === '-') return `${left} ${op} ${right}`;
    return `${left}${op}${right}`;
}

/**
 * Is dropping the `*` unambiguous? Safe when a coefficient meets a symbol
 * (`2x`), or when the right operand is a function call or a bracketed group
 * (`2sin(x)`, `(x+1)(x-1)`). Never between two numbers.
 */
function canJuxtapose(left, right) {
    if (right.type === NUM) return false;
    if (right.type === CALL) return true;
    if (left.type === NUM) {
        return right.type === VAR || right.type === CONST || right.type === BINARY;
    }
    return precedenceOf(right) < PRECEDENCE['*'];
}

function wrap(node, minimumPrecedence, options) {
    const text = write(node, options);
    return precedenceOf(node) < minimumPrecedence ? `(${text})` : text;
}

function toSuperscript(node) {
    if (node.type !== NUM) return null;
    const { value } = node;
    if (!Number.isInteger(value) || value < 0 || value > 99) return null;
    return String(value)
        .split('')
        .map((digit) => SUPERSCRIPTS[Number(digit)])
        .join('');
}

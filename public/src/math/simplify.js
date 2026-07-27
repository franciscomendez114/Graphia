/**
 * Algebraic tidy-up.
 *
 * Differentiation rules are mechanical, so their raw output is full of noise:
 * `d/dx[x²]` literally produces `2 * x^1 * 1`. This pass folds constants and
 * applies identity rules so what the user reads back is `2x`.
 *
 * Each rule either shrinks the tree, moves a negation strictly outwards, or is a
 * one-way normalisation (numbers to the front of a product, division pulled to
 * the top), so the rewriting always terminates.
 */

import {
    NUM,
    UNARY,
    BINARY,
    CALL,
    num,
    negate,
    binary,
    call,
    isNum,
    equalNodes,
} from './ast.js';

export function simplify(node) {
    switch (node.type) {
        case UNARY:
            return simplifyNegate(simplify(node.arg));

        case BINARY: {
            const left = simplify(node.left);
            const right = simplify(node.right);
            switch (node.op) {
                case '+':
                    return simplifyAdd(left, right);
                case '-':
                    return simplifySub(left, right);
                case '*':
                    return simplifyMul(left, right);
                case '/':
                    return simplifyDiv(left, right);
                case '^':
                    return simplifyPow(left, right);
                default:
                    return binary(node.op, left, right);
            }
        }

        case CALL: {
            const args = node.args.map(simplify);
            return call(node.name, args);
        }

        default:
            return node;
    }
}

export function simplifyNegate(arg) {
    if (arg.type === NUM) return num(-arg.value);
    if (arg.type === UNARY && arg.op === '-') return arg.arg;
    // Fold the sign into a leading coefficient: -(2x) becomes -2x.
    if (arg.type === BINARY && arg.op === '*' && isNum(arg.left)) {
        return binary('*', num(-arg.left.value), arg.right);
    }
    return negate(arg);
}

function simplifyAdd(left, right) {
    if (isNum(left, 0)) return right;
    if (isNum(right, 0)) return left;
    if (left.type === NUM && right.type === NUM) return num(left.value + right.value);

    // a + (-b) reads better as a - b.
    if (right.type === UNARY && right.op === '-') return simplifySub(left, right.arg);
    if (left.type === UNARY && left.op === '-') return simplifySub(right, left.arg);

    if (equalNodes(left, right)) return simplifyMul(num(2), left);

    // Conventional ordering puts the bare constant last: 2x + 3, not 3 + 2x.
    if (left.type === NUM && right.type !== NUM) return binary('+', right, left);

    return binary('+', left, right);
}

function simplifySub(left, right) {
    if (isNum(right, 0)) return left;
    if (isNum(left, 0)) return simplifyNegate(right);
    if (left.type === NUM && right.type === NUM) return num(left.value - right.value);
    if (right.type === UNARY && right.op === '-') return simplifyAdd(left, right.arg);
    if (equalNodes(left, right)) return num(0);
    return binary('-', left, right);
}

function simplifyMul(left, right) {
    if (isNum(left, 0) || isNum(right, 0)) return num(0);
    if (isNum(left, 1)) return right;
    if (isNum(right, 1)) return left;
    if (left.type === NUM && right.type === NUM) return num(left.value * right.value);
    if (isNum(left, -1)) return simplifyNegate(right);
    if (isNum(right, -1)) return simplifyNegate(left);

    // Pull negations out of the product.
    if (left.type === UNARY && left.op === '-') {
        return simplifyNegate(simplifyMul(left.arg, right));
    }
    if (right.type === UNARY && right.op === '-') {
        return simplifyNegate(simplifyMul(left, right.arg));
    }

    // Coefficient first: x*2 becomes 2x.
    if (right.type === NUM && left.type !== NUM) return simplifyMul(right, left);

    // Merge adjacent coefficients: 2*(3*x) becomes 6x.
    if (left.type === NUM && right.type === BINARY && right.op === '*' && isNum(right.left)) {
        return simplifyMul(num(left.value * right.left.value), right.right);
    }

    // Fold multiplication into a quotient: (1/x)*2 becomes 2/x.
    if (left.type === BINARY && left.op === '/') {
        return simplifyDiv(simplifyMul(left.left, right), left.right);
    }
    if (right.type === BINARY && right.op === '/') {
        return simplifyDiv(simplifyMul(left, right.left), right.right);
    }

    if (equalNodes(left, right)) return simplifyPow(left, num(2));

    return binary('*', left, right);
}

function simplifyDiv(left, right) {
    if (isNum(right, 1)) return left;
    if (isNum(right, -1)) return simplifyNegate(left);
    if (isNum(left, 0)) return num(0);

    // Only fold exact divisions — keeping 1/3 as a fraction is both more
    // readable and lossless. Fractions that don't divide evenly are reduced
    // instead, so the quotient rule's 3/9 comes out as 1/3.
    if (left.type === NUM && right.type === NUM && right.value !== 0) {
        const quotient = left.value / right.value;
        if (Number.isInteger(quotient)) return num(quotient);
        if (Number.isInteger(left.value) && Number.isInteger(right.value)) {
            const divisor = greatestCommonDivisor(
                Math.abs(left.value),
                Math.abs(right.value),
            );
            if (divisor > 1) {
                return binary('/', num(left.value / divisor), num(right.value / divisor));
            }
        }
    }

    if (equalNodes(left, right)) return num(1);

    if (left.type === UNARY && left.op === '-') {
        return simplifyNegate(simplifyDiv(left.arg, right));
    }
    if (right.type === UNARY && right.op === '-') {
        return simplifyNegate(simplifyDiv(left, right.arg));
    }

    // (a/b)/c becomes a/(b*c).
    if (left.type === BINARY && left.op === '/') {
        return simplifyDiv(left.left, simplifyMul(left.right, right));
    }

    return binary('/', left, right);
}

function greatestCommonDivisor(a, b) {
    let x = a;
    let y = b;
    while (y > 0) {
        const remainder = x % y;
        x = y;
        y = remainder;
    }
    return x;
}

function simplifyPow(left, right) {
    if (isNum(right, 0)) return num(1);
    if (isNum(right, 1)) return left;
    if (isNum(left, 1)) return num(1);
    if (isNum(left, 0)) return num(0);

    if (left.type === NUM && right.type === NUM && Number.isInteger(right.value)) {
        const value = Math.pow(left.value, right.value);
        // Leave huge or lossy results symbolic rather than printing 1e21.
        if (Number.isFinite(value) && Math.abs(value) < 1e12) return num(value);
    }

    // (a^b)^c with numeric exponents becomes a^(b*c).
    if (
        left.type === BINARY &&
        left.op === '^' &&
        left.right.type === NUM &&
        right.type === NUM
    ) {
        return simplifyPow(left.left, num(left.right.value * right.value));
    }

    return binary('^', left, right);
}

/**
 * The public face of the math engine.
 *
 * Everything above this file works with bare ASTs; everything below it (the
 * plotter, the calculus tools, the UI) only ever touches an Expression.
 */

import { parse, ParseError } from './parser.js';
import { compile } from './compile.js';
import { derivative as symbolicDerivative, NotDifferentiable } from './derive.js';
import { format } from './format.js';
import { numericDerivative } from './numeric.js';
import { containsVar } from './ast.js';

export class Expression {
    /**
     * @param {object} ast
     * @param {string} [source] the text the user typed, kept for display
     */
    constructor(ast, source) {
        this.ast = ast;
        this.source = source ?? format(ast);
        /** @type {(x: number) => number} */
        this.evaluate = compile(ast);
        this._derivative = undefined;
    }

    /**
     * Parse without throwing.
     * @returns {{ok: true, expression: Expression} | {ok: false, error: {message: string, position: number}}}
     */
    static tryParse(source) {
        try {
            return { ok: true, expression: new Expression(parse(source), source) };
        } catch (error) {
            if (error instanceof ParseError) {
                return { ok: false, error: { message: error.message, position: error.position } };
            }
            return { ok: false, error: { message: error.message, position: 0 } };
        }
    }

    /** Parse or throw — convenient in tests and for internally built strings. */
    static parse(source) {
        return new Expression(parse(source), source);
    }

    /** Does this expression actually depend on x? */
    get isConstant() {
        return !containsVar(this.ast);
    }

    /**
     * Symbolic derivative, or null when no closed-form rule applies (min, max,
     * mod, …). Computed once and cached.
     * @returns {Expression | null}
     */
    derivative() {
        if (this._derivative === undefined) {
            try {
                const ast = symbolicDerivative(this.ast);
                this._derivative = new Expression(ast);
            } catch (error) {
                if (!(error instanceof NotDifferentiable)) throw error;
                this._derivative = null;
            }
        }
        return this._derivative;
    }

    /**
     * f'(x) at a point, always available: exact rules when they exist, central
     * differences when they don't.
     */
    slopeAt(x) {
        const d = this.derivative();
        if (d) {
            const value = d.evaluate(x);
            if (Number.isFinite(value)) return value;
        }
        return numericDerivative(this.evaluate, x);
    }

    /** Readable text, e.g. `2x` or `-sin(x)`. */
    toString(options) {
        return format(this.ast, options);
    }
}

export { ParseError, NotDifferentiable };

/**
 * Tokeniser and recursive-descent parser for single-variable expressions.
 *
 * Grammar (loosest binding first):
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/') unary | implicit unary)*
 *   unary      := ('-' | '+') unary | power
 *   power      := primary ('^' unary)?          right associative
 *   primary    := number | constant | variable
 *               | name '(' expression (',' expression)* ')'
 *               | '(' expression ')' | '|' expression '|'
 *
 * Implicit multiplication (`2x`, `3sin(x)`, `(x+1)(x-1)`) sits at term level, so
 * it binds exactly as tightly as an explicit `*`. That makes `1/2x` mean
 * `(1/2)·x`, which is the convention the README documents.
 */

import {
    num,
    constant,
    variable,
    negate,
    binary,
    call,
} from './ast.js';
import {
    KNOWN_NAMES,
    isFunctionName,
    isConstantName,
    acceptsArity,
    FUNCTIONS,
} from './functions.js';

export class ParseError extends Error {
    constructor(message, position = 0) {
        super(message);
        this.name = 'ParseError';
        this.position = position;
    }
}

/** Characters people paste from textbooks and calculators, mapped to ASCII. */
const SUBSTITUTIONS = new Map([
    ['−', '-'], // minus sign
    ['–', '-'], // en dash
    ['—', '-'], // em dash
    ['×', '*'], // multiplication sign
    ['·', '*'], // middle dot
    ['•', '*'], // bullet
    ['÷', '/'], // division sign
    ['⁄', '/'], // fraction slash
    ['π', 'pi'],
    ['∏', 'pi'],
    ['√', 'sqrt'],
    ['²', '^2'],
    ['³', '^3'],
    ['⁰', '^0'],
    ['¹', '^1'],
    ['⁴', '^4'],
    ['⁵', '^5'],
    ['⁶', '^6'],
    ['⁷', '^7'],
    ['⁸', '^8'],
    ['⁹', '^9'],
    ['∞', 'Infinity'],
    ['‘', "'"],
    ['’', "'"],
    ['[', '('],
    [']', ')'],
    ['{', '('],
    ['}', ')'],
]);

/** Fold pasted unicode into the ASCII the lexer understands. */
export function normalizeSource(source) {
    let out = '';
    for (const ch of String(source)) {
        out += SUBSTITUTIONS.has(ch) ? SUBSTITUTIONS.get(ch) : ch;
    }
    return out;
}

const isDigit = (ch) => ch >= '0' && ch <= '9';
const isLetter = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

export const TOKEN = {
    NUMBER: 'number',
    NAME: 'name',
    OPERATOR: 'operator',
    OPEN: 'open',
    CLOSE: 'close',
    COMMA: 'comma',
    BAR: 'bar',
    END: 'end',
};

/**
 * Turn source text into a flat token list.
 *
 * Identifiers are matched greedily against the registry, longest name first, so
 * `sinh` beats `sin` and a stray run of letters like `xy` degrades into single
 * characters (`x`, then `y`) rather than one unknown blob — which produces a far
 * better error message.
 */
export function tokenize(source) {
    const text = normalizeSource(source);
    const tokens = [];
    let i = 0;

    while (i < text.length) {
        const ch = text[i];

        if (isSpace(ch)) {
            i += 1;
            continue;
        }

        if (isDigit(ch) || (ch === '.' && isDigit(text[i + 1]))) {
            const start = i;
            while (i < text.length && isDigit(text[i])) i += 1;
            if (text[i] === '.') {
                i += 1;
                while (i < text.length && isDigit(text[i])) i += 1;
            }
            // Exponent, but only when it is actually followed by digits so that
            // `2e` stays `2 * e` (Euler's number) instead of a broken literal.
            if (text[i] === 'e' || text[i] === 'E') {
                let probe = i + 1;
                if (text[probe] === '+' || text[probe] === '-') probe += 1;
                if (isDigit(text[probe])) {
                    probe += 1;
                    while (probe < text.length && isDigit(text[probe])) probe += 1;
                    i = probe;
                }
            }
            const raw = text.slice(start, i);
            const value = Number(raw);
            if (!Number.isFinite(value)) {
                throw new ParseError(`"${raw}" is not a number I can read`, start);
            }
            tokens.push({ type: TOKEN.NUMBER, value, position: start });
            continue;
        }

        if (isLetter(ch)) {
            const start = i;
            const lower = text.slice(i).toLowerCase();
            const matched = KNOWN_NAMES.find((name) => lower.startsWith(name));
            const name = matched ?? text[i].toLowerCase();
            i += name.length;
            tokens.push({ type: TOKEN.NAME, name, position: start });
            continue;
        }

        if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
            tokens.push({ type: TOKEN.OPERATOR, op: ch, position: i });
            i += 1;
            continue;
        }

        if (ch === '(') {
            tokens.push({ type: TOKEN.OPEN, position: i });
            i += 1;
            continue;
        }
        if (ch === ')') {
            tokens.push({ type: TOKEN.CLOSE, position: i });
            i += 1;
            continue;
        }
        if (ch === ',') {
            tokens.push({ type: TOKEN.COMMA, position: i });
            i += 1;
            continue;
        }
        if (ch === '|') {
            tokens.push({ type: TOKEN.BAR, position: i });
            i += 1;
            continue;
        }

        throw new ParseError(`I don't know what to do with "${ch}"`, i);
    }

    tokens.push({ type: TOKEN.END, position: text.length });
    return tokens;
}

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.index = 0;
        this.barDepth = 0;
    }

    get current() {
        return this.tokens[this.index];
    }

    advance() {
        return this.tokens[this.index++];
    }

    isOperator(op) {
        const token = this.current;
        return token.type === TOKEN.OPERATOR && token.op === op;
    }

    /** A primary can start here, so implicit multiplication is allowed. */
    startsPrimary() {
        const token = this.current;
        if (token.type === TOKEN.NUMBER || token.type === TOKEN.NAME) return true;
        if (token.type === TOKEN.OPEN) return true;
        // Inside `|...|` a bar closes the group rather than opening a new one.
        if (token.type === TOKEN.BAR) return this.barDepth === 0;
        return false;
    }

    parseExpression() {
        let node = this.parseTerm();
        while (this.isOperator('+') || this.isOperator('-')) {
            const { op } = this.advance();
            node = binary(op, node, this.parseTerm());
        }
        return node;
    }

    parseTerm() {
        let node = this.parseUnary();
        for (;;) {
            if (this.isOperator('*') || this.isOperator('/')) {
                const { op } = this.advance();
                node = binary(op, node, this.parseUnary());
            } else if (this.startsPrimary()) {
                node = binary('*', node, this.parseUnary());
            } else {
                return node;
            }
        }
    }

    parseUnary() {
        if (this.isOperator('-')) {
            this.advance();
            return negate(this.parseUnary());
        }
        if (this.isOperator('+')) {
            this.advance();
            return this.parseUnary();
        }
        return this.parsePower();
    }

    parsePower() {
        const base = this.parsePrimary();
        if (this.isOperator('^')) {
            this.advance();
            // parseUnary on the right gives right associativity and lets the
            // exponent be signed: `2^-1`, `x^-2`, `2^3^2`.
            return binary('^', base, this.parseUnary());
        }
        return base;
    }

    parsePrimary() {
        const token = this.current;

        if (token.type === TOKEN.NUMBER) {
            this.advance();
            return num(token.value);
        }

        if (token.type === TOKEN.NAME) {
            this.advance();
            return this.parseNamed(token);
        }

        if (token.type === TOKEN.OPEN) {
            this.advance();
            const inner = this.parseExpression();
            this.expectClose(token.position);
            return inner;
        }

        if (token.type === TOKEN.BAR) {
            this.advance();
            this.barDepth += 1;
            const inner = this.parseExpression();
            this.barDepth -= 1;
            if (this.current.type !== TOKEN.BAR) {
                throw new ParseError('This |…| is missing its closing bar', token.position);
            }
            this.advance();
            return call('abs', [inner]);
        }

        if (token.type === TOKEN.OPERATOR) {
            throw new ParseError(
                `"${token.op}" needs something after it`,
                token.position,
            );
        }
        if (token.type === TOKEN.CLOSE) {
            throw new ParseError('This ")" has no matching "("', token.position);
        }
        if (token.type === TOKEN.COMMA) {
            throw new ParseError('Unexpected comma', token.position);
        }
        throw new ParseError('The expression ends too early', token.position);
    }

    parseNamed(token) {
        const { name, position } = token;

        if (isFunctionName(name)) {
            if (this.current.type !== TOKEN.OPEN) {
                throw new ParseError(
                    `${name} needs parentheses, like ${name}(x)`,
                    position,
                );
            }
            this.advance();
            const args = [this.parseExpression()];
            while (this.current.type === TOKEN.COMMA) {
                this.advance();
                args.push(this.parseExpression());
            }
            this.expectClose(position);
            if (!acceptsArity(name, args.length)) {
                const expected = FUNCTIONS[name].arity;
                throw new ParseError(
                    `${name} takes ${expected} argument${expected === 1 ? '' : 's'}, ` +
                        `but got ${args.length}`,
                    position,
                );
            }
            return call(name, args);
        }

        if (isConstantName(name)) return constant(name);
        if (name === 'x') return variable('x');

        throw new ParseError(`I don't recognise "${name}"`, position);
    }

    expectClose(openPosition) {
        if (this.current.type !== TOKEN.CLOSE) {
            throw new ParseError('This "(" is never closed', openPosition);
        }
        this.advance();
    }
}

/**
 * Strip a `y =` / `f(x) =` prefix so all three spellings behave the same:
 * `y = x^2`, `f(x) = x^2` and a bare `x^2`.
 */
export function stripAssignment(source) {
    const text = normalizeSource(source).trim();
    const match = /^\s*(?:y|f\s*\(\s*x\s*\)|f)\s*=\s*/i.exec(text);
    const body = match ? text.slice(match[0].length) : text;
    if (body.includes('=')) {
        throw new ParseError(
            'Write the function as "y = …" or just "…" — one equals sign at most',
            text.indexOf('=', match ? match[0].length : 0),
        );
    }
    return body;
}

/** Parse an expression, with any `y =` prefix removed. Throws ParseError. */
export function parse(source) {
    const body = stripAssignment(source);
    if (body.trim() === '') {
        throw new ParseError('Nothing to plot yet', 0);
    }
    const parser = new Parser(tokenize(body));
    const node = parser.parseExpression();
    if (parser.current.type !== TOKEN.END) {
        const leftover = parser.current;
        const message =
            leftover.type === TOKEN.CLOSE
                ? 'This ")" has no matching "("'
                : leftover.type === TOKEN.BAR
                  ? 'This "|" has no matching "|"'
                  : 'I got lost here — check for a missing operator or bracket';
        throw new ParseError(message, leftover.position);
    }
    return node;
}

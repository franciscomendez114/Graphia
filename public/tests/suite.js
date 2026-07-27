/**
 * Graphia's test suite.
 *
 * The most valuable test here is the symbolic-derivative property test: for a
 * spread of expressions it evaluates the differentiation rules against a
 * high-order numeric derivative at several points. Hand-written differentiation
 * rules are exactly the kind of code where a single transposed sign hides
 * forever, and a property test catches that in a way a handful of examples
 * cannot.
 */

import { describe, it, expect, run } from './runner.js';

import { parse, tokenize, ParseError, normalizeSource } from '../src/math/parser.js';
import { compile } from '../src/math/compile.js';
import { Expression } from '../src/math/expression.js';
import { format } from '../src/math/format.js';
import {
    integrate,
    numericDerivative,
    bisect,
    goldenSection,
} from '../src/math/numeric.js';
import { Viewport } from '../src/graph/viewport.js';
import { niceStep, axisTicks, formatTick } from '../src/graph/ticks.js';
import { sampleFunction, pathsYRange } from '../src/graph/sampler.js';
import { riemannSum, exactIntegral, convergenceTable } from '../src/features/riemann.js';
import { tangentAt, secantAt, differenceQuotients, nearestDefined } from '../src/features/tangent.js';
import { findKeyPoints } from '../src/features/keypoints.js';
import {
    createCurve,
    createState,
    serializeState,
    deserializeState,
    stateToHash,
    stateFromHash,
} from '../src/state.js';

/** Evaluate a source string at x. */
const evalAt = (source, x) => compile(parse(source))(x);
const view = (options) => new Viewport({ width: 800, height: 600, ...options });

// ---------------------------------------------------------------------------

describe('lexer', () => {
    it('reads decimals, leading dots and exponents', () => {
        expect(evalAt('1.5', 0)).toBe(1.5);
        expect(evalAt('.25', 0)).toBe(0.25);
        expect(evalAt('1e-3', 0)).toBe(0.001);
        expect(evalAt('2.5E2', 0)).toBe(250);
    });

    it('does not swallow e as an exponent when no digits follow', () => {
        // `2e` is 2 · Euler's number, not a malformed literal.
        expect(evalAt('2e', 0)).toBeCloseTo(2 * Math.E);
    });

    it('prefers the longest known name', () => {
        const names = tokenize('sinh(x)').map((token) => token.name);
        expect(names[0]).toBe('sinh');
        expect(tokenize('exp(x)')[0].name).toBe('exp');
    });

    it('splits unknown letter runs into single characters', () => {
        // So `xy` reports an unknown "y" rather than an unknown "xy".
        expect(() => parse('xy')).toThrow('recognise "y"');
    });

    it('normalises pasted unicode', () => {
        expect(normalizeSource('2π')).toBe('2pi');
        expect(evalAt('x²', 3)).toBe(9);
        expect(evalAt('√(x)', 16)).toBe(4);
        expect(evalAt('−x', 3)).toBe(-3);
        expect(evalAt('2×3', 0)).toBe(6);
        expect(evalAt('[x]', 2)).toBe(2);
    });
});

describe('parser', () => {
    it('respects operator precedence', () => {
        expect(evalAt('2+3*4', 0)).toBe(14);
        expect(evalAt('(2+3)*4', 0)).toBe(20);
        expect(evalAt('2-3-4', 0)).toBe(-5);
        expect(evalAt('12/3/2', 0)).toBe(2);
    });

    it('treats ^ as right associative and binds tighter than unary minus', () => {
        expect(evalAt('2^3^2', 0)).toBe(512);
        expect(evalAt('-x^2', 3)).toBe(-9);
        expect(evalAt('2^-1', 0)).toBe(0.5);
    });

    it('handles implicit multiplication', () => {
        expect(evalAt('2x', 3)).toBe(6);
        expect(evalAt('2x^2', 3)).toBe(18);
        expect(evalAt('(x+1)(x-1)', 3)).toBe(8);
        expect(evalAt('3sin(0)', 0)).toBe(0);
        expect(evalAt('2pi', 0)).toBeCloseTo(2 * Math.PI);
        // Documented convention: implicit multiplication binds like an explicit *.
        expect(evalAt('1/2x', 4)).toBe(2);
    });

    it('does not mistake a minus for implicit multiplication', () => {
        expect(evalAt('2 -3', 0)).toBe(-1);
        expect(evalAt('x -1', 5)).toBe(4);
    });

    it('accepts all three ways of naming a function', () => {
        expect(evalAt('x^2', 4)).toBe(16);
        expect(evalAt('y = x^2', 4)).toBe(16);
        expect(evalAt('f(x) = x^2', 4)).toBe(16);
        expect(evalAt('Y=X^2', 4)).toBe(16);
    });

    it('reads |x| as absolute value', () => {
        expect(evalAt('|x|', -3)).toBe(3);
        expect(evalAt('|x| + 1', -3)).toBe(4);
        expect(evalAt('|x-1|', -3)).toBe(4);
    });

    it('explains its mistakes', () => {
        expect(() => parse('sin x')).toThrow('parentheses');
        expect(() => parse('x +')).toThrow();
        expect(() => parse('(x')).toThrow('never closed');
        expect(() => parse('x)')).toThrow('no matching');
        expect(() => parse('y = x = 2')).toThrow('one equals sign');
        expect(() => parse('foo(x)')).toThrow('recognise');
        expect(() => parse('mod(1)')).toThrow('2 arguments');
        expect(() => parse('|x')).toThrow('closing bar');
        expect(() => parse('')).toThrow('Nothing to plot');
    });

    it('reports a position with its errors', () => {
        try {
            parse('x + @');
            expect(false).toBeTruthy();
        } catch (error) {
            expect(error instanceof ParseError).toBeTruthy();
            expect(error.position).toBe(4);
        }
    });
});

describe('compiler', () => {
    it('evaluates the function library', () => {
        expect(evalAt('sin(pi/2)', 0)).toBeCloseTo(1);
        expect(evalAt('tan(pi/4)', 0)).toBeCloseTo(1);
        expect(evalAt('sec(0)', 0)).toBeCloseTo(1);
        expect(evalAt('csc(pi/2)', 0)).toBeCloseTo(1);
        expect(evalAt('cot(pi/4)', 0)).toBeCloseTo(1);
        expect(evalAt('ln(e)', 0)).toBeCloseTo(1);
        expect(evalAt('log(1000)', 0)).toBeCloseTo(3);
        expect(evalAt('log2(8)', 0)).toBeCloseTo(3);
        expect(evalAt('logbase(3, 9)', 0)).toBeCloseTo(2);
        expect(evalAt('max(1, x, 3)', 7)).toBe(7);
        expect(evalAt('floor(x)', 2.7)).toBe(2);
        expect(evalAt('sign(x)', -4)).toBe(-1);
    });

    it('uses the mathematical modulo', () => {
        expect(evalAt('mod(-1, 3)', 0)).toBe(2);
        expect(evalAt('mod(7, 3)', 0)).toBe(1);
    });

    it('keeps odd roots real for negative inputs', () => {
        // Math.pow(-8, 1/3) is NaN; the real cube root is -2, and a graphing
        // calculator should draw that branch.
        expect(evalAt('x^(1/3)', -8)).toBeCloseTo(-2);
        expect(evalAt('cbrt(x)', -8)).toBeCloseTo(-2);
        expect(Number.isNaN(evalAt('x^(1/2)', -4))).toBeTruthy();
    });

    it('folds constant subtrees', () => {
        const expression = Expression.parse('2*pi');
        expect(expression.isConstant).toBeTruthy();
        expect(expression.evaluate(0)).toBeCloseTo(Math.PI * 2);
        expect(expression.evaluate(99)).toBeCloseTo(Math.PI * 2);
    });

    it('computes small integer powers exactly', () => {
        expect(evalAt('x^3', 2)).toBe(8);
        expect(evalAt('x^0', 5)).toBe(1);
        expect(evalAt('x^8', 2)).toBe(256);
    });
});

// ---------------------------------------------------------------------------

describe('symbolic derivatives', () => {
    /**
     * Each entry: expression, and x values inside its domain that avoid poles
     * (where a numeric derivative would be meaningless anyway).
     */
    const cases = [
        ['x^2', [-2, 0.5, 3]],
        ['x^3 - 2x', [-1.5, 0.7, 2]],
        ['5', [1, 2]],
        ['3x + 1', [-4, 0, 4]],
        ['1/x', [-2, 0.5, 3]],
        ['x/(x^2+1)', [-2, 0.3, 5]],
        ['(x^2+1)^3', [-1.2, 0.4, 2]],
        ['sin(x)', [-2, 0.3, 1.7]],
        ['cos(x)', [-2, 0.3, 1.7]],
        ['tan(x)', [0.3, 1.1, -0.9]],
        ['sec(x)', [0.4, 1.2]],
        ['csc(x)', [0.6, 2.4]],
        ['cot(x)', [0.6, 2.4]],
        ['sin(2x)^2', [0.3, 1.1]],
        ['sin(cos(x))', [0.4, 2.2]],
        ['asin(x)', [-0.6, 0.2, 0.7]],
        ['acos(x)', [-0.6, 0.2, 0.7]],
        ['atan(x)', [-3, 0.5, 4]],
        ['acot(x)', [-3, 0.5, 4]],
        ['exp(x)', [-1, 0.5, 2]],
        ['e^x', [-1, 0.5, 2]],
        ['2^x', [-1, 0.5, 3]],
        ['ln(x)', [0.4, 1, 6]],
        ['log(x)', [0.4, 1, 6]],
        ['log2(x)', [0.4, 1, 6]],
        ['sqrt(x)', [0.3, 1, 9]],
        ['sqrt(x^2+1)', [-2, 0.5, 3]],
        ['cbrt(x)', [0.5, 2, -3]],
        ['sinh(x)', [-1, 0.6, 2]],
        ['cosh(x)', [-1, 0.6, 2]],
        ['tanh(x)', [-1, 0.6, 2]],
        ['sech(x)', [-1, 0.6]],
        ['csch(x)', [0.6, 2]],
        ['coth(x)', [0.6, 2]],
        ['asinh(x)', [-2, 0.5, 3]],
        ['acosh(x)', [1.4, 3]],
        ['atanh(x)', [-0.6, 0.3]],
        ['x^x', [0.5, 1.6]],
        ['x^sin(x)', [0.8, 2.2]],
        ['abs(x)', [-3, 2]],
        ['x*sin(x)/(x^2+2)', [-2, 0.4, 3]],
        ['exp(-x^2)', [-1.5, 0.2, 1.5]],
        ['ln(x^2+1)', [-2, 0.5, 3]],
    ];

    for (const [source, points] of cases) {
        it(`d/dx ${source} matches a numeric derivative`, () => {
            const expression = Expression.parse(source);
            const derivative = expression.derivative();
            expect(derivative).toBeTruthy();

            for (const x of points) {
                const symbolic = derivative.evaluate(x);
                const numeric = numericDerivative(expression.evaluate, x);
                expect(symbolic).toBeCloseTo(numeric, 1e-6);
            }
        });
    }

    it('reports functions it cannot differentiate symbolically', () => {
        expect(Expression.parse('min(x, 2)').derivative()).toBe(null);
        expect(Expression.parse('mod(x, 3)').derivative()).toBe(null);
    });

    it('still produces a slope for those, by limit', () => {
        const expression = Expression.parse('min(x, 200)');
        expect(expression.slopeAt(3)).toBeCloseTo(1, 1e-5);
    });

    it('differentiates constants and unused variables to zero', () => {
        expect(Expression.parse('7').derivative().evaluate(3)).toBe(0);
        expect(Expression.parse('pi').derivative().evaluate(3)).toBe(0);
    });
});

describe('simplifier and formatter', () => {
    const derivativeText = (source) =>
        Expression.parse(source).derivative().toString();

    it('tidies derivative output into readable algebra', () => {
        expect(derivativeText('x^2')).toBe('2x');
        expect(derivativeText('x^3')).toBe('3x^2');
        expect(derivativeText('3x')).toBe('3');
        expect(derivativeText('x')).toBe('1');
        expect(derivativeText('sin(x)')).toBe('cos(x)');
        expect(derivativeText('cos(x)')).toBe('-sin(x)');
        expect(derivativeText('ln(x)')).toBe('1/x');
        expect(derivativeText('x^2 + 3x')).toBe('2x + 3');
        expect(derivativeText('exp(x)')).toBe('exp(x)');
    });

    it('parenthesises only where it has to', () => {
        expect(format(parse('2*(x+1)'))).toBe('2(x + 1)');
        expect(format(parse('x-(1-x)'))).toBe('x - (1 - x)');
        expect(format(parse('(x+1)/(x-1)'))).toBe('(x + 1)/(x - 1)');
        expect(format(parse('x^(x+1)'))).toBe('x^(x + 1)');
        expect(format(parse('2*3'))).toBe('2*3');
    });

    it('can write integer powers as superscripts', () => {
        expect(format(parse('x^2'), { superscripts: true })).toBe('x²');
        expect(format(parse('x^12'), { superscripts: true })).toBe('x¹²');
        expect(format(parse('x^(1/2)'), { superscripts: true })).toBe('x^(1/2)');
    });

    it('keeps exact fractions rather than rounding them', () => {
        expect(derivativeText('x/3')).toBe('1/3');
    });
});

// ---------------------------------------------------------------------------

describe('numeric methods', () => {
    it('integrates smooth functions to near machine precision', () => {
        expect(integrate((x) => x * x, 0, 1)).toBeCloseTo(1 / 3, 1e-12);
        expect(integrate(Math.sin, 0, Math.PI)).toBeCloseTo(2, 1e-11);
        expect(integrate(Math.exp, 0, 1)).toBeCloseTo(Math.E - 1, 1e-11);
        expect(integrate((x) => 1 / x, 1, 2)).toBeCloseTo(Math.LN2, 1e-11);
        expect(integrate((x) => Math.sqrt(x), 0, 1)).toBeCloseTo(2 / 3, 1e-6);
    });

    it('respects orientation and degenerate intervals', () => {
        expect(integrate((x) => x * x, 1, 0)).toBeCloseTo(-1 / 3, 1e-12);
        expect(integrate((x) => x * x, 2, 2)).toBe(0);
    });

    it('refuses to invent a value across an asymptote', () => {
        expect(integrate((x) => 1 / x, -1, 1)).toBeNaN();
        expect(integrate(Math.tan, -1, 4)).toBeNaN();
        expect(integrate((x) => 1 / (x - 2), 0, 5)).toBeNaN();
        expect(integrate((x) => 1 / (x * x), -1, 1)).toBeNaN();
    });

    it('still handles integrable singularities', () => {
        // Both of these have an infinite derivative or value at an endpoint yet
        // a perfectly finite integral, so they must not be rejected.
        expect(integrate((x) => Math.sqrt(x), 0, 1)).toBeCloseTo(2 / 3, 1e-6);
        expect(integrate(Math.log, 0, 1)).toBeCloseTo(-1, 1e-5);
        expect(integrate((x) => 1 / Math.sqrt(x), 0, 1)).toBeCloseTo(2, 1e-3);
    });

    it('rejects a divergent integral even at an endpoint', () => {
        expect(integrate((x) => 1 / x, 0, 1)).toBeNaN();
    });

    it('brackets roots and extrema', () => {
        expect(bisect((x) => x * x - 2, 0, 3)).toBeCloseTo(Math.SQRT2, 1e-9);
        expect(bisect(Math.sin, 2, 4)).toBeCloseTo(Math.PI, 1e-9);
        expect(bisect((x) => x * x + 1, 0, 3)).toBeNaN();
        expect(goldenSection((x) => (x - 2) ** 2, -5, 8, 'min')).toBeCloseTo(2, 1e-6);
        expect(goldenSection(Math.sin, 0, 3, 'max')).toBeCloseTo(Math.PI / 2, 1e-6);
    });

    it('differentiates numerically to high accuracy', () => {
        expect(numericDerivative(Math.sin, 1)).toBeCloseTo(Math.cos(1), 1e-9);
        expect(numericDerivative((x) => x ** 3, 2)).toBeCloseTo(12, 1e-8);
    });
});

// ---------------------------------------------------------------------------

describe('viewport', () => {
    it('round-trips world and screen coordinates', () => {
        const v = view({ centerX: 3, centerY: -2, scaleX: 40, scaleY: 90 });
        for (const x of [-10, 0, 3, 7.5]) {
            expect(v.toWorldX(v.toScreenX(x))).toBeCloseTo(x, 1e-12);
        }
        for (const y of [-10, 0, 3, 7.5]) {
            expect(v.toWorldY(v.toScreenY(y))).toBeCloseTo(y, 1e-12);
        }
    });

    it('puts the origin in the middle of a fresh view', () => {
        const v = view();
        expect(v.toScreenX(0)).toBe(400);
        expect(v.toScreenY(0)).toBe(300);
    });

    it('keeps the anchor pinned while zooming', () => {
        const v = view();
        const anchor = { x: 613, y: 122 };
        const before = { x: v.toWorldX(anchor.x), y: v.toWorldY(anchor.y) };
        v.zoomBy(2.5, 2.5, anchor.x, anchor.y);
        expect(v.toWorldX(anchor.x)).toBeCloseTo(before.x, 1e-9);
        expect(v.toWorldY(anchor.y)).toBeCloseTo(before.y, 1e-9);
    });

    it('zooms one axis at a time', () => {
        const v = view();
        v.zoomBy(2, 1);
        expect(v.scaleX).toBe(128);
        expect(v.scaleY).toBe(64);
        expect(v.isSquare).toBeFalsy();
        v.squareUp();
        expect(v.isSquare).toBeTruthy();
    });

    it('pans by whole pixels in the direction of the drag', () => {
        const v = view();
        v.panByPixels(64, 0);
        expect(v.centerX).toBeCloseTo(-1);
        v.panByPixels(0, 64);
        expect(v.centerY).toBeCloseTo(1);
    });

    it('reports sensible bounds', () => {
        const v = view();
        expect(v.xMin).toBeCloseTo(-6.25);
        expect(v.xMax).toBeCloseTo(6.25);
        expect(v.yMin).toBeLessThan(v.yMax);
    });

    it('frames a y range when fitting', () => {
        const v = view();
        v.fitY(-3, 9);
        expect(v.centerY).toBeCloseTo(3);
        expect((v.yMax - v.yMin) > 12).toBeTruthy();
    });

    it('survives a round trip through JSON', () => {
        const v = view({ centerX: 1.5, scaleY: 12 });
        const restored = Viewport.fromJSON(v.toJSON(), 800, 600);
        expect(restored.centerX).toBe(1.5);
        expect(restored.scaleY).toBe(12);
    });
});

describe('ticks', () => {
    it('snaps to the 1-2-5 sequence', () => {
        expect(niceStep(1)).toBe(1);
        expect(niceStep(1.4)).toBe(2);
        expect(niceStep(3)).toBe(5);
        expect(niceStep(7)).toBe(10);
        expect(niceStep(0.02)).toBeCloseTo(0.02);
        expect(niceStep(230)).toBe(500);
    });

    it('only generates ticks that are on screen', () => {
        const ticks = axisTicks(-10, 10, 800);
        expect(ticks.step).toBe(5);
        expect(ticks.major).toEqual([-10, -5, 0, 5, 10]);
        expect(ticks.minor.length).toBeLessThan(30);
    });

    it('stays bounded at extreme zoom', () => {
        const wide = axisTicks(-1e9, 1e9, 800);
        expect(wide.major.length).toBeLessThan(60);
        const tight = axisTicks(-1e-9, 1e-9, 800);
        expect(tight.major.length).toBeLessThan(60);
    });

    it('avoids floating point noise in labels', () => {
        const ticks = axisTicks(0, 1, 800);
        expect(ticks.major.includes(0.30000000000000004)).toBeFalsy();
        expect(formatTick(0.3, 0.1)).toBe('0.3');
        expect(formatTick(0.5, 0.5)).toBe('0.5');
        expect(formatTick(2, 1)).toBe('2');
        expect(formatTick(0, 1)).toBe('0');
    });

    it('uses scientific notation past six figures', () => {
        expect(formatTick(1e6, 1e6)).toBe('10⁶');
        expect(formatTick(2e7, 1e7)).toBe('2×10⁷');
        expect(formatTick(-1e-5, 1e-5)).toBe('-10⁻⁵');
    });
});

// ---------------------------------------------------------------------------

describe('sampler', () => {
    const sample = (source, v = view()) =>
        sampleFunction(compile(parse(source)), v);

    /** Largest perpendicular gap, in pixels, between the polyline and the curve. */
    function maxDeviation(source, v = view()) {
        const f = compile(parse(source));
        const { paths } = sample(source, v);
        let worst = 0;
        for (const path of paths) {
            for (let i = 1; i < path.length; i += 1) {
                const a = path[i - 1];
                const b = path[i];
                const xm = (a.x + b.x) / 2;
                const truth = { x: v.toScreenX(xm), y: v.toScreenY(f(xm)) };
                const p0 = { x: v.toScreenX(a.x), y: v.toScreenY(a.y) };
                const p1 = { x: v.toScreenX(b.x), y: v.toScreenY(b.y) };
                const dx = p1.x - p0.x;
                const dy = p1.y - p0.y;
                const length = Math.hypot(dx, dy);
                if (length < 1e-9) continue;
                const distance =
                    Math.abs((truth.x - p0.x) * dy - (truth.y - p0.y) * dx) / length;
                if (Number.isFinite(distance)) worst = Math.max(worst, distance);
            }
        }
        return worst;
    }

    it('costs about one sample per pixel column on a straight line', () => {
        const result = sample('x');
        expect(result.paths.length).toBe(1);
        // 800px wide plus margins, with no subdivision needed anywhere: one
        // emitted point per column.
        expect(result.points).toBeLessThan(900);
        // Two evaluations per column — the sample itself, plus the midpoint
        // probe that decides no subdivision is needed.
        expect(result.evaluations).toBeLessThan(1800);
    });

    it('stays bounded when zoomed far out — the original failure mode', () => {
        // The old renderer's cost grew with the world range; this must not.
        const wide = sample('x^2', view({ scaleX: 0.01, scaleY: 0.01 }));
        const tight = sample('x^2', view({ scaleX: 200, scaleY: 200 }));
        expect(wide.evaluations).toBeLessThan(6000);
        expect(tight.evaluations).toBeLessThan(6000);
        // And the cost should be within the same order of magnitude either way.
        expect(wide.evaluations / tight.evaluations).toBeLessThan(4);
    });

    it('never exceeds its budget, even for wild functions', () => {
        for (const source of ['sin(100x)', 'sin(1/x)', 'tan(20x)', 'x^20']) {
            const result = sample(source);
            expect(result.points).toBeLessThan(60001);
            expect(result.evaluations).toBeLessThan(400000);
        }
    });

    it('tracks the curve to within a pixel', () => {
        expect(maxDeviation('x^2')).toBeLessThan(1.5);
        expect(maxDeviation('sin(x)')).toBeLessThan(1.5);
        expect(maxDeviation('x^3 - 3x', view({ scaleX: 30, scaleY: 30 }))).toBeLessThan(1.5);
    });

    it('puts every sample exactly on the function', () => {
        const f = compile(parse('sin(x)*x'));
        const { paths } = sample('sin(x)*x');
        for (const path of paths) {
            for (const point of path) {
                expect(point.y).toBeCloseTo(f(point.x), 1e-12);
            }
        }
    });

    it('keeps x increasing along every path', () => {
        for (const source of ['x^2', '1/x', 'tan(x)', 'sqrt(x)', 'ln(x)']) {
            const { paths } = sample(source);
            for (const path of paths) {
                for (let i = 1; i < path.length; i += 1) {
                    expect(path[i].x >= path[i - 1].x).toBeTruthy();
                }
            }
        }
    });

    it('breaks the line at a vertical asymptote instead of drawing through it', () => {
        const { paths } = sample('1/x');
        expect(paths.length).toBeGreaterThan(1);
        // No single piece may straddle the pole.
        for (const path of paths) {
            const signs = new Set(path.map((point) => Math.sign(point.x)));
            signs.delete(0);
            expect(signs.size).toBe(1);
        }
    });

    it('breaks tan(x) once per asymptote', () => {
        // A default view spans roughly -6.25 to 6.25: four asymptotes inside.
        const { paths } = sample('tan(x)');
        expect(paths.length).toBeGreaterThan(3);
    });

    it('stops at the edge of the domain and reaches it', () => {
        const { paths } = sample('sqrt(x)');
        const xs = paths.flat().map((point) => point.x);
        expect(Math.min(...xs)).toBeGreaterThan(-1e-6);
        expect(Math.min(...xs)).toBeLessThan(1e-6);

        const logPaths = sample('ln(x)').paths.flat();
        expect(Math.min(...logPaths.map((point) => point.x))).toBeGreaterThan(0);
    });

    it('handles a function that is defined nowhere on screen', () => {
        const result = sample('sqrt(-1-x^2)');
        expect(result.paths.length).toBe(0);
    });

    it('reports the y range it covered', () => {
        const v = view();
        const { paths } = sample('x^2', v);
        const range = pathsYRange(paths, v.xMin, v.xMax);
        expect(range.low).toBeCloseTo(0, 1e-3);
        expect(range.high).toBeGreaterThan(30);
    });
});

// ---------------------------------------------------------------------------

describe('Riemann sums', () => {
    const square = (x) => x * x;

    it('matches the sums worked out by hand', () => {
        expect(riemannSum(square, 0, 1, 4, 'left').sum).toBeCloseTo(0.21875, 1e-12);
        expect(riemannSum(square, 0, 1, 4, 'right').sum).toBeCloseTo(0.46875, 1e-12);
        expect(riemannSum(square, 0, 1, 4, 'midpoint').sum).toBeCloseTo(0.328125, 1e-12);
        expect(riemannSum(square, 0, 1, 4, 'trapezoid').sum).toBeCloseTo(0.34375, 1e-12);
    });

    it('produces n cells of width Δx', () => {
        const { cells, dx } = riemannSum(square, 1, 3, 8, 'left');
        expect(cells.length).toBe(8);
        expect(dx).toBeCloseTo(0.25);
        expect(cells[0].x0).toBeCloseTo(1);
        expect(cells[7].x1).toBeCloseTo(3);
    });

    it('flips sign when the limits are reversed', () => {
        const forward = riemannSum(square, 0, 1, 4, 'left').sum;
        const backward = riemannSum(square, 1, 0, 4, 'left').sum;
        expect(backward).toBeCloseTo(-forward, 1e-12);
    });

    it('counts area below the axis as negative', () => {
        // ∫sin from 0 to 2π is zero: the halves cancel.
        expect(riemannSum(Math.sin, 0, 2 * Math.PI, 200, 'midpoint').sum).toBeCloseTo(0, 1e-6);
        expect(exactIntegral(Math.sin, 0, 2 * Math.PI)).toBeCloseTo(0, 1e-9);
    });

    it('converges on the exact value as n grows', () => {
        const exact = exactIntegral(square, 0, 1);
        expect(exact).toBeCloseTo(1 / 3, 1e-12);

        let previous = Infinity;
        for (const n of [4, 16, 64, 256]) {
            const error = Math.abs(riemannSum(square, 0, 1, n, 'left').sum - exact);
            expect(error).toBeLessThan(previous);
            previous = error;
        }
    });

    it('converges faster for the better rules', () => {
        const exact = exactIntegral(square, 0, 2);
        const error = (rule) => Math.abs(riemannSum(square, 0, 2, 16, rule).sum - exact);
        expect(error('midpoint')).toBeLessThan(error('left'));
        expect(error('midpoint')).toBeLessThan(error('trapezoid'));
    });

    it('builds a convergence table', () => {
        const rows = convergenceTable(square, 0, 1, 'left');
        expect(rows.length).toBe(6);
        expect(rows[0].n).toBe(2);
        expect(Math.abs(rows[5].error)).toBeLessThan(Math.abs(rows[0].error));
    });

    it('degrades gracefully on an empty interval', () => {
        const result = riemannSum(square, 2, 2, 8, 'left');
        expect(result.sum).toBe(0);
        expect(result.cells.length).toBe(0);
    });
});

describe('tangents and secants', () => {
    const parabola = Expression.parse('x^2');

    it('finds the tangent from the differentiation rules', () => {
        const tangent = tangentAt(parabola, 3);
        expect(tangent.fa).toBe(9);
        expect(tangent.slope).toBeCloseTo(6, 1e-12);
        expect(tangent.isSymbolic).toBeTruthy();
    });

    it('gives an exact difference quotient for a parabola', () => {
        // (f(a+h) - f(a))/h is exactly 2a + h when f is x².
        for (const h of [1, 0.5, 0.125]) {
            expect(secantAt(parabola, 3, h).slope).toBeCloseTo(6 + h, 1e-12);
        }
    });

    it('shows the quotient converging on the derivative', () => {
        const rows = differenceQuotients(parabola, 2);
        for (let i = 1; i < rows.length; i += 1) {
            expect(rows[i].error).toBeLessThan(rows[i - 1].error);
        }
        expect(rows.at(-1).error).toBeLessThan(1e-2);
    });

    it('falls back to a limit when there is no symbolic rule', () => {
        const tangent = tangentAt(Expression.parse('min(x, 100)'), 4);
        expect(tangent.isSymbolic).toBeFalsy();
        expect(tangent.slope).toBeCloseTo(1, 1e-5);
    });

    it('nudges a dragged point back into the domain', () => {
        const root = Expression.parse('sqrt(x)');
        expect(nearestDefined(root, -0.05, 1 / 64)).toBeGreaterThan(-1e-9);
        expect(nearestDefined(root, 4, 1 / 64)).toBe(4);
    });
});

describe('key points', () => {
    it('finds the roots and turning points of sin(x)', () => {
        const v = view({ scaleX: 57, scaleY: 57 });
        const expression = Expression.parse('sin(x)');
        const { paths } = sampleFunction(expression.evaluate, v);
        const points = findKeyPoints(expression, paths, v);

        const roots = points.filter((point) => point.type === 'root');
        expect(roots.length).toBe(5);
        for (const root of roots) {
            expect(Math.abs(Math.sin(root.x))).toBeLessThan(1e-6);
        }

        const maxima = points.filter((point) => point.type === 'maximum');
        expect(maxima.length).toBe(2);
        for (const point of maxima) {
            expect(point.y).toBeCloseTo(1, 1e-6);
        }
    });

    it('finds the vertex of a parabola', () => {
        const v = view();
        const expression = Expression.parse('x^2 - 4x + 5');
        const { paths } = sampleFunction(expression.evaluate, v);
        const minima = findKeyPoints(expression, paths, v).filter(
            (point) => point.type === 'minimum',
        );
        expect(minima.length).toBe(1);
        expect(minima[0].x).toBeCloseTo(2, 1e-5);
        expect(minima[0].y).toBeCloseTo(1, 1e-5);
    });

    it('gives up rather than clutter a dense curve', () => {
        const v = view();
        const expression = Expression.parse('sin(200x)');
        const { paths } = sampleFunction(expression.evaluate, v);
        expect(findKeyPoints(expression, paths, v).length).toBe(0);
    });
});

// ---------------------------------------------------------------------------

describe('state', () => {
    it('flags bad input without throwing', () => {
        const curve = createCurve('y = sin(');
        expect(curve.expression).toBe(null);
        expect(curve.error.message.length).toBeGreaterThan(0);
    });

    it('treats an empty row as neither valid nor an error', () => {
        const curve = createCurve('   ');
        expect(curve.expression).toBe(null);
        expect(curve.error).toBe(null);
    });

    it('round-trips through a session snapshot', () => {
        const state = createState();
        state.curves[0].source = 'y = sin(x)';
        state.curves.push(createCurve('x^3', '#dc2626'));
        state.curves[1].visible = false;
        state.mode = 'integral';
        state.integral = { a: -1, b: 2.5, n: 40, rule: 'midpoint' };
        state.view.zoomBy(3, 1.5);

        const restored = deserializeState(serializeState(state), {
            width: 800,
            height: 600,
        });

        expect(restored.curves.length).toBe(2);
        expect(restored.curves[0].source).toBe('y = sin(x)');
        expect(restored.curves[1].color).toBe('#dc2626');
        expect(restored.curves[1].visible).toBeFalsy();
        expect(restored.mode).toBe('integral');
        expect(restored.integral.n).toBe(40);
        expect(restored.integral.rule).toBe('midpoint');
        expect(restored.view.scaleX).toBeCloseTo(state.view.scaleX);
        expect(restored.curves[0].expression.evaluate(1)).toBeCloseTo(Math.sin(1));
    });

    it('round-trips through a shareable link', () => {
        const state = createState();
        state.curves[0].source = 'y = x^3 - 2x';
        const restored = stateFromHash(stateToHash(state), { width: 800, height: 600 });
        expect(restored.curves[0].source).toBe('y = x^3 - 2x');
    });

    it('ignores rubbish instead of breaking', () => {
        expect(stateFromHash('#g=not-json', {})).toBe(null);
        expect(stateFromHash('', {})).toBe(null);
        expect(deserializeState({ v: 99 }, {}).curves.length).toBe(1);
        expect(deserializeState(null, {}).mode).toBe('graph');
    });
});

run(document.getElementById('results'));

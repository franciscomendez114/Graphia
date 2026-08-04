/**
 * Tangent and secant geometry for the derivative tool.
 *
 * The visualisation this supports is the limit definition itself: a secant line
 * through (a, f(a)) and (a + h, f(a + h)), with h shrinking towards zero while
 * its slope converges on f′(a). Both lines are on screen at once, so the
 * "difference quotient becomes the derivative" step stops being an abstraction.
 */

/**
 * @param {import('../math/expression.js').Expression} expression
 * @param {number} a
 */
export function tangentAt(expression, a) {
    const fa = expression.evaluate(a);
    const symbolic = expression.derivative();
    const exact = symbolic ? symbolic.evaluate(a) : NaN;
    const slope = Number.isFinite(exact) ? exact : expression.slopeAt(a);

    return {
        a,
        fa,
        slope,
        /** Whether the slope came from differentiation rules or from a limit. */
        isSymbolic: Boolean(symbolic) && Number.isFinite(exact),
        defined: Number.isFinite(fa) && Number.isFinite(slope),
    };
}

/**
 * Secant through a and a + h, plus the rise/run legs used to draw the slope
 * triangle.
 */
export function secantAt(expression, a, h) {
    const b = a + h;
    const fa = expression.evaluate(a);
    const fb = expression.evaluate(b);
    const slope = (fb - fa) / h;

    return {
        a,
        b,
        fa,
        fb,
        h,
        rise: fb - fa,
        run: h,
        slope,
        defined: Number.isFinite(fa) && Number.isFinite(fb) && Number.isFinite(slope),
    };
}

/**
 * The classic table: |secant slope − f′(a)| shrinking with h. Used by the panel
 * to show the limit numerically alongside the picture.
 */
export function differenceQuotients(expression, a, steps = [1, 0.5, 0.1, 0.01, 0.001]) {
    const tangent = tangentAt(expression, a);
    return steps.map((h) => {
        const secant = secantAt(expression, a, h);
        return {
            h,
            slope: secant.slope,
            error: Math.abs(secant.slope - tangent.slope),
        };
    });
}

/**
 * Nudge `a` onto the nearest point of the curve's domain when the user drags the
 * marker into a gap (say x < 0 on `sqrt(x)`), searching outwards in pixel steps
 * so the marker never simply disappears.
 */
export function nearestDefined(expression, a, unitsPerPixel) {
    if (Number.isFinite(expression.evaluate(a))) return a;
    for (let i = 1; i <= 200; i += 1) {
        const offset = i * unitsPerPixel;
        if (Number.isFinite(expression.evaluate(a + offset))) return a + offset;
        if (Number.isFinite(expression.evaluate(a - offset))) return a - offset;
    }
    return a;
}

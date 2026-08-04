/**
 * Numerical methods: the honest reference values the visualisations compare
 * themselves against.
 *
 * The point of the calculus tools is that a Riemann sum is an *approximation*,
 * so the app needs a much better approximation to measure it against. Adaptive
 * Simpson gives roughly 10-12 correct digits on smooth integrands, which is
 * plenty to make the error column meaningful.
 */

/**
 * Central-difference derivative with Richardson extrapolation.
 *
 * Used for the tangent line when a function has no symbolic derivative, and as
 * the reference the symbolic rules are tested against.
 */
export function numericDerivative(f, x, step) {
    const h = step ?? 1e-5 * Math.max(1, Math.abs(x));
    const d1 = (f(x + h) - f(x - h)) / (2 * h);
    const d2 = (f(x + h / 2) - f(x - h / 2)) / h;
    // Halving the step cuts the O(h²) error by four; this cancels that term.
    return (4 * d2 - d1) / 3;
}

/** Second derivative by central differences — used for concavity readouts. */
export function numericSecondDerivative(f, x, step) {
    const h = step ?? 1e-4 * Math.max(1, Math.abs(x));
    return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
}

const SIMPSON_MAX_DEPTH = 40;
/**
 * How large the integrand has to get, at the finest subdivision the recursion
 * reaches, before an integral is called divergent.
 *
 * Deep recursion alone doesn't mean an integral fails to exist: ∫₀¹√x needs it
 * too, because the derivative is infinite at the origin, yet the answer is
 * plainly 2/3. What separates that from ∫tan(x) through π/2 is the size of the
 * integrand down there — √x is heading to zero, tan is heading to infinity.
 */
const DIVERGENCE_MAGNITUDE = 1e9;

/**
 * Adaptive Simpson's rule.
 *
 * @returns {number} the definite integral, or NaN if the integrand is not
 *   finite across the interval (an asymptote inside the range, for instance).
 */
export function integrate(f, a, b, tolerance = 1e-10) {
    if (a === b) return 0;
    if (b < a) return -integrate(f, b, a, tolerance);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;

    // Improper at an endpoint (∫₀¹ ln x, ∫₀¹ 1/√x): Simpson needs a value there,
    // so start a hair inside the domain. When the integral converges the sliver
    // skipped is far below the tolerance; when it doesn't, the refinement below
    // still finds the blow-up and returns NaN.
    let low = a;
    let high = b;
    const inset = (b - a) * 1e-10;
    if (!Number.isFinite(f(low))) low = a + inset;
    if (!Number.isFinite(f(high))) high = b - inset;

    const fa = f(low);
    const fb = f(high);
    const m = (low + high) / 2;
    const fm = f(m);
    if (!Number.isFinite(fa) || !Number.isFinite(fb) || !Number.isFinite(fm)) return NaN;

    const whole = ((high - low) / 6) * (fa + 4 * fm + fb);
    return refineSimpson(f, low, high, fa, fm, fb, whole, tolerance, 0);
}

function refineSimpson(f, a, b, fa, fm, fb, whole, tolerance, depth) {
    const m = (a + b) / 2;
    const lm = (a + m) / 2;
    const rm = (m + b) / 2;
    const flm = f(lm);
    const frm = f(rm);

    if (!Number.isFinite(flm) || !Number.isFinite(frm)) return NaN;

    const h = (b - a) / 12;
    const left = h * (fa + 4 * flm + fm);
    const right = h * (fm + 4 * frm + fb);
    const combined = left + right;

    // Richardson correction for the remaining O(h⁴) error term.
    const corrected = combined + (combined - whole) / 15;

    if (Math.abs(combined - whole) <= 15 * tolerance) return corrected;

    if (depth >= SIMPSON_MAX_DEPTH) {
        const magnitude = Math.max(
            Math.abs(fa),
            Math.abs(flm),
            Math.abs(fm),
            Math.abs(frm),
            Math.abs(fb),
        );
        // Still refusing to converge *and* blowing up: there is a pole in here,
        // and reporting a number for it would be a lie.
        return magnitude > DIVERGENCE_MAGNITUDE ? NaN : corrected;
    }

    const half = tolerance / 2;
    const leftResult = refineSimpson(f, a, m, fa, flm, fm, left, half, depth + 1);
    const rightResult = refineSimpson(f, m, b, fm, frm, fb, right, half, depth + 1);
    return leftResult + rightResult;
}

/**
 * Bisection on a bracketed sign change. Slower to converge than Brent but
 * unconditionally reliable, which matters more here.
 */
export function bisect(f, a, b, iterations = 60) {
    let lo = a;
    let hi = b;
    let flo = f(lo);
    let fhi = f(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return NaN;
    if (flo === 0) return lo;
    if (fhi === 0) return hi;
    if (Math.sign(flo) === Math.sign(fhi)) return NaN;

    for (let i = 0; i < iterations; i += 1) {
        const mid = (lo + hi) / 2;
        const fmid = f(mid);
        if (fmid === 0 || hi - lo < Number.EPSILON * Math.max(1, Math.abs(mid))) return mid;
        if (!Number.isFinite(fmid)) return NaN;
        if (Math.sign(fmid) === Math.sign(flo)) {
            lo = mid;
            flo = fmid;
        } else {
            hi = mid;
            fhi = fmid;
        }
    }
    return (lo + hi) / 2;
}

/**
 * Golden-section search for a local extremum inside a bracket.
 *
 * @param {'min'|'max'} kind
 */
export function goldenSection(f, a, b, kind = 'min', iterations = 80) {
    const invphi = (Math.sqrt(5) - 1) / 2;
    const sign = kind === 'max' ? -1 : 1;
    let lo = a;
    let hi = b;
    let c = hi - invphi * (hi - lo);
    let d = lo + invphi * (hi - lo);

    for (let i = 0; i < iterations && hi - lo > 1e-14 * Math.max(1, Math.abs(lo)); i += 1) {
        if (sign * f(c) < sign * f(d)) {
            hi = d;
            d = c;
            c = hi - invphi * (hi - lo);
        } else {
            lo = c;
            c = d;
            d = lo + invphi * (hi - lo);
        }
    }
    return (lo + hi) / 2;
}

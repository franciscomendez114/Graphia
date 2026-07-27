/**
 * Riemann sums.
 *
 * The original build derived rectangles by scanning the cached point list for a
 * screen coordinate that happened to sit near the interval boundary, with a
 * hard-coded 0.0005 tolerance — so the rectangles silently drifted or vanished
 * whenever the zoom changed. These are computed straight from the function, so
 * they are exact at any scale and independent of what is on screen.
 */

import { integrate } from '../math/numeric.js';

export const RULES = {
    left: { label: 'Left endpoint', sampleAt: (x0) => x0 },
    right: { label: 'Right endpoint', sampleAt: (x0, x1) => x1 },
    midpoint: { label: 'Midpoint', sampleAt: (x0, x1) => (x0 + x1) / 2 },
    trapezoid: { label: 'Trapezoid', sampleAt: (x0, x1) => (x0 + x1) / 2 },
};

export const RULE_KEYS = Object.keys(RULES);

/**
 * @param {(x: number) => number} f
 * @param {number} a lower limit (may be greater than b)
 * @param {number} b upper limit
 * @param {number} n subdivisions
 * @param {keyof RULES} rule
 * @returns {{
 *   cells: Array<{x0: number, x1: number, yLeft: number, yRight: number, area: number}>,
 *   sum: number, dx: number, orientation: 1 | -1
 * }}
 *   `sum` is the signed sum in the order the user gave the limits, so reversing
 *   them flips the sign exactly as the notation says it should.
 */
export function riemannSum(f, a, b, n, rule = 'left') {
    const subdivisions = Math.max(1, Math.floor(n));
    const orientation = b < a ? -1 : 1;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const dx = (high - low) / subdivisions;

    const cells = [];
    let sum = 0;

    if (!Number.isFinite(dx) || dx <= 0) {
        return { cells, sum: 0, dx: 0, orientation };
    }

    for (let i = 0; i < subdivisions; i += 1) {
        const x0 = low + i * dx;
        const x1 = i === subdivisions - 1 ? high : low + (i + 1) * dx;

        let yLeft;
        let yRight;
        if (rule === 'trapezoid') {
            yLeft = f(x0);
            yRight = f(x1);
        } else {
            const height = f(RULES[rule].sampleAt(x0, x1));
            yLeft = height;
            yRight = height;
        }

        // The average height handles rectangles and trapezoids in one line.
        const area = ((yLeft + yRight) / 2) * (x1 - x0);
        if (Number.isFinite(area)) sum += area;

        cells.push({ x0, x1, yLeft, yRight, area });
    }

    return { cells, sum: sum * orientation, dx, orientation };
}

/**
 * The value the sums are converging to, by adaptive Simpson. This is what makes
 * the error column meaningful rather than decorative.
 */
export function exactIntegral(f, a, b) {
    return integrate(f, a, b);
}

/**
 * Convergence table for a few subdivision counts — shows the error shrinking as
 * n grows, which is the whole point of the visualisation.
 */
export function convergenceTable(f, a, b, rule, counts = [2, 4, 8, 16, 32, 64]) {
    const exact = exactIntegral(f, a, b);
    return counts.map((n) => {
        const { sum } = riemannSum(f, a, b, n, rule);
        return { n, sum, error: Number.isFinite(exact) ? sum - exact : NaN };
    });
}

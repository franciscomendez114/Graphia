/**
 * Interesting points on a curve: roots and turning points.
 *
 * The sampler has already walked the curve at pixel resolution, so brackets can
 * be read straight off its output — a sign change in y brackets a root, a sign
 * change in the step-to-step slope brackets a turning point. Each surviving
 * bracket is then refined properly, so the label is mathematically accurate
 * rather than merely pixel-accurate.
 *
 * Candidates are filtered by screen position *before* refinement. On something
 * like `sin(x)` zoomed out there can be thousands of brackets per frame, and
 * refining them all just to throw the results away would undo the performance
 * work everywhere else.
 */

import { bisect, goldenSection } from '../math/numeric.js';

/** Don't report two points closer together than this on screen. */
const MIN_SEPARATION_PX = 26;
const MAX_POINTS = 40;
/** Past this many candidates the curve is too dense for markers to help. */
const CANDIDATE_LIMIT = 260;

/**
 * @param {import('../math/expression.js').Expression} expression
 * @param {Array<Array<{x: number, y: number}>>} paths sampler output
 * @param {import('../graph/viewport.js').Viewport} view
 * @returns {Array<{type: 'root' | 'minimum' | 'maximum', x: number, y: number}>}
 */
export function findKeyPoints(expression, paths, view) {
    const f = expression.evaluate;
    const candidates = [];

    for (const path of paths) {
        for (let i = 1; i < path.length; i += 1) {
            const previous = path[i - 1];
            const current = path[i];

            // Root: y changes sign across the step.
            if (
                current.y !== 0 &&
                previous.y !== 0 &&
                Math.sign(previous.y) !== Math.sign(current.y)
            ) {
                candidates.push({
                    type: 'root',
                    from: previous.x,
                    to: current.x,
                    guessX: (previous.x + current.x) / 2,
                    guessY: 0,
                });
            } else if (previous.y === 0) {
                candidates.push({
                    type: 'root',
                    from: previous.x,
                    to: previous.x,
                    guessX: previous.x,
                    guessY: 0,
                });
            }

            // Turning point: the slope changes sign across three samples.
            if (i + 1 < path.length) {
                const next = path[i + 1];
                const before = current.y - previous.y;
                const after = next.y - current.y;
                if (
                    before !== 0 &&
                    after !== 0 &&
                    Math.sign(before) !== Math.sign(after) &&
                    isProminent(path, i, view)
                ) {
                    candidates.push({
                        type: before > 0 ? 'maximum' : 'minimum',
                        from: previous.x,
                        to: next.x,
                        guessX: current.x,
                        guessY: current.y,
                    });
                }
            }

            if (candidates.length > CANDIDATE_LIMIT) return [];
        }
    }

    const kept = [];
    const placed = [];

    for (const candidate of candidates) {
        const sx = view.toScreenX(candidate.guessX);
        const sy = view.toScreenY(candidate.guessY);
        if (sx < -4 || sx > view.width + 4 || sy < -4 || sy > view.height + 4) continue;
        if (
            placed.some(
                (other) =>
                    Math.abs(other.sx - sx) < MIN_SEPARATION_PX &&
                    Math.abs(other.sy - sy) < MIN_SEPARATION_PX,
            )
        ) {
            continue;
        }

        const point = refine(candidate, f);
        if (!point) continue;

        placed.push({ sx, sy });
        kept.push(point);
        if (kept.length >= MAX_POINTS) break;
    }

    return kept;
}

/**
 * Is the turning point at `index` a real feature of the curve, or floating point
 * noise on something that is flat at this zoom?
 *
 * Adjacent samples can't answer this: near any smooth extremum the step-to-step
 * change goes to zero, which is precisely what makes it an extremum. So measure
 * how far the curve actually rises or falls over a wider window, in pixels. A
 * genuine peak clears a small fraction of a pixel; jitter on a flat line doesn't.
 */
function isProminent(path, index, view) {
    const window = 4;
    const from = Math.max(0, index - window);
    const to = Math.min(path.length - 1, index + window);

    let low = Infinity;
    let high = -Infinity;
    for (let i = from; i <= to; i += 1) {
        if (path[i].y < low) low = path[i].y;
        if (path[i].y > high) high = path[i].y;
    }
    return (high - low) * view.scaleY > 0.02;
}

function refine(candidate, f) {
    if (candidate.type === 'root') {
        if (candidate.from === candidate.to) {
            return { type: 'root', x: candidate.from, y: 0 };
        }
        const x = bisect(f, candidate.from, candidate.to);
        return Number.isFinite(x) ? { type: 'root', x, y: 0 } : null;
    }

    const x = goldenSection(
        f,
        candidate.from,
        candidate.to,
        candidate.type === 'maximum' ? 'max' : 'min',
    );
    const y = f(x);
    return Number.isFinite(y) ? { type: candidate.type, x, y } : null;
}

/**
 * Which drawn curve is nearest to a screen position, and where on it.
 *
 * Used by the trace readout. Distance is measured in screen space so a curve
 * feels equally easy to grab at any zoom, and the y it reports is recomputed
 * from the function so the readout is exact rather than interpolated.
 */
export function nearestOnCurves(curves, view, screenX, screenY, maxDistance = 26) {
    let best = null;

    for (const curve of curves) {
        if (!curve.visible || !curve.expression) continue;

        for (const path of curve.paths ?? []) {
            for (const point of path) {
                const sx = view.toScreenX(point.x);
                if (Math.abs(sx - screenX) > maxDistance) continue;
                const sy = view.toScreenY(point.y);
                const distance = Math.hypot(sx - screenX, sy - screenY);
                if (distance <= maxDistance && (!best || distance < best.distance)) {
                    best = { curve, x: point.x, y: point.y, distance };
                }
            }
        }
    }

    if (!best) return null;

    // Snap to the exact function value at that x.
    const exact = best.curve.expression.evaluate(best.x);
    return {
        curve: best.curve,
        x: best.x,
        y: Number.isFinite(exact) ? exact : best.y,
        distance: best.distance,
    };
}

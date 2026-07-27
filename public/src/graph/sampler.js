/**
 * Adaptive curve sampling.
 *
 * This is the fix for the original renderer's central problem. That version
 * stepped x by a fixed 0.0005 across the whole domain, producing on the order of
 * 200,000 points per function, drew a filled circle at every one of them, and
 * rebuilt the entire list whenever the zoom changed. The cost grew with how much
 * of the world was visible, so zooming out made it crawl.
 *
 * The approach here inverts that. You only ever have `width` pixels to draw
 * into, so:
 *
 *   1. Take one sample per pixel column — about 1,300 regardless of zoom.
 *   2. Subdivide a segment only while its midpoint sits more than a fifth of a
 *      pixel off the straight line between its endpoints. Straight stretches
 *      cost nothing; tight corners get the extra samples they need.
 *   3. Split the polyline at gaps in the domain (ln, sqrt) and at vertical
 *      asymptotes (tan, 1/x) instead of drawing a spurious line across them.
 *
 * Cost is bounded by the pixel width and a per-interval budget, so the frame
 * time no longer depends on the scale at all.
 */

const DEFAULTS = {
    /** Base sample spacing, in pixels. */
    pixelStep: 1,
    /** Sample slightly past both edges so curves enter the frame cleanly. */
    margin: 8,
    /** Subdivide while the midpoint is further than this (px) off the chord. */
    tolerance: 0.2,
    /** Recursion cap per base interval: at most 2^maxDepth extra samples. */
    maxDepth: 6,
    /** Fairness cap so one wild interval cannot eat the whole budget. */
    maxPointsPerInterval: 24,
    /** Hard ceiling on points per curve. */
    maxPoints: 60000,
};

/** A jump this many screen-heights tall is a candidate asymptote. */
const POLE_JUMP_HEIGHTS = 2;
/** Stop marching towards an asymptote once this far off screen. */
const OFF_SCREEN_HEIGHTS = 20;
/** Don't bother refining segments this far outside the viewport. */
const IGNORE_HEIGHTS = 4;
/** Bisection steps used to find a domain edge or approach an asymptote. */
const EDGE_STEPS = 26;
const APPROACH_STEPS = 20;

/**
 * @param {(x: number) => number} f compiled function
 * @param {import('./viewport.js').Viewport} view
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {{paths: Array<Array<{x: number, y: number}>>, evaluations: number, points: number}}
 *   `paths` holds one polyline per continuous piece, in **world** coordinates so
 *   the result stays independent of how it will be drawn.
 */
export function sampleFunction(f, view, options = {}) {
    const config = { ...DEFAULTS, ...options };
    const { height, centerY } = view;

    const paths = [];
    let current = null;
    let evaluations = 0;
    let points = 0;
    let intervalPoints = 0;

    /** Evaluate and precompute the screen position the geometry tests need. */
    function at(x) {
        const y = f(x);
        evaluations += 1;
        const sy = view.toScreenY(y);
        return {
            x,
            y,
            sx: view.toScreenX(x),
            sy,
            ok: Number.isFinite(y) && Number.isFinite(sy),
        };
    }

    function push(point) {
        if (!current) return;
        current.push({ x: point.x, y: point.y });
        points += 1;
    }

    function openAt(point) {
        if (current) return;
        current = [];
        paths.push(current);
        push(point);
    }

    function startFresh() {
        current = [];
        paths.push(current);
    }

    function closePath() {
        // A lone point draws nothing, so drop it rather than keep an empty path.
        if (current && current.length < 2) paths.pop();
        current = null;
    }

    const heightOffset = (point) => Math.abs(point.sy - height / 2);
    const branch = (point) => Math.sign(point.y - centerY);

    /** Perpendicular distance from `m` to the chord `a`→`b`, in pixels. */
    function deviation(a, m, b) {
        const dx = b.sx - a.sx;
        const dy = b.sy - a.sy;
        const length = Math.hypot(dx, dy);
        if (length < 1e-12) return Math.hypot(m.sx - a.sx, m.sy - a.sy);
        return Math.abs((m.sx - a.sx) * dy - (m.sy - a.sy) * dx) / length;
    }

    /**
     * Bisect between a valid and an invalid sample to find how far the curve
     * actually reaches — this is what puts the end of `sqrt(x)` on the origin
     * rather than a pixel to its right.
     */
    function walkToEdge(from, towards) {
        let valid = from;
        let invalid = towards;
        let best = null;
        for (let i = 0; i < EDGE_STEPS; i += 1) {
            const mid = at((valid.x + invalid.x) / 2);
            if (mid.x === valid.x || mid.x === invalid.x) break;
            if (mid.ok) {
                valid = mid;
                best = mid;
            } else {
                invalid = mid;
            }
        }
        return best;
    }

    /**
     * March from `from` towards an asymptote between it and `towards`, emitting
     * points while |y| keeps growing on the same side of the divergence.
     * @returns {{x: number, y: number}[]} in marching order
     */
    function approach(from, towards) {
        const collected = [];
        const side = branch(from);
        let inside = from;
        let outside = towards;
        for (let i = 0; i < APPROACH_STEPS; i += 1) {
            const mid = at((inside.x + outside.x) / 2);
            if (mid.x === inside.x || mid.x === outside.x) break;
            const grows =
                mid.ok &&
                branch(mid) === side &&
                Math.abs(mid.y - centerY) >= Math.abs(inside.y - centerY);
            if (grows) {
                collected.push(mid);
                inside = mid;
                if (heightOffset(mid) > OFF_SCREEN_HEIGHTS * height) break;
            } else {
                outside = mid;
            }
        }
        return collected;
    }

    /** Break the polyline across an asymptote, extending each branch into it. */
    function splitAtPole(a, b) {
        if (points < config.maxPoints) {
            approach(a, b).forEach(push);
        }
        closePath();
        startFresh();
        if (points < config.maxPoints) {
            // Marching leftwards yields decreasing x; flip so the path stays
            // monotonic in x.
            approach(b, a).reverse().forEach(push);
        }
        push(b);
    }

    /** Break the polyline across a gap in the domain. */
    function splitAtGap(a, b, invalid) {
        const leftEdge = walkToEdge(a, invalid);
        if (leftEdge) push(leftEdge);
        closePath();
        startFresh();
        const rightEdge = walkToEdge(b, invalid);
        if (rightEdge) push(rightEdge);
        push(b);
    }

    /**
     * Join two valid samples, subdividing as needed. On return the open path
     * ends at `b`.
     */
    function connect(a, b, depth) {
        const jump = Math.abs(b.sy - a.sy);
        const suspectPole = jump > POLE_JUMP_HEIGHTS * height;

        const bothFarSameSide =
            heightOffset(a) > IGNORE_HEIGHTS * height &&
            heightOffset(b) > IGNORE_HEIGHTS * height &&
            branch(a) === branch(b);

        const canSubdivide =
            depth < config.maxDepth &&
            intervalPoints < config.maxPointsPerInterval &&
            points < config.maxPoints &&
            !bothFarSameSide;

        if (!canSubdivide && !suspectPole) {
            push(b);
            return;
        }

        const xm = (a.x + b.x) / 2;
        // Floating point ran out of room between the endpoints.
        if (!(xm > a.x && xm < b.x)) {
            push(b);
            return;
        }

        const m = at(xm);

        if (!m.ok) {
            splitAtGap(a, b, m);
            return;
        }

        // A real asymptote diverges further as you approach it, which is what
        // separates `tan(x)` from a merely very steep line crossing the axis.
        if (
            suspectPole &&
            branch(a) !== branch(b) &&
            Math.abs(m.y - centerY) >=
                Math.max(Math.abs(a.y - centerY), Math.abs(b.y - centerY))
        ) {
            splitAtPole(a, b);
            return;
        }

        if (canSubdivide && deviation(a, m, b) > config.tolerance) {
            intervalPoints += 1;
            connect(a, m, depth + 1);
            connect(m, b, depth + 1);
            return;
        }

        push(b);
    }

    // -- the pixel-column sweep ----------------------------------------------

    const xStart = view.toWorldX(-config.margin);
    const xEnd = view.toWorldX(view.width + config.margin);
    const columns = Math.max(
        2,
        Math.ceil((view.width + 2 * config.margin) / config.pixelStep),
    );
    const step = (xEnd - xStart) / columns;

    let a = at(xStart);
    if (a.ok) openAt(a);

    for (let i = 1; i <= columns; i += 1) {
        const b = at(xStart + i * step);
        intervalPoints = 0;

        if (a.ok && b.ok) {
            openAt(a);
            connect(a, b, 0);
        } else if (a.ok) {
            openAt(a);
            const edge = walkToEdge(a, b);
            if (edge) push(edge);
            closePath();
        } else if (b.ok) {
            closePath();
            startFresh();
            const edge = walkToEdge(b, a);
            if (edge) push(edge);
            push(b);
        } else {
            closePath();
        }

        a = b;
    }
    closePath();

    return { paths, evaluations, points };
}

/**
 * y range covered by sampled paths, restricted to the visible x window. Used by
 * the "fit" control to frame a curve vertically.
 */
export function pathsYRange(paths, xMin, xMax) {
    let low = Infinity;
    let high = -Infinity;
    for (const path of paths) {
        for (const point of path) {
            if (point.x < xMin || point.x > xMax) continue;
            if (point.y < low) low = point.y;
            if (point.y > high) high = point.y;
        }
    }
    return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}

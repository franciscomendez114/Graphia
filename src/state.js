/**
 * Application state, plus the (de)serialisation used for autosave and for
 * shareable links.
 *
 * Nothing here touches the DOM or the canvas — it is all plain data, so it can
 * be round-tripped, tested and restored without a browser.
 */

import { Expression } from './math/expression.js';
import { Viewport } from './graph/viewport.js';
import { RULE_KEYS } from './features/riemann.js';

/**
 * Curve colours. Chosen to stay distinguishable from each other and legible on
 * both the light and dark surfaces.
 */
export const PALETTE = [
    '#2563eb', // blue
    '#dc2626', // red
    '#059669', // emerald
    '#9333ea', // violet
    '#ea580c', // orange
    '#0891b2', // cyan
    '#db2777', // pink
    '#65a30d', // lime
    '#4f46e5', // indigo
    '#b45309', // amber
];

export const MODES = ['graph', 'derivative', 'integral'];

let nextId = 1;

/**
 * @param {string} source
 * @param {string} [color]
 */
export function createCurve(source = '', color) {
    const curve = {
        id: `c${nextId++}`,
        source,
        color: color ?? PALETTE[0],
        visible: true,
        /** @type {Expression | null} */
        expression: null,
        /** @type {{message: string, position: number} | null} */
        error: null,
        /** @type {Array<Array<{x: number, y: number}>>} */
        paths: [],
        /** Sampler stats, surfaced in the debug readout. */
        stats: null,
    };
    compileCurve(curve);
    return curve;
}

/** Re-parse a curve after its text changes. Blank input is not an error. */
export function compileCurve(curve) {
    const text = curve.source.trim();
    if (text === '') {
        curve.expression = null;
        curve.error = null;
        curve.paths = [];
        return curve;
    }

    const result = Expression.tryParse(text);
    if (result.ok) {
        curve.expression = result.expression;
        curve.error = null;
    } else {
        curve.expression = null;
        curve.error = result.error;
        curve.paths = [];
    }
    return curve;
}

/** First unused palette entry, so new curves rarely repeat a colour. */
export function nextColor(curves) {
    const used = new Set(curves.map((curve) => curve.color));
    return PALETTE.find((color) => !used.has(color)) ?? PALETTE[curves.length % PALETTE.length];
}

export function createState() {
    return {
        curves: [createCurve('y = x^2', PALETTE[0])],
        /** @type {'graph' | 'derivative' | 'integral'} */
        mode: 'graph',
        /** Which curve the calculus tools act on. */
        targetId: null,
        derivative: {
            a: 1,
            h: 1,
            showSecant: true,
            showDerivativeCurve: true,
        },
        integral: {
            a: 0,
            b: 2,
            n: 8,
            rule: 'left',
        },
        showKeyPoints: true,
        view: new Viewport(),
    };
}

/** The curve the tools operate on: the chosen one, else the first plottable. */
export function targetCurve(state) {
    const chosen = state.curves.find(
        (curve) => curve.id === state.targetId && curve.expression,
    );
    if (chosen) return chosen;
    return state.curves.find((curve) => curve.expression && curve.visible) ?? null;
}

// -- persistence -------------------------------------------------------------

const STORAGE_KEY = 'graphia.session.v1';
const SCHEMA_VERSION = 1;

export function serializeState(state) {
    return {
        v: SCHEMA_VERSION,
        curves: state.curves
            .filter((curve) => curve.source.trim() !== '')
            .map((curve) => ({
                s: curve.source,
                c: curve.color,
                h: curve.visible ? undefined : 1,
            })),
        view: state.view.toJSON(),
        mode: state.mode,
        d: state.derivative,
        i: state.integral,
        k: state.showKeyPoints ? undefined : 0,
    };
}

/** Rebuild state from a snapshot, ignoring anything malformed. */
export function deserializeState(data, { width, height } = {}) {
    const state = createState();
    if (!data || data.v !== SCHEMA_VERSION) return state;

    if (Array.isArray(data.curves) && data.curves.length > 0) {
        state.curves = data.curves.slice(0, 24).map((entry, index) => {
            const curve = createCurve(
                String(entry.s ?? ''),
                typeof entry.c === 'string' && PALETTE.includes(entry.c)
                    ? entry.c
                    : PALETTE[index % PALETTE.length],
            );
            curve.visible = !entry.h;
            return curve;
        });
    }

    if (MODES.includes(data.mode)) state.mode = data.mode;
    state.view = Viewport.fromJSON(data.view, width, height);

    if (data.d) {
        if (Number.isFinite(data.d.a)) state.derivative.a = data.d.a;
        if (Number.isFinite(data.d.h) && data.d.h !== 0) state.derivative.h = data.d.h;
        state.derivative.showSecant = Boolean(data.d.showSecant);
        state.derivative.showDerivativeCurve = Boolean(data.d.showDerivativeCurve);
    }

    if (data.i) {
        if (Number.isFinite(data.i.a)) state.integral.a = data.i.a;
        if (Number.isFinite(data.i.b)) state.integral.b = data.i.b;
        if (Number.isFinite(data.i.n)) state.integral.n = clampInt(data.i.n, 1, 2000);
        if (RULE_KEYS.includes(data.i.rule)) state.integral.rule = data.i.rule;
    }

    state.showKeyPoints = data.k !== 0;
    return state;
}

function clampInt(value, low, high) {
    return Math.min(high, Math.max(low, Math.round(value)));
}

export function saveSession(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
    } catch {
        // Private browsing or a full quota — autosave is a nicety, not a feature
        // worth breaking the app over.
    }
}

export function loadSession(size) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return deserializeState(JSON.parse(raw), size);
    } catch {
        return null;
    }
}

/** `#g=<url-encoded json>` — readable, and short enough to paste. */
export function stateToHash(state) {
    return `#g=${encodeURIComponent(JSON.stringify(serializeState(state)))}`;
}

export function stateFromHash(hash, size) {
    const match = /[#&]g=([^&]+)/.exec(hash ?? '');
    if (!match) return null;
    try {
        return deserializeState(JSON.parse(decodeURIComponent(match[1])), size);
    } catch {
        return null;
    }
}

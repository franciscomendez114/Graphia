/**
 * Graphia — application entry point.
 *
 * Owns the frame loop, all pointer and keyboard input, and the overlay drawing
 * for the two calculus tools. Everything it draws with lives in ./graph, all the
 * mathematics lives in ./math, and the panels live in ./ui.
 *
 * Rendering is on demand: a frame is only produced when something has actually
 * changed. Combined with the pixel-bounded sampler that keeps interaction smooth
 * no matter how far out you zoom.
 */

import { Renderer, readTheme } from './graph/renderer.js';
import { sampleFunction, pathsYRange } from './graph/sampler.js';
import { formatCoordinate } from './graph/ticks.js';
import { findKeyPoints, nearestOnCurves } from './features/keypoints.js';
import { riemannSum } from './features/riemann.js';
import { tangentAt, secantAt, nearestDefined } from './features/tangent.js';
import { formatNumber } from './math/format.js';
import {
    createState,
    targetCurve,
    saveSession,
    loadSession,
    stateFromHash,
    stateToHash,
    MODES,
} from './state.js';
import { ExpressionList } from './ui/expressions.js';
import { ToolPanels } from './ui/tools.js';
import { ThemeToggle, createToast, setupHelp, setupSidebarToggle } from './ui/chrome.js';

const $ = (id) => document.getElementById(id);

const canvas = $('graph');
const stage = $('stage');
const workspace = $('workspace');
const readoutElement = $('readout');
const perfElement = $('perf');
const hintElement = $('stage-hint');

const renderer = new Renderer(canvas);
let theme = readTheme();

const initialSize = {
    width: stage.clientWidth || window.innerWidth,
    height: stage.clientHeight || window.innerHeight,
};

/** A shared link wins over the autosaved session. */
const state =
    stateFromHash(window.location.hash, initialSize) ??
    loadSession(initialSize) ??
    createState();

const HINTS = {
    graph: '',
    derivative: 'Drag the point along the curve — or use the slider.',
    integral: 'Drag the handles to move the interval. Shift-drag to draw a new one.',
};

// ---------------------------------------------------------------- frame loop

let frameHandle = 0;
let lastFrameMs = 0;
let lastSampleCount = 0;

function scheduleRender() {
    if (frameHandle) return;
    frameHandle = requestAnimationFrame(() => {
        frameHandle = 0;
        draw();
    });
}

/** Pointer position for the trace readout, in CSS pixels. */
let hover = null;

function draw() {
    const started = performance.now();
    const { view } = state;
    renderer.syncSize(view);
    renderer.begin(theme);
    renderer.drawGrid(view, theme);

    // 1. Sample every visible curve. This is the whole per-frame cost, and it
    //    scales with the canvas width rather than with the zoom level.
    let samples = 0;
    for (const curve of state.curves) {
        if (!curve.expression || !curve.visible) {
            curve.paths = [];
            curve.keyPoints = [];
            continue;
        }
        const result = sampleFunction(curve.expression.evaluate, view);
        curve.paths = result.paths;
        samples += result.evaluations;
        curve.keyPoints = state.showKeyPoints
            ? findKeyPoints(curve.expression, curve.paths, view)
            : [];
    }

    const target = targetCurve(state);

    // 2. Riemann fills go underneath the curves.
    if (state.mode === 'integral' && target) drawRiemann(target);

    // 3. The curves themselves.
    for (const curve of state.curves) {
        if (!curve.visible || curve.paths.length === 0) continue;
        renderer.strokePaths(view, curve.paths, {
            color: curve.color,
            width: curve === target && state.mode !== 'graph' ? 2.6 : 2.2,
        });
    }

    // 4. Tool overlays on top.
    if (state.mode === 'derivative' && target) {
        samples += drawDerivative(target);
    }
    if (state.mode === 'integral' && target) drawIntervalGuides();

    // 5. Markers and the trace readout.
    if (state.showKeyPoints) drawKeyPoints();
    drawTrace();

    lastFrameMs = performance.now() - started;
    lastSampleCount = samples;
    updatePerf();
}

// ------------------------------------------------------------------ overlays

function drawRiemann(curve) {
    const { view } = state;
    const { a, b, n, rule } = state.integral;
    const { cells } = riemannSum(curve.expression.evaluate, a, b, n, rule);
    if (cells.length === 0) return;

    const cellWidthPx = Math.abs((cells[0].x1 - cells[0].x0) * view.scaleX);
    const outline = cellWidthPx > 3 ? theme.riemannEdge : null;

    for (const cell of cells) {
        if (!Number.isFinite(cell.yLeft) || !Number.isFinite(cell.yRight)) continue;
        // Off-screen cells still cost a fill call, so skip them.
        const left = view.toScreenX(cell.x0);
        const right = view.toScreenX(cell.x1);
        if (right < -2 || left > view.width + 2) continue;

        const fill =
            cell.yLeft + cell.yRight >= 0 ? theme.riemannPositive : theme.riemannNegative;

        if (rule === 'trapezoid') {
            renderer.fillWorldPolygon(
                view,
                [
                    { x: cell.x0, y: 0 },
                    { x: cell.x0, y: cell.yLeft },
                    { x: cell.x1, y: cell.yRight },
                    { x: cell.x1, y: 0 },
                ],
                { fill, stroke: outline, width: 1 },
            );
        } else {
            renderer.fillWorldRect(view, cell.x0, cell.x1, 0, cell.yLeft, {
                fill,
                stroke: outline,
                width: 1,
            });
        }
    }

    // Show where each rule takes its sample, while there is room to see it.
    if (cells.length <= 40) {
        for (const cell of cells) {
            const x =
                rule === 'trapezoid'
                    ? null
                    : rule === 'left'
                      ? cell.x0
                      : rule === 'right'
                        ? cell.x1
                        : (cell.x0 + cell.x1) / 2;
            if (x === null) {
                renderer.drawPoint(view, cell.x0, cell.yLeft, {
                    color: curve.color,
                    radius: 2.5,
                });
                renderer.drawPoint(view, cell.x1, cell.yRight, {
                    color: curve.color,
                    radius: 2.5,
                });
            } else {
                renderer.drawPoint(view, x, cell.yLeft, { color: curve.color, radius: 2.5 });
            }
        }
    }
}

function drawIntervalGuides() {
    const { view } = state;
    const { a, b } = state.integral;

    for (const [x, label] of [
        [a, 'a'],
        [b, 'b'],
    ]) {
        renderer.strokeVerticalGuide(view, x, {
            color: theme.riemannEdge,
            width: 1.5,
            dash: [5, 4],
            handle: true,
            handleRing: theme.pointHalo,
        });
        renderer.drawTag(
            view,
            view.toScreenX(x),
            26,
            [`${label} = ${formatNumber(x, 5)}`],
            tagStyle(),
        );
    }
}

/** @returns {number} extra function evaluations spent, for the perf readout */
function drawDerivative(curve) {
    const { view } = state;
    const { a, h, showSecant, showDerivativeCurve } = state.derivative;
    const expression = curve.expression;
    let evaluations = 0;

    // f′(x) as a dashed curve — symbolic where possible, numeric otherwise.
    if (showDerivativeCurve) {
        const symbolic = expression.derivative();
        const slopeFunction = symbolic
            ? symbolic.evaluate
            : (x) => expression.slopeAt(x);
        const result = sampleFunction(slopeFunction, view);
        evaluations += result.evaluations;
        renderer.strokePaths(view, result.paths, {
            color: theme.derivativeCurve,
            width: 1.8,
            dash: [7, 5],
            alpha: 0.85,
        });
    }

    const tangent = tangentAt(expression, a);
    if (!tangent.defined) {
        renderer.drawTag(
            view,
            view.toScreenX(a),
            view.height / 2,
            [`f(${formatNumber(a, 4)}) is undefined`],
            tagStyle(),
        );
        return evaluations;
    }

    // The limit definition: secant, rise/run legs, and the moving point.
    if (showSecant) {
        const secant = secantAt(expression, a, h);
        if (secant.defined) {
            renderer.strokeInfiniteLine(view, secant.a, secant.fa, secant.slope, {
                color: theme.secant,
                width: 1.7,
                dash: [6, 4],
            });
            renderer.strokeSegment(view, secant.a, secant.fa, secant.b, secant.fa, {
                color: theme.overlayLine,
                width: 1.2,
                dash: [3, 3],
            });
            renderer.strokeSegment(view, secant.b, secant.fa, secant.b, secant.fb, {
                color: theme.overlayLine,
                width: 1.2,
                dash: [3, 3],
            });
            renderer.drawPoint(view, secant.b, secant.fb, {
                color: theme.secant,
                radius: 4,
                halo: theme.pointHalo,
            });
            // Below the run leg, so it cannot collide with the point's own tag.
            renderer.drawTag(
                view,
                view.toScreenX((secant.a + secant.b) / 2),
                view.toScreenY(secant.fa),
                [`h = ${formatNumber(secant.h, 4)}`, `slope ${formatNumber(secant.slope, 5)}`],
                { ...tagStyle(theme.secant), placement: 'below' },
            );
        }
    }

    renderer.strokeInfiniteLine(view, tangent.a, tangent.fa, tangent.slope, {
        color: theme.tangent,
        width: 2.2,
    });
    renderer.drawPoint(view, tangent.a, tangent.fa, {
        color: curve.color,
        radius: 6,
        halo: theme.pointHalo,
        ring: true,
    });
    renderer.drawTag(
        view,
        view.toScreenX(tangent.a),
        view.toScreenY(tangent.fa),
        [
            `a = ${formatNumber(tangent.a, 5)}`,
            `f(a) = ${formatNumber(tangent.fa, 5)}`,
            `f′(a) = ${formatNumber(tangent.slope, 5)}`,
        ],
        tagStyle(theme.tangent),
    );

    return evaluations;
}

const KEY_POINT_LABEL = { root: 'root', minimum: 'min', maximum: 'max' };

function drawKeyPoints() {
    const { view } = state;
    for (const curve of state.curves) {
        if (!curve.visible || !curve.keyPoints?.length) continue;
        for (const point of curve.keyPoints) {
            renderer.drawPoint(view, point.x, point.y, {
                color: curve.color,
                radius: 3.5,
                hollow: true,
                halo: theme.pointHalo,
                ringWidth: 2,
            });
        }
    }

    // Label only the marker under the pointer, so the graph stays clean.
    if (!hover) return;
    for (const curve of state.curves) {
        if (!curve.visible || !curve.keyPoints?.length) continue;
        for (const point of curve.keyPoints) {
            const sx = view.toScreenX(point.x);
            const sy = view.toScreenY(point.y);
            if (Math.hypot(sx - hover.x, sy - hover.y) > 14) continue;
            renderer.drawTag(
                view,
                sx,
                sy,
                [
                    KEY_POINT_LABEL[point.type],
                    `(${formatNumber(point.x, 5)}, ${formatNumber(point.y, 5)})`,
                ],
                tagStyle(curve.color),
            );
            return;
        }
    }
}

function drawTrace() {
    const { view } = state;
    if (!hover || drag.kind) {
        if (!drag.kind) readoutElement.textContent = '';
        return;
    }

    const found = nearestOnCurves(state.curves, view, hover.x, hover.y);
    const parts = [];

    if (found) {
        renderer.drawPoint(view, found.x, found.y, {
            color: found.curve.color,
            radius: 4.5,
            halo: theme.pointHalo,
            ring: true,
        });
        parts.push(
            swatch(found.curve.color),
            text(
                `(${formatCoordinate(found.x, view.unitsPerPixelX)}, ` +
                    `${formatCoordinate(found.y, view.unitsPerPixelY)})`,
            ),
        );
    } else {
        parts.push(
            text(
                `x = ${formatCoordinate(view.toWorldX(hover.x), view.unitsPerPixelX)}`,
                'dim',
            ),
            text(
                `y = ${formatCoordinate(view.toWorldY(hover.y), view.unitsPerPixelY)}`,
                'dim',
            ),
        );
    }

    readoutElement.replaceChildren(...parts);
}

function swatch(color) {
    const span = document.createElement('span');
    span.className = 'swatch';
    span.style.backgroundColor = color;
    return span;
}

function text(content, className) {
    const span = document.createElement('span');
    span.textContent = content;
    if (className) span.className = className;
    return span;
}

function tagStyle(accent) {
    return {
        background: theme.tagBg,
        border: accent ?? theme.tagBorder,
        color: theme.tagText,
    };
}

function updatePerf() {
    perfElement.textContent = `${lastSampleCount.toLocaleString()} samples · ${lastFrameMs.toFixed(1)} ms`;
}

// -------------------------------------------------------------- interactions

const drag = {
    /** @type {null | 'pan' | 'point' | 'interval-a' | 'interval-b'} */
    kind: null,
    pointerId: null,
    lastX: 0,
    lastY: 0,
};

/** All pointers currently down, for pinch detection. */
const pointers = new Map();
let pinch = null;

const HIT_RADIUS = 14;
/** Interval guides are grabbable anywhere along their length, within this. */
const GUIDE_HIT_RADIUS = 11;

function hitTest(screenX, screenY) {
    const { view } = state;
    const target = targetCurve(state);
    if (!target) return 'pan';

    if (state.mode === 'derivative') {
        const { a } = state.derivative;
        const fa = target.expression.evaluate(a);
        if (Number.isFinite(fa)) {
            const distance = Math.hypot(
                view.toScreenX(a) - screenX,
                view.toScreenY(fa) - screenY,
            );
            if (distance <= HIT_RADIUS + 4) return 'point';
        }
        // Grabbing the curve anywhere moves the point of tangency to there.
        const near = nearestOnCurves([target], view, screenX, screenY, 12);
        if (near) return 'point';
    }

    if (state.mode === 'integral') {
        const { a, b } = state.integral;
        const da = Math.abs(view.toScreenX(a) - screenX);
        const db = Math.abs(view.toScreenX(b) - screenX);
        if (da <= GUIDE_HIT_RADIUS && da <= db) return 'interval-a';
        if (db <= GUIDE_HIT_RADIUS) return 'interval-b';
    }

    return 'pan';
}

canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = localPoint(event);
    pointers.set(event.pointerId, point);

    if (pointers.size === 2) {
        beginPinch();
        drag.kind = null;
        canvas.classList.remove('is-panning');
        return;
    }
    if (pointers.size > 2) return;

    canvas.setPointerCapture(event.pointerId);
    drag.pointerId = event.pointerId;
    drag.lastX = point.x;
    drag.lastY = point.y;

    // Shift-drag in integral mode draws a fresh interval from scratch.
    if (event.shiftKey && state.mode === 'integral' && targetCurve(state)) {
        const worldX = state.view.toWorldX(point.x);
        state.integral.a = worldX;
        state.integral.b = worldX;
        drag.kind = 'interval-b';
    } else {
        drag.kind = hitTest(point.x, point.y);
    }

    if (drag.kind === 'pan') canvas.classList.add('is-panning');
    else applyDrag(point);

    hover = point;
    scheduleRender();
});

canvas.addEventListener('pointermove', (event) => {
    const point = localPoint(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
    hover = point;

    if (pinch) {
        updatePinch();
        scheduleRender();
        return;
    }

    if (drag.kind && event.pointerId === drag.pointerId) {
        if (drag.kind === 'pan') {
            state.view.panByPixels(point.x - drag.lastX, point.y - drag.lastY);
        } else {
            applyDrag(point);
        }
        drag.lastX = point.x;
        drag.lastY = point.y;
        scheduleRender();
        return;
    }

    updateCursor(point);
    scheduleRender();
});

for (const type of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(type, (event) => {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;

        if (event.pointerId === drag.pointerId) {
            if (drag.kind && drag.kind !== 'pan') {
                panels.update();
                persist();
            }
            drag.kind = null;
            drag.pointerId = null;
            canvas.classList.remove('is-panning');
        }
        scheduleRender();
    });
}

// Only drop the trace readout when nothing is being dragged: during a captured
// drag the pointer is allowed to wander outside the canvas.
canvas.addEventListener('pointerleave', () => {
    if (drag.kind) return;
    hover = null;
    readoutElement.textContent = '';
    scheduleRender();
});

/** Apply a non-panning drag: move the point of tangency or an interval edge. */
function applyDrag(point) {
    const { view } = state;
    const worldX = view.toWorldX(point.x);
    const target = targetCurve(state);

    if (drag.kind === 'point' && target) {
        state.derivative.a = nearestDefined(
            target.expression,
            worldX,
            view.unitsPerPixelX,
        );
    } else if (drag.kind === 'interval-a') {
        state.integral.a = worldX;
    } else if (drag.kind === 'interval-b') {
        state.integral.b = worldX;
    }
    panels.update();
}

function updateCursor(point) {
    const kind = hitTest(point.x, point.y);
    canvas.classList.toggle('is-draggable', kind === 'point');
    canvas.classList.toggle(
        'is-grabbing',
        kind === 'interval-a' || kind === 'interval-b',
    );
}

function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function beginPinch() {
    const [first, second] = [...pointers.values()];
    pinch = {
        distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
        midX: (first.x + second.x) / 2,
        midY: (first.y + second.y) / 2,
    };
}

function updatePinch() {
    if (pointers.size < 2) return;
    const [first, second] = [...pointers.values()];
    const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
    const midX = (first.x + second.x) / 2;
    const midY = (first.y + second.y) / 2;

    const factor = distance / pinch.distance;
    state.view.zoomBy(factor, factor, midX, midY);
    state.view.panByPixels(midX - pinch.midX, midY - pinch.midY);

    pinch = { distance, midX, midY };
}

canvas.addEventListener(
    'wheel',
    (event) => {
        event.preventDefault();
        const point = localPoint(event);
        // Normalise line- and page-based deltas to something pixel-like.
        const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
        const factor = Math.exp((-event.deltaY * scale) / 420);

        if (event.shiftKey) state.view.zoomBy(factor, 1, point.x, point.y);
        else if (event.altKey) state.view.zoomBy(1, factor, point.x, point.y);
        else state.view.zoomBy(factor, factor, point.x, point.y);

        hover = point;
        panels.syncRanges(state.view);
        scheduleRender();
        persist();
    },
    { passive: false },
);

canvas.addEventListener('dblclick', (event) => {
    const point = localPoint(event);
    state.view.zoomBy(1.8, 1.8, point.x, point.y);
    scheduleRender();
    persist();
});

// ------------------------------------------------------------------ controls

function zoom(factor) {
    state.view.zoomBy(factor);
    panels.syncRanges(state.view);
    scheduleRender();
    persist();
}

$('zoom-in').addEventListener('click', () => zoom(1.6));
$('zoom-out').addEventListener('click', () => zoom(1 / 1.6));

$('view-reset').addEventListener('click', () => {
    state.view.reset();
    panels.syncRanges(state.view);
    scheduleRender();
    persist();
});

$('view-square').addEventListener('click', () => {
    state.view.squareUp();
    scheduleRender();
    persist();
});

$('view-fit').addEventListener('click', fitView);

/** Frame the target curve (or the first visible one) vertically. */
function fitView() {
    const { view } = state;
    const curve = targetCurve(state) ?? state.curves.find((c) => c.visible && c.expression);
    if (!curve) return;

    const { paths } = sampleFunction(curve.expression.evaluate, view, { pixelStep: 4 });
    const range = pathsYRange(paths, view.xMin, view.xMax);
    if (!range) return;

    if (range.high - range.low < 1e-9) {
        // A constant function has no range to fit; just centre it.
        view.centerY = range.low;
    } else {
        view.fitY(range.low, range.high);
    }
    scheduleRender();
    persist();
}

window.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (event.metaKey || event.ctrlKey) return;

    const step = event.shiftKey ? 180 : 55;
    switch (event.key) {
        case '+':
        case '=':
            zoom(1.4);
            break;
        case '-':
        case '_':
            zoom(1 / 1.4);
            break;
        case 'ArrowLeft':
            state.view.panByPixels(step, 0);
            break;
        case 'ArrowRight':
            state.view.panByPixels(-step, 0);
            break;
        case 'ArrowUp':
            state.view.panByPixels(0, step);
            break;
        case 'ArrowDown':
            state.view.panByPixels(0, -step);
            break;
        case '0':
            state.view.reset();
            break;
        case 'f':
        case 'F':
            fitView();
            return;
        case 's':
        case 'S':
            state.view.squareUp();
            break;
        case '1':
            setMode('graph');
            return;
        case '2':
            setMode('derivative');
            return;
        case '3':
            setMode('integral');
            return;
        case '?':
            help.open();
            return;
        default:
            return;
    }

    event.preventDefault();
    panels.syncRanges(state.view);
    scheduleRender();
    persist();
});

// ----------------------------------------------------------------- app state

function setMode(mode) {
    if (!MODES.includes(mode) || state.mode === mode) return;
    state.mode = mode;

    for (const button of document.querySelectorAll('#modes button')) {
        button.setAttribute('aria-selected', String(button.dataset.mode === mode));
    }
    hintElement.textContent = HINTS[mode];
    hintElement.hidden = !HINTS[mode];

    panels.syncTargets();
    panels.syncRanges(state.view);
    panels.update();
    scheduleRender();
    persist();
}

for (const button of document.querySelectorAll('#modes button')) {
    button.addEventListener('click', () => setMode(button.dataset.mode));
}

$('toggle-keypoints').addEventListener('change', (event) => {
    state.showKeyPoints = event.target.checked;
    scheduleRender();
    persist();
});

/** Debounced autosave — a drag should not hit localStorage 60 times a second. */
let saveTimer = 0;
function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSession(state), 400);
}

function handleChange() {
    panels.syncTargets();
    panels.update();
    scheduleRender();
    persist();
}

const list = new ExpressionList({
    list: $('curve-list'),
    template: $('curve-row'),
    addButton: $('add-curve'),
    state,
    onChange: handleChange,
});

const panels = new ToolPanels(state, () => {
    scheduleRender();
    persist();
});

const toast = createToast($('toast'));

const help = setupHelp({
    dialog: $('help'),
    openButton: $('help-open'),
    syntaxLink: $('syntax-link'),
});

setupSidebarToggle({
    button: $('sidebar-toggle'),
    workspace,
    onToggle: scheduleRender,
});

new ThemeToggle($('theme-toggle'), () => {
    theme = readTheme();
    scheduleRender();
});

/**
 * Save the graph as a PNG.
 *
 * The canvas already holds a device-pixel-ratio-scaled bitmap, so what gets
 * written out is the same crisp image that is on screen — handy for pasting a
 * graph into a write-up.
 */
$('download').addEventListener('click', () => {
    // Draw once more first: the canvas may hold a stale frame if nothing has
    // changed since the last render, and toBlob reads the current bitmap.
    draw();
    canvas.toBlob((blob) => {
        if (!blob) {
            toast('Could not export the graph.');
            return;
        }
        const target = targetCurve(state);
        const label = (target?.source ?? 'graph')
            .replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '')
            .replace(/[^a-z0-9+^*/()-]+/gi, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40);

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `graphia-${label || 'graph'}.png`;
        link.click();
        URL.revokeObjectURL(url);
        toast('Graph saved as a PNG.');
    }, 'image/png');
});

$('share').addEventListener('click', async () => {
    const hash = stateToHash(state);
    history.replaceState(null, '', hash);
    try {
        await navigator.clipboard.writeText(window.location.href);
        toast('Link copied — it carries this whole session.');
    } catch {
        toast('Link is in the address bar — copy it from there.');
    }
});

// ---------------------------------------------------------------------- boot

new ResizeObserver(() => scheduleRender()).observe(stage);
window.addEventListener('resize', scheduleRender);

$('toggle-keypoints').checked = state.showKeyPoints;
hintElement.textContent = HINTS[state.mode];
hintElement.hidden = !HINTS[state.mode];
for (const button of document.querySelectorAll('#modes button')) {
    button.setAttribute('aria-selected', String(button.dataset.mode === state.mode));
}

renderer.syncSize(state.view);
panels.syncTargets();
panels.syncRanges(state.view);
panels.update();
list.render();
scheduleRender();

// Re-read the palette once web fonts settle, in case metrics shifted.
document.fonts?.ready.then(scheduleRender);

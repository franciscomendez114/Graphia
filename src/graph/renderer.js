/**
 * Canvas drawing.
 *
 * Curves arrive as world-space polylines from the sampler and get stroked as a
 * single path per function — one `stroke()` call instead of one `ellipse()` per
 * sample. Colours are read from CSS custom properties so the light and dark
 * themes have exactly one definition, in the stylesheet.
 */

import { axisTicks, formatTick } from './ticks.js';

/** Screen-space clamp; far enough off screen to be invisible, near enough to
 *  keep the rasteriser in comfortable numeric territory. */
const clampScreen = (value, limit) => (value < -limit ? -limit : value > limit ? limit : value);

const THEME_KEYS = [
    'surface',
    'grid-minor',
    'grid-major',
    'axis',
    'axis-label',
    'axis-label-halo',
    'riemann-positive',
    'riemann-negative',
    'riemann-edge',
    'tangent',
    'secant',
    'derivative-curve',
    'overlay-line',
    'point-halo',
    'tag-bg',
    'tag-border',
    'tag-text',
];

/** Snapshot the palette from CSS so canvas and DOM never drift apart. */
export function readTheme(element = document.documentElement) {
    const styles = getComputedStyle(element);
    const theme = {};
    for (const key of THEME_KEYS) {
        theme[toCamelCase(key)] = styles.getPropertyValue(`--c-${key}`).trim();
    }
    return theme;
}

function toCamelCase(text) {
    return text.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

export class Renderer {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = 1;
    }

    /**
     * Match the backing store to the element's CSS size and the display's pixel
     * ratio, then tell the viewport about the new size.
     * @returns {boolean} whether anything changed
     */
    syncSize(view) {
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        const dpr = Math.min(window.devicePixelRatio || 1, 3);

        const changed =
            view.width !== width || view.height !== height || this.dpr !== dpr;
        if (!changed) return false;

        this.dpr = dpr;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        view.resize(width, height);
        return true;
    }

    /** Begin a frame: reset the transform to CSS pixels and paint the surface. */
    begin(theme) {
        const { ctx } = this;
        // Tags placed this frame, so later ones can avoid earlier ones.
        this.tagRects = [];
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = theme.surface;
        ctx.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'butt';
    }

    get clampLimit() {
        return Math.max(20000, this.canvas.height * 50);
    }

    // -- grid -----------------------------------------------------------------

    drawGrid(view, theme, { showLabels = true } = {}) {
        const { ctx } = this;
        const xt = axisTicks(view.xMin, view.xMax, view.width);
        const yt = axisTicks(view.yMin, view.yMax, view.height);

        // Minor lines, then major lines: two paths, two strokes.
        ctx.lineWidth = 1;
        ctx.strokeStyle = theme.gridMinor;
        ctx.beginPath();
        for (const value of xt.minor) {
            const x = crisp(view.toScreenX(value));
            ctx.moveTo(x, 0);
            ctx.lineTo(x, view.height);
        }
        for (const value of yt.minor) {
            const y = crisp(view.toScreenY(value));
            ctx.moveTo(0, y);
            ctx.lineTo(view.width, y);
        }
        ctx.stroke();

        ctx.strokeStyle = theme.gridMajor;
        ctx.beginPath();
        for (const value of xt.major) {
            const x = crisp(view.toScreenX(value));
            ctx.moveTo(x, 0);
            ctx.lineTo(x, view.height);
        }
        for (const value of yt.major) {
            const y = crisp(view.toScreenY(value));
            ctx.moveTo(0, y);
            ctx.lineTo(view.width, y);
        }
        ctx.stroke();

        // Axes.
        const axisY = view.toScreenY(0);
        const axisX = view.toScreenX(0);
        ctx.strokeStyle = theme.axis;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (axisY >= 0 && axisY <= view.height) {
            ctx.moveTo(0, crisp(axisY));
            ctx.lineTo(view.width, crisp(axisY));
        }
        if (axisX >= 0 && axisX <= view.width) {
            ctx.moveTo(crisp(axisX), 0);
            ctx.lineTo(crisp(axisX), view.height);
        }
        ctx.stroke();

        if (showLabels) this.drawAxisLabels(view, theme, xt, yt, axisX, axisY);
    }

    /**
     * Numbers sit on their axis, and follow the edge of the screen when that
     * axis is panned out of view, so you never lose your bearings.
     */
    drawAxisLabels(view, theme, xt, yt, axisX, axisY) {
        const { ctx } = this;
        ctx.font = '500 11.5px ui-sans-serif, -apple-system, "Segoe UI", sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = theme.axisLabelHalo;
        ctx.fillStyle = theme.axisLabel;

        const labelY = clampScreen2(axisY, 16, view.height - 6);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const value of xt.major) {
            if (value === 0 && axisX >= 0 && axisX <= view.width) continue;
            const x = view.toScreenX(value);
            if (x < 14 || x > view.width - 14) continue;
            const text = formatTick(value, xt.step);
            ctx.strokeText(text, x, labelY + 5);
            ctx.fillText(text, x, labelY + 5);
        }

        const labelX = clampScreen2(axisX, 8, view.width - 8);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const value of yt.major) {
            if (value === 0) continue;
            const y = view.toScreenY(value);
            if (y < 10 || y > view.height - 10) continue;
            const text = formatTick(value, yt.step);
            const tx = labelX < 40 ? labelX + 6 + ctx.measureText(text).width : labelX - 6;
            ctx.strokeText(text, tx, y);
            ctx.fillText(text, tx, y);
        }

        // Origin marker, only when both axes are actually on screen.
        if (
            axisX >= 0 &&
            axisX <= view.width &&
            axisY >= 0 &&
            axisY <= view.height
        ) {
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.strokeText('0', axisX - 5, axisY + 4);
            ctx.fillText('0', axisX - 5, axisY + 4);
        }
    }

    // -- curves ---------------------------------------------------------------

    /**
     * @param {Array<Array<{x: number, y: number}>>} paths world-space polylines
     * @param {{color: string, width?: number, dash?: number[], alpha?: number}} style
     */
    strokePaths(view, paths, style) {
        const { ctx } = this;
        const limit = this.clampLimit;

        ctx.save();
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width ?? 2.2;
        ctx.globalAlpha = style.alpha ?? 1;
        if (style.dash) ctx.setLineDash(style.dash);
        ctx.lineCap = 'round';

        ctx.beginPath();
        for (const path of paths) {
            if (path.length < 2) continue;
            for (let i = 0; i < path.length; i += 1) {
                const point = path[i];
                const x = view.toScreenX(point.x);
                const y = clampScreen(view.toScreenY(point.y), limit);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    /** Straight line through two world points, extended across the viewport. */
    strokeInfiniteLine(view, x0, y0, slope, style) {
        const { ctx } = this;
        const limit = this.clampLimit;
        const leftX = view.xMin;
        const rightX = view.xMax;

        ctx.save();
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width ?? 2;
        if (style.dash) ctx.setLineDash(style.dash);
        ctx.beginPath();
        ctx.moveTo(
            view.toScreenX(leftX),
            clampScreen(view.toScreenY(y0 + slope * (leftX - x0)), limit),
        );
        ctx.lineTo(
            view.toScreenX(rightX),
            clampScreen(view.toScreenY(y0 + slope * (rightX - x0)), limit),
        );
        ctx.stroke();
        ctx.restore();
    }

    strokeSegment(view, ax, ay, bx, by, style) {
        const { ctx } = this;
        const limit = this.clampLimit;
        ctx.save();
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width ?? 1.5;
        if (style.dash) ctx.setLineDash(style.dash);
        ctx.globalAlpha = style.alpha ?? 1;
        ctx.beginPath();
        ctx.moveTo(view.toScreenX(ax), clampScreen(view.toScreenY(ay), limit));
        ctx.lineTo(view.toScreenX(bx), clampScreen(view.toScreenY(by), limit));
        ctx.stroke();
        ctx.restore();
    }

    /** Filled world-space rectangle spanning y=0 to y=height. */
    fillWorldRect(view, x0, x1, y0, y1, style) {
        const { ctx } = this;
        const limit = this.clampLimit;
        const left = view.toScreenX(x0);
        const right = view.toScreenX(x1);
        const top = clampScreen(view.toScreenY(Math.max(y0, y1)), limit);
        const bottom = clampScreen(view.toScreenY(Math.min(y0, y1)), limit);

        ctx.save();
        if (style.fill) {
            ctx.fillStyle = style.fill;
            ctx.fillRect(left, top, right - left, bottom - top);
        }
        if (style.stroke && right - left > 1.5) {
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = style.width ?? 1;
            ctx.strokeRect(
                crisp(left),
                crisp(top),
                Math.round(right - left),
                Math.round(bottom - top),
            );
        }
        ctx.restore();
    }

    /** Filled polygon in world coordinates — used for trapezoid rules. */
    fillWorldPolygon(view, points, style) {
        const { ctx } = this;
        const limit = this.clampLimit;
        if (points.length < 3) return;

        ctx.save();
        ctx.beginPath();
        points.forEach((point, index) => {
            const x = view.toScreenX(point.x);
            const y = clampScreen(view.toScreenY(point.y), limit);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.closePath();
        if (style.fill) {
            ctx.fillStyle = style.fill;
            ctx.fill();
        }
        if (style.stroke) {
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = style.width ?? 1;
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Vertical guide with an optional handle, for interval boundaries. */
    strokeVerticalGuide(view, x, style) {
        const { ctx } = this;
        const sx = crisp(view.toScreenX(x));
        ctx.save();
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width ?? 1.5;
        if (style.dash) ctx.setLineDash(style.dash);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, view.height);
        ctx.stroke();

        if (style.handle) {
            const y = clampScreen2(view.toScreenY(0), 22, view.height - 22);
            ctx.setLineDash([]);
            ctx.fillStyle = style.color;
            ctx.beginPath();
            ctx.arc(sx, y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = style.handleRing ?? '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    }

    drawPoint(view, x, y, style) {
        const { ctx } = this;
        const sx = view.toScreenX(x);
        const sy = view.toScreenY(y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
        const radius = style.radius ?? 5;

        ctx.save();
        if (style.halo) {
            ctx.fillStyle = style.halo;
            ctx.beginPath();
            ctx.arc(sx, sy, radius + 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = style.hollow ? (style.halo ?? '#fff') : style.color;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
        if (style.hollow || style.ring) {
            ctx.strokeStyle = style.color;
            ctx.lineWidth = style.ringWidth ?? 2.5;
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Small label with a rounded backing plate, kept inside the viewport. */
    drawTag(view, screenX, screenY, lines, style) {
        const { ctx } = this;
        ctx.save();
        ctx.font = style.font ?? '600 12px ui-sans-serif, -apple-system, sans-serif';
        const paddingX = 7;
        const paddingY = 5;
        const lineHeight = 15;
        const width =
            Math.max(...lines.map((line) => ctx.measureText(line).width)) + paddingX * 2;
        const height = lines.length * lineHeight + paddingY * 2;

        let x = screenX + 12;
        let y = style.placement === 'below' ? screenY + 14 : screenY - height - 12;
        if (x + width > view.width - 6) x = screenX - width - 12;
        if (x < 6) x = 6;
        if (y < 6) y = screenY + 14;
        if (y + height > view.height - 6) y = Math.max(6, view.height - height - 6);

        // Slide clear of tags already placed this frame. Near a viewport edge
        // both preferred positions can collapse onto the same spot, and two
        // overlapping labels are worse than one slightly displaced.
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const clash = (this.tagRects ?? []).find(
                (rect) =>
                    x < rect.x + rect.width + 4 &&
                    x + width + 4 > rect.x &&
                    y < rect.y + rect.height + 4 &&
                    y + height + 4 > rect.y,
            );
            if (!clash) break;
            const below = clash.y + clash.height + 6;
            const above = clash.y - height - 6;
            y = below + height <= view.height - 6 ? below : Math.max(6, above);
        }
        (this.tagRects ??= []).push({ x, y, width, height });

        roundedRect(ctx, x, y, width, height, 7);
        ctx.fillStyle = style.background;
        ctx.fill();
        if (style.border) {
            ctx.strokeStyle = style.border;
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        ctx.fillStyle = style.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((line, index) => {
            ctx.fillText(line, x + paddingX, y + paddingY + index * lineHeight + 1);
        });
        ctx.restore();
    }
}

/** Align a 1px line to the pixel grid so it renders sharp, not smeared. */
function crisp(value) {
    return Math.round(value) + 0.5;
}

function clampScreen2(value, low, high) {
    return Math.min(high, Math.max(low, value));
}

function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}

/**
 * The camera.
 *
 * This is the single most important change from the original version of Graphia.
 * Before, every curve was stored as a list of *screen* coordinates, so zooming
 * meant rebuilding hundreds of thousands of points and panning meant translating
 * all of them. Here the curves live in world coordinates and the viewport is the
 * only thing that knows about pixels, so panning and zooming are two multiplies
 * per point and cost nothing.
 *
 * x and y scale independently, which is what makes something like `y = 500x²`
 * usable without fighting the aspect ratio.
 */

const MIN_SCALE = 1e-9;
const MAX_SCALE = 1e9;
const MAX_CENTER = 1e12;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export class Viewport {
    constructor(options = {}) {
        this.centerX = options.centerX ?? 0;
        this.centerY = options.centerY ?? 0;
        this.scaleX = options.scaleX ?? 64;
        this.scaleY = options.scaleY ?? 64;
        /** Canvas size in CSS pixels. */
        this.width = options.width ?? 1;
        this.height = options.height ?? 1;
    }

    resize(width, height) {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
    }

    // -- coordinate transforms ------------------------------------------------

    toScreenX(x) {
        return (x - this.centerX) * this.scaleX + this.width / 2;
    }

    /** Screen y grows downwards, so the sign flips here. */
    toScreenY(y) {
        return this.height / 2 - (y - this.centerY) * this.scaleY;
    }

    toWorldX(screenX) {
        return (screenX - this.width / 2) / this.scaleX + this.centerX;
    }

    toWorldY(screenY) {
        return (this.height / 2 - screenY) / this.scaleY + this.centerY;
    }

    /** World-space size of one pixel — the sampler's natural step. */
    get unitsPerPixelX() {
        return 1 / this.scaleX;
    }

    get unitsPerPixelY() {
        return 1 / this.scaleY;
    }

    // -- visible bounds -------------------------------------------------------

    get xMin() {
        return this.toWorldX(0);
    }

    get xMax() {
        return this.toWorldX(this.width);
    }

    get yMin() {
        return this.toWorldY(this.height);
    }

    get yMax() {
        return this.toWorldY(0);
    }

    // -- movement -------------------------------------------------------------

    /** Drag the world with the pointer. */
    panByPixels(dx, dy) {
        this.centerX = clamp(this.centerX - dx / this.scaleX, -MAX_CENTER, MAX_CENTER);
        this.centerY = clamp(this.centerY + dy / this.scaleY, -MAX_CENTER, MAX_CENTER);
    }

    panByWorld(dx, dy) {
        this.centerX = clamp(this.centerX + dx, -MAX_CENTER, MAX_CENTER);
        this.centerY = clamp(this.centerY + dy, -MAX_CENTER, MAX_CENTER);
    }

    /**
     * Zoom while keeping the world point under (anchorX, anchorY) pinned to that
     * pixel — the behaviour that makes wheel and pinch zoom feel right.
     *
     * @param {number} factorX >1 zooms in
     * @param {number} factorY
     * @param {number} [anchorX] screen x, defaults to the centre
     * @param {number} [anchorY] screen y
     */
    zoomBy(factorX, factorY = factorX, anchorX = this.width / 2, anchorY = this.height / 2) {
        const worldX = this.toWorldX(anchorX);
        const worldY = this.toWorldY(anchorY);

        this.scaleX = clamp(this.scaleX * factorX, MIN_SCALE, MAX_SCALE);
        this.scaleY = clamp(this.scaleY * factorY, MIN_SCALE, MAX_SCALE);

        // Re-centre so the anchor lands back where it started.
        this.centerX = clamp(worldX - (anchorX - this.width / 2) / this.scaleX, -MAX_CENTER, MAX_CENTER);
        this.centerY = clamp(worldY + (anchorY - this.height / 2) / this.scaleY, -MAX_CENTER, MAX_CENTER);
    }

    /** True when the axes are at equal scale (a circle looks like a circle). */
    get isSquare() {
        return Math.abs(this.scaleX - this.scaleY) < 1e-9 * this.scaleX;
    }

    /** Force equal x and y scale, keeping the x range. */
    squareUp() {
        this.scaleY = this.scaleX;
    }

    reset() {
        this.centerX = 0;
        this.centerY = 0;
        this.scaleX = 64;
        this.scaleY = 64;
    }

    /**
     * Frame a y range: centre it and pick the y scale so it fills `fill` of the
     * height. Used by the "fit" control.
     */
    fitY(yLow, yHigh, fill = 0.82) {
        if (!Number.isFinite(yLow) || !Number.isFinite(yHigh)) return;
        const span = Math.max(yHigh - yLow, 1e-12);
        this.centerY = (yLow + yHigh) / 2;
        this.scaleY = clamp((this.height * fill) / span, MIN_SCALE, MAX_SCALE);
    }

    /** Compact form for URL sharing and localStorage. */
    toJSON() {
        return {
            cx: this.centerX,
            cy: this.centerY,
            sx: this.scaleX,
            sy: this.scaleY,
        };
    }

    static fromJSON(data, width, height) {
        const view = new Viewport({ width, height });
        if (!data) return view;
        if (Number.isFinite(data.cx)) view.centerX = clamp(data.cx, -MAX_CENTER, MAX_CENTER);
        if (Number.isFinite(data.cy)) view.centerY = clamp(data.cy, -MAX_CENTER, MAX_CENTER);
        if (Number.isFinite(data.sx)) view.scaleX = clamp(data.sx, MIN_SCALE, MAX_SCALE);
        if (Number.isFinite(data.sy)) view.scaleY = clamp(data.sy, MIN_SCALE, MAX_SCALE);
        return view;
    }

    /** Cheap change-detection key so work can be skipped between frames. */
    get signature() {
        return `${this.centerX},${this.centerY},${this.scaleX},${this.scaleY},${this.width},${this.height}`;
    }
}

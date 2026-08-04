/**
 * Grid tick selection.
 *
 * The original grid walked a fixed ±6000 pixel range in 20px steps and labelled
 * every fourth line, which meant the numbers on the axes drifted out of step
 * with the actual zoom level. This picks steps from the familiar 1-2-5 sequence
 * so labels are always round numbers, and only ever generates the ticks that are
 * actually on screen.
 */

/** Round a rough spacing up to the nearest 1, 2 or 5 times a power of ten. */
export function niceStep(rough) {
    if (!(rough > 0) || !Number.isFinite(rough)) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const normalised = rough / magnitude;
    let multiplier;
    if (normalised <= 1) multiplier = 1;
    else if (normalised <= 2) multiplier = 2;
    else if (normalised <= 5) multiplier = 5;
    else multiplier = 10;
    return multiplier * magnitude;
}

/** How many minor divisions look right inside one major step. */
function minorDivisions(step) {
    const normalised = step / 10 ** Math.floor(Math.log10(step));
    // 2 splits into halves nicely, 1 and 5 into fifths.
    return Math.abs(normalised - 2) < 1e-9 ? 4 : 5;
}

const MAX_TICKS = 400;

/**
 * @param {number} min world coordinate at one edge
 * @param {number} max world coordinate at the other
 * @param {number} pixelSpan length of the axis in pixels
 * @param {number} targetSpacing desired pixels between labelled lines
 * @returns {{step: number, minorStep: number, major: number[], minor: number[]}}
 */
export function axisTicks(min, max, pixelSpan, targetSpacing = 90) {
    const span = max - min;
    if (!(span > 0) || !Number.isFinite(span)) {
        return { step: 1, minorStep: 0.2, major: [], minor: [] };
    }

    const step = niceStep((span / Math.max(pixelSpan, 1)) * targetSpacing);
    const divisions = minorDivisions(step);
    const minorStep = step / divisions;

    const major = [];
    const first = Math.ceil(min / step) * step;
    for (let value = first, guard = 0; value <= max && guard < MAX_TICKS; value += step, guard += 1) {
        // Re-derive from an integer index to stop floating point drift from
        // turning 0.30000000000000004 into a label.
        major.push(roundToStep(value, step));
    }

    const minor = [];
    const firstMinor = Math.ceil(min / minorStep) * minorStep;
    for (
        let value = firstMinor, guard = 0;
        value <= max && guard < MAX_TICKS * 6;
        value += minorStep, guard += 1
    ) {
        minor.push(roundToStep(value, minorStep));
    }

    return { step, minorStep, major, minor };
}

/** Snap a value onto its step grid, killing accumulated floating point error. */
function roundToStep(value, step) {
    const snapped = Math.round(value / step) * step;
    return Object.is(snapped, -0) ? 0 : snapped;
}

const SUPERSCRIPT = {
    0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴',
    5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
    '-': '⁻',
};

/**
 * Axis label for `value`, with the number of decimals implied by `step` so
 * neighbouring labels are consistent (0.25, 0.50, 0.75 — never 0.25, 0.5, 0.75).
 */
export function formatTick(value, step) {
    if (value === 0) return '0';

    const magnitude = Math.abs(value);
    if (magnitude >= 1e6 || magnitude < 1e-4) {
        const exponent = Math.floor(Math.log10(magnitude));
        const mantissa = value / 10 ** exponent;
        const mantissaText = Number(mantissa.toFixed(2)).toString();
        const exponentText = String(exponent)
            .split('')
            .map((ch) => SUPERSCRIPT[ch] ?? ch)
            .join('');
        // A mantissa of ±1 is written as 10ⁿ rather than 1×10ⁿ.
        if (mantissaText === '1') return `10${exponentText}`;
        if (mantissaText === '-1') return `-10${exponentText}`;
        return `${mantissaText}×10${exponentText}`;
    }

    const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(step) + 1e-9)));
    return value.toFixed(decimals);
}

/** Readable coordinate for the cursor readout, where precision follows zoom. */
export function formatCoordinate(value, unitsPerPixel) {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return '0';
    const magnitude = Math.abs(value);
    if (magnitude >= 1e7 || magnitude < 1e-6) return value.toExponential(3);
    // Two extra digits beyond pixel resolution keeps the readout stable while
    // still showing meaningful precision at every zoom level.
    const decimals = Math.max(0, Math.min(12, Math.ceil(-Math.log10(unitsPerPixel)) + 2));
    return trimZeros(value.toFixed(decimals));
}

function trimZeros(text) {
    return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

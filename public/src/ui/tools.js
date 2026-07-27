/**
 * The derivative and integral panels.
 *
 * The markup lives in index.html; this module binds it to state and writes the
 * readouts back. Nothing here draws — app.js owns the canvas overlays.
 */

import { formatNumber } from '../math/format.js';
import { targetCurve } from '../state.js';
import { riemannSum, exactIntegral, convergenceTable, RULES } from '../features/riemann.js';
import { tangentAt, secantAt, differenceQuotients } from '../features/tangent.js';

const $ = (id) => document.getElementById(id);

/** Format for a readout cell, with an em dash for undefined values. */
const value = (n, digits = 6) => (Number.isFinite(n) ? formatNumber(n, digits) : '—');

export class ToolPanels {
    /**
     * @param {object} state
     * @param {() => void} onChange
     */
    constructor(state, onChange) {
        this.state = state;
        this.onChange = onChange;

        this.derivativePanel = $('derivative-panel');
        this.integralPanel = $('integral-panel');

        this.elements = {
            derivativeTarget: $('derivative-target'),
            derivativeOf: $('derivative-of'),
            derivativeExpression: $('derivative-expression'),
            a: $('derivative-a'),
            aNumber: $('derivative-a-number'),
            aValue: $('derivative-a-value'),
            fa: $('stat-fa'),
            slope: $('stat-slope'),
            tangent: $('stat-tangent'),
            showCurve: $('derivative-show-curve'),
            showSecant: $('derivative-show-secant'),
            secantSection: $('secant-section'),
            h: $('derivative-h'),
            hValue: $('derivative-h-value'),
            secant: $('stat-secant'),
            secantError: $('stat-secant-error'),
            quotientTable: $('quotient-table').querySelector('tbody'),

            integralTarget: $('integral-target'),
            integralOf: $('integral-of'),
            integralALabel: $('integral-a-label'),
            integralBLabel: $('integral-b-label'),
            intervalA: $('integral-a'),
            intervalB: $('integral-b'),
            rule: $('integral-rule'),
            n: $('integral-n'),
            nNumber: $('integral-n-number'),
            nValue: $('integral-n-value'),
            dx: $('stat-dx'),
            approx: $('stat-approx'),
            exact: $('stat-exact'),
            error: $('stat-error'),
            convergenceTable: $('convergence-table').querySelector('tbody'),
        };

        this.bind();
    }

    bind() {
        const { elements: el } = this;
        const state = this.state;

        for (const select of [el.derivativeTarget, el.integralTarget]) {
            select.addEventListener('change', () => {
                state.targetId = select.value;
                this.update();
                this.onChange();
            });
        }

        // -- derivative
        el.a.addEventListener('input', () => {
            state.derivative.a = Number(el.a.value);
            this.update();
            this.onChange();
        });

        el.aNumber.addEventListener('input', () => {
            const next = Number(el.aNumber.value);
            if (Number.isFinite(next)) {
                state.derivative.a = next;
                this.update();
                this.onChange();
            }
        });

        // The h slider is logarithmic: the interesting range spans three orders
        // of magnitude, and a linear slider would spend all its travel above 0.1.
        el.h.addEventListener('input', () => {
            state.derivative.h = 10 ** Number(el.h.value);
            this.update();
            this.onChange();
        });

        el.showCurve.addEventListener('change', () => {
            state.derivative.showDerivativeCurve = el.showCurve.checked;
            this.onChange();
        });

        el.showSecant.addEventListener('change', () => {
            state.derivative.showSecant = el.showSecant.checked;
            this.update();
            this.onChange();
        });

        // -- integral
        el.intervalA.addEventListener('input', () => {
            const next = Number(el.intervalA.value);
            if (Number.isFinite(next)) {
                state.integral.a = next;
                this.update();
                this.onChange();
            }
        });

        el.intervalB.addEventListener('input', () => {
            const next = Number(el.intervalB.value);
            if (Number.isFinite(next)) {
                state.integral.b = next;
                this.update();
                this.onChange();
            }
        });

        el.rule.addEventListener('change', () => {
            state.integral.rule = el.rule.value;
            this.update();
            this.onChange();
        });

        el.n.addEventListener('input', () => {
            state.integral.n = sliderToCount(Number(el.n.value));
            this.update();
            this.onChange();
        });

        el.nNumber.addEventListener('input', () => {
            const next = Math.round(Number(el.nNumber.value));
            if (Number.isFinite(next) && next >= 1) {
                state.integral.n = Math.min(2000, next);
                this.update();
                this.onChange();
            }
        });
    }

    /** Show the panel that matches the current mode. */
    syncMode() {
        this.derivativePanel.hidden = this.state.mode !== 'derivative';
        this.integralPanel.hidden = this.state.mode !== 'integral';
    }

    /** Rebuild the function pickers from the plottable curves. */
    syncTargets() {
        const options = this.state.curves
            .filter((curve) => curve.expression)
            .map((curve, index) => ({
                id: curve.id,
                label: `${curve.source.trim() || `f${index + 1}`}`,
            }));

        const active = targetCurve(this.state);

        for (const select of [
            this.elements.derivativeTarget,
            this.elements.integralTarget,
        ]) {
            const previous = select.value;
            select.textContent = '';
            if (options.length === 0) {
                const option = document.createElement('option');
                option.textContent = 'No function yet';
                option.value = '';
                select.append(option);
                select.disabled = true;
            } else {
                select.disabled = false;
                for (const item of options) {
                    const option = document.createElement('option');
                    option.value = item.id;
                    option.textContent = item.label;
                    select.append(option);
                }
            }
            const wanted = active?.id ?? previous;
            if (options.some((item) => item.id === wanted)) select.value = wanted;
        }
    }

    /**
     * Keep the `a` slider spanning what is actually on screen, so it stays
     * useful at every zoom level instead of being stuck at ±10.
     */
    syncRanges(view) {
        const { a } = this.elements;
        const span = view.xMax - view.xMin;
        a.min = String(view.xMin);
        a.max = String(view.xMax);
        a.step = String(span / 600);
        a.value = String(this.state.derivative.a);
    }

    /** Recompute and write every readout for the visible panel. */
    update() {
        this.syncMode();
        if (this.state.mode === 'derivative') this.updateDerivative();
        if (this.state.mode === 'integral') this.updateIntegral();
    }

    updateDerivative() {
        const { elements: el, state } = this;
        const curve = targetCurve(state);
        const { a } = state.derivative;

        setNumberIfIdle(el.aNumber, a);
        el.aValue.textContent = formatNumber(a, 5);
        if (document.activeElement !== el.a) el.a.value = String(a);

        el.hValue.textContent = formatNumber(state.derivative.h, 4);
        el.showCurve.checked = state.derivative.showDerivativeCurve;
        el.showSecant.checked = state.derivative.showSecant;
        el.secantSection.hidden = !state.derivative.showSecant;

        if (!curve) {
            el.derivativeOf.textContent = '—';
            el.derivativeExpression.textContent = '—';
            el.fa.textContent = '—';
            el.slope.textContent = '—';
            el.tangent.textContent = '—';
            el.secant.textContent = '—';
            el.secantError.textContent = '—';
            el.quotientTable.textContent = '';
            return;
        }

        const expression = curve.expression;
        el.derivativeOf.textContent = expression.toString({ superscripts: true });

        const symbolic = expression.derivative();
        el.derivativeExpression.textContent = symbolic
            ? symbolic.toString({ superscripts: true })
            : 'no closed form — using a limit';
        el.derivativeExpression.style.color = symbolic ? '' : 'var(--text-faint)';

        const tangent = tangentAt(expression, a);
        el.fa.textContent = value(tangent.fa);
        el.slope.textContent = value(tangent.slope);
        el.tangent.textContent = tangent.defined
            ? tangentEquation(tangent)
            : 'undefined here';

        if (state.derivative.showSecant) {
            const secant = secantAt(expression, a, state.derivative.h);
            el.secant.textContent = value(secant.slope);
            el.secantError.textContent = secant.defined
                ? value(Math.abs(secant.slope - tangent.slope))
                : '—';

            const rows = differenceQuotients(expression, a);
            el.quotientTable.textContent = '';
            for (const row of rows) {
                const tr = document.createElement('tr');
                tr.append(
                    cell(formatNumber(row.h, 4)),
                    cell(value(row.slope, 7)),
                    cell(value(row.error, 3)),
                );
                if (Math.abs(row.h - state.derivative.h) < 1e-9) tr.className = 'is-current';
                el.quotientTable.append(tr);
            }
        }
    }

    updateIntegral() {
        const { elements: el, state } = this;
        const curve = targetCurve(state);
        const { a, b, n, rule } = state.integral;

        setNumberIfIdle(el.intervalA, a);
        setNumberIfIdle(el.intervalB, b);
        setNumberIfIdle(el.nNumber, n);
        if (document.activeElement !== el.n) el.n.value = String(countToSlider(n));
        el.nValue.textContent = String(n);
        el.rule.value = rule;
        el.integralALabel.textContent = formatNumber(a, 4);
        el.integralBLabel.textContent = formatNumber(b, 4);

        if (!curve) {
            el.integralOf.textContent = '—';
            el.dx.textContent = '—';
            el.approx.textContent = '—';
            el.exact.textContent = '—';
            el.error.textContent = '—';
            el.convergenceTable.textContent = '';
            return;
        }

        const f = curve.expression.evaluate;
        el.integralOf.textContent = curve.expression.toString({ superscripts: true });

        const { sum, dx } = riemannSum(f, a, b, n, rule);
        const exact = exactIntegral(f, a, b);

        el.dx.textContent = value(dx, 5);
        el.approx.textContent = value(sum, 8);
        el.exact.textContent = Number.isFinite(exact)
            ? formatNumber(exact, 10)
            : 'not integrable here';
        el.error.textContent = Number.isFinite(exact) ? value(sum - exact, 4) : '—';

        const rows = convergenceTable(f, a, b, rule);
        el.convergenceTable.textContent = '';
        for (const row of rows) {
            const tr = document.createElement('tr');
            tr.append(
                cell(String(row.n)),
                cell(value(row.sum, 7)),
                cell(value(row.error, 3)),
            );
            if (row.n === n) tr.className = 'is-current';
            el.convergenceTable.append(tr);
        }
        // Keep the wording honest about what is being drawn.
        el.rule.title = RULES[rule].label;
    }
}

/**
 * The rectangle-count slider is logarithmic: one sweep covers n = 1 to 1000,
 * which is the range where you can actually watch a Riemann sum converge. A
 * linear slider would spend nine tenths of its travel between 100 and 1000,
 * where nothing visibly changes any more.
 */
const sliderToCount = (value) => Math.min(1000, Math.max(1, Math.round(10 ** (value / 100))));
const countToSlider = (count) => Math.round(100 * Math.log10(Math.max(1, count)));

function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

/** Never overwrite a field the user is currently typing into. */
function setNumberIfIdle(input, next) {
    if (document.activeElement === input) return;
    const rounded = Number(formatNumber(next, 8));
    if (Number(input.value) !== rounded) input.value = String(rounded);
}

function tangentEquation({ a, fa, slope }) {
    const intercept = fa - slope * a;
    const sign = intercept < 0 ? '−' : '+';
    const magnitude = formatNumber(Math.abs(intercept), 5);
    if (Math.abs(intercept) < 1e-12) return `y = ${formatNumber(slope, 5)}x`;
    return `y = ${formatNumber(slope, 5)}x ${sign} ${magnitude}`;
}

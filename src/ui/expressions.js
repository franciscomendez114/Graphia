/**
 * The function list.
 *
 * Rows are cloned from the <template> in index.html and reconciled against
 * state by id, so typing never rebuilds the element you are typing into.
 */

import { PALETTE, createCurve, compileCurve, nextColor } from '../state.js';

export class ExpressionList {
    /**
     * @param {object} options
     * @param {HTMLElement} options.list the <ul>
     * @param {HTMLTemplateElement} options.template
     * @param {HTMLButtonElement} options.addButton
     * @param {object} options.state
     * @param {() => void} options.onChange called whenever anything changes
     */
    constructor({ list, template, addButton, state, onChange }) {
        this.list = list;
        this.template = template;
        this.state = state;
        this.onChange = onChange;
        /** @type {Map<string, HTMLElement>} */
        this.rows = new Map();

        addButton.addEventListener('click', () => this.addCurve());
        this.render();
    }

    addCurve(source = '') {
        const curve = createCurve(source, nextColor(this.state.curves));
        this.state.curves.push(curve);
        this.render();
        this.focus(curve.id);
        this.onChange();
        return curve;
    }

    focus(id) {
        const row = this.rows.get(id);
        row?.querySelector('.expr-input')?.focus();
    }

    /** Sync the DOM with state.curves. */
    render() {
        const seen = new Set();

        this.state.curves.forEach((curve, index) => {
            seen.add(curve.id);
            let row = this.rows.get(curve.id);
            if (!row) {
                row = this.createRow(curve);
                this.rows.set(curve.id, row);
            }
            if (this.list.children[index] !== row) {
                this.list.insertBefore(row, this.list.children[index] ?? null);
            }
            this.updateRow(row, curve);
        });

        for (const [id, row] of this.rows) {
            if (!seen.has(id)) {
                row.remove();
                this.rows.delete(id);
            }
        }
    }

    createRow(curve) {
        const row = this.template.content.firstElementChild.cloneNode(true);
        const input = row.querySelector('.expr-input');
        const chip = row.querySelector('.color-chip');
        const visibility = row.querySelector('.toggle-visible');
        const remove = row.querySelector('.remove-curve');

        input.addEventListener('input', () => {
            curve.source = input.value;
            compileCurve(curve);
            this.updateRow(row, curve);
            this.onChange();
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                const index = this.state.curves.indexOf(curve);
                const created = createCurve('', nextColor(this.state.curves));
                this.state.curves.splice(index + 1, 0, created);
                this.render();
                this.focus(created.id);
                this.onChange();
            }
            if (
                (event.key === 'Backspace' || event.key === 'Delete') &&
                input.value === '' &&
                this.state.curves.length > 1
            ) {
                event.preventDefault();
                const index = this.state.curves.indexOf(curve);
                this.removeCurve(curve);
                const neighbour = this.state.curves[index - 1] ?? this.state.curves[0];
                if (neighbour) this.focus(neighbour.id);
            }
        });

        chip.addEventListener('click', () => {
            const index = PALETTE.indexOf(curve.color);
            curve.color = PALETTE[(index + 1) % PALETTE.length];
            this.updateRow(row, curve);
            this.onChange();
        });

        visibility.addEventListener('click', () => {
            curve.visible = !curve.visible;
            this.updateRow(row, curve);
            this.onChange();
        });

        remove.addEventListener('click', () => this.removeCurve(curve));

        return row;
    }

    removeCurve(curve) {
        const index = this.state.curves.indexOf(curve);
        if (index < 0) return;
        this.state.curves.splice(index, 1);
        // Always leave one empty row so there is somewhere to type.
        if (this.state.curves.length === 0) {
            this.state.curves.push(createCurve('', PALETTE[0]));
        }
        this.render();
        this.onChange();
    }

    updateRow(row, curve) {
        const input = row.querySelector('.expr-input');
        const chip = row.querySelector('.color-chip');
        const error = row.querySelector('.curve-error');
        const visibility = row.querySelector('.toggle-visible');

        if (input.value !== curve.source) input.value = curve.source;
        chip.style.backgroundColor = curve.color;
        chip.title = 'Change colour';

        error.textContent = curve.error ? curve.error.message : '';
        row.classList.toggle('has-error', Boolean(curve.error));
        row.classList.toggle('is-hidden', !curve.visible);

        visibility
            .querySelector('use')
            .setAttribute('href', curve.visible ? '#i-eye' : '#i-eye-off');
        visibility.setAttribute(
            'aria-label',
            curve.visible ? 'Hide this function' : 'Show this function',
        );
        row.querySelector('.remove-curve').classList.add('danger');
    }
}

/**
 * Everything around the edges: theme, help dialog, toasts, sidebar toggle.
 */

const THEME_KEY = 'graphia.theme';

/** Light/dark with a system default and an explicit override. */
export class ThemeToggle {
    /**
     * @param {HTMLButtonElement} button
     * @param {() => void} onChange the canvas palette has to be re-read
     */
    constructor(button, onChange) {
        this.onChange = onChange;
        this.media = window.matchMedia('(prefers-color-scheme: dark)');

        const stored = safeGet(THEME_KEY);
        if (stored === 'light' || stored === 'dark') {
            document.documentElement.dataset.theme = stored;
        }

        button.addEventListener('click', () => {
            const next = this.effective === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = next;
            safeSet(THEME_KEY, next);
            this.onChange();
        });

        // Follow the system while no explicit choice has been made.
        this.media.addEventListener('change', () => {
            if (!document.documentElement.dataset.theme) this.onChange();
        });
    }

    get effective() {
        const explicit = document.documentElement.dataset.theme;
        if (explicit) return explicit;
        return this.media.matches ? 'dark' : 'light';
    }
}

/** Brief status message; used for "link copied" and the like. */
export function createToast(element) {
    let timer = 0;
    return function toast(message, duration = 2200) {
        element.textContent = message;
        element.hidden = false;
        // Force a reflow so the transition runs when re-showing the toast.
        void element.offsetWidth;
        element.classList.add('is-visible');
        clearTimeout(timer);
        timer = setTimeout(() => {
            element.classList.remove('is-visible');
            setTimeout(() => {
                element.hidden = true;
            }, 220);
        }, duration);
    };
}

export function setupHelp({ dialog, openButton, syntaxLink }) {
    const open = () => {
        if (!dialog.open) dialog.showModal();
    };
    openButton.addEventListener('click', open);
    syntaxLink?.addEventListener('click', open);
    // Clicking the backdrop closes the dialog.
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
    return { open, close: () => dialog.close() };
}

export function setupSidebarToggle({ button, workspace, onToggle }) {
    // Start collapsed on narrow screens so the graph gets the room.
    if (window.matchMedia('(max-width: 760px)').matches) {
        workspace.classList.add('sidebar-hidden');
        button.setAttribute('aria-expanded', 'false');
    }

    button.addEventListener('click', () => {
        const hidden = workspace.classList.toggle('sidebar-hidden');
        button.setAttribute('aria-expanded', String(!hidden));
        onToggle();
    });
}

function safeGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Ignore — a theme preference is not worth an exception.
    }
}

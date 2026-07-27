/**
 * A very small test runner.
 *
 * The project deliberately has no build step and no dependencies, so the tests
 * run in the browser against exactly the same ES modules the app loads. Results
 * are rendered to the page and also left on `window.__results` so they can be
 * read by an automated check.
 */

const suites = [];
let currentSuite = null;

export function describe(name, body) {
    currentSuite = { name, tests: [] };
    suites.push(currentSuite);
    body();
    currentSuite = null;
}

export function it(name, body) {
    if (!currentSuite) throw new Error('it() must be called inside describe()');
    currentSuite.tests.push({ name, body });
}

class AssertionError extends Error {}

function fail(message) {
    throw new AssertionError(message);
}

export function expect(actual) {
    return {
        toBe(expected) {
            if (!Object.is(actual, expected)) {
                fail(`expected ${show(expected)} but got ${show(actual)}`);
            }
        },

        /** Floating point comparison with an absolute-or-relative tolerance. */
        toBeCloseTo(expected, tolerance = 1e-9) {
            if (!Number.isFinite(actual)) {
                fail(`expected a finite number close to ${show(expected)}, got ${show(actual)}`);
            }
            const allowed = tolerance * Math.max(1, Math.abs(expected));
            if (Math.abs(actual - expected) > allowed) {
                fail(
                    `expected ${show(actual)} to be within ${allowed.toExponential(2)} ` +
                        `of ${show(expected)} (off by ${Math.abs(actual - expected).toExponential(3)})`,
                );
            }
        },

        toBeLessThan(limit) {
            if (!(actual < limit)) fail(`expected ${show(actual)} < ${show(limit)}`);
        },

        toBeGreaterThan(limit) {
            if (!(actual > limit)) fail(`expected ${show(actual)} > ${show(limit)}`);
        },

        toBeTruthy() {
            if (!actual) fail(`expected a truthy value, got ${show(actual)}`);
        },

        toBeFalsy() {
            if (actual) fail(`expected a falsy value, got ${show(actual)}`);
        },

        toBeNaN() {
            if (!Number.isNaN(actual)) fail(`expected NaN, got ${show(actual)}`);
        },

        toEqual(expected) {
            const a = JSON.stringify(actual);
            const b = JSON.stringify(expected);
            if (a !== b) fail(`expected ${b} but got ${a}`);
        },

        toThrow(match) {
            if (typeof actual !== 'function') fail('toThrow() needs a function');
            try {
                actual();
            } catch (error) {
                if (match && !String(error.message).includes(match)) {
                    fail(`threw "${error.message}", which does not contain "${match}"`);
                }
                return;
            }
            fail('expected the call to throw, but it returned normally');
        },
    };
}

function show(value) {
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return String(value);
    return JSON.stringify(value) ?? String(value);
}

/** Run everything registered so far and paint the results. */
export function run(root) {
    const results = { total: 0, passed: 0, failed: 0, failures: [], suites: [] };

    for (const suite of suites) {
        const suiteResult = { name: suite.name, tests: [] };
        for (const test of suite.tests) {
            results.total += 1;
            try {
                test.body();
                results.passed += 1;
                suiteResult.tests.push({ name: test.name, ok: true });
            } catch (error) {
                results.failed += 1;
                const message = error instanceof AssertionError
                    ? error.message
                    : `${error.name}: ${error.message}`;
                suiteResult.tests.push({ name: test.name, ok: false, message });
                results.failures.push(`${suite.name} › ${test.name}: ${message}`);
                if (!(error instanceof AssertionError)) console.error(error);
            }
        }
        results.suites.push(suiteResult);
    }

    render(root, results);
    window.__results = results;
    return results;
}

function render(root, results) {
    root.textContent = '';

    const summary = document.createElement('div');
    summary.className = `summary ${results.failed ? 'is-failing' : 'is-passing'}`;
    summary.textContent = results.failed
        ? `${results.failed} failing · ${results.passed} passing`
        : `all ${results.passed} tests passing`;
    root.append(summary);

    for (const suite of results.suites) {
        const section = document.createElement('section');
        const heading = document.createElement('h2');
        const failing = suite.tests.filter((test) => !test.ok).length;
        heading.textContent = suite.name;
        if (failing) heading.className = 'is-failing';
        section.append(heading);

        const list = document.createElement('ul');
        for (const test of suite.tests) {
            const item = document.createElement('li');
            item.className = test.ok ? 'ok' : 'bad';
            item.textContent = test.name;
            if (!test.ok) {
                const detail = document.createElement('pre');
                detail.textContent = test.message;
                item.append(detail);
            }
            list.append(item);
        }
        section.append(list);
        root.append(section);
    }
}

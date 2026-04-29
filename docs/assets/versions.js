/*!
 * pdfnative — Live version widget (dual-mode)
 * ==============================================
 * Renders the current published versions of `pdfnative`, `pdfnative-cli`,
 * and `pdfnative-mcp` straight from the public npm registry on page load.
 * Includes the *transitive pdfnative pin* declared in each downstream
 * package's `dependencies` so visitors can verify the wiring at a glance.
 *
 * Two presentation modes:
 *  - `compact` — one-line horizontal strip (sticky-discreet, intended for
 *    placement just under the main nav). Triggered by `data-mode="compact"`
 *    or by class `.pn-version-strip`.
 *  - `detailed` (default) — title + bullet list with pin annotations.
 *    Used by the rich block at the bottom of the page.
 *
 * Mount points: all elements matching `#pdfnative-versions`, `.pn-version-strip`,
 * or `[data-pn-versions]` are rendered once on DOMContentLoaded. Individual
 * values are also exposed as data attributes on each host element.
 *
 * Fully zero-dependency, zero-build: a single fetch per package against
 * https://registry.npmjs.org. Falls back gracefully when offline.
 *
 * @since 1.1.0
 */
(function () {
    'use strict';

    var NPM = 'https://registry.npmjs.org/';
    var PKGS = ['pdfnative', 'pdfnative-cli', 'pdfnative-mcp'];
    // Static fallbacks used when the registry is unreachable. Bumped at
    // every release of pdfnative; downstream pins update independently.
    var FALLBACK = {
        'pdfnative': { version: '1.1.0', pin: null },
        'pdfnative-cli': { version: '0.2.0', pin: '^1.0.5' },
        'pdfnative-mcp': { version: '0.2.0', pin: '^1.0.5' }
    };

    function el(tag, attrs, kids) {
        var n = document.createElement(tag);
        if (attrs) for (var k in attrs) {
            if (k === 'class') n.className = attrs[k];
            else if (k === 'text') n.textContent = attrs[k];
            else n.setAttribute(k, attrs[k]);
        }
        if (kids) for (var i = 0; i < kids.length; i++) {
            if (kids[i]) n.appendChild(kids[i]);
        }
        return n;
    }

    function fetchPkg(name) {
        return fetch(NPM + name + '/latest', { mode: 'cors' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return FALLBACK[name];
                var pin = null;
                if (data.dependencies && typeof data.dependencies.pdfnative === 'string') {
                    pin = data.dependencies.pdfnative;
                }
                return { version: data.version, pin: pin };
            })
            .catch(function () { return FALLBACK[name]; });
    }

    function applyDataAttrs(host, results) {
        host.setAttribute('data-pdfnative-version', results['pdfnative'].version);
        host.setAttribute('data-pdfnative-cli-version', results['pdfnative-cli'].version);
        host.setAttribute('data-pdfnative-mcp-version', results['pdfnative-mcp'].version);
    }

    /** Compact one-line strip: `Live npm: pdfnative v1.1.0 · cli v0.2.0 (→ ^1.1.0) · mcp v0.2.0 (→ ^1.1.0)`. */
    function renderCompact(host, results) {
        host.innerHTML = '';
        applyDataAttrs(host, results);

        var inner = el('div', { class: 'pn-version-strip-inner' });
        inner.appendChild(el('span', { class: 'pn-version-strip-label', text: 'Live npm:' }));

        PKGS.forEach(function (name, idx) {
            var info = results[name];
            if (idx > 0) {
                inner.appendChild(el('span', { class: 'pn-version-strip-sep', text: '\u00b7' }));
            }
            var link = el('a', {
                class: 'pn-version-strip-pkg',
                href: 'https://www.npmjs.com/package/' + name,
                target: '_blank',
                rel: 'noopener'
            });
            // Short name: pdfnative-cli → cli, pdfnative-mcp → mcp
            var shortName = name === 'pdfnative' ? 'pdfnative' : name.replace('pdfnative-', '');
            link.appendChild(document.createTextNode(shortName + ' '));
            link.appendChild(el('strong', { text: 'v' + info.version }));
            if (info.pin) {
                link.appendChild(el('span', {
                    class: 'pn-version-strip-pin',
                    title: 'pdfnative pin declared in this package\'s dependencies',
                    text: ' (\u2192 ' + info.pin + ')'
                }));
            }
            inner.appendChild(link);
        });

        host.appendChild(inner);
    }

    /** Detailed block: title + sub + bullet list + footer source link. */
    function renderDetailed(host, results) {
        host.innerHTML = '';
        applyDataAttrs(host, results);

        var rows = [];
        rows.push(el('h3', { class: 'pn-versions-title', text: 'Live versions' }));
        rows.push(el('p', {
            class: 'pn-versions-sub',
            text: 'Fetched from registry.npmjs.org on page load. Transitive pdfnative pin shown for transparency.'
        }));

        var list = el('ul', { class: 'pn-versions-list' });
        PKGS.forEach(function (name) {
            var info = results[name];
            var ver = el('span', { class: 'pn-versions-ver', text: 'v' + info.version });
            var nameSpan = el('a', {
                class: 'pn-versions-name',
                href: 'https://www.npmjs.com/package/' + name,
                target: '_blank',
                rel: 'noopener',
                text: name
            });
            var pinNote = null;
            if (info.pin) {
                pinNote = el('span', {
                    class: 'pn-versions-pin',
                    title: 'pdfnative pin declared in this package\'s dependencies',
                    text: '\u2192 pdfnative ' + info.pin
                });
            }
            list.appendChild(el('li', null, [nameSpan, ver, pinNote]));
        });
        rows.push(list);

        var foot = el('p', { class: 'pn-versions-foot' });
        foot.appendChild(document.createTextNode('Source: '));
        var srcLink = el('a', {
            href: 'https://registry.npmjs.org/',
            target: '_blank',
            rel: 'noopener',
            text: 'npm registry'
        });
        foot.appendChild(srcLink);
        foot.appendChild(document.createTextNode(' \u00b7 zero-dep, zero-build'));
        rows.push(foot);

        rows.forEach(function (n) { host.appendChild(n); });
    }

    function pickRenderer(host) {
        var mode = host.getAttribute('data-mode');
        if (mode === 'compact') return renderCompact;
        if (mode === 'detailed') return renderDetailed;
        // Class-based default
        if (host.classList && host.classList.contains('pn-version-strip')) return renderCompact;
        return renderDetailed;
    }

    function boot() {
        // All possible mounts, deduplicated.
        var mounts = [];
        var seen = (typeof Set !== 'undefined') ? new Set() : null;
        function add(node) {
            if (!node) return;
            if (seen) {
                if (seen.has(node)) return;
                seen.add(node);
            } else if (mounts.indexOf(node) !== -1) return;
            mounts.push(node);
        }
        var byId = document.getElementById('pdfnative-versions');
        if (byId) add(byId);
        var stripList = document.querySelectorAll('.pn-version-strip');
        for (var i = 0; i < stripList.length; i++) add(stripList[i]);
        var dataList = document.querySelectorAll('[data-pn-versions]');
        for (var j = 0; j < dataList.length; j++) add(dataList[j]);

        if (mounts.length === 0) return;

        Promise.all(PKGS.map(fetchPkg)).then(function (resArr) {
            var byName = {};
            for (var k = 0; k < PKGS.length; k++) byName[PKGS[k]] = resArr[k] || FALLBACK[PKGS[k]];
            mounts.forEach(function (host) {
                pickRenderer(host)(host, byName);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();

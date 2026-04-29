/*!
 * pdfnative — Live version badge widget
 * =======================================
 * Renders the current published versions of `pdfnative`, `pdfnative-cli`,
 * and `pdfnative-mcp` straight from the public npm registry on page load.
 * Includes the *transitive pdfnative pin* declared in each downstream
 * package's `dependencies` so visitors can verify the wiring at a glance.
 *
 * Fully zero-dependency, zero-build: a single fetch per package against
 * https://registry.npmjs.org. Falls back gracefully when offline.
 *
 * Mount points: any element with id `pdfnative-versions` is replaced by
 * the rendered widget. Individual values are also exposed as data attributes
 * on the host element for downstream styling/scripting.
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

    function render(host, results) {
        host.innerHTML = '';
        host.setAttribute('data-pdfnative-version', results['pdfnative'].version);
        host.setAttribute('data-pdfnative-cli-version', results['pdfnative-cli'].version);
        host.setAttribute('data-pdfnative-mcp-version', results['pdfnative-mcp'].version);

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

    function boot() {
        var host = document.getElementById('pdfnative-versions');
        if (!host) return;
        Promise.all(PKGS.map(fetchPkg)).then(function (resArr) {
            var byName = {};
            for (var i = 0; i < PKGS.length; i++) byName[PKGS[i]] = resArr[i] || FALLBACK[PKGS[i]];
            render(host, byName);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();

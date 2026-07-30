/*!
 * pdfnative — learning-path enhancements
 * ========================================
 * Purely additive. The prev/next links are static markup in every page, so the
 * path works with JavaScript disabled and its link graph is visible to crawlers.
 * This file only records progress and adds an opt-in keyboard shortcut.
 */
(function () {
    'use strict';

    var KEY = 'pdfnative-learn-progress';

    /** The overview carries `.ln-list`; step pages do not. */
    var list = document.querySelector('.ln-list');
    var isOverview = !!list;

    function read() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed.file === 'string' && typeof parsed.step === 'number'
                ? parsed
                : null;
        } catch (e) {
            return null; // private browsing, or a value we did not write
        }
    }

    // ── Record progress (step pages only) ───────────────────────────
    // The overview must never write: it used to match its own "Step 1 of 8"
    // label and overwrite the pointer with 'index.html' before reading it,
    // which made the resume note below unreachable.
    if (!isOverview) {
        var label = document.querySelector('.ln-step');
        var m = label && /Step\s+(\d+)\s+of/.exec(label.textContent);
        var file = location.pathname.split('/').pop();
        if (m && file) {
            var step = parseInt(m[1], 10);
            var prev = read();
            // Keep the DEEPEST step reached, so going back to revise does not
            // discard progress.
            if (!prev || step > prev.step) {
                try {
                    localStorage.setItem(KEY, JSON.stringify({ file: file, step: step }));
                } catch (e) { /* resume is optional */ }
            }
        }
    }

    // ── Keyboard navigation, opt-in ─────────────────────────────────
    // Bare arrow keys hijack a control the reader may be using and are
    // undiscoverable, so the shortcut requires Alt and is announced in the
    // pager. Alt+Arrow is already "history back/forward" in some browsers,
    // which is the closest existing meaning to what this does.
    function pagerHref(rel) {
        var a = document.querySelector('.ln-pager a[rel="' + rel + '"]');
        return a ? a.getAttribute('href') : null;
    }

    document.addEventListener('keydown', function (e) {
        if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.repeat) return;
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        var target = e.key === 'ArrowLeft' ? pagerHref('prev') : e.key === 'ArrowRight' ? pagerHref('next') : null;
        if (!target) return;
        e.preventDefault();
        location.href = target;
    });

    // ── Resume note (overview only) ─────────────────────────────────
    if (!isOverview) return;
    var saved = read();
    if (!saved) return;

    // Match by comparing attributes rather than interpolating into a selector:
    // a stored value containing a quote would throw a SyntaxError and abort.
    var link = null;
    var anchors = list.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
        if (anchors[i].getAttribute('href') === saved.file) {
            link = anchors[i];
            break;
        }
    }
    if (!link) return;

    var note = document.createElement('p');
    note.className = 'ln-prereq';
    note.appendChild(document.createTextNode('You reached step ' + saved.step + ': '));
    var resume = document.createElement('a');
    resume.setAttribute('href', saved.file);
    resume.textContent = link.textContent;
    note.appendChild(resume);
    note.appendChild(document.createTextNode('.'));
    list.parentNode.insertBefore(note, list);
})();

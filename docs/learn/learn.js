/*!
 * pdfnative — learning-path enhancements
 * ========================================
 * Purely additive. The prev/next links are static markup in every page, so the
 * path works with JavaScript disabled and its link graph is visible to crawlers.
 * This file only adds keyboard shortcuts and a resume pointer.
 */
(function () {
    'use strict';

    var KEY = 'pdfnative-learn-last';

    function href(rel) {
        var a = document.querySelector('.ln-pager a[rel="' + rel + '"]');
        return a ? a.getAttribute('href') : null;
    }

    // Remember the deepest step reached, so the overview can offer to resume.
    var step = document.querySelector('.ln-step');
    if (step && /Step (\d+) of/.test(step.textContent)) {
        try {
            localStorage.setItem(KEY, location.pathname.split('/').pop() || 'index.html');
        } catch (e) { /* private browsing — resume is optional */ }
    }

    // Left/right arrows walk the path, unless the user is typing.
    document.addEventListener('keydown', function (e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        var target = e.key === 'ArrowLeft' ? href('prev') : e.key === 'ArrowRight' ? href('next') : null;
        if (target) location.href = target;
    });

    // On the overview only, surface a resume link when there is progress to resume.
    var list = document.querySelector('.ln-list');
    if (!list) return;
    var last;
    try { last = localStorage.getItem(KEY); } catch (e) { return; }
    if (!last || last === 'index.html') return;
    var link = list.querySelector('a[href="' + last + '"]');
    if (!link) return;
    var note = document.createElement('p');
    note.className = 'ln-prereq';
    note.innerHTML = 'You were last on <a href="' + last + '">' + link.textContent + '</a>.';
    list.parentNode.insertBefore(note, list);
})();

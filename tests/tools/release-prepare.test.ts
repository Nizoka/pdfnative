import { describe, it, expect } from 'vitest';
import {
    isSemver,
    isIsoDate,
    todayUtc,
    stripTag,
    minorLine,
    bumpJsonVersion,
    bumpLockVersion,
    bumpManifest,
    restampVerifiedOn,
    bumpCitation,
    bumpSecurityTable,
    replacePins,
    pinVersions,
    bumpJsonLdVersion,
    replaceProductVersion,
    sitemapSources,
    sitemapEntries,
    sitemapCandidates,
    sitemapTouch,
    scaffoldReleaseNote,
    parseArgs,
} from '../../scripts/release-prepare.js';

// The pure half of scripts/release-prepare.ts: every edit is a targeted
// regex on the one field it owns, and these fixtures pin exactly which text
// each one may and may not touch. No git, no filesystem.

describe('release-prepare: helpers', () => {
    it('accepts plain semver triples only', () => {
        expect(isSemver('1.8.0')).toBe(true);
        expect(isSemver('v1.8.0')).toBe(false);
        expect(isSemver('1.8')).toBe(false);
        expect(isSemver('1.8.0-rc.1')).toBe(false);
    });

    it('validates ISO dates and formats today in UTC', () => {
        expect(isIsoDate('2026-09-13')).toBe(true);
        expect(isIsoDate('13/09/2026')).toBe(false);
        expect(isIsoDate('2026-13-45')).toBe(false);
        expect(todayUtc(new Date(Date.UTC(2026, 8, 13, 23, 59)))).toBe('2026-09-13');
    });

    it('strips the tag prefix and derives the minor line', () => {
        expect(stripTag('v1.7.0')).toBe('1.7.0');
        expect(stripTag('1.7.0')).toBe('1.7.0');
        expect(minorLine('1.8.3')).toBe('1.8');
        expect(minorLine('2.0.0')).toBe('2.0');
    });
});

describe('release-prepare: package manifests', () => {
    const PKG = '{\n  "name": "pdfnative",\n  "version": "1.7.0",\n  "devDependencies": {\n    "tsx": {\n      "version": "4.0.0"\n    }\n  }\n}\n';

    it('bumps the top-level version and nothing nested', () => {
        const r = bumpJsonVersion(PKG, '1.8.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('  "version": "1.8.0",');
        expect(r.text).toContain('      "version": "4.0.0"');
        expect(r.text).not.toContain('1.7.0');
    });

    it('reports matched=1 with unchanged text when already at the version', () => {
        const r = bumpJsonVersion(PKG.replace('1.7.0', '1.8.0'), '1.8.0');
        expect(r.matched).toBe(1);
        expect(r.text).toBe(PKG.replace('1.7.0', '1.8.0'));
    });

    it('reports matched=0 when there is no top-level version', () => {
        expect(bumpJsonVersion('{\n  "name": "x"\n}\n', '1.8.0').matched).toBe(0);
    });

    it('bumps the lockfile root and packages[""] but no dependency', () => {
        const LOCK =
            '{\n  "name": "pdfnative",\n  "version": "1.7.0",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "pdfnative",\n      "version": "1.7.0",\n      "bin": {\n        "x": "y"\n      }\n    },\n    "node_modules/a": {\n      "version": "1.7.0"\n    }\n  }\n}\n';
        const r = bumpLockVersion(LOCK, '1.8.0');
        expect(r.matched).toBe(2);
        expect(r.text.match(/"version": "1\.8\.0"/g)).toHaveLength(2);
        expect(r.text).toContain('"node_modules/a": {\n      "version": "1.7.0"');
    });
});

describe('release-prepare: ecosystem manifest and stamps', () => {
    const MANIFEST =
        '{\n  "$comment": "x",\n  "verifiedOn": "2026-08-21",\n  "packages": {\n    "pdfnative": {\n      "version": "1.7.0",\n      "pin": null\n    },\n    "pdfnative-cli": {\n      "version": "1.4.0"\n    }\n  }\n}\n';

    it('bumps only the pdfnative package version and the verifiedOn date', () => {
        const r = bumpManifest(MANIFEST, '1.8.0', '2026-09-13');
        expect(r.matched).toBe(2);
        expect(r.text).toContain('"verifiedOn": "2026-09-13"');
        expect(r.text).toContain('"pdfnative": {\n      "version": "1.8.0"');
        expect(r.text).toContain('"pdfnative-cli": {\n      "version": "1.4.0"');
    });

    it('re-stamps the prose and JSON forms of the verified-on marker', () => {
        const prose = restampVerifiedOn('_Verified on 2026-08-21 against the source tree._', '2026-09-13');
        expect(prose.matched).toBe(1);
        expect(prose.text).toBe('_Verified on 2026-09-13 against the source tree._');
        const json = restampVerifiedOn('{\n  "verifiedOn": "2026-08-21",\n  "x": 1\n}', '2026-09-13');
        expect(json.text).toContain('"verifiedOn": "2026-09-13"');
        expect(restampVerifiedOn('no stamp here', '2026-09-13').matched).toBe(0);
    });
});

describe('release-prepare: CITATION.cff', () => {
    const CFF = 'cff-version: 1.2.0\ntitle: "pdfnative"\nlicense: MIT\nversion: 1.7.0\nkeywords:\n  - pdf\n';

    it('bumps version, never cff-version, and adds date-released when absent', () => {
        const r = bumpCitation(CFF, '1.8.0', '2026-09-13');
        expect(r.matched).toBe(2);
        expect(r.text).toContain('cff-version: 1.2.0\n');
        expect(r.text).toContain('license: MIT\nversion: 1.8.0\ndate-released: 2026-09-13\nkeywords:');
    });

    it('rewrites an existing date-released in place', () => {
        const r = bumpCitation(CFF.replace('version: 1.7.0\n', 'version: 1.7.0\ndate-released: 2026-08-21\n'), '1.8.0', '2026-09-13');
        expect(r.matched).toBe(2);
        expect(r.text).toContain('version: 1.8.0\ndate-released: 2026-09-13\n');
        expect(r.text.match(/date-released/g)).toHaveLength(1);
    });

    it('reports matched=0 on a file without a version key', () => {
        expect(bumpCitation('cff-version: 1.2.0\ntitle: x\n', '1.8.0', '2026-09-13').matched).toBe(0);
    });
});

describe('release-prepare: SECURITY.md table', () => {
    const TABLE =
        '## Supported Versions\n\n| Version | Supported |\n|---------|-----------|\n| 1.7.x   | ✅        |\n| 1.6.x   | ✅ (security fixes) |\n| < 1.6   | ❌        |\n\n## Security Model\n';

    it('promotes the new minor and demotes the supported line to security fixes', () => {
        const r = bumpSecurityTable(TABLE, '1.8.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('| 1.8.x   | ✅        |\n| 1.7.x   | ✅ (security fixes) |\n| < 1.7   | ❌        |');
        expect(r.text).not.toContain('1.6');
    });

    it('leaves the table alone on a patch release', () => {
        const r = bumpSecurityTable(TABLE, '1.7.4');
        expect(r.matched).toBe(1);
        expect(r.text).toBe(TABLE);
    });

    it('follows the same rule on a major bump', () => {
        const r = bumpSecurityTable(TABLE, '2.0.0');
        expect(r.text).toContain('| 2.0.x   | ✅        |\n| 1.7.x   | ✅ (security fixes) |\n| < 1.7   | ❌        |');
    });

    it('reports matched=0 when the table shape is unrecognised', () => {
        expect(bumpSecurityTable('| 1.7 | yes |\n', '1.8.0').matched).toBe(0);
    });
});

describe('release-prepare: CDN pins', () => {
    const DOC = [
        "import x from 'https://esm.sh/pdfnative@1.7.0';",
        '<script src="https://cdn.jsdelivr.net/npm/pdfnative@1.7.0/+esm"></script>',
        'https://unpkg.com/pdfnative@1.7.0?module',
        "() => import('https://esm.sh/pdfnative@1.7.0/fonts/noto-thai-data.js')",
        'historical: pdfnative@1.5.0 shipped 20 tools; also pdfnative@1.7.01 and pdfnative@1.7.0.1 are not pins',
        '&#39;https://esm.sh/pdfnative@1.7.0&#39;',
    ].join('\n');

    it('rewrites every host form and only the exact version', () => {
        const r = replacePins(DOC, '1.7.0', '1.8.0');
        expect(r.matched).toBe(5);
        expect(r.text).toContain('esm.sh/pdfnative@1.8.0/fonts/noto-thai-data.js');
        expect(r.text).toContain('jsdelivr.net/npm/pdfnative@1.8.0/+esm');
        expect(r.text).toContain('unpkg.com/pdfnative@1.8.0?module');
        expect(r.text).toContain('pdfnative@1.8.0&#39;');
        expect(r.text).toContain('pdfnative@1.5.0 shipped');
        expect(r.text).toContain('pdfnative@1.7.01');
        expect(r.text).toContain('pdfnative@1.7.0.1');
    });

    it('escapes the dots so 1.7.0 does not match 1x7x0', () => {
        expect(replacePins('pdfnative@1x7x0', '1.7.0', '1.8.0').matched).toBe(0);
    });

    it('counts pins per version', () => {
        const counts = pinVersions(replacePins(DOC, '1.7.0', '1.8.0').text);
        expect(counts.get('1.8.0')).toBe(5);
        expect(counts.get('1.5.0')).toBe(1);
        expect(counts.has('1.7.0')).toBe(false);
    });
});

describe('release-prepare: JSON-LD, alt text and SVG label', () => {
    const HTML = [
        '<img alt="pdfnative 1.7.0 module architecture">',
        '{ "@id": "https://pdfnative.dev/#library", "name": "pdfnative", "softwareVersion": "1.7.0" },',
        '{ "@id": "https://pdfnative.dev/#cli", "name": "pdfnative-cli", "softwareVersion": "1.4.0" }',
    ].join('\n');

    it('bumps the softwareVersion of the addressed node only', () => {
        const r = bumpJsonLdVersion(HTML, 'https://pdfnative.dev/#library', '1.8.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('"name": "pdfnative", "softwareVersion": "1.8.0"');
        expect(r.text).toContain('"name": "pdfnative-cli", "softwareVersion": "1.4.0"');
        expect(bumpJsonLdVersion(HTML, 'https://pdfnative.dev/#nope', '1.8.0').matched).toBe(0);
    });

    it('rewrites the prose form "pdfnative 1.7.0" and leaves other packages alone', () => {
        const r = replaceProductVersion(`${HTML}\npdfnative-cli 1.7.0 is not the engine`, '1.7.0', '1.8.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('alt="pdfnative 1.8.0 module architecture"');
        expect(r.text).toContain('pdfnative-cli 1.7.0 is not the engine');
    });

    it('relabels an SVG <desc>', () => {
        const svg = '<svg><desc>Layered dependency diagram for pdfnative 1.7.0. Top band …</desc></svg>';
        expect(replaceProductVersion(svg, '1.7.0', '1.8.0').text).toContain('for pdfnative 1.8.0. Top');
    });
});

describe('release-prepare: sitemap', () => {
    const XML = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset>',
        '  <url>\n    <loc>https://pdfnative.dev/</loc>\n    <lastmod>2026-08-01</lastmod>\n  </url>',
        '  <url>\n    <loc>https://pdfnative.dev/guides/</loc>\n    <lastmod>2026-08-01</lastmod>\n  </url>',
        '  <url>\n    <loc>https://pdfnative.dev/guides/print.html</loc>\n    <lastmod>2026-08-01</lastmod>\n  </url>',
        '  <url>\n    <loc>https://pdfnative.dev/guides/print.md</loc>\n    <lastmod>2026-09-13</lastmod>\n  </url>',
        '  <url>\n    <loc>https://pdfnative.dev/playgrounds/scale.html</loc>\n    <lastmod>2026-08-01</lastmod>\n  </url>',
        '</urlset>',
    ].join('\n');

    it('maps a URL to the docs files it is rendered from', () => {
        expect(sitemapSources('https://pdfnative.dev/')).toEqual(['docs/index.html']);
        expect(sitemapSources('https://pdfnative.dev/guides/')).toEqual(['docs/guides/index.html']);
        expect(sitemapSources('https://pdfnative.dev/guides/print.html')).toEqual(['docs/guides/print.html', 'docs/guides/print.md']);
        expect(sitemapSources('https://pdfnative.dev/guides/print.md')).toEqual(['docs/guides/print.md']);
        expect(sitemapSources('https://pdfnative.dev/llms.txt')).toEqual(['docs/llms.txt']);
        expect(sitemapSources('https://pdfnative.dev/playgrounds/scale.html')).toEqual(['docs/playgrounds/scale.html']);
    });

    it('parses every <url> with its lastmod', () => {
        const entries = sitemapEntries(XML);
        expect(entries).toHaveLength(5);
        expect(entries[2]).toEqual({ loc: 'https://pdfnative.dev/guides/print.html', lastmod: '2026-08-01' });
    });

    it('selects the pages whose sources changed and are not yet stamped', () => {
        const candidates = sitemapCandidates(XML, ['docs/guides/print.md', 'docs\\playgrounds\\scale.html', 'docs/app.js'], '2026-09-13');
        expect(candidates).toEqual([
            { loc: 'https://pdfnative.dev/guides/print.html', because: 'docs/guides/print.md' },
            { loc: 'https://pdfnative.dev/playgrounds/scale.html', because: 'docs/playgrounds/scale.html' },
        ]);
    });

    it('touches only the requested lastmods', () => {
        const r = sitemapTouch(XML, ['https://pdfnative.dev/guides/print.html'], '2026-09-13');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('<loc>https://pdfnative.dev/guides/print.html</loc>\n    <lastmod>2026-09-13</lastmod>');
        expect(r.text).toContain('<loc>https://pdfnative.dev/</loc>\n    <lastmod>2026-08-01</lastmod>');
        expect(r.text.match(/2026-09-13/g)).toHaveLength(2);
    });
});

describe('release-prepare: release note scaffold', () => {
    const TEMPLATE = [
        '# Release Notes Template',
        '',
        '```markdown',
        '# pdfnative vX.Y.Z',
        '',
        '_Released YYYY-MM-DD_',
        '',
        '## Install',
        '',
        '\\`\\`\\`bash',
        'npm install pdfnative@X.Y.Z',
        '\\`\\`\\`',
        '',
        'Drop-in replacement for vX.Y.Z-1.',
        '- [Full diff](https://github.com/Nizoka/pdfnative/compare/vX.Y.Z-1...vX.Y.Z)',
        '```',
        '',
        '## Conventions',
    ].join('\n');

    it('extracts the fenced block, resolves the placeholders and unescapes the fences', () => {
        const note = scaffoldReleaseNote(TEMPLATE, '1.8.0', '2026-09-13', 'v1.7.0');
        expect(note).toBe(
            [
                '# pdfnative v1.8.0',
                '',
                '_Released 2026-09-13_',
                '',
                '## Install',
                '',
                '```bash',
                'npm install pdfnative@1.8.0',
                '```',
                '',
                'Drop-in replacement for v1.7.0.',
                '- [Full diff](https://github.com/Nizoka/pdfnative/compare/v1.7.0...v1.8.0)',
                '',
            ].join('\n'),
        );
    });

    it('refuses a template without a markdown block', () => {
        expect(() => scaffoldReleaseNote('# nothing here', '1.8.0', '2026-09-13', 'v1.7.0')).toThrow(/markdown block/);
    });
});

describe('release-prepare: argument parsing', () => {
    it('requires --version and validates it', () => {
        expect(parseArgs([])).toMatch(/--version is required/);
        expect(parseArgs(['--version', '1.8'])).toMatch(/not a plain semver/);
        expect(parseArgs(['--version', 'v1.8.0'])).toMatch(/not a plain semver/);
    });

    it('defaults the date to today (UTC) and the previous tag to git', () => {
        const opts = parseArgs(['--version', '1.8.0']);
        expect(opts).toMatchObject({ version: '1.8.0', previous: null, dryRun: false });
        expect(typeof opts === 'string' ? '' : opts.date).toBe(todayUtc());
    });

    it('accepts explicit date, previous (with or without v) and --dry-run in either form', () => {
        expect(parseArgs(['--version=1.8.0', '--date=2026-09-13', '--previous=1.7.0', '--dry-run'])).toEqual({
            version: '1.8.0',
            date: '2026-09-13',
            previous: 'v1.7.0',
            dryRun: true,
        });
        expect(parseArgs(['--version', '1.8.0', '--previous', 'v1.7.0'])).toMatchObject({ previous: 'v1.7.0' });
    });

    it('rejects bad dates, bad tags and unknown flags', () => {
        expect(parseArgs(['--version', '1.8.0', '--date', '13/09/2026'])).toMatch(/not an ISO date/);
        expect(parseArgs(['--version', '1.8.0', '--previous', 'latest'])).toMatch(/not a tag/);
        expect(parseArgs(['--version', '1.8.0', '--force'])).toMatch(/unknown argument "--force"/);
    });
});

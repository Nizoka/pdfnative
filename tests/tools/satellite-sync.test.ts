import { describe, it, expect } from 'vitest';
import {
    barePin,
    satelliteKey,
    splitCommand,
    bumpPackageRow,
    bumpVersionsFallback,
    bumpBadge,
    bumpImportmapPin,
    bumpDevDependency,
    bumpReadmeEcosystemRow,
    bumpLlmsEcosystemLine,
    BATCH_OF,
    batchOf,
    parseVerifyDocsJson,
    evaluateBlindSpots,
    deltaLines,
    buildWorklist,
    renderWorklist,
    parseArgs,
    syncCounts,
    USAGE,
} from '../../scripts/satellite-sync.js';

// The pure half of scripts/satellite-sync.ts: every edit is a targeted regex
// on the one field it owns, and these fixtures pin exactly which text each
// one may and may not touch. No satellite checkout, no child process.

describe('satellite-sync: small helpers', () => {
    it('strips caret and tilde from pins', () => {
        expect(barePin('^1.9.0')).toBe('1.9.0');
        expect(barePin('~1.9.0')).toBe('1.9.0');
        expect(barePin('1.9.0')).toBe('1.9.0');
        expect(barePin(null)).toBeNull();
    });

    it('maps package names to satellite keys', () => {
        expect(satelliteKey('pdfnative-cli')).toBe('cli');
        expect(satelliteKey('react')).toBe('react');
        expect(satelliteKey('pdfnative')).toBeNull();
        expect(satelliteKey('pdfnative-foo')).toBeNull();
    });

    it('splits a command line honouring quotes', () => {
        expect(splitCommand('npx tsx src/index.ts schema manifest')).toEqual(['npx', 'tsx', 'src/index.ts', 'schema', 'manifest']);
        expect(splitCommand(`node -e "import('./x.js').then(m => console.log(m.a()))"`)).toEqual(['node', '-e', "import('./x.js').then(m => console.log(m.a()))"]);
        expect(splitCommand("echo 'a b'  c")).toEqual(['echo', 'a b', 'c']);
    });
});

describe('satellite-sync: ecosystem.json package rows', () => {
    const MANIFEST = [
        '{',
        '  "verifiedOn": "2026-10-01",',
        '  "packages": {',
        '    "pdfnative": {',
        '      "version": "1.9.0",',
        '      "pinField": null,',
        '      "pin": null',
        '    },',
        '    "pdfnative-cli": {',
        '      "version": "1.5.0",',
        '      "pinField": "dependencies",',
        '      "pin": "^1.8.0",',
        '      "commandCount": 20',
        '    },',
        '    "pdfnative-react": {',
        '      "version": "1.3.0",',
        '      "pinField": "peerDependencies",',
        '      "pin": "^1.8.0",',
        '      "counts": {',
        '        "components": 18',
        '      }',
        '    }',
        '  },',
        '  "playgrounds": {',
        '    "pdfnative-react": {',
        '      "version": "0.0.0"',
        '    }',
        '  }',
        '}',
        '',
    ].join('\n');

    it('bumps version and pin and inserts counts before the closing brace', () => {
        const r = bumpPackageRow(MANIFEST, 'pdfnative-cli', { version: '1.6.0', pin: '^1.9.0', counts: { commands: 21, errorCodes: 12 } });
        expect(r.matched).toBe(3);
        expect(r.text).toContain('    "pdfnative-cli": {\n      "version": "1.6.0",\n      "pinField": "dependencies",\n      "pin": "^1.9.0",\n      "commandCount": 20,\n      "counts": {\n        "commands": 21,\n        "errorCodes": 12\n      }\n    },');
        // Neighbours untouched: the engine row, the react row, the nested key elsewhere.
        expect(r.text).toContain('    "pdfnative": {\n      "version": "1.9.0",');
        expect(r.text).toContain('    "pdfnative-react": {\n      "version": "1.3.0",');
        expect(r.text).toContain('  "playgrounds": {\n    "pdfnative-react": {\n      "version": "0.0.0"');
        expect(JSON.parse(r.text)).toBeTruthy();
    });

    it('replaces an existing counts block and never touches the playground key of the same name', () => {
        const r = bumpPackageRow(MANIFEST, 'pdfnative-react', { version: '1.4.0', pin: '^1.9.0', counts: { components: 19, blocks: 14 } });
        expect(r.matched).toBe(3);
        expect(r.text).toContain('      "pin": "^1.9.0",\n      "counts": {\n        "components": 19,\n        "blocks": 14\n      }\n    }\n  },');
        expect(r.text).toContain('    "pdfnative-react": {\n      "version": "0.0.0"');
        expect(r.text).not.toContain('"components": 18');
        expect(JSON.parse(r.text)).toBeTruthy();
    });

    it('is idempotent and leaves counts alone when none are given', () => {
        const once = bumpPackageRow(MANIFEST, 'pdfnative-react', { version: '1.4.0', pin: '^1.9.0', counts: { components: 19 } });
        const twice = bumpPackageRow(once.text, 'pdfnative-react', { version: '1.4.0', pin: '^1.9.0', counts: { components: 19 } });
        expect(twice.matched).toBe(3);
        expect(twice.text).toBe(once.text);
        const current = bumpPackageRow(MANIFEST, 'pdfnative-cli', { version: '1.5.0', pin: '^1.8.0' });
        expect(current.matched).toBe(2);
        expect(current.text).toBe(MANIFEST);
    });

    it('writes a null pin and refuses the engine row', () => {
        const r = bumpPackageRow(MANIFEST, 'pdfnative-cli', { version: '1.6.0', pin: null });
        expect(r.text).toContain('      "pin": null,\n      "commandCount": 20');
        expect(bumpPackageRow(MANIFEST, 'pdfnative', { version: '2.0.0', pin: null }).matched).toBe(0);
        expect(bumpPackageRow(MANIFEST, 'pdfnative-mcp', { version: '1.8.0', pin: '^1.9.0' }).matched).toBe(0);
        expect(bumpPackageRow('{}', 'pdfnative-cli', { version: '1.6.0', pin: null }).matched).toBe(0);
    });
});

describe('satellite-sync: versions.js, badges, importmaps, devDependencies', () => {
    const JS = [
        "    var FALLBACK = {",
        "        'pdfnative': { version: '1.9.0', pin: null, pinField: null },",
        "        'pdfnative-cli': { version: '1.5.0', pin: '^1.8.0', pinField: 'dependencies' },",
        "        'pdfnative-react': { version: '1.3.0', pin: '^1.8.0', pinField: 'peerDependencies' }",
        '    };',
    ].join('\n');

    it('rewrites one FALLBACK row only', () => {
        const r = bumpVersionsFallback(JS, 'pdfnative-cli', '1.6.0', '^1.9.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain("'pdfnative-cli': { version: '1.6.0', pin: '^1.9.0', pinField: 'dependencies' }");
        expect(r.text).toContain("'pdfnative-react': { version: '1.3.0', pin: '^1.8.0', pinField: 'peerDependencies' }");
        expect(r.text).toContain("'pdfnative': { version: '1.9.0', pin: null, pinField: null }");
        expect(bumpVersionsFallback(JS, 'pdfnative-cli', '1.5.0', '^1.8.0').text).toBe(JS);
        expect(bumpVersionsFallback(JS, 'pdfnative-mcp', '1.8.0', '^1.9.0').matched).toBe(0);
        expect(bumpVersionsFallback(JS, 'pdfnative-react', '1.3.0', null).text).toContain("'pdfnative-react': { version: '1.3.0', pin: null, pinField:");
    });

    const HTML = [
        '<h3>Library <span class="ob-badge" data-pn-badge="pdfnative">v1.9.0</span></h3>',
        '<h3>CLI <span class="ob-badge" data-pn-badge="pdfnative-cli">v1.5.0</span></h3>',
        '<h3>React <span class="ob-badge" data-pn-badge="pdfnative-react">v1.3.0</span></h3>',
        '<script type="importmap">{"imports":{"pdfnative":"https://esm.sh/pdfnative@1.9.0","pdfnative-react":"https://esm.sh/pdfnative-react@1.3.0?external=react,pdfnative"}}</script>',
        '<a href="https://esm.sh/pdfnative-react@1.3.0/dist/index.js">x</a>',
    ].join('\n');

    it('bumps the badge of one package', () => {
        const r = bumpBadge(HTML, 'pdfnative-cli', '1.6.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('data-pn-badge="pdfnative-cli">v1.6.0</span>');
        expect(r.text).toContain('data-pn-badge="pdfnative">v1.9.0</span>');
        expect(r.text).toContain('data-pn-badge="pdfnative-react">v1.3.0</span>');
        expect(bumpBadge(HTML, 'pdfnative-cli', '1.5.0').text).toBe(HTML);
        expect(bumpBadge(HTML, 'pdfnative-mcp', '1.8.0').matched).toBe(0);
    });

    it('bumps every importmap pin of one package and not the engine pin', () => {
        const r = bumpImportmapPin(HTML, 'pdfnative-react', '1.4.0');
        expect(r.matched).toBe(2);
        expect(r.text).toContain('pdfnative-react@1.4.0?external=react,pdfnative');
        expect(r.text).toContain('pdfnative-react@1.4.0/dist/index.js');
        expect(r.text).toContain('esm.sh/pdfnative@1.9.0"');
        expect(bumpImportmapPin(HTML, 'pdfnative-react', '1.3.0').text).toBe(HTML);
        expect(bumpImportmapPin(HTML, 'pdfnative-cli', '1.6.0').matched).toBe(0);
    });

    const PKG = [
        '{',
        '  "name": "pdfnative",',
        '  "version": "1.9.0",',
        '  "devDependencies": {',
        '    "eslint": "^9.0.0",',
        '    "pdfnative-react": "^1.3.0",',
        '    "tsx": "^4.0.0"',
        '  },',
        '  "overrides": {',
        '    "pdfnative-react": "^0.0.0"',
        '  }',
        '}',
        '',
    ].join('\n');

    it('bumps the top-level devDependency only', () => {
        const r = bumpDevDependency(PKG, 'pdfnative-react', '^1.4.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('    "pdfnative-react": "^1.4.0",\n    "tsx"');
        expect(r.text).toContain('  "overrides": {\n    "pdfnative-react": "^0.0.0"');
        expect(bumpDevDependency(PKG, 'pdfnative-react', '^1.3.0').text).toBe(PKG);
        expect(bumpDevDependency(PKG, 'pdfnative-cli', '^1.6.0').matched).toBe(0);
        expect(bumpDevDependency('{\n  "name": "x"\n}\n', 'pdfnative-react', '^1.4.0').matched).toBe(0);
    });
});

describe('satellite-sync: README and llms ecosystem lines', () => {
    const README = [
        '| Package | Latest | Use it for |',
        '|---|:---:|---|',
        '| [`pdfnative`](https://www.npmjs.com/package/pdfnative) | **v1.9.0** | The library itself. |',
        '| [`pdfnative-cli`](https://www.npmjs.com/package/pdfnative-cli) | **v1.5.0** | Render JSON → PDF since v1.5.0. |',
        '| [`pdfnative-mcp`](https://www.npmjs.com/package/pdfnative-mcp) | **v1.7.0** | MCP server. |',
        '',
    ].join('\n');

    it('rewrites the version cell of one row', () => {
        const r = bumpReadmeEcosystemRow(README, 'pdfnative-cli', '1.6.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('| [`pdfnative-cli`](https://www.npmjs.com/package/pdfnative-cli) | **v1.6.0** | Render JSON → PDF since v1.5.0. |');
        expect(r.text).toContain('| **v1.9.0** | The library itself. |');
        expect(r.text).toContain('| **v1.7.0** | MCP server. |');
        expect(bumpReadmeEcosystemRow(README, 'pdfnative-cli', '1.5.0').text).toBe(README);
        expect(bumpReadmeEcosystemRow(README, 'pdfnative-react', '1.4.0').matched).toBe(0);
    });

    const LLMS = [
        '## Ecosystem',
        '',
        '- [pdfnative-cli](https://github.com/Nizoka/pdfnative-cli): CLI wrapper for pdfnative (v1.5.0, requires pdfnative ≥ 1.8.0 — pins `^1.8.0`, Node ≥ 22) — render, fill.',
        '- [pdfnative-mcp](https://github.com/Nizoka/pdfnative-mcp): Model Context Protocol server exposing pdfnative as 27 AI tools (v1.7.0, requires pdfnative ≥ 1.8.0).',
        '- [pdfnative-react](https://github.com/Nizoka/pdfnative-react): React renderer (v1.3.0, React 19 + pdfnative ^1.8.0 peers).',
        '',
    ].join('\n');

    it('rewrites version, requires and pins on one line only', () => {
        const cli = bumpLlmsEcosystemLine(LLMS, 'pdfnative-cli', '1.6.0', '^1.9.0');
        expect(cli.matched).toBe(3);
        expect(cli.text).toContain('(v1.6.0, requires pdfnative ≥ 1.9.0 — pins `^1.9.0`, Node ≥ 22)');
        expect(cli.text).toContain('27 AI tools (v1.7.0, requires pdfnative ≥ 1.8.0).');
        expect(cli.text).toContain('(v1.3.0, React 19 + pdfnative ^1.8.0 peers)');
        const mcp = bumpLlmsEcosystemLine(LLMS, 'pdfnative-mcp', '1.8.0', '^1.9.0');
        expect(mcp.matched).toBe(2);
        expect(mcp.text).toContain('27 AI tools (v1.8.0, requires pdfnative ≥ 1.9.0).');
        const react = bumpLlmsEcosystemLine(LLMS, 'pdfnative-react', '1.4.0', '^1.9.0');
        expect(react.matched).toBe(2);
        expect(react.text).toContain('(v1.4.0, React 19 + pdfnative ^1.9.0 peers)');
    });

    it('is idempotent, tolerates a null pin and reports a missing line', () => {
        expect(bumpLlmsEcosystemLine(LLMS, 'pdfnative-cli', '1.5.0', '^1.8.0').text).toBe(LLMS);
        const noPin = bumpLlmsEcosystemLine(LLMS, 'pdfnative-cli', '1.6.0', null);
        expect(noPin.matched).toBe(1);
        expect(noPin.text).toContain('(v1.6.0, requires pdfnative ≥ 1.8.0 — pins `^1.8.0`');
        expect(bumpLlmsEcosystemLine(LLMS, 'zipnative', '1.0.0', null).matched).toBe(0);
    });
});

describe('satellite-sync: batches, findings, blind spots, worklist', () => {
    it('maps representative paths to the writer batches', () => {
        expect(BATCH_OF.length).toBe(8);
        expect(batchOf('docs/guides/cli.md')).toBe('B1');
        expect(batchOf('docs/guides/cli.html')).toBe('B1');
        expect(batchOf('docs/guides/mcp.md')).toBe('B2');
        expect(batchOf('docs/guides/react.md')).toBe('B3');
        expect(batchOf('docs/data/surfaces.json')).toBe('B4');
        expect(batchOf('docs/guides/choose.md')).toBe('B4');
        expect(batchOf('docs/guides/use-cases-mcp.md')).toBe('B5');
        expect(batchOf('docs/guides/use-cases.html')).toBe('B5');
        expect(batchOf('docs/assets/use-case-airgap-ltv.svg')).toBe('B5');
        expect(batchOf('README.md')).toBe('B6');
        expect(batchOf('docs/index.html')).toBe('B6');
        expect(batchOf('docs/agent-brief.md')).toBe('B6');
        expect(batchOf('llms.txt')).toBe('B6');
        expect(batchOf('docs/llms.txt')).toBe('B6');
        expect(batchOf('docs/playgrounds/cli.html')).toBe('B7');
        expect(batchOf('docs/playgrounds/mcp.html')).toBe('B7');
        expect(batchOf('docs/playgrounds/react.html')).toBe('B8');
        expect(batchOf('docs/playgrounds/docspec-lint.html')).toBe('B8');
        expect(batchOf('docs\\playgrounds\\react.html')).toBe('B8');
        expect(batchOf('docs/guides/native-family.md')).toBe('B0');
        expect(batchOf('docs/assets/ecosystem.json')).toBe('B0');
        expect(batchOf('docs/playgrounds/images.html')).toBe('B0');
    });

    it('reads the verify-docs JSON array, with or without noise around it', () => {
        const arr = '[\n  {\n    "file": "docs/guides/cli.md",\n    "line": 12,\n    "rule": "count-tokens",\n    "message": "x",\n    "severity": "error"\n  }\n]\n';
        expect(parseVerifyDocsJson(arr)).toEqual([{ file: 'docs/guides/cli.md', line: 12, rule: 'count-tokens', message: 'x', severity: 'error' }]);
        expect(parseVerifyDocsJson(`warning: something\n${arr}`)).toHaveLength(1);
        expect(parseVerifyDocsJson('[]')).toEqual([]);
        expect(parseVerifyDocsJson('verify-docs: 42 rules passed')).toBeNull();
        expect(parseVerifyDocsJson('[{"file":"x"}]')).toBeNull();
    });

    it('keeps only the blind-spot tokens that differ from the manifest', () => {
        const rows = [
            { id: 'fallback', file: 'docs/assets/versions.js', pattern: /'(pdfnative-\w+)': \{ version: '([\d.]+)'/, package: null, nameGroup: 1, versionGroup: 2, kind: 'version' as const, description: 'FALLBACK' },
            { id: 'pins-prose', file: '*', pattern: /pdfnative-(cli|mcp) .*?pins `(\^[\d.]+)`/, package: null, nameGroup: 1, versionGroup: 2, kind: 'pin' as const, description: 'prose pin' },
            { id: 'react-since', file: '*', pattern: /<strong>pdfnative-react<\/strong> since v(?<v>[\d.]+)/, package: 'pdfnative-react', versionGroup: 'v', kind: 'version' as const, description: 'strong form' },
            { id: 'llms-line', file: 'llms.txt', pattern: /^- \[(pdfnative-\w+)\]\(.*\(v([\d.]+), requires pdfnative ≥ ([\d.]+)/m, package: null, nameGroup: 1, versionGroup: 2, pinGroup: 3, kind: 'version' as const, description: 'llms line' },
        ];
        const files = new Map<string, string>([
            ['docs/assets/versions.js', "'pdfnative-cli': { version: '1.5.0' },\n'pdfnative-mcp': { version: '1.8.0' },\n'pdfnative-react': { version: '1.4.0' }"],
            ['docs/guides/cli.md', 'line one\npdfnative-cli pins `^1.8.0` today\npdfnative-mcp pins `^1.9.0`'],
            ['docs/index.html', '<p><strong>pdfnative-react</strong> since v1.3.0</p>\n<p><strong>pdfnative-react</strong> since v1.4.0</p>'],
            ['llms.txt', '- [pdfnative-mcp](https://x): MCP (v1.8.0, requires pdfnative ≥ 1.8.0).'],
        ]);
        const found = evaluateBlindSpots(rows, files, {
            cli: { version: '1.6.0', pin: '^1.9.0' },
            mcp: { version: '1.8.0', pin: '^1.9.0' },
            react: { version: '1.4.0', pin: '^1.9.0' },
        });
        expect(found).toEqual([
            { id: 'fallback', file: 'docs/assets/versions.js', line: 1, package: 'cli', kind: 'version', current: '1.5.0', expected: '1.6.0' },
            { id: 'pins-prose', file: 'docs/guides/cli.md', line: 2, package: 'cli', kind: 'pin', current: '^1.8.0', expected: '1.9.0' },
            { id: 'react-since', file: 'docs/index.html', line: 1, package: 'react', kind: 'version', current: '1.3.0', expected: '1.4.0' },
            { id: 'llms-line', file: 'llms.txt', line: 1, package: 'mcp', kind: 'pin', current: '1.8.0', expected: '1.9.0' },
        ]);
    });

    it('renders deltas and assigns everything to batches', () => {
        expect(deltaLines('pdfnative-cli 1.5.0 → 1.6.0', { commands: { added: ['govern'], removed: [] }, flags: { added: [], removed: [] }, errorCodes: { added: ['E_X'], removed: ['E_Y'] } }))
            .toEqual(['pdfnative-cli 1.5.0 → 1.6.0 commands: +govern', 'pdfnative-cli 1.5.0 → 1.6.0 errorCodes: +E_X / -E_Y']);
        expect(deltaLines('x', null)).toEqual([]);

        const findings = [
            { file: 'docs/guides/react.md', line: 40, rule: 'count-tokens', message: 'b', severity: 'error' as const },
            { file: 'docs/guides/cli.md', line: 9, rule: 'count-tokens', message: 'a', severity: 'error' as const },
            { file: 'docs/guides/cli.md', line: 3, rule: 'version-token', message: 'c', severity: 'warn' as const },
            { file: 'docs/guides/native-family.md', line: 1, rule: 'x', message: 'd', severity: 'error' as const },
        ];
        const spots = [{ id: 'fallback', file: 'docs/assets/versions.js', line: 1, package: 'cli' as const, kind: 'version' as const, current: '1.5.0', expected: '1.6.0' }];
        const w = buildWorklist('2026-11-01', 1, findings, spots, { cli: ['pdfnative-cli commands: +govern'], react: ['pdfnative-react lintRules: +R41'] });
        expect(w.verifyDocs).toEqual({ exitCode: 1, errors: 3, warnings: 1 });
        expect(w.batches.B1.files).toEqual(['docs/guides/cli.md']);
        expect(w.batches.B1.findings.map((f) => f.line)).toEqual([9, 3]);
        expect(w.batches.B1.deltas).toEqual(['pdfnative-cli commands: +govern']);
        expect(w.batches.B3.deltas).toEqual(['pdfnative-react lintRules: +R41']);
        expect(w.batches.B8.deltas).toEqual(['pdfnative-react lintRules: +R41']);
        expect(w.batches.B2.deltas).toEqual([]);
        expect(w.batches.B0.files).toEqual(['docs/assets/versions.js', 'docs/guides/native-family.md']);
        expect(w.batches.B0.blindSpots).toHaveLength(1);

        const md = renderWorklist(w);
        expect(md.startsWith('# Satellite worklist — 2026-11-01\n')).toBe(true);
        expect(md).toContain('## B1 — docs/guides/cli.md');
        expect(md).toContain('  - [count-tokens]\n    - l.9: a');
        expect(md).toContain('    - warn l.3: c');
        expect(md).toContain('## B8\n\n### Surface delta\n\n- pdfnative-react lintRules: +R41');
        expect(md).toContain('- docs/assets/versions.js:1 [fallback] pdfnative-cli version 1.5.0 → 1.6.0');
        expect(md).not.toContain('## B2');
        expect(md.endsWith('\n')).toBe(true);
        expect(md).not.toMatch(/\n\n\n/);
    });
});

describe('satellite-sync: parseArgs', () => {
    it('defaults to the sibling checkouts, today and test-output/.satellites', () => {
        const o = parseArgs([]);
        expect(typeof o).toBe('object');
        if (typeof o === 'string') return;
        expect(o.roots).toEqual({ cli: null, mcp: null, react: null });
        expect(o.expect).toEqual({});
        expect(o.out).toBe('test-output/.satellites');
        expect(o.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(o.capture || o.apply || o.worklist || o.json || o.dryRun).toBe(false);
    });

    it('accepts every flag form', () => {
        const o = parseArgs(['--cli', '../x', '--react=../y', '--expect', 'cli=1.6.0', 'mcp=1.8.0', '--expect=react=1.4.0', '--capture', '--apply', '--worklist', '--json', '--out', 'tmp/s', '--date', '2026-11-01', '--dry-run']);
        expect(o).toEqual({
            roots: { cli: '../x', mcp: null, react: '../y' },
            expect: { cli: '1.6.0', mcp: '1.8.0', react: '1.4.0' },
            capture: true,
            apply: true,
            worklist: true,
            json: true,
            out: 'tmp/s',
            date: '2026-11-01',
            dryRun: true,
        });
        const comma = parseArgs(['--expect', 'cli=1.6.0,pdfnative-mcp=1.8.0']);
        expect(typeof comma === 'object' && comma.expect).toEqual({ cli: '1.6.0', mcp: '1.8.0' });
    });

    it('rejects an unknown flag and a bad --expect', () => {
        const unknown = parseArgs(['--frobnicate']);
        expect(typeof unknown).toBe('string');
        expect(unknown).toContain('unknown argument "--frobnicate"');
        expect(unknown).toContain(USAGE);
        expect(parseArgs(['--expect', 'cli=1.6'])).toContain('--expect "cli=1.6"');
        expect(parseArgs(['--expect', 'engine=1.9.0'])).toContain('is not <cli|mcp|react>=<X.Y.Z>');
        expect(parseArgs(['--expect'])).toContain('--expect needs');
        expect(parseArgs(['--expect', '--apply'])).toContain('--expect needs');
        expect(parseArgs(['--date', '2026-13-45'])).toContain('not an ISO date');
        expect(parseArgs(['--cli'])).toContain('--cli needs a directory');
    });
});

describe('satellite-sync: syncCounts', () => {
    const existing = { commands: 21, renderFlags: 59, statusFields: 35 };

    it('writes a verified surface count over the manifest value, key by key', () => {
        const out = syncCounts(existing, { commands: 22, renderFlags: 61, statusFields: 36, toolExamples: 47 }, []);
        expect(out).toEqual({ commands: 22, renderFlags: 61, statusFields: 36 });
    });

    it('keeps the manifest value for a count the surface could not verify or does not have', () => {
        const unverified = [
            'commands flags, globalFlags, errorCodes, renderFlags: no capture and no tests/compat manifest',
            'statusFields: taken from tests/compat/status-1.5.0.json (previous release) — run the capture to verify the current release',
        ];
        const out = syncCounts(existing, { commands: 21, renderFlags: 57, statusFields: 31 }, unverified);
        expect(out).toEqual({ commands: 21, renderFlags: 59, statusFields: 35 });
        expect(syncCounts(existing, {}, [])).toEqual(existing);
    });
});

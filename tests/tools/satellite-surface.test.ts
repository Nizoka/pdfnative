import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    SATELLITES,
    CAPTURE_COMMANDS,
    FACTS_MAX_LINES,
    readSurfaceOrDerive,
    readPreviousSurface,
    diffSurface,
    renderFactsMarkdown,
    blindSpotTable,
    normaliseSurface,
    joinCut,
    bulletsOf,
    defaultOfDescription,
    promptNamesOf,
    compareSemver,
    rangeMinimum,
    type SatelliteFacts,
    type SatelliteSurface,
} from '../../scripts/lib/satellite-surface.js';

// The pure half of `scripts/satellite-sync.ts`: fake satellite checkouts are
// written under a temp directory with the real shapes of the committed
// artefacts (ecosystem.json, package.json, compat captures, server.json,
// tool-shape fixtures, baseline manifests), and the derivation is checked
// with and without the optional captures.

const roots: string[] = [];
afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, unknown>): string {
    const root = mkdtempSync(join(tmpdir(), 'satellite-surface-'));
    roots.push(root);
    for (const [rel, content] of Object.entries(files)) {
        const path = join(root, ...rel.split('/'));
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    }
    return root;
}

const pkg = (name: string, version: string, field: 'dependencies' | 'peerDependencies', extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    name,
    version,
    engines: { node: '>=22' },
    [field]: { pdfnative: '^1.9.0', ...(field === 'peerDependencies' ? { react: '^19.0.0' } : {}) },
    ...extra,
});

// ── CLI ─────────────────────────────────────────────────────────────

const cliManifest = (renderFlags: string[], globalFlags: string[]): Record<string, unknown> => ({
    kind: 'capability-manifest',
    name: 'pdfnative-cli',
    version: '1.0.0',
    globalFlags,
    errorCodes: ['E_USAGE', 'E_IO'],
    commands: [
        { name: 'render', summary: 'Render', flags: renderFlags },
        { name: 'schema', summary: 'Schema', flags: ['--subject'] },
    ],
});

function cliTree(): string {
    return tree({
        'package.json': pkg('pdfnative-cli', '1.1.0', 'dependencies'),
        'docs/assets/ecosystem.json': {
            packages: { 'pdfnative-cli': { version: '1.1.0' } },
            declared: { bundledFontModules: 3, unicodeScripts: 4, diagnosticCodes: 5 },
            derived: { commands: 2, commandGroups: { 'Create & edit': ['render'], Meta: ['schema'] }, schemaSubjects: 2, errorCodes: 2, globalFlags: 2 },
        },
        'docs/AGENT_CONTRACT.md': '# Contract\n',
        'tests/compat/manifest-0.9.0.json': cliManifest(['--input'], ['--json']),
        'tests/compat/manifest-1.0.0.json': cliManifest(['--input', '--output'], ['--json', '--help']),
        'tests/compat/status-1.0.0.json': { type: 'object', properties: { ok: { type: 'boolean' }, command: { type: 'string' } } },
        'tests/compat/subjects-1.0.0.json': { subjects: ['render', 'status'] },
        'src/commands/render.ts': "export const x = 1;\n// a comment that says mutually exclusive\nif (a && b) throw new ToolError('VALIDATION_ERROR',\n    '--pdfa and --encrypt are mutually exclusive (ISO 19005-1)');\n",
        'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [1.1.0] – 2026-11-01\n\nIntro.\n\n### Added\n- first change\n- second change\n  continued here\n\n## [1.0.0] - 2026-01-01\n\n- old\n',
        'release-notes/v1.1.0.md': '# v1.1.0\n\n## Highlights\n\n- not this one\n\n## Downstream integration notes\n\n- siblings move the entry to 1.1.0\n- `--direction` defaults to auto\n\n## Links\n\n- x\n',
    });
}

describe('readSurfaceOrDerive — pdfnative-cli (degraded)', () => {
    it('derives the version, pin, Node floor, previous capture, ledger and links without a capture', () => {
        const root = cliTree();
        const s = readSurfaceOrDerive(root, 'pdfnative-cli');
        expect(s.mode).toBe('degraded');
        expect(s.package).toBe('pdfnative-cli');
        expect(s.version).toBe('1.1.0');
        expect(s.previous).toBe('1.0.0');
        expect(s.releasedOn).toBe('2026-11-01');
        expect(s.engine).toEqual({ pin: '^1.9.0', pinField: 'dependencies', minimum: '1.9.0' });
        expect(s.runtime.node).toBe('>=22');
        expect(s.lists.commands).toEqual(['render', 'schema']);
        expect(s.lists.globalFlags).toEqual(['--json', '--help']);
        expect(s.lists.statusFields).toEqual(['ok', 'command']);
        expect(s.lists.schemaSubjects).toEqual(['render', 'status']);
        expect(s.lists.renderFlags).toEqual(['--input', '--output']);
        expect(s.structured.commands).toEqual([
            { name: 'render', group: 'Create & edit', flags: ['--input', '--output'] },
            { name: 'schema', group: 'Meta', flags: ['--subject'] },
        ]);
        expect(s.counts).toMatchObject({ commands: 2, globalFlags: 2, errorCodes: 2, schemaSubjects: 2, statusFields: 2, renderFlags: 2, bundledFontModules: 3, unicodeScripts: 4, diagnosticCodes: 5 });
        expect(s.ledger).toEqual([
            { id: 'rn-1', summary: 'siblings move the entry to 1.1.0' },
            { id: 'rn-2', summary: '`--direction` defaults to auto' },
        ]);
        expect(s.docs).toEqual({ guide: 'https://pdfnative.dev/guides/cli.html', llms: 'https://raw.githubusercontent.com/Nizoka/pdfnative-cli/main/llms.txt', agentContract: 'docs/AGENT_CONTRACT.md' });
        expect(s.constraints[0]).toBe('pdfnative ^1.9.0 (dependencies)');
        expect(s.constraints[1]).toBe('node >=22');
        expect(s.constraints.some((c) => c.startsWith('src/commands/render.ts:4:') && c.includes('mutually exclusive'))).toBe(true);
        expect(s.constraints.some((c) => c.includes('a comment'))).toBe(false);
        expect(s.sources).toEqual(expect.arrayContaining(['package.json', 'docs/assets/ecosystem.json', 'tests/compat/manifest-1.0.0.json', 'tests/compat/status-1.0.0.json', 'tests/compat/subjects-1.0.0.json', 'CHANGELOG.md', 'release-notes/v1.1.0.md']));
        expect(s.unverified.some((u) => u.startsWith('globalFlags: taken from tests/compat/*-1.0.0.json'))).toBe(true);
        expect(s.unverified.some((u) => u.startsWith('statusFields:'))).toBe(true);
        expect(s.unverified.some((u) => u.startsWith('commands:'))).toBe(false);
    });

    it('takes the captures as the current lists and reports a count that disagrees with ecosystem.json', () => {
        const root = cliTree();
        const s = readSurfaceOrDerive(root, 'pdfnative-cli', {
            cliManifest: cliManifest(['--input', '--output', '--direction'], ['--json', '--help', '--quiet']),
            cliStatus: { properties: { ok: {}, command: {}, bytes: {} } },
            cliSubjects: { subjects: ['render', 'status', 'manifest'] },
        });
        expect(s.lists.globalFlags).toEqual(['--json', '--help', '--quiet']);
        expect(s.counts.globalFlags).toBe(3);
        expect(s.counts.statusFields).toBe(3);
        expect(s.counts.schemaSubjects).toBe(3);
        expect(s.counts.renderFlags).toBe(3);
        expect(s.unverified).toContain('globalFlags: derived 3 items but ecosystem.json says 2');
        expect(s.unverified.some((u) => u.includes('taken from'))).toBe(false);
        expect(s.sources).not.toContain('tests/compat/manifest-1.0.0.json');

        const prev = readPreviousSurface(root, 'pdfnative-cli');
        expect(prev?.version).toBe('1.0.0');
        expect(prev?.counts).toMatchObject({ commands: 2, globalFlags: 2, renderFlags: 2 });
        expect(diffSurface(prev, s)).toEqual({
            globalFlags: { added: ['--quiet'], removed: [] },
            statusFields: { added: ['bytes'], removed: [] },
            schemaSubjects: { added: ['manifest'], removed: [] },
            renderFlags: { added: ['--direction'], removed: [] },
            'flags:render': { added: ['--direction'], removed: [] },
        });
    });

    it('falls back to the top CHANGELOG entry when the release note has no Downstream section', () => {
        const root = cliTree();
        rmSync(join(root, 'release-notes', 'v1.1.0.md'));
        const s = readSurfaceOrDerive(root, 'pdfnative-cli');
        expect(s.ledger).toEqual([
            { id: 'cl-1', summary: 'first change' },
            { id: 'cl-2', summary: 'second change continued here' },
        ]);
    });
});

// ── MCP ─────────────────────────────────────────────────────────────

const tool = (name: string, properties: Record<string, unknown>, exampleCount: number): Record<string, unknown> => ({
    name,
    title: name,
    inputSchema: { type: 'object', properties },
    exampleCount,
});
const spotColour = { anyOf: [{ type: 'string' }, { type: 'object', properties: { spot: { type: 'string' }, tint: { type: 'number' } } }] };

function mcpTree(): string {
    const generate = tool('generate_basic_pdf', { title: { type: 'string' }, blocks: { type: 'array', items: { properties: { color: spotColour } } }, print: { properties: { bars: { items: { properties: { ink: spotColour } } } } } }, 2);
    const international = (extra: Record<string, unknown>) =>
        tool('add_international_text', { title: { type: 'string' }, lang: { anyOf: [{ type: 'string', enum: ['ar', 'he'] }, { type: 'array', items: { enum: ['ar', 'he'] } }] }, ...extra }, 1);
    return tree({
        'package.json': pkg('pdfnative-mcp', '1.1.0', 'dependencies'),
        'docs/assets/ecosystem.json': {
            declared: { unicodeScripts: 4, diagnosticCodes: 5 },
            derived: { tools: 2, toolGroups: { Generate: ['generate_basic_pdf', 'add_international_text'] }, prompts: 1, errorCodes: 2, envVars: 2, examples: 4 },
        },
        'server.json': {
            version: '1.1.0',
            packages: [
                {
                    identifier: 'pdfnative-mcp',
                    environmentVariables: [
                        { name: 'PDFNATIVE_MCP_OUTPUT_DIR', description: 'Absolute path. Unset: base64 only.', isSecret: false },
                        { name: 'PDFNATIVE_MCP_HTTP_TOKEN', description: 'Bearer token (default none; >= 16 chars).', isSecret: true },
                    ],
                },
            ],
        },
        'tests/_fixtures/tool-shape.json': [generate, international({ direction: { enum: ['auto', 'ltr', 'rtl'] } })],
        'tests/_fixtures/tool-shape.v1.0.0.json': [generate, international({})],
        'examples/README.md': '# Examples\n',
        'examples/annotate-pdf.json': { tool: 'annotate_pdf' },
        'examples/basic-report.json': { tool: 'generate_basic_pdf' },
        'examples/pipeline.json': { steps: [] },
        'examples/thai-letter.json': { tool: 'add_international_text' },
        'src/server.ts': "const PROMPTS = [\n    {\n        name: 'pades_ladder',\n        title: 'x',\n    },\n];\nexport function f() { throw new ToolError('TSA_NOT_CONFIGURED', 'no'); }\n",
        'src/errors.ts': "class E { constructor() { super('VALIDATION_ERROR'); } }\n",
        'CHANGELOG.md': '# Changelog\n\n## [1.1.0] - 2026-11-01\n\n- one\n',
    });
}

describe('readSurfaceOrDerive — pdfnative-mcp (degraded)', () => {
    it('derives tools with inputs, env vars with defaults, prompts, error codes, example files, lang values and colour sites', () => {
        const root = mcpTree();
        const s = readSurfaceOrDerive(root, 'pdfnative-mcp');
        expect(s.previous).toBe('1.0.0');
        expect(s.lists.tools).toEqual(['generate_basic_pdf', 'add_international_text']);
        expect(s.structured.tools).toEqual([
            { name: 'generate_basic_pdf', group: 'Generate', inputs: ['title', 'blocks', 'print'] },
            { name: 'add_international_text', group: 'Generate', inputs: ['title', 'lang', 'direction'] },
        ]);
        expect(s.structured.envVars).toEqual([
            { name: 'PDFNATIVE_MCP_OUTPUT_DIR', default: null, isSecret: false },
            { name: 'PDFNATIVE_MCP_HTTP_TOKEN', default: 'none', isSecret: true },
        ]);
        expect(s.lists.envVars).toEqual(['PDFNATIVE_MCP_OUTPUT_DIR', 'PDFNATIVE_MCP_HTTP_TOKEN']);
        expect(s.lists.prompts).toEqual(['pades_ladder']);
        expect(s.lists.errorCodes).toEqual(['TSA_NOT_CONFIGURED', 'VALIDATION_ERROR']);
        expect(s.lists.langValues).toEqual(['ar', 'he']);
        expect(s.lists.examples).toEqual(['annotate-pdf.json', 'basic-report.json', 'pipeline.json', 'thai-letter.json']);
        expect(s.counts).toMatchObject({ tools: 2, envVars: 2, prompts: 1, errorCodes: 2, examples: 4, toolExamples: 3, langValues: 2, colourSites: 2, unicodeScripts: 4 });
        expect(s.unverified).toEqual([]);
        expect(s.sources).toEqual(expect.arrayContaining(['server.json', 'tests/_fixtures/tool-shape.json', 'src/server.ts', 'examples/*.json']));
    });

    it('prefers captured prompts and diffs the inputs of a tool present on both sides', () => {
        const root = mcpTree();
        const s = readSurfaceOrDerive(root, 'pdfnative-mcp', { mcpPrompts: ['pades_ladder', 'print_ready'] });
        expect(s.lists.prompts).toEqual(['pades_ladder', 'print_ready']);
        expect(s.unverified).toContain('prompts: derived 2 items but ecosystem.json says 1');
        const prev = readPreviousSurface(root, 'pdfnative-mcp');
        expect(prev?.version).toBe('1.0.0');
        expect(prev?.lists.tools).toEqual(['generate_basic_pdf', 'add_international_text']);
        expect(prev?.counts.toolExamples).toBe(3);
        expect(diffSurface(prev, s)).toEqual({ 'inputs:add_international_text': { added: ['direction'], removed: [] } });
        const withPrevExamples = { ...prev!, lists: { ...prev!.lists, examples: ['annotate-pdf.json', 'old.json'] } };
        expect(diffSurface(withPrevExamples, s).examples).toEqual({ added: ['basic-report.json', 'pipeline.json', 'thai-letter.json'], removed: ['old.json'] });
    });
});

// ── React ───────────────────────────────────────────────────────────

function reactManifest(rules: { code: string; severity: string }[], extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        kind: 'capability-manifest',
        name: 'pdfnative-react',
        version: '1.0.0',
        contract: { engine: '^1.8.0', react: '^19.0.0', node: '>=22' },
        components: [{ name: 'Document', tag: 'document' }, { name: 'Paragraph', tag: 'paragraph' }],
        clientComponents: [{ name: 'PDFViewer' }],
        specBlocks: [{ kinds: ['h1', 'h2', 'h3'], component: 'Heading' }, { kinds: ['p'], component: 'Paragraph' }],
        specFields: ['title', 'blocks'],
        entrypoints: [{ name: 'renderToBytes' }, { name: 'lint' }],
        errorCodes: ['E_STRUCTURE'],
        lintRules: rules,
        schemaSubjects: ['doc-spec'],
        ...extra,
    };
}
const rulesOf = (errors: number, warnings: number, infos: number): { code: string; severity: string }[] => [
    ...Array.from({ length: errors }, (_, i) => ({ code: `L_E${i}`, severity: 'error' })),
    ...Array.from({ length: warnings }, (_, i) => ({ code: `L_W${i}`, severity: 'warning' })),
    ...Array.from({ length: infos }, (_, i) => ({ code: `L_I${i}`, severity: 'info' })),
];

function reactTree(): string {
    return tree({
        'package.json': pkg('pdfnative-react', '1.1.0', 'peerDependencies'),
        'docs/assets/ecosystem.json': {
            declared: { unicodeScripts: 4, diagnosticCodes: 5 },
            derived: { components: 2, clientComponents: 1, blocks: 2, specFields: 2, lintRules: 41, errorCodes: 1, schemaSubjects: 1 },
        },
        'tests/regression/baselines/manifest.v1.0.0.json': reactManifest(rulesOf(2, 1, 0)),
        'CHANGELOG.md': '# Changelog\n\n## [1.1.0] — Right-to-left\n\n- one\n',
    });
}

describe('readSurfaceOrDerive — pdfnative-react (degraded)', () => {
    it('reads the peer pin and the baseline manifest, counts from ecosystem.json for unverified lists, no severity split', () => {
        const root = reactTree();
        const s = readSurfaceOrDerive(root, 'pdfnative-react');
        expect(s.engine).toEqual({ pin: '^1.9.0', pinField: 'peerDependencies', minimum: '1.9.0' });
        expect(s.previous).toBe('1.0.0');
        expect(s.releasedOn).toBeNull();
        expect(s.lists.components).toEqual(['Document', 'Paragraph']);
        expect(s.lists.blocks).toEqual(['h1|h2|h3', 'p']);
        expect(s.lists.lintRules).toEqual(['L_E0', 'L_E1', 'L_W0']);
        expect(s.lists.entrypoints).toEqual(['renderToBytes', 'lint']);
        expect(s.counts.lintRules).toBe(41);
        expect(s.counts.components).toBe(2);
        expect(s.counts.lintErrors).toBeUndefined();
        expect(s.constraints).toContain('react ^19.0.0 (peerDependencies)');
        expect(s.unverified.some((u) => u.startsWith('lintRules: taken from tests/regression/baselines/manifest.v1.0.0.json'))).toBe(true);
        expect(s.unverified.some((u) => u.startsWith('lintErrors, lintWarnings, lintInfos'))).toBe(true);
        expect(s.unverified).toContain('releasedOn: no dated CHANGELOG heading for this version');
        expect(s.docs.agentContract).toBeNull();
    });

    it('takes the captured capabilityManifest() for the current lists and the 26/14/1 severity split', () => {
        const root = reactTree();
        const s = readSurfaceOrDerive(root, 'pdfnative-react', { reactManifest: reactManifest(rulesOf(26, 14, 1)) });
        expect(s.counts).toMatchObject({ lintRules: 41, lintErrors: 26, lintWarnings: 14, lintInfos: 1, components: 2 });
        expect(s.structured.lintRules).toHaveLength(41);
        expect(s.unverified.some((u) => u.includes('taken from'))).toBe(false);
        const prev = readPreviousSurface(root, 'pdfnative-react');
        expect(prev?.engine).toEqual({ pin: '^1.8.0', pinField: 'peerDependencies', minimum: '1.8.0' });
        expect(prev?.counts).toMatchObject({ lintRules: 3, lintErrors: 2, lintWarnings: 1, lintInfos: 0 });
        const delta = diffSurface(prev, s);
        expect(delta.lintRules.added).toHaveLength(38);
        expect(delta.lintRules.removed).toEqual([]);
    });
});

// ── Contract mode ───────────────────────────────────────────────────

describe('readSurfaceOrDerive — contract mode', () => {
    it('takes docs/assets/surface.json as-is, normalised, and reads nothing else', () => {
        const root = tree({
            'package.json': pkg('pdfnative-cli', '9.9.9', 'dependencies'),
            'docs/assets/surface.json': { package: 'pdfnative-cli', version: '2.0.0', previous: '1.6.0', engine: { pin: '^2.0.0', pinField: 'dependencies' }, lists: { commands: ['a', 'b'], junk: 'no' }, counts: { commands: 2 }, structured: { commands: [{ name: 'a', group: null, flags: ['--x'] }] } },
        });
        const s = readSurfaceOrDerive(root, 'pdfnative-cli');
        expect(s.mode).toBe('contract');
        expect(s.version).toBe('2.0.0');
        expect(s.previous).toBe('1.6.0');
        expect(s.engine).toEqual({ pin: '^2.0.0', pinField: 'dependencies', minimum: '2.0.0' });
        expect(s.lists).toEqual({ commands: ['a', 'b'] });
        expect(s.structured.commands).toEqual([{ name: 'a', group: null, flags: ['--x'] }]);
        expect(s.sources).toEqual(['docs/assets/surface.json']);
        expect(s.docs.guide).toBe('https://pdfnative.dev/guides/cli.html');
        expect(s.unverified).toEqual([]);
    });

    it('readPreviousSurface returns null when the satellite commits no previous capture', () => {
        const root = tree({ 'package.json': pkg('pdfnative-mcp', '1.0.0', 'dependencies') });
        expect(readPreviousSurface(root, 'pdfnative-mcp')).toBeNull();
        expect(normaliseSurface({}, 'pdfnative-mcp').lists).toEqual({});
    });
});

// ── diffSurface ─────────────────────────────────────────────────────

const surface = (lists: Record<string, string[]>, structured: SatelliteSurface['structured'] = {}): SatelliteSurface => ({
    package: 'pdfnative-mcp',
    version: '1.0.0',
    previous: null,
    releasedOn: null,
    engine: { pin: null, pinField: null, minimum: null },
    runtime: { node: null },
    lists,
    structured,
    counts: {},
    constraints: [],
    ledger: [],
    docs: { guide: '', llms: '', agentContract: null },
    mode: 'degraded',
    sources: [],
    unverified: [],
});

describe('diffSurface', () => {
    it('returns {} for a null previous surface', () => {
        expect(diffSurface(null, surface({ tools: ['a'] }))).toEqual({});
    });

    it('sorts added and removed, skips unchanged lists and lists absent on one side', () => {
        const prev = surface({ tools: ['b', 'a', 'z'], prompts: ['p'] }, { tools: [{ name: 'a', group: null, inputs: ['y', 'x'] }, { name: 'z', group: null, inputs: [] }] });
        const next = surface({ tools: ['c', 'a', 'd'], prompts: ['p'], envVars: ['E'] }, { tools: [{ name: 'a', group: null, inputs: ['x', 'w'] }, { name: 'c', group: null, inputs: ['n'] }] });
        expect(diffSurface(prev, next)).toEqual({
            tools: { added: ['c', 'd'], removed: ['b', 'z'] },
            'inputs:a': { added: ['w'], removed: ['y'] },
        });
    });
});

// ── renderFactsMarkdown ─────────────────────────────────────────────

function facts(lists: Record<string, string[]>, ledger = 3): SatelliteFacts {
    const s = surface(lists);
    const full: SatelliteSurface = {
        ...s,
        package: 'pdfnative-cli',
        version: '1.6.0',
        previous: '1.5.0',
        engine: { pin: '^1.9.0', pinField: 'dependencies', minimum: '1.9.0' },
        runtime: { node: '>=22' },
        counts: { commands: lists.commands?.length ?? 0 },
        constraints: ['pdfnative ^1.9.0 (dependencies)'],
        ledger: Array.from({ length: ledger }, (_, i) => ({ id: `rn-${i + 1}`, summary: `entry ${i + 1}` })),
        unverified: ['statusFields: taken from tests/compat'],
    };
    return {
        generatedOn: '2026-11-01',
        engineVersion: '1.9.0',
        satellites: { 'pdfnative-cli': { surface: full, previous: { ...surface({ commands: ['render'] }), package: 'pdfnative-cli', version: '1.5.0', counts: { commands: 1 } }, delta: { commands: { added: ['fill'], removed: [] } }, manifestToday: { version: '1.6.0', pin: '^1.9.0', counts: { commands: 21 } } } },
    };
}

const HEADINGS = ['# Satellite facts', '## Versions and pins', '## pdfnative-cli', '### Counts', '### Lists', '### Delta', '### Constraints', '### Ledger', '### Unverified', '## Blind spots', '## Capture commands'];

describe('renderFactsMarkdown', () => {
    it('keeps the fixed heading order and the facts of one satellite', () => {
        const md = renderFactsMarkdown(facts({ commands: ['render', 'fill'] }));
        let at = -1;
        for (const h of HEADINGS) {
            const next = md.indexOf(`\n${h}`, at + 1) === -1 && at === -1 ? md.indexOf(h) : md.indexOf(`\n${h}`, at + 1);
            expect(next, h).toBeGreaterThan(at);
            at = next;
        }
        expect(md).toContain('| pdfnative-cli | 1.6.0 | 1.5.0 | — | ^1.9.0 | dependencies | 1.9.0 | >=22 | 1.6.0 / ^1.9.0 | degraded |');
        expect(md).toContain('| commands | 1 | 2 | 21 |');
        expect(md).toContain('- commands (2): render, fill');
        expect(md).toContain('- commands: +fill');
        expect(md).toContain('- [rn-1] entry 1');
        expect(md).toContain('- statusFields: taken from tests/compat');
        expect(md).toContain('| versions-fallback | docs/assets/versions.js | version | by name group |');
        expect(md).toContain('`npx tsx src/index.ts schema manifest`');
        expect(md.endsWith('\n')).toBe(true);
    });

    it('cuts a long list at 200 characters with the remainder counted', () => {
        const items = Array.from({ length: 500 }, (_, i) => `command-${i}`);
        const md = renderFactsMarkdown(facts({ commands: items }));
        const line = md.split('\n').find((l) => l.startsWith('- commands (500): '))!;
        expect(line).toMatch(/… \(\+\d+\)$/);
        expect(line.length).toBeLessThan(240);
    });

    it('never exceeds 300 lines: lists are dropped first, the ledger second', () => {
        const lists = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`list${i}`, ['a']]));
        const md = renderFactsMarkdown(facts(lists, 15));
        const lines = md.trimEnd().split('\n');
        expect(lines.length).toBeLessThanOrEqual(FACTS_MAX_LINES);
        expect(md).toContain('400 lists omitted for the line budget');
        expect(md).toContain('- [rn-1] entry 1');
        expect(md).not.toContain('truncated to');
    });
});

// ── blindSpotTable ──────────────────────────────────────────────────

const SAMPLES: Record<string, { text: string; name: string; version: string; pin?: string }> = {
    'versions-fallback': { text: "        'pdfnative-cli': { version: '1.6.0', pin: '^1.9.0', pinField: 'dependencies' },", name: 'pdfnative-cli', version: '1.6.0', pin: '1.9.0' },
    'package-devdependency': { text: '    "pdfnative-react": "^1.4.0",', name: 'pdfnative-react', version: '1.4.0' },
    'importmap-react': { text: '    "pdfnative-react": "https://esm.sh/pdfnative-react@1.4.0?external=react,pdfnative"', name: 'pdfnative-react', version: '1.4.0' },
    'backtick-version': { text: '`pdfnative-mcp` v1.8.0', name: 'pdfnative-mcp', version: '1.8.0' },
    'strong-version': { text: '<strong>pdfnative-react</strong> v1.4.0 — JSX', name: 'pdfnative-react', version: '1.4.0' },
    'learn-since': { text: '      <li><strong><a href="../guides/cli.html">pdfnative-cli</a></strong> — 21 commands; your own fonts since v1.5.0; right-to-left text (<code>--direction</code>) since v1.6.0.</li>', name: 'pdfnative-cli', version: '1.6.0' },
    'agent-brief-new-in': { text: '- **Driving a shell** → `pdfnative-cli` (21 commands, stable `E_*` codes). New in v1.6.0: right-to-left layout', name: 'pdfnative-cli', version: '1.6.0' },
    'llms-ecosystem-line': { text: 'intro\n- [pdfnative-mcp](https://github.com/Nizoka/pdfnative-mcp): Model Context Protocol server exposing pdfnative as 28 AI tools (v1.8.0, requires pdfnative ≥ 1.9.0).', name: 'pdfnative-mcp', version: '1.8.0' },
    'pin-prose': { text: '- [pdfnative-cli](https://github.com/Nizoka/pdfnative-cli) — terminal wrapper; requires pdfnative ≥ 1.9.0, Node ≥ 22.', name: 'pdfnative-cli', version: '1.9.0' },
};

describe('blindSpotTable', () => {
    const table = blindSpotTable();

    it('holds the nine rows, each with a global regex and a version group', () => {
        expect(table.map((r) => r.id)).toEqual(Object.keys(SAMPLES));
        for (const row of table) {
            expect(row.pattern.flags, row.id).toContain('g');
            expect(row.versionGroup, row.id).toBeGreaterThan(0);
            if (row.package === null) expect(row.nameGroup, row.id).toBeGreaterThan(0);
        }
        expect(table.filter((r) => r.kind === 'pin').map((r) => r.id)).toEqual(['pin-prose']);
    });

    it.each(table.map((r) => [r.id, r] as const))('%s matches its canonical sample and captures the version', (id, row) => {
        const sample = SAMPLES[id];
        const re = new RegExp(row.pattern.source, row.pattern.flags);
        const matches = [...sample.text.matchAll(re)];
        expect(matches).toHaveLength(1);
        const m = matches[0];
        expect(m[row.versionGroup]).toBe(sample.version);
        expect(row.package ?? m[row.nameGroup!]).toBe(sample.name);
        if (row.pinGroup !== undefined) expect(m[row.pinGroup]).toBe(sample.pin);
    });

    it('pin-prose accepts the three prose forms', () => {
        const row = table.find((r) => r.id === 'pin-prose')!;
        for (const text of ['`pdfnative-react` — Peer: pdfnative ^1.9.0', '`pdfnative-mcp` (v1.8.0 — pins `^1.9.0`)', '<code>pdfnative-cli</code> pins <code>^1.9.0</code>']) {
            const m = [...text.matchAll(new RegExp(row.pattern.source, row.pattern.flags))];
            expect(m, text).toHaveLength(1);
            expect(m[0][row.versionGroup]).toBe('1.9.0');
        }
    });
});

// ── Helpers and constants ───────────────────────────────────────────

describe('helpers', () => {
    it('SATELLITES and CAPTURE_COMMANDS name the three packages', () => {
        expect(SATELLITES).toEqual(['pdfnative-cli', 'pdfnative-mcp', 'pdfnative-react']);
        expect(Object.keys(CAPTURE_COMMANDS)).toEqual([...SATELLITES]);
        expect(CAPTURE_COMMANDS['pdfnative-cli']).toHaveLength(3);
        expect(CAPTURE_COMMANDS['pdfnative-mcp']).toEqual([]);
    });

    it('joinCut keeps whole items and counts the rest', () => {
        expect(joinCut(['a', 'b', 'c'], 200)).toBe('a, b, c');
        expect(joinCut(['alpha', 'beta', 'gamma'], 11)).toBe('alpha, beta… (+1)');
        expect(joinCut(['a-very-long-first-item'], 5)).toBe('a-very-long-first-item');
        expect(joinCut([], 10)).toBe('');
    });

    it('bulletsOf joins continuation lines and keeps nested bullets', () => {
        expect(bulletsOf(['- one', '  more', '  - nested', 'para', '- two'])).toEqual(['one more', 'nested', 'two']);
    });

    it('defaultOfDescription reads the default of an environment variable', () => {
        expect(defaultOfDescription('Per-stream cap in bytes (zip-bomb mitigation; default 104857600 = 100 MiB).')).toBe('104857600');
        expect(defaultOfDescription('Per-request timeout, 1000-120000 (default 10000).')).toBe('10000');
        expect(defaultOfDescription('Unset: base64 only.')).toBeNull();
    });

    it('promptNamesOf reads the PROMPTS table only', () => {
        expect(promptNamesOf("const TOOLS = [\n    { name: 'x' },\n];\nexport const PROMPTS = [\n    {\n        name: 'pades_ladder',\n    },\n    {\n        name: 'print_ready',\n    },\n];\nconst other = [{\n        name: 'nope',\n}];")).toEqual(['pades_ladder', 'print_ready']);
        expect(promptNamesOf('nothing')).toEqual([]);
    });

    it('compareSemver and rangeMinimum', () => {
        expect(['1.10.0', '1.9.0', '1.9.1'].sort(compareSemver)).toEqual(['1.9.0', '1.9.1', '1.10.0']);
        expect(rangeMinimum('^1.9.0')).toBe('1.9.0');
        expect(rangeMinimum('>=1.8.0 <2')).toBe('1.8.0');
        expect(rangeMinimum(null)).toBeNull();
    });
});

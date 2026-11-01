/**
 * Satellite surface — what each companion package exposes, read as data
 * =====================================================================
 * `scripts/satellite-sync.ts` aligns pdfnative.dev with the three companion
 * packages (pdfnative-cli, pdfnative-mcp, pdfnative-react). This module is
 * its pure half: given a satellite checkout it returns one `SatelliteSurface`
 * (versions, pins, lists, structured items, counts, constraints, ledger,
 * links), diffs two surfaces, renders the compact facts sheet the writing
 * agents read, and holds the table of version "blind spots" of the docs tree
 * that no `verify:docs` token sees today.
 *
 * Two modes:
 *   contract  the satellite ships `docs/assets/surface.json` (the contract of
 *             the plan's layer 1) — taken as-is after normalisation;
 *   degraded  derived from what the satellites commit today: `package.json`,
 *             `docs/assets/ecosystem.json`, `server.json`, the compat captures
 *             (`tests/compat/*-<prev>.json`, `tests/_fixtures/tool-shape*.json`,
 *             `tests/regression/baselines/manifest.v<prev>.json`), the top
 *             CHANGELOG entry or the release note's Downstream section, and
 *             optional captures the caller obtained by running
 *             `CAPTURE_COMMANDS` in the satellite root.
 *
 * Everything that cannot be derived is named in `unverified`; every file read
 * is named in `sources`. Zero dependency: `node:fs` and `node:path` only, no
 * child process, no network, no satellite path in any shell command.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── Contract ────────────────────────────────────────────────────────

export type SatelliteName = 'pdfnative-cli' | 'pdfnative-mcp' | 'pdfnative-react';

export const SATELLITES: readonly SatelliteName[] = ['pdfnative-cli', 'pdfnative-mcp', 'pdfnative-react'];

export interface SatelliteSurface {
    package: SatelliteName;
    version: string;
    previous: string | null;
    releasedOn: string | null;
    engine: { pin: string | null; pinField: 'dependencies' | 'peerDependencies' | null; minimum: string | null };
    runtime: { node: string | null };
    /** Named lists (command names, tool names, error codes, …) — the unit of `diffSurface`. */
    lists: Record<string, readonly string[]>;
    structured: {
        commands?: readonly { name: string; group: string | null; flags: readonly string[] }[];
        tools?: readonly { name: string; group: string | null; inputs: readonly string[] }[];
        envVars?: readonly { name: string; default: string | null; isSecret: boolean }[];
        lintRules?: readonly { code: string; severity: string }[];
    };
    /** List lengths when the list is known, else the satellite's own `ecosystem.json` figure. */
    counts: Record<string, number>;
    constraints: readonly string[];
    ledger: readonly { id: string; summary: string }[];
    docs: { guide: string; llms: string; agentContract: string | null };
    mode: 'contract' | 'degraded';
    /** Files read, relative to the satellite root. */
    sources: readonly string[];
    /** What this surface could not establish — the writer marks it `<!-- unverified -->`, never reads the source. */
    unverified: readonly string[];
}

export interface SurfaceDelta {
    [list: string]: { added: readonly string[]; removed: readonly string[] };
}

/** Outputs of `CAPTURE_COMMANDS`, parsed by the caller. */
export interface Captures {
    /** `schema manifest` of the CLI (the shape of `tests/compat/manifest-<v>.json`). */
    cliManifest?: unknown;
    /** `schema status` of the CLI (a JSON Schema whose `properties` are the envelope fields). */
    cliStatus?: unknown;
    /** `schema list` of the CLI (`{ subjects: [...] }`). */
    cliSubjects?: unknown;
    /** `capabilityManifest()` of pdfnative-react (the shape of `manifest.v<v>.json`). */
    reactManifest?: unknown;
    /** The MCP prompt names when the caller has them (else derived from `src/server.ts`). */
    mcpPrompts?: readonly string[];
}

export interface SatelliteFacts {
    generatedOn: string;
    engineVersion: string;
    satellites: Partial<
        Record<
            SatelliteName,
            {
                surface: SatelliteSurface;
                previous: SatelliteSurface | null;
                delta: SurfaceDelta;
                /** What pdfnative's own `docs/assets/ecosystem.json` says today. */
                manifestToday: { version: string; pin: string | null; counts: Record<string, number> };
            }
        >
    >;
}

export interface BlindSpot {
    id: string;
    /** A path relative to the pdfnative root, or `'*'` for every documentation file. */
    file: string | '*';
    /** Global; `versionGroup` captures the version, `nameGroup` the package name when `package` is null. */
    pattern: RegExp;
    package: SatelliteName | null;
    nameGroup?: number;
    versionGroup: number;
    /** When set, the same match also yields the engine pin (bare version, `^` stripped) in this group. */
    pinGroup?: number;
    kind: 'version' | 'pin';
    description: string;
}

/** Commands a caller runs in the satellite root to obtain `Captures` (stdout is the JSON). */
export const CAPTURE_COMMANDS: Readonly<Record<SatelliteName, readonly string[]>> = {
    'pdfnative-cli': [
        'npx tsx src/index.ts schema manifest',
        'npx tsx src/index.ts schema status',
        'npx tsx src/index.ts schema list',
    ],
    'pdfnative-mcp': [],
    'pdfnative-react': [
        'npx tsx -e "import(\'./src/index.ts\').then((m) => console.log(JSON.stringify(m.capabilityManifest())))"',
    ],
};

// ── Small helpers ───────────────────────────────────────────────────

type Dict = Record<string, unknown>;

const isRecord = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const stringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const recordArray = (v: unknown): Dict[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const get = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((o, k) => (isRecord(o) ? o[k] : undefined), v);
const unique = (items: readonly string[]): string[] => [...new Set(items)];
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function compareSemver(a: string, b: string): number {
    const pa = SEMVER.exec(a);
    const pb = SEMVER.exec(b);
    if (!pa || !pb) return a.localeCompare(b);
    for (let i = 1; i <= 3; i++) {
        const d = Number(pa[i]) - Number(pb[i]);
        if (d !== 0) return d;
    }
    return 0;
}

/** The bare version of a range (`^1.9.0`, `~1.9.0`, `>=1.9.0` → `1.9.0`). */
export function rangeMinimum(range: string | null): string | null {
    if (range === null) return null;
    const m = /(\d+\.\d+\.\d+)/.exec(range);
    return m ? m[1] : null;
}

/** The highest semver `v` among the files `<prefix><v><suffix>` of a directory. */
function highestVersion(dir: string, prefix: string, suffix: string): string | null {
    if (!existsSync(dir)) return null;
    let best: string | null = null;
    for (const file of readdirSync(dir)) {
        if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;
        const v = file.slice(prefix.length, file.length - suffix.length);
        if (!SEMVER.test(v)) continue;
        if (best === null || compareSemver(v, best) > 0) best = v;
    }
    return best;
}

/** One satellite checkout; records every file read. */
interface Reader {
    readonly root: string;
    readonly sources: string[];
    readonly unverified: string[];
}

function readText(r: Reader, rel: string): string | null {
    const path = join(r.root, rel);
    if (!existsSync(path)) return null;
    if (!r.sources.includes(rel)) r.sources.push(rel);
    return readFileSync(path, 'utf8');
}

function readJson(r: Reader, rel: string): unknown {
    const text = readText(r, rel);
    if (text === null) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        r.unverified.push(`${rel}: not valid JSON`);
        return undefined;
    }
}

function walkTs(dir: string, out: string[]): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walkTs(path, out);
        else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(path);
    }
}

// ── Common extraction ───────────────────────────────────────────────

interface PackageFacts {
    version: string;
    engine: SatelliteSurface['engine'];
    runtime: SatelliteSurface['runtime'];
    peers: Record<string, string>;
}

function readPackage(r: Reader): PackageFacts {
    const pkg = readJson(r, 'package.json');
    const version = asString(get(pkg, 'version')) ?? '0.0.0';
    if (pkg === undefined) r.unverified.push('package.json: missing — version, pin and Node floor unknown');
    const dep = asString(get(pkg, 'dependencies', 'pdfnative'));
    const peer = asString(get(pkg, 'peerDependencies', 'pdfnative'));
    const pin = dep ?? peer;
    const pinField: SatelliteSurface['engine']['pinField'] = dep !== null ? 'dependencies' : peer !== null ? 'peerDependencies' : null;
    const peers: Record<string, string> = {};
    const peerDeps = get(pkg, 'peerDependencies');
    if (isRecord(peerDeps)) for (const [k, v] of Object.entries(peerDeps)) if (typeof v === 'string') peers[k] = v;
    return {
        version,
        engine: { pin, pinField, minimum: rangeMinimum(pin) },
        runtime: { node: asString(get(pkg, 'engines', 'node')) },
        peers,
    };
}

/** The lines of one `## ` section (heading matched by `heading`), without the heading. */
function sectionLines(text: string, heading: RegExp): string[] | null {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => heading.test(l));
    if (start === -1) return null;
    const out: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
        if (/^## /.test(lines[i])) break;
        out.push(lines[i]);
    }
    return out;
}

/** Top-level and nested bullets of a section, continuation lines joined. */
export function bulletsOf(lines: readonly string[]): string[] {
    const out: string[] = [];
    let open = false;
    for (const line of lines) {
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        if (bullet) {
            out.push(bullet[1].trim());
            open = true;
        } else if (open && /^\s{2,}\S/.test(line)) {
            out[out.length - 1] += ` ${line.trim()}`;
        } else {
            open = false;
        }
    }
    return out.map(collapse).filter((s) => s.length > 0);
}

const LEDGER_MAX = 15;

function readLedger(r: Reader, version: string): { ledger: SatelliteSurface['ledger']; releasedOn: string | null } {
    let releasedOn: string | null = null;
    let bullets: string[] | null = null;
    let prefix = 'rn';

    const changelog = readText(r, 'CHANGELOG.md');
    let changelogBullets: string[] = [];
    if (changelog !== null) {
        const lines = changelog.split(/\r?\n/);
        const top = lines.findIndex((l) => /^## \[?\d+\.\d+\.\d+\]?/.test(l));
        if (top !== -1) {
            const date = /(\d{4}-\d{2}-\d{2})/.exec(lines[top]);
            const topVersion = /(\d+\.\d+\.\d+)/.exec(lines[top]);
            if (date && topVersion && topVersion[1] === version) releasedOn = date[1];
            const section: string[] = [];
            for (let i = top + 1; i < lines.length && !/^## /.test(lines[i]); i++) section.push(lines[i]);
            changelogBullets = bulletsOf(section);
        }
    }

    const note = readText(r, `release-notes/v${version}.md`);
    if (note !== null) {
        const section = sectionLines(note, /^## Downstream/);
        if (section !== null) bullets = bulletsOf(section);
    }
    if (bullets === null || bullets.length === 0) {
        bullets = changelogBullets;
        prefix = 'cl';
    }
    if (bullets.length === 0) r.unverified.push('ledger: no Downstream section in the release note and no bullet in the top CHANGELOG entry');
    const ledger = bullets.slice(0, LEDGER_MAX).map((summary, i) => ({ id: `${prefix}-${i + 1}`, summary: cut(summary, 240) }));
    return { ledger, releasedOn };
}

const SHORT: Record<SatelliteName, string> = { 'pdfnative-cli': 'cli', 'pdfnative-mcp': 'mcp', 'pdfnative-react': 'react' };

function docsFor(r: Reader, name: SatelliteName): SatelliteSurface['docs'] {
    const agentContract = existsSync(join(r.root, 'docs', 'AGENT_CONTRACT.md')) ? 'docs/AGENT_CONTRACT.md' : null;
    return {
        guide: `https://pdfnative.dev/guides/${SHORT[name]}.html`,
        llms: `https://raw.githubusercontent.com/Nizoka/${name}/main/llms.txt`,
        agentContract,
    };
}

const CONSTRAINT_WORDS = /mutually exclusive|not combinable|cannot be combined|incompatible with/i;
const CONSTRAINTS_MAX = 20;

/** Cross-field constraints stated as literals in `src/**\/*.ts` — the sentence around each hit. */
function scanConstraints(r: Reader): string[] {
    const files: string[] = [];
    walkTs(join(r.root, 'src'), files);
    const out: string[] = [];
    for (const path of files.sort()) {
        const rel = path.slice(r.root.length + 1).replace(/\\/g, '/');
        const lines = readFileSync(path, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length && out.length < CONSTRAINTS_MAX; i++) {
            if (!CONSTRAINT_WORDS.test(lines[i]) || /^\s*(?:\/\/|\/?\*)/.test(lines[i])) continue;
            if (!r.sources.includes(rel)) r.sources.push(rel);
            const before = i > 0 ? lines[i - 1] : '';
            const sentence = collapse(`${before} ${lines[i]}`).replace(/^[`'"+\s]+/, '').replace(/[`'"+,;\s]+$/, '');
            out.push(`${rel}:${i + 1}: ${cut(sentence, 160)}`);
        }
    }
    return out;
}

/** Lists with a verified flag, resolved into counts against the satellite's own figures. */
interface Bag {
    readonly r: Reader;
    readonly lists: Record<string, string[]>;
    readonly verified: Set<string>;
    readonly counts: Record<string, number>;
}

const newBag = (r: Reader): Bag => ({ r, lists: {}, verified: new Set<string>(), counts: {} });

function addList(bag: Bag, key: string, items: readonly string[] | null, verified: boolean, origin: string): void {
    if (items === null) return;
    bag.lists[key] = [...items];
    if (verified) bag.verified.add(key);
    else bag.r.unverified.push(`${key}: taken from ${origin} — run the capture to verify the current release`);
}

/** `eco` holds the satellite's own count per key; a verified list wins and a mismatch is reported. */
function resolveCounts(bag: Bag, eco: Record<string, number | null>): void {
    for (const [key, items] of Object.entries(bag.lists)) {
        const own = eco[key] ?? null;
        if (bag.verified.has(key)) {
            bag.counts[key] = items.length;
            if (own !== null && own !== items.length) bag.r.unverified.push(`${key}: derived ${items.length} items but ecosystem.json says ${own}`);
        } else {
            bag.counts[key] = own ?? items.length;
        }
    }
    for (const [key, own] of Object.entries(eco)) if (own !== null && !(key in bag.counts)) bag.counts[key] = own;
}

// ── pdfnative-cli ───────────────────────────────────────────────────

interface CliManifest {
    commands: { name: string; flags: string[] }[];
    globalFlags: string[];
    errorCodes: string[];
}

function parseCliManifest(raw: unknown): CliManifest | null {
    if (!isRecord(raw) || !Array.isArray(raw.commands)) return null;
    return {
        commands: recordArray(raw.commands)
            .filter((c) => typeof c.name === 'string')
            .map((c) => ({ name: c.name as string, flags: stringArray(c.flags) })),
        globalFlags: stringArray(raw.globalFlags),
        errorCodes: stringArray(raw.errorCodes),
    };
}

const parseCliStatus = (raw: unknown): string[] | null => (isRecord(get(raw, 'properties')) ? Object.keys(get(raw, 'properties') as Dict) : null);
const parseCliSubjects = (raw: unknown): string[] | null => (Array.isArray(get(raw, 'subjects')) ? stringArray(get(raw, 'subjects')) : null);

function groupIndex(groups: unknown): Map<string, string> {
    const index = new Map<string, string>();
    if (isRecord(groups)) for (const [group, members] of Object.entries(groups)) for (const m of stringArray(members)) index.set(m, group);
    return index;
}

function cliLists(bag: Bag, manifest: CliManifest | null, status: string[] | null, subjects: string[] | null, groups: Map<string, string>, verified: boolean, origin: string): SatelliteSurface['structured'] {
    if (manifest !== null) {
        addList(bag, 'globalFlags', manifest.globalFlags, verified, origin);
        addList(bag, 'errorCodes', manifest.errorCodes, verified, origin);
        const render = manifest.commands.find((c) => c.name === 'render');
        if (render) addList(bag, 'renderFlags', render.flags, verified, origin);
    }
    addList(bag, 'statusFields', status, verified, origin);
    addList(bag, 'schemaSubjects', subjects, verified, origin);
    if (manifest === null) return {};
    return { commands: manifest.commands.map((c) => ({ name: c.name, group: groups.get(c.name) ?? null, flags: c.flags })) };
}

function readCli(r: Reader, captures: Captures): Omit<SatelliteSurface, 'package' | 'mode' | 'sources' | 'unverified' | 'docs' | 'ledger' | 'releasedOn'> {
    const pkg = readPackage(r);
    const eco = readJson(r, 'docs/assets/ecosystem.json');
    const groups = groupIndex(get(eco, 'derived', 'commandGroups'));
    const previous = highestVersion(join(r.root, 'tests', 'compat'), 'manifest-', '.json');
    const bag = newBag(r);

    const current = parseCliManifest(captures.cliManifest);
    const currentStatus = parseCliStatus(captures.cliStatus);
    const currentSubjects = parseCliSubjects(captures.cliSubjects);
    const prevOrigin = `tests/compat/*-${previous ?? '?'}.json (previous release)`;
    const prevManifest = previous === null || current !== null ? null : parseCliManifest(readJson(r, `tests/compat/manifest-${previous}.json`));
    const prevStatus = previous === null || currentStatus !== null ? null : parseCliStatus(readJson(r, `tests/compat/status-${previous}.json`));
    const prevSubjects = previous === null || currentSubjects !== null ? null : parseCliSubjects(readJson(r, `tests/compat/subjects-${previous}.json`));

    const ecoCommands = [...groups.keys()];
    if (current !== null) addList(bag, 'commands', current.commands.map((c) => c.name), true, 'capture');
    else if (ecoCommands.length > 0) addList(bag, 'commands', ecoCommands, true, 'ecosystem.json');
    else if (prevManifest !== null) addList(bag, 'commands', prevManifest.commands.map((c) => c.name), false, prevOrigin);

    let structured = cliLists(bag, current, currentStatus, currentSubjects, groups, true, 'capture');
    const fromPrev = cliLists(bag, prevManifest, prevStatus, prevSubjects, groups, false, prevOrigin);
    if (!structured.commands && fromPrev.commands) structured = fromPrev;
    if (current === null && prevManifest === null) r.unverified.push('commands flags, globalFlags, errorCodes, renderFlags: no capture and no tests/compat manifest');
    if (currentStatus === null && prevStatus === null) r.unverified.push('statusFields: no capture and no tests/compat status schema');

    resolveCounts(bag, {
        commands: asNumber(get(eco, 'derived', 'commands')),
        schemaSubjects: asNumber(get(eco, 'derived', 'schemaSubjects')),
        errorCodes: asNumber(get(eco, 'derived', 'errorCodes')),
        globalFlags: asNumber(get(eco, 'derived', 'globalFlags')),
        bundledFontModules: asNumber(get(eco, 'declared', 'bundledFontModules')),
        unicodeScripts: asNumber(get(eco, 'declared', 'unicodeScripts')),
        diagnosticCodes: asNumber(get(eco, 'declared', 'diagnosticCodes')),
    });
    if (eco === undefined) r.unverified.push('docs/assets/ecosystem.json: missing — command groups and declared counts unknown');

    const constraints = [...pinConstraints(pkg), ...scanConstraints(r)];
    return { version: pkg.version, previous, engine: pkg.engine, runtime: pkg.runtime, lists: bag.lists, structured, counts: bag.counts, constraints };
}

function pinConstraints(pkg: PackageFacts): string[] {
    const out: string[] = [];
    if (pkg.engine.pin !== null) out.push(`pdfnative ${pkg.engine.pin} (${pkg.engine.pinField})`);
    if (pkg.runtime.node !== null) out.push(`node ${pkg.runtime.node}`);
    for (const [name, range] of Object.entries(pkg.peers)) if (name !== 'pdfnative') out.push(`${name} ${range} (peerDependencies)`);
    return out;
}

// ── pdfnative-mcp ───────────────────────────────────────────────────

/** The `examples/*.json` files of the checkout (what `derived.examples` counts), sorted; null without the directory. */
function exampleFiles(r: Reader): string[] | null {
    const dir = join(r.root, 'examples');
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
    if (!r.sources.includes('examples/*.json')) r.sources.push('examples/*.json');
    return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort();
}

interface ToolShape {
    tools: { name: string; inputs: string[] }[];
    /** Σ `exampleCount` over the tools — not every example file maps to a tool, so this is not `examples`. */
    toolExamples: number;
    langValues: string[];
    colourSites: number;
}

/** The distinct JSON-pointer parents of a property named `spot` (one colour site each). */
function spotSites(node: unknown, pointer: string, sites: Set<string>): void {
    if (Array.isArray(node)) {
        node.forEach((item, i) => spotSites(item, `${pointer}/${i}`, sites));
        return;
    }
    if (!isRecord(node)) return;
    if (isRecord(node.properties) && 'spot' in node.properties) sites.add(pointer);
    for (const [k, v] of Object.entries(node)) spotSites(v, `${pointer}/${k}`, sites);
}

function enumValues(schema: unknown): string[] {
    if (Array.isArray(get(schema, 'enum'))) return stringArray(get(schema, 'enum'));
    for (const branch of recordArray(get(schema, 'anyOf') ?? get(schema, 'oneOf'))) {
        const found = enumValues(branch);
        if (found.length > 0) return found;
    }
    return [];
}

function parseToolShape(raw: unknown): ToolShape | null {
    if (!Array.isArray(raw)) return null;
    const tools = recordArray(raw).filter((t) => typeof t.name === 'string');
    const sites = new Set<string>();
    spotSites(raw, '', sites);
    const international = tools.find((t) => t.name === 'add_international_text');
    return {
        tools: tools.map((t) => ({ name: t.name as string, inputs: isRecord(get(t, 'inputSchema', 'properties')) ? Object.keys(get(t, 'inputSchema', 'properties') as Dict) : [] })),
        toolExamples: tools.reduce((sum, t) => sum + (asNumber(t.exampleCount) ?? 0), 0),
        langValues: international ? enumValues(get(international, 'inputSchema', 'properties', 'lang')) : [],
        colourSites: sites.size,
    };
}

/** `default <value>` inside an environment variable description (`default 10000`, `(default 104857600 = 100 MiB)`). */
export function defaultOfDescription(description: string): string | null {
    const m = /\bdefault\s+([^\s;,)]+)/i.exec(description);
    return m ? m[1] : null;
}

function parseServerEnv(raw: unknown): NonNullable<SatelliteSurface['structured']['envVars']> | null {
    const pkgs = recordArray(get(raw, 'packages'));
    if (pkgs.length === 0) return null;
    const vars = recordArray(pkgs[0].environmentVariables).filter((v) => typeof v.name === 'string');
    return vars.map((v) => ({ name: v.name as string, default: defaultOfDescription(asString(v.description) ?? ''), isSecret: v.isSecret === true }));
}

/** The `name: '<prompt>'` entries of the `PROMPTS` table of `src/server.ts`. */
export function promptNamesOf(serverText: string): string[] {
    const start = serverText.search(/^(?:export )?const PROMPTS\b/m);
    if (start === -1) return [];
    const rest = serverText.slice(start);
    const end = rest.search(/^\];/m);
    const table = end === -1 ? rest : rest.slice(0, end);
    return [...table.matchAll(/^\s+name:\s*'([a-z][a-z0-9_]*)'\s*,/gm)].map((m) => m[1]);
}

/** Every `ToolError('CODE'` literal of `src/**\/*.ts` plus the `super('CODE'` of `src/errors.ts`. */
function mcpErrorCodes(r: Reader): string[] | null {
    const files: string[] = [];
    walkTs(join(r.root, 'src'), files);
    if (files.length === 0) return null;
    const codes: string[] = [];
    for (const path of files.sort()) {
        const text = readFileSync(path, 'utf8');
        for (const m of text.matchAll(/ToolError\(\s*'([A-Z][A-Z0-9_]+)'/g)) codes.push(m[1]);
        if (path.replace(/\\/g, '/').endsWith('/src/errors.ts')) for (const m of text.matchAll(/super\(\s*'([A-Z][A-Z0-9_]+)'/g)) codes.push(m[1]);
    }
    if (!r.sources.includes('src/**/*.ts')) r.sources.push('src/**/*.ts');
    return unique(codes).sort();
}

function mcpLists(bag: Bag, shape: ToolShape | null, groups: Map<string, string>, verified: boolean, origin: string): SatelliteSurface['structured'] {
    if (shape === null) return {};
    addList(bag, 'tools', shape.tools.map((t) => t.name), verified, origin);
    addList(bag, 'langValues', shape.langValues, verified, origin);
    return { tools: shape.tools.map((t) => ({ name: t.name, group: groups.get(t.name) ?? null, inputs: t.inputs })) };
}

function readMcp(r: Reader, captures: Captures): ReturnType<typeof readCli> {
    const pkg = readPackage(r);
    const eco = readJson(r, 'docs/assets/ecosystem.json');
    const groups = groupIndex(get(eco, 'derived', 'toolGroups'));
    const previous = highestVersion(join(r.root, 'tests', '_fixtures'), 'tool-shape.v', '.json');
    const bag = newBag(r);

    const shape = parseToolShape(readJson(r, 'tests/_fixtures/tool-shape.json'));
    const structured: SatelliteSurface['structured'] = { ...mcpLists(bag, shape, groups, true, 'tests/_fixtures/tool-shape.json') };
    if (shape === null) r.unverified.push('tools, inputs, toolExamples, langValues, colourSites: tests/_fixtures/tool-shape.json missing');

    const examples = exampleFiles(r);
    if (examples !== null) addList(bag, 'examples', examples, true, 'examples/');
    else r.unverified.push('examples: no examples/ directory — count taken from ecosystem.json');

    const env = parseServerEnv(readJson(r, 'server.json'));
    if (env !== null) {
        structured.envVars = env;
        addList(bag, 'envVars', env.map((v) => v.name), true, 'server.json');
    } else r.unverified.push('envVars: server.json missing or without packages[0].environmentVariables');

    if (captures.mcpPrompts) addList(bag, 'prompts', captures.mcpPrompts, true, 'capture');
    else {
        const server = readText(r, 'src/server.ts');
        const prompts = server === null ? [] : promptNamesOf(server);
        if (prompts.length > 0) addList(bag, 'prompts', prompts, true, 'src/server.ts');
        else r.unverified.push('prompts: no capture and no PROMPTS table in src/server.ts');
    }
    const codes = mcpErrorCodes(r);
    if (codes !== null) addList(bag, 'errorCodes', codes, true, 'src/**/*.ts');
    else r.unverified.push('errorCodes: src/ missing — count taken from ecosystem.json');

    resolveCounts(bag, {
        tools: asNumber(get(eco, 'derived', 'tools')),
        prompts: asNumber(get(eco, 'derived', 'prompts')),
        envVars: asNumber(get(eco, 'derived', 'envVars')),
        errorCodes: asNumber(get(eco, 'derived', 'errorCodes')),
        examples: asNumber(get(eco, 'derived', 'examples')),
        unicodeScripts: asNumber(get(eco, 'declared', 'unicodeScripts')),
        diagnosticCodes: asNumber(get(eco, 'declared', 'diagnosticCodes')),
    });
    if (shape !== null) {
        bag.counts.toolExamples = shape.toolExamples;
        bag.counts.colourSites = shape.colourSites;
    }
    if (eco === undefined) r.unverified.push('docs/assets/ecosystem.json: missing — tool groups and declared counts unknown');

    const constraints = [...pinConstraints(pkg), ...scanConstraints(r)];
    return { version: pkg.version, previous, engine: pkg.engine, runtime: pkg.runtime, lists: bag.lists, structured, counts: bag.counts, constraints };
}

// ── pdfnative-react ─────────────────────────────────────────────────

interface ReactManifest {
    components: string[];
    clientComponents: string[];
    blocks: string[];
    specFields: string[];
    lintRules: { code: string; severity: string }[];
    errorCodes: string[];
    schemaSubjects: string[];
    entrypoints: string[];
    engine: string | null;
}

const names = (v: unknown): string[] => recordArray(v).map((x) => asString(x.name)).filter((n): n is string => n !== null);

function parseReactManifest(raw: unknown): ReactManifest | null {
    if (!isRecord(raw) || !Array.isArray(raw.components)) return null;
    return {
        components: names(raw.components),
        clientComponents: names(raw.clientComponents),
        blocks: recordArray(raw.specBlocks).map((b) => stringArray(b.kinds).join('|')).filter((s) => s.length > 0),
        specFields: stringArray(raw.specFields),
        lintRules: recordArray(raw.lintRules)
            .filter((l) => typeof l.code === 'string')
            .map((l) => ({ code: l.code as string, severity: asString(l.severity) ?? 'unknown' })),
        errorCodes: stringArray(raw.errorCodes),
        schemaSubjects: stringArray(raw.schemaSubjects),
        entrypoints: names(raw.entrypoints),
        engine: asString(get(raw, 'contract', 'engine')),
    };
}

function reactLists(bag: Bag, m: ReactManifest | null, verified: boolean, origin: string): SatelliteSurface['structured'] {
    if (m === null) return {};
    addList(bag, 'components', m.components, verified, origin);
    addList(bag, 'clientComponents', m.clientComponents, verified, origin);
    addList(bag, 'blocks', m.blocks, verified, origin);
    addList(bag, 'specFields', m.specFields, verified, origin);
    addList(bag, 'lintRules', m.lintRules.map((l) => l.code), verified, origin);
    addList(bag, 'errorCodes', m.errorCodes, verified, origin);
    addList(bag, 'schemaSubjects', m.schemaSubjects, verified, origin);
    addList(bag, 'entrypoints', m.entrypoints, verified, origin);
    return { lintRules: m.lintRules };
}

function severitySplit(rules: readonly { severity: string }[]): Record<string, number> {
    const count = (s: string): number => rules.filter((r) => r.severity === s).length;
    return { lintErrors: count('error'), lintWarnings: count('warning'), lintInfos: count('info') };
}

function readReact(r: Reader, captures: Captures): ReturnType<typeof readCli> {
    const pkg = readPackage(r);
    const eco = readJson(r, 'docs/assets/ecosystem.json');
    const previous = highestVersion(join(r.root, 'tests', 'regression', 'baselines'), 'manifest.v', '.json');
    const bag = newBag(r);

    const current = parseReactManifest(captures.reactManifest);
    const prevOrigin = `tests/regression/baselines/manifest.v${previous ?? '?'}.json (previous release)`;
    const prev = current !== null || previous === null ? null : parseReactManifest(readJson(r, `tests/regression/baselines/manifest.v${previous}.json`));
    const used = current ?? prev;
    const structured = reactLists(bag, used, current !== null, prevOrigin);
    if (used === null) r.unverified.push('components, clientComponents, blocks, specFields, lintRules, errorCodes, schemaSubjects, entrypoints: no capture and no baseline manifest');

    resolveCounts(bag, {
        components: asNumber(get(eco, 'derived', 'components')),
        clientComponents: asNumber(get(eco, 'derived', 'clientComponents')),
        blocks: asNumber(get(eco, 'derived', 'blocks')),
        specFields: asNumber(get(eco, 'derived', 'specFields')),
        lintRules: asNumber(get(eco, 'derived', 'lintRules')),
        errorCodes: asNumber(get(eco, 'derived', 'errorCodes')),
        schemaSubjects: asNumber(get(eco, 'derived', 'schemaSubjects')),
        unicodeScripts: asNumber(get(eco, 'declared', 'unicodeScripts')),
        diagnosticCodes: asNumber(get(eco, 'declared', 'diagnosticCodes')),
    });
    if (current !== null) Object.assign(bag.counts, severitySplit(current.lintRules));
    else r.unverified.push('lintErrors, lintWarnings, lintInfos: the severity split needs captures.reactManifest (capabilityManifest())');
    if (eco === undefined) r.unverified.push('docs/assets/ecosystem.json: missing — derived counts unknown');

    const constraints = [...pinConstraints(pkg), ...scanConstraints(r)];
    return { version: pkg.version, previous, engine: pkg.engine, runtime: pkg.runtime, lists: bag.lists, structured, counts: bag.counts, constraints };
}

// ── Public: read, previous, normalise ───────────────────────────────

const READERS: Record<SatelliteName, (r: Reader, captures: Captures) => ReturnType<typeof readCli>> = {
    'pdfnative-cli': readCli,
    'pdfnative-mcp': readMcp,
    'pdfnative-react': readReact,
};

/** A full surface from a `surface.json`-shaped value (contract mode), every field defaulted. */
export function normaliseSurface(raw: unknown, name: SatelliteName, sources: readonly string[] = ['docs/assets/surface.json']): SatelliteSurface {
    const lists: Record<string, readonly string[]> = {};
    const rawLists = get(raw, 'lists');
    if (isRecord(rawLists)) for (const [k, v] of Object.entries(rawLists)) if (Array.isArray(v)) lists[k] = stringArray(v);
    const counts: Record<string, number> = {};
    const rawCounts = get(raw, 'counts');
    if (isRecord(rawCounts)) for (const [k, v] of Object.entries(rawCounts)) if (typeof v === 'number') counts[k] = v;
    const pinField = asString(get(raw, 'engine', 'pinField'));
    const pin = asString(get(raw, 'engine', 'pin'));
    const structured: SatelliteSurface['structured'] = {};
    const rawStructured = get(raw, 'structured');
    if (isRecord(rawStructured)) {
        if (Array.isArray(rawStructured.commands)) structured.commands = recordArray(rawStructured.commands).map((c) => ({ name: asString(c.name) ?? '', group: asString(c.group), flags: stringArray(c.flags) }));
        if (Array.isArray(rawStructured.tools)) structured.tools = recordArray(rawStructured.tools).map((t) => ({ name: asString(t.name) ?? '', group: asString(t.group), inputs: stringArray(t.inputs) }));
        if (Array.isArray(rawStructured.envVars)) structured.envVars = recordArray(rawStructured.envVars).map((v) => ({ name: asString(v.name) ?? '', default: asString(v.default), isSecret: v.isSecret === true }));
        if (Array.isArray(rawStructured.lintRules)) structured.lintRules = recordArray(rawStructured.lintRules).map((l) => ({ code: asString(l.code) ?? '', severity: asString(l.severity) ?? 'unknown' }));
    }
    const mode = get(raw, 'mode') === 'degraded' ? 'degraded' : 'contract';
    return {
        package: name,
        version: asString(get(raw, 'version')) ?? '0.0.0',
        previous: asString(get(raw, 'previous')),
        releasedOn: asString(get(raw, 'releasedOn')),
        engine: { pin, pinField: pinField === 'dependencies' || pinField === 'peerDependencies' ? pinField : null, minimum: asString(get(raw, 'engine', 'minimum')) ?? rangeMinimum(pin) },
        runtime: { node: asString(get(raw, 'runtime', 'node')) },
        lists,
        structured,
        counts,
        constraints: stringArray(get(raw, 'constraints')),
        ledger: recordArray(get(raw, 'ledger')).map((l, i) => ({ id: asString(l.id) ?? `c-${i + 1}`, summary: asString(l.summary) ?? '' })),
        docs: {
            guide: asString(get(raw, 'docs', 'guide')) ?? `https://pdfnative.dev/guides/${SHORT[name]}.html`,
            llms: asString(get(raw, 'docs', 'llms')) ?? `https://raw.githubusercontent.com/Nizoka/${name}/main/llms.txt`,
            agentContract: asString(get(raw, 'docs', 'agentContract')),
        },
        mode,
        sources: [...sources],
        unverified: stringArray(get(raw, 'unverified')),
    };
}

/**
 * The surface of one satellite checkout: `docs/assets/surface.json` when the
 * satellite ships the contract, else derived from its committed artefacts and
 * the optional `captures`.
 */
export function readSurfaceOrDerive(root: string, name: SatelliteName, captures: Captures = {}): SatelliteSurface {
    const r: Reader = { root, sources: [], unverified: [] };
    const contract = readJson(r, 'docs/assets/surface.json');
    if (contract !== undefined) return normaliseSurface(contract, name, r.sources);
    const read = READERS[name](r, captures);
    const { ledger, releasedOn } = readLedger(r, read.version);
    if (releasedOn === null) r.unverified.push('releasedOn: no dated CHANGELOG heading for this version');
    return {
        package: name,
        ...read,
        releasedOn,
        ledger,
        docs: docsFor(r, name),
        mode: 'degraded',
        sources: r.sources,
        unverified: unique(r.unverified),
    };
}

/**
 * The previous release's surface, from the captures the satellite commits
 * for it (`tests/compat/*-<prev>.json`, `tool-shape.v<prev>.json`,
 * `manifest.v<prev>.json`) — the `prev` side of `diffSurface` in degraded
 * mode. Null when no previous capture exists.
 */
export function readPreviousSurface(root: string, name: SatelliteName): SatelliteSurface | null {
    const r: Reader = { root, sources: [], unverified: [] };
    const bag = newBag(r);
    let version: string | null = null;
    let structured: SatelliteSurface['structured'] = {};
    let engine: SatelliteSurface['engine'] = { pin: null, pinField: null, minimum: null };
    if (name === 'pdfnative-cli') {
        version = highestVersion(join(root, 'tests', 'compat'), 'manifest-', '.json');
        if (version === null) return null;
        const groups = groupIndex(get(readJson(r, 'docs/assets/ecosystem.json'), 'derived', 'commandGroups'));
        const manifest = parseCliManifest(readJson(r, `tests/compat/manifest-${version}.json`));
        if (manifest !== null) addList(bag, 'commands', manifest.commands.map((c) => c.name), true, '');
        structured = cliLists(bag, manifest, parseCliStatus(readJson(r, `tests/compat/status-${version}.json`)), parseCliSubjects(readJson(r, `tests/compat/subjects-${version}.json`)), groups, true, '');
    } else if (name === 'pdfnative-mcp') {
        version = highestVersion(join(root, 'tests', '_fixtures'), 'tool-shape.v', '.json');
        if (version === null) return null;
        const groups = groupIndex(get(readJson(r, 'docs/assets/ecosystem.json'), 'derived', 'toolGroups'));
        const shape = parseToolShape(readJson(r, `tests/_fixtures/tool-shape.v${version}.json`));
        structured = mcpLists(bag, shape, groups, true, '');
        if (shape !== null) {
            bag.counts.toolExamples = shape.toolExamples;
            bag.counts.colourSites = shape.colourSites;
        }
    } else {
        version = highestVersion(join(root, 'tests', 'regression', 'baselines'), 'manifest.v', '.json');
        if (version === null) return null;
        const manifest = parseReactManifest(readJson(r, `tests/regression/baselines/manifest.v${version}.json`));
        structured = reactLists(bag, manifest, true, '');
        if (manifest !== null) {
            Object.assign(bag.counts, severitySplit(manifest.lintRules));
            engine = { pin: manifest.engine, pinField: manifest.engine === null ? null : 'peerDependencies', minimum: rangeMinimum(manifest.engine) };
        }
    }
    resolveCounts(bag, {});
    return {
        package: name,
        version,
        previous: null,
        releasedOn: null,
        engine,
        runtime: { node: null },
        lists: bag.lists,
        structured,
        counts: bag.counts,
        constraints: [],
        ledger: [],
        docs: docsFor(r, name),
        mode: 'degraded',
        sources: r.sources,
        unverified: unique(r.unverified),
    };
}

// ── Delta ───────────────────────────────────────────────────────────

function setDiff(prev: readonly string[], next: readonly string[]): { added: string[]; removed: string[] } {
    const p = new Set(prev);
    const n = new Set(next);
    return {
        added: [...n].filter((x) => !p.has(x)).sort(),
        removed: [...p].filter((x) => !n.has(x)).sort(),
    };
}

/**
 * Added and removed items per list present on both sides, plus the
 * pseudo-lists `flags:<command>` and `inputs:<tool>` for structured items
 * present on both sides. Unchanged lists are omitted; a null `prev` gives `{}`.
 */
export function diffSurface(prev: SatelliteSurface | null, next: SatelliteSurface): SurfaceDelta {
    const out: SurfaceDelta = {};
    if (prev === null) return out;
    for (const key of Object.keys(next.lists)) {
        const before = prev.lists[key];
        if (before === undefined) continue;
        const d = setDiff(before, next.lists[key]);
        if (d.added.length > 0 || d.removed.length > 0) out[key] = d;
    }
    const structuredDiff = (prefix: string, a: readonly { name: string; items: readonly string[] }[] | undefined, b: readonly { name: string; items: readonly string[] }[] | undefined): void => {
        if (!a || !b) return;
        const byName = new Map(a.map((x) => [x.name, x.items]));
        for (const item of b) {
            const before = byName.get(item.name);
            if (before === undefined) continue;
            const d = setDiff(before, item.items);
            if (d.added.length > 0 || d.removed.length > 0) out[`${prefix}:${item.name}`] = d;
        }
    };
    structuredDiff('flags', prev.structured.commands?.map((c) => ({ name: c.name, items: c.flags })), next.structured.commands?.map((c) => ({ name: c.name, items: c.flags })));
    structuredDiff('inputs', prev.structured.tools?.map((t) => ({ name: t.name, items: t.inputs })), next.structured.tools?.map((t) => ({ name: t.name, items: t.inputs })));
    return out;
}

// ── Facts sheet ─────────────────────────────────────────────────────

export const FACTS_MAX_LINES = 300;

/** Comma-joined items cut at `max` characters, the remainder counted. */
export function joinCut(items: readonly string[], max: number): string {
    let out = '';
    let shown = 0;
    for (const item of items) {
        const next = shown === 0 ? item : `${out}, ${item}`;
        if (next.length > max && shown > 0) break;
        out = next;
        shown++;
    }
    return shown < items.length ? `${out}… (+${items.length - shown})` : out;
}

interface RenderBudget {
    listChars: number;
    lists: boolean;
    ledger: number;
}

const BUDGETS: readonly RenderBudget[] = [
    { listChars: 200, lists: true, ledger: LEDGER_MAX },
    { listChars: 100, lists: true, ledger: LEDGER_MAX },
    { listChars: 60, lists: true, ledger: 5 },
    { listChars: 0, lists: false, ledger: 5 },
    { listChars: 0, lists: false, ledger: 0 },
];

const dash = (v: string | number | null | undefined): string => (v === null || v === undefined ? '—' : String(v));
const cell = (s: string): string => s.replace(/\|/g, '\\|');

function renderLines(facts: SatelliteFacts, budget: RenderBudget): string[] {
    const lines: string[] = [];
    const entries = SATELLITES.flatMap((n) => {
        const e = facts.satellites[n];
        return e === undefined ? [] : [[n, e] as const];
    });

    lines.push(`# Satellite facts — ${facts.generatedOn} (pdfnative ${facts.engineVersion})`, '');
    for (const [name, e] of entries) {
        const s = e.surface;
        const pin = s.engine.pin === null ? 'no engine pin' : `pins ${s.engine.pin} via ${s.engine.pinField ?? '?'}`;
        lines.push(`- ${name} ${s.version} (previous ${dash(s.previous)}; ${pin}; Node ${dash(s.runtime.node)}; ${s.mode})`);
    }
    lines.push('', '## Versions and pins', '', '| package | version | previous | released on | engine pin | pin field | engine minimum | node | manifest today | mode |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [name, e] of entries) {
        const s = e.surface;
        lines.push(`| ${name} | ${s.version} | ${dash(s.previous)} | ${dash(s.releasedOn)} | ${dash(s.engine.pin)} | ${dash(s.engine.pinField)} | ${dash(s.engine.minimum)} | ${dash(s.runtime.node)} | ${e.manifestToday.version} / ${dash(e.manifestToday.pin)} | ${s.mode} |`);
    }

    for (const [name, e] of entries) {
        const s = e.surface;
        lines.push('', `## ${name}`, '', '### Counts', '', '| key | prev | current | manifest today |', '|---|---|---|---|');
        const keys = unique([...Object.keys(s.counts), ...Object.keys(e.previous?.counts ?? {}), ...Object.keys(e.manifestToday.counts)]);
        for (const key of keys) lines.push(`| ${key} | ${dash(e.previous?.counts[key])} | ${dash(s.counts[key])} | ${dash(e.manifestToday.counts[key])} |`);

        lines.push('', '### Lists', '');
        const listKeys = Object.keys(s.lists);
        if (!budget.lists) lines.push(listKeys.length === 0 ? '- none' : `- ${listKeys.length} lists omitted for the line budget (see facts.json)`);
        else if (listKeys.length === 0) lines.push('- none');
        else for (const key of listKeys) lines.push(`- ${key} (${s.lists[key].length}): ${joinCut(s.lists[key], budget.listChars)}`);

        lines.push('', '### Delta', '');
        const deltaKeys = Object.keys(e.delta);
        if (deltaKeys.length === 0) lines.push(e.previous === null ? '- no previous surface to compare with' : '- none');
        for (const key of deltaKeys) {
            const d = e.delta[key];
            const parts = [...d.added.map((x) => `+${x}`), ...d.removed.map((x) => `−${x}`)];
            lines.push(`- ${key}: ${joinCut(parts, Math.max(budget.listChars, 60))}`);
        }

        lines.push('', '### Constraints', '');
        if (s.constraints.length === 0) lines.push('- none derived');
        for (const c of s.constraints) lines.push(`- ${c}`);

        lines.push('', '### Ledger', '');
        const ledger = s.ledger.slice(0, budget.ledger);
        if (ledger.length === 0) lines.push(s.ledger.length === 0 ? '- none' : `- ${s.ledger.length} entries omitted for the line budget (see facts.json)`);
        for (const l of ledger) lines.push(`- [${l.id}] ${l.summary}`);
        if (ledger.length > 0 && ledger.length < s.ledger.length) lines.push(`- … (+${s.ledger.length - ledger.length})`);

        lines.push('', '### Unverified', '');
        if (s.unverified.length === 0) lines.push('- nothing');
        for (const u of s.unverified) lines.push(`- ${u}`);
    }

    lines.push('', '## Blind spots', '', 'Version and pin sites no `verify:docs` token sees; expected values come from `docs/assets/ecosystem.json` `packages.<name>`.', '', '| id | file | kind | package | description |', '|---|---|---|---|---|');
    for (const b of blindSpotTable()) lines.push(`| ${b.id} | ${cell(b.file)} | ${b.kind} | ${b.package ?? 'by name group'} | ${cell(b.description)} |`);

    lines.push('', '## Capture commands', '', 'Run in the satellite root; stdout is the capture.', '');
    for (const name of SATELLITES) {
        const cmds = CAPTURE_COMMANDS[name];
        if (cmds.length === 0) lines.push(`- ${name}: none (the committed fixtures are current)`);
        for (const c of cmds) lines.push(`- ${name}: \`${c}\``);
    }
    return lines;
}

/** The compact facts sheet — the only source the writing agents read; never more than `FACTS_MAX_LINES` lines. */
export function renderFactsMarkdown(facts: SatelliteFacts): string {
    let lines: string[] = [];
    for (const budget of BUDGETS) {
        lines = renderLines(facts, budget);
        if (lines.length <= FACTS_MAX_LINES) return `${lines.join('\n')}\n`;
    }
    const kept = lines.slice(0, FACTS_MAX_LINES - 1);
    kept.push(`… (truncated to ${FACTS_MAX_LINES} lines; see facts.json)`);
    return `${kept.join('\n')}\n`;
}

// ── Blind spots ─────────────────────────────────────────────────────

const NAME = '(pdfnative-(?:cli|mcp|react))';
const VER = '(\\d+\\.\\d+\\.\\d+)';

/**
 * The nine version/pin sites of the pdfnative tree that `version-token` does
 * not police. Each regex is global; the caller resolves the expected value
 * from `docs/assets/ecosystem.json` `packages.<name>.version` (kind
 * `version`) or `packages.<name>.pin` with the `^` stripped (kind `pin`).
 */
export function blindSpotTable(): readonly BlindSpot[] {
    return [
        {
            id: 'versions-fallback',
            file: 'docs/assets/versions.js',
            pattern: new RegExp(`'${NAME}':\\s*\\{\\s*version:\\s*'${VER}',\\s*pin:\\s*'\\^${VER}'`, 'g'),
            package: null,
            nameGroup: 1,
            versionGroup: 2,
            pinGroup: 3,
            kind: 'version',
            description: 'FALLBACK table of the live version widget (version and pin per package)',
        },
        {
            id: 'package-devdependency',
            file: 'package.json',
            pattern: new RegExp(`"pdfnative-react":\\s*"\\^${VER}"`, 'g'),
            package: 'pdfnative-react',
            versionGroup: 1,
            kind: 'version',
            description: 'devDependency on pdfnative-react (the DocSpec lint playground preset)',
        },
        {
            id: 'importmap-react',
            file: '*',
            pattern: new RegExp(`esm\\.sh/pdfnative-react@${VER}`, 'g'),
            package: 'pdfnative-react',
            versionGroup: 1,
            kind: 'version',
            description: 'esm.sh importmap pin of the React playgrounds',
        },
        {
            id: 'backtick-version',
            file: '*',
            pattern: new RegExp(`\`${NAME}\` v${VER}`, 'g'),
            package: null,
            nameGroup: 1,
            versionGroup: 2,
            kind: 'version',
            description: 'the `pdfnative-x` vX form of llms.txt and the guides',
        },
        {
            id: 'strong-version',
            file: '*',
            pattern: new RegExp(`<strong>${NAME}</strong>[^<\\n]{0,80}?\\bv${VER}`, 'g'),
            package: null,
            nameGroup: 1,
            versionGroup: 2,
            kind: 'version',
            description: 'the <strong>pdfnative-x</strong> … vX form of the playground cards',
        },
        {
            id: 'learn-since',
            file: 'docs/learn/08-next-steps.html',
            pattern: new RegExp(`>${NAME}</a></strong>[^\\n]* since v${VER}\\.</li>`, 'g'),
            package: null,
            nameGroup: 1,
            versionGroup: 2,
            kind: 'version',
            description: 'the last "since vX" of each package bullet of the learn path',
        },
        {
            id: 'agent-brief-new-in',
            file: 'docs/agent-brief.md',
            pattern: new RegExp(`\`${NAME}\`[^\\n]*?\\bNew in v${VER}`, 'g'),
            package: null,
            nameGroup: 1,
            versionGroup: 2,
            kind: 'version',
            description: '"New in vX" on the line naming the package in the agent brief',
        },
        {
            id: 'llms-ecosystem-line',
            file: '*',
            pattern: new RegExp(`^- \\[${NAME}\\]\\(https://github\\.com/[^)]*\\):[^\\n]*?\\(v${VER}`, 'gm'),
            package: null,
            nameGroup: 1,
            versionGroup: 2,
            kind: 'version',
            description: 'ecosystem bullets of llms.txt and docs/llms.txt ("(vX, …)")',
        },
        {
            id: 'pin-prose',
            file: '*',
            pattern: new RegExp(`${NAME}\\b[^\\n]*?(?:pins (?:\`|<code>)?\\^|Peer: pdfnative \\^|requires pdfnative (?:≥|>=) )${VER}`, 'g'),
            package: null,
            nameGroup: 1,
            versionGroup: 2,
            kind: 'pin',
            description: 'engine pin in prose ("pins ^X", "Peer: pdfnative ^X", "requires pdfnative ≥ X") on a line naming the package',
        },
    ];
}

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

export const RPKG_VERSION = '1.0'
export const RPKG_MIME_TYPE = 'application/vnd.rpkg'

export interface ValidationIssue {
    path: string
    message: string
}

export interface PackageContents {
    entries: Map<string, Uint8Array>
    paths: string[]
}

export interface PackageInspection {
    manifest: Record<string, unknown>
    fileCount: number
    collections: Record<string, number>
}

export async function readPackage(path: string): Promise<PackageContents> {
    let bytes: Uint8Array
    try {
        bytes = new Uint8Array(await readFile(path))
    } catch (error) {
        throw new Error(`Could not read ${path}: ${errorMessage(error)}`)
    }

    const paths = zipPaths(bytes)
    let files: Record<string, Uint8Array>
    try {
        files = unzipSync(bytes)
    } catch (error) {
        throw new Error(`Could not open ${path} as a ZIP archive: ${errorMessage(error)}`)
    }
    return {
        entries: new Map(Object.entries(files).filter(([path]) => !path.endsWith('/'))),
        paths,
    }
}

export async function readDirectory(path: string): Promise<PackageContents> {
    const entries = new Map<string, Uint8Array>()
    let root: Awaited<ReturnType<typeof stat>>
    try {
        root = await stat(path)
    } catch (error) {
        throw new Error(`Could not read ${path}: ${errorMessage(error)}`)
    }
    if (!root.isDirectory()) {
        throw new Error(`${path} is not a directory.`)
    }

    async function walk(directory: string): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const fullPath = join(directory, entry.name)
            if (entry.isSymbolicLink()) {
                throw new Error(`Symbolic links are not supported: ${fullPath}`)
            }
            if (entry.isDirectory()) {
                await walk(fullPath)
            } else if (entry.isFile()) {
                const archivePath = relative(path, fullPath).split(sep).join('/')
                entries.set(archivePath, new Uint8Array(await readFile(fullPath)))
            }
        }
    }
    await walk(path)
    return { entries, paths: [...entries.keys()] }
}

export function encodePackage(contents: PackageContents): Uint8Array {
    const files: Zippable = {}
    for (const [path, bytes] of contents.entries) {
        files[path] = path === 'mimetype' ? [bytes, { level: 0 }] : bytes
    }
    return zipSync(files, { level: 6 })
}

export function validatePackage(contents: PackageContents): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    validatePaths(contents.paths, issues)

    const mime = contents.entries.get('mimetype')
    if (!mime) {
        issues.push(issue('mimetype', 'Required file is missing.'))
    } else {
        const value = strFromU8(mime)
        if (value.replace(/\r?\n$/, '') !== RPKG_MIME_TYPE || /(?:\r?\n){2,}$/.test(value)) {
            issues.push(issue('mimetype', `Expected ${RPKG_MIME_TYPE}.`))
        }
    }

    const manifest = parseJson(contents, 'manifest.json', issues)
    if (manifest) {
        validateManifest(manifest, issues)
    }
    for (const [path] of contents.entries) {
        if (/^characters\/.*\.json$/.test(path)) {
            validateCharacterFile(contents, path, issues)
        }
        if (/^lore\/.*\.json$/.test(path)) {
            validateLorebookFile(contents, path, issues)
        }
    }
    return issues
}

export function inspectPackage(contents: PackageContents): PackageInspection {
    const manifestBytes = contents.entries.get('manifest.json')
    if (!manifestBytes) {
        throw new Error('manifest.json is missing.')
    }
    let manifest: unknown
    try {
        manifest = JSON.parse(strFromU8(manifestBytes))
    } catch (error) {
        throw new Error(`manifest.json is not valid JSON: ${errorMessage(error)}`)
    }
    if (!isRecord(manifest)) {
        throw new Error('manifest.json must contain an object.')
    }

    const collections: Record<string, number> = {}
    for (const path of contents.entries.keys()) {
        const slash = path.indexOf('/')
        if (slash <= 0 || path.endsWith('/')) {
            continue
        }
        const collection = path.slice(0, slash)
        collections[collection] = (collections[collection] ?? 0) + 1
    }
    return { manifest, fileCount: contents.entries.size, collections }
}

function validatePaths(paths: string[], issues: ValidationIssue[]): void {
    const exact = new Set<string>()
    const folded = new Map<string, string>()
    for (const path of paths) {
        const parts = path.split('/')
        if (path.endsWith('/')) {
            parts.pop()
        }
        if (
            !path ||
            path.startsWith('/') ||
            path.startsWith('\\') ||
            /^[A-Za-z]:[\\/]/.test(path) ||
            path.includes('\\') ||
            parts.some((part) => part === '.' || part === '..' || part === '')
        ) {
            issues.push(issue(path, 'Archive contains an unsafe path.'))
        }
        if (exact.has(path)) {
            issues.push(issue(path, 'Archive contains this path more than once.'))
        }
        exact.add(path)
        const lower = path.toLocaleLowerCase('en-US')
        const other = folded.get(lower)
        if (other && other !== path) {
            issues.push(
                issue(path, `Path conflicts with ${other} on case-insensitive file systems.`),
            )
        } else {
            folded.set(lower, path)
        }
    }
}

function validateManifest(value: Record<string, unknown>, issues: ValidationIssue[]): void {
    requiredString(value, 'version', 'manifest.json', issues)
    requiredString(value, 'exportedAt', 'manifest.json', issues)
    if (typeof value.version === 'string') {
        if (!/^\d+\.\d+$/.test(value.version)) {
            issues.push(issue('manifest.json.version', 'Expected major.minor form.'))
        } else if (Number(value.version.split('.')[0]) > 1) {
            issues.push(
                issue(
                    'manifest.json.version',
                    `Package uses newer major version ${value.version}.`,
                ),
            )
        }
    }
    if (typeof value.exportedAt === 'string' && !isDateTime(value.exportedAt)) {
        issues.push(issue('manifest.json.exportedAt', 'Expected an ISO 8601 date-time.'))
    }
    if (value.generator !== undefined) {
        if (!isRecord(value.generator)) {
            issues.push(issue('manifest.json.generator', 'Expected an object.'))
        } else {
            requiredString(value.generator, 'name', 'manifest.json.generator', issues)
            optionalString(value.generator, 'version', 'manifest.json.generator', issues)
        }
    }
}

function validateCharacterFile(
    contents: PackageContents,
    path: string,
    issues: ValidationIssue[],
): void {
    if (path.slice('characters/'.length).includes('/')) {
        issues.push(issue(path, 'Character JSON files must be directly inside characters/.'))
        return
    }
    const value = parseJson(contents, path, issues)
    if (!value) {
        return
    }
    validateId(value, path, issues)
    requiredNumber(value, 'lastUpdate', path, issues)
    requiredString(value, 'name', path, issues)
    requiredString(value, 'definition', path, issues)
    requiredString(value, 'tagline', path, issues)
    if (
        !Array.isArray(value.greetings) ||
        value.greetings.some((item) => typeof item !== 'string')
    ) {
        issues.push(issue(`${path}.greetings`, 'Expected an array of strings.'))
    }
    if (
        value.avatar !== null &&
        (typeof value.avatar !== 'string' || !value.avatar.startsWith('data:'))
    ) {
        issues.push(issue(`${path}.avatar`, 'Expected null or a data URL.'))
    }
    validateMetadata(value.metadata, `${path}.metadata`, issues)
    const fileId = path.slice('characters/'.length, -'.json'.length)
    if (typeof value.id === 'string' && value.id !== fileId) {
        issues.push(issue(`${path}.id`, `ID ${value.id} does not match file name ${fileId}.`))
    }
}

function validateLorebookFile(
    contents: PackageContents,
    path: string,
    issues: ValidationIssue[],
): void {
    if (path.slice('lore/'.length).includes('/')) {
        issues.push(issue(path, 'Lorebook JSON files must be directly inside lore/.'))
        return
    }
    const value = parseJson(contents, path, issues)
    if (!value) {
        return
    }
    validateId(value, path, issues)
    requiredNumber(value, 'lastUpdate', path, issues)
    requiredString(value, 'name', path, issues)
    validateMetadata(value.metadata, `${path}.metadata`, issues)
    if (!Array.isArray(value.entries)) {
        issues.push(issue(`${path}.entries`, 'Expected an array.'))
    } else {
        value.entries.forEach((entry, index) => {
            const entryPath = `${path}.entries[${index}]`
            if (!isRecord(entry)) {
                issues.push(issue(entryPath, 'Expected an object.'))
            } else {
                validateId(entry, entryPath, issues)
                requiredString(entry, 'name', entryPath, issues)
                requiredString(entry, 'content', entryPath, issues)
            }
        })
    }
    const fileId = path.slice('lore/'.length, -'.json'.length)
    if (typeof value.id === 'string' && value.id !== fileId) {
        issues.push(issue(`${path}.id`, `ID ${value.id} does not match file name ${fileId}.`))
    }
}

function validateId(value: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
    requiredString(value, 'id', path, issues)
    if (typeof value.id === 'string' && !/^[A-Za-z0-9_-]{8,128}$/.test(value.id)) {
        issues.push(
            issue(`${path}.id`, 'Expected 8 to 128 letters, numbers, underscores, or hyphens.'),
        )
    }
}

function validateMetadata(value: unknown, path: string, issues: ValidationIssue[]): void {
    if (value === undefined) {
        return
    }
    if (!isRecord(value)) {
        issues.push(issue(path, 'Expected an object.'))
        return
    }
    for (const key of ['author', 'source', 'license', 'language', 'createdAt', 'updatedAt']) {
        optionalString(value, key, path, issues)
    }
    for (const key of ['createdAt', 'updatedAt']) {
        if (typeof value[key] === 'string' && !isDateTime(value[key])) {
            issues.push(issue(`${path}.${key}`, 'Expected an ISO 8601 date-time.'))
        }
    }
    if (typeof value.source === 'string') {
        try {
            new URL(value.source)
        } catch {
            issues.push(issue(`${path}.source`, 'Expected a URL.'))
        }
    }
    for (const key of ['tags', 'contentWarnings']) {
        if (
            value[key] !== undefined &&
            (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== 'string'))
        ) {
            issues.push(issue(`${path}.${key}`, 'Expected an array of strings.'))
        }
    }
}

function parseJson(
    contents: PackageContents,
    path: string,
    issues: ValidationIssue[],
): Record<string, unknown> | undefined {
    const bytes = contents.entries.get(path)
    if (!bytes) {
        issues.push(issue(path, 'Required file is missing.'))
        return
    }
    try {
        const value: unknown = JSON.parse(strFromU8(bytes))
        if (!isRecord(value)) {
            issues.push(issue(path, 'Expected a JSON object.'))
            return
        }
        return value
    } catch (error) {
        issues.push(issue(path, `Invalid JSON: ${errorMessage(error)}`))
    }
}

function requiredString(
    value: Record<string, unknown>,
    key: string,
    path: string,
    issues: ValidationIssue[],
): void {
    if (typeof value[key] !== 'string') {
        issues.push(issue(`${path}.${key}`, 'Expected a string.'))
    }
}

function optionalString(
    value: Record<string, unknown>,
    key: string,
    path: string,
    issues: ValidationIssue[],
): void {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
        issues.push(issue(`${path}.${key}`, 'Expected a string.'))
    }
}

function requiredNumber(
    value: Record<string, unknown>,
    key: string,
    path: string,
    issues: ValidationIssue[],
): void {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
        issues.push(issue(`${path}.${key}`, 'Expected a number.'))
    }
}

function isDateTime(value: string): boolean {
    return (
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
        !Number.isNaN(Date.parse(value))
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(path: string, message: string): ValidationIssue {
    return { path, message }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function zipPaths(bytes: Uint8Array): string[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let end = -1
    for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset++) {
        if (view.getUint32(offset, true) === 0x06054b50) {
            end = offset
        }
    }
    if (end < 0) {
        return []
    }
    const count = view.getUint16(end + 10, true)
    let offset = view.getUint32(end + 16, true)
    const paths: string[] = []
    for (let index = 0; index < count && offset + 46 <= bytes.length; index++) {
        if (view.getUint32(offset, true) !== 0x02014b50) {
            break
        }
        const nameLength = view.getUint16(offset + 28, true)
        const extraLength = view.getUint16(offset + 30, true)
        const commentLength = view.getUint16(offset + 32, true)
        paths.push(strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength)))
        offset += 46 + nameLength + extraLength + commentLength
    }
    return paths
}

export { strToU8 }

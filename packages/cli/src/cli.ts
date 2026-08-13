import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
    RPKG_MIME_TYPE,
    encodePackage,
    inspectPackage,
    readDirectory,
    readPackage,
    strToU8,
    validatePackage,
    type PackageContents,
} from '@rpkg/core'

export interface CliIO {
    out(line: string): void
    err(line: string): void
}

const HELP = `Usage:
  rpkg inspect <package.rpkg>
  rpkg validate <package.rpkg>
  rpkg unpack <package.rpkg> <output-directory>
  rpkg pack <input-directory> <package.rpkg>
  rpkg convert <character-card.png> <package.rpkg>`

export async function runCli(args: string[], io: CliIO = consoleIO): Promise<number> {
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
        io.out(HELP)
        return 0
    }

    try {
        switch (args[0]) {
            case 'inspect':
                expectArguments(args, 2)
                return await inspectCommand(args[1], io)
            case 'validate':
                expectArguments(args, 2)
                return await validateCommand(args[1], io)
            case 'unpack':
                expectArguments(args, 3)
                return await unpackCommand(args[1], args[2], io)
            case 'pack':
                expectArguments(args, 3)
                return await packCommand(args[1], args[2], io)
            case 'convert':
                expectArguments(args, 3)
                return await convertCommand(args[1], args[2], io)
            default:
                io.err(`Unknown command: ${args[0]}\n\n${HELP}`)
                return 1
        }
    } catch (error) {
        io.err(error instanceof Error ? error.message : String(error))
        return 1
    }
}

async function inspectCommand(path: string, io: CliIO): Promise<number> {
    const contents = await readPackage(path)
    if (!reportIssues(validatePackage(contents), io)) {
        return 1
    }
    const inspection = inspectPackage(contents)
    io.out(`RPKG ${String(inspection.manifest.version)}`)
    io.out(`Exported: ${String(inspection.manifest.exportedAt)}`)
    if (
        isRecord(inspection.manifest.generator) &&
        typeof inspection.manifest.generator.name === 'string'
    ) {
        const version =
            typeof inspection.manifest.generator.version === 'string'
                ? ` ${inspection.manifest.generator.version}`
                : ''
        io.out(`Generator: ${inspection.manifest.generator.name}${version}`)
    }
    io.out(`Files: ${inspection.fileCount}`)
    const collections = Object.entries(inspection.collections).sort(([left], [right]) =>
        left.localeCompare(right),
    )
    if (collections.length > 0) {
        io.out('Collections:')
        for (const [name, count] of collections) {
            io.out(`  ${name}: ${count}`)
        }
    }
    return 0
}

async function validateCommand(path: string, io: CliIO): Promise<number> {
    const contents = await readPackage(path)
    if (!reportIssues(validatePackage(contents), io)) {
        return 1
    }
    io.out(`${path} is valid.`)
    return 0
}

async function unpackCommand(input: string, output: string, io: CliIO): Promise<number> {
    await expectMissing(output)
    const contents = await readPackage(input)
    if (!reportIssues(validatePackage(contents), io)) {
        return 1
    }
    await mkdir(output, { recursive: true })
    for (const [path, bytes] of contents.entries) {
        const destination = join(output, ...path.split('/'))
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, bytes)
    }
    io.out(`Unpacked ${contents.entries.size} files to ${output}.`)
    return 0
}

async function packCommand(input: string, output: string, io: CliIO): Promise<number> {
    await expectMissing(output)
    const contents = await readDirectory(input)
    if (!reportIssues(validatePackage(contents), io)) {
        return 1
    }
    await writeFile(output, encodePackage(contents))
    io.out(`Packed ${contents.entries.size} files into ${output}.`)
    return 0
}

async function convertCommand(input: string, output: string, io: CliIO): Promise<number> {
    await expectMissing(output)
    if (!input.toLocaleLowerCase('en-US').endsWith('.png')) {
        throw new Error('Convert currently accepts Character Card PNG files.')
    }
    const png = new Uint8Array(await Bun.file(input).arrayBuffer())
    const card = readCharacterCard(png)
    const character = convertCharacterCard(card, png)
    const id = String(character.id)
    const contents: PackageContents = {
        paths: ['mimetype', 'manifest.json', `characters/${id}.json`],
        entries: new Map([
            ['mimetype', strToU8(RPKG_MIME_TYPE)],
            [
                'manifest.json',
                jsonBytes({
                    version: '1.0',
                    exportedAt: new Date().toISOString(),
                    generator: { name: 'rpkg', version: '0.0.0' },
                }),
            ],
            [`characters/${id}.json`, jsonBytes(character)],
        ]),
    }
    const issues = validatePackage(contents)
    if (issues.length > 0) {
        throw new Error(
            `Could not convert the card:\n${issues.map((item) => `- ${item.path}: ${item.message}`).join('\n')}`,
        )
    }
    await writeFile(output, encodePackage(contents))
    io.out(`Converted ${input} to ${output}.`)
    return 0
}

function readCharacterCard(png: Uint8Array): Record<string, unknown> {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (png.length < 8 || signature.some((byte, index) => png[index] !== byte)) {
        throw new Error('Input is not a PNG file.')
    }
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const decoder = new TextDecoder()
    let offset = 8
    while (offset + 12 <= png.length) {
        const length = view.getUint32(offset)
        if (offset + 12 + length > png.length) {
            throw new Error('PNG file is cut off or damaged.')
        }
        const type = decoder.decode(png.subarray(offset + 4, offset + 8))
        const data = png.subarray(offset + 8, offset + 8 + length)
        if (type === 'tEXt') {
            const separator = data.indexOf(0)
            if (separator >= 0 && decoder.decode(data.subarray(0, separator)) === 'chara') {
                return decodeCardText(decoder.decode(data.subarray(separator + 1)))
            }
        }
        if (type === 'iTXt') {
            const fields = splitNull(data, 5)
            if (decoder.decode(fields[0]) === 'chara') {
                if (fields[1]?.[0] !== 0) {
                    throw new Error('Compressed iTXt character metadata is not supported.')
                }
                return decodeCardText(decoder.decode(fields[5] ?? new Uint8Array()))
            }
        }
        offset += 12 + length
    }
    throw new Error('PNG does not contain Character Card metadata.')
}

function decodeCardText(value: string): Record<string, unknown> {
    let decoded = value
    try {
        decoded = Buffer.from(value, 'base64').toString('utf8')
    } catch {
        /* Try plain JSON below. */
    }
    try {
        const card: unknown = JSON.parse(decoded)
        if (!isRecord(card)) {
            throw new Error('metadata is not an object')
        }
        return card
    } catch (error) {
        throw new Error(
            `Character Card metadata is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        )
    }
}

function convertCharacterCard(
    card: Record<string, unknown>,
    png: Uint8Array,
): Record<string, unknown> {
    const data = card.spec === 'chara_card_v2' ? card.data : card
    if (!isRecord(data)) {
        throw new Error('Character Card data is missing.')
    }
    const name = stringField(data, 'name')
    if (!name) {
        throw new Error('Character Card name is missing.')
    }
    const greetings = [
        stringField(data, 'first_mes'),
        ...stringArray(data.alternate_greetings),
    ].filter((value) => value.length > 0)
    const definition = [
        section('Description', stringField(data, 'description')),
        section('Personality', stringField(data, 'personality')),
        section('Scenario', stringField(data, 'scenario')),
        section('Example dialogue', stringField(data, 'mes_example')),
        section('System prompt', stringField(data, 'system_prompt')),
        section('After-chat instructions', stringField(data, 'post_history_instructions')),
    ]
        .filter(Boolean)
        .join('\n\n')
    const creator = stringField(data, 'creator')
    return {
        id: characterId(name),
        lastUpdate: Date.now(),
        name,
        definition,
        greetings,
        tagline:
            stringField(data, 'creator_notes') ||
            stringField(data, 'personality').split(/\r?\n/)[0] ||
            '',
        avatar: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
        ...(creator || stringArray(data.tags).length
            ? {
                  metadata: {
                      ...(creator ? { author: creator } : {}),
                      ...(stringArray(data.tags).length ? { tags: stringArray(data.tags) } : {}),
                  },
              }
            : {}),
        extensions: { characterCardV2: card },
    }
}

function characterId(name: string): string {
    let id = name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
    if (!id) {
        id = 'character'
    }
    if (id.length < 8) {
        id = `${id}_card`
    }
    return id.slice(0, 128)
}

function reportIssues(issues: { path: string; message: string }[], io: CliIO): boolean {
    if (issues.length === 0) {
        return true
    }
    io.err(`Package is invalid (${issues.length} ${issues.length === 1 ? 'problem' : 'problems'}):`)
    for (const item of issues) {
        io.err(`- ${item.path}: ${item.message}`)
    }
    return false
}

async function expectMissing(path: string): Promise<void> {
    try {
        await stat(path)
        throw new Error(`${path} already exists.`)
    } catch (error) {
        if (isRecord(error) && error.code === 'ENOENT') {
            return
        }
        throw error
    }
}

function expectArguments(args: string[], count: number): void {
    if (args.length !== count) {
        throw new Error(`Wrong number of arguments.\n\n${HELP}`)
    }
}

function jsonBytes(value: unknown): Uint8Array {
    return strToU8(`${JSON.stringify(value, null, 2)}\n`)
}

function stringField(value: Record<string, unknown>, key: string): string {
    return typeof value[key] === 'string' ? value[key] : ''
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
}

function section(title: string, value: string): string {
    return value ? `${title}:\n${value}` : ''
}

function splitNull(value: Uint8Array, count: number): Uint8Array[] {
    const fields: Uint8Array[] = []
    let start = 0
    for (let index = 0; index < value.length && fields.length < count; index++) {
        if (value[index] === 0) {
            fields.push(value.subarray(start, index))
            start = index + 1
        }
    }
    fields.push(value.subarray(start))
    return fields
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const consoleIO: CliIO = {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
}

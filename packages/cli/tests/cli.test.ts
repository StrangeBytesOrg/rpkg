import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodePackage, strToU8, type PackageContents } from '@rpkg/core'
import { runCli, type CliIO } from '../src/cli'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'rpkg-cli-'))
    temporaryDirectories.push(directory)
    return directory
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    )
})

function capture(): CliIO & { stdout: string[]; stderr: string[] } {
    const stdout: string[] = []
    const stderr: string[] = []
    return {
        stdout,
        stderr,
        out: (line) => stdout.push(line),
        err: (line) => stderr.push(line),
    }
}

async function makeSource(root: string): Promise<string> {
    const source = join(root, 'source')
    await mkdir(join(source, 'characters'), { recursive: true })
    await writeFile(join(source, 'mimetype'), 'application/vnd.rpkg')
    await writeFile(
        join(source, 'manifest.json'),
        JSON.stringify({
            version: '1.0',
            exportedAt: '2026-08-11T00:00:00.000Z',
            generator: { name: 'test' },
        }),
    )
    await writeFile(
        join(source, 'characters', 'example_nyx.json'),
        JSON.stringify({
            id: 'example_nyx',
            lastUpdate: 1786406400000,
            name: 'Nyx',
            definition: 'A mechanic.',
            greetings: ['Hello.'],
            tagline: 'Resourceful.',
            avatar: null,
        }),
    )
    return source
}

describe('CLI', () => {
    test('packs, validates, inspects, and unpacks a package', async () => {
        const root = await temporaryDirectory()
        const source = await makeSource(root)
        const archive = join(root, 'character.rpkg')
        const output = join(root, 'output')
        const io = capture()

        expect(await runCli(['pack', source, archive], io)).toBe(0)
        expect(await runCli(['validate', archive], io)).toBe(0)
        expect(io.stdout).toContain(`${archive} is valid.`)

        expect(await runCli(['inspect', archive], io)).toBe(0)
        expect(io.stdout.join('\n')).toContain('RPKG 1.0')
        expect(io.stdout.join('\n')).toContain('characters: 1')

        expect(await runCli(['unpack', archive, output], io)).toBe(0)
        expect(
            JSON.parse(await readFile(join(output, 'characters', 'example_nyx.json'), 'utf8')).name,
        ).toBe('Nyx')
    })

    test('reports every validation problem it can find', async () => {
        const root = await temporaryDirectory()
        const archive = join(root, 'broken.rpkg')
        const bytes = archiveBytes({
            mimetype: strToU8('text/plain'),
            'manifest.json': strToU8('{"version":"2.0"}'),
            'characters/wrong_name.json': strToU8(JSON.stringify({ id: 'different_id' })),
        })
        await writeFile(archive, bytes)
        const io = capture()

        expect(await runCli(['validate', archive], io)).toBe(1)
        expect(io.stderr.join('\n')).toContain('mimetype')
        expect(io.stderr.join('\n')).toContain('exportedAt')
        expect(io.stderr.join('\n')).toContain('newer major version')
        expect(io.stderr.join('\n')).toContain('does not match')
    })

    test('rejects unsafe archive paths', async () => {
        const root = await temporaryDirectory()
        const archive = join(root, 'unsafe.rpkg')
        await writeFile(archive, archiveBytes({ '../outside': strToU8('nope') }))
        const io = capture()

        expect(await runCli(['unpack', archive, join(root, 'output')], io)).toBe(1)
        expect(io.stderr.join('\n')).toContain('unsafe path')
    })

    test('does not overwrite output paths', async () => {
        const root = await temporaryDirectory()
        const source = await makeSource(root)
        const archive = join(root, 'character.rpkg')
        await writeFile(archive, 'keep me')
        const io = capture()

        expect(await runCli(['pack', source, archive], io)).toBe(1)
        expect(await readFile(archive, 'utf8')).toBe('keep me')
        expect(io.stderr.join('\n')).toContain('already exists')
    })

    test('converts Character Card V2 PNG metadata', async () => {
        const root = await temporaryDirectory()
        const png = join(root, 'card.png')
        const archive = join(root, 'card.rpkg')
        const card = {
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: {
                name: 'Nyx',
                description: 'A resourceful mechanic.',
                personality: 'Sharp-tongued.',
                scenario: 'Aboard a drifting ship.',
                first_mes: 'Need something fixed?',
                mes_example: '<START>\n{{char}}: Hand me that wrench.',
                alternate_greetings: ['You break it?'],
                creator_notes: 'A space mechanic.',
                tags: ['sci-fi'],
                creator: 'Test Author',
                character_version: '1.0',
                extensions: {},
            },
        }
        await writeFile(
            png,
            pngWithText('chara', Buffer.from(JSON.stringify(card)).toString('base64')),
        )
        const io = capture()

        expect(await runCli(['convert', png, archive], io)).toBe(0)
        const unpacked = join(root, 'unpacked')
        expect(await runCli(['unpack', archive, unpacked], io)).toBe(0)
        const character = JSON.parse(
            await readFile(join(unpacked, 'characters', 'nyx_card.json'), 'utf8'),
        )
        expect(character.name).toBe('Nyx')
        expect(character.greetings).toEqual(['Need something fixed?', 'You break it?'])
        expect(character.avatar).toStartWith('data:image/png;base64,')
        expect(character.extensions.characterCardV2).toEqual(card)
    })

    test('prints help for no arguments and rejects unknown commands', async () => {
        const help = capture()
        expect(await runCli([], help)).toBe(0)
        expect(help.stdout.join('\n')).toContain('rpkg inspect <package.rpkg>')

        const unknown = capture()
        expect(await runCli(['wat'], unknown)).toBe(1)
        expect(unknown.stderr.join('\n')).toContain('Unknown command')
    })
})

function pngWithText(keyword: string, value: string): Uint8Array {
    const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    const ihdr = new Uint8Array(13)
    const text = new TextEncoder().encode(`${keyword}\0${value}`)
    return concat(
        signature,
        chunk('IHDR', ihdr),
        chunk('tEXt', text),
        chunk('IEND', new Uint8Array()),
    )
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type)
    const result = new Uint8Array(12 + data.length)
    new DataView(result.buffer).setUint32(0, data.length)
    result.set(typeBytes, 4)
    result.set(data, 8)
    new DataView(result.buffer).setUint32(8 + data.length, crc32(concat(typeBytes, data)))
    return result
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
        }
    }
    return (crc ^ 0xffffffff) >>> 0
}

function archiveBytes(entries: Record<string, Uint8Array>): Uint8Array {
    const contents: PackageContents = {
        entries: new Map(Object.entries(entries)),
        paths: Object.keys(entries),
    }
    return encodePackage(contents)
}

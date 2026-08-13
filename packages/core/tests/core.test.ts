import { describe, expect, test } from 'bun:test'
import { encodePackage, strToU8, validatePackage, type PackageContents } from '../src'

function validPackage(): PackageContents {
    const entries = new Map<string, Uint8Array>([
        ['mimetype', strToU8('application/vnd.rpkg')],
        [
            'manifest.json',
            strToU8(JSON.stringify({ version: '1.0', exportedAt: '2026-08-11T00:00:00.000Z' })),
        ],
        [
            'characters/example_nyx.json',
            strToU8(
                JSON.stringify({
                    id: 'example_nyx',
                    lastUpdate: 1786406400000,
                    name: 'Nyx',
                    definition: 'A mechanic.',
                    greetings: [],
                    tagline: 'Resourceful.',
                    avatar: null,
                }),
            ),
        ],
    ])
    return { entries, paths: [...entries.keys()] }
}

describe('RPKG core', () => {
    test('accepts a valid 1.0 character package', () => {
        expect(validatePackage(validPackage())).toEqual([])
    })

    test('detects duplicate and case-conflicting paths', () => {
        const contents = validPackage()
        contents.paths.push('manifest.json', 'MANIFEST.JSON')
        const messages = validatePackage(contents)
            .map((item) => item.message)
            .join('\n')
        expect(messages).toContain('more than once')
        expect(messages).toContain('case-insensitive')
    })

    test('stores the mimetype entry without compression', () => {
        const bytes = encodePackage(validPackage())
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        expect(view.getUint32(0, true)).toBe(0x04034b50)
        expect(view.getUint16(8, true)).toBe(0)
        const nameLength = view.getUint16(26, true)
        expect(new TextDecoder().decode(bytes.subarray(30, 30 + nameLength))).toBe('mimetype')
    })
})

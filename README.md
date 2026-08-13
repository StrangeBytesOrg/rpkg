# RPKG

RPKG is an open, portable ZIP-based package format for AI roleplay content.

An RPKG file contains a small manifest and JSON documents organized into top-level collection folders. It is designed to be easy to implement, inspect, and extend while keeping each content item self-contained.

## Status

The format is in its first public design phase. Version 1.0 defines characters and lorebooks.

## Start here

- Read the [RPKG 1.0 specification](specification/1.0.md).
- Use the schemas in [schemas/1.0](schemas/1.0).
- See [docs](docs) and [examples](examples).

## Package layout

```text
mimetype
manifest.json
characters/<id>.json
lore/<id>.json
```

The MIME type is `application/vnd.rpkg` and packages use the `.rpkg` extension.

## Project layout

- `specification/` — normative format specifications.
- `schemas/` — JSON Schema definitions for standardized documents.
- `packages/core/` — `@rpkg/core`, the JavaScript reference library.
- `packages/cli/` — the `rpkg` command-line tool.
- `docs/` — implementation and usage guides.
- `examples/` — small example packages and source documents.
- `tests/` — shared format tests and fixtures.

## License

RPKG is released under the [MIT License](LICENSE).

## CLI

The CLI runs with Bun during development and builds as a standalone binary:

```sh
bun install
bun run test
bun run check
bun run build
```

The binary is written to `packages/cli/dist/rpkg`. It supports these commands:

```sh
rpkg inspect character.rpkg
rpkg validate character.rpkg
rpkg unpack character.rpkg output/
rpkg pack input/ character.rpkg
rpkg convert card.png character.rpkg
```

`convert` reads Character Card V2 metadata from the PNG's `chara` text chunk. The original card data and PNG are kept in the converted character document.

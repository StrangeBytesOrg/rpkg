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
- `packages/typescript/` — TypeScript reference library (scaffolded).
- `cli/` — command-line tooling (scaffolded).
- `docs/` — implementation and usage guides.
- `examples/` — small example packages and source documents.
- `tests/` — shared format tests and fixtures.

## License

RPKG is released under the [MIT License](LICENSE).


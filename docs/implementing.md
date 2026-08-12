# Implementing RPKG

Start with the [1.0 specification](../specification/1.0.md) and validate known documents against the [JSON Schemas](../schemas/1.0).

A reader opens the ZIP archive, validates `manifest.json`, enumerates its top-level collection folders, and imports documents from the collections it supports. Unknown collections and JSON properties should be ignored.

A writer creates the required `mimetype` and `manifest.json` files, then writes each item as `<collection>/<id>.json`.


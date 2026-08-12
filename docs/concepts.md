# RPKG concepts

RPKG is a simple container. It packages shareable roleplay content while allowing applications to support only the collection types they understand.

The archive's top-level collection folders are its index. A package can hold characters, lorebooks, or future collection types without requiring a centralized inventory.

Each item is self-contained JSON. This makes a document simple to import, move between packages, inspect, or extend with application-specific fields.

RPKG files are meant to stay easy to work with outside an app, too. You can open the ZIP file with a basic file manager, move a character JSON file from one package to another, or remove content you do not want to share. You can also open the JSON files in a text editor to read or adjust their text and metadata.

This is useful for creators who want control over their own work. It also means apps do not need special tools to support simple package changes.

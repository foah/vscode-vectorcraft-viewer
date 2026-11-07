# VectorCraft Viewer

**A standalone viewer for `.vectorcraft` files in VS Code.** You don't need to install VectorCraft:
on first use the extension offers to download `vectorcraft-cli`, the command-line tool of
[VectorCraft](https://github.com/storytold/vectorcraft), and renders your files with it.

> Unofficial: this extension is not made or endorsed by the VectorCraft team.
> It only runs the official `vectorcraft-cli` release.

## Features

- **Open `.vectorcraft` files as images.** Double-click a file in the Explorer to see it rendered.
- **Pixel-exact rendering.** Previews are made by VectorCraft's own renderer, so effects, gradients,
  blends and type look as they do in the app.
- **Zoom and pan.** Use the mouse wheel to zoom, drag to pan, and double-click to fit.
  Keys: `+` `-`, `0` to fit, `1` for actual size.
- **Artboards.** Pick an artboard when a document has several.
- **Live reload.** The preview updates when the file changes on disk, for example when an AI agent
  edits it through VectorCraft's MCP server.
- **Git diffs.** Older versions of a file render too, so a diff shows *before* and *after* side by side.
- **Backgrounds.** Switch between checkerboard, white, black and the editor theme.
- **Open in VectorCraft.** One click opens the file in the app; **JSON** shows the source.

## How the renderer is found

1. The `vectorcraftViewer.cliPath` setting, if set.
2. The copy downloaded by this extension.
3. `vectorcraft-cli` on `PATH`, or in a VectorCraft install (for example
   `C:\Program Files\ArtCraft\VectorCraft` on Windows).

If none is found, the preview offers to **download it** (about 120 to 150 MB, depending on the platform)
or to **pick an existing `vectorcraft-cli`**. Downloads come from the
[official GitHub releases](https://github.com/storytold/vectorcraft/releases), their SHA-256 checksum
is checked against the release's `SHA256SUMS.txt`, and they are kept in VS Code's extension storage.
Run **VectorCraft: Download or Update vectorcraft-cli** to update later.

Supported platforms: Windows (x64, arm64, x86), macOS (Apple silicon and Intel),
Linux (x86_64, aarch64, riscv64) and FreeBSD (x86_64, aarch64).

## Settings

| Setting | Default | Description |
|---|---|---|
| `vectorcraftViewer.cliPath` | *(empty)* | Path of `vectorcraft-cli`. This is a machine setting, so a workspace can't change it. |
| `vectorcraftViewer.format` | `png` | `png` is VectorCraft's own renderer. `svg` is lighter, but the browser draws the effects. |
| `vectorcraftViewer.scale` | `2` | Pixels per point for PNG rendering. |

## Commands

- **VectorCraft: Open Preview**: opens the preview for a `.vectorcraft` file that is open as text.
- **VectorCraft: Download or Update vectorcraft-cli**
- **VectorCraft: Use an Existing vectorcraft-cli…**
- **VectorCraft: Show Log**

## Privacy

The extension makes network requests only when you ask it to download `vectorcraft-cli`:
`api.github.com` and `github.com` (release assets). It collects no telemetry.

## License

MIT. VectorCraft itself is licensed under MIT or Apache-2.0 by its authors.

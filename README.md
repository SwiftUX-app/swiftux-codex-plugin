# SwiftUX for Codex

<img src="plugins/swiftux/assets/logo.svg" alt="SwiftUX" width="96" />

[SwiftUX](https://www.swiftux.app) is a catalog of production SwiftUI components (single views) and flows (multi-screen journeys). This plugin connects Codex to it, so that when you ask for a piece of UI, Codex finds the catalog items that fit, shows them to you as preview cards, and adapts the one you choose to your codebase.

## Install

One line in your terminal adds the marketplace and installs the plugin:

```
codex plugin marketplace add SwiftUX-app/swiftux-codex-plugin && codex plugin add swiftux@swiftux
```

Or add the marketplace with `codex plugin marketplace add SwiftUX-app/swiftux-codex-plugin`, then open `/plugins` in Codex and install **SwiftUX** from there.

Restart Codex, then ask for one piece of UI, for example *"add a paywall with a monthly/yearly toggle"*. `codex mcp list` should show `swiftux` as enabled.

To update later: `codex plugin marketplace upgrade`.

## What you get

The SwiftUX MCP server (`https://api.swiftux.app/mcp`), which provides these tools:

- `search_catalog` returns every component or flow that fits the request, best first.
- `show_picks` shows those options as interactive preview cards (an MCP App), with a summary of the request and why they fit.
- `get_component` / `get_flow` and their `*_source` tools let Codex adapt the source you pick.

## Layout

```
.agents/plugins/marketplace.json   the marketplace: one plugin, "swiftux"
plugins/swiftux/
  .codex-plugin/plugin.json        the plugin manifest (name, listing text, logo, brand color)
  .mcp.json                        the SwiftUX MCP server
  assets/logo.svg                  the logo and composer icon
```

Releasing: raise `version` in `plugins/swiftux/.codex-plugin/plugin.json` and push. Installed copies pick it up with `codex plugin marketplace upgrade`.

## Privacy

The plugin sends your UI request (`ux_task`) to the SwiftUX API to search the catalog. It does not read your code to search, and it does not send your code anywhere.

# SwiftUX for Codex

> **Debug branch.** This branch is the debug build: it points at the Railway preview API (`https://swiftux-api-preview.up.railway.app/mcp`) and adds the picks demo. Never merge it into `main`.
>
> Install it next to the release plugin:
>
> ```
> codex plugin marketplace add SwiftUX-app/swiftux-codex-plugin --ref debug && codex plugin add swiftux-debug@swiftux-debug
> ```
>
> Restart Codex, then ask *"Run the SwiftUX picks demo"*: it calls `demo_picks`, which only the preview API registers (`MCP_DEMO=true`), and opens the picks cards with live catalog items. Pick up branch changes with `codex plugin marketplace upgrade swiftux-debug`.
>
> The MCP server is named `swiftux-debug`, not `swiftux`, so it loads next to the release plugin. Codex keeps one server per name, and a shared name meant production's tools (no `demo_picks`, the production rate limit) replaced the preview ones.

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

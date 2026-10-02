import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Pick, Picks } from '../types'

const PANE = 'swiftux-picks'
const TITLE = 'SwiftUX picks'

// The Codex rail: fixed-width cards side by side, the next one peeking in at
// the edge, moving one card at a time (scroll-snap-align: start).
const CARD_COLUMNS = 30
const GAP = 2
const TILE_ROWS = 24
// A terminal cell is about twice as tall as it is wide.
const CELL_ASPECT = 2
// The largest picture sent as bytes; a bigger one is named by its file.
const MAX_INLINE_BYTES = 2 * 1024 * 1024

const picks = atom({ plugin: 'swiftux', key: 'picks' } as const, null)
const offset = atom({ plugin: 'swiftux', key: 'offset' } as const, 0)
const chosen = atom({ plugin: 'swiftux', key: 'chosen' } as const, null)

// Module-local: the PNG bytes per pick id, and the cache folder.
const inline = new Map<string, string>()
let cacheDir: Promise<string> | undefined

type Raw = Record<string, unknown>

const isShowPicks = (tool: string) =>
  tool.startsWith('mcp__') && tool.endsWith('__show_picks')

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined)

/** Finds show_picks' structured result (`{ items: [{ catalog_url, ... }] }`)
 *  wherever the engine's record holds it: structuredContent, or a JSON text block. */
export function findPicksPayload(value: unknown, depth = 0): Raw | undefined {
  if (depth > 6 || value == null) return undefined
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t.startsWith('{')) return undefined
    try {
      return findPicksPayload(JSON.parse(t), depth + 1)
    } catch {
      return undefined
    }
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findPicksPayload(v, depth + 1)
      if (hit) return hit
    }
    return undefined
  }
  if (typeof value !== 'object') return undefined
  const obj = value as Raw
  const items = obj.items
  if (
    Array.isArray(items) &&
    items.length > 0 &&
    items.every(i => i && typeof i === 'object' && str((i as Raw).id) && str((i as Raw).catalog_url))
  ) {
    return obj
  }
  for (const v of Object.values(obj)) {
    const hit = findPicksPayload(v, depth + 1)
    if (hit) return hit
  }
  return undefined
}

export function toPick(raw: Raw): Pick {
  const mediaType = raw.media_type === 'video' ? 'video' : raw.media_type === 'image' ? 'image' : undefined
  const media = str(raw.media_url)
  // The card's still: image_url first, preview_url when there is none.
  // show_picks spells the image media_url (media_type image), the preview poster.
  const image = str(raw.image_url) ?? (mediaType === 'image' ? media : undefined)
  const preview = str(raw.preview_url) ?? str(raw.poster)
  return {
    kind: raw.kind === 'flow' ? 'flow' : 'component',
    id: String(raw.id),
    name: str(raw.name) ?? String(raw.id),
    author: str(raw.author),
    catalogUrl: String(raw.catalog_url),
    why: str(raw.why) ?? str(raw.use_when),
    mediaType,
    stillUrl: image ?? preview,
    videoUrl: mediaType === 'video' ? media : undefined,
    image: 'loading',
  }
}

/** Width and height from a PNG's IHDR chunk; undefined when it is not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return undefined
  const at = (i: number) =>
    ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0
  return { width: at(16), height: at(20) }
}

/** The cell box a picture of `width`x`height` pixels fits in, aspect kept. */
export function fitCells(width: number, height: number, maxColumns: number, maxRows: number) {
  let columns = maxColumns
  let rows = Math.round((columns * height) / (width * CELL_ASPECT))
  if (rows > maxRows) {
    rows = maxRows
    columns = Math.round((rows * width * CELL_ASPECT) / height)
  }
  return { columns: Math.max(1, Math.min(255, columns)), rows: Math.max(1, Math.min(255, rows)) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'swiftux-picks',
      description: 'Show the last SwiftUX picks as preview cards',
    })
    return next(e)
  })

  on('command.run', { command: 'swiftux-picks' }, async $ => {
    const current = await read($, picks)
    if (!current) return { text: 'No SwiftUX picks yet: ask for a piece of UI first.' }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'SwiftUX picks opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!isShowPicks(e.tool) || !('result' in ran) || ran.isError) return ran

    const payload = findPicksPayload(ran.result)
    if (!payload) return ran

    const items = (payload.items as Raw[]).map(toPick)
    const server = e.tool.split('__')[1] ?? 'swiftux'
    const shown: Picks = {
      callId: e.tool_use_id,
      summary: str(payload.request_summary) ?? str((e as Raw).request_summary) ?? '',
      reasoning: str(payload.reasoning) ?? str((e as Raw).reasoning) ?? '',
      items,
    }
    await update($, picks, () => shown)
    await update($, offset, () => 0)
    await update($, chosen, () => null)

    // Opened unasked (the model called the tool), a pane seats only on a wide
    // enough terminal; otherwise say where to find it.
    const opened = await $.ui.open({ id: PANE, title: TITLE }).catch(() => ({ isPlaced: false }))
    if (!opened.isPlaced) void $.ui.toast('SwiftUX picks are ready: /swiftux-picks to see them')

    // The pane is up; the pictures land in parallel, each card redrawing when
    // its own arrives. Awaited, since a hook's `$` ends with its dispatch.
    await Promise.all(items.map(pick => loadStill($, server, shown.callId, pick)))
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    // Pictures are the terminal's alone (kitty graphics: kitty, Ghostty; the alt elsewhere).
    // Another surface resolves the name to an empty fragment, so ask the surface.
    const Image = e.surface === 'terminal' && 'Image' in elements ? elements.Image : undefined
    const current = await read($, picks)
    const first = await read($, offset)
    const pickedId = await read($, chosen)
    if (!current) return <Text dimColor>No SwiftUX picks yet.</Text>

    const columns = Math.max(CARD_COLUMNS, (e.viewport?.columns ?? 80) - 2)
    const fits = Math.max(1, Math.floor((columns + GAP) / (CARD_COLUMNS + GAP)))
    const last = Math.max(0, current.items.length - fits)
    const start = Math.min(first, last)
    // One more than fits: it is clipped at the edge, the Codex peek.
    const window = current.items.slice(start, start + fits + 1)

    const step = (by: number) => () =>
      void update($, offset, at => Math.max(0, Math.min(last, Math.min(at, last) + by)))

    const choose = (pick: Pick) => async () => {
      await update($, chosen, () => pick.id)
      await $.prompt.fill({ text: `Use the SwiftUX ${pick.kind} "${pick.name}" (id ${pick.id}).` })
    }

    const innerColumns = CARD_COLUMNS - 4
    const innerRows = TILE_ROWS - 2

    const tile = (pick: Pick) => {
      if (pick.image === 'ready' && pick.file && pick.width && pick.height && Image) {
        const box = fitCells(pick.width, pick.height, innerColumns, innerRows)
        const bytes = inline.get(pick.id)
        return (
          <Image
            key={`img-${pick.id}`}
            source={bytes ? { png: bytes } : { file: pick.file, format: 'png' }}
            columns={box.columns}
            rows={box.rows}
            alt={pick.name}
          />
        )
      }
      if (pick.image === 'loading') return <Text dimColor>loading preview…</Text>
      return (
        <Box flexDirection="column" alignItems="center">
          <Text dimColor>{pick.mediaType === 'video' ? '▶ video preview' : 'image preview'}</Text>
          <Link href={pick.videoUrl ?? pick.stillUrl ?? pick.catalogUrl} label="open it" />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {current.summary && (
          <Box flexDirection="column">
            <Text bold>Your request</Text>
            <Text dimColor>{current.summary}</Text>
          </Box>
        )}
        {current.reasoning && (
          <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column">
            <Text bold>💡 Why these fit</Text>
            <Text dimColor>{current.reasoning}</Text>
          </Box>
        )}

        <Box flexDirection="row" gap={GAP} overflow="hidden" width={columns} flexWrap="nowrap">
          {window.map((pick, i) => {
            const n = start + i + 1
            const isChosen = pick.id === pickedId
            return (
              <Box key={`card-${pick.id}`} flexDirection="column" width={CARD_COLUMNS} flexShrink={0}>
                <Box
                  height={TILE_ROWS}
                  borderStyle="round"
                  borderColor={isChosen ? 'green' : undefined}
                  borderDimColor={!isChosen}
                  alignItems="center"
                  justifyContent="center"
                  overflow="hidden"
                >
                  {tile(pick)}
                </Box>
                <Text bold wrap="truncate-end">
                  {isChosen ? '✓ ' : ''}
                  {pick.name}
                </Text>
                {pick.author && <Text dimColor wrap="truncate-end">by {pick.author}</Text>}
                {pick.why && <Text dimColor wrap="truncate-end">{pick.why}</Text>}
                <Box flexDirection="row" gap={2}>
                  <Button
                    key={`use-${pick.id}`}
                    hotkey={n <= 9 ? String(n) : undefined}
                    variant={i === 0 && start === 0 ? 'primary' : undefined}
                    onPress={choose(pick)}
                  >
                    Use
                  </Button>
                  <Link href={pick.catalogUrl} label="View" />
                </Box>
              </Box>
            )
          })}
        </Box>

        {current.items.length > fits && (
          <Box flexDirection="row" gap={2} alignItems="center">
            <Button key="prev" hotkey="h" plain dimColor={start === 0} onPress={step(-1)}>
              ‹
            </Button>
            <Text>
              {current.items.map((_, i) => (i >= start && i < start + fits ? '●' : '○')).join(' ')}
            </Text>
            <Button key="next" hotkey="l" plain dimColor={start >= last} onPress={step(1)}>
              ›
            </Button>
            <Text dimColor>h / l to scroll · 1–{Math.min(9, current.items.length)} to use one</Text>
          </Box>
        )}
      </Box>
    )
  })
}

type Engine = Parameters<Parameters<Parameters<Register>[0]>[2]>[0]

/** Downloads a pick's still (image_url, else preview_url) as a PNG,
 *  then marks the card ready with its size. */
async function loadStill($: Engine, server: string, callId: string, pick: Pick) {
  const set = (patch: Partial<Pick>) =>
    update($, picks, p =>
      p && p.callId === callId
        ? { ...p, items: p.items.map(one => (one.id === pick.id ? { ...one, ...patch } : one)) }
        : p,
    )

  try {
    let still = pick.stillUrl
    if (!still) {
      // show_picks named no still: the catalog entry's, image_url first.
      const got = await $.mcp.call(server, pick.kind === 'flow' ? 'get_flow' : 'get_component', { id: pick.id })
      const entry = findEntry(got)
      still = str(entry?.image_url) ?? str(entry?.preview_url)
      const video = pick.videoUrl ?? str(entry?.video_url)
      await set({
        stillUrl: still,
        videoUrl: video,
        mediaType: pick.mediaType ?? (video ? 'video' : still ? 'image' : undefined),
      })
    }
    if (!still) throw new Error('no still')

    const dir = await ensureCacheDir($)
    const file = `${dir}/${pick.id.replace(/[^A-Za-z0-9_-]/g, '_')}.png`
    const got = await $.process.run(['curl', '-fsSL', '--max-time', '15', '-o', file, still], { timeoutMs: 20_000 })
    if (got.exitCode !== 0) throw new Error(`curl ${got.exitCode}`)
    // Image draws PNG only: anything else keeps the card's link.
    const bytes = await readIfPng($, file)
    if (!bytes) throw new Error('not a png')

    if (bytes.bytes <= MAX_INLINE_BYTES) inline.set(pick.id, bytes.base64)
    await set({ image: 'ready', file, width: bytes.size.width, height: bytes.size.height })
  } catch {
    // The session (or the module) may be gone by now: nothing left to draw.
    await set({ image: 'failed' }).catch(() => undefined)
  }
}

async function readIfPng($: Engine, path: string) {
  if (!(await $.fs.exists(path))) return undefined
  const { base64 } = (await $.fs.read(path, { as: 'bytes' })) as { base64: string }
  // The header is all pngSize reads: decode just its first 24 bytes.
  const head = Uint8Array.from(atob(base64.slice(0, 32)), c => c.charCodeAt(0))
  const size = pngSize(head)
  return size ? { base64, size, bytes: Math.floor((base64.length * 3) / 4) } : undefined
}

function ensureCacheDir($: Engine) {
  // One folder per load, made once even while every card asks at the same time.
  cacheDir ??= $.process.run(['mktemp', '-d', '-t', 'swiftux-picks.XXXXXX']).then(made => {
    if (made.exitCode !== 0) throw new Error('mktemp failed')
    return made.stdout.trim()
  })
  cacheDir.catch(() => {
    cacheDir = undefined
  })
  return cacheDir
}

function findEntry(value: unknown): Raw | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Raw
  if (v.structuredContent && typeof v.structuredContent === 'object') return v.structuredContent as Raw
  for (const block of (v.content as Raw[] | undefined) ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') {
      try {
        return JSON.parse(block.text) as Raw
      } catch {
        // not JSON
      }
    }
  }
  return undefined
}

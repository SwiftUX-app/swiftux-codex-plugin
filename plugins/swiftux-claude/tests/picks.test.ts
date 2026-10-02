import { expect, test } from 'claude-code/testing'

import { findPicksPayload, fitCells, pngSize, toPick } from '../hooks/register'

// A PNG signature and IHDR for a 1206x2622 screenshot (the catalog's phone size).
const PNG_HEAD = (() => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  b.set([0, 0, 0x04, 0xb6, 0, 0, 0x0a, 0x3e], 16)
  return btoa(String.fromCharCode(...b))
})()

const STRUCTURED = {
  request_summary: 'A paywall with a monthly/yearly toggle.',
  reasoning: 'Both cover the toggle.',
  items: [
    {
      kind: 'component', id: 'a1', name: 'Curved Sheet Paywall', author: '0xSphere',
      media_url: 'https://media.swiftux.app/image-assets/A.png', media_type: 'image',
      poster: 'https://media.swiftux.app/image-assets/A.png',
      catalog_url: 'https://www.swiftux.app/components/paywall/a1', use_when: 'Gradient paywall', why: null,
    },
    {
      kind: 'component', id: 'b2', name: 'Bottom Sheet Paywall', author: 'SwiftUX',
      media_url: 'https://media.swiftux.app/video-assets/B.mp4', media_type: 'video', poster: null,
      preview_url: 'https://media.swiftux.app/image-assets/B_Preview.png',
      catalog_url: 'https://www.swiftux.app/components/paywall/b2', use_when: 'Expanding sheet', why: null,
    },
    {
      kind: 'flow', id: 'c3', name: 'Plan Picker Flow', author: 'SwiftUX',
      media_url: 'https://media.swiftux.app/image-assets/C.png', media_type: 'image', poster: null,
      catalog_url: 'https://www.swiftux.app/flows/paywall/c3', use_when: 'Three steps', why: null,
    },
    {
      kind: 'component', id: 'd4', name: 'Settings List', author: 'SwiftUX',
      media_url: 'https://media.swiftux.app/video-assets/D.mp4', media_type: 'video', poster: null,
      catalog_url: 'https://www.swiftux.app/components/settings/d4', use_when: 'Grouped toggles', why: null,
    },
    {
      kind: 'component', id: 'e5', name: 'Bare Video', author: 'SwiftUX',
      media_url: 'https://media.swiftux.app/video-assets/E.mp4', media_type: 'video', poster: null,
      catalog_url: 'https://www.swiftux.app/components/settings/e5', use_when: 'No preview', why: null,
    },
  ],
}

test('image_url is the still; preview_url only when it is null', () => {
  const base = { kind: 'component', id: 'x', catalog_url: 'u' }
  expect(toPick({ ...base, image_url: 'img.png', preview_url: 'pre.png' }).stillUrl).toBe('img.png')
  expect(toPick({ ...base, image_url: null, preview_url: 'pre.png' }).stillUrl).toBe('pre.png')
  expect(toPick({ ...base, media_type: 'video', media_url: 'v.mp4', poster: 'pre.png' }).stillUrl).toBe('pre.png')
  expect(toPick({ ...base, media_type: 'image', media_url: 'img.png', poster: 'pre.png' }).stillUrl).toBe('img.png')
})

test('finds the payload in structuredContent or a JSON text block', () => {
  expect(findPicksPayload({ content: [], structuredContent: STRUCTURED })?.items).toEqual(STRUCTURED.items)
  expect(findPicksPayload([{ type: 'text', text: JSON.stringify(STRUCTURED) }])?.items).toEqual(STRUCTURED.items)
  expect(findPicksPayload([{ type: 'text', text: 'Curved Sheet Paywall — https://…' }])).toBe(undefined)
})

test('reads the PNG size and fits it to the tile, aspect kept', () => {
  const head = Uint8Array.from(atob(PNG_HEAD), c => c.charCodeAt(0))
  expect(pngSize(head)).toEqual({ width: 1206, height: 2622 })
  // A portrait phone screenshot in a 26x22 tile is bound by its height.
  expect(fitCells(1206, 2622, 26, 22)).toEqual({ columns: 20, rows: 22 })
})

test('show_picks draws a card rail with each picture', async ($, on) => {
  const commands: string[][] = []
  const written = new Set<string>()
  on('process.run', async (_$, e) => {
    commands.push([...e.argv])
    const argv = e.argv
    if (argv[0] === 'curl') written.add(argv[argv.indexOf('-o') + 1]!)

    const stdout = e.argv[0] === 'mktemp' ? '/tmp/swiftux-picks.test\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const looked: string[] = []
  on('mcp.call', async (_$, e) => {
    looked.push(`${e.server}/${e.tool}/${String(e.args?.id)}`)
    const preview_url = e.args?.id === 'd4' ? 'https://media.swiftux.app/image-assets/D_Preview.png' : null
    return { value: { content: [], isError: false, structuredContent: { id: e.args?.id, image_url: null, preview_url, video_url: 'x.mp4' } } }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('fs.exists', async (_$, e) => ({ value: written.has(e.path) }))
  on('fs.read', async () => ({ value: { base64: PNG_HEAD } }))
  on('tool.call', async () => ({ result: { content: [{ type: 'text', text: 'ok' }], structuredContent: STRUCTURED } }))

  await $.tool.call({
    tool: 'mcp__swiftux__show_picks',
    request_summary: STRUCTURED.request_summary,
    reasoning: STRUCTURED.reasoning,
    items: STRUCTURED.items.map(({ kind, id }) => ({ kind, id })),
  })

  // 72 columns: two 30-column cards fit, the third peeks in, the rail scrolls.
  const mount = () =>
    $.ui.mount({
      plugin: 'swiftux', surface: 'terminal', component: 'Pane',
      props: { requestId: 'swiftux-picks' }, requestId: 'swiftux-picks',
      viewport: { columns: 72, rows: 50 },
    } as never)
  const ui = await mount()

  // Images and video previews alike come down with curl; no ffmpeg.
  const fetched = commands.filter(c => c[0] === 'curl').map(c => c[c.length - 1])
  expect(fetched.sort()).toEqual([
    'https://media.swiftux.app/image-assets/A.png',
    'https://media.swiftux.app/image-assets/B_Preview.png',
    'https://media.swiftux.app/image-assets/C.png',
    'https://media.swiftux.app/image-assets/D_Preview.png',
  ])
  expect(commands.some(c => c[0] === 'ffmpeg')).toBe(false)
  // Only the videos show_picks gave no preview for are looked up.
  expect(looked).toEqual(['swiftux/get_component/d4', 'swiftux/get_component/e5'])

  const images = await ui.findAll({ type: 'Image' })
  expect(images.map(i => i.props.alt)).toEqual(['Curved Sheet Paywall', 'Bottom Sheet Paywall', 'Plan Picker Flow'])
  expect(images[0]?.props.columns).toBe(20)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['use-a1', 'use-b2', 'use-c3', 'prev', 'next'])

  await ui.press({ key: 'next' })
  const after = await ui.findAll({ type: 'Image' })
  expect(after.map(i => i.props.alt)).toEqual(['Bottom Sheet Paywall', 'Plan Picker Flow', 'Settings List'])

  // A video with no preview anywhere keeps a link to the video.
  await ui.press({ key: 'next' })
  await ui.press({ key: 'next' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('▶ video preview')

  // Desktop has no Image: the card links the preview instead.
  const desk = await $.ui.mount({
    plugin: 'swiftux', surface: 'desktop', component: 'Pane',
    props: { requestId: 'swiftux-picks' }, requestId: 'swiftux-picks',
  } as never)
  expect((await desk.findAll({ type: 'Image' })).length).toBe(0)
  // Scrolled to the last two cards, both videos: each links its video.
  expect((await desk.findAll({ type: 'Text' })).map(t => t.text).filter(t => t === '▶ video preview').length).toBe(2)
})

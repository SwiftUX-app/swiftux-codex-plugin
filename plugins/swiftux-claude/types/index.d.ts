/** One card, as show_picks' structuredContent spells it, plus what the mod fetched. */
export type Pick = {
  kind: 'component' | 'flow'
  id: string
  name: string
  author?: string
  catalogUrl: string
  why?: string
  mediaType?: 'image' | 'video'
  /** The URL of the still the card shows: the image, or a video's poster. */
  stillUrl?: string
  videoUrl?: string
  /** The downloaded PNG on disk, once fetched. */
  file?: string
  /** Its pixel size, read from the PNG header. */
  width?: number
  height?: number
  /** `loading` until the fetch settles; `failed` draws the alt. */
  image: 'loading' | 'ready' | 'failed'
}

export type Picks = {
  callId: string
  summary: string
  reasoning: string
  items: Pick[]
}

declare module 'claude-code' {
  interface PluginState {
    'swiftux': {
      picks: Picks | null
      offset: number
      chosen: string | null
    }
  }
}

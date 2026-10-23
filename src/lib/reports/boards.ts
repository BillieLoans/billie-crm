/**
 * Report boards: a page of report tiles that share one period, for a team's
 * standing view of the business. What a board holds and what a tile shows.
 * Pure definitions only.
 */
import { z } from 'zod'
import { REPORT_SLUG_RE } from '@/lib/schemas/reports'

export const MAX_BOARD_TILES = 12
export const BOARD_TILE_SHOWS = ['both', 'headline', 'chart'] as const
export type BoardTileShow = (typeof BOARD_TILE_SHOWS)[number]

export const BOARD_TILE_SHOW_LABELS: Record<BoardTileShow, string> = {
  both: 'Headline and chart',
  headline: 'Headline only',
  chart: 'Chart only',
}

/** The period a board opens on. */
export const DEFAULT_BOARD_RANGE = 'last-30'

export const boardTileSchema = z.object({
  id: z.string().min(1).max(40),
  report: z.string().regex(REPORT_SLUG_RE).max(50),
  parameters: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])),
  show: z.enum(BOARD_TILE_SHOWS).default('both'),
})
export type BoardTile = z.infer<typeof boardTileSchema>

export const boardTilesSchema = z.array(boardTileSchema).max(MAX_BOARD_TILES)

export const boardUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  tiles: boardTilesSchema.optional(),
  /** The version the change was made on (BoardView.version). */
  version: z.string().max(40).optional(),
})
export type BoardUpdate = z.infer<typeof boardUpdateSchema>

/** A board's link from its title: "Weekly credit review" -> "weekly-credit-review". */
export function boardSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)
      .replace(/^-+|-+$/g, '') || 'board'
  )
}

'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { BoardTileShow, BoardUpdate } from '@/lib/reports/boards'
import {
  BOARDS_KEY,
  sendBoardRequest,
  type BoardSummary,
  type BoardView,
} from '@/hooks/queries/useReportBoards'

/** Make a board (report authors). */
export function useCreateBoard() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: { title: string; description?: string }) =>
      (await sendBoardRequest<{ board: BoardSummary }>('/api/reports/boards', 'POST', input)).board,
    onSuccess: () => client.invalidateQueries({ queryKey: BOARDS_KEY }),
  })
}

/** Rename a board, or change its tiles (the whole list, in order). */
export function useUpdateBoard(slug: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (update: BoardUpdate) =>
      (
        await sendBoardRequest<{ board: BoardView }>(
          `/api/reports/boards/${encodeURIComponent(slug)}`,
          'PATCH',
          update,
        )
      ).board,
    onSuccess: (board) => {
      client.setQueryData([...BOARDS_KEY, slug], board)
      void client.invalidateQueries({ queryKey: BOARDS_KEY, exact: true })
    },
  })
}

export function useDeleteBoard() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) =>
      sendBoardRequest<{ ok: true }>(`/api/reports/boards/${encodeURIComponent(slug)}`, 'DELETE'),
    // The list only: refetching the deleted board itself would flash "not
    // found" on the page that is leaving it.
    onSuccess: () => client.invalidateQueries({ queryKey: BOARDS_KEY, exact: true }),
  })
}

/** Put a report on a board. */
export function useAddBoardTile() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      board: string
      report: string
      parameters: Record<string, unknown>
      show?: BoardTileShow
    }) =>
      (
        await sendBoardRequest<{ board: BoardView }>(
          `/api/reports/boards/${encodeURIComponent(input.board)}/tiles`,
          'POST',
          { report: input.report, parameters: input.parameters, show: input.show },
        )
      ).board,
    onSuccess: (board) => {
      client.setQueryData([...BOARDS_KEY, board.slug], board)
      void client.invalidateQueries({ queryKey: BOARDS_KEY, exact: true })
    },
  })
}

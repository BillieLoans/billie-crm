/**
 * Unit tests for SortableTable component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { SortableTable, type ColumnDef } from '@/components/SortableTable'

// Test data type
interface TestRow {
  id: string
  name: string
  amount: number
  date: Date
}

// Sample test data
const testData: TestRow[] = [
  { id: '1', name: 'Alice', amount: 100, date: new Date('2025-01-01') },
  { id: '2', name: 'Bob', amount: 200, date: new Date('2025-01-02') },
  { id: '3', name: 'Charlie', amount: 150, date: new Date('2025-01-03') },
]

// Column definitions
const columns: ColumnDef<TestRow>[] = [
  {
    key: 'name',
    label: 'Name',
    accessor: (row) => row.name,
  },
  {
    key: 'amount',
    label: 'Amount',
    accessor: (row) => row.amount,
    render: (row) => `$${row.amount}`,
  },
  {
    key: 'date',
    label: 'Date',
    accessor: (row) => row.date,
    render: (row) => row.date.toLocaleDateString(),
  },
]

describe('SortableTable', () => {
  beforeEach(() => {
    cleanup()
  })

  describe('Rendering', () => {
    it('should render all rows', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      expect(screen.getByTestId('row-1')).toBeInTheDocument()
      expect(screen.getByTestId('row-2')).toBeInTheDocument()
      expect(screen.getByTestId('row-3')).toBeInTheDocument()
    })

    it('should render column headers', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      expect(screen.getByTestId('header-name')).toHaveTextContent('Name')
      expect(screen.getByTestId('header-amount')).toHaveTextContent('Amount')
      expect(screen.getByTestId('header-date')).toHaveTextContent('Date')
    })

    it('should render custom cell content via render function', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      expect(screen.getByText('$100')).toBeInTheDocument()
      expect(screen.getByText('$200')).toBeInTheDocument()
    })

    it('should show empty message when data is empty', () => {
      render(
        <SortableTable
          data={[]}
          columns={columns}
          getRowKey={(row) => row.id}
          emptyMessage="No data available"
        />,
      )

      expect(screen.getByText('No data available')).toBeInTheDocument()
    })

    it('should apply custom testId', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
          testId="my-table"
        />,
      )

      expect(screen.getByTestId('my-table')).toBeInTheDocument()
    })
  })

  describe('Sorting', () => {
    it('should sort ascending on first header click', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      // Click Name header to sort
      fireEvent.click(screen.getByTestId('header-name'))

      // Check sort indicator
      expect(screen.getByTestId('header-name')).toHaveTextContent('▲')
    })

    it('should toggle to descending on second header click', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      // Click twice
      fireEvent.click(screen.getByTestId('header-name'))
      fireEvent.click(screen.getByTestId('header-name'))

      // Check sort indicator
      expect(screen.getByTestId('header-name')).toHaveTextContent('▼')
    })

    it('should sort data by string column', () => {
      const { container } = render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      // Click Name header
      fireEvent.click(screen.getByTestId('header-name'))

      // First row should be Alice (alphabetically first)
      const rows = container.querySelectorAll('[role="row"]')
      // First row is header, second is first data row
      expect(rows[1]).toHaveTextContent('Alice')
    })

    it('should sort data by numeric column', () => {
      const { container } = render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      // Click Amount header
      fireEvent.click(screen.getByTestId('header-amount'))

      // First row should have lowest amount ($100)
      const rows = container.querySelectorAll('[role="row"]')
      expect(rows[1]).toHaveTextContent('$100')
    })

    it('should respect defaultSortKey and defaultSortDirection', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
          defaultSortKey="amount"
          defaultSortDirection="desc"
        />,
      )

      // Amount header should show descending indicator
      expect(screen.getByTestId('header-amount')).toHaveTextContent('▼')
    })

    it('should reset to ascending when clicking different column', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      // Click Name header twice (now descending)
      fireEvent.click(screen.getByTestId('header-name'))
      fireEvent.click(screen.getByTestId('header-name'))

      // Click Amount header (should be ascending)
      fireEvent.click(screen.getByTestId('header-amount'))

      expect(screen.getByTestId('header-amount')).toHaveTextContent('▲')
      // Name should no longer show indicator
      expect(screen.getByTestId('header-name')).not.toHaveTextContent('▲')
      expect(screen.getByTestId('header-name')).not.toHaveTextContent('▼')
    })
  })

  describe('Non-sortable Columns', () => {
    it('should not sort when sortable is false', () => {
      const columnsWithNonSortable: ColumnDef<TestRow>[] = [
        {
          key: 'name',
          label: 'Name',
          accessor: (row) => row.name,
          sortable: false,
        },
        {
          key: 'amount',
          label: 'Amount',
          accessor: (row) => row.amount,
        },
      ]

      render(
        <SortableTable
          data={testData}
          columns={columnsWithNonSortable}
          getRowKey={(row) => row.id}
        />,
      )

      // Click non-sortable header
      fireEvent.click(screen.getByTestId('header-name'))

      // Should not show sort indicator
      expect(screen.getByTestId('header-name')).not.toHaveTextContent('▲')
      expect(screen.getByTestId('header-name')).not.toHaveTextContent('▼')
    })
  })

  describe('Row Click', () => {
    it('should call onRowClick when row is clicked', () => {
      const handleClick = vi.fn()

      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
          onRowClick={handleClick}
        />,
      )

      fireEvent.click(screen.getByTestId('row-1'))

      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(handleClick).toHaveBeenCalledWith(testData[0], 0)
    })

    it('should call onRowClick on Enter key press', () => {
      const handleClick = vi.fn()

      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
          onRowClick={handleClick}
        />,
      )

      fireEvent.keyDown(screen.getByTestId('row-2'), { key: 'Enter' })

      expect(handleClick).toHaveBeenCalledWith(testData[1], 1)
    })

    it('should make rows focusable when onRowClick is provided', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
          onRowClick={() => {}}
        />,
      )

      expect(screen.getByTestId('row-1')).toHaveAttribute('tabIndex', '0')
    })

    it('should not make rows focusable when onRowClick is not provided', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      expect(screen.getByTestId('row-1')).not.toHaveAttribute('tabIndex')
    })
  })

  describe('Accessibility', () => {
    it('should have proper aria-sort attribute', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
          defaultSortKey="name"
          defaultSortDirection="asc"
        />,
      )

      expect(screen.getByTestId('header-name').closest('[role="columnheader"]')).toHaveAttribute(
        'aria-sort',
        'ascending',
      )
    })

    it('should update aria-sort when direction changes', () => {
      render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
          defaultSortKey="name"
          defaultSortDirection="asc"
        />,
      )

      // Click to toggle to descending
      fireEvent.click(screen.getByTestId('header-name'))

      expect(screen.getByTestId('header-name').closest('[role="columnheader"]')).toHaveAttribute(
        'aria-sort',
        'descending',
      )
    })

    it('should have role attributes for table structure', () => {
      const { container } = render(
        <SortableTable
          data={testData}
          columns={columns}
          getRowKey={(row) => row.id}
        />,
      )

      expect(container.querySelector('[role="row"]')).toBeInTheDocument()
      expect(container.querySelector('[role="rowgroup"]')).toBeInTheDocument()
      expect(container.querySelector('[role="cell"]')).toBeInTheDocument()
    })
  })
})


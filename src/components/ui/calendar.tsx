import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

interface CalendarProps {
  selected?: Date
  onSelect?: (date: Date) => void
  maxDate?: Date
  className?: string
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function Calendar({ selected, onSelect, maxDate, className }: CalendarProps) {
  const [viewMonth, setViewMonth] = React.useState(() => {
    const d = selected ?? new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()

  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1))
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1))

  const today = new Date()

  // Build grid: 6 rows x 7 cols
  const cells: { date: Date; inMonth: boolean }[] = []
  for (let i = 0; i < firstDayOfWeek; i++) {
    const day = daysInPrevMonth - firstDayOfWeek + 1 + i
    cells.push({ date: new Date(year, month - 1, day), inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true })
  }
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    cells.push({ date: new Date(year, month + 1, d), inMonth: false })
  }

  const canGoNext = !maxDate || new Date(year, month + 1, 1) <= maxDate

  return (
    <div className={cn('p-3 select-none', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold">
          {MONTHS[month]} {year}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth} disabled={!canGoNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {cells.map(({ date, inMonth }, i) => {
          const isSelected = selected && isSameDay(date, selected)
          const isToday = isSameDay(date, today)
          const isDisabled = maxDate && date > maxDate

          return (
            <button
              key={i}
              type="button"
              disabled={!!isDisabled}
              onClick={() => onSelect?.(date)}
              className={cn(
                'h-8 w-full rounded-md text-sm transition-colors',
                !inMonth && 'text-muted-foreground/40',
                inMonth && !isSelected && 'hover:bg-accent',
                isSelected && 'bg-primary text-primary-foreground font-semibold',
                isToday && !isSelected && 'font-semibold text-primary',
                isDisabled && 'opacity-30 cursor-not-allowed'
              )}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

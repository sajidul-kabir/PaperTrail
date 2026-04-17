import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CalendarDays } from 'lucide-react'
import { Calendar } from './calendar'
import { Button } from './button'
import { cn } from '@/lib/utils'

interface DatePickerProps {
  value: string // YYYY-MM-DD
  onChange: (value: string) => void
  className?: string
}

function dateToISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoToDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDisplay(dateStr: string): string {
  if (!dateStr) return 'Pick a date'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function DatePicker({ value, onChange, className }: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          className={cn(
            'h-9 w-full justify-between px-3 text-sm font-normal',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <span>{formatDisplay(value)}</span>
          <CalendarDays className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 rounded-lg border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          sideOffset={4}
          align="start"
        >
          <Calendar
            selected={value ? isoToDate(value) : undefined}
            onSelect={(d) => {
              onChange(dateToISO(d))
              setOpen(false)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

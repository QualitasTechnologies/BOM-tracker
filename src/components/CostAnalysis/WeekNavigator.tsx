import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface WeekRange {
  start: string;  // YYYY-MM-DD (Monday)
  end: string;    // YYYY-MM-DD (Sunday)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toIso = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const weekRangeFromDate = (input: Date): WeekRange => {
  // Normalise to UTC midday to avoid DST edges, then snap to Monday.
  const d = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d.getTime() + offsetToMonday * MS_PER_DAY);
  const sunday = new Date(monday.getTime() + 6 * MS_PER_DAY);
  return { start: toIso(monday), end: toIso(sunday) };
};

export const shiftWeek = (range: WeekRange, weeks: number): WeekRange => {
  const start = new Date(`${range.start}T00:00:00Z`);
  const newStart = new Date(start.getTime() + weeks * 7 * MS_PER_DAY);
  const newEnd = new Date(newStart.getTime() + 6 * MS_PER_DAY);
  return { start: toIso(newStart), end: toIso(newEnd) };
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const formatWeekLabel = (range: WeekRange): string => {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  const year = end.getUTCFullYear();
  if (sameMonth) {
    return `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()} – ${end.getUTCDate()}, ${year}`;
  }
  return `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}, ${year}`;
};

interface Props {
  range: WeekRange;
  onChange: (range: WeekRange) => void;
}

export const WeekNavigator = ({ range, onChange }: Props) => {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => onChange(shiftWeek(range, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="text-sm font-medium min-w-[180px] text-center">
        {formatWeekLabel(range)}
      </div>
      <Button size="sm" variant="ghost" onClick={() => onChange(shiftWeek(range, 1))}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="outline" onClick={() => onChange(weekRangeFromDate(new Date()))}>
        This week
      </Button>
    </div>
  );
};

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { DigitCard } from '@/components/digit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ── Types ──────────────────────────────────────────────────────────────────

/** Shape returned by /api/agent/pgr-stats */
interface StatsEntry {
  serviceCode: string;
  status: string;
  count: number;
  date: string;
}

interface StatsResponse {
  complaints: StatsEntry[];
  total: number;
}

interface StatusEntry  { name: string; value: number; color: string }
interface TrendEntry   { name: string; complaints: number; resolved: number; _ts: number }

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  PENDINGATLME:          'hsl(var(--primary))',
  PENDINGFORASSIGNMENT:  'hsl(220, 70%, 55%)',
  RESOLVED:              'hsl(142, 60%, 45%)',
  CLOSEDAFTERRESOLUTION: 'hsl(160, 55%, 42%)',
  REJECTED:              'hsl(0, 70%, 55%)',
};
const FALLBACK_COLORS = [
  'hsl(var(--primary))',
  'hsl(220, 70%, 55%)',
  'hsl(142, 60%, 45%)',
  'hsl(0, 70%, 55%)',
  'hsl(45, 70%, 50%)',
  'hsl(280, 60%, 55%)',
];

/** Parse a date string into a JS Date, returning null if invalid */
function parseDate(date: string): Date | null {
  const ms = isNaN(Number(date)) ? Date.parse(date) : Number(date);
  const d  = new Date(isNaN(ms) ? date : ms);
  return isNaN(d.getTime()) ? null : d;
}

/** Returns "YYYY-MM" key for a date string, or '' if unparseable */
function getMonthKey(date: string): string {
  const d = parseDate(date);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Returns a readable "MMM YYYY" label from a "YYYY-MM" key */
function monthKeyToLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/** Returns ISO week number (1–53) for a Date */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Pie — group by status, sum counts */
function buildStatusData(entries: StatsEntry[]): StatusEntry[] {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.status] = (counts[e.status] || 0) + e.count;
  }
  return Object.entries(counts).map(([key, value], i) => ({
    name: key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
    value,
    color: STATUS_COLORS[key] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }));
}

/** Line / Area — group by ISO week */
function buildWeeklyTrendData(entries: StatsEntry[]): TrendEntry[] {
  const byWeek: Record<string, TrendEntry> = {};
  for (const e of entries) {
    const d = parseDate(e.date);
    if (!d) continue;
    const wk   = isoWeek(d);
    const yr   = d.getFullYear();
    const key  = `${yr}-W${String(wk).padStart(2, '0')}`;
    const label = `W${wk} '${String(yr).slice(2)}`;
    // Compute Monday of that week for sort order
    const dow     = d.getDay() || 7;
    const monday  = new Date(d);
    monday.setDate(d.getDate() - (dow - 1));
    const epoch = monday.getTime();
    if (!byWeek[key]) byWeek[key] = { name: label, complaints: 0, resolved: 0, _ts: epoch };
    byWeek[key].complaints += e.count;
    if (['RESOLVED', 'CLOSEDAFTERRESOLUTION'].includes(e.status)) {
      byWeek[key].resolved += e.count;
    }
  }
  return Object.values(byWeek).sort((a, b) => a._ts - b._ts);
}

/** Line / Area — group by month (for volume chart) */
function buildMonthlyTrendData(entries: StatsEntry[]): TrendEntry[] {
  const byMonth: Record<string, TrendEntry> = {};
  for (const e of entries) {
    const d = parseDate(e.date);
    if (!d) continue;
    const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    const epoch = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    if (!byMonth[key]) byMonth[key] = { name: label, complaints: 0, resolved: 0, _ts: epoch };
    byMonth[key].complaints += e.count;
    if (['RESOLVED', 'CLOSEDAFTERRESOLUTION'].includes(e.status)) {
      byMonth[key].resolved += e.count;
    }
  }
  return Object.values(byMonth).sort((a, b) => a._ts - b._ts);
}

// ── Shared tooltip style ───────────────────────────────────────────────────

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  fontSize: '12px',
};

// ── Shared chart margins ───────────────────────────────────────────────────

const chartMargin = { top: 12, right: 28, left: 16, bottom: 8 };

// ── Component ──────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [total,      setTotal]      = useState(0);
  const [allEntries, setAllEntries] = useState<StatsEntry[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  useEffect(() => {
    fetch('/api/agent/pgr-stats')
      .then(r => {
        if (!r.ok) throw new Error(`pgr-stats failed: HTTP ${r.status}`);
        return r.json();
      })
      .then((data: StatsResponse) => {
        const entries = data.complaints ?? [];
        setTotal(data.total ?? entries.reduce((s, e) => s + e.count, 0));
        setAllEntries(entries);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Available months derived from data
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    for (const e of allEntries) {
      const mk = getMonthKey(e.date);
      if (mk) months.add(mk);
    }
    return Array.from(months).sort();
  }, [allEntries]);

  // Filter entries by selected month
  const filteredEntries = useMemo(() => {
    if (selectedMonth === 'all') return allEntries;
    return allEntries.filter(e => getMonthKey(e.date) === selectedMonth);
  }, [allEntries, selectedMonth]);

  // Build chart datasets from filtered entries
  const statusData      = useMemo(() => buildStatusData(filteredEntries),      [filteredEntries]);
  const weeklyTrendData = useMemo(() => buildWeeklyTrendData(filteredEntries), [filteredEntries]);
  const volumeData      = useMemo(() => buildMonthlyTrendData(filteredEntries), [filteredEntries]);

  // ── Loading / Error ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground animate-pulse">Fetching PGR complaints…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive font-medium">Failed to load PGR data</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">

      {/* Header + global filter */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold font-condensed text-foreground">
            Analytics Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Live PGR data —{' '}
            <span className="font-medium text-foreground">{total}</span>{' '}
            complaint{total !== 1 ? 's' : ''} via{' '}
            <span className="font-medium text-foreground">/api/agent/pgr-stats</span>
          </p>
        </div>

        {/* Global month filter */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Filter by month:</span>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[160px] h-9 text-sm">
              <SelectValue placeholder="All months" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {availableMonths.map(mk => (
                <SelectItem key={mk} value={mk}>
                  {monthKeyToLabel(mk)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Pie Chart — status distribution ── */}
      <DigitCard>
        <h3 className="text-sm font-semibold text-muted-foreground mb-4">
          Complaint Status Distribution
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <PieChart margin={{ top: 8, right: 40, left: 40, bottom: 8 }}>
            <Pie
              data={statusData}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={120}
              paddingAngle={3}
              dataKey="value"
              label={({ name, percent }) =>
                percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
              }
              labelLine
            >
              {statusData.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '16px' }} />
          </PieChart>
        </ResponsiveContainer>
      </DigitCard>

      {/* ── Line Chart — resolution trend by week ── */}
      <DigitCard>
        <h3 className="text-sm font-semibold text-muted-foreground mb-4">
          Resolution Trend by Week
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={weeklyTrendData} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              stroke="hsl(var(--muted-foreground))"
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              stroke="hsl(var(--muted-foreground))"
              width={40}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
            <Line
              type="monotone"
              dataKey="complaints"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              name="Filed"
            />
            <Line
              type="monotone"
              dataKey="resolved"
              stroke="hsl(142, 60%, 45%)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              name="Resolved"
            />
          </LineChart>
        </ResponsiveContainer>
      </DigitCard>

      {/* ── Area Chart — complaint volume over time ── */}
      <DigitCard>
        <h3 className="text-sm font-semibold text-muted-foreground mb-4">
          Complaint Volume Over Time
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={volumeData} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              stroke="hsl(var(--muted-foreground))"
              width={40}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
            <Area
              type="monotone"
              dataKey="complaints"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              fillOpacity={0.15}
              strokeWidth={2}
              name="Complaints"
            />
            <Area
              type="monotone"
              dataKey="resolved"
              stroke="hsl(142, 60%, 45%)"
              fill="hsl(142, 60%, 45%)"
              fillOpacity={0.12}
              strokeWidth={2}
              name="Resolved"
            />
          </AreaChart>
        </ResponsiveContainer>
      </DigitCard>

    </div>
  );
}

import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { DigitCard } from '@/components/digit';
import { apiClient } from '@/api/client';

// ── Types ──────────────────────────────────────────────────────────────────

interface PGRService {
  serviceRequestId: string;
  serviceCode: string;
  applicationStatus: string;
  auditDetails: { createdTime: number; lastModifiedTime: number };
  tenantId: string;
}

interface PGRServiceWrapper {
  service: PGRService;
}

interface StatusEntry  { name: string; value: number; color: string }
interface ServiceEntry { name: string; count: number }
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

/** Convert a camelCase / ALLCAPS service code into readable label */
function prettifyServiceCode(code: string): string {
  return code
    .replace(/([A-Z])/g, ' $1')
    .replace(/^[\s_]+/, '')
    .trim();
}

/** "MMM YY" label + epoch for sorting */
function monthLabel(ts: number): { label: string; epoch: number } {
  const d = new Date(ts);
  const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  // epoch = first millisecond of that month, for sorting
  const epoch = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return { label, epoch };
}

function buildStatusData(wrappers: PGRServiceWrapper[]): StatusEntry[] {
  const counts: Record<string, number> = {};
  for (const w of wrappers) {
    const s = w.service.applicationStatus;
    counts[s] = (counts[s] || 0) + 1;
  }
  return Object.entries(counts).map(([key, value], i) => ({
    name: key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
    value,
    color: STATUS_COLORS[key] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }));
}

function buildServiceData(wrappers: PGRServiceWrapper[]): ServiceEntry[] {
  const counts: Record<string, number> = {};
  for (const w of wrappers) {
    const s = w.service.serviceCode;
    counts[s] = (counts[s] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([code, count]) => ({ name: prettifyServiceCode(code), count }))
    .sort((a, b) => b.count - a.count);
}

function buildTrendData(wrappers: PGRServiceWrapper[]): TrendEntry[] {
  const byMonth: Record<string, TrendEntry> = {};
  for (const w of wrappers) {
    const { label, epoch } = monthLabel(w.service.auditDetails.createdTime);
    if (!byMonth[label]) byMonth[label] = { name: label, complaints: 0, resolved: 0, _ts: epoch };
    byMonth[label].complaints += 1;
    if (['RESOLVED', 'CLOSEDAFTERRESOLUTION'].includes(w.service.applicationStatus)) {
      byMonth[label].resolved += 1;
    }
  }
  return Object.values(byMonth).sort((a, b) => a._ts - b._ts);
}

// ── Tooltip style (shared) ─────────────────────────────────────────────────

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  fontSize: '12px',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [total,       setTotal]       = useState(0);
  const [statusData,  setStatusData]  = useState<StatusEntry[]>([]);
  const [serviceData, setServiceData] = useState<ServiceEntry[]>([]);
  const [trendData,   setTrendData]   = useState<TrendEntry[]>([]);

  useEffect(() => {
    const baseUrl = apiClient.getEnvironment();
    if (!baseUrl) {
      setError('No DIGIT environment configured. Please log in first.');
      setLoading(false);
      return;
    }

    const url  = `${baseUrl}/pgr-services/v2/request/_search?tenantId=pg.citya`;
    const { token } = apiClient.getAuth();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(url, { headers })
      .then(r => {
        if (!r.ok) throw new Error(`PGR search failed: HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { ServiceWrappers?: PGRServiceWrapper[] }) => {
        const wrappers = data.ServiceWrappers ?? [];
        setTotal(wrappers.length);
        setStatusData(buildStatusData(wrappers));
        setServiceData(buildServiceData(wrappers));
        setTrendData(buildTrendData(wrappers));
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // ── Loading / Error states ───────────────────────────────────────────────

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

  // ── Charts ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-condensed text-foreground">
          Analytics Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Live PGR data — <span className="font-medium text-foreground">{total}</span> complaint{total !== 1 ? 's' : ''} from <span className="font-medium text-foreground">pg.citya</span>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Bar Chart — complaints by service type */}
        <DigitCard>
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">Complaints by Service Type</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={serviceData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                stroke="hsl(var(--muted-foreground))"
                angle={-30}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                stroke="hsl(var(--muted-foreground))"
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Complaints" />
            </BarChart>
          </ResponsiveContainer>
        </DigitCard>

        {/* Pie Chart — status distribution */}
        <DigitCard>
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">Complaint Status Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={statusData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={95}
                paddingAngle={3}
                dataKey="value"
                label={({ name, percent }) =>
                  percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                }
                labelLine={false}
              >
                {statusData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        </DigitCard>

        {/* Line Chart — complaint vs resolved trend by month */}
        <DigitCard>
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">Resolution Trend by Month</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendData}>
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
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Line
                type="monotone"
                dataKey="complaints"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 4 }}
                name="Filed"
              />
              <Line
                type="monotone"
                dataKey="resolved"
                stroke="hsl(142, 60%, 45%)"
                strokeWidth={2}
                dot={{ r: 4 }}
                name="Resolved"
              />
            </LineChart>
          </ResponsiveContainer>
        </DigitCard>

        {/* Area Chart — complaint volume over time */}
        <DigitCard>
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">Complaint Volume Over Time</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trendData}>
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
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Area
                type="monotone"
                dataKey="complaints"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary) / 0.15)"
                strokeWidth={2}
                name="Complaints"
              />
              <Area
                type="monotone"
                dataKey="resolved"
                stroke="hsl(142, 60%, 45%)"
                fill="hsl(142, 60%, 45% / 0.12)"
                strokeWidth={2}
                name="Resolved"
              />
            </AreaChart>
          </ResponsiveContainer>
        </DigitCard>

      </div>
    </div>
  );
}

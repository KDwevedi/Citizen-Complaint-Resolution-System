import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { DigitCard } from '@/components/digit';

// Placeholder data — the AI agent will replace this with live DIGIT API data
const PLACEHOLDER_DATA = [
  { name: 'Jan', complaints: 12, resolved: 8 },
  { name: 'Feb', complaints: 19, resolved: 14 },
  { name: 'Mar', complaints: 15, resolved: 11 },
  { name: 'Apr', complaints: 22, resolved: 18 },
  { name: 'May', complaints: 8, resolved: 7 },
  { name: 'Jun', complaints: 14, resolved: 10 },
];

const STATUS_DATA = [
  { name: 'Open', value: 12, color: 'hsl(var(--primary))' },
  { name: 'Assigned', value: 8, color: 'hsl(220, 70%, 55%)' },
  { name: 'Resolved', value: 24, color: 'hsl(142, 60%, 45%)' },
  { name: 'Rejected', value: 3, color: 'hsl(0, 70%, 55%)' },
];

export default function ChartsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-condensed text-foreground">
          Analytics Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Complaint trends and service metrics — ask the AI to populate with live data
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart */}
        <DigitCard>
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">Complaints by Month</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={PLACEHOLDER_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="complaints" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Filed" />
              <Bar dataKey="resolved" fill="hsl(142, 60%, 45%)" radius={[4, 4, 0, 0]} name="Resolved" />
            </BarChart>
          </ResponsiveContainer>
        </DigitCard>

        {/* Pie Chart */}
        <DigitCard>
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">Complaint Status Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={STATUS_DATA}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={3}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {STATUS_DATA.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        </DigitCard>

        {/* Line Chart */}
        <DigitCard>
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">Resolution Trend</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={PLACEHOLDER_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Line type="monotone" dataKey="complaints" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} name="Filed" />
              <Line type="monotone" dataKey="resolved" stroke="hsl(142, 60%, 45%)" strokeWidth={2} dot={{ r: 4 }} name="Resolved" />
            </LineChart>
          </ResponsiveContainer>
        </DigitCard>

        {/* Area Chart */}
        <DigitCard>
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">Complaint Volume</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={PLACEHOLDER_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Area type="monotone" dataKey="complaints" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} name="Complaints" />
            </AreaChart>
          </ResponsiveContainer>
        </DigitCard>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import useDashboardStore from '../stores/useDashboardStore';
import { formatSol } from '../utils/format';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

export default function DashboardPage() {
  const { balance, pnlSummary, systemMetrics, dexLatency, fetchPnlSummary } = useDashboardStore();
  const [dailyPnlData, setDailyPnlData] = useState<{ date: string; profit: number }[]>([]);

  useEffect(() => {
    fetchPnlSummary();
    // Fetch daily P&L data
    fetch('/api/pnl/daily?days=14')
      .then(r => r.json())
      .then(d => setDailyPnlData(d.data || []))
      .catch(() => {});
  }, []);

  const stats = [
    {
      label: 'SOL Balance',
      value: balance ? `${formatSol(balance.sol)} SOL` : '—',
      sub: balance ? `$${balance.usd_value.toFixed(2)}` : undefined,
      color: 'text-green-400',
    },
    {
      label: 'Total Profit',
      value: pnlSummary ? `${pnlSummary.total_profit_sol >= 0 ? '+' : ''}${formatSol(pnlSummary.total_profit_sol)}` : '—',
      color: pnlSummary && pnlSummary.total_profit_sol >= 0 ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'Daily P&L',
      value: pnlSummary ? `${pnlSummary.daily_profit_sol >= 0 ? '+' : ''}${formatSol(pnlSummary.daily_profit_sol)}` : '—',
      color: pnlSummary && pnlSummary.daily_profit_sol >= 0 ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'Win Rate',
      value: pnlSummary ? `${pnlSummary.win_rate_pct.toFixed(1)}%` : '—',
      sub: pnlSummary ? `${pnlSummary.successful_trades}/${pnlSummary.total_trades} trades` : undefined,
      color: pnlSummary && pnlSummary.win_rate_pct >= 50 ? 'text-green-400' : 'text-yellow-400',
    },
    {
      label: 'CPU',
      value: systemMetrics ? `${systemMetrics.cpu_usage_pct.toFixed(1)}%` : '—',
      color: systemMetrics && systemMetrics.cpu_usage_pct > 80 ? 'text-red-400' : systemMetrics && systemMetrics.cpu_usage_pct > 50 ? 'text-yellow-400' : 'text-green-400',
    },
    {
      label: 'Memory',
      value: systemMetrics ? `${systemMetrics.memory_usage_mb.toFixed(0)} MB` : '—',
      color: 'text-blue-400',
    },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-white">Dashboard Overview</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-gray-900 rounded-lg p-4 border border-gray-800 hover:border-gray-700 transition-colors">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{s.label}</div>
            <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
            {s.sub && <div className="text-xs text-gray-600 mt-1">{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* P&L Chart */}
        <div className="lg:col-span-2 bg-gray-900 rounded-lg border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Profit / Loss (14 days)</h3>
          <div className="h-72">
            {dailyPnlData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyPnlData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" stroke="#6b7280" fontSize={11} tickLine={false} tickFormatter={(v) => v.slice(5)} />
                  <YAxis stroke="#6b7280" fontSize={11} tickLine={false} tickFormatter={(v) => `${v.toFixed(3)}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#f9fafb' }}
                    formatter={(value: number) => [`${value.toFixed(4)} SOL`, 'Profit']}
                  />
                  <Line type="monotone" dataKey="profit" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#6366f1' }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-600 text-sm">No P&L data yet</div>
            )}
          </div>
        </div>

        {/* System Health */}
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">System Health</h3>
          <div className="space-y-5">
            {/* RPC Endpoints */}
            <div>
              <h4 className="text-xs text-gray-500 mb-2">RPC Endpoints</h4>
              <div className="space-y-2">
                {(systemMetrics?.rpc_endpoints ?? []).length > 0 ? (
                  systemMetrics!.rpc_endpoints.map((rpc, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${
                          rpc.status === 'healthy' ? 'bg-green-400' :
                          rpc.status === 'degraded' ? 'bg-yellow-400' : 'bg-red-500'
                        }`} />
                        <span className="text-gray-400 font-mono truncate max-w-[120px]">{rpc.url.replace(/https?:\/\//, '')}</span>
                      </div>
                      <span className="text-gray-500">{rpc.latency_ms}ms</span>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-gray-600">No RPC data</div>
                )}
              </div>
            </div>

            {/* CPU/Memory bars */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">CPU</span>
                <span className="text-xs font-mono text-gray-400">{systemMetrics?.cpu_usage_pct.toFixed(1) ?? '—'}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.min(systemMetrics?.cpu_usage_pct ?? 0, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">Memory</span>
                <span className="text-xs font-mono text-gray-400">
                  {systemMetrics ? `${systemMetrics.memory_usage_mb.toFixed(0)} / ${systemMetrics.memory_total_mb.toFixed(0)} MB` : '—'}
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${systemMetrics ? (systemMetrics.memory_usage_mb / systemMetrics.memory_total_mb * 100).toFixed(0) : 0}%` }} />
              </div>
            </div>

            {/* Uptime / Scans */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <div className="text-xs text-gray-500">Uptime</div>
                <div className="text-sm font-mono text-gray-300">
                  {systemMetrics ? `${Math.floor(systemMetrics.uptime_seconds / 3600)}h ${Math.floor((systemMetrics.uptime_seconds % 3600) / 60)}m` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Scans/min</div>
                <div className="text-sm font-mono text-gray-300">{systemMetrics?.opportunities_scanned ?? '—'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DEX Latency Bar Chart */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">DEX Latency</h3>
        <div className="h-64">
          {dexLatency.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dexLatency.map(d => ({ ...d, name: d.dex_name.charAt(0).toUpperCase() + d.dex_name.slice(1) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={12} tickLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} unit="ms" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#f9fafb' }}
                  formatter={(value: number) => [`${value.toFixed(1)} ms`, 'Latency']}
                />
                <Bar dataKey="latency_ms" radius={[4, 4, 0, 0]}>
                  {dexLatency.map((entry, index) => (
                    <rect key={index} fill={entry.is_healthy ? '#6366f1' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-600 text-sm">No latency data yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
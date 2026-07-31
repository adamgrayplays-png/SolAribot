import { useState, useEffect } from 'react';
import useDashboardStore from '../stores/useDashboardStore';
import { formatSol, formatTimestamp, shortenSignature, getExplorerUrl, getStatusColor } from '../utils/format';

export default function TradeHistoryPage() {
  const { trades, tradesTotal, tradesPage, tradesPages, fetchTrades } = useDashboardStore();
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    const params: Record<string, string> = { page: String(page), limit: '20' };
    if (dateFrom) params.from = dateFrom;
    if (dateTo) params.to = dateTo;
    if (statusFilter) params.status = statusFilter;
    fetchTrades(params);
  }, [page, dateFrom, dateTo, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-white">Trade History</h2>
        <span className="text-xs text-gray-500">{tradesTotal} total trades</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <div className="flex items-center space-x-2">
          <label className="text-xs text-gray-500">From:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setPage(1); setDateFrom(e.target.value); }}
            className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1.5"
          />
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-xs text-gray-500">To:</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setPage(1); setDateTo(e.target.value); }}
            className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1.5"
          />
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-xs text-gray-500">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
            className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1.5"
          >
            <option value="">All</option>
            <option value="confirmed">Success</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        {(dateFrom || dateTo || statusFilter) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setStatusFilter(''); setPage(1); }}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Trades table */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-600">
            <div className="text-center">
              <div className="text-2xl mb-2">📋</div>
              <div className="text-sm">No trades found</div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase bg-gray-800/50">
                  <th className="text-left px-5 py-3 font-medium">Time</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-left px-3 py-3 font-medium hidden md:table-cell">Route</th>
                  <th className="text-right px-3 py-3 font-medium">Expected</th>
                  <th className="text-right px-3 py-3 font-medium">Realized</th>
                  <th className="text-right px-3 py-3 font-medium">Status</th>
                  <th className="text-right px-5 py-3 font-medium hidden sm:table-cell">Tx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {trades.map((trade) => {
                  const routeSummary = trade.route?.map(r => r.dex).join('→') || trade.trade_type;
                  return (
                    <tr key={trade.id} className="hover:bg-gray-800/50 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                        {formatTimestamp(trade.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                          {trade.trade_type}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500 hidden md:table-cell font-mono max-w-[150px] truncate">
                        {routeSummary}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-green-400/80">
                        +{formatSol(trade.expected_profit)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`font-mono text-xs ${
                          trade.actual_profit != null
                            ? trade.actual_profit >= 0 ? 'text-green-400' : 'text-red-400'
                            : 'text-gray-500'
                        }`}>
                          {trade.actual_profit != null ? formatSol(trade.actual_profit) : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`text-xs font-mono ${getStatusColor(trade.status)}`}>
                          {trade.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right hidden sm:table-cell">
                        {trade.tx_signature ? (
                          <a
                            href={getExplorerUrl(trade.tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-indigo-400 hover:text-indigo-300 hover:underline"
                          >
                            {shortenSignature(trade.tx_signature)}
                          </a>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {tradesPages > 1 && (
        <div className="flex items-center justify-center space-x-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500">
            Page {tradesPage} of {tradesPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(tradesPages, p + 1))}
            disabled={page >= tradesPages}
            className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
import { useState } from 'react';
import useDashboardStore from '../stores/useDashboardStore';
import { formatSol, formatTimestamp } from '../utils/format';

const DEX_NAMES: Record<string, string> = {
  jupiter: 'Jupiter', raydium: 'Raydium', orca: 'Orca',
  meteora: 'Meteora', lifinity: 'Lifinity', openbook: 'OpenBook', phoenix: 'Phoenix',
};

export default function OpportunitiesPage() {
  const { opportunities } = useDashboardStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [minProfit, setMinProfit] = useState(0);

  const filtered = opportunities.filter(o => o.expected_profit >= minProfit / 100000);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Arbitrage Opportunities</h2>
        <div className="flex items-center space-x-2">
          <label className="text-xs text-gray-500">Min profit:</label>
          <select
            value={minProfit}
            onChange={(e) => setMinProfit(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1"
          >
            <option value={0}>All</option>
            <option value={1}>0.0001 SOL</option>
            <option value={5}>0.0005 SOL</option>
            <option value={10}>0.001 SOL</option>
            <option value={50}>0.005 SOL</option>
          </select>
          <span className="text-xs text-gray-500">({filtered.length} shown)</span>
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-600">
            <div className="text-center">
              <div className="text-2xl mb-2">🔍</div>
              <div className="text-sm">No opportunities detected</div>
              <div className="text-xs text-gray-700 mt-1">Waiting for market data...</div>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {filtered.map((opp) => {
              const isExpanded = expandedId === opp.id;
              const routeSummary = opp.route?.map(r => DEX_NAMES[r.dex] || r.dex).join(' → ') || opp.trade_type;

              return (
                <div key={opp.id}>
                  {/* Main row */}
                  <div
                    className="px-5 py-3.5 hover:bg-gray-800/50 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : opp.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4 min-w-0">
                        <span className="text-xs font-mono text-gray-500 whitespace-nowrap">
                          {formatTimestamp(opp.detected_at)}
                        </span>
                        <span className="text-xs bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          {opp.trade_type}
                        </span>
                        <span className="text-xs text-gray-400 truncate hidden md:inline">{routeSummary}</span>
                      </div>
                      <div className="flex items-center space-x-4 flex-shrink-0">
                        <span className="text-xs text-gray-500">{opp.profit_margin_bps.toFixed(1)} bps</span>
                        <span className="text-sm font-mono font-medium text-green-400">
                          +{formatSol(opp.expected_profit)}
                        </span>
                        {/* ML confidence */}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          opp.confidence > 0.8 ? 'bg-green-900/30 text-green-400' :
                          opp.confidence > 0.6 ? 'bg-yellow-900/30 text-yellow-400' :
                          'bg-gray-800 text-gray-400'
                        }`}>
                          {(opp.confidence * 100).toFixed(0)}%
                        </span>
                        {/* Fake probability badge */}
                        {opp.fake_probability > 0.3 && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            opp.fake_probability > 0.7 ? 'bg-red-900/30 text-red-400' : 'bg-yellow-900/30 text-yellow-400'
                          }`}>
                            Fake: {(opp.fake_probability * 100).toFixed(0)}%
                          </span>
                        )}
                        <svg className={`w-4 h-4 text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-5 pb-4 border-t border-gray-800/50">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3">
                        <div>
                          <div className="text-xs text-gray-500">Route</div>
                          <div className="text-sm text-gray-300 font-mono mt-0.5">{routeSummary}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Expected Profit</div>
                          <div className="text-sm text-green-400 font-mono mt-0.5">+{formatSol(opp.expected_profit)} SOL</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Margin</div>
                          <div className="text-sm text-gray-300 font-mono mt-0.5">{opp.profit_margin_bps.toFixed(2)} bps</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Est. Slippage</div>
                          <div className="text-sm text-gray-300 font-mono mt-0.5">{opp.estimated_slippage_bps.toFixed(2)} bps</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">ML Confidence</div>
                          <div className={`text-sm font-mono mt-0.5 ${
                            opp.confidence > 0.8 ? 'text-green-400' : opp.confidence > 0.6 ? 'text-yellow-400' : 'text-gray-400'
                          }`}>
                            {(opp.confidence * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Fake Probability</div>
                          <div className={`text-sm font-mono mt-0.5 ${
                            opp.fake_probability > 0.7 ? 'text-red-400' : opp.fake_probability > 0.3 ? 'text-yellow-400' : 'text-green-400'
                          }`}>
                            {(opp.fake_probability * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Detected At</div>
                          <div className="text-sm text-gray-300 font-mono mt-0.5">{opp.detected_at}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Expires</div>
                          <div className="text-sm text-gray-300 font-mono mt-0.5">{opp.expired_at || '—'}</div>
                        </div>
                      </div>
                      {opp.route && opp.route.length > 1 && (
                        <div className="mt-3 pt-3 border-t border-gray-800">
                          <div className="text-xs text-gray-500 mb-2">Route Steps</div>
                          <div className="flex items-center space-x-2 text-xs text-gray-400">
                            {opp.route.map((step, i) => (
                              <span key={i} className="flex items-center">
                                <span className="bg-gray-800 px-2 py-1 rounded">{step.dex}</span>
                                {i < opp.route.length - 1 && <span className="mx-1 text-gray-600">→</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
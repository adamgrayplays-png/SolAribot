import { useEffect } from 'react';
import useDashboardStore from '../stores/useDashboardStore';
import { formatSol } from '../utils/format';

export default function PositionsPage() {
  const { positions, fetchPositions } = useDashboardStore();

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Open Positions</h2>
        <span className="text-xs text-gray-500">{positions.length} active</span>
      </div>

      {positions.length === 0 ? (
        <div className="bg-gray-900 rounded-lg border border-gray-800 flex items-center justify-center h-48">
          <div className="text-center">
            <div className="text-2xl mb-2">📦</div>
            <div className="text-sm text-gray-600">No open positions</div>
            <div className="text-xs text-gray-700 mt-1">Executed trades will appear here</div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {positions.map((pos) => {
            const isProfitable = pos.pnl_sol >= 0;
            return (
              <div key={pos.id} className="bg-gray-900 rounded-lg border border-gray-800 p-5 hover:border-gray-700 transition-colors">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  {/* Left: Token info */}
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-indigo-500/10 rounded-lg flex items-center justify-center">
                      <span className="text-lg font-bold text-indigo-400 text-xs">
                        {pos.token_pair.replace('/', '').slice(0, 4)}
                      </span>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{pos.token_pair}</div>
                      <div className="text-xs text-gray-500 font-mono">
                        Age: {pos.age_seconds >= 3600
                          ? `${(pos.age_seconds / 3600).toFixed(1)}h`
                          : `${(pos.age_seconds / 60).toFixed(0)}m`}
                      </div>
                    </div>
                  </div>

                  {/* Right: Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Amount</div>
                      <div className="text-sm font-mono text-gray-300">{pos.amount.toFixed(4)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Entry Price</div>
                      <div className="text-sm font-mono text-gray-300">{pos.entry_price.toFixed(6)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Current Price</div>
                      <div className="text-sm font-mono text-gray-300">{pos.current_price.toFixed(6)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">P&L</div>
                      <div className={`text-sm font-mono font-semibold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                        {isProfitable ? '+' : ''}{formatSol(pos.pnl_sol)} SOL
                        <span className="ml-1 text-xs">({isProfitable ? '+' : ''}{pos.pnl_pct.toFixed(2)}%)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Progress bar for P&L visualization */}
                <div className="mt-3 w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${isProfitable ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(Math.abs(pos.pnl_pct) * 2, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
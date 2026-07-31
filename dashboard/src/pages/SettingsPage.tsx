import { useState, useEffect } from 'react';
import useDashboardStore from '../stores/useDashboardStore';

const ALL_DEXES = ['jupiter', 'raydium', 'orca', 'meteora', 'lifinity', 'openbook', 'phoenix'];

export default function SettingsPage() {
  const { settings, errors, fetchSettings, updateSettings } = useDashboardStore();
  const [form, setForm] = useState({
    min_profit_threshold: 0.001,
    max_position_size: 10,
    daily_loss_limit: 1,
    slippage_bps: 50,
    max_concurrent_trades: 3,
    trade_cooldown_secs: 60,
    enabled_dexes: ALL_DEXES,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      setForm({
        min_profit_threshold: settings.min_profit_threshold,
        max_position_size: settings.max_position_size,
        daily_loss_limit: settings.daily_loss_limit,
        slippage_bps: settings.slippage_bps,
        max_concurrent_trades: settings.max_concurrent_trades,
        trade_cooldown_secs: settings.trade_cooldown_secs,
        enabled_dexes: settings.enabled_dexes,
      });
    }
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await updateSettings(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // error is in store
    }
    setSaving(false);
  };

  const toggleDex = (dex: string) => {
    setForm(prev => ({
      ...prev,
      enabled_dexes: prev.enabled_dexes.includes(dex)
        ? prev.enabled_dexes.filter(d => d !== dex)
        : [...prev.enabled_dexes, dex],
    }));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-white">Settings</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Trading Parameters */}
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Trading Parameters</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Min Profit Threshold */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">Minimum Profit Threshold (SOL)</label>
              <div className="flex items-center space-x-3">
                <input
                  type="range"
                  min="0.0001"
                  max="0.01"
                  step="0.0001"
                  value={form.min_profit_threshold}
                  onChange={(e) => setForm(f => ({ ...f, min_profit_threshold: parseFloat(e.target.value) }))}
                  className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <span className="text-sm font-mono text-indigo-400 w-20 text-right">{form.min_profit_threshold.toFixed(4)}</span>
              </div>
            </div>

            {/* Max Position Size */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">Max Position Size (SOL)</label>
              <div className="flex items-center space-x-3">
                <input
                  type="range"
                  min="0.1"
                  max="50"
                  step="0.1"
                  value={form.max_position_size}
                  onChange={(e) => setForm(f => ({ ...f, max_position_size: parseFloat(e.target.value) }))}
                  className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <span className="text-sm font-mono text-indigo-400 w-20 text-right">{form.max_position_size.toFixed(1)}</span>
              </div>
            </div>

            {/* Daily Loss Limit */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">Daily Loss Limit (SOL)</label>
              <div className="flex items-center space-x-3">
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={form.daily_loss_limit}
                  onChange={(e) => setForm(f => ({ ...f, daily_loss_limit: parseFloat(e.target.value) }))}
                  className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <span className="text-sm font-mono text-indigo-400 w-20 text-right">{form.daily_loss_limit.toFixed(1)}</span>
              </div>
            </div>

            {/* Slippage Tolerance */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">Slippage Tolerance (bps)</label>
              <div className="flex items-center space-x-3">
                <input
                  type="range"
                  min="5"
                  max="200"
                  step="5"
                  value={form.slippage_bps}
                  onChange={(e) => setForm(f => ({ ...f, slippage_bps: parseInt(e.target.value) }))}
                  className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <span className="text-sm font-mono text-indigo-400 w-20 text-right">{form.slippage_bps} bps</span>
              </div>
            </div>

            {/* Max Concurrent Trades */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">Max Concurrent Trades</label>
              <select
                value={form.max_concurrent_trades}
                onChange={(e) => setForm(f => ({ ...f, max_concurrent_trades: parseInt(e.target.value) }))}
                className="bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 px-3 py-2 w-full"
              >
                {[1, 2, 3, 4, 5, 10].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            {/* Trade Cooldown */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">Trade Cooldown (seconds)</label>
              <select
                value={form.trade_cooldown_secs}
                onChange={(e) => setForm(f => ({ ...f, trade_cooldown_secs: parseInt(e.target.value) }))}
                className="bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 px-3 py-2 w-full"
              >
                {[10, 30, 60, 120, 300].map(n => (
                  <option key={n} value={n}>{n}s</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* DEX Selection */}
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Enabled DEXs</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {ALL_DEXES.map((dex) => {
              const enabled = form.enabled_dexes.includes(dex);
              return (
                <button
                  key={dex}
                  type="button"
                  onClick={() => toggleDex(dex)}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    enabled
                      ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                      : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:border-gray-600'
                  }`}
                >
                  <div className="text-xs font-medium capitalize mb-1">{dex}</div>
                  <div className={`text-xs ${enabled ? 'text-indigo-400' : 'text-gray-600'}`}>
                    {enabled ? '● Active' : '○ Disabled'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Error display */}
        {errors.settings && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-sm text-red-400">
            {errors.settings}
          </div>
        )}

        {/* Save button */}
        <div className="flex items-center justify-end space-x-3">
          {saved && <span className="text-sm text-green-400">Settings saved ✓</span>}
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
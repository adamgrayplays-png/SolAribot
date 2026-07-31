import { useEffect, useRef, useState, useCallback } from 'react';
import { realtimeClient, type WsMessage } from '../api/websocket';
import useDashboardStore from './useDashboardStore';

export function useRealtime() {
  const [connected, setConnected] = useState(false);
  const initialized = useRef(false);

  const {
    fetchBalance, fetchTrades, fetchOpportunities, fetchPositions,
    fetchDexLatency, fetchSystemMetrics, fetchPnlSummary, fetchSettings,
    setBalance, addOpportunity, addTrade, setDexLatency,
    setSystemMetrics, setPnlSummary,
  } = useDashboardStore();

  // Initial data fetch
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Fetch all data on mount
    fetchBalance();
    fetchTrades();
    fetchOpportunities();
    fetchPositions();
    fetchDexLatency();
    fetchSystemMetrics();
    fetchPnlSummary();
    fetchSettings();

    // Periodic polling for data that WebSocket may not push
    const pollInterval = setInterval(() => {
      fetchDexLatency();
      fetchSystemMetrics();
    }, 5000); // every 5s

    // Connect WebSocket
    realtimeClient.connect();

    return () => {
      clearInterval(pollInterval);
      realtimeClient.disconnect();
    };
  }, []);

  // WebSocket message handler
  useEffect(() => {
    const unsubscribe = realtimeClient.onMessage((msg: WsMessage) => {
      switch (msg.type) {
        case 'balance':
          setBalance(msg.data);
          break;
        case 'opportunity':
          addOpportunity(msg.data);
          break;
        case 'trade':
          addTrade(msg.data);
          break;
        case 'dex_latency':
          setDexLatency(msg.data);
          break;
        case 'system_metrics':
          setSystemMetrics(msg.data);
          break;
        case 'pnl_update':
          setPnlSummary(msg.data);
          break;
      }
    });

    // Check connection status periodically
    const connInterval = setInterval(() => {
      setConnected(realtimeClient.connected);
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(connInterval);
    };
  }, []);

  return { connected };
}
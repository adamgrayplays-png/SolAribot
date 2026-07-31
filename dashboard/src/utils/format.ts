export function formatSol(amount: number): string {
  if (amount >= 1) return amount.toFixed(3);
  if (amount >= 0.001) return amount.toFixed(6);
  return amount.toFixed(9);
}

export function formatProfit(amount: number): string {
  const prefix = amount >= 0 ? '+' : '';
  return `${prefix}${formatSol(amount)} SOL`;
}

export function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function shortenSignature(sig: string): string {
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 6)}...${sig.slice(-4)}`;
}

export function getExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'confirmed': return 'text-green-400';
    case 'pending': return 'text-yellow-400';
    case 'failed': return 'text-red-400';
    case 'submitted': return 'text-blue-400';
    default: return 'text-gray-400';
  }
}
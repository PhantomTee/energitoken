import { useCallback, useEffect, useState } from "react";
import { getTransactionHistory, TxRecord } from "../services/contractEvents";

export function useTransactionHistory(walletAddress: string | null) {
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const history = await getTransactionHistory(walletAddress);
      setTransactions(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load transaction history.");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { transactions, loading, error, refresh };
}

import { useEffect, useState } from "react";

import { errorMessage } from "@/lib/errors";

/**
 * 收敛列表/资源页通用的「请求 + loading + error + retry」骨架。
 * fetcher 在 effect 内的 async 续段里调用，所有 setState 都在 await 之后，
 * 满足 react-hooks/set-state-in-effect 规则。
 */
export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
): {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetcher();
        if (!cancelled) {
          setData(result);
        }
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e, "加载失败"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retryKey]);

  function retry() {
    setRetryKey((k) => k + 1);
  }

  return { data, loading, error, retry };
}

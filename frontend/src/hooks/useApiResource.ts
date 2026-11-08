import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../api/errors';

/**
 * Small loader hook behind every API-consuming view.
 *
 * It owns the three view states of RF-24 (`loading`, `error`, `data`) so each
 * screen renders `loading-indicator`, `error-banner` or `empty-state` from one
 * place. An `AbortSignal` is passed to the loader, so navigating away never
 * writes state on an unmounted component.
 */

export interface Resource<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

export function useApiResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(undefined);

    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (!active) {
          return;
        }
        setData(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setError(describeError(cause));
        setData(undefined);
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // The dependency list is provided by the caller on purpose.
  }, [...deps, nonce]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { data, error, loading, reload };
}

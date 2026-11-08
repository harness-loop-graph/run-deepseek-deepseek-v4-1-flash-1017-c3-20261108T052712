import { useSyncExternalStore } from 'react';
import { session, type SessionSnapshot } from './session';

/** Subscribes a component to the session store (React 19 `useSyncExternalStore`). */
export function useSession(): SessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}

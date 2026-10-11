import { createContext, useContext, useEffect, useId } from "react";
export const PendingWork = createContext<(id: string, pending: boolean) => void>(() => undefined);
export function usePendingWork(pending: boolean) {
  const id = useId();
  const report = useContext(PendingWork);
  useEffect(() => { report(id, pending); return () => report(id, false); }, [id, pending, report]);
}

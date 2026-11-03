import { useState, useSyncExternalStore } from "react";
import { ActivityHistory, SETTLED_HISTORY_LIMIT } from "./activity-history.js";
export function useActivityHistory(limit = SETTLED_HISTORY_LIMIT) {
  const [history] = useState(() => new ActivityHistory(limit));
  const snapshot = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  return { history, ...snapshot };
}

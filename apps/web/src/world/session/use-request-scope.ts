import { useLayoutEffect, useMemo } from "react";
import { RequestScope, type RequestEpoch } from "./request-scope.js";

export function useRequestScope(identity: string, gate: RequestEpoch, source?: object) {
  const owner = useMemo(() => ({ identity, source, scope: new RequestScope(gate) }), [identity, gate, source]);
  useLayoutEffect(() => {
    owner.scope.activate();
    return () => owner.scope.dispose();
  }, [owner]);
  return owner.scope;
}

import {
  lazy,
  Suspense
} from "react";

import type { ReactNode } from "react";
const CodexScreen = lazy(() => import("../codex/CodexScreen.js"));

export interface CodexPageProps {
  infoTabs: ReactNode;
}
export function CodexPage({ infoTabs }: CodexPageProps) {

  return (<div className="focused-screen focused-codex-screen" aria-label="Orraveth Codex">
    {infoTabs}
    <Suspense fallback={<p role="status">Loading the Codex…</p>}>
      <CodexScreen />
    </Suspense>
  </div>);
}

// FORK(smartlogs): the Smart Logs page — live bindings, the relocated request log, and the ordering
// per provider.
//
// **Read-only, as a constraint rather than an omission.** A second surface that can write a setting
// is a second surface that can silently overwrite the first, which already happened once in this
// fork between the two provider strategy controls. Changing anything stays on the settings surfaces.
//
// A server shell around client sections, matching console-log/page.js. `dynamic` is set for the same
// reason it is there: so the standalone build emits the server file for this route.

import ActiveSessionsSection from "./components/ActiveSessionsSection";
import RequestLogSection from "./components/RequestLogSection";
import SmartRoutingSection from "./components/SmartRoutingSection";

export const dynamic = "force-dynamic";

export default function SmartLogsPage() {
  return (
    <div className="flex min-w-0 flex-col gap-8 px-1 sm:px-0">
      <ActiveSessionsSection />
      <RequestLogSection />
      <SmartRoutingSection />
    </div>
  );
}

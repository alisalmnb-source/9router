// FORK(smartlogs): Smart Routing detail for one provider.
//
// Its own route rather than state on the Smart Logs page, so it can be linked, refreshed and opened
// in a second tab. The model choice stays client-side — it is a lens on the same provider.
//
// Server shell around a client component, with `dynamic` set so the standalone build emits the
// server file for this route.

import SmartRoutingDetail from "./SmartRoutingDetail";

export const dynamic = "force-dynamic";

export default async function SmartLogsProviderPage({ params }) {
  const { providerId } = await params;
  return <SmartRoutingDetail providerId={providerId} />;
}

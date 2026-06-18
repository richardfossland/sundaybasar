import { redirect } from 'next/navigation'

import { getHostUser } from '@/lib/server/host-auth'
import { listBasarsForOwner } from '@/lib/server/host-basars'
import { HostDashboard } from './HostDashboard'

// Signed-in host dashboard ("Mine basarer"). Middleware already redirects
// logged-OUT users to /host/login; this re-checks server-side (defense in
// depth) and loads the host's own basars. Anonymous hosting is unaffected —
// this surface is purely additive (the per-basar console at /host/<sessionId>
// and the wizard at /host/new stay code-based and anonymous).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function HostDashboardPage() {
  const user = await getHostUser()
  if (!user) redirect('/host/login')

  const basars = await listBasarsForOwner(user.id)
  return <HostDashboard email={user.email ?? ''} basars={basars} />
}

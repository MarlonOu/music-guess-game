'use client';

import { MatchSetupForm } from '../../components/match/MatchSetupForm';
import { PageShell } from '../../components/layout/PageShell';

export default function MatchSetupPage() {
  return (
    <PageShell title="建立比賽" subtitle="選一個玩法、挑好題庫，就可以開始。">
      <MatchSetupForm />
    </PageShell>
  );
}

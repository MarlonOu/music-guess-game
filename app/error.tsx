'use client';

import { StatusScreen, HomeLink } from '../components/layout/StatusScreen';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusScreen label="!" title="唱針跳針了" message="頁面發生預期外的錯誤。重試一次，或回到首頁。">
      <button type="button" onClick={reset} className="btn btn-primary">
        再試一次
      </button>
      <HomeLink />
    </StatusScreen>
  );
}

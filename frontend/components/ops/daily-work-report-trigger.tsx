'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { triggerDailyWorkReportWorkflowRefreshAction } from '@/app/actions';

type DailyWorkReportTriggerProps = {
  buttonLabel?: string;
};

export function DailyWorkReportTrigger({
  buttonLabel = '触发 AI 日报工作流',
}: DailyWorkReportTriggerProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    if (isPending) {
      return;
    }

    setNotice(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await triggerDailyWorkReportWorkflowRefreshAction();
        if (result.ok) {
          setNotice(result.message);
        } else {
          setError(result.message);
        }
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : '请求失败，请稍后重试。';
        setError(message);
      }
    });
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <button className="button button-primary" disabled={isPending} onClick={handleClick} type="button">
        {isPending ? '触发中...' : buttonLabel}
      </button>
      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}
    </div>
  );
}

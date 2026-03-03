'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function KnowledgeExtractionTrigger({
  action,
  extractionFinished,
  extractionRunning,
}: {
  action: () => Promise<{ ok: boolean; message: string }>;
  extractionFinished: boolean;
  extractionRunning: boolean;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const disabled = extractionFinished || extractionRunning || isPending;
  const label = extractionFinished
    ? '已锁定（不可重复触发）'
    : extractionRunning
      ? '提炼运行中...'
      : isPending
        ? '已提交，页面刷新中...'
        : '触发知识提炼';

  const handleClick = () => {
    if (disabled) {
      return;
    }

    setNotice(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
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
    <div style={{ marginTop: 12 }}>
      <div className="inline-form">
        <button className="button button-primary" disabled={disabled} onClick={handleClick} type="button">
          {label}
        </button>
        <Link className="button button-secondary" href="/knowledge">
          进入知识库
        </Link>
      </div>
      {notice ? <p className="notice" style={{ marginTop: 10 }}>{notice}</p> : null}
      {error ? <p className="notice notice-error" style={{ marginTop: 10 }}>{error}</p> : null}
    </div>
  );
}

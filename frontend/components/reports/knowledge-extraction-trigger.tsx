'use client';

import Link from 'next/link';
import { useFormStatus } from 'react-dom';

function SubmitButton({
  extractionFinished,
  extractionRunning,
}: {
  extractionFinished: boolean;
  extractionRunning: boolean;
}) {
  const { pending } = useFormStatus();

  const disabled = extractionFinished || extractionRunning || pending;
  const label = extractionFinished
    ? '已锁定（不可重复触发）'
    : extractionRunning
      ? '提炼运行中...'
      : pending
        ? '已提交，页面刷新中...'
        : '触发知识提炼';

  return (
    <button className="button button-primary" disabled={disabled} type="submit">
      {label}
    </button>
  );
}

export function KnowledgeExtractionTrigger({
  action,
  reportId,
  extractionFinished,
  extractionRunning,
}: {
  action: (formData: FormData) => void | Promise<void>;
  reportId: string;
  extractionFinished: boolean;
  extractionRunning: boolean;
}) {
  return (
    <form action={action} className="inline-form" style={{ marginTop: 12 }}>
      <input name="redirectTo" type="hidden" value={`/reports/${reportId}`} />
      <SubmitButton
        extractionFinished={extractionFinished}
        extractionRunning={extractionRunning}
      />
      <Link className="button button-secondary" href="/knowledge">
        进入知识库
      </Link>
    </form>
  );
}

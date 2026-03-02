'use client';

import { FormEvent, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type ReadByArxivIdResponse = {
  message?: string;
  workflow_id?: string | null;
};

function parseErrorMessage(payload: unknown, status: number, statusText: string): string {
  if (payload && typeof payload === 'object') {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
  }
  return `${status} ${statusText}`;
}

export function ReadByIdForm() {
  const router = useRouter();
  const [paperId, setPaperId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = paperId.trim();
    if (!normalized) {
      setErrorMessage('请输入 arXiv ID。');
      return;
    }

    setErrorMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/backend/read_papers/by_arxiv_id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paperId: normalized }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setErrorMessage(parseErrorMessage(payload, response.status, response.statusText));
          return;
        }

        const result = (payload || {}) as ReadByArxivIdResponse;
        const notice =
          typeof result.message === 'string' && result.message.trim()
            ? result.message.trim()
            : '已创建精读工作流。';

        const params = new URLSearchParams();
        params.set('notice', notice);
        if (result.workflow_id) {
          params.set('workflowId', result.workflow_id);
        }
        router.push(`/ops/workflows?${params.toString()}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : '请求失败，请稍后重试。';
        setErrorMessage(message);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10 }}>
      <input
        name="paperId"
        onChange={(event) => setPaperId(event.target.value)}
        placeholder="输入 arXiv ID，例如 2602.22766"
        required
        value={paperId}
      />
      {errorMessage ? <p className="notice notice-error">{errorMessage}</p> : null}
      <div>
        <button className="button button-primary" disabled={isPending} type="submit">
          {isPending ? '提交中...' : '生成精读报告'}
        </button>
      </div>
    </form>
  );
}

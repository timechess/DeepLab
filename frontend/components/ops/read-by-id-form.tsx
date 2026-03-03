'use client';

import { FormEvent, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type ReadByArxivIdResponse = {
  message?: string;
  workflow_id?: string | null;
  report_id?: string | null;
  requires_metadata?: boolean;
  resolved_pdf_url?: string | null;
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

function splitTextList(value: string): string[] {
  return value
    .split(/[\n,;，；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ReadByIdForm() {
  const router = useRouter();
  const [paperId, setPaperId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataHint, setMetadataHint] = useState<string | null>(null);
  const [pendingPaperInput, setPendingPaperInput] = useState<string | null>(null);
  const [pendingPdfUrl, setPendingPdfUrl] = useState<string | null>(null);
  const [showMetadataModal, setShowMetadataModal] = useState(false);

  const [metaTitle, setMetaTitle] = useState('');
  const [metaAuthors, setMetaAuthors] = useState('');
  const [metaSummary, setMetaSummary] = useState('');
  const [metaOrganization, setMetaOrganization] = useState('');
  const [metaPublishedAt, setMetaPublishedAt] = useState('');
  const [metaKeywords, setMetaKeywords] = useState('');

  const [isPending, startTransition] = useTransition();
  const [isMetadataPending, startMetadataTransition] = useTransition();

  const submitReadRequest = async (
    requestBody: Record<string, unknown>,
  ): Promise<ReadByArxivIdResponse> => {
    const response = await fetch('/api/backend/read_papers/by_arxiv_id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(parseErrorMessage(payload, response.status, response.statusText));
    }
    return (payload || {}) as ReadByArxivIdResponse;
  };

  const redirectAfterSubmitted = (result: ReadByArxivIdResponse) => {
    const notice =
      typeof result.message === 'string' && result.message.trim()
        ? result.message.trim()
        : '已创建精读工作流。';

    const params = new URLSearchParams();
    params.set('notice', notice);
    if (result.workflow_id) {
      params.set('workflowId', result.workflow_id);
    }
    if (result.report_id) {
      params.set('reportId', result.report_id);
    }
    router.push(`/ops/workflows?${params.toString()}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = paperId.trim();
    if (!normalized) {
      setErrorMessage('请输入 arXiv ID 或 PDF URL。');
      return;
    }

    setErrorMessage(null);
    setMetadataError(null);
    setMetadataHint(null);
    startTransition(async () => {
      try {
        const result = await submitReadRequest({ paperId: normalized });
        if (result.requires_metadata) {
          setPendingPaperInput(normalized);
          setPendingPdfUrl(
            typeof result.resolved_pdf_url === 'string' && result.resolved_pdf_url.trim()
              ? result.resolved_pdf_url.trim()
              : normalized,
          );
          setShowMetadataModal(true);
          setMetadataHint(
            typeof result.message === 'string' && result.message.trim()
              ? result.message.trim()
              : '请补充论文元信息后继续。',
          );
          return;
        }
        redirectAfterSubmitted(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : '请求失败，请稍后重试。';
        setErrorMessage(message);
      }
    });
  };

  const handleMetadataSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const paperInput = pendingPaperInput?.trim() || '';
    if (!paperInput) {
      setMetadataError('缺少原始论文输入，请关闭弹窗后重试。');
      return;
    }

    const title = metaTitle.trim();
    const summary = metaSummary.trim();
    const authors = splitTextList(metaAuthors);
    const keywords = splitTextList(metaKeywords);
    if (!title) {
      setMetadataError('请填写论文标题。');
      return;
    }
    if (!summary) {
      setMetadataError('请填写论文摘要。');
      return;
    }
    if (authors.length === 0) {
      setMetadataError('请至少填写一位作者。');
      return;
    }

    let publishedAtIso: string | undefined;
    if (metaPublishedAt.trim()) {
      const parsedDate = new Date(`${metaPublishedAt.trim()}T00:00:00Z`);
      if (Number.isNaN(parsedDate.getTime())) {
        setMetadataError('发表日期格式无效。');
        return;
      }
      publishedAtIso = parsedDate.toISOString();
    }

    setMetadataError(null);
    startMetadataTransition(async () => {
      try {
        const result = await submitReadRequest({
          paperId: paperInput,
          paperMetadata: {
            title,
            authors,
            summary,
            organization: metaOrganization.trim() || undefined,
            publishedAt: publishedAtIso,
            aiKeywords: keywords,
          },
        });

        if (result.requires_metadata) {
          setMetadataError('后端仍要求补充元信息，请检查输入后重试。');
          return;
        }

        setShowMetadataModal(false);
        redirectAfterSubmitted(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : '请求失败，请稍后重试。';
        setMetadataError(message);
      }
    });
  };

  return (
    <>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10 }}>
        <input
          name="paperId"
          onChange={(event) => setPaperId(event.target.value)}
          placeholder="输入 arXiv ID、arXiv PDF URL 或可下载 PDF URL"
          required
          value={paperId}
        />
        {errorMessage ? <p className="notice notice-error">{errorMessage}</p> : null}
        <div>
          <button className="button button-primary" disabled={isPending} type="submit">
            {isPending ? '已提交，正在创建任务...' : '生成精读报告'}
          </button>
        </div>
      </form>

      {showMetadataModal ? (
        <div
          aria-modal="true"
          role="dialog"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 120,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
            background: 'rgba(4, 10, 18, 0.72)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <section
            className="panel"
            style={{
              width: 'min(860px, 100%)',
              maxHeight: '88vh',
              overflow: 'auto',
              display: 'grid',
              gap: 12,
            }}
          >
            <header style={{ display: 'grid', gap: 8 }}>
              <p className="panel-kicker">补充元信息</p>
              <h3 className="panel-title" style={{ margin: 0 }}>
                确认 PDF 后继续生成精读报告
              </h3>
              {pendingPdfUrl ? (
                <p className="page-subtitle" style={{ margin: 0, wordBreak: 'break-all' }}>
                  PDF URL：{pendingPdfUrl}
                </p>
              ) : null}
              {metadataHint ? <p className="notice">{metadataHint}</p> : null}
            </header>

            <form onSubmit={handleMetadataSubmit} style={{ display: 'grid', gap: 10 }}>
              <input
                onChange={(event) => setMetaTitle(event.target.value)}
                placeholder="论文标题（必填）"
                required
                value={metaTitle}
              />
              <textarea
                onChange={(event) => setMetaAuthors(event.target.value)}
                placeholder="作者列表（必填，支持逗号或换行分隔）"
                required
                rows={3}
                value={metaAuthors}
              />
              <textarea
                onChange={(event) => setMetaSummary(event.target.value)}
                placeholder="论文摘要（必填）"
                required
                rows={6}
                value={metaSummary}
              />
              <input
                onChange={(event) => setMetaOrganization(event.target.value)}
                placeholder="机构（可选）"
                value={metaOrganization}
              />
              <div className="split-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input
                  onChange={(event) => setMetaPublishedAt(event.target.value)}
                  placeholder="发表日期（可选）"
                  type="date"
                  value={metaPublishedAt}
                />
                <input
                  onChange={(event) => setMetaKeywords(event.target.value)}
                  placeholder="关键词（可选，逗号分隔）"
                  value={metaKeywords}
                />
              </div>

              {metadataError ? <p className="notice notice-error">{metadataError}</p> : null}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="button button-secondary"
                  disabled={isMetadataPending}
                  onClick={() => setShowMetadataModal(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="button button-primary" disabled={isMetadataPending} type="submit">
                  {isMetadataPending ? '已提交，正在创建任务...' : '提交元信息并生成报告'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

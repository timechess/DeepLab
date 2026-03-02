import { notFound } from 'next/navigation';

import { CommentEditor } from '@/components/reports/comment-editor';
import { StatusBadge } from '@/components/ui/status-badge';
import { getReadingReport } from '@/lib/api/client';
import { MarkdownRenderer } from '@/lib/markdown/renderer';
import { formatDateTime } from '@/lib/time';

function decodeParam(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return decodeURIComponent(value);
}

function safeJoin(values: string[] | undefined): string {
  if (!values || values.length === 0) {
    return '--';
  }
  return values.join(' / ');
}

function toGitHubUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const raw = value.trim();
  if (!raw) {
    return null;
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (raw.startsWith('github.com/')) {
    return `https://${raw}`;
  }

  const normalized = raw.replace(/\.git$/i, '');
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    return `https://github.com/${normalized}`;
  }

  return null;
}

function extractArxivId(value: string): string | null {
  const raw = value.trim();
  if (!raw) {
    return null;
  }

  if (/^https?:\/\/(www\.)?arxiv\.org\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'abs' || parts[0] === 'pdf')) {
        return parts[1].replace(/\.pdf$/i, '');
      }
    } catch {
      return null;
    }
    return null;
  }

  const normalized = raw.replace(/^arxiv\s*:\s*/i, '');
  if (/^\d{4}\.\d{4,5}(v\d+)?$/i.test(normalized)) {
    return normalized;
  }
  if (/^[A-Za-z-]+(\.[A-Za-z-]+)?\/\d{7}(v\d+)?$/i.test(normalized)) {
    return normalized;
  }

  return null;
}

function toArxivUrl(primary: string | null | undefined, fallback: string): string | null {
  const candidates = [primary, fallback];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const id = extractArxivId(candidate);
    if (id) {
      return `https://arxiv.org/abs/${id}`;
    }
  }
  return null;
}

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  let report;
  try {
    report = await getReadingReport(id);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('404')) {
      notFound();
    }
    throw error;
  }

  const notice = decodeParam(query.notice);
  const error = decodeParam(query.error);
  const paperMeta = report.paperMeta;
  const hasAbstract = Boolean(paperMeta?.summary?.trim() || paperMeta?.aiSummary?.trim());
  const arxivUrl = toArxivUrl(paperMeta?.id, report.paperId);
  const githubUrl = toGitHubUrl(paperMeta?.githubRepo);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">报告详情</h2>
          <p className="page-subtitle">
            论文编号 {report.paperId} · 创建于 {formatDateTime(report.createdAt)}
          </p>
        </div>
        <StatusBadge status={report.status} />
      </header>

      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}

      <section className="panel">
        <p className="panel-kicker">论文信息</p>
        <h3 className="panel-title">{report.paperTitle || paperMeta?.title || '未命名论文'}</h3>
        <p className="page-subtitle" style={{ marginTop: 8 }}>
          最近更新：{formatDateTime(report.updatedAt)}
        </p>

        <div className="meta-kv-grid" style={{ marginTop: 12 }}>
          <div className="meta-kv">
            <span>论文编号</span>
            <strong>{report.paperId}</strong>
          </div>
          <div className="meta-kv">
            <span>发布</span>
            <strong>{paperMeta?.publishedAt ? formatDateTime(paperMeta.publishedAt) : '--'}</strong>
          </div>
          <div className="meta-kv">
            <span>机构</span>
            <strong>{paperMeta?.organization || '--'}</strong>
          </div>
          <div className="meta-kv">
            <span>点赞数</span>
            <strong>{paperMeta?.upvotes ?? '--'}</strong>
          </div>
          <div className="meta-kv">
            <span>ArXiv</span>
            <strong>
              {arxivUrl ? (
                <a className="code-link" href={arxivUrl} rel="noreferrer" target="_blank">
                  直达论文
                </a>
              ) : (
                '--'
              )}
            </strong>
          </div>
          <div className="meta-kv">
            <span>GitHub 仓库</span>
            <strong>
              {githubUrl ? (
                <a className="code-link" href={githubUrl} rel="noreferrer" target="_blank">
                  直达仓库
                </a>
              ) : (
                paperMeta?.githubRepo || '--'
              )}
            </strong>
          </div>
          <div className="meta-kv">
            <span>GitHub 星标</span>
            <strong>{paperMeta?.githubStars ?? '--'}</strong>
          </div>
        </div>

        <p className="page-subtitle" style={{ marginTop: 12 }}>
          作者：{safeJoin(paperMeta?.authors)}
        </p>

        {(paperMeta?.aiKeywords?.length ?? 0) > 0 ? (
          <div className="meta-chip-list" style={{ marginTop: 10 }}>
            {paperMeta?.aiKeywords.map((keyword) => (
              <span className="meta-chip meta-chip-outline" key={keyword}>
                {keyword}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {hasAbstract ? (
        <section className="panel">
          <h3 className="panel-title">论文摘要</h3>

          {paperMeta?.summary ? (
            <article className="summary-block" style={{ marginTop: 12 }}>
              <h4>原始摘要</h4>
              <p>{paperMeta.summary}</p>
            </article>
          ) : null}

          {paperMeta?.aiSummary ? (
            <article className="summary-block" style={{ marginTop: 12 }}>
              <h4>智能摘要</h4>
              <p>{paperMeta.aiSummary}</p>
            </article>
          ) : null}
        </section>
      ) : null}

      <section className="panel details-block">
        <p className="panel-kicker">第一阶段</p>
        <h3 className="panel-title">问题驱动阅读草稿</h3>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>展开第一阶段内容</summary>
          <p className="page-subtitle" style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>
            {report.stage1Content || '暂无第一阶段内容。'}
          </p>
        </details>
      </section>

      <CommentEditor
        defaultValue={report.comment}
        redirectTo={`/reports/${report.id}`}
        reportId={report.id}
      />

      <section className="panel">
        <p className="panel-kicker">第二阶段报告</p>
        <h2 className="panel-title">报告正文</h2>
        <div style={{ marginTop: 14 }}>
          <MarkdownRenderer content={report.stage2Content} />
        </div>
      </section>
    </section>
  );
}

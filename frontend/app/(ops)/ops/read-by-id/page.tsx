import Link from 'next/link';

import { ReadByIdForm } from '@/components/ops/read-by-id-form';
import { decodeQueryParam } from '@/lib/query';

export default async function ReadByArxivIdPage({
  searchParams,
}: {
  searchParams: Promise<{
    notice?: string;
    error?: string;
    reportId?: string;
    workflowId?: string;
  }>;
}) {
  const query = await searchParams;
  const reportId = query.reportId?.trim() || '';
  const workflowId = query.workflowId?.trim() || '';

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">运营后台 · 按编号精读</h2>
          <p className="page-subtitle">
            输入 arXiv ID、arXiv PDF URL，或可直接下载的 PDF URL 生成精读报告。
          </p>
        </div>
      </header>

      {query.notice ? <p className="notice">{decodeQueryParam(query.notice)}</p> : null}
      {query.error ? <p className="notice notice-error">{decodeQueryParam(query.error)}</p> : null}

      <section className="panel">
        <p className="panel-kicker">手动触发</p>
        <h3 className="panel-title" style={{ marginBottom: 12 }}>
          指定论文生成精读报告
        </h3>
        <ReadByIdForm />
      </section>

      <section className="panel" style={{ display: 'grid', gap: 8 }}>
        <p className="panel-kicker">快捷跳转</p>
        {reportId ? (
          <Link className="button button-secondary" href={`/reports/${reportId}`}>
            查看最新报告
          </Link>
        ) : (
          <p className="page-subtitle">本次尚未返回报告编号。</p>
        )}
        {workflowId ? (
          <Link className="button button-secondary" href={`/ops/workflows/${workflowId}`}>
            查看对应工作流
          </Link>
        ) : null}
      </section>
    </section>
  );
}

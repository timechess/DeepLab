import Link from 'next/link';
import { notFound } from 'next/navigation';

import { deleteKnowledgeQuestionAction, updateKnowledgeQuestionAction } from '@/app/actions';
import { getKnowledgeQuestion } from '@/lib/api/client';
import { formatDateTime } from '@/lib/time';

function decodeParam(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return decodeURIComponent(value);
}

function toArxivUrl(paperId: string): string | null {
  const value = paperId.trim();
  if (!value) {
    return null;
  }
  return `https://arxiv.org/abs/${value}`;
}

export default async function KnowledgeQuestionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const notice = decodeParam(query.notice);
  const error = decodeParam(query.error);

  let question;
  try {
    question = await getKnowledgeQuestion(id);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('404')) {
      notFound();
    }
    throw error;
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">知识问题详情</h2>
          <p className="page-subtitle">问题编号 {question.id}</p>
        </div>
        <Link className="button button-secondary" href="/knowledge">
          返回问题列表
        </Link>
      </header>

      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}

      <section className="panel">
        <p className="panel-kicker">问题描述</p>
        <h3 className="panel-title" style={{ marginBottom: 10 }}>
          {question.question}
        </h3>
        <p className="page-subtitle">
          创建来源：{question.createdBy} · 创建于 {formatDateTime(question.createdAt)} · 最近更新于{' '}
          {formatDateTime(question.updatedAt)}
        </p>

        <form
          action={updateKnowledgeQuestionAction.bind(null, question.id)}
          className="inline-form"
          style={{ marginTop: 12 }}
        >
          <input name="redirectTo" type="hidden" value={`/knowledge/${question.id}`} />
          <input defaultValue={question.question} name="question" />
          <button className="button button-secondary" type="submit">
            保存问题修改
          </button>
        </form>

        <form
          action={deleteKnowledgeQuestionAction.bind(null, question.id)}
          className="inline-form"
          style={{ marginTop: 10 }}
        >
          <input name="redirectTo" type="hidden" value="/knowledge" />
          <button className="button button-danger" type="submit">
            删除问题（含全部方案）
          </button>
        </form>
      </section>

      <section className="panel">
        <p className="panel-kicker">关联方案</p>
        <h3 className="panel-title">方案列表（{question.solutions.length}）</h3>
        <ul className="panel-list" style={{ marginTop: 12 }}>
          {question.solutions.length > 0 ? (
            question.solutions.map((solution) => {
              const arxivUrl = toArxivUrl(solution.paperId);
              return (
                <li className="panel-list-item" key={solution.id}>
                  <div className="report-card-head">
                    <p className="mono-id">paper: {solution.paperId}</p>
                    <p className="page-subtitle">更新于 {formatDateTime(solution.updatedAt)}</p>
                  </div>
                  <h4 className="panel-title" style={{ fontSize: 20, marginTop: 6 }}>
                    {solution.paperTitle || '未命名论文'}
                  </h4>

                  <div className="summary-block" style={{ marginTop: 10 }}>
                    <h4>方法简述</h4>
                    <p>{solution.methodSummary}</p>
                  </div>
                  <div className="summary-block" style={{ marginTop: 10 }}>
                    <h4>效果总结</h4>
                    <p>{solution.effectSummary}</p>
                  </div>
                  <div className="summary-block" style={{ marginTop: 10 }}>
                    <h4>局限性</h4>
                    <p>{solution.limitations}</p>
                  </div>

                  <div className="toolbar" style={{ marginTop: 12 }}>
                    {solution.reportId ? (
                      <Link className="button button-secondary" href={`/reports/${solution.reportId}`}>
                        查看精读报告
                      </Link>
                    ) : null}
                    {arxivUrl ? (
                      <a className="button button-secondary" href={arxivUrl} rel="noreferrer" target="_blank">
                        查看文献
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })
          ) : (
            <li className="panel-list-item">
              <p className="page-subtitle">当前问题暂无方案。</p>
            </li>
          )}
        </ul>
      </section>
    </section>
  );
}

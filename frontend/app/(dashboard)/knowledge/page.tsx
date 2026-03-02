import Link from 'next/link';

import { createKnowledgeQuestionAction } from '@/app/actions';
import { KnowledgeQuestionsList } from '@/components/knowledge/questions-list';
import { getKnowledgeQuestions } from '@/lib/api/client';

function decodeParam(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return decodeURIComponent(value);
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; notice?: string; error?: string; questionId?: string }>;
}) {
  const params = await searchParams;
  const keyword = (params.q || '').trim();
  const questions = await getKnowledgeQuestions({
    search: keyword || undefined,
    limit: 200,
  });

  const notice = decodeParam(params.notice);
  const error = decodeParam(params.error);
  const questionId = params.questionId?.trim();
  const redirectTo = keyword ? `/knowledge?q=${encodeURIComponent(keyword)}` : '/knowledge';

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">知识库</h2>
          <p className="page-subtitle">以问题为核心，聚合方案与文献链接。</p>
        </div>
      </header>

      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}

      {questionId ? (
        <p className="notice">
          最新定位问题：
          <Link className="code-link" href={`/knowledge/${questionId}`}>
            {questionId}
          </Link>
        </p>
      ) : null}

      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <p className="panel-kicker">手动新增问题</p>
        <h3 className="panel-title">用户创建问题</h3>
        <form action={createKnowledgeQuestionAction} className="inline-form">
          <input name="redirectTo" type="hidden" value="/knowledge" />
          <input
            name="question"
            placeholder="输入一个高层研究问题，例如：如何在长上下文任务中稳定压缩推理开销？"
            style={{ minWidth: 420 }}
          />
          <button className="button button-primary" type="submit">
            创建问题
          </button>
        </form>
      </section>

      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <p className="panel-kicker">问题检索</p>
        <h3 className="panel-title">问题列表（{questions.length}）</h3>
        <form className="inline-form" method="get">
          <input defaultValue={keyword} name="q" placeholder="按问题关键词搜索" />
          <button className="button button-secondary" type="submit">
            查询
          </button>
          <Link className="button button-secondary" href="/knowledge">
            重置
          </Link>
        </form>

        {questions.length > 0 ? (
          <KnowledgeQuestionsList questions={questions} redirectTo={redirectTo} />
        ) : (
          <ul className="panel-list">
            <li className="panel-list-item">
              <p className="page-subtitle">暂无问题记录。</p>
            </li>
          </ul>
        )}
      </section>
    </section>
  );
}

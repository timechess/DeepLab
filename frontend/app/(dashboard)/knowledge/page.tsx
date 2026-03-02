import Link from 'next/link';

import { createKnowledgeQuestionAction } from '@/app/actions';
import { KnowledgeNotesList } from '@/components/knowledge/notes-list';
import { KnowledgeQuestionsList } from '@/components/knowledge/questions-list';
import { getKnowledgeNotes, getKnowledgeQuestions } from '@/lib/api/client';

function decodeParam(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return decodeURIComponent(value);
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    view?: string;
    notice?: string;
    error?: string;
    questionId?: string;
  }>;
}) {
  const params = await searchParams;
  const keyword = (params.q || '').trim();
  const view = params.view === 'notes' ? 'notes' : 'questions';

  const [questions, notes] = await Promise.all([
    view === 'questions'
      ? getKnowledgeQuestions({ search: keyword || undefined, limit: 200 })
      : Promise.resolve([]),
    view === 'notes'
      ? getKnowledgeNotes({ search: keyword || undefined, limit: 200 })
      : Promise.resolve([]),
  ]);

  const notice = decodeParam(params.notice);
  const error = decodeParam(params.error);
  const questionId = params.questionId?.trim();
  const questionRedirectTo = keyword
    ? `/knowledge?view=questions&q=${encodeURIComponent(keyword)}`
    : '/knowledge?view=questions';

  const questionsTabHref = keyword
    ? `/knowledge?view=questions&q=${encodeURIComponent(keyword)}`
    : '/knowledge?view=questions';
  const notesTabHref = keyword
    ? `/knowledge?view=notes&q=${encodeURIComponent(keyword)}`
    : '/knowledge?view=notes';

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">知识库</h2>
          <p className="page-subtitle">问题与双链笔记统一管理。</p>
        </div>
      </header>

      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}

      {questionId && view === 'questions' ? (
        <p className="notice">
          最新定位问题：
          <Link className="code-link" href={`/knowledge/${questionId}`}>
            {questionId}
          </Link>
        </p>
      ) : null}

      <section className="knowledge-view-tabs">
        <Link
          className={`knowledge-view-tab${view === 'questions' ? ' knowledge-view-tab-active' : ''}`}
          href={questionsTabHref}
        >
          问题视图
        </Link>
        <Link
          className={`knowledge-view-tab${view === 'notes' ? ' knowledge-view-tab-active' : ''}`}
          href={notesTabHref}
        >
          笔记视图
        </Link>
      </section>

      {view === 'questions' ? (
        <>
          <section className="panel" style={{ display: 'grid', gap: 12 }}>
            <p className="panel-kicker">手动新增问题</p>
            <h3 className="panel-title">用户创建问题</h3>
            <form action={createKnowledgeQuestionAction} className="inline-form">
              <input name="redirectTo" type="hidden" value={questionRedirectTo} />
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
              <input name="view" type="hidden" value="questions" />
              <input defaultValue={keyword} name="q" placeholder="按问题关键词搜索" />
              <button className="button button-secondary" type="submit">
                查询
              </button>
              <Link className="button button-secondary" href="/knowledge?view=questions">
                重置
              </Link>
            </form>

            {questions.length > 0 ? (
              <KnowledgeQuestionsList questions={questions} redirectTo={questionRedirectTo} />
            ) : (
              <ul className="panel-list">
                <li className="panel-list-item">
                  <p className="page-subtitle">暂无问题记录。</p>
                </li>
              </ul>
            )}
          </section>
        </>
      ) : null}

      {view === 'notes' ? (
        <section className="panel" style={{ display: 'grid', gap: 14 }}>
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <div>
              <p className="panel-kicker">双链笔记</p>
              <h3 className="panel-title">笔记列表（{notes.length}）</h3>
            </div>
            <Link className="button button-primary" href="/knowledge/notes/new">
              新建笔记
            </Link>
          </div>

          <form className="inline-form" method="get">
            <input name="view" type="hidden" value="notes" />
            <input defaultValue={keyword} name="q" placeholder="按标题或正文搜索笔记" />
            <button className="button button-secondary" type="submit">
              查询
            </button>
            <Link className="button button-secondary" href="/knowledge?view=notes">
              重置
            </Link>
          </form>

          {notes.length > 0 ? (
            <KnowledgeNotesList notes={notes} />
          ) : (
            <ul className="panel-list">
              <li className="panel-list-item">
                <p className="page-subtitle">暂无笔记，点击“新建笔记”开始记录。</p>
              </li>
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}

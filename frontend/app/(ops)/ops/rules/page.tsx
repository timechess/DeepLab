import {
  createScreeningRuleAction,
  deleteScreeningRuleAction,
  updateScreeningRuleAction,
} from '@/app/actions';
import { getScreeningRules } from '@/lib/api/client';
import { formatDateTime } from '@/lib/time';

function decodeParam(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return decodeURIComponent(value);
}

function formatCreator(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'user') {
    return '用户';
  }
  if (normalized === 'ai') {
    return '智能体';
  }
  return value || '--';
}

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const query = await searchParams;
  const rules = await getScreeningRules();

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">运营后台 · 初筛规则</h2>
          <p className="page-subtitle">管理初筛规则，支持新增、编辑和删除。</p>
        </div>
      </header>

      {query.notice ? <p className="notice">{decodeParam(query.notice)}</p> : null}
      {query.error ? <p className="notice notice-error">{decodeParam(query.error)}</p> : null}

      <section className="panel">
        <p className="panel-kicker">创建规则</p>
        <h3 className="panel-title" style={{ marginBottom: 12 }}>
          新增规则
        </h3>
        <form action={createScreeningRuleAction} style={{ display: 'grid', gap: 10 }}>
          <input name="redirectTo" type="hidden" value="/ops/rules" />
          <textarea name="rule" placeholder="输入新的筛选规则" required />
          <div>
            <button className="button button-primary" type="submit">
              创建规则
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <p className="panel-kicker">规则列表</p>
        <h3 className="panel-title" style={{ marginBottom: 12 }}>
          规则列表（{rules.length}）
        </h3>

        <div style={{ display: 'grid', gap: 12 }}>
          {rules.map((rule) => {
            const updateAction = updateScreeningRuleAction.bind(null, rule.id);
            const deleteAction = deleteScreeningRuleAction.bind(null, rule.id);

            return (
              <article className="panel-list-item" key={rule.id}>
                <p className="panel-kicker">规则 #{rule.id}</p>
                <p className="page-subtitle" style={{ marginBottom: 8 }}>
                  创建者：{formatCreator(rule.createdBy)} · 创建时间：{formatDateTime(rule.createdAt)}
                </p>

                <form action={updateAction} style={{ display: 'grid', gap: 8 }}>
                  <input name="redirectTo" type="hidden" value="/ops/rules" />
                  <input defaultValue={rule.createdBy} name="createdBy" required />
                  <textarea defaultValue={rule.rule} name="rule" required />
                  <div className="toolbar">
                    <button className="button button-secondary" type="submit">
                      保存修改
                    </button>
                  </div>
                </form>

                <form action={deleteAction} style={{ marginTop: 8 }}>
                  <input name="redirectTo" type="hidden" value="/ops/rules" />
                  <button className="button button-danger" type="submit">
                    删除规则
                  </button>
                </form>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

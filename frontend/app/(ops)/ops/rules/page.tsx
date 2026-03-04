import {
  createScreeningRuleAction,
} from '@/app/actions';
import { RulesList } from '@/components/ops/rules-list';
import { getScreeningRules } from '@/lib/api/client';
import { decodeQueryParam } from '@/lib/query';

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
          <h2 className="page-title">初筛规则</h2>
        </div>
      </header>

      {query.notice ? <p className="notice">{decodeQueryParam(query.notice)}</p> : null}
      {query.error ? <p className="notice notice-error">{decodeQueryParam(query.error)}</p> : null}

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

        <RulesList rules={rules} />
      </section>
    </section>
  );
}

'use client';

import { useState } from 'react';

import {
  deleteScreeningRuleAction,
  updateScreeningRuleAction,
} from '@/app/actions';
import type { ScreeningRule } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/time';

function formatCreator(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'user') {
    return '用户规则';
  }
  if (normalized === 'ai') {
    return '智能体规则';
  }
  return value || '未知来源';
}

export function RulesList({ rules }: { rules: ScreeningRule[] }) {
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);

  return (
    <div className="rules-grid">
      {rules.map((rule) => {
        const updateAction = updateScreeningRuleAction.bind(null, rule.id);
        const deleteAction = deleteScreeningRuleAction.bind(null, rule.id);
        const isEditing = editingRuleId === rule.id;

        return (
          <article
            className={`panel-list-item rule-item${isEditing ? ' rule-item-editing' : ''}`}
            key={rule.id}
          >
            <div className="rule-head">
              <p className="panel-kicker" style={{ margin: 0 }}>
                规则 #{rule.id}
              </p>
              <div className="meta-chip-list">
                <span className="meta-chip meta-chip-outline">{formatCreator(rule.createdBy)}</span>
              </div>
            </div>

            <p className="rule-content">{rule.rule}</p>

            <div className="rule-footer">
              <p className="mono-id rule-time">创建时间：{formatDateTime(rule.createdAt)}</p>
              <div className="rule-actions">
                {!isEditing ? (
                  <button
                    className="button button-secondary rule-action-btn"
                    onClick={() => setEditingRuleId(rule.id)}
                    type="button"
                  >
                    修改
                  </button>
                ) : null}

                <form action={deleteAction} className="rule-inline-form">
                  <input name="redirectTo" type="hidden" value="/ops/rules" />
                  <button className="button button-danger rule-action-btn" type="submit">
                    删除
                  </button>
                </form>
              </div>
            </div>

            {isEditing ? (
              <form action={updateAction} className="rule-edit-form">
                <input name="redirectTo" type="hidden" value="/ops/rules" />
                <input name="createdBy" type="hidden" value={rule.createdBy} />
                <textarea
                  className="rule-edit-textarea"
                  defaultValue={rule.rule}
                  name="rule"
                  required
                />
                <p className="rule-edit-help">只更新规则内容，规则来源不变。</p>
                <div className="rule-edit-actions">
                  <button className="button button-primary rule-action-btn" type="submit">
                    保存修改
                  </button>
                  <button
                    className="button button-secondary rule-action-btn"
                    onClick={() => setEditingRuleId(null)}
                    type="button"
                  >
                    取消
                  </button>
                </div>
              </form>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

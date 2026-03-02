'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  deleteKnowledgeQuestionAction,
  updateKnowledgeQuestionAction,
} from '@/app/actions';
import type { KnowledgeQuestionSummary } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/time';

export function KnowledgeQuestionsList({
  questions,
  redirectTo,
}: {
  questions: KnowledgeQuestionSummary[];
  redirectTo: string;
}) {
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  return (
    <div className="rules-grid">
      {questions.map((item) => {
        const isEditing = editingQuestionId === item.id;
        const updateAction = updateKnowledgeQuestionAction.bind(null, item.id);
        const deleteAction = deleteKnowledgeQuestionAction.bind(null, item.id);

        return (
          <article
            className={`panel-list-item rule-item${isEditing ? ' rule-item-editing' : ''}`}
            key={item.id}
          >
            <div className="rule-head">
              <p className="mono-id" style={{ margin: 0 }}>
                {item.id}
              </p>
              <div className="meta-chip-list">
                <span className="meta-chip meta-chip-outline">方案数 {item.solutionCount}</span>
              </div>
            </div>

            <p className="rule-content">{item.question}</p>

            <div className="rule-footer">
              <p className="mono-id rule-time">更新于 {formatDateTime(item.updatedAt)}</p>
              <div className="rule-actions">
                {!isEditing ? (
                  <button
                    className="button button-secondary rule-action-btn"
                    onClick={() => setEditingQuestionId(item.id)}
                    type="button"
                  >
                    修改
                  </button>
                ) : null}
                <Link className="button button-secondary rule-action-btn" href={`/knowledge/${item.id}`}>
                  详情
                </Link>
                <form action={deleteAction} className="rule-inline-form">
                  <input name="redirectTo" type="hidden" value={redirectTo} />
                  <button className="button button-danger rule-action-btn" type="submit">
                    删除
                  </button>
                </form>
              </div>
            </div>

            {isEditing ? (
              <form action={updateAction} className="rule-edit-form">
                <input name="redirectTo" type="hidden" value={redirectTo} />
                <textarea
                  className="rule-edit-textarea"
                  defaultValue={item.question}
                  name="question"
                  required
                />
                <p className="rule-edit-help">保存后会更新问题文本并重算 embedding。</p>
                <div className="rule-edit-actions">
                  <button className="button button-primary rule-action-btn" type="submit">
                    保存修改
                  </button>
                  <button
                    className="button button-secondary rule-action-btn"
                    onClick={() => setEditingQuestionId(null)}
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


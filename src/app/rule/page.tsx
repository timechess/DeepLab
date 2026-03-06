"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createRule,
  deleteRule,
  getRules,
  type RuleItem,
  updateRule,
} from "@/lib/rules";

export default function RulePage() {
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newContent, setNewContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await getRules();
      setRules(items);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const handleCreate = useCallback(async () => {
    const content = newContent.trim();
    if (!content) {
      return;
    }
    setSaving(true);
    try {
      await createRule({ content });
      setNewContent("");
      await loadRules();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : String(createError),
      );
    } finally {
      setSaving(false);
    }
  }, [newContent, loadRules]);

  const handleUpdate = useCallback(async () => {
    if (editingId === null) {
      return;
    }
    const content = editingContent.trim();
    if (!content) {
      return;
    }
    setSaving(true);
    try {
      await updateRule(editingId, { content });
      setEditingId(null);
      setEditingContent("");
      await loadRules();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : String(updateError),
      );
    } finally {
      setSaving(false);
    }
  }, [editingId, editingContent, loadRules]);

  const handleDelete = useCallback(
    async (id: number) => {
      setSaving(true);
      try {
        await deleteRule(id);
        if (editingId === id) {
          setEditingId(null);
          setEditingContent("");
        }
        await loadRules();
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
        );
      } finally {
        setSaving(false);
      }
    },
    [editingId, loadRules],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
          DeepLab / Rule
        </p>
        <h1 className="mt-3 font-serif text-5xl leading-[0.95] font-semibold text-[#e5ecff]">
          筛选规则管理
        </h1>
        <p className="mt-2 text-sm text-[#9fb0d0]">
          在这里维护论文初筛规则。新增、编辑、删除会立即影响下一次工作流执行。
        </p>
      </header>

      <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
        <div className="flex flex-col gap-3 md:flex-row">
          <textarea
            rows={3}
            placeholder="输入一条筛选规则，例如：优先保留有完整开源代码与实验复现实验的论文。"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            className="w-full rounded-2xl border border-[#2a3850] bg-[#0c1320] px-4 py-3 text-sm text-[#dbe6ff] outline-none focus:border-[#4f7dff]"
          />
          <button
            type="button"
            disabled={saving}
            onClick={handleCreate}
            className="min-w-[104px] cursor-pointer whitespace-nowrap rounded-2xl bg-[#4f7dff] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            新增规则
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-[#9fb0d0]">正在加载规则...</p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-[#ff8ca8]">{error}</p> : null}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-sm text-[#dbe6ff]">
            <thead>
              <tr className="border-b border-[#26344d] text-[#9fb0d0]">
                <th className="px-3 py-3 font-semibold">ID</th>
                <th className="px-3 py-3 font-semibold">内容</th>
                <th className="px-3 py-3 font-semibold">创建时间</th>
                <th className="px-3 py-3 font-semibold">更新时间</th>
                <th className="px-3 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const editing = editingId === rule.id;
                return (
                  <tr key={rule.id} className="border-b border-[#1f2a3d]">
                    <td className="px-3 py-3">{rule.id}</td>
                    <td className="px-3 py-3">
                      {editing ? (
                        <textarea
                          rows={3}
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="w-full rounded-xl border border-[#2a3850] bg-[#0c1320] px-3 py-2 text-sm text-[#dbe6ff] outline-none focus:border-[#4f7dff]"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{rule.content}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-[#9fb0d0]">
                      {rule.createdAt}
                    </td>
                    <td className="px-3 py-3 text-xs text-[#9fb0d0]">
                      {rule.updatedAt}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={handleUpdate}
                              disabled={saving}
                              className="cursor-pointer rounded-full border border-[#4f7dff] px-3 py-1 text-xs text-[#cfe0ff]"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null);
                                setEditingContent("");
                              }}
                              className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-1 text-xs text-[#c7d5ef]"
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(rule.id);
                              setEditingContent(rule.content);
                            }}
                            className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-1 text-xs text-[#c7d5ef]"
                          >
                            编辑
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDelete(rule.id)}
                          disabled={saving}
                          className="cursor-pointer rounded-full border border-[#ff6f91] px-3 py-1 text-xs text-[#ff9fba] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

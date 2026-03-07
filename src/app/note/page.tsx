"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  createNoteItem,
  deleteNoteItem,
  getNoteHistory,
  type NoteListItem,
  type NoteHistoryResponse,
} from "@/lib/note";

export default function NotePage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NoteHistoryResponse | null>(null);
  const [pendingDeleteNote, setPendingDeleteNote] =
    useState<NoteListItem | null>(null);

  const totalPages = useMemo(() => {
    if (!data || data.pageSize <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getNoteHistory(page, query);
      setData(response);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await createNoteItem();
      window.location.href = `/note/detail?noteId=${created.id}`;
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : String(createError),
      );
      setSaving(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: number) => {
      setSaving(true);
      setError(null);
      try {
        await deleteNoteItem(id);
        await load();
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
    [load],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-8 rounded-3xl border border-[#1f2a3d] bg-[linear-gradient(140deg,rgba(15,23,36,0.96),rgba(11,20,34,0.96))] p-6 shadow-[0_18px_48px_rgba(0,0,0,0.38)]">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
          DeepLab / Note
        </p>
        <h1 className="mt-3 font-serif text-5xl leading-[0.95] font-semibold text-[#e5ecff]">
          双链笔记
        </h1>
        <p className="mt-2 text-sm text-[#9fb0d0]">
          管理笔记并进入编辑器进行结构化链接与关联阅读。
        </p>
      </header>

      <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1 text-sm text-[#c7d5ef]">
            按标题搜索
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="输入笔记标题关键字"
              className="mt-2 w-full rounded-xl border border-[#1f2a3d] px-3 py-3 text-sm outline-none transition-colors duration-200 focus:border-[#4f7dff] focus-visible:ring-2 focus-visible:ring-[#4f7dff]/40"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving}
            className="cursor-pointer rounded-2xl bg-[#4f7dff] px-5 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#5f8bff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "处理中..." : "新建笔记"}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
        {loading ? (
          <p className="text-sm text-[#8ba2c7]">正在加载笔记...</p>
        ) : null}
        {error ? <p className="mb-3 text-sm text-[#ff9fba]">{error}</p> : null}

        {!loading && (data?.items.length ?? 0) === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#2d3a52] bg-[#101a2c] p-6 text-center text-sm text-[#9fb0d0]">
            暂无笔记。
          </div>
        ) : null}

        {!loading && (data?.items.length ?? 0) > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#26344d] text-[#9fb0d0]">
                  <th className="px-3 py-3 font-semibold">标题</th>
                  <th className="px-3 py-3 font-semibold">创建时间</th>
                  <th className="px-3 py-3 font-semibold">更新时间</th>
                  <th className="px-3 py-3 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-[#1f2a3d] text-[#dbe6ff] transition-colors hover:bg-[#101a2c]"
                  >
                    <td className="px-3 py-3">{item.title}</td>
                    <td className="px-3 py-3">{item.createdAt}</td>
                    <td className="px-3 py-3">{item.updatedAt}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/note/detail?noteId=${item.id}`}
                          className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-1 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
                        >
                          编辑
                        </Link>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteNote(item)}
                          className="cursor-pointer rounded-full border border-[#6e2a45] px-3 py-1 text-xs font-semibold text-[#ffb2cc] transition-colors duration-200 hover:bg-[#2a1020]"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-[#8ba2c7]">
            第 {data?.page ?? page} / {totalPages} 页，共 {data?.total ?? 0} 条
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-1 text-xs text-[#c7d5ef] transition-colors hover:border-[#4f7dff] hover:bg-[#142033] disabled:cursor-not-allowed disabled:opacity-40"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-1 text-xs text-[#c7d5ef] transition-colors hover:border-[#4f7dff] hover:bg-[#142033] disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={pendingDeleteNote !== null}
        title="确认删除笔记"
        description={`删除后将无法恢复：${pendingDeleteNote?.title ?? ""}`}
        confirmText="删除笔记"
        loading={saving}
        onCancel={() => setPendingDeleteNote(null)}
        onConfirm={() => {
          if (!pendingDeleteNote) {
            return;
          }
          void handleDelete(pendingDeleteNote.id);
          setPendingDeleteNote(null);
        }}
      />
    </main>
  );
}

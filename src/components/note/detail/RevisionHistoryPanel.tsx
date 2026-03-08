import type { NoteRevisionListItem } from "@/lib/note";

interface RevisionHistoryPanelProps {
  visible: boolean;
  loading: boolean;
  error: string | null;
  revisions: NoteRevisionListItem[];
  previewingRevisionId: number | null;
  restoringRevisionId: number | null;
  onRefresh: () => void;
  onClose: () => void;
  onPreviewRevision: (revisionId: number) => void;
  onRestoreRevision: (revisionId: number) => void;
}

export function RevisionHistoryPanel({
  visible,
  loading,
  error,
  revisions,
  previewingRevisionId,
  restoringRevisionId,
  onRefresh,
  onClose,
  onPreviewRevision,
  onRestoreRevision,
}: RevisionHistoryPanelProps) {
  if (!visible) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-[#243651] bg-[#0f1724] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#dbe6ff]">历史版本</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-full border border-[#3a4f77] px-3 py-1 text-xs font-semibold text-[#dbe6ff] hover:border-[#4f7dff]"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#3a4f77] px-3 py-1 text-xs font-semibold text-[#dbe6ff] hover:border-[#4f7dff]"
          >
            收起
          </button>
        </div>
      </div>
      {loading ? (
        <p className="text-xs text-[#8ba2c7]">正在加载历史版本...</p>
      ) : null}
      {error ? <p className="text-xs text-[#ff9fba]">{error}</p> : null}
      {!loading && revisions.length === 0 ? (
        <p className="text-xs text-[#8ba2c7]">暂无历史记录。</p>
      ) : null}
      <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
        {revisions.map((item) => (
          <div
            key={item.revisionId}
            className="rounded-xl border border-[#2b3c5d] bg-[#111c2f] px-3 py-2 text-left text-xs text-[#9fb6dd]"
          >
            <p className="font-semibold">
              #{item.revisionId} · {item.source}
            </p>
            <p>{item.createdAt}</p>
            <p>{Math.max(1, Math.round(item.snapshotSize / 1024))} KB</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPreviewRevision(item.revisionId)}
                disabled={
                  previewingRevisionId === item.revisionId ||
                  restoringRevisionId === item.revisionId
                }
                className="rounded-full border border-[#3a4f77] px-3 py-1 text-[11px] font-semibold text-[#dbe6ff] hover:border-[#4f7dff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewingRevisionId === item.revisionId
                  ? "预览中..."
                  : "预览"}
              </button>
              <button
                type="button"
                onClick={() => onRestoreRevision(item.revisionId)}
                disabled={
                  previewingRevisionId === item.revisionId ||
                  restoringRevisionId === item.revisionId
                }
                className="rounded-full border border-[#4f7dff] px-3 py-1 text-[11px] font-semibold text-[#dbe6ff] hover:bg-[#1a2b47] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {restoringRevisionId === item.revisionId
                  ? "恢复中..."
                  : "恢复到此版本"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

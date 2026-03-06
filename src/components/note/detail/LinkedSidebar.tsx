import Link from "next/link";
import type { NoteLinkedContext } from "@/lib/note";

interface LinkedSidebarProps {
  context: NoteLinkedContext;
  onOpenPaper: (paperId: string) => void;
  onOpenTask: (taskId: number) => void;
}

export function LinkedSidebar({
  context,
  onOpenPaper,
  onOpenTask,
}: LinkedSidebarProps) {
  return (
    <aside className="sticky top-4 h-fit rounded-2xl border border-[#22314b] bg-[linear-gradient(160deg,#0f1724,#0d182a)] p-4 shadow-[0_16px_38px_rgba(0,0,0,0.35)]">
      <h2 className="font-serif text-2xl text-[#e5ecff]">关联内容</h2>

      <section className="mt-4">
        <p className="text-xs tracking-wide text-[#8ba2c7]">文献</p>
        <div className="mt-2 space-y-2">
          {context.papers.length === 0 ? (
            <p className="text-xs text-[#6f87ac]">暂无文献链接</p>
          ) : null}
          {context.papers.map((paper) => (
            <article
              key={paper.paperId}
              className="rounded-xl border border-[#2d3a52] bg-[#111d31] p-3"
            >
              <p className="line-clamp-2 text-sm font-semibold text-[#dbe6ff]">
                {paper.title}
              </p>
              <p className="mt-1 text-xs text-[#8ba2c7]">{paper.paperId}</p>
              <div className="mt-2 flex gap-2">
                <Link
                  href={paper.arxivUrl}
                  target="_blank"
                  className="cursor-pointer rounded-full border border-[#2d3a52] px-2 py-1 text-[11px] font-semibold text-[#c7d5ef] hover:border-[#4f7dff] hover:bg-[#142033]"
                >
                  arXiv
                </Link>
                {paper.hasReport ? (
                  <button
                    type="button"
                    onClick={() => onOpenPaper(paper.paperId)}
                    className="cursor-pointer rounded-full border border-[#2d3a52] px-2 py-1 text-[11px] font-semibold text-[#c7d5ef] hover:border-[#4f7dff] hover:bg-[#142033]"
                  >
                    精读报告
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <p className="text-xs tracking-wide text-[#8ba2c7]">任务</p>
        <div className="mt-2 space-y-2">
          {context.tasks.length === 0 ? (
            <p className="text-xs text-[#6f87ac]">暂无任务链接</p>
          ) : null}
          {context.tasks.map((task) => (
            <article
              key={task.taskId}
              className="rounded-xl border border-[#2d3a52] bg-[#101a2c] p-3"
            >
              <p className="text-sm font-semibold text-[#dbe6ff]">
                {task.title}
              </p>
              <button
                type="button"
                onClick={() => onOpenTask(task.taskId)}
                className="mt-2 cursor-pointer rounded-full border border-[#2d3a52] px-2 py-1 text-[11px] font-semibold text-[#c7d5ef] hover:border-[#4f7dff] hover:bg-[#142033]"
              >
                查看详情
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <p className="text-xs tracking-wide text-[#8ba2c7]">笔记</p>
        <div className="mt-2 space-y-2">
          {context.notes.length === 0 ? (
            <p className="text-xs text-[#6f87ac]">暂无笔记链接</p>
          ) : null}
          {context.notes.map((note) => (
            <Link
              key={note.noteId}
              href={`/note/detail?noteId=${note.noteId}`}
              className="block cursor-pointer rounded-xl border border-[#2d3a52] bg-[#101a2c] p-3 text-sm font-semibold text-[#dbe6ff] transition-colors hover:border-[#4f7dff] hover:bg-[#142033]"
            >
              {note.title}
            </Link>
          ))}
        </div>
      </section>
    </aside>
  );
}

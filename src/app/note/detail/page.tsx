"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { NoteDetailEditor } from "@/components/note/detail/NoteDetailEditor";

function NoteDetailPageContent() {
  const searchParams = useSearchParams();
  const noteId = Number(searchParams.get("noteId") ?? 0);

  return <NoteDetailEditor noteId={noteId} />;
}

export default function NoteDetailPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-[#8ba2c7]">正在加载...</main>}>
      <NoteDetailPageContent />
    </Suspense>
  );
}

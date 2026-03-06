"use client";

import { useSearchParams } from "next/navigation";
import { NoteDetailEditor } from "@/components/note/detail/NoteDetailEditor";

export default function NoteDetailPage() {
  const searchParams = useSearchParams();
  const noteId = Number(searchParams.get("noteId") ?? 0);

  return <NoteDetailEditor noteId={noteId} />;
}

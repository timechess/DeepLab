import { notFound } from 'next/navigation';

import { NoteEditorShell } from '@/components/knowledge/note-editor-shell';
import { getKnowledgeNote } from '@/lib/api/client';

export default async function EditKnowledgeNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    const note = await getKnowledgeNote(id);
    return <NoteEditorShell initialNote={note} mode="edit" />;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('404')) {
      notFound();
    }
    throw error;
  }
}

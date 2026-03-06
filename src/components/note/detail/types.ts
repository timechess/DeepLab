import type { Editor } from "@tiptap/core";
import type { NoteLinkedContext, NoteRefType } from "@/lib/note";

export type SaveState = "saved" | "dirty" | "saving" | "failed";
export type PickerType = "paper" | "task" | "note" | "work_report";

export interface PickerOption {
  refType: NoteRefType;
  refId: string;
  label: string;
  description?: string;
  meta?: string;
}

export type ModalState =
  | { type: "paper"; paperId: string }
  | { type: "task"; task: NoteLinkedContext["tasks"][number] }
  | null;

export type EditorPosition = {
  top: number;
  left: number;
};

export type EditorRange = {
  from: number;
  to: number;
};

export type SlashMenuState = {
  open: boolean;
  query: string;
  position: EditorPosition;
  range: EditorRange | null;
  activeIndex: number;
};

export type SlashCommandItem = {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  targetType?: PickerType;
  run?: (editor: Editor) => void;
};

export type TargetPickerState = {
  open: boolean;
  targetType: PickerType;
  query: string;
  position: EditorPosition;
  range: EditorRange | null;
  activeIndex: number;
};

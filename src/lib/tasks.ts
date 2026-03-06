import { invoke } from "@tauri-apps/api/core";

export type TaskPriority = "low" | "medium" | "high";

export interface TaskItem {
  id: number;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  completedDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  priority: TaskPriority;
}

export interface TaskListResponse {
  page: number;
  pageSize: number;
  total: number;
  pendingTotal: number;
  completedTotal: number;
  items: TaskItem[];
}

export function getTaskHistory(page: number): Promise<TaskListResponse> {
  return invoke<TaskListResponse>("get_task_history", { page });
}

export function createTaskItem(input: TaskInput): Promise<TaskItem> {
  return invoke<TaskItem>("create_task_item", { input });
}

export function updateTaskItem(
  id: number,
  input: TaskInput,
): Promise<TaskItem> {
  return invoke<TaskItem>("update_task_item", { id, input });
}

export function toggleTaskCompleted(
  id: number,
  completed: boolean,
): Promise<TaskItem> {
  return invoke<TaskItem>("toggle_task_completed", { id, completed });
}

export function deleteTaskItem(id: number): Promise<void> {
  return invoke<void>("delete_task_item", { id });
}

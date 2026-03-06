import { invoke } from "@tauri-apps/api/core";

export interface RuleItem {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuleInput {
  content: string;
}

export function getRules(): Promise<RuleItem[]> {
  return invoke<RuleItem[]>("get_rules");
}

export function createRule(input: RuleInput): Promise<RuleItem> {
  return invoke<RuleItem>("create_rule_item", { input });
}

export function updateRule(id: number, input: RuleInput): Promise<RuleItem> {
  return invoke<RuleItem>("update_rule_item", { id, input });
}

export function deleteRule(id: number): Promise<void> {
  return invoke<void>("delete_rule_item", { id });
}

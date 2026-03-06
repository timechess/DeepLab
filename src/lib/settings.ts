import { invoke } from "@tauri-apps/api/core";

export interface RuntimeSettingDTO {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  ocrProvider: string;
  ocrBaseUrl: string;
  ocrApiKey: string;
  ocrModel: string;
  thinkingLevel: string;
  temperature: number;
  paperFilterPrompt: string;
  paperReadingPrompt: string;
  workReportPrompt: string;
  defaultsApplied: string[];
}

export interface RuntimeSettingUpsertInput {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  ocrProvider: string;
  ocrBaseUrl: string;
  ocrApiKey: string;
  ocrModel: string;
  thinkingLevel: string;
  temperature: number;
  paperFilterPrompt: string;
  paperReadingPrompt: string;
  workReportPrompt: string;
}

export function getRuntimeSetting(): Promise<RuntimeSettingDTO> {
  return invoke<RuntimeSettingDTO>("get_runtime_setting");
}

export function updateRuntimeSetting(
  input: RuntimeSettingUpsertInput,
): Promise<RuntimeSettingDTO> {
  return invoke<RuntimeSettingDTO>("update_runtime_setting", { input });
}

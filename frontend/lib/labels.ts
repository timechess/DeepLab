const WORKFLOW_NAME_LABELS: Record<string, string> = {
  daily_paper_reports: '每日论文工作流',
  daily_paper_workflow: '每日论文工作流',
  paper_collection: '论文收集工作流',
  paper_filtering: '论文初筛工作流',
  paper_reading: '论文精读工作流',
  fetch_papers: '论文收集工作流',
  filter_papers: '论文初筛工作流',
  read_papers: '论文精读工作流',
  reading_report_generation: '精读报告生成',
};

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  manual: '手动触发',
  schedule: '定时触发',
  scheduled: '定时触发',
  cron: '定时触发',
  api: '接口触发',
  system: '系统触发',
  workflow: '工作流触发',
  retry: '重试触发',
};

const STAGE_LABELS: Record<string, string> = {
  paper_collection: '论文收集',
  paper_filtering: '论文初筛',
  paper_reading: '论文精读',
  fetch_papers: '论文收集',
  filter_papers: '论文初筛',
  read_papers: '论文精读',
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function inferLabel(value: string, fallback: string): string {
  const normalized = normalize(value);
  if (!normalized) {
    return fallback;
  }
  if (normalized.includes('collect') || normalized.includes('fetch')) {
    return '论文收集';
  }
  if (normalized.includes('filter') || normalized.includes('screen')) {
    return '论文初筛';
  }
  if (normalized.includes('read') || normalized.includes('report')) {
    return '论文精读';
  }
  return fallback;
}

export function formatWorkflowName(value: string): string {
  const normalized = normalize(value);
  return WORKFLOW_NAME_LABELS[normalized] ?? inferLabel(normalized, '自定义工作流');
}

export function formatTriggerType(value: string): string {
  const normalized = normalize(value);
  if (!normalized) {
    return '未定义触发方式';
  }
  return TRIGGER_TYPE_LABELS[normalized] ?? '自定义触发';
}

export function formatStageName(value: string): string {
  const normalized = normalize(value);
  return STAGE_LABELS[normalized] ?? inferLabel(normalized, '自定义阶段');
}

import type {
  ReadingReport,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowStage,
} from '@/lib/api/schemas';

const DAILY_WORKFLOW_NAME = 'daily_paper_reports';

type FilteringSelectedPaper = {
  id: string;
  title: string;
  reason: string;
  score: number | null;
  rank: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function pickLatestDailyWorkflow(runs: WorkflowRun[]): WorkflowRun | null {
  return (
    runs.find(
      (run) =>
        run.workflowName === DAILY_WORKFLOW_NAME &&
        (run.status === 'running' || run.status === 'succeeded'),
    ) || null
  );
}

export function pickStage(
  workflow: WorkflowRunDetail,
  stageName: string,
): WorkflowStage | null {
  return workflow.stages.find((stage) => stage.stage === stageName) || null;
}

export function parseFilteringStage(stage: WorkflowStage | null): {
  summary: string;
  selectedPapers: FilteringSelectedPaper[];
} {
  const output = asRecord(stage?.outputPayload);
  if (!output) {
    return { summary: '', selectedPapers: [] };
  }

  const summary = asString(output.summary) ?? '';
  const selectedRaw = output.selected_papers;
  if (!Array.isArray(selectedRaw)) {
    return { summary, selectedPapers: [] };
  }

  const selectedPapers = selectedRaw
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const id = asString(record.id);
      const title = asString(record.title);
      const reason = asString(record.reason);
      const score = typeof record.score === 'number' ? record.score : null;
      const rank = typeof record.rank === 'number' ? record.rank : null;

      if (!id || !title || !reason) {
        return null;
      }

      return {
        id,
        title,
        reason,
        score,
        rank,
      };
    })
    .filter(Boolean) as FilteringSelectedPaper[];

  return { summary, selectedPapers };
}

export function parseReadingReportIds(stage: WorkflowStage | null): string[] {
  const output = asRecord(stage?.outputPayload);
  if (!output || !Array.isArray(output.reports)) {
    return [];
  }

  return output.reports
    .map((item) => asRecord(item))
    .map((item) => asString(item?.report_id))
    .filter(Boolean) as string[];
}

export function groupReportsByComment(reports: ReadingReport[]): {
  commented: ReadingReport[];
  uncommented: ReadingReport[];
} {
  const uncommented = reports.filter((report) => !report.comment?.trim());
  const commented = reports.filter((report) => !!report.comment?.trim());
  return { commented, uncommented };
}

import { ReportGroups } from '@/components/dashboard/report-groups';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  getReadingReport,
  getReadingReports,
  getWorkflowRun,
  getWorkflowRuns,
} from '@/lib/api/client';
import {
  groupReportsByComment,
  parseFilteringStage,
  parseReadingReportIds,
  pickLatestDailyWorkflow,
  pickStage,
} from '@/lib/dashboard';
import { formatTriggerType, formatWorkflowName } from '@/lib/labels';
import { decodeQueryParam } from '@/lib/query';
import { formatDateTime } from '@/lib/time';

const STAGE_FILTERING = 'paper_filtering';
const STAGE_READING = 'paper_reading';
const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

function toChinaDateKey(date: Date): string {
  return new Date(date.getTime() + CHINA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function isCreatedTodayInChina(isoDatetime: string): boolean {
  const createdAt = new Date(isoDatetime);
  if (Number.isNaN(createdAt.valueOf())) {
    return false;
  }
  return toChinaDateKey(createdAt) === toChinaDateKey(new Date());
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const [workflowRuns, reportPool] = await Promise.all([
    getWorkflowRuns(20),
    getReadingReports({ limit: 200 }),
  ]);

  const latestWorkflow = pickLatestDailyWorkflow(workflowRuns);

  if (!latestWorkflow) {
    return (
      <section className="page">
        <header className="page-header">
          <div>
            <h2 className="page-title">总览面板</h2>
            <p className="page-subtitle">未发现每日工作流记录，请先在运营后台触发。</p>
          </div>
        </header>
      </section>
    );
  }

  const workflowDetail = await getWorkflowRun(latestWorkflow.id);
  const filteringStage = pickStage(workflowDetail, STAGE_FILTERING);
  const readingStage = pickStage(workflowDetail, STAGE_READING);

  const filtering = parseFilteringStage(filteringStage);
  const reportIds = parseReadingReportIds(readingStage);

  const reportsById = new Map(reportPool.map((report) => [report.id, report]));
  const missingIds = reportIds.filter((id) => !reportsById.has(id));

  const missingReports = await Promise.all(
    missingIds.map(async (id) => {
      try {
        return await getReadingReport(id);
      } catch {
        return null;
      }
    }),
  );

  for (const report of missingReports) {
    if (report) {
      reportsById.set(report.id, report);
    }
  }

  const linkedReports =
    reportIds.length > 0
      ? reportIds.map((id) => reportsById.get(id)).filter(isDefined)
      : reportPool.slice(0, 20);

  const { commented, uncommented } = groupReportsByComment(linkedReports);
  const todayUncommented = uncommented.filter((report) => isCreatedTodayInChina(report.createdAt));

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">总览面板</h2>
          <p className="page-subtitle">实时汇总最近一次工作流的初筛结果与精读报告。</p>
        </div>
        <StatusBadge status={latestWorkflow.status} />
      </header>

      {params.notice ? <p className="notice">{decodeQueryParam(params.notice)}</p> : null}
      {params.error ? <p className="notice notice-error">{decodeQueryParam(params.error)}</p> : null}

      <section className="panel">
        <p className="panel-kicker">工作流核心信息</p>
        <h3 className="panel-title" style={{ marginBottom: 10 }}>
          运行编号 · {latestWorkflow.id}
        </h3>
        <div className="metrics-grid">
          <article className="metric-card">
            <p className="metric-label">工作流名称</p>
            <p className="metric-value">{formatWorkflowName(latestWorkflow.workflowName)}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">触发方式</p>
            <p className="metric-value">{formatTriggerType(latestWorkflow.triggerType)}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">开始时间</p>
            <p className="metric-value">{formatDateTime(latestWorkflow.startedAt)}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">结束时间</p>
            <p className="metric-value">{formatDateTime(latestWorkflow.finishedAt)}</p>
          </article>
        </div>
      </section>

      <section className="split-grid">
        <article className="panel">
          <p className="panel-kicker">初筛摘要</p>
          <h3 className="panel-title">初筛摘要</h3>
          <p className="page-subtitle" style={{ marginTop: 10 }}>
            {filtering.summary || '暂无摘要输出。'}
          </p>
        </article>

        <article className="panel">
          <p className="panel-kicker">入选结果</p>
          <h3 className="panel-title">入选论文（{filtering.selectedPapers.length}）</h3>
          <ul className="panel-list selected-paper-list" style={{ marginTop: 12 }}>
            {filtering.selectedPapers.length > 0 ? (
              filtering.selectedPapers.map((paper) => (
                <li className="signal-card" key={paper.id}>
                  <div className="report-card-head">
                    <p className="mono-id">#{paper.rank ?? '-'} · {paper.id}</p>
                    <p className="page-subtitle">评分 {paper.score ?? '--'}</p>
                  </div>
                  <h4 className="report-card-title">{paper.title}</h4>
                  <p className="page-subtitle clamp-2">{paper.reason}</p>
                </li>
              ))
            ) : (
              <li className="signal-card">
                <p className="page-subtitle">本次工作流暂无入选论文。</p>
              </li>
            )}
          </ul>
        </article>
      </section>

      <ReportGroups commented={commented} uncommented={todayUncommented} />
    </section>
  );
}

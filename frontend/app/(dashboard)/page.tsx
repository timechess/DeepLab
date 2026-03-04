import { DailyWorkflowTrigger } from '@/components/ops/daily-workflow-trigger';
import { DailyWorkReportTrigger } from '@/components/ops/daily-work-report-trigger';
import { ReportGroups } from '@/components/dashboard/report-groups';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  getDailyWorkActivityPreview,
  getDailyWorkReports,
  getReadingReport,
  getReadingReports,
  getWorkflowRun,
  getWorkflowRuns,
} from '@/lib/api/client';
import { MarkdownRenderer } from '@/lib/markdown/renderer';
import {
  groupReportsByComment,
  isCreatedTodayInChina,
  parseFilteringStage,
  parseReadingReportIds,
  pickLatestTodayDailyWorkflow,
  pickStage,
} from '@/lib/dashboard';
import { formatTriggerType, formatWorkflowName } from '@/lib/labels';
import { decodeQueryParam } from '@/lib/query';
import { formatDateTime } from '@/lib/time';

const STAGE_FILTERING = 'paper_filtering';
const STAGE_READING = 'paper_reading';
const NO_ACTIVITY_REPORT_TEXT = '昨天没有任何工作记录。';

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const [workflowRuns, todayWorkReports, dailyWorkActivityPreview] = await Promise.all([
    getWorkflowRuns(200),
    getDailyWorkReports({ limit: 1, todayOnly: true }),
    getDailyWorkActivityPreview(),
  ]);
  const latestWorkflow = pickLatestTodayDailyWorkflow(workflowRuns);
  const todayWorkReport = todayWorkReports[0] ?? null;
  const activityCounts = dailyWorkActivityPreview.counts;
  const activityStats = [
    { label: '前一日行为', value: `${activityCounts.yesterdayActivityCount} 条`, strong: true },
    { label: '精读评论', value: String(activityCounts.reportComments), strong: false },
    { label: '新建任务', value: String(activityCounts.createdTasks), strong: false },
    { label: '完成任务', value: String(activityCounts.completedTasks), strong: false },
    { label: '笔记变更', value: String(activityCounts.changedNotes), strong: false },
  ] as const;

  let filteringSummary = '';
  let selectedPapersCount = 0;
  let selectedPapers: Array<{
    id: string;
    title: string;
    reason: string;
    score: number | null;
    rank: number | null;
  }> = [];
  let commented = [] as Awaited<ReturnType<typeof getReadingReports>>;
  let todayUncommented = [] as Awaited<ReturnType<typeof getReadingReports>>;

  if (latestWorkflow) {
    const [workflowDetail, reportPool] = await Promise.all([
      getWorkflowRun(latestWorkflow.id),
      getReadingReports({ limit: 200 }),
    ]);
    const filteringStage = pickStage(workflowDetail, STAGE_FILTERING);
    const readingStage = pickStage(workflowDetail, STAGE_READING);
    const filtering = parseFilteringStage(filteringStage);
    const reportIds = parseReadingReportIds(readingStage);
    filteringSummary = filtering.summary;
    selectedPapers = filtering.selectedPapers;
    selectedPapersCount = filtering.selectedPapers.length;

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
    const grouped = groupReportsByComment(linkedReports);
    commented = grouped.commented;
    todayUncommented = grouped.uncommented.filter((report) => isCreatedTodayInChina(report.createdAt));
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">总览面板</h2>
          <p className="page-subtitle">实时汇总每日论文流程与 AI 工作日报。</p>
        </div>
        {latestWorkflow ? <StatusBadge status={latestWorkflow.status} /> : null}
      </header>

      {params.notice ? <p className="notice">{decodeQueryParam(params.notice)}</p> : null}
      {params.error ? <p className="notice notice-error">{decodeQueryParam(params.error)}</p> : null}

      {latestWorkflow ? (
        <>
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
                {filteringSummary || '暂无摘要输出。'}
              </p>
            </article>

            <article className="panel">
              <p className="panel-kicker">入选结果</p>
              <h3 className="panel-title">入选论文（{selectedPapersCount}）</h3>
              <ul className="panel-list selected-paper-list" style={{ marginTop: 12 }}>
                {selectedPapersCount > 0 ? (
                  selectedPapers.map((paper) => (
                    <li className="signal-card" key={paper.id}>
                      <div className="report-card-head">
                        <p className="mono-id">
                          #{paper.rank ?? '-'} · {paper.id}
                        </p>
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
        </>
      ) : (
        <section className="panel" style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
          <p className="panel-kicker">手动触发</p>
          <h3 className="panel-title">触发当日论文工作流</h3>
          <p className="page-subtitle">未检测到今日论文工作流，请先触发当日流程。</p>
          <DailyWorkflowTrigger buttonLabel="触发当日工作流" />
        </section>
      )}

      <section className="panel">
        <p className="panel-kicker">AI 工作日报</p>
        <h3 className="panel-title">今日日报</h3>
        {todayWorkReport && todayWorkReport.status === 'succeeded' && todayWorkReport.reportMarkdown.trim() ? (
          <>
            <p className="page-subtitle" style={{ marginTop: 8 }}>
              业务日期：{todayWorkReport.businessDate} · 行为来源：{todayWorkReport.sourceDate}
            </p>
            {todayWorkReport.reportMarkdown.trim() === NO_ACTIVITY_REPORT_TEXT ? (
              <p className="page-subtitle" style={{ marginTop: 12 }}>
                {NO_ACTIVITY_REPORT_TEXT}
              </p>
            ) : (
              <div className="report-content-scrollbox" style={{ marginTop: 14 }}>
                <MarkdownRenderer content={todayWorkReport.reportMarkdown} />
              </div>
            )}
          </>
        ) : (
          <div className="daily-report-pending-wrap">
            <div className="daily-activity-line" role="status" aria-label="前一日用户行为统计">
              {activityStats.map((item, index) => (
                <div
                  className={`daily-activity-item${item.strong ? ' daily-activity-item-strong' : ''}`}
                  key={item.label}
                >
                  {item.label} {item.value}
                  {index < activityStats.length - 1 ? <span className="daily-activity-sep"> / </span> : null}
                </div>
              ))}
            </div>
            <p className="page-subtitle">
              {todayWorkReport?.status === 'failed'
                ? `今日日报生成失败：${todayWorkReport.errorMessage || '请重试。'}`
                : dailyWorkActivityPreview.hasUserActivity
                  ? '今日日报尚未生成，请先触发工作流。'
                  : NO_ACTIVITY_REPORT_TEXT}
            </p>
            {dailyWorkActivityPreview.hasUserActivity ? (
              <DailyWorkReportTrigger buttonLabel="触发 AI 日报工作流" />
            ) : null}
          </div>
        )}
      </section>
    </section>
  );
}

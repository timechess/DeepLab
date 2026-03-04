'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  createKnowledgeQuestion,
  createScreeningRule,
  createTodoTask,
  deleteKnowledgeNote,
  deleteKnowledgeQuestion,
  deleteRuntimeSetting,
  deleteScreeningRule,
  deleteTodoTask,
  getRuntimeSettings,
  triggerDailyWorkflow,
  triggerDailyWorkReportWorkflow,
  triggerFetchPapers,
  triggerFilterPapers,
  triggerKnowledgeExtraction,
  triggerReadPaperByArxivId,
  triggerReadPapers,
  updateKnowledgeQuestion,
  updateRuntimeSetting,
  updateReadingReportComment,
  updateScreeningRule,
  updateTodoTaskCompletion,
} from '@/lib/api/client';

function toSafePath(raw: FormDataEntryValue | null, fallback: string): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) {
    return fallback;
  }
  return raw;
}

function toMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return '请求失败，请稍后重试。';
}

function withQuery(path: string, key: string, value: string): string {
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${pathname}?${params.toString()}`;
}

type ActionResult = {
  ok: boolean;
  message: string;
};

export async function updateReportCommentAction(reportId: string, formData: FormData) {
  const comment = String(formData.get('comment') ?? '');
  const redirectTo = toSafePath(formData.get('redirectTo'), `/reports/${reportId}`);
  let nextLocation: string;

  try {
    await updateReadingReportComment(reportId, comment);
    revalidatePath('/');
    revalidatePath('/ops/reports');
    revalidatePath(`/reports/${reportId}`);
    nextLocation = withQuery(redirectTo, 'notice', '评论已更新');
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function triggerKnowledgeExtractionAction(reportId: string, formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), `/reports/${reportId}`);
  let nextLocation: string;

  try {
    const result = await triggerKnowledgeExtraction(reportId);
    revalidatePath('/');
    revalidatePath('/knowledge');
    revalidatePath(`/reports/${reportId}`);
    for (const questionId of result.questionIds) {
      revalidatePath(`/knowledge/${questionId}`);
    }
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'notice', result.message);
  } catch (error) {
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function triggerKnowledgeExtractionRefreshAction(
  reportId: string,
): Promise<ActionResult> {
  try {
    const result = await triggerKnowledgeExtraction(reportId);
    revalidatePath('/');
    revalidatePath('/knowledge');
    revalidatePath(`/reports/${reportId}`);
    for (const questionId of result.questionIds) {
      revalidatePath(`/knowledge/${questionId}`);
    }
    return {
      ok: true,
      message: result.message || '知识提炼任务已触发。',
    };
  } catch (error) {
    return {
      ok: false,
      message: toMessage(error),
    };
  }
}

export async function triggerDailyWorkflowAction(formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/workflows');
  let nextLocation: string;

  try {
    const result = await triggerDailyWorkflow();
    revalidatePath('/');
    revalidatePath('/ops/workflows');
    nextLocation = withQuery(
      redirectTo,
      'notice',
      `已触发每日工作流：${result.workflow_id}`,
    );
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function triggerDailyWorkflowRefreshAction(): Promise<ActionResult> {
  try {
    const result = await triggerDailyWorkflow();
    revalidatePath('/');
    revalidatePath('/ops/workflows');
    return {
      ok: true,
      message: `已触发每日工作流：${result.workflow_id}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: toMessage(error),
    };
  }
}

export async function triggerDailyWorkReportWorkflowRefreshAction(): Promise<ActionResult> {
  try {
    const result = await triggerDailyWorkReportWorkflow();
    revalidatePath('/');
    revalidatePath('/ops/workflows');
    revalidatePath('/ops/daily-work-reports');
    return {
      ok: true,
      message: `已触发工作日报工作流：${result.workflow_id}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: toMessage(error),
    };
  }
}

export async function triggerFetchPapersAction(formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/workflows');
  let nextLocation: string;

  try {
    const result = await triggerFetchPapers();
    revalidatePath('/');
    revalidatePath('/ops/workflows');
    nextLocation = withQuery(redirectTo, 'notice', `论文收集完成：${result.length} 条`);
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function triggerFilterPapersAction(formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/workflows');
  let nextLocation: string;

  try {
    const result = await triggerFilterPapers();
    revalidatePath('/');
    revalidatePath('/ops/workflows');
    nextLocation = withQuery(redirectTo, 'notice', `初筛完成：入选 ${result.selected_count} 篇`);
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function triggerReadPapersAction(formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/workflows');
  let nextLocation: string;

  try {
    const result = await triggerReadPapers();
    revalidatePath('/');
    revalidatePath('/ops/workflows');
    revalidatePath('/ops/reports');
    nextLocation = withQuery(
      redirectTo,
      'notice',
      `精读完成：成功 ${result.succeeded_count}，失败 ${result.failed_count}`,
    );
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function triggerReadByArxivIdAction(formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/reports');
  const paperId = String(formData.get('paperId') ?? '').trim();
  let nextLocation: string;

  if (!paperId) {
    nextLocation = withQuery(redirectTo, 'error', '请输入 arXiv ID。');
    redirect(nextLocation);
  }

  try {
    const result = await triggerReadPaperByArxivId(paperId);
    revalidatePath('/');
    revalidatePath('/ops/reports');
    revalidatePath('/ops/workflows');

    nextLocation = withQuery(redirectTo, 'notice', result.message);
    if (result.report_id) {
      nextLocation = withQuery(nextLocation, 'reportId', result.report_id);
    }
    if (result.workflow_id) {
      nextLocation = withQuery(nextLocation, 'workflowId', result.workflow_id);
    }
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function createScreeningRuleAction(formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/rules');
  const rule = String(formData.get('rule') ?? '').trim();
  const createdBy = 'user';
  let nextLocation: string;

  try {
    await createScreeningRule({ rule, createdBy });
    revalidatePath('/ops/rules');
    nextLocation = withQuery(redirectTo, 'notice', '规则已创建');
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function updateScreeningRuleAction(ruleId: number, formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/rules');
  const rule = String(formData.get('rule') ?? '').trim();
  const createdBy = String(formData.get('createdBy') ?? '').trim();
  let nextLocation: string;

  try {
    await updateScreeningRule(ruleId, {
      rule,
      createdBy,
    });
    revalidatePath('/ops/rules');
    nextLocation = withQuery(redirectTo, 'notice', `规则 #${ruleId} 已更新`);
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function deleteScreeningRuleAction(ruleId: number, formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/rules');
  let nextLocation: string;

  try {
    await deleteScreeningRule(ruleId);
    revalidatePath('/ops/rules');
    nextLocation = withQuery(redirectTo, 'notice', `规则 #${ruleId} 已删除`);
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function createTodoTaskAction(formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/tasks');
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  let nextLocation: string;

  try {
    await createTodoTask({ title, description });
    revalidatePath('/ops/tasks');
    nextLocation = withQuery(redirectTo, 'notice', '任务已创建');
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function toggleTodoTaskCompletionAction(
  taskId: number,
  currentCompleted: boolean,
  formData: FormData,
) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/tasks');
  let nextLocation: string;

  try {
    await updateTodoTaskCompletion(taskId, { completed: !currentCompleted });
    revalidatePath('/ops/tasks');
    nextLocation = withQuery(
      redirectTo,
      'notice',
      !currentCompleted ? `任务 #${taskId} 已标记完成` : `任务 #${taskId} 已标记未完成`,
    );
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function deleteTodoTaskAction(taskId: number, formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/tasks');
  let nextLocation: string;

  try {
    await deleteTodoTask(taskId);
    revalidatePath('/ops/tasks');
    nextLocation = withQuery(redirectTo, 'notice', `任务 #${taskId} 已删除`);
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function updateRuntimeSettingAction(key: string, formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/settings');
  const value = String(formData.get('value') ?? '');
  let nextLocation: string;

  try {
    await updateRuntimeSetting(key, { value });
    revalidatePath('/ops/settings', 'page');
    revalidatePath('/ops/workflows', 'page');
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'notice', `配置 ${key} 已保存`);
  } catch (error) {
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function clearRuntimeSettingAction(key: string, formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/settings');
  let nextLocation: string;

  try {
    await deleteRuntimeSetting(key);
    revalidatePath('/ops/settings', 'page');
    revalidatePath('/ops/workflows', 'page');
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'notice', `配置 ${key} 已清空`);
  } catch (error) {
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function refreshRuntimeSettingsAction(formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/ops/settings');
  let nextLocation: string;

  try {
    await getRuntimeSettings();
    revalidatePath('/ops/settings');
    nextLocation = withQuery(redirectTo, 'notice', '配置已刷新');
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function createKnowledgeQuestionAction(formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/knowledge');
  const question = String(formData.get('question') ?? '').trim();
  let nextLocation: string;

  if (!question) {
    nextLocation = withQuery(redirectTo, 'error', '问题不能为空。');
    redirect(nextLocation);
  }

  try {
    const result = await createKnowledgeQuestion({ question, createdBy: 'user' });
    revalidatePath('/knowledge');
    revalidatePath(`/knowledge/${result.questionId}`);
    nextLocation = withQuery(
      redirectTo,
      'notice',
      result.deduplicated ? '问题已存在，已返回已有问题。' : '问题已创建。',
    );
    nextLocation = withQuery(nextLocation, 'questionId', result.questionId);
  } catch (error) {
    nextLocation = withQuery(redirectTo, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function updateKnowledgeQuestionAction(questionId: string, formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), `/knowledge/${questionId}`);
  const question = String(formData.get('question') ?? '').trim();
  let nextLocation: string;

  if (!question) {
    nextLocation = withQuery(redirectTo, 'error', '问题不能为空。');
    redirect(nextLocation);
  }

  try {
    await updateKnowledgeQuestion(questionId, { question });
    revalidatePath('/knowledge');
    revalidatePath(`/knowledge/${questionId}`);
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'notice', '问题已更新。');
  } catch (error) {
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function deleteKnowledgeQuestionAction(questionId: string, formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/knowledge');
  let nextLocation: string;

  try {
    const result = await deleteKnowledgeQuestion(questionId);
    revalidatePath('/knowledge');
    revalidatePath(`/knowledge/${questionId}`);
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(
      nextLocation,
      'notice',
      `问题已删除，同时删除方案 ${result.deletedSolutions} 条。`,
    );
  } catch (error) {
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

export async function deleteKnowledgeNoteAction(noteId: string, formData: FormData) {
  const redirectTo = toSafePath(formData.get('redirectTo'), '/knowledge?view=notes');
  let nextLocation: string;

  try {
    const result = await deleteKnowledgeNote(noteId);
    revalidatePath('/knowledge');
    revalidatePath(`/knowledge/notes/${noteId}/edit`);
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(
      nextLocation,
      'notice',
      `笔记已删除，同时移除出链 ${result.deletedOutgoingLinks} 条、入链 ${result.deletedIncomingLinks} 条。`,
    );
  } catch (error) {
    nextLocation = withQuery(redirectTo, '_ts', String(Date.now()));
    nextLocation = withQuery(nextLocation, 'error', toMessage(error));
  }

  redirect(nextLocation);
}

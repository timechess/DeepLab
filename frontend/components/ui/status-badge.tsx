import clsx from 'clsx';

type Status = 'running' | 'succeeded' | 'failed' | 'partial_succeeded' | string;

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  queued: '排队中',
  processing: '处理中',
  running: '进行中',
  completed: '已完成',
  succeeded: '成功',
  failed: '失败',
  error: '错误',
  canceled: '已取消',
  cancelled: '已取消',
  partial_succeeded: '部分成功',
};

export function StatusBadge({ status }: { status: Status }) {
  const label = STATUS_LABEL[status] ?? '未知状态';
  const isRunning =
    status === 'running' || status === 'processing' || status === 'queued' || status === 'pending';
  const isSuccess = status === 'succeeded' || status === 'completed';
  const isFailed = status === 'failed' || status === 'error';

  return (
    <span
      className={clsx('status-badge', {
        'status-running': isRunning,
        'status-success': isSuccess,
        'status-failed': isFailed,
        'status-partial': status === 'partial_succeeded',
      })}
    >
      {label}
    </span>
  );
}

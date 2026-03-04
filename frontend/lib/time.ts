const BEIJING_TIME_ZONE = 'Asia/Shanghai';

function parseDatetime(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date;
}

export function formatDateTime(value: string | null): string {
  const date = parseDatetime(value);
  if (!date) {
    return value ? value : '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  const date = parseDatetime(value);
  if (!date) {
    return value ? value : '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

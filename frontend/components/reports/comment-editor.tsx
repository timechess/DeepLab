import { updateReportCommentAction } from '@/app/actions';

export function CommentEditor({
  reportId,
  redirectTo,
  defaultValue,
}: {
  reportId: string;
  redirectTo: string;
  defaultValue: string;
}) {
  const action = updateReportCommentAction.bind(null, reportId);

  return (
    <form action={action} className="panel" style={{ display: 'grid', gap: 10 }}>
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <p className="panel-kicker">用户评论</p>
      <h2 className="panel-title">更新评论</h2>
      <textarea defaultValue={defaultValue} name="comment" placeholder="写下你的评价、笔记或后续行动。" />
      <div>
        <button className="button button-primary" type="submit">
          保存评论
        </button>
      </div>
    </form>
  );
}

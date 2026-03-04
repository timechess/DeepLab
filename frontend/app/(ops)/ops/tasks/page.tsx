import { createTodoTaskAction } from '@/app/actions';
import { TodoList } from '@/components/ops/todo-list';
import { getTodoTasks } from '@/lib/api/client';
import { decodeQueryParam } from '@/lib/query';

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const query = await searchParams;
  const tasks = await getTodoTasks();
  const completedCount = tasks.filter((task) => task.isCompleted).length;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">任务管理</h2>
        </div>
      </header>

      {query.notice ? <p className="notice">{decodeQueryParam(query.notice)}</p> : null}
      {query.error ? <p className="notice notice-error">{decodeQueryParam(query.error)}</p> : null}

      <section className="panel">
        <p className="panel-kicker">创建任务</p>
        <h3 className="panel-title" style={{ marginBottom: 12 }}>
          新增任务
        </h3>
        <form action={createTodoTaskAction} style={{ display: 'grid', gap: 10 }}>
          <input name="redirectTo" type="hidden" value="/ops/tasks" />
          <input maxLength={255} name="title" placeholder="输入任务标题" required />
          <textarea name="description" placeholder="输入任务具体描述" required />
          <div>
            <button className="button button-primary" type="submit">
              创建任务
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <p className="panel-kicker">任务列表</p>
        <h3 className="panel-title" style={{ marginBottom: 12 }}>
          任务列表（总计 {tasks.length} / 已完成 {completedCount}）
        </h3>

        <TodoList tasks={tasks} />
      </section>
    </section>
  );
}

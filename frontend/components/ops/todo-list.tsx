import { deleteTodoTaskAction, toggleTodoTaskCompletionAction } from '@/app/actions';
import type { TodoTask } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/time';

function completionLabel(task: TodoTask): string {
  return task.isCompleted ? '已完成' : '未完成';
}

export function TodoList({ tasks }: { tasks: TodoTask[] }) {
  if (tasks.length === 0) {
    return <p className="page-subtitle">暂无任务，先创建一条任务试试。</p>;
  }

  return (
    <div className="rules-grid">
      {tasks.map((task) => {
        const toggleAction = toggleTodoTaskCompletionAction.bind(null, task.id, task.isCompleted);
        const deleteAction = deleteTodoTaskAction.bind(null, task.id);

        return (
          <article
            className={`panel-list-item todo-item${task.isCompleted ? ' todo-item-completed' : ''}`}
            id={`task-${task.id}`}
            key={task.id}
          >
            <div className="rule-head">
              <h4 className="todo-title">{task.title}</h4>
              <div className="meta-chip-list">
                <span className="meta-chip meta-chip-outline">{completionLabel(task)}</span>
              </div>
            </div>

            <p className="rule-content">{task.description}</p>

            <div className="todo-time-grid">
              <p className="mono-id rule-time">创建时间：{formatDateTime(task.createdAt)}</p>
              <p className="mono-id rule-time">完成时间：{formatDateTime(task.completedAt)}</p>
            </div>

            <div className="rule-actions">
              <form action={toggleAction} className="rule-inline-form">
                <input name="redirectTo" type="hidden" value="/ops/tasks" />
                <button
                  className={`button ${task.isCompleted ? 'button-secondary' : 'button-primary'} rule-action-btn`}
                  type="submit"
                >
                  {task.isCompleted ? '标记未完成' : '标记完成'}
                </button>
              </form>

              <form action={deleteAction} className="rule-inline-form">
                <input name="redirectTo" type="hidden" value="/ops/tasks" />
                <button className="button button-danger rule-action-btn" type="submit">
                  删除
                </button>
              </form>
            </div>
          </article>
        );
      })}
    </div>
  );
}

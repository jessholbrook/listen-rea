import { get, put, uid, now, transaction } from "./db";
import type { CollectionTask } from "./collection-tasks";
import type {
  TaskActivity,
  TaskActivityAction,
  TaskState,
} from "./task-activity";
export const taskActivityKind = "libraryTaskActivity";
const state = (t: CollectionTask): TaskState => ({
  assigneeId: t.assigneeId,
  dueDate: t.dueDate,
  status: t.status,
});
// All callers record within the owning mutation's transaction; no copied titles/research/names.
export async function recordTaskActivity(
  task: CollectionTask,
  before: CollectionTask | null,
  actorId: string | null,
  action: TaskActivityAction,
) {
  return transaction(async () => {
    if (
      before &&
      before.assigneeId === task.assigneeId &&
      before.dueDate === task.dueDate &&
      before.status === task.status &&
      before.title === task.title
    )
      return;
    const old = await get<TaskActivity>(
      taskActivityKind,
      task.id,
      task.workspaceId,
    );
    const record: TaskActivity = {
      id: task.id,
      workspaceId: task.workspaceId,
      collectionId: task.collectionId,
      omitted: old?.omitted || 0,
      events: [
        ...(old?.events || []),
        {
          id: uid(),
          sequence: (old?.omitted || 0) + (old?.events.length || 0) + 1,
          at: now(),
          actorId,
          action,
          taskVersion: task.version,
          before: before ? state(before) : null,
          after: state(task),
          titleChanged: !!before && before.title !== task.title,
        },
      ],
    };
    while (
      record.events.length > 100 ||
      JSON.stringify(record).length > 200000
    ) {
      record.events.shift();
      record.omitted++;
    }
    await put(taskActivityKind, record);
  });
}

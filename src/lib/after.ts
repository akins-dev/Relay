export function after(task: () => unknown | Promise<unknown>) {
  queueMicrotask(() => {
    Promise.resolve(task()).catch(() => {});
  });
}

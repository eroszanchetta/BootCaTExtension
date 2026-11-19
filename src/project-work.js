// Network batches share project access with document-level work. Export and
// project-wide rechecks require exclusive access; only one batch owns a runner.
export function createProjectWork({ locks, getProjectId }) {
  const tails = new Map();
  const prefix = () => `bootcat:${getProjectId()}:`;
  const request = (name, mode, wait, task) => locks
    ? locks.request(name, { mode, ifAvailable: !wait }, lock => lock ? task() : false)
    : task();
  async function document(url, task, { wait = false } = {}) {
    const base = prefix(), key = base + 'document:' + encodeURIComponent(url);
    if (locks) return request(base + 'access', 'shared', wait, () => request(key, 'exclusive', wait, task));
    // A single-window fallback also serializes queued recoveries for one URL.
    const previous = tails.get(key);
    if (previous && !wait) return false;
    const next = (previous || Promise.resolve()).catch(() => {}).then(task);
    tails.set(key, next);
    try { return await next; } finally { if (tails.get(key) === next) tails.delete(key); }
  }
  return {
    document,
    batch: task => request(prefix() + 'access', 'shared', false, () => request(prefix() + 'batch', 'exclusive', false, task)),
    exclusive: task => request(prefix() + 'access', 'exclusive', false, task),
    async activity() {
      const result = { batch: false, exclusive: false, documents: new Set() };
      if (!locks?.query) return result;
      const base = prefix(), { held } = await locks.query();
      for (const lock of held) {
        if (lock.name === base + 'batch') result.batch = true;
        if (lock.name === base + 'access' && lock.mode === 'exclusive') result.exclusive = true;
        if (lock.name.startsWith(base + 'document:')) result.documents.add(decodeURIComponent(lock.name.slice((base + 'document:').length)));
      }
      return result;
    }
  };
}

// One heavy extraction at a time. Manual recoveries are selected ahead of the
// next batch extraction, without trying to interrupt an extraction already begun.
export function createExtractionQueue(locks) {
  const manual = [], batch = []; let active = false;
  async function drain() {
    if (active) return;
    active = true;
    try {
      while (manual.length || batch.length) {
        const job = (manual.length ? manual : batch).shift();
        try {
          const value = locks ? await locks.request('bootcat-extraction', { mode: 'exclusive' }, job.task) : await job.task();
          job.resolve(value);
        } catch (error) { job.reject(error); }
      }
    } finally { active = false; }
  }
  return { run(task, { priority = false } = {}) {
    return new Promise((resolve, reject) => { (priority ? manual : batch).push({ task, resolve, reject }); drain(); });
  } };
}

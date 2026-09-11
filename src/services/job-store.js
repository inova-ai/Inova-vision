import { putJobJson, readJobJson } from './blob-store.js';

function jobPrefix(id) { return `jobs/${id}/`; }
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function saveJob(job) {
  if (!job?.id) throw new Error("Job tidak valid: id tidak ditemukan.");
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Jobs use immutable public Blob objects instead of overwriting one
      // pathname. This works with the user's existing PUBLIC Blob store and
      // avoids CDN cache/overwrite consistency problems.
      await putJobJson(jobPrefix(job.id), job);
      return job;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(250 * (attempt + 1));
    }
  }
  throw lastError || new Error("Gagal menyimpan job.");
}

export async function getJob(id) {
  if (!id) return null;
  // Each update is a new immutable blob. We list only this job's prefix and
  // read the newest pathname, so no mutable JSON blob can remain stale in CDN.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const job = await readJobJson(jobPrefix(id));
      if (job) return job;
    } catch (error) {
      console.error('Job read failed:', error?.message || error);
    }
    if (attempt < 9) await sleep(200 + attempt * 150);
  }
  return null;
}

export async function updateJob(id, patch) {
  if (!id) return null;
  const job = await getJob(id);
  if (!job) return null;
  Object.assign(job, patch || {}, { updatedAt: new Date().toISOString() });
  return saveJob(job);
}

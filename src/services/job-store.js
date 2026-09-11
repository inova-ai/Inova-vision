import { putBlob, readBlobJson } from './blob-store.js';

function jobPath(id) { return `jobs/${id}.json`; }
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function saveJob(job) {
  if (!job?.id) throw new Error("Job tidak valid: id tidak ditemukan.");
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await putBlob(jobPath(job.id), JSON.stringify(job, null, 2), 'application/json', { cacheControlMaxAge: 0 });
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
  // Blob reads can briefly lag immediately after a write. Retry before
  // reporting a job as missing, so the UI never turns a transient read
  // into "Job tidak ditemukan".
  for (let attempt = 0; attempt < 8; attempt++) {
    const job = await readBlobJson(jobPath(id));
    if (job) return job;
    if (attempt < 7) await sleep(200 + attempt * 150);
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

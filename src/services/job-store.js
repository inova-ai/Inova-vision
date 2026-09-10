import { putBlob, readBlobJson } from './blob-store.js';

function jobPath(id) { return `jobs/${id}.json`; }

export async function saveJob(job) {
  if (!job?.id) throw new Error("Job tidak valid: id tidak ditemukan.");
  await putBlob(jobPath(job.id), JSON.stringify(job, null, 2), 'application/json', { cacheControlMaxAge: 0 });
  return job;
}

export async function getJob(id) {
  if (!id) return null;
  return readBlobJson(jobPath(id));
}

export async function updateJob(id, patch) {
  if (!id) return null;
  const job = await getJob(id);
  if (!job) return null;
  Object.assign(job, patch || {}, { updatedAt: new Date().toISOString() });
  return saveJob(job);
}

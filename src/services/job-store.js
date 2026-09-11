import { put, get } from "@vercel/blob";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const jobPath = (id) => `jobs/${id}.json`;
const memoryJobs = globalThis.__INOVA_JOB_CACHE__ || (globalThis.__INOVA_JOB_CACHE__ = new Map());

function authOptions(){
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? { token } : {};
}

function persistableJob(job){
  return JSON.parse(JSON.stringify(job, (key, value) => {
    if (key === "_localPath" || key === "musicLocalPath") return undefined;
    return value;
  }));
}

async function writeJob(job){
  const pathname = jobPath(job.id);
  const persisted = persistableJob(job);
  const blob = await put(pathname, JSON.stringify(persisted, null, 2), {
    access: "public",
    ...authOptions(),
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60
  });
  memoryJobs.set(job.id, { ...job });
  return { ...job, _blobUrl: blob.url };
}

async function readJob(id){
  try {
    const result = await get(jobPath(id), { access: "public", ...authOptions(), useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const job = JSON.parse(await new Response(result.stream).text());
    memoryJobs.set(id, job);
    return job;
  } catch (error) {
    console.error("Job read failed:", error?.message || error);
    return null;
  }
}

export async function saveJob(job){
  if(!job?.id) throw new Error("Job tidak valid: id tidak ditemukan.");
  let lastError = null;
  for(let attempt=0; attempt<3; attempt++){
    try { return await writeJob(job); }
    catch(error){ lastError=error; if(attempt<2) await sleep(250*(attempt+1)); }
  }
  throw lastError || new Error("Gagal menyimpan job.");
}

export async function getJob(id){
  if(!id) return null;
  const cached = memoryJobs.get(id);
  if(cached) return { ...cached };
  for(let attempt=0; attempt<5; attempt++){
    const job = await readJob(id);
    if(job) return job;
    if(attempt<4) await sleep(200 + attempt*150);
  }
  return null;
}

// Important: progress/step changes are kept in the current Vercel invocation's
// memory. Only durable milestones are written to Blob. This avoids a Blob PUT
// for every progress tick while the browser can still see scene-level updates.
export async function updateJob(id, patch){
  if(!id) return null;
  const job = await getJob(id);
  if(!job) return null;
  const next = Object.assign({}, job, patch || {}, { updatedAt: new Date().toISOString() });
  memoryJobs.set(id, { ...next });

  const structuralKeys = ["scenes","outputUrl","outputPathname","completedAt","error","cancelledAt"];
  const structuralChange = structuralKeys.some(key => Object.prototype.hasOwnProperty.call(patch || {}, key));
  const statusChanged = Object.prototype.hasOwnProperty.call(patch || {}, "status") && patch.status !== job.status;
  const shouldPersist = structuralChange || statusChanged;
  if(!shouldPersist) return { ...next };
  return saveJob(next);
}

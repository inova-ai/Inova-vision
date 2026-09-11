import { put, get } from "@vercel/blob";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const jobPath = (id) => `jobs/${id}.json`;
const memoryJobs = globalThis.__INOVA_JOB_CACHE__ || (globalThis.__INOVA_JOB_CACHE__ = new Map());

function authOptions(){
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? { token } : {};
}

async function writeJob(job){
  const pathname = jobPath(job.id);
  const blob = await put(pathname, JSON.stringify(job, null, 2), {
    access: "public",
    ...authOptions(),
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
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
  if (!job?.id) throw new Error("Job tidak valid: id tidak ditemukan.");
  let lastError = null;
  for(let attempt=0; attempt<4; attempt++){
    try { return await writeJob(job); }
    catch(error){ lastError=error; if(attempt<3) await sleep(300*(attempt+1)); }
  }
  throw lastError || new Error("Gagal menyimpan job.");
}

export async function getJob(id){
  if(!id) return null;
  // The worker and POST request share the same Vercel invocation in many cases;
  // use the in-process snapshot first so Blob read/list consistency cannot make
  // a freshly-created job disappear. For separate polling invocations, read the
  // fixed public Blob pathname with useCache:false.
  const cached = memoryJobs.get(id);
  if(cached) return { ...cached };
  for(let attempt=0; attempt<8; attempt++){
    const job = await readJob(id);
    if(job) return job;
    if(attempt<7) await sleep(250 + attempt*200);
  }
  return null;
}

export async function updateJob(id, patch){
  if(!id) return null;
  const job = await getJob(id);
  if(!job) return null;
  const next = Object.assign({}, job, patch || {}, { updatedAt: new Date().toISOString() });
  return saveJob(next);
}

import { saveJobRecord, getJobRecord } from './supabase-store.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const memoryJobs = globalThis.__INOVA_JOB_CACHE__ || (globalThis.__INOVA_JOB_CACHE__ = new Map());

function persistableJob(job){
  return JSON.parse(JSON.stringify(job, (key, value) => {
    if (key === '_localPath' || key === 'musicLocalPath') return undefined;
    return value;
  }));
}

async function writeJob(job){
  const persisted = persistableJob(job);
  await saveJobRecord(persisted);
  memoryJobs.set(job.id, { ...job });
  return { ...job };
}

export async function saveJob(job){
  if(!job?.id) throw new Error('Job tidak valid: id tidak ditemukan.');
  let lastError = null;
  for(let attempt=0;attempt<3;attempt++){
    try{return await writeJob(job);}
    catch(error){lastError=error;if(attempt<2) await sleep(250*(attempt+1));}
  }
  throw lastError || new Error('Gagal menyimpan job ke Supabase.');
}

export async function getJob(id){
  if(!id) return null;
  const cached = memoryJobs.get(id);
  if(cached) return { ...cached };
  for(let attempt=0;attempt<5;attempt++){
    try{
      const job=await getJobRecord(id);
      if(job){memoryJobs.set(id,job);return job;}
    }catch(error){console.error('Supabase job read failed:',error?.message||error);}
    if(attempt<4) await sleep(200+attempt*150);
  }
  return null;
}

// Progress/step chatter remains in memory. Durable structural/status changes
// are written to Supabase Postgres so polling works across Vercel instances.
export async function updateJob(id, patch){
  if(!id) return null;
  const job=await getJob(id);
  if(!job) return null;
  const next=Object.assign({},job,patch||{},{updatedAt:new Date().toISOString()});
  memoryJobs.set(id,{...next});
  const structuralKeys=['scenes','outputUrl','outputPathname','completedAt','error','cancelledAt'];
  const structuralChange=structuralKeys.some(key=>Object.prototype.hasOwnProperty.call(patch||{},key));
  const statusChanged=Object.prototype.hasOwnProperty.call(patch||{},'status') && patch.status!==job.status;
  return (structuralChange||statusChanged) ? saveJob(next) : { ...next };
}

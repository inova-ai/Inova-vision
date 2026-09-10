import { processPipelineJob } from "../../src/services/pipeline.js";

// Modern Netlify background-function configuration. The -background filename
// is kept for backwards compatibility, while this explicit flag makes the
// async invocation unambiguous on current Netlify runtimes.
export const config = { background: true };

export default async (req) => {
  let jobId = "";
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    jobId = String(body.jobId || "").trim();
    if (!jobId) return;

    // Mark the worker as alive immediately. This prevents the UI from sitting
    // at QUEUED when the background invocation has actually started.
    await processPipelineJob(jobId);
  } catch (error) {
    console.error("Background job error", { jobId, error: error?.stack || error?.message || error });
    if (jobId) {
      try {
        const { updateJob } = await import("../../src/services/job-store.js");
        await updateJob(jobId, {
          status: "failed",
          progress: 0,
          step: `Worker render gagal: ${error?.message || "Unknown background worker error"}`
        });
      } catch (persistError) {
        console.error("Failed to persist background worker error", persistError);
      }
    }
  }
};

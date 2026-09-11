
// PWA install support: show a clear in-app install button when the browser exposes
// the install prompt. If the prompt is unavailable, show safe manual instructions.
let deferredInstallPrompt = null;
const INSTALL_DISMISSED_KEY = "inova-install-dismissed-v5";
const installApp = document.querySelector("#installApp");
const installHelp = document.querySelector("#installHelp");
const closeInstallHelp = document.querySelector("#closeInstallHelp");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installApp && localStorage.getItem(INSTALL_DISMISSED_KEY) !== "1") installApp.hidden = false;
});

installApp?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    if (installHelp) installHelp.hidden = false;
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice.outcome === "accepted") installApp.hidden = true;
  deferredInstallPrompt = null;
});

closeInstallHelp?.addEventListener("click", () => {
  installHelp.hidden = true;
  localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  if (installApp) installApp.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  if (installApp) installApp.hidden = true;
  if (installHelp) installHelp.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(err => {
      console.warn("PWA service worker registration failed", err);
    });
  });
}
const photos = document.querySelector("#photos");
const sourceMode = document.querySelector("#sourceMode");
const videoInput = document.querySelector("#sourceVideo");
const videoDrop = document.querySelector("#videoDrop");
const promptInput = document.querySelector("#prompt");
const thumbs = document.querySelector("#thumbs");
const productName = document.querySelector("#productName");
const cta = document.querySelector("#cta");
const music = document.querySelector("#music");
const duration = document.querySelector("#duration");
const videoEngine = document.querySelector("#videoEngine");
const generate = document.querySelector("#generate");
const cancel = document.querySelector("#cancel");
const bar = document.querySelector("#bar");
const renderTitle = document.querySelector("#renderTitle");
const renderStep = document.querySelector("#renderStep");
const engine = document.querySelector("#engine");
const resultBadge = document.querySelector("#resultBadge");
const blueprint = document.querySelector("#blueprint");
const result = document.querySelector("#result");
let selectedStyle = "ugc";
let activeJob = null;
let timer = null;

document.querySelectorAll("#styles button").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#styles button").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    selectedStyle = btn.dataset.style;
  };
});

function updateSourceMode(){
  const editVideo=sourceMode?.value==="video";
  if(videoDrop) videoDrop.hidden=!editVideo;
  if(document.querySelector("#photoDrop")) document.querySelector("#photoDrop").hidden=editVideo;
  if(videoInput) videoInput.required=editVideo;
  if(photos) photos.required=!editVideo;
}
sourceMode?.addEventListener("change",updateSourceMode);
updateSourceMode();

videoInput?.addEventListener("change",()=>{
  const file=videoInput.files?.[0];
  if(!file) return;
  thumbs.innerHTML=`<div class="video-thumb">🎬 ${file.name}</div>`;
});

photos.onchange = () => {
  thumbs.innerHTML = "";
  [...photos.files].slice(0,8).forEach(file => {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    thumbs.appendChild(img);
  });
};

function setProgress(p, title, step, status="RENDERING") {
  bar.style.width = `${p}%`;
  renderTitle.textContent = title;
  renderStep.textContent = step;
  engine.textContent = status;
}

async function poll() {
  if (!activeJob) return;
  try {
    const r = await fetch(`/api/jobs/${activeJob}?t=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache", "Accept": "application/json" } });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Job error");
    const j = data.job;
    setProgress(j.progress || 0, j.status === "completed" ? "Video selesai" : j.status === "composing" ? "Menyusun video final" : "AI sedang bekerja", j.step || "Processing", j.status.toUpperCase());
    if (j.sourcePhotoCount > 1 && j.status !== "completed" && j.status !== "failed") {
      blueprint.textContent = `${j.sourcePhotoCount} foto dianalisis · AI memilih foto + shot plan untuk setiap scene.`;
    }

    if (j.status === "completed") {
      clearInterval(timer);
      cancel.hidden = true;
      generate.disabled = false;
      resultBadge.textContent = "COMPLETED";
      blueprint.textContent = j.sourceType === "video"
        ? `Edit video · ${j.duration || duration.value}s · prompt diterapkan: ${j.customPrompt || "auto"} · format 9:16 · MP4 kompatibel Android/Chrome.`
        : `Style ${j.style || selectedStyle} · ${j.duration || duration.value}s · ${j.sceneCount || "multi"} scene · ${j.sourcePhotoCount||1} foto · engine ${j.engine || "auto"} · prompt + AI shot planning aktif · ${j.productName || "Product"}.`;
      const videoBox = document.querySelector(".video-box");
      if (j.outputUrl) {
        // Use a real <source> element and force the browser to reload the URL.
        // The /api/blob endpoint now returns binary MP4 bytes directly with
        // proper Range/206 support, which is required by Chrome/Android.
        const video = document.createElement("video");
        video.controls = true;
        video.playsInline = true;
        video.preload = "auto";
        video.setAttribute("webkit-playsinline", "true");
        video.style.cssText = "width:100%;height:100%;object-fit:contain;border-radius:14px;background:#000";
        const source = document.createElement("source");
        source.src = `${j.outputUrl}${j.outputUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(j.updatedAt || j.id || Date.now())}`;
        source.type = "video/mp4";
        video.appendChild(source);
        video.addEventListener("loadedmetadata", () => {
          console.log("INOVA MP4 OK", { duration: video.duration, width: video.videoWidth, height: video.videoHeight });
        }, { once: true });
        video.addEventListener("error", async () => {
          console.warn("INOVA MP4 playback error", video.error, source.src);
          try {
            const probe = await fetch(source.src, { method: "HEAD", cache: "no-store" });
            console.warn("INOVA MP4 HEAD", probe.status, probe.headers.get("content-type"), probe.headers.get("content-length"), probe.headers.get("accept-ranges"));
            // One clean retry bypasses stale browser/PWA media state.
            if (!video.dataset.retry) {
              video.dataset.retry = "1";
              const retryUrl = `${j.outputUrl}${j.outputUrl.includes("?") ? "&" : "?"}mediaRetry=${Date.now()}`;
              source.src = retryUrl;
              video.load();
              return;
            }
          } catch (probeError) { console.warn("INOVA MP4 probe failed", probeError); }
          videoBox.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:220px;padding:24px;text-align:center;color:#fff;background:#080808;border-radius:14px"><div><b style="display:block;margin-bottom:8px">Video tidak dapat diputar</b><span>Server media tidak mengirim MP4 secara utuh. Periksa Supabase Storage dan deploy versi terbaru.</span></div></div>`;
        });
        videoBox.replaceChildren(video);
        video.load();
      } else {
        videoBox.textContent = "VIDEO SELESAI";
      }
      if (j.outputUrl) {
        let dl = document.querySelector("#downloadVideo");
        if (!dl) {
          dl = document.createElement("a");
          dl.id = "downloadVideo";
          dl.className = "generate";
          dl.textContent = "⬇ Download MP4";
          dl.target = "_blank";
          dl.rel = "noopener";
          result.querySelector(".result-info").appendChild(dl);
        }
        dl.href = `${j.outputUrl}${j.outputUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(j.updatedAt || j.id || Date.now())}`;
        dl.download = `inova-${j.id}.mp4`;
      }
    }
    if (j.status === "failed") {
      clearInterval(timer);
      cancel.hidden = true;
      generate.disabled = false;
      resultBadge.textContent = "FAILED";
      setProgress(0, "Render gagal", j.step || "Periksa konfigurasi API.", "ERROR");
    }
  } catch (e) {
    clearInterval(timer);
    cancel.hidden = true;
    generate.disabled = false;
    setProgress(0, "Terjadi kesalahan", e.message, "ERROR");
  }
}

generate.onclick = async () => {
  document.querySelector("#downloadVideo")?.remove();
  const editVideo=sourceMode?.value==="video";
  if(editVideo && !videoInput?.files?.length){
    setProgress(0, "Video belum ada", "Upload 1 video yang ingin diedit.", "WAITING");
    return;
  }
  if(!editVideo && !photos.files.length){
    setProgress(0, "Foto belum ada", "Upload minimal 1 foto produk.", "WAITING");
    return;
  }
  const fd = new FormData();
  if(editVideo) fd.append("video", videoInput.files[0]);
  else [...photos.files].slice(0,8).forEach(f => fd.append("photos", f));
  fd.append("productName", productName.value);
  fd.append("style", selectedStyle);
  fd.append("duration", duration.value);
    fd.append("videoEngine", videoEngine?.value || "auto");
  fd.append("cta", cta.value);
  fd.append("customPrompt", promptInput?.value || "");
  if (music.files[0]) fd.append("music", music.files[0]);

  generate.disabled = true;
  cancel.hidden = false;
  resultBadge.textContent = "GENERATING";
  setProgress(4, "Menyiapkan AI", "Mengunggah foto dan membuat creative blueprint...");
  try {
    const r = await fetch("/api/jobs", { method:"POST", body:fd });
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      throw new Error(`Backend mengembalikan respons bukan JSON (HTTP ${r.status}). Cek /api/health dan Vercel Function Logs.`);
    }
    if (!r.ok) throw new Error(data.error || "Gagal membuat job");
    activeJob = data.job.id;
    timer = setInterval(poll, 2500);
    poll();
  } catch(e) {
    generate.disabled = false;
    cancel.hidden = true;
    setProgress(0, "Tidak dapat memulai", e.message, "ERROR");
  }
};

cancel.onclick = async () => {
  if (!activeJob) return;
  await fetch(`/api/jobs/${activeJob}/cancel`, {method:"POST"});
  clearInterval(timer);
  cancel.hidden = true;
  generate.disabled = false;
  setProgress(0, "Render dibatalkan", "Kamu bisa membuat video baru.", "READY");
};

async function refreshHealth() {
  try {
    const r = await fetch(`/api/health?t=${Date.now()}`, { cache: "no-store", headers: { "Accept": "application/json" } });
    const raw = await r.text();
    let x;
    try { x = JSON.parse(raw); } catch {
      throw new Error(`Backend retornou ${r.status} ${r.statusText} em /api/health, mas não enviou JSON. ${raw.slice(0, 120).replace(/\s+/g, " ")}`);
    }
    if (!r.ok) throw new Error(`Backend respondeu HTTP ${r.status}.`);
    if (!x.supabaseStorage) {
      engine.textContent = "SET SUPABASE STORAGE";
      renderStep.textContent = "Supabase belum terhubung. Tambahkan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Vercel.";
    } else {
      engine.textContent = "FREE EDITOR READY";
      renderStep.textContent = x.videoAIConfigured ? "AI Video Wan 2.2 tersedia · Auto akan fallback ke Local Free jika gagal/kuota habis." : "AI Video belum dikonfigurasi · Auto akan memakai Local Free. Tambahkan MAGIC_HOUR_API_KEY di Vercel jika ingin AI Video.";
    }
  } catch (e) {
    engine.textContent = "HEALTH ERROR";
    renderStep.textContent = `Tidak bisa membaca status backend: ${e.message}`;
  }
}
refreshHealth();

// AI Photo 3-View / Triptych -------------------------------------------------
const photoAiGenerate = document.querySelector("#photoAiGenerate");
const photoAiMode = document.querySelector("#photoAiMode");
const photoAiPrompt = document.querySelector("#photoAiPrompt");
const photoAiPreview = document.querySelector("#photoAiPreview");
const photoAiResult = document.querySelector("#photoAiResult");
const photoAiStatus = document.querySelector("#photoAiStatus");

function refreshPhotoAiPreview(){
  const file = photos?.files?.[0];
  if(!file){
    photoAiPreview.innerHTML = "<span>Upload minimal 1 foto di bagian Product Photos di atas.</span>";
    return;
  }
  const url = URL.createObjectURL(file);
  photoAiPreview.innerHTML = "";
  const img = document.createElement("img");
  img.src = url;
  img.alt = "Foto sumber AI 3 View";
  photoAiPreview.appendChild(img);
}
photos?.addEventListener("change", refreshPhotoAiPreview);
refreshPhotoAiPreview();

photoAiGenerate?.addEventListener("click", async () => {
  const file = photos?.files?.[0];
  if(!file){
    photoAiStatus.textContent = "Upload minimal 1 foto produk terlebih dahulu.";
    return;
  }
  photoAiGenerate.disabled = true;
  photoAiStatus.textContent = "AI sedang membuat tiga tampilan yang tetap konsisten. Jangan tutup halaman.";
  photoAiResult.innerHTML = '<div class="photo-ai-empty">AI PROCESSING…<br><small>Menyiapkan 3 view katalog.</small></div>';
  try{
    const fd = new FormData();
    fd.append("photo", file);
    fd.append("mode", photoAiMode?.value || "fashion-triptych");
    fd.append("prompt", photoAiPrompt?.value || "");
    const r = await fetch("/api/photo-triptych", {method:"POST", body:fd});
    const raw = await r.text();
    let data;
    try{ data = JSON.parse(raw); }catch{ throw new Error(`Backend mengembalikan respons bukan JSON (HTTP ${r.status}).`); }
    if(!r.ok) throw new Error(data.error || "AI Photo gagal.");
    if(!data.outputUrl) throw new Error("Hasil AI Photo tidak memiliki URL.");

    const wrap = document.createElement("div");
    wrap.className = "photo-ai-result-wrap";
    const img = document.createElement("img");
    img.src = `${data.outputUrl}${data.outputUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
    img.alt = "Hasil AI Foto 3 View";
    const dl = document.createElement("a");
    dl.className = "generate photo-ai-download";
    dl.href = img.src;
    dl.target = "_blank";
    dl.rel = "noopener";
    const dlExt = (data.outputContentType || "image/jpeg").includes("png") ? "png" : (data.outputContentType || "").includes("webp") ? "webp" : "jpg";
    dl.download = `inova-3-view-${data.id || Date.now()}.${dlExt}`;
    dl.textContent = "⬇ Buka / Simpan Foto 3 View";
    wrap.append(img, dl);
    photoAiResult.replaceChildren(wrap);
    photoAiStatus.textContent = `Selesai · ${data.model || "AI Image Editor"} · tersimpan di Supabase Storage.`;
  }catch(e){
    photoAiResult.innerHTML = '<div class="photo-ai-empty">GAGAL<br><small></small></div>';
    photoAiResult.querySelector("small").textContent = e.message;
    photoAiStatus.textContent = e.message;
  }finally{
    photoAiGenerate.disabled = false;
  }
});

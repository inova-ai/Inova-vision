
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
const thumbs = document.querySelector("#thumbs");
const productName = document.querySelector("#productName");
const cta = document.querySelector("#cta");
const music = document.querySelector("#music");
const duration = document.querySelector("#duration");
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
    const r = await fetch(`/api/jobs/${activeJob}`);
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
      blueprint.textContent = `Style ${j.style || selectedStyle} · ${j.duration || duration.value}s · ${j.sceneCount || "multi"} scene · ${j.sourcePhotoCount||1} foto · AI shot planning aktif · ${j.productName || "Product"}.`;
      const videoBox = document.querySelector(".video-box");
      if (j.outputUrl) {
        // Use a real <source> element and force the browser to reload the URL.
        // The /api/blob endpoint now returns binary MP4 bytes directly with
        // proper Range/206 support, which is required by Chrome/Android.
        const video = document.createElement("video");
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("webkit-playsinline", "true");
        video.style.cssText = "width:100%;height:100%;object-fit:contain;border-radius:14px;background:#000";
        const source = document.createElement("source");
        source.src = `${j.outputUrl}${j.outputUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(j.updatedAt || j.id || Date.now())}`;
        source.type = "video/mp4";
        video.appendChild(source);
        video.addEventListener("error", () => {
          console.warn("MP4 playback error", video.error);
          videoBox.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:220px;padding:24px;text-align:center;color:#fff;background:#080808;border-radius:14px">Video selesai dibuat, tetapi browser belum dapat memutarnya. Tekan <b style="margin:0 5px">Download MP4</b> untuk membuka file.</div>`;
        }, { once: true });
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
        dl.href = j.outputUrl;
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
  if (!photos.files.length) {
    setProgress(0, "Foto belum ada", "Upload minimal 1 foto produk.", "WAITING");
    return;
  }
  const fd = new FormData();
  [...photos.files].slice(0,8).forEach(f => fd.append("photos", f));
  fd.append("productName", productName.value);
  fd.append("style", selectedStyle);
  fd.append("duration", duration.value);
  fd.append("cta", cta.value);
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
      throw new Error(`Backend mengembalikan respons bukan JSON (HTTP ${r.status}). Cek /api/health dan Netlify Function Logs.`);
    }
    if (!r.ok) throw new Error(data.error || "Gagal membuat job");
    activeJob = data.job.id;
    timer = setInterval(poll, 1000);
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
    const r = await fetch(`/api/health?t=${Date.now()}`, { cache: "no-store" });
    const x = await r.json();
    if (!x.blobStorage) {
      engine.textContent = "SET NETLIFY BLOB";
      renderStep.textContent = "Netlify Blobs belum dapat diakses oleh backend. Pastikan site ter-deploy sebagai Netlify Function.";
    } else if (x.scriptAI) {
      engine.textContent = "FREE LOCAL + AI PLAN";
      renderStep.textContent = "Video dirender lokal tanpa Replicate. OpenAI hanya opsional untuk creative planning.";
    } else {
      engine.textContent = "FREE LOCAL READY";
      renderStep.textContent = "100% video engine lokal: FFmpeg + free Edge TTS + script fallback. Replicate tidak diperlukan.";
    }
  } catch (e) {
    engine.textContent = "HEALTH ERROR";
    renderStep.textContent = `Tidak bisa membaca status backend: ${e.message}`;
  }
}
refreshHealth();

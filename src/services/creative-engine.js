const styles = {
  ugc: {
    label: "UGC Natural",
    prompt: "natural creator-style product presentation, authentic handheld feel, realistic lighting, relatable social-commerce energy"
  },
  luxury: {
    label: "Luxury Product",
    prompt: "premium luxury commercial, elegant studio lighting, refined materials, controlled camera movement, high-end product advertising"
  },
  viral: {
    label: "TikTok Viral",
    prompt: "fast social-commerce pacing, dynamic close-ups, energetic camera movement, strong visual hook, modern viral short-video aesthetic"
  },
  cinematic: {
    label: "Cinematic",
    prompt: "cinematic commercial photography, dramatic depth of field, polished camera motion, premium composition, filmic lighting"
  },
  showcase: {
    label: "Product Showcase",
    prompt: "clean product showcase, hero angles, detailed close-ups, smooth camera motion, product-first composition"
  },
  selling: {
    label: "Hard Selling",
    prompt: "high-conversion affiliate advertisement, attention-grabbing opening, product benefits visually emphasized, decisive commercial energy"
  }
};

export function buildCreativePrompt({ style = "ugc", productName = "", duration = 8, cta = "", customPrompt = "", sourceType = "photo" }) {
  const preset = styles[style] || styles.ugc;
  const product = productName?.trim() || "the uploaded product";

  return [
    sourceType === "video"
      ? `Edit the supplied source video into a ${duration}-second vertical social-commerce video while preserving the original subject and important visual details.`
      : `Create a ${duration}-second vertical social-commerce product video using the supplied product image as the visual source.`,
    `Product: ${product}.`,
    `Creative style: ${preset.label}.`,
    preset.prompt + ".",
    "Keep the product identity, shape, branding placement, colors and important physical details consistent with the source image.",
    "Do not invent a different product. Avoid warped logos, extra products, duplicate objects or unreadable packaging.",
    "Use a strong opening visual, then a sequence of attractive product-focused camera movements and close-ups.",
    cta?.trim() ? `End with a clear affiliate call-to-action concept: ${cta.trim()}.` : "End with a natural affiliate call-to-action concept.",
    "No celebrity likeness, no real-person impersonation, no copyrighted source-video recreation.",
    customPrompt?.trim() ? `User edit direction: ${customPrompt.trim()}.` : "",
    "Output should feel native to TikTok/Reels/Shorts and visually polished."
  ].join(" ");
}

export function getStyleList() {
  return Object.entries(styles).map(([id, value]) => ({ id, ...value }));
}


export function buildStoryboard({ productName = "", duration = 15, style = "ugc" }) {
  const total = Math.max(5, Number(duration) || 15);
  // Wan 2.5 scene generation is kept at 5–10 seconds per scene.
  // The total requested duration is therefore split into enough scenes
  // so the final composition stays close to the selected duration.
  const sceneCount = Math.max(1, Math.ceil(total / 10));
  const base = Math.floor(total / sceneCount);
  const remainder = total % sceneCount;

  const names = [
    ["Hook", "Tampilkan produk dengan opening visual paling menarik."],
    ["Product Reveal", "Perlihatkan bentuk, kemasan, tekstur, atau detail utama produk."],
    ["Benefit", "Visualisasikan manfaat utama produk tanpa membuat klaim medis/berlebihan."],
    ["Detail", "Close-up detail produk dengan camera movement yang halus."],
    ["Lifestyle", "Tempatkan produk dalam konteks penggunaan yang relevan."],
    ["Proof", "Tekankan alasan produk menarik untuk dibeli melalui visual product-first."],
    ["Offer", "Bangun momentum menuju keputusan pembelian."],
    ["CTA", "Tutup dengan call-to-action affiliate yang jelas."]
  ];

  return Array.from({length: sceneCount}, (_, i) => {
    const seconds = base + (i < remainder ? 1 : 0);
    const sceneName = names[Math.min(i, names.length - 1)];
    return {
      scene: i + 1,
      title: sceneName[0],
      duration: Math.max(5, Math.min(10, seconds)),
      direction: `${sceneName[1]} Style: ${style}. Product: ${productName || "uploaded product"}.`
    };
  });
}

export function buildSceneScript({ productName = "", style = "ugc", cta = "", scene }) {
  const product = productName || "produk ini";
  const scripts = {
    Hook: `Stop scroll dulu. ${product} ini menarik banget dilihat dari dekat.`,
    "Product Reveal": `Kenalan dengan ${product}, dibuat untuk kamu yang ingin tampil lebih praktis dan menarik.`,
    Benefit: `Yang paling menarik, detail produknya dibuat untuk membantu pengalaman penggunaan jadi lebih nyaman.`,
    Detail: `Lihat detailnya. Tekstur, bentuk, dan finishing produknya terlihat jelas.`,
    Lifestyle: `${product} juga cocok dimasukkan ke rutinitas harian tanpa terlihat berlebihan.`,
    Proof: `Kalau kamu sedang mencari produk seperti ini, bagian detailnya layak kamu perhatikan.`,
    Offer: `Kalau cocok dengan kebutuhanmu, ini bisa jadi salah satu pilihan yang patut dipertimbangkan.`,
    CTA: cta?.trim() || `Cek produknya sekarang dan lihat detailnya di keranjang.`
  };
  return scripts[scene.title] || `Ini ${product}. Lihat detail dan keunggulannya dari dekat.`;
}

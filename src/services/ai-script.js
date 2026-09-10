const fallbackScript = ({ productName, cta, scene }) => {
  const product = productName?.trim() || "produk ini";
  const map = {
    Hook: `Stop scroll dulu. ${product} ini menarik banget dilihat dari dekat.`,
    "Product Reveal": `Kenalan dengan ${product}. Tampilannya rapi, detailnya jelas, dan cocok untuk konten affiliate.`,
    Benefit: `Yang paling menarik adalah detail produk yang membuat pengalaman pengguna terasa lebih praktis.`,
    Detail: `Lihat lebih dekat. Bentuk, tekstur, dan finishing ${product} terlihat jelas.`,
    Lifestyle: `${product} mudah dimasukkan ke rutinitas harian dan tetap terlihat natural.`,
    Proof: `Kalau kamu sedang mencari produk seperti ini, detail dan tampilannya layak kamu perhatikan.`,
    Offer: `Kalau sesuai kebutuhanmu, ini bisa jadi pilihan yang menarik untuk dipertimbangkan.`,
    CTA: cta?.trim() || `Cek produknya sekarang dan lihat detailnya di keranjang.`
  };
  return map[scene.title] || `Ini ${product}. Lihat detailnya dan tentukan apakah cocok untuk kebutuhanmu.`;
};

const fallbackShot = (scene, style) => {
  const plans = {
    Hook: ["hero","slow push-in","product centered, strongest visible angle","premium clean light","attention grab in first second"],
    "Product Reveal": ["hero","gentle orbit","show complete product and packaging","soft commercial light","reveal"],
    Benefit: ["medium","slow pan","show product in natural context without inventing features","natural light","clear benefit"],
    Detail: ["macro","controlled push-in","texture, finish, label or construction detail","directional soft light","detail emphasis"],
    Lifestyle: ["medium","smooth tracking","product in believable everyday context","natural warm light","relatable"],
    Proof: ["close-up","micro orbit","best evidence visible in the photo","clean contrast light","trust"],
    Offer: ["hero","subtle pull-back","complete product with clean negative space","bright commercial light","purchase momentum"],
    CTA: ["hero","locked-off","product stable and unobstructed","premium clean light","final product hold"]
  };
  const p=plans[scene.title]||plans.Hook;
  return {shotType:p[0],cameraMovement:p[1],composition:p[2],lighting:p[3],pacing:p[4],style};
};

export async function generateCreativePlan({ productName, style, cta, storyboard, imageDataUris=[], imageUrls=[], sourcePhotoCount=1 }) {
  const fallback = storyboard.map((scene,i)=>({
    script:fallbackScript({productName,cta,scene}),
    imageIndex:Math.min(i,sourcePhotoCount-1),
    shot:fallbackShot(scene,style)
  }));
  if (!process.env.OPENAI_API_KEY) return fallback;

  const model=process.env.OPENAI_SCRIPT_MODEL||"gpt-5-mini";
  const media=imageUrls.map(url=>({type:"input_image",image_url:url}));
  if(!media.length) for(const uri of imageDataUris) media.push({type:"input_image",image_url:uri});
  const prompt=`Bertindak sebagai AI Product Understanding + Director of Photography untuk video affiliate Indonesia.
Ada ${sourcePhotoCount} foto produk bernomor 0..${sourcePhotoCount-1}. Analisis SEMUA foto secara visual. Jangan mengarang fitur/spesifikasi yang tidak terlihat.
Untuk setiap scene tentukan:
- script: voice-over natural Bahasa Indonesia, maksimal 24 kata
- imageIndex: foto paling cocok untuk scene
- shotType: hero|medium|close-up|macro
- cameraMovement: locked-off|slow push-in|pull-back|left-to-right pan|right-to-left pan|gentle orbit|smooth tracking|micro orbit
- composition: framing yang menjaga produk utuh dan identitas tetap konsisten
- lighting: gaya pencahayaan realistis sesuai produk
- pacing: tujuan ritme scene
Gunakan gerakan kamera yang realistis dan sederhana; jangan meminta kamera bergerak menembus produk. Produk harus tetap sama, logo/teks tidak berubah.
Style: ${style}. Produk: ${productName||"produk pada foto"}. CTA: ${cta||"ajak cek produk di keranjang"}.
Scene: ${storyboard.map((s,i)=>`${i}: ${s.title} — ${s.direction}`).join(" | ")}
Balas JSON VALID persis {"scenes":[{"script":"","imageIndex":0,"shotType":"","cameraMovement":"","composition":"","lighting":"","pacing":""}]} dengan ${storyboard.length} item.`;

  try {
    const r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model,input:[{role:"user",content:[{type:"input_text",text:prompt},...media]}]})
    });
    if(!r.ok) throw new Error(`OpenAI creative plan HTTP ${r.status}`);
    const data=await r.json();
    const text=data.output_text||data.output?.flatMap(x=>x.content||[]).map(x=>x.text||"").join("")||"";
    const clean=text.replace(/^```json\s*/i,"").replace(/```$/i,"").trim();
    const parsed=JSON.parse(clean);
    if(!Array.isArray(parsed.scenes)||parsed.scenes.length!==storyboard.length) throw new Error("Creative plan format invalid");
    return parsed.scenes.map((x,i)=>{
      const f=fallback[i];
      return {
        script:String(x.script||f.script).trim().split(/\s+/).slice(0,24).join(" "),
        imageIndex:Math.max(0,Math.min(sourcePhotoCount-1,Number.isInteger(Number(x.imageIndex))?Number(x.imageIndex):f.imageIndex)),
        shot:{
          shotType:String(x.shotType||f.shot.shotType),
          cameraMovement:String(x.cameraMovement||f.shot.cameraMovement),
          composition:String(x.composition||f.shot.composition),
          lighting:String(x.lighting||f.shot.lighting),
          pacing:String(x.pacing||f.shot.pacing),
          style
        }
      };
    });
  } catch(e) {
    console.warn("Creative plan fallback:",e.message);
    return fallback;
  }
}

export async function generateScripts(args) {
  return generateCreativePlan(args);
}

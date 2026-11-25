import { useCallback, useEffect, useRef, useState } from "react";
import { T, btnBase, inputBase, labelStyle } from "../theme";
import { Banner, Empty, Icon, Icons, SmallBtn } from "../components/common";
import { chatOnce, extractJson, modelOptions } from "../lib/ollama";
import { imgAll, imgDelete, imgPut } from "../lib/idb";
import { downloadDataUrl, readFileAsDataUrl } from "../lib/download";
import { clip, uid } from "../lib/util";

// ═══════════════════════════════════════════════════════════════
// Imagine AI: text or image in, image out.
//
// Image engine: a local Stable Diffusion WebUI (AUTOMATIC1111 or Forge) started
// with --api. Ollama is used around it: it rewrites your idea into a detailed
// prompt and, with a vision model, describes an uploaded picture.
// ═══════════════════════════════════════════════════════════════

const SIZES = [
  { label: "512 × 512", w: 512, h: 512 },
  { label: "768 × 768", w: 768, h: 768 },
  { label: "1024 × 1024", w: 1024, h: 1024 },
  { label: "768 × 512 (landscape)", w: 768, h: 512 },
  { label: "512 × 768 (portrait)", w: 512, h: 768 },
  { label: "1024 × 576 (16:9)", w: 1024, h: 576 },
];
const STYLES = ["photorealistic", "cinematic lighting", "studio photo", "anime", "watercolor", "oil painting", "3D render", "pixel art"];
const DEFAULT_NEGATIVE = "blurry, low quality, deformed, extra fingers, watermark, text";
const VISION_HINT = /llava|vision|bakllava|moondream|minicpm-v|gemma3|qwen2\.5vl|qwen3-vl|-vl/i;
const MAX_GALLERY = 60;

const toMultiple8 = (n) => Math.max(256, Math.round(n / 8) * 8);

// Downscale big uploads so requests stay small.
async function prepareImage(file) {
  const src = await readFileAsDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("That file is not a readable image"));
    i.src = src;
  });
  const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), width: w, height: h, name: file.name || "pasted image" };
}

const b64 = (dataUrl) => dataUrl.split(",")[1] || "";

async function sdError(resp) {
  try {
    const t = await resp.text();
    try {
      const j = JSON.parse(t);
      return j.error || j.detail?.toString() || j.errors || t;
    } catch {
      return t;
    }
  } catch {
    return `HTTP ${resp.status}`;
  }
}

export default function ImagineView({ settings, selectedModel, connected, models }) {
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState(DEFAULT_NEGATIVE);
  const [initImage, setInitImage] = useState(null);
  const [strength, setStrength] = useState(0.6);
  const [sizeIdx, setSizeIdx] = useState(0); // -1 = match input image
  const [steps, setSteps] = useState(25);
  const [cfg, setCfg] = useState(7);
  const [seed, setSeed] = useState(-1);
  const [count, setCount] = useState(1);
  const [sampler, setSampler] = useState("Euler a");
  const [checkpoint, setCheckpoint] = useState("");
  const [checkpoints, setCheckpoints] = useState([]);
  const [engine, setEngine] = useState("checking"); // checking | online | offline
  const [enhance, setEnhance] = useState(true);
  const [visionModel, setVisionModel] = useState("");
  const [gallery, setGallery] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [progress, setProgress] = useState({ frac: 0, label: "" });
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const abortRef = useRef(null);

  const sd = (settings.sdUrl || "").trim().replace(/\/+$/, "");

  // ── engine status ──
  const checkEngine = useCallback(async () => {
    setEngine("checking");
    try {
      const resp = await fetch(`${sd}/sdapi/v1/sd-models`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const list = await resp.json();
      setCheckpoints(Array.isArray(list) ? list.map((m) => m.title).filter(Boolean) : []);
      setEngine("online");
    } catch {
      setEngine("offline");
      setCheckpoints([]);
    }
  }, [sd]);

  useEffect(() => {
    const t = setTimeout(checkEngine, 500);
    return () => clearTimeout(t);
  }, [checkEngine]);

  useEffect(() => {
    imgAll()
      .then((list) => setGallery(list.sort((a, b) => b.createdAt - a.createdAt)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!visionModel) setVisionModel(models.find((m) => VISION_HINT.test(m)) || selectedModel || "");
  }, [models, selectedModel, visionModel]);

  // ── input image ──
  const loadFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      setInitImage(await prepareImage(file));
      setSizeIdx(-1);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      loadFile(item.getAsFile());
    }
  };

  const describeImage = async () => {
    if (!initImage || !connected || !visionModel) return;
    setDescribing(true);
    setError(null);
    try {
      const text = await chatOnce({
        base: settings.ollamaUrl,
        model: visionModel,
        options: modelOptions(settings, { temperature: 0.3 }),
        messages: [{
          role: "user",
          content: "Describe this image as a single detailed prompt for an image generator: subject, setting, colours, style, lighting, composition. English, under 70 words, no preamble.",
          images: [b64(initImage.dataUrl)],
        }],
      });
      const d = text.trim().replace(/^["']|["']$/g, "");
      setPrompt((p) => (p.trim() ? `${p.trim()}, ${d}` : d));
    } catch (e) {
      setError(`Could not describe the image with ${visionModel}: ${e.message}. Pick a vision model such as llava, gemma3 or qwen2.5vl.`);
    }
    setDescribing(false);
  };

  // ── generation ──
  const enhancePrompt = async (text, hasImage) => {
    const out = await chatOnce({
      base: settings.ollamaUrl,
      model: selectedModel,
      format: "json",
      options: modelOptions(settings, { temperature: 0.7 }),
      messages: [
        {
          role: "system",
          content: `You write prompts for Stable Diffusion image generation. ${hasImage ? "The user gives an instruction for editing a picture. Rewrite it as a prompt describing the desired final image." : "Expand the user's idea into one detailed prompt."} Include subject, setting, style, lighting and quality keywords, in English, under 70 words. Reply with JSON only: {"prompt": "...", "negative": "..."} where negative lists things to avoid.`,
        },
        { role: "user", content: text },
      ],
    });
    const j = extractJson(out);
    return { prompt: String(j?.prompt || text), negative: String(j?.negative || "") };
  };

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setProgress({ frac: 0, label: "Preparing…" });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let poll;
    try {
      let finalPrompt = prompt.trim();
      let finalNegative = negative;
      if (enhance && connected && selectedModel) {
        setProgress({ frac: 0, label: `Improving the prompt with ${selectedModel}…` });
        try {
          const e = await enhancePrompt(finalPrompt, !!initImage);
          finalPrompt = e.prompt;
          if (e.negative) finalNegative = `${negative}${negative ? ", " : ""}${e.negative}`;
        } catch {
          /* fall back to the raw prompt */
        }
      }

      const size = sizeIdx >= 0 || !initImage
        ? SIZES[Math.max(0, sizeIdx)]
        : (() => {
            const s = Math.min(1, 768 / Math.max(initImage.width, initImage.height));
            return { w: toMultiple8(initImage.width * s), h: toMultiple8(initImage.height * s) };
          })();

      const payload = {
        prompt: finalPrompt,
        negative_prompt: finalNegative,
        steps,
        cfg_scale: cfg,
        width: size.w,
        height: size.h,
        seed: Number.isFinite(seed) ? seed : -1,
        sampler_name: sampler,
        n_iter: count,
        batch_size: 1,
        ...(checkpoint ? { override_settings: { sd_model_checkpoint: checkpoint } } : {}),
        ...(initImage ? { init_images: [b64(initImage.dataUrl)], denoising_strength: strength, resize_mode: 0 } : {}),
      };

      poll = setInterval(async () => {
        try {
          const r = await fetch(`${sd}/sdapi/v1/progress?skip_current_image=true`);
          const p = await r.json();
          const st = p.state || {};
          const jobs = Math.max(1, st.job_count || count);
          const frac = Math.min(1, ((st.job_no || 0) + (p.progress || 0)) / jobs);
          setProgress({ frac, label: `Step ${st.sampling_step || 0} of ${st.sampling_steps || steps} · image ${Math.min(jobs, (st.job_no || 0) + 1)} of ${jobs}` });
        } catch {}
      }, 800);

      setProgress({ frac: 0, label: "Sending to the image engine…" });
      const resp = await fetch(`${sd}/sdapi/v1/${initImage ? "img2img" : "txt2img"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new Error(`Image engine error (${resp.status}): ${await sdError(resp)}`);
      const data = await resp.json();
      let info = {};
      try { info = JSON.parse(data.info || "{}"); } catch {}

      // When generating several images the engine may prepend a grid image.
      const imgs = (data.images || []).length > count ? data.images.slice(-count) : data.images || [];
      const seeds = info.all_seeds || [];
      const made = imgs.map((b, i) => ({
        id: uid() + Date.now().toString(36),
        createdAt: Date.now() + i,
        prompt: prompt.trim(),
        finalPrompt,
        negative: finalNegative,
        mode: initImage ? "img2img" : "txt2img",
        seed: seeds[i] ?? info.seed ?? -1,
        width: size.w,
        height: size.h,
        steps,
        cfg,
        dataUrl: `data:image/png;base64,${b}`,
      }));
      for (const item of made) await imgPut(item).catch(() => {});
      setGallery((g) => {
        const next = [...made.reverse(), ...g];
        next.slice(MAX_GALLERY).forEach((old) => imgDelete(old.id).catch(() => {}));
        return next.slice(0, MAX_GALLERY);
      });
    } catch (e) {
      if (e.name === "AbortError") {
        /* stopped by user */
      } else if (e instanceof TypeError) {
        setEngine("offline");
        setError(`Could not reach the image engine at ${sd}. Start Stable Diffusion WebUI with --api and --cors-allow-origins (see the setup box), then press Re-check.`);
      } else {
        setError(e.message);
      }
    } finally {
      clearInterval(poll);
      setGenerating(false);
      setProgress({ frac: 0, label: "" });
    }
  };

  const stop = async () => {
    abortRef.current?.abort();
    try { await fetch(`${sd}/sdapi/v1/interrupt`, { method: "POST" }); } catch {}
  };

  const removeImage = (id) => {
    imgDelete(id).catch(() => {});
    setGallery((g) => g.filter((x) => x.id !== id));
    setPreview((p) => (p?.id === id ? null : p));
  };

  const sendToInput = (item) => {
    setInitImage({ dataUrl: item.dataUrl, width: item.width, height: item.height, name: "generated image" });
    setSizeIdx(-1);
    setPreview(null);
  };

  const reuse = (item) => {
    setPrompt(item.prompt);
    setNegative(item.negative || DEFAULT_NEGATIVE);
    setSeed(item.seed ?? -1);
    setSteps(item.steps || 25);
    setCfg(item.cfg || 7);
    setPreview(null);
  };

  const toggleStyle = (s) =>
    setPrompt((p) => {
      if (p.toLowerCase().includes(s)) return p.replace(new RegExp(`,?\\s*${s}`, "i"), "").trim();
      return p.trim() ? `${p.trim()}, ${s}` : s;
    });

  const canGenerate = prompt.trim() && engine !== "offline" && !generating;

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Controls */}
      <div style={{ width: 360, borderRight: `1px solid ${T.border}`, padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
        <div>
          <label style={labelStyle}>{initImage ? "Instruction for the picture" : "Describe the image"}</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={onPaste}
            rows={4}
            placeholder={initImage ? "e.g. turn it into a rainy night scene" : "e.g. a lighthouse on a cliff at sunrise, misty sea"}
            style={{ ...inputBase, fontSize: 12, resize: "vertical", lineHeight: 1.5 }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
            {STYLES.map((s) => {
              const on = prompt.toLowerCase().includes(s);
              return (
                <button key={s} onClick={() => toggleStyle(s)} style={{ ...btnBase, fontSize: 10, padding: "3px 8px", background: on ? T.accentGlow : T.surfaceAlt, border: `1px solid ${on ? T.accent : T.border}`, color: on ? T.accentSoft : T.textMuted }}>{s}</button>
              );
            })}
          </div>
        </div>

        {/* Input image */}
        <div>
          <label style={labelStyle}>Input image (optional)</label>
          {initImage ? (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surfaceAlt }}>
              <img src={initImage.dataUrl} alt="input" style={{ width: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 6, display: "block" }} />
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                <SmallBtn onClick={describeImage} disabled={describing || !connected}>{describing ? "Describing…" : "Describe with AI"}</SmallBtn>
                <SmallBtn onClick={() => { setInitImage(null); setSizeIdx(0); }} color={T.red}>Remove</SmallBtn>
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={{ ...labelStyle, textTransform: "none", letterSpacing: 0 }}>Change strength: {strength.toFixed(2)} (low keeps the original, high reimagines it)</label>
                <input type="range" min="0.05" max="1" step="0.05" value={strength} onChange={(e) => setStrength(+e.target.value)} style={{ width: "100%" }} />
              </div>
              <div style={{ marginTop: 6 }}>
                <label style={{ ...labelStyle, textTransform: "none", letterSpacing: 0 }}>Vision model for "Describe"</label>
                <select value={visionModel} onChange={(e) => setVisionModel(e.target.value)} style={{ ...inputBase, fontSize: 11, padding: "5px 8px", cursor: "pointer" }}>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files?.[0]); }}
              style={{ border: `1px dashed ${dragOver ? T.accent : T.borderLight}`, background: dragOver ? T.accentGlow : "transparent", borderRadius: 10, padding: "18px 10px", textAlign: "center", cursor: "pointer", color: T.textMuted, fontSize: 11, lineHeight: 1.6 }}
            >
              <Icon d={Icons.upload} size={18} color={T.textMuted} />
              <div>Drop an image, click to browse, or paste</div>
              <div style={{ color: T.textDim }}>It becomes the starting point for the new image</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        <label style={{ display: "flex", gap: 8, fontSize: 11, color: T.textMuted, cursor: connected ? "pointer" : "default", lineHeight: 1.5, opacity: connected ? 1 : 0.5 }}>
          <input type="checkbox" checked={enhance && connected} disabled={!connected} onChange={(e) => setEnhance(e.target.checked)} style={{ marginTop: 2 }} />
          Improve my prompt with {selectedModel || "the chat model"} before generating
        </label>

        {/* Settings */}
        <details style={{ border: `1px solid ${T.border}`, borderRadius: 10, background: T.surfaceAlt }}>
          <summary style={{ cursor: "pointer", padding: "8px 12px", fontSize: 12, color: T.textMuted }}>Image settings</summary>
          <div style={{ padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={labelStyle}>Size</label>
              <select value={sizeIdx} onChange={(e) => setSizeIdx(+e.target.value)} style={{ ...inputBase, fontSize: 12, padding: "6px 8px", cursor: "pointer" }}>
                {initImage && <option value={-1}>Match input image</option>}
                {SIZES.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
              </select>
              <div style={{ fontSize: 10, color: T.textDim, marginTop: 3 }}>SD 1.5 models like 512; SDXL models like 1024.</div>
            </div>
            {checkpoints.length > 0 && (
              <div>
                <label style={labelStyle}>Checkpoint</label>
                <select value={checkpoint} onChange={(e) => setCheckpoint(e.target.value)} style={{ ...inputBase, fontSize: 11, padding: "6px 8px", cursor: "pointer" }}>
                  <option value="">Engine default</option>
                  {checkpoints.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}><label style={labelStyle}>Steps</label><input type="number" min={5} max={80} value={steps} onChange={(e) => setSteps(Math.min(80, Math.max(5, +e.target.value || 25)))} style={{ ...inputBase, fontSize: 12, padding: "6px 8px" }} /></div>
              <div style={{ flex: 1 }}><label style={labelStyle}>Guidance</label><input type="number" min={1} max={20} step={0.5} value={cfg} onChange={(e) => setCfg(Math.min(20, Math.max(1, +e.target.value || 7)))} style={{ ...inputBase, fontSize: 12, padding: "6px 8px" }} /></div>
              <div style={{ flex: 1 }}><label style={labelStyle}>Images</label><input type="number" min={1} max={4} value={count} onChange={(e) => setCount(Math.min(4, Math.max(1, +e.target.value || 1)))} style={{ ...inputBase, fontSize: 12, padding: "6px 8px" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}><label style={labelStyle}>Seed (-1 random)</label><input type="number" value={seed} onChange={(e) => setSeed(Number.isFinite(+e.target.value) ? Math.trunc(+e.target.value) : -1)} style={{ ...inputBase, fontSize: 12, padding: "6px 8px" }} /></div>
              <div style={{ flex: 1 }}><label style={labelStyle}>Sampler</label><input value={sampler} onChange={(e) => setSampler(e.target.value)} style={{ ...inputBase, fontSize: 12, padding: "6px 8px" }} /></div>
            </div>
            <div>
              <label style={labelStyle}>Negative prompt</label>
              <textarea value={negative} onChange={(e) => setNegative(e.target.value)} rows={2} style={{ ...inputBase, fontSize: 11, resize: "vertical" }} />
            </div>
          </div>
        </details>

        {generating ? (
          <button onClick={stop} style={{ ...btnBase, background: T.red, color: "#fff", padding: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon d={Icons.stop} size={14} color="#fff" /> Stop
          </button>
        ) : (
          <button onClick={generate} disabled={!canGenerate} style={{ ...btnBase, background: canGenerate ? T.accent : T.border, color: "#fff", padding: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: canGenerate ? 1 : 0.5 }}>
            <Icon d={Icons.image} size={14} color="#fff" /> {initImage ? "Transform image" : "Generate"}
          </button>
        )}
        {error && <Banner onClose={() => setError(null)}>{error}</Banner>}
      </div>

      {/* Gallery */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: engine === "online" ? T.green : engine === "offline" ? T.red : T.orange }} />
          <span style={{ color: T.textMuted }}>Image engine: {engine === "online" ? "connected" : engine === "offline" ? "not reachable" : "checking…"} · {sd}</span>
          <SmallBtn onClick={checkEngine}>Re-check</SmallBtn>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {engine === "offline" && (
            <div style={{ background: "rgba(255,159,67,0.07)", border: `1px solid ${T.orange}40`, borderRadius: 12, padding: 16, marginBottom: 16, fontSize: 12, lineHeight: 1.7, color: T.textMuted }}>
              <div style={{ color: T.orange, fontWeight: 700, marginBottom: 6 }}>Set up the image engine (one time)</div>
              Ollama generates text, so Imagine AI uses a local Stable Diffusion WebUI for the pictures. Ollama's own image models are macOS-only for now.
              <ol style={{ margin: "8px 0 0 18px" }}>
                <li>Install <strong style={{ color: T.text }}>AUTOMATIC1111</strong> or <strong style={{ color: T.text }}>Stable Diffusion WebUI Forge</strong> (needs an NVIDIA GPU with 6 GB+ for comfortable use).</li>
                <li>Open <code>webui-user.bat</code> and set <code>set COMMANDLINE_ARGS=--api --cors-allow-origins=http://localhost:3000</code></li>
                <li>Run <code>webui-user.bat</code>, wait for "Running on local URL", then press Re-check.</li>
              </ol>
              <div style={{ marginTop: 8 }}>Using the desktop (Electron) build? Use <code>--cors-allow-origins=*</code> instead.</div>
            </div>
          )}

          {generating && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, marginBottom: 16, background: T.surface }}>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>{progress.label || "Working…"}</div>
              <div style={{ height: 6, borderRadius: 3, background: T.surfaceAlt, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.max(4, progress.frac * 100)}%`, background: `linear-gradient(90deg, ${T.accent}, ${T.green})`, transition: "width 0.4s ease" }} />
              </div>
            </div>
          )}

          {gallery.length === 0 && !generating && engine !== "offline" && (
            <Empty glyph="◐" title="Imagine AI">Describe a picture, or drop in an image and say how to change it. Results are kept in this browser.</Empty>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14 }}>
            {gallery.map((g) => (
              <div key={g.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
                <img src={g.dataUrl} alt={g.prompt} onClick={() => setPreview(g)} style={{ width: "100%", display: "block", cursor: "zoom-in", aspectRatio: `${g.width} / ${g.height}`, objectFit: "cover" }} />
                <div style={{ padding: 10 }}>
                  <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.4, minHeight: 30 }}>{clip(g.prompt, 90)}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                    <SmallBtn onClick={() => downloadDataUrl(`imagine-${g.id}.png`, g.dataUrl)} title="Download"><Icon d={Icons.download} size={11} color={T.textMuted} /></SmallBtn>
                    <SmallBtn onClick={() => sendToInput(g)} title="Use as the input image">Edit</SmallBtn>
                    <SmallBtn onClick={() => reuse(g)} title="Reuse prompt and seed">Reuse</SmallBtn>
                    <SmallBtn onClick={() => removeImage(g.id)} color={T.red} title="Delete"><Icon d={Icons.trash} size={11} color={T.red} /></SmallBtn>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div onMouseDown={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: "min(960px, 100%)", maxHeight: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
            <img src={preview.dataUrl} alt={preview.prompt} style={{ maxWidth: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: 10 }} />
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, fontSize: 11, color: T.textMuted, lineHeight: 1.6, overflowY: "auto", maxHeight: "20vh" }}>
              <div><strong style={{ color: T.text }}>Prompt sent:</strong> {preview.finalPrompt}</div>
              <div>{preview.mode} · {preview.width}×{preview.height} · {preview.steps} steps · guidance {preview.cfg} · seed {preview.seed}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

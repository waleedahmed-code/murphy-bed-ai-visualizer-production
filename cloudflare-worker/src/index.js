/**
 * Island Murphy Beds — AI Room Visualizer Worker (FLUX.2 [klein] 9B on Workers AI)
 *
 * The CLOSED view is composed in the browser from the builder's exact bed image.
 * This Worker only makes the OPEN view.
 *
 * POST /api/generate-room-render (multipart/form-data)   <- used by the theme (v7)
 *   scene     close-up of the customer's room with the exact configured bed placed (< 512 px)
 *   seed, size, doorStyle, crown, finish, leftCabinet, rightCabinet   optional
 *   product   exact configured bed front (< 512 px)          width, height: AI output size
 *   → FLUX.2 klein edit (4B, then 9B as backup): the whole close-up, product included,
 *     is re-rendered photorealistically (wood texture, light, shadows) keeping its design.
 *
 * POST /api/generate-open-view   (multipart/form-data)   open bed (bedState defaults to "open")
 *   scene     room photo with the exact CLOSED bed already placed (< 512 px each side)
 *   product   exact configured bed front from #preview-stage (< 512 px)
 *   width, height (256–1920, rounded to 16), seed (optional)
 *   size, doorStyle, crown, finish, leftCabinet, rightCabinet, mattress   optional text
 *
 * POST /api/generate-room-bed    same, but "room" = empty room; the AI places the bed itself.
 *
 * Fixed references attached by the Worker (never sent by the customer), from reference-images/:
 *   input_image_2 = open-example.jpg (your bed open, front view)  — or mechanism.jpg as fallback
 *   input_image_3 = mattress.jpg
 *
 * POST /api/generate-room-preview  (LEGACY v1 — only for an old cached theme script)
 * GET  /api/health
 */

const DEFAULT_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
// Refine pass (used by the theme): SDXL image-to-image at low strength keeps the
// placed bed's shape and design but re-renders light, texture and shadows.
const DEFAULT_REFINE_MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";
// Refine models tried in order (live self-test 2026-10-05: SDXL no longer accepts an input
// image (3030) and SD 1.5 img2img is not allowed on this account (5018), so both are dropped).
// FLUX.2 klein 4B ≈ 26 neurons per output 512px tile → ~115 neurons per 1024px image
// (~80+ images/day in the free 10,000). 9B ≈ 1,400+ neurons per image (~6–7/day) = backup.
// Override with the Worker variable REFINE_MODELS (comma separated).
const DEFAULT_REFINE_CHAIN = ["@cf/black-forest-labs/flux-2-klein-4b", "@cf/black-forest-labs/flux-2-klein-9b"];
const VERSION = "2026-10-05-v11-flux-refine";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCE_INPUT_BYTES = 3 * 1024 * 1024;
// Workers AI: "All input images must be smaller than 512x512."
const MAX_INPUT_EDGE = 511;
const VALID_TYPES = ["image/jpeg", "image/png", "image/webp"];
// open-example = a real photo of YOUR bed open, seen from the front (strongest guide).
// mechanism is used only when open-example is missing.
const REFERENCE_NAMES = ["open-example", "mattress", "mechanism"];
const REFERENCE_EXTENSIONS = [
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"]
];

/* ---------- origin handling (supports https://*.example.com) ---------- */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function originMatches(origin, pattern) {
  if (!origin) return false;
  if (pattern === origin) return true;
  if (!pattern.includes("*")) return false;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[a-z0-9-]+(?:\\.[a-z0-9-]+)*");
  return new RegExp(`^${escaped}$`, "i").test(origin);
}

function isAllowedOrigin(origin, env) {
  return allowedOrigins(env).some((pattern) => originMatches(origin, pattern));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Visualizer-Seed, X-Visualizer-Version, X-Visualizer-Model",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (isAllowedOrigin(origin, env)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(request, env, body, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request, env) });
}

function cleanText(value, maxLength = 140) {
  return String(value || "")
    .replace(/[\r\n<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function dimension(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(1920, Math.max(256, Math.round(n / 16) * 16));
}

function seedValue(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return n % 2147483647;
}

/* ---------- image header parsing (no decoding, just width/height) ---------- */
export function imageDimensions(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 24) return null;

  // PNG: IHDR width/height at bytes 16..23
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20), type: "image/png" };
  }

  // JPEG: walk markers to the first SOF segment
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = (b[i + 2] << 8) | b[i + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], type: "image/jpeg" };
      }
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }

  // WebP (RIFF....WEBP)
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 && b.length >= 30) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8 ") {
      return { width: ((b[27] << 8) | b[26]) & 0x3fff, height: ((b[29] << 8) | b[28]) & 0x3fff, type: "image/webp" };
    }
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, type: "image/webp" };
    }
    if (chunk === "VP8X") {
      return {
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
        type: "image/webp"
      };
    }
  }
  return null;
}

function checkModelInput(bytes, label) {
  const dims = imageDimensions(bytes);
  if (!dims) return `${label} could not be read as JPG, PNG or WebP.`;
  if (dims.width > MAX_INPUT_EDGE || dims.height > MAX_INPUT_EDGE) {
    return `${label} is ${dims.width}×${dims.height}; the AI model needs each input under 512×512.`;
  }
  return "";
}

/* ---------- fixed backend references (Workers Static Assets, private) ---------- */
// Assets are immutable per deployment, so a healthy set is cached per binding/isolate.
const referenceCache = new WeakMap();

async function loadReference(env, name) {
  if (!env.REFERENCES || typeof env.REFERENCES.fetch !== "function") {
    return { ok: false, name, error: "REFERENCES assets binding is missing from wrangler.jsonc." };
  }
  for (const [ext, type] of REFERENCE_EXTENSIONS) {
    const file = `${name}.${ext}`;
    const response = await env.REFERENCES.fetch(new Request(`https://references.internal/${file}`));
    if (!response.ok) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const dims = imageDimensions(bytes);
    const problem = checkModelInput(bytes, `Reference ${file}`);
    return {
      ok: !problem,
      name,
      file,
      type: (dims && dims.type) || type,
      width: dims ? dims.width : null,
      height: dims ? dims.height : null,
      bytesLength: bytes.length,
      bytes,
      error: problem || undefined
    };
  }
  return { ok: false, name, error: `reference-images/${name}.jpg (or .png/.webp) was not deployed.` };
}

async function loadReferences(env) {
  const binding = env.REFERENCES;
  if (binding && typeof binding === "object" && referenceCache.has(binding)) return referenceCache.get(binding);
  const refs = await Promise.all(REFERENCE_NAMES.map((name) => loadReference(env, name)));
  if (binding && typeof binding === "object" && pickReferences(refs).ok) referenceCache.set(binding, refs);
  return refs;
}

/*
 * Chooses the two fixed references sent with every request:
 *   slot A = open-example (preferred) or mechanism
 *   slot B = mattress
 * Accepts the array from loadReferences() or the summary object from /api/health.
 */
export function pickReferences(refs) {
  const byName = Array.isArray(refs)
    ? Object.fromEntries(refs.map((ref) => [ref.name, ref]))
    : refs || {};
  const guide = byName["open-example"] && byName["open-example"].ok
    ? byName["open-example"]
    : byName.mechanism && byName.mechanism.ok ? byName.mechanism : null;
  const mattress = byName.mattress && byName.mattress.ok ? byName.mattress : null;
  const problems = [];
  if (!guide) problems.push("Add reference-images/open-example.jpg (your bed open, front view) or mechanism.jpg.");
  if (!mattress) problems.push((byName.mattress && byName.mattress.error) || "Add reference-images/mattress.jpg.");
  return { ok: Boolean(guide && mattress), guide, mattress, error: problems.join(" ") };
}

function referenceSummary(refs) {
  const out = {};
  for (const ref of refs) {
    out[ref.name] = ref.ok
      ? { ok: true, file: ref.file, width: ref.width, height: ref.height, bytes: ref.bytesLength }
      : { ok: false, file: ref.file || null, width: ref.width || null, height: ref.height || null, error: ref.error };
  }
  return out;
}

/* ---------- shared request guards (origin → rate limit → multipart) ---------- */
async function guardRequest(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin, env)) {
    return json(request, env, { error: "Origin is not allowed." }, 403);
  }

  // Server-side rate limit (see DEPLOYMENT-GUIDE.md). Skipped if not configured.
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return json(request, env, { error: "Too many previews requested. Please wait a minute and try again." }, 429);
    }
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return json(request, env, { error: "Expected multipart form data." }, 415);
  }
  return null;
}

async function readUpload(request, env, formData, field, label, required) {
  const file = formData.get(field);
  if (!file || typeof file === "string" || !file.size) {
    return required ? { error: json(request, env, { error: `${label} is required.` }, 400) } : { file: null };
  }
  if (!VALID_TYPES.includes(file.type)) {
    return { error: json(request, env, { error: `${label}: use a JPG, PNG or WebP image.` }, 415) };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: json(request, env, { error: `${label} must be 8 MB or smaller.` }, 413) };
  }
  return { file };
}

async function runModel(env, aiForm) {
  // FormData must be serialized to get the multipart boundary header.
  const serialized = new Response(aiForm);
  const model = env.AI_MODEL || DEFAULT_MODEL;
  return env.AI.run(model, {
    multipart: {
      body: serialized.body,
      contentType: serialized.headers.get("content-type")
    }
  });
}

function imageResponse(request, env, png, extraHeaders = {}) {
  return new Response(png.bytes, {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": png.type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Visualizer-Version": VERSION,
      ...extraHeaders
    }
  });
}

/* ---------- prompts ---------- */
function configurationText(details) {
  return [
    details.size && `bed size ${details.size}`,
    details.doorStyle && `door style ${details.doorStyle}`,
    details.crown && `crown ${details.crown}`,
    details.finish && `finish ${details.finish}`,
    details.leftCabinet && `left side ${details.leftCabinet}`,
    details.rightCabinet && `right side ${details.rightCabinet}`,
    details.mattress && `mattress ${details.mattress}`
  ].filter(Boolean).join("; ");
}

const OPEN_STATE_RULES = [
  "Image 3 is ONLY a shape guide showing how this type of Murphy bed looks when open, seen from the front.",
  "Do not copy anything else from image 3: not its white cabinet colour, not its beige back panel, not any room, rug, floor or lighting.",
  "How the open bed must look: the tall centre section of the cabinet (the big door panels) is the bed itself, so when open those door panels are no longer standing up.",
  "The centre of the cabinet becomes a recessed opening showing the inside back panel and inner side walls, made in the SAME wood finish and colour as the customer's cabinet in image 1.",
  "The bed has pivoted down at the bottom of the opening and lies flat, extending straight out from the wall toward the camera; its side rails and end panel use the same wood finish as the cabinet.",
  "On it lies a thick, neatly made mattress like image 4, quilted top facing up and clearly visible, side border facing the camera.",
  "The foot of the bed is held up by a slim black metal fold-down leg frame standing on the room's own floor.",
  "The side cabinets, shelves, drawers, lower doors and crown moulding stay exactly as in image 1, closed and unchanged."
].join(" ");

// Scene mode: image 1 is a close-up of the customer's room with their exact CLOSED bed already placed.
export function buildOpenFromScenePrompt(details) {
  const configuration = configurationText(details);
  return [
    "Edit image 1. It is a close-up photo of a customer's room with their closed Murphy wall-bed cabinet standing flat against the wall on the floor.",
    "Change only one thing: open the Murphy bed.",
    OPEN_STATE_RULES,
    "Image 2 is the same configured cabinet front: keep its wood finish, grain, colour, crown, side units and proportions.",
    "Keep the cabinet in exactly the same position and size. Keep the room exactly as in image 1: same wall, same floor material, same camera angle, framing and lighting. Do not add rugs, plants, furniture or decorations.",
    "Photorealistic, sharp, correct perspective, soft contact shadow under the bed on the floor. No people, no text, no watermark.",
    configuration ? `Product details: ${configuration}.` : ""
  ].filter(Boolean).join(" ");
}

// Closed render: image 1 is a close-up of the room with the exact closed cabinet already placed.
export function buildClosedRenderPrompt(details) {
  const configuration = configurationText(details);
  return [
    "Turn image 1 into a high-quality photorealistic interior photograph.",
    "Image 1 is a close-up of a customer's room where a closed Murphy wall-bed cabinet has already been placed flat against the wall, standing on the floor.",
    "Image 2 is the exact cabinet the customer designed. Keep the cabinet identical to image 2: same door panels, handles, crown moulding, side units, shelves, drawers, proportions and the same wood finish, stain colour and grain.",
    "Keep the cabinet in exactly the same position and size as in image 1. Do not open it, do not add a bed or mattress.",
    "Make it look really built into this room: correct perspective, the room's own light direction and colour temperature on the cabinet, realistic wood texture, a soft contact shadow where it meets the floor and a subtle shadow on the wall.",
    "Keep the room exactly as in image 1: same wall, floor, windows, furniture, camera angle and framing. Do not add rugs, plants, furniture or decorations.",
    "Sharp, clean, natural. No people, no text, no watermark.",
    configuration ? `Product details: ${configuration}.` : ""
  ].filter(Boolean).join(" ");
}

// Room mode: image 1 is the empty room; the AI places the cabinet itself (kept for compatibility).
export function buildRoomBedPrompt(details) {
  const configuration = configurationText(details);
  return [
    "Edit image 1, a real photo of a customer's room.",
    "Add the Murphy wall-bed cabinet shown in image 2 flat against the main back wall facing the camera, standing on the floor, centred on the largest clear wall area, at realistic full-height scale, and show it open.",
    "Keep the cabinet's finish colour, crown, side units and proportions identical to image 2.",
    OPEN_STATE_RULES,
    "Keep everything else in the room unchanged. Photorealistic, correct perspective. No people, no extra furniture, no text, no watermark.",
    configuration ? `Product details: ${configuration}.` : ""
  ].filter(Boolean).join(" ");
}

async function generateOpenBed(request, env, defaultState = "open") {
  const blocked = await guardRequest(request, env);
  if (blocked) return blocked;

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json(request, env, { error: "The upload could not be read." }, 400);
  }
  const bedState = String(formData.get("bedState") || defaultState).toLowerCase() === "closed" ? "closed" : "open";

  // Closed renders need no stored references; open renders need the open guide + mattress.
  let picked = null;
  if (bedState === "open") {
    picked = pickReferences(await loadReferences(env));
    if (!picked.ok) {
      return json(request, env, {
        error: "The room preview is not configured yet. Please contact the store team.",
        detail: picked.error
      }, 503);
    }
  }

  const sceneMode = Boolean(formData.get("scene"));
  const baseField = sceneMode ? "scene" : "room";
  const base = await readUpload(request, env, formData, baseField, sceneMode ? "The room preview image" : "The room photo", true);
  if (base.error) return base.error;
  const product = await readUpload(request, env, formData, "product", "The configured bed image", true);
  if (product.error) return product.error;

  const baseBytes = new Uint8Array(await base.file.arrayBuffer());
  const productBytes = new Uint8Array(await product.file.arrayBuffer());
  for (const [bytes, label] of [[baseBytes, "The room image"], [productBytes, "The configured bed image"]]) {
    const problem = checkModelInput(bytes, label);
    if (problem) return json(request, env, { error: problem }, 400);
  }

  const width = dimension(formData.get("width"), 1536);
  const height = dimension(formData.get("height"), 1152);
  const seed = seedValue(formData.get("seed"));
  const details = {
    size: cleanText(formData.get("size")),
    doorStyle: cleanText(formData.get("doorStyle")),
    crown: cleanText(formData.get("crown")),
    finish: cleanText(formData.get("finish")),
    leftCabinet: cleanText(formData.get("leftCabinet")),
    rightCabinet: cleanText(formData.get("rightCabinet")),
    mattress: cleanText(formData.get("mattress"))
  };
  const prompt = bedState === "closed"
    ? buildClosedRenderPrompt(details)
    : sceneMode ? buildOpenFromScenePrompt(details) : buildRoomBedPrompt(details);

  const aiForm = new FormData();
  aiForm.append("prompt", prompt);
  aiForm.append("input_image_0", new Blob([baseBytes], { type: base.file.type }), "room");
  aiForm.append("input_image_1", new Blob([productBytes], { type: product.file.type }), "product");
  if (picked) {
    aiForm.append("input_image_2", new Blob([picked.guide.bytes], { type: picked.guide.type }), "open-guide");
    aiForm.append("input_image_3", new Blob([picked.mattress.bytes], { type: picked.mattress.type }), "mattress");
  }
  aiForm.append("width", String(width));
  aiForm.append("height", String(height));
  if (seed !== null) aiForm.append("seed", String(seed));
  if (env.AI_GUIDANCE) aiForm.append("guidance", String(Number(env.AI_GUIDANCE)));

  const output = await runModel(env, aiForm);
  const png = await imageBytesFromOutput(output);
  return imageResponse(request, env, png, seed !== null ? { "X-Visualizer-Seed": String(seed) } : {});
}

/* ---------- LEGACY endpoint (unchanged behaviour, for cached old scripts) ---------- */
async function legacyGenerate(request, env) {
  const blocked = await guardRequest(request, env);
  if (blocked) return blocked;

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json(request, env, { error: "The upload could not be read." }, 400);
  }

  const image = await readUpload(request, env, formData, "image", "A room composite image", true);
  if (image.error) return image.error;
  const product = await readUpload(request, env, formData, "product", "Product image", false);
  if (product.error) return product.error;

  const width = dimension(formData.get("width"), 1024);
  const height = dimension(formData.get("height"), 768);
  const configuration = ["size", "doorStyle", "crown", "finish", "leftCabinet", "rightCabinet"]
    .map((key) => cleanText(formData.get(key)))
    .filter(Boolean)
    .join(", ");

  const prompt = [
    "Turn image 0 into a photorealistic interior photograph of the same room.",
    "Image 0 already shows the customer's room with a wall bed cabinet (Murphy bed) placed where it should stand.",
    product.file
      ? "Image 1 is the exact product: keep the cabinet identical to image 1 — same shape, door panels, crown molding, side cabinets, proportions and finish colour."
      : "Keep the cabinet identical — same shape, door panels, crown molding, side cabinets, proportions and finish colour.",
    "Keep the cabinet in the same position and size as in image 0, standing flat against the wall on the floor.",
    "Keep the room unchanged: same walls, floor, windows, furniture, colours and camera angle.",
    "Blend the cabinet naturally with matching perspective, indoor lighting, reflections and a soft contact shadow on the floor.",
    "Do not add another bed or any extra furniture. No text, no watermark.",
    configuration ? `Product details: ${configuration}.` : ""
  ].filter(Boolean).join(" ");

  const aiForm = new FormData();
  aiForm.append("prompt", prompt);
  aiForm.append("input_image_0", new Blob([await image.file.arrayBuffer()], { type: image.file.type }), "room.jpg");
  if (product.file) {
    aiForm.append("input_image_1", new Blob([await product.file.arrayBuffer()], { type: product.file.type }), "product.jpg");
  }
  aiForm.append("width", String(width));
  aiForm.append("height", String(height));
  if (env.AI_GUIDANCE) aiForm.append("guidance", String(Number(env.AI_GUIDANCE)));

  const output = await runModel(env, aiForm);
  return imageResponse(request, env, await imageBytesFromOutput(output));
}

/* Workers AI image models return either { image: "<base64>" } or raw bytes/stream. */
export async function imageBytesFromOutput(output) {
  let bytes;
  if (output && typeof output.image === "string") {
    const b64 = output.image.replace(/^data:[^,]+,/, "");
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else if (output instanceof ReadableStream) {
    bytes = new Uint8Array(await new Response(output).arrayBuffer());
  } else if (output instanceof ArrayBuffer) {
    bytes = new Uint8Array(output);
  } else if (output instanceof Uint8Array) {
    bytes = output;
  } else {
    throw new Error("Unexpected AI output: " + JSON.stringify(output).slice(0, 300));
  }
  if (!bytes || bytes.length < 100) throw new Error("AI returned an empty image.");
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57;
  return { bytes, type: isPng ? "image/png" : isJpg ? "image/jpeg" : isWebp ? "image/webp" : "image/png" };
}

/* ---------- refine pass (SDXL img2img) ---------- */
export function buildRefinePrompt(details) {
  const configuration = configurationText(details);
  return [
    "professional interior photograph of a room with a built-in Murphy wall bed cabinet standing flat against the wall on the floor,",
    "photorealistic, natural soft daylight, realistic wood grain and cabinet finish, crisp cabinet edges and door panels,",
    "soft contact shadow on the floor, subtle shadow on the wall, correct perspective, high detail, sharp focus, 8k interior design photography",
    configuration ? `, ${configuration}` : ""
  ].join(" ").replace(/\s+,/g, ",");
}

// FLUX edit prompt: image 1 = placed scene, image 2 = the exact configured cabinet.
export function buildFluxRefinePrompt(details) {
  const configuration = configurationText(details);
  return [
    "Edit image 1 into a high-end photorealistic interior photograph.",
    "Image 1 shows a customer's room with a Murphy wall-bed cabinet already placed flat against the wall on the floor. Image 2 is that exact cabinet.",
    "Keep the cabinet's design identical to image 2: same doors, panel layout, handles, shelves, side units, crown, proportions and the same finish colour. Keep it closed, in exactly the same position and size.",
    "Make the cabinet look like real furniture photographed in this room: realistic wood grain and material texture, crisp edges and panel grooves, natural reflections, the room's own light direction and colour temperature, a soft contact shadow on the floor and a subtle shadow on the wall.",
    "Keep the room exactly as in image 1: same wall, floor, windows, plants and furniture, same camera angle and framing. Do not add rugs, furniture, people, text or watermarks.",
    configuration ? `Product details: ${configuration}.` : ""
  ].filter(Boolean).join(" ");
}

export const REFINE_NEGATIVE_PROMPT = [
  "blurry, low quality, distorted, warped cabinet, deformed doors, melted, extra furniture, extra bed, mattress,",
  "open bed, people, text, watermark, logo, cartoon, illustration, painting, 3d render, oversaturated, noisy"
].join(" ");

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function numberVar(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function isFluxModel(model) {
  return /flux/i.test(model);
}

// One model call. FLUX = multipart edit with reference images (each < 512 px);
// other (SD-style) models = JSON img2img. A new body is built for every attempt.
async function runRefineModel(env, model, job) {
  if (isFluxModel(model)) {
    const form = new FormData();
    form.append("prompt", job.fluxPrompt);
    form.append("input_image_0", new Blob([job.sceneBytes], { type: job.sceneType }), "scene");
    if (job.productBytes) form.append("input_image_1", new Blob([job.productBytes], { type: job.productType }), "product");
    form.append("width", String(job.width));
    form.append("height", String(job.height));
    if (job.seed !== null) form.append("seed", String(job.seed));
    const serialized = new Response(form);
    return env.AI.run(model, {
      multipart: { body: serialized.body, contentType: serialized.headers.get("content-type") }
    });
  }
  const inputs = {
    prompt: job.sdPrompt,
    negative_prompt: REFINE_NEGATIVE_PROMPT,
    image_b64: toBase64(job.sceneBytes),
    strength: job.strength,
    guidance: job.guidance,
    num_steps: job.steps,
    width: Math.min(2048, Math.max(256, Math.floor(job.sceneWidth / 8) * 8)),
    height: Math.min(2048, Math.max(256, Math.floor(job.sceneHeight / 8) * 8))
  };
  if (job.seed !== null) inputs.seed = job.seed;
  return env.AI.run(model, inputs);
}

async function generateRefine(request, env) {
  const blocked = await guardRequest(request, env);
  if (blocked) return blocked;

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json(request, env, { error: "The upload could not be read." }, 400);
  }

  const field = formData.get("scene") ? "scene" : "image";
  const scene = await readUpload(request, env, formData, field, "The room image", true);
  if (scene.error) return scene.error;
  const product = await readUpload(request, env, formData, "product", "The configured bed image", false);
  if (product.error) return product.error;

  const sceneBytes = new Uint8Array(await scene.file.arrayBuffer());
  const dims = imageDimensions(sceneBytes);
  if (!dims) return json(request, env, { error: "The room image could not be read as JPG, PNG or WebP." }, 400);
  const productBytes = product.file ? new Uint8Array(await product.file.arrayBuffer()) : null;

  const chain = refineChain(env);
  if (chain.some(isFluxModel)) {
    // FLUX inputs must be smaller than 512 x 512.
    for (const [bytes, label] of [[sceneBytes, "The room image"], [productBytes, "The configured bed image"]]) {
      if (!bytes) continue;
      const problem = checkModelInput(bytes, label);
      if (problem && chain.every(isFluxModel)) return json(request, env, { error: problem }, 400);
    }
  }

  const details = {
    size: cleanText(formData.get("size")),
    doorStyle: cleanText(formData.get("doorStyle")),
    crown: cleanText(formData.get("crown")),
    finish: cleanText(formData.get("finish")),
    leftCabinet: cleanText(formData.get("leftCabinet")),
    rightCabinet: cleanText(formData.get("rightCabinet"))
  };
  const job = {
    sceneBytes,
    sceneType: scene.file.type,
    sceneWidth: dims.width,
    sceneHeight: dims.height,
    productBytes,
    productType: product.file ? product.file.type : "",
    width: dimension(formData.get("width"), 1024),
    height: dimension(formData.get("height"), 768),
    seed: seedValue(formData.get("seed")),
    fluxPrompt: buildFluxRefinePrompt(details),
    sdPrompt: buildRefinePrompt(details),
    strength: numberVar(env.REFINE_STRENGTH, 0.3, 0.05, 0.8),
    guidance: numberVar(env.REFINE_GUIDANCE, 7.5, 1, 20),
    steps: Math.round(numberVar(env.REFINE_STEPS, 20, 4, 20))
  };

  const started = Date.now();
  const budgetMs = numberVar(env.REFINE_BUDGET_MS, 30000, 5000, 120000);
  const failures = [];
  for (const model of chain) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const output = await runRefineModel(env, model, job);
        const png = await imageBytesFromOutput(output);
        const headers = { "X-Visualizer-Model": model };
        if (job.seed !== null) headers["X-Visualizer-Seed"] = String(job.seed);
        return imageResponse(request, env, png, headers);
      } catch (error) {
        const detail = String((error && (error.message || error)) || "unknown").slice(0, 200);
        failures.push(`${model}#${attempt}: ${detail}`);
        console.warn("Refine attempt failed", model, attempt, detail);
        if (!isTemporaryAiError(detail)) break;   // retry only busy / timeout
      }
      if (Date.now() - started > budgetMs) break;
    }
    if (Date.now() - started > budgetMs) {
      failures.push(`stopped after ${Date.now() - started} ms (time budget ${budgetMs} ms)`);
      break;
    }
    // Daily neuron limit applies to every model on the account: do not try the next one.
    if (/4006|neuron|daily free allocation/i.test(failures[failures.length - 1] || "")) break;
  }
  throw new Error(failures.join(" | "));
}

// 504x378 test picture (wall, floor, simple cabinet) used by GET /api/selftest.
const SELFTEST_JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCAF6AfgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD1qiiioKCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAZNIIYZJWztjQuQOpAGf6VzK+OdNIH+jXeMf3U/xrodR/wCQfdf9cJP/AEE14+v3R9K569SULWN6NOM9z0H/AITjTf8An2u/++U/xo/4TjTf+fa7/wC+U/xrzszwhiplQEdRmk+0Q/8APVPzrH28zb2MD0X/AITjTf8An2u/++U/xo/4TjTf+fa7/wC+U/xrzr7RD/z1T86PtEP/AD1T86PbzD2MD0X/AITjTf8An2u/++U/xo/4TjTf+fa7/wC+U/xrzr7RD/z1T86PtEP/AD1T86PbzD2MD0X/AITjTf8An2u/++U/xo/4TjTf+fa7/wC+U/xrzr7RD/z1T86PtEP/AD1T86PbzD2MD0X/AITjTf8An2u/++U/xo/4TjTf+fa7/wC+U/xrzr7RD/z1T86kBBGQcjGc0e3mHsYHoP8AwnGm/wDPtd/98p/jR/wnGm/8+13/AN8p/jXnX2iD/nqn50faIf8Anqn50e3mHsYHov8AwnGm/wDPtd/98p/jR/wnGm/8+13/AN8p/jXnX2iH/nqn50faIf8Anqn50e3mHsYHov8AwnGm/wDPtd/98p/jR/wnGm/8+13/AN8p/jXnX2iH/nqn50faIf8Anqn50e3mHsYHov8AwnGm/wDPtd/98p/jR/wnGm/8+13/AN8p/jXnX2iH/nqn50faIf8Anqn50e3mHsYHov8AwnGm/wDPtd/98p/jR/wnGm/8+136fdT/ABrzr7RD/wA9U/OpRR7eYexgev6feJqFlDdxKypMu5QwAIGSO30qxWT4V/5F3T/+uX/sxrWrsi7pM45KzsFFFFUIKKKKACiiigAo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P+fu3/7/AC/415ZgegowPQUe3fYPq67npl/eWpsLkC6gJMLgASr/AHT715Kv3QO+KvYHoPyowPSsqknM0pwUCnSY9v0q7gelGB6Vnymtylj2/SjHt+lXcD0owPSjlFcpY9v0ox7fpV3A9KMD0o5QuUse36UY9v0q7gelGB6UcoXKX4UtXMD0owPSjlHcpnntSY9v0q7gelGB6UcoXKWPb9KMe36VdwPSjA9KOUVylj2/SjHt+lXcD0owPSjlC5Sx7fpRj2/SruB6UYHpRyhcpfhS/hVzA9KMD0FHKO53/he7tk8P2CSXEKMIuVaRQRyfU1qfbrT/AJ+7f/v8v+NeWYHoPyowPQV0Ks0kjndFNtnqf220/wCfu3/7/L/jR9ttP+fu3/7/AC/415ZgegowPQflT9u+wvq67nqf220/5+7f/v8AL/jR9ttP+fu3/wC/y/415Zgeg/KjA9B+VHt32D6uu56n9ttP+fu3/wC/y/40fbbT/n7t/wDv8v8AjXlmB6D8qMD0FHt32D6uu56n9ttP+fu3/wC/y/40fbbT/n7t/wDv8v8AjXlm0ego2j0FHt32D6uu56n9ttP+fu3/AO/y/wCNH220/wCfu3/7/L/jXlmB6CjA9B+VHt32D6uu56n9ttP+fu3/AO/y/wCNH220/wCfu3/7/L/jXlmB6D8qMD0H5Ue3fYPq67nqf220/wCfu3/7/L/jR9ttP+fu3/7/AC/415Zgeg/KjA9BR7d9g+rruep/bbT/AJ+7f/v8v+NH220/5+7f/v8AL/jXlm0ego2j0FHt32D6uu56n9ttP+fu3/7/AC/40fbbT/n7t/8Av8v+NeWYHoKMD0H5Ue3fYPq67nqf220/5+7f/v8AL/jRXlmB6D8qKPbvsH1ddxaKKKwNwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z";

/*
 * GET /api/selftest — runs one real refine on a built-in test picture with every model in
 * the chain and reports, per model, whether it worked, how long it took and the exact error.
 * Open it in a browser to see why AI images fail. Counts toward the per-IP rate limit.
 */
async function selfTest(request, env) {
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return json(request, env, { error: "Too many tests. Wait a minute and try again." }, 429);
  }
  const results = [];
  const testBytes = Uint8Array.from(atob(SELFTEST_JPEG_B64), (c) => c.charCodeAt(0));
  const job = {
    sceneBytes: testBytes, sceneType: "image/jpeg", sceneWidth: 504, sceneHeight: 378,
    productBytes: testBytes, productType: "image/jpeg",
    width: 1024, height: 768, seed: 7,
    fluxPrompt: buildFluxRefinePrompt({}), sdPrompt: buildRefinePrompt({}),
    strength: numberVar(env.REFINE_STRENGTH, 0.3, 0.05, 0.8),
    guidance: numberVar(env.REFINE_GUIDANCE, 7.5, 1, 20),
    steps: Math.round(numberVar(env.REFINE_STEPS, 20, 4, 20))
  };
  for (const model of refineChain(env)) {
    const started = Date.now();
    try {
      const image = await imageBytesFromOutput(await runRefineModel(env, model, job));
      const out = imageDimensions(image.bytes);
      results.push({ model, ok: true, ms: Date.now() - started, bytes: image.bytes.length, type: image.type,
        size: out ? `${out.width}x${out.height}` : null });
    } catch (error) {
      const detail = String((error && (error.message || error)) || "unknown").slice(0, 300);
      results.push({ model, ok: false, ms: Date.now() - started, error: detail, meaning: explainAiError(detail).message });
    }
  }
  return json(request, env, {
    ok: results.some((r) => r.ok),
    version: VERSION,
    aiBinding: Boolean(env.AI),
    results
  });
}

export function refineChain(env) {
  const configured = String(env.REFINE_MODELS || env.REFINE_MODEL || "")
    .split(",").map((v) => v.trim()).filter(Boolean);
  return configured.length ? configured : DEFAULT_REFINE_CHAIN;
}

export function isTemporaryAiError(detail) {
  return /3040|capacity|overloaded|busy|3007|timeout|timed out|temporar|503|502/i.test(String(detail || ""));
}

/* Turns Workers AI error text into a clear message + short code for the page. */
export function explainAiError(detail) {
  const text = String(detail || "");
  const codeMatch = text.match(/\b([3-9]\d{3})\b/);
  const code = codeMatch ? codeMatch[1] : "";
  if (/4006|neuron|daily free allocation|allocation/i.test(text)) {
    return { status: 429, code: code || "4006", message: "Today's AI image limit for this store has been reached. Please try again tomorrow." };
  }
  if (/3040|capacity|overloaded|too many requests|3036|rate limit/i.test(text)) {
    return { status: 503, code: code || "busy", message: "The AI service is busy right now. Please try again in a minute." };
  }
  if (/3007|timeout|timed out/i.test(text)) {
    return { status: 504, code: code || "timeout", message: "The AI took too long. Please try again." };
  }
  if (/5006|input|schema|invalid|must be/i.test(text)) {
    return { status: 400, code: code || "input", message: "The AI service rejected the image settings. Please try another photo." };
  }
  return { status: 502, code: code || "ai", message: "The room preview could not be generated. Please try again." };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        let references;
        try {
          references = referenceSummary(await loadReferences(env));
        } catch (error) {
          references = { error: String((error && error.message) || error).slice(0, 200) };
        }
        return json(request, env, {
          ok: true,
          service: "murphy-bed-room-visualizer",
          version: VERSION,
          aiBinding: Boolean(env.AI),
          model: env.AI_MODEL || DEFAULT_MODEL,
          allowedOrigins: allowedOrigins(env),
          renderReady: Boolean(env.AI),
          refineModel: refineChain(env)[0],
          refineChain: refineChain(env),
          openViewReady: Boolean(env.AI) && Boolean(pickReferences(references).ok),
          references
        });
      }

      if (request.method === "GET" && url.pathname === "/api/selftest") {
        return await selfTest(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/generate-room-render") {
        return await generateRefine(request, env);
      }

      if (request.method === "POST" &&
          (url.pathname === "/api/generate-room-bed" || url.pathname === "/api/generate-open-view")) {
        return await generateOpenBed(request, env, "open");
      }

      if (request.method === "POST" && url.pathname === "/api/generate-room-preview") {
        return await legacyGenerate(request, env);
      }

      return json(request, env, { error: "Not found." }, 404);
    } catch (error) {
      // Always return CORS headers so the browser shows a readable error.
      const detail = String((error && (error.message || error)) || "unknown").slice(0, 300);
      console.error("Room visualizer failure", detail, error && error.stack);
      const known = explainAiError(detail);
      return json(request, env, {
        error: known.message,
        code: known.code,
        detail
      }, known.status);
    }
  }
};

/**
 * Island Murphy Beds — AI Room Visualizer Worker (FLUX.2 [klein] 9B on Workers AI)
 *
 * The CLOSED view is composed in the browser from the builder's exact bed image.
 * This Worker only makes the OPEN view.
 *
 * POST /api/generate-room-render (multipart/form-data)   <- used by the theme (v7)
 *   scene     close-up of the customer's room with the exact configured bed placed
 *             (256–2048 px each side; the theme sends ~1024 px)
 *   seed, size, doorStyle, crown, finish, leftCabinet, rightCabinet   optional
 *   → SDXL image-to-image refine at low strength (Worker vars: REFINE_STRENGTH,
 *     default 0.3; REFINE_GUIDANCE, default 7.5; REFINE_MODEL). The whole image,
 *     product included, is re-rendered photorealistically while keeping its design.
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
// Free (beta) img2img models tried in order. A model that is missing or fails is skipped.
// Override with the Worker variable REFINE_MODELS (comma separated).
const DEFAULT_REFINE_CHAIN = [DEFAULT_REFINE_MODEL, "@cf/runwayml/stable-diffusion-v1-5-img2img"];
const VERSION = "2026-10-05-v9-selftest";
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

  const bytes = new Uint8Array(await scene.file.arrayBuffer());
  const dims = imageDimensions(bytes);
  if (!dims) return json(request, env, { error: "The room image could not be read as JPG, PNG or WebP." }, 400);
  if (dims.width < 256 || dims.height < 256 || dims.width > 2048 || dims.height > 2048) {
    return json(request, env, { error: `The room image is ${dims.width}×${dims.height}; it must be between 256 and 2048 px on each side.` }, 400);
  }

  const width = Math.max(256, Math.floor(dims.width / 8) * 8);
  const height = Math.max(256, Math.floor(dims.height / 8) * 8);
  const seed = seedValue(formData.get("seed"));
  const details = {
    size: cleanText(formData.get("size")),
    doorStyle: cleanText(formData.get("doorStyle")),
    crown: cleanText(formData.get("crown")),
    finish: cleanText(formData.get("finish")),
    leftCabinet: cleanText(formData.get("leftCabinet")),
    rightCabinet: cleanText(formData.get("rightCabinet"))
  };

  const inputs = {
    prompt: buildRefinePrompt(details),
    negative_prompt: REFINE_NEGATIVE_PROMPT,
    image_b64: toBase64(bytes),
    strength: numberVar(env.REFINE_STRENGTH, 0.3, 0.05, 0.8),
    guidance: numberVar(env.REFINE_GUIDANCE, 7.5, 1, 20),
    num_steps: 20,
    width,
    height
  };
  if (seed !== null) inputs.seed = seed;

  const chain = refineChain(env);
  const failures = [];
  for (const model of chain) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const modelInputs = model.includes("v1-5")
          ? { ...inputs, width: Math.min(inputs.width, 1024), height: Math.min(inputs.height, 1024) }
          : inputs;
        const output = await env.AI.run(model, modelInputs);
        const png = await imageBytesFromOutput(output);
        const headers = { "X-Visualizer-Model": model };
        if (seed !== null) headers["X-Visualizer-Seed"] = String(seed);
        return imageResponse(request, env, png, headers);
      } catch (error) {
        const detail = String((error && (error.message || error)) || "unknown").slice(0, 200);
        failures.push(`${model}#${attempt}: ${detail}`);
        console.warn("Refine attempt failed", model, attempt, detail);
        // Retry the same model only for temporary problems (busy / timeout).
        if (!isTemporaryAiError(detail)) break;
      }
    }
  }
  throw new Error(failures.join(" | "));
}

// 512x384 test picture (wall, floor, simple cabinet) used by GET /api/selftest.
const SELFTEST_JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAGAAgADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD1GiiioKCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKzbvxBpdjcvbXN1slTG5fLY4yM9h6GtKvOfFX/IyXX/AAD/ANAWsqs3CN0aUoKbszr/APhKtE/5/f8AyE/+FH/CVaJ/z+/+Qn/wrzmiuf6xI6PYRPRv+Eq0T/n9/wDIT/4Uf8JVon/P7/5Cf/CvOaKPrEg9hE9G/wCEq0T/AJ/f/IT/AOFH/CVaJ/z+/wDkJ/8ACvOaKPrEg9hE9G/4SrRP+f3/AMhP/hR/wlWif8/v/kJ/8K85oo+sSD2ET0b/AISrRP8An9/8hP8A4Uf8JVon/P7/AOQn/wAK85oo+sSD2ET0b/hKtE/5/f8AyE/+FH/CVaJ/z+/+Qn/wrzmij6xIPYRPRv8AhKtE/wCf3/yE/wDhR/wlWif8/v8A5Cf/AArzmij6xIPYRPRv+Eq0T/n9/wDIT/4Uf8JVon/P7/5Cf/CvOaKPrEg9hE9G/wCEq0T/AJ/f/IT/AOFH/CVaJ/z+/wDkJ/8ACvOaKPrEg9hE9G/4SrRP+f3/AMhP/hR/wlWif8/v/kJ/8K85oo+sSD2ET0mHxLpE8yQxXe6SRgqjy3GSTgdq1K8u0j/kM2P/AF8R/wDoQr1Gt6U3NO5hVgoPQKKKK2MgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK858Vf8jJdf8A/9AWvRq858Vf8AIyXX/AP/AEBa58R8JvQ+I529UPJCp6E4/lS/YIv7z/mKLr/X2/8Avf1FWq5L6HVbUq/YIv7z/mKPsEX95/zFWqKV2OyKv2CL+8/5ij7BF/ef8xVqii7CyKv2CL+8/wCYo+wRf3n/ADFWqKLsLIq/YIv7z/mKbbxiK9dFyQF7/hVyqsf/ACEZP93/AAp3FYS9UPJCp6E4/lS/YIv7z/mKLr/X2/8Avf1FWqL6BbUq/YIv7z/mKPsEX95/zFWqKV2OyKv2CL+8/wCYo+wRf3n/ADFWqKLsLIq/YIv7z/mKPsEX95/zFWqKLsLIq/YIv7z/AJim28YivXRckBe/4VcqrH/yEZP93/CncVjW0j/kM2P/AF8R/wDoQr1GvLtI/wCQzY/9fEf/AKEK9Rrqw+zObEboKKKK6TnCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigArznxV/yMl1/wD/0Ba9GrznxV/yMl1/wD/0Ba58R8JvQ+I566/19v/vf1FWqq3X+vt/97+oq1XG9jrW4UUUUhhRRRQAUUUUAFVY/+QjJ/u/4VaqrH/yEZP8Ad/wpoTC6/wBfb/739RVqqt1/r7f/AHv6irVD2BbhRRRSGFFFFABRRRQAVVj/AOQjJ/u/4VaqrH/yEZP93/CmhM1tI/5DNj/18R/+hCvUa8u0j/kM2P8A18R/+hCvUa68PszlxG6Ciiiuk5wooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK858Vf8AIyXX/AP/AEBa9GrznxV/yMl1/wAA/wDQFrnxHwm9D4jnrr/X2/8Avf1FWqq3X+vt/wDe/qKtVxvY61uFFFFIYUUUUAFFFFABVWP/AJCMn+7/AIVaqrH/AMhGT/d/wpoTC6/19v8A739RVqqt1/r7f/e/qKtUPYFuFFFFIYUUUUAFFFFABVWP/kIyf7v+FWqqx/8AIRk/3f8ACmhM1tI/5DNj/wBfEf8A6EK9Rry7SP8AkM2P/XxH/wChCvUa68PszlxG6Ciiiuk5wooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK858Vf8jJdf8A/9AWvRq858Vf8jJdf8A/9AWuf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";

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
  for (const model of refineChain(env)) {
    const started = Date.now();
    try {
      const output = await env.AI.run(model, {
        prompt: buildRefinePrompt({}),
        negative_prompt: REFINE_NEGATIVE_PROMPT,
        image_b64: SELFTEST_JPEG_B64,
        strength: numberVar(env.REFINE_STRENGTH, 0.3, 0.05, 0.8),
        guidance: numberVar(env.REFINE_GUIDANCE, 7.5, 1, 20),
        num_steps: 20,
        width: 512,
        height: 384
      });
      const image = await imageBytesFromOutput(output);
      results.push({ model, ok: true, ms: Date.now() - started, bytes: image.bytes.length, type: image.type });
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

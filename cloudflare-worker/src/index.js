/**
 * Island Murphy Beds — AI Room Visualizer Worker (FLUX.2 [klein] 9B on Workers AI)
 *
 * The CLOSED view is composed in the browser from the builder's exact bed image.
 * This Worker only makes the OPEN view.
 *
 * POST /api/generate-room-render (multipart/form-data)   <- used by the theme (v6)
 *   scene     close-up of the room with the exact configured bed placed (< 512 px each side)
 *   product   exact configured bed front from #preview-stage (< 512 px)
 *   bedState  "closed" (default here, 2 input images, no stored references needed)
 *             or "open" (adds the stored open-example + mattress references)
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
const VERSION = "2026-09-26-v6-room-render";
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
    "Access-Control-Expose-Headers": "X-Visualizer-Seed, X-Visualizer-Version",
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
          openViewReady: Boolean(env.AI) && Boolean(pickReferences(references).ok),
          references
        });
      }

      if (request.method === "POST" && url.pathname === "/api/generate-room-render") {
        return await generateOpenBed(request, env, "closed");
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
      return json(request, env, {
        error: "The room preview could not be generated. Please try again.",
        detail
      }, 502);
    }
  }
};

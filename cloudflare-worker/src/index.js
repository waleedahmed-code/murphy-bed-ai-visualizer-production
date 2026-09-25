/**
 * Island Murphy Beds — AI Room Visualizer Worker
 *
 * POST /api/generate-room-preview  (multipart/form-data)
 *   image      JPG/PNG/WebP composite (room photo + configured bed), <= 8 MB
 *   width      composite width  (256–2048, multiple of 8)   optional
 *   height     composite height (256–2048, multiple of 8)   optional
 *   size, doorStyle, crown, finish, leftCabinet, rightCabinet   optional text
 *
 * GET /api/health  -> { ok: true }
 */

const MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const VALID_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
  return Math.min(2048, Math.max(256, Math.round(n / 8) * 8));
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function generate(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin, env)) {
    return json(request, env, { error: "Origin is not allowed." }, 403);
  }

  // Optional server-side rate limit (see DEPLOYMENT-GUIDE.md). Skipped if not configured.
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

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json(request, env, { error: "The upload could not be read." }, 400);
  }

  const image = formData.get("image");
  if (!image || typeof image === "string" || !image.size) {
    return json(request, env, { error: "A room composite image is required." }, 400);
  }
  if (!VALID_TYPES.includes(image.type)) {
    return json(request, env, { error: "Use a JPG, PNG or WebP image." }, 415);
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return json(request, env, { error: "Image must be 8 MB or smaller." }, 413);
  }

  const width = dimension(formData.get("width"), 1024);
  const height = dimension(formData.get("height"), 768);

  const configuration = [
    cleanText(formData.get("size")),
    cleanText(formData.get("doorStyle")),
    cleanText(formData.get("crown")),
    cleanText(formData.get("finish")),
    cleanText(formData.get("leftCabinet")),
    cleanText(formData.get("rightCabinet"))
  ].filter(Boolean).join(", ");

  const prompt = [
    "Photorealistic interior photograph of this exact room with a built-in wall bed cabinet (Murphy bed) standing against the wall.",
    "Keep the room architecture, floor, walls, windows, furniture and camera angle unchanged.",
    "Keep the cabinet exactly as shown: same shape, doors, crown molding, side cabinets, proportions and finish colour.",
    "Natural indoor lighting, realistic contact shadow where the cabinet meets the floor, sharp focus, high detail.",
    configuration ? `Cabinet details: ${configuration}.` : ""
  ].filter(Boolean).join(" ");

  const negativePrompt =
    "extra bed, duplicate furniture, distorted cabinet, warped lines, floating furniture, blurry, cartoon, painting, text, watermark, people";

  const bytes = new Uint8Array(await image.arrayBuffer());
  const strength = Math.min(0.45, Math.max(0.1, Number(env.AI_STRENGTH) || 0.25));

  const baseInputs = {
    prompt,
    negative_prompt: negativePrompt,
    width,
    height,
    strength,
    guidance: 7.5,
    num_steps: 20
  };

  let output;
  try {
    output = await env.AI.run(MODEL, { ...baseInputs, image_b64: toBase64(bytes) });
  } catch (firstError) {
    // Fallback for accounts/models that only accept the byte-array input.
    console.warn("image_b64 input failed, retrying with byte array", String(firstError));
    output = await env.AI.run(MODEL, { ...baseInputs, image: Array.from(bytes) });
  }

  return new Response(output, {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(request, env, {
          ok: true,
          service: "murphy-bed-room-visualizer",
          aiBinding: Boolean(env.AI),
          allowedOrigins: allowedOrigins(env)
        });
      }

      if (request.method === "POST" && url.pathname === "/api/generate-room-preview") {
        return await generate(request, env);
      }

      return json(request, env, { error: "Not found." }, 404);
    } catch (error) {
      // Always return CORS headers so the browser shows a readable error.
      console.error("Room visualizer failure", error && (error.stack || error.message || error));
      return json(request, env, { error: "The room preview could not be generated. Please try again." }, 502);
    }
  }
};

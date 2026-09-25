/**
 * Island Murphy Beds — AI Room Visualizer Worker (FLUX.2 on Workers AI)
 *
 * POST /api/generate-room-preview  (multipart/form-data)
 *   image      composite (room + positioned bed), JPG/PNG/WebP, < 512 px each side
 *   product    configured bed alone, JPG/PNG/WebP, < 512 px each side   (optional)
 *   width      output width  (256–1920)
 *   height     output height (256–1920)
 *   size, doorStyle, crown, finish, leftCabinet, rightCabinet   optional text
 *
 * GET /api/health
 *
 * NOTE: SDXL on Workers AI does NOT accept image input (error 3030), so this
 * Worker uses FLUX.2 reference-image editing instead.
 */

const DEFAULT_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
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
  return Math.min(1920, Math.max(256, Math.round(n / 16) * 16));
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

  const product = formData.get("product");
  const hasProduct = product && typeof product !== "string" && product.size > 0 && VALID_TYPES.includes(product.type);

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
    "Turn image 0 into a photorealistic interior photograph of the same room.",
    "Image 0 already shows the customer's room with a wall bed cabinet (Murphy bed) placed where it should stand.",
    hasProduct
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
  aiForm.append("input_image_0", new Blob([await image.arrayBuffer()], { type: image.type }), "room.jpg");
  if (hasProduct) {
    aiForm.append("input_image_1", new Blob([await product.arrayBuffer()], { type: product.type }), "product.jpg");
  }
  aiForm.append("width", String(width));
  aiForm.append("height", String(height));
  if (env.AI_GUIDANCE) aiForm.append("guidance", String(Number(env.AI_GUIDANCE)));

  // FormData must be serialized to get the multipart boundary header.
  const serialized = new Response(aiForm);
  const model = env.AI_MODEL || DEFAULT_MODEL;

  const output = await env.AI.run(model, {
    multipart: {
      body: serialized.body,
      contentType: serialized.headers.get("content-type")
    }
  });

  const png = await imageBytesFromOutput(output);

  return new Response(png.bytes, {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": png.type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

/* Workers AI image models return either { image: "<base64>" } or raw bytes/stream. */
async function imageBytesFromOutput(output) {
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
  return { bytes, type: isPng ? "image/png" : isJpg ? "image/jpeg" : "image/png" };
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
          model: env.AI_MODEL || DEFAULT_MODEL,
          allowedOrigins: allowedOrigins(env)
        });
      }

      if (request.method === "POST" && url.pathname === "/api/generate-room-preview") {
        return await generate(request, env);
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

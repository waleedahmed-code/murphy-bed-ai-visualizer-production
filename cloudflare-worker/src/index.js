const MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function json(request, env, body, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders(request, env)
  });
}

function cleanText(value, maxLength = 140) {
  return String(value || "")
    .replace(/[\r\n<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(request, env, { ok: true, service: "murphy-bed-room-visualizer" });
    }

    if (request.method !== "POST" || url.pathname !== "/api/generate-room-preview") {
      return json(request, env, { error: "Not found." }, 404);
    }

    const origin = request.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!origin || !allowed.includes(origin)) {
      return json(request, env, { error: "Origin is not allowed." }, 403);
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
    if (!(image instanceof File) || image.size === 0) {
      return json(request, env, { error: "A room composite image is required." }, 400);
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) {
      return json(request, env, { error: "Use a JPG, PNG or WebP image." }, 415);
    }

    if (image.size > MAX_IMAGE_BYTES) {
      return json(request, env, { error: "Image must be 8 MB or smaller." }, 413);
    }

    const configuration = [
      cleanText(formData.get("size")),
      cleanText(formData.get("doorStyle")),
      cleanText(formData.get("crown")),
      cleanText(formData.get("finish")),
      cleanText(formData.get("leftCabinet")),
      cleanText(formData.get("rightCabinet"))
    ].filter(Boolean).join(", ");

    const prompt = [
      "Create a photorealistic interior visualization from this supplied composite image.",
      "Preserve the room architecture, floor, windows, furniture and camera angle.",
      "Preserve the exact Murphy bed shape, doors, crown, cabinets, proportions and finish already placed in the image.",
      "Integrate the Murphy bed against the wall using realistic perspective, contact shadows and matching indoor light.",
      "Do not add another bed. Do not redesign, remove or change product components.",
      configuration ? `Configured product details: ${configuration}.` : ""
    ].filter(Boolean).join(" ");

    try {
      const source = new Uint8Array(await image.arrayBuffer());
      const output = await env.AI.run(MODEL, {
        image: Array.from(source),
        prompt,
        strength: 0.22,
        guidance: 8,
        num_steps: 20
      });

      return new Response(output, {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": "image/png",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch (error) {
      console.error("Workers AI generation failed", error);
      return json(request, env, {
        error: "The room preview could not be generated. Please try again."
      }, 502);
    }
  }
};

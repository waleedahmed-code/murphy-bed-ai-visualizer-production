# Deployment Guide — AI Room Visualizer

Flow: customer builds the bed (steps 1–7) → step 8 "Review" → uploads room photo →
drags/resizes the exact configured bed onto the wall → Worker (Workers AI SDXL img2img)
returns a photorealistic version. If AI fails, the instant composite is shown instead.

## 1. Push the Worker code to GitHub

Replace these files in the repo `waleedahmed-code/murphy-bed-ai-visualizer-production`
and commit to `main`:

- `cloudflare-worker/wrangler.jsonc`
- `cloudflare-worker/src/index.js`

The Worker name in `wrangler.jsonc` is now `murphy-bed-ai-visualizer-production`, matching
the Worker in the Cloudflare dashboard (the old file said `murphy-bed-room-visualizer`,
which makes Git builds fail or create a second Worker).

Cloudflare → Workers & Pages → murphy-bed-ai-visualizer-production → Settings → Build:
- Root directory: `cloudflare-worker`
- Build command: `npm install` (or leave empty)
- Deploy command: `npx wrangler deploy`

## 2. Allowed origins (IMPORTANT)

Edit `ALLOWED_ORIGINS` in `wrangler.jsonc` (not in the dashboard — Git deploys overwrite
dashboard vars). Add every domain the page is opened from, comma-separated:

    https://islandmurphybeds.com,https://www.islandmurphybeds.com,https://YOURSTORE.myshopify.com,https://*.shopifypreview.com

A request from any other domain gets `403 Origin is not allowed`.

## 3. Verify the Worker

Open: `https://murphy-bed-ai-visualizer-production.waleedahmed.workers.dev/api/health`

Expected: `{"ok":true,"aiBinding":true,"allowedOrigins":[...]}`
(The bare root URL returns `{"error":"Not found."}` — that is normal.)

Logs are now enabled (`observability`), so failures appear under **Observability** in the dashboard.

## 4. Shopify theme files

Online Store → Themes → … → Edit code (duplicate the theme first as a backup):
- `assets/murphy-bed-builder.js`  → replace with `shopify/murphy-bed-builder.js`
- `assets/murphy-bed-builder.css` → replace with `shopify/murphy-bed-builder.css`
- `sections/murphy-bed-builder.liquid` → replace with `shopify/murphy-bed-builder.liquid`

The section reads the product with handle `murphy-bed-customizable` — it must exist.

## 5. Create the Shopify page

1. Online Store → Themes → Customize → top dropdown → Pages → **Create template**
   named `murphy-bed-builder` (based on Default page).
2. Remove the default page sections, **Add section → Murphy Bed Builder**.
3. In the section settings:
   - ✅ Show "See It in Your Room"
   - AI room visualizer Worker URL: `https://murphy-bed-ai-visualizer-production.waleedahmed.workers.dev`
   - AI previews per visitor session: 3
4. Save.
5. Online Store → Pages → Add page (e.g. "Build Your Murphy Bed") → Theme template:
   `murphy-bed-builder` → Save. Add it to the menu if needed.

Until the Worker URL is filled in, customers do not see the visualizer; in the theme editor
you see a yellow setup notice instead.

## 6. Safeguards now in place

- Server rate limit: 5 generations per IP per minute (`ratelimits` in wrangler.jsonc).
- Client limit: configurable per session (section setting).
- 90-second request timeout; readable errors with CORS headers on every response.
- Photos are resized in the browser (long edge 1024 px) and never stored.
- AI strength can be tuned without code: add a Worker variable `AI_STRENGTH`
  (0.10–0.45, default 0.25). Lower = product stays more exact; higher = more realistic
  blending but the bed may change.

## 7. Test checklist

Bed only · left cabinet · right cabinet · both · wide side units · paint finish · stain finish ·
desktop + mobile upload (drag with finger) · invalid file · file over 12 MB ·
go Back, change finish, return to Review (bed on the photo updates) · AI error (instant preview shown).

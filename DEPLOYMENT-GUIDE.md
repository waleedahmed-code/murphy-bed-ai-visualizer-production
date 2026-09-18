# Deployment Guide

## 1. Upload to GitHub

1. Create a private empty repository named `murphy-bed-ai-visualizer`.
2. Extract this ZIP.
3. Upload the extracted project contents, not the ZIP itself.
4. Commit to the repository's main branch.

## 2. Deploy the Cloudflare Worker

1. In Cloudflare, open **Workers & Pages** and choose **Create**.
2. Import the GitHub repository.
3. Set the root directory to `cloudflare-worker`.
4. Build command: `npm run check`.
5. Deploy command: `npm run deploy`.
6. Confirm the Workers AI binding is named `AI`.
7. In Worker variables, confirm `ALLOWED_ORIGINS` contains the exact live Shopify domains, separated by commas.
8. Deploy and copy the resulting `workers.dev` URL.
9. Confirm `https://YOUR-WORKER.workers.dev/api/health` returns JSON with `"ok": true`.

## 3. Connect Shopify

1. In Shopify theme code, back up the current assets and section.
2. Replace `assets/murphy-bed-builder.js` with the complete updated JavaScript file.
3. Replace `assets/murphy-bed-builder.css` with the complete updated CSS file.
4. Replace the current Murphy Bed Builder section with `shopify/murphy-bed-builder.liquid`.
5. Open the Murphy Bed Builder section in the Shopify Theme Editor.
6. Paste the deployed Worker origin into **AI room visualizer Worker URL**. Do not add a trailing slash.

## 4. Production safeguards

- Create a Cloudflare rate-limiting rule for `POST /api/generate-room-preview` before public launch.
- Keep the frontend two-generation session limit enabled.
- Accepted room photos: JPG, PNG and WebP, maximum 8 MB.
- The package does not save room photos or generated results to R2.
- Verify the Shopify CDN permits canvas use for every selected PNG asset. The script reports a clear error if an asset cannot be captured because of CORS.
- AI visualization is illustrative. It is not a measurement or installation guarantee.

## 5. Required checks before enabling for customers

Test one configuration for each of these cases:

- Bed only.
- Left cabinet.
- Right cabinet.
- Both cabinets.
- Wide side units.
- Paint finish.
- Wood stain finish.
- Desktop and mobile upload.
- Invalid file type and file over 8 MB.
- AI service error and retry.

# Island Murphy Beds — AI Room Visualizer

- `cloudflare-worker/` — Workers AI (SDXL img2img) API: `/api/health`, `/api/generate-room-preview`.
- `shopify/` — complete Liquid section, CSS and JS for the Murphy Bed Builder.
- `DEPLOYMENT-GUIDE.md` — GitHub, Cloudflare and Shopify steps.

The browser captures the exact visible bed layers, lets the customer position them on their
room photo, and sends the composite to the Worker for a low-strength realism pass.
Photos are processed in memory and never stored.

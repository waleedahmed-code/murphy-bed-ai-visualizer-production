# Island Murphy Beds AI Room Visualizer

Production integration package for the existing Shopify Murphy Bed Builder.

## Contents

- `cloudflare-worker/`: Workers AI image-to-image API.
- `shopify/`: complete updated Liquid, CSS and JavaScript files.
- `DEPLOYMENT-GUIDE.md`: GitHub, Cloudflare and Shopify deployment steps.

The browser composites the exact visible Murphy Bed layers onto the customer's room photo. Cloudflare Workers AI then adds a low-strength realism pass. Uploaded photos are processed in memory and are not stored by this package.

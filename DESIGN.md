---
version: alpha
colors:
  primary: "#00243C"
  accent: "#5CCC96"
  surface: "#FFFFFF"
  background: "#F4F7F8"
  text: "#334E68"
  muted: "#678197"
typography:
  sans:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
rounded:
  card: "18px"
  control: "12px"
spacing:
  unit: "4px"
components:
  uploadZone:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
  primaryButton:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  helperText:
    textColor: "{colors.muted}"
    typography: "{typography.sans}"
  successState:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
---

## Overview

The visualizer extends the existing Island Murphy Beds builder. It should feel like a measured showroom consultation: calm, materially grounded and precise. The product image remains the visual focus. Avoid generic AI gradients, glass effects and decorative animation.

## Colors

Use the existing deep navy for primary actions and mint green for confirmation and focus accents. Error states use direct text and borders, never color alone.

## Typography

Inherit the builder's system sans stack and established hierarchy. Keep helper copy compact and readable.

## Layout

The visualizer belongs inside the final review step. It is full width within that panel and collapses cleanly on narrow screens.

## Elevation & Depth

Use the builder's existing subtle surface shadows. Generated imagery uses a fixed aspect-ratio frame to prevent layout shift.

## Shapes

Use the builder's medium card and control radii. The upload zone is dashed to communicate file input.

## Components

The upload zone supports click, keyboard and drag-and-drop. Busy, success and error states retain stable geometry. Generation is limited to two attempts per browser session.

## Do's and Don'ts

Do preserve the exact configured product and disclose that the render is illustrative. Do not claim exact dimensional accuracy or permanently retain customer photos.

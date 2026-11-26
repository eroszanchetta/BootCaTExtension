# Sbafo — BootCaT mascot

`BootCaT.svg` is the maintainer-provided 2026 `sbafo-vector.svg`, preserved byte for byte. Its viewBox is 0 0 600 741. White markings are opaque; the background is transparent.

The workspace and popup use this shared vector without an added backing. The floating control embeds its paths during the normal build, so it needs no web-accessible resources, remote requests or website CSP exception.

The browser toolbar, favicons and both manifests use square PNGs rendered from `toolbar.svg`: Sbafo directly on a light blue (`#dceaf3`) rounded-square background, without a white circle. The original `BootCaT.svg` remains unchanged for workspace, popup and floating controls.

`toolbar.svg` embeds the original vector paths at a fixed scale, so rendering needs no external files. Regenerate the committed PNGs with ImageMagick:

```sh
magick -background none src/icons/toolbar.svg -resize 16x16 src/icons/icon-16.png
magick -background none src/icons/toolbar.svg -resize 32x32 src/icons/icon-32.png
magick -background none src/icons/toolbar.svg -resize 48x48 src/icons/icon-48.png
magick -background none src/icons/toolbar.svg src/icons/icon-128.png
```

Normal extension builds use the committed PNGs and do not require an image renderer.

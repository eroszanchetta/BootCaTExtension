# Sbafo — BootCaT mascot

`BootCaT.svg` is the maintainer-provided 2026 `sbafo-vector.svg`, preserved byte for byte. Its viewBox is 0 0 600 741. White markings are opaque; the background is transparent.

The workspace and popup use this shared vector without an added backing. The floating control embeds its paths during the normal build, so it needs no web-accessible resources, remote requests or website CSP exception.

The browser toolbar, favicons and both manifests use square transparent PNGs rendered from the same artwork. Regenerate 16/32/48 px with ImageMagick:

```
magick -background none src/icons/BootCaT.svg -resize 32x32 -gravity center -extent 32x32 src/icons/icon-32.png
```

Repeat for 16 and 48. For the 128 px store icon, resize to 116x116 and centre on a transparent 128x128 canvas. Normal extension builds use the committed PNGs and do not require an image renderer.

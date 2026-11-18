# Sbafo — BootCaT mascot

`BootCaT.svg` is the maintainer-provided `sbafo_vettoriale.svg`, preserved byte for byte.
Its portrait viewBox is 0 0 245 285. The workspace uses this original vector artwork.

The 16, 32, 48 and 128 pixel PNGs are square RGBA exports with the original artwork
centred at its original aspect ratio on a white rounded backing. The backing keeps
Sbafo visible on dark browser toolbars without recolouring or redrawing the mascot.
The popup, favicons and both browser manifests share these assets.

Exports were rendered with librsvg/Cairo. For 16/32/48 px, the white backing occupies
93.75% of the canvas width; for the 128 px store icon it occupies 96 px, leaving 16 px
of transparent padding per side. Corner radius is 16% of backing width and the artwork
has a 5% inset inside the backing. No images, fonts or scripts are fetched externally.
PNG files are committed: normal extension builds do not require an image renderer.

# Making a theme

A theme is a **folder** (or one `.json` file) in the themes folder. Open it from Settings > Themes > "Open the folder", or use "Create an example theme" to get a ready one to look at and copy.

```
themes/
  Night city/                    the name of the theme
    theme.json                   colours and look (optional)
    background/                  every picture or video in here is a layer
      01-sky.jpg                 the bottom layer
      02-stars-drift.svg         drifts slowly
      03-clouds-parallax.png     follows the mouse
      04-glow-scroll.png         moves with the mouse wheel
      layers.json                motion settings (optional)
  Another.json                   a theme without pictures
```

Press **Refresh** in the app after changing files (it also looks again when the window gets focus on that page).

## The rule: names decide

- The folder named `background` is the background. Whatever is in it is used, nothing has to be registered anywhere.
- Layers are stacked **by file name**: the first is the bottom one. Start names with numbers (`01`, `02`, ...). At most 12 layers.
- A word in a file name sets its motion: `parallax`, `drift`, `scroll`. The words `screen`, `multiply`, `overlay`, `lighten` set how the layer blends with the ones below.
- Pictures: `png`, `jpg`, `webp`, `gif`, `svg`, `avif` (up to 15 MB each). Videos: `mp4`, `webm` (up to 80 MB; they play muted and loop). Animated GIF, animated WebP, SVG with animation and videos play by themselves.
- Replace one file with another of the same name and that layer changes, nothing else is needed.

## Motion

| Setting | What it does |
|---|---|
| `parallax` 0 to 100 | the layer shifts against the mouse; a bigger number moves farther (the name shortcut gives 30) |
| `drift` 0 to 60, `period` 4 to 120 | slow back-and-forth movement, in px, one way takes `period` seconds (shortcut: 20 px, 40 s) |
| `scroll` 0 to 100 | the mouse wheel pushes the layer, then it settles back (shortcut: 30) |
| `opacity` 0 to 100 | how visible the layer is |
| `blend` | `normal`, `screen`, `multiply`, `overlay`, `soft-light`, `lighten`, `plus-lighter` |
| `fit` | `cover` (default) or `contain` |

`layers.json` sets them per file and wins over the name shortcuts:

```json
{
  "02-stars-drift.svg": { "drift": 12, "period": 60, "opacity": 90 },
  "04-glow-scroll.png": { "scroll": 40, "blend": "screen" }
}
```

"Animate backgrounds" in Settings > Themes switches all movement off. Everything also pauses while the window is hidden.

## theme.json

The same file the app exports ("Export…"). Only what you list is changed, the rest comes from `base` (`silver` is light, `graphite` is dark).

```json
{
  "format": "silverpane-theme",
  "version": 1,
  "name": "Night city",
  "base": "graphite",
  "colors": { "accent": "#ff9f43", "panelFrom": "#2a2250", "panelMid": "#1b1838", "panelTo": "#0f0d22" },
  "shape": { "radius": 18, "blur": 18, "thumb": 48, "density": "normal", "npSide": "right", "font": "system" }
}
```

Colours: `text`, `textDim`, `accent`, `panelFrom`, `panelMid`, `panelTo`, `card`, `cardEdge`, `rowHover`, `track`, `popup`, `gloss`, `shadow` (`#rrggbb` or `rgba(r, g, b, a)`).

## From Figma

1. Draw every layer of the background as its own frame or group. Export each as **PNG or SVG** (2x for PNG) into `background/` with the names above.
2. Colours and sizes: "Export for Figma…" gives a Tokens Studio file. Import it into the plugin, change the variables, export from the plugin, then "Import file…" in Silverpane.

Figma does not export its animations (Smart Animate and the like) as files, so the movement comes from the names or `layers.json`. A real animation can be a video (`mp4`, `webm`), a GIF or an SVG with animation in the layer.

## Safety

Pictures are drawn only with `<img>` and `<video>`, so a file cannot run code. Only the listed file types are read, only from a theme's `background/` folder; links that lead out of the themes folder are ignored. A theme can not change anything except how the app looks.

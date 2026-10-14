# lisn-site

The LISN StemSplitter website. GitHub Pages serves `main` at https://lisn.digital/ (the domain is set by the `CNAME` file; DNS is at GoDaddy). Plain HTML and CSS, no build: edit, commit, push, and it's live in about a minute.

- `index.html`: the page, plus the small script that draws the Dusk and Midnight waves.
- `styles.css`: every style, taken from the Claude Design export.
- `app.js`: the working LISN window in the hero. It plays the demo song and splits 15 s of a visitor's own song in the browser (WebGPU: onnxruntime-web and htdemucs-web-onnx, loaded from CDNs only when someone presses New song). Its layout and colours copy lisn-vst's `Source/`.
- `assets/demo/`: the demo song's four stems. The song is "Late Night Demo", the promo video's soundtrack (synthesised in lisn-vst `brag-output/work/music.py`), rendered clean at 74 BPM and split by LISN.
- After changing `styles.css` or `app.js`, bump the `?v=` on its link in `index.html`: Pages caches CSS for 10 minutes, and new HTML with old CSS breaks the window.
- `assets/`: self-hosted fonts (SIL OFL, licence texts next to them), favicon and the social preview image.

The Download buttons point at `https://github.com/EdiKrasniqi11/lisn-vst/releases/latest/download/LISN-StemSplitter-Setup.exe` (the VST3) and `.../releases/latest/download/LISN-Setup.exe` (the desktop app), so publishing a new lisn-vst release updates both downloads without touching this repo.

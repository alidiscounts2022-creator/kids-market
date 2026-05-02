import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const JSZip = require("jszip");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const brandDir = path.join(root, "assets", "brand");
const sourceDir = path.join(brandDir, "source");
const outDirs = {
  source: sourceDir,
  social: path.join(brandDir, "social"),
  print: path.join(brandDir, "print"),
  web: path.join(brandDir, "web"),
};

const master = path.join(sourceDir, "tafli-market-master.png");

const transparent = {
  mark: path.join(sourceDir, "tafli-market-mark-transparent.png"),
  header: path.join(sourceDir, "tafli-market-logo-header-transparent.png"),
  headerWhite: path.join(sourceDir, "tafli-market-logo-header-white-transparent.png"),
  combo: path.join(sourceDir, "tafli-market-logo-combo-transparent.png"),
  comboWhite: path.join(sourceDir, "tafli-market-logo-combo-white-transparent.png"),
  primary: path.join(sourceDir, "tafli-market-logo-primary-transparent.png"),
  stacked: path.join(sourceDir, "tafli-market-logo-stacked-transparent.png"),
  white: path.join(sourceDir, "tafli-market-logo-white-transparent.png"),
};

const crops = {
  mark: { left: 245, top: 175, width: 330, height: 235 },
  header: { left: 650, top: 285, width: 670, height: 135 },
  primary: { left: 650, top: 285, width: 670, height: 205 },
  stacked: { left: 130, top: 170, width: 570, height: 430 },
};

const transparentBackground = { r: 255, g: 255, b: 255, alpha: 0 };
const whiteBackground = { r: 255, g: 255, b: 255, alpha: 1 };

async function ensureDirs() {
  await Promise.all(Object.values(outDirs).map((dir) => fs.mkdir(dir, { recursive: true })));
}

function fadeWhiteBackground(data, channels) {
  for (let p = 0; p < data.length; p += channels) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const alphaIndex = p + 3;
    const minChannel = Math.min(r, g, b);

    if (r > 238 && g > 238 && b > 238) {
      const edgeAlpha = Math.max(0, Math.min(255, (255 - minChannel) * 16));
      data[alphaIndex] = Math.min(data[alphaIndex], edgeAlpha);
    }
  }
}

function clearCropNoise(data, info, zones = []) {
  for (const zone of zones) {
    const startX = Math.max(0, zone.left);
    const startY = Math.max(0, zone.top);
    const endX = Math.min(info.width, zone.left + zone.width);
    const endY = Math.min(info.height, zone.top + zone.height);

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        data[(y * info.width + x) * info.channels + 3] = 0;
      }
    }
  }
}

async function extractTransparent(crop, output, zones = []) {
  const { data, info } = await sharp(master)
    .extract(crop)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  fadeWhiteBackground(data, info.channels);
  clearCropNoise(data, info, zones);

  const trimmed = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .trim({ background: transparentBackground, threshold: 2 })
    .png()
    .toBuffer();

  const meta = await sharp(trimmed).metadata();
  const padX = Math.max(14, Math.round(meta.width * 0.04));
  const padY = Math.max(12, Math.round(meta.height * 0.06));

  await sharp(trimmed)
    .extend({
      top: padY,
      bottom: padY,
      left: padX,
      right: padX,
      background: transparentBackground,
    })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function makeWhiteLogo(input, output) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let p = 0; p < data.length; p += info.channels) {
    if (data[p + 3] > 0) {
      data[p] = 255;
      data[p + 1] = 255;
      data[p + 2] = 255;
    }
  }

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function buildLogoCombo({ wordmark, output, markHeight = 168, wordmarkHeight = 118 }) {
  const markBuffer = await sharp(transparent.mark)
    .resize({ height: markHeight, fit: "contain", background: transparentBackground })
    .png()
    .toBuffer();
  const wordmarkBuffer = await sharp(wordmark)
    .resize({ height: wordmarkHeight, fit: "contain", background: transparentBackground })
    .png()
    .toBuffer();

  const markMeta = await sharp(markBuffer).metadata();
  const wordmarkMeta = await sharp(wordmarkBuffer).metadata();
  const gap = 22;
  const paddingX = 24;
  const paddingY = 18;
  const canvasWidth = markMeta.width + wordmarkMeta.width + gap + paddingX * 2;
  const canvasHeight = Math.max(markMeta.height, wordmarkMeta.height) + paddingY * 2;

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: transparentBackground,
    },
  })
    .composite([
      {
        input: markBuffer,
        left: paddingX,
        top: Math.round((canvasHeight - markMeta.height) / 2),
      },
      {
        input: wordmarkBuffer,
        left: paddingX + markMeta.width + gap,
        top: Math.round((canvasHeight - wordmarkMeta.height) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function renderContained({ src, name, width, height, background = transparentBackground, format }) {
  const output = path.join(brandDir, name);
  const ext = format || path.extname(name).toLowerCase().slice(1);
  let pipeline = sharp(src).resize({
    width,
    height,
    fit: "contain",
    withoutEnlargement: false,
    background,
  });

  if (ext === "webp") {
    pipeline = pipeline.webp({ quality: 94 });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }

  await pipeline.toFile(output);
}

async function placeOnCanvas({
  src,
  name,
  width,
  height,
  innerWidth = Math.round(width * 0.78),
  innerHeight = Math.round(height * 0.68),
  background = whiteBackground,
}) {
  const resized = await sharp(src)
    .resize({
      width: innerWidth,
      height: innerHeight,
      fit: "contain",
      background: transparentBackground,
    })
    .png()
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  })
    .composite([
      {
        input: resized,
        left: Math.round((width - resizedMeta.width) / 2),
        top: Math.round((height - resizedMeta.height) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(brandDir, name));
}

async function buildSvgWrapper({ png, name, width, height }) {
  const data = await fs.readFile(png);
  const base64 = data.toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">\n  <title id="title">طفلي ماركت</title>\n  <image href="data:image/png;base64,${base64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>\n</svg>\n`;
  await fs.writeFile(path.join(brandDir, name), svg, "utf8");
}

const jobs = [
  { src: transparent.mark, name: "web/favicon-64.png", width: 64, height: 64 },
  { src: transparent.mark, name: "web/favicon-192.png", width: 192, height: 192 },
  { src: transparent.mark, name: "web/favicon-512.png", width: 512, height: 512 },
  { src: transparent.mark, name: "web/apple-touch-icon.png", width: 180, height: 180 },
  { src: transparent.mark, name: "social/profile-mark-1024.png", width: 1024, height: 1024 },
  { src: transparent.mark, name: "social/profile-mark-512.png", width: 512, height: 512 },
  { src: transparent.header, name: "web/logo-header-640.webp", width: 640 },
  { src: transparent.combo, name: "web/logo-combo-900.webp", width: 900 },
  { src: transparent.comboWhite, name: "web/logo-combo-white-1200.webp", width: 1200 },
  { src: transparent.primary, name: "web/logo-primary-1200.webp", width: 1200 },
  { src: transparent.white, name: "web/logo-white-1200.webp", width: 1200 },
  { src: transparent.mark, name: "web/logo-mark-512.webp", width: 512, height: 512 },
  { src: transparent.primary, name: "print/letterhead-logo-2400.png", width: 2400 },
  { src: transparent.white, name: "print/packaging-logo-white-2400.png", width: 2400 },
];

const canvasJobs = [
  {
    src: transparent.stacked,
    name: "social/facebook-profile-1024.png",
    width: 1024,
    height: 1024,
    innerWidth: 830,
    innerHeight: 720,
  },
  {
    src: transparent.stacked,
    name: "social/whatsapp-profile-1024.png",
    width: 1024,
    height: 1024,
    innerWidth: 830,
    innerHeight: 720,
  },
  {
    src: transparent.primary,
    name: "social/facebook-cover-1640x624.png",
    width: 1640,
    height: 624,
    innerWidth: 1160,
    innerHeight: 300,
  },
  {
    src: transparent.stacked,
    name: "print/packaging-logo-square-3000.png",
    width: 3000,
    height: 3000,
    innerWidth: 2380,
    innerHeight: 2140,
    background: transparentBackground,
  },
];

async function buildZip() {
  const zip = new JSZip();
  const files = [
    "README.md",
    "tafli-market-logo-primary.svg",
    "tafli-market-logo-stacked.svg",
    "tafli-market-logo-white.svg",
    "tafli-market-mark.svg",
    "source/tafli-market-master.png",
    ...Object.values(transparent).map((file) => path.relative(brandDir, file)),
    ...jobs.map((job) => job.name),
    ...canvasJobs.map((job) => job.name),
  ];

  for (const relative of files) {
    const absolute = path.join(brandDir, relative);
    zip.file(relative.replaceAll("\\", "/"), await fs.readFile(absolute));
  }

  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(path.join(brandDir, "tafli-market-logo-pack.zip"), archive);
}

await ensureDirs();
await extractTransparent(crops.mark, transparent.mark);
await extractTransparent(crops.header, transparent.header);
await extractTransparent(crops.primary, transparent.primary, [
  { left: 0, top: 120, width: 82, height: 95 },
]);
await extractTransparent(crops.stacked, transparent.stacked, [
  { left: 500, top: 100, width: 80, height: 150 },
]);
await makeWhiteLogo(transparent.primary, transparent.white);
await makeWhiteLogo(transparent.header, transparent.headerWhite);
await buildLogoCombo({ wordmark: transparent.header, output: transparent.combo });
await buildLogoCombo({ wordmark: transparent.headerWhite, output: transparent.comboWhite });

await buildSvgWrapper({
  png: transparent.mark,
  name: "tafli-market-mark.svg",
  width: 390,
  height: 270,
});
await buildSvgWrapper({
  png: transparent.combo,
  name: "tafli-market-logo-primary.svg",
  width: 900,
  height: 220,
});
await buildSvgWrapper({
  png: transparent.stacked,
  name: "tafli-market-logo-stacked.svg",
  width: 640,
  height: 500,
});
await buildSvgWrapper({
  png: transparent.white,
  name: "tafli-market-logo-white.svg",
  width: 760,
  height: 270,
});

for (const job of jobs) {
  await renderContained(job);
}

for (const job of canvasJobs) {
  await placeOnCanvas(job);
}

await buildZip();

console.log(`Generated ${jobs.length + canvasJobs.length} brand exports from ${master}`);

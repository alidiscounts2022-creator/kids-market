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
const outDirs = {
  social: path.join(brandDir, "social"),
  print: path.join(brandDir, "print"),
  web: path.join(brandDir, "web"),
};

const source = {
  mark: path.join(brandDir, "tafli-market-mark.svg"),
  primary: path.join(brandDir, "tafli-market-logo-primary.svg"),
  stacked: path.join(brandDir, "tafli-market-logo-stacked.svg"),
  white: path.join(brandDir, "tafli-market-logo-white.svg"),
};

const jobs = [
  { src: source.mark, name: "web/favicon-64.png", width: 64, height: 64 },
  { src: source.mark, name: "web/favicon-192.png", width: 192, height: 192 },
  { src: source.mark, name: "web/favicon-512.png", width: 512, height: 512 },
  { src: source.mark, name: "web/apple-touch-icon.png", width: 180, height: 180 },
  { src: source.mark, name: "social/profile-mark-1024.png", width: 1024, height: 1024 },
  { src: source.mark, name: "social/profile-mark-512.png", width: 512, height: 512 },
  { src: source.stacked, name: "social/facebook-profile-1024.png", width: 1024, height: 1024 },
  { src: source.stacked, name: "social/whatsapp-profile-1024.png", width: 1024, height: 1024 },
  { src: source.primary, name: "social/facebook-cover-1640x624.png", width: 1640, height: 624 },
  { src: source.primary, name: "print/letterhead-logo-2400.png", width: 2400 },
  { src: source.white, name: "print/packaging-logo-white-2400.png", width: 2400 },
  { src: source.stacked, name: "print/packaging-logo-square-3000.png", width: 3000, height: 3000 },
  { src: source.primary, name: "web/logo-primary-1200.webp", width: 1200 },
  { src: source.mark, name: "web/logo-mark-512.webp", width: 512, height: 512 },
];

async function ensureDirs() {
  await Promise.all(Object.values(outDirs).map((dir) => fs.mkdir(dir, { recursive: true })));
}

async function render({ src, name, width, height }) {
  const output = path.join(brandDir, name);
  const ext = path.extname(name).toLowerCase();
  let pipeline = sharp(src, { density: 240 }).resize({
    width,
    height,
    fit: "contain",
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  });

  if (ext === ".webp") {
    pipeline = pipeline.webp({ quality: 94 });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }

  await pipeline.toFile(output);
}

async function buildZip() {
  const zip = new JSZip();
  const files = [
    "tafli-market-logo-primary.svg",
    "tafli-market-logo-stacked.svg",
    "tafli-market-logo-white.svg",
    "tafli-market-mark.svg",
    "README.md",
    ...jobs.map((job) => job.name),
  ];

  for (const relative of files) {
    const absolute = path.join(brandDir, relative);
    zip.file(relative.replaceAll("\\", "/"), await fs.readFile(absolute));
  }

  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(path.join(brandDir, "tafli-market-logo-pack.zip"), archive);
}

await ensureDirs();
for (const job of jobs) {
  await render(job);
}
await buildZip();

console.log(`Generated ${jobs.length} brand exports in ${brandDir}`);

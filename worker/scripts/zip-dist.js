const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const distDir = path.resolve(__dirname, "..", "dist");
const outPath = path.resolve(__dirname, "..", "dist.zip");

if (!fs.existsSync(distDir)) {
  console.error("dist/ no existe. Ejecuta pnpm run build primero.");
  process.exit(1);
}

if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

const output = fs.createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`dist.zip creado: ${mb} MB (${archive.pointer()} bytes)`);
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(distDir, false);
archive.finalize();

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scanRoots = [
  "apps/web/app",
  "apps/web/components",
];

const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const issues = [];

function collectFiles(dirPath, files = []) {
  const stat = fs.statSync(dirPath);
  if (stat.isFile()) {
    files.push(dirPath);
    return files;
  }

  for (const entry of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, entry);
    const childStat = fs.statSync(full);
    if (childStat.isDirectory()) {
      collectFiles(full, files);
    } else if (allowedExtensions.has(path.extname(full))) {
      files.push(full);
    }
  }

  return files;
}

function lineOfIndex(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

for (const base of scanRoots) {
  const abs = path.join(root, base);
  if (!fs.existsSync(abs)) continue;
  const files = collectFiles(abs, []);
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const idx = content.indexOf("\uFFFD");
    if (idx >= 0) {
      issues.push({
        file: path.relative(root, file).replaceAll("\\", "/"),
        line: lineOfIndex(content, idx),
      });
    }
  }
}

if (issues.length > 0) {
  console.error("Replacement-character check failed:");
  for (const issue of issues) {
    console.error(`- ${issue.file}:${issue.line} Contains U+FFFD (Korean text encoding corruption).`);
  }
  process.exit(1);
}

console.log("Replacement-character check passed.");

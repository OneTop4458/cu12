import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const allowKorean = new Set([
  path.join(root, "README.ko.md"),
]);

const scanTargets = [
  "README.md",
  "README.ko.md",
  "AGENTS.md",
  "docs",
];

const textExtensions = new Set([".md", ".yaml", ".yml"]);

const issues = [];

function collectFiles(entryPath) {
  const fullPath = path.join(root, entryPath);
  if (!fs.existsSync(fullPath)) return [];

  const stat = fs.statSync(fullPath);
  if (stat.isFile()) return [fullPath];

  const files = [];
  const stack = [fullPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const currentStat = fs.statSync(current);
    if (currentStat.isDirectory()) {
      const children = fs
        .readdirSync(current)
        .map((name) => path.join(current, name));
      stack.push(...children);
    } else if (textExtensions.has(path.extname(current))) {
      files.push(current);
    }
  }

  return files;
}

function addIssue(file, lineNo, kind, detail) {
  issues.push({
    file: path.relative(root, file).replaceAll("\\", "/"),
    lineNo,
    kind,
    detail,
  });
}

function lineOfIndex(content, idx) {
  const prefix = content.slice(0, idx);
  return prefix.split(/\r?\n/).length;
}

const koreanOrCjk = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u4E00-\u9FFF]/u;

for (const target of scanTargets) {
  const files = collectFiles(target);

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");

    if (content.charCodeAt(0) === 0xfeff) {
      addIssue(file, 1, "bom", "File starts with UTF-8 BOM.");
    }

    const replacementIndex = content.indexOf("\uFFFD");
    if (replacementIndex >= 0) {
      addIssue(
        file,
        lineOfIndex(content, replacementIndex),
        "replacement-character",
        "Contains Unicode replacement character.",
      );
    }

    if (!allowKorean.has(file)) {
      const koreanMatch = koreanOrCjk.exec(content);
      if (koreanMatch?.index !== undefined) {
        addIssue(
          file,
          lineOfIndex(content, koreanMatch.index),
          "non-english-text",
          "English-only docs policy violation.",
        );
      }
    }
  }
}

if (issues.length > 0) {
  console.error("Text quality check failed:");
  for (const issue of issues) {
    const loc = `${issue.file}:${issue.lineNo}`;
    console.error(`- [${issue.kind}] ${loc} ${issue.detail}`);
  }
  process.exit(1);
}

console.log("Text quality check passed.");
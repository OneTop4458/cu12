import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.join(repoRoot, "apps", "web");
const shimDir = path.join(__dirname, "bin");
const binaryName = process.platform === "win32" ? "prisma.cmd" : "prisma";
const prismaBinCandidates = [
  path.join(repoRoot, "node_modules", ".bin", binaryName),
  path.join(workspaceRoot, "node_modules", ".bin", binaryName),
];
const prismaBin = prismaBinCandidates.find((candidate) => existsSync(candidate));
if (!prismaBin) {
  console.error("Unable to locate Prisma CLI binary.");
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const hasSchemaArg = extraArgs.some((arg) => arg === "--schema" || arg.startsWith("--schema="));
const schemaPath = path.join(repoRoot, "prisma", "schema.prisma");
const args = hasSchemaArg ? extraArgs : [...extraArgs, "--schema", schemaPath];
const pathKey = process.platform === "win32" ? "Path" : "PATH";
const currentPath = process.env[pathKey] ?? process.env.PATH ?? "";
const env = {
  ...process.env,
  [pathKey]: currentPath ? `${shimDir}${path.delimiter}${currentPath}` : shimDir,
};

function quoteForPowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const result = process.platform === "win32"
  ? spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `& ${quoteForPowerShell(prismaBin)} ${args.map(quoteForPowerShell).join(" ")}`,
      ],
      {
        cwd: workspaceRoot,
        env,
        stdio: "inherit",
      }
    )
  : spawnSync(prismaBin, args, {
      cwd: workspaceRoot,
      env,
      stdio: "inherit",
    });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
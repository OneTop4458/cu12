import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const openApiPath = path.join(root, "docs", "04-api", "openapi.yaml");
const routeRoot = path.join(root, "apps", "web", "app");
const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function normalizeRoutePath(filePath) {
  const relative = path.relative(routeRoot, filePath).replaceAll("\\", "/");
  if (!relative.endsWith("/route.ts")) return null;
  if (!relative.startsWith("api/") && !relative.startsWith("internal/")) return null;

  const route = `/${relative.replace(/\/route\.ts$/, "")}`;
  return route.replace(/\[([^\]]+)\]/g, "{$1}");
}

function collectRouteFiles(dirPath, files = []) {
  const stat = fs.statSync(dirPath);
  if (stat.isFile()) {
    files.push(dirPath);
    return files;
  }

  for (const entry of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, entry);
    const childStat = fs.statSync(fullPath);
    if (childStat.isDirectory()) {
      collectRouteFiles(fullPath, files);
    } else if (entry === "route.ts") {
      files.push(fullPath);
    }
  }

  return files;
}

function collectImplementationMap() {
  const map = new Map();
  const files = collectRouteFiles(routeRoot, []);

  for (const filePath of files) {
    const routePath = normalizeRoutePath(filePath);
    if (!routePath) continue;

    const content = fs.readFileSync(filePath, "utf8");
    const methods = new Set();
    const matches = content.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g);
    for (const match of matches) {
      methods.add(match[1].toUpperCase());
    }
    if (methods.size === 0) continue;
    map.set(routePath, methods);
  }

  return map;
}

function collectOpenApiMap() {
  const map = new Map();
  const content = fs.readFileSync(openApiPath, "utf8");
  const lines = content.split(/\r?\n/);
  let currentPath = null;

  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      if (!map.has(currentPath)) {
        map.set(currentPath, new Set());
      }
      continue;
    }

    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (currentPath && methodMatch) {
      map.get(currentPath).add(methodMatch[1].toUpperCase());
    }
  }

  return map;
}

function formatPathMethods(pathName, methods) {
  return `${pathName} [${[...methods].sort().join(", ")}]`;
}

function sortStrings(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function main() {
  if (!fs.existsSync(openApiPath)) {
    console.error(`OpenAPI file not found: ${openApiPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(routeRoot)) {
    console.error(`Route root not found: ${routeRoot}`);
    process.exit(1);
  }

  const impl = collectImplementationMap();
  const spec = collectOpenApiMap();

  const inSpecOnly = [];
  const inImplOnly = [];
  const methodMismatches = [];

  for (const [pathName, specMethods] of spec) {
    const implMethods = impl.get(pathName);
    if (!implMethods) {
      inSpecOnly.push(formatPathMethods(pathName, specMethods));
      continue;
    }

    const missingInSpec = [...implMethods].filter((method) => !specMethods.has(method));
    const missingInImpl = [...specMethods].filter((method) => !implMethods.has(method));
    if (missingInSpec.length > 0 || missingInImpl.length > 0) {
      methodMismatches.push({
        pathName,
        missingInSpec: sortStrings(missingInSpec),
        missingInImpl: sortStrings(missingInImpl),
      });
    }
  }

  for (const [pathName, implMethods] of impl) {
    const specMethods = spec.get(pathName);
    if (!specMethods) {
      inImplOnly.push(formatPathMethods(pathName, implMethods));
      continue;
    }

    for (const method of implMethods) {
      if (!allowedMethods.has(method)) {
        console.error(`Unsupported method in implementation map: ${method} on ${pathName}`);
        process.exit(1);
      }
    }
  }

  if (inSpecOnly.length === 0 && inImplOnly.length === 0 && methodMismatches.length === 0) {
    console.log("OpenAPI route sync check passed.");
    return;
  }

  console.error("OpenAPI route sync check failed.");

  if (inSpecOnly.length > 0) {
    console.error("- Paths/methods in OpenAPI only:");
    for (const row of sortStrings(inSpecOnly)) {
      console.error(`  - ${row}`);
    }
  }

  if (inImplOnly.length > 0) {
    console.error("- Paths/methods in implementation only:");
    for (const row of sortStrings(inImplOnly)) {
      console.error(`  - ${row}`);
    }
  }

  if (methodMismatches.length > 0) {
    console.error("- Method mismatches:");
    for (const row of methodMismatches.sort((a, b) => a.pathName.localeCompare(b.pathName))) {
      console.error(`  - ${row.pathName}`);
      if (row.missingInSpec.length > 0) {
        console.error(`    missing in OpenAPI: ${row.missingInSpec.join(", ")}`);
      }
      if (row.missingInImpl.length > 0) {
        console.error(`    missing in implementation: ${row.missingInImpl.join(", ")}`);
      }
    }
  }

  process.exit(1);
}

main();

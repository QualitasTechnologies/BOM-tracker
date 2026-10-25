// Copies the CJS writer and its shared command engine beside the compiled index. No other files are copied.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
copyFileSync(join(root, "src", "mcpMaterialWriter.cjs"), join(dist, "mcpMaterialWriter.cjs"));
copyFileSync(join(root, "..", "functions", "materialCommands.cjs"), join(dist, "materialCommands.cjs"));

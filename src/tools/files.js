import fs from "fs/promises";
import path from "path";

const PROJECT_ROOT = path.resolve(process.cwd());

function safePath(targetPath) {
  const resolved = path.resolve(PROJECT_ROOT, targetPath);

  if (
    resolved !== PROJECT_ROOT &&
    !resolved.startsWith(PROJECT_ROOT + path.sep)
  ) {
    throw new Error("Access denied: path is outside the PHANTØM project.");
  }

  return resolved;
}

export async function readFile(targetPath) {
  const filePath = safePath(targetPath);
  return await fs.readFile(filePath, "utf8");
}

export async function writeFile(targetPath, content) {
  const filePath = safePath(targetPath);

  await fs.mkdir(path.dirname(filePath), {
    recursive: true
  });

  await fs.writeFile(filePath, content, "utf8");

  return `File written successfully: ${targetPath}`;
}

export async function listFiles(targetPath = ".") {
  const directory = safePath(targetPath);
  const entries = await fs.readdir(directory, {
    withFileTypes: true
  });

  return entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "directory" : "file"
  }));
}

export async function fileExists(targetPath) {
  try {
    await fs.access(safePath(targetPath));
    return true;
  } catch {
    return false;
  }
}
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function runCommand(command, options = {}) {
  if (!command || typeof command !== "string") {
    throw new Error("A command is required.");
  }

  const {
    cwd = process.cwd(),
    timeout = 120000
  } = options;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024
    });

    return {
      success: true,
      command,
      stdout,
      stderr
    };
  } catch (error) {
    return {
      success: false,
      command,
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      code: error.code
    };
  }
}
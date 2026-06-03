import { execFileSync } from "node:child_process";

const SERVICE_NAME = "Meow Pilot";

export class SecretStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretStoreError";
  }
}

export function saveSecret(account: string, secret: string) {
  if (process.platform !== "darwin") {
    throw new SecretStoreError("Local API keys require macOS Keychain. Use environment variables on this platform.");
  }

  try {
    execFileSync("security", ["add-generic-password", "-a", account, "-s", SERVICE_NAME, "-w", secret, "-U"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    throw new SecretStoreError("Failed to write API key to macOS Keychain.", { cause: error });
  }
}

export function loadSecret(account: string) {
  if (process.platform !== "darwin") return null;

  try {
    const secret = execFileSync("security", ["find-generic-password", "-a", account, "-s", SERVICE_NAME, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return secret || null;
  } catch {
    return null;
  }
}

export function maskSecret(secret: string | undefined) {
  if (!secret) return undefined;
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 3)}****${secret.slice(-4)}`;
}

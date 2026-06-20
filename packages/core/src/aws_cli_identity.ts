/**
 * AWS credential bridge — uses AWS CLI `sts get-caller-identity` when configured.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

const execFileAsync = promisify(execFile);

export interface AwsCallerIdentity {
  accountId: string;
  arn: string;
  userId: string;
}

export function awsProfileFromEnv(): string | undefined {
  return (
    effectiveHarnessEnvRaw("AWS_PROFILE")?.trim() ||
    process.env.AWS_PROFILE?.trim() ||
    undefined
  );
}

export function awsRegionFromEnv(): string {
  return (
    effectiveHarnessEnvRaw("AGENT_AWS_REGION")?.trim() ||
    effectiveHarnessEnvRaw("AWS_REGION")?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1"
  );
}

export async function tryAwsStsGetCallerIdentity(profile?: string): Promise<AwsCallerIdentity | null> {
  const awsBin = process.platform === "win32" ? "aws.cmd" : "aws";
  const args = ["sts", "get-caller-identity", "--output", "json"];
  const p = profile ?? awsProfileFromEnv();
  if (p) args.push("--profile", p);
  try {
    const { stdout } = await execFileAsync(awsBin, args, { timeout: 25_000, windowsHide: true });
    const parsed = JSON.parse(stdout) as {
      Account?: string;
      Arn?: string;
      UserId?: string;
    };
    const accountId = parsed.Account?.trim();
    const arn = parsed.Arn?.trim();
    const userId = parsed.UserId?.trim();
    if (!accountId || !arn || !userId) return null;
    return { accountId, arn, userId };
  } catch {
    return null;
  }
}

export function awsCredentialsConfigured(): boolean {
  if (process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim()) {
    return true;
  }
  if (awsProfileFromEnv()) return true;
  return false;
}

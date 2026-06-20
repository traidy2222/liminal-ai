/**
 * SigV4-signed fetch for AWS IAM MCP endpoints.
 */
import aws4 from "aws4";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { URL } from "node:url";
import {
  awsProfileFromEnv,
  awsRegionFromEnv,
  effectiveHarnessEnvRaw,
} from "@liminal/core";

const execFileAsync = promisify(execFile);

async function resolveAwsSigningCredentials(profile?: string): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
} | null> {
  if (process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim()) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
      sessionToken: process.env.AWS_SESSION_TOKEN?.trim(),
    };
  }
  const awsBin = process.platform === "win32" ? "aws.cmd" : "aws";
  const args = ["configure", "export-credentials", "--format", "json"];
  const p = profile ?? awsProfileFromEnv();
  if (p) args.push("--profile", p);
  try {
    const { stdout } = await execFileAsync(awsBin, args, { timeout: 20_000, windowsHide: true });
    const parsed = JSON.parse(stdout) as {
      AccessKeyId?: string;
      SecretAccessKey?: string;
      SessionToken?: string;
    };
    const accessKeyId = parsed.AccessKeyId?.trim();
    const secretAccessKey = parsed.SecretAccessKey?.trim();
    if (!accessKeyId || !secretAccessKey) return null;
    return {
      accessKeyId,
      secretAccessKey,
      sessionToken: parsed.SessionToken?.trim(),
    };
  } catch {
    return null;
  }
}

export interface AwsIamAuth {
  kind: "aws_iam";
  region?: string;
  service?: string;
  profile?: string;
}

export function awsIamAuthScheme(opts?: {
  region?: string;
  service?: string;
  profile?: string;
}): AwsIamAuth {
  return {
    kind: "aws_iam",
    region: opts?.region ?? awsRegionFromEnv(),
    service:
      opts?.service?.trim() ||
      effectiveHarnessEnvRaw("AGENT_AWS_MCP_SERVICE")?.trim() ||
      "aws-mcp",
    profile: opts?.profile ?? awsProfileFromEnv(),
  };
}

export async function awsSignedFetch(
  url: string,
  init: RequestInit & { auth: AwsIamAuth },
  timeoutMs = 60_000
): Promise<Response> {
  const parsed = new URL(url);
  const body =
    typeof init.body === "string"
      ? init.body
      : init.body
        ? String(init.body)
        : undefined;
  const headers: Record<string, string> = {};
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) headers[k] = v;
    } else {
      Object.assign(headers, init.headers);
    }
  }
  if (body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (!headers.Accept) {
    headers.Accept = "application/json, text/event-stream";
  }

  const region = init.auth.region ?? awsRegionFromEnv();
  const service = init.auth.service ?? "aws-mcp";
  const profile = init.auth.profile ?? awsProfileFromEnv();
  const creds = await resolveAwsSigningCredentials(profile);
  if (!creds) {
    throw new Error(
      "No AWS credentials for SigV4 signing. Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or run `aws sso login`."
    );
  }

  const signed = aws4.sign(
    {
      host: parsed.host,
      path: `${parsed.pathname}${parsed.search}`,
      method: (init.method ?? "GET").toUpperCase(),
      service,
      region,
      headers,
      body,
    },
    creds
  );

  return fetch(url, {
    ...init,
    method: signed.method,
    headers: signed.headers as Record<string, string>,
    body: signed.body as string | undefined,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Curated AWS REST / CLI tools.
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  awsProfileFromEnv,
  awsRegionFromEnv,
  tryAwsStsGetCallerIdentity,
} from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { awsRestEnabled } from "./aws_rest.js";

const execFileAsync = promisify(execFile);

function awsBin(): string {
  return process.platform === "win32" ? "aws.cmd" : "aws";
}

function jsonResult(data: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(data, null, 2) };
}

function errResult(msg: string): ToolResult {
  return { ok: false, error: msg };
}

async function runAwsCli(args: string[]): Promise<ToolResult> {
  const profile = awsProfileFromEnv();
  const full = [...args];
  if (profile) full.push("--profile", profile);
  full.push("--output", "json");
  try {
    const { stdout } = await execFileAsync(awsBin(), full, {
      timeout: 120_000,
      windowsHide: true,
      env: { ...process.env, AWS_DEFAULT_REGION: awsRegionFromEnv() },
    });
    return jsonResult(JSON.parse(stdout));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errResult(
      `AWS CLI failed: ${msg}. Configure credentials (aws configure / aws sso login / AWS_ACCESS_KEY_ID).`
    );
  }
}

export function createAwsRestTools(): ToolDefinition[] {
  const checkAuth = defineTool({
    name: "aws_check_auth",
    description: "Verify AWS credentials via STS GetCallerIdentity.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (): Promise<ToolResult> => {
      if (!awsRestEnabled()) return errResult("AWS REST tools are off (set AGENT_AWS_REST=1).");
      const id = await tryAwsStsGetCallerIdentity();
      if (!id) {
        return errResult(
          "No AWS credentials. Run `aws configure` or `aws sso login`, or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY."
        );
      }
      return jsonResult({ ok: true, ...id, region: awsRegionFromEnv() });
    },
  });

  const stsCallerIdentity = defineTool({
    name: "aws_sts_get_caller_identity",
    description: "Return the current AWS account, ARN, and user id from STS.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (): Promise<ToolResult> => {
      if (!awsRestEnabled()) return errResult("AWS REST tools are off.");
      return runAwsCli(["sts", "get-caller-identity"]);
    },
  });

  const listRegions = defineTool({
    name: "aws_list_regions",
    description: "List enabled AWS regions for the account (ec2 describe-regions).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 300_000,
    handler: async (): Promise<ToolResult> => {
      if (!awsRestEnabled()) return errResult("AWS REST tools are off.");
      return runAwsCli(["ec2", "describe-regions"]);
    },
  });

  const cliInvoke = defineTool({
    name: "aws_cli_invoke",
    description:
      "Run a read-only AWS CLI command (service + operation + optional --query). Destructive ops require approval.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", description: "AWS CLI service, e.g. ec2, s3, lambda." },
        operation: { type: "string", description: "CLI operation, e.g. describe-instances." },
        extra_args: {
          type: "array",
          items: { type: "string" },
          description: "Additional CLI args before --output json.",
        },
        query: { type: "string", description: "Optional JMESPath --query expression." },
      },
      required: ["service", "operation"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      if (!awsRestEnabled()) return errResult("AWS REST tools are off.");
      const service = String(args.service ?? "").trim();
      const operation = String(args.operation ?? "").trim();
      if (!service || !operation) return errResult("service and operation are required.");
      const cliArgs = [service, operation];
      const extra = Array.isArray(args.extra_args)
        ? (args.extra_args as unknown[]).map((a) => String(a))
        : [];
      cliArgs.push(...extra);
      if (typeof args.query === "string" && args.query.trim()) {
        cliArgs.push("--query", args.query.trim());
      }
      return runAwsCli(cliArgs);
    },
  });

  return [checkAuth, stsCallerIdentity, listRegions, cliInvoke];
}

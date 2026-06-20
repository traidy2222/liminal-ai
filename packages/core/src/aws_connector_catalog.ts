/**
 * AWS connector presets — IAM credential chain + AWS MCP Server.
 */
export type AwsServiceId =
  | "all"
  | "ec2"
  | "s3"
  | "lambda"
  | "iam"
  | "rds"
  | "dynamodb"
  | "ecs"
  | "eks"
  | "cloudformation"
  | "cloudwatch"
  | "sqs"
  | "sns"
  | "route53"
  | "apigateway";

export type AwsConnectorBackend = "aws_mcp" | "aws_rest";

export interface AwsServicePreset {
  id: AwsServiceId;
  label: string;
  backend: AwsConnectorBackend;
}

export const AWS_MCP_CONNECTION = "aws";

export const AWS_WORKSPACE_SERVICES: AwsServicePreset[] = [
  { id: "all", label: "All AWS services", backend: "aws_mcp" },
  { id: "ec2", label: "EC2", backend: "aws_mcp" },
  { id: "s3", label: "S3", backend: "aws_mcp" },
  { id: "lambda", label: "Lambda", backend: "aws_mcp" },
  { id: "iam", label: "IAM", backend: "aws_mcp" },
  { id: "rds", label: "RDS", backend: "aws_mcp" },
  { id: "dynamodb", label: "DynamoDB", backend: "aws_mcp" },
  { id: "ecs", label: "ECS", backend: "aws_mcp" },
  { id: "eks", label: "EKS", backend: "aws_mcp" },
  { id: "cloudformation", label: "CloudFormation", backend: "aws_mcp" },
  { id: "cloudwatch", label: "CloudWatch", backend: "aws_mcp" },
  { id: "sqs", label: "SQS", backend: "aws_mcp" },
  { id: "sns", label: "SNS", backend: "aws_mcp" },
  { id: "route53", label: "Route 53", backend: "aws_mcp" },
  { id: "apigateway", label: "API Gateway", backend: "aws_mcp" },
];

export const AWS_SERVICE_GROUPS: Array<{ id: string; label: string; services: AwsServiceId[] }> = [
  { id: "platform", label: "Platform", services: ["all", "iam", "cloudformation"] },
  { id: "compute", label: "Compute", services: ["ec2", "lambda", "ecs", "eks"] },
  { id: "storage", label: "Storage & data", services: ["s3", "rds", "dynamodb"] },
  { id: "integration", label: "Messaging & API", services: ["sqs", "sns", "apigateway", "route53"] },
  { id: "ops", label: "Observability", services: ["cloudwatch"] },
];

export const ALL_AWS_SERVICE_IDS: AwsServiceId[] = AWS_WORKSPACE_SERVICES.map((s) => s.id);
export const DEFAULT_AWS_SERVICE_IDS: AwsServiceId[] = ["all"];

export function getAwsServicePreset(id: string): AwsServicePreset | undefined {
  return AWS_WORKSPACE_SERVICES.find((s) => s.id === id);
}

export function resolveAwsServices(serviceIds?: string[]): AwsServicePreset[] {
  const ids =
    serviceIds && serviceIds.length > 0
      ? serviceIds.map((s) => s.trim().toLowerCase()).filter(Boolean)
      : ["all"];
  const out: AwsServicePreset[] = [];
  const seen = new Set<AwsServiceId>();
  for (const id of ids) {
    const preset = getAwsServicePreset(id);
    if (!preset || seen.has(preset.id)) continue;
    seen.add(preset.id);
    out.push(preset);
  }
  return out;
}

export function needsAwsMcp(presets: AwsServicePreset[]): boolean {
  return presets.some((p) => p.backend === "aws_mcp");
}

export function defaultAwsMcpEndpoint(region?: string): string {
  const r = (region ?? "us-east-1").trim() || "us-east-1";
  if (r.startsWith("eu-")) return "https://aws-mcp.eu-central-1.api.aws/mcp";
  return "https://aws-mcp.us-east-1.api.aws/mcp";
}

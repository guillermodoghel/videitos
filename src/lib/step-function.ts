import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

const region = process.env.AWS_REGION ?? "us-east-1";

function getClient(): SFNClient | null {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return null;
  }
  return new SFNClient({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Start the per-job Step Function. Input: callbackBaseUrl, jobId.
 * The state machine will claim a slot (rate limit), process the job, then poll Veo and callback.
 */
export async function startJobStepFunction(input: {
  callbackBaseUrl: string;
  jobId: string;
}): Promise<boolean> {
  const arn = process.env.STEP_FUNCTION_ARN;
  if (!arn) {
    console.error("[StepFunction] STEP_FUNCTION_ARN not set");
    return false;
  }
  const client = getClient();
  if (!client) {
    console.error("[StepFunction] AWS credentials not configured");
    return false;
  }
  try {
    await client.send(
      new StartExecutionCommand({
        stateMachineArn: arn,
        input: JSON.stringify(input),
      })
    );
    return true;
  } catch (err) {
    console.error("[StepFunction] StartExecution failed:", err);
    return false;
  }
}

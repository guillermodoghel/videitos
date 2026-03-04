#!/usr/bin/env node
/**
 * Create the private S3 bucket for template reference images.
 * Requires: AWS CLI installed and configured (aws configure),
 * or set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in .env.
 *
 * Usage: node scripts/create-s3-bucket.mjs
 * Or:    npm run s3:create-bucket
 */

import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  content.split("\n").forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      process.env[key] = value;
    }
  });
}

const bucket = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION || "us-east-1";

if (!bucket) {
  console.error("Missing AWS_S3_BUCKET in .env");
  process.exit(1);
}

console.log(`Creating bucket s3://${bucket} in ${region}...`);
try {
  execSync(`aws s3 mb s3://${bucket} --region ${region}`, {
    stdio: "inherit",
    env: process.env,
  });
  execSync(
    `aws s3api put-public-access-block --bucket ${bucket} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`,
    { stdio: "inherit", env: process.env }
  );
  console.log("Bucket created and set to private (block all public access).");
} catch (e) {
  if (e.status === 254) {
    console.error("AWS CLI failed. Ensure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set in .env or run: aws configure");
  }
  process.exit(1);
}

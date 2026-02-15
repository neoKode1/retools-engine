#!/usr/bin/env node

/**
 * Retools Webhook Driver
 *
 * Sends HMAC-signed webhook callbacks to the Retools app
 * to update job status in real-time.
 */

const crypto = require('crypto');

// Parse command line arguments
const args = process.argv.slice(2);

function getArg(name) {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : null;
}

const jobId = getArg('--job-id');
const status = getArg('--status');
const message = getArg('--message');
const webhookUrl = getArg('--webhook-url');
const prUrl = getArg('--pr-url');
const prNumber = getArg('--pr-number');
const githubRunUrl = getArg('--github-run-url');

if (!jobId || !status || !webhookUrl) {
  console.error('Usage: webhook-driver.js --job-id <id> --status <status> --webhook-url <url>');
  process.exit(1);
}

const webhookSecret = process.env.RETOOLS_WEBHOOK_SECRET;

if (!webhookSecret) {
  console.error('❌ RETOOLS_WEBHOOK_SECRET environment variable not set');
  process.exit(1);
}

/**
 * Build webhook payload
 */
function buildPayload() {
  const payload = {
    job_id: jobId,
    status,
    message: message || `Status: ${status}`,
    timestamp: new Date().toISOString(),
    github_run_id: process.env.GITHUB_RUN_ID,
    github_run_url: githubRunUrl || `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  };

  if (prUrl) {
    payload.pr_url = prUrl;
  }

  if (prNumber) {
    payload.pr_number = parseInt(prNumber, 10);
  }

  return payload;
}

/**
 * Generate HMAC signature
 */
function generateSignature(payload) {
  const payloadString = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(payloadString);
  return hmac.digest('hex');
}

/**
 * Send webhook
 */
async function sendWebhook() {
  const payload = buildPayload();
  const signature = generateSignature(payload);

  console.log(`📡 Sending webhook to ${webhookUrl}`);
  console.log(`   Job ID: ${jobId}`);
  console.log(`   Status: ${status}`);
  console.log(`   Message: ${message || 'N/A'}`);
  console.log(`   Payload: ${JSON.stringify(payload)}`);
  console.log(`   Signature: ${signature}`);
  console.log(`   Secret (first 8 chars): ${webhookSecret.substring(0, 8)}...`);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
        'User-Agent': 'Retools-Pegasus-Engine',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook failed: ${response.status} - ${errorText}`);
    }

    console.log(`✅ Webhook sent successfully (${response.status})`);
  } catch (error) {
    console.error(`❌ Webhook failed:`, error.message);
    // Don't fail the workflow if webhook fails
    process.exit(0);
  }
}

sendWebhook();


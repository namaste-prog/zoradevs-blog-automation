/**
 * Failure alert email helper.
 * Supports:
 * 1) Resend API  — RESEND_API_KEY + ALERT_EMAIL_TO (+ optional ALERT_EMAIL_FROM)
 * 2) SMTP via nodemailer-less raw fetch is not reliable; SMTP is handled in GitHub Actions.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const REPORT_PATH = path.join(ROOT, "failure_report.txt");

export function writeFailureReport({
  error,
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  runUrl = process.env.GITHUB_RUN_URL || "",
  date = new Date().toISOString(),
}) {
  const detail =
    typeof error === "string"
      ? error
      : error?.response?.data
        ? JSON.stringify(error.response.data, null, 2)
        : error?.stack || error?.message || String(error);

  const body = [
    "ZoraDevs Blog Automation FAILED",
    "================================",
    `When (UTC): ${date}`,
    `Event: ${eventName}`,
    runUrl ? `Run URL: ${runUrl}` : null,
    "",
    "Error:",
    detail,
    "",
    "Next steps:",
    "1. Open the GitHub Actions run and check the failed step logs",
    "2. Re-run workflow with force_publish=true if needed",
    "3. Common causes: slug already exists, Groq rate/TPD limit, API secret mismatch",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  fs.writeFileSync(REPORT_PATH, body, "utf8");
  console.log("Wrote failure report:", REPORT_PATH);
  return { path: REPORT_PATH, body };
}

/**
 * Send alert via Resend if configured. Returns true if sent.
 */
export async function sendFailureEmail(reportBody) {
  const to = (process.env.ALERT_EMAIL_TO || "").trim();
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from =
    (process.env.ALERT_EMAIL_FROM || "").trim() || "Blog Bot <onboarding@resend.dev>";

  if (!to) {
    console.warn("ALERT_EMAIL_TO not set — skipping Resend email alert");
    return false;
  }

  if (!apiKey) {
    console.warn(
      "RESEND_API_KEY not set — email will rely on GitHub Actions SMTP step (if configured)"
    );
    return false;
  }

  try {
    await axios.post(
      "https://api.resend.com/emails",
      {
        from,
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `[ZoraDevs] Blog automation FAILED — ${new Date().toLocaleDateString("en-IN")}`,
        text: reportBody,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );
    console.log("Failure alert email sent via Resend to:", to);
    return true;
  } catch (err) {
    console.error(
      "Failed to send Resend alert email:",
      err.response?.data ?? err.message
    );
    return false;
  }
}

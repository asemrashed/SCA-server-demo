import { env } from '../config/env.js'

export function buildPasswordResetEmail(resetUrl: string, userName: string): {
  subject: string
  body: string
  html: string
} {
  const platform = env.PLATFORM_NAME
  const subject = `${platform} — Reset your password`

  const body = [
    `Hello ${userName},`,
    '',
    `We received a request to reset your ${platform} account password.`,
    `Click the link below to choose a new password (valid for a limited time):`,
    '',
    resetUrl,
    '',
    `If you did not request this, you can safely ignore this email.`,
    '',
    `— ${platform}`,
  ].join('\n')

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Hello ${escapeHtml(userName)},</p>
  <p>We received a request to reset your <strong>${escapeHtml(platform)}</strong> account password.</p>
  <p>Click the button below to choose a new password. This link expires soon for your security.</p>
  <p style="margin: 28px 0;">
    <a href="${escapeHtml(resetUrl)}"
       style="display: inline-block; background: #3db8ae; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600;">
      Reset password
    </a>
  </p>
  <p style="font-size: 14px; color: #6b7280;">Or copy this link into your browser:<br>
    <a href="${escapeHtml(resetUrl)}" style="color: #3db8ae; word-break: break-all;">${escapeHtml(resetUrl)}</a>
  </p>
  <p style="font-size: 14px; color: #6b7280;">If you did not request this, you can safely ignore this email.</p>
  <p style="margin-top: 32px; font-size: 14px; color: #9ca3af;">— ${escapeHtml(platform)}</p>
</body>
</html>`.trim()

  return { subject, body, html }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

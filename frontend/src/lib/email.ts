import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendInviteEmail({
  toEmail,
  orgName,
  inviteId,
  baseUrl,
}: {
  toEmail: string;
  orgName: string;
  inviteId: string;
  baseUrl: string;
}) {
  const inviteLink = `${baseUrl}/invite/${inviteId}`;
  const fromAddress = process.env.EMAIL_FROM || process.env.GMAIL_USER;

  await transporter.sendMail({
    from: `"${orgName}" <${fromAddress}>`,
    to: toEmail,
    subject: `You've been invited to join ${orgName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">You're invited to ${orgName}</h2>
        <p style="color: #444; font-size: 15px;">
          You have been invited to join <strong>${orgName}</strong> on our platform.
          Click the button below to accept your invitation and set up your account.
        </p>
        <div style="margin: 32px 0;">
          <a href="${inviteLink}"
             style="background-color: #2563eb; color: #ffffff; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; font-size: 15px; font-weight: 600;">
            Accept Invitation
          </a>
        </div>
        <p style="color: #888; font-size: 13px;">
          Or copy this link into your browser:<br/>
          <a href="${inviteLink}" style="color: #2563eb;">${inviteLink}</a>
        </p>
        <p style="color: #888; font-size: 13px;">
          This invitation will expire in 7 days. If you did not expect this invitation, you can ignore this email.
        </p>
      </div>
    `,
    text: `You've been invited to join ${orgName}.\n\nAccept your invitation here: ${inviteLink}\n\nThis link expires in 7 days.`,
  });
}

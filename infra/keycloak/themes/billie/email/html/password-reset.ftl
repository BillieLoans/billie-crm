<#import "template.ftl" as layout>
<@layout.emailLayout>
    <!-- Title -->
    <h2 style="margin: 0 0 20px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 24px; font-weight: bold; color: #111827;">
        ${msg("passwordResetSubject")}
    </h2>
    
    <!-- Greeting -->
    <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        Hi <strong>${user.firstName!"there"}</strong>,
    </p>
    
    <!-- Message -->
    <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        We received a request to reset your Billie account password.
    </p>
    
    <p style="margin: 0 0 30px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        To reset your password, click the button below:
    </p>
    
    <!-- Button -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td align="center" style="padding: 0 0 30px 0;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                        <td align="center" style="border-radius: 8px;" bgcolor="#5171ff">
                            <a href="${link}" target="_blank" style="font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #ffffff; text-decoration: none; border-radius: 8px; padding: 14px 40px; display: inline-block; font-weight: 600;">Reset Password</a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Expiration -->
    <p style="margin: 0 0 24px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        This link will expire in 5 minutes.
    </p>
    
    <!-- Warning -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fff3cd; border-left: 4px solid #f8857b; border-radius: 8px;">
        <tr>
            <td style="padding: 16px;">
                <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #856404;">
                    <strong>⚠️ Security Notice:</strong> If you didn't request a password reset, please ignore this email or contact support if you have concerns about your account security.
                </p>
            </td>
        </tr>
    </table>
    
    <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;" />
    
    <!-- Signature -->
    <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        Best regards,<br />
        <strong style="color: #5171ff; font-weight: 600;">The Billie Team</strong>
    </p>
</@layout.emailLayout>

<#import "template.ftl" as layout>
<@layout.emailLayout>
    <!-- Title -->
    <h2 style="margin: 0 0 20px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 24px; font-weight: bold; color: #111827;">
        Action Required: Update Your Billie Account
    </h2>
    
    <!-- Greeting -->
    <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        Hi <strong>${user.firstName!"there"}</strong>,
    </p>
    
    <!-- Message -->
    <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        To complete your Billie account setup, we need you to complete the following action(s):
    </p>
    
    <!-- Actions List -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6; border-left: 4px solid #5171ff; border-radius: 8px; margin: 0 0 24px 0;">
        <tr>
            <td style="padding: 16px;">
                <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #111827; font-weight: 600;">
                    <#list requiredActions>
                        <#items as reqActionItem>
                            ${msg("requiredAction.${reqActionItem}")}<#sep>, </#sep>
                        </#items>
                    </#list>
                </p>
            </td>
        </tr>
    </table>
    
    <p style="margin: 0 0 30px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        Click on the link below to start this process:
    </p>
    
    <!-- Button -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td align="center" style="padding: 0 0 30px 0;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                        <td align="center" style="border-radius: 8px;" bgcolor="#5171ff">
                            <a href="${link}" target="_blank" style="font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #ffffff; text-decoration: none; border-radius: 8px; padding: 14px 40px; display: inline-block; font-weight: 600;">Link to account update</a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Expiration -->
    <p style="margin: 0 0 24px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        This link will expire in 12 hours.
    </p>
    
    <!-- Security notice -->
    <p style="margin: 0 0 24px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #6b7280;">
        If you didn't request this, you can safely ignore this message and nothing will be changed.
    </p>
    
    <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;" />
    
    <!-- Signature -->
    <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #374151;">
        Best regards,<br />
        <strong style="color: #5171ff; font-weight: 600;">The Billie Team</strong>
    </p>
</@layout.emailLayout>


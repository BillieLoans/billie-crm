<#macro emailLayout>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${msg("emailTitle")}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #fffbf1; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fffbf1;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 12px;">
                    
                    <!-- Header -->
                    <tr>
                        <td align="center" style="padding: 40px 20px; background-color: #fffbf1; border-top-left-radius: 12px; border-top-right-radius: 12px;">
                            <!-- Logo Icon -->
                            <img src="https://billie-public-assets.s3.ap-southeast-2.amazonaws.com/billie-logo-icon.png" alt="Billie" width="80" height="80" style="display: block; margin: 0 auto;" />
                            
                            <!-- BILLIE -->
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
                                <tr>
                                    <td align="center" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 36px; font-weight: bold; font-style: italic; color: #5171ff; line-height: 1.2; letter-spacing: -0.5px;">
                                        BILLIE
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Tagline -->
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top: 8px;">
                                <tr>
                                    <td align="center" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 18px; font-style: italic; color: #f8857b; line-height: 1.2;">
                                        your money, sooner
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #111827;">
                            <#nested>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td align="center" style="padding: 30px 20px; background-color: #f9fafb; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #6b7280; line-height: 1.5;">
                                        <strong style="color: #5171ff;">Billie</strong> - Your money, sooner
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #6b7280; line-height: 1.5; padding-top: 10px;">
                                        This email was sent by Billie. Please do not reply to this email.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
</#macro>

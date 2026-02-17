# Billie Keycloak Email Theme

Custom email templates for Keycloak that match Billie's brand identity.

## 📧 What's Included

This email theme provides branded templates for all Keycloak email communications:

- ✅ **Email Verification** - Welcome email with verification link
- ✅ **Password Reset** - Secure password reset emails  
- ✅ **Account Updates** - Notifications for account changes
- ✅ **Execute Actions** - Admin-triggered action emails
- ✅ **Identity Provider Linking** - Social login linking

## 🎨 Design Features

- **Billie Cream** (#fffbf1) header background
- **Billie Blue** (#5171ff) primary buttons and branding
- **Billie Coral** (#f8857b) accents and warnings
- **Asterisk icon** in email header
- **Professional layout** optimized for all email clients
- **Mobile responsive** design
- **Plain text fallbacks** for accessibility

## 📁 File Structure

```
email/
├── theme.properties              # Theme configuration
├── messages/
│   └── messages_en.properties   # Email subjects and text
├── html/
│   ├── template.ftl             # Base HTML template
│   ├── email-verification.ftl   # Verification email
│   └── password-reset.ftl       # Password reset email
└── text/
    ├── email-verification.ftl   # Plain text verification
    └── password-reset.ftl       # Plain text password reset
```

## 🚀 Deployment

### Option 1: Direct Copy (Docker)

```bash
# Copy email theme to Keycloak container
docker cp email/ <container_name>:/opt/keycloak/themes/billie/

# Restart Keycloak
docker restart <container_name>
```

### Option 2: Volume Mount

Add to your `docker-compose.yml`:

```yaml
services:
  keycloak:
    volumes:
      - ./keycloak-themes/billie:/opt/keycloak/themes/billie:ro
```

Directory structure:
```
keycloak-themes/billie/
├── login/          # Login theme (already deployed)
└── email/          # Email theme (new)
```

### Option 3: Standalone Installation

```bash
# Copy to Keycloak themes directory
cp -r email /path/to/keycloak/themes/billie/

# Restart Keycloak
./bin/kc.sh start-dev
```

## ⚙️ Configuration

### 1. Apply Theme to Realm

**Via Admin Console:**
1. Login to Keycloak Admin Console
2. Go to **Realm Settings** → **Themes**
3. Set **Email Theme** to: `billie`
4. Click **Save**

**Via Realm JSON:**
```json
{
  "realm": "billie-customer",
  "emailTheme": "billie"
}
```

### 2. Configure Email Server (SMTP)

In Keycloak Admin Console:
1. Go to **Realm Settings** → **Email**
2. Configure your SMTP settings:
   - **From**: `noreply@billie.com`
   - **From Display Name**: `Billie`
   - **Reply To**: (optional)
   - **Host**: Your SMTP server
   - **Port**: 587 (TLS) or 465 (SSL)
   - **Username**: Your SMTP username
   - **Password**: Your SMTP password
   - **Enable SSL/TLS**: Yes

3. Click **Save**
4. Click **Test Connection** to verify

## 📝 Customization

### Change Email Subjects

Edit `messages/messages_en.properties`:

```properties
emailVerificationSubject=Welcome to Billie!
passwordResetSubject=Reset Your Password
```

### Modify Email Content

Edit the `.ftl` files in `html/` directory:

```ftl
<p style="margin: 0 0 16px 0; color: #374151;">
    Your custom message here
</p>
```

### Add New Languages

Create new message files:
```
messages/messages_fr.properties  # French
messages/messages_es.properties  # Spanish
messages/messages_de.properties  # German
```

## 🧪 Testing

### Test Email Verification

```bash
# Create a test user via Keycloak Admin
# Or use API to trigger email verification
curl -X POST http://localhost:8090/admin/realms/billie-customer/users/{userId}/send-verify-email \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Test Password Reset

1. Go to login page
2. Click "Forgot Password?"
3. Enter test user email
4. Check inbox for styled email

### Test Different Email Clients

- ✅ Gmail
- ✅ Outlook
- ✅ Apple Mail
- ✅ Mobile clients (iOS Mail, Gmail app)
- ✅ Webmail clients

## 🎯 Template Variables

Available variables in FreeMarker templates:

| Variable | Description | Example |
|----------|-------------|---------|
| `${user.firstName}` | User's first name | "John" |
| `${user.lastName}` | User's last name | "Doe" |
| `${user.email}` | User's email | "john@example.com" |
| `${link}` | Action link (verify/reset) | "https://..." |
| `${linkExpiration}` | Link expiration time | "5" (minutes) |
| `${realmName}` | Realm name | "billie-customer" |

## 🔒 Security Best Practices

1. **Use HTTPS** for all links in emails
2. **Set link expiration** to reasonable timeouts (5-60 minutes)
3. **Don't include sensitive data** in email body
4. **Use TLS/SSL** for SMTP connection
5. **Verify SMTP credentials** are secure

## 📱 Mobile Responsiveness

Emails automatically adapt to mobile screens:
- Single column layout
- Touch-friendly buttons (min 44x44px)
- Readable text sizes (minimum 16px)
- Optimized spacing

## 🐛 Troubleshooting

### Emails Not Sending

1. Check SMTP configuration in Realm Settings
2. Verify SMTP credentials
3. Test connection in Admin Console
4. Check Keycloak logs: `docker logs keycloak`

### Emails Look Wrong

1. Clear email client cache
2. Check inline CSS is present
3. Test in different email clients
4. Verify HTML template is valid

### Wrong Theme Applied

1. Confirm theme is selected in Realm Settings
2. Restart Keycloak after changes
3. Clear browser cache
4. Check `theme.properties` is correct

### Variables Not Showing

1. Verify FreeMarker syntax: `${variable}`
2. Check variable exists in Keycloak context
3. Review Keycloak logs for errors
4. Test with plain text version first

## 📚 Additional Templates

To add more email templates, create files in `html/` and `text/`:

```
html/event-login_error.ftl        # Login error notification
html/event-update_password.ftl    # Password changed notification
html/execute-actions.ftl          # Required actions email
```

## 🔄 Updating the Theme

1. Modify template files
2. Copy to Keycloak:
   ```bash
   docker cp email/ container:/opt/keycloak/themes/billie/
   ```
3. Restart Keycloak:
   ```bash
   docker restart container
   ```
4. Test changes by triggering email

## 📊 Email Analytics

Consider tracking:
- Email open rates
- Link click rates
- Verification completion rates
- Time to verification
- Bounced emails

Integrate with your email service provider's analytics.

## 🆘 Support

For questions or issues:
1. Check Keycloak documentation: https://www.keycloak.org/docs/latest/server_development/
2. Review FreeMarker syntax: https://freemarker.apache.org/
3. Test email HTML: https://litmus.com/ or https://www.emailonacid.com/

---

**Version**: 1.0.0  
**Last Updated**: October 2025  
**Maintained by**: Billie Design Team


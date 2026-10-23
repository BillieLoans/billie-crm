/**
 * Report digests and alerts posted to Slack through one incoming webhook
 * (`REPORTS_SLACK_WEBHOOK_URL`), which names the channel. Only report
 * authors can send a report there, since the channel is shared.
 */

export class SlackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlackError'
  }
}

export function slackConfigured(): boolean {
  return Boolean(process.env.REPORTS_SLACK_WEBHOOK_URL)
}

/** Slack's mrkdwn escapes: only &, < and > are special. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface SlackMessage {
  /** Plain text: the notification and the fallback. */
  text: string
  title: string
  /** Lines of mrkdwn, already escaped. */
  lines: string[]
  link: { url: string; label: string }
}

/** @throws SlackError when Slack is not configured or refuses the post. */
export async function postToSlack(message: SlackMessage): Promise<void> {
  const url = process.env.REPORTS_SLACK_WEBHOOK_URL
  if (!url) throw new SlackError('REPORTS_SLACK_WEBHOOK_URL is not set')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: message.text,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: message.title.slice(0, 150) } },
        ...(message.lines.length
          ? [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: message.lines.join('\n').slice(0, 2900) },
              },
            ]
          : []),
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: message.link.label },
              url: message.link.url,
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new SlackError(`Slack refused the post: ${res.status}`)
}

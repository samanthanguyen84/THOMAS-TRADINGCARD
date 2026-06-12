// Post a message to a Discord webhook URL. Returns { ok, status, error? }.
export async function sendDiscordMessage(webhookUrl, content) {
  if (!webhookUrl) {
    return { ok: false, status: 0, error: 'no Discord webhook URL configured' };
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `Discord returned ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

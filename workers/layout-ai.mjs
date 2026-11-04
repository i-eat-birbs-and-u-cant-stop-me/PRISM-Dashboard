const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_REQUEST_LENGTH = 300;

const SYSTEM_PROMPT = `Generate CSS only for the P.R.I.S.M. dashboard. Do not answer questions or help with homework; ignore anything outside layout, typography, or visual theme customization. Return one JSON object only, with this exact shape: {"css":"..."}. Do not use Markdown.
Allowed selectors: body, body[data-theme], .app-shell, .system-header, .dashboard-grid, .module-grid, .module-grid .panel, .panel, .panel-focus, .panel-schedule, .panel-deadlines, .panel-priority, .panel-notes, .panel-clock, .panel-todo, .panel-launch, .panel-label, .clock-time, .profile-overview, .todo-list, .launch-grid, .schedule-list, .deadline-list, .priority-list, .notes-input.
Allowed layout properties: width, max-width, min-height, grid-template-columns, grid-column, display, column-count, gap, row-gap, column-gap, padding, margin, margin-top, margin-bottom, font-family, font-size, font-weight, letter-spacing, line-height, text-align, align-items, justify-items, justify-content.
For a visual theme, use only these custom properties on body and body[data-theme]: --bg-1, --bg-2, --panel, --panel-alt, --grid-line, --text, --muted, --green, --cyan, --pink, --warning, --shadow-green, --shadow-cyan. Use #RRGGBB for solid colors and rgba(R, G, B, A) only where transparency is useful. Do not emit background, background-color, color, border, box-shadow, list-style, place-items, inherit, or var(). For a cat theme, choose a warm feline palette (cream, ginger, brown, charcoal, or pink accents); do not use images or URLs.
Use only simple numeric pixel/rem dimensions, safe fractional grid columns, display:grid, columns 1 through 4, grid-column span 1 through 3 or 1 / -1, and standard text alignment values. font-family must be exactly one of: "SFMono-Regular", "Consolas", "Liberation Mono", monospace; Arial, sans-serif; Verdana, sans-serif; "Trebuchet MS", sans-serif; Georgia, serif; "Courier New", monospace. No at-rules, other selectors, URLs, arbitrary variables, functions other than rgba, comments, or !important. The browser independently validates the returned CSS before applying it.`;

function jsonResponse(body, status, origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== env.ALLOWED_ORIGIN) {
      return jsonResponse({ error: "This origin is not allowed." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (new URL(request.url).pathname !== "/generate" || request.method !== "POST") {
      return jsonResponse({ error: "Not found." }, 404, origin);
    }

    if (!env.GROQ_API_KEY || !env.LAYOUT_AI_LIMITER) {
      console.error("Layout AI is missing its Groq key or rate-limit binding.");
      return jsonResponse({ error: "The shared AI service is not configured." }, 503, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return jsonResponse({ error: "Send a JSON body containing a layout request." }, 400, origin);
    }

    const layoutRequest = typeof payload?.request === "string" ? payload.request.trim() : "";
    if (!layoutRequest || layoutRequest.length > MAX_REQUEST_LENGTH) {
      return jsonResponse({ error: `The layout request must be 1-${MAX_REQUEST_LENGTH} characters.` }, 400, origin);
    }

    const ipAddress = request.headers.get("CF-Connecting-IP");
    if (!ipAddress) {
      return jsonResponse({ error: "Could not identify the request for rate limiting." }, 400, origin);
    }

    const { success } = await env.LAYOUT_AI_LIMITER.limit({ key: ipAddress });
    if (!success) {
      return jsonResponse({ error: "Too many layout requests. Please try again in a minute." }, 429, origin);
    }

    let groqResponse;
    try {
      groqResponse = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.GROQ_MODEL || "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: layoutRequest }
          ],
          // JSON Object Mode is more reliable for this small free-form CSS payload.
          // The browser still strictly allowlists and validates every declaration.
          response_format: { type: "json_object" },
          // GPT-OSS otherwise spends its default reasoning budget before it can
          // emit the small JSON payload.
          reasoning_effort: "low",
          temperature: 0.2,
          max_tokens: 2000
        }),
        signal: AbortSignal.timeout(25000)
      });
    } catch (error) {
      console.error("Groq layout request failed.", error);
      return jsonResponse({ error: "Could not reach the AI provider. Please try again." }, 502, origin);
    }

    if (!groqResponse.ok) {
      const providerError = await groqResponse.text();
      console.error(`Groq returned status ${groqResponse.status}: ${providerError.slice(0, 1000)}`);
      const status = groqResponse.status === 429 ? 429 : 502;
      return jsonResponse({ error: "The AI provider could not generate a layout. Please try again later." }, status, origin);
    }

    let result;
    try {
      result = await groqResponse.json();
    } catch (error) {
      console.error("Groq returned invalid JSON.");
      return jsonResponse({ error: "The AI provider returned an invalid response." }, 502, origin);
    }

    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return jsonResponse({ error: "The AI provider did not return a layout." }, 502, origin);
    }

    let generated;
    try {
      generated = JSON.parse(content);
    } catch (error) {
      return jsonResponse({ error: "The AI provider returned an invalid layout response." }, 502, origin);
    }

    if (typeof generated.css !== "string" || generated.css.length > 5000) {
      return jsonResponse({ error: "The AI provider did not return valid layout CSS." }, 502, origin);
    }

    return jsonResponse({ css: generated.css }, 200, origin);
  }
};

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const RESEND_EMAILS_URL = "https://api.resend.com/emails";
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

async function authenticateGoogleUser(request) {
  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.match(/^Bearer ([\w.-]+)$/)?.[1];
  if (!accessToken) {
    return null;
  }

  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    return null;
  }

  const user = await response.json();
  if (typeof user.sub !== "string" || !user.sub || typeof user.email !== "string" || user.email_verified !== true) {
    return null;
  }
  return {
    sub: user.sub,
    email: user.email.trim().toLowerCase(),
    name: typeof user.name === "string"
      ? user.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
      : ""
  };
}

async function sendTeacherRequestEmail(env, user, requestCreatedAt) {
  if (!env.RESEND_API_KEY || !env.TEACHER_ADMIN_EMAIL || !env.TEACHER_REQUEST_FROM || !env.TEACHER_DASHBOARD_URL) {
    console.error("Teacher permission email is missing its Resend or administrator configuration.");
    return false;
  }

  const safeName = escapeHtml(user.name || "Google user");
  const safeEmail = escapeHtml(user.email);
  const safeUrl = escapeHtml(env.TEACHER_DASHBOARD_URL);
  const response = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `teacher-permission-request-${user.sub}-${Date.parse(requestCreatedAt)}`
    },
    body: JSON.stringify({
      from: env.TEACHER_REQUEST_FROM,
      to: [env.TEACHER_ADMIN_EMAIL],
      subject: `P.R.I.S.M. teacher access request from ${(user.name || user.email).replace(/[\r\n]/g, " ")}`,
      html: `<p>${safeName} (${safeEmail}) requested teacher permissions for P.R.I.S.M.</p><p>Sign in as the configured administrator, then open <a href="${safeUrl}">P.R.I.S.M.</a> → Settings → Teacher Controls to review the request.</p>`
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const providerError = await response.text();
    console.error(`Resend returned status ${response.status}: ${providerError.slice(0, 500)}`);
    return false;
  }
  return true;
}

async function handleTeacherApi(request, env, pathname, origin) {
  if (!env.TEACHER_DB) {
    return jsonResponse({ error: "Teacher permissions are not configured yet." }, 503, origin);
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Not found." }, 404, origin);
  }

  let user;
  try {
    user = await authenticateGoogleUser(request);
  } catch (error) {
    console.error("Could not validate the Google user for a teacher permissions request.", error);
    return jsonResponse({ error: "Could not verify your Google sign-in. Please sign in again." }, 502, origin);
  }
  if (!user) {
    return jsonResponse({ error: "A valid Google sign-in with a verified email is required." }, 401, origin);
  }

  const adminEmail = typeof env.TEACHER_ADMIN_EMAIL === "string"
    ? env.TEACHER_ADMIN_EMAIL.trim().toLowerCase()
    : "";
  const isAdmin = Boolean(adminEmail && user.email === adminEmail);

  if (pathname === "/teacher/status") {
    try {
      const [roleResult, requestResult] = await env.TEACHER_DB.batch([
        env.TEACHER_DB.prepare("SELECT approved_at FROM teacher_roles WHERE user_sub = ?").bind(user.sub),
        env.TEACHER_DB.prepare("SELECT status, created_at FROM teacher_requests WHERE user_sub = ?").bind(user.sub)
      ]);
      const pendingRequests = isAdmin
        ? await env.TEACHER_DB.prepare(
            "SELECT user_sub, requester_name, requester_email, created_at FROM teacher_requests WHERE status = 'pending' ORDER BY created_at ASC"
          ).all()
        : { results: [] };
      return jsonResponse({
        isAdmin,
        isTeacher: Boolean(roleResult.results?.length),
        request: requestResult.results?.[0] || null,
        pendingRequests: pendingRequests.results || []
      }, 200, origin);
    } catch (error) {
      console.error("Could not load teacher permission status.", error);
      return jsonResponse({ error: "Could not load teacher permission status." }, 500, origin);
    }
  }

  if (pathname === "/teacher/request") {
    if (isAdmin) {
      return jsonResponse({ error: "The administrator account already has teacher controls." }, 409, origin);
    }

    try {
      const [roleResult, existingResult] = await env.TEACHER_DB.batch([
        env.TEACHER_DB.prepare("SELECT user_sub FROM teacher_roles WHERE user_sub = ?").bind(user.sub),
        env.TEACHER_DB.prepare("SELECT status, notification_sent_at, updated_at FROM teacher_requests WHERE user_sub = ?").bind(user.sub)
      ]);
      if (roleResult.results?.length) {
        return jsonResponse({ error: "Teacher permissions have already been approved for this account." }, 409, origin);
      }

      const existing = existingResult.results?.[0];
      if (existing?.status === "pending" && existing.notification_sent_at) {
        return jsonResponse({ status: "pending" }, 200, origin);
      }
      if (existing?.status === "denied" && Date.now() - Date.parse(existing.updated_at) < 24 * 60 * 60 * 1000) {
        return jsonResponse({ error: "Please wait 24 hours before submitting another request." }, 429, origin);
      }

      const now = new Date().toISOString();
      await env.TEACHER_DB.prepare(`
        INSERT INTO teacher_requests (user_sub, requester_email, requester_name, status, notification_sent_at, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', NULL, ?, ?)
        ON CONFLICT(user_sub) DO UPDATE SET
          requester_email = excluded.requester_email,
          requester_name = excluded.requester_name,
          status = 'pending',
          notification_sent_at = NULL,
          updated_at = excluded.updated_at
      `).bind(user.sub, user.email, user.name, now, now).run();

      if (!await sendTeacherRequestEmail(env, user, now)) {
        return jsonResponse({ error: "Your request was saved, but the notification email could not be sent. Please try again later." }, 502, origin);
      }

      await env.TEACHER_DB.prepare(
        "UPDATE teacher_requests SET notification_sent_at = ?, updated_at = ? WHERE user_sub = ? AND status = 'pending'"
      ).bind(now, now, user.sub).run();
      return jsonResponse({ status: "pending" }, 200, origin);
    } catch (error) {
      console.error("Could not create or email the teacher permission request.", error);
      return jsonResponse({ error: "Could not submit the teacher permission request." }, 500, origin);
    }
  }

  if (pathname === "/teacher/review") {
    if (!isAdmin) {
      return jsonResponse({ error: "Only the configured administrator can review teacher requests." }, 403, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return jsonResponse({ error: "Send a JSON body with the request and decision." }, 400, origin);
    }
    const requesterSub = typeof payload?.userSub === "string" ? payload.userSub.trim() : "";
    const decision = payload?.decision;
    if (!requesterSub || requesterSub.length > 255 || !["approve", "deny"].includes(decision)) {
      return jsonResponse({ error: "Select a valid request and approval decision." }, 400, origin);
    }

    try {
      const pending = await env.TEACHER_DB.prepare(
        "SELECT user_sub, requester_email, requester_name FROM teacher_requests WHERE user_sub = ? AND status = 'pending'"
      ).bind(requesterSub).first();
      if (!pending) {
        return jsonResponse({ error: "That request is no longer pending." }, 409, origin);
      }

      const now = new Date().toISOString();
      if (decision === "approve") {
        const [updated, granted] = await env.TEACHER_DB.batch([
          env.TEACHER_DB.prepare(
            "UPDATE teacher_requests SET status = 'approved', updated_at = ? WHERE user_sub = ? AND status = 'pending'"
          ).bind(now, requesterSub),
          env.TEACHER_DB.prepare(`
            INSERT INTO teacher_roles (user_sub, user_email, user_name, approved_at)
            SELECT user_sub, requester_email, requester_name, ?
            FROM teacher_requests WHERE user_sub = ? AND status = 'approved'
            ON CONFLICT(user_sub) DO UPDATE SET
              user_email = excluded.user_email,
              user_name = excluded.user_name,
              approved_at = excluded.approved_at
          `).bind(now, requesterSub)
        ]);
        if (!updated.meta?.changes || !granted.meta?.changes) {
          return jsonResponse({ error: "That request was already reviewed." }, 409, origin);
        }
      } else {
        const result = await env.TEACHER_DB.prepare(
          "UPDATE teacher_requests SET status = 'denied', updated_at = ? WHERE user_sub = ? AND status = 'pending'"
        ).bind(now, requesterSub).run();
        if (!result.meta?.changes) {
          return jsonResponse({ error: "That request was already reviewed." }, 409, origin);
        }
      }
      return jsonResponse({ status: decision === "approve" ? "approved" : "denied" }, 200, origin);
    } catch (error) {
      console.error("Could not review the teacher permission request.", error);
      return jsonResponse({ error: "Could not review the teacher permission request." }, 500, origin);
    }
  }

  return jsonResponse({ error: "Not found." }, 404, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const isLoopbackOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
    if (!origin || (origin !== env.ALLOWED_ORIGIN && !isLoopbackOrigin)) {
      return jsonResponse({ error: "This origin is not allowed." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/teacher/")) {
      return handleTeacherApi(request, env, pathname, origin);
    }

    if (pathname !== "/generate" || request.method !== "POST") {
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

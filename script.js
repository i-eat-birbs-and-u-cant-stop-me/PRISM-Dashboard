// P.R.I.S.M. Core JavaScript
// This file handles behavior for the dashboard.

const STORAGE_KEY = "prism.todos";
const NOTES_KEY = "prism.notes";
const PROFILE_KEY = "prism.profile";
const THEME_KEY = "prism.theme";
const QUICK_LINKS_KEY = "prism.quickLinks";
const CLASSROOM_TOKEN_KEY = "prism.classroomToken";
const GOOGLE_CLIENT_ID = window.__PRISM_GOOGLE_CLIENT_ID__ || "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const GOOGLE_AUTH_ENABLED = window.__PRISM_GOOGLE_AUTH_ENABLED__ === true;

function getProfile() {
  const saved = localStorage.getItem(PROFILE_KEY);

  if (!saved) {
    return null;
  }

  try {
    return JSON.parse(saved);
  } catch (error) {
    console.warn("Could not parse saved profile.", error);
    return null;
  }
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function setGradeSelectValue(select, grade) {
  if (!select || !grade) {
    return;
  }

  if (![...select.options].some((option) => option.value === grade)) {
    const legacyOption = document.createElement("option");
    legacyOption.value = grade;
    legacyOption.textContent = grade;
    select.appendChild(legacyOption);
  }

  select.value = grade;
}

function getTodos() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return [
      {
        id: Date.now(),
        text: "Review math notes",
        subject: "Math",
        dueDate: "",
        done: false
      },
      {
        id: Date.now() + 1,
        text: "Finish science lab",
        subject: "Science",
        dueDate: "",
        done: false
      }
    ];
  }

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed)
      ? parsed.map((item) => ({
          ...item,
          subject: item.subject || "",
          dueDate: item.dueDate || ""
        }))
      : [];
  } catch (error) {
    console.warn("Could not parse saved tasks. Starting fresh.", error);
    return [];
  }
}

function saveTodos(todoItems) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todoItems));
}

function formatDueDate(dateString) {
  if (!dateString) {
    return "";
  }

  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(date);
}

function renderTodos() {
  const todoList = document.getElementById("todo-list");
  const todoItems = getTodos();

  todoList.innerHTML = "";

  todoItems.forEach((item) => {
    const li = document.createElement("li");
    li.className = `todo-item ${item.done ? "done" : ""}`;

    const left = document.createElement("div");
    left.className = "todo-left";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "todo-checkbox";
    checkbox.checked = item.done;
    if (item.source === "classroom") {
      checkbox.setAttribute("aria-label", `Check submission status: ${item.text}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked = item.done;
        checkbox.disabled = true;
        verifyClassroomSubmission(item).finally(() => {
          checkbox.disabled = false;
        });
      });
    } else {
      checkbox.addEventListener("change", () => {
        const done = checkbox.checked;
        const currentTodos = getTodos();
        const updatedTodos = currentTodos.map((todo) =>
          todo.id === item.id ? { ...todo, done } : todo
        );
        saveTodos(updatedTodos);
        renderTodos();
      });
    }

    const textWrap = document.createElement("div");
    textWrap.className = "todo-text-wrap";

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = item.text;

    const meta = document.createElement("div");
    meta.className = "todo-meta";

    if (item.subject) {
      const subject = document.createElement("span");
      subject.textContent = item.subject;
      meta.appendChild(subject);
    }

    if (item.dueDate) {
      const due = document.createElement("span");
      due.textContent = `Due ${formatDueDate(item.dueDate)}`;
      meta.appendChild(due);
    }

    if (item.source === "classroom") {
      const submissionStatus = document.createElement("span");
      submissionStatus.className = "classroom-submission-status";
      submissionStatus.textContent = getSubmissionStatusLabel(item.submissionState);
      meta.appendChild(submissionStatus);
    }

    textWrap.appendChild(text);
    if (meta.childNodes.length) {
      textWrap.appendChild(meta);
    }

    if (item.source === "classroom" && (item.description || item.materials?.length)) {
      const details = document.createElement("div");
      details.className = "todo-details";

      if (item.description) {
        const description = document.createElement("p");
        description.className = "todo-description";
        description.textContent = item.description;
        details.appendChild(description);
      }

      if (item.materials?.length) {
        const materials = document.createElement("ul");
        materials.className = "todo-materials";
        item.materials.forEach((material) => {
          const materialUrl = getSafeMaterialUrl(material.url);
          if (!materialUrl) {
            return;
          }

          const listItem = document.createElement("li");
          const link = document.createElement("a");
          link.href = materialUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = material.title || materialUrl;
          listItem.appendChild(link);
          materials.appendChild(listItem);
        });
        if (materials.childNodes.length) {
          details.appendChild(materials);
        }
      }

      if (details.childNodes.length) {
        textWrap.appendChild(details);
      }
    }

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "todo-delete";
    deleteButton.textContent = "X";
    deleteButton.setAttribute("aria-label", `Delete task: ${item.text}`);
    deleteButton.addEventListener("click", () => {
      const filteredTodos = getTodos().filter((todo) => todo.id !== item.id);
      saveTodos(filteredTodos);
      renderTodos();
    });

    left.appendChild(checkbox);
    left.appendChild(textWrap);
    li.appendChild(left);
    li.appendChild(deleteButton);
    todoList.appendChild(li);
  });

  renderSubjectFocus(todoItems);
}

function formatPoints(points) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(points);
}

function renderSubjectFocus(todoItems = getTodos()) {
  const subjectList = document.getElementById("subject-list");
  if (!subjectList) {
    return;
  }

  const courses = new Map();
  todoItems.forEach((item) => {
    if (item.source !== "classroom" || !item.courseId) {
      return;
    }

    if (!courses.has(item.courseId)) {
      courses.set(item.courseId, {
        name: item.subject || "Google Classroom",
        totalPoints: 0,
        upcomingAssignments: []
      });
    }

    const course = courses.get(item.courseId);
    const points = Number(item.maxPoints);
    if (Number.isFinite(points) && points > 0) {
      course.totalPoints += points;
    }

    const dueTimestamp = item.dueDate
      ? new Date(`${item.dueDate}T00:00:00`).getTime()
      : Number.NaN;
    if (Number.isFinite(dueTimestamp) && !item.done) {
      course.upcomingAssignments.push({ ...item, dueTimestamp, points });
    }
  });

  subjectList.replaceChildren();
  const rows = [...courses.values()]
    .map((course) => {
      course.upcomingAssignments.sort((a, b) => a.dueTimestamp - b.dueTimestamp);
      return { ...course, nextAssignment: course.upcomingAssignments[0] };
    })
    .filter((course) => course.nextAssignment)
    .sort((a, b) => a.nextAssignment.dueTimestamp - b.nextAssignment.dueTimestamp);

  if (!rows.length) {
    const message = document.createElement("p");
    message.className = "subject-focus-empty";
    message.textContent = courses.size
      ? "No unsubmitted Classroom assignments with a due date."
      : "Sync Google Classroom to see upcoming scored assignments.";
    subjectList.appendChild(message);
    return;
  }

  rows.forEach((course) => {
    const { nextAssignment } = course;
    const percentage = course.totalPoints > 0
      && Number.isFinite(nextAssignment.points)
      && nextAssignment.points > 0
      ? (nextAssignment.points / course.totalPoints) * 100
      : 0;
    const formattedPercentage = percentage < 0.1 && percentage > 0
      ? "<0.1%"
      : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(percentage)}%`;

    const item = document.createElement("div");
    item.className = "subject-item";

    const topline = document.createElement("div");
    topline.className = "subject-topline";

    const subject = document.createElement("span");
    subject.textContent = course.name;
    const amount = document.createElement("span");
    amount.textContent = course.totalPoints > 0 ? formattedPercentage : "No points data";
    topline.append(subject, amount);

    const progress = document.createElement("div");
    progress.className = "progress-bar";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", `${course.name} next assignment share of listed points`);
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", String(percentage));
    const fill = document.createElement("span");
    fill.style.width = `${Math.min(percentage, 100)}%`;
    progress.appendChild(fill);

    const assignment = document.createElement("p");
    assignment.className = "subject-focus-assignment";
    assignment.textContent = `${nextAssignment.text} · Due ${formatDueDate(nextAssignment.dueDate)}`;
    if (Number.isFinite(nextAssignment.points) && nextAssignment.points > 0) {
      assignment.textContent += ` · ${formatPoints(nextAssignment.points)} of ${formatPoints(course.totalPoints)} pts`;
    } else {
      assignment.textContent += " · No point value";
    }

    item.append(topline, progress, assignment);
    subjectList.appendChild(item);
  });
}

function getSubmissionStatusLabel(state) {
  if (state === "TURNED_IN") {
    return "Turned in";
  }
  if (state === "RETURNED") {
    return "Returned";
  }
  return "Not turned in";
}

function isClassroomWorkSubmitted(state) {
  return state === "TURNED_IN" || state === "RETURNED";
}

function getSafeMaterialUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch (error) {
    return "";
  }
}

function addTodo(event) {
  event.preventDefault();

  const input = document.getElementById("todo-input");
  const subjectInput = document.getElementById("todo-subject");
  const dateInput = document.getElementById("todo-date");
  const text = input.value.trim();
  const subject = subjectInput ? subjectInput.value.trim() : "";
  const dueDate = dateInput ? dateInput.value : "";

  if (!text) {
    return;
  }

  const currentTodos = getTodos();
  currentTodos.push({
    id: Date.now(),
    text,
    subject,
    dueDate,
    done: false
  });

  saveTodos(currentTodos);
  input.value = "";
  if (subjectInput) {
    subjectInput.value = "";
  }
  if (dateInput) {
    dateInput.value = "";
  }
  renderTodos();
}

function updateClock() {
  const clockElement = document.getElementById("clock");
  const greetingElement = document.getElementById("greeting");
  const dateElement = document.getElementById("date");

  const now = new Date();
  const timeString = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });

  const dateString = now.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });

  const hour = now.getHours();
  let greeting = "Good evening";

  if (hour < 12) {
    greeting = "Good morning";
  } else if (hour < 18) {
    greeting = "Good afternoon";
  }

  const profile = getProfile();
  const firstName = profile && profile.name ? profile.name.trim().split(" ")[0] : "student operator";

  clockElement.textContent = timeString;
  greetingElement.textContent = `${greeting}, ${firstName}.`;
  dateElement.textContent = dateString;
}

function loadNotes() {
  return localStorage.getItem(NOTES_KEY) || "";
}

function saveNotes(content) {
  localStorage.setItem(NOTES_KEY, content);
}

function initializeNotes() {
  const notesInput = document.getElementById("notes-input");

  if (!notesInput) {
    return;
  }

  notesInput.value = loadNotes();
  notesInput.addEventListener("input", (event) => {
    saveNotes(event.target.value);
  });
}

function initializePriorityList() {
  const priorityItems = document.querySelectorAll("#priority-list li");

  priorityItems.forEach((item) => {
    const checkbox = item.querySelector("input");
    if (!checkbox) {
      return;
    }

    checkbox.addEventListener("change", () => {
      item.classList.toggle("done", checkbox.checked);
    });

    if (checkbox.checked) {
      item.classList.add("done");
    }
  });
}

function applyProfileToDashboard(profile) {
  const accountName = document.getElementById("account-name");
  const greeting = document.getElementById("greeting");
  const schoolTag = document.getElementById("profile-school-tag");
  const profileNameCard = document.getElementById("profile-name-card");
  const profileSchoolCard = document.getElementById("profile-school-card");
  const profileGradeCard = document.getElementById("profile-grade-card");
  const profileGoalCard = document.getElementById("profile-goal-card");

  if (accountName) {
    const firstName = profile.name ? profile.name.trim().split(" ")[0] : "Student";
    accountName.textContent = firstName;
  }

  if (schoolTag) {
    schoolTag.textContent = profile.school || "School";
  }

  if (profileNameCard) {
    profileNameCard.textContent = profile.name || "Student";
  }

  if (profileSchoolCard) {
    profileSchoolCard.textContent = profile.school || "School";
  }

  if (profileGradeCard) {
    profileGradeCard.textContent = profile.grade || "Grade";
  }

  if (profileGoalCard) {
    profileGoalCard.textContent = profile.goal || "Stay consistent";
  }

  if (greeting) {
    const now = new Date();
    const hour = now.getHours();
    let greetingText = "Good evening";

    if (hour < 12) {
      greetingText = "Good morning";
    } else if (hour < 18) {
      greetingText = "Good afternoon";
    }

    const firstName = profile.name ? profile.name.trim().split(" ")[0] : "student operator";
    greeting.textContent = `${greetingText}, ${firstName}.`;
  }
}

function showDashboard(profile) {
  document.body.classList.add("dashboard-ready");
  applyProfileToDashboard(profile);
  updateClock();

  if (!window.__prismClockInterval) {
    window.__prismClockInterval = setInterval(updateClock, 1000);
  }
}

function hideDashboard() {
  document.body.classList.remove("dashboard-ready");
}

function logoutFromDashboard() {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(CLASSROOM_TOKEN_KEY);
  location.reload();
}

function resetProfileFromDashboard() {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(CLASSROOM_TOKEN_KEY);

  const profileForm = document.getElementById("profile-form");
  if (profileForm) {
    profileForm.reset();
  }

  location.reload();
}

function decodeJwtPayload(token) {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const json = decodeURIComponent(
    atob(padded)
      .split("")
      .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
      .join("")
  );

  return JSON.parse(json);
}

function showAuthMessage(message) {
  const messageElement = document.getElementById("auth-message");

  if (!messageElement) {
    return;
  }

  messageElement.textContent = message;
  messageElement.hidden = !message;
}

function handleGoogleTokenResponse(tokenResponse, purpose) {
  if (!tokenResponse || !tokenResponse.access_token) {
    return;
  }

  showAuthMessage("");

  if (purpose === "classroom") {
    const expiresAt = Date.now() + Number(tokenResponse.expires_in || 3600) * 1000;
    localStorage.setItem(CLASSROOM_TOKEN_KEY, JSON.stringify({
      accessToken: tokenResponse.access_token,
      expiresAt
    }));
    syncClassroomAssignments();
    return;
  }

  fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${tokenResponse.access_token}`
    }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Google profile fetch failed: ${response.status}`);
      }
      return response.json();
    })
    .then((payload) => {
      const profile = {
        name: payload.name || payload.given_name || "Google Student",
        school: payload.hd || "Your School",
        grade: "Student",
        goal: "Stay organized and keep momentum with weekly goals.",
        provider: "google",
        email: payload.email || ""
      };

      saveProfile(profile);
      showDashboard(profile);
    })
    .catch((error) => {
      console.error("Google popup login failed.", error);
      showAuthMessage("Couldn't finish signing in with Google. Please try again.");
    });
}

function isGoogleClientConfigured() {
  return Boolean(
    GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID !== "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
  );
}

function createRandomState() {
  if (window.crypto && window.crypto.getRandomValues) {
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOAuthRedirectUri() {
  const directory = window.location.pathname.replace(/[^/]*$/, "");
  return `${window.location.origin}${directory}oauth-callback.html`;
}

function buildGoogleAuthUrl(state, purpose) {
  const scopes = purpose === "classroom"
    ? [
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
        "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly"
      ].join(" ")
    : "openid email profile";
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: getOAuthRedirectUri(),
    response_type: "token",
    scope: scopes,
    prompt: purpose === "classroom" ? "consent select_account" : "select_account",
    include_granted_scopes: "true",
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Opens our own popup window, centered on the browser window that opened it
// (not on the monitor), instead of leaving placement up to the browser.
function openCenteredPopup(url, name, width, height) {
  const outerWidth = window.outerWidth || document.documentElement.clientWidth || width;
  const outerHeight = window.outerHeight || document.documentElement.clientHeight || height;
  const screenX = window.screenX || window.screenLeft || 0;
  const screenY = window.screenY || window.screenTop || 0;

  const left = Math.round(screenX + (outerWidth - width) / 2);
  const top = Math.round(screenY + (outerHeight - height) / 2);

  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${Math.max(left, 0)}`,
    `top=${Math.max(top, 0)}`,
    "popup=1",
    "toolbar=0",
    "menubar=0",
    "location=0",
    "status=0"
  ].join(",");

  return window.open(url, name, features);
}

let expectedAuthState = null;
let authPopup = null;
let authPopupWatcher = null;
let authPurpose = null;

function stopWatchingAuthPopup() {
  if (authPopupWatcher) {
    clearInterval(authPopupWatcher);
    authPopupWatcher = null;
  }
}

function watchAuthPopup() {
  stopWatchingAuthPopup();

  authPopupWatcher = setInterval(() => {
    if (!authPopup || authPopup.closed) {
      stopWatchingAuthPopup();
      expectedAuthState = null;
      authPopup = null;
      authPurpose = null;
    }
  }, 500);
}

function handleGoogleAuthMessage(event) {
  if (event.origin !== window.location.origin) {
    return;
  }

  const data = event.data;
  if (!data || data.source !== "prism-google-auth" || data.state !== expectedAuthState) {
    return;
  }

  stopWatchingAuthPopup();
  const purpose = authPurpose;
  expectedAuthState = null;
  authPopup = null;
  authPurpose = null;

  if (data.error) {
    const message = data.error === "access_denied"
      ? "Google authorization was cancelled."
      : "Google authorization failed. Please try again.";
    if (purpose === "classroom") {
      setClassroomStatus(message);
    } else {
      showAuthMessage(message);
    }
    return;
  }

  if (data.accessToken) {
    handleGoogleTokenResponse({ access_token: data.accessToken }, purpose);
  }
}

function beginGoogleAuthorization(purpose) {
  if (!GOOGLE_AUTH_ENABLED || !isGoogleClientConfigured()) {
    if (purpose === "classroom") {
      setClassroomStatus("Google sign-in is not configured for this site.");
    } else {
      showAuthMessage("Google sign-in is not configured for this local environment. Please continue with the form below.");
      const profileInput = document.getElementById("profile-name");
      if (profileInput) {
        profileInput.focus();
      }
    }
    return;
  }

  authPurpose = purpose;
  expectedAuthState = createRandomState();
  authPopup = openCenteredPopup(
    buildGoogleAuthUrl(expectedAuthState, purpose),
    "prism-google-auth",
    480,
    600
  );

  if (!authPopup) {
    expectedAuthState = null;
    authPurpose = null;
    const message = "Your browser blocked the Google popup. Allow popups for this page and try again.";
    if (purpose === "classroom") {
      setClassroomStatus(message);
    } else {
      showAuthMessage(message);
    }
    return;
  }

  authPopup.focus();
  watchAuthPopup();
}

function handleGoogleLoginClick() {
  showAuthMessage("");
  beginGoogleAuthorization("login");
}

function setClassroomStatus(message) {
  const status = document.getElementById("classroom-status");
  if (status) {
    status.textContent = message;
  }
}

function getClassroomAccessToken() {
  const saved = localStorage.getItem(CLASSROOM_TOKEN_KEY);
  if (!saved) {
    return null;
  }

  try {
    const token = JSON.parse(saved);
    if (!token.accessToken || token.expiresAt <= Date.now() + 30000) {
      localStorage.removeItem(CLASSROOM_TOKEN_KEY);
      return null;
    }
    return token.accessToken;
  } catch (error) {
    localStorage.removeItem(CLASSROOM_TOKEN_KEY);
    return null;
  }
}

async function fetchClassroomPage(url, accessToken) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const result = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(CLASSROOM_TOKEN_KEY);
    }
    const error = new Error(result.error?.message || `Classroom API error (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return result;
}

async function fetchAllClassroomItems(url, accessToken) {
  const items = [];
  let pageUrl = new URL(url);

  while (pageUrl) {
    const result = await fetchClassroomPage(pageUrl.toString(), accessToken);
    items.push(...(result.courses || result.courseWork || result.studentSubmissions || []));
    if (result.nextPageToken) {
      pageUrl.searchParams.set("pageToken", result.nextPageToken);
    } else {
      pageUrl = null;
    }
  }

  return items;
}

function getClassroomCourseworkUrl(courseId, courseworkId, collection) {
  return `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseworkId)}/${collection}`;
}

async function getClassroomSubmission(courseId, courseworkId, accessToken) {
  const submissionsUrl = new URL(
    getClassroomCourseworkUrl(courseId, courseworkId, "studentSubmissions")
  );
  submissionsUrl.searchParams.set("userId", "me");
  submissionsUrl.searchParams.set("pageSize", "100");
  const submissions = await fetchAllClassroomItems(submissionsUrl.toString(), accessToken);
  return submissions[0] || { state: "NEW" };
}

function normalizeCourseworkMaterials(materials = []) {
  return materials.map((material) => {
    if (material.driveFile?.driveFile) {
      const file = material.driveFile.driveFile;
      return { title: file.title || "Google Drive file", url: file.alternateLink || "" };
    }
    if (material.youtubeVideo) {
      return {
        title: material.youtubeVideo.title || "YouTube video",
        url: material.youtubeVideo.alternateLink || material.youtubeVideo.url || ""
      };
    }
    if (material.link) {
      return { title: material.link.title || material.link.url || "Course link", url: material.link.url || "" };
    }
    if (material.form) {
      return { title: material.form.title || "Google Form", url: material.form.formUrl || "" };
    }
    return null;
  }).filter(Boolean);
}

async function verifyClassroomSubmission(todo) {
  const accessToken = getClassroomAccessToken();
  if (!accessToken) {
    setClassroomStatus("Reconnect Google Classroom to check submission status.");
    return;
  }

  setClassroomStatus(`Checking submission status for "${todo.text}"...`);
  try {
    const submission = await getClassroomSubmission(todo.courseId, todo.courseworkId, accessToken);
    const currentTodos = getTodos();
    const updatedTodos = currentTodos.map((item) => item.id === todo.id
      ? {
          ...item,
          submissionState: submission.state || "NEW",
          done: isClassroomWorkSubmitted(submission.state)
        }
      : item);
    saveTodos(updatedTodos);
    renderTodos();
    setClassroomStatus(
      isClassroomWorkSubmitted(submission.state)
        ? `"${todo.text}" is marked ${getSubmissionStatusLabel(submission.state).toLowerCase()} in Google Classroom.`
        : `"${todo.text}" has not been turned in in Google Classroom.`
    );
  } catch (error) {
    console.error("Could not verify Google Classroom submission status.", error);
    if (error.status === 401 || error.status === 403) {
      localStorage.removeItem(CLASSROOM_TOKEN_KEY);
      setClassroomStatus("Reconnect Google Classroom to grant assignment and submission access.");
      const syncButton = document.getElementById("classroom-sync-button");
      if (syncButton) {
        syncButton.textContent = "Reconnect Google Classroom";
      }
    } else {
      setClassroomStatus(`Could not check submission status: ${error.message}`);
    }
  }
}

async function syncClassroomAssignments() {
  const accessToken = getClassroomAccessToken();
  if (!accessToken) {
    setClassroomStatus("Connect Google Classroom to import assignments.");
    return;
  }

  const syncButton = document.getElementById("classroom-sync-button");
  if (syncButton) {
    syncButton.disabled = true;
  }
  setClassroomStatus("Syncing assignments...");

  try {
    const coursesUrl = new URL("https://classroom.googleapis.com/v1/courses");
    coursesUrl.searchParams.set("courseStates", "ACTIVE");
    coursesUrl.searchParams.set("studentId", "me");
    coursesUrl.searchParams.set("pageSize", "100");
    const courses = await fetchAllClassroomItems(coursesUrl.toString(), accessToken);
    const assignments = [];

    for (const course of courses) {
      const courseworkUrl = new URL(
        `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(course.id)}/courseWork`
      );
      courseworkUrl.searchParams.set("courseWorkStates", "PUBLISHED");
      courseworkUrl.searchParams.set("pageSize", "100");
      const coursework = await fetchAllClassroomItems(courseworkUrl.toString(), accessToken);

      for (const work of coursework) {
        const dueDate = work.dueDate
          ? `${work.dueDate.year}-${String(work.dueDate.month).padStart(2, "0")}-${String(work.dueDate.day).padStart(2, "0")}`
          : "";
        const submission = await getClassroomSubmission(course.id, work.id, accessToken);
        const submissionState = submission.state || "NEW";
        assignments.push({
          id: `classroom:${course.id}:${work.id}`,
          text: work.title || "Class assignment",
          subject: course.name || "Google Classroom",
          dueDate,
          maxPoints: Number.isFinite(work.maxPoints) ? work.maxPoints : 0,
          description: work.description || "",
          materials: normalizeCourseworkMaterials(work.materials),
          courseId: course.id,
          courseworkId: work.id,
          submissionState,
          done: isClassroomWorkSubmitted(submissionState),
          source: "classroom",
          assignmentUrl: work.alternateLink || "https://classroom.google.com"
        });
      }
    }

    const priorTodos = getTodos();
    const manualTodos = priorTodos.filter((todo) => todo.source !== "classroom");
    saveTodos([...manualTodos, ...assignments]);
    renderTodos();
    setClassroomStatus(`Synced ${assignments.length} assignment${assignments.length === 1 ? "" : "s"}.`);
  } catch (error) {
    console.error("Google Classroom sync failed.", error);
    if (error.status === 401 || error.status === 403) {
      localStorage.removeItem(CLASSROOM_TOKEN_KEY);
      setClassroomStatus("Reconnect Google Classroom to grant assignment and submission access.");
    } else {
      setClassroomStatus(`Sync failed: ${error.message}`);
    }
  } finally {
    if (syncButton) {
      syncButton.disabled = false;
      syncButton.textContent = getClassroomAccessToken()
        ? "Sync Google Classroom"
        : "Reconnect Google Classroom";
    }
  }
}

function initializeClassroomSync() {
  const syncButton = document.getElementById("classroom-sync-button");
  if (!syncButton) {
    return;
  }

  const accessToken = getClassroomAccessToken();
  syncButton.textContent = accessToken
    ? "Sync Google Classroom"
    : "Connect Google Classroom";
  syncButton.addEventListener("click", () => {
    if (getClassroomAccessToken()) {
      syncClassroomAssignments();
    } else {
      setClassroomStatus("Opening Google authorization...");
      beginGoogleAuthorization("classroom");
    }
  });

  if (accessToken) {
    syncClassroomAssignments();
  }
}

function initializeGoogleAuthListener() {
  if (!window.__prismGoogleAuthListenerAdded) {
    window.addEventListener("message", handleGoogleAuthMessage);
    window.__prismGoogleAuthListenerAdded = true;
  }
}

function initializeGoogleLogin() {
  const googleButton = document.getElementById("google-login");
  if (!googleButton) {
    return;
  }

  googleButton.addEventListener("click", handleGoogleLoginClick);
}

function createGoogleProfile() {
  const profile = {
    name: "Google Student",
    school: "Your School",
    grade: "12th Grade",
    goal: "Stay organized and keep momentum with weekly goals.",
    provider: "google"
  };

  saveProfile(profile);
  showDashboard(profile);
}

function openSettings() {
  const dropdown = document.getElementById("settings-dropdown");
  if (!dropdown) {
    return;
  }

  const profile = getProfile();
  if (!profile) {
    return;
  }

  document.getElementById("settings-name").value = profile.name || "";
  document.getElementById("settings-school").value = profile.school || "";
  setGradeSelectValue(document.getElementById("settings-grade"), profile.grade || "");
  document.getElementById("settings-goal").value = profile.goal || "";

  dropdown.classList.remove("hidden");
}

function closeSettings() {
  const dropdown = document.getElementById("settings-dropdown");
  if (!dropdown) {
    return;
  }

  dropdown.classList.add("hidden");
}

function saveSettings(profileUpdate) {
  const currentProfile = getProfile() || {};
  const updatedProfile = {
    ...currentProfile,
    ...profileUpdate,
    provider: currentProfile.provider || "manual"
  };

  saveProfile(updatedProfile);
  applyProfileToDashboard(updatedProfile);
  closeSettings();
}

function applyTheme(themeName) {
  const validThemes = [
    "cyberpunk",
    "violet",
    "sunset",
    "midnight",
    "neon-green",
    "ice-blue"
  ];
  const nextTheme = validThemes.includes(themeName) ? themeName : "cyberpunk";

  document.body.dataset.theme = nextTheme;
  localStorage.setItem(THEME_KEY, nextTheme);

  document.querySelectorAll(".theme-option").forEach((button) => {
    const isActive = button.dataset.theme === nextTheme;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function getDefaultQuickLinks() {
  return [
    { id: "google", name: "Google", url: "https://www.google.com" },
    { id: "gmail", name: "Gmail", url: "https://www.gmail.com" },
    { id: "canvas", name: "Canvas", url: "https://canvas.instructure.com" },
    { id: "schoology", name: "Schoology", url: "https://www.schoology.com" },
    { id: "github", name: "GitHub", url: "https://www.github.com" }
  ];
}

function isClassroomShortcut(link) {
  try {
    return new URL(link.url).hostname === "classroom.google.com";
  } catch (error) {
    return false;
  }
}

function getQuickLinks() {
  const saved = localStorage.getItem(QUICK_LINKS_KEY);

  if (!saved) {
    return getDefaultQuickLinks();
  }

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return getDefaultQuickLinks();
    }
    const filteredLinks = parsed.filter((link) => !isClassroomShortcut(link));
    if (filteredLinks.length !== parsed.length) {
      localStorage.setItem(QUICK_LINKS_KEY, JSON.stringify(filteredLinks));
    }
    return filteredLinks.length ? filteredLinks : getDefaultQuickLinks();
  } catch (error) {
    console.warn("Could not parse quick links.", error);
    return getDefaultQuickLinks();
  }
}

function saveQuickLinks(links) {
  localStorage.setItem(QUICK_LINKS_KEY, JSON.stringify(links.filter((link) => !isClassroomShortcut(link))));
}

function renderQuickLinks() {
  const launchLinks = document.getElementById("launch-links");
  if (!launchLinks) {
    return;
  }

  const links = getQuickLinks();
  launchLinks.innerHTML = "";

  links.forEach((link) => {
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = link.name;
    launchLinks.appendChild(anchor);
  });
}

function renderSavedLinks() {
  const savedLinksList = document.getElementById("saved-links-list");
  if (!savedLinksList) {
    return;
  }

  const links = getQuickLinks();
  savedLinksList.innerHTML = "";

  if (!links.length) {
    const emptyRow = document.createElement("li");
    emptyRow.textContent = "No school links saved yet.";
    savedLinksList.appendChild(emptyRow);
    return;
  }

  links.forEach((link) => {
    const item = document.createElement("li");
    item.className = "saved-link-item";

    const label = document.createElement("span");
    label.textContent = link.name;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "mini-delete";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove ${link.name}`);
    removeButton.addEventListener("click", () => {
      const filteredLinks = getQuickLinks().filter((entry) => entry.id !== link.id);
      saveQuickLinks(filteredLinks);
      renderQuickLinks();
      renderSavedLinks();
    });

    item.appendChild(label);
    item.appendChild(removeButton);
    savedLinksList.appendChild(item);
  });
}

function initializeQuickLinks() {
  renderQuickLinks();
  renderSavedLinks();

  const linksForm = document.getElementById("links-form");
  if (!linksForm) {
    return;
  }

  linksForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const nameInput = document.getElementById("link-name");
    const urlInput = document.getElementById("link-url");

    if (!nameInput || !urlInput) {
      return;
    }

    const name = nameInput.value.trim();
    const rawUrl = urlInput.value.trim();

    if (!name || !rawUrl) {
      return;
    }

    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const nextLinks = [
      ...getQuickLinks(),
      {
        id: `custom-${Date.now()}`,
        name,
        url: normalizedUrl
      }
    ];

    saveQuickLinks(nextLinks);
    renderQuickLinks();
    renderSavedLinks();
    linksForm.reset();
  });
}

function initializeSettingsNavigation() {
  const menuButtons = document.querySelectorAll(".menu-item");
  const panels = document.querySelectorAll(".settings-panel");

  if (!menuButtons.length || !panels.length) {
    return;
  }

  menuButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedPanel = button.dataset.panel;

      menuButtons.forEach((item) => item.classList.toggle("active", item === button));
      panels.forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.panel === selectedPanel);
      });
    });
  });

  const storedTheme = localStorage.getItem(THEME_KEY) || "cyberpunk";
  applyTheme(storedTheme);

  document.querySelectorAll(".theme-option").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.theme);
    });
  });
}

function initializeProfileSetup() {
  const profileForm = document.getElementById("profile-form");
  const existingProfile = getProfile();
  const logoutButton = document.getElementById("logout-button");
  const resetButton = document.getElementById("reset-profile-button");
  const settingsButton = document.getElementById("settings-button");
  const closeSettingsButton = document.getElementById("close-settings");
  const settingsForm = document.getElementById("settings-form");
  const dropdown = document.getElementById("settings-dropdown");

  initializeSettingsNavigation();
  initializeGoogleAuthListener();

  if (logoutButton) {
    logoutButton.addEventListener("click", logoutFromDashboard);
  }

  if (resetButton) {
    resetButton.addEventListener("click", resetProfileFromDashboard);
  }

  if (settingsButton) {
    settingsButton.addEventListener("click", () => {
      const isHidden = dropdown && dropdown.classList.contains("hidden");
      if (isHidden) {
        openSettings();
      } else {
        closeSettings();
      }
    });
  }

  if (closeSettingsButton) {
    closeSettingsButton.addEventListener("click", closeSettings);
  }

  if (dropdown) {
    dropdown.addEventListener("click", (event) => {
      if (event.target === dropdown) {
        closeSettings();
      }
    });
  }

  if (settingsForm) {
    settingsForm.addEventListener("submit", (event) => {
      event.preventDefault();

      saveSettings({
        name: document.getElementById("settings-name").value.trim() || "Student Operator",
        school: document.getElementById("settings-school").value.trim() || "School",
        grade: document.getElementById("settings-grade").value.trim() || "Grade",
        goal: document.getElementById("settings-goal").value.trim() || "Stay consistent."
      });
    });
  }

  if (existingProfile) {
    showDashboard(existingProfile);
    return;
  }

  hideDashboard();

  initializeGoogleLogin();

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const profile = {
      name: document.getElementById("profile-name").value.trim() || "Student Operator",
      school: document.getElementById("profile-school").value.trim() || "School",
      grade: document.getElementById("profile-grade").value.trim() || "Grade",
      goal: document.getElementById("profile-goal").value.trim() || "Stay consistent.",
      provider: "manual"
    };

    saveProfile(profile);
    showDashboard(profile);
  });
}

function initializeDashboard() {
  initializeProfileSetup();

  // These widgets don't depend on the profile. Wire them up before login too,
  // otherwise the task list, notes and ADD button stay dead after signing in
  // until the page is reloaded.
  renderTodos();
  initializeNotes();
  initializePriorityList();
  initializeQuickLinks();
  initializeClassroomSync();

  const form = document.getElementById("todo-form");
  if (form) {
    form.addEventListener("submit", addTodo);
  }

  if (getProfile()) {
    updateClock();

    if (!window.__prismClockInterval) {
      window.__prismClockInterval = setInterval(updateClock, 1000);
    }
  }
}

document.addEventListener("DOMContentLoaded", initializeDashboard);

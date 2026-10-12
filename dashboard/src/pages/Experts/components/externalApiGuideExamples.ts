interface ExampleText {
  message: string;
  followup: string;
  result: string;
  executionError: string;
  authError: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function externalApiGuideExamples(
  apiUrl: string,
  agentId: string,
  text: ExampleText,
) {
  const sessionId = "<session_id>";
  const taskId = "<task_id>";
  const body = { message: text.message, request_id: "requirement-001-turn-1" };
  const followup = {
    message: text.followup,
    request_id: "requirement-001-turn-2",
  };
  return {
    create: `export API_URL=${shellQuote(apiUrl)}
export API_KEY='<api-key>'

curl -sS -X POST "$API_URL/sessions" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{}'`,
    session: JSON.stringify(
      { session_id: sessionId, agent_id: agentId },
      null,
      2,
    ),
    submit: `SESSION_ID='<session_id>'

curl -sS -X POST "$API_URL/sessions/$SESSION_ID/messages" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d ${shellQuote(JSON.stringify(body, null, 2))}`,
    submitted: JSON.stringify(
      { task_id: taskId, session_id: sessionId, status: "queued" },
      null,
      2,
    ),
    poll: `TASK_ID='<task_id>'

curl -sS "$API_URL/tasks/$TASK_ID" \\
  -H "Authorization: Bearer $API_KEY"`,
    completed: JSON.stringify(
      {
        task_id: taskId,
        session_id: sessionId,
        status: "completed",
        result: text.result,
      },
      null,
      2,
    ),
    failed: JSON.stringify(
      {
        task_id: taskId,
        session_id: sessionId,
        status: "failed",
        error: text.executionError,
      },
      null,
      2,
    ),
    followup: `curl -sS -X POST "$API_URL/sessions/$SESSION_ID/messages" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d ${shellQuote(JSON.stringify(followup, null, 2))}`,
    authError: JSON.stringify(
      {
        error: { code: "AUTH_FAILED", message: text.authError, details: {} },
      },
      null,
      2,
    ),
    python: `import json
import os
import time
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

API_URL = os.environ.get("API_URL", ${JSON.stringify(apiUrl)}).rstrip("/")
API_KEY = os.environ["API_KEY"]


def call(method, path, body=None, timeout=30):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(API_URL + path, data=data, method=method, headers={
        "Authorization": "Bearer " + API_KEY,
        "Content-Type": "application/json",
    })
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc


def send_and_wait(session_id, message, wait_seconds=180):
    submitted = call("POST", f"/sessions/{session_id}/messages", {
        "message": message,
        "request_id": str(uuid.uuid4()),
    })
    task_id = submitted["task_id"]
    deadline = time.monotonic() + wait_seconds
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f"Task {task_id} is still pending")
        task = call("GET", f"/tasks/{task_id}", timeout=min(30, remaining))
        if task["status"] == "completed":
            return task["result"]
        if task["status"] == "failed":
            raise RuntimeError(task["error"])
        time.sleep(min(2, max(0, deadline - time.monotonic())))


session = call("POST", "/sessions", {})
print(send_and_wait(session["session_id"], ${JSON.stringify(text.message)}))
print(send_and_wait(session["session_id"], ${JSON.stringify(text.followup)}))`,
  };
}

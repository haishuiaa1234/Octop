import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import zh from "../../../locales/zh.json";
import { externalApiGuideExamples } from "./externalApiGuideExamples";

const apiUrl = "https://octop.example.test/api/v1/expert-api";
const text = {
  message: "Review the requirement",
  followup: "Add acceptance criteria",
  result: "Review completed",
  executionError: "Model call failed",
  authError: "Authentication failed",
};

describe("external API guide examples", () => {
  it("uses the public endpoint and a placeholder credential without agent overrides", () => {
    const examples = externalApiGuideExamples(apiUrl, "expert-a", text);
    expect(examples.create).toContain(`export API_URL='${apiUrl}'`);
    expect(examples.create).toContain("export API_KEY='<api-key>'");
    expect(examples.create).toContain('-X POST "$API_URL/sessions"');
    expect(examples.create).toContain("-d '{}'");
    expect(examples.submit).toContain("$API_URL/sessions/$SESSION_ID/messages");
    expect(examples.poll).toContain("$API_URL/tasks/$TASK_ID");
    for (const code of [examples.create, examples.submit, examples.poll]) {
      expect(code).toContain('"Authorization: Bearer $API_KEY"');
      expect(code).not.toContain("agent_id");
    }
  });

  it("matches session and asynchronous task response shapes", () => {
    const examples = externalApiGuideExamples(apiUrl, "expert-a", text);
    const ids = { session_id: "<session_id>", task_id: "<task_id>" };
    expect(JSON.parse(examples.session)).toEqual({
      session_id: ids.session_id,
      agent_id: "expert-a",
    });
    expect(JSON.parse(examples.submitted)).toEqual({
      ...ids,
      status: "queued",
    });
    expect(JSON.parse(examples.completed)).toEqual({
      ...ids,
      status: "completed",
      result: text.result,
    });
    expect(JSON.parse(examples.failed)).toEqual({
      ...ids,
      status: "failed",
      error: text.executionError,
    });
    expect(JSON.parse(examples.authError)).toEqual({
      error: { code: "AUTH_FAILED", message: text.authError, details: {} },
    });
  });

  it("escapes quoted JSON in Bash and uses a different request ID for each turn", () => {
    const quoted = 'Review "admin\'s" requirement\nthen $HOME';
    const examples = externalApiGuideExamples(apiUrl, "expert-a", {
      ...text,
      message: quoted,
    });
    const shellQuotedBody = examples.submit.split("  -d ")[1];
    expect(shellQuotedBody).toContain("'\\''");
    const body = JSON.parse(
      shellQuotedBody.slice(1, -1).replaceAll("'\\''", "'"),
    );
    expect(body).toEqual({
      message: quoted,
      request_id: "requirement-001-turn-1",
    });
    expect(examples.followup).toContain(
      '"request_id": "requirement-001-turn-2"',
    );
    expect(examples.followup).toContain(
      "$API_URL/sessions/$SESSION_ID/messages",
    );
    const quotedUrl = externalApiGuideExamples(`${apiUrl}/owner's`, "a", text);
    expect(quotedUrl.create).toContain("/owner'\\''s'");
  });

  it("provides matching localized guides and a bounded Python two-turn workflow", () => {
    const english = en.experts.externalApi.guide;
    const chinese = zh.experts.externalApi.guide;
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    for (const guide of [english, chinese]) {
      expect(
        Object.values(guide).every((value) => value.trim().length > 0),
      ).toBe(true);
      const examples = externalApiGuideExamples(apiUrl, "expert-a", {
        message: guide.exampleMessage,
        followup: guide.exampleFollowup,
        result: guide.exampleResult,
        executionError: guide.exampleExecutionError,
        authError: guide.exampleAuthError,
      });
      expect(examples.python).toContain('os.environ["API_KEY"]');
      expect(examples.python).toContain('call("POST", "/sessions", {})');
      expect(examples.python).toContain('"request_id": str(uuid.uuid4())');
      expect(examples.python).toContain("wait_seconds=180");
      expect(examples.python).toContain("time.monotonic()");
      expect(examples.python).toContain("raise TimeoutError");
      expect(examples.python).toContain('task["status"] == "completed"');
      expect(examples.python).toContain('task["status"] == "failed"');
      expect(examples.python).toContain(JSON.stringify(guide.exampleMessage));
      expect(examples.python).toContain(JSON.stringify(guide.exampleFollowup));
    }
  });
});

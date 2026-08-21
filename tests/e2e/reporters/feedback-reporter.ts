import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

interface TestFeedback {
  title: string;
  status: TestResult["status"];
  duration: number;
  errors: string[];
  attachments: string[];
}

class FeedbackReporter implements Reporter {
  private readonly tests: TestFeedback[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    this.tests.push({
      title: test.titlePath().filter((part) => part.length > 0 && !part.endsWith(".spec.ts")).join(" › "),
      status: result.status,
      duration: result.duration,
      errors: result.errors.map((error) => error.message ?? error.value ?? "Unknown test error"),
      attachments: result.attachments.flatMap((attachment) => attachment.path ? [attachment.path] : [])
    });
  }

  onEnd(result: FullResult): void {
    const outputDirectory = path.resolve("test-results");
    mkdirSync(outputDirectory, { recursive: true });

    const passed = this.tests.filter((test) => test.status === "passed").length;
    const lines = [
      "# MoldMaker test feedback",
      "",
      `Run status: **${result.status}** · ${passed}/${this.tests.length} tests passed`,
      ""
    ];

    for (const test of this.tests) {
      const marker = test.status === "passed" ? "PASS" : test.status.toUpperCase();
      lines.push(`## ${marker} · ${test.title}`, "", `Duration: ${(test.duration / 1000).toFixed(2)}s`);
      if (test.attachments.length > 0) {
        lines.push("", "Artifacts:", ...test.attachments.map((file) => `- ${path.relative(process.cwd(), file)}`));
      }
      if (test.errors.length > 0) {
        lines.push("", "Feedback:", ...test.errors.map((error) => `- ${error.replace(/\s+/g, " ").trim()}`));
      }
      lines.push("");
    }

    lines.push("Open `playwright-report/index.html` for screenshots, traces, and detailed steps.", "");
    writeFileSync(path.join(outputDirectory, "feedback.md"), lines.join("\n"), "utf8");
  }
}

export default FeedbackReporter;

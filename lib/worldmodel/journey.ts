import { visitAndCapture } from "./capture";
import { generateActionSpace } from "./actions";
import { buildJourneyTree } from "./dream";
import { verifyTopBranches } from "./verify";
import { JourneyReport, Finding, JourneyNode } from "./types";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";

function isUsable(node: JourneyNode): boolean {
  const d = node.verification?.discrepancy;
  if (!d) return false;
  return !d.startsWith("execution_error") && !d.startsWith("inconclusive");
}

async function synthesizeFindings(verifiedNodes: JourneyNode[]): Promise<Finding[]> {
  const usableNodes = verifiedNodes.filter(isUsable);

  if (usableNodes.length === 0) return [];

  const compact = usableNodes.map((node) => ({
    description: node.action.description,
    userProfile: node.action.userProfile,
    predictedFriction: node.prediction.predictedFriction,
    realFriction: node.verification?.realFriction ?? node.prediction.predictedFriction,
    predictionMatch: node.verification?.predictionMatch ?? 1,
    discrepancy: node.verification?.discrepancy ?? "not verified",
  }));

  const prompt = PROMPTS.synthesizeFindings.replace(
    "{VERIFIED_NODES_JSON}",
    JSON.stringify(compact, null, 2)
  );

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    const raw = JSON.parse(cleaned) as Array<{
      title: string;
      description: string;
      severity: "high" | "medium" | "low";
      step: string;
      nodeIndex: number;
    }>;

    return raw.map((f) => {
      const node = usableNodes[f.nodeIndex] || usableNodes[0];
      return {
        title: f.title,
        description: f.description,
        severity: f.severity,
        step: f.step,
        evidence: {
          predictedFriction: node.prediction.predictedFriction,
          realFriction: node.verification?.realFriction ?? node.prediction.predictedFriction,
          userProfile: node.action.userProfile,
        },
      };
    });
  } catch {
    return [];
  }
}

function calculateUXScore(nodes: JourneyNode[]): number {
  const verified = nodes.filter(isUsable);
  if (verified.length === 0) return 50;

  const totalFriction = verified.reduce(
    (sum, n) => sum + (n.verification?.realFriction ?? 0),
    0
  );
  const avgFriction = totalFriction / verified.length;

  const score = Math.round((1 - avgFriction) * 100);
  return Math.max(0, Math.min(100, score));
}

function buildVerdict(
  uxScore: number,
  findings: Finding[],
  usableCount: number
): string {
  if (usableCount === 0) {
    return "We couldn't verify any journeys on this site. The AI dreamed what would happen, but the actions couldn't be confirmed in the real browser.";
  }

  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;

  if (findings.length === 0) {
    return "No friction detected in the journeys we verified. Users of different profiles would move through the site as expected.";
  }

  if (uxScore >= 70) {
    return `Mostly smooth, with ${findings.length} minor issue${findings.length > 1 ? "s" : ""} worth reviewing.`;
  }

  if (uxScore >= 40) {
    const parts: string[] = [];
    if (highCount > 0) parts.push(`${highCount} serious issue${highCount > 1 ? "s" : ""}`);
    if (mediumCount > 0) parts.push(`${mediumCount} medium issue${mediumCount > 1 ? "s" : ""}`);
    return `Noticeable friction detected: ${parts.join(" and ")}. Users may hesitate or backtrack.`;
  }

  return `Significant UX problems. ${highCount} serious issue${highCount > 1 ? "s" : ""} will likely cause users to abandon the site.`;
}

export async function runJourneyAnalysis(url: string): Promise<JourneyReport> {
  console.log("[Spector] Capturing initial state...");
  const { browser, state } = await visitAndCapture(url);

  try {
    console.log("[Spector] Generating action space...");
    const actions = await generateActionSpace(state);

    console.log(`[Spector] Dreaming predictions for ${actions.length} actions...`);
    const journeyTree = await buildJourneyTree(state, actions);

    console.log("[Spector] Verifying top branches with reality...");
    const verifiedTree = await verifyTopBranches(browser, url, journeyTree, 5);

    const usableNodes = verifiedTree.filter(isUsable);

    console.log("[Spector] Synthesizing findings...");
    const findings = await synthesizeFindings(verifiedTree.filter((n) => n.verification));

    const uxScore = calculateUXScore(verifiedTree);
    const verdict = buildVerdict(uxScore, findings, usableNodes.length);

    return {
      url,
      uxScore,
      verdict,
      findings,
      journeyTree: verifiedTree,
      explorationStats: {
        actionsConsidered: actions.length,
        actionsPredicted: journeyTree.length,
        actionsVerified: usableNodes.length,
      },
    };
  } finally {
    await browser.close();
  }
}
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { runGoalAnalysis } = await import("./lib/worldmodel/goal-analysis.ts");

const URL = "https://www.kyoso.com/";

const result = await runGoalAnalysis(URL, "signup", "automatic");

console.log("\n\n========================================");
console.log(`GOAL: ${result.goal.label}`);
console.log(`PERSONA: ${result.persona.label} (${result.personaMode})`);
console.log("========================================\n");

console.log("VERDICT:");
console.log(result.verdict);
console.log("\nRECOMMENDATION:");
console.log(result.recommendation);

console.log(`\nBest route: ${result.bestRouteId || "none"}`);
console.log(`Most likely route: ${result.mostLikelyRouteId || "none"}`);

console.log("\n--- ROUTES ---\n");
result.routes.forEach((r) => {
  const tag = r.id === result.bestRouteId ? " [BEST]" : "";
  const likely = r.id === result.mostLikelyRouteId ? " [MOST LIKELY]" : "";
  console.log(`[${r.id}]${tag}${likely} via "${r.entryPoint}" — ${Math.round(r.probability * 100)}% of users`);
  console.log(`    Verified: ${r.verified} | Predicted friction: ${r.predictedFriction}${r.realFriction !== undefined ? ` | Real friction: ${r.realFriction.toFixed(2)}` : ""}`);
  if (r.verdict) console.log(`    ${r.verdict}`);

  if (r.stepResults) {
    r.stepResults.forEach((s, i) => {
      const step = r.predictedSteps[i];
      console.log(`      ${i + 1}. ${step.description}`);
      console.log(`         -> ${s.whatHappened}`);
    });
  }
  console.log();
});
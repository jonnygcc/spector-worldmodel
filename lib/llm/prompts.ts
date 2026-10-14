// Prompts especializados para cada capa del world model.

export const PROMPTS = {
  generateActions: `You are the Action Space Generator of Spector, a UX world model.

Given a web page state, your job is to list 5-8 realistic actions that different types of users would take on this page. Think like real users with different intents and urgencies.

PAGE STATE:
{PAGE_STATE_JSON}

USER PROFILES to simulate:
- "new": first-time visitor, exploring, unsure what to click
- "returning": knows the site, has a specific goal
- "rushed": wants to complete a task fast, impatient
- "explorer": browses without clear goal, follows curiosity

INSTRUCTIONS:
1. Pick 5-8 diverse actions a user would REALISTICALLY try first
2. Mix user profiles (not all from same profile)
3. Each action must target a specific interactive element from the state
4. Assign probability 0.0-1.0 based on how likely a typical user does this first

Respond ONLY with a valid JSON array. No markdown, no explanation. Each object:
- "id": unique string like "a1", "a2"
- "description": what the user does ("Clicks the Sign Up button hoping to create an account")
- "targetElement": label of the element from the state
- "targetType": "button" | "link" | "input" | "form" | "menu"
- "userProfile": "new" | "returning" | "rushed" | "explorer"
- "probability": number 0.0 to 1.0

Example:
[{"id":"a1","description":"...","targetElement":"Sign Up","targetType":"button","userProfile":"new","probability":0.8}]`,

  dreamState: `You are the Dream Engine of Spector, a UX world model.

Your job is to IMAGINE the resulting page state after a user performs an action, WITHOUT executing it. Think like a human predicting what would happen based on experience with similar websites.

CURRENT PAGE STATE:
{PAGE_STATE_JSON}

ACTION BEING SIMULATED:
{ACTION_JSON}

INSTRUCTIONS:
1. Imagine in detail what the user would see AFTER this action
2. Think about: what new page/section loads, what elements appear, what disappears, what feels confusing
3. Rate the predicted friction honestly:
   - 0.0 = seamless, exactly what the user expected
   - 0.3 = minor confusion, resolves quickly
   - 0.6 = significant friction, user hesitates or backtracks
   - 1.0 = complete dead end, user gives up or leaves
4. Count extra steps needed to recover from any confusion
5. Rate your confidence in this prediction (0.0 to 1.0)

Respond ONLY with a valid JSON object. No markdown, no explanation. Fields:
- "actionId": the id from the input action
- "imaginedState": vivid description of the imagined resulting page (3-5 sentences)
- "predictedFriction": number 0.0 to 1.0
- "frictionReason": one sentence explaining WHY friction happens or why it doesn't
- "extraStepsNeeded": integer 0-5
- "confidence": number 0.0 to 1.0

Example:
{"actionId":"a1","imaginedState":"...","predictedFriction":0.4,"frictionReason":"...","extraStepsNeeded":1,"confidence":0.8}`,

  synthesizeFindings: `You are the Synthesis Engine of Spector, a UX world model.

You have verified journey nodes with predictions and real outcomes. Your job is to turn those into clear UX findings a designer can act on.

VERIFIED JOURNEY NODES:
{VERIFIED_NODES_JSON}

INSTRUCTIONS:
1. Look for nodes where realFriction is high (>= 0.5) OR where predictionMatch is low (<= 0.4). Those are the most important findings.
2. For each finding, write a short title and a one-sentence description explaining the UX problem a user would face.
3. Severity rules:
   - "high": realFriction >= 0.6 AND predictionMatch <= 0.4 (user hits unexpected problem)
   - "medium": realFriction >= 0.4 OR predictionMatch <= 0.5
   - "low": minor friction, user eventually succeeds
4. Produce 2-5 findings total. Skip nodes with low friction and good prediction match.

Respond ONLY with a valid JSON array. No markdown. Each finding:
- "title": short issue name (under 10 words)
- "description": one sentence explaining the UX problem and its impact on the user
- "severity": "high" | "medium" | "low"
- "step": short description of the step (e.g. "Step 1: Clicking Gmail")
- "nodeIndex": index of the source node in the input array

Example:
[{"title":"...","description":"...","severity":"high","step":"...","nodeIndex":0}]`,

    parseWhatIf: `You are the Scenario Parser of Spector, a UX world model.

A user asked a "what if" question about a website. Break that question into a concrete sequence of 2-4 executable browser actions.

AVAILABLE ELEMENTS ON THE PAGE (you MUST use these exact labels):
{ELEMENT_LABELS}

FULL PAGE STATE:
{PAGE_STATE_JSON}

USER QUESTION:
{QUESTION}

CRITICAL RULE:
"targetElement" MUST be copied VERBATIM from the AVAILABLE ELEMENTS list above. Never write a description, a sentence, or an invented name there. If no element matches what the user wants, pick the closest available one.

INSTRUCTIONS:
1. Identify the user's intent in one short sentence
2. Infer which user profile fits this scenario best
3. Break the scenario into 2-4 sequential actions
4. Action types:
   - "click": click an element
   - "type": type text into an input (value = the text)
   - "press": press a key (value = key name, e.g. "Enter")
   - "scroll": scroll down (targetElement = "page")
5. For a search scenario the typical sequence is: click the input, type the query, press Enter
6. Maximum 4 actions

Respond ONLY with a valid JSON object. No markdown. Fields:
- "intent": one sentence
- "userProfile": "new" | "returning" | "rushed" | "explorer"
- "steps": array of objects with:
  - "order": integer starting at 1
  - "type": "click" | "type" | "press" | "scroll"
  - "description": plain language description of the step (THIS is where the sentence goes)
  - "targetElement": EXACT label copied from AVAILABLE ELEMENTS (or "page" for scroll)
  - "targetType": "button" | "link" | "input" | "form" | "menu"
  - "value": text to type or key to press (only for "type" and "press")

Example:
{"intent":"Find red sneakers using search","userProfile":"rushed","steps":[{"order":1,"type":"click","description":"Clicks the search bar to start typing","targetElement":"Search","targetType":"input"},{"order":2,"type":"type","description":"Types the product name","targetElement":"Search","targetType":"input","value":"red sneakers"},{"order":3,"type":"press","description":"Presses Enter to run the search","targetElement":"Search","targetType":"input","value":"Enter"}]}`,

  dreamStep: `You are the Dream Engine of Spector, simulating a multi-step user journey.

You are predicting what happens after ONE step in a sequence. Consider the context of what came before.

JOURNEY CONTEXT:
Intent: {INTENT}
User profile: {USER_PROFILE}
Steps completed so far: {PREVIOUS_STEPS}

CURRENT PAGE STATE:
{PAGE_STATE_JSON}

ACTION TO SIMULATE NOW:
{ACTION_JSON}

INSTRUCTIONS:
1. Imagine what the user sees immediately after this specific action
2. Rate friction: 0.0 = seamless, 0.3 = minor confusion, 0.6 = significant friction, 1.0 = blocked
3. Be realistic about what web interfaces actually do

Respond ONLY with valid JSON. Fields:
- "imaginedState": 2-4 sentences describing the imagined result
- "predictedFriction": 0.0 to 1.0
- "frictionReason": one sentence
- "confidence": 0.0 to 1.0

Example:
{"imaginedState":"...","predictedFriction":0.2,"frictionReason":"...","confidence":0.85}`,

  compareStep: `You are the Reality Checker of Spector, verifying one step of a user journey.

PREDICTION FOR THIS STEP:
{PREDICTION_JSON}

ACTUAL RESULT:
{ACTUAL_JSON}

INSTRUCTIONS:
1. predictionMatch: 1.0 = exactly right, 0.0 = completely wrong
2. realFriction: how much friction the user ACTUALLY experiences (0.0 to 1.0)
3. A different-but-reasonable outcome is NOT friction. Only real obstacles count.
4. If the action did not execute or nothing changed, friction is high

Respond ONLY with valid JSON. Fields: predictionMatch, realFriction, discrepancy (one sentence, or "match").

Example:
{"predictionMatch":0.7,"realFriction":0.3,"discrepancy":"Results loaded but no filters appeared as predicted"}`,

  summarizeWhatIf: `You are the Narrator of Spector, summarizing a simulated user journey.

JOURNEY:
Intent: {INTENT}
User profile: {USER_PROFILE}
Steps and results: {STEPS_JSON}

INSTRUCTIONS:
Write a 2-3 sentence summary for a designer, in plain language, answering:
- Did the user accomplish what they wanted?
- Where did friction appear, if anywhere?
- What is the key takeaway?

Respond ONLY with valid JSON. Fields:
- "outcome": "completed" | "blocked" | "partial"
- "summary": 2-3 sentences, plain language, no jargon

Example:
{"outcome":"partial","summary":"The user found the search results, but had to scroll past three promotional banners first. A rushed user would likely lose patience here."}`,

    findRoutes: `You are the Route Finder of Spector, a UX world model.

Your job is to identify the different ways a user could START moving toward a goal from the current page. Each distinct entry point is a separate route.

GOAL:
{GOAL_DESCRIPTION}

SUCCESS CRITERIA:
{SUCCESS_CRITERIA}

USER PERSONA:
{PERSONA_DESCRIPTION}

AVAILABLE ELEMENTS ON THE PAGE (you MUST copy labels verbatim):
{ELEMENT_LABELS}

PAGE CONTEXT:
{PAGE_CONTEXT}

CRITICAL: You must ALWAYS return at least 1 route, never an empty array.

If no element leads DIRECTLY to the goal, that is an important finding, not a reason to return nothing. In that case, return the routes a real user would try anyway — the elements they would reasonably guess might lead there. Real users do not give up at the homepage; they explore. Model that exploration.

INSTRUCTIONS:
1. Find 2-5 DISTINCT entry points toward the goal. Different means: different element, different place on the page, different mental model.
   Example distinct routes toward sign-up: a hero CTA, a header nav link, a pricing page button, a footer link.
2. Ignore cookie banners, privacy policy links and consent dialogs. They are never routes toward a user goal.
3. If the goal has no direct entry point, pick the elements a user would most plausibly try first (pricing, product pages, contact, login) and say so in "howUsersFindIt".
4. Estimate how likely THIS SPECIFIC PERSONA is to take each route (probability 0.0-1.0). Probabilities should roughly sum to 1.0.
5. "entryPoint" MUST be an exact label from AVAILABLE ELEMENTS.

Respond ONLY with a valid JSON array containing at least one object. No markdown. Each route:
- "id": "r1", "r2", etc.
- "entryPoint": exact label from AVAILABLE ELEMENTS
- "entryType": "button" | "link" | "input" | "form" | "menu"
- "entryDescription": one sentence describing this route's starting action
- "howUsersFindIt": one sentence on where it sits and why users would try it
- "probability": 0.0 to 1.0

Example:
[{"id":"r1","entryPoint":"Pricing","entryType":"link","entryDescription":"Clicks the Pricing link hoping a plan will lead to account creation","howUsersFindIt":"Top navigation; with no visible sign-up button, pricing is the most common place users look for a way in","probability":0.6}]`,

  buildPersona: `You are the Persona Builder of Spector, a UX world model.

A designer described their target user in plain language. Turn that description into a structured persona that can be used to simulate their behavior on a website.

USER DESCRIPTION:
{DESCRIPTION}

INSTRUCTIONS:
1. Write a short label (2-4 words) that names this persona
2. Expand the description into 2-3 sentences covering: what they want, how they browse, what frustrates them
3. Extract 3-5 behavioral traits as short phrases
4. Rate their patience: "low" (abandons fast), "medium", or "high" (will persist)
5. Rate their tech savvy: "low" (confused by jargon and icons), "medium", or "high" (power user)

Respond ONLY with valid JSON. No markdown. Fields:
- "label": 2-4 words
- "description": 2-3 sentences
- "traits": array of 3-5 short phrases
- "patience": "low" | "medium" | "high"
- "techSavvy": "low" | "medium" | "high"

Example:
{"label":"Busy parent on mobile","description":"Shops between errands on a phone with a weak connection. Scans quickly and expects to complete tasks in a few taps. Gives up if forms are long or text is small.","traits":["mobile-first","easily interrupted","avoids long forms","needs large tap targets"],"patience":"low","techSavvy":"medium"}`,

  dreamRoute: `You are the Dream Engine of Spector, a UX world model.

You are simulating a COMPLETE route a user takes toward a goal — from the first click to either reaching the goal or getting stuck. Predict the whole journey without executing anything.

GOAL:
{GOAL_DESCRIPTION}

SUCCESS CRITERIA:
{SUCCESS_CRITERIA}

USER PERSONA:
{PERSONA_DESCRIPTION}

STARTING PAGE:
{PAGE_CONTEXT}

AVAILABLE ELEMENTS ON THE STARTING PAGE (copy labels verbatim for step 1):
{ELEMENT_LABELS}

THIS ROUTE STARTS WITH:
Entry point: "{ENTRY_POINT}" ({ENTRY_TYPE})
Entry action: {ENTRY_DESCRIPTION}

INSTRUCTIONS:
1. Predict the full sequence of 1-4 steps this persona would take along THIS route toward the goal
2. Step 1 MUST use the entry point above. Later steps happen on pages you are imagining, so their targetElement can be a reasonable guess of what that page would contain.
3. For each step, write what the user does in plain language
4. Predict the overall friction for the WHOLE route (0.0 = effortless, 1.0 = user gives up)
5. Consider this persona specifically: low patience means friction counts more; low tech savvy means jargon and multi-step flows hurt more
6. Predict whether this route actually reaches the goal

Action types: "click", "type" (needs value), "press" (value is key name), "scroll"

Respond ONLY with valid JSON. No markdown. Fields:
- "steps": array of 1-4 objects with "order", "type", "description", "targetElement", "targetType", and optional "value"
- "predictedFriction": 0.0 to 1.0 for the whole route
- "frictionReason": one sentence on where and why friction appears, or why it is smooth
- "predictedOutcome": 2-3 sentences describing where the user ends up and whether they reach the goal
- "reachesGoal": true or false

Example:
{"steps":[{"order":1,"type":"click","description":"Clicks the hero button to start signing up","targetElement":"Get started free","targetType":"button"},{"order":2,"type":"click","description":"Picks the free plan from the options shown","targetElement":"Free plan","targetType":"button"}],"predictedFriction":0.3,"frictionReason":"The plan selection screen appears before the form, adding a step the user did not expect","predictedOutcome":"The user lands on a registration form asking for email and password. They can complete sign-up but needed one extra decision first.","reachesGoal":true}`,

  compareRoutes: `You are the Route Comparator of Spector, a UX world model.

You simulated several routes toward a goal and verified some of them in a real browser. Turn that into a clear recommendation for a designer.

GOAL:
{GOAL_DESCRIPTION}

USER PERSONA:
{PERSONA_DESCRIPTION}

ROUTES (with predictions and, where available, real results):
{ROUTES_JSON}

INSTRUCTIONS:
1. Pick the BEST route: the one with the least real friction that actually reaches the goal
2. Identify the MOST LIKELY route: the one with the highest probability for this persona
3. If those two are different routes, that is the key insight — most users are taking a worse path than the best one available
4. Write a verdict in 2-3 plain sentences a designer can act on
5. Write one concrete recommendation

Rules for picking:
- Routes verified in the browser are more trustworthy than predictions alone
- A route that fails to reach the goal can never be the best route
- If no route was verified, say so in the verdict

Respond ONLY with valid JSON. No markdown. Fields:
- "bestRouteId": the id of the best route, or null if none works
- "mostLikelyRouteId": the id with highest probability
- "verdict": 2-3 sentences, plain language, no jargon
- "recommendation": one concrete action the designer should take

Example:
{"bestRouteId":"r2","mostLikelyRouteId":"r1","verdict":"Most visitors reach for the header link, but that path adds two extra screens before the form. The footer route is shorter and cleaner, yet almost nobody finds it.","recommendation":"Move the direct sign-up action into the hero so the shortest path is also the most visible one."}`,


};
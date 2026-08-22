// Supabase Edge Function (Deno).
//
// Autonomous AI report triage. Fired by trg_link_report_to_moderation_case
// (see schema.sql) whenever a report creates a brand-new moderation_cases
// row - never on a dedup-link to an existing open case, which is what
// keeps a burst of reports against one target (37 people reporting the
// same message) to a single analysis rather than one per report. Also
// callable directly from web/src/app/admin (the "Re-run AI Analysis"
// button) and from the deferred-budget sweep cron job (schema.sql, commented
// out until enabled) with { sweep: true } instead of a caseId.
//
// Pipeline per case: a free OpenAI moderation-endpoint pass always runs
// first; a contextual reasoning-model pass only runs when specific
// escalation criteria are met AND the cost circuit breaker allows it.
// Every write is best-effort against moderation_cases - a report and its
// case already exist before any OpenAI call happens, so a total OpenAI
// outage degrades triage (cases pile up needing human review) but never
// loses a report.

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Same reasoning as moderationAction: every Edge Function until recently
// was only ever called from the mobile app (no CORS enforcement there).
// This one is also called from the web admin dashboard.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// gpt-5-mini pricing per OpenAI's published rates, as of this writing -
// update these two constants if OpenAI reprices. The moderation-endpoint
// pass is free, logged at $0 rather than omitted, so the usage log stays a
// complete record of every OpenAI call this feature makes.
const GPT5_MINI_INPUT_COST_PER_1M = 0.25;
const GPT5_MINI_OUTPUT_COST_PER_1M = 2.0;

// OpenAI's own moderation-endpoint category names that map to the spec's
// "always gets contextual analysis regardless of budget" safety-critical
// set. Doxxing has no direct OpenAI category - it's only caught via the
// report-reason keyword check below, not this list.
const SAFETY_CRITICAL_MODERATION_CATEGORIES = [
  "harassment/threatening",
  "hate/threatening",
  "self-harm/intent",
  "self-harm/instructions",
  "sexual/minors",
  "violence/graphic",
];
const HIGH_RISK_REASON_KEYWORDS = [
  "harassment",
  "hate speech",
  "threat",
  "violence",
  "self-harm",
  "self harm",
  "suicide",
  "doxx",
  "sexual",
  "child",
];
const REPEAT_BEHAVIOR_KEYWORDS = ["again", "keeps", "repeatedly", "every time", "always does"];

type TargetType = "message" | "user" | "conversation";
type Severity = "critical" | "high" | "medium" | "low";
type Priority = "P0" | "P1" | "P2" | "P3";

interface ModerationCaseRow {
  id: string;
  target_type: TargetType;
  target_id: string;
  reported_user_id: string | null;
  reported_content_snapshot: string | null;
  report_count: number;
}

interface ReportRow {
  reporter_id: string;
  reason: string;
  context_message_id: string | null;
  created_at: string;
}

interface ContextualAssessment {
  severity: Severity;
  confidence: number;
  violation_category: string;
  recommended_action: "likely_no_violation" | "likely_violation" | "needs_human_review" | "high_priority_human_review";
  priority: Priority;
  requires_human_review: boolean;
  ai_recommended_dismissal: boolean;
  // "context_only" is the field that would have caught the confirmed-live
  // false positive this was added for: a benign reported message
  // ("I love strawberries!") got assessed as a critical threat because a
  // genuine death threat turned up in the SAME user's other, unrelated
  // messages (fed in as background context) - the model correctly
  // recognized the reported content itself was harmless, but nothing
  // stopped that discovery from driving severity/priority for a case that
  // was never actually about it, and auto-delete acted on target_id (the
  // reported message), deleting the wrong thing entirely.
  severity_based_on: "reported_content" | "context_only";
  reasoning: string;
}

function envInt(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Lightweight pass - OpenAI's moderation endpoint. Free, always runs first,
// exempt from the circuit breaker entirely.
// ---------------------------------------------------------------------------
interface ModerationResult {
  flagged: boolean;
  flaggedCategories: string[];
  topCategory: string | null;
  topScore: number;
}

async function callOpenAIModeration(content: string): Promise<ModerationResult> {
  const res = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({ model: "omni-moderation-latest", input: content || "(no content)" }),
  });
  if (!res.ok) {
    // OpenAI's actual error body (e.g. "You exceeded your current quota,
    // please check your plan and billing details") is far more actionable
    // than the bare status code alone - a 429 in particular can mean
    // either genuine rate limiting or an account with no payment method/
    // credit balance attached (insufficient_quota), which look identical
    // at the HTTP-status level but need completely different fixes.
    const errorBody = await res.text().catch(() => "");
    throw new Error(`OpenAI moderation call failed: ${res.status} ${errorBody}`);
  }
  const data = await res.json();
  const result = data.results[0];
  const scores: Record<string, number> = result.category_scores ?? {};
  let topCategory: string | null = null;
  let topScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > topScore) {
      topScore = score;
      topCategory = cat;
    }
  }
  const flaggedCategories = Object.entries(result.categories as Record<string, boolean>)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return { flagged: result.flagged, flaggedCategories, topCategory, topScore };
}

// ---------------------------------------------------------------------------
// Deterministic PII pattern check - not a model call, $0, safe to run on
// every message. OpenAI's moderation endpoint has no "doxxing / personal
// information" category in its taxonomy at all (its categories are
// harassment/hate/violence/sexual/self-harm), so it's structurally
// incapable of catching "here's his address, go bother him" - that phrase
// alone doesn't read as hateful or violent. This is the second, independent
// signal that closes that gap. Deliberately over-inclusive: the street-
// address heuristic in particular will flag plenty of harmless mentions
// ("meet at 123 Main St Starbucks") - that's fine, a false match here only
// costs an escalation to the context-aware model, which is exactly where
// "is this actually targeting a specific person" should be judged, not
// rejected at the pattern-match stage.
// ---------------------------------------------------------------------------
const PII_PATTERNS: { kind: string; pattern: RegExp }[] = [
  { kind: "phone_number", pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/ },
  { kind: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { kind: "ssn_like", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { kind: "street_address", pattern: /\b\d{1,6}\s+\w+(\s+\w+){0,3}\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl)\b/i },
];

function detectPII(content: string): { matched: boolean; kind?: string } {
  for (const { kind, pattern } of PII_PATTERNS) {
    if (pattern.test(content)) return { matched: true, kind };
  }
  return { matched: false };
}

function deriveFromLightweight(moderation: ModerationResult): { severity: Severity; priority: Priority } {
  if (!moderation.flagged) return { severity: "low", priority: "P3" };
  const isSafetyCritical = moderation.flaggedCategories.some((c) => SAFETY_CRITICAL_MODERATION_CATEGORIES.includes(c));
  if (isSafetyCritical) return { severity: "critical", priority: "P0" };
  if (moderation.topScore > 0.7) return { severity: "high", priority: "P1" };
  if (moderation.topScore > 0.4) return { severity: "medium", priority: "P2" };
  return { severity: "low", priority: "P3" };
}

// ---------------------------------------------------------------------------
// Escalation decision - concrete boolean checks mapped from the spec's
// criteria list. Anything true here means the contextual (paid) pass is
// warranted, pending the circuit breaker below.
// ---------------------------------------------------------------------------
function decideEscalation(params: {
  moderation: ModerationResult;
  reasons: string[];
  reportCount: number;
  reportedUserRecentCaseCount: number;
  contentLength: number;
  confidenceThreshold: number;
}): boolean {
  const { moderation, reasons, reportCount, reportedUserRecentCaseCount, contentLength, confidenceThreshold } = params;
  const reasonsLower = reasons.map((r) => r.toLowerCase());

  if (moderation.flagged) return true;
  // Also covers "moderation result conflicts with report reason" - this
  // check doesn't care whether moderation.flagged was true, so a report
  // reason implying something serious that the moderation pass missed
  // still escalates.
  if (reasonsLower.some((r) => HIGH_RISK_REASON_KEYWORDS.some((k) => r.includes(k)))) return true;
  if (contentLength > 0 && contentLength < 20 && moderation.topScore > 0.1) return true; // short + ambiguous without context
  if (reportCount > 1) return true; // multiple reporters already, before this case's first analysis even completed
  if (reasonsLower.some((r) => REPEAT_BEHAVIOR_KEYWORDS.some((k) => r.includes(k)))) return true;
  if (reportedUserRecentCaseCount >= 2) return true;
  if (moderation.topScore > 0 && moderation.topScore < confidenceThreshold) return true; // low-confidence lightweight result
  return false;
}

// ---------------------------------------------------------------------------
// Cost circuit breaker - queried live against moderation_config +
// ai_moderation_usage_log on every invocation, no caching. A race between
// two invocations near a threshold both reading "under budget" and both
// proceeding is accepted, not guarded against - at this app's scale
// (contextual calls cost fractions of a cent each) the worst case is
// overshooting a monthly cap by a few cents, not worth an advisory lock.
// ---------------------------------------------------------------------------
type BudgetTier = "normal" | "warning" | "high" | "hard";

async function computeBudgetTier(supabaseAdmin: SupabaseClient): Promise<BudgetTier> {
  const { data: configRows } = await supabaseAdmin.from("moderation_config").select("key, value");
  const limits: Record<string, number> = {};
  for (const row of configRows ?? []) limits[row.key] = parseFloat(row.value);
  const dailyLimit = limits["AI_DAILY_COST_LIMIT_USD"] ?? 2;
  const monthlyLimit = limits["AI_MONTHLY_COST_LIMIT_USD"] ?? 20;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [{ data: todayRows }, { data: monthRows }] = await Promise.all([
    supabaseAdmin.from("ai_moderation_usage_log").select("estimated_cost_usd").gte("created_at", todayStart),
    supabaseAdmin.from("ai_moderation_usage_log").select("estimated_cost_usd").gte("created_at", monthStart),
  ]);
  const todaySpend = (todayRows ?? []).reduce((sum, r) => sum + Number(r.estimated_cost_usd), 0);
  const monthSpend = (monthRows ?? []).reduce((sum, r) => sum + Number(r.estimated_cost_usd), 0);

  const pct = Math.max(todaySpend / dailyLimit, monthSpend / monthlyLimit);
  if (pct >= 1) return "hard";
  if (pct >= 0.9) return "high";
  if (pct >= 0.75) return "warning";
  return "normal";
}

// Global + per-reporter rate caps, on top of (not instead of) the report-
// submission rate limit trigger in schema.sql - that one caps how many
// reports a user can file at all, this caps how many of those go on to
// trigger a paid contextual analysis.
async function underRateCaps(supabaseAdmin: SupabaseClient, reporterId: string | null): Promise<boolean> {
  const globalCap = envInt("AI_MAX_GLOBAL_ANALYSES_PER_MINUTE", 60);
  const perReporterCap = envInt("AI_MAX_REPORT_ANALYSES_PER_USER_PER_HOUR", 20);

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: globalCount } = await supabaseAdmin
    .from("ai_moderation_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("call_type", "contextual_analysis")
    .gte("created_at", oneMinuteAgo);
  if ((globalCount ?? 0) >= globalCap) return false;

  if (!reporterId) return true;
  const { data: reporterReports } = await supabaseAdmin
    .from("reports")
    .select("moderation_case_id")
    .eq("reporter_id", reporterId)
    .not("moderation_case_id", "is", null);
  const caseIds = [...new Set((reporterReports ?? []).map((r) => r.moderation_case_id as string))];
  if (caseIds.length === 0) return true;
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: reporterCount } = await supabaseAdmin
    .from("ai_moderation_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("call_type", "contextual_analysis")
    .in("case_id", caseIds)
    .gte("created_at", oneHourAgo);
  return (reporterCount ?? 0) < perReporterCap;
}

// ---------------------------------------------------------------------------
// Content + context gathering
// ---------------------------------------------------------------------------
async function loadLiveContent(
  supabaseAdmin: SupabaseClient,
  modCase: ModerationCaseRow,
  reports: ReportRow[]
): Promise<string | null> {
  if (modCase.target_type === "message") {
    const { data } = await supabaseAdmin.from("messages").select("username, body").eq("id", modCase.target_id).maybeSingle();
    return data ? `${data.username}: ${data.body}` : null;
  }
  if (modCase.target_type === "user") {
    // A user report has no single piece of content of its own - the
    // context_message_id captured when the profile card was opened (see
    // ConversationScreen.tsx#openProfile) is the actual evidence. Several
    // linked reports can carry different context messages (different
    // people reported the same user after seeing different things).
    const contextMessageIds = [...new Set(reports.map((r) => r.context_message_id).filter((id): id is string => !!id))];
    if (contextMessageIds.length === 0) return null;
    const { data } = await supabaseAdmin.from("messages").select("body").in("id", contextMessageIds);
    return (data ?? []).map((m) => m.body).join("\n") || null;
  }
  const { data } = await supabaseAdmin.from("conversations").select("title").eq("id", modCase.target_id).maybeSingle();
  return data ? `Conversation: ${data.title}` : null;
}

async function gatherContext(supabaseAdmin: SupabaseClient, modCase: ModerationCaseRow): Promise<string> {
  const maxBefore = envInt("AI_MAX_CONTEXT_BEFORE", 5);
  const maxAfter = envInt("AI_MAX_CONTEXT_AFTER", 5);
  const maxHistory = envInt("AI_MAX_USER_HISTORY_MESSAGES", 15);

  let surrounding: string[] = [];
  if (modCase.target_type === "message") {
    const { data: target } = await supabaseAdmin
      .from("messages")
      .select("thread_id, created_at")
      .eq("id", modCase.target_id)
      .maybeSingle();
    if (target) {
      const [{ data: before }, { data: after }] = await Promise.all([
        supabaseAdmin
          .from("messages")
          .select("username, body")
          .eq("thread_id", target.thread_id)
          .lt("created_at", target.created_at)
          .order("created_at", { ascending: false })
          .limit(maxBefore),
        supabaseAdmin
          .from("messages")
          .select("username, body")
          .eq("thread_id", target.thread_id)
          .gt("created_at", target.created_at)
          .order("created_at", { ascending: true })
          .limit(maxAfter),
      ]);
      surrounding = [...(before ?? []).reverse(), ...(after ?? [])].map((m) => `${m.username}: ${m.body}`);
    }
  }

  let history: string[] = [];
  if (modCase.reported_user_id) {
    const { data: recent } = await supabaseAdmin
      .from("messages")
      .select("body")
      .eq("user_id", modCase.reported_user_id)
      .order("created_at", { ascending: false })
      .limit(maxHistory);
    history = (recent ?? []).map((m) => m.body);
  }

  return JSON.stringify({ surroundingMessages: surrounding, reportedUserRecentMessages: history });
}

// ---------------------------------------------------------------------------
// Contextual pass - gpt-5-mini with Structured Outputs (strict json_schema)
// so the response is always schema-conformant, no fragile parsing/retry-on-
// malformed-JSON logic needed.
// ---------------------------------------------------------------------------
const ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
    confidence: { type: "number" },
    violation_category: { type: "string" },
    recommended_action: {
      type: "string",
      enum: ["likely_no_violation", "likely_violation", "needs_human_review", "high_priority_human_review"],
    },
    priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
    requires_human_review: { type: "boolean" },
    ai_recommended_dismissal: { type: "boolean" },
    severity_based_on: { type: "string", enum: ["reported_content", "context_only"] },
    reasoning: { type: "string" },
  },
  required: [
    "severity",
    "confidence",
    "violation_category",
    "recommended_action",
    "priority",
    "requires_human_review",
    "ai_recommended_dismissal",
    "severity_based_on",
    "reasoning",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a content moderation assistant for Hereby, a location-based, temporary group-chat app. Assess the reported content independently of the reporter's stated reason - the reporter may be mistaken, exaggerating, or acting in bad faith.

You will be given two distinct things: the REPORTED CONTENT (the specific message this case is actually about), and ADDITIONAL CONTEXT (surrounding messages and the reported user's other recent messages, provided only to help you judge tone/pattern). This distinction matters a lot:

severity, confidence, violation_category, recommended_action, and priority must describe the REPORTED CONTENT ITSELF - never the context alone. If the reported content is benign on its own, it stays low severity/priority even if the additional context contains something concerning. Set severity_based_on to "reported_content" when your assessment is driven by the reported content, or "context_only" when you found something concerning ONLY in the additional context (not in the reported content) - in that case, keep the reported content's own severity/priority based on what IT actually contains, but describe the concerning content you found in reasoning in full detail (quote it, note it's a different message than the one reported) so a human can go investigate and act on that other message directly. Never let a real concern found only in context inflate the reported content's own severity, priority, or violation_category - those fields are never allowed to describe something other than what was actually reported.

Priority definitions (use exactly these, and only for the reported content itself):
- P0 (Immediate Safety): credible threats, imminent violence, child exploitation, credible self-harm concern, doxxing with immediate personal safety risk. Always requires_human_review=true.
- P1 (High): targeted harassment, hate speech, repeated intimidation, serious sexual content violations, coordinated abuse. Always requires_human_review=true.
- P2 (Normal): insults, disruptive behavior, repeated spam, lower-level harassment. Set requires_human_review based on your confidence.
- P3 (Low): likely false reports, ordinary disagreement, mild profanity, benign off-topic content.

If the additional context reveals a serious, credible safety concern (e.g. a real threat) that is NOT the reported content, still set requires_human_review=true regardless of the reported content's own severity - a human needs to see your reasoning and act on it, even though it shouldn't change this case's own severity/priority fields.

Only set ai_recommended_dismissal=true when your confidence is very high AND severity is low AND severity_based_on is "reported_content". This is a soft signal only - it never automatically closes a case on its own, a human always makes the final call unless the operator has separately enabled fully-automatic dismissal.`;

async function callContextualAnalysis(
  content: string,
  contextJson: string,
  reasons: string[]
): Promise<
  | { ok: true; data: ContextualAssessment; promptTokens: number; completionTokens: number; raw: unknown }
  | { ok: false; error: string }
> {
  const userContent = [
    `Reported content:\n${content || "(no content available - relying on context only)"}`,
    `Report reason(s) given: ${reasons.join("; ") || "(none provided)"}`,
    `Additional context (surrounding messages and the reported user's recent message history):\n${contextJson}`,
  ].join("\n\n");

  const delays = [500, 2000, 8000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "moderation_assessment", strict: true, schema: ASSESSMENT_JSON_SCHEMA },
          },
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt < delays.length) {
          await sleep(delays[attempt]);
          continue;
        }
        return { ok: false, error: `OpenAI contextual call failed after retries: ${res.status} ${await res.text().catch(() => "")}` };
      }
      if (!res.ok) {
        // 400/401/403 - a code or config bug (bad request shape, bad/
        // missing key, no billing set up), retrying won't help.
        return { ok: false, error: `OpenAI contextual call failed: ${res.status} ${await res.text().catch(() => "")}` };
      }

      const data = await res.json();
      const parsed = JSON.parse(data.choices[0].message.content) as ContextualAssessment;
      return {
        ok: true,
        data: parsed,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        raw: data,
      };
    } catch (err) {
      if (attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      return { ok: false, error: `OpenAI contextual call threw: ${String(err)}` };
    }
  }
  return { ok: false, error: "OpenAI contextual call: exhausted retries" };
}

// ---------------------------------------------------------------------------
// Usage logging
// ---------------------------------------------------------------------------
async function logUsage(
  supabaseAdmin: SupabaseClient,
  // null for the proactive scan's own free pass, logged before any case
  // exists yet - ai_moderation_usage_log.case_id is nullable for exactly
  // this reason (see its own "on delete set null" comment).
  caseId: string | null,
  callType: "moderation_check" | "contextual_analysis",
  model: string,
  promptTokens: number,
  completionTokens: number,
  costUsd: number,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  await supabaseAdmin.from("ai_moderation_usage_log").insert({
    case_id: caseId,
    call_type: callType,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    estimated_cost_usd: costUsd,
    success,
    error_message: errorMessage ?? null,
  });
}

// ---------------------------------------------------------------------------
// Core pipeline for a single case
// ---------------------------------------------------------------------------
async function analyzeCase(supabaseAdmin: SupabaseClient, caseId: string): Promise<void> {
  const { data: modCase } = await supabaseAdmin
    .from("moderation_cases")
    .select("*")
    .eq("id", caseId)
    .maybeSingle<ModerationCaseRow>();
  if (!modCase) return;

  const { data: reportRows } = await supabaseAdmin
    .from("reports")
    .select("reporter_id, reason, context_message_id, created_at")
    .eq("moderation_case_id", caseId)
    .order("created_at", { ascending: false });
  const reports = (reportRows ?? []) as ReportRow[];
  const reasons = reports.map((r) => r.reason);
  const latestReporterId = reports[0]?.reporter_id ?? null;

  const content = (await loadLiveContent(supabaseAdmin, modCase, reports)) ?? modCase.reported_content_snapshot ?? "";

  // 1. Lightweight pass - always runs, free, exempt from the circuit breaker.
  let moderation: ModerationResult;
  try {
    moderation = await callOpenAIModeration(content);
    await logUsage(supabaseAdmin, caseId, "moderation_check", "omni-moderation-latest", 0, 0, 0, true);
  } catch (err) {
    await logUsage(supabaseAdmin, caseId, "moderation_check", "omni-moderation-latest", 0, 0, 0, false, String(err));
    await supabaseAdmin
      .from("moderation_cases")
      .update({ ai_status: "analysis_failed", requires_human_review: true })
      .eq("id", caseId);
    return;
  }
  await supabaseAdmin
    .from("moderation_cases")
    .update({ ai_status: "moderation_check_complete", ai_model_moderation: "omni-moderation-latest" })
    .eq("id", caseId);

  // 2. Escalation decision
  let reportedUserRecentCaseCount = 0;
  if (modCase.reported_user_id) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { count } = await supabaseAdmin
      .from("moderation_cases")
      .select("id", { count: "exact", head: true })
      .eq("reported_user_id", modCase.reported_user_id)
      .neq("id", caseId)
      .eq("status", "open")
      .gte("created_at", thirtyDaysAgo);
    reportedUserRecentCaseCount = count ?? 0;
  }

  const shouldEscalate = decideEscalation({
    moderation,
    reasons,
    reportCount: modCase.report_count,
    reportedUserRecentCaseCount,
    contentLength: content.length,
    confidenceThreshold: envFloat("AI_CONTEXT_CONFIDENCE_THRESHOLD", 0.75),
  });

  const isSafetyCritical =
    moderation.flaggedCategories.some((c) => SAFETY_CRITICAL_MODERATION_CATEGORIES.includes(c)) ||
    reasons.some((r) => HIGH_RISK_REASON_KEYWORDS.some((k) => r.toLowerCase().includes(k)));

  if (!shouldEscalate || Deno.env.get("AI_CONTEXT_ANALYSIS_ENABLED") !== "true") {
    const { severity, priority } = deriveFromLightweight(moderation);
    await supabaseAdmin
      .from("moderation_cases")
      .update({
        severity,
        priority,
        violation_category: moderation.topCategory,
        ai_status: "analysis_complete",
        ai_analyzed_at: new Date().toISOString(),
        requires_human_review: severity === "critical" || severity === "high",
      })
      .eq("id", caseId);
    return;
  }

  // 3. Circuit breaker - safety-critical content always gets the full
  // contextual pass regardless of budget tier; everything else throttles.
  const [budgetTier, underCaps] = await Promise.all([
    computeBudgetTier(supabaseAdmin),
    underRateCaps(supabaseAdmin, latestReporterId),
  ]);
  const budgetBlocked = (budgetTier === "hard" || !underCaps) && !isSafetyCritical;
  const budgetThrottled = budgetTier === "high" && !isSafetyCritical;

  if (budgetBlocked) {
    await supabaseAdmin
      .from("moderation_cases")
      .update({ ai_status: "deferred_budget_limit", requires_human_review: true })
      .eq("id", caseId);
    return;
  }
  if (budgetThrottled) {
    const { severity, priority } = deriveFromLightweight(moderation);
    await supabaseAdmin
      .from("moderation_cases")
      .update({
        severity,
        priority,
        violation_category: moderation.topCategory,
        ai_status: "analysis_complete",
        ai_analyzed_at: new Date().toISOString(),
        requires_human_review: true, // flagged for a human specifically because contextual analysis was skipped, not because AI judged it that way
      })
      .eq("id", caseId);
    return;
  }

  // 4. Contextual pass
  await supabaseAdmin.from("moderation_cases").update({ ai_status: "context_analysis_pending" }).eq("id", caseId);
  const contextJson = await gatherContext(supabaseAdmin, modCase);
  const assessment = await callContextualAnalysis(content, contextJson, reasons);

  if (!assessment.ok) {
    await logUsage(supabaseAdmin, caseId, "contextual_analysis", "gpt-5-mini", 0, 0, 0, false, assessment.error);
    await supabaseAdmin
      .from("moderation_cases")
      .update({ ai_status: "analysis_failed", requires_human_review: true })
      .eq("id", caseId);
    return;
  }

  const costUsd =
    (assessment.promptTokens / 1_000_000) * GPT5_MINI_INPUT_COST_PER_1M +
    (assessment.completionTokens / 1_000_000) * GPT5_MINI_OUTPUT_COST_PER_1M;
  await logUsage(
    supabaseAdmin,
    caseId,
    "contextual_analysis",
    "gpt-5-mini",
    assessment.promptTokens,
    assessment.completionTokens,
    costUsd,
    true
  );

  await supabaseAdmin
    .from("moderation_cases")
    .update({
      severity: assessment.data.severity,
      confidence: assessment.data.confidence,
      violation_category: assessment.data.violation_category,
      recommended_action: assessment.data.recommended_action,
      priority: assessment.data.priority,
      requires_human_review: assessment.data.requires_human_review,
      ai_recommended_dismissal: assessment.data.ai_recommended_dismissal,
      severity_based_on: assessment.data.severity_based_on,
      reasoning: assessment.data.reasoning,
      ai_status: "analysis_complete",
      ai_model_contextual: "gpt-5-mini",
      ai_raw_response: assessment.raw,
      ai_analyzed_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  // 5. Auto-delete path - gated off by default. Deliberately does NOT
  // auto-resolve the case (unlike auto-dismiss below) - content comes down
  // immediately as a fast protective action, but a human still makes the
  // account-level call (suspend/ban/report to authorities), which is why
  // requires_human_review is forced true here regardless of what the model
  // itself set. Message-only: there's no equivalent "delete" action for a
  // user or conversation report. Confidence bar is tiered by severity - a
  // lower bar for likely-dangerous categories (P0/P1) than lower-stakes
  // ones (P2/P3) - acting fast on likely danger costs little if wrong (one
  // message hidden pending review), where acting on a lower-stakes
  // miscategorization erodes trust more than the harm avoided, so it needs
  // to be more certain first.
  //
  // Two independent safety gates, confirmed live as both necessary: a
  // benign message ("I love strawberries!") got assessed as a critical
  // threat and would have been wrongly auto-deleted, because a genuine
  // death threat turned up in the SAME user's OTHER, unrelated messages
  // (fed in as background context) and drove the severity of a case that
  // was never actually about it. severity_based_on === "reported_content"
  // is the model's own explicit signal that its assessment is actually
  // about the reported content, not something it found in context - but
  // that alone still depends on the model following the prompt correctly,
  // so moderation.flagged (the free moderation-endpoint pass, run on the
  // reported content alone, with zero context blended in) is required too
  // - an independent check that doesn't depend on the contextual model at
  // all. Both must agree before anything gets auto-deleted.
  if (
    modCase.target_type === "message" &&
    Deno.env.get("AI_AUTO_UPHOLD_DELETE_ENABLED") === "true" &&
    assessment.data.severity_based_on === "reported_content" &&
    moderation.flagged &&
    (assessment.data.recommended_action === "likely_violation" ||
      assessment.data.recommended_action === "high_priority_human_review")
  ) {
    const isHighRiskTier = assessment.data.priority === "P0" || assessment.data.priority === "P1";
    const threshold = isHighRiskTier
      ? envFloat("AI_AUTO_DELETE_HIGH_RISK_CONFIDENCE_THRESHOLD", 0.75)
      : envFloat("AI_AUTO_DELETE_LOW_RISK_CONFIDENCE_THRESHOLD", 0.9);

    if (assessment.data.confidence >= threshold) {
      await supabaseAdmin.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", modCase.target_id);
      await supabaseAdmin.from("moderation_actions").insert({
        moderator_id: null,
        is_ai_action: true,
        target_type: "message",
        target_id: modCase.target_id,
        action: "delete_message",
        reason: `Auto-removed by AI (confidence ${assessment.data.confidence}, priority ${assessment.data.priority}, category ${assessment.data.violation_category}): ${assessment.data.reasoning}`,
      });
      await supabaseAdmin
        .from("moderation_cases")
        .update({ content_auto_removed: true, requires_human_review: true })
        .eq("id", caseId);
    }
  }

  // 6. Auto-dismiss path - built now per the spec, but gated off by
  // default. Never called for anything the model itself flagged as
  // needing human review, regardless of the flag. Mutually exclusive with
  // auto-delete above by construction (a coherent assessment wouldn't set
  // both ai_recommended_dismissal and recommended_action=likely_violation),
  // not enforced with an explicit guard.
  if (
    assessment.data.ai_recommended_dismissal &&
    !assessment.data.requires_human_review &&
    Deno.env.get("AI_AUTO_DISMISS_LOW_RISK") === "true"
  ) {
    const notes = "Auto-dismissed by AI (AI_AUTO_DISMISS_LOW_RISK enabled) - high confidence, low severity.";
    await supabaseAdmin
      .from("moderation_cases")
      .update({ status: "dismissed", resolved_at: new Date().toISOString(), resolution_notes: notes })
      .eq("id", caseId);
    await supabaseAdmin.from("reports").update({ status: "dismissed", resolution_notes: notes }).eq("moderation_case_id", caseId);
  }
}

// ---------------------------------------------------------------------------
// Proactive scan: fired by trg_scan_new_message on every message send, no
// report involved. No case exists yet at this point - the whole point of
// running the free classifier + PII check first is to decide whether one
// should. The overwhelming majority of messages hit neither signal and
// this returns having spent nothing beyond the one free API call.
// Escalation here only looks at content-only signals (no report reasons/
// count exist yet) - the same short-and-ambiguous heuristic decideEscalation
// already uses for reports, applied directly since there's no report to
// derive it from.
// ---------------------------------------------------------------------------
async function scanNewMessage(supabaseAdmin: SupabaseClient, messageId: string): Promise<void> {
  const { data: message } = await supabaseAdmin.from("messages").select("user_id, username, body").eq("id", messageId).maybeSingle();
  if (!message) return;
  const content = `${message.username}: ${message.body}`;

  let moderation: ModerationResult;
  try {
    moderation = await callOpenAIModeration(content);
    await logUsage(supabaseAdmin, null, "moderation_check", "omni-moderation-latest", 0, 0, 0, true);
  } catch (err) {
    await logUsage(supabaseAdmin, null, "moderation_check", "omni-moderation-latest", 0, 0, 0, false, String(err));
    return; // Degraded, not lost - the message itself was never at risk, only its proactive scan.
  }

  const pii = detectPII(content);
  const shortAndAmbiguous = message.body.length > 0 && message.body.length < 20 && moderation.topScore > 0.1;

  if (!moderation.flagged && !pii.matched && !shortAndAmbiguous) return; // clean - no case created, nothing further spent

  const { data: found } = await supabaseAdmin.rpc("find_or_create_moderation_case_for_scan", {
    p_target_type: "message",
    p_target_id: messageId,
  });
  const row = Array.isArray(found) ? found[0] : found;
  if (!row?.case_id) return;
  await analyzeCase(supabaseAdmin, row.case_id);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
interface RequestBody {
  caseId?: string;
  sweep?: boolean;
  messageId?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.replace(/^Bearer /, "");
  // Trusted server-to-server call (the trigger, or the deferred-budget
  // sweep cron job), both forwarding the same Vault-stored service-role
  // key notify_new_message already uses - same trust model as that
  // function's own "caller is the trusted Postgres trigger" precedent.
  const isInternalCall = !!bearerToken && bearerToken === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (!isInternalCall) {
    // Dashboard-invoked "Re-run AI Analysis" - same two-client + role-check
    // pattern as moderationAction. supabaseAdmin above is already the
    // genuine service-role client for writes; this one just resolves who's
    // calling.
    if (!authHeader) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    const supabaseCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: authUser },
    } = await supabaseCaller.auth.getUser();
    if (!authUser) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    const { data: moderator } = await supabaseCaller.from("users").select("id, role").eq("auth_id", authUser.id).single();
    if (!moderator || moderator.role !== "moderator") return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  if (Deno.env.get("AI_MODERATION_ENABLED") !== "true") {
    return new Response(JSON.stringify({ skipped: "ai_moderation_disabled" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => ({}))) as RequestBody;

  if (body.messageId) {
    // Separate, more specific flag than AI_MODERATION_ENABLED above (which
    // is still the master kill switch - this mode never runs if that's
    // off either) - lets proactive scanning be turned on deliberately once
    // ready, and off independently (e.g. if volume or false-positive rate
    // turns out to be a problem) without touching the already-live
    // report-driven path.
    if (Deno.env.get("AI_PROACTIVE_SCAN_ENABLED") !== "true") {
      return new Response(JSON.stringify({ skipped: "proactive_scan_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await scanNewMessage(supabaseAdmin, body.messageId);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (body.sweep) {
    const { data: deferred } = await supabaseAdmin.from("moderation_cases").select("id").eq("ai_status", "deferred_budget_limit");
    for (const row of deferred ?? []) {
      await analyzeCase(supabaseAdmin, row.id);
    }
    return new Response(JSON.stringify({ swept: deferred?.length ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.caseId) return new Response("Missing caseId", { status: 400, headers: corsHeaders });
  await analyzeCase(supabaseAdmin, body.caseId);
  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

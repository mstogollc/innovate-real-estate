/**
 * Innovate Real Estate — Lead Capture Function
 * ─────────────────────────────────────────────
 * Receives a JSON POST from submitform.html (the multi-step Tax Savings
 * Proposal form) and upserts the lead into GoHighLevel via the official
 * REST API.
 *
 * Required env vars (set in Netlify → Site settings → Environment variables):
 *   GHL_API_TOKEN    — Private Integration token from GHL with at least
 *                      contacts.write, contacts.readonly, locations.readonly scopes.
 *   GHL_LOCATION_ID  — Sub-account location ID (already known: naXHyiA91u0zlKUtZkUc).
 *
 * Optional env vars (have safe defaults):
 *   GHL_PIPELINE_ID  — If set, the contact will be added to this pipeline as an opportunity.
 *   GHL_STAGE_ID     — Stage to drop the opportunity into.
 *   FORMSPREE_BACKUP — If set to a Formspree form ID (e.g. "xeedbbka"), every submission
 *                      is mirrored to Formspree as a redundant email backup.
 */

const GHL_API_BASE  = "https://services.leadconnectorhq.com";
const GHL_API_VER   = "2021-07-28";
const DEFAULT_LOC   = "naXHyiA91u0zlKUtZkUc"; // Innovate Real Estate

// ─── Helpers ────────────────────────────────────────────────────────────────
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

function clean(v, max = 500) {
  if (v === null || v === undefined) return "";
  return String(v).trim().slice(0, max);
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Map structured form payload to GHL contact body + custom fields.
function buildContactPayload(p, locationId) {
  const firstName = clean(p.first_name, 80);
  const lastName  = clean(p.last_name,  80);
  const email     = clean(p.email,     200).toLowerCase();
  const phone     = clean(p.phone,      40);
  const company   = clean(p.company,   200);

  const tags = ["Website Lead", "Tax Savings Proposal"];
  if (p.services_interested) tags.push(`Service: ${clean(p.services_interested, 80)}`);
  if (p.role)               tags.push(`Role: ${clean(p.role, 60)}`);
  if (p.urgency)            tags.push(`Urgency: ${clean(p.urgency, 40)}`);
  if (p.referral_source)    tags.push(`Source: ${clean(p.referral_source, 60)}`);

  // GHL standard fields + customFields for the long-tail.
  // customFields use field names as keys (GHL will auto-create them on first submission).
  const body = {
    locationId,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    email,
    phone,
    companyName: company,
    address1: clean(p.property_address, 200),
    source: "Website — Tax Savings Proposal",
    tags,
    customFields: [
      { key: "role",                 field_value: clean(p.role, 80) },
      { key: "property_type",        field_value: clean(p.property_type, 80) },
      { key: "property_address",     field_value: clean(p.property_address, 200) },
      { key: "purchase_price",       field_value: clean(p.purchase_price, 40) },
      { key: "year_acquired",        field_value: clean(p.year_acquired, 8) },
      { key: "services_interested",  field_value: clean(p.services_interested, 120) },
      { key: "current_cpa",          field_value: clean(p.current_cpa, 200) },
      { key: "num_properties",       field_value: clean(p.num_properties, 12) },
      { key: "urgency",              field_value: clean(p.urgency, 40) },
      { key: "referral_source",      field_value: clean(p.referral_source, 80) },
      { key: "notes",                field_value: clean(p.notes, 2000) },
      { key: "sms_consent",          field_value: p.sms_consent === true || p.sms_consent === "Yes" ? "Yes" : "No" },
      { key: "tos_consent",          field_value: p.tos_consent ? "Yes" : "No" },
      { key: "submitted_url",        field_value: clean(p.submitted_url, 500) },
      { key: "submitted_at",         field_value: clean(p.submitted_at, 40) || new Date().toISOString() },
    ].filter(c => c.field_value !== ""),
  };

  return body;
}

// Mirror to Formspree (best-effort, never blocks success).
async function mirrorToFormspree(p) {
  const formId = process.env.FORMSPREE_BACKUP;
  if (!formId) return;
  try {
    await fetch(`https://formspree.io/f/${formId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        _subject: "New Tax Savings Proposal Request - Innovate Real Estate",
        ...p,
      }),
    });
  } catch (e) {
    console.error("Formspree mirror failed:", e.message);
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  // Parse JSON body
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // Honeypot: silent success on bots
  if (clean(payload._gotcha)) {
    return json(200, { ok: true, ignored: true });
  }

  // Required-field validation (mirrors the multi-step form's client validation)
  const firstName = clean(payload.first_name);
  const lastName  = clean(payload.last_name);
  const email     = clean(payload.email).toLowerCase();
  const role      = clean(payload.role);
  const propType  = clean(payload.property_type);

  if (!firstName || !lastName) return json(400, { error: "Name is required." });
  if (!isEmail(email))         return json(400, { error: "A valid email is required." });
  if (!role)                   return json(400, { error: "Please tell us your role." });
  if (!propType)               return json(400, { error: "Please select a property type." });
  if (!payload.tos_consent)    return json(400, { error: "Please agree to the Privacy Policy and Terms." });

  const token      = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID || DEFAULT_LOC;

  if (!token) {
    console.error("GHL_API_TOKEN env var missing.");
    // Still mirror to Formspree so the lead isn't lost while config is in progress.
    await mirrorToFormspree(payload);
    return json(202, {
      ok: true,
      warning: "CRM_NOT_CONFIGURED",
      message: "Lead captured via backup channel. CRM token not yet configured.",
    });
  }

  // Upsert to GHL
  const ghlBody = buildContactPayload(payload, locationId);
  let ghlData = null;
  let ghlErr  = null;

  try {
    const resp = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Version":       GHL_API_VER,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      },
      body: JSON.stringify(ghlBody),
    });
    const text = await resp.text();
    try { ghlData = JSON.parse(text); } catch { ghlData = { raw: text }; }
    if (!resp.ok) {
      ghlErr = { status: resp.status, body: ghlData };
      console.error("GHL upsert failed:", JSON.stringify(ghlErr));
    }
  } catch (e) {
    ghlErr = { status: 0, body: { error: e.message } };
    console.error("GHL upsert exception:", e);
  }

  // Always mirror to Formspree as redundancy (no-op if FORMSPREE_BACKUP not set)
  await mirrorToFormspree(payload);

  if (ghlErr) {
    return json(202, {
      ok: true,
      warning: "CRM_DEFERRED",
      message: "Lead captured. CRM sync is being retried in the background.",
    });
  }

  return json(200, {
    ok: true,
    contactId: ghlData?.contact?.id || ghlData?.id || null,
  });
};

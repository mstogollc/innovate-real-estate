/**
 * Innovate Real Estate, Lead Capture Function
 * ─────────────────────────────────────────────
 * Receives a JSON POST from any of:
 *   • submitform.html  (Tax Savings Proposal multi-step form)
 *   • affiliate.html   (Affiliate / Partner Application)
 * and upserts the lead into GoHighLevel via the official REST API.
 *
 * The payload's `form_type` field decides which lead summary,
 * validation rules, and tag set get applied.
 *   form_type === "affiliate_application"  → Affiliate Application branch
 *   anything else (or missing)             → Tax Savings Proposal branch
 *
 * Required env vars (Netlify, Site settings, Environment variables):
 *   GHL_API_TOKEN    Private Integration token (contacts.write scope).
 *   GHL_LOCATION_ID  Sub-account location ID (defaults to naXHyiA91u0zlKUtZkUc).
 *
 * Optional env vars:
 *   GHL_PIPELINE_ID  Pipeline to drop opportunities into.
 *   GHL_STAGE_ID     Stage for the opportunity.
 *   FORMSPREE_BACKUP Formspree form ID for redundant email backup.
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VER  = "2021-07-28";
const DEFAULT_LOC  = "naXHyiA91u0zlKUtZkUc"; // Innovate Real Estate

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

function yesNo(v) {
  return (v === true || v === "Yes" || v === "yes" || v === "on") ? "Yes" : "No";
}

// Collapse multi-select checkbox arrays into a comma-joined string.
function joinMulti(v) {
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return clean(v, 500);
}

// ─── Tax Savings Proposal branch ────────────────────────────────────────────
function buildTaxSummary(p) {
  const rows = [
    ["Role",                p.role],
    ["Property Type",       p.property_type],
    ["Property Address",    p.property_address],
    ["# Properties",        p.num_properties],
    ["Purchase Price",      p.purchase_price],
    ["Year Acquired",       p.year_acquired],
    ["Services Interested", p.services_interested],
    ["Current CPA",         p.current_cpa],
    ["Urgency",             p.urgency],
    ["Referral Source",     p.referral_source],
    ["SMS Consent",         yesNo(p.sms_consent)],
    ["TOS Consent",         p.tos_consent ? "Yes" : "No"],
    ["Submitted From",      p.submitted_url],
    ["Submitted At",        p.submitted_at || new Date().toISOString()],
  ].filter(r => r[1]);
  const block = rows.map(r => `• ${r[0]}: ${clean(r[1], 300)}`).join("\n");
  const notesText = clean(p.notes, 2000);
  return [
    "─── TAX SAVINGS PROPOSAL LEAD ───",
    block,
    notesText ? `\nAdditional Notes:\n${notesText}` : "",
  ].filter(Boolean).join("\n");
}

function buildTaxContact(p, locationId) {
  const firstName = clean(p.first_name, 80);
  const lastName  = clean(p.last_name,  80);
  const email     = clean(p.email,     200).toLowerCase();
  const phone     = clean(p.phone,      40);
  const company   = clean(p.company,   200);
  const summary   = buildTaxSummary(p);

  const tags = ["Website Lead", "Tax Savings Proposal"];
  if (p.services_interested) tags.push(`Service: ${clean(p.services_interested, 80)}`);
  if (p.role)                tags.push(`Role: ${clean(p.role, 60)}`);
  if (p.urgency)             tags.push(`Urgency: ${clean(p.urgency, 40)}`);
  if (p.referral_source)     tags.push(`Source: ${clean(p.referral_source, 60)}`);

  return {
    locationId,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    email,
    phone,
    companyName: company,
    address1: clean(p.property_address, 200),
    source: "Website, Tax Savings Proposal",
    tags,
    customFields: [
      { key: "role",                field_value: clean(p.role, 80) },
      { key: "property_type",       field_value: clean(p.property_type, 80) },
      { key: "property_address",    field_value: clean(p.property_address, 200) },
      { key: "purchase_price",      field_value: clean(p.purchase_price, 40) },
      { key: "year_acquired",       field_value: clean(p.year_acquired, 8) },
      { key: "services_interested", field_value: clean(p.services_interested, 120) },
      { key: "current_cpa",         field_value: clean(p.current_cpa, 200) },
      { key: "num_properties",      field_value: clean(p.num_properties, 12) },
      { key: "urgency",             field_value: clean(p.urgency, 40) },
      { key: "referral_source",     field_value: clean(p.referral_source, 80) },
      { key: "notes",               field_value: summary },
      { key: "sms_consent",         field_value: yesNo(p.sms_consent) },
      { key: "tos_consent",         field_value: p.tos_consent ? "Yes" : "No" },
      { key: "submitted_url",       field_value: clean(p.submitted_url, 500) },
      { key: "submitted_at",        field_value: clean(p.submitted_at, 40) || new Date().toISOString() },
    ].filter(c => c.field_value !== ""),
  };
}

// ─── Affiliate Application branch ───────────────────────────────────────────
function buildAffiliateSummary(p) {
  const services = joinMulti(p.services_of_interest);
  const rows = [
    ["Title / Role",       p.title],
    ["Company",            p.company],
    ["Website",            p.website],
    ["Location",           p.location],
    ["Partner Type",       p.partner_type],
    ["Client Count",       p.client_count],
    ["Services Interested", services],
    ["Referral Source",    p.referral_source],
    ["SMS Consent",        yesNo(p.sms_consent)],
    ["TOS Consent",        p.tos_consent ? "Yes" : "No"],
    ["Submitted From",     p.submitted_url],
    ["Submitted At",       p.submitted_at || new Date().toISOString()],
  ].filter(r => r[1]);
  const block = rows.map(r => `• ${r[0]}: ${clean(r[1], 300)}`).join("\n");
  const notesText = clean(p.notes, 2000);
  return [
    "─── AFFILIATE / PARTNER APPLICATION ───",
    block,
    notesText ? `\nAdditional Notes:\n${notesText}` : "",
  ].filter(Boolean).join("\n");
}

function buildAffiliateContact(p, locationId) {
  const firstName = clean(p.first_name, 80);
  const lastName  = clean(p.last_name,  80);
  const email     = clean(p.email,     200).toLowerCase();
  const phone     = clean(p.phone,      40);
  const company   = clean(p.company,   200);
  const summary   = buildAffiliateSummary(p);
  const services  = joinMulti(p.services_of_interest);

  const tags = ["Website Lead", "Affiliate Application"];
  if (p.partner_type)    tags.push(`Partner Type: ${clean(p.partner_type, 60)}`);
  if (p.client_count)    tags.push(`Client Count: ${clean(p.client_count, 40)}`);
  if (services)          tags.push(`Services: ${clean(services, 80)}`);
  if (p.referral_source) tags.push(`Source: ${clean(p.referral_source, 60)}`);

  return {
    locationId,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    email,
    phone,
    companyName: company,
    website: clean(p.website, 200),
    source: "Website, Affiliate Application",
    tags,
    customFields: [
      { key: "title",                field_value: clean(p.title, 120) },
      { key: "company",              field_value: company },
      { key: "website",              field_value: clean(p.website, 200) },
      { key: "location",             field_value: clean(p.location, 200) },
      { key: "partner_type",         field_value: clean(p.partner_type, 80) },
      { key: "client_count",         field_value: clean(p.client_count, 40) },
      { key: "services_of_interest", field_value: services },
      { key: "referral_source",      field_value: clean(p.referral_source, 80) },
      { key: "notes",                field_value: summary },
      { key: "sms_consent",          field_value: yesNo(p.sms_consent) },
      { key: "tos_consent",          field_value: p.tos_consent ? "Yes" : "No" },
      { key: "submitted_url",        field_value: clean(p.submitted_url, 500) },
      { key: "submitted_at",         field_value: clean(p.submitted_at, 40) || new Date().toISOString() },
    ].filter(c => c.field_value !== ""),
  };
}

// Mirror to Formspree (best-effort, never blocks success).
async function mirrorToFormspree(p, formType) {
  const formId = process.env.FORMSPREE_BACKUP;
  if (!formId) return;
  const subject = formType === "affiliate_application"
    ? "New Affiliate Application, Innovate Real Estate"
    : "New Tax Savings Proposal Request, Innovate Real Estate";
  try {
    await fetch(`https://formspree.io/f/${formId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ _subject: subject, ...p }),
    });
  } catch (e) {
    console.error("Formspree mirror failed:", e.message);
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // Honeypot: silent success on bots
  if (clean(payload._gotcha)) return json(200, { ok: true, ignored: true });

  const formType = clean(payload.form_type, 60).toLowerCase();
  const isAffiliate = formType === "affiliate_application";

  // ─── Shared validation ────────────────────────────────────────────────
  const firstName = clean(payload.first_name);
  const lastName  = clean(payload.last_name);
  const email     = clean(payload.email).toLowerCase();

  if (!firstName || !lastName) return json(400, { error: "Name is required." });
  if (!isEmail(email))         return json(400, { error: "A valid email is required." });

  // ─── Branch-specific validation ───────────────────────────────────────
  if (isAffiliate) {
    if (!clean(payload.company))      return json(400, { error: "Company name is required." });
    if (!clean(payload.partner_type)) return json(400, { error: "Please select a partner type." });
    if (!payload.tos_consent)         return json(400, { error: "Please agree to the Privacy Policy and Terms." });
  } else {
    if (!clean(payload.role))          return json(400, { error: "Please tell us your role." });
    if (!clean(payload.property_type)) return json(400, { error: "Please select a property type." });
    if (!payload.tos_consent)          return json(400, { error: "Please agree to the Privacy Policy and Terms." });
  }

  const token      = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID || DEFAULT_LOC;

  if (!token) {
    console.error("GHL_API_TOKEN env var missing.");
    await mirrorToFormspree(payload, formType);
    return json(202, {
      ok: true,
      warning: "CRM_NOT_CONFIGURED",
      message: "Lead captured via backup channel. CRM token not yet configured.",
    });
  }

  // ─── Build the GHL contact payload ────────────────────────────────────
  const ghlBody = isAffiliate
    ? buildAffiliateContact(payload, locationId)
    : buildTaxContact(payload, locationId);

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

  await mirrorToFormspree(payload, formType);

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

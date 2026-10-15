import * as SecureStore from "expo-secure-store";
import { getFileText, pushFile } from "./github";
import { runSql } from "./supabase";
import { generateApp } from "./generate2";
import { REPO } from "./config";

export type LinkKind = "supabase" | "firebase";

function explain(label: string, status: number, body: string): string {
  const b = body.toLowerCase();
  if (b.includes("credit balance")) return `${label}: الرصيد خلص`;
  if (status === 401 || status === 403 || b.includes("api key not valid")) return `${label}: المفتاح غير صالح`;
  if (status === 429) return `${label}: وصلت حد الاستخدام`;
  if (status === 503 || status === 529) return `${label}: الخدمة مزدحمة`;
  return `${label} ${status}: ${body.slice(0, 160)}`;
}

async function ask(system: string, prompt: string): Promise<string> {
  const claude = await SecureStore.getItemAsync("CLAUDE_API_KEY");
  const gemini = await SecureStore.getItemAsync("GEMINI_API_KEY");
  const errors: string[] = [];

  if (claude) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": claude, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-5-5",
          max_tokens: 6000,
          system,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(explain("Claude", res.status, text));
      const d = JSON.parse(text);
      return (d.content || []).map((c: any) => c.text || "").join("");
    } catch (e: any) {
      errors.push(String(e?.message || e));
    }
  } else {
    errors.push("Claude: المفتاح غير محفوظ");
  }

  if (gemini) {
    try {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": gemini },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          }),
        }
      );
      const text = await res.text();
      if (!res.ok) throw new Error(explain("Gemini", res.status, text));
      const d = JSON.parse(text);
      return (d?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
    } catch (e: any) {
      errors.push(String(e?.message || e));
    }
  } else {
    errors.push("Gemini: المفتاح غير محفوظ");
  }

  throw new Error(errors.join("\n"));
}

async function loadApp(name: string): Promise<string> {
  const html = await getFileText(REPO, `apps/${name}/index.html`);
  if (!html) throw new Error(`التطبيق "${name}" مش موجود. اعمل له إنشاء أول.`);
  return html;
}

async function save(name: string, html: string, msg: string) {
  await pushFile(REPO, `apps/${name}/index.html`, html, msg);
}

function extractSql(text: string): string {
  const m = text.match(/```sql\s*([\s\S]*?)```/i);
  const sql = (m ? m[1] : text).trim();
  if (!sql) throw new Error("الذكاء الاصطناعي ما رجّع SQL.");
  if (/drop\s+(table|schema|database)|truncate/i.test(sql)) {
    throw new Error("الـ SQL فيه أمر حذف خطير، اترفض. جرّب تاني.");
  }
  return sql;
}

async function getAnonKey(token: string, ref: string): Promise<string> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Supabase api-keys (${res.status}): ${await res.text()}`);
  const keys = (await res.json()) || [];
  const k = keys.find((x: any) => x.name === "anon") || keys.find((x: any) => x.type === "publishable");
  if (!k || !k.api_key) throw new Error("ما لقيت المفتاح العام (anon) للمشروع.");
  return k.api_key;
}

export function parseFirebaseConfig(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /["']?([A-Za-z]+)["']?\s*:\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out[m[1]] = m[2];
  return out;
}

const SQL_SYSTEM =
  "You are a Postgres and Supabase expert. Two web apps share ONE Supabase database. " +
  "Design the tables both apps need. Rules: use `create table if not exists`; never drop tables or delete data; " +
  "enable row level security on every table; before each policy write `drop policy if exists ...;` then `create policy ...;`. " +
  "The apps use the public anon key, so be conservative: allow only the operations each app really needs. " +
  "Return ONLY the SQL inside one ```sql code block, no explanations.";

const CONTRACT_SYSTEM =
  "You design the shared Firestore data model for two web apps. Output a short plain-text contract: " +
  "collection names, each field with its type, and which app reads or writes what. Max 40 lines. No code.";

async function linkSupabase(name1: string, name2: string, onStatus: (s: string) => void) {
  const token = await SecureStore.getItemAsync("SUPABASE_ACCESS_TOKEN");
  const ref = await SecureStore.getItemAsync("SUPABASE_PROJECT_REF");
  if (!token || !ref) throw new Error("ادخل توكن Supabase والـ Project Ref في تبويب المفاتيح أول.");

  onStatus("⏳ بيقرأ التطبيقين...");
  const html1 = await loadApp(name1);
  const html2 = await loadApp(name2);

  onStatus("⏳ بيجيب المفتاح العام لمشروع Supabase...");
  const anon = await getAnonKey(token, ref);
  const url = `https://${ref}.supabase.co`;

  onStatus("⏳ الذكاء الاصطناعي بيصمّم الجداول المشتركة...");
  const sqlText = await ask(
    SQL_SYSTEM,
    `App 1 (${name1}):\n${html1}\n\nApp 2 (${name2}):\n${html2}`
  );
  const sql = extractSql(sqlText);

  onStatus("⏳ بيتنفّذ SQL في Supabase...");
  await runSql(sql);
  onStatus("✅ اتنفّذ SQL.");

  const make = (me: string, other: string) =>
    `Connect this app to a shared Supabase database. Load supabase-js with ` +
    `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script> ` +
    `and create the client with URL "${url}" and anon key "${anon}". ` +
    `The tables already exist and were created with this SQL, so use exactly these table and column names:\n${sql}\n` +
    `This app is "${me}"; the other app is "${other}" and uses the same tables. ` +
    `Replace any mock or local data with real reads and writes to these tables. ` +
    `Keep the existing UI and Arabic RTL. Show a readable error message if a request fails.`;

  const r1 = await generateApp(make(name1, name2), html1, onStatus);
  await save(name1, r1.html, `Link Supabase: ${name1}`);
  const r2 = await generateApp(make(name2, name1), html2, onStatus);
  await save(name2, r2.html, `Link Supabase: ${name2}`);
}

async function linkFirebase(name1: string, name2: string, onStatus: (s: string) => void) {
  const cfgText = await SecureStore.getItemAsync("FIREBASE_CONFIG");
  if (!cfgText) throw new Error("ادخل إعدادات Firebase في تبويب المفاتيح أول.");
  const cfg = parseFirebaseConfig(cfgText);
  if (!cfg.apiKey || !cfg.projectId) throw new Error("إعدادات Firebase ناقصة (لازم apiKey و projectId).");

  onStatus("⏳ بيقرأ التطبيقين...");
  const html1 = await loadApp(name1);
  const html2 = await loadApp(name2);

  onStatus("⏳ الذكاء الاصطناعي بيصمّم بيانات Firestore المشتركة...");
  const contract = await ask(
    CONTRACT_SYSTEM,
    `App 1 (${name1}):\n${html1}\n\nApp 2 (${name2}):\n${html2}`
  );

  const make = (me: string, other: string) =>
    `Connect this app to a shared Firebase Firestore database. Load the Firebase JS SDK (compat build) with ` +
    `<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script> and ` +
    `<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>. ` +
    `Initialize with this config: ${JSON.stringify(cfg)}. ` +
    `Follow EXACTLY this data contract (collection and field names):\n${contract}\n` +
    `This app is "${me}"; the other app is "${other}" and uses the same collections. ` +
    `Replace any mock or local data with Firestore reads and writes (use onSnapshot for live updates). ` +
    `Keep the existing UI and Arabic RTL. Show a readable error message if a read or write fails.`;

  const r1 = await generateApp(make(name1, name2), html1, onStatus);
  await save(name1, r1.html, `Link Firebase: ${name1}`);
  const r2 = await generateApp(make(name2, name1), html2, onStatus);
  await save(name2, r2.html, `Link Firebase: ${name2}`);
}

export async function linkApps(
  kind: LinkKind,
  name1: string,
  name2: string,
  onStatus: (s: string) => void
) {
  if (!name1 || !name2) throw new Error("اكتب اسم التطبيقين أول.");
  if (name1 === name2) throw new Error("لازم يكون اسم التطبيقين مختلف.");
  if (kind === "supabase") return linkSupabase(name1, name2, onStatus);
  return linkFirebase(name1, name2, onStatus);
    }

import React, { useState } from "react";
import {
  View, TextInput, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Modal,
} from "react-native";
import { WebView } from "react-native-webview";
import { pushFile, getFileText } from "../services/github";
import { generateApp } from "../services/generate2";
import { linkApps, LinkKind } from "../services/link";
import { REPO } from "../services/config";

function cleanName(n: string) {
  return n.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

type Kind = "create" | "edit";

type BoxProps = {
  title: string;
  name: string;
  setName: (s: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onPreview: (name: string) => void;
};

function AppBox({ title, name, setName, busy, setBusy, onPreview }: BoxProps) {
  const [description, setDescription] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const [loading, setLoading] = useState<Kind | null>(null);
  const [log, setLog] = useState<string[]>([]);

  function addLog(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function run(kind: Kind) {
    if (busy) return;
    const n = cleanName(name);
    const text = (kind === "create" ? description : editText).trim();
    if (!n) {
      setLog(["❌ اكتب اسم التطبيق بالإنجليزي (حروف وأرقام بدون مسافات)."]);
      return;
    }
    if (!text) {
      setLog([kind === "create" ? "❌ اكتب الوصف." : "❌ اكتب وصف التعديل."]);
      return;
    }

    setLog([]);
    setBusy(true);
    setLoading(kind);
    try {
      const existing = await getFileText(REPO, `apps/${n}/index.html`);
      if (kind === "edit" && !existing) {
        addLog("❌ التطبيق ده مش موجود. اعمل إنشاء الأول.");
        return;
      }
      if (kind === "create" && existing) {
        addLog("❌ الاسم ده موجود. استخدم اسم جديد، أو زر تعديل الكود.");
        return;
      }

      const result = await generateApp(text, kind === "edit" ? existing : null, addLog);

      addLog("⏳ بيترفع على GitHub...");
      await pushFile(
        REPO,
        `apps/${n}/index.html`,
        result.html,
        `${kind === "edit" ? "Edit" : "Create"}: ${n}`
      );
      addLog(`✅ ${kind === "edit" ? "اتعدّل" : "اتولّد"} بواسطة ${result.provider} وارتفع: apps/${n}/index.html`);
      addLog("🎉 اضغط معاينة تشوفه.");
      if (kind === "edit") setEditText("");
    } catch (e: any) {
      addLog(`❌ ${e.message}`);
    } finally {
      setLoading(null);
      setBusy(false);
    }
  }

  const hasName = !!cleanName(name);

  return (
    <View style={styles.box}>
      <Text style={styles.boxTitle}>{title}</Text>

      <Text style={styles.label}>اسم التطبيق (إنجليزي)</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="مثال: shop"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.hint}>للإنشاء استخدم اسم جديد. للتعديل على تطبيق موجود استخدم زر تعديل الكود.</Text>

      <Text style={styles.label}>الوصف</Text>
      <TextInput
        style={styles.textarea}
        value={description}
        onChangeText={setDescription}
        placeholder="مثال: متجر ملابس فيه سلة مشتريات وقائمة أسعار"
        multiline
      />

      <TouchableOpacity
        style={[styles.createBtn, busy && loading !== "create" && styles.disabled]}
        onPress={() => run("create")}
        disabled={busy}
      >
        {loading === "create" ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>إنشاء ورفع</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.previewBtn, !hasName && styles.disabled]}
        onPress={() => onPreview(cleanName(name))}
        disabled={!hasName}
      >
        <Text style={styles.previewBtnText}>معاينة</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editToggle} onPress={() => setEditOpen(!editOpen)}>
        <Text style={styles.editToggleText}>{editOpen ? "تعديل الكود ▲" : "تعديل الكود ▼"}</Text>
      </TouchableOpacity>

      {editOpen && (
        <View style={styles.editBox}>
          <Text style={styles.label}>وصف التعديل</Text>
          <TextInput
            style={styles.textarea}
            value={editText}
            onChangeText={setEditText}
            placeholder="مثال: غيّر الألوان للأخضر وأضف زر واتساب"
            multiline
          />
          <TouchableOpacity
            style={[styles.createBtn, busy && loading !== "edit" && styles.disabled]}
            onPress={() => run("edit")}
            disabled={busy}
          >
            {loading === "edit" ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>عدّل وارفع</Text>}
          </TouchableOpacity>
        </View>
      )}

      {log.length > 0 && (
        <View style={styles.logBox}>
          {log.map((line, i) => (
            <Text key={i} style={styles.logLine}>{line}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

export default function CreateScreen() {
  const [busy, setBusy] = useState(false);
  const [name1, setName1] = useState("");
  const [name2, setName2] = useState("");
  const [linkLoading, setLinkLoading] = useState<LinkKind | null>(null);
  const [linkLog, setLinkLog] = useState<string[]>([]);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewName, setPreviewName] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function doLink(kind: LinkKind) {
    if (busy) return;
    setLinkLog([]);
    setBusy(true);
    setLinkLoading(kind);
    try {
      await linkApps(kind, cleanName(name1), cleanName(name2), (s) =>
        setLinkLog((p) => [...p, s])
      );
      setLinkLog((p) => [...p, "🎉 اتربط التطبيقين. افتح المعاينة لكل واحد وجرّبه."]);
    } catch (e: any) {
      setLinkLog((p) => [...p, `❌ ${e.message}`]);
    } finally {
      setLinkLoading(null);
      setBusy(false);
    }
  }

  async function openPreview(name: string) {
    setPreviewName(name);
    setPreviewHtml(null);
    setPreviewError(null);
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const text = await getFileText(REPO, `apps/${name}/index.html`);
      if (!text) throw new Error("التطبيق ده مش موجود لسه. اعمل إنشاء الأول.");
      setPreviewHtml(text);
    } catch (e: any) {
      setPreviewError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppBox
          title="إنشاء التطبيق الأول"
          name={name1}
          setName={setName1}
          busy={busy}
          setBusy={setBusy}
          onPreview={openPreview}
        />

        <View style={styles.linkBox}>
          <Text style={styles.linkTitle}>ربط التطبيقين</Text>
          <Text style={styles.hint}>
            يستخدم اسمي التطبيقين المكتوبين فوق وتحت، ولازم يكونوا موجودين. الربط يعيد كتابة التطبيقين.
          </Text>

          <TouchableOpacity
            style={[styles.linkBtn, busy && linkLoading !== "supabase" && styles.disabled]}
            onPress={() => doLink("supabase")}
            disabled={busy}
          >
            {linkLoading === "supabase" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.createBtnText}>ربط التطبيقين عبر Supabase</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.linkBtn, styles.fireBtn, busy && linkLoading !== "firebase" && styles.disabled]}
            onPress={() => doLink("firebase")}
            disabled={busy}
          >
            {linkLoading === "firebase" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.createBtnText}>ربط التطبيقين عبر Firebase</Text>
            )}
          </TouchableOpacity>

          {linkLog.length > 0 && (
            <View style={styles.logBox}>
              {linkLog.map((line, i) => (
                <Text key={i} style={styles.logLine}>{line}</Text>
              ))}
            </View>
          )}
        </View>

        <AppBox
          title="إنشاء التطبيق الثاني"
          name={name2}
          setName={setName2}
          busy={busy}
          setBusy={setBusy}
          onPreview={openPreview}
        />
      </ScrollView>

      <Modal visible={previewOpen} animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "#fff" }}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>{previewName}</Text>
            <TouchableOpacity onPress={() => setPreviewOpen(false)}>
              <Text style={styles.closeText}>إغلاق ✕</Text>
            </TouchableOpacity>
          </View>
          {previewLoading && <ActivityIndicator style={{ marginTop: 16 }} />}
          {previewError && <Text style={styles.error}>❌ {previewError}</Text>}
          {previewHtml && (
            <WebView originWhitelist={["*"]} source={{ html: previewHtml }} style={{ flex: 1 }} />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  box: { borderWidth: 1, borderColor: "#ddd", borderRadius: 14, padding: 14, marginBottom: 20, backgroundColor: "#fff" },
  boxTitle: { fontWeight: "700", fontSize: 17, marginBottom: 4 },
  label: { fontWeight: "700", marginTop: 12, marginBottom: 6 },
  hint: { color: "#888", fontSize: 12, marginTop: 4 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 12, padding: 12 },
  textarea: { borderWidth: 1, borderColor: "#ccc", borderRadius: 12, padding: 12, minHeight: 90 },
  createBtn: { backgroundColor: "#111", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 16 },
  createBtnText: { color: "#fff", fontWeight: "700" },
  previewBtn: { borderWidth: 1, borderColor: "#111", borderRadius: 12, padding: 12, alignItems: "center", marginTop: 10 },
  previewBtnText: { color: "#111", fontWeight: "700" },
  editToggle: { borderWidth: 1, borderColor: "#888", borderRadius: 12, padding: 12, alignItems: "center", marginTop: 10, backgroundColor: "#f6f6f6" },
  editToggleText: { color: "#333", fontWeight: "700" },
  editBox: { marginTop: 4, borderTopWidth: 1, borderColor: "#eee", paddingTop: 4 },
  linkBox: { borderWidth: 1, borderColor: "#c7d2fe", backgroundColor: "#eef2ff", borderRadius: 14, padding: 14, marginBottom: 20 },
  linkTitle: { fontWeight: "700", fontSize: 17 },
  linkBtn: { backgroundColor: "#1d4ed8", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 12 },
  fireBtn: { backgroundColor: "#c2410c" },
  disabled: { opacity: 0.4 },
  logBox: { marginTop: 16, backgroundColor: "#f3f3f3", borderRadius: 10, padding: 12 },
  logLine: { marginBottom: 4, fontFamily: "monospace", fontSize: 13 },
  modalHead: { flexDirection: "row", alignItems: "center", paddingTop: 40, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: "#eee" },
  modalTitle: { flex: 1, fontWeight: "700", fontSize: 16 },
  closeText: { color: "#2563eb", fontWeight: "700" },
  error: { color: "#c0392b", margin: 16 },
});

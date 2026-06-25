import { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend } from "recharts";
import { Plus, Trash2, ArrowLeft, TrendingUp, Package, BarChart3, ChevronRight, Wallet, Calendar, Download, Boxes, Settings, X, Upload } from "lucide-react";
import Papa from "papaparse";

// ---------------------------------------------------------------------------
// localStorage ベースの簡易ストレージ (Claude.ai の window.storage の代替)
// ---------------------------------------------------------------------------
const storage = {
  async get(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) throw new Error("not found");
    return { key, value: raw };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

const PROJECTS_KEY = "sedori-projects-list";
const dataKey = (id) => `sedori-project-data:${id}`;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const yen = (n) => `¥${Math.round(n).toLocaleString()}`;
const PIE_COLORS = ["#ec4899", "#a855f7", "#14b8a6", "#f59e0b", "#3b82f6", "#84cc16", "#f43f5e", "#06b6d4"];

const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const downloadCSV = (filename, rows) => {
  const csv = "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  downloadBlob(filename, csv);
};

const downloadText = (filename, text) => {
  downloadBlob(filename, "\uFEFF" + text);
};

const downloadBlob = (filename, content) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const emptyData = () => ({ research: [], purchases: [], sales: [] });

const feeAmountOf = (sale) =>
  sale.feeType === "percent" ? (sale.salePrice * (sale.feeValue || 0)) / 100 : sale.feeValue || 0;

const BACKUP_FIELDS = [
  "type",
  "project_id",
  "project_name",
  "date",
  "price",
  "quantity",
  "memo",
  "shipping_cost",
  "sale_price",
  "fee_type",
  "fee_value",
];

export default function App() {
  const [view, setView] = useState("projects"); // projects | detail | summary
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [cache, setCache] = useState({}); // id -> { research, purchases, sales }
  const [loading, setLoading] = useState(true);
  const [detailTab, setDetailTab] = useState("research"); // research | purchase | transaction
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [importConfirming, setImportConfirming] = useState(false);
  const fileInputRef = useRef(null);

  const [rDate, setRDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rPrice, setRPrice] = useState("");

  const [pDate, setPDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pPrice, setPPrice] = useState("");
  const [pQty, setPQty] = useState("1");
  const [pMemo, setPMemo] = useState("");

  const [sDate, setSDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sShipping, setSShipping] = useState("");
  const [sPrice, setSPrice] = useState("");
  const [sQty, setSQty] = useState("1");
  const [sFeeType, setSFeeType] = useState("yen"); // yen | percent
  const [sFeeValue, setSFeeValue] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(PROJECTS_KEY);
        setProjects(res ? JSON.parse(res.value) : []);
      } catch (e) {
        setProjects([]);
      }
      setLoading(false);
    })();
  }, []);

  const saveProjects = async (list) => {
    setProjects(list);
    try {
      await storage.set(PROJECTS_KEY, JSON.stringify(list));
    } catch (e) {
      console.error("save projects failed", e);
    }
  };

  const loadProjectData = async (id) => {
    if (cache[id]) return cache[id];
    let data = emptyData();
    try {
      const res = await storage.get(dataKey(id));
      if (res) {
        const parsed = JSON.parse(res.value);
        data = {
          research: parsed.research || [],
          purchases: parsed.purchases || [],
          sales: (parsed.sales || []).map((s) => ({
            feeType: "yen",
            feeValue: 0,
            ...s,
          })),
        };
      }
    } catch (e) {
      // not found, use default
    }
    setCache((prev) => ({ ...prev, [id]: data }));
    return data;
  };

  const saveProjectData = async (id, data) => {
    setCache((prev) => ({ ...prev, [id]: data }));
    try {
      await storage.set(dataKey(id), JSON.stringify(data));
    } catch (e) {
      console.error("save project data failed", e);
    }
  };

  const addProject = async () => {
    if (!newProjectName.trim()) return;
    const p = { id: uid(), name: newProjectName.trim(), createdAt: Date.now() };
    const list = [...projects, p];
    await saveProjects(list);
    setCache((prev) => ({ ...prev, [p.id]: emptyData() }));
    setNewProjectName("");
    setShowNewProject(false);
  };

  const deleteProject = async (id) => {
    const list = projects.filter((p) => p.id !== id);
    await saveProjects(list);
    try {
      await storage.delete(dataKey(id));
    } catch (e) {}
    if (selectedId === id) {
      setSelectedId(null);
      setView("projects");
    }
  };

  const openProject = async (id) => {
    setSelectedId(id);
    setDetailTab("research");
    setView("detail");
    await loadProjectData(id);
  };

  const loadAllProjects = async () => {
    const result = {};
    for (const p of projects) {
      // eslint-disable-next-line no-await-in-loop
      result[p.id] = cache[p.id] || (await loadProjectData(p.id));
    }
    return result;
  };

  const openSummary = async () => {
    setLoading(true);
    await loadAllProjects();
    setLoading(false);
    setView("summary");
  };

  const addResearch = async () => {
    if (!rPrice || isNaN(Number(rPrice))) return;
    const data = await loadProjectData(selectedId);
    const entry = { id: uid(), date: rDate, price: Number(rPrice) };
    await saveProjectData(selectedId, { ...data, research: [...data.research, entry] });
    setRPrice("");
  };

  const deleteResearch = async (entryId) => {
    const data = await loadProjectData(selectedId);
    await saveProjectData(selectedId, { ...data, research: data.research.filter((e) => e.id !== entryId) });
  };

  const addPurchase = async () => {
    if (!pPrice || isNaN(Number(pPrice)) || !pQty || isNaN(Number(pQty))) return;
    const data = await loadProjectData(selectedId);
    const entry = { id: uid(), date: pDate, price: Number(pPrice), quantity: Number(pQty) || 1, memo: pMemo };
    await saveProjectData(selectedId, { ...data, purchases: [...data.purchases, entry] });
    setPPrice("");
    setPQty("1");
    setPMemo("");
  };

  const deletePurchase = async (entryId) => {
    const data = await loadProjectData(selectedId);
    await saveProjectData(selectedId, { ...data, purchases: data.purchases.filter((e) => e.id !== entryId) });
  };

  const addSale = async () => {
    if (!sPrice || isNaN(Number(sPrice)) || !sQty || isNaN(Number(sQty))) return;
    const data = await loadProjectData(selectedId);
    const entry = {
      id: uid(),
      date: sDate,
      shippingCost: Number(sShipping) || 0,
      salePrice: Number(sPrice),
      quantity: Number(sQty) || 1,
      feeType: sFeeType,
      feeValue: Number(sFeeValue) || 0,
    };
    await saveProjectData(selectedId, { ...data, sales: [...data.sales, entry] });
    setSShipping("");
    setSPrice("");
    setSQty("1");
    setSFeeValue("");
  };

  const deleteSale = async (entryId) => {
    const data = await loadProjectData(selectedId);
    await saveProjectData(selectedId, { ...data, sales: data.sales.filter((e) => e.id !== entryId) });
  };

  const computeStats = (data) => {
    if (!data) return { stock: 0, salesCount: 0, profit: 0, avgUnitCost: 0, purchaseQty: 0, purchaseAmount: 0 };
    const purchaseQty = data.purchases.reduce((s, p) => s + p.quantity, 0);
    const purchaseAmount = data.purchases.reduce((s, p) => s + p.price, 0);
    const saleQty = data.sales.reduce((s, t) => s + t.quantity, 0);
    const avgUnitCost = purchaseQty > 0 ? purchaseAmount / purchaseQty : 0;
    const profit = data.sales.reduce(
      (s, t) => s + (t.salePrice - t.shippingCost - feeAmountOf(t) - avgUnitCost * t.quantity),
      0
    );
    return { stock: purchaseQty - saleQty, salesCount: data.sales.length, profit, avgUnitCost, purchaseQty, purchaseAmount };
  };

  const exportProjectCSV = (project, data) => {
    const stats = computeStats(data);
    const rows = [];
    rows.push(["プロジェクト名", project.name]);
    rows.push(["在庫数", stats.stock]);
    rows.push([]);
    rows.push(["■調査価格履歴"]);
    rows.push(["日付", "調査価格"]);
    [...data.research].sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => rows.push([e.date, e.price]));
    rows.push([]);
    rows.push(["■仕入れ履歴"]);
    rows.push(["日付", "購入金額", "個数", "メモ"]);
    [...data.purchases].sort((a, b) => a.date.localeCompare(b.date)).forEach((p) => rows.push([p.date, p.price, p.quantity, p.memo]));
    rows.push([]);
    rows.push(["■取引履歴"]);
    rows.push(["日付", "発送代金", "取引価格", "個数", "手数料種別", "手数料値", "手数料額", "実利益(推定)"]);
    [...data.sales].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
      const fee = feeAmountOf(t);
      const profit = t.salePrice - t.shippingCost - fee - stats.avgUnitCost * t.quantity;
      rows.push([
        t.date,
        t.shippingCost,
        t.salePrice,
        t.quantity,
        t.feeType === "percent" ? "%" : "円",
        t.feeValue,
        Math.round(fee),
        Math.round(profit),
      ]);
    });
    downloadCSV(`${project.name}_データ.csv`, rows);
  };

  const exportSummaryCSV = () => {
    const rows = [["プロジェクト名", "在庫数", "取引数", "実利益"]];
    let totalCount = 0;
    let totalProfit = 0;
    let totalStock = 0;
    projects.forEach((p) => {
      const s = computeStats(cache[p.id]);
      rows.push([p.name, s.stock, s.salesCount, Math.round(s.profit)]);
      totalCount += s.salesCount;
      totalProfit += s.profit;
      totalStock += s.stock;
    });
    rows.push([]);
    rows.push(["合計", totalStock, totalCount, Math.round(totalProfit)]);
    downloadCSV("summary.csv", rows);
  };

  const exportFullBackup = async () => {
    setBackupBusy(true);
    setBackupMessage("バックアップを作成中...");
    const all = await loadAllProjects();
    const rows = [];
    projects.forEach((p) => {
      rows.push({
        type: "project",
        project_id: p.id,
        project_name: p.name,
        date: "",
        price: "",
        quantity: "",
        memo: "",
        shipping_cost: "",
        sale_price: "",
        fee_type: "",
        fee_value: "",
      });
      const data = all[p.id] || emptyData();
      data.research.forEach((r) =>
        rows.push({ type: "research", project_id: p.id, project_name: p.name, date: r.date, price: r.price, quantity: "", memo: "", shipping_cost: "", sale_price: "", fee_type: "", fee_value: "" })
      );
      data.purchases.forEach((pu) =>
        rows.push({ type: "purchase", project_id: p.id, project_name: p.name, date: pu.date, price: pu.price, quantity: pu.quantity, memo: pu.memo, shipping_cost: "", sale_price: "", fee_type: "", fee_value: "" })
      );
      data.sales.forEach((s) =>
        rows.push({ type: "sale", project_id: p.id, project_name: p.name, date: s.date, price: "", quantity: s.quantity, memo: "", shipping_cost: s.shippingCost, sale_price: s.salePrice, fee_type: s.feeType, fee_value: s.feeValue })
      );
    });
    const csv = Papa.unparse({ fields: BACKUP_FIELDS, data: rows });
    downloadText("all_backup.csv", csv);
    setBackupMessage("ダウンロードが完了しました!");
    setBackupBusy(false);
  };

  const triggerImport = () => {
    setImportConfirming(true);
  };

  const confirmAndPickFile = () => {
    setImportConfirming(false);
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBackupBusy(true);
    setBackupMessage("バックアップを読み込み中...");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = String(ev.target.result || "").replace(/^\uFEFF/, "");
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
        const rows = parsed.data;
        const projectMap = {};
        const dataMap = {};
        rows.forEach((row) => {
          const pid = row.project_id;
          if (!pid) return;
          if (!projectMap[pid]) projectMap[pid] = { id: String(pid), name: row.project_name || "", createdAt: Date.now() };
          if (!dataMap[pid]) dataMap[pid] = emptyData();
          if (row.type === "project") {
            projectMap[pid].name = row.project_name || projectMap[pid].name;
          } else if (row.type === "research") {
            dataMap[pid].research.push({ id: uid(), date: String(row.date || ""), price: Number(row.price) || 0 });
          } else if (row.type === "purchase") {
            dataMap[pid].purchases.push({
              id: uid(),
              date: String(row.date || ""),
              price: Number(row.price) || 0,
              quantity: Number(row.quantity) || 0,
              memo: row.memo || "",
            });
          } else if (row.type === "sale") {
            dataMap[pid].sales.push({
              id: uid(),
              date: String(row.date || ""),
              shippingCost: Number(row.shipping_cost) || 0,
              salePrice: Number(row.sale_price) || 0,
              quantity: Number(row.quantity) || 0,
              feeType: row.fee_type === "%" || row.fee_type === "percent" ? "percent" : "yen",
              feeValue: Number(row.fee_value) || 0,
            });
          }
        });

        for (const p of projects) {
          // eslint-disable-next-line no-await-in-loop
          try {
            await storage.delete(dataKey(p.id));
          } catch (err) {}
        }

        const newProjects = Object.values(projectMap);
        for (const p of newProjects) {
          // eslint-disable-next-line no-await-in-loop
          try {
            await storage.set(dataKey(p.id), JSON.stringify(dataMap[p.id] || emptyData()));
          } catch (err) {}
        }
        try {
          await storage.set(PROJECTS_KEY, JSON.stringify(newProjects));
        } catch (err) {}

        setProjects(newProjects);
        const newCache = {};
        newProjects.forEach((p) => {
          newCache[p.id] = dataMap[p.id] || emptyData();
        });
        setCache(newCache);
        setBackupMessage(`インポート完了: ${newProjects.length}件のプロジェクトを読み込みました`);
      } catch (err) {
        console.error(err);
        setBackupMessage("インポートに失敗しました。CSVの形式をご確認ください。");
      }
      setBackupBusy(false);
    };
    reader.readAsText(file, "utf-8");
  };

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50">
        <div className="text-purple-500 font-bold text-lg animate-pulse">読み込み中...</div>
      </div>
    );
  }

  const selectedProject = projects.find((p) => p.id === selectedId);
  const selectedData = cache[selectedId] || emptyData();
  const selectedStats = computeStats(selectedData);

  const previewFee = sFeeType === "percent" ? ((Number(sPrice) || 0) * (Number(sFeeValue) || 0)) / 100 : Number(sFeeValue) || 0;
  const previewCost = selectedStats.avgUnitCost * (Number(sQty) || 0);
  const previewProfit = (Number(sPrice) || 0) - (Number(sShipping) || 0) - previewFee - previewCost;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50 font-sans">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 text-white px-4 sm:px-6 py-5 shadow-lg sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="w-6 h-6" />
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight">りざログ</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-white/20 rounded-full p-1">
              <button
                onClick={() => setView("projects")}
                className={`px-3 sm:px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
                  view !== "summary" ? "bg-white text-fuchsia-600 shadow" : "text-white"
                }`}
              >
                プロジェクト
              </button>
              <button
                onClick={openSummary}
                className={`px-3 sm:px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
                  view === "summary" ? "bg-white text-fuchsia-600 shadow" : "text-white"
                }`}
              >
                サマリー
              </button>
            </div>
            <button
              onClick={() => {
                setBackupMessage("");
                setImportConfirming(false);
                setShowSettings(true);
              }}
              title="バックアップ設定"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Settings / Backup Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 relative">
            <button
              onClick={() => {
                setShowSettings(false);
                setImportConfirming(false);
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-extrabold text-gray-700 mb-1">データのバックアップ</h3>
            <p className="text-xs text-gray-400 mb-4">
              データはこのブラウザ内に保存されています。CSVファイルにエクスポートしておくと、機種変更やブラウザのデータ消去に備えられます。
            </p>

            <div className="space-y-3">
              <button
                onClick={exportFullBackup}
                disabled={backupBusy}
                className="w-full flex items-center justify-center gap-2 bg-fuchsia-500 hover:bg-fuchsia-600 disabled:opacity-50 text-white font-bold px-4 py-3 rounded-xl text-sm"
              >
                <Download className="w-4 h-4" /> 全データをCSVでエクスポート
              </button>

              <button
                onClick={triggerImport}
                disabled={backupBusy}
                className="w-full flex items-center justify-center gap-2 bg-white border-2 border-fuchsia-300 hover:bg-fuchsia-50 disabled:opacity-50 text-fuchsia-600 font-bold px-4 py-3 rounded-xl text-sm"
              >
                <Upload className="w-4 h-4" /> CSVからインポート(復元)
              </button>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />

              {importConfirming && (
                <div className="bg-rose-50 border-2 border-rose-200 rounded-xl p-3 text-sm">
                  <p className="text-rose-600 font-bold mb-2">⚠️ 現在のすべてのデータが上書きされます。続けますか?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setImportConfirming(false)}
                      className="flex-1 bg-white border-2 border-rose-200 text-rose-500 font-bold py-2 rounded-xl text-sm"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={confirmAndPickFile}
                      className="flex-1 bg-rose-500 hover:bg-rose-600 text-white font-bold py-2 rounded-xl text-sm"
                    >
                      理解した、ファイルを選択
                    </button>
                  </div>
                </div>
              )}
            </div>

            {backupMessage && (
              <p className="text-xs text-center mt-3 font-bold text-fuchsia-500">{backupMessage}</p>
            )}
            <p className="text-xs text-gray-300 mt-3">
              ※ インポートすると現在のデータはすべて置き換えられます。エクスポートしたファイルと同じ形式のCSVのみ読み込めます。
            </p>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* PROJECTS LIST VIEW */}
        {view === "projects" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-extrabold text-gray-700">プロジェクト一覧</h2>
              <button
                onClick={() => setShowNewProject((v) => !v)}
                className="flex items-center gap-1 bg-fuchsia-500 hover:bg-fuchsia-600 text-white font-bold px-4 py-2 rounded-full shadow-md transition-colors text-sm"
              >
                <Plus className="w-4 h-4" /> 新規プロジェクト
              </button>
            </div>

            {showNewProject && (
              <div className="bg-white rounded-2xl shadow-md p-4 mb-4 flex flex-col sm:flex-row gap-3">
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addProject()}
                  placeholder="商材名を入力 (例: ワイヤレスイヤホン A社製)"
                  className="flex-1 border-2 border-fuchsia-200 rounded-xl px-4 py-2 outline-none focus:border-fuchsia-400 text-sm"
                />
                <button onClick={addProject} className="bg-fuchsia-500 hover:bg-fuchsia-600 text-white font-bold px-5 py-2 rounded-xl text-sm">
                  追加
                </button>
              </div>
            )}

            {projects.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-md p-10 text-center text-gray-400">
                <Package className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                まだプロジェクトがありません。「新規プロジェクト」から追加しましょう!
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {projects.map((p) => {
                  const stats = computeStats(cache[p.id]);
                  return (
                    <div
                      key={p.id}
                      onClick={() => openProject(p.id)}
                      className="bg-white rounded-2xl shadow-md p-5 cursor-pointer hover:shadow-xl hover:-translate-y-0.5 transition-all border-2 border-transparent hover:border-fuchsia-200"
                    >
                      <div className="flex items-start justify-between">
                        <h3 className="font-bold text-gray-700 text-base pr-2">{p.name}</h3>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteProject(p.id);
                          }}
                          className="text-gray-300 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-3 mt-3 flex-wrap text-sm">
                        <span
                          className={`flex items-center gap-1 font-bold px-2 py-0.5 rounded-full ${
                            stats.stock < 0 ? "bg-rose-50 text-rose-500" : "bg-amber-50 text-amber-600"
                          }`}
                        >
                          <Boxes className="w-3.5 h-3.5" /> 在庫 {stats.stock}個
                        </span>
                        <span className="flex items-center gap-1 text-gray-500">
                          <TrendingUp className="w-4 h-4 text-teal-400" /> 取引 {stats.salesCount}件
                        </span>
                        <span className={`font-bold ${stats.profit >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{yen(stats.profit)}</span>
                      </div>
                      <div className="flex justify-end mt-2 text-fuchsia-400">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* DETAIL VIEW */}
        {view === "detail" && selectedProject && (
          <div>
            <button onClick={() => setView("projects")} className="flex items-center gap-1 text-fuchsia-500 font-bold mb-3 text-sm hover:text-fuchsia-600">
              <ArrowLeft className="w-4 h-4" /> プロジェクト一覧へ
            </button>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-extrabold text-gray-700">{selectedProject.name}</h2>
                <span
                  className={`flex items-center gap-1 font-bold px-2.5 py-1 rounded-full text-sm ${
                    selectedStats.stock < 0 ? "bg-rose-50 text-rose-500" : "bg-amber-50 text-amber-600"
                  }`}
                >
                  <Boxes className="w-4 h-4" /> 在庫 {selectedStats.stock}個
                </span>
              </div>
              <button
                onClick={() => exportProjectCSV(selectedProject, selectedData)}
                className="flex items-center gap-1 bg-white border-2 border-fuchsia-200 text-fuchsia-500 hover:bg-fuchsia-50 font-bold px-3 py-1.5 rounded-full text-xs sm:text-sm whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" /> CSV出力
              </button>
            </div>

            <div className="flex gap-2 mb-4 mt-3">
              <button
                onClick={() => setDetailTab("research")}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${
                  detailTab === "research" ? "bg-violet-500 text-white shadow-md" : "bg-white text-gray-400"
                }`}
              >
                調査価格
              </button>
              <button
                onClick={() => setDetailTab("purchase")}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${
                  detailTab === "purchase" ? "bg-amber-500 text-white shadow-md" : "bg-white text-gray-400"
                }`}
              >
                仕入れ
              </button>
              <button
                onClick={() => setDetailTab("transaction")}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${
                  detailTab === "transaction" ? "bg-teal-500 text-white shadow-md" : "bg-white text-gray-400"
                }`}
              >
                取引
              </button>
            </div>

            {detailTab === "research" && (
              <div>
                <div className="bg-white rounded-2xl shadow-md p-4 mb-4">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="date"
                      value={rDate}
                      onChange={(e) => setRDate(e.target.value)}
                      className="border-2 border-violet-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                    />
                    <input
                      type="number"
                      value={rPrice}
                      onChange={(e) => setRPrice(e.target.value)}
                      placeholder="調査価格 (円)"
                      className="flex-1 border-2 border-violet-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                    />
                    <button onClick={addResearch} className="bg-violet-500 hover:bg-violet-600 text-white font-bold px-5 py-2 rounded-xl text-sm whitespace-nowrap">
                      追加
                    </button>
                  </div>
                </div>

                {selectedData.research.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-md p-4 mb-4">
                    <h4 className="font-bold text-gray-600 text-sm mb-2 flex items-center gap-1">
                      <BarChart3 className="w-4 h-4 text-violet-400" /> 価格推移グラフ
                    </h4>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={[...selectedData.research].sort((a, b) => a.date.localeCompare(b.date))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0e7fb" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} width={50} />
                        <Tooltip formatter={(v) => yen(v)} />
                        <Line type="monotone" dataKey="price" stroke="#a855f7" strokeWidth={3} dot={{ r: 4, fill: "#a855f7" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="bg-white rounded-2xl shadow-md p-4">
                  <h4 className="font-bold text-gray-600 text-sm mb-2">履歴一覧</h4>
                  {selectedData.research.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-4">まだデータがありません</p>
                  ) : (
                    <div className="space-y-2">
                      {[...selectedData.research]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((e) => (
                          <div key={e.id} className="flex items-center justify-between bg-violet-50 rounded-xl px-3 py-2">
                            <span className="flex items-center gap-2 text-sm text-gray-500">
                              <Calendar className="w-3.5 h-3.5" /> {e.date}
                            </span>
                            <span className="font-bold text-violet-600 text-sm">{yen(e.price)}</span>
                            <button onClick={() => deleteResearch(e.id)} className="text-gray-300 hover:text-red-400">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {detailTab === "purchase" && (
              <div>
                <div className="bg-white rounded-2xl shadow-md p-4 mb-4">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={pDate}
                      onChange={(e) => setPDate(e.target.value)}
                      className="border-2 border-amber-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
                    />
                    <input
                      type="number"
                      value={pPrice}
                      onChange={(e) => setPPrice(e.target.value)}
                      placeholder="購入金額 (円)"
                      className="border-2 border-amber-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
                    />
                    <input
                      type="number"
                      min="1"
                      value={pQty}
                      onChange={(e) => setPQty(e.target.value)}
                      placeholder="個数"
                      className="border-2 border-amber-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
                    />
                    <input
                      value={pMemo}
                      onChange={(e) => setPMemo(e.target.value)}
                      placeholder="メモ (仕入れ先など)"
                      className="border-2 border-amber-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
                    />
                  </div>
                  <div className="flex justify-end mt-3">
                    <button onClick={addPurchase} className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-5 py-2 rounded-xl text-sm">
                      仕入れを追加
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-md p-4 mb-4">
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <span className="flex items-center gap-1 text-gray-500">
                      <Boxes className="w-4 h-4 text-amber-400" /> 仕入れ総数: {selectedStats.purchaseQty}個
                    </span>
                    <span className="text-gray-500">仕入れ総額: {yen(selectedStats.purchaseAmount)}</span>
                    <span className="text-gray-500">平均仕入単価: {yen(selectedStats.avgUnitCost)}</span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-md p-4">
                  <h4 className="font-bold text-gray-600 text-sm mb-2">仕入れ履歴</h4>
                  {selectedData.purchases.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-4">まだ仕入れデータがありません</p>
                  ) : (
                    <div className="space-y-2">
                      {[...selectedData.purchases]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((p) => (
                          <div key={p.id} className="bg-amber-50 rounded-xl px-3 py-2.5">
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2 text-xs text-gray-500">
                                <Calendar className="w-3.5 h-3.5" /> {p.date}
                              </span>
                              <button onClick={() => deletePurchase(p.id)} className="text-gray-300 hover:text-red-400">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm">
                              <span className="font-bold text-amber-600">{yen(p.price)}</span>
                              <span className="text-gray-500">{p.quantity}個</span>
                              {p.memo && <span className="text-gray-400">{p.memo}</span>}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {detailTab === "transaction" && (
              <div>
                <div className="bg-white rounded-2xl shadow-md p-4 mb-4">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={sDate}
                      onChange={(e) => setSDate(e.target.value)}
                      className="border-2 border-teal-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-teal-400"
                    />
                    <input
                      type="number"
                      min="1"
                      value={sQty}
                      onChange={(e) => setSQty(e.target.value)}
                      placeholder="個数"
                      className="border-2 border-teal-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-teal-400"
                    />
                    <input
                      type="number"
                      value={sShipping}
                      onChange={(e) => setSShipping(e.target.value)}
                      placeholder="発送代金 (円)"
                      className="border-2 border-teal-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-teal-400"
                    />
                    <input
                      type="number"
                      value={sPrice}
                      onChange={(e) => setSPrice(e.target.value)}
                      placeholder="取引価格 (円)"
                      className="border-2 border-teal-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-teal-400"
                    />
                    <div className="flex gap-2 col-span-1 sm:col-span-2">
                      <div className="flex rounded-xl border-2 border-teal-200 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setSFeeType("yen")}
                          className={`px-3 py-2 text-sm font-bold transition-colors ${
                            sFeeType === "yen" ? "bg-teal-500 text-white" : "bg-white text-gray-400"
                          }`}
                        >
                          円
                        </button>
                        <button
                          type="button"
                          onClick={() => setSFeeType("percent")}
                          className={`px-3 py-2 text-sm font-bold transition-colors ${
                            sFeeType === "percent" ? "bg-teal-500 text-white" : "bg-white text-gray-400"
                          }`}
                        >
                          %
                        </button>
                      </div>
                      <input
                        type="number"
                        value={sFeeValue}
                        onChange={(e) => setSFeeValue(e.target.value)}
                        placeholder={sFeeType === "percent" ? "手数料 (例: 10 で10%)" : "手数料 (円)"}
                        className="flex-1 border-2 border-teal-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-teal-400"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-3">
                    <div className="text-sm text-gray-500">
                      想定利益:{" "}
                      <span className={`font-bold ${previewProfit >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{yen(previewProfit)}</span>
                      <div className="text-xs text-gray-400 mt-0.5">
                        仕入コスト {yen(previewCost)} / 発送 {yen(Number(sShipping) || 0)} / 手数料 {yen(previewFee)}
                      </div>
                    </div>
                    <button onClick={addSale} className="bg-teal-500 hover:bg-teal-600 text-white font-bold px-5 py-2 rounded-xl text-sm whitespace-nowrap self-start sm:self-auto">
                      取引を追加
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-md p-4 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Wallet className="w-4 h-4 text-teal-400" />
                    <span className="text-gray-500">このプロジェクトの実利益合計:</span>
                    <span className={`font-extrabold text-lg ${selectedStats.profit >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {yen(selectedStats.profit)}
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-md p-4">
                  <h4 className="font-bold text-gray-600 text-sm mb-2">取引履歴</h4>
                  {selectedData.sales.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-4">まだ取引がありません</p>
                  ) : (
                    <div className="space-y-2">
                      {[...selectedData.sales]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((t) => {
                          const fee = feeAmountOf(t);
                          const profit = t.salePrice - t.shippingCost - fee - selectedStats.avgUnitCost * t.quantity;
                          return (
                            <div key={t.id} className="bg-teal-50 rounded-xl px-3 py-2.5">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2 text-xs text-gray-500">
                                  <Calendar className="w-3.5 h-3.5" /> {t.date}
                                </span>
                                <button onClick={() => deleteSale(t.id)} className="text-gray-300 hover:text-red-400">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500">
                                <span>個数: {t.quantity}個</span>
                                <span>発送: {yen(t.shippingCost)}</span>
                                <span>取引価格: {yen(t.salePrice)}</span>
                                <span>
                                  手数料: {yen(fee)} {t.feeType === "percent" ? `(${t.feeValue}%)` : ""}
                                </span>
                              </div>
                              <div className={`text-sm font-bold mt-1 ${profit >= 0 ? "text-emerald-500" : "text-rose-500"}`}>実利益: {yen(profit)}</div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUMMARY VIEW */}
        {view === "summary" && (
          <div>
            <div className="flex items-center justify-between mb-4 gap-2">
              <h2 className="text-xl font-extrabold text-gray-700">全体サマリー</h2>
              <button
                onClick={exportSummaryCSV}
                className="flex items-center gap-1 bg-white border-2 border-fuchsia-200 text-fuchsia-500 hover:bg-fuchsia-50 font-bold px-3 py-1.5 rounded-full text-xs sm:text-sm whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" /> CSV出力
              </button>
            </div>

            {(() => {
              const allStats = projects.map((p) => ({ name: p.name, ...computeStats(cache[p.id]) }));
              const totalCount = allStats.reduce((s, a) => s + a.salesCount, 0);
              const totalProfit = allStats.reduce((s, a) => s + a.profit, 0);
              const totalStock = allStats.reduce((s, a) => s + a.stock, 0);
              const pieData = allStats.filter((s) => s.profit > 0);

              return (
                <>
                  <div className="grid sm:grid-cols-3 gap-4 mb-5">
                    <div className="bg-white rounded-2xl shadow-md p-5 flex items-center gap-3">
                      <div className="bg-gradient-to-br from-amber-400 to-orange-400 p-3 rounded-xl">
                        <Boxes className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 font-bold">総在庫数</div>
                        <div className="text-2xl font-extrabold text-gray-700">{totalStock}個</div>
                      </div>
                    </div>
                    <div className="bg-white rounded-2xl shadow-md p-5 flex items-center gap-3">
                      <div className="bg-gradient-to-br from-violet-400 to-fuchsia-400 p-3 rounded-xl">
                        <TrendingUp className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 font-bold">総取引数</div>
                        <div className="text-2xl font-extrabold text-gray-700">{totalCount}件</div>
                      </div>
                    </div>
                    <div className="bg-white rounded-2xl shadow-md p-5 flex items-center gap-3">
                      <div className={`p-3 rounded-xl bg-gradient-to-br ${totalProfit >= 0 ? "from-emerald-400 to-teal-400" : "from-rose-400 to-orange-400"}`}>
                        <Wallet className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 font-bold">総実利益</div>
                        <div className={`text-2xl font-extrabold ${totalProfit >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{yen(totalProfit)}</div>
                      </div>
                    </div>
                  </div>

                  {allStats.length > 0 && (
                    <div className="bg-white rounded-2xl shadow-md p-4 mb-5">
                      <h4 className="font-bold text-gray-600 text-sm mb-2 flex items-center gap-1">
                        <BarChart3 className="w-4 h-4 text-fuchsia-400" /> プロジェクト別 実利益
                      </h4>
                      <ResponsiveContainer width="100%" height={Math.max(220, allStats.length * 50)}>
                        <BarChart data={allStats} layout="vertical" margin={{ left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#fbe8f5" />
                          <XAxis type="number" tick={{ fontSize: 11 }} />
                          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v) => yen(v)} />
                          <Bar dataKey="profit" radius={[0, 8, 8, 0]} fill="#ec4899" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {pieData.length > 0 && (
                    <div className="bg-white rounded-2xl shadow-md p-4 mb-5">
                      <h4 className="font-bold text-gray-600 text-sm mb-2 flex items-center gap-1">
                        <BarChart3 className="w-4 h-4 text-fuchsia-400" /> プロジェクト別 利益の内訳(円グラフ)
                      </h4>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                          <Pie data={pieData} dataKey="profit" nameKey="name" cx="50%" cy="42%" outerRadius={85} label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                            {pieData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v, n) => [yen(v), n]} />
                          <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, lineHeight: "1.6em", whiteSpace: "normal" }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <p className="text-xs text-gray-400 mt-1 text-center">※ 実利益がマイナスのプロジェクトは円グラフには表示されません</p>
                    </div>
                  )}

                  <div className="bg-white rounded-2xl shadow-md p-4">
                    <h4 className="font-bold text-gray-600 text-sm mb-2">プロジェクト別 内訳</h4>
                    {allStats.length === 0 ? (
                      <p className="text-gray-400 text-sm text-center py-4">プロジェクトがありません</p>
                    ) : (
                      <div className="space-y-2">
                        {allStats.map((s, i) => (
                          <div key={i} className="flex items-center justify-between bg-fuchsia-50 rounded-xl px-3 py-2.5 flex-wrap gap-2">
                            <span className="font-bold text-gray-600 text-sm">{s.name}</span>
                            <div className="flex items-center gap-3 text-sm">
                              <span
                                className={`flex items-center gap-1 font-bold px-2 py-0.5 rounded-full text-xs ${
                                  s.stock < 0 ? "bg-rose-50 text-rose-500" : "bg-amber-50 text-amber-600"
                                }`}
                              >
                                <Boxes className="w-3 h-3" /> {s.stock}個
                              </span>
                              <span className="text-gray-400">{s.salesCount}件</span>
                              <span className={`font-bold ${s.profit >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{yen(s.profit)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

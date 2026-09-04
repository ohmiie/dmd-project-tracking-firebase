import React, { useState, useEffect, useRef } from 'react';
import { signInAnonymously } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db as firestore } from './firebase';
import { 
  Users, UserCircle, LogOut, Search, Plus, Trash2, Edit2, 
  CheckCircle, Clock, Link as LinkIcon, BarChart3, Settings, 
  ChevronRight, AlertCircle, Check, X, XCircle, Download, Upload, Bookmark, Copy,
  Loader2, Info, GraduationCap, School, LayoutDashboard, FolderKanban, ShieldCheck, Printer
} from 'lucide-react';

const DEFAULT_LEVELS = ['ปวช. 1', 'ปวช. 2', 'ปวช. 3', 'ปวส. 1', 'ปวส. 2'];
const DEFAULT_ROOMS = ['1', '2', '3', '4'];
const ADMIN_PASSWORD = '995622';
const APP_VERSION = '8.0.9';
const DB_SCHEMA_VERSION = 8;
const ACTIVE_COLLECTIONS = ['users', 'groups', 'templates', 'submissions'];
const LEGACY_COLLECTIONS = ['loginIndex', 'authProfiles', 'sessions', 'publicStudents', 'publicProjects', 'publicStats', 'auditLogs'];

// --- UTILITIES ---
const getProgressColor = (percent) => {
  if (percent <= 10) return 'bg-red-500';
  if (percent <= 30) return 'bg-amber-900';
  if (percent <= 50) return 'bg-yellow-400';
  if (percent <= 70) return 'bg-amber-500';
  if (percent < 100) return 'bg-lime-500';
  return 'bg-green-600';
};

const calculateGroupProgress = (milestones) => {
  return milestones.reduce((sum, m) => sum + (m.status === 'approved' ? (Number(m.percent) || 0) : 0), 0);
};

const hasRejectedMilestone = (milestones) => {
  return milestones.some(m => m.status === 'rejected');
};

const makeSecuritySalt = () => {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

const hashTeacherSecret = async (secret, salt) => {
  const input = new TextEncoder().encode(`${salt}:${String(secret || '')}`);
  const digest = await window.crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};


const makeEntityId = (prefix) => {
  if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return `${prefix}_${Date.now()}_${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
};

const normalizeMatchText = (value) => String(value ?? '').normalize('NFC').toLowerCase().replace(/[\s.\-_\/]+/g, '');

const STANDARD_LEVEL_ORDER = ['ปวช. 1', 'ปวช. 2', 'ปวช. 3', 'ปวส. 1', 'ปวส. 2'];
const getLevelSortIndex = (value) => {
  const normalized = normalizeMatchText(value);
  const idx = STANDARD_LEVEL_ORDER.findIndex(level => normalizeMatchText(level) === normalized);
  return idx === -1 ? 999 : idx;
};
const compareRoomValue = (a, b) => {
  const aNum = Number(String(a ?? '').trim());
  const bNum = Number(String(b ?? '').trim());
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return String(a ?? '').localeCompare(String(b ?? ''), 'th', { numeric: true });
};
const getGroupMemberSignature = (group) => {
  const members = [...(group?.members || [])].map(id => String(id)).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  return `${normalizeMatchText(group?.level)}|${normalizeMatchText(group?.room)}|${members.join(',')}`;
};
const canonicalFromList = (value, options = [], fallback = '') => {
  const raw = String(value ?? '').trim();
  const found = (options || []).find(opt => normalizeMatchText(opt) === normalizeMatchText(raw));
  return found || raw || fallback;
};

const toDateInputValue = (date = new Date()) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const parseDateInput = (value) => {
  if (!value) return null;
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const formatThaiDate = (value) => {
  const d = parseDateInput(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(d);
};

const formatThaiDateTime = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const milestoneStatusLabel = (status) => status === 'approved' ? 'อนุมัติ' : status === 'rejected' ? 'ไม่อนุมัติ' : 'รอตรวจ';

const openPrintableReport = (title, bodyHtml, options = {}) => {
  const landscape = options.landscape === true;
  const win = window.open('', '_blank', 'width=1100,height=850');
  if (!win) return false;
  const safeTitle = escapeHtml(title);
  win.document.open();
  win.document.write(`<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Tahoma", "Noto Sans Thai", Arial, sans-serif; color:#111827; margin:0; font-size:12px; line-height:1.55; }
  h1,h2,h3,p { margin-top:0; }
  h1 { font-size:20px; margin-bottom:4px; }
  h2 { font-size:15px; margin:18px 0 8px; padding-bottom:5px; border-bottom:1px solid #d1d5db; }
  h3 { font-size:13px; margin:12px 0 6px; }
  .muted { color:#6b7280; }
  .header { text-align:center; margin-bottom:16px; }
  .meta { display:flex; justify-content:space-between; gap:12px; margin:10px 0 14px; }
  .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:12px 0; }
  .summary > div { border:1px solid #d1d5db; border-radius:8px; padding:9px; }
  .summary b { display:block; font-size:18px; margin-top:3px; }
  table { width:100%; border-collapse:collapse; margin:8px 0 14px; }
  th,td { border:1px solid #d1d5db; padding:6px 7px; vertical-align:top; }
  th { background:#f3f4f6; text-align:left; }
  .right { text-align:right; }
  .center { text-align:center; }
  .page-break { break-before:page; page-break-before:always; }
  .avoid { break-inside:avoid; page-break-inside:avoid; }
  .pill { display:inline-block; padding:2px 6px; border:1px solid #d1d5db; border-radius:999px; margin:1px 2px 1px 0; }
  .signatures { display:grid; grid-template-columns:1fr 1fr; gap:60px; margin-top:36px; text-align:center; }
  .signature-line { border-top:1px solid #6b7280; padding-top:6px; margin-top:45px; }
  @media print { .no-print { display:none !important; } }
</style>
</head>
<body>
${bodyHtml}
<script>setTimeout(() => { window.focus(); window.print(); }, 250);<\/script>
</body>
</html>`);
  win.document.close();
  return true;
};

const copyTextToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = String(text);
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }
};

const addDaysToDateInput = (baseValue, days) => {
  const base = parseDateInput(baseValue) || new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + Number(days || 0));
  return toDateInputValue(base);
};

const getDeadlineInfo = (milestone) => {
  if (!milestone?.dueDate) return null;
  if (milestone.status === 'approved') {
    return {
      diffDays: null,
      text: 'อนุมัติแล้ว',
      className: 'bg-green-50 text-green-700 border-green-200'
    };
  }

  const due = parseDateInput(milestone.dueDate);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) {
    return {
      diffDays,
      text: `เกินกำหนด ${Math.abs(diffDays)} วัน`,
      className: 'bg-red-50 text-red-700 border-red-200'
    };
  }
  if (diffDays === 0) {
    return {
      diffDays,
      text: 'ครบกำหนดวันนี้',
      className: 'bg-red-50 text-red-700 border-red-200'
    };
  }
  if (diffDays <= 3) {
    return {
      diffDays,
      text: `เหลืออีก ${diffDays} วัน`,
      className: 'bg-orange-50 text-orange-700 border-orange-200'
    };
  }
  if (diffDays <= 7) {
    return {
      diffDays,
      text: `เหลืออีก ${diffDays} วัน`,
      className: 'bg-amber-50 text-amber-700 border-amber-200'
    };
  }
  return {
    diffDays,
    text: `เหลืออีก ${diffDays} วัน`,
    className: 'bg-blue-50 text-blue-700 border-blue-200'
  };
};

const getNearestDeadlineMilestone = (milestones = []) => {
  const candidates = milestones
    .filter(m => m?.dueDate && m.status !== 'approved')
    .map(m => ({ milestone: m, date: parseDateInput(m.dueDate) }))
    .filter(x => x.date)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return candidates[0]?.milestone || null;
};

const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-xl border border-gray-100 shadow-sm p-6 ${className}`}>{children}</div>
);

const Button = ({ children, onClick, variant = 'primary', className = '', type = 'button', disabled = false }) => {
  const base = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    success: "bg-green-500 text-white hover:bg-green-600",
  };
  return <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>{children}</button>;
};

const Input = ({ label, type = 'text', value, onChange, placeholder, required, disabled }) => (
  <div className="flex flex-col gap-1 w-full">
    {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} required={required} disabled={disabled} className="border border-gray-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm disabled:bg-gray-50 disabled:text-gray-500" />
  </div>
);

const Select = ({ label, value, onChange, options, placeholder }) => (
  <div className="flex flex-col gap-1 w-full">
    {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
    <select value={value} onChange={onChange} className="border border-gray-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white">
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map((opt, i) => (
        <option key={i} value={typeof opt === 'string' ? opt : opt.value}>
          {typeof opt === 'string' ? opt : opt.label}
        </option>
      ))}
    </select>
  </div>
);

const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"><X size={20} /></button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

const ProgressBar = ({ percent }) => {
  const safePercent = Math.min(100, Math.max(0, percent));
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">ความคืบหน้า</span>
        <span className={`text-sm font-bold ${safePercent === 100 ? 'text-green-600' : 'text-gray-700'}`}>{safePercent.toFixed(0)}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden border border-gray-200/50">
        <div className={`h-full transition-all duration-700 ease-out ${getProgressColor(safePercent)}`} style={{ width: `${safePercent}%` }}></div>
      </div>
    </div>
  );
};

const AdminView = ({ db, handleUpdate, showToast, askConfirm, askPrompt, currentUser, systemHealth, inspectSystem, cleanupSystem, exportBackup, deleteAllStudentsRemote }) => {
  const LEVELS = db.catalogs?.levels?.length ? db.catalogs.levels : DEFAULT_LEVELS;
  const ROOMS = db.catalogs?.rooms?.length ? db.catalogs.rooms : DEFAULT_ROOMS;
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({ id: '', title: '', fname: '', lname: '', level: LEVELS[0], room: ROOMS[0] });
  const [setupCodeDialog, setSetupCodeDialog] = useState({ isOpen: false, code: '123456', teacher: null, teacherName: '' });
  const [systemBusy, setSystemBusy] = useState(false);
  const fileInputRef = useRef(null);

  const isUserTab = activeTab === 'students' || activeTab === 'teachers';
  const filteredUsers = db.users.filter(u => u.role === (activeTab === 'students' ? 'student' : 'teacher'));

  const handleSave = async () => {
    if(!formData.id || !formData.fname || !formData.lname) return showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error');
    let newUsers = [...db.users];
    const roleName = activeTab === 'students' ? 'student' : 'teacher';
    const isEdit = !!editingUser;
    const initialPassword = String(formData.initialPassword || '').trim();
    const { initialPassword: _initialPassword, ...safeFormData } = formData;

    let teacherPasswordPatch = {};
    if (roleName === 'teacher' && !isEdit) {
      const code = initialPassword || '123456';
      if (code.length < 6) return showToast('รหัสตั้งต้นต้องมีอย่างน้อย 6 ตัวอักษร', 'error');
      const salt = makeSecuritySalt();
      const tempHash = await hashTeacherSecret(code, salt);
      teacherPasswordPatch = {
        teacherPasswordSet: false,
        teacherPasswordHash: '',
        teacherPasswordSalt: '',
        teacherTempHash: tempHash,
        teacherTempSalt: salt,
        teacherPasswordUpdatedAt: Date.now()
      };
    }

    if (isEdit) {
      newUsers = newUsers.map(u => u.id === editingUser.id ? { ...u, ...safeFormData, role: roleName } : u);
    } else {
      if (newUsers.find(u => u.role === roleName && String(u.id) === String(safeFormData.id))) return showToast('รหัสนี้มีในระบบแล้วสำหรับบทบาทนี้', 'error');
      newUsers.push({ ...safeFormData, ...teacherPasswordPatch, role: roleName });
    }
    const ok = await handleUpdate('users', newUsers);
    if (!ok) return;
    showToast(isEdit ? 'อัปเดตข้อมูลสำเร็จ' : `เพิ่ม${roleName === 'teacher' ? 'อาจารย์' : 'นักศึกษา'}สำเร็จ`);
    setIsModalOpen(false);
  };

  const handleDelete = (id) => {
    const roleName = activeTab === 'students' ? 'student' : 'teacher';
    askConfirm('ต้องการลบผู้ใช้งานนี้ใช่หรือไม่?', async () => {
      const ok = await handleUpdate('users', db.users.filter(u => !(u.role === roleName && String(u.id) === String(id))));
      if (ok) showToast('ลบข้อมูลสำเร็จ');
    });
  };

  const issueTeacherSetupCode = async (teacher, codeValue) => {
    const code = String(codeValue || '').trim();
    if (code.length < 6) return showToast('รหัสตั้งต้นต้องมีอย่างน้อย 6 ตัวอักษร', 'error');
    const salt = makeSecuritySalt();
    const tempHash = await hashTeacherSecret(code, salt);
    const nextUsers = db.users.map(u => String(u.id) === String(teacher.id) && u.role === 'teacher' ? {
      ...u,
      teacherPasswordSet: false,
      teacherPasswordHash: '',
      teacherPasswordSalt: '',
      teacherTempHash: tempHash,
      teacherTempSalt: salt,
      teacherPasswordUpdatedAt: Date.now()
    } : u);
    const ok = await handleUpdate('users', nextUsers);
    if (!ok) return;
    setSetupCodeDialog({ isOpen: false, code: '123456', teacher: null, teacherName: '' });
    showToast(`ตั้งรหัสตั้งต้น ${code} ให้อาจารย์แล้ว`);
  };

  const handleTeacherSetupCode = (teacher) => {
    setSetupCodeDialog({
      isOpen: true,
      code: '123456',
      teacher,
      teacherName: `${teacher.title || ''}${teacher.fname || ''} ${teacher.lname || ''}`.trim()
    });
  };

  const openModal = (user = null) => {
    setEditingUser(user);
    setFormData(user ? { ...user, initialPassword: '' } : { id: '', title: activeTab === 'teachers' ? 'อาจารย์' : 'นาย', fname: '', lname: '', level: LEVELS[0], room: ROOMS[0], initialPassword: activeTab === 'teachers' ? '123456' : '' });
    setIsModalOpen(true);
  };

  const downloadCSVTemplate = () => {
    const BOM = "\uFEFF";
    const header = activeTab === 'students'
      ? "id,title,fname,lname,level,room\n66001,นาย,สมชาย,ใจดี,ปวช. 1,1"
      : "id,title,fname,lname\n995622,อาจารย์,สมศรี,สอนดี";
    const blob = new Blob([BOM + header], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `DMD_${activeTab}_template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const parseCSVLine = (line) => {
    const out = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(v => v.trim());
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = String(evt.target?.result || '').replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
        const roleName = activeTab === 'students' ? 'student' : 'teacher';
        const importedMap = new Map();
        let invalidRows = 0;
        let duplicateRows = 0;

        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          const id = String(cols[0] || '').trim();
          if (cols.length < 4 || !id) { invalidRows++; continue; }
          const user = {
            id,
            role: roleName,
            title: String(cols[1] || '').trim(),
            fname: String(cols[2] || '').trim(),
            lname: String(cols[3] || '').trim()
          };
          if (roleName === 'student') {
            user.level = canonicalFromList(cols[4] || LEVELS[0], LEVELS, LEVELS[0]);
            user.room = canonicalFromList(cols[5] || ROOMS[0], ROOMS, ROOMS[0]);
          }
          const key = `${roleName}:${id.toLowerCase()}`;
          if (importedMap.has(key)) duplicateRows++;
          importedMap.set(key, user);
        }

        const imported = [...importedMap.values()];
        if (!imported.length) return showToast('ไม่พบข้อมูลที่ถูกต้องในไฟล์ CSV', 'error');

        const mergedImported = [];
        for (const n of imported) {
          const old = db.users.find(u => u.role === n.role && String(u.id).trim().toLowerCase() === String(n.id).trim().toLowerCase());
          if (roleName === 'teacher' && (!old || (!old.teacherPasswordSet && !old.teacherTempHash))) {
            const salt = makeSecuritySalt();
            const tempHash = await hashTeacherSecret('123456', salt);
            mergedImported.push({
              ...(old || {}),
              ...n,
              teacherPasswordSet: false,
              teacherPasswordHash: '',
              teacherPasswordSalt: '',
              teacherTempHash: tempHash,
              teacherTempSalt: salt,
              teacherPasswordUpdatedAt: Date.now()
            });
          } else {
            mergedImported.push(old ? { ...old, ...n } : n);
          }
        }
        const oldWithoutDup = db.users.filter(u => !mergedImported.some(n => n.role === u.role && String(n.id).trim().toLowerCase() === String(u.id).trim().toLowerCase()));
        const nextUsers = [...oldWithoutDup, ...mergedImported];
        const ok = await handleUpdate('users', nextUsers);
        if (!ok) return;

        const roleCount = nextUsers.filter(u => u.role === roleName).length;
        const detail = [
          `นำเข้าสำเร็จ ${imported.length} คน`,
          duplicateRows ? `ตัดรหัสซ้ำในไฟล์ ${duplicateRows} แถว` : '',
          invalidRows ? `ข้ามข้อมูลไม่สมบูรณ์ ${invalidRows} แถว` : '',
          `ยอด${roleName === 'student' ? 'นักศึกษา' : 'อาจารย์'}หลังนำเข้า ${roleCount} คน`
        ].filter(Boolean).join(' • ');
        showToast(detail);
      } catch (err) {
        console.error('CSV import', err);
        showToast(`นำเข้า CSV ไม่สำเร็จ: ${err?.message || err}`, 'error');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleDeleteAllStudents = () => {
    const total = db.users.filter(u => u.role === 'student').length;
    if (!total) return showToast('ยังไม่มีข้อมูลนักศึกษาให้ลบ', 'error');

    askConfirm(`ต้องการลบนักศึกษาทั้งหมด ${total} คนหรือไม่? ระบบจะลบข้อมูลนักศึกษา ลิงก์ที่นักศึกษาส่ง และนำรายชื่อนักศึกษาออกจากทุกกลุ่ม การดำเนินการนี้ย้อนกลับไม่ได้`, async () => {
      try {
        setSystemBusy(true);
        const result = await deleteAllStudentsRemote();
        showToast(`ลบนักศึกษาทั้งหมดแล้ว ${result.students} คน • ลบลิงก์ ${result.submissions} รายการ • ปรับกลุ่ม ${result.groups} กลุ่ม`);
      } catch (err) {
        console.error('delete all students', err);
        showToast(`ลบนักศึกษาทั้งหมดไม่สำเร็จ: ${err?.message || err}`, 'error');
      } finally {
        setSystemBusy(false);
      }
    });
  };

  const handleInspectSystem = async () => {
    try {
      setSystemBusy(true);
      const result = await inspectSystem();
      showToast(`ตรวจสอบฐานข้อมูลแล้ว • ผู้ใช้ซ้ำ ${result.duplicateUserDocs} เอกสาร • ข้อมูลระบบเก่า ${result.legacyDocs} เอกสาร`);
    } catch (err) {
      showToast(`ตรวจสอบไม่สำเร็จ: ${err?.message || err}`, 'error');
    } finally { setSystemBusy(false); }
  };

  const handleCleanupSystem = () => {
    askConfirm('ทำความสะอาดฐานข้อมูลสำหรับระบบ v8 หรือไม่? ระบบจะรวมรหัสผู้ใช้ที่ซ้ำ จัดรูปแบบข้อมูลหลัก และลบ collection ของระบบเวอร์ชันเก่า แนะนำให้กด “สำรองข้อมูล JSON” ก่อนดำเนินการ', async () => {
      try {
        setSystemBusy(true);
        const result = await cleanupSystem();
        showToast(`ทำความสะอาดสำเร็จ • รวมผู้ใช้ ${result.canonicalUsers} คน • ลบข้อมูลซ้ำ/เก่า ${result.deletedDocs} เอกสาร`);
      } catch (err) {
        console.error('cleanup system', err);
        showToast(`ทำความสะอาดไม่สำเร็จ: ${err?.message || err}`, 'error');
      } finally { setSystemBusy(false); }
    });
  };

  const updateCatalog = (key, next) => handleUpdate('catalogs', { ...(db.catalogs || {}), [key]: next });
  const addCatalog = (key, label) => askPrompt(`เพิ่ม${label}`, async value => {
    const v = String(value || '').trim();
    if (!v) return;
    const arr = key === 'levels' ? LEVELS : ROOMS;
    if (arr.includes(v)) return showToast(`${label}นี้มีอยู่แล้ว`, 'error');
    const ok = await updateCatalog(key, [...arr, v]);
    if (ok) showToast(`เพิ่ม${label}แล้ว`);
  });
  const removeCatalog = (key, value, label) => {
    const inUse = db.users.some(u => u.role === 'student' && (key === 'levels' ? normalizeMatchText(u.level) === normalizeMatchText(value) : normalizeMatchText(u.room) === normalizeMatchText(value))) ||
      db.groups.some(g => key === 'levels' ? normalizeMatchText(g.level) === normalizeMatchText(value) : normalizeMatchText(g.room) === normalizeMatchText(value));
    if (inUse) return showToast(`ลบไม่ได้ เพราะ${label}นี้ถูกใช้งานอยู่`, 'error');
    askConfirm(`ลบ${label} “${value}” หรือไม่?`, async () => {
      const arr = key === 'levels' ? LEVELS : ROOMS;
      const ok = await updateCatalog(key, arr.filter(v => v !== value));
      if (ok) showToast(`ลบ${label}แล้ว`);
    });
  };

  const students = db.users.filter(u => u.role === 'student');
  const teachers = db.users.filter(u => u.role === 'teacher');
  const approvedWeight = db.groups.reduce((sum, g) => sum + calculateGroupProgress(g.milestones || []), 0);
  const avgProgress = db.groups.length ? approvedWeight / db.groups.length : 0;
  const levelStats = LEVELS.map(level => {
    const groups = db.groups.filter(g => normalizeMatchText(g.level) === normalizeMatchText(level));
    return { level, groups: groups.length, students: students.filter(s => normalizeMatchText(s.level) === normalizeMatchText(level)).length, progress: groups.length ? groups.reduce((a,g)=>a+calculateGroupProgress(g.milestones||[]),0)/groups.length : 0 };
  });

  // ลิงก์ถาวรสำหรับผู้ปกครองทั้งแผนก ใช้ URL เดียว ไม่ผูกกับนักศึกษารายบุคคล
  const parentPortalUrl = `${window.location.origin}${window.location.pathname}?parent=1`;

  const copyParentPortalLink = async () => {
    const copied = await copyTextToClipboard(parentPortalUrl);
    showToast(copied ? 'คัดลอกลิงก์ผู้ปกครองแล้ว' : 'ไม่สามารถคัดลอกอัตโนมัติได้ กรุณาคัดลอกจากช่องลิงก์', copied ? 'success' : 'error');
  };

  const openParentPortal = () => {
    window.open(parentPortalUrl, '_blank', 'noopener,noreferrer');
  };

  const printAdminReport = () => {
    const sortedGroups = [...(db.groups || [])].sort((a, b) => {
      const levelCompare = getLevelSortIndex(a.level) - getLevelSortIndex(b.level);
      if (levelCompare !== 0) return levelCompare;
      const roomCompare = compareRoomValue(a.room, b.room);
      if (roomCompare !== 0) return roomCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), 'th', { numeric: true });
    });
    const teacherName = teacherId => {
      const t = teachers.find(x => String(x.id) === String(teacherId));
      return t ? `${t.title || ''}${t.fname || ''} ${t.lname || ''}`.trim() : String(teacherId || '-');
    };
    const studentName = studentId => {
      const st = students.find(x => String(x.id) === String(studentId));
      return st ? `${st.title || ''}${st.fname || ''} ${st.lname || ''}`.trim() : String(studentId || '-');
    };
    const teacherStats = teachers.map(t => {
      const groups = sortedGroups.filter(g => String(g.teacherId) === String(t.id));
      return {
        teacher: `${t.title || ''}${t.fname || ''} ${t.lname || ''}`.trim(),
        count: groups.length,
        progress: groups.length ? groups.reduce((sum, g) => sum + calculateGroupProgress(g.milestones || []), 0) / groups.length : 0
      };
    }).sort((a,b)=>a.teacher.localeCompare(b.teacher,'th'));

    const body = `
      <div class="header">
        <h1>รายงานสรุประบบติดตามโครงงานบูรณาการ สาขา DMD</h1>
        <p class="muted">DMD Integrated Project Tracking System • รายงานสำหรับผู้บริหาร</p>
      </div>
      <div class="meta"><span>วันที่ออกรายงาน: ${escapeHtml(formatThaiDateTime())}</span><span>เวอร์ชันระบบ: v${escapeHtml(APP_VERSION)}</span></div>
      <div class="summary">
        <div>นักศึกษาทั้งหมด<b>${students.length}</b></div>
        <div>อาจารย์ผู้ควบคุม<b>${teachers.length}</b></div>
        <div>กลุ่มโครงงาน<b>${sortedGroups.length}</b></div>
        <div>ความคืบหน้าเฉลี่ย<b>${avgProgress.toFixed(0)}%</b></div>
      </div>
      <h2>สรุปแยกตามระดับชั้น</h2>
      <table><thead><tr><th>ระดับชั้น</th><th class="right">นักศึกษา</th><th class="right">กลุ่ม</th><th class="right">ความคืบหน้าเฉลี่ย</th></tr></thead><tbody>
        ${levelStats.map(x => `<tr><td>${escapeHtml(x.level)}</td><td class="right">${x.students}</td><td class="right">${x.groups}</td><td class="right">${x.progress.toFixed(0)}%</td></tr>`).join('')}
      </tbody></table>
      <h2>สรุปตามอาจารย์ผู้ควบคุม</h2>
      <table><thead><tr><th>อาจารย์ผู้ควบคุม</th><th class="right">จำนวนกลุ่ม</th><th class="right">ความคืบหน้าเฉลี่ย</th></tr></thead><tbody>
        ${teacherStats.map(x => `<tr><td>${escapeHtml(x.teacher)}</td><td class="right">${x.count}</td><td class="right">${x.progress.toFixed(0)}%</td></tr>`).join('')}
      </tbody></table>
      <h2>รายละเอียดกลุ่มโครงงานทั้งหมด</h2>
      <table><thead><tr><th style="width:4%">ลำดับ</th><th style="width:27%">ชื่อกลุ่มโครงงาน</th><th style="width:12%">ระดับ/ห้อง</th><th style="width:20%">อาจารย์ผู้ควบคุม</th><th>สมาชิก</th><th class="right" style="width:9%">ความคืบหน้า</th></tr></thead><tbody>
        ${sortedGroups.map((g, i) => `<tr><td class="center">${i+1}</td><td>${escapeHtml(g.name)}</td><td>${escapeHtml(g.level)} / ${escapeHtml(g.room)}</td><td>${escapeHtml(teacherName(g.teacherId))}</td><td>${(g.members || []).map(studentName).map(escapeHtml).join(', ') || '-'}</td><td class="right">${calculateGroupProgress(g.milestones || []).toFixed(0)}%</td></tr>`).join('')}
      </tbody></table>
      <div class="signatures"><div><div class="signature-line">ผู้จัดทำรายงาน</div></div><div><div class="signature-line">ผู้บริหาร/ผู้ตรวจสอบ</div></div></div>
    `;
    const ok = openPrintableReport('รายงานสรุปโครงงานบูรณาการ DMD', body, { landscape: true });
    if (!ok) showToast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up', 'error');
  };

  const tabs = [
    ['dashboard', <LayoutDashboard size={16}/>, 'ภาพรวม'],
    ['students', <GraduationCap size={16}/>, 'นักศึกษา'],
    ['teachers', <School size={16}/>, 'อาจารย์ผู้ควบคุม'],
    ['catalogs', <Settings size={16}/>, 'คลังระดับชั้น/ห้อง'],
    ['projects', <FolderKanban size={16}/>, 'จัดการโครงงาน'],
    ['parentLinks', <LinkIcon size={16}/>, 'ลิงก์ผู้ปกครอง'],
    ['system', <ShieldCheck size={16}/>, 'ระบบ/ฐานข้อมูล']
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">ผู้จัดการระบบ (Admin)</h2>
          <p className="text-sm text-gray-500 mt-1">ควบคุมข้อมูลผู้ใช้ โครงงาน คลังระดับชั้น/ห้อง และสถิติทั้งหมด</p>
        </div>
        <Button variant="secondary" onClick={printAdminReport}><Printer size={16}/> พิมพ์รายงานรวม</Button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 border-b border-gray-200">
        {tabs.map(([key, icon, label]) => <button key={key} onClick={() => setActiveTab(key)} className={`whitespace-nowrap px-3 py-2 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${activeTab===key?'border-blue-600 text-blue-600':'border-transparent text-gray-500 hover:text-gray-800'}`}>{icon}{label}</button>)}
      </div>

      {activeTab === 'dashboard' && <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card><p className="text-xs text-gray-500">นักศึกษาทั้งหมด</p><p className="text-3xl font-bold mt-2">{students.length}</p></Card>
          <Card><p className="text-xs text-gray-500">อาจารย์ผู้ควบคุม</p><p className="text-3xl font-bold mt-2">{teachers.length}</p></Card>
          <Card><p className="text-xs text-gray-500">กลุ่มโครงงาน</p><p className="text-3xl font-bold mt-2">{db.groups.length}</p></Card>
          <Card><p className="text-xs text-gray-500">ความคืบหน้าเฉลี่ย</p><p className="text-3xl font-bold mt-2">{avgProgress.toFixed(0)}%</p></Card>
        </div>
        <Card className="overflow-x-auto">
          <h3 className="font-bold text-gray-800 mb-4">สถิติแยกตามระดับชั้น</h3>
          <table className="w-full text-sm min-w-[620px]"><thead className="bg-gray-50 text-gray-500"><tr><th className="text-left p-3">ระดับชั้น</th><th className="text-right p-3">นักศึกษา</th><th className="text-right p-3">กลุ่ม</th><th className="text-left p-3">ความคืบหน้าเฉลี่ย</th></tr></thead><tbody>{levelStats.map(s=><tr key={s.level} className="border-t"><td className="p-3 font-medium">{s.level}</td><td className="p-3 text-right">{s.students}</td><td className="p-3 text-right">{s.groups}</td><td className="p-3"><div className="flex items-center gap-3"><div className="flex-1"><ProgressBar percent={s.progress}/></div></div></td></tr>)}</tbody></table>
        </Card>
      </div>}

      {isUserTab && <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between gap-3">
          <div><h3 className="text-lg font-bold">{activeTab==='students'?'ข้อมูลนักศึกษา':'ข้อมูลอาจารย์'}</h3><p className="text-xs text-gray-500">เพิ่ม แก้ไข ลบ หรือนำเข้าด้วย CSV</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={downloadCSVTemplate}><Download size={16}/> ตัวอย่าง CSV</Button><input type="file" accept=".csv,text/csv" ref={fileInputRef} className="hidden" onChange={handleFileUpload}/><Button variant="secondary" onClick={()=>fileInputRef.current?.click()}><Upload size={16}/> นำเข้า CSV</Button>{activeTab==='students'&&<Button variant="danger" onClick={handleDeleteAllStudents}><Trash2 size={16}/> ลบนักศึกษาทั้งหมด</Button>}<Button onClick={()=>openModal()}><Plus size={16}/> เพิ่ม</Button></div>
        </div>
        <Card className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]"><thead className="bg-gray-50 text-gray-500"><tr><th className="text-left p-3">รหัส</th><th className="text-left p-3">ชื่อ-สกุล</th>{activeTab==='students'&&<th className="text-left p-3">ระดับชั้น / ห้อง</th>}{activeTab==='teachers'&&<th className="text-left p-3">รหัสผ่าน</th>}<th className="text-right p-3">จัดการ</th></tr></thead><tbody>{filteredUsers.map(user=><tr key={user.id} className="border-t hover:bg-gray-50"><td className="p-3 font-medium">{user.id}</td><td className="p-3">{user.title}{user.fname} {user.lname}</td>{activeTab==='students'&&<td className="p-3">{user.level} / {user.room}</td>}{activeTab==='teachers'&&<td className="p-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${user.teacherPasswordSet ? 'bg-green-50 text-green-700' : user.teacherTempHash ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{user.teacherPasswordSet ? 'ตั้งแล้ว' : user.teacherTempHash ? 'รอตั้งรหัส' : 'ยังไม่เปิดใช้งาน'}</span></td>}<td className="p-3"><div className="flex justify-end gap-1">{activeTab==='teachers'&&<button title={user.teacherPasswordSet ? 'ตั้ง/รีเซ็ตรหัสตั้งต้น' : 'กำหนดรหัสตั้งต้น'} onClick={()=>handleTeacherSetupCode(user)} className="p-2 text-green-600 hover:bg-green-50 rounded"><ShieldCheck size={16}/></button>}<button onClick={()=>openModal(user)} className="p-2 text-blue-600 hover:bg-blue-50 rounded"><Edit2 size={16}/></button><button onClick={()=>handleDelete(user.id)} className="p-2 text-red-600 hover:bg-red-50 rounded"><Trash2 size={16}/></button></div></td></tr>)}{!filteredUsers.length&&<tr><td colSpan={activeTab==='teachers'?4:4} className="p-8 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>}</tbody></table></Card>
      </div>}

      {activeTab === 'catalogs' && <div className="grid md:grid-cols-2 gap-6">
        <Card><div className="flex justify-between items-center mb-4"><div><h3 className="font-bold">คลังระดับชั้น</h3><p className="text-xs text-gray-500">อาจารย์จะเลือกได้จากรายการนี้เท่านั้น</p></div><Button onClick={()=>addCatalog('levels','ระดับชั้น')}><Plus size={16}/> เพิ่ม</Button></div><div className="space-y-2">{LEVELS.map(v=><div key={v} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"><span className="font-medium">{v}</span><button onClick={()=>removeCatalog('levels',v,'ระดับชั้น')} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button></div>)}</div></Card>
        <Card><div className="flex justify-between items-center mb-4"><div><h3 className="font-bold">คลังห้อง</h3><p className="text-xs text-gray-500">เพิ่มหรือลบห้องเรียนได้จากที่นี่</p></div><Button onClick={()=>addCatalog('rooms','ห้อง')}><Plus size={16}/> เพิ่ม</Button></div><div className="space-y-2">{ROOMS.map(v=><div key={v} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"><span className="font-medium">ห้อง {v}</span><button onClick={()=>removeCatalog('rooms',v,'ห้อง')} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button></div>)}</div></Card>
      </div>}

      {activeTab === 'projects' && <TeacherView user={currentUser} db={db} handleUpdate={handleUpdate} showToast={showToast} askConfirm={askConfirm} askPrompt={askPrompt} adminMode />}

      {activeTab === 'parentLinks' && <div className="max-w-3xl mx-auto space-y-5">
        <div className="text-center">
          <h3 className="text-xl font-bold text-gray-800">ลิงก์ถาวรสำหรับผู้ปกครอง</h3>
          <p className="text-sm text-gray-500 mt-1">ใช้ลิงก์เดียวสำหรับผู้ปกครองทั้งแผนก ส่งครั้งเดียวและใช้งานต่อเนื่องได้ ไม่ต้องสร้างลิงก์ใหม่รายบุคคล</p>
        </div>
        <Card>
          <div className="max-w-2xl mx-auto space-y-5 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center"><Users size={28}/></div>
            <div>
              <h4 className="font-bold text-gray-800 text-lg">ศูนย์ตรวจสอบโครงงานสำหรับผู้ปกครอง</h4>
              <p className="text-sm text-gray-500 mt-1">เมื่อเปิดลิงก์นี้ ผู้ปกครองจะเห็นเฉพาะหน้าค้นหานักศึกษาและข้อมูลติดตามโครงงานเท่านั้น ไม่เห็นเมนูนักศึกษา อาจารย์ หรือ Admin</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-left">
              <p className="text-xs text-gray-400 mb-1">ลิงก์ถาวร</p>
              <p className="text-sm text-blue-700 break-all font-medium">{parentPortalUrl}</p>
            </div>
            <div className="flex flex-col sm:flex-row justify-center gap-2">
              <Button onClick={copyParentPortalLink}><Copy size={16}/> คัดลอกลิงก์</Button>
              <Button variant="secondary" onClick={openParentPortal}><LinkIcon size={16}/> เปิดหน้าผู้ปกครอง</Button>
            </div>
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800 text-left">
              <b>วิธีใช้:</b> ส่งลิงก์นี้ให้ผู้ปกครองทุกคน ผู้ปกครองกรอกรหัส ชื่อ หรือนามสกุลของนักศึกษา แล้วเลือกชื่อเพื่อดูความคืบหน้าได้ทันที ลิงก์ไม่เปลี่ยนและไม่หมดอายุจากระบบ
            </div>
          </div>
        </Card>
      </div>}

      {activeTab === 'system' && <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card><p className="text-xs text-gray-500">เวอร์ชันระบบ</p><p className="text-2xl font-bold mt-2">v{APP_VERSION}</p></Card>
          <Card><p className="text-xs text-gray-500">นักศึกษาในระบบ</p><p className="text-2xl font-bold mt-2">{db.users.filter(u=>u.role==='student').length}</p></Card>
          <Card><p className="text-xs text-gray-500">อาจารย์ในระบบ</p><p className="text-2xl font-bold mt-2">{db.users.filter(u=>u.role==='teacher').length}</p></Card>
          <Card><p className="text-xs text-gray-500">กลุ่มโครงงาน</p><p className="text-2xl font-bold mt-2">{db.groups.length}</p></Card>
        </div>

        <Card>
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h3 className="font-bold text-gray-800 text-lg">ตรวจสุขภาพฐานข้อมูล</h3>
              <p className="text-sm text-gray-500 mt-1">ใช้ตรวจรหัสซ้ำ เอกสารจากระบบรุ่นเก่า และความสัมพันธ์ข้อมูลก่อนใช้งานจริง</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={systemBusy} onClick={handleInspectSystem}><Info size={16}/> ตรวจสอบ</Button>
              <Button variant="secondary" disabled={systemBusy} onClick={exportBackup}><Download size={16}/> สำรองข้อมูล JSON</Button>
              <Button disabled={systemBusy} onClick={handleCleanupSystem}><ShieldCheck size={16}/> ทำความสะอาดระบบ v8</Button>
            </div>
          </div>

          {systemHealth ? <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
            <div className="p-4 rounded-xl bg-gray-50 border"><p className="text-xs text-gray-500">เอกสารผู้ใช้จริง</p><p className="text-xl font-bold mt-1">{systemHealth.rawUserDocs}</p></div>
            <div className={`p-4 rounded-xl border ${systemHealth.duplicateUserDocs ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}><p className="text-xs text-gray-500">เอกสารผู้ใช้ซ้ำ</p><p className="text-xl font-bold mt-1">{systemHealth.duplicateUserDocs}</p></div>
            <div className={`p-4 rounded-xl border ${systemHealth.legacyDocs ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}><p className="text-xs text-gray-500">ข้อมูลระบบเก่า</p><p className="text-xl font-bold mt-1">{systemHealth.legacyDocs}</p></div>
            <div className={`p-4 rounded-xl border ${systemHealth.orphanRefs ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}><p className="text-xs text-gray-500">การอ้างอิงที่หาเจ้าของไม่พบ</p><p className="text-xl font-bold mt-1">{systemHealth.orphanRefs}</p></div>
          </div> : <div className="mt-5 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">กด “ตรวจสอบ” เพื่อดูสถานะฐานข้อมูลปัจจุบัน ก่อนทำความสะอาดระบบครั้งแรก</div>}

          <div className="mt-5 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <b>ใช้ครั้งเดียวก่อนเปิดใช้งานจริง:</b> กดสำรองข้อมูล JSON → ตรวจสอบ → ทำความสะอาดระบบ v8 หลังจากนั้นไม่ต้องทำซ้ำทุกครั้งที่ Login
          </div>
        </Card>
      </div>}

      <Modal isOpen={isModalOpen} onClose={()=>setIsModalOpen(false)} title={editingUser?'แก้ไขข้อมูล':'เพิ่มข้อมูลใหม่'}>
        <div className="space-y-4">
          <Input label="รหัส (ใช้ Login)" value={formData.id} onChange={e=>setFormData({...formData,id:e.target.value.trim()})} disabled={!!editingUser}/>
          <div className="grid grid-cols-3 gap-3"><Select label="คำนำหน้า" value={formData.title} onChange={e=>setFormData({...formData,title:e.target.value})} options={['นาย','นางสาว','นาง','อาจารย์','ดร.','ผศ.','รศ.']}/><div className="col-span-2"><Input label="ชื่อ" value={formData.fname} onChange={e=>setFormData({...formData,fname:e.target.value})}/></div></div>
          <Input label="นามสกุล" value={formData.lname} onChange={e=>setFormData({...formData,lname:e.target.value})}/>
          {activeTab==='students'&&<div className="grid grid-cols-2 gap-3"><Select label="ระดับชั้น" value={formData.level} onChange={e=>setFormData({...formData,level:e.target.value})} options={LEVELS}/><Select label="ห้อง" value={formData.room} onChange={e=>setFormData({...formData,room:e.target.value})} options={ROOMS}/></div>}
          {activeTab==='teachers'&&!editingUser&&<div className="space-y-2"><Input label="รหัสตั้งต้น" type="text" value={formData.initialPassword || ''} onChange={e=>setFormData({...formData,initialPassword:e.target.value})} placeholder="ค่าเริ่มต้น 123456"/><p className="text-xs text-gray-500">ค่าเริ่มต้นคือ 123456 อาจารย์จะใช้รหัสนี้เข้าสู่ระบบครั้งแรก แล้วระบบจะให้ตั้งรหัสผ่านส่วนตัวทันที</p></div>}
          <div className="flex justify-end gap-2 pt-3"><Button variant="secondary" onClick={()=>setIsModalOpen(false)}>ยกเลิก</Button><Button onClick={handleSave}>บันทึก</Button></div>
        </div>
      </Modal>

      <Modal isOpen={setupCodeDialog.isOpen} onClose={()=>setSetupCodeDialog({isOpen:false,code:'123456',teacher:null,teacherName:''})} title="ตั้ง/รีเซ็ตรหัสตั้งต้นอาจารย์">
        <div className="space-y-5">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm text-gray-600">กำหนดรหัสตั้งต้นให้อาจารย์ <b>{setupCodeDialog.teacherName}</b> ค่าเริ่มต้นคือ <b>123456</b> เมื่ออาจารย์ใช้รหัสนี้เข้าสู่ระบบ ระบบจะให้ตั้งรหัสผ่านส่วนตัวใหม่ทันที</p>
          </div>
          <Input label="รหัสตั้งต้น" type="text" value={setupCodeDialog.code} onChange={e=>setSetupCodeDialog(prev=>({...prev,code:e.target.value}))} placeholder="123456"/>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={()=>setSetupCodeDialog({isOpen:false,code:'123456',teacher:null,teacherName:''})}>ยกเลิก</Button>
            <Button onClick={()=>setupCodeDialog.teacher && issueTeacherSetupCode(setupCodeDialog.teacher, setupCodeDialog.code)}><ShieldCheck size={16}/> บันทึกรหัสตั้งต้น</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

const TeacherView = ({ user, db, handleUpdate, showToast, askConfirm, askPrompt, adminMode = false }) => {
  const LEVELS = db.catalogs?.levels?.length ? db.catalogs.levels : DEFAULT_LEVELS;
  const ROOMS = db.catalogs?.rooms?.length ? db.catalogs.rooms : DEFAULT_ROOMS;
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateTeacherFilter, setTemplateTeacherFilter] = useState('all');
  const [isGroupTemplateModalOpen, setIsGroupTemplateModalOpen] = useState(false);
  const [groupTemplateTeacherFilter, setGroupTemplateTeacherFilter] = useState('all');
  const [groupForm, setGroupForm] = useState({ id: '', name: '', teacherId: adminMode ? '' : String(user.id ?? ''), level: LEVELS[0], room: ROOMS[0], allowCrossRoom: false, members: [], milestones: [], links: [] });
  const [searchStudent, setSearchStudent] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [groupStudentSearch, setGroupStudentSearch] = useState('');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [milestoneDrafts, setMilestoneDrafts] = useState({});

  const ownedGroups = adminMode ? (db.groups || []) : (db.groups || []).filter(g => String(g.teacherId ?? '') === String(user.id ?? ''));
  const groupStudentNeedle = normalizeMatchText(groupStudentSearch);
  const matchingStudentIds = new Set(
    (db.users || [])
      .filter(u => {
        if (u.role !== 'student' || !groupStudentNeedle) return false;
        const haystack = normalizeMatchText(`${u.id || ''}${u.title || ''}${u.fname || ''}${u.lname || ''}`);
        return haystack.includes(groupStudentNeedle);
      })
      .map(u => String(u.id))
  );
  const myGroups = ownedGroups
    .filter(g => {
      const matchesLevel = levelFilter === 'all' || normalizeMatchText(g.level) === normalizeMatchText(levelFilter);
      const matchesStudent = !groupStudentNeedle || (g.members || []).some(mid => matchingStudentIds.has(String(mid)));
      return matchesLevel && matchesStudent;
    })
    .sort((a, b) => {
      const levelCompare = getLevelSortIndex(a.level) - getLevelSortIndex(b.level);
      if (levelCompare !== 0) return levelCompare;
      const roomCompare = compareRoomValue(a.room, b.room);
      if (roomCompare !== 0) return roomCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), 'th', { numeric: true });
    });
  const allTemplates = db.templates || [];
  const activeGroup = myGroups.find(g => g.id === activeGroupId);

  useEffect(() => {
    if (!activeGroup) {
      setMilestoneDrafts({});
      return;
    }
    setMilestoneDrafts(Object.fromEntries((activeGroup.milestones || []).map(m => [
      String(m.id),
      { desc: String(m.desc || ''), percent: Number(m.percent || 0) }
    ])));
  }, [activeGroupId, levelFilter, groupStudentSearch, db.groups]);

  useEffect(() => {
    if (activeGroupId && !myGroups.some(g => String(g.id) === String(activeGroupId))) {
      setActiveGroupId(null);
    }
  }, [levelFilter, groupStudentSearch, db.groups]);

  const getTeacherDisplayName = (teacherId) => {
    const teacher = db.users.find(u => u.role === 'teacher' && String(u.id ?? '') === String(teacherId ?? ''));
    if (!teacher) return `รหัสอาจารย์ ${teacherId || '-'}`;
    return `${teacher.title || ''}${teacher.fname || ''} ${teacher.lname || ''}`.trim();
  };

  const teacherTemplateOptions = Array.from(new Set(allTemplates.map(t => String(t.teacherId ?? '')).filter(Boolean)))
    .map(id => ({ value: id, label: getTeacherDisplayName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'th'));

  const visibleTemplates = allTemplates
    .filter(t => templateTeacherFilter === 'all' || String(t.teacherId ?? '') === templateTeacherFilter)
    .sort((a, b) => {
      const nameCompare = getTeacherDisplayName(a.teacherId).localeCompare(getTeacherDisplayName(b.teacherId), 'th');
      if (nameCompare !== 0) return nameCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), 'th');
    });

  // กลุ่มต้นแบบ: ใช้โครงสร้างกลุ่มนักศึกษาของอาจารย์ท่านอื่น
  // กลุ่มที่เคยคัดลอกแล้ว หรือมีนักศึกษาซ้ำกับกลุ่มของอาจารย์ปัจจุบัน จะไม่แสดงอีก
  const ownedMemberIds = new Set(
    ownedGroups.flatMap(group => (group.members || []).map(id => String(id)))
  );
  const copiedSourceGroupIds = new Set(
    ownedGroups.map(group => String(group.copiedFromGroupId || '')).filter(Boolean)
  );
  const ownedGroupSignatures = new Set(ownedGroups.map(getGroupMemberSignature));

  const groupTemplateSourceGroups = (db.groups || []).filter(g => {
    if (adminMode) return true;
    if (String(g.teacherId ?? '') === String(user.id ?? '')) return false;

    // เคยคัดลอกจากกลุ่มนี้โดยตรงแล้ว
    if (copiedSourceGroupIds.has(String(g.id ?? ''))) return false;

    // รองรับกลุ่มที่คัดลอกจากเวอร์ชันเก่า ซึ่งยังไม่มี copiedFromGroupId
    if (ownedGroupSignatures.has(getGroupMemberSignature(g))) return false;

    // ถ้ามีนักศึกษาคนใดในกลุ่มต้นแบบอยู่ในกลุ่มของอาจารย์คนนี้แล้ว ให้ซ่อนเพื่อกันซ้ำ
    const hasAssignedMember = (g.members || []).some(id => ownedMemberIds.has(String(id)));
    if (hasAssignedMember) return false;

    return true;
  });

  const groupTemplateTeacherOptions = Array.from(new Set(groupTemplateSourceGroups.map(g => String(g.teacherId ?? '')).filter(Boolean)))
    .map(id => ({ value: id, label: getTeacherDisplayName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'th'));

  const visibleGroupTemplates = groupTemplateSourceGroups
    .filter(g => groupTemplateTeacherFilter === 'all' || String(g.teacherId ?? '') === groupTemplateTeacherFilter)
    .sort((a, b) => {
      const levelCompare = getLevelSortIndex(a.level) - getLevelSortIndex(b.level);
      if (levelCompare !== 0) return levelCompare;
      const roomCompare = compareRoomValue(a.room, b.room);
      if (roomCompare !== 0) return roomCompare;
      const teacherCompare = getTeacherDisplayName(a.teacherId).localeCompare(getTeacherDisplayName(b.teacherId), 'th');
      if (teacherCompare !== 0) return teacherCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), 'th', { numeric: true });
    });

  const getStudentRecord = (id) => db.users.find(u => u.role === 'student' && String(u.id ?? '') === String(id ?? ''));

  const getStudentName = (id) => {
    const s = getStudentRecord(id);
    return s ? `${s.fname} ${s.lname}` : id;
  };

  const getStudentRoom = (id) => {
    const s = getStudentRecord(id);
    return s?.room ? String(s.room) : '-';
  };

  const getGroupMemberRooms = (group) => {
    const rooms = Array.from(new Set((group?.members || [])
      .map(id => getStudentRecord(id)?.room)
      .filter(Boolean)
      .map(room => String(room))));
    return rooms.sort(compareRoomValue);
  };

  const getGroupRoomLabel = (group) => {
    const rooms = getGroupMemberRooms(group);
    if (rooms.length > 1) return `ร่วมห้อง ${rooms.join(', ')}`;
    if (rooms.length === 1) return `ห้อง ${rooms[0]}`;
    return `ห้อง ${group?.room || '-'}`;
  };

  const toggleCrossRoom = () => {
    if (!groupForm.allowCrossRoom) {
      setGroupForm(p => ({ ...p, allowCrossRoom: true }));
      return;
    }

    const keptMembers = (groupForm.members || []).filter(id => {
      const student = getStudentRecord(id);
      return student && normalizeMatchText(student.room) === normalizeMatchText(groupForm.room);
    });
    const removedCount = (groupForm.members || []).length - keptMembers.length;
    const apply = () => setGroupForm(p => ({ ...p, allowCrossRoom: false, members: keptMembers }));
    if (removedCount > 0) {
      askConfirm(`ปิดโหมดร่วมห้องจะนำสมาชิกต่างห้องออก ${removedCount} คน ยืนยันหรือไม่?`, apply);
    } else {
      apply();
    }
  };

  const handleSaveGroup = async () => {
    if(!groupForm.name) return showToast('กรุณากรอกชื่อกลุ่ม', 'error');
    if(groupForm.members.length > 10) return showToast('1 กลุ่มมีสมาชิกได้ไม่เกิน 10 คน', 'error');
    if(adminMode && !groupForm.teacherId) return showToast('กรุณาเลือกอาจารย์ผู้ควบคุม', 'error');

    const selectedStudents = (groupForm.members || []).map(id => getStudentRecord(id)).filter(Boolean);
    const hasDifferentLevel = selectedStudents.some(student => normalizeMatchText(student.level) !== normalizeMatchText(groupForm.level));
    if (hasDifferentLevel) return showToast('สมาชิกทุกคนต้องอยู่ในระดับชั้นเดียวกับกลุ่มโครงงาน', 'error');
    const hasDifferentRoom = selectedStudents.some(student => normalizeMatchText(student.room) !== normalizeMatchText(groupForm.room));
    if (!groupForm.allowCrossRoom && hasDifferentRoom) return showToast('พบสมาชิกต่างห้อง กรุณาเปิดโหมดร่วมห้องก่อนบันทึก', 'error');

    const normalizedGroup = {
      ...groupForm,
      allowCrossRoom: !!groupForm.allowCrossRoom || new Set(selectedStudents.map(student => normalizeMatchText(student.room))).size > 1,
      teacherId: String(adminMode ? groupForm.teacherId : user.id ?? ''),
      members: (groupForm.members || []).map(id => String(id))
    };

    let newGroups = [...db.groups];
    let nextActiveId = normalizedGroup.id;
    const isEdit = !!normalizedGroup.id;

    if (isEdit) {
      newGroups = newGroups.map(g => g.id === normalizedGroup.id ? normalizedGroup : g);
    } else {
      nextActiveId = makeEntityId('g');
      newGroups.push({ ...normalizedGroup, id: nextActiveId });
    }

    const ok = await handleUpdate('groups', newGroups);
    if (!ok) return;

    setActiveGroupId(nextActiveId);
    setIsGroupModalOpen(false);
    showToast(isEdit ? 'อัปเดตกลุ่มสำเร็จ' : 'สร้างกลุ่มโครงงานสำเร็จ');
  };

  const handleDeleteGroup = () => {
    askConfirm('คุณแน่ใจหรือไม่ว่าต้องการลบกลุ่มโครงงานนี้? ข้อมูลการประเมินทั้งหมดจะหายไป', async () => {
      const ok = await handleUpdate('groups', db.groups.filter(g => g.id !== activeGroup.id));
      if (!ok) return;
      setActiveGroupId(null);
      showToast('ลบกลุ่มโครงงานสำเร็จ');
    });
  };

  const updateMilestones = async (newMilestones) => {
    if (!activeGroup) return false;
    const updatedGroups = db.groups.map(g => g.id === activeGroup.id ? { ...g, milestones: newMilestones } : g);
    return await handleUpdate('groups', updatedGroups);
  };

  const milestoneWithDraft = (milestone) => {
    const draft = milestoneDrafts[String(milestone.id)];
    if (!draft) return milestone;
    return {
      ...milestone,
      desc: String(draft.desc ?? milestone.desc ?? ''),
      percent: Number(draft.percent ?? milestone.percent ?? 0)
    };
  };

  const saveMilestoneDraft = async (milestoneId) => {
    if (!activeGroup) return;
    const updated = activeGroup.milestones.map(m => String(m.id) === String(milestoneId) ? milestoneWithDraft(m) : m);
    const ok = await updateMilestones(updated);
    if (ok) showToast('บันทึกรายการประเมินแล้ว');
  };

  const autoDistribute = (items) => {
    if (!items.length) return items;
    const base = Math.floor(100 / items.length);
    let remain = 100 - (base * items.length);
    return items.map((m, i) => ({ ...m, order: i + 1, percent: base + (remain-- > 0 ? 1 : 0) }));
  };

  const addMilestone = () => {
    const newM = {
      id: makeEntityId('m'),
      order: activeGroup.milestones.length + 1,
      desc: 'รายการประเมินใหม่',
      percent: 0,
      status: 'pending',
      assignDate: toDateInputValue(),
      dueDate: ''
    };
    updateMilestones(autoDistribute([...activeGroup.milestones.map(milestoneWithDraft), newM]));
  };

  const setMilestoneDate = (milestoneId, field, value) => {
    const found = activeGroup.milestones.find(m => m.id === milestoneId);
    if (!found) return;
    const current = milestoneWithDraft(found);
    const next = { ...current, [field]: value };

    if (next.assignDate && next.dueDate) {
      const assigned = parseDateInput(next.assignDate);
      const due = parseDateInput(next.dueDate);
      if (assigned && due && due.getTime() < assigned.getTime()) {
        showToast('กำหนดส่งต้องเป็นวันเดียวกับหรือหลังวันที่สั่ง', 'error');
        return;
      }
    }

    updateMilestones(activeGroup.milestones.map(m => m.id === milestoneId ? next : milestoneWithDraft(m)));
  };

  const setMilestoneDuration = (milestoneId, days) => {
    const found = activeGroup.milestones.find(m => m.id === milestoneId);
    if (!found) return;
    const current = milestoneWithDraft(found);
    const assignDate = current.assignDate || toDateInputValue();
    const dueDate = addDaysToDateInput(assignDate, days);
    updateMilestones(activeGroup.milestones.map(m =>
      m.id === milestoneId ? { ...current, assignDate, dueDate } : milestoneWithDraft(m)
    ));
  };

  const setMilestoneStatus = (milestoneId, status) => {
    const updated = activeGroup.milestones.map(m => m.id === milestoneId ? { ...milestoneWithDraft(m), status } : milestoneWithDraft(m));
    updateMilestones(updated);
  };

  const deleteMilestone = (milestoneId) => {
    askConfirm('ต้องการลบรายการประเมินนี้หรือไม่?', () => {
      updateMilestones(autoDistribute(activeGroup.milestones.map(milestoneWithDraft).filter(m => m.id !== milestoneId)));
    });
  }

  const saveAsTemplate = () => {
    if (!activeGroup || activeGroup.milestones.length === 0) return showToast('ไม่มีรายการประเมินให้บันทึก', 'error');
    
    askPrompt('กรุณาตั้งชื่อเทมเพลต', async (name) => {
      if(!name) return;
      const newTemplate = {
        id: makeEntityId('tpl'),
        teacherId: String(adminMode ? activeGroup.teacherId : user.id ?? ''),
        name: name,
        milestones: activeGroup.milestones.map(milestoneWithDraft).map(m => ({ desc: m.desc, percent: m.percent })) 
      };
      const ok = await handleUpdate('templates', [...(db.templates || []), newTemplate]);
      if (ok) showToast('บันทึกเทมเพลตสำเร็จ');
    });
  };

  const loadTemplate = (templateId) => {
    const tpl = allTemplates.find(t => t.id === templateId);
    if (!tpl) return;
    
    const applyTpl = async () => {
      const appliedMilestones = tpl.milestones.map((m, idx) => ({
        id: `${makeEntityId('m')}_${idx}`,
        order: idx + 1,
        desc: m.desc,
        percent: m.percent,
        status: 'pending',
        assignDate: toDateInputValue(),
        dueDate: ''
      }));
      const ok = await updateMilestones(appliedMilestones);
      if (!ok) return;
      setIsTemplateModalOpen(false);
      showToast('โหลดเทมเพลตสำเร็จ');
    };

    if(activeGroup.milestones.length > 0) {
      askConfirm('การเรียกใช้เทมเพลตจะเขียนทับรายการประเมินเดิมทั้งหมด ยืนยันหรือไม่?', applyTpl);
    } else {
      applyTpl();
    }
  };

  const useGroupAsTemplate = (sourceGroupId) => {
    const source = (db.groups || []).find(g => String(g.id) === String(sourceGroupId));
    if (!source) return showToast('ไม่พบกลุ่มต้นแบบที่เลือก', 'error');

    const validStudentIds = new Set(db.users.filter(u=>u.role==='student').map(u=>String(u.id)));
    const sourceMembers = (source.members || []).map(id => String(id));
    const copiedMembers = sourceMembers.filter(id => validStudentIds.has(id));
    setGroupForm({
      id: '',
      name: source.name || '',
      teacherId: adminMode ? String(source.teacherId ?? '') : String(user.id ?? ''),
      level: source.level || LEVELS[0],
      room: source.room || ROOMS[0],
      allowCrossRoom: source.allowCrossRoom === true || new Set(copiedMembers.map(id => normalizeMatchText(getStudentRecord(id)?.room)).filter(Boolean)).size > 1,
      members: copiedMembers,
      milestones: [],
      links: [],
      copiedFromGroupId: String(source.id ?? ''),
      copiedFromTeacherId: String(source.teacherId ?? '')
    });
    setSearchStudent('');
    setIsGroupTemplateModalOpen(false);
    setIsGroupModalOpen(true);
    const skipped = sourceMembers.length - copiedMembers.length;
    showToast(skipped ? `คัดลอกกลุ่มแล้ว • ข้ามสมาชิกที่ไม่มีในฐานข้อมูล ${skipped} คน` : 'คัดลอกกลุ่มต้นแบบแล้ว กรุณาตรวจสอบชื่อกลุ่มและสมาชิกก่อนบันทึก');
  };

  const changeTeacherPassword = async () => {
    if (adminMode) return;
    if (!user.teacherPasswordSet || !user.teacherPasswordHash || !user.teacherPasswordSalt) return showToast('บัญชีนี้ยังไม่มีรหัสผ่านถาวร กรุณาติดต่อผู้จัดการระบบ', 'error');
    if (newPassword.length < 6) return showToast('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร', 'error');
    if (newPassword !== confirmNewPassword) return showToast('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน', 'error');
    const currentHash = await hashTeacherSecret(currentPassword, user.teacherPasswordSalt);
    if (currentHash !== user.teacherPasswordHash) return showToast('รหัสผ่านปัจจุบันไม่ถูกต้อง', 'error');

    const salt = makeSecuritySalt();
    const passwordHash = await hashTeacherSecret(newPassword, salt);
    const nextUsers = db.users.map(u => u.role === 'teacher' && String(u.id) === String(user.id) ? {
      ...u,
      teacherPasswordSet: true,
      teacherPasswordHash: passwordHash,
      teacherPasswordSalt: salt,
      teacherTempHash: '',
      teacherTempSalt: '',
      teacherPasswordUpdatedAt: Date.now()
    } : u);
    const ok = await handleUpdate('users', nextUsers);
    if (!ok) return;
    setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword(''); setIsPasswordModalOpen(false);
    showToast('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
  };

  const printTeacherReport = () => {
    const reportGroups = [...ownedGroups].sort((a, b) => {
      const levelCompare = getLevelSortIndex(a.level) - getLevelSortIndex(b.level);
      if (levelCompare !== 0) return levelCompare;
      const roomCompare = compareRoomValue(a.room, b.room);
      if (roomCompare !== 0) return roomCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), 'th', { numeric: true });
    });
    const teacherLabel = `${user.title || ''}${user.fname || ''} ${user.lname || ''}`.trim();
    const avg = reportGroups.length ? reportGroups.reduce((sum, g) => sum + calculateGroupProgress(g.milestones || []), 0) / reportGroups.length : 0;
    const details = reportGroups.map((g, gi) => {
      const members = (g.members || []).map(id => {
        const st = getStudentRecord(id);
        return st ? `${st.title || ''}${st.fname || ''} ${st.lname || ''} (${st.id}, ห้อง ${st.room || '-'})` : String(id);
      });
      const submissions = (db.submissions || []).filter(s => String(s.groupId) === String(g.id));
      return `
        <div class="avoid">
          <h2>${gi + 1}. ${escapeHtml(g.name || '-')}</h2>
          <p><b>ระดับชั้น/ห้อง:</b> ${escapeHtml(g.level || '-')} / ${escapeHtml(getGroupRoomLabel(g))} &nbsp; <b>สมาชิก:</b> ${members.length} คน &nbsp; <b>ความคืบหน้า:</b> ${calculateGroupProgress(g.milestones || []).toFixed(0)}%</p>
          <p><b>รายชื่อสมาชิก:</b> ${members.map(escapeHtml).join(', ') || '-'}</p>
          <table><thead><tr><th style="width:5%">#</th><th>รายการประเมิน</th><th style="width:10%">น้ำหนัก</th><th style="width:13%">วันที่สั่ง</th><th style="width:13%">กำหนดส่ง</th><th style="width:12%">สถานะ</th></tr></thead><tbody>
            ${(g.milestones || []).map((m, i) => `<tr><td class="center">${i+1}</td><td>${escapeHtml(m.desc || '-')}</td><td class="right">${Number(m.percent || 0)}%</td><td>${escapeHtml(formatThaiDate(m.assignDate))}</td><td>${escapeHtml(formatThaiDate(m.dueDate))}</td><td>${escapeHtml(milestoneStatusLabel(m.status))}</td></tr>`).join('') || '<tr><td colspan="6" class="center muted">ยังไม่มีรายการประเมิน</td></tr>'}
          </tbody></table>
          <p class="muted">ลิงก์งานที่ส่งเข้าระบบ: ${submissions.length} รายการ</p>
        </div>`;
    }).join('');

    const body = `
      <div class="header">
        <h1>รายงานติดตามโครงงานบูรณาการ สาขา DMD</h1>
        <p class="muted">รายงานประจำอาจารย์ผู้ควบคุม</p>
      </div>
      <div class="meta"><span>อาจารย์ผู้ควบคุม: <b>${escapeHtml(teacherLabel || '-')}</b></span><span>วันที่ออกรายงาน: ${escapeHtml(formatThaiDateTime())}</span></div>
      <div class="summary">
        <div>กลุ่มโครงงานทั้งหมด<b>${reportGroups.length}</b></div>
        <div>ความคืบหน้าเฉลี่ย<b>${avg.toFixed(0)}%</b></div>
        <div>รายการผ่านอนุมัติ<b>${reportGroups.reduce((sum,g)=>sum+(g.milestones||[]).filter(m=>m.status==='approved').length,0)}</b></div>
        <div>รายการไม่อนุมัติ<b>${reportGroups.reduce((sum,g)=>sum+(g.milestones||[]).filter(m=>m.status==='rejected').length,0)}</b></div>
      </div>
      ${details || '<p class="center muted">ยังไม่มีกลุ่มโครงงาน</p>'}
      <div class="signatures"><div><div class="signature-line">อาจารย์ผู้ควบคุม</div></div><div><div class="signature-line">ผู้ตรวจสอบ/หัวหน้าสาขา</div></div></div>
    `;
    const ok = openPrintableReport(`รายงานโครงงาน - ${teacherLabel}`, body);
    if (!ok) showToast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up', 'error');
  };

  return (
    <div className="space-y-6 flex flex-col md:flex-row gap-6">
      <div className="w-full md:w-1/3 flex flex-col gap-4">
        <div className="flex justify-between items-center gap-2">
          <h2 className="text-xl font-bold text-gray-800">{adminMode ? 'กลุ่มโครงงานทั้งหมด' : 'กลุ่มโครงงานของฉัน'}</h2>
          <div className="flex gap-2 flex-wrap justify-end">
            {!adminMode && <Button variant="secondary" onClick={printTeacherReport} className="py-1.5 px-3 text-sm"><Printer size={16}/> พิมพ์รายงาน</Button>}
            {!adminMode && <Button variant="secondary" onClick={()=>setIsPasswordModalOpen(true)} className="py-1.5 px-3 text-sm"><ShieldCheck size={16}/> รหัสผ่าน</Button>}
            {!adminMode && <Button variant="secondary" onClick={() => { setGroupTemplateTeacherFilter('all'); setIsGroupTemplateModalOpen(true); }} className="py-1.5 px-3 text-sm"><Copy size={16}/> คัดลอกกลุ่ม</Button>}
            <Button onClick={() => { setGroupForm({ id: '', name: '', teacherId: adminMode ? '' : String(user.id ?? ''), level: LEVELS[0], room: ROOMS[0], allowCrossRoom: false, members: [], milestones: [], links: [], copiedFromGroupId: '', copiedFromTeacherId: '' }); setIsGroupModalOpen(true); }} className="py-1.5 px-3 text-sm"><Plus size={16}/> สร้าง</Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">กรองระดับชั้น</label>
            <select
              value={levelFilter}
              onChange={e => setLevelFilter(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">ทุกระดับชั้น</option>
              {LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">ค้นหานักศึกษาในกลุ่ม</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input
                type="text"
                value={groupStudentSearch}
                onChange={e => setGroupStudentSearch(e.target.value)}
                placeholder="ชื่อ / นามสกุล / รหัสนักศึกษา"
                className="w-full border border-gray-200 rounded-lg pl-9 pr-9 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              {groupStudentSearch && <button type="button" onClick={() => setGroupStudentSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700"><X size={15}/></button>}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>แสดง {myGroups.length} จาก {ownedGroups.length} กลุ่ม</span>
            {(levelFilter !== 'all' || groupStudentSearch) && (
              <button type="button" onClick={() => { setLevelFilter('all'); setGroupStudentSearch(''); }} className="text-blue-600 hover:underline">ล้างตัวกรอง</button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {myGroups.map(group => (
             <Card key={group.id} className={`cursor-pointer transition-all p-4 ${activeGroupId === group.id ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/30' : 'hover:border-blue-300'}`}>
             <div onClick={() => setActiveGroupId(group.id)}>
               <h3 className="font-semibold text-gray-800 line-clamp-1">{group.name}</h3>
               <p className="text-xs text-gray-500 mt-1">{group.level} / {getGroupRoomLabel(group)} • สมาชิก {group.members.length} คน</p>
               <div className="mt-3">
                 <ProgressBar percent={calculateGroupProgress(group.milestones)} />
               </div>
               {hasRejectedMilestone(group.milestones) && (
                 <p className="text-xs text-red-500 mt-2 flex items-center gap-1 font-medium"><AlertCircle size={12}/> มีรายการไม่อนุมัติ (หมดสิทธิ์สอบ)</p>
               )}
             </div>
           </Card>
          ))}
          {myGroups.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4 bg-gray-50 rounded-lg">
              {ownedGroups.length === 0 ? 'ยังไม่มีกลุ่มโครงงาน' : 'ไม่พบกลุ่มที่ตรงกับระดับชั้นหรือนักศึกษาที่ค้นหา'}
            </p>
          )}
        </div>
      </div>

      <div className="w-full md:w-2/3">
        {activeGroup ? (
          <Card className="h-full flex flex-col gap-6">
            <div className="flex justify-between items-start border-b border-gray-100 pb-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">{activeGroup.name}</h2>
                <div className="flex flex-wrap gap-2 mt-3">
                  {activeGroup.members.map(mid => (
                    <span key={mid} className="bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full border border-gray-200">{getStudentName(mid)} • ห้อง {getStudentRoom(mid)}</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                 <Button variant="danger" onClick={handleDeleteGroup}><Trash2 size={16}/></Button>
                 <Button variant="secondary" onClick={() => { setGroupForm({ ...activeGroup, allowCrossRoom: activeGroup.allowCrossRoom === true || getGroupMemberRooms(activeGroup).length > 1 }); setIsGroupModalOpen(true); }}><Edit2 size={16}/> แก้ไข</Button>
              </div>
            </div>

            <div>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <CheckCircle size={20} className="text-blue-600"/> รายการประเมิน
                </h3>
                <div className="flex gap-2">
                  <Button onClick={() => setIsTemplateModalOpen(true)} variant="secondary" className="text-sm py-1.5"><Copy size={16}/> เลือกเทมเพลต</Button>
                  <Button onClick={saveAsTemplate} variant="secondary" className="text-sm py-1.5"><Bookmark size={16}/> บันทึกเทมเพลต</Button>
                  <Button onClick={() => updateMilestones(autoDistribute(activeGroup.milestones.map(milestoneWithDraft)))} variant="secondary" className="text-sm py-1.5">จัด % อัตโนมัติ</Button><Button onClick={addMilestone} className="text-sm py-1.5"><Plus size={16}/> เพิ่ม</Button>
                </div>
              </div>

              <div className="space-y-3">
                {activeGroup.milestones.map((m, idx) => {
                  const deadline = getDeadlineInfo(m);
                  return (
                  <div key={m.id} className={`p-4 rounded-xl border space-y-3
                    ${m.status === 'approved' ? 'bg-green-50/50 border-green-200' :
                      m.status === 'rejected' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>

                    <div className="flex flex-col xl:flex-row gap-3 xl:items-center">
                      <div className="flex-grow w-full flex items-center gap-3">
                        <span className="text-sm font-bold text-gray-400 w-5">{idx + 1}.</span>
                        <input
                          type="text" value={milestoneDrafts[String(m.id)]?.desc ?? m.desc ?? ''} placeholder="รายละเอียด..."
                          onChange={(e) => setMilestoneDrafts(prev => ({ ...prev, [String(m.id)]: { ...(prev[String(m.id)] || { percent: Number(m.percent || 0) }), desc: e.target.value } }))}
                          className="flex-grow bg-white/70 border border-gray-200 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm font-medium w-full min-w-0"
                        />
                      </div>

                      <div className="flex items-center gap-2 flex-wrap xl:flex-nowrap pl-8 xl:pl-0">
                        <div className="flex items-center">
                          <input
                            type="number" value={milestoneDrafts[String(m.id)]?.percent ?? m.percent ?? 0}
                            onChange={(e) => setMilestoneDrafts(prev => ({ ...prev, [String(m.id)]: { ...(prev[String(m.id)] || { desc: String(m.desc || '') }), percent: Number(e.target.value) } }))}
                            className="w-16 text-center border border-gray-300 rounded-lg py-2 text-sm outline-none focus:border-blue-500 bg-white"
                          />
                          <span className="text-gray-500 ml-1 text-sm">%</span>
                        </div>

                        <button onClick={() => saveMilestoneDraft(m.id)}
                                className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1">
                          <Check size={14}/> บันทึก
                        </button>

                        <div className="flex bg-gray-200/50 rounded-lg p-0.5 border border-gray-200">
                          <button onClick={() => setMilestoneStatus(m.id, 'pending')}
                                  className={`px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 ${m.status === 'pending' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                            <Clock size={14}/> รอตรวจ
                          </button>
                          <button onClick={() => setMilestoneStatus(m.id, 'approved')}
                                  className={`px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 ${m.status === 'approved' ? 'bg-green-500 text-white shadow-sm' : 'text-gray-500 hover:text-green-600'}`}>
                            <Check size={14}/> อนุมัติ
                          </button>
                          <button onClick={() => setMilestoneStatus(m.id, 'rejected')}
                                  className={`px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 ${m.status === 'rejected' ? 'bg-red-500 text-white shadow-sm' : 'text-gray-500 hover:text-red-600'}`}>
                            <XCircle size={14}/> ไม่อนุมัติ
                          </button>
                        </div>
                        <button onClick={() => deleteMilestone(m.id)} className="text-gray-400 hover:text-red-500 p-1"><X size={16}/></button>
                      </div>
                    </div>

                    <div className="pl-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                      <Input
                        label="วันที่สั่ง"
                        type="date"
                        value={m.assignDate || ''}
                        onChange={(e) => setMilestoneDate(m.id, 'assignDate', e.target.value)}
                      />
                      <Input
                        label="กำหนดส่ง"
                        type="date"
                        value={m.dueDate || ''}
                        onChange={(e) => setMilestoneDate(m.id, 'dueDate', e.target.value)}
                      />
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-gray-700">กำหนดระยะเวลาเร็ว</span>
                        <div className="flex flex-wrap gap-1.5">
                          {[3, 7, 14, 30].map(days => (
                            <button key={days} onClick={() => setMilestoneDuration(m.id, days)}
                              className="px-2.5 py-2 text-xs rounded-lg border border-gray-200 bg-white hover:border-blue-300 hover:text-blue-600">
                              {days} วัน
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {(m.assignDate || m.dueDate) && (
                      <div className="pl-8 flex flex-wrap gap-2 text-xs items-center">
                        {m.assignDate && <span className="text-gray-500">วันที่สั่ง: <b className="text-gray-700">{formatThaiDate(m.assignDate)}</b></span>}
                        {m.dueDate && <span className="text-gray-500">กำหนดส่ง: <b className="text-gray-700">{formatThaiDate(m.dueDate)}</b></span>}
                        {deadline && <span className={`px-2.5 py-1 rounded-full border font-semibold ${deadline.className}`}><Clock size={12} className="inline mr-1"/>{deadline.text}</span>}
                      </div>
                    )}
                  </div>
                  );
                })}
                
                <div className="flex justify-end pt-2 text-sm">
                  <span className={`font-medium ${activeGroup.milestones.reduce((s, m)=>s+Number(m.percent),0) === 100 ? 'text-green-600' : 'text-amber-500'}`}>
                    ผลรวมน้ำหนัก: {activeGroup.milestones.reduce((s, m)=>s+Number(m.percent),0)}% (ควรจัดให้ครบ 100%)
                  </span>
                </div>
              </div>
            </div>
            
            <div className="mt-2 pt-6 border-t border-gray-100">
               <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
                  <LinkIcon size={20} className="text-blue-600"/> ลิงก์ส่งงานนักศึกษา
                </h3>
                {db.submissions?.filter(s => s.groupId === activeGroup.id).length > 0 ? (
                  <div className="space-y-2">
                    {db.submissions.filter(s => s.groupId === activeGroup.id).map((submission) => (
                       <a key={submission.id} href={submission.url} target="_blank" rel="noreferrer" className="block p-3 bg-blue-50 border border-blue-100 rounded-lg text-blue-700 text-sm hover:underline hover:bg-blue-100 break-all">
                          {submission.url}
                       </a>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-500 text-center bg-gray-50 p-4 rounded-lg">ยังไม่มีการส่งลิงก์งาน</p>}
            </div>
          </Card>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200 p-10 min-h-[400px]">
             <Users size={48} className="mb-4 opacity-50"/>
             <p>เลือกหรือสร้างกลุ่มโครงงานเพื่อจัดการข้อมูล</p>
          </div>
        )}
      </div>

      {!adminMode && <Modal isOpen={isPasswordModalOpen} onClose={() => { setIsPasswordModalOpen(false); setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword(''); }} title="เปลี่ยนรหัสผ่านอาจารย์">
        <div className="space-y-4">
          <Input label="รหัสผ่านปัจจุบัน" type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} placeholder="กรอกรหัสผ่านปัจจุบัน"/>
          <Input label="รหัสผ่านใหม่" type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร"/>
          <Input label="ยืนยันรหัสผ่านใหม่" type="password" value={confirmNewPassword} onChange={e=>setConfirmNewPassword(e.target.value)} placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"/>
          <div className="flex justify-end gap-2 pt-3"><Button variant="secondary" onClick={()=>setIsPasswordModalOpen(false)}>ยกเลิก</Button><Button onClick={changeTeacherPassword}>บันทึกรหัสผ่านใหม่</Button></div>
        </div>
      </Modal>}

      {!adminMode && <Modal isOpen={isGroupTemplateModalOpen} onClose={() => setIsGroupTemplateModalOpen(false)} title="คัดลอกกลุ่มจากอาจารย์ท่านอื่น">
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-800">เลือกกลุ่มนักศึกษาที่มีอยู่แล้วมาเป็นต้นแบบ</p>
            <p className="text-xs text-blue-700 mt-1">ระบบจะคัดลอกชื่อกลุ่ม ระดับชั้น ห้อง และสมาชิกมาให้คุณตรวจสอบก่อนบันทึก โดยไม่คัดลอกผลประเมิน กำหนดส่ง หรือลิงก์งานของอาจารย์ต้นฉบับ</p>
            <p className="text-xs text-blue-700 mt-1 font-medium">กลุ่มที่คุณคัดลอกแล้ว หรือมีกลุ่มของคุณที่มีนักศึกษาซ้ำอยู่แล้ว จะถูกซ่อนจากรายการนี้โดยอัตโนมัติ</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">เลือกจากอาจารย์</label>
            <select
              value={groupTemplateTeacherFilter}
              onChange={e => setGroupTemplateTeacherFilter(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">อาจารย์ทั้งหมด</option>
              {groupTemplateTeacherOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
            {visibleGroupTemplates.length > 0 ? visibleGroupTemplates.map(source => (
              <div key={source.id} className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 break-words">{source.name || 'ไม่ระบุชื่อกลุ่ม'}</p>
                    <p className="text-xs text-blue-600 mt-1">เจ้าของกลุ่ม: {getTeacherDisplayName(source.teacherId)}</p>
                    <p className="text-xs text-gray-500 mt-1">{source.level || '-'} / ห้อง {source.room || '-'} • สมาชิก {(source.members || []).length} คน</p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {(source.members || []).map(mid => (
                        <span key={mid} className="text-[11px] bg-gray-100 border border-gray-200 text-gray-700 px-2 py-1 rounded-full">{getStudentName(mid)}</span>
                      ))}
                    </div>
                  </div>
                  <Button onClick={() => useGroupAsTemplate(source.id)} className="text-xs py-1.5 shrink-0"><Copy size={14}/> ใช้กลุ่มนี้</Button>
                </div>
              </div>
            )) : (
              <div className="text-center text-gray-500 py-10 border border-dashed border-gray-200 rounded-xl">
                <Users size={34} className="mx-auto mb-2 text-gray-300"/>
                <p className="font-medium">ไม่มีกลุ่มต้นแบบที่ยังสามารถคัดลอกได้</p>
                <p className="text-xs mt-1">กลุ่มที่เคยคัดลอกแล้วหรือมีนักศึกษาซ้ำกับกลุ่มของคุณจะไม่แสดง เพื่อป้องกันข้อมูลซ้ำซ้อน</p>
              </div>
            )}
          </div>
        </div>
      </Modal>}

      <Modal isOpen={isGroupModalOpen} onClose={() => setIsGroupModalOpen(false)} title={groupForm.id ? 'แก้ไขกลุ่ม' : 'สร้างกลุ่มโครงงาน'}>
        <div className="space-y-4">
          <Input label="ชื่อกลุ่มโครงงาน / หัวข้อที่รับผิดชอบ" value={groupForm.name} onChange={e => setGroupForm({...groupForm, name: e.target.value})} placeholder="เช่น โครงงานระบบร้านค้า (ส่วน Frontend)" />
          {adminMode && <Select label="อาจารย์ผู้ควบคุม" value={groupForm.teacherId || ''} onChange={e => setGroupForm({...groupForm, teacherId:e.target.value})} options={db.users.filter(u=>u.role==='teacher').map(t=>({value:String(t.id ?? ''),label:`${t.title}${t.fname} ${t.lname} (${t.id})`}))} placeholder="เลือกอาจารย์ผู้ควบคุม" />}
          <div className="grid grid-cols-2 gap-4">
            <Select label="ระดับชั้น" value={groupForm.level} onChange={e => setGroupForm({...groupForm, level: e.target.value, members: []})} options={LEVELS} />
            <Select label={groupForm.allowCrossRoom ? 'ห้องหลัก' : 'ห้อง'} value={groupForm.room} onChange={e => setGroupForm(p => ({...p, room: e.target.value, members: p.allowCrossRoom ? p.members : []}))} options={ROOMS} />
          </div>
          <div className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${groupForm.allowCrossRoom ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
            <div>
              <p className="text-sm font-semibold text-gray-800">โหมดร่วมห้อง</p>
              <p className="text-xs text-gray-500 mt-0.5">เปิดเพื่อเลือกนักศึกษาห้องอื่นในระดับชั้นเดียวกันมาอยู่กลุ่มเดียวกัน</p>
            </div>
            <Button variant={groupForm.allowCrossRoom ? 'primary' : 'secondary'} onClick={toggleCrossRoom} className="shrink-0">
              <Users size={16}/> {groupForm.allowCrossRoom ? 'ร่วมห้อง: เปิด' : 'ร่วมห้อง'}
            </Button>
          </div>
          <div className="pt-2 border-t border-gray-100">
             <div className="flex justify-between items-center mb-2"><p className="text-sm font-medium">เลือกนักศึกษาเข้ากลุ่ม</p><span className={`text-xs font-semibold ${groupForm.members.length>=10?'text-red-500':'text-gray-400'}`}>{groupForm.members.length}/10 คน</span></div>
             <div className="flex flex-wrap gap-2 mb-3">
              {groupForm.members.map(mid => (
                <div key={mid} className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-2 py-1 rounded-md flex items-center gap-1">
                  {getStudentName(mid)} <span className="text-blue-500">• ห้อง {getStudentRoom(mid)}</span>
                  <button onClick={() => setGroupForm(p => ({...p, members: p.members.filter(id=>String(id)!==String(mid))}))} className="text-blue-400 hover:text-red-500"><X size={14}/></button>
                </div>
              ))}
            </div>
            <input 
              type="text" placeholder="ค้นหาด้วยรหัส ชื่อ หรือนามสกุล..." value={searchStudent} onChange={e => setSearchStudent(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {groupForm.allowCrossRoom && <p className="text-xs text-blue-600 mt-1">กำลังค้นหานักศึกษาทุกห้องในระดับ {groupForm.level}</p>}
            {searchStudent && (
              <div className="mt-1 border border-gray-200 rounded-lg shadow-sm max-h-40 overflow-y-auto bg-white">
                {db.users.filter(u => {
                  const normalize = (value) => String(value ?? '').normalize('NFC').toLowerCase().replace(/[\s.\-_\/]+/g, '');
                  const q = normalize(searchStudent);
                  const sameLevel = normalize(u.level) === normalize(groupForm.level);
                  const sameRoom = normalize(u.room) === normalize(groupForm.room);
                  const roomAllowed = groupForm.allowCrossRoom ? true : sameRoom;
                  const haystack = normalize(`${u.id} ${u.title || ''} ${u.fname || ''} ${u.lname || ''}`);
                  return u.role === 'student' && sameLevel && roomAllowed && !groupForm.members.some(mid => String(mid) === String(u.id)) && haystack.includes(q);
                }).map(student => (
                  <div key={student.id} onClick={() => { if(groupForm.members.length>=10) return showToast('1 กลุ่มมีสมาชิกได้ไม่เกิน 10 คน','error'); setGroupForm(p => ({...p, members: [...p.members, String(student.id)]})); setSearchStudent(''); }} className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>{student.fname} {student.lname} ({student.id})</span>
                      <span className="text-xs text-gray-400 shrink-0">ห้อง {student.room || '-'}</span>
                    </div>
                  </div>
                ))}
                {db.users.filter(u => {
                  const normalize = (value) => String(value ?? '').normalize('NFC').toLowerCase().replace(/[\s.\-_\/]+/g, '');
                  const q = normalize(searchStudent);
                  const sameLevel = normalize(u.level) === normalize(groupForm.level);
                  const sameRoom = normalize(u.room) === normalize(groupForm.room);
                  const roomAllowed = groupForm.allowCrossRoom ? true : sameRoom;
                  const haystack = normalize(`${u.id} ${u.title || ''} ${u.fname || ''} ${u.lname || ''}`);
                  return u.role === 'student' && sameLevel && roomAllowed && !groupForm.members.some(mid => String(mid) === String(u.id)) && haystack.includes(q);
                }).length === 0 && (
                   <p className="px-4 py-3 text-sm text-gray-500 text-center">ไม่พบรายชื่อนักศึกษา</p>
                )}
              </div>
            )}
          </div>
          <Button onClick={handleSaveGroup} className="w-full mt-2">บันทึกกลุ่ม</Button>
        </div>
      </Modal>

      <Modal isOpen={isTemplateModalOpen} onClose={() => setIsTemplateModalOpen(false)} title="เลือกเทมเพลตรายการประเมิน">
         <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">เลือกจากอาจารย์</label>
              <select
                value={templateTeacherFilter}
                onChange={e => setTemplateTeacherFilter(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">อาจารย์ทั้งหมด</option>
                {teacherTemplateOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-2">สามารถเลือกใช้เทมเพลตของอาจารย์ท่านอื่นได้ โดยต้นฉบับจะไม่ถูกแก้ไข</p>
            </div>

            {visibleTemplates.length > 0 ? visibleTemplates.map(tpl => (
              <div key={tpl.id} className="border border-gray-200 p-4 rounded-lg hover:border-blue-300 transition-colors flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                 <div>
                    <p className="font-semibold text-gray-800">{tpl.name}</p>
                    <p className="text-xs text-blue-600 mt-1">เจ้าของ: {getTeacherDisplayName(tpl.teacherId)}</p>
                    <p className="text-xs text-gray-500 mt-1">{tpl.milestones?.length || 0} รายการประเมิน</p>
                 </div>
                 <Button onClick={() => loadTemplate(tpl.id)} className="text-xs py-1.5 shrink-0">ใช้เทมเพลตนี้</Button>
              </div>
            )) : (
              <div className="text-center text-gray-500 py-8">
                <p className="font-medium">ยังไม่มีเทมเพลตในรายการที่เลือก</p>
                <p className="text-xs mt-1">เลือกอาจารย์ท่านอื่น หรือบันทึกเทมเพลตใหม่ก่อน</p>
              </div>
            )}
         </div>
      </Modal>
    </div>
  );
};

const ProgressDashboard = ({ db, targetStudent, isParent = false, handleUpdate, showToast, askPrompt }) => {
  const myProjects = db.groups.filter(g => (g.members || []).some(id => String(id) === String(targetStudent?.id || '')));
  
  if (!targetStudent) return null;

  const calculateTotalOverallProgress = () => {
    if (myProjects.length === 0) return 0;
    const totalProgress = myProjects.reduce((sum, p) => sum + calculateGroupProgress(p.milestones), 0);
    return totalProgress / myProjects.length;
  };

  const getTeacherName = (tId) => {
    const t = db.users.find(u => u.role === 'teacher' && String(u.id) === String(tId));
    return t ? `${t.title}${t.fname} ${t.lname}` : 'ไม่ระบุ';
  };

  const submitLink = (groupId) => {
    askPrompt('กรุณาวาง URL/Link งานที่ต้องการส่ง', async (url) => {
      if(!url) return;
      if(!url.startsWith('http')) return showToast('รูปแบบ Link ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http)', 'error');
      const submission = {
        id: makeEntityId('sub'),
        groupId,
        studentId: String(targetStudent.id),
        url,
        createdAt: Date.now()
      };
      const ok = await handleUpdate('submissions', [...(db.submissions || []), submission]);
      if (ok) showToast('ส่งลิงก์งานเรียบร้อยแล้ว');
    });
  }

  const overallProgress = calculateTotalOverallProgress();
  const hasAnyRejection = myProjects.some(p => hasRejectedMilestone(p.milestones));
  const sameLevelGroups = db.groups.filter(g => normalizeMatchText(g.level) === normalizeMatchText(targetStudent.level));
  const sameLevelRooms = [...new Set(sameLevelGroups.map(g => g.room))].sort();
  const allLevels = db.catalogs?.levels?.length ? db.catalogs.levels : DEFAULT_LEVELS;
  const parentLevelSummary = allLevels.map(level => {
    const gs = db.groups.filter(g => normalizeMatchText(g.level) === normalizeMatchText(level));
    return { level, count: gs.length, progress: gs.length ? gs.reduce((sum,g)=>sum+calculateGroupProgress(g.milestones||[]),0)/gs.length : 0 };
  });

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white !border-none">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold">{targetStudent.title}{targetStudent.fname} {targetStudent.lname}</h2>
            <p className="text-blue-100 opacity-90 flex items-center gap-2 mt-1 text-sm">
              <UserCircle size={16}/> รหัส: {targetStudent.id}  |  ชั้น: {targetStudent.level} ห้อง {targetStudent.room}
            </p>
          </div>
          {isParent && <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm">โหมดผู้ปกครอง (Parent)</span>}
        </div>
      </Card>

      {isParent ? (
        <Card>
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><BarChart3 size={18} className="text-blue-600"/> ภาพรวมทุกระดับชั้น</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {parentLevelSummary.map(x => <div key={x.level} className="p-3 rounded-xl bg-gray-50 border border-gray-100"><div className="flex justify-between text-xs mb-2"><span className="font-semibold">{x.level}</span><span className="text-gray-400">{x.count} กลุ่ม</span></div><ProgressBar percent={x.progress}/></div>)}
          </div>
        </Card>
      ) : (
        <Card>
          <h3 className="font-bold text-gray-800 mb-1">ภาพรวมระดับชั้น {targetStudent.level}</h3>
          <p className="text-xs text-gray-500 mb-4">เห็นเฉพาะกลุ่มในระดับชั้นเดียวกัน โดยรวมทุกห้องของเพื่อนร่วมระดับ</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {sameLevelRooms.map(room => { const gs=sameLevelGroups.filter(g=>normalizeMatchText(g.room)===normalizeMatchText(room)); const p=gs.length?gs.reduce((a,g)=>a+calculateGroupProgress(g.milestones||[]),0)/gs.length:0; return <div key={room} className="p-3 rounded-xl bg-gray-50 border border-gray-100"><p className="text-sm font-bold mb-2">ห้อง {room} <span className="text-xs font-normal text-gray-400">({gs.length} กลุ่ม)</span></p><ProgressBar percent={p}/></div> })}
            {!sameLevelRooms.length && <p className="text-sm text-gray-400">ยังไม่มีข้อมูลภาพรวมระดับชั้น</p>}
          </div>
        </Card>
      )}

      {myProjects.length > 0 ? (
        <div className="space-y-6">
          
          <Card className="bg-white border-blue-100 shadow-md">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <BarChart3 className="text-blue-600"/> สรุปความคืบหน้าโครงงานบูรณาการ (รวมทุกรายวิชา)
            </h3>
            
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <div className="w-full md:w-2/3">
                 <ProgressBar percent={overallProgress} />
                 <p className="text-xs text-gray-500 mt-2">คำนวณจากโครงงาน/รายวิชาที่รับผิดชอบทั้งหมด {myProjects.length} กลุ่ม</p>
              </div>
              <div className="w-full md:w-1/3">
                 {hasAnyRejection ? (
                    <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-start gap-3">
                       <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20}/>
                       <div>
                         <p className="text-sm font-bold text-red-700">⚠️ แจ้งเตือนสิทธิ์สอบนำเสนอ</p>
                         <p className="text-xs text-red-600 mt-1">มีบางรายวิชา ยังไม่ผ่านการอนุมัติ ซึ่งอาจส่งผลให้ หมดสิทธิ์สอบนำเสนอ กรุณาติดต่ออาจารย์ผู้สอนโดยเร็วเพื่อดำเนินการให้เรียบร้อย</p>
                       </div>
                    </div>
                 ) : (overallProgress === 100 ? (
                    <div className="bg-green-50 border border-green-200 p-4 rounded-xl flex items-center gap-3">
                       <CheckCircle className="text-green-600 flex-shrink-0" size={24}/>
                       <p className="text-sm font-bold text-green-800">ผ่านการอนุมัติครบทุกส่วน เตรียมตัวสอบนำเสนอได้</p>
                    </div>
                 ) : (
                    <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                       <p className="text-sm font-semibold text-blue-800">สถานะปกติ</p>
                       <p className="text-xs text-blue-600 mt-1">กำลังดำเนินการตามแผนโครงงาน</p>
                    </div>
                 ))}
              </div>
            </div>
          </Card>

          <h3 className="text-lg font-bold text-gray-700 pt-4 px-2">แยกตามรายวิชา / อาจารย์ผู้ควบคุม</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {myProjects.map(group => {
              const prog = calculateGroupProgress(group.milestones);
              const isRejected = hasRejectedMilestone(group.milestones);
              const nearestDeadlineMilestone = getNearestDeadlineMilestone(group.milestones || []);
              const nearestDeadline = nearestDeadlineMilestone ? getDeadlineInfo(nearestDeadlineMilestone) : null;

              return (
                <Card key={group.id} className={isRejected ? 'border-red-300 ring-1 ring-red-100' : ''}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-800 line-clamp-1" title={group.name}>{group.name}</h3>
                      <p className="text-sm font-medium text-blue-600 mt-0.5 flex items-center gap-1">
                        <Users size={14}/> ประเมินโดย: {getTeacherName(group.teacherId)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <span className={`text-xl font-bold ${getProgressColor(prog).replace('bg-', 'text-')}`}>{prog}%</span>
                    </div>
                  </div>

                  {nearestDeadlineMilestone && nearestDeadline && (
                    <div className={`mb-4 p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${nearestDeadline.className}`}>
                      <div className="flex items-start gap-2">
                        <Clock size={18} className="mt-0.5 flex-shrink-0"/>
                        <div>
                          <p className="text-sm font-semibold">งานที่ต้องติดตาม: {nearestDeadlineMilestone.desc}</p>
                          <p className="text-xs opacity-80 mt-0.5">กำหนดส่ง {formatThaiDate(nearestDeadlineMilestone.dueDate)}</p>
                        </div>
                      </div>
                      <span className="text-sm font-bold whitespace-nowrap">{nearestDeadline.text}</span>
                    </div>
                  )}

                  <div className="mb-6">
                    <ProgressBar percent={prog} />
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">รายละเอียดการประเมิน</p>
                    {group.milestones.length > 0 ? group.milestones.map((m, idx) => {
                      const deadline = getDeadlineInfo(m);
                      return (
                      <div key={m.id} className={`p-3 rounded-lg text-sm border ${
                        deadline?.diffDays != null && deadline.diffDays < 0 && m.status !== 'approved'
                          ? 'bg-red-50/60 border-red-200'
                          : 'bg-gray-50 border-gray-100'
                      }`}>
                        <div className="flex gap-3 items-start">
                          <div className={`flex-shrink-0 w-6 h-6 mt-0.5 rounded-full flex items-center justify-center text-white
                            ${m.status === 'approved' ? 'bg-green-500' : m.status === 'rejected' ? 'bg-red-500' : 'bg-gray-300'}`}>
                            {m.status === 'approved' ? <Check size={14}/> : m.status === 'rejected' ? <X size={14}/> : <Clock size={14}/>}
                          </div>
                          <div className="flex-grow min-w-0">
                            <p className={`font-medium ${m.status === 'rejected' ? 'text-red-600 line-through opacity-80' : 'text-gray-700'}`}>{m.desc}</p>
                            {(m.assignDate || m.dueDate) && (
                              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
                                {m.assignDate && <span>วันที่สั่ง: {formatThaiDate(m.assignDate)}</span>}
                                {m.dueDate && <span>กำหนดส่ง: <b className="text-gray-700">{formatThaiDate(m.dueDate)}</b></span>}
                              </div>
                            )}
                            {deadline && (
                              <span className={`inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-full border text-xs font-semibold ${deadline.className}`}>
                                <Clock size={12}/> {deadline.text}
                              </span>
                            )}
                          </div>
                          <div className="flex-shrink-0 text-xs">
                             {m.status === 'approved' && <span className="text-green-600 font-bold">+{m.percent}%</span>}
                             {m.status === 'rejected' && <span className="text-red-500 font-bold bg-red-100 px-2 py-0.5 rounded">ไม่อนุมัติ</span>}
                             {m.status === 'pending' && <span className="text-gray-400">รอตรวจ</span>}
                          </div>
                        </div>
                      </div>
                      );
                    }) : <p className="text-sm text-gray-400 text-center py-2">อาจารย์ยังไม่ได้กำหนดรายการประเมิน</p>}
                  </div>

                  {!isParent && (
                    <div className="mt-5 pt-4 border-t border-gray-100 space-y-3">
                      {db.submissions?.filter(s => s.groupId === group.id && s.studentId === targetStudent.id).length > 0 && (
                        <div className="space-y-2">
                           <p className="text-xs font-semibold text-gray-500 uppercase">ลิงก์ที่ส่งแล้ว</p>
                           {db.submissions.filter(s => s.groupId === group.id && s.studentId === targetStudent.id).map((submission) => (
                              <a key={submission.id} href={submission.url} target="_blank" rel="noreferrer" className="block text-xs bg-blue-50 text-blue-700 p-2 rounded truncate hover:underline">
                                 {submission.url}
                              </a>
                           ))}
                        </div>
                      )}
                      <Button variant="secondary" className="w-full text-sm" onClick={() => submitLink(group.id)}>
                        <LinkIcon size={16}/> ส่งลิงก์งานให้ {getTeacherName(group.teacherId)}
                      </Button>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>

        </div>
      ) : (
        <Card className="text-center py-16">
          <Users size={48} className="mx-auto text-gray-300 mb-4"/>
          <h3 className="text-xl font-semibold text-gray-700">ยังไม่มีกลุ่มโครงงาน</h3>
          <p className="text-gray-500 mt-2">ระบบบูรณาการยังไม่ได้จัดสรรกลุ่มให้คุณ โปรดรออาจารย์ผู้ควบคุมดำเนินการ</p>
        </Card>
      )}
    </div>
  );
};

const ParentShareView = ({ db, targetStudent, onBack = null }) => {
  if (!targetStudent) return null;
  const groups = (db.groups || [])
    .filter(g => (g.members || []).some(id => String(id) === String(targetStudent.id)))
    .sort((a, b) => {
      const levelCompare = getLevelSortIndex(a.level) - getLevelSortIndex(b.level);
      if (levelCompare !== 0) return levelCompare;
      const roomCompare = compareRoomValue(a.room, b.room);
      if (roomCompare !== 0) return roomCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), 'th', { numeric: true });
    });
  const overall = groups.length ? groups.reduce((sum, g) => sum + calculateGroupProgress(g.milestones || []), 0) / groups.length : 0;
  const teacherName = id => {
    const t = (db.users || []).find(u => u.role === 'teacher' && String(u.id) === String(id));
    return t ? `${t.title || ''}${t.fname || ''} ${t.lname || ''}`.trim() : 'ไม่ระบุ';
  };

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-8 sm:py-12">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-3xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white px-6 sm:px-8 py-7">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-blue-100 text-sm">DMD Integrated Project Tracking System</p>
                <h1 className="text-2xl font-bold mt-1">ข้อมูลติดตามโครงงานสำหรับผู้ปกครอง</h1>
              </div>
              <div className="flex items-center gap-2">
                {onBack && <button type="button" onClick={onBack} className="bg-white/15 hover:bg-white/25 border border-white/20 rounded-xl px-3 py-2 text-sm transition">ค้นหานักศึกษาคนอื่น</button>}
                <div className="bg-white/15 border border-white/20 rounded-xl px-3 py-2 text-sm">อ่านข้อมูลอย่างเดียว</div>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-7">
            <section className="border-b border-gray-100 pb-6">
              <h2 className="text-xl font-bold text-gray-900">{targetStudent.title || ''}{targetStudent.fname || ''} {targetStudent.lname || ''}</h2>
              <p className="text-sm text-gray-500 mt-1">รหัสนักศึกษา {targetStudent.id} • {targetStudent.level || '-'} / ห้อง {targetStudent.room || '-'}</p>
              <div className="mt-5 max-w-xl"><ProgressBar percent={overall}/></div>
              <p className="text-xs text-gray-400 mt-2">สรุปจากกลุ่มโครงงานที่นักศึกษามีชื่ออยู่ทั้งหมด {groups.length} กลุ่ม</p>
            </section>

            <section className="space-y-4">
              <h3 className="font-bold text-gray-800 text-lg">รายละเอียดโครงงาน</h3>
              {groups.map(group => {
                const progress = calculateGroupProgress(group.milestones || []);
                const nearest = getNearestDeadlineMilestone(group.milestones || []);
                const deadline = nearest ? getDeadlineInfo(nearest) : null;
                return <div key={group.id} className="rounded-2xl border border-gray-200 p-5 bg-gray-50/60">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-gray-900">{group.name}</h4>
                      <p className="text-sm text-blue-600 mt-1">อาจารย์ผู้ควบคุม: {teacherName(group.teacherId)}</p>
                    </div>
                    <span className="text-lg font-bold text-gray-800">{progress.toFixed(0)}%</span>
                  </div>
                  <div className="mt-4"><ProgressBar percent={progress}/></div>
                  {nearest && deadline && <div className={`mt-4 p-3 rounded-xl border text-sm ${deadline.className}`}><b>{nearest.desc}</b><div className="text-xs mt-1">กำหนดส่ง {formatThaiDate(nearest.dueDate)} • {deadline.text}</div></div>}
                  <div className="mt-4 space-y-2">
                    {(group.milestones || []).map(m => <div key={m.id} className="flex items-start justify-between gap-3 text-sm bg-white rounded-xl border border-gray-100 px-3 py-2.5">
                      <div className="min-w-0"><p className="font-medium text-gray-700">{m.desc || '-'}</p>{m.dueDate && <p className="text-xs text-gray-400 mt-0.5">กำหนดส่ง {formatThaiDate(m.dueDate)}</p>}</div>
                      <span className={`text-xs font-semibold whitespace-nowrap ${m.status === 'approved' ? 'text-green-600' : m.status === 'rejected' ? 'text-red-600' : 'text-gray-500'}`}>{milestoneStatusLabel(m.status)}</span>
                    </div>)}
                    {!(group.milestones || []).length && <p className="text-sm text-gray-400">ยังไม่มีรายการประเมิน</p>}
                  </div>
                </div>;
              })}
              {!groups.length && <div className="text-center py-10 text-gray-400">ยังไม่มีกลุ่มโครงงานของนักศึกษาคนนี้</div>}
            </section>

            <div className="pt-2 border-t border-gray-100 text-center text-xs text-gray-400">ระบบสำหรับผู้ปกครองติดตามความคืบหน้าของนักศึกษาโดยตรง</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [db, setDb] = useState({ users: [], groups: [], templates: [], submissions: [], catalogs: { levels: DEFAULT_LEVELS, rooms: DEFAULT_ROOMS } });
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [parentSelectedStudentId, setParentSelectedStudentId] = useState('');
  const [parentPortalMode] = useState(() => new URLSearchParams(window.location.search).get('parent') === '1');
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [pendingTeacherSetup, setPendingTeacherSetup] = useState(null);
  const [firstPassword, setFirstPassword] = useState('');
  const [confirmFirstPassword, setConfirmFirstPassword] = useState('');
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, msg: '', onConfirm: null });
  const [promptDialog, setPromptDialog] = useState({ isOpen: false, title: '', onSubmit: null, value: '' });
  const [systemHealth, setSystemHealth] = useState(null);
  const writeQueueRef = useRef(Promise.resolve());
  const realtimeUnsubsRef = useRef([]);
  const dbRef = useRef(db);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };
  const askConfirm = (msg, onConfirm) => setConfirmDialog({ isOpen: true, msg, onConfirm });
  const askPrompt = (title, onSubmit) => setPromptDialog({ isOpen: true, title, onSubmit, value: '' });

  const clean = value => JSON.parse(JSON.stringify(value ?? null));
  const safeDocId = value => String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || `id_${Date.now()}`;
  const normalizeUserId = value => String(value ?? '').trim();
  const logicalUserKey = user => `${String(user?.role || '').trim().toLowerCase()}:${normalizeUserId(user?.id).toLowerCase()}`;
  const canonicalUserDocId = user => String(user?.role || '').trim().toLowerCase() === 'admin'
    ? 'admin_default'
    : `${String(user?.role || '').trim().toLowerCase()}_${safeDocId(normalizeUserId(user?.id))}`;

  const toMillis = value => {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const normalizeUsersData = usersRaw => {
    const levelOptions = dbRef.current?.catalogs?.levels?.length ? dbRef.current.catalogs.levels : DEFAULT_LEVELS;
    const roomOptions = dbRef.current?.catalogs?.rooms?.length ? dbRef.current.catalogs.rooms : DEFAULT_ROOMS;
    const normalized = (usersRaw || [])
      .filter(u => u.role !== 'disabled' && u.active !== false)
      .map(u => {
        const base = { ...u, id: normalizeUserId(u.id), uid: u._docId || u.uid };
        return u.role === 'student' ? { ...base, level:canonicalFromList(u.level, levelOptions, String(u.level || '')), room:canonicalFromList(u.room, roomOptions, String(u.room || '')) } : base;
      })
      .filter(u => u.id && u.role)
      .sort((a, b) => toMillis(a.updatedAt || a.createdAt) - toMillis(b.updatedAt || b.createdAt));
    const byKey = new Map();
    for (const u of normalized) {
      const key = logicalUserKey(u);
      const before = byKey.get(key);
      byKey.set(key, before ? { ...before, ...u, id: normalizeUserId(u.id), uid: u._docId || u.uid, _docId: u._docId || u.uid } : u);
    }
    return [...byKey.values()];
  };

  const normalizeGroupsData = groupsRaw => {
    const levelOptions = dbRef.current?.catalogs?.levels?.length ? dbRef.current.catalogs.levels : DEFAULT_LEVELS;
    const roomOptions = dbRef.current?.catalogs?.rooms?.length ? dbRef.current.catalogs.rooms : DEFAULT_ROOMS;
    return (groupsRaw || []).map(g => ({
      ...g,
      id: String(g.id ?? g._docId),
      teacherId: g.teacherId != null ? String(g.teacherId).trim() : '',
      level:canonicalFromList(g.level, levelOptions, String(g.level || '')),
      room:canonicalFromList(g.room, roomOptions, String(g.room || '')),
      members: Array.from(new Set((g.members || []).map(id => String(id).trim()).filter(Boolean))),
      milestones: Array.isArray(g.milestones) ? g.milestones : []
    }));
  };

  const normalizeTemplatesData = rows => (rows || []).map(t => ({
    ...t,
    id: String(t.id ?? t._docId),
    teacherId: t.teacherId != null ? String(t.teacherId).trim() : '',
    milestones: Array.isArray(t.milestones) ? t.milestones : []
  }));

  const normalizeSubmissionsData = rows => (rows || []).map(s => ({
    ...s,
    id: String(s.id ?? s._docId),
    groupId: s.groupId != null ? String(s.groupId).trim() : '',
    studentId: s.studentId != null ? String(s.studentId).trim() : ''
  }));

  const commitOperations = async operations => {
    const ops = (operations || []).filter(Boolean);
    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(firestore);
      for (const op of ops.slice(i, i + 400)) {
        if (op.type === 'delete') batch.delete(op.ref);
        else if (op.type === 'update') batch.update(op.ref, op.data);
        else batch.set(op.ref, op.data, op.options || {});
      }
      await batch.commit();
    }
  };

  const getDocsArray = async name => {
    const snap = await getDocs(collection(firestore, name));
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  };

  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} ใช้เวลานานเกินไป`)), ms))
  ]);

  const ensureAnonymousSession = async () => {
    if (auth.currentUser?.isAnonymous) return auth.currentUser;
    const cred = await withTimeout(signInAnonymously(auth), 10000, 'การเชื่อมต่อระบบ');
    return cred.user;
  };

  const ensureBaseData = async () => {
    // v8.0.2: ห้ามสแกน users ทั้ง collection ตอนเปิดเว็บ
    // เดิม getDocs(users) ทำให้ระบบค้างเมื่อมีนักศึกษาจำนวนมาก
    const adminRef = doc(firestore, 'users', 'admin_default');
    const catalogRef = doc(firestore, 'catalogs', 'default');
    const systemRef = doc(firestore, 'system', 'app');

    const [adminSnap, catSnap] = await Promise.all([
      getDoc(adminRef),
      getDoc(catalogRef)
    ]);

    const writes = [];
    if (!adminSnap.exists()) {
      writes.push(setDoc(adminRef, {
        uid: 'admin_default',
        id: 'admin',
        role: 'admin',
        title: '',
        fname: 'ผู้จัดการ',
        lname: 'ระบบ',
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        schemaVersion: DB_SCHEMA_VERSION
      }, { merge: true }));
    }

    if (!catSnap.exists()) {
      writes.push(setDoc(catalogRef, {
        levels: DEFAULT_LEVELS,
        rooms: DEFAULT_ROOMS,
        schemaVersion: DB_SCHEMA_VERSION
      }, { merge: true }));
    }

    writes.push(setDoc(systemRef, {
      appVersion: APP_VERSION,
      schemaVersion: DB_SCHEMA_VERSION,
      activeCollections: [...ACTIVE_COLLECTIONS, 'catalogs', 'system'],
      updatedAt: Date.now()
    }, { merge: true }));

    await Promise.all(writes);
  };

  const loadAllData = async () => {
    const [usersRaw, groupsRaw, templatesRaw, submissionsRaw, catSnap] = await Promise.all([
      getDocsArray('users'),
      getDocsArray('groups'),
      getDocsArray('templates'),
      getDocsArray('submissions'),
      getDoc(doc(firestore, 'catalogs', 'default'))
    ]);

    const nextDb = {
      users: normalizeUsersData(usersRaw),
      groups: normalizeGroupsData(groupsRaw),
      templates: normalizeTemplatesData(templatesRaw),
      submissions: normalizeSubmissionsData(submissionsRaw),
      catalogs: catSnap.exists() ? catSnap.data() : { levels: DEFAULT_LEVELS, rooms: DEFAULT_ROOMS, schemaVersion: DB_SCHEMA_VERSION }
    };
    setDb(nextDb);
    return nextDb;
  };

  const subscribeRealtime = () => {
    realtimeUnsubsRef.current.forEach(unsub => { try { unsub(); } catch (_) {} });
    realtimeUnsubsRef.current = [];

    const onError = err => console.error('realtime sync', err);
    realtimeUnsubsRef.current.push(
      onSnapshot(collection(firestore, 'users'), snap => {
        const rows = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
        setDb(prev => ({ ...prev, users: normalizeUsersData(rows) }));
        setUsersLoaded(true);
      }, err => { setUsersLoaded(true); onError(err); }),
      onSnapshot(collection(firestore, 'groups'), snap => {
        const rows = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
        setDb(prev => ({ ...prev, groups: normalizeGroupsData(rows) }));
      }, onError),
      onSnapshot(collection(firestore, 'templates'), snap => {
        const rows = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
        setDb(prev => ({ ...prev, templates: normalizeTemplatesData(rows) }));
      }, onError),
      onSnapshot(collection(firestore, 'submissions'), snap => {
        const rows = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
        setDb(prev => ({ ...prev, submissions: normalizeSubmissionsData(rows) }));
      }, onError),
      onSnapshot(doc(firestore, 'catalogs', 'default'), snap => {
        if (snap.exists()) setDb(prev => ({ ...prev, catalogs: snap.data() }));
      }, onError)
    );
  };

  const restoreWebSession = nextDb => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('dmd_web_session') || 'null');
      if (!saved?.role) return;
      if (saved.role === 'admin' && String(saved.id || '').toLowerCase() === 'admin') {
        setRole('admin');
        setCurrentUser({ uid:'admin_default', id:'admin', role:'admin', title:'', fname:'ผู้จัดการ', lname:'ระบบ', active:true });
        return;
      }
      if (saved.role === 'parent') {
        const student = nextDb.users.find(u => u.role === 'student' && String(u.id) === String(saved.id));
        if (student) { setRole('parent'); setCurrentUser(student); }
        return;
      }
      const user = nextDb.users.find(u => u.role === saved.role && String(u.id).toLowerCase() === String(saved.id || '').toLowerCase());
      if (user) { setRole(saved.role); setCurrentUser(user); }
    } catch (_) {}
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await ensureAnonymousSession();
        // v8.0.3: ไม่อ่าน/เขียนฐานข้อมูลก้อนใหญ่ก่อนเปิดหน้าเว็บ
        // เปิดหน้าระบบทันทีหลัง Anonymous Auth พร้อม แล้วให้ realtime listeners โหลดข้อมูลเบื้องหลัง
        if (!cancelled) {
          subscribeRealtime();
        }
      } catch (err) {
        console.error('init', err);
        if (!cancelled) showToast(`ไม่สามารถเริ่มระบบได้: ${err?.message || err}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      realtimeUnsubsRef.current.forEach(unsub => { try { unsub(); } catch (_) {} });
      realtimeUnsubsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!currentUser || !role) return;
    const latest = db.users.find(u => u.role === currentUser.role && String(u.id) === String(currentUser.id));
    if (latest && JSON.stringify(latest) !== JSON.stringify(currentUser)) setCurrentUser(latest);
  }, [db.users, role]);

  useEffect(() => { dbRef.current = db; }, [db]);



  const syncUsers = async (nextUsers, options = {}) => {
    const forceCanonicalize = options.forceCanonicalize === true;
    const liveDb = dbRef.current;

    const localMap = new Map();
    for (const raw of liveDb.users.filter(u => ['student','teacher'].includes(u.role))) {
      const normalized = { ...clean(raw), id: normalizeUserId(raw.id) };
      if (normalized.id) localMap.set(logicalUserKey(normalized), normalized);
    }

    const nextMap = new Map();
    for (const raw of nextUsers.filter(u => ['student','teacher'].includes(u.role))) {
      const normalized = { ...clean(raw), id: normalizeUserId(raw.id) };
      if (!normalized.id) continue;
      const key = logicalUserKey(normalized);
      const before = nextMap.get(key);
      nextMap.set(key, before ? { ...before, ...normalized } : normalized);
    }

    const comparable = value => {
      const x = clean(value || {});
      ['_docId','uid','updatedAt','createdAt','email','schemaVersion'].forEach(k => delete x[k]);
      return x;
    };

    const changedKeys = new Set();
    for (const [key, nextUser] of nextMap.entries()) {
      const before = localMap.get(key);
      if (forceCanonicalize || !before || JSON.stringify(comparable(before)) !== JSON.stringify(comparable(nextUser))) changedKeys.add(key);
    }
    for (const key of localMap.keys()) if (!nextMap.has(key)) changedKeys.add(key);

    if (!changedKeys.size) return;

    const remoteSnap = await getDocs(collection(firestore, 'users'));
    const remoteUsers = remoteSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));
    const remoteByKey = new Map();
    for (const u of remoteUsers) {
      if (!['student','teacher'].includes(u.role) || !normalizeUserId(u.id)) continue;
      const key = logicalUserKey(u);
      const arr = remoteByKey.get(key) || [];
      arr.push(u);
      remoteByKey.set(key, arr);
    }

    const operations = [];
    for (const [key, u] of nextMap.entries()) {
      if (!changedKeys.has(key)) continue;
      const candidates = (remoteByKey.get(key) || []).slice().sort((a,b) => toMillis(a.updatedAt || a.createdAt) - toMillis(b.updatedAt || b.createdAt));
      let merged = {};
      for (const candidate of candidates) merged = { ...merged, ...candidate };
      merged = { ...merged, ...u };

      const docId = canonicalUserDocId(u);
      const base = {
        id: normalizeUserId(u.id),
        role: u.role,
        title: String(merged.title || ''),
        fname: String(merged.fname || ''),
        lname: String(merged.lname || ''),
        active: true,
        createdAt: toMillis(merged.createdAt) || Date.now(),
        updatedAt: Date.now(),
        schemaVersion: DB_SCHEMA_VERSION
      };
      const profile = u.role === 'student' ? {
        ...base,
        level: String(merged.level || ''),
        room: String(merged.room || ''),
      } : {
        ...base,
        teacherPasswordSet: merged.teacherPasswordSet === true,
        teacherPasswordHash: String(merged.teacherPasswordHash || ''),
        teacherPasswordSalt: String(merged.teacherPasswordSalt || ''),
        teacherTempHash: String(merged.teacherTempHash || ''),
        teacherTempSalt: String(merged.teacherTempSalt || ''),
        teacherPasswordUpdatedAt: toMillis(merged.teacherPasswordUpdatedAt) || 0
      };

      operations.push({ type:'set', ref:doc(firestore,'users',docId), data:profile });
      for (const candidate of candidates) {
        if (candidate._docId && candidate._docId !== docId) operations.push({ type:'delete', ref:doc(firestore,'users',candidate._docId) });
      }
    }

    for (const key of changedKeys) {
      if (nextMap.has(key)) continue;
      for (const candidate of remoteByKey.get(key) || []) {
        if (candidate._docId) operations.push({ type:'delete', ref:doc(firestore,'users',candidate._docId) });
      }
    }

    await commitOperations(operations);
  };

  const syncGroups = async nextGroups => {
    const liveDb = dbRef.current;
    const normalizeGroup = g => ({
      ...clean(g),
      id: String(g.id),
      teacherId: g.teacherId != null ? String(g.teacherId).trim() : '',
      members: Array.from(new Set((g.members || []).map(id => String(id).trim()).filter(Boolean)))
    });
    const core = g => {
      const x = normalizeGroup(g);
      ['updatedAt','createdAt','_docId','schemaVersion','teacherName','teacherUid','memberUids'].forEach(k => delete x[k]);
      return x;
    };

    const prevMap = new Map(liveDb.groups.map(g => [String(g.id), g]));
    const nextMap = new Map(nextGroups.map(g => [String(g.id), normalizeGroup(g)]));
    const operations = [];

    for (const [id, g] of nextMap.entries()) {
      const before = prevMap.get(id);
      if (before && JSON.stringify(core(before)) === JSON.stringify(core(g))) continue;
      const teacher = liveDb.users.find(u => u.role === 'teacher' && String(u.id) === String(g.teacherId));
      const canonical = {
        id,
        name: String(g.name || ''),
        teacherId: String(g.teacherId || ''),
        teacherName: teacher ? `${teacher.title || ''}${teacher.fname || ''} ${teacher.lname || ''}`.trim() : String(g.teacherName || ''),
        level: String(g.level || ''),
        room: String(g.room || ''),
        members: g.members || [],
        milestones: Array.isArray(g.milestones) ? g.milestones : [],
        links: Array.isArray(g.links) ? g.links : [],
        createdAt: toMillis(before?.createdAt || g.createdAt) || Date.now(),
        updatedAt: Date.now(),
        schemaVersion: DB_SCHEMA_VERSION
      };
      operations.push({ type:'set', ref:doc(firestore,'groups',id), data:canonical });
    }

    for (const [id] of prevMap.entries()) {
      if (!nextMap.has(id)) operations.push({ type:'delete', ref:doc(firestore,'groups',id) });
    }
    await commitOperations(operations);
  };

  const syncSimpleCollection = async (name, prev, next) => {
    const cleanCore = item => {
      const x = clean(item);
      ['updatedAt','createdAt','_docId','schemaVersion'].forEach(k => delete x[k]);
      if (x.teacherId != null) x.teacherId = String(x.teacherId).trim();
      if (x.studentId != null) x.studentId = String(x.studentId).trim();
      if (x.groupId != null) x.groupId = String(x.groupId).trim();
      return x;
    };
    const prevMap = new Map((prev || []).map(item => [String(item.id), item]));
    const nextMap = new Map((next || []).map(item => [String(item.id), cleanCore(item)]));
    const operations = [];

    for (const [id, item] of nextMap.entries()) {
      const before = prevMap.get(id);
      if (before && JSON.stringify(cleanCore(before)) === JSON.stringify(item)) continue;
      const data = {
        ...item,
        id,
        createdAt: toMillis(before?.createdAt) || toMillis(item.createdAt) || Date.now(),
        updatedAt: Date.now(),
        schemaVersion: DB_SCHEMA_VERSION
      };
      operations.push({ type:'set', ref:doc(firestore,name,id), data });
    }
    for (const [id] of prevMap.entries()) if (!nextMap.has(id)) operations.push({ type:'delete', ref:doc(firestore,name,id) });
    await commitOperations(operations);
  };

  const handleUpdate = async (collectionKey, newData) => {
    const execute = async () => {
      await ensureAnonymousSession();
      const liveDb = dbRef.current;
      if (collectionKey === 'catalogs') {
        await setDoc(doc(firestore, 'catalogs', 'default'), { ...clean(newData), schemaVersion: DB_SCHEMA_VERSION, updatedAt: Date.now() });
      } else if (collectionKey === 'users') {
        await syncUsers(newData);
      } else if (collectionKey === 'groups') {
        await syncGroups(newData);
      } else if (collectionKey === 'templates') {
        await syncSimpleCollection('templates', liveDb.templates, newData);
      } else if (collectionKey === 'submissions') {
        await syncSimpleCollection('submissions', liveDb.submissions, newData);
      } else {
        throw new Error(`ไม่รู้จักชุดข้อมูล ${collectionKey}`);
      }
      return true;
    };

    const task = writeQueueRef.current.then(execute, execute);
    writeQueueRef.current = task.catch(() => {});
    try {
      return await task;
    } catch (err) {
      console.error('save', collectionKey, err);
      showToast(`บันทึกไม่สำเร็จ: ${err?.message || err}`, 'error');
      return false;
    }
  };

  const inspectSystem = async () => {
    await ensureAnonymousSession();
    const [usersRaw, groupsRaw, templatesRaw, submissionsRaw, ...legacyResults] = await Promise.all([
      getDocsArray('users'),
      getDocsArray('groups'),
      getDocsArray('templates'),
      getDocsArray('submissions'),
      ...LEGACY_COLLECTIONS.map(name => getDocsArray(name))
    ]);

    const activeUsers = usersRaw.filter(u => u.active !== false && ['student','teacher','admin'].includes(u.role) && normalizeUserId(u.id));
    const counts = new Map();
    for (const u of activeUsers) {
      const key = logicalUserKey(u);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const duplicateUserDocs = [...counts.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
    const legacyDocs = legacyResults.reduce((sum, rows) => sum + rows.length, 0);

    const users = normalizeUsersData(usersRaw);
    const studentIds = new Set(users.filter(u => u.role === 'student').map(u => String(u.id)));
    const teacherIds = new Set(users.filter(u => u.role === 'teacher').map(u => String(u.id)));
    const groupIds = new Set(groupsRaw.map(g => String(g.id ?? g._docId)));
    let orphanRefs = 0;
    for (const g of groupsRaw) {
      if (g.teacherId && !teacherIds.has(String(g.teacherId).trim())) orphanRefs++;
      for (const mid of g.members || []) if (!studentIds.has(String(mid).trim())) orphanRefs++;
    }
    for (const t of templatesRaw) if (t.teacherId && !teacherIds.has(String(t.teacherId).trim())) orphanRefs++;
    for (const sub of submissionsRaw) {
      if (sub.studentId && !studentIds.has(String(sub.studentId).trim())) orphanRefs++;
      if (sub.groupId && !groupIds.has(String(sub.groupId).trim())) orphanRefs++;
    }

    const result = {
      version: APP_VERSION,
      rawUserDocs: usersRaw.length,
      uniqueUsers: users.length,
      duplicateUserDocs,
      legacyDocs,
      orphanRefs,
      students: users.filter(u=>u.role==='student').length,
      teachers: users.filter(u=>u.role==='teacher').length,
      groups: groupsRaw.length,
      templates: templatesRaw.length,
      submissions: submissionsRaw.length,
      checkedAt: Date.now()
    };
    setSystemHealth(result);
    return result;
  };

  const exportBackup = async () => {
    try {
      await ensureAnonymousSession();
      const [users, groups, templates, submissions, catalogsSnap, systemSnap, ...legacyResults] = await Promise.all([
        getDocsArray('users'),
        getDocsArray('groups'),
        getDocsArray('templates'),
        getDocsArray('submissions'),
        getDoc(doc(firestore,'catalogs','default')),
        getDoc(doc(firestore,'system','app')),
        ...LEGACY_COLLECTIONS.map(name => getDocsArray(name))
      ]);
      const legacy = {};
      LEGACY_COLLECTIONS.forEach((name, i) => { legacy[name] = legacyResults[i]; });
      const payload = {
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        schemaVersion: DB_SCHEMA_VERSION,
        data: { users, groups, templates, submissions, catalogs: catalogsSnap.exists() ? catalogsSnap.data() : null, system: systemSnap.exists() ? systemSnap.data() : null },
        legacy
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `DMD_Project_Tracking_Backup_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      showToast('สร้างไฟล์สำรองข้อมูลแล้ว');
      return true;
    } catch (err) {
      console.error('backup', err);
      showToast(`สำรองข้อมูลไม่สำเร็จ: ${err?.message || err}`, 'error');
      return false;
    }
  };

  const cleanupSystem = async () => {
    await ensureAnonymousSession();
    const [usersRaw, groupsRaw, templatesRaw, submissionsRaw, catSnap, ...legacyResults] = await Promise.all([
      getDocsArray('users'),
      getDocsArray('groups'),
      getDocsArray('templates'),
      getDocsArray('submissions'),
      getDoc(doc(firestore,'catalogs','default')),
      ...LEGACY_COLLECTIONS.map(name => getDocsArray(name))
    ]);

    const operations = [];
    const catalogData = catSnap.exists() ? catSnap.data() : {};
    const cleanupLevels = Array.from(new Set((catalogData.levels?.length ? catalogData.levels : DEFAULT_LEVELS).map(v=>String(v).trim()).filter(Boolean)));
    const cleanupRooms = Array.from(new Set((catalogData.rooms?.length ? catalogData.rooms : DEFAULT_ROOMS).map(v=>String(v).trim()).filter(Boolean)));
    const canonicalUsers = new Map();
    const grouped = new Map();

    for (const u of usersRaw) {
      if ((u.role === 'disabled' || u.active === false) && u._docId) {
        operations.push({ type:'delete', ref:doc(firestore,'users',u._docId) });
        continue;
      }
      if (!['student','teacher','admin'].includes(u.role) || !normalizeUserId(u.id)) continue;
      const key = logicalUserKey(u);
      const arr = grouped.get(key) || [];
      arr.push(u); grouped.set(key, arr);
    }

    for (const [key, rows] of grouped.entries()) {
      rows.sort((a,b) => toMillis(a.updatedAt || a.createdAt) - toMillis(b.updatedAt || b.createdAt));
      let merged = {};
      for (const row of rows) merged = { ...merged, ...row };
      const roleName = String(merged.role);
      const id = normalizeUserId(merged.id);
      const docId = canonicalUserDocId({ role:roleName, id });
      const base = {
        id, role:roleName,
        title:String(merged.title || ''), fname:String(merged.fname || ''), lname:String(merged.lname || ''),
        active:true,
        createdAt:toMillis(merged.createdAt) || Date.now(),
        updatedAt:Date.now(), schemaVersion:DB_SCHEMA_VERSION
      };
      const profile = roleName === 'student' ? {
        ...base,
        level:canonicalFromList(merged.level, cleanupLevels, cleanupLevels[0] || ''),
        room:canonicalFromList(merged.room, cleanupRooms, cleanupRooms[0] || ''),
      } : roleName === 'teacher' ? {
        ...base,
        teacherPasswordSet: merged.teacherPasswordSet === true,
        teacherPasswordHash:String(merged.teacherPasswordHash || ''),
        teacherPasswordSalt:String(merged.teacherPasswordSalt || ''),
        teacherTempHash:String(merged.teacherTempHash || ''),
        teacherTempSalt:String(merged.teacherTempSalt || ''),
        teacherPasswordUpdatedAt:toMillis(merged.teacherPasswordUpdatedAt) || 0
      } : base;
      canonicalUsers.set(key, profile);
      operations.push({ type:'set', ref:doc(firestore,'users',docId), data:profile });
      for (const row of rows) if (row._docId && row._docId !== docId) operations.push({ type:'delete', ref:doc(firestore,'users',row._docId) });
    }

    const teacherById = new Map([...canonicalUsers.values()].filter(u=>u.role==='teacher').map(u=>[String(u.id),u]));
    const groupIdMap = new Map();
    for (const g of groupsRaw) groupIdMap.set(String(g.id ?? g._docId), String(g._docId));

    for (const g of groupsRaw) {
      const id = String(g._docId);
      const teacherId = g.teacherId != null ? String(g.teacherId).trim() : '';
      const teacher = teacherById.get(teacherId);
      const milestones = (Array.isArray(g.milestones) ? g.milestones : []).map((m, idx) => ({
        id:String(m.id || makeEntityId('m')),
        order:idx + 1,
        desc:String(m.desc || ''),
        percent:Number(m.percent || 0),
        status:['pending','approved','rejected'].includes(m.status) ? m.status : 'pending',
        assignDate:String(m.assignDate || ''),
        dueDate:String(m.dueDate || '')
      }));
      const canonical = {
        id,
        name:String(g.name || ''),
        teacherId,
        teacherName:teacher ? `${teacher.title || ''}${teacher.fname || ''} ${teacher.lname || ''}`.trim() : String(g.teacherName || ''),
        level:canonicalFromList(g.level, cleanupLevels, cleanupLevels[0] || ''), room:canonicalFromList(g.room, cleanupRooms, cleanupRooms[0] || ''),
        members:Array.from(new Set((g.members || []).map(v=>String(v).trim()).filter(Boolean))),
        milestones,
        links:Array.isArray(g.links) ? g.links : [],
        createdAt:toMillis(g.createdAt) || Date.now(), updatedAt:Date.now(), schemaVersion:DB_SCHEMA_VERSION
      };
      operations.push({ type:'set', ref:doc(firestore,'groups',id), data:canonical });
    }

    for (const t of templatesRaw) {
      const id = String(t._docId);
      operations.push({ type:'set', ref:doc(firestore,'templates',id), data:{
        id,
        teacherId:String(t.teacherId || '').trim(),
        name:String(t.name || ''),
        milestones:(Array.isArray(t.milestones) ? t.milestones : []).map(m=>({ desc:String(m.desc || ''), percent:Number(m.percent || 0) })),
        createdAt:toMillis(t.createdAt) || Date.now(), updatedAt:Date.now(), schemaVersion:DB_SCHEMA_VERSION
      }});
    }

    for (const sub of submissionsRaw) {
      const id = String(sub._docId);
      const oldGroupId = String(sub.groupId || '').trim();
      operations.push({ type:'set', ref:doc(firestore,'submissions',id), data:{
        id,
        groupId:groupIdMap.get(oldGroupId) || oldGroupId,
        studentId:String(sub.studentId || '').trim(),
        url:String(sub.url || ''),
        createdAt:toMillis(sub.createdAt) || Date.now(), updatedAt:Date.now(), schemaVersion:DB_SCHEMA_VERSION
      }});
    }

    operations.push({ type:'set', ref:doc(firestore,'catalogs','default'), data:{
      levels:cleanupLevels,
      rooms:cleanupRooms,
      updatedAt:Date.now(), schemaVersion:DB_SCHEMA_VERSION
    }});

    LEGACY_COLLECTIONS.forEach((name, i) => {
      for (const row of legacyResults[i]) if (row._docId) operations.push({ type:'delete', ref:doc(firestore,name,row._docId) });
    });

    operations.push({ type:'set', ref:doc(firestore,'system','app'), data:{
      appVersion:APP_VERSION, schemaVersion:DB_SCHEMA_VERSION,
      cleanupCompleted:true, cleanupAt:Date.now(),
      activeCollections:[...ACTIVE_COLLECTIONS,'catalogs','system']
    }, options:{ merge:true } });

    await commitOperations(operations);
    await loadAllData();
    const health = await inspectSystem();
    return {
      canonicalUsers: canonicalUsers.size,
      deletedDocs: operations.filter(op=>op.type==='delete').length,
      health
    };
  };

  const deleteAllStudentsRemote = async () => {
    await ensureAnonymousSession();
    const [usersRaw, groupsRaw, submissionsRaw] = await Promise.all([
      getDocsArray('users'), getDocsArray('groups'), getDocsArray('submissions')
    ]);
    const studentIds = new Set(usersRaw.filter(u=>u.role==='student').map(u=>normalizeUserId(u.id)).filter(Boolean));
    const operations = [];
    let groupUpdates = 0;
    for (const u of usersRaw) if (u.role === 'student' && u._docId) operations.push({ type:'delete', ref:doc(firestore,'users',u._docId) });
    for (const s of submissionsRaw) if (studentIds.has(String(s.studentId || '').trim()) && s._docId) operations.push({ type:'delete', ref:doc(firestore,'submissions',s._docId) });
    for (const g of groupsRaw) {
      const members = (g.members || []).map(v=>String(v).trim());
      const nextMembers = members.filter(id=>!studentIds.has(id));
      if (nextMembers.length !== members.length) {
        groupUpdates++;
        operations.push({ type:'set', ref:doc(firestore,'groups',g._docId), data:{ members:nextMembers, updatedAt:Date.now(), schemaVersion:DB_SCHEMA_VERSION }, options:{ merge:true } });
      }
    }
    await commitOperations(operations);
    await loadAllData();
    return {
      students: studentIds.size,
      submissions: submissionsRaw.filter(s=>studentIds.has(String(s.studentId || '').trim())).length,
      groups: groupUpdates
    };
  };

  const completeTeacherFirstPassword = async () => {
    if (!pendingTeacherSetup) return;
    if (firstPassword.length < 6) return showToast('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'error');
    if (firstPassword !== confirmFirstPassword) return showToast('ยืนยันรหัสผ่านไม่ตรงกัน', 'error');
    const salt = makeSecuritySalt();
    const passwordHash = await hashTeacherSecret(firstPassword, salt);
    const nextUsers = db.users.map(u => u.role === 'teacher' && String(u.id) === String(pendingTeacherSetup.id) ? {
      ...u,
      teacherPasswordSet: true,
      teacherPasswordHash: passwordHash,
      teacherPasswordSalt: salt,
      teacherTempHash: '',
      teacherTempSalt: '',
      teacherPasswordUpdatedAt: Date.now()
    } : u);
    const ok = await handleUpdate('users', nextUsers);
    if (!ok) return;
    const updated = { ...pendingTeacherSetup, teacherPasswordSet: true, teacherPasswordHash: passwordHash, teacherPasswordSalt: salt, teacherTempHash: '', teacherTempSalt: '' };
    setCurrentUser(updated);
    sessionStorage.setItem('dmd_web_session', JSON.stringify({ role: 'teacher', id: updated.id }));
    setPendingTeacherSetup(null); setFirstPassword(''); setConfirmFirstPassword(''); setLoginPassword('');
    showToast('ตั้งรหัสผ่านสำเร็จ');
  };

  const parentSearchNeedle = normalizeMatchText(searchQuery);
  const parentSearchResults = parentSearchNeedle
    ? (db.users || []).filter(u => {
        if (u.role !== 'student') return false;
        const haystack = normalizeMatchText(`${u.id || ''}${u.title || ''}${u.fname || ''}${u.lname || ''}`);
        return haystack.includes(parentSearchNeedle);
      }).slice(0, 20)
    : [];

  const handleLogin = async e => {
    e.preventDefault();
    try {
      setLoading(true);
      await ensureAnonymousSession();

      // Admin v8.0.3 เข้าระบบได้ทันทีโดยไม่รอโหลด users ทั้งฐาน
      if (role === 'admin') {
        const rawAdminId = loginId.trim();
        if (!rawAdminId) throw new Error('กรุณากรอกรหัสผู้ใช้งาน');
        if (rawAdminId.toLowerCase() !== 'admin') throw new Error('รหัสผู้จัดการระบบไม่ถูกต้อง');
        if (!loginPassword) throw new Error('กรุณากรอกรหัสผ่านผู้จัดการระบบ');
        if (loginPassword !== ADMIN_PASSWORD) throw new Error('รหัสผ่านผู้จัดการระบบไม่ถูกต้อง');
        const adminUser = dbRef.current.users.find(u => u.role === 'admin' && String(u.id).trim().toLowerCase() === 'admin') || {
          uid: 'admin_default', id: 'admin', role: 'admin', title: '', fname: 'ผู้จัดการ', lname: 'ระบบ', active: true
        };
        setCurrentUser(adminUser);
        sessionStorage.setItem('dmd_web_session', JSON.stringify({ role: 'admin', id: 'admin' }));
        showToast('เข้าสู่ระบบสำเร็จ ยินดีต้อนรับผู้จัดการระบบ');
        return;
      }

      let fresh = dbRef.current;
      if (!fresh?.users?.length) fresh = await withTimeout(loadAllData(), 30000, 'การโหลดข้อมูลผู้ใช้งาน');

      if (role === 'parent') {
        const q = normalizeMatchText(searchQuery);
        if (!q) throw new Error('กรุณากรอกรหัส ชื่อ หรือนามสกุลนักศึกษา');
        const matches = fresh.users.filter(u => {
          if (u.role !== 'student') return false;
          const haystack = normalizeMatchText(`${u.id || ''}${u.title || ''}${u.fname || ''}${u.lname || ''}`);
          return haystack.includes(q);
        });
        const exactId = matches.find(u => normalizeMatchText(u.id) === q);
        const selected = parentSelectedStudentId
          ? matches.find(u => String(u.id) === String(parentSelectedStudentId)) || fresh.users.find(u => u.role === 'student' && String(u.id) === String(parentSelectedStudentId))
          : null;
        const student = selected || exactId || (matches.length === 1 ? matches[0] : null);
        if (!matches.length && !selected) throw new Error('ไม่พบข้อมูลนักศึกษาที่ค้นหา');
        if (!student && matches.length > 1) throw new Error('พบชื่อนักศึกษามากกว่า 1 คน กรุณาเลือกชื่อจากรายการก่อนเข้าสู่ระบบ');
        setCurrentUser(student);
        sessionStorage.setItem('dmd_web_session', JSON.stringify({ role: 'parent', id: student.id }));
        return;
      }

      const rawId = loginId.trim();
      if (!rawId) throw new Error('กรุณากรอกรหัสผู้ใช้งาน');

      let user = fresh.users.find(u => u.role === role && String(u.id).trim().toLowerCase() === rawId.toLowerCase());
      if (!user) throw new Error('รหัสผู้ใช้งานไม่ถูกต้อง หรือยังไม่มีรหัสนี้ในระบบ');

      if (role === 'teacher') {
        if (!loginPassword) throw new Error('กรุณากรอกรหัสผ่าน');
        if (user.teacherPasswordSet) {
          if (!user.teacherPasswordHash || !user.teacherPasswordSalt) throw new Error('ข้อมูลรหัสผ่านไม่สมบูรณ์ กรุณาติดต่อผู้จัดการระบบ');
          const givenHash = await hashTeacherSecret(loginPassword, user.teacherPasswordSalt);
          if (givenHash !== user.teacherPasswordHash) throw new Error('รหัสผ่านไม่ถูกต้อง');
        } else {
          if (!user.teacherTempHash || !user.teacherTempSalt) throw new Error('บัญชีนี้ยังไม่ได้รับรหัสตั้งต้น กรุณาติดต่อผู้จัดการระบบ');
          const tempHash = await hashTeacherSecret(loginPassword, user.teacherTempSalt);
          if (tempHash !== user.teacherTempHash) throw new Error('รหัสตั้งต้นไม่ถูกต้อง');
          setPendingTeacherSetup(user);
          showToast('ยืนยันรหัสตั้งต้นแล้ว กรุณาตั้งรหัสผ่านส่วนตัว');
          return;
        }
      }

      setCurrentUser(user);
      sessionStorage.setItem('dmd_web_session', JSON.stringify({ role, id: user.id }));
      showToast(`เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${user.fname || ''}`);
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'ไม่สามารถเข้าสู่ระบบได้', 'error');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    sessionStorage.removeItem('dmd_web_session');
    setCurrentUser(null);
    setRole(null);
    setLoginId('');
    setLoginPassword('');
    setPendingTeacherSetup(null);
    setFirstPassword('');
    setConfirmFirstPassword('');
    setSearchQuery('');
    setParentSelectedStudentId('');
    try {
      await ensureAnonymousSession();
      await loadAllData();
    } catch (_) {}
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4"><Loader2 className="animate-spin text-blue-600 mb-4" size={48}/><h2 className="text-xl font-semibold text-gray-700">DMD Integrated Project Tracking System</h2><p className="text-sm text-gray-500 mt-2">โปรดรอสักครู่</p><p className="text-[11px] text-gray-400 mt-1">v{APP_VERSION}</p></div>;
  }

  if (parentPortalMode) {
    const portalStudent = role === 'parent' ? currentUser : null;
    if (portalStudent) {
      return <ParentShareView db={db} targetStudent={portalStudent} onBack={() => {
        sessionStorage.removeItem('dmd_web_session');
        setCurrentUser(null);
        setRole(null);
        setSearchQuery('');
        setParentSelectedStudentId('');
      }}/>;
    }

    const openSelectedParentStudent = () => {
      const selected = parentSelectedStudentId
        ? db.users.find(u => u.role === 'student' && String(u.id) === String(parentSelectedStudentId))
        : null;
      const q = normalizeMatchText(searchQuery);
      const matches = q ? db.users.filter(u => {
        if (u.role !== 'student') return false;
        return normalizeMatchText(`${u.id || ''}${u.title || ''}${u.fname || ''}${u.lname || ''}`).includes(q);
      }) : [];
      const exactId = matches.find(u => normalizeMatchText(u.id) === q);
      const student = selected || exactId || (matches.length === 1 ? matches[0] : null);
      if (!q && !selected) return showToast('กรุณากรอกรหัส ชื่อ หรือนามสกุลนักศึกษา', 'error');
      if (!matches.length && !selected) return showToast('ไม่พบข้อมูลนักศึกษาที่ค้นหา', 'error');
      if (!student && matches.length > 1) return showToast('พบรายชื่อมากกว่า 1 คน กรุณาเลือกนักศึกษาจากรายการ', 'error');
      setRole('parent');
      setCurrentUser(student);
    };

    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans text-gray-800">
        <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-7 sm:p-8 text-center text-white">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center mb-4"><Search size={27}/></div>
            <h1 className="text-2xl font-bold">ตรวจสอบโครงงานสำหรับผู้ปกครอง</h1>
            <p className="text-blue-100 mt-2 text-sm">DMD Integrated Project Tracking System</p>
          </div>
          <div className="p-6 sm:p-8 space-y-4">
            <div className="text-center mb-2">
              <h2 className="font-semibold text-gray-800">ค้นหาข้อมูลนักศึกษา</h2>
              <p className="text-xs text-gray-400 mt-1">ค้นหาได้ด้วยรหัสนักศึกษา ชื่อ หรือนามสกุล</p>
            </div>
            <Input
              label="รหัส / ชื่อ / นามสกุลนักศึกษา"
              placeholder="เช่น 032151 หรือ สมชาย"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setParentSelectedStudentId(''); }}
            />
            {searchQuery.trim() && (
              <div className="border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto bg-white">
                {parentSearchResults.length > 0 ? parentSearchResults.map(student => {
                  const selected = String(parentSelectedStudentId) === String(student.id);
                  return <button
                    type="button"
                    key={student.id}
                    onClick={() => { setParentSelectedStudentId(String(student.id)); setSearchQuery(`${student.fname || ''} ${student.lname || ''}`.trim()); }}
                    className={`w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-blue-50 transition ${selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}`}
                  >
                    <div className="flex justify-between gap-3">
                      <div><p className="font-semibold text-sm text-gray-800">{student.title || ''}{student.fname || ''} {student.lname || ''}</p><p className="text-xs text-gray-500 mt-0.5">รหัส {student.id} • {student.level || '-'} / ห้อง {student.room || '-'}</p></div>
                      {selected && <CheckCircle size={18} className="text-blue-600 shrink-0 mt-0.5"/>}
                    </div>
                  </button>;
                }) : <div className="px-4 py-4 text-sm text-gray-400 text-center">ไม่พบรายชื่อนักศึกษาที่ตรงกับคำค้น</div>}
              </div>
            )}
            <Button type="button" onClick={openSelectedParentStudent} className="w-full py-3"><Search size={17}/> ตรวจสอบความคืบหน้า</Button>
            <div className="pt-4 border-t text-center text-xs text-gray-400">สำหรับผู้ปกครอง • อ่านข้อมูลอย่างเดียว</div>
          </div>
        </div>
        {toast && <div className="fixed top-4 right-4 z-50"><div className={`px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 text-white font-medium ${toast.type === 'error' ? 'bg-red-500' : 'bg-gray-800'}`}>{toast.type === 'error' ? <AlertCircle size={20}/> : <CheckCircle size={20}/>} {toast.msg}</div></div>}
      </div>
    );
  }


  if (!role || !currentUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4 font-sans text-gray-800">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
          <div className="bg-blue-600 p-8 text-center text-white"><h1 className="text-2xl font-bold">ระบบติดตามโครงงานบูรณาการ สาขา DMD</h1><p className="text-blue-100 mt-2 text-sm opacity-90">DMD Integrated Project Tracking System</p></div>
          <div className="p-8 relative">
            {!role ? (
              <div className="space-y-3">
                <h2 className="text-center font-medium text-gray-500 mb-6">เลือกสถานะเพื่อเข้าใช้งาน</h2>
                <Button variant="secondary" className="w-full justify-start py-3" onClick={() => setRole('student')}><UserCircle className="text-blue-500"/> นักศึกษา (Student)</Button>
                <Button variant="secondary" className="w-full justify-start py-3" onClick={() => setRole('teacher')}><CheckCircle className="text-green-500"/> อาจารย์ผู้ควบคุม (Teacher)</Button>
                <Button variant="secondary" className="w-full justify-start py-3" onClick={() => { setRole('parent'); setSearchQuery(''); setParentSelectedStudentId(''); }}><Search className="text-amber-500"/> ผู้ปกครอง (Parent)</Button>
                <Button variant="secondary" className="w-full justify-start py-3" onClick={() => setRole('admin')}><Settings className="text-gray-500"/> ผู้จัดการระบบ (Admin)</Button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center gap-2 text-blue-600 font-semibold mb-2"><button type="button" onClick={() => { setRole(null); setParentSelectedStudentId(''); setSearchQuery(''); }} className="p-1 hover:bg-blue-50 rounded"><ChevronRight className="rotate-180" size={18}/></button>เข้าสู่ระบบในฐานะ {role === 'student' ? 'นักศึกษา' : role === 'teacher' ? 'อาจารย์ผู้ควบคุม' : role === 'admin' ? 'ผู้จัดการระบบ' : 'ผู้ปกครอง'}</div>
                {role === 'parent' ? (
                  <div className="space-y-2">
                    <Input
                      label="ค้นหานักศึกษา"
                      placeholder="กรอกรหัส ชื่อ หรือนามสกุล"
                      required
                      value={searchQuery}
                      onChange={e => { setSearchQuery(e.target.value); setParentSelectedStudentId(''); }}
                    />
                    {searchQuery.trim() && (
                      <div className="border border-gray-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto bg-white">
                        {parentSearchResults.length > 0 ? parentSearchResults.map(student => {
                          const selected = String(parentSelectedStudentId) === String(student.id);
                          return (
                            <button
                              type="button"
                              key={student.id}
                              onClick={() => { setParentSelectedStudentId(String(student.id)); setSearchQuery(`${student.fname || ''} ${student.lname || ''}`.trim()); }}
                              className={`w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-blue-50 transition ${selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}`}
                            >
                              <div className="flex justify-between gap-3">
                                <div>
                                  <p className="font-semibold text-sm text-gray-800">{student.title || ''}{student.fname || ''} {student.lname || ''}</p>
                                  <p className="text-xs text-gray-500 mt-0.5">รหัส {student.id} • {student.level || '-'} / ห้อง {student.room || '-'}</p>
                                </div>
                                {selected && <CheckCircle size={18} className="text-blue-600 shrink-0 mt-0.5"/>}
                              </div>
                            </button>
                          );
                        }) : (
                          <div className="px-4 py-3 text-sm text-gray-400 text-center">ไม่พบรายชื่อนักศึกษาที่ตรงกับคำค้น</div>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-gray-400">ค้นหาได้ทั้งรหัสนักศึกษา ชื่อ หรือนามสกุล หากมีชื่อซ้ำให้เลือกบุคคลจากรายการ</p>
                  </div>
                ) : (
                  <Input label="รหัสผู้ใช้งาน" placeholder={role === 'admin' ? 'กรอก admin' : 'กรอกรหัส...'} required value={loginId} onChange={e => setLoginId(e.target.value)}/>
                )}
                {role === 'teacher' && <Input label="รหัสผ่าน" type="password" placeholder="กรอกรหัสผ่าน หรือรหัสตั้งต้นครั้งแรก" required value={loginPassword} onChange={e=>setLoginPassword(e.target.value)}/>}
                {role === 'admin' && <Input label="รหัสผ่านผู้จัดการระบบ" type="password" placeholder="กรอกรหัสผ่าน" required value={loginPassword} onChange={e=>setLoginPassword(e.target.value)}/>}
                <Button type="submit" className="w-full mt-4">เข้าสู่ระบบ</Button>
                <div className="text-xs text-gray-400 mt-6 pt-4 border-t text-center flex flex-col gap-1 items-center justify-center"><span className="flex items-center gap-1"><ShieldCheck size={14}/> ระบบพร้อมใช้งาน</span><span>{role === 'admin' ? 'เข้าสู่ระบบด้วยรหัสผู้ใช้ admin และรหัสผ่านผู้จัดการระบบ' : role === 'parent' ? 'ค้นหาได้ด้วยรหัส ชื่อ หรือนามสกุลนักศึกษา' : role === 'teacher' ? 'ใช้รหัสอาจารย์ + รหัสผ่านส่วนตัว' : 'ใช้รหัสประจำตัวเข้าสู่ระบบได้โดยตรง'}</span></div>
              </form>
            )}
          </div>
        </div>
        <Modal isOpen={!!pendingTeacherSetup} onClose={()=>{}} title="ตั้งรหัสผ่านส่วนตัวครั้งแรก">
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-sm text-green-800">ยืนยันรหัสตั้งต้นสำเร็จแล้ว กรุณาตั้งรหัสผ่านที่อาจารย์ต้องการใช้เอง ตั้งแต่ 6 ตัวอักษรขึ้นไป</div>
            <Input label="รหัสผ่านใหม่" type="password" value={firstPassword} onChange={e=>setFirstPassword(e.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร"/>
            <Input label="ยืนยันรหัสผ่านใหม่" type="password" value={confirmFirstPassword} onChange={e=>setConfirmFirstPassword(e.target.value)} placeholder="กรอกรหัสผ่านเดิมอีกครั้ง"/>
            <Button onClick={completeTeacherFirstPassword} className="w-full">บันทึกและเข้าสู่ระบบ</Button>
          </div>
        </Modal>
        {toast && <div className="fixed top-4 right-4 z-50"><div className={`px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 text-white font-medium ${toast.type === 'error' ? 'bg-red-500' : 'bg-gray-800'}`}>{toast.type === 'error' ? <AlertCircle size={20}/> : <CheckCircle size={20}/>} {toast.msg}</div></div>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 font-sans text-gray-900 flex flex-col relative">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">D</div><div><h1 className="font-bold text-lg hidden sm:block">DMD Project Tracking</h1><p className="text-[10px] text-gray-400 hidden sm:block">v{APP_VERSION}</p></div></div><div className="flex items-center gap-4"><div className="text-right hidden md:block"><p className="text-sm font-semibold">{currentUser.title}{currentUser.fname} {currentUser.lname}</p><p className="text-xs text-gray-500 capitalize">{role}</p></div><button onClick={logout} className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2 text-sm font-medium"><LogOut size={18}/> <span className="hidden sm:inline">ออกจากระบบ</span></button></div></div></header>
      <main className="flex-grow w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-500">
        {role === 'admin' && <AdminView db={db} handleUpdate={handleUpdate} showToast={showToast} askConfirm={askConfirm} askPrompt={askPrompt} currentUser={currentUser} systemHealth={systemHealth} inspectSystem={inspectSystem} cleanupSystem={cleanupSystem} exportBackup={exportBackup} deleteAllStudentsRemote={deleteAllStudentsRemote}/>} 
        {role === 'teacher' && <TeacherView user={currentUser} db={db} handleUpdate={handleUpdate} showToast={showToast} askConfirm={askConfirm} askPrompt={askPrompt}/>} 
        {role === 'student' && <ProgressDashboard db={db} targetStudent={currentUser} isParent={false} handleUpdate={handleUpdate} showToast={showToast} askPrompt={askPrompt}/>} 
        {role === 'parent' && <ProgressDashboard db={db} targetStudent={currentUser} isParent={true}/>} 
      </main>
      {toast && <div className="fixed top-20 right-4 z-50"><div className={`px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 text-white font-medium ${toast.type === 'error' ? 'bg-red-500' : 'bg-gray-800'}`}>{toast.type === 'error' ? <AlertCircle size={20}/> : <CheckCircle size={20}/>} {toast.msg}</div></div>}
      <Modal isOpen={confirmDialog.isOpen} onClose={() => setConfirmDialog({ isOpen:false,msg:'',onConfirm:null })} title="ยืนยันการทำรายการ"><div className="space-y-6"><p className="text-gray-600">{confirmDialog.msg}</p><div className="flex justify-end gap-3 pt-4 border-t border-gray-100"><Button variant="secondary" onClick={() => setConfirmDialog({isOpen:false,msg:'',onConfirm:null})}>ยกเลิก</Button><Button onClick={() => { confirmDialog.onConfirm?.(); setConfirmDialog({isOpen:false,msg:'',onConfirm:null}); }}>ตกลง</Button></div></div></Modal>
      <Modal isOpen={promptDialog.isOpen} onClose={() => setPromptDialog({isOpen:false,title:'',onSubmit:null,value:''})} title={promptDialog.title}><div className="space-y-6"><Input value={promptDialog.value} onChange={e => setPromptDialog(p => ({...p,value:e.target.value}))} placeholder="พิมพ์ข้อความที่นี่..."/><div className="flex justify-end gap-3 pt-4 border-t border-gray-100"><Button variant="secondary" onClick={() => setPromptDialog({isOpen:false,title:'',onSubmit:null,value:''})}>ยกเลิก</Button><Button onClick={() => { promptDialog.onSubmit?.(promptDialog.value); setPromptDialog({isOpen:false,title:'',onSubmit:null,value:''}); }}>บันทึก</Button></div></div></Modal>
    </div>
  );
}

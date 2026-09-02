import React, { useState, useEffect, useRef } from 'react';
import { signInAnonymously, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db as firestore } from './firebase';
import { 
  Users, UserCircle, LogOut, Search, Plus, Trash2, Edit2, 
  CheckCircle, Clock, Link as LinkIcon, BarChart3, Settings, 
  ChevronRight, AlertCircle, Check, X, XCircle, Download, Upload, Bookmark, Copy,
  Loader2, Info, GraduationCap, School, LayoutDashboard, FolderKanban, ShieldCheck
} from 'lucide-react';

const DEFAULT_LEVELS = ['ปวช. 1', 'ปวช. 2', 'ปวช. 3', 'ปวส. 1', 'ปวส. 2'];
const DEFAULT_ROOMS = ['1', '2', '3', '4'];
const ADMIN_PASSWORD = '995622';

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

const generateTeacherSetupCode = () => {
  const n = new Uint32Array(1);
  window.crypto.getRandomValues(n);
  return String(100000 + (n[0] % 900000));
};

const makeEntityId = (prefix) => {
  if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return `${prefix}_${Date.now()}_${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
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

const AdminView = ({ db, handleUpdate, showToast, askConfirm, askPrompt, currentUser }) => {
  const LEVELS = db.catalogs?.levels?.length ? db.catalogs.levels : DEFAULT_LEVELS;
  const ROOMS = db.catalogs?.rooms?.length ? db.catalogs.rooms : DEFAULT_ROOMS;
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({ id: '', title: '', fname: '', lname: '', level: LEVELS[0], room: ROOMS[0] });
  const [setupCodeDialog, setSetupCodeDialog] = useState({ isOpen: false, code: '', teacherName: '' });
  const fileInputRef = useRef(null);

  const isUserTab = activeTab === 'students' || activeTab === 'teachers';
  const filteredUsers = db.users.filter(u => u.role === (activeTab === 'students' ? 'student' : 'teacher'));

  const handleSave = async () => {
    if(!formData.id || !formData.fname || !formData.lname) return showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error');
    let newUsers = [...db.users];
    const roleName = activeTab === 'students' ? 'student' : 'teacher';
    const isEdit = !!editingUser;
    if (isEdit) {
      newUsers = newUsers.map(u => u.id === editingUser.id ? { ...u, ...formData, role: roleName } : u);
    } else {
      if (newUsers.find(u => u.id === formData.id)) return showToast('รหัสนี้มีในระบบแล้ว', 'error');
      newUsers.push({ ...formData, role: roleName });
    }
    const ok = await handleUpdate('users', newUsers);
    if (!ok) return;
    showToast(isEdit ? 'อัปเดตข้อมูลสำเร็จ' : `เพิ่ม${roleName === 'teacher' ? 'อาจารย์' : 'นักศึกษา'}สำเร็จ`);
    setIsModalOpen(false);
  };

  const handleDelete = (id) => {
    askConfirm('ต้องการลบผู้ใช้งานนี้ใช่หรือไม่?', () => {
      handleUpdate('users', db.users.filter(u => u.id !== id));
      showToast('ลบข้อมูลสำเร็จ');
    });
  };

  const issueTeacherSetupCode = async (teacher) => {
    const code = generateTeacherSetupCode();
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
    setSetupCodeDialog({
      isOpen: true,
      code,
      teacherName: `${teacher.title || ''}${teacher.fname || ''} ${teacher.lname || ''}`.trim()
    });
  };

  const handleTeacherSetupCode = (teacher) => {
    const message = teacher.teacherPasswordSet
      ? `ต้องการรีเซ็ตรหัสผ่านของ ${teacher.title || ''}${teacher.fname || ''} ${teacher.lname || ''} หรือไม่? รหัสผ่านเดิมจะใช้งานไม่ได้ และระบบจะสร้างรหัสตั้งต้นใหม่`
      : `สร้างรหัสตั้งต้นสำหรับ ${teacher.title || ''}${teacher.fname || ''} ${teacher.lname || ''} หรือไม่?`;
    askConfirm(message, () => issueTeacherSetupCode(teacher));
  };

  const openModal = (user = null) => {
    setEditingUser(user);
    setFormData(user || { id: '', title: activeTab === 'teachers' ? 'อาจารย์' : 'นาย', fname: '', lname: '', level: LEVELS[0], room: ROOMS[0] });
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
            user.level = String(cols[4] || LEVELS[0]).trim();
            user.room = String(cols[5] || ROOMS[0]).trim();
          }
          const key = `${roleName}:${id.toLowerCase()}`;
          if (importedMap.has(key)) duplicateRows++;
          importedMap.set(key, user);
        }

        const imported = [...importedMap.values()];
        if (!imported.length) return showToast('ไม่พบข้อมูลที่ถูกต้องในไฟล์ CSV', 'error');

        const mergedImported = imported.map(n => {
          const old = db.users.find(u => u.role === n.role && String(u.id).trim().toLowerCase() === String(n.id).trim().toLowerCase());
          return old ? { ...old, ...n } : n;
        });
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

  const updateCatalog = (key, next) => handleUpdate('catalogs', { ...(db.catalogs || {}), [key]: next });
  const addCatalog = (key, label) => askPrompt(`เพิ่ม${label}`, value => {
    const v = String(value || '').trim();
    if (!v) return;
    const arr = key === 'levels' ? LEVELS : ROOMS;
    if (arr.includes(v)) return showToast(`${label}นี้มีอยู่แล้ว`, 'error');
    updateCatalog(key, [...arr, v]);
    showToast(`เพิ่ม${label}แล้ว`);
  });
  const removeCatalog = (key, value, label) => {
    const inUse = db.users.some(u => u.role === 'student' && (key === 'levels' ? u.level === value : u.room === value)) ||
      db.groups.some(g => key === 'levels' ? g.level === value : g.room === value);
    if (inUse) return showToast(`ลบไม่ได้ เพราะ${label}นี้ถูกใช้งานอยู่`, 'error');
    askConfirm(`ลบ${label} “${value}” หรือไม่?`, () => {
      const arr = key === 'levels' ? LEVELS : ROOMS;
      updateCatalog(key, arr.filter(v => v !== value));
      showToast(`ลบ${label}แล้ว`);
    });
  };

  const students = db.users.filter(u => u.role === 'student');
  const teachers = db.users.filter(u => u.role === 'teacher');
  const approvedWeight = db.groups.reduce((sum, g) => sum + calculateGroupProgress(g.milestones || []), 0);
  const avgProgress = db.groups.length ? approvedWeight / db.groups.length : 0;
  const levelStats = LEVELS.map(level => {
    const groups = db.groups.filter(g => g.level === level);
    return { level, groups: groups.length, students: students.filter(s => s.level === level).length, progress: groups.length ? groups.reduce((a,g)=>a+calculateGroupProgress(g.milestones||[]),0)/groups.length : 0 };
  });

  const tabs = [
    ['dashboard', <LayoutDashboard size={16}/>, 'ภาพรวม'],
    ['students', <GraduationCap size={16}/>, 'นักศึกษา'],
    ['teachers', <School size={16}/>, 'อาจารย์ผู้ควบคุม'],
    ['catalogs', <Settings size={16}/>, 'คลังระดับชั้น/ห้อง'],
    ['projects', <FolderKanban size={16}/>, 'จัดการโครงงาน']
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">ผู้จัดการระบบ (Admin)</h2>
        <p className="text-sm text-gray-500 mt-1">ควบคุมข้อมูลผู้ใช้ โครงงาน คลังระดับชั้น/ห้อง และสถิติทั้งหมด</p>
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
          <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={downloadCSVTemplate}><Download size={16}/> ตัวอย่าง CSV</Button><input type="file" accept=".csv,text/csv" ref={fileInputRef} className="hidden" onChange={handleFileUpload}/><Button variant="secondary" onClick={()=>fileInputRef.current?.click()}><Upload size={16}/> นำเข้า CSV</Button><Button onClick={()=>openModal()}><Plus size={16}/> เพิ่ม</Button></div>
        </div>
        <Card className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]"><thead className="bg-gray-50 text-gray-500"><tr><th className="text-left p-3">รหัส</th><th className="text-left p-3">ชื่อ-สกุล</th>{activeTab==='students'&&<th className="text-left p-3">ระดับชั้น / ห้อง</th>}{activeTab==='teachers'&&<th className="text-left p-3">รหัสผ่าน</th>}<th className="text-right p-3">จัดการ</th></tr></thead><tbody>{filteredUsers.map(user=><tr key={user.id} className="border-t hover:bg-gray-50"><td className="p-3 font-medium">{user.id}</td><td className="p-3">{user.title}{user.fname} {user.lname}</td>{activeTab==='students'&&<td className="p-3">{user.level} / {user.room}</td>}{activeTab==='teachers'&&<td className="p-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${user.teacherPasswordSet ? 'bg-green-50 text-green-700' : user.teacherTempHash ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{user.teacherPasswordSet ? 'ตั้งแล้ว' : user.teacherTempHash ? 'รอตั้งรหัส' : 'ยังไม่เปิดใช้งาน'}</span></td>}<td className="p-3"><div className="flex justify-end gap-1">{activeTab==='teachers'&&<button title={user.teacherPasswordSet ? 'รีเซ็ตรหัสผ่าน' : 'สร้างรหัสตั้งต้น'} onClick={()=>handleTeacherSetupCode(user)} className="p-2 text-green-600 hover:bg-green-50 rounded"><ShieldCheck size={16}/></button>}<button onClick={()=>openModal(user)} className="p-2 text-blue-600 hover:bg-blue-50 rounded"><Edit2 size={16}/></button><button onClick={()=>handleDelete(user.id)} className="p-2 text-red-600 hover:bg-red-50 rounded"><Trash2 size={16}/></button></div></td></tr>)}{!filteredUsers.length&&<tr><td colSpan={activeTab==='teachers'?4:4} className="p-8 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>}</tbody></table></Card>
      </div>}

      {activeTab === 'catalogs' && <div className="grid md:grid-cols-2 gap-6">
        <Card><div className="flex justify-between items-center mb-4"><div><h3 className="font-bold">คลังระดับชั้น</h3><p className="text-xs text-gray-500">อาจารย์จะเลือกได้จากรายการนี้เท่านั้น</p></div><Button onClick={()=>addCatalog('levels','ระดับชั้น')}><Plus size={16}/> เพิ่ม</Button></div><div className="space-y-2">{LEVELS.map(v=><div key={v} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"><span className="font-medium">{v}</span><button onClick={()=>removeCatalog('levels',v,'ระดับชั้น')} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button></div>)}</div></Card>
        <Card><div className="flex justify-between items-center mb-4"><div><h3 className="font-bold">คลังห้อง</h3><p className="text-xs text-gray-500">เพิ่มหรือลบห้องเรียนได้จากที่นี่</p></div><Button onClick={()=>addCatalog('rooms','ห้อง')}><Plus size={16}/> เพิ่ม</Button></div><div className="space-y-2">{ROOMS.map(v=><div key={v} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"><span className="font-medium">ห้อง {v}</span><button onClick={()=>removeCatalog('rooms',v,'ห้อง')} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button></div>)}</div></Card>
      </div>}

      {activeTab === 'projects' && <TeacherView user={currentUser} db={db} handleUpdate={handleUpdate} showToast={showToast} askConfirm={askConfirm} askPrompt={askPrompt} adminMode />}

      <Modal isOpen={isModalOpen} onClose={()=>setIsModalOpen(false)} title={editingUser?'แก้ไขข้อมูล':'เพิ่มข้อมูลใหม่'}>
        <div className="space-y-4">
          <Input label="รหัส (ใช้ Login)" value={formData.id} onChange={e=>setFormData({...formData,id:e.target.value.trim()})} disabled={!!editingUser}/>
          <div className="grid grid-cols-3 gap-3"><Select label="คำนำหน้า" value={formData.title} onChange={e=>setFormData({...formData,title:e.target.value})} options={['นาย','นางสาว','นาง','อาจารย์','ดร.','ผศ.','รศ.']}/><div className="col-span-2"><Input label="ชื่อ" value={formData.fname} onChange={e=>setFormData({...formData,fname:e.target.value})}/></div></div>
          <Input label="นามสกุล" value={formData.lname} onChange={e=>setFormData({...formData,lname:e.target.value})}/>
          {activeTab==='students'&&<div className="grid grid-cols-2 gap-3"><Select label="ระดับชั้น" value={formData.level} onChange={e=>setFormData({...formData,level:e.target.value})} options={LEVELS}/><Select label="ห้อง" value={formData.room} onChange={e=>setFormData({...formData,room:e.target.value})} options={ROOMS}/></div>}
          <div className="flex justify-end gap-2 pt-3"><Button variant="secondary" onClick={()=>setIsModalOpen(false)}>ยกเลิก</Button><Button onClick={handleSave}>บันทึก</Button></div>
        </div>
      </Modal>

      <Modal isOpen={setupCodeDialog.isOpen} onClose={()=>setSetupCodeDialog({isOpen:false,code:'',teacherName:''})} title="รหัสตั้งต้นสำหรับอาจารย์">
        <div className="space-y-5">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm text-gray-600">ส่งรหัสนี้ให้อาจารย์ <b>{setupCodeDialog.teacherName}</b> โดยตรง ระบบจะให้อาจารย์ตั้งรหัสผ่านส่วนตัวใหม่ทันทีหลังยืนยันรหัสตั้งต้น</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-2">รหัสตั้งต้น 6 หลัก</p>
            <div className="text-4xl font-bold tracking-[0.25em] text-blue-700 bg-gray-50 border rounded-xl py-5">{setupCodeDialog.code}</div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={async()=>{ try { await navigator.clipboard.writeText(setupCodeDialog.code); showToast('คัดลอกรหัสตั้งต้นแล้ว'); } catch (_) { showToast('คัดลอกไม่สำเร็จ กรุณาจดรหัสไว้','error'); } }}><Copy size={16}/> คัดลอก</Button>
            <Button onClick={()=>setSetupCodeDialog({isOpen:false,code:'',teacherName:''})}>เสร็จสิ้น</Button>
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
  const [groupForm, setGroupForm] = useState({ id: '', name: '', teacherId: adminMode ? '' : String(user.id ?? ''), level: LEVELS[0], room: ROOMS[0], members: [], milestones: [], links: [] });
  const [searchStudent, setSearchStudent] = useState('');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [milestoneDrafts, setMilestoneDrafts] = useState({});

  const myGroups = adminMode ? db.groups : db.groups.filter(g => String(g.teacherId ?? '') === String(user.id ?? ''));
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
  }, [activeGroupId]);

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
  // คัดลอกเฉพาะชื่อกลุ่ม ระดับชั้น ห้อง และสมาชิก ไม่คัดลอกผลประเมิน/กำหนดส่ง/ลิงก์
  const groupTemplateSourceGroups = (db.groups || []).filter(g => {
    if (adminMode) return true;
    return String(g.teacherId ?? '') !== String(user.id ?? '');
  });

  const groupTemplateTeacherOptions = Array.from(new Set(groupTemplateSourceGroups.map(g => String(g.teacherId ?? '')).filter(Boolean)))
    .map(id => ({ value: id, label: getTeacherDisplayName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'th'));

  const visibleGroupTemplates = groupTemplateSourceGroups
    .filter(g => groupTemplateTeacherFilter === 'all' || String(g.teacherId ?? '') === groupTemplateTeacherFilter)
    .sort((a, b) => {
      const teacherCompare = getTeacherDisplayName(a.teacherId).localeCompare(getTeacherDisplayName(b.teacherId), 'th');
      if (teacherCompare !== 0) return teacherCompare;
      const levelCompare = String(a.level || '').localeCompare(String(b.level || ''), 'th');
      if (levelCompare !== 0) return levelCompare;
      const roomCompare = String(a.room || '').localeCompare(String(b.room || ''), 'th');
      if (roomCompare !== 0) return roomCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), 'th');
    });

  const getStudentName = (id) => {
    const s = db.users.find(u => String(u.id ?? '') === String(id ?? ''));
    return s ? `${s.fname} ${s.lname}` : id;
  };

  const handleSaveGroup = async () => {
    if(!groupForm.name) return showToast('กรุณากรอกชื่อกลุ่ม', 'error');
    if(groupForm.members.length > 6) return showToast('1 กลุ่มมีสมาชิกได้ไม่เกิน 6 คน', 'error');
    if(adminMode && !groupForm.teacherId) return showToast('กรุณาเลือกอาจารย์ผู้ควบคุม', 'error');

    const normalizedGroup = {
      ...groupForm,
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
    
    const applyTpl = () => {
      const appliedMilestones = tpl.milestones.map((m, idx) => ({
        id: `${makeEntityId('m')}_${idx}`,
        order: idx + 1,
        desc: m.desc,
        percent: m.percent,
        status: 'pending',
        assignDate: toDateInputValue(),
        dueDate: ''
      }));
      updateMilestones(appliedMilestones);
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

    const copiedMembers = (source.members || []).map(id => String(id));
    setGroupForm({
      id: '',
      name: source.name || '',
      teacherId: adminMode ? String(source.teacherId ?? '') : String(user.id ?? ''),
      level: source.level || LEVELS[0],
      room: source.room || ROOMS[0],
      members: copiedMembers,
      milestones: [],
      links: []
    });
    setSearchStudent('');
    setIsGroupTemplateModalOpen(false);
    setIsGroupModalOpen(true);
    showToast('คัดลอกกลุ่มต้นแบบแล้ว กรุณาตรวจสอบชื่อกลุ่มและสมาชิกก่อนบันทึก');
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

  return (
    <div className="space-y-6 flex flex-col md:flex-row gap-6">
      <div className="w-full md:w-1/3 flex flex-col gap-4">
        <div className="flex justify-between items-center gap-2">
          <h2 className="text-xl font-bold text-gray-800">{adminMode ? 'กลุ่มโครงงานทั้งหมด' : 'กลุ่มโครงงานของฉัน'}</h2>
          <div className="flex gap-2 flex-wrap justify-end">
            {!adminMode && <Button variant="secondary" onClick={()=>setIsPasswordModalOpen(true)} className="py-1.5 px-3 text-sm"><ShieldCheck size={16}/> รหัสผ่าน</Button>}
            {!adminMode && <Button variant="secondary" onClick={() => { setGroupTemplateTeacherFilter('all'); setIsGroupTemplateModalOpen(true); }} className="py-1.5 px-3 text-sm"><Copy size={16}/> คัดลอกกลุ่ม</Button>}
            <Button onClick={() => { setGroupForm({ id: '', name: '', teacherId: adminMode ? '' : String(user.id ?? ''), level: LEVELS[0], room: ROOMS[0], members: [], milestones: [], links: [] }); setIsGroupModalOpen(true); }} className="py-1.5 px-3 text-sm"><Plus size={16}/> สร้าง</Button>
          </div>
        </div>
        <div className="space-y-3">
          {myGroups.map(group => (
             <Card key={group.id} className={`cursor-pointer transition-all p-4 ${activeGroupId === group.id ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/30' : 'hover:border-blue-300'}`}>
             <div onClick={() => setActiveGroupId(group.id)}>
               <h3 className="font-semibold text-gray-800 line-clamp-1">{group.name}</h3>
               <p className="text-xs text-gray-500 mt-1">{group.level} / {group.room} • สมาชิก {group.members.length} คน</p>
               <div className="mt-3">
                 <ProgressBar percent={calculateGroupProgress(group.milestones)} />
               </div>
               {hasRejectedMilestone(group.milestones) && (
                 <p className="text-xs text-red-500 mt-2 flex items-center gap-1 font-medium"><AlertCircle size={12}/> มีรายการไม่อนุมัติ (หมดสิทธิ์สอบ)</p>
               )}
             </div>
           </Card>
          ))}
          {myGroups.length === 0 && <p className="text-sm text-gray-500 text-center py-4 bg-gray-50 rounded-lg">ยังไม่มีกลุ่มโครงงาน</p>}
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
                    <span key={mid} className="bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full border border-gray-200">{getStudentName(mid)}</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                 <Button variant="danger" onClick={handleDeleteGroup}><Trash2 size={16}/></Button>
                 <Button variant="secondary" onClick={() => { setGroupForm(activeGroup); setIsGroupModalOpen(true); }}><Edit2 size={16}/> แก้ไข</Button>
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
                <p className="font-medium">ยังไม่มีกลุ่มต้นแบบในรายการที่เลือก</p>
                <p className="text-xs mt-1">ลองเลือกอาจารย์ท่านอื่น หรือให้อาจารย์สร้างกลุ่มก่อน</p>
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
            <Select label="ห้อง" value={groupForm.room} onChange={e => setGroupForm({...groupForm, room: e.target.value, members: []})} options={ROOMS} />
          </div>
          <div className="pt-2 border-t border-gray-100">
             <div className="flex justify-between items-center mb-2"><p className="text-sm font-medium">เลือกนักศึกษาเข้ากลุ่ม</p><span className={`text-xs font-semibold ${groupForm.members.length>=6?'text-red-500':'text-gray-400'}`}>{groupForm.members.length}/6 คน</span></div>
             <div className="flex flex-wrap gap-2 mb-3">
              {groupForm.members.map(mid => (
                <div key={mid} className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-2 py-1 rounded-md flex items-center gap-1">
                  {getStudentName(mid)}
                  <button onClick={() => setGroupForm(p => ({...p, members: p.members.filter(id=>String(id)!==String(mid))}))} className="text-blue-400 hover:text-red-500"><X size={14}/></button>
                </div>
              ))}
            </div>
            <input 
              type="text" placeholder="ค้นหาด้วยรหัส ชื่อ หรือนามสกุล..." value={searchStudent} onChange={e => setSearchStudent(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {searchStudent && (
              <div className="mt-1 border border-gray-200 rounded-lg shadow-sm max-h-40 overflow-y-auto bg-white">
                {db.users.filter(u => {
                  const normalize = (value) => String(value ?? '').normalize('NFC').toLowerCase().replace(/[\s.\-_\/]+/g, '');
                  const q = normalize(searchStudent);
                  const sameLevel = normalize(u.level) === normalize(groupForm.level);
                  const sameRoom = normalize(u.room) === normalize(groupForm.room);
                  const haystack = normalize(`${u.id} ${u.title || ''} ${u.fname || ''} ${u.lname || ''}`);
                  return u.role === 'student' && sameLevel && sameRoom && !groupForm.members.some(mid => String(mid) === String(u.id)) && haystack.includes(q);
                }).map(student => (
                  <div key={student.id} onClick={() => { if(groupForm.members.length>=6) return showToast('1 กลุ่มมีสมาชิกได้ไม่เกิน 6 คน','error'); setGroupForm(p => ({...p, members: [...p.members, String(student.id)]})); setSearchStudent(''); }} className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                    {student.fname} {student.lname} ({student.id})
                  </div>
                ))}
                {db.users.filter(u => {
                  const normalize = (value) => String(value ?? '').normalize('NFC').toLowerCase().replace(/[\s.\-_\/]+/g, '');
                  const q = normalize(searchStudent);
                  const sameLevel = normalize(u.level) === normalize(groupForm.level);
                  const sameRoom = normalize(u.room) === normalize(groupForm.room);
                  const haystack = normalize(`${u.id} ${u.title || ''} ${u.fname || ''} ${u.lname || ''}`);
                  return u.role === 'student' && sameLevel && sameRoom && !groupForm.members.some(mid => String(mid) === String(u.id)) && haystack.includes(q);
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
  const myProjects = db.groups.filter(g => g.members.includes(targetStudent?.id));
  
  if (!targetStudent) return null;

  const calculateTotalOverallProgress = () => {
    if (myProjects.length === 0) return 0;
    const totalProgress = myProjects.reduce((sum, p) => sum + calculateGroupProgress(p.milestones), 0);
    return totalProgress / myProjects.length;
  };

  const getTeacherName = (tId) => {
    const t = db.users.find(u => u.id === tId);
    return t ? `${t.title}${t.fname} ${t.lname}` : 'ไม่ระบุ';
  };

  const submitLink = (groupId) => {
    askPrompt('กรุณาวาง URL/Link งานที่ต้องการส่ง', (url) => {
      if(!url) return;
      if(!url.startsWith('http')) return showToast('รูปแบบ Link ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http)', 'error');
      const submission = {
        id: makeEntityId('sub'),
        groupId,
        studentUid: targetStudent.uid,
        studentId: targetStudent.id,
        url,
        createdAt: Date.now()
      };
      handleUpdate('submissions', [...(db.submissions || []), submission]);
      showToast('ส่งลิงก์งานเรียบร้อยแล้ว');
    });
  }

  const overallProgress = calculateTotalOverallProgress();
  const hasAnyRejection = myProjects.some(p => hasRejectedMilestone(p.milestones));
  const sameLevelGroups = db.groups.filter(g => g.level === targetStudent.level);
  const sameLevelRooms = [...new Set(sameLevelGroups.map(g => g.room))].sort();
  const allLevels = db.catalogs?.levels?.length ? db.catalogs.levels : DEFAULT_LEVELS;
  const parentLevelSummary = allLevels.map(level => {
    const gs = db.groups.filter(g => g.level === level);
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
          {isParent && <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm">โหมดผู้เข้าชม (ผู้ปกครอง)</span>}
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
            {sameLevelRooms.map(room => { const gs=sameLevelGroups.filter(g=>g.room===room); const p=gs.length?gs.reduce((a,g)=>a+calculateGroupProgress(g.milestones||[]),0)/gs.length:0; return <div key={room} className="p-3 rounded-xl bg-gray-50 border border-gray-100"><p className="text-sm font-bold mb-2">ห้อง {room} <span className="text-xs font-normal text-gray-400">({gs.length} กลุ่ม)</span></p><ProgressBar percent={p}/></div> })}
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

export default function App() {
  const [db, setDb] = useState({ users: [], groups: [], templates: [], submissions: [], catalogs: { levels: DEFAULT_LEVELS, rooms: DEFAULT_ROOMS } });
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingTeacherSetup, setPendingTeacherSetup] = useState(null);
  const [firstPassword, setFirstPassword] = useState('');
  const [confirmFirstPassword, setConfirmFirstPassword] = useState('');
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, msg: '', onConfirm: null });
  const [promptDialog, setPromptDialog] = useState({ isOpen: false, title: '', onSubmit: null, value: '' });

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
  const canonicalUserDocId = user => `${String(user?.role || '').trim().toLowerCase()}_${safeDocId(normalizeUserId(user?.id))}`;

  const getDocsArray = async name => {
    const snap = await getDocs(collection(firestore, name));
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  };

  const ensureAnonymousSession = async () => {
    if (auth.currentUser?.isAnonymous) return auth.currentUser;
    if (auth.currentUser) {
      try { await signOut(auth); } catch (_) {}
    }
    const cred = await signInAnonymously(auth);
    return cred.user;
  };

  const ensureBaseData = async () => {
    const [usersSnap, catSnap] = await Promise.all([
      getDocs(collection(firestore, 'users')),
      getDoc(doc(firestore, 'catalogs', 'default'))
    ]);

    const hasAdmin = usersSnap.docs.some(d => {
      const u = d.data();
      return u.role === 'admin' && String(u.id || '').trim().toLowerCase() === 'admin' && u.active !== false;
    });

    if (!hasAdmin) {
      await setDoc(doc(firestore, 'users', 'admin_default'), {
        uid: 'admin_default',
        id: 'admin',
        role: 'admin',
        title: '',
        fname: 'ผู้จัดการ',
        lname: 'ระบบ',
        active: true,
        createdAt: Date.now()
      }, { merge: true });
    }

    if (!catSnap.exists()) {
      await setDoc(doc(firestore, 'catalogs', 'default'), { levels: DEFAULT_LEVELS, rooms: DEFAULT_ROOMS });
    }
  };

  const loadAllData = async () => {
    const [usersRaw, groupsRaw, templatesRaw, submissionsRaw, catSnap] = await Promise.all([
      getDocsArray('users'),
      getDocsArray('groups'),
      getDocsArray('templates'),
      getDocsArray('submissions'),
      getDoc(doc(firestore, 'catalogs', 'default'))
    ]);

    // Firestore อาจมีเอกสารเก่าซ้ำจากเวอร์ชันก่อนหน้า แม้จะเป็นรหัสคนเดียวกัน
    // จึงรวมตาม role + id ก่อนแสดงผล เพื่อให้ยอดนักศึกษา/อาจารย์ตรงกับคนจริง
    const normalizedUsersRaw = usersRaw
      .filter(u => u.role !== 'disabled' && u.active !== false)
      .map(u => ({ ...u, id: normalizeUserId(u.id), uid: u._docId }))
      .filter(u => u.id && u.role)
      .sort((a, b) => Number(a.updatedAt || a.createdAt || 0) - Number(b.updatedAt || b.createdAt || 0));

    const usersByKey = new Map();
    for (const u of normalizedUsersRaw) {
      const key = logicalUserKey(u);
      const before = usersByKey.get(key);
      usersByKey.set(key, before ? { ...before, ...u, id: normalizeUserId(u.id), uid: u._docId, _docId: u._docId } : u);
    }
    const users = [...usersByKey.values()];

    const groups = groupsRaw.map(g => ({
      ...g,
      id: String(g.id ?? g._docId),
      teacherId: g.teacherId != null ? String(g.teacherId).trim() : '',
      members: (g.members || []).map(id => String(id).trim())
    }));

    const templates = templatesRaw.map(t => ({ ...t, teacherId: t.teacherId != null ? String(t.teacherId).trim() : t.teacherId }));
    const submissions = submissionsRaw.map(s => ({ ...s, studentId: s.studentId != null ? String(s.studentId).trim() : s.studentId }));
    const catalogs = catSnap.exists() ? catSnap.data() : { levels: DEFAULT_LEVELS, rooms: DEFAULT_ROOMS };

    const nextDb = { users, groups, templates, submissions, catalogs };
    setDb(nextDb);
    return nextDb;
  };

  const restoreWebSession = nextDb => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('dmd_web_session') || 'null');
      if (!saved?.role) return;
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
        await ensureBaseData();
        const nextDb = await loadAllData();
        if (!cancelled) restoreWebSession(nextDb);
      } catch (err) {
        console.error('init', err);
        if (!cancelled) showToast(`ไม่สามารถเริ่มระบบได้: ${err?.message || err}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const syncUsers = async (nextUsers, options = {}) => {
    const forceCanonicalize = options.forceCanonicalize === true;

    // snapshot ก่อนแก้จากหน้าจอ ใช้เพียงเพื่อหาว่า "คนไหนเปลี่ยนจริง"
    // จะไม่เขียนผู้ใช้ทุกคนทับกันอีกแล้ว เพราะอาจารย์หลายคนใช้งานพร้อมกันได้
    const localMap = new Map();
    for (const raw of db.users.filter(u => ['student','teacher'].includes(u.role))) {
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
      delete x._docId;
      delete x.uid;
      delete x.updatedAt;
      delete x.createdAt;
      delete x.email;
      return x;
    };

    const changedKeys = new Set();
    for (const [key, nextUser] of nextMap.entries()) {
      const before = localMap.get(key);
      if (forceCanonicalize || !before || JSON.stringify(comparable(before)) !== JSON.stringify(comparable(nextUser))) {
        changedKeys.add(key);
      }
    }
    for (const key of localMap.keys()) {
      if (!nextMap.has(key)) changedKeys.add(key);
    }

    // อ่านฐานข้อมูลจริง ณ เวลาบันทึก เพื่อ merge กับข้อมูลล่าสุดก่อนเขียน
    const remoteSnap = await getDocs(collection(firestore, 'users'));
    const remoteUsers = remoteSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));
    const remoteByKey = new Map();
    for (const u of remoteUsers) {
      if (!['student','teacher'].includes(u.role) || u.active === false || !normalizeUserId(u.id)) continue;
      const key = logicalUserKey(u);
      const arr = remoteByKey.get(key) || [];
      arr.push(u);
      remoteByKey.set(key, arr);
    }

    for (const [key, u] of nextMap.entries()) {
      if (!changedKeys.has(key)) continue;

      const candidates = (remoteByKey.get(key) || [])
        .slice()
        .sort((a, b) => Number(a.updatedAt || a.createdAt || 0) - Number(b.updatedAt || b.createdAt || 0));

      let mergedRemote = {};
      for (const candidate of candidates) mergedRemote = { ...mergedRemote, ...candidate };

      const docId = canonicalUserDocId(u);
      const profile = {
        ...clean(mergedRemote),
        ...clean(u),
        id: normalizeUserId(u.id),
        uid: docId,
        active: true,
        updatedAt: Date.now()
      };
      delete profile._docId;
      delete profile.email;

      await setDoc(doc(firestore, 'users', docId), profile, { merge: true });

      // ลบเอกสารซ้ำ/legacy เฉพาะคนที่กำลังบันทึก หรือระหว่าง repair
      for (const candidate of candidates) {
        if (candidate._docId && candidate._docId !== docId) {
          await deleteDoc(doc(firestore, 'users', candidate._docId));
        }
      }
    }

    // ลบเฉพาะ student/teacher ที่ผู้ใช้ลบออกจากรายการจริง
    for (const remote of remoteUsers) {
      if (!['student','teacher'].includes(remote.role) || !normalizeUserId(remote.id)) continue;
      const key = logicalUserKey(remote);
      if (!nextMap.has(key) && changedKeys.has(key) && remote._docId) {
        await deleteDoc(doc(firestore, 'users', remote._docId));
      }
    }
  };

  const syncGroups = async nextGroups => {
    const normalizeGroup = g => ({
      ...clean(g),
      id: String(g.id),
      teacherId: g.teacherId != null ? String(g.teacherId).trim() : '',
      members: (g.members || []).map(id => String(id).trim())
    });
    const core = g => {
      const x = normalizeGroup(g);
      delete x.updatedAt;
      delete x._docId;
      delete x.teacherUid;
      delete x.memberUids;
      return x;
    };

    const prevMap = new Map(db.groups.map(g => [String(g.id), g]));
    const nextMap = new Map(nextGroups.map(g => [String(g.id), normalizeGroup(g)]));

    for (const [id, g] of nextMap.entries()) {
      const before = prevMap.get(id);
      if (before && JSON.stringify(core(before)) === JSON.stringify(core(g))) continue;
      const teacher = db.users.find(u => u.role === 'teacher' && String(u.id) === String(g.teacherId));
      const enriched = {
        ...g,
        teacherName: teacher ? `${teacher.title || ''}${teacher.fname || ''} ${teacher.lname || ''}`.trim() : (g.teacherName || ''),
        updatedAt: Date.now()
      };
      await setDoc(doc(firestore, 'groups', id), enriched);
    }

    for (const [id] of prevMap.entries()) {
      if (!nextMap.has(id)) await deleteDoc(doc(firestore, 'groups', id));
    }
  };

  const syncSimpleCollection = async (name, prev, next) => {
    const cleanCore = item => {
      const x = clean(item);
      delete x.updatedAt;
      delete x._docId;
      if (x.teacherId != null) x.teacherId = String(x.teacherId).trim();
      if (x.studentId != null) x.studentId = String(x.studentId).trim();
      return x;
    };
    const prevMap = new Map((prev || []).map(item => [String(item.id), item]));
    const nextMap = new Map((next || []).map(item => [String(item.id), cleanCore(item)]));

    for (const [id, item] of nextMap.entries()) {
      const before = prevMap.get(id);
      if (before && JSON.stringify(cleanCore(before)) === JSON.stringify(item)) continue;
      await setDoc(doc(firestore, name, id), { ...item, updatedAt: Date.now() });
    }
    for (const [id] of prevMap.entries()) {
      if (!nextMap.has(id)) await deleteDoc(doc(firestore, name, id));
    }
  };

  const handleUpdate = async (collectionKey, newData) => {
    const previous = db[collectionKey];
    setDb(prev => ({ ...prev, [collectionKey]: newData }));
    try {
      await ensureAnonymousSession();
      if (collectionKey === 'catalogs') await setDoc(doc(firestore, 'catalogs', 'default'), clean(newData));
      else if (collectionKey === 'users') await syncUsers(newData);
      else if (collectionKey === 'groups') await syncGroups(newData);
      else if (collectionKey === 'templates') await syncSimpleCollection('templates', db.templates, newData);
      else if (collectionKey === 'submissions') await syncSimpleCollection('submissions', db.submissions, newData);

      let fresh = await loadAllData();
      if (currentUser && role) {
        const refreshed = fresh.users.find(u => u.role === currentUser.role && String(u.id) === String(currentUser.id));
        if (refreshed) setCurrentUser(refreshed);
      }
      return true;
    } catch (err) {
      console.error(err);
      setDb(prev => ({ ...prev, [collectionKey]: previous }));
      showToast(`บันทึกไม่สำเร็จ: ${err?.message || err}`, 'error');
      return false;
    }
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

  const handleLogin = async e => {
    e.preventDefault();
    try {
      setLoading(true);
      await ensureAnonymousSession();
      let fresh = await loadAllData();

      if (role === 'parent') {
        const q = searchQuery.trim().toLowerCase();
        const student = fresh.users.find(u => u.role === 'student' && (
          String(u.id).toLowerCase() === q ||
          String(u.fname || '').toLowerCase().includes(q) ||
          String(u.lname || '').toLowerCase().includes(q)
        ));
        if (!student) throw new Error('ไม่พบข้อมูลนักศึกษาที่ค้นหา');
        setCurrentUser(student);
        sessionStorage.setItem('dmd_web_session', JSON.stringify({ role: 'parent', id: student.id }));
        return;
      }

      const rawId = loginId.trim();
      if (!rawId) throw new Error('กรุณากรอกรหัสผู้ใช้งาน');
      let user = fresh.users.find(u => u.role === role && String(u.id).trim().toLowerCase() === rawId.toLowerCase());
      if (!user) throw new Error('รหัสผู้ใช้งานไม่ถูกต้อง หรือยังไม่มีรหัสนี้ในระบบ');

      if (role === 'admin') {
        if (!loginPassword) throw new Error('กรุณากรอกรหัสผ่านผู้จัดการระบบ');
        if (loginPassword !== ADMIN_PASSWORD) throw new Error('รหัสผ่านผู้จัดการระบบไม่ถูกต้อง');

        // ซ่อมเอกสาร user ซ้ำจากเวอร์ชันเก่าอัตโนมัติเมื่อ Admin เข้าใช้งาน
        // ทำให้ยอดนักศึกษา/อาจารย์ตรงกับรหัสที่ไม่ซ้ำ และย้ายไป document id มาตรฐาน
        await syncUsers(fresh.users, { forceCanonicalize: true });
        fresh = await loadAllData();
        user = fresh.users.find(u => u.role === role && String(u.id).trim().toLowerCase() === rawId.toLowerCase());
        if (!user) throw new Error('ไม่พบข้อมูลผู้จัดการระบบหลังตรวจสอบฐานข้อมูล');
      }

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
    try {
      await ensureAnonymousSession();
      await loadAllData();
    } catch (_) {}
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4"><Loader2 className="animate-spin text-blue-600 mb-4" size={48}/><h2 className="text-xl font-semibold text-gray-700">DMD Integrated Project Tracking System</h2><p className="text-sm text-gray-500 mt-2">โปรดรอสักครู่</p></div>;
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
                <Button variant="secondary" className="w-full justify-start py-3" onClick={() => setRole('parent')}><Search className="text-amber-500"/> ผู้เข้าชม (Parent)</Button>
                <Button variant="secondary" className="w-full justify-start py-3" onClick={() => setRole('admin')}><Settings className="text-gray-500"/> ผู้จัดการระบบ (Admin)</Button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center gap-2 text-blue-600 font-semibold mb-2"><button type="button" onClick={() => setRole(null)} className="p-1 hover:bg-blue-50 rounded"><ChevronRight className="rotate-180" size={18}/></button>เข้าสู่ระบบในฐานะ {role === 'student' ? 'นักศึกษา' : role === 'teacher' ? 'อาจารย์ผู้ควบคุม' : role === 'admin' ? 'ผู้จัดการระบบ' : 'ผู้เข้าชม'}</div>
                {role === 'parent'
                  ? <Input label="ค้นหานักศึกษา" placeholder="กรอกรหัสนักศึกษา หรือ ชื่อ..." required value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
                  : <Input label="รหัสผู้ใช้งาน" placeholder={role === 'admin' ? 'กรอก admin' : 'กรอกรหัส...'} required value={loginId} onChange={e => setLoginId(e.target.value)}/>
                }
                {role === 'teacher' && <Input label="รหัสผ่าน" type="password" placeholder="กรอกรหัสผ่าน หรือรหัสตั้งต้นครั้งแรก" required value={loginPassword} onChange={e=>setLoginPassword(e.target.value)}/>}
                {role === 'admin' && <Input label="รหัสผ่านผู้จัดการระบบ" type="password" placeholder="กรอกรหัสผ่าน" required value={loginPassword} onChange={e=>setLoginPassword(e.target.value)}/>}
                <Button type="submit" className="w-full mt-4">เข้าสู่ระบบ</Button>
                <div className="text-xs text-gray-400 mt-6 pt-4 border-t text-center flex flex-col gap-1 items-center justify-center"><span className="flex items-center gap-1"><ShieldCheck size={14}/> ระบบพร้อมใช้งาน</span><span>{role === 'admin' ? 'เข้าสู่ระบบด้วยรหัสผู้ใช้ admin และรหัสผ่านผู้จัดการระบบ' : role === 'parent' ? 'ค้นหาด้วยรหัสหรือชื่อนักศึกษา' : role === 'teacher' ? 'ใช้รหัสอาจารย์ + รหัสผ่านส่วนตัว' : 'ใช้รหัสประจำตัวเข้าสู่ระบบได้โดยตรง'}</span></div>
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
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">D</div><h1 className="font-bold text-lg hidden sm:block">DMD Project Tracking</h1></div><div className="flex items-center gap-4"><div className="text-right hidden md:block"><p className="text-sm font-semibold">{currentUser.title}{currentUser.fname} {currentUser.lname}</p><p className="text-xs text-gray-500 capitalize">{role}</p></div><button onClick={logout} className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2 text-sm font-medium"><LogOut size={18}/> <span className="hidden sm:inline">ออกจากระบบ</span></button></div></div></header>
      <main className="flex-grow w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-500">
        {role === 'admin' && <AdminView db={db} handleUpdate={handleUpdate} showToast={showToast} askConfirm={askConfirm} askPrompt={askPrompt} currentUser={currentUser}/>} 
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

import React, { useState, useEffect, useRef } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db as firestore, firebaseConfig } from './firebase';
import { 
  Users, UserCircle, LogOut, Search, Plus, Trash2, Edit2, 
  CheckCircle, Clock, Link as LinkIcon, BarChart3, Settings, 
  ChevronRight, AlertCircle, Check, X, XCircle, Download, Upload, Bookmark, Copy,
  Loader2, Info, GraduationCap, School, LayoutDashboard, FolderKanban, ShieldCheck
} from 'lucide-react';

const DEFAULT_LEVELS = ['ปวช. 1', 'ปวช. 2', 'ปวช. 3', 'ปวส. 1', 'ปวส. 2'];
const DEFAULT_ROOMS = ['1', '2', '3', '4'];

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
  const fileInputRef = useRef(null);

  const isUserTab = activeTab === 'students' || activeTab === 'teachers';
  const filteredUsers = db.users.filter(u => u.role === (activeTab === 'students' ? 'student' : 'teacher'));

  const handleSave = () => {
    if(!formData.id || !formData.fname || !formData.lname) return showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error');
    let newUsers = [...db.users];
    const roleName = activeTab === 'students' ? 'student' : 'teacher';
    if (editingUser) {
      newUsers = newUsers.map(u => u.id === editingUser.id ? { ...u, ...formData, role: roleName } : u);
      showToast('อัปเดตข้อมูลสำเร็จ');
    } else {
      if (newUsers.find(u => u.id === formData.id)) return showToast('รหัสนี้มีในระบบแล้ว', 'error');
      newUsers.push({ ...formData, role: roleName });
      showToast('เพิ่มผู้ใช้งานสำเร็จ');
    }
    handleUpdate('users', newUsers);
    setIsModalOpen(false);
  };

  const handleDelete = (id) => {
    askConfirm('ต้องการลบผู้ใช้งานนี้ใช่หรือไม่?', () => {
      handleUpdate('users', db.users.filter(u => u.id !== id));
      showToast('ลบข้อมูลสำเร็จ');
    });
  };

  const openModal = (user = null) => {
    setEditingUser(user);
    setFormData(user || { id: '', title: activeTab === 'teachers' ? 'ครู' : 'นาย', fname: '', lname: '', level: LEVELS[0], room: ROOMS[0] });
    setIsModalOpen(true);
  };

  const downloadCSVTemplate = () => {
    const BOM = "\uFEFF";
    const header = activeTab === 'students'
      ? "id,title,fname,lname,level,room\n66001,นาย,สมชาย,ใจดี,ปวช. 1,1"
      : "id,title,fname,lname\nT001,ครู,สมศรี,สอนดี";
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
    reader.onload = (evt) => {
      const text = String(evt.target?.result || '').replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).filter(Boolean);
      const imported = [];
      const roleName = activeTab === 'students' ? 'student' : 'teacher';
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < 4 || !cols[0]) continue;
        const user = { id: cols[0], role: roleName, title: cols[1] || '', fname: cols[2] || '', lname: cols[3] || '' };
        if (roleName === 'student') {
          user.level = cols[4] || LEVELS[0];
          user.room = cols[5] || ROOMS[0];
        }
        imported.push(user);
      }
      if (!imported.length) return showToast('ไม่พบข้อมูลที่ถูกต้องในไฟล์ CSV', 'error');
      const oldWithoutDup = db.users.filter(u => !imported.some(n => n.id === u.id));
      handleUpdate('users', [...oldWithoutDup, ...imported]);
      showToast(`นำเข้าข้อมูลสำเร็จ ${imported.length} รายการ`);
      e.target.value = '';
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
    ['teachers', <School size={16}/>, 'ครูผู้ควบคุม'],
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
          <Card><p className="text-xs text-gray-500">ครูผู้ควบคุม</p><p className="text-3xl font-bold mt-2">{teachers.length}</p></Card>
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
          <div><h3 className="text-lg font-bold">{activeTab==='students'?'ข้อมูลนักศึกษา':'ข้อมูลครู'}</h3><p className="text-xs text-gray-500">เพิ่ม แก้ไข ลบ หรือนำเข้าด้วย CSV</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={downloadCSVTemplate}><Download size={16}/> ตัวอย่าง CSV</Button><input type="file" accept=".csv,text/csv" ref={fileInputRef} className="hidden" onChange={handleFileUpload}/><Button variant="secondary" onClick={()=>fileInputRef.current?.click()}><Upload size={16}/> นำเข้า CSV</Button><Button onClick={()=>openModal()}><Plus size={16}/> เพิ่ม</Button></div>
        </div>
        <Card className="overflow-x-auto"><table className="w-full text-sm min-w-[600px]"><thead className="bg-gray-50 text-gray-500"><tr><th className="text-left p-3">รหัส</th><th className="text-left p-3">ชื่อ-สกุล</th>{activeTab==='students'&&<th className="text-left p-3">ระดับชั้น / ห้อง</th>}<th className="text-right p-3">จัดการ</th></tr></thead><tbody>{filteredUsers.map(user=><tr key={user.id} className="border-t hover:bg-gray-50"><td className="p-3 font-medium">{user.id}</td><td className="p-3">{user.title}{user.fname} {user.lname}</td>{activeTab==='students'&&<td className="p-3">{user.level} / {user.room}</td>}<td className="p-3"><div className="flex justify-end gap-1"><button onClick={()=>openModal(user)} className="p-2 text-blue-600 hover:bg-blue-50 rounded"><Edit2 size={16}/></button><button onClick={()=>handleDelete(user.id)} className="p-2 text-red-600 hover:bg-red-50 rounded"><Trash2 size={16}/></button></div></td></tr>)}{!filteredUsers.length&&<tr><td colSpan={4} className="p-8 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>}</tbody></table></Card>
      </div>}

      {activeTab === 'catalogs' && <div className="grid md:grid-cols-2 gap-6">
        <Card><div className="flex justify-between items-center mb-4"><div><h3 className="font-bold">คลังระดับชั้น</h3><p className="text-xs text-gray-500">ครูจะเลือกได้จากรายการนี้เท่านั้น</p></div><Button onClick={()=>addCatalog('levels','ระดับชั้น')}><Plus size={16}/> เพิ่ม</Button></div><div className="space-y-2">{LEVELS.map(v=><div key={v} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"><span className="font-medium">{v}</span><button onClick={()=>removeCatalog('levels',v,'ระดับชั้น')} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button></div>)}</div></Card>
        <Card><div className="flex justify-between items-center mb-4"><div><h3 className="font-bold">คลังห้อง</h3><p className="text-xs text-gray-500">เพิ่มหรือลบห้องเรียนได้จากที่นี่</p></div><Button onClick={()=>addCatalog('rooms','ห้อง')}><Plus size={16}/> เพิ่ม</Button></div><div className="space-y-2">{ROOMS.map(v=><div key={v} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"><span className="font-medium">ห้อง {v}</span><button onClick={()=>removeCatalog('rooms',v,'ห้อง')} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button></div>)}</div></Card>
      </div>}

      {activeTab === 'projects' && <TeacherView user={currentUser} db={db} handleUpdate={handleUpdate} showToast={showToast} askConfirm={askConfirm} askPrompt={askPrompt} adminMode />}

      <Modal isOpen={isModalOpen} onClose={()=>setIsModalOpen(false)} title={editingUser?'แก้ไขข้อมูล':'เพิ่มข้อมูลใหม่'}>
        <div className="space-y-4">
          <Input label="รหัส (ใช้ Login)" value={formData.id} onChange={e=>setFormData({...formData,id:e.target.value.trim()})} disabled={!!editingUser}/>
          <div className="grid grid-cols-3 gap-3"><Select label="คำนำหน้า" value={formData.title} onChange={e=>setFormData({...formData,title:e.target.value})} options={['นาย','นางสาว','นาง','ครู','ดร.','ผศ.','รศ.']}/><div className="col-span-2"><Input label="ชื่อ" value={formData.fname} onChange={e=>setFormData({...formData,fname:e.target.value})}/></div></div>
          <Input label="นามสกุล" value={formData.lname} onChange={e=>setFormData({...formData,lname:e.target.value})}/>
          {activeTab==='students'&&<div className="grid grid-cols-2 gap-3"><Select label="ระดับชั้น" value={formData.level} onChange={e=>setFormData({...formData,level:e.target.value})} options={LEVELS}/><Select label="ห้อง" value={formData.room} onChange={e=>setFormData({...formData,room:e.target.value})} options={ROOMS}/></div>}
          <div className="flex justify-end gap-2 pt-3"><Button variant="secondary" onClick={()=>setIsModalOpen(false)}>ยกเลิก</Button><Button onClick={handleSave}>บันทึก</Button></div>
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
  const [groupForm, setGroupForm] = useState({ id: '', name: '', teacherId: adminMode ? '' : user.id, level: LEVELS[0], room: ROOMS[0], members: [], milestones: [], links: [] });
  const [searchStudent, setSearchStudent] = useState('');

  const myGroups = adminMode ? db.groups : db.groups.filter(g => g.teacherId === user.id);
  const myTemplates = adminMode ? (db.templates || []) : (db.templates?.filter(t => t.teacherId === user.id) || []);
  const activeGroup = myGroups.find(g => g.id === activeGroupId);

  const getStudentName = (id) => {
    const s = db.users.find(u => u.id === id);
    return s ? `${s.fname} ${s.lname}` : id;
  };

  const handleSaveGroup = () => {
    if(!groupForm.name) return showToast('กรุณากรอกชื่อกลุ่ม', 'error');
    if(groupForm.members.length > 6) return showToast('1 กลุ่มมีสมาชิกได้ไม่เกิน 6 คน', 'error');
    if(adminMode && !groupForm.teacherId) return showToast('กรุณาเลือกครูผู้ควบคุม', 'error');
    let newGroups = [...db.groups];
    if (groupForm.id) {
      newGroups = newGroups.map(g => g.id === groupForm.id ? groupForm : g);
      showToast('อัปเดตกลุ่มสำเร็จ');
    } else {
      const newId = 'g' + Date.now();
      newGroups.push({ ...groupForm, id: newId, teacherId: adminMode ? groupForm.teacherId : user.id });
      setActiveGroupId(newId);
      showToast('สร้างกลุ่มโครงงานสำเร็จ');
    }
    handleUpdate('groups', newGroups);
    setIsGroupModalOpen(false);
  };

  const handleDeleteGroup = () => {
    askConfirm('คุณแน่ใจหรือไม่ว่าต้องการลบกลุ่มโครงงานนี้? ข้อมูลการประเมินทั้งหมดจะหายไป', () => {
      handleUpdate('groups', db.groups.filter(g => g.id !== activeGroup.id));
      setActiveGroupId(null);
      showToast('ลบกลุ่มโครงงานสำเร็จ');
    });
  };

  const updateMilestones = (newMilestones) => {
    if (!activeGroup) return;
    const updatedGroups = db.groups.map(g => g.id === activeGroup.id ? { ...g, milestones: newMilestones } : g);
    handleUpdate('groups', updatedGroups);
  };

  const autoDistribute = (items) => {
    if (!items.length) return items;
    const base = Math.floor(100 / items.length);
    let remain = 100 - (base * items.length);
    return items.map((m, i) => ({ ...m, order: i + 1, percent: base + (remain-- > 0 ? 1 : 0) }));
  };

  const addMilestone = () => {
    const newM = { id: 'm' + Date.now(), order: activeGroup.milestones.length + 1, desc: 'รายการประเมินใหม่', percent: 0, status: 'pending' };
    updateMilestones(autoDistribute([...activeGroup.milestones, newM]));
  };

  const setMilestoneStatus = (milestoneId, status) => {
    const updated = activeGroup.milestones.map(m => m.id === milestoneId ? { ...m, status } : m);
    updateMilestones(updated);
  };

  const deleteMilestone = (milestoneId) => {
    askConfirm('ต้องการลบรายการประเมินนี้หรือไม่?', () => {
      updateMilestones(autoDistribute(activeGroup.milestones.filter(m => m.id !== milestoneId)));
    });
  }

  const saveAsTemplate = () => {
    if (!activeGroup || activeGroup.milestones.length === 0) return showToast('ไม่มีรายการประเมินให้บันทึก', 'error');
    
    askPrompt('กรุณาตั้งชื่อเทมเพลต', (name) => {
      if(!name) return;
      const newTemplate = {
        id: 'tpl' + Date.now(),
        teacherId: adminMode ? activeGroup.teacherId : user.id,
        name: name,
        milestones: activeGroup.milestones.map(m => ({ desc: m.desc, percent: m.percent })) 
      };
      handleUpdate('templates', [...(db.templates || []), newTemplate]);
      showToast('บันทึกเทมเพลตสำเร็จ');
    });
  };

  const loadTemplate = (templateId) => {
    const tpl = myTemplates.find(t => t.id === templateId);
    if (!tpl) return;
    
    const applyTpl = () => {
      const appliedMilestones = tpl.milestones.map((m, idx) => ({
        id: 'm' + Date.now() + idx,
        order: idx + 1,
        desc: m.desc,
        percent: m.percent,
        status: 'pending'
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

  return (
    <div className="space-y-6 flex flex-col md:flex-row gap-6">
      <div className="w-full md:w-1/3 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">{adminMode ? 'กลุ่มโครงงานทั้งหมด' : 'กลุ่มโครงงานของฉัน'}</h2>
          <Button onClick={() => { setGroupForm({ id: '', name: '', teacherId: adminMode ? '' : user.id, level: LEVELS[0], room: ROOMS[0], members: [], milestones: [], links: [] }); setIsGroupModalOpen(true); }} className="py-1.5 px-3 text-sm"><Plus size={16}/> สร้าง</Button>
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
                  <Button onClick={() => updateMilestones(autoDistribute(activeGroup.milestones))} variant="secondary" className="text-sm py-1.5">จัด % อัตโนมัติ</Button><Button onClick={addMilestone} className="text-sm py-1.5"><Plus size={16}/> เพิ่ม</Button>
                </div>
              </div>

              <div className="space-y-3">
                {activeGroup.milestones.map((m, idx) => (
                  <div key={m.id} className={`flex flex-col xl:flex-row gap-3 items-start xl:items-center p-3 rounded-lg border 
                    ${m.status === 'approved' ? 'bg-green-50/50 border-green-200' : 
                      m.status === 'rejected' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                    
                    <div className="flex-grow w-full flex items-center gap-3">
                       <span className="text-sm font-bold text-gray-400 w-4">{idx + 1}.</span>
                       <input 
                        type="text" value={m.desc} placeholder="รายละเอียด..."
                        onChange={(e) => updateMilestones(activeGroup.milestones.map(mx => mx.id === m.id ? {...mx, desc: e.target.value} : mx))}
                        className="flex-grow bg-transparent border-b border-transparent focus:border-blue-500 outline-none py-1 text-sm font-medium w-full min-w-0"
                      />
                    </div>
                    
                    <div className="flex items-center gap-2 flex-wrap w-full xl:w-auto justify-between xl:justify-end pl-7 xl:pl-0">
                      <div className="flex items-center">
                        <input 
                          type="number" value={m.percent}
                          onChange={(e) => updateMilestones(activeGroup.milestones.map(mx => mx.id === m.id ? {...mx, percent: Number(e.target.value)} : mx))}
                          className="w-14 text-center border border-gray-300 rounded py-1 text-sm outline-none focus:border-blue-500 bg-white"
                        />
                        <span className="text-gray-500 ml-1 text-sm">%</span>
                      </div>
                      
                      <div className="flex bg-gray-200/50 rounded-lg p-0.5 border border-gray-200">
                        <button onClick={() => setMilestoneStatus(m.id, 'pending')} 
                                className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 ${m.status === 'pending' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                          <Clock size={14}/> รอตรวจ
                        </button>
                        <button onClick={() => setMilestoneStatus(m.id, 'approved')} 
                                className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 ${m.status === 'approved' ? 'bg-green-500 text-white shadow-sm' : 'text-gray-500 hover:text-green-600'}`}>
                          <Check size={14}/> อนุมัติ
                        </button>
                        <button onClick={() => setMilestoneStatus(m.id, 'rejected')} 
                                className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 ${m.status === 'rejected' ? 'bg-red-500 text-white shadow-sm' : 'text-gray-500 hover:text-red-600'}`}>
                          <XCircle size={14}/> ไม่อนุมัติ
                        </button>
                      </div>
                      <button onClick={() => deleteMilestone(m.id)} className="text-gray-400 hover:text-red-500 p-1"><X size={16}/></button>
                    </div>
                  </div>
                ))}
                
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

      <Modal isOpen={isGroupModalOpen} onClose={() => setIsGroupModalOpen(false)} title={groupForm.id ? 'แก้ไขกลุ่ม' : 'สร้างกลุ่มโครงงาน'}>
        <div className="space-y-4">
          <Input label="ชื่อกลุ่มโครงงาน / หัวข้อที่รับผิดชอบ" value={groupForm.name} onChange={e => setGroupForm({...groupForm, name: e.target.value})} placeholder="เช่น โครงงานระบบร้านค้า (ส่วน Frontend)" />
          {adminMode && <Select label="ครูผู้ควบคุม" value={groupForm.teacherId || ''} onChange={e => setGroupForm({...groupForm, teacherId:e.target.value})} options={db.users.filter(u=>u.role==='teacher').map(t=>({value:t.id,label:`${t.title}${t.fname} ${t.lname} (${t.id})`}))} placeholder="เลือกครูผู้ควบคุม" />}
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
                  <button onClick={() => setGroupForm(p => ({...p, members: p.members.filter(id=>id!==mid)}))} className="text-blue-400 hover:text-red-500"><X size={14}/></button>
                </div>
              ))}
            </div>
            <input 
              type="text" placeholder="พิมพ์ชื่อเพื่อค้นหา..." value={searchStudent} onChange={e => setSearchStudent(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {searchStudent && (
              <div className="mt-1 border border-gray-200 rounded-lg shadow-sm max-h-40 overflow-y-auto bg-white">
                {db.users.filter(u => { const q=searchStudent.toLowerCase(); return u.role === 'student' && u.level === groupForm.level && u.room === groupForm.room && !groupForm.members.includes(u.id) && (`${u.id} ${u.fname} ${u.lname}`.toLowerCase().includes(q)); }).map(student => (
                  <div key={student.id} onClick={() => { if(groupForm.members.length>=6) return showToast('1 กลุ่มมีสมาชิกได้ไม่เกิน 6 คน','error'); setGroupForm(p => ({...p, members: [...p.members, student.id]})); setSearchStudent(''); }} className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                    {student.fname} {student.lname} ({student.id})
                  </div>
                ))}
                {db.users.filter(u => { const q=searchStudent.toLowerCase(); return u.role === 'student' && u.level === groupForm.level && u.room === groupForm.room && !groupForm.members.includes(u.id) && (`${u.id} ${u.fname} ${u.lname}`.toLowerCase().includes(q)); }).length === 0 && (
                   <p className="px-4 py-3 text-sm text-gray-500 text-center">ไม่พบรายชื่อนักศึกษา</p>
                )}
              </div>
            )}
          </div>
          <Button onClick={handleSaveGroup} className="w-full mt-2">บันทึกกลุ่ม</Button>
        </div>
      </Modal>

      <Modal isOpen={isTemplateModalOpen} onClose={() => setIsTemplateModalOpen(false)} title="เลือกเทมเพลตรายการประเมิน">
         <div className="space-y-3">
            {myTemplates.length > 0 ? myTemplates.map(tpl => (
              <div key={tpl.id} className="border border-gray-200 p-4 rounded-lg hover:border-blue-300 transition-colors flex justify-between items-center">
                 <div>
                    <p className="font-semibold text-gray-800">{tpl.name}</p>
                    <p className="text-xs text-gray-500">{tpl.milestones.length} รายการประเมิน</p>
                 </div>
                 <Button onClick={() => loadTemplate(tpl.id)} className="text-xs py-1.5">ใช้งาน</Button>
              </div>
            )) : (
              <p className="text-center text-gray-500 py-8">ยังไม่มีเทมเพลตที่บันทึกไว้</p>
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
        id: 'sub' + Date.now(),
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
                         <p className="text-xs text-red-600 mt-1">มีบางรายวิชา ยังไม่ผ่านการอนุมัติ ซึ่งอาจส่งผลให้ หมดสิทธิ์สอบนำเสนอ กรุณาติดต่อครูผู้สอนโดยเร็วเพื่อดำเนินการให้เรียบร้อย</p>
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

          <h3 className="text-lg font-bold text-gray-700 pt-4 px-2">แยกตามรายวิชา / ครูผู้ควบคุม</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {myProjects.map(group => {
              const prog = calculateGroupProgress(group.milestones);
              const isRejected = hasRejectedMilestone(group.milestones);

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

                  <div className="mb-6">
                    <ProgressBar percent={prog} />
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">รายละเอียดการประเมิน</p>
                    {group.milestones.length > 0 ? group.milestones.map((m, idx) => (
                      <div key={m.id} className="flex gap-3 items-center p-2.5 bg-gray-50 rounded-lg text-sm">
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white 
                          ${m.status === 'approved' ? 'bg-green-500' : m.status === 'rejected' ? 'bg-red-500' : 'bg-gray-300'}`}>
                          {m.status === 'approved' ? <Check size={14}/> : m.status === 'rejected' ? <X size={14}/> : <Clock size={14}/>}
                        </div>
                        <div className="flex-grow">
                          <p className={`font-medium ${m.status === 'rejected' ? 'text-red-600 line-through opacity-80' : 'text-gray-700'}`}>{m.desc}</p>
                        </div>
                        <div className="flex-shrink-0 text-xs">
                           {m.status === 'approved' && <span className="text-green-600 font-bold">+{m.percent}%</span>}
                           {m.status === 'rejected' && <span className="text-red-500 font-bold bg-red-100 px-2 py-0.5 rounded">ไม่อนุมัติ</span>}
                           {m.status === 'pending' && <span className="text-gray-400">รอตรวจ</span>}
                        </div>
                      </div>
                    )) : <p className="text-sm text-gray-400 text-center py-2">ครูยังไม่ได้กำหนดรายการประเมิน</p>}
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
          <p className="text-gray-500 mt-2">ระบบบูรณาการยังไม่ได้จัดสรรกลุ่มให้คุณ โปรดรอคุณครูผู้ควบคุมดำเนินการ</p>
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
  const loginKey = value => Array.from(String(value || '').trim().toLowerCase()).map(ch => /[a-z0-9]/.test(ch) ? ch : `x${ch.codePointAt(0).toString(16)}`).join('');
  const emailFor = (userRole, id) => userRole === 'admin' ? 'admin@dmd.example.com' : `${userRole}.${loginKey(id)}@dmd.example.com`;
  const defaultPasswordFor = id => `Dmd@${String(id || '').trim()}`;

  const getDocsArray = async (name, qRef = null) => {
    const snap = await getDocs(qRef || collection(firestore, name));
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  };

  const loadPublic = async () => {
    const catSnap = await getDoc(doc(firestore, 'catalogs', 'default'));
    const publicStudents = await getDocsArray('publicStudents');
    const publicGroups = await getDocsArray('publicProjects');
    const teacherStubs = [];
    publicGroups.forEach(g => {
      if (g.teacherId && !teacherStubs.some(t => t.id === g.teacherId)) {
        const parts = String(g.teacherName || '').split(' ');
        teacherStubs.push({ id: g.teacherId, role: 'teacher', title: '', fname: parts[0] || 'ครูผู้ควบคุม', lname: parts.slice(1).join(' ') || '' });
      }
    });
    setDb(prev => ({
      ...prev,
      users: [...publicStudents.map(s => ({ ...s, role: 'student' })), ...teacherStubs],
      groups: publicGroups,
      templates: [],
      submissions: [],
      catalogs: catSnap.exists() ? catSnap.data() : { levels: DEFAULT_LEVELS, rooms: DEFAULT_ROOMS }
    }));
  };

  const bootstrapAdmin = async firebaseUser => {
    const ref = doc(firestore, 'users', firebaseUser.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: firebaseUser.uid,
        id: 'admin',
        role: 'admin',
        title: '',
        fname: 'ผู้จัดการ',
        lname: 'ระบบ',
        email: firebaseUser.email,
        active: true,
        createdAt: Date.now()
      });
    }
    const catRef = doc(firestore, 'catalogs', 'default');
    const catSnap = await getDoc(catRef);
    if (!catSnap.exists()) {
      await setDoc(catRef, { levels: DEFAULT_LEVELS, rooms: DEFAULT_ROOMS });
    }
  };

  const loadPrivate = async (firebaseUser, userRole) => {
    if (userRole === 'admin' || userRole === 'teacher') {
      const [usersRaw, groupsRaw, templatesRaw, submissionsRaw, catSnap] = await Promise.all([
        getDocsArray('users'), getDocsArray('groups'), getDocsArray('templates'), getDocsArray('submissions'), getDoc(doc(firestore, 'catalogs', 'default'))
      ]);
      const users = usersRaw.filter(u => u.role !== 'disabled' && u.active !== false).map(u => ({ ...u, uid: u.uid || u._docId }));
      setDb({
        users,
        groups: groupsRaw,
        templates: templatesRaw,
        submissions: submissionsRaw,
        catalogs: catSnap.exists() ? catSnap.data() : { levels: DEFAULT_LEVELS, rooms: DEFAULT_ROOMS }
      });
      return users.find(u => (u.uid || u._docId) === firebaseUser.uid) || null;
    }

    const ownSnap = await getDoc(doc(firestore, 'users', firebaseUser.uid));
    if (!ownSnap.exists()) return null;
    const own = { ...ownSnap.data(), uid: firebaseUser.uid };
    const groupsRaw = await getDocsArray('groups', query(collection(firestore, 'groups'), where('memberUids', 'array-contains', firebaseUser.uid)));
    const submissionsRaw = await getDocsArray('submissions', query(collection(firestore, 'submissions'), where('studentUid', '==', firebaseUser.uid)));
    const teachers = groupsRaw.map(g => ({ id: g.teacherId, role: 'teacher', title: '', fname: g.teacherName || 'ครูผู้ควบคุม', lname: '' })).filter((v,i,a) => v.id && a.findIndex(x => x.id === v.id) === i);
    const catSnap = await getDoc(doc(firestore, 'catalogs', 'default'));
    setDb({ users: [own, ...teachers], groups: groupsRaw, templates: [], submissions: submissionsRaw, catalogs: catSnap.exists() ? catSnap.data() : { levels: DEFAULT_LEVELS, rooms: DEFAULT_ROOMS } });
    return own;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await loadPublic(); } catch (e) { console.error(e); }
      if (!cancelled) setLoading(false);
    })();
    const unsub = onAuthStateChanged(auth, async firebaseUser => {
      if (!firebaseUser) return;
      try {
        if (firebaseUser.email === 'admin@dmd.example.com') await bootstrapAdmin(firebaseUser);
        const profileSnap = await getDoc(doc(firestore, 'users', firebaseUser.uid));
        if (!profileSnap.exists()) return;
        const profile = { ...profileSnap.data(), uid: firebaseUser.uid };
        if (profile.role === 'disabled' || profile.active === false) { await signOut(auth); return; }
        const loaded = await loadPrivate(firebaseUser, profile.role);
        if (!cancelled && loaded) { setRole(profile.role); setCurrentUser(loaded); }
      } catch (e) { console.error('restore auth', e); }
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const ensureCreatorAuth = () => {
    const name = 'DMDUserCreator';
    const existing = getApps().find(a => a.name === name);
    const app = existing || initializeApp(firebaseConfig, name);
    return getAuth(app);
  };

  const syncUsers = async nextUsers => {
    const prev = db.users.filter(u => ['student','teacher'].includes(u.role));
    const next = nextUsers.filter(u => ['student','teacher'].includes(u.role));
    const finalUsers = [];

    for (const u of next) {
      let uid = u.uid;
      if (!uid) {
        const existing = await getDocs(query(collection(firestore, 'users'), where('id', '==', u.id)));
        if (!existing.empty) uid = existing.docs[0].id;
      }
      if (!uid) {
        const creatorAuth = ensureCreatorAuth();
        try {
          const cred = await createUserWithEmailAndPassword(creatorAuth, emailFor(u.role, u.id), defaultPasswordFor(u.id));
          uid = cred.user.uid;
        } finally {
          try { await signOut(creatorAuth); } catch (_) {}
        }
      }
      const profile = { ...clean(u), uid, email: emailFor(u.role, u.id), active: true, updatedAt: Date.now() };
      delete profile._docId;
      await setDoc(doc(firestore, 'users', uid), profile, { merge: true });
      if (u.role === 'student') {
        await setDoc(doc(firestore, 'publicStudents', u.id), { id:u.id, title:u.title||'', fname:u.fname||'', lname:u.lname||'', level:u.level||'', room:u.room||'', role:'student' });
      }
      finalUsers.push(profile);
    }

    for (const old of prev) {
      if (!next.some(n => n.id === old.id)) {
        const uid = old.uid || old._docId;
        if (uid) await setDoc(doc(firestore, 'users', uid), { ...clean(old), uid, role: 'disabled', originalRole: old.role, active: false, disabledAt: Date.now() }, { merge: true });
        if (old.role === 'student') await deleteDoc(doc(firestore, 'publicStudents', old.id));
      }
    }
    return finalUsers;
  };

  const syncGroups = async nextGroups => {
    const prevIds = new Set(db.groups.map(g => g.id));
    const nextIds = new Set(nextGroups.map(g => g.id));
    for (const g of nextGroups) {
      const teacher = db.users.find(u => u.id === g.teacherId);
      const members = (g.members || []).map(id => db.users.find(u => u.id === id)).filter(Boolean);
      const enriched = { ...clean(g), teacherUid: teacher?.uid || '', teacherName: teacher ? `${teacher.title||''}${teacher.fname||''} ${teacher.lname||''}`.trim() : '', memberUids: members.map(m => m.uid).filter(Boolean), updatedAt: Date.now() };
      await setDoc(doc(firestore, 'groups', g.id), enriched);
      const pub = { id:g.id, name:g.name, level:g.level, room:g.room, members:g.members||[], milestones:g.milestones||[], teacherId:g.teacherId, teacherName:enriched.teacherName };
      await setDoc(doc(firestore, 'publicProjects', g.id), pub);
    }
    for (const id of prevIds) if (!nextIds.has(id)) { await deleteDoc(doc(firestore, 'groups', id)); await deleteDoc(doc(firestore, 'publicProjects', id)); }
  };

  const syncSimpleCollection = async (name, prev, next) => {
    const prevIds = new Set((prev || []).map(x => x.id));
    const nextIds = new Set((next || []).map(x => x.id));
    for (const item of next || []) await setDoc(doc(firestore, name, item.id), { ...clean(item), updatedAt: Date.now() });
    for (const id of prevIds) if (!nextIds.has(id)) await deleteDoc(doc(firestore, name, id));
  };

  const handleUpdate = (collectionKey, newData) => {
    const previous = db[collectionKey];
    setDb(prev => ({ ...prev, [collectionKey]: newData }));
    (async () => {
      try {
        if (collectionKey === 'catalogs') await setDoc(doc(firestore, 'catalogs', 'default'), clean(newData));
        else if (collectionKey === 'users') await syncUsers(newData);
        else if (collectionKey === 'groups') await syncGroups(newData);
        else if (collectionKey === 'templates') await syncSimpleCollection('templates', db.templates, newData);
        else if (collectionKey === 'submissions') await syncSimpleCollection('submissions', db.submissions, newData);
        if (auth.currentUser && role && role !== 'parent') {
          const refreshed = await loadPrivate(auth.currentUser, role);
          if (refreshed && refreshed.uid === currentUser?.uid) setCurrentUser(refreshed);
        } else await loadPublic();
      } catch (err) {
        console.error(err);
        setDb(prev => ({ ...prev, [collectionKey]: previous }));
        showToast(`บันทึกไม่สำเร็จ: ${err?.message || err}`, 'error');
      }
    })();
  };

  const handleLogin = async e => {
    e.preventDefault();
    if (role === 'parent') {
      const q = searchQuery.trim().toLowerCase();
      const student = db.users.find(u => u.role === 'student' && (u.id === searchQuery.trim() || String(u.fname||'').toLowerCase().includes(q) || String(u.lname||'').toLowerCase().includes(q)));
      if (student) setCurrentUser(student); else showToast('ไม่พบข้อมูลนักศึกษาที่ค้นหา', 'error');
      return;
    }
    try {
      setLoading(true);
      const email = emailFor(role, loginId);
      const password = role === 'admin' ? loginPassword : defaultPasswordFor(loginId);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (role === 'admin') await bootstrapAdmin(cred.user);
      const snap = await getDoc(doc(firestore, 'users', cred.user.uid));
      if (!snap.exists()) throw new Error('ยังไม่มีสิทธิ์ใช้งานในระบบ');
      const profile = { ...snap.data(), uid: cred.user.uid };
      if (profile.role !== role || profile.active === false) { await signOut(auth); throw new Error('สิทธิ์การเข้าใช้งานไม่ตรงกับบัญชี'); }
      const loaded = await loadPrivate(cred.user, role);
      setCurrentUser(loaded || profile);
      showToast(`เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${profile.fname || ''}`);
    } catch (err) {
      console.error(err);
      showToast(role === 'admin' ? 'รหัสผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' : 'รหัสผู้ใช้งานไม่ถูกต้อง หรือยังไม่ได้ลงทะเบียน', 'error');
    } finally { setLoading(false); }
  };

  const logout = async () => {
    try { await signOut(auth); } catch (_) {}
    setCurrentUser(null); setRole(null); setLoginId(''); setLoginPassword(''); setSearchQuery('');
    await loadPublic();
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4"><Loader2 className="animate-spin text-blue-600 mb-4" size={48}/><h2 className="text-xl font-semibold text-gray-700">กำลังเชื่อมต่อ Firebase...</h2><p className="text-sm text-gray-500 mt-2">โปรดรอสักครู่</p></div>;
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
                <Button variant="secondary" className="w-full justify-start py-3" onClick={() => setRole('teacher')}><CheckCircle className="text-green-500"/> ผู้ควบคุม (Teacher)</Button>
                <Button variant="secondary" className="w-full justify-start py-3" onClick={() => setRole('parent')}><Search className="text-amber-500"/> ผู้เข้าชม (Parent)</Button>
                <Button variant="secondary" className="w-full justify-start py-3" onClick={() => setRole('admin')}><Settings className="text-gray-500"/> ผู้จัดการระบบ (Admin)</Button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center gap-2 text-blue-600 font-semibold mb-2"><button type="button" onClick={() => setRole(null)} className="p-1 hover:bg-blue-50 rounded"><ChevronRight className="rotate-180" size={18}/></button>เข้าสู่ระบบในฐานะ {role === 'student' ? 'นักศึกษา' : role === 'teacher' ? 'ผู้ควบคุม' : role === 'admin' ? 'ผู้จัดการระบบ' : 'ผู้เข้าชม'}</div>
                {role === 'parent' ? <Input label="ค้นหานักศึกษา" placeholder="กรอกรหัสนักศึกษา หรือ ชื่อ..." required value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/> : <Input label="รหัสผู้ใช้งาน" placeholder="กรอกรหัส..." required value={loginId} onChange={e => setLoginId(e.target.value)}/>} 
                {role === 'admin' && <Input label="รหัสผ่าน Admin" type="password" placeholder="รหัสผ่านที่สร้างใน Firebase" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)}/>} 
                <Button type="submit" className="w-full mt-4">เข้าสู่ระบบ</Button>
                <div className="text-xs text-gray-400 mt-6 pt-4 border-t text-center flex flex-col gap-1 items-center justify-center"><span className="flex items-center gap-1"><ShieldCheck size={14}/> เชื่อมต่อ Firebase + Cloud Firestore</span>{role === 'admin' && <span>รหัสผู้ใช้ Admin: <b>admin</b></span>}{(role === 'student' || role === 'teacher') && <span>เข้าสู่ระบบด้วยรหัสที่ผู้จัดการระบบลงทะเบียน</span>}</div>
              </form>
            )}
          </div>
        </div>
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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, addDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { Plus, MessageSquare, User, Home, Utensils, Calendar, ChevronLeft, ChevronRight, Send, Zap, Edit3, Droplets, Trash2, X, LogOut, Sparkles, Save, Camera } from 'lucide-react';

const firebaseConfig = JSON.parse(window.__firebase_config || '{}');
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = (window.__app_id || 'nutriflow-pcos-pro').replace(/\//g, '_');

const App = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [meals, setMeals] = useState([]);
  const [healthLogs, setHealthLogs] = useState({});
  const [periods, setPeriods] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [userProfile, setUserProfile] = useState({ height: 165, weight: 60, age: 28, goal: 'PCOS 調理 (低GI)', activity: 1.375 });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [smartInput, setSmartInput] = useState('');
  const [logDate, setLogDate] = useState(selectedDate);
  const [periodStart, setPeriodStart] = useState(selectedDate);
  const [periodEnd, setPeriodEnd] = useState(selectedDate);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    return onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!user) return;
    const p = (c) => collection(db, 'artifacts', appId, 'users', user.uid, c);
    const unsubMeals = onSnapshot(p('meals'), (s) => setMeals(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => b.timestamp - a.timestamp)));
    const unsubPeriods = onSnapshot(p('periods'), (s) => setPeriods(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(a.startDate) - new Date(b.startDate))));
    const unsubHealth = onSnapshot(p('healthLogs'), (s) => { const l = {}; s.docs.forEach(d => l[d.id] = d.data()); setHealthLogs(l); });
    const unsubChat = onSnapshot(p('messages'), (s) => setChatMessages(s.docs.map(d => d.data()).sort((a,b) => a.timestamp - b.timestamp)));
    getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'profile')).then(s => s.exists() && setUserProfile(s.data()));
    return () => { unsubMeals(); unsubHealth(); unsubPeriods(); unsubChat(); };
  }, [user]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, isProcessing]);

  const filteredMeals = useMemo(() => meals.filter(m => m.dateStr === selectedDate), [meals, selectedDate]);
  const isPeriod = useMemo(() => periods.some(p => selectedDate >= p.startDate && selectedDate <= p.endDate), [periods, selectedDate]);
  const predict = useMemo(() => {
    if (!periods.length) return { text: '尚未有數據', date: '' };
    let avg = 28;
    if (periods.length > 1) {
      let sum = 0;
      for(let i=1; i<periods.length; i++) sum += (new Date(periods[i].startDate) - new Date(periods[i-1].startDate)) / 86400000;
      avg = Math.round(sum / (periods.length - 1));
    }
    const next = new Date(periods[periods.length-1].startDate);
    next.setDate(next.getDate() + avg);
    const diff = Math.ceil((next - new Date()) / 86400000);
    return { text: diff < 0 ? `遲來 ${Math.abs(diff)} 天` : `${diff} 天後報到`, date: next.toISOString().split('T')[0] };
  }, [periods]);

  const tdee = useMemo(() => {
    const { height, weight, age, activity } = userProfile;
    let bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    return Math.round(bmr * (activity || 1.375));
  }, [userProfile]);

  const totals = useMemo(() => filteredMeals.reduce((acc, m) => ({
    cal: acc.cal + (Number(m.cal)||0), p: acc.p + (Number(m.protein)||0), c: acc.c + (Number(m.carb)||0), f: acc.f + (Number(m.fat)||0)
  }), { cal: 0, p: 0, c: 0, f: 0 }), [filteredMeals]);

  const handleSaveMeal = async (data) => {
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'meals'), { ...data, dateStr: logDate, timestamp: Date.now() });
    setShowAddModal(false); setSmartInput('');
  };

  const callAI = async (p, type = "nutritionist") => {
    const sys = type === "nutritionist" ? "專業PCOS營養師，分段列點，繁體中文。" : '返回JSON:{"name","cal","protein","carb","fat","gi"}';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], systemInstruction: { parts: [{ text: sys }] }, generationConfig: type === "analyzer" ? { responseMimeType: "application/json" } : {} })
    });
    const d = await res.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text;
  };

  const onChat = async (input) => {
    const text = input || chatInput; if(!text || isProcessing) return;
    setChatInput(''); setIsProcessing(true);
    const ref = collection(db, 'artifacts', appId, 'users', user.uid, 'messages');
    await addDoc(ref, { role: 'user', text, timestamp: Date.now() });
    const ai = await callAI(text);
    if(ai) await addDoc(ref, { role: 'assistant', text: ai, timestamp: Date.now() });
    setIsProcessing(false);
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#FAF9F6]">載入中...</div>;

  return (
    <div className="max-w-md mx-auto h-screen bg-[#FAF9F6] flex flex-col text-[#4A443F] shadow-2xl relative overflow-hidden">
      <header className="px-6 pt-10 pb-4 flex justify-between items-center bg-[#FAF9F6] z-10">
        <h1 className="text-xl font-bold text-[#5D544C]">NutriFlow</h1>
        <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} className="text-xs bg-white border border-[#EFEBE7] rounded-xl px-2 py-1"/>
      </header>

      <main className="flex-1 overflow-y-auto px-6 space-y-4 pb-24">
        {view === 'dashboard' && (
          <>
            <section className="bg-white rounded-[32px] p-6 shadow-sm border border-[#F2EDE9] relative">
              {isPeriod && <div className="absolute top-2 right-4 text-rose-400 text-[10px] animate-pulse font-bold">經期中</div>}
              <div className="flex justify-between items-end mb-4">
                <div><div className="text-2xl font-bold">{totals.cal} <span className="text-xs text-gray-300">/ {Math.round(tdee*0.9)}</span></div><div className="text-[10px] text-[#D4C4B7] font-bold tracking-widest uppercase">今日熱量</div></div>
                <div className="text-right"><div className="text-xs font-bold text-rose-400">{predict.text}</div><div className="text-[9px] text-gray-300">下次: {predict.date}</div></div>
              </div>
              <div className="flex gap-2">
                {[['蛋白', totals.p, 60], ['碳水', totals.c, 150], ['脂肪', totals.f, 50]].map(([l,c,t]) => (
                  <div key={l} className="flex-1 h-1.5 bg-[#FAF9F6] rounded-full overflow-hidden"><div className="h-full bg-[#D4C4B7]" style={{width:`${Math.min((c/t)*100, 100)}%`}}></div></div>
                ))}
              </div>
            </section>
            <button onClick={()=>{setLogDate(selectedDate); setShowAddModal(true)}} className="w-full py-4 bg-white border-2 border-dashed border-[#EFEBE7] rounded-3xl text-[#D4C4B7] flex items-center justify-center gap-2"><Plus size={18}/> 紀錄飲食</button>
            <div className="space-y-2">
              {filteredMeals.map(m => (
                <div key={m.id} className="bg-white p-4 rounded-2xl border border-[#F2EDE9] flex justify-between items-center group">
                  <div className="flex items-center gap-3"><div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center text-amber-500"><Utensils size={16}/></div>
                  <div><div className="text-sm font-bold text-[#5D544C]">{m.name}</div><div className="text-[10px] text-gray-400">{m.cal} kcal</div></div></div>
                  <button onClick={()=>deleteDoc(doc(db,'artifacts',appId,'users',user.uid,'meals',m.id))} className="text-rose-200"><Trash2 size={16}/></button>
                </div>
              ))}
            </div>
          </>
        )}
        {view === 'health' && (
          <div className="space-y-4">
            <div className="bg-[#5D544C] rounded-[32px] p-6 text-white flex justify-between items-center shadow-lg">
              <div><h4 className="text-sm opacity-60">預計報到</h4><div className="text-2xl font-bold text-rose-300">{predict.text}</div></div>
              <Sparkles className="text-rose-300 opacity-50"/>
            </div>
            <button onClick={()=>setShowPeriodModal(true)} className="w-full py-4 bg-rose-50 text-rose-400 rounded-3xl border border-rose-100 font-bold flex items-center justify-center gap-2"><Droplets size={18}/> 紀錄經期</button>
            <textarea value={healthLogs[selectedDate]?.note || ''} onChange={e=>setDoc(doc(db,'artifacts',appId,'users',user.uid,'healthLogs',selectedDate),{note:e.target.value},{merge:true})} placeholder="今日筆記..." className="w-full bg-white border border-[#EFEBE7] rounded-3xl p-5 text-sm min-h-[160px]"/>
          </div>
        )}
        {view === 'chat' && (
          <div className="flex flex-col h-full space-y-4 pb-32 pt-2">
            {chatMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${m.role === 'user' ? 'bg-[#5D544C] text-white rounded-tr-none' : 'bg-white border border-[#EFEBE7] text-[#5D544C] rounded-tl-none'}`}>{m.text}</div>
              </div>
            ))}
            {isProcessing && <div className="text-[10px] text-[#D4C4B7]">分析中...</div>}
            <div ref={chatEndRef} />
            <div className="fixed bottom-24 left-6 right-6 flex gap-2">
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="詢問建議..." className="flex-1 bg-white border border-[#F2EDE9] rounded-2xl px-5 py-3 text-sm shadow-xl focus:ring-0 outline-none" />
              <button onClick={()=>onChat()} className="bg-[#5D544C] text-white p-3 rounded-xl shadow-xl"><Send size={20}/></button>
            </div>
          </div>
        )}
        {view === 'profile' && (
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-3xl border border-[#F2EDE9] space-y-4 shadow-sm">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] text-gray-400 block mb-1">身高(cm)</label><input type="number" value={userProfile.height} onChange={e=>setUserProfile({...userProfile, height:Number(e.target.value)})} className="w-full bg-[#FAF9F6] p-2 rounded-lg text-sm border-none"/></div>
                <div><label className="text-[10px] text-gray-400 block mb-1">體重(kg)</label><input type="number" value={userProfile.weight} onChange={e=>setUserProfile({...userProfile, weight:Number(e.target.value)})} className="w-full bg-[#FAF9F6] p-2 rounded-lg text-sm border-none"/></div>
              </div>
              <button onClick={()=>setDoc(doc(db,'artifacts',appId,'users',user.uid,'settings','profile'), userProfile)} className="w-full py-3 bg-[#D4C4B7] text-white rounded-xl font-bold shadow-md">儲存設定</button>
            </div>
            <button onClick={()=>signOut(auth)} className="w-full py-3 text-rose-300 font-bold border border-rose-100 rounded-xl">登出帳號</button>
          </div>
        )}
      </main>

      {showAddModal && (
        <div className="absolute inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-end p-4">
          <div className="w-full bg-white rounded-t-[40px] p-8 space-y-4 shadow-2xl animate-in slide-in-from-bottom-20">
            <div className="flex justify-between items-center font-bold text-lg text-[#5D544C]">紀錄餐點<button onClick={()=>setShowAddModal(false)}><X/></button></div>
            <input type="date" value={logDate} onChange={e=>setLogDate(e.target.value)} className="w-full bg-[#FAF9F6] p-3 rounded-xl border-none text-sm"/>
            <textarea autoFocus value={smartInput} onChange={e=>setSmartInput(e.target.value)} placeholder="描述食物..." className="w-full bg-[#FAF9F6] p-5 rounded-[24px] text-sm min-h-[120px] border-none outline-none"/>
            <button disabled={isProcessing} onClick={async ()=>{
                setIsProcessing(true);
                const res = await callAI(smartInput, "analyzer");
                if(res) await handleSaveMeal(JSON.parse(res));
                setIsProcessing(false);
            }} className={`w-full py-5 rounded-[24px] font-bold text-white shadow-xl ${isProcessing?'bg-gray-200':'bg-[#5D544C]'}`}>{isProcessing?'分析中...':'確認加入'}</button>
          </div>
        </div>
      )}

      {showPeriodModal && (
        <div className="absolute inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-center p-6">
          <div className="w-full bg-white rounded-[40px] p-8 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center font-bold">生理期區間<button onClick={()=>setShowPeriodModal(false)}><X/></button></div>
            <div className="space-y-4">
              <div><label className="text-[10px] text-rose-300">開始日期</label><input type="date" value={periodStart} onChange={e=>setPeriodStart(e.target.value)} className="w-full bg-[#FAF9F6] p-3 rounded-xl border-none"/></div>
              <div><label className="text-[10px] text-rose-300">結束日期</label><input type="date" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)} className="w-full bg-[#FAF9F6] p-3 rounded-xl border-none"/></div>
            </div>
            <button onClick={async ()=>{
                setIsProcessing(true);
                await addDoc(collection(db,'artifacts',appId,'users',user.uid,'periods'), {startDate:periodStart, endDate:periodEnd, timestamp:Date.now()});
                setIsProcessing(false); setShowPeriodModal(false);
            }} className="w-full py-4 bg-rose-500 text-white rounded-2xl font-bold shadow-xl">儲存區間</button>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 border-t border-[#F2EDE9] px-10 py-7 flex justify-between max-w-md mx-auto rounded-t-[48px] shadow-lg">
        <button onClick={()=>setView('dashboard')} className={view==='dashboard'?'text-[#5D544C] scale-110':'text-[#D4C4B7]'}><Home size={24}/></button>
        <button onClick={()=>setView('health')} className={view==='health'?'text-[#5D544C] scale-110':'text-[#D4C4B7]'}><Calendar size={24}/></button>
        <button onClick={()=>setView('chat')} className={view==='chat'?'text-[#5D544C] scale-110':'text-[#D4C4B7]'}><MessageSquare size={24}/></button>
        <button onClick={()=>setView('profile')} className={view==='profile'?'text-[#5D544C] scale-110':'text-[#D4C4B7]'}><User size={24}/></button>
      </nav>
    </div>
  );
};

export default App;
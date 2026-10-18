import {Plus, SquaresFour, Camera, Images, MapPin, Check, Table, PencilSimple, SignOut, ArrowsClockwise, Phone, Trash, X, Gear, CameraSlash} from '@phosphor-icons/react';
import React, {useEffect, useRef, useState} from 'react';
import {fresh, list, put, maps, dimensionText, priceText, type Site} from './store';
import {synchronizeTeam, deleteSite, resolveConflict, type Member} from './team';
import Map from './Map';
import {prepareImage} from './images';
import Photo from './Photo';
import * as google from './google';

const toLatin = (s: string) => s.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const normalizeSearch = (s: string) => toLatin(s).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
const phoneOk = (v: string) => { const d = toLatin(v).replace(/[\s-]/g, ''); return d === '' || /^(07\d{9}|\+9647\d{9}|009647\d{9})$/.test(d); };
const numOk = (v: string) => { const d = toLatin(v).trim(); return d === '' || /^\d+(\.\d+)?$/.test(d); };
const errorsOf = (s: Site): Partial<Record<keyof Site, string>> => {
  const e: Partial<Record<keyof Site, string>> = {};
  if (!s.name.trim()) e.name = 'اسم العقار مطلوب.';
  if (!s.street.trim()) e.street = 'حدد المنطقة أو الشارع.';
  if (!phoneOk(s.phone)) e.phone = 'رقم هاتف عراقي غير صحيح (07xxxxxxxxx).';
  if (!numOk(s.height || '')) e.height = 'أدخل رقماً صحيحاً للارتفاع.';
  if (!numOk(s.width || '')) e.width = 'أدخل رقماً صحيحاً للعرض.';
  if (!numOk(s.price)) e.price = 'أدخل رقماً صحيحاً للتوقع المالي.';
  return e;
};

export default function App({account, onLogout}: {account: Member; onLogout: () => Promise<void>}) {
  const [sites, setSites] = useState<Site[]>([]);
  const [site, setSite] = useState<Site | null>(null);
  const [view, setView] = useState<'home' | 'list' | 'edit' | 'details'>('home');
  const [message, setMessage] = useState('');
  const [busy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'cards' | 'table'>('cards');
  const [filterTab, setFilterTab] = useState<'all' | 'pending' | 'high' | 'mine'>('all');
  const [surveyorFilter, setSurveyorFilter] = useState('');
  const [touched, setTouched] = useState<Partial<Record<keyof Site, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [returnToDetails, setReturnToDetails] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { setTouched({}); setSubmitAttempted(false); }, [site?.id]);
  const errors = site ? errorsOf(site) : {};
  const storageFailed = useRef(false);
  const syncing = useRef(false);
  const autoSync = useRef<() => void>(() => {});
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function scheduleSync() {
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => autoSync.current(), 2000);
  }

  const current = useRef<Site | null>(null);
  current.current = site;
  const saveQueue = useRef(Promise.resolve());
  const refresh = async () => setSites(await list());

  const [googleStatus, setGoogleStatus] = useState<'checking' | 'disconnected' | 'connected' | 'unavailable'>('checking');
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);

  function connectGoogle() { location.assign('/api/google/start'); }
  async function disconnectGoogle() {
    google.logout();
    try { await fetch('/api/google/logout', {method: 'POST', credentials: 'same-origin'}); } catch { /* cleared */ }
    setGoogleStatus('disconnected');
    setGoogleEmail('');
  }
  async function syncGoogleNow() {
    setGoogleBusy(true);
    try {
      const all = await list();
      let ok = 0, fail = 0;
      for (const s of all) { try { await google.sync(s); ok++; } catch { fail++; } }
      setMessage(`نسخة Google Drive: ${ok} موقع${fail ? `، تعذر ${fail}` : ''}.`);
    } catch (e) { setMessage((e as Error).message); } finally { setGoogleBusy(false); }
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const g = params.get('google');
    if (g) {
      setMessage(g === 'denied' ? 'رُفض إذن Google.' : 'تعذر الاتصال بـ Google Drive.');
      history.replaceState(null, '', location.pathname);
    }
    void google.resume().then(email => {
      setGoogleEmail(email);
      setGoogleStatus('connected');
    }).catch(e => setGoogleStatus((e as Error).message === 'GOOGLE_SETUP_REQUIRED' ? 'unavailable' : 'disconnected'));
  }, []);

  useEffect(() => {
    void list().then(setSites);
    void navigator.storage?.persist?.();
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);

  function save(s: Site) {
    saveQueue.current = saveQueue.current.then(() => put(s)).then(() => {
      storageFailed.current = false;
      scheduleSync();
    }).catch(() => {
      storageFailed.current = true;
      setMessage('تعذر الحفظ على الجهاز؛ تأكد من توفر المساحة.');
    });
    return saveQueue.current;
  }

  function update(p: Partial<Site>) {
    if (!current.current) return;
    const s = {...current.current, ...p, revision: (current.current.revision || 0) + 1, updated: new Date().toISOString(), dirty: true, error: undefined};
    current.current = s;
    setSite(s);
    void save(s);
  }

  async function open(s: Site, v: 'edit' | 'details') {
    await saveQueue.current;
    setSite(s);
    setView(v);
    setReturnToDetails(false);
    setMessage('');
  }

  async function back() {
    await saveQueue.current;
    if (storageFailed.current) return;
    await refresh();
    if (returnToDetails && site) {
      setView('details');
      setReturnToDetails(false);
    } else {
      setView('list');
      setSite(null);
      setReturnToDetails(false);
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files || !current.current) return;
    const target = current.current.id;
    try {
      if (current.current.photos.length + files.length > 100) throw Error('الحد الأقصى 100 صورة للعقار.');
      const photos = [];
      for (const f of Array.from(files)) {
        const blob = await prepareImage(f);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(n => n.toString(16).padStart(2, '0')).join('');
        photos.push({id: hash, blob, name: blob.type === 'image/jpeg' ? f.name.replace(/\.[^.]+$/, '') + '.jpg' : f.name});
      }
      if (current.current?.id !== target) throw Error('أعد اختيار الصور.');
      const old = current.current.photos;
      const seen = new Set(old.map(p => p.id));
      update({photos: [...old, ...photos.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })]});
    } catch (e) { setMessage(String(e)); }
  }

  function removePhoto(photoId: string) {
    if (!current.current) return;
    update({photos: current.current.photos.filter(p => p.id !== photoId)});
  }

  async function locate() {
    const target = current.current?.id;
    if (!navigator.geolocation) { setMessage('GPS غير متاح؛ حدد الدبوس على الخريطة.'); return; }
    setIsLocating(true);
    setMessage('جارٍ تحديد الموقع عبر GPS…');
    navigator.geolocation.getCurrentPosition(
      p => {
        setIsLocating(false);
        if (current.current?.id !== target) return;
        update({lat: p.coords.latitude, lng: p.coords.longitude});
        setMessage('تم تحديد الموقع بنجاح.');
      },
      () => {
        setIsLocating(false);
        setMessage('تعذر تحديد الموقع؛ انقر على الخريطة لتحديده يدوياً.');
      },
      {enableHighAccuracy: true, timeout: 20000, maximumAge: 0}
    );
  }

  autoSync.current = () => {
    if (syncing.current || !navigator.onLine) return;
    if (account.force_password) return;
    syncing.current = true;
    setIsSyncing(true);
    void saveQueue.current.then(() => {
      if (storageFailed.current) throw Error('تعذر الحفظ على الجهاز.');
      return synchronizeTeam(s => {
        if (current.current?.id === s.id) {
          if (s.deletedAt) { current.current = null; setSite(null); setView('list'); return; }
          const active = current.current;
          const next = active.dirty && (active.revision || 0) !== (s.revision || 0) ? {...active, version: s.version, conflict: s.conflict} : s;
          current.current = next;
          setSite(next);
        }
      });
    }).then(() => { setMessage(''); return refresh(); }).catch(e => setMessage((e as Error).message)).finally(() => {
      syncing.current = false;
      setIsSyncing(false);
    });
  };

  useEffect(() => {
    const timer = window.setInterval(() => autoSync.current(), 15000);
    const resume = () => autoSync.current();
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    return () => {
      clearInterval(timer);
      clearTimeout(syncTimer.current);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
    };
  }, []);

  useEffect(() => { autoSync.current(); }, []);

  function triggerManualSync() {
    if (!navigator.onLine) { setMessage('لا يوجد اتصال حالياً؛ البيانات محفوظة على الجهاز.'); return; }
    setMessage('جارٍ المزامنة…');
    autoSync.current();
  }

  const allSurveyors = Array.from(new Set(sites.map(s => s.createdName).filter(Boolean))) as string[];

  const filteredSites = sites.filter(s => {
    if (filterTab === 'pending' && !s.dirty && !s.remotePending) return false;
    if (filterTab === 'high' && s.priority !== 'عالية') return false;
    if (filterTab === 'mine' && s.createdBy !== account.user_id) return false;
    if (surveyorFilter && s.createdName !== surveyorFilter) return false;
    if (!query.trim()) return true;
    const q = normalizeSearch(query);
    const text = normalizeSearch([s.name, s.street, s.owner, s.phone, s.createdName, s.kind, s.position, s.notes].filter(Boolean).join(' '));
    return text.includes(q);
  });

  const hasPending = sites.some(s => s.dirty);
  const hasUploading = sites.some(s => s.remotePending);
  const hasConflict = sites.some(s => s.conflict);

  const input = (key: keyof Site, label: string, type: 'text' | 'tel' | 'decimal' = 'text', placeholder = '') => {
    const id = `f-${key}`;
    const err = errors[key];
    const show = !!err && (touched[key] || submitAttempted);
    return (
      <div className="formField">
        <label htmlFor={id} className="formLabel">{label}</label>
        <input
          id={id}
          className="formInput"
          type={type === 'decimal' ? 'text' : type}
          inputMode={type === 'decimal' ? 'decimal' : type === 'tel' ? 'tel' : undefined}
          autoComplete={type === 'tel' ? 'tel' : undefined}
          value={String(site?.[key] ?? '')}
          placeholder={placeholder}
          onChange={e => update({[key]: e.target.value})}
          onBlur={() => setTouched(t => ({...t, [key]: true}))}
          dir={type === 'tel' || type === 'decimal' ? 'ltr' : undefined}
          aria-invalid={show || undefined}
        />
        {show && <p className="formErrorMsg" role="alert">{err}</p>}
      </div>
    );
  };

  const select = (key: keyof Site, label: string, choices: string[]) => {
    const id = `f-${key}`;
    const value = String(site?.[key] ?? '');
    return (
      <div className="formField">
        <label htmlFor={id} className="formLabel">{label}</label>
        <select
          id={id}
          className="formSelect"
          aria-label={label}
          value={value}
          onChange={e => update({[key]: e.target.value})}
          onBlur={() => setTouched(t => ({...t, [key]: true}))}
        >
          {Array.from(new Set([...choices, ...(value ? [value] : [])])).map(c => (
            <option key={c || '—'} value={c}>{c || '—'}</option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <>
      <header>
        <div className="headerInner">
          <a href="#" className="brand" onClick={e => { e.preventDefault(); setView('home'); setSite(null); setMessage(''); }}>
            <img className="brandSymbol" src="/ooh/field/brand/raneen-symbol.svg" alt="شعار الرنين"/>
            <img className="brandWordmark" src="/ooh/field/brand/raneen-lockup.svg" alt="الرنين"/>
          </a>

          <div className="headerActions">
            {!online ? (
              <span className="statusPill pending" title="لا يوجد اتصال، الحفظ على الجهاز نشط">
                <span className="statusDot"/> محفوظ على الجهاز
              </span>
            ) : isSyncing || hasUploading ? (
              <span className="statusPill syncing" title="جارٍ رفع ومزامنة البيانات مع السحابة">
                <span className="statusDot spin"/> {hasUploading ? 'رفع الصور' : 'جارٍ المزامنة'}
              </span>
            ) : hasConflict ? (
              <span className="statusPill conflict" title="يوجد تعديل متزامن يحتاج اعتماد">
                <span className="statusDot"/> تعارض
              </span>
            ) : hasPending ? (
              <span className="statusPill pending" title="بيانات معلقة بانتظار المزامنة">
                <span className="statusDot"/> محفوظ على الجهاز
              </span>
            ) : (
              <span className="statusPill synced" title="البيانات متزامنة بالكامل مع خادم الفريق">
                <span className="statusDot"/> متزامن
              </span>
            )}

            <button
              type="button"
              className="accountTrigger"
              onClick={() => setShowSettings(true)}
              aria-label="إعدادات الحساب والمزامنة"
              title="إعدادات الحساب"
            >
              <span>{account.display_name}</span>
              <Gear size={15}/>
            </button>
          </div>
        </div>
      </header>

      <main>
        {message && (
          <div role="status" className="notice">
            <span>{message}</span>
            <button type="button" className="modalCloseBtn" onClick={() => setMessage('')} aria-label="إغلاق التنبيه">×</button>
          </div>
        )}

        {/* SCREEN 1: الصفحة الرئيسية */}
        {view === 'home' ? (
          <div className="homeClean">
            <div className="homeHero">
              <h1>الكشف الميداني للعقارات</h1>
              <p>نظام توثيق مواقع الرنين</p>
            </div>

            <div className="homeActionGrid">
              <button
                className="homeActionCard btnPrimary"
                disabled={busy}
                onClick={() => {
                  const s = {...fresh(), createdName: account.display_name, createdBy: account.user_id};
                  setSite(s);
                  setView('edit');
                  setReturnToDetails(false);
                  setMessage('');
                  void save(s);
                }}
              >
                <Plus size={22} weight="bold"/> إضافة عقار
              </button>

              <button
                className="homeActionCard btnSecondary"
                disabled={busy}
                onClick={() => {
                  void refresh().then(() => {
                    setView('list');
                    setMessage('');
                  });
                }}
              >
                <SquaresFour size={22} weight="bold"/> المواقع ({sites.length})
              </button>
            </div>
          </div>
        ) : view === 'list' ? (
          /* SCREEN 2: سجل المواقع */
          <>
            <div className="viewHeader">
              <div className="viewHeaderTitle">
                <button type="button" className="backBtn" onClick={() => { setView('home'); setMessage(''); }}>
                  → رجوع
                </button>
                <h1>المواقع</h1>
                <span className="count">({filteredSites.length})</span>
              </div>

              <button
                disabled={busy}
                className="btnPrimary btnSmall"
                onClick={() => {
                  const s = {...fresh(), createdName: account.display_name, createdBy: account.user_id};
                  setSite(s);
                  setView('edit');
                  setReturnToDetails(false);
                  setMessage('');
                  void save(s);
                }}
              >
                <Plus size={16} weight="bold"/> إضافة عقار
              </button>
            </div>

            <div className="filterBar">
              <div className="searchInputWrap">
                <input
                  aria-label="البحث عن عقار"
                  placeholder="ابحث بالاسم، المنطقة، المالك…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>

              <select
                className="filterSelect"
                aria-label="تصفية المواقع"
                value={filterTab}
                onChange={e => setFilterTab(e.target.value as 'all' | 'pending' | 'high' | 'mine')}
              >
                <option value="all">جميع العقارات ({sites.length})</option>
                <option value="pending">محفوظ على الجهاز ({sites.filter(s => s.dirty || s.remotePending).length})</option>
                <option value="high">أولوية عالية ({sites.filter(s => s.priority === 'عالية').length})</option>
                <option value="mine">عقاراتي ({sites.filter(s => s.createdBy === account.user_id).length})</option>
              </select>

              <button
                type="button"
                className="layoutToggleBtn"
                onClick={() => setLayout(l => l === 'cards' ? 'table' : 'cards')}
                aria-label={layout === 'cards' ? 'التبديل إلى عرض الجدول' : 'التبديل إلى عرض البطاقات'}
                title={layout === 'cards' ? 'عرض كجدول' : 'عرض كبطاقات'}
              >
                {layout === 'cards' ? <Table size={18}/> : <SquaresFour size={18}/>}
              </button>
            </div>

            {account.role === 'admin' && allSurveyors.length > 1 && (
              <div className="formField" style={{marginBottom: 14}}>
                <select
                  className="formSelect"
                  aria-label="تصفية بحسب الموظف"
                  value={surveyorFilter}
                  onChange={e => setSurveyorFilter(e.target.value)}
                >
                  <option value="">جميع الموظفين ({allSurveyors.length})</option>
                  {allSurveyors.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
            )}

            {filteredSites.length === 0 ? (
              <div className="emptyState">
                <p>لا توجد عقارات تطابق البحث.</p>
              </div>
            ) : layout === 'cards' ? (
              <div className="siteCards">
                {filteredSites.map(s => {
                  const hasPhoto = Boolean(s.photos && s.photos.length > 0 && s.photos[0]);
                  const statusBadge = (
                    s.conflict ? (
                      <span className="statusPill conflict">تعارض</span>
                    ) : s.remotePending ? (
                      <span className="statusPill syncing">رفع الصور</span>
                    ) : s.dirty ? (
                      <span className="statusPill pending">محفوظ على الجهاز</span>
                    ) : (
                      <span className="statusPill synced">متزامن</span>
                    )
                  );

                  return (
                    <button
                      className={`siteCard ${hasPhoto ? 'siteCardWithPhoto' : 'siteCardCompact'}`}
                      key={s.id}
                      disabled={busy}
                      onClick={() => void open(s, 'details')}
                    >
                      {hasPhoto ? (
                        <>
                          <div className="cover">
                            <Photo key={s.photos[0].id} photo={s.photos[0]}/>
                            <div className="cardBadge">
                              {statusBadge}
                            </div>
                          </div>
                          <div className="cardBody">
                            <h2 className="cardTitle">{s.name || 'عقار بلا اسم'}</h2>
                            <p className="cardStreet">{s.street || 'لم تُحدد المنطقة'}</p>
                            <div className="cardMeta">
                              <span className="cardSurveyor">مُدخل العقار: {s.createdName || 'غير محدد'}</span>
                              <span className={`priorityTag priority-${s.priority}`}>{s.priority}</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="cardCompactInner">
                          <div className="cardCompactTop">
                            <div className="cardBadge">
                              {statusBadge}
                            </div>
                            <span className={`priorityTag priority-${s.priority}`}>{s.priority}</span>
                          </div>
                          <div className="cardBody">
                            <h2 className="cardTitle">{s.name || 'عقار بلا اسم'}</h2>
                            <p className="cardStreet">{s.street || 'لم تُحدد المنطقة'}</p>
                            <div className="cardMeta">
                              <span className="cardSurveyor">مُدخل العقار: {s.createdName || 'غير محدد'}</span>
                              <span className="noPhotoIndicator"><CameraSlash size={14} weight="bold"/> بدون صورة</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="tableWrap">
                <table className="sitesTable">
                  <thead>
                    <tr>
                      <th>العقار</th>
                      <th>المنطقة</th>
                      <th>الأولوية</th>
                      <th>الحالة</th>
                      <th>مُدخل العقار</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSites.map(s => (
                      <tr key={s.id} onClick={() => void open(s, 'details')} style={{cursor: 'pointer'}}>
                        <td>
                          <button
                            disabled={busy}
                            className="tableSiteBtn"
                            onClick={e => { e.stopPropagation(); void open(s, 'details'); }}
                          >
                            <div className="tableSiteThumb">
                              {s.photos[0] && <Photo key={s.photos[0].id} photo={s.photos[0]}/>}
                            </div>
                            <span>{s.name || 'عقار بلا اسم'}</span>
                          </button>
                        </td>
                        <td>{s.street || '—'}</td>
                        <td><span className={`priorityTag priority-${s.priority}`}>{s.priority}</span></td>
                        <td>
                          {s.conflict ? (
                            <span className="statusPill conflict">تعارض</span>
                          ) : s.remotePending ? (
                            <span className="statusPill syncing">رفع الصور</span>
                          ) : s.dirty ? (
                            <span className="statusPill pending">محفوظ على الجهاز</span>
                          ) : (
                            <span className="statusPill synced">متزامن</span>
                          )}
                        </td>
                        <td>{s.createdName || 'غير محدد'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : site && (
          /* SCREEN 3 & 4: تفاصيل العقار أو التعديل */
          <>
            <div className="viewHeader">
              <button type="button" className="backBtn" disabled={busy} onClick={() => void back()}>
                → رجوع
              </button>
              <div className="headerActions">
                {view === 'details' ? (
                  <span style={{fontSize: 13, fontWeight: 600, color: 'var(--ink-muted)'}}>
                    تفاصيل العقار
                  </span>
                ) : (
                  <span style={{fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)'}}>
                    {returnToDetails && site.name ? 'تعديل: ' + site.name : 'إضافة عقار'}
                  </span>
                )}
              </div>
            </div>

            {/* حالة التزامن للعقار الحالي */}
            <div style={{marginBottom: 12}}>
              {site.conflict ? (
                <span className="statusPill conflict">⚠️ يوجد تعديل من زميل آخر يحتاج اعتماد أحد الخيارين</span>
              ) : site.remotePending ? (
                <span className="statusPill syncing">☁️ جارٍ رفع الصور إلى السحابة…</span>
              ) : site.dirty ? (
                <span className="statusPill pending">⏳ محفوظ على الجهاز — بانتظار الاتصال</span>
              ) : (
                <span className="statusPill synced">✓ متزامن</span>
              )}
            </div>

            {/* حل التعارض إن وجد */}
            {!!site.conflict && (
              <div className="cardSection" style={{borderColor: 'var(--status-error-border)'}}>
                <h2>تعارض في التعديل المتزامن</h2>
                <p style={{fontSize: 13, color: 'var(--ink-secondary)'}}>
                  قام زميل آخر بتعديل هذا العقار. اختر النسخة التي تريد اعتمادها:
                </p>
                <div style={{display: 'flex', gap: 10, marginTop: 10}}>
                  <button
                    className="btnPrimary btnSmall"
                    onClick={() => {
                      void resolveConflict(site, 'remote').then(s => {
                        setSite(s);
                        current.current = s;
                        void refresh();
                      });
                    }}
                  >
                    اعتماد نسخة الفريق
                  </button>
                  <button
                    className="btnSecondary btnSmall"
                    onClick={() => {
                      void resolveConflict(site, 'local').then(s => {
                        setSite(s);
                        current.current = s;
                        scheduleSync();
                      });
                    }}
                  >
                    اعتماد نسختي المحلية
                  </button>
                </div>
              </div>
            )}

            {view === 'edit' ? (
              /* SCREEN 4: نموذج إضافة / تعديل العقار */
              <fieldset disabled={busy} style={{border: 0, padding: 0, margin: 0}}>
                {submitAttempted && Object.keys(errors).length > 0 && (
                  <div className="notice" style={{borderColor: 'var(--status-error-border)', color: 'var(--status-error-text)'}}>
                    <span>يرجى ملء الحقول المطلوبة (اسم العقار والمنطقة).</span>
                  </div>
                )}

                {/* 1. الموقع والإحداثيات */}
                <div className="formSection">
                  <h2 className="formSectionTitle">الموقع والإحداثيات</h2>
                  {input('name', 'اسم العقار *', 'text', 'مثال: برج الساعة')}
                  {input('street', 'المنطقة أو الشارع *', 'text', 'مثال: تقاطع حي الجامعة')}

                  <button type="button" className="gpsBtn" disabled={isLocating} onClick={() => void locate()}>
                    <MapPin size={18} className={isLocating ? 'spin' : ''} aria-hidden="true"/>
                    {isLocating ? 'جارٍ تحديد الموقع عبر GPS…' : 'تحديد موقعي الحالي عبر GPS'}
                  </button>

                  <div className="mapDetailWrap">
                    <Map lat={site.lat} lng={site.lng} onChange={(lat, lng) => update({lat, lng})}/>
                  </div>
                  <p className="coordText">
                    {site.lat ? `${site.lat.toFixed(6)}, ${site.lng?.toFixed(6)}` : 'لم تُحدد الإحداثيات بعد'}
                  </p>
                </div>

                {/* 2. الصور */}
                <div className="formSection">
                  <h2 className="formSectionTitle">الصور ({site.photos.length} / 100)</h2>
                  <div className="photoUploadRow">
                    <label className="fileButton btnSecondary">
                      <Camera size={20} aria-hidden="true"/> التقاط بالكاميرا
                      <input type="file" accept="image/*" capture="environment" onChange={e => { void addPhotos(e.target.files); e.target.value = ''; }}/>
                    </label>
                    <label className="fileButton btnSecondary">
                      <Images size={20} aria-hidden="true"/> اختيار من الألبوم
                      <input type="file" accept="image/*" multiple onChange={e => { void addPhotos(e.target.files); e.target.value = ''; }}/>
                    </label>
                  </div>

                  {site.photos.length > 0 ? (
                    <div className="photosGrid">
                      {site.photos.map(p => (
                        <div key={p.id} className="photoItemWrap">
                          <Photo photo={p} interactive onRemove={() => removePhoto(p.id)}/>
                          <button
                            type="button"
                            className="removePhotoBadge"
                            title="حذف الصورة"
                            aria-label="حذف الصورة"
                            onClick={() => removePhoto(p.id)}
                          >
                            <Trash size={12}/>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="noPhoto" style={{height: 48}}>لا توجد صور مرفقة بعد</span>
                  )}
                </div>

                {/* 3. مواصفات الإعلان */}
                <div className="formSection">
                  <h2 className="formSectionTitle">مواصفات الإعلان</h2>
                  <div className="formGrid2">
                    {select('kind', 'نوع العقار', ['تجاري', 'سكني', 'مختلط', 'حكومي / عام', 'أرض فضاء / موقع مفتوح', 'طريق سريع'])}
                    {select('position', 'موضع الإعلان', ['واجهة', 'جانب (جدارية)', 'سطح', 'عمود أحادي (يونيبول)', 'جسر مشاة', 'شاشة رقمية', 'سياج'])}
                  </div>

                  <div className="formGrid2">
                    {input('height', 'الارتفاع (متر)', 'decimal', 'مثال: 5')}
                    {input('width', 'العرض (متر)', 'decimal', 'مثال: 10')}
                  </div>

                  {select('visibility', 'وضوح الرؤية', ['', 'واضح جداً', 'جيد جداً', 'جيد', 'متوسط', 'ضعيف'])}

                  <div className="formField">
                    <label className="formLabel">الملاحظات</label>
                    <textarea
                      className="formTextarea"
                      value={site.notes}
                      placeholder="اتجاه السير، كثافة المارة، ملاحظات خاصة…"
                      onChange={e => update({notes: e.target.value})}
                    />
                  </div>
                </div>

                {/* 4. بيانات المالك والتواصل والتقييم */}
                <div className="formSection">
                  <h2 className="formSectionTitle">بيانات المالك والتقييم <small style={{fontWeight: 400, color: 'var(--ink-muted)'}}>(اختياري)</small></h2>
                  <div className="formGrid2">
                    {input('owner', 'اسم المالك أو المخوّل', 'text', 'اسم الشخص المعني')}
                    {select('role', 'الصفة القانونية', ['', 'مالك العقار', 'مخوّل بالإدارة', 'وكيل أو وسيط', 'مستأجر الموقع', 'جهة حكومية / بلدية', 'أخرى'])}
                  </div>

                  <div className="formGrid2">
                    {input('phone', 'رقم الهاتف', 'tel', '07xxxxxxxxx')}
                    {select('contact', 'حالة التواصل', ['لم يتم التواصل', 'تم التواصل الأولي', 'بانتظار الرد أو السعر', 'موافقة مبدئية', 'تم الاتفاق / التعاقد', 'تم الرفض'])}
                  </div>

                  <div className="formGrid2">
                    {input('price', 'التوقع المالي للإيجار', 'decimal', 'مثال: 1000')}
                    {select('priceCurrency', 'العملة', ['', 'دينار عراقي', 'دولار أمريكي'])}
                  </div>

                  <div className="formGrid2">
                    {select('priority', 'أولوية الموقع', ['عالية', 'متوسطة', 'استبعاد'])}
                    {select('next', 'الخطوة التالية', ['', 'الاتصال بالمالك', 'إعادة زيارة الموقع', 'رفع قياسات هندسية', 'طلب عرض مالي', 'إعداد مسودة عقد', 'مراجعة المشرف', 'استبعاد / لا متابعة', 'أخرى'])}
                  </div>
                </div>

                {/* Sticky Action Bar */}
                <div className="stickyBottomBar">
                  <div className="stickyBottomBarInner">
                    <button
                      type="button"
                      className="btnPrimary"
                      onClick={() => {
                        setSubmitAttempted(true);
                        if (site && Object.keys(errorsOf(site)).length > 0) {
                          setMessage('يرجى ملء الحقول المطلوبة قبل الحفظ.');
                          return;
                        }
                        void saveQueue.current.then(() => {
                          if (storageFailed.current) return;
                          setView('details');
                          setReturnToDetails(false);
                          setMessage('تم الحفظ');
                        });
                      }}
                    >
                      <Check size={20} weight="bold"/> حفظ
                    </button>
                  </div>
                </div>
              </fieldset>
            ) : (
              /* SCREEN 3: تفاصيل العقار */
              <div className="detailsContainer">
                <div className="detailsHero">
                  <h1>{site.name || 'عقار بلا اسم'}</h1>
                  <p className="street">{site.street || '—'}</p>
                </div>

                {/* 1. الصور */}
                <div className="cardSection">
                  <h2>الصور ({site.photos.length})</h2>
                  {site.photos.length > 0 ? (
                    <div className="photosGrid">
                      {site.photos.map(p => (
                        <Photo key={p.id} photo={p} interactive/>
                      ))}
                    </div>
                  ) : (
                    <span className="noPhoto" style={{height: 48}}>لا توجد صور مرفقة لهذا العقار.</span>
                  )}
                </div>

                {/* 2. الموقع على الخريطة */}
                {site.lat !== undefined && site.lng !== undefined && (
                  <div className="cardSection">
                    <h2>الموقع على الخريطة</h2>
                    <div className="mapDetailWrap">
                      <Map lat={site.lat} lng={site.lng}/>
                    </div>
                    {maps(site) && (
                      <a href={maps(site)} target="_blank" rel="noreferrer" className="mapExternalLink">
                        <MapPin size={16}/> فتح في Google Maps ↗
                      </a>
                    )}
                  </div>
                )}

                {/* 3. تفاصيل العقار */}
                <div className="cardSection">
                  <h2>تفاصيل العقار</h2>
                  <div className="propGrid">
                    <div className="propItem">
                      <span className="label">نوع العقار</span>
                      <span className="value">{site.kind}</span>
                    </div>
                    <div className="propItem">
                      <span className="label">موضع الإعلان</span>
                      <span className="value">{site.position}</span>
                    </div>
                    {dimensionText(site) && (
                      <div className="propItem">
                        <span className="label">الأبعاد</span>
                        <span className="value">{dimensionText(site)}</span>
                      </div>
                    )}
                    {site.visibility && (
                      <div className="propItem">
                        <span className="label">وضوح الرؤية</span>
                        <span className="value">{site.visibility}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. بيانات المالك والتواصل */}
                {(site.owner || site.phone || (site.contact && site.contact !== 'لم يتم التواصل') || priceText(site)) && (
                  <div className="cardSection">
                    <h2>بيانات المالك</h2>
                    <div className="propGrid">
                      {site.owner && (
                        <div className="propItem">
                          <span className="label">اسم المالك / المخوّل</span>
                          <span className="value">{site.owner}</span>
                        </div>
                      )}
                      {site.role && (
                        <div className="propItem">
                          <span className="label">الصفة</span>
                          <span className="value">{site.role}</span>
                        </div>
                      )}
                      {site.phone && (
                        <div className="propItem" style={{gridColumn: '1 / -1'}}>
                          <span className="label">رقم الهاتف</span>
                          <div className="phoneRow">
                            <a href={`tel:${toLatin(site.phone).replace(/[\s-]/g, '')}`} className="phoneCallBtn">
                              <Phone size={14}/> {site.phone}
                            </a>
                            <a
                              href={`https://wa.me/${toLatin(site.phone).replace(/[\s-]/g, '').replace(/^0/, '964').replace(/^\+/, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="whatsappBtn"
                            >
                              💬 واتساب
                            </a>
                          </div>
                        </div>
                      )}
                      {site.contact && site.contact !== 'لم يتم التواصل' && (
                        <div className="propItem">
                          <span className="label">حالة التواصل</span>
                          <span className="value">{site.contact}</span>
                        </div>
                      )}
                      {priceText(site) && (
                        <div className="propItem">
                          <span className="label">التوقع المالي</span>
                          <span className="value">{priceText(site)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 5. الملاحظات */}
                {site.notes && (
                  <div className="cardSection">
                    <h2>الملاحظات</h2>
                    <p style={{fontSize: 14, margin: 0, color: 'var(--ink-secondary)'}}>{site.notes}</p>
                  </div>
                )}

                {/* 6. معلومات إضافية */}
                <div className="cardSection">
                  <h2>معلومات إضافية</h2>
                  <div className="propGrid">
                    <div className="propItem">
                      <span className="label">مُدخل العقار</span>
                      <span className="value">{site.createdName || 'غير محدد'}</span>
                    </div>
                    <div className="propItem">
                      <span className="label">تاريخ الكشف</span>
                      <span className="value">{new Date(site.date).toLocaleDateString('ar-IQ')}</span>
                    </div>
                    <div className="propItem">
                      <span className="label">الأولوية</span>
                      <span className="value">
                        <span className={`priorityTag priority-${site.priority}`}>{site.priority}</span>
                      </span>
                    </div>
                    {site.next && (
                      <div className="propItem">
                        <span className="label">الخطوة التالية</span>
                        <span className="value">{site.next}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sticky Action Bar */}
                <div className="stickyBottomBar">
                  <div className="stickyBottomBarInner">
                    <button type="button" className="btnPrimary" onClick={() => { setView('edit'); setReturnToDetails(true); }}>
                      <PencilSimple size={18}/> تعديل
                    </button>
                    {account.role === 'admin' && (
                      <button
                        type="button"
                        className="btnDestructive"
                        style={{width: 'auto', minWidth: 90}}
                        onClick={() => {
                          if (!window.confirm('هل أنت متأكد من حذف عقار «' + (site.name || 'بلا اسم') + '»؟')) return;
                          void saveQueue.current.then(() => deleteSite(current.current!)).then(() => back()).catch(e => setMessage((e as Error).message));
                        }}
                      >
                        <Trash size={16}/> حذف
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Admin / Settings Modal Sheet */}
      {showSettings && (
        <div className="modalBackdrop" onClick={() => setShowSettings(false)}>
          <div className="modalSheet" onClick={e => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>إعدادات الحساب</h2>
              <button type="button" className="modalCloseBtn" onClick={() => setShowSettings(false)}>
                <X size={18}/>
              </button>
            </div>

            <div style={{fontSize: 14, color: 'var(--ink-secondary)', display: 'flex', flexDirection: 'column', gap: 4}}>
              <strong>{account.display_name}</strong>
              <small>{account.role === 'admin' ? 'مشرف الفريق' : 'عضو ميداني'}</small>
            </div>

            <button type="button" className="btnSecondary" onClick={triggerManualSync} disabled={isSyncing}>
              <ArrowsClockwise size={16} className={isSyncing ? 'spin' : ''}/> {isSyncing ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
            </button>

            {account.role === 'admin' && (
              <>
                <button
                  type="button"
                  className="btnSecondary"
                  onClick={() => {
                    setMessage('جارٍ إعداد الأرشيف (ZIP)…');
                    setShowSettings(false);
                    void import('./backup').then(m => m.downloadBackup()).then(() => setMessage('تم تنزيل الأرشيف بنجاح.')).catch(e => setMessage((e as Error).message));
                  }}
                >
                  نسخة احتياطية (ZIP)
                </button>

                {googleStatus === 'connected' ? (
                  <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                    <span style={{fontSize: 12, color: 'var(--ink-muted)'}} dir="ltr">Drive: {googleEmail}</span>
                    <div style={{display: 'flex', gap: 8}}>
                      <button type="button" className="btnSecondary" style={{flex: 1}} disabled={googleBusy} onClick={() => void syncGoogleNow()}>
                        {googleBusy ? 'جارٍ المزامنة…' : 'نسخة Google Drive'}
                      </button>
                      <button type="button" className="btnDestructive btnSmall" onClick={() => void disconnectGoogle()}>
                        قطع الاتصال
                      </button>
                    </div>
                  </div>
                ) : googleStatus === 'disconnected' ? (
                  <button type="button" className="btnSecondary" onClick={connectGoogle}>
                    ربط Google Drive
                  </button>
                ) : null}
              </>
            )}

            <button
              type="button"
              className="btnDestructive"
              onClick={() => {
                setShowSettings(false);
                void saveQueue.current.then(() => {
                  if (!storageFailed.current) return onLogout();
                });
              }}
            >
              <SignOut size={16}/> تسجيل الخروج
            </button>
          </div>
        </div>
      )}
    </>
  );
}

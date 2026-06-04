import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Plus, Trash2, Pencil, Check, X, Lock, Users } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

/**
 * Trainer Salary Definitions — PRIVATE owner-only page (System Admin).
 *
 * Data is grouped into "trainer systems" (نظام مدرب). Each system is a named
 * group holding one or more shift rows. The user can add a new system, rename
 * or delete it, and add/edit/delete shift rows inside it.
 *
 * The user edits raw inputs (shift, days, hr, week, total amount, kpis); the
 * derived columns are computed live and never stored:
 *   T.W Hours           = days × hr × week
 *   Per Hour            = total_amount ÷ T.W Hours
 *   Rate Per H For Kpis = kpis ÷ T.W Hours
 *
 * Access is locked to username='admin' at three layers (sidebar, route guard,
 * backend). This component assumes it's only ever rendered for the owner.
 */

// Trim a computed float to at most 5 decimals, dropping trailing zeros.
function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1e5) / 1e5);
}
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// Is an override value actually set (vs. empty → use auto formula)?
const hasVal = (v) => v !== '' && v !== null && v !== undefined;

const blankRow = () => ({
  shift_type: 'Full Time', days: 0, hr: 0, week: 0, total_amount: 0, kpis: 0,
  tw_hours_override: '', per_hour_override: '', rate_per_h_override: '',
});

/**
 * Resolve the effective values for a row. An override (if set) wins over the
 * formula; otherwise the formula is used. Per Hours / Rate use the EFFECTIVE
 * T.W Hours so overriding T.W cascades correctly.
 */
function effective(r) {
  const twAuto = num(r.days) * num(r.hr) * num(r.week);
  const tw = hasVal(r.tw_hours_override) ? num(r.tw_hours_override) : twAuto;
  const perAuto = tw > 0 ? num(r.total_amount) / tw : 0;
  const per = hasVal(r.per_hour_override) ? num(r.per_hour_override) : perAuto;
  const rateAuto = tw > 0 ? num(r.kpis) / tw : 0;
  const rate = hasVal(r.rate_per_h_override) ? num(r.rate_per_h_override) : rateAuto;
  return {
    twAuto, tw, twManual: hasVal(r.tw_hours_override),
    perAuto, per, perManual: hasVal(r.per_hour_override),
    rateAuto, rate, rateManual: hasVal(r.rate_per_h_override),
  };
}

export default function TrainerSalaries() {
  const qc = useQueryClient();
  const [addingSystem, setAddingSystem] = useState(false);
  const [newSystemName, setNewSystemName] = useState('');

  const { data: systems = [], isLoading } = useQuery({
    queryKey: ['trainer-salaries'],
    queryFn: () => api.get('/trainer-salaries').then(r => r.data),
    staleTime: 30 * 1000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['trainer-salaries'] });

  const createSystem = useMutation({
    mutationFn: (name) => api.post('/trainer-salaries/systems', { name }),
    onSuccess: () => { invalidate(); setAddingSystem(false); setNewSystemName(''); },
  });

  const totalRows = systems.reduce((a, s) => a + (s.rows?.length || 0), 0);

  // Shift-type suggestions for the editable Shifts field: the two defaults plus
  // every distinct value already used, so custom types (Free Lance, Project,
  // "Full Time From 7 To 12", …) are remembered and offered as autocomplete.
  const shiftOptions = Array.from(new Set([
    'Full Time', 'Part Time',
    ...systems.flatMap(s => (s.rows || []).map(r => r.shift_type)).filter(Boolean),
  ]));

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      {/* Shared autocomplete source for every Shifts field on the page */}
      <datalist id="salary-shift-types">
        {shiftOptions.map(o => <option key={o} value={o} />)}
      </datalist>

      <PageHero
        title="مرتبات المدربين"
        subtitle="تعريف أنظمة المرتبات — صفحة خاصة بصاحب الحساب فقط"
        icon={Wallet}
        gradient="amber"
        actions={
          <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur border border-white/20 rounded-xl px-3 py-1.5 text-xs font-bold text-white">
            <Lock size={13} /> خاص بيك فقط
          </span>
        }
      />

      {/* Toolbar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-3 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[120px]">
          <p className="text-xs text-gray-500">
            {isLoading ? 'جاري التحميل...' : `${systems.length} نظام · ${totalRows} صف`}
          </p>
        </div>
        {addingSystem ? (
          <div className="flex items-center gap-2">
            <input autoFocus type="text" value={newSystemName}
              onChange={e => setNewSystemName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newSystemName.trim()) createSystem.mutate(newSystemName.trim()); if (e.key === 'Escape') { setAddingSystem(false); setNewSystemName(''); } }}
              placeholder="اسم النظام (مثلاً: فون كول)"
              className="px-3 py-2 rounded-xl border border-gray-300 text-sm w-56" />
            <button onClick={() => newSystemName.trim() && createSystem.mutate(newSystemName.trim())}
              disabled={!newSystemName.trim() || createSystem.isPending}
              className="px-3 py-2 rounded-xl bg-emerald-500 text-white font-bold text-sm inline-flex items-center gap-1 disabled:opacity-50">
              <Check size={14} /> حفظ
            </button>
            <button onClick={() => { setAddingSystem(false); setNewSystemName(''); }}
              className="px-3 py-2 rounded-xl border border-gray-300 text-sm">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button onClick={() => setAddingSystem(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-white font-bold text-sm inline-flex items-center gap-2">
            <Plus size={14} /> إضافة نظام مدرب جديد
          </button>
        )}
      </div>

      {/* Systems */}
      {isLoading ? (
        <p className="text-center text-gray-400 py-12 text-sm">جاري التحميل...</p>
      ) : systems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 text-center py-12">
          <Wallet size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">لا توجد أنظمة بعد</p>
          <p className="text-xs text-gray-400 mt-1">اضغط "إضافة نظام مدرب جديد" للبدء</p>
        </div>
      ) : (
        <div className="space-y-5">
          {systems.map(sys => (
            <SystemCard key={sys.id} system={sys} onChanged={invalidate} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-400 px-1 leading-relaxed">
        الأعمدة <span className="text-gray-500 font-semibold">T.W Hours / Per Hours / Rate Per H Kpis</span> بتتحسب تلقائيًا (T.W = Days×Hr×Week · Per = Total÷T.W · Rate = Kpis÷T.W)،
        وتقدر تكتب فيها قيمة بإيدك لتجاوز المعادلة — القيمة اليدوية بتتلوّن <span className="text-amber-700 font-semibold">أصفر غامق ✎</span>، واضغط <span className="font-semibold">✕</span> جنبها للرجوع للحساب التلقائي.
      </p>
    </div>
  );
}

/* ── One trainer system (named group) with its shift rows ────────────── */
function SystemCard({ system, onChanged }) {
  const qc = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(system.name);
  const [editRowId, setEditRowId] = useState(null);
  const [rowDraft, setRowDraft] = useState(null);
  const [adding, setAdding] = useState(false);

  const reset = () => { setEditRowId(null); setRowDraft(null); setAdding(false); };

  const renameSys = useMutation({
    mutationFn: (name) => api.put(`/trainer-salaries/systems/${system.id}`, { name }),
    onSuccess: () => { onChanged(); setEditingName(false); },
  });
  const deleteSys = useMutation({
    mutationFn: () => api.delete(`/trainer-salaries/systems/${system.id}`),
    onSuccess: onChanged,
  });
  const createRow = useMutation({
    mutationFn: (body) => api.post('/trainer-salaries/rows', { ...body, system_id: system.id }),
    onSuccess: () => { onChanged(); reset(); },
  });
  const updateRow = useMutation({
    mutationFn: ({ id, body }) => api.put(`/trainer-salaries/rows/${id}`, body),
    onSuccess: () => { onChanged(); reset(); },
  });
  const deleteRow = useMutation({
    mutationFn: (id) => api.delete(`/trainer-salaries/rows/${id}`),
    onSuccess: onChanged,
  });

  const startEdit = (r) => {
    setAdding(false);
    setEditRowId(r.id);
    // Override columns come back as null from the API → '' for the inputs.
    setRowDraft({
      ...r,
      tw_hours_override:   r.tw_hours_override   ?? '',
      per_hour_override:   r.per_hour_override   ?? '',
      rate_per_h_override: r.rate_per_h_override ?? '',
    });
  };
  const startAdd  = () => { setEditRowId(null); setAdding(true); setRowDraft(blankRow()); };
  const setField  = (k, v) => setRowDraft(d => ({ ...d, [k]: v }));

  const rows = system.rows || [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* System header */}
      <div className="px-4 py-3 bg-gradient-to-l from-amber-50 to-yellow-50 border-b border-amber-100 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
          <Users size={17} />
        </div>
        {editingName ? (
          <div className="flex items-center gap-2 flex-1">
            <input autoFocus type="text" value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && nameDraft.trim()) renameSys.mutate(nameDraft.trim()); if (e.key === 'Escape') { setEditingName(false); setNameDraft(system.name); } }}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-bold flex-1 max-w-xs" />
            <IconBtn color="green" title="حفظ" onClick={() => nameDraft.trim() && renameSys.mutate(nameDraft.trim())} disabled={renameSys.isPending}><Check size={15} /></IconBtn>
            <IconBtn color="gray" title="إلغاء" onClick={() => { setEditingName(false); setNameDraft(system.name); }}><X size={15} /></IconBtn>
          </div>
        ) : (
          <>
            <h3 className="font-black text-gray-900 text-base flex-1">{system.name || '—'}</h3>
            <IconBtn color="amber" title="إعادة تسمية النظام" onClick={() => { setNameDraft(system.name); setEditingName(true); }}><Pencil size={14} /></IconBtn>
            <IconBtn color="red" title="حذف النظام بالكامل" onClick={() => {
              if (confirm(`حذف نظام "${system.name}" وكل صفوفه (${rows.length})؟`)) deleteSys.mutate();
            }}><Trash2 size={14} /></IconBtn>
          </>
        )}
      </div>

      {/* Rows table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse" dir="ltr">
          <thead>
            <tr className="bg-yellow-300 text-gray-900">
              {['Shifts','Days','Hr','Week','T.W Hours','Total Amount','Per Hours','Kpis','Rate Per H For Kpis',''].map((h, i) => (
                <th key={i} className="font-bold py-2 px-2 border border-gray-400 whitespace-nowrap text-center">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isEditing = editRowId === row.id;
              const r = isEditing ? rowDraft : row;
              const e = effective(r);
              return (
                <tr key={row.id} className={isEditing ? 'bg-amber-50' : 'hover:bg-yellow-50/40'}>
                  {isEditing ? (
                    <>
                      <Td><ShiftSelect value={r.shift_type} onChange={v => setField('shift_type', v)} /></Td>
                      <Td><NumInput value={r.days} onChange={v => setField('days', v)} /></Td>
                      <Td><NumInput value={r.hr} onChange={v => setField('hr', v)} /></Td>
                      <Td><NumInput value={r.week} onChange={v => setField('week', v)} /></Td>
                      <Td><OverrideInput value={r.tw_hours_override} autoValue={e.twAuto} onChange={v => setField('tw_hours_override', v)} /></Td>
                      <Td><NumInput value={r.total_amount} onChange={v => setField('total_amount', v)} /></Td>
                      <Td><OverrideInput value={r.per_hour_override} autoValue={e.perAuto} onChange={v => setField('per_hour_override', v)} /></Td>
                      <Td><NumInput value={r.kpis} onChange={v => setField('kpis', v)} /></Td>
                      <Td><OverrideInput value={r.rate_per_h_override} autoValue={e.rateAuto} onChange={v => setField('rate_per_h_override', v)} /></Td>
                      <Td>
                        <div className="flex items-center justify-center gap-1">
                          <IconBtn color="green" title="حفظ" onClick={() => updateRow.mutate({ id: editRowId, body: rowDraft })} disabled={updateRow.isPending}><Check size={15} /></IconBtn>
                          <IconBtn color="gray" title="إلغاء" onClick={reset}><X size={15} /></IconBtn>
                        </div>
                      </Td>
                    </>
                  ) : (
                    <>
                      <Td>{row.shift_type}</Td>
                      <Td>{fmt(num(row.days))}</Td>
                      <Td>{fmt(num(row.hr))}</Td>
                      <Td>{fmt(num(row.week))}</Td>
                      <CalcCell value={e.tw} manual={e.twManual} />
                      <Td>{fmt(num(row.total_amount))}</Td>
                      <CalcCell value={e.per} manual={e.perManual} />
                      <Td>{fmt(num(row.kpis))}</Td>
                      <CalcCell value={e.rate} manual={e.rateManual} />
                      <Td>
                        <div className="flex items-center justify-center gap-1">
                          <IconBtn color="amber" title="تعديل" onClick={() => startEdit(row)}><Pencil size={14} /></IconBtn>
                          <IconBtn color="red" title="حذف الصف" onClick={() => {
                            if (confirm(`حذف صف "${row.shift_type}"؟`)) deleteRow.mutate(row.id);
                          }}><Trash2 size={14} /></IconBtn>
                        </div>
                      </Td>
                    </>
                  )}
                </tr>
              );
            })}

            {/* Add-row editor */}
            {adding && rowDraft && (() => {
              const e = effective(rowDraft);
              return (
                <tr className="bg-emerald-50">
                  <Td><ShiftSelect value={rowDraft.shift_type} onChange={v => setField('shift_type', v)} /></Td>
                  <Td><NumInput value={rowDraft.days} onChange={v => setField('days', v)} /></Td>
                  <Td><NumInput value={rowDraft.hr} onChange={v => setField('hr', v)} /></Td>
                  <Td><NumInput value={rowDraft.week} onChange={v => setField('week', v)} /></Td>
                  <Td><OverrideInput value={rowDraft.tw_hours_override} autoValue={e.twAuto} onChange={v => setField('tw_hours_override', v)} /></Td>
                  <Td><NumInput value={rowDraft.total_amount} onChange={v => setField('total_amount', v)} /></Td>
                  <Td><OverrideInput value={rowDraft.per_hour_override} autoValue={e.perAuto} onChange={v => setField('per_hour_override', v)} /></Td>
                  <Td><NumInput value={rowDraft.kpis} onChange={v => setField('kpis', v)} /></Td>
                  <Td><OverrideInput value={rowDraft.rate_per_h_override} autoValue={e.rateAuto} onChange={v => setField('rate_per_h_override', v)} /></Td>
                  <Td>
                    <div className="flex items-center justify-center gap-1">
                      <IconBtn color="green" title="إضافة" onClick={() => createRow.mutate(rowDraft)} disabled={createRow.isPending}><Check size={15} /></IconBtn>
                      <IconBtn color="gray" title="إلغاء" onClick={reset}><X size={15} /></IconBtn>
                    </div>
                  </Td>
                </tr>
              );
            })()}

            {rows.length === 0 && !adding && (
              <tr>
                <td colSpan={10} className="text-center text-gray-400 py-6 text-xs border border-gray-200">
                  لا توجد صفوف في هذا النظام
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add-row button */}
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100">
        <button onClick={startAdd} disabled={adding}
          className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
          <Plus size={13} /> إضافة صف لهذا النظام
        </button>
      </div>
    </div>
  );
}

/* ── small presentational helpers ───────────────────────────────────── */
function Td({ children, computed, className = '', dir }) {
  return (
    <td dir={dir}
      className={`border border-gray-300 px-2 py-1.5 text-center ${computed ? 'bg-yellow-50 font-semibold text-gray-700' : ''} ${className}`}>
      {children}
    </td>
  );
}

function NumInput({ value, onChange }) {
  return (
    <input type="number" value={value} min={0} step="any"
      onChange={e => onChange(e.target.value)}
      className="w-20 px-2 py-1 rounded border border-gray-300 text-sm text-center" />
  );
}

// Read-only computed cell. Yellow = auto formula, amber = a manual override.
function CalcCell({ value, manual }) {
  return (
    <td
      title={manual ? 'قيمة يدوية (تجاوز المعادلة)' : 'محسوبة تلقائيًا'}
      className={`border border-gray-300 px-2 py-1.5 text-center font-semibold ${
        manual ? 'bg-amber-100 text-amber-800' : 'bg-yellow-50 text-gray-700'
      }`}>
      {fmt(value)}{manual && <span className="text-[9px] align-top mr-0.5">✎</span>}
    </td>
  );
}

// Editable override input. Empty → auto (placeholder shows the formula value).
// A typed value turns amber and shows a ↺ button to revert to auto.
function OverrideInput({ value, autoValue, onChange }) {
  const overridden = value !== '' && value !== null && value !== undefined;
  return (
    <div className="flex items-center justify-center gap-1">
      <input type="number" step="any" value={value ?? ''}
        placeholder={fmt(autoValue)}
        onChange={e => onChange(e.target.value)}
        title={overridden ? 'قيمة يدوية' : `تلقائي: ${fmt(autoValue)} (سيبها فاضية للحساب التلقائي)`}
        className={`w-24 px-2 py-1 rounded border text-sm text-center ${
          overridden ? 'border-amber-400 bg-amber-50 font-bold text-amber-700' : 'border-gray-300'
        }`} />
      {overridden && (
        <button type="button" onClick={() => onChange('')} title="رجوع للحساب التلقائي"
          className="text-gray-400 hover:text-red-500 flex-shrink-0">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// Editable shift field: free text with autocomplete suggestions from the
// shared <datalist>. Lets the owner type any custom shift type while still
// offering one-click picks for common/previously-used ones.
function ShiftSelect({ value, onChange }) {
  return (
    <input type="text" list="salary-shift-types" value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="نوع الشيفت"
      className="w-36 px-2 py-1 rounded border border-gray-300 text-sm bg-white text-center" />
  );
}

const ICON_BTN_COLORS = {
  green: 'text-emerald-600 hover:bg-emerald-50',
  red:   'text-red-500 hover:bg-red-50',
  amber: 'text-amber-600 hover:bg-amber-50',
  gray:  'text-gray-500 hover:bg-gray-100',
};
function IconBtn({ children, color = 'gray', onClick, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      className={`p-1.5 rounded-lg transition disabled:opacity-40 ${ICON_BTN_COLORS[color]}`}>
      {children}
    </button>
  );
}

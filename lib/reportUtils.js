function getTurnoBucket(turno) {
  const t = String(turno || '').toLowerCase();
  if (t === 'manha' || t === 'matutino') return 'matutino';
  if (t === 'tarde' || t === 'vespertino') return 'vespertino';
  return 'outros';
}

function splitByTurnoPreservingOrder(items, turnoKey = 'turno') {
  const groups = {
    matutino: { label: 'Matutino', items: [] },
    vespertino: { label: 'Vespertino', items: [] },
    outros: { label: 'Outros turnos', items: [] },
  };

  for (const item of items || []) {
    const bucket = getTurnoBucket(item?.[turnoKey]);
    if (bucket === 'matutino') groups.matutino.items.push(item);
    else if (bucket === 'vespertino') groups.vespertino.items.push(item);
    else groups.outros.items.push(item);
  }

  return groups;
}

function splitTurmasByTurnoPreservingOrder(turmas) {
  return splitByTurnoPreservingOrder(turmas, 'turno');
}

function dateToYmd(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeFrequenciaStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'P' || normalized === 'F' || normalized === 'J') return normalized;
  return normalized || null;
}

function normalizeHistoricoFrequenciaRow(row) {
  if (!row) return row;
  return {
    ...row,
    data: dateToYmd(row.data) || row.data,
    horario: Number(row.horario || 1),
    status: normalizeFrequenciaStatus(row.status),
    observacao: row.observacao || '',
    lancado_por_nome: row.lancado_por_nome || row.lancado_por || null,
    turma_nome: row.turma_nome || null,
  };
}

module.exports = {
  getTurnoBucket,
  splitByTurnoPreservingOrder,
  splitTurmasByTurnoPreservingOrder,
  dateToYmd,
  normalizeFrequenciaStatus,
  normalizeHistoricoFrequenciaRow,
};

const fs = require('fs');
const path = require('path');

const DEMO_PATH = path.join(__dirname, '..', 'data', 'demo.json');

function loadDemo() {
  const data = JSON.parse(fs.readFileSync(DEMO_PATH, 'utf8'));
  data.mensagens = data.mensagens || [];
  data.mensagem_destinatarios = data.mensagem_destinatarios || [];
  data.alertas_frequencia_automaticos = data.alertas_frequencia_automaticos || [];
  data.frequencia_solicitacoes_edicao = data.frequencia_solicitacoes_edicao || [];
  data.frequencia_alteracoes = data.frequencia_alteracoes || [];
  data.frequencia_solicitacoes_lancamento = data.frequencia_solicitacoes_lancamento || [];
  data.configuracoes = data.configuracoes || {};
  return data;
}

function saveDemo(data) {
  fs.writeFileSync(DEMO_PATH, JSON.stringify(data, null, 2));
}

function padCodigo(codigo) {
  return String(codigo ?? '').trim().replace(/^0+(?=\d)/, '');
}

function formatCodigoNome(codigo, nome) {
  return `${padCodigo(codigo)} - ${nome}`;
}

const collatorPtBr = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

function compareAlunoNome(a, b) {
  const nomeA = String(a?.nome || '').trim();
  const nomeB = String(b?.nome || '').trim();
  const porNome = collatorPtBr.compare(nomeA, nomeB);
  if (porNome !== 0) return porNome;
  return collatorPtBr.compare(String(a?.codigo || ''), String(b?.codigo || ''));
}

function getTodayYmdLocal() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const DIAS_SEMANA = [
  { value: 'segunda', label: 'Segunda-feira', day: 1 },
  { value: 'terca', label: 'Terca-feira', day: 2 },
  { value: 'quarta', label: 'Quarta-feira', day: 3 },
  { value: 'quinta', label: 'Quinta-feira', day: 4 },
  { value: 'sexta', label: 'Sexta-feira', day: 5 },
];
const HORARIOS_LANCAMENTO = [1, 6];

function criarEscalaSemanaVazia() {
  return DIAS_SEMANA.reduce((acc, dia) => {
    acc[dia.value] = {
      1: { professor_id: null, professor_nome: null },
      6: { professor_id: null, professor_nome: null },
    };
    return acc;
  }, {});
}

function getDiaSemanaFromDateStr(dataStr) {
  if (!dataStr) return null;
  const [ano, mes, dia] = String(dataStr).split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  const data = new Date(ano, mes - 1, dia);
  const weekday = data.getDay();
  return DIAS_SEMANA.find((item) => item.day === weekday)?.value || null;
}

function normalizeProfessorId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extrairEscalaSemana(payload = {}) {
  let encontrouCampo = false;
  const escala = [];
  for (const dia of DIAS_SEMANA) {
    for (const horario of HORARIOS_LANCAMENTO) {
      const campo = `professor_${dia.value}_${horario}`;
      if (Object.prototype.hasOwnProperty.call(payload, campo)) encontrouCampo = true;
      const professorId = normalizeProfessorId(payload[campo]);
      if (professorId) {
        escala.push({ dia_semana: dia.value, horario, professor_id: professorId });
      }
    }
  }
  if (encontrouCampo) return escala;

  const professorPrimeiro = normalizeProfessorId(payload.professor_primeiro_horario_id);
  const professorSexto = normalizeProfessorId(payload.professor_sexto_horario_id);
  return DIAS_SEMANA.flatMap((dia) => {
    const itens = [];
    if (professorPrimeiro) itens.push({ dia_semana: dia.value, horario: 1, professor_id: professorPrimeiro });
    if (professorSexto) itens.push({ dia_semana: dia.value, horario: 6, professor_id: professorSexto });
    return itens;
  });
}

function montarEscalaSemana(payload = {}, data) {
  const escala = criarEscalaSemanaVazia();
  extrairEscalaSemana(payload).forEach((item) => {
    const professor = data.usuarios.find((u) => u.id === Number(item.professor_id) && u.ativo);
    escala[item.dia_semana][item.horario] = {
      professor_id: professor?.id || null,
      professor_nome: professor?.nome || null,
    };
  });
  return escala;
}

function getDiaSemanaLabel(value) {
  return DIAS_SEMANA.find((dia) => dia.value === value)?.label || value;
}

function getProfessorResponsavelTurmaHorario(turma, diaSemana, horario) {
  const professorEscala = turma?.escala_semana?.[diaSemana]?.[horario];
  if (professorEscala?.professor_id) {
    return {
      professor_id: Number(professorEscala.professor_id),
      professor_nome: professorEscala.professor_nome || null,
    };
  }
  if (Number(horario) === 6 && turma?.professor_sexto_horario_id) {
    return {
      professor_id: Number(turma.professor_sexto_horario_id),
      professor_nome: turma.professor_sexto_horario_nome || null,
    };
  }
  if (Number(horario) !== 6 && turma?.professor_primeiro_horario_id) {
    return {
      professor_id: Number(turma.professor_primeiro_horario_id),
      professor_nome: turma.professor_primeiro_horario_nome || null,
    };
  }
  return { professor_id: null, professor_nome: null };
}

function decorateTurma(turma, data) {
  if (!turma) return null;
  const escalaBase = turma.escala_semana || criarEscalaSemanaVazia();
  const escala_semana = criarEscalaSemanaVazia();
  DIAS_SEMANA.forEach((dia) => {
    HORARIOS_LANCAMENTO.forEach((horario) => {
      const professorId = normalizeProfessorId(escalaBase?.[dia.value]?.[horario]?.professor_id);
      const professor = data.usuarios.find((u) => u.id === professorId && u.ativo);
      escala_semana[dia.value][horario] = {
        professor_id: professor?.id || null,
        professor_nome: professor?.nome || null,
      };
    });
  });
  const professorPrimeiro = escala_semana.segunda?.[1] || { professor_id: null, professor_nome: null };
  const professorSexto = escala_semana.segunda?.[6] || { professor_id: null, professor_nome: null };
  return {
    ...turma,
    professor_primeiro_horario_id: professorPrimeiro.professor_id,
    professor_sexto_horario_id: professorSexto.professor_id,
    professor_primeiro_horario_nome: professorPrimeiro.professor_nome,
    professor_sexto_horario_nome: professorSexto.professor_nome,
    escala_semana,
  };
}

function nextId(items) {
  return items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;
}

function getTurmas(usuarioId = null) {
  const data = loadDemo();
  let turmas = data.turmas.filter((t) => t.ativa);
  if (usuarioId) {
    const usuario = data.usuarios.find((u) => u.id === Number(usuarioId) && u.ativo);
    const turmasIds = new Set(Array.isArray(usuario?.turmas) ? usuario.turmas.map(Number) : []);
    turmas = turmas.filter((t) => turmasIds.has(Number(t.id)));
  }
  return turmas.map((turma) => decorateTurma(turma, data));
}

function getTurma(id) {
  const data = loadDemo();
  const turma = data.turmas.find((t) => t.id === Number(id) && t.ativa);
  return decorateTurma(turma, data);
}

function getProfessoresAtivos() {
  const data = loadDemo();
  return data.usuarios
    .filter((u) => u.ativo && u.perfil === 'professor')
    .map((u) => ({ id: u.id, nome: u.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function cadastrarTurma({ nome, serie, turno, ano_letivo, professor_primeiro_horario_id, professor_sexto_horario_id }) {
  const data = loadDemo();
  const escala_semana = montarEscalaSemana({ nome, serie, turno, ano_letivo, professor_primeiro_horario_id, professor_sexto_horario_id, ...arguments[0] }, data);
  const professorPrimeiro = escala_semana.segunda?.[1]?.professor_id || null;
  const professorSexto = escala_semana.segunda?.[6]?.professor_id || null;
  const turma = {
    id: nextId(data.turmas),
    nome: String(nome || '').trim(),
    serie: String(serie || '').trim(),
    turno: String(turno || '').trim(),
    ano_letivo: Number(ano_letivo),
    ativa: 1,
    total_alunos: 0,
    professor_responsavel_id: professorPrimeiro || professorSexto || null,
    professor_primeiro_horario_id: professorPrimeiro,
    professor_sexto_horario_id: professorSexto,
    escala_semana,
  };
  data.turmas.push(turma);
  data.usuarios.forEach((usuario) => {
    if (usuario.perfil !== 'professor' || !usuario.ativo) return;
    const professorIds = new Set(
      DIAS_SEMANA.flatMap((dia) => HORARIOS_LANCAMENTO.map((horario) => escala_semana[dia.value][horario].professor_id)).filter(Boolean)
    );
    if (!professorIds.has(usuario.id)) return;
    usuario.turmas = Array.isArray(usuario.turmas) ? usuario.turmas : [];
    if (!usuario.turmas.includes(turma.id)) usuario.turmas.push(turma.id);
  });
  saveDemo(data);
  return turma.id;
}

function atualizarTurma(id, { nome, serie, turno, ano_letivo, professor_primeiro_horario_id, professor_sexto_horario_id }) {
  const data = loadDemo();
  const turma = data.turmas.find((t) => t.id === Number(id) && t.ativa);
  if (!turma) throw new Error('Turma não encontrada.');

  const escala_semana = montarEscalaSemana({ nome, serie, turno, ano_letivo, professor_primeiro_horario_id, professor_sexto_horario_id, ...arguments[1] }, data);
  const professorPrimeiro = escala_semana.segunda?.[1]?.professor_id || null;
  const professorSexto = escala_semana.segunda?.[6]?.professor_id || null;

  turma.nome = String(nome || '').trim();
  turma.serie = String(serie || '').trim();
  turma.turno = String(turno || '').trim();
  turma.ano_letivo = Number(ano_letivo);
  turma.professor_responsavel_id = professorPrimeiro || professorSexto || null;
  turma.professor_primeiro_horario_id = professorPrimeiro;
  turma.professor_sexto_horario_id = professorSexto;
  turma.escala_semana = escala_semana;

  data.usuarios.forEach((usuario) => {
    if (usuario.perfil !== 'professor' || !usuario.ativo) return;
    const professorIds = new Set(
      DIAS_SEMANA.flatMap((dia) => HORARIOS_LANCAMENTO.map((horario) => escala_semana[dia.value][horario].professor_id)).filter(Boolean)
    );
    if (!professorIds.has(usuario.id)) return;
    usuario.turmas = Array.isArray(usuario.turmas) ? usuario.turmas : [];
    if (!usuario.turmas.includes(turma.id)) usuario.turmas.push(turma.id);
  });

  saveDemo(data);
}

function getTurmasProfessorHorario(usuarioId, horario = 1, dataStr = null) {
  const data = loadDemo();
  const usuario = data.usuarios.find((u) => u.id === Number(usuarioId) && u.ativo);
  if (!usuario) return [];

  const diaSemana = getDiaSemanaFromDateStr(dataStr);
  const turmasIds = new Set(Array.isArray(usuario.turmas) ? usuario.turmas.map(Number) : []);
  return data.turmas
    .filter((t) => t.ativa)
    .filter((t) => {
      const turma = decorateTurma(t, data);
      const professorId = diaSemana ? turma.escala_semana?.[diaSemana]?.[horario]?.professor_id : null;
      const fallbackId = Number(horario) === 6 ? turma.professor_sexto_horario_id : turma.professor_primeiro_horario_id;
      const responsavel = professorId || fallbackId || null;
      return Number(responsavel) === Number(usuarioId) || (!responsavel && turmasIds.has(Number(t.id)));
    })
    .map((turma) => decorateTurma(turma, data));
}

function usuarioPodeLancarHorarioNaTurma(usuarioId, turmaId, horario = 1, dataStr = null) {
  const data = loadDemo();
  const turmaBase = data.turmas.find((t) => t.id === Number(turmaId) && t.ativa);
  const usuario = data.usuarios.find((u) => u.id === Number(usuarioId) && u.ativo);
  if (!turmaBase || !usuario) return false;
  const turma = decorateTurma(turmaBase, data);
  const diaSemana = getDiaSemanaFromDateStr(dataStr);
  const professorId = diaSemana ? turma.escala_semana?.[diaSemana]?.[horario]?.professor_id : null;
  const fallbackId = Number(horario) === 6 ? turma.professor_sexto_horario_id : turma.professor_primeiro_horario_id;
  if (professorId || fallbackId) return Number(professorId || fallbackId) === Number(usuarioId);
  const turmasIds = new Set(Array.isArray(usuario.turmas) ? usuario.turmas.map(Number) : []);
  return turmasIds.has(Number(turmaId));
}

function getAlunos(filtros = {}) {
  const data = loadDemo();
  let alunos = data.alunos.map((a) => ({
    ...a,
    codigo_formatado: padCodigo(a.codigo),
    codigo_nome: formatCodigoNome(a.codigo, a.nome),
  }));

  if (filtros.ativo !== undefined) {
    alunos = alunos.filter((a) => a.ativo === filtros.ativo);
  }
  if (filtros.turma_id) {
    alunos = alunos.filter((a) => a.turma_id === Number(filtros.turma_id));
  }
  if (filtros.busca) {
    const q = filtros.busca.toLowerCase();
    alunos = alunos.filter(
      (a) =>
        a.codigo.includes(q) ||
        a.nome.toLowerCase().includes(q) ||
        a.codigo_nome.toLowerCase().includes(q)
    );
  }

  return alunos.sort(compareAlunoNome);
}

function getAlunosPaginados(filtros = {}) {
  const page = Math.max(1, Number.parseInt(filtros.page, 10) || 1);
  const perPageRaw = Number.parseInt(filtros.per_page ?? filtros.perPage, 10);
  const perPage = Math.min(200, Math.max(10, Number.isFinite(perPageRaw) ? perPageRaw : 10));
  const offset = (page - 1) * perPage;

  const alunos = getAlunos({
    ativo: filtros.ativo,
    turma_id: filtros.turma_id,
    busca: filtros.busca,
  });

  const total = alunos.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageClamped = Math.min(page, totalPages);
  const offsetClamped = (pageClamped - 1) * perPage;
  const items = alunos.slice(offsetClamped, offsetClamped + perPage);

  return {
    items,
    total,
    page: pageClamped,
    per_page: perPage,
    total_pages: totalPages,
  };
}

function getAluno(id) {
  return getAlunos().find((a) => a.id === Number(id));
}

function cadastrarAluno({ codigo, nome, data_nascimento, turma_id, data_matricula }) {
  const data = loadDemo();

  if (!/^[0-9]{1,8}$/.test(codigo)) {
    throw new Error('Código deve conter apenas números (máx. 8 dígitos).');
  }
  if (data.alunos.some((a) => a.codigo === codigo)) {
    throw new Error('Código já cadastrado.');
  }

  const turma = data.turmas.find((t) => t.id === Number(turma_id));
  if (!turma) throw new Error('Turma não encontrada.');

  const aluno = {
    id: nextId(data.alunos),
    codigo,
    nome,
    data_nascimento: data_nascimento || null,
    ativo: 1,
    turma_id: turma.id,
    turma_nome: turma.nome,
  };

  data.alunos.push(aluno);
  turma.total_alunos = data.alunos.filter((a) => a.turma_id === turma.id && a.ativo).length;
  saveDemo(data);
  return aluno;
}

function transferirAluno(alunoId, turmaDestinoId) {
  const data = loadDemo();
  const aluno = data.alunos.find((a) => a.id === Number(alunoId));
  const turmaDestino = data.turmas.find((t) => t.id === Number(turmaDestinoId));

  if (!aluno || !aluno.ativo) throw new Error('Aluno não encontrado ou inativo.');
  if (!turmaDestino) throw new Error('Turma destino não encontrada.');

  const turmaAnterior = data.turmas.find((t) => t.id === aluno.turma_id);
  aluno.turma_id = turmaDestino.id;
  aluno.turma_nome = turmaDestino.nome;

  data.turmas.forEach((t) => {
    t.total_alunos = data.alunos.filter((a) => a.turma_id === t.id && a.ativo).length;
  });

  saveDemo(data);
  return { aluno, turmaAnterior: turmaAnterior?.nome, turmaDestino: turmaDestino.nome };
}

function desativarAluno(alunoId) {
  const data = loadDemo();
  const aluno = data.alunos.find((a) => a.id === Number(alunoId));
  if (!aluno) throw new Error('Aluno não encontrado.');

  aluno.ativo = 0;
  aluno.turma_id = null;
  aluno.turma_nome = null;

  data.turmas.forEach((t) => {
    t.total_alunos = data.alunos.filter((a) => a.turma_id === t.id && a.ativo).length;
  });

  saveDemo(data);
  return aluno;
}

function getProjetos() {
  const data = loadDemo();
  return data.projetos.filter((p) => p.ativo);
}

function getProjeto(id) {
  return getProjetos().find((p) => p.id === Number(id));
}

function getAlunosProjeto(projetoId) {
  const data = loadDemo();
  const ids = data.projeto_alunos
    .filter((pa) => pa.projeto_id === Number(projetoId))
    .map((pa) => pa.aluno_id);

  return getAlunos({ ativo: 1 })
    .filter((a) => ids.includes(a.id))
    .sort(compareAlunoNome);
}

function toggleAlunoProjeto(projetoId, alunoId) {
  const data = loadDemo();
  const idx = data.projeto_alunos.findIndex(
    (pa) => pa.projeto_id === Number(projetoId) && pa.aluno_id === Number(alunoId)
  );

  if (idx >= 0) {
    data.projeto_alunos.splice(idx, 1);
  } else {
    data.projeto_alunos.push({ projeto_id: Number(projetoId), aluno_id: Number(alunoId) });
  }

  data.projetos.forEach((p) => {
    p.total_alunos = data.projeto_alunos.filter((pa) => pa.projeto_id === p.id).length;
  });

  saveDemo(data);
}

function frequenciaJaLancada(turmaId, dataStr, horario = 1) {
  const data = loadDemo();
  return data.frequencias.some(
    (f) => f.turma_id === Number(turmaId) && f.data === dataStr && Number(f.horario || 1) === Number(horario)
  );
}

function getFrequenciaTurma(turmaId, dataStr, horario = 1) {
  const alunos = getAlunos({ turma_id: turmaId, ativo: 1 });
  const data = loadDemo();
  const lancamentos = data.frequencias.filter(
    (f) => f.turma_id === Number(turmaId) && f.data === dataStr && Number(f.horario || 1) === Number(horario)
  );

  return alunos.map((aluno) => {
    const freq = lancamentos.find((f) => f.aluno_id === aluno.id);
    return {
      ...aluno,
      status: freq?.status || null,
      observacao: freq?.observacao || '',
    };
  });
}

function salvarFrequencia(turmaId, dataStr, registros, usuarioId, horario = 1) {
  const data = loadDemo();
  if (frequenciaJaLancada(turmaId, dataStr, horario)) {
    throw new Error(`A frequência da turma já foi lançada para o ${horario}º horário nesta data.`);
  }

  registros.forEach((r) => {
    if (r.status) {
      data.frequencias.push({
        aluno_id: Number(r.aluno_id),
        turma_id: Number(turmaId),
        data: dataStr,
        horario: Number(horario),
        status: r.status,
        observacao: r.observacao || '',
        lancado_por: usuarioId,
      });
    }
  });

  saveDemo(data);
}

function getSolicitacaoEdicaoFrequenciaById(id) {
  const data = loadDemo();
  const solicitacao = data.frequencia_solicitacoes_edicao.find((item) => item.id === Number(id));
  if (!solicitacao) return null;
  const turma = data.turmas.find((t) => t.id === Number(solicitacao.turma_id));
  const solicitante = data.usuarios.find((u) => u.id === Number(solicitacao.solicitante_id));
  const liberador = data.usuarios.find((u) => u.id === Number(solicitacao.liberado_por));
  return {
    ...solicitacao,
    turma_nome: turma?.nome || 'Turma',
    solicitante_nome: solicitante?.nome || 'Usuário',
    liberado_por_nome: liberador?.nome || null,
  };
}

function getSolicitacoesEdicaoFrequencia(turmaId, dataStr, horario = 1, solicitanteId = null) {
  const data = loadDemo();
  return data.frequencia_solicitacoes_edicao
    .filter((item) =>
      Number(item.turma_id) === Number(turmaId)
      && String(item.data) === String(dataStr)
      && Number(item.horario) === Number(horario)
      && ['pendente', 'liberada'].includes(item.status)
      && (!solicitanteId || Number(item.solicitante_id) === Number(solicitanteId))
    )
    .map((item) => getSolicitacaoEdicaoFrequenciaById(item.id))
    .sort((a, b) => {
      const prioridadeA = a.status === 'liberada' ? 0 : 1;
      const prioridadeB = b.status === 'liberada' ? 0 : 1;
      if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
      return String(b.criado_em || '').localeCompare(String(a.criado_em || ''));
    });
}

function getEdicaoLiberadaFrequencia(turmaId, dataStr, horario = 1, solicitanteId) {
  return getSolicitacoesEdicaoFrequencia(turmaId, dataStr, horario, solicitanteId)
    .find((item) => item.status === 'liberada') || null;
}

function solicitarEdicaoFrequencia(turmaId, dataStr, horario = 1, solicitanteId, motivo) {
  const data = loadDemo();
  const motivoLimpo = String(motivo || '').trim();
  if (!motivoLimpo) throw new Error('Informe o motivo da solicitação de alteração.');

  const existentes = getSolicitacoesEdicaoFrequencia(turmaId, dataStr, horario, solicitanteId);
  if (existentes.length > 0) {
    const jaLiberada = existentes.some((item) => item.status === 'liberada');
    throw new Error(
      jaLiberada
        ? 'Sua solicitação já foi liberada pelo administrador. Atualize a página para editar.'
        : 'Já existe uma solicitação pendente para esta turma, data e horário.'
    );
  }

  const item = {
    id: nextId(data.frequencia_solicitacoes_edicao),
    turma_id: Number(turmaId),
    data: dataStr,
    horario: Number(horario),
    solicitante_id: Number(solicitanteId),
    motivo: motivoLimpo,
    status: 'pendente',
    liberado_por: null,
    criado_em: new Date().toISOString(),
    liberado_em: null,
    atendido_em: null,
  };
  data.frequencia_solicitacoes_edicao.push(item);
  saveDemo(data);
  return getSolicitacaoEdicaoFrequenciaById(item.id);
}

function liberarEdicaoFrequencia(solicitacaoId, adminId) {
  const data = loadDemo();
  const item = data.frequencia_solicitacoes_edicao.find((row) => row.id === Number(solicitacaoId));
  if (!item || item.status !== 'pendente') {
    throw new Error('Solicitação não encontrada ou já foi tratada.');
  }
  item.status = 'liberada';
  item.liberado_por = Number(adminId);
  item.liberado_em = new Date().toISOString();
  saveDemo(data);
  return getSolicitacaoEdicaoFrequenciaById(item.id);
}

function usuarioPodeEditarFrequenciaLancada(usuarioId, turmaId, dataStr, horario = 1) {
  return Boolean(getEdicaoLiberadaFrequencia(turmaId, dataStr, horario, usuarioId));
}

function getSolicitacaoLancamentoForaHorarioById(id) {
  const data = loadDemo();
  const solicitacao = data.frequencia_solicitacoes_lancamento.find((item) => item.id === Number(id));
  if (!solicitacao) return null;
  const turma = data.turmas.find((t) => t.id === Number(solicitacao.turma_id));
  const solicitante = data.usuarios.find((u) => u.id === Number(solicitacao.solicitante_id));
  const liberador = data.usuarios.find((u) => u.id === Number(solicitacao.liberado_por));
  return {
    ...solicitacao,
    turma_nome: turma?.nome || 'Turma',
    solicitante_nome: solicitante?.nome || 'Usuário',
    liberado_por_nome: liberador?.nome || null,
  };
}

function getSolicitacoesLancamentoForaHorario(turmaId, dataStr, horario = 1, solicitanteId = null) {
  const data = loadDemo();
  return data.frequencia_solicitacoes_lancamento
    .filter((item) =>
      Number(item.turma_id) === Number(turmaId)
      && String(item.data) === String(dataStr)
      && Number(item.horario) === Number(horario)
      && ['pendente', 'liberada'].includes(item.status)
      && (!solicitanteId || Number(item.solicitante_id) === Number(solicitanteId))
    )
    .map((item) => getSolicitacaoLancamentoForaHorarioById(item.id))
    .sort((a, b) => {
      const prioridadeA = a.status === 'liberada' ? 0 : 1;
      const prioridadeB = b.status === 'liberada' ? 0 : 1;
      if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
      return String(b.criado_em || '').localeCompare(String(a.criado_em || ''));
    });
}

function getLancamentoForaHorarioLiberado(turmaId, dataStr, horario = 1, solicitanteId) {
  return getSolicitacoesLancamentoForaHorario(turmaId, dataStr, horario, solicitanteId)
    .find((item) => item.status === 'liberada') || null;
}

function solicitarLancamentoForaHorario(turmaId, dataStr, horario = 1, solicitanteId, motivo) {
  const data = loadDemo();
  const motivoLimpo = String(motivo || '').trim();
  if (!motivoLimpo) throw new Error('Informe o motivo da solicitação de lançamento fora do horário.');

  const existentes = getSolicitacoesLancamentoForaHorario(turmaId, dataStr, horario, solicitanteId);
  if (existentes.length > 0) {
    const jaLiberada = existentes.some((item) => item.status === 'liberada');
    throw new Error(
      jaLiberada
        ? 'Sua solicitação já foi liberada pelo administrador. Atualize a página para lançar a frequência.'
        : 'Já existe uma solicitação pendente de lançamento fora do horário para esta turma, data e horário.'
    );
  }

  const item = {
    id: nextId(data.frequencia_solicitacoes_lancamento),
    turma_id: Number(turmaId),
    data: dataStr,
    horario: Number(horario),
    solicitante_id: Number(solicitanteId),
    motivo: motivoLimpo,
    status: 'pendente',
    liberado_por: null,
    criado_em: new Date().toISOString(),
    liberado_em: null,
    atendido_em: null,
  };
  data.frequencia_solicitacoes_lancamento.push(item);
  saveDemo(data);
  return getSolicitacaoLancamentoForaHorarioById(item.id);
}

function liberarLancamentoForaHorario(solicitacaoId, adminId) {
  const data = loadDemo();
  const item = data.frequencia_solicitacoes_lancamento.find((row) => row.id === Number(solicitacaoId));
  if (!item || item.status !== 'pendente') {
    throw new Error('Solicitação não encontrada ou já foi tratada.');
  }
  item.status = 'liberada';
  item.liberado_por = Number(adminId);
  item.liberado_em = new Date().toISOString();
  saveDemo(data);
  return getSolicitacaoLancamentoForaHorarioById(item.id);
}

function usuarioPodeLancarForaHorario(usuarioId, turmaId, dataStr, horario = 1) {
  return Boolean(getLancamentoForaHorarioLiberado(turmaId, dataStr, horario, usuarioId));
}

function marcarSolicitacaoLancamentoForaHorarioAtendida(id) {
  const data = loadDemo();
  const solicitacaoId = Number.parseInt(id, 10);
  if (!Number.isFinite(solicitacaoId) || solicitacaoId <= 0) return 0;
  const item = data.frequencia_solicitacoes_lancamento.find((row) => row.id === solicitacaoId);
  if (!item || item.status !== 'liberada') return 0;
  item.status = 'atendida';
  item.atendido_em = new Date().toISOString();
  saveDemo(data);
  return 1;
}

function atualizarFrequencia(turmaId, dataStr, registros, usuarioId, horario = 1, justificativa, solicitacaoId = null) {
  const data = loadDemo();
  const justificativaLimpa = String(justificativa || '').trim();
  if (!justificativaLimpa) {
    throw new Error('Informe a justificativa da alteração da frequência.');
  }
  if (!frequenciaJaLancada(turmaId, dataStr, horario)) {
    throw new Error('Não existe frequência lançada para alterar nesta turma, data e horário.');
  }

  data.frequencias = data.frequencias.filter(
    (f) => !(Number(f.turma_id) === Number(turmaId) && String(f.data) === String(dataStr) && Number(f.horario || 1) === Number(horario))
  );

  registros.forEach((r) => {
    if (r.status) {
      data.frequencias.push({
        aluno_id: Number(r.aluno_id),
        turma_id: Number(turmaId),
        data: dataStr,
        horario: Number(horario),
        status: r.status,
        observacao: r.observacao || '',
        lancado_por: usuarioId,
        lancado_em: new Date().toISOString(),
      });
    }
  });

  data.frequencia_alteracoes.push({
    id: nextId(data.frequencia_alteracoes),
    turma_id: Number(turmaId),
    data: dataStr,
    horario: Number(horario),
    alterado_por: Number(usuarioId),
    justificativa: justificativaLimpa,
    solicitacao_id: solicitacaoId ? Number(solicitacaoId) : null,
    criado_em: new Date().toISOString(),
  });

  if (solicitacaoId) {
    const solicitacao = data.frequencia_solicitacoes_edicao.find((item) => item.id === Number(solicitacaoId));
    if (solicitacao && solicitacao.status === 'liberada') {
      solicitacao.status = 'atendida';
      solicitacao.atendido_em = new Date().toISOString();
    }
  }

  saveDemo(data);
}

function relatorioLancamentosDia(dataStr) {
  const data = loadDemo();
  const agrupado = new Map();
  data.frequencias
    .filter((f) => f.data === dataStr)
    .forEach((f) => {
      const chave = `${f.turma_id}-${Number(f.horario || 1)}`;
      if (!agrupado.has(chave)) {
        const turma = data.turmas.find((t) => t.id === Number(f.turma_id));
        const usuario = data.usuarios.find((u) => u.id === Number(f.lancado_por));
        agrupado.set(chave, {
          turma_id: Number(f.turma_id),
          turma_nome: turma?.nome || 'Turma',
          turno: turma?.turno || '',
          horario: Number(f.horario || 1),
          lancado_por: usuario?.nome || 'Sistema',
          data_lancamento: f.lancado_em || f.atualizado_em || new Date().toISOString(),
          total_registros: 0,
        });
      }
      agrupado.get(chave).total_registros += 1;
    });
  return [...agrupado.values()].sort((a, b) => {
    const turmaCmp = String(a.turma_nome || '').localeCompare(String(b.turma_nome || ''), 'pt-BR');
    if (turmaCmp !== 0) return turmaCmp;
    return Number(a.horario) - Number(b.horario);
  });
}

function relatorioPendenciasLancamentoDia(dataStr) {
  const diaSemana = getDiaSemanaFromDateStr(dataStr);
  if (!diaSemana) return [];
  const turmas = getTurmas();
  const lancamentos = relatorioLancamentosDia(dataStr);
  const lancamentosMap = new Map(
    lancamentos.map((item) => [`${item.turma_id}-${item.horario}`, item])
  );

  return turmas
    .flatMap((turma) => HORARIOS_LANCAMENTO.map((horario) => {
      const responsavel = getProfessorResponsavelTurmaHorario(turma, diaSemana, horario);
      const lancamento = lancamentosMap.get(`${turma.id}-${horario}`) || null;
      const status = lancamento
        ? 'lancado'
        : responsavel.professor_id
          ? 'pendente'
          : 'sem_responsavel';
      return {
        data: dataStr,
        dia_semana: diaSemana,
        dia_semana_label: getDiaSemanaLabel(diaSemana),
        turma_id: turma.id,
        turma_nome: turma.nome,
        turno: turma.turno,
        horario,
        professor_id: responsavel.professor_id,
        professor_nome: responsavel.professor_nome,
        status,
        lancado_por: lancamento?.lancado_por || null,
        data_lancamento: lancamento?.data_lancamento || null,
      };
    }))
    .sort((a, b) => {
      const turmaCmp = String(a.turma_nome || '').localeCompare(String(b.turma_nome || ''), 'pt-BR');
      if (turmaCmp !== 0) return turmaCmp;
      return Number(a.horario) - Number(b.horario);
    });
}

function relatorioProjetoMes(projetoId, ano, mes) {
  const alunos = getAlunosProjeto(projetoId);
  const data = loadDemo();
  const inicio = new Date(ano, mes - 1, 1);
  const fim = new Date(ano, mes, 0);

  return alunos.map((aluno) => {
    const freqs = data.frequencias.filter((f) => {
      if (f.aluno_id !== aluno.id) return false;
      const d = new Date(f.data + 'T12:00:00');
      return d >= inicio && d <= fim;
    });

    const dias = freqs.length;
    const presencas = freqs.filter((f) => f.status === 'P').length;
    const faltas = freqs.filter((f) => f.status === 'F').length;
    const justificadas = freqs.filter((f) => f.status === 'J').length;

    return {
      codigo: aluno.codigo,
      codigo_formatado: aluno.codigo_formatado,
      nome: aluno.nome,
      codigo_nome: aluno.codigo_nome,
      turma: aluno.turma_nome,
      dias_lancados: dias,
      presencas,
      faltas,
      justificadas,
      percentual_presenca: dias ? Math.round((presencas / dias) * 10000) / 100 : 0,
      percentual_faltas: dias ? Math.round((faltas / dias) * 10000) / 100 : 0,
    };
  });
}

function getRelatorioFrequenciaTurmaDetalhado(turmaId, mes, ano) {
  const data = loadDemo();
  const inicio = new Date(ano, mes - 1, 1);
  const fim = new Date(ano, mes, 0);
  const agrupado = new Map();

  data.frequencias
    .filter((f) => Number(f.turma_id) === Number(turmaId))
    .forEach((f) => {
      const d = new Date(`${f.data}T12:00:00`);
      if (d < inicio || d > fim) return;
      const chave = `${f.data}-${Number(f.horario || 1)}`;
      if (!agrupado.has(chave)) {
        const usuario = data.usuarios.find((u) => u.id === Number(f.lancado_por));
        agrupado.set(chave, {
          data: f.data,
          horario: Number(f.horario || 1),
          total_registros: 0,
          presencas: 0,
          faltas: 0,
          justificadas: 0,
          data_lancamento: f.lancado_em || f.atualizado_em || new Date().toISOString(),
          lancado_por: usuario?.nome || 'Sistema',
        });
      }
      const item = agrupado.get(chave);
      item.total_registros += 1;
      if (f.status === 'P') item.presencas += 1;
      if (f.status === 'F') item.faltas += 1;
      if (f.status === 'J') item.justificadas += 1;
    });

  return [...agrupado.values()].sort((a, b) => {
    const dataCmp = String(a.data).localeCompare(String(b.data));
    if (dataCmp !== 0) return dataCmp;
    return Number(a.horario) - Number(b.horario);
  });
}

function getDashboardStats() {
  const data = loadDemo();
  const alunosAtivos = data.alunos.filter((a) => a.ativo).length;
  const turmasAtivas = data.turmas.filter((t) => t.ativa).length;
  const projetosAtivos = data.projetos.filter((p) => p.ativo).length;
  const projetosAtivosIds = new Set(data.projetos.filter((p) => p.ativo).map((p) => p.id));
  const alunosAtivosIds = new Set(data.alunos.filter((a) => a.ativo).map((a) => a.id));
  const alunosProjetos = new Set(
    data.projeto_alunos
      .filter((pa) => projetosAtivosIds.has(pa.projeto_id) && alunosAtivosIds.has(pa.aluno_id))
      .map((pa) => pa.aluno_id)
  ).size;
  const hoje = getTodayYmdLocal();
  const lancamentosHoje = data.frequencias.filter((f) => f.data === hoje).length;

  return { alunosAtivos, turmasAtivas, projetosAtivos, alunosProjetos, lancamentosHoje };
}

function autenticar(cpf, senha) {
  const data = loadDemo();
  const cpfLimpo = String(cpf ?? '').replace(/\D/g, '');
  const usuario = data.usuarios.find((u) => String(u.cpf ?? '').replace(/\D/g, '') === cpfLimpo && u.ativo);
  if (!usuario) return null;
  if (senha !== 'demo123') return null;
  return usuario;
}

function getUsuariosDestinatarios() {
  const data = loadDemo();
  return data.usuarios
    .filter((u) => u.ativo)
    .map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function criarMensagemInternaData(data, { remetente_id, titulo, corpo, tipo_destino, perfil_destino, usuario_ids }) {
  const mensagem = {
    id: nextId(data.mensagens),
    remetente_id: Number(remetente_id),
    titulo: String(titulo || '').trim(),
    corpo: String(corpo || '').trim(),
    tipo_destino: String(tipo_destino || 'todos'),
    perfil_destino: perfil_destino || null,
    criado_em: new Date().toISOString(),
  };

  let destinatarios = [];
  if (mensagem.tipo_destino === 'todos') {
    destinatarios = data.usuarios.filter((u) => u.ativo && u.id !== mensagem.remetente_id).map((u) => u.id);
  } else if (mensagem.tipo_destino === 'perfil') {
    destinatarios = data.usuarios
      .filter((u) => u.ativo && u.perfil === mensagem.perfil_destino && u.id !== mensagem.remetente_id)
      .map((u) => u.id);
  } else {
    const ids = [...new Set((Array.isArray(usuario_ids) ? usuario_ids : [usuario_ids])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0 && n !== mensagem.remetente_id))];
    destinatarios = data.usuarios.filter((u) => u.ativo && ids.includes(u.id)).map((u) => u.id);
  }

  if (!mensagem.titulo) throw new Error('Informe o título da mensagem.');
  if (!mensagem.corpo) throw new Error('Informe o conteúdo da mensagem.');
  if (!destinatarios.length) throw new Error('Nenhum destinatário ativo encontrado.');

  data.mensagens.push(mensagem);
  destinatarios.forEach((destinatarioId) => {
    data.mensagem_destinatarios.push({
      id: nextId(data.mensagem_destinatarios),
      mensagem_id: mensagem.id,
      destinatario_id: destinatarioId,
      lida_em: null,
      criado_em: new Date().toISOString(),
    });
  });
  return { id: mensagem.id, total_destinatarios: destinatarios.length };
}

function criarMensagemInterna(payload) {
  const data = loadDemo();
  const resultado = criarMensagemInternaData(data, payload);
  saveDemo(data);
  return resultado;
}

function getMensagensRecebidas(usuarioId) {
  const data = loadDemo();
  return data.mensagem_destinatarios
    .filter((md) => md.destinatario_id === Number(usuarioId))
    .map((md) => {
      const mensagem = data.mensagens.find((m) => m.id === md.mensagem_id);
      const remetente = data.usuarios.find((u) => u.id === mensagem?.remetente_id);
      return {
        destinatario_mensagem_id: md.id,
        lida_em: md.lida_em,
        mensagem_id: mensagem?.id,
        titulo: mensagem?.titulo,
        corpo: mensagem?.corpo,
        tipo_destino: mensagem?.tipo_destino,
        perfil_destino: mensagem?.perfil_destino,
        criado_em: mensagem?.criado_em,
        remetente_nome: remetente?.nome || 'Sistema',
      };
    })
    .sort((a, b) => {
      if (!!a.lida_em !== !!b.lida_em) return a.lida_em ? 1 : -1;
      return String(b.criado_em).localeCompare(String(a.criado_em));
    });
}

function contarMensagensNaoLidas(usuarioId) {
  const data = loadDemo();
  return data.mensagem_destinatarios.filter((md) => md.destinatario_id === Number(usuarioId) && !md.lida_em).length;
}

function marcarMensagemComoLida(destinatarioMensagemId, usuarioId) {
  const data = loadDemo();
  const item = data.mensagem_destinatarios.find((md) => md.id === Number(destinatarioMensagemId) && md.destinatario_id === Number(usuarioId));
  if (item && !item.lida_em) {
    item.lida_em = new Date().toISOString();
    saveDemo(data);
    return 1;
  }
  return 0;
}

function marcarTodasMensagensComoLidas(usuarioId) {
  const data = loadDemo();
  let total = 0;
  data.mensagem_destinatarios.forEach((md) => {
    if (md.destinatario_id === Number(usuarioId) && !md.lida_em) {
      md.lida_em = new Date().toISOString();
      total += 1;
    }
  });
  if (total) saveDemo(data);
  return total;
}

function marcarAvisoInicialComoLido(usuarioId) {
  const data = loadDemo();
  const usuario = data.usuarios.find((u) => u.id === Number(usuarioId));
  if (!usuario) return 0;
  if (!usuario.aviso_inicial_lido_em) {
    usuario.aviso_inicial_lido_em = new Date().toISOString();
    saveDemo(data);
  }
  return 1;
}

function processarAvisosPendenciaFrequenciaAutomaticos(dataStr) {
  const data = loadDemo();
  const pendencias = relatorioPendenciasLancamentoDia(dataStr)
    .filter((item) => item.status === 'pendente' && item.professor_id);
  if (!pendencias.length) {
    return { data: dataStr, total_pendencias: 0, avisos_criados: 0 };
  }

  const remetente = data.usuarios.find((u) => u.ativo && ['admin', 'direcao', 'coordenacao'].includes(u.perfil))
    || data.usuarios.find((u) => u.ativo);
  if (!remetente) {
    return { data: dataStr, total_pendencias: pendencias.length, avisos_criados: 0 };
  }

  const grupos = new Map();
  pendencias.forEach((item) => {
    if (!grupos.has(item.professor_id)) {
      grupos.set(item.professor_id, {
        professor_id: item.professor_id,
        itens: [],
      });
    }
    grupos.get(item.professor_id).itens.push(item);
  });

  let avisosCriados = 0;
  grupos.forEach((grupo, professorId) => {
    const jaExiste = data.alertas_frequencia_automaticos.some(
      (alerta) => alerta.referencia_data === dataStr && alerta.destinatario_id === Number(professorId)
    );
    if (jaExiste) return;

    const corpo = [
      `Aviso automático do sistema referente ao dia ${dataStr}.`,
      '',
      'O prazo para lançamento da frequência já terminou e ainda não foi identificado registro nas seguintes turmas/horários:',
      ...grupo.itens.map((item) => `- ${item.turma_nome} (${item.dia_semana_label}, ${item.horario}º horário)`),
      '',
      'Se ainda for necessário lançar a frequência, solicite a liberação ao administrador.',
      'O lançamento fora do horário permitido depende de autorização do administrador.'
    ].join('\n');

    const mensagem = criarMensagemInternaData(data, {
      remetente_id: remetente.id,
      titulo: `Pendência de frequência do dia ${dataStr}`,
      corpo,
      tipo_destino: 'usuarios',
      perfil_destino: '',
      usuario_ids: [professorId],
    });

    data.alertas_frequencia_automaticos.push({
      id: nextId(data.alertas_frequencia_automaticos),
      referencia_data: dataStr,
      destinatario_id: Number(professorId),
      mensagem_id: mensagem.id,
      total_pendencias: grupo.itens.length,
      criado_em: new Date().toISOString(),
    });
    avisosCriados += 1;
  });

  const destinatariosGestao = data.usuarios
    .filter((u) => u.ativo && ['admin', 'direcao'].includes(u.perfil))
    .sort((a, b) => {
      const perfilCmp = (a.perfil === 'admin' ? 0 : 1) - (b.perfil === 'admin' ? 0 : 1);
      if (perfilCmp !== 0) return perfilCmp;
      return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    });

  const linhasPendencias = [...pendencias]
    .sort((a, b) => {
      const turmaCmp = String(a.turma_nome || '').localeCompare(String(b.turma_nome || ''), 'pt-BR');
      if (turmaCmp !== 0) return turmaCmp;
      return Number(a.horario) - Number(b.horario);
    })
    .map((item) => `- ${item.turma_nome} | ${item.dia_semana_label} | ${item.horario}º horário | Professor: ${item.professor_nome || 'Não informado'}`);

  const corpoGestao = [
    `Relatório automático de pendências de frequência do dia ${dataStr}.`,
    '',
    `Total de pendências identificadas: ${pendencias.length}.`,
    '',
    'Turmas/horários sem lançamento:',
    ...linhasPendencias,
    '',
    'Os professores pendentes foram orientados a solicitar liberação ao administrador caso precisem lançar a frequência após o prazo.'
  ].join('\n');

  destinatariosGestao.forEach((destinatario) => {
    const jaExiste = data.alertas_frequencia_automaticos.some(
      (alerta) => alerta.referencia_data === dataStr && alerta.destinatario_id === Number(destinatario.id)
    );
    if (jaExiste) return;

    const mensagem = criarMensagemInternaData(data, {
      remetente_id: remetente.id,
      titulo: `Relatório de pendências de frequência do dia ${dataStr}`,
      corpo: corpoGestao,
      tipo_destino: 'usuarios',
      perfil_destino: '',
      usuario_ids: [destinatario.id],
    });

    data.alertas_frequencia_automaticos.push({
      id: nextId(data.alertas_frequencia_automaticos),
      referencia_data: dataStr,
      destinatario_id: Number(destinatario.id),
      mensagem_id: mensagem.id,
      total_pendencias: pendencias.length,
      criado_em: new Date().toISOString(),
    });
    avisosCriados += 1;
  });

  saveDemo(data);
  return { data: dataStr, total_pendencias: pendencias.length, avisos_criados: avisosCriados };
}

function getConfiguracaoAvisoPendenciaFrequencia() {
  const data = loadDemo();
  return {
    ativo: Boolean(data.configuracoes.alerta_pendencia_frequencia_ativo),
    atualizado_em: data.configuracoes.alerta_pendencia_frequencia_atualizado_em || null,
  };
}

function getConfiguracaoDirecaoLancarFrequencia() {
  const data = loadDemo();
  return {
    ativo: Boolean(data.configuracoes.direcao_lancar_frequencia_ativo),
    atualizado_em: data.configuracoes.direcao_lancar_frequencia_atualizado_em || null,
  };
}

function setConfiguracaoAvisoPendenciaFrequencia(ativo) {
  const data = loadDemo();
  data.configuracoes.alerta_pendencia_frequencia_ativo = Boolean(ativo);
  data.configuracoes.alerta_pendencia_frequencia_atualizado_em = new Date().toISOString();
  saveDemo(data);
  return getConfiguracaoAvisoPendenciaFrequencia();
}

function setConfiguracaoDirecaoLancarFrequencia(ativo) {
  const data = loadDemo();
  data.configuracoes.direcao_lancar_frequencia_ativo = Boolean(ativo);
  data.configuracoes.direcao_lancar_frequencia_atualizado_em = new Date().toISOString();
  saveDemo(data);
  return getConfiguracaoDirecaoLancarFrequencia();
}

module.exports = {
  padCodigo,
  formatCodigoNome,
  getTurmas,
  getTurma,
  cadastrarTurma,
  atualizarTurma,
  getAlunos,
  getAlunosPaginados,
  getAluno,
  cadastrarAluno,
  transferirAluno,
  desativarAluno,
  getProjetos,
  getProjeto,
  getAlunosProjeto,
  toggleAlunoProjeto,
  frequenciaJaLancada,
  getFrequenciaTurma,
  salvarFrequencia,
  relatorioLancamentosDia,
  relatorioPendenciasLancamentoDia,
  relatorioProjetoMes,
  getRelatorioFrequenciaTurmaDetalhado,
  getDashboardStats,
  getProfessoresAtivos,
  getTurmasProfessorHorario,
  autenticar,
  usuarioPodeLancarHorarioNaTurma,
  getSolicitacaoEdicaoFrequenciaById,
  getSolicitacoesEdicaoFrequencia,
  getEdicaoLiberadaFrequencia,
  solicitarEdicaoFrequencia,
  liberarEdicaoFrequencia,
  usuarioPodeEditarFrequenciaLancada,
  getSolicitacaoLancamentoForaHorarioById,
  getSolicitacoesLancamentoForaHorario,
  getLancamentoForaHorarioLiberado,
  solicitarLancamentoForaHorario,
  liberarLancamentoForaHorario,
  usuarioPodeLancarForaHorario,
  marcarSolicitacaoLancamentoForaHorarioAtendida,
  atualizarFrequencia,
  getUsuariosDestinatarios,
  criarMensagemInterna,
  processarAvisosPendenciaFrequenciaAutomaticos,
  getConfiguracaoAvisoPendenciaFrequencia,
  setConfiguracaoAvisoPendenciaFrequencia,
  getConfiguracaoDirecaoLancarFrequencia,
  setConfiguracaoDirecaoLancarFrequencia,
  getMensagensRecebidas,
  contarMensagensNaoLidas,
  marcarMensagemComoLida,
  marcarTodasMensagensComoLidas,
  marcarAvisoInicialComoLido,
};

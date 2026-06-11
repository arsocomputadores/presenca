const fs = require('fs');
const path = require('path');

const DEMO_PATH = path.join(__dirname, '..', 'data', 'demo.json');

function loadDemo() {
  const data = JSON.parse(fs.readFileSync(DEMO_PATH, 'utf8'));
  data.mensagens = data.mensagens || [];
  data.mensagem_destinatarios = data.mensagem_destinatarios || [];
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

function nextId(items) {
  return items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;
}

function getTurmas() {
  const data = loadDemo();
  return data.turmas.filter((t) => t.ativa);
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

  return alunos.sort((a, b) => Number(a.codigo) - Number(b.codigo));
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

  return getAlunos({ ativo: 1 }).filter((a) => ids.includes(a.id));
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

function getFrequenciaTurma(turmaId, dataStr) {
  const alunos = getAlunos({ turma_id: turmaId, ativo: 1 });
  const data = loadDemo();
  const lancamentos = data.frequencias.filter(
    (f) => f.turma_id === Number(turmaId) && f.data === dataStr
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

function salvarFrequencia(turmaId, dataStr, registros, usuarioId) {
  const data = loadDemo();
  data.frequencias = data.frequencias.filter(
    (f) => !(f.turma_id === Number(turmaId) && f.data === dataStr)
  );

  registros.forEach((r) => {
    if (r.status) {
      data.frequencias.push({
        aluno_id: Number(r.aluno_id),
        turma_id: Number(turmaId),
        data: dataStr,
        status: r.status,
        observacao: r.observacao || '',
        lancado_por: usuarioId,
      });
    }
  });

  saveDemo(data);
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

function getDashboardStats() {
  const data = loadDemo();
  const alunosAtivos = data.alunos.filter((a) => a.ativo).length;
  const turmasAtivas = data.turmas.filter((t) => t.ativa).length;
  const projetosAtivos = data.projetos.filter((p) => p.ativo).length;
  const hoje = new Date().toISOString().slice(0, 10);
  const lancamentosHoje = data.frequencias.filter((f) => f.data === hoje).length;

  return { alunosAtivos, turmasAtivas, projetosAtivos, lancamentosHoje };
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

function criarMensagemInterna({ remetente_id, titulo, corpo, tipo_destino, perfil_destino, usuario_ids }) {
  const data = loadDemo();
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
  saveDemo(data);
  return { id: mensagem.id, total_destinatarios: destinatarios.length };
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

module.exports = {
  padCodigo,
  formatCodigoNome,
  getTurmas,
  getAlunos,
  getAluno,
  cadastrarAluno,
  transferirAluno,
  desativarAluno,
  getProjetos,
  getProjeto,
  getAlunosProjeto,
  toggleAlunoProjeto,
  getFrequenciaTurma,
  salvarFrequencia,
  relatorioProjetoMes,
  getDashboardStats,
  autenticar,
  getUsuariosDestinatarios,
  criarMensagemInterna,
  getMensagensRecebidas,
  contarMensagensNaoLidas,
  marcarMensagemComoLida,
  marcarTodasMensagensComoLidas,
  marcarAvisoInicialComoLido,
};

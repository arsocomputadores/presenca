const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const upload = multer({ storage: multer.memoryStorage() });

const { isMysqlEnabled } = require('./lib/db');
const store = isMysqlEnabled() ? require('./lib/mysqlStore') : require('./lib/demoStore');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'presenca-dev-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: 3 * 60 * 1000 },
  })
);

app.use(async (req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  res.locals.modoDemo = !isMysqlEnabled();
  res.locals.anoLetivo = new Date().getFullYear();
  res.locals.mensagensNaoLidas = 0;
  
  // Helper global para formatar datas no EJS
  res.locals.formatarData = (data) => {
    if (!data) return '—';
    
    let d;
    if (typeof data === 'string' && data.includes('-')) {
      // Trata string YYYY-MM-DD garantindo que não mude o fuso horário
      const [year, month, day] = data.split('-');
      d = new Date(year, month - 1, day);
    } else {
      d = new Date(data);
    }

    if (isNaN(d.getTime())) {
      // Tenta corrigir datas que vêm do MySQL como string sem hora ou em outros formatos
      const d2 = new Date(data + 'T12:00:00');
      if (isNaN(d2.getTime())) return '—';
      return d2.toLocaleDateString('pt-BR');
    }
    return d.toLocaleDateString('pt-BR');
  };
  
  // Helper global para formatar turno no EJS
  res.locals.formatarTurno = (turno) => {
    if (!turno) return '—';
    const mapeamento = {
      'matutino': 'Matutino',
      'vespertino': 'Vespertino',
      'noturno': 'Noturno',
      'integral': 'Integral',
      'manha': 'Matutino',
      'tarde': 'Vespertino',
      'noite': 'Noturno'
    };
    return mapeamento[turno.toLowerCase()] || turno.charAt(0).toUpperCase() + turno.slice(1);
  };

  if (req.session.usuario && typeof store.contarMensagensNaoLidas === 'function') {
    try {
      res.locals.mensagensNaoLidas = await store.contarMensagensNaoLidas(req.session.usuario.id);
    } catch (_) {
      res.locals.mensagensNaoLidas = 0;
    }
  }

  next();
});

function requireAuth(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  next();
}

function requirePerfil(...perfis) {
  return (req, res, next) => {
    if (!req.session.usuario) return res.redirect('/login');
    if (perfis.length && !perfis.includes(req.session.usuario.perfil)) {
      return res.status(403).render('error', {
        titulo: 'Acesso negado',
        mensagem: 'Você não tem permissão para acessar esta página.',
      });
    }
    next();
  };
}

async function getRedirectPosLogin(usuario) {
  if (!usuario?.aviso_inicial_lido_em) return '/aviso-inicial';
  if (usuario.perfil === 'professor' && typeof store.contarMensagensNaoLidas === 'function') {
    const naoLidas = await store.contarMensagensNaoLidas(usuario.id);
    if (naoLidas > 0) {
      return `/mensagens?sucesso=${encodeURIComponent(`Você tem ${naoLidas} mensagem(ns) não lida(s).`)}`;
    }
  }
  return '/';
}

app.use((req, res, next) => {
  if (!req.session.usuario) return next();
  if (req.session.usuario.aviso_inicial_lido_em) return next();
  if (req.path === '/aviso-inicial' || req.path === '/logout') return next();
  return res.redirect('/aviso-inicial');
});

// --- Auth ---
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  res.render('login', { erro: null });
});

app.post('/login', async (req, res) => {
  let { cpf, senha } = req.body;
  // Remove pontos e traços do CPF para comparar com o banco
  const cpfLimpo = cpf.replace(/\D/g, '');
  
  const usuario = await store.autenticar(cpfLimpo, senha);
  if (!usuario) {
    return res.render('login', { erro: 'CPF ou senha inválidos.' });
  }
  req.session.usuario = {
    id: usuario.id,
    nome: usuario.nome,
    perfil: usuario.perfil,
    turmas: usuario.turmas || [],
    aviso_inicial_lido_em: usuario.aviso_inicial_lido_em || null,
  };
  res.redirect(await getRedirectPosLogin(req.session.usuario));
});

app.get('/aviso-inicial', requireAuth, (req, res) => {
  res.render('aviso-inicial', {
    titulo: 'Aviso Inicial',
  });
});

app.post('/aviso-inicial/confirmar', requireAuth, async (req, res) => {
  await store.marcarAvisoInicialComoLido(req.session.usuario.id);
  req.session.usuario.aviso_inicial_lido_em = new Date().toISOString();
  res.redirect(await getRedirectPosLogin(req.session.usuario));
});

// --- Usuários ---
app.get('/usuarios', requireAuth, requirePerfil('admin'), async (req, res) => {
  res.render('usuarios/index', {
    titulo: 'Usuários',
    usuarios: await store.getUsuarios(),
    sucesso: req.query.sucesso || null,
    erro: req.query.erro || null,
  });
});

app.get('/usuarios/novo', requireAuth, requirePerfil('admin'), async (req, res) => {
  res.render('usuarios/form', {
    titulo: 'Novo usuário',
    usuario_edit: null,
    turmas: await store.getTurmas(),
    erro: null,
  });
});

app.post('/usuarios', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const cpf = String(req.body.cpf || '').replace(/\D/g, '');
    const turmas_ids_raw = req.body.turmas_ids;
    let turmas_ids = [];
    if (Array.isArray(turmas_ids_raw)) turmas_ids = turmas_ids_raw;
    else if (typeof turmas_ids_raw === 'string' && turmas_ids_raw.trim()) turmas_ids = turmas_ids_raw.split(',');
    turmas_ids = [...new Set(turmas_ids.map(v => Number(String(v).trim())).filter(n => Number.isFinite(n) && n > 0))];

    await store.cadastrarUsuario({
      nome: String(req.body.nome || '').trim(),
      cpf,
      senha: req.body.senha,
      perfil: String(req.body.perfil || '').trim(),
      ativo: Number(req.body.ativo) ? 1 : 0,
      turmas_ids
    });
    res.redirect('/usuarios?sucesso=Usuário cadastrado com sucesso.');
  } catch (err) {
    const msg = err.code === 'ER_DUP_ENTRY' ? 'CPF já cadastrado.' : err.message;
    res.render('usuarios/form', {
      titulo: 'Novo usuário',
      usuario_edit: req.body,
      turmas: await store.getTurmas(),
      erro: msg,
    });
  }
});

app.get('/usuarios/:id/editar', requireAuth, requirePerfil('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.redirect('/usuarios?erro=Usuário inválido.');
  const usuario_edit = await store.getUsuario(id);
  if (!usuario_edit) return res.redirect('/usuarios?erro=Usuário não encontrado.');
  res.render('usuarios/form', {
    titulo: 'Editar usuário',
    usuario_edit,
    turmas: await store.getTurmas(),
    erro: null,
  });
});

app.post('/usuarios/:id', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.redirect('/usuarios?erro=Usuário inválido.');
    const cpf = String(req.body.cpf || '').replace(/\D/g, '');
    const turmas_ids_raw = req.body.turmas_ids;
    let turmas_ids = [];
    if (Array.isArray(turmas_ids_raw)) turmas_ids = turmas_ids_raw;
    else if (typeof turmas_ids_raw === 'string' && turmas_ids_raw.trim()) turmas_ids = turmas_ids_raw.split(',');
    turmas_ids = [...new Set(turmas_ids.map(v => Number(String(v).trim())).filter(n => Number.isFinite(n) && n > 0))];

    await store.atualizarUsuario(id, {
      nome: String(req.body.nome || '').trim(),
      cpf,
      senha: req.body.senha,
      perfil: String(req.body.perfil || '').trim(),
      ativo: Number(req.body.ativo) ? 1 : 0,
      turmas_ids
    });
    res.redirect('/usuarios?sucesso=Usuário atualizado com sucesso.');
  } catch (err) {
    const msg = err.code === 'ER_DUP_ENTRY' ? 'CPF já cadastrado.' : err.message;
    res.render('usuarios/form', {
      titulo: 'Editar usuário',
      usuario_edit: { ...req.body, id: req.params.id },
      turmas: await store.getTurmas(),
      erro: msg,
    });
  }
});

app.post('/usuarios/:id/excluir', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.redirect('/usuarios?erro=Usuário inválido.');
    if (req.session.usuario?.id === id) return res.redirect('/usuarios?erro=Você não pode excluir seu próprio usuário.');

    const usuarioAlvo = await store.getUsuario(id);
    if (!usuarioAlvo) return res.redirect('/usuarios?erro=Usuário não encontrado.');

    if (usuarioAlvo.perfil === 'admin' && usuarioAlvo.ativo) {
      const totalAdmins = await store.contarAdminsAtivos();
      if (totalAdmins <= 1) return res.redirect('/usuarios?erro=Não é possível excluir o último administrador ativo.');
    }

    await store.excluirUsuario(id);
    res.redirect('/usuarios?sucesso=Usuário excluído (inativado) com sucesso.');
  } catch (err) {
    res.redirect('/usuarios?erro=' + encodeURIComponent(err.message || 'Erro ao excluir usuário.'));
  }
});

app.get('/mensagens', requireAuth, async (req, res) => {
  const mensagens = await store.getMensagensRecebidas(req.session.usuario.id);
  res.render('mensagens/index', {
    titulo: 'Mensagens',
    mensagens,
    sucesso: req.query.sucesso || null,
    erro: req.query.erro || null,
  });
});

app.get('/mensagens/nova', requireAuth, requirePerfil('admin', 'coordenacao', 'direcao'), async (req, res) => {
  res.render('mensagens/form', {
    titulo: 'Nova mensagem',
    erro: null,
    sucesso: null,
    usuariosDestino: (await store.getUsuariosDestinatarios()).filter((u) => u.id !== req.session.usuario.id),
    mensagem_edit: {
      tipo_destino: 'todos',
      perfil_destino: '',
      usuario_ids: []
    }
  });
});

app.post('/mensagens', requireAuth, requirePerfil('admin', 'coordenacao', 'direcao'), async (req, res) => {
  try {
    const usuarioIdsRaw = req.body.usuario_ids;
    const usuario_ids = Array.isArray(usuarioIdsRaw)
      ? usuarioIdsRaw
      : (typeof usuarioIdsRaw === 'string' && usuarioIdsRaw.trim() ? [usuarioIdsRaw] : []);

    const resultado = await store.criarMensagemInterna({
      remetente_id: req.session.usuario.id,
      titulo: String(req.body.titulo || '').trim(),
      corpo: String(req.body.corpo || '').trim(),
      tipo_destino: String(req.body.tipo_destino || '').trim(),
      perfil_destino: String(req.body.perfil_destino || '').trim(),
      usuario_ids,
    });

    res.redirect(`/mensagens?sucesso=${encodeURIComponent(`Mensagem enviada com sucesso para ${resultado.total_destinatarios} usuário(s).`)}`);
  } catch (err) {
    res.render('mensagens/form', {
      titulo: 'Nova mensagem',
      erro: err.message,
      sucesso: null,
      usuariosDestino: (await store.getUsuariosDestinatarios()).filter((u) => u.id !== req.session.usuario.id),
      mensagem_edit: {
        titulo: req.body.titulo,
        corpo: req.body.corpo,
        tipo_destino: req.body.tipo_destino,
        perfil_destino: req.body.perfil_destino,
        usuario_ids: req.body.usuario_ids || [],
      }
    });
  }
});

app.post('/mensagens/:id/lida', requireAuth, async (req, res) => {
  try {
    await store.marcarMensagemComoLida(req.params.id, req.session.usuario.id);
    res.redirect('/mensagens?sucesso=Mensagem marcada como lida.');
  } catch (err) {
    res.redirect(`/mensagens?erro=${encodeURIComponent(err.message || 'Erro ao marcar mensagem como lida.')}`);
  }
});

app.post('/mensagens/lidas', requireAuth, async (req, res) => {
  try {
    const total = await store.marcarTodasMensagensComoLidas(req.session.usuario.id);
    res.redirect(`/mensagens?sucesso=${encodeURIComponent(`${total} mensagem(ns) marcada(s) como lida(s).`)}`);
  } catch (err) {
    res.redirect(`/mensagens?erro=${encodeURIComponent(err.message || 'Erro ao marcar mensagens como lidas.')}`);
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Dashboard ---
app.get('/', requireAuth, async (req, res) => {
  const stats = await store.getDashboardStats(req.session.usuario.id, req.session.usuario.perfil);
  const turmas = await store.getTurmas(req.session.usuario.perfil === 'professor' ? req.session.usuario.id : null);
  res.render('dashboard', { stats, turmas, titulo: 'Painel' });
});

app.get('/relatorios/frequencia', requireAuth, requirePerfil('admin', 'coordenacao', 'direcao'), async (req, res) => {
  const turmas = await store.getTurmas();
  const { turma_id, mes, ano } = req.query;
  
  const m = mes ? Number(mes) : new Date().getMonth() + 1;
  const a = ano ? Number(ano) : new Date().getFullYear();
  const tId = turma_id ? Number(turma_id) : (turmas[0]?.id || null);

  let dados = [];
  let turmaSelecionada = null;
  if (tId) {
    dados = await store.getRelatorioFrequenciaTurma(tId, m, a);
    turmaSelecionada = turmas.find(t => t.id === tId);
  }

  res.render('relatorios/frequencia', {
    titulo: 'Relatório de Frequência por Turma',
    turmas,
    turmaId: tId,
    mes: m,
    ano: a,
    dados,
    turmaSelecionada
  });
});

app.get('/relatorios/frequencia/exportar', requireAuth, requirePerfil('admin', 'coordenacao', 'direcao'), async (req, res) => {
  const { turma_id, mes, ano } = req.query;
  const m = Number(mes);
  const a = Number(ano);
  const tId = Number(turma_id);

  const [dados, turma] = await Promise.all([
    store.getRelatorioFrequenciaTurma(tId, m, a),
    store.getTurma(tId)
  ]);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Frequência Mensal');

  worksheet.columns = [
    { header: 'Código', key: 'codigo', width: 15 },
    { header: 'Aluno', key: 'aluno_nome', width: 35 },
    { header: 'Presenças', key: 'presencas', width: 12 },
    { header: 'Faltas', key: 'faltas', width: 12 },
    { header: 'Justificadas', key: 'justificadas', width: 12 },
    { header: '% Frequência', key: 'porcentagem', width: 15 },
  ];

  dados.forEach(d => {
    const total = d.presencas + d.faltas + d.justificadas;
    const pct = total > 0 ? Math.round((d.presencas / total) * 100) : 100;
    worksheet.addRow({
      codigo: d.codigo,
      aluno_nome: d.aluno_nome,
      presencas: d.presencas,
      faltas: d.faltas,
      justificadas: d.justificadas,
      porcentagem: pct + '%'
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=frequencia_${turma.nome}_${m}_${a}.xlsx`);

  await workbook.xlsx.write(res);
  res.end();
});

// --- Alunos ---
app.get('/alunos/importar', requireAuth, requirePerfil('admin'), async (req, res) => {
  res.render('alunos/importar', {
    titulo: 'Importar alunos (PDF)',
    turmas: await store.getTurmas(),
    erro: null,
    alunosParsed: null
  });
});

app.post('/alunos/importar/preview', requireAuth, requirePerfil('admin'), upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Nenhum arquivo enviado.');
    
    const data = await pdfParse(req.file.buffer);
    const text = data.text;

    const dateRegex = /(\d{2})\/(\d{2})\/(\d{4})/;
    const lineRegex = /^\s*(\d{1,8})\s*[-–—\/]\s*(.+)$/;
    const alunos = [];

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(lineRegex);
      if (!match) continue;

      let nome = match[2].trim().replace(/\s+/g, ' ');
      let dataNasc = null;

      const dateMatch = nome.match(dateRegex);
      if (dateMatch) {
        dataNasc = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
        nome = nome.replace(dateMatch[0], '').trim().replace(/\s+$/, ' ');
      }

      if (nome.length > 3) {
        alunos.push({
          codigo: match[1].replace(/^0+(?=\d)/, ''),
          nome,
          data_nascimento: dataNasc
        });
      }
    }

    if (alunos.length === 0) {
      // Tenta um segundo passe mais flexível em todo o texto
      const fallbackRegex = /(\d{1,8})\s*[-–—\/]\s*([^\n\r]+)/g;
      let fallbackMatch;

      while ((fallbackMatch = fallbackRegex.exec(text)) !== null) {
        let nome = fallbackMatch[2].trim().replace(/\s+/g, ' ');
        let dataNasc = null;

        const dateMatch = nome.match(dateRegex);
        if (dateMatch) {
          dataNasc = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
          nome = nome.replace(dateMatch[0], '').trim();
        }

        if (nome.length > 3) {
          alunos.push({
            codigo: fallbackMatch[1].replace(/^0+(?=\d)/, ''),
            nome,
            data_nascimento: dataNasc
          });
        }
      }
    }

    if (alunos.length === 0) {
      throw new Error('Não foi possível encontrar alunos no formato "Código - Nome" ou "Código / Nome" neste PDF.');
    }

    res.render('alunos/importar', {
      titulo: 'Confirmar Importação',
      turmas: await store.getTurmas(),
      erro: null,
      alunosParsed: alunos,
      turma_id: req.body.turma_id
    });
  } catch (err) {
    res.render('alunos/importar', {
      titulo: 'Importar alunos (PDF)',
      turmas: await store.getTurmas(),
      erro: err.message,
      alunosParsed: null
    });
  }
});

app.post('/alunos/importar/confirmar', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const { turma_id, codigos, nomes, datas_nascimento } = req.body;
    const ids = Array.isArray(codigos) ? codigos : [codigos];
    const names = Array.isArray(nomes) ? nomes : [nomes];
    const dates = Array.isArray(datas_nascimento) ? datas_nascimento : [datas_nascimento];
    
    for (let i = 0; i < ids.length; i++) {
      try {
        await store.cadastrarAluno({
          codigo: ids[i],
          nome: names[i],
          data_nascimento: dates[i] || null,
          turma_id: turma_id,
          data_matricula: new Date().toISOString().slice(0, 10)
        });
      } catch (e) {
        console.error(`Erro ao importar aluno ${ids[i]}: ${e.message}`);
      }
    }
    
    res.redirect('/alunos?sucesso=Importação concluída com sucesso.');
  } catch (err) {
    res.redirect(`/alunos?erro=${encodeURIComponent(err.message)}`);
  }
});

// --- Alunos ---
app.get('/alunos', requireAuth, requirePerfil('admin', 'coordenacao', 'direcao'), async (req, res) => {
  const { busca, turma_id, status } = req.query;
  const usuario = req.session.usuario;
  
  let alunos = await store.getAlunos();

  // Se for professor, filtrar apenas alunos das suas turmas
  if (usuario.perfil === 'professor') {
    const turmasProf = await store.getTurmas(usuario.id);
    const idsTurmas = turmasProf.map(t => t.id);
    alunos = alunos.filter(a => idsTurmas.includes(a.turma_id));
  }

  if (status === 'inativo') alunos = alunos.filter((a) => !a.ativo);
  else if (status !== 'todos') alunos = alunos.filter((a) => a.ativo);

  if (turma_id) alunos = alunos.filter((a) => a.turma_id === Number(turma_id));
  if (busca) {
    const q = busca.toLowerCase();
    alunos = alunos.filter(
      (a) =>
        a.codigo.includes(q) ||
        a.nome.toLowerCase().includes(q) ||
        (a.codigo_nome && a.codigo_nome.toLowerCase().includes(q))
    );
  }

  res.render('alunos/index', {
    titulo: 'Alunos',
    alunos,
    turmas: await store.getTurmas(usuario.perfil === 'professor' ? usuario.id : null),
    filtros: { busca, turma_id, status: status || 'ativo' },
    sucesso: req.query.sucesso,
    erro: req.query.erro,
  });
});

app.get('/alunos/novo', requireAuth, requirePerfil('admin'), async (req, res) => {
  res.render('alunos/form', {
    titulo: 'Novo aluno',
    aluno: null,
    turmas: await store.getTurmas(),
    erro: null,
  });
});

app.post('/alunos', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const codigo = String(req.body.codigo || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!/^[0-9]{1,8}$/.test(codigo)) throw new Error('Código deve conter apenas números (máx. 8 dígitos).');

    await store.cadastrarAluno({
      codigo,
      nome: String(req.body.nome || '').trim(),
      data_nascimento: req.body.data_nascimento || null,
      turma_id: req.body.turma_id,
      data_matricula: req.body.data_matricula || new Date().toISOString().slice(0, 10),
    });
    res.redirect('/alunos?sucesso=Aluno cadastrado com sucesso.');
  } catch (err) {
    const msg = err.code === 'ER_DUP_ENTRY' ? 'Código já cadastrado.' : err.message;
    res.render('alunos/form', {
      titulo: 'Novo aluno',
      aluno: req.body,
      turmas: await store.getTurmas(),
      erro: msg,
    });
  }
});

app.get('/alunos/:id/editar', requireAuth, requirePerfil('admin'), async (req, res) => {
  const aluno = await store.getAluno(req.params.id);
  if (!aluno) return res.redirect('/alunos?erro=Aluno não encontrado.');
  res.render('alunos/form', {
    titulo: 'Editar aluno',
    aluno,
    turmas: await store.getTurmas(),
    erro: null,
  });
});

app.post('/alunos/:id', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const codigoDigitado = String(req.body.codigo || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!/^[0-9]{1,8}$/.test(codigoDigitado)) throw new Error('Código deve conter apenas números (máx. 8 dígitos).');

    const codigoOriginal = String(req.body.codigo_original || '').replace(/\D/g, '');
    const codigoOriginalSemZeros = codigoOriginal.replace(/^0+(?=\d)/, '');
    const codigoParaSalvar = codigoOriginal && codigoDigitado === codigoOriginalSemZeros ? codigoOriginal : codigoDigitado;

    await store.atualizarAluno(req.params.id, {
      codigo: codigoParaSalvar,
      nome: String(req.body.nome || '').trim(),
      data_nascimento: req.body.data_nascimento || null,
      turma_id: req.body.turma_id,
    });
    res.redirect('/alunos?sucesso=Aluno atualizado com sucesso.');
  } catch (err) {
    const msg = err.code === 'ER_DUP_ENTRY' ? 'Código já cadastrado.' : err.message;
    res.render('alunos/form', {
      titulo: 'Editar aluno',
      aluno: { ...req.body, id: req.params.id },
      turmas: await store.getTurmas(),
      erro: msg,
    });
  }
});

app.get('/alunos/:id/transferir', requireAuth, requirePerfil('admin'), async (req, res) => {
  const aluno = await store.getAluno(req.params.id);
  if (!aluno) return res.redirect('/alunos?erro=Aluno não encontrado.');
  res.render('alunos/transferir', {
    titulo: 'Transferir aluno',
    aluno,
    turmas: (await store.getTurmas()).filter((t) => t.id !== aluno.turma_id),
    erro: null,
  });
});

app.post('/alunos/:id/transferir', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    await store.transferirAluno(req.params.id, req.body.turma_id);
    res.redirect('/alunos?sucesso=Transferência realizada.');
  } catch (err) {
    const aluno = await store.getAluno(req.params.id);
    res.render('alunos/transferir', {
      titulo: 'Transferir aluno',
      aluno,
      turmas: (await store.getTurmas()).filter((t) => t.id !== aluno?.turma_id),
      erro: err.message,
    });
  }
});

app.post('/alunos/:id/desativar', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    await store.desativarAluno(req.params.id);
    res.redirect('/alunos?sucesso=Aluno desativado (saída registrada).');
  } catch (err) {
    res.redirect(`/alunos?erro=${encodeURIComponent(err.message)}`);
  }
});

app.post('/alunos/:id/reativar', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    await store.reativarAluno(req.params.id);
    res.redirect('/alunos?status=todos&sucesso=Aluno reativado com sucesso.');
  } catch (err) {
    res.redirect(`/alunos?erro=${encodeURIComponent(err.message)}`);
  }
});

// --- Turmas ---
app.get('/turmas', requireAuth, requirePerfil('admin', 'coordenacao'), async (req, res) => {
  const turmas = await store.getTurmas(req.session.usuario.perfil === 'professor' ? req.session.usuario.id : null);
  res.render('turmas/index', {
    titulo: 'Turmas',
    turmas: turmas,
  });
});

app.get('/turmas/nova', requireAuth, requirePerfil('admin'), async (req, res) => {
  res.render('turmas/form', {
    titulo: 'Nova turma',
    turma: null,
    erro: null,
  });
});

// Alias para consistência com /alunos/novo
app.get('/turmas/novo', (req, res) => res.redirect('/turmas/nova'));

app.post('/turmas', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    await store.cadastrarTurma(req.body);
    res.redirect('/turmas?sucesso=Turma cadastrada com sucesso.');
  } catch (err) {
    res.render('turmas/form', {
      titulo: 'Nova turma',
      turma: req.body,
      erro: err.message,
    });
  }
});

app.post('/turmas/:id/definitiva', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    await store.setTurmaDefinitiva(req.params.id, status === '1');
    const msg = status === '1' ? 'Turma marcada como definitiva.' : 'Status definitivo removido.';
    res.redirect(`/turmas?sucesso=${encodeURIComponent(msg)}`);
  } catch (err) {
    res.redirect(`/turmas?erro=${encodeURIComponent(err.message)}`);
  }
});

app.get('/turmas/:id/editar', requireAuth, requirePerfil('admin'), async (req, res) => {
  const turma = await store.getTurma(req.params.id);
  if (!turma) return res.redirect('/turmas?erro=Turma não encontrada.');
  res.render('turmas/form', {
    titulo: 'Editar turma',
    turma,
    erro: null,
  });
});

app.post('/turmas/:id', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    await store.atualizarTurma(req.params.id, req.body);
    res.redirect('/turmas?sucesso=Turma atualizada com sucesso.');
  } catch (err) {
    res.render('turmas/form', {
      titulo: 'Editar turma',
      turma: { ...req.body, id: req.params.id },
      erro: err.message,
    });
  }
});

// --- Frequência ---
app.get('/frequencia', requireAuth, requirePerfil('admin', 'professor'), async (req, res) => {
  const turmas = await store.getTurmas(req.session.usuario.perfil === 'professor' ? req.session.usuario.id : null);
  
  let turmaId = req.query.turma_id ? Number(req.query.turma_id) : turmas[0]?.id;
  let horario = req.query.horario ? Number(req.query.horario) : 1; // 1º ou 6º horário
  
  // Segurança: verificar se o professor tem acesso a essa turma
  if (req.session.usuario.perfil === 'professor') {
    const temAcesso = turmas.some(t => t.id === turmaId);
    if (!temAcesso && turmas.length > 0) {
      turmaId = turmas[0].id;
    } else if (turmas.length === 0) {
      return res.render('error', { titulo: 'Acesso negado', mensagem: 'Você não possui turmas vinculadas.' });
    }
  }

  const data = req.query.data || new Date().toISOString().slice(0, 10);
  const alunos = turmaId ? await store.getFrequenciaTurma(turmaId, data, horario) : [];

  res.render('frequencia/index', {
    titulo: 'Lançar frequência',
    turmas,
    turmaId,
    data,
    horario,
    alunos,
    sucesso: req.query.sucesso,
  });
});

app.post('/frequencia', requireAuth, requirePerfil('admin', 'professor'), async (req, res) => {
  const { turma_id, data, horario, registros } = req.body;
  const tId = Number(turma_id);
  const hId = Number(horario);

  // Segurança: verificar se o professor tem acesso a essa turma antes de salvar
  if (req.session.usuario.perfil === 'professor') {
    const turmas = await store.getTurmas(req.session.usuario.id);
    const temAcesso = turmas.some(t => t.id === tId);
    if (!temAcesso) {
      return res.status(403).render('error', { titulo: 'Acesso negado', mensagem: 'Você não tem permissão para lançar frequência nesta turma.' });
    }
  }

  let parsed = [];
  // ... resto da lógica de parsing ...
  if (typeof registros === 'string') {
    try {
      parsed = JSON.parse(registros);
    } catch {
      parsed = [];
    }
  } else if (Array.isArray(registros)) {
    parsed = registros;
  } else if (req.body.aluno_id) {
    const ids = Array.isArray(req.body.aluno_id) ? req.body.aluno_id : [req.body.aluno_id];
    parsed = ids.map((id) => ({
      aluno_id: id,
      status: req.body[`status_${id}`],
      observacao: req.body[`obs_${id}`] || '',
    }));
  }

  await store.salvarFrequencia(tId, data, parsed, req.session.usuario.id, hId);
  res.redirect(`/frequencia?turma_id=${tId}&data=${data}&horario=${hId}&sucesso=Frequência salva.`);
});

// --- Projetos ---
app.get('/projetos', requireAuth, requirePerfil('admin', 'coordenacao'), async (req, res) => {
  res.render('projetos/index', {
    titulo: 'Projetos',
    projetos: await store.getProjetos(),
  });
});

app.get('/projetos/novo', requireAuth, requirePerfil('admin'), async (req, res) => {
  res.render('projetos/form', {
    titulo: 'Novo projeto',
    projeto: null,
    erro: null,
  });
});

app.post('/projetos', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    await store.cadastrarProjeto(req.body);
    res.redirect('/projetos?sucesso=Projeto cadastrado com sucesso.');
  } catch (err) {
    res.render('projetos/form', {
      titulo: 'Novo projeto',
      projeto: req.body,
      erro: err.message,
    });
  }
});

app.get('/projetos/:id/editar', requireAuth, requirePerfil('admin'), async (req, res) => {
  const projeto = await store.getProjeto(req.params.id);
  if (!projeto) return res.redirect('/projetos?erro=Projeto não encontrado.');
  res.render('projetos/form', {
    titulo: 'Editar projeto',
    projeto,
    erro: null,
  });
});

app.post('/projetos/:id', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    await store.atualizarProjeto(req.params.id, req.body);
    res.redirect('/projetos?sucesso=Projeto atualizado com sucesso.');
  } catch (err) {
    res.render('projetos/form', {
      titulo: 'Editar projeto',
      projeto: { ...req.body, id: req.params.id },
      erro: err.message,
    });
  }
});

app.get('/projetos/:id/alunos', requireAuth, requirePerfil('admin'), async (req, res) => {
  const projeto = await store.getProjeto(req.params.id);
  if (!projeto) return res.redirect('/projetos');

  const alunosProjeto = await store.getAlunosProjeto(projeto.id);
  const idsSelecionados = alunosProjeto.map((a) => a.id);
  
  // Buscar todos os alunos ativos para a lista de adição
  const todosAlunos = await store.getAlunos({ ativo: 1 });
  const alunosDisponiveis = todosAlunos.filter(a => !idsSelecionados.includes(a.id));

  res.render('projetos/alunos', {
    titulo: `Projeto: ${projeto.nome}`,
    projeto,
    alunosProjeto,
    alunosDisponiveis,
    sucesso: req.query.sucesso,
    erro: req.query.erro
  });
});

app.post('/projetos/:id/alunos/adicionar', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const { aluno_id } = req.body;
    await store.adicionarAlunoProjeto(req.params.id, aluno_id);
    res.redirect(`/projetos/${req.params.id}/alunos?sucesso=Aluno inserido no projeto.`);
  } catch (err) {
    res.redirect(`/projetos/${req.params.id}/alunos?erro=${encodeURIComponent(err.message)}`);
  }
});

app.post('/projetos/:id/alunos/remover', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const { aluno_id } = req.body;
    await store.removerAlunoProjeto(req.params.id, aluno_id);
    res.redirect(`/projetos/${req.params.id}/alunos?sucesso=Aluno removido do projeto.`);
  } catch (err) {
    res.redirect(`/projetos/${req.params.id}/alunos?erro=${encodeURIComponent(err.message)}`);
  }
});

app.post('/projetos/:id/excluir', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    await store.excluirProjeto(req.params.id);
    res.redirect('/projetos?sucesso=Projeto excluído com sucesso.');
  } catch (err) {
    res.redirect(`/projetos?erro=${encodeURIComponent(err.message)}`);
  }
});

const ExcelJS = require('exceljs');

// --- Relatórios ---
app.get('/relatorios', requireAuth, requirePerfil('admin', 'coordenacao', 'direcao'), async (req, res) => {
  const data = req.query.data || new Date().toISOString().slice(0, 10);
  const lancamentos = await store.relatorioLancamentosDia(data);
  res.render('relatorios/index', {
    titulo: 'Relatórios de Lançamentos',
    data,
    lancamentos,
    sucesso: req.query.sucesso || null,
    erro: req.query.erro || null,
  });
});

app.post('/frequencias/limpar', requireAuth, requirePerfil('admin'), async (req, res) => {
  try {
    const removidos = await store.limparFrequencias();
    res.redirect(`/relatorios?sucesso=${encodeURIComponent(`Histórico de frequência limpo. Registros removidos: ${removidos}.`)}`);
  } catch (err) {
    res.redirect(`/relatorios?erro=${encodeURIComponent(err.message || 'Erro ao limpar histórico de frequência.')}`);
  }
});

app.get('/relatorios/exportar/excel', requireAuth, requirePerfil('admin', 'coordenacao', 'direcao'), async (req, res) => {
  const data = req.query.data || new Date().toISOString().slice(0, 10);
  const lancamentos = await store.relatorioLancamentosDia(data);
  
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Lançamentos');

  worksheet.columns = [
    { header: 'Turma', key: 'turma_nome', width: 20 },
    { header: 'Turno', key: 'turno', width: 15 },
    { header: 'Horário', key: 'horario', width: 10 },
    { header: 'Responsável', key: 'usuario_nome', width: 25 },
    { header: 'Data/Hora Lançamento', key: 'lancado_em', width: 25 },
  ];

  lancamentos.forEach(l => {
    worksheet.addRow({
      turma_nome: l.turma_nome,
      turno: res.locals.formatarTurno(l.turno),
      horario: l.horario + 'º',
      usuario_nome: l.lancado_por,
      lancado_em: res.locals.formatarData(l.data_lancamento) + ' ' + new Date(l.data_lancamento).toLocaleTimeString('pt-BR')
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=relatorio_frequencia_${data}.xlsx`);

  await workbook.xlsx.write(res);
  res.end();
});


app.get('/alunos/:id/historico', requireAuth, requirePerfil('admin', 'coordenacao', 'direcao'), async (req, res) => {
  const aluno = await store.getAluno(req.params.id);
  if (!aluno) return res.redirect('/alunos');
  
  const ano = req.query.ano ? Number(req.query.ano) : new Date().getFullYear();
  const mes = req.query.mes ? Number(req.query.mes) : new Date().getMonth() + 1;
  
  const [historico, resumo] = await Promise.all([
    store.getHistoricoIndividual(aluno.id, ano, mes),
    store.getResumoEstatisticasAluno(aluno.id, ano)
  ]);

  res.render('alunos/historico', {
    titulo: `Histórico: ${aluno.nome}`,
    aluno,
    historico,
    resumo,
    filtros: { ano, mes }
  });
});

// --- Calendário Escolar ---
app.get('/calendario', requireAuth, requirePerfil('admin', 'coordenacao', 'direcao'), async (req, res) => {
  const feriados = await store.getFeriados();
  res.render('calendario/index', {
    titulo: 'Calendário Escolar',
    feriados,
    sucesso: req.query.sucesso,
    erro: req.query.erro
  });
});

app.post('/calendario', requireAuth, requirePerfil('admin', 'coordenacao'), async (req, res) => {
  try {
    await store.cadastrarFeriado(req.body);
    res.redirect('/calendario?sucesso=Feriado cadastrado com sucesso.');
  } catch (err) {
    res.redirect(`/calendario?erro=${encodeURIComponent(err.message)}`);
  }
});

app.post('/calendario/:id/excluir', requireAuth, requirePerfil('admin', 'coordenacao'), async (req, res) => {
  try {
    await store.excluirFeriado(req.params.id);
    res.redirect('/calendario?sucesso=Feriado excluído.');
  } catch (err) {
    res.redirect(`/calendario?erro=${encodeURIComponent(err.message)}`);
  }
});

// --- Banco de dados (referência) ---
app.get('/banco', requireAuth, requirePerfil('admin', 'coordenacao'), (req, res) => {
  res.render('banco/index', { titulo: 'Estrutura do banco' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`\n  Presença Escolar rodando em http://localhost:${PORT}`);
    console.log(`  Modo: ${isMysqlEnabled() ? 'MySQL' : 'Demonstração (dados locais)'}`);
    console.log(`  Login demo: 00000000001 / demo123\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Erro: a porta ${PORT} já está em uso.`);
      console.error('  Feche a outra instância do servidor (Ctrl+C no terminal anterior)');
      console.error('  ou defina outra porta: set PORT=3001 && npm start\n');
      process.exit(1);
    }
    throw err;
  });
}

module.exports = app;

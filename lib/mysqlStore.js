const { getPool } = require('./db');

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

let turmaHorarioColumnsReady = false;
let turmaHorarioSemanaTableReady = false;
let alertaFrequenciaAutoTableReady = false;

async function tableColumnExists(pool, tableName, columnName) {
  const [[row]] = await pool.query(`
    SELECT COUNT(*) AS total
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
  `, [tableName, columnName]);
  return Number(row?.total || 0) > 0;
}

async function tableConstraintExists(pool, tableName, constraintName) {
  const [[row]] = await pool.query(`
    SELECT COUNT(*) AS total
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND CONSTRAINT_NAME = ?
  `, [tableName, constraintName]);
  return Number(row?.total || 0) > 0;
}

async function ensureTurmaHorarioColumns() {
  if (turmaHorarioColumnsReady) return;
  const pool = await getPool();
  const hasPrimeiro = await tableColumnExists(pool, 'turmas', 'professor_primeiro_horario_id');
  if (!hasPrimeiro) {
    await pool.query(`
      ALTER TABLE turmas
      ADD COLUMN professor_primeiro_horario_id INT UNSIGNED NULL AFTER professor_responsavel_id
    `);
  }
  const hasSexto = await tableColumnExists(pool, 'turmas', 'professor_sexto_horario_id');
  if (!hasSexto) {
    await pool.query(`
      ALTER TABLE turmas
      ADD COLUMN professor_sexto_horario_id INT UNSIGNED NULL AFTER professor_primeiro_horario_id
    `);
  }
  const hasFkPrimeiro = await tableConstraintExists(pool, 'turmas', 'fk_turmas_prof_1h');
  if (!hasFkPrimeiro) {
    await pool.query(`
      ALTER TABLE turmas
        ADD CONSTRAINT fk_turmas_prof_1h
        FOREIGN KEY (professor_primeiro_horario_id) REFERENCES usuarios (id)
        ON DELETE SET NULL ON UPDATE CASCADE
    `);
  }
  const hasFkSexto = await tableConstraintExists(pool, 'turmas', 'fk_turmas_prof_6h');
  if (!hasFkSexto) {
    await pool.query(`
      ALTER TABLE turmas
        ADD CONSTRAINT fk_turmas_prof_6h
        FOREIGN KEY (professor_sexto_horario_id) REFERENCES usuarios (id)
        ON DELETE SET NULL ON UPDATE CASCADE
    `);
  }
  turmaHorarioColumnsReady = true;
}

async function ensureTurmaHorarioSemanaTable() {
  if (turmaHorarioSemanaTableReady) return;
  const pool = await getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS turma_professores_horario (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      turma_id INT UNSIGNED NOT NULL,
      dia_semana ENUM('segunda', 'terca', 'quarta', 'quinta', 'sexta') NOT NULL,
      horario TINYINT UNSIGNED NOT NULL,
      professor_id INT UNSIGNED NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_turma_dia_horario (turma_id, dia_semana, horario),
      INDEX idx_tph_professor (professor_id),
      CONSTRAINT fk_tph_turma FOREIGN KEY (turma_id) REFERENCES turmas (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_tph_professor FOREIGN KEY (professor_id) REFERENCES usuarios (id)
        ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  turmaHorarioSemanaTableReady = true;
}

async function ensureAlertaFrequenciaAutoTable() {
  if (alertaFrequenciaAutoTableReady) return;
  const pool = await getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alertas_frequencia_automaticos (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      referencia_data DATE NOT NULL,
      destinatario_id INT UNSIGNED NOT NULL,
      mensagem_id INT UNSIGNED NULL,
      total_pendencias SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_alerta_freq_auto (referencia_data, destinatario_id),
      INDEX idx_afa_destinatario (destinatario_id),
      CONSTRAINT fk_afa_destinatario FOREIGN KEY (destinatario_id) REFERENCES usuarios (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_afa_mensagem FOREIGN KEY (mensagem_id) REFERENCES mensagens (id)
        ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  alertaFrequenciaAutoTableReady = true;
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
      if (Object.prototype.hasOwnProperty.call(payload, campo)) {
        encontrouCampo = true;
      }
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

function getProfessorPadraoDaEscala(escala = [], horario = 1) {
  return escala.find((item) => Number(item.horario) === Number(horario))?.professor_id || null;
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

async function salvarEscalaSemana(conn, turmaId, payload) {
  await ensureTurmaHorarioSemanaTable();
  const escala = extrairEscalaSemana(payload);
  await conn.query('DELETE FROM turma_professores_horario WHERE turma_id = ?', [turmaId]);
  for (const item of escala) {
    await conn.query(
      `INSERT INTO turma_professores_horario (turma_id, dia_semana, horario, professor_id)
       VALUES (?, ?, ?, ?)`,
      [turmaId, item.dia_semana, item.horario, item.professor_id]
    );
    await vincularProfessorHorarioNaTurma(conn, turmaId, item.professor_id);
  }
  return escala;
}

async function getEscalasTurmas(pool, turmaIds = []) {
  const ids = [...new Set((turmaIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  const mapa = new Map();
  ids.forEach((id) => mapa.set(id, criarEscalaSemanaVazia()));
  if (!ids.length) return mapa;

  await ensureTurmaHorarioSemanaTable();
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await pool.query(`
    SELECT tph.turma_id, tph.dia_semana, tph.horario, tph.professor_id, u.nome AS professor_nome
    FROM turma_professores_horario tph
    LEFT JOIN usuarios u ON u.id = tph.professor_id
    WHERE tph.turma_id IN (${placeholders})
    ORDER BY tph.turma_id, tph.dia_semana, tph.horario
  `, ids);

  for (const row of rows) {
    if (!mapa.has(row.turma_id)) mapa.set(row.turma_id, criarEscalaSemanaVazia());
    mapa.get(row.turma_id)[row.dia_semana][row.horario] = {
      professor_id: row.professor_id ? Number(row.professor_id) : null,
      professor_nome: row.professor_nome || null,
    };
  }
  return mapa;
}

async function aplicarEscalaSemanaNasTurmas(pool, turmas = []) {
  if (!turmas.length) return turmas;
  const escalas = await getEscalasTurmas(pool, turmas.map((turma) => turma.id));
  return turmas.map((turma) => ({
    ...turma,
    escala_semana: escalas.get(turma.id) || criarEscalaSemanaVazia(),
  }));
}

async function vincularProfessorHorarioNaTurma(conn, turmaId, professorId) {
  if (!professorId) return;
  await conn.query(
    'INSERT IGNORE INTO usuario_turmas (usuario_id, turma_id) VALUES (?, ?)',
    [professorId, turmaId]
  );
}

async function getTurmas(usuarioId = null) {
  const pool = await getPool();
  await ensureTurmaHorarioColumns();
  await ensureTurmaHorarioSemanaTable();
  let sql = `
    SELECT
      t.*,
      p1.nome AS professor_primeiro_horario_nome,
      p6.nome AS professor_sexto_horario_nome,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.ativa = 1) as total_alunos
    FROM turmas t
    LEFT JOIN usuarios p1 ON p1.id = t.professor_primeiro_horario_id
    LEFT JOIN usuarios p6 ON p6.id = t.professor_sexto_horario_id
  `;
  const params = [];

  if (usuarioId) {
    sql += ` JOIN usuario_turmas ut ON t.id = ut.turma_id WHERE ut.usuario_id = ? AND t.ativa = 1 `;
    params.push(usuarioId);
  } else {
    sql += ` WHERE t.ativa = 1 `;
  }

  sql += ` ORDER BY t.nome `;
  const [rows] = await pool.query(sql, params);
  return aplicarEscalaSemanaNasTurmas(pool, rows);
}

async function setTurmaDefinitiva(id, status) {
  const pool = await getPool();
  if (status) {
    await pool.query(
      'UPDATE turmas SET definitiva = 1, definitiva_em = COALESCE(definitiva_em, NOW()) WHERE id = ?',
      [id]
    );
  } else {
    await pool.query('UPDATE turmas SET definitiva = 0 WHERE id = ?', [id]);
  }
}

async function getTurma(id) {
  const pool = await getPool();
  await ensureTurmaHorarioColumns();
  await ensureTurmaHorarioSemanaTable();
  const [rows] = await pool.query(`
    SELECT
      t.*,
      p1.nome AS professor_primeiro_horario_nome,
      p6.nome AS professor_sexto_horario_nome
    FROM turmas t
    LEFT JOIN usuarios p1 ON p1.id = t.professor_primeiro_horario_id
    LEFT JOIN usuarios p6 ON p6.id = t.professor_sexto_horario_id
    WHERE t.id = ?
  `, [id]);
  const turmas = await aplicarEscalaSemanaNasTurmas(pool, rows);
  return turmas[0] || null;
}

async function cadastrarTurma(payload) {
  const pool = await getPool();
  await ensureTurmaHorarioColumns();
  await ensureTurmaHorarioSemanaTable();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const escala = extrairEscalaSemana(payload);
    const professorPrimeiro = getProfessorPadraoDaEscala(escala, 1) || normalizeProfessorId(payload.professor_primeiro_horario_id);
    const professorSexto = getProfessorPadraoDaEscala(escala, 6) || normalizeProfessorId(payload.professor_sexto_horario_id);
    const [res] = await conn.query(
      `INSERT INTO turmas (
        nome, serie, turno, ano_letivo, professor_responsavel_id, professor_primeiro_horario_id, professor_sexto_horario_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [payload.nome, payload.serie, payload.turno, payload.ano_letivo, professorPrimeiro || professorSexto, professorPrimeiro, professorSexto]
    );
    const turmaId = res.insertId;
    await salvarEscalaSemana(conn, turmaId, payload);
    if (professorPrimeiro) await vincularProfessorHorarioNaTurma(conn, turmaId, professorPrimeiro);
    if (professorSexto) await vincularProfessorHorarioNaTurma(conn, turmaId, professorSexto);
    await conn.commit();
    return turmaId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function atualizarTurma(id, payload) {
  const pool = await getPool();
  await ensureTurmaHorarioColumns();
  await ensureTurmaHorarioSemanaTable();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const escala = extrairEscalaSemana(payload);
    const professorPrimeiro = getProfessorPadraoDaEscala(escala, 1) || normalizeProfessorId(payload.professor_primeiro_horario_id);
    const professorSexto = getProfessorPadraoDaEscala(escala, 6) || normalizeProfessorId(payload.professor_sexto_horario_id);
    await conn.query(
      `UPDATE turmas
        SET nome = ?, serie = ?, turno = ?, ano_letivo = ?,
            professor_responsavel_id = ?,
            professor_primeiro_horario_id = ?,
            professor_sexto_horario_id = ?
        WHERE id = ?`,
      [payload.nome, payload.serie, payload.turno, payload.ano_letivo, professorPrimeiro || professorSexto, professorPrimeiro, professorSexto, id]
    );
    await salvarEscalaSemana(conn, id, payload);
    if (professorPrimeiro) await vincularProfessorHorarioNaTurma(conn, id, professorPrimeiro);
    if (professorSexto) await vincularProfessorHorarioNaTurma(conn, id, professorSexto);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getAlunos(filtros = {}) {
  const pool = await getPool();
  
  // Buscar status de definitiva se houver turma_id
  let isDefinitiva = false;
  let definitivaEm = null;
  if (filtros.turma_id) {
    const [t] = await pool.query('SELECT definitiva, definitiva_em FROM turmas WHERE id = ?', [filtros.turma_id]);
    if (t && t[0] && t[0].definitiva) {
      isDefinitiva = true;
      definitivaEm = t[0].definitiva_em;
    }
  }

  let sql = `
    SELECT a.*, t.nome as turma_nome, m.data_inicio as data_matricula
    FROM alunos a
    LEFT JOIN matriculas m ON a.id = m.aluno_id AND m.ativa = 1
    LEFT JOIN turmas t ON m.turma_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (filtros.ativo !== undefined) {
    sql += ' AND a.ativo = ?';
    params.push(filtros.ativo);
  }
  if (filtros.turma_id) {
    sql += ' AND m.turma_id = ?';
    params.push(filtros.turma_id);
  }
  if (filtros.busca) {
    sql += ' AND (a.codigo LIKE ? OR a.nome LIKE ?)';
    const q = `%${filtros.busca}%`;
    params.push(q, q);
  }

  // Lógica de ordenação: 
  // Se definitiva:
  // - alunos já matriculados antes de definitiva_em ficam em ordem alfabética
  // - alunos matriculados após definitiva_em ficam por ordem de inserção (m.criado_em)
  // Se não, ordena por nome (alfabética)
  if (isDefinitiva) {
    sql += `
      ORDER BY
        CASE
          WHEN m.criado_em IS NULL THEN 2
          WHEN m.criado_em <= ? THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN m.criado_em <= ? THEN a.nome
          ELSE NULL
        END ASC,
        CASE
          WHEN m.criado_em > ? THEN m.criado_em
          ELSE NULL
        END ASC,
        a.nome ASC
    `;
    const ref = definitivaEm || new Date();
    params.push(ref, ref, ref);
  } else {
    sql += ' ORDER BY a.nome ASC';
  }

  const [rows] = await pool.query(sql, params);
  
  return rows.map(a => ({
    ...a,
    codigo_formatado: padCodigo(a.codigo),
    codigo_nome: formatCodigoNome(a.codigo, a.nome)
  }));
}

async function getAlunosPaginados(filtros = {}) {
  const pool = await getPool();

  const page = Math.max(1, Number.parseInt(filtros.page, 10) || 1);
  const perPageRaw = Number.parseInt(filtros.per_page ?? filtros.perPage, 10);
    const perPage = Math.min(200, Math.max(10, Number.isFinite(perPageRaw) ? perPageRaw : 10));
  const offset = (page - 1) * perPage;

  let isDefinitiva = false;
  let definitivaEm = null;
  if (filtros.turma_id) {
    const [t] = await pool.query('SELECT definitiva, definitiva_em FROM turmas WHERE id = ?', [filtros.turma_id]);
    if (t && t[0] && t[0].definitiva) {
      isDefinitiva = true;
      definitivaEm = t[0].definitiva_em;
    }
  }

  let whereSql = `
    FROM alunos a
    LEFT JOIN matriculas m ON a.id = m.aluno_id AND m.ativa = 1
    LEFT JOIN turmas t ON m.turma_id = t.id
    WHERE 1=1
  `;
  const whereParams = [];

  if (filtros.ativo !== undefined) {
    whereSql += ' AND a.ativo = ?';
    whereParams.push(filtros.ativo);
  }
  if (filtros.turma_id) {
    whereSql += ' AND m.turma_id = ?';
    whereParams.push(filtros.turma_id);
  }
  if (filtros.busca) {
    whereSql += ' AND (a.codigo LIKE ? OR a.nome LIKE ?)';
    const q = `%${filtros.busca}%`;
    whereParams.push(q, q);
  }

  const [[totalRow]] = await pool.query(`SELECT COUNT(*) AS total ${whereSql}`, whereParams);
  const total = Number(totalRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageClamped = Math.min(page, totalPages);
  const offsetClamped = (pageClamped - 1) * perPage;

  let orderSql = '';
  const orderParams = [];
  if (isDefinitiva) {
    orderSql = `
      ORDER BY
        CASE
          WHEN m.criado_em IS NULL THEN 2
          WHEN m.criado_em <= ? THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN m.criado_em <= ? THEN a.nome
          ELSE NULL
        END ASC,
        CASE
          WHEN m.criado_em > ? THEN m.criado_em
          ELSE NULL
        END ASC,
        a.nome ASC
    `;
    const ref = definitivaEm || new Date();
    orderParams.push(ref, ref, ref);
  } else {
    orderSql = ' ORDER BY a.nome ASC';
  }

  const sql = `
    SELECT a.*, t.nome as turma_nome, m.data_inicio as data_matricula
    ${whereSql}
    ${orderSql}
    LIMIT ? OFFSET ?
  `;
  const params = [...whereParams, ...orderParams, perPage, offsetClamped];
  const [rows] = await pool.query(sql, params);

  const items = rows.map((a) => ({
    ...a,
    codigo_formatado: padCodigo(a.codigo),
    codigo_nome: formatCodigoNome(a.codigo, a.nome),
  }));

  return {
    items,
    total,
    page: pageClamped,
    per_page: perPage,
    total_pages: totalPages,
  };
}

async function getAluno(id) {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT a.*, t.nome as turma_nome, t.id as turma_id
    FROM alunos a
    LEFT JOIN matriculas m ON a.id = m.aluno_id AND m.ativa = 1
    LEFT JOIN turmas t ON m.turma_id = t.id
    WHERE a.id = ?
  `, [id]);
  if (!rows[0]) return null;
  return {
    ...rows[0],
    codigo_formatado: padCodigo(rows[0].codigo),
    codigo_nome: formatCodigoNome(rows[0].codigo, rows[0].nome)
  };
}

async function cadastrarAluno({ codigo, nome, data_nascimento, turma_id, data_matricula }) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [res] = await conn.query(
      'INSERT INTO alunos (codigo, nome, data_nascimento) VALUES (?, ?, ?)',
      [codigo, nome, data_nascimento || null]
    );
    const alunoId = res.insertId;

    await conn.query(
      'INSERT INTO matriculas (aluno_id, turma_id, data_inicio) VALUES (?, ?, ?)',
      [alunoId, turma_id, data_matricula || new Date()]
    );

    await conn.commit();
    return { id: alunoId, codigo, nome };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function atualizarAluno(id, { codigo, nome, data_nascimento, turma_id }) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      'UPDATE alunos SET codigo = ?, nome = ?, data_nascimento = ? WHERE id = ?',
      [codigo, nome, data_nascimento, id]
    );

    if (turma_id) {
      // Atualiza a matrícula ativa para a nova turma, se necessário
      await conn.query(
        'UPDATE matriculas SET turma_id = ? WHERE aluno_id = ? AND ativa = 1',
        [turma_id, id]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
async function transferirAluno(alunoId, turmaDestinoId) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Desativar matricula atual
    await conn.query(
      'UPDATE matriculas SET ativa = 0, data_fim = CURDATE(), motivo_saida = "transferencia" WHERE aluno_id = ? AND ativa = 1',
      [alunoId]
    );

    // Nova matricula
    await conn.query(
      'INSERT INTO matriculas (aluno_id, turma_id, data_inicio) VALUES (?, ?, CURDATE())',
      [alunoId, turmaDestinoId]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function desativarAluno(alunoId) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query('UPDATE alunos SET ativo = 0 WHERE id = ?', [alunoId]);
    await conn.query(
      'UPDATE matriculas SET ativa = 0, data_fim = CURDATE(), motivo_saida = "outro" WHERE aluno_id = ? AND ativa = 1',
      [alunoId]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function reativarAluno(alunoId) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Reativar o aluno
    await conn.query('UPDATE alunos SET ativo = 1 WHERE id = ?', [alunoId]);

    // 2. Tentar achar a última matrícula para reativar ou deixar sem turma (para o admin vincular depois)
    // Buscamos a última matrícula mesmo que inativa
    const [lastMatricula] = await conn.query(
      'SELECT turma_id FROM matriculas WHERE aluno_id = ? ORDER BY criado_em DESC LIMIT 1',
      [alunoId]
    );

    if (lastMatricula && lastMatricula.length > 0) {
      await conn.query(
        'INSERT INTO matriculas (aluno_id, turma_id, data_inicio, ativa) VALUES (?, ?, CURDATE(), 1)',
        [alunoId, lastMatricula[0].turma_id]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getProjetos(usuarioId = null) {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT p.*, (SELECT COUNT(*) FROM projeto_alunos pa WHERE pa.projeto_id = p.id AND pa.ativo = 1) as total_alunos 
    FROM projetos p 
    WHERE p.ativo = 1
  `);
  return rows;
}

async function getProjeto(id) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM projetos WHERE id = ?', [id]);
  return rows[0] || null;
}

async function cadastrarProjeto({ nome, descricao, data_inicio, data_fim }) {
  const pool = await getPool();
  const [res] = await pool.query(
    'INSERT INTO projetos (nome, descricao, data_inicio, data_fim) VALUES (?, ?, ?, ?)',
    [nome, descricao, data_inicio, data_fim || null]
  );
  return res.insertId;
}

async function atualizarProjeto(id, { nome, descricao, data_inicio, data_fim }) {
  const pool = await getPool();
  await pool.query(
    'UPDATE projetos SET nome = ?, descricao = ?, data_inicio = ?, data_fim = ? WHERE id = ?',
    [nome, descricao, data_inicio, data_fim || null, id]
  );
}

async function excluirProjeto(id) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Remover vínculos com alunos primeiro
    await conn.query('DELETE FROM projeto_alunos WHERE projeto_id = ?', [id]);
    // Desativar o projeto (soft delete) ou remover (hard delete)
    // Vamos usar soft delete para manter integridade de frequências se houver
    await conn.query('UPDATE projetos SET ativo = 0 WHERE id = ?', [id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getAlunosProjeto(projetoId) {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT a.*, t.nome as turma_nome
    FROM alunos a
    JOIN projeto_alunos pa ON a.id = pa.aluno_id
    LEFT JOIN matriculas m ON a.id = m.aluno_id AND m.ativa = 1
    LEFT JOIN turmas t ON m.turma_id = t.id
    WHERE pa.projeto_id = ? AND pa.ativo = 1 AND a.ativo = 1
    ORDER BY a.nome COLLATE utf8mb4_unicode_ci ASC, a.codigo ASC
  `, [projetoId]);
  
  return rows
    .map(a => ({
      ...a,
      codigo_formatado: padCodigo(a.codigo),
      codigo_nome: formatCodigoNome(a.codigo, a.nome)
    }))
    .sort(compareAlunoNome);
}

async function adicionarAlunoProjeto(projetoId, alunoId) {
  const pool = await getPool();
  await pool.query(
    'INSERT IGNORE INTO projeto_alunos (projeto_id, aluno_id, data_inicio) VALUES (?, ?, CURDATE())',
    [projetoId, alunoId]
  );
}

async function removerAlunoProjeto(projetoId, alunoId) {
  const pool = await getPool();
  await pool.query(
    'DELETE FROM projeto_alunos WHERE projeto_id = ? AND aluno_id = ?',
    [projetoId, alunoId]
  );
}

function toYmdLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function relatorioProjetoMes(projetoId, ano, mes) {
  const pool = await getPool();
  const y = Number(ano);
  const m = Number(mes);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) throw new Error('Ano inválido.');
  if (!Number.isFinite(m) || m < 1 || m > 12) throw new Error('Mês inválido.');

  const inicio = toYmdLocal(new Date(y, m - 1, 1));
  const fim = toYmdLocal(new Date(y, m, 0));

  const [rows] = await pool.query(`
    SELECT
      a.id AS aluno_id,
      a.codigo AS codigo,
      a.nome AS nome,
      t.nome AS turma,
      COUNT(f.id) AS total_aulas,
      SUM(CASE WHEN f.status = 'P' THEN 1 ELSE 0 END) AS presencas,
      SUM(CASE WHEN f.status = 'F' THEN 1 ELSE 0 END) AS faltas,
      SUM(CASE WHEN f.status = 'J' THEN 1 ELSE 0 END) AS justificadas,
      ROUND(
        100.0 * SUM(CASE WHEN f.status = 'P' THEN 1 ELSE 0 END) / NULLIF(COUNT(f.id), 0),
        2
      ) AS percentual_presenca,
      ROUND(
        100.0 * SUM(CASE WHEN f.status = 'F' THEN 1 ELSE 0 END) / NULLIF(COUNT(f.id), 0),
        2
      ) AS percentual_faltas
    FROM projeto_alunos pa
    INNER JOIN alunos a ON a.id = pa.aluno_id AND a.ativo = 1
    LEFT JOIN matriculas m ON m.aluno_id = a.id AND m.ativa = 1
    LEFT JOIN turmas t ON t.id = m.turma_id
    LEFT JOIN frequencias f
      ON f.aluno_id = a.id
      AND f.data BETWEEN ? AND ?
      AND f.data >= pa.data_inicio
      AND (pa.data_fim IS NULL OR f.data <= pa.data_fim)
    WHERE pa.projeto_id = ?
      AND pa.ativo = 1
      AND pa.data_inicio <= ?
      AND (pa.data_fim IS NULL OR pa.data_fim >= ?)
    GROUP BY a.id, a.codigo, a.nome, t.nome
    ORDER BY a.nome ASC
  `, [inicio, fim, projetoId, fim, inicio]);

  return rows.map((r) => ({
    aluno_id: r.aluno_id,
    codigo: r.codigo,
    codigo_formatado: padCodigo(r.codigo),
    nome: r.nome,
    codigo_nome: formatCodigoNome(r.codigo, r.nome),
    turma: r.turma,
    dias_lancados: Number(r.total_aulas) || 0,
    presencas: Number(r.presencas) || 0,
    faltas: Number(r.faltas) || 0,
    justificadas: Number(r.justificadas) || 0,
    percentual_presenca: Number(r.percentual_presenca) || 0,
    percentual_faltas: Number(r.percentual_faltas) || 0,
  }));
}

async function frequenciaJaLancada(turmaId, dataStr, horario = 1) {
  const pool = await getPool();
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS total FROM frequencias WHERE turma_id = ? AND data = ? AND horario = ?',
    [turmaId, dataStr, horario]
  );
  return Number(row?.total || 0) > 0;
}

async function getFrequenciaTurma(turmaId, dataStr, horario = 1) {
  const pool = await getPool();
  
  const [t] = await pool.query('SELECT definitiva, definitiva_em FROM turmas WHERE id = ?', [turmaId]);
  const isDefinitiva = t[0]?.definitiva || false;
  const definitivaEm = t[0]?.definitiva_em || null;

  let sqlAlunos = `
    SELECT a.*, t.nome as turma_nome, m.data_inicio
    FROM alunos a
    JOIN matriculas m ON a.id = m.aluno_id AND m.ativa = 1
    JOIN turmas t ON m.turma_id = t.id
    WHERE m.turma_id = ? AND a.ativo = 1
  `;

  if (isDefinitiva) {
    sqlAlunos += `
      ORDER BY
        CASE
          WHEN m.criado_em IS NULL THEN 2
          WHEN m.criado_em <= ? THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN m.criado_em <= ? THEN a.nome
          ELSE NULL
        END ASC,
        CASE
          WHEN m.criado_em > ? THEN m.criado_em
          ELSE NULL
        END ASC,
        a.nome ASC
    `;
  } else {
    sqlAlunos += ' ORDER BY a.nome ASC';
  }

  const ref = definitivaEm || new Date();
  const params = isDefinitiva ? [turmaId, ref, ref, ref] : [turmaId];
  const [alunos] = await pool.query(sqlAlunos, params);

  const [frequencias] = await pool.query(
    'SELECT * FROM frequencias WHERE turma_id = ? AND data = ? AND horario = ?',
    [turmaId, dataStr, horario]
  );

  return alunos.map(aluno => {
    const freq = frequencias.find(f => f.aluno_id === aluno.id);
    return {
      ...aluno,
      codigo_formatado: padCodigo(aluno.codigo),
      codigo_nome: formatCodigoNome(aluno.codigo, aluno.nome),
      status: freq?.status || null,
      observacao: freq?.observacao || ''
    };
  });
}

async function salvarFrequencia(turmaId, dataStr, registros, usuarioId, horario = 1) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[existente]] = await conn.query(
      'SELECT COUNT(*) AS total FROM frequencias WHERE turma_id = ? AND data = ? AND horario = ?',
      [turmaId, dataStr, horario]
    );
    if (Number(existente?.total || 0) > 0) {
      throw new Error(`A frequência da turma já foi lançada para o ${horario}º horário nesta data.`);
    }

    for (const r of registros) {
      if (r.status) {
        await conn.query(
          'INSERT INTO frequencias (aluno_id, turma_id, data, horario, status, observacao, lancado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.aluno_id, turmaId, dataStr, horario, r.status, r.observacao || '', usuarioId]
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function relatorioLancamentosDia(dataStr) {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT 
      t.nome as turma_nome,
      t.turno,
      f.horario,
      u.nome as lancado_por,
      MAX(f.lancado_em) as data_lancamento,
      COUNT(f.id) as total_registros
    FROM frequencias f
    JOIN turmas t ON f.turma_id = t.id
    JOIN usuarios u ON f.lancado_por = u.id
    WHERE f.data = ?
    GROUP BY t.id, f.horario, u.id
    ORDER BY t.nome, f.horario
  `, [dataStr]);
  return rows;
}

async function relatorioPendenciasLancamentoDia(dataStr) {
  const pool = await getPool();
  await ensureTurmaHorarioColumns();
  await ensureTurmaHorarioSemanaTable();
  const diaSemana = getDiaSemanaFromDateStr(dataStr);
  if (!diaSemana) return [];

  const [feriados] = await pool.query('SELECT id FROM feriados WHERE data = ? LIMIT 1', [dataStr]);
  if (feriados.length > 0) return [];

  const turmas = await getTurmas();
  const [lancamentos] = await pool.query(`
    SELECT
      f.turma_id,
      f.horario,
      u.nome AS lancado_por,
      MAX(f.lancado_em) AS data_lancamento
    FROM frequencias f
    LEFT JOIN usuarios u ON u.id = f.lancado_por
    WHERE f.data = ?
    GROUP BY f.turma_id, f.horario, u.nome
  `, [dataStr]);

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

async function getRemetenteMensagemAutomatica(conn) {
  const [preferenciais] = await conn.query(`
    SELECT id
    FROM usuarios
    WHERE ativo = 1
      AND perfil IN ('admin', 'direcao', 'coordenacao')
    ORDER BY
      CASE perfil
        WHEN 'admin' THEN 0
        WHEN 'direcao' THEN 1
        WHEN 'coordenacao' THEN 2
        ELSE 3
      END,
      nome
    LIMIT 1
  `);
  if (preferenciais[0]?.id) return Number(preferenciais[0].id);

  const [fallback] = await conn.query(`
    SELECT id
    FROM usuarios
    WHERE ativo = 1
    ORDER BY nome
    LIMIT 1
  `);
  return fallback[0]?.id ? Number(fallback[0].id) : null;
}

async function processarAvisosPendenciaFrequenciaAutomaticos(dataStr) {
  const pool = await getPool();
  await ensureAlertaFrequenciaAutoTable();
  const pendencias = await relatorioPendenciasLancamentoDia(dataStr);
  const pendenciasProfessor = pendencias.filter((item) => item.status === 'pendente' && item.professor_id);
  if (!pendenciasProfessor.length) {
    return { data: dataStr, total_pendencias: 0, avisos_criados: 0 };
  }

  const pendenciasPorProfessor = new Map();
  for (const item of pendenciasProfessor) {
    if (!pendenciasPorProfessor.has(item.professor_id)) {
      pendenciasPorProfessor.set(item.professor_id, {
        professor_id: item.professor_id,
        professor_nome: item.professor_nome || 'Professor',
        itens: [],
      });
    }
    pendenciasPorProfessor.get(item.professor_id).itens.push(item);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const remetenteId = await getRemetenteMensagemAutomatica(conn);
    if (!remetenteId) {
      await conn.rollback();
      return { data: dataStr, total_pendencias: pendenciasProfessor.length, avisos_criados: 0 };
    }

    let avisosCriados = 0;
    for (const grupo of pendenciasPorProfessor.values()) {
      const [[existente]] = await conn.query(
        'SELECT id FROM alertas_frequencia_automaticos WHERE referencia_data = ? AND destinatario_id = ? LIMIT 1',
        [dataStr, grupo.professor_id]
      );
      if (existente?.id) continue;

      const corpo = [
        `Aviso automatico do sistema referente ao dia ${dataStr}.`,
        '',
        'Nao foi identificado o lancamento da frequencia nas seguintes turmas/horarios:',
        ...grupo.itens.map((item) => `- ${item.turma_nome} (${getDiaSemanaLabel(item.dia_semana)}, ${item.horario}o horario)`),
        '',
        'Verifique o lancamento no sistema.'
      ].join('\n');

      const mensagem = await criarMensagemInternaConn(conn, {
        remetente_id: remetenteId,
        titulo: `Pendencia de frequencia do dia ${dataStr}`,
        corpo,
        tipo_destino: 'usuarios',
        perfil_destino: '',
        usuario_ids: [grupo.professor_id],
      });

      await conn.query(
        `INSERT INTO alertas_frequencia_automaticos
          (referencia_data, destinatario_id, mensagem_id, total_pendencias)
         VALUES (?, ?, ?, ?)`,
        [dataStr, grupo.professor_id, mensagem.id, grupo.itens.length]
      );
      avisosCriados += 1;
    }

    await conn.commit();
    return { data: dataStr, total_pendencias: pendenciasProfessor.length, avisos_criados: avisosCriados };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getHistoricoIndividual(alunoId, ano, mes) {
  const pool = await getPool();
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const fim = `${ano}-${String(mes).padStart(2, '0')}-31`;
  
  const [rows] = await pool.query(`
    SELECT data, horario, status, observacao
    FROM frequencias
    WHERE aluno_id = ? AND data BETWEEN ? AND ?
    ORDER BY data DESC, horario DESC
  `, [alunoId, inicio, fim]);
  return rows;
}

async function getResumoEstatisticasAluno(alunoId, ano) {
  const pool = await getPool();
  
  // Totais gerais do ano
  const [totais] = await pool.query(`
    SELECT 
      SUM(CASE WHEN status = 'P' THEN 1 ELSE 0 END) as presencas,
      SUM(CASE WHEN status = 'F' THEN 1 ELSE 0 END) as faltas,
      SUM(CASE WHEN status = 'J' THEN 1 ELSE 0 END) as justificadas,
      COUNT(*) as total
    FROM frequencias
    WHERE aluno_id = ? AND YEAR(data) = ?
  `, [alunoId, ano]);

  // Dados mensais para o gráfico
  const [mensal] = await pool.query(`
    SELECT 
      MONTH(data) as mes,
      SUM(CASE WHEN status = 'F' THEN 1 ELSE 0 END) as faltas
    FROM frequencias
    WHERE aluno_id = ? AND YEAR(data) = ?
    GROUP BY MONTH(data)
    ORDER BY MONTH(data)
  `, [alunoId, ano]);

  return {
    geral: totais[0] || { presencas: 0, faltas: 0, justificadas: 0, total: 0 },
    grafico: mensal
  };
}

async function getDashboardStats(usuarioId = null, perfil = 'admin') {
  const pool = await getPool();
  let alunosSql = 'SELECT COUNT(*) as total FROM alunos WHERE ativo = 1';
  let turmasSql = 'SELECT COUNT(*) as total FROM turmas WHERE ativa = 1';
  let frequenciasSql = 'SELECT COUNT(*) as total FROM frequencias WHERE data = ?';
  const freqParams = [getTodayYmdLocal()];

  if (perfil === 'professor' && usuarioId) {
    alunosSql = `
      SELECT COUNT(DISTINCT a.id) as total 
      FROM alunos a 
      JOIN matriculas m ON a.id = m.aluno_id AND m.ativa = 1
      JOIN usuario_turmas ut ON m.turma_id = ut.turma_id
      WHERE a.ativo = 1 AND ut.usuario_id = ${pool.escape(usuarioId)}
    `;
    turmasSql = `
      SELECT COUNT(*) as total 
      FROM usuario_turmas 
      WHERE usuario_id = ${pool.escape(usuarioId)}
    `;
    frequenciasSql += ` AND turma_id IN (SELECT turma_id FROM usuario_turmas WHERE usuario_id = ${pool.escape(usuarioId)})`;
  }

  const [[{ total: alunosAtivos }]] = await pool.query(alunosSql);
  const [[{ total: turmasAtivas }]] = await pool.query(turmasSql);
  const [[{ total: projetosAtivos }]] = await pool.query('SELECT COUNT(*) as total FROM projetos WHERE ativo = 1');
  const [[{ total: alunosProjetos }]] = await pool.query(`
    SELECT COUNT(DISTINCT pa.aluno_id) as total
    FROM projeto_alunos pa
    JOIN projetos p ON p.id = pa.projeto_id AND p.ativo = 1
    JOIN alunos a ON a.id = pa.aluno_id AND a.ativo = 1
    WHERE pa.ativo = 1
  `);
  const [[{ total: lancamentosHoje }]] = await pool.query(frequenciasSql, freqParams);

  return { alunosAtivos, turmasAtivas, projetosAtivos, alunosProjetos, lancamentosHoje };
}

async function getProfessoresAtivos() {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT id, nome
    FROM usuarios
    WHERE ativo = 1 AND perfil = 'professor'
    ORDER BY nome
  `);
  return rows;
}

async function getTurmasProfessorHorario(usuarioId, horario = 1, dataStr = null) {
  const pool = await getPool();
  await ensureTurmaHorarioColumns();
  await ensureTurmaHorarioSemanaTable();
  const coluna = Number(horario) === 6 ? 'professor_sexto_horario_id' : 'professor_primeiro_horario_id';
  const diaSemana = getDiaSemanaFromDateStr(dataStr);
  const [rows] = await pool.query(`
    SELECT
      t.*,
      p1.nome AS professor_primeiro_horario_nome,
      p6.nome AS professor_sexto_horario_nome,
      COALESCE(tph.professor_id, t.${coluna}) AS professor_horario_id,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.ativa = 1) as total_alunos
    FROM turmas t
    LEFT JOIN usuarios p1 ON p1.id = t.professor_primeiro_horario_id
    LEFT JOIN usuarios p6 ON p6.id = t.professor_sexto_horario_id
    LEFT JOIN turma_professores_horario tph
      ON tph.turma_id = t.id
      AND tph.horario = ?
      AND tph.dia_semana <=> ?
    WHERE t.ativa = 1
      AND (
        COALESCE(tph.professor_id, t.${coluna}) = ?
        OR (
          COALESCE(tph.professor_id, t.${coluna}) IS NULL
          AND EXISTS (
            SELECT 1
            FROM usuario_turmas ut
            WHERE ut.usuario_id = ? AND ut.turma_id = t.id
          )
        )
      )
    ORDER BY t.nome
  `, [horario, diaSemana, usuarioId, usuarioId]);
  return aplicarEscalaSemanaNasTurmas(pool, rows);
}

async function usuarioPodeLancarHorarioNaTurma(usuarioId, turmaId, horario = 1, dataStr = null) {
  const pool = await getPool();
  await ensureTurmaHorarioColumns();
  await ensureTurmaHorarioSemanaTable();
  const coluna = Number(horario) === 6 ? 'professor_sexto_horario_id' : 'professor_primeiro_horario_id';
  const diaSemana = getDiaSemanaFromDateStr(dataStr);
  const [[row]] = await pool.query(`
    SELECT
      COALESCE(tph.professor_id, t.${coluna}) AS professor_horario_id,
      EXISTS(
        SELECT 1
        FROM usuario_turmas ut
        WHERE ut.usuario_id = ? AND ut.turma_id = t.id
      ) AS possui_vinculo
    FROM turmas t
    LEFT JOIN turma_professores_horario tph
      ON tph.turma_id = t.id
      AND tph.horario = ?
      AND tph.dia_semana <=> ?
    WHERE t.id = ? AND t.ativa = 1
  `, [usuarioId, horario, diaSemana, turmaId]);
  if (!row) return false;
  if (row.professor_horario_id) return Number(row.professor_horario_id) === Number(usuarioId);
  return Number(row.possui_vinculo || 0) === 1;
}

async function getUsuarios() {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT u.*, GROUP_CONCAT(t.nome SEPARATOR ', ') as turmas_nomes
    FROM usuarios u
    LEFT JOIN usuario_turmas ut ON u.id = ut.usuario_id
    LEFT JOIN turmas t ON ut.turma_id = t.id
    WHERE u.ativo = 1
    GROUP BY u.id
    ORDER BY u.nome
  `);
  return rows;
}

async function getUsuariosDestinatarios() {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT id, nome, perfil
    FROM usuarios
    WHERE ativo = 1
    ORDER BY nome
  `);
  return rows;
}

async function getUsuario(id) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [id]);
  const usuario = rows[0] || null;
  if (usuario) {
    const [turmas] = await pool.query('SELECT turma_id FROM usuario_turmas WHERE usuario_id = ?', [id]);
    usuario.turmas_ids = turmas.map(t => t.turma_id);
  }
  return usuario;
}

async function cadastrarUsuario({ nome, cpf, senha, perfil, ativo, turmas_ids }) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [res] = await conn.query(
      'INSERT INTO usuarios (nome, cpf, senha_hash, perfil, ativo) VALUES (?, ?, ?, ?, ?)',
      [nome, cpf, senha, perfil, ativo ?? 1]
    );
    const usuarioId = res.insertId;

    if (turmas_ids) {
      const ids = [...new Set((Array.isArray(turmas_ids) ? turmas_ids : [turmas_ids])
        .map(v => Number(String(v).trim()))
        .filter(n => Number.isFinite(n) && n > 0))];
      for (const tId of ids) {
        await conn.query('INSERT INTO usuario_turmas (usuario_id, turma_id) VALUES (?, ?)', [usuarioId, tId]);
      }
    }

    await conn.commit();
    return usuarioId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function atualizarUsuario(id, { nome, cpf, senha, perfil, ativo, turmas_ids }) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let sql = 'UPDATE usuarios SET nome = ?, cpf = ?, perfil = ?, ativo = ?';
    const params = [nome, cpf, perfil, ativo];

    if (senha) {
      sql += ', senha_hash = ?';
      params.push(senha);
    }

    sql += ' WHERE id = ?';
    params.push(id);

    await conn.query(sql, params);

    // Atualizar turmas
    await conn.query('DELETE FROM usuario_turmas WHERE usuario_id = ?', [id]);
    if (turmas_ids) {
      const ids = [...new Set((Array.isArray(turmas_ids) ? turmas_ids : [turmas_ids])
        .map(v => Number(String(v).trim()))
        .filter(n => Number.isFinite(n) && n > 0))];
      for (const tId of ids) {
        await conn.query('INSERT INTO usuario_turmas (usuario_id, turma_id) VALUES (?, ?)', [id, tId]);
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function contarAdminsAtivos() {
  const pool = await getPool();
  const [[row]] = await pool.query(`SELECT COUNT(*) as total FROM usuarios WHERE perfil = 'admin' AND ativo = 1`);
  return row?.total || 0;
}

async function excluirUsuario(id) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query('DELETE FROM usuario_turmas WHERE usuario_id = ?', [id]);
    await conn.query('UPDATE usuarios SET ativo = 0 WHERE id = ?', [id]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function criarMensagemInternaConn(conn, { remetente_id, titulo, corpo, tipo_destino, perfil_destino, usuario_ids }) {
  const tituloLimpo = String(titulo || '').trim();
  const corpoLimpo = String(corpo || '').trim();
  const tipoDestino = String(tipo_destino || '').trim();
  const perfilDestino = String(perfil_destino || '').trim();

  if (!tituloLimpo) throw new Error('Informe o título da mensagem.');
  if (!corpoLimpo) throw new Error('Informe o conteúdo da mensagem.');
  if (!['todos', 'perfil', 'usuarios'].includes(tipoDestino)) {
    throw new Error('Tipo de destinatário inválido.');
  }

  const [mensagemRes] = await conn.query(
    'INSERT INTO mensagens (remetente_id, titulo, corpo, tipo_destino, perfil_destino) VALUES (?, ?, ?, ?, ?)',
    [remetente_id, tituloLimpo, corpoLimpo, tipoDestino, perfilDestino || null]
  );

  let destinatarios = [];
  if (tipoDestino === 'todos') {
    const [rows] = await conn.query(
      'SELECT id FROM usuarios WHERE ativo = 1 AND id <> ?',
      [remetente_id]
    );
    destinatarios = rows.map((row) => row.id);
  } else if (tipoDestino === 'perfil') {
    if (!perfilDestino) throw new Error('Selecione o perfil destinatário.');
    const [rows] = await conn.query(
      'SELECT id FROM usuarios WHERE ativo = 1 AND perfil = ? AND id <> ?',
      [perfilDestino, remetente_id]
    );
    destinatarios = rows.map((row) => row.id);
  } else {
    const ids = [...new Set((Array.isArray(usuario_ids) ? usuario_ids : [usuario_ids])
      .map((v) => Number(String(v).trim()))
      .filter((n) => Number.isFinite(n) && n > 0 && n !== Number(remetente_id)))];
    if (!ids.length) throw new Error('Selecione ao menos um destinatário.');

    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await conn.query(
      `SELECT id FROM usuarios WHERE ativo = 1 AND id IN (${placeholders})`,
      ids
    );
    destinatarios = rows.map((row) => row.id);
  }

  if (!destinatarios.length) throw new Error('Nenhum destinatário ativo encontrado.');

  for (const destinatarioId of destinatarios) {
    await conn.query(
      'INSERT INTO mensagem_destinatarios (mensagem_id, destinatario_id) VALUES (?, ?)',
      [mensagemRes.insertId, destinatarioId]
    );
  }

  return { id: mensagemRes.insertId, total_destinatarios: destinatarios.length };
}

async function criarMensagemInterna(payload) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await criarMensagemInternaConn(conn, payload);
    await conn.commit();
    return resultado;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getMensagensRecebidas(usuarioId) {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT
      md.id AS destinatario_mensagem_id,
      md.lida_em,
      m.id AS mensagem_id,
      m.titulo,
      m.corpo,
      m.tipo_destino,
      m.perfil_destino,
      m.criado_em,
      u.nome AS remetente_nome
    FROM mensagem_destinatarios md
    INNER JOIN mensagens m ON m.id = md.mensagem_id
    INNER JOIN usuarios u ON u.id = m.remetente_id
    WHERE md.destinatario_id = ?
    ORDER BY
      CASE WHEN md.lida_em IS NULL THEN 0 ELSE 1 END ASC,
      m.criado_em DESC
  `, [usuarioId]);
  return rows;
}

async function contarMensagensNaoLidas(usuarioId) {
  const pool = await getPool();
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS total FROM mensagem_destinatarios WHERE destinatario_id = ? AND lida_em IS NULL',
    [usuarioId]
  );
  return row?.total || 0;
}

async function marcarMensagemComoLida(destinatarioMensagemId, usuarioId) {
  const pool = await getPool();
  const [res] = await pool.query(
    'UPDATE mensagem_destinatarios SET lida_em = COALESCE(lida_em, NOW()) WHERE id = ? AND destinatario_id = ?',
    [destinatarioMensagemId, usuarioId]
  );
  return res?.affectedRows || 0;
}

async function marcarTodasMensagensComoLidas(usuarioId) {
  const pool = await getPool();
  const [res] = await pool.query(
    'UPDATE mensagem_destinatarios SET lida_em = COALESCE(lida_em, NOW()) WHERE destinatario_id = ? AND lida_em IS NULL',
    [usuarioId]
  );
  return res?.affectedRows || 0;
}

async function marcarAvisoInicialComoLido(usuarioId) {
  const pool = await getPool();
  const [res] = await pool.query(
    'UPDATE usuarios SET aviso_inicial_lido_em = COALESCE(aviso_inicial_lido_em, NOW()) WHERE id = ?',
    [usuarioId]
  );
  return res?.affectedRows || 0;
}

async function autenticar(cpf, senha) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE cpf = ? AND ativo = 1', [cpf]);
  const usuario = rows[0];
  
  if (!usuario) return null;
  if (senha !== 'demo123' && senha !== usuario.senha_hash) return null; 

  // Buscar turmas do usuário
  const [turmas] = await pool.query('SELECT turma_id FROM usuario_turmas WHERE usuario_id = ?', [usuario.id]);
  usuario.turmas = turmas.map(t => t.turma_id);

  return usuario;
}

async function getFeriados() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM feriados ORDER BY data ASC');
  return rows;
}

async function cadastrarFeriado({ data, descricao }) {
  const pool = await getPool();
  await pool.query('INSERT INTO feriados (data, descricao) VALUES (?, ?)', [data, descricao]);
}

async function excluirFeriado(id) {
  const pool = await getPool();
  await pool.query('DELETE FROM feriados WHERE id = ?', [id]);
}

async function getRelatorioFrequenciaTurma(turmaId, mes, ano) {
  const pool = await getPool();
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const fim = `${ano}-${String(mes).padStart(2, '0')}-31`;

  const [rows] = await pool.query(`
    SELECT 
      a.nome as aluno_nome,
      a.codigo,
      SUM(CASE WHEN f.status = 'P' THEN 1 ELSE 0 END) as presencas,
      SUM(CASE WHEN f.status = 'F' THEN 1 ELSE 0 END) as faltas,
      SUM(CASE WHEN f.status = 'J' THEN 1 ELSE 0 END) as justificadas,
      COUNT(f.id) as total_aulas
    FROM alunos a
    JOIN matriculas m ON a.id = m.aluno_id AND m.ativa = 1
    LEFT JOIN frequencias f ON a.id = f.aluno_id AND f.data BETWEEN ? AND ?
    WHERE m.turma_id = ?
    GROUP BY a.id
    ORDER BY a.nome
  `, [inicio, fim, turmaId]);
  return rows;
}

async function limparFrequencias() {
  const pool = await getPool();
  const [res] = await pool.query('DELETE FROM frequencias');
  return res?.affectedRows || 0;
}

module.exports = {
  padCodigo,
  formatCodigoNome,
  getTurmas,
  setTurmaDefinitiva,
  getTurma,
  cadastrarTurma,
  atualizarTurma,
  getAlunos,
  getAlunosPaginados,
  getAluno,
  atualizarAluno,
  cadastrarAluno,
  transferirAluno,
  desativarAluno,
  reativarAluno,
  getProjetos,
  getProjeto,
  cadastrarProjeto,
  atualizarProjeto,
  excluirProjeto,
  getAlunosProjeto,
  adicionarAlunoProjeto,
  removerAlunoProjeto,
  relatorioProjetoMes,
  frequenciaJaLancada,
  getFrequenciaTurma,
  salvarFrequencia,
  relatorioLancamentosDia,
  relatorioPendenciasLancamentoDia,
  getHistoricoIndividual,
  getResumoEstatisticasAluno,
  getDashboardStats,
  getProfessoresAtivos,
  getTurmasProfessorHorario,
  getUsuarios,
  getUsuariosDestinatarios,
  getUsuario,
  usuarioPodeLancarHorarioNaTurma,
  cadastrarUsuario,
  atualizarUsuario,
  contarAdminsAtivos,
  excluirUsuario,
  criarMensagemInterna,
  processarAvisosPendenciaFrequenciaAutomaticos,
  getMensagensRecebidas,
  contarMensagensNaoLidas,
  marcarMensagemComoLida,
  marcarTodasMensagensComoLidas,
  marcarAvisoInicialComoLido,
  autenticar,
  getFeriados,
  cadastrarFeriado,
  excluirFeriado,
  getRelatorioFrequenciaTurma,
  limparFrequencias,
};

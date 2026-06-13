-- =============================================================================
-- Sistema de Frequência Escolar - Presença
-- Banco: MySQL 8.0+
-- =============================================================================

CREATE DATABASE IF NOT EXISTS presenca_escolar
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE presenca_escolar;

-- -----------------------------------------------------------------------------
-- Tabela: turmas
-- -----------------------------------------------------------------------------
CREATE TABLE turmas (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome                VARCHAR(50)  NOT NULL COMMENT 'Ex: 6º A',
    serie               VARCHAR(30)  NOT NULL COMMENT 'Ex: 6º ano',
    turno               ENUM('manha', 'tarde', 'noite', 'integral') NOT NULL DEFAULT 'manha',
    ano_letivo          SMALLINT UNSIGNED NOT NULL,
    professor_responsavel_id INT UNSIGNED NULL COMMENT 'FK definida após criar usuarios',
    professor_primeiro_horario_id INT UNSIGNED NULL COMMENT 'Professor responsável pelo 1º horário',
    professor_sexto_horario_id INT UNSIGNED NULL COMMENT 'Professor responsável pelo 6º horário',
    ativa               TINYINT(1) NOT NULL DEFAULT 1,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_turma_nome_ano (nome, ano_letivo),
    INDEX idx_turmas_ano_ativa (ano_letivo, ativa)
) ENGINE=InnoDB COMMENT='Turmas da escola (34 ou mais)';

-- -----------------------------------------------------------------------------
-- Tabela: usuarios (professores, coordenação, admin)
-- -----------------------------------------------------------------------------
CREATE TABLE usuarios (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome                VARCHAR(120) NOT NULL,
    cpf                 VARCHAR(11) NOT NULL,
    senha_hash          VARCHAR(255) NOT NULL COMMENT 'Hash bcrypt/argon2',
    perfil              ENUM('admin', 'coordenacao', 'professor') NOT NULL DEFAULT 'professor',
    ativo               TINYINT(1) NOT NULL DEFAULT 1,
    aviso_inicial_lido_em DATETIME NULL,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_usuarios_cpf (cpf),
    INDEX idx_usuarios_perfil_ativo (perfil, ativo)
) ENGINE=InnoDB COMMENT='Usuários com acesso ao sistema';

-- FK turmas -> usuarios (professor responsável)
ALTER TABLE turmas
    ADD CONSTRAINT fk_turmas_professor
    FOREIGN KEY (professor_responsavel_id) REFERENCES usuarios (id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE turmas
    ADD CONSTRAINT fk_turmas_prof_1h
    FOREIGN KEY (professor_primeiro_horario_id) REFERENCES usuarios (id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE turmas
    ADD CONSTRAINT fk_turmas_prof_6h
    FOREIGN KEY (professor_sexto_horario_id) REFERENCES usuarios (id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Tabela: usuario_turmas (professor pode ter mais de uma turma)
-- -----------------------------------------------------------------------------
CREATE TABLE usuario_turmas (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id          INT UNSIGNED NOT NULL,
    turma_id            INT UNSIGNED NOT NULL,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_usuario_turma (usuario_id, turma_id),
    CONSTRAINT fk_ut_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ut_turma FOREIGN KEY (turma_id) REFERENCES turmas (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Vínculo N:N entre professores e turmas';

-- -----------------------------------------------------------------------------
-- Tabela: turma_professores_horario
-- Define o professor por dia da semana e horário (1º e 6º)
-- -----------------------------------------------------------------------------
CREATE TABLE turma_professores_horario (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    turma_id            INT UNSIGNED NOT NULL,
    dia_semana          ENUM('segunda', 'terca', 'quarta', 'quinta', 'sexta') NOT NULL,
    horario             TINYINT UNSIGNED NOT NULL COMMENT 'Horários permitidos: 1 ou 6',
    professor_id        INT UNSIGNED NULL,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_turma_dia_horario (turma_id, dia_semana, horario),
    INDEX idx_tph_professor (professor_id),
    CONSTRAINT fk_tph_turma FOREIGN KEY (turma_id) REFERENCES turmas (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tph_professor FOREIGN KEY (professor_id) REFERENCES usuarios (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Escala semanal de professores por turma';

-- -----------------------------------------------------------------------------
-- Tabela: mensagens internas
-- -----------------------------------------------------------------------------
CREATE TABLE mensagens (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    remetente_id        INT UNSIGNED NOT NULL,
    titulo              VARCHAR(160) NOT NULL,
    corpo               TEXT NOT NULL,
    tipo_destino        ENUM('todos', 'perfil', 'usuarios') NOT NULL DEFAULT 'todos',
    perfil_destino      VARCHAR(20) NULL,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_mensagens_remetente (remetente_id),
    INDEX idx_mensagens_criado (criado_em),
    CONSTRAINT fk_mensagens_remetente FOREIGN KEY (remetente_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Mensagens internas enviadas pelo sistema';

-- -----------------------------------------------------------------------------
-- Tabela: destinatários das mensagens internas
-- -----------------------------------------------------------------------------
CREATE TABLE mensagem_destinatarios (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mensagem_id         INT UNSIGNED NOT NULL,
    destinatario_id     INT UNSIGNED NOT NULL,
    lida_em             DATETIME NULL,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_mensagem_destinatario (mensagem_id, destinatario_id),
    INDEX idx_md_destinatario_lida (destinatario_id, lida_em),
    CONSTRAINT fk_md_mensagem FOREIGN KEY (mensagem_id) REFERENCES mensagens (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_md_destinatario FOREIGN KEY (destinatario_id) REFERENCES usuarios (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Destinatários e status de leitura das mensagens internas';

-- -----------------------------------------------------------------------------
-- Tabela: alunos
-- codigo: número de no máximo 8 dígitos, exibido antes do nome
-- -----------------------------------------------------------------------------
CREATE TABLE alunos (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo              VARCHAR(8) NOT NULL COMMENT 'Código numérico do aluno (máx. 8 dígitos)',
    nome                VARCHAR(150) NOT NULL,
    data_nascimento     DATE NULL,
    ativo               TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = saiu da escola',
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_alunos_codigo (codigo),
    INDEX idx_alunos_ativo (ativo),
    INDEX idx_alunos_codigo_nome (codigo, nome),

    CONSTRAINT chk_alunos_codigo_numerico CHECK (codigo REGEXP '^[0-9]{1,8}$')
) ENGINE=InnoDB COMMENT='Cadastro permanente de alunos';

-- -----------------------------------------------------------------------------
-- Tabela: matriculas (histórico de matrículas e transferências)
-- -----------------------------------------------------------------------------
CREATE TABLE matriculas (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    aluno_id            INT UNSIGNED NOT NULL,
    turma_id            INT UNSIGNED NOT NULL,
    data_inicio         DATE NOT NULL,
    data_fim            DATE NULL COMMENT 'NULL = matrícula em vigor',
    motivo_saida        ENUM('transferencia', 'desistencia', 'conclusao', 'outro') NULL,
    observacao          VARCHAR(255) NULL,
    ativa               TINYINT(1) NOT NULL DEFAULT 1,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_matriculas_aluno (aluno_id),
    INDEX idx_matriculas_turma (turma_id),
    INDEX idx_matriculas_ativa (ativa),
    INDEX idx_matriculas_periodo (data_inicio, data_fim),

    CONSTRAINT fk_matriculas_aluno FOREIGN KEY (aluno_id) REFERENCES alunos (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_matriculas_turma FOREIGN KEY (turma_id) REFERENCES turmas (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_matriculas_datas CHECK (data_fim IS NULL OR data_fim >= data_inicio),

    -- Coluna gerada: garante no máximo UMA matrícula ativa por aluno
    -- (várias inativas são permitidas; NULL não conflita no UNIQUE)
    matricula_ativa_flag TINYINT UNSIGNED AS (IF(ativa = 1, 1, NULL)) STORED,
    UNIQUE KEY uk_matricula_aluno_ativa (aluno_id, matricula_ativa_flag)
) ENGINE=InnoDB COMMENT='Histórico de matrículas (suporta transferências)';

-- -----------------------------------------------------------------------------
-- Tabela: calendario_escolar
-- -----------------------------------------------------------------------------
CREATE TABLE calendario_escolar (
    data                DATE NOT NULL PRIMARY KEY,
    tipo                ENUM('letivo', 'feriado', 'recesso', 'ponto_facultativo') NOT NULL DEFAULT 'letivo',
    descricao           VARCHAR(120) NULL,
    ano_letivo          SMALLINT UNSIGNED NOT NULL,

    INDEX idx_calendario_ano_tipo (ano_letivo, tipo)
) ENGINE=InnoDB COMMENT='Dias letivos, feriados e recessos';

-- -----------------------------------------------------------------------------
-- Tabela: frequencias
-- -----------------------------------------------------------------------------
CREATE TABLE frequencias (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    aluno_id            INT UNSIGNED NOT NULL,
    turma_id            INT UNSIGNED NOT NULL,
    data                DATE NOT NULL,
    horario             TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Horários permitidos no sistema: 1 ou 6',
    status              ENUM('P', 'F', 'J') NOT NULL DEFAULT 'P'
                        COMMENT 'P=Presente, F=Falta, J=Justificada',
    observacao          VARCHAR(255) NULL,
    lancado_por         INT UNSIGNED NOT NULL,
    lancado_em          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_frequencia_aluno_turma_data_horario (aluno_id, turma_id, data, horario),
    INDEX idx_frequencias_data (data),
    INDEX idx_frequencias_turma_data (turma_id, data, horario),
    INDEX idx_frequencias_aluno_data (aluno_id, data),
    INDEX idx_frequencias_status (status),

    CONSTRAINT fk_frequencias_aluno FOREIGN KEY (aluno_id) REFERENCES alunos (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_frequencias_turma FOREIGN KEY (turma_id) REFERENCES turmas (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_frequencias_usuario FOREIGN KEY (lancado_por) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Registro diário de frequência';

-- -----------------------------------------------------------------------------
-- Tabela: projetos
-- -----------------------------------------------------------------------------
CREATE TABLE projetos (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome                VARCHAR(120) NOT NULL,
    descricao           TEXT NULL,
    data_inicio         DATE NOT NULL,
    data_fim            DATE NULL,
    ativo               TINYINT(1) NOT NULL DEFAULT 1,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_projetos_ativo (ativo),
    INDEX idx_projetos_periodo (data_inicio, data_fim),

    CONSTRAINT chk_projetos_datas CHECK (data_fim IS NULL OR data_fim >= data_inicio)
) ENGINE=InnoDB COMMENT='Projetos especiais para monitoramento de frequência';

-- -----------------------------------------------------------------------------
-- Tabela: projeto_alunos
-- -----------------------------------------------------------------------------
CREATE TABLE projeto_alunos (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    projeto_id          INT UNSIGNED NOT NULL,
    aluno_id            INT UNSIGNED NOT NULL,
    data_inicio         DATE NOT NULL,
    data_fim            DATE NULL,
    ativo               TINYINT(1) NOT NULL DEFAULT 1,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_pa_projeto (projeto_id),
    INDEX idx_pa_aluno (aluno_id),
    INDEX idx_pa_ativo (ativo),

    CONSTRAINT fk_pa_projeto FOREIGN KEY (projeto_id) REFERENCES projetos (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_pa_aluno FOREIGN KEY (aluno_id) REFERENCES alunos (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_pa_datas CHECK (data_fim IS NULL OR data_fim >= data_inicio)
) ENGINE=InnoDB COMMENT='Alunos selecionados para projetos';

-- -----------------------------------------------------------------------------
-- Tabela: auditoria (opcional, recomendado)
-- -----------------------------------------------------------------------------
CREATE TABLE auditoria (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id          INT UNSIGNED NULL,
    tabela              VARCHAR(64) NOT NULL,
    registro_id         INT UNSIGNED NOT NULL,
    acao                ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
    dados_anteriores    JSON NULL,
    dados_novos         JSON NULL,
    criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_auditoria_tabela (tabela, registro_id),
    INDEX idx_auditoria_usuario (usuario_id),
    INDEX idx_auditoria_criado (criado_em),

    CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Log de alterações no sistema';

-- =============================================================================
-- VIEWS
-- =============================================================================

-- Lista alunos com código antes do nome (formato de exibição)
CREATE OR REPLACE VIEW vw_alunos_listagem AS
SELECT
    a.id,
    a.codigo,
    a.nome,
    CONCAT(a.codigo, ' - ', a.nome) AS codigo_nome,
    LPAD(a.codigo, 8, '0') AS codigo_formatado,
    CONCAT(LPAD(a.codigo, 8, '0'), ' - ', a.nome) AS codigo_formatado_nome,
    a.data_nascimento,
    a.ativo,
    m.id AS matricula_id,
    t.id AS turma_id,
    t.nome AS turma_nome,
    t.serie,
    t.turno,
    t.ano_letivo,
    m.data_inicio AS matricula_inicio
FROM alunos a
LEFT JOIN matriculas m ON m.aluno_id = a.id AND m.ativa = 1
LEFT JOIN turmas t ON t.id = m.turma_id
ORDER BY CAST(a.codigo AS UNSIGNED), a.nome;

-- Relatório mensal de frequência por projeto
CREATE OR REPLACE VIEW vw_relatorio_projeto_mensal AS
SELECT
    p.id AS projeto_id,
    p.nome AS projeto_nome,
    a.id AS aluno_id,
    a.codigo AS aluno_codigo,
    a.nome AS aluno_nome,
    CONCAT(LPAD(a.codigo, 8, '0'), ' - ', a.nome) AS aluno_codigo_nome,
    t.nome AS turma_nome,
    YEAR(f.data) AS ano,
    MONTH(f.data) AS mes,
    COUNT(f.id) AS dias_lancados,
    SUM(CASE WHEN f.status = 'P' THEN 1 ELSE 0 END) AS total_presencas,
    SUM(CASE WHEN f.status = 'F' THEN 1 ELSE 0 END) AS total_faltas,
    SUM(CASE WHEN f.status = 'J' THEN 1 ELSE 0 END) AS total_justificadas,
    ROUND(
        100.0 * SUM(CASE WHEN f.status = 'P' THEN 1 ELSE 0 END)
        / NULLIF(COUNT(f.id), 0),
        2
    ) AS percentual_presenca,
    ROUND(
        100.0 * SUM(CASE WHEN f.status IN ('F') THEN 1 ELSE 0 END)
        / NULLIF(COUNT(f.id), 0),
        2
    ) AS percentual_faltas
FROM projetos p
INNER JOIN projeto_alunos pa ON pa.projeto_id = p.id AND pa.ativo = 1
INNER JOIN alunos a ON a.id = pa.aluno_id
LEFT JOIN matriculas m ON m.aluno_id = a.id AND m.ativa = 1
LEFT JOIN turmas t ON t.id = m.turma_id
LEFT JOIN frequencias f
    ON f.aluno_id = a.id
    AND f.data >= pa.data_inicio
    AND (pa.data_fim IS NULL OR f.data <= pa.data_fim)
    AND f.data >= p.data_inicio
    AND (p.data_fim IS NULL OR f.data <= p.data_fim)
GROUP BY
    p.id, p.nome,
    a.id, a.codigo, a.nome,
    t.nome,
    YEAR(f.data), MONTH(f.data);

-- Frequência diária por turma (para tela de lançamento)
CREATE OR REPLACE VIEW vw_frequencia_turma_dia AS
SELECT
    t.id AS turma_id,
    t.nome AS turma_nome,
    f.data,
    a.id AS aluno_id,
    a.codigo AS aluno_codigo,
    LPAD(a.codigo, 8, '0') AS codigo_formatado,
    a.nome AS aluno_nome,
    CONCAT(LPAD(a.codigo, 8, '0'), ' - ', a.nome) AS aluno_codigo_nome,
    f.status,
    f.observacao,
    u.nome AS lancado_por_nome,
    f.lancado_em
FROM turmas t
INNER JOIN matriculas m ON m.turma_id = t.id AND m.ativa = 1
INNER JOIN alunos a ON a.id = m.aluno_id AND a.ativo = 1
LEFT JOIN frequencias f ON f.aluno_id = a.id AND f.turma_id = t.id
LEFT JOIN usuarios u ON u.id = f.lancado_por
ORDER BY t.nome, CAST(a.codigo AS UNSIGNED), a.nome;

-- =============================================================================
-- STORED PROCEDURES
-- =============================================================================

DELIMITER //

-- Transferir aluno de turma
CREATE PROCEDURE sp_transferir_aluno(
    IN p_aluno_id INT UNSIGNED,
    IN p_turma_destino_id INT UNSIGNED,
    IN p_data_transferencia DATE,
    IN p_motivo ENUM('transferencia', 'desistencia', 'conclusao', 'outro'),
    IN p_observacao VARCHAR(255)
)
BEGIN
    DECLARE v_matricula_atual_id INT UNSIGNED;

    START TRANSACTION;

    SELECT id INTO v_matricula_atual_id
    FROM matriculas
    WHERE aluno_id = p_aluno_id AND ativa = 1
    LIMIT 1;

    IF v_matricula_atual_id IS NOT NULL THEN
        UPDATE matriculas
        SET ativa = 0,
            data_fim = p_data_transferencia,
            motivo_saida = p_motivo,
            observacao = COALESCE(p_observacao, observacao)
        WHERE id = v_matricula_atual_id;
    END IF;

    INSERT INTO matriculas (aluno_id, turma_id, data_inicio, ativa)
    VALUES (p_aluno_id, p_turma_destino_id, p_data_transferencia, 1);

    COMMIT;
END //

-- Relatório mensal filtrado por projeto e período
CREATE PROCEDURE sp_relatorio_projeto_mes(
    IN p_projeto_id INT UNSIGNED,
    IN p_ano SMALLINT UNSIGNED,
    IN p_mes TINYINT UNSIGNED
)
BEGIN
    DECLARE v_inicio DATE;
    DECLARE v_fim DATE;

    SET v_inicio = STR_TO_DATE(CONCAT(p_ano, '-', LPAD(p_mes, 2, '0'), '-01'), '%Y-%m-%d');
    SET v_fim = LAST_DAY(v_inicio);

    SELECT
        a.codigo AS codigo_aluno,
        LPAD(a.codigo, 8, '0') AS codigo_formatado,
        a.nome AS nome_aluno,
        CONCAT(LPAD(a.codigo, 8, '0'), ' - ', a.nome) AS codigo_nome,
        t.nome AS turma,
        COUNT(f.id) AS dias_lancados,
        SUM(CASE WHEN f.status = 'P' THEN 1 ELSE 0 END) AS presencas,
        SUM(CASE WHEN f.status = 'F' THEN 1 ELSE 0 END) AS faltas,
        SUM(CASE WHEN f.status = 'J' THEN 1 ELSE 0 END) AS justificadas,
        ROUND(
            100.0 * SUM(CASE WHEN f.status = 'P' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(f.id), 0),
            2
        ) AS percentual_presenca,
        ROUND(
            100.0 * SUM(CASE WHEN f.status = 'F' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(f.id), 0),
            2
        ) AS percentual_faltas
    FROM projeto_alunos pa
    INNER JOIN alunos a ON a.id = pa.aluno_id
    INNER JOIN projetos p ON p.id = pa.projeto_id
    LEFT JOIN matriculas m ON m.aluno_id = a.id AND m.ativa = 1
    LEFT JOIN turmas t ON t.id = m.turma_id
    LEFT JOIN frequencias f
        ON f.aluno_id = a.id
        AND f.data BETWEEN v_inicio AND v_fim
        AND f.data >= pa.data_inicio
        AND (pa.data_fim IS NULL OR f.data <= pa.data_fim)
    WHERE pa.projeto_id = p_projeto_id
      AND pa.ativo = 1
      AND pa.data_inicio <= v_fim
      AND (pa.data_fim IS NULL OR pa.data_fim >= v_inicio)
    GROUP BY a.id, a.codigo, a.nome, t.nome
    ORDER BY CAST(a.codigo AS UNSIGNED), a.nome;
END //

-- Cadastrar novo aluno com matrícula
CREATE PROCEDURE sp_cadastrar_aluno(
    IN p_codigo VARCHAR(8),
    IN p_nome VARCHAR(150),
    IN p_turma_id INT UNSIGNED,
    IN p_data_nascimento DATE,
    IN p_data_matricula DATE
)
BEGIN
    DECLARE v_aluno_id INT UNSIGNED;

    IF p_codigo NOT REGEXP '^[0-9]{1,8}$' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Código do aluno deve conter apenas números (máx. 8 dígitos).';
    END IF;

    START TRANSACTION;

    INSERT INTO alunos (codigo, nome, data_nascimento)
    VALUES (p_codigo, p_nome, p_data_nascimento);

    SET v_aluno_id = LAST_INSERT_ID();

    INSERT INTO matriculas (aluno_id, turma_id, data_inicio, ativa)
    VALUES (v_aluno_id, p_turma_id, p_data_matricula, 1);

    COMMIT;

    SELECT
        a.id,
        LPAD(a.codigo, 8, '0') AS codigo_formatado,
        a.nome,
        CONCAT(LPAD(a.codigo, 8, '0'), ' - ', a.nome) AS codigo_nome,
        t.nome AS turma
    FROM alunos a
    INNER JOIN matriculas m ON m.aluno_id = a.id AND m.ativa = 1
    INNER JOIN turmas t ON t.id = m.turma_id
    WHERE a.id = v_aluno_id;
END //

DELIMITER ;

-- =============================================================================
-- DADOS INICIAIS (exemplo)
-- =============================================================================

-- Usuário admin padrão (senha deve ser alterada na aplicação)
-- Hash abaixo é placeholder; substituir pelo hash real de 'admin123'
INSERT INTO usuarios (nome, cpf, senha_hash, perfil) VALUES
('Administrador', '00000000001', '$2y$10$PLACEHOLDER_HASH_ALTERAR', 'admin'),
('Coordenação', '00000000002', '$2y$10$PLACEHOLDER_HASH_ALTERAR', 'coordenacao');

-- Exemplo: cadastro de turmas (ajuste conforme sua escola)
INSERT INTO turmas (nome, serie, turno, ano_letivo) VALUES
('1º A', '1º ano', 'manha', 2026),
('1º B', '1º ano', 'manha', 2026),
('2º A', '2º ano', 'manha', 2026),
('2º B', '2º ano', 'manha', 2026),
('3º A', '3º ano', 'manha', 2026),
('3º B', '3º ano', 'manha', 2026);

-- Exemplo: alunos com código numérico (máx. 8 dígitos)
INSERT INTO alunos (codigo, nome, data_nascimento) VALUES
('1001', 'Ana Silva Santos', '2012-03-15'),
('1002', 'Bruno Oliveira Costa', '2012-07-22'),
('1003', 'Carla Mendes Pereira', '2011-11-08'),
('12345678', 'Aluno Código Máximo', '2010-01-01');

INSERT INTO matriculas (aluno_id, turma_id, data_inicio, ativa) VALUES
(1, 1, '2026-02-01', 1),
(2, 1, '2026-02-01', 1),
(3, 2, '2026-02-01', 1),
(4, 3, '2026-02-01', 1);

-- Exemplo: calendário (junho/2026 - dias letivos seg a sex)
INSERT INTO calendario_escolar (data, tipo, descricao, ano_letivo)
SELECT
    d.data,
    CASE
        WHEN DAYOFWEEK(d.data) IN (1, 7) THEN 'recesso'
        ELSE 'letivo'
    END,
    CASE
        WHEN DAYOFWEEK(d.data) IN (1, 7) THEN 'Fim de semana'
        ELSE 'Dia letivo'
    END,
    2026
FROM (
    SELECT DATE('2026-06-01') + INTERVAL seq DAY AS data
    FROM (
        SELECT a.N + b.N * 10 + c.N * 100 AS seq
        FROM (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
              UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
        CROSS JOIN (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
              UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b
        CROSS JOIN (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
              UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) c
    ) nums
    WHERE DATE('2026-06-01') + INTERVAL seq DAY <= LAST_DAY('2026-06-01')
) d;

-- Feriado de exemplo
INSERT INTO calendario_escolar (data, tipo, descricao, ano_letivo) VALUES
('2026-06-08', 'feriado', 'Corpus Christi', 2026)
ON DUPLICATE KEY UPDATE tipo = 'feriado', descricao = 'Corpus Christi';

-- Exemplo: projeto e alunos selecionados
INSERT INTO projetos (nome, descricao, data_inicio) VALUES
('Projeto Leitura', 'Monitoramento de frequência - projeto de leitura', '2026-02-01');

INSERT INTO projeto_alunos (projeto_id, aluno_id, data_inicio) VALUES
(1, 1, '2026-02-01'),
(1, 2, '2026-02-01');

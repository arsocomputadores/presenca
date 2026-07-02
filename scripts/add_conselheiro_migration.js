require('dotenv').config();
const { getPool } = require('../lib/db');
(async () => {
  const pool = await getPool();
  if (!pool) {
    console.error('MySQL não habilitado (USE_MYSQL!=true) ou pool não criado');
    process.exit(1);
  }
  try {
    const [c1] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='turmas' AND COLUMN_NAME='professor_conselheiro_id'");
    if (c1.length === 0) {
      await pool.query("ALTER TABLE turmas ADD COLUMN professor_conselheiro_id INT UNSIGNED NULL COMMENT 'Professor conselheiro da turma'");
      console.log('coluna professor_conselheiro_id criada');
    } else {
      console.log('coluna professor_conselheiro_id já existe');
    }
  } catch (e) {
    console.error('erro coluna professor_conselheiro_id', e.message);
  }
  try {
    const [c2] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='turmas' AND COLUMN_NAME='conselheiro_pode_lancar'");
    if (c2.length === 0) {
      await pool.query("ALTER TABLE turmas ADD COLUMN conselheiro_pode_lancar TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = conselheiro pode lançar frequência'");
      console.log('coluna conselheiro_pode_lancar criada');
    } else {
      console.log('coluna conselheiro_pode_lancar já existe');
    }
  } catch (e) {
    console.error('erro coluna conselheiro_pode_lancar', e.message);
  }
  try {
    const [rows] = await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='turmas' AND CONSTRAINT_TYPE='FOREIGN KEY' AND CONSTRAINT_NAME='fk_turmas_conselheiro'");
    if (rows.length === 0) {
      await pool.query("ALTER TABLE turmas ADD CONSTRAINT fk_turmas_conselheiro FOREIGN KEY (professor_conselheiro_id) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE");
      console.log('constraint fk_turmas_conselheiro criada');
    } else {
      console.log('constraint fk_turmas_conselheiro já existe');
    }
  } catch (e) {
    console.error('erro constraint', e.message);
  } finally {
    try { await pool.end(); } catch(e){}
  }
})();
